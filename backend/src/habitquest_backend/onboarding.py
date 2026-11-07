"""Children, pain points mapped to goals, and each child's plan (the habits they are working on)."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg.types.json import Jsonb
from pydantic import Field, field_validator

from habitquest_backend.accounts import StrictModel
from habitquest_backend.ai import Candidate, map_pain_point
from habitquest_backend.auth import family_pin_ok, signed_in
from habitquest_backend.buddies import (
    BUDDY_COLUMNS,
    Buddy,
    BuddySelection,
    require_selection_revision,
    selection_changes,
    validate_catalog_choice,
)
from habitquest_backend.config import Settings
from habitquest_backend.db import one, transaction
from habitquest_backend.generation_metering import endpoint
from habitquest_backend.journey import progress
from habitquest_backend.planning_catalog import CatalogRepository, Setting, require_goal

MAX_ACTIVE_HABITS = 6
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DEFAULT_CUES = {
    "morning": "07:00",
    "midday": "12:30",
    "after_school": "16:00",
    "evening": "18:30",
    "bedtime": "20:00",
}
CHILD_COLUMNS = f"id,family_id,name,age,{BUDDY_COLUMNS},world,tier_override,routine_times,kid_pin_hash IS NOT NULL AS has_pin,created_at"
HABIT_COLUMNS = "h.id,h.goal_id,h.title,h.description,h.kid_title,h.kid_hint,h.icon,h.anchor,h.tier,h.points"

Anchor = Literal["morning", "midday", "after_school", "evening", "bedtime"]
Day = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
Time = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$", description="24-hour HH:MM")]
Days = Annotated[list[Day], Field(min_length=1, max_length=7)]


def unique(values: list | None) -> list | None:
    """A validator that refuses lists with repeated items."""
    if values is not None and len(set(values)) != len(values):
        raise ValueError("List items must be unique")
    return values


class ChildInput(StrictModel):
    """The request body of `POST /v1/families/{family_id}/children`."""

    name: str = Field(min_length=1, max_length=40)
    age: int = Field(ge=3, le=13)
    buddy: Buddy = "fox"
    buddy_selection: BuddySelection | None = None
    routine_times: dict[Anchor, Time] = Field(
        default_factory=dict, description='When each part of the day starts, e.g. {"bedtime": "20:00"}'
    )


class ChildUpdate(StrictModel):
    """The request body of `PATCH /v1/children/{child_id}`."""

    name: str | None = Field(default=None, min_length=1, max_length=40)
    age: int | None = Field(default=None, ge=3, le=13)
    buddy: Buddy | None = None
    buddy_selection: BuddySelection | None = None
    tier_override: int | None = Field(
        default=None, ge=0, le=3, description="Highest quest tier to allow; 0 follows the child's world"
    )
    routine_times: dict[Anchor, Time] | None = None


class PainPointInput(StrictModel):
    """The request body of `POST /v1/children/{child_id}/pain-points`."""

    request_id: UUID | None = None
    text: str = Field(min_length=5, max_length=2000, description="The problem, in the parent's own words")


class PlanHabit(StrictModel):
    """One habit in `PUT /v1/children/{child_id}/plan`: its id, and optionally its time and days."""

    habit_id: str
    cue_time: Time | None = None
    days: Days | None = None

    _days = field_validator("days")(unique)


class PlanInput(StrictModel):
    """The request body of `PUT /v1/children/{child_id}/plan`."""

    goals: list[str] = Field(max_length=7, description="Goal ids to work on; others are dropped")
    habits: list[PlanHabit] = Field(max_length=MAX_ACTIVE_HABITS)

    _goals = field_validator("goals")(unique)

    @field_validator("habits")
    @classmethod
    def unique_habits(cls, habits: list[PlanHabit]) -> list[PlanHabit]:
        unique([h.habit_id for h in habits])
        return habits


class ChildHabitUpdate(StrictModel):
    """The request body of `PATCH /v1/child-habits/{child_habit_id}`."""

    cue_time: Time | None = None
    days: Days | None = None
    status: Literal["active", "paused", "removed"] | None = None

    _days = field_validator("days")(unique)


class ChildHabitAdd(PlanHabit):
    """Add an already approved/catalog habit without replacing the rest of a child's plan."""

    pin: str | None = Field(default=None, pattern=r"^\d{4}$")


class ChildGoalUpdate(StrictModel):
    """Save or remove one goal while keeping its immutable source and past assignments."""

    status: Literal["active", "dropped"]
    setting: Setting = "home"


def require_plan_room(conn, child_id: UUID) -> None:
    """Check the shared plan limit while the caller holds this child's row lock."""
    used = conn.execute(
        "SELECT count(*) AS n FROM hq.child_habits WHERE child_id=%s AND status<>'removed'", (child_id,)
    ).fetchone()["n"]
    if used >= MAX_ACTIVE_HABITS:
        raise HTTPException(
            409,
            f"This plan already has {MAX_ACTIVE_HABITS} habits. Remove a habit from the plan, then add this one. Your generated choices are saved.",
        )


def assign_existing_habit(conn, child: dict, body: PlanHabit, repository: CatalogRepository) -> dict:
    """Add or restore approved content, preserving old assignments and completion history."""
    habit = one(
        conn,
        "SELECT h.id,h.goal_id,h.anchor,h.min_age,h.max_age,h.tier,h.generated_child_id"
        " FROM hq.habits h JOIN hq.goals g ON g.id=h.goal_id"
        " WHERE h.id=%s AND h.is_active AND g.is_active",
        (body.habit_id,),
    )
    if habit["generated_child_id"] not in (None, child["id"]):
        raise HTTPException(422, "This generated habit belongs to another child")
    if not habit["min_age"] <= child["age"] <= habit["max_age"]:
        raise HTTPException(422, "This habit does not fit the child's current age")
    if habit["tier"] > progress(conn, child["id"])["unlocked_tier"]:
        raise HTTPException(422, "This habit is above the child's unlocked tier")
    if habit["generated_child_id"] is not None:
        detail = one(
            conn,
            "SELECT d.source,d.draft,d.content_digest,b.setting FROM hq.generated_habit_details d"
            " JOIN hq.habit_draft_batches b ON b.id=d.batch_id WHERE d.habit_id=%s AND d.child_id=%s",
            (body.habit_id, child["id"]),
        )
        goal = require_goal(conn, repository, habit["goal_id"], child["age"], detail["setting"])
        if detail["source"] != goal.source_ref:
            raise HTTPException(409, "The source goal changed. Generate fresh habits.")
        if detail["draft"]["recurrence"] == "daily" and body.days is not None and set(body.days) != set(DAYS):
            raise HTTPException(422, "Daily habits require all seven days")
        if conn.execute(
            "SELECT 1 FROM hq.generated_habit_details d JOIN hq.child_habits ch ON ch.habit_id=d.habit_id"
            " WHERE d.child_id=%s AND d.content_digest=%s AND d.habit_id<>%s AND ch.status<>'removed'",
            (child["id"], detail["content_digest"], body.habit_id),
        ).fetchone():
            raise HTTPException(409, "This action is already in the child's plan")
    current = conn.execute(
        "SELECT id,to_char(cue_time,'HH24:MI') AS cue_time,days FROM hq.child_habits"
        " WHERE child_id=%s AND habit_id=%s AND status<>'removed'",
        (child["id"], body.habit_id),
    ).fetchone()
    if current is None:
        require_plan_room(conn, child["id"])
    cue = (
        body.cue_time
        or (current and current["cue_time"])
        or child["routine_times"].get(habit["anchor"])
        or DEFAULT_CUES[habit["anchor"]]
    )
    days = body.days or (current and current["days"]) or DAYS
    conn.execute(
        "INSERT INTO hq.child_goals(child_id,goal_id,status) VALUES(%s,%s,'active')"
        " ON CONFLICT(child_id,goal_id) DO UPDATE SET status='active'",
        (child["id"], habit["goal_id"]),
    )
    if current:
        conn.execute(
            "UPDATE hq.child_habits SET status='active',cue_time=%s,days=%s WHERE id=%s",
            (cue, days, current["id"]),
        )
        return current
    return one(
        conn,
        "INSERT INTO hq.child_habits(child_id,habit_id,cue_time,days,started_on)"
        " VALUES(%s,%s,%s,%s,hq.child_today(%s)) RETURNING id",
        (child["id"], body.habit_id, cue, days, child["id"]),
    )


def candidates(conn, age: int, tier: int) -> list[Candidate]:
    """Active goals, each with the active catalog habits suited to this age and unlocked tier (goals with none
    left out). The AI chooses from these, so a family's custom habits are never among them.
    """
    goals = conn.execute(
        "SELECT id,title,description,keywords FROM hq.goals WHERE is_active ORDER BY title"
    ).fetchall()
    habits = conn.execute(
        "SELECT id,goal_id,title,tier FROM hq.habits WHERE is_active AND family_id IS NULL"
        " AND %s BETWEEN min_age AND max_age"
        " AND tier<=%s ORDER BY tier,title",
        (age, tier),
    ).fetchall()
    found = [
        Candidate(
            g["id"],
            g["title"],
            g["description"],
            g["keywords"],
            [
                {"id": h["id"], "title": h["title"], "tier": h["tier"]}
                for h in habits
                if h["goal_id"] == g["id"]
            ],
        )
        for g in goals
    ]
    return [c for c in found if c.habits]


def plan_view(conn, child_id: UUID) -> dict:
    """A child's plan as the API returns it: progress, suggested and active goals with the habits the child can
    pick for each, and current habits with their time, days and status.
    """
    child = one(conn, "SELECT id,age FROM hq.children WHERE id=%s", (child_id,))
    level = progress(conn, child_id)
    goals = conn.execute(
        "SELECT cg.goal_id,g.title,cg.status,cg.reason,cg.recommended_habit_ids FROM hq.child_goals cg"
        " JOIN hq.goals g ON g.id=cg.goal_id WHERE cg.child_id=%s AND cg.status IN ('suggested','active')"
        " ORDER BY cg.created_at,cg.goal_id",
        (child_id,),
    ).fetchall()
    options = conn.execute(
        f"SELECT {HABIT_COLUMNS} FROM hq.habits h WHERE h.is_active AND h.goal_id=ANY(%s)"
        " AND %s BETWEEN h.min_age AND h.max_age AND h.tier<=%s"
        " AND (h.generated_child_id IS NULL OR h.generated_child_id=%s) ORDER BY h.tier,h.title",
        ([g["goal_id"] for g in goals], child["age"], level["unlocked_tier"], child_id),
    ).fetchall()
    for goal in goals:
        goal["options"] = [
            {**h, "recommended": h["id"] in goal["recommended_habit_ids"]}
            for h in options
            if h["goal_id"] == goal["goal_id"]
        ]
    habits = conn.execute(
        f"SELECT ch.id,ch.habit_id,{HABIT_COLUMNS.replace('h.id,', '')},to_char(ch.cue_time,'HH24:MI') AS cue_time,"
        "ch.days,ch.status,ch.started_on FROM hq.child_habits ch JOIN hq.habits h ON h.id=ch.habit_id"
        " WHERE ch.child_id=%s AND ch.status<>'removed' ORDER BY ch.cue_time,h.title",
        (child_id,),
    ).fetchall()
    return {
        "child_id": child["id"],
        "progress": level,
        "goals": goals,
        "habits": habits,
        "capacity": {
            "limit": MAX_ACTIVE_HABITS,
            "used": len(habits),
            "remaining": max(0, MAX_ACTIVE_HABITS - len(habits)),
        },
    }


def router(settings: Settings) -> APIRouter:
    api = APIRouter()
    User = Annotated[UUID, Depends(signed_in(settings))]
    repository = CatalogRepository()

    @api.post("/v1/families/{family_id}/children", status_code=201, tags=["Children"], summary="Add a child")
    def add_child(family_id: UUID, body: ChildInput, user: User) -> dict:
        """Adds a child to the family: `name`, `age` (3-13, decides which habits suit them), `buddy` (fox, owl,
        bear, bunny) and optional `routine_times` per part of the day
        (`morning`, `midday`, `after_school`, `evening`, `bedtime`), used as default habit times.
        """
        with transaction(settings, user) as conn:
            one(conn, "SELECT id FROM hq.families WHERE id=%s", (family_id,))
            selection = {}
            if "buddy_selection" in body.model_fields_set:
                if body.buddy_selection is None:
                    raise HTTPException(422, "A buddy selection cannot be empty")
                choice = body.buddy_selection.model_copy(
                    update={"expected_revision": body.buddy_selection.expected_revision or 0}
                )
                selection = selection_changes(
                    conn, settings, {"age": body.age, "buddy_selection_revision": 0}, choice
                )
            return one(
                conn,
                "INSERT INTO hq.children(family_id,name,age,buddy,routine_times,buddy_selection_mode,"
                "catalog_buddy_id,buddy_catalog_version,buddy_selection_revision) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)"
                f" RETURNING {CHILD_COLUMNS}",
                (
                    family_id,
                    body.name,
                    body.age,
                    selection.get("buddy", body.buddy),
                    Jsonb(body.routine_times),
                    selection.get("buddy_selection_mode", "legacy"),
                    selection.get("catalog_buddy_id"),
                    selection.get("buddy_catalog_version"),
                    selection.get("buddy_selection_revision", 0),
                ),
            )

    @api.get("/v1/families/{family_id}/children", tags=["Children"], summary="List children")
    def list_children(family_id: UUID, user: User) -> list[dict]:
        """The family's children, oldest record first. 404 unless the caller cares for this family."""
        with transaction(settings, user) as conn:
            one(conn, "SELECT id FROM hq.families WHERE id=%s", (family_id,))
            return conn.execute(
                f"SELECT {CHILD_COLUMNS} FROM hq.children WHERE family_id=%s ORDER BY created_at,id",
                (family_id,),
            ).fetchall()

    @api.get("/v1/children/{child_id}", tags=["Children"], summary="Read a child")
    def read_child(child_id: UUID, user: User) -> dict:
        """One child's profile. 404 unless the caller cares for the child's family."""
        with transaction(settings, user) as conn:
            return one(conn, f"SELECT {CHILD_COLUMNS} FROM hq.children WHERE id=%s", (child_id,))

    @api.patch("/v1/children/{child_id}", tags=["Children"], summary="Edit a child")
    def update_child(child_id: UUID, body: ChildUpdate, user: User) -> dict:
        """Changes any of `name`, `age`, `buddy`, `tier_override` (the highest quest tier to allow, 0 to follow
        the child's world) and `routine_times` (replaced as a whole); omitted fields stay as they are. Habits already in the plan keep their times.
        """
        changes = body.model_dump(exclude_none=True, exclude={"buddy_selection"})
        if "buddy_selection" in body.model_fields_set and body.buddy_selection is None:
            raise HTTPException(422, "A buddy selection cannot be empty")
        if body.buddy_selection is not None and "buddy" in body.model_fields_set:
            raise HTTPException(422, "Send buddy_selection without the compatibility buddy field")
        require_selection_revision(body.buddy_selection)
        with transaction(settings, user) as conn:
            child = one(
                conn, f"SELECT age,{BUDDY_COLUMNS} FROM hq.children WHERE id=%s FOR UPDATE", (child_id,)
            )
            if child["buddy_selection_revision"] > 0:
                changes.pop("buddy", None)
            final = {**child, **changes}
            if body.buddy_selection is not None:
                changes.update(selection_changes(conn, settings, final, body.buddy_selection))
            elif final["buddy_selection_mode"] == "catalog" and "age" in changes:
                validate_catalog_choice(conn, final)
            if changes:
                assignments = ",".join(f"{column}=%s" for column in changes)
                values = [
                    Jsonb(value) if column == "routine_times" else value for column, value in changes.items()
                ]
                conn.execute(f"UPDATE hq.children SET {assignments} WHERE id=%s", (*values, child_id))
            return one(conn, f"SELECT {CHILD_COLUMNS} FROM hq.children WHERE id=%s", (child_id,))

    @api.post(
        "/v1/children/{child_id}/pain-points",
        status_code=201,
        tags=["Onboarding"],
        summary="Describe a problem",
    )
    @endpoint(settings, "onboarding")
    def add_pain_point(child_id: UUID, body: PainPointInput, user: User, response: Response) -> dict:
        """The parent describes a problem in their own words. AI maps it to one to three pre-approved goals, each
        with a one-sentence `reason`, and recommends up to two habits per goal from those suited to the child's
        age and unlocked tier. The goals are saved as `suggested` (goals already active stay active) and the
        response is the child's plan, where each goal lists its habit `options` with `recommended` flags.

        `mapped_by` says how: `ai`; `keywords` when the AI was unavailable (no recommendations); `manual` when
        nothing matched, and the parent picks goals from `GET /v1/goals`. Only the child's age and this text
        are sent to the AI provider. If the text suggests a child may be at risk, nothing is saved and the
        response (200) carries `safety` guidance instead.
        """
        with transaction(settings, user) as conn:
            child = one(conn, "SELECT id,age FROM hq.children WHERE id=%s", (child_id,))
            options = candidates(conn, child["age"], progress(conn, child_id)["unlocked_tier"])
        # The model call happens outside any transaction.
        mapping = map_pain_point(settings, child["age"], body.text, options)
        if mapping.safety:
            response.status_code = 200
            return {"pain_point": None, "safety": {"guidance": mapping.safety}, "plan": None}
        with transaction(settings, user) as conn:
            point = one(
                conn,
                "INSERT INTO hq.pain_points(child_id,text,mapped_by,created_by) VALUES(%s,%s,%s,%s)"
                " RETURNING id,text,mapped_by,created_at",
                (child_id, body.text, mapping.mapped_by, user),
            )
            for goal_id, reason in mapping.goals:
                conn.execute(
                    "INSERT INTO hq.child_goals(child_id,goal_id,pain_point_id,reason,recommended_habit_ids)"
                    " VALUES(%s,%s,%s,%s,%s) ON CONFLICT (child_id,goal_id) DO UPDATE SET"
                    " pain_point_id=EXCLUDED.pain_point_id,reason=EXCLUDED.reason,"
                    "recommended_habit_ids=EXCLUDED.recommended_habit_ids,"
                    "status=CASE WHEN hq.child_goals.status='active' THEN 'active' ELSE 'suggested' END",
                    (child_id, goal_id, point["id"], reason, mapping.recommended.get(goal_id, [])),
                )
            return {"pain_point": point, "safety": None, "plan": plan_view(conn, child_id)}

    @api.get("/v1/children/{child_id}/plan", tags=["Onboarding"], summary="Read the plan")
    def read_plan(child_id: UUID, user: User) -> dict:
        """The child's `progress` (Sparks, level, unlocked tier), their suggested and active `goals` (each with
        the habit `options` the parent can pick, recommended ones flagged) and their current `habits` with cue
        time, days and status (`active` or `paused`).
        """
        with transaction(settings, user) as conn:
            return plan_view(conn, child_id)

    @api.patch(
        "/v1/children/{child_id}/goals/{goal_id}", tags=["Onboarding"], summary="Save or remove a goal"
    )
    def update_goal(child_id: UUID, goal_id: str, body: ChildGoalUpdate, user: User) -> dict:
        """Saves a goal without assigning habits, or drops it and ends its assignments while preserving history."""
        with transaction(settings, user) as conn:
            child = one(conn, "SELECT id,age FROM hq.children WHERE id=%s FOR UPDATE", (child_id,))
            goal = one(conn, "SELECT id,is_active FROM hq.goals WHERE id=%s", (goal_id,))
            if body.status == "active":
                if not goal["is_active"]:
                    raise HTTPException(404, "This goal is retired")
                if goal_id.startswith("hqg-"):
                    require_goal(conn, repository, goal_id, child["age"], body.setting)
                conn.execute(
                    "INSERT INTO hq.child_goals(child_id,goal_id,status) VALUES(%s,%s,'active')"
                    " ON CONFLICT(child_id,goal_id) DO UPDATE SET status='active'",
                    (child_id, goal_id),
                )
            else:
                conn.execute(
                    "UPDATE hq.child_goals SET status='dropped' WHERE child_id=%s AND goal_id=%s",
                    (child_id, goal_id),
                )
                conn.execute(
                    "UPDATE hq.child_habits SET status='removed',ended_on=hq.child_today(%s)"
                    " WHERE child_id=%s AND status<>'removed'"
                    " AND habit_id IN (SELECT id FROM hq.habits WHERE goal_id=%s)",
                    (child_id, child_id, goal_id),
                )
            return plan_view(conn, child_id)

    @api.post("/v1/children/{child_id}/habits", tags=["Onboarding"], summary="Add an existing habit")
    def add_existing(child_id: UUID, body: ChildHabitAdd, user: User) -> dict:
        """Adds or restores one approved/catalog habit after the family PIN, ownership, age and capacity checks."""
        settings.pin_attempts.check(str(user))
        with transaction(settings, user) as conn:
            child = one(conn, "SELECT * FROM hq.children WHERE id=%s FOR UPDATE", (child_id,))
            family = one(conn, "SELECT pin_hash FROM hq.families WHERE id=%s", (child["family_id"],))
            if not family_pin_ok(body.pin, family["pin_hash"]):
                raise HTTPException(403, "Incorrect grown-ups PIN")
            assign_existing_habit(conn, child, body, repository)
            return plan_view(conn, child_id)

    @api.put("/v1/children/{child_id}/plan", tags=["Onboarding"], summary="Set the plan")
    def set_plan(child_id: UUID, body: PlanInput, user: User) -> dict:
        """Sets the child's plan in one step: the `goals` to work on and the `habits` to do, at most six.
        Each habit must belong to one of the listed goals and suit the child's age and unlocked tier (422
        otherwise). `cue_time` defaults to the habit's current time, else the child's routine time for that
        part of the day, else a standard time; `days` defaults to every day. Listed goals become `active`
        and other suggested or active goals `dropped`; habits not listed are removed (kept as history).
        Use this both to activate the first plan and to change it later.
        """
        requested = [h.habit_id for h in body.habits]
        with transaction(settings, user) as conn:
            child = one(
                conn, "SELECT id,age,routine_times FROM hq.children WHERE id=%s FOR UPDATE", (child_id,)
            )
            tier = progress(conn, child_id)["unlocked_tier"]
            goals = {
                row["id"]
                for row in conn.execute(
                    "SELECT id FROM hq.goals WHERE is_active AND id=ANY(%s)", (body.goals,)
                ).fetchall()
            }
            if unknown := [g for g in body.goals if g not in goals]:
                raise HTTPException(422, f"Unknown goal: {unknown[0]}")
            catalog = {
                row["id"]: row
                for row in conn.execute(
                    "SELECT h.id,h.goal_id,h.anchor,h.min_age,h.max_age,h.tier,d.child_id AS generated_for_child_id"
                    " FROM hq.habits h LEFT JOIN hq.generated_habit_details d ON d.habit_id=h.id"
                    " WHERE h.is_active AND h.id=ANY(%s)",
                    (requested,),
                ).fetchall()
            }
            for habit_id in requested:
                habit = catalog.get(habit_id)
                if habit is None:
                    raise HTTPException(422, f"Unknown habit: {habit_id}")
                if habit["generated_for_child_id"] not in (None, child_id):
                    raise HTTPException(422, "This generated habit belongs to another child")
                if habit["goal_id"] not in goals:
                    raise HTTPException(
                        422, f"{habit_id} belongs to goal {habit['goal_id']}, which is not listed"
                    )
                if not habit["min_age"] <= child["age"] <= habit["max_age"]:
                    raise HTTPException(422, f"{habit_id} is for ages {habit['min_age']}-{habit['max_age']}")
                if habit["tier"] > tier:
                    raise HTTPException(
                        422, f"{habit_id} is tier {habit['tier']}; this child has unlocked tier {tier}"
                    )
            conn.execute(
                "UPDATE hq.child_goals SET status='dropped' WHERE child_id=%s AND status IN ('suggested','active')"
                " AND NOT goal_id=ANY(%s)",
                (child_id, body.goals),
            )
            for goal_id in body.goals:
                conn.execute(
                    "INSERT INTO hq.child_goals(child_id,goal_id,status) VALUES(%s,%s,'active')"
                    " ON CONFLICT (child_id,goal_id) DO UPDATE SET status='active'",
                    (child_id, goal_id),
                )
            live = {
                row["habit_id"]: row
                for row in conn.execute(
                    "SELECT id,habit_id,to_char(cue_time,'HH24:MI') AS cue_time,days FROM hq.child_habits"
                    " WHERE child_id=%s AND status<>'removed'",
                    (child_id,),
                ).fetchall()
            }
            conn.execute(
                "UPDATE hq.child_habits SET status='removed',ended_on=current_date"
                " WHERE child_id=%s AND status<>'removed' AND NOT habit_id=ANY(%s)",
                (child_id, requested),
            )
            for wanted in body.habits:
                current = live.get(wanted.habit_id)
                anchor = catalog[wanted.habit_id]["anchor"]
                cue = (
                    wanted.cue_time
                    or (current and current["cue_time"])
                    or child["routine_times"].get(anchor)
                    or DEFAULT_CUES[anchor]
                )
                days = wanted.days or (current and current["days"]) or DAYS
                if current:
                    conn.execute(
                        "UPDATE hq.child_habits SET cue_time=%s,days=%s,status='active' WHERE id=%s",
                        (cue, days, current["id"]),
                    )
                else:
                    conn.execute(
                        "INSERT INTO hq.child_habits(child_id,habit_id,cue_time,days) VALUES(%s,%s,%s,%s)",
                        (child_id, wanted.habit_id, cue, days),
                    )
            return plan_view(conn, child_id)

    @api.patch("/v1/child-habits/{child_habit_id}", tags=["Onboarding"], summary="Adjust one habit")
    def update_child_habit(child_habit_id: UUID, body: ChildHabitUpdate, user: User) -> dict:
        """Changes one habit in a child's plan: `cue_time`, `days`, or `status` (`active`, `paused`, or
        `removed`, which ends it and keeps it as history). A removed habit cannot be changed (409); pick it
        again through the plan. Returns the child's plan.
        """
        changes = body.model_dump(exclude_none=True)
        with transaction(settings, user) as conn:
            hint = one(conn, "SELECT child_id FROM hq.child_habits WHERE id=%s", (child_habit_id,))
            one(conn, "SELECT id FROM hq.children WHERE id=%s FOR UPDATE", (hint["child_id"],))
            row = one(
                conn, "SELECT child_id,status FROM hq.child_habits WHERE id=%s FOR UPDATE", (child_habit_id,)
            )
            if row["status"] == "removed":
                raise HTTPException(409, "This habit was removed; add it again through the plan")
            for column, value in changes.items():
                conn.execute(f"UPDATE hq.child_habits SET {column}=%s WHERE id=%s", (value, child_habit_id))
            if changes.get("status") == "removed":
                conn.execute(
                    "UPDATE hq.child_habits SET ended_on=hq.child_today(%s) WHERE id=%s",
                    (row["child_id"], child_habit_id),
                )
            return plan_view(conn, row["child_id"])

    return api

"""The whole catalog in one list, and a family's own custom habits.

Custom habits live in `hq.habits` beside the catalog, with the family's id and an id starting with "my-", so the
daily loop, approvals, points and quest stars treat them like any other habit. They suit every age, are open from
tier 1 and pay what a tier 1 catalog habit pays. Their text is the family's own and never reaches the AI provider.
"""

import secrets
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import Field

from habitquest_backend.accounts import StrictModel
from habitquest_backend.auth import signed_in
from habitquest_backend.config import Settings
from habitquest_backend.db import one, transaction
from habitquest_backend.onboarding import Anchor
from habitquest_backend.safety import screen_text

CUSTOM_PREFIX = "my-"
CUSTOM_POINTS = 10
MAX_CUSTOM_HABITS = 30
COLUMNS = (
    "h.id,h.goal_id,g.title AS goal_title,h.title,h.description,h.kid_title,h.kid_hint,h.icon,h.anchor,"
    "h.min_age,h.max_age,h.tier,h.points"
)
BLOCKED = "Please reword this habit: kids will read it, so keep it kind and free of personal details."


def is_custom(habit_id: str) -> bool:
    """True for a family's own habit (its id starts with "my-"), false for a catalog habit."""
    return habit_id.startswith(CUSTOM_PREFIX)


class CustomHabit(StrictModel):
    """The request body of `POST /v1/families/{family_id}/habits`, `PUT /v1/habits/{habit_id}`."""

    goal_id: str = Field(
        min_length=1, max_length=40, description="The goal it belongs to, from GET /v1/goals"
    )
    title: str = Field(min_length=1, max_length=60, description="What grown-ups see, e.g. Practise piano")
    kid_title: str = Field(default="", max_length=40, description="What the child sees; the title when empty")
    description: str = Field(default="", max_length=200)
    kid_hint: str = Field(default="", max_length=80, description="A short nudge shown to the child")
    icon: str = Field(default="⭐", min_length=1, max_length=8, description="One emoji")
    anchor: Anchor = Field(default="evening", description="The part of the day it belongs to")


def checked(conn, body: CustomHabit) -> dict:
    """The fields to store, after the goal and the kid-facing text are checked."""
    fields = body.model_dump()
    fields = {key: value.strip() if isinstance(value, str) else value for key, value in fields.items()}
    fields["kid_title"] = fields["kid_title"] or fields["title"][:40]
    if (
        conn.execute("SELECT id FROM hq.goals WHERE id=%s AND is_active", (fields["goal_id"],)).fetchone()
        is None
    ):
        raise HTTPException(422, f"Unknown goal: {fields['goal_id']}")
    text = " ".join(fields[key] for key in ("title", "kid_title", "description", "kid_hint"))
    if not screen_text(text).ok:
        raise HTTPException(422, BLOCKED)
    return fields


def router(settings: Settings) -> APIRouter:
    api = APIRouter()
    User = Annotated[UUID, Depends(signed_in(settings))]

    @api.get("/v1/catalog", tags=["Catalog"], summary="The whole catalog")
    def catalog(_: User) -> list[dict]:
        """Every active pre-approved habit with its goal's title, age range, tier, points and kid-facing text,
        ordered by goal, tier and title. Use it to browse habits by age group; a child's plan still only takes
        habits suited to their age and unlocked tier.
        """
        with transaction(settings) as conn:
            return conn.execute(
                f"SELECT {COLUMNS} FROM hq.habits h JOIN hq.goals g ON g.id=h.goal_id"
                " WHERE h.is_active AND g.is_active AND h.family_id IS NULL ORDER BY g.title,h.tier,h.title"
            ).fetchall()

    @api.get("/v1/families/{family_id}/habits", tags=["Catalog"], summary="List custom habits")
    def list_custom(family_id: UUID, user: User) -> list[dict]:
        """The family's own active habits, newest first, in the same shape as the catalog. Any caregiver of the
        family can add ordinary custom habits to its children. Generated habits include their owning child
        as `generated_for_child_id` and cannot be assigned to a sibling or edited through this endpoint.
        """
        with transaction(settings, user) as conn:
            one(conn, "SELECT id FROM hq.families WHERE id=%s", (family_id,))
            return conn.execute(
                f"SELECT {COLUMNS},(SELECT child_id FROM hq.generated_habit_details d"
                " WHERE d.habit_id=h.id) AS generated_for_child_id"
                " FROM hq.habits h JOIN hq.goals g ON g.id=h.goal_id"
                " WHERE h.family_id=%s AND h.is_active ORDER BY h.created_at DESC,h.id",
                (family_id,),
            ).fetchall()

    @api.post(
        "/v1/families/{family_id}/habits", status_code=201, tags=["Catalog"], summary="Create a custom habit"
    )
    def create_custom(family_id: UUID, body: CustomHabit, user: User) -> dict:
        """Creates a habit of the family's own under one of the catalog's goals. It suits every age, is open from
        tier 1 and pays the points of a tier 1 habit. Add it to a child with `PUT /v1/children/{id}/plan`, listing
        its goal too. 422 when the goal is unknown or the text is not suitable for children, 409 at the limit
        of 30 custom habits. Custom habits are never sent to the AI provider.
        """
        with transaction(settings, user) as conn:
            one(conn, "SELECT id FROM hq.families WHERE id=%s FOR UPDATE", (family_id,))
            fields = checked(conn, body)
            count = conn.execute(
                "SELECT count(*) AS n FROM hq.habits WHERE family_id=%s AND is_active", (family_id,)
            ).fetchone()["n"]
            if count >= MAX_CUSTOM_HABITS:
                raise HTTPException(409, f"A family can have up to {MAX_CUSTOM_HABITS} custom habits")
            habit_id = CUSTOM_PREFIX + secrets.token_hex(5)
            conn.execute(
                "INSERT INTO hq.habits(id,goal_id,title,description,kid_title,kid_hint,icon,anchor,min_age,max_age,"
                "tier,points,family_id,created_by) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,3,13,1,%s,%s,%s)",
                (
                    habit_id,
                    fields["goal_id"],
                    fields["title"],
                    fields["description"],
                    fields["kid_title"],
                    fields["kid_hint"],
                    fields["icon"],
                    fields["anchor"],
                    CUSTOM_POINTS,
                    family_id,
                    user,
                ),
            )
            return one(
                conn,
                f"SELECT {COLUMNS} FROM hq.habits h JOIN hq.goals g ON g.id=h.goal_id WHERE h.id=%s",
                (habit_id,),
            )

    @api.put("/v1/habits/{habit_id}", tags=["Catalog"], summary="Edit a custom habit")
    def edit_custom(habit_id: str, body: CustomHabit, user: User) -> dict:
        """Changes a custom habit's goal, text, icon or part of the day; children who have it see the change at
        once. Catalog habits cannot be changed (404). 422 as when creating.
        """
        with transaction(settings, user) as conn:
            if conn.execute(
                "SELECT habit_id FROM hq.generated_habit_details WHERE habit_id=%s", (habit_id,)
            ).fetchone():
                raise HTTPException(409, "Generate a new reviewed draft to change this habit's wording")
            fields = checked(conn, body)
            row = conn.execute(
                "UPDATE hq.habits SET goal_id=%s,title=%s,description=%s,kid_title=%s,kid_hint=%s,icon=%s,anchor=%s"
                " WHERE id=%s AND family_id IS NOT NULL AND is_active RETURNING id",
                (
                    fields["goal_id"],
                    fields["title"],
                    fields["description"],
                    fields["kid_title"],
                    fields["kid_hint"],
                    fields["icon"],
                    fields["anchor"],
                    habit_id,
                ),
            ).fetchone()
            if row is None:
                raise HTTPException(404, "Record not found")
            return one(
                conn,
                f"SELECT {COLUMNS} FROM hq.habits h JOIN hq.goals g ON g.id=h.goal_id WHERE h.id=%s",
                (habit_id,),
            )

    @api.delete("/v1/habits/{habit_id}", status_code=204, tags=["Catalog"], summary="Delete a custom habit")
    def delete_custom(habit_id: str, user: User) -> Response:
        """Retires a custom habit: it leaves every child's plan (kept as history, like any removed habit) and
        is no longer offered. Past completions and points stay. Catalog habits cannot be deleted (404).
        """
        with transaction(settings, user) as conn:
            row = conn.execute(
                "UPDATE hq.habits SET is_active=false WHERE id=%s AND family_id IS NOT NULL AND is_active RETURNING id",
                (habit_id,),
            ).fetchone()
            if row is None:
                raise HTTPException(404, "Record not found")
            conn.execute(
                "UPDATE hq.child_habits SET status='removed',ended_on=current_date WHERE habit_id=%s"
                " AND status<>'removed'",
                (habit_id,),
            )
        return Response(status_code=204)

    return api

"""Locally validated drafts, private persistence and atomic parent approval."""

import json
from uuid import UUID, uuid4

import httpx
import openai
import psycopg
import pytest
from conftest import OTHER, PARENT, token
from fastapi.testclient import TestClient
from pydantic import ValidationError

from habitquest_backend import generated_habits as gh
from habitquest_backend import planning_budget
from habitquest_backend.auth import KID
from habitquest_backend.db import transaction
from habitquest_backend.main import create_app
from habitquest_backend.onboarding import MAX_ACTIVE_HABITS
from habitquest_backend.planning_catalog import CatalogRepository


@pytest.fixture
def goal(db):
    repo = CatalogRepository()
    selected = next(g for g in repo.all() if repo.eligible(g.goal_id, 8, "home"))
    db.execute(
        "INSERT INTO hq.goals(id,title,description) VALUES(%s,%s,%s)",
        (selected.goal_id, selected.title, selected.description),
    )
    ref = selected.source_ref
    db.execute(
        "INSERT INTO hq.catalog_goal_sources(goal_id,source_id,concept_id,category_id,catalog_version,record_sha256,snapshot_id) VALUES(%s,%s,%s,%s,%s,%s,%s)",
        (selected.goal_id, *ref.values()),
    )
    yield selected
    db.execute("TRUNCATE hq.users,hq.families CASCADE")
    db.execute("DELETE FROM hq.catalog_goal_sources WHERE goal_id=%s", (selected.goal_id,))
    db.execute("DELETE FROM hq.goals WHERE id=%s", (selected.goal_id,))


@pytest.fixture
def app(settings, db, goal):
    settings.habit_generation_enabled = True
    with TestClient(create_app(settings)) as client:
        client.headers["Authorization"] = "Bearer " + token(settings)
        for user in (PARENT, OTHER):
            db.execute("INSERT INTO hq.users(id,name) VALUES(%s,'Test')", (user,))
        family = client.post(
            "/v1/families", json={"name": "Example", "pin": "1234", "display_name": "Sam", "role": "mother"}
        ).json()["id"]
        child = client.post(f"/v1/families/{family}/children", json={"name": "Alex", "age": 8}).json()["id"]
        yield client, family, child


def make(app, goal, **changes):
    client, _, child = app
    body = {"request_id": str(uuid4()), "setting": "home", "count": 1, **changes}
    return client.post(f"/v1/children/{child}/goals/{goal.goal_id}/habit-drafts", json=body)


def accept(client, batch, **changes):
    return client.post(
        f"/v1/habit-drafts/{batch['id']}/items/{batch['items'][0]['id']}/accept",
        json={
            "pin": "1234",
            "cue_time": "18:00",
            "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            **changes,
        },
    )


def test_fixture_round_trip_rich_details_isolation_and_existing_guards(app, goal, settings, db):
    client, family, child = app
    batch = make(app, goal).json()
    assert batch["status"] == "ready" and batch["outcome"] == "fixture"
    assert batch["logical_calls"] == 0 and batch["provider_attempts"] == {}
    assert batch["source"] == goal.source_ref
    assert client.get(f"/v1/children/{child}/goals/{goal.goal_id}/habit-drafts").json()["batches"][0] == batch
    assert client.get(f"/v1/habit-drafts/{batch['id']}").json() == batch
    assert accept(client, batch, pin="0000").status_code == 403
    accepted = accept(client, batch)
    assert accepted.status_code == 200, accepted.text
    result = accepted.json()
    assert result == accept(client, batch).json()
    habit = result["habit_id"]
    assert habit.startswith("my-ai-")
    detail = client.get(f"/v1/children/{child}/habits/{habit}/details").json()
    assert detail["draft"] == batch["items"][0]["draft"]
    points = db.execute("SELECT points,tier FROM hq.habits WHERE id=%s", (habit,)).fetchone()
    assert points == (10, 1)
    plan = client.get(f"/v1/children/{child}/plan").json()
    assigned = next(h for h in plan["habits"] if h["habit_id"] == habit)
    assert assigned["id"] == result["child_habit_id"] and assigned["icon"].startswith("fluent:")
    kid = {"Authorization": "Bearer " + token(settings, UUID(child), role=KID)}
    visible = client.get(f"/v1/kid/habits/{habit}/details", headers=kid)
    assert visible.status_code == 200 and "parent_guidance" not in visible.text
    assert visible.json()["steps"] == detail["draft"]["steps"]
    assert client.get(f"/v1/habit-drafts/{batch['id']}", headers=kid).status_code == 401
    sibling = client.post(f"/v1/families/{family}/children", json={"name": "Bo", "age": 8}).json()["id"]
    otherkid = {"Authorization": "Bearer " + token(settings, UUID(sibling), role=KID)}
    assert client.get(f"/v1/kid/habits/{habit}/details", headers=otherkid).status_code == 404
    assert (
        client.put(
            f"/v1/children/{sibling}/plan", json={"goals": [goal.goal_id], "habits": [{"habit_id": habit}]}
        ).status_code
        == 422
    )
    assert (
        client.put(f"/v1/habits/{habit}", json={"goal_id": goal.goal_id, "title": "Edited"}).status_code
        == 409
    )
    custom = client.get(f"/v1/families/{family}/habits").json()
    assert custom[0]["generated_for_child_id"] == child
    headers = {"Authorization": "Bearer " + token(settings, OTHER)}
    assert client.get(f"/v1/habit-drafts/{batch['id']}", headers=headers).status_code == 404
    assert client.get(f"/v1/children/{child}/habits/{habit}/details", headers=headers).status_code == 404
    with transaction(settings, OTHER) as conn:
        assert conn.execute("SELECT * FROM hq.habit_draft_batches").fetchall() == []
        assert conn.execute("SELECT * FROM hq.generated_habit_details").fetchall() == []
    with transaction(settings, kid=UUID(child)) as conn, pytest.raises(psycopg.errors.InsufficientPrivilege):
        conn.execute("SELECT * FROM hq.generated_habit_details")
    # Database guards also protect callers bypassing the normal HTTP entry points.
    with transaction(settings, PARENT) as conn, pytest.raises(psycopg.errors.CheckViolation):
        conn.execute("UPDATE hq.habits SET title='changed' WHERE id=%s", (habit,))
    with transaction(settings, PARENT) as conn, pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "INSERT INTO hq.child_habits(child_id,habit_id,cue_time,days) VALUES(%s,%s,'18:00',ARRAY['mon'])",
            (sibling, habit),
        )
    with transaction(settings, PARENT) as conn:
        conn.execute("UPDATE hq.habits SET is_active=false WHERE id=%s", (habit,))
    db.execute("UPDATE hq.child_habits SET status='removed' WHERE habit_id=%s", (habit,))
    assert client.get(f"/v1/kid/habits/{habit}/details", headers=kid).status_code == 404


def test_idempotency_processing_mismatch_and_no_automatic_new_call(app, goal, db, monkeypatch):
    request_id = str(uuid4())
    first = make(app, goal, request_id=request_id).json()
    monkeypatch.setattr(gh, "generate", lambda *a: pytest.fail("Replay cannot generate"))
    assert make(app, goal, request_id=request_id).json() == first
    assert make(app, goal, request_id=request_id, count=2).status_code == 409
    db.execute("UPDATE hq.habit_draft_batches SET status='generating',items='[]' WHERE id=%s", (first["id"],))
    assert make(app, goal, request_id=request_id).json()["status"] == "generating"


@pytest.mark.parametrize("change", ["expiry", "age", "source", "status"])
def test_accept_checks_fresh_state(app, goal, db, change):
    client, _, child = app
    batch = make(app, goal).json()
    if change == "expiry":
        db.execute(
            "UPDATE hq.habit_draft_batches SET expires_at=now()-interval '1 minute' WHERE id=%s",
            (batch["id"],),
        )
        assert client.get(f"/v1/habit-drafts/{batch['id']}").json()["items"] == []
    elif change == "age":
        db.execute("UPDATE hq.children SET age=9 WHERE id=%s", (child,))
    elif change == "source":
        db.execute("UPDATE hq.habit_draft_batches SET source='{}' WHERE id=%s", (batch["id"],))
    else:
        db.execute("UPDATE hq.habit_draft_batches SET status='cancelled' WHERE id=%s", (batch["id"],))
    assert accept(client, batch).status_code == 409


def test_child_change_during_generation_discards_reviewed_result(app, goal, db, monkeypatch):
    original = gh.generate

    def delayed(*args):
        db.execute("UPDATE hq.children SET age=9 WHERE id=%s", (app[2],))
        return original(*args)

    monkeypatch.setattr(gh, "generate", delayed)
    batch = make(app, goal).json()
    assert batch["status"] == "cancelled" and batch["items"] == []


def test_disabled_unknown_missing_and_required_schedule(app, goal, settings):
    client, _, child = app
    assert (
        client.post(
            f"/v1/children/{child}/goals/no-such-goal/habit-drafts", json={"request_id": str(uuid4())}
        ).status_code
        == 404
    )
    batch = make(app, goal).json()
    assert (
        client.post(
            f"/v1/habit-drafts/{batch['id']}/items/{uuid4()}/accept",
            json={"pin": "1234", "cue_time": "18:00", "days": ["mon"]},
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/v1/habit-drafts/{batch['id']}/items/{batch['items'][0]['id']}/accept", json={"pin": "1234"}
        ).status_code
        == 422
    )
    assert accept(client, batch, days=["mon", "mon"]).status_code == 422
    settings.habit_generation_enabled = False
    assert make(app, goal).status_code == 503


def test_duplicate_and_capacity_acceptance_checks(app, goal, db):
    client, _, child = app
    first, second = make(app, goal).json(), make(app, goal).json()
    # Simulate a saved legacy duplicate; normal new batches now reject this earlier.
    second["items"][0]["draft"] = first["items"][0]["draft"]
    db.execute(
        "UPDATE hq.habit_draft_batches SET items=%s WHERE id=%s",
        (psycopg.types.json.Jsonb(second["items"]), second["id"]),
    )
    assert accept(client, first).status_code == 200
    assert accept(client, second).status_code == 409
    batch = make(app, goal, count=2).json()
    assert batch["status"] == "ready" and len(batch["items"]) == 2
    db.execute("UPDATE hq.child_habits SET status='removed' WHERE child_id=%s", (child,))
    batch = make(app, goal).json()
    for (habit,) in db.execute(
        "SELECT id FROM hq.habits WHERE family_id IS NULL LIMIT %s", (MAX_ACTIVE_HABITS,)
    ):
        db.execute(
            "INSERT INTO hq.child_habits(child_id,habit_id,cue_time,days) VALUES(%s,%s,'18:00',ARRAY['mon'])",
            (child, habit),
        )
    assert accept(client, batch).status_code == 409


def test_shared_budget_requires_initialization_and_never_resets(settings, db):
    db.execute("INSERT INTO hq.users(id,name) VALUES(%s,'Test')", (PARENT,))
    remote = settings.model_copy(update={"ai_mode": "openai"})
    db.execute("UPDATE hq.planning_budget SET initialized=false,accounted_usd=.3")
    key = uuid4()
    with transaction(remote, PARENT) as conn:
        assert not planning_budget.reserve(conn, remote, 0.1, key)
    db.execute("UPDATE hq.planning_budget SET initialized=true")
    with transaction(remote, PARENT) as conn:
        assert planning_budget.reserve(conn, remote, 0.1, key)
        assert planning_budget.reserve(conn, remote, 0.1, key)
        assert not planning_budget.reserve(conn, remote, 0.2, key)
        assert not planning_budget.reserve(conn, remote, 0.8)
    assert float(db.execute("SELECT accounted_usd FROM hq.planning_budget").fetchone()[0]) == pytest.approx(
        0.4
    )
    assert planning_budget.generation_reservation(settings, 1000, 2800) > 0
    with transaction(settings, PARENT) as conn:
        assert planning_budget.reserve(conn, settings, 0.8)


def test_enforced_family_credits_refuse_before_generation(app, goal, settings, db, monkeypatch):
    from habitquest_backend import tokenomics

    settings.ai_mode = "openai"
    monkeypatch.setattr(gh, "generate", lambda *a: pytest.fail("Budget denial must prevent calls"))
    original = tokenomics.get_policy(settings)
    tokenomics.update_policy(
        settings,
        original["revision"],
        {"daily_credits": 1, "enforce_budgets": True, "weights": {**original["weights"], "habit_batch": 2}},
    )
    try:
        response = make(app, goal)
        assert response.status_code == 429
        assert "credits" in response.json()["detail"]
        assert db.execute("SELECT count(*) FROM hq.habit_draft_batches").fetchone()[0] == 0
    finally:
        tokenomics.update_policy(
            settings,
            tokenomics.get_policy(settings)["revision"],
            {k: original[k] for k in ("daily_credits", "enforce_budgets", "weights")},
        )


def test_tracking_only_ignores_legacy_reservation_blocker(app, goal, settings, db, monkeypatch):
    from habitquest_backend import tokenomics

    settings.ai_mode = "openai"
    db.execute("UPDATE hq.planning_budget SET initialized=false,accounted_usd=100")
    monkeypatch.setattr(
        gh, "generate", lambda *args: ([gh.fake_output(1).items[0].model_dump()], {}, "fixture")
    )
    result = make(app, goal)
    assert result.status_code == 200 and result.json()["status"] == "ready"
    assert result.json()["tokenomics"]["budget"]["enforced"] is False
    assert db.execute("SELECT accounted_usd FROM hq.planning_budget").fetchone()[0] == 100
    assert tokenomics.family_budget(settings, PARENT, app[1])["used"] == 0


def test_pre_tokenomics_batches_remain_readable_and_replay_without_generation(app, goal, db, monkeypatch):
    client, _, child = app
    request_id = str(uuid4())
    original = make(app, goal, request_id=request_id).json()
    # Simulate a saved draft created before the additive accounting migration.
    db.execute("DELETE FROM hq.ai_operations WHERE child_id=%s", (child,))
    assert "tokenomics" not in client.get(f"/v1/habit-drafts/{original['id']}").json()
    listed = client.get(f"/v1/children/{child}/goals/{goal.goal_id}/habit-drafts").json()["batches"]
    assert len(listed) == 1 and "tokenomics" not in listed[0]
    monkeypatch.setattr(gh, "generate", lambda *args: pytest.fail("Saved drafts must not regenerate"))
    replay = make(app, goal, request_id=request_id)
    assert replay.status_code == 200 and replay.json()["id"] == original["id"]
    assert replay.json()["tokenomics"]["credits"] == 0
    db.execute("DELETE FROM hq.ai_operations WHERE child_id=%s", (child,))
    changed = make(app, goal, request_id=request_id, count=2)
    assert changed.status_code == 409 and "different generation" in changed.json()["detail"]
    assert db.execute("SELECT count(*) FROM hq.habit_draft_batches").fetchone()[0] == 1


class Stub:
    def __init__(self, value):
        self.value = value

    def with_structured_output(self, *a, **kw):
        return self

    def invoke(self, messages):
        if isinstance(self.value, Exception):
            raise self.value
        return self.value


@pytest.mark.parametrize(
    "scenario,calls,outcome",
    [
        ("normal", 1, "ready"),
        ("schema_repair", 2, "ready"),
        ("local_repair", 2, "ready"),
        ("schema_then_unsafe", 2, "unavailable"),
        ("twice_schema", 2, "unavailable"),
        ("writer_down", 1, "unavailable"),
    ],
)
def test_writer_has_one_local_correction_and_no_remote_screening(
    settings, monkeypatch, scenario, calls, outcome
):
    goal = next(g for g in CatalogRepository().all() if CatalogRepository().eligible(g.goal_id, 8, "home"))
    good = gh.fake_output(1)
    unsafe = gh.fake_output(1)
    unsafe.items[0].help_text = "Use a knife."
    values = {
        "normal": [good],
        "schema_repair": [{}, good],
        "local_repair": [unsafe, good],
        "schema_then_unsafe": [{}, unsafe],
        "twice_schema": [{}, {}],
        "writer_down": [RuntimeError()],
    }[scenario]
    seen = []

    def model(*args, **kwargs):
        assert kwargs["role"] == "habit_generation", "Habit generation must never call risk or Safety models"
        seen.append(kwargs["role"])
        return Stub(values.pop(0))

    monkeypatch.setattr(gh.llm, "role_chat_model", model)
    remote = settings.model_copy(update={"ai_mode": "openai"})
    items, metrics, result = gh.generate(remote, goal, 8, gh.GenerateInput(request_id=uuid4()), "", [], [])
    assert result == outcome and metrics["logical_calls"] == calls
    assert bool(items) == (outcome == "ready")
    assert seen == ["habit_generation"] * calls
    assert metrics["validation_mode"] == "local"
    assert "safety_ms" not in metrics["timings"] and "risk_ms" not in metrics["timings"]


def test_fresh_instruction_uses_local_urgent_check_and_one_writer(settings, monkeypatch):
    from habitquest_backend import safety

    repo = CatalogRepository()
    goal = next(g for g in repo.all() if repo.eligible(g.goal_id, 8, "home"))
    body = gh.GenerateInput(request_id=uuid4())
    remote = settings.model_copy(update={"ai_mode": "openai"})
    monkeypatch.setattr(
        safety, "parent_risk_model", lambda *a, **kw: pytest.fail("No remote ParentRisk for bounded habits")
    )
    payloads = []

    class Capture(Stub):
        def invoke(self, messages):
            payloads.append(json.loads(messages[1][1]))
            return self.value

    roles = []

    def model(*args, **kwargs):
        assert kwargs["role"] == "habit_generation"
        roles.append(kwargs["role"])
        return Capture(gh.fake_output(1))

    monkeypatch.setattr(gh.llm, "role_chat_model", model)
    drafts, metrics, outcome = gh.generate(remote, goal, 8, body, "fresh parent words", [], [])
    assert outcome == "ready" and drafts and metrics["logical_calls"] == 1
    assert roles == ["habit_generation"] and payloads[0]["parent_instruction"] == "fresh parent words"
    assert payloads[0]["source"]["safety"] == goal.evidence()["safety"]
    urgent, urgent_metrics, outcome = gh.generate(remote, goal, 8, body, "I want to kill myself", [], [])
    assert not urgent and outcome == "risk_redirect" and urgent_metrics["logical_calls"] == 0
    assert roles == ["habit_generation"]
    assert (
        gh.masked("Alex and Sam alex@site.test 123-456-7890", ["Alex", "Sam", ""])
        == "Person 1 and Person 2 [email] [phone]"
    )


def test_schema_semantics_recurrence_age_duplicates_and_privacy(settings, monkeypatch):
    draft = gh.fake_output(1).items[0].model_dump()
    for updates in (
        {"recurrence": "monthly"},
        {"steps": [""]},
        {"materials": ["x" * 501]},
        {"estimated_seconds": 9},
        {"estimated_seconds": 1801},
    ):
        with pytest.raises(ValidationError):
            gh.HabitDraft.model_validate(draft | updates)
    with pytest.raises(ValueError, match="wrong_count"):
        gh.validate_drafts(gh.fake_output(1), 8, 2, [])
    with pytest.raises(ValueError, match="duplicate_action"):
        gh.validate_drafts(gh.fake_output(1), 8, 1, [gh.action_digest(draft)])
    for updates in ({"steps": ["One", "Two", "Three", "Four"]}, {"help_text": "Read https://example.org"}):
        with pytest.raises(ValueError):
            gh.validate_drafts(
                gh.DraftOutput(items=[gh.HabitDraft.model_validate(draft | updates)]), 4, 1, []
            )
    repo = CatalogRepository()
    goal = next(g for g in repo.all() if repo.eligible(g.goal_id, 8, "home"))
    named = gh.DraftOutput(items=[gh.HabitDraft.model_validate(draft | {"title": "Alex small step"})])
    monkeypatch.setattr(gh.llm, "role_chat_model", lambda *a, **kw: Stub(named))
    assert (
        gh.generate(
            settings.model_copy(update={"ai_mode": "openai"}),
            goal,
            8,
            gh.GenerateInput(request_id=uuid4()),
            "",
            [],
            ["Alex"],
        )[2]
        == "unavailable"
    )


def test_model_raw_usage_parse_failure_and_stage_timing(settings, monkeypatch):
    from langchain_core.messages import AIMessage

    repo = CatalogRepository()
    goal = next(g for g in repo.all() if repo.eligible(g.goal_id, 8, "home"))
    values = [
        {
            "parsed": None,
            "parsing_error": ValueError(),
            "raw": AIMessage(
                content="", usage_metadata={"input_tokens": 10, "output_tokens": 2, "total_tokens": 12}
            ),
        },
        {
            "parsed": gh.fake_output(1),
            "raw": AIMessage(
                content="", usage_metadata={"input_tokens": 20, "output_tokens": 4, "total_tokens": 24}
            ),
        },
    ]
    monkeypatch.setattr(gh.llm, "role_chat_model", lambda *a, **kw: Stub(values.pop(0)))
    items, metrics, outcome = gh.generate(
        settings.model_copy(update={"ai_mode": "openai"}),
        goal,
        8,
        gh.GenerateInput(request_id=uuid4()),
        "",
        [],
        [],
    )
    assert outcome == "ready" and items
    assert metrics["token_usage"] == {"input_tokens": 30, "output_tokens": 6, "total_tokens": 36}
    assert {"writer_ms", "total_ms"} == metrics["timings"].keys()


def test_expired_deadline_and_oversized_context_fail_closed(settings, monkeypatch):
    repo = CatalogRepository()
    goal = next(g for g in repo.all() if repo.eligible(g.goal_id, 8, "home"))
    body = gh.GenerateInput(request_id=uuid4())
    clock = iter([0, 100, 100])
    monkeypatch.setattr(gh, "monotonic", lambda: next(clock))
    assert gh.generate(settings, goal, 8, body, "", [], [])[2] == "unavailable"
    monkeypatch.setattr(gh, "monotonic", lambda: 0)
    assert (
        gh.generate(settings, goal, 8, body, "", [], [], [{"instruction": "x" * 110_000}])[2] == "unavailable"
    )


def test_writer_completion_after_deadline_is_not_saved(settings, monkeypatch):
    repo = CatalogRepository()
    goal = next(g for g in repo.all() if repo.eligible(g.goal_id, 8, "home"))
    now = [0.0]
    monkeypatch.setattr(gh, "monotonic", lambda: now[0])

    class Late(Stub):
        def invoke(self, messages):
            now[0] = 100
            return self.value

    monkeypatch.setattr(
        gh.llm,
        "role_chat_model",
        lambda *a, **kw: Late(gh.fake_output(1)),
    )
    items, metrics, outcome = gh.generate(
        settings.model_copy(update={"ai_mode": "openai"}),
        goal,
        8,
        gh.GenerateInput(request_id=uuid4()),
        "",
        [],
        [],
    )
    assert not items and outcome == "unavailable" and metrics["logical_calls"] == 1


def test_existing_validated_actions_are_in_generation_context(app, goal, monkeypatch):
    first = make(app, goal).json()
    seen = []
    original = gh.generate

    def capture(*args):
        seen.extend(args[-1])
        assert gh.action_digest(first["items"][0]["draft"]) in args[-3]
        return original(*args)

    monkeypatch.setattr(gh, "generate", capture)
    assert make(app, goal).json()["status"] == "ready"
    assert seen[0]["instruction"] == first["items"][0]["draft"]["instruction"]
    assert "content_digest" not in seen[0]


def test_new_writer_batch_cannot_repeat_an_unaccepted_saved_choice(app, goal, settings, monkeypatch):
    first = make(app, goal).json()
    settings.ai_mode = "openai"
    # The writer is replaced; no provider is dispatched or billed.
    repeated = gh.DraftOutput(items=[gh.HabitDraft.model_validate(first["items"][0]["draft"])])
    monkeypatch.setattr(gh.llm, "role_chat_model", lambda *args, **kwargs: Stub(repeated))
    result = make(app, goal).json()
    assert result["status"] == "unavailable" and result["failure_code"] == "duplicate_action"
    assert result["logical_calls"] == 2 and "repeated habits" in result["message"]


def test_fake_batches_append_distinct_choices_beyond_two_prior_batches(app, goal):
    batches = [make(app, goal, count=3).json() for _ in range(4)]
    assert all(batch["status"] == "ready" for batch in batches)
    choices = [gh.action_digest(item["draft"]) for batch in batches for item in batch["items"]]
    assert len(choices) == len(set(choices)) == 12


@pytest.mark.parametrize("change", ["reset", "age"])
def test_hidden_old_choices_do_not_block_new_drafts_but_active_habits_still_do(
    app, goal, settings, db, monkeypatch, change
):
    from habitquest_backend.coach_context import RESET_NOTE

    client, _, child = app
    old = make(app, goal, count=2).json()
    assert accept(client, old).status_code == 200
    if change == "reset":
        db.execute(
            "INSERT INTO hq.coach_messages(child_id,role,content) VALUES(%s,'note',%s)",
            (child, RESET_NOTE),
        )
    else:
        assert CatalogRepository().eligible(goal.goal_id, 7, "home")
        db.execute("UPDATE hq.children SET age=7 WHERE id=%s", (child,))
    assert client.get(f"/v1/habit-drafts/{old['id']}").json()["items"] == []

    approved = gh.DraftOutput(items=[gh.HabitDraft.model_validate(old["items"][0]["draft"])])
    unaccepted = gh.DraftOutput(items=[gh.HabitDraft.model_validate(old["items"][1]["draft"])])
    outputs = [unaccepted, approved, approved]
    settings.ai_mode = "openai"
    monkeypatch.setattr(gh.llm, "role_chat_model", lambda *args, **kwargs: Stub(outputs.pop(0)))

    fresh = make(app, goal).json()
    assert fresh["status"] == "ready" and fresh["logical_calls"] == 1
    assert fresh["items"][0]["draft"] == old["items"][1]["draft"]
    duplicate = make(app, goal).json()
    assert duplicate["status"] == "unavailable" and duplicate["failure_code"] == "duplicate_action"
    assert duplicate["logical_calls"] == 2


def test_daily_schedule_and_deleted_child_do_not_leave_shareable_generated_habits(app, goal, db):
    client, family, child = app
    batch = make(app, goal).json()
    assert accept(client, batch, days=["mon"]).status_code == 422
    accepted = accept(client, batch).json()
    habit = accepted["habit_id"]
    assert db.execute("SELECT generated_child_id FROM hq.habits WHERE id=%s", (habit,)).fetchone()[0] == UUID(
        child
    )
    # Source lineage is exported with reviewed rich content, without credentials.
    exported = client.get(f"/v1/families/{family}/export")
    assert exported.status_code == 200 and habit in exported.text
    db.execute("DELETE FROM hq.children WHERE id=%s", (child,))
    assert db.execute("SELECT 1 FROM hq.habits WHERE id=%s", (habit,)).fetchone() is None
    assert (
        db.execute("SELECT 1 FROM hq.generated_habit_details WHERE habit_id=%s", (habit,)).fetchone() is None
    )


def test_weekly_schedule_and_literal_control_characters(app, goal, monkeypatch):
    original = gh.fake_output

    def weekly(count):
        output = original(count)
        for item in output.items:
            item.recurrence = "weekly"
        return output

    monkeypatch.setattr(gh, "fake_output", weekly)
    assert accept(app[0], make(app, goal).json(), days=["mon", "fri"]).status_code == 200
    draft = original(1)
    draft.items[0].help_text = "This hidden\x01control is not readable."
    with pytest.raises(ValueError):
        gh.validate_drafts(draft, 8, 1, [])


def test_reset_hides_pending_drafts_but_retains_accepted_details(app, goal, db):
    from habitquest_backend.coach_context import RESET_NOTE

    client, _, child = app
    request_id = str(uuid4())
    batch = make(app, goal, request_id=request_id).json()
    accepted = accept(client, batch).json()
    db.execute(
        "INSERT INTO hq.coach_messages(child_id,role,content) VALUES(%s,'note',%s)", (child, RESET_NOTE)
    )
    assert client.get(f"/v1/habit-drafts/{batch['id']}").json()["items"] == []
    assert (
        client.get(f"/v1/children/{child}/goals/{goal.goal_id}/habit-drafts").json()["batches"][0]["outcome"]
        == "stale_context"
    )
    assert make(app, goal, request_id=request_id).json()["status"] == "cancelled"
    assert client.get(f"/v1/children/{child}/habits/{accepted['habit_id']}/details").status_code == 200


def test_inactive_goal_during_generation_prevents_display(app, goal, db, monkeypatch):
    original = gh.generate

    def delayed(*args):
        db.execute("UPDATE hq.goals SET is_active=false WHERE id=%s", (goal.goal_id,))
        return original(*args)

    monkeypatch.setattr(gh, "generate", delayed)
    batch = make(app, goal).json()
    assert batch["status"] == "cancelled" and batch["items"] == []


def test_repair_receives_specific_safe_schema_feedback_and_records_codes(settings, monkeypatch, caplog):
    repo = CatalogRepository()
    goal = next(g for g in repo.all() if repo.eligible(g.goal_id, 8, "home"))
    raw = gh.fake_output(1).model_dump()
    raw["items"][0]["kid_hint"] = "PRIVATE-DRAFT-TEXT " * 20
    try:
        gh.DraftOutput.model_validate(raw)
    except ValidationError as failure:
        schema_error = failure
    values = [
        {"raw": None, "parsed": None, "parsing_error": schema_error},
        gh.fake_output(1),
    ]
    requests = []

    class Capture(Stub):
        def invoke(self, messages):
            requests.append(json.loads(messages[1][1]))
            return self.value

    monkeypatch.setattr(gh.llm, "role_chat_model", lambda *a, **kw: Capture(values.pop(0)))
    _, metrics, outcome = gh.generate(
        settings.model_copy(update={"ai_mode": "openai"}),
        goal,
        8,
        gh.GenerateInput(request_id=uuid4()),
        "",
        [],
        [],
    )
    assert outcome == "ready" and metrics["failure_code"] is None
    assert metrics["validation_failures"] == [
        {
            "attempt": 1,
            "stage": "writer",
            "code": "schema_invalid",
            "fields": ["items.0.kid_hint"],
            "error_types": ["string_too_long"],
        }
    ]
    assert "items.0.kid_hint" in requests[1]["correction"][0]
    assert "PRIVATE-DRAFT-TEXT" not in json.dumps(requests) + str(metrics) + caplog.text


def test_twice_rejected_child_copy_reports_actionable_rule(settings, monkeypatch):
    repo = CatalogRepository()
    goal = next(g for g in repo.all() if repo.eligible(g.goal_id, 8, "home"))
    draft = gh.fake_output(1)
    draft.items[0].instruction = "Manage your emotions."
    requests = []

    class Capture(Stub):
        def invoke(self, messages):
            requests.append(json.loads(messages[1][1]))
            return self.value

    monkeypatch.setattr(gh.llm, "role_chat_model", lambda *a, **kw: Capture(draft))
    items, metrics, outcome = gh.generate(
        settings.model_copy(update={"ai_mode": "openai"}),
        goal,
        8,
        gh.GenerateInput(request_id=uuid4()),
        "",
        [],
        [],
    )
    assert outcome == "unavailable" and not items
    assert metrics["failure_code"] == "instruction_needs_a_named_activity"
    assert [issue["attempt"] for issue in metrics["validation_failures"]] == [1, 2]
    assert "specific physical or communication activity" in requests[1]["correction"][0]


def test_local_safety_and_markup_have_distinct_safe_codes():
    for text, code in [
        ("Use a knife.", "local_safety_rejected"),
        ("Read <b>this</b>.", "display_markup_rejected"),
    ]:
        draft = gh.fake_output(1)
        draft.items[0].help_text = text
        with pytest.raises(ValueError, match=code):
            gh.validate_drafts(draft, 8, 1, [])


def test_canonical_browsing_and_direct_generation_do_not_materialize_goals(app, goal, db, monkeypatch):
    client, _, child = app
    repo = CatalogRepository()
    unselected = next(
        g for g in repo.all() if g.goal_id != goal.goal_id and repo.eligible(g.goal_id, 8, "home")
    )
    before = db.execute("SELECT count(*) FROM hq.goals").fetchone()[0]
    monkeypatch.setattr(
        gh, "generate", lambda *args: pytest.fail("Unselected source cannot invoke generation")
    )
    read = client.get(f"/v1/children/{child}/goals/{unselected.goal_id}/source", params={"setting": "home"})
    assert read.status_code == 200, read.text
    assert read.json()["source_ref"] == unselected.source_ref
    drafts = client.get(f"/v1/children/{child}/goals/{unselected.goal_id}/habit-drafts")
    assert drafts.json() == {"batches": []}
    response = make(app, unselected)
    assert response.status_code == 404
    assert "reviewed goal recommendation" in response.json()["detail"]
    assert db.execute("SELECT count(*) FROM hq.goals").fetchone()[0] == before
    assert (
        db.execute("SELECT 1 FROM hq.catalog_goal_sources WHERE goal_id=%s", (unselected.goal_id,)).fetchone()
        is None
    )
    assert (
        db.execute("SELECT 1 FROM hq.habit_draft_batches WHERE goal_id=%s", (unselected.goal_id,)).fetchone()
        is None
    )


def test_generation_keeps_age_and_existing_provenance_guards(app, goal, db, monkeypatch):
    monkeypatch.setattr(gh, "generate", lambda *args: pytest.fail("Invalid source cannot invoke generation"))
    db.execute("UPDATE hq.children SET age=13 WHERE id=%s", (app[2],))
    assert make(app, goal).status_code == 403
    db.execute("UPDATE hq.children SET age=8 WHERE id=%s", (app[2],))
    db.execute(
        "UPDATE hq.catalog_goal_sources SET record_sha256=%s WHERE goal_id=%s", ("0" * 64, goal.goal_id)
    )
    assert make(app, goal).status_code == 409


def test_request_masks_names_and_contacts_before_single_writer(app, goal, monkeypatch):
    captured = []
    original = gh.generate

    def capture(*args):
        captured.append(args[4])
        return original(*args)

    monkeypatch.setattr(gh, "generate", capture)
    response = make(
        app, goal, parent_instruction="Alex can practice with Sam; reach sam@example.test or 123-456-7890."
    )
    assert response.status_code == 200 and response.json()["validation_mode"] == "local"
    assert len(captured) == 1
    assert "Alex" not in captured[0] and "Sam" not in captured[0] and "sam@example.test" not in captured[0]
    assert "123-456-7890" not in captured[0] and "[email]" in captured[0] and "[phone]" in captured[0]
    assert "local checks" in response.json()["message"] or response.json()["outcome"] == "fixture"


@pytest.mark.parametrize("field", ["kid_hint", "parent_setup", "help_text"])
def test_local_contact_guard_covers_every_display_audience(field):
    draft = gh.fake_output(1)
    setattr(draft.items[0], field, "Email me at private@example.test.")
    with pytest.raises(ValueError, match="local_safety_rejected"):
        gh.validate_drafts(draft, 8, 1, [])


def test_three_distinct_habits_keep_icons_and_reach_child_today(app, goal, settings, monkeypatch):
    client, _, child = app
    original = gh.fake_output
    icons = ["pencil", "book", "speech_balloon"]

    def illustrated(count):
        output = original(count)
        for draft, icon in zip(output.items, icons):
            draft.emoji_key = icon
        return output

    monkeypatch.setattr(gh, "fake_output", illustrated)
    batch = make(app, goal, count=3).json()
    assert len(batch["items"]) == 3
    accepted_ids = []
    for item in batch["items"]:
        result = accept(client, {**batch, "items": [item]})
        assert result.status_code == 200
        accepted_ids.append(result.json()["habit_id"])
    plan = client.get(f"/v1/children/{child}/plan").json()
    assert {h["habit_id"] for h in plan["habits"]} == set(accepted_ids)
    assert {h["icon"] for h in plan["habits"]} == {"fluent:" + icon for icon in icons}
    kid = {"Authorization": "Bearer " + token(settings, UUID(child), role=KID)}
    today = client.get("/v1/kid/today", headers=kid).json()
    assert {h["habit_id"] for h in today["habits"]} == set(accepted_ids)
    for habit_id in accepted_ids:
        detail = client.get(f"/v1/kid/habits/{habit_id}/details", headers=kid).json()
        assert detail["steps"] and detail["goal_id"] == goal.goal_id
        assert "parent_guidance" not in detail and "parent_setup" not in detail


def test_habit_on_another_day_stays_in_child_plan_but_cannot_be_completed(
    app, goal, settings, monkeypatch, db
):
    client, _, child = app
    original = gh.fake_output

    def weekly(count):
        output = original(count)
        for item in output.items:
            item.recurrence = "weekly"
        return output

    monkeypatch.setattr(gh, "fake_output", weekly)
    today = db.execute("SELECT to_char(hq.child_today(%s),'dy')", (child,)).fetchone()[0]
    other_day = "mon" if today != "mon" else "tue"
    assigned = accept(client, make(app, goal).json(), days=[other_day]).json()
    kid = {"Authorization": "Bearer " + token(settings, UUID(child), role=KID)}
    result = client.get("/v1/kid/today", headers=kid).json()
    assert result["habits"] == []
    assert [h["habit_id"] for h in result["upcoming_habits"]] == [assigned["habit_id"]]
    assert result["upcoming_habits"][0]["days"] == [other_day]
    assert "parent_setup" not in str(result) and "description" not in result["upcoming_habits"][0]
    assert (
        client.post(
            "/v1/kid/completions", json={"child_habit_id": assigned["child_habit_id"]}, headers=kid
        ).status_code
        == 404
    )


@pytest.mark.parametrize("needs_correction", [False, True])
def test_device_parking_source_returns_three_practices_without_false_pause_rejection(
    settings, monkeypatch, needs_correction
):
    goal = next(
        g for g in CatalogRepository().all() if g.source_id == "screen-balance--shared-device-parking--a11-13"
    )
    output = gh.fake_output(3)
    practices = [
        (
            "Park my device",
            "Save your video and place your device in the agreed spot.",
            ["Save your place in the video.", "Pause the video.", "Put your device in the agreed spot."],
            "You paused the video and parked your device.",
            "basket",
        ),
        (
            "Use a meal cue",
            "Pause your game when the agreed meal begins.",
            ["Notice the agreed meal cue.", "Save your game.", "Pause your game for the meal."],
            "You paused your game for the agreed meal.",
            "plate",
        ),
        (
            "Check essential access",
            "Check that your needed communication stays available before parking your device.",
            ["Check which communication you need.", "Tell your adult what must stay available."],
            "You checked that needed communication stays available.",
            "speech_balloon",
        ),
    ]
    for item, (title, instruction, steps, completion, icon) in zip(output.items, practices):
        item.title = item.kid_title = title
        item.instruction, item.steps, item.completion, item.emoji_key = instruction, steps, completion, icon
    rejected = output.model_copy(deep=True)
    rejected.items[0].completion = "You paused the activity."
    values = [rejected, output] if needs_correction else [output]
    monkeypatch.setattr(gh.llm, "role_chat_model", lambda *args, **kw: Stub(values.pop(0)))
    drafts, metrics, outcome = gh.generate(
        settings.model_copy(update={"ai_mode": "openai"}),
        goal,
        12,
        gh.GenerateInput(request_id=uuid4(), setting="online", count=3),
        "",
        [],
        [],
    )
    assert outcome == "ready" and len(drafts) == 3
    assert len({gh.action_digest(item) for item in drafts}) == 3
    assert len({item["emoji_key"] for item in drafts}) == 3
    assert metrics["logical_calls"] == (2 if needs_correction else 1)
    assert metrics["failure_code"] is None
    assert len(metrics["validation_failures"]) == int(needs_correction)


@pytest.mark.parametrize(
    "error,code",
    [
        (TimeoutError("private detail"), "generation_timeout"),
        (
            openai.APITimeoutError(request=httpx.Request("POST", "https://provider.invalid")),
            "generation_timeout",
        ),
        (
            openai.APIConnectionError(request=httpx.Request("POST", "https://provider.invalid")),
            "provider_unavailable",
        ),
        (RuntimeError("private detail"), "generation_error"),
    ],
)
def test_provider_failures_have_safe_specific_diagnostics(settings, monkeypatch, caplog, error, code):
    goal = next(g for g in CatalogRepository().all() if CatalogRepository().eligible(g.goal_id, 8, "home"))
    monkeypatch.setattr(gh.llm, "role_chat_model", lambda *args, **kw: Stub(error))
    drafts, metrics, outcome = gh.generate(
        settings.model_copy(update={"ai_mode": "openai"}),
        goal,
        8,
        gh.GenerateInput(request_id=uuid4()),
        "",
        [],
        [],
    )
    assert outcome == "unavailable" and not drafts
    assert metrics["failure_code"] == code and metrics["logical_calls"] == 1
    assert "private detail" not in caplog.text + str(metrics) + gh.unavailable_message(metrics)


@pytest.mark.parametrize(
    "code,text",
    [
        ("duplicate_action", "repeated habits"),
        ("completion_includes_nonparticipation", "clear completed practice"),
        ("schema_invalid", "wording or format"),
        (None, "did not finish"),
    ],
)
def test_failed_batches_explain_cause_without_discarding_saved_drafts(app, goal, monkeypatch, db, code, text):
    saved = make(app, goal).json()
    monkeypatch.setattr(gh, "generate", lambda *args: ([], {"failure_code": code}, "unavailable"))
    failed = make(app, goal).json()
    assert failed["status"] == "unavailable" and text in failed["message"]
    client, _, child = app
    db.execute(
        "UPDATE hq.habit_draft_batches SET message=%s WHERE id=%s",
        ("I couldn't finish checking these habits. Please try a new request.", failed["id"]),
    )
    reread = client.get(f"/v1/habit-drafts/{failed['id']}").json()
    assert reread["message"] == failed["message"]
    assert (
        db.execute("SELECT message FROM hq.habit_draft_batches WHERE id=%s", (failed["id"],))
        .fetchone()[0]
        .startswith("I couldn't finish checking")
    )
    batches = client.get(f"/v1/children/{child}/goals/{goal.goal_id}/habit-drafts").json()["batches"]
    assert any(batch["id"] == saved["id"] and batch["items"] == saved["items"] for batch in batches)

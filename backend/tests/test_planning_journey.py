"""One no-network journey across source goals, reviewed habits and the existing daily loop."""

from uuid import UUID, uuid4

import pytest
from conftest import PARENT, token
from fastapi.testclient import TestClient

from habitquest_backend.auth import KID
from habitquest_backend.main import create_app
from habitquest_backend.planning_catalog import CatalogRepository


@pytest.fixture
def canonical_catalog(db):
    """No bulk import: remove only goals selected during this synthetic journey."""
    before = {row[0] for row in db.execute("SELECT id FROM hq.goals").fetchall()}
    repository = CatalogRepository()
    yield repository
    added = [row[0] for row in db.execute("SELECT id FROM hq.goals").fetchall() if row[0] not in before]
    db.execute("DELETE FROM hq.catalog_goal_sources WHERE goal_id=ANY(%s)", (added,))
    db.execute("DELETE FROM hq.goals WHERE id=ANY(%s)", (added,))


@pytest.fixture
def journey(settings, db, canonical_catalog):
    settings.coach_engine = "refined"
    settings.retrieval_mode = "fixture"
    settings.habit_generation_enabled = True
    db.execute("INSERT INTO hq.users(id,name) VALUES(%s,'Test parent')", (PARENT,))
    with TestClient(create_app(settings)) as client:
        client.headers["Authorization"] = "Bearer " + token(settings)
        family = client.post(
            "/v1/families",
            json={"name": "Planning journey", "pin": "1234", "display_name": "Sam", "role": "mother"},
        ).json()["id"]
        child = client.post(f"/v1/families/{family}/children", json={"name": "Alex", "age": 8}).json()["id"]
        yield client, family, child, canonical_catalog
    # Family/child-owned accepted habits disappear before removing newly selected source goals.
    db.execute("DELETE FROM hq.families WHERE id=%s", (family,))
    db.execute("DELETE FROM hq.users WHERE id=%s", (PARENT,))


def test_source_goal_to_earned_habit_survives_reload_reset_and_export(journey, settings, db):
    client, family, child, repository = journey
    before = {row[0] for row in db.execute("SELECT id FROM hq.goals").fetchall()}
    response = client.post(
        f"/v1/children/{child}/coach/messages",
        json={"text": "Alex struggles to settle down at bedtime before sleep.", "setting": "home"},
    )
    assert response.status_code == 200, response.text
    coached = response.json()
    assert coached["reply"].startswith("Local preview:")
    assert coached["logical_calls"] == 0 and coached["provider_attempts"] == {}
    assert coached["risk_status"] == "local_only"
    assert coached["goal_recommendations"] and not coached["suggestions"]
    selected = {card["goal_id"] for card in coached["goal_recommendations"]}
    after = {row[0] for row in db.execute("SELECT id FROM hq.goals").fetchall()}
    assert after - before == selected - before
    assert len(after - before) <= 4
    card = coached["goal_recommendations"][0]
    goal = repository.get(card["goal_id"])
    assert card["source_ref"] == goal.source_ref and card["setting"] == "home"
    assert client.get(f"/v1/children/{child}/plan").json()["habits"] == []

    source = client.get(
        f"/v1/children/{child}/goals/{goal.goal_id}/source", params={"setting": "home"}
    ).json()
    assert source["source_ref"] == goal.source_ref
    assert source["research"] and source["practice"] and source["safety"]
    drafts_url = f"/v1/children/{child}/goals/{goal.goal_id}/habit-drafts"
    assert client.get(drafts_url).json()["batches"] == []
    generated = client.post(drafts_url, json={"request_id": str(uuid4()), "setting": "home", "count": 2})
    assert generated.status_code == 200, generated.text
    batch = generated.json()
    assert batch["status"] == "ready" and batch["outcome"] == "fixture"
    assert batch["logical_calls"] == 0 and batch["provider_attempts"] == {}
    assert batch["source"] == card["source_ref"]
    assert len(batch["items"]) == 2
    assert client.get(f"/v1/children/{child}/plan").json()["habits"] == []
    item = batch["items"][0]
    accept_url = f"/v1/habit-drafts/{batch['id']}/items/{item['id']}/accept"
    decision = {"pin": "1234", "cue_time": "18:00", "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]}
    assert client.post(accept_url, json={**decision, "pin": "0000"}).status_code == 403
    accepted_response = client.post(accept_url, json=decision)
    assert accepted_response.status_code == 200, accepted_response.text
    accepted = accepted_response.json()
    habit = accepted["habit_id"]
    assert accepted["goal_id"] == goal.goal_id
    assert client.post(accept_url, json=decision).json() == accepted
    plan = client.get(f"/v1/children/{child}/plan").json()
    assert [h["habit_id"] for h in plan["habits"]] == [habit]

    kid = {"Authorization": "Bearer " + token(settings, UUID(child), role=KID)}
    kid_detail = client.get(f"/v1/kid/habits/{habit}/details", headers=kid).json()
    assert kid_detail["steps"] == item["draft"]["steps"]
    assert kid_detail["completion"] == item["draft"]["completion"]
    assert "parent_guidance" not in kid_detail
    today = client.get("/v1/kid/today", headers=kid).json()
    assert len(today["habits"]) == 1
    assert today["habits"][0]["habit_id"] == habit and today["habits"][0]["points"] == 10
    assert (today["points"], today["progress"]["sparks"]) == (0, 0)
    submitted = client.post(
        "/v1/kid/completions", json={"child_habit_id": accepted["child_habit_id"]}, headers=kid
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["habits"][0]["status"] == "submitted"
    approvals = client.get(f"/v1/families/{family}/approvals").json()
    assert len(approvals) == 1 and approvals[0]["habit_id"] == habit
    approved = client.post(f"/v1/completions/{approvals[0]['completion_id']}/approve").json()
    assert approved["completion"]["status"] == "approved"
    assert (approved["points"], approved["progress"]["sparks"]) == (10, 1)

    exported = client.get(f"/v1/families/{family}/export").json()["children"][0]
    assert exported["goal_recommendations"][0]["source_ref"] == goal.source_ref
    assert exported["habit_drafts"][0]["source"] == goal.source_ref
    assert exported["generated_habit_details"][0]["draft"] == item["draft"]
    assert exported["generated_habit_details"][0]["source"] == goal.source_ref

    # A new application instance has no in-memory thread cache or request state.
    with TestClient(create_app(settings)) as reloaded:
        reloaded.headers["Authorization"] = "Bearer " + token(settings)
        context = reloaded.get(f"/v1/families/{family}/coach-context").json()["children"][child]
        assert context["goal_recommendations"][0]["id"] == card["id"]
        detail_url = f"/v1/children/{child}/habits/{habit}/details"
        detail = reloaded.get(detail_url).json()
        assert detail["source"] == goal.source_ref and detail["draft"] == item["draft"]
        assert reloaded.delete(f"/v1/children/{child}/coach/messages").status_code == 204
        cleared = reloaded.get(f"/v1/children/{child}/coach/messages").json()
        assert cleared == {"messages": [], "suggestions": [], "goal_recommendations": []}
        assert reloaded.get(detail_url).json() == detail
        assert [h["habit_id"] for h in reloaded.get(f"/v1/children/{child}/plan").json()["habits"]] == [habit]
        remaining = f"/v1/habit-drafts/{batch['id']}/items/{batch['items'][1]['id']}/accept"
        assert reloaded.post(remaining, json=decision).status_code == 409
        after = reloaded.get("/v1/kid/today", headers=kid).json()
        assert (after["points"], after["progress"]["sparks"]) == (10, 1)
        assert after["habits"][0]["status"] == "approved"
        saved = reloaded.get(f"/v1/families/{family}/export").json()["children"][0]
        assert saved["goal_recommendations"] == []
        assert saved["generated_habit_details"][0]["source"] == goal.source_ref
        assert saved["generated_habit_details"][0]["draft"] == item["draft"]
        assert saved["habit_drafts"][0]["items"][0]["accepted_habit_id"] == habit
        assert saved["points"][0]["amount"] == 10


def test_goal_links_remain_exact_across_children_goals_and_restore(journey, settings, db):
    """Goal order and independently saved goals never determine an approved habit's parent."""
    client, family, child, repository = journey
    sibling = client.post(f"/v1/families/{family}/children", json={"name": "Bo", "age": 8}).json()["id"]
    coached = client.post(
        f"/v1/children/{child}/coach/messages",
        json={"text": "Homework is hard to start. Small ways to ask for help would help.", "setting": "home"},
    ).json()
    goals = [repository.get(card["goal_id"]) for card in coached["goal_recommendations"][:3]]
    assert len(goals) == 3
    decision = {"pin": "1234", "cue_time": "18:00", "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]}
    assigned = {}
    for who, goal in [(child, goals[1]), (child, goals[0]), (sibling, goals[0])]:
        drafted = client.post(
            f"/v1/children/{who}/goals/{goal.goal_id}/habit-drafts",
            json={"request_id": str(uuid4()), "setting": "home", "count": 1},
        )
        assert drafted.status_code == 200, drafted.text
        batch = drafted.json()
        accepted = client.post(
            f"/v1/habit-drafts/{batch['id']}/items/{batch['items'][0]['id']}/accept", json=decision
        )
        assert accepted.status_code == 200, accepted.text
        assigned[(who, goal.goal_id)] = accepted.json()
    # A third, intentionally empty saved goal must not acquire somebody else's habit.
    saved = client.patch(
        f"/v1/children/{child}/goals/{goals[2].goal_id}", json={"status": "active", "setting": "home"}
    )
    assert saved.status_code == 200
    legacy = client.post(f"/v1/children/{child}/habits", json={"habit_id": "dinner", "pin": "1234"})
    assert legacy.status_code == 200

    def assert_links(who):
        expected = {
            record["habit_id"]: goal_id for (owner, goal_id), record in assigned.items() if owner == who
        }
        if who == child:
            expected["dinner"] = "meals"
        plan = client.get(f"/v1/children/{who}/plan").json()
        assert {h["habit_id"]: h["goal_id"] for h in plan["habits"]} == expected
        by_goal = {g["goal_id"]: g for g in plan["goals"]}
        for habit, goal_id in expected.items():
            assert by_goal[goal_id]["status"] == "active"
            assert habit in {option["id"] for option in by_goal[goal_id]["options"]}
            assert all(option["goal_id"] == goal_id for option in by_goal[goal_id]["options"])
            if habit == "dinner":
                continue
            parent = client.get(f"/v1/children/{who}/habits/{habit}/details").json()
            kid = client.get(
                f"/v1/kid/habits/{habit}/details",
                headers={"Authorization": "Bearer " + token(settings, UUID(who), role=KID)},
            ).json()
            goal = repository.get(goal_id)
            assert parent["goal_id"] == kid["goal_id"] == goal_id
            assert parent["source"] == goal.source_ref
            assert kid["steps"] == parent["draft"]["steps"]
            assert db.execute(
                "SELECT h.goal_id,d.goal_id,b.goal_id,d.child_id,b.child_id FROM hq.habits h"
                " JOIN hq.generated_habit_details d ON d.habit_id=h.id"
                " JOIN hq.habit_draft_batches b ON b.id=d.batch_id WHERE h.id=%s",
                (habit,),
            ).fetchone() == (goal_id, goal_id, goal_id, UUID(who), UUID(who))
        if who == child:
            assert by_goal[goals[2].goal_id]["status"] == "active"
            assert by_goal[goals[2].goal_id]["options"] == []
        return plan

    assert_links(child)
    sibling_plan = assert_links(sibling)
    source_habit = assigned[(child, goals[0].goal_id)]["habit_id"]
    assert (
        client.post(
            f"/v1/children/{sibling}/habits", json={"habit_id": source_habit, "pin": "1234"}
        ).status_code
        == 422
    )
    # Removing one goal removes only its own child's assignments. Restoring the reviewed
    # habit activates its exact parent goal again, even after the conversation is reset.
    dropped = client.patch(
        f"/v1/children/{child}/goals/{goals[0].goal_id}", json={"status": "dropped", "setting": "home"}
    ).json()
    assert {h["habit_id"] for h in dropped["habits"]} == {
        "dinner",
        assigned[(child, goals[1].goal_id)]["habit_id"],
    }
    assert client.get(f"/v1/children/{sibling}/plan").json() == sibling_plan
    assert client.delete(f"/v1/children/{child}/coach/messages").status_code == 204
    restored = client.post(f"/v1/children/{child}/habits", json={"habit_id": source_habit, **decision})
    assert restored.status_code == 200, restored.text
    assert_links(child)
    assert_links(sibling)

"""Incremental goal and habit edits preserve history, ownership and plan capacity."""

from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

import pytest
from conftest import OTHER, token
from test_generated_habits import accept, make
from test_generated_habits import app as app
from test_generated_habits import goal as goal

from habitquest_backend import generated_habits as gh
from habitquest_backend.auth import KID


def add(client, child, habit="water", **changes):
    return client.post(f"/v1/children/{child}/habits", json={"habit_id": habit, "pin": "1234", **changes})


def test_save_drop_restore_goal_and_habits_preserves_history(app, goal, db, settings):
    client, _, child = app
    path = f"/v1/children/{child}/goals/{goal.goal_id}"
    saved = client.patch(path, json={"status": "active"})
    assert saved.status_code == 200
    assert saved.json()["goals"][0]["goal_id"] == goal.goal_id
    assert saved.json()["habits"] == []
    assert saved.json()["capacity"] == {"limit": 6, "used": 0, "remaining": 6}
    batch = make(app, goal).json()
    accepted = accept(client, batch).json()
    habit, assignment = accepted["habit_id"], accepted["child_habit_id"]
    assert client.patch(path, json={"status": "dropped"}).json()["habits"] == []
    assert db.execute("SELECT status FROM hq.child_habits WHERE id=%s", (assignment,)).fetchone() == (
        "removed",
    )
    assert db.execute(
        "SELECT count(*) FROM hq.generated_habit_details WHERE habit_id=%s", (habit,)
    ).fetchone() == (1,)
    kid = {"Authorization": "Bearer " + token(settings, UUID(child), role=KID)}
    assert client.get(f"/v1/kid/habits/{habit}/details", headers=kid).status_code == 404
    assert client.patch(path, json={"status": "active"}).json()["habits"] == []
    restored = add(client, child, habit)
    assert restored.status_code == 200, restored.text
    new_assignment = restored.json()["habits"][0]["id"]
    assert new_assignment != assignment
    assert restored.json()["capacity"]["used"] == 1
    assert client.get(f"/v1/kid/habits/{habit}/details", headers=kid).status_code == 200
    assert (
        client.get(f"/v1/children/{child}/habits/{habit}/details").json()["draft"]
        == batch["items"][0]["draft"]
    )
    assert db.execute("SELECT count(*) FROM hq.child_habits WHERE habit_id=%s", (habit,)).fetchone() == (2,)


def test_reaccept_removed_draft_returns_current_assignment_without_new_habit(app, goal, db):
    client, _, child = app
    batch = make(app, goal).json()
    first = accept(client, batch).json()
    client.patch(f"/v1/child-habits/{first['child_habit_id']}", json={"status": "removed"})
    db.execute(
        "UPDATE hq.habit_draft_batches SET expires_at=now()-interval '1 hour' WHERE id=%s", (batch["id"],)
    )
    second = accept(client, batch)
    assert second.status_code == 200, second.text
    assert second.json()["habit_id"] == first["habit_id"]
    assert second.json()["child_habit_id"] != first["child_habit_id"]
    assert accept(client, batch).json() == second.json()
    assert len(client.get(f"/v1/children/{child}/plan").json()["habits"]) == 1
    assert db.execute("SELECT count(*) FROM hq.generated_habit_details").fetchone() == (1,)


def test_capacity_is_visible_and_remove_frees_a_slot(app, db):
    client, _, child = app
    choices = [
        row[0]
        for row in db.execute(
            "SELECT id FROM hq.habits WHERE family_id IS NULL AND tier=1 AND min_age<=8 AND max_age>=8 ORDER BY id LIMIT 7"
        )
    ]
    for habit in choices[:6]:
        assert add(client, child, habit).status_code == 200
    full = client.get(f"/v1/children/{child}/plan").json()
    assert full["capacity"] == {"limit": 6, "used": 6, "remaining": 0}
    denied = add(client, child, choices[6])
    assert denied.status_code == 409 and "Remove a habit" in denied.json()["detail"]
    first = full["habits"][0]
    assert client.patch(f"/v1/child-habits/{first['id']}", json={"status": "paused"}).status_code == 200
    assert add(client, child, first["habit_id"], cue_time="17:25", days=["fri"]).status_code == 200
    assert len(client.get(f"/v1/children/{child}/plan").json()["habits"]) == 6
    freed = client.patch(f"/v1/child-habits/{first['id']}", json={"status": "removed"})
    assert freed.json()["capacity"]["remaining"] == 1
    assert add(client, child, choices[6]).status_code == 200


def test_concurrent_adds_share_the_six_habit_limit(app, db):
    client, _, child = app
    choices = [
        row[0]
        for row in db.execute(
            "SELECT id FROM hq.habits WHERE family_id IS NULL AND tier=1 AND min_age<=8 AND max_age>=8 ORDER BY id LIMIT 7"
        )
    ]
    for habit in choices[:5]:
        assert add(client, child, habit).status_code == 200
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda habit: add(client, child, habit).status_code, choices[5:]))
    assert sorted(results) == [200, 409]
    assert client.get(f"/v1/children/{child}/plan").json()["capacity"]["used"] == 6


def test_new_plan_endpoints_require_parent_ownership_and_pin(app, goal, settings):
    client, _, child = app
    endpoints = [
        ("PATCH", f"/v1/children/{child}/goals/{goal.goal_id}", {"status": "active"}),
        ("POST", f"/v1/children/{child}/habits", {"habit_id": "water", "pin": "1234"}),
    ]
    for method, path, body in endpoints:
        assert (
            client.request(
                method, path, json=body, headers={"Authorization": "Bearer " + token(settings, OTHER)}
            ).status_code
            == 404
        )
        assert (
            client.request(
                method,
                path,
                json=body,
                headers={"Authorization": "Bearer " + token(settings, UUID(child), role=KID)},
            ).status_code
            == 401
        )
    assert add(client, child, pin="0000").status_code == 403
    assert add(client, child, pin=None).status_code == 403
    assert add(client, child, pin="bad").status_code == 422


@pytest.mark.parametrize("change,expected", [("unknown", 404), ("age", 422), ("tier", 422), ("retired", 404)])
def test_existing_habit_rechecks_current_eligibility(app, db, change, expected):
    client, _, child = app
    habit = "water"
    if change == "unknown":
        habit = "missing"
    elif change == "age":
        db.execute("UPDATE hq.habits SET min_age=10 WHERE id='water'")
    elif change == "tier":
        db.execute("UPDATE hq.habits SET tier=3 WHERE id='water'")
    else:
        db.execute("UPDATE hq.habits SET is_active=false WHERE id='water'")
    assert add(client, child, habit).status_code == expected


def test_generated_restoration_cannot_target_sibling_or_stale_source(app, goal, db):
    client, family, child = app
    accepted = accept(client, make(app, goal).json()).json()
    habit = accepted["habit_id"]
    sibling = client.post(f"/v1/families/{family}/children", json={"name": "Sibling", "age": 8}).json()["id"]
    assert add(client, sibling, habit).status_code == 422
    sibling_plan = client.patch(
        f"/v1/children/{sibling}/goals/{goal.goal_id}", json={"status": "active"}
    ).json()
    assert sibling_plan["goals"][0]["options"] == []
    assert add(client, child, habit, days=["mon"]).status_code == 422
    db.execute("UPDATE hq.generated_habit_details SET source='{}' WHERE habit_id=%s", (habit,))
    assert add(client, child, habit).status_code == 409


def test_restore_cannot_duplicate_a_newer_accepted_action(app, goal, db):
    client, _, child = app
    original = accept(client, make(app, goal).json()).json()
    client.patch(f"/v1/child-habits/{original['child_habit_id']}", json={"status": "removed"})
    newer = accept(client, make(app, goal).json()).json()
    # Model output can represent the same practice after the original was removed.
    db.execute(
        "UPDATE hq.generated_habit_details SET content_digest=(SELECT content_digest FROM hq.generated_habit_details WHERE habit_id=%s) WHERE habit_id=%s",
        (original["habit_id"], newer["habit_id"]),
    )
    denied = add(client, child, original["habit_id"])
    assert denied.status_code == 409 and "already" in denied.json()["detail"]


def test_goal_save_checks_source_and_retirement_but_drop_can_remove_retired_goal(app, goal, db):
    client, _, child = app
    path = f"/v1/children/{child}/goals/{goal.goal_id}"
    db.execute("UPDATE hq.children SET age=3 WHERE id=%s", (child,))
    assert client.patch(path, json={"status": "active"}).status_code == 403
    db.execute("UPDATE hq.children SET age=8 WHERE id=%s", (child,))
    assert client.patch(path, json={"status": "active"}).status_code == 200
    db.execute("UPDATE hq.goals SET is_active=false WHERE id=%s", (goal.goal_id,))
    assert client.patch(path, json={"status": "active"}).status_code == 404
    assert client.patch(path, json={"status": "dropped"}).status_code == 200
    assert client.patch(f"/v1/children/{child}/goals/missing", json={"status": "active"}).status_code == 404
    assert client.patch(f"/v1/children/{child}/goals/meals", json={"status": "active"}).status_code == 200


def test_family_custom_limit_is_distinct_from_plan_capacity(app, goal, monkeypatch):
    client, _, _ = app
    batch = make(app, goal).json()
    monkeypatch.setattr(gh, "MAX_CUSTOM_HABITS", 0)
    denied = accept(client, batch)
    assert denied.status_code == 409 and "custom habits" in denied.json()["detail"]

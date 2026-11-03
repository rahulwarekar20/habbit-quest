"""The whole catalog, and a family's custom habits: who sees them, where they go, and what the AI never sees."""

import psycopg
import pytest
from conftest import OTHER, PARENT, token

from habitquest_backend.coach import take_snapshot
from habitquest_backend.db import transaction
from habitquest_backend.habits import CUSTOM_POINTS, MAX_CUSTOM_HABITS, is_custom
from habitquest_backend.insights import weekly_counts
from habitquest_backend.onboarding import candidates

PIANO = {
    "goal_id": "homework",
    "title": "Practise piano for Grandma Rose",
    "icon": "🎹",
    "anchor": "after_school",
}


@pytest.fixture
def family(client, db):
    for user in (PARENT, OTHER):
        db.execute("INSERT INTO hq.users(id,name) VALUES(%s,'Test')", (user,))
    body = {"name": "Rivera", "pin": "1234", "display_name": "Sam", "role": "mother"}
    return client.post("/v1/families", json=body).json()["id"]


@pytest.fixture
def alex(client, family):
    return client.post(f"/v1/families/{family}/children", json={"name": "Alex", "age": 8}).json()["id"]


@pytest.fixture
def piano(client, family):
    response = client.post(f"/v1/families/{family}/habits", json=PIANO)
    assert response.status_code == 201
    return response.json()


@pytest.fixture
def other_family(settings, client, family):
    """A second family (Okafor) with one child, Bo: its caregiver's headers, family id and child id."""
    headers = {"Authorization": "Bearer " + token(settings, OTHER)}
    body = {"name": "Okafor", "pin": "1234", "display_name": "Ade", "role": "father"}
    family = client.post("/v1/families", json=body, headers=headers).json()["id"]
    child = client.post(
        f"/v1/families/{family}/children", json={"name": "Bo", "age": 8}, headers=headers
    ).json()
    return headers, family, child["id"]


# ── The catalog ───────────────────────────────────────────────────────────────


def test_the_catalog_lists_every_preapproved_habit_with_its_ages(client, piano, db):
    habits = client.get("/v1/catalog").json()
    total = db.execute("SELECT count(*) FROM hq.habits WHERE is_active AND family_id IS NULL").fetchone()[0]
    assert len(habits) == total and not any(is_custom(h["id"]) for h in habits)
    first = habits[0]
    assert {"goal_title", "min_age", "max_age", "tier", "kid_title", "icon"} <= first.keys()
    assert [h["goal_title"] for h in habits] == sorted(h["goal_title"] for h in habits)
    assert piano["id"] not in {h["id"] for h in client.get("/v1/goals/homework/habits").json()}


# ── Custom habits ─────────────────────────────────────────────────────────────


def test_a_custom_habit_suits_every_child_and_pays_tier_one_points(client, family, piano):
    assert is_custom(piano["id"]) and piano["kid_title"] == PIANO["title"][:40]
    assert (piano["tier"], piano["min_age"], piano["max_age"], piano["points"]) == (1, 3, 13, CUSTOM_POINTS)
    assert piano["goal_title"] == "Homework without battles"
    assert [h["id"] for h in client.get(f"/v1/families/{family}/habits").json()] == [piano["id"]]


def test_a_custom_habit_joins_a_childs_plan_like_any_other(client, alex, piano):
    plan = {"goals": ["homework"], "habits": [{"habit_id": piano["id"]}]}
    response = client.put(f"/v1/children/{alex}/plan", json=plan)
    assert response.status_code == 200
    habit = response.json()["habits"][0]
    assert habit["habit_id"] == piano["id"] and habit["cue_time"] == "16:00" and habit["icon"] == "🎹"
    options = client.get(f"/v1/children/{alex}/plan").json()["goals"][0]["options"]
    assert piano["id"] in {o["id"] for o in options}
    today = client.get(f"/v1/children/{alex}/today").json()
    assert piano["id"] in {h["habit_id"] for h in today["habits"]}


@pytest.mark.parametrize(
    ("body", "status", "message"),
    [
        (PIANO | {"goal_id": "flying"}, 422, "Unknown goal"),
        (PIANO | {"title": "   "}, 422, "at least 1 character"),
        (PIANO | {"kid_hint": "Call me on 07700 900123"}, 422, "personal details"),
        (PIANO | {"family_id": "x"}, 422, "Extra inputs"),
    ],
)
def test_custom_habits_are_checked(client, family, body, status, message):
    response = client.post(f"/v1/families/{family}/habits", json=body)
    assert response.status_code == status and message in response.text


def test_a_family_has_at_most_thirty_custom_habits(client, family, db):
    for i in range(MAX_CUSTOM_HABITS):
        db.execute(
            "INSERT INTO hq.habits(id,goal_id,title,description,kid_title,kid_hint,icon,anchor,min_age,max_age,tier,"
            "points,family_id) VALUES(%s,'homework','H','','H','','⭐','evening',3,13,1,10,%s)",
            (f"my-{i}", family),
        )
    response = client.post(f"/v1/families/{family}/habits", json=PIANO)
    assert response.status_code == 409


def test_editing_changes_the_habit_everywhere(client, alex, piano):
    client.put(
        f"/v1/children/{alex}/plan", json={"goals": ["homework"], "habits": [{"habit_id": piano["id"]}]}
    )
    body = PIANO | {"goal_id": "responsibility", "title": "Feed the cat", "kid_title": "Cat's dinner!"}
    edited = client.put(f"/v1/habits/{piano['id']}", json=body).json()
    assert (edited["title"], edited["kid_title"], edited["goal_id"]) == (
        "Feed the cat",
        "Cat's dinner!",
        "responsibility",
    )
    assert client.get(f"/v1/children/{alex}/plan").json()["habits"][0]["title"] == "Feed the cat"


def test_deleting_takes_it_out_of_every_plan_but_keeps_history(client, alex, piano, db):
    client.put(
        f"/v1/children/{alex}/plan", json={"goals": ["homework"], "habits": [{"habit_id": piano["id"]}]}
    )
    assert client.delete(f"/v1/habits/{piano['id']}").status_code == 204
    assert client.get(f"/v1/children/{alex}/plan").json()["habits"] == []
    status = db.execute("SELECT status FROM hq.child_habits WHERE habit_id=%s", (piano["id"],)).fetchone()[0]
    assert status == "removed"
    assert client.delete(f"/v1/habits/{piano['id']}").status_code == 404


def test_catalog_habits_cannot_be_edited_or_deleted(client, family):
    assert client.put("/v1/habits/bedtime", json=PIANO).status_code == 404
    assert client.delete("/v1/habits/bedtime").status_code == 404


# ── Another family ────────────────────────────────────────────────────────────


def test_another_family_cannot_see_use_or_change_a_custom_habit(client, family, piano, other_family):
    headers, okafor, bo = other_family
    assert client.get(f"/v1/families/{family}/habits", headers=headers).status_code == 404
    assert client.post(f"/v1/families/{family}/habits", json=PIANO, headers=headers).status_code == 404
    assert client.get(f"/v1/families/{okafor}/habits", headers=headers).json() == []
    assert client.put(f"/v1/habits/{piano['id']}", json=PIANO, headers=headers).status_code == 404
    assert client.delete(f"/v1/habits/{piano['id']}", headers=headers).status_code == 404
    plan = {"goals": ["homework"], "habits": [{"habit_id": piano["id"]}]}
    assert client.put(f"/v1/children/{bo}/plan", json=plan, headers=headers).status_code == 422


def test_kids_see_only_their_own_familys_habits(settings, alex, piano, other_family):
    _, _, bo = other_family
    with transaction(settings, kid=alex) as conn:
        assert conn.execute("SELECT 1 FROM hq.habits WHERE id=%s", (piano["id"],)).fetchone()
    with transaction(settings, kid=bo) as conn:
        assert conn.execute("SELECT 1 FROM hq.habits WHERE id=%s", (piano["id"],)).fetchone() is None


def test_caregivers_cannot_change_points_or_claim_another_familys_habit(settings, family, piano):
    with transaction(settings, PARENT) as conn, pytest.raises(psycopg.errors.InsufficientPrivilege):
        conn.execute("UPDATE hq.habits SET points=1000 WHERE id=%s", (piano["id"],))
    with transaction(settings, PARENT) as conn:
        assert conn.execute("UPDATE hq.habits SET title='Mine' WHERE family_id IS NULL").rowcount == 0


# ── The AI never sees custom text ─────────────────────────────────────────────


def test_custom_habits_never_reach_the_ai(settings, client, alex, piano, db):
    plan = {"goals": ["homework"], "habits": [{"habit_id": piano["id"]}]}
    client.put(f"/v1/children/{alex}/plan", json=plan)
    child_habit = db.execute("SELECT id FROM hq.child_habits WHERE child_id=%s", (alex,)).fetchone()[0]
    db.execute(
        "INSERT INTO hq.completions(child_habit_id,day,status,decided_at,decided_by)"
        " VALUES(%s,hq.child_today(%s),'approved',now(),%s)",
        (child_habit, alex, PARENT),
    )
    with transaction(settings, PARENT) as conn:
        offered = {h["id"] for goal in candidates(conn, 8, 3) for h in goal.habits}
        snapshot = take_snapshot(conn, {"id": alex, "age": 8})
        counts = weekly_counts(conn, alex)
    assert piano["id"] not in offered
    assert snapshot.plan[piano["id"]]["title"] == "A family habit for Homework without battles"
    assert list(counts) == ["A family habit for Homework without battles"]
    assert "Grandma" not in repr(snapshot) + repr(counts)

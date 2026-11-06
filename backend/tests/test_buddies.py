"""Buddy choices retain identity across old clients, role boundaries, and racing saves."""

import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, Event
from uuid import UUID, uuid4

import psycopg
import pytest
from conftest import OTHER, PARENT, token
from fastapi.testclient import TestClient

from habitquest_backend import extras, insights
from habitquest_backend.buddies import BUDDY_FIELDS
from habitquest_backend.db import transaction
from habitquest_backend.main import create_app

CATALOG = {"mode": "catalog", "catalog_buddy_id": "ember-fox", "buddy_catalog_version": "0.1.0"}


@pytest.fixture
def family(client, db):
    for user in (PARENT, OTHER):
        db.execute("INSERT INTO hq.users(id,name) VALUES(%s,'Buddy test')", (user,))
    return client.post(
        "/v1/families", json={"name": "Buddy test", "display_name": "Parent", "role": "guardian"}
    ).json()["id"]


@pytest.fixture
def child(client, family):
    return client.post(f"/v1/families/{family}/children", json={"name": "Alex", "age": 8}).json()["id"]


@pytest.fixture
def kid(client, child):
    return {
        "Authorization": "Bearer " + client.post(f"/v1/children/{child}/kid-session").json()["access_token"]
    }


def selected(data):
    return {field: data[field] for field in BUDDY_FIELDS}


def choose(client, child, choice=CATALOG, revision=0, **profile):
    return client.patch(
        f"/v1/children/{child}",
        json={**profile, "buddy_selection": {**choice, "expected_revision": revision}},
    )


def test_legacy_defaults_compatibility_and_explicit_round_trip(client, family, child, kid):
    original = client.get(f"/v1/children/{child}").json()
    assert selected(original) == {
        "buddy": "fox",
        "buddy_selection_mode": "legacy",
        "catalog_buddy_id": None,
        "buddy_catalog_version": None,
        "buddy_selection_revision": 0,
    }
    assert client.patch(f"/v1/children/{child}", json={"buddy": "owl"}).json()["buddy"] == "owl"
    assert client.patch("/v1/kid/extras", json={"buddy": "bear"}, headers=kid).json()["buddy"] == "bear"
    first = choose(client, child)
    assert first.status_code == 200, first.text
    assert selected(first.json()) == {
        "buddy": "bear",
        "buddy_selection_mode": "catalog",
        "catalog_buddy_id": "ember-fox",
        "buddy_catalog_version": "0.1.0",
        "buddy_selection_revision": 1,
    }
    # An old open parent form saves its unrelated changes without undoing a newer kid choice.
    old = client.patch(f"/v1/children/{child}", json={"name": "Alex renamed", "buddy": "fox"})
    assert old.json()["name"] == "Alex renamed" and selected(old.json()) == selected(first.json())
    assert selected(client.patch("/v1/kid/extras", json={"buddy": "fox"}, headers=kid).json()) == selected(
        first.json()
    )
    switched = client.patch(
        "/v1/kid/extras",
        headers=kid,
        json={"buddy_selection": {"mode": "legacy", "buddy": "bunny", "expected_revision": 1}},
    )
    assert switched.status_code == 200, switched.text
    assert selected(switched.json()) == {
        "buddy": "bunny",
        "buddy_selection_mode": "legacy",
        "catalog_buddy_id": None,
        "buddy_catalog_version": None,
        "buddy_selection_revision": 2,
    }
    assert client.patch(f"/v1/children/{child}", json={"buddy": "fox"}).json()["buddy"] == "bunny"
    assert (
        choose(client, child, {"mode": "legacy", "buddy": "owl"}, revision=2).json()[
            "buddy_selection_revision"
        ]
        == 3
    )


def test_create_catalog_and_all_authoritative_projections(client, db, family):
    made = client.post(
        f"/v1/families/{family}/children",
        json={
            "name": "Maya",
            "age": 3,
            "buddy": "bunny",
            "buddy_selection": CATALOG,
        },
    )
    assert made.status_code == 201, made.text
    child = made.json()["id"]
    expected = selected(made.json())
    assert expected["buddy_selection_revision"] == 1 and expected["buddy"] == "bunny"
    client.put(f"/v1/children/{child}/kid-pin", json={"pin": "4321"})
    session = client.post(f"/v1/children/{child}/kid-session", json={"pin": "4321"}).json()
    kid = {"Authorization": "Bearer " + session["access_token"]}
    code = client.post(f"/v1/families/{family}/login-code").json()["login_code"]
    login = client.post(f"/v1/kid-login/{code}", json={"child_id": child, "pin": "4321"}).json()
    values = [
        client.get(f"/v1/children/{child}").json(),
        client.get(f"/v1/families/{family}/children").json()[0],
        client.get(f"/v1/families/{family}/export").json()["children"][0],
        client.get(f"/v1/children/{child}/today").json()["child"],
        client.get(f"/v1/children/{child}/extras").json(),
        client.get("/v1/kid/me", headers=kid).json(),
        client.get("/v1/kid/today", headers=kid).json()["child"],
        client.get("/v1/kid/extras", headers=kid).json(),
        client.get(f"/v1/kid-login/{code}").json()["children"][0],
        session["child"],
        login["child"],
    ]
    assert all(selected(value) == expected for value in values)
    assert client.patch(f"/v1/children/{child}", json={"age": 13}).status_code == 200
    assert client.get("/v1/kid/today", headers=kid).json()["child"]["age"] == 13
    assert db.execute("SELECT count(*) FROM hq.ai_operations").fetchone()[0] == 0


@pytest.mark.parametrize(
    "choice",
    [
        None,
        {},
        {"mode": "none"},
        {"mode": "legacy"},
        {"mode": "legacy", "buddy": "dragon"},
        {"mode": "legacy", "buddy": "fox", "catalog_buddy_id": "ember-fox"},
        {"mode": "catalog", "catalog_buddy_id": "ember-fox"},
        {**CATALOG, "buddy": "fox"},
        {**CATALOG, "unexpected": True},
        {**CATALOG, "expected_revision": -1},
        {**CATALOG, "expected_revision": True},
    ],
)
def test_incomplete_conflicting_or_empty_selection_is_rejected(client, family, child, kid, choice):
    payload = {"buddy_selection": choice}
    assert (
        client.post(f"/v1/families/{family}/children", json={"name": "Maya", "age": 8, **payload}).status_code
        == 422
    )
    assert client.patch(f"/v1/children/{child}", json=payload).status_code == 422
    assert client.patch("/v1/kid/extras", json=payload, headers=kid).status_code == 422


def test_explicit_updates_require_revision_and_refuse_ambiguous_flat_fields(client, child, kid):
    for payload in (
        {"buddy_selection": CATALOG},
        {"buddy_selection": {**CATALOG, "expected_revision": None}},
        {"buddy": "fox", "buddy_selection": {**CATALOG, "expected_revision": 0}},
    ):
        assert client.patch(f"/v1/children/{child}", json=payload).status_code == 422
        assert client.patch("/v1/kid/extras", json=payload, headers=kid).status_code == 422


@pytest.mark.parametrize("change", [{"catalog_buddy_id": "unknown"}, {"buddy_catalog_version": "9.9.9"}])
def test_invalid_references_never_save_profile_or_extras(client, family, child, kid, change):
    invalid = {**CATALOG, **change}
    assert choose(client, child, invalid, name="Must not save").status_code == 422
    assert client.get(f"/v1/children/{child}").json()["name"] == "Alex"
    assert (
        client.post(
            f"/v1/families/{family}/children", json={"name": "Maya", "age": 8, "buddy_selection": invalid}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            "/v1/kid/extras",
            json={"level_seen": 2, "buddy_selection": {**invalid, "expected_revision": 0}},
            headers=kid,
        ).status_code
        == 422
    )
    assert client.get("/v1/kid/extras", headers=kid).json()["level_seen"] == 1


def test_stale_choice_rolls_back_unrelated_fields_and_remains_recoverable(client, child, kid):
    assert choose(client, child).status_code == 200
    assert choose(client, child, revision=0, name="Stale").status_code == 409
    assert (
        client.patch(
            "/v1/kid/extras",
            headers=kid,
            json={
                "buddy_selection": {"mode": "legacy", "buddy": "owl", "expected_revision": 0},
                "level_seen": 2,
            },
        ).status_code
        == 409
    )
    assert client.get(f"/v1/children/{child}").json()["name"] == "Alex"
    assert client.get("/v1/kid/extras", headers=kid).json()["level_seen"] == 1
    assert choose(client, child, revision=1).json()["buddy_selection_revision"] == 2


def test_explicit_create_revision_and_original_choice(client, family):
    url = f"/v1/families/{family}/children"
    assert (
        client.post(
            url, json={"name": "Maya", "age": 8, "buddy_selection": {**CATALOG, "expected_revision": 1}}
        ).status_code
        == 409
    )
    made = client.post(
        url, json={"name": "Maya", "age": 8, "buddy_selection": {"mode": "legacy", "buddy": "owl"}}
    )
    assert made.status_code == 201, made.text
    assert made.json()["buddy"] == "owl" and made.json()["buddy_selection_revision"] == 1
    assert client.patch(f"/v1/children/{made.json()['id']}", json={}).json() == made.json()


def test_child_deleted_during_kid_save_returns_missing(client, db, child, kid, monkeypatch):
    read_one = extras.one

    def delete_after_read(conn, sql, params=()):
        row = read_one(conn, sql, params)
        if sql.startswith("SELECT accessories FROM"):
            db.execute("DELETE FROM hq.children WHERE id=%s", (child,))
        return row

    monkeypatch.setattr(extras, "one", delete_after_read)
    response = client.patch(
        "/v1/kid/extras", headers=kid, json={"buddy_selection": {**CATALOG, "expected_revision": 0}}
    )
    assert response.status_code == 404


def test_selection_and_age_validate_the_merged_state_atomically(client, db, child, kid):
    db.execute("UPDATE hq.buddy_catalog SET supported_age_min=9 WHERE id='ember-fox'")
    try:
        assert choose(client, child).status_code == 422
        assert (
            client.patch(
                "/v1/kid/extras", headers=kid, json={"buddy_selection": {**CATALOG, "expected_revision": 0}}
            ).status_code
            == 422
        )
        assert choose(client, child, age=9).status_code == 200
        assert client.patch(f"/v1/children/{child}", json={"age": 8, "name": "Invalid"}).status_code == 422
        assert client.get(f"/v1/children/{child}").json()["age"] == 9
        with pytest.raises(psycopg.errors.CheckViolation):
            db.execute("UPDATE hq.children SET age=8 WHERE id=%s", (child,))
        assert (
            choose(client, child, {"mode": "legacy", "buddy": "bear"}, revision=1, age=8).status_code == 200
        )
        db.execute("UPDATE hq.buddy_catalog SET supported_age_min=3,available=false WHERE id='ember-fox'")
        assert choose(client, child, revision=2).status_code == 422
        assert (
            client.patch(
                "/v1/kid/extras",
                headers=kid,
                json={"buddy_selection": {**CATALOG, "expected_revision": 2}},
            ).status_code
            == 422
        )
    finally:
        db.execute("UPDATE hq.buddy_catalog SET supported_age_min=3,available=true WHERE id='ember-fox'")


def test_rollback_switch_rejects_new_catalog_writes_but_preserves_reads_and_legacy(
    client, settings, family, child, kid
):
    chosen = choose(client, child).json()
    disabled = settings.model_copy(update={"buddy_catalog_enabled": False})
    with TestClient(create_app(disabled)) as stopped:
        stopped.headers["Authorization"] = "Bearer " + token(settings)
        assert selected(stopped.get(f"/v1/children/{child}").json()) == selected(chosen)
        assert choose(stopped, child, revision=1).status_code == 409
        assert (
            stopped.patch(
                "/v1/kid/extras", headers=kid, json={"buddy_selection": {**CATALOG, "expected_revision": 1}}
            ).status_code
            == 409
        )
        assert (
            stopped.post(
                f"/v1/families/{family}/children", json={"name": "Maya", "age": 8, "buddy_selection": CATALOG}
            ).status_code
            == 409
        )
        assert (
            stopped.post(f"/v1/families/{family}/children", json={"name": "Maya", "age": 8}).status_code
            == 201
        )
        assert choose(stopped, child, {"mode": "legacy", "buddy": "owl"}, revision=1).status_code == 200
        assert (
            stopped.patch(
                "/v1/kid/extras",
                headers=kid,
                json={"buddy_selection": {"mode": "legacy", "buddy": "bear", "expected_revision": 2}},
            ).status_code
            == 200
        )


def test_kid_catalog_copy_is_static_without_provider_calls(client, settings, child, kid, monkeypatch):
    assert choose(client, child).status_code == 200

    def reject(*args, **kwargs):
        raise AssertionError("Catalog buddy copy must not invoke a provider")

    monkeypatch.setattr(insights, "buddy_line", reject)
    for event, line in insights.CATALOG_BUDDY_LINES.items():
        assert client.post("/v1/kid/buddy-line", headers=kid, json={"event": event}).json()["line"] == line


def test_choices_cannot_cross_family_child_or_role_boundaries(client, db, settings, family, child, kid):
    other_family = client.post(
        "/v1/families",
        headers={"Authorization": "Bearer " + token(settings, OTHER)},
        json={
            "name": "Other",
            "display_name": "Other",
            "role": "guardian",
        },
    ).json()["id"]
    other_child = db.execute(
        "INSERT INTO hq.children(family_id,name,age) VALUES(%s,'Other',8) RETURNING id", (other_family,)
    ).fetchone()[0]
    payload = {"buddy_selection": {**CATALOG, "expected_revision": 0}}
    assert client.patch(f"/v1/children/{other_child}", json=payload).status_code == 404
    assert client.patch(f"/v1/children/{child}", json=payload, headers=kid).status_code == 401
    assert client.patch("/v1/kid/extras", json=payload).status_code == 401
    assert (
        client.patch(
            "/v1/kid/extras", json={**payload, "child_id": str(other_child)}, headers=kid
        ).status_code
        == 422
    )
    expired = {"Authorization": "Bearer " + token(settings, UUID(child), role="kid", exp=0)}
    assert client.patch("/v1/kid/extras", json=payload, headers=expired).status_code == 401
    with transaction(settings, kid=UUID(child)) as conn:
        assert conn.execute("SELECT id FROM hq.children").fetchall() == [{"id": UUID(child)}]
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("UPDATE hq.children SET buddy='bear'")
    assert (
        db.execute("SELECT buddy_selection_revision FROM hq.children WHERE id=%s", (other_child,)).fetchone()[
            0
        ]
        == 0
    )


def test_reference_release_is_read_only_to_both_roles(settings, db):
    packaged = json.loads(
        (Path(__file__).parents[1] / "src/habitquest_backend/data/buddy_catalog.json").read_text()
    )
    rows = db.execute(
        "SELECT id,catalog_version,supported_age_min,supported_age_max,available FROM hq.buddy_catalog ORDER BY id"
    ).fetchall()
    assert rows == [tuple(row.values()) for row in packaged["buddies"]]
    assert len(rows) == 24
    for kwargs in ({"user": PARENT}, {"kid": uuid4()}):
        with transaction(settings, **kwargs) as conn:
            assert len(conn.execute("SELECT id FROM hq.buddy_catalog").fetchall()) == 24
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute("UPDATE hq.buddy_catalog SET available=false")


def test_two_simultaneous_parent_and_kid_choices_have_one_winner(client, settings, child, kid):
    gate = Barrier(2)
    apps = [create_app(settings), create_app(settings)]

    def save(as_kid):
        with TestClient(apps[int(as_kid)]) as concurrent:
            concurrent.headers.update(kid if as_kid else {"Authorization": "Bearer " + token(settings)})
            gate.wait(timeout=5)
            payload = {"buddy_selection": {**CATALOG, "expected_revision": 0}}
            return concurrent.patch(
                "/v1/kid/extras" if as_kid else f"/v1/children/{child}", json=payload
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, [False, True]))
    assert sorted(results) == [200, 409]
    assert client.get(f"/v1/children/{child}").json()["buddy_selection_revision"] == 1


def test_kid_choice_waits_for_age_lock_and_validates_committed_final_age(client, settings, db, child, kid):
    db.execute("UPDATE hq.buddy_catalog SET supported_age_min=9 WHERE id='ember-fox'")
    started = Event()

    def save():
        with TestClient(create_app(settings)) as concurrent:
            started.set()
            return concurrent.patch(
                "/v1/kid/extras", headers=kid, json={"buddy_selection": {**CATALOG, "expected_revision": 0}}
            )

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction(settings, PARENT) as conn:
                conn.execute("UPDATE hq.children SET age=9 WHERE id=%s", (child,))
                pending = pool.submit(save)
                assert started.wait(timeout=5)
                # Observe the actual database lock wait before committing the new age.
                waiting = False
                for _ in range(100):
                    waiting = db.execute(
                        "SELECT EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database()"
                        " AND wait_event_type='Lock' AND query LIKE 'SELECT hq.kid_set_buddy_selection%%')"
                    ).fetchone()[0]
                    if waiting:
                        break
                    time.sleep(0.01)
                assert waiting
            response = pending.result(timeout=10)
        assert response.status_code == 200, response.text
        assert client.get(f"/v1/children/{child}").json()["age"] == 9
    finally:
        db.execute("UPDATE hq.buddy_catalog SET supported_age_min=3 WHERE id='ember-fox'")


def test_narrow_database_function_rejects_invalid_direct_calls_and_unknown_kid(settings, child):
    with transaction(settings, kid=UUID(child)) as conn:
        for values in (
            ("none", None, None, None, 0),
            ("legacy", "fox", "ember-fox", "0.1.0", 0),
            ("legacy", None, None, None, 0),
            ("legacy", "dragon", None, None, 0),
            ("catalog", "fox", "ember-fox", "0.1.0", 0),
            ("catalog", None, "unknown", "0.1.0", 0),
        ):
            assert (
                conn.execute("SELECT hq.kid_set_buddy_selection(%s,%s,%s,%s,%s)", values).fetchone()[
                    "kid_set_buddy_selection"
                ]
                == "invalid"
            )
        assert (
            conn.execute("SELECT hq.kid_set_buddy_selection('legacy','fox',NULL,NULL,NULL)").fetchone()[
                "kid_set_buddy_selection"
            ]
            == "conflict"
        )
    with transaction(settings, kid=uuid4()) as conn:
        assert (
            conn.execute("SELECT hq.kid_set_buddy_selection('legacy','fox',NULL,NULL,0)").fetchone()[
                "kid_set_buddy_selection"
            ]
            == "missing"
        )

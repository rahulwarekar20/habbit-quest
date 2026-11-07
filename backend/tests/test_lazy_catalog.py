"""Database authority for lazy source goals: verified public content, owned child, no bulk writes."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import psycopg
import pytest
from conftest import OTHER, PARENT, token
from fastapi.testclient import TestClient

from habitquest_backend.db import transaction
from habitquest_backend.main import create_app
from habitquest_backend.planning_catalog import CatalogRepository, materialize_goal


def canonical(goal):
    return json.dumps(goal.record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


@pytest.fixture
def lazy_setup(settings, db):
    repository = CatalogRepository()
    goal = repository.from_source("attention-task-start--begin-one-action--a6-8")
    cleanup = [goal.goal_id, "lazy-owner-conflict"]
    with TestClient(create_app(settings)) as client:
        children = []
        for user in (PARENT, OTHER):
            db.execute("INSERT INTO hq.users(id,name) VALUES(%s,'Catalog test')", (user,))
            client.headers["Authorization"] = "Bearer " + token(settings, user=user)
            family = client.post(
                "/v1/families",
                json={"name": "Catalog test", "pin": "1234", "display_name": "Parent", "role": "guardian"},
            ).json()["id"]
            children.append(
                UUID(
                    client.post(f"/v1/families/{family}/children", json={"name": "Child", "age": 8}).json()[
                        "id"
                    ]
                )
            )
        try:
            assert db.execute("SELECT 1 FROM hq.goals WHERE id=%s", (goal.goal_id,)).fetchone() is None
            yield repository, goal, children
        finally:
            db.execute("TRUNCATE hq.users,hq.families CASCADE")
            db.execute("DELETE FROM hq.catalog_goal_sources WHERE goal_id=ANY(%s)", (cleanup,))
            db.execute("DELETE FROM hq.goals WHERE id=ANY(%s)", (cleanup,))


def call(conn, child, goal, *, ident=None, age=8, setting="home", payload=None):
    return conn.execute(
        "SELECT hq.materialize_catalog_goal(%s,%s,%s,%s,%s) AS created",
        (child, ident or goal.goal_id, age, setting, canonical(goal) if payload is None else payload),
    ).fetchone()["created"]


def test_pinned_database_allowlist_matches_packaged_release():
    sql = (Path(__file__).parents[1] / "db/migrations/202611040005_lazy_catalog_goals.sql").read_text()
    pins = json.loads(sql.split("$pins$")[1])
    assert pins == {goal.goal_id: goal.record_sha256 for goal in CatalogRepository().all()}


def test_lazy_materialization_is_idempotent_and_creates_only_selected_goal(settings, db, lazy_setup):
    repository, goal, children = lazy_setup
    before = db.execute("SELECT count(*) FROM hq.goals").fetchone()[0]
    with transaction(settings, PARENT) as conn:
        assert materialize_goal(conn, repository, goal.goal_id, 8, "home", child_id=children[0]) == goal
    with transaction(settings, PARENT) as conn:
        assert call(conn, children[0], goal) is False
    assert db.execute("SELECT count(*) FROM hq.goals").fetchone()[0] == before + 1
    assert (
        db.execute(
            "SELECT record_sha256 FROM hq.catalog_goal_sources WHERE goal_id=%s", (goal.goal_id,)
        ).fetchone()[0]
        == goal.record_sha256
    )
    assert db.execute("SELECT count(*) FROM hq.habits WHERE goal_id=%s", (goal.goal_id,)).fetchone()[0] == 0


@pytest.mark.parametrize(
    "case",
    [
        "other_child",
        "unknown_child",
        "unknown_goal",
        "tampered",
        "stale_age",
        "wrong_age",
        "wrong_setting",
        "null_setting",
        "parent_card",
    ],
)
def test_function_rejects_untrusted_or_ineligible_materialization_without_rows(
    settings, db, lazy_setup, case
):
    repository, goal, children = lazy_setup
    child = children[0]
    kwargs = {}
    if case == "other_child":
        child = children[1]
    elif case == "unknown_child":
        child = uuid4()
    elif case == "unknown_goal":
        kwargs["ident"] = "made-up-goal"
    elif case == "tampered":
        changed = dict(goal.record, title="Untrusted title")
        kwargs["payload"] = json.dumps(changed, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    elif case == "stale_age":
        kwargs["age"] = 7
    elif case == "wrong_age":
        goal = repository.from_source("attention-task-start--begin-one-action--a11-13")
    elif case == "wrong_setting":
        kwargs["setting"] = "online"
    elif case == "null_setting":
        kwargs["setting"] = None
    else:
        goal = next(
            g
            for g in repository.all()
            if g.metadata["intent_class"] == "parent_coaching"
            and g.metadata["age_min"] <= 8 <= g.metadata["age_max"]
        )
    with pytest.raises(psycopg.errors.RaiseException):
        with transaction(settings, PARENT) as conn:
            call(conn, child, goal, **kwargs)
    assert db.execute("SELECT 1 FROM hq.goals WHERE id=%s", (goal.goal_id,)).fetchone() is None


def test_runtime_roles_cannot_write_arbitrary_global_goals_or_kid_materialize(settings, db, lazy_setup):
    _, goal, children = lazy_setup
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with transaction(settings, PARENT) as conn:
            conn.execute("INSERT INTO hq.goals(id,title,description) VALUES('arbitrary-goal','Bad','Bad')")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with transaction(settings, kid=children[0]) as conn:
            call(conn, children[0], goal)
    assert db.execute("SELECT 1 FROM hq.goals WHERE id=%s", (goal.goal_id,)).fetchone() is None


@pytest.mark.parametrize("case", ["retired", "legacy_collision", "changed_binding", "source_collision"])
def test_existing_retired_or_conflicting_rows_never_overwritten(settings, db, lazy_setup, case):
    _, goal, children = lazy_setup
    if case in {"retired", "changed_binding"}:
        with transaction(settings, PARENT) as conn:
            assert call(conn, children[0], goal)
        if case == "retired":
            db.execute("UPDATE hq.goals SET is_active=false WHERE id=%s", (goal.goal_id,))
        else:
            db.execute(
                "UPDATE hq.catalog_goal_sources SET record_sha256=%s WHERE goal_id=%s",
                ("0" * 64, goal.goal_id),
            )
    elif case == "legacy_collision":
        db.execute(
            "INSERT INTO hq.goals(id,title,description) VALUES(%s,'Existing legacy goal','Existing')",
            (goal.goal_id,),
        )
    else:
        db.execute("INSERT INTO hq.goals(id,title,description) VALUES('lazy-owner-conflict','Other','Other')")
        ref = goal.source_ref
        db.execute(
            "INSERT INTO hq.catalog_goal_sources(goal_id,source_id,concept_id,category_id,catalog_version,record_sha256,snapshot_id) VALUES(%s,%s,%s,%s,%s,%s,%s)",
            ("lazy-owner-conflict", *ref.values()),
        )
    before = db.execute(
        "SELECT title,description,is_active FROM hq.goals WHERE id=%s", (goal.goal_id,)
    ).fetchone()
    with pytest.raises(psycopg.errors.RaiseException):
        with transaction(settings, PARENT) as conn:
            call(conn, children[0], goal)
    assert (
        db.execute("SELECT title,description,is_active FROM hq.goals WHERE id=%s", (goal.goal_id,)).fetchone()
        == before
    )
    if case == "changed_binding":
        assert (
            db.execute(
                "SELECT record_sha256 FROM hq.catalog_goal_sources WHERE goal_id=%s", (goal.goal_id,)
            ).fetchone()[0]
            == "0" * 64
        )


def test_concurrent_owned_requests_create_one_shared_canonical_goal(settings, db, lazy_setup):
    _, goal, children = lazy_setup
    barrier = Barrier(2)

    def worker(index):
        with transaction(settings, (PARENT, OTHER)[index]) as conn:
            barrier.wait(timeout=5)
            return call(conn, children[index], goal)

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(worker, [0, 1])) == [False, True]
    assert (
        db.execute(
            "SELECT count(*) FROM hq.catalog_goal_sources WHERE goal_id=%s", (goal.goal_id,)
        ).fetchone()[0]
        == 1
    )

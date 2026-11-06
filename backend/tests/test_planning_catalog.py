"""Pinned source identity, additive import, parent-only reading and context enforcement."""

import json
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from conftest import token
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from habitquest_backend import planning_catalog as catalog
from habitquest_backend.catalog_import import import_catalog


@pytest.fixture
def repository():
    return catalog.CatalogRepository()


def child_goal(repository):
    return next(g for g in repository.all() if repository.eligible(g.goal_id, 8, "home"))


def payload():
    return json.loads((Path(catalog.__file__).parent / "data/planning_catalog.json").read_bytes())


def test_pinned_portable_release_and_defensive_copies(repository):
    goals = repository.all()
    assert len(goals) == 381 and len({g.goal_id for g in goals}) == 381
    assert len({g.concept_id for g in goals}) == 96
    assert all(len(g.goal_id) <= 40 for g in goals)
    assert sum(g.metadata["intent_class"] in catalog.CHILD_INTENTS for g in goals) == 377
    goal = child_goal(repository)
    assert repository.from_source(goal.source_id) == goal
    assert goal.goal_id == catalog.goal_id_for(goal.source_id)
    goal.record["title"] = "mutated"
    assert repository.get(goal.goal_id).title != "mutated"
    for method in (repository.get, repository.from_source):
        with pytest.raises(catalog.CatalogError):
            method("unknown")
    assert catalog.digest(b"abc") == catalog.digest(b"abc")


def test_evidence_and_reader_preserve_limits_without_reward_mapping(repository):
    goal = child_goal(repository)
    detail = goal.detail()
    assert detail["source_ref"] == goal.source_ref
    assert detail["readiness_note"] == goal.record["age"]["readiness_note"]
    assert detail["research"]["product_efficacy"] == "not_established"
    assert "reward" not in json.dumps(detail)
    assert "reward" not in json.dumps(goal.evidence())
    candidate = goal.candidate()["evidence"]
    assert candidate["research_insight"] == detail["research"]["insight"]
    assert candidate["product_efficacy"] == "not_established"
    assert candidate["research_evidence"] == detail["research"]["evidence"]
    assert candidate["research_limits"] == [
        item["does_not_establish"] for item in detail["research"]["evidence"]
    ]
    assert candidate["age_min"] == detail["age_min"] and candidate["age_max"] == detail["age_max"]
    assert candidate["contexts"] == detail["contexts"]
    candidate["research_evidence"][0]["supports"] = "mutated"
    assert goal.record["research"]["evidence"][0]["supports"] != "mutated"
    assert catalog.without_rewards({"points": 3, "text": ["okay"]}) == {"text": ["okay"]}


@pytest.mark.parametrize(
    "age,context", [(True, "home"), (2, "home"), (14, "home"), (8, "mars"), (3, "home"), (8, "online")]
)
def test_age_setting_and_type_eligibility(repository, age, context):
    goal = next(
        g
        for g in repository.all()
        if repository.eligible(g.goal_id, 8, "home") and "online" not in g.metadata["contexts"]
    )
    assert not repository.eligible(goal.goal_id, age, context)


def test_parent_coaching_is_not_a_child_goal(repository):
    goal = next(g for g in repository.all() if g.metadata["intent_class"] == "parent_coaching")
    assert not repository.eligible(goal.goal_id, goal.metadata["age_min"], goal.metadata["contexts"][0])


@pytest.mark.parametrize(
    "change,code",
    [
        (lambda p: p.update(snapshot_id="wrong"), "release"),
        (lambda p: p.update(source_manifest_sha256="wrong"), "release"),
        (lambda p: p.update(target={}), "release"),
        (lambda p: p.update(embedding={}), "release"),
        (lambda p: p.update(records=[]), "release"),
        (lambda p: p["records"][0].update(id="wrong"), "record"),
        (lambda p: p["records"].__setitem__(1, p["records"][0]), "record"),
        (lambda p: p["records"][0]["canonical_record"].update(catalog_version="future"), "record"),
        (lambda p: p["records"][0]["metadata"].update(age_min=99), "record"),
        (lambda p: p["records"][0].update(text="wrong"), "record"),
        (lambda p: p["records"][0]["canonical_record"]["parent"].update(setup="tampered"), "record"),
        (lambda p: p.pop("records"), "invalid"),
    ],
)
def test_catalog_release_and_canonical_tamper_rejected(change, code):
    data = payload()
    change(data)
    with pytest.raises(catalog.CatalogError, match=code):
        catalog.validate_payload(data)


def test_text_cannot_be_swapped_even_with_new_hash():
    data = payload()
    row = data["records"][0]
    row["text"] = "new text"
    row["metadata"]["embedding_text_sha256"] = catalog.digest(b"new text")
    with pytest.raises(catalog.CatalogError, match="record"):
        catalog.validate_payload(data)


@pytest.mark.parametrize(
    "raw,expected", [(b"tampered", "checksum"), (None, "unavailable"), (b"{", "unavailable")]
)
def test_packaged_checksum_or_missing_file_fail_closed(monkeypatch, raw, expected):
    catalog.packaged_goals.cache_clear()

    def read(self):
        if raw is None:
            raise OSError("file missing")
        return raw

    monkeypatch.setattr(Path, "read_bytes", read)
    if raw == b"{":
        monkeypatch.setattr(catalog, "PACKAGED_SHA256", catalog.digest(raw))
    try:
        with pytest.raises(catalog.CatalogError, match=expected):
            catalog.packaged_goals()
    finally:
        catalog.packaged_goals.cache_clear()


class Connection:
    def __init__(self, rows=(), child=None):
        self.rows = deepcopy(list(rows))
        self.child = child
        self.writes = []
        self.current = None

    def execute(self, sql, params=()):
        if sql.startswith("INSERT") or sql.startswith("SELECT hq.materialize_catalog_goal"):
            self.writes.append((sql, params))
        if sql.startswith("SELECT age"):
            self.current = self.child
        elif sql.startswith("SELECT g.id") and params:
            self.current = next((r for r in self.rows if r["goal_id"] == params[0]), None)
        return self

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.current


def existing(goal):
    return {
        "id": goal.goal_id,
        "goal_id": goal.goal_id,
        "title": goal.title,
        "description": goal.description,
        "is_active": True,
        **goal.source_ref,
    }


def test_import_is_selected_additive_deterministic_and_read_only_by_default(repository):
    goals = [g for g in repository.all() if repository.eligible(g.goal_id, 8, "home")][:2]
    ids = [g.goal_id for g in goals]
    conn = Connection()
    result = import_catalog(conn, repository, goal_ids=ids)
    assert result == {"new": 2, "unchanged": 0} and conn.writes == []
    result = import_catalog(conn, repository, goal_ids=[*ids, ids[0]], apply=True)
    assert len(conn.writes) == 4 and result["new"] == 2
    assert all("points" not in sql for sql, _ in conn.writes)
    assert {params[0] for _, params in conn.writes} == set(ids)
    conn = Connection([*(existing(g) for g in goals), {"id": "legacy", "source_id": None}])
    result = import_catalog(conn, repository, goal_ids=ids, apply=True)
    assert result == {"new": 0, "unchanged": 2} and not conn.writes


@pytest.mark.parametrize("kind", ["hash", "legacy_collision", "source_collision"])
def test_import_refuses_changed_source_or_legacy_collision_before_any_write(repository, kind):
    goal = child_goal(repository)
    row = existing(goal)
    if kind == "hash":
        row["record_sha256"] = "different"
    elif kind == "legacy_collision":
        row["source_id"] = None
    else:
        row["id"] = "another-goal"
    conn = Connection([row])
    with pytest.raises(catalog.CatalogError):
        import_catalog(conn, repository, goal_ids=[goal.goal_id], apply=True)
    assert not conn.writes


def test_import_requires_explicit_eligible_selection(repository):
    with pytest.raises(catalog.CatalogError, match="explicit_goal_selection"):
        import_catalog(Connection(), repository, goal_ids=[], apply=True)
    goal = child_goal(repository)
    goal.metadata["available_by_default"] = False
    with pytest.raises(catalog.CatalogError, match="ineligible_source"):
        import_catalog(Connection(), SimpleNamespace(get=lambda ident: goal), goal_ids=[goal.goal_id])
    parent = next(g for g in repository.all() if g.metadata["intent_class"] == "parent_coaching")
    with pytest.raises(catalog.CatalogError, match="ineligible_source"):
        import_catalog(Connection(), repository, goal_ids=[parent.goal_id])
    with pytest.raises(catalog.CatalogError, match="retired_goal"):
        import_catalog(
            Connection([existing(goal) | {"is_active": False}]),
            repository,
            goal_ids=[goal.goal_id],
            apply=True,
        )


def test_require_imported_active_matching_eligible_source(repository):
    goal = child_goal(repository)
    conn = Connection([existing(goal)])
    assert catalog.require_goal(conn, repository, goal.goal_id, 8, "home") == goal
    for rows, age, expected in [
        ([], 8, 404),
        ([existing(goal) | {"snapshot_id": "old"}], 8, 409),
        ([existing(goal) | {"is_active": False}], 8, 404),
        ([existing(goal) | {"source_id": None}], 8, 409),
        ([existing(goal) | {"title": "Changed"}], 8, 409),
        ([existing(goal)], 3, 403),
    ]:
        with pytest.raises(HTTPException) as error:
            catalog.require_goal(Connection(rows), repository, goal.goal_id, age, "home")
        assert error.value.status_code == expected
    unknown = existing(goal) | {"goal_id": "unknown"}
    with pytest.raises(HTTPException) as error:
        catalog.require_goal(Connection([unknown]), repository, "unknown", 8, "home")
    assert error.value.status_code == 404


def test_source_reader_authenticated_parent_owned_child_and_no_generation(repository, settings, monkeypatch):
    goal = child_goal(repository)
    conn = Connection(child={"age": 8})

    @contextmanager
    def transaction(*args):
        yield conn

    monkeypatch.setattr(catalog, "transaction", transaction)
    app = FastAPI()
    app.include_router(catalog.routes(settings))
    path = f"/v1/children/{uuid4()}/goals/{goal.goal_id}/source?setting=home"
    with TestClient(app) as client:
        assert client.get(path).status_code == 401
        client.headers["Authorization"] = "Bearer " + token(settings, role="kid")
        assert client.get(path).status_code == 401
        client.headers["Authorization"] = "Bearer " + token(settings)
        response = client.get(path)
        assert response.status_code == 200 and response.json() == goal.detail()
        assert client.get(path.replace("home", "mars")).status_code == 422
        conn.child = None  # RLS hides another family's child.
        assert client.get(path).status_code == 404
    assert not conn.writes


def test_resolve_is_read_only_and_materialization_uses_verified_card(repository):
    goal = child_goal(repository)
    conn = Connection()
    assert catalog.resolve_goal(conn, repository, goal.goal_id, 8, "home") == goal
    assert conn.writes == []
    child = uuid4()
    assert catalog.materialize_goal(conn, repository, goal.goal_id, 8, "home", child_id=child) == goal
    assert len(conn.writes) == 1
    sql, params = conn.writes[0]
    assert "materialize_catalog_goal" in sql and params[:4] == (child, goal.goal_id, 8, "home")
    assert catalog.digest(params[4].encode()) == goal.record_sha256


@pytest.mark.parametrize(
    "code,status",
    [
        ("catalog_not_authorized", 404),
        ("catalog_ineligible", 403),
        ("catalog_existing_conflict", 409),
        (None, 409),
    ],
)
def test_database_guard_failures_are_safe_http_errors(repository, monkeypatch, code, status):
    class GuardError(Exception):
        diag = SimpleNamespace(message_primary=code)

    monkeypatch.setattr(catalog.psycopg.errors, "RaiseException", GuardError)

    class GuardConnection(Connection):
        def execute(self, sql, params=()):
            if sql.startswith("SELECT hq.materialize_catalog_goal"):
                raise GuardError()
            return super().execute(sql, params)

    with pytest.raises(HTTPException) as error:
        catalog.materialize_goal(
            GuardConnection(), repository, child_goal(repository).goal_id, 8, "home", child_id=uuid4()
        )
    assert error.value.status_code == status

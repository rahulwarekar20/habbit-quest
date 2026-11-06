"""Coach integration preserves reviewed source goals without treating them as habits."""

import json
from uuid import uuid4

import httpx
import pytest
from conftest import OTHER, PARENT, token
from langchain_core.messages import AIMessage
from test_coach import BEDTIME, snapshot

from habitquest_backend import coach, planning_budget, refined, retrieval, tokenomics
from habitquest_backend import generated_habits as gh
from habitquest_backend import tokenomics_usage as usage
from habitquest_backend.db import transaction
from habitquest_backend.planning_catalog import CatalogError, CatalogRepository
from habitquest_backend.retrieval import RetrievalError


@pytest.fixture(autouse=True)
def no_parent_risk_model(monkeypatch):
    monkeypatch.setattr(
        coach,
        "parent_risk_model",
        lambda *args, **kwargs: pytest.fail("source retrieval must not screen text"),
    )


@pytest.fixture
def family(client, db, settings):
    settings.coach_engine = "refined"
    settings.retrieval_mode = "fixture"
    for user in (PARENT, OTHER):
        db.execute("INSERT INTO hq.users(id,name) VALUES(%s,'Test')", (user,))
    return client.post(
        "/v1/families",
        json={
            "name": "Family",
            "pin": "1234",
            "display_name": "Sam",
            "role": "mother",
        },
    ).json()["id"]


@pytest.fixture
def child(client, family):
    return client.post(f"/v1/families/{family}/children", json={"name": "Alex", "age": 8}).json()["id"]


@pytest.fixture
def goal(db):
    repository = CatalogRepository()
    value = next(
        g for g in repository.all() if repository.eligible(g.goal_id, 8, "home") and g.metadata["age_min"] > 3
    )
    previous = db.execute(
        "SELECT g.is_active,s.record_sha256 FROM hq.goals g LEFT JOIN hq.catalog_goal_sources s ON s.goal_id=g.id WHERE g.id=%s",
        (value.goal_id,),
    ).fetchone()
    db.execute(
        "INSERT INTO hq.goals(id,title,description) VALUES(%s,%s,%s)"
        " ON CONFLICT(id) DO UPDATE SET is_active=true",
        (value.goal_id, value.title, value.description),
    )
    ref = value.source_ref
    db.execute(
        "INSERT INTO hq.catalog_goal_sources"
        "(goal_id,source_id,concept_id,category_id,catalog_version,record_sha256,snapshot_id)"
        " VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(goal_id) DO UPDATE SET record_sha256=excluded.record_sha256",
        (value.goal_id, *(ref[key] for key in coach.SOURCE_FIELDS)),
    )
    yield value
    db.execute("DELETE FROM hq.habit_draft_batches WHERE goal_id=%s", (value.goal_id,))
    db.execute("DELETE FROM hq.coach_goal_suggestions WHERE goal_id=%s", (value.goal_id,))
    if previous is None:
        db.execute("DELETE FROM hq.catalog_goal_sources WHERE goal_id=%s", (value.goal_id,))
        db.execute("DELETE FROM hq.goals WHERE id=%s", (value.goal_id,))
    else:
        db.execute("UPDATE hq.goals SET is_active=%s WHERE id=%s", (previous[0], value.goal_id))
        db.execute(
            "UPDATE hq.catalog_goal_sources SET record_sha256=%s WHERE goal_id=%s",
            (previous[1], value.goal_id),
        )


def post(client, child, **extra):
    return client.post(
        f"/v1/children/{child}/coach/messages",
        json={
            "text": "Alex needs help with this at home.",
            "setting": "home",
            **extra,
        },
    )


def reviewed_goal(goal):
    return coach.Reply(
        "This goal can help.",
        outcome="recommendations",
        goal_recommendations=[{**goal.candidate(), "reason": "A small step for Alex."}],
    )


def test_streamed_recommendations_settle_retrieval_credits_and_keep_three_habit_slot(
    client, settings, family, child, goal, monkeypatch, db
):
    """Real endpoint/ledger path with synthetic provider usage, including embedding/search."""
    settings.ai_mode = "openai"
    settings.habit_generation_enabled = True
    calls = []

    def provider(role, model, counters, search=False):
        calls.append(role)
        request = httpx.Request(
            "POST",
            "https://api.pinecone.io/search" if search else "https://api.openai.com/v1/responses",
            json={"model": model, "max_output_tokens": 50},
        )
        ticket = usage.start(role, request, search=search)
        usage.finish(ticket, httpx.Response(200, json={"model": model, "usage": counters}))

    def coach_turn(*args, **kwargs):
        provider("embedding", "text-embedding-3-small", {"input_tokens": 100})
        provider("pinecone", "documents-search", {"read_units": 1, "egress_bytes": 20000}, True)
        provider("coach", "gpt-6-luna", {"input_tokens": 10, "output_tokens": 5})
        return reviewed_goal(goal)

    def habit_turn(_settings, _goal, _age, body, *args):
        assert body.count == 3
        provider("habit_generation", "gpt-6-luna", {"input_tokens": 10, "output_tokens": 5})
        return [item.model_dump() for item in gh.fake_output(3).items], {}, "habits"

    monkeypatch.setattr(coach, "run_turn", coach_turn)
    monkeypatch.setattr(gh, "generate", habit_turn)
    request_id = str(uuid4())
    response = client.post(
        f"/v1/children/{child}/coach/messages?stream=true",
        json={"text": "Help with a small routine at home.", "setting": "home", "request_id": request_id},
    )
    assert response.status_code == 200
    frames = response.text.split("\n\n")
    reply = next(json.loads(frame.split("data: ", 1)[1]) for frame in frames if "event: result\n" in frame)
    accounting = reply["tokenomics"]
    assert accounting["status"] == "completed"
    assert accounting["credits"] == accounting["budget"]["activity_quotes"]["coach"] == 2
    assert accounting["budget"]["used"] == 2 and accounting["budget"]["pending"] == 1
    assert accounting["automatic_slots"] == [
        {"goal_id": goal.goal_id, "parent_operation_id": accounting["operation_id"]}
    ]
    attempts = db.execute(
        "SELECT role,estimated_cost_usd FROM hq.ai_provider_attempts WHERE operation_id=%s",
        (accounting["operation_id"],),
    ).fetchall()
    costs = dict(attempts)
    assert float(costs["embedding"]) == 0.000002 and float(costs["pinecone"]) == 0.00002
    batch_request = {
        "request_id": str(uuid4()),
        "setting": "home",
        "count": 3,
        "parent_operation_id": accounting["operation_id"],
    }
    url = f"/v1/children/{child}/goals/{goal.goal_id}/habit-drafts"
    generated = client.post(url, json=batch_request)
    assert generated.status_code == 200
    assert len(generated.json()["items"]) == 3
    budget = client.get(f"/v1/families/{family}/ai/budget").json()
    assert budget["used"] == 3 and budget["pending"] == 0
    assert client.post(url, json=batch_request).json()["id"] == generated.json()["id"]
    replayed = post(client, child, text="Help with a small routine at home.", request_id=request_id).json()
    assert replayed["tokenomics"]["credits"] == 2
    assert calls == ["embedding", "pinecone", "coach", "habit_generation"]
    assert client.get(f"/v1/families/{family}/ai/budget").json()["used"] == 3


def test_more_goals_appends_novel_choices_in_order_and_preserves_them_on_reload(
    client, settings, family, child, goal, unselected_goals, monkeypatch, db
):
    first, second, third = unselected_goals
    available = [first]
    calls = []

    def retrieve(self, query, age, setting, **kwargs):
        calls.append((query, set(kwargs["excluded_goal_ids"])))
        return [item.candidate() for item in available if item.goal_id not in kwargs["excluded_goal_ids"]]

    monkeypatch.setattr(retrieval.CatalogRetriever, "retrieve", retrieve)
    initial = post(client, child, text="Alex needs help getting ready in the morning.").json()
    old_card = initial["goal_recommendations"][0]
    assert initial["response_goal_ids"] == [first.goal_id]
    db.execute(
        "INSERT INTO hq.child_goals(child_id,goal_id,status) VALUES(%s,%s,'active')",
        (child, goal.goal_id),
    )
    try:
        available[:] = [first, goal, third, second]
        body = post(client, child, text="Show me other goals for the same concern.", more_goals=True).json()
        expected = [first.goal_id, third.goal_id, second.goal_id]
        assert calls[-1] == (
            "Child A needs help getting ready in the morning.",
            {first.goal_id, goal.goal_id},
        )
        assert body["response_goal_ids"] == [third.goal_id, second.goal_id]
        assert [card["goal_id"] for card in body["goal_recommendations"]] == expected
        assert body["goal_recommendations"][0] == old_card
        loaded = client.get(f"/v1/children/{child}/coach/messages").json()
        assert loaded["goal_recommendations"] == body["goal_recommendations"]
        preload = client.get(f"/v1/families/{family}/coach-context").json()["children"][child]
        assert preload["goal_recommendations"] == body["goal_recommendations"]

        empty = post(client, child, text="Show me other goals for the same concern.", more_goals=True).json()
        assert empty["outcome"] == "no_direct_fit"
        assert empty["response_goal_ids"] == []
        assert empty["goal_recommendations"] == body["goal_recommendations"]
        monkeypatch.setattr(
            coach,
            "run_turn",
            lambda *args, **kwargs: coach.Reply("Try again later.", outcome="generation_unavailable"),
        )
        failed = post(client, child, more_goals=True).json()
        assert failed["goal_recommendations"] == body["goal_recommendations"]
        assert failed["response_goal_ids"] == []
        stranger = {"Authorization": "Bearer " + token(settings, OTHER)}
        assert (
            client.post(
                f"/v1/children/{child}/coach/messages",
                json={"text": "Show me other goals.", "setting": "home", "more_goals": True},
                headers=stranger,
            ).status_code
            == 404
        )
    finally:
        db.execute("DELETE FROM hq.child_goals WHERE child_id=%s", (child,))


def test_more_goals_does_not_duplicate_a_goal_already_saved_by_another_response(
    client, child, goal, monkeypatch, db
):
    monkeypatch.setattr(coach, "run_turn", lambda *args, **kwargs: reviewed_goal(goal))
    first = post(client, child).json()["goal_recommendations"]
    repeated = post(client, child, more_goals=True).json()
    assert repeated["goal_recommendations"] == first
    assert repeated["response_goal_ids"] == []
    assert db.execute("SELECT selection_order FROM hq.coach_goal_suggestions").fetchall() == [(0,)]


@pytest.mark.parametrize("mode", ["missing_setting", "legacy"])
def test_more_goals_requires_source_mode_and_setting(client, settings, child, monkeypatch, mode):
    monkeypatch.setattr(coach, "run_turn", lambda *args, **kwargs: pytest.fail("must not generate"))
    if mode == "legacy":
        settings.retrieval_mode = "local"
    response = post(client, child, more_goals=True, setting=None if mode == "missing_setting" else "home")
    assert response.status_code == 422


def test_source_goal_cards_roundtrip_and_scope(client, settings, family, child, goal, monkeypatch, db):
    monkeypatch.setattr(coach, "run_turn", lambda *args, **kwargs: reviewed_goal(goal))
    result = post(client, child)
    assert result.status_code == 200, result.text
    body = result.json()
    card = body["goal_recommendations"][0]
    assert card["goal_id"] == goal.goal_id and card["setting"] == "home"
    assert card["source_ref"] == goal.source_ref
    assert card["description"] == goal.description
    assert body["suggestions"] == [] and body["token_usage"] == {}
    assert db.execute("SELECT count(*) FROM hq.child_habits").fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM hq.habits WHERE goal_id=%s", (goal.goal_id,)).fetchone()[0] == 0
    assert client.get(f"/v1/children/{child}/coach/messages").json()["goal_recommendations"] == [card]
    assert client.get(f"/v1/families/{family}/coach-context").json()["children"][child][
        "goal_recommendations"
    ] == [card]
    stranger = {"Authorization": "Bearer " + token(settings, OTHER)}
    assert client.get(f"/v1/children/{child}/coach/messages", headers=stranger).status_code == 404
    endpoint = f"/v1/children/{child}/coach/goals/{card['id']}/dismiss"
    assert client.post(endpoint, headers=stranger).status_code == 404
    sibling = client.post(f"/v1/families/{family}/children", json={"name": "Maya", "age": 5}).json()["id"]
    assert client.post(endpoint.replace(child, sibling)).status_code == 404
    with transaction(settings, OTHER) as conn:
        assert conn.execute("SELECT count(*) AS n FROM hq.coach_goal_suggestions").fetchone()["n"] == 0
    assert client.post(endpoint).json()["goal_recommendations"] == []
    assert client.post(endpoint).status_code == 409


def test_goal_failure_keeps_cards_and_dismissed_ids_are_excluded(client, child, goal, monkeypatch, db):
    monkeypatch.setattr(coach, "run_turn", lambda *args, **kwargs: reviewed_goal(goal))
    first = post(client, child).json()["goal_recommendations"]
    seen = {}

    def factory(settings, age, setting, bindings, excluded, pending=()):
        seen.update(age=age, setting=setting, bindings=bindings, excluded=excluded, pending=pending)
        return lambda query, deadline: []

    monkeypatch.setattr(coach, "goal_retriever", factory)
    monkeypatch.setattr(
        coach, "run_turn", lambda *args, **kwargs: coach.Reply("Try again.", outcome="retrieval_unavailable")
    )
    for n in range(25):
        db.execute(
            "INSERT INTO hq.coach_messages(child_id,role,content) VALUES(%s,'parent',%s)",
            (child, f"note {n}"),
        )
    result = post(client, child).json()
    assert result["goal_recommendations"] == first
    assert result["outcome"] == "retrieval_unavailable"
    assert seen["age"] == 8 and seen["setting"] == "home"
    assert seen["bindings"][goal.goal_id] == goal.source_ref
    assert seen["excluded"] == []
    endpoint = f"/v1/children/{child}/coach/goals/{first[0]['id']}/dismiss"
    assert client.post(endpoint).status_code == 200
    post(client, child)
    assert seen["excluded"] == [goal.goal_id]
    assert client.delete(f"/v1/children/{child}/coach/messages").status_code == 204
    assert db.execute("SELECT count(*) FROM hq.coach_goal_suggestions").fetchone()[0] == 0
    post(client, child)
    assert seen["excluded"] == []


@pytest.mark.parametrize("change", ["inactive", "provenance", "age"])
def test_goal_freshness_checked_after_generation(client, child, goal, monkeypatch, db, change):
    def changed(*args, **kwargs):
        if change == "inactive":
            db.execute("UPDATE hq.goals SET is_active=false WHERE id=%s", (goal.goal_id,))
        elif change == "provenance":
            db.execute(
                "UPDATE hq.catalog_goal_sources SET record_sha256=repeat('0',64) WHERE goal_id=%s",
                (goal.goal_id,),
            )
        else:
            db.execute("UPDATE hq.children SET age=3 WHERE id=%s", (child,))
        return reviewed_goal(goal)

    monkeypatch.setattr(coach, "run_turn", changed)
    response = post(client, child)
    assert response.status_code == 409, response.text
    assert client.get(f"/v1/children/{child}/coach/messages").json()["messages"] == []


def test_late_goal_generation_cannot_repopulate_reset(client, child, goal, monkeypatch):
    def finish(*args, **kwargs):
        assert client.delete(f"/v1/children/{child}/coach/messages").status_code == 204
        return reviewed_goal(goal)

    monkeypatch.setattr(coach, "run_turn", finish)
    assert post(client, child).status_code == 409
    assert client.get(f"/v1/children/{child}/coach/messages").json()["goal_recommendations"] == []


@pytest.mark.parametrize("failure", [None, "missing", "catalog", "retrieval", "binding"])
def test_goal_retriever_enforces_import_binding(settings, goal, monkeypatch, failure):
    calls = []

    def retrieve(self, query, age, setting, **kwargs):
        calls.append((query, age, setting, kwargs))
        self.timings.update({"embedding_ms": 0.2, "pinecone_ms": 0.3, "hydration_ms": 0.1})
        if failure == "catalog":
            raise CatalogError("bad_catalog")
        if failure == "retrieval":
            raise RetrievalError("bad_search")
        return [goal.candidate()]

    monkeypatch.setattr(retrieval.CatalogRetriever, "retrieve", retrieve)
    bindings = {} if failure == "missing" else {goal.goal_id: {} if failure == "binding" else goal.source_ref}
    callback = coach.goal_retriever(settings, 8, "home", bindings, ["excluded"])
    if failure in {"catalog", "retrieval", "binding"}:
        with pytest.raises(ValueError):
            callback("Child A needs help", 10.0)
    else:
        assert callback("Child A needs help", 10.0) == [goal.candidate()]
    assert callback.timings == {"embedding_ms": 0.2, "pinecone_ms": 0.3, "hydration_ms": 0.1}
    assert calls[0] == (
        "Child A needs help",
        8,
        "home",
        {"deadline": 10.0, "excluded_goal_ids": ["excluded"]},
    )


@pytest.mark.parametrize("empty", [False, True])
def test_masked_retrieval_and_reviewed_goal_hydration(remote, goal, monkeypatch, empty):
    remote.coach_engine = "refined"
    seen = {}

    def retrieve(query, deadline):
        seen["query"] = query
        return [] if empty else [goal.candidate()]

    retrieve.timings = {"embedding_ms": 2.0, "pinecone_ms": 3.0, "hydration_ms": 1.0}

    class Graph:
        def invoke(self, state, config):
            assert state["goal_mode"] is True
            assert state["goal_candidates"] == ([] if empty else [goal.candidate()])
            return {
                "messages": [AIMessage(content="Help Child A.")],
                "outcome": "advice" if empty else "recommendations",
                "logical_calls": 2,
                "timings": {},
                "token_usage": {"coach_output_tokens": 50},
                "goal_recommendations": []
                if empty
                else [{"goal_id": goal.goal_id, "reason": "Help Child A."}],
            }

    monkeypatch.setattr(refined, "build_refined", lambda *args: Graph())
    result = coach.run_turn(
        remote,
        snapshot(),
        [{"role": "parent", "content": "Alex needs help with bedtime"}],
        "Try for Alex again",
        ["Alex"],
        retrieve_goals=retrieve,
    )
    assert seen["query"] == "Child A needs help with bedtime"
    assert result.text == "Help Alex." and result.logical_calls == 2
    assert result.risk_status == "local_only"
    assert result.token_usage == {"coach_output_tokens": 50}
    assert result.timings["retrieval_ms"] >= 0
    assert result.timings["embedding_ms"] == 2.0 and result.timings["pinecone_ms"] == 3.0
    assert result.timings["hydration_ms"] == 1.0 and result.timings["masking_ms"] >= 0
    if empty:
        assert not result.goal_recommendations
    else:
        assert result.goal_recommendations == [{**goal.candidate(), "reason": "Help Alex."}]


def test_missing_setting_and_retrieval_failure_are_distinct(remote, monkeypatch):
    remote.coach_engine = "refined"
    monkeypatch.setattr(refined, "build_refined", lambda *args: pytest.fail("must not generate"))
    result = coach.run_turn(remote, snapshot(), [], BEDTIME, ["Alex"], setting_required=True)
    assert result.outcome == "clarification" and result.logical_calls == 0
    assert result.risk_status == "local_only" and result.provider_attempts == {}

    def fail(*args):
        raise ValueError("unavailable")

    result = coach.run_turn(remote, snapshot(), [], BEDTIME, ["Alex"], retrieve_goals=fail)
    assert result.outcome == "retrieval_unavailable" and not result.no_habit_match
    assert not result.goal_recommendations


@pytest.mark.parametrize("route", ["coach", "pinecone", "both", "legacy"])
def test_coaching_credit_admission_stops_dispatch_for_every_provider(
    client, settings, child, monkeypatch, route, db
):
    settings.ai_mode = "openai"
    settings.coach_provider = "planning" if route in {"coach", "both"} else "legacy"
    settings.retrieval_mode = "pinecone" if route in {"pinecone", "both"} else "local"
    monkeypatch.setattr(
        planning_budget, "reserve", lambda *args: pytest.fail("Legacy cap is retired from Coach")
    )
    monkeypatch.setattr(
        coach, "run_turn", lambda *args, **kwargs: pytest.fail("No provider work before admission")
    )
    policy = tokenomics.get_policy(settings)
    tokenomics.update_policy(settings, policy["revision"], {"daily_credits": 1, "enforce_budgets": True})
    try:
        response = post(client, child)
        assert response.status_code == 429 and "credits" in response.json()["detail"]
        assert (
            db.execute("SELECT count(*) FROM hq.ai_operations WHERE child_id=%s", (child,)).fetchone()[0] == 0
        )
        assert db.execute("SELECT count(*) FROM hq.ai_provider_attempts").fetchone()[0] == 0
    finally:
        tokenomics.update_policy(
            settings,
            tokenomics.get_policy(settings)["revision"],
            {"daily_credits": policy["daily_credits"], "enforce_budgets": policy["enforce_budgets"]},
        )


def test_risky_message_is_local_even_when_coaching_allowance_cannot_cover_a_turn(
    client, settings, child, monkeypatch, db
):
    settings.ai_mode = "openai"
    settings.coach_provider = "planning"
    monkeypatch.setattr(planning_budget, "reserve", lambda *args: pytest.fail("no external calls"))
    monkeypatch.setattr(
        refined, "build_refined", lambda *args: pytest.fail("Risk guidance must remain local")
    )
    monkeypatch.setattr(retrieval.CatalogRetriever, "retrieve", lambda *args: pytest.fail("No paid lookup"))
    policy = tokenomics.get_policy(settings)
    tokenomics.update_policy(settings, policy["revision"], {"daily_credits": 1, "enforce_budgets": True})
    try:
        result = post(client, child, text="He said he wants to die")
        assert result.status_code == 200
        response = result.json()
        assert response["outcome"] == "risk_redirect" and response["messages"] == []
        assert response["tokenomics"]["credits"] == response["tokenomics"]["pending_credits"] == 0
        assert db.execute("SELECT count(*) FROM hq.ai_provider_attempts").fetchone()[0] == 0
    finally:
        tokenomics.update_policy(
            settings,
            tokenomics.get_policy(settings)["revision"],
            {"daily_credits": policy["daily_credits"], "enforce_budgets": policy["enforce_budgets"]},
        )


@pytest.mark.parametrize("empty", [False, True])
def test_fake_fixture_preview_never_constructs_provider_models(
    client, settings, child, goal, monkeypatch, empty
):
    monkeypatch.setattr(coach, "parent_risk_model", lambda *args, **kwargs: pytest.fail("fake mode"))
    monkeypatch.setattr(refined, "build_refined", lambda *args: pytest.fail("fake mode"))
    monkeypatch.setattr(
        retrieval.CatalogRetriever, "retrieve", lambda *args, **kwargs: [] if empty else [goal.candidate()]
    )
    result = post(client, child)
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["reply"].startswith("Local preview:")
    assert body["logical_calls"] == 0 and body["provider_attempts"] == {}
    assert body["generation_passes"] == 0 and body["safety_revision"] is False
    assert body["risk_status"] == "local_only"
    assert bool(body["goal_recommendations"]) is not empty
    assert body["outcome"] == ("no_direct_fit" if empty else "recommendations")


def test_fake_fixture_requires_an_explicit_setting(client, child, monkeypatch):
    monkeypatch.setattr(coach, "parent_risk_model", lambda *args, **kwargs: pytest.fail("fake mode"))
    response = post(client, child, setting=None).json()
    assert response["outcome"] == "clarification" and response["logical_calls"] == 0
    assert response["goal_recommendations"] == []


def test_reselected_pending_goal_keeps_identity_and_grounds_easier_followup(
    client, child, goal, monkeypatch, db
):
    seen = []

    def retrieve(self, query, age, setting, **kwargs):
        seen.append((query, kwargs["excluded_goal_ids"]))
        return [goal.candidate()]

    monkeypatch.setattr(retrieval.CatalogRetriever, "retrieve", retrieve)
    first = post(client, child, text="Alex needs help with bedtime stalling.").json()["goal_recommendations"][
        0
    ]
    second = post(client, child, text="Can you make that easier?").json()["goal_recommendations"]
    assert len(second) == 1 and second[0]["id"] == first["id"]
    assert seen[-1] == ("Child A needs help with bedtime stalling.", [])
    third = post(client, child, text="Even easier, please.").json()["goal_recommendations"]
    assert len(third) == 1 and third[0]["id"] == first["id"]
    assert seen[-1] == ("Child A needs help with bedtime stalling.", [])
    assert (
        db.execute("SELECT count(*) FROM hq.coach_goal_suggestions WHERE child_id=%s", (child,)).fetchone()[0]
        == 1
    )


def test_pending_evidence_is_canonical_filtered_and_bounded(settings, goal, monkeypatch):
    repository = CatalogRepository()
    choices = [g for g in repository.all() if repository.eligible(g.goal_id, 8, "home")]
    distinct = {}
    for item in choices:
        distinct.setdefault(item.concept_id, item)
    selected = list(distinct.values())[:8]
    bindings = {g.goal_id: g.source_ref for g in [goal, *selected]}
    monkeypatch.setattr(
        retrieval.CatalogRetriever, "retrieve", lambda *args, **kwargs: [g.candidate() for g in selected]
    )
    pending = [
        {
            "goal_id": goal.goal_id,
            "source_ref": goal.source_ref,
            "setting": "home",
            "title": "Forged browser title",
        },
        {"goal_id": selected[0].goal_id, "source_ref": selected[0].source_ref, "setting": "school"},
        {"goal_id": selected[1].goal_id, "source_ref": {}, "setting": "home"},
    ]
    result = coach.goal_retriever(settings, 8, "home", bindings, [], pending)("bedtime", 100)
    assert result[0] == {**goal.candidate(), "pending": True}
    assert len(result) == 6 and len({r["source_ref"]["concept_id"] for r in result}) == 6
    assert all(r["title"] != "Forged browser title" for r in result)


def test_explicit_new_topic_does_not_inject_old_pending_goal_evidence(client, child, goal, monkeypatch):
    monkeypatch.setattr(coach, "run_turn", lambda *args, **kwargs: reviewed_goal(goal))
    post(client, child, text="Bedtime is difficult.")
    captured = []

    def factory(settings, age, setting, bindings, excluded, pending=()):
        captured.append(pending)
        return lambda *args: []

    monkeypatch.setattr(coach, "goal_retriever", factory)
    post(client, child, text="Make that easier")
    assert captured[-1][0]["goal_id"] == goal.goal_id
    post(client, child, text="New topic: homework refusal")
    assert captured[-1] == ()


@pytest.fixture
def unselected_goals(db):
    repository = CatalogRepository()
    existing = {row[0] for row in db.execute("SELECT id FROM hq.goals").fetchall()}
    choices = [
        g for g in repository.all() if repository.eligible(g.goal_id, 8, "home") and g.goal_id not in existing
    ][:3]
    assert len(choices) == 3
    yield choices
    ids = [g.goal_id for g in choices]
    db.execute("DELETE FROM hq.coach_goal_suggestions WHERE goal_id=ANY(%s)", (ids,))
    db.execute("DELETE FROM hq.catalog_goal_sources WHERE goal_id=ANY(%s)", (ids,))
    db.execute("DELETE FROM hq.goals WHERE id=ANY(%s)", (ids,))


@pytest.mark.parametrize(
    "outcome",
    ["recommendations", "generation_unavailable", "safety_unavailable", "safety_rejected", "no_direct_fit"],
)
def test_canonical_browse_and_failed_coach_do_not_import_unselected_goals(
    client, settings, child, unselected_goals, monkeypatch, db, outcome
):
    settings.ai_mode = "openai"
    chosen = unselected_goals[0]
    before = {row[0] for row in db.execute("SELECT id FROM hq.goals").fetchall()}
    source = client.get(f"/v1/children/{child}/goals/{chosen.goal_id}/source", params={"setting": "home"})
    assert source.status_code == 200, source.text
    assert source.json()["source_ref"] == chosen.source_ref
    assert {row[0] for row in db.execute("SELECT id FROM hq.goals").fetchall()} == before
    monkeypatch.setattr(
        retrieval.CatalogRetriever,
        "retrieve",
        lambda *args, **kwargs: [g.candidate() for g in unselected_goals],
    )

    class Reviewed:
        def invoke(self, state, config):
            assert len(state["goal_candidates"]) == 3
            assert {row[0] for row in db.execute("SELECT id FROM hq.goals").fetchall()} == before
            return {
                "messages": [
                    AIMessage(
                        content="Explore this goal." if outcome == "recommendations" else "Please try again."
                    )
                ],
                "outcome": outcome,
                "logical_calls": 2,
                "generation_passes": 1,
                "retried": False,
                "timings": {},
                "goal_recommendations": [{"goal_id": chosen.goal_id, "reason": "A small step to explore."}]
                if outcome == "recommendations"
                else [],
            }

    monkeypatch.setattr(refined, "build_refined", lambda *args: Reviewed())
    response = post(client, child)
    assert response.status_code == 200, response.text
    assert response.json()["outcome"] == outcome
    after = {row[0] for row in db.execute("SELECT id FROM hq.goals").fetchall()}
    assert after - before == ({chosen.goal_id} if outcome == "recommendations" else set())
    assert (
        db.execute(
            "SELECT count(*) FROM hq.habits WHERE goal_id=ANY(%s)", ([g.goal_id for g in unselected_goals],)
        ).fetchone()[0]
        == 0
    )
    if outcome == "recommendations":
        saved = response.json()["goal_recommendations"]
        assert len(saved) == 1 and saved[0]["source_ref"] == chosen.source_ref


def test_lazy_retrieval_preserves_existing_retirement_exclusion(settings, unselected_goals, monkeypatch):
    first, second = unselected_goals[:2]
    seen = {}

    def retrieve(self, query, age, setting, **kwargs):
        seen.update(kwargs)
        return [second.candidate()]

    monkeypatch.setattr(retrieval.CatalogRetriever, "retrieve", retrieve)
    callback = coach.goal_retriever(settings, 8, "home", {first.goal_id: None, "legacy-public": None}, [])
    assert callback("homework", 10) == [second.candidate()]
    assert seen["excluded_goal_ids"] == [first.goal_id]


def test_reviewed_source_mismatch_rolls_back_lazy_goal_creation(
    client, child, unselected_goals, monkeypatch, db
):
    chosen = unselected_goals[0]
    reply = reviewed_goal(chosen)
    reply.goal_recommendations[0]["source_ref"] = {**chosen.source_ref, "snapshot_id": "0" * 64}
    monkeypatch.setattr(coach, "run_turn", lambda *args, **kwargs: reply)
    response = post(client, child)
    assert response.status_code == 409, response.text
    assert db.execute("SELECT id FROM hq.goals WHERE id=%s", (chosen.goal_id,)).fetchone() is None
    assert (
        db.execute(
            "SELECT goal_id FROM hq.catalog_goal_sources WHERE goal_id=%s", (chosen.goal_id,)
        ).fetchone()
        is None
    )
    assert client.get(f"/v1/children/{child}/coach/messages").json()["messages"] == []


def test_reviewed_goals_materialize_in_stable_lock_order_without_reordering_selection(
    client, family, child, unselected_goals, monkeypatch, db
):
    from habitquest_backend import planning_catalog

    selected = sorted(unselected_goals[:2], key=lambda goal: goal.goal_id, reverse=True)
    recommendations = [{**goal.candidate(), "reason": "A useful small step."} for goal in selected]
    reply = coach.Reply(
        "Explore these goals.", outcome="recommendations", goal_recommendations=recommendations
    )
    monkeypatch.setattr(coach, "run_turn", lambda *args, **kwargs: reply)
    original = planning_catalog.materialize_goal
    locks = []

    def materialize(conn, repository, goal_id, age, setting, **kwargs):
        locks.append(goal_id)
        return original(conn, repository, goal_id, age, setting, **kwargs)

    monkeypatch.setattr(planning_catalog, "materialize_goal", materialize)
    response = post(client, child)
    assert response.status_code == 200, response.text
    assert locks == sorted(goal.goal_id for goal in selected)
    expected = [goal.goal_id for goal in selected]
    assert [item["goal_id"] for item in reply.goal_recommendations] == expected
    assert [card["goal_id"] for card in response.json()["goal_recommendations"]] == expected

    # Force UUID sorting to disagree with the reviewed ranking, independent of
    # random UUID generation. No external records reference these new cards.
    ids = {ident: f"00000000-0000-0000-0000-{2 - index:012d}" for index, ident in enumerate(expected)}
    for ident, card_id in ids.items():
        db.execute(
            "UPDATE hq.coach_goal_suggestions SET id=%s WHERE child_id=%s AND goal_id=%s",
            (card_id, child, ident),
        )

    def reloaded():
        return client.get(f"/v1/children/{child}/coach/messages").json()["goal_recommendations"]

    assert [card["goal_id"] for card in reloaded()] == expected
    bootstrap = client.get(f"/v1/families/{family}/coach-context").json()["children"][child]
    assert [card["goal_id"] for card in bootstrap["goal_recommendations"]] == expected

    # A later reviewed selection can change priority while preserving card IDs.
    reply.goal_recommendations.reverse()
    expected.reverse()
    locks.clear()
    repeated = post(client, child, text="Make the other goal the first option.")
    assert repeated.status_code == 200, repeated.text
    assert [card["goal_id"] for card in repeated.json()["goal_recommendations"]] == expected
    assert locks == sorted(expected)
    loaded = reloaded()
    assert [card["goal_id"] for card in loaded] == expected
    assert {card["goal_id"]: card["id"] for card in loaded} == ids
    assert db.execute(
        "SELECT goal_id,selection_order FROM hq.coach_goal_suggestions WHERE child_id=%s"
        " ORDER BY selection_order",
        (child,),
    ).fetchall() == [(ident, index) for index, ident in enumerate(expected)]

    # Unranked pre-migration rows still have deterministic created_at/UUID order.
    db.execute("UPDATE hq.coach_goal_suggestions SET selection_order=DEFAULT WHERE child_id=%s", (child,))
    assert [card["id"] for card in reloaded()] == sorted(ids.values())

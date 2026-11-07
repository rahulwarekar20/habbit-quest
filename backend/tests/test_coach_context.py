"""Trusted context reuse, reset fencing and the refined request boundary."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from conftest import OTHER, PARENT, token
from langchain_core.messages import AIMessage
from test_coach import BEDTIME, accept, add_card, in_plan, say, snapshot

from habitquest_backend import coach, refined
from habitquest_backend.coach_context import CoachContextCache, family_history, reset_marker
from habitquest_backend.coach_tools import Change, Turn
from habitquest_backend.db import one, transaction
from habitquest_backend.llm import record_provider_attempt


@pytest.fixture(autouse=True)
def refined_mode(settings, monkeypatch):
    settings.coach_engine = "refined"
    monkeypatch.setattr(
        coach, "parent_risk_model", lambda *args, **kwargs: pytest.fail("refined must not screen parent text")
    )


@pytest.fixture
def family(client, db):
    for user in (PARENT, OTHER):
        db.execute("INSERT INTO hq.users(id,name) VALUES(%s,'Test')", (user,))
    return client.post(
        "/v1/families", json={"name": "Family", "pin": "1234", "display_name": "Sam", "role": "mother"}
    ).json()["id"]


@pytest.fixture
def child(client, family):
    return client.post(f"/v1/families/{family}/children", json={"name": "Alex", "age": 8}).json()["id"]


class CountingConnection:
    def __init__(self, conn):
        self.conn, self.sql = conn, []

    def execute(self, query, params=()):
        self.sql.append(query)
        return self.conn.execute(query, params)


def load_child(conn, child_id):
    return one(conn, "SELECT id,family_id,name,age FROM hq.children WHERE id=%s", (child_id,))


def test_warm_context_checks_fingerprints_without_reloading_sections(settings, client, child):
    cache = CoachContextCache()
    with transaction(settings, PARENT) as conn:
        selected = load_child(conn, child)
        counted = CountingConnection(conn)
        first = cache.load(counted, selected)
        cold_queries = len(counted.sql)
        second = cache.load(counted, selected)
        assert len(counted.sql) == cold_queries + 1
        assert second.refreshed == []
        assert first.names == ["Alex"] and first.caregivers == ["Sam"]
        first.snapshot.shown.add("forged")
        first.history.append({"role": "parent", "content": "forged"})
        assert "forged" not in cache.load(counted, selected).snapshot.shown
        assert cache.load(counted, selected).history == []


def test_cross_worker_plan_and_catalog_edits_refresh_only_changed_sections(settings, client, child, db):
    cache = CoachContextCache()
    row = db.execute(
        "INSERT INTO hq.child_habits(child_id,habit_id,cue_time,days)"
        " VALUES(%s,'bedtime','19:00','{mon}') RETURNING id",
        (child,),
    ).fetchone()[0]
    with transaction(settings, PARENT) as conn:
        counted = CountingConnection(conn)
        selected = load_child(conn, child)
        cache.load(counted, selected)
        db.execute("UPDATE hq.child_habits SET cue_time='20:00',status='paused' WHERE id=%s", (row,))
        before = len(counted.sql)
        updated = cache.load(counted, selected)
        assert updated.snapshot.plan["bedtime"]["cue_time"] == "20:00"
        assert updated.snapshot.plan["bedtime"]["status"] == "paused"
        assert len(counted.sql) == before + 2  # fingerprint plus changed plan
        db.execute("UPDATE hq.habits SET is_active=false WHERE id='story-time'")
        changed = cache.load(counted, selected)
        assert "catalog" in changed.refreshed
        assert all(h["id"] != "story-time" for goal in changed.snapshot.goals for h in goal.habits)


def test_progress_counts_distinct_dates_and_not_approval_records(settings, client, child, db):
    for _ in range(2):
        row = db.execute(
            "INSERT INTO hq.child_habits(child_id,habit_id,cue_time,days,status)"
            " VALUES(%s,'bedtime','19:00','{mon}','removed') RETURNING id",
            (child,),
        ).fetchone()[0]
        db.execute(
            "INSERT INTO hq.completions(child_habit_id,day,status,decided_by,decided_at)"
            " VALUES(%s,hq.child_today(%s)-1,'approved',%s,now())",
            (row, child, PARENT),
        )
    with transaction(settings, PARENT) as conn:
        result = CoachContextCache().load(conn, load_child(conn, child))
        assert result.snapshot.approved_days["bedtime"] == 1


def test_preloaded_history_is_reused_and_shown_ids_extend_beyond_twenty(settings, client, family, child, db):
    other = client.post(f"/v1/families/{family}/children", json={"name": "Maya", "age": 5}).json()["id"]
    for n in range(30):
        db.execute(
            "INSERT INTO hq.coach_messages(child_id,role,content,shown_habits) VALUES(%s,'parent',%s,%s)",
            (child, f"message {n}", ["bedtime"] if n == 0 else []),
        )
    db.execute(
        "INSERT INTO hq.coach_messages(child_id,role,content) VALUES(%s,'parent','Maya only')", (other,)
    )
    response = client.get(f"/v1/families/{family}/coach-context")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["history_limit"] == 20
    assert len(body["children"][child]["messages"]) == 20
    assert body["children"][child]["messages"][0]["content"] == "message 10"
    assert [m["content"] for m in body["children"][other]["messages"]] == ["Maya only"]
    assert db.execute("SELECT count(*) FROM hq.ai_usage").fetchone()[0] == 0
    with transaction(settings, PARENT) as conn:
        cache = CoachContextCache()
        for row in family_history(conn, family):
            cache.prime_history(row["child_id"], row["messages"], row["shown"], row["revision"])
        counted = CountingConnection(conn)
        context = cache.load(counted, load_child(conn, child))
        assert "bedtime" in context.snapshot.shown
        assert not any("SELECT role,content FROM" in query for query in counted.sql)


def test_family_context_is_scoped_and_empty_families_work(client, settings, family):
    stranger = {"Authorization": "Bearer " + token(settings, OTHER)}
    assert client.get(f"/v1/families/{family}/coach-context", headers=stranger).status_code == 404
    assert client.get(f"/v1/families/{family}/coach-context").json()["children"] == {}


def test_cache_ttl_eviction_and_invalidation(settings, client, family, child):
    other = client.post(f"/v1/families/{family}/children", json={"name": "Maya", "age": 5}).json()["id"]
    cache = CoachContextCache(ttl=0, max_entries=1)
    with transaction(settings, PARENT) as conn:
        selected = load_child(conn, child)
        cache.load(conn, selected)
        assert cache.load(conn, selected).refreshed
        cache.load(conn, load_child(conn, other))
        assert list(cache._entries) == [other]
        cache.invalidate(other)
        cache.invalidate(other)
        assert not cache._entries


def test_reset_fence_rejects_late_reply_even_when_old_thread_was_empty(client, child, monkeypatch, settings):
    def finish_after_reset(*args):
        assert client.delete(f"/v1/children/{child}/coach/messages").status_code == 204
        return coach.Reply("Late reply", Turn(recommendations={"bedtime": "Late recommendation"}))

    monkeypatch.setattr(coach, "run_turn", finish_after_reset)
    response = say(client, child)
    assert response.status_code == 409
    assert client.get(f"/v1/children/{child}/coach/messages").json() == {
        "messages": [],
        "suggestions": [],
        "goal_recommendations": [],
    }
    with transaction(settings, PARENT) as conn:
        assert reset_marker(conn, child) > 0


@pytest.mark.parametrize("outcome", ["safety_unavailable", "generation_unavailable", "no_direct_fit"])
def test_refined_failures_or_abstention_preserve_prior_pending_cards(client, child, monkeypatch, outcome):
    first = say(client, child).json()["suggestions"]
    assert first
    monkeypatch.setattr(coach, "run_turn", lambda *args: coach.Reply("Please try again.", outcome=outcome))
    result = say(client, child).json()
    assert result["suggestions"] == first
    assert not result["messages"][-1]["no_habit_match"]
    assert result["outcome"] == outcome
    assert result["timings"]["request_ms"] >= result["timings"]["context_ms"]


@pytest.mark.parametrize("table,ident", [("habits", "bedtime"), ("goals", "bedtime")])
def test_accept_rechecks_active_habit_and_goal(client, child, db, table, ident):
    card = add_card(db, child, "add")
    db.execute(f"UPDATE hq.{table} SET is_active=false WHERE id=%s", (ident,))
    assert accept(client, card).status_code == 409
    assert in_plan(client, child) == {}


def test_refined_fake_mode_obeys_capacity(settings):
    plan = {str(n): {} for n in range(6)}
    result = coach.run_turn(settings, snapshot(plan=plan), [], BEDTIME, ["Alex"])
    assert result.turn.recommendations == {} and result.outcome == "plan_full"
    assert not result.no_habit_match and result.logical_calls == 0
    assert result.risk_status == "local_only"


def test_refined_local_risk_skips_models(remote, monkeypatch):
    monkeypatch.setattr(
        coach, "parent_risk_model", lambda *args, **kwargs: pytest.fail("must not call model")
    )
    result = coach.run_turn(remote, snapshot(), [], "He said he wants to die", ["Alex"])
    assert result.outcome == "risk_redirect" and result.logical_calls == 0
    assert result.risk_status == "local_risk" and result.provider_attempts == {}


def test_refined_masks_trusted_roles_and_calls_only_generation_and_text_safety(remote, monkeypatch):
    seen = {}

    def graph(settings, snap, turn, label):
        class Graph:
            def invoke(self, state, config):
                seen["messages"] = state["messages"]
                assert state["deadline"] > time.monotonic()
                record_provider_attempt("coach")
                record_provider_attempt("output_safety")
                turn.recommendations = {"bedtime": "Caregiver 1 can help Child A."}
                turn.changes = [Change("story-time", "pause", None, "Help Child A.")]
                return {
                    "messages": [AIMessage(content="Cards help Child A and Caregiver 1.")],
                    "outcome": "recommendations",
                    "logical_calls": 2,
                    "retried": False,
                    "timings": {"generation_ms": 1.0, "safety_ms": 2.0},
                }

        return Graph()

    monkeypatch.setattr(refined, "build_refined", graph)
    history = [
        {"role": "parent", "content": "Alex asks Sam about bedtime"},
        {"role": "note", "content": "[App] A known change."},
        {"role": "coach", "content": "Help Alex."},
    ]
    result = coach.run_turn(
        remote,
        snapshot(),
        history,
        "[App] Alex emails sam@example.com or 212-555-1234",
        ["Alex", ""],
        ["Sam", ""],
    )
    for message in seen["messages"]:
        assert "Alex" not in message.text and "Sam" not in message.text
        assert "sam@example.com" not in message.text and "212-555-1234" not in message.text
    assert result.logical_calls == 2
    assert result.generation_passes == 1 and result.safety_revision is False
    assert result.timings["masking_ms"] >= 0 and result.timings["risk_ms"] >= 0
    assert result.provider_attempts == {"coach": 1, "output_safety": 1}
    assert result.risk_status == "local_only"
    assert seen["messages"][-1].additional_kwargs["origin"] == "parent"
    assert seen["messages"][1].additional_kwargs["origin"] == "app"
    assert result.text == "Cards help Alex and Sam."
    assert result.turn.recommendations["bedtime"] == "Sam can help Alex."
    assert result.turn.changes[0].reason == "Help Alex."


def test_retrieval_exhausting_deadline_does_not_start_generation(remote, monkeypatch):
    def slow_retrieval(*args):
        time.sleep(0.02)
        return []

    monkeypatch.setattr(refined, "build_refined", lambda *args: pytest.fail("deadline already exhausted"))
    limited = remote.model_copy(update={"coach_timeout_seconds": 0.005})
    result = coach.run_turn(limited, snapshot(), [], BEDTIME, ["Alex"], retrieve_goals=slow_retrieval)
    assert result.outcome == "timeout" and result.logical_calls == 0


def test_refined_graph_timeout_withholds_late_mutable_turn(remote, monkeypatch):
    release = threading.Event()

    class Slow:
        def invoke(self, *args):
            release.wait(2)

    monkeypatch.setattr(refined, "build_refined", lambda *args: Slow())
    try:
        result = coach.run_turn(
            remote.model_copy(update={"coach_timeout_seconds": 0.01}), snapshot(), [], BEDTIME, ["Alex"]
        )
        assert result.outcome == "timeout" and result.turn.recommendations == {}
        assert result.generation_passes is None and result.safety_revision is None
    finally:
        release.set()


def test_completed_stage_after_deadline_withholds_result(remote, monkeypatch):
    now = [100.0]
    monkeypatch.setattr(coach, "monotonic", lambda: now[0])

    def late_retrieval(*args):
        now[0] = 1000.0
        return []

    monkeypatch.setattr(refined, "build_refined", lambda *args: pytest.fail("late stage must stop"))
    result = coach.run_turn(remote, snapshot(), [], BEDTIME, ["Alex"], retrieve_goals=late_retrieval)
    assert result.outcome == "timeout"


def test_deadline_expiring_before_dispatch_never_starts_retrieval(remote, monkeypatch):
    now = [100.0]
    monkeypatch.setattr(coach, "monotonic", lambda: now[0])

    def stage(name):
        if name == "retrieval":
            now[0] = 1000.0

    monkeypatch.setattr(coach, "report_stage", stage)
    result = coach.run_turn(
        remote,
        snapshot(),
        [],
        BEDTIME,
        ["Alex"],
        retrieve_goals=lambda *args: pytest.fail("expired request must not dispatch retrieval"),
    )
    assert result.outcome == "timeout" and result.provider_attempts == {}


def test_expired_deadline_never_starts_generation_or_retrieval(remote, monkeypatch):
    now = iter([100.0, 1000.0, 1000.0, 1000.0, 1000.0])
    monkeypatch.setattr(coach, "monotonic", lambda: next(now, 1000.0))
    monkeypatch.setattr(coach, "parent_risk_model", lambda *args, **kwargs: pytest.fail("expired"))
    monkeypatch.setattr(refined, "build_refined", lambda *args: pytest.fail("expired"))
    result = coach.run_turn(remote, snapshot(), [], BEDTIME, ["Alex"])
    assert result.outcome == "timeout" and result.provider_attempts == {}


def test_resume_rechecks_current_eligibility(client, child, db):
    db.execute(
        "INSERT INTO hq.child_habits(child_id,habit_id,cue_time,days,status)"
        " VALUES(%s,'bedtime','19:00','{mon}','paused')",
        (child,),
    )
    card = add_card(db, child, "resume")
    db.execute("UPDATE hq.goals SET is_active=false WHERE id='bedtime'")
    assert accept(client, card).status_code == 409
    assert in_plan(client, child)["bedtime"][1] == "paused"


def test_concurrent_acceptance_cannot_exceed_the_shared_capacity(client, child, db):
    habits = [
        row[0]
        for row in db.execute(
            "SELECT id FROM hq.habits WHERE family_id IS NULL AND tier=1 AND min_age<=8 AND max_age>=8"
            " AND is_active ORDER BY id LIMIT 7"
        ).fetchall()
    ]
    assert len(habits) == 7
    for ident in habits[:5]:
        db.execute(
            "INSERT INTO hq.child_habits(child_id,habit_id,cue_time,days) VALUES(%s,%s,'19:00','{mon}')",
            (child, ident),
        )
    cards = [add_card(db, child, "add", ident) for ident in habits[5:]]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda card: accept(client, card).status_code, cards))
    assert sorted(results) == [200, 409]
    assert len(in_plan(client, child)) == 6


def test_safety_revision_is_reported_separately_from_generation_passes(remote, monkeypatch):
    class Revised:
        def invoke(self, state, config):
            return {
                "messages": [AIMessage(content="Reviewed advice.")],
                "outcome": "advice",
                "logical_calls": 4,
                "generation_passes": 2,
                "retried": True,
                "timings": {"local_validation_ms": 0.5},
            }

    monkeypatch.setattr(refined, "build_refined", lambda *args: Revised())
    result = coach.run_turn(remote, snapshot(), [], BEDTIME, ["Alex"])
    assert result.logical_calls == 4 and result.generation_passes == 2
    assert result.safety_revision is True and result.timings["local_validation_ms"] == 0.5


@pytest.mark.parametrize(
    "prior,text,expected",
    [
        (
            ["Bedtime stalling", "Make that easier", "Even easier, please."],
            "Could you make this much simpler for us to try tonight?",
            "Bedtime stalling",
        ),
        (["Bedtime stalling"], "New topic: homework refusal.", "homework refusal."),
        (
            ["Bedtime stalling"],
            "Different problem: I need help with homework after school.",
            "I need help with homework after school.",
        ),
        (
            ["Bedtime stalling", "New topic: homework refusal.", "Make this easier"],
            "Another option please",
            "homework refusal.",
        ),
        (["Bedtime stalling"], "Reading feels difficult", "Reading feels difficult"),
        (["Bedtime stalling"], "That won't work", "Bedtime stalling"),
        ([], "Make that easier", "Make that easier"),
        (["Bedtime stalling"], "New topic:", "New topic:"),
        (["Bedtime stalling"], "Try for Alex again", "Bedtime stalling"),
    ],
)
def test_shared_retrieval_objective_survives_refinements_but_resets_topics(prior, text, expected):
    from langchain_core.messages import HumanMessage

    from habitquest_backend.coach_context import resolve_retrieval_query

    history = [{"role": "parent", "content": value} for value in prior]
    history.insert(1, {"role": "note", "content": "Unrelated app status"})
    assert resolve_retrieval_query(history, text) == expected
    messages = [HumanMessage(content=value, additional_kwargs={"origin": "parent"}) for value in prior]
    messages.append(HumanMessage(content=text, additional_kwargs={"origin": "parent"}))
    assert refined.retrieval_query(messages) == expected

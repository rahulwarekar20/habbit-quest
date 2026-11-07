"""Generation accounting wraps existing behavior without leaking content or redispatching replays."""

import asyncio
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from pydantic import BaseModel

from habitquest_backend import generation_metering as metering
from habitquest_backend import tokenomics
from habitquest_backend.generation_progress import stream_operation


class Body(BaseModel):
    text: str = "private family content"
    request_id: UUID | None = None
    parent_operation_id: UUID | None = None
    setting: str | None = "home"


@pytest.fixture
def meter(monkeypatch):
    state = SimpleNamespace(
        operation_id=uuid4(),
        family_id=uuid4(),
        child_id=uuid4(),
        user_id=uuid4(),
        begin=[],
        finish=[],
        project=[],
        bound=[],
        transactions=[],
        fingerprints=[],
        dispatches=1,
        replayed=False,
    )

    @contextmanager
    def transaction(settings, user=None, *, kid=None):
        state.transactions.append((user, kid))
        yield object()

    def begin(settings, user, family, activity, request_key, **kwargs):
        state.begin.append((user, family, activity, request_key, kwargs))
        return {
            "id": str(state.operation_id),
            "replayed": state.replayed,
            "status": "completed",
            "result_ref": {},
        }

    @contextmanager
    def track(settings, operation_id):
        assert operation_id == state.operation_id
        yield SimpleNamespace(dispatches=state.dispatches)

    def project(settings, user, family, operation_id):
        state.project.append((user, family, operation_id))
        return {"operation_id": str(operation_id), "credits": 2}

    monkeypatch.setattr(metering, "transaction", transaction)
    monkeypatch.setattr(
        metering, "one", lambda conn, sql, params: {"family_id": state.family_id, "id": state.family_id}
    )
    monkeypatch.setattr(
        tokenomics,
        "fingerprint",
        lambda settings, payload: state.fingerprints.append(payload) or "hmac-digest",
    )
    monkeypatch.setattr(tokenomics, "begin_operation", begin)
    monkeypatch.setattr(
        tokenomics, "finish_operation", lambda settings, operation_id, **kwargs: state.finish.append(kwargs)
    )
    monkeypatch.setattr(tokenomics, "project_operation", project)
    monkeypatch.setattr(
        tokenomics, "bind_slots", lambda settings, user, operation_id, goals: state.bound.append(goals)
    )
    monkeypatch.setattr(metering.tokenomics_usage, "track", track)
    monkeypatch.setattr(metering, "available_batch_goals", lambda settings, user, child, goals: goals[1:])
    return state


def coach_result():
    return {
        "reply": "private generated family advice",
        "mapped_by": "ai",
        "outcome": "reviewed",
        "safety": None,
        "messages": [{"role": "parent", "id": "ignored"}, {"role": "coach", "id": "saved-message"}],
        "response_goal_ids": ["already-prepared", "fresh-goal"],
        "timings": {"generation_ms": 12},
    }


@pytest.mark.parametrize(
    "outcome", ["reviewed", "recommendations", "advice", "clarification", "no_direct_fit", "out_of_scope"]
)
def test_coach_has_one_hold_one_settlement_and_safe_references(settings, meter, outcome):
    request = uuid4()

    @metering.endpoint(settings, "coach", automatic=True)
    def run(child_id, body, user, stream=False):
        return {**coach_result(), "outcome": outcome}

    result = run(meter.child_id, Body(request_id=request), meter.user_id)
    assert result["reply"] == "private generated family advice"
    assert result["tokenomics"]["operation_id"] == str(meter.operation_id)
    assert meter.begin[0][3] == str(request)
    assert meter.begin[0][4]["automatic_slots"] == 4
    assert meter.bound == [["fresh-goal"]]
    assert len(meter.finish) == 1 and meter.finish[0]["useful"] is True
    assert meter.finish[0]["timings"]["generation_ms"] == 12
    assert meter.finish[0]["timings"]["server_ms"] >= 0
    assert "private" not in str(meter.finish)
    assert meter.fingerprints[0]["body"] == {"text": "private family content", "setting": "home"}
    assert meter.begin[0][4]["fingerprint"] == "hmac-digest"


def test_habit_claims_its_parent_slot_without_new_automatic_slots(settings, meter):
    parent, request, batch = uuid4(), uuid4(), uuid4()

    @metering.endpoint(settings, "habit_batch")
    def run(child_id, goal_id, body, user):
        return {"id": batch, "status": "ready", "items": [{"title": "private habit text"}]}

    run(meter.child_id, "goal-a", Body(request_id=request, parent_operation_id=parent), meter.user_id)
    assert meter.begin[0][4]["parent_operation_id"] == parent
    assert meter.begin[0][4]["goal_id"] == "goal-a"
    assert meter.begin[0][4]["automatic_slots"] == 0
    assert meter.finish[0]["result_ref"] == {"batch_id": str(batch), "result_count": 1}
    assert "parent_operation_id" not in meter.fingerprints[0]["body"]


def test_family_request_query_key_and_no_body(settings, meter):
    request, report = uuid4(), uuid4()

    @metering.endpoint(settings, "planner", scope="family")
    def run(family_id, user, request_id=None):
        return {"id": report, "result": {"summary": "private"}}

    run(meter.family_id, meter.user_id, request_id=request)
    assert meter.begin[0][3] == str(request) and meter.begin[0][4]["child_id"] is None
    assert meter.fingerprints[0]["body"] == {}
    assert meter.finish[0]["result_ref"] == {"report_id": str(report)}


def test_kid_scope_does_not_return_parent_budget_metadata(settings, meter):
    @metering.endpoint(settings, "buddy", scope="kid")
    def run(body, kid):
        return {"line": "Try a tiny step!"}

    result = run(Body(), meter.child_id)
    assert result == {"line": "Try a tiny step!"}
    assert meter.transactions == [(None, meter.child_id)]
    assert meter.begin[0][4]["kid"] == meter.child_id
    assert meter.begin[0][4]["child_id"] == meter.child_id
    assert meter.project == []
    assert UUID(meter.begin[0][3])


def test_no_provider_dispatch_does_not_spend_credits(settings, meter):
    meter.dispatches = 0

    @metering.endpoint(settings, "coach", automatic=True)
    def run(child_id, body, user):
        return coach_result()

    run(meter.child_id, Body(setting=None), meter.user_id)
    assert meter.begin[0][4]["automatic_slots"] == 0
    assert meter.finish[0]["useful"] is False
    assert meter.finish[0]["status"] == "completed"


@pytest.mark.parametrize(
    ("mode", "activity", "text", "chargeable"),
    [
        ("fake", "coach", "ordinary advice", False),
        ("openai", "coach", "ordinary advice", True),
        ("openai", "coach", "I might hurt myself", False),
        ("openai", "onboarding", "ordinary advice", True),
        ("openai", "onboarding", "suicide", False),
        ("openai", "planner", "ordinary advice", True),
    ],
)
def test_local_or_urgent_routing_does_not_require_family_credits(
    settings, meter, mode, activity, text, chargeable
):
    settings.ai_mode = mode
    meter.dispatches = 0

    @metering.endpoint(settings, activity)
    def run(child_id, body, user):
        if activity == "onboarding":
            return {"pain_point": None}
        if activity == "planner":
            return {"id": uuid4()}
        return {**coach_result(), "mapped_by": "manual"}

    run(meter.child_id, Body(text=text), meter.user_id)
    assert meter.begin[0][4]["chargeable"] is chargeable


def test_failed_generation_releases_credits_without_erasing_accounting(settings, meter):
    @metering.endpoint(settings, "coach")
    def run(child_id, user):
        raise HTTPException(503, "Provider unavailable")

    with pytest.raises(HTTPException) as error:
        run(meter.child_id, meter.user_id)
    assert error.value.status_code == 503
    assert len(meter.finish) == 1
    assert meter.finish[0]["useful"] is False and meter.finish[0]["status"] == "failed"
    assert meter.project == []


def test_local_fallback_is_not_charged_despite_prior_dispatch(settings, meter):
    @metering.endpoint(settings, "coach")
    def run(child_id, user):
        return {**coach_result(), "mapped_by": "manual"}

    run(meter.child_id, meter.user_id)
    assert meter.finish[0]["useful"] is False and meter.finish[0]["status"] is None


def test_refused_admission_never_calls_business_handler(settings, meter, monkeypatch):
    def deny(*args, **kwargs):
        raise HTTPException(429, "No credits")

    monkeypatch.setattr(tokenomics, "begin_operation", deny)

    @metering.endpoint(settings, "coach")
    def run(child_id, user):
        pytest.fail("Rejected operation dispatched its handler")

    with pytest.raises(HTTPException) as error:
        run(meter.child_id, meter.user_id)
    assert error.value.status_code == 429 and not meter.finish


def test_replayed_endpoint_does_not_dispatch_or_settle_twice(settings, meter, monkeypatch):
    meter.replayed = True
    monkeypatch.setattr(metering, "replay", lambda *args: {"reply": "saved result"})

    @metering.endpoint(settings, "coach")
    def run(child_id, user):
        pytest.fail("Replay dispatched its handler")

    result = run(meter.child_id, meter.user_id)
    assert result["reply"] == "saved result" and result["tokenomics"]
    assert not meter.finish


def test_stream_reenters_accounting_only_for_worker_execution(settings, meter):
    @metering.endpoint(settings, "coach")
    def run(child_id, user, stream=False):
        if stream:
            return stream_operation(lambda: run(child_id, user))
        return coach_result()

    response = run(meter.child_id, meter.user_id, stream=True)
    assert not meter.begin

    async def collect():
        return "".join([part async for part in response.body_iterator])

    output = asyncio.run(collect())
    assert "event: result" in output and "tokenomics" in output
    assert len(meter.begin) == len(meter.finish) == 1


@pytest.mark.parametrize(
    ("activity", "result", "useful"),
    [
        ("coach", {"mapped_by": "ai"}, True),
        ("coach", {"mapped_by": "ai", "safety": {"guidance": "urgent"}}, False),
        ("coach", {"mapped_by": "ai", "outcome": "unavailable"}, False),
        ("habit_batch", {"status": "ready", "items": [1]}, True),
        ("habit_batch", {"status": "ready", "items": []}, False),
        ("habit_batch", {"status": "unavailable"}, False),
        ("onboarding", {"pain_point": {"mapped_by": "ai"}}, True),
        ("onboarding", {"pain_point": {"mapped_by": "keyword"}}, False),
        ("onboarding", {}, False),
        ("review", {}, True),
    ],
)
def test_useful_result_is_based_on_outcome(activity, result, useful):
    assert metering.useful_result(activity, result) is useful


@pytest.mark.parametrize(
    ("activity", "result", "expected"),
    [
        (
            "coach",
            {},
            {
                "message_id": None,
                "goal_ids": [],
                "result_count": 0,
                "outcome": "",
                "mapped_by": "manual",
                "safety": False,
            },
        ),
        (
            "coach",
            {"messages": [{"role": "coach", "id": 7}], "safety": {"guidance": "private"}},
            {
                "message_id": None,
                "goal_ids": [],
                "result_count": 0,
                "outcome": "",
                "mapped_by": "manual",
                "safety": True,
            },
        ),
        ("review", {"id": 8, "result": {"private": "data"}}, {"report_id": "8"}),
        ("onboarding", {"pain_point": {"id": 9, "text": "private"}}, {"pain_point_id": "9"}),
        ("onboarding", {}, {}),
        ("child_screen", {"note": "private"}, {}),
    ],
)
def test_result_references_do_not_copy_family_content(activity, result, expected):
    assert metering.result_reference(activity, result) == expected


class Rows:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, query, args):
        self.query, self.args = query, args
        return self

    def fetchall(self):
        return self.rows


def fake_transaction(monkeypatch, conn):
    @contextmanager
    def transaction(*args, **kwargs):
        yield conn

    monkeypatch.setattr(metering, "transaction", transaction)


def test_saved_usable_batches_release_slots_without_extra_calls(settings, monkeypatch):
    from habitquest_backend import coach_context

    conn = Rows([{"goal_id": "saved"}])
    fake_transaction(monkeypatch, conn)
    monkeypatch.setattr(coach_context, "reset_marker", lambda conn, child: 7)
    assert metering.available_batch_goals(settings, uuid4(), uuid4(), ["new", "saved"]) == ["new"]
    assert conn.args[-1] == 7
    assert "b.child_age=k.age" in conn.query and "b.expires_at>now()" in conn.query


@pytest.mark.parametrize("status", ["running", "reserved", "slot", "cancelled"])
def test_replay_of_inflight_or_cancelled_operation_never_calls_provider(settings, status):
    with pytest.raises(HTTPException) as error:
        metering.replay(settings, uuid4(), "coach", {"status": status}, uuid4(), uuid4())
    assert error.value.status_code == 409


@pytest.mark.parametrize("status", ["completed", "failed"])
def test_replay_without_saved_result_requires_new_request(settings, monkeypatch, status):
    fake_transaction(monkeypatch, object())
    with pytest.raises(HTTPException) as error:
        metering.replay(settings, uuid4(), "coach", {"status": status}, uuid4(), uuid4())
    assert error.value.status_code == 409


def test_replay_coach_reads_only_exact_owned_saved_message(settings, monkeypatch):
    from habitquest_backend import coach

    fake_transaction(monkeypatch, object())
    seen = []
    monkeypatch.setattr(
        metering, "one", lambda conn, query, args: seen.append((query, args)) or {"content": "saved advice"}
    )
    monkeypatch.setattr(coach, "thread_view", lambda conn, child: {"messages": []})
    child = uuid4()
    result = metering.replay(
        settings,
        uuid4(),
        "coach",
        {
            "status": "completed",
            "result_ref": {"message_id": 17, "goal_ids": ["goal"], "mapped_by": "ai", "outcome": "reviewed"},
        },
        child,
        uuid4(),
    )
    assert result["reply"] == "saved advice" and result["response_goal_ids"] == ["goal"]
    assert seen[0][1] == (17, child)


def test_replay_safety_redirect_never_restores_an_earlier_generated_message(settings, monkeypatch):
    from habitquest_backend import ai, coach

    fake_transaction(monkeypatch, object())
    monkeypatch.setattr(coach, "thread_view", lambda conn, child: {"messages": []})
    monkeypatch.setattr(metering, "one", lambda *args: pytest.fail("Safety redirect read a stale message"))
    result = metering.replay(
        settings, uuid4(), "coach", {"status": "failed", "result_ref": {"safety": True}}, uuid4(), uuid4()
    )
    assert result["reply"] == ai.SAFETY_GUIDANCE
    assert result["safety"] == {"guidance": ai.SAFETY_GUIDANCE}
    assert result["response_goal_ids"] == [] and result["mapped_by"] == "manual"


def test_buddy_safe_fallback_is_not_a_successful_model_result():
    from habitquest_backend.insights import BUDDY_FALLBACK

    for line in BUDDY_FALLBACK.values():
        assert not metering.useful_result("buddy", {"line": line})
    assert metering.useful_result("buddy", {"line": "A new bounded encouragement"})


def test_replay_batch_checks_current_age_and_reset(settings, monkeypatch):
    from habitquest_backend import coach_context, generated_habits

    fake_transaction(monkeypatch, object())
    rows = iter([{"id": "batch"}, {"age": 8}])
    monkeypatch.setattr(metering, "one", lambda *args: next(rows))
    monkeypatch.setattr(coach_context, "reset_marker", lambda *args: 4)
    monkeypatch.setattr(
        generated_habits,
        "batch_view",
        lambda row, age, reset_id: {"id": row["id"], "age": age, "reset": reset_id},
    )
    result = metering.replay(
        settings,
        uuid4(),
        "habit_batch",
        {"status": "completed", "result_ref": {"batch_id": "batch"}},
        uuid4(),
        uuid4(),
    )
    assert result == {"id": "batch", "age": 8, "reset": 4}


@pytest.mark.parametrize("activity", ["planner", "review"])
def test_replay_report_is_family_scoped(settings, monkeypatch, activity):
    fake_transaction(monkeypatch, object())
    family = uuid4()
    seen = []
    monkeypatch.setattr(metering, "one", lambda conn, query, args: seen.append(args) or {"id": "report"})
    result = metering.replay(
        settings,
        uuid4(),
        activity,
        {"status": "completed", "result_ref": {"report_id": "report"}},
        None,
        family,
    )
    assert result == {"id": "report"} and seen == [("report", family)]


def test_replay_onboarding_uses_owned_point_and_current_plan(settings, monkeypatch):
    from habitquest_backend import onboarding

    fake_transaction(monkeypatch, object())
    monkeypatch.setattr(metering, "one", lambda *args: {"id": "point", "text": "saved private text"})
    monkeypatch.setattr(onboarding, "plan_view", lambda *args: {"goals": ["goal"]})
    result = metering.replay(
        settings,
        uuid4(),
        "onboarding",
        {"status": "completed", "result_ref": {"pain_point_id": "point"}},
        uuid4(),
        uuid4(),
    )
    assert result["pain_point"]["id"] == "point" and result["plan"] == {"goals": ["goal"]}

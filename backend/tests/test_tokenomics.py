"""Durable accounting, cross-family boundaries and atomic family credit admission."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import psycopg
import pytest
from conftest import OTHER, PARENT
from fastapi import HTTPException
from test_schema import family

from habitquest_backend import tokenomics as t
from habitquest_backend.db import transaction


@pytest.fixture
def ledger(settings, db):
    prices = [row[0] for row in db.execute("SELECT id FROM hq.ai_price_versions").fetchall()]
    db.execute("TRUNCATE hq.tokenomics_policy,hq.tokenomics_policy_audit")
    db.execute(
        "INSERT INTO hq.tokenomics_policy(daily_credits,reference_usd_per_credit,operator_cap_usd,weights) "
        'VALUES(100,.0015,5,\'{"coach":2,"habit_batch":1,"planner":2,"review":2,"onboarding":2,"buddy":0,"child_screen":0}\')'
    )
    db.execute("UPDATE hq.tokenomics_exposure SET legacy_initialized=true,legacy_carryover_usd=.1")
    row = family(db, PARENT)
    yield row
    db.execute("DELETE FROM hq.ai_price_versions WHERE NOT(id=ANY(%s))", (prices,))
    db.execute("TRUNCATE hq.tokenomics_policy,hq.tokenomics_policy_audit")
    db.execute(
        "INSERT INTO hq.tokenomics_policy(daily_credits,reference_usd_per_credit,operator_cap_usd,weights) "
        'VALUES(100,.0015,5,\'{"coach":2,"habit_batch":1,"planner":2,"review":2,"onboarding":2,"buddy":0,"child_screen":0}\')'
    )


def begin(settings, ledger, **kwargs):
    defaults = dict(child_id=ledger["child"], fingerprint=t.fingerprint(settings, {"synthetic": 1}))
    defaults.update(kwargs)
    return t.begin_operation(
        settings, PARENT, ledger["family"], "coach", defaults.pop("request_key", str(uuid4())), **defaults
    )


def patch(settings, **changes):
    return t.update_policy(settings, t.get_policy(settings)["revision"], changes)


def dispatch(settings, op, **kwargs):
    record = dict(
        id=uuid4(),
        invocation_id=uuid4(),
        role="coach",
        provider="api.openai.com",
        model="gpt-6-luna",
        api_mode="responses",
        input_token_bound=1000,
        output_token_bound=1000,
    )
    record.update(kwargs)
    return t.record_attempt(settings, op["id"], record)


def test_family_slots_replay_settlement_and_visibility(settings, ledger, db):
    op = begin(settings, ledger, request_key="same", automatic_slots=4)
    assert len(op["approved_slots"]) == 4
    assert begin(settings, ledger, request_key="same", automatic_slots=4)["replayed"]
    with pytest.raises(HTTPException, match="another request"):
        begin(settings, ledger, request_key="same", fingerprint="changed")
    slots = t.bind_slots(settings, PARENT, op["id"], ["bedtime", "calm"])
    assert len(slots) == 2
    t.finish_operation(
        settings,
        op["id"],
        useful=True,
        result_ref={"goal_ids": ["bedtime", "calm"], "outcome": "advice"},
        timings={"request_ms": 100},
    )
    t.finish_operation(settings, op["id"], useful=False)  # Idempotent; cannot undo the debit.
    view = t.get_operation(settings, PARENT, ledger["family"], op["id"])
    assert view["credits"] == 2 and view["budget"]["pending"] == 2
    assert t.lookup_operation(settings, PARENT, ledger["family"], "coach", "same")["operation_id"] == op["id"]
    assert t.lookup_operation(settings, PARENT, ledger["family"], "coach", "missing") is None
    assert "estimated_cost_usd" not in view and "estimated_cost_usd" not in view["interaction"]
    child = t.begin_operation(
        settings,
        PARENT,
        ledger["family"],
        "habit_batch",
        "batch",
        child_id=ledger["child"],
        parent_operation_id=op["id"],
        goal_id="bedtime",
        fingerprint="batch",
    )
    assert child["budget_window_id"] == op["budget_window_id"]
    assert child["policy_snapshot"] == op["policy_snapshot"]
    assert t.begin_operation(
        settings,
        PARENT,
        ledger["family"],
        "habit_batch",
        "batch",
        child_id=ledger["child"],
        parent_operation_id=op["id"],
        goal_id="bedtime",
        fingerprint="batch",
    )["replayed"]
    t.finish_operation(settings, child["id"], useful=True, result_ref={"batch_id": str(uuid4())})
    patch(settings, show_costs=True)
    view = t.project_operation(settings, PARENT, ledger["family"], child["id"])
    assert view["interaction"]["credits"] == 3
    assert view["interaction"]["batches_ready"] == 1
    assert view["interaction"]["batches_pending"] == 1
    assert "estimated_cost_usd" in view["budget"]
    assert t.record_observation(settings, PARENT, ledger["family"], op["id"], {"response_ms": 200})[
        "recorded"
    ]
    t.record_observation(settings, PARENT, ledger["family"], op["id"], {"response_ms": 200})
    with pytest.raises(HTTPException, match="already recorded"):
        t.record_observation(settings, PARENT, ledger["family"], op["id"], {"response_ms": 201})


def test_partial_allowance_and_tracking_overage(settings, ledger):
    patch(settings, daily_credits=3, enforce_budgets=True)
    op = begin(settings, ledger, automatic_slots=4)
    assert len(op["approved_slots"]) == 1
    with pytest.raises(HTTPException) as error:
        begin(settings, ledger)
    assert error.value.status_code == 429
    patch(settings, enforce_budgets=False)
    another = begin(settings, ledger, automatic_slots=4)
    assert len(another["approved_slots"]) == 4
    assert t.family_budget(settings, PARENT, ledger["family"])["overage"] == 6
    t.finish_operation(settings, op["id"], useful=False)
    assert t.family_budget(settings, PARENT, ledger["family"])["pending"] == 6
    patch(settings, enforce_budgets=True)
    with pytest.raises(HTTPException):
        begin(settings, ledger)


def test_parallel_last_credits_are_atomic(settings, ledger):
    patch(settings, daily_credits=2, enforce_budgets=True)

    def run(_):
        try:
            return begin(settings, ledger)["id"]
        except HTTPException as error:
            return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    assert sum(isinstance(x, str) for x in results) == 1
    assert results.count(429) == 1


def test_window_midnight_timezone_dst_and_parent_inheritance(settings, ledger, db, monkeypatch):
    db.execute("UPDATE hq.families SET timezone='America/New_York' WHERE id=%s", (ledger["family"],))
    now = datetime(2026, 11, 1, 4, 30, tzinfo=UTC)
    monkeypatch.setattr(t, "_now", lambda: now)
    op = begin(settings, ledger, automatic_slots=1)
    t.bind_slots(settings, PARENT, op["id"], ["bedtime"])
    t.finish_operation(settings, op["id"], useful=True)
    window = db.execute(
        "SELECT starts_at,ends_at FROM hq.family_ai_windows WHERE id=%s", (op["budget_window_id"],)
    ).fetchone()
    assert window[1] - window[0] == timedelta(hours=25)
    db.execute("UPDATE hq.families SET timezone='Asia/Tokyo' WHERE id=%s", (ledger["family"],))
    assert begin(settings, ledger)["budget_window_id"] == op["budget_window_id"]
    now = window[1] + timedelta(seconds=1)
    # The slot's lifetime is based on its actual dispatch admission, separately from calendar boundaries.
    child = t.begin_operation(
        settings,
        PARENT,
        ledger["family"],
        "habit_batch",
        "midnight",
        child_id=ledger["child"],
        parent_operation_id=op["id"],
        goal_id="bedtime",
    )
    assert child["budget_window_id"] == op["budget_window_id"]
    new = begin(settings, ledger)
    assert new["budget_window_id"] != op["budget_window_id"]
    t.finish_operation(settings, child["id"], useful=True)
    assert t.family_budget(settings, PARENT, ledger["family"])["used"] == 0


def test_slot_expiry_cancelled_local_completion_and_zero_weight(settings, ledger, db):
    weights = t.get_policy(settings)["weights"]
    weights["habit_batch"] = 0
    patch(settings, enforce_budgets=True, weights=weights)
    op = begin(settings, ledger, automatic_slots=2)
    t.bind_slots(settings, PARENT, op["id"], ["bedtime"])
    with pytest.raises(HTTPException, match="bindings"):
        t.bind_slots(settings, PARENT, op["id"], ["changed"])
    t.finish_operation(settings, op["id"], useful=False, status="completed")
    assert t.get_operation(settings, PARENT, ledger["family"], op["id"])["credits"] == 0
    db.execute(
        "UPDATE hq.ai_operations SET created_at=now()-interval '20 minutes' WHERE parent_operation_id=%s",
        (op["id"],),
    )
    assert t.family_budget(settings, PARENT, ledger["family"])["pending"] == 0
    assert not t.get_operation(settings, PARENT, ledger["family"], op["id"])["automatic_slots"]
    cancel = begin(settings, ledger)
    t.finish_operation(settings, cancel["id"], useful=False, status="cancelled")


def test_scope_and_private_sql_boundaries(settings, ledger, db):
    other = family(db, OTHER, "Another")
    op = begin(settings, ledger)
    for call in (
        lambda: t.family_budget(settings, OTHER, ledger["family"]),
        lambda: t.begin_operation(settings, PARENT, other["family"], "coach", "wrong"),
        lambda: t.get_operation(settings, OTHER, other["family"], op["id"]),
        lambda: t.record_observation(settings, OTHER, other["family"], op["id"], {"response_ms": 1}),
        lambda: begin(settings, ledger, child_id=other["child"]),
        lambda: t.get_operation(settings, PARENT, ledger["family"], uuid4()),
    ):
        with pytest.raises(HTTPException) as error:
            call()
        assert error.value.status_code == 404
    kid = t.begin_operation(
        settings, None, ledger["family"], "child_screen", "kid", child_id=ledger["child"], kid=ledger["child"]
    )
    assert kid["quoted_credits"] == 0
    with transaction(settings, PARENT) as conn, pytest.raises(psycopg.errors.InsufficientPrivilege):
        conn.execute("SELECT * FROM hq.ai_operations")
    with transaction(settings, PARENT) as conn, pytest.raises(psycopg.errors.InsufficientPrivilege):
        conn.execute("SELECT hq.set_planning_budget_cap(100)")
    with t.admin_tx(settings) as conn, pytest.raises(psycopg.errors.InsufficientPrivilege):
        conn.execute("SELECT name FROM hq.children")
    with t.admin_tx(settings) as conn, pytest.raises(psycopg.errors.InsufficientPrivilege):
        conn.execute("SELECT fingerprint FROM hq.ai_operations")


def test_attempt_costs_immutable_prices_and_unknown_exposure(settings, ledger):
    op = begin(settings, ledger)
    attempt = dispatch(settings, op)
    assert attempt["reserved_usd"] == 0.0006
    t.finish_operation(settings, op["id"], useful=False)
    assert t.admin_metrics(settings)["summary"]["outstanding_exposure_usd"] == pytest.approx(0.0006)
    done = t.record_attempt(
        settings,
        op["id"],
        {
            "id": attempt["id"],
            "status": "completed",
            "input_tokens": 100,
            "cached_input_tokens": 50,
            "output_tokens": 200,
            "reasoning_tokens": 150,
            "duration_ms": 123,
            "returned_model": "snapshot",
            "request_id": "public-request-id",
        },
    )
    assert done["estimated_cost_usd"] == pytest.approx(0.0001055)
    assert done["exposure_usd"] == done["estimated_cost_usd"]
    assert (
        t.record_attempt(settings, op["id"], {"id": attempt["id"], "status": "dispatched"})["status"]
        == "completed"
    )
    metrics = t.admin_metrics(settings)
    assert metrics["summary"]["outstanding_exposure_usd"] == 0
    assert metrics["summary"]["known_cost_usd"] == pytest.approx(0.0001055)
    assert metrics["activities"][0]["p95_latency_ms"] is None
    assert metrics["recommendations"]
    assert t.admin_generations(settings)[0]["attempt_count"] == 1
    assert metrics["model_costs"][0]["mean_cost_usd"] == pytest.approx(0.0001055)
    oldop = begin(settings, ledger)
    t.add_price(
        settings,
        {
            "provider": "OpenAI",
            "model": "gpt-6-luna",
            "kind": "chat",
            "source_url": "https://example.com/pricing",
            "status": "manual",
            "input_rate": 1,
            "output_rate": 5,
        },
    )
    assert dispatch(settings, oldop)["reserved_usd"] == 0.0006
    assert dispatch(settings, begin(settings, ledger))["reserved_usd"] == 0.006
    assert len(t.list_prices(settings)) >= 5
    assert t.admin_audit(settings)[0]["action"] == "price"


@pytest.mark.parametrize(
    "reports,expected",
    [
        ([], (None, None, "not_applicable")),
        ([{"role": "pinecone", "read_units": 2}], (None, None, "not_applicable")),
        ([{}], (None, None, "unavailable")),
        ([{"input_tokens": 17}], (17, None, "partial")),
        ([{"output_tokens": 0}], (None, 0, "partial")),
        ([{"input_tokens": 0, "output_tokens": 0}], (0, 0, "measured")),
        ([{"input_tokens": 10, "output_tokens": 4}, {}], (10, 4, "partial")),
        (
            [{"input_tokens": 10, "output_tokens": 4}, {"input_tokens": 8}],
            (18, 4, "partial"),
        ),
    ],
)
def test_generation_history_distinguishes_actual_tokens_from_missing_usage(
    settings, ledger, reports, expected
):
    op = begin(settings, ledger)
    for report in reports:
        attempt = dispatch(settings, op, role=report.get("role", "coach"))
        t.record_attempt(settings, op["id"], {"id": attempt["id"], "status": "failed", **report})
    row = t.admin_generations(settings)[0]
    assert (row["input_tokens"], row["output_tokens"], row["token_usage_status"]) == expected
    assert row["attempt_count"] == len(reports)


def test_generation_history_counts_retry_usage_without_cache_reasoning_or_child_double_counting(
    settings, ledger
):
    parent = begin(settings, ledger, automatic_slots=1)
    t.bind_slots(settings, PARENT, parent["id"], ["bedtime"])
    invocation = uuid4()
    failed = dispatch(settings, parent, invocation_id=invocation)
    t.record_attempt(
        settings,
        parent["id"],
        {"id": failed["id"], "status": "failed", "input_tokens": 10, "output_tokens": 2},
    )
    retry = dispatch(settings, parent, invocation_id=invocation)
    retry_usage = {
        "id": retry["id"],
        "status": "completed",
        "input_tokens": 100,
        "output_tokens": 20,
        "cached_input_tokens": 80,
        "cache_write_tokens": 5,
        "reasoning_tokens": 15,
    }
    t.record_attempt(settings, parent["id"], retry_usage)
    t.record_attempt(settings, parent["id"], retry_usage)
    embedding = dispatch(settings, parent, role="embedding")
    t.record_attempt(
        settings,
        parent["id"],
        {"id": embedding["id"], "status": "completed", "input_tokens": 7, "output_tokens": 0},
    )
    search = dispatch(settings, parent, role="pinecone")
    t.record_attempt(settings, parent["id"], {"id": search["id"], "status": "completed", "read_units": 3})
    t.finish_operation(settings, parent["id"], useful=True, result_ref={"goal_ids": ["bedtime"]})
    child = t.begin_operation(
        settings,
        PARENT,
        ledger["family"],
        "habit_batch",
        "child-tokens",
        child_id=ledger["child"],
        parent_operation_id=parent["id"],
        goal_id="bedtime",
        fingerprint="child-tokens",
    )
    habit = dispatch(settings, child, role="habit_generation")
    t.record_attempt(
        settings,
        child["id"],
        {"id": habit["id"], "status": "completed", "input_tokens": 1000, "output_tokens": 200},
    )
    rows = t.admin_generations(settings)
    own = next(row for row in rows if row["id"] == parent["id"])
    assert (own["input_tokens"], own["output_tokens"], own["token_usage_status"]) == (117, 22, "measured")
    assert own["attempt_count"] == 4
    nested = next(row for row in rows if row["id"] == child["id"])
    assert (nested["input_tokens"], nested["output_tokens"], nested["token_usage_status"]) == (
        1000,
        200,
        "measured",
    )
    assert nested["parent_operation_id"] == parent["id"]
    assert t.admin_generations(settings, limit=1, offset=1) == rows[1:2]


def test_reference_prices_follow_configuration_and_price_revisions(settings, ledger):
    settings = settings.model_copy(
        update={
            "ai_mode": "openai",
            "coach_engine": "refined",
            "coach_provider": "planning",
            "openai_model": "deepseek-ai/DeepSeek-V4.1-Flash-1017",
            "openai_base_url": "https://api.tokenfactory.us-north1.nebius.com/v1",
            "habit_generation_enabled": True,
            "retrieval_mode": "pinecone",
        }
    )

    def references():
        return {r["activity"]: r for r in t.admin_metrics(settings)["recommendations"]}

    assert references()["coach"]["reference_cost_usd"] == 0.0021877
    assert references()["habit_batch"]["reference_cost_usd"] == 0.00078745
    t.add_price(
        settings,
        {
            "provider": "OpenAI",
            "model": "gpt-6-luna",
            "kind": "chat",
            "source_url": "https://example.com/pricing",
            "status": "manual",
            "input_rate": 0.1,
            "output_rate": 3,
            "cached_input_rate": None,
        },
    )
    assert references()["coach"]["recommended_credits"] == 3
    assert references()["habit_batch"]["reference_cost_usd"] == 0.00335495
    settings.coach_model = "new-unmeasured-model"
    assert references()["coach"]["recommended_credits"] is None
    settings.coach_model = "gpt-6-luna"
    settings.openai_embedding_model = "new-embedding"
    assert references()["coach"]["recommended_credits"] is None
    settings.openai_embedding_model = "text-embedding-3-small"
    t.add_price(
        settings,
        {
            "provider": "OpenAI",
            "model": "gpt-6-luna",
            "kind": "chat",
            "source_url": "https://example.com/pricing",
            "status": "manual",
            "input_rate": 0.1,
            "output_rate": None,
        },
    )
    assert references()["coach"]["reference_cost_usd"] is None
    assert references()["habit_batch"]["reference_cost_usd"] is None


def test_local_guidance_survives_exhausted_budgets_and_saved_result_lookup(settings, ledger, db):
    patch(settings, daily_credits=1, enforce_budgets=True, operator_cap_usd=0.0001)
    op = begin(settings, ledger, chargeable=False, automatic_slots=4)
    assert op["quoted_credits"] == 0 and not op["approved_slots"]
    message = str(uuid4())
    t.finish_operation(
        settings,
        op["id"],
        useful=False,
        status="completed",
        result_ref={"message_id": message, "safety": True},
    )
    assert (
        t.lookup_result(settings, PARENT, ledger["family"], "coach", "message_id", message)["operation_id"]
        == op["id"]
    )
    assert t.lookup_result(settings, PARENT, ledger["family"], "coach", "message_id", uuid4()) is None
    with pytest.raises(HTTPException):
        t.lookup_result(settings, PARENT, ledger["family"], "coach", "private_text", "x")


def test_parent_all_choices_completion_and_goal_replay_binding(settings, ledger):
    op = begin(settings, ledger, automatic_slots=1)
    t.bind_slots(settings, PARENT, op["id"], ["bedtime"])
    t.finish_operation(settings, op["id"], useful=True)
    child = t.begin_operation(
        settings,
        PARENT,
        ledger["family"],
        "habit_batch",
        "one",
        child_id=ledger["child"],
        parent_operation_id=op["id"],
        goal_id="bedtime",
    )
    with pytest.raises(HTTPException):
        t.begin_operation(
            settings,
            PARENT,
            ledger["family"],
            "habit_batch",
            "one",
            child_id=ledger["child"],
            parent_operation_id=op["id"],
            goal_id="calm",
        )
    t.finish_operation(settings, child["id"], useful=True)
    view = t.get_operation(settings, PARENT, ledger["family"], op["id"])
    assert view["interaction"]["complete"] and not view["interaction"]["partial"]
    assert view["interaction"]["all_choices_ready_ms"] > 0


def test_search_embedding_usage_and_no_double_count(settings, ledger):
    op = begin(settings, ledger)
    emb = dispatch(
        settings,
        op,
        role="embedding",
        model="text-embedding-3-small",
        api_mode="embeddings",
        output_token_bound=None,
    )
    result = t.record_attempt(
        settings, op["id"], {"id": emb["id"], "status": "completed", "input_tokens": 100}
    )
    assert result["estimated_cost_usd"] == 0.000002
    search = dispatch(
        settings,
        op,
        role="pinecone",
        provider="api.pinecone.io",
        model="documents-search",
        api_mode="documents_search",
        estimated_read_units_bound=1,
        egress_bytes_bound=20000,
    )
    result = t.record_attempt(
        settings,
        op["id"],
        {
            "id": search["id"],
            "status": "completed",
            "read_units": 1,
            "egress_bytes": 20000,
            "read_units_precision": "rounded_up",
        },
    )
    assert result["estimated_cost_usd"] == 0.00002 and result["cost_status"] == "planning"
    t.finish_operation(settings, op["id"], useful=True)
    patch(settings, show_costs=True)
    view = t.get_operation(settings, PARENT, ledger["family"], op["id"])
    assert view["estimated_cost_usd"] == 0.000022 and view["cost_status"] == "planning"
    assert view["credits"] == 2
    assert view["interaction"]["cost_status"] == "planning"
    assert view["budget"]["cost_status"] == "planning"
    metrics = t.admin_metrics(settings)
    assert metrics["summary"]["planning_cost_usd"] == 0.00002
    assert metrics["summary"]["matched_tariff_cost_usd"] == 0.000002
    assert metrics["summary"]["tariff_coverage"] == 0.5
    assert metrics["activities"][0]["matched_tariff_mean_cost_usd"] is None
    assert metrics["activities"][0]["tariff_coverage"] == 0.5
    pinecone = next(row for row in metrics["model_costs"] if row["provider"] == "Pinecone")
    assert pinecone["matched_tariff_mean_cost_usd"] is None
    assert pinecone["tariff_coverage"] == 0


@pytest.mark.parametrize("activity", ["buddy", "child_screen"])
def test_child_helpers_cannot_compete_for_parent_credits(settings, ledger, activity):
    weights = t.get_policy(settings)["weights"]
    weights[activity] = 1
    with pytest.raises(HTTPException, match="zero-credit"):
        patch(settings, weights=weights)


def test_enforced_attempt_bounds_cap_and_tracking_bypass(settings, ledger, db):
    patch(settings, enforce_budgets=True, operator_cap_usd=0.1005)
    op = begin(settings, ledger)
    with pytest.raises(HTTPException) as error:
        dispatch(settings, op)
    assert error.value.status_code == 429
    patch(settings, operator_cap_usd=5)
    for changes in (
        {"model": "unknown"},
        {"input_token_bound": None},
        {
            "provider": "Pinecone",
            "model": "documents-search",
            "estimated_read_units_bound": 1,
            "egress_bytes_bound": 20000,
        },
    ):
        with pytest.raises(HTTPException, match="tariff"):
            dispatch(settings, op, **changes)
    with pytest.raises(HTTPException, match="verified spending"):
        begin(settings, ledger, reserve_usd=0.01)
    db.execute("UPDATE hq.tokenomics_exposure SET legacy_initialized=false")
    with pytest.raises(HTTPException, match="Legacy usage"):
        dispatch(settings, op)
    patch(settings, enforce_budgets=False)
    unknown = dispatch(settings, op, model="unknown", input_token_bound=None)
    t.record_attempt(settings, op["id"], {"id": unknown["id"], "status": "failed", "error_code": "timeout"})
    t.finish_operation(settings, op["id"], useful=False)
    patch(settings, show_costs=True)
    assert t.get_operation(settings, PARENT, ledger["family"], op["id"])["cost_status"] == "unknown"


@pytest.mark.parametrize("history", ["unpriced", "unbounded", "planning"])
def test_enabling_enforcement_rejects_unreconciled_history(settings, ledger, history):
    op = begin(settings, ledger)
    changes = (
        {"model": "unpriced-model"}
        if history == "unpriced"
        else {"input_token_bound": None}
        if history == "unbounded"
        else {
            "provider": "Pinecone",
            "model": "documents-search",
            "api_mode": "documents_search",
            "estimated_read_units_bound": 1,
            "egress_bytes_bound": 20000,
        }
    )
    attempt = dispatch(settings, op, **changes)
    result = {"status": "failed", "error_code": "timeout"}
    if history == "planning":
        result = {"status": "completed", "read_units": 1, "egress_bytes": 20000}
    t.record_attempt(settings, op["id"], {"id": attempt["id"], **result})
    t.finish_operation(settings, op["id"], useful=history == "planning")
    patch(settings, enforce_budgets=True)
    next_op = begin(settings, ledger)
    with pytest.raises(HTTPException, match="Earlier provider usage") as error:
        dispatch(settings, next_op)
    assert error.value.status_code == 503
    local = begin(settings, ledger, chargeable=False)
    t.finish_operation(settings, local["id"], useful=False, status="completed")
    assert t.get_operation(settings, PARENT, ledger["family"], local["id"])["credits"] == 0


@pytest.mark.parametrize("free", [False, True])
def test_enforcement_keeps_bounded_unknown_exposure_including_zero_rates(settings, ledger, free):
    if free:
        t.add_price(
            settings,
            {
                "provider": "OpenAI",
                "model": "free-model",
                "kind": "chat",
                "source_url": "https://example.com/pricing",
                "status": "manual",
                "input_rate": 0,
                "output_rate": 0,
            },
        )
    op = begin(settings, ledger)
    attempt = dispatch(settings, op, model="free-model" if free else "gpt-6-luna")
    assert attempt["reserved_usd"] == (0 if free else 0.0006)
    t.record_attempt(settings, op["id"], {"id": attempt["id"], "status": "failed"})
    t.finish_operation(settings, op["id"], useful=False)
    patch(settings, enforce_budgets=True, operator_cap_usd=0.102)
    next_attempt = dispatch(settings, begin(settings, ledger))
    assert next_attempt["reserved_usd"] == 0.0006
    assert t.admin_metrics(settings)["summary"]["outstanding_exposure_usd"] == pytest.approx(
        0.0006 if free else 0.0012
    )


def test_stale_running_operation_releases_credits_but_keeps_attempt_exposure(settings, ledger, db):
    op = begin(settings, ledger, automatic_slots=2, request_key="abandoned")
    t.bind_slots(settings, PARENT, op["id"], ["bedtime", "calm"])
    attempt = dispatch(settings, op)
    cutoff = t._now() - t._recovery_delay(settings)
    db.execute(
        "UPDATE hq.ai_operations SET created_at=%s WHERE id=%s", (cutoff + timedelta(seconds=30), op["id"])
    )
    assert t.family_budget(settings, PARENT, ledger["family"])["pending"] == 4
    db.execute(
        "UPDATE hq.ai_operations SET created_at=%s WHERE id=%s", (cutoff - timedelta(seconds=1), op["id"])
    )
    view = t.get_operation(settings, PARENT, ledger["family"], op["id"])
    assert view["status"] == "failed" and view["credits"] == view["budget"]["pending"] == 0
    assert not view["automatic_slots"]
    assert t.admin_metrics(settings)["summary"]["outstanding_exposure_usd"] == pytest.approx(0.0006)
    replay = begin(settings, ledger, request_key="abandoned")
    assert replay["replayed"] and replay["status"] == "failed"
    with pytest.raises(HTTPException, match="another provider dispatch"):
        dispatch(settings, replay)
    # A late response can reconcile actual spend, but cannot charge the family a second time.
    t.record_attempt(
        settings,
        op["id"],
        {"id": attempt["id"], "status": "completed", "input_tokens": 100, "output_tokens": 100},
    )
    t.finish_operation(settings, op["id"], useful=True)
    assert t.admin_metrics(settings)["summary"]["outstanding_exposure_usd"] == 0
    assert t.admin_metrics(settings)["summary"]["known_cost_usd"] == pytest.approx(0.00006)
    assert t.get_operation(settings, PARENT, ledger["family"], op["id"])["credits"] == 0


def test_stale_undispatched_operation_releases_dollar_headroom_and_keeps_key(settings, ledger, db):
    op = begin(settings, ledger, request_key="never-dispatched", reserve_usd=0.01)
    db.execute(
        "UPDATE hq.ai_operations SET created_at=%s WHERE id=%s",
        (t._now() - t._recovery_delay(settings) - timedelta(seconds=1), op["id"]),
    )
    replay = begin(settings, ledger, request_key="never-dispatched")
    assert replay["replayed"] and replay["status"] == "failed"
    assert replay["exposure_usd"] == replay["pending_credits"] == 0
    assert replay["cost_status"] == "no_provider_cost"


def test_claimed_slot_starts_recovery_clock_without_moving_its_budget_window(settings, ledger, db):
    op = begin(settings, ledger, automatic_slots=1)
    t.bind_slots(settings, PARENT, op["id"], ["bedtime"])
    t.finish_operation(settings, op["id"], useful=True)
    old = t._now() - timedelta(minutes=5)
    db.execute("UPDATE hq.ai_operations SET created_at=%s WHERE parent_operation_id=%s", (old, op["id"]))
    child = t.begin_operation(
        settings,
        PARENT,
        ledger["family"],
        "habit_batch",
        "claimed",
        child_id=ledger["child"],
        parent_operation_id=op["id"],
        goal_id="bedtime",
    )
    assert datetime.fromisoformat(child["created_at"]) > old + timedelta(minutes=4)
    assert child["budget_window_id"] == op["budget_window_id"]
    assert child["policy_snapshot"] == op["policy_snapshot"]
    assert t.get_operation(settings, PARENT, ledger["family"], child["id"])["status"] == "reserved"


def test_recovery_bound_covers_configured_helper_retries(settings):
    assert t._recovery_delay(settings) == timedelta(seconds=420)
    settings.embedding_timeout_seconds = 60
    settings.embedding_max_retries = 2
    settings.pinecone_timeout_seconds = 60
    assert t._recovery_delay(settings) == timedelta(seconds=540)
    settings.habit_generation_timeout_seconds = 120
    settings.habit_generation_max_retries = 2
    settings.ai_timeout_seconds = 60
    assert t._recovery_delay(settings) >= timedelta(seconds=540)


def test_operation_reserve_does_not_double_count_and_family_delete_retains_cost(settings, ledger, db):
    patch(settings, enforce_budgets=True, operator_cap_usd=0.101)
    op = begin(settings, ledger, reserve_usd=0.001, exposure_known=True)
    attempt = dispatch(settings, op)
    assert t.admin_metrics(settings)["summary"]["outstanding_exposure_usd"] == 0.001
    t.record_attempt(
        settings,
        op["id"],
        {"id": attempt["id"], "status": "completed", "input_tokens": 0, "output_tokens": 0},
    )
    t.finish_operation(settings, op["id"], useful=True)
    db.execute("DELETE FROM hq.families WHERE id=%s", (ledger["family"],))
    assert t.admin_generations(settings)[0]["family_id"] is None


@pytest.mark.parametrize(
    "patch_value",
    [
        {},
        {"surprise": 1},
        {"daily_credits": 0},
        {"daily_credits": True},
        {"enforce_budgets": 1},
        {"weights": {}},
        {"weights": {"coach": -1}},
        {"operator_cap_usd": 0},
        {"reference_usd_per_credit": -1},
        {"operator_cap_usd": "nan"},
        {"operator_cap_usd": "bad"},
    ],
)
def test_policy_validation(settings, ledger, patch_value):
    with pytest.raises(HTTPException):
        t.update_policy(settings, t.get_policy(settings)["revision"], patch_value)


def test_missing_accounting_state_conflict_and_bad_fingerprints(settings, ledger, db):
    with pytest.raises(HTTPException, match="Configuration changed"):
        t.update_policy(settings, 0, {"daily_credits": 20})
    settings.jwt_secret = None
    with pytest.raises(HTTPException, match="signing secret"):
        t.fingerprint(settings, {})
    db.execute("DELETE FROM hq.tokenomics_exposure")
    with pytest.raises(HTTPException, match="unavailable"):
        t.family_budget(settings, PARENT, ledger["family"])
    db.execute("INSERT INTO hq.tokenomics_exposure VALUES(true,.1,true,now())")
    db.execute("DELETE FROM hq.tokenomics_policy")
    with pytest.raises(HTTPException, match="unavailable"):
        t.get_policy(settings)


@pytest.mark.parametrize(
    "values",
    [
        {"bad": 1},
        {
            "provider": "OpenAI",
            "model": "x",
            "kind": "bad",
            "source_url": "https://example.com",
            "status": "manual",
        },
        {
            "provider": "OpenAI",
            "model": "x",
            "kind": "chat",
            "source_url": "http://example.com",
            "status": "manual",
        },
    ],
)
def test_price_validation(settings, ledger, values):
    with pytest.raises(HTTPException):
        t.add_price(settings, values)


@pytest.mark.parametrize("values", [{}, {"text": "private"}, {"response_ms": -1}, {"response_ms": 100000000}])
def test_observation_validation(settings, ledger, values):
    with pytest.raises(HTTPException):
        t.record_observation(settings, PARENT, ledger["family"], uuid4(), values)


def test_invalid_operations_slots_attempts_and_metrics(settings, ledger):
    with pytest.raises(HTTPException):
        t.begin_operation(settings, PARENT, ledger["family"], "bad", "x")
    with pytest.raises(HTTPException):
        begin(settings, ledger, automatic_slots=5)
    op = begin(settings, ledger, automatic_slots=1)
    t.bind_slots(settings, PARENT, op["id"], ["bedtime"])
    with pytest.raises(HTTPException):
        t.begin_operation(
            settings,
            PARENT,
            ledger["family"],
            "habit_batch",
            "early",
            child_id=ledger["child"],
            parent_operation_id=op["id"],
            goal_id="bedtime",
        )
    t.finish_operation(settings, op["id"], useful=True)
    with pytest.raises(HTTPException):
        t.begin_operation(
            settings,
            PARENT,
            ledger["family"],
            "habit_batch",
            "badgoal",
            child_id=ledger["child"],
            parent_operation_id=op["id"],
            goal_id="missing",
        )
    with pytest.raises(HTTPException):
        dispatch(settings, op)
    active = begin(settings, ledger)
    attempt = dispatch(settings, active)
    with pytest.raises(HTTPException):
        t.record_attempt(settings, op["id"], {"id": attempt["id"], "status": "failed"})
    with pytest.raises(HTTPException):
        t.record_attempt(settings, active["id"], {"id": uuid4(), "status": "completed"})
    with pytest.raises(HTTPException):
        t.record_attempt(settings, active["id"], {"id": uuid4(), "status": "bad"})
    with pytest.raises(HTTPException):
        t.record_attempt(settings, active["id"], {"id": uuid4(), "read_units_precision": "invalid"})
    with pytest.raises(HTTPException):
        t.finish_operation(settings, active["id"], useful=True, result_ref={"text": "private"})
    with pytest.raises(HTTPException):
        t.finish_operation(settings, active["id"], useful=True, timings={"bad key": 1})


@pytest.mark.parametrize(
    "kind,usage,rates,expected",
    [
        (
            "chat",
            {"input_tokens": 100, "output_tokens": 100},
            {"input_rate": 0.1, "output_rate": 0.5},
            0.00006,
        ),
        (
            "chat",
            {"input_tokens": 100, "output_tokens": 100, "cache_write_tokens": 50},
            {"input_rate": 0.1, "cache_write_rate": 0.125, "output_rate": 0.5},
            0.00006125,
        ),
        (
            "chat",
            {"input_tokens": 100, "output_tokens": 100, "cached_input_tokens": 101},
            {"input_rate": 0.1, "output_rate": 0.5},
            None,
        ),
        (
            "chat",
            {"input_tokens": 100, "output_tokens": 100, "cached_input_tokens": 50},
            {"input_rate": 0.1, "output_rate": 0.5},
            None,
        ),
        (
            "chat",
            {"input_tokens": 100, "output_tokens": 100, "cache_write_tokens": 50},
            {"input_rate": 0.1, "output_rate": 0.5},
            None,
        ),
        ("chat", {"input_tokens": 100}, {"input_rate": 0.1, "output_rate": 0.5}, None),
        ("chat", {"input_tokens": 100, "output_tokens": 100}, {"input_rate": 0.1}, None),
        ("embedding", {"input_tokens": 100}, {}, None),
        ("search", {"read_units": 1}, {"read_unit_rate": 18, "egress_rate": 0.1}, None),
    ],
)
def test_component_price_arithmetic(kind, usage, rates, expected):
    actual = t._price_usage({"kind": kind, **rates}, usage)
    assert actual == (None if expected is None else Decimal(str(expected)))


def test_price_matching_explicit_bounds_and_serialization():
    price = {
        "provider": "Pinecone",
        "model": "documents-search",
        "kind": "search",
        "api_mode": "documents_search",
        "region": "us-east-1",
        "service_tier": "standard",
        "context_band": "short",
        "read_unit_rate": 18,
        "egress_rate": 0.1,
        "read_units_bound": 2,
        "egress_bytes_bound": 20000,
    }
    assert t._find_price([price], {"provider": "Pinecone", "model": "documents-search"}) is None
    assert (
        t._find_price(
            [price],
            {
                "provider": "Pinecone",
                "model": "documents-search",
                "api_mode": "documents_search",
                "region": "us-east-1",
            },
        )
        == price
    )
    assert t._price_usage(price, {}, bound=True) == Decimal(".000038")
    assert t._json(datetime.now(UTC).date())
    assert t._price_usage(None, {}) is None
    assert t._json((Decimal(".1"), uuid4()))[0] == 0.1

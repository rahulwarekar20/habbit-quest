"""Durable, content-free AI accounting and versioned family coaching allowances.

Admission, provider dispatch and settlement each commit independently of application
content writes. Family credits are a quoted product allowance; provider expenditure
and unresolved exposure are separate financial records, including in tracking-only mode.
"""

import hashlib
import hmac
import json
from contextlib import contextmanager
from datetime import UTC, datetime, time, timedelta
from decimal import ROUND_CEILING, Decimal
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import psycopg
from fastapi import HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from habitquest_backend.config import Settings

ACTIVITIES = {"coach", "habit_batch", "planner", "review", "onboarding", "buddy", "child_screen"}
TERMINAL = {"completed", "failed", "cancelled"}
USAGE_FIELDS = {
    "input_tokens",
    "output_tokens",
    "cached_input_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "read_units",
    "egress_bytes",
    "input_token_bound",
    "output_token_bound",
    "estimated_read_units_bound",
    "egress_bytes_bound",
}
PRICE_FIELDS = {
    "provider",
    "model",
    "kind",
    "api_mode",
    "region",
    "service_tier",
    "context_band",
    "input_rate",
    "cached_input_rate",
    "cache_write_rate",
    "output_rate",
    "read_unit_rate",
    "egress_rate",
    "source_url",
    "verified_at",
    "status",
    "effective_at",
    "read_units_bound",
    "egress_bytes_bound",
}
RATE_FIELDS = {
    "input_rate",
    "cached_input_rate",
    "cache_write_rate",
    "output_rate",
    "read_unit_rate",
    "egress_rate",
    "read_units_bound",
    "egress_bytes_bound",
}
ZERO = Decimal(0)
MILLION = Decimal(1_000_000)


def _now() -> datetime:
    return datetime.now(UTC)


def _json(value):
    """Convert safe database values into JSON without losing fractional USD precision."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (UUID, datetime)):
        return str(value)
    if isinstance(value, dict):
        return {key: _json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json(item) for item in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _decimal(value) -> Decimal:
    try:
        number = Decimal(str(value))
    except Exception as exc:
        raise HTTPException(422, "Invalid nonnegative numeric value") from exc
    if not number.is_finite() or number < 0:
        raise HTTPException(422, "Invalid nonnegative numeric value")
    return number


@contextmanager
def _transaction(settings: Settings, role: str):
    with psycopg.connect(settings.database_url, row_factory=dict_row, connect_timeout=3) as conn:
        conn.execute(f"SET LOCAL ROLE {role}")
        conn.execute("SET LOCAL statement_timeout='10s'")
        yield conn


def admin_tx(settings: Settings):
    """Restricted operator transaction: tokenomics metadata only, no family content."""
    return _transaction(settings, "hq_admin")


def _meter_tx(settings: Settings):
    return _transaction(settings, "hq_meter")


def _policy(conn) -> dict:
    row = conn.execute("SELECT * FROM hq.tokenomics_policy ORDER BY revision DESC LIMIT 1").fetchone()
    if row is None:
        raise HTTPException(503, "Coaching accounting is unavailable")
    return _json(row)


def _lock(conn) -> dict:
    row = conn.execute("SELECT * FROM hq.tokenomics_exposure WHERE singleton FOR UPDATE").fetchone()
    if row is None:
        raise HTTPException(503, "Coaching accounting is unavailable")
    return row


def _scope(conn, user, family_id, child_id=None, kid=None) -> str:
    row = conn.execute(
        "SELECT timezone FROM hq.tokenomics_scope(%s,%s,%s,%s)",
        (family_id, child_id, user, kid),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Record not found")
    return row["timezone"]


def fingerprint(settings: Settings, payload: Any) -> str:
    """A keyed digest for idempotency; no duplicate family text enters telemetry."""
    if settings.jwt_secret is None:
        raise HTTPException(503, "Coaching accounting requires a signing secret")
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hmac.new(settings.jwt_secret.get_secret_value().encode(), raw, hashlib.sha256).hexdigest()


def _window(conn, family_id, timezone: str, now: datetime) -> dict:
    row = conn.execute(
        "SELECT * FROM hq.family_ai_windows WHERE family_id=%s ORDER BY ends_at DESC LIMIT 1",
        (family_id,),
    ).fetchone()
    if row and now < row["ends_at"]:
        return row
    local = now.astimezone(ZoneInfo(timezone))
    start = datetime.combine(local.date(), time.min, local.tzinfo).astimezone(UTC)
    end = datetime.combine(local.date() + timedelta(days=1), time.min, local.tzinfo).astimezone(UTC)
    if row:
        start = max(start, row["ends_at"])
    return conn.execute(
        "INSERT INTO hq.family_ai_windows(family_id,starts_at,ends_at,timezone) VALUES(%s,%s,%s,%s) RETURNING *",
        (family_id, start, end, timezone),
    ).fetchone()


def _expire_slots(conn, now: datetime) -> None:
    conn.execute(
        "UPDATE hq.ai_operations SET status='cancelled',pending_credits=0,exposure_usd=0,finished_at=%s "
        "WHERE status='slot' AND created_at<%s",
        (now, now - timedelta(minutes=10)),
    )


def _recovery_delay(settings: Settings) -> timedelta:
    # The installed OpenAI SDK accepts Retry-After delays up to 120 seconds.
    # Buddy can write then screen, each with one SDK retry. Coach has an outer
    # deadline; synchronous habit/retrieval work may still be in a retry wait.
    retry_wait = 120
    longest = max(
        settings.coach_timeout_seconds,
        settings.habit_generation_timeout_seconds + settings.habit_generation_max_retries * retry_wait,
        4 * settings.ai_timeout_seconds + 2 * retry_wait,
        settings.embedding_timeout_seconds * (settings.embedding_max_retries + 1)
        + settings.embedding_max_retries * retry_wait
        + settings.pinecone_timeout_seconds,
    )
    return timedelta(seconds=longest + 60)


def _recover_stale(conn, settings: Settings, now: datetime) -> None:
    """Release abandoned family holds without erasing any dispatched spend exposure."""
    _expire_slots(conn, now)
    abandoned = conn.execute(
        "UPDATE hq.ai_operations SET status='failed',pending_credits=0,finished_at=%s "
        "WHERE status IN('reserved','running') AND created_at<%s RETURNING id",
        (now, now - _recovery_delay(settings)),
    ).fetchall()
    for operation in abandoned:
        conn.execute(
            "UPDATE hq.ai_operations SET status='cancelled',pending_credits=0,exposure_usd=0,finished_at=%s "
            "WHERE parent_operation_id=%s AND status='slot'",
            (now, operation["id"]),
        )
        _recalculate(conn, operation["id"])


def _budget(conn, window: dict, policy: dict) -> dict:
    totals = conn.execute(
        "SELECT coalesce(sum(credits),0) AS used,coalesce(sum(pending_credits),0) AS pending "
        "FROM hq.ai_operations WHERE budget_window_id=%s",
        (window["id"],),
    ).fetchone()
    used, pending, allowance = int(totals["used"]), int(totals["pending"]), policy["daily_credits"]
    result = {
        "allowance": allowance,
        "used": used,
        "pending": pending,
        "remaining": max(0, allowance - used - pending),
        "reset_at": window["ends_at"].isoformat(),
        "enforced": policy["enforce_budgets"],
        "show_costs": policy["show_costs"],
        "activity_quotes": policy["weights"],
        "policy_revision": policy["revision"],
        "overage": max(0, used + pending - allowance),
    }
    if policy["show_costs"]:
        sums = conn.execute(
            "SELECT coalesce(sum(estimated_cost_usd),0) AS cost,count(*) FILTER "
            "(WHERE cost_status IN('unknown','partial','pending') AND NOT(status='cancelled' AND cost_status='pending')) AS unknown,"
            "count(*) FILTER(WHERE cost_status='planning') AS planning "
            "FROM hq.ai_operations WHERE budget_window_id=%s",
            (window["id"],),
        ).fetchone()
        result.update(
            estimated_cost_usd=float(sums["cost"]),
            cost_status="partial" if sums["unknown"] else "planning" if sums["planning"] else "estimated",
        )
    return result


def family_budget(settings: Settings, user, family_id) -> dict:
    with _meter_tx(settings) as conn:
        _lock(conn)
        timezone = _scope(conn, user, family_id)
        _recover_stale(conn, settings, _now())
        return _budget(conn, _window(conn, family_id, timezone, _now()), _policy(conn))


def get_policy(settings: Settings) -> dict:
    with admin_tx(settings) as conn:
        return _policy(conn)


def update_policy(settings: Settings, revision: int, patch: dict, actor: str = "admin") -> dict:
    allowed = {
        "daily_credits",
        "enforce_budgets",
        "show_costs",
        "reference_usd_per_credit",
        "operator_cap_usd",
        "weights",
    }
    if not patch or not set(patch) <= allowed:
        raise HTTPException(422, "Unknown or empty policy update")
    with admin_tx(settings) as conn:
        _lock(conn)
        old = _policy(conn)
        if old["revision"] != revision:
            raise HTTPException(409, "Configuration changed; refresh before saving")
        value = {**old, **patch}
        if type(value["daily_credits"]) is not int or not 1 <= value["daily_credits"] <= 1_000_000:
            raise HTTPException(422, "Daily credits must be a positive integer")
        if any(type(value[k]) is not bool for k in ("enforce_budgets", "show_costs")):
            raise HTTPException(422, "Policy switches must be booleans")
        weights = value["weights"]
        if (
            not isinstance(weights, dict)
            or set(weights) != ACTIVITIES
            or any(type(v) is not int or not 0 <= v <= 1_000_000 for v in weights.values())
        ):
            raise HTTPException(422, "Provide valid activity credit weights")
        if weights["buddy"] != 0 or weights["child_screen"] != 0:
            raise HTTPException(422, "Child encouragement and screening must remain zero-credit activities")
        for key in ("reference_usd_per_credit", "operator_cap_usd"):
            value[key] = _decimal(value[key])
            if value[key] == 0:
                raise HTTPException(422, "Reference and cap must be positive")
        row = conn.execute(
            "INSERT INTO hq.tokenomics_policy(daily_credits,enforce_budgets,show_costs,reference_usd_per_credit,"
            "operator_cap_usd,weights) VALUES(%s,%s,%s,%s,%s,%s) RETURNING *",
            tuple(
                value[k]
                for k in (
                    "daily_credits",
                    "enforce_budgets",
                    "show_costs",
                    "reference_usd_per_credit",
                    "operator_cap_usd",
                )
            )
            + (Jsonb(weights),),
        ).fetchone()
        conn.execute(
            "INSERT INTO hq.tokenomics_policy_audit(actor,action,revision,changes) VALUES(%s,'policy',%s,%s)",
            (actor, row["revision"], Jsonb({k: {"before": old[k], "after": _json(value[k])} for k in patch})),
        )
        return _json(row)


def list_prices(settings: Settings) -> list[dict]:
    with admin_tx(settings) as conn:
        return _json(
            conn.execute("SELECT * FROM hq.ai_price_versions ORDER BY created_at DESC,id").fetchall()
        )


def _provider(value: str) -> str:
    return {
        "api.openai.com": "OpenAI",
        "api.tokenfactory.us-north1.nebius.com": "Nebius",
        "api.pinecone.io": "Pinecone",
    }.get(value, value)


def add_price(settings: Settings, values: dict, actor: str = "admin") -> dict:
    if not set(values) <= PRICE_FIELDS or not all(
        values.get(k) for k in ("provider", "model", "kind", "source_url", "status")
    ):
        raise HTTPException(422, "Invalid price fields")
    value = {"api_mode": "", "region": "", "service_tier": "standard", "context_band": "short", **values}
    value["provider"] = _provider(value["provider"])
    if value["kind"] not in {"chat", "embedding", "search"} or value["status"] not in {
        "verified",
        "manual",
        "planning",
    }:
        raise HTTPException(422, "Invalid price type or status")
    if not value["source_url"].startswith("https://") or len(value["source_url"]) > 500:
        raise HTTPException(422, "A public HTTPS pricing source is required")
    for key in RATE_FIELDS & value.keys():
        if value[key] is not None:
            value[key] = _decimal(value[key])
    with admin_tx(settings) as conn:
        # Identifiers are exclusively drawn from the fixed allowlist above.
        columns = list(value)
        row = conn.execute(
            f"INSERT INTO hq.ai_price_versions({','.join(columns)}) VALUES({','.join(['%s'] * len(columns))}) RETURNING *",
            tuple(value.values()),
        ).fetchone()
        conn.execute(
            "INSERT INTO hq.tokenomics_policy_audit(actor,action,changes) VALUES(%s,'price',%s)",
            (actor, Jsonb(_json(row))),
        )
        return _json(row)


def _price_snapshot(conn) -> list[dict]:
    return _json(
        conn.execute(
            "SELECT * FROM hq.ai_price_versions WHERE effective_at<=clock_timestamp() ORDER BY created_at DESC,id"
        ).fetchall()
    )


def _global_allowed(conn, policy: dict, extra: Decimal) -> None:
    if not policy["enforce_budgets"]:
        return
    exposure = conn.execute(
        "SELECT e.legacy_carryover_usd + coalesce((SELECT sum(exposure_usd) FROM hq.ai_operations),0) AS total,"
        "e.legacy_initialized FROM hq.tokenomics_exposure e WHERE singleton"
    ).fetchone()
    if not exposure["legacy_initialized"]:
        raise HTTPException(503, "Legacy usage must be verified before enforcing the operator cap")
    unresolved = conn.execute(
        "SELECT price_snapshot,usage FROM hq.ai_provider_attempts WHERE cost_status IN('unknown','planning')"
    ).fetchall()
    for attempt in unresolved:
        price = attempt["price_snapshot"]
        if (
            price is None
            or price["status"] == "planning"
            or _price_usage(price, attempt["usage"], bound=True) is None
        ):
            raise HTTPException(
                503,
                "Earlier provider usage has an unverified tariff or unbounded exposure; reconcile it before enforcing the operator cap",
            )
    if exposure["total"] + extra > _decimal(policy["operator_cap_usd"]):
        raise HTTPException(429, "The application's AI allowance is currently exhausted")


def begin_operation(
    settings: Settings,
    user,
    family_id,
    activity: str,
    request_key: str,
    *,
    child_id=None,
    fingerprint: str = "",
    parent_operation_id=None,
    goal_id: str | None = None,
    automatic_slots: int = 0,
    reserve_usd=0,
    slot_reserve_usd=0,
    exposure_known: bool = False,
    kid=None,
    chargeable: bool = True,
) -> dict:
    """Admit once before paid work; shared family credit holds are serialized atomically."""
    if (
        activity not in ACTIVITIES
        or not request_key
        or len(str(request_key)) > 160
        or not 0 <= automatic_slots <= 4
    ):
        raise HTTPException(422, "Invalid generation operation")
    reserve, slot_reserve = _decimal(reserve_usd), _decimal(slot_reserve_usd)
    with _meter_tx(settings) as conn:
        _lock(conn)
        timezone = _scope(conn, user, family_id, child_id, kid)
        _recover_stale(conn, settings, _now())
        existing = conn.execute(
            "SELECT * FROM hq.ai_operations WHERE family_id=%s AND activity=%s AND request_key=%s",
            (family_id, activity, str(request_key)),
        ).fetchone()
        if existing:
            if (
                existing["fingerprint"] != fingerprint
                or str(existing["child_id"] or "") != str(child_id or "")
                or str(existing["parent_operation_id"] or "") != str(parent_operation_id or "")
                or existing["goal_id"] != goal_id
            ):
                raise HTTPException(409, "Idempotency key already identifies another request")
            return {**_json(existing), "replayed": True, "approved_slots": _slots(conn, existing["id"])}
        policy = _policy(conn)
        if parent_operation_id:
            parent = conn.execute(
                "SELECT * FROM hq.ai_operations WHERE id=%s", (parent_operation_id,)
            ).fetchone()
            if (
                not parent
                or str(parent["family_id"]) != str(family_id)
                or str(parent["child_id"]) != str(child_id)
                or parent["status"] != "completed"
                or activity != "habit_batch"
            ):
                raise HTTPException(404, "No approved habit preparation slot")
            slot = conn.execute(
                "SELECT * FROM hq.ai_operations WHERE parent_operation_id=%s AND goal_id=%s AND status='slot'",
                (parent_operation_id, goal_id),
            ).fetchone()
            if slot is None:
                raise HTTPException(409, "Habit preparation slot is unavailable or already used")
            row = conn.execute(
                "UPDATE hq.ai_operations SET status='reserved',request_key=%s,fingerprint=%s,created_at=clock_timestamp() WHERE id=%s RETURNING *",
                (str(request_key), fingerprint, slot["id"]),
            ).fetchone()
            return {**_json(row), "replayed": False, "approved_slots": []}
        window = _window(conn, family_id, timezone, _now())
        budget = _budget(conn, window, policy)
        quote = policy["weights"][activity] if chargeable else 0
        if policy["enforce_budgets"] and quote > budget["remaining"]:
            raise HTTPException(
                429, "Today's coaching credits are used up; your allowance resets at the next family day"
            )
        slots = automatic_slots if activity == "coach" and chargeable else 0
        batch_quote = policy["weights"]["habit_batch"]
        if policy["enforce_budgets"] and batch_quote:
            slots = min(slots, (budget["remaining"] - quote) // batch_quote)
        if policy["enforce_budgets"] and reserve + slots * slot_reserve and not exposure_known:
            raise HTTPException(503, "A verified spending bound is required")
        if reserve + slots * slot_reserve:
            _global_allowed(conn, policy, reserve + slots * slot_reserve)
        snapshots = _price_snapshot(conn)

        def insert(kind, key, credits, amount, parent=None, status="reserved"):
            return conn.execute(
                "INSERT INTO hq.ai_operations(family_id,child_id,actor_id,activity,request_key,fingerprint,"
                "parent_operation_id,goal_id,budget_window_id,policy_snapshot,price_snapshot,status,quoted_credits,"
                "pending_credits,reserve_usd,exposure_usd) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
                (
                    family_id,
                    child_id,
                    user,
                    kind,
                    key,
                    fingerprint,
                    parent,
                    goal_id if not parent else None,
                    window["id"],
                    Jsonb(policy),
                    Jsonb(snapshots),
                    status,
                    credits,
                    credits,
                    amount,
                    amount,
                ),
            ).fetchone()

        row = insert(activity, str(request_key), quote, reserve)
        for _ in range(slots):
            insert("habit_batch", f"slot:{uuid4()}", batch_quote, slot_reserve, row["id"], "slot")
        return {**_json(row), "replayed": False, "approved_slots": _slots(conn, row["id"])}


def _slots(conn, parent_id) -> list[dict]:
    return _json(
        conn.execute(
            "SELECT goal_id,parent_operation_id FROM hq.ai_operations WHERE parent_operation_id=%s AND status='slot' ORDER BY created_at,id",
            (parent_id,),
        ).fetchall()
    )


def bind_slots(settings: Settings, user, operation_id, goal_ids: list[str]) -> list[dict]:
    with _meter_tx(settings) as conn:
        _lock(conn)
        parent = _operation(conn, operation_id)
        _scope(conn, user, parent["family_id"], parent["child_id"])
        slots = conn.execute(
            "SELECT id,goal_id FROM hq.ai_operations WHERE parent_operation_id=%s AND status='slot' ORDER BY created_at,id",
            (operation_id,),
        ).fetchall()
        wanted = list(dict.fromkeys(goal_ids))[:4]
        conn.execute(
            "UPDATE hq.ai_operations SET result_ref=result_ref || %s WHERE id=%s",
            (
                Jsonb(
                    {
                        "requested_batch_count": len(wanted),
                        "approved_batch_count": min(len(wanted), len(slots)),
                    }
                ),
                operation_id,
            ),
        )
        for index, slot in enumerate(slots):
            if index < len(wanted):
                if slot["goal_id"] is not None and slot["goal_id"] != wanted[index]:
                    raise HTTPException(409, "Prepared goal bindings cannot be changed")
                conn.execute(
                    "UPDATE hq.ai_operations SET goal_id=%s WHERE id=%s", (wanted[index], slot["id"])
                )
            else:
                conn.execute(
                    "UPDATE hq.ai_operations SET status='cancelled',pending_credits=0,exposure_usd=0,finished_at=%s WHERE id=%s",
                    (_now(), slot["id"]),
                )
        return _slots(conn, operation_id)


def _operation(conn, operation_id) -> dict:
    row = conn.execute("SELECT * FROM hq.ai_operations WHERE id=%s", (operation_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Generation operation not found")
    return row


def _recalculate(conn, operation_id) -> None:
    op = _operation(conn, operation_id)
    values = conn.execute(
        "SELECT count(*) AS n,coalesce(sum(estimated_cost_usd),0) AS cost,coalesce(sum(exposure_usd),0) AS exposure,"
        "count(*) FILTER(WHERE cost_status='unknown') AS unknown,count(*) FILTER(WHERE cost_status='planning') AS planning "
        "FROM hq.ai_provider_attempts WHERE operation_id=%s",
        (operation_id,),
    ).fetchone()
    unresolved = values["unknown"] > 0 or op["status"] not in TERMINAL
    exposure = max(values["exposure"], op["reserve_usd"] if unresolved else ZERO)
    state = (
        "unknown"
        if values["unknown"] == values["n"] and values["n"]
        else "partial"
        if values["unknown"]
        else "planning"
        if values["planning"]
        else "estimated"
        if values["n"]
        else "pending"
        if unresolved
        else "no_provider_cost"
    )
    conn.execute(
        "UPDATE hq.ai_operations SET estimated_cost_usd=%s,exposure_usd=%s,cost_status=%s WHERE id=%s",
        (values["cost"], exposure, state, operation_id),
    )


def _safe_numbers(values: dict | None) -> dict:
    result = {}
    for key, value in (values or {}).items():
        if not isinstance(key, str) or len(key) > 80 or not key.replace("_", "").isalnum():
            raise HTTPException(422, "Invalid metric name")
        number = _decimal(value)
        if number > 86_400_000:
            raise HTTPException(422, "Metric is outside the supported range")
        result[key] = float(number)
    return result


def finish_operation(
    settings: Settings, operation_id, *, useful: bool, result_ref=None, timings=None, status=None
) -> None:
    """Settle a useful operation once; all actual provider expenditure remains recorded."""
    refs = result_ref or {}
    if not set(refs) <= {
        "thread_id",
        "message_id",
        "batch_id",
        "report_id",
        "pain_point_id",
        "goal_ids",
        "result_count",
        "outcome",
        "mapped_by",
        "safety",
        "requested_batch_count",
        "approved_batch_count",
    }:
        raise HTTPException(422, "Only domain identifiers belong in an operation reference")
    safe_timings = _safe_numbers(timings)
    with _meter_tx(settings) as conn:
        _lock(conn)
        op = _operation(conn, operation_id)
        if op["status"] in TERMINAL:
            return
        final_status = "completed" if useful else "failed"
        if status in {"cancelled", "completed"} and not useful:
            final_status = status
        conn.execute(
            "UPDATE hq.ai_operations SET status=%s,credits=%s,pending_credits=0,result_ref=%s,timings=%s,finished_at=%s WHERE id=%s",
            (
                final_status,
                op["quoted_credits"] if useful else 0,
                Jsonb(_json({**op["result_ref"], **refs})),
                Jsonb(safe_timings),
                _now(),
                operation_id,
            ),
        )
        if final_status != "completed":
            conn.execute(
                "UPDATE hq.ai_operations SET status='cancelled',pending_credits=0,exposure_usd=0,finished_at=%s "
                "WHERE parent_operation_id=%s AND status='slot'",
                (_now(), operation_id),
            )
        _recalculate(conn, operation_id)


def _find_price(prices: list[dict], record: dict) -> dict | None:
    for price in prices:
        if price["provider"] != _provider(record["provider"]) or price["model"] != record["model"]:
            continue
        if any(
            price[key] and price[key] != record.get(key, default)
            for key, default in (
                ("api_mode", ""),
                ("region", ""),
                ("service_tier", "standard"),
                ("context_band", "short"),
            )
        ):
            continue
        return price
    return None


def _price_usage(price: dict | None, usage: dict, *, bound: bool = False) -> Decimal | None:
    if price is None:
        return None

    def number(key):
        value = usage.get(key)
        return None if value is None else _decimal(value)

    def rate(key):
        value = price.get(key)
        return None if value is None else _decimal(value)

    if price["kind"] == "search":
        units = number("estimated_read_units_bound" if bound else "read_units")
        size = number("egress_bytes_bound" if bound else "egress_bytes")
        if bound:
            units = units if units is not None else rate("read_units_bound")
            size = size if size is not None else rate("egress_bytes_bound")
        ru, egress = rate("read_unit_rate"), rate("egress_rate")
        if units is None or size is None or ru is None or egress is None:
            return None
        return units * ru / MILLION + size * egress / Decimal(1_000_000_000)
    incoming = number("input_token_bound" if bound else "input_tokens")
    input_rate = rate("input_rate")
    if incoming is None or input_rate is None:
        return None
    if bound or price["kind"] == "embedding":
        cost = (
            incoming
            * max(input_rate, rate("cached_input_rate") or ZERO, rate("cache_write_rate") or ZERO)
            / MILLION
        )
    else:
        cached = number("cached_input_tokens") or ZERO
        writes = number("cache_write_tokens") or ZERO
        if cached + writes > incoming:
            return None
        cached_rate, write_rate = rate("cached_input_rate"), rate("cache_write_rate")
        if (cached and cached_rate is None) or (writes and write_rate is None):
            return None
        cost = (
            (incoming - cached - writes) * input_rate
            + cached * (cached_rate or ZERO)
            + writes * (write_rate or ZERO)
        ) / MILLION
    if price["kind"] == "embedding":
        return cost
    outgoing = number("output_token_bound" if bound else "output_tokens")
    output_rate = rate("output_rate")
    if outgoing is None or output_rate is None:
        return None
    # Provider output already includes reasoning tokens; never add them again.
    return cost + outgoing * output_rate / MILLION


def record_attempt(settings: Settings, operation_id, record: dict) -> dict:
    """Commit each attempt before dispatch; update the same ID when usage arrives."""
    ident = UUID(str(record["id"]))
    status = record.get("status", "dispatched")
    if status not in {"dispatched", "completed", "failed"}:
        raise HTTPException(422, "Invalid provider attempt state")
    usage = {
        key: _json(_decimal(value))
        for key, value in record.items()
        if key in USAGE_FIELDS and value is not None
    }
    if "read_units_precision" in record:
        precision = record["read_units_precision"]
        if precision not in {"rounded_up", "precise", "unknown"}:
            raise HTTPException(422, "Invalid read unit precision")
        usage["read_units_precision"] = precision
    with _meter_tx(settings) as conn:
        _lock(conn)
        op = _operation(conn, operation_id)
        prior = conn.execute("SELECT * FROM hq.ai_provider_attempts WHERE id=%s", (ident,)).fetchone()
        if prior and str(prior["operation_id"]) != str(operation_id):
            raise HTTPException(409, "Attempt belongs to another operation")
        if prior and prior["status"] != "dispatched" and status == "dispatched":
            return _json(prior)
        if prior:
            usage = {**prior["usage"], **usage}
            price = prior["price_snapshot"]
            reserved = prior["reserved_usd"]
        else:
            if op["status"] in TERMINAL or op["status"] == "slot":
                raise HTTPException(409, "Operation does not permit another provider dispatch")
            if status != "dispatched":
                raise HTTPException(409, "Provider dispatch must be recorded first")
            price = _find_price(op["price_snapshot"], record)
            bound = _price_usage(price, usage, bound=True)
            policy = _policy(conn)
            if policy["enforce_budgets"] and (
                bound is None or price is None or price["status"] == "planning"
            ):
                raise HTTPException(
                    503, "A verified provider tariff and conservative request bound are required"
                )
            reserved = bound or ZERO
            # Existing operation-wide headroom must not be reserved a second time.
            attempts_exposure = conn.execute(
                "SELECT coalesce(sum(exposure_usd),0) AS n FROM hq.ai_provider_attempts WHERE operation_id=%s",
                (operation_id,),
            ).fetchone()["n"]
            _global_allowed(conn, policy, max(ZERO, attempts_exposure + reserved - op["exposure_usd"]))
            conn.execute(
                "INSERT INTO hq.ai_provider_attempts(id,operation_id,invocation_id,role,provider,model,api_mode,"
                "region,service_tier,context_band,status,usage,price_snapshot,reserved_usd,exposure_usd) "
                "VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'dispatched',%s,%s,%s,%s)",
                (
                    ident,
                    operation_id,
                    record.get("invocation_id", ident),
                    record.get("role", "unknown"),
                    _provider(record["provider"]),
                    record["model"],
                    record.get("api_mode", ""),
                    record.get("region", ""),
                    record.get("service_tier", "standard"),
                    record.get("context_band", "short"),
                    Jsonb(usage),
                    Jsonb(price) if price else None,
                    reserved,
                    reserved,
                ),
            )
            conn.execute("UPDATE hq.ai_operations SET status='running' WHERE id=%s", (operation_id,))
        cost = _price_usage(price, usage) if status != "dispatched" else None
        cost_status = (
            "unknown"
            if cost is None
            else "planning"
            if price and price["status"] == "planning"
            else "estimated"
        )
        duration = record.get("duration_ms")
        if duration is not None:
            duration = _decimal(duration)
        conn.execute(
            "UPDATE hq.ai_provider_attempts SET status=%s,usage=%s,duration_ms=coalesce(%s,duration_ms),"
            "returned_model=coalesce(%s,returned_model),error_code=coalesce(%s,error_code),request_id=coalesce(%s,request_id),"
            "estimated_cost_usd=%s,exposure_usd=%s,cost_status=%s,finished_at=%s WHERE id=%s",
            (
                status,
                Jsonb(usage),
                duration,
                record.get("returned_model"),
                record.get("error_code"),
                record.get("request_id"),
                cost,
                reserved if cost is None else cost,
                cost_status,
                None if status == "dispatched" else _now(),
                ident,
            ),
        )
        _recalculate(conn, operation_id)
        return _json(conn.execute("SELECT * FROM hq.ai_provider_attempts WHERE id=%s", (ident,)).fetchone())


def get_operation(settings: Settings, user, family_id, operation_id) -> dict:
    with _meter_tx(settings) as conn:
        _lock(conn)
        timezone = _scope(conn, user, family_id)
        _recover_stale(conn, settings, _now())
        op = _operation(conn, operation_id)
        if str(op["family_id"]) != str(family_id):
            raise HTTPException(404, "Generation operation not found")
        policy = _policy(conn)
        result = {
            "operation_id": str(op["id"]),
            "parent_operation_id": str(op["parent_operation_id"]) if op["parent_operation_id"] else None,
            "activity": op["activity"],
            "status": op["status"],
            "credits": op["credits"],
            "pending_credits": op["pending_credits"],
            "quoted_credits": op["quoted_credits"],
            "budget": _budget(conn, _window(conn, family_id, timezone, _now()), policy),
            "automatic_slots": _slots(conn, operation_id),
            "timings": op["timings"],
            "result_ref": op["result_ref"],
        }
        interaction = conn.execute(
            "SELECT coalesce(sum(credits),0) AS credits,coalesce(sum(pending_credits),0) AS pending_credits,"
            "count(*) FILTER(WHERE parent_operation_id IS NOT NULL AND status='completed') AS batches_ready,"
            "count(*) FILTER(WHERE parent_operation_id IS NOT NULL AND status IN('slot','reserved','running')) AS batches_pending,"
            "count(*) FILTER(WHERE parent_operation_id IS NOT NULL AND status='failed') AS batches_failed,"
            "count(*) FILTER(WHERE parent_operation_id IS NOT NULL AND status='cancelled' AND goal_id IS NOT NULL) AS batches_cancelled,"
            "max(finished_at) AS last_finished_at,"
            "coalesce(sum(estimated_cost_usd),0) AS estimated_cost_usd,"
            "count(*) FILTER(WHERE cost_status IN('unknown','partial','pending') AND NOT(status='cancelled' AND cost_status='pending')) AS unknown,"
            "count(*) FILTER(WHERE cost_status='planning') AS planning "
            "FROM hq.ai_operations WHERE id=%s OR parent_operation_id=%s",
            (op["parent_operation_id"] or op["id"], op["parent_operation_id"] or op["id"]),
        ).fetchone()
        result["interaction"] = {
            key: int(interaction[key])
            for key in ("credits", "pending_credits", "batches_ready", "batches_pending", "batches_failed")
        }
        parent = _operation(conn, op["parent_operation_id"]) if op["parent_operation_id"] else op
        refs = parent["result_ref"]
        partial = bool(
            interaction["batches_failed"]
            or interaction["batches_cancelled"]
            or refs.get("requested_batch_count", 0) > refs.get("approved_batch_count", 0)
        )
        complete = bool(
            parent["status"] == "completed"
            and interaction["batches_ready"]
            and not interaction["batches_pending"]
            and not partial
        )
        result["interaction"].update(
            complete=complete,
            partial=partial,
            all_choices_ready_ms=(interaction["last_finished_at"] - parent["created_at"]).total_seconds()
            * 1000
            if complete
            else None,
        )
        if policy["show_costs"]:
            result.update(estimated_cost_usd=float(op["estimated_cost_usd"]), cost_status=op["cost_status"])
            result["interaction"].update(
                estimated_cost_usd=float(interaction["estimated_cost_usd"]),
                cost_status="partial"
                if interaction["unknown"]
                else "planning"
                if interaction["planning"]
                else "estimated",
            )
        return result


project_operation = get_operation


def lookup_operation(settings: Settings, user, family_id, activity: str, request_key: str) -> dict | None:
    """Find persisted generation metadata by the domain request key; no provider work."""
    with _meter_tx(settings) as conn:
        _scope(conn, user, family_id)
        row = conn.execute(
            "SELECT id FROM hq.ai_operations WHERE family_id=%s AND activity=%s AND request_key=%s",
            (family_id, activity, str(request_key)),
        ).fetchone()
    return get_operation(settings, user, family_id, row["id"]) if row else None


def lookup_result(
    settings: Settings, user, family_id, activity: str, reference_key: str, reference_id
) -> dict | None:
    """Reconnect a persisted domain result to its content-free generation metadata."""
    if reference_key not in {"message_id", "report_id", "batch_id"}:
        raise HTTPException(422, "Unsupported generation reference")
    with _meter_tx(settings) as conn:
        _scope(conn, user, family_id)
        row = conn.execute(
            "SELECT id FROM hq.ai_operations WHERE family_id=%s AND activity=%s AND result_ref->>%s=%s ORDER BY created_at DESC LIMIT 1",
            (family_id, activity, reference_key, str(reference_id)),
        ).fetchone()
    return get_operation(settings, user, family_id, row["id"]) if row else None


def record_observation(settings: Settings, user, family_id, operation_id, values: dict) -> dict:
    if not values or not set(values) <= {"response_ms", "all_choices_ready_ms", "queue_ms"}:
        raise HTTPException(422, "Invalid browser timing observation")
    numbers = _safe_numbers(values)
    with _meter_tx(settings) as conn:
        _lock(conn)
        _scope(conn, user, family_id)
        op = _operation(conn, operation_id)
        if str(op["family_id"]) != str(family_id):
            raise HTTPException(404, "Generation operation not found")
        if op["browser_observation"] and op["browser_observation"] != numbers:
            raise HTTPException(409, "Observation already recorded")
        conn.execute(
            "UPDATE hq.ai_operations SET browser_observation=%s WHERE id=%s", (Jsonb(numbers), operation_id)
        )
    return {"recorded": True}


def admin_generations(settings: Settings, limit: int = 50, offset: int = 0) -> list[dict]:
    """Page operations with reported tokens from their own attempts, never estimates or child totals."""
    with admin_tx(settings) as conn:
        return _json(
            conn.execute(
                "WITH page AS ("
                "SELECT o.id,o.family_id,o.child_id,o.activity,o.status,o.credits,o.pending_credits,o.created_at,"
                "o.finished_at,o.timings,o.estimated_cost_usd,o.cost_status,o.parent_operation_id "
                "FROM hq.ai_operations o WHERE o.status<>'slot' AND NOT(o.status='cancelled' AND o.cost_status='pending') "
                "ORDER BY o.created_at DESC,o.id LIMIT %s OFFSET %s) "
                "SELECT o.*,a.attempt_count,a.input_tokens,a.output_tokens,"
                "CASE WHEN a.token_attempts=0 THEN 'not_applicable' "
                "WHEN a.input_count=a.token_attempts AND a.output_count=a.token_attempts THEN 'measured' "
                "WHEN a.input_count=0 AND a.output_count=0 THEN 'unavailable' ELSE 'partial' END AS token_usage_status "
                "FROM page o CROSS JOIN LATERAL ("
                "SELECT count(*) AS attempt_count,"
                "count(*) FILTER(WHERE role<>'pinecone') AS token_attempts,"
                "count(usage->>'input_tokens') FILTER(WHERE role<>'pinecone') AS input_count,"
                "count(usage->>'output_tokens') FILTER(WHERE role<>'pinecone') AS output_count,"
                "sum((usage->>'input_tokens')::numeric) FILTER(WHERE role<>'pinecone') AS input_tokens,"
                "sum((usage->>'output_tokens')::numeric) FILTER(WHERE role<>'pinecone') AS output_tokens "
                "FROM hq.ai_provider_attempts WHERE operation_id=o.id) a "
                "ORDER BY o.created_at DESC,o.id",
                (max(1, min(limit, 200)), max(0, offset)),
            ).fetchall()
        )


def admin_audit(settings: Settings, limit: int = 50) -> list[dict]:
    with admin_tx(settings) as conn:
        return _json(
            conn.execute(
                "SELECT * FROM hq.tokenomics_policy_audit ORDER BY id DESC LIMIT %s",
                (max(1, min(limit, 200)),),
            ).fetchall()
        )


def _reference_profiles(settings: Settings, prices: list[dict]) -> dict:
    """Reprice only historical shapes whose effective models still match the evidence."""
    from habitquest_backend.llm import effective_models

    roles = {row["role"]: row for row in effective_models(settings)}
    expected = {
        "coach": "gpt-6-luna",
        "habit_generation": "gpt-6-luna",
        "output_safety": "deepseek-ai/DeepSeek-V4.1-Flash-1017",
        "embedding": "text-embedding-3-small",
        "pinecone": "documents-search",
    }

    def matching(role):
        info = roles[role]
        if not info["active"] or info["model"] != expected[role]:
            return None
        return _find_price(prices, {**info, "provider": info["provider_host"]})

    profiles = {}
    habit = matching("habit_generation")
    if habit:
        cost = _price_usage(habit, {"input_tokens": 2739.5, "output_tokens": 1027})
        if cost is not None:
            profiles["habit_batch"] = {"writer": cost}
    coach, review = matching("coach"), matching("output_safety")
    embed, search = matching("embedding"), matching("pinecone")
    if coach and review and embed and search and settings.coach_engine == "refined":
        all_coach = _price_usage(coach, {"input_tokens": 4783, "output_tokens": 609})
        all_review = _price_usage(review, {"input_tokens": 4783, "output_tokens": 609})
        embedding = _price_usage(embed, {"input_tokens": 100})
        retrieval = _price_usage(search, {"read_units": 1, "egress_bytes": 20000})
        if all(v is not None for v in (all_coach, all_review, embedding, retrieval)):
            # Historical aggregate tokens do not identify the two model allocations.
            # Max each component rate independently to preserve the conservative bound.
            chat = (
                4783 * max(_decimal(coach["input_rate"]), _decimal(review["input_rate"]))
                + 609 * max(_decimal(coach["output_rate"]), _decimal(review["output_rate"]))
            ) / MILLION
            profiles["coach"] = {
                "writer_and_review": chat,
                "embedding": embedding or ZERO,
                "search": _decimal(search["read_unit_rate"]) / MILLION,
                "egress": Decimal(20000) * _decimal(search["egress_rate"]) / Decimal(1_000_000_000),
            }
    return profiles


def admin_metrics(settings: Settings) -> dict:
    """Whole-operation and model-attempt cohorts are distinct, over the latest 30 days."""
    since = _now() - timedelta(days=30)
    with admin_tx(settings) as conn:
        policy = _policy(conn)
        summary = conn.execute(
            "SELECT count(*) FILTER(WHERE status<>'slot') AS operations,count(*) FILTER(WHERE status='completed') AS useful,"
            "count(*) FILTER(WHERE status='failed') AS failed,count(*) FILTER(WHERE status IN('reserved','running','slot')) AS pending,"
            "coalesce(sum(estimated_cost_usd),0) AS known_cost_usd,count(*) FILTER(WHERE cost_status IN('unknown','partial','pending')) AS unknown_operations,"
            "coalesce(sum(exposure_usd-estimated_cost_usd),0) AS outstanding_exposure_usd FROM hq.ai_operations "
            "WHERE NOT(status='cancelled' AND cost_status='pending')"
        ).fetchone()
        legacy = conn.execute("SELECT * FROM hq.tokenomics_exposure WHERE singleton").fetchone()
        summary["legacy_carryover_usd"] = legacy["legacy_carryover_usd"]
        summary["total_exposure_usd"] = (
            summary["known_cost_usd"] + summary["outstanding_exposure_usd"] + legacy["legacy_carryover_usd"]
        )
        summary.update(
            conn.execute(
                "SELECT coalesce(sum(estimated_cost_usd) FILTER(WHERE cost_status='planning'),0) AS planning_cost_usd,"
                "coalesce(sum(estimated_cost_usd) FILTER(WHERE cost_status='estimated'),0) AS matched_tariff_cost_usd,"
                "count(*) FILTER(WHERE price_snapshot->>'status' IN('verified','manual'))::numeric/nullif(count(*),0) AS tariff_coverage "
                "FROM hq.ai_provider_attempts"
            ).fetchone()
        )
        model_rows = conn.execute(
            "SELECT o.activity,a.provider,a.model,a.api_mode,a.service_tier,a.region,a.context_band,count(*) AS samples,"
            "count(*) FILTER(WHERE a.status='completed') AS useful,count(*) FILTER(WHERE a.status='failed') AS failed,"
            "avg(a.estimated_cost_usd) AS mean_cost_usd,avg(a.duration_ms) FILTER(WHERE a.status='completed') AS mean_latency_ms,"
            "avg(a.estimated_cost_usd) FILTER(WHERE a.cost_status='estimated') AS matched_tariff_mean_cost_usd,"
            "count(*) FILTER(WHERE a.price_snapshot->>'status' IN('verified','manual'))::numeric/nullif(count(*),0) AS tariff_coverage,"
            "percentile_cont(.5) WITHIN GROUP(ORDER BY a.duration_ms) FILTER(WHERE a.status='completed') AS p50_latency_ms,"
            "CASE WHEN count(*) FILTER(WHERE a.status='completed')>=100 THEN percentile_cont(.95) WITHIN GROUP(ORDER BY a.duration_ms) "
            "FILTER(WHERE a.status='completed') END AS p95_latency_ms,"
            "count(a.estimated_cost_usd)::numeric/nullif(count(*),0) AS usage_coverage "
            "FROM hq.ai_provider_attempts a JOIN hq.ai_operations o ON o.id=a.operation_id WHERE a.created_at>=%s "
            "GROUP BY o.activity,a.provider,a.model,a.api_mode,a.service_tier,a.region,a.context_band "
            "ORDER BY o.activity,a.provider,a.model",
            (since,),
        ).fetchall()
        rows = conn.execute(
            "WITH calls AS (SELECT operation_id,count(*) AS attempts,count(DISTINCT invocation_id) AS logical_calls,"
            "count(*) FILTER(WHERE price_snapshot->>'status' IN('verified','manual')) AS matched_tariffs,"
            "string_agg(DISTINCT provider || ':' || model || ':' || api_mode || ':' || service_tier || ':' || region || ':' || context_band,' + ' "
            "ORDER BY provider || ':' || model || ':' || api_mode || ':' || service_tier || ':' || region || ':' || context_band) AS cohort,"
            "sum(duration_ms) FILTER(WHERE role NOT IN('embedding','pinecone','output_safety','child_screen','parent_risk')) AS writer_ms "
            "FROM hq.ai_provider_attempts GROUP BY operation_id) "
            "SELECT o.activity,c.cohort AS model,'Combined operation'::text AS provider,o.result_count,count(*) AS samples,"
            "count(*) FILTER(WHERE o.status='completed') AS useful,count(*) FILTER(WHERE o.status='failed') AS failed,"
            "avg(o.estimated_cost_usd) FILTER(WHERE o.cost_status NOT IN('unknown','partial','pending')) AS mean_cost_usd,"
            "avg(o.estimated_cost_usd) FILTER(WHERE o.cost_status='estimated' AND c.matched_tariffs=c.attempts) AS matched_tariff_mean_cost_usd,"
            "sum(c.matched_tariffs)::numeric/nullif(sum(c.attempts),0) AS tariff_coverage,"
            "CASE WHEN count(*) FILTER(WHERE o.cost_status IN('unknown','partial','pending'))=0 THEN sum(o.estimated_cost_usd)/"
            "nullif(count(*) FILTER(WHERE o.status='completed'),0) END AS cost_per_useful_result_usd,"
            "avg(extract(epoch FROM(o.finished_at-o.created_at))*1000) FILTER(WHERE o.status='completed') AS mean_latency_ms,"
            "avg(c.writer_ms) FILTER(WHERE o.status='completed') AS mean_generation_ms,"
            "avg(extract(epoch FROM(o.finished_at-o.created_at))*1000) FILTER(WHERE o.status='failed') AS mean_failure_latency_ms,"
            "percentile_cont(.5) WITHIN GROUP(ORDER BY extract(epoch FROM(o.finished_at-o.created_at))*1000) FILTER(WHERE o.status='completed') AS p50_latency_ms,"
            "CASE WHEN count(*) FILTER(WHERE o.status='completed')>=100 THEN percentile_cont(.95) WITHIN GROUP"
            "(ORDER BY extract(epoch FROM(o.finished_at-o.created_at))*1000) FILTER(WHERE o.status='completed') END AS p95_latency_ms,"
            "count(*) FILTER(WHERE o.cost_status NOT IN('unknown','partial','pending'))::numeric/nullif(count(*),0) AS usage_coverage,"
            "sum(c.attempts) AS provider_attempts,sum(c.logical_calls) AS logical_calls "
            "FROM hq.ai_operation_metrics o JOIN calls c ON c.operation_id=o.id "
            "WHERE o.created_at>=%s AND o.status IN('completed','failed') "
            "GROUP BY o.activity,c.cohort,o.result_count ORDER BY o.activity,c.cohort,o.result_count",
            (since,),
        ).fetchall()
        prices = _price_snapshot(conn)
    references = _reference_profiles(settings, prices)
    recommendations = []
    for activity, quote in policy["weights"].items():
        components = references.get(activity)
        total = sum(components.values(), ZERO) if components else None
        recommended = (
            max(
                1,
                int(
                    (total / _decimal(policy["reference_usd_per_credit"])).to_integral_value(
                        rounding=ROUND_CEILING
                    )
                ),
            )
            if total is not None
            else None
        )
        recommendations.append(
            {
                "activity": activity,
                "configured_credits": quote,
                "recommended_credits": recommended,
                "reference_cost_usd": _json(total),
                "components": components,
                "status": "historical_shape_current_prices"
                if components
                else "not_measured_for_current_configuration",
            }
        )
    return _json(
        {
            "summary": summary,
            "activities": rows,
            "model_costs": model_rows,
            "recommendations": recommendations,
            "window": {
                "since": since.isoformat(),
                "days": 30,
                "summary": "cumulative exposure; cohorts latest 30 days",
            },
            "cost_basis": "List-price estimates; mean_cost_usd includes explicitly assumed planning rates. matched_tariff_mean_cost_usd excludes them; tariff_coverage counts verified or operator-entered tariffs independently from usage coverage.",
            "coverage_note": "Operation costs include every model and retrieval attempt. Model latency is per HTTP attempt. Historical reference shapes require matching configured models; missing usage and unverified Pinecone billing are not zero.",
        }
    )

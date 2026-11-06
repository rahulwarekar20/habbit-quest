"""Shared persistent conservative reservations for the imported OpenAI test budget.

Reservations are intentionally never refunded automatically: unknown provider usage
must not silently restore allowance after a timeout, restart or application error.
The owner imports prototype spent usage before setting initialized=true.
"""

from decimal import Decimal
from uuid import UUID, uuid4

from habitquest_backend.config import Settings


def reserve(conn, settings: Settings, amount_usd: float, request_id: UUID | None = None) -> bool:
    """Reserve once before dispatch, within a committed caregiver-scoped transaction."""
    if settings.ai_mode != "openai" or not settings.planning_budget_enabled:
        return True
    return conn.execute(
        "SELECT hq.reserve_planning_budget(%s,%s,%s) AS allowed",
        (
            request_id or uuid4(),
            Decimal(str(max(amount_usd, 0.00000001))),
            Decimal(str(settings.planning_test_budget_usd)),
        ),
    ).fetchone()["allowed"]


def generation_reservation(
    settings: Settings, input_bytes: int, output_tokens: int, attempts: int = 2
) -> float:
    """UTF-8 bytes upper-bound tokens; cover the shared correction and SDK retries."""
    return (
        attempts
        * (
            (input_bytes + 4096) * settings.planning_input_rate_per_million
            + output_tokens * settings.planning_output_rate_per_million
        )
        / 1_000_000
    )

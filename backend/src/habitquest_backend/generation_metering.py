"""One durable accounting operation around each existing generation endpoint.

Business results remain in their original family-scoped tables. Replays resolve
those IDs instead of copying family prose into telemetry or calling providers again.
"""

from functools import wraps
from inspect import signature
from time import monotonic
from uuid import UUID, uuid4

from fastapi import HTTPException

from habitquest_backend import tokenomics_usage
from habitquest_backend.config import Settings
from habitquest_backend.db import one, transaction


def endpoint(settings: Settings, activity: str, *, scope: str = "child", automatic: bool = False):
    """Decorates below the route decorator while preserving FastAPI's signature."""

    def decorate(function):
        sig = signature(function)

        @wraps(function)
        def wrapped(*args, **kwargs):
            bound = sig.bind(*args, **kwargs)
            bound.apply_defaults()
            values = bound.arguments
            if values.get("stream"):
                return function(*args, **kwargs)
            from habitquest_backend import tokenomics

            user, kid = values.get("user"), values.get("kid")
            child_id = kid if scope == "kid" else values.get("child_id")
            with transaction(settings, user, kid=kid) as conn:
                family_id = (
                    one(conn, "SELECT family_id FROM hq.children WHERE id=%s", (child_id,))["family_id"]
                    if child_id
                    else one(conn, "SELECT id FROM hq.families WHERE id=%s", (values["family_id"],))["id"]
                )
            body = values.get("body")
            payload = body.model_dump(mode="json") if body is not None else {}
            request_key = payload.pop("request_id", None) or values.get("request_id") or uuid4()
            parent = payload.pop("parent_operation_id", None)
            goal_id = values.get("goal_id")
            from habitquest_backend.ai import RISK
            from habitquest_backend.safety import parent_at_risk

            local_only = (
                settings.ai_mode != "openai"
                or (activity == "coach" and parent_at_risk(payload.get("text", "")))
                or (activity == "onboarding" and bool(RISK.search(payload.get("text", ""))))
            )
            fingerprint = tokenomics.fingerprint(
                settings,
                {
                    "activity": activity,
                    "child_id": str(child_id or ""),
                    "goal_id": goal_id,
                    "body": payload,
                },
            )
            operation = tokenomics.begin_operation(
                settings,
                user,
                family_id,
                activity,
                str(request_key),
                child_id=child_id,
                fingerprint=fingerprint,
                parent_operation_id=UUID(parent) if parent else None,
                goal_id=goal_id,
                automatic_slots=4 if automatic and payload.get("setting") else 0,
                kid=kid,
                chargeable=not local_only,
            )
            operation_id = UUID(str(operation["id"]))
            if operation["replayed"]:
                result = replay(settings, user, activity, operation, child_id, family_id)
            else:
                started = monotonic()
                try:
                    with tokenomics_usage.track(settings, operation_id) as tracked:
                        result = function(*args, **kwargs)
                    useful = tracked.dispatches > 0 and useful_result(activity, result)
                    if automatic:
                        goals = available_batch_goals(
                            settings, user, child_id, result.get("response_goal_ids", [])
                        )
                        tokenomics.bind_slots(settings, user, operation_id, goals)
                    tokenomics.finish_operation(
                        settings,
                        operation_id,
                        useful=useful,
                        result_ref=result_reference(activity, result),
                        status="completed" if useful_result(activity, result) else None,
                        timings={**result.get("timings", {}), "server_ms": (monotonic() - started) * 1000},
                    )
                except Exception:
                    tokenomics.finish_operation(
                        settings,
                        operation_id,
                        useful=False,
                        status="failed",
                        timings={"server_ms": (monotonic() - started) * 1000},
                    )
                    raise
            if kid is None:
                result["tokenomics"] = tokenomics.project_operation(settings, user, family_id, operation_id)
            return result

        return wrapped

    return decorate


def useful_result(activity: str, result: dict) -> bool:
    if activity == "coach":
        # Refined finalize turns a reviewed result into its display outcome.
        # Rejecting those successes also cancels their automatic habit slots.
        return (
            result.get("mapped_by") == "ai"
            and not result.get("safety")
            and result.get("outcome", "")
            in {"", "reviewed", "recommendations", "advice", "clarification", "no_direct_fit", "out_of_scope"}
        )
    if activity == "habit_batch":
        return result.get("status") == "ready" and bool(result.get("items"))
    if activity == "onboarding":
        return bool(result.get("pain_point")) and result["pain_point"]["mapped_by"] == "ai"
    if activity == "buddy":
        from habitquest_backend.insights import BUDDY_FALLBACK

        return result.get("line") not in BUDDY_FALLBACK.values()
    return True


def result_reference(activity: str, result: dict) -> dict:
    """Return domain identifiers and allowlisted numeric/status metadata, never text."""
    if activity == "coach":
        messages = [m for m in result.get("messages", []) if m["role"] == "coach"]
        return {
            "message_id": messages[-1]["id"] if messages and not result.get("safety") else None,
            "goal_ids": result.get("response_goal_ids", []),
            "result_count": len(result.get("response_goal_ids", [])),
            "outcome": result.get("outcome", ""),
            "mapped_by": result.get("mapped_by", "manual"),
            "safety": bool(result.get("safety")),
        }
    if activity == "habit_batch":
        return {"batch_id": str(result["id"]), "result_count": len(result.get("items", []))}
    if activity in {"planner", "review"}:
        return {"report_id": str(result["id"])}
    if activity == "onboarding":
        return {"pain_point_id": str(result["pain_point"]["id"])} if result.get("pain_point") else {}
    return {}


def available_batch_goals(settings: Settings, user, child_id, goals: list[str]) -> list[str]:
    """Saved usable choices release their unused automatic slot without another call."""
    from habitquest_backend.coach_context import reset_marker

    with transaction(settings, user) as conn:
        rows = conn.execute(
            "SELECT DISTINCT b.goal_id FROM hq.habit_draft_batches b JOIN hq.children k ON k.id=b.child_id"
            " WHERE b.child_id=%s AND b.goal_id=ANY(%s) AND b.status='ready' AND b.expires_at>now()"
            " AND b.child_age=k.age AND b.reset_id=%s"
            " AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.items) item WHERE item->>'accepted_habit_id' IS NULL)",
            (child_id, goals, reset_marker(conn, child_id)),
        ).fetchall()
    existing = {row["goal_id"] for row in rows}
    return [goal for goal in goals if goal not in existing]


def replay(settings: Settings, user, activity: str, operation: dict, child_id, family_id) -> dict:
    """A replay never redispatches; missing/reset domain results require a new request."""
    if operation["status"] not in {"completed", "failed"}:
        raise HTTPException(409, "This generation is still running. Check its operation status.")
    ref = operation.get("result_ref") or {}
    with transaction(settings, user) as conn:
        if activity == "coach" and ref.get("safety"):
            from habitquest_backend.ai import SAFETY_GUIDANCE
            from habitquest_backend.coach import thread_view

            return {
                **thread_view(conn, child_id),
                "reply": SAFETY_GUIDANCE,
                "safety": {"guidance": SAFETY_GUIDANCE},
                "mapped_by": "manual",
                "response_goal_ids": [],
                "outcome": ref.get("outcome", "risk_redirect"),
            }
        if activity == "coach" and ref.get("message_id"):
            from habitquest_backend.coach import thread_view

            saved = one(
                conn,
                "SELECT content FROM hq.coach_messages WHERE id=%s AND child_id=%s",
                (ref["message_id"], child_id),
            )
            return {
                **thread_view(conn, child_id),
                "reply": saved["content"],
                "safety": None,
                "response_goal_ids": ref.get("goal_ids", []),
                "mapped_by": ref["mapped_by"],
                "outcome": ref["outcome"],
            }
        if activity == "habit_batch" and ref.get("batch_id"):
            from habitquest_backend.coach_context import reset_marker
            from habitquest_backend.generated_habits import batch_view

            row = one(
                conn,
                "SELECT * FROM hq.habit_draft_batches WHERE id=%s AND child_id=%s",
                (ref["batch_id"], child_id),
            )
            age = one(conn, "SELECT age FROM hq.children WHERE id=%s", (child_id,))["age"]
            return batch_view(row, age=age, reset_id=reset_marker(conn, child_id))
        if activity in {"planner", "review"} and ref.get("report_id"):
            return one(
                conn,
                "SELECT id,kind,result,created_at FROM hq.ai_reports WHERE id=%s AND family_id=%s",
                (ref["report_id"], family_id),
            )
        if activity == "onboarding" and ref.get("pain_point_id"):
            from habitquest_backend.onboarding import plan_view

            point = one(
                conn,
                "SELECT id,text,mapped_by,created_at FROM hq.pain_points WHERE id=%s AND child_id=%s",
                (ref["pain_point_id"], child_id),
            )
            return {"pain_point": point, "safety": None, "plan": plan_view(conn, child_id)}
    raise HTTPException(409, "This request has no saved result. Start a new request to try again.")

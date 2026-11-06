"""Explicit bounded live smoke check using only synthetic family data.

Requires separate authorization for paid provider requests. Run with --live after
local migrations/budget initialization and the backend restart. This creates
and removes only its own synthetic family. No habit is assigned. An existing report
is never overwritten, preventing accidental repetition of a paid check.
"""

import argparse
import json
from pathlib import Path
from time import perf_counter
from uuid import uuid4

import httpx
import psycopg

from habitquest_backend.auth import issue_token
from habitquest_backend.config import Settings
from habitquest_backend.llm import role_model_info
from habitquest_backend.planning_budget import generation_reservation

CASES = [
    {
        "case": "homework_help",
        "text": "Homework stalls when the child gets stuck. They need help asking a clear question.",
        "quality_criterion": "Direct help-seeking or learning-question goal; concrete, supported advice.",
    },
    {
        "case": "easier_followup",
        "text": "Make it easier, please.",
        "quality_criterion": "Retain the homework topic, lower effort; do not pad with unrelated new goals.",
    },
    {
        "case": "topic_change",
        "text": "Now a different issue: screen time ends in arguments. We need a realistic stopping point.",
        "quality_criterion": "Switch to media stopping or transition support; avoid unrelated homework advice.",
    },
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--coach-count", type=int, choices=range(4), default=3)
    parser.add_argument("--scenario", choices=("homework", "screen_balance"), default="homework")
    parser.add_argument("--child-age", type=int, choices=range(3, 14), default=8)
    parser.add_argument("--habit-count", type=int, choices=range(1, 4), default=1)
    parser.add_argument(
        "--max-reservation-usd",
        type=float,
        help="Refuse this check if its worst-case planning reservation exceeds this bound",
    )
    parser.add_argument("--skip-generation", action="store_true")
    parser.add_argument("--goal-id", help="An already generated local goal for a generation-only recheck")
    parser.add_argument(
        "--contextual-habit", action="store_true", help="Use a fixed synthetic homework/gesture instruction"
    )
    parser.add_argument("--step", action="store_true", help="Pause for result inspection between operations")
    parser.add_argument(
        "--capture-synthetic",
        action="store_true",
        help="Run an isolated in-process app and capture parsed synthetic drafts/reviews only",
    )
    args = parser.parse_args()
    selected_cases = (
        CASES[: args.coach_count]
        if args.scenario == "homework"
        else [
            {
                "case": "screen_balance",
                "text": "Entertainment screen time is hard to stop. We would like a realistic stopping point, parking the device, and a gentle transition to an offline activity.",
                "quality_criterion": "Three or four relevant choices when supported; include concrete media stopping/parking and transition support.",
            }
        ][: args.coach_count]
    )
    if not args.coach_count and not args.skip_generation and not args.goal_id:
        parser.error("Generation-only checks require --goal-id from a previously generated local goal")
    if not args.live:
        print(
            json.dumps(
                {
                    "planned_cases": selected_cases,
                    "generation_requests": int(not args.skip_generation),
                    "habits_per_request": args.habit_count,
                    "child_age": args.child_age,
                },
                indent=2,
            )
        )
        return
    settings = Settings()
    # The old app cap is no longer the benchmark's cumulative spending guard.
    # Do not let prototype tracking-only mode silently bypass a paid-check approval.
    with psycopg.connect(settings.database_url) as conn:
        if conn.execute("SELECT to_regclass('hq.ai_operations')").fetchone()[0] is not None:
            raise SystemExit(
                "This legacy live checker requires the retired planning cap. Tokenomics is active; "
                "use a separately approved benchmark harness with its own cumulative spending guard. "
                "No provider calls or synthetic-family writes were made."
            )
    planned_reservation = len(selected_cases) * (
        generation_reservation(
            settings, 80_000, settings.coach_max_output_tokens, 2 * (settings.coach_max_retries + 1)
        )
        + (16_000 + 16) * 0.02 / 1_000_000 * (1 + settings.embedding_max_retries)
    )
    if not args.skip_generation:
        planned_reservation += generation_reservation(
            settings,
            120_000,
            max(settings.habit_generation_token_floor, 800 + args.habit_count * 1100),
            2 * (settings.habit_generation_max_retries + 1),
        )
    if args.max_reservation_usd is not None and planned_reservation > args.max_reservation_usd:
        raise SystemExit("The planned reservation exceeds this check's explicit bound; no calls were made")
    if (
        settings.ai_mode != "openai"
        or settings.retrieval_mode != "pinecone"
        or settings.coach_engine != "refined"
    ):
        raise SystemExit("This check requires the activated live configuration")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Claim the report before creating data or making any provider call.
    with args.output.open("x") as stream:
        stream.write("{}\n")
    report: dict = {
        "synthetic_only": True,
        "planned_max_planning_reservation_usd": planned_reservation,
        "measurement": "HTTP round-trip to the local backend; not browser paint latency",
        "models": [
            role_model_info(settings, role) for role in ("coach", "output_safety", "habit_generation")
        ],
        "normal_operations": {
            "coach": ["coach", "output_safety"],
            "habit_generation": ["habit_generation"],
            "retrieval": ["embedding", "pinecone"],
        },
        "coach_checks": [],
        "habit_check": None,
        "cleanup": False,
    }

    def save() -> None:
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")

    client_options = {"base_url": "http://127.0.0.1:8000", "timeout": 90}
    client_factory = httpx.Client
    if args.capture_synthetic:
        # This separate process handles only the synthetic family created below.
        # Never install this capture on the running server or log raw provider data.
        from fastapi.testclient import TestClient

        from habitquest_backend import llm
        from habitquest_backend.main import create_app

        original_factory = llm.role_chat_model
        report["measurement"] = (
            "In-process ASGI request elapsed time; includes real providers and DB, excludes local TCP and browser paint"
        )
        report["synthetic_parsed_calls"] = []

        def captured_model(*model_args, **model_kwargs):
            model = original_factory(*model_args, **model_kwargs)

            class CapturedModel:
                def with_structured_output(self, *schema_args, **schema_kwargs):
                    structured = model.with_structured_output(*schema_args, **schema_kwargs)

                    class CapturedInvocation:
                        def invoke(self, messages, **invoke_kwargs):
                            response = structured.invoke(messages, **invoke_kwargs)
                            parsed = (
                                response.get("parsed")
                                if isinstance(response, dict) and "parsed" in response
                                else response
                            )
                            entry = {
                                "role": model_kwargs["role"],
                                "parsed": parsed.model_dump() if hasattr(parsed, "model_dump") else parsed,
                            }
                            if model_kwargs["role"] == "output_safety":
                                entry["display_payload"] = json.loads(messages[1][1]).get("display_payload")
                            report["synthetic_parsed_calls"].append(entry)
                            save()
                            return response

                    return CapturedInvocation()

            return CapturedModel()

        llm.role_chat_model = captured_model
        client_factory = TestClient
        client_options = {"app": create_app(settings), "base_url": "http://synthetic.test"}

    user = uuid4()
    family_id = None
    with psycopg.connect(settings.database_url) as conn:
        conn.execute("INSERT INTO hq.users(id,name) VALUES(%s,'Synthetic rollout check')", (user,))
        report["budget_before"] = str(
            conn.execute("SELECT accounted_usd FROM hq.planning_budget WHERE singleton").fetchone()[0]
        )
        report["source_goals_before"] = conn.execute(
            "SELECT count(*) FROM hq.catalog_goal_sources"
        ).fetchone()[0]
    try:
        with client_factory(
            **client_options,
            headers={"Authorization": "Bearer " + issue_token(settings, user, minutes=20)},
        ) as client:
            response = client.post(
                "/v1/families",
                json={
                    "name": "Synthetic rollout check",
                    "display_name": "Example caregiver",
                    "role": "guardian",
                    "pin": "1234",
                },
            )
            response.raise_for_status()
            family_id = response.json()["id"]
            response = client.post(
                f"/v1/families/{family_id}/children", json={"name": "Example child", "age": args.child_age}
            )
            response.raise_for_status()
            child_id = response.json()["id"]
            chosen_goal = args.goal_id
            for index, case in enumerate(selected_cases):
                if (
                    index
                    and args.step
                    and input("Inspect the report; type continue for the next Coach check: ") != "continue"
                ):
                    return
                started = perf_counter()
                response = client.post(
                    f"/v1/children/{child_id}/coach/messages", json={"text": case["text"], "setting": "home"}
                )
                elapsed = round((perf_counter() - started) * 1000, 1)
                data = response.json()
                result = {**case, "http_status": response.status_code, "roundtrip_ms": elapsed}
                result.update(
                    {
                        key: data.get(key)
                        for key in (
                            "reply",
                            "outcome",
                            "mapped_by",
                            "logical_calls",
                            "generation_passes",
                            "safety_revision",
                            "risk_status",
                            "provider_attempts",
                            "timings",
                            "token_usage",
                        )
                    }
                )
                result["goals"] = [
                    {
                        key: goal.get(key)
                        for key in ("goal_id", "title", "description", "reason", "source_ref")
                    }
                    for goal in data.get("goal_recommendations", [])
                ]
                if result["goals"] and (not chosen_goal or case["case"] == "homework_help"):
                    chosen_goal = result["goals"][0]["goal_id"]
                report["coach_checks"].append(result)
                save()
                print(
                    json.dumps(
                        {
                            "case": case["case"],
                            "status": response.status_code,
                            "outcome": data.get("outcome"),
                            "roundtrip_ms": elapsed,
                            "goals": len(result["goals"]),
                        }
                    ),
                    flush=True,
                )
                if data.get("outcome") not in (
                    "recommendations",
                    "advice",
                    "clarification",
                    "no_direct_fit",
                    "out_of_scope",
                ):
                    report["stopped_after_coach_failure"] = True
                    return
            if args.skip_generation:
                return
            if not chosen_goal:
                report["skipped_generation"] = "No generated local goal was selected"
                return
            if (
                args.coach_count
                and args.step
                and input("Inspect the report; type continue for habit generation: ") != "continue"
            ):
                return
            started = perf_counter()
            parent_instruction = (
                "Use a gesture during homework and avoid extra materials." if args.contextual_habit else ""
            )
            response = client.post(
                f"/v1/children/{child_id}/goals/{chosen_goal}/habit-drafts",
                json={
                    "request_id": str(uuid4()),
                    "setting": "home",
                    "count": args.habit_count,
                    "parent_instruction": parent_instruction,
                },
            )
            data = response.json()
            report["habit_check"] = {
                "http_status": response.status_code,
                "roundtrip_ms": round((perf_counter() - started) * 1000, 1),
                "goal_id": chosen_goal,
                "parent_instruction": parent_instruction,
            }
            report["habit_check"].update(
                {
                    key: data.get(key)
                    for key in (
                        "status",
                        "outcome",
                        "message",
                        "source",
                        "timings",
                        "logical_calls",
                        "provider_attempts",
                        "token_usage",
                        "validation_failures",
                        "failure_code",
                        "validation_mode",
                    )
                }
            )
            report["habit_check"]["drafts"] = [item["draft"] for item in data.get("items", [])]
            save()
            print(
                json.dumps(
                    {
                        "habit_status": data.get("status"),
                        "habit_outcome": data.get("outcome"),
                        "roundtrip_ms": report["habit_check"]["roundtrip_ms"],
                        "validated_drafts": len(report["habit_check"]["drafts"]),
                    }
                ),
                flush=True,
            )
    finally:
        # Only resources created by this invocation; never touch another family's rows.
        with psycopg.connect(settings.database_url) as conn:
            if family_id is not None:
                conn.execute(
                    "DELETE FROM hq.families WHERE id=%s AND EXISTS(SELECT 1 FROM hq.caregivers WHERE family_id=%s AND user_id=%s)",
                    (family_id, family_id, user),
                )
            conn.execute("DELETE FROM hq.users WHERE id=%s", (user,))
            report["budget_after"] = str(
                conn.execute("SELECT accounted_usd FROM hq.planning_budget WHERE singleton").fetchone()[0]
            )
            report["source_goals_after"] = conn.execute(
                "SELECT count(*) FROM hq.catalog_goal_sources"
            ).fetchone()[0]
        report["cleanup"] = True
        save()


if __name__ == "__main__":
    main()

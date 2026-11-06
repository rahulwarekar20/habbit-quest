"""The quest planner, weekly review and buddy lines: checks on the answers, names, and who can call them."""

import json
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest
from conftest import OTHER, PARENT, token
from fastapi.testclient import TestClient

from habitquest_backend import tokenomics
from habitquest_backend.insights import BUDDY_FALLBACK
from habitquest_backend.main import create_app

PLAN = {
    "summary": "Child A is doing well.",
    "tips": ["Child A could set an alarm."],
    "changes": [
        {
            "child": "Child A",
            "habit_id": "bedtime",
            "action": "retime",
            "cue_time": "19:45",
            "reason": "Child A is tired.",
        },
        {"child": "Child A", "habit_id": "bedtime", "action": "pause", "reason": "A duplicate."},
        {"child": "Child A", "habit_id": "homework", "action": "add", "reason": ""},
        {"child": "Child A", "habit_id": "flying", "action": "add", "reason": "Not in the catalog."},
        {"child": "Child A", "habit_id": "dinner", "action": "pause", "reason": "Not in the plan."},
        {"child": "Child Z", "habit_id": "bedtime", "action": "pause", "reason": "No such child."},
    ],
}
REVIEW = {
    "headline": "A good week for Child A.",
    "children": [
        {"child": "Child A", "wins": "Child A went to bed on time.", "watch": "Nothing to worry about"}
    ],
    "patterns": ["Child A did better this week."],
    "changes": [],
}


@pytest.fixture
def family(client, db):
    for user in (PARENT, OTHER):
        db.execute("INSERT INTO hq.users(id,name) VALUES(%s,'Test')", (user,))
    body = {"name": "Rivera", "pin": "1234", "display_name": "Sam", "role": "mother"}
    return client.post("/v1/families", json=body).json()["id"]


@pytest.fixture
def alex(client, family):
    child = client.post(f"/v1/families/{family}/children", json={"name": "Alex", "age": 8}).json()["id"]
    client.put(f"/v1/children/{child}/plan", json={"goals": ["bedtime"], "habits": [{"habit_id": "bedtime"}]})
    return child


@pytest.fixture
def live(settings, remote, family, alex):
    with TestClient(create_app(remote)) as c:
        c.headers["Authorization"] = "Bearer " + token(settings)
        yield c


def kid_headers(client, child):
    return {
        "Authorization": "Bearer " + client.post(f"/v1/children/{child}/kid-session").json()["access_token"]
    }


def test_the_planner_saves_only_changes_that_can_apply(live, family, llm_reply):
    llm_reply(json.dumps(PLAN))
    response = live.post(f"/v1/families/{family}/plan-suggestions")
    assert response.status_code == 200, response.text
    assert response.json()["result"]["summary"] == "Alex is doing well."
    assert response.json()["result"]["tips"] == ["Alex could set an alarm."]
    cards = sorted(
        live.get(f"/v1/families/{family}/suggestions").json(), key=lambda c: c["kind"], reverse=True
    )
    assert [(c["kind"], c["habit_id"], c["cue_time"], c["reason"]) for c in cards] == [
        ("retime", "bedtime", "19:45", "Alex is tired."),
        ("add", "homework", None, "This could help."),
    ]
    assert {c["source"] for c in cards} == {"planner"}
    sent = json.dumps(llm_reply.seen)
    assert "Alex" not in sent and "Child A" in sent


def test_a_retime_without_a_valid_time_is_dropped(live, family, llm_reply):
    change = {
        "child": "Child A",
        "habit_id": "bedtime",
        "action": "retime",
        "cue_time": "late",
        "reason": "x",
    }
    llm_reply(json.dumps({"summary": "Fine.", "changes": [change]}))
    live.post(f"/v1/families/{family}/plan-suggestions")
    assert live.get(f"/v1/families/{family}/suggestions").json() == []


def test_the_review_uses_this_week_and_last(live, family, alex, db, llm_reply):
    habit = db.execute("SELECT id FROM hq.child_habits WHERE child_id=%s", (alex,)).fetchone()[0]
    for offset in (1, 9):
        db.execute(
            "INSERT INTO hq.completions(child_habit_id,day,status,decided_by,decided_at)"
            " VALUES(%s,hq.child_today(%s)-%s,'approved',%s,now())",
            (habit, alex, offset, PARENT),
        )
    llm_reply(json.dumps(REVIEW))
    body = live.post(f"/v1/families/{family}/reviews").json()
    assert body["kind"] == "review" and body["result"]["headline"] == "A good week for Alex."
    assert body["result"]["children"][0]["wins"] == "Alex went to bed on time."
    assert '\\"this_week\\": 1, \\"week_before\\": 1' in json.dumps(llm_reply.seen)


def test_reports_return_the_newest_of_each(live, family, llm_reply):
    assert live.get(f"/v1/families/{family}/reports").json() == {"plan": None, "review": None}
    llm_reply(json.dumps(REVIEW))
    live.post(f"/v1/families/{family}/reviews")
    live.post(f"/v1/families/{family}/reviews")
    found = live.get(f"/v1/families/{family}/reports").json()
    assert found["plan"] is None and found["review"]["kind"] == "review"


def test_an_unavailable_model_saves_nothing(live, family, llm_reply, db):
    llm_reply(httpx.Response(503, json={"error": "down"}))
    assert live.post(f"/v1/families/{family}/plan-suggestions").status_code == 503
    assert db.execute("SELECT count(*) FROM hq.ai_reports").fetchone()[0] == 0


@pytest.mark.parametrize("path,answer", [("plan-suggestions", PLAN), ("reviews", REVIEW)])
def test_report_truncation_is_terminal_and_new_request_can_succeed(
    live, family, llm_reply, db, path, answer, caplog
):
    truncated = httpx.Response(
        200,
        json={
            "id": "synthetic-truncated",
            "object": "chat.completion",
            "created": 0,
            "model": "m",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "length",
                    "message": {
                        "role": "assistant",
                        "content": "private partial report",
                        "reasoning_content": "private reasoning",
                    },
                }
            ],
            "usage": {
                "prompt_tokens": 1200,
                "completion_tokens": 4000,
                "total_tokens": 5200,
                "completion_tokens_details": {"reasoning_tokens": 4000},
            },
        },
    )
    llm_reply(truncated, json.dumps(answer))
    url = f"/v1/families/{family}/{path}"
    request = f"?request_id={uuid4()}"
    failed = live.post(url + request)
    assert failed.status_code == 502 and "cut short" in failed.json()["detail"]
    assert "busy" not in failed.text and "private" not in caplog.text
    assert db.execute("SELECT count(*) FROM hq.ai_reports").fetchone()[0] == 0
    assert db.execute(
        "SELECT status,credits,pending_credits FROM hq.ai_operations WHERE family_id=%s", (family,)
    ).fetchone() == ("failed", 0, 0)
    assert live.post(url + request).status_code == 409
    assert len(llm_reply.seen) == 1
    successful = live.post(url + f"?request_id={uuid4()}")
    assert successful.status_code == 200 and successful.json()["tokenomics"]["credits"] == 2
    assert len(llm_reply.seen) == 2
    assert db.execute("SELECT count(*) FROM hq.ai_reports").fetchone()[0] == 1


@pytest.mark.parametrize(
    "path,answer,role", [("plan-suggestions", PLAN, "planner"), ("reviews", REVIEW, "review")]
)
def test_nebius_reports_disable_unbounded_reasoning_and_keep_model(
    settings, remote, family, alex, llm_reply, path, answer, role
):
    from habitquest_backend import llm

    remote.openai_base_url = "https://api.tokenfactory.us-north1.nebius.com/v1/"
    remote.openai_model = "deepseek-ai/DeepSeek-V4.1-Flash-1017"
    llm_reply(json.dumps(answer))
    with TestClient(create_app(remote)) as client:
        client.headers["Authorization"] = "Bearer " + token(settings)
        response = client.post(f"/v1/families/{family}/{path}")
    assert response.status_code == 200
    assert len(llm_reply.seen) == 1
    assert llm_reply.seen[0]["reasoning_effort"] == "none"
    assert llm_reply.seen[0]["model"] == remote.openai_model
    assert llm_reply.seen[0]["max_completion_tokens"] == 4000
    configured = next(item for item in llm.effective_models(remote) if item["role"] == role)
    assert configured["reasoning_effort"] == "none"


def test_fake_mode_writes_plain_reports(client, family, alex):
    assert client.post(f"/v1/families/{family}/plan-suggestions").json()["result"]["tips"] == []
    body = client.post(f"/v1/families/{family}/reviews").json()
    assert body["result"]["children"][0]["wins"] == "0 quests approved this week."


def test_a_family_needs_a_child_first(client, family):
    assert client.post(f"/v1/families/{family}/reviews").status_code == 409


def test_outsiders_and_kids_cannot_read_reports(client, settings, family, alex):
    headers = {"Authorization": "Bearer " + token(settings, OTHER)}
    assert client.post(f"/v1/families/{family}/reviews", headers=headers).status_code == 404
    assert client.get(f"/v1/families/{family}/reports", headers=headers).status_code == 404
    assert client.get(f"/v1/families/{family}/reports", headers=kid_headers(client, alex)).status_code == 401


def test_fake_mode_gives_the_built_in_line(client, alex):
    headers = kid_headers(client, alex)
    response = client.post("/v1/kid/buddy-line", json={"event": "greet"}, headers=headers)
    assert response.json() == {"line": BUDDY_FALLBACK["greet"]}


def test_a_safe_line_reaches_the_child_without_their_name(live, alex, llm_reply):
    llm_reply('"Great  job on your\nquests!"', '{"safe": true, "category": "none", "risk": false}')
    response = live.post("/v1/kid/buddy-line", json={"event": "submitted"}, headers=kid_headers(live, alex))
    assert response.json() == {"line": "Great job on your quests!"}
    assert llm_reply.seen[0]["model"] == "vendor/small" and "Alex" not in json.dumps(llm_reply.seen)


@pytest.mark.parametrize(
    "replies",
    [
        ("",),
        ("word " * 40,),
        ("You are so dumb.",),
        ("A nice line.", '{"safe": false, "category": "unkind", "risk": false}'),
        (httpx.Response(503, json={"error": "down"}),),
    ],
)
def test_an_unusable_line_is_replaced(live, alex, llm_reply, replies):
    llm_reply(*replies)
    response = live.post("/v1/kid/buddy-line", json={"event": "celebrate"}, headers=kid_headers(live, alex))
    assert response.json() == {"line": BUDDY_FALLBACK["celebrate"]}


def test_tracking_only_mode_bypasses_the_old_daily_limit_and_keeps_child_costs(
    settings, remote, db, alex, llm_reply
):
    limited = remote.model_copy(update={"ai_daily_limit": 1})
    policy = tokenomics.get_policy(settings)
    tokenomics.update_policy(settings, policy["revision"], {"enforce_budgets": False})
    safe = '{"safe": true, "category": "none", "risk": false}'
    llm_reply("A nice line.", safe, "Another nice line.", safe)
    try:
        with TestClient(create_app(limited)) as c:
            c.headers["Authorization"] = "Bearer " + token(settings)
            headers = kid_headers(c, alex)
            first = c.post("/v1/kid/buddy-line", json={"event": "greet"}, headers=headers)
            second = c.post("/v1/kid/buddy-line", json={"event": "greet"}, headers=headers)
        assert first.json() == {"line": "A nice line."}
        assert second.json() == {"line": "Another nice line."}
        assert len(llm_reply.seen) == 4
        assert db.execute(
            "SELECT count(*),sum(credits) FROM hq.ai_operations WHERE activity='buddy' AND child_id=%s",
            (alex,),
        ).fetchone() == (2, 0)
        assert (
            db.execute(
                "SELECT count(*) FROM hq.ai_provider_attempts a JOIN hq.ai_operations o ON o.id=a.operation_id WHERE o.activity='buddy' AND o.child_id=%s",
                (alex,),
            ).fetchone()[0]
            == 4
        )
    finally:
        tokenomics.update_policy(
            settings,
            tokenomics.get_policy(settings)["revision"],
            {"enforce_budgets": policy["enforce_budgets"]},
        )


def test_strict_operator_cap_preserves_safe_buddy_fallback_without_dispatch(
    settings, remote, db, alex, llm_reply
):
    # Use a seeded, priced model so this exercises cap rejection, not unknown-pricing rejection.
    limited = remote.model_copy(
        update={
            "openai_base_url": "https://api.openai.com/v1",
            "openai_model": "gpt-6-luna",
            "openai_small_model": "gpt-6-luna",
        }
    )
    policy = tokenomics.get_policy(settings)
    exposure = db.execute(
        "SELECT legacy_initialized,legacy_carryover_usd FROM hq.tokenomics_exposure"
    ).fetchone()
    db.execute("UPDATE hq.tokenomics_exposure SET legacy_initialized=true,legacy_carryover_usd=0")
    tokenomics.update_policy(
        settings, policy["revision"], {"enforce_budgets": True, "operator_cap_usd": Decimal("0.000000001")}
    )
    llm_reply("This provider response must never be requested.")
    try:
        with TestClient(create_app(limited)) as c:
            c.headers["Authorization"] = "Bearer " + token(settings)
            response = c.post("/v1/kid/buddy-line", json={"event": "greet"}, headers=kid_headers(c, alex))
        assert response.status_code == 200
        assert response.json() == {"line": BUDDY_FALLBACK["greet"]}
        assert llm_reply.seen == []
        assert db.execute(
            "SELECT status,credits FROM hq.ai_operations WHERE activity='buddy' AND child_id=%s", (alex,)
        ).fetchone() == ("failed", 0)
        assert (
            db.execute(
                "SELECT count(*) FROM hq.ai_provider_attempts a JOIN hq.ai_operations o ON o.id=a.operation_id WHERE o.activity='buddy' AND o.child_id=%s",
                (alex,),
            ).fetchone()[0]
            == 0
        )
    finally:
        tokenomics.update_policy(
            settings,
            tokenomics.get_policy(settings)["revision"],
            {"enforce_budgets": policy["enforce_budgets"], "operator_cap_usd": policy["operator_cap_usd"]},
        )
        db.execute(
            "UPDATE hq.tokenomics_exposure SET legacy_initialized=%s,legacy_carryover_usd=%s", exposure
        )

"""Live progress is request-scoped, preserves endpoint guards and exposes no partial drafts."""

import asyncio
import json
from threading import Event
from uuid import uuid4

import pytest
from conftest import OTHER, token
from fastapi import HTTPException
from test_generated_habits import app as app
from test_generated_habits import goal as goal

from habitquest_backend import coach
from habitquest_backend import generation_progress as gp


def frames(text):
    return [
        (part.splitlines()[0].removeprefix("event: "), json.loads(part.split("data: ", 1)[1]))
        for part in text.split("\n\n")
        if part.startswith("event:")
    ]


def test_stream_heartbeat_final_result_and_reporter_cleanup(monkeypatch):
    original = asyncio.wait_for
    first = True

    async def wait(awaitable, timeout):
        nonlocal first
        if first:
            first = False
            awaitable.close()
            raise TimeoutError()
        return await original(awaitable, timeout)

    monkeypatch.setattr(asyncio, "wait_for", wait)

    def operation():
        gp.report_stage("generation")
        gp.report_stage("safety")
        return {"reply": "Reviewed text only"}

    async def consume():
        response = gp.stream_operation(operation)
        assert response.headers["x-accel-buffering"] == "no"
        return "".join([part async for part in response.body_iterator])

    text = asyncio.run(consume())
    assert text.startswith(": keep-alive")
    events = frames(text)
    assert [data["stage"] for kind, data in events if kind == "stage"] == ["generation", "safety", "complete"]
    assert events[-1] == ("result", {"reply": "Reviewed text only"})
    assert all(set(data) == {"stage", "elapsed_ms"} for kind, data in events if kind == "stage")
    assert gp._reporter.get() is None
    gp.report_stage("ignored_outside_request")


@pytest.mark.parametrize(
    "error", [HTTPException(409, "Request context changed"), RuntimeError("private detail")]
)
def test_stream_errors_are_explicit_and_sanitized(error):
    def operation():
        raise error

    async def consume():
        return "".join([part async for part in gp.stream_operation(operation).body_iterator])

    events = frames(asyncio.run(consume()))
    assert len(events) == 1 and events[0][0] == "error"
    assert events[0][1]["status"] == (409 if isinstance(error, HTTPException) else 500)
    assert "private detail" not in str(events)


def test_disconnected_stream_does_not_publish_later_events():
    resume, finished = Event(), Event()

    def operation():
        gp.report_stage("context")
        resume.wait(2)
        gp.report_stage("saving")
        finished.set()
        return {}

    async def consume():
        iterator = gp.stream_operation(operation).body_iterator
        assert "context" in await anext(iterator)
        await iterator.aclose()
        resume.set()
        await asyncio.to_thread(finished.wait, 2)
        await asyncio.sleep(0.01)

    asyncio.run(consume())
    assert finished.is_set()


def test_streaming_generation_keeps_auth_scope_idempotency_and_saved_results(
    app, goal, settings, monkeypatch
):
    client, family, child = app
    settings.coach_engine = "refined"
    settings.retrieval_mode = "fixture"
    # This test owns one catalog goal; do not leave other global fixture goals behind.
    monkeypatch.setattr(coach, "goal_retriever", lambda *args: lambda *args: [goal.candidate()])
    body = {"request_id": str(uuid4()), "setting": "home", "count": 1}
    path = f"/v1/children/{child}/goals/{goal.goal_id}/habit-drafts?stream=true"
    response = client.post(path, json=body)
    assert response.headers["content-type"].startswith("text/event-stream")
    events = frames(response.text)
    batch = events[-1][1]
    assert events[-1][0] == "result" and batch["status"] == "ready"
    assert batch["logical_calls"] == 0  # Mocked provider only.
    replay = frames(client.post(path, json=body).text)
    assert replay[-1][1] == batch
    assert len(client.get(f"/v1/children/{child}/goals/{goal.goal_id}/habit-drafts").json()["batches"]) == 1
    other = {"Authorization": "Bearer " + token(settings, OTHER)}
    refused = frames(client.post(path, json=body, headers=other).text)
    assert refused[-1][0] == "error" and refused[-1][1]["status"] == 404
    assert "items" not in str(refused)
    assert client.post(path, json=body, headers={"Authorization": "Bearer invalid"}).status_code == 401

    coach_events = frames(
        client.post(
            f"/v1/children/{child}/coach/messages?stream=true",
            json={
                "text": "Help us get started with homework",
                "setting": "home",
            },
        ).text
    )
    assert coach_events[-1][0] == "result" and coach_events[-1][1]["messages"]
    stages = [data["stage"] for event, data in coach_events if event == "stage"]
    assert stages[0] == "context" and "retrieval" in stages and stages[-1] == "complete"
    for suffix, expected in [("plan-suggestions", "planning"), ("reviews", "review")]:
        events = frames(client.post(f"/v1/families/{family}/{suffix}?stream=true").text)
        assert [data["stage"] for event, data in events if event == "stage"] == [
            "context",
            expected,
            "validation",
            "saving",
            "complete",
        ]
        assert events[-1][0] == "result" and events[-1][1]["result"]

"""Provider boundary accounting uses synthetic transports, never live providers."""

import asyncio
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from habitquest_backend import llm, tokenomics
from habitquest_backend import tokenomics_usage as usage


@pytest.fixture
def records(monkeypatch):
    rows = []
    monkeypatch.setattr(
        tokenomics, "record_attempt", lambda settings, operation, row: rows.append((operation, dict(row)))
    )
    return rows


def request(**body):
    return httpx.Request(
        "POST",
        "https://api.openai.com/v1/responses",
        json={"model": "gpt-6-luna", "max_output_tokens": 100, **body},
    )


def test_scope_retains_only_metadata_and_retries_are_separate_attempts(settings, records):
    assert not usage.active()
    assert usage.start("coach", request()) is None
    usage.finish(None, None)
    ident = uuid4()
    with usage.track(settings, ident) as scope:
        first = usage.start("coach", request(input="NEVER STORE THIS"))
        usage.finish(first, httpx.Response(503, json={"error": "PRIVATE ERROR"}))
        retry = request()
        retry.headers["x-stainless-retry-count"] = "1"
        second = usage.start("coach", retry)
        usage.finish(
            second,
            httpx.Response(
                200,
                json={
                    "model": "gpt-6-luna",
                    "output": "PRIVATE ANSWER",
                    "usage": {"input_tokens": 12, "output_tokens": 3},
                },
                headers={"x-request-id": "req_safe"},
            ),
        )
        assert scope.dispatches == 2
        with usage.track(settings, uuid4()):
            third = usage.start("coach", retry)
            usage.finish(third, None, TimeoutError())
    assert not usage.active()
    assert records[0][1]["id"] != records[2][1]["id"]
    assert records[0][1]["invocation_id"] == records[2][1]["invocation_id"]
    assert records[4][1]["invocation_id"] != records[0][1]["invocation_id"]
    assert records[1][1]["error_code"] == "http_503"
    assert records[3][1]["input_tokens"] == 12
    assert records[3][1]["output_tokens"] == 3
    assert records[3][1]["request_id"] == "req_safe"
    assert records[5][1]["error_code"] == "TimeoutError"
    assert "PRIVATE" not in str(records) and "NEVER STORE" not in str(records)


@pytest.mark.parametrize("status", [429, 503])
def test_budget_dispatch_denial_uses_safe_model_failure_without_counting_a_call(
    settings, monkeypatch, status
):
    def deny(*args):
        raise HTTPException(status, "PRIVATE ledger explanation")

    monkeypatch.setattr(tokenomics, "record_attempt", deny)
    with usage.track(settings, uuid4()) as scope:
        with pytest.raises(usage.DispatchUnavailable) as error:
            usage.start("buddy", request())
        assert scope.dispatches == 0
    assert isinstance(error.value, ValueError)
    assert "PRIVATE" not in str(error.value)


def test_dispatch_does_not_hide_authorization_or_integrity_failures(settings, monkeypatch):
    def deny(*args):
        raise HTTPException(403, "Access denied")

    monkeypatch.setattr(tokenomics, "record_attempt", deny)
    with usage.track(settings, uuid4()) as scope:
        with pytest.raises(HTTPException) as error:
            usage.start("buddy", request())
        assert error.value.status_code == 403 and scope.dispatches == 0


@pytest.mark.parametrize("payload", [{}, {"usage": None}, [], "not json"])
def test_missing_usage_remains_unknown(settings, records, payload):
    with usage.track(settings, uuid4()):
        ticket = usage.start("coach", request(model="invalid model with spaces"))
        response = (
            httpx.Response(200, text=payload)
            if isinstance(payload, str)
            else httpx.Response(200, json=payload)
        )
        usage.finish(ticket, response)
    assert records[0][1]["model"] == "unknown"
    assert "input_tokens" not in records[-1][1]


def test_embedding_and_search_are_independent_metered_operations(settings, records):
    with usage.track(settings, uuid4()):
        embed = usage.start(
            "embedding",
            httpx.Request(
                "POST",
                "https://api.openai.com/v1/embeddings",
                json={"model": "text-embedding-3-small", "input": "private", "dimensions": 512},
            ),
        )
        usage.finish(
            embed,
            httpx.Response(200, json={"data": [{"embedding": [1, 2, 3]}], "usage": {"prompt_tokens": 20}}),
        )
        query = usage.start(
            "pinecone",
            httpx.Request(
                "POST",
                "https://private-index.pinecone.io/documents/search",
                json={"score_by": [{"values": [1, 2, 3]}]},
            ),
            search=True,
        )
        usage.finish(
            query,
            httpx.Response(
                200,
                json={"matches": [{"_id": "private-doc"}], "usage": {"read_units": 1, "egress_bytes": 20000}},
            ),
        )
    assert records[0][1]["api_mode"] == "embeddings"
    assert records[1][1]["output_tokens"] == 0
    assert records[2][1]["provider"] == "api.pinecone.io"
    assert records[3][1]["read_units"] == 1
    assert records[3][1]["read_units_precision"] == "rounded_up"
    assert records[3][1]["egress_bytes"] == 20000
    assert "private" not in str(records)


def test_cache_and_reasoning_counters_do_not_become_extra_output():
    result = usage.extract_usage(
        {
            "prompt_tokens": 100,
            "completion_tokens": 20,
            "prompt_tokens_details": {"cached_tokens": 80},
            "completion_tokens_details": {"reasoning_tokens": 15},
            "cache_creation_input_tokens": 10,
        },
        "review",
    )
    assert result == {
        "input_tokens": 100,
        "output_tokens": 20,
        "cached_input_tokens": 80,
        "cache_write_tokens": 10,
        "reasoning_tokens": 15,
    }
    assert usage.extract_usage({"read_units": True, "egress_bytes": -2}, "pinecone")["read_units"] is None
    assert usage.extract_usage({"read_units": float("nan")}, "pinecone")["read_units"] is None
    assert usage.extract_usage({"read_units": None}, "pinecone")["read_units"] is None
    assert usage.extract_usage({}, "coach")["output_tokens"] is None
    assert usage.safe_id(None) is None
    assert usage.count(True) is None


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("failure", [False, True])
def test_transports_record_dispatch_and_usage_even_on_provider_failure(
    settings, records, asynchronous, failure
):
    def answer(req):
        if failure:
            raise httpx.ReadTimeout("private payload not retained")
        return httpx.Response(200, json={"usage": {"input_tokens": 3, "output_tokens": 2}})

    async def run():
        transport = llm._AsyncCountingTransport(
            httpx.AsyncClient(transport=httpx.MockTransport(answer)), "coach"
        )
        return await transport.handle_async_request(request())

    with usage.track(settings, uuid4()):
        if failure:
            with pytest.raises(httpx.ReadTimeout):
                asyncio.run(run()) if asynchronous else llm._CountingTransport(
                    httpx.Client(transport=httpx.MockTransport(answer)), "coach"
                ).handle_request(request())
        else:
            response = (
                asyncio.run(run())
                if asynchronous
                else llm._CountingTransport(
                    httpx.Client(transport=httpx.MockTransport(answer)), "coach"
                ).handle_request(request())
            )
            assert response.json()["usage"]["input_tokens"] == 3
    assert len(records) == 2
    assert records[-1][1]["status"] == ("failed" if failure else "completed")
    assert "private payload" not in str(records)


def test_effective_model_table_tracks_helpers_and_fixture_mode(settings, remote):
    rows = {r["role"]: r for r in llm.effective_models(remote)}
    assert rows["planner"]["model"] == remote.openai_model
    assert rows["buddy"]["model"] == rows["child_screen"]["model"] == remote.openai_small_model
    assert rows["pinecone"]["api_mode"] == "documents_search"
    assert not rows["parent_risk"]["active"]
    assert not any(r["active"] for r in llm.effective_models(settings))


def test_legacy_helpers_use_the_same_resolver_and_metered_transport(remote, monkeypatch):
    captured = {}
    monkeypatch.setattr(llm, "init_chat_model", lambda **kwargs: captured.update(kwargs))
    llm.chat_model(remote, role="buddy", small=True)
    assert captured["model"] == llm.legacy_model_info(remote, small=True)["model"]
    assert isinstance(captured["http_client"]._transport, llm._CountingTransport)
    assert isinstance(captured["http_async_client"]._transport, llm._AsyncCountingTransport)
    assert captured["http_client"]._transport.role == "buddy"

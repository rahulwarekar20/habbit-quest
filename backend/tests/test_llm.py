"""Role-specific provider routing, deadlines, and actual HTTP-attempt accounting."""

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from typing import cast

import httpx
import pytest
from pydantic import SecretStr

from habitquest_backend import llm
from habitquest_backend.safety import parent_risk_model


@pytest.mark.parametrize(
    "role,host,model,configured,override,expected",
    [
        (
            "planner",
            "api.tokenfactory.nebius.com",
            "deepseek-ai/DeepSeek-V4.1-Flash-1017",
            "auto",
            None,
            "none",
        ),
        ("review", "api.tokenfactory.nebius.com", "deepseek-ai/DeepSeek-V4-Pro", "low", None, "low"),
        ("planner", "api.tokenfactory.nebius.com", "deepseek-ai/DeepSeek-V4-Pro", "none", "high", "high"),
        ("buddy", "api.tokenfactory.nebius.com", "deepseek-ai/DeepSeek-V4-Pro", "none", None, None),
        ("planner", "api.openai.com", "gpt-6-luna", "auto", None, None),
        ("planner", "api.tokenfactory.nebius.com", "deepseek-ai/DeepSeek-R1", "auto", None, None),
        (
            "review",
            "api.tokenfactory.nebius.com.example.org",
            "deepseek-ai/DeepSeek-V4-Pro",
            "auto",
            None,
            None,
        ),
    ],
)
def test_helper_reasoning_policy_is_scoped(settings, role, host, model, configured, override, expected):
    configured_settings = settings.model_copy(
        update={
            "openai_base_url": f"https://{host}/v1",
            "openai_model": model,
            "ai_helper_reasoning_effort": configured,
        }
    )
    info = llm.legacy_model_info(configured_settings, role=role, reasoning_effort=override)
    assert info["reasoning_effort"] == expected and info["model"] == model


def completion(text="Done"):
    return httpx.Response(
        200,
        json={
            "id": "test",
            "object": "chat.completion",
            "created": 0,
            "model": "test",
            "choices": [
                {"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": text}}
            ],
        },
    )


def test_role_info_keeps_legacy_and_imported_models_separate(remote):
    settings = remote.model_copy(
        update={"coach_provider": "planning", "parent_risk_model": "risk", "output_safety_model": "review"}
    )
    assert llm.role_model_info(settings, "coach")["model"] == "gpt-6-luna"
    assert llm.role_model_info(settings, "habit_generation")["max_retries"] == 0
    assert llm.role_model_info(settings, "parent_risk")["model"] == "risk"
    assert llm.role_model_info(settings, "output_safety")["model"] == "review"
    assert llm.role_model_info(remote, "coach")["model"] == "vendor/model"
    assert llm.role_model_info(remote, "parent_risk")["model"] == "vendor/small"
    safety = remote.model_copy(update={"openai_safety_model": "safeguard"})
    assert llm.role_model_info(safety, "output_safety")["model"] == "safeguard"
    primary = remote.model_copy(update={"openai_small_model": ""})
    assert llm.role_model_info(primary, "parent_risk")["model"] == "vendor/model"
    assert "api_key" not in llm.role_model_info(settings, "coach")
    with pytest.raises(ValueError, match="Unknown model role"):
        llm.role_model_info(settings, cast(llm.ModelRole, "unknown"))


def test_imported_model_constructor_uses_its_own_credentials(remote, monkeypatch):
    settings = remote.model_copy(
        update={"coach_provider": "planning", "planning_openai_api_key": SecretStr("new-key")}
    )
    seen = []
    monkeypatch.setattr(llm, "init_chat_model", lambda **kwargs: seen.append(kwargs))
    llm.role_chat_model(settings, role="coach", timeout_seconds=2)
    llm.role_chat_model(settings, role="habit_generation", max_output_tokens=4100)
    coach, writer = seen
    assert coach["api_key"] == writer["api_key"] == "new-key"
    assert coach["base_url"] == "https://api.openai.com/v1"
    assert coach["model"] == writer["model"] == "gpt-6-luna"
    assert coach["use_responses_api"] is True and coach["store"] is False
    assert coach["reasoning"] == {"effort": "low"}
    assert coach["timeout"] == 2 and coach["max_retries"] == 1
    assert writer["max_tokens"] == 4100 and writer["max_retries"] == 0


def test_role_adapter_rejects_missing_credentials_fake_mode_and_elapsed_deadlines(settings, remote):
    with pytest.raises(ValueError, match="AI_MODE=openai"):
        llm.role_chat_model(settings, role="coach")
    with pytest.raises(ValueError, match="PLANNING_OPENAI_API_KEY"):
        llm.role_chat_model(remote, role="habit_generation")
    for change in (
        {"openai_api_key": None},
        {"openai_api_key": SecretStr(" ")},
        {"openai_base_url": ""},
        {"openai_model": " "},
    ):
        with pytest.raises(ValueError, match="own configured provider"):
            llm.role_chat_model(remote.model_copy(update=change), role="coach")
    with pytest.raises(TimeoutError, match="deadline"):
        llm.role_chat_model(remote, role="coach", timeout_seconds=0)
    for tokens in (0, 16001):
        with pytest.raises(ValueError, match="output token limit"):
            llm.role_chat_model(remote, role="coach", max_output_tokens=tokens)


def test_actual_dispatches_include_sdk_retries_and_propagate_timeout(remote, monkeypatch):
    seen = []

    def respond(request):
        seen.append(request)
        return (
            httpx.Response(503, json={"error": "busy"}, headers={"retry-after-ms": "1"})
            if len(seen) == 1
            else completion()
        )

    monkeypatch.setattr(llm, "http_client", lambda _: httpx.Client(transport=httpx.MockTransport(respond)))
    with llm.track_provider_attempts() as counts:
        response = llm.role_chat_model(remote, role="coach", timeout_seconds=1.5).invoke("Example")
    assert response.text == "Done"
    assert counts.snapshot() == {"coach": 2}
    assert counts.total == 2
    assert seen[0].url.host == "llm.example"
    assert seen[0].headers["authorization"] == "Bearer k"
    assert seen[0].extensions["timeout"]["read"] == 1.5
    assert json.loads(seen[0].content)["model"] == "vendor/model"


def test_async_dispatch_is_counted_without_a_real_network(remote, monkeypatch):
    monkeypatch.setattr(
        llm,
        "async_http_client",
        lambda _: httpx.AsyncClient(transport=httpx.MockTransport(lambda _: completion())),
    )

    async def run():
        with llm.track_provider_attempts() as counts:
            answer = await llm.role_chat_model(remote, role="output_safety").ainvoke("Example")
            return answer, counts.snapshot()

    answer, counts = asyncio.run(run())
    assert answer.text == "Done"
    assert counts == {"output_safety": 1}


def test_luna_uses_responses_wire_and_imported_key(remote, monkeypatch):
    seen = []

    def respond(request):
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "id": "resp_test",
                "object": "response",
                "created_at": 0,
                "model": "gpt-6-luna",
                "status": "completed",
                "output": [
                    {
                        "id": "msg_test",
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "content": [{"type": "output_text", "text": "Reviewed example", "annotations": []}],
                    }
                ],
                "usage": {"input_tokens": 2, "output_tokens": 2, "total_tokens": 4},
            },
        )

    monkeypatch.setattr(llm, "http_client", lambda _: httpx.Client(transport=httpx.MockTransport(respond)))
    settings = remote.model_copy(
        update={"coach_provider": "planning", "planning_openai_api_key": SecretStr("planning-key")}
    )
    with llm.track_provider_attempts() as counts:
        answer = llm.role_chat_model(settings, role="coach").invoke("Synthetic example")
    assert answer.text == "Reviewed example"
    assert str(seen[0].url) == "https://api.openai.com/v1/responses"
    assert seen[0].headers["authorization"] == "Bearer planning-key"
    body = json.loads(seen[0].content)
    assert body["model"] == "gpt-6-luna" and body["store"] is False
    assert body["reasoning"] == {"effort": "low"}
    assert body["max_output_tokens"] == 1600
    assert counts.snapshot() == {"coach": 1}


def test_refined_parent_risk_preserves_unavailable_distinction(remote, llm_reply):
    llm_reply("unused")
    llm_reply.risk = httpx.Response(503, json={"error": "unavailable"}, headers={"retry-after-ms": "1"})
    settings = remote.model_copy(update={"coach_engine": "refined"})
    with llm.track_provider_attempts() as counts:
        assert parent_risk_model(settings, "Child A needs help") is None
    assert counts.snapshot() == {"parent_risk": 2}


def test_counters_are_isolated_and_can_follow_a_worker_context():
    llm.record_provider_attempt("untracked")
    with llm.track_provider_attempts() as outer:
        llm.record_provider_attempt("parent_risk")
        with llm.track_provider_attempts() as inner:
            llm.record_provider_attempt("coach")
        with ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(copy_context().run, llm.record_provider_attempt, "output_safety").result()
    assert inner.snapshot() == {"coach": 1}
    assert outer.snapshot() == {"parent_risk": 1, "output_safety": 1}


def test_refined_parent_risk_is_counted_and_keeps_the_safety_route(remote, llm_reply):
    llm_reply("unused")
    settings = remote.model_copy(update={"coach_engine": "refined", "parent_risk_model": "risk-specialist"})
    with llm.track_provider_attempts() as counts:
        assert parent_risk_model(settings, "Child A needs help", timeout_seconds=2) is False
    assert llm_reply.risk_seen[0]["model"] == "risk-specialist"
    assert counts.snapshot() == {"parent_risk": 1}


def test_shared_pool_retains_tls_timeouts_and_limits_with_longer_keepalive(settings, monkeypatch):
    assert llm.http_client(settings) is llm.http_client(settings)
    assert llm.async_http_client(settings) is llm.async_http_client(settings)
    sentinel = object()
    seen = []
    monkeypatch.setattr(llm.ssl, "create_default_context", lambda **kw: sentinel)
    monkeypatch.setattr(llm.httpx, "Client", lambda **kw: seen.append(kw))
    monkeypatch.setattr(llm.httpx, "AsyncClient", lambda **kw: seen.append(kw))
    llm.shared_client(11.1, "test-ca.pem")
    llm.shared_async_client(11.1, "test-ca.pem")
    # Repeated requests borrow their existing pool rather than recreating it.
    llm.shared_client(11.1, "test-ca.pem")
    llm.shared_async_client(11.1, "test-ca.pem")
    assert len(seen) == 2
    for item in seen:
        assert item["verify"] is sentinel and item["timeout"] == 11.1
        limits = item["limits"]
        assert limits.keepalive_expiry == 60
        # Supplying only keepalive_expiry would silently remove HTTPX's defaults.
        assert limits.max_connections == 100 and limits.max_keepalive_connections == 20


def test_provider_deadline_prevents_a_new_dispatch(remote, monkeypatch):
    monkeypatch.setattr(llm, "monotonic", lambda: 10)
    with llm.track_provider_attempts(deadline=10) as counts:
        with pytest.raises(TimeoutError):
            llm.record_provider_attempt("coach")
        assert counts.total == 0
    with llm.track_provider_attempts(deadline=11) as counts:
        llm.record_provider_attempt("embedding")
        assert counts.snapshot() == {"embedding": 1}


def test_embedding_factory_is_fixed_and_uses_imported_group(remote, monkeypatch):
    from test_config import configured

    with pytest.raises(ValueError, match="pinecone"):
        llm.embedding_model(remote)
    settings = configured(retrieval_mode="pinecone")
    seen = []
    monkeypatch.setattr(llm, "OpenAIEmbeddings", lambda **kwargs: seen.append(kwargs))
    llm.embedding_model(settings)
    call = seen[0]
    assert call["model"] == "text-embedding-3-small" and call["dimensions"] == 512
    assert call["api_key"] == settings.planning_openai_api_key
    assert call["max_retries"] == 0 and call["timeout"] == 15

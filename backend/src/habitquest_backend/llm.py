"""The chat model: any OpenAI-compatible endpoint (Nebius Token Factory) through LangChain."""

import ssl
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import lru_cache
from threading import Lock
from time import monotonic
from typing import Any, Literal
from urllib.parse import urlsplit

import httpx
from langchain.chat_models import init_chat_model
from langchain_core.language_models import BaseChatModel
from langchain_openai import OpenAIEmbeddings

from habitquest_backend import tokenomics_usage
from habitquest_backend.config import Settings

# Reasoning models spend part of this budget on hidden reasoning, so it must leave room for the answer.
MAX_TOKENS = 4000
ModelRole = Literal["coach", "habit_generation", "parent_risk", "output_safety"]


@dataclass
class AttemptCounts:
    """HTTP dispatch counts, not logical invocations; never stores request data."""

    counts: Counter[str] = field(default_factory=Counter)
    deadline: float | None = None
    _lock: Lock = field(default_factory=Lock, repr=False)

    def record(self, role: str) -> None:
        with self._lock:
            self.counts[role] += 1

    def snapshot(self) -> dict[str, int]:
        with self._lock:
            return dict(self.counts)

    @property
    def total(self) -> int:
        return sum(self.snapshot().values())


_attempts: ContextVar[AttemptCounts | None] = ContextVar("provider_attempts", default=None)


@contextmanager
def track_provider_attempts(*, deadline: float | None = None) -> Iterator[AttemptCounts]:
    """Request-local accounting; propagate copy_context when using an executor."""
    counter = AttemptCounts(deadline=deadline)
    token = _attempts.set(counter)
    try:
        yield counter
    finally:
        _attempts.reset(token)


def check_provider_deadline() -> None:
    counter = _attempts.get()
    if counter is not None and counter.deadline is not None and monotonic() >= counter.deadline:
        raise TimeoutError("The provider operation deadline has elapsed")


def record_provider_attempt(role: str, *, check_deadline: bool = True) -> None:
    """Records a single dispatched HTTP attempt, including a transport retry."""
    if check_deadline:
        check_provider_deadline()
    counter = _attempts.get()
    if counter is not None:
        counter.record(role)


class _CountingTransport(httpx.BaseTransport):
    """Delegates to the shared client, preserving its pooling and test transport."""

    def __init__(self, client: httpx.Client, role: str):
        self.client, self.role = client, role

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        check_provider_deadline()
        ticket = tokenomics_usage.start(self.role, request)
        record_provider_attempt(self.role, check_deadline=False)
        try:
            response = self.client.send(request, stream=True)
            if ticket is not None:
                response.read()
        except Exception as exc:
            tokenomics_usage.finish(ticket, None, exc)
            raise
        tokenomics_usage.finish(ticket, response)
        return response


class _AsyncCountingTransport(httpx.AsyncBaseTransport):
    def __init__(self, client: httpx.AsyncClient, role: str):
        self.client, self.role = client, role

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        check_provider_deadline()
        ticket = tokenomics_usage.start(self.role, request)
        record_provider_attempt(self.role, check_deadline=False)
        try:
            response = await self.client.send(request, stream=True)
            if ticket is not None:
                await response.aread()
        except Exception as exc:
            tokenomics_usage.finish(ticket, None, exc)
            raise
        tokenomics_usage.finish(ticket, response)
        return response


@lru_cache(maxsize=4)
def shared_client(timeout: float, ca_file: str = "") -> httpx.Client:
    """httpx clients are thread-safe and pool connections, so one per timeout serves every model call."""
    return httpx.Client(
        timeout=timeout,
        verify=ssl.create_default_context(cafile=ca_file) if ca_file else True,
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20, keepalive_expiry=60),
    )


def http_client(settings: Settings) -> httpx.Client:
    """The shared HTTP client for model calls, with this configuration's timeout. Tests replace this function."""
    return shared_client(settings.ai_timeout_seconds, settings.ssl_cert_file)


@lru_cache(maxsize=4)
def shared_async_client(timeout: float, ca_file: str = "") -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=timeout,
        verify=ssl.create_default_context(cafile=ca_file) if ca_file else True,
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20, keepalive_expiry=60),
    )


def async_http_client(settings: Settings) -> httpx.AsyncClient:
    """The async model transport; tests may replace it with MockTransport."""
    return shared_async_client(settings.ai_timeout_seconds, settings.ssl_cert_file)


def chat_model(
    settings: Settings,
    *,
    small: bool = False,
    temperature: float = 0,
    model: str = "",
    reasoning_effort: str | None = None,
    role: str = "legacy",
) -> BaseChatModel:
    """The large model, or with `small` the faster one for buddy lines and safety checks. `model` names another
    one outright; `reasoning_effort` (low, medium, high) trades a reasoning model's accuracy for speed.
    """
    info = legacy_model_info(settings, small=small, model=model, reasoning_effort=reasoning_effort, role=role)
    return init_chat_model(
        model=info["model"],
        model_provider="openai",
        base_url=settings.openai_base_url,
        api_key=settings.openai_api_key.get_secret_value() if settings.openai_api_key else "",
        temperature=temperature,
        max_tokens=MAX_TOKENS,
        max_retries=1,
        http_client=httpx.Client(
            transport=_CountingTransport(http_client(settings), role), timeout=settings.ai_timeout_seconds
        ),
        http_async_client=httpx.AsyncClient(
            transport=_AsyncCountingTransport(async_http_client(settings), role),
            timeout=settings.ai_timeout_seconds,
        ),
        reasoning_effort=info["reasoning_effort"],
    )


def legacy_model_info(
    settings: Settings,
    *,
    small: bool = False,
    model: str = "",
    reasoning_effort: str | None = None,
    role: str = "legacy",
) -> dict[str, Any]:
    """The same non-secret fallback resolver used by legacy helper invocation."""
    resolved_model = model or (settings.openai_small_model if small else "") or settings.openai_model
    host = urlsplit(settings.openai_base_url).hostname or ""
    if role in {"planner", "review"} and reasoning_effort is None:
        configured = settings.ai_helper_reasoning_effort
        if configured != "auto":
            reasoning_effort = configured
        elif host.endswith(".nebius.com") and resolved_model.startswith("deepseek-ai/DeepSeek-V4"):
            reasoning_effort = "none"
    return {
        "role": role,
        "provider_group": "legacy",
        "provider_host": host,
        "model": resolved_model,
        "api_mode": "chat_completions",
        "reasoning_effort": reasoning_effort,
        "max_output_tokens": MAX_TOKENS,
        "timeout_seconds": settings.ai_timeout_seconds,
        "max_retries": 1,
    }


def effective_models(settings: Settings) -> list[dict[str, Any]]:
    """Resolve every active role for the admin view without exposing provider keys."""
    rows = [
        {
            **role_model_info(settings, role),
            "active": settings.ai_mode == "openai"
            and (role != "parent_risk" and (role != "habit_generation" or settings.habit_generation_enabled)),
            "type": "text",
        }
        for role in ("coach", "habit_generation", "parent_risk", "output_safety")
    ]
    for role in ("planner", "review", "onboarding", "buddy", "child_screen"):
        rows.append(
            {
                **legacy_model_info(settings, role=role, small=role in {"buddy", "child_screen"}),
                "active": settings.ai_mode == "openai",
                "type": "text",
            }
        )
    rows.extend(
        [
            {
                "role": "embedding",
                "provider_group": "planning_openai",
                "provider_host": urlsplit(settings.planning_openai_base_url).hostname or "",
                "model": settings.openai_embedding_model,
                "api_mode": "embeddings",
                "reasoning_effort": None,
                "max_output_tokens": 0,
                "timeout_seconds": settings.embedding_timeout_seconds,
                "max_retries": settings.embedding_max_retries,
                "dimensions": settings.openai_embedding_dimensions,
                "active": settings.ai_mode == "openai" and settings.retrieval_mode == "pinecone",
                "type": "embedding",
            },
            {
                "role": "pinecone",
                "provider_group": "pinecone",
                "provider_host": "api.pinecone.io",
                "model": "documents-search",
                "api_mode": "documents_search",
                "reasoning_effort": None,
                "max_output_tokens": 0,
                "timeout_seconds": settings.pinecone_timeout_seconds,
                "max_retries": 0,
                "active": settings.ai_mode == "openai" and settings.retrieval_mode == "pinecone",
                "type": "search",
            },
        ]
    )
    return rows


def role_model_info(settings: Settings, role: ModelRole) -> dict[str, Any]:
    """Effective non-secret routing for one role, safe for diagnostic summaries."""
    if role not in {"coach", "habit_generation", "parent_risk", "output_safety"}:
        raise ValueError("Unknown model role")
    planning = role == "habit_generation" or (role == "coach" and settings.coach_provider == "planning")
    if role == "coach":
        model = settings.coach_model if planning else settings.openai_model
        mode = settings.coach_api_mode if planning else "chat_completions"
        effort = settings.coach_reasoning_effort
        tokens, timeout, retries = (
            settings.coach_max_output_tokens,
            settings.coach_request_timeout_seconds,
            settings.coach_max_retries,
        )
    elif role == "habit_generation":
        model, mode, effort = (
            settings.habit_generation_model,
            settings.habit_generation_api_mode,
            settings.habit_generation_reasoning_effort,
        )
        tokens, timeout, retries = (
            settings.habit_generation_token_floor,
            settings.habit_generation_timeout_seconds,
            settings.habit_generation_max_retries,
        )
    else:
        override = settings.parent_risk_model if role == "parent_risk" else settings.output_safety_model
        model = (
            override or settings.openai_safety_model or settings.openai_small_model or settings.openai_model
        )
        mode, effort = "chat_completions", "low"
        tokens, timeout, retries = MAX_TOKENS, settings.ai_timeout_seconds, 1
    base_url = settings.planning_openai_base_url if planning else settings.openai_base_url
    return {
        "role": role,
        "provider_group": "planning_openai" if planning else "legacy",
        "provider_host": urlsplit(base_url).hostname or "",
        "model": model,
        "api_mode": mode,
        "reasoning_effort": effort,
        "max_output_tokens": tokens,
        "timeout_seconds": timeout,
        "max_retries": retries,
    }


def role_chat_model(
    settings: Settings,
    *,
    role: ModelRole,
    timeout_seconds: float | None = None,
    max_output_tokens: int | None = None,
) -> BaseChatModel:
    """Constructs a role-specific client without changing legacy feature defaults.

    A remaining-deadline timeout bounds each HTTP attempt, not the entire SDK
    retry sequence. Callers still own their operation deadline and revision cap.
    """
    if settings.ai_mode != "openai":
        raise ValueError("Remote model roles require AI_MODE=openai")
    info = role_model_info(settings, role)
    planning = info["provider_group"] == "planning_openai"
    if planning:
        settings.require_planning_provider()
        key = settings.planning_openai_api_key
        base_url = settings.planning_openai_base_url
    else:
        key, base_url = settings.openai_api_key, settings.openai_base_url
    if not key or not key.get_secret_value().strip() or not base_url or not info["model"].strip():
        raise ValueError("Model role requires its own configured provider credentials, base URL and model")
    timeout = info["timeout_seconds"]
    if timeout_seconds is not None:
        if timeout_seconds <= 0:
            raise TimeoutError("The model operation deadline has elapsed")
        timeout = min(timeout, timeout_seconds)
    tokens = info["max_output_tokens"] if max_output_tokens is None else max_output_tokens
    if not 1 <= tokens <= 16000:
        raise ValueError("Model output token limit must be between 1 and 16000")
    options: dict[str, Any] = {
        "model": info["model"],
        "model_provider": "openai",
        "api_key": key.get_secret_value(),
        "base_url": base_url,
        "max_tokens": tokens,
        "max_retries": info["max_retries"],
        "timeout": timeout,
        "http_client": httpx.Client(
            transport=_CountingTransport(http_client(settings), role), timeout=timeout
        ),
        "http_async_client": httpx.AsyncClient(
            transport=_AsyncCountingTransport(async_http_client(settings), role), timeout=timeout
        ),
    }
    if info["api_mode"] == "responses":
        options.update(use_responses_api=True, reasoning={"effort": info["reasoning_effort"]}, store=False)
    else:
        options.update(use_responses_api=False, temperature=0, reasoning_effort=info["reasoning_effort"])
    return init_chat_model(**options)


def embedding_model(settings: Settings) -> OpenAIEmbeddings:
    """Imported OpenAI query space; local/fake modes cannot create a live client."""
    if settings.ai_mode != "openai" or settings.retrieval_mode != "pinecone":
        raise ValueError("Live embeddings require AI_MODE=openai and RETRIEVAL_MODE=pinecone")
    settings.validate_planning_features()
    key = settings.planning_openai_api_key
    assert key is not None  # validated above; never substitute the legacy key
    return OpenAIEmbeddings(
        model=settings.openai_embedding_model,
        dimensions=settings.openai_embedding_dimensions,
        api_key=key,
        base_url=settings.planning_openai_base_url,
        max_retries=settings.embedding_max_retries,
        timeout=settings.embedding_timeout_seconds,
        http_client=httpx.Client(transport=_CountingTransport(http_client(settings), "embedding")),
        http_async_client=httpx.AsyncClient(
            transport=_AsyncCountingTransport(async_http_client(settings), "embedding")
        ),
    )

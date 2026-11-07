"""Content-free accounting around real provider dispatches, including SDK retries.

Only allowlisted routing/usage fields survive extraction. Bodies and vectors are
never passed to the accounting store. Dispatch reservations commit before HTTP.
"""

import asyncio
import json
import re
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from threading import Lock, get_ident
from time import monotonic
from typing import Any
from uuid import UUID, uuid4

import httpx
from fastapi import HTTPException

from habitquest_backend.config import Settings


class DispatchUnavailable(ValueError):
    """A denied paid dispatch can use existing safe model-failure fallbacks."""


@dataclass
class UsageScope:
    settings: Settings
    operation_id: UUID
    invocations: dict[str, UUID] = field(default_factory=dict)
    lock: Lock = field(default_factory=Lock)
    dispatches: int = 0


_scope: ContextVar[UsageScope | None] = ContextVar("tokenomics_usage", default=None)


@contextmanager
def track(settings: Settings, operation_id: UUID) -> Iterator[UsageScope]:
    """Propagates through copy_context without sharing state between operations."""
    scope = UsageScope(settings, operation_id)
    token = _scope.set(scope)
    try:
        yield scope
    finally:
        _scope.reset(token)


def active() -> bool:
    return _scope.get() is not None


def safe_id(value: Any) -> str | None:
    return value if isinstance(value, str) and re.fullmatch(r"[\w./:@-]{1,200}", value) else None


def count(value: Any) -> int | None:
    return value if type(value) is int and 0 <= value <= 10**12 else None


def start(role: str, request: httpx.Request, *, search: bool = False) -> dict | None:
    """Durably records the bounded, sanitized dispatch before sending provider work."""
    scope = _scope.get()
    if scope is None:
        return None
    from habitquest_backend import tokenomics

    payload = json.loads(request.content)
    retry = request.headers.get("x-stainless-retry-count", "0")
    try:
        task = asyncio.current_task()
    except RuntimeError:
        task = None
    execution = f"{role}:{get_ident()}:{id(task)}"
    with scope.lock:
        if retry == "0" or execution not in scope.invocations:
            scope.invocations[execution] = uuid4()
        invocation = scope.invocations[execution]
    model = "documents-search" if search else safe_id(payload.get("model"))
    record = {
        "id": uuid4(),
        "invocation_id": invocation,
        "role": role,
        "provider": "api.pinecone.io" if search else request.url.host,
        "model": model or "unknown",
        "api_mode": "documents_search"
        if search
        else "embeddings"
        if role == "embedding"
        else "responses"
        if request.url.path.endswith("/responses")
        else "chat_completions",
        "status": "dispatched",
        "service_tier": safe_id(payload.get("service_tier")) or "standard",
        "input_token_bound": None if search else len(request.content) + 4096,
        "output_token_bound": 0
        if role == "embedding"
        else count(
            payload.get("max_output_tokens", payload.get("max_completion_tokens", payload.get("max_tokens")))
        ),
    }
    try:
        tokenomics.record_attempt(scope.settings, scope.operation_id, record)
    except HTTPException as exc:
        if exc.status_code in {429, 503}:
            raise DispatchUnavailable(
                "AI provider dispatch is unavailable under the current budget policy"
            ) from exc
        raise
    with scope.lock:
        scope.dispatches += 1
    return {"scope": scope, "record": record, "started": monotonic()}


def finish(ticket: dict | None, response: httpx.Response | None, error: BaseException | None = None) -> None:
    """Retains unknown usage on failure; a later successful retry is a separate row."""
    if ticket is None:
        return
    from habitquest_backend import tokenomics

    record = dict(ticket["record"])
    record.update(
        duration_ms=(monotonic() - ticket["started"]) * 1000,
        status="completed" if response is not None and response.is_success else "failed",
        error_code=type(error).__name__
        if error
        else f"http_{response.status_code}"
        if response is not None and not response.is_success
        else None,
    )
    if response is not None:
        record["request_id"] = safe_id(response.headers.get("x-request-id"))
        try:
            payload = response.json()
        except (ValueError, UnicodeDecodeError):
            payload = {}
        if isinstance(payload, dict):
            record["returned_model"] = safe_id(payload.get("model"))
            usage = payload.get("usage")
            if isinstance(usage, dict):
                record.update(extract_usage(usage, record["role"]))
    scope = ticket["scope"]
    tokenomics.record_attempt(scope.settings, scope.operation_id, record)


def extract_usage(usage: dict, role: str) -> dict:
    """Normalize actual provider counters without turning missing usage into zero."""
    if role == "pinecone":
        ru = usage.get("read_units")
        return {
            "read_units": ru
            if isinstance(ru, (int, float)) and not isinstance(ru, bool) and 0 <= ru <= 10**12
            else None,
            "egress_bytes": count(usage.get("egress_bytes")),
            "read_units_precision": "rounded_up",
        }
    inputs = count(usage.get("input_tokens", usage.get("prompt_tokens")))
    outputs = 0 if role == "embedding" else count(usage.get("output_tokens", usage.get("completion_tokens")))
    input_details = usage.get("input_tokens_details", usage.get("prompt_tokens_details"))
    output_details = usage.get("output_tokens_details", usage.get("completion_tokens_details"))
    return {
        "input_tokens": inputs,
        "output_tokens": outputs,
        "cached_input_tokens": count(input_details.get("cached_tokens"))
        if isinstance(input_details, dict)
        else None,
        "cache_write_tokens": count(usage.get("cache_creation_input_tokens")),
        "reasoning_tokens": count(output_details.get("reasoning_tokens"))
        if isinstance(output_details, dict)
        else None,
    }

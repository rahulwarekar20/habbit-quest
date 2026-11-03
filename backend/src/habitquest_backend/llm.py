"""The chat model: any OpenAI-compatible endpoint (Nebius Token Factory) through LangChain."""

from functools import lru_cache

import httpx
from langchain.chat_models import init_chat_model
from langchain_core.language_models import BaseChatModel

from habitquest_backend.config import Settings

# Reasoning models spend part of this budget on hidden reasoning, so it must leave room for the answer.
MAX_TOKENS = 4000


@lru_cache(maxsize=4)
def shared_client(timeout: float) -> httpx.Client:
    """httpx clients are thread-safe and pool connections, so one per timeout serves every model call."""
    return httpx.Client(timeout=timeout)


def http_client(settings: Settings) -> httpx.Client:
    """The shared HTTP client for model calls, with this configuration's timeout. Tests replace this function."""
    return shared_client(settings.ai_timeout_seconds)


def chat_model(
    settings: Settings,
    *,
    small: bool = False,
    temperature: float = 0,
    model: str = "",
    reasoning_effort: str | None = None,
) -> BaseChatModel:
    """The large model, or with `small` the faster one for buddy lines and safety checks. `model` names another
    one outright; `reasoning_effort` (low, medium, high) trades a reasoning model's accuracy for speed.
    """
    return init_chat_model(
        model=model or (settings.openai_small_model if small else "") or settings.openai_model,
        model_provider="openai",
        base_url=settings.openai_base_url,
        api_key=settings.openai_api_key.get_secret_value() if settings.openai_api_key else "",
        temperature=temperature,
        max_tokens=MAX_TOKENS,
        max_retries=1,
        http_client=http_client(settings),
        reasoning_effort=reasoning_effort,
    )

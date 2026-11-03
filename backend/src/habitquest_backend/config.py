"""Every setting the API reads, from environment variables or `backend/.env` (see `.env.example`).

`Settings` validates combinations at startup, so a half-configured feature fails fast instead of at the first
request: AI_MODE=openai needs a base URL, model and key; TRACE_COACH needs a LangSmith key; DEV_LOGIN needs a JWT
secret and a 12+ character password; CREW_ROLES entries must read role:size:effort.
"""

import re
from functools import cached_property
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from habitquest_backend.limits import RateLimiter

CREW_ROLE = re.compile(
    r"^(triage|research|progress|planner|fit|safety):(large|small|safety):(low|medium|high)$"
)


class Settings(BaseSettings):
    """Every setting, read from environment variables or `.env`; see the module docstring for the checks at startup."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://hq_dev@127.0.0.1:55432/habitquest"
    # Our own HS256 access tokens; their `sub` is hq.users.id (or the child id for kid tokens).
    jwt_secret: SecretStr | None = None
    jwt_issuer: str = "http://127.0.0.1:8000"
    jwt_audience: str = "authenticated"
    # Google sign-in: the OAuth web client id the frontend's sign-in button uses.
    google_client_id: str = ""
    # Browser origins allowed to call the API, comma-separated (the frontend's dev server by default).
    cors_origins: str = "http://localhost:5180"
    # Every AI feature: `fake` is a deterministic stand-in (tests, local use); `openai` calls any
    # OpenAI-compatible chat endpoint, e.g. Nebius. The small model (optional) serves buddy lines and safety
    # checks; without one, they use `openai_model`.
    ai_mode: Literal["fake", "openai"] = "fake"
    openai_base_url: str = ""
    openai_model: str = ""
    openai_small_model: str = ""
    # Optional policy model for the crew's safety reviewer, e.g. openai/gpt-oss-safeguard-20b; else the small one.
    openai_safety_model: str = ""
    openai_api_key: SecretStr | None = None
    # The habit coach: `agent` is one model calling tools in a loop; `crew` is a fixed workflow of small agents
    # (triage, research and progress side by side, planner, fit and safety review), see crew.py.
    coach_engine: Literal["agent", "crew"] = "agent"
    # Per-agent overrides of crew.ROLES as role:size:effort, comma-separated, e.g. "planner:large:low".
    crew_roles: str = ""
    ai_timeout_seconds: float = Field(default=30, gt=0, le=60)
    # The coach's whole turn (several model calls), and model-backed requests per family per day.
    coach_timeout_seconds: float = Field(default=50, gt=0, le=120)
    ai_daily_limit: int = Field(default=100, gt=0)
    # Redacted coach traces in LangSmith. `trace_sample` is the share of ordinary turns that keep their text.
    trace_coach: bool = False
    trace_sample: float = Field(default=0.1, ge=0, le=1)
    langsmith_api_key: SecretStr | None = None
    langsmith_endpoint: str = "https://api.smith.langchain.com"
    langsmith_project: str = "habitquest"
    # Attempts per minute: Google sign-in per address, and PIN checks per signed-in person.
    sign_in_limit: int = Field(default=20, gt=0)
    pin_limit: int = Field(default=10, gt=0)
    # Development login: POST /v1/auth/token (and /docs Authorize) issues tokens for test parents.
    dev_login: bool = False
    dev_login_password: SecretStr | None = None

    @model_validator(mode="after")
    def modes_configured(self) -> "Settings":
        for entry in filter(None, (e.strip() for e in self.crew_roles.split(","))):
            if not CREW_ROLE.match(entry):
                raise ValueError(f"CREW_ROLES: {entry!r} is not role:size:effort")
        if self.ai_mode == "openai" and not (
            self.openai_base_url and self.openai_model and self.openai_api_key
        ):
            raise ValueError("AI_MODE=openai requires OPENAI_BASE_URL, OPENAI_MODEL and OPENAI_API_KEY")
        if self.trace_coach and not self.langsmith_api_key:
            raise ValueError("TRACE_COACH requires LANGSMITH_API_KEY")
        if self.dev_login:
            password = self.dev_login_password.get_secret_value() if self.dev_login_password else ""
            if len(password) < 12 or not self.jwt_secret:
                raise ValueError("DEV_LOGIN requires JWT_SECRET and a DEV_LOGIN_PASSWORD of 12+ characters")
        return self

    @cached_property
    def sign_in_attempts(self) -> RateLimiter:
        return RateLimiter(self.sign_in_limit)

    @cached_property
    def pin_attempts(self) -> RateLimiter:
        return RateLimiter(self.pin_limit)

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

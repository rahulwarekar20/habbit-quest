"""Every setting the API reads, from environment variables or `backend/.env` (see `.env.example`).

`Settings` validates combinations at startup, so a half-configured feature fails fast instead of at the first
request: AI_MODE=openai needs a base URL, model and key; TRACE_COACH needs a LangSmith key; DEV_LOGIN needs a JWT
secret and a 12+ character password; CREW_ROLES entries must read role:size:effort.
"""

import re
from functools import cached_property
from ipaddress import IPv4Network, IPv6Network
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from habitquest_backend.limits import RateLimiter

CREW_ROLE = re.compile(
    r"^(triage|research|progress|planner|fit|safety):(large|small|safety):(low|medium|high)$"
)


class Settings(BaseSettings):
    """Every setting, read from environment variables or `.env`; see the module docstring for the checks at startup."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    database_url: str = Field(default="postgresql://hq_dev@127.0.0.1:55432/habitquest", repr=False)
    # Our own HS256 access tokens; their `sub` is hq.users.id (or the child id for kid tokens).
    jwt_secret: SecretStr | None = None
    jwt_issuer: str = "http://127.0.0.1:8000"
    jwt_audience: str = "authenticated"
    # Google sign-in: the OAuth web client id the frontend's sign-in button uses.
    google_client_id: str = ""
    # Browser origins allowed to call the API, comma-separated (the frontend's dev server by default).
    cors_origins: str = "http://localhost:5180"
    # JSON list of ALB subnet CIDRs; empty trusts only the socket peer. Uvicorn
    # must not rewrite request.client; see limits.client_address and .env.example.
    alb_trusted_proxy_cidrs: list[IPv4Network | IPv6Network] = Field(default_factory=list)
    # Roll back catalog writes while retaining selection-aware reads and original buddy choices.
    buddy_catalog_enabled: bool = True
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
    coach_engine: Literal["agent", "crew", "refined"] = "agent"
    # Per-agent overrides of crew.ROLES as role:size:effort, comma-separated, e.g. "planner:large:low".
    crew_roles: str = ""
    ai_timeout_seconds: float = Field(default=30, gt=0, le=60)
    # Short planner/review reports must leave output room for the report itself.
    # auto disables thinking only for the known Nebius DeepSeek V4 family.
    ai_helper_reasoning_effort: Literal["auto", "none", "low", "medium", "high"] = "auto"
    # The coach's whole turn (several model calls), and model-backed requests per family per day.
    coach_timeout_seconds: float = Field(default=50, gt=0, le=120)
    ai_daily_limit: int = Field(default=100, gt=0)
    # Refined generation can move to the imported OpenAI provider independently
    # of risk, output Safety, reports and existing child-text screening.
    coach_provider: Literal["legacy", "planning"] = "legacy"
    planning_openai_base_url: str = "https://api.openai.com/v1"
    planning_openai_api_key: SecretStr | None = Field(default=None, repr=False)
    coach_model: str = "gpt-6-luna"
    coach_api_mode: Literal["responses", "chat_completions"] = "responses"
    coach_reasoning_effort: Literal["low", "medium", "high"] = "low"
    coach_max_output_tokens: int = Field(default=1600, ge=256, le=16000)
    coach_request_timeout_seconds: float = Field(default=30, gt=0, le=120)
    coach_max_retries: int = Field(default=1, ge=0, le=2)
    parent_risk_model: str = ""
    output_safety_model: str = ""
    coach_context_ttl_seconds: float = Field(default=30, ge=0, le=300)
    coach_context_max_entries: int = Field(default=128, ge=1, le=2048)

    # A separate explicit operation; changing it cannot change the Coach route.
    habit_generation_enabled: bool = False
    habit_generation_model: str = "gpt-6-luna"
    habit_generation_api_mode: Literal["responses", "chat_completions"] = "responses"
    habit_generation_reasoning_effort: Literal["low", "medium", "high"] = "low"
    habit_generation_timeout_seconds: float = Field(default=45, gt=0, le=120)
    habit_generation_max_retries: int = Field(default=0, ge=0, le=2)
    habit_generation_token_floor: int = Field(default=2800, ge=1600, le=16000)

    # Reserved only to reject accidental raw-payload capture; not implemented.
    habit_generation_eval_capture: bool = False

    # Existing Pinecone Documents release. Local/fixture modes never enable its
    # clients; a disabled feature does not require credentials or a local file.
    retrieval_mode: Literal["disabled", "local", "fixture", "pinecone"] = "local"
    openai_embedding_model: str = "text-embedding-3-small"
    openai_embedding_dimensions: int = Field(default=512, gt=0)
    embedding_timeout_seconds: float = Field(default=15, gt=0, le=60)
    embedding_max_retries: int = Field(default=0, ge=0, le=2)
    pinecone_api_key: SecretStr | None = Field(default=None, repr=False)
    pinecone_host: str = ""
    pinecone_index_name: str = "hq-habits-v1"
    pinecone_namespace: str = "habits-0-1-0"
    pinecone_api_version: str = "2026-07"
    pinecone_metric: str = "cosine"
    pinecone_vector_field: str = "embedding"
    pinecone_timeout_seconds: float = Field(default=15, gt=0, le=60)
    catalog_version: str = "0.1.0"
    catalog_snapshot_pointer: str = ""
    # Empty means system trust; never infer verify=False from an empty path.
    ssl_cert_file: str = ""
    planning_budget_enabled: bool = True
    planning_test_budget_usd: float = Field(default=1, gt=0, le=100)
    planning_input_rate_per_million: float = Field(default=0.10, ge=0)
    planning_output_rate_per_million: float = Field(default=0.50, ge=0)
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
    dev_login_password: SecretStr | None = Field(default=None, repr=False)
    # Separate operator identity; never inherits a caregiver credential or signing key.
    admin_enabled: bool = False
    admin_username: str = Field(default="admin", min_length=1, max_length=80)
    admin_password: SecretStr | None = Field(default=None, repr=False)
    admin_jwt_secret: SecretStr | None = Field(default=None, repr=False)
    admin_token_ttl_minutes: int = Field(default=30, ge=1, le=60)
    admin_sign_in_limit: int = Field(default=5, ge=1, le=100)
    admin_auth_version: int = Field(default=1, ge=1)

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
        if self.admin_enabled:
            password = self.admin_password.get_secret_value() if self.admin_password else ""
            secret = self.admin_jwt_secret.get_secret_value() if self.admin_jwt_secret else ""
            family_secret = self.jwt_secret.get_secret_value() if self.jwt_secret else ""
            if len(password) < 32 or len(secret) < 32 or secret == family_secret:
                raise ValueError(
                    "ADMIN_ENABLED requires a 32+ character ADMIN_PASSWORD and independent ADMIN_JWT_SECRET"
                )
        self.validate_planning_features()
        return self

    def require_planning_provider(self) -> None:
        """Checks the imported provider without falling back to legacy secrets."""
        parsed = urlsplit(self.planning_openai_base_url)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("PLANNING_OPENAI_BASE_URL must be an HTTPS API URL without credentials or query")
        if not self.planning_openai_api_key or not self.planning_openai_api_key.get_secret_value().strip():
            raise ValueError("Imported OpenAI calls require PLANNING_OPENAI_API_KEY")

    def validate_planning_features(self) -> None:
        """Rejects enabled, incompatible routing while leaving local use independent."""
        if self.habit_generation_eval_capture:
            raise ValueError("HABIT_GENERATION_EVAL_CAPTURE is not implemented; raw capture must stay off")
        if self.retrieval_mode == "pinecone":
            if self.ai_mode != "openai":
                raise ValueError("RETRIEVAL_MODE=pinecone requires AI_MODE=openai; fixture use is local")
            self.require_planning_provider()
            if not self.pinecone_api_key or not self.pinecone_api_key.get_secret_value().strip():
                raise ValueError("RETRIEVAL_MODE=pinecone requires PINECONE_API_KEY")
            if not re.fullmatch(r"[a-z0-9-]+\.svc\.[a-z0-9.-]+\.pinecone\.io", self.pinecone_host):
                raise ValueError("PINECONE_HOST must be the verified data-plane hostname without a scheme")
            if self.catalog_snapshot_pointer.strip():
                raise ValueError("CATALOG_SNAPSHOT_POINTER overrides are unsupported; use the pinned package")
            expected = (
                "text-embedding-3-small",
                512,
                "hq-habits-v1",
                "habits-0-1-0",
                "2026-07",
                "cosine",
                "embedding",
                "0.1.0",
            )
            actual = (
                self.openai_embedding_model,
                self.openai_embedding_dimensions,
                self.pinecone_index_name,
                self.pinecone_namespace,
                self.pinecone_api_version,
                self.pinecone_metric,
                self.pinecone_vector_field,
                self.catalog_version,
            )
            if actual != expected:
                raise ValueError("Pinecone settings differ from the verified embedding/catalog release")
        if self.ai_mode == "openai":
            if self.coach_provider == "planning" and self.coach_engine != "refined":
                raise ValueError("COACH_PROVIDER=planning requires COACH_ENGINE=refined")
            if self.coach_engine == "refined" and self.coach_provider == "planning":
                self.require_planning_provider()
                if not self.coach_model.strip():
                    raise ValueError("The imported Coach requires COACH_MODEL")
            if self.habit_generation_enabled:
                self.require_planning_provider()
                if not self.habit_generation_model.strip():
                    raise ValueError("Habit generation requires HABIT_GENERATION_MODEL")

    @property
    def catalog_pointer_path(self) -> Path:
        """Resolves a configured release pointer relative to the backend root."""
        root = Path(__file__).resolve().parents[2]
        return (root / self.catalog_snapshot_pointer).resolve()

    @cached_property
    def sign_in_attempts(self) -> RateLimiter:
        return RateLimiter(self.sign_in_limit)

    @cached_property
    def pin_attempts(self) -> RateLimiter:
        return RateLimiter(self.pin_limit)

    @cached_property
    def admin_sign_in_attempts(self) -> RateLimiter:
        return RateLimiter(self.admin_sign_in_limit)

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

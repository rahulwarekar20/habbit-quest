"""Separate operator authentication and sanitized Tokenomics administration.

An admin is never a family user. Its bearer token uses a separate secret, audience,
issuer, role and revocation version, and is intended for an in-memory browser session.
"""

import hmac
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Literal
from urllib.parse import urlsplit

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import (
    Field,
    SecretStr,
    StrictBool,
    StrictInt,
    ValidationError,
    field_validator,
    model_validator,
)

from habitquest_backend import llm, tokenomics
from habitquest_backend.accounts import StrictModel
from habitquest_backend.config import Settings
from habitquest_backend.limits import client_address

ADMIN_AUDIENCE = "habitquest-admin"
ADMIN_ROLE = "admin"
ACTIVITIES = {"coach", "habit_batch", "planner", "review", "onboarding", "buddy", "child_screen"}
Rate = Annotated[Decimal, Field(ge=0, le=1_000_000, decimal_places=12)]


class Login(StrictModel):
    username: str = Field(min_length=1, max_length=80)
    password: SecretStr


class PolicyUpdate(StrictModel):
    revision: StrictInt = Field(ge=1)
    daily_credits: StrictInt | None = Field(default=None, ge=1, le=1_000_000)
    enforce_budgets: StrictBool | None = None
    show_costs: StrictBool | None = None
    reference_usd_per_credit: Decimal | None = Field(default=None, gt=0, le=100, decimal_places=12)
    operator_cap_usd: Decimal | None = Field(default=None, gt=0, le=1_000_000, decimal_places=12)
    weights: dict[str, Annotated[StrictInt, Field(ge=0, le=1000)]] | None = None

    @field_validator("weights")
    @classmethod
    def known_activities(cls, value):
        if value is not None and (not value or set(value) - ACTIVITIES):
            raise ValueError("Use known generation activities")
        return value

    @model_validator(mode="after")
    def changes_present(self):
        changes = self.model_dump(exclude_unset=True, exclude={"revision"})
        if not changes or any(value is None for value in changes.values()):
            raise ValueError("Supply at least one non-null configuration change")
        return self


class PriceInput(StrictModel):
    provider: Literal["OpenAI", "Nebius", "Pinecone"]
    model: str = Field(min_length=1, max_length=160, pattern=r"^[A-Za-z0-9._/:-]+$")
    api_mode: Literal["responses", "chat_completions", "embeddings", "documents_search"]
    kind: Literal["chat", "embedding", "search"]
    region: str = Field(default="", max_length=80, pattern=r"^[A-Za-z0-9_-]*$")
    service_tier: str = Field(default="standard", min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    context_band: str = Field(default="short", min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    input_rate: Rate | None = None
    cached_input_rate: Rate | None = None
    cache_write_rate: Rate | None = None
    output_rate: Rate | None = None
    read_unit_rate: Rate | None = None
    egress_rate: Rate | None = None
    read_units_bound: Rate | None = None
    egress_bytes_bound: StrictInt | None = Field(default=None, ge=0, le=1_000_000_000)
    source_url: str = Field(min_length=1, max_length=500)
    verified_at: datetime | None = None
    effective_at: datetime | None = None
    status: Literal["verified", "manual", "planning"] = "manual"

    @field_validator("source_url")
    @classmethod
    def public_source(cls, value):
        parsed = urlsplit(value)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Use an HTTPS pricing source without credentials, query or fragment")
        return value

    @field_validator("verified_at", "effective_at")
    @classmethod
    def timezone_required(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError("Use a timestamp with its timezone")
        return value

    @model_validator(mode="after")
    def rates_present(self):
        required = {
            "chat": (self.input_rate, self.output_rate),
            "embedding": (self.input_rate,),
            "search": (self.read_unit_rate, self.egress_rate),
        }[self.kind]
        if any(value is None for value in required):
            raise ValueError("Supply the rates required for this operation kind")
        if self.kind == "embedding" and self.api_mode != "embeddings":
            raise ValueError("Embedding rates require the embeddings API mode")
        if self.kind == "search" and self.api_mode != "documents_search":
            raise ValueError("Search rates require the documents_search API mode")
        if self.kind == "chat" and self.api_mode not in {"responses", "chat_completions"}:
            raise ValueError("Chat rates require a chat API mode")
        if self.status == "verified" and self.verified_at is None:
            raise ValueError("Verified rates require a verification timestamp")
        return self


def enabled(settings: Settings) -> None:
    """Disabled or incompletely configured admin access is unavailable, never a family-login fallback."""
    if not settings.admin_enabled or not settings.admin_password or not settings.admin_jwt_secret:
        raise HTTPException(404, "Admin access is unavailable")


def admin_identity(settings: Settings):
    bearer = HTTPBearer(auto_error=False)

    def identity(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> dict:
        enabled(settings)
        if credentials is None:
            raise HTTPException(401, "Admin authentication required", headers={"WWW-Authenticate": "Bearer"})
        try:
            assert settings.admin_jwt_secret is not None
            claims = jwt.decode(
                credentials.credentials,
                settings.admin_jwt_secret.get_secret_value(),
                algorithms=["HS256"],
                issuer=settings.jwt_issuer + "/admin",
                audience=ADMIN_AUDIENCE,
                options={"require": ["sub", "iat", "exp", "iss", "aud", "role", "auth_version"]},
            )
            if (
                claims["role"] != ADMIN_ROLE
                or claims["sub"] != settings.admin_username
                or type(claims["auth_version"]) is not int
                or claims["auth_version"] != settings.admin_auth_version
            ):
                raise ValueError("Incorrect operator claims")
        except (jwt.PyJWTError, ValueError) as exc:
            raise HTTPException(401, "Invalid admin session", headers={"WWW-Authenticate": "Bearer"}) from exc
        return {"username": claims["sub"], "role": ADMIN_ROLE, "expires_at": claims["exp"]}

    return identity


def router(settings: Settings) -> APIRouter:
    api = APIRouter(prefix="/v1/admin", tags=["Admin"])
    Operator = Annotated[dict, Depends(admin_identity(settings))]

    @api.post("/auth/login", summary="Sign in to the admin console")
    async def login(request: Request) -> dict:
        """Exchanges separate operator credentials for a short-lived admin token without creating a family user."""
        enabled(settings)
        settings.admin_sign_in_attempts.check(client_address(request, settings.alb_trusted_proxy_cidrs))
        raw = await request.body()
        if len(raw) > 4096:
            raise HTTPException(413, "Admin sign-in request is too large")
        try:
            body = Login.model_validate(json.loads(raw))
        except (ValueError, ValidationError) as exc:
            # Framework validation normally echoes invalid inputs; a password must never be echoed.
            raise HTTPException(422, "Provide an admin username and password") from exc
        assert settings.admin_password is not None and settings.admin_jwt_secret is not None
        matches = hmac.compare_digest(
            body.username.encode(), settings.admin_username.encode()
        ) & hmac.compare_digest(
            body.password.get_secret_value().encode(), settings.admin_password.get_secret_value().encode()
        )
        if not matches:
            raise HTTPException(401, "Incorrect username or password", headers={"WWW-Authenticate": "Bearer"})
        now = datetime.now(UTC)
        minutes = settings.admin_token_ttl_minutes
        token = jwt.encode(
            {
                "sub": settings.admin_username,
                "iat": now,
                "exp": now + timedelta(minutes=minutes),
                "iss": settings.jwt_issuer + "/admin",
                "aud": ADMIN_AUDIENCE,
                "role": ADMIN_ROLE,
                "auth_version": settings.admin_auth_version,
            },
            settings.admin_jwt_secret.get_secret_value(),
            algorithm="HS256",
        )
        return {
            "access_token": token,
            "token_type": "bearer",
            "expires_in": minutes * 60,
            "username": settings.admin_username,
        }

    @api.get("/me", summary="Read the admin session")
    def session(operator: Operator) -> dict:
        """Returns only operator identity and token expiry, independent of all caregiver and child sessions."""
        return operator

    @api.get("/tokenomics/config", summary="Read Tokenomics configuration")
    def configuration(_: Operator) -> dict:
        """Reads the versioned allowance and operator policy without disclosing any provider or login secrets."""
        return tokenomics.get_policy(settings)

    @api.patch("/tokenomics/config", summary="Update Tokenomics configuration")
    def update_configuration(body: PolicyUpdate, operator: Operator) -> dict:
        """Updates a revision-checked operator policy, preserving usage and an immutable configuration audit."""
        return tokenomics.update_policy(
            settings,
            body.revision,
            body.model_dump(exclude_unset=True, exclude={"revision"}),
            actor=operator["username"],
        )

    @api.get("/tokenomics/prices", summary="Read model and retrieval prices")
    def prices(_: Operator) -> dict:
        """Lists versioned model and retrieval tariffs with their source, validity and verification state."""
        return {"items": tokenomics.list_prices(settings)}

    @api.post("/tokenomics/prices", summary="Add a price version")
    def add_price(body: PriceInput, operator: Operator) -> dict:
        """Creates a new tariff version without changing historical generation pricing or model routing."""
        return tokenomics.add_price(
            settings, body.model_dump(mode="json", exclude_none=True), actor=operator["username"]
        )

    @api.get("/models", summary="Read effective model routing")
    def models(_: Operator) -> dict:
        """Shows the same resolved model roles used for invocation, including disabled roles and retrieval."""
        return {"items": llm.effective_models(settings)}

    @api.get("/metrics", summary="Read generation metrics")
    def metrics(_: Operator) -> dict:
        """Summarizes measured costs, latency and evidence coverage without exposing prompts or generated text."""
        return tokenomics.admin_metrics(settings)

    @api.get("/generations", summary="Read generation accounting history")
    def generations(
        _: Operator,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0, le=100000)] = 0,
    ) -> dict:
        """Lists a bounded page of generation metadata and accounting outcomes, with no family conversation."""
        return {"items": tokenomics.admin_generations(settings, limit=limit, offset=offset)}

    @api.get("/audit", summary="Read configuration audit history")
    def audit(_: Operator, limit: Annotated[int, Query(ge=1, le=100)] = 50) -> dict:
        """Lists sanitized configuration changes and operator attribution, excluding all credential values."""
        return {"items": tokenomics.admin_audit(settings, limit=limit)}

    return api

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import httpx
import jwt
import psycopg
import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from psycopg.conninfo import conninfo_to_dict
from pydantic import SecretStr

from habitquest_backend import daily, llm
from habitquest_backend.config import Settings
from habitquest_backend.main import create_app

SECRET = "test-only-signing-key-at-least-32-bytes-long"
PARENT = UUID("11111111-1111-1111-1111-111111111111")
OTHER = UUID("22222222-2222-2222-2222-222222222222")
load_dotenv()
# Tests never reach a real model or use a developer's sign-in settings, whatever their .env says.
for name in (
    "AI_MODE",
    "AI_HELPER_REASONING_EFFORT",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "OPENAI_SMALL_MODEL",
    "OPENAI_SAFETY_MODEL",
    "OPENAI_API_KEY",
    "COACH_ENGINE",
    "CREW_ROLES",
    "GOOGLE_CLIENT_ID",
    "DEV_LOGIN",
    "DEV_LOGIN_PASSWORD",
    "BUDDY_CATALOG_ENABLED",
):
    os.environ.pop(name, None)
os.environ["TRACE_COACH"] = "false"
# The imported OpenAI/Pinecone group must never leak from a developer's dotenv
# into fixtures. Keep DB URLs, but clear every feature/model routing switch.
for name in tuple(os.environ):
    if name.startswith(
        ("PLANNING_", "COACH_", "PINECONE_", "OPENAI_", "HABIT_GENERATION_", "EMBEDDING_", "ADMIN_")
    ) or name in {
        "PARENT_RISK_MODEL",
        "OUTPUT_SAFETY_MODEL",
        "RETRIEVAL_MODE",
        "CATALOG_VERSION",
        "CATALOG_SNAPSHOT_POINTER",
        "SSL_CERT_FILE",
    }:
        os.environ.pop(name)
os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"
URL = os.getenv("TEST_DATABASE_URL", "postgresql://hq_dev@127.0.0.1:55432/hq_test")
if not conninfo_to_dict(URL).get("dbname", "").endswith("_test"):
    raise pytest.UsageError(
        "TEST_DATABASE_URL must name a dedicated database ending in _test; fixtures delete test data."
    )


REAL_GOLDEN = daily.golden_habit


@pytest.fixture(autouse=True)
def no_provider_network(monkeypatch):
    """HTTP model/retrieval tests must inject transports, never use live keys."""

    def reject(self, request):
        raise RuntimeError("Tests must use MockTransport instead of real provider HTTP")

    async def reject_async(self, request):
        raise RuntimeError("Tests must use MockTransport instead of real provider HTTP")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", reject)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", reject_async)


@pytest.fixture(autouse=True)
def no_golden_habit(monkeypatch):
    """Keeps point totals predictable; tests of the golden quest put REAL_GOLDEN back."""
    monkeypatch.setattr(daily, "golden_habit", lambda habits, day, child_id: None)


@pytest.fixture
def settings():
    return Settings(_env_file=None, database_url=URL, jwt_secret=SECRET, jwt_issuer="http://local-test")


def token(settings, user=PARENT, **overrides):
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user),
            "iat": now,
            "exp": now + timedelta(minutes=5),
            "aud": "authenticated",
            "iss": settings.jwt_issuer,
            "role": "authenticated",
            **overrides,
        },
        SECRET,
        algorithm="HS256",
    )


@pytest.fixture
def db(settings):
    """An administrative connection to a clean test database with the seeded catalog."""
    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        conn.execute("TRUNCATE hq.users,hq.families CASCADE")
        conn.execute((Path(__file__).parents[1] / "db/seed.sql").read_text())
        conn.execute("INSERT INTO hq.planning_budget(singleton) VALUES(true) ON CONFLICT DO NOTHING")
        yield conn


@pytest.fixture
def client(settings, db):
    with TestClient(create_app(settings)) as c:
        c.headers["Authorization"] = "Bearer " + token(settings)
        yield c


@pytest.fixture
def remote(settings):
    """Settings for the real model path; pair with `llm_reply` so nothing reaches the network."""
    return settings.model_copy(
        update={
            "ai_mode": "openai",
            "openai_base_url": "https://llm.example/v1/",
            "openai_model": "vendor/model",
            "openai_small_model": "vendor/small",
            "openai_api_key": SecretStr("k"),
        }
    )


def schema_name(body: dict) -> str | None:
    """The JSON schema a structured call asked for, if any."""
    found = body.get("response_format")
    return found.get("json_schema", {}).get("name") if isinstance(found, dict) else None


@pytest.fixture
def llm_reply(monkeypatch):
    """Routes model calls to the returned function's handler; `.seen` holds each request's JSON body. The coach's
    parent risk check is answered apart, from `.risk` (no risk unless a test sets it), and kept in `.risk_seen`.
    """

    def route(*handlers):
        queue = list(handlers)

        def respond(request):
            body = json.loads(request.content)
            if schema_name(body) == "ParentRisk":
                route.risk_seen.append(body)
                reply = route.risk
            else:
                route.seen.append(body)
                reply = queue.pop(0) if len(queue) > 1 else queue[0]
            if isinstance(reply, httpx.Response):
                return reply
            if isinstance(reply, dict) and "risk" in reply:
                reply = json.dumps(reply)
            message = {"role": "assistant", **(reply if isinstance(reply, dict) else {"content": reply})}
            return httpx.Response(
                200,
                json={
                    "id": "x",
                    "object": "chat.completion",
                    "created": 0,
                    "model": "m",
                    "choices": [{"index": 0, "finish_reason": "stop", "message": message}],
                },
            )

        monkeypatch.setattr(
            llm, "http_client", lambda settings: httpx.Client(transport=httpx.MockTransport(respond))
        )

    route.seen = []
    route.risk_seen = []
    route.risk = {"risk": False, "reason": ""}
    return route

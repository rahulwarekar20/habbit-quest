"""The operator login is isolated from families and cannot disclose credentials or bypass throttling."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from conftest import PARENT, token
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from habitquest_backend import admin, llm, tokenomics
from habitquest_backend.config import Settings
from habitquest_backend.main import create_app

ADMIN_PASSWORD = "unit-test-operator-password-at-least-32-bytes"
ADMIN_SECRET = "unit-test-independent-operator-secret-32-bytes"


@pytest.fixture
def operator_settings(settings):
    return settings.model_copy(
        update={
            "admin_enabled": True,
            "admin_password": SecretStr(ADMIN_PASSWORD),
            "admin_jwt_secret": SecretStr(ADMIN_SECRET),
        }
    )


@pytest.fixture
def operator_client(operator_settings):
    return TestClient(create_app(operator_settings))


def sign_in(client):
    response = client.post("/v1/admin/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD})
    assert response.status_code == 200, response.text
    body = response.json()
    client.headers["Authorization"] = "Bearer " + body["access_token"]
    return body


def admin_token(settings, **claims):
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": "admin",
            "iat": now,
            "exp": now + timedelta(minutes=5),
            "iss": settings.jwt_issuer + "/admin",
            "aud": admin.ADMIN_AUDIENCE,
            "role": "admin",
            "auth_version": 1,
            **claims,
        },
        ADMIN_SECRET,
        algorithm="HS256",
    )


def test_login_and_independent_token_session(operator_client, operator_settings):
    body = sign_in(operator_client)
    assert body["username"] == "admin" and body["token_type"] == "bearer" and body["expires_in"] == 1800
    session = operator_client.get("/v1/admin/me").json()
    assert session["username"] == "admin" and session["role"] == "admin"
    assert session["expires_at"] > datetime.now(UTC).timestamp()
    assert ADMIN_PASSWORD not in str(body) and ADMIN_SECRET not in str(body)
    assert operator_client.get("/v1/goals").status_code == 401
    operator_client.headers["Authorization"] = "Bearer " + token(operator_settings)
    assert operator_client.get("/v1/admin/me").status_code == 401
    operator_client.headers["Authorization"] = "Bearer " + token(operator_settings, role="kid")
    assert operator_client.get("/v1/admin/me").status_code == 401


@pytest.mark.parametrize(
    "changes",
    [{}, {"admin_enabled": True}, {"admin_enabled": True, "admin_password": SecretStr(ADMIN_PASSWORD)}],
)
def test_unconfigured_admin_is_unavailable(settings, changes):
    client = TestClient(create_app(settings.model_copy(update=changes)))
    assert client.get("/v1/admin/me").status_code == 404
    assert client.post("/v1/admin/auth/login", json={}).status_code == 404


@pytest.mark.parametrize(
    "claims",
    [
        {"role": "authenticated"},
        {"sub": str(PARENT)},
        {"auth_version": 2},
        {"auth_version": True},
        {"exp": 0},
        {"aud": "authenticated"},
        {"iss": "elsewhere"},
    ],
)
def test_admin_tokens_require_all_exact_claims(operator_client, operator_settings, claims):
    operator_client.headers["Authorization"] = "Bearer " + admin_token(operator_settings, **claims)
    assert operator_client.get("/v1/admin/me").status_code == 401


def test_missing_garbage_and_rotated_tokens(operator_client, operator_settings):
    assert operator_client.get("/v1/admin/me").status_code == 401
    operator_client.headers["Authorization"] = "Bearer nonsense"
    assert operator_client.get("/v1/admin/me").status_code == 401
    sign_in(operator_client)
    operator_settings.admin_auth_version = 2
    assert operator_client.get("/v1/admin/me").status_code == 401


@pytest.mark.parametrize(
    "data",
    [
        {"username": "parent:admin", "password": ADMIN_PASSWORD},
        {"username": "admin", "password": "wrong"},
        {"username": "different", "password": "wrong"},
    ],
)
def test_generic_bad_credentials(operator_client, data):
    response = operator_client.post("/v1/admin/auth/login", json=data)
    assert response.status_code == 401
    assert response.json() == {"detail": "Incorrect username or password"}


@pytest.mark.parametrize(
    "data",
    [
        {"username": "admin", "password": {"secret": ADMIN_PASSWORD}},
        {"password": ADMIN_PASSWORD},
        {"username": "admin", "password": 2},
        {"username": "admin", "password": ADMIN_PASSWORD, "extra": 1},
    ],
)
def test_bad_login_validation_does_not_echo_password(operator_client, data):
    response = operator_client.post("/v1/admin/auth/login", json=data)
    assert response.status_code == 422 and ADMIN_PASSWORD not in response.text


def test_bad_json_and_large_body(operator_client):
    assert operator_client.post("/v1/admin/auth/login", content=b"invalid").status_code == 422
    assert operator_client.post("/v1/admin/auth/login", content=b"x" * 4097).status_code == 413


def test_forwarded_headers_do_not_bypass_login_limit(operator_client):
    for i in range(5):
        response = operator_client.post(
            "/v1/admin/auth/login",
            json={"username": "admin", "password": "bad"},
            headers={"X-Forwarded-For": f"192.0.2.{i}", "CF-Connecting-IP": f"198.51.100.{i}"},
        )
        assert response.status_code == 401
    assert (
        operator_client.post(
            "/v1/admin/auth/login",
            json={"username": "admin", "password": ADMIN_PASSWORD},
            headers={"X-Forwarded-For": "203.0.113.1"},
        ).status_code
        == 429
    )


def test_no_socket_address_uses_one_shared_limit(operator_settings):
    client = TestClient(create_app(operator_settings), client=None)
    for _ in range(5):
        assert client.post("/v1/admin/auth/login", json={}).status_code == 422
    assert client.post("/v1/admin/auth/login", json={}).status_code == 429


def test_admin_configuration_requires_independent_secrets():
    for changes in (
        {},
        {"admin_password": ADMIN_PASSWORD},
        {"admin_jwt_secret": ADMIN_SECRET},
        {"admin_password": "short", "admin_jwt_secret": ADMIN_SECRET},
        {"admin_password": ADMIN_PASSWORD, "admin_jwt_secret": "short"},
        {"admin_password": ADMIN_PASSWORD, "admin_jwt_secret": ADMIN_SECRET, "jwt_secret": ADMIN_SECRET},
    ):
        with pytest.raises(ValidationError, match="ADMIN_ENABLED") as error:
            Settings(_env_file=None, admin_enabled=True, **changes)
        assert ADMIN_PASSWORD not in str(error.value) and ADMIN_SECRET not in str(error.value)
    settings = Settings(
        _env_file=None, admin_enabled=True, admin_password=ADMIN_PASSWORD, admin_jwt_secret=ADMIN_SECRET
    )
    assert ADMIN_PASSWORD not in repr(settings) and ADMIN_SECRET not in repr(settings)


def test_admin_routes_forward_only_validated_data(operator_client, monkeypatch):
    sign_in(operator_client)
    monkeypatch.setattr(tokenomics, "get_policy", lambda settings: {"revision": 1, "daily_credits": 100})
    assert operator_client.get("/v1/admin/tokenomics/config").json()["revision"] == 1
    seen = []
    monkeypatch.setattr(
        tokenomics,
        "update_policy",
        lambda settings, revision, patch, actor: (
            seen.append((revision, patch, actor)) or {"revision": revision + 1}
        ),
    )
    assert operator_client.patch(
        "/v1/admin/tokenomics/config", json={"revision": 1, "show_costs": True}
    ).json() == {"revision": 2}
    assert seen == [(1, {"show_costs": True}, "admin")]
    monkeypatch.setattr(tokenomics, "list_prices", lambda settings: [{"model": "test-model"}])
    assert operator_client.get("/v1/admin/tokenomics/prices").json() == {"items": [{"model": "test-model"}]}
    price = {
        "provider": "OpenAI",
        "model": "test-model",
        "api_mode": "responses",
        "kind": "chat",
        "input_rate": "0.1",
        "output_rate": "0.5",
        "source_url": "https://example.com/pricing",
    }
    monkeypatch.setattr(tokenomics, "add_price", lambda settings, values, actor: {**values, "actor": actor})
    result = operator_client.post("/v1/admin/tokenomics/prices", json=price)
    assert result.status_code == 200 and result.json()["actor"] == "admin"
    monkeypatch.setattr(llm, "effective_models", lambda settings: [{"role": "coach", "model": "test"}])
    assert operator_client.get("/v1/admin/models").json()["items"][0]["role"] == "coach"
    monkeypatch.setattr(tokenomics, "admin_metrics", lambda settings: {"summary": {"operations": 0}})
    assert operator_client.get("/v1/admin/metrics").json()["summary"]["operations"] == 0
    monkeypatch.setattr(
        tokenomics, "admin_generations", lambda settings, limit, offset: [{"limit": limit, "offset": offset}]
    )
    assert operator_client.get("/v1/admin/generations?limit=2&offset=3").json() == {
        "items": [{"limit": 2, "offset": 3}]
    }
    monkeypatch.setattr(tokenomics, "admin_audit", lambda settings, limit: [{"limit": limit}])
    assert operator_client.get("/v1/admin/audit?limit=3").json() == {"items": [{"limit": 3}]}
    assert operator_client.get("/v1/admin/generations?limit=10000").status_code == 422


@pytest.mark.parametrize(
    "patch",
    [
        {"revision": 1},
        {"revision": 1, "daily_credits": None},
        {"revision": 1, "weights": {}},
        {"revision": 1, "weights": {"bad": 1}},
        {"revision": 1, "weights": {"coach": True}},
        {"revision": 1, "enforce_budgets": "true"},
    ],
)
def test_policy_invalid_changes_are_rejected(operator_client, patch):
    sign_in(operator_client)
    assert operator_client.patch("/v1/admin/tokenomics/config", json=patch).status_code == 422


def test_policy_weights_validate_known_activities():
    assert admin.PolicyUpdate(revision=1, weights={"coach": 3}).weights == {"coach": 3}
    assert admin.PolicyUpdate.known_activities(None) is None


@pytest.mark.parametrize(
    "change",
    [
        {"source_url": "http://example.com"},
        {"source_url": "https://user:pass@example.com"},
        {"source_url": "https://example.com?key=secret"},
        {"source_url": "https://example.com#secret"},
        {"verified_at": "2026-11-05T12:00:00"},
        {"status": "verified"},
        {"input_rate": None},
        {"kind": "embedding"},
        {"kind": "search", "read_unit_rate": 18, "egress_rate": ".1"},
        {"api_mode": "embeddings"},
    ],
)
def test_price_validation(change):
    values = {
        "provider": "OpenAI",
        "model": "test",
        "api_mode": "responses",
        "kind": "chat",
        "input_rate": ".1",
        "output_rate": ".5",
        "source_url": "https://example.com/pricing",
    }
    with pytest.raises(ValidationError):
        admin.PriceInput(**(values | change))


def test_price_verified_timezone_and_null_optional_values():
    price = admin.PriceInput(
        provider="Pinecone",
        model="documents-search",
        api_mode="documents_search",
        kind="search",
        read_unit_rate=18,
        egress_rate=".1",
        source_url="https://example.com",
        verified_at=datetime.now(UTC),
        effective_at=None,
        status="verified",
    )
    assert price.kind == "search"
    assert admin.PriceInput.timezone_required(None) is None
    assert admin.PriceInput(
        provider="OpenAI",
        model="text-embedding-3-small",
        api_mode="embeddings",
        kind="embedding",
        input_rate=".02",
        source_url="https://example.com",
    ).input_rate


def test_family_accounting_routes_require_caregiver_and_validate_observations(settings, monkeypatch):
    client = TestClient(create_app(settings))
    client.headers["Authorization"] = "Bearer " + token(settings)
    family, operation = uuid4(), uuid4()
    seen = []
    monkeypatch.setattr(tokenomics, "family_budget", lambda s, u, f: {"allowance": 100, "remaining": 100})
    monkeypatch.setattr(tokenomics, "get_operation", lambda s, u, f, o: {"id": str(o), "credits": 2})
    monkeypatch.setattr(
        tokenomics, "record_observation", lambda s, u, f, o, values: seen.append(values) or {"saved": True}
    )
    base = f"/v1/families/{family}/ai"
    assert client.get(base + "/budget").json()["allowance"] == 100
    assert client.get(base + f"/operations/{operation}").json()["credits"] == 2
    endpoint = base + f"/operations/{operation}/observation"
    assert client.post(endpoint, json={"response_ms": 1234.5}).status_code == 200
    assert seen == [{"response_ms": 1234.5}]
    for body in ({"response_ms": -1}, {"response_ms": 3600001}, {"cost_usd": 5}):
        assert client.post(endpoint, json=body).status_code == 422
    client.headers["Authorization"] = "Bearer " + token(settings, role="kid")
    assert client.get(base + "/budget").status_code == 401

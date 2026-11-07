"""ALB socket trust and forged-header isolation for sign-in rate limits."""

from ipaddress import ip_network

import pytest
from pydantic import ValidationError
from starlette.requests import Request

from habitquest_backend.config import Settings
from habitquest_backend.limits import client_address


def request(peer="172.31.96.8", forwarded="198.51.100.1", extra=()):
    return Request(
        {
            "type": "http",
            "client": (peer, 1234) if peer else None,
            "headers": [
                (b"x-forwarded-for", forwarded.encode()),
                (b"cf-connecting-ip", b"192.0.2.99"),
                (b"true-client-ip", b"192.0.2.98"),
                *extra,
            ],
        }
    )


@pytest.mark.parametrize("peer", ["172.31.96.8", "testclient", None])
def test_default_ignores_all_forwarding_headers(peer):
    assert client_address(request(peer)) == (peer or "unknown")


@pytest.mark.parametrize("peer", ["172.31.98.8", "invalid", None])
def test_untrusted_peers_cannot_supply_a_client_address(peer):
    assert client_address(request(peer), [ip_network("172.31.96.0/24")]) == (peer or "unknown")


@pytest.mark.parametrize("candidate", ["203.0.113.12", "2001:db8::1"])
def test_only_last_alb_appended_address_counts(candidate):
    incoming = request(forwarded=f"192.0.2.1, garbage, {candidate}")
    assert client_address(incoming, [ip_network("172.31.96.0/24")]) == candidate


def test_repeated_headers_conservatively_use_socket_peer():
    incoming = request(extra=[(b"x-forwarded-for", b"2001:db8::2")])
    assert client_address(incoming, [ip_network("172.31.96.0/24")]) == "172.31.96.8"


@pytest.mark.parametrize("candidate", ["", "bad", "198.51.100.1:80", "[2001:db8::1]:80", "fe80::1%eth0"])
def test_malformed_or_unexpected_header_falls_back_to_peer(candidate):
    assert client_address(request(forwarded=candidate), [ip_network("172.31.96.0/24")]) == "172.31.96.8"


def test_absent_header_and_invalid_cidr_configuration():
    incoming = Request({"type": "http", "client": ("172.31.96.1", 1), "headers": []})
    assert client_address(incoming, [ip_network("172.31.96.0/24")]) == "172.31.96.1"
    with pytest.raises(ValidationError):
        Settings(_env_file=None, alb_trusted_proxy_cidrs=["not-a-network"])


def test_proxy_configuration_uses_validated_networks():
    settings = Settings(_env_file=None, alb_trusted_proxy_cidrs=["172.31.96.0/24", "2001:db8::/64"])
    assert client_address(request("2001:db8::3"), settings.alb_trusted_proxy_cidrs) == "198.51.100.1"


def test_admin_endpoint_uses_trusted_address_without_accepting_spoofed_prefixes(settings):
    from fastapi.testclient import TestClient
    from pydantic import SecretStr

    from habitquest_backend.main import create_app

    configured = settings.model_copy(
        update={
            "admin_enabled": True,
            "admin_password": SecretStr("unit-test-operator-password-at-least-32-bytes"),
            "admin_jwt_secret": SecretStr("unit-test-independent-operator-secret-32-bytes"),
            "admin_sign_in_limit": 1,
            "alb_trusted_proxy_cidrs": [ip_network("172.31.96.0/24")],
        }
    )
    with TestClient(create_app(configured), client=("172.31.96.8", 443)) as client:
        body = {"username": "admin", "password": "incorrect"}
        assert (
            client.post(
                "/v1/admin/auth/login", json=body, headers={"X-Forwarded-For": "192.0.2.1, 203.0.113.1"}
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/v1/admin/auth/login",
                json=body,
                headers={"X-Forwarded-For": "192.0.2.2, 203.0.113.1", "CF-Connecting-IP": "192.0.2.3"},
            ).status_code
            == 429
        )
        assert (
            client.post(
                "/v1/admin/auth/login", json=body, headers={"X-Forwarded-For": "203.0.113.2"}
            ).status_code
            == 401
        )

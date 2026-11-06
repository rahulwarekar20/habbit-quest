"""Budget settings preserve usage and restrict changes to the provisioned owner."""

from decimal import Decimal
from uuid import UUID, uuid4

from conftest import OTHER, PARENT, token
from test_generated_habits import app as app  # noqa: F401
from test_generated_habits import goal as goal  # noqa: F401

from habitquest_backend.auth import KID
from habitquest_backend.db import transaction
from habitquest_backend.planning_budget import reserve


def test_global_cap_is_no_longer_readable_or_editable_by_caregivers(app, db, settings):
    client, _, child = app
    db.execute(
        "UPDATE hq.planning_budget SET initialized=true,accounted_usd=.98,owner_user_id=%s,cap_usd=5",
        (PARENT,),
    )
    try:
        for headers in ({}, {"Authorization": "Bearer " + token(settings, OTHER)}):
            for method in ("GET", "PATCH"):
                result = client.request(
                    method,
                    "/v1/ai/budget",
                    headers=headers,
                    json={"cap_usd": 10} if method == "PATCH" else None,
                )
                assert result.status_code == 410
                assert "moved" in result.json()["detail"]
                assert "accounted_usd" not in result.text
        assert db.execute("SELECT accounted_usd FROM hq.planning_budget").fetchone()[0] == Decimal("0.98")
        kid = {"Authorization": "Bearer " + token(settings, UUID(child), role=KID)}
        assert client.get("/v1/ai/budget", headers=kid).status_code == 401
        assert client.patch("/v1/ai/budget", json={"cap_usd": 10}, headers=kid).status_code == 401
        assert not db.execute(
            "SELECT has_function_privilege('hq_api','hq.set_planning_budget_cap(numeric)','EXECUTE')"
        ).fetchone()[0]
    finally:
        db.execute("UPDATE hq.planning_budget SET cap_usd=NULL,owner_user_id=NULL,accounted_usd=0")


def test_missing_ledger_cannot_grant_a_new_allowance(app, db, settings):
    settings.ai_mode = "openai"
    db.execute("DELETE FROM hq.planning_budget")
    try:
        with transaction(settings, PARENT) as conn:
            assert not reserve(conn, settings, 0.01, uuid4())
    finally:
        db.execute("INSERT INTO hq.planning_budget(singleton) VALUES(true)")

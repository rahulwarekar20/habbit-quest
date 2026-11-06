"""Family-owned credit summaries and operation metadata, with server-controlled USD visibility."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import Field

from habitquest_backend import tokenomics
from habitquest_backend.accounts import StrictModel
from habitquest_backend.auth import signed_in
from habitquest_backend.config import Settings


class Observation(StrictModel):
    response_ms: float | None = Field(default=None, ge=0, le=3_600_000, allow_inf_nan=False)
    all_choices_ready_ms: float | None = Field(default=None, ge=0, le=3_600_000, allow_inf_nan=False)
    queue_ms: float | None = Field(default=None, ge=0, le=3_600_000, allow_inf_nan=False)


def router(settings: Settings) -> APIRouter:
    api = APIRouter(tags=["Families"])
    User = Annotated[UUID, Depends(signed_in(settings))]

    @api.get("/v1/families/{family_id}/ai/budget", summary="Read family coaching credits")
    def budget(family_id: UUID, user: User) -> dict:
        """Reads one family's shared daily allowance, settled and pending credits, and accepted activity quotes."""
        return tokenomics.family_budget(settings, user, family_id)

    @api.get(
        "/v1/families/{family_id}/ai/operations/{operation_id}", summary="Read generation accounting status"
    )
    def operation(family_id: UUID, operation_id: UUID, user: User) -> dict:
        """Restores owned operation accounting metadata while withholding USD fields when the policy hides costs."""
        return tokenomics.get_operation(settings, user, family_id, operation_id)

    @api.post(
        "/v1/families/{family_id}/ai/operations/{operation_id}/observation",
        summary="Record observed browser latency",
    )
    def observation(family_id: UUID, operation_id: UUID, body: Observation, user: User) -> dict:
        """Records bounded, untrusted browser timings separately from server timing and never changes cost or credits."""
        return tokenomics.record_observation(
            settings, user, family_id, operation_id, body.model_dump(exclude_none=True)
        )

    return api

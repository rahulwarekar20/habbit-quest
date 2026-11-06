"""Retired caregiver endpoints: operator configuration now requires the separate admin login."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from habitquest_backend.auth import signed_in
from habitquest_backend.config import Settings


def router(settings: Settings) -> APIRouter:
    api = APIRouter()
    User = Annotated[UUID, Depends(signed_in(settings))]

    @api.get("/v1/ai/budget", tags=["Families"], summary="Retired shared budget")
    def read_budget(_: User) -> dict:
        """Old clients are told global configuration moved; no shared cost data is exposed to families."""
        raise HTTPException(410, "Global AI configuration moved to the separate admin console")

    @api.patch("/v1/ai/budget", tags=["Families"], summary="Retired shared budget editing")
    def change_budget(_: User) -> dict:
        """Caregiver credentials can no longer change the operator cap, including from an older open tab."""
        raise HTTPException(410, "Global AI configuration moved to the separate admin console")

    return api

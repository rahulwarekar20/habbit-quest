"""Additive buddy identity and explicit, revision-guarded selections; no provider calls."""

from typing import Annotated, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from habitquest_backend.config import Settings

Buddy = Literal["fox", "owl", "bear", "bunny"]
BUDDY_COLUMNS = "buddy,buddy_selection_mode,catalog_buddy_id,buddy_catalog_version,buddy_selection_revision"
BUDDY_FIELDS = BUDDY_COLUMNS.split(",")


class LegacySelection(BaseModel):
    """An intentional original buddy choice, independent of catalog availability."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    mode: Literal["legacy"]
    buddy: Buddy
    expected_revision: int | None = Field(default=None, ge=0, strict=True)


class CatalogSelection(BaseModel):
    """A pinned catalog character; the existing buddy remains its visual fallback."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    mode: Literal["catalog"]
    catalog_buddy_id: str = Field(min_length=1, max_length=80)
    buddy_catalog_version: str = Field(min_length=1, max_length=40)
    expected_revision: int | None = Field(default=None, ge=0, strict=True)


BuddySelection = Annotated[LegacySelection | CatalogSelection, Field(discriminator="mode")]


def selection_changes(conn, settings: Settings, child: dict, choice: BuddySelection) -> dict:
    """Validate a choice against the locked final child state and advance its revision."""
    if choice.expected_revision != child["buddy_selection_revision"]:
        raise HTTPException(409, "Your buddy changed. Refresh and choose again.")
    changes = {
        "buddy_selection_mode": choice.mode,
        "catalog_buddy_id": None,
        "buddy_catalog_version": None,
        "buddy_selection_revision": child["buddy_selection_revision"] + 1,
    }
    if isinstance(choice, LegacySelection):
        changes["buddy"] = choice.buddy
    else:
        if not settings.buddy_catalog_enabled:
            raise HTTPException(409, "Catalog buddy choices are temporarily unavailable")
        changes["catalog_buddy_id"] = choice.catalog_buddy_id
        changes["buddy_catalog_version"] = choice.buddy_catalog_version
        validate_catalog_choice(conn, {**child, **changes})
    return changes


def validate_catalog_choice(conn, child: dict) -> None:
    """Require a locally published reference for the final age, without network lookups."""
    valid = conn.execute(
        "SELECT 1 FROM hq.buddy_catalog WHERE id=%s AND catalog_version=%s AND available"
        " AND %s BETWEEN supported_age_min AND supported_age_max",
        (child["catalog_buddy_id"], child["buddy_catalog_version"], child["age"]),
    ).fetchone()
    if valid is None:
        raise HTTPException(422, "That catalog buddy is unavailable for this age or version")


def require_selection_revision(choice: BuddySelection | None) -> None:
    """Updates must distinguish an explicit revision from a missing revision."""
    if choice is not None and choice.expected_revision is None:
        raise HTTPException(422, "An explicit buddy choice requires expected_revision")

"""Pinned planning cards, stable goal identities and a read-only parent source reader.

Validation and evidence projection are adapted from hq_planner/catalog/repository.py
and augmentation/evidence_builder.py. Canonical records are vendored, vectors are not.
Browsing never creates goals. A reviewed Coach selection can materialize one
verified source through a restricted database function; prototype rewards are not mapped.
"""

import json
from copy import deepcopy
from dataclasses import dataclass
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException

from habitquest_backend.auth import signed_in
from habitquest_backend.config import Settings
from habitquest_backend.db import one, transaction

CATALOG_VERSION = "0.1.0"
SNAPSHOT_ID = "22cec20089fee49e76ee76861b01a199e05f765ec19a2f1911eddef1088828df"
SOURCE_MANIFEST_SHA256 = "e2bebd5d66057f896f0177d139e5769e2108d63444ac1485c6b8e8bba7e60d47"
PACKAGED_SHA256 = "34f992f03e71dcbf5290bc71c017e0b85765a645402600b0c531594d86c83b33"
CHILD_INTENTS = {"general_wellbeing", "targeted_skill_support"}
CONTEXTS = {"home", "school", "community", "outdoors", "online"}
Setting = Literal["home", "school", "community", "outdoors", "online"]
METADATA_FIELDS = (
    "age_min",
    "age_max",
    "contexts",
    "available_by_default",
    "catalog_version",
    "language",
    "intent_class",
    "canonical_record_sha256",
    "concept_id",
    "category_id",
)


class CatalogError(RuntimeError):
    """A source release or identity cannot be trusted; contains no provider data."""


def digest(value: bytes | dict | list) -> str:
    """Matches the prototype's canonical JSON digest exactly, including Unicode."""
    raw = (
        value
        if isinstance(value, bytes)
        else json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()
    )
    return sha256(raw).hexdigest()


def goal_id_for(source_id: str) -> str:
    """One short deterministic application goal ID per source age-variant card."""
    return "hqg-" + sha256(source_id.encode()).hexdigest()[:24]


def without_rewards(value: Any) -> Any:
    """Source reward policies have no authority over this app's existing economy."""
    if isinstance(value, dict):
        return {k: without_rewards(v) for k, v in value.items() if not k.startswith(("reward", "point"))}
    if isinstance(value, list):
        return [without_rewards(item) for item in value]
    return value


@dataclass(frozen=True)
class CatalogGoal:
    """A defensive copy of one canonical source card, never model-authored content."""

    goal_id: str
    source_id: str
    concept_id: str
    category_id: str
    catalog_version: str
    record_sha256: str
    record: dict
    metadata: dict
    text: str

    @property
    def title(self) -> str:
        return self.record["title"]

    @property
    def description(self) -> str:
        return self.record["description"]

    @property
    def source_ref(self) -> dict:
        return {
            "source_id": self.source_id,
            "concept_id": self.concept_id,
            "category_id": self.category_id,
            "catalog_version": self.catalog_version,
            "record_sha256": self.record_sha256,
            "snapshot_id": SNAPSHOT_ID,
        }

    def evidence(self) -> dict:
        """Full relevant instructions and limits for generation, without app reward rules."""
        return without_rewards(
            {
                key: self.record[key]
                for key in (
                    "id",
                    "title",
                    "description",
                    "age",
                    "kid",
                    "parent",
                    "practice",
                    "safety",
                    "research",
                    "support_targets",
                    "mechanisms",
                    "clinical_review_status",
                    "status",
                )
            }
        )

    def candidate(self) -> dict:
        """Bounded Coach evidence; detail and generated habits use the full source separately."""
        record = self.record
        evidence = {
            "age_min": self.metadata["age_min"],
            "age_max": self.metadata["age_max"],
            "contexts": list(self.metadata["contexts"]),
            "selection_guidance": record["parent"]["selection_guidance"],
            "completion": record["practice"]["completion"],
            "support_level": record["practice"]["support_level"],
            "readiness_note": record["age"]["readiness_note"],
            "not_for": record["safety"]["not_for"],
            "research_insight": record["research"]["insight"],
            "product_efficacy": record["research"]["product_efficacy"],
            "research_limits": [item["does_not_establish"] for item in record["research"]["evidence"]],
            "research_evidence": deepcopy(record["research"]["evidence"]),
        }
        return {
            "goal_id": self.goal_id,
            "title": self.title,
            "description": self.description,
            "source_ref": self.source_ref,
            "evidence": evidence,
        }

    def detail(self) -> dict:
        evidence = self.evidence()
        return {
            "goal_id": self.goal_id,
            "source_ref": self.source_ref,
            "age_min": self.metadata["age_min"],
            "age_max": self.metadata["age_max"],
            "contexts": list(self.metadata["contexts"]),
            "readiness_note": self.record["age"]["readiness_note"],
            **{
                key: evidence[key]
                for key in (
                    "title",
                    "description",
                    "parent",
                    "kid",
                    "practice",
                    "safety",
                    "research",
                    "support_targets",
                    "mechanisms",
                    "clinical_review_status",
                    "status",
                )
            },
        }


def validate_payload(payload: dict) -> dict[str, CatalogGoal]:
    """Recheck original card/text digests and all retrieval predicates against canonical content."""
    try:
        if (
            payload["snapshot_id"] != SNAPSHOT_ID
            or payload["source_manifest_sha256"] != SOURCE_MANIFEST_SHA256
            or payload["target"]
            != {"index_name": "hq-habits-v1", "namespace": "habits-0-1-0", "catalog_version": CATALOG_VERSION}
            or payload["embedding"]
            != {
                "model": "text-embedding-3-small",
                "dimensions": 512,
                "metric": "cosine",
                "source": "actual_dimensions_api",
            }
            or len(payload["records"]) != 381
        ):
            raise CatalogError("catalog_release_mismatch")
        result = {}
        for row in payload["records"]:
            record, metadata = row["canonical_record"], row["metadata"]
            canonical_metadata = {
                "age_min": record["age"]["min"],
                "age_max": record["age"]["max"],
                "contexts": record["stacking"]["contexts"],
                "available_by_default": record["retrieval"]["available_by_default"],
                "catalog_version": record["catalog_version"],
                "language": record["retrieval"]["language"],
                "intent_class": record["intent_class"],
                "canonical_record_sha256": digest(record),
                "concept_id": record["concept_id"],
                "category_id": record["category_id"],
            }
            ident = goal_id_for(row["id"])
            if (
                record["id"] != row["id"]
                or ident in result
                or record["catalog_version"] != CATALOG_VERSION
                or any(metadata[key] != value for key, value in canonical_metadata.items())
                or digest(row["text"].encode()) != metadata["embedding_text_sha256"]
                or row["text"] != record["retrieval"]["embedding_text"]
            ):
                raise CatalogError("catalog_record_mismatch")
            result[ident] = CatalogGoal(
                ident,
                row["id"],
                metadata["concept_id"],
                metadata["category_id"],
                CATALOG_VERSION,
                metadata["canonical_record_sha256"],
                record,
                metadata,
                row["text"],
            )
        return result
    except (KeyError, TypeError, ValueError) as exc:
        raise CatalogError("catalog_invalid") from exc


@lru_cache(maxsize=1)
def packaged_goals() -> dict[str, CatalogGoal]:
    """Load once per process; callers only receive copies of these immutable source facts."""
    try:
        raw = (Path(__file__).parent / "data/planning_catalog.json").read_bytes()
        if digest(raw) != PACKAGED_SHA256:
            raise CatalogError("catalog_package_checksum")
        return validate_payload(json.loads(raw))
    except (OSError, ValueError) as exc:
        raise CatalogError("catalog_package_unavailable") from exc


class CatalogRepository:
    """Portable, pinned release; no sibling repository or cloud access is required."""

    version = CATALOG_VERSION
    snapshot_id = SNAPSHOT_ID

    def __init__(self):
        self._goals = packaged_goals()
        self._source_ids = {goal.source_id: goal.goal_id for goal in self._goals.values()}

    def get(self, goal_id: str) -> CatalogGoal:
        try:
            return deepcopy(self._goals[goal_id])
        except KeyError as exc:
            raise CatalogError("unknown_goal") from exc

    def from_source(self, source_id: str) -> CatalogGoal:
        try:
            return self.get(self._source_ids[source_id])
        except KeyError as exc:
            raise CatalogError("unknown_source") from exc

    def all(self) -> tuple[CatalogGoal, ...]:
        return tuple(self.get(ident) for ident in sorted(self._goals))

    def eligible(self, goal_id: str, age: int, context: str) -> bool:
        m = self.get(goal_id).metadata
        return (
            type(age) is int
            and 3 <= age <= 13
            and context in CONTEXTS
            and m["age_min"] <= age <= m["age_max"]
            and context in m["contexts"]
            and m["available_by_default"] is True
            and m["catalog_version"] == self.version
            and m["language"] == "en"
            and m["intent_class"] in CHILD_INTENTS
        )


def _resolve_goal(
    conn, repository: CatalogRepository, goal_id: str, age: int, context: str, *, require_existing: bool
) -> CatalogGoal:
    try:
        goal = repository.get(goal_id)
    except CatalogError as exc:
        raise HTTPException(404, "Source goal not found") from exc
    if not repository.eligible(goal_id, age, context):
        raise HTTPException(403, "This source goal does not fit the child's age and setting")
    row = conn.execute(
        "SELECT g.id,g.title,g.description,g.keywords,g.is_active,s.source_id,s.concept_id,"
        "s.category_id,s.catalog_version,s.record_sha256,s.snapshot_id FROM hq.goals g"
        " LEFT JOIN hq.catalog_goal_sources s ON s.goal_id=g.id WHERE g.id=%s",
        (goal_id,),
    ).fetchone()
    if row is None:
        if require_existing:
            raise HTTPException(404, "Generate a reviewed Coach goal recommendation before creating habits")
        return goal
    if not row["is_active"]:
        raise HTTPException(404, "This source goal is retired")
    expected = {"title": goal.title, "description": goal.description, **goal.source_ref}
    if any(row[key] != value for key, value in expected.items()):
        raise HTTPException(409, "Source goal conflicts with its pinned canonical release")
    return goal


def resolve_goal(conn, repository: CatalogRepository, goal_id: str, age: int, context: str) -> CatalogGoal:
    """Read canonical source without importing it; validate any existing mapping and retirement."""
    return _resolve_goal(conn, repository, goal_id, age, context, require_existing=False)


def require_goal(conn, repository: CatalogRepository, goal_id: str, age: int, context: str) -> CatalogGoal:
    """Only materialized, active and unchanged Coach goals can create or accept habit drafts."""
    return _resolve_goal(conn, repository, goal_id, age, context, require_existing=True)


def materialize_goal(
    conn, repository: CatalogRepository, goal_id: str, age: int, context: str, *, child_id: UUID
) -> CatalogGoal:
    """Atomically save one reviewed Coach selection inside the caller's transaction.

    The database verifies ownership and the canonical payload against a pinned
    hash allowlist. Runtime roles have no arbitrary global catalog write grant.
    """
    goal = resolve_goal(conn, repository, goal_id, age, context)
    canonical = json.dumps(
        goal.record, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )
    try:
        conn.execute(
            "SELECT hq.materialize_catalog_goal(%s,%s,%s,%s,%s)", (child_id, goal_id, age, context, canonical)
        )
    except psycopg.errors.RaiseException as exc:
        code = exc.diag.message_primary or ""
        status = 404 if code == "catalog_not_authorized" else 403 if code == "catalog_ineligible" else 409
        raise HTTPException(status, "The source goal or child context changed; please try again") from exc
    return goal


def routes(settings: Settings) -> APIRouter:
    api = APIRouter()
    User = Annotated[UUID, Depends(signed_in(settings))]

    @api.get("/v1/children/{child_id}/goals/{goal_id}/source", tags=["Catalog"], summary="Read a source goal")
    def source_goal(child_id: UUID, goal_id: str, user: User, setting: Setting) -> dict:
        """Read a canonical goal's instructions and research limits for an eligible child and setting.

        This parent-only reader does not call retrieval or a model and never changes the child's plan.
        """
        with transaction(settings, user) as conn:
            child = one(conn, "SELECT age FROM hq.children WHERE id=%s", (child_id,))
            return resolve_goal(conn, CatalogRepository(), goal_id, child["age"], setting).detail()

    return api

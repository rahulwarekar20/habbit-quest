"""Print safe effective AI routing and optionally check the existing Pinecone target.

Default is offline: no model call, database operation or network request. Pass
--verify-target for two read-only Pinecone requests, without embeddings or generation.
Run from backend/ so Settings reads its private .env.
"""

import argparse
import json
from time import monotonic

from habitquest_backend.config import Settings
from habitquest_backend.llm import role_model_info
from habitquest_backend.planning_catalog import CatalogRepository
from habitquest_backend.retrieval import CatalogRetriever, RetrievalError


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-target", action="store_true")
    args = parser.parse_args()
    settings = Settings()
    repository = CatalogRepository()
    report = {
        "ai_mode": settings.ai_mode,
        "coach_engine": settings.coach_engine,
        "retrieval_mode": settings.retrieval_mode,
        "habit_generation_enabled": settings.habit_generation_enabled,
        "refined_coach_model_roles": ["coach", "output_safety"],
        "habit_generation_model_roles": ["habit_generation"],
        "parent_risk_role_scope": "legacy workflows only; no refined Coach or habit-generation call",
        "roles": [
            role_model_info(settings, role)
            for role in ("parent_risk", "coach", "output_safety", "habit_generation")
        ],
        "credential_presence": {
            "legacy": bool(settings.openai_api_key),
            "planning_openai": bool(settings.planning_openai_api_key),
            "pinecone": bool(settings.pinecone_api_key),
        },
        "embedding": {
            "model": settings.openai_embedding_model,
            "dimensions": settings.openai_embedding_dimensions,
            "provider_group": "planning_openai",
        },
        "catalog": {"version": repository.version, "records": len(repository.all()), "pinned": True},
        "planning_budget_enabled": settings.planning_budget_enabled,
        "pinecone_target": "not_checked",
    }
    if args.verify_target:
        try:
            CatalogRetriever(settings, repository).verify_target(deadline=monotonic() + 30)
            report["pinecone_target"] = "verified"
        except RetrievalError as exc:
            report["pinecone_target"] = str(exc)
            print(json.dumps(report, indent=2))
            raise SystemExit(1) from None
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

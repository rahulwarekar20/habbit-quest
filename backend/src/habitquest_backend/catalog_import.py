"""Optional explicit owner import of named goals; reviewed Coach selection is the normal path."""

from habitquest_backend.planning_catalog import CHILD_INTENTS, CatalogError, CatalogRepository


def import_catalog(
    conn, repository: CatalogRepository, *, goal_ids: list[str], apply: bool = False
) -> dict[str, int]:
    """Validate an explicit selection before writing; identical reruns have no side effects.

    The caller owns the transaction. Per-goal advisory locks also serialize runtime materialization.
    Changed source content or a colliding legacy goal is never silently overwritten.
    """
    if not goal_ids:
        raise CatalogError("import_requires_explicit_goal_selection")
    selected = [repository.get(ident) for ident in sorted(set(goal_ids))]
    if any(
        goal.metadata["intent_class"] not in CHILD_INTENTS or not goal.metadata["available_by_default"]
        for goal in selected
    ):
        raise CatalogError("import_ineligible_source")
    for goal in selected:
        conn.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended('hq.source-goal:'||%s,0))", (goal.goal_id,)
        )
    existing = {
        row["id"]: row
        for row in conn.execute(
            "SELECT g.id,g.title,g.description,g.is_active,s.source_id,s.concept_id,s.category_id,"
            "s.catalog_version,s.record_sha256,s.snapshot_id FROM hq.goals g"
            " LEFT JOIN hq.catalog_goal_sources s ON s.goal_id=g.id"
        ).fetchall()
    }
    sources = {row["source_id"]: row["id"] for row in existing.values() if row["source_id"]}
    pending = []
    unchanged = 0
    for goal in selected:
        previous = existing.get(goal.goal_id)
        if goal.source_id in sources and sources[goal.source_id] != goal.goal_id:
            raise CatalogError("import_source_id_collision")
        if previous:
            if not previous["is_active"]:
                raise CatalogError("import_retired_goal")
            expected = {"title": goal.title, "description": goal.description, **goal.source_ref}
            if any(previous[key] != value for key, value in expected.items()):
                raise CatalogError("import_would_overwrite_existing_goal")
            unchanged += 1
        else:
            pending.append(goal)
    if apply:
        for goal in pending:
            conn.execute(
                "INSERT INTO hq.goals(id,title,description,keywords) VALUES(%s,%s,%s,%s)",
                (goal.goal_id, goal.title, goal.description, goal.record["retrieval"]["search_terms"]),
            )
            ref = goal.source_ref
            conn.execute(
                "INSERT INTO hq.catalog_goal_sources(goal_id,source_id,concept_id,category_id,"
                "catalog_version,record_sha256,snapshot_id) VALUES(%s,%s,%s,%s,%s,%s,%s)",
                (
                    goal.goal_id,
                    *(
                        ref[k]
                        for k in (
                            "source_id",
                            "concept_id",
                            "category_id",
                            "catalog_version",
                            "record_sha256",
                            "snapshot_id",
                        )
                    ),
                ),
            )
    return {"new": len(pending), "unchanged": unchanged}

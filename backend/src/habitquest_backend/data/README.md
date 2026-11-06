# Pinned planning catalog

`planning_catalog.json` is a deterministic projection of the planning-agent's verified source release. It contains all 381 canonical age-variant cards (96 concepts, 24 categories), their original hashes, retrieval predicates and embedding text. It omits the 512-dimensional vectors, asset paths, buddies and stacks. The canonical records themselves are unchanged, so source card hashes still match Pinecone.

| Identity | Value |
| --- | --- |
| Catalog release | `0.1.0` |
| Source snapshot | `22cec20089fee49e76ee76861b01a199e05f765ec19a2f1911eddef1088828df` |
| Original manifest SHA-256 | `e2bebd5d66057f896f0177d139e5769e2108d63444ac1485c6b8e8bba7e60d47` |
| Packaged file SHA-256 | `34f992f03e71dcbf5290bc71c017e0b85765a645402600b0c531594d86c83b33` |
| Index / namespace | `hq-habits-v1` / `habits-0-1-0` |
| Embedding contract | `text-embedding-3-small`, 512 dimensions, cosine |
| Source implementation | `hq-ai-services/planning-agent/src/hq_planner` catalog repository, retrieval filters/pipeline, ranker and evidence builder |

Runtime imports require no sibling repository. `CatalogRepository` verifies the packaged bytes, original card hashes, text hashes and consistency of age/context/release metadata. Returned records are defensive copies. The stable application goal ID is `hqg-` followed by the first 24 hex digits of SHA-256 of the original source card ID. The original long ID and age variant are retained in provenance. No source card reward fields appear in app goals, reader output, Coach evidence or generated-habit evidence.

There are 377 eligible child-use cards. Four `parent_coaching` cards remain in the canonical artifact for integrity, but are excluded from child goals and retrieval. These are research-grounded editorial drafts with product efficacy not established; the source reader preserves those limits and clinical-review status.

Normal setup does **not** import this catalog into application goal tables. Retrieval and source browsing remain read-only. After a Coach response passes Safety, only the goals it selected are materialized in the same transaction as the reviewed recommendation. Explicit habit generation requires one of those materialized goals; it does not create a goal merely because a source card was opened.

Migration005 adds a restricted database function with a pinned goal-ID-to-canonical-hash allowlist. This is integrity metadata, not prefilled goal rows. The function checks child ownership, current age/setting and the hash of the supplied canonical record before deriving the goal fields itself. Same-goal advisory locks make concurrent selection idempotent. Existing retired, colliding or changed-source records are rejected; runtime roles receive no arbitrary global-goal write permission.

The optional owner maintenance CLI requires an explicit allowlist, for example `python scripts/import_planning_catalog.py --goal-id hqg-...` to preview that goal, adding `--apply` for an additive owner transaction. Repeat `--goal-id` only for other deliberately selected goals. There is no default or all-catalog import mode. It keeps legacy goals and rejects retirement, source changes and collisions before any insertion. This CLI is not part of application startup.

To reproduce the artifact from the original local release, run:

```bash
python scripts/package_planning_catalog.py /path/to/pinecone-data-updates/datasets/current.json
```

That script verifies the original manifest and every source file before projection, including original embedding dimensions and vector validity. This is a build-time maintenance operation, never a runtime dependency. A new release needs explicit review of the artifact, pinned hashes and import/migration policy; silently replacing the current release is unsupported.

Pinecone retrieval makes one masked-query embedding and one Documents search. It checks returned IDs, original hashes, metadata types/values, embedding contract and current age/setting eligibility locally, then preserves retrieval order while limiting to six distinct concepts. Source cards become goal recommendations. Generated actions are a separate explicit operation. `fixture` mode provides deterministic local BM25 ranking for offline tests; live failures never silently switch to fixture results. An explicit `CatalogRetriever.verify_target()` preflight checks index readiness/schema/tags and namespace count without changing cloud resources; this is not part of each Coach request.

# Figure 04 — From research to a reusable habit catalog

Reviewed 6 November 2026. **No dates appear in the artwork.** This figure is the first of the expanded two-slide AI story. It explains the recorded offline catalog creation and publication process; the second slide explains live family workflows.

## Viewer question

Where did the initial goal/habit knowledge come from, how was it checked and published, and how does the application reuse it without inventing the source catalog during each chat?

The user's “one-time database creation” maps to initial authoring and publication of a reusable, versioned public source catalog. It is not bulk population of every family's PostgreSQL goals or pre-generation of all child-specific habits. Later catalog revisions create new preserved releases rather than requiring research on each Coach request.

## Verified content and relationships

| Stage | Recorded behavior and boundary |
| --- | --- |
| Evidence foundation | HQ Research's structured, purposive literature work plus catalog gap reviews produced an assembled registry of 89 evidence/guidance records, with six framework books separate. Records retain source links, populations, age transfer, supports and limitations. This is not 89 independent trials, a systematic review, or a clinical endorsement. |
| Editorial authoring | Three authoring tracks create 96 concepts in 24 categories. Four editorial age bands are 3–5, 6–8, 9–10 and 11–13. Cards distinguish child action, caregiver setup/coaching, adaptations, easier versions, exclusions, accessible support, research relationships and prepared search wording. Three concepts deliberately omit the preschool variant, yielding 381 age-specific canonical cards. |
| Review and build | Cross-review corrects role confusion, overlapping demands, consent/access language and overstated evidence transfer. `rebuild.py` locally runs catalog, stack, schema and validation builders in dependency order without network/database calls. Validation checks schema, IDs, age/context/duration bounds, evidence links, record/search hashes and projection parity. Existing lexical smoke checks are not semantic benchmarks or proof of child outcomes. |
| Embedding and preservation | Validated prepared card search text is embedded with actual OpenAI `text-embedding-3-small` output at 512 dimensions in six batches. A complete frozen archive, including vectors and exact upload payload, is saved and read back before Pinecone creation/upload. No paper/PDF chunking service is involved. |
| Publication | Six batches upload the exact archived documents. All 381 IDs, text, metadata, source/art references and stored vectors are fetched and verified. A vector-free canonical JSON package, verified from the archived manifest, supplies complete source guidance to the application. Pinecone supplies candidate identities; it is not the authoritative source of full guidance or family state. |
| Runtime handoff | Masked query → filtered semantic lookup → local identity/hash/canonical eligibility checks. A reviewed selected catalog card maps to an app goal; generated actions map to child-specific habits beneath it. Only selected reviewed goals enter PostgreSQL. Parent acceptance governs assignments. The runtime slide expands this handoff and the separate Planner/Review agents. |

The 381 records include general-wellbeing, targeted-support and four parent-coaching records. Runtime child-goal filters exclude parent-coaching intent. The source catalog's stacking recipes and reward policies are not automatic app assignments or imported child reward rules.

## Composition

Landscape 16:9, matching the existing hand-drawn white-paper, dark navy ink, indigo/blue headings and soft lavender washes. Use a clearly labeled large **Offline catalog creation** area and a smaller bottom **Runtime reuse** handoff. One dominant left-to-right story across five numbered semantic scenes:

1. Evidence books/papers with highlighted source details.
2. An editorial desk turning evidence into age-band cards with a child action and caregiver support.
3. Cross-review clipboard and local validation sieve producing a canonical card stack.
4. Search-text booklet → vector dots → frozen archive; archive branches to a Pinecone cylinder and a pinned canonical-guidance folder. The archive must precede publication.
5. Runtime uses both published branches, then shows reviewed goal → generated habit → parent approval → plan.

If five scenes become crowded, use three scenes across the top and the publication/handoff across the bottom, with a clear continuation arrow. Avoid tiny type, dense schema fields, invented model-authoring calls, and a visual that makes every source card flow directly into a child's plan.

## Exact visible copy

Use only the following short labels. Exact long model IDs may use clean technical lettering. Review/provenance dates belong only in this companion.

```text
From research to a reusable habit catalog
AI pipeline · 1 of 2

Offline catalog creation
1  Research foundation
89 evidence / guidance records
6 framework books
Sources · populations · limits

2  Editorial authoring
96 concepts · 24 categories
Ages 3–5 / 6–8 / 9–10 / 11–13
Practice templates + caregiver support
Adaptations · exclusions · research links

3  Cross-review + local validation
Schema · age/context · sources · hashes
381 canonical age-specific cards

4  Publish a versioned release
Prepared search text
text-embedding-3-small · 512 dimensions
Freeze full snapshot before upload
Pinecone vector database: 381 records
Pinned canonical JSON: full guidance
Reusable RAG knowledge base
Verify every published record

5  Runtime reuse
Masked query → search + canonical checks
Reviewed source card → goal
Generated action → habit
Parent accepts → child plan
Only selected goals enter PostgreSQL

Create once; reuse across Coach requests.
Research informs design; it does not prove app effectiveness.
```

“Create once” means the initial versioned catalog setup, not an assertion that the catalog can never be maintained. Source changes produce a new preserved release.

## What the figure must not imply

- No live literature search, fresh research agent or corpus re-embedding on every parent request.
- No fully automated research service or claim all original papers were available in full text.
- No unsupported single authoring-model ID, hidden inference count or measured authoring latency.
- No universal safety certification or proven clinical efficacy for exact cards, generated actions or the app.
- No direct 381-card import into family PostgreSQL and no automatic child assignment.
- No raw family/child data in the public source corpus or Pinecone catalog.
- No pre-generated personalized habit database: authored practice guidance is reused, while actual child-specific action choices are generated later.

## Sources

- [Current catalog design](../../../habbit-quest/docs-design/10-habit-research-and-pinecone-catalog.md)
- [Embedding selection and experiment distinctions](../../../habbit-quest/docs-design/09-embedding-model-selection.md)
- [HQ Research methodology](../../../hq-research/methodology.md)
- [Catalog evidence methodology](../../../hq-habits-catalog/docs/evidence-and-methodology.md)
- [Cross-review resolution](../../../hq-habits-catalog/research/cross-review-resolution.md)
- [Canonical rebuild script](../../../hq-habits-catalog/scripts/rebuild.py)
- [Catalog validation report](../../../hq-habits-catalog/validation/REPORT.md)
- [Recorded Pinecone publication results](../../../hq-infra-setup/pinecone-data-updates/RESULTS.md)
- [Application catalog packaging](../../../habbit-quest/backend/scripts/package_planning_catalog.py)

## Caption and alt text

**Caption:** HabitQuest's reusable source catalog is authored offline from evidence and editorial guidance, adapted into age-specific practice cards, cross-reviewed and locally validated. Prepared search text is embedded, archived and published to Pinecone; full canonical guidance is separately packaged with the API. Live Coach requests reuse this release. Only reviewed selected cards become family goals, and generated action choices require parent acceptance before becoming assigned habits. Counts describe source records and editorial cards, not independent trials or demonstrated app effectiveness.

**Alt text:** Papers and books feed an editorial desk that creates 96 concepts across 24 categories and four age bands. Review and validation produce 381 canonical cards. Prepared search text becomes 512-dimensional vectors, stored in a frozen archive before publication. The archive supplies a Pinecone search index and a pinned canonical-guidance folder. A masked runtime query uses both; reviewed source cards become goals, generated actions become habits, and a parent accepts habits into the child's plan.

## Export QA

Confirm no dates, accurate model/dimensions/counts, the archive-before-upload order, the two distinct published branches and their runtime convergence. Verify parent acceptance is on the assignment path and no arrow bulk-loads all source cards into PostgreSQL. Confirm the efficacy qualification remains readable and the publication process is not shown as a live Coach stage.

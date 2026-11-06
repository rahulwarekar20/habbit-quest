# Figure 02 — HabitQuest AI pipeline

Status: **implemented design reviewed 6 November 2026**. The prior HQ AI Services illustrations supply visual style only; their Deep Agents prototype architecture is historical.

## Viewer question

What actually happens between a parent sending a concern, seeing researched goal cards, and adding useful habits to a child's plan—and where do model calls, local checks and human approval occur?

The illustration must make clear that retrieval is deterministic application orchestration around an embedding request and a Pinecone lookup, while the active Coach is a finite five-node LangGraph with two model-backed roles. Generating habits is a subsequent separate operation. Quest Planner and Weekly Review are separate explicitly initiated workflows.

## Sources

- [AI orchestration and safety boundaries](../../../habbit-quest/docs-design/05-ai-orchestration.md): graph nodes, call bounds, urgent routing, output-Safety boundary and failure behavior.
- [Coach and habit generation](../../../habbit-quest/docs-design/06-habit-coach-and-habit-generation.md): request authorization, automatic batches, persistence and parent acceptance.
- [Planner, review and other AI](../../../habbit-quest/docs-design/07-planner-review-and-other-ai.md): separate report workflow and its current local-review boundary.
- [Model selection and routing](../../../habbit-quest/docs-design/08-model-selection-and-runtime-routing.md): exact current provider/model assignments and logical-call distinction.
- [Habit research and Pinecone](../../../habbit-quest/docs-design/10-habit-research-and-pinecone-catalog.md): canonical release, retrieval, hydration and lazy materialization.

These checked local design documents are the evidence for the diagram. No new model benchmark or live cloud/provider test is performed for this illustration.

## Composition

One detailed landscape poster, preferably **3:2**, with three spacious horizontal illustrated bands and one small independent report-workflow rail. Target a large export and inspect native dimensions; do not promise native 4K. Reading order is left to right within each band, then down along one clearly marked continuation arrow. Use white paper, navy ink, indigo/blue headings, restrained purple, pale blue/lavender washes, hand-drawn document/book/filter/robot/reviewer objects. The graph's outline is the orchestration boundary, not a separate deployed service.

1. **Scope and retrieve:** parent request → authorization/context → local urgent branch → masking → embedding → Pinecone → pinned evidence. A canonical book supplies hydration; an SQL cylinder supplies authorized facts.
2. **Refined Coach:** visible five-node graph, bounded revision loop, and a distinct fixed-failure branch. Reviewed text and ordered goals leave the graph; only reviewed selected goals are materialized in PostgreSQL.
3. **Habits:** goal cards trigger separate bounded writer batches → local validation/correction → parent review → exact goal-linked plan assignment. A separate explicitly triggered report rail must not look like part of the Coach sequence.

Use arrow labels and shape distinctions, not color alone. Code steps are small illustrated tools/filter/booklets; model-backed steps have a small robot; parent approval has a human with a clipboard. All essential text must remain readable at the actual export size. If generated copy is too dense, preserve the full contract and provide a large detailed companion rather than silently omitting stages.

## Required semantics and arrow inventory

| Mechanism | Required relationship and limits |
| --- | --- |
| Authorization | The backend checks the parent/family/child scope and reads authorized plan, conversation and deterministic progress facts. No direct browser-to-Pinecone path. |
| Urgent route | A **local recognized-risk phrase check before retrieval** may return fixed support guidance. It is not a clinical assessment or model Safety call. The normal route continues to masking. |
| Masking | Code replaces known child/caregiver names and common email/phone formats before external retrieval. It is not comprehensive PII recognition and is not a model call. |
| Embedding | One OpenAI `text-embedding-3-small` query embedding, actual `dimensions=512`. This is a real provider call even though it is not a chat-model call. |
| Search | One Pinecone Documents similarity search over the published 381-card catalog; filters include age, setting, release, availability, language and child intent. Up to 12 raw candidates. Index `hq-habits-v1`, namespace `habits-0-1-0`, canonical release `0.1.0`. The long identifiers belong in this companion rather than tiny image text. |
| Canonical hydration | Verify returned identities, hashes and metadata against the pinned local vector-free canonical snapshot; hydrate researched guidance and evidence; retain at most six distinct eligible concepts. No live web research, model reranker, model summary, whole-catalog Safety call or goal import during lookup. |
| Graph | `prepare → generate → safety → decide → finalize`. `prepare`, `decide`, and `finalize` are code. `generate` uses the Luna writer. `safety` reviews newly generated conversational prose, questions and explanations. Existing canonical catalog material is context, not a new subject of Safety review. |
| Revision | `decide → generate` only after the first Safety rejection. A second generation and Safety review are the only application-level rejected-text revision. Approved, unavailable or exhausted results go to `finalize`; malformed/unavailable generation and preparation failure may reach finalization directly. No loop arrow from finalization to retrieval. |
| Call accounting | Normal Coach graph: **2 logical chat calls**; one Safety revision: **4 total**. SDK retries are separate HTTP attempts. Embedding/search and subsequent habit batches are additional operations. Do not label the entire interaction “one call.” |
| Fail closed | Unapproved, malformed or unavailable output does not become displayed model prose or a plan change. Finalization returns reviewed output or fixed failure. |
| Goal persistence | Fresh ownership/eligibility/fingerprint checks precede atomic persistence. Only selected reviewed source cards become local goals. Preserve order, provenance and habit-preparation slots. No bulk preload of all catalog goals. |
| Habit batch | The explicit Send authorizes preparation of **3 choices per new eligible goal**, up to **4 goals**, **2 batches in flight**. Usable saved batches can be reused. No passive page-load/hover generation. |
| Habit writer | Separate OpenAI Luna structured call using the goal's canonical evidence, age, setting, masked instruction and prior actions. No repeated retrieval or Quest Planner. **1 call per batch**, at most **1 correction** after failed local validation. |
| Habit checks | Code checks schema/count, source, age-related wording, duration, privacy and novelty. No extra whole-habit Safety model. Invalid/unavailable results preserve older useful choices. |
| Human acceptance | Parent previews, chooses schedule and accepts; atomic checks preserve exact goal → habit → child assignment. Never auto-assign a generated habit. |
| Separate reports | Explicit Quest Planner / Weekly Review → scoped SQL facts and child labels → **1 structured Nebius DeepSeek call each** → local proposal validation → parent decision. These do not call the Coach graph or retrieval and currently do not use its separate prose Safety model. |
| Observability | Stage events and measured elapsed time are streamed; reviewed final results are returned. This is not raw unreviewed token streaming. Attempts, usage and costs are recorded separately from private prompt/response bodies. No guaranteed five-second latency claim. |

## Exact visible copy

The paired prompt contains the exact short visible labels. The visible status ribbon must read **Implemented design**, with no implementation or review date anywhere in the illustration. Dates in this source contract are internal review/provenance metadata only. The copy is intentionally compact; this companion carries the detailed filters, caveats and source links. Model identifiers must be spelled exactly:

- OpenAI Coach + habit writer: `gpt-6-luna` via Responses API.
- Nebius Coach Safety + report calls: `deepseek-ai/DeepSeek-V4.1-Flash-1017` via Chat Completions.
- OpenAI query embedding: `text-embedding-3-small` at 512 dimensions.

## Caption

**Implemented HabitQuest AI pipeline, reviewed 6 November 2026.** A scoped parent request is locally checked and name/contact-masked before one embedding and one filtered Pinecone lookup. Pinned canonical records provide researched evidence to a five-node LangGraph: two normal chat calls generate and review new Coach prose, with one bounded revision. Reviewed source cards are saved as goals; separate writer batches prepare three habit choices per new goal, with local validation and parent acceptance before assignment. Quest Planner and Weekly Review are separate explicit workflows. Arrows describe application operations, not guaranteed response times; SDK retries and habit batches add provider work beyond the Coach call count.

## Alt text

Three-band illustrated workflow. At the top, an authorized parent request branches to fixed urgent support or passes through local name/contact masking, a 512-dimensional OpenAI embedding, Pinecone filtering, and verified canonical evidence hydration. In the middle, a LangGraph boundary contains prepare, generate, safety, decide and finalize, with one rejection-driven revision and a fixed-failure path. Only new Coach prose receives the separate model Safety review; selected reviewed catalog cards become saved goals. At the bottom, separate Luna writer batches create three habit choices per goal, local checks allow one correction, and a parent approves an exact goal-linked plan assignment. A disconnected side rail shows explicit Planner and Weekly Review calls with local checks. Provider roles and stage/cost observability are labeled.

## QA traps

- Do not reuse the previous illustration's Deep Agents harness, middleware, checkpoint, autonomous tool loop or model-research labels.
- Do not place retrieval inside the five-node graph or equate five nodes with five chat calls.
- Do not imply masking catches every personal identifier, or urgent phrases are exhaustive safety triage.
- Do not label curated catalog validation as model Safety; do not omit new-prose Safety.
- Do not connect an embedding robot directly to final goal text without Pinecone and canonical hydration.
- Do not connect all 381 cards directly into local goal persistence.
- Do not imply Planner/Review are Coach stages or use the Coach's prose Safety model.
- Do not imply automatically prepared drafts are automatically added to a child.
- Do not promise 3–4 goals when fewer relevant eligible concepts are found: the request aims for that count, with a maximum of four.
- Four new goals normally mean **six chat calls across five operations**, plus embedding/search: two Coach calls and four batch writers.

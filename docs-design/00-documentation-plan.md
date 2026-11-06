# Documentation plan and coverage

Snapshot: November 6, 2026. This plan produces a consolidated description of the
implemented application, its research process and its verified AWS deployment.
It is documentation work, not a proposal to rebuild the application.

## Outcome and information hierarchy

The main repository now has two complementary documentation folders:

- `docs-design/`: the current design, organized by capability, with a linked
  summary, diagrams, decisions, boundaries and evidence.
- `docs-detailed/`: the former top-level `docs/`, preserving investigations,
  alternative proposals, benchmarks, implementation histories and visual evidence.

`backend/docs/` remains where it was. Sibling repositories/folders keep their own
source material: research in `hq-research`, catalog artifacts in
`hq-habits-catalog`, provider/index preparation in `hq-infra-setup`, the imported
planner in `hq-ai-services`, and deployment scripts/evidence in `hq-deployment`.
The new documents link to those sources rather than copying secrets or duplicating
all historical evidence.

When records disagree, use this order:

1. Current implementation and explicit owner decisions for application behavior.
2. Latest completed release configuration and verification for deployed behavior.
3. Reproducible research outputs for measured comparison results.
4. Dated implementation records for the rationale and sequence of decisions.
5. Earlier proposals as historical alternatives, never as proof of deployment.

The base git commit alone does not describe this snapshot: the `nkaul` working
tree contains the accumulated implementation. Release source fingerprints and
immutable image digests identify the verified cloud release.

## Work sequence

| Phase | Work | Completion criterion |
| --- | --- | --- |
| 1. Inventory and preservation | Locate current source, research, operations and deployment evidence; record existing documentation hashes | All 209 original files present after rename; binary evidence unchanged |
| 2. Folder migration | Rename only main-repo `docs` to `docs-detailed`; create `docs-design` | No second copy or lost history; backend documentation remains intact |
| 3. Parallel surveys | Separate app/data/security, AI/models, and research/embedding reviews; coordinating review covers deployment, economics and overview | Every capability has an owner and implementation evidence |
| 4. Capability documents | Write the documents below, including diagrams and explicit limits | Documents describe implemented behavior, not just file lists or future plans |
| 5. Integration | Write README summaries and decision history; reconcile terminology, model names and call counts across reviews | One consistent account of goal → habit → assignment and research → retrieval |
| 6. Navigation repair | Update entry points, relative links and evidence-generation paths affected by the rename | No active reference still points into the removed top-level folder |
| 7. Validation | Check local links, diagrams, document structure, preservation and source consistency | Verification record identifies checks and any limits without rerunning AI or deployment |

These phases were completed as part of the owner's request to collect,
summarize and create the documents now. The [verification record](verification.json)
records 16 Markdown documents, 312 source/cross-document links, 22 structurally
reviewed diagrams and preservation of all 209 original files. No application
implementation or deployment was required.

## Document-by-document plan

| Document | Questions it answers | Evidence and review stream |
| --- | --- | --- |
| [README](README.md) | What is the whole system, what decisions shaped it, and where should each reader go next? | Integrated summaries from all streams |
| [01 System overview](01-system-overview.md) | Which systems exist, which data belongs where, and how does a family use them? | Main frontend/backend and current deployment |
| [02 Frontend experience](02-frontend-experience.md) | What are the parent/kid/admin journeys, view states and synchronization rules? | React pages, components, API client, screen tests |
| [03 Backend API and security](03-backend-api-and-security.md) | How do identity, requests, authorization and persistence work? | FastAPI routers, auth, DB transaction helpers and isolation tests |
| [04 Database and domain model](04-database-and-domain-model.md) | How do families, goals, drafts, habits, assignments, completion and accounting relate? | 22 migrations, SQL policies, domain modules and schema tests |
| [05 AI orchestration](05-ai-orchestration.md) | What LangChain/LangGraph runs, how many model calls occur, and where are checks applied? | Refined graph, adapters, context, retrieval and safety code |
| [06 Habit Coach and habit generation](06-habit-coach-and-habit-generation.md) | How do recommendations become three choices and then an approved child plan? | Coach, draft endpoints, goal workbench, accounting regression |
| [07 Planner, review and other AI](07-planner-review-and-other-ai.md) | What runs outside Coach, what is deterministic, and what needs parent approval? | Insights, onboarding, check-ins, safety, buddy paths |
| [08 Model selection and routing](08-model-selection-and-runtime-routing.md) | Which model serves each role, why, and what remains an unproven performance assumption? | Resolver, public deployment configuration and dated model reviews |
| [09 Embedding model selection](09-embedding-model-selection.md) | What was compared and why was small/512 selected despite other quality results? | HQ research, evaluation harness/results and index contract |
| [10 Habit research and Pinecone catalog](10-habit-research-and-pinecone-catalog.md) | How did evidence become age-specific cards, vectors and runtime goals? | Research/catalog artifacts, validation, ingestion and main-app canonical mapping |
| [11 Tokenomics, latency and observability](11-tokenomics-latency-and-observability.md) | What costs money, how are credits settled, and what does each timer measure? | Durable operation/attempt ledger, UI controls and dated synthetic benchmarks |
| [12 Buddies, artwork and assets](12-buddies-artwork-and-assets.md) | How are companions chosen locally, dressed and displayed from catalog artwork? | Buddy metadata, anchors, selection guards, art manifests and S3 evidence |
| [13 AWS deployment](13-aws-deployment.md) | What is actually deployed, how does traffic flow, and how is release/rollback repeated? | CloudFormation, Docker, scripts, public configuration and release receipts |
| [14 Validation and design decisions](14-validation-and-design-decisions.md) | How did the design evolve, what was verified, and what is still limited? | Cross-stream source comparison and latest verification records |

## Writing contract

Each capability document provides a plain-language purpose, current components,
workflow or data model, important decisions, failure/ownership boundaries and
direct links to implementation or recorded evidence. Mermaid diagrams describe
actual paths. Tables compare roles or states without hiding important exceptions.

Use **goal** for a canonical researched card, **habit** for a generated bounded
action, and **assignment** for a child's scheduled plan entry. Distinguish the
research/planning prototype from the integrated application. Distinguish a graph
node, a logical model call, an HTTP retry and an independent user operation.

Clearly label snapshot dates, measured samples, planning assumptions, configured
values and known gaps. Do not turn the five-second latency objective, a provider
catalog throughput number or a synthetic test into a production guarantee.

## Review checklist

- Frontend, backend, data, rewards, companions, identity and operator surfaces are covered.
- All AI entry points are accounted for; deterministic paths do not acquire fictional model calls.
- The normal two-chat-call Coach, separate bounded habit writer and explicit planner/review are consistent.
- Embedding choice includes the measured quality/cost tradeoff and fixed index dimension.
- Research evidence and limitations survive through catalog → goal → approved habit details.
- Retrieval, PostgreSQL, vector index and asset storage have distinct ownership.
- Tokenomics includes embedding and search costs and separates credits from provider spend.
- AWS is described as two public ALBs with public-IP Fargate tasks restricted by security groups, plus private RDS.
- No credentials, private family content, generated personal conversations or private environment payloads are copied.
- No application behavior, provider setting, schema, running service or cloud resource is changed by this documentation task.

The sole source-file adjustments associated with the rename are documentation
references and browser-test evidence output paths. They do not alter the application.

## Maintenance

For a future feature, update its capability document and the README summary in
the same change. Add a dated design decision when the rationale changes. Put long
investigations and benchmark artifacts in `docs-detailed`, and keep AWS execution
receipts in `hq-deployment`. Link both from the current design. Do not rewrite old
results to look like new measurements or replace frozen deployment receipts.

See [validation and decisions](14-validation-and-design-decisions.md) for the
completed documentation checks and the application verification baseline.

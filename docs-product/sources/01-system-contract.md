# Figure 01 — HabitQuest system architecture

**Status:** implemented design as documented on November 6, 2026. This is an overview of the current main application, not the earlier standalone planning-agent proposal. Image generation and export QA are recorded separately by the parent illustration task.

## Viewer question

How does HabitQuest connect a family's concern, researched recommendations, a parent-approved child plan, and the daily reward loop—and which components own each decision?

## Composition

Use a wide 16:9 paper-and-marker illustration with a dominant left-to-right product journey. A React browser with parent and child tabs is on the left. A central FastAPI workbench is fed by a research shelf above and anchored to a PostgreSQL filing cabinet below. To its right, an illustrated goal card fans into three small habit cards, then passes through a human approval clipboard into a child's quest board. This is a product flow, not a network-topology drawing.

Inside the API workbench, show a small bounded AI robot with a structured-output sheet and a safety clipboard; place a separate, smaller pair of booklets for explicit Quest Planner / Weekly Review requests. Do not surround every noun with a box. Retain whitespace and clear connector endpoints.

Two small supporting objects complete the picture: an artwork palette next to the browser and an operator receipt near the backend. Keep the detailed model-call graph and AWS topology for Figures 02 and 03.

## Visible text inventory

Use these strings verbatim. No invented examples, child names, model IDs or performance claims. This is 125 whitespace-delimited visible words; technical qualifications below belong in the companion, not tiny image footnotes. Implementation dates belong in internal provenance, not on the illustration.

| Region | Exact visible text |
| --- | --- |
| Heading | HabitQuest system architecture |
| Status ribbon | Implemented design |
| Browser | React + Vite; Parent & child experiences |
| Identity badge | Google sign-in; API verifies identity |
| Browser/API arrow | HTTPS requests + stage updates |
| Backend | FastAPI; Identity • family rules • validation |
| Research shelf | Research & catalog authoring; Offline publication |
| Source artifacts | Canonical cards + evidence; Pinecone semantic index; Pinned catalog snapshot |
| AI workbench | Bounded AI workflows; LangGraph + LangChain; Retrieve → generate → check; OpenAI + Nebius |
| Separate helper booklets | Quest Planner + Weekly Review; Explicit requests |
| Returned artifact | Researched goal; 3 habit choices |
| Human gate | Parent chooses & approves |
| Quest board | Child's scheduled quests; Submit → parent approval; Sparks, points & rewards |
| Store | PostgreSQL; Families • plans • progress • accounting |
| Artwork palette | Bundled goal art + icons; S3 buddy images; Buddy selection: local rules |
| Operator receipt | /admin · Tokenomics; Usage • latency • cost • credits |
| Footer | AI proposes. Parents decide. PostgreSQL preserves the accepted plan. |

## Relationship contract

1. **Browser ↔ FastAPI:** the browser calls the API directly; requests/results and stage updates cross this connection. The browser is not an authoritative source for plan ownership, rewards or balances. The frontend container is not an API proxy.
2. **Google identity → API verification:** depict a small identity badge adjacent to this boundary. The actual flow is browser Google ID token, backend verification, then a scoped HabitQuest session. Do not depict Google's token as a PostgreSQL login or child identity.
3. **Research authoring → canonical cards → offline publication:** split the publication path to the Pinecone search projection and pinned canonical snapshot. These are catalog preparation, not live web research.
4. **Pinecone + snapshot → API AI workbench:** live retrieval finds candidate source IDs; local canonical evidence hydrates and binds them. A simple visual convergence is sufficient here. Figure 02 explains embedding, masking, filters and checks. The source catalog is public reference data, distinct from private family state.
5. **AI workbench → goal / three draft habit cards:** these are structured proposals returned through the API. The normal Coach graph and separate habit-writing batches are summarized together at this level, not asserted to be one inference call. OpenAI and Nebius are providers behind this backend workflow.
6. **Drafts → parent approval → scheduled quest board:** approval is an explicit human decision, implemented by API validation and persistence. Never draw the model directly writing assignments, giving rewards or bypassing the parent. Goals may be saved separately; not every draft is accepted.
7. **Quest board → submission → caregiver approval → rewards:** distinguish approval of adding a habit from approval of completing a quest. Both belong to the application workflow. Persisted state and rewards are governed by backend/database transactions.
8. **FastAPI ↔ PostgreSQL:** a clear vertical bidirectional connector makes authoritative read/write state visible. The quest board is a frontend view of this state, not an independent database. Do not connect the browser or providers directly to PostgreSQL.
9. **Planner / Review:** place separate booklets inside or adjacent to the backend service, labelled explicit requests. Their context comes from saved history; their results are suggestions for caregiver action. Do not draw them as hidden steps within every Coach turn.
10. **Artwork → browser:** bundled goal/category art and Fluent icons are frontend assets; public S3 HTTPS buddy images load in the browser. Local metadata/rules choose and recommend buddies. Do not imply model generation during buddy selection or that all artwork is served through the API.
11. **Backend → admin receipt:** usage/latency/cost/credits are durable accounting; operator identity is separate from family and child contexts. Family coaching credits are distinct from children's Sparks and reward points.

## Accuracy boundaries and omissions

- No `create_deep_agent`, autonomous todo loop, ten-agent crew, runtime internet research, model-based buddy choice, neural reranker or promised five-second latency.
- No bulk import arrow from all Pinecone cards to family plans. The selected goal is materialized by validated generation; parent acceptance governs assignments.
- “Check” encompasses structured-output validation and eligible generated-prose Safety. It must not visually place a Safety model in front of the trusted catalog or every generated habit. Detail belongs in Figure 02.
- This overview intentionally omits failure branches, logical model-call counts, schema field names, exact providers' model IDs, deployment subnet topology and capacity limits. Omitting those is not a new architectural claim.
- The prior planner illustration is a style reference only. Its “proposed service,” Deep Agents harness and asset resolver do not describe the main-app runtime.

## Sources

- [Current design README](../../../habbit-quest/docs-design/README.md)
- [System overview](../../../habbit-quest/docs-design/01-system-overview.md)
- [Frontend workflow](../../../habbit-quest/docs-design/02-frontend-experience.md)
- [Backend and identity](../../../habbit-quest/docs-design/03-backend-api-and-security.md)
- [Database and domain](../../../habbit-quest/docs-design/04-database-and-domain-model.md)
- [AI orchestration](../../../habbit-quest/docs-design/05-ai-orchestration.md)
- [Coach and habit generation](../../../habbit-quest/docs-design/06-habit-coach-and-habit-generation.md)
- [Separate helpers](../../../habbit-quest/docs-design/07-planner-review-and-other-ai.md)
- [Buddies and artwork](../../../habbit-quest/docs-design/12-buddies-artwork-and-assets.md)
- [Prior illustration and provenance](../../../hq-ai-services/docs/planning-agent/illustrations/README.md), used for style only.

## Caption and alt text

**Caption:** HabitQuest's implemented November 6, 2026 architecture. The React application calls FastAPI, which combines scoped PostgreSQL state, a researched canonical catalog and bounded AI workflows. Caregivers accept habits and approve completion; AI does not independently change a child's plan. Separate helpers, local buddy selection, asset delivery and generation accounting support the family workflow.

**Alt text:** A parent and child browser connects to a FastAPI workbench. An offline research shelf supplies a canonical catalog and Pinecone semantic index to bounded LangGraph and LangChain AI. Suggested goals and three small habit choices pass through parent approval into scheduled quests. Child submissions receive caregiver approval before Sparks, points and rewards. PostgreSQL stores authoritative family, plan, progress and accounting state. Separate planner and review booklets are explicitly requested. Local artwork and S3 buddy images supply the browser, while an admin receipt summarizes generation usage, latency, cost and credits.

## Export QA checklist

- Read every label at the actual export size; no invented or clipped words.
- Confirm the model never bypasses parent acceptance or writes directly to the database.
- Confirm both canonical snapshot and Pinecone are visible, with offline publication distinct from runtime retrieval.
- Confirm Planner / Review are separate explicit requests; no all-agent serial pipeline.
- Confirm S3 is buddy art, while bundled goal art and icons are separately identified.
- Confirm both approval moments and the separate credit/reward concepts remain legible.
- Confirm PostgreSQL and provider arrows terminate at FastAPI, not the browser.
- Confirm the ribbon reads only “Implemented design,” with no visible implementation date, prototype label or unsupported latency claim.

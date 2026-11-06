# Figure 01b — HabitQuest application components

Reviewed 6 November 2026. No dates appear in the artwork. This extends the original system overview with the functional modules that were previously collapsed inside the FastAPI workbench. It remains a system view, not the detailed AI call graph or AWS network diagram.

## Viewer question

Which frontend experiences and backend responsibilities make HabitQuest work, and which parts are deterministic business logic, bounded AI operations, authoritative storage or external providers?

## Architecture contract

| Area | What must be visible and correct |
| --- | --- |
| Frontend | One React/Vite browser application exposes parent dashboard/plan/Coach, child quests/buddy/rewards, and a separate `/admin` operator entry. These are distinct experiences and identities, not three independently deployed frontend services. |
| API boundary | Backend modules are within **one FastAPI application**. Browser calls use HTTPS, bearer identity and scoped JSON/stage responses. Frontend is presentation/interaction; backend owns authorization and mutations. |
| Identity | Caregiver, kid and operator tokens have separate scopes. Google ID tokens are verified by the API before it issues its own caregiver session. Kid context is scoped to one child; admin does not inherit family-content access. |
| RAG/catalog module | Code masks known names/contacts, embeds a query, searches Pinecone and verifies returned identity/hash/eligibility against the pinned canonical snapshot. It sits before the Coach graph, not inside a hidden research agent. |
| Coach module | Refined Coach is the bounded LangGraph `prepare → generate → safety → decide → finalize`, with a generator and new-prose Safety role. The high-level label may abbreviate this to generate/prose Safety/decide, while the runtime AI companion carries all five nodes. |
| Habit writer module | Separate structured generation produces three draft action choices per newly returned eligible goal, with local checks and bounded correction. It is not a Coach graph stage or autonomous plan writer. |
| Planner module | Explicit Quest Planner request creates a plan proposal from authorized stored facts, with one structured helper call and local checks. This is a distinct capability role, not a separate microservice or background agent. |
| Weekly Review module | Explicit Weekly Review request produces a progress summary/proposal from authorized stored facts, separately from Quest Planner and Coach. The high-level illustration must show a separate named module. |
| LangChain | Structured-call adapters support relevant model invocations; LangGraph orchestrates the refined Coach. Do not put every API module under a LangGraph label or imply these helpers all run sequentially in one turn. |
| Domain modules | Exact goal/habit/child links, schedules, plan capacity, immutable accepted instructions, completion submissions, caregiver approvals, points/Sparks/worlds and rewards belong to deterministic application/database rules. Child submission alone does not award rewards. |
| Tokenomics/admin | Separate operation admission, provider-attempt accounting, measured timings, costs, family credits, policy/enforcement and sanitized admin views. Credits are distinct from child rewards. |
| Database | PostgreSQL owns family state, plans, progress, generation ledgers and policy. RLS, constraints and transactions enforce scope/invariants. Draw only API→database access, never browser/model/Pinecone→database access. |
| Providers and sources | OpenAI supplies the configured writers and query embeddings; Nebius supplies new-prose Safety and helper reports. Pinecone is a public-source vector database, supplemented by authoritative pinned canonical JSON. Models and vector search do not directly mutate family state. |
| Assets | Bundled goal art and public S3 buddy images feed browser rendering. Buddy choice/recommendation is local deterministic logic, not a model call. |

## Composition and connectors

Use 16:9 paper-and-ink styling consistent with the other final illustrations. Left third: one illustrated browser divided into three clearly labeled experiences. Central majority: one light **Backend modules · one FastAPI application** boundary, with visible semantic objects arranged by responsibility rather than a single robot.

- A thin top identity strip shields the API entry.
- A central AI workbench contains separate RAG/catalog, Coach, habit writer, Quest Planner and Weekly Review objects. The label **LangChain model adapters** supports the AI workbench; only Coach says LangGraph. RAG → Coach → habit writer is the main sequence; Planner and Weekly Review are standalone explicit requests, not chained after it.
- A lower domain area shows a parent acceptance clipboard leading to a scheduled-plan board, then the submission/approval/reward loop. A nearby Tokenomics ledger is a separate responsibility, with admin visibility and policy controls.
- Right: source knowledge objects (Pinecone vector database and pinned canonical JSON) connect specifically to RAG, and a provider cloud connects to the AI workbench. Avoid many crossing arrows by using clear grouped ports; selective mappings remain in the companion.
- Bottom: PostgreSQL connects only to the API boundary. A small artwork palette connects to the browser. The API/browser connection is bidirectional with its label visible.

Modules within the boundary may use illustrated sheets, shelves, booklets and clipboards. They must not look like independently deployed containers. Parent acceptance must sit between generated/proposed plan content and actual plan writes.

## Exact visible labels

```text
HabitQuest application components
Frontend experiences + backend responsibilities

React + Vite
Parent
Dashboard · plans · Habit Coach
Child
Today's quests · buddy · rewards
Operator /admin
Tokenomics settings + metrics

HTTPS + scoped identity
JSON results + stage updates

Backend modules · one FastAPI application
Identity + family scope
Google verification · caregiver / kid / admin

RAG + catalog
Mask → embed → retrieve → verify
Coach · LangGraph
Generate → prose Safety → decide
Habit writer
3 draft choices · local validation
Quest Planner
Explicit plan proposals
Weekly Review
Explicit progress summaries
LangChain model adapters

Parent acceptance
Plans + approvals
Exact goal links · schedules
Submit → parent approval → rewards
Tokenomics
Credits · costs · latency
Enforcement or demo mode

Public source knowledge
Pinecone vector database
Pinned canonical JSON
Backend-only provider calls
OpenAI: writers + embeddings
Nebius: Safety + reports

PostgreSQL
Families · plans · progress
Generation ledger · policy
RLS + transactional writes

Goal art + S3 buddy images
Buddy choice: local rules

AI proposes. Parents approve plan changes. The API owns persistence.
```

## Sources

- [System overview and workflow ownership](../../../habbit-quest/docs-design/01-system-overview.md)
- [Frontend experiences and state](../../../habbit-quest/docs-design/02-frontend-experience.md)
- [Backend module and identity inventory](../../../habbit-quest/docs-design/03-backend-api-and-security.md)
- [Database/domain model](../../../habbit-quest/docs-design/04-database-and-domain-model.md)
- [AI orchestration boundaries](../../../habbit-quest/docs-design/05-ai-orchestration.md)
- [Coach and habit generation](../../../habbit-quest/docs-design/06-habit-coach-and-habit-generation.md)
- [Separate Planner and Review workflows](../../../habbit-quest/docs-design/07-planner-review-and-other-ai.md)
- [Tokenomics](../../../habbit-quest/docs-design/11-tokenomics-latency-and-observability.md)
- [Buddies and artwork](../../../habbit-quest/docs-design/12-buddies-artwork-and-assets.md)

## Caption and alt text

**Caption:** HabitQuest's React frontend serves caregiver, child and operator experiences. One modular FastAPI application separates identity, source retrieval, bounded Coach orchestration, habit writing, explicit Quest Planner/Weekly Review helpers, plan/reward rules and Tokenomics. Backend-only providers produce bounded outputs; PostgreSQL owns scoped state and transactions. Plan proposals require caregiver acceptance. The drawing groups responsibilities within a monolith rather than introducing new services.

**Alt text:** Three browser experiences connect through scoped identity to a FastAPI boundary containing separate identity, RAG, Coach LangGraph, habit writer, Quest Planner, Weekly Review, plan/approval and Tokenomics modules. Public Pinecone and canonical-source objects feed retrieval; OpenAI and Nebius supply model calls. A parent acceptance clipboard precedes plan writes. PostgreSQL below the API stores family plans, progress, accounting and policy. Bundled goal art and S3 buddy artwork feed the browser through local selection rules.

## Visual QA

Verify all five AI responsibilities are separately named without five remote-agent or microservice claims. Planner and Review must be separate from each other and from the Coach chain. LangGraph must be attached only to Coach. RAG must receive both Pinecone and canonical sources. Only the API accesses PostgreSQL. Parent acceptance must precede plan mutation; child submission must precede caregiver reward approval. Check no dates, no latency guarantee and no private credentials.

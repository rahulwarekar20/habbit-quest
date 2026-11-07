# HabitQuest: instructions for coding agents

These instructions apply throughout this repository. Read the relevant nested `AGENTS.md` as well.
Use this project's source, tests and current documentation; do not copy conventions from other projects.
The user's latest explicit instructions take precedence over historical design notes.

## Approval before rewrites

**Ask for explicit approval before implementing a substantial rewrite.** Do not start the rewrite while
approval is pending. Read-only investigation and preparing the proposal can proceed.

A rewrite includes replacing a working module or workflow, changing architectural boundaries, broad
refactoring across subsystems, or materially changing public APIs, persistence, authorization, AI
orchestration or review policy. A small diff can still represent a substantial behavior change.

Before asking, prepare a concrete proposal covering:

- The problem and why a targeted fix is insufficient, including the smaller alternative.
- The affected files/subsystems and the intended before/after behavior.
- Changes to model calls, contracts, data, compatibility or operating cost, where applicable.
- Migration/rollback needs and the checks that will establish success.

An explicit instruction naming that rewrite, or approval of that proposal, authorizes the described
scope. Do not ask again for the same approved scope. General requests to optimize, clean up or make
something work do not authorize an unrelated redesign. If the proposed scope materially changes, explain
the difference and get approval for the new rewrite before implementing it.

Routine, focused bug fixes, tests, documentation and implementation details within an authorized task
can proceed. Prefer incremental changes and do not bundle unrelated refactors with a requested fix.

## Start with the current project

- Check the current branch and working-tree changes. Preserve existing work; do not reset or overwrite
  changes you did not make.
- Read [README.md](README.md) for the repository layout and local startup.
- For backend work, read [backend/AGENTS.md](backend/AGENTS.md),
  [backend/CLAUDE.md](backend/CLAUDE.md) and [backend/docs/status.md](backend/docs/status.md).
- For the consolidated current design, start at [docs-design](docs-design/README.md).
  The previous top-level `docs` folder is now `docs-detailed`; `backend/docs` is unchanged.
- For the AI pipeline, use [refined AI operations](docs-detailed/sys-design-update/refined-ai-operations.md) and
  [implementation progress](docs-detailed/sys-design-update/implementation-progress.md). Earlier crew diagrams
  and handoff documents contain historical decisions; check their execution overrides before using them.
- `frontend/` is React/Vite; `backend/` is FastAPI/PostgreSQL. Local defaults are frontend port 5180,
  API port 8000 and PostgreSQL port 5432. Verify the actual configuration before changing it.

## Product and AI fundamentals

- Keep LangChain/LangGraph orchestration straightforward. Do not reintroduce hidden agent/tool loops or
  extra model calls under the label of retrieval, research, fit or validation.
- Retrieval uses fast code-based privacy masking, one query embedding and Pinecone semantic search.
  Canonical ID/hash, age and setting checks remain local code. Retrieval makes no chat-generation,
  research or Safety-model call; an embedding request is still a provider/model operation.
- Normal refined Coach uses one generation call and one remote review of **new conversational prose
  and explanations**. It has no remote input ParentRisk call. Preserve the existing fast local urgent
  routing. Canonical catalog records are trusted context, not content to re-review remotely.
- Coach permits at most one text-review revision, giving at most four logical chat calls. Count SDK
  retries/HTTP attempts separately; do not add independent retry loops.
- Explicit habit generation normally uses one writer call, local schema/source/age/wording/privacy/
  duration/novelty checks and parent approval. At most one correction is allowed for failed local
  validation. Do not add a separate remote risk or whole-habit Safety call.
- A canonical Pinecone habit card maps to a HabitQuest **goal**. A generated action maps to a **habit**
  beneath that goal. Save only goals selected by reviewed generation; never bulk-preload all source
  cards into local goal tables. Retrieval and source browsing do not create goals.
- A new explicit Coach send may prepare three habit choices under each newly returned goal (owner update, November 5), with at most four goals and two habit requests in flight. Reuse usable saved batches; passive page load, hover and saved-draft reads must not spend. Explicitly opening a goal may prepare its first batch. “Get more goals” appends additional goals while preserving earlier choices; “More habit choices” explicitly requests another bounded batch of three, replacing the count slider. Preserve the in-flight queue across additional goals. Completed failures require a new explicit request, not an automatic retry loop. Quest planning and weekly review remain separate operations. Never assign a generated habit automatically.
- Preserve canonical research links, supports and limitations in source details. Do not restore legacy
  G-style guidance citations in the source-goal flow or claim the exact app habit has proven efficacy.
- Preserve family/child isolation, parent/PIN acceptance, immutable accepted instructions, reset fences,
  idempotency and recommendation order. Child views contain child-facing text, not adult instructions.
- Do not import catalog-card reward/points rules. Preserve the app's existing points, Sparks and rewards
  behavior unless the user explicitly approves a change.
- Every child always has a buddy. Preserve saved choices and all eight wardrobe items; offer no empty,
  hidden or None buddy choice. New setup uses a deterministic age default until deliberately changed.
- Keep the four-value legacy `buddy` as an additive fallback beside catalog mode/ID/version/revision.
  Explicit parent/kid choices require revision checks and atomic ownership/age validation; unrelated
  edits and older reads must never undo a newer choice. See the [buddy contract](backend/docs/frontend-integration.md#buddy-selection-november-5-2026).
- Buddy metadata is local selection/display data: show names, brief character characteristics and
  suggested ages in the chooser. All 24 current characters support ages 3–13; primary bands are soft.
  Do not infer a child profile or feed buddy metadata into AI, habit selection, scoring or rewards.
  Catalog ranking, preview, selection and event copy make no provider/retrieval calls; keep existing
  optional legacy AI lines on their established path.

Changing these fundamentals is a rewrite-level decision: follow the approval rule above.

## Data, configuration and live providers

- Keep secrets backend-only. Ignore private `.env` files; commit only sanitized examples with clear
  instructions. Never print keys, database credentials, tokens or unmasked family content in logs,
  reports or tool output. Only public configuration belongs in `VITE_*` variables.
- Keep the main `OPENAI_*` and imported `PLANNING_OPENAI_*` credentials separate. Identify models and
  providers by role in configuration and docs; do not silently change routing or embedding dimensions.
- Never edit an applied migration. Add a new migration, preserve existing data and verify compatibility.
  Back up application data before a data-changing migration; confirm the target database explicitly.
- Destructive test fixtures must use disposable databases ending in `_test`, never the running app's
  database. Preserve row-level security and test cross-family and cross-child access boundaries.
- Paid live checks require explicit bounded authorization for their scope and cumulative spending cap.
  Reuse an existing approval within its limits; ask before exceeding it. Use synthetic data, preserve
  prior usage/reservations and clean up only fixtures created by the check. Never reset a ledger or
  create a fresh allowance to bypass the cap. Ordinary mocked tests need no paid-check approval.

## Verification and reporting

- Use the project's virtual environment and dependency tooling. For backend changes, follow the checks
  in `backend/CLAUDE.md`: meaningful tests, 100% statement/branch coverage, Ruff check/format and mypy.
  Verify migrations on a fresh disposable database when schema changes are involved.
- For frontend behavior changes, run relevant tests and the build (`npm test`, `npm run build` from the
  repository root). Include affected user flows, not just implementation-shaped assertions.
- For documentation-only changes, verify links and whitespace; do not restart services or rerun the
  application suites without a reason.
- Freeze the source files under test during a verification run. Coordinate non-overlapping file
  ownership when subagents are requested, and integrate their results before final verification.
- Measure useful completed responses, not fast failures. Report initial and warmed latency, actual
  call/attempt counts, failures and measurement boundaries. The five-second target is not a guarantee
  established by mocked tests or one successful sample.
- Give concise progress updates at meaningful milestones. Finish with what changed, how it was
  verified, any remaining limits, and links to the relevant implementation/operations documents.

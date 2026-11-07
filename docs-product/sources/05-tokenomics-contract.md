# Figure 05 — Tokenomics from provider attempts to family credits

**Status:** implemented accounting design reviewed 6 November 2026. This is a code-and-documentation review, not a new benchmark, live policy read or provider invoice reconciliation. The illustration must contain **no implementation date or timestamp**.

## Viewer question

How does HabitQuest account for every generation and retrieval attempt, turn useful outcomes into family credits, expose timing/cost metrics and optionally enforce budgets?

## Sources checked

- [Current Tokenomics design](../../../habbit-quest/docs-design/11-tokenomics-latency-and-observability.md)
- [Accounting, policy, reservation and settlement](../../../habbit-quest/backend/src/habitquest_backend/tokenomics.py): `begin_operation`, `_global_allowed`, `record_attempt`, `finish_operation`, `admin_metrics`.
- [Generation endpoint wrapper](../../../habbit-quest/backend/src/habitquest_backend/generation_metering.py): operation identity, useful-result qualification, automatic habit-slot binding, completion/failure settlement and replay.
- [Provider-attempt instrumentation](../../../habbit-quest/backend/src/habitquest_backend/tokenomics_usage.py): pre-dispatch recording, separate SDK retry attempts, usage extraction and elapsed time.
- [Family budget API](../../../habbit-quest/backend/src/habitquest_backend/tokenomics_routes.py): authorized family projections and separate bounded browser observations.
- [Operator API](../../../habbit-quest/backend/src/habitquest_backend/admin.py)
- [Operator UI](../../../habbit-quest/frontend/src/pages/Admin.tsx): policy toggles, pricing, history, model/operation metrics and usage completeness.
- [Family credit meter](../../../habbit-quest/frontend/src/components/CoachingBudget.tsx): used/allowance, pending, mode, overage and refresh events.
- [Progress stages](../../../habbit-quest/backend/src/habitquest_backend/generation_progress.py)
- [Family timing preferences](../../../habbit-quest/frontend/src/lib/generationPreferences.ts)

## Composition

A readable 16:9 illustrated mechanism, using paper, navy ink, blue headings and lavender accents. Main left-to-right journey: an explicit request booklet → a reservation ticket and identity key → three metered provider instruments (chat robot, embedding vector beads, Pinecone search funnel) → a durable PostgreSQL receipt cabinet → a settlement stamp → a compact family credit meter.

Above the journey, show an operator control desk labelled `/admin policy`, with allowance/weights, operator ceiling and enforcement controls. Its control arrows reach admission and dispatch guards. A separate price-version booklet feeds the attempt ledger. Below the journey, a metrics dashboard consumes ledger data. Keep the family credit meter separate from operator cost charts. Do not depict credits as dollars, child rewards or a token counter.

## Exact visible text

Use these short labels; their detailed qualifications remain below. No calendar date, timestamp, invented usage values, prices or measured latency numbers.

```text
HabitQuest Tokenomics
Meter every attempt. Charge useful outcomes.

1  Authorize + reserve
Explicit request + idempotency key
Family-local daily allowance
Replay → saved result, no new call

2  Meter provider attempts
Chat input/output + cached tokens
Embedding input tokens
Pinecone read units + egress
Record before dispatch
Retries + failures retained

3  Durable PostgreSQL ledger
Model + usage + elapsed seconds
Versioned tariff → estimated cost
Missing usage ≠ zero

4  Settle once
Useful result → activity credits
Failure → release credit hold
Provider costs remain

Family meter
Used · pending · remaining · overage
Refresh after completion

/admin policy
Daily credits + activity weights
Operator spending ceiling
Enforce ON: allowance + exposure checks
Enforce OFF: demo tracking, no budget blocking
Show costs toggle
Timing display separate

/admin metrics
History + model cohorts
Tokens · generation time · latency · cost
Sample counts + usage coverage

Seed policy: 100/day · Coach 2 · Habit batch 1 · Planner 2 · Weekly Review 2
Credits ≠ dollars ≠ child rewards
Enforcement requires verified tariffs + bounds
Numeric metadata, not family prose
```

## Relationship and authority contract

1. **Admission before paid work.** An authorized explicit operation receives an idempotency key and a serialized family credit hold. The family's daily window follows its timezone and is shared across children. A repeated identical key replays a saved result or returns existing status/conflict; it does not dispatch another provider request. A mismatched payload/scope fails rather than reusing the key.
2. **Accounting has three levels.** Operation = useful activity. Invocation = logical model/provider call. Attempt = actual HTTP dispatch, including SDK retry requests. The figure's metering step must not equate them.
3. **Record before dispatch.** Each attempt persists identifiers, model/provider role, bounds and price snapshot before sending the request. Response/error updates the same attempt with reported usage and elapsed time. Business-result rollback does not erase provider exposure.
4. **Count all retrieval costs.** Chat token fields include reported input/output and cache details. Embeddings contribute input tokens. Pinecone contributes read units and applicable reported egress; it is not a token-model call. Missing counters remain unknown, not zero. Failed attempts can still have known cost or unresolved exposure.
5. **Price truth.** Dollars are estimates derived from reported usage and a versioned tariff snapshot, or conservative exposure where usage remains unknown. They are not an invoice. New price versions preserve historical attempt rates. Cached and reasoning counts are not added twice to total token usage. No current provider price quote is supplied by this review.
6. **Settle useful activities exactly once.** Useful completed provider-backed results debit the operation's quoted activity credits. Failed/local-only results do not earn a useful-result charge; unused holds are released. Actual provider costs remain recorded. Retries may increase operator cost without multiplying the family's useful-result debit.
7. **Automatic habits are separate operations.** Successful Coach binds eligible goal-specific batch slots before settlement; those batches have their own usage and credit rows. Do not double count aggregate interaction totals plus child operations. No need to fit this storage detail into the image.
8. **Family policy versus provider cost.** The seeded policy is 100 daily credits per family, Coach 2, habit batch 1 for up to three choices, Planner 2 and Weekly Review 2. These are editable activity weights, not a live dollar conversion or a verified current operator setting. Buddy/child screening are zero-credit activities with provider cost still tracked. The reference USD-per-credit informs recommendations only.
9. **Enforcement toggle.** ON activates family allowance admission and cumulative operator exposure checks. Existing settled/pending and imported legacy exposure remain included. Per-attempt dispatch requires a verified tariff and bounded exposure; missing/unverified/unbounded exposure can block work until reconciled. OFF is demo tracking mode: the budget gates do not block on credit allowance or the operator cap, while usage, overage and costs continue to accumulate. OFF does not disable authentication, safety, validation, timeouts or unrelated rate limits. Do not claim the present seeded Pinecone planning tariff is sufficient for enforced dispatch.
10. **Visibility is independent.** The operator `show_costs` toggle controls family dollar fields and supported per-generation detail surfaces. The compact credit chip remains visible. Coach intentionally omits inline per-result/per-batch credit messages. Family timing visibility is separate. Hiding a display never stops accounting or changes enforcement.
11. **Monitoring.** `/admin` has a separate operator identity. It exposes configuration, history, usage/token completeness, price versions, model-attempt cohorts and whole-operation cohorts. Metrics distinguish mean generation time, operation latency, attempt latency, sample counts, known cost and unresolved exposure. p50 is computed; p95 is withheld until at least 100 completed samples. Small historical samples are not a production SLO. Exact numeric dashboards do not need to be invented in the artwork.
12. **Privacy.** Accounting records numeric observations, IDs and statuses; it excludes copied family prompts, generated prose, vectors and keys. Browser timings are explicitly separate untrusted observations, not inputs to cost or credits. Progress SSE streams named stages and elapsed time, not unreviewed token drafts.

## Caption

HabitQuest separates family allowance from provider expenditure. Authorized operations reserve credits once, while every chat, embedding and Pinecone HTTP attempt is durably recorded with usage, timing and a price snapshot. Useful results settle activity credits; failed work releases credit holds but does not erase incurred provider cost. The admin panel exposes metrics and policy, including optional family cost display and budget enforcement. Demo mode tracks overage without budget blocking; enforcing spend requires verified tariffs and bounded exposure.

## Alt text

An explicit request passes through an authorization and reservation ticket, then chat, embedding and search meters. A PostgreSQL receipt cabinet retains each attempt's model, usage, elapsed seconds and estimated cost. A settlement stamp debits useful activity credits or releases failed holds, and updates a family progress meter. An operator control desk supplies daily allowance, activity weights, spending ceiling and enforcement/display switches. A separate admin dashboard reads history, tokens, latency, generation time, cost and coverage. A footer distinguishes credits, dollars and child rewards, and notes that unknown usage is not free.

## Visual QA checklist

- All final visible copy is date-free and readable at slide size.
- Attempt metering precedes dispatch; retries and failures remain visible.
- Embedding and Pinecone costs are both included; Pinecone units are not tokens.
- Estimated cost has a versioned tariff input; missing usage is never zero.
- Settlement debits useful activities once and releases holds on failure; it does not erase provider cost.
- Family credit meter and operator cost metrics are separate.
- Enforced and demo states are two policy behaviors, not simultaneous active states.
- Seed values are explicitly labelled seed policy, not observed production balances.
- Enforcement qualification remains legible; no unlimited-demo claim about other safeguards.
- No prompts, personal family data, model responses, secrets, invented measurements or invoices are depicted.

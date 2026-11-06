# Dedicated Quest Planner illustration

This date-free illustration gives the Planner the same full-slide prominence as Coach and Weekly Review. It describes the implemented family-level endpoint, not the earlier standalone HQ AI Services planning prototype.

## Purpose and mechanism

An explicit parent request authorizes and meters an operation, reads a family snapshot and precomputed SQL counts, replaces child names with labels, and makes one typed LangChain model call. The result contains a summary, tips and proposed changes. Code validates child/habit membership, time syntax and duplicates, then persists up to four suggestions with the report. Parent acceptance separately rechecks current plan rules; generated proposals do not apply themselves.

The five numbered stages on this slide are explanatory groupings, **not a new LangGraph**. `insights.py` implements this as a one-call helper. “Agent” names its product role; the Coach alone uses the five-node LangGraph. Reports have prompt constraints and local checks, without the separate Coach Safety pass or Pinecone retrieval.

## Inputs, outputs and boundaries

- Inputs: each child's age, current plan, recent approved completions, check-in facts and available habit candidates. SQL computes counts. Custom habit text is represented by its goal in AI-facing data.
- Privacy: child labels replace profile names; names are restored for display. This does not claim comprehensive free-text PII detection.
- Output schema: summary, tips and changes using `add`, `retime`, `pause`, `resume`, or `remove`. Prompt preferences for modest changes are distinct from formal validation.
- Checks: valid child label, allowed habit, plan membership, accepted time format and unique child/habit pair. Maximum four persisted changes.
- The provider call runs outside the DB transaction. Valid report/suggestions are saved later. Failure/truncation saves no partial report. Existing saved reports can be read without a call.
- Acceptance rechecks authorization, eligibility, capacity and applicable domain rules. Dismissal does not mutate the plan.
- Current role route: Nebius `deepseek-ai/DeepSeek-V4.1-Flash-1017`; one logical structured call. SDK attempts may retry and cost is metered separately. The helper reasoning resolver uses `none` for the configured Nebius DeepSeek family in auto mode.
- Progress stages/timers and Tokenomics cover the operation. No new benchmark or provider call was made for this illustration.

## Sources

- [Current helper design](../../../habbit-quest/docs-design/07-planner-review-and-other-ai.md)
- [Actual prompts, schemas, SQL snapshot, checks and endpoints](../../../habbit-quest/backend/src/habitquest_backend/insights.py)
- [Provider routing](../../../habbit-quest/backend/src/habitquest_backend/llm.py)
- [Model roles](../../../habbit-quest/docs-design/08-model-selection-and-runtime-routing.md)
- [Domain/acceptance rules](../../../habbit-quest/docs-design/04-database-and-domain-model.md)
- [Tokenomics](../../../habbit-quest/docs-design/11-tokenomics-latency-and-observability.md)

## Caption and alt text

**Caption:** Quest Planner is a separate parent-initiated role: SQL facts and labelled child snapshots feed one structured model call. Code checks proposals, saves at most four suggestions and leaves plan changes to explicit parent decisions and current domain checks.

**Alt text:** Parent dashboard request flows through authorization and a scoped SQL snapshot with child labels, one LangChain model call, local proposal validation, then a saved report and parent accept/dismiss choice. Only acceptance after fresh checks updates the plan; failure terminates without a partial report.

## QA

No date, fabricated result or automatic planner trigger. The model must not connect directly to plan writes. Distinguish proposal storage from applying a change, and show failure as a terminal outcome. Preserve one logical call, four-change cap, correct model label, local-check scope and independent operation.

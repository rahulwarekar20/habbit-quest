# Dedicated Weekly Review illustration

This date-free illustration gives Weekly Review an independent full-size role. It is grounded in the current helper endpoint, not a hidden Coach step or a scheduled autonomous review.

## Purpose and mechanism

A parent explicitly requests a review. Authorization and metering precede a scoped family snapshot. SQL computes approved-completion totals for the most recent seven days and the preceding seven. Child labels replace names. One typed LangChain model call produces a headline, per-child win/watch notes, patterns and possible changes. Code validates change references, action/time values and duplicates, and retains at most two proposals. The report is stored, names restored for display, and parents accept or dismiss changes separately.

The five illustrated steps are explanatory groupings, **not LangGraph nodes**. This helper remains outside the Coach LangGraph and does not invoke its separate prose-Safety model. It does not run Planner, embeddings or Pinecone. “Agent” is a product-role label for one structured model call plus application code.

## Facts and qualifications

- SQL counts actual approved completions; the model is not asked to count raw events. The snapshot also contains current plan, age and check-in facts.
- Prompt asks for a win/watch point per child and up to three fact-supported patterns, supportive language and no sibling comparisons, punishment or removal of earned rewards. These are prompt constraints, not measured semantic guarantees.
- A child without habits should get an acknowledgement rather than invented progress.
- Proposed changes use the shared typed action schema. Local checks validate child/habit references and time format, drop duplicates and retain at most two changes. Narrative prose does not receive a separate Coach Safety pass.
- One logical Nebius `deepseek-ai/DeepSeek-V4.1-Flash-1017` call runs outside the database transaction. SDK retries are separate attempts. The configured auto helper reasoning resolver uses `none` for this model family.
- Provider failure or truncation saves no partial report. Reading the latest saved report does not generate again. “Weekly” describes the comparison window, not an automatic recurring trigger.
- Accepted changes are revalidated against current domain/authorization rules; dismissal does not mutate the plan. Usage/cost records can remain after a failed operation.

## Sources

- [Current helper design](../../../habbit-quest/docs-design/07-planner-review-and-other-ai.md)
- [Weekly SQL, prompt, schema, checks and endpoints](../../../habbit-quest/backend/src/habitquest_backend/insights.py)
- [Provider routing](../../../habbit-quest/backend/src/habitquest_backend/llm.py)
- [Model roles](../../../habbit-quest/docs-design/08-model-selection-and-runtime-routing.md)
- [Domain model](../../../habbit-quest/docs-design/04-database-and-domain-model.md)
- [Tokenomics](../../../habbit-quest/docs-design/11-tokenomics-latency-and-observability.md)

## Caption and alt text

**Caption:** Weekly Review interprets two seven-day SQL windows through one structured model call, returning parent-facing wins, watch points and patterns. At most two locally checked changes become suggestions; parents decide whether to apply them. Reading a saved report costs no new model call.

**Alt text:** A parent starts a review; SQL supplies two seven-day tally sheets and labelled child context. One LangChain model call writes a structured progress report. Code checks up to two change proposals, saves the report and presents a parent accept/dismiss decision. Only accepted changes pass fresh checks into the plan.

## QA

Keep the two seven-day windows distinct. No invented completion counts or automatic weekly schedule. Distinguish prompt preferences from code limits. Preserve one logical model call, two-change cap, local-check scope, parent authority and the terminal failure path. No date or unsupported guarantee.

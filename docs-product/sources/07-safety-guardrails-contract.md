# Figure 07 — HabitQuest safety and guardrails

Reviewed 6 November 2026. This describes implemented complementary safeguards, especially the refined Coach/source-goal/habit-writing path. **No implementation date belongs in the artwork.** The six numbered controls are not six graph nodes, six agents or six model calls.

## Viewer question

How do source quality, scope/privacy, verified retrieval, structured validation, generated-prose review and parent authority work together—and which checks are code versus model work?

## Visual mechanism

Use a spacious 16:9 hand-drawn slide with six distinct semantic stations, not six identical boxes. A canonical research book (1) and an authenticated/masked request (2) feed a retrieval filter with an ID/hash clipboard (3). The retrieved authority flows to structured output sheets and local validators (4). From that station, distinguish two paths: newly generated Coach prose goes to a Safety-review/decision workbench (5); locally validated habit drafts go to the parent gate (6), without passing through a whole-habit Safety model. Reviewed Coach output also reaches the parent-facing outcome. The parent's accepted habit changes then cross a transaction/checklist gate into PostgreSQL plan state.

One clear stop branch from the Safety/decision area represents unavailable, invalid or twice-rejected Coach prose. This branch must end visibly; it never reaches published content or the parent plan. A bounded revision loop remains within the Coach review mechanism. Five LangGraph nodes run the Coach; only generation and generated-prose review are normal chat calls. LangChain provides typed provider calls. No new agent framework or extra model checks are being introduced.

A small bottom rail names other workflows with their actual scope instead of asserting one universal policy: Planner/review use local proposal checks without the Coach's separate Safety model; child-note screening follows a distinct policy. Full older-path limitations remain below.

## Exact visible copy

```text
HabitQuest safety and guardrails
Six complementary controls • not six LLM calls

1  Researched source authority
Canonical cards + evidence
Age fit • adaptations • explicit limits

2  Scoped Coach input
Family + child authorization
Known names + contacts masked
Recognized urgency → fixed support

3  Verified retrieval
Pinecone → canonical records
IDs • hashes • release • age • context
Code checks; no catalog Safety call

4  Structured output checks
LangChain: typed provider calls
Allowed goal IDs + relationships
Habit schema • age • privacy • novelty
One habit correction maximum

5  Coach prose review
New prose only → Safety → code decision
One rejected-prose revision
Approved → reviewed output
Rejected twice / unavailable → fixed failure
LangGraph: five Coach nodes
2 normal chat calls • 4 with revision

6  Parent authority
Choose + preview + accept
PIN when configured
Ownership • goal linkage • capacity
Atomic plan write

Planner/review: local checks; no Coach Safety pass
Child-note screening: separate policy
Layered safeguards, not a guarantee of safety.
```

## Relationship and scope contract

| Control | What is implemented | Essential limit |
| --- | --- | --- |
| Researched source authority | Public canonical cards carry evidence links, parent guidance, age adaptations, exclusions and explicit limits. A pinned local snapshot is authoritative after retrieval. | Evidence-informed cards are not clinical approval or proof that the app's generated habit is effective. Source research is offline, not an LLM research stage on every request. |
| Scoped input | Backend authorizes family/child access, reads scoped context, routes recognized urgent phrases to fixed guidance, and masks known child/caregiver names plus common email/phone formats before refined external retrieval. | Bounded code masking is not comprehensive PII recognition; urgent phrases are not exhaustive clinical triage. The older onboarding mapper does not use this exact refined masking helper, so the label must stay `Scoped Coach input`, not `All AI input`. |
| Verified retrieval | Embedding/Pinecone retrieve candidates; local checks verify source ID, hashes, pinned release, eligibility metadata and canonical authority before hydration. | No remote Safety model reviews trusted catalog records. Similarity does not independently establish suitability. |
| Structured output | LangChain adapters request typed output. Coach schema restricts allowed IDs and relationships; code checks malformed output and current eligibility. Habit drafts receive local schema/count/source/age/wording/privacy/duration/novelty checks, with one permitted correction. | Schema and keyword checks do not prove every narrative claim safe. Habit generation has no extra remote whole-habit Safety call. One correction is separate from the Coach's Safety revision. |
| Coach prose review | Five-node LangGraph: `prepare → generate → safety → decide → finalize`. The generator writes structured advice; the Safety model reviews new conversational prose, questions and explanations. Code decides revision/publication; one rejected-prose revision allows four total logical calls instead of two. Unavailable/invalid review or exhausted rejection returns fixed failure. Raw unreviewed text is not streamed. | Canonical card fields are grounding context, not newly generated text to reapprove. Safety review is a model verdict, not a guarantee. SDK retries are distinct HTTP attempts. Reports do not share this separate review pass. |
| Parent authority | Parent previews, schedules and accepts; configured parent PIN applies at its established boundary. Fresh authorization, ownership, goal linkage, eligibility and capacity checks precede an atomic plan write. | Reviewed draft recommendations do not automatically create child assignments. Parent acceptance and transactional integrity are authority controls, not evidence that all advice is appropriate. |

The figure groups six protections for explanation. It does not imply each operation traverses all six in the same way, or that every guardrail is a chat-model call. The research book supplies canonical authority; it is not a parent-request stage. Code-only catalog validation must not be drawn as an extra safety robot. The habit path must bypass the Coach-prose Safety workbench and join the parent gate after its local checks.

## Other capabilities and current limits

- **Quest Planner and Weekly Review:** explicit parent requests, labeled child context, one structured call each, local proposal checks and separately accepted changes. Their prompt constraints and plan rules remain important, but they do not invoke the Coach's separate prose-review model.
- **Child-written notes:** local checks, then up to one classifier call. Risk-bearing disclosures are retained and flagged for the caregiver. If the classifier is unavailable, `kid-writes` uses the local result so the child can still send a note; this is not universally fail-closed.
- **Legacy child-facing buddy lines:** generated line plus local/model screening; `kid-reads` failure uses fixed fallback. Catalog buddy selection and current event copy are deterministic, with no model call.
- **Older onboarding mapping:** local urgent routing and candidate checks, but the refined known-name/contact helper is not currently applied to typed parent text. Do not generalize the Coach masking claim to every legacy endpoint.
- **Failure bounds:** provider deadlines, input limits and idempotency support operation integrity, but a timeout cannot recall provider work already accepted. These are not universal latency or safety guarantees.

## Sources

- [Current orchestration and safety boundaries](../../../habbit-quest/docs-design/05-ai-orchestration.md)
- [Coach and habit generation](../../../habbit-quest/docs-design/06-habit-coach-and-habit-generation.md)
- [Reports, child-text and older-path boundaries](../../../habbit-quest/docs-design/07-planner-review-and-other-ai.md)
- [Identity and API security](../../../habbit-quest/docs-design/03-backend-api-and-security.md)
- [Domain, authority and transactional checks](../../../habbit-quest/docs-design/04-database-and-domain-model.md)
- [Canonical research and publication](../../../habbit-quest/docs-design/10-habit-research-and-pinecone-catalog.md)
- [Refined graph and Safety decision](../../../habbit-quest/backend/src/habitquest_backend/refined.py)
- [Coach context, masking and request handling](../../../habbit-quest/backend/src/habitquest_backend/coach.py)
- [Canonical retrieval checks](../../../habbit-quest/backend/src/habitquest_backend/retrieval.py)
- [Generated-habit implementation](../../../habbit-quest/backend/src/habitquest_backend/generated_habits.py)
- [Reports and other AI endpoints](../../../habbit-quest/backend/src/habitquest_backend/insights.py)
- [Child-text policy implementation](../../../habbit-quest/backend/src/habitquest_backend/safety.py)
- [Recorded evaluation evidence and limits](06-evaluations-contract.md)

## Caption

HabitQuest uses six complementary protections: researched source authority, scoped and masked Coach input, verified retrieval, structured/local output checks, bounded generated-prose Safety review and parent-controlled plan acceptance. Most checks are code; the Coach has two normal logical chat calls, with one permitted revision. Reports, habit drafts and child-note screens have their own stated boundaries rather than one universal model-review policy.

## Alt text

A research book and authenticated masked Coach request feed a verified retrieval funnel. Structured output sheets split into newly generated Coach prose reviewed by Safety and code decisions, and habit drafts checked locally. Repeated rejection or unavailable review stops with fixed failure. Parent preview and acceptance, optionally protected by a PIN, precede an ownership/linkage/capacity-checked atomic plan write. A footer distinguishes report and child-note policies and states that layered safeguards are not a safety guarantee.

## Export QA

- No visible implementation dates or ungrounded success/safety percentages.
- Six numbered controls must not be mistaken for six LLM calls or a six-node LangGraph.
- Research and code-validation objects have no Safety-model robot; known-name masking is visibly code.
- Coach new prose alone follows the separate review/decision path. Habit drafts use local checks and parent authority.
- Revision is bounded; fixed failure is terminal and never proceeds to persistence.
- Parent acceptance precedes plan mutation; PIN qualifier is `when configured`.
- Reports explicitly have no Coach Safety pass; child-note policy is separate, without an unsupported global fail-closed claim.

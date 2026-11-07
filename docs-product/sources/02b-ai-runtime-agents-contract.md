# AI pipeline part 2 — runtime and independent agent roles

Reviewed 6 November 2026. This is the implemented architecture; the artwork contains no dates. It pairs with [offline catalog creation](04-research-catalog-contract.md). The [original detailed pipeline](02-ai-pipeline-contract.md) remains a technical reference rather than one of the two main AI slides.

## Purpose and terminology

Show how RAG retrieval supplies verified context, LangChain supplies typed provider calls, and LangGraph orchestrates the Coach's five bounded stages. Give Quest Planner and Weekly Review separate, visible roles and inputs.

The requested word **agent** is a product-role label in this illustration. `insights.py` explicitly describes Planner and review as one model call, not an autonomous agent. They are separate functions/endpoints outside the Coach graph. The diagram must not invent a multi-agent supervisor graph, agent-to-agent delegation or a scheduler. LangGraph currently orchestrates the Coach only.

## Relationship and exactness contract

| Area | Required current behavior |
| --- | --- |
| Request scope | Authenticate/authorize family and child, then read scoped SQL facts and context. |
| Local urgent route | Recognized urgent phrases can produce fixed support before inference. This is a bounded code check. |
| Masking | Replace known child/caregiver names and common contact formats before external retrieval. Do not claim comprehensive PII removal. |
| RAG retrieval | One OpenAI `text-embedding-3-small` query at 512 dimensions, one filtered Pinecone search, then canonical ID/hash/release validation and evidence hydration. Up to 12 candidates become at most six distinct eligible concepts. No live research or remote catalog Safety. |
| LangGraph | Exactly `prepare → generate → safety → decide → finalize`; prepare, decide and finalize are code. The generator returns structured advice and allowed goal IDs. Safety reviews new prose and explanations. |
| Bounded decision | First Safety rejection can cause one generation/Safety revision. Normal two chat calls; maximum four logical calls with revision. SDK retries are separate attempts. Invalid/unavailable/exhausted output becomes fixed failure. |
| Publication | Only reviewed success reaches fresh local checks and selected goal persistence. Failure never proceeds to goal/habit generation. |
| Habit writing | Separate one-call writer batches, three choices per eligible goal, at most four goals/two batches in flight. Local schema/source/age/privacy/duration/novelty checks allow one correction. Parent acceptance precedes assignment. |
| Quest Planner | Explicit parent request; family plan, ages, recent approvals and SQL progress facts under child labels. One structured call; local checks; at most four persisted changes. Parent accepts or dismisses separately. |
| Weekly Review | Separate explicit request; SQL counts for seven days versus the prior seven; child labels. One structured call; per-child wins/watch points, patterns and at most two locally checked changes. Parent decides. |
| Helper Safety boundary | Planner/review use prompt constraints, local proposal checks and acceptance rules, without the Coach's separate prose-Safety call. |
| Provider roles | OpenAI Responses `gpt-6-luna`: Coach and habit writer. Nebius Chat Completions `deepseek-ai/DeepSeek-V4.1-Flash-1017`: Coach Safety and report helpers. Short role labels belong in the artwork; exact identifiers remain here. |

## Sources

- [AI orchestration](../../../habbit-quest/docs-design/05-ai-orchestration.md)
- [Coach and habit generation](../../../habbit-quest/docs-design/06-habit-coach-and-habit-generation.md)
- [Planner/review and other AI](../../../habbit-quest/docs-design/07-planner-review-and-other-ai.md)
- [Model routing](../../../habbit-quest/docs-design/08-model-selection-and-runtime-routing.md)
- [Catalog retrieval](../../../habbit-quest/docs-design/10-habit-research-and-pinecone-catalog.md)
- [Actual five-node graph](../../../habbit-quest/backend/src/habitquest_backend/refined.py)
- [Actual Planner/review functions and endpoints](../../../habbit-quest/backend/src/habitquest_backend/insights.py)

## Caption

RAG supplies a bounded, verified evidence set to the Coach. LangGraph runs its five stages; LangChain supplies typed model/provider calls. Newly generated prose receives model Safety before reviewed goals are saved. Separate habit batches create choices for parent acceptance. Quest Planner and Weekly Review are independent, explicitly triggered agent roles, each implemented as one structured call plus local checks outside the Coach graph.

## Alt text

On the left, a scoped parent request passes local urgent routing, name/contact masking, embeddings, Pinecone vector search and canonical evidence hydration. A five-node LangGraph generates and reviews Coach prose, with one bounded revision and a terminal failure path. Reviewed goals feed separate three-choice habit batches and parent acceptance. On the right, two independent agent-role desks show Quest Planner using current plans and SQL progress, and Weekly Review comparing two seven-day windows. Each uses one structured call, local proposal checks and parent decisions.

## Export QA

- Verify all five node labels, revision arrow and success-only path to persistence.
- No arrows should place either helper in the Coach graph or serialize Planner into Review.
- Planner and review must have distinct input/output wording and their own parent trigger.
- Preserve RAG, embedding, vector search, canonical guidance, LangGraph orchestration and LangChain wording.
- Do not describe all roles as autonomous agents or all output as model-Safety reviewed.
- No date, fabricated metric, automatic plan write or promised five-second latency.

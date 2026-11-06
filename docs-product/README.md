# HabitQuest · Illustrated architecture

## From researched guidance to a daily quest.

10 illustrated views preserve the detailed Coach runtime and give Quest Planner and Weekly Review their own full-size explanations, alongside the application, catalog, safeguards, Tokenomics, evaluations and deployment.

**[Open the HTML gallery](index.html)** · **[Present the slides](presentation.html)** · **[Asset documentation](README-assets.md)**

## Illustrations

- [01 Application components](#system)
- [02 AI pipeline · 1 of 2: research and catalog](#catalog)
- [03 AI pipeline · 2 of 2: runtime and agents](#runtime)
- [04 Habit Coach: detailed runtime pipeline](#coach-detail)
- [05 Quest Planner agent](#planner)
- [06 Weekly Review agent](#review)
- [07 Safety guardrails](#safety)
- [08 Tokenomics and monitoring](#tokenomics)
- [09 Evaluation evidence](#evaluations)
- [10 AWS deployment](#aws)
- [Preserved supplemental reference](#supplemental-heading)

<a id="system"></a>

## 01 Application components

[![A React/Vite browser serves parent, child and operator experiences. One FastAPI application contains identity, RAG, Coach, habit writer, separate Planner and Review helpers, domain rules and Tokenomics; only the API accesses PostgreSQL.](illustrations/01b-system-components.png)](illustrations/01b-system-components.png)

The frontend presents parent, child and operator experiences. One modular FastAPI backend owns authorization, retrieval, bounded AI calls, exact goal links, plans, approval rules and accounting. LangGraph belongs to the Coach module; these responsibilities are not separate microservices.

[Full-size PNG](illustrations/01b-system-components.png) · [Read the content contract and source references](sources/01b-system-components-contract.md)

<a id="catalog"></a>

## 02 AI pipeline · 1 of 2: research and catalog

[![Evidence and framework books feed editorial age-specific practice cards. Cross-review and local validation produce a versioned catalog. Search-text embeddings are archived before Pinecone publication, alongside pinned canonical guidance for runtime reuse.](illustrations/04-research-catalog.png)](illustrations/04-research-catalog.png)

Offline research, editorial authoring and cross-review create reusable age-specific practice cards. Prepared search text is embedded, frozen and published to Pinecone; full guidance remains in pinned canonical JSON. Live requests reuse the release. Reviewed source cards become goals, while personalized habit choices are generated later.

[Full-size PNG](illustrations/04-research-catalog.png) · [Read the content contract and source references](sources/04-research-catalog-contract.md)

<a id="runtime"></a>

## 03 AI pipeline · 2 of 2: runtime and agents

[![Scoped context and masked retrieval feed the five-node Coach LangGraph, followed by separate habit generation and parent acceptance. Quest Planner and Weekly Review appear as independent explicit helper roles, each using one structured call plus local checks.](illustrations/02b-ai-runtime-agents.png)](illustrations/02b-ai-runtime-agents.png)

RAG supplies verified context to the five-node Coach graph. New prose receives model Safety; separate writer batches prepare habit choices. Quest Planner and Weekly Review are independent, explicitly triggered agent roles outside that graph. Each helper is a structured model call plus local checks, not an autonomous multi-agent loop.

[Full-size PNG](illustrations/02b-ai-runtime-agents.png) · [Read the content contract and source references](sources/02b-ai-runtime-agents-contract.md)

<a id="coach-detail"></a>

## 04 Habit Coach: detailed runtime pipeline

[![The preserved detailed runtime diagram shows scoped context, masking, embedding, Pinecone, canonical hydration, five Coach graph nodes with one bounded Safety revision, and separate habit batches with parent approval.](illustrations/02-ai-pipeline.png)](illustrations/02-ai-pipeline.png)

Preserved original runtime illustration: it explains the API request-to-result pipeline without offline catalog creation. Follow A from verified retrieval into the Coach graph and B from reviewed saved goals into separate habit batches. Planner and Review retain their own dedicated slides.

[Full-size PNG](illustrations/02-ai-pipeline.png) · [Read the content contract and source references](sources/02-ai-pipeline-contract.md)

<a id="planner"></a>

## 05 Quest Planner agent

[![A parent explicitly runs Quest Planner. Labelled SQL family facts feed one LangChain model call, code validates up to four change suggestions, and the parent accepts or dismisses them before any plan update.](illustrations/08-quest-planner.png)](illustrations/08-quest-planner.png)

Quest Planner focuses on practical adjustments to the family plan. One structured call uses scoped SQL facts; code checks references and retains up to four suggestions. The parent decides, with fresh eligibility and capacity checks before changes are applied. It runs outside the Coach graph.

[Full-size PNG](illustrations/08-quest-planner.png) · [Read the content contract and source references](sources/08-quest-planner-contract.md)

<a id="review"></a>

## 06 Weekly Review agent

[![A parent explicitly runs Weekly Review. Two seven-day SQL windows and labelled child context feed one structured model call. Parent-facing wins, watch points and patterns accompany at most two checked change proposals.](illustrations/09-weekly-review.png)](illustrations/09-weekly-review.png)

Weekly Review interprets recent progress rather than creating a schedule automatically. It compares two seven-day SQL windows, produces a parent-facing report and at most two locally checked suggestions. Parents decide on changes; reading the saved report makes no new model call.

[Full-size PNG](illustrations/09-weekly-review.png) · [Read the content contract and source references](sources/09-weekly-review-contract.md)

<a id="safety"></a>

## 07 Safety guardrails

[![Research authority and scoped Coach input feed verified retrieval and structured output checks. Generated Coach prose receives Safety review; locally checked habit drafts proceed to parent acceptance. Six controls are not six model calls.](illustrations/07-safety-guardrails.png)](illustrations/07-safety-guardrails.png)

Six complementary controls cover researched source authority, scoped Coach input, verified retrieval, structured output checks, Coach prose review and parent authority. They are not six LLM calls. Trusted catalog lookup and bounded habit checks do not receive an extra whole-content Safety pass.

[Full-size PNG](illustrations/07-safety-guardrails.png) · [Read the content contract and source references](sources/07-safety-guardrails-contract.md)

<a id="tokenomics"></a>

## 08 Tokenomics and monitoring

[![An explicit operation reserves allowance, meters chat, embedding and Pinecone attempts, records usage and tariff-based cost in PostgreSQL, then settles useful credits or releases failed holds. Admin policy and metrics remain separate from the family credit meter.](illustrations/05-tokenomics.png)](illustrations/05-tokenomics.png)

Every provider attempt retains usage, timing and estimated cost, including embeddings, search, retries and failures. Useful results settle family credits once; failed work releases credit holds without erasing provider cost. Admin can enforce allowance and exposure gates or track demo overage. Enforcement requires verified tariffs and bounded exposure.

[Full-size PNG](illustrations/05-tokenomics.png) · [Read the content contract and source references](sources/05-tokenomics-contract.md)

<a id="evaluations"></a>

## 09 Evaluation evidence

[![Four separate workbenches show source audits, a frozen synthetic retrieval-model study, mocked guardrail regression tests and recorded application/live-provider checks. The evidence types do not form an extra runtime pipeline.](illustrations/06-evaluations.png)](illustrations/06-evaluations.png)

Recorded source audits, a synthetic embedding study, mocked guardrail regressions and small live-provider samples answer different questions. They support content, model and control-flow decisions. They do not establish a zero-harm guarantee, clinical effectiveness or a new production latency benchmark.

[Full-size PNG](illustrations/06-evaluations.png) · [Read the content contract and source references](sources/06-evaluations-contract.md)

<a id="aws"></a>

## 10 AWS deployment

[![Independent browser HTTPS paths reach app and API ALBs and Fargate tasks. API connects to private RDS and external AI providers; shared DNS and certificate configuration, ECR images, backend secrets and CloudWatch support deployment.](illustrations/03-aws-deployment.png)](illustrations/03-aws-deployment.png)

The browser independently reaches the app and API through two public ALBs. Public-subnet Fargate tasks use restricted ALB-only ingress and internet-gateway egress; RDS stays private. ECR supplies both services, API secrets arrive at startup and CloudWatch retains logs. This always-on demo uses no NAT and is not production HA.

[Full-size PNG](illustrations/03-aws-deployment.png) · [Read the content contract and source references](sources/03-deployment-contract.md)

<a id="supplemental-heading"></a>

## Preserved supplemental reference

The original product journey remains available here. The original detailed AI pipeline is also preserved unchanged and appears in the main presentation.

### Original product journey overview

[![Original HabitQuest product journey overview.](illustrations/01-system-overview.png)](illustrations/01-system-overview.png)

[Full-size PNG](illustrations/01-system-overview.png) · [Source notes](sources/01-system-contract.md)

---

Final artwork contains no implementation dates. [Open presentation mode](presentation.html) · [Slide inventory](slides.json) · [Provenance manifest](manifest.json) · [Visual review](VISUAL-QA.md). All gallery assets are local; no network requests or provider calls are made.

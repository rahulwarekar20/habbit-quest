# HabitQuest architecture illustrations

10 slides explain the implemented system, with separate full-size views for Habit Coach, Quest Planner and Weekly Review. The original detailed AI pipeline is preserved unchanged and included in the main sequence alongside the catalog-creation view. All earlier artwork remains intact.

**[Present the 10 slides](presentation.html)** · **[Open the preview gallery](index.html)** · [Slide inventory](slides.json)

The figures follow the [HQ AI Services illustration style](../../hq-ai-services/docs/planning-agent/illustrations/README.md) and the [current system design](../../habbit-quest/docs-design/README.md). They contain no implementation dates. Presentation mode supports arrow keys, a slide picker and fullscreen without a server or network connection.

## 1. Application components

[Full-size PNG](illustrations/01b-system-components.png) · [Content contract and evidence](sources/01b-system-components-contract.md)

The frontend presents parent, child and operator experiences. One modular FastAPI backend owns authorization, retrieval, bounded AI calls, exact goal links, plans, approval rules and accounting. LangGraph belongs to the Coach module; these responsibilities are not separate microservices.

## 2. AI pipeline · 1 of 2: research and catalog

[Full-size PNG](illustrations/04-research-catalog.png) · [Content contract and evidence](sources/04-research-catalog-contract.md)

Offline research, editorial authoring and cross-review create reusable age-specific practice cards. Prepared search text is embedded, frozen and published to Pinecone; full guidance remains in pinned canonical JSON. Live requests reuse the release. Reviewed source cards become goals, while personalized habit choices are generated later.

## 3. AI pipeline · 2 of 2: runtime and agents

[Full-size PNG](illustrations/02b-ai-runtime-agents.png) · [Content contract and evidence](sources/02b-ai-runtime-agents-contract.md)

RAG supplies verified context to the five-node Coach graph. New prose receives model Safety; separate writer batches prepare habit choices. Quest Planner and Weekly Review are independent, explicitly triggered agent roles outside that graph. Each helper is a structured model call plus local checks, not an autonomous multi-agent loop.

## 4. Habit Coach: detailed runtime pipeline

[Full-size PNG](illustrations/02-ai-pipeline.png) · [Content contract and evidence](sources/02-ai-pipeline-contract.md)

Preserved original runtime illustration: it explains the API request-to-result pipeline without offline catalog creation. Follow A from verified retrieval into the Coach graph and B from reviewed saved goals into separate habit batches. Planner and Review retain their own dedicated slides.

## 5. Quest Planner agent

[Full-size PNG](illustrations/08-quest-planner.png) · [Content contract and evidence](sources/08-quest-planner-contract.md)

Quest Planner focuses on practical adjustments to the family plan. One structured call uses scoped SQL facts; code checks references and retains up to four suggestions. The parent decides, with fresh eligibility and capacity checks before changes are applied. It runs outside the Coach graph.

## 6. Weekly Review agent

[Full-size PNG](illustrations/09-weekly-review.png) · [Content contract and evidence](sources/09-weekly-review-contract.md)

Weekly Review interprets recent progress rather than creating a schedule automatically. It compares two seven-day SQL windows, produces a parent-facing report and at most two locally checked suggestions. Parents decide on changes; reading the saved report makes no new model call.

## 7. Safety guardrails

[Full-size PNG](illustrations/07-safety-guardrails.png) · [Content contract and evidence](sources/07-safety-guardrails-contract.md)

Six complementary controls cover researched source authority, scoped Coach input, verified retrieval, structured output checks, Coach prose review and parent authority. They are not six LLM calls. Trusted catalog lookup and bounded habit checks do not receive an extra whole-content Safety pass.

## 8. Tokenomics and monitoring

[Full-size PNG](illustrations/05-tokenomics.png) · [Content contract and evidence](sources/05-tokenomics-contract.md)

Every provider attempt retains usage, timing and estimated cost, including embeddings, search, retries and failures. Useful results settle family credits once; failed work releases credit holds without erasing provider cost. Admin can enforce allowance and exposure gates or track demo overage. Enforcement requires verified tariffs and bounded exposure.

## 9. Evaluation evidence

[Full-size PNG](illustrations/06-evaluations.png) · [Content contract and evidence](sources/06-evaluations-contract.md)

Recorded source audits, a synthetic embedding study, mocked guardrail regressions and small live-provider samples answer different questions. They support content, model and control-flow decisions. They do not establish a zero-harm guarantee, clinical effectiveness or a new production latency benchmark.

## 10. AWS deployment

[Full-size PNG](illustrations/03-aws-deployment.png) · [Content contract and evidence](sources/03-deployment-contract.md)

The browser independently reaches the app and API through two public ALBs. Public-subnet Fargate tasks use restricted ALB-only ingress and internet-gateway egress; RDS stays private. ECR supplies both services, API secrets arrive at startup and CloudWatch retains logs. This always-on demo uses no NAT and is not production HA.

## Preserved earlier artwork

The detailed runtime diagram is now slide 4, with its original pixels and source contract unchanged. The two-part overview and all other prior illustrations also remain. [Preservation hashes](sources/pre-planner-review-image-hashes.json) verify the earlier images.

- [Original product journey overview](illustrations/01-system-overview.png) · [source notes](sources/01-system-contract.md)

## Reading the design accurately

- **Offline preparation and online generation are different.** The source release contains authored age/context guidance and practice templates. Pinecone holds search records; the pinned canonical package supplies authoritative guidance. It is not a pre-generated database of personalized child plans. Only reviewed selected source cards enter family PostgreSQL as goals; generated actions become assigned habits after parent acceptance. “Public source knowledge” describes reference content, not anonymous Pinecone access: authenticated backend credentials still protect the service.
- **Agent roles are not extra hidden calls.** LangGraph orchestrates the five-stage Coach only. Planner and Weekly Review are independent explicit helpers. The Coach normally uses two logical chat calls, with at most four for one Safety revision; separate habit batches, embedding/search and SDK attempts are additional work. LangChain provides structured model-call adapters.
- **Six safeguards do not mean six model calls.** Research authority, scoped Coach input, verified retrieval, structured output checks, Coach prose review and parent authority protect different boundaries. New Coach prose gets model Safety. Trusted catalog lookup and bounded habit validation do not receive extra whole-content Safety calls. Scope-specific exceptions remain in the contracts.
- **Credits, cost and time are separate.** Credits are activity weights for useful results. Operator dollars are usage-based estimates with retained tariff snapshots, not invoices. Missing usage remains unknown. Demo mode tracks overage without budget blocking; enabling enforcement requires verified prices, conservative bounds and reconciled exposure. Display preferences do not disable accounting.
- **Evaluation evidence has limits.** Source audits, lexical smoke checks, a frozen synthetic retrieval study, mocked control-flow regressions and small live samples answer different questions. Recorded whole-app test counts are not counts of independent safety trials. No new provider evaluation or benchmark was run for these illustrations, and no claim is made that all unsafe generation is eliminated.

## Files and reuse

| Location | Purpose |
| --- | --- |
| `illustrations/` | Final date-free PNGs, including preserved supplemental figures |
| [index.html](index.html) | Static gallery with captions, alt text and full-size image links |
| [presentation.html](presentation.html) | Standalone 10-slide presentation; no server, external scripts or fetch required |
| [slides.json](slides.json) | Ordered slide metadata and actual PNG dimensions |
| `sources/` | Content contracts, implementation references and independent visual reviews |
| `prompts/` | Generation and targeted correction prompts |
| `drafts/` | Review versions, which may contain dates or corrected defects; not final demo assets |
| [VISUAL-QA.md](VISUAL-QA.md) | Final visual review and verification scope |
| [manifest.json](manifest.json) | Image hashes, dimensions and source/prompt provenance |
| [Verification script](scripts/verify_artifacts.py) | Recheck local links, PNG integrity, gallery metadata and provenance |

Images were produced with the built-in image-generation tool using Illustrated Explainers and imagegen. Original reference artwork is preserved. These PNGs are raster illustrations; the saved prompts and contracts support targeted edits. Source documents remain authoritative for details omitted from the artwork.

Run `python3 scripts/verify_artifacts.py` from this folder to refresh the manifest and artifact checks. Visual review is recorded separately; the script does not judge image meaning or rerun AI evaluations.

This work creates local presentation artifacts only. It does not change application behavior, provider models, family data or AWS resources.

To rebuild the viewers after changing slide order or metadata, run `python3 scripts/build_gallery.py`, then `python3 scripts/verify_artifacts.py`. Neither command changes the images.

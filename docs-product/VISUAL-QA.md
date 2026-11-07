# Architecture illustration review

Reviewed on 6 November 2026. Review dates belong to provenance records; the final artwork contains no implementation dates.

## Expanded collection

The main presentation now has ten slides. It includes application components, offline catalog creation, runtime AI roles, the preserved detailed Coach pipeline, dedicated Quest Planner and Weekly Review views, safety, Tokenomics, evaluations and deployment. The original product overview remains supplemental. See the [coverage matrix](sources/coverage-matrix.md).

Three parallel reviewers researched source contracts and inspected actual image exports. The built-in image-generation tool created new artwork in the established paper-and-ink style and applied targeted corrections. No Python/compositing fallback altered images. Original generated files and reviewed drafts are preserved.

## Final visual checks

| Slide | Confirmed checks |
| --- | --- |
| Application components | Frontend parent, child and operator areas are distinct. One FastAPI application exposes identity, RAG/catalog, Coach, habit writer, Planner, Review, plan/reward workflows and Tokenomics. LangGraph belongs to Coach, not every module. Identity wording specifies Google parent login and scoped sessions. Only API owns PostgreSQL access. |
| AI 1: research/catalog | Evidence and framework counts are qualified; editorial categories and age bands expand into canonical cards. Prepared search text is embedded; a complete snapshot precedes publication to Pinecone plus canonical guidance. Runtime creates saved reviewed goals and generated habit choices, then parent-approved plans. No bulk family-data import or clinical proof claim. |
| AI 2: runtime roles | Name/contact masking, embedding, vector search and canonical evidence precede the five-node LangGraph. One bounded prose revision, two normal/four revised calls and terminal failure are visible. Matched A markers feed reviewed saved goals into separate habit writing. Planner and Review have independent triggers, inputs, single calls, local checks and parent decisions. |
| Preserved detailed Coach | Original runtime-only PNG and its exact labels, A/B continuations, call bounds and source contract are retained unchanged. It is now a main slide, not just a supplemental link. |
| Quest Planner | Full-size independent flow: explicit request, scoped SQL facts and child labels, one typed call, local validation, up to four suggestions and parent accept/dismiss. Failure ends without saving a partial report. |
| Weekly Review | Full-size independent flow: explicit request, two seven-day SQL windows, one typed call, wins/watch points/patterns, up to two checked suggestions and parent decisions. Saved-report reading needs no new call. |
| Safety/guardrails | Dedicated final review recorded in the adjacent safety review file. Six complementary safeguards must not be confused with five graph nodes or six model calls. Only Coach new prose has the separate model Safety pass; habits and report proposals have their documented local checks. |
| Tokenomics | Chat, embedding and search have distinct usage units. Pre-dispatch exposure, retries, failures, versioned estimated costs and missing-not-zero usage are explicit. One enforcement control distinguishes alternate modes. Family timing preference is separate from admin cost visibility. Useful credits and retained provider costs are separate; seed values are labelled. |
| Evaluations | Source audits, lexical checks, frozen synthetic embedding comparison, mocked guardrail regressions and recorded whole-app/live checks remain distinct. Actual age band is 6–8. Failure caption says rejected twice, preserving one revision. No invented score, model winner or claim that all unsafe output is eliminated. |
| AWS | Separate browser→ALB→task paths; public tasks with restricted inbound access; private RDS; provider egress; both ECR image paths; backend-only secret injection; tasks→logs; DNS/ACM configuration distinct from runtime traffic. No dates. |

The artwork was checked for labels, arrows, boundaries, reading order, margins, contrast, model/call roles and numerical limits. Source knowledge is separate from private family state throughout. Parent decisions remain visible before plan assignment. No slide promises five-second latency or clinical effectiveness.

## Review records

- [Application component review](sources/01b-system-components-review.md)
- [Research/catalog review](sources/04-research-catalog-review.md)
- [Runtime agent-role review](sources/02b-ai-runtime-agents-review.md)
- [Safety/guardrail review](sources/07-safety-guardrails-review.md)
- [Tokenomics review](sources/05-tokenomics-review.md)
- [Evaluation review](sources/06-evaluations-review.md)
- [AWS review](sources/03-deployment-draft-review.md)
- [Dedicated Planner and Weekly Review acceptance](sources/08-09-helper-visual-review.md)
- Preserved [system](sources/01-system-draft-review.md) and [detailed AI](sources/02-ai-draft-review.md) reviews

## Artifact verification

[Verification results](sources/verification.json) cover local Markdown/HTML links, gallery assets and image dimensions, presentation metadata, PNG integrity, preservation hashes and whitespace. [The manifest](manifest.json) records source, prompt and image fingerprints. The ten-slide gallery and presentation read local files only. All nine prior final PNGs are compared with their recorded hashes to ensure preservation.

These are documentation-artifact checks, not a new model evaluation, cloud audit or application regression run. The evaluation slide summarizes existing evidence and explicitly distinguishes its scope. No application behavior, provider budget, database or AWS resource was changed.

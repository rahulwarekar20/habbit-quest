# Figure 06 — HabitQuest evaluation evidence

Review date: 6 November 2026. **No date belongs in the visible artwork.** This figure summarizes recorded studies, source reviews, current regression coverage and bounded historical live checks. It does not report new test execution or a fresh model benchmark.

## Viewer question

What evidence did we collect to choose catalog content and retrieval models, and how do we check that privacy, decision, Safety and habit-validation boundaries prevent known failures from reaching families?

The answer must distinguish a source audit, a retrieval experiment, a mocked control-flow test and a live provider sample. They are different evidence types, not stages of an extra production agent pipeline and not interchangeable proof of safety.

## Composition

A wide 16:9 illustrated evaluation workbench with four spacious, numbered stations in a two-by-two layout. Use white paper, dark navy hand ink, indigo/blue handwritten headings and restrained lavender washes, matching the existing HabitQuest architecture figures.

1. Source-and-catalog desk: original evidence books, a magnifier, age-tagged card and a qualified-review clipboard. A small lexical search card tray illustrates the catalog smoke checks.
2. Retrieval comparison desk: fixed synthetic query cards divided into development and held-out folders; a compact model-comparison chart and a decision card. This is a recorded experiment, not a live leaderboard. No invented bars or scores.
3. Current guardrail test bench: synthetic request with a masking eraser, canonical-record key/hash clipboard, then generated-prose sheet through Safety and decision. A bounded revise-or-stop fork shows that rejected drafts do not publish. A separate small habit-check clipboard shows local schema/age/privacy/novelty checks. It must not imply that habit drafts receive an additional remote Safety call.
4. Verification evidence shelf: a test report, provider sample receipt and failure notebook. A small model plug/socket represents compatibility checks, not a trophy for an unmeasured model winner.

Use local arrows inside stations to show inputs → checks → evidence. Do not connect all four stations as runtime operations. A restrained bottom ribbon states the scope limit. Keep labels large enough to read on a slide.

## Exact visible text

The following is the entire visible inventory; preserve the qualifications as well as the numbers. Technical identifiers and detailed source links belong in this companion.

```text
HabitQuest evaluation evidence
Recorded studies + regression checks

1  Source + catalog review
Evidence claims • age fit • exclusions
15 claim audits: qualified pass
Schema • provenance • decline rules
48 lexical smoke queries
Evidence-informed, not clinically validated

2  Retrieval model study
80 synthetic cases • 40 held out
8 embedding configurations + BM25
Ranking • recall • latency • cost
Quality choice: large/512
Implemented tradeoff: small/512
Similarity is not suitability

3  Current guardrail regression
Synthetic inputs + mocked model verdicts
Names + contacts masked
Canonical ID/hash checks
New prose → Safety → decision
Reject → one revision → fixed failure
No rejected draft published
Habit schema • age • privacy • novelty

4  Recorded verification
1,073 backend + 206 frontend tests
Writer / Safety compatibility checks
Small live synthetic samples
Relevance • valid output • calls • timing
Failures and limits retained

Test evidence is not a zero-harm guarantee.
No new evaluations run for this illustration.
```

## Evidence and meaning of the claims

| Visible claim | Evidence and qualifications |
| --- | --- |
| 15 claim audits: qualified pass | [Research evidence audit](../../../hq-research/evidence-audit.md), [validation record](../../../hq-research/validation.md). Fifteen selected central source/claim checks; agent-assisted source and causal-interpretation audit, **not independent human peer review**, systematic review or product-efficacy validation. Source contradictions and age/population/causal limits remain visible. |
| Catalog schema, provenance, decline rules and 48 smoke queries | [Catalog validation report](../../../hq-habits-catalog/validation/REPORT.md), [machine results](../../../hq-habits-catalog/validation/report.json), [validator](../../../hq-habits-catalog/scripts/validate_catalog.py). Structural/editorial checks cover IDs, age/context compatibility, source fields, hashes, parent instructions and exact decline/conditional behavior. The 48 positive queries are **lexical smoke checks**, not semantic ranking results. No family trial or clinical efficacy claim. Catalog reward gates are not all imported into the main app. |
| 80 cases, 40 held out, eight configurations plus BM25 | [Embedding design](../../../habbit-quest/docs-design/09-embedding-model-selection.md), [case methodology](../../../hq-infra-setup/embedding-evaluation/case-methodology.md), [comparison report](../../../hq-infra-setup/embedding-evaluation/comparison-report.md), [saved comparisons](../../../hq-infra-setup/embedding-evaluation/results/comparison.json). Corpus: 381 habits and 24 buddies, separate candidate sets. Cases: 64 habit, 9 buddy semantic, 6 buddy controls and 1 buddy choice-set. Whole scenario families kept together in 40 development / 40 held-out split. The held-out **habit** metric denominator is 28 positive and four unsupported cases; do not call all 40 held-out examples habit queries. |
| Quality choice versus implemented tradeoff | The frozen development rule selected large/512; the owner accepted lower-cost small/512 for implementation. Small/512 did not beat BM25 on aggregate held-out nDCG@5 or Recall@5, and should not receive a winner badge. [Decision](../../../hq-infra-setup/embedding-evaluation/model-decision.json), [failure analysis](../../../hq-infra-setup/embedding-evaluation/failure-analysis.md). The dimension sweep normalized native-vector prefixes. Only large/512 received actual-dimensions confirmation and repeated API latency probes within that study; later small/512 ingestion verification was not a repeat of the whole held-out study. |
| Similarity is not suitability | The same unsupported threat/protection request returned cards for **all eight embeddings and BM25**, one of four held-out unsupported examples. Zero metadata-filter violations did not mean every suggestion was appropriate. Do not draw a claim of 100% safe retrieval or suggest that the benchmark threshold is the current production safety layer. Current retrieval does no model Safety call. |
| Masked names/contacts and trusted message origin | [Coach-context tests](../../../habbit-quest/backend/tests/test_coach_context.py), especially `test_refined_masks_trusted_roles_and_calls_only_generation_and_text_safety`; [goal tests](../../../habbit-quest/backend/tests/test_coach_goals.py); [retrieval tests](../../../habbit-quest/backend/tests/test_retrieval.py). Mocked transports capture what is sent and test name/contact removal, role handling, one embedding/search and canonical checks. This is a bounded mask helper, not measured comprehensive PII detection. |
| Safety decision rejects known invalid output | [Refined tests](../../../habbit-quest/backend/tests/test_refined.py) cover generated reply/question/card/change text, rejection-driven revision, twice-rejected output, unavailable/invalid verdicts, contradictory safe verdicts, selected canonical context, goal claims, source IDs, timeouts and publication boundaries. These are deterministic/mock-verdict control-flow checks, **not an empirical detector recall score**. Current Coach normally uses two logical chat calls, at most four with one revision. The failure path stops; it does not persist rejected goals or expose draft prose. |
| Local bounded habit validation | [Generated-habit tests](../../../habbit-quest/backend/tests/test_generated_habits.py), [action-quality tests](../../../habbit-quest/backend/tests/test_action_quality.py). Schema/count, source, age, privacy, duration, duplicate/novelty and child-facing constraints are checked locally. No extra remote whole-habit Safety model is implied by this station. Parent acceptance remains required. |
| 1,073 backend + 206 frontend tests | [Recorded release regression evidence](../../../hq-deployment/evidence/application-coach-credits-regressions.json), [design verification](../../../habbit-quest/docs-design/14-validation-and-design-decisions.md). These are whole-app suite totals from the recorded release, with mocked providers and disposable test DB. They are not 1,279 independent AI safety cases, were not rerun for this figure, and code coverage does not establish model quality. |
| Writer/Safety compatibility and small live samples | [Model-routing design](../../../habbit-quest/docs-design/08-model-selection-and-runtime-routing.md), [saved latency samples](../../../habbit-quest/docs-detailed/evidence/2026-11-04/refinement-latency-benchmark.json), [historical rejected live response](../../../habbit-quest/docs-detailed/evidence/2026-11-04/refinement-live-recheck.json). Approved synthetic checks exercised actual provider/schema compatibility, source relevance, Safety verdicts, token/call counts and stage timing. The later successful sample had three Coach turns and one single-habit writer request; not a distribution for all-goals/all-habits completion. An earlier rejected run used the then-active remote ParentRisk stage; it must not define the current call graph. |
| LLM model selection limits | [Historical shortlist](../../../habbit-quest/docs-detailed/model-selection.md) proposed alternatives; it did not prove a new generative-model winner. Luna writers and Nebius Safety/report roles were integrated and compatibility-checked. Do not present the embedding head-to-head as a head-to-head between those generative models. |

## Historical harness to keep out of current-performance claims

[`scripts/eval_coach.py`](../../../habbit-quest/backend/scripts/eval_coach.py) and [`coach_cases.json`](../../../habbit-quest/backend/evals/coach_cases.json) define 41 old-catalog agent/crew cases for on-goal cards, clarification, no-match behavior, changes, unsafe phrases, injection and timing. The script defaults to `agent,crew`, uses old seeded catalog IDs and a narrow unsafe-output regex. The harness exists, but no current refined-run result was found to support a slide pass percentage. It is neither a comprehensive harmful-output classifier nor the current Pinecone catalog evaluation. Preserve it as historical tooling, not current deployment proof.

## Caption

HabitQuest evaluation evidence spans selected research-claim audits, structural catalog checks, a frozen synthetic embedding comparison, current mocked guardrail regressions and bounded historical provider samples. Tests check that known rejection, privacy, provenance and publication boundaries behave as specified. They do not establish that all unsafe generations are detected or that generated actions have demonstrated child outcomes.

## Alt text

Four illustrated workbenches show source and catalog auditing; a frozen retrieval-model comparison with a quality-versus-cost decision; synthetic tests for name masking, canonical identities, generated-prose Safety, bounded revision and local habit checks; and saved application-test and live-provider evidence. Each evidence type remains separate. A footer states that this is recorded evidence, not a zero-harm guarantee or a newly run evaluation.

## Visual QA traps

- No visible dates, dates hidden in subtitle, version-date badges or timestamp receipts.
- No charts with invented scores, winner trophy for small/512 or merged metrics across incomparable studies.
- Never say all bad generation is eliminated, all 381 goals are clinically safe, or 100% test coverage means 100% safety.
- Keep `qualified pass`, `lexical`, `synthetic`, `mocked`, `recorded` and `small` attached to the relevant claims.
- Keep source/clinical evidence separate from retrieval quality, control-flow regressions and live compatibility samples.
- Do not depict evaluations as runtime model calls, add an evaluation agent to Coach, or place a whole-catalog Safety model before retrieval.
- Do not draw the legacy ParentRisk stage in the current guardrail station.
- The reject arrow must not imply that every first rejection immediately returns failure: one revision is permitted before final rejection; successful revision can be published after review. The station is a failure-test scenario, not the entire runtime graph.

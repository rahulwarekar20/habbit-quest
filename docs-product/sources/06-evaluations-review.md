# Evaluation slide — first draft review

Inspected `drafts/06-evaluations-v1.png` against [the content contract](06-evaluations-contract.md). Review date: 6 November 2026. **Status: two small corrections before acceptance.**

## Passed checks

- Four distinct evidence stations are legible and do not imply extra runtime agents.
- `qualified pass`, `lexical`, `synthetic`, `mocked`, `recorded` and `small` remain attached to their respective claims.
- The 15 selected claim audits, 48 lexical smoke queries, 80 synthetic cases / 40 held out, eight configurations plus BM25 and recorded whole-app 1,073 + 206 test totals are correct.
- large/512 is the quality-rule choice; small/512 is an implementation tradeoff, without an invented winner score or chart.
- Current synthetic/mock-verdict regressions are separated from historical small live samples. No 100% safety claim or product-efficacy claim appears.
- The accept/reject decision and rejected-draft nonpublication are visible; habit local checks are separate from the generated-prose Safety station.
- No implementation date appears. Exact model-family wording `OpenAI text-embedding-3` is a descriptive family label, not a fabricated full model endpoint ID.

## Corrections

| Issue | Minimal change |
| --- | --- |
| Decorative source-card badge invents age band `Age: 6–9`. Actual catalog bands are 3–5, 6–8, 9–10 and 11–13. | Replace the badge with exactly `Age: 6–8`. Preserve the rest of the source-review panel. |
| Bottom-left footer `Reject → one revision → fixed failure` reads as if every revision necessarily fails. The figure intends to illustrate the twice-rejected regression scenario; the accepted-revision branch is not drawn. | Replace that footer sentence with exactly `Rejected twice → fixed failure`. Retain the separate `One revision` box, the accept branch and `No rejected draft published`. This explicitly qualifies the shown failure path without adding a complicated loop. |

## Minimal correction prompt

```text
Edit this evaluation illustration with ONLY two text corrections. Preserve its layout, artwork, colors, all other wording and every number. Do not add any date.

1. In the upper-left source-review panel, change the small lavender badge on the catalog card from "Age: 6–9" to exactly "Age: 6–8".

2. In the lower-left guardrail panel's bottom ribbon, replace ONLY "Reject → one revision → fixed failure" with exactly "Rejected twice → fixed failure". Preserve the separate "One revision" box and the accept/reject drawing above. Keep the line "No rejected draft published" unchanged. The shown failure path is conditional on the revision also being rejected; an approved revision can succeed, although that branch is omitted from this small evaluation scenario.

Do not redraw any other panel, change counts, add scores, or print these instructions. Export a corrected new version.
```

## Reinspection

Check the exact age-band replacement and qualified failure caption. Confirm that the whole-app scope, synthetic/mock/recorded labels, quality-versus-cost decision and zero-harm disclaimer are unchanged.

## Final acceptance

Inspected `illustrations/06-evaluations.png` after the two targeted text edits. **Accepted.** The source-card badge now says `Age: 6–8`; the guardrail footer says `Rejected twice → fixed failure`, with the one-revision box and nonpublication claim retained. All study counts, whole-app test scope, qualified/synthetic/mocked/recorded labels, quality-versus-implementation distinction and evidence-limit footer remain intact. No implementation date appears. No further correction requested.

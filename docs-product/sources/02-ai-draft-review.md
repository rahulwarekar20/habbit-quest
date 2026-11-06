# Figure 02 — first illustration review

Reviewed `drafts/02-ai-pipeline-v1.png` visually against the Figure 02 contract and exact-copy prompt. Review date: 6 November 2026. This is a draft review; the corrected export must be inspected again.

## What is already correct

- The three illustrated bands are attractive and readable, with a clear local reading direction.
- The input path correctly places local urgent routing and code name/contact masking before embedding and retrieval.
- `text-embedding-3-small`, 512 dimensions, 381 cards, filtered top 12, and canonical deduplication ≤6 concepts are present.
- All five graph node names are correct. Only generation and new-prose Safety have model robots; the single Safety-revision arrow returns from `decide` to `generate`.
- The distinction between 2 normal Coach calls and 4 with one revision is present.
- Habit preparation shows three choices, up to four goals, two batches in flight, one writer call per batch, one local-validation correction and parent approval.
- Planner / Weekly Review are visibly separate, with one call each, local checks and no Coach Safety pass.
- **The inspected footer appears already to contain the full model ID `deepseek-ai/DeepSeek-V4.1-Flash-1017`.** Preserve and verify it; a missing provider prefix is not a confirmed error in this draft.

## Corrections required

| Priority | Location | Observed issue | Minimal correction |
| --- | --- | --- | --- |
| High | End of band 1 / start of band 2 | The top band ends at a separate right-pointing `prepare` chevron. The actual `prepare` graph node begins at the far left of band 2, with no visible connection. This resembles a sixth/disconnected stage. | Replace the dangling top `prepare` chevron with a circled **A** and `Continue below`; place a matching circled **A** on the existing arrow entering the actual graph `prepare`. Keep exactly five graph nodes. |
| High | `finalize` → fresh checks | The arrow currently exits the entire finalize box, which contains both reviewed output and fixed failure. It appears that failures can reach goal persistence and habit preparation. | Draw the outgoing path specifically from the green **Reviewed output** outcome to **Fresh local checks**. Make **Fixed failure** end at a short terminal line/dot within the node. No outgoing failure path to SQL. |
| High | End of band 2 / start of band 3 | There is no continuation from saved reviewed goals into the separate habit batches. | Add a circled **B**, labeled `Continue below`, leaving the saved-goal SQL outcome; place matching **B** on an incoming arrow into the first habit-batch group at the start of band 3. This connection is success-only. |
| Medium | Beneath `finalize` outcomes | Redundant text reads approximately `finiewed output / fixed failure`; it is malformed and unnecessary because the two outcome labels above are readable. | Delete this duplicate bottom caption only and retain white space. Preserve **Reviewed output** and **Fixed failure** inside the outcome panel. |

Matching lettered continuation markers are proposed because the band headings occupy the horizontal gutters. A long cross-band return arrow would either cross those headings or reduce their whitespace. Markers must be visibly matched, circled, and described as continuation—not mistaken for additional workflow nodes.

## Optional refinements, only if they fit without crowding

- Expand `filtered top 12` to `age/context filters · top 12` if legible. Full release/availability/language/child-intent filters remain in the companion contract.
- The name/contact masking helper is deliberately bounded; avoid changing its label to “remove all PII.”
- A direct failure shortcut from preparation/generation to finalization exists in code, but adding it to this dense view is optional because the fixed-failure outcome and companion explain it. Do not disturb the five-node main path to fit it.

## Minimal correction prompt

```text
Edit the supplied HabitQuest AI pipeline illustration as a targeted correction. Preserve the white-paper hand-drawn style, characters, all three bands, all other wording, numerical bounds, arrows and objects. Do not redesign or regenerate unrelated content.

1. At the far right of the top retrieval band, replace ONLY the dangling right-pointing chevron labeled “prepare” with a small circled capital “A” and the readable caption “Continue below”. At the left edge of the second band, add the matching circled “A” to the existing arrow entering the real “prepare” graph node. These are continuation markers, not new graph nodes.

2. In the “finalize” node, DELETE the redundant garbled bottom caption below the two outcomes. Keep the exact green outcome “Reviewed output” and purple outcome “Fixed failure”. Route the arrow to “Fresh local checks” specifically from the GREEN “Reviewed output” outcome. The “Fixed failure” outcome must terminate with a small stop line/dot inside the node and must have no arrow toward fresh checks, SQL, or habit preparation. Keep “finalize” as the node heading.

3. Add a small circled capital “B” with “Continue below” as a success continuation after the saved-goal SQL object at the far right of the second band. Add its matching circled “B” on an incoming arrow into the habit-batch cards at the start of the third band. The sequence is saved reviewed goals → separate habit batches. Do not connect fixed failure to this path.

4. Preserve the exact footer labels “OpenAI writers: gpt-6-luna” and “Nebius Safety + reports: deepseek-ai/DeepSeek-V4.1-Flash-1017”. The provider prefix deepseek-ai/ must remain present. Preserve the independent Planner / Weekly Review rail and “No Coach Safety pass”.

Keep all text readable and every item within the canvas. Export a new version; preserve the original.
```

## Reinspection checklist

1. Canonical evidence has an unambiguous continuation into graph `prepare`; there are exactly five nodes.
2. Only reviewed success reaches fresh checks, saved goals and continuation B.
3. Fixed failure ends locally and never points to persistence or habit preparation.
4. Continuation B enters the separate habit writer path; parent approval still precedes assignment.
5. All unchanged counts and exact model IDs survive the edit.
6. Neither newly added continuation caption collides with an existing band title or border.

## Final export review

Visually inspected the actual delivered file `illustrations/02-ai-pipeline.png` on 6 November 2026. **Passed the factual and readability checks below; no further image edits requested.** The review date is provenance in this file only, not visible illustration copy.

- The ribbon reads **Implemented design**. No implementation/review date remains in the image.
- Matched **A** continuation markers correctly connect canonical evidence to the graph's actual `prepare` node. Exactly five graph nodes are shown: `prepare`, `generate`, `safety`, `decide`, `finalize`.
- The **Reviewed output** path alone points from finalization to fresh local checks and selected-goal persistence. **Fixed failure** ends at an internal terminal dot; it does not connect to SQL or habit generation.
- Matched **B** continuation markers connect saved reviewed goals to separate habit batches. Parent approval remains before exact goal-linked child assignment.
- The malformed duplicate finalize caption is gone.
- Retrieval quantities are intact: **381 cards**, **filtered top 12**, **≤6 concepts**, and **512 dimensions**.
- Call and preparation limits are intact: **2 Coach chat calls normally**, **4 with one Safety revision**, **3 choices per new goal**, **up to 4 goals**, **2 batches in flight**, **1 writer call per batch**, and **one local-validation correction**.
- The new-prose-only Safety boundary, code masking, no live research/catalog Safety statement, and separate report rail are preserved. Planner / Weekly Review still show **1 call each**, local checks, parent decision, and **No Coach Safety pass**.
- Exact model IDs remain readable: `text-embedding-3-small`, `gpt-6-luna`, and `deepseek-ai/DeepSeek-V4.1-Flash-1017`.
- All required labels fit within the canvas with no apparent clipping. The illustration remains a mechanism overview; detailed filter lists, failure shortcuts, SDK retry distinctions and caveats are retained in the companion contract.

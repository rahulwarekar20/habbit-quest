# Figure 01 — first export review

Reviewed `drafts/01-system-overview-v1.png` visually on November 6, 2026 against [the figure contract](01-system-contract.md). **Status: strong draft; targeted correction needed before final acceptance.**

## What works

- The title, implementation date, palette, handwritten treatment and overall reading order match the reference series.
- The main browser ↔ FastAPI → researched goal and exactly three habit choices → parent acceptance → child quest sequence is readable.
- PostgreSQL is correctly connected to the API rather than the browser or model.
- The two approval moments are both represented: habit acceptance and later submitted-completion approval.
- Explicit Planner/Review requests are distinguished from the main bounded AI block.
- Bundled goal artwork and S3 buddy images are separated in text; local buddy rules are explicit.
- No old Deep Agents loop, ten-agent crew or unsupported latency promise appears.
- Labels are readable at the actual 1672 × 941 export size. The visible slash separators are slightly mechanical but do not require a new render by themselves.

## Corrections needed

| Priority | Observed issue | Precise correction |
| --- | --- | --- |
| Required | The canonical folder is isolated. It is not connected to authoring, Pinecone or FastAPI. The authoring shelf currently routes directly to FastAPI, with another branch pointing at Pinecone. | Rebuild only the upper source strip. Put the canonical folder between the authoring shelf and Pinecone; show authoring → canonical cards → Pinecone for publication. Show separate runtime inputs from the canonical snapshot and Pinecone into FastAPI. Remove the direct authoring-shelf → FastAPI arrow. |
| Required | Three `+10` labels invent a universal per-quest reward amount. | Delete all three `+10` labels. Keep the unnumbered stars, progress bars, coins and gift. |
| Recommended | `/admin` receipt is a disconnected object. | Add a thin elbow connector from the lower-right FastAPI edge to the receipt. It represents backend accounting and does not need a new label. Do not connect the receipt to the human reviewer or quest rewards. |
| Optional | Planner/Review booklets have no connector, although adjacency and `Explicit requests` make their status clear. | If it remains tidy, add a short two-way connector from the booklet pair to the FastAPI boundary. Do not put them on the main Coach arrow. Avoid shrinking or moving the family workflow to accommodate this. |

## Recommended minimal edit prompt

```text
Edit this existing HabitQuest architecture figure. Preserve the title/date, browser,
FastAPI workbench, robot, model labels, goal and three habit cards, parent, quest
board, PostgreSQL cabinet, artwork palette, explicit Planner/Review booklets,
operator receipt, footer, colors, style and text outside the specified regions.

1. Correct ONLY the upper research/catalog strip and its connecting arrows.
   Keep the research bookshelf on the left. Swap the positions of the canonical
   folder and Pinecone cylinder, so the canonical folder is between the research
   bookshelf and Pinecone. Keep these exact labels with their respective objects:
   "Research & catalog authoring", "Offline publication",
   "Canonical cards + evidence", "Pinned catalog snapshot",
   "Pinecone semantic index".
   Delete the current source-strip arrows. Draw a clear left-to-right publication
   path: research bookshelf → canonical folder → Pinecone cylinder.
   Draw separate downward runtime connectors from the canonical snapshot and
   Pinecone cylinder; these converge just above FastAPI and enter the FastAPI
   boundary. The canonical folder must visibly connect to the API, not remain
   floating. There must be NO direct research-bookshelf → FastAPI arrow.
   Keep publication arrows visually separate from the lower runtime connectors;
   do not let a connector pass through a label or change the main product flow.

2. On the child's quest board, remove all three invented "+10" reward labels.
   Retain the unnumbered stars, progress bars, coins and gift. Add no replacement
   number or performance measurement.

3. Add one subtle thin elbow arrow from the lower-right FastAPI boundary to the
   /admin Tokenomics receipt. It must not connect the parent or quest board to
   admin. Add no new text. If space allows without crowding, a small two-way
   connector may also connect the explicit Planner/Review booklets to FastAPI;
   they must remain outside the main Coach sequence.

Preserve all other facts and artwork. Do not add model-call counts, new services,
claims, family data, credentials or labels. Export a new corrected version.
```

## Recheck after correction

Verify source-strip arrows at full size, check that both canonical and Pinecone reach the API, and confirm that no residual `+10` or other invented reward number remains. Preserve the parent gate and exactly three draft habit choices. Confirm the corrected image did not turn runtime retrieval into a reverse publication arrow.

## Final export acceptance

Visually inspected `illustrations/01-system-overview.png` on November 6, 2026. **Accepted for this architecture series.**

- Offline publication now reads authoring → canonical cards → Pinecone. Both the pinned snapshot and Pinecone attach separately to FastAPI; the misleading direct authoring → API path is gone.
- All three invented `+10` reward values are removed. Unnumbered stars and reward artwork preserve the product explanation.
- The Tokenomics receipt now connects to FastAPI, and the explicit Planner/Review booklets have a separate two-way connection.
- Main text, date, exact three habit choices, parent acceptance, completion approval, PostgreSQL ownership and local asset/buddy boundaries remain intact and readable.
- No further correctness issue requires an edit. The compact connector terminating on the FastAPI boundary and slash-style line separators are cosmetic limitations, not new architectural claims. Detailed request ordering, retries and model calls remain in Figure 02 and the source contract.

## User-requested final style adjustment

The user subsequently requested no implementation dates in any illustration. The active content contract and original generation prompt now require the ribbon **“Implemented design”** only. Internal review and provenance dates remain unchanged. Root completed the final date-removal image edit, and the resulting `illustrations/01-system-overview.png` was visually verified. The earlier edit prompt and review observations above are historical records and have been preserved.

**Date-free final accepted:** the status ribbon now reads only “Implemented design,” with no implementation date elsewhere in the artwork. Canonical and Pinecone connections, offline publication flow, admin/helper connections, both human-approval stages and exactly three habit choices are preserved. No `+10` labels have returned. No additional edit is needed.

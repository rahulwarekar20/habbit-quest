# Figure 04 — catalog creation draft review

Reviewed `drafts/04-research-catalog-v1.png` visually against the contract on 6 November 2026. No dates appear in the artwork.

## What passes

- The dominant offline story is clear: research → authoring → cross-review/local validation → published release.
- All principal counts, age bands and the actual embedding model/dimensions are correct and readable.
- The archive is visibly frozen before either Pinecone or the pinned canonical JSON branch. Both are enclosed in the reusable RAG knowledge-base area and feed runtime reuse.
- Pinecone is explicitly a vector database. Canonical JSON supplies full guidance; the figure does not imply Pinecone owns family state.
- Source card → goal and generated action → habit are clear. Parent acceptance precedes the plan outcome.
- The figure preserves research limitations and contains no automatic assignment, real-family data, authoring-model invention or runtime literature-search claim.
- Reading order, whitespace, style and native 16:9 text size are strong. No broad redesign is needed.

## Narrow persistence clarification

The only PostgreSQL icon currently follows parent acceptance, and its caption says “Only selected goals enter PostgreSQL.” This is a reasonable high-level representation of the eventual persisted plan, but could imply that selected goals are not saved until parent acceptance. Actual reviewed goal materialization precedes separate habit generation; acceptance later writes the assignment.

Two small label changes would remove that ambiguity without adding crossing arrows or a second database:

1. Change `Reviewed source card → goal` to **`Reviewed source card → saved goal`**.
2. Change the caption below PostgreSQL to **`Reviewed goals + parent-approved plans`**.

This makes the earlier saved-goal state explicit while allowing the final database icon to summarize authoritative storage. The companion contract continues to specify that only selected reviewed source cards are materialized, never the whole corpus. No additional arrow is necessary: the row remains a product sequence, not a complete persistence sequence diagram.

## Minimal optional correction prompt

```text
Edit the supplied catalog illustration with ONLY two short label clarifications in the lower-right Runtime reuse area. Preserve every object, arrow, number, model name, title, layout, color and date-free subtitle.

1. Above the reviewed source-card/book object, replace "Reviewed source card → goal" with "Reviewed source card → saved goal".
2. Below the PostgreSQL cylinder, replace "Only selected goals enter PostgreSQL" with "Reviewed goals + parent-approved plans".

Keep the text readable inside the existing areas. This clarifies that reviewed goals are saved before habit generation, while plan assignments require parent acceptance. Do not add a second database, extra arrows, new stages, dates or other wording. Preserve the initial offline catalog creation and all publication ordering exactly.
```

**Assessment:** the offline creation and RAG explanation passes. The two-label clarification is recommended for a stand-alone slide; if no new render is made, the gallery caption should explicitly state “Reviewed selected goals are saved first; parent acceptance later creates plan assignments.”

## Final image acceptance

Visually reinspected `illustrations/04-research-catalog.png`. **Accepted.** The runtime card now reads “Reviewed source card → saved goal”, and the database caption reads “Reviewed goals + parent-approved plans”. This distinguishes early reviewed-goal persistence from later accepted assignments. All research/catalog counts, age bands, embedding model/dimensions, snapshot-before-publication ordering, dual RAG sources and efficacy qualification are preserved. No dates appear. No further edits requested.

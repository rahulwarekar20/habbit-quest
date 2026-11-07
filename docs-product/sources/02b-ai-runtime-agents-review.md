# AI runtime and agent roles — draft review

Reviewed `drafts/02b-ai-runtime-agents-v1.png` against [the content contract](02b-ai-runtime-agents-contract.md). Review date: 6 November 2026. The exported artwork has no date.

## What passes

- The left side has the scoped parent request, SQL context, local urgent route, name/contact masking, embedding, Pinecone vector search and canonical evidence.
- The Coach has exactly five named LangGraph stages. New-prose-only Safety, one rejected-prose revision, two normal/four revised logical chat calls and a terminal fixed-failure outcome are visible.
- The graph's reviewed-success arrow reaches the selected-goal SQL object, while fixed failure has no outgoing publication arrow.
- Quest Planner and Weekly Review are separate agent-role workbenches outside the Coach graph. Each has its own explicit parent trigger, scoped SQL/child-label inputs, one structured call, local checks and parent decision. Weekly review's two seven-day windows and distinct output are legible.
- The separate habit writer shows three choices per goal, at most four goals/two concurrent batches, one normal call, local checks and parent acceptance.
- LangChain and provider roles are correctly labeled, and the helper footer accurately states that the Coach Safety pass is not used for those helpers.
- No implementation date, ten-agent crew, live research loop or latency guarantee appears.

## Required correction

The line leaving **Save selected reviewed goals** descends and ends near **Exact goal-linked child plan**, bypassing the writer/parent acceptance. The separate lower-left **SQL (from saved goals)** object is disconnected. This is a material relationship ambiguity: persisted reviewed goals authorize the separate habit-writing path; they are not themselves a child's assigned plan.

Remove that long descending connector. Use matching circled **A** continuation markers: saved-goal SQL → A, then A → lower-left SQL (from saved goals). The lower lane must remain SQL → three-choice batches → writer/local checks → parent acceptance → exact goal-linked plan. Do not add any direct saved-goal-to-child-plan connection.

## Optional, not blocking

The “At most one correction” loop has a short floating tail above the habit writer. The adjacent `1 call → local checks → parent acceptance` wording identifies the sequence sufficiently. If editing that area is easy, anchor the loop's source to the local-checks part of that label and keep its arrowhead at the writer. Avoid creating a loop from parent acceptance or from the final plan. No new robot or Safety model is needed.

## Minimal correction prompt

```text
Edit this existing HabitQuest AI runtime illustration with one relationship correction. Preserve all titles, date-free subtitle, five Coach nodes, RAG objects, wording, two independent helper panels, colors, provider footer, habit cards and parent approval.

Remove ONLY the long navy connector that leaves the upper "Save selected reviewed goals" SQL object and curves downward toward the bottom-right "Exact goal-linked child plan". It must NOT connect saved goals directly to the child plan or bypass habit writing and parent acceptance.

Replace this cross-band connector with matched circled capital A continuation markers. Put a small circled "A" just below the upper saved-goal SQL label, with a short arrow leaving that SQL object toward the marker. Put a second matching circled "A" at the start of the bottom "Separate habit writer" lane, immediately before its existing left-hand SQL cylinder labeled "(from saved goals)", with a short arrow into that cylinder. Make room by a small local spacing adjustment only; do not cover any title or text. If a caption is needed, use exactly "Continue below" beside the upper A.

The only reading path must now be saved reviewed goals → A continuation → bottom-left saved-goals SQL → three habit choices → writer and local checks → parent acceptance → exact goal-linked child plan. Preserve the fixed-failure stop. Add no other connection, service, date or claim. Leave the existing correction-loop semantics unchanged. Export a corrected new version.
```

## Reinspection

Check both A markers and endpoints, ensure the long direct-goal-to-plan connector is gone, and verify the parent still precedes assignment. Recheck that the helper panels and all numerical bounds survived unchanged.

## Final acceptance

Inspected `illustrations/02b-ai-runtime-agents.png` after the targeted correction. **Accepted.** The long saved-goal-to-final-plan connector is gone. Matching A markers now carry reviewed saved goals into the lower-left saved-goals SQL cylinder, then through habit writing/local checks and parent acceptance before the exact goal-linked child plan. The five-node graph, fixed-failure stop, numerical bounds, two independent helper roles and provider footer remain intact. No implementation date appears. No further correction requested.

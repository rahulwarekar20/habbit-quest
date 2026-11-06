# Figure 01b — system components visual review

Reviewed `drafts/01b-system-components-v1.png` visually on 6 November 2026 against the component contract. No dates appear in the artwork.

## Passed checks

- Three frontend experiences are recognizable within one React/Vite browser: parent, child and operator.
- The backend is explicitly **one FastAPI application**, with distinct functional modules rather than new microservices.
- RAG/catalog, Coach LangGraph, habit writer, Quest Planner and Weekly Review each have separate labeled objects. The main RAG → Coach → habit-writing path is distinct from the two explicit helper roles.
- LangGraph is attached only to Coach. LangChain adapters support model invocation rather than enclosing every backend business rule.
- Pinecone and pinned canonical JSON both feed the AI workbench's RAG entry. Source guidance is separate from family storage.
- Provider calls remain backend-only; PostgreSQL is linked to the API boundary, not browser/providers.
- Parent acceptance, exact goal linking, schedules and the completion approval/reward loop are visible. Tokenomics is a separate responsibility, with enforcement/demo mode distinct from child rewards.
- Artwork feeds the browser and local buddy choice is explicit. Text is readable at native size; no broad layout correction is needed.

## Recommended identity-label correction

The line `Google verification · caregiver / kid / admin` can be read as Google being the login mechanism for all three roles. Actual Google sign-in applies to caregivers; kid and operator sessions have their own credentials and boundaries.

Replace that single line with **`Google parent login · role-scoped sessions`**. The shield title already says Identity + family scope, and the frontend displays the three audiences, so no extra explanatory copy is needed.

## Diagram-level omissions that are acceptable

There is no explicit arrow from the AI workbench down to parent acceptance. This is a component/responsibility diagram, not the full transaction sequence; the footer and approval area make authority clear, and the runtime AI slide supplies the detailed proposal-to-acceptance path. Adding a long connector would clutter the component boundaries without correcting a false claim.

The canonical/Pinecone paths converge at the workbench before the short RAG arrow. Their endpoints remain unambiguous at this level. The single database connector represents API-owned transactions shared by modules; it does not need an arrow per module.

## Minimal correction prompt

```text
Edit the supplied HabitQuest application-components illustration with ONE text correction only. Under the "Identity + family scope" heading, replace the line "Google verification · caregiver / kid / admin" with exactly "Google parent login · role-scoped sessions". Keep that line readable and centered in its existing area. Preserve every other word, object, arrow, layout, color, module boundary, title and date-free subtitle. Do not add a date or change any other part of the image.
```

**Assessment:** component coverage and authority boundaries pass. Apply the one-line identity clarification for the final standalone illustration, then verify the replacement and unchanged module labels.

## Final image acceptance

Visually reinspected `illustrations/01b-system-components.png`. **Accepted.** The identity line now reads “Google parent login · role-scoped sessions”. Parent, child and operator experiences remain distinct; the one-FastAPI boundary and all five AI responsibilities are preserved. Planner and Weekly Review are separate, LangGraph stays attached only to Coach, and database/provider/source ownership remains clear. No dates or new claims were introduced. No further edits requested.

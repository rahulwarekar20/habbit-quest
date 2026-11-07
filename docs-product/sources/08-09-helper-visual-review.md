# Dedicated Planner and Weekly Review visual review

Both new exports were inspected against current `insights.py`, the helper design and their individual content contracts. No new provider or application tests were run.

## Quest Planner — accepted

- Explicit parent/dashboard trigger, family authorization and scoped SQL facts precede one LangChain call.
- Child A/B labels are visible on snapshot folders; name restoration is visible at report display. Exact privacy wording remains in the companion.
- Structured summary/tips/changes, allowed action vocabulary, local reference/plan/time/duplicate checks and four-change cap are shown.
- Parent accept and dismiss paths are distinct. Acceptance passes eligibility/capacity checks into a locked plan update. Dismissal changes no plan.
- Provider failure branches from generation into a terminal no-partial-report result.
- One-call role outside Coach LangGraph, correct Nebius model, local-check boundary and metering are explicit. No date or fabricated measurement appears.

## Weekly Review — accepted

- Explicit parent trigger; SQL compares last seven days and prior seven for child labels with no invented counts.
- One LangChain call produces headline, per-child win/watch and patterns. Supportive language and up-to-three patterns are identified as prompt guidance.
- Local proposal validation and up-to-two changes remain distinct from narrative interpretation.
- Saved report/name restoration, parent accept/dismiss, fresh checks and saved-report reuse are visible. Failure explicitly saves no partial report.
- Five numbered bands communicate reading order without implying five model calls or a new graph.
- Correct model label, outside-Coach scope, no Coach Safety pass, and telemetry appear in the footer. No implementation date appears.

## Preservation

All nine pre-existing final PNGs are checked against [their recorded hashes](pre-planner-review-image-hashes.json). The prior detailed Coach pipeline is promoted from supplemental material into the main presentation without altering pixels, wording, source documents or existing paths. All earlier overview, catalog and runtime-role figures remain available. The separate `habitquest-ppt` folder is outside this change.

# Figure 05 — Tokenomics draft review

Reviewed `drafts/05-tokenomics-v1.png` visually on 6 November 2026 against [the content contract](05-tokenomics-contract.md). **Status: accurate mechanism, with targeted presentation corrections required.** No new provider, database or policy checks were run.

## What passes

- The main flow is explicit authorization/reservation → provider attempt meters → durable PostgreSQL ledger → one-time settlement → family meter.
- Chat, embedding and Pinecone each appear as distinct metered work, with token versus read-unit/egress units preserved.
- Pre-dispatch recording, retries/failures, versioned tariffs, estimated dollars and unknown-not-zero usage are legible.
- Useful-result debit and failed-result credit-hold release are separate branches. The retained receipt explicitly preserves provider costs.
- The family meter shows used/pending/remaining/overage and refresh behavior; it does not invent a balance.
- Admin metrics include history, model cohorts, tokens, timing, cost, samples and coverage.
- Seed policy is clearly labeled; credits are distinguished from dollars and child rewards. Verified tariffs/bounds qualification and numeric-only telemetry remain visible.
- No implementation date appears. The style, contrast, large main labels and directed arrows match the series.

## Required corrections

| Priority | Location | Issue | Narrow correction |
| --- | --- | --- | --- |
| Required | Bottom `FACTUAL LIMITS` panel | The generator printed the instruction block, including phrases such as “never imply” and “The image is a mechanism overview.” This is not intended slide content and is too small to read. | Delete the entire panel, its heading, border and paragraph. Preserve the short seed/policy/privacy ribbon immediately above it. Leave clean white paper; adjust only the ribbon's vertical spacing if necessary for a balanced lower margin. |
| Required | `/admin policy` | Separate illustrated switches for Enforce ON and Enforce OFF imply two independent settings. There is one boolean setting. | Replace both switch icons with one switch labelled `Enforce budgets`. Show the two mode descriptions as simple text under that one switch: `ON: allowance + exposure checks` and `OFF: demo tracking, no budget blocking`. Do not show two controls or claim two active modes. |
| Recommended | `/admin policy` / family meter | `Timing display separate` appears within the admin policy list; the seconds preference is a family setting independent of admin cost visibility. | Remove that bullet from admin. Add `Family setting: show seconds` as a compact caption under the family meter's refresh text. Keep `Show costs toggle` in admin. |

The extra accounting/control legend and retained receipt cabinet are correct explanatory additions. Their presence does not require regeneration. The failed branch's downward receipt arrow is acceptable because the common PostgreSQL ledger already retains every attempt, and `Provider costs remain` applies to the settlement section as a whole.

## Minimal correction prompt

```text
Edit this existing HabitQuest Tokenomics illustration with only the following three corrections. Preserve the white-paper blue/purple style, title, main accounting arrows, all four numbered stages, family meter, tariff booklet, admin metrics, receipt cabinet, legend, seed-policy values and all other facts. Keep the artwork date-free.

1. DELETE the ENTIRE bottom box labelled “FACTUAL LIMITS:” and ALL of its dense paragraph text, border and lavender heading. Those are generation instructions accidentally printed in the image. Do not replace them with any paragraph. Preserve the short ribbon immediately above it beginning “Seed policy: 100/day” and its three companion qualifications. Clean white paper should replace the deleted panel. The short ribbon may move slightly downward to balance the lower margin, but do not change its text or shrink other labels.

2. Within the top-left “/admin policy” panel, replace the TWO illustrated enforcement switches and their two adjacent lines with ONE clearly visible toggle labelled exactly “Enforce budgets”. Under this single control, use two plain-text explanatory lines with NO additional switch icons:
“ON: allowance + exposure checks”
“OFF: demo tracking, no budget blocking”
These are alternate states of one setting, not two separate controls. Keep the daily-credits/activity-weights and operator-spending-ceiling bullets unchanged.

3. Remove the “Timing display separate” bullet from the admin policy panel. Keep the admin “Show costs toggle” bullet. Under the family meter's “Refresh after completion” caption, add this readable short caption: “Family setting: show seconds”. Do not draw this family timing preference as an admin control or connect it to enforcement.

Do not introduce any other paragraph, date, measured balance, price, credential, guarantee or new architecture. Do not change the separate chat, embedding and Pinecone meters, useful-versus-failed settlement branches, or provider-cost retention. Export a new corrected version while preserving this draft.
```

## Reinspection

Confirm the entire accidental instruction panel is gone, enforcement has only one control, family timing preference is no longer attributed to admin, and the unchanged accounting facts remain readable. Ensure the added family timing caption stays within the family panel without shrinking it to microtext. Inspect the actual corrected image before final acceptance.

## Final corrected export — accepted

Visually inspected `illustrations/05-tokenomics.png` on 6 November 2026. **Accepted.**

- The accidental `FACTUAL LIMITS` panel and its dense instruction paragraph are completely removed.
- Admin now has one `Enforce budgets` control, with ON/OFF behavior shown as explanatory text. The allowance, spending ceiling and cost-visibility controls remain readable.
- `Family setting: show seconds` is correctly placed within the family meter; the admin panel no longer owns that preference.
- Pre-dispatch metering, distinct chat/embedding/Pinecone usage, durable receipts, versioned-cost estimates, missing-not-zero usage, useful/failure settlement and retained provider costs all survive the edit.
- Seed policy, enforcement prerequisite, credit-versus-dollar/reward distinction and numeric-only telemetry are preserved.
- No dates, personal data or invented measured balances appear. The final image has readable labels, clear margins and no clipped content.

No further corrections are required. The detailed limits in the companion remain authoritative for tariff reconciliation, precise timing boundaries and sample interpretation.

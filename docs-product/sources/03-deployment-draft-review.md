# Figure 03 draft review

Reviewed `drafts/03-aws-deployment-v1.png` visually against [the content contract](03-deployment-contract.md). **Status: revise before final delivery.** The design, essential labels and primary request paths work well; three relationships/boundaries need targeted correction.

## Required corrections

1. **ECR → frontend missing.** The visible dashed image-pull path connects Private ECR to API only. Both services deploy from private ECR; retain that path and add a distinct dashed arrow into Frontend ECS Fargate.
2. **Route 53 and ACM paths are not independently traceable to both ALBs.** Route 53 appears to send two dashed branches toward the App ALB. ACM's dashed paths merge toward the API ALB. We cannot verify the required four relationships: Route 53 → App ALB, Route 53 → API ALB, ACM → App ALB, ACM → API ALB. Redraw these as four unambiguous configuration paths; each service has two destinations. Preserve the GoDaddy → Route 53 delegation arrow. Do not insert DNS into either solid browser-request path.
3. **Managed AWS services appear inside the VPC boundary.** The large rounded outline headed “Existing VPC” currently extends down around Private ECR, Secrets Manager and CloudWatch Logs. Shorten that VPC outline to end above this managed-services band. Keep the separate outer AWS outline unchanged so the band remains in AWS but outside the VPC. Public tasks, both ALBs, private RDS and the gateway stay in/at the VPC.

## Passed checks

- Exact `habitquest.quest` / `api.habitquest.quest` labels, two ALBs, and separate solid browser-to-app/browser-to-API HTTPS paths.
- No frontend-to-API proxy line.
- One frontend task with 0.25 vCPU / 0.5 GiB and one API task with 0.5 vCPU / 1 GiB. Correct target ports 8080 and 8000.
- Both ALBs and both tasks are inside the frame labeled “2 public application subnets”; public task IPs and ALB-only ingress are explicit.
- Private PostgreSQL 18.6, `db.t4g.micro`, 1 GiB, 20 GiB encrypted gp3, Single-AZ; API → database TLS 5432.
- API → internet gateway → OpenAI/Nebius/Pinecone is explicit outbound HTTPS; no NAT illustrated.
- Secrets Manager arrow reaches only API and correctly says execution-role injection / API startup.
- Logs flow from the task side toward CloudWatch, with seven-day retention.
- The November 2026 implemented-demo status, solid/dashed legend and “Not production HA” qualifier are visible.
- Clear, readable typography, consistent marker/ink style and good overall spacing; no account identifiers, credentials or unsupported latency claims.

## Minimal correction prompt

```text
Edit this existing illustration. Preserve all artwork, colors, labels, numeric values, domains, browser paths, task/database/provider positions and the bottom legend. Make ONLY these three relationship corrections:

1. In the lower deployment band, keep the existing dashed purple Private ECR → API task arrow and add a clear separate dashed purple Private ECR → Frontend task arrow. Terminate the new arrow on the Frontend ECS Fargate crate, not on its ALB or a log line. Both services get their immutable images from ECR.

2. Replace only the confusing dashed connections between Route 53, Shared ACM certificate and the ALBs. Draw FOUR independently traceable thin dashed purple configuration arrows: Route 53 → App ALB; Route 53 → API ALB; Shared ACM certificate → App ALB; Shared ACM certificate → API ALB. Use tidy branched routes with clearly distinguishable origins and arrowheads at each ALB; avoid accidental shared junctions between DNS and certificate lines. Retain the GoDaddy → Route 53 “Delegated DNS” arrow. Leave both solid Browser HTTPS arrows untouched. Do not draw request traffic through DNS or ACM.

3. Move the bottom edge of the rounded “Existing VPC” outline upward so it ends immediately above the row containing Private ECR, Secrets Manager and CloudWatch Logs. Those three managed services must be outside the VPC outline but still inside the separate outer AWS outline. Preserve the outer AWS boundary. Preserve the existing public-subnet grouping around the ALBs/tasks and the private database grouping. Keep the internet gateway at the VPC edge.

Do not change any text or numbers, add new services, or alter the correct API → RDS TLS, API → gateway → providers, Secrets Manager → API and tasks → CloudWatch directions. Use small line bridges where unavoidable crossings would otherwise suggest a junction. Export as a new version, preserving this draft.
```

After the edit, re-check the actual image for all six ECR/DNS/ACM target relationships and for the two nested boundaries. A generation result is not considered corrected merely because its prompt requests these changes.

## Final-candidate review — date-free export

Inspected the actual `illustrations/03-aws-deployment.png`, including the subtitle, boundaries and deployment routes. The user-requested **date-free ribbon is accepted**: it reads “Implemented demo,” and no implementation date is present in the artwork. The VPC outline now ends above the managed-services row, correctly leaving ECR, Secrets Manager and CloudWatch inside AWS but outside the VPC. All runtime sizes, hostnames, private database details, browser request paths, secret-injection wording, provider egress and the legend remain intact.

The certificate/DNS configuration lines remain visually busy, especially where they pass behind the public-subnet heading, but ALB configuration is distinct from solid browser traffic. No further layout-only regeneration is recommended.

**One final relationship needs confirmation before full acceptance:** two dashed ECR strokes emerge from the registry and converge near the vertical route beside the task crates. The frontend has a visible dashed arrowhead. A separate dashed ECR arrowhead into API is not clearly visible; the large blue arrow entering API is its ALB request path. Root has been asked to inspect this specific endpoint. If it is absent, the smallest correction is one short dashed purple branch from the ECR image-pull route into the left edge of the API crate, separate from the solid blue API request arrow. Preserve the rest of the accepted figure.

## Final acceptance — ECR branch corrected

Reinspected the updated actual `illustrations/03-aws-deployment.png`. **Accepted for delivery.** The ECR image-pull route now has an explicit purple junction and a separate dashed right-pointing arrow into the API crate below its solid blue ALB request arrow. The existing ECR → frontend arrow remains visible, so both image-pull destinations are represented.

The date-free “Implemented demo” ribbon, corrected VPC boundary, separate browser request paths, shared DNS/certificate configuration, backend-only startup secret injection, private RDS, provider egress, runtime labels and legend remain preserved. No new material error was introduced by the targeted correction. The retained intermediate review above documents the superseded candidates rather than an outstanding issue in the accepted export.

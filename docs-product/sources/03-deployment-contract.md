# Figure 03 — HabitQuest AWS deployment

## Purpose and status

**Viewer question:** How does a browser reach HabitQuest, where does its data live, and how do the containers reach AI providers without exposing credentials or PostgreSQL?

**Status:** Implemented development/demo architecture recorded **November 6, 2026**. This illustration documents retained deployment evidence; it performs no new AWS checks. It must not imply production high availability or guaranteed latency.

**Deliverable:** A standalone landscape 16:9 illustrated explainer, consistent with the existing HQ AI services white-paper, dark-ink, blue/purple marker treatment. Keep readable essential labels, semantic objects, generous margins, and approximately 190 visible words or fewer.

## Source of truth

- [Final deployment design](../../../habbit-quest/docs-design/13-aws-deployment.md): endpoints, boundaries, runtime sizes, secret injection, database and release process.
- [DNS and HTTPS execution](../../../hq-deployment/docs/28-domain-https.md): apex/API hostnames, Route 53 delegation, two ALBs and shared ACM certificate.
- [Google OAuth setup](../../../hq-deployment/docs/29-google-oauth.md): browser public client identifier; the stored client secret is not consumed by the GIS ID-token flow.
- [Latest application release](../../../hq-deployment/docs/30-coach-credits-and-automatic-habits.md): final November 6 release and readiness scope.
- [Public verification evidence](../../../hq-deployment/evidence/https-coach-credits-verification.json): recorded healthy app/API paths, task images and database-backed readiness.
- [Public application configuration](../../../hq-deployment/environments/dev-application-oauth-configuration.json) and [API template](../../../hq-deployment/cloudformation/https-coach-credits-api.json) / [frontend template](../../../hq-deployment/cloudformation/https-coach-credits-frontend.json): repeatable implementation references. Do not reproduce identifiers or secret references in the illustration.

Style reference only: [old service illustration](../../../hq-ai-services/docs/planning-agent/illustrations/01-service-architecture.png). Its historical “proposed” deployment and Deep Agents content are not facts about this figure.

## Composition

Use a browser outside the AWS boundary on the left, a central AWS/VPC scene with two parallel public app/API lanes, a private database alcove below the API, and external providers at the right. Keep a small deployment-services band below the VPC, inside AWS. Route 53 and the shared certificate sit above the two ALBs. An external GoDaddy registrar note points to Route 53 with a clearly labeled dashed delegation line.

Draw recognizable objects: browser screen, two gate arches for ALBs, two container crates, locked database cylinder, key vault, image registry shelf, logbook, certificate ribbon and an internet gateway. Light frames group actual boundaries; they are not the primary illustration.

The public-subnet boundary encompasses **both ALBs and both Fargate services**. The private database alcove is inside the VPC but outside that public boundary. ECR, Secrets Manager, ACM, Route 53 and CloudWatch are AWS managed services outside the VPC frame. Do not draw either public subnet as holding a complete duplicate deployment: steady-state desired count is one task per service, not one per subnet.

## Exact visible text inventory

Use the following wording. Line breaks are flexible. Essential quantities and domain strings are exact.

```text
HabitQuest on AWS
Implemented demo
Browser
GoDaddy registrar
Delegated DNS
Route 53
AWS · us-east-1
Shared ACM certificate
Existing VPC
2 public application subnets
habitquest.quest
App ALB
api.habitquest.quest
API ALB
HTTPS
Frontend · ECS Fargate
NGINX · :8080
1 task · 0.25 vCPU · 0.5 GiB
Public Vite config only
API · ECS Fargate
FastAPI · :8000
1 task · 0.5 vCPU · 1 GiB
Public task IPs · ALB-only ingress
Private database subnets
RDS PostgreSQL 18.6
db.t4g.micro · 1 GiB
20 GiB encrypted gp3 · Single-AZ
TLS · :5432
Internet gateway
Outbound HTTPS
OpenAI · Nebius · Pinecone
Private ECR
Immutable images
Secrets Manager
Execution-role injection · API startup
CloudWatch Logs
7-day retention
Solid: request/data
Dashed: deploy/config
Always-on demo · No NAT · Not production HA
```

“HTTPS” may appear on each of the two browser request lines. Use one certificate with two dashed branches. Keep the long domain names large enough to distinguish the apex from the API subdomain. The status ribbon must say only “Implemented demo”; do not render implementation or review dates anywhere in the artwork. Dates in this contract are internal provenance only. Optional public S3 buddy artwork is deliberately omitted from the main image to preserve the core network story; its actual direct-browser fetch path is covered in the system overview figure and companion design docs.

## Required arrow semantics

| Source → destination | Style / meaning |
| --- | --- |
| GoDaddy → Route 53 | Thin dashed purple, “Delegated DNS”; registrar delegation, not HTTP traffic |
| Route 53 → each named ALB endpoint | Thin dashed purple; DNS alias configuration, not a request proxy |
| Shared ACM certificate → both ALBs | Dashed; same certificate attached to two separate listeners |
| Browser → app ALB → frontend task | Solid blue request path, public HTTPS terminates at ALB; task target port 8080 |
| Browser → API ALB → API task | Separate solid blue request path, public HTTPS terminates at ALB; task target port 8000 |
| API task → private RDS | Solid blue; SQL over TLS on 5432, constrained by task/DB security groups |
| API task → internet gateway → providers | Solid blue; outbound HTTPS using public task IP, not a NAT gateway |
| ECR → both tasks | Dashed purple; immutable images pulled for deployment |
| Secrets Manager → API task only | Dashed purple; ECS execution-role injection at task startup |
| Both tasks → CloudWatch | Solid thin blue; runtime logs, not secret/config injection |

The browser arrows are independent. **There is no frontend-container → API arrow.** Browser JavaScript calls the API directly. The API's private RDS path remains entirely inside the VPC. Runtime provider HTTPS exits the VPC through the internet gateway. Application response arrows can be implicit to avoid doubling the visual clutter; the arrows explain request paths.

## Companion detail, outside the artwork

- HTTP redirects to the canonical HTTPS hosts; exact HTTPS host rules forward, unknown HTTPS hosts reject. API CORS is scoped to the production frontend origin; protected routes still require application authentication.
- Task public IPs support economical egress; the task ports accept ingress only from their own ALB security group. Public subnet placement does not make the application container ports unrestricted public endpoints.
- RDS is always-on PostgreSQL, not Aurora Serverless. Database connections use `verify-full` TLS and a restricted `hq_runtime` NOINHERIT login. App/API ALBs do not expose PostgreSQL to a laptop.
- Secrets reach the API through ECS task-definition secret references and the execution role. Frontend public Vite build configuration contains no provider/database/admin secrets. The separate stored OAuth client secret is not used by the current browser ID-token flow.
- Both services retain one steady-state task. Rolling replacement and the circuit breaker improve releases but do not turn this into a multi-replica or Multi-AZ database architecture.
- CloudFormation and release scripts own the repeatable setup. Containers do not run schema migrations or catalog seeding on startup.
- Public readiness evidence establishes routes, containers and database access. It does not establish paid-provider key entitlement, AI quality, generation timing or universal sign-in success.

## Caption and alt text

**Caption:** HabitQuest's implemented AWS demo, recorded November 6, 2026. Two public HTTPS ALBs serve the frontend and API independently. Public-subnet Fargate tasks use security-group-restricted ingress and internet-gateway egress; PostgreSQL remains private. Dashed lines distinguish deployment/configuration from runtime traffic.

**Alt text:** A browser independently connects to the habitquest.quest app ALB and api.habitquest.quest API ALB. Both use one shared ACM certificate and Route 53 DNS delegated from GoDaddy. Within an AWS VPC, separate public-subnet Fargate containers serve the frontend and API. The API connects privately to Single-AZ RDS PostgreSQL over TLS and reaches OpenAI, Nebius and Pinecone over outbound HTTPS through an internet gateway. ECR supplies both images, Secrets Manager injects only API secrets at startup, and both services emit CloudWatch logs. The always-on demo uses one task per service and no NAT gateway.

## Visual QA acceptance

- [ ] Two ALBs, exact apex/API hostnames, one shared ACM certificate.
- [ ] Browser has two direct request paths; no frontend API proxy or DNS-in-request chain.
- [ ] Both tasks and ALBs are inside public-subnet grouping; RDS is private.
- [ ] Task sizes and database version/class/storage/Single-AZ labels match the inventory.
- [ ] One task per service; no duplicate task artwork implying two per service.
- [ ] Internet gateway, public task IPs and ALB-only task ingress are explicit; no NAT or private-subnet task depiction.
- [ ] Secrets arrow ends at API only and states execution-role startup injection.
- [ ] ECR feeds both tasks; task logs feed CloudWatch, not the reverse.
- [ ] TLS label is on API → RDS, public HTTPS on browser → ALBs; no claim of ALB-to-task TLS.
- [ ] Request and deployment/config lines are visually distinguishable and legend matches them.
- [ ] No account IDs, ARNs, credentials, exact IPs, invented cloud components or fresh-verification claims.
- [ ] No old “proposed,” Deep Agents, Aurora, NAT, multi-AZ database or production-HA implication.
- [ ] Status ribbon reads only “Implemented demo”; no dates appear in the artwork.
- [ ] Actual export inspected for legibility, spelling, clipping, arrows and safe margins.

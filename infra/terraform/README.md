# AMIVARA infrastructure (Terraform)

**Region:** AWS Africa (Cape Town) `af-south-1` · **Edge:** CloudFront (Lagos) · see [ARCHITECTURE.md §6](../../docs/ARCHITECTURE.md)

> **Status: written, not applied.** CI runs `terraform fmt -check` and `terraform validate` only. No AWS credentials exist in this repo or in CI.

## Request path

```
member ─▶ CloudFront (Lagos edge, WAF) ─┬─ amivara.com / www      ─▶ web-origin.*  ─▶ ALB ─▶ ECS web   (Next.js)
                                        ├─ api.amivara.com        ─▶ api-origin.*  ─▶ ALB ─▶ ECS api   (NestJS) ─▶ RDS · Redis · S3
                                        └─ media.amivara.com      ─▶ S3 (OAC, signed URLs)
staff (office/VPN CIDRs) ─▶ admin.amivara.com ─▶ ALB (source-IP rule) ─▶ ECS admin
```

The ALB only accepts:
- HTTPS from CloudFront's origin-facing IP ranges, **and** only with the secret `X-Origin-Verify` header, so nobody can bypass the WAF by calling the ALB directly
- the admin host from `admin_allowed_cidrs`

Everything else gets a 403.

## What's here

| File | Resources |
|---|---|
| `main.tf` | VPC across 3 AZs (public, private and database subnets, NAT), the application-tier security group, KMS key for data |
| `database.tf` | RDS for PostgreSQL 16 (gp3, encrypted, Multi-AZ in prod, master password managed in Secrets Manager, `rds.force_ssl`, PITR with 30-day retention, optional read replica). PostGIS is enabled by the first Prisma migration |
| `cache.tf` | ElastiCache for Redis 7.1 (encrypted at rest and in transit, Multi-AZ failover in prod) |
| `storage.tf` | Private S3 media bucket (SSE-KMS, versioning, public access blocked, TLS-only, CloudFront OAC read, CORS for pre-signed uploads, lifecycle cleanup) |
| `cdn.tf` | CloudFront for **web** (Next.js cache headers, long cache for `/_next/static`), **API** (caching off, WebSockets) and **media** (OAC, signed URLs), all with `PriceClass_All` for the Lagos edges and HTTP/3. Plus the edge WAF: per-IP rate limit, a separate OTP-path rate limit, and AWS managed rules |
| `dns.tf` | Route 53 zone, ACM certificates (us-east-1 for CloudFront, af-south-1 for the ALB) with DNS validation, alias records, SES domain identity with DKIM and DMARC |
| `alb.tf` | Public ALB (TLS 1.3 policy, `drop_invalid_header_fields`), target groups, host and header listener rules, security groups |
| `ecs.tf` | ECR repositories (immutable tags, scan on push), the ECS cluster (Fargate, plus Fargate Spot outside prod), ARM64 task definitions, the api, web and admin services with circuit-breaker rollback, CPU autoscaling, and 30-day log groups |
| `iam.tf` | Execution role (pull images, write logs, read the injected secrets) and task roles (API: S3 media, media KMS, SES, runtime secrets; web and admin: nothing). ECS Exec outside prod only |
| `secrets.tf` | Secrets Manager containers for Smile ID, the OTP provider, JWT keys and the media signing key, plus the generated origin-verify header secret |
| `github.tf` | GitHub Actions OIDC provider and deploy role, limited to the GitHub Environment of the same name |
| `monitoring.tf` | SNS alerts topic with optional email, and alarms for ALB 5xx, unhealthy targets, and RDS CPU, storage and connections |

**Still to come:**
- Redis and CloudFront alarms (CloudFront metrics live in us-east-1)
- A BullMQ worker service, once the worker entry point exists
- SSO in front of the admin console (ALB OIDC authentication, once an identity provider is chosen)
- Cross-region backup copies (undecided, see ARCHITECTURE.md §6.4)

## Guardrails built in

- `region` can't be anything other than `af-south-1`. Changing it needs a DPIA update (NDPA cross-border transfer).
- `environment = "prod"` forces:
  - Multi-AZ RDS with deletion protection
  - One NAT gateway per AZ
  - 2 or more Redis nodes
  - At least 2 tasks per service
  - On-demand Fargate (no Spot)
  - No ECS Exec
  - Signed media URLs (the plan fails without a public key)
- Data stores accept connections only from the application security group. Nothing is publicly accessible.
- Secret **values** never pass through Terraform. It creates empty secrets; an admin sets the values.
- The CD role can push images and roll services, but it **can't change infrastructure**.

## How deploys work

1. CD (GitHub Actions, in the `staging` or `prod` GitHub Environment) assumes `github_deploy_role_arn` through OIDC.
2. It builds **ARM64** images and pushes them to ECR with an immutable tag (the git SHA).
3. It runs `prisma migrate deploy` as a one-off ECS task, using the api task definition with a command override.
4. It copies the **latest** task-definition revision of each family with the new image, registers it, and updates the service. The circuit breaker rolls back failed deploys automatically.

Because of step 4, Terraform ignores each service's `task_definition` and `desired_count`. A change made here to a container's env, secrets or size registers a new revision, and the next CD deploy rolls it out.

## First-time setup (needs the founder or an AWS admin)

1. **Register the domain** (`amivara.com` is a placeholder in `environments/*.tfvars` until ownership is confirmed).
2. Create the AWS Organization with `dev`, `staging` and `prod` accounts, and set up billing alerts.
3. **Enable the `af-south-1` opt-in region** in each account (Account → AWS Regions). Nothing can be created there until this is done.
4. Create the state bucket `amivara-terraform-state-<ACCOUNT_ID>` in `af-south-1` (versioned, encrypted, public access blocked).
5. `cp environments/staging.backend.hcl.example environments/staging.backend.hcl` and fill in the account ID.
6. Create the DNS zone first, then delegate it:
   - Run `terraform apply -var-file=environments/staging.tfvars -target=aws_route53_zone.main`.
   - Delegate the `name_servers` output: for prod at the registrar; for `staging.amivara.com`, as NS records in the prod zone.
7. Run the full `plan` and `apply` (certificates validate once the delegation is live). Services stay at 0 tasks.
8. Set the values of the secrets listed in `secrets_to_populate`.
9. Push the first images via CD, then set `services_enabled = true` and apply.
10. In GitHub:
    - Create the `staging` and `prod` Environments, each with its deploy role ARN.
    - Require reviewers on `prod`.

## Usage

```sh
cd infra/terraform
terraform init -backend-config=environments/staging.backend.hcl
terraform plan  -var-file=environments/staging.tfvars -out=staging.plan
terraform apply staging.plan        # only after review; never from a laptop for prod
```

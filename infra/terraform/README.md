# AMIVARA infrastructure (Terraform)

**Region:** AWS Africa (Cape Town) `af-south-1` · **Edge:** CloudFront (Lagos) · see [ARCHITECTURE.md §6](../../docs/ARCHITECTURE.md)

> **Status: scaffold. Nothing has been applied.** CI runs `terraform fmt -check` and `terraform validate` only. No AWS credentials exist in this repo or in CI.

## What's here

| File | Resources |
|---|---|
| `main.tf` | VPC across 3 AZs (public, private and database subnets, NAT), the application-tier security group, KMS key for data |
| `database.tf` | RDS for PostgreSQL 16 (gp3, encrypted, Multi-AZ in prod, master password managed in Secrets Manager, `rds.force_ssl`, PITR with 30-day retention, optional read replica). PostGIS is enabled by the first Prisma migration |
| `cache.tf` | ElastiCache for Redis 7.1 (encrypted at rest and in transit, Multi-AZ failover in prod) |
| `storage.tf` | Private S3 media bucket (SSE-KMS, versioning, public access blocked, TLS-only, CloudFront OAC read, CORS for pre-signed uploads, lifecycle cleanup) |
| `cdn.tf` | CloudFront media distribution (`PriceClass_All` for the Lagos edges, OAC, signed URLs, HTTP/3) plus the edge WAF (rate limiting and AWS managed rules, in `us-east-1` as CloudFront requires) |

**Not yet included** (the next infra iteration, together with the services):
- ECS Fargate services and the ALB for the API, workers, web and admin
- CloudFront distributions for the web apps and the API
- ACM certificates and Route 53
- SES
- Secrets Manager entries for Smile ID and the OTP provider
- CloudWatch alarms
- GitHub OIDC deploy role

## Guardrails built in

- `region` can't be anything other than `af-south-1`. Changing it needs a DPIA update (NDPA cross-border transfer).
- `environment = "prod"` forces:
  - Multi-AZ RDS with deletion protection
  - One NAT gateway per AZ
  - 2 or more Redis nodes
  - Signed media URLs (the plan fails without a public key)
- Data stores accept connections only from the application security group. Nothing is publicly accessible.

## First-time setup (needs the founder or an AWS admin)

1. Create the AWS Organization with `dev`, `staging` and `prod` accounts, and set up billing alerts.
2. **Enable the `af-south-1` opt-in region** in each account (Account → AWS Regions). Nothing can be created there until this is done.
3. Create the state bucket `amivara-terraform-state-<ACCOUNT_ID>` in `af-south-1` (versioned, encrypted, public access blocked).
4. `cp environments/staging.backend.hcl.example environments/staging.backend.hcl` and fill in the account ID.

## Usage

```sh
cd infra/terraform
terraform init -backend-config=environments/staging.backend.hcl
terraform plan  -var-file=environments/staging.tfvars -out=staging.plan
terraform apply staging.plan        # only after review; never from a laptop for prod
```

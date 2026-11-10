variable "environment" {
  description = "Deployment environment."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "region" {
  description = "Primary AWS region. Locked to Cape Town by founder decision (ARCHITECTURE.md §6.1)."
  type        = string
  default     = "af-south-1"

  validation {
    condition     = var.region == "af-south-1"
    error_message = "AMIVARA member data must live in af-south-1 (Cape Town). Changing region needs a DPIA update."
  }
}

variable "vpc_cidr" {
  description = "CIDR block for the environment VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "single_nat_gateway" {
  description = "Use one NAT gateway instead of one per AZ (cheaper; acceptable outside prod)."
  type        = bool
  default     = true
}

# ── PostgreSQL ──────────────────────────────────────────────

variable "postgres_engine_version" {
  description = "RDS PostgreSQL major version (minor versions auto-upgrade in the maintenance window)."
  type        = string
  default     = "16"
}

variable "db_instance_class" {
  description = "RDS instance class for the primary."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage_gb" {
  description = "Initial gp3 storage in GB. Storage autoscaling grows it up to db_max_allocated_storage_gb."
  type        = number
  default     = 50
}

variable "db_max_allocated_storage_gb" {
  description = "Upper limit for RDS storage autoscaling."
  type        = number
  default     = 500
}

variable "db_multi_az" {
  description = "Run the RDS primary Multi-AZ."
  type        = bool
  default     = false
}

variable "db_create_read_replica" {
  description = "Create a read replica for discovery reads (ARCHITECTURE.md §4)."
  type        = bool
  default     = false
}

variable "db_deletion_protection" {
  description = "Protect the database from deletion. Always true in prod."
  type        = bool
  default     = true
}

variable "db_backup_retention_days" {
  description = "Automated backup (PITR) retention. SECURITY.md: backups age out within 35 days."
  type        = number
  default     = 30

  validation {
    condition     = var.db_backup_retention_days >= 7 && var.db_backup_retention_days <= 35
    error_message = "Backup retention must be 7–35 days (SECURITY.md §4)."
  }
}

# ── Redis ───────────────────────────────────────────────────

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.small"
}

variable "redis_num_cache_clusters" {
  description = "Number of Redis nodes (1 primary + replicas). 2+ enables Multi-AZ automatic failover."
  type        = number
  default     = 1
}

# ── Media / CDN ─────────────────────────────────────────────

variable "web_origins" {
  description = "Browser origins allowed to PUT media to S3 with pre-signed URLs (CORS)."
  type        = list(string)
  default     = []
}

variable "media_signing_public_key_pem" {
  description = "Public key (PEM) for CloudFront signed URLs/cookies on private media. The private key lives in Secrets Manager. Null disables signing (dev only)."
  type        = string
  default     = null
}

variable "waf_rate_limit_per_5min" {
  description = "Requests per 5 minutes per IP before the WAF blocks it at the edge."
  type        = number
  default     = 2000
}

# ── DNS & certificates ──────────────────────────────────────

variable "domain_name" {
  description = "Root domain for this environment, e.g. amivara.com (prod) or staging.amivara.com. A Route 53 zone is created for it; delegate its name servers at the registrar (or parent zone) before the certificates can validate."
  type        = string
}

# ── Application tier (ECS Fargate) ──────────────────────────

variable "services_enabled" {
  description = "Run the ECS services. Keep false until images are in ECR and the Secrets Manager values are populated; then set true and apply (autoscaling raises each service to its minimum)."
  type        = bool
  default     = false
}

variable "bootstrap_image_tag" {
  description = "Image tag used in the Terraform-managed task definitions. CD registers new revisions with real image tags afterwards."
  type        = string
  default     = "bootstrap"
}

variable "api_cpu" {
  description = "API task CPU units (Fargate)."
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "API task memory (MiB)."
  type        = number
  default     = 1024
}

variable "api_min_count" {
  description = "Minimum API tasks when services are enabled."
  type        = number
  default     = 1
}

variable "api_max_count" {
  description = "Maximum API tasks (CPU target tracking)."
  type        = number
  default     = 4
}

variable "web_cpu" {
  description = "Web (Next.js) task CPU units."
  type        = number
  default     = 512
}

variable "web_memory" {
  description = "Web (Next.js) task memory (MiB)."
  type        = number
  default     = 1024
}

variable "web_min_count" {
  description = "Minimum web tasks when services are enabled."
  type        = number
  default     = 1
}

variable "web_max_count" {
  description = "Maximum web tasks."
  type        = number
  default     = 4
}

variable "admin_allowed_cidrs" {
  description = "Office / VPN egress CIDRs allowed to reach admin.<domain>. Empty means the admin console is unreachable."
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.admin_allowed_cidrs) <= 4
    error_message = "At most 4 admin CIDRs (ALB rule condition limit). Use a VPN with a single egress range."
  }
}

variable "waf_otp_rate_limit_per_5min" {
  description = "Requests per 5 minutes per IP to /v1/auth/otp/* before the edge blocks them. Kept generous because Nigerian carriers put many users behind one CGNAT IP; the per-phone limits in the API are the primary control."
  type        = number
  default     = 300
}

# ── Operations ──────────────────────────────────────────────

variable "alert_email" {
  description = "Email address subscribed to the CloudWatch alarm topic. Null means no subscription."
  type        = string
  default     = null
}

variable "github_repository" {
  description = "GitHub repository (owner/name) allowed to assume the deploy role through OIDC."
  type        = string
  default     = "ksteel1542/amivara"
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub Actions OIDC provider. It can only exist once per AWS account; set false if it already exists."
  type        = bool
  default     = true
}

variable "push_enabled" {
  description = "Inject the FCM service account into the API (set true once the fcm secret has a value). Without it, push is disabled."
  type        = bool
  default     = false
}

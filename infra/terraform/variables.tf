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

environment = "staging"
domain_name = "staging.amivara.com"
vpc_cidr    = "10.41.0.0/16"

single_nat_gateway     = true
db_instance_class      = "db.t4g.medium"
db_multi_az            = false
db_create_read_replica = false
db_deletion_protection = true

redis_node_type          = "cache.t4g.small"
redis_num_cache_clusters = 1

web_origins = ["https://staging.amivara.com"]

# Flip to true once images are in ECR and the Secrets Manager values are set.
services_enabled = false

# Office / VPN egress ranges for admin.staging.amivara.com (max 4).
admin_allowed_cidrs = []

# The OIDC provider exists once per AWS account. staging and prod are separate
# accounts, so each creates its own.
create_github_oidc_provider = true

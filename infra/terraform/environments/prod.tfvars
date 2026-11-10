environment = "prod"
domain_name = "amivara.com"
vpc_cidr    = "10.42.0.0/16"

# prod forces: one NAT per AZ, Multi-AZ RDS, deletion protection, 2+ Redis nodes,
# and signed media URLs (see locals.is_prod in main.tf / cdn.tf).
db_instance_class      = "db.m7g.large"
db_create_read_replica = true

redis_node_type          = "cache.m7g.large"
redis_num_cache_clusters = 2

web_origins = ["https://amivara.com", "https://www.amivara.com"]

# Required in prod. Generate the key pair, keep the private key in Secrets Manager.
# media_signing_public_key_pem = file("keys/media-signing-prod.pub.pem")

services_enabled = false

api_min_count = 2
api_max_count = 10
web_min_count = 2
web_max_count = 6

admin_allowed_cidrs = []

create_github_oidc_provider = true

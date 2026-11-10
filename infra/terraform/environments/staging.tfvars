environment = "staging"
vpc_cidr    = "10.41.0.0/16"

single_nat_gateway     = true
db_instance_class      = "db.t4g.medium"
db_multi_az            = false
db_create_read_replica = false
db_deletion_protection = true

redis_node_type          = "cache.t4g.small"
redis_num_cache_clusters = 1

web_origins = ["https://staging.amivara.com"]

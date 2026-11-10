# ElastiCache for Redis: OTP throttling, sessions, presence, discovery cache,
# BullMQ queues and WebSocket pub/sub (ARCHITECTURE.md §4).

resource "aws_security_group" "redis" {
  name_prefix = "${local.name}-redis-"
  description = "Redis: application tier only"
  vpc_id      = module.vpc.vpc_id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_app" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  description                  = "Redis from the application tier"
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.name}-redis"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${local.name}-redis"
  description          = "AMIVARA ${var.environment} cache, queues and presence"

  engine               = "redis"
  engine_version       = "7.1"
  parameter_group_name = "default.redis7"
  node_type            = var.redis_node_type
  port                 = 6379

  num_cache_clusters         = local.is_prod ? max(2, var.redis_num_cache_clusters) : var.redis_num_cache_clusters
  automatic_failover_enabled = local.is_prod || var.redis_num_cache_clusters > 1
  multi_az_enabled           = local.is_prod || var.redis_num_cache_clusters > 1

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.data.arn
  transit_encryption_enabled = true

  snapshot_retention_limit   = 7
  snapshot_window            = "00:00-01:00"
  maintenance_window         = "sun:03:30-sun:04:30"
  auto_minor_version_upgrade = true
}

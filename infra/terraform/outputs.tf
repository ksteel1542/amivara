output "vpc_id" {
  value = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "Subnets for ECS tasks."
  value       = module.vpc.private_subnets
}

output "app_security_group_id" {
  description = "Attach to ECS tasks so they can reach PostgreSQL and Redis."
  value       = aws_security_group.app.id
}

output "postgres_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "postgres_replica_endpoint" {
  value = try(aws_db_instance.replica[0].endpoint, null)
}

output "postgres_master_secret_arn" {
  description = "Secrets Manager secret holding the RDS master credentials (rotated by RDS)."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "redis_primary_endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "media_bucket" {
  value = aws_s3_bucket.media.bucket
}

output "media_cdn_domain" {
  description = "CloudFront domain for media (CLOUDFRONT_MEDIA_DOMAIN in the API)."
  value       = aws_cloudfront_distribution.media.domain_name
}

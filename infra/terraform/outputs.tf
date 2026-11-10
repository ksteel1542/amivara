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

# ── DNS & edge ──────────────────────────────────────────────

output "name_servers" {
  description = "Delegate the domain (or subdomain) to these name servers before certificates can validate."
  value       = aws_route53_zone.main.name_servers
}

output "web_urls" {
  value = [for h in local.web_hostnames : "https://${h}"]
}

output "api_url" {
  value = "https://${local.api_hostname}/v1"
}

output "admin_url" {
  value = "https://${local.admin_hostname}"
}

output "web_distribution_id" {
  description = "For CD cache invalidations after a web deploy."
  value       = aws_cloudfront_distribution.web.id
}

# ── Application tier / CD ───────────────────────────────────

output "ecr_repositories" {
  value = { for k, r in aws_ecr_repository.svc : k => r.repository_url }
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "ecs_services" {
  value = { for k, s in aws_ecs_service.svc : k => s.name }
}

output "github_deploy_role_arn" {
  description = "Set as the AWS role for the matching GitHub Environment (staging / prod)."
  value       = aws_iam_role.github_deploy.arn
}

output "migration_task_network" {
  description = "Network settings for the one-off `prisma migrate deploy` task (ecs run-task)."
  value = {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.app.id]
  }
}

output "secrets_to_populate" {
  description = "Secrets Manager entries whose values must be set out of band before services_enabled = true."
  value       = { for k, s in aws_secretsmanager_secret.app : k => s.name }
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

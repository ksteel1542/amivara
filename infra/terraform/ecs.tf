# ECS on Fargate (ARM64 / Graviton) for the API, web and admin apps.
#
# Deploys: CD (GitHub Actions, OIDC role in github.tf) pushes an image to ECR,
# copies the latest task-definition revision of the family with the new image,
# registers it and updates the service. Terraform therefore ignores the
# service's task_definition and desired_count. Container settings changed here
# (env, secrets, CPU) register a new revision that the next CD deploy picks up.

locals {
  node_env = local.is_prod ? "production" : "staging"

  services = {
    api   = { port = 4000, health_path = "/health", cpu = var.api_cpu, memory = var.api_memory, min = var.api_min_count, max = var.api_max_count }
    web   = { port = 3000, health_path = "/", cpu = var.web_cpu, memory = var.web_memory, min = var.web_min_count, max = var.web_max_count }
    admin = { port = 3001, health_path = "/", cpu = 256, memory = 512, min = 1, max = 2 }
  }

  rds_secret_arn = aws_db_instance.main.master_user_secret[0].secret_arn

  container_env = {
    api = {
      NODE_ENV                = local.node_env
      PORT                    = "4000"
      AWS_REGION              = var.region
      DB_HOST                 = aws_db_instance.main.address
      DB_PORT                 = tostring(aws_db_instance.main.port)
      DB_NAME                 = aws_db_instance.main.db_name
      REDIS_URL               = "rediss://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
      S3_MEDIA_BUCKET         = aws_s3_bucket.media.bucket
      CLOUDFRONT_MEDIA_DOMAIN = local.media_hostname
      SMILE_ID_ENVIRONMENT    = local.is_prod ? "production" : "sandbox"
      SMILE_ID_CALLBACK_URL   = "https://${local.api_hostname}/v1/verification/webhook"
      PHONE_COUNTRIES         = "NG"
      TRUST_PROXY_HOPS        = "2"       # CloudFront + ALB
      OTP_PROVIDER            = "console" # until the SMS/WhatsApp provider is chosen (refused in prod by the API)
    }
    web = {
      NODE_ENV                = "production"
      PORT                    = "3000"
      HOSTNAME                = "0.0.0.0"
      NEXT_TELEMETRY_DISABLED = "1"
    }
    admin = {
      NODE_ENV                = "production"
      PORT                    = "3001"
      HOSTNAME                = "0.0.0.0"
      NEXT_TELEMETRY_DISABLED = "1"
    }
  }

  # name => "secret-arn:json-key::"
  container_secrets = {
    api = {
      DB_USERNAME         = "${local.rds_secret_arn}:username::"
      DB_PASSWORD         = "${local.rds_secret_arn}:password::"
      SMILE_ID_PARTNER_ID = "${aws_secretsmanager_secret.app["smile-id"].arn}:partner_id::"
      SMILE_ID_API_KEY    = "${aws_secretsmanager_secret.app["smile-id"].arn}:api_key::"
      JWT_PRIVATE_KEY_PEM = "${aws_secretsmanager_secret.app["jwt"].arn}:private_key_pem::"
      JWT_PUBLIC_KEY_PEM  = "${aws_secretsmanager_secret.app["jwt"].arn}:public_key_pem::"
      HASH_PEPPER         = "${aws_secretsmanager_secret.app["hash-pepper"].arn}:value::"
    }
    web   = {}
    admin = {}
  }
}

# ── Registries ──────────────────────────────────────────────

resource "aws_ecr_repository" "svc" {
  for_each = local.services

  name                 = "amivara/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = !local.is_prod

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "svc" {
  for_each   = aws_ecr_repository.svc
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 30 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

# ── Cluster ─────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = local.is_prod ? "FARGATE" : "FARGATE_SPOT"
    weight            = 1
  }
}

resource "aws_cloudwatch_log_group" "svc" {
  for_each = local.services

  name              = "/amivara/${var.environment}/${each.key}"
  retention_in_days = 30 # SECURITY.md §5: application logs 30 days, PII redacted
}

# ── Task definitions & services ─────────────────────────────

resource "aws_ecs_task_definition" "svc" {
  for_each = local.services

  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = each.key == "api" ? aws_iam_role.api_task.arn : aws_iam_role.frontend_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  volume {
    name = "tmp"
  }

  container_definitions = jsonencode([{
    name      = each.key
    image     = "${aws_ecr_repository.svc[each.key].repository_url}:${var.bootstrap_image_tag}"
    essential = true

    portMappings = [{ containerPort = each.value.port, protocol = "tcp" }]

    environment = [for k, v in local.container_env[each.key] : { name = k, value = v }]
    secrets     = [for k, v in local.container_secrets[each.key] : { name = k, valueFrom = v }]

    # The API runs read-only; Next.js needs a writable .next/cache.
    readonlyRootFilesystem = each.key == "api"
    mountPoints            = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.svc[each.key].name
        awslogs-region        = var.region
        awslogs-stream-prefix = each.key
      }
    }
  }])
}

resource "aws_ecs_service" "svc" {
  for_each = local.services

  name            = each.key
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.svc[each.key].arn
  desired_count   = 0 # raised by autoscaling once services_enabled = true

  capacity_provider_strategy {
    capacity_provider = local.is_prod ? "FARGATE" : "FARGATE_SPOT"
    weight            = 1
  }

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.svc[each.key].arn
    container_name   = each.key
    container_port   = each.value.port
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60
  enable_execute_command             = !local.is_prod
  propagate_tags                     = "SERVICE"

  depends_on = [aws_lb_listener.https, aws_ecs_cluster_capacity_providers.main]

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

# ── Autoscaling (only once services are enabled) ────────────

resource "aws_appautoscaling_target" "svc" {
  for_each = { for k, v in local.services : k => v if var.services_enabled }

  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.svc[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = local.is_prod ? max(2, each.value.min) : each.value.min
  max_capacity       = each.value.max
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each = aws_appautoscaling_target.svc

  name               = "${local.name}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = each.value.service_namespace
  resource_id        = each.value.resource_id
  scalable_dimension = each.value.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 120
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

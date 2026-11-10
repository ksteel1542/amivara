data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name       = "amivara-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id
  azs        = slice(data.aws_availability_zones.available.names, 0, 3)
  is_prod    = var.environment == "prod"

  tags = {
    Project     = "amivara"
    Environment = var.environment
    ManagedBy   = "terraform"
    DataRegion  = "af-south-1"
  }
}

# ── Network ─────────────────────────────────────────────────

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.7"

  name = local.name
  cidr = var.vpc_cidr
  azs  = local.azs

  public_subnets   = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i)]
  private_subnets  = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i + 10)]
  database_subnets = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i + 20)]

  create_database_subnet_group       = true
  create_database_subnet_route_table = true

  enable_nat_gateway   = true
  single_nat_gateway   = local.is_prod ? false : var.single_nat_gateway
  enable_dns_hostnames = true
  enable_dns_support   = true
}

# Security group for the application tier (ECS tasks for the API, workers and
# Next.js apps, added in the next infra iteration). Data stores only accept
# traffic from this group.
resource "aws_security_group" "app" {
  name_prefix = "${local.name}-app-"
  description = "AMIVARA application tier (ECS tasks)"
  vpc_id      = module.vpc.vpc_id

  egress {
    description = "All outbound (NAT for Smile ID, OTP and FCM APIs)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ── Encryption keys ─────────────────────────────────────────

resource "aws_kms_key" "data" {
  description             = "${local.name}: RDS, ElastiCache and Secrets Manager encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "data" {
  name          = "alias/${local.name}-data"
  target_key_id = aws_kms_key.data.key_id
}

# RDS for PostgreSQL 16 + PostGIS (the extension itself is created by the
# first Prisma migration: database/schema/migrations/*_init).

resource "aws_security_group" "database" {
  name_prefix = "${local.name}-db-"
  description = "PostgreSQL: application tier only"
  vpc_id      = module.vpc.vpc_id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "database_from_app" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "PostgreSQL from the application tier"
}

resource "aws_db_parameter_group" "postgres" {
  name_prefix = "${local.name}-pg16-"
  family      = "postgres16"
  description = "AMIVARA PostgreSQL 16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "500" # ms: surface slow discovery queries
  }

  # Statement text can contain personal data; log only DDL.
  parameter {
    name  = "log_statement"
    value = "ddl"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name}-postgres"
  engine         = "postgres"
  engine_version = var.postgres_engine_version
  instance_class = var.db_instance_class

  db_name  = "amivara"
  username = "amivara_admin"
  # Master password is generated and rotated by RDS in Secrets Manager.
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.data.key_id

  allocated_storage     = var.db_allocated_storage_gb
  max_allocated_storage = var.db_max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.data.arn

  multi_az               = local.is_prod ? true : var.db_multi_az
  db_subnet_group_name   = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.postgres.name
  ca_cert_identifier     = "rds-ca-rsa2048-g1"

  iam_database_authentication_enabled = true
  auto_minor_version_upgrade          = true

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "01:00-02:00" # 02:00–03:00 WAT
  maintenance_window      = "sun:02:30-sun:03:30"
  copy_tags_to_snapshot   = true

  deletion_protection       = local.is_prod ? true : var.db_deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-postgres-final"

  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.data.arn
  enabled_cloudwatch_logs_exports = ["postgresql"]
}

resource "aws_db_instance" "replica" {
  count = var.db_create_read_replica ? 1 : 0

  identifier          = "${local.name}-postgres-replica"
  replicate_source_db = aws_db_instance.main.identifier
  instance_class      = var.db_instance_class

  storage_encrypted      = true
  kms_key_id             = aws_kms_key.data.arn
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.postgres.name

  auto_minor_version_upgrade      = true
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.data.arn
  skip_final_snapshot             = true
}

# Application secrets in Secrets Manager (af-south-1), encrypted with the data key.
#
# Terraform creates the secret containers only. Values are set out of band
# (console or `aws secretsmanager put-secret-value`), so they never enter
# Terraform state or this repository. Populate them before services_enabled = true.
#
# The RDS master credentials are separate: RDS creates and rotates that secret itself.

locals {
  app_secrets = {
    "smile-id"      = "Smile ID credentials. JSON keys: partner_id, api_key"
    "otp-provider"  = "SMS / WhatsApp OTP provider credentials. JSON keys: api_key, sender_id"
    "jwt"           = "JWT ES256 signing keys. JSON keys: private_key_pem, public_key_pem"
    "media-signing" = "CloudFront signed-URL key. JSON keys: key_pair_id, private_key_pem"
    "fcm"           = "Firebase Cloud Messaging service account. JSON keys: project_id, client_email, private_key"
    "hash-pepper"   = "HMAC pepper for OTP codes, IPs, device ids and blocked phones. JSON keys: value (64 random hex chars)"
  }
}

resource "aws_secretsmanager_secret" "app" {
  for_each = local.app_secrets

  name                    = "amivara/${var.environment}/${each.key}"
  description             = each.value
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 30
}

# Shared secret CloudFront sends to the ALB, so the ALB only serves traffic
# that came through CloudFront (and therefore through the edge WAF).
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

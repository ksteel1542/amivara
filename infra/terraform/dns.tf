# Route 53, ACM certificates and SES for <domain_name>.
#
# First apply: create the zone, delegate its name servers (output
# `name_servers`) at the registrar or parent zone, then apply the rest.
# Certificate validation waits until the delegation is live.

locals {
  # prod serves the apex and www; other environments serve their own subdomain root.
  web_hostnames   = local.is_prod ? [var.domain_name, "www.${var.domain_name}"] : [var.domain_name]
  api_hostname    = "api.${var.domain_name}"
  media_hostname  = "media.${var.domain_name}"
  admin_hostname  = "admin.${var.domain_name}"
  web_origin_host = "web-origin.${var.domain_name}" # CloudFront → ALB only
  api_origin_host = "api-origin.${var.domain_name}" # CloudFront → ALB only
}

resource "aws_route53_zone" "main" {
  name    = var.domain_name
  comment = "AMIVARA ${var.environment}"
}

# ── Certificates ────────────────────────────────────────────

# CloudFront certificates must be issued in us-east-1.
resource "aws_acm_certificate" "cdn" {
  provider                  = aws.us_east_1
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Regional certificate for the ALB (admin.*, web-origin.*, api-origin.*).
resource "aws_acm_certificate" "alb" {
  domain_name       = "*.${var.domain_name}"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# The apex and the wildcard share one validation record per account, so both
# certificates' options collapse onto the same CNAMEs.
resource "aws_route53_record" "cert_validation" {
  for_each = merge(
    { for o in aws_acm_certificate.cdn.domain_validation_options : o.domain_name => o },
    { for o in aws_acm_certificate.alb.domain_validation_options : o.domain_name => o },
  )

  zone_id         = aws_route53_zone.main.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "cdn" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.cdn.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_acm_certificate_validation" "alb" {
  certificate_arn         = aws_acm_certificate.alb.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# ── Public records ──────────────────────────────────────────

locals {
  cdn_aliases = merge(
    { for h in local.web_hostnames : h => aws_cloudfront_distribution.web },
    { (local.api_hostname) = aws_cloudfront_distribution.api },
    { (local.media_hostname) = aws_cloudfront_distribution.media },
  )
}

resource "aws_route53_record" "cdn" {
  for_each = {
    for pair in setproduct(keys(local.cdn_aliases), ["A", "AAAA"]) : "${pair[0]}|${pair[1]}" => {
      name = pair[0]
      type = pair[1]
    }
  }

  zone_id = aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type

  alias {
    name                   = local.cdn_aliases[each.value.name].domain_name
    zone_id                = local.cdn_aliases[each.value.name].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "alb" {
  for_each = toset([local.admin_hostname, local.web_origin_host, local.api_origin_host])

  zone_id = aws_route53_zone.main.zone_id
  name    = each.value
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# ── Email (SES, af-south-1) ─────────────────────────────────
# New SES accounts start in the sandbox: request production access before launch.

resource "aws_sesv2_email_identity" "main" {
  email_identity = var.domain_name
}

resource "aws_route53_record" "ses_dkim" {
  count = 3

  zone_id = aws_route53_zone.main.zone_id
  name    = "${aws_sesv2_email_identity.main.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_sesv2_email_identity.main.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_route53_record" "dmarc" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 3600
  records = ["v=DMARC1; p=quarantine; adkim=s; aspf=s"]
}

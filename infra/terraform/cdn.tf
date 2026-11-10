# CloudFront distributions: media (S3), web (Next.js on ECS) and API (ECS,
# caching disabled). PriceClass_All is required so that Nigerian members are
# served from the Lagos edge locations (ARCHITECTURE.md §6.1). TLS terminates
# in Lagos; the long haul to Cape Town runs over the AWS backbone.

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "origin_cache_control" {
  name = "Managed-UseOriginCacheControlHeaders-QueryStrings"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

locals {
  cdn_viewer_certificate = {
    acm_certificate_arn      = aws_acm_certificate_validation.cdn.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ── Web (Next.js) ───────────────────────────────────────────

resource "aws_cloudfront_distribution" "web" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  comment         = "AMIVARA ${var.environment} web (Lagos edges)"
  price_class     = "PriceClass_All"
  aliases         = local.web_hostnames
  web_acl_id      = aws_wafv2_web_acl.edge.arn

  origin {
    origin_id   = "web-alb"
    domain_name = local.web_origin_host

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  # Next.js sets Cache-Control itself (static pages, ISR, no-store for dynamic).
  default_cache_behavior {
    target_origin_id           = "web-alb"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.origin_cache_control.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
  }

  # Fingerprinted build assets: cache for as long as possible.
  ordered_cache_behavior {
    path_pattern               = "/_next/static/*"
    target_origin_id           = "web-alb"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = local.cdn_viewer_certificate.acm_certificate_arn
    ssl_support_method       = local.cdn_viewer_certificate.ssl_support_method
    minimum_protocol_version = local.cdn_viewer_certificate.minimum_protocol_version
  }
}

# ── API (REST + WebSockets, never cached) ───────────────────

resource "aws_cloudfront_distribution" "api" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  comment         = "AMIVARA ${var.environment} API (Lagos edges, caching disabled)"
  price_class     = "PriceClass_All"
  aliases         = [local.api_hostname]
  web_acl_id      = aws_wafv2_web_acl.edge.arn

  origin {
    origin_id   = "api-alb"
    domain_name = local.api_origin_host

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 60
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  default_cache_behavior {
    target_origin_id         = "api-alb"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = local.cdn_viewer_certificate.acm_certificate_arn
    ssl_support_method       = local.cdn_viewer_certificate.ssl_support_method
    minimum_protocol_version = local.cdn_viewer_certificate.minimum_protocol_version
  }
}

# ── Media (S3) ──────────────────────────────────────────────

data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${local.name}-media"
  description                       = "AMIVARA media bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Private media is only served with a CloudFront signed URL or cookie.
resource "aws_cloudfront_public_key" "media" {
  count       = var.media_signing_public_key_pem == null ? 0 : 1
  name_prefix = "${local.name}-media-"
  encoded_key = var.media_signing_public_key_pem
  comment     = "AMIVARA media signed URLs"
}

resource "aws_cloudfront_key_group" "media" {
  count = var.media_signing_public_key_pem == null ? 0 : 1
  name  = "${local.name}-media"
  items = [aws_cloudfront_public_key.media[0].id]
}

resource "aws_cloudfront_distribution" "media" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  comment         = "AMIVARA ${var.environment} media (Lagos edges)"
  price_class     = "PriceClass_All"
  web_acl_id      = aws_wafv2_web_acl.edge.arn

  origin {
    origin_id                = "media-s3"
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  default_cache_behavior {
    target_origin_id           = "media-s3"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
    trusted_key_groups         = var.media_signing_public_key_pem == null ? [] : [aws_cloudfront_key_group.media[0].id]
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  aliases = [local.media_hostname]

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.cdn.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  lifecycle {
    precondition {
      condition     = !local.is_prod || var.media_signing_public_key_pem != null
      error_message = "Production media must require CloudFront signed URLs: set media_signing_public_key_pem."
    }
  }
}

# ── Edge WAF (CloudFront scope, so it must live in us-east-1) ──

resource "aws_wafv2_web_acl" "edge" {
  provider    = aws.us_east_1
  name        = "${local.name}-edge"
  description = "AMIVARA edge protection"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 0

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # OTP endpoints are the most abused path on a phone-auth app (SMS pumping).
  rule {
    name     = "otp-rate-limit-per-ip"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_otp_rate_limit_per_5min
        aggregate_key_type = "IP"

        scope_down_statement {
          byte_match_statement {
            search_string         = "/v1/auth/otp"
            positional_constraint = "STARTS_WITH"

            field_to_match {
              uri_path {}
            }

            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-otp-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = {
      AWSManagedRulesAmazonIpReputationList = 2
      AWSManagedRulesCommonRuleSet          = 3
      AWSManagedRulesKnownBadInputsRuleSet  = 4
    }

    content {
      name     = rule.key
      priority = rule.value

      override_action {
        none {}
      }

      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.key
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${local.name}-${rule.key}"
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-edge"
    sampled_requests_enabled   = true
  }
}

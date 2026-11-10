# CloudFront in front of the media bucket. PriceClass_All is required so that
# Nigerian members are served from the Lagos edge locations (ARCHITECTURE.md
# §6.1). Distributions for the web apps and the API (caching disabled) are
# added together with the ECS services.

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

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

  # Custom domain (media.amivara.com) arrives with the ACM certificate in us-east-1.
  viewer_certificate {
    cloudfront_default_certificate = true
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

  dynamic "rule" {
    for_each = {
      AWSManagedRulesAmazonIpReputationList = 1
      AWSManagedRulesCommonRuleSet          = 2
      AWSManagedRulesKnownBadInputsRuleSet  = 3
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

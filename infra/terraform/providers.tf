# Primary region: AWS Africa (Cape Town). af-south-1 is an opt-in region and
# must be enabled on each AWS account before the first apply (see README.md).
provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}

# CloudFront-scoped resources (WAF web ACLs, and ACM certificates for custom
# domains) must be created in us-east-1. No member data is stored there.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.tags
  }
}

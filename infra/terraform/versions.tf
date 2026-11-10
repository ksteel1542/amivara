terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.28"
    }
  }

  # Remote state in S3 (af-south-1) with native S3 locking (Terraform >= 1.10).
  # Configure per environment:  terraform init -backend-config=environments/<env>.backend.hcl
  backend "s3" {}
}

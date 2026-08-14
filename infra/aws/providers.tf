# ─────────────────────────────────────────────────────────────
# 콕고 프로덕션 AWS 인프라 (M8) — EC2 1대 + Cloudflare Tunnel.
# 상태 파일은 로컬(gitignore) — 1인 운영, 리소스 소수라 유실 시 import 복구.
# 적용: cd infra/aws && terraform init && terraform apply
# ─────────────────────────────────────────────────────────────
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "ap-northeast-2" # 서울
  # 회사 계정 오배포 방지 — 반드시 개인 계정 전용 프로필로만 실행된다.
  # (기본 자격증명이 회사(aitrics) 것이라 명시 프로필 없이는 실패하는 게 의도)
  profile = "badminton"
}

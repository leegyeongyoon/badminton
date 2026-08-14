# Ubuntu 24.04 LTS ARM64 최신 AMI (Canonical 공식).
data "aws_ami" "ubuntu_arm64" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# 기본 VPC의 퍼블릭 서브넷 사용 — NAT 게이트웨이 회피(비용 0).
# 보안은 '인바운드 전면 차단 + Cloudflare Tunnel 아웃바운드'가 담당한다.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# 인바운드 규칙 자체가 없다 — SSH 포함 모든 접근은 EC2가 밖으로 여는
# Cloudflare Tunnel을 통해서만 이뤄진다. 아웃바운드는 전체 허용.
resource "aws_security_group" "badminton" {
  name        = "badminton-prod"
  description = "badminton prod - no inbound (Cloudflare Tunnel only), all outbound"
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Project = "badminton" }
}

# SSM Session Manager용 — 브라우저 콘솔 셸(터널 토큰 설치 등 초기 부트스트랩,
# 비상시 터널 없이 접속하는 최후의 문).
resource "aws_iam_role" "ssm" {
  name = "badminton-prod-ssm"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ssm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ssm" {
  name = "badminton-prod-ssm"
  role = aws_iam_role.ssm.name
}

# cloud-init: 도커·cloudflared·배포 유저 준비. 기존 파이의 /opt/badminton
# 레이아웃과 sshpass 워크플로를 무수정 재사용하기 위한 최소 구성.
locals {
  user_data = <<-CLOUDINIT
    #cloud-config
    users:
      - name: ${var.deploy_user}
        groups: [sudo, docker]
        shell: /bin/bash
        sudo: "ALL=(ALL) NOPASSWD:ALL"
        lock_passwd: false
    chpasswd:
      expire: false
      users:
        - name: ${var.deploy_user}
          password: ${var.deploy_password}
          type: text
    package_update: true
    packages:
      - docker.io
      - docker-compose-v2
      - git
      - rsync
      - curl
    write_files:
      # 비밀번호 SSH는 deploy 유저만, 그것도 터널 경유로만 도달 가능(SG 인바운드 0).
      - path: /etc/ssh/sshd_config.d/99-deploy-user.conf
        content: |
          PasswordAuthentication no
          Match User ${var.deploy_user}
            PasswordAuthentication yes
    runcmd:
      - curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o /tmp/cloudflared.deb
      - dpkg -i /tmp/cloudflared.deb
      - mkdir -p /opt/badminton
      - chown ${var.deploy_user}:${var.deploy_user} /opt/badminton
      - systemctl restart ssh
  CLOUDINIT
}

resource "aws_instance" "badminton" {
  ami                    = data.aws_ami.ubuntu_arm64.id
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.badminton.id]
  iam_instance_profile   = aws_iam_instance_profile.ssm.name
  user_data              = local.user_data

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
  }

  # user_data 수정으로 인스턴스가 재생성되지 않게 — 초기 부트스트랩 전용.
  lifecycle {
    ignore_changes = [user_data, ami]
  }

  tags = { Name = "badminton-prod", Project = "badminton" }
}

# 고정 IP — stop/start에도 아웃바운드 원점이 안 바뀐다(IPv4 과금은 EIP든
# 자동 할당이든 동일하므로 고정이 이득).
resource "aws_eip" "badminton" {
  instance = aws_instance.badminton.id
  domain   = "vpc"
  tags     = { Project = "badminton" }
}

# 지난 AWS 요금 폭탄 재발 방지 — 월 $25 예산, 80% 실제/100% 예측 초과 시 메일.
resource "aws_budgets_budget" "monthly" {
  name         = "badminton-monthly"
  budget_type  = "COST"
  limit_amount = "25"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}

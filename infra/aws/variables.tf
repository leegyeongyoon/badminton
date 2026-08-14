variable "instance_type" {
  description = "서버 인스턴스 타입 — ARM(t4g) 유지. small=2GB가 node+postgres 동거 최소 사양."
  type        = string
  default     = "t4g.small"
}

variable "deploy_user" {
  description = "GitHub Actions 워크플로가 SSH 접속하는 배포 유저(기존 sshpass 방식 재사용)."
  type        = string
  default     = "deploy"
}

variable "deploy_password" {
  description = "배포 유저 비밀번호 — terraform.tfvars(gitignore)에만 존재. GH Secret SSH_PASSWORD와 동일 값."
  type        = string
  sensitive   = true
}

variable "alert_email" {
  description = "월 예산($25) 초과 경보 수신 이메일."
  type        = string
}

variable "root_volume_gb" {
  description = "루트 EBS(gp3) 크기 — DB+업로드+도커 이미지 여유분."
  type        = number
  default     = 30
}

output "public_ip" {
  description = "EC2 고정 IP(EIP) — 인바운드는 닫혀 있으므로 아웃바운드 원점 확인용."
  value       = aws_eip.badminton.public_ip
}

output "instance_id" {
  description = "SSM 세션 접속: aws ssm start-session --target <instance_id>"
  value       = aws_instance.badminton.id
}

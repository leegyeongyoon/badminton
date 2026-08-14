# 콕고 운영 런북 — 장애 전환(Failover)/복귀(Failback)

## 평시 구조 (2026-08-14 M8 이후)
- **프로덕션**: AWS EC2 `badminton-prod`(서울, t4g.small, i-07dd1670cd3c63462) — `AWS_TUNNEL`이 `api.badmintoncourt.store`(→localhost:3131)와 `ssh-aws.badmintoncourt.store`(→:22) 서빙. 인바운드 완전 차단, Cloudflare Tunnel(http2 강제)만 사용.
- **웹**: Cloudflare Pages (badmintoncourt.store) — 서버와 무관, 항상 살아있음.
- **스탠바이**: 라즈베리파이 — 혼밥노노와 동거. 매일 04:30 최신 백업 복원(`scripts/standby-restore.sh`), 매주 일 04:00 코드 리프레시(`standby-refresh-code.sh`). `/opt/badminton/STANDBY_MODE` 마커가 스탠바이 표식.
- **백업**: `prod-backup.yml` 매일 03:17 KST — EC2 덤프+uploads tar → 비공개 `badminton-backups` 저장소 (덤프 30개·uploads 7개 보관).
- **감시**: `health-check.yml` 15분 크론 — 3연속 실패 시 GitHub 실패 메일. 서버 500/크래시는 Sentry(cockgo/server).
- **워크플로 시크릿**: `SSH_HOST/USER/PASSWORD`=파이, `SSH_HOST_AWS/USER_AWS/PASSWORD_AWS`=EC2. deploy·prod-* 6종은 `*_AWS` 사용.

## Failover — AWS 장애 시 파이가 이어받기 (목표 10분, RPO ≤24h)
1. **상황 확인**: health-check 실패 메일 or `curl https://api.badmintoncourt.store/api/v1/health` 530/무응답. EC2 측이면 AWS 콘솔 SSM 세션으로 진단(재부팅: `aws ec2 reboot-instances --instance-ids i-07dd1670cd3c63462 --profile badminton`).
2. **파이 최신화(선택)**: 시간이 있으면 파이에서 `bash scripts/standby-restore.sh` 1회 실행(마지막 새벽 백업 이후 데이터는 유실 — RPO 안내).
3. **라우트 전환**: Cloudflare 대시보드 → badmintoncourt.store zone → DNS → `api` CNAME의 대상 터널을 `GY_TUNNEL`(파이)로 변경. (파이의 GY_TUNNEL 쪽 ingress에 api→localhost:3131 규칙이 이미 있음)
4. **검증**: health 200 → 웹 로그인 → 홈. 카톡 공지(서버 순단 안내).
5. **주의**: 파이가 프로덕션이 된 동안 `STANDBY_MODE` 마커를 **즉시 삭제**(`rm /opt/badminton/STANDBY_MODE`) — 다음 새벽 cron이 실DB를 백업본으로 덮어쓰는 사고 방지. deploy 등 워크플로를 파이로 돌리려면 시크릿 대신 워크플로 파일의 `*_AWS`→원본 참조로 임시 수정.

## Failback — AWS 복구 후 되돌리기
1. EC2 정상 확인(SSM, `systemctl is-active cloudflared`, local health 200).
2. 파이에서 최종 덤프 → EC2 복원 (`cutover-final-sync.yml` 재사용: 파이 server 정지→덤프→EC2 복원→재시작).
3. 라우트 전환: `api` CNAME → `AWS_TUNNEL`(1aac19d8-...cfargotunnel.com).
4. 검증 후 파이에 `STANDBY_MODE` 마커 복구(`touch /opt/badminton/STANDBY_MODE`) + `setup-standby.yml` 재실행(cron 정합 확인).

## 자주 쓰는 진단
- EC2 셸: AWS 콘솔 → EC2 → 인스턴스 → 연결 → Session Manager (또는 `aws ssm start-session --target i-07dd1670cd3c63462 --profile badminton --region ap-northeast-2`)
- 서버 로그: `prod-logs.yml` 수동 실행 (EC2 대상)
- 터널 상태: Cloudflare Zero Trust → Networks → Tunnels (AWS_TUNNEL / GY_TUNNEL)
- 스탠바이 로그: 파이 `/opt/badminton/standby.log`
- 예산: AWS Budgets $25/월 초과 시 메일 (badminton-monthly)

## 과거 이력
- 2026-08-13: 집 인터넷 순단 5시간 → 이 구조로 이전하게 된 계기 (파이·서버는 무고했음)
- 2026-08-14: M8 이전 완료. EC2↔CF 터널은 QUIC 불통이라 http2 강제(`/etc/systemd/system/cloudflared.service.d/override.conf`)

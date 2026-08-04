#!/bin/zsh
# 콕고 릴스 재생성 (1080x1920, 18.5s, 무음 — 음악은 인스타 앱에서 추가)
# 소재: ../kokgo-ig-*.png (카드) + scene0/scene5 HTML(타이포) → 헤드리스 크롬 캡처
# 필요: brew ffmpeg, Google Chrome
# 순서: 인트로(훅) → QR → 운영판 → 푸시 → 출석왕 → 아웃트로(CTA), 씬 3.5s·페이드 0.5s
# 씬 클립: scale 2160x3840 → zoompan(줌인/줌아웃 교차, 105f@30fps) → crf19
# 결합: xfade offset 3/6/9/12/15
# 상세 명령은 git log(2026-08-04, kokgo-reels-01 커밋) 참고.

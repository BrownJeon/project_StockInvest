---
tags:
  - type/board
---
# 칸반 보드

> 재개 진입점: [[RESUME]] · 진단·설계 전문: [[2026-08-02-restructure-plan]]

## Backlog

- Phase 3 — 페이퍼 트레이딩·성과 실측 (executions simulated 기록, 룰별 승률·EV 대시보드, 비용 모델 config화)
- Phase 4 — 백테스트 검증 루프 (야간 cron, validation_status, 실주문 전제조건 코드화)
- Phase 5 — DRY_RUN 해제 준비 (KIS 체결내역 폴링 → executions real, 해제 체크리스트)
- 문서 SSOT 재작성 (제품 사양 1페이지 + 전략 사양) — stale 문서 정리(기획서_V0.1, phases/*, trading-strategy.md 코인 전략)
- AI 채팅(/ai)·LoRA export 제거 — 사용자 결정에 따른 정리
- `AUTH_SESSION_SECRET` 분리 — 현재 AUTH_PIN이 로그인 PIN과 쿠키 HMAC 서명 키를 겸함
- 이상징후 조사: pm2 재시작 315회 원인 / AI 게이트웨이(192.168.219.163:8001) 다운
- (신규, 낮은 우선순위) `oversold-bounce-daily-v1` strategy_id 드리프트 수정 — post-market-engine.ts가 `oversold-bounce-v1`을 씀, `strategies.id`와 불일치 (2026-08-03 reviewer 발견, pre-existing)

## Todo

- **배포 승인 대기** — [[T-002-phase1-eval-funnel]] 전항 완료. 커밋·push는 사용자 승인 필요(push=자동배포)
- **장중 실측** (배포 후 개장중) — eval_funnel final.stage 정상 기록 확인 + 대시보드 카드·아침 리포트 실데이터 렌더 확인
- [[T-001-phase0-safety-foundation]] 마무리 — reviewer 최종 재검증(next 14.2.35 반영분) → QA
- [[T-003-phase2-pipeline-redesign]] 구현 — Phase 1 관측 데이터 3영업일 확보 후(배포일 기준 재기산)

## Doing

(없음 — 2026-08-03 세션 종료. 재개 시 [[RESUME]] 참조)

## Review

(없음 — [[T-002-phase1-eval-funnel]] 독립 reviewer 감사 완료, 발견 사항 즉시 수정 반영됨)

## Done

- 원인 분석·재구성 설계 — 2026-08-02. 탐색 3종 + Fable 종합설계 + 운영 DB 실측. **제1사인 = signals.status ENUM에 `pending_approval` 부재(STRICT 모드 하드 에러 → 런 전체 중단)**
- [[T-001-phase0-safety-foundation]] developer 구현 — 한도 fail-safe(Infinity→거부), PIN 인증 미들웨어, Kill Switch drawdown 배선, parseBoolFlag 3분기, next 14.2.15→14.2.35(CVE-2025-29927 인가우회 + CVE-2025-55184 DoS), undici 제거, CI 테스트 게이트. 테스트 398건 통과
- [[T-003-phase2-pipeline-redesign]] analyst 사양 — 게이트 50→26 재편표, RSI 실측 재도출(35→38, n=7290), 비용 0.178% 실측(현행 0.43%는 2.4× 과대), 기본 활성 5종 선별, 정량 검증 기준 8종
- [[T-002-phase1-eval-funnel]] — **전항 완료(2026-08-03)**. H1~H4 핫픽스 반영·검증, final.stage 버그 수정, stage 8/9/10 계측 공백 및 createSignal 무보호 호출(안전 이슈) 발견·수정, 대시보드 깔때기 카드, trade-report 요약, 독립 reviewer 감사 통과. typecheck clean·테스트 40 suites/410건 통과. 배포만 남음

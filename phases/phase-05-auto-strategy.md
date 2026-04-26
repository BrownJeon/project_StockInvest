# Phase 5 — 지표 기반 자동매매 전략 실행 ⬜

**목표:** 저장된 전략이 지표·시세 조건에 따라 시그널을 발행하고, 시그널이 `submitOrder()`를 통해 실주문으로 연결되는 파이프라인을 구축한다.

## 작업 범위

- [ ] `src/lib/strategy/engine.ts` — 캔들 tick 마다 전략 평가, `signals` 테이블에 기록
- [ ] 스케줄러 — 분 단위로 전략 평가 (Next.js Route Handler + cron 또는 별도 워커)
- [ ] 시그널 → 주문 연결 — `signals.consumed_order_id` 업데이트
- [ ] 전략 관리 UI — 활성/비활성, 파라미터 편집
- [ ] DB — `strategies`, `signals` 테이블 생성

## 실매매 전환 안전장치

- 자동매매 활성 전제: Phase 3 수동 주문이 **라이브 1주** 이상 문제 없이 돌아감
- 자동 주문 1일 건수 상한 (`AUTO_DAILY_MAX_ORDERS` 같은 추가 환경변수 검토)
- 전략별 drawdown 모니터링 — 임계치 초과 시 자동 비활성

## 이 Phase에서 추가·수정하는 화면 (docs/screens.md)

- **전략** (`/strategy`) — **핵심 구현**:
  - 전략 목록 + ON/OFF 토글 + 성과 요약
  - 전략 상세 (`/strategy/:id`) — 파라미터 편집·백테스트 요약
  - 시그널 피드 (`/strategy/signals`) — 시간순, 수동/승인/자동 구분
  - 승인 대기 큐 (`/strategy/approvals`) — Stage 3 승인/거부 버튼
- **분석 > 감사 로그** — 시그널 집계 뷰 (전략별 발생 횟수·승률)
- **설정 > 프로파일** (`/settings/profile`) — 전략 스타일 토글 UI 구체화
- 주문 탭 이력에 "자동 주문" 태그 표시

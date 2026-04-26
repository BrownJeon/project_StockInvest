# Phase 3 — 코인원 실매매(수동 주문) + 안전장치 ⬜

**목표:** 사용자가 UI에서 수동으로 주문을 넣을 수 있게 한다. 모든 주문은 `src/lib/safety/dry-run.ts`의 `submitOrder()`를 통해서만 송신한다.

## 작업 범위

- [ ] `src/lib/exchanges/coinone.ts::createOrder/cancelOrder` 실구현 (payload + HMAC-SHA512 서명)
  - limit_buy / limit_sell / market_buy / market_sell 엔드포인트 분기
- [ ] `src/lib/safety/order-limits.ts::checkDailyMax` 실구현 — `orders` 테이블 집계 쿼리
- [ ] DB 마이그레이션 — `orders`, `executions`, `trade_logs` 생성
- [ ] API Route
  - `POST /api/orders` → safety 경유 코인원 주문 생성
  - `DELETE /api/orders/:exchangeOrderId` → 주문 취소
  - `GET /api/orders` → 주문 이력 조회
- [ ] 주문 생성 폼 페이지 (매수/매도, 지정가/시장가, 금액·수량 검증)
- [ ] `trade_logs`에 모든 이벤트(`submit_attempt` / `blocked` / `accepted` / `filled` / `error`) 기록

## 검증 (QA 최우선)

- DRY_RUN=true 상태에서 실제 HTTP 호출이 발생하지 않는가
- KILL_SWITCH=true에서 주문 경로 전부 차단되는가
- `ORDER_MAX_KRW` 초과·비허용 심볼 즉시 거부
- 동일 `client_order_id`(또는 nonce) 중복 요청 시 중복 주문 생성되지 않는가
- 코인원 거부 코드(`INSUFFICIENT_BALANCE`, `MIN_QTY_VIOLATED` 등) 응답이 `orders.status`에 정확히 매핑되는가

## 실매매 전환 순서

1. DRY_RUN으로 테스트 통과
2. `DRY_RUN=false`, `ORDER_MAX_KRW=10000`으로 극소액 실매매 3일 (검증 단계, trading-strategy.md §5)
3. 이상 없으면 한도 상향

## 이 Phase에서 추가·수정하는 화면 (docs/screens.md)

- **주문** (`/order`) — **핵심 구현**:
  - 신규 주문 폼 (심볼·사이드·타입·가격·수량/KRW·예상 체결·safety 사전 체크·제출)
  - 진행 주문 (`/order/active`) — 취소 버튼
  - 주문 이력 (`/order/history`) — 필터(기간·심볼·상태)
  - 체결 상세 (`/order/:id`) — `executions` + `trade_logs`
- **대시보드** — 주문 바로가기 버튼 활성 (매수/매도 → `/order?symbol=...&side=...`)
- **설정 > 안전장치** (`/settings/safety`) — `ORDER_MAX_KRW` 입력 UI (DRY_RUN·KILL_SWITCH 토글 포함)
- **분석 > 감사 로그** (`/analytics/audit`) — 기본 뷰 시작 (`trade_logs` 시간순 스크롤)
- 공용 컴포넌트: `PriceInput` · `QtyInput` · `ConfirmDialog` (실주문 2차 확인) 신규

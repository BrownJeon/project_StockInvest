# StockInvest 아키텍처

## 레이어 구성

```
┌────────────────────────────────────────────────────────────┐
│  Client (Next.js App Router / React Server Components)    │
│  src/app/**                                                │
└──────────────────────────┬─────────────────────────────────┘
                           │ HTTP (Next.js API Routes)
┌──────────────────────────▼─────────────────────────────────┐
│  API Layer  (src/app/api/**/route.ts)                      │
│  - 요청 검증, 인증, 응답 직렬화                             │
└──────────────────────────┬─────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────┐
│  Safety Layer (src/lib/safety/*)  ★ 주문 송신 필수 경로     │
│  Kill Switch → Symbol Whitelist → Order Max → DRY_RUN       │
└──────────────────────────┬─────────────────────────────────┘
                           │ 통과 시에만 호출
┌──────────────────────────▼─────────────────────────────────┐
│  Exchange Adapters (src/lib/exchanges/*)                   │
│  kis.ts (한국투자증권 OpenAPI, 현재 활성)                    │
└──────────────────────────┬─────────────────────────────────┘
                           │ REST / WebSocket
                 ┌─────────▼─────────┐
                 │ 거래소 / 증권사 API │
                 └───────────────────┘

                 ┌───────────────────┐
 MariaDB (NAS) ◀─┤ src/lib/db.ts     │  Pool + Retry
                 └───────────────────┘
```

## 핵심 규칙

1. **모든 주문 송신은 Safety Layer를 거친다.** 거래소 어댑터의 `createOrder`를 직접 호출하지 않고, `src/lib/safety/dry-run.ts`의 `submitOrder()` 래퍼를 통해서만 호출한다.
2. **DB 접근은 `src/lib/db.ts`의 pool만 사용한다.** 모듈 내에서 `mysql2`를 직접 임포트하지 않는다.
3. **환경변수는 안전장치의 일부다.** `DRY_RUN`·`KILL_SWITCH`·`ORDER_MAX_KRW`·`DAILY_ORDER_MAX_KRW`·`ALLOWED_SYMBOLS`는 항상 존재해야 하며, 누락 시 주문 송신은 거부된다.

## 디렉토리 책임

| 경로 | 책임 |
|------|------|
| `src/app/` | UI·API 라우트 |
| `src/lib/db.ts` | MariaDB Pool, Retry, ping |
| `src/lib/exchanges/` | 거래소별 REST 어댑터, 타입 |
| `src/lib/safety/` | Kill Switch / 주문 한도 / DRY_RUN |
| `src/lib/strategy/` | 지표 계산·전략 엔진·유니버스(거래대금 TOP 20)·AI 필터(@anthropic-ai/sdk) |
| `src/components/` | UI 컴포넌트 |
| `src/types/` | 공통 TS 타입 |

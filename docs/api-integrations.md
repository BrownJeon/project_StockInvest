# 거래소·증권사 API 연동 지침

## 내부 심볼 표기 (공통)

프로젝트 내부에서는 업비트 스타일인 `KRW-BTC` 형식을 표준으로 사용한다.
각 거래소 어댑터가 자체 포맷으로 변환한다 (코인원은 `{quote:'krw', target:'btc'}`, 바이낸스는 `BTCKRW` 등).
이렇게 하면 거래소 교체 시 DB·UI·전략 코드는 수정 없이 어댑터만 바뀐다.

## 코인원 (Coinone) — 암호화폐 실매매 (1순위)

### 인증
- Access Token + Secret Key 발급 후 `.env`의 `COINONE_ACCESS_TOKEN`, `COINONE_SECRET_KEY`에 저장
- 인증 방식: **payload(base64 JSON)** + **HMAC-SHA512 서명**
- 페이로드 예시:
  ```json
  { "access_token": "...", "nonce": "<UUID>" }
  ```
- 요청 헤더:
  - `Content-Type: application/json`
  - `X-COINONE-PAYLOAD: <base64(JSON.stringify(payload))>`
  - `X-COINONE-SIGNATURE: <hex(HMAC_SHA512(secret, payload_base64))>`

### 주요 엔드포인트 (Public v2 + Private v2.1)

| 용도 | 메서드 | 경로 | 인증 |
|------|--------|------|------|
| 시세(티커) | GET | `/public/v2/ticker_new/{quote}/{target}` | 아니오 |
| 오더북 | GET | `/public/v2/orderbook/{quote}/{target}` | 아니오 |
| 캔들(분) | GET | `/public/v2/chart/{quote}/{target}?interval={1m\|5m\|1h\|...}` | 아니오 |
| 잔고 조회 | POST | `/v2.1/account/balance/all` | 예 |
| 지정가 매수 | POST | `/v2.1/order/limit_buy` | 예 |
| 지정가 매도 | POST | `/v2.1/order/limit_sell` | 예 |
| 시장가 매수 | POST | `/v2.1/order/market_buy` | 예 |
| 시장가 매도 | POST | `/v2.1/order/market_sell` | 예 |
| 주문 취소 | POST | `/v2.1/order/cancel` | 예 |
| 주문 조회 | POST | `/v2.1/order/info` | 예 |

### 주문 생성 페이로드 예시 (지정가 매수)
```json
{
  "access_token": "...",
  "nonce": "<UUID>",
  "quote_currency": "KRW",
  "target_currency": "BTC",
  "price": "50000000",
  "qty": "0.0001",
  "post_only": false
}
```

### 레이트 리밋
- Public: IP 기준 — 과도한 호출 시 `429`
- Private: Access Token 기준 — 주문 관련 엔드포인트는 별도 한도
- 초과 시 지수 백오프로 재시도

### 에러 코드 매핑 (주요 사례)
| 코드 | 의미 | 앱 처리 |
|------|------|---------|
| `INVALID_PARAMETER` / `104` | 요청 유효성 | `orders.status=failed` |
| `INSUFFICIENT_BALANCE` | 잔고 부족 | `orders.status=rejected` |
| `INVALID_ORDER_QTY` / `MIN_QTY_VIOLATED` | 최소 수량 미달 | `orders.status=rejected` |
| `429` | 레이트 리밋 | 백오프 후 재시도 |

코인원은 응답 포맷·코드가 버전별로 달라질 수 있으므로, 실 구현 시 응답 원문을 `trade_logs`에 그대로 저장한 뒤 매핑 테이블을 점진적으로 확장한다.

## 업비트 (Upbit) — 확장 예정

현재는 어댑터 미구현. 추후 코인원과 병행 운용하거나 전환할 때 `src/lib/exchanges/upbit.ts`로 추가한다. 구조상 `ExchangeClient` 인터페이스만 만족하면 DB·UI·전략 변경 없이 교체 가능하다.

### 인증 (추가 시)
- Access Key + Secret Key → JWT (HS256) + 쿼리 파라미터 시 SHA512 query_hash
- 헤더: `Authorization: Bearer <JWT>`

### 주요 엔드포인트 (참고)
| 용도 | 메서드 | 경로 |
|------|--------|------|
| 시세 | GET | `/v1/ticker?markets=KRW-BTC` |
| 캔들 | GET | `/v1/candles/minutes/{unit}` |
| 잔고 | GET | `/v1/accounts` |
| 주문 생성 | POST | `/v1/orders` |
| 주문 취소 | DELETE | `/v1/order?uuid=...` |

## 바이낸스 (선택)

- API Key + Secret으로 HMAC SHA256 서명
- 엔드포인트: `https://api.binance.com/api/v3/order`
- 현물(Spot) 기준 먼저 구현, 선물은 별도 라인

## 한국투자증권 KIS OpenAPI (Phase 7 — 미국주식)

- `.env`: `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_ACCOUNT`
- OAuth2 토큰 발급 후 `Authorization: Bearer <TOKEN>` + `appkey` / `appsecret` 헤더
- 모의투자 / 실전투자 서버 URL 구분 관리
- 해외주식 주문: `/uapi/overseas-stock/v1/trading/order`

## 공통 구현 원칙

- 모든 거래소 어댑터는 `src/lib/exchanges/types.ts`의 `ExchangeClient` 인터페이스 준수
- API 키는 환경변수에서만 로드, 코드 하드코딩 금지
- 주문 송신은 `src/lib/safety/dry-run.ts`의 `submitOrder()` 경유 필수
- 모든 요청·응답은 `trade_logs`에 감사 로그로 기록
- 레이트 리밋은 어댑터 내부에서 큐잉 또는 백오프로 처리
- 심볼은 내부 표준(`KRW-BTC`)을 받아 어댑터가 거래소 포맷으로 변환

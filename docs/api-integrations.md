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

## 미국 노동통계국(BLS) Public Data API v1 — CPI (T-165, 거시 레짐 라벨 C0)

**기록 전용 입력이다.** 값은 `eval_funnel` 최종 run 행 `detail.macroRegime` 에만 남고 매매 판단·게이트·사이징·AI 프롬프트에 쓰지 않는다. 코드: `src/lib/strategy/macro-regime/`(`bls-cpi.ts` 수집 · `snapshot.ts` 캐시·갱신 · `classify.ts` 순수 분류).

| 항목 | 값 |
|---|---|
| 엔드포인트 | `GET https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0` (연도 미지정 = 당해 포함 3개 연도) |
| 시리즈 | `CUUR0000SA0` — CPI-U, U.S. city average, All items, **비계절조정**(사후 개정이 거의 없어 "그 시점 발표분" 과 일치) |
| 인증 | 없음(v1, 키 미사용). `.env` 변경 없음 |
| 한도 | 미등록 v1 **일 25쿼리**·쿼리당 10개 연도(BLS `api_faqs.htm`). IP 단위인지는 문서 미명시 — 호스트 단위로 보수적으로 취급 |
| 호출 빈도 | 웹 프로세스(`stockinvest`) 안 strategy-eval 런 시작 때 조건부 1회 시작(기다리지 않음). 성공 TTL 24h · 실패 재시도 간격 2h · **UTC 하루 최대 6회 시도** · 단일 비행. 발표 일정표상 발표 시각을 넘기면 TTL 과 무관하게 갱신(간격·상한은 그대로). 일 6회 카운터·2h 간격은 프로세스 메모리라 **재기동 때 0 으로 돌아간다** — 실패가 이어지는 날의 시도 수 상한은 min(6 × (재기동 수 + 1), 재기동 수 + 13)(재기동 0회 6 · 2회 15, 대략 12 + 재기동 수), 성공 상태에서는 재기동당 1회(재기동 직후 빈 캐시 적재) |
| 경계 | 호스트 allowlist `api.bls.gov` · https 만 · `redirect: 'error'`(리다이렉트 불허) · 타임아웃 5s(헤더+본문, 타이머 `unref`) · 응답 상한 64KB(스트림으로 읽으며 초과 즉시 중단) · `cache: 'no-store'` |
| 응답 검증 | `status === "REQUEST_SUCCEEDED"` · `Results.series[0].seriesID === "CUUR0000SA0"` · `data[]` 의 `year` 4자리 · `period` `M01`~`M12`(`M13` 연평균 행은 건너뜀 — 실측 GET 응답에 2행 들어 있다) · `value` 숫자 또는 `"-"`(그 달 결측, 예: 2025-10 미공표). 그 밖은 응답 전체 `bad_schema`. **사용 가능한 YoY 쌍**(어떤 월 M 과 M−12 가 모두 양수)이 0개여도 `bad_schema`(한 달짜리·결측뿐인 응답 차단) |
| 실패 처리 | 던지지 않는다. 결과 코드 `ok · http_error · timeout · too_large · bad_json · bad_schema · request_failed_status · network_error · internal_error`(+ 시험 환경 `disabled_in_test`). **실패 시 이전 캐시 유지**, 7일 넘게 성공이 없으면 라벨 `unknown(cpi_cache_stale)`. `ok` 응답이어도 가장 늦은 숫자 월이 기존 캐시보다 이르면(후퇴) 교체하지 않고 `bad_schema` 로 기록 |
| 끄기 | `MACRO_REGIME_BLS_DISABLED=true` → 수집하지 않고 라벨 `unknown(cpi_not_loaded)`, `fetchStatus: disabled`. 기본(미설정)은 수집한다 |
| 시험 | jest(`NODE_ENV=test` 또는 `JEST_WORKER_ID`)에서는 수집기를 주입하지 않은 기본 경로가 네트워크로 나가지 않는다(`disabled_in_test`) — 시험 중 실호출 0 |
| 캐시 | 프로세스 메모리뿐(DB 저장 없음). 재기동 직후 첫 기록은 `unknown(cpi_not_loaded)` 일 수 있다 |
| 정적 표 | 발표 일정 `cpi-release-schedule.ts`(08:30 ET → UTC, `confirmed` 플래그) · 정책금리 `fomc-target-range.ts`(연준 openmarket.htm·fomccalendars.htm) — 갱신 절차는 각 파일 머리 주석 |
| 라이선스 | BLS 자료는 미국 연방정부 공공저작물(public domain) |
| 미반영 | `@/lib/api-usage`(T-040) 호출 기록 대상이 아니다 — api-usage 의 `ApiId` 에 `bls` 가 없다(추가 여부는 별도 결정) |

## 공통 구현 원칙

- 모든 거래소 어댑터는 `src/lib/exchanges/types.ts`의 `ExchangeClient` 인터페이스 준수
- API 키는 환경변수에서만 로드, 코드 하드코딩 금지
- 주문 송신은 `src/lib/safety/dry-run.ts`의 `submitOrder()` 경유 필수
- 모든 요청·응답은 `trade_logs`에 감사 로그로 기록
- 레이트 리밋은 어댑터 내부에서 큐잉 또는 백오프로 처리
- 심볼은 내부 표준(`KRW-BTC`)을 받아 어댑터가 거래소 포맷으로 변환

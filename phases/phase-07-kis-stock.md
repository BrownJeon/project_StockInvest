# Phase 7 — 한국투자증권 KIS API로 미국주식 확장 ⬜

**목표:** 암호화폐에서 검증된 safety·전략·백테스트 파이프라인을 재사용해 KIS OpenAPI를 통해 미국주식 실매매까지 확장한다.

## 작업 범위

- [ ] `src/lib/exchanges/kis.ts` — `ExchangeClient` 구현 (OAuth2 토큰 관리 포함)
- [ ] 모의투자 서버로 먼저 연동, 통과 후 실전 서버
- [ ] 심볼 표기 통일 — 내부 표준 `KRW-BTC` / KIS는 `NASD:AAPL` 등 형식 차이 어댑터에서 흡수
- [ ] 해외주식 시장 운영시간 / 환율 / 배당 처리 반영
- [ ] `ALLOWED_SYMBOLS`·`ORDER_MAX_KRW` 환경변수가 거래소마다 구분되도록 리팩토링 (`ORDER_MAX_COINONE_KRW`, `ORDER_MAX_KIS_USD` 등) — leader와 네이밍 확정

## 검증

- 모의투자 서버에서 safety 레이어 동작 확인
- 실전 전환 시 동일한 단계적 도입(DRY_RUN → 극소액 → 확대) 준수

## 이 Phase에서 추가·수정하는 화면 (docs/screens.md)

- **설정 > 거래소 계정** (`/settings/exchanges`) — KIS 슬롯 추가 (모의/실전 서버 토글, 토큰 갱신 상태)
- **설정 > 안전장치** — 자산 클래스별 한도 구분 (`ORDER_MAX_COINONE_KRW`, `ORDER_MAX_KIS_USD` 등) UI 반영
- **주문 폼** — 심볼 형식 자동 판별 (`KRW-BTC` vs `NASD:AAPL`)로 해당 거래소 어댑터 라우팅
- **대시보드** — 자산 클래스 필터 탭 추가 검토 (전체 / 암호화폐 / 미국주식)

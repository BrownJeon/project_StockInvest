# Phase 2 — 코인원 시세 조회·포트폴리오(읽기 전용) ⬜

**목표:** 코인원 Public·Private 조회 API를 연결해, 자산 현황과 캔들 데이터를 웹에서 확인할 수 있게 한다. 주문은 아직 하지 않는다.

## 작업 범위

- [ ] `src/lib/exchanges/coinone.ts` — `getTicker()` 고도화, `getCandles()` 추가, `getBalances()` 실구현 (payload + HMAC-SHA512 서명)
- [ ] `src/lib/exchanges/coinone-auth.ts` — payload 생성·base64 인코딩·서명 유틸 분리
- [ ] DB 마이그레이션 스크립트 — `accounts`, `holdings` 테이블 생성
- [ ] API Route
  - `GET /api/ticker?symbol=KRW-BTC`
  - `GET /api/candles?symbol=KRW-BTC&interval=1h&count=200`
  - `GET /api/balances`
- [ ] 대시보드 페이지 — 보유 자산 리스트 + 실시간 시세 + 간단한 캔들 차트 (lightweight-charts 후보)

## 검증

- 코인원 실계정 잔고가 화면에 노출되는가 (주문은 없음)
- 심볼 변환(`KRW-BTC` → `{quote:'krw', target:'btc'}`)이 어댑터 내부에서만 이뤄지고 UI·DB에는 내부 표준만 노출되는가
- 시세 Polling 레이트 리밋 위반 없는가

## 이 Phase에서 추가·수정하는 화면 (docs/screens.md)

- **대시보드** (`/`) — **핵심 구현**: 자동매매 상태 카드(포트폴리오 오늘 P&L 실데이터 연결) / 최근 체결 placeholder / 보유·관심 리스트 + 인라인 매수·매도 / 하단 차트 섹션 / safety 토글 / 자동 30초 새로고침
- **`portfolio_snapshots` 테이블 선도입** — V0.3의 스키마·저장·조회만 Phase 2에서 구현 (대시보드 접속 시 자동 기록, 오늘 00:00 KST 기준 시작값 조회). cron·임계치·가드 액션은 V0.3 유지
- **설정 > 거래소 계정** (`/settings/exchanges`) — 코인원 연결 확인 부분만 (키 상태 표시). 전체 설정 허브는 후속 Phase
- 공용 컴포넌트 구축 시작: `BottomTabs` · `SymbolPicker` · `IntervalToggle` · `SafetyBar` · `NumFmt` · `PnlChip`
- 하단 5-탭 네비 바 레이아웃 — 대시보드만 라이브, 나머지 탭은 placeholder("Phase X 예정")

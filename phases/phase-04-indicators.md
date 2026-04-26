# Phase 4 — 기술 지표 엔진 ⬜

**목표:** 캔들 데이터로부터 MA/EMA/RSI/MACD/볼린저/ATR을 계산하는 순수 함수 라이브러리를 구축한다. 차트에 오버레이로 표시한다.

## 작업 범위

- [ ] `src/lib/strategy/indicators/` — 지표별 순수 함수 (입력: number[], 출력: number[])
  - sma / ema / rsi / macd / bollinger / atr
- [ ] 단위 테스트 — TA-Lib 또는 TradingView 기준값과 일치 검증 (analyst가 데이터셋 제공)
- [ ] 대시보드 차트에 지표 오버레이 토글
- [ ] API Route `GET /api/indicators?symbol=...&type=rsi&period=14`

## 검증

- analyst가 제공한 reference 데이터셋과 지표 출력이 소수점 6자리 이내 일치
- 데이터 부족·NaN 입력 시 예외 없이 안전하게 처리

## 이 Phase에서 추가·수정하는 화면 (docs/screens.md)

- **전략 > 지표 라이브러리** (`/strategy/indicators`) — 지표 목록 + 기본 파라미터 조정 UI
- **대시보드** — 차트에 지표 오버레이 토글 (RSI·MACD·MA·볼린저)
- **설정 > 지표 기본값** (`/settings/indicators`) — RSI 기간·MA 기간·MACD 파라미터 등 프로젝트 기본값

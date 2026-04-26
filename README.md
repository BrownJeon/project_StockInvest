# TradingInvest

> 주식·암호화폐 분석·매매·수익화 웹앱. 암호화폐(코인원 실매매)로 시작해 미국주식(KIS API)으로 확장한다. 업비트는 추후 어댑터만 추가하면 병행·전환 가능하도록 구조 준비.

## Phase 진행 현황

| Phase | 내용 | 상태 |
|-------|------|------|
| 01 | 기본 골격 구성 | ✅ 완료 |
| 02 | 코인원 시세·포트폴리오 조회 | ⬜ 예정 |
| 03 | 코인원 실매매(수동 주문) + 안전장치 | ⬜ |
| 04 | 기술 지표 엔진 | ⬜ |
| 05 | 지표 기반 자동매매 | ⬜ |
| 06 | 백테스팅·수익 분석 | ⬜ |
| 07 | KIS API 미국주식 확장 | ⬜ |

상세 내용은 [`phases/`](./phases/) 디렉토리.

## 빠른 시작

```bash
cp .env.example .env
# .env 값 입력 (NAS MariaDB / 거래소 API / 안전장치)
npm install
npm run dev
```

접속:
- 홈: <http://localhost:3000>
- 헬스체크: <http://localhost:3000/api/health>

## 디렉토리 개요

- [`CLAUDE.md`](./CLAUDE.md) — 프로젝트 지침 (에이전트 필수)
- [`docs/`](./docs/) — 아키텍처·DB 스키마·매매 전략·API 연동
- [`src/`](./src/) — Next.js 코드
- [`phases/`](./phases/) — 단계별 로드맵

## 실매매 경고

이 프로젝트는 실제 자금을 다룬다. `docs/trading-strategy.md`의 단계적 도입 원칙을 반드시 준수한다. DRY_RUN 검증 → 소액 실매매 → 자동화 순.

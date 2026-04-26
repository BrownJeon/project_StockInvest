# Phase 1 — 기본 골격 구성 ✅

**목표:** 프로젝트 디렉토리·설정·문서·에이전트 팀의 초기 구성을 확정하고, Next.js 기동·DB 헬스체크·안전장치 스텁이 연결되어 있는 상태까지 만든다.

## 체크리스트

- [x] `TradingInvest/` 디렉토리 트리 생성
- [x] `.claude/settings.json` (Agent Teams 활성화)
- [x] `.claude/agents/` — leader / developer / qa / analyst
- [x] `package.json` + `tsconfig.json` + `next.config.js`
- [x] `.env.example` — DB / 거래소 / 안전장치 변수
- [x] `.gitignore` + `.claudignore`
- [x] `src/lib/db.ts` — MariaDB Pool + Retry + ping
- [x] `src/lib/exchanges/types.ts` — 공통 인터페이스
- [x] `src/lib/exchanges/coinone.ts` / `binance.ts` — 스텁 (코인원 시세 조회만 실구현, 업비트는 확장 예정)
- [x] `src/lib/safety/` — kill-switch / order-limits / dry-run 래퍼
- [x] `src/app/layout.tsx` + `page.tsx`
- [x] `src/app/api/health/route.ts` — DB ping + safety 설정 리포트
- [x] `docs/` — architecture / db-schema / trading-strategy / api-integrations
- [x] `CLAUDE.md` / `README.md` / `기획서_V0.1.md`

## 완료 조건

- `npm install && npm run dev`로 `http://localhost:3000` 접근 가능
- `GET /api/health` 응답에 DB·safety 설정 포함
- `npm run build` 통과
- `.claude/agents/` 4인 팀이 인식됨

## 산출물

초기 저장소 구조. 실제 거래·지표 로직은 이번 단계에서는 구현하지 않는다(스텁만). Phase 2부터 시세·포트폴리오·실매매·지표·백테스트·KIS 확장을 순차 진행한다.

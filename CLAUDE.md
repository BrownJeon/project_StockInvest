# StockInvest 프로젝트

**국내주식 분석·매매·수익화 웹앱 — "주식으로 돈벌자"**

한국투자증권(KIS) OpenAPI 기반 국내주식 자동매매. 분석 → 시그널 승인 → 실매매 → 수익 분석을 통해 실질 수익 창출을 목적으로 한다. (자매 프로젝트: 암호화폐 `TradingInvest` — 코인원 실매매, 공통 인프라 공유.)

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드·API | Next.js 14 (App Router) + TypeScript |
| 데이터베이스 | MariaDB (NAS 호스팅, mysql2/promise) |
| 거래소·증권사 | 코인원 REST(현재) → 업비트(확장) → 바이낸스(선택) → KIS OpenAPI |
| 지표 | 자체 구현 (순수 함수) — TA-Lib 값과 대조 |

## 디렉토리 구조

```
TradingInvest/
├── .claude/
│   ├── settings.json              # Agent Teams 활성화
│   ├── settings.local.json
│   └── agents/                    # leader(Opus) / developer(Opus) / qa(Haiku) / analyst(Fable)
├── docs/
│   ├── architecture.md
│   ├── db-schema.md
│   ├── trading-strategy.md
│   └── api-integrations.md
├── phases/
│   └── phase-01 ~ phase-07.md     # 단계별 로드맵
├── src/
│   ├── app/                       # Next.js 페이지·API Route
│   ├── components/
│   ├── lib/
│   │   ├── db.ts                  # MariaDB Pool + Retry
│   │   ├── exchanges/             # coinone / upbit(확장) / binance / kis 어댑터
│   │   └── safety/                # Kill Switch / 주문 한도 / DRY_RUN
│   └── types/
├── public/
├── .env.example
├── .gitignore
├── .claudignore
├── package.json
├── tsconfig.json
└── next.config.js
```

## 환경 설정

1. `.env.example`을 `.env`로 복사 후 값 채우기
2. DB 접속 정보 (NAS MariaDB), 거래소 API 키, 안전장치 변수 필수
3. `.env`는 절대 커밋하지 않는다 (`.gitignore` 등록 완료)

```bash
cp .env.example .env
# 값 입력 후
npm install
npm run dev   # http://localhost:3000
```

### 안전장치 환경변수 (필수)

| 변수 | 기본값 | 역할 |
|------|--------|------|
| `DRY_RUN` | `true` | `true`면 실제 거래소 API 호출 차단, 로그만 |
| `KILL_SWITCH` | `false` | `true`면 모든 주문 송신 즉시 차단 |
| `ORDER_MAX_KRW` | `100000` | 1회 주문 최대 KRW |
| `DAILY_ORDER_MAX_KRW` | `500000` | 1일 누적 주문 최대 KRW |
| `ALLOWED_SYMBOLS` | `KRW-BTC,KRW-ETH` | 허용 심볼 화이트리스트 |

## 에이전트 팀

Workspace의 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`이 활성화되어 있다. 프로젝트 전용 팀은 4인 (역할별 모델 차등):

| 역할 | 모델 | 담당 |
|------|------|------|
| leader | **Opus** | 요구사항 분석·구현 가이드·조율 |
| developer | **Opus** | Next.js·거래소 어댑터·DB 코드 구현 |
| qa | **Haiku** | **실매매 안전장치 전담 검증** (최우선) |
| analyst | **Fable** | 지표·전략·백테스트 설계, 수치 검증 |

자세한 역할은 `.claude/agents/*.md` 참고.

## Phase 로드맵

| Phase | 내용 | 상태 |
|-------|------|------|
| 01 | 기본 골격 구성 | ✅ |
| 02 | 코인원 시세·포트폴리오 조회 | ⬜ |
| 03 | 코인원 실매매(수동 주문) + 안전장치 | ⬜ |
| 04 | 기술 지표 엔진 (MA/RSI/MACD/볼린저) | ⬜ |
| 05 | 지표 기반 자동매매 실행 | ⬜ |
| 06 | 백테스팅·수익 분석 | ⬜ |
| 07 | KIS API 미국주식 확장 | ⬜ |

## 실매매 원칙 (중요)

1. **모든 주문 송신은 `src/lib/safety/dry-run.ts`의 `submitOrder()`를 경유**한다. 거래소 어댑터 `createOrder`를 직접 호출하지 않는다.
2. **단계적 도입**: DRY_RUN → 소액 실매매 → 자동화 순. 이전 단계 검증 없이 다음 단계로 가지 않는다.
3. **감사 로그 필수**: 성공·거부·에러 모두 `orders` / `trade_logs`에 남긴다.
4. **Kill Switch 발동 기준**은 `docs/trading-strategy.md` 참조. 발동 시 상황 리뷰 후 재개.

### DRY_RUN → 실거래 단계적 해제 가이드

**전제**: KIS_MOCK=false (실전 BASE), DB·cron·시세·잔고 모두 정상, 1주 이상 DRY_RUN으로 시그널 노이즈·승인율 모니터링 완료.

| 단계 | 환경변수 | 한도 | 검증 기간 | 통과 조건 |
|---|---|---|---|---|
| 0 (현재) | DRY_RUN=true | — | — | 시그널 발화·skip 카테고리 분포 합리적 |
| 1 | DRY_RUN=false, ORDER_MAX_DOMESTIC_KRW=10000, ORDER_MAX_OVERSEAS_KRW=10000, ANALYST_ENABLED=false | 1주씩 수동 승인만 | 3~5 영업일 | 매수→매도 1사이클 정상, 수수료/슬리피지 일치 |
| 2 | ANALYST_ENABLED=true | 한도 동일 | 1주 | 자동 시그널 승인율·EV 적중률 양수, dedup hit 비율 검토 |
| 3 | ORDER_MAX_*_KRW=50000 | — | 1주 | 일일 누적 한도 미초과, KILL_SWITCH 미발동 |
| 4 | 점진 상향 (200000 → 500000 → 정상 운영) | — | 단계마다 1주 | docs/trading-strategy.md 4단계 가이드라인 준수 |

각 단계 진입 전: `pm2 restart stockinvest --update-env` + `/api/health` 확인 + `pm2 logs stockinvest-cron`으로 cron 동작 확인.

## UI 설계 원칙

- **모바일 우선**: 주 사용 환경은 **갤럭시 S25+ + 크롬 모바일** (폭 ~412px). 모든 UI는 이 뷰포트에서 완결되게 설계·구현하고, `@media (min-width:900px)` 이상에서만 데스크탑 레이아웃 복원
- **네비게이션**: 하단 5-탭 고정 바 (🏠 대시보드 / 📝 주문 / 🎯 전략 / 📈 분석 / ⚙️ 설정). 탭별 라우트·화면 목록·Phase 매핑은 [`docs/screens.md`](./docs/screens.md) 참조
- **색상**: 한국 관습 — 상승 빨강 / 하락 파랑
- **차트 라이브러리**: lightweight-charts 표준
- 상세 규칙은 [`.claude/agents/developer.md`](./.claude/agents/developer.md) "화면 디자인 워크플로우" 참조

## 금기 사항

- API 키·패스워드 하드코딩 금지 (`.env`만 사용)
- safety 레이어 우회 코드 금지
- `.env` 커밋 금지
- 백테스트 미검증 전략의 실매매 운용 금지
- **UI 목업 합의 없이 화면을 즉흥 구현 금지** (developer.md 워크플로우 참조)

## Compact instructions

컴팩트 시에는 **변경된 파일 경로, Phase 진행 상태, 미해결 결정 사항, 실매매 안전장치 관련 이슈**를 우선 보존한다. 상세 탐색 결과와 중간 디버깅 출력은 버린다.

---

## 🔴 작업 재개 프로토콜 (최우선)

사용자가 **"이어서 작업해줘"** 또는 이에 준하는 말을 하면, 다른 말을 하기 전에 아래를 먼저 읽는다.

1. [`agent-vault/00-Context/RESUME.md`](./agent-vault/00-Context/RESUME.md) — **재개 진입점.** 현재 상태·다음 할 일·환경 제약이 전부 여기 있다
2. [`agent-vault/00-Context/ACTIVE.md`](./agent-vault/00-Context/ACTIVE.md) — 상세 현황
3. [`agent-vault/10-Flow/board.md`](./agent-vault/10-Flow/board.md) — 칸반

그다음 RESUME.md의 "다음 할 일" 1번부터 진행한다. **세션 메모리나 로컬 플랜 파일에 의존하지 말 것** — 작업 환경(PC)이 바뀔 수 있으므로 모든 맥락은 vault 안에 둔다.

**진행 중인 큰 작업**: 프로젝트 재구성 (시그널 미생성·수익 부재 원인 해소). 진단·설계 전문은 [`agent-vault/30-Knowledge/decisions/2026-08-02-restructure-plan.md`](./agent-vault/30-Knowledge/decisions/2026-08-02-restructure-plan.md).

## 에이전트 팀 세션 프로토콜

이 CLAUDE.md 로드 및 현재 상태 요약 완료 후, 아래 팀 소집 문구를 자동 출력한다.

```
---
🚀 에이전트 팀 소집
프로젝트: 주식 자동매매 (StockInvest)
팀 구성:
  - leader   (Opus)   — 요구사항 분석·작업 분배·최종 보고
  - developer (Opus)   — Next.js·KIS OpenAPI·DB 코드 구현
  - analyst  (Fable)  — 지표·전략·백테스트 설계 및 실매매 시그널 실행
  - reviewer (Sonnet) — 안전장치 우회 경로·아키텍처·보안 독립 감사
  - qa       (Haiku)  — 실매매 안전장치·엣지케이스 전담 검증

워크플로우: Leader → Analyst → Developer → Reviewer → QA → Leader
작업 지시 방법:
  → leader에게 직접 요청하면 팀이 역할별로 분담해서 처리합니다.
  → 팀 정리 시: "팀 정리해줘" 또는 "Clean up the team"
---
```

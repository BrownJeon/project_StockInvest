<!-- Generated from CLAUDE.md by cc-sync-codex/sync-projects.ps1. Edit CLAUDE.md, then run the script. -->

# StockInvest 프로젝트

**미국(해외)주식 주력·국내주식 병행 — 분석·매매·수익화 웹앱 — "주식으로 돈벌자"**

한국투자증권(KIS) OpenAPI 기반 미국(해외)주식 주력·국내주식 병행 자동매매. 분석 → 시그널 승인 → 실매매 → 수익 분석을 통해 실질 수익 창출을 목적으로 한다. (2026-10-20 사용자 지시로 주력을 국내에서 미국주식으로 전환 — 설계 `T-057`. 종래의 "해외 보류" 결정(2026-08-02)은 대체됐다.) (자매 프로젝트: 암호화폐 `TradingInvest` — 코인원 실매매, 공통 인프라 공유.)

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드·API | Next.js 14 (App Router) + TypeScript |
| 데이터베이스 | MariaDB (NAS 호스팅, mysql2/promise) |
| 증권사 | 한국투자증권 KIS OpenAPI — 국내(`kis-domestic`)·해외(`kis-overseas`), 진입점 `src/lib/exchanges/kis.ts` |
| 지표 | 자체 구현 (순수 함수) — TA-Lib 값과 대조 |

## 디렉토리 구조

```
StockInvest/
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
│   │   ├── exchanges/             # kis(진입점)·kis-auth·kis-http·kis-throttle·kis-domestic·kis-overseas·kis-master·kis-symbols·fx
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
npm run dev   # http://localhost:3003
```

### 안전장치 환경변수 (필수)

| 변수 | 기본값 | 역할 |
|------|--------|------|
| `DRY_RUN` | `true` | `true`면 실제 거래소 API 호출 차단, 로그만 |
| `KILL_SWITCH` | `false` | `true`면 모든 주문 송신 즉시 차단 |
| `ORDER_MAX_KRW` | `100000` | 1회 주문 최대 KRW |
| `DAILY_ORDER_MAX_KRW` | `500000` | 1일 누적 주문 최대 KRW |
| `ALLOWED_SYMBOLS` | (코드에서 읽지 않음) | 초기 복사본 항목 — 현재 `src/lib/symbols.ts` `isAllowedSymbol()` 은 항상 허용, 국내 6자리·해외 `NAS:AAPL` 형식 |

## 에이전트 팀

> **Codex 세션 주의 (cc-sync-codex 가 추가):** 이 파일은 Claude Code 용 `CLAUDE.md` 에서 생성된다. Codex 에는 `codex` 역할이 없다(Codex 안에서 Codex 를 다시 부르는 순환). judge 접수 분류와 `codex_gate` 판정·기록은 아래 절차 그대로 하되, `codex_required: true` 여서 codex 를 호출해야 하는 단계는 호출하지 않고 task 이력서 `## 판단 기록 (judge)` 에 `override: codex_unavailable_in_codex` 를 남긴 뒤 진행한다. judge 의 `developer_model`(sonnet/opus)과 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 는 Claude Code 용 설정이라 Codex 에서는 적용하지 않는다. Codex 역할 정의는 `.codex/agents/*.toml` 이다.

Workspace의 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`이 활성화되어 있다. 프로젝트 전용 팀은 **8인** (역할별 모델 차등):

| 역할 | 모델 | 담당 |
|------|------|------|
| leader | **Opus** | 요구사항 분석·구현 가이드·조율 |
| developer | **Opus** | Next.js·거래소 어댑터·DB 코드 구현 |
| qa | **Haiku** | **실매매 안전장치 전담 검증** (최우선) |
| analyst | **Fable** | 지표·전략·백테스트 설계, 수치 검증 |
| reviewer | **Sonnet** | 안전장치 우회 경로·아키텍처·보안 독립 감사 |
| deployer | **Haiku** | 운영 배포 실행·`RELEASE_RESULT` 판정·롤백 — 절차서 [`docs/deploy-order.md`](docs/deploy-order.md) |
| judge | **Haiku** | Jev 판정 도구 실행 — 작업 접수 분류·developer 모델·Codex 개입 판정(C1·C2·C3). 직접 추론·코드 수정 금지 (2026-09-28 팀 프로젝트 확산) |
| codex | **Haiku** | judge 개입 판정 시에만 Codex CLI 읽기 전용 검토 실행·기록. 실패해도 작업 진행 후 실패 내역 보고 |

자세한 역할은 `.codex/agents/*.toml` 참고.

## Phase 로드맵

> 이 표는 프로젝트 생성 때 TradingInvest(코인원)에서 복사된 초기 로드맵이라 실제 진행과 다르다(2026-09-28 정정). **현재 진행 상황은 `agent-vault/10-Flow/board.md`·`00-Context/ACTIVE.md` 가 정본이다.**


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
- 상세 규칙은 [`.codex/agents/developer.toml`](./.codex/agents/developer.toml) "화면 디자인 워크플로우" 참조

## 금기 사항

- API 키·패스워드 하드코딩 금지 (`.env`만 사용)
- safety 레이어 우회 코드 금지
- `.env` 커밋 금지
- 백테스트 미검증 전략의 실매매 운용 금지
- **UI 데모(목업) 승인 없이 화면을 즉흥 구현 금지** — 데모는 designer 담당, 워크스페이스 [`docs/demo-review-gate.md`](../docs/demo-review-gate.md) 데모 검토 게이트(2026-09-28)
- **Reviewer 독립감사 없이 안전 관련 코드를 커밋 금지** (아래 커밋 안전장치 참조)

## 커밋 안전장치 — commit-msg git 훅 (T-025)

2026-08-13에 Reviewer 독립감사 없이 코드가 커밋·배포된 절차 위반이 있었다(T-023 / T-024). 재발 방지를 위해 **문서가 아니라 git 훅으로 기계적으로 강제**한다.

**동작**: 커밋의 staged diff에 안전 관련 경로(아래 참조)가 포함되면 → 커밋 메시지에 task ID(`T-NNN`)가 있고, `agent-vault/10-Flow/tasks/T-NNN-*.md`의 `## Reviewer` 섹션 **마지막 `최종 판정` 줄**이 `PASS`/`CONDITIONAL_PASS`이며, **그 판정의 `scope`가 지금 staged된 안전 파일을 전부 포함**해야만 통과한다. 문서·UI·vault 전용 커밋은 검사하지 않는다. 여러 task ID를 참조하면 그중 하나라도 조건을 만족하면 통과한다.

**대상 경로 — 유일한 출처는 코드다.** 과거 이 문서가 실제 목록보다 9개 항목 뒤처진 드리프트가 감사에서 적발됐다. 목록을 여기에 복제하지 않는다. 지금 무엇이 걸리는지는 항상 아래로 확인한다.

```bash
awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg   # 권위 있는 전체 목록
```

대분류만 적으면(세부는 위 명령으로): **주문·거래소·안전장치 / 무인 실행(cron) / 시그널·전략 발화 / 자격증명 / 매매 설정 / 인증 관문 / 안전장치 자신(훅·설치·테스트 스크립트)**. 각 경로를 넣고 뺀 근거는 `SAFETY_PATHS` 배열 위 주석에 항목별로 달려 있다 — 목록을 고칠 때는 근거도 같이 적는다.

경계 판단 두 가지만 여기 남긴다(반복해서 재논의되므로):

- **포함**: `settings/blocked-symbols` — 화이트리스트 정책이 2026-04-25 폐기되어, `order-limits.ts`의 `checkSymbolBlacklist()`가 읽는 이 블랙리스트가 **현재 유일한 실효 심볼 안전장치**다. `auth/oauth/` — `OAUTH_PUBLIC_PATHS`가 `middleware.ts`의 무인증 통과 목록에 그대로 펼쳐지므로, 여기에 문자열 하나만 넣으면 미들웨어를 건드리지 않고 임의 API를 열 수 있다.
- **제외**: `settings/watch-symbols`(그 값을 읽는 코드가 `src/`에 0건 — 실측), 로그인 시도제한 계열(`*-gate.ts`·`request-limits.ts` — 권한을 주고 뺏는 코드가 아니라 시도 속도만 늦춘다).
- **테스트 파일은 제외하지 않는다.** 과도차단이라는 지적이 있었으나, 안전 경로의 테스트는 그 경로의 회귀망이고 "테스트 전부 통과"가 Reviewer·QA 판단 근거이므로 그 근거를 무검토로 바꿀 수 있게 두지 않는다(`test-git-hooks.sh`를 포함시킨 것과 같은 논리). 제외 규칙 자체가 우회 표면이 된다는 이유도 있다.

**설치 (신규 clone·새 머신·새 워크트리마다 1회 필수)**:

```bash
bash scripts/install-git-hooks.sh   # core.hooksPath 설정 + 실행가능 여부 검증
bash scripts/test-git-hooks.sh      # 전 시나리오 + 실 커밋 E2E 검증
```

훅 파일을 **새로 추가**했을 때(pre-commit 등)도 `install-git-hooks.sh`를 반드시 재실행한다. shim 모드에서는 설치 시점에 존재하던 훅 이름만 shim이 생기므로, 새 훅은 **아무 경고 없이 무음으로 비활성**된다(기존 훅의 내용 변경은 재실행 불필요). 재실행을 잊는 것이 바로 이 실패모드이므로, `commit-msg` 훅이 **매 커밋마다 원본↔shim을 대조해 경고**한다(경고일 뿐 차단하지는 않는다 — 무시하면 그 훅은 여전히 비활성이다). 설치 스크립트는 저장소에서 사라진 훅의 낡은 shim도 함께 정리한다.

`.git/hooks/`는 clone마다 로컬이라 저장소로 배포할 수 없으므로, 훅 원본은 `scripts/git-hooks/`에서 버전관리하고 `core.hooksPath`로 연결한다. **설치를 잊으면 훅은 존재하지 않는 것과 같다** — git은 저장소 내용만으로 훅을 자동 활성화하지 않는다(보안상 불가). 새 환경에서 작업을 시작할 때 위 두 명령을 먼저 실행할 것.

> ⚠ **noexec 마운트 주의**: 이 저장소의 주 편집 경로(`/home/.../NFS/...`)는 NFS `noexec`라 `chmod +x`가 무효다. git은 **실행 불가한 훅을 경고 한 줄만 남기고 조용히 무시한 채 커밋을 진행**하므로, 단순히 `core.hooksPath=scripts/git-hooks`만 설정하면 안전장치가 통째로 fail-open 된다. `install-git-hooks.sh`가 이를 자동 감지해 로컬 디스크(`~/.local/share/stockinvest-git-hooks/`)에 실행 가능한 shim을 만들고 그쪽을 가리키며, 설치 끝에 실행 가능 여부를 검증해 실패 시 비정상 종료한다.

**Reviewer 기록 작성 규칙** (훅이 판정을 인식하려면 필수):

Reviewer는 `## Reviewer` 섹션 **마지막에 아래 한 줄**을 반드시 남긴다. 마크다운 장식·타임스탬프 접두는 허용된다.

```
- [10:40] **최종 판정: PASS (scope: src/lib/safety/, src/app/api/orders/)**
```

- **`최종 판정`이 들어간 줄만** 판정으로 인정하며, 그중 **마지막 줄 하나만** 유효하다(라운드1 PASS 뒤 라운드2 FAIL이면 FAIL). 판정 단어를 *설명*하는 산문은 판정으로 취급되지 않는다.
- 판정은 **리터럴 대문자** `PASS` / `CONDITIONAL_PASS` / `FAIL`. 소문자나 의역("승인함")은 인식되지 않는다.
- **`scope`는 이번에 실제로 검토한 경로 목록**이며 필수다. staged된 안전 파일이 전부 이 범위 안이어야 통과한다. 과거 판정을 무관한 파일에 끌어다 쓰는 것을 막는 장치다. (완화가 필요하면 훅의 `REQUIRE_SCOPE=1` → `0`이지만, **Leader 판단 사항**이며 아래 CRITICAL이 재발한다.)
- `## Reviewer` 섹션 안에서는 **소제목(`###`) 없이 flat한 `- [HH:MM]` bullet만** 사용한다. 제목에 "Reviewer"가 없는 소제목이 나오면 훅의 섹션 스캔이 거기서 끊겨 이후 판정을 놓친다(fail-closed라 오탐 차단이지 통과 누출은 아니다). 실제 사례: T-020의 `**최종 판정: PASS.**`는 `### 종합` 아래에 있어 훅이 인식하지 못한다.
- **판정이 뒤집히면 낡은 기록을 남겨두지 말고 정리한다.** 지우거나 `## 폐기된 판정 이력` 섹션으로 이관한다.
  > 🔴 이관할 때 **소제목에 "Reviewer"라는 단어를 쓰면 안 된다.** 훅의 `reviewer_body()`는 제목에 그 단어가 든 `##`/`###` 헤딩을 **전부** Reviewer 섹션으로 간주하므로, 폐기했다고 적어둔 옛 `PASS`가 그대로 되살아나 fail-open이 된다. (`## 폐기된 판정 이력 (superseded)` 처럼 쓴다.)
- **판정 단어를 설명·인용할 때는 소문자로 쓴다**(`pass`/`fail`). 훅은 대문자 리터럴만 매치하므로, 결함을 *서술하는* 산문에 대문자를 쓰면 그 문서가 스스로 fail-open된다 — 감사 중 실제로 두 번 발생했다. 대문자는 **진짜 판정 줄 하나**에만 쓴다.

> 🔴 **이 훅이 보증하지 않는 것 — 마지막 한 칸은 사람의 규율이다**
>
> 1. **self-attestation**: 훅은 판정이 *있는지*만 보고 **누가 썼는지는 검증하지 않는다.** 스스로 `최종 판정: PASS`를 적어 넣으면 독립감사 없이 통과된다.
> 2. **차용된 정당성**: `scope`가 이를 막지만, Reviewer가 검토하지도 않은 넓은 범위(`scope: src/`)를 적어 주면 다시 무의미해진다. 이 프로젝트는 `related_tasks`로 과거 task를 엮는 게 일상적이라 **악의 없이도 쉽게 트리거된다.**
>
> 순수 bash·신규 의존성 금지 제약상 작성자 인증은 구현 범위 밖이다. 따라서 **스스로 PASS를 적는 것, 무관한 과거 task ID를 편의상 인용하는 것, 검토하지 않은 경로를 scope에 적는 것은 모두 `git commit --no-verify` 오남용과 동급으로 금지한다.** 이 훅은 "잊고 지나치는 사고"를 막는 장치이지 의도적 우회를 막는 장치가 아니다.

**우회**: 오탐 시 `git commit --no-verify`로 우회할 수 있다. 이는 **사용자(사람) 전용 권한**이며, 에이전트가 임의로 사용하는 것은 금지한다(이 훅의 존재 이유가 무력화된다).

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

## 배포

배포 절차의 **정본은 [`docs/deploy-order.md`](docs/deploy-order.md)** 다. 배포 전에 그 문서를 먼저 읽는다.

| 항목 | 값 |
|---|---|
| 배포 명령 | `scripts/deploy.sh StockInvest` |
| 실행 주체 | `.codex/agents/deployer.toml` (QA PASS 이후에만 기동) |
| 대상 프로세스 | stockinvest + stockinvest-cron |
| 현재 상태 | ✅ **blue/green 컷오버 완료 (2026-09-19, 릴리스 `20260919-225120-31f4ea26`)**. push 하면 webhook 이 release.sh 로 blue/green 배포한다 — NFS 트리에 빌드해도 운영에 반영되지 않는다 |

- 배포는 **`origin` 의 ref 기준**이다 — push 되지 않은 커밋은 나가지 않는다.
- `--with-migrate`(DB 마이그레이션)는 **사용자 승인 사항**이다. 개발과 운영이 같은 NAS MariaDB 를 보고, 롤백은 코드만 되돌린다.
- 배포 실패로 수정했다면 곧바로 재배포하지 않고 **Reviewer 부터 전체 재순환**한다.

워크스페이스 공통: [배포 메커니즘](../docs/dev-deploy-workflow.md) · [연계 정책](../docs/deployer-integration-procedure.md) · [롤아웃 순서](../docs/deploy-rollout-order.md)

## 에이전트 팀 세션 프로토콜

이 AGENTS.md 로드 및 현재 상태 요약 완료 후, 아래 팀 소집 문구를 자동 출력한다.

```
---
🚀 에이전트 팀 소집
프로젝트: 주식 자동매매 (StockInvest)
팀 구성:
  - leader   (Opus)   — 요구사항 분석·작업 분배·최종 보고
  - designer  (Opus)   — 화면 데모(mockups/)·사용자 승인·구현 가이드 (데모 검토 게이트: 워크스페이스 docs/demo-review-gate.md)
  - developer (Opus)   — Next.js·KIS OpenAPI·DB 코드 구현
  - analyst  (Fable)  — 지표·전략·백테스트 설계 및 실매매 시그널 실행
  - reviewer (Sonnet) — 안전장치 우회 경로·아키텍처·보안 독립 감사
  - qa       (Haiku)  — 실매매 안전장치·엣지케이스 전담 검증
  - deployer (Haiku)  — 운영 배포 실행(scripts/deploy.sh StockInvest, 앱 2개)·결과 판정·롤백
  - judge     (Haiku)  — Jev 판정: 작업 접수 분류·developer 모델·Codex 개입(C1 설계·C2 리뷰 후·C3 재발)
  - codex     (Haiku)  — judge 판정 시에만 Codex 읽기 전용 외부 검토, 실패는 보고 후 진행

워크플로우: Leader(→Judge 접수) → Analyst → [화면 작업: Designer 데모 → 사용자 승인] → [Judge C1 → Codex?] → Developer → Reviewer → [Judge C2 → Codex? → Reviewer 판정] → QA → Deployer → Leader
작업 지시 방법:
  → leader에게 직접 요청하면 팀이 역할별로 분담해서 처리합니다.
  → 팀 정리 시: "팀 정리해줘" 또는 "Clean up the team"
---
```

## AI 대화·작업 공통 원칙 (할루시네이션 방지·명확한 소통)

> 워크스페이스 `AGENTS.md`의 같은 이름 절과 동일한 내용이다(2026-10-05 사용자 지시). 정본은 워크스페이스 쪽이며, 바꿀 때는 정본을 먼저 고치고 이 절을 맞춘다. 메인 세션과 서브에이전트 모두에 적용한다.

1. **동의로 시작하지 않는다.** 첫 문장에서 사용자의 가정에 의문을 제기하거나, 놓친 점을 짚거나, 생각의 허점을 드러내는 질문을 한다.
2. **확신 수준을 표시한다.** 주장 앞에 `[확실]`(근거가 확실) · `[가능성 높음]`(강한 추론) · `[추측]`(빈틈을 추측으로 메우는 중)을 붙인다. 답변 대부분이 추측이면 먼저 그렇게 밝힌다.
3. **금지 표현:** '좋은 질문이에요', '전적으로 맞아요', '말씀하신 게 맞습니다', '정말 그렇습니다', '분명히 그렇습니다'. 쓰려는 걸 알아차리면 지우고 다시 쓴다.
4. **반대는 논리적으로 설명한다.** 사용자가 틀렸다면 "이런 이유로 동의하기 어렵습니다. 대신 이 방법을 권합니다: [대안]. 지금 접근법의 구체적인 위험은 [단점]입니다." 형태로 말한다.
5. **중요한 답부터, 불편한 사실도 먼저.** 사용자가 듣고 싶어 하지 않을 사실은 세 번째 문단에 숨기지 않고 앞에 둔다.
6. **서론을 길게 쓰지 않는다.** "여러 관점에서 볼 수 있습니다" 류는 건너뛰고 가장 유용한 내용부터 시작한다.
7. **쉽게 입장을 바꾸지 않는다.** 사용자가 새로운 정보를 제시하지 않는 한 근거를 유지한다. "그래도 제 생각은…"은 새로운 정보가 아니다.

**적용 범위:**
- 고정 형식 출력(세션 시작 목록, 팀 소집 문구, 에이전트 간 메시지 스키마, Agent Vault task 이력서·최종 요약 양식, 코드·JSON·로그)은 형식을 그대로 따르고, 그 안의 판단·근거 서술에만 규칙을 적용한다.
- 규칙 1은 의견·설계·제안·판단이 오가는 대화에 적용한다. 단순 실행 결과 보고·확인 질문에는 억지 반론을 만들지 않으며, 반론은 구체적 근거(코드·로그·문서·수치)가 있을 때만 한다.
- 규칙 2의 `[확실]`은 이번 세션에서 직접 읽거나 실행해 확인한 것에만 쓴다. 명령 출력을 그대로 인용하는 단순 사실 전달에는 태그를 생략해도 된다.
- 규칙 7은 의견 철회 금지이지 지시 실행 거부가 아니다. 사용자가 위험을 듣고도 결정하면 위험을 한 번 명시한 뒤 지시대로 진행하고 같은 반론을 반복하지 않는다. 배포·삭제·비활성 프로젝트 등 별도로 확인을 요구하는 작업은 기존 규칙대로 한다.
- 앱이 최종 사용자에게 보여 주는 런타임 LLM 출력(페르소나·프롬프트 결과)과 앱 코드·프롬프트의 내용에는 적용하지 않는다. 이 원칙은 개발 작업 중 AI↔사용자 소통에 대한 것이다.

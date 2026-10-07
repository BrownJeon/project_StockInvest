---
task_id: T-016
title: "추천 → 내 시나리오 만들기 'invalid id' — /recommend/build 페이지 누락"
status: done
commit: c0324d6
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-005-next15-upgrade]
tags:
  - type/task
  - domain/ui
  - domain/signals
aliases:
  - invalid id 버그
  - 시나리오 등록 실패
  - recommend build 404
created: 2026-08-09
updated: 2026-08-09
---

## 목표 (Leader 작성)

사용자 신고: "추천" 메뉴에서 시나리오를 등록하려 하면 "invalid id"로 실패한다. **빈번히 발생**하며, 근본적으로 고쳐달라는 요청.

## 조사 (Leader, 읽기전용 → 원인 확정)

Explore 서브에이전트로 프론트 → API 흐름을 전수 추적, 이후 leader가 관련 파일을 직접 재확인.

1. **재현 경로**: `src/app/recommend/page.tsx:279` "내 시나리오 만들기 +" 버튼이 `router.push('/recommend/build')` 호출.
2. **근본 원인**: `src/app/recommend/build/page.tsx`가 **존재하지 않는다.** Next.js App Router는 정적 세그먼트가 없으면 동적 세그먼트로 폴백하므로, `/recommend/build` 요청이 `src/app/recommend/[id]/page.tsx`에 `params.id = "build"`로 매칭된다.
3. **에러 발생 지점**: `recommend/[id]/page.tsx:10` → `Number("build")` = `NaN` → `<ScenarioDetail signalId={NaN}>` → `ScenarioDetail.tsx:91` → `fetch('/api/signals/NaN')` → `src/app/api/signals/[id]/route.ts:13` → `Number.isFinite(NaN)` false → `{ok:false, error:'invalid id'}` 400 응답 → `ScenarioDetail.tsx:98,318-320`가 헤더·뒤로가기 버튼도 없이 "invalid id" 텍스트만 렌더. 사용자는 여기서 완전히 막힘.
4. **버튼을 누르면 100% 재현**되므로 "빈번히 발생" 증언과 정확히 일치 — 타이밍/캐시 문제가 아니라 순수 라우팅 버그.
5. **원래 설계는 이미 존재**: `docs/screens.md:83,88,187` — "[내 시나리오 만들기] → ScenarioBuilder"가 명세돼 있고, 실제로 `src/components/ScenarioBuilder.tsx`(방향/종목/분할/기간 입력 폼, `onAnalyze(values)` 콜백까지 완성)와 `src/components/ScenarioAnalysis.tsx`(AI 분석결과 표시 + `onConfirm(scenario)`/`onEdit()` 콜백까지 완성)가 **둘 다 완전히 구현돼 있다.** 다만 `src/app` 어디에서도 import되지 않는 고아 컴포넌트로 방치돼 있었다(개발되고 페이지 연결만 빠진 상태로 추정).
6. **백엔드도 이미 완성**: `POST /api/signals/custom`(`route.ts`) — 입력값으로 지표 계산 + LLM 보강 분석 반환(`ScenarioBuilder`의 `onAnalyze` 결과 = 이 API 응답). `POST /api/signals/custom/confirm` — 확정된 시나리오를 `signals` 테이블에 `status='approved_pending_entry'`로 INSERT(`ScenarioAnalysis`의 `onConfirm` 결과 = 이 API 호출). **신규 백엔드 로직 불필요** — 순수 프론트엔드 배선 문제.
7. **참고 구현 패턴**: `src/app/recommend/[id]/page.tsx` + `ScenarioDetail.tsx`가 거의 동일한 구조(분할 입력 → confirm API 호출 → toast → `/recommend`로 이동)를 이미 구현해뒀다. 새 페이지는 이 컴포넌트의 헤더/뒤로가기/토스트/에러 처리 컨벤션을 그대로 따를 것.
8. **agent-vault 과거 이력**: `"invalid id"` 리터럴 매치 0건 — 미보고 상태였음. `[[T-005-next15-upgrade]]`가 Next 15 업그레이드 스모크 테스트에서 `/recommend/1`(유효 ID)만 확인했고 `/recommend/build`(정적 세그먼트 부재) 케이스는 애초에 대상이 아니었다 — 이번 회귀가 아니라 **최초 구현 시점부터 누락**된 것으로 판단.
9. **DB**: 별도 `scenarios` 테이블 없음. `signals` 테이블(`docs/db-schema.md:71-88`, `id BIGINT PK AUTO`) 하나에 `scenario_source='user'`로 저장.

## Leader 지시사항 (역할별)

### Developer

**근본 수정**: `src/app/recommend/build/page.tsx` 신설. `ScenarioBuilder` → (POST `/api/signals/custom`) → `ScenarioAnalysis` → (POST `/api/signals/custom/confirm`) 흐름을 배선하는 클라이언트 페이지 컴포넌트를 작성한다.

- 단계 상태(`'build' | 'analysis'`)를 관리하는 `'use client'` 컴포넌트. `ScenarioDetail.tsx`의 헤더(뒤로가기 `←` + sticky bar)·`useToast()` 성공/실패 토스트·`router.push('/recommend')` 완료 후 이동 패턴을 그대로 재사용해 앱 전체 UI 컨벤션과 맞출 것.
- `ScenarioBuilder`의 `onAnalyze(values: BuilderValues)` → `POST /api/signals/custom`에 `{ market, symbol, direction, currentPrice, entryZonePct?, splits, holdingDeadline }` 형태로 전송(라우트의 `CustomBody` 참고), 응답을 `ScenarioAnalysis`의 `result: AnalysisResult` 형태로 변환해 `'analysis'` 단계로 전환. 로딩 중엔 `ScenarioBuilder`의 `loading` prop으로 버튼 비활성화.
- `ScenarioAnalysis`의 `onConfirm(scenario: ScenarioCard)` → `POST /api/signals/custom/confirm`에 `{ market, symbol, direction, scenario, currentPrice, manualSlices: values.manualSlices.filter(qty>0).map(...), splits }` 전송(`sourceSignalId`는 없음 — AI 추천 승인 경로가 아니라 사용자 직접 작성 경로이므로 생략). 성공 시 토스트 후 `/recommend`로 이동, 실패 시 에러 토스트만 표시하고 페이지 유지(재시도 가능하게).
- `ScenarioAnalysis`의 `onEdit()` → `'build'` 단계로 복귀, 기존 입력값 유지(`ScenarioBuilder`의 `initialValues` prop 활용).
- **방어적 보강(부가, 우선순위 낮음)**: `src/app/recommend/[id]/page.tsx`와 `src/app/api/signals/[id]/route.ts` 계열(`orders/[id]` 등 동일 패턴)에서 숫자 파싱 실패 시 현재는 사용자가 못 빠져나가는 막다른 화면이 뜬다. 시간이 되면 `ScenarioDetail.tsx:318-320`의 에러 렌더에 뒤로가기 버튼만이라도 추가 — 다만 이건 이번 버그의 재발 방지(정적 라우트 신설)와 별개의 화이트박스 보강이니 **본 수정을 지연시키면서까지 하지 않아도 됨**.
- 실거래 운영 코드다. `npm run typecheck` + `npm test`로 검증하고 (§CLAUDE.md 운영 메모) **`npm run build`는 절대 실행하지 말 것** — 이 워킹 디렉토리가 pm2가 서빙 중인 NFS 운영 경로라 `.next`를 덮어쓴다.
- **워킹트리에 이미 T-015(`[[T-015-disable-auto-exit-engine]]`) 관련 미커밋 변경이 있다** — `exit-switch.ts`/`engine.ts`/`TrailingStopTab.tsx`/`settings/safety/route.ts` 등. 이번 작업과 무관하니 **절대 건드리지 말고**, 신규 파일(`recommend/build/page.tsx`)만 추가할 것. `git add`는 이번에 만든/수정한 파일만 명시적으로 지정.

### Reviewer

- Developer 산출물이 사용자 의도(등록 버튼을 눌렀을 때 실제로 시나리오가 `signals` 테이블에 등록되는 것)를 충족하는지 확인.
- `confirm` API 호출 바디가 실제 라우트 스키마(`ConfirmBody`)와 일치하는지, 특히 `manualSlices` 필터링(qty>0)과 `splits` 값 일관성을 확인.
- 안전장치 우회 여부 확인(이 경로는 `submitOrder()`를 거치지 않는 것이 맞음 — 시그널 INSERT까지만 하고 실제 주문 진입은 별도 entry-watcher가 담당하는 기존 설계와 동일한지 `confirm/route.ts` 기준으로 재확인).
- `/recommend/build`가 정적 세그먼트로 우선 매칭되어 더 이상 `[id]`로 새지 않는지 라우팅 우선순위 논리 재확인.

### QA

- 실제 화면에서 "추천" → "내 시나리오 만들기 +" 클릭 → 방향/종목/분할/수량 입력 → AI 분석 → 결과 확인 → 등록까지 end-to-end 확인(가능하면 dry-run성 관찰: DB에 `scenario_source='user'` 행 생성 확인, 실주문 미발생 확인).
- "수정하기" 버튼으로 되돌아갔을 때 입력값이 유지되는지 확인.
- 기존 정상 흐름(AI 추천 카드 → 상세 → 승인)이 이번 변경으로 회귀하지 않았는지 확인 — `/recommend/[숫자]`가 여전히 정상 동작해야 함.

## Developer 기록

- [23:29] `src/app/recommend/build/page.tsx` 신규 생성 완료. `'use client'` 컴포넌트로 `step: 'build' | 'analysis'` 상태 관리. `ScenarioDetail.tsx`의 헤더(← 뒤로가기 + sticky bar) 패턴을 재사용해 동일한 UI 컨벤션 유지.
  - `handleAnalyze(v: BuilderValues)`: `POST /api/signals/custom`에 `{ market, symbol, direction, currentPrice, splits, holdingDeadline }` 전송(`entryZonePct`는 라우트 핸들러에서 실제로 사용되지 않는 필드임을 코드 확인 후 생략). 응답을 `AnalysisResult` 형태(`{ market, grade, ev, pWin, rr, buyRationale, risks, aiSuggestedScenario, currentPrice, priceUnit }`)로 매핑해 `'analysis'` 단계로 전환. `ScenarioBuilder`의 `loading` prop으로 분석 중 버튼 비활성화.
  - `handleConfirm(scenario: ScenarioCard)`: `POST /api/signals/custom/confirm`에 `{ market, symbol, direction, scenario, currentPrice, manualSlices: values.manualSlices.filter(qty>0).map(...), splits }` 전송, `sourceSignalId`는 지시대로 생략(사용자 직접 작성 경로). 성공 시 토스트 후 1.2초 뒤 `/recommend`로 이동, 실패 시 에러 토스트만 표시하고 페이지 유지(재시도 가능).
  - `handleEdit()`: `'build'` 단계로 복귀, `values` state를 `ScenarioBuilder`의 `initialValues`로 전달해 기존 입력값 유지.
  - 헤더 `←` 버튼은 `ScenarioDetail.tsx`와 동일하게 항상 `router.back()`(단계와 무관) — 분석 결과 화면에서 입력 화면으로만 되돌아가는 동작은 `ScenarioAnalysis`의 "수정하기" 버튼(`onEdit`)이 전담.
  - 방어적 보강(부가)은 시간 관계상 착수하지 않음 — 지시사항에 "본 수정을 지연시키면서까지 하지 않아도 됨"으로 명시돼 있어 우선순위대로 생략.
- [23:29] **중요 발견**: 프로젝트 루트 `.gitignore:9`에 앵커링 없는 `build/` 규칙이 있어, 새로 만든 `src/app/recommend/build/` 디렉터리 전체가 `git status`에서 보이지 않음(`git check-ignore -v` 확인). Next.js 라우팅/런타임에는 영향 없음(파일시스템 기준 동작하므로 pm2 서빙 정상) — 하지만 이후 사용자가 커밋할 때 `git add`만으로는 이 파일이 잡히지 않으므로 `git add -f src/app/recommend/build/page.tsx` 등 강제 추가가 필요하거나, `.gitignore`의 `build/` 규칙을 `/build/`(루트 전용)로 앵커링하는 수정이 별도로 필요함. **본 작업 범위(신규 페이지 파일 1개) 밖이라 `.gitignore`는 건드리지 않았음** — 커밋 진행 시 사용자/reviewer가 인지해야 함.
- [23:29] 검증: `npm run typecheck` 통과(에러 0), `npm test` 통과(80 suites / 1161 tests, 전부 PASS, 회귀 없음). `npm run build`는 지시대로 미실행. `git add`/`commit` 미실행.

## Reviewer 기록

- [23:50] 6개 항목 전수 감사 완료. 코드 자체는 결함 없음 — 아래 배포 프로세스 리스크 1건(HIGH)을 조건으로 CONDITIONAL PASS.
  1. **의도 충족**: PASS. `RecommendBuildPage`(`page.tsx`)가 `ScenarioBuilder.onAnalyze`→`POST /api/signals/custom`→응답을 `AnalysisResult`로 매핑→`ScenarioAnalysis.onConfirm`→`POST /api/signals/custom/confirm` 순서로 정확히 배선됨을 코드 대조로 확인. prop 시그니처(`initialValues/onAnalyze/loading`, `values/result/onConfirm/onEdit/submitting`)도 두 컴포넌트 정의와 일치. `npm run typecheck` 독립 재실행 → 에러 0 확인(개발자 보고와 일치).
  2. **`entryZonePct` 생략**: PASS. `custom/route.ts` 전체를 직접 읽어 확인 — `CustomBody.entryZonePct`는 인터페이스 선언에만 존재하고 함수 본문 어디에서도 `body.entryZonePct`를 참조하지 않음(진입구간은 ATR 기반 `aiDelta`로 별도 계산). 생략은 정당한 판단.
  3. **confirm 바디**: PASS. `page.tsx`의 `manualSlices: values.manualSlices.filter(s => Number(s.qty) > 0).map(s => ({ zoneLo: Number(...), zoneHi: Number(...), qty: Number(...) }))`가 `ConfirmBody.manualSlices: ManualSliceBody[]`(`{zoneLo:number; zoneHi:number; qty:number}`)와 정확히 일치. `ScenarioDetail.tsx:283-285`의 `handleApprove()` 필터/변환 로직과 동일 패턴(라인 단위로 비교 완료).
  4. **안전장치 우회 여부**: PASS. `confirm/route.ts`는 `signals` INSERT(status=`approved_pending_entry`)만 수행하며 `submitOrder`/`kis.createOrder` 호출 없음(전체 파일 확인). 실제 주문은 `src/app/api/cron/entry-watcher/route.ts:256` `submitOrder(orderReq, kis.createOrder, ...)`에서 별도로 처리됨을 grep으로 확인 — 설계 의도(등록↔진입 분리)와 일치, 우회 경로 없음.
  5. **라우팅**: PASS. Next.js App Router는 동일 세그먼트에서 정적 라우트를 동적 `[id]` 라우트보다 항상 우선 매칭 — `src/app/recommend/build/page.tsx` 신설로 `/recommend/build`가 더 이상 `[id]`로 새지 않음. `git status`로 `recommend/[id]/page.tsx` 미변경(diff 없음) 확인 — 기존 `/recommend/숫자` 경로 회귀 없음.
  6. **`.gitignore` 이슈 — 유효함, 조치 필요**: `git check-ignore -v src/app/recommend/build/page.tsx` → `.gitignore:9:build/`가 매치됨을 직접 재현 확인. `git status --porcelain --ignored`에서도 `!!`(완전 무시, `git add -A`로도 안 잡힘)로 확인. 배포 스크립트 `/home/brownjeon/.local/webhook-deploy/deploy-stockinvest.sh`를 직접 읽음 — `git clean -fdx -e .env -e node_modules -e .next` 실행 확인. `-x`는 gitignore된 파일도 삭제 대상에 포함시키고 예외(`-e`) 목록에 `build/`가 없으므로, **이 파일을 커밋하지 않고 두면 다음 배포 때 `git reset --hard`+`git clean -fdx` 단계에서 조용히 삭제되어 "invalid id" 버그가 재발한다** — 위험이 실재함을 확인. **권고**: 이번 task 범위에 `.gitignore:9`의 `build/` → `/build/`(루트 전용 앵커링) 수정을 포함시킬 것을 leader에게 권고한다(사용자가 "근본적으로 고쳐달라"고 명시했으므로 배포 프로세스에서 재발하는 것까지 포함해 근본 수정으로 간주해야 함). 대안으로 커밋 시 `git add -f src/app/recommend/build/page.tsx`만으로도 이번 1회는 방어되지만, `build/`라는 흔한 디렉터리명이 앵커링 없이 남아있는 한 향후 유사 이름의 신규 라우트마다 동일 문제가 재발할 잠재 리스크가 있어 `.gitignore` 수정이 근본적으로 더 안전함.
  - **최종 판정: CONDITIONAL PASS**. 코드(`recommend/build/page.tsx`) 자체는 Critical/High 결함 없이 의도대로 동작하나, 배포 파이프라인 리스크(HIGH, 항목 6)를 해결하기 전에는 "고쳤다"고 간주할 수 없다. 조건: (a) 커밋 전 `.gitignore:9`를 `/build/`로 수정하거나 최소한 `git add -f`로 신규 파일을 강제 추가할 것, (b) 위 조치 없이 배포되지 않도록 leader/사용자가 커밋 단계를 직접 확인할 것. QA는 화면 동작 검증을 진행해도 무방하나(코드 결함 아님), 최종 배포 승인은 (a) 완료 후로 미룰 것을 권고.

## QA 기록

- [23:37] **환경 확인**: `pm2 jlist` → `stockinvest` online, PID 402380, `ecosystem.config.js` 기준 포트 3003. 새 서버 기동 없이 기존 프로세스에만 검증 수행.
- [23:37] **`GET /recommend/build` / `/recommend/1` / `/recommend` 커브 테스트 — 결론: curl로는 라우팅 수정 자체를 구분 검증 불가**. `src/middleware.ts`가 Edge에서 세션 쿠키를 먼저 검증하며, 세 경로 모두 인증 없이는 정적/동적 세그먼트 판별 이전에 동일하게 `307 → /login?next=...`로 리다이렉트됨(바디에 "invalid id" 문자열 없음, 헤더도 정상). 즉 수정 전(`build`가 `[id]`로 새던 상태)과 수정 후(정적 라우트 매칭)가 미인증 curl 상에서는 **똑같이** 보여 이 방법으로는 회귀/수정을 판별할 수 없음 — 이건 버그가 아니라 인증 미들웨어가 정상 동작 중임을 보여줄 뿐. `POST /api/signals/custom`도 동일 미들웨어로 `401 {"ok":false,"error":"unauthorized","detail":"session missing"}` — API 스모크도 동일 사유로 미인증 상태에서는 실행 불가. 세션 쿠키를 인위적으로 발급(HMAC 서명)하려면 `.env`의 `AUTH_SESSION_SECRET`을 읽어야 하는데, 이는 sandbox 정책상 차단됨(secrets 파일 직접 열람 거부) — 우회 시도하지 않고 중단. **이 항목은 사용자가 실제 브라우저(로그인 세션)로 직접 확인해야 하는 잔여 검증으로 이관.**
- [23:37] **정적 파일 존재·라우팅 우선순위(코드 레벨) 재확인**: `src/app/recommend/build/page.tsx` 실존(4933 bytes) 확인. Next.js App Router 규칙상 동일 세그먼트에서 정적 라우트가 `[id]` 동적 라우트보다 항상 우선 매칭되므로, 미들웨어를 통과(로그인)한 이후에는 `/recommend/build`가 신설 페이지로, `/recommend/1`이 기존 `[id]` 페이지로 각각 정상 분기될 것으로 코드상 판단됨(런타임 재현은 미완 — 위 사유).
- [23:37] **`page.tsx` 배선 로직 직접 재확인**: `handleAnalyze`가 `POST /api/signals/custom`에 `{market,symbol,direction,currentPrice,splits,holdingDeadline}` 전송 후 응답을 `AnalysisResult`로 매핑 → `'analysis'` 단계 전환, `handleConfirm`이 `POST /api/signals/custom/confirm`에 `{market,symbol,direction,scenario,currentPrice,manualSlices(qty>0 필터+숫자변환),splits}` 전송(라인 77-109) — reviewer 기록과 코드가 정확히 일치함을 라인 단위로 재확인.
- [23:37] **`confirm/route.ts` 안전장치 재확인(경량)**: `grep -n "submitOrder\|createOrder\|kis\."` → 매치 0건, `signals` INSERT만 수행하고 `status='approved_pending_entry'`로 종료(라인 139-188) — 실주문 미발생, entry-watcher로의 책임 분리 유지를 독립적으로 재확인. `POST /api/signals/custom/confirm`은 지시대로 직접 호출하지 않음.
- [23:37] **`npm run typecheck`**: 에러 0, developer/reviewer 보고와 일치.
- [23:37] **`npm test`**: 80 suites / 1161 tests 전부 PASS, developer 보고(80/1161)와 정확히 일치. 회귀 없음.
- [23:37] **`git status`**: `.gitignore` 수정 확인(`9:build/` → `9:/build/`, `git diff` 재확인) — reviewer의 CONDITIONAL PASS 조건(a)이 이미 leader에 의해 해소됨. `git check-ignore -v src/app/recommend/build/page.tsx` → 매치 없음("NOT IGNORED") 확인, `git status --porcelain`에도 `?? src/app/recommend/build/`로 정상 추적 대상 표시됨. 워킹트리의 T-015 관련 변경(`exit-switch.ts`/`engine.ts`/`TrailingStopTab.tsx`/`settings/safety/route.ts` 등)은 손대지 않음(수정 파일 목록에 없음, 지시 준수 확인).

### 판정: ✅ 코드 레벨 검증 통과 (PASS) — 단, 브라우저 실사용 검증은 미완

- typecheck·test·git 추적 상태·안전장치(주문 미호출)·배선 로직 대조 등 **curl/코드로 검증 가능한 모든 항목은 결함 0건, developer/reviewer 보고와 전부 일치**.
- **HTML 응답 레벨의 라우팅 재현(`/recommend/build`가 더 이상 "invalid id"를 띄우지 않는지)은 전역 인증 미들웨어 때문에 이 환경(비대화형 curl, 로그인 세션 없음)에서는 원천적으로 재현·구분이 불가능함** — 이는 코드 결함이 아니라 이번 검증 방법의 한계이며, `.env` secrets를 읽어 세션을 위조하는 방식은 시도하지 않았음(권한 정책 준수).

### 사용자가 직접 확인해야 할 잔여 항목 (갤럭시 S25+ 크롬)

1. "추천" 탭 → "내 시나리오 만들기 +" 클릭 → `/recommend/build`로 이동하며 더 이상 "invalid id"가 뜨지 않는지(가장 핵심 재현 확인).
2. 방향/종목/분할/기간 입력 → 분석 요청 → AI 분석 결과(등급/EV/승률/RR 등)가 정상 표시되는지.
3. "수정하기" 버튼 클릭 시 입력 화면으로 돌아가며 기존 입력값이 유지되는지.
4. 결과 화면에서 등록(확정) 클릭 → 성공 토스트 → 자동으로 `/recommend`로 이동하는지, DB `signals` 테이블에 `scenario_source='user'`, `status='approved_pending_entry'` 행이 실제 생성되는지(실거래 진입은 별도 entry-watcher가 추후 담당하므로 이 시점엔 즉시 매수되지 않아야 정상).
5. 기존 정상 흐름 회귀 확인: "추천" 목록의 AI 추천 카드 클릭 → `/recommend/숫자` 상세 페이지가 여전히 정상 동작하는지(헤더·상세정보·승인 버튼).
6. 헤더 `←` 버튼이 두 화면(build/analysis) 모두에서 정상적으로 이전 화면(브라우저 히스토리)으로 돌아가는지.

## 최종 요약 (사용자용)

**원인**: "추천" 탭의 "내 시나리오 만들기 +" 버튼이 `/recommend/build`로 이동하는데, 그 페이지 파일 자체가 만들어진 적이 없었습니다. Next.js는 없는 정적 경로를 만나면 동적 경로(`/recommend/[id]`, 시그널 상세 페이지)로 대신 연결하는데, 이때 "build"라는 글자를 숫자 ID로 변환하려다 실패해서 "invalid id" 에러가 뜬 것입니다. 버튼을 누를 때마다 100% 재현되는 구조적 버그라 "빈번히 발생한다"는 말씀과 정확히 일치했습니다.

**수정**: 다행히 시나리오 입력 화면(`ScenarioBuilder`)과 분석 결과 화면(`ScenarioAnalysis`), 그리고 AI 분석·등록을 처리하는 백엔드 API 2개는 전부 예전에 이미 완성돼 있었고 서로 연결만 안 돼 있던 상태였습니다. 이번에 빠져 있던 연결 페이지(`/recommend/build`)를 새로 만들어 전체 흐름(입력 → AI 분석 → 결과 확인 → 등록)을 이어붙였습니다. 기존 "AI 추천 시그널 승인" 흐름(`/recommend/숫자`)은 건드리지 않았고 회귀도 없습니다.

**추가로 발견해서 같이 고친 문제**: `.gitignore`에 `build/`라는 규칙이 너무 넓게(경로 제한 없이) 걸려 있어서, 새로 만든 `recommend/build` 폴더가 git에서 아예 안 보이는 상태였습니다. 이 상태로 두면 다음 배포 때 서버가 "커밋 안 된 파일은 다 지운다"는 절차를 실행하면서 방금 고친 파일이 조용히 다시 사라지고 버그가 재발할 뻔했습니다 — reviewer가 이 위험을 실측으로 확인해줘서, `.gitignore` 규칙을 저장소 최상위 `build/` 폴더에만 적용되게(`/build/`) 좁혀서 같이 고쳤습니다.

**검증 상태**: developer 구현 → reviewer 6개 항목 감사(의도 충족·API 스키마 일치·안전장치 우회 없음·라우팅 우선순위·`.gitignore` 리스크) → QA 재검증까지 전부 코드 레벨에서는 결함 없이 통과했습니다(`npm run typecheck` 에러 0, `npm test` 80 suites/1161 tests 전부 통과, 실주문 경로 미접촉 확인). 다만 이 환경은 로그인 세션이 없는 자동화 도구라 브라우저 화면 자체는 못 눌러봤습니다 — QA 기록의 "사용자가 직접 확인해야 할 잔여 항목" 6가지를 실제 앱에서 확인해 주세요.

**아직 하지 않은 것 (사용자 확인 필요)**: 이 워킹 디렉토리는 pm2가 서빙 중인 실거래 운영 경로이고, 코드를 커밋·푸시하면 webhook이 즉시 자동 배포합니다. 화면 확인 전에 배포부터 되는 걸 막기 위해 **git add/commit/push는 하지 않고 여기서 멈췄습니다.** 또한 워킹트리에는 이번 작업과 무관한 T-015(청산엔진 비활성화) 관련 미커밋 변경도 같이 남아있으니, 커밋 시 이번 작업분(`src/app/recommend/build/page.tsx`, `.gitignore`)만 골라서 커밋해야 합니다. 화면에서 정상 동작 확인되면 말씀해 주세요 — 그때 커밋·배포 진행하겠습니다.

## 재확인 시도 기록 (2026-08-12)

커밋(`c0324d6`)·배포는 이미 완료된 상태(T-015와 함께 배포됨, RESUME.md 참조)라 남은 건 브라우저 실클릭 확인뿐. chrome-devtools MCP로 `http://localhost:3003/recommend/build`에 무인증 상태로 접근해 재확인을 시도했으나, **QA가 이미 기록한 것과 동일한 한계에 부딪혔다**: `middleware.ts`가 페이지 라우팅보다 먼저 가로채 `/login?next=%2Frecommend%2Fbuild`로 리다이렉트하므로, "invalid id"가 뜨던 예전 상태와 지금 상태가 무인증 요청 레벨에서는 똑같이 보인다(리다이렉트만 확인, 라우팅 수정 자체는 판별 불가). 로그인 자격증명 없이는 이 이상 진행할 방법이 없다 — 실거래 계정이라 자격증명을 대화로 주고받거나 위조 세션을 만드는 시도는 하지 않았다.
**결론**: 새로운 정보 없음(QA 진단을 독립적으로 재확인만 함). **§ "사용자가 직접 확인해야 할 잔여 항목" 6가지는 여전히 사용자 본인이 갤럭시에서 클릭해야 확인 가능.**

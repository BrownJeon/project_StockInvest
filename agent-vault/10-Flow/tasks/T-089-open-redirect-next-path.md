---
task_id: T-089
title: 웹 로그인 후 이동 경로(next) 오픈 리다이렉트 차단 — 탭·줄바꿈 우회와 이메일 로그인 화면의 같은 형태 검사
status: done
priority: high
project: StockInvest
created: 2026-10-25
updated: 2026-10-26
base_ref: dee03b2b06e615395b25820322dec795a423c7b4
risk_level: pending
roles_involved: [leader, judge, developer, reviewer, qa, deployer]
related_tasks: [T-088-app-google-login]
tags:
  - type/task
  - domain/auth
  - domain/security
aliases:
  - 오픈리다이렉트
  - next경로검사
waiting: []
demo_gate:
  required: false
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: ""
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-089 웹 로그인 `next` 오픈 리다이렉트 차단

## 목표

- **출처**: T-088 Dev-S 가 발견(10-25 23:35)하고 Leader 가 재현(23:38)한 **T-088 이전부터 있던 웹 결함**. 사용자에게 "별도 task 로 분리"를 권고했고 사용자가 "권고대로 작업 진행해줘"(10-25 23:49)로 수용했다.
- **결함**: `/로그인 후 이동 경로`(`next`)를 검사하는 코드가 **탭·줄바꿈 문자를 끼운 경로**를 통과시킨다. URL 해석기는 탭·줄바꿈을 지우므로 `/<TAB>/evil.com` 이 `//evil.com`(프로토콜 상대 URL)이 되어 **로그인을 마친 뒤 외부 사이트로 이동**한다.
- **영향 경로 2개**:
  1. 웹 Google 로그인: `GET /api/auth/google?next=%2F%09%2Fevil.com` → 서버 `sanitizeNextPath`(`src/lib/auth/oauth/config.ts:73`)가 통과 → 콜백 `callback/route.ts:269` 가 `NextResponse.redirect(new URL(경로, base))` 로 외부로 보냄. **[확실]** (Leader 가 node 로 재현: `new URL('/\t/evil.com', base).href === 'https://evil.com/'`)
  2. 이메일 로그인 화면: `src/app/login/page.tsx:48`(`setNextPath`)·`:76`(`dest`)의 `n.startsWith('/') && !n.startsWith('//')` 가 같은 형태라 `/login?next=/%09/evil.com` 로 열고 로그인하면 `window.location.replace('/\t/evil.com')` 이 외부로 감. **[가능성 높음]** (같은 URL 표준 해석 — 브라우저에서는 실행하지 않음)
- **왜 중요한가(수익 제1원칙 연결)**: 이 앱은 실매매 계정을 쥔 단일 소유자 로그인이다. 소유자가 만들어진 링크를 눌러 로그인하면 외부의 가짜 "다시 로그인" 화면으로 보내져 자격증명을 빼앗길 수 있다. 공격에는 소유자가 링크를 눌러야 하므로 확률은 낮지만 수정 비용도 작다(파일 3개).

## Leader 기본 방침

1. **정상 동작은 한 글자도 바꾸지 않는다.** 정상 경로(`/`, `/orders`, `/profile`), 쿼리(`?a=b`), 해시(`#x`)는 **원본 문자열 그대로** 통과해야 한다(정규화·치환 금지). 거부된 경우의 결과만 바뀐다(서버: `/`, 이메일 로그인 화면: `undefined`/`/`).
2. **한 곳에서 판정한다.** 의존성 없는 순수 함수 하나(`src/lib/safe-next-path.ts`, 새 파일 — 서버·화면 모두 import 가능해야 하므로 `process.env`·서버 전용 모듈 import 금지)를 만들고, 서버 `sanitizeNextPath` 는 그 함수에 위임, 화면의 로컬 검사 두 줄도 그 함수로 바꾼다.
3. **눈에 보이는 변화 없음** → 데모 게이트 불필요(judge 접수 `demo=none`). 화면 파일(`login/page.tsx`)의 변경은 검사 두 줄뿐이다.
4. **T-088 과 `login/page.tsx` 가 겹친다.** T-088 은 같은 파일의 화면을 다시 쓰는 중이고(미커밋·격리 worktree `mobile-app-auth-t088`), T-088 의 Dev-UI 는 이 두 줄의 `next` 검사 로직을 건드리지 않도록 지시했다. **병합 순서**: 두 브랜치 모두 로컬 커밋까지만 하고 사용자 승인 뒤 main 에 합친다. 나중에 합치는 쪽이 이 파일을 rebase 한다(줄 단위 충돌은 이 두 줄뿐이어야 한다).
5. **push(=운영 배포)는 사용자 승인을 따로 받는다.** 이 task 는 로컬 커밋까지.

## 관련 과거 이력 요약

- [[T-088-app-google-login]]: T-088 은 앱 흐름용으로 URL 파서 기반 `sanitizeAppNextPath`(`src/lib/auth/oauth/app-flow.ts`, 제어문자·공백·백슬래시·U+2028 거부, `/login`·`/signup`·`/oauth/*`·`/api/*` 는 `/` 로)를 새로 만들었다 — 앱 흐름은 이 결함이 없다. **T-088 이 main 에 들어간 뒤 두 함수를 합칠지는 별도 정리 후보**(이번엔 합치지 않는다: T-088 미병합, 앱 쪽 매핑 규칙이 웹과 다름).
- [[T-009-oauth-login]]: 소셜 로그인 `next` 처리를 도입하며 `//` 와 `/\` 만 막았다(코드 주석 `config.ts:66-70`) — 이 결함의 출처.
- `/이슈기록 관련`(로그인·리다이렉트·인증·next): **승인된 교훈 0건**(2026-10-25).

## 설계

**새 파일** `src/lib/safe-next-path.ts` — `export function sanitizeInternalPath(raw: unknown): string | null`

통과 조건(모두 만족해야 `raw` 를 그대로 반환, 아니면 `null`):
1. `typeof raw === 'string'` 이고 길이 ≤ 2048.
2. 첫 글자가 `/`.
3. 두 번째 글자가 `/` 도 `\` 도 아니다(프로토콜 상대·역슬래시).
4. **제어문자(U+0000–U+001F)·DEL(U+007F)·역슬래시(어느 위치든)·줄 구분 문자(U+2028·U+2029)가 없다** — 탭(U+0009)·LF(U+000A)·CR(U+000D)는 URL 해석기가 지워서 `//` 를 만들 수 있는 핵심 우회 문자다.
5. 마지막 확인: `new URL(raw, 'http://x.invalid')` 의 `origin` 이 `http://x.invalid` 와 같다(파서가 다르게 해석해도 같은 출처만 허용). URL 생성이 던지면 `null`.

**수정 파일**
- `src/lib/auth/oauth/config.ts` — `sanitizeNextPath(raw)` 를 `sanitizeInternalPath(raw) ?? '/'` 로(시그니처·반환 타입 불변). 주석의 "`//`·`/\` 만 막는다" 설명을 새 규칙으로 갱신. **안전 경로**(`^src/lib/auth/oauth/`) — Reviewer 판정 필요, scope 에 이 파일 명시.
- `src/app/login/page.tsx` — 48행 `setNextPath(...)`·76행 `dest` 계산 두 줄만 `sanitizeInternalPath` 를 쓰도록(`null` 이면 각각 `undefined`·`'/'`). 나머지 화면 코드·문구·스타일은 손대지 않는다.
- (`state.ts`·`pending.ts`·`[provider]/route.ts` 는 `sanitizeNextPath` 를 부르기만 하므로 수정 불필요 — Developer 가 확인해 보고.)

**시험**
- 신규 `src/__tests__/safe-next-path.test.ts`(또는 프로젝트 관례 위치): 표 기반.
  - **통과해야 함(원본 그대로)**: `/`, `/orders`, `/profile`, `/a/b?x=1&y=2#h`, `/search?q=%EC%82%BC%EC%84%B1`, 쿼리에 `//` 가 든 `/a?u=//x`(경로가 아니라 쿼리 — 통과), 인코딩된 `/%09/evil.com`·`/%2F%2Fevil.com`(경로 문자일 뿐 같은 출처).
  - **거부(null)**: `//evil.com`, `///evil.com`, `/\evil.com`, `/\\evil.com`, `/\t/evil.com`, `/\n/evil.com`, `/\r/evil.com`, `/\x00/evil.com`, `/\x1f/x`, `/\x7f/x`, `/a\b`, `/ /x`, `https://evil.com`, `javascript:alert(1)`, `evil.com`, `''`, `null`, `undefined`, `123`, 길이 2049 이상.
  - **불변식**: 통과한 모든 값에 대해 `new URL(값, base).origin === base`. 거부 벡터 전부 `null`.
  - 모듈에 `import`·`process.env`·`@/` 참조가 없음(순수·의존성 없음)을 소스 검사로 고정.
- `sanitizeNextPath` 기존 시험은 **그대로 통과**(삭제·약화 금지), 탭·개행 벡터 시험 추가.
- `login/page.tsx` 는 렌더 시험 관례가 있으면 그 범위에서, 없으면 순수 함수 시험으로 갈음(보고).

**검증**: typecheck · 전체 jest(기준선과 비교) · `next build`(별도 사본) · 변이 시험 2~3종(예: 제어문자 검사 제거·원본 대신 정규화 반환·두 번째 글자 검사 제거 → 해당 시험이 실패해야 함, 매번 원복).

**위험·불확실**: ① 정상 `next` 중 공백·한글이 든 경로가 거부되지 않는지(위 시험 케이스로 고정) ② `new URL` 이 구형 WebView 에서 다르게 동작할 가능성 — 5번은 2차 방어일 뿐이라 4번까지로도 우회는 막힌다 [추측] ③ 서버가 아닌 곳(미들웨어가 `/login?next=` 를 만들 때)은 입력이 요청 경로 자체라 이번 범위 밖 — Developer 가 `src/middleware.ts` 의 `next` 생성부를 읽기만 해 보고(수정 금지, 안전 경로).

## 역할별 지시사항

- Developer(Opus, judge 접수): 위 설계대로 구현. worktree `/home/brownjeon/.node-local/stockinvest-next-t089`(브랜치 `open-redirect-t089`, base `dee03b2`), `npm ci` 먼저. 커밋·push 금지(Leader 가 Reviewer 판정 뒤).
- Reviewer: 안전 경로 `src/lib/auth/oauth/config.ts` — 판정 줄 scope 에 명시. 우회 벡터 독자 탐색(유니코드 정규화·이중 인코딩·`\` 변형·URL 해석기 차이)과 정상 경로 거부(오탐) 확인.
- QA: 정상 경로·거부 벡터를 실제 라우트(`/api/auth/google?next=…` 의 302 `state` 쿠키·`Location`)와 로그인 화면(`/login?next=…`)에서 실행 검증(로컬 서버, 더미 env). 시나리오 표 필수.

## 진행 기록

- 2026-10-25 23:52: Leader 착수. 번호 T-089(T-088 까지 사용 중, `ls tasks` 로 확인). main `dee03b2`(origin 대비 문서 전용 로컬 1커밋). 격리 worktree `~/.node-local/stockinvest-next-t089`(브랜치 `open-redirect-t089`, base `dee03b2`) 생성. judge 접수 R2 / developer_model=opus / demo=none / next=assign, C1 `codex_required=false`(`CX-limit-unknown-r2`).
- 2026-10-26 00:03: Developer 완료 보고 수신 → Leader 독립 확인(`## Developer` 참조: 변경 범위·108건 통과·typecheck 0·벡터 직접 확인). Developer 의 "설계 불일치 결정 요청"(`/ /x`)은 설계 본문에 없는 줄을 전제한 오독으로 확인 — 공백 통과가 설계 의도(위험 ①).
- 2026-10-26 00:10: Reviewer 독립 감사 **PASS**(scope: `config.ts`·`safe-next-path.ts`·`login/page.tsx`·시험 2개, `## Reviewer` 마지막 줄이 훅 형식에 맞음 — Leader 가 소제목 0·대문자 판정 줄 1·`최종 판정` 줄 1 로 확인). 외부로 새는 우회 0건, 변이 9종 중 8종 검출(길이 상한 변경 1종은 시험이 상수를 참조해 생존 — 보안 무관, 낮음).
- 2026-10-26 00:12: judge C2 → `codex_required=true`(mode review) → `codex` 역할(Haiku) 기동. 검토 대상은 격리 worktree 의 미커밋 변경(task 사본을 worktree 에 둠 — 래퍼가 base_ref 를 읽고 커밋 훅이 판정을 읽는 데 필요, 커밋 때 다시 동기화). Codex 결과는 `## Codex 검토`, 채택·오탐 판정은 Reviewer.
- 2026-10-26 00:14: Codex C2 검토 완료 — `status=done`·**지적 0건**(차수 1/4, `base_source=task_file` — `HEAD_fallback` 아님). Leader 가 실행 기록을 직접 확인: 스냅샷 diff 가 3개 소스 파일(`login/page.tsx` +5/−2·`config.ts` +16/−…·`safe-next-path.ts` +62)과 시험 2개를 담고 있고 원본 출력(`raw.txt`)도 지적 0건. 한계: Codex 는 정적 검토만 했고 브라우저·구형 WebView·시험 재실행은 하지 않음. 첫 실행이 작업 폴더를 잘못 잡아 `not_a_git_repo` 로 Codex 시작 전에 끝났고 같은 차수 안에서 worktree 폴더에서 다시 실행(Codex 실제 호출은 1회). 지적 0건이라 Reviewer 의 채택·오탐 판정 대상 없음 — 기존 PASS 유지. → QA 기동.

## 판단 기록 (judge)

- [2026-10-25 23:52] intake engine=rules → risk=R2 / developer_model=opus / next=assign / demo=none | fallback=budget_window_closed. 입력 요약은 기능 수준(코드·비밀 없음). Leader 보강: `src/lib/auth/oauth/config.ts` 가 SAFETY_PATHS(`auth/oauth/`)라 R2 로 다룬다.
- [2026-10-25 23:52] codex_gate/C1 engine=rules → codex_required=false / mode=null / focus=null / budget_rule=CX-limit-unknown-r2 / codex_switch=on | overrides=없음 | fallback=budget_window_closed.
- [2026-10-26 00:12] codex_gate/C2(Reviewer PASS 직후) engine=rules → **codex_required=true** / mode=review / focus=none / budget_rule=CX-limit-unknown-r2 / codex_switch=on | overrides=없음 | fallback=budget_window_closed. 입력 요약은 기능 수준(코드·비밀 없음). → `codex` 역할 호출(차수 1/4), Codex 지적은 Reviewer 가 채택·오탐 판정.

## Developer

> Developer(Opus) 기록을 Leader 가 옮겨 적음. 시각은 Developer 가 `date` 로 확인한 값. worktree `~/.node-local/stockinvest-next-t089`(브랜치 `open-redirect-t089`, base `dee03b2`), **전부 미커밋**.

- [23:53] 착수 — `npm ci` 성공. 기준선 typecheck 0, jest 273 스위트·6864 시험(6735 통과·129 건너뜀·0 실패).
- [23:56] 결함 재현 — 변경 전 코드에서 `createOAuthState(…,'/\t/evil.com')` 의 next 가 `'/\t/evil.com'` 그대로 반환(새 시험 2건 실패).
- [00:00] 구현 — 신규 `src/lib/safe-next-path.ts`(`sanitizeInternalPath`, 설계 조건 1~5 그대로 + `MAX_NEXT_PATH_LENGTH` export), `src/lib/auth/oauth/config.ts` 의 `sanitizeNextPath` 를 `sanitizeInternalPath(raw) ?? '/'` 로 위임(시그니처 불변·주석 갱신), `src/app/login/page.tsx` import 1줄 + 48행·76행 두 줄(총 +3/−2). 시험: 신규 `src/lib/__tests__/safe-next-path.test.ts` 87건 + 기존 `src/lib/auth/__tests__/oauth-state.test.ts` 에 3건 추가(삭제·수정 0).
- [00:03] 검증(Developer 실행) — typecheck 0, jest 274 스위트·6954 시험(6825 통과·129 건너뜀·0 실패), 변이 14종+`config.ts` 1종 전부 검출(M3 둘째 글자·M4 출처 확인은 서로 중복되는 방어층이라 처음엔 살아남아 `URL` 생성자를 대체하는 시험 ③-b 4건을 추가해 검출 — 실제 브라우저 해석기 차이를 시험한 것은 아님), `next build` 별도 사본 exit 0, 빌드본 `next start` 로 `/api/auth/google?next=…` 6개 입력의 state 속 next 확인(`%2F%09%2Fevil.com`·`%2F%0A%2Fevil.com`·`%2F%2Fevil.com`·`%2F%5Cevil.com` → `/`, `%2Forders%3Fa%3D1` → `/orders?a=1`, `%2Fa%3Fu%3D%2F%2Fx` → `/a?u=//x`). 린트: 저장소에 ESLint 설정이 없어 미실행. 커밋·push 없음.
- **Developer 가 올린 "설계 불일치 결정 요청"(`/ /x` 가 설계 표의 거부 목록에 있다)**: Leader 가 설계 문서를 grep 으로 확인한 결과 **그런 줄은 없다** — 거부 목록에 공백 경로가 없고, 위험 ① 은 오히려 "공백·한글이 든 정상 경로가 거부되지 않는지"를 요구한다. 따라서 **공백은 통과가 설계 의도이며 구현이 맞다**(`new URL('/ /x', base)` → `…/%20/x`, 같은 출처). 결정할 것 없음. Developer 의 [추측](T-088 `sanitizeAppNextPath` 의 공백 거부 습관이 섞였다)은 설계 본문과 대조해 보면 기록의 오독이다.
- **Leader 독립 확인(00:04~00:06)**: ⓐ `git status`·`git diff`: 변경은 `login/page.tsx`(import + 두 줄)·`config.ts`·`oauth-state.test.ts` + 신규 2개뿐, `login/page.tsx` diff 는 보고와 일치 ⓑ 신규 시험 + `oauth-state` 시험 2개 스위트 **108건 통과**, `npm run typecheck` rc 0 ⓒ 소스를 node 로 돌려 벡터 직접 확인 — `/\t/evil.com`·`/\n/…`·`/\r/…`·`//evil.com`·`/\evil.com`·`https://evil.com` 거부, `/orders?a=1`·`/a?u=//x`·`/%09/evil.com`·`/..//evil.com`·`/ /x`·`/a b` 통과 ⓓ `src/lib/safe-next-path.ts` 전문을 읽음(의존성 없음, 설계 조건 1~5 와 일치).
- Developer 가 읽기만 해서 알게 된 것: `state.ts`(47·97행)·`pending.ts`(64·98행)·`[provider]/route.ts`(50행)는 `sanitizeNextPath` 를 부르기만 함(수정 불필요) · 외부로 새던 지점은 `callback/route.ts` 의 `internalUrl()` → `new URL(path, base)` → `NextResponse.redirect`(36·175행) · **`oauth-complete/route.ts:137`(pending.nextPath → `{next}`)와 `oauth/invite/page.tsx:87`(`window.location.replace`) 경로도 이번 수정으로 같이 막힘** · `middleware.ts:130-133` 은 `/login?next=${pathname}${search}` 를 만들며 입력이 요청 경로 자체라 `//evil.com/x` 같은 요청이면 `next=//evil.com/x` 가 그대로 실리나 **로그인 화면의 검사가 거부**하므로 이번 범위에서 충분 · 옛 화면 검사는 `/\evil.com` 도 통과시켰으므로(서버는 막았으나 화면은 아님) 두 번째 우회로까지 막힘 [가능성 높음, 브라우저 미실행].
- 훅 SAFETY_PATHS 대조: 안전 경로에 걸리는 변경은 `src/lib/auth/oauth/config.ts` 하나. Reviewer 판정 줄 scope 에는 `src/lib/auth/oauth/config.ts` 를 넣고 실제 검토 범위인 `src/lib/safe-next-path.ts`·`src/app/login/page.tsx` 도 같이 적는다.
- 못 한 것: `login/page.tsx` 두 줄은 jest 로 닿지 않는다(저장소에 화면 렌더 시험 관례 없음, `testEnvironment: node`) → QA 의 `/login?next=…` 실행 검증이 필요.

## Reviewer

- [00:10] 감사 범위·방법 — worktree `~/.node-local/stockinvest-next-t089`(미커밋, base `dee03b2`)의 `git status`·`git diff` 와 `safe-next-path.ts` 전문, `config.ts`·`login/page.tsx` diff, 시험 2개 전문, `callback/route.ts`·`[provider]/route.ts`·`middleware.ts`·`state.ts`·`pending.ts`·`oauth-complete`·`oauth/invite/page.tsx` 를 직접 읽었다. 코드는 고치지 않았고(변이 시험만 임시 적용 후 원복) 이 절 밖은 건드리지 않았다.
- [00:10] 의도 검증 — 결함 원인(탭·줄바꿈을 낀 `/\t/evil.com` 이 앞 두 글자 검사를 통과해 URL 해석기가 `//evil.com` 으로 읽는 것)이 서버 경로(`sanitizeNextPath` → 콜백 `NextResponse.redirect(new URL(경로, base))`)와 이메일 로그인 화면(`setNextPath`·`dest` → `window.location.replace`) 두 곳 모두에서 막힌다. `sanitizeInternalPath` 가 null 이 아닌 값을 돌려주는 길은 함수 끝의 `return raw` 하나뿐이고, 그 앞에 조건 1(문자열·길이)·2(첫 글자 `/`)·3(둘째 글자)·4(금지 문자 전수 루프)·5(출처 확인)가 직렬로 놓여 있다. 건너뛰는 분기·예외 통과 없음: `new URL` 이 던지면 `catch` 가 null 을 돌려 fail-closed 이고, 통과 시 입력을 원본 그대로 돌려준다(정규화 없음). 중복 방어층(3·4·5)은 서로의 구멍이 되지 않는다.
- [00:10] 우회 벡터 독자 탐색 — `sanitizeInternalPath` 소스를 그대로 변환해 약 94.9만 개 후보를 던졌다: BMP 전체(U+0000~U+FFFF) 단일 문자를 12개 위치 템플릿(`/X/evil.com`·`/Xevil.com`·`/aX/evil.com`·`/X@evil.com`·쿼리·해시 안 등)에 넣고, 비BMP 표본·외톨이 서로게이트·위험 문자 58종의 2개 조합(탭·LF·CR·NUL·U+00AD·U+200B·BOM·U+2028·U+3000·전각 `／`·`＼`·`%09`·`%2f`·`%252F`·`%2e`·`@`·`:`·`..` 등 약 3,400쌍 × 10 템플릿). 통과한 93.7만 건 전부에 대해 ⓐ 반환값이 입력과 동일 ⓑ `new URL(값, base).origin === base`(base 4종, 퓨니코드 운영 주소·localhost·경로가 붙은 base 포함) ⓒ 구형 해석기 모사(탭·LF·CR 제거·앞뒤 C0/공백 제거·`\`→`/` 후 `//` 시작 또는 스킴 시작 여부)를 확인했고 **외부로 새는 사례 0건**. 이중 인코딩(`/%252F%252Fevil.com`)·`%2e%2e`·`/..//evil.com`·`/.//evil.com`·`/@evil.com`·`/:evil.com`·`/?@evil.com`·U+00AD/U+200B/U+2060/BOM 보이지 않는 문자·전각 슬래시는 모두 통과하되 같은 출처다. `NextResponse.redirect(new URL(값, 운영 base))` 를 15개 통과 값에 실제로 실행해 `Location` 이 전부 같은 호스트임을 확인했다(`/..//evil.com` 은 `https://<운영호스트>//evil.com` — 절대 URL 이라 호스트가 바뀌지 않고, Next 15.5.27 은 `//` 요청을 `normalizeRepeatedSlashes` 로 경로만 있는 `/evil.com` 308 로 돌린다(`base-server.js:532`, 코드 읽기) — 이 값은 옛 검사도 통과시켰고 `next` 없이 직접 요청해도 같은 동작이라 이번 결함이 아니다). NFKC 정규화는 호스트에만 적용되고 경로에는 적용되지 않는다 [가능성 높음 — WHATWG 해석 규칙, 브라우저 실행은 못 함].
- [00:10] 오탐(정상 경로 거부) — 통과: `/`·`/orders`·`/a/b?x=1&y=2#h`·`/search?q=%EC%82%BC%EC%84%B1`·`/한글/경로?q=삼성#해시`·`/a?u=//evil.com`·`/%09/evil.com`·`/a b/c d` 전부 원본 그대로, 길이 2048 통과·2049 거부. 거부되지만 정상일 수 있는 것은 날 것의 역슬래시(쿼리 안 포함)·2048 초과·제어문자뿐인데, 정상 `next` 는 미들웨어가 만든 `${pathname}${search}`(브라우저가 이미 `%20`·`%5C` 등으로 인코딩한 값)라 실사용에서 거의 닿지 않는다. 공백을 통과시킨 설계는 보안상 문제 없음: 경로 안 공백은 URL 해석기가 지우지 않고 `%20` 으로 바꾸며(실측 `/ /x` → `…/%20/x`), 맨 앞 공백은 첫 글자 `/` 검사로 불가능하고, 맨 뒤 공백은 해석기가 지워도 같은 경로다. 공백을 지우는 해석기는 알려진 것이 없다 [추측].
- [00:10] 호출부 완전성(`src/` 전체 grep) — `sanitizeNextPath` 호출은 `[provider]/route.ts:50`·`state.ts:47,97`·`pending.ts:64,98` 이고 전부 `config.ts` 한 함수를 거친다. `sanitizeInternalPath` 직접 호출은 `login/page.tsx:49,77` 뿐이다. 옛 로컬 검사(`startsWith('/')`·`startsWith('//')`)는 `src/` 에 더 없다. 사용자 입력이 들어가는 리다이렉트 지점은 이 둘이 전부: `window.location.replace`/`href=` 는 `login/page.tsx`(수정됨)·`oauth/invite/page.tsx:87`(서버가 sanitize 한 `data.next`, `pending.ts:98` 에서 한 번 더 거름)·`signup/page.tsx`·`ProfilePage.tsx`(고정 문자열)·`AppUpdateBanner.tsx:98`(서버 값을 `safeDownloadPath` 가 `/app/download/*.apk` 로 제한), `NextResponse.redirect` 는 `callback/route.ts`(고정 경로 + `stateCheck.nextPath`)·`[provider]/route.ts`(제공자 URL)·`middleware.ts:134`(`/login` 고정, `next` 는 `searchParams.set` 으로 인코딩), `next.config.js` 에 redirects 없음. 범위 밖 미조치 지점 없음.
- [00:10] 변경 범위 — `git diff --stat`: `login/page.tsx` +3/−2(import 1줄 + 48행·76행 두 줄, 문구·스타일·구조 변화 없음, 주석 한 줄 유지) · `config.ts` +10/−6(위임 + 주석, 시그니처 불변) · `oauth-state.test.ts` +29/−0(삭제·약화 0). 신규 2개(`safe-next-path.ts`, 시험). 설계 허용 범위(소스 3 + 시험) 이내. 훅 SAFETY_PATHS 에 걸리는 변경 파일은 `src/lib/auth/oauth/config.ts` 하나이고(`auth/oauth/` 접두), 나머지 4개는 걸리지 않는다.
- [00:10] 변이 시험(원본 백업 후 임시 적용, 매번 원복) — 9종: M1 제어문자 루프 제거 → 14건 실패 · M2 반환을 정규화 값(`pathname+search+hash`)으로 변경 → 8건 실패 · M3 탭만 허용 → 6건 실패 · M4 U+2028/2029 허용 → 6건 실패 · M6 옛 검사로 완전 되돌림(원래 결함) → 28건 실패 · M8 둘째 글자 검사와 출처 확인을 함께 제거 → 10건 실패 · M9 `catch` 에서 통과(fail-open) → 1건 실패 · `config.ts` 위임을 옛 로직으로 되돌림 → 5건 실패 — 전부 검출. **M5(길이 상한 2048→4096)는 살아남았다**: 시험이 상한 값을 `MAX_NEXT_PATH_LENGTH` 상수로 만들어 쓰고, 상수를 바꾸면 시험도 같이 움직이며 고정 5000자 시험은 4096 에서도 거부되기 때문이다(상한값 자체가 리터럴로 고정돼 있지 않음 — 보안 우회는 아님, 낮음). 원복 확인: `safe-next-path.ts`·`config.ts`·`login/page.tsx` 의 `sha256sum` 이 변이 전과 완전히 같고 `git status`·`git diff --stat` 도 변이 전과 같으며 `.tmp` 잔재 없음.
- [00:10] 직접 실행 — `npx jest safe-next-path oauth-state` 2개 스위트 108건 통과, `npm run typecheck` rc 0(로그는 파일 저장 후 확인), 전체 `npx jest` 270 스위트 통과·4 건너뜀(274 중)·시험 6954 중 6825 통과·129 건너뜀·0 실패(Developer 보고와 일치).
- [00:10] 한계 — `login/page.tsx` 의 두 줄은 jest 로 닿지 않는다(저장소에 화면 렌더 시험 관례 없음, 환경이 node). 실제 브라우저에서 `/login?next=/%09/evil.com` 이 `/` 로 가는지, 정상 `next` 가 로그인 후 그대로 이동하는지는 **실행하지 못했다** — QA 의 라우트·화면 실행 검증이 필요하다. 미들웨어가 `//evil.com/x` 요청에서 `next=//evil.com/x` 를 만드는 것은 시험 ⑥ 이 로그인 화면 검사의 거부까지 고정한다.
- [00:10] 후속 정리 후보(이번 판정 비차단, 낮음) — ① 시험에 길이 상한 리터럴 고정(`2048` 통과·`2049` 거부를 숫자로) ② 시험 안의 U+2028/2029 가 눈에 안 보이는 날 문자라 편집기에서 사라질 위험 — ` `·` ` 이스케이프로 바꾸기(`safe-next-path.test.ts` 68·69·205행, `oauth-state.test.ts` 103행) ③ `oauth/invite/page.tsx:87` 이 서버 값 `data.next` 를 클라이언트에서 재검사하지 않음 — 서버가 이미 두 번 거르므로 방어 중복 차원의 선택 사항 ④ T-088 병합 뒤 `sanitizeAppNextPath` 와의 통합(task 본문에 이미 별도 정리 후보로 기록됨).
- [00:10] **최종 판정: PASS (scope: src/lib/auth/oauth/config.ts, src/lib/safe-next-path.ts, src/app/login/page.tsx, src/lib/__tests__/safe-next-path.test.ts, src/lib/auth/__tests__/oauth-state.test.ts)**

## QA

- [00:26] 검증 환경 — worktree 현재 내용을 새 사본 `~/.node-local/stockinvest-next-t089-qa` 로 복사(`.git`·`.next`·`.env*` 제외, 소스 3개 sha256 이 worktree 와 일치 확인)해 `npm run build`(exit 0) → `next start -H 127.0.0.1 -p 31089`. 비교용으로 base `dee03b2` 를 `git archive` 한 `~/.node-local/stockinvest-next-t089-qa-base` 도 같은 env 로 빌드·기동(포트 31090). **env 는 `env -i` 로 비운 뒤 더미만**: `AUTH_SESSION_SECRET`·`GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`·`OAUTH_CALLBACK_BASE=http://127.0.0.1:<포트>`·`CRON_WATCHDOG_ENABLED=false`·`CRON_HEARTBEAT_FILE`(존재하지 않는 QA 전용 경로)·`DB_HOST=127.0.0.1`/`DB_PORT=1`·`DB_USER|DB_PWD|DB_NAME`(더미). 텔레그램·운영 자격증명 없음, 운영 `.env`·운영 DB·하트비트 파일은 읽지도 쓰지도 않음. 두 서버 모두 첫 기동부터 이 env 였고(`[cron-watchdog] CRON_WATCHDOG_ENABLED=false` 로그 확인) 00:18~00:24 약 6분 떠 있다가 종료, 두 포트 해제 확인. 텔레그램 폴러는 30초 뒤 DB 플래그를 한 번 읽으려다 `ECONNREFUSED 127.0.0.1:1` 로 끝났고 텔레그램으로는 아무 요청도 가지 않음. 서버 로그·결과 출력에 더미 비밀 값 누출 0건.
- [00:26] A 서버 `GET /api/auth/google?next=…`(리다이렉트 안 따라감, 307 `Location` 의 서명 state payload 디코딩) — **32건 중 32건 통과.** 거부(`r`=`/`): 탭·LF·CR·`//`·`/\`·`https://evil.com`·`javascript:`·NUL·길이 2049 전부 `/`, 추가 벡터(U+2028·U+2029·탭 2개·맨 앞 탭+`//`·CRLF·`///`·`/\\`·경로 중간 `\`·`evil.com`·빈 값·DEL·맨 앞 공백+`//`·`next` 두 번 첫째 악성) 전부 `/`. 원본 유지: `/orders?a=1`·`/profile`·`/한글 경로?q=삼성#h`·`/a?u=//x`·길이 정확히 2048·`/a b/c d`·`/%09/evil.com`(문자 그대로)·`/..//evil.com`·`next` 두 번 첫째 정상(`/orders`) 모두 원본 그대로, `next` 없음 → `/`. 모든 응답의 `r` 을 콜백과 같은 방식(`new URL(r, OAUTH_CALLBACK_BASE)`)으로 해석한 호스트가 전부 `127.0.0.1:31089`(외부 호스트 0). Set-Cookie 는 `si_oauth_state`(HttpOnly·SameSite=lax·Max-Age=600·Path=/), payload 키는 `n,p,r,exp`. **양성 대조: base 서버에서 같은 32건 → 12건 실패, 탭·LF·CR·탭2개·CRLF·`next` 두 번 첫째 악성의 6건은 `r` 이 `/<탭>/evil.com` 그대로 남고 콜백 해석 호스트가 `evil.com`** — 이 시험이 결함을 실제로 잡는다는 증거.
- [00:26] B `GET /api/auth/oauth-providers` → 200 `{"ok":true,"providers":["google"]}`(`cache-control: no-store`) · `/login` 200 · `/login?next=%2F%09%2Fevil.com` 200 — 통과. `/login` SSR HTML 을 base 와 비교: 빌드 해시·buildId·웹팩 모듈 번호만 다르고 `<script>`·주석을 뺀 DOM 은 3,279자 완전 동일.
- [00:26] C 이메일 로그인 이동(Playwright 1.58.2 + Chrome 147.0.7727.101 헤드리스, 412×915·360×800, DSF 2, isMobile·hasTouch, ko-KR, Asia/Seoul, 다크, reducedMotion, 서비스워커 차단, 폰트 로딩 대기; `POST /api/auth/login` 은 `{"ok":true}` 로 가로채고 이동 요청은 로컬 stub 페이지로 받음, 127.0.0.1 밖 요청은 전부 중단·기록 + Chrome `--host-resolver-rules` 로 DNS 도 차단) — **16건×2뷰포트=32건 중 32건 통과, 외부 이동 시도 0건.** 거부 6건(탭·LF·CR·`//`·`/\`·`https://evil.com`)과 추가 거부 4건(U+2028·NUL·`/a\b`·탭+LF)은 최종 URL 이 전부 `/`, 원본 유지 7건은 `/orders?a=1`·`/profile`·한글 경로(`/%ED%95%9C%EA%B8%80%20%EA%B2%BD%EB%A1%9C?q=%EC%82%BC%EC%84%B1#h`)·`/%09/evil.com`·`/a?u=//x`·`/..//evil.com`(같은 호스트의 `//evil.com` 경로) 로 정확히 이동. **양성 대조: base 서버에서 탭·LF·CR·`/\`·탭+LF 5건이 실제 브라우저에서 `GET http://evil.com/` 을 시도**(뷰포트별 5건, 총 10건 — 중단시켰음)하고 U+2028·NUL·`\` 는 `/%E2%80%A8/evil.com` 등으로 갔다 — 변경 전 결함을 브라우저에서 재현.
- [00:26] D Google 버튼(실제 로컬 서버 응답, 서버가 Google 로 보내는 `Location` 은 따라가지 않고 기록) — **5건×2뷰포트=10건 중 10건 통과.** `next=%2Forders%3Fa%3D1` → 시작 요청 `/api/auth/google?next=%2Forders%3Fa%3D1`·서버가 만든 state 의 `r`=`/orders?a=1`, 한글 경로 → `?next=%2F%ED%95%9C…%23h`·`r`=`/한글 경로?q=삼성#h`, 거부 값(`%2F%09%2Fevil.com`·`%2F%5Cevil.com`)과 `next` 없음 → **`next` 파라미터 없이** `/api/auth/google`·`r`=`/`. 브라우저가 accounts.google.com 으로 직접 요청한 건 0건. base 대조: 거부 값에서 `?next=%2F%09%2Fevil.com` 이 그대로 실려 갔다(옛 화면은 `/\evil.com` 도 통과).
- [00:26] E 시각 회귀 — `/login` 412·360px 전체 페이지 스크린샷을 크게 열어 확인: Google 버튼·구분선("또는 이메일로")·이메일/비밀번호 폼·로그인 버튼(빈 입력이라 비활성 톤)·회원가입 링크·세션 안내 문구 모두 평소 구성. 가로 넘침 0(`scrollWidth`==`innerWidth` 412·360), Google·로그인 버튼 높이 48px(터치 44px 이상), body 배경 `rgb(15,17,21)`·글자 `rgb(230,232,238)`. **base 와 스크린샷 파일이 바이트 단위로 동일**(412·360 둘 다 sha256 일치) — 눈에 보이는 변화 0. 허용 범위: 픽셀 동일만 PASS(차이 있으면 Reviewer 분류) — 캡처 범위 전체 페이지·caret 숨김·애니메이션 비활성.
- [00:26] F 시험 재실행 — `npx jest src/lib/__tests__/safe-next-path.test.ts src/lib/auth/__tests__/oauth-state.test.ts` 2개 스위트 108건 통과, `npm run typecheck` rc 0(로그 파일 저장 후 확인), `next build`(QA 사본) exit 0·린트·타입 검사 통과. 실행 후 worktree `git status`·소스 sha256 불변.
- [00:26] 못 한 것 — ① 실제 Google 동의·콜백 `NextResponse.redirect(new URL(경로, base))` 라우트 실행(Google 프로필 조회가 필요해 금지) → `r` 을 같은 방식으로 해석하는 파생 검사로만 갈음 ② 실제 로그인·세션 발급·DB(운영 DB 접근 금지, `/api/auth/login` 은 가로채기) ③ 1280px 데스크톱·라이트 모드(로그인 화면은 다크 단일 테마, 변경은 로직 두 줄이라 412·360 바이트 동일로 갈음) ④ 구형 Android WebView·실기기 ⑤ T-088(`login/page.tsx` 같은 파일 재작성) 병합 후 충돌·동작 ⑥ 주문·DRY_RUN·Kill Switch·한도 체크리스트는 이 변경이 주문·안전장치 경로를 건드리지 않아(인증 `oauth/config.ts` 한 파일만 안전 경로) 해당 없음.
- [00:26] 결함 0건, Critical 0건, 외부 이동 시도 0건(QA 사본 기준). 산출물 정리: 스크린샷·결과 json 6개 삭제.
- [00:26] **QA 판정: pass** (실행 82건 중 통과 82건, 못 한 것: 실제 Google 콜백 리다이렉트 라우트·실제 로그인/DB·1280px·라이트 모드·구형 WebView·T-088 병합 후 동작)

## 배포 기록

- **승인**: 사용자 "구글로그인 작업에 대하여 승인하니 작업진행해줘"(10-26 05:1x) — 직전 Leader 보고의 권고 계획(① T-089 push → ② DDL → ③ T-088 push → ④ APK)에 대한 승인으로 해석(해석·창 확인·배포 전 기준선은 [[T-088-app-google-login]] `## 배포 기록`).
- **push 05:21:41 KST** — main 을 fast-forward 로 `6d6efc0`(T-089) 위에 두고 `b6cd82f..6d6efc0`(문서 전용 `dee03b2` 동승, 메인 트리의 다른 세션 미커밋 변경은 vault 문서뿐이라 겹침 0). `git fetch` 가 오브젝트 전송 오류를 냈으나 `git ls-remote` 로 원격 `main`=`b6cd82f`(로컬이 아는 값)임을 확인했고 `git push --dry-run` 정상.
- **webhook 로그**: `START project_StockInvest sha=6d6efc0` → `RELEASE_RESULT {"status":"ok","release":"20261026-052150-6d6efc09","previous":"…20261025-232833-b6cd82fe","migrated":false}` → `END exit=0`(05:21:45~05:22:51 KST).
- **배포 후 확인(05:23)**: `stockinvest-cron` **정확히 1행** · `stockinvest`/`stockinvest-cron` 모두 새 릴리스 cwd·재시작 0 · `current`=새 릴리스 · `/api/health` 200 · **안전장치 스위치 배포 전후 diff 없음**(`system_config` 79키, `cred_*` 제외) · 감사 로그 최신 id 불변(`orders 3229 / trade_logs 8305 / signals 19409`).
- **운영 기능 확인(공개 도메인, nginx 경유, 05:24)**: `/api/auth/google?next=…` 의 서명 state 안 이동 경로 — `%2F%09%2Fevil.com`(탭)·`%2F%0A%2Fevil.com`(LF)·`%2F%2Fevil.com`(`//`)·`%2F%5Cevil.com`(`/\`) → 전부 **`r="/"`**, `%2Forders%3Fa%3D1` → `r="/orders?a=1"`, `%2Fa%3Fu%3D%2F%2Fx` → `r="/a?u=//x"`(원본 유지). `/login` 200·`/api/health` 200.
- **같은 배포에 함께 실린 작업**: 없음(문서 전용 커밋 `dee03b2` 만 동승 — T-087 원장 작업 일시 중지 기록).
- **미검증**: 실제 Google 로그인 완료 후 콜백 리다이렉트·이메일 로그인 화면의 브라우저 동작은 운영에서 실행하지 않음(QA 사본에서 확인).
- **롤백**: `scripts/deploy.sh StockInvest --rollback`(직전 릴리스 `20261025-232833-b6cd82fe`) 또는 `git revert 6d6efc0` 후 push — 사용자 지시 시에만.

## Codex 검토

### [2026-10-26 00:14] C2 review focus=none — done
- judge 판정: judge-result@2 codex_gate (codex_required=true, mode=review, focus=none, budget_rule=CX-limit-unknown-r2) / 호출 차수: 1/4
- 대상: repo=/home/brownjeon/.node-local/stockinvest-next-t089 base=dee03b2(task_file) snapshot=3d9d7c1
- 지적 0건
- 검토하지 못한 범위: 실제 브라우저·구형 Android WebView의 URL 해석 동작, 테스트·typecheck·빌드 재실행(읽기 전용 조건으로 미실행)
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261025T151336Z-T-089-C2/raw.txt

## 최종 요약

### [T-089] 로그인 후 이동 경로 오픈 리다이렉트 차단 — 조작된 링크로 로그인하면 외부 사이트로 보내지던 결함을 막음

- **상태**: ✅ 완료·운영 반영(10-26 05:21) — 구현·독립 감사·Codex·QA 후 사용자 승인("구글로그인 작업에 대하여 승인하니 작업진행해줘")으로 배포했고, 운영 공개 도메인에서 수정이 동작함을 확인했다. 이어서 T-088 의 사용자 실기기 검증("실기기에서 앱설치해서 로그인 검증완료했어", 10-26 06:03 이전)이 같은 로그인 화면(`login/page.tsx`)과 `/api/auth/google` 시작 경로를 거쳐 정상 동작했다. **이메일 로그인 후 이동은 사용자가 직접 확인했다는 기록이 없다**(QA 에서 실제 Chrome 으로 확인) — 아래 확인은 선택으로 둔다.
- **무엇이 바뀌었나**: 로그인 뒤 돌아갈 경로(`next`)에 탭·줄바꿈 같은 보이지 않는 문자를 끼워 만든 링크(`/login?next=/<탭>//evil.com`, `/api/auth/google?next=…`)로 로그인하면 외부 사이트로 이동하던 결함을 막았다. 이제 그런 값은 `/`(첫 화면)로 바뀐다. **화면에 보이는 변화는 없고**(412·360px 스크린샷이 변경 전과 바이트 단위로 같다), 정상 경로·쿼리·해시·한글·공백은 그대로 쓰인다. 웹 Google 로그인·이메일 로그인·초대 코드 가입 완료 화면의 이동이 모두 같은 검사를 거친다.
- **배포**: ✅ 운영 반영 — 커밋 `6d6efc0` · 2026-10-26 05:21:41 KST · push(webhook blue/green) · 결과 `ok`(릴리스 `20261026-052150-6d6efc09`). 배포 후 확인과 운영 기능 확인은 `## 배포 기록`.
  - 같은 배포에 함께 실린 작업: 없음. 문서 전용 커밋 `dee03b2`(T-087 원장 작업 일시 중지 기록)만 동승했다. [[T-088-app-google-login]] 은 이어서 05:25:51 에 따로 배포됐다.
  - **운영에서 확인한 것(05:24, 공개 도메인)**: 탭·줄바꿈·`//`·`/\` 를 낀 `next` 가 서명 state 안에서 모두 `/` 로 바뀌고, 정상 경로·쿼리·해시는 원본 그대로.
- **AI 가 검증한 것**:
  - 독립 감사(Reviewer): 우회 후보 약 95만 개를 던져 통과한 값 전부 같은 출처임을 확인, 실제 `NextResponse.redirect` 응답 15건도 같은 호스트, 호출부 grep 에 누락 없음, 변이 시험 9종 중 8종 검출(생존 1종은 길이 상한 값 변경 — 보안 무관).
  - Codex 외부 검토 C2: 지적 0건(정적 검토만, 브라우저·시험 재실행은 안 함).
  - QA 82건 실행 통과: 실제 서버·실제 Chrome 에서 **변경 전 서버는 `evil.com` 으로 가려는 요청을 10번 시도했고 수정본은 0번**(결함 재현 + 수정 확인). Google 시작 라우트의 state 속 이동 경로 32건, 이메일 로그인 화면 이동 32건, Google 버튼 `next` 전달 10건.
  - 전체 jest 6825 통과·0 실패(129 건너뜀은 DB 필요 시험), typecheck 0, `next build` 통과.
  - **검증 못 한 것**: 실제 Google 동의→콜백 리다이렉트 실행(Google 프로필 조회가 필요해 금지), 실제 로그인·세션 발급·DB, 구형 Android WebView·실기기, T-088 병합 뒤의 `login/page.tsx` 동작.
- **👉 사용자가 확인할 것**(선택): ① 운영 로그인 화면(stock.미라클펭귄.com/login)이 평소와 같게 보이는지 ② 이메일 로그인이 된 뒤 첫 화면으로 가는지 — 두 가지만 보면 된다. 어차피 T-088 의 실기기 확인(앱 Google 로그인)이 같은 로그인 화면을 거친다.
- **👉 사용자가 결정할 것**: 없음 — push 시점은 승인받아 T-088 보다 먼저 배포했다(권고대로). T-088 은 이 커밋 위로 rebase 해 05:25 에 배포됐다.
- **남은 일**(비차단 후속 후보): ① 시험 안의 눈에 안 보이는 U+2028/2029 날 문자를 이스케이프 표기로 ② 길이 상한 시험을 숫자 리터럴로 고정 ③ `oauth/invite/page.tsx:87` 의 클라이언트 재검사(선택 — 서버가 이미 두 번 거름) ④ T-088 이 main 에 들어간 뒤 `sanitizeAppNextPath` 와의 통합 정리.
- **이슈·위험**: 롤백은 `git revert 6d6efc0` 후 push. 정상인데 거부될 수 있는 값은 날 역슬래시·2048자 초과·제어문자뿐이며 미들웨어가 만드는 `next` 는 인코딩되어 있어 실사용에서는 거의 닿지 않는다. 구형 WebView 의 `new URL` 동작은 확인 못 했으나 제어문자 검사만으로 알려진 우회는 막힌다 [추측].

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-25 23:53 |

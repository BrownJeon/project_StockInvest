---
task_id: T-090
title: 커밋 훅 SAFETY_PATHS 에 인증 API 디렉토리(`^src/app/api/auth/`) 추가
status: done
priority: medium
project: StockInvest
created: 2026-10-26
updated: 2026-10-26
base_ref: 3cc7418b927ac6149f518942cab0f3693259cf36
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, deployer]
related_tasks: [T-088-app-google-login, T-075-safety-paths-extension, T-085-safety-paths-broker-ledger]
tags:
  - type/task
  - domain/safety
  - domain/auth
aliases:
  - 훅인증라우트감시
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

# T-090 커밋 훅 감시 경로에 `^src/app/api/auth/` 추가

## 목표

- **사용자 결정(10-26 07:2x, 원문 그대로)**: **"'^src/app/api/auth/ 추가 여부'에 대해서는 추가작업 진행해줘"** — 직전 Leader 보고의 결정 항목(2번: 커밋 훅 감시 경로에 `^src/app/api/auth/` 추가 여부, AI 권고 = 추가)에 대한 승인.
- **왜**: T-088 에서 세션을 발급하는 `src/app/api/auth/app-exchange/route.ts` 와 `src/app/api/auth/[provider]/**` 가 커밋 훅 `SAFETY_PATHS` 밖이라, 이 경로를 바꾸면 Reviewer 독립 감사 기록 없이도 커밋된다(T-088 감사에서는 감사자가 안전 경로에 준해 직접 봤지만 훅이 강제하지는 않았다 — Dev-S 발견 ③, R-S 후속 후보 1). 지금 목록에는 세션 발급 *로직*(`src/lib/auth/session*.ts`·`oauth/`)과 미들웨어는 있으나 *입구 라우트*(`login`·`signup`·`logout`·`oauth-*`·`app-exchange`·`[provider]`)는 빠져 있다.
- **범위**: `scripts/git-hooks/commit-msg` 의 `SAFETY_PATHS` 배열에 `'^src/app/api/auth/'` 1줄 + 항목별 근거 주석 / `scripts/test-git-hooks.sh` 에 새 경로 시나리오 / 프로젝트 `CLAUDE.md` 의 "훅 감시 밖" 주의 문구 갱신. **앱 런타임 코드는 바뀌지 않는다.**
- **범위 밖(건드리지 않는다)**: ① 미들웨어 공개 경로 시험(`src/__tests__/middleware-public-paths.test.ts`)의 SAFETY_PATHS 편입 — T-084 때부터 별개로 사용자 결정 대기 중인 항목이라 이번 승인에 포함되지 않았다 ② `src/app/api/profile/`(비밀번호 변경 등)·`src/app/login/` 화면 등 다른 경로 ③ 훅 로직·판정 규칙 자체.

## Leader 기본 방침

1. **디렉토리 전체로 넣는다**(`'^src/app/api/auth/'`) — 신규 라우트가 목록에서 새지 않게(`cron/`·`oauth/`·`strategies/`·`broker-ledger/` 와 같은 이유). 하위 `__tests__` 도 함께 매치된다(훅 문서의 "테스트 파일은 제외하지 않는다" 원칙).
2. **근거 주석을 같이 적는다**(`CLAUDE.md` 의 "목록을 고칠 때는 근거도 같이 적는다"): 기존 `T-0xx 추가 (날짜, 사용자 결정 …)` 블록 형식으로 `T-090 추가` 블록 — 넣는 이유·넣지 않은 것·알려진 영향.
3. **이 변경 자체가 훅의 대상이다**(`^scripts/git-hooks/`·`^scripts/test-git-hooks\.sh$` 가 목록에 있다) — 커밋하려면 **기존 훅**이 `## Reviewer` 마지막 판정 줄(scope 에 두 파일 포함)을 요구한다. 격리 worktree 에서 작업한다(훅 shim 이 **메인 트리의 원본**을 가리키므로 worktree 에서 고치는 동안은 현재 훅이 그대로 유지되고, main 에 ff 병합하는 순간 새 목록이 모든 커밋에 즉시 적용된다).
4. **과도 차단 점검**: 새로 감시 대상이 되는 파일은 현재 11개(`[provider]/callback/route.ts`·`[provider]/route.ts`·`app-exchange/route.ts`·`login/route.ts`·`logout/route.ts`·`oauth-complete/route.ts`·`oauth-pending/route.ts`·`oauth-providers/route.ts`·`signup-request/__tests__/route.test.ts`·`signup-request/route.ts`·`signup/route.ts`). `oauth-providers`(공개 GET, 버튼 목록)·`signup-request`(가입 요청 메일)처럼 위험이 낮은 것도 같이 걸리지만 디렉토리 단위 일관성이 이 저장소 방식이다 — Reviewer 가 과도 차단 여부를 판단한다.
5. **push(=운영 배포)는 사용자 승인을 따로 받는다** — 이 task 는 로컬 커밋과 main ff 병합(= 로컬 훅 활성화)까지.

## 관련 과거 이력 요약

- [[T-088-app-google-login]]: 세션 발급 라우트가 훅 밖이라는 점이 Dev-S 발견 ③·R-S 후속 후보 1 로 올라왔고, 사용자 결정 보류(AI 권고 = 추가)였다. 프로젝트 `CLAUDE.md` "모바일 앱" 절에 "⚠ 훅 `SAFETY_PATHS` 밖 — Reviewer 감사를 직접 요청" 주의가 임시로 적혀 있다(이 task 가 갱신).
- [[T-075-safety-paths-extension]]·[[T-085-safety-paths-broker-ledger]]: 같은 방식의 선례(사용자 결정 "권고대로 추가" → 근거 주석 + 시험).
- `/이슈기록 관련`(훅·감시·안전경로·커밋): 승인된 교훈 0건(2026-10-26).

## 설계

1. **`scripts/git-hooks/commit-msg`**: `SAFETY_PATHS` 의 `'^src/middleware\.ts$'` 근처(인증 관문 묶음)에 `'^src/app/api/auth/'` 한 줄 추가 + 배열 위 근거 주석 블록에 `T-090 추가 (2026-10-26, 사용자 결정 "…추가작업 진행해줘")` 항목(포함 이유: 세션 발급 입구 라우트가 훅 밖이었음·디렉토리 전체인 이유·새로 걸리는 파일 11개와 그중 위험이 낮은 것·넣지 않은 것).
2. **`scripts/test-git-hooks.sh`**: 기존 시나리오 표기·헬퍼 방식을 그대로 따라 최소 다음을 추가 — ① `src/app/api/auth/app-exchange/route.ts` 만 staged → Reviewer 기록 없으면 **차단** ② `src/app/api/auth/login/route.ts` 도 차단(디렉토리 전체) ③ Reviewer 판정 scope 가 그 파일을 포함하면 **통과** ④ scope 가 다른 경로면 **차단**(차용 방지) ⑤ `src/app/login/page.tsx`(화면)는 **통과**(과도 차단 아님) ⑥ 이웃 이름(`src/app/api/authx/…`·`src/app/api/auth-foo`)은 접두 `auth/` 가 아니므로 **통과**. 실 커밋 E2E 가 있는 구조면 그 흐름에도 1건.
3. **`CLAUDE.md`(프로젝트)**: "모바일 앱" 절의 "⚠ … 커밋 훅 `SAFETY_PATHS` 밖 …" 불릿을 "T-090 부터 훅이 감시한다"로 고친다. "커밋 안전장치" 절의 대분류 문장("인증 관문")은 이미 포함하므로 그대로.
4. **하지 않는 것**: 목록의 다른 항목 순서·내용 변경, 훅 판정 로직 변경, 다른 경로 추가.

## 역할별 지시사항

- Developer(Opus, judge 접수): worktree `/home/brownjeon/.node-local/stockinvest-hook-t090`(브랜치 `hook-auth-t090`, base `3cc7418`). 설계 그대로. 커밋·push 금지(Leader 가 Reviewer 판정 뒤).
- Reviewer: **안전장치 자신의 변경** — 판정 줄 scope 에 `scripts/git-hooks/commit-msg`·`scripts/test-git-hooks.sh` 필수. 정규식이 의도한 경로만 매치하는지(접두·대소문자·특수문자·`[provider]` 대괄호 경로)·기존 항목에 영향이 없는지·과도 차단·시험이 실제로 결함을 잡는지(변이).
- QA: `bash scripts/test-git-hooks.sh` 전 시나리오 + 일회용 임시 저장소에서 실 커밋 E2E(새 경로 차단·통과) 직접 실행.

## 진행 기록

- 2026-10-26 07:31: Leader 착수. 번호 T-090(T-089 까지 사용 중, `ls tasks`·보드로 확인). main `3cc7418`(origin 과 동기화). 격리 worktree `~/.node-local/stockinvest-hook-t090`(브랜치 `hook-auth-t090`, base `3cc7418`) 생성. judge 접수 R2 / developer_model=opus / demo=none / next=assign. 사용자 승인 원문은 위 `## 목표`.
- 2026-10-26 07:57~08:02: Reviewer(Sonnet) 조건부 통과 → Leader 가 조건을 반영(코드 로직·정규식·시나리오 무변경, **주석만**). ① 훅 근거 주석에서 `signup-request` 를 과도 차단 후보에서 분리 — 초대코드는 관리자 env 주소로만 나간다는 불변식(route.ts 머리 주석·시험이 고정)과 "가입 즉시 세션을 발급하는 signup 앞의 유일한 가입 제한"을 근거로 적고, 진짜 후보는 oauth-providers·logout·oauth-pending 3개로 정정 ② `oauth-pending` 을 "쿠키를 내려 주는 입구" 목록에서 제거(읽기 전용 GET, 세션 서명·쿠키 설정 호출 0건 — Leader 가 직접 grep 으로 확인) ③ 시험 스크립트 머리말 fixture 범위 `T-981~998` → `T-979~998`(새 fixture T-979·T-980 반영, 정리는 이미 FIXTURES 배열이 담당). 독립 확인(08:01): 훅 diff 삭제 줄 0·비주석 추가 줄은 `'^src/app/api/auth/'` 하나뿐·`bash -n` OK·로직 단계 사본 **113 통과 / 0 실패**·실행 뒤 worktree 변경 3파일뿐(HEAD `3cc7418`)·메인 훅 sha `8da31082…` 불변. 시험 스크립트는 기존 한 줄(머리말 주석)이 바뀌어 삭제 1줄이다(주석). 새 sha256 — 훅 `1c0f69ce…dcf38d`·시험 `933b1129…8314e`. Reviewer 의 LOW 항목 중 `t090-x` 분리(선택)는 하지 않았다 — 동작 변화가 없고 라벨 문구가 이미 "영구 제외 아님"이라 재감사를 부르지 않기 위해서다.

## 판단 기록 (judge)

- [2026-10-26 07:30] intake engine=rules → risk=R2 / developer_model=opus / next=assign / demo=none | fallback=budget_window_closed. 입력 요약은 기능 수준(코드·비밀 없음). Leader 보강: 훅 자신(`scripts/git-hooks/`)이 안전 경로라 R2 로 다룬다. C1(설계 직후 Codex 필요 여부)은 설계가 한 줄 추가 + 시험이라 접수 판정으로 갈음하고, C2 는 Reviewer pass 뒤에 받는다.
- [2026-10-26 08:05] codex_gate/C2 engine=rules → codex_required=true / mode=review / focus=none / budget_rule=CX-limit-unknown-r2 / codex_switch=on | overrides=CX-r2-post-review | fallback=budget_window_closed. 요약은 기능 수준(코드·diff·비밀 없음). 호출 차수 1/4, Codex 실행 결과는 아래 `## Codex 검토`(지적 1건 — Reviewer 가 오탐으로 판정).

## Developer

> Developer(Opus) 기록을 Leader 가 옮겨 적음(시각은 Developer 가 `date` 로 확인한 값). worktree `~/.node-local/stockinvest-hook-t090`(브랜치 `hook-auth-t090`, base `3cc7418`), **전부 미커밋·미push**, 메인 트리는 무변경(Leader 가 훅 sha256 `8da31082…` 와 `git status scripts/` 로 확인).

- [07:40] 구현 완료. 변경 3파일: `scripts/git-hooks/commit-msg`(`SAFETY_PATHS` 에 `'^src/app/api/auth/'` 1줄 — `'^src/middleware\.ts$'` 바로 아래(인증 관문 묶음) — + `T-090 추가` 근거 주석 23줄, **`-` 줄 0**), `scripts/test-git-hooks.sh`(+164, 삭제 0), `CLAUDE.md`("모바일 앱" 절 ⚠ 불릿 1줄). `bash -n` OK.
- [07:40] **새로 걸리는 추적 파일은 정확히 11개**(`git ls-files` 전수에 변경 전·후 훅 정규식을 적용해 대조 — 빠진 파일·다른 파일 영향 0). 정규식 매치표(훅과 같은 방식 `LC_ALL=C grep -aE`): `auth/` 하위(대괄호 `[provider]`·`__tests__`·신규 라우트) match, `authx/`·`auth-foo/`·`foo/…/auth/`·`src/app/login/page.tsx`·`profile/` nomatch, 기존 `src/lib/auth/oauth/` 항목 무영향.
- [07:40] 시험: **전체 스크립트는 돌리지 않고 로직 단계 사본(`# [E2E]` 앞까지)을 worktree 안에서 실행** — 끝의 `[E2E]` 단계는 실제 index 에 blob 을 올리고 실제 `git commit` 을 시도하며(설치된 shim 이 **메인 트리의 훅**을 실행), "실제 저장소를 건드리면 실행하지 말고 보고" 지침에 따름. 기준선 **93/0** → 변경 후 **113/0**(= 기존 93 그대로 + 새 로직 시나리오 16 + 임시 저장소 실 커밋 E2E 4). 변이 6종(필수 ①줄 삭제 15실패 ②`$` 종료 15실패 ③`^` 삭제 1실패(n1) + 추가 ④끝 `/` 삭제 2실패 ⑤`app-exchange/` 한정 8실패 ⑥평면 라우트만 3실패) 모두 시험이 잡았고 원복 sha 일치(훅 `20e61f505025…bb930`·시험 스크립트 `4dafd356…1e2f`).
- [07:40] 설계와 다른 점: 실 커밋 E2E 를 기존 `[E2E]`(설치된 메인 훅·실제 index) 가 아니라 **일회용 임시 저장소(`mktemp -d`) 방식**으로 추가(병합 전 가짜 실패와 실제 index 접촉 방지, `e2e_git` 이 `GIT_*` 환경변수를 비움). `t090-x`(범위 밖 `profile/password`·`middleware-public-paths.test.ts` 통과 고정)는 설계 외 추가("영구 제외 아님" 주석). **불확실**: `signup-request` 는 초대코드 보안 불변식이 있어 "위험 낮음" 단정이 어렵다 — 훅 주석은 중립적으로 "세션 발급과 거리가 먼 …도 함께 걸린다"로 적음, 과도 차단 여부는 Reviewer 판단. CLAUDE.md "T-090 부터 감시" 문구는 main ff 병합 뒤에야 사실이 된다.
- **Leader 독립 확인(07:42~07:44)**: ⓐ `git diff` — 훅 `-` 줄 0·비주석 `+` 줄은 `'^src/app/api/auth/'` 뿐(325행, `'^src/middleware\.ts$'` 와 `'^src/app/api/orders/'` 사이)·시험 스크립트 `-` 줄 0·`bash -n` OK ⓑ 메인 트리 훅 sha256 `8da31082…` 불변·`git status scripts/` 0 ⓒ Developer 가 잘라 둔 로직 단계 사본이 원본 스크립트의 `# [E2E]` 앞부분과 **동일**함을 `diff` 로 확인하고 **직접 재실행 → 113 통과·0 실패**, 실행 뒤 worktree 에 fixture 잔재 없음(변경 3파일뿐·HEAD `3cc7418`) ⓓ 훅에 추가된 근거 주석을 읽어 11개 파일 목록·"세션 발급과 거리가 먼 oauth-providers·logout·signup-request 도 걸림"·"넣지 않은 것" 서술이 설계·사실과 맞음을 확인.

## Reviewer

- [07:57] Reviewer(Sonnet) 독립 감사 착수 — 대상 worktree `~/.node-local/stockinvest-hook-t090`(브랜치 `hook-auth-t090`, base `3cc7418`, 미커밋 3파일). 이 기록이 가리키는 내용의 sha256: 훅 `20e61f505025…bb930`, 시험 스크립트 `4dafd356edf0…1e2f`(Developer 기록과 일치). Developer·Leader 주장은 아래처럼 전부 직접 재확인했다.
- [07:57] 확인 ① [확실] `git diff`: 훅 삭제 줄 0, 비주석 추가 줄 1개(`'^src/app/api/auth/'`, 325행 — 324행 `'^src/middleware\.ts$'` 와 326행 `'^src/app/api/orders/'` 사이), 주석 추가 23줄. 시험 스크립트 삭제 0·추가 164. 두 파일 `bash -n` 통과. 훅 로직(배열 외)은 한 글자도 안 바뀜.
- [07:57] 확인 ② [확실] `git ls-files` 1142개에 옛 목록(39항목)·새 목록(40항목)을 훅과 같은 방식(`LC_ALL=C grep -aE`, 항목을 `|` 로 결합)으로 각각 적용 → 옛 355개·새 366개, 차집합 정확히 11개(`[provider]/callback/route.ts`·`[provider]/route.ts`·`app-exchange`·`login`·`logout`·`oauth-complete`·`oauth-pending`·`oauth-providers`·`signup-request/__tests__/route.test.ts`·`signup-request/route.ts`·`signup`), 옛에만 있고 새에 없는 파일 0개. 디스크의 auth/ 아래 파일도 같은 11개(미추적 없음). 주석의 11개·"넣지 않은 것" 3건(`middleware-public-paths.test.ts`·`profile/`(kis/ 제외)·`login/`)은 실제 존재·서술과 일치.
- [07:57] 확인 ③ [확실] 정규식 경계 21경로: `authx/`·`auth-foo/`·슬래시 없는 `auth`·`foo/…/auth/`·`mockups/…/auth/`·`AUTH/`·`Auth/` 는 옛·새 모두 비매치, `auth/`·`auth/x`·`[provider]/callback`·`[provider]/__tests__`·`__tests__`·신규 `brand-new/` 는 새 목록만 매치. 이미 걸리던 `lib/auth/oauth/names.ts`·`profile/kis/` 판정은 옛·새 동일. scope 대조(`files_out_of_scope`)는 `case` 의 따옴표 리터럴 비교라 `[provider]` 대괄호가 glob 으로 풀리지 않고, 슬래시 없는 `src/app/api/auth` 는 어떤 파일도 열지 못한다(시험 a3 가 고정).
- [07:57] 시험 실행 [확실]: `# [E2E]` 앞(949행까지)을 잘라 만든 내 사본이 Developer 사본과 `diff` 동일 → worktree 안에서 실행해 113 통과·0 실패(t090 시나리오 20개 = 로직 16 + 임시 저장소 실 커밋 4, 기존 93 그대로). 실행 직후 worktree 는 변경 3파일뿐·HEAD `3cc7418`·sha 불변, 메인 트리 훅 sha `8da31082…` 불변·메인 `git status` 에 staged 0. 전체 스크립트(`# [E2E]` 포함)는 실제 index 접촉 때문에 실행하지 않았다.
- [07:57] 변이 검증 [확실] — 격리 복제본(`git clone --shared`, 스크래치패드)에서 훅 새 줄만 바꿔 같은 시험 사본 실행, 13종(평면 라우트만 2종 포함) 전부 시험이 잡음(실패 시나리오 수): 새 줄 삭제 15 · `$` 로 끝 고정 15 · `^` 제거 1(t090-n1) · 끝 `/` 제거 2(n1·g4) · `app-exchange/` 한정 8 · 한 단계 평면 라우트만 3(c1·c2·d1) · 폭 확대 `^src/app/api/` 6(t075-x·t075-n2·t090-n1·t090-x·t090-g4·u) · `(login|api/auth)` 3(e1·e3·g4) · `(auth|profile)` 1(t090-x) · 비앵커 `/api/auth/` 1(n1) · `auth[/-]` 1(n1) · middleware 시험 항목 추가 1(t090-x). 대조군(변경 없는 sed)은 "적용 안 됨"으로 감지돼 가짜 성공이 없고, 변이 중 시험이 못 잡은 것은 없다. 기준선 복제본도 113/0.
- [07:57] 판단 ① 과도 차단 — 디렉토리 전체 유지를 권고한다. [확실] 새로 걸리는 11개 중 세션을 발급하는 것(`signSession` 호출)은 login·signup·oauth-complete·`[provider]/callback`·app-exchange 5개이고, `[provider]/route.ts`(OAuth 시작)·oauth-pending·logout·oauth-providers·signup-request(+시험)는 발급하지 않는다. 그러나 `src/middleware.ts` PUBLIC_EXACT 가 auth/ 아래 라우트를 하나씩 전부 무인증 공개로 열고 있어 이 디렉토리는 통째로 로그인 전 공격면이다. 비용은 실측으로 작다: git log 상 auth/ 를 건드린 커밋이 84일(2026-08-03~10-26)간 5개뿐이고, 위험이 낮은 logout·oauth-providers·oauth-pending 3개(합 71행)는 생성 커밋 이후 수정 0회. 파일 한정으로 얻는 절감은 사실상 0 인 반면, 그 방식이 바로 T-090 의 발단(T-088 의 app-exchange 가 목록 밖)을 만들었고, 제외 규칙 자체가 우회 표면이 된다는 이 프로젝트 원칙(CLAUDE.md "테스트 파일은 제외하지 않는다")과도 어긋난다. 약점 하나는 알아 둘 것: [가능성 높음] 신규 *공개* 라우트는 middleware.ts(훅 대상) 편집을 동반해야 열리므로 "신규 라우트 누수 방지" 논거는 주석이 말하는 것보다 약하다(세션 보호 하의 신규 라우트·무인증이 아닌 세션 발급 라우트에는 여전히 유효). 결론은 디렉토리 유지.
- [07:57] 판단 ② signup-request [MEDIUM — 주석 오도] 이 두 파일은 과도 차단이 아니라 정당하게 걸린다. [확실] `signup-request/route.ts` 머리 주석의 보안 불변식 "초대코드는 `ADMIN_NOTIFY_EMAIL`(env) 로만 나간다"가 깨지면, `signup-gate.ts` 머리 주석대로 초대코드가 인터넷에 열린 vhost 의 유일한 가입 제한이라 누구나 `signup`(가입 즉시 세션 발급)을 통과한다. 수신자 불변식은 시험 `route.test.ts` 의 "수신자는 요청 본문에서 파생될 수 없다" 블록이, 응답 비누출은 같은 파일의 "초대코드는 응답에 실리지 않는다" 블록이 고정한다(08:09 정정 — 처음엔 한 블록으로 뭉뚱그려 적었다). 그런데 훅 주석(`알려진 영향(과도 차단 후보)`)은 signup-request 를 oauth-providers·logout 과 같은 줄에 "세션 발급과 거리가 먼" 후보로 나열하고, 바로 뒤에 "마찰이 반복 관측되면 재검토"를 달아 이 파일을 첫 완화 대상으로 이끈다. 이 주석은 이 프로젝트가 "목록을 고칠 때는 근거도 같이 적는다"고 정해 둔 바로 그 근거 기록이라 오도가 실제 위험이다. 수정 요구(주석만): signup-request 를 과도 차단 후보에서 빼고 위 불변식 한 줄을 적는다. 진짜 후보는 oauth-providers·logout·oauth-pending 3개.
- [07:57] 판단 ③ 주석 정확성 [LOW + 확인됨] 맞는 것: 사용자 결정 인용문이 task 이력서 `## 목표` 와 글자 단위로 일치(고정 문자열 검색 각 1건), 날짜 2026-10-26, "Dev-S 발견 ③"(T-088 이력서 244행)·"R-S 후속 후보 1"(285행)·"감사자를 직접 요청해 안전 경로에 준해 봤다"(285·400행) 일치, 파일 11개와 oauth-providers(무인증 GET, 이름 목록만)·logout(쿠키 제거) 서술 사실, 중복 방지 이유로 든 `cron/`·`oauth/`·`strategies/`·`broker-ledger/` 는 실제 디렉토리 항목. 틀린 것 하나: 주석이 oauth-pending 을 "쿠키를 실제로 내려 주는 입구" 묶음(login·signup·oauth-complete·oauth-pending·`[provider]`·app-exchange)에 넣었으나 `oauth-pending/route.ts` 는 읽기 전용 요약 GET 이고 `signSession`·`setSessionCookie` 호출이 0건이다(`[provider]/route.ts` 도 0건 — OAuth 시작이지 세션 발급이 아님). 수정 요구(주석만): 그 묶음을 "세션·인증 쿠키와 관련된 입구"처럼 정확히 하거나 oauth-pending 을 거리 먼 후보 쪽으로 옮긴다.
- [07:57] 판단 ④ `t090-x` 오독 위험 [LOW] 낮다. 시험 주석에 "별개 사용자 결정 대기 항목이라 영구 제외가 아니다 … 이 시나리오를 함께 고친다"가 명시돼 있고 훅 주석도 "이번 승인 범위 밖"으로 적었으며 t075·t085 의 이웃 경로 통과 시나리오와 같은 관행이다. 다만 한 시나리오가 별개의 결정 대기 두 건(`profile/password`·`middleware-public-paths.test.ts`)을 묶어 한쪽만 결정돼도 다른 쪽 단언을 같이 건드려야 한다. 권장(선택): 시나리오를 둘로 쪼개고 라벨에 "미결정"을 넣는다. 참고로 `profile/password` 는 현재 비밀번호 재확인으로 쿠키 탈취 시 계정 탈취를 막는 라우트(자체 주석 근거)인데 아직 훅 밖이다.
- [07:57] 판단 ⑤ CLAUDE.md [LOW] "T-090(2026-10-26)부터 훅이 감시한다"는 훅 변경과 같은 커밋이 main 에 들어가는 순간 참이 된다. CLAUDE.md 는 훅 대상이 아니라서 따로 먼저 커밋되면 훅 변경 전에 거짓이 된다 — 3파일을 한 커밋으로 묶을 것(권장). 같은 파일·다른 문서와의 모순은 없다(커밋 안전장치 절은 목록을 복제하지 않고 코드를 출처로 둬서 그대로 맞다). 낡아지는 곳: `agent-vault/00-Context/ACTIVE.md` 13행("사용자 결정 보류 … `^src/app/api/auth/` 추가 여부")은 병합 뒤 Leader 가 갱신해야 하고, 2026-10-26 일지의 "훅 감시 밖 주의"는 과거 기록이라 유지한다. 부수 관찰: 새 문구가 "로그인 화면은 UI 라 감시 밖"이라 적는데, 로그인 화면(`login/page.tsx`)이 T-089 오픈 리다이렉트 관문 `src/lib/safe-next-path.ts` 를 호출한다는 점은 아래 커버리지 관찰에 적었다.
- [07:57] 판단 ⑥ 부작용 [확실] 없음: 훅 로직 diff 0·옛 목록이 매치하던 355개가 새 목록에서도 전부 매치(옛에만 있는 것 0)·자기 보호 항목(`^scripts/git-hooks/`·install·test 스크립트)과 scope 매칭 코드 무변경·기존 93 시나리오 전부 통과·병합 시점에 메인 트리에 대기 중인 auth/ 변경 없음(메인 `git status` 는 vault 문서 3개와 T-090 task 파일뿐, staged 0). 시험 스크립트 머리 주석 13행은 fixture 범위를 "T-981~998"로 적어 새 fixture T-979·T-980 이 빠졌다 [LOW] — 강제 종료로 남은 `T-980-hooktest-t090-scoped.md` 는 auth/ 에 대한 유효 판정이라 차용 우회가 되므로(기존 fixture 와 같은 위험군) 범위를 "T-979~998"로 고치길 권장한다(주석만).
- [07:57] 절차 주의 [확실] — 훅은 `git rev-parse --show-toplevel` 을 루트로 삼아 `agent-vault/10-Flow/tasks/` 를 상대경로로 읽는다. worktree 에는 T-090 task 파일이 없고(메인 트리에서 미추적) 이 판정은 메인 트리 파일에 있다 → worktree 에서 `git commit` 하면 옛 훅이 "T-090-*.md 가 없습니다"로 차단한다. 해결 둘 중 하나: ⓐ task 파일을 worktree 에 복사한 뒤 커밋(디스크에만 두거나 함께 커밋) ⓑ 3파일을 메인 트리에 적용해 거기서 커밋. 어느 쪽이든 `--no-verify` 는 쓰지 않는다.
- [07:57] 커버리지 관찰 [INFO — T-090 범위 밖, 사용자 결정 후보이며 결함으로 세지 않음] auth/ 라우트가 부르는 로직 중 훅 밖에 남은 것: `src/lib/auth/signup-gate.ts`(초대코드 대조)·`src/lib/auth/signup-request.ts`(`currentInviteCode`)·`src/lib/mail/send.ts`(`sendAdminMail` 이 수신자 인자를 받지 않는다는 불변식의 구조적 보증)·`src/lib/safe-next-path.ts`(T-089 오픈 리다이렉트 단일 관문, 서버 `oauth/config.ts` 와 `login/page.tsx` 가 공유)·`src/app/api/profile/password/`·`src/__tests__/middleware-public-paths.test.ts`(T-084 때부터 결정 대기). 라우트는 이제 잠겼지만 라우트가 의존하는 불변식의 구현 쪽은 열려 있다.
- [07:57] 심각도 합계: critical 0 · high 0 · medium 1(판단 ② 주석 오도) · low 4(③ oauth-pending 서술·④ t090-x 묶음·⑤/⑥ 문서·주석 정리) · info 1. reviewer.md 의 기계적 기준만 보면 pass 이지만, 안전 목록의 근거 주석이 이후 완화 판단을 잘못 이끌 수 있어 아래 조건을 붙여 conditional pass 로 한다.
- [07:57] 조건(커밋 전, 훅 파일의 주석 줄만 수정) — 조건 1: 훅 T-090 블록에서 signup-request 를 `알려진 영향(과도 차단 후보)` 에서 분리하고 초대코드 불변식(관리자 env 주소로만 발송, 시험 고정)을 한 줄 적는다. 조건 2: oauth-pending 을 "쿠키를 실제로 내려 주는 입구" 묶음에서 빼거나 묶음 서술을 정확히 한다. 수정 뒤 확인: `git diff` 의 훅 삭제 줄 0·비주석 추가 줄은 `'^src/app/api/auth/'` 하나뿐이어야 하고, 로직 단계 사본이 113 통과·0 실패여야 한다. 그 범위를 넘어 정규식·시험 시나리오·훅 로직이 바뀌면 이 판정은 무효이며 재감사한다. 권장(조건 아님): 시험 머리 주석 fixture 범위 정정·t090-x 분리·3파일 단일 커밋·task 파일 worktree 복사·병합 뒤 ACTIVE.md 갱신.
- [08:09] 후속 재검증 시작(조건 반영 확인) — worktree 의 현재 sha256 을 전체 해시로 대조: 훅 `1c0f69ce45604488…bdcf38d`, 시험 스크립트 `933b1129e548f7c6…d4a8314e`(Leader 가 알린 값과 일치). 이 시점 HEAD `3cc7418`, 수정 추적 파일 3개(CLAUDE.md·훅·시험 스크립트)와 미추적 task 사본 1개, staged 0.
- [08:09] 재검증 ① 훅 [확실] — 07:57 에 내가 본 사본과 현재 파일을 `diff`: 바뀐 줄 전부가 `#` 주석 줄이고, 주석을 뺀 나머지 줄의 `diff` 가 비었으며 `SAFETY_PATHS` 배열 `diff` 도 비었다. base 대비 삭제 줄 0·비주석 추가 줄은 `'^src/app/api/auth/'` 하나뿐(주석 추가는 23 → 28줄), `bash -n` 통과. 정규식·시나리오·훅 로직은 바뀌지 않았다.
- [08:09] 재검증 ② 시험 스크립트·CLAUDE.md [확실] — 07:57 에 내가 본 사본(sha `4dafd356…`)과 현재 파일의 `diff` 는 13행 `T-981~998` → `T-979~998` 한 줄뿐(base 대비 삭제 1줄이 이 줄). `# [E2E]` 앞 949행까지 잘라 worktree 에서 재실행 → 113 통과·0 실패, 실행 뒤 수정 추적 3개 + 미추적 사본 1개·HEAD `3cc7418`·fixture 잔재 0·사본 sha 불변·메인 훅 sha `8da31082…` 불변. 전체 스크립트(`# [E2E]` 포함)는 이번에도 실행하지 않았다. CLAUDE.md 는 한 줄 교체 그대로다.
- [08:09] 재검증 ③ 새 주석의 사실 [확실] — (a) 조건 1: signup-request 가 과도 차단 후보에서 분리되고 불변식 문장이 들어갔으며 후보는 oauth-providers·logout·oauth-pending 3개다. oauth-pending 서술("읽기 전용 GET, 초대코드 화면 표시용 요약")은 코드·머리 주석과 일치(GNU grep 으로 `signSession`·`setSessionCookie` 0건 확인). (b) 조건 2: oauth-pending 이 "쿠키를 내려 주는 입구" 묶음에서 빠졌다. (c) "middleware.ts 가 auth/ 아래 라우트를 무인증으로 하나씩 열어 둔다": `PUBLIC_EXACT` 는 정확 일치 Set(77행 `has(pathname)`)이고 login·signup·signup-request·logout·oauth-providers·oauth-pending·oauth-complete·app-exchange 가 하나씩 들어 있으며 `[provider]`(google·github)와 callback 은 `OAUTH_PUBLIC_PATHS` 전개로 열려 있어 새로 걸리는 11개 파일 전부가 무인증 경로다. (d) 불변식 서술은 `signup-request/route.ts` 머리 주석("초대코드는 ADMIN_NOTIFY_EMAIL(env) 로만 나간다")과 일치하고 `route.test.ts` 두 블록이 고정한다. 다만 그 route 시험은 `sendAdminMail` 을 모킹해 env 수신자 구조를 흉내 낸 것이라 구조적 보증 자체(`lib/mail/send.ts`·`send.test.ts`)는 훅 밖에 남아 있다 — 앞의 커버리지 관찰(info)에 이미 적었고 이번 변경의 결함이 아니다.
- [08:09] 잔여 흠(비차단, 조건 대상 아님) — 주석이 `[provider]`(OAuth 시작·콜백)를 "그 로직을 불러 쿠키를 실제로 내려 주는 입구"로 묶는데 `[provider]/route.ts` 는 세션 로직을 부르지 않고 상태 쿠키만 설정한다(쿠키 설정 2곳, `signSession` 0건). 문장이 약간 느슨할 뿐 거짓은 아니다. 권장 항목(t090-x 분리·3파일 단일 커밋·병합 뒤 ACTIVE.md 갱신)은 그대로 남아 있다.
- [08:09] Codex C2 지적 1건 판정 = 오탐(래퍼 스냅샷의 부산물이며 변경 범위 위반이 아니다). 지적 요지는 "허용 3파일 밖에 128줄 task 이력서가 diff 에 있다". 확인 [확실]: ⓐ Codex 입력(`prompt.md`)이 검토 대상으로 준 것은 기준 `3cc7418` 과 스냅샷 커밋 `a1e9fed…` 의 diff 다. ⓑ 래퍼 `codex-review.sh` 149~157행은 `GIT_INDEX_FILE=<임시 index> git add -A` → `write-tree` → `commit-tree -p <base>` 로 스냅샷을 만들어 미추적 파일까지 쓸어 담는다. ⓒ 그 스냅샷의 `git diff --stat` 은 4파일(CLAUDE.md ±1, 훅 +29, 시험 +165/-1, task 이력서 +128)이고, 128줄은 worktree 사본의 현재 줄 수와 같다. ⓓ 실제 worktree 에서 그 파일은 미추적(`??`)이고 staged 0·HEAD `3cc7418` 이며, 스냅샷 커밋은 어떤 브랜치·ref 에도 없다(`git branch -a --contains` 0건, codex·snapshot ref 0건). 그래서 "네 번째 파일"은 실제 변경이나 커밋 후보가 아니라 임시 index 의 부산물이다. 허용 목록 갱신은 불필요하다. 지적의 취지(범위 통제)는 타당하나 대상이 아니다. Codex 가 낸 기능 결함은 0건이고 정규식·시험 구조에 대한 의견이 내 감사와 일치한다.
- [08:09] 커밋 절차에서 사본이 새어 들 위험 [확실: 구조, 가능성 높음: 발생 여부] — 훅은 막지 못한다(사본은 `agent-vault/` 문서라 SAFETY_PATHS 밖). 새는 경로는 `git add -A`·`git add .` 이고, `git commit -a` 는 미추적 파일을 올리지 않아 안전하다. 사본이 브랜치 커밋에 섞여 main 으로 ff 병합되면 메인 트리의 같은 경로는 미추적이라 "덮어쓰일 미추적 파일" 오류로 병합이 거부된다(fail-safe). 하지만 그때 강제로 지우거나 덮어쓰면 메인의 최신 task 기록이 낡은 사본으로 대체될 수 있다. 권고: `git add CLAUDE.md scripts/git-hooks/commit-msg scripts/test-git-hooks.sh` 처럼 3개 경로만 명시 stage 하고 `git diff --cached --name-only` 가 정확히 그 3줄인지 확인한 뒤 커밋한다. 또 훅은 worktree 사본을 읽으므로, 사본은 07:57 판정 줄(conditional pass, scope 두 파일 — 훅이 인정하는 형태)을 담은 채로도 통과하지만 정본과 어긋나지 않게 커밋 직전에 메인 파일을 다시 복사해 두길 권장한다. 이후 Codex 호출이 더 있으면 같은 부산물이 반복되므로 인계서에 "미추적 task 사본은 변경이 아님"을 한 줄 넣을 것.
- [08:09] 조건 해소 확인 요약: 조건 1(signup-request 분리·불변식 문장)·조건 2(oauth-pending 서술 정정) 모두 반영됐고, 주석 외 변경이 없으며(정규식·시나리오·훅 로직 불변), 시험 113 통과·0 실패, 새 결함 없음. 판정을 조건부에서 무조건 pass 로 올린다. 위 sha 의 내용에 대한 판정이며, 이후 주석 외 변경이 생기면 무효다.
- [08:09] **최종 판정: PASS (scope: scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh)**

## QA

- [08:16] QA(Haiku 역할 규약) 실행 검증 착수 — 앱 코드가 아니라 커밋 훅 변경이라 주문 안전장치 체크리스트(DRY_RUN·Kill Switch·주문 한도·심볼·감사 로그·레이트 리밋)는 해당 없음. 대신 훅의 실제 차단·통과 동작을 일회용 저장소에서 직접 실행했다. 증거 파일(스크래치패드, 휘발성): `/tmp/claude-1000/-home-brownjeon-NFS-homes-brownjeon-project/b8b8f031-34f7-4edc-8621-4a61edd4f906/scratchpad/t090qa/` 의 `scenarios.sh`·`result-new.txt`·`result-old.txt`·`logic-run.out`.
- [08:16] 항목 1 무결성 [확실, 직접 실행] — sha256 3개 전부 일치: 훅 `1c0f69ce…dcf38d`·시험 `933b1129…8314e`·CLAUDE.md `ee1abff8…caf8`. `bash -n` 두 스크립트 통과. `git diff --stat` 3파일(+195/-2). 훅 삭제 줄 0, 비주석 추가 줄은 `'^src/app/api/auth/'` 하나뿐(주석 28줄). 시험 스크립트 삭제 1줄은 머리 주석(`T-981~998` → `T-979~998`). `git diff --name-only` 는 3파일뿐, `src/**` 0건. 옛·새 목록 `diff` 는 그 한 줄뿐(39 → 40항목).
- [08:16] 항목 2 로직 시험 재현 [확실, 직접 실행] — `# [E2E]` 마커 앞(948행)까지 잘라 만든 사본을 worktree 안에서 실행: 113 통과 / 0 실패(기대와 일치). 사본에 실행 코드로 남은 `[E2E]` 단계 없음(주석 3곳뿐), 실제 index 를 건드리는 `read-tree`·`update-index` 는 `GIT_INDEX_FILE` 임시 index 한정. 전체 스크립트는 실행하지 않았다. 실행 직후 worktree: 수정 3파일 + 미추적 task 사본 1개뿐, HEAD `3cc7418`, staged 0, fixture(hooktest) 잔재 0, sha 3개 불변.
- [08:16] 항목 3 독립 실 커밋 시나리오 [확실, 직접 실행] — 내가 따로 설계한 51개 시나리오를 일회용 저장소(`git init`, 시나리오마다 새 저장소, `GIT_CONFIG_GLOBAL=/dev/null`·`GIT_LITERAL_PATHSPECS=1`·`GIT_*` 변수 비움, `--no-verify` 미사용)에서 실제 `git commit` 으로 실행. 저장소의 `core.hooksPath` 는 호출 흔적(rc)을 남기는 shim 디렉터리이고 shim 이 worktree 의 새 훅을 실행한다. 판정은 git 종료코드 + HEAD 이동 + 훅 호출 흔적(rc) + 출력 문구 4중 대조. 새 훅 51 OK / 0 이탈.
- [08:16] 항목 3 세부(새 훅) — (a) app-exchange·task ID 없음 → 차단·HEAD 불변 / (b) 없는 T-999 → 차단 / (c) T-501(scope `src/app/api/auth/`) → 통과·HEAD 이동·"Reviewer 감사 기록 확인" 문구 / (d) scope 가 `src/lib/safety/` 뿐(T-502) → 차단 / (e) `[provider]/callback/route.ts`·`oauth-pending/route.ts`·`signup-request/__tests__/route.test.ts` 판정 없이 → 각각 차단(대괄호 경로는 리터럴 pathspec 으로 stage, 디렉토리 scope 판정이 있으면 통과·다른 파일 하나만 scope 면 차단) / (f) `authx/foo.ts`·`auth-foo/bar.ts`·`docs/auth.md`·`src/app/login/page.tsx` 및 `Auth/`·`profile/password`·`middleware-public-paths.test.ts`·`foo/src/app/api/auth/`·`api/auth.ts` → 판정 없이도 통과(훅 호출은 되었고 안전 경로로 인식되지 않아 무음) / (g) auth 라우트 + `docs/x.md` → 차단, auth scope 판정 + docs → 통과, auth + `src/lib/safety/x.ts` + auth scope 판정만 → 차단, T-501+T-511 합집합 → 통과 / (h) 회귀 `src/lib/safety/x.ts`·`src/middleware.ts`·`src/lib/auth/oauth/names.ts` → 판정 없으면 차단, scope 일치 판정이면 통과, auth scope 판정을 safety 파일에 차용하면 차단.
- [08:16] 항목 3 추가 탐침(요청 밖, 새 훅 전부 기대대로) — auth 11개 전부 일괄 → 판정 없으면 차단·T-501 이면 통과 / 신규 `auth/brand-new/route.ts` → 차단 / auth 라우트 삭제(`git rm`)·밖으로 이동·밖에서 안으로 이동 → 차단(`--no-renames` 덕분) / 비ASCII 경로(`auth/한글/…`)·큰따옴표 파일명 → 차단 / HEAD 없는 첫 커밋 → 차단·T-501 이면 통과 / scope 끝 슬래시 없음(`src/app/api/auth`)·통과 판정 뒤 마지막 줄이 실패 판정·소문자 pass → 차단 / 정확히 그 파일 하나만 scope → 그 파일은 통과·다른 auth 파일은 차단 / CONDITIONAL 판정 → 통과 / task ID 가 `#` 주석 줄에만 있음·`refT-501`·4자리 `T-5011` → 차단.
- [08:16] 항목 3(i) 대조군 [확실, 직접 실행] — 옛 훅(`3cc7418:scripts/git-hooks/commit-msg`, sha `8da31082…` = 설치된 훅과 동일)을 같은 방식으로 연결해 같은 51개를 돌림: (a) app-exchange·task ID 없음이 **통과**(HEAD 이동, 출력 무음, 훅 호출 rc 0) = 변경 전 구멍이 실재했다. 새·옛 결과가 갈린 시나리오는 정확히 26개이고 전부 auth 라우트 관련(새 차단/옛 통과). 갈리지 않은 25개(이웃·문서·화면·이미 걸리던 경로의 회귀·safety 가 섞인 혼합)는 동일 — 새 줄이 만드는 차이는 의도한 범위뿐이다.
- [08:16] 항목 4 CLAUDE.md [확실] — `git diff CLAUDE.md` 는 불릿 1줄 교체뿐. `awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg` 결과에 `'^src/app/api/auth/'` 가 있다(awk 출력 24행 = 배열 23번째 항목, `^src/middleware\.ts$` 바로 아래). "로그인 화면(`src/app/login/`)은 감시 밖"은 시나리오 f4 가 증명. "커밋 안전장치" 절은 목록을 복제하지 않고 코드를 출처로 두므로 모순 없음. [관찰·문구] "세션을 발급하는 `src/app/api/auth/` 전체" 는 디렉토리 전체가 감시된다는 뜻으로는 맞지만, 그중 logout·oauth-providers·oauth-pending·signup-request·`[provider]/route.ts` 는 세션을 발급하지 않는다(훅 근거 주석은 이를 정확히 구분). 동작 영향 없음. 병합 전에는 이 문장이 거짓이므로 3파일 단일 커밋·ff 병합 순서가 지켜져야 한다.
- [08:16] 항목 4 다른 문서(모순 점검) [확실] — `docs/mobile-app-procedure.md` 66행 「커밋 훅」 행이 "2026-10-25 재확인: 38개"라고 적고 있으나 base 실측은 39개(병합 후 40개)라 이미 낡았다(T-090 이전부터의 드리프트, auth 라우트 언급은 없어 모순은 아님) [관찰]. `agent-vault/00-Context/ACTIVE.md` 13행 "사용자 결정 보류 … `^src/app/api/auth/` 추가 여부"는 병합 후 낡으므로 Leader 갱신 대상(Reviewer 도 지적). 둘 다 이번 변경 3파일의 결함이 아니다.
- [08:16] 항목 5 보안 [확실] — 변경 3파일 추가 줄에서 키·토큰·비밀번호·쿠키 값 패턴 grep: 실제 비밀 값 0건(걸린 2줄은 경로 이름 `profile/password` 뿐). 변경은 `src/**` 를 건드리지 않았고(`git diff --name-only` 3파일), 시험 스크립트의 새 git 변경 명령은 전부 일회용 저장소(`e2e_git -C $E2E_REPO`) 대상이며 `--no-verify` 도 없다.
- [08:16] 항목 6 부작용 [확실] — 메인 트리 훅 sha `8da31082…` 불변, 메인 `git status` 시작 전·후 동일(수정 3 vault 문서 + 미추적 T-090 task 파일, staged 0), `core.hooksPath`·설치된 shim 디렉터리(`~/.local/share/stockinvest-git-hooks/…`)의 목록·sha 불변, `install-git-hooks.sh` 미실행, worktree·메인 저장소에 commit·push·merge·stash·checkout·reset 없음, 메인 트리에 내가 만든 파일 없음(시작 시점 이후 갱신된 파일 0건). 내가 쓴 것은 스크래치패드와 이 task 의 `## QA` 섹션뿐.
- [08:16] 병합 전 실제 커밋 예행 [확실, 부가 확인] — 임시 index(스크래치패드, 객체 쓰기 없음)에 대기 중인 3파일만 올리고 메시지 `feat(T-090): …` 로 훅을 직접 호출: 옛 훅(지금 실제로 커밋을 가르는 훅)·새 훅 모두 "Reviewer 감사 기록 확인: T-090" rc 0. worktree 의 task 사본 sha 는 메인 파일과 같고 마지막 판정 줄의 scope 가 `scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh` 라 두 훅 파일을 덮는다(CLAUDE.md 는 안전 경로가 아님). 실제 커밋 때는 3경로만 명시 stage 하고 `git diff --cached --name-only` 가 그 3줄인지 확인할 것(Reviewer 권고와 동일).
- [08:16] 항목 7 병합 후 확인 제안(실행 금지, 계획만) — 병합 뒤 메인 트리에서 실제 index 를 쓰지 않고: 임시 index(`GIT_INDEX_FILE=$(mktemp)` + `git read-tree HEAD` + `git update-index --add --info-only --cacheinfo 100644,<임의 blob 해시>,src/app/api/auth/app-exchange/route.ts`)를 만들고 **설치된 shim**(`$(git config core.hooksPath)/commit-msg`)을 임의 메시지 파일과 함께 직접 호출해 rc 1 과 "커밋 차단" 문구가 나오는지만 본다(shim 이 메인 트리 원본을 `exec` 하므로 새 훅 도달 여부가 한 번에 확인된다). 같은 방식으로 `docs/x.md` 만 올리면 rc 0 이어야 한다.
- [08:16] 확인하지 못한 것 — ① 전체 `scripts/test-git-hooks.sh` 의 `# [E2E]` 단계(설치된 훅·실제 index 접촉, 지침상 미실행) ② 병합 후 실제 설치 shim 경유 동작(병합 전이라 shim 은 옛 훅을 부름 — 위 7번이 병합 직후 할 일) ③ 대소문자를 구분하지 않는 파일시스템(맥)에서의 `Auth/` 경로 — 훅 정규식은 대소문자 구분이라 `src/app/api/Auth/…` 로 stage 되면 통과한다 [추측: 리눅스 배포라 실영향 낮음, 미검증] ④ NFS `noexec` 경로에서 직접 실행한 훅(내 시험은 실행 가능한 스크래치패드의 shim 경유, 실제 설치도 같은 shim 방식).
- [08:16] 결함 요약 — 결함 0건(critical 0 · high 0 · medium 0 · low 0). 관찰 사항 3건은 결함으로 세지 않는다: ① CLAUDE.md "세션을 발급하는 … 전체" 문구 정밀도 ② `docs/mobile-app-procedure.md` 66행 항목 수(38개) 낡음 — 병합 후 40개 ③ 병합 후 ACTIVE.md 13행 갱신. 셋 다 이번 변경의 동작과 무관하고 통과를 막지 않는다.
- [08:16] ✅ 검증 통과 (결함 0건)

## 배포 기록

- **push·배포 완료(2026-10-26 09:02:57 KST, 사용자 승인 "푸시 진행해줘").** 로컬 커밋 `53509bd`(훅·시험·CLAUDE.md)를 08:18:42 worktree `hook-auth-t090` 에 만들고 08:18:50 main 에 fast-forward 병합했으며, 문서 커밋 `784151b` 와 함께 `3cc7418..784151b` 를 push 했다. webhook 결과: `RELEASE_RESULT ok`, 릴리스 `20261026-090312-784151b3`(직전 `20261026-070037-3cc7418b`), `migrated=false`, 09:03:04~09:04:16 KST(로그 시각은 UTC 표기 00:03~00:04).
- **장중 배포 주의(절차서 「장중 임의 배포는 사용자 합의 없이 하지 않는다」)**: 권고했던 장외 창(05:10~08:30·15:40~22:20)이 아니라 국내장 개장 직후(09:03)에 나갔다 — 사용자가 권고를 들은 뒤 "푸시 진행해줘" 로 지시해 합의로 보았고, 배포 직전 읽기 전용으로 확인했다: 킬스위치 ON(`safety_kill_switch=true`)·최근 3시간 주문 0건·배포 전 health 200·pm2 두 프로세스 online. 그래서 진행 중 주문·자동 매매에 닿을 위험이 없었다.
- **배포 후 점검(09:04 KST, 읽기 전용)**: pm2 `stockinvest`·`stockinvest-cron` 모두 online, cwd 가 새 릴리스 `20261026-090312-784151b3`, `stockinvest-cron` 정확히 1행, `/api/health` 200(`db:true`·`safetyStatus:green`·`killSwitch:true`·`dryRun:false` 불변), `system_config` 79개 키(`cred_*` 제외)가 배포 전 기준선과 동일, 감사 로그 최대 id(orders 3229·trade_logs 8305·signals 19409) 불변, 공개 도메인 `/login` 200·`/app/download/latest.apk` 200.
- **로컬 훅 활성화는 이미 끝났다**(push·배포와 무관): 설치된 shim 이 메인 트리의 훅 파일을 `exec` 하므로 병합 직후부터 이 서버의 모든 커밋에 새 목록이 적용된다. 08:19:01 임시 index 로 확인 — `src/app/api/auth/app-exchange/route.ts`·`src/app/api/auth/[provider]/callback/route.ts` 는 판정 없이 커밋 차단(rc 1), `docs/` 문서와 `src/app/api/authx/foo.ts` 는 통과(rc 0). 실제 index·작업 트리·HEAD 는 변동 없음.
- 이 배포에 실린 것: `53509bd`(훅·시험·CLAUDE.md)와 문서 전용 커밋 `784151b`. `src/**` 변경이 없어 사용자 화면·앱 동작은 달라지지 않았다. 이 기록을 남기는 문서 전용 커밋은 origin 에 올리지 않았다(다음 코드 push 에 동승 — 문서만을 위한 배포는 하지 않는다).

## Codex 검토

### [2026-10-26 08:05] C2 review focus=none — done(지적 1건, 범위 통제 관련)
- judge 판정: 판단 기록 (judge) 절의 C2 판정(codex_required true, mode review, focus none) / 호출 차수: 1/4
- 대상: repo=/home/brownjeon/.node-local/stockinvest-hook-t090 base=3cc7418(task_file) snapshot=a1e9fed
- 지적 1건: [low] agent-vault/10-Flow/tasks/T-090-hook-safety-paths-auth-routes.md:1 — 인계서 허용 파일(3개) 밖의 task 이력서 파일이 스냅샷 diff 에 포함됨 → 범위 통제·변경 감사 신뢰성 약화 (권고: 의도된 파일이면 허용 목록과 승인 기록을 갱신하고, 아니면 검토 대상 커밋에서 제외)
- 정적 검토 요지: 새 정규식은 src/app/api/auth/ 하위 전체와 대괄호 경로를 포착하고 authx·auth-foo·중첩 경로는 제외. 시험 시나리오 구성 적절, 기존 판정 로직 변경 없음. 기능상 결함은 지적되지 않음.
- 검토하지 못한 범위: 전체 scripts/test-git-hooks.sh 실행 및 실제 저장소 E2E 는 인계 지침에 따라 수행하지 않음
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261025T230351Z-T-090-C2/raw.txt

## 최종 요약

### [T-090] 로그인·가입·구글 로그인 처리 코드(`src/app/api/auth/`)를 고치면 Reviewer 기록 없이는 커밋이 막힘

- **상태**: ✅ 완료(로컬 커밋·main 병합·활성화 확인·push·운영 배포 확인까지)
- **무엇이 바뀌었나**: 커밋 안전장치 훅의 감시 목록에 `src/app/api/auth/` 디렉토리 전체(11개 파일 — 앱 교환 `app-exchange`·`[provider]` 구글 시작·콜백·`login`·`signup`·`logout`·`oauth-*`·`signup-request`)를 넣었다. 이제 이 파일을 고치는 커밋은 Reviewer 독립 감사 판정 줄이 task 이력서에 없으면 훅이 막는다. 이전에는 세션(로그인 상태)을 발급하는 입구가 감시 밖이라 감사 없이도 커밋될 수 있었다(T-088 에서 발견). 앱·웹 동작은 바뀌지 않는다 — 훅 목록 1줄·근거 주석·시험·CLAUDE.md 안내 문구뿐이다.
- **배포**: ✅ 운영 반영 — 커밋 `53509bd`·`784151b` · 2026-10-26 09:02:57 KST push(webhook) · 결과 ok(릴리스 `20261026-090312-784151b3`, migrated=false). 같은 배포에 함께 실린 작업: 없음(T-090 문서 전용 커밋 `784151b` 만).
  - 로컬 훅 활성화는 push 와 무관하게 08:18 에 이미 적용됐다(08:19 확인: auth 라우트 차단·문서 통과).
  - 장중(국내장 개장 직후) 배포였다 — 킬스위치 ON·최근 3시간 주문 0건을 먼저 확인했고 배포 후 점검 전부 정상(상세 `## 배포 기록`).
- **AI 가 검증한 것**: Reviewer(Sonnet) 독립 감사 — 새로 걸리는 파일이 정확히 11개이고 기존 355개 판정은 불변(전수 대조)·변이 13종을 시험이 모두 검출·훅 로직 diff 0. 로직 시험 113 통과/0 실패. Codex C2 지적 1건은 오탐(래퍼 스냅샷에 task 사본이 섞인 것). QA 가 일회용 저장소 실 커밋 51개 시나리오 51/0, 옛 훅 대조군에서는 같은 커밋이 통과해 구멍이 실재했음을 재현. 병합 후 설치된 shim 경유 차단 확인.
  - 검증 못 한 것: 전체 `scripts/test-git-hooks.sh` 의 `# [E2E]` 단계(실제 index 를 건드려 실행하지 않음) · 대소문자 구분 없는 파일시스템(맥)의 `Auth/` 경로 · NFS `noexec` 경로에서 훅 직접 실행.
- **👉 사용자가 확인할 것**: 없음(화면·앱 변화 없음).
- **👉 사용자가 결정할 것**:
  1. (해소) push 시점 — 사용자가 "푸시 진행해줘" 로 지시해 09:02 에 push·배포 완료.
  2. 이번에 훅 밖에 남긴 인증 관련 파일을 따로 넣을지 — `src/lib/auth/signup-gate.ts`(초대코드 대조)·`signup-request.ts`·`src/lib/mail/send.ts`(초대코드 수신자 고정)·`src/lib/safe-next-path.ts`(T-089 오픈 리다이렉트 단일 관문)·`src/app/api/profile/password/`·`src/__tests__/middleware-public-paths.test.ts`. 권고: `safe-next-path.ts`·`signup-gate.ts`·`mail/send.ts` 는 이번 라우트와 같은 위험군이라 별도 task 로 추가 검토, 나머지는 보류.
- **남은 일**: 앞 결정 2 의 후속 task(번호 T-091 이상). ACTIVE·RESUME 인수인계 문구는 이 task 로 갱신 완료.
- **이슈·위험**: ① 새 항목이 세션을 만들지 않는 파일(`logout`·`oauth-providers`·`oauth-pending`)까지 걸어 사소한 수정에도 판정이 필요하다 — 근거 주석에 "마찰이 반복되면 Leader 재검토"로 기록(선제 완화 안 함). ② CLAUDE.md 문구 "세션을 발급하는 `src/app/api/auth/` 전체"는 디렉토리 전체가 감시된다는 뜻으로는 맞지만 일부 파일은 세션을 발급하지 않는다(Reviewer·QA 지적, 동작 영향 없음). ③ `docs/mobile-app-procedure.md` 66행 훅 항목 수 "38개"는 T-090 이전부터 낡았다(병합 후 40개) — 숫자를 쓰지 않는 쪽이 낫다. 롤백: `git revert 53509bd`(로컬 즉시 적용).

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-26 07:31 |

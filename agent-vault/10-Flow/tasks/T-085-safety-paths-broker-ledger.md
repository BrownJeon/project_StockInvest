---
task_id: T-085
title: 커밋 안전장치(SAFETY_PATHS)에 src/lib/broker-ledger/ 추가 (T-081 WP-D U-5)
status: todo
priority: high
roles_involved: [leader, developer, reviewer, qa, judge, codex]
related_tasks: [T-075, T-081, T-087]
tags:
  - type/task
  - domain/safety
aliases:
  - 브로커원장훅
created: 2026-10-25
updated: 2026-10-25
base_ref: aa51dd05cb1ee057f806f05b3578a0fc570cfdf7
risk_level: R2
developer_model: opus
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

# T-085 — SAFETY_PATHS 에 `src/lib/broker-ledger/` 추가

> **수익 경로 연결(제1원칙)**: 브로커 체결 원장(T-087)의 수집기·대사 코드는 월 수익률과 킬스위치 `−5% 월 사건` 판정의 입력을 만든다. 이 코드가 감사 없이 바뀌면 "계좌 상태를 맞게 안다"는 근거가 조용히 틀어진다. T-087 코드가 들어오기 **전에** 훅이 이 경로를 감시해야 한다.

## 사용자 결정 (2026-10-25, 원문 "DDL적용 승인 / 모든 작업들에 대하여 권고대로 착수 진행해줘")
설계 §8 U-5 의 권고 "추가(훅 변경은 별도 작업)" 에 따른다. 이 task 가 그 별도 작업이다.

## 범위
- `scripts/git-hooks/commit-msg` 의 `SAFETY_PATHS` 배열에 `'^src/lib/broker-ledger/'` 1개 추가 + **배열 위 주석에 항목별 근거**(기존 규약: "목록을 고칠 때는 근거도 같이 적는다"). 정규식 앵커·기존 항목 순서·스타일 유지.
- `scripts/test-git-hooks.sh` 에 새 경로 시나리오 추가: 해당 경로 변경 + 판정 없음 → 차단 / 유효 판정(scope 포함) → 통과 / scope 밖 → 차단. 스크립트는 임시 index·임시 저장소를 쓰며 실제 index·커밋을 건드리지 않는다는 기존 방식을 유지.
- **넣지 않는다**: `src/lib/ledger/` (순수 함수 영역 — WP-F 가 `ledger ⟂ safety` 정적 불변식으로 이미 격리, 주문에 영향 없음, 선례 T-075 가 `src/lib/reports/` 를 제외한 논리와 같다). `docs/design/` 등 문서.
- 프로젝트 `CLAUDE.md` 의 '커밋 안전장치' 절은 **목록을 복제하지 않는 정책**이라 수정하지 않는다.
- 훅 파일을 바꿨으니 `bash scripts/install-git-hooks.sh` 재실행이 필요한지 확인(원본↔shim 대조 경고가 나는지) — shim 모드에서 기존 훅 내용 변경은 재실행 불필요이지만 확인하고 결과를 기록.
- 이미 스테이징·커밋 대기 중인 타 세션 변경 중 새 경로에 걸리는 파일이 있는지 `git status` 로 확인해 보고(현재 `src/lib/broker-ledger/` 는 존재하지 않으므로 걸릴 파일 없음 예상).

## 단계
Developer → Reviewer(`scope: scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh`) → (judge C2 → Codex 필요 시) → QA(훅 시험 직접 실행) → 명시 경로만 커밋 → push(앱 코드는 동일, 문서·스크립트 변경 배포).

## 완료 기준
1. `awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg` 에 새 항목이 보이고 근거 주석이 있다.
2. `bash scripts/test-git-hooks.sh` 가 전 시나리오(기존 + 새 3종) 통과, 실제 index 불변.
3. 새 경로 파일 1개를 임시 저장소에서 판정 없이 커밋 시도 → 차단됨을 시험에서 확인.
4. Reviewer 판정 줄(`최종 판정`) scope 가 위 두 파일을 포함.

## 판단 기록 (judge)
- 2026-10-25 19:3x intake(규칙 엔진 — Jev 예산 창 닫힘 `budget_window_closed` 폴백): risk R1, developer opus(`MD-judge-failed-opus`), 데모 none, next=assign. 결과 파일 `docs/design/judge-result-T-085-intake.json`.
- Leader 보정: 대상이 `scripts/git-hooks/` 로 SAFETY_PATHS(훅 자신)이므로 판정이 R1 이어도 **Reviewer 독립 감사 필수**(프로젝트 규칙 우선).

## Developer 기록
- [20:46] 구현 완료. 수정 파일 2개뿐: `scripts/git-hooks/commit-msg`(+16줄: 주석 15·배열 1), `scripts/test-git-hooks.sh`(+53/−2). 다른 파일·git index·커밋은 건드리지 않음.
- [20:46] `commit-msg`: `SAFETY_PATHS` 의 `'^src/lib/strategy/'` 바로 다음에 `'^src/lib/broker-ledger/'` 추가(src/lib 디렉토리 항목 묶음 안, 기존 앵커·따옴표 스타일 그대로). 배열 위 주석에 "T-085 추가" 블록 — 포함 근거(원가·실현손익·월 수익률 `ok`·킬스위치 −5% 판정의 입력, 코드 유입 전 선제 감시, D1a 분할 커밋 시 무훅 유입 방지, 디렉토리 전체 매치 이유, `__tests__` 포함)와 미포함 근거(`src/lib/ledger/` = 순수 함수·`ledger ⟂ safety` 격리·T-075 의 reports 제외 논리, 문서, `scripts/broker-ledger/` = 범위 밖·아직 없음).
- [20:46] `test-git-hooks.sh`: "[T-085 …]" 절 추가 — t085-a1(판정 미기록 → 차단) · a2(T-982 scope `src/lib/broker-ledger/` → 통과 + 통과 문구 단언) · a3(T-981 이웃 scope `src/lib/ledger/, src/lib/broker/, scripts/broker-ledger/, src/lib/broker-ledger`(슬래시 없음) → 차단) · a4(task ID 없음 → 차단) · p1(`__tests__/collector.test.ts` → 차단) · n1(`src/lib/ledger/compute.ts`·`broker-ledger-old/`·`broker-ledger.ts`·`mockups/src/lib/broker-ledger/`·`scripts/broker-ledger/` → 통과). fixture T-982·T-981 추가에 맞춰 머리말·끝 안내의 fixture 범위 문구를 `T-983~998` → `T-981~998` 로 정정(실제 tasks 에 T-981·T-982 파일 없음 확인).
- [20:46] 시험 실행 방식: **실제 저장소에서는 돌리지 않았다.** 이 스크립트는 로직 단계에서 fixture 를 실제 작업 트리에 쓰고, E2E 단계에서 **실제 index** 에 가짜 blob 을 올린 뒤 `git read-tree HEAD` 로 되돌린다(스크립트 머리말 8~28행) — 같은 트리에서 다른 Developer 2명이 일하는 중이라 위험. 대신 scratchpad 에 격리 저장소를 만들어 실행: `git archive HEAD`(aa51dd0) 풀기 + 수정한 두 파일 덮어쓰기 + `git init`·기초 커밋 + `core.hooksPath=scripts/git-hooks`(로컬 디스크라 실행 가능). (`git clone` 은 저장소의 깨진 ref `refs/heads/@eaDir/main@SynoEAStream` 때문에 git 내부 BUG 로 실패해 이 방식으로 바꿈.) 두 파일이 작업 트리 파일과 바이트 동일함을 `cmp` 로 확인.
- [20:46] 결과 `bash scripts/test-git-hooks.sh` (격리 저장소): **93 통과 / 0 실패**(기존 87 + 새 6), E2E 실 커밋 시도 차단(exit 1, HEAD 불변), fixture 잔존 없음, 종료코드 0.
- [20:46] 변이 확인(격리 저장소에서만): `'^src/lib/broker-ledger/'` 줄을 지운 훅으로 재실행 → 88 통과 / 5 실패(t085-a1·a2·a3·a4·p1 이 실패) — 새 시나리오가 이 항목 하나의 누락을 잡는다. 이후 원본으로 복원·`cmp` 동일 확인.
- [20:46] 완료 기준 3(새 경로 파일을 판정 없이 실제 커밋): 격리 저장소에서 `src/lib/broker-ledger/collector.ts` 를 add 하고 `git commit -m "feat(T-993): …"` → 훅 차단 rc=1, HEAD 불변.
- [20:46] 완료 기준 1: `awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg` 6번째 줄에 `'^src/lib/broker-ledger/'` 확인.
- [20:46] 실제 저장소 불변 증빙: 시작 시점·종료 시점 모두 `git rev-parse HEAD` = `aa51dd05cb1ee057f806f05b3578a0fc570cfdf7`, staged 0건 → 0건. `git status --short` 은 그사이 두 줄이 늘었는데(` M src/app/api/cron/trade-report/route.ts`, ` M src/lib/reports/__tests__/trade-report-partial-fill.test.ts`) 이는 동시 작업 중인 다른 Developer 의 변경이며 이 작업과 무관(시험은 격리 저장소에서만 돌았다). 로컬 `.git/config` 의 user·hooksPath 불변.
- [20:46] 새 경로에 걸리는 미커밋 파일: `git status --untracked-files=all` 에서 `src/lib/broker-ledger/` 0건(디렉토리 미존재). 참고: 다른 Developer 가 고치는 `src/app/api/cron/trade-report/route.ts` 는 **기존** 안전 경로(`^src/app/api/cron/`)에 걸린다 — 그 task 의 Reviewer scope 에 들어가야 커밋된다.
- [20:46] `install-git-hooks.sh` 재실행 필요 여부: **불필요**. shim(`~/.local/share/stockinvest-git-hooks/361294826755/commit-msg`)은 원본 절대경로를 `exec bash "$SRC"` 로 부르는 래퍼라 원본 내용 변경이 그대로 반영되고, 새 훅 파일을 추가하지 않았다(`scripts/git-hooks/` 에는 `commit-msg` 하나, shim 디렉토리에도 같은 이름 존재 → `check_hook_sync` 경고 대상 아님). 실행하지 않음.
- [20:46] 안전장치 self-check: 주문·체결 코드 무변경이라 DRY_RUN·KILL_SWITCH·한도 항목은 해당 없음. 운영 DB·KIS·텔레그램·`.env` 접근 없음.
- [20:46] Reviewer 에게: scope 후보 `scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh`. 재현 명령은 위 격리 방식 그대로이거나, 실제 저장소에서 돌리려면 stage 가 비어 있고 다른 세션이 커밋하지 않는 때에만(`git diff --cached --quiet` 확인 후) 실행.

## Reviewer

- [21:00] 라운드 1 독립 감사 시작(구현자 보고는 믿지 않고 diff·직접 실행으로 판단). 감사 전 실제 저장소: HEAD `aa51dd05cb1ee057f806f05b3578a0fc570cfdf7`, staged 0건. 실제 저장소에서는 `test-git-hooks.sh` 를 돌리지 않았다(E2E 단계가 실제 index 를 올렸다 `read-tree HEAD` 로 덮어쓰기 때문). 모든 실행은 scratchpad `rev-t085/` 격리 저장소(`git archive HEAD` 풀기 + 수정 2파일 덮어쓰기 + `git init`·초기 커밋 + `core.hooksPath=scripts/git-hooks`)에서만 했고, 그 두 파일이 작업 트리와 `cmp` 동일함을 감사 시작과 끝에 두 번 확인했다.
- [21:00] 1) diff 범위 — 확실. 변경은 2개 파일뿐. commit-msg +16/−0(주석 15줄 + 배열 1줄), test-git-hooks.sh +51/−2(삭제 2줄은 fixture 범위 문구 `T-983~998` → `T-981~998` 두 곳; 구현자 기록의 '+53/−2' 는 diffstat 변경 줄 합계 53 을 +로 잘못 적은 것이며 내용에는 영향 없음). 기존 항목의 순서·앵커·따옴표 변경 0건. 새 항목은 `'^src/lib/strategy/'` 바로 다음 한 줄이고 기존 스타일(작은따옴표·2칸 들여쓰기·`^…/`)과 같다. 배열 38 → 39개, 두 파일 `bash -n` 통과, `git diff --check` 공백 오류 없음, 모드 100755 유지, 훅 로직 코드는 한 줄도 바뀌지 않았다(주석 + 배열 원소만).
- [21:01] 2) 정규식 — 확실. 훅은 합친 ERE 를 `LC_ALL=C grep -aE "$SAFETY_RE"` 로 staged 경로에 줄 단위 매치한다(commit-msg:371). 작업 트리 훅의 실제 배열을 읽어 직접 대조: 매치 = `src/lib/broker-ledger/collector.ts`·`__tests__/…test.ts`·`a/b/c.ts`·`.hidden`·한글 이름, 비매치 = `broker-ledgerX/`·`broker-ledger-old/`·`broker-ledger.ts`·파일 `src/lib/broker-ledger`·`src/lib/ledger/**`(시험 파일 포함)·`scripts/broker-ledger/`·`src/app/api/broker-ledger/`·`docs/design/*`·`src/lib/reports/*`. 추적 파일 1,010개 전수 차분: 옛 정규식 320개 vs 새 정규식 322개이고 차이는 내가 넣은 합성 경로 2개(`src/lib/broker-ledger/…`)뿐 — 의도 밖으로 넓어진 곳 없음.
- [21:02] 근거 주석의 사실 대조 — 확실(표현 한 군데만 느슨). ① `ledger ⟂ safety` 불변식은 실제 있다: `src/lib/ledger/__tests__/static-invariants.test.ts` 의 "주문·시그널·안전장치·거래소·전략·알림 모듈을 import 하지 않는다"(safety·exchanges·signals·strategy·notify·orders·risk·profit-engine 금지). 다만 이 시험은 T-074(커밋 330314e) 소속이고 `monthly-return.ts` 머리 주석이 'T-074 정적 불변식'으로 인용할 뿐이라 주석의 '(WP-F)' 귀속은 부정확하다. ② 이 불변식은 한 방향(ledger → safety import 금지)만 막는다. 반대(safety·signals·strategy·cron 이 ledger 를 import)는 시험이 없고 지금 grep 0건이라 '주문에 영향 없음'은 현재 사실일 뿐이다. ③ 설계 문서 인용(§8 U-5·§7 M6·F10, 지문 설명)은 실제 줄과 일치한다. ④ '2026-10-25 현재 미존재': `src/lib/broker-ledger/`·`scripts/broker-ledger/` 모두 디렉토리 없음 확인.
- [21:03] 3) 시험 직접 실행 — 확실. 격리 저장소에서 `bash scripts/test-git-hooks.sh`: **93 통과 / 0 실패**, 종료코드 0, E2E 실 `git commit` 시도가 훅에 막힘(exit 1, HEAD 불변), fixture 잔존 없음. 새 시나리오 t085-a1·a2·a3·a4·p1·n1 6개 모두 기대대로(a2 는 통과 문구 단언까지).
- [21:04] 6) 기존 동작 회귀 — 확실. 같은 격리 방식 3조합: 옛 훅 + 옛 시험 = 87/0(기준선) · **새 훅 + 옛 시험 = 87/0**(기존 87 시나리오 결과가 새 훅에서 동일) · 옛 훅 + 새 시험 = 88/5(새 6개 중 a1·a2·a3·a4·p1 이 실패하고 n1 만 통과 — 시험이 이 항목 추가를 실제로 겨냥한다).
- [21:05] 4) 변이 확인 — 확실. 새 시험 + 변이 훅 8종(격리 복사본, 변이당 훅 diff 1~2줄), 전부 검출: 항목 삭제 → 88/5(a1·a2·a3·a4·p1) · `^src/lib/broker-ledger$`(슬래시 없음) → 88/5(같은 5개) · `^src/lib/broker-ledger`(끝 슬래시 삭제·과확대) → 92/1(n1) · `src/lib/broker-ledger/`(`^` 삭제) → 92/1(n1) · `^src/lib/(broker-)?ledger/`(순수 원장까지 확대) → 92/1(n1) · `^src/lib/broker-ledger/[^/]*$`(최상위만) → 92/1(p1) · `…/[a-z]+\.ts$`(.ts 최상위만) → 92/1(p1) · `^(src/lib|scripts)/broker-ledger/`(scripts 까지 확대) → 92/1(n1). 새 시나리오가 누락·과소·과대 어느 방향의 회귀도 잡는다.
- [21:06] 5) 상호작용·우회 — 확실. 새 항목은 경로 판별(안전 경로 있음/없음)에서만 쓰이고 task ID 추출·`## Reviewer` 섹션 스캔·마지막 판정 줄·scope 대조 코드는 그대로다. a2 는 scope `src/lib/broker-ledger/`(끝 슬래시 = 디렉토리 접두어, commit-msg:499)로 하위 파일이 인정됨을 통과 문구(`Reviewer 감사 기록 확인`) 단언까지 해서 '안전 경로가 아니라 조용히 통과'와 구분한다(a2 에서 모든 변이가 실패로 드러남). a3 은 슬래시 없는 `src/lib/broker-ledger` scope 가 정확 일치로만 읽혀 하위 파일을 못 여는 fail-closed 를 고정한다. 가산 전용 목록 원칙이 유지돼 새 우회 표면은 없다. 사소한 한계: a2 는 최상위 파일 하나만 스테이징하므로 중첩·`__tests__` 파일이 디렉토리 scope 로 통과하는지는 직접 단언하지 않는다(scope 대조 코드는 경로 무관 접두어 비교라 위험은 낮고 p1 이 중첩 경로의 '매치'는 고정한다).
- [21:06] 설치 shim — 확실. `~/.local/share/stockinvest-git-hooks/361294826755/commit-msg` 는 원본 절대경로를 `exec bash "$SRC"` 로 호출하는 래퍼라 원본 내용 변경이 즉시 반영된다. `scripts/git-hooks/` 와 shim 디렉토리 모두 `commit-msg` 하나뿐이고 새 훅 파일을 추가하지 않았으므로 재설치 불필요·`check_hook_sync` 경고 대상 없음 — 구현자 기록과 일치.
- [21:07] 지적(모두 비차단). M-1 `scripts/broker-ledger/refingerprint.mjs` 는 훅 밖으로 남는다. 설계 지문 설명(82행)에 따르면 이 스크립트는 운영 DB 4개 테이블의 `account_fingerprint` 를 일괄 갱신해 '계좌 불일치 시 쓰지 않는' fail-closed 가드를 되돌린다. 구현자가 주석에 '범위 밖·별도 사용자 결정'으로 명시했고 사용자 결정 U-5 가 문자 그대로 `^src/lib/broker-ledger/` 만이라 이 task 범위로는 올바르다. 다만 설계 D2 행(246행)이 `scripts/broker-ledger/` 를 '훅 밖(U-5 전까지)'으로 적어 U-5 가 그것도 덮는다고 읽힐 여지가 있으므로, Leader 는 이 스크립트가 생기기 전에 사용자에게 한 줄로 확인하거나 T-087 기록에 '해당 스크립트 커밋은 Reviewer scope 에 경로를 명시한다'는 수동 보장을 남기길 권한다. L-1 주석의 '(WP-F)' 귀속(→ T-074 시험)과 `src/lib/ledger/` 제외 근거('주문에 영향 없음')의 재검토 조건: WP-F 월 수익률 `ok` 가 월 −5% 킬스위치 판정에 연결되는 시점(설계 U-6)에는 `src/lib/ledger/`(monthly-return.ts·candidates.ts)도 안전 판단의 입력이 되어 이 주석이 broker-ledger 를 넣은 논리와 같은 논리가 적용된다 — 그때 제외를 다시 결정해야 하며 지금 고칠 사항은 아니다. L-2 `.claude/agents/judge.md` 의 'Leader 가 R2 로 다뤄야 하는 영역' 산문 목록에 `src/lib/broker-ledger/` 가 없다(이 task 범위 밖) — T-087 intake 때 Leader override 또는 목록 추가 권고.
- [21:08] 확인하지 못한 것: ① 실제 저장소·실제 index 에서 `test-git-hooks.sh` 를 돌리지 않았다(지시된 금지 사항; 격리 복사본은 HEAD aa51dd0 + 두 파일이라 동시 작업 중인 다른 Developer 의 미커밋 변경은 반영되지 않는다). ② 실제 Gitea push·webhook 경로와 다른 머신의 shim 상태. ③ 이후 두 파일이 바뀌면 이 판정은 무효이므로 재감사가 필요하다. 이 절 외에 저장소 파일은 수정하지 않았고 git add·commit·stash·reset·checkout·clean·`--no-verify` 도 쓰지 않았다.
- [21:08] 요약: Critical 0 · High 0 · Medium 1(M-1, 설계 문구와 사용자 결정 사이 해석 차이를 해소하라는 결정 권고) · Low 2(L-1, L-2). 시험 93/0, 기존 87 시나리오 동일, 변이 8종 전부 검출. QA 집중 지점: 실제 저장소 index 가 비어 있고 다른 세션이 커밋하지 않는 때에 `bash scripts/test-git-hooks.sh` 1회(E2E 포함) — 완료 기준 3(새 경로 파일을 판정 없이 커밋 시도 → 차단)은 격리 복사본의 a1 과 E2E 로 이미 확인했다.
- [21:10] 감사 종료 시점 실제 저장소 확인: staged 0건, fixture 잔존 0건, `core.hooksPath` 불변. HEAD 는 감사 시작 때 `aa51dd0` 이었으나 종료 때 `b435399` 로 앞섰다 — 다른 세션의 T-084 커밋 2개(`46d4148`·`b435399`, 앱 셸·문서)가 그사이 들어갔기 때문이고, `git diff aa51dd0 HEAD -- scripts/git-hooks scripts/test-git-hooks.sh src/lib/broker-ledger` 는 비어 있어 이 감사 대상 두 파일의 HEAD 버전은 base_ref 와 동일하다(감사 결론에 영향 없음). 이 판정 줄을 훅이 실제로 읽는지 격리 저장소(aa51dd0 기준이지만 훅 파일이 새 HEAD 와 동일하므로 같은 동작)에서 확인: 두 파일을 stage 하고 `T-085` 를 인용한 메시지로 훅을 실행하면 통과(rc 0, '확인: T-085'), 거기에 `src/lib/broker-ledger/collector.ts` 를 더 얹으면 scope 합집합 밖으로 차단(rc 1) — 이 판정은 훅·시험 두 파일만 덮는다.
- [21:10] **최종 판정: PASS (scope: scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh)**

## Codex 검토 (C2)
- 2026-10-25 20:56 judge C2(규칙 엔진 폴백): `codex_required=true`(`CX-limit-unknown-r2`). 결과 `docs/design/judge-result-T-085-C2.json`.
- Codex 읽기 전용 검토(44초, `status=done`). **대상은 이 task 파일 2개만 담은 격리 저장소**(작업 트리에 T-086·T-087 WIP 가 섞여 있어 `--repo` 로 한정). 요약: 새 정규식은 지정 디렉터리와 하위 `__tests__` 를 잡고 `src/lib/ledger/`·`broker-ledger-old/`·`broker-ledger.ts`·`scripts/broker-ledger/` 는 제외, task ID·마지막 판정·scope 슬래시 경계 검사와의 상호작용에서 우회·오차단 없음, 주석 근거 일치.
- 지적 1건(medium) `scripts/test-git-hooks.sh:733`: 새 fixture(`T-981`·`T-982` task 문서)를 존재 확인·백업 없이 덮어쓰고 종료 시 `rm -f` — 같은 이름의 실제 task 기록이 생기면 덮어써진다.
- **Leader 판정: 수정하지 않고 위험으로 기록.** 근거: 기존 fixture(`T-983`~`T-998`)가 이미 같은 방식이고, 스크립트 머리말이 이 번호 범위를 시험용으로 예약한다(이번에 `T-981~998` 로 넓혀 적음). 새로 생긴 위험이 아니며 고치려면 훅 시험 스크립트 재수정과 재감사가 필요하다. 후속 개선 후보로 실행 원장에 남긴다(fixture 생성 전 존재 확인).
- Codex 가 보지 못한 것: 시험 스크립트 실제 실행(상태 변경 금지) — 독립 감사가 격리 저장소에서 93/0 으로 확인.

## QA 기록

- [21:01] QA 시작. 구현자·감사자 보고는 믿지 않고 전부 직접 실행. 검증 전 실제 저장소 기준선: HEAD `b4353994cfb6aceb0565d6e7ddf7fd11ad04f47f`(감사 시작 때 `aa51dd0` 에서 다른 세션 T-084 커밋 2개로 앞섬 — 대상 두 파일의 HEAD 버전은 동일), staged 0건, `core.hooksPath` = `~/.local/share/stockinvest-git-hooks/361294826755`. 실제 저장소에서 `test-git-hooks.sh` 는 돌리지 않았다(지시 사항 준수).
- [21:01] 격리 환경: scratchpad `qa-t085/` 새 디렉터리. `git archive HEAD | tar -x`(현재 HEAD `b435399`) → 두 파일을 HEAD 버전(옛 훅·옛 시험)으로 둔 채 `git init` + 초기 커밋 `1066c7a`(훅 경로 우회 옵션 없음, 이때 hooksPath 미설정 확인) → 그 뒤 작업 트리의 수정본 두 파일을 덮어써 **미커밋 수정** 상태로 만듦(`cmp` 동일 확인 2/2, 모드 755). 시험 스크립트 E2E 단계가 돌도록 격리 저장소에만 `core.hooksPath=scripts/git-hooks` 설정(/tmp 는 ext4 라 실행 가능). 이렇게 하면 "옛 커밋 + 새 수정" 구조라 실제 커밋 시 상황(체크 7)을 그대로 재현한다.
- [21:02] 체크 1(완료 기준 1) 통과 — `awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg` 에서 6번째 줄 `'^src/lib/broker-ledger/'`(전체 38 → 39개) 확인. 근거 주석은 `commit-msg:263~277`(포함 근거 + 미포함 근거 `src/lib/ledger/`·문서·`scripts/broker-ledger/`). `bash -n` 두 파일 rc 0/0, `git diff --check` rc 0, `git diff --numstat` commit-msg 16/0 · test-git-hooks.sh 51/2, 모드 변경 없음(`git diff --summary` 빈 출력).
- [21:04] 체크 2(완료 기준 2) 통과 — 격리 저장소에서 `bash scripts/test-git-hooks.sh` 종료코드 0, `결과: 93 통과 / 0 실패`(출력의 ✅ 줄 93개, ❌ 줄 0개), 새 시나리오 t085-a1·a2·a3·a4·p1·n1 6개 전부 기대 exit 일치, E2E "실제 git commit 이 훅에 의해 차단됨 (exit 1, HEAD 변동 없음)". 종료 후 격리 저장소 HEAD `1066c7a` 불변, `git diff --cached` 0건, fixture(`T-98x/T-99x-hooktest`) 잔존 0건.
- [21:08] 체크 3(완료 기준 3) 통과 — 격리 저장소에서 `src/lib/broker-ledger/collector.ts`(빈 파일) 를 stage 하고 실제 `git commit`: (3a) task ID 없는 메시지 → rc 1 차단, HEAD 불변 · (3b) 존재하지 않는 `T-999` → rc 1 차단("T-999-*.md 가 없습니다") · (3c) `T-085` 사본에서 판정 줄을 제거한 `T-971`(판정 줄 수 0 확인) → rc 1 차단(훅 문구: Reviewer 섹션에 판정 줄이 없다는 구 형식 안내) · (3d) 실제 `T-085`(scope 는 두 스크립트) → rc 1 차단("scope 합집합 밖") · (3e) scope 에 `src/lib/broker-ledger/` 를 넣은 사본 `T-972`(판정 줄 확인) → rc 0 통과, HEAD 이동, "Reviewer 감사 기록 확인: T-972" · (3f) 문서 전용 파일(`docs/qa-note-t085.md`)만 stage 하고 task ID 없는 메시지 → rc 0 통과(훅이 검사하지 않음). 6건 모두 기대와 일치.
- [21:09] 보조 차분 — 같은 index(`broker-ledger/collector2.ts` 1개, task ID 없는 메시지)에 **옛 훅(초기 커밋 버전)** 은 rc 0(통과 = 새 경로가 비어 있던 구멍), **새 훅** 은 rc 1(차단). 이 task 의 변경 한 줄이 그 구멍을 실제로 닫는다는 직접 증거.
- [21:10] 체크 4(이웃 경로 경계) 통과 — `src/lib/ledger/x.ts`, `src/lib/broker-ledger-old/x.ts`, `scripts/broker-ledger/x.mjs` 를 task ID 없는 메시지(`chore: neighbor path probe`)로 각각 실제 커밋 → 3건 모두 rc 0 통과(훅 출력 없음), 3개를 한꺼번에 stage 한 커밋도 rc 0. 즉 이 항목은 이웃을 오차단하지 않고, 이 3경로를 막는 **다른** SAFETY_PATHS 항목도 없다(차단이 있었다면 훅이 파일명을 나열했을 것). 의도한 경계와 일치.
- [21:12] 체크 5(기존 항목 회귀) 통과 — task ID 없는 메시지로 `src/lib/safety/x.ts`, `src/lib/exchanges/x.ts`, `scripts/migrations/x.sql`, `src/app/api/cron/x/route.ts`, `scripts/git-hooks/pre-commit-x` 를 각각 실제 커밋 → 5건 모두 rc 1 차단, HEAD 불변("task ID(T-NNN)가 없습니다"). 기존 87 시나리오도 체크 2 의 93/0 안에서 그대로 통과.
- [21:15] 체크 6(실제 저장소 불변) 통과 — 검증 후 `git rev-parse HEAD` = 검증 전과 동일 `b4353994cfb6aceb0565d6e7ddf7fd11ad04f47f`, `git diff --cached --stat` 빈 출력, `git config --local core.hooksPath` 값 동일, 작업 트리 fixture 잔존 0건, 두 수정 파일은 격리 복사본과 `cmp` 동일(검증 중 변하지 않음). shim `~/.local/share/stockinvest-git-hooks/361294826755/commit-msg` 를 `cat` 으로 확인: 원본 절대경로를 `SRC` 로 두고 `exec bash "$SRC" "$@"` 하는 래퍼(원본 부재 시 오류 종료) — 내용 변경이 즉시 반영되고, 훅 파일을 추가하지 않았으므로(`scripts/git-hooks/` 와 shim 디렉토리 모두 `commit-msg` 1개) 재설치 불필요가 맞다.
- [21:16] 실제 환경 추가 점검 — 실제 저장소에서 **임시 index**(`GIT_INDEX_FILE`, 기존 README blob 재사용이라 객체 DB 쓰기 없음)로 실제 shim 을 직접 호출: R1 broker-ledger+task ID 없음 → rc 1 · R2 broker-ledger+`T-085`(scope 는 스크립트 2개) → rc 1("검토된 범위(합집합): scripts/git-hooks/commit-msg scripts/test-git-hooks.sh") · R3 두 스크립트+`T-085` → rc 0("Reviewer 감사 기록 확인: T-085") · R4 R3 + `src/lib/broker-ledger/types.ts` → rc 1 · R5 두 스크립트+task ID 없음 → rc 1. 실제 HEAD·index 는 전후 동일.
- [21:18] 체크 7(이 변경 자체를 커밋할 수 있는가) 통과 — 격리 저장소(옛 커밋 + 새 수정 구조)에서 `scripts/git-hooks/commit-msg`·`scripts/test-git-hooks.sh`·`T-085` 문서 3개를 stage 하고 `feat(T-085): …` 메시지로 실제 `git commit` → rc 0, "Reviewer 감사 기록 확인: T-085", 3 files changed. 문서 없이 두 스크립트만 stage 해도 rc 0(훅은 작업 트리의 task 문서를 읽는다). 두 스크립트에 신규 `src/lib/broker-ledger/collector3.ts` 를 얹으면 rc 1 차단, HEAD 불변(합집합 밖). 현재 `## Reviewer` 마지막 판정 줄의 scope 가 두 스크립트를 포함하므로 **명시 경로 커밋은 통과한다.**
- [21:19] 시험 중 내 실수 1건(결함 아님) — 체크 7 첫 시도의 "혼입" 시나리오가 통과(rc 0)했는데, 앞선 3e 에서 이미 `collector.ts` 를 커밋해 둔 탓에 그 파일이 변경 없이 tracked 상태라 stage 대상에서 빠졌기 때문이다. 신규 파일 `collector3.ts` 로 다시 해 rc 1 을 확인했다. 격리 저장소 안에서 `git reset --soft` 로 되돌려 정리했고 실제 저장소와 무관하다.
- [21:20] 결함 0건(Critical 0 · High 0 · Medium 0 · Low 0). 안전장치 체크리스트(DRY_RUN·Kill Switch·주문 한도·심볼·감사 로그)는 주문·체결·DB 코드가 무변경이라 해당 없음. 운영 DB·KIS·텔레그램·`.env` 접근 없음. API 키·환경변수 노출 경로 없음(변경은 bash 훅의 주석 + 배열 원소 1개와 시험 스크립트뿐).
- [21:21] 관찰(차단 사유 아님, Leader 참고): (a) Developer 기록의 "새 경로에 걸리는 미커밋 파일 0건" 은 작성 시점에는 맞았지만 지금은 **사실이 아니다** — 실제 작업 트리에 T-087 쪽 미추적 파일 4개(`src/lib/broker-ledger/{decimal,hash,normalize,types}.ts`)가 생겼다. T-085 는 반드시 **명시 경로**(두 스크립트 + 문서)로만 커밋해야 하며, `git add -A`·`git add src/` 처럼 넓게 담으면 R4 처럼 scope 합집합 밖으로 차단된다(fail-closed 라 안전하지만 커밋이 막힌다). 그리고 T-087 이 이 파일들을 커밋할 때는 T-087 자신의 Reviewer 판정 scope 에 `src/lib/broker-ledger/` 가 있어야 한다. (b) 훅 주석의 "(2026-10-25 현재 미존재 …)" 는 이제 낡았지만 날짜가 붙은 서술이고, 고치면 두 파일이 바뀌어 Reviewer 판정이 무효가 되므로 그대로 두길 권한다. (c) 실제 작업 트리에는 다른 task 의 안전 경로 수정(`src/app/api/cron/trade-report/route.ts`, `src/lib/exchanges/*`)도 미커밋으로 있어 같은 이유로 명시 경로 커밋이 필수다. (d) Codex 지적(T-981·T-982 fixture 를 존재 확인 없이 덮어씀)은 Leader 가 위험 기록으로 처리한 건 — QA 실행에서 실제 task 파일과 충돌은 없었고 종료 후 잔존 0건임을 확인했다.
- [21:21] 확인하지 못한 것: ① 실제 저장소에서 `test-git-hooks.sh` 전체와 실제 `git commit`(지시상 금지) — 대신 격리 저장소 93/0 + 실제 shim 을 임시 index 로 직접 호출(R1~R5)로 갈음. ② 실제 `git` → shim → 원본 `exec` 의 end-to-end 는 실제 커밋 때 처음 일어난다(shim 파일 내용·실행 비트는 확인). ③ Gitea push·webhook 경로, 다른 머신의 shim 상태. ④ 두 파일이 이후 바뀌면 이 기록은 무효(재검증 필요). 이 절 외에 저장소 파일은 수정하지 않았고 git add·commit·push·stash·reset·checkout·clean·`--no-verify` 는 실제 저장소에서 쓰지 않았다(격리 저장소에서만 add·commit·reset 사용).
- [21:21] QA 판정: 통과

## 최종 요약

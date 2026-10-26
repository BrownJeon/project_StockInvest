---
task_id: T-098
title: 커밋 훅 SAFETY_PATHS 에 사전 등록(백테스트) 코드 편입 — registry·backtest·러너·시험(V4)
status: done
priority: medium
project: StockInvest
created: 2026-10-26
updated: 2026-10-26
base_ref: f9dda1a
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-096-strategy-validation-p2-p3, T-093-hook-safety-paths-auth-tests, T-092-hook-safety-paths-auth-impl, T-075-safety-paths-extension]
tags:
  - type/task
  - domain/safety
  - domain/profit-engine
aliases:
  - 훅사전등록감시
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

# T-098 커밋 훅 감시에 사전 등록(백테스트) 코드 편입 (V4)

## 사용자 결정 (10-26 21:38 발화, 그대로)

"V4 사전 등록 코드를 커밋 훅 감시 대상에 넣어줘"(10-26 21:38) — [[T-096-strategy-validation-p2-p3]] v1.1 패치 §B-0 V4 의 권고(편입)를 승인.

## 목표 · 왜

전략 합격 판정의 근거가 되는 사전 등록 잠금(registry·엔진·러너)은 현재 커밋 훅 `SAFETY_PATHS` **밖**이라 독립 감사 판정 없이 커밋될 수 있다(T-096 Reviewer 감사: "이 경로의 훅 감시는 현재 없다"). 잠금 자체가 에이전트가 쓸 수 있는 파일에 일부 기대므로(`g1-record.json`·원장) **"속이면 들킨다"** 를 만드는 보강이 필요하다 — 훅이 이 경로의 커밋마다 Reviewer 판정 줄(scope 일치)을 요구하면 변경이 반드시 독립 감사 기록을 남긴다.

## 범위 — T-093 과 같은 방식(정확 일치 항목 + 근거 주석 + 시험 + CLAUDE.md 한 문장), 훅 판정 로직 변경 0

넣을 것(예상 — Developer 가 `git ls-files`·워크트리 실제 파일로 확정): 
1. `'^src/lib/profit-engine/registry/'` — 사전 등록 수치·OOS 원장·IS 원장·G1 기록·해시 코드(디렉토리).
2. `'^src/lib/profit-engine/backtest/'` — 백테스트 엔진·신호(디렉토리).
3. `'^scripts/profit-engine/backtest-runner\.mjs$'`·`'^scripts/profit-engine/backtest-runner-core\.js$'` — 러너(정확 일치; `scripts/profit-engine/` 의 다른 파일(`postmortem-core.js`·`holdings-*`·`signal-postmortem.mjs`)은 **넣지 않는다** — 범위 밖, 후보로만 기록).
4. 시험: `'^src/lib/profit-engine/__tests__/backtest-'`(`backtest-*.test.ts` 와 `backtest-fixtures.ts` 접두) · `'^src/lib/profit-engine/__tests__/isolation\.test\.ts$'`(격리 방어선 — 프로젝트 원칙 "안전 경로의 시험은 제외하지 않는다"). 이웃(`signal-postmortem-core.test.ts`·`holdings-*` 시험)은 **비매치**여야 한다.

## 하지 않는 것

훅 판정 로직 변경, 앱 런타임 코드, push·배포(훅은 커밋 즉시 활성 — 설치된 shim 이 메인 트리 훅을 실행). 전체 `scripts/test-git-hooks.sh` 실행 금지(`# [E2E]` 단계가 실제 index·설치 훅을 건드림) — **`# [E2E]` 앞까지 자른 사본**으로만 로직 시험, QA 는 일회용 저장소 실 커밋.

## 수용 기준(T-093 참조 — [[T-093-hook-safety-paths-auth-tests]] 의 수용 기준·QA 방식 재사용)

1. 새 항목이 정확히 의도한 파일만 매치(디렉토리 접두·이웃 비매치·정규식 이스케이프), 기존 감시 파일의 판정 불변(옛/새 훅 전수 대조 — `git ls-files` 전체에 두 배열 적용).
2. 시험 `### T-098` 절(`t098-*`): 항목별 판정 없으면 차단/scope 일치 통과/scope 불일치 차단/차용 방지(다른 안전 경로 판정 차용 불가)/이웃 비매치/혼합/일회용 저장소 실 커밋, 기존 시험과 의미 충돌 없음(충돌 시 의미를 보존해 갱신 — 삭제 금지).
3. 훅 근거 주석(항목별 무엇을 고정하는지 — **파일이 실제로 하는 일을 코드로 확인해 쓴다; 주석 사실 오류는 매번 Reviewer 가 잡았다**), CLAUDE.md 「커밋 안전장치」·모바일 앱 절 옆에 한 문장.
4. 독립 감사(Reviewer, 판정 scope: 훅·시험·CLAUDE.md) → judge C2 → QA(일회용 저장소 실 커밋 시나리오, 옛 훅 대조군).

## 역할 배정

Developer(Opus, 격리 worktree `stockinvest-hook-t098`)·Reviewer(Sonnet)·QA. 새 `T-096` 코드 커밋(`registry/`·`backtest/` 등)은 이 훅이 활성화된 **뒤** 하게 되므로, T-096 Reviewer 판정 줄 scope 는 훅이 읽는 형식(디렉토리 접두·정확 경로, 글롭 금지)이어야 한다.

## 판단 기록 (judge)

## 관련 과거 이력 요약

[[T-093-hook-safety-paths-auth-tests]]·[[T-092-hook-safety-paths-auth-impl]]·[[T-090-hook-safety-paths-auth-routes]]: 같은 훅에 정확 일치/디렉토리 항목 + 근거 주석 + 시험 — Reviewer 가 근거 주석의 사실 오류를 매번 잡았다. 사용한 교훈 ID: 없음.

## 진행 기록

- 2026-10-26 21:41: 사용자 V4 승인(21:38 발화) → Leader 가 task 문서 작성·커밋(`a2d2d5a`).

- 2026-10-26 21:46: judge intake R1·developer opus·demo none, worktree `stockinvest-hook-t098`(브랜치 hook-t098, base a2d2d5a) 생성, Developer(opus) 착수. 범위 결정(Leader): 러너가 가져오는 `scripts/profit-engine/postmortem-core.js` 는 이번 편입에서 **제외**(T-096 R2-C2 로 엔진 지문에 들어가 변경이 지문·G1 결속으로 거부됨 → 훅 중복 불필요, 후보로만 기록).
- 2026-10-26 23:10: Reviewer 1라운드 CONDITIONAL_PASS(23:06) — 훅 로직·6줄·시험·CLAUDE.md 결함 0, 근거 주석 2곳(지문 범위 서술 F1·비용 상수 서술 F2)이 지금 P3 코드와 어긋나 주석만 고치도록 Developer(t098-developer) 재요청(곧 바뀔 세부는 쓰지 않는 원칙). 조건 해소 전에는 이 판정 줄을 커밋 근거로 쓰지 않는다(훅은 조건을 읽지 못해 CONDITIONAL_PASS 도 통과시킨다). **F6(Leader 필독, 훅의 구조적 한계)**: ① 옛 `T-070` 판정의 scope 에 디렉토리 `src/lib/profit-engine/` 가 있어 P3 커밋 메시지에 `T-070` 을 적으면 통과된다(차용) → **P3 커밋 메시지는 `T-096` 만 인용하고 `T-070` 을 적지 않는다**(여러 task ID 중 하나만 맞아도 통과하는 훅 규칙). ② `T-096` 의 현재 마지막 판정(21:41)은 R2 보완 전 판정이라, 훅은 판정이 낡았는지 모른다 → P3 커밋 전에 R2 이후 재감사 줄이 마지막에 오는지 Leader 가 확인한다.

## Developer

- [22:46] 구현 완료(격리 worktree `~/.node-local/stockinvest-hook-t098`, 브랜치 `hook-t098` — 착수 때 HEAD 가 `f9dda1a` 라 문서 전용 `a2d2d5a`(이 task 파일)로 ff 이동 후 작업). 미커밋, 훅 판정 로직 변경 0줄.
- [22:46] 바꾼 파일(sha256 앞 12자): `scripts/git-hooks/commit-msg` `6ee909c2c796`(+64: 근거 주석 블록 'T-098 추가' + 배열 6줄) · `scripts/test-git-hooks.sh` `cce1e4af550b`(+254: `[T-098 …]` 절 75개 시나리오, 머리말·끝 안내의 fixture 범위 `T-967~969`→`T-963~969`) · `CLAUDE.md` `cd6e1aad79bd`(+1: 「커밋 안전장치」 경계 판단에 '포함(T-098)' 한 줄). `AGENTS.md` 미수정(생성 미러).
- [22:46] 넣은 항목 6줄(지시안 그대로): `^src/lib/profit-engine/registry/` · `^src/lib/profit-engine/backtest/` · `^scripts/profit-engine/backtest-runner\.mjs$` · `^scripts/profit-engine/backtest-runner-core\.js$` · `^src/lib/profit-engine/__tests__/backtest-` · `^src/lib/profit-engine/__tests__/isolation\.test\.ts$`. P3 worktree(`stockinvest-p3s1`, base e2a7206) 실제 파일 목록으로 확정 — 지시와 다르게 한 것 없음.
- [22:46] 옛/새 대조(훅과 같은 방식 `|` 결합 + `LC_ALL=C grep -aE`): main 추적 1,169개 — 옛 396·새 397, 잃은 것 0, 새로 걸리는 것 1(`src/lib/profit-engine/__tests__/isolation.test.ts`). P3 미추적 33개 — 옛 0·새 31(코드 전부: registry 7·backtest 14·러너 2·시험 접두 8), 안 걸리는 2개는 `agent-vault/10-Flow/reports/T-096-backtest-counts-US-20261026.{json,md}`(문서).
- [22:46] 시험(`# [E2E]` 앞까지 자른 사본, worktree 에서 실행): **342 통과 / 0 실패**(그중 t098 75). 교차 확인: 옛 시험 사본 × 새 훅 267/267 통과(기존 시나리오와 의미 충돌 없음 — 기존 시나리오 수정 0), 새 시험 × 옛 훅은 t098 67개 실패(새 절이 새 항목에 실제로 기댄다). 설치된 훅·`core.hooksPath`·실제 index 미접촉, 전체 스크립트 미실행.
- [22:46] 추가 시험: `t098-a1~a13.{1,2,3}`(항목별 판정 없음 차단/T-964 scope 통과(통과 문구 확인)/T-965 이웃 scope 차단 — registry 6·backtest 2·러너 2·시험 접두 2·isolation 1, 그중 g1-record.json·oos-locks/*.lock 은 P3 에도 아직 없는 경로) · `t098-b1~b3`(task ID 없음) · `t098-c1~c4`(신규 파일: 새 신호·registry v2·새 backtest- 시험) · `t098-v1~v8`(차용 방지: T-966 다른 안전 경로·T-995 safety/·T-969 T-093 scope·T-963 구현만 → 시험 차단, v8 은 대조군 통과) · `t098-n1~n4`(이웃 통과: 일봉 수집·P1 시험·격리 시험 변형·`backtest.test.ts`(무접두)·가짜 접두 `registry-x/`·`backtestx`·사후검증 본체·보유 리포트·.bak·xmjs·위치·리포트/동결 문서) · `t098-m1~m9`(혼합·합집합·원장+리포트·daily-bars+isolation) · `t098-g1~g8`(일회용 저장소 실 커밋). 새 fixture T-963~T-966(실행 중에만 존재, EXIT trap 으로 삭제 — 확인함).
- [22:46] 변이 시험(훅 사본 25종, 줄 삭제 6·`^` 삭제 6·`$` 삭제 3·끝 `/` 삭제 2·`\.` 누락 4·접두 `-` 삭제 1·확대 3): 1차 **24/25 사망**, 생존 1 = runner.mjs 의 `^` 삭제(n3 에 `foo/…/backtest-runner.mjs` 가 없었음) → n3 에 그 경로 추가 후 재실행 사망 → **25/25 사망**. 수정 뒤 전체 재실행 342/0.
- [22:46] 근거 주석의 근거(P3 소스 직접 읽음): runner-core 머리 주석 "원장·잠금·G1 을 git 커밋까지 같이 되돌리면 HEAD 대조도 통과한다 — SAFETY_PATHS 편입(사용자 결정)이 다음 방어선이다"(인용) · 같은 주석 "쓰는 파일은 … is-ledger.json·oos-ledger.json(추가 전용), oos-locks/*.lock(배타 생성)" · `PATHS.g1 = registry/g1-record.json`, "사용자 승인 뒤 Leader 만 만든다(이 러너는 쓰지 않는다)" · `buildEngine` 지문 = 엔진이 싣는 backtest/·registry/ .ts + 지표 소스의 sha256(러너 파일·JSON 제외), OOS 때 "IS 리포트의 엔진 지문이 현재와 다르다(IS 뒤 코드 변경)" 거부 · types.ts "DB·파일·네트워크·환경변수·시계를 쓰지 않는다" · costs.ts US 0.65%·KR 0.33% · fill.ts D+1 시가·갭·유동성 필터 · 신호 S1·S7 이 `@/lib/strategy/indicators/{rsi,sma,atr}` import(이미 `^src/lib/strategy/` 감시) · runner-core 가 `assertReadOnlySql` 을 `./postmortem-core.js` 에서 require · isolation.test.ts describe 6개(T-070 + T-096 확장) · `oos-locks` 는 .gitignore 에 없음(check-ignore rc=1) · backtest-registry/runner 시험 머리 주석·test 이름.
- [22:46] 판단·주의: ① 시험 절 머리는 지시의 `### T-098` 이 아니라 이 파일 관례(`echo "[T-098 — …]"`)를 따랐다. ② scope 는 '/' 로 끝나면 디렉토리, 아니면 파일 하나라 **접두 `…/__tests__/backtest-` 는 scope 로 못 쓴다** — T-096 Reviewer 판정 줄은 시험 파일을 하나씩 적어야 한다(T-965 fixture 가 이 오용을 고정). ③ `backtest-` 로 시작하지 않는 새 백테스트 시험(예 `backtest.test.ts`)은 안 걸린다(n1 이 고정, 주석에 명시). ④ isolation.test.ts 편입으로 일봉 수집·사후검증 격리 단언을 고치는 커밋도 판정이 필요해진다(알려진 영향, m8·m9).
- [22:46] 넣지 않은 후보(범위 밖, 주석에 기록): `scripts/profit-engine/postmortem-core.js`(러너의 DB 읽기 전용 2차 방어선 `assertReadOnlySql` 정의 — 다음 후보 1순위) · `signal-postmortem.mjs`·`holdings-*` · `daily-bars-*`(+시험)·`fake-bars-db.ts`·`signal-postmortem-core.test.ts` · 동결 문서·reports.
- [22:46] 확인 못 한 것: 일회용 저장소 외의 실 커밋(QA 몫), 메인 트리 설치 훅에서의 활성화(Leader 병합 뒤). Reviewer 판정 scope 제안: `scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh`(CLAUDE.md 는 훅 대상 아님).

## Reviewer

- [23:06] Reviewer(Sonnet) 독립 감사 착수 — 대상 worktree `~/.node-local/stockinvest-hook-t098`(브랜치 `hook-t098`, HEAD=base `a2d2d5a`, 미커밋·staged 0). 시작 sha256(앞 12자): 훅 `6ee909c2c796`·시험 `cce1e4af550b`·CLAUDE.md `cd6e1aad79bd` — Developer 기록과 일치, 끝날 때 다시 재도 같다. 메인 트리는 그 사이 4커밋 전진(HEAD `8683df8`)했지만 `git diff a2d2d5a main -- scripts/git-hooks scripts/test-git-hooks.sh CLAUDE.md` 가 비어 있어 내용 충돌은 없고, 메인 훅 sha `78d81c0197bf` = base 훅이다. worktree·메인 트리·P3 worktree 파일은 하나도 고치지 않았고(상태 재확인), 모든 실험은 스크래치패드 `t098r/` 의 `git archive a2d2d5a` 일회용 저장소와 사본으로만 했다. 전체 `test-git-hooks.sh` 는 실행하지 않았고 설치 훅·`core.hooksPath`·실제 index 는 건드리지 않았다. 아래는 Developer 보고를 믿지 않고 직접 읽고 실행한 것이다.
- [23:06] 확인 ① [확실] 훅 diff — 옛(`a2d2d5a`)·새 `diff` 의 삭제 줄 0, 추가 64줄 = 주석 58 + 배열 6. 비주석 6줄은 task 기록의 6개 정규식과 글자 단위로 일치하고 `mail/config.ts` 줄 바로 뒤·`api/orders/` 앞에 들어갔다(순서는 의미 없음). 두 훅에서 `SAFETY_PATHS` 블록을 추출해 `diff` 하면 6줄 추가뿐이고(67→73항목) 배열 뒤의 판정 로직(스테이징 읽기·grep rc 구분·task ID 추출·reviewer_body·verdict_of·scope_of·files_out_of_scope·다중 task 합집합)은 한 글자도 안 바뀌었다. 기존 항목 삭제·약화 0. 옛·새 훅 모두 `bash -n` 통과.
- [23:06] 확인 ② [확실] 전수 대조 표 — 훅과 같은 방식(배열을 `|` 로 결합 후 `LC_ALL=C grep -aE`; 훅 블록을 `source` 해 훅 루프 그대로 결합한 정규식과 내 정규식이 내용 동일함도 확인). ▷ 메인 `git ls-files` 1172개(HEAD `8683df8`): 옛 399 → 새 400, 새로 걸림 1(`src/lib/profit-engine/__tests__/isolation.test.ts`), 잃음 0 ▷ base `a2d2d5a` 추적 1169개: 옛 396 → 새 397, 새 1(같은 파일)·잃음 0 ▷ P3 worktree 추적 1167개: 396 → 397, 같은 1개·잃음 0 ▷ P3 미추적 33개: 옛 0 → 새 31(registry 7: evaluate-pass·hash·is-ledger.json·oos-ledger.json·oos-ledger.ts·preregistration.json·registry.ts / backtest 14 / 러너 2 / 시험 `backtest-` 접두 8 = 7개 `.test.ts` + `backtest-fixtures.ts`), 안 걸린 2개는 `agent-vault/10-Flow/reports/T-096-backtest-counts-US-20261026.{json,md}`(문서). Developer 수치(추적 1,169·새 1·잃음 0·미추적 31/33)와 일치한다. 메인 추적의 profit-engine 관련 21파일을 하나씩 분류한 결과 이웃 — `signal-postmortem-core.test.ts`·`daily-bars-*.ts`·`daily-bars-*.test.ts`·`fake-bars-db.ts`·`holdings-core.mjs`·`holdings-report.mjs`·`holdings-report.test.mjs`·`postmortem-core.js`·`signal-postmortem.mjs` — 은 전부 옛·새 모두 비매치(isolation.test.ts 만 새로 매치).
- [23:06] 확인 ② 경계 합성 시험 [확실] — 새 정규식으로 따로 28경로(걸림 7·비매치 21, 훅이 쓰는 GNU grep 으로 재확인): 걸림 = `registry/g1-record.json`·`registry/oos-locks/a.lock`(아직 없는 경로도 디렉토리라 걸림)·`backtest/signals/s.ts`·러너 2개 정확 이름·`__tests__/backtest-x.test.ts`·`isolation.test.ts`. 비매치 = `registry`(슬래시 없는 파일 이름)·`registry-x/`·`registryx.ts`·`backtest.ts`·`backtestx/`·`backtest-runner.mjs.bak`·`.mjsx`·`backtest-runnerxmjs`·`backtest-runner-core.jsx`·`.json`·`backtest-runnerXcore.js`·`sub/backtest-runner.mjs`·`foo/scripts/...`·`__tests__/backtest.test.ts`·`backtestx.test.ts`·`Backtest-x.test.ts`·`__tests__/sub/backtest-x.ts`·`isolation.test.tsx`·`isolationXtest.ts`·`isolation-extra.test.ts`·`profit-engine/isolation.test.ts`(위치 다름). 앵커·`$`·`\.`·끝 `/` 모두 의도대로다.
- [23:06] 확인 ③ [확실, 훅 코드 직접 읽음] scope 의미 — `files_out_of_scope()` 는 scope 항목이 `/` 로 끝나면 `case "$f" in "$s"*`(디렉토리 접두), 아니면 `[ "$f" = "$s" ]`(정확 일치)뿐이다. 글롭·접두 문자열 해석은 없다. 따라서 `…/__tests__/backtest-` 는 scope 로 쓸 수 없고 시험 파일을 하나씩 적어야 한다는 훅 근거 주석 마지막 줄·Developer 판단 ②·`t098-a11/a12.3`(T-965 scope 에 접두 항목을 적어도 `backtest-runner.test.ts`·`backtest-fixtures.ts` 차단)은 훅 동작과 일치한다. 차용 방지(시험 쪽): `t098-v1~v8` 이 다른 안전 경로(strategy/·signals/·api/strategies·migrations·git-hooks·broker-ledger)·T-093 scope·구현만 검토한 scope 로 새 경로를 열려는 시도 전부 차단(대조군 v8 만 통과)하고 342/0 에 포함된다. 단 아래 F6 — 기존 task 판정 중 이미 새 경로를 덮는 것이 있다.
- [23:06] 확인 ④ [확실, P3 worktree `stockinvest-p3s1` 소스를 직접 읽음, 읽은 시각 22:54~23:03] 근거 주석 중 맞는 서술 — registry: `preregistration.json` 키(`document.section_b_sha256`·markets·universe·benchmarks·splits·costs·criteria·strategies 격자)·`hash.ts`(§B 추출·검증, `registry-numeric-sha256:` 마커 대조)·`registry.ts`(`validateRegistry`·`expandGrid`·`checkEngineConstants`)·`evaluate-pass.ts`("수치는 전부 registry.criteria 에서 읽는다" 머리 주석)·`oos-ledger.ts`(전략×시장 1회·결과 한 번만 채움)·두 원장 `entries: []`(현재). backtest: S1=`rsi-oversold-daily`·S7=`control-spike-contraction`(대조군)·`fill.ts` D+1 시가·갭·유동성 필터·`pipeline.ts`·`index.ts` 가 러너의 `ENGINE_ENTRY`·`types.ts` 머리 주석의 "DB·파일·네트워크·환경변수·시계를 쓰지 않는다"·엔진이 실제로 부르는 지표는 rsi·sma·atr 3개(허용 목록은 5개). 러너: `PATHS.g1`=`registry/g1-record.json`(러너는 쓰지 않음, 승인 진위 검증 불가가 머리 주석 한계 ①)·`oos-locks/<시장>-<전략>.lock` 을 `wx` 로 배타 생성(`.gitignore` 에 없음 — `git check-ignore` rc=1)·`--unlock-oos <§B sha256>`·IS 재계산 대조·관문이 DB 접속 전·읽기 전용 SQL 이중 방어(`SET SESSION TRANSACTION READ ONLY`+`assertReadOnlySql`, 후자는 `postmortem-core.js` 에서 require)·엔진 로더 허용 목록이 isolation 시험과 일치. 시험: `backtest-registry.test.ts`(§B 해시 문서 재계산·registry↔§B 대조)·`backtest-runner.test.ts`(우회 1~12 표: 수치 완화·`--as-of`·원장 되돌리기·동시 OOS·G1 위조·counts 가 수익 경로 미호출)·`backtest-*.test.ts` 7개+fixtures 1개·`isolation.test.ts` describe 6개(메인 추적본은 4개 — P3 가 2개 추가). `isolation.test.ts` 편입이 메인에 이미 있는 일봉 수집·사후검증의 격리 단언(describe '수동 수집 라우트'·'사후검증 스크립트 — 읽기 전용')을 고치는 커밋도 판정 대상으로 만든다는 서술은 메인 추적본의 describe 4개로 확인했다.
- [23:06] 발견 F1 [MEDIUM — 주석 사실 오류, 조건 1] 훅 491~492행("러너의 엔진 지문(엔진이 싣는 backtest/·registry/ 의 .ts 와 지표 소스의 sha256)은 IS 뒤 OOS 전 변경만 거부하고, IS 전 변경은 못 잡는다")과 498행("러너 파일은 엔진 지문에 들어가지 않으므로 그 변경을 기록하는 장치는 이 훅뿐이다")은 **지금 P3 코드와 어긋난다.** [확실] `backtest-runner-core.js:658~662` 의 `ENGINE_FINGERPRINT_EXTRA` 가 `backtest-runner.mjs`·`backtest-runner-core.js`·`postmortem-core.js` 의 바이트를 엔진 지문에 넣고(`buildEngine` 669~727행, 지문 합산은 700행), 머리 주석 20~21행도 같은 서술이며, G1 결속 때문에 G1 뒤 엔진·러너 변경은 IS 시점에도 거부된다(`g1Errors` 136·144행; 시험 `R2-C2(a)` 834·845행, `R2-C2(b)` 497행). 즉 (a) 지문은 "IS 뒤 OOS 전"만이 아니라 G1 뒤 전부를 거부하고 (b) 러너 파일 2개와 `postmortem-core.js` 는 이미 지문 안이다. 같은 task 의 진행 기록("postmortem-core.js 는 R2-C2 로 엔진 지문에 들어가 변경이 지문·G1 결속으로 거부됨")과도 훅 주석이 모순이다. P3 가 아직 바뀌는 중이라 이런 세부는 앞으로도 어긋날 수 있다. 조건 1: 훅의 이 두 서술을 지우고 변하지 않는 서술로 바꾼다 — 예: "엔진 지문이 무엇을 덮는지는 `backtest-runner-core.js` 의 `buildEngine`·`ENGINE_FINGERPRINT_EXTRA` 가 정본이다(여기에 복제하지 않는다). 지문·G1 기록은 에이전트가 다시 계산·작성할 수 있어(counts 재실행+새 G1 기록) 독립 감사 기록을 대신하지 못한다 — 그 기록을 강제하는 것이 이 편입이다". 같은 취지로 "넣지 않은 것"의 `postmortem-core.js`("러너의 DB 읽기 전용 2차 방어선이 훅 밖에 있다 — 다음 후보 1순위")에도 "엔진 지문에는 들어 있다"를 한 구절 덧붙여 task 기록과 맞춘다.
- [23:06] 발견 F2 [MEDIUM — 주석 사실 오류, 조건 2] 훅 490~491행 "비용 상수 하나·체결 규칙 하나만 바뀌어도 registry 를 건드리지 않고 합격 판정이 바뀐다"와 같은 블록의 "비용(costs.ts — US 왕복 0.65%·KR 0.33%)". [확실] `costs.ts` 에는 상수가 없고 `roundTrip`·`stopCost`·`scaleSlippage` 계산식뿐이며 0.65%·0.33% 는 머리 주석 서술이다. 실제 수치는 `preregistration.json` 의 `costs`(US 수수료 0.005+슬리피지 0.0015=0.65%, KR 0.0018+0.0015=0.33%, 손절 슬리피지 0.0025)에 있어 §B 해시·H_r 이 이미 고정하고 `registry/` 항목이 이미 감시한다. 그러므로 "비용 상수가 바뀌면 registry 를 건드리지 않는다"는 거짓이고, 참인 것은 체결 규칙(`fill.ts`)·비용 계산식 코드가 바뀌는 경우다. 조건 2: "비용 상수"를 "비용 계산식(costs.ts)·체결 규칙(fill.ts) 코드"로 고치고 비용 수치는 registry `costs` 가 담는다고 적는다(US 0.65%·KR 0.33% 는 registry 출처 표기).
- [23:06] 발견 F3 [LOW] 훅 470~471행은 러너 머리 주석을 따옴표로 인용("원장·잠금·G1 을 git 커밋까지 같이 되돌리면 HEAD 대조도 통과한다 — SAFETY_PATHS 편입(사용자 결정)이 다음 방어선이다")하지만 지금 머리 주석(23~28행)은 한계 ②③으로 다시 쓰였고 마지막 문장도 "…·결정일 보고에 원장·git 이력 첨부가 다음 방어선이다"로 달라 글자 그대로의 인용이 아니다(뜻은 유지). 또 470·496행의 `git show HEAD:<원장>` 은 지금 구현이 아니다 — R2-C1 로 `makeGitIo` 가 `rev-parse`·`ls-tree`·`cat-file` 로 읽고 git 실패는 거부(fail-closed)한다(`backtest-runner.mjs` 17~18행). 따옴표를 빼고 의역하거나 "러너 머리 주석의 한계 항목 참조"로 바꾸고 `git show` 는 "git 의 HEAD 본"으로 쓰면 낡지 않는다.
- [23:06] 발견 F4 [LOW] 훅 주석의 시점 스냅샷 수치가 앞으로 어긋날 수 있다: "현재 entries 0건"(480행)·"backtest-*.test.ts 7개"(499행)·"코드 31개·리포트 2개"(511~512행). 지금은 모두 맞다(직접 확인). 판정에 쓰이는 정보가 아니므로 빼거나 날짜를 붙이는 쪽을 권한다(비차단).
- [23:06] 발견 F5 [LOW — 문서 완전성, 비차단] 이 편입이 막지 못하는 것이 새 주석 블록에는 적혀 있지 않다. "막는 장치가 아니라 독립 감사 기록을 강제하는 장치다"는 과장이 아니지만("속이면 들킨다"는 사람이 기록을 읽을 때만 성립), 훅은 판정을 누가 썼는지 검증하지 못하고(self-attestation), 커밋하지 않고 하는 실행·`--no-verify`·훅 shim 비활성·저장소 복사본/별도 worktree 에서 러너를 돌리는 것(러너 머리 주석 한계 ②③)은 못 본다. CLAUDE.md 새 문장도 과장은 없고 바로 아래 「이 훅이 보증하지 않는 것」 절이 일반 한계를 이미 적는다. 주석 한 구절("한계: 판정 작성자 미검증·미커밋 실행·`--no-verify`·복사본 실행은 이 훅이 못 본다 — CLAUDE.md '이 훅이 보증하지 않는 것' 참조")이면 충분하다.
- [23:06] 발견 F6 [MEDIUM — 절차·차용 표면, 비차단이지만 Leader 가 알아야 함] 기존 task 의 마지막 판정 scope 가 새 경로를 이미 덮는다. 훅의 `reviewer_body`·`verdict_line`·`verdict_of`·`scope_of`·scope 매칭 함수를 그대로 옮겨 메인 `agent-vault/10-Flow/tasks/T-*.md` 전부에 적용한 결과 새 경로를 덮는 것은 정확히 둘이다. (a) `T-070`(conditional pass, scope 에 디렉토리 `src/lib/profit-engine/` 포함) — registry/·backtest/·`__tests__/backtest-*`·`isolation.test.ts` 를 덮는다(러너 2개는 안 덮음). 그래서 P3 코드를 커밋하면서 메시지에 `T-070` 만 적어도 훅이 통과시킨다(CLAUDE.md 가 금지하는 "차용된 정당성"이며 `related_tasks` 습관으로 악의 없이도 생긴다). (b) `T-096`(21:41, conditional pass)의 scope 는 P3 감시 대상 32개(미추적 31 + `isolation.test.ts`) **전부를 정확히 덮는다**(훅 읽기 형식 확인 — task 지침의 "판정 줄 scope 는 훅이 읽는 형식" 요건은 이미 충족). 그런데 그 판정은 1라운드 것이고 P3 코드는 그 뒤 R2-C1~C3 로 계속 바뀌는 중이다. 훅은 판정의 낡음을 알 수 없으므로 P3 를 커밋할 때 T-096 의 새 라운드 판정 줄이 마지막에 오지 않으면 낡은 1라운드 conditional pass 로 통과한다. 이번 변경이 만든 문제는 아니고 훅의 구조적 한계다. 권고(Leader): P3 커밋 전에 T-096 Reviewer 섹션의 마지막 판정 줄이 R2 이후 재감사 결과인지 확인하고, 커밋 메시지는 T-096 만 인용한다(T-070 인용 금지). T-070 의 `src/lib/profit-engine/` 디렉토리 scope 를 좁히는 것은 과거 기록 수정이라 권하지 않는다.
- [23:06] 관찰 F7 [INFO] 시험 fixture a6 의 잠금 파일 경로 `registry/oos-locks/rsi-oversold-daily-US.lock` 은 러너의 실제 이름 `<시장>-<전략>.lock`(`US-rsi-oversold-daily.lock`, `lockRel`)과 순서가 반대다. 디렉토리 항목이라 판정에는 영향이 없다(cosmetic). F8 [INFO] CLAUDE.md 「경계 판단 두 가지만 여기 남긴다」 문구는 T-093 이후 이미 불릿 3개였고 이번에 4개가 됐다(드리프트는 이전부터이며 T-098 문장 자체는 옳다). F9 [INFO] CLAUDE.md 새 문장의 "같은 폴더의 일봉 수집(`daily-bars-*`)·사후검증 스크립트" 는 실제로 `src/lib/profit-engine/` 와 `scripts/profit-engine/` 두 폴더다(느슨한 표현, 거짓 아님). F10 [INFO] 병합: 메인이 4커밋 앞서 있어 `hook-t098` 으로의 ff 는 불가하다(훅·시험·CLAUDE.md 는 겹치지 않아 충돌 없음) — T-093 때와 같이 worktree 에서 커밋한 뒤 일반 병합/rebase 하거나 승인된 3파일만 메인에서 명시 stage 해 같은 판정으로 커밋한다.
- [23:06] 확인 ⑤ [확실] 시험 스크립트 — 옛·새 `diff`: 기존 줄 변경은 머리 주석 13행·말미 echo 1행(fixture 범위 `T-967~969`→`T-963~969`)뿐이고 나머지는 1335~1583행 249줄 추가다. 추가분은 `[E2E]` 마커(1595행) 앞 로직 단계 안(결과 요약 바로 앞)이고, 추가 줄에서 `git`/`rm`/`mv`/`cp`/`chmod`/`install-git-hooks`/`--no-verify`/`core.hooksPath` 를 직접 쓰는 곳이 0(주석·문자열 제외 검색)이다 — 새 실 커밋 시험 g1~g8 은 기존 T-090 절의 일회용 `E2E_REPO`(`$WORK` 아래 mktemp)·`e2e_git`·`e2e_commit` 만 쓰고, shim 은 이 작업 트리의 훅을 가리킨다. 새 fixture T-963~T-966 은 모두 `FIXTURES+=` 에 등록돼 EXIT trap 으로 지워지고(스크래치 저장소에서 4회 실행 뒤 `hooktest` 파일 0개 확인) 실제 task 번호와도 겹치지 않는다(`T-96[3-6]*`·`T-97~99*` 파일 없음). 기존 시나리오 수정 0: 옛 시험(`# [E2E]` 앞 1344행까지 자른 사본) × 새 훅 = **267/267 통과**(기존 의미 충돌 없음).
- [23:06] 시험 실행 [확실] — `# [E2E]` 앞까지 자른 사본(새 1593행·옛 1344행)을 스크래치 저장소에서 실행: 새 시험 × 새 훅 **342 통과 / 0 실패**(그중 t098 75, Developer 보고와 같음) · 옛 시험 × 새 훅 **267/0** · 옛 시험 × 옛 훅 267/0(대조군) · 새 시험 × 옛 훅 **275 통과 / 67 실패** — 실패 67은 전부 `t098-` 라벨이고(비 t098 실패 0, 나머지 줄 1은 "실패 케이스가 있습니다" 요약 문구), 옛 훅에서도 통과하는 t098 8개는 새 항목에 기대지 않는 것(n1~n4 이웃 통과·m1·m2·m4·g8)이다. 즉 새 시험의 67개가 실제로 새 6줄에 기댄다.
- [23:06] 확인 ⑥ [확실] 변이 시험(독립, 새 훅 사본 29종, 변이마다 변이 후 `bash -n` 통과·원본 대비 diff 1~2줄 확인, 새 시험 사본×변이 훅을 6개 일회용 사본에서 병렬 실행). 결과: **29종 전부 잡힘, 생존 0.** ▷ 줄 삭제 6종: registry/ 28실패·backtest/ 9·`backtest-` 접두 11·isolation 8·러너 core 5·러너 mjs 3 ▷ `^` 삭제 6종(항목마다): 각 1실패 — registry·backtest/ 는 `t098-n2`(foo/·mockups/ 위치), 접두·isolation 은 `n1`, 러너 둘은 `n3` ▷ `$` 삭제 3종(mjs·core·isolation): 각 1실패(n3·n3·n1) ▷ 끝 `/` 삭제 2종: backtest/ 1(n2)·registry/ 2(n2·g8) ▷ `\.` 누락 5종(mjs·core·isolation 전부·`\.ts` 만·`\.test` 만): 각 1실패(n3·n3·n1·n1·n1) ▷ 범위 확대 7종: `backtest-`→`backtest`(n1)·→`__tests__/`(n1)·러너 mjs→`scripts/profit-engine/`(n3·g8)·registry→`src/lib/profit-engine/`(n1·n2·m9·g8)·isolation `$`·`\.test\.ts` 제거(n1)·backtest/ 의 `^` 제거(n2)·core→`backtest-runner.*\.js$`(n3). 주석 처리·정규식 단순화 같은 의미 동치 변이는 제외했다. Developer 25종 보고와 같은 결론이다. 참고: `^`·`$`·`\.` 변이는 항목마다 이웃 시험 한 묶음(n1~n3)이 혼자 잡는 구조라 그 묶음에서 이웃 경로를 빼면 구멍이 생기지만, 지금 묶음은 항목마다 변형 경로를 갖고 있다(LOW 이하, 조건 아님).
- [23:06] 확인 ⑦ [확실] CLAUDE.md — `git diff` 는 1줄 추가(「커밋 안전장치」 경계 판단 불릿 끝, 180행 뒤)뿐이고 다른 줄은 한 글자도 안 바뀌었다. `AGENTS.md` 는 변경 없음(`git status`·`git diff` 에 없음 — 생성 미러). 새 문장 사실성: 6개 항목의 대분류(등록 수치·IS/OOS 원장·G1 기록·해시/판정 코드 / 엔진·신호 / 러너 2개 정확 일치 / 시험 `backtest-*` / 격리 시험 `isolation.test.ts`)·"러너 실행으로 갱신된 원장을 커밋할 때도 Reviewer 판정 줄이 필요"(`is`→is-ledger·`oos`→oos-ledger 갱신, 훅은 추가 전용 여부를 구분하지 않음)·`daily-bars-*`·`postmortem-core.js`·`signal-postmortem.mjs`·`holdings-*` 비감시 모두 훅·전수 대조와 일치한다. 「2026-10-26부터」는 병합되는 순간 참이 된다(T-093 때와 같은 시점 주의 — 병합 전에는 훅이 아직 이 경로를 걸지 않는다). CLAUDE.md 는 훅 대상 경로가 아니라(`^CLAUDE\.md` 항목 없음, 훅 목록 확인) 이 감사의 scope 에 넣지 않는다.
- [23:06] 확인 ⑧ [확실] 보호 한계 서술 — 훅 주석은 "막는 장치가 아니라 독립 감사 기록을 강제하는 장치"로 쓰고 "훅은 변경이 추가만인지 구분하지 않는다(그 대조는 러너의 HEAD 접두 검사가 한다)"고 한계를 밝혀 과장이 없다. CLAUDE.md 문장도 "의도된 마찰 — 원장 변경마다 감사 기록이 남게 한다"로 같은 수준이다. 못 막는 것(작성자 미검증·미커밋 실행·`--no-verify`·shim 비활성·저장소 복사본 실행)은 F5 대로 새 블록엔 없고 CLAUDE.md 일반 절에 있다. 판정 줄 형식 검증: 일회용 사본에서 이번 판정 줄과 같은 형식(`scope: scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh`)으로 staged `commit-msg`·`test-git-hooks.sh`·`CLAUDE.md`·task 파일을 새 훅에 넣으면 "Reviewer 감사 기록 확인" 통과, 시험 스크립트를 scope 에서 빼면 차단됨을 확인했다.
- [23:06] 확인하지 못한 것 — ① 전체 `scripts/test-git-hooks.sh` 의 `# [E2E]` 단계(설치된 훅·실제 index 접촉, 지침상 미실행)와 병합 뒤 설치된 shim 경유 동작·QA 의 일회용 저장소 실 커밋 ② 근거 주석이 P3 의 "지금" 소스를 읽은 시각(22:54~23:03) 이후의 변경 — P3 Developer 가 계속 고치는 중이라 F1 은 그 시점 기준이다 ③ 메인 트리에서 설치된 훅이 T-098 병합 전에는 새 경로를 걸지 않는다는 점(병합 직후 확인 필요) ④ judge C2·Codex 결과 ⑤ 대소문자 구분 없는 파일시스템 [추측: 리눅스 운영이라 영향 낮음].
- [23:06] 심각도 합계 — critical 0 · high 0 · medium 3(F1·F2 주석 사실 오류 = 조건, F6 절차·차용 표면 = 조건 아님) · low 3(F3·F4·F5, 조건 아님) · info 4(F7~F10). 훅 판정 로직 변경 0·6줄 정규식(옛/새 전수 대조·경계 28경로·변이 29종 전부 사망)·시험 342/0·267/0·기존 시나리오 수정 0·CLAUDE.md 1줄·AGENTS.md 불변에는 결함이 없다. reviewer.md 의 기계적 기준만 보면 pass(critical 0·high 0)지만, F1·F2 는 T-090·T-092·T-093 에서 매번 조건을 걸었던 유형(코드 사실과 어긋난 주석)의 재발이고 F1 은 Leader 가 미리 지목한 "곧 바뀔 수 있는 세부" 단정이라 조건부로 한다.
- [23:06] 조건(커밋 전, 훅 파일의 **주석 줄만** 수정) — 조건 1 = F1(엔진 지문 서술 2곳 삭제·변하지 않는 서술로 교체 + `postmortem-core.js` 후보 항목에 "지문에는 포함" 한 구절), 조건 2 = F2("비용 상수"→"비용 계산식·체결 규칙 코드", 비용 수치는 registry `costs`). 권고(조건 아님) = F3 인용·`git show` 표현 정리, F4 스냅샷 수치 제거, F5 한계 한 구절. 수정 뒤 재감사에서는 ⓐ 변경이 `#` 주석 줄뿐인지(주석 제외 `diff` 가 배열 6줄만 남는지) ⓑ 시험 스크립트·CLAUDE.md sha 불변 ⓒ 로직 단계 사본 342/0·267/0 만 다시 보면 된다. 이 판정 줄은 위 조건이 해소되고 Reviewer 가 재확인하기 전에는 커밋 근거로 쓰지 않는다 — 훅은 판정 줄의 조건을 읽지 못하므로 Leader 가 조건 미해소 상태의 커밋을 막아야 한다. 병합은 F10 의 방법으로 하고, P3 커밋 전 F6 확인.
- [23:06] **최종 판정: CONDITIONAL_PASS (scope: scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh)** — 사유: 훅 로직·6줄 항목·시험은 결함 없음, 근거 주석 사실 오류 2건(F1·F2)을 주석 줄만 고친 뒤 재감사한 다음에 커밋
- [23:23] 재감사(2차) 착수 — Leader 요청, 같은 worktree(HEAD `a2d2d5a`, 미커밋). 지금 상태 [확실]: sha256 훅 `56701c0ce39b`(1차 `6ee909c2c796` 에서 바뀜)·시험 `cce1e4af550b`(1차와 동일 = 불변)·CLAUDE.md `c57bd9ecf8d6`(1차 `cd6e1aad79bd` 에서 바뀜) — Leader 가 알린 값과 일치. 수정 직전 사본 `scratchpad/t098/commit-msg.before-r1` 의 sha 는 내 1차 감사본과 같은 `6ee909c2c796` 이다. 이번에도 worktree·메인 트리·P3 worktree 파일은 고치지 않았고(끝에 sha·status 재확인) 실험은 스크래치패드 `t098r/` 의 사본·일회용 저장소로만 했다. 전체 `test-git-hooks.sh` 는 실행하지 않았다. 아래 bullet 은 Developer·Leader 기록을 믿지 않고 새로 확인한 것이다.
- [23:23] 재확인 ① [확실] 훅 — base(`a2d2d5a`) 대비 삭제 줄 0, `git diff --numstat` 추가 57줄 = 주석 51 + 배열 6(1차는 64 = 58 + 6). 주석 줄(`#`)을 뺀 추가는 배열 6줄 — `^src/lib/profit-engine/registry/`·`…/backtest/`·`…/backtest-runner\.mjs$`·`…/backtest-runner-core\.js$`·`__tests__/backtest-`·`__tests__/isolation\.test\.ts$` — 뿐이다. 수정 직전 사본(`before-r1`)과 새 훅의 `#` 줄을 뺀 텍스트는 `diff` 가 비어 있다(비주석 차이 0). `SAFETY_PATHS` 블록은 1차 감사본과 `cmp` 로 바이트 동일하다. `bash -n` 통과. 판정 로직·배열은 1차와 같다.
- [23:23] 재확인 ② [확실, P3 소스 재대조] 조건 1(F1) 해소 — 지문 범위 서술 두 곳("IS 뒤 OOS 전 변경만 거부"·"러너 파일은 엔진 지문에 들어가지 않으므로 이 훅뿐")이 사라지고 훅 471행이 "엔진 지문·G1 결속·원장 대조의 구체 범위는 코드가 정본이라 여기에 복제하지 않는다"·"지문·G1·원장은 에이전트가 다시 계산·작성할 수 있어 독립 감사를 대신하지 못한다"로 바뀌었다. 뒤 문장은 사실이다 — 러너 머리 주석 한계 ①(승인 필드 진위 검증 불가)·②(원장·잠금·G1 을 커밋까지 되돌리면 HEAD 대조 통과), 지문은 counts 재실행+새 G1 기록으로 다시 맞출 수 있음. 조건 2(F2) 해소 — 488~490행이 "비용 계산식(costs.ts)·체결 규칙 코드가 바뀌면 registry 수치를 건드리지 않고도 합격 판정이 바뀐다 — 비용 **수치**는 registry(preregistration.json) 출처이고 위 registry/ 항목이 감시한다"로 고쳐졌고 `preregistration.json` 의 `costs`(US 0.005+0.0015·KR 0.0018+0.0015·손절 0.0025)와 `costs.ts`(계산식뿐)로 사실임을 다시 확인했다. 나머지 수정 서술도 지금 코드와 대조했다: 러너 머리 주석이 같은 한계를 적고 이 편입을 다음 방어선으로 든다(P3 `backtest-runner-core.js` 머리 주석 24~28행) · `preregistration.json` 키(판정 시장·유니버스·구간·합격 기준·비용·전략 격자·§B 해시)·`hash.ts`·`registry.ts`·`evaluate-pass.ts`("수치는 registry 에서 읽는다")·`oos-ledger.ts`·원장 JSON · `g1-record.json`(사용자 승인 뒤 Leader 가 만들고 러너는 쓰지 않음)·`oos-locks/`(러너가 OOS 때 배타 생성) · "원장 JSON 이 (추가 전용으로) 갱신된다"(is→is-ledger, oos→oos-ledger) · 러너 core 의 관문(§B 해시·H_r·G1·`--as-of`=등록 기준일·원장 대조·OOS 1회 잠금·IS 재계산 대조)과 `.mjs` 의 읽기 전용 세션·원장 읽기·엔진 로더 연결 · 시험 서술(registry 시험의 §B 재계산·§B 대조, 러너 시험의 우회 시나리오 거부 — `backtest-registry.test.ts` 21·47행 describe, `backtest-runner.test.ts` 우회 1·2·6·7·8) · isolation 서술(엔진은 거래소·자격증명·DB 미사용·허용 지표 경로만, 러너 읽기 전용, 일봉 수집·사후검증 격리 단언도 담음) · 데이터 지문(`runPhase` 558~560행의 G1 데이터·유니버스 지문 대조). 모두 맞다. P3 코드 파일(core·mjs·registry·backtest·시험)은 내가 처음 읽은 22:50 이후 한 번도 안 바뀌었다(`find -newermt` 0건·core/mjs/registry JSON sha 불변); 그 뒤 P3 에서 바뀐 것은 T-096 task 문서 하나(23:19)뿐이다.
- [23:23] 재확인 ③ [확실] F3~F5 반영 — F3: 따옴표 인용 제거(훅 469~472행은 "러너 머리 주석이 같은 한계를 적고…"로 의역)·`git show HEAD:` 두 곳 제거("원장을 git HEAD 와 대조"). F4: "현재 entries 0건"·"backtest-*.test.ts 7개"·"코드 31개·리포트 2개"·"base e2a7206" 모두 사라졌고 주석 블록 안의 건수·퍼센트는 구조 표기 "(정확 일치 2줄)" 하나뿐이다(검색 확인). 474~475행이 "바뀌기 쉬운 세부 — 건수·파일 수·지문 범위·수치 — 는 적지 않았다"고 밝히고 503~504행은 "대조(편입 시점…)"로 시점을 붙였다. F5: 515~516행에 "이 편입이 막지 못하는 것: 미커밋 작업 트리에서의 러너 실행, `git commit --no-verify`, 훅 shim 비활성(설치 누락), 저장소 복사본에서의 실행, 판정 작성자 미검증(self-attestation — 위 커밋 안전장치 일반 한계와 같다)"이 추가됐다. 사실이고(러너 머리 주석 한계 ③·훅 머리 39~49행의 self-attestation 항목과 대응) 과장이 없다. 503~504행 "P3 의 미커밋 코드는 전부 걸린다"는 지금도 맞다(P3 변경·미추적 35개 중 코드는 전부 매치하고 안 걸리는 것은 문서 3개 — 리포트 2·task 문서 1).
- [23:23] 남은 지적 N1 [LOW — 비차단, 조건 아님] 훅 506~507행 postmortem-core.js 항목의 "엔진 지문에는 포함되어 지문 변경으로 거부되지만"은 지문 범위를 단정한다 — 474행의 "지문 범위는 적지 않았다"와 어긋나는 한 구절이다. 지금은 사실이고(`ENGINE_FINGERPRINT_EXTRA` 658~662행에 3파일, 시험 `R2-C2(a)` 가 그 범위를 고정) 이 문장은 내가 F1 에서 제안한 표현이지만, 앞으로 범위가 바뀌면 낡는다. 선택 사항: "엔진 지문 대상 여부는 코드가 정본이지만 그 변경의 커밋 자체는 훅 밖이다"로 낮추면 474행 원칙과 맞는다. N2 [INFO] 러너 줄의 관문 나열(해시·G1·기준일·원장 대조·1회 잠금·재계산 대조)은 구현 세부 수준이나 사전 등록 §D 의 설계 관문이라 낡을 가능성이 낮고 지금 전부 맞다. 그 외 1차의 F6(차용·낡은 판정)은 Leader 가 T-098 문서에 운용 규칙으로 기록했다고 해서 이번 판정과 별개로 둔다 — 훅이 막지 못하는 구조적 한계는 그대로다.
- [23:23] 재확인 ④ [확실] CLAUDE.md — base 대비 `git diff --numstat` 는 +1/−0, 1줄 추가(「커밋 안전장치」 경계 판단 불릿 끝)뿐이고 다른 줄은 한 글자도 안 바뀌었다. 1차에 감사한 그 줄과 비교하면 바뀐 곳은 구절 하나다 — 새 구절 "같은 이름의 폴더(`src/lib/profit-engine/`·`scripts/profit-engine/`)에 있는 일봉 수집"을 옛 구절 "같은 폴더의 일봉 수집"으로 되돌리면 1차 줄과 글자 단위로 같다(스크립트로 확인). 새 구절은 사실이다 — `daily-bars-*` 는 `src/lib/profit-engine/`, `postmortem-core.js`·`signal-postmortem.mjs`·`holdings-*` 는 `scripts/profit-engine/` 에 있다(`git ls-files`). F9 가 해소된다. `AGENTS.md` 변경 없음. CLAUDE.md 는 훅 대상이 아니라 scope 에 넣지 않는다.
- [23:23] 재확인 ⑤ [확실] 시험·변이 — 시험 스크립트 sha `cce1e4af550b` 불변(1차 감사본과 `cmp` 동일; `# [E2E]` 앞으로 자른 사본도 1차 사본과 `cmp` 동일). 스크래치 일회용 저장소에서 새 훅으로 직접 실행: 새 시험 × 새 훅 **342 통과 / 0 실패**(t098 75, 실패 표식 0) · 옛 시험(1344행까지) × 새 훅 **267/0**, 실행 뒤 `hooktest` fixture 파일 0개. 변이: 배열·비주석이 1차와 같으므로 1차 29종 결과는 그대로 유효하다고 판단했고, 그래도 새 훅(주석 수정본)에서 29종을 다시 만들어(변이마다 `bash -n` 통과·원본 대비 diff 1~2줄·비주석 텍스트가 1차 변이와 동일함을 `cmp` 로 확인) 새 시험으로 전부 다시 돌렸다 — **29종 전부 잡힘, 생존 0**, 변이별 실패 수 29줄이 1차 결과와 `diff` 0(줄 삭제 registry 28·backtest/ 9·접두 11·isolation 8·core 5·mjs 3, `^`·`$`·`\.` 변이 각 1, 끝 `/` 1~2, 범위 확대 1~4).
- [23:23] 확인하지 못한 것 — ① 전체 `scripts/test-git-hooks.sh` 의 `# [E2E]` 단계(설치된 훅·실제 index 접촉, 지침상 미실행)와 병합 뒤 설치된 shim 경유 동작·QA 의 일회용 저장소 실 커밋 ② 이 재감사 이후의 P3 변경(코드가 계속 보완되는 중이면 주석의 구조 서술은 유지되지만 N1 같은 범위 단정은 낡을 수 있다) ③ 메인 트리에서 설치된 훅이 병합 전에는 새 경로를 걸지 않는다는 점 ④ judge C2·Codex 결과 ⑤ 대소문자 구분 없는 파일시스템 [추측: 영향 낮음].
- [23:23] 심각도 합계 — critical 0 · high 0 · medium 0 · low 1(N1, 조건 아님) · info 1(N2). 1차의 조건 1(F1)·조건 2(F2)는 해소됐고 F3~F5·F9 도 반영됐다(1차 F6·F7·F8·F10 은 이번 변경 범위 밖). 훅 판정 로직·배열 6줄·시험 스크립트·CLAUDE.md 1줄에 결함이 없고 새 훅 342/0·267/0·변이 29/29 사망을 직접 확인했다. 병합은 1차 F10 의 방법(worktree 에서 커밋 후 일반 병합/rebase, 또는 승인된 3파일을 메인에서 명시 stage)으로 하고 P3 커밋은 T-096 만 인용한다.
- [23:23] **최종 판정: PASS (scope: scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh)**

## QA

- [23:32] **QA 실행 검증(Haiku, 직접 실행)** — 일회용 저장소·사본에서만, 전체 스크립트·`# [E2E]` 단계·설치된 훅은 건드리지 않음. 항목1 worktree 3파일 sha256 앞12자(`56701c0ce39b`·`cce1e4af550b`·`c57bd9ecf8d6`) 일치·`bash -n` 통과 pass · 항목2 메인 HEAD `8683df8` 의 `git archive` 사본에 3파일 diff `git apply --check` 통과·적용 뒤 sha256 일치 pass · 항목3 로직 시험 사본 — 새 시험×새 훅 **342 통과/0 실패**(t098 75), 옛 시험×새 훅 267/0, 옛×옛 267/0, 새 시험×옛 훅 275 통과/**67 실패(전부 t098 라벨)**, fixture 잔존 0 pass · 항목4 일회용 저장소 실 커밋 8시나리오(새 훅/옛 훅 대조군) — ① 판정 없음 차단/통과 ② PASS+scope 일치 통과/통과 ③ scope 가 `__tests__/backtest-` 접두 문자열뿐 → 차단/통과 ④ 마지막 FAIL 차단/통과 ⑤ 이웃만(daily-bars·postmortem-core) 통과/통과 ⑥ 이웃+`backtest/fill.ts` 차단/통과 ⑦ scope `src/lib/profit-engine/` 디렉토리 하나 PASS → 통과(Reviewer F6 차용 한계 그대로 재현) ⑧ task ID 없음 차단/통과 pass · 항목5 기존 안전 경로(`src/lib/safety/`) 판정 새·옛 훅 동일(차단·통과 둘 다 같음) pass.
- [23:32] QA 가 확인하지 못한 것: `# [E2E]` 단계(실제 index·설치된 훅), 설치된 훅 파일이 새 내용과 같은지(병합 뒤 Leader 확인 항목), 판정 작성자 검증(훅 설계상 불가). QA 가 `rm -rf` 가 든 명령을 GateGuard 에 두 번 막혔고 새 디렉토리로 우회 없이 재실행.
- [23:32] Leader: worktree 3파일을 메인 트리에 복사(sha256 앞12자 3개 일치, 메인 HEAD 의 같은 파일은 base 와 동일해 충돌 없음) 후 명시 경로 3개 + 이 task 문서만 커밋한다. 커밋 뒤 설치된 훅이 새 훅 내용을 실제로 읽는지 훅 스크립트를 직접 호출해 확인한다.

## 배포 기록

## Codex 검토

### [2026-10-26 23:24] C2 review focus=none — done (지적 0건)
- judge 판정: 2026-10-26 23:2x `codex_required: true`(`budget_rule: CX-limit-unknown-r2`, Codex 스위치 on) / 이 task 호출 1회
- 대상: repo=/home/brownjeon/.node-local/stockinvest-hook-t098 base=a2d2d5a(--base 지정) — 인계 묶음 `scratchpad/codex-handoff-T-098-C2.md`, 실행 36초·exit 0
- 결과: 지적 0건. "새 SAFETY_PATHS 6개 항목은 의도한 디렉터리·정확 파일·backtest- 시험 접두를 올바르게 구분하며 인접 배열 항목이나 기존 scope 판정 로직을 약화시키지 않는다. bash -n·git diff --check 통과, 추가 시험은 경계 오용·이웃 경로·차용된 scope·혼합 커밋을 충분히 다룬다. 문서도 self-attestation·no-verify·설치 누락 등을 막지 못한다는 한계를 명시한다."
- 검토하지 못한 범위(Codex 보고): 전체 `test-git-hooks.sh` E2E 실행, 스냅샷에 없던 P3 미커밋 소스·주석 세부 대조, 병합 뒤 설치된 shim 경유 실제 커밋 동작.
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261026T142449Z-T-098-C2/raw.txt

## 최종 요약

### [T-098] 커밋 훅 감시 대상에 사전 등록(백테스트) 코드 편입 (V4)

> 작성자: 메인 세션(Leader 겸임) · 2026-10-26 23:32 KST · 양식: `docs/user-report-format.md` §3

- **상태**: ✅ 구현·검증 완료 · 로컬 커밋(훅은 이 서버 로컬 도구라 push·배포 대상이 아니다 — 커밋 즉시 이 저장소에서 활성)
- **무엇이 바뀌었나**: 커밋 훅 `SAFETY_PATHS` 에 6개 경로를 더했다 — `src/lib/profit-engine/registry/`(등록 수치·IS/OOS 원장·G1 기록·해시 코드)·`src/lib/profit-engine/backtest/`(엔진·신호)·러너 `scripts/profit-engine/backtest-runner.mjs`·`backtest-runner-core.js`(정확 일치)·시험 `src/lib/profit-engine/__tests__/backtest-*`·격리 시험 `isolation.test.ts`. 이제 이 파일을 바꾸는 커밋(원장을 러너가 갱신한 커밋 포함)은 Reviewer 판정 줄(scope 일치) 없이는 커밋되지 않는다 — "조용히 고쳐 다시 돌리기"가 이력에 남게 하는 보강이다(의도된 마찰). 훅 판정 로직은 바뀌지 않았고 항목 6줄·근거 주석·시험 75개·`CLAUDE.md` 한 문장이다.
- **배포**: 해당 없음(서버 로컬 훅). 커밋은 이 task 를 닫는 `feat(T-098)` 커밋.
- **AI 가 검증한 것**: Reviewer 2라운드(1차는 근거 주석 2곳이 P3 코드와 어긋나 조건부 통과 → 주석 수정 → 2차 pass) · Codex C2 지적 0건 · 변이 29종 전부 검출·새 시험×옛 훅은 새 경로 시험 67개 실패 · QA 직접 실행 pass(로직 시험 342/0·옛 시험 267/0, 일회용 저장소 실 커밋 8시나리오를 새·옛 훅 두 열로, 기존 안전 경로 판정 불변).
  - 검증 못 한 것: 전체 스크립트의 `# [E2E]` 단계(실제 index 를 건드려 실행하지 않음), 판정 작성자 검증(훅 설계상 불가).
- **👉 사용자가 확인할 것**: 없음.
- **👉 사용자가 결정할 것**: 없음. (이번에 편입하지 않은 후보 — `scripts/profit-engine/postmortem-core.js`(러너의 DB 읽기 전용 2차 방어선)·`signal-postmortem.mjs`·`holdings-*`·`daily-bars-*` — 중 postmortem-core 는 엔진 지문에 들어가 변경이 거부되므로 보류. 넣고 싶으면 알려 주세요.)
- **남은 일**: ① low 주석 1구절(훅의 `postmortem-core.js` 항목이 지문 범위를 단정 — 낡을 수 있음) ② 시험 fixture 의 lock 파일명 순서·`CLAUDE.md` "경계 판단 두 가지만" 문구가 낡음(비차단) ③ P3 커밋 때: 커밋 메시지는 `T-096` 만 인용(`T-070` 판정 scope 가 `src/lib/profit-engine/` 전체라 인용하면 통과된다)하고 R2 이후 재감사 판정이 마지막 줄인지 확인.
- **이슈·위험**: 이 훅은 판정을 누가 썼는지·낡았는지 검증하지 못한다(self-attestation) — 같은 task ID 에 넓은 scope 의 옛 판정이 남아 있으면 통과한다. 미커밋 worktree 에서의 러너 실행·`--no-verify`·훅 shim 비활성·저장소 복사본 실행도 못 막는다. 롤백: 이 커밋 revert(훅 한 파일·시험 스크립트·문서 한 줄).


## 데모 검토 (demo gate)

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | - |

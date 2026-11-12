---
task_id: T-165
title: 거시 레짐 라벨 기록(C0) — 미국 CPI(BLS)·정책금리(정적 표) 2변수 라벨을 판단 영향 0으로 기록
status: done
waiting: [user_decision]
priority: medium
project: StockInvest
created: 2026-11-11
updated: 2026-11-12
risk_level: R2
roles_involved: [leader, judge, analyst, developer, reviewer, qa]
skills_used: "없음 — 화면 변경 0건(라벨은 eval_funnel 기록만), 디자인 스킬 선택 기준에 해당하지 않음"
base_ref: ba3120ae2db9e3ab56c91435cc17fbd2defe905a
tags:
  - type/task
  - domain/strategy
  - domain/data-source
  - domain/us-market
aliases:
  - 거시 레짐 라벨 C0
  - CPI 금리 레짐 라벨
  - BLS CPI 수집
related_tasks:
  - T-164
  - T-003
  - T-096
  - T-147
  - T-148
  - T-156
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: "C0 라벨 기록 구현·검증까지(서버 worktree 커밋 상태에서 정지). push·배포·DDL 적용·system_config/.env 변경·pm2 재기동 없음."
  last_event_id: exec-001
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

# T-165 — 거시 레짐 라벨 기록(C0)

## 목표

[[T-164-macro-regime-fear-greed-review]] 도입 검토의 사용자 결정(2026-11-11 23:31·23:40, 착수 지시 원문 「BLS로 착수」)에 따라 **C0 — 거시 레짐 라벨을 기록만 한다.** 매매 판단·게이트·사이징·AI 프롬프트에 **영향 0**.

- 변수 2개만: **미국 CPI YoY**(BLS 공식 API, 새 외부 원천 1건) · **연준 정책금리 목표 범위 상단의 6개월 변화**(코드 안 정적 표). FRED·공포탐욕지수·VIX 는 쓰지 않는다.
- 라벨은 국내·해외 **공통**(미국 지표 기준). C1(프롬프트)·B(사이징 계수)는 이번 범위가 아니다.
- 사전등록 임계(T-164 Analyst §5): `CPI YoY(발표분) ≥ 4.0` AND `정책금리 6개월 변화 > 0` → 유형⑤. 나머지 라벨 집합은 이 task 의 Analyst 가 **구현 전에** 고정한다.

### 완료 기준

1. 라벨 집합·임계·발표일 정렬 규칙·정적 표 출처·정적 표 낡음 규칙이 구현 전에 Analyst 절에 고정돼 있다.
2. 순수 분류 함수 + BLS 수집(캐시) + 정적 금리 표 + run 단위 기록이 구현돼 있다.
3. 시험: 분류 경계 · 발표일 정렬(발표 전날·당일 발표 전/후) · 정적 표 낡음 · BLS 실패·타임아웃 · 🔴 **라벨 유무와 무관하게 엔진의 게이트 판정·주문 후보·금액이 동일하다는 불변식**.
4. Reviewer `최종 판정` 줄이 staged 안전 파일 전부를 scope 로 덮는다 · QA PASS.
5. 서버 worktree 에 이 task 커밋만 있는 상태로 정지(push 는 메인 세션이 사용자 승인 후).

## 관련 과거 이력 요약

- [[T-164-macro-regime-fear-greed-review]] — 이 task 의 근거 문서. 조건으로 살아남은 것은 유형⑤(고물가+금리인상중) 하나뿐이고 백테스트 검증 경로가 닫혀 있어 **라벨 기록부터** 하기로 했다(§A·§D·§H). 단계: C0 라벨 → (승격 조건: 라벨 60거래일 · 오류율 <5% · 월 플립 ≤2회) → C1 프롬프트 → B 계수(⑤만·하한 0.5) → A(전면 차단) **승격 금지**. 영상의 유형 라벨은 look-ahead 였다(2021.7·8 당시 FFR 0%) → 이번 라벨은 **그 시점에 알 수 있던 값만** 써야 한다. CPI 는 `CPIAUCNS` 계열(비계절조정, 개정 거의 없음)이 빈티지 없이 갈 수 있는 최선이라는 판단[가능성 높음]. D-1 정정: BLS 는 **새 외부 원천 1건**이다.
- [[T-003-phase2-pipeline-redesign]] — 국면 분류로 매수를 게이팅해 `rule_no_fire` 95%가 된 사고 → 게이트를 라벨로 강등(`market_state`, `engine.ts` `withEngineLabels`). 이번 라벨도 **게이트가 되면 안 된다.**
- [[T-096-strategy-validation-p2-p3]] — 사전등록 규율(수치를 먼저 고정). 이 task 의 라벨 임계도 구현 전에 고정한다. 현 IS/OOS 창 안에 유형⑤가 0일이라는 한계는 그대로다.
- [[T-147-cron-tick-starvation]]·[[T-148-strategy-eval-serial-fanout]] — cron 틱 묶임 이력. `strategy-eval` 틱은 국내 장중 median 136초까지 걸린 적이 있고, 수집 팬아웃은 동시성 4로 지연을 줄였다. **BLS 호출을 이 경로(특히 종목 루프)에 넣지 않는다.**
- [[T-156-us-stock-entry-exit-forecast-design]] — FRED·kibot 조달 패턴(엄격 allowlist·응답 상한·타임아웃·sha256 증거)의 소유자이며 `evaluation_only`. 이번 건은 FRED 를 쓰지 않으므로 T-156 과 분리된다. 단 **allowlist·응답 크기 상한·타임아웃 패턴은 참고할 가치가 있다**(코드 공유는 하지 않는다 — 담당이 Codex 다).
- 승인 교훈: LSN-0004(안전 경로 커밋은 훅이 실재하는 서버에서) · LSN-0007(push 전 `git-refs-clean.sh --check`).

### 현재 코드 사실 (origin/main `ba3120a`, Leader 직접 확인)

- `src/lib/strategy/macro.ts`(67행): `MacroIndicators{kospiChangePct, sp500ChangePct, usdKrwChangePct}`, `fetchMacroIndicators()` 5분 캐시, `clearMacroCache()`.
- `src/lib/strategy/engine.ts`(1795행): `runMarket()` 이 `new EvalFunnelRecorder(market)` 로 런 스코프 기록. 거시 게이트(1459~1491행)는 `fetchMacroIndicators()` → KOSPI∧SPY ≤ -1.5% 이면 `regimeGateBlocked=true`, 실패 시 fail-open + `rec.error('regime_gate_macro_error')`. `gate:'run'` 행은 1345·1363·1423·1736행 4곳(최종 pass 행 detail: symbols·strategies·skippedStrategyIds·exitTrack·buyBlocked·signalsCreated·errors).
- `src/lib/strategy/eval-funnel.ts`: run 스코프 in-memory 누적 → 종료 시 multi-row INSERT. `detail` 은 MariaDB JSON 컬럼, 60,000자 초과 시 잘림. → **run 행 `detail` 에 필드를 더하면 DDL 없이 런 단위 기록이 된다.**
- `strategy-eval` 은 cron-runner 가 웹 앱(`stockinvest`, 장기 실행 `next start`)의 `/api/cron/strategy-eval` 을 5분마다 호출해 돈다 → 모듈 수준 in-memory 캐시가 런 사이에 유지된다(배포·재기동 때 초기화).
- 웹 버전: `package.json` `0.6.0`(T-156 커밋들이 올림). 이 task 가 배포되면 정책상 마이너 증가 `0.7.0`.

## 역할별 지시사항

### judge
- intake: 화면 변경 0건(데모 `none` 예상). 예상 변경 경로는 아래 developer 절 참고.
- C1(Analyst 설계 확정 직후) · C2(Reviewer PASS 직후). codex 스위치 off 면 "codex검토기능은 지금 off상태입니다" 로 기록하고 진행, 한도 기록 stale 로 보류되면 그대로 기록.

### analyst (구현 전에 고정할 것 — Analyst 절에 기록)
1. **BLS 1순위 선행 확인**: 키 없는 v1 경로로 과거 시점(최소 2021~2022 포함) CPI 를 받을 수 있는가. 실제 호출 횟수를 기록한다(일 25회 한도, 확인은 최소 횟수로).
2. **시리즈**: 예) CPI-U 전도시 비계절조정 `CUUR0000SA0`. YoY = (M월 지수 / M-12월 지수 − 1)×100, 반올림 규칙 명시. 결측 월(예: 공표 취소·`-` 값) 처리.
3. **발표일 정렬(look-ahead 방지)**: M월 CPI 는 **발표 시각 이후에만** 사용. 발표 일정 정적 표(BLS 공표 일정 근거) 또는 보수적 규칙 중 택일하되 **발표일을 모르면 '아직 미발표'** 로 취급(fail-safe). 시각 기준(미 동부 08:30 → KST 변환, 서머타임)을 명시. 경계 시험 케이스(발표 전날·당일 발표 전/후)를 정의.
4. **정책금리 정적 표**: FOMC 목표 범위 변경 이력(2008-12~), 출처는 연준 공식 자료(URL·확인 시각)로 검증 가능하게. 6개월 변화의 정의(달력 6개월 전 같은 날의 상단과 비교 등, 효력 발생일 기준인지 발표일 기준인지).
5. **정적 표 낡음 감지**: FOMC 회의가 지났는데 표가 갱신되지 않은 상태 → 라벨을 `unknown` 등으로 낮추는 규칙(예: 표에 `verifiedThrough` 날짜 + 알려진 회의 일정, 회의 결정일이 지났고 `verifiedThrough` 가 그보다 이르면 낡음; 알려진 회의 일정 범위를 벗어나도 낡음).
6. **라벨 집합·임계 고정**(사전등록 규율): ⑤ = `CPI YoY ≥ 4.0 AND ΔFFR상단(6개월) > 0`. 그 외 라벨(예: 인하중·동결·저물가 등)을 둘지, 둔다면 정의와 임계를 고정. 입력 결측 → `unknown` + 사유 코드 목록.
7. **기록 필드 정의**: 라벨·CPI YoY·기준월·발표 시각·금리 상단·6개월 전 상단·6개월 변화·사유 코드·규칙 버전. 런 단위 기록이 타당한지 판단.
8. **수집 빈도·캐시 정책**: 운영 BLS 호출 하루 1회 이하 + 캐시. 실패 재시도 간격. 재기동 직후 동작.

### developer (Analyst 고정 + Leader 가이드 이후)
- 작업 위치: 서버 worktree `~/.node-local/stockinvest-t165`(detached, `origin/main` `ba3120a`). 공유 트리(`/Volumes/homes/...`, 서버 `~/NFS/homes/brownjeon/project/StockInvest`)에서 코드 작업·`reset`·`checkout`·`clean` 금지.
- 상세 구현 가이드는 아래 「Leader — 구현 가이드」 절(설계 확정 후 작성).

### reviewer
- 판단 영향 0 · 실패 무해 · look-ahead 부재 · 외부 호출 경계(allowlist·타임아웃·응답 상한·호출 빈도) · DDL 불필요/코드 선배포 안전 · 정적 표 출처 검증 가능성.
- `## Reviewer` 섹션 마지막에 `최종 판정: PASS|CONDITIONAL_PASS|FAIL (scope: <실제 검토한 경로>)` 한 줄. 소제목 없이 flat bullet.

### qa
- 불변식 시험·경계 시험 실행 확인, 전체 jest·tsc·build(서버 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 직렬), 공유 DB 쓰기 0건 확인, BLS 실호출 0건(시험 중) 확인.

## 실행 도구·절차 이력

- `exec-001` — 2026-11-11 23:51 KST · 이전 도구 없음(신규) → `current_tool: claude` · 적용 절차 `claude_standard` · 맡은 범위: C0 라벨 기록 구현·검증(서버 worktree 커밋 상태에서 정지) · 근거: 사용자 응답 원문 「BLS로 착수」(메인 세션 전달) + T-164 「사용자 결정 기록」 D-1~D-4 · 남은 일: 아래 역할 순서 진행.

- `exec-001` 경과(2026-11-12 01:46 KST, 도구 전환 없음) — 실제 호출한 역할: judge(intake·C1·C2 각 1회, Jev 엔진·fallback 없음) · analyst(설계 고정, BLS 2회) · codex(C1·C2 각 1회, 로컬 clone 스냅샷 — 공유 트리 미사용) · developer(구현 + C2 수정) · reviewer(감사 → 시험 4파일 보완 검토 → C2 판정 → 수정 후 재검토) · qa(전체 jest 기준 대조·tsc·build·BLS 1회) · Leader(설계 가이드·C1 판정·커밋). **미실행**: designer(화면 변경 0건), deployer(push·배포는 사용자 승인 대기 — 메인 세션 몫). 메인 세션이 겸임한 역할 없음.

- `exec-001` 경과(2026-11-12 10:30 KST, 도구 전환 없음) — 메인 세션(claude)이 사용자 응답 「push 진행」으로 `ca59bd0` push·webhook 배포 판정·운영 라벨 기록 확인을 했고, 「기록도 푸시해주고 라벨도 기록되는지 확인해서 알려줘」로 이 배포 기록 커밋을 push 했다. deployer 역할은 호출하지 않았다(push=webhook 배포라 `scripts/deploy.sh` 를 따로 돌리지 않음 — 이중 배포 방지).

## 판단 기록 (judge)

- [2026-11-11 23:53] intake engine=jev → task_type=feature · risk=R1 · developer_model=opus · next=assign · demo=none/- | overrides=- | fallback=- | tokens=1386

- [00:07] demo-gate `init` → `status: not_required` / `level: none`(1차는 빈 `demo_gate` 블록이 `level` 검증에 걸려 거부 → 블록을 지우고 2차 통과, 판정값 손대지 않음). demo=none/-
- [00:09] Leader override: **risk 를 R2 로 다룬다**(도구 판정 R1). 사유: 변경이 `strategy-eval` 무인 실행 경로의 엔진 본체(`src/lib/strategy/engine.ts`, SAFETY_PATHS `^src/lib/strategy/`)를 건드리고 운영 웹 프로세스에서 **새 외부 원천(BLS)** 을 호출한다 — judge.md 「프로젝트 맞춤」의 무인 실행(cron) 영역과 같은 이유. 규칙 보강 후보. developer_model=opus 는 도구 판정 그대로 따른다.
- [2026-11-12 00:11] codex_gate/C1 engine=jev → codex_required=true · mode=adversarial-review · focus=design_assumption · budget_rule=CX-limit-unknown-r2 · codex_switch=on · codex_calls_used=0 · remaining_limit_pct=null(stale) | overrides=- | fallback=- | tokens=1007 | demo=none/-
- [2026-11-12 01:11] codex_gate/C2 engine=jev → codex_required=true · mode=adversarial-review · focus=error_handling · budget_rule=CX-limit-unknown-r2 · codex_switch=on · codex_calls_used=1 · remaining_limit_pct=null(stale) | overrides=- | fallback=- | tokens=1157 | demo=none/-

- [01:42] Leader: C2 채택 수정(C2-1 파서·캐시 교체 규칙, C2-2 스트림 취소) 뒤 **Codex C2 재판정·재호출은 하지 않는다**. 사유: 수정이 `bls-cpi.ts`·`snapshot.ts` 2파일의 실패 처리 규칙에 국한되고, Reviewer 가 수정 전후 transpile 대조·변이 시험(8건 실패 확인)·221건 직접 실행으로 재검토해 pass 를 냈으며 분류·엔진·정적 표 무변경이 바이트로 확인됐다. Codex 호출 차수 2/4(C1·C2 각 1회) — 사용자가 원하면 남은 2회로 재검토할 수 있다.
- [01:42] Leader 기록 정정: `## Reviewer` 절의 `[01:40]` bullet(Codex C2 판정·CONDITIONAL 판정)은 Reviewer 가 서버 시계를 보지 않고 적은 시각이며 실제로는 01:2x 경이다(Developer 수정 01:28, Reviewer 재검토 01:30 보다 앞선 사건). 내용 순서는 기록 순서와 같다. 판정 효력은 마지막 줄 하나(`[01:30] … PASS`)뿐이다.

## Analyst

- [23:54] 범위 확인: 설계 고정·사전등록만. 코드·설정·DB 변경 0건, createSignal·알림 0건, KIS 호출 0건. 외부 호출 = BLS API **2회** + 연준·BLS 공식 문서 열람(아래 출처). API 키 발급·사용 없음. 산출물 원문·기계 판독용 JSON 은 서버 `~/.node-local/t165-analyst/`(이번에 생성). 실행 도구: claude(analyst, Fable).
- [23:55] **§1 BLS 선행 확인 [확실]** — 키 없는 v1 로 과거 CPI 를 받을 수 있다. 호출 2회, 모두 HTTP 200·`status: REQUEST_SUCCEEDED`·`message: []`.
  | # | 시각(KST) | 요청 | HTTP | 크기 | 지연 | 결과 |
  |---|---|---|---|---|---|---|
  | 1 | 2026-11-11 23:54:45 | `GET https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0` (연도 미지정) | 200 | 3,379 B | 0.71 s | 36개월 **2024-01 ~ 2026-10**(문서상 "3년 기본 범위" = 당해 포함 3개 연도) |
  | 2 | 2026-11-11 23:54:45 | `POST https://api.bls.gov/publicAPI/v1/timeseries/data/` body `{"seriesid":["CUUR0000SA0"],"startyear":"2017","endyear":"2026"}` | 200 | 10,609 B | 0.39 s | 118개월 **2017-01 ~ 2026-10**(10년 한도 안) |
  - 응답 형태: `Results.series[0].data[]` 각 원소 `{year:"2026", period:"M10", periodName:"October", value:"337.511", footnotes:[{}], latest?:"true"}` — 값은 **문자열**, 최신 월에만 `latest:"true"`, 연간 평균 행(`M13`)은 이 시리즈에 없음(있어도 `M13` 제외 규칙 둔다). **결측 표현 확인**: `2025 M10` → `value:"-"`, `footnotes:[{code:"X", text:"Data unavailable due to the 2025 lapse in appropriations"}]`. 응답 원문: `bls-call1-get-CUUR0000SA0.json`·`bls-call2-post-CUUR0000SA0-2017-2026.json`.
  - v1 한도(BLS `api_faqs.htm` 열람 23:55 KST): 일 **25 쿼리**(미등록)·쿼리당 시리즈 25·**연도 10**, 넷/퍼센트 변화·카탈로그 없음. IP 단위인지 문서에 명시 없음(미확인) — 보수적으로 호스트 단위로 취급.
- [23:56] **§2 시리즈·YoY [확실]** — `CUUR0000SA0`(CPI-U, U.S. city average, All items, **비계절조정**) 채택. 근거: 비계절조정은 사후 개정이 거의 없어 빈티지 없이 "그 시점 발표분" 과 일치하고(T-164 §H), BLS 헤드라인 12개월 변화율도 이 계열로 계산된다. 계절조정 `CUSR0000SA0` 은 매년 2월 재계절조정으로 과거 값이 바뀌므로 제외.
  - `yoyPctRaw = (index[M] / index[M−12] − 1) × 100` (소수 4자리 기록) · `yoyPct = round(yoyPctRaw, 1)`(소수 1자리, 0.05 는 올림 — JS `Math.round(x*10+1e-9)/10`) · **임계 비교는 반올림 후** `yoyPct ≥ 4.0`(BLS 헤드라인 1자리 수치와 같은 값으로 비교 — "발표분" 정의). 3.95 → 4.0 → hot 이 의도된 동작.
  - 교차검증: 2022-06 = 296.311/271.696 → 9.0598 → **9.1**(BLS 헤드라인 9.1 일치) · 2021-08 → 5.2513 → 5.3(일치) · 2023-05 → 4.0476 → **4.0**(경계 실제 사례).
  - 결측 처리: `value === "-"` 또는 숫자 변환 실패 → 그 월은 **없음**(null). 기준월(M−12)이 없으면 M 의 YoY 도 없음. **fallback = "현재 달력월부터 거슬러 가며, ① 발표 시각이 지났고 ② 값이 있고 ③ 기준월 값도 있는 가장 최근 월"** 을 쓴다. 허용 낡음 `monthGap = (현재 ET 달력월 − 기준월) ≤ 3`; 4 이상 → `unknown(cpi_stale)`. 정상 운영 gap 은 1~2, 한 달 미공표 시 최대 3, 두 달 연속 미공표면 unknown.
  - ⚠ [확실] **2025-10 CPI 는 공표되지 않았다**(API 결측 + BLS 아카이브 "Not published because of 2025 lapse in federal government appropriations"). 따라서 **2026-10 의 YoY 는 계산 불가** → 위 fallback 으로 2026-09 YoY **3.7**(336.940/324.800) 을 2026-12-10 08:30 ET(11월치 발표) 까지 사용. 2026-11 분은 기준월 2025-11 이 있어 정상 복귀.
- [23:57] **§3 발표일 정렬 — 방식 (c) 결합 [확실]**: M 월 CPI 는 **정적 발표 일정 표**의 `releaseAtUtc`(08:30 America/New_York 를 UTC 로 변환) **이후에만** 사용. 표에 없는 월·`null`(미공표) 월은 **'미발표'** 로 취급(fail-safe) → 위 fallback 으로 흘러가고, gap 규칙이 "표가 끝나서 낡은 값을 계속 쓰는" 상태를 `unknown(cpi_stale)` 으로 떨어뜨린다(표의 마지막 월 + 3개월이 지나면 자동 unknown). 보수 규칙(M+2월 1일)은 채택하지 않음 — 매달 약 2주 늦고, 발표 미공표 월을 구별 못 한다.
  - 표 범위: 기준월 **2021-01 ~ 2027-11**(83행, 2025-10 은 `null`). 출처·확인 시각(KST): BLS 뉴스릴리스 아카이브 `https://www.bls.gov/bls/news-release/cpi.htm`(2021~2026-10, **파일명 날짜 코드 `cpi_MMDDYYYY` 에서 추출** — 페이지 본문엔 날짜 텍스트 없음) 23:58 · `https://www.bls.gov/schedule/2026/home.htm` 23:58 · `https://www.bls.gov/schedule/news_release/cpi.htm`(2026-10~2027-11, 전부 08:30 AM) 23:55 · `https://www.bls.gov/schedule/2025/12_sched.htm`(11월치 = 2025-12-18 08:30 ET, "lapse… release dates are subject to change") 23:58. [가능성 높음] 아카이브 파일명 날짜 = 실제 발표일(2022-07-13·2025-10-24·2025-12-18 등 알려진 날짜와 전부 일치). ⚠ 서버 `curl` 은 bls.gov HTML 에 403 — 문서 열람은 WebFetch 로 했고 HTML 원문은 저장하지 못했다(API 는 200).
  - 미래 일정 변경 위험: 표보다 **늦게** 발표되면 API 에 값이 아직 없어 이전 월로 자동 fallback(안전). 표보다 **일찍** 발표되면 표 시각까지 늦게 반영(안전, 보수적). 어느 쪽도 look-ahead 아님.
  - 시각 변환(서머타임: 3월 둘째 일요일 ~ 11월 첫째 일요일 EDT=UTC−4, 그 외 EST=UTC−5): 08:30 EDT = **12:30Z = 21:30 KST**, 08:30 EST = **13:30Z = 22:30 KST**. 구현은 고정 오프셋 대신 표의 `releaseAtUtc`(Python zoneinfo 로 사전 계산) 를 그대로 비교한다.
  - 경계 시험(모두 `test-cases-expected.json` 에 기대값):
  | 케이스 | as-of(UTC) | 미 동부 | KST | 사용 기준월 |
  |---|---|---|---|---|
  | 발표 전날(EDT) | 2022-07-12T12:30Z | 7/12 08:30 EDT | 7/12 21:30 | 2022-05 |
  | 발표 당일 08:29(EDT) | 2022-07-13T12:29Z | 7/13 08:29 | 7/13 21:29 | 2022-05 (H4) |
  | 발표 당일 08:30(EDT) | 2022-07-13T12:30Z | 7/13 08:30 | 7/13 21:30 | **2022-06** (H5, 등호 포함) |
  | 발표 당일 08:29(EST) | 2026-11-10T13:29Z | 11/10 08:29 EST | 11/10 22:29 | 2026-09 (H12) |
  | 발표 당일 08:30(EST) | 2026-11-10T13:30Z | 11/10 08:30 EST | 11/10 22:30 | 2026-10 발표됐으나 기준월 결측 → **2026-09**(H13) |
- [23:57] **§4 정책금리 정적 표 [확실 — 원문 HTML 저장]** — 출처 `https://www.federalreserve.gov/monetarypolicy/openmarket.htm`(페이지 "Last Update: September 16, 2026", 저장본 `fed-openmarket.htm` 23:57 KST). **33행**, 2008-12-16(0.00–0.25) ~ 2026-09-17(3.75–4.00). 2009~2014·2021 은 변경 없음(표에 연도 자체가 없음). 표의 날짜는 **효력 발생일**(= FOMC 성명 다음 영업일; 성명 2026-09-16 "raise … to 3-3/4 to 4 percent" → 표 2026-09-17, 성명 2025-12-10 → 표 12-11) — 성명 원문 `fed-pr-20260916a.htm`·`fed-pr-20251210a.htm` 저장. 2008-12-16 행은 성명일과 같은 날짜로 표기돼 있음(당시 표기 관행, 세부 미확인 — 6개월 비교에는 영향 없음). 2020-03-04 행에는 각주 `*`(2024-07-10 에 03-03 → 03-04 로 정정) 가 붙어 있다.
  | 효력일 | 범위 | 효력일 | 범위 | 효력일 | 범위 |
  |---|---|---|---|---|---|
  | 2008-12-16 | 0.00–0.25 | 2019-08-01 | 2.00–2.25 | 2022-12-15 | 4.25–4.50 |
  | 2015-12-17 | 0.25–0.50 | 2019-09-19 | 1.75–2.00 | 2023-02-02 | 4.50–4.75 |
  | 2016-12-15 | 0.50–0.75 | 2019-10-31 | 1.50–1.75 | 2023-03-23 | 4.75–5.00 |
  | 2017-03-16 | 0.75–1.00 | 2020-03-04 | 1.00–1.25 | 2023-05-04 | 5.00–5.25 |
  | 2017-06-15 | 1.00–1.25 | 2020-03-16 | 0.00–0.25 | 2023-07-27 | 5.25–5.50 |
  | 2017-12-14 | 1.25–1.50 | 2022-03-17 | 0.25–0.50 | 2024-09-19 | 4.75–5.00 |
  | 2018-03-22 | 1.50–1.75 | 2022-05-05 | 0.75–1.00 | 2024-11-08 | 4.50–4.75 |
  | 2018-06-14 | 1.75–2.00 | 2022-06-16 | 1.50–1.75 | 2024-12-19 | 4.25–4.50 |
  | 2018-09-27 | 2.00–2.25 | 2022-07-28 | 2.25–2.50 | 2025-09-18 | 4.00–4.25 |
  | 2018-12-20 | 2.25–2.50 | 2022-09-22 | 3.00–3.25 | 2025-10-30 | 3.75–4.00 |
  | | | 2022-11-03 | 3.75–4.00 | 2025-12-11 | 3.50–3.75 |
  | | | | | **2026-09-17** | **3.75–4.00** |
  - `verifiedThrough = 2026-11-11`: 2026-10-28 FOMC 성명(`fed-pr-20261028a.htm`) "maintain the target range … at 3-3/4 to 4 percent" 로 10월 회의 뒤에도 표가 최신임을 확인. 다음 정례 결정일 2026-12-09.
  - **6개월 변화 정의(효력일 기준)**: `upper(d)` = `effectiveDate ≤ d`(d 는 **America/New_York 달력일**) 인 마지막 행의 상단. `compareDate = d − 6 달력월`(같은 일, 없으면 그 달 말일: 8/31 → 2/28·29). `deltaPct = round(upper(d) − upper(compareDate), 2)`. `d < 2008-12-16` 또는 `compareDate < 2008-12-16` → `unknown(rate_table_before_start)`(= 2009-06-15 이전은 전부 unknown). 효력일 기준을 택한 이유: 성명(14:00 ET)과 효력(다음 영업일) 사이 하루를 보수적으로 "이전 값" 으로 두면 look-ahead 가 생기지 않는다.
- [23:58] **§5 정적 표 낡음 감지 [확실]** — FOMC 정례 일정표(출처 `https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm`, "Last Update: October 28, 2026", 저장본 `fed-fomccalendars.htm`) 의 **결정일 = 회의 마지막 날**: 2025 `01-29·03-19·05-07·06-18·07-30·09-17·10-29·12-10`(08-22 notation vote 는 전략 성명이라 제외) · 2026 `01-28·03-18·04-29·06-17·07-29·09-16·10-28·12-09` · 2027(tentative) `01-27·03-17·04-28·06-09·07-28·09-15·10-27·12-08`. 규칙 ① `rate_table_stale`: 결정일 `< today(ET)` 인 회의가 있고 그 결정일 `> verifiedThrough` ② `rate_schedule_exhausted`: `today(ET) > 마지막 알려진 결정일(2027-12-08)`. 둘 다 `unknown`. **한계**: 임시(긴급) 회의·회의 간 변경(2020-03-03/15 유형)은 감지하지 못한다 — 그 경우 다음 정례 결정일까지 옛 상단을 쓴다(C0 는 기록만이라 피해 0, 운영자 갱신으로 해소). 운영자 갱신 절차(한 단락): FOMC 성명 다음 날 `openmarket.htm` 을 열어 변경이 있으면 `rows` 에 `{effectiveDate, lowerPct, upperPct}` 한 줄을 추가하고(없으면 추가 없음), 어느 경우든 `verifiedThrough` 를 그 결정일 이상으로 올린다 · 매년 연준이 다음 연도 일정을 공개하면 `decisionDates` 에 8개를 추가한다 · 둘 모두 `^src/lib/strategy/` 안이라 커밋에 Reviewer 판정 줄이 필요하다(의도된 마찰).
- [23:58] **§6 라벨 집합·임계·사유 코드 — `ruleVersion = "macro-regime-c0@1"` [고정]**
  - 축 1 물가 `hot = yoyPct ≥ 4.0` (아니면 `normal`) · 축 2 금리 `direction = tightening(Δ>0) | hold(Δ=0) | easing(Δ<0)`.
  - 라벨 = `${물가}_${금리}` 6개: `hot_tightening`(= **유형⑤**, `isType5=true`) · `hot_hold` · `hot_easing` · `normal_tightening` · `normal_hold` · `normal_easing`, 그리고 `unknown`. 사전등록 임계는 사용자 결정 그대로(4.0·>0) 이고 다른 라벨은 두 축의 나머지 조합일 뿐이라 **추가 파라미터 0개**. 승격 지표(60거래일·오류율·월 플립)는 `label` 문자열 변화·`reasonCodes` 비율로 바로 셀 수 있다.
  - `unknown` 사유 코드(복수 가능, `reasonCodes[]` 순서 = 우선순위): `cpi_not_loaded`(재기동 뒤 캐시 비어 있음·갱신 미완) · `cpi_cache_stale`(마지막 성공 수집이 **7일** 초과 — 연속 실패) · `cpi_stale`(사용 가능한 기준월 gap ≥ 4, 발표 일정 표 소진 포함) · `rate_table_before_start` · `rate_table_stale` · `rate_schedule_exhausted`. 수집 결과 코드(`fetchStatus`, 라벨 사유와 별개): `ok | http_error | timeout | too_large | bad_json | bad_schema | request_failed_status`(BLS `status ≠ REQUEST_SUCCEEDED`).
- [23:59] **§7 기록 필드 — `eval_funnel` `gate:'run'` 최종 pass 행 `detail.macroRegime` 하위 객체 [타당]**: 런 단위가 맞다 — 라벨은 하루에도 바뀌지 않는 월 단위 값이고 종목 단위 기록은 중복만 늘린다. DDL 없음, 60,000자 한도 대비 ~700 B. 필드(타입·단위):
  ```
  macroRegime: {
    ruleVersion: "macro-regime-c0@1", label: string, isType5: boolean, reasonCodes: string[],
    asOfUtc: ISO8601, asOfEtDate: "YYYY-MM-DD",
    cpi: { seriesId: "CUUR0000SA0", referenceMonth: "YYYY-MM"|null, releaseAtUtc: ISO|null,
           index: number|null, baseMonth: "YYYY-MM"|null, baseIndex: number|null,
           yoyPctRaw: number(4dp)|null, yoyPct: number(1dp)|null, hot: boolean|null, monthGap: int|null,
           fetchedAtUtc: ISO|null, cacheAgeSec: int|null, fetchStatus: string },
    rate: { upperPct: number|null, upperEffectiveFrom: "YYYY-MM-DD"|null, compareDate: "YYYY-MM-DD",
            upper6mAgoPct: number|null, deltaPct: number(2dp)|null, direction: string|null,
            tableVerifiedThrough: "YYYY-MM-DD", nextKnownDecisionDate: "YYYY-MM-DD"|null }
  }
  ```
  `unknown` 이어도 계산된 부분(예: 금리 축)은 채운다(사후 검증용). 다른 `gate:'run'` 행(1345·1363·1423행 조기 종료)엔 넣지 않는다 — 한 런에 한 번.
- [00:00] **§8 수집 빈도·캐시 [고정] — Leader 기본안(캐시 동기 조회 + 백그라운드 갱신) 타당**. 이유: strategy-eval 틱은 T-147/148 이력대로 지연에 민감하고, CPI 는 월 1회 바뀌는 값이라 5분 늦게 반영돼도 손실이 0 이다. 대안(첫 런에서 await 수집, 5s 타임아웃)은 재기동 직후 unknown 1건을 없애는 대가로 외부 지연을 임계 경로에 들이므로 비채택.
  - 요청: `GET /publicAPI/v1/timeseries/data/CUUR0000SA0`(연도 미지정 — 3개 연도 36개월, 기준월 + 12개월 전이 항상 포함됨; 1월에도 전전년 1월부터 온다). 호스트 allowlist `api.bls.gov` 만, https 만, 리다이렉트 불허.
  - 성공 TTL **24h** · 실패 재시도 최소 간격 **2h** · 프로세스당 **UTC 일 최대 시도 6회**(web+cron 두 프로세스가 돌아도 12 ≪ 25; 재기동마다 카운터가 0 이 되므로 하루 재기동 2회까지 가정해도 24) · 타임아웃 **5s** · 응답 상한 **64 KB**(실측 3.4 KB, POST 10년도 10.6 KB) · 응답 검증: `status === "REQUEST_SUCCEEDED"`, `Results.series[0].seriesID === "CUUR0000SA0"`, `data[]` 각 원소 `year` 4자리·`period` `^M(0[1-9]|1[0-2])$`(`M13` 제외)·`value` 숫자 또는 `"-"`. 실패 시 **기존 캐시 유지**(값은 덮어쓰지 않음) — 7일 넘게 실패가 이어지면 `cpi_cache_stale`.
  - 갱신 트리거: 런 시작 때 캐시가 없거나 TTL 지났고 재시도 간격이 지났으면 **fire-and-forget**(await 하지 않음). 재기동 직후 첫 런 = `unknown(cpi_not_loaded)`, 다음 틱(5분)부터 정상 — 승격 지표 계산 때 이 사유는 "오류" 가 아니라 "미로딩" 으로 따로 센다. 시험 환경에서는 수집기를 주입(mock) 해 **BLS 실호출 0건**.
  - 정책금리 표·발표 일정 표는 코드 상수(외부 호출 0). 캐시는 모듈 메모리(런 사이 유지, 재기동 시 초기화) — DB 저장 없음(C0 범위).
- [00:01] **§9 시험 케이스 목록** — 기대값은 서버 `~/.node-local/t165-analyst/test-cases-expected.json`(H1~H16·S1~S2, 참조 계산기 `t165_gen.py` 로 산출 — 이 파일은 developer 가 옮길 코드가 아니라 **기대값 오라클**이다).
  - 분류 경계(합성 입력): `yoyPct` 3.9/**4.0**/4.1 × Δ −0.25/**0**/+0.25 → 9조합 중 `hot_tightening` 은 (4.0,+0.25)·(4.1,+0.25) 2개만 · 반올림 경계 raw 3.95→4.0(hot)·3.949→3.9(normal) · Δ 부동소수(5.5−5.25 → round 2dp = 0.25) · 결측 `"-"`·비숫자 값·`M13` 행 · 기준월 결측 fallback(§2) · gap 3 허용/4 unknown.
  - 발표일 정렬: §3 표 5건(등호 포함, EDT/EST 각각).
  - 정적 표 낡음: S1(2026-12-10, verifiedThrough 2026-11-11 → `rate_table_stale`), S2(2027-12-20 → `rate_schedule_exhausted`), 비교일 표 이전 H15(2009-03-01), 경계 H16(2009-06-16 → 금리 축 계산됨 Δ=0).
  - BLS 실패: timeout(5s)·HTTP 500·`status:"REQUEST_NOT_PROCESSED"`·JSON 깨짐·`seriesID` 불일치·64 KB 초과·리다이렉트 → 모두 `fetchStatus` 코드 + **캐시 보존** + 라벨은 캐시 기준(캐시 없으면 `cpi_not_loaded`).
  - 역사 점검(정적 표 + 이번 응답 값, 기대 라벨): **H1 2021-08-16 → `hot_hold`(YoY 5.4·Δ 0, 유형⑤ 아님 — 영상 라벨의 look-ahead 반증)** · H2 2022-06-15 → `hot_tightening`(8.6·+0.75) · H3 2022-06-16 → `hot_tightening`(8.6·+1.50) · H6 2023-09-20 → `normal_tightening`(3.7·+0.75, 7/27 인상 뒤 6개월 미경과) · H7 2024-03-01 → `normal_hold`(3.1·0) · H8 2025-03-01 → `normal_easing`(3.0·−1.00) · H9 2025-11-15 → `normal_easing`(2025-09 치 3.0·−0.50, 10월 미공표 fallback) · H10 2025-12-17 → `normal_easing`(gap 3 허용) · **H11 2026-06-15 → `hot_hold`(2026-05 YoY 4.2·Δ 0 — 물가만 임계 초과, ⑤ 아님)** · H14 2026-11-11(오늘) → `normal_tightening`(2026-09 치 3.7 · 상단 4.00 vs 5/11 3.75 → +0.25).
  - 🔴 불변식(완료 기준 3): 같은 입력으로 라벨 모듈을 주입/미주입·`unknown`/`hot_tightening` 강제 네 경우 모두 게이트 판정·주문 후보·금액·`signalsCreated` 가 바이트 단위로 동일해야 한다.
- [00:02] **§10 서버 파일(`~/.node-local/t165-analyst/`, sha256 앞 16자)**: `fomc-target-range-history.json` ad49082d53c35f33(33행+meta) · `fomc-scheduled-meetings.json` 627102cd26a86095(24 결정일) · `bls-cpi-release-schedule.json` 2be3eb74a682aba1(83행, `releaseAtUtc`·`releaseAtKst` 포함) · `cpi-cuur0000sa0-2017-2026.json` d54c3f56b3d2e317(지수 118개월, 시험 fixture 용) · `test-cases-expected.json` 584ee43b818a4add · 원문 `bls-call1-*.json`·`bls-call2-*.json`·`fed-openmarket.htm`·`fed-fomccalendars.htm`·`fed-pr-20261028a.htm`·`fed-pr-20260916a.htm`·`fed-pr-20251210a.htm` · 참조 계산기 `t165_gen.py`.
- [00:02] **미확인·한계**: ① BLS 25회 한도가 IP 단위인지(문서 미명시) ② 2008-12-16 행의 "효력일" 표기 세부 ③ BLS 아카이브 파일명 날짜 = 실제 발표 시각 08:30 이라는 가정(2021~2024 개별 공지 미열람, 2025-12-18·2026 일정은 08:30 확인) ④ 2027 FOMC 일정은 tentative ⑤ 긴급 회의 미감지(§5) ⑥ 현 IS/OOS 창에 유형⑤ 0일이라는 T-164 한계는 그대로 — 이 라벨은 **기록용**이며 성과·에지를 뜻하지 않는다. 보고용 `risk_level: LOW`(판단 영향 0·외부 호출 하루 ≤ 수 회·DB 쓰기는 기존 run 행 필드 추가만).

## Leader — 구현 가이드

- [00:12] 설계 확정 — 근거는 위 Analyst §1~§10(라벨·임계·사유 코드·발표일·정적 표·낡음·기록 필드·캐시 정책·시험 기대값). 이 절은 **어디를 어떻게 바꾸는가**만 정한다. Analyst 고정값과 이 절이 어긋나면 Analyst 가 우선이고, 바꿔야 할 이유가 생기면 구현 전에 Leader 에게 묻는다.

### G1. 작업 위치·제약
- 서버 worktree `home_ubuntu:~/.node-local/stockinvest-t165`(detached, `origin/main` `ba3120a`, `node_modules` 는 심볼릭 링크 — **스테이징 금지**, `git add -A` 금지). 공유 트리에서 코드 작업·`reset`·`checkout`·`clean` 금지.
- 무거운 시험(전체 jest·`tsc`·`next build`)은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 …` 직렬로만, 로그는 `~/.node-local/t165-logs/` 아래.
- 공유 DB(NAS MariaDB)에 쓰는 시험 금지 — 목·가짜 Queryable 만. **시험 중 `api.bls.gov` 실호출 0건.** DDL·`system_config`·`.env` 변경 없음(필요해지면 멈추고 Leader 에게).
- 커밋하지 않는다(Reviewer·QA 뒤 Leader 가 커밋). `--no-verify` 금지.

### G2. 새 모듈 `src/lib/strategy/macro-regime/` (전부 SAFETY_PATHS 안)
| 파일 | 내용 |
|---|---|
| `types.ts` | 라벨 유니온 7개·사유 코드·`fetchStatus` 코드·기록 객체 타입(Analyst §7 필드명·타입 그대로), `RULE_VERSION = 'macro-regime-c0@1'` |
| `fomc-target-range.ts` | 33행 `{effectiveDate, lowerPct, upperPct}` + `VERIFIED_THROUGH = '2026-11-11'` + 정례 결정일 24건. 원천: 서버 `~/.node-local/t165-analyst/fomc-target-range-history.json`·`fomc-scheduled-meetings.json` 을 **그대로 옮긴다**(손으로 다시 치지 말고 스크립트로 변환 후 diff 확인). 파일 머리 주석에 출처 URL·확인 시각·운영자 갱신 절차(Analyst §5 한 단락) |
| `cpi-release-schedule.ts` | 83행 `{referenceMonth, releaseAtUtc|null}`(2025-10 = null). 원천 `bls-cpi-release-schedule.json`, 출처 주석 |
| `classify.ts` | **순수 함수** — 입력: `asOf: Date`, CPI 관측치 배열(또는 null), 캐시 메타(fetchedAt·fetchStatus), 표 3종(기본값 = 위 상수, 시험에서 주입 가능). I/O·`Date.now()`·전역 상태 0. 출력: Analyst §7 기록 객체. 예외를 던지지 않는다(입력 이상은 `unknown` + 사유) |
| `bls-cpi.ts` | 수집기 — URL 상수 1개(`https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0`, GET, 연도 미지정), `redirect: 'error'`, `AbortController` 타임아웃 5s(타이머 `unref`), **스트림으로 읽으며 64KB 초과 즉시 중단**(Content-Length 만 믿지 않는다), Analyst §8 응답 검증, 결과는 `{fetchStatus, observations?}` 로 반환하고 **절대 throw 하지 않는다**. `fetch` 구현을 주입할 수 있게 |
| `snapshot.ts` | 모듈 메모리 캐시 — 마지막 성공 관측치·수집 시각, 마지막 시도 시각, UTC 일별 시도 횟수, in-flight promise(단일 비행). `kickMacroRegimeRefresh(now?)`: 동기 반환(void), TTL 24h·실패 재시도 2h·하루 6회 조건을 만족할 때만 수집을 **시작만** 하고 기다리지 않는다. 그 promise 는 내부에서 모든 거절을 흡수한다(**unhandledRejection 0 — Node 는 처리 안 된 거절로 프로세스를 죽인다**). 실패 시 이전 캐시 유지. `getMacroRegimeRecord(now?)`: 동기, 캐시 + `classify` 결과 반환, 내부 예외 시에도 `unknown` 기록을 돌려준다(throw 0). 시험용 리셋·수집기 주입 함수 |
| `index.ts` | 엔진에 노출하는 것은 `kickMacroRegimeRefresh`·`getMacroRegimeRecord` 둘뿐 |

- **시험 환경 실호출 차단 장치**를 반드시 둔다: 수집기를 주입하지 않은 기본 경로가 jest 에서 네트워크로 나가지 않게(예: 기본 수집기는 `NODE_ENV === 'test'` 이면 `fetchStatus: 'disabled_in_test'` 류로 즉시 반환). 기존 엔진 시험들이 이 모듈을 모르고 `runMarket` 을 돌려도 실호출이 0이어야 한다. 이 장치 자체를 시험으로 고정. 운영 동작은 바꾸지 않는다.
- 운영 끄기 손잡이(선택, 권장): 환경변수 `MACRO_REGIME_BLS_DISABLED=true` 면 수집하지 않고 라벨은 `unknown(cpi_not_loaded)`. **기본(미설정) = 수집함** — `.env` 변경 없이 배포 즉시 동작한다. 추가하면 `.env.example` 에 주석 한 줄.

### G3. `src/lib/strategy/engine.ts` 변경 — 이 두 곳뿐
1. `runMarket()` 에서 `const rec = new EvalFunnelRecorder(market);` 직후 `kickMacroRegimeRefresh();` 한 줄(동기·void·무예외).
2. 최종 pass run 행(현재 1736행 `rec.record({ gate: 'run', verdict: 'pass', detail: {…} })`) detail 끝에 `macroRegime: getMacroRegimeRecord()` 추가.
- 🔴 **건드리지 않는 것**: `macro.ts`·`fetchMacroIndicators`·`MacroIndicators`·거시 게이트 블록(1459~1491행)·`withEngineLabels`·`adaptive-buy-sizing.ts`·AI 프롬프트·`eval-funnel.ts`·다른 run 행 3곳. `getMacroRegimeRecord()` 의 반환값을 detail 기록 외 어디에도 쓰지 않는다.

### G4. 시험 (새 파일 — `src/lib/strategy/macro-regime/__tests__/` 또는 `src/lib/strategy/__tests__/macro-regime-*.test.ts`)
1. `classify` — Analyst §9 전부: 분류 경계 9조합·반올림 경계·Δ 부동소수·결측(`"-"`·비숫자·`M13`)·기준월 결측 fallback·gap 3/4, 발표일 경계 5건(H4·H5·H12·H13 + 전날), 낡음 S1·S2·H15·H16, 역사 점검 H1~H14(**H1 2021-08-16 → `hot_hold`** 포함). 기대값 원천은 `~/.node-local/t165-analyst/test-cases-expected.json` — 시험 파일 안에 리터럴로 옮긴다(저장소 밖 파일을 시험이 읽지 않게). CPI 지수 fixture 는 `cpi-cuur0000sa0-2017-2026.json`(BLS 공공자료)을 `__tests__/fixtures/` 로 옮겨도 된다.
2. 정적 표 무결성 — 행 수(33·24·83)·날짜 오름차순·`upper − lower = 0.25`·특정 행 표본(2022-06-16 1.50–1.75 · 2026-09-17 3.75–4.00 · 2025-10 = null)·`VERIFIED_THROUGH` 값.
3. `bls-cpi` — 정상·timeout·HTTP 500·`REQUEST_NOT_PROCESSED`·JSON 깨짐·`seriesID` 불일치·64KB 초과(스트림)·리다이렉트·`"-"`·`M13` → `fetchStatus` 코드, throw 0.
4. `snapshot` — 미로딩 → `cpi_not_loaded` · 성공 후 정상 라벨 · TTL 24h 안 재시도 없음 · 실패 후 2h 안 재시도 없음 · UTC 일 6회 상한 · 동시 kick 2회 → 수집 1회(단일 비행) · 실패 시 캐시 보존 · 7일 초과 → `cpi_cache_stale` · 수집기가 동기 throw·reject 해도 kick·get 무예외 · unhandledRejection 0.
5. 🔴 **엔진 불변식** — 기존 엔진 시험 하네스(`src/lib/strategy/__tests__/engine*.test.ts` 계열 중 `runAll`/`runMarket` 을 끝까지 돌리는 것)를 재사용해 같은 입력으로 ⓐ 라벨 모듈 정상(unknown) ⓑ `hot_tightening` 강제 ⓒ `unknown` 강제 ⓓ `getMacroRegimeRecord` 가 throw 하도록 강제(엔진 쪽에서도 무해한지) 네 경우를 돌려 **eval_funnel 기록 행(최종 run 행의 `detail.macroRegime` 키만 제외)·시그널 생성 호출 인자·주문 금액·`runAll` 반환값이 직렬화 바이트 단위로 같음**을 단정. 거시 게이트 발동/미발동 두 상태 모두에서. (ⓓ 에서 엔진이 깨진다면 G3-2 를 `try/catch` 로 감싸는 대신 `getMacroRegimeRecord` 가 절대 throw 하지 않음을 시험으로 고정하는 쪽을 택하고 Reviewer 에게 근거를 남긴다.)
6. 의존 경계 가드 — `src/` 전체에서 `macro-regime` 을 import 하는 파일이 `engine.ts`(와 자기 디렉터리·시험)뿐임을 소스 스캔으로 단정(라벨이 판단 경로로 새지 않게).
7. 기존 시험 무수정 통과 — 특히 거시 게이트·`macro.ts` 관련 시험. 기존 시험 파일을 고쳐야 한다면 멈추고 Leader 에게 사유 보고.

### G5. 기타
- **버전**: `package.json` `0.6.0 → 0.7.0`, `package-lock.json` 의 같은 두 자리(최상위 `version`·`packages[""].version`). 이 task 커밋 묶음에서 한 번만. 다른 세션이 먼저 올리면 push 때 다시 맞춘다(메인 세션 몫).
- **문서**: `docs/api-integrations.md` 에 BLS 절(엔드포인트·키 없음·일 25회·호출 빈도·allowlist·실패 처리·라이선스 public domain), `docs/db-schema.md` eval_funnel 절에 run 행 `detail.macroRegime` 한 단락(30일 보관 한계 포함).
- **보고**: `## Developer` 절에 바꾼 파일·새 시험 수·전체 jest/tsc/build 수치(로그 경로)·불변식 시험 이름·Analyst 와 다르게 한 것(있으면 이유)·미실행 항목.

### G6. Leader 판단 기록 (설계 중 확인한 사실)
- [확실] `eval_funnel` 보관은 **30일**(`eval-funnel.ts` `RETENTION_DAYS = 30`, 6시간마다 배치 삭제). 그래서 T-164 의 C0→C1 승격 조건 「라벨 60거래일」을 **기록 행만으로는 셀 수 없다.** 다만 라벨은 순수 함수(정적 표 + 비계절조정 CPI)라 **과거 날짜의 라벨은 언제든 다시 계산**할 수 있고, 30일 롤링으로 사라지는 것은 운영 지표(수집 실패·미로딩 비율)뿐이다. DDL 없이 가는 이번 범위에서는 이 한계를 그대로 두고 사용자 보고의 결정 항목으로 올린다(영구 기록이 필요하면 별 task — 새 테이블 DDL 또는 기존 장기 보관 경로 검토).
- [확실] `strategy-eval` 은 웹 프로세스(`stockinvest`) 안에서 돈다(cron-runner 가 HTTP 로 부름) → BLS 호출 주체는 웹 프로세스 하나다(Analyst §8 의 "두 프로세스" 가정보다 호출 수가 적다).

### G7. Codex C1 지적 판정·반영 (Leader, 00:32) — C1 은 설계 단계라 Leader 가 판정하고 설계에 반영한다
| # | 지적 | 판정 | 반영 |
|---|---|---|---|
| 1 | [high] eval_funnel 30일 보관 → 60거래일 실측 라벨·오류율을 입증할 수 없다. 사후 재계산은 당시 캐시 상태를 재현하지 못한다 | **유효 — 사용자 결정으로 올린다** | 이 task 범위(DDL 없음·기존 기록 경로)에서는 저장 위치를 바꾸지 않는다. 대신 ① 기록 객체를 **자기완결적**으로 둔다(라벨 판정에 쓴 입력 — 지수·기준지수·월·발표 시각·수집 시각·수집 상태·금리 상단 2개 — 이 전부 들어 있어 행만으로 당시 판정이 재현된다, Analyst §7 그대로) ② 사용자 결정 항목: **첫 배포 + 30일(첫 삭제) 전에** 장기 보관 방식을 정한다 — (a) 새 테이블 DDL(사용자 승인) + 삭제 전 eval_funnel 행 이관 (b) 저장소 밖 JSONL 파일 (c) 30일 롤링 수용. 그 결정 전까지의 증거 소실은 없다(30일 창 안에서 이관 가능). 사후 재계산값을 운영 관측의 대체 증거로 쓰지 않는다는 문장을 `docs/db-schema.md` 단락에 넣는다 |
| 2 | [high] 발표 연기 시 사후 재계산에 look-ahead(예정 시각 ≤ asOf 를 통과하지만 실제 발표는 늦었음) | **유효 — 반영** | 발표 일정 표 각 행에 `confirmed: boolean` 을 둔다 — 실제 발표가 확인된 행(BLS 아카이브 파일명 날짜 기반 2021-01~2026-09 치, 그리고 API 에 이미 값이 있는 2026-10 치)은 `true`, 일정표에서 온 미래 행은 `false`. `classify` 에 옵션 `releaseBasis: 'live' \| 'confirmed_only'`(기본 `live`). **운영 기록은 `live`**(연기돼도 API 에 값이 없어 자동 안전 — Analyst §3), **과거 재계산·백테스트는 `confirmed_only`** 만 허용(미확인 행 = 미발표). 운영자 갱신 절차에 "발표 후 해당 행을 `confirmed: true` 로(날짜가 달랐으면 실제 날짜로 고쳐서)" 를 추가. 시험: 예정 T·실제 T+1·최신 응답 주입 → `confirmed_only` 에서 T~T+1 구간은 이전 월 사용 |
| 3 | [medium] 성공 TTL 24h 가 발표 시각을 모른다 → 발표 뒤 최대 ~24h 이전 CPI 로 정상 라벨 기록, 사유에도 안 남는다 | **유효 — 반영** | 갱신 조건에 **발표 인지 무효화**를 더한다: `fetchedAt < releaseAtUtc(M) ≤ now` 인 월 M 이 있으면(= 마지막 수집 뒤 발표가 지나감) TTL 과 무관하게 갱신 대상(재시도 간격 2h·일 6회 상한은 그대로 적용). 발표 뒤 받은 성공 응답에 M 이 아직 없으면 2h 뒤 재확인(상한 안). 기록 필드 추가: `cpi.expectedReferenceMonth`(지금 시각 기준 발표가 지난 가장 최근 월 — 일정표 기준) 와 `cpi.lagsSchedule: boolean`(`referenceMonth` 가 그보다 이르면 true — 미공표 월 fallback 때도 true 가 되며 그건 정상 사유와 함께 읽는다). 시험: 발표 전날 15:55 ET 수집 성공 → 다음 날 08:30 ET 이후 첫 kick 에서 갱신 시작 |
| 4 | [medium] 불변식 시험에 '미주입' 기준군과 갱신 지연 격리 검증이 없다 | **유효 — 반영** | G4-5 에 ⓔ **기준군**(macro-regime 모듈을 모킹해 kick 은 no-op, `getMacroRegimeRecord` 는 호출되지 않는/기록 키 없는 상태 — 즉 변경 전 동작)을 추가하고 ⓐ~ⓓ 를 모두 ⓔ 와 비교한다. ⓕ 갱신 promise 가 **끝나지 않는(pending)** 수집기를 주입해도 `runAll` 이 기준군과 같은 결과로 끝나는지. 입력은 **실제 시그널 후보·생성이 1건 이상 나오는** 것으로 고른다(빈 비교 금지) — 시험 안에서 그 건수가 ≥1 임을 단정 |

- 1번의 사용자 결정은 최종 보고의 「사용자가 결정할 것」에 기한(첫 배포 + 30일 전)과 함께 올린다. 라벨 임계·라벨 집합·`ruleVersion`(`macro-regime-c0@1`)은 바뀌지 않는다 — 2·3번은 운영 갱신 정책과 기록 메타데이터, 재계산 옵션만 더한다.

## Developer

- [00:58] 범위·실행: 서버 worktree `~/.node-local/stockinvest-t165`(detached `ba3120a`)에서 구현. 커밋·스테이징 없음. 공유 DB 쓰기·DDL·`system_config`·`.env` 변경 0, **BLS 실호출 0**(구현·시험 전 과정 — Analyst 저장 원문을 fixture 로 사용). 실행 도구: claude(developer).
- [00:58] 바꾼 파일 6: `src/lib/strategy/engine.ts` +5(G3 두 곳만 — import 1줄 · `new EvalFunnelRecorder(market)` 직후 `kickMacroRegimeRefresh();` · 최종 pass run 행 detail 끝 `macroRegime: getMacroRegimeRecord(),`, 주석 2줄) · `package.json`·`package-lock.json` 0.6.0→0.7.0(lock 최상위·`packages[""]` 두 자리) · `.env.example` +3(`MACRO_REGIME_BLS_DISABLED` 주석, 기본 미설정=수집) · `docs/api-integrations.md` +21(BLS 절) · `docs/db-schema.md` +12(eval_funnel 최종 run 행 `detail.macroRegime` 단락 — 30일 보관 한계·장기 보관 사용자 결정 기한·"사후 재계산값을 운영 관측의 대체 증거로 쓰지 않는다" 문장 포함).
- [00:58] 새 파일 `src/lib/strategy/macro-regime/`(전부 SAFETY_PATHS `^src/lib/strategy/` 안): `types.ts` 148 · `fomc-target-range.ts` 89 · `cpi-release-schedule.ts` 126 · `classify.ts` 296(순수 함수) · `bls-cpi.ts` 220(수집기) · `snapshot.ts` 194(캐시·갱신) · `index.ts` 7(엔진 노출 kick·get 둘뿐) · 시험 `__tests__/` 6파일(classify 401 · static-tables 114 · bls-cpi 238 · snapshot 285 · engine-invariant 337 · dependency-boundary 68줄) · fixture 3(`analyst-expected-cases.ts` 525 — 오라클 18건 리터럴 · `cpi-cuur0000sa0-2017-2026.json` Analyst 파일 그대로 sha d54c3f56b3d2e317 · `bls-v1-get-CUUR0000SA0.json` Analyst 호출 1 원문 그대로 sha e7cb0700f8301108).
- [00:58] 정적 표 변환·원천 대조: 저장소 밖 `~/.node-local/t165-devtools/gen_tables.py` 가 Analyst JSON(sha 앞 16자 ad49082d53c35f33 · 627102cd26a86095 · 2be3eb74a682aba1 · 584ee43b818a4add — §10 기록과 일치 확인)을 읽어 TS 상수·오라클 fixture 를 생성(손으로 치지 않음). `verify.js` 가 생성 TS 를 transpile 해 원천 JSON 과 deep-equal — FOMC 33행 · 결정일 24건 · 발표 일정 83행(기준월·releaseAtUtc) **전부 일치**, `VERIFIED_THROUGH=2026-11-11` 일치. `confirmed` 는 G7-2 대로 변환 때 기준월 ≤2026-10 → true(70행), 2026-11~ → false(13행).
- [00:58] 분류 전수 대조: Analyst `t165_gen.py` 의 classify 원문을 잘라 그대로 실행(파일 쓰기 부분은 실행 안 함)한 결과와 TS `classifyMacroRegime` 을 2009-01-01~2028-01-14 매일 12개 시각 + 모든 발표 시각 ±1s·±60s, **83,682 시점**에서 비교 → 라벨·isType5·사유 코드·ET 날짜·cpi/rate 전 필드 **ALL MATCH**(분포 unknown 57,932 · normal_easing 6,509 · normal_hold 5,838 · hot_tightening 5,834 · hot_hold 4,137 · normal_tightening 3,422 · hot_easing 10).
- [00:58] 새 시험 206건(6파일, 전부 통과): classify 89(오라클 18건 + 발표 전날·2023-05 경계 실제 날짜 + 합성 9조합 · 반올림 3.95/3.949 · Δ 부동소수 · 결측 6종 · gap 3/4 · releaseBasis G7-2 5건 · G7-3 필드 4건 · 사유 순서 · 무예외 5종 · DST 경계 8건) · static-tables 24 · bls-cpi 42(정상 · timeout 3종 · 500 · 3xx · 리다이렉트 · REQUEST_NOT_PROCESSED · JSON 깨짐 · seriesID · 64KB 스트림 · Content-Length · sync throw · 이상 응답 · 검증 15종 · 시험 환경 차단 3건) · snapshot 24(G4-4 전 항목 + G7-3 발표 인지 갱신 2건 + 끄기 손잡이 + 정체 비행) · engine-invariant 22 · dependency-boundary 5.
- [00:58] 🔴 불변식 시험 `src/lib/strategy/macro-regime/__tests__/engine-invariant.test.ts`: T-148 하네스를 복제(기존 파일 무수정)해 같은 입력으로 `runAll({market:'domestic'})` 를 ⓔ 기준군(macro-regime 모킹 — kick no-op·기록 undefined = detail 에 키 없음, 변경 전 동작) 대비 ⓐ 실제·미로딩 · ⓐ' 실제·캐시 적재(normal_hold) · ⓑ hot_tightening 강제 · ⓒ unknown 강제 · ⓓ 분류 내부 throw 강제(→ internal_error 로 흡수) · ⓕ 끝나지 않는 수집 — 3장면(게이트 미발동·고정 한도 / 미발동·적응형 무제한 배분 금액 / **게이트 발동**) × 7. 비교: runAll 반환 · createSignal 인자(금액·수량) · allocate · portfolioGuard · prefilter · setCooldown · sendAlert(Throttled) 인자 · eval_funnel INSERT 전체 · 그 밖 DB 질의 전체를 `JSON.stringify` 한 문자열의 **완전 일치**(제외 둘: 최종 run 행 `detail.macroRegime`, 프로세스당 6h 타이머인 eval_funnel 보관 DELETE). 빈 비교 금지: 미발동 장면 createSignal·prefilter·가드 각 ≥1, 적응형 배분 금액 [155000, 145000], 발동 장면 `regime_gate_macro_bear` 행 6종목 전부 + 차단 알림. 라벨 키는 최종 pass run 행 1개에만, kick·get 각 1회 단정. 5회 반복 실행 모두 22/22.
- [00:58] 변이 확인(되돌림 완료, engine.ts sha 6c4c4b9d5d8e3239 복원 확인): `buyBlocked` 에 `getMacroRegimeRecord()?.isType5 === true` 를 섞으면 ⓑ 가 미발동 두 장면에서 바이트 비교로 실패(나머지 변형은 호출 횟수 단정으로 실패) → 라벨이 판단에 새면 이 시험이 잡는다. 발동 장면에서는 ⓑ 도 같다(이미 매수 차단) — 미발동 장면이 필요한 이유.
- [00:58] ⓓ 근거(G4-5 괄호 지시 이행): `getMacroRegimeRecord` **자체**를 던지는 모의로 바꾸면 엔진은 최종 run 행을 만들다 던진다(G3 대로 엔진에 try/catch 없음). 엔진을 감싸지 않고 공개 함수 무예외를 시험으로 고정했다 — snapshot 「분류기가 던져도」·「잘못된 시각」, classify 「무예외 5종」, invariant ⓓ. 공개 함수는 내부 전체 try/catch + 분류 함수 자체 try/catch 의 2겹.
- [00:58] 시험 중 실호출 0 장치(G2): `bls-cpi.ts` 기본 경로(수집기 미주입)는 `NODE_ENV==='test'` 또는 `JEST_WORKER_ID` 가 있으면 네트워크 없이 `disabled_in_test` → 기존 엔진 시험이 모르고 `runAll` 을 돌려도 실호출 0. 고정 시험: bls-cpi 「fetchImpl 미주입 → 전역 fetch 호출 0」·「운영 흉내(NODE_ENV=production, JEST_WORKER_ID 삭제)면 전역 fetch(모의)로 BLS URL 호출 — 차단은 시험 환경에만」, snapshot 「기본 경로 네트워크 0」. bls·snapshot·invariant 시험은 전역 fetch 를 던지는 jest.fn 으로 바꾸고 afterEach 에서 호출 0 단정. 처리 안 된 거절: jest 가 시험 중 unhandledRejection 을 시험 실패로 만든다는 것을 대조 실험으로 확인(시험 코드의 `process.on` 리스너는 jest process 대역이라 0건만 보여 부적합) → 거절 경로 3종 시험이 그 판정 창 안에서 통과.
- [00:58] 전체 검증(서버, `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`, 로그 `~/.node-local/t165-logs/`): 전체 jest `jest-full-r1.log` — 스위트 459 중 통과 425·실패 27·스킵 7, 테스트 통과 11,836·실패 416·스킵 270(163초). **실패 27스위트·416건은 전부 기존 결함**: 같은 27개를 `ba3120a` 원본(`git archive` 로 별도 디렉터리, 같은 node_modules)에서 돌려 스위트·테스트 이름 단위로 동일 실패 확인(`jest-failing-*-r2.json`·`jest-diff3-*.json`, 대조 스크립트 `t165-devtools/cmp_json.py`) — 원인: React 중복 사본(Invalid hook call — node_modules 심볼릭 링크 경로) 렌더 시험 + T-156 이후 펜스·격리 목록 미갱신(m40·daily-bars-store 등). 이 task 파일은 그 목록에 없다. tsc `--noEmit` rc=0(`tsc-r1.log`, incremental) · `--incremental false` 재실행 rc=0(`tsc-noincremental-r2.log`) · `next build` rc=0(`build-r1.log`, SIGNUP_INVITE_CODE 경고는 기존 빌드 시점 경고) · 새 시험 파일 타입 검사(저장소 tsconfig 가 시험을 제외해 임시 tsconfig) rc=0(`tsc-tests-r4.log`). lint: 저장소에 ESLint 설정 파일이 없어 미실행.
- [00:58] Analyst·가이드와 다르게 한 것(이유): ① **Analyst §1·§2 사실 정정** — v1 GET 실측 원문 `data` 36행은 월 34개(2024-01~2026-10) + **M13 연평균 2행**(2024·2025)이다("36개월"·"M13 은 이 시리즈에 없음" 과 다름). M13 제외 규칙이 실제로 필요하고 시험이 원문으로 고정. ② 사유 코드 `internal_error` 추가(분류·기록 코드 자체 예외를 엔진에 넘기지 않고 끝낼 코드) · 수집 결과 코드 `network_error`(DNS·연결·`redirect:'error'` 거절)·`internal_error`·`disabled_in_test`(G2) 추가 · 기록용 `not_attempted`·`disabled`(끄기 손잡이). ③ `cpi_not_loaded` 일 때 `cpi_stale` 를 겹쳐 적지 않음(미로딩을 오류와 따로 세기 위해, Analyst 미명시). ④ 응답 값이 숫자·`"-"` 외면 §8 대로 응답 전체 `bad_schema`(캐시 보존), 분류 단계에서는 §2 대로 비유한 값을 결측 처리. 유효 월 0개(빈 data)도 `bad_schema` — 빈 응답으로 캐시를 덮어쓰지 않게. ⑤ 정체 비행 안전망: 10분 넘게 안 끝난 수집은 버리고 새 시도 허용(2h 간격·일 6회는 그대로) — 수집기 자체 5s 마감의 이중 안전. ⑥ `fetchedAt` = 시도 **시작** 시각(발표 인지 갱신에 보수적). ⑦ CPI 탐색 0~3개월 전만(오라클의 0~6 + gap>3 → stale 과 동치 — 전수 대조로 확인). ⑧ 오라클 기대값은 시험 본문이 아니라 같은 `__tests__/fixtures/analyst-expected-cases.ts` 리터럴(저장소 안, 생성물 표시). ⑨ 2025-10 행(`releaseAtUtc:null`)은 미공표가 확인된 사실이라 `confirmed:true`. ⑩ `lagsSchedule` 은 기준월이 없고 예정 월이 있으면 true. ⑪ `asOfUtc`·`fetchedAtUtc` 는 초 단위 ISO(오라클 형식과 같게). 라벨 집합·임계·`ruleVersion` 은 그대로.
- [00:58] 미실행·미검증: BLS 실호출을 통한 운영 경로(Next 서버 런타임 fetch 에서 `cache:'no-store'`·`redirect:'error'` 실제 동작, 실측 지연·크기 — 의도적으로 하지 않음) · 운영 cron 런의 실제 기록 · BLS 25회 한도의 IP 단위 여부 · `@/lib/api-usage`(T-040) 호출 기록 미연결(`ApiId` 에 `bls` 없음 — 공유 패키지 타입 보강이 필요해 범위 밖, Leader 판단 사항) · 휴장 중에는 `runMarket` 이 kick 전에 반환하므로 BLS 호출은 장중 런에서만 일어난다(G3 배치 그대로). 전체 jest 뒤 bls-cpi 시험의 타입 표기 1줄(`respond` 인자 타입)만 고쳤다 — 동작 변화 없음, 새 시험 206/206 재확인.
- [00:58] 인계: 커밋·스테이징 안 함. `node_modules`(심볼릭 링크)는 미추적 그대로 — 스테이징 금지. 저장소 밖 재현 자료: `~/.node-local/t165-devtools/`(gen_tables.py · oracle_grid.py · verify.js · heavy.sh · heavy2.sh · cmp_json.py · tsconfig.tests.json). risk_level 보고값 MEDIUM(엔진 본체·무인 실행 경로 + 새 외부 원천, 판단 영향 0 은 불변식·의존 경계 시험으로 고정).
- [01:28] Codex C2·Reviewer 01:40 수정 요청 반영(같은 서버 worktree, 커밋 없음). 분류 규칙·임계·라벨·`ruleVersion`·`engine.ts`(sha 6c4c4b9d5d8e3239 그대로)·정적 표는 바꾸지 않았다. LOW-3·4·5 는 수정하지 않음(지시대로 기록만). 실행 도구: claude(developer).
- [01:28] C2-1 ① `bls-cpi.ts` `parseBlsCpiResponse` — 유효 월 0개 검사 뒤에 **사용 가능한 YoY 쌍**(어떤 월 M 과 M−12 가 모두 양의 유한 숫자) 0개면 `bad_schema`(`hasUsableYoyPair`). 결측(`"-"`)이 섞인 정상 응답은 통과. ② `snapshot.ts` `applyResult` — 기존 캐시가 있고 `ok` 응답의 가장 늦은 숫자 월(`latestNumericMonth`)이 기존보다 이르면 교체하지 않고 `lastStatus='bad_schema'`(캐시·`fetchedAt` 보존 → TTL 이 지난 상태면 2h 간격 뒤 재시도). 최신 월이 같거나 늦으면 평시대로 교체. 두 장치는 상보적이다 — 최신 월이 같은 한 달짜리 응답은 ②로는 못 막고 ①이 막는다.
- [01:28] C2-2 `bls-cpi.ts` 본문 읽기 실패 분기(타임아웃·network_error)에서 반환 전 `void reader.cancel().catch(() => {})`(try 로 한 번 더 감쌈) — signal 을 무시하는 본문 스트림도 닫힌다.
- [01:28] 문서: LOW-6 `docs/api-integrations.md` 호출 빈도 칸에 "일 6회 카운터·2h 간격은 프로세스 메모리라 재기동 때 0 — 실패가 이어지는 날 시도 수 상한 min(6×(재기동 수+1), 재기동 수+13)(재기동 0회 6·2회 15, 대략 12+재기동 수), 성공 상태에서는 재기동당 1회" 한 문장. 같은 표의 응답 검증 칸(YoY 쌍 0개 → `bad_schema`)·실패 처리 칸(후퇴 응답 → 교체 안 함·`bad_schema`)도 새 동작에 맞게 한 문장씩 보탰다. 모듈 머리 주석 2곳도 같은 내용.
- [01:28] 시험(이번 task 가 새로 만든 파일만 수정): `bls-cpi.test.ts` 42→52 — C2-1 (a) 한 달 응답·`"-"` 한 달 응답·짝 없는 10개월·짝 한쪽 `"-"`·M13 끼리 → `bad_schema`, 짝 1개 → ok(하한), (b) 실제 34개월 원문(2025-10 `"-"`) → ok, (a) 수집 경로에서도 한 달 응답 → `bad_schema` · C2-2 signal 을 무시하는 본문 스트림이 타임아웃 뒤 cancel 받음, 본문 스트림 오류 → `network_error`·무예외. 기존 시험 「`"-"` 는 null, M13 건너뜀」은 새 하한(쌍 1개)을 만족하도록 입력에 2024-09 행 1개를 더했다(단정 대상 동작은 같음). `snapshot.test.ts` 24→29 — (c) 정상 캐시 뒤 한 달 응답(실제 파서 경유 `bad_schema`)에도 캐시·수집 시각·라벨 그대로 · 후퇴 ok 응답(최신 2026-08)은 교체 안 함·`bad_schema`·2h−1ms 무호출/2h 재시도 · 최신 월이 같으면 정상 교체 · 캐시 없을 때는 쌍 있는 ok 응답 수용 · `latestNumericMonth` 단위. `classify.test.ts` LOW-9 시험 이름만 실제 단정(부동소수 오차뿐인 Δ → 정확히 0 → hold)에 맞게 수정(89건 그대로). (d) '빈 data'·'M13 만' 은 그대로 `bad_schema` 로 통과.
- [01:28] 변이 확인(되돌림 완료, `bls-cpi.ts` sha 92c71f6eff3cdffe · `snapshot.ts` ade71c4936c0c169 복원 확인): 쌍 검사 줄 제거 + 후퇴 방어 조건을 `false` 로 바꾸면 새 C2-1 시험 8건 실패(로그 `jest-c2-mutation.log`) · cancel 줄 제거하면 C2-2 cancel 시험 1건 실패(`jest-c22-mutation.log`) → 새 시험이 수정 전 동작을 실제로 잡는다.
- [01:28] 결과: `src/lib/strategy/macro-regime` 전체 6스위트 **221건 전부 통과**(classify 89 · static-tables 24 · bls-cpi 52 · snapshot 29 · engine-invariant 22 · dependency-boundary 5, `jest-macro-regime-c2-final.log`) — 불변식 시험 22/22 포함. `tsc --noEmit`(락 아래) rc=0 `tsc-c2.log` · 새 시험 타입 검사(임시 tsconfig) rc=0 `tsc-tests-c2.log`. 전체 jest·build 는 지시대로 실행하지 않음(QA 몫). BLS 실호출 0·공유 DB 0·기존(저장소) 시험 무수정. 줄 수 변화: `bls-cpi.ts` 220→237 · `snapshot.ts` 194→216 · `bls-cpi.test.ts` 238→292 · `snapshot.test.ts` 285→341.

## Reviewer

- [01:06] 범위·방법: 서버 worktree `~/.node-local/stockinvest-t165`(detached `ba3120a`) 미커밋 작업 트리를 `git diff`·`git status` 와 파일 직접 읽기로 감사. 파일 수정 0(감사용 복사본·스크립트는 저장소 밖 `~/.node-local/t165-reviewer/` 에서만 만들었고 복사본은 삭제). BLS 실호출 0. 실행 도구: claude(reviewer).
- [01:06] 읽은 것: `engine.ts` diff 전부 · `macro-regime/` 의 `index.ts`·`snapshot.ts`·`bls-cpi.ts`·`classify.ts`·`fomc-target-range.ts`·`cpi-release-schedule.ts`(머리 주석 + 83행 정규식 전수 점검)·`types.ts`(상수·유니온 선언부) · 시험 `engine-invariant`·`dependency-boundary`·`static-tables` 전문, `snapshot.test` 항목 목록(전문 아님), `classify.test`·`bls-cpi.test`·`analyst-expected-cases.ts` 는 01:06 시점에는 본문을 읽지 않았다 → 01:25 보완 검토에서 정독(아래) · docs 두 곳·`.env.example`·`package*.json` diff.
- [01:06] **1 판단 영향 0 [확실]**: `engine.ts` 변경은 정확히 G3 의 두 곳(kick 1줄 · 최종 pass run 행 detail 끝 `macroRegime: getMacroRegimeRecord()`)과 import 1줄. `macroRegime`·`getMacroRegimeRecord`·`kickMacroRegimeRefresh` 의 `src/` 내 참조는 engine.ts 뿐(grep). `macro.ts`·거시 게이트(`buyBlocked` 산식)·`adaptive-buy-sizing`·프롬프트·`eval-funnel.ts` 무변경(`git status` 에 없음). 기존 시험 파일 무수정. 불변식 시험은 기준군(ⓔ: 모듈 모킹, kick no-op·기록 undefined)과 ⓐ~ⓕ 를 `JSON.stringify` **완전 일치**로 비교하며 제외는 `detail.macroRegime` 키와 6h 타이머 DELETE 둘뿐(코드 확인). 장면 3개에서 `createSignal`≥1·`prefilter`≥1·가드≥1(미발동) / 게이트 6종목 skip 행·차단 알림(발동)을 단정해 빈 비교가 아니다. **변이 재현**: 감사용 복사본에서 `buyBlocked` 에 `getMacroRegimeRecord()?.isType5 === true` 를 섞어 불변식 시험 실행 → ⓐ~ⓕ 가 모두 실패(Developer 변이 보고와 일치), 복사본은 삭제. 한계: 호출 횟수 단정(`kick:1,get:1`)이 ⓐ 계열 실패의 일부 원인이라, 값만 읽고 호출 횟수를 늘리지 않는 누설은 경계 시험(import 위치·호출 수 문자열 스캔)이 막는다 — 두 장치의 합으로 충분하다고 판단.
- [01:06] **2 실패 무해·틱 지연 0 [확실, 코드·시험]**: `kick` 은 전체 try/catch, 동기 void, 수집은 `Promise.resolve(fetcher())` 를 `.then(ok,err).catch().finally()` 로 흡수(처리 안 된 거절 경로 없음), 동기 throw 도 별도 try. 수집기 `fetchBlsCpi` 는 최상위 try/catch + 5s 마감(헤더·본문 모두 `Promise.race([..., aborted])`, 타이머 `unref`) + 64KB 스트림 상한(초과 시 `reader.cancel`) + Content-Length 선검사 + `redirect:'error'` + URL 상수 1개·`isAllowedBlsUrl` 확인. 단일 비행은 `inFlight`, 10분 넘은 비행 폐기는 단일 비행·간격·일 상한과 충돌하지 않는다(폐기 뒤에도 2h 간격·일 6회 검사가 이어진다). `getMacroRegimeRecord` 는 전체 try/catch + `internalErrorRecord`(자체도 try). 틱 임계 경로의 추가 비용은 분류 1회(표 83행 순회·Intl 포맷 2회, 수 마이크로초~sub-ms). **하루 호출 수 상한(코드로 계산)**: 프로세스(=`stockinvest` 웹, `instances:1`)당 UTC 일 시도 6회가 하드 상한, 실패 시 재시도 간격 2h 라 실패 지속 시 6회/일. 성공 정상 상태는 TTL 24h 1회 + 월 1회 발표 인지 갱신(+ 발표 직후 값 미반영 시 2h 간격 재확인, 상한 안) ≈ 1~3회/일. 한계는 프로세스 메모리 카운터라 **재기동마다 0 으로 리셋**(MEDIUM-2 참조). cron 프로세스(`stockinvest-cron`)는 HTTP 로 부를 뿐 `runMarket` 을 직접 돌리지 않는다(`runAll`·`runMarket` 호출처는 `strategy-eval` 라우트뿐, grep).
- [01:06] **3 look-ahead 부재 [확실 — 독립 재구현으로 대조]**: 발표 비교는 `asOfMs >= Date.parse(releaseAtUtc)`(등호 포함, 절대 시각이라 서머타임은 표의 UTC 값이 처리), 달력일·월은 `Intl` America/New_York, 금리는 효력일 ≤ ET 달력일, 6개월 전은 같은 일·없으면 말일, gap 0~3, `confirmed_only` 는 `confirmed!==true` 행을 미발표 취급, 2025-10(null) 은 fallback. 나는 Developer·Analyst 코드와 무관하게 파이썬으로 **새로 구현**했다 — 지수는 BLS 원문 응답(`bls-call2-…json`)에서, 금리 표는 저장된 연준 `fed-openmarket.htm` 을 직접 파싱(33행 재현), 발표 일정은 TS 표에서 — 2017-01-01~2026-11-12 를 7시간 간격 + 모든 발표 시각 ±60s·+3h, **12,628개 시점**에서 TS `classifyMacroRegime` 라벨과 비교 → 불일치 0(분포 hot_tightening 1715·normal_tightening 911 등 6라벨 모두 등장). 한계: 이 재구현은 같은 사양(Analyst §2~§6)을 따르므로 사양 자체의 오류는 못 잡는다.
- [01:06] **4 정적 표 정확성 [확실 — 원문 HTML 직접 대조]**: 정책금리 33행은 저장된 `fed-openmarket.htm` 을 내가 파싱한 33행과 연도별 행 수(2008 1·2015 1·2016 1·2017 3·2018 4·2019 3·2020 2·2022 7·2023 4·2024 3·2025 3·2026 1)·날짜·하단/상단이 전부 일치(경계 행 2008-12-16, 2020-03-04/16, 2022 인상 7회, 2025-09-18·10-30·12-11, 2026-09-17 포함). 정례 결정일은 `fed-fomccalendars.htm` 에서 2025(8)·2026(8)·2027(8, "각 회의 날짜는 tentative" 문구 확인) 24건이 전부 일치, 2025-08-22 notation vote 제외 정당. CPI 발표 일정 83행(확인 70/미확인 13)은 ① 전 행 08:30 ET 환산·평일·기준월 종료 후·시간순 점검 통과 ② 2023-01~2025-08 32개월을 내 기억의 실제 BLS 발표일과 대조해 불일치 0 `[가능성 높음 — 외부 원문이 아니라 기억 기준]` ③ 2021~2022 12개월+6개월 동일. 서버에는 BLS 일정의 원문 HTML 이 없어(Analyst 기록: bls.gov HTML 403) **일정 표 전수의 원문 대조는 하지 못했다.** 낡음 감지: `rate_table_stale`(지난 결정일 > VERIFIED_THROUGH)·`rate_schedule_exhausted`(마지막 결정일 2027-12-08 초과)가 코드에 있고, 2026-12-10 이후 갱신 없으면 `unknown(rate_table_stale)` 로 떨어짐을 직접 실행으로 확인. 갱신 절차 주석은 두 파일 머리에 있다. 한계 주석: 2028-01 회의가 이미 공지된 상태(연준 페이지 "Note: January 25-26, 2028")라 `rate_schedule_exhausted` 는 2027-12-09 부터 `unknown` 이 되는데 실제로는 다음 회의가 2028-01-26 이라 낡음 감지가 한 달가량 조기 발동한다(보수적 방향 — 기록용이라 무해, LOW-5).
- [01:06] **5 외부 호출 경계 [확실]**: URL 상수 `https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0` 1개, GET, 키·헤더 비밀 없음(`Accept` 만), `redirect:'error'`, 시험 환경(`NODE_ENV==='test'` 또는 `JEST_WORKER_ID`) 기본 경로는 `disabled_in_test` 로 네트워크 0 — 운영(production, JEST_WORKER_ID 없음) 동작은 바뀌지 않으며 시험이 그 사실을 고정(운영 흉내 시 전역 fetch 호출 단정). `MACRO_REGIME_BLS_DISABLED=true` → kick 즉시 반환, 분류는 캐시를 무시하고 `cpi_not_loaded`/`fetchStatus:'disabled'`. 환경변수 읽기는 이 한 개뿐이고 클라이언트 번들로 새는 경로 없음(서버 전용 모듈, `NEXT_PUBLIC_` 아님).
- [01:06] **6 DB 변경보다 먼저 배포돼도 안전 [확실]**: DDL·`system_config`·`.env` 필수 변경 없음. 기록은 기존 `eval_funnel.detail`(JSON) 키 추가뿐이고 한도는 `safeJson` 60,000자 초과 시 detail 전체가 `{truncated:true,size}` 로 대체된다. 실측 `macroRegime` 직렬화 715B(+기존 run 행 detail 은 전략 ID 목록·청산 트랙 요약 수준) → 여유 충분. 같은 키를 읽는 기존 코드(`exit-lines.ts` 등)는 `gate='run'` 행의 다른 키/시각만 쓴다.
- [01:06] **7 Developer 가이드 이탈 7건 판정**: ① Analyst §1 "36개월·M13 없음" 정정(실제 M13 2행 포함) — 타당, 파서가 M13 을 건너뛰고 원문 fixture 로 고정. ② 사유·상태 코드 추가(`internal_error`·`network_error`·`disabled_in_test`·`not_attempted`·`disabled`) — 타당(코드 목록은 `docs/db-schema.md`·`api-integrations.md` 에 반영됨). ③ `cpi_not_loaded` 일 때 `cpi_stale` 생략 — 타당(승격 지표에서 미로딩과 오류를 분리하려는 Analyst §8 의도와 일치, 코드·재구현 대조에서 라벨은 동일). ④ 빈 data → `bad_schema` — 타당(빈 응답으로 캐시 덮어쓰기 방지). ⑤ 10분 정체 비행 폐기 — 무해(수집기 자체 5s 마감이 1차, INFO-6). ⑥ 수집 시각=시도 시작 시각 — 보수적이라 타당. ⑦ 탐색 0~3개월 — Analyst 0~6+gap>3 과 동치임을 12,628 시점 대조로 확인.
- [01:06] **8 Codex C1 4건 반영 확인**: 지적1(30일 보관) — 사용자 결정으로 올렸고 `docs/db-schema.md` 단락에 30일 한계·장기 보관 결정 기한(첫 배포 후 30일 전)·"사후 재계산값을 운영 관측의 대체 증거로 쓰지 않는다" 문장이 있고, 기록 객체는 판정 입력(지수·기준지수·월·발표 시각·수집 시각·상태·금리 상단 2개)을 모두 담아 자기완결적임을 코드로 확인. 지적2 — `confirmed`·`releaseBasis:'confirmed_only'` 구현(`classify.ts` `releasedAt`)과 시험 5건 존재. 지적3 — `wantsRefresh` 에 `fetchedAt < latest.at`(발표 인지)·최신 월 값 부재 시 재확인, 기록 필드 `expectedReferenceMonth`·`lagsSchedule` 구현, 발표 전날 15:55 ET→08:30 ET 시험 있음. 지적4 — 기준군 ⓔ·pending 수집 ⓕ·≥1 단정 구현. 판정: 4건 모두 **채택·반영 완료**(Reviewer 별도 오탐 판정 없음).
- [01:06] 시험 직접 실행: `cd ~/.node-local/stockinvest-t165 && node ./node_modules/jest/bin/jest.js src/lib/strategy/macro-regime` → **Test Suites 6 passed / Tests 206 passed / 0.567s**(bls-cpi·snapshot·engine-invariant·dependency-boundary·classify·static-tables). 전체 jest·tsc·build 는 실행하지 않았다(QA 몫; Developer 보고의 기존 27스위트 실패 대조는 내가 재현하지 않았다).
- [01:06] 지적 목록(CRITICAL 0 · HIGH 0 · MEDIUM 2 · LOW 4 · INFO 2):
- [01:06] MEDIUM-1 `bls-cpi.ts:97-130` — 운영 런타임의 실제 BLS 호출(Next 서버 fetch, `user-agent` 기본값, `redirect:'error'`, 5s)이 한 번도 실측되지 않았다(Developer 도 미검증으로 보고). Analyst 의 curl 은 200 이었으나 같은 호스트 계열(www.bls.gov)이 curl 에 403 을 낸 이력이 있어 기본 UA 가 차단될 가능성을 배제하지 못한다 `[추측]`. 영향: 차단되면 `cpi.fetchStatus: http_error`·라벨 `unknown(cpi_not_loaded)` 만 기록되고 판단 영향은 없으나 C0 의 목적(라벨 기록)이 통째로 무효가 된다. 권고: 배포 직후(또는 QA 가 허용하면 서버에서 동일 코드 경로 1회) 첫 `strategy-eval` 런의 run 행 `detail.macroRegime.cpi.fetchStatus` 가 `ok` 인지 Leader 보고의 사용자 확인 항목에 넣는다. 코드 수정 불필요.
- [01:06] MEDIUM-2 `snapshot.ts:98-113` — 일 6회 상한이 **프로세스 메모리**라 재기동마다 0 으로 돌아간다. 실패가 지속되는 날(BLS 차단·장애) 재기동·배포 N회 → 최대 6×(프로세스 수명 수) 회 시도하여 미등록 일 25쿼리를 넘길 수 있다(5회 이상). 영향: 한도 초과 시 BLS 가 `REQUEST_NOT_PROCESSED` 를 주어 그날 수집이 실패로 기록될 뿐, 판단 영향 0·자금 영향 0. 정상(성공) 상태는 수명당 1~3회라 25 에 한참 못 미친다. 권고: 현 단계 수용(기록용·DB 저장 없음이 설계). 필요하면 C1 승격 시 마지막 시도 시각을 영속화. 근거 수준 [확실, 코드 계산].
- [01:06] LOW-3 `engine.ts:1294` — `EVAL_FUNNEL_ENABLED=false` 여도 kick 은 실행되어 BLS 를 호출한다(기록기 비활성이면 `rec.record` 가 무시되는데 수집은 한다). 영향: 불필요한 외부 호출(하루 수 회). 권고: 수용 가능(운영에서 비활성 상태가 아님). 
- [01:06] LOW-4 `cpi-release-schedule.ts` 2026-10 행(`2026-11-10T13:30:00Z`, `confirmed:true`) — 확인 근거가 Analyst 메타상 "아카이브 2021..2026-10"과 "일정 2026-10..2027-11" 두 출처에 걸쳐 있어 실제 발표일 확인(파일명 코드)인지 일정표 값인지 행 단위로 구분되지 않는다. 영향: `confirmed_only` 재계산(백테스트)에서만 의미가 있고, 실제 발표가 연기됐다면 연기 구간 look-ahead 소지. 현재 운영 기록(`live`)에는 영향 없음. 권고: 다음 표 갱신 때 BLS 아카이브에서 해당 행의 실제 날짜를 확인하고 `confirmed` 를 정정 `[추측]`.
- [01:06] LOW-5 `classify.ts` `rate_schedule_exhausted`/`fomc-target-range.ts` — 2028-01-26 회의가 이미 공지됐으나 표 마지막 결정일이 2027-12-08 이라 2027-12-09 부터 `unknown` 이 된다(실제로는 1개월가량 더 쓸 수 있음). 보수적 방향이고 연준이 2028 일정을 공개하면 운영자가 추가하는 절차 주석이 있어 무해. 권고: 2027 말에 2028 결정일 추가.
- [01:06] LOW-6 운영 문서 — `docs/api-integrations.md` "호출 빈도" 는 "하루 최대 6회"만 적고 재기동 리셋(MEDIUM-2)을 적지 않았다. 권고: 한 문장 추가(선택).
- [01:06] INFO-7 `snapshot.ts` 정체 비행 폐기 — 폐기된 옛 비행이 뒤늦게 끝나면 더 최근 캐시를 옛 `fetchedAt` 으로 덮을 수 있으나, 수집기 자체 5s 마감 때문에 현실적으로 도달 불가. 시험 환경 외 영향 없음.
- [01:06] INFO-8 `engine.ts:1750` — 호출 지점에 try/catch 가 없고 "공개 함수가 절대 던지지 않는다"는 시험(snapshot 무예외 묶음·classify 무예외·invariant ⓓ)에 의존한다. G3·G4-5 에서 Leader 가 택한 설계이며 내 검토에서 던지는 경로를 찾지 못했다(`classifier`·`isMacroRegimeBlsDisabled`·`internalErrorRecord` 모두 try 안).
- [01:06] QA 인계 high_risk_areas: ① `src/lib/strategy/engine.ts:1294`·`:1750`(kick·record 두 곳, 최종 run 행 키 위치) ② `src/lib/strategy/macro-regime/snapshot.ts:98-146`(단일 비행·간격·일 상한·발표 인지 갱신) ③ `bls-cpi.ts:97-165`(5s 마감·64KB 스트림·리다이렉트) ④ 배포 후 첫 런의 `detail.macroRegime.cpi.fetchStatus`(MEDIUM-1) ⑤ 전체 jest·tsc·build(기존 실패 27스위트가 `ba3120a` 에서도 동일하다는 Developer 주장의 재확인) ⑥ 정적 표 갱신 절차 주석의 실행 가능성.
- [01:25] 보완 검토(macro-regime-c0 요청 ①): 01:06 판정 줄의 scope 가 당시 읽지 않은 시험 4파일을 덮고 있었다. 4파일 본문을 모두 읽었고 아래 결과로 이전 판정 줄(소문자 서술로 대체: 01:06 의 pass)을 대신해 새 마지막 판정 줄을 쓴다.
- [01:25] `fixtures/analyst-expected-cases.ts` [확실]: 변환된 18건을 저장소 밖 Analyst 원본 `test-cases-expected.json` 의 `cases` 와 이름·`asOfUtc`·`expected` 를 전부 직접 비교 → 18/18 동일(불일치 0). `cpi-cuur0000sa0-2017-2026.json` sha 앞 16자 d54c3f56b3d2e317, `bls-v1-get-CUUR0000SA0.json` e7cb0700f8301108 가 Analyst 원본과 일치. 파일 머리 주석의 출처 표기 정확.
- [01:25] `classify.test.ts`: 기대값이 오라클(18건 + H1 hot_hold 별도 단정)·규칙에서 직접 계산한 합성 값(9조합, 3.95/3.949, Δ 부동소수, 결측 6종, gap 3/4)이고 실제 표 사례는 내 독립 재구현(01:06, 12,628점 불일치 0)과 모순이 없다. G7-2: 예정 T 미확인 행→`confirmed_only` 에서 T~T+1 구간 이전 달·실제 날짜로 고친 확인 행→T+1 08:30 ET 부터 그 달·실제 표 2026-12-10 미확인 행 미사용·확인 구간에서 live 와 동일을 **각각 달리 단정**해 공허하지 않다. G7-3 필드(`expectedReferenceMonth`·`lagsSchedule`)는 true/false 양방향 케이스가 있다. 무예외 5종, DST 경계 8건 포함. 네트워크·DB·저장소 밖 파일 접근 0(저장소 안 fixture 만 읽음). 경미(LOW-9): `0.1+0.2` 시험 이름이 "hold 로 떨어지지 않는다"라고 되어 있으나 단정은 `deltaPct 0 / hold` 라 설명과 어긋난다(동작은 맞고 시험 의도 문구만 모호).
- [01:25] `bls-cpi.test.ts`: 모든 시험이 `fetchImpl` 주입이거나 전역 fetch 를 던지는 jest.fn 으로 바꾼 뒤 `afterEach` 에서 호출 0 을 단정 → 실호출 0 이 시험 구조로 강제된다. 시험 대상 코드 경로(스트림 64KB·헤더 선검사·signal 무시 fetch 의 마감·리다이렉트·`REQUEST_NOT_PROCESSED`·동기 throw·이상 반환값)가 각각 별 시험이고 실제 응답 원문으로 M13 2행 제외·2025-10 null·34개월을 단정한다. 운영 흉내 시험은 env 를 바꾸고 `finally` 로 복원(JEST_WORKER_ID 원래 없던 경우 복원 누락 가능성은 이 파일 범위에서 무해 — LOW-10 아님, INFO). 과도한 mock 없음.
- [01:25] `snapshot.test.ts`: 시각을 `now` 인자로 넘겨 결정적. 단정이 동작을 실제로 구분한다 — TTL 24h 직전(24h−1ms) 미호출/24h 호출, 실패 후 2h−1ms 미호출/2h 호출, 일 6회(12번 kick 중 6회만 호출·카운터 6·다음 UTC 날 재허용), 단일 비행(3회 kick→1회), 10분 폐기, 발표 전날 15:55 ET 성공→08:29 ET 무호출→08:30 ET 호출(G7-3), 발표 직후 미반영 응답 2h 재확인 뒤 반영되면 정지, 거절 경로 3종과 비행 promise 가 resolve 됨(`resolves.toBeUndefined`), 리셋 뒤 늦은 결과 무시. 처리 안 된 거절은 jest 판정에 맡긴다는 설명이 정직하게 적혀 있다(리스너로 세지 않음). 한계: 폐기된 옛 비행이 뒤늦게 최신 캐시를 덮는 경우(INFO-7)는 시험이 없으나 도달 불가라 수용.
- [01:25] 결론: 4파일에서 오라클 불일치·실호출·공유 DB 사용·공허한 단정 중 수정이 필요한 것은 발견하지 못했다. 신규 지적은 LOW-9(문구) 하나뿐이고 판정을 바꾸지 않는다. 전체 건수: CRITICAL 0 · HIGH 0 · MEDIUM 2 · LOW 5 · INFO 2(LOW-6 은 Developer 가 문서 수정 예정).
- [01:40] Codex C2 판정(서버 worktree 코드로 직접 확인). **C2-1 채택(MEDIUM)**: 직접 재현 — `parseBlsCpiResponse` 에 `data:[{2026,M10,337.5}]` 한 행만 넣으면 `{ok:true, observations:{'2026-10':337.5}}`, 값이 `-` 한 행뿐이어도 `{ok:true, observations:{'2026-10':null}}` 로 성공한다(`bls-cpi.ts:207` 의 검사는 `count===0` 뿐). `snapshot.ts:136-138` 은 `ok` 면 무조건 `s.index` 를 교체하므로 정상 34개월 캐시가 1개월로 줄고, 그 캐시로 분류하면 `unknown(cpi_stale)`·`fetchStatus:'ok'` 가 된다(분류기 직접 실행 확인). 최신 월이 숫자면 `wantsRefresh` 의 발표 인지 재확인도 걸리지 않아 24h TTL 까지 유지된다. 영향: 판단 영향 0·자금 영향 0, 그러나 기록 품질 저하(원인이 `ok` 로 가려짐)와 승격 지표 오염. **C2-2 수용(LOW, 수정 선택)**: `bls-cpi.ts:150-160` 본문 읽기 타임아웃·network_error 분기가 `finally` 의 `releaseLock` 만 하고 `reader.cancel()` 을 호출하지 않는 것은 맞다(1줄 확인). 다만 운영 기본 fetch(undici)는 `signal.abort()` 시 본문 스트림을 에러로 닫으므로 `controller.abort()` 가 이미 자원을 회수하는 경로이고, 남는 것은 signal 을 무시하는 비정상 fetch 뿐이다 `[가능성 높음, 운영 실측 아님]`. 같은 파일을 어차피 고치므로 1줄 추가를 권한다(필수 아님).
- [01:40] **Developer 수정 요건 (C2-1)**: ① `parseBlsCpiResponse` — 유효 월 수가 아니라 **사용 가능한 YoY 쌍이 1개 이상**(어떤 월 M 과 M−12 가 모두 양의 유한 숫자)임을 요구하고, 없으면 `bad_schema`(캐시 보존·재시도 간격 2h 적용). 기대 응답(연도 미지정 3개 연도)이라면 쌍이 다수이므로 정상 응답은 영향 없음. 권장 하한은 최소 쌍 1개이며 더 엄격히(예: 최근 3개 발표 후보 월 중 하나는 쌍 보유) 해도 되나 2025-10 같은 결측이 있어도 통과해야 한다. ② `snapshot.ts applyResult` 방어(권장): 기존 캐시가 있고 새 응답의 **가장 늦은 숫자 월이 기존보다 이르면** 교체하지 않고 `lastStatus='bad_schema'` 로 기록(후퇴 방지) — 파서 검사만으로 못 막는 "쌍은 있지만 짧아진 응답"을 막는다. ③ 회귀 시험(최소): (a) 한 달 응답·`-` 한 달 응답 → `bad_schema`; (b) 정상 34개월 응답 + 2025-10 `-` → `ok` 유지; (c) snapshot — 정상 캐시 적재 후 한 달 응답이 와도 `index`·`fetchedAt`·라벨이 이전 그대로이고 `fetchStatus` 가 `bad_schema`(②를 넣었다면 후퇴 응답도 동일); (d) 기존 시험 무수정 통과(`bls-cpi.test` 의 '빈 data'·'M13 만' 케이스는 그대로 bad_schema). (선택 C2-2) 본문 타임아웃·network_error 분기에서 반환 전 `void reader.cancel().catch(()=>{})` + signal 을 무시하는 가짜 본문 스트림이 cancel 을 받았음을 단정하는 시험 1건.
- [01:40] (superseded by the re-review below) 수정은 파서·캐시 교체 규칙이라 `src/lib/strategy/macro-regime/` 안이다 → 수정 뒤 Reviewer 재검토 필요(분류·엔진 경로 무변경 확인 + 위 시험). 현재 판정은 수정 전 상태 기준의 conditional 이다.
- [01:30] 수정 후 재검토(C2-1·C2-2·LOW-6·LOW-9 반영분). 방법: 서버 worktree 파일 직접 읽기·`git diff`·수정 전 transpile 본(내 C2 판정 시점에 만든 `~/.node-local/t165-reviewer/old/`)과 현재 transpile 본의 `cmp`.
- [01:30] **② 무변경 확인 [확실]**: `classify`·`cpi-release-schedule`·`fomc-target-range`·`index`·`types` 의 transpile 결과가 수정 전 본과 바이트 동일, `engine.ts` diff 는 여전히 +5줄(import 1·kick 1·record 1·주석 2). 바뀐 구현은 `bls-cpi.ts`·`snapshot.ts` 둘뿐이고 시험은 `bls-cpi.test`·`classify.test`(LOW-9 이름)·`snapshot.test` 셋만 mtime 이 바뀌었다 — `engine-invariant`·`dependency-boundary`·`static-tables` 시험은 수정 전 mtime(00:5x) 그대로. 따라서 이 파일들에 대한 01:06~01:25 검토가 유효하다. 라벨·임계·`ruleVersion`·정적 표 변경 0.
- [01:30] **① 요건 이행**: 요건① `parseBlsCpiResponse` 끝에 `hasUsableYoyPair`(어떤 월과 같은 달 전년이 모두 양수) 검사 추가 — 한 달·`-` 한 달 응답을 직접 만들어 `bad_schema`, 실제 34개월(2025-10 `-`)은 `ok`. 요건② `applyResult` 에 `latestNumericMonth` 후퇴 방지: 기존 캐시의 최신 숫자 월보다 새 응답이 이르면(또는 숫자 월 없음) 교체 없이 `lastStatus='bad_schema'`·`index`·`fetchedAt` 보존. 요건③ 회귀 시험: 파서 bad_schema 5종(한 달·`-` 한 달·짝 없는 10개월·짝 한쪽 `-`·M13 끼리)·짝 1개 ok·실제 응답 ok·수집 경로 한 달 응답·snapshot (c) 한 달/후퇴 응답 캐시 보존·평시 갱신·캐시 없을 때 수용. C2-2: 본문 읽기 실패 분기에서 반환 전 `void reader.cancel().catch(()=>{})` 추가, 신호를 무시하는 본문 스트림이 타임아웃 뒤 `cancel` 을 받았음을 단정하는 시험 + 스트림 오류(network_error) 시험. 
- [01:30] **변이 확인 [확실]**: 저장소 밖 복사본에서 `hasUsableYoyPair` 검사를 끄고 후퇴 방지 조건을 끈 뒤 시험 → **8건 실패**(221 중), 복사본은 삭제. 수정 전 동작을 시험이 잡는다. (C2-2 의 cancel 줄을 끄는 변이는 sed 패턴이 맞지 않아 적용하지 못했다 — 해당 시험은 `cancelled===true` 단정이 있고 `releaseLock` 만으로는 cancel 이 호출되지 않으므로 [가능성 높음] 잡는다.)
- [01:30] **③ 약화 아님**: 「`"-"` 는 null, M13 건너뜀」 시험은 2024-09 행 하나(정상 짝의 기준)만 더했고, M13 행 제외(322.0 미포함)·`-` → null·결과 객체 `toEqual` 단정은 그대로여서 단정 대상은 같다. 입력에 짝이 있어야 `ok` 라는 새 규칙의 필연적 변경.
- [01:30] **④ 정상 갱신·영구 정지 없음 [확실]**: 후퇴 판정은 `nextLatest < prevLatest` 문자열 비교라 같은 월 재수집·새 월 추가는 통과(시험 '최신 월이 같거나 늦으면 정상 교체'). 연도 미지정 GET 의 3개 연도 창은 오래된 쪽에서 굴러 내려갈 뿐 최신 월이 이전으로 후퇴하지 않는다. 후퇴 응답 뒤에는 `lastAttemptAt` 이 유지돼 2h 간격·일 6회 상한이 그대로 적용되고, 캐시 `fetchedAt` 이 갱신되지 않아 TTL 24h 경과 상태가 이어지므로 2h 마다 재시도가 계속된다 — 시험 (c) 가 2h−1ms 미호출/2h 호출을 단정. 정지(재시도 불능) 상태는 만들어지지 않는다. 한 가지 수용 사항(INFO-11): 캐시가 영구히 어떤 이유로 미래 월을 품고 있다면 이후 정상 응답이 모두 후퇴로 거절될 수 있으나, 캐시 값은 BLS 응답에서만 오고 NSA 지수의 월이 사라지는 일은 없어 현실성 없음(재기동으로 초기화).
- [01:30] **⑤ 시험 직접 실행**: `jest src/lib/strategy/macro-regime` → Test Suites 6 passed / **Tests 221 passed** / 0.614s(수정 전 206 → +15).
- [01:30] 신규 지적: INFO-11(위 ④) 하나뿐, 판정을 바꾸지 않는다. 총계: CRITICAL 0 · HIGH 0 · MEDIUM 1(MEDIUM-2 수용; MEDIUM-1 은 배포 후 확인 항목) · LOW(3·4·5 열림, 6·9 반영) · INFO 3. C2-1 해소, C2-2 해소. MEDIUM-1(배포 후 첫 런 `fetchStatus` 확인)은 코드 수정 사항이 아니라 Leader 보고의 사용자 확인 항목으로 남는다.
- [01:30] **최종 판정: PASS (scope: src/lib/strategy/engine.ts, src/lib/strategy/macro-regime/)**

## QA

- [01:41] 범위·방법: 서버 worktree `~/.node-local/stockinvest-t165`(detached `ba3120a`, 미커밋 변경 그대로) 실행 검증만. 파일 수정·`git add`·커밋·push·DDL·공유 DB 쓰기·`system_config`/`.env` 변경·pm2 조작·cron 호출 0. 무거운 실행은 모두 `/tmp/stockinvest-heavy-tests.lock` 아래 순차. 산출물·로그: `~/.node-local/t165-qa/`(저장소 밖). 실행 도구: claude(qa).
- [01:33] 1 새 시험: `jest src/lib/strategy/macro-regime` → Suites 6 passed / Tests **221 passed**(rc 0, `t165-qa/macro-regime-jest.log`). 불변식 `engine-invariant` 22건 전부 통과(ⓐ·ⓐ′·ⓑ·ⓒ·ⓓ·ⓕ 와 ⓔ 기준군, 바이트 단위 비교).
- [01:36] 2 전체 jest 기존 실패와의 동일성: 기준 `ba3120a`(임시 worktree `stockinvest-t165-base`, `node_modules` 는 `stockinvest-t155` 심볼릭 링크)와 변경을 같은 락 아래 **순차** 실행, `NODE_OPTIONS=--require net-guard.cjs`. 결과 — 기준: 453 스위트 · 실패 스위트 27 · 시험 12,316 · 통과 11,630 · 실패 416 · pending 270 / 변경: 459 스위트 · 실패 스위트 27 · 시험 12,537 · 통과 11,851 · 실패 416 · pending 270. **변경에만 있는 실패 0건**(시험 전체 이름 집합 비교, 두 쪽 실패 집합 동일). 통과 증가 +221 = 신규 시험 수. 판정: 기존 실패 27 스위트·416 시험은 `ba3120a` 에서도 동일하며 신규 실패 없음. 비교 결과: `t165-qa/jest-compare.json`.
- [01:33] 2-a 네트워크 가드: `net-guard.cjs` 자체 확인 — 가드 아래 `fetch('https://api.bls.gov/')` 가 실제 네트워크 없이 `ENOTFOUND` 로 막히고 로그 1줄이 생기는 것을 확인한 뒤 로그 삭제. 전체 jest 두 번 뒤 `bls-hits.log` 없음 = `api.bls.gov` 조회 0건. 기준 worktree 는 `worktree remove --force` 로 정리(node_modules 원본 `stockinvest-t155/node_modules` 유지 확인).
- [01:40] 3 tsc·build: `npx tsc --noEmit` rc 0(출력 0줄). 캐시(`tsconfig.tsbuildinfo` 01:28) 사용본 외에 `--incremental false` 재실행도 rc 0. `next build` rc 0, 13초, 로그에 오류·경고 문자열 0건(`t165-qa/build.log`). 13초는 기존 `.next` 캐시 영향일 가능성이 있다[추측].
- [01:41] 4 안전장치 무변경(주문 경로 무변경 — DRY_RUN·Kill Switch·주문 한도·심볼 화이트리스트·감사 로그 회로는 이 변경으로 바뀌지 않는다): `git status` 기준 `src/lib/safety/`·`src/lib/exchanges/`·`src/app/api/orders/`·`src/app/api/cron/`·`strategy/macro.ts`·`adaptive-buy-sizing.ts`·`exit-engine.ts`·`eval-funnel.ts` 변경 0. `engine.ts` diff 는 +5줄(import 1 · kick 1 · 최종 run 행 `macroRegime` 1 · 주석 2)뿐이다.
- [01:41] 5 시험의 DB·외부 의존: `macro-regime/__tests__` 에서 `@/lib/db` 는 `engine-invariant` 의 `jest.mock` 뿐(실 연결 0). worktree 에 `.env` 없음. `macro-regime` import 는 `engine.ts` 와 자기 디렉터리·시험뿐(`dependency-boundary` 와 grep 일치). `api.bls.gov` 리터럴은 `bls-cpi.ts` 와 그 시험에만 있다.
- [01:40] 6 BLS 실호출 **1회**(2026-11-12 01:40:28 KST, 재시도 없음): worktree 의 `types.ts`·`bls-cpi.ts` 를 typescript 로 transpile 해 `NODE_ENV=production`, `JEST_WORKER_ID` 미설정, `fetchBlsCpi()` 기본값 1회 호출. 결과 `fetchStatus=ok`, 관측 34개월 2024-01~2026-10, null 1개(2025-10), 가장 늦은 숫자 월 2026-10, 소요 519 ms. 응답 원문은 저장하지 않았다. **한계**: Node 내장 fetch 로 확인했다. Next 서버의 fetch 경로는 실측하지 않았다. 운영 앱 프로세스는 쓰지 않았다. Reviewer MEDIUM-1 의 "실호출 미실측" 은 이것으로 해소됐다.
- [01:41] 7 잔여 위험(판정 영향 없음, 보고 대상): ① Reviewer MEDIUM-2 — 일 6회 상한이 프로세스 재기동마다 리셋(수용 여부는 Leader 판단). ② Reviewer LOW-3 — `EVAL_FUNNEL_ENABLED=false` 여도 kick 이 BLS 를 호출. ③ 운영 Next 런타임의 fetch 는 배포 후 첫 런의 `detail.macroRegime.cpi.fetchStatus` 로 확인해야 한다. ④ 서버 `:3003` listener 는 QA 가 띄운 것이 아니다(건드리지 않음).
- [01:41] 8 판정 범위: 위 항목은 로컬 worktree 의 미커밋 상태에 대한 검증이다. 커밋·push·배포 후 상태는 검증하지 않았다. staged 안전 파일의 커밋 훅 판정은 커밋 단계(Leader)에서 따로 확인한다.
- [01:41] 산출물 정리: 이번 QA 는 프로젝트 안에 파일을 남기지 않았다. 서버 산출물은 `~/.node-local/t165-qa/`, Mac 쪽 임시 파일은 scratchpad 에만 있다.

✅ 검증 통과 — developer 제공 테스트(신규 시험 221건) 전부 통과, 기존 실패 27 스위트·416 시험은 기준 커밋과 동일하고 신규 실패 0건, tsc·build 통과, BLS 실호출 1회 정상, 주문 경로 무변경. 결함 0건. 배포·push 는 이 판정에 포함되지 않는다.

## Codex 검토

### [2026-11-12 00:17] C1 adversarial-review focus=design_assumption — done
- judge 판정: 판단 기록 `[2026-11-12 00:11] codex_gate/C1` 줄 / 호출 차수: 1/4 (래퍼 counts 기준. 같은 턴의 앞선 시도 2건은 래퍼 counts 에 올라가지 않았다 — 셸 `timeout` 명령 부재로 래퍼 미실행 1건, snapshot 커밋 신원 미설정으로 `worktree_failed`(incomplete) 1건. 신원을 환경변수로 지정해 1회 재실행했다.)
- 대상: repo=`/private/tmp/claude-501/-Volumes-homes-brownjeon-project-StockInvest/89eecf63-fe28-47a2-9b89-4310e087e13e/scratchpad/t165-codex`(로컬 clone, origin/main ba3120a) base=ba3120a(task_file) snapshot=faa538e — 검토 대상은 미추적 설계 문서 1개, 파일 변경 0
- 지적 4건 (검토 스냅샷 기준 줄 번호):
  - [high] `:252` — 관측 시작 후 30일 뒤 기록이 삭제되어 60거래일 승격 평가 때 실제 관측 라벨을 입증할 수 없음 — G6 재계산은 당시 캐시·수집 시각·실패 결과를 복원하지 못해 현재 표·최신 CPI로 계산한 값과 다를 수 있음 → 60거래일 실측 증거 소실 (권고: 최초 삭제 전에 장기 보관 방식을 설계에서 확정, 운영 관측값을 사후 계산값으로 대체하지 않음)
  - [high] `:146` — 실제 CPI 발표가 정적 일정 T에서 T+1로 연기된 뒤 T~T+1 구간을 재계산하면, 발표 후 값이 `releaseAtUtc ≤ asOf` 조건을 통과해 발표 전 값이 쓰임 — §3 안전성 설명은 실시간에만 성립 → 사후 재계산에 look-ahead (권고: 예정 시각과 확인된 실제 발표 시각을 구분, 과거 계산에는 가용 시각 또는 당시 스냅샷 사용, 연기 구간 회귀 시험 추가)
  - [medium] `:195` — 성공 TTL 24h에 발표 시각 무효화가 없어 발표 전날 15:55 ET 성공 수집 후 다음 날 08:30 ET 발표를 정규장 대부분 동안 이전 CPI 라벨로 기록할 수 있음, reasonCodes 에도 드러나지 않음 (권고: 발표 시각을 지난 첫 평가에 별도 갱신, 발표 예정 월 관측치가 없으면 짧고 제한된 재확인, 발표를 가로지르는 캐시 시험 추가)
  - [medium] `:242` — G4-5 네 경우가 모두 새 모듈을 연결한 엔진만 실행해 '미주입' 기준군이 없음, 갱신 promise가 pending인 동안의 엔진 독립 완료 확인도 없음 → 공통 회귀를 '영향 0'으로 잘못 판정할 수 있음 (권고: kick no-op·기록 생략 기준군 추가, 실제 시그널 후보가 생기는 입력으로 비교, promise pending 상태에서 기준군과 동일 완료 확인)
- 검토하지 못한 범위: 구현·시험 코드(아직 없음)의 실제 동작·타임아웃·시험 중 네트워크 차단 보장 / 서버에만 있는 Analyst 원문·정적 표 JSON·기대값 계산기 / BLS·연준 원천의 실제 내용과 최신성(외부 호출 없음) / 체크아웃에 없는 T-164 원문(승격 조건은 T-165 인용 기준으로 검토)
- 원본: `/Volumes/homes/brownjeon/project/.claude/state/codex-review/runs/20261111T151521Z-T-165-C1/raw.txt` (래퍼 결과 JSON: `/private/tmp/claude-501/-Volumes-homes-brownjeon-project-StockInvest/89eecf63-fe28-47a2-9b89-4310e087e13e/scratchpad/T-165-C1-result.json`)
- 다음: Reviewer 가 지적 4건 채택·오탐 판정 (Codex 지적은 채택·기각 전이며 설계 수정 여부는 Leader·Analyst 판단)

### [2026-11-12 01:23] C2 adversarial-review focus=error_handling — done
- judge 판정: 판단 기록 `[2026-11-12 01:11] codex_gate/C2` 줄 / 호출 차수: 2/4 (래퍼 counts 기준). 같은 턴의 앞선 시도 1건은 래퍼 counts 에 올라가지 않았다 — snapshot 커밋 신원 미설정으로 `worktree_failed`(incomplete, Codex 미실행). 신원을 환경변수(`GIT_AUTHOR_*`·`GIT_COMMITTER_*`)로만 지정해 1회 재실행했다. 저장소 설정은 바꾸지 않았다. 셸 `timeout` 부재는 래퍼의 perl 대체 경로로 실행됐다.
- 대상: repo=`/private/tmp/claude-501/-Volumes-homes-brownjeon-project-StockInvest/89eecf63-fe28-47a2-9b89-4310e087e13e/scratchpad/t165-codex`(로컬 clone, origin/main ba3120a, 변경 22개) base=ba3120a(task_file) snapshot=0011a41 — `files_modified_in_snapshot` 0
- 지적 2건:
  - [medium] `src/lib/strategy/macro-regime/bls-cpi.ts:207` — 성공 상태 JSON 응답에 최신 한 달만 있거나 모든 월이 `-` 이면 정상 34개월 캐시가 한 달로 교체되어 `normal_tightening` 이 unknown(cpi_stale)·fetchStatus=ok 로 바뀜. null 이 count 에 포함되고 사용 가능한 YoY 쌍 없이도 ok 를 반환하며, `snapshot.ts:136-138` 이 기존 캐시 전체를 교체함 (권고: 사용 가능한 YoY 쌍 없는 응답으로 정상 캐시를 교체하지 않도록 검증하거나 과거 월을 보존하는 병합 정책 적용, 최신 월만 있는 응답과 전부 결측 응답의 회귀 시험 추가). Codex 는 무네트워크 재현으로 확인했다고 적었다([확실]).
  - [low] `src/lib/strategy/macro-regime/bls-cpi.ts:157` — AbortSignal 을 무시하는 fetch 가 헤더 반환 뒤 본문 스트림을 멈추면, 본문 타임아웃 경로는 releaseLock 만 실행하고 cancel 을 부르지 않아 기저 스트림이 닫히지 않음 (권고: 본문 타임아웃에서 reader.cancel() 을 best-effort 로 호출하고 거절 흡수, 시험에서 스트림 취소 확인). 기본 운영 fetch 에서 발생하는지는 Codex 도 미확인이라고 적었다.
- Codex 요약: 동기 예외·Promise 거절·Intl 실패는 방어 처리됐고 재현에서 unhandledRejection 은 없었다고 보고. 이 두 건 외 신규 공백은 명시하지 않음.
- 검토하지 못한 범위: 실제 BLS 호출 및 운영 Next.js fetch 의 AbortSignal 전달·자원 정리 동작 / 전체 Jest·TypeScript 검사·빌드와 운영 엔진 통합 실행 / BLS·연준 원문에 대한 정적 표 수치와 발표일의 외부 대조.
- 원본: `/Volumes/homes/brownjeon/project/.claude/state/codex-review/runs/20261111T161407Z-T-165-C2/raw.txt` (래퍼 결과 JSON: `/private/tmp/claude-501/-Volumes-homes-brownjeon-project-StockInvest/89eecf63-fe28-47a2-9b89-4310e087e13e/scratchpad/T-165-C2-result.json`)
- 다음: Reviewer 가 지적 2건 채택·오탐 판정 (Codex 지적은 채택·기각 전이며 수정 여부는 Leader·Developer 판단)

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 11-12 00:07 |

---

## 최종 요약 (사용자용)

### [T-165] 거시 레짐 라벨 기록(C0) — "지금이 물가·금리상 어떤 국면인가"를 매매 판단에 영향 없이 기록만 시작

- **상태**: ✅ 운영 배포 완료(2026-11-12 10:18 KST) · 운영 라벨 기록 확인(10:20 첫 장중 평가부터 `normal_tightening`·수집 `ok`). 남은 대기는 **라벨 장기 보관 방식 결정 1건**.
- **무엇이 바뀌었나**: 자동매매 엔진이 5분마다 평가를 마칠 때 남기는 기록(평가 깔때기의 "런" 행)에 **거시 레짐 라벨**이 한 덩어리 더 붙습니다. 라벨은 미국 물가(CPI 전년 대비 상승률)가 4.0% 이상인지와 미국 기준금리가 최근 6개월 사이 올랐는지·그대로인지·내렸는지를 조합한 6가지(예: `hot_tightening` = 고물가+금리 인상 중 = 검토서의 유형⑤) 중 하나이고, 판단할 수 없으면 `unknown` 과 그 사유를 남깁니다. **매수·매도 판단, 기존 -1.5% 하락 차단, 주문 금액, AI 프롬프트는 전혀 바뀌지 않습니다.** 화면 변경도 없습니다.
  - 물가는 미국 노동통계국(BLS) 공식 API(키 없음, 새 외부 원천 1건)에서 하루 몇 번만 받아 메모리에 두고, 기준금리는 코드 안의 표(2008-12 이후 변경 33건, 연준 공식 자료로 대조)로 둡니다. FRED·공포탐욕지수·VIX 는 쓰지 않습니다.
  - "그때 알 수 없던 숫자"를 쓰지 않도록, 물가는 BLS 발표 시각(미 동부 08:30 = 지금은 한국 22:30) 이후에만 반영합니다. 2025년 10월 물가는 미 정부 셧다운으로 아예 발표되지 않아서, 지금은 2026년 9월 수치(3.7%)를 씁니다.
  - 금리표가 FOMC 회의 뒤에 갱신되지 않으면 라벨이 `unknown(rate_table_stale)` 로 떨어집니다. **다음 갱신 필요 시점: 2026-12-09 FOMC 결정 다음 날**(표 한 줄 추가 + 확인일 갱신, 코드 커밋이라 Reviewer 판정 필요).
- **배포**: ✅ 완료 — 사용자 승인 「push 진행」 뒤 메인 세션이 서버 worktree 에서 `git push origin ca59bd0:main` (`ba3120a..ca59bd0`, 2026-11-12 10:17 KST).
  - webhook blue/green: START 01:17:36 UTC → END 01:18:43 UTC exit=0, `RELEASE_RESULT {"status":"ok","release":"20261112-101741-ca59bd0d","previous":".../20261111-233346-ba3120ae","migrated":false}`.
  - 배포 뒤 확인(10:18:57 KST): `stockinvest`·`stockinvest-cron` 모두 새 릴리스에서 online · 운영 `package.json` 0.7.0 · `/api/health` ok·db ok·안전 상태 green · `DRY_RUN` 켜짐·킬스위치 꺼짐·엔진 켜짐·자동승인 `auto`(배포 전과 같음).
  - 같은 배포에 함께 실린 작업: 없음(코드 `c9590e2` + 기록 `ca59bd0` 두 커밋뿐). 웹 버전 **0.6.0 → 0.7.0**(마이너 증가). 앱(APK)·네이티브 변경 없음, DDL 없음.
  - 이 배포 기록 커밋도 사용자 지시로 push 했다(문서만이지만 webhook 재배포 → 웹 재기동 → 물가 캐시 초기화 → 다음 평가에서 BLS 1회 재수집). 그 재배포 결과는 이 문서에 다시 적지 않는다(적으면 또 배포된다) — 채팅 보고로 갈음.
- **실매매 영향**: 주문·청산·승인 경로 변경 **없음**(안전장치·거래소·주문·cron 라우트 파일 무변경을 QA 가 확인). 현재 운영 실측(2026-11-12 01:44 KST, 읽기 전용 `/api/health`): `DRY_RUN` 켜짐 · 킬스위치 꺼짐 · 엔진 켜짐 · 자동승인 `auto` · 안전 상태 green. 배포 뒤에도 이 값들은 이 변경으로 바뀌지 않습니다.
- **AI 가 검증한 것**:
  - 새 시험 221건 통과(분류 89 · 정적 표 24 · BLS 수집 52 · 캐시 29 · 엔진 불변식 22 · 의존 경계 5). **불변식 시험**은 "라벨 기능이 없던 때"와 6가지 상황(미로딩·정상·고물가 강제·unknown 강제·내부 오류·끝나지 않는 수집)을 같은 입력으로 돌려 엔진의 시그널·주문 금액·차단 판정·기록 전체가 바이트 단위로 같음을 확인합니다. 라벨을 일부러 매수 차단에 섞으면 이 시험이 실패하는 것도 확인했습니다.
  - 전체 시험: 기준 커밋과 변경본 모두 **기존 실패 27묶음(416건)이 이름까지 동일**, 새 실패 0건, 통과 11,630 → 11,851. `tsc`·`next build` 통과. 시험 중 BLS 접속 0건(네트워크 가드로 확인).
  - Reviewer 가 판정 로직을 별도로 다시 만들어 2017~2026 의 12,628개 시점에서 라벨 불일치 0건, 금리표 33행·FOMC 일정 24건을 연준 원문과 전수 대조 일치.
  - BLS 실제 호출: 이번 task 전체에서 **3회**(Analyst 확인 2회 23:54, QA 운영 경로 확인 1회 01:40 — 모두 정상, 키 없이 과거 2017년치까지 수신 가능).
  - 검증 못 한 것: 운영 웹 서버(Next) 안에서의 실제 수집·기록(배포 전이라 불가), BLS 하루 25회 한도가 IP 단위인지, 2021~2024 발표 시각이 모두 08:30 이었는지(날짜는 BLS 아카이브로 확인).
- **👉 사용자가 확인할 것**: 없음 — 배포 뒤 첫 장중 평가를 메인 세션이 DB 읽기 전용으로 확인했다.
  - `eval_funnel` id 904956(2026-11-12 10:20:40 KST, 국내) run 행 `detail.macroRegime`: `ruleVersion macro-regime-c0@1` · `label normal_tightening` · `isType5 false` · CPI 2026-09 YoY 3.7(3.7377, 지수 336.94 / 2025-09 324.8) · `fetchStatus ok`(수집 10:18:14 KST) · 금리 상단 4.00(2026-09-17~) vs 6개월 전 3.75 → `tightening` · 표 확인일 2026-11-11 · 다음 결정일 2026-12-09.
  - 예상과 다른 점(무해): 첫 기록이 `unknown(cpi_not_loaded)` 가 아니라 바로 `ok` 였다. 새 프로세스가 기동 직후(10:18:14) 시작한 평가가 run 행을 남기기 전에 수집을 이미 시작했기 때문으로 보인다 [가능성 높음]. `cpi.expectedReferenceMonth 2026-10`·`lagsSchedule true` 는 2026-10 YoY 의 기준월(2025-10)이 미공표라 2026-09 를 쓰는 설계대로의 표시다.
  - 계속 볼 신호(선택): `cpi.fetchStatus` 가 `ok` 가 아닌 값(`http_error`·`timeout` 등)으로 이어지면 수집이 막힌 것 — 매매 영향은 없다.
- **👉 사용자가 결정할 것**:
  1. **라벨 기록 보관 기간 — 첫 배포 + 30일 전까지.** 평가 깔때기 기록은 30일이 지나면 자동 삭제됩니다. 검토서가 정한 다음 단계 조건("라벨 60거래일 관측")을 실측 기록으로 입증하려면 그 전에 장기 보관 방식을 정해야 합니다. 선택지: (a) 전용 테이블 신설(DB 변경 승인 필요) + 삭제 전 기존 행 이관 (b) 저장소 밖 파일(JSONL) 누적 (c) 30일 롤링을 받아들이고 필요 시 재계산 — **권고 (a)**: 운영 관측(수집 실패·미로딩 비율)은 재계산으로 되살릴 수 없어서입니다(Codex 지적). 결정 전까지 증거 손실은 없습니다(30일 안에 이관 가능).
  2. ~~push(운영 배포) 승인~~ — 사용자 「push 진행」으로 처리 완료(2026-11-12 10:17 KST).
- **남은 일**: 장기 보관 결정 후 별 task · 2026-12-09 FOMC 뒤 금리표 갱신 · 2027년 말 2028 FOMC 일정 추가 · C1(AI 프롬프트 참고자료) 승격은 60거래일 관측 뒤 검토(이번 범위 아님) · BLS 호출을 외부 호출 사용량 기록(api-usage)에 연결하는 것은 공유 패키지 수정이 필요해 보류.
- **이슈·위험**:
  1. 수집 횟수 상한(하루 6회)이 프로세스 메모리라 재기동 때 초기화됩니다. 실패가 이어지는 날 재기동이 잦으면 시도 수가 늘지만, BLS 한도(25회)를 넘으려면 하루 재기동 13회 이상이어야 하고 넘어도 그날 라벨이 `unknown` 이 될 뿐입니다(수용).
  2. 평가 깔때기 기록 스위치를 꺼도 BLS 수집은 돕니다(낭비일 뿐 무해, 수용).
  3. 긴급(임시) FOMC 회의의 금리 변경은 표가 자동 감지하지 못합니다 — 다음 정례 회의까지 옛 값이 쓰입니다(기록만이라 피해 0).
  4. Codex 외부 검토 2회 실행(설계 C1 지적 4건 → 3건 설계 반영·1건 사용자 결정으로 상정, 구현 C2 지적 2건 → 모두 수정). 수정 후 Codex 재검토는 하지 않았습니다(Reviewer 재검토로 대체, 남은 호출 2/4).
  5. 롤백: 코드 커밋을 되돌려 push 하면 라벨 기록만 사라집니다. DB 구조 변경이 없어 되돌릴 데이터가 없고, 이미 남은 기록 행은 30일 뒤 자동 삭제됩니다.

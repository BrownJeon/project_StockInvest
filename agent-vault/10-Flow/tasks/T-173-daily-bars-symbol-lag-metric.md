---
task_id: T-173
title: 일봉 감시 지표 — 시장별 MAX 하나에서 「대상 중 밀린 종목 수」로
status: done
priority: high
project: StockInvest
created: 2026-11-15
updated: 2026-11-15
base_ref: 7c8f1ae218a9fc3b98680d60d770b7dec9945ffb
risk_level: R1
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-170-daily-bars-kr-evening-staleness-order, T-108-automation-menu-home-overhaul]
tags:
  - type/task
  - domain/ops
  - domain/data
aliases:
  - 일봉밀림지표
  - 일봉낡은종목수
waiting: [screen_check, demo_confirm, codex_config]
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: 설계(사용자 승인)부터 구현·감사·QA·서버 worktree 커밋·push 배포(사용자 승인 2026-11-15 14:5x)까지
  last_event_id: E3
---

# T-173 일봉 감시 지표 — 「대상 중 밀린 종목 수」

## 목표·배경 (Leader)

**한 문장**: 일봉 감시(`ops/metrics/daily-bars-read.ts` → `anomalies.ts` `barsRow`)가 시장별 `MAX(trade_date)` 하나만 봐서, 국내 보유종목 005930 하나가 매일 갱신되는 동안 나머지 국내 42종목이 11-06 에서 멈춘 것을 놓쳤다(11-09~14, 발견은 사람이 11-14). 수집 대상 종목마다 마지막 확정 봉을 보고 「기대 거래일보다 2거래일 이상 밀린 종목 수」를 시장별로 세어, 임계값에서 경고한다.

**근거**
- [확실] 미탐 원인: `LAST_BAR_DATE_SQL` = 시장별 마지막 확정 봉 하나. cron 은 HTTP 200 이면 `daily-bars OK` 한 줄(T-170 조사 — 그룹 공유 노트 `kr-daily-bars-stall-2026-11-14.md`).
- [확실] 11-15 08:3x 운영 DB(읽기 전용) 실측: 대상 169(국내 43·해외 126). 일요일 07:40 실행(`targets=169 processed=169 calls=142/150 remaining=0`)이 국내를 11-13 까지 따라잡아 지금은 밀림 0. 예외 `NYS:BRK.B` — 수집 대상인데 일봉 행 0(한 번도 못 받음).
- [확실] T-170 알려진 위험 1: 낡은 순 정렬에서 계속 `failed` 인 종목 3개가 앞에 서면 `consecutive_failures` 로 그날 실행이 멈춘다 — 이 지표가 그 정체(보유 외 전부가 밀림)도 드러내야 한다.

**하지 않는 것**: 수집기·대상 정책·예산 변경, cron-runner(`daily-bars OK` 줄에 remaining 반영 — SAFETY_PATHS, 별건), 텔레그램 알림(ops 계층은 알림 import 금지 — 울타리 시험), BRK.B 미수집 원인 조사, DDL.

## 사용자 지시·승인 (원문 보존)

- 2026-11-15 08:2x (daily-bars 세션의 위임, 배경 원문 요지): 「대상 목록(`loadDefaultTargets`) 중 마지막 거래일이 기대 거래일보다 N일 이상 낡은 종목 수(시장별)를 지표로 만들고 임계값에서 경고하도록 설계·구현한다. 감시 지표 변경은 사용자 승인 사항이므로 설계안(지표 정의·임계값·표시 위치)을 먼저 보여 주고 승인 뒤 구현한다.」
- 2026-11-15 08:5x (사용자 원문): **"설계대로 진행"** — 아래 「설계」 1~4(표시 문구 예 `일봉 국내 · 11/13(금) · 밀림 42/43종목` 포함)에 대한 승인.
- **허용**: 설계대로의 구현·시험·감사·QA·서버 worktree 커밋. **허용하지 않음(별도 승인)**: push·배포.

## 설계 (Leader — 사용자 승인본)

1. **대상**: `loadDefaultTargets` 와 같은 규칙(보유 → 해외 분석 목록 → 90일 시그널 ≤300, 같은 중복 제거, 시장은 심볼 모양). ops 는 수집 모듈을 import 할 수 없어(격리 시험) 같은 SQL 을 ops 쪽(`bars-lag.ts`)에 두고, 두 구현이 같은 종목 집합·같은 SQL 문자열을 내는지 대등성 시험으로 고정한다. 해외 분석 목록은 수집기가 쓰는 `readOverseasUniverse` 그대로(ops 읽기 래퍼 경유 — SELECT 전용·2.5초 상한).
2. **종목별 마지막 확정 봉**: `SYMBOL_LAST_BAR_SQL`(market·symbol IN·is_final=1, GROUP BY symbol). 일봉 표 이름은 `daily-bars-read.ts` 에만.
3. **기대 거래일**: 기존 `expectedBarDate`(세션 다음 KST 날 08:30 지난 최근 거래일, 휴장표 반영). **밀림** = 마지막 봉 다음 날부터 기대일까지의 거래일 수 — 0 정상, 1 「하루 늦음」(T-170 순환 설계상 평일 정상 범위), ≥2 「밀림」, 행 없음 「미수집」.
4. **임계값**: 시장별 밀림+미수집 ≥ 3 → 그 시장 일봉 원천 `stale`(reason `bars_symbols_behind`). 1~2 는 경고 없이 숫자만. 기존 시장 MAX 판정(`bars_old`)은 그대로 먼저. 휴장표 모름 → 계산 안 함(기존 `holidays_unknown`). 대상 목록 조회 일부 실패 → `partial`(`bars_targets_partial`), 종목별 봉 조회 실패 → `partial`(`bars_lag_unread`) — 0·정상으로 위장하지 않는다.
5. **표시**: 홈 A4 「데이터 이상」(기존 경로, 화면 변경 없음) · 분석 › 데이터 상태 일봉 줄 기준 표시에 ` · 밀림 n/m종목`(밀림+미수집 > 0 일 때만, `DataPanel.tsx` `sourceWhen` 한 줄) · 이상 상세 사유·근거 문구(`anomaly-details.ts`).

## 실행 도구·절차 이력

- E1 2026-11-15 09:0x claude/claude_standard — daily-bars 세션(local_18d5f2cd)의 위임으로 시작. 설계 사용자 승인 08:5x. 서버 worktree `~/.node-local/stockinvest-dbstale`(기준 `7c8f1ae`). 남은 일: 구현·Reviewer·QA·커밋, push 는 사용자 승인 후.

- E2 2026-11-15 10:3x claude/claude_standard — Reviewer 2회 CONDITIONAL_PASS(R-1·R-2 수정 재검증), QA PASS(체크 1~7, 화면 렌더 NOT_VERIFIED), Codex C1 실패·C2 미실행(서버 모델 설정). 서버 worktree `~/.node-local/stockinvest-dbstale-v2` 를 최신 origin/main `bd65785`(그 사이 들어온 것은 T-169·T-170 문서 커밋뿐 — 이 task 파일과 겹치지 않음)로 옮겨 커밋, 앱 버전 0.11.0 → 0.12.0. **push 안 함**(push = 운영 배포, 사용자 승인 대기). board·ACTIVE 는 다른 세션의 동시 갱신과 충돌을 피하려고 건드리지 않았다. 남은 일: ① push 승인 ② 데모 기록(사용자 확인) ③ 배포 뒤 화면 확인(데이터 상태 일봉 줄 · 412px) ④ 서버 Codex 설정(사용자 판단).

- E3 2026-11-15 14:5x claude/claude_standard — 사용자 원문 **"push 진행"**(질문 「T-173 커밋(a3e2032)을 push(운영 배포)할까요?」에 대한 답). 직전 재확인: origin/main = `bd65785`(변동 없음) · `origin/main..HEAD` = `a3e2032` 1건 · `git-refs-clean.sh --check` 깨끗. 14:55:34 `git push origin a3e2032:main` → webhook blue/green `ok`(아래 「배포 기록」). 이 배포 기록·최종 요약은 별도 문서 커밋이며, 그 push 는 이번 승인 범위 밖이라 따로 묻는다. 남은 일: ① 사용자 화면 확인 ② 데모 기록(사용자 확인) ③ 서버 Codex 설정(사용자 판단).

## 판단 기록 (judge)
- [2026-11-15 09:26] intake engine=jev → task_type=feature · risk=R2 · developer_model=opus · roles=designer,prompt-engineer?,developer,reviewer,qa · next=demo_first · demo=delta/designer(JV-ui_change) · actions=prepare_demo,request_demo_approval,assign_developer | overrides=R2-kw-payment | fallback=- | tokens=1502
- [2026-11-15 09:26] codex_gate/C1 engine=jev → codex_required=true · mode=adversarial-review · focus=design_assumption · budget_rule=CX-limit-unknown-r2 · codex_switch=on | overrides=- | fallback=- | tokens=980
- [09:3x Leader] **R2 = 키워드 오탐**: `R2-kw-payment` 가 접수 요약의 「주문·안전장치 … 변경 없음」 문구에 걸렸다. 변경 경로(`src/lib/ops/metrics/**`·`DataPanel.tsx`)는 R2 경로 규칙 밖이고 SAFETY_PATHS 도 0건이다. 규칙상 낮추지 않고 R2 그대로 둔다(Reviewer·QA 는 어차피 전부 거친다).
- [09:3x Leader] **데모 게이트 delta(확신 0.5)**: 화면 변경은 데이터 상태 일봉 줄 기준 표시 뒤 ` · 밀림 n/m종목` 한 줄뿐이고, 사용자가 08:5x 이 문구 예시(`일봉 국내 · 11/13(금) · 밀림 42/43종목`)가 든 설계를 "설계대로 진행" 으로 승인했다. Leader 는 이를 표시 승인으로 보고 진행했지만, **데모 승인 기록(`check.mjs`)·생략(waive)은 사용자 원문 없이 하지 않았다** — 사용자 확인 대기 항목으로 보고한다. 커밋 훅은 데모 상태를 보지 않는다(T-170 실측).
- [09:3x Leader] C1 `codex_required=true` → codex 역할로 한 번 시도한다. 서버 Codex 설정은 T-170 C2 실패 때(11-15 02:13, `gpt-6.1-sol` 거부)와 같다(`~/.codex/config.toml` 11-06 이후 그대로, CLI 0.157.1). 설정 수정은 사용자 판단 사항이라 건드리지 않는다.
- [2026-11-15 09:44] codex_gate/C2 engine=jev → codex_required=true · mode=adversarial-review · focus=design_assumption · budget_rule=CX-limit-unknown-r2 · codex_switch=on | overrides=- | fallback=- | tokens=1070
- [09:4x Leader] C2 `codex_required=true` → **Codex 미실행**: C1 실패 원인(서버 `~/.codex/config.toml` 모델 `gpt-6.1-sol` 거부)이 그대로다(설정 11-06 이후 변경 없음, 09:29 C1 실측). 같은 설정으로 다시 부르면 같은 실패라 호출하지 않았다 — 설정 수정·재시도는 사용자 판단. Codex 검토 없이 Reviewer(2회)·QA 판정으로 진행하고 보고에 「Codex 검토 미완료」로 적는다.

## Developer

- [09:3x] 실행 도구: claude(메인 세션이 developer 겸임 — Opus). 서버 worktree `~/.node-local/stockinvest-dbstale`(기준 `7c8f1ae`), 편집은 Mac 미러에서 하고 tar 로 옮김(파일별 sha256 일치 확인).
- **변경 파일**
  - `src/lib/ops/metrics/bars-lag.ts`(새) — 대상 판독 `readBarsTargets`(보유 `BARS_TARGET_HOLDINGS_SQL` → `readOverseasUniverse(ops 읽기 래퍼)` → 시그널 `BARS_TARGET_SIGNALS_SQL`, 새로 더한 것 ≤300, 중복·모르는 모양 제외, 오류 이름 `position_state`·`universe_list`·`signals`), `readBarsLagInput`(시장별 종목 봉 1회씩, 시장 하나 실패는 그 시장만 `last=null`, 던지지 않음, memo), 순수 `tradingDaysAfter`·`barsLagOf`·`barsLagAlert`, 기준값 `BARS_BEHIND_DAYS=2`·`BARS_BEHIND_ALERT=3`·`BARS_SAMPLE_MAX=5`.
  - `daily-bars-read.ts` — `SYMBOL_LAST_BAR_SQL`(market·symbol IN·is_final=1, GROUP BY symbol, 날짜 하한 없음) + `readSymbolLastBars`. 일봉 표 이름은 계속 이 파일에만.
  - `anomalies.ts` — `barsRow(…, lagIn?)` 판정 순서: no_bars → holidays_unknown(밀림 계산 안 함) → `bars_old` → `bars_symbols_behind`(밀림+미수집 ≥3) → `bars_lag_unread`(partial) → `bars_targets_partial`(partial) → available. `lagIn` 없으면 T-173 전과 같은 출력(`lag` 키 없음). `readDataSources` 가 `readBarsLagInput` 을 다른 원천과 병렬로 읽는다(예상 밖 실패 → 두 시장 `bars_lag_unread`).
  - `anomaly-details.ts` — 일봉 행의 사유·근거 문구(대상 수·밀린 수·미수집 수·기대일·가장 오래된 봉·예시 외 n / 확인 못 함 2종).
  - `types.ts` — `DataSourceRow.lag?: BarsLag | null`, `BarsLag`.
  - `src/app/analytics/DataPanel.tsx` — `sourceWhen` 일봉 두 줄 뒤에 ` · 밀림 n/m종목`(밀림+미수집 > 0 일 때만). 사용자 승인 설계 5 의 표시 그대로.
  - 시험: `src/lib/ops/metrics/__tests__/bars-lag.test.ts`(새, 48건), `src/lib/profit-engine/__tests__/daily-bars-target-parity.test.ts`(새, 대등성 6건 — 같은 `FakeBarsDb` 로 두 구현의 시장별 집합·오류 이름·보유/시그널 SQL 문장 일치), `exit-and-sources.test.ts`(T-140 「원천 전부 정상」 픽스처에 종목별 봉 경로 한 줄 추가 — 단언 변경 없음. 해외 분석 목록 표가 빈 픽스처에서는 판독기가 내장 50종목을 돌려주므로, 새 조회에도 「정상」 답을 줘야 같은 입력이 된다).
- **실행 증빙**
  - jest 새 2파일: 54/54 통과(`~/.node-local/t173-logs/new2.log`). `exit-and-sources`+`bars-lag`: 91/91(`es.log`).
  - 관련 묶음(ops 전체·`src/__tests__`·analytics·components/ops·api/ops·daily-bars 라우트·collector·isolation·대등성) 변경본 vs 기준 `7c8f1ae` 단언별 대조: 픽스처 보강 전 새 실패 2건(위 T-140 (a)·(c)) → 보강 후 해소. 그 밖의 실패는 기준과 같은 이름(기준 부채: t108 render·terms-fence·trade/watch/scenario render·t156·t162 render·reason-dictionary-keys order·isolation). 로그 `new-rel.json`·`base-rel.json`.
  - `tsc --noEmit`(프로젝트 설정 — 시험 제외) 0 오류. 시험 3파일은 jest 형 포함 임시 설정으로 확인 — 오류는 CSS 모듈 선언 2건뿐(기존·무관). ESLint 는 저장소에 설정 파일이 없어 실행 불가(`next lint` 미설정) — 미실행.
  - 🔎 운영 DB 읽기 전용 덤프(11-15 09:26, `dbq.py`)를 실제 코드 경로(`readDataSources` → 대상 판독 → 실제 `readOverseasUniverse` → 종목별 봉)로 재생: 국내 대상 43·밀림 0·미수집 0 → 정상 / 해외 대상 126·밀림 0·미수집 1(`NYS:BRK.B`) → 정상, 화면 `· 밀림 1/126종목`. 앞서 SQL 로 직접 센 값과 같다. 재생 시험 파일은 임시로 만들고 지웠다(커밋 안 함).
  - 운영 조회 시간: `SYMBOL_LAST_BAR_SQL`(해외 125종목) 약 110ms(dbq 기동 포함 132ms), EXPLAIN range/PRIMARY 약 10만 행. 쿼리당 상한 2.5초 안.
- [09:4x] **자체 점검으로 고침 — 요청 예산**: ops 읽기 래퍼는 요청당 3.8초·자리 4개(전역 4개)를 홈의 모든 섹션과 나눠 쓴다. 1차 구현은 대상 원천 3개를 차례로 읽어(보유 → 분석 목록[개정판 → 스위치] → 시그널 → 종목 봉) 사슬이 5단이었다 — 느린 날 시간 초과로 「확인 못 함(일부 저하)」이 홈 A4 에 거짓으로 뜰 수 있다. 세 원천을 동시에 읽고 합치는 순서만 수집기와 같게 바꿨다(사슬 3단). 판독기가 약속과 달리 던져도 `universe_list` 로 세고 계속한다. 시험 2건 추가 — 옛 차례 읽기 구현에 대고 돌리면 2건 모두 실패, 새 구현에서 통과(변이 확인, `mut-seq.log`). 변경 후 3파일 105/105, tsc 0(`v2.log`·`tsc-v2.log`).
- [09:5x] **Reviewer R-1·R-2 수정**: ① R-1 — `targetErrorsFor(market, errors)`(bars-lag.ts): 국내 줄은 `universe_list` 를 빼고(해외 분석 목록은 해외 대상만 만든다), 해외 줄은 셋 다. `readBarsLagInput` 이 시장별로 적용. ② R-2 — 시험의 표 이름 문자열을 조각으로(`['daily', 'bars'].join('_')`). 시험 2건 추가(국내는 목록 저하에도 정상·해외만 일부 저하 / 보유 실패는 두 줄 모두, `targetErrorsFor` 단위). 결과: 5파일(bars-lag·대등성·exit-and-sources·울타리·격리) 233 통과·3 실패 — 실패 3건은 격리 시험의 기준 실패와 **단언 이름·위반 파일 목록까지 같다**(새 위반 0, `fix1.json` vs `fix1-base.json`). tsc 0(`tsc-fix1.log`). R-3(요청 예산)·R-4(기대일 못 구함 → 밀림 미점검)는 수정 요구 아님 — R-3 은 세 원천 동시 읽기(09:4x)로 사슬을 줄인 상태, 홈 전체 시간·시간초과 빈도는 미측정으로 남긴다.
- **알려진 한계(설계상)**
  - 대상은 전 시장 기본 실행 기준이다. 국내 저녁 실행(`?market=KR`)은 시그널 300 상한을 국내만으로 세므로 시그널 종목이 300을 넘을 때만 두 집합이 갈린다(11-15 실측 시그널 122종목).
  - 미국 반일장은 휴장표에 들어 있어 거래일로 세지 않는다 — 반일장을 끼면 밀림이 하루 적게 셀 수 있다.
  - 새로 넣은 분석 대상 종목은 다음 수집 실행 전까지 「미수집」이다 — 3종목 이상 한꺼번에 넣으면 그 사이 「오래됨」으로 보인다(사실 그대로).
  - ops 화면이 해외 분석 목록 판독기를 부르므로 그 판독기의 「마지막 성공 값」 캐시를 ops 요청도 갱신한다(같은 DB 값, 수집·분석 경로가 읽는 값과 같음). 판독 실패 시 그 판독기의 경고 로그가 ops 요청에서도 남을 수 있다.

## Reviewer

- [09:40] 실행 도구: claude(reviewer 역할). 기준 `7c8f1ae` 대비 서버 v2 worktree(`stockinvest-dbstale-v2`) 변경 6파일 + 시험 3파일 + 수집기 원본(`daily-bars-store.ts` `loadDefaultTargets`, `universe-overseas-static.ts`)·읽기 래퍼(`read-only.ts`)·`home.ts`/`analysis.ts` 호출부를 읽었다. 코드·DB 쓰기·커밋 없음(운영 DB는 SELECT/EXPLAIN 만).
- [09:40] 의도 검증: 승인 설계 1~5 와 구현 일치. 대상 규칙(보유→분석 목록→시그널 ≤300, 중복·모양 제외, SQL 문장·LIMIT·INTERVAL 동일)은 수집기와 같고 대등성 시험이 고정한다. `lagIn` 없는 `barsRow` 호출은 기준과 같은 출력(`{dateRef}`만, `lag` 키 없음). 판정 순서·경계(밀림 2·경고 3)·표시 문구(`일봉 국내 · 11/13(금) · 밀림 42/43종목` 형식)는 승인안대로다. 국내 42종목 정체는 11-11 08:30 부터 잡히고(시험 고정), T-170 위험 1(연속 실패 중단)도 같은 방식으로 드러난다.
- [09:40] **R-1 (MEDIUM) 국내 일봉 줄이 해외 분석 목록 저하 때문에 「일부 저하」로 뜬다** — `bars-lag.ts:116,118` `readBarsLagInput` 이 `targetErrors: t.errors` 를 두 시장에 그대로 넣고, `anomalies.ts:109` 는 시장을 보지 않고 `bars_targets_partial` 을 낸다. `universe_list` 는 해외 전용 원천인데(수집기도 국내 전용 실행에서는 읽지 않는다 — `daily-bars-store.ts:203`) 국내 행이 partial 이 되고 홈 A4 「데이터 이상」 건수가 늘어난다. 해외 목록 판독이 요청 예산에 걸려 시간초과하는 날이 곧 그 날이다(판독기가 3번 직렬 질의). 거짓 경보이며 주문·자금 경로와는 무관. 재현: `barsRow('daily_bars_kr','domestic',최신,NOW,CLOSED,{symbols:[…],last:전부 최신,targetErrors:['universe_list']})` → `state:'partial', reason:'bars_targets_partial'`(기존 시험은 해외 행에서만 확인 — `bars-lag.test.ts:125-127`). 권고: 시장별로 오류를 거른다(국내는 `position_state`·`signals`, 해외는 셋 다).
- [09:40] **R-2 (MEDIUM→LOW) 새 시험 파일이 이미 빨간 격리 시험에 위반 1건을 얹었다** — `bars-lag.test.ts:277` 의 `x.id.startsWith('daily_bars')` 가 `isolation.test.ts` 「daily_bars 테이블 참조 0건」(정규식 `\bdaily_bars\b`, 시험 파일도 훑음)에 새로 걸린다. 그 단언은 기준에서도 4건으로 실패 중이라(`capture-operating-data(.test).ts`·`m40/archive-reader.test.ts`·`m40/operating-evidence.test.ts`) 단언 이름이 같아 「새 실패」로 안 보이고 위반이 5건으로 늘었다(`reviewer-new.log` vs `reviewer-base.log` 의 Received 목록 대조). ops 울타리 시험(`ops-read-only-fence`)은 시험 파일을 안 봐서 통과. 권고: 문자열을 `'daily_bars'` 리터럴로 쓰지 않는다(예: `['daily','bars'].join('_')` — 울타리 시험이 쓰는 방식).
- [09:40] **R-3 (LOW) 요청 예산** — 홈·분석 데이터 요청마다 질의가 6~7개 늘었다(보유 1 · 분석 목록 2~3 직렬 · 시그널 1 · 종목별 봉 2). 홈은 이미 질의 약 45개를 요청 몫 4·전역 4·예산 3.8초로 나눠 쓴다. 개별 질의는 빠르다(운영 DB 읽기 실측: 시그널 집계 질의 3회 모두 0.03초 안, `signals` 20,840행·`idx_signals_symbol` 인덱스 전체 훑기 — 수집기와 같은 SQL이라 수집 쪽 비용과 같은 모양). 다만 **느린 날 홈 전체 시간·시간초과 빈도는 미측정**이고, 시간초과는 R-1 과 합쳐 거짓 「일부 저하」가 된다. 시그널 행이 늘면 이 훑기도 선형으로 늘어난다(지금은 문제 아님).
- [09:40] **R-4 (LOW) 조용히 정상으로 새는 좁은 경로** — (a) `exp == null`(최근 40일 동안 수집 예정이 지난 거래일을 못 찾음)이면 `lag=null` 이라 종목 밀림을 안 보고 `available`(대상 목록 오류가 없을 때). 휴장표 이상일 때뿐이라 현실 가능성 낮음. (b) `closed == null`(휴장표 모름)이면 기존대로 `available`+`holidays_unknown` — 설계 4 가 명시한 동작이라 결함은 아님(밀림이 계산되지 않았다는 사실이 화면에 안 보임). 둘 다 설계 허용 범위로 보고 수정 요구는 아님.
- [09:40] 관찰(수정 요구 아님): ① 오늘 산 보유종목·새 시그널 종목은 다음 07:40 수집 전까지 「미수집」이라 3종목 이상이면 최대 약 하루 `stale` — Developer 가 「알려진 한계」에 적은 것과 같고 사실 그대로의 표시다. ② 해외 분석 목록 판독기의 모듈 캐시(`lastGoodManual`·`lastGoodAuto`·`tablesSeen`): ops 요청은 DB에서 제대로 읽은 값으로만 갱신하고(같은 값), 시간초과·손상 때는 캐시를 덮지 않아 오염 경로는 못 찾았다. 다만 시간초과 때 판독기의 `console.warn`(분석 대상 저하 경고)이 웹 프로세스 로그에 남아 분석 경로의 실제 저하와 구별이 안 된다. ③ 대상 규칙이 복제된 구조(ops 쪽 SQL 상수)는 대등성 시험이 SQL 문장 동등·300 상한·오류 이름·시장 판별을 고정해 한쪽만 바꾸면 깨진다(수집기 상수 변경 시 `LIMIT`·`INTERVAL` 문장 비교로 확인). 해외 분석 목록 판독기는 양쪽 시험에서 같은 가짜라 「ops 어댑터를 거친 실제 판독기」는 `bars-lag.test.ts` 의 어댑터 시험(SELECT 외 차단)과 Developer 의 운영 덤프 재생이 근거다.
- [09:40] 울타리·격리: `ops-read-only-fence` 통과(표 이름은 `daily-bars-read.ts` 에만, 쓰기 키워드 0, 알림 import 0). 격리 시험은 기준과 같은 3건 실패 이름·내용(R-2 의 1건 추가분 제외). 보안: 모든 값은 상수 SQL + `IN (?)` 바인딩, 비밀·환경변수 접근 없음.
- [09:40] 돌린 시험(서버 v2 worktree, `nice -n 10`, flock 대기 시간초과(다른 세션이 잠금 보유)로 잠금 없이 직접 실행): ① 5파일(`bars-lag`·`daily-bars-target-parity`·`exit-and-sources`·`ops-read-only-fence`·`isolation`) 231 통과·3 실패(전부 isolation, 기준 동일 이름) — `reviewer-new.log/json`, 기준 `reviewer-base.log/json`. ② `src/lib/ops`+`src/app/analytics`+`src/components/ops` v2 704 통과·1 실패·6 건너뜀 / 기준 658 통과·1 실패·6 건너뜀, 실패는 양쪽 모두 `reason-dictionary-keys`(`paper_only`) 하나 — `reviewer-ops-v2/base.log/json`. `tsc`·ESLint·`src/__tests__` 전체·API 라우트 시험은 내가 돌리지 않았다(미검증, Developer 증빙에만 의존).
- [09:40] 데모 게이트: `check.mjs check --task` 를 Mac 미러·서버 v2 worktree 두 곳에서 실행 → 둘 다 `DEMO_GATE_BLOCKED (task must belong to a canonical project or registered worktree)` — 경로 문제이지 승인 판정이 아니다(정식 task 경로에서 다시 실행 필요). `.claude/state/demo-gate/evidence.jsonl` 에 T-173 줄 0건(approve·waive 대리 실행·상태 파일 직접 쓰기 흔적 없음). 화면 변화는 `DataPanel.tsx` `sourceWhen` 한 줄 접미(` · 밀림 n/m종목`)로 승인 문구 예시와 형식이 같아 implementation 으로 분류하나, 데모 게이트 기록(`approve`/`waive`)은 사용자 확인 대기(Leader 가 이미 표시한 항목).
- [09:40] **최종 판정: CONDITIONAL_PASS (scope: src/lib/ops/metrics/bars-lag.ts, src/lib/ops/metrics/anomalies.ts, src/lib/ops/metrics/anomaly-details.ts, src/lib/ops/metrics/daily-bars-read.ts, src/lib/ops/metrics/types.ts, src/app/analytics/DataPanel.tsx, src/lib/ops/metrics/__tests__/bars-lag.test.ts, src/lib/profit-engine/__tests__/daily-bars-target-parity.test.ts, src/lib/ops/metrics/__tests__/exit-and-sources.test.ts)**
- [09:5x] 재검증(R-1·R-2 수정): `bars-lag.ts` `targetErrorsFor`(국내는 `universe_list` 제외, 해외는 그대로)를 `readBarsLagInput` 이 시장별로 적용 — 봉 조회 성공·실패 두 경로 모두 같은 값을 쓴다. 보유·시그널 실패는 두 시장 그대로라 「확인 못 함이 정상으로 샘」 경로는 늘지 않았다. 추가 시험 2건이 의도(국내 정상·해외만 partial, 보유 실패는 두 줄)를 고정한다. 시험 파일의 표 이름 리터럴은 조각내져 isolation 「daily_bars 참조」 위반 목록이 기준과 같은 수(Received +6)로 돌아왔다. 직접 재실행: 5파일 233 통과·3 실패(isolation, 기준과 같은 이름·같은 위반 목록) / `src/lib/ops`+`src/app/analytics`+`src/components/ops` 706 통과·1 실패(`reason-dictionary-keys` 기준과 동일)·6 건너뜀 — `reviewer-re.log/json`. `tsc`·`src/__tests__` 전체·API 라우트 시험은 내가 돌리지 않았다(QA 몫). R-3·R-4 는 수정 요구가 아니었고 그대로다.
- [09:5x] **최종 판정: CONDITIONAL_PASS (scope: src/lib/ops/metrics/bars-lag.ts, src/lib/ops/metrics/anomalies.ts, src/lib/ops/metrics/__tests__/bars-lag.test.ts, src/lib/profit-engine/__tests__/daily-bars-target-parity.test.ts, src/lib/ops/metrics/__tests__/exit-and-sources.test.ts, src/lib/ops/metrics/__tests__/ops-read-only-fence.test.ts, src/lib/profit-engine/__tests__/isolation.test.ts)**

## QA

- [10:25] 실행 도구: claude(QA 역할). 서버 `ssh home_ubuntu` 의 v2 worktree `~/.node-local/stockinvest-dbstale-v2`(HEAD 7c8f1ae + 미커밋 수정 6·신규 3, Task 문서 1) · 기준 `~/.node-local/stockinvest-dbstale-base`(7c8f1ae). 증거 로그 `~/.node-local/t173-logs/qa-*`. 코드 수정·커밋·push·배포·pm2·cron·DB 쓰기 없음. 운영 DB 는 휴장표 SELECT 1회(`dbq.py`)만 읽었다.
- [10:25] 체크 1 신규·변경 시험 — PASS: `bars-lag.test.ts` 46/46 · `daily-bars-target-parity.test.ts` 12/12 · `exit-and-sources.test.ts` 49/49 (합 107/107, `qa-1-new.log`·`qa-1-new.json`).
- [10:25] 체크 2 관련 묶음 회귀 — PASS (실패는 전부 기준 부채와 동일). 묶음: `src/lib/ops src/__tests__ src/app/analytics src/components/ops src/app/api/ops src/app/api/cron/daily-bars src/lib/profit-engine/__tests__`. v2 1702건 중 1604 통과·92 실패·6 건너뜀 / 기준 1642건 중 1544 통과·92 실패·6 건너뜀. 실패 단언 집합 v2·기준 동일(92/92), v2 에만 있는 실패 0건, 실패 메시지(스택 제외) 92건 전부 동일. 신규 위반 0. isolation 「daily_bars 테이블 참조 0건」 위반 목록은 v2·기준 모두 4개 파일(`capture-operating-data.ts`·`capture-operating-data.test.ts`·`m40/archive-reader.test.ts`·`m40/operating-evidence.test.ts`)로 같다. 로그 `qa-2-v2.log/json`·`qa-2-base.log/json`.
- [10:25] 체크 2 메모 — 잠금: v2 는 `flock` 잠금을 얻어 실행했다(09:57:49 종료). 기준 실행은 잠금 대기 20분 시간초과(다른 세션 `test-cron-runner-news-peek.sh` 가 잠금 보유)라 규칙대로 잠금 없이 `nice -n 10 npx jest --maxWorkers=2` 로 돌렸다(10:17:59 시작·10:20:42 종료, `qa-2-status.txt`). 실행 래퍼는 jest 실패 92건에도 `exit=0` 을 기록했다 — 래퍼 기록은 근거로 쓰지 않고 jest JSON·로그의 `Tests:` 줄을 근거로 했다(QA 도구 메모, 제품 결함 아님).
- [10:25] 체크 3 타입 — PASS: `npx tsc --noEmit -p tsconfig.json` 종료 0, 출력 0줄(`qa-3-tsc.log`). 주의: 이 tsconfig 는 `**/__tests__/**/*`·`**/*.test.ts` 를 제외하므로 신규 시험 파일의 타입은 이 검사 범위 밖이다 — QA 에서 별도 확인하지 않았다(NOT_VERIFIED).
- [10:25] 체크 4 운영 덤프 재생 — PASS: 임시 시험 `zz-t173-qa-replay.tmp.test.ts`(`readDataSources` → `loadClosedDays` → 실제 `readOverseasUniverse`·ops 읽기 래퍼 경로, 표 이름은 상수로만)을 `src/lib/ops/metrics/__tests__/` 에 넣고 실행했다(`qa-4-replay.log`, 1/1 통과). 결과 — 국내: `available`·dateRef 11-13·targets 43·behind 0·missing 0·late1 0. 해외: `available`·dateRef 11-13·targets 126·behind 0·missing 1(`NYS:BRK.B`). 같은 덤프로 시험 밖에서 독립 계산(대상 집합·지연 여부)한 값과 일치. 해외 목록은 `overseas_universe_revision`(125종목)과 보유·시그널 해외 종목으로 채워졌고, 스위치 행 없음·자동 목록 0행은 덤프와 같다. 휴장표는 운영 `market_holidays` 를 읽어 `prod/holidays-qa.out`(국내 45·해외 37 행)으로 남겼다. 임시 시험 파일은 v2 에서 삭제했고 `git status --short` 에 zz 파일이 없음을 확인했다.
- [10:25] 체크 5 경계·시나리오 — PASS. 각 항목의 단언을 `bars-lag.test.ts` 에서 찾아 통과를 확인했다. 누락된 단언은 없어 임시 시험을 더 만들지 않았다.
  - 임계: 밀림 2 → 정상(숫자만), 밀림 3 → `stale`/`bars_symbols_behind`, 밀림 2+미수집 1 → `stale` (94행)
  - 40종목 하루 늦음 → 경고 없음, `available`·late1 40 (107행)
  - 11-06 재현: 11-10 08:31 → 정상(145행) · 11-11 08:31 → `stale` 42종목 2거래일 밀림(150행) · 같은 입력을 시장 마지막 봉만 보는 옛 판정 → 정상(150행). 11-10 옛 판정 정상은 별도 단언이 없다(밀림 0 이라 결함으로 보지 않음).
  - 연속 실패 중단 → 보유 외 전부 밀림 → `stale`(targets 5·behind 4) (159행)
  - 휴장표 모름 → `holidays_unknown`, 밀림 계산 안 함 (131행)
  - 종목별 봉 조회가 한 시장만 실패 → 그 시장만 `partial`/`bars_lag_unread`, 국내는 `stale` 유지 (286행)
  - 해외 분석 목록 저하 → 해외 줄만 `partial`/`bars_targets_partial`, 국내는 정상 (268행)
  - `lagIn` 없이 호출 → 옛 출력과 같고 `lag` 키 없음 (88행)
- [10:25] 체크 6 안전 경계 — PASS. 변경·신규 파일 10개(수정 6·신규 3·Task 문서 1)를 `scripts/git-hooks/commit-msg` 의 `SAFETY_PATHS` 84개 패턴과 대조해 0건. 주문·안전장치·cron·수집기 구현 파일은 변경 0(`daily-bars-store.ts`·`universe-overseas-static.ts`·cron-runner 포함). 참고: `bars-lag.ts` 가 `SAFETY_PATHS` 에 든 `src/lib/strategy/universe-overseas-static.ts` 를 **읽기 용도로 import** 한다. 그 파일은 바뀌지 않았고, 판독기는 ops 읽기 래퍼(SELECT 외 차단 시험 통과)로만 DB 를 읽는다. `ops-read-only-fence.test.ts` 69/69 통과(쓰기 SQL 0·알림 import 0).
- [10:25] 체크 7 화면 문구 — PASS (텍스트 로직): `sourceWhen` 시험(332행) — 밀림 42/43 → `11-10 · 밀림 42/43종목` · 미수집 1/126 → `… · 밀림 1/126종목` · 하루 늦음 40 → `11-10` · 밀림 정보 없음 → `11-10`. 실제 화면 렌더는 확인하지 않았다(아래 NOT_VERIFIED).
- [10:25] 화면 검증 — NOT_VERIFIED: 이 라운드는 `DataPanel.tsx` 를 바꿨으므로 CLAUDE.md 화면 검증 절(다크/라이트 × 412·1280px, 가로 스크롤 0, 다크 토큰 계산값, 터치 44px)을 요구한다. 브라우저 렌더는 실행하지 않았다. 이유: 이번 체크리스트는 텍스트 시험을 지정했고, 서버에서 앱을 띄우면 운영 DB 연결과 기동 시 부작용을 먼저 확인해야 해 QA 범위에서 뺐다. 변경은 기존 줄 끝의 문구 한 덩어리뿐이라 레이아웃 영향은 작을 것으로 보지만 실측은 없다. 배포 전 확인 여부는 Leader 판단.
- [10:25] 미검증(NOT_VERIFIED) 목록: ① 화면 브라우저 렌더·가로 넘침·터치 대상(위 항목) ② 신규 시험 파일 타입체크(tsconfig 제외 — 위 항목) ③ ESLint(저장소에 설정 없음 — Developer 기록과 같음) ④ 느린 날 홈 전체 시간·시간초과 빈도(Reviewer R-3 — 미측정 그대로) ⑤ Codex 검토(C1·C2 모두 서버 모델 거부로 실패 — 본 QA 판정에 포함되지 않음).
- [10:25] 데모 게이트: QA 는 `approve`·`waive` 기록을 만들거나 바꾸지 않았다. Leader 가 표시한 「사용자 확인 대기」 상태를 그대로 둔다.
- [10:25] 기준 부채(기준 `7c8f1ae` 에서도 실패, v2 와 메시지까지 동일) — 92건: `t156-paper-view-render` 32 · `t162-entry-watch-render` 21 · `t108-trade-render` 20 · `t108-analytics-render` 6 · `t108-scenario-detail-result` 6 · `isolation` 3(「daily_bars 참조 0건」 4개 파일 위반 1건 · `daily-bars-store.ts → @/lib/strategy/universe-overseas-static` 허용 목록 1건 · `@/lib/strategy` 참조 1건) · `t108-terms-fence` 2 · `reason-dictionary-keys`(`order`) 1 · `t108-watch-cancel-sheet` 1.
- [10:25] 결함: 없음 (Critical·High·Medium·Low 0건). 관찰 메모 1건 — `barsRow` 에서 `exp == null`(기대 거래일을 40일 안에 못 찾음)이면 밀림을 세지 않고 `available` 로 떨어지는 좁은 경로가 있다. Reviewer R-4 와 같은 내용이며 재현하지 않았다(수정 요구 아님).
- [10:25] 정리: 임시 시험 파일 서버 v2 에서 삭제 완료(`git status --short` 에 zz 파일 0건). Mac 미러 scratchpad 사본도 삭제했다. 증거 로그는 서버 `~/.node-local/t173-logs/qa-*` 에 남긴다(`qa-1`·`qa-2`·`qa-3`·`qa-4`·`qa-6` 과 `prod/holidays-qa.out`).
- [10:25] 결론: 체크리스트 1~7 은 통과했고 결함은 0건이다. 다만 화면 시각 검증(CLAUDE.md 화면 검증 절)은 미실행이라 NOT_VERIFIED 로 남는다. 배포 판단은 Leader 몫이다.
- [10:25] **QA 판정: PASS (체크리스트 1~7 기준 · 화면 시각 검증 NOT_VERIFIED)**

## Codex 검토

### [2026-11-15 09:29] C1 adversarial-review focus=design_assumption — 실패(codex_exit_1: 모델 거부 model_not_found, 2초)
- judge 판정: 판단 기록 「[2026-11-15 09:26] codex_gate/C1 … codex_required=true · mode=adversarial-review · focus=design_assumption」 / 호출 차수: 1/4
- 대상: repo=/home/brownjeon/.node-local/stockinvest-dbstale base=7c8f1ae(task_file) snapshot=5c51b15
- 지적: 없음 — Codex 응답을 받지 못해 검토되지 않았다(0건은 「검토 후 지적 없음」이 아니다)
- 검토하지 못한 범위: 설계 가정 4개 전부 — 대상 규칙 복제·대등성 시험으로 충분한지, 임계값(2거래일·3종목), 판정 순서, 확인 불가 시 partial 표시. 서버 Codex 설정 `~/.codex/config.toml` 의 `model = "gpt-6.1-sol"` 을 ChatGPT 계정이 거부(HTTP 400, `model_not_found`). 설정·CLI 버전·모델은 바꾸지 않았고 재시도하지 않았다(사용자 결정 대기).
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261115T002954Z-T-173-C1/raw.txt · stderr: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261115T002954Z-T-173-C1/stderr.txt · 인계 묶음: /home/brownjeon/.node-local/t173-logs/handoff-T-173-C1.md · 래퍼 출력: /home/brownjeon/.node-local/t173-logs/codex-C1-run.json

## 배포 기록

| 항목 | 값 |
|---|---|
| 실행 | 메인 세션(이 task 진입점) — deployer 서브에이전트 없이 push(webhook) 로 배포. 사용자 승인 원문 "push 진행" |
| 커밋 | `a3e2032` (부모 `bd65785` = push 직전 origin/main, 사이에 낀 커밋 없음) |
| push | 2026-11-15 14:55:34 KST · `git push origin a3e2032:main` · `bd65785..a3e2032` |
| 결과 | `RELEASE_RESULT {"status":"ok","release":"20261115-145551-a3e2032c","sha":"a3e2032c…","previous":"…/20261115-085857-bd657854","migrated":false}` · 웹훅 로그 종료 14:57:00 KST `exit=0` |
| 같은 배포에 실린 다른 작업 | 없음(직전 운영 릴리스가 `bd65785` 였고 이번 push 는 `a3e2032` 1건) |
| 확인 | pm2 `stockinvest`·`stockinvest-cron` 모두 online · `pm_cwd` = 새 릴리스 · 재시작 0 · 기동 14:56:22 / `GET /api/health` 200, `safetyStatus: green` / 운영 `package.json` version `0.12.0` |
| 기동 로그 | `setup_db` 실패 줄 6개(ordinal 10·61·62·63·65·66, ALTER·CREATE) — 오늘 08:27·08:58 기동에도 같은 6개가 나오는 기존 현상이라 이번 변경과 무관(T-173 은 DDL 없음). 14:56:52 `telegram-poller getUpdates ETIMEDOUT` 1회 — 네트워크 일시 오류로 보이며 이번 변경과 무관(ops 지표는 알림을 import 하지 않는다) |
| 롤백 | `git revert a3e2032` 후 push(= 재배포). 급하면 `current` 를 `…/20261115-085857-bd657854` 로 되돌리는 release 롤백 — `docs/deploy-order.md` 롤백 절 |
| 확인 못 함 | 로그인이 필요한 데이터 상태 API·화면의 실제 응답(운영 덤프 재생으로 같은 코드 경로를 대신 확인 — QA 체크 4) |

## 최종 요약

### [T-173] 일봉 감시 — 수집 대상 종목마다 밀림을 세어 「오래됨」을 판정

- **상태**: ✅ 완료 · ⏳ 사용자 확인 대기(화면) · 결정 2건 대기(데모 기록·Codex 설정)
- **무엇이 바뀌었나**: 일봉 감시가 시장별 「가장 최근 봉 하나」 대신 수집 대상 종목(국내 43·해외 126, 11-15 기준)을 하나씩 본다. 기대 거래일보다 2거래일 이상 밀린 종목과 일봉이 한 줄도 없는 종목이 시장별로 3개 이상이면 그 시장 일봉을 「오래됨」으로 띄운다(홈 「데이터 이상」). 분석 › 데이터 상태의 일봉 줄 뒤에 ` · 밀림 n/m종목`이 붙고(밀린 종목이 있을 때만), 이상 상세에 밀린 수·기대 거래일·예시 종목이 나온다. 이번 사고 모양(국내 42종목이 11-06 에 멈춤)은 11-11 08:30 에 잡힌다 — 예전 판정은 「정상」이었다. 앱 버전 0.12.0.
- **배포**: ✅ 운영 반영 — 커밋 `a3e2032` · 2026-11-15 14:55 KST push(webhook blue/green) · 결과 ok(릴리스 `20261115-145551-a3e2032c`, 14:57 완료)
  - 같은 배포에 함께 실린 작업: 없음
- **AI 가 검증한 것**: 새 시험 107/107 · 관련 묶음 1,702건을 기준 커밋과 단언별 대조해 새 실패 0(기존 실패 92건은 기준과 메시지까지 같음) · tsc 0 · 운영 DB 읽기 전용 덤프 재생(국내 43종목 밀림 0, 해외 126종목 중 미수집 1 `NYS:BRK.B` → 둘 다 정상) · 수집기와 대상 목록 대등성 시험 · 안전 경로(SAFETY_PATHS) 변경 0 · 배포 후 pm2 2개 online·헬스 200·safetyStatus green·버전 0.12.0
  - 검증 못 한 것: 실제 화면 렌더(412px 줄바꿈·가로 넘침) · 로그인 뒤 데이터 상태 API 실응답 · 느린 날 홈 전체 응답 시간(Reviewer R-3) · Codex 외부 검토(C1 실패·C2 미실행 — 서버 Codex 모델 설정 거부) · ESLint(저장소에 설정 없음)
- **👉 사용자가 확인할 것**:
  1. 지금부터 휴대폰 Chrome(또는 앱) → 분석 › 데이터 상태 → 「일봉 해외」 줄이 `… · 밀림 1/126종목`으로 보이고, 「일봉 국내」 줄에는 밀림 문구가 없으면 정상(BRK.B 1종목은 한 번도 수집되지 않았지만 3종목 미만이라 경고는 없다). 줄이 화면 밖으로 넘치거나 가로 스크롤이 생기면 이상.
  2. 홈 「데이터 이상」에 일봉 항목이 없으면 정상(지금 밀린 종목은 해외 1개뿐).
- **👉 사용자가 결정할 것**:
  1. 데모 기록 — judge 가 화면 문구 한 줄에 delta 데모를 요구했다. 설계 승인 때 보신 문구 예(`일봉 국내 · 11/13(금) · 밀림 42/43종목`)를 데모 승인으로 기록할지, 생략(waive)으로 기록할지. AI 권고: 승인으로 기록(실제 구현 문구가 그 예와 형식이 같다). 기록은 사용자 확인 뒤 `check.mjs` 로만 한다.
  2. 서버 Codex 설정 — `~/.codex/config.toml` 의 모델 값을 계정이 거부한다. 모델을 바꾸거나 CLI 를 갱신할지. AI 권고: CLI 갱신을 먼저 시도(Mac 10-31 사례에서 같은 증상이 갱신으로 풀렸다 — [추측]). 고치면 C2 를 다시 돌릴 수 있다.
- **남은 일**: 이 배포 기록·최종 요약의 문서 커밋 push(push = 재배포라 별도 승인) · board·ACTIVE 반영(다른 세션 동시 갱신을 피해 손대지 않음) · BRK.B 미수집 원인 조사와 cron 의 `daily-bars OK` 줄에 남은 수 표시는 이 task 범위 밖(별건 후보)
- **이슈·위험**: 분석 대상을 3종목 이상 새로 넣으면 다음 수집(07:40) 전까지 그 시장이 「오래됨」으로 보일 수 있다(실제로 일봉이 없으니 사실 그대로의 표시) · 국내 저녁 실행은 시그널 300 상한을 국내만으로 세 시그널 종목이 300을 넘으면 두 집합이 갈린다(11-15 실측 122) · 롤백: `git revert a3e2032` 후 push

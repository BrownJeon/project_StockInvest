---
task_id: T-170
title: 일봉 수집 굶주림 해소 — KR 저녁 전용 실행 추가 + 보유 다음 「낡은 순」 대상 정렬
status: review
priority: high
project: StockInvest
created: 2026-11-14
updated: 2026-11-15
base_ref: b90e2c9d1b64703adf1aa55f117df2eb6bef748e
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex, deployer]
related_tasks: [T-070-daily-bars-phase0, T-117-daily-bars-cron-registration, T-099-daily-bars-adjustment-false-positive]
tags:
  - type/task
  - domain/data
  - domain/cron
aliases:
  - 일봉굶주림
  - KR일봉저녁수집
waiting: [push_confirm, user_decision]
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: 조사(읽기 전용)부터 구현·감사·QA·커밋까지. push·배포는 사용자 승인 후
  last_event_id: E2
---

# T-170 일봉 수집 굶주림 해소 — KR 저녁 전용 실행 + 「낡은 순」 대상 정렬

## 목표·배경 (Leader)

**한 문장**: 하루 1회(07:40) 일봉 증분 수집의 예산(150호출·100초)보다 대상 수요가 커져, 목록 뒤쪽 종목(국내 43종목 전부·미국 21종목)이 11-06 이후 영구히 수집되지 않는다. 국내를 저녁 전용 실행으로 떼어 내고, 남는 초과분은 「가장 오래 안 받은 종목 먼저」 정렬로 순환시켜 어느 종목도 계속 밀리지 않게 한다.

**조사 결과(2026-11-14, 읽기 전용 — 상세: 그룹 공유 노트 `kr-daily-bars-stall-2026-11-14.md`)**
- [확실] T-156 커밋 `51d0105`(11-08 09:49 KST)이 `loadDefaultTargets` 의 보유종목 다음·시그널 앞에 해외 분석 목록(`overseas_universe_revision` #1, 125종목)을 넣었다. 순서 = 보유 6 → 해외 분석 125 → 90일 시그널. 국내 43종목은 모두 시그널 출신이라 128~169번째로 밀렸다.
- [확실] pm2 로그 `[daily-bars] done`: 11-09부터 매일 targets=169, processed 45~99, 호출 150/150 또는 시간 100초 소진, remaining 71~125. KIS 오류 0(`failed=-`, pm2-err·cron-err 관련 0줄).
- [확실] 대상 목록을 DB 로 재구성하면 169개로 로그와 일치한다. 1~99번(국내 보유 005930 + 미국 98)만 최신이고, 100~127번(미국 21 + 행 없는 7)과 128~169번(국내 43)은 11-06에서 멈췄다.
- [가능성 높음] 구조 문제: 평일(KST 화~토) 증분 수요 ≈ 미국 126 + 국내 44 ≈ 170호출 > 150. 11-03 실측 호출당 약 0.75초. 국내를 빼도 미국 약 126호출 ≈ 95초로 시간 예산 100초에 거의 닿는다 — 순서가 고정이면 같은 미국 뒤쪽 종목이 계속 밀린다.
- [확실] 감시 미탐: `ops/metrics/daily-bars-read.ts` 는 시장별 MAX(trade_date) 하나만 본다(005930 이 매일 갱신 → 국내 「정상」). cron 은 HTTP 200 이면 `daily-bars OK` 한 줄.

**하지 않는 것**: 예산(150호출·100초)·`DAILY_BARS_CURL_MAX_TIME` 상향, 07:40 블록의 시각·본문 변경, 대상 종목 정책(보유·분석 목록·시그널 90일·300 상한) 변경, 감시 지표(`ops/metrics`) 변경(별건), 밀린 국내 봉의 수동 일회 백필(별도 승인 — 새 저녁 실행이 첫 실행에서 증분 한 칸으로 채운다), DDL, 주문·시그널·전략 코드.

## 사용자 지시·승인 (원문 보존 — 4D Diligence)

- 2026-11-14 20:1x(사용자 원문): "근본 수정부터" — 직전 보고의 선택지 중 근본 수정(국내 저녁 전용 실행)을 일회성 수동 채우기보다 먼저 하라는 지시.
- 2026-11-14 20:2x(사용자 선택, 질문 「일봉 수집 근본 수정의 범위를 어디까지 할까요?」): **「저녁 KR + 낡은 순 (Recommended)」** — ① 18:10 KST 국내 전용 실행 추가 ② 보유종목 다음을 「가장 오래 안 받은 종목 먼저」로 정렬.
- **이 지시가 허용하는 것**: 위 ①② 의 구현·시험·감사·커밋, 그리고 ①이 부르는 기존 수집 경로의 KIS 읽기 조회(국내 기본 대상, 저녁 오프아워 창 안, 하루 1회). T-117 이 막아 둔 「하루 2회 이상 호출」을 **국내 저녁 1회 추가**에 한해 바꾼다.
- **허용하지 않는 것(별도 승인)**: push·배포(사용자 승인 후), 예산 상향, 수동 일회 백필, 감시 지표 변경, 대상 정책 변경.

## 설계 (Leader — Developer 구현 사양)

1. **대상 정렬(`src/lib/profit-engine/daily-bars-store.ts` `loadDefaultTargets`)**: 보유종목(position_state, 심볼순)은 맨 앞 그대로. 나머지(해외 분석 → 시그널 순으로 모은 목록)는 저장된 `MAX(trade_date)` **오름차순 안정 정렬**(같은 날짜끼리는 기존 순서 유지 — T-156 「분석 먼저」는 동률 안에서 보존). 행이 없는 종목은 가장 낡은 것으로 본다(백필이 앞에 온다 — T-156 의 「신호 전에 이력 확보」 의도). 질의는 한 번: `SELECT market, symbol, MAX(trade_date) … FROM daily_bars GROUP BY market, symbol`(PK 범위, 읽기 전용). 이 질의가 실패하면 **기존 순서로 계속**하고 `errors` 에 `staleness_order` 를 남긴다. 요청에 `symbols` 를 직접 준 경우는 정렬하지 않는다.
2. **시장 필터**: 라우트 본문에 `market`(`"KR"`|`"US"`)을 받는다. 있으면 기본 대상을 그 시장만 남긴다(보유 포함). `"KR"` 이면 해외 분석 목록을 읽지 않는다. `symbols` 와 함께 주면 400(둘은 배타). 모르는 값은 400.
   - **(정정 23:2x)** 쿼리 `?market=KR|US` 도 받는다(`parseDailyBarsRequest`) — 본문 `market` 과 같은 뜻. 모르는 쿼리 키·`market` 두 번·본문에도 `market`·본문이 객체가 아님이면 400. 러너는 쿼리를 쓴다(아래 3 정정).
3. **국내 저녁 실행(`scripts/cron-runner.sh`)**: 새 블록 `daily-bars-daily-kr (T-170)` — 매일 18:10~18:54 KST 첫 틱에 ~~`call "/api/cron/daily-bars" "daily-bars-kr" '{"market":"KR"}'`~~ → **(정정 23:2x) `call "/api/cron/daily-bars?market=KR" "daily-bars-kr"`**(본문 인자 없음 — 아래 「구현 중 발견: call() 본문 인자 결함」), 날짜파일 `~/.node-local/stockinvest/daily-bars-kr-last-date`(호출했으면 성공·실패 무관 기록, 하루 1회, 재시도 없음), curl 상한 `DAILY_BARS_CURL_MAX_TIME`(120초). 같은 틱에 해외 뉴스 peek 가 돌았으면 다음 틱으로 미룬다(peek 블록 뒤에 두고 `PEEK_RAN_LABEL` 로 판정). 18:55 이후 못 불렀으면 그날 한 번만 건너뜀 로그를 남긴다. 근거: 국내 봉 확정 15:40·시간외 단일가 18:00 종료 뒤, 라우트 오프아워 창(15:40~22:20, 분 3~55) 안, 16시 국내 분석·17시 종목 메타·21/22시 보유 공시 확인과 겹치지 않음. 예상 부하: 국내 44호출 ≈ 35~45초.
4. **07:40 블록은 그대로**(본문 없음 = 전 시장). 저녁 실행이 성공하면 국내는 아침에 이미 최신이라 0호출이고, 실패한 날은 정렬 덕에 국내 낡은 종목이 아침 실행 앞쪽으로 와 대신 받는다.
5. **하트비트**: 18시대 최악 = curl 120 + 매 분 잡 약 30 + sleep 60 ≈ 210초 < 300초(peek 와 같은 틱이면 미루므로 둘이 더해지지 않는다).
6. **시험**: 정렬(보유 맨 앞·낡은 순·행 없음 먼저·동률 순서 보존·질의 실패 시 기존 순서+오류 표시)·시장 필터(KR 이면 분석 목록 미조회)·본문 검증(`market` 허용값·`symbols` 와 배타)·러너(18:10~18:54 에만 하루 1회 호출·본문 `{"market":"KR"}`·peek 같은 틱이면 미룸·18:55 이후 건너뜀 로그 1회·하트비트 < 300초·07:40 블록과 기존 호출 불변). 기존 러너 시험 전부·`daily-bars` jest 전부는 기대값을 약화하지 않고 통과해야 한다.
7. **훅**: `scripts/cron-runner.sh`·`src/app/api/cron/` 는 `SAFETY_PATHS` — Reviewer 판정 줄의 scope 가 스테이징 파일을 덮어야 한다. `src/lib/profit-engine/daily-bars-*` 는 감시 밖이지만 같은 Reviewer 가 본다.
8. **(구현 중 추가 — Leader 21:3x) 실행 기록 잡 표**: 러너 라벨이 새로 생기면 `src/lib/strategy/records/job-slots.ts` `JOB_SPECS` 에도 있어야 기록 라우트가 슬롯·시장을 바르게 정한다(없으면 `fallbackSpec` 으로 조용히 남는다). → `daily('daily-bars-kr', 'ingest', 'domestic', 'kis', '18:10', 50)` 추가(창 18:10~18:54 + 여유 5분). 정합 시험의 `CALL_RE` 는 라벨 뒤 본문 인자가 붙은 호출 줄을 읽지 못해 이 누락을 잡지 못했다 → 작은따옴표 본문 인자 하나를 허용하도록 정교화(러너에서 그런 줄은 새 줄 하나뿐 — 실측). 화면 잡 이름 사전 `src/lib/ops/reason-dictionary.ts` `JOB_NAME_KO` 에 `'daily-bars-kr': '국내 일봉 수집(저녁)'`(「모든 잡이 이름을 갖는다」 시험이 요구). `^src/lib/strategy/` 는 SAFETY_PATHS 다.
9. **(구현 중 추가) 러너 블록 이름** `daily-bars-daily-kr` — 기존 러너 시험들의 정적 제외 규칙(`daily-bars-daily` 접두, `^DAILY_BARS_`)이 새 블록·선언도 함께 제외한다. ~~T-117 시험은 같은 경로의 두 호출을 본문으로 갈라 07:40 블록만 보도록 좁혔다.~~ **(정정 23:2x)** 경로가 `?market=KR` 로 갈리므로 호출 비교는 각 시험에서 그 경로를 따로 뺀다(holdings-premarket·⑨ 스냅샷과 같은 방식 — 기대값 불변). 새 블록은 전용 시험 `scripts/test-cron-runner-daily-bars-kr.sh` 가 변경 전 러너(`b90e2c9`)와 같은 하네스로 비교한다.
10. **(구현 중 발견 23:1x — 🔴 call() 본문 인자 결함)** `call()` 의 `local body="${3:-{}}"` 는 셋째 인자를 주면 끝에 `}` 를 하나 더 붙인다(bash 가 기본값 `{` 뒤 첫 `}` 에서 확장을 닫고 남은 `}` 를 글자로 둔다 — 서버 bash 에서 `f a b '{"market":"KR"}'` → `{"market":"KR"}}` 실측). 지금까지 본문 인자를 넘긴 호출이 0줄이라 드러나지 않았다. 1차 구현(본문 `{"market":"KR"}`)대로 배포했다면 국내 저녁 호출이 **매일 400(invalid json)** 으로 끝나 아무것도 받지 못했다 — 새 러너 시험 K1(가짜 curl 이 받은 본문 `{"market":"KR"}}`)이 잡았다. 결정: `call()` 은 주문 잡을 포함한 모든 잡이 쓰고 여러 시험이 본문 해시를 고정하므로 **고치지 않고**, 시장을 쿼리로 넘긴다(선례: `news-fetch?market=`). 결함 자체의 수정은 후속 과제로 보고한다. 재발 방지 핀: K6 「본문 인자(셋째 인자)를 넘기는 call 줄 = 0」, route 시험 「`}` 가 덧붙은 본문은 400」.
11. **(정정 23:2x) 8 의 `CALL_RE` 정교화는 되돌렸다** — 본문 인자가 붙은 호출 줄이 다시 0줄이 되어 필요 없다(`job-slots.test.ts` 는 기준과 같음). `JOB_SPECS` 의 `daily-bars-kr` 줄은 그대로(정적 라벨 정합 시험이 이 줄을 요구한다). 상단 잡 목록 주석은 `(T-112) 실행·상태 기록 후크` 항목 **뒤**로 옮겼다 — 앞에 두면 그 항목이 45줄 밖으로 밀려 job-run-log J8(`sed -n '1,45p'`)이 깨진다(1차 실행에서 실측).

## 알려진 위험·후속 과제 (Leader — 02:2x 기록, 이 task 범위 밖)

- **위험 1 (Reviewer 발견 2, [추측])**: 낡은 순 정렬은 「저장된 마지막 거래일」만 본다. KIS 오류로 계속 `failed` 가 나는 종목이 생기면 그 종목은 매일 맨 앞에 서고, 그런 종목이 3개 연속이면 `consecutive_failures` 로 그날 실행이 시작하자마자 멈춘다(`daily-bars-collector.ts` `MAX_CONSECUTIVE_FAILURES=3`). 예전 고정 순서에서는 그 앞 종목들이라도 처리됐다. `no_data`(빈 응답)는 연속 실패로 세지 않으므로 상장폐지·잘못된 심볼 대부분은 해당 없음. 현재 근거 없음(11-09 이후 실측 `failed=-`). 후속: 실패 종목을 뒤로 보내기, 또는 감시 지표에 반영.
- **위험 2 (Reviewer 발견 3)**: 정렬이 `adj_stale`(수정주가 재수집 필요) 플래그를 보지 않는다. 예산이 모자란 기간에만 재수집이 늦어진다. 조치 없음, 인지만.
- **후속 과제(별도 승인)**: ① 러너 `call()` 의 `${3:-{}}` 결함(셋째 인자에 `}` 덧붙임) 수정 ② 기준 커밋에서 이미 실패하는 시험 부채(m40 이 러너를 바꾼 뒤 제외 규칙·`JOB_SPECS` 미갱신, T-160 call() 해시 고정, T-156 isolation 3건, `reason-dictionary-keys`·corp-intel isolation·`home-render-t108`) ③ 일봉 감시 지표를 시장별 MAX 하나에서 「낡은 종목 수」로(이번 미탐의 원인) ④ 선택: 국내 43종목 일회 채우기(저녁 실행이 첫날 대부분 채운다 — 국내 44호출 예상).

## 판단 기록 (judge)
- [2026-11-14 21:08] intake engine=jev → task_type=local_fix · risk=R2 · developer_model=opus · next=demo_first(blocking_gate=demo) · roles=designer,developer,reviewer,qa · codex_required=- | overrides=R2-kw-payment,DM-kw-risky-cta | fallback=- | tokens=1498 | demo=delta/designer
- [2026-11-14 21:08] codex_gate/C1 engine=jev → codex_required=false · wanted_before_budget=false · budget_rule=CX-limit-unknown-r2 (remaining_limit_pct=null, codex-review limit reason=stale) · codex_switch=on · codex_calls_used=0 | overrides=- | fallback=- | tokens=924 | demo=delta/designer
- [21:2x Leader] **데모 판정 = 키워드 오탐**: intake 요약의 「목록」·「필터」가 화면 문맥 정규식(`UI_CONTEXT`)에, 「주문(없음)」·「추가」가 위험 동작 정규식(`RISKY_OBJECT`·`RISKY_CHANGE`)에 걸려 `DM-kw-risky-cta` → delta 가 나왔다. 이 task 는 화면 파일을 바꾸지 않는다(변경 경로 전부 API·수집기·러너·시험·잡 이름 사전). `check.mjs init` 은 작업 사본 경로를 거부했다(`DEMO_GATE_REFUSED: task must belong to a canonical project or registered worktree`) — 데모 게이트 상태는 **미기록**. 생략은 사용자 원문 증거로만 기록되므로(`check.mjs waive`) 사용자에게 생략 여부를 묻는다(대리 생략 안 함). 커밋 훅은 데모 상태를 보지 않는다(`commit-msg` 에 demo 참조 0 — 실측).
- [21:2x Leader] C1 `codex_required=false` 를 따른다(한도 값 미기록 `CX-limit-unknown-r2`). T-117 은 같은 R2 에서 Codex 필수였으나 그때는 한도 값이 있었다 — 판정을 뒤집을 사용자 요청이 없어 override 하지 않는다.
- [2026-11-15 02:13] codex_gate/C2 engine=jev → codex_required=true · wanted_before_budget=true · mode=adversarial-review · focus=error_handling · budget_rule=CX-limit-unknown-r2 (remaining_limit_pct=null, codex-review limit reason=stale) · codex_switch=on · codex_calls_used=0 | overrides=- | fallback=- | tokens=1282 | demo=delta/designer



## Developer

- [21:4x] 실행 주체: 메인 세션(Claude, Leader 겸 Developer — developer_model=opus 판정과 같은 등급). 작업 위치: 서버 worktree `~/.node-local/stockinvest-t170`(base `b90e2c9`), 편집은 Mac 스크래치 미러 → tar over ssh.
- [21:4x] 변경 파일(13 + 새 시험 1):
  - `src/lib/profit-engine/daily-bars-store.ts` — `loadDefaultTargets(db, { market? })`: 시장 필터(보유 포함), `market==='KR'` 이면 해외 분석 목록 미조회. 새 읽기 질의 `TARGET_MAX_DATES_SQL`(`SELECT market, symbol, MAX(trade_date) … GROUP BY market, symbol`)로 보유 뒤 나머지를 마지막 거래일 오름차순 안정 정렬(행 없음 = 가장 낡음, 동률 = 모은 순서). 질의 실패면 모은 순서 + `errors: staleness_order`. 나머지가 2개 미만이면 질의하지 않는다.
  - `src/lib/profit-engine/daily-bars-collector.ts` — `CollectOptions.market`·`CollectResult.market`, 기본 대상에만 전달, 완료 로그에 `market=<KR|US|all>`(이 로그를 파싱하는 코드 0 — 실측). 머리 주석의 「cron-runner 미등록」 낡은 문구 정정.
  - `src/lib/profit-engine/daily-bars-request.ts` — 본문 키 `market`(`KR`|`US`만, `symbols` 와 함께면 400).
  - `src/app/api/cron/daily-bars/route.ts` — 머리 주석만(정기 호출 2개·`market` 키·낡은 순). 코드 변경 0.
  - `scripts/cron-runner.sh` — 블록 `daily-bars-daily-kr`(peek 블록 바로 뒤), 날짜파일 선언 `DAILY_BARS_KR_LAST_RUN_FILE`, 상단 잡 목록 주석 3줄. 추가만.
  - `src/lib/strategy/records/job-slots.ts` — `daily-bars-kr` 슬롯(18:10, 50분). `src/lib/ops/reason-dictionary.ts` — 이름 1개.
  - 시험: `daily-bars-collector.test.ts`(+6: 정렬·질의 실패·KR·US·필터 없음/symbols·🔴 굶주림 회귀), `fake-bars-db.ts`(새 질의 인식·실패 주입), `route.test.ts`(+4 거부·+1 허용·+1 전달), `job-slots.test.ts`(`CALL_RE` 정교화), `reason-dictionary-t130.test.ts`(+1 행·키 24), `scripts/test-cron-runner-daily-bars.sh`(07:40 블록으로 좁힘 — 기대값 불변), 새 `scripts/test-cron-runner-daily-bars-kr.sh`(K1~K6).
- [21:4x] 실행 결과: `jest daily-bars-collector·route(2)·daily-bars-time·isolation` → 164 통과·3 실패. **실패 3건은 기준 커밋 `b90e2c9` 에서도 같은 3건으로 실패한다**(별도 worktree `stockinvest-t170-base` 에서 isolation.test.ts 만 실행 → 59 중 3 실패, 같은 이름) — T-156(`51d0105`)이 `daily-bars-store.ts` 에 넣은 `@/lib/strategy/universe-overseas-static` import 2건과 `capture-operating-data.ts`·m40 시험의 `daily_bars` 참조 1건. 이 task 의 변경이 만든 실패가 아니며 범위 밖(후속 과제로 보고).

- [23:3x] **2차(결함 회피·시험 정합)** — 1차 러너 시험 11개(`~/.node-local/t170-logs/*.sh.log`)에서 실패를 기준 커밋과 대조했다(기준 worktree `stockinvest-t170-base` 에서 같은 시험 실행 — `~/.node-local/t170-logs/base/`).
  - 이 task 가 만든 실패: ① K1·D1 본문 `{"market":"KR"}}`(위 설계 10 — 실제 결함) ② job-run-log J8 상단 주석 45줄 창(설계 11) ③ isolation.test.ts 의 T-117 등록 고정 4건(블록이 둘이 됨) ④ `route-integration.test.ts` 가짜 요청에 `nextUrl` 없음(쿼리 읽기 추가 뒤) ⑤ isolation 의 `\bfetch\(` 금지가 내 주석 「news-fetch(`?market=`)」에 걸림(주석 문구 수정).
  - 기준 커밋에서도 같은 실패(이 task 무관 — m40·T-160 이 러너를 바꾼 뒤 기준 ref·제외 규칙을 갱신하지 않음): daily-bars D1·D6 5건, job-run-log J1·J8·J13, news-split D·F6·E·F7 call() 해시, overseas-universe U4·U5, `job-slots.test.ts` E11(m40-forward·m40-forecast 가 `JOB_SPECS` 에 없음), `reason-dictionary-keys`(`paper_only`), corp-intel isolation(analysis-data·m40 참조), `home-render-t108`(197건 중 다수) — 기준 worktree 에서 4개 jest 파일 모두 실패 재현(23:1x).
  - 변경: `daily-bars-request.ts` `parseDailyBarsRequest(raw, query)` 추가 · `route.ts` 가 `req.nextUrl.searchParams` 를 함께 넘김(쿼리 없으면 예전과 같음) · 러너 호출 줄 `call "/api/cron/daily-bars?market=KR" "daily-bars-kr"` · 상단 주석 위치 이동.
  - 시험 갱신(기대값 불변, 국내 저녁 경로 제외만): `test-cron-runner-daily-bars.sh`(1차 변경을 대부분 되돌림 — nodb·--max-time 에서 `?market=KR` 제외, 07:40 표지 정확 일치), `test-cron-runner-news-split.sh`(호출 2·상한 2곳 제외 + 머리 주석), `test-cron-runner-overseas-universe.sh`(nouv·상한 해시 제외, U1 「120 상한 잡」 기대값에 `daily-bars?market=KR` 추가 — 의도된 셋째), `test-cron-runner-holdings-premarket.sh`(H9 `noc` 에 새 블록·선언), `test-cron-runner-job-run-log.sh`(기준 비교 전용 `nojrl_cmp`·`nojrlmt`·`nokfout`·`dfiles` 에서 제외 — 스풀 자기 정합은 그대로 센다), `isolation.test.ts`(T-117 → 「T-117·T-170 등록 고정」 두 블록·호출 정확히 2줄), `route.test.ts`(쿼리 거부 8·허용 표·러너 그대로 요청·`}` 덧붙은 본문 400), `route-integration.test.ts`(가짜 요청에 `nextUrl`), 새 러너 시험 K1·K6 (경로로 구별, 본문 `{}` 두 번, 본문 인자 call 줄 0).
  - 실행: `tsc --noEmit` 0 · jest `daily-bars`(route·route-integration)·`daily-bars-collector`·`reason-dictionary-t130` 전부 통과, `isolation.test.ts` 실패 3건 = 기준과 같은 이름 3건(`jest-base-iso.log` 대조), `job-slots.test.ts` 실패 1건 = 기준과 같은 E11(m40). 러너 시험 12개 2차 실행은 `~/.node-local/t170-logs/r2/`(결과는 아래에 덧붙인다).
- [02:4x] **2차 러너 시험 12개 완료(r2, 23:15~02:4x — 모든 편집(최종 23:13) 뒤에 시작)**. 기준(`b90e2c9`, `t170-logs/base/`)과 단언 줄 비교:
  - 새 시험 `daily-bars-kr` 71/0.
  - 기준에도 있는 시험 6개 — 통과/실패 수와 실패 단언 이름이 기준과 같다: `daily-bars` 77/5, `job-run-log` 200/11, `news-split` 112/7, `overseas-universe` 26/3, `holdings-premarket` 51/2, `news-peek` 79/2(P7 블록 밖 줄·call() 해시 — 기준과 같은 2건). 달라진 ok 줄은 문구(D6 설명, U1 「기존 셋」)와 호출 건수뿐: holdings H1·H2 5135→5136, news-peek P1 5114→5115·P2(이틀) 10228→10230 — 비교 대상이 같은 러너에서 해당 블록만 뺀 것이라 새 국내 저녁 호출(하루 1건)이 양쪽에 들어간 것.
  - 1차에서 실패 0이던 5개 — `alert-ticker` 106/0, `m40-forecast`·`m40-forward` exit 0, `pmo-retry` 76/0, `stop-alert` 23/0 그대로 0.
  - 결론: 이 task 가 만든 새 러너 시험 실패 0건.
- [02:5x] 배포 버전 준비(앱 버전 정책 — 기본 마이너 증가): `package.json`·`package-lock.json` 의 `version` 0.9.0 → **0.10.0**(마지막 배포 0.9.0, 이후 배포 없음 — origin/main = `b90e2c9`). 버전 문자열을 단언하는 시험 0(`src` 에 `0.9.0` 0건). 안드로이드 앱(`stockVersionName`·`versionCode`)은 네이티브 변경이 없어 그대로.

## Reviewer

- [23:40] 실행 주체: Claude(reviewer 역할, 독립 감사). 실제 실행: ssh 서버에서 `git diff b90e2c9` 전체 읽기, 새 러너 시험 파일 읽기, bash 한 줄 재현(`local body="${3:-{}}"` → 셋째 인자 `{"market":"KR"}` 가 `{"market":"KR"}}`, 인자 없으면 `{}` — 개발자 주장 확인), `jest`(route·route-integration·daily-bars-collector·reason-dictionary-t130·strategy/records·isolation, 기준 worktree 의 job-slots·isolation 대조). 코드·시험 수정, 커밋, DB 쓰기 없음. 러너 전체 12개는 직접 재실행하지 않고(대기열에 이미 있음) 개발자가 돌린 `t170-logs/r2`·`base` 로그만 읽었다.
- [23:40] 사실 확인: ① cron-runner.sh diff 에 삭제 줄 0(추가만), `call()` 본문 불변(K6 해시 시험도 통과) ② 변경 전 러너에 셋째 인자(본문)를 넘기는 call 줄 0 — 개발자 설명이 맞고, 1차 본문 방식이었다면 매일 400 이었을 것 ③ 인증(`checkCronAuth`)은 여전히 첫 줄, 본문·쿼리 거부는 오프아워·DB·KIS 호출보다 앞(route.test 가 `getPoolMock`·수집기 0회 단언) ④ 쿼리 없는 요청은 `parseDailyBarsBody(raw)` 로 그대로 위임 → 기존 동작 동일.
- [23:41] 정렬 검토: 안정 정렬(색인 보조키), 행 없음 `''` 이 앞, 보유는 `holdings` 를 분리해 맨 앞 유지, 질의 실패 시 원래 순서 + `staleness_order`, `symbols` 직접 지정이면 `loadDefaultTargets` 자체를 부르지 않아 질의 0(테스트 확인), 나머지 2개 미만이면 질의 생략. 굶주림 회귀 시험은 정렬이 없으면 3일차에 A·B 가 다시 예산을 쓰므로 실패하는 구조다(코드 분석으로 확인, 정렬 제거 변이 실행은 읽기 전용 규칙상 하지 않음). GROUP BY 질의는 PK(market,symbol,trade_date) 앞부분 묶음의 MAX 로 하루 2회·읽기 전용 — 부담 무시 가능(실행 계획은 미확인).
- [23:42] 러너 블록 검토: 창 18:10~54(`08` 같은 값도 `[ -ge ]` 은 10진), 오프아워 라우트 창(15:40~22:20, 분 3~55) 안, 틱 시작에 읽은 `LAST_DAILY_BARS_KR` 로 하루 1회, 호출했으면 성공·실패 무관 기록, `PEEK_RAN_LABEL` 은 틱마다 비워지고 peek 블록 뒤라 미루기 성립, `set -u` 아래 `DBARS_KR_SKIP_LOGGED` 는 `${:-}` 로 안전, 18:55 이후 건너뜀 로그 하루 1줄(프로세스 재기동 시 1줄 더는 문서화된 허용), 비밀·curl 직접 호출 없음, 하트비트 최악 200초(K5 실측) < 300초. 주문·시그널 경로와 무관.
- [23:43] 시험 편집 검토(6개 러너 스크립트·isolation): 모두 새 경로 `?market=KR`·블록 `daily-bars-daily-kr`·날짜파일 선언을 비교에서 제외하거나 이름으로 지정하는 것뿐이며 기존 기대값을 낮춘 곳은 없다. 단 U1 「120 상한 잡」 기대값은 의도된 셋째(`daily-bars?market=KR`)가 추가됐다 — 새 블록이 같은 `DAILY_BARS_CURL_MAX_TIME` 을 쓰고 K1 이 단언하므로 타당. job-run-log 는 기준 비교 전용 헬퍼(`nojrl_cmp`·`nojrlmt`·`nokfout`·`dfiles`)에서만 제외하고 스풀 자기 정합(`nojrl`)은 그대로 센다. isolation 은 T-117 단일 블록 단언을 두 블록 정확 일치(호출 정확히 2줄, 블록 밖 daily-bars 참조 3줄)로 바꿨고 본문·symbols·years·maxCalls 부재 단언도 블록마다 유지.
- [23:44] 기준 대비 기존 실패: `isolation.test.ts` 3건(허용 목록 import·`@/lib/strategy` 참조·`daily_bars` 참조)은 T-170 과 기준 `jest-base-iso.log` 에서 이름·실패 내용(`daily-bars-store.ts → @/lib/strategy/universe-overseas-static`)이 동일 — T-156 유래. `job-slots.test.ts` E11 1건도 기준 worktree 에서 같은 이유(m40-forward·m40-forecast 가 표에 없음)로 실패하고 `daily-bars-kr` 는 빠짐/남음 목록에 없다(새 슬롯 정합).
- [23:45] 러너 시험 결과(확인한 것만): T-170 `daily-bars-kr.sh` 71 통과·0 실패(r2). 기준 `daily-bars.sh` 77/5, `job-run-log.sh` 200/11 실패 — 기준에서 이미 실패하는 것. T-170 쪽 `daily-bars.sh`·`job-run-log.sh`·`news-split`·`overseas-universe`·`holdings-premarket` 등 나머지 r2 결과는 이 판정 시각에 아직 없어 「기준과 단언별 일치」는 **미확인(대기)** 이다. 개발자가 적은 기준 실패 목록(daily-bars D1·D6 5건, job-run-log J1·J8·J13 …)은 기준 daily-bars 로그의 5건(D1 --max-time·D1 호출 목록·D6 블록 밖 실행 줄·D6 추가만·D6 call() 본문)과 일치함을 확인했다.
- [23:46] 발견 1 (Minor) `src/lib/profit-engine/daily-bars-collector.ts:2-3` 머리 주석이 「T-170 … 국내만 `{"market":"KR"}`」 로 남아 있다 — 정정 뒤 실제 러너는 쿼리 `?market=KR` 이다. 다음 사람이 본문 방식을 되살려 call() 결함을 다시 밟을 수 있다. 권고: 문구를 쿼리로 고친다(동작 영향 없음).
- [23:46] 발견 2 (Minor, [추측]) 정렬이 「저장된 마지막 거래일」만 보므로 계속 실패하는 종목(상장폐지·잘못된 심볼로 행이 없거나 오래된 것)은 영구히 맨 앞에 서고, `status:'failed'` 가 3개 연속이면 `consecutive_failures` 로 그날 실행이 중단된다(`daily-bars-collector.ts:209-215`). 예전 고정 순서에서는 그 종목 앞의 종목들은 먼저 처리됐으나 이제는 아무것도 처리 못 하는 정체가 가능하다. `no_data`(첫 조회부터 빈 응답)는 호출이 있으면 연속 실패를 리셋하므로 해당 없고, KIS 오류로 `failed` 가 되는 경우만 해당. 현재 근거 없음(실측 `failed=-`). 권고: 후속으로 실패 종목의 뒤로 보내기 또는 감시 지표에 반영(범위 밖).
- [23:46] 발견 3 (Minor) 정렬 키가 `adj_stale` 플래그를 보지 않아, 재수집이 필요하지만 최신 거래일을 가진 종목은 뒤로 간다. 모든 종목이 같은 날짜가 되는 정상 상태에서는 동률로 원래 순서에 따라 도달하므로 영향은 예산 부족 기간에 한정. 조치 불필요, 인지만.
- [23:47] 발견 4 (정보) 07:40 전 시장 실행도 이제 낡은 순이라 국내 종목은 저녁 성공 날 마지막으로 가고 미국 낡은 종목이 앞에 온다 — 의도와 일치. 저녁 실행이 매일 이미 최신이라 아침의 국내 호출은 `up_to_date` 로 0. 범위 밖: 감시 지표(시장별 MAX 하나)는 이번 변경으로 개선되지 않는다(설계에서 제외, 동의).
- [23:47] 판정 근거 요약: Critical 0, Major 0, Minor 3(발견 1~3), 안전장치·주문·시그널 경로 접촉 없음, 인증·fail-closed 순서 유지. 단 T-170 쪽 러너 시험 중 `daily-bars.sh`·`job-run-log.sh`·`news-split`·`overseas-universe`·`holdings-premarket` 의 r2 결과가 미완이라 CONDITIONAL_PASS — 해당 결과가 기준과 단언별로 같거나(기준 실패 그대로) 더 적으면 PASS 로 승격 가능, 새 실패가 있으면 이 판정은 FAIL 로 바뀐다. QA 집중: `scripts/cron-runner.sh` 1160-1210(새 블록), `src/lib/profit-engine/daily-bars-store.ts` `orderByStaleness`, `src/lib/profit-engine/daily-bars-request.ts` `parseDailyBarsRequest`.
- [23:48] **최종 판정: CONDITIONAL_PASS (scope: scripts/cron-runner.sh, scripts/test-cron-runner-daily-bars.sh, scripts/test-cron-runner-daily-bars-kr.sh, scripts/test-cron-runner-holdings-premarket.sh, scripts/test-cron-runner-job-run-log.sh, scripts/test-cron-runner-news-split.sh, scripts/test-cron-runner-overseas-universe.sh, src/app/api/cron/daily-bars/route.ts, src/app/api/cron/daily-bars/__tests__/route.test.ts, src/app/api/cron/daily-bars/__tests__/route-integration.test.ts, src/lib/profit-engine/__tests__/isolation.test.ts, src/lib/strategy/records/job-slots.ts, src/lib/profit-engine/daily-bars-store.ts, src/lib/profit-engine/daily-bars-collector.ts, src/lib/profit-engine/daily-bars-request.ts, src/lib/profit-engine/__tests__/daily-bars-collector.test.ts, src/lib/profit-engine/__tests__/fake-bars-db.ts, src/lib/ops/reason-dictionary.ts, src/lib/ops/__tests__/reason-dictionary-t130.test.ts)**
- [02:12] 후속 1 — 발견 1 수정 재확인: `daily-bars-collector.ts` 머리 주석 2~3행이 이제 「T-170 매일 18:10 국내만 — 쿼리 `?market=KR`, 본문 아님: 러너 call() 은 본문 인자 끝에 `}` 를 덧붙인다 — daily-bars-request.ts」 다. 주석만 바뀌었다(코드 줄 변경 없음, 파일 diff 의 그 외 부분은 이전 검토분). 해소.
- [02:12] 후속 2 — r2 대 기준(`b90e2c9`) 러너 시험을 단언 줄(ok/FAIL 문구에서 「기대/실제」 값만 뗀 것)로 diff 했다. 결과: ① daily-bars-kr 71/0 (새 시험, 기준 없음) ② daily-bars 77/5 = 기준 77/5, 실패 5건 이름 동일(D1 --max-time·D1 호출 목록·D6 블록 밖 줄·D6 추가만·D6 call() 본문), 달라진 줄은 D6 「호출 줄 1개」 ok 문구의 설명 추가뿐 ③ job-run-log 200/11 = 기준 200/11, 단언 줄 전부 동일 ④ news-split 112/7 = 기준 112/7, 전부 동일 ⑤ overseas-universe 26/3 = 기준 26/3, 실패 3건(U4 다른 잡 호출·U4 --max-time 해시·U5 call() 해시) 동일, 달라진 줄은 U1 「기존 둘 → 기존 셋」 문구뿐(의도된 셋째) ⑥ holdings-premarket 51/2 = 기준 51/2, 실패 2건(H9 call() 본문·H9 블록 밖 줄) 동일, 달라진 줄은 H1·H2 호출 건수 5135 → 5136 — 새 러너에서 holdings 를 뺀 목록 대 holdings 블록만 뺀 같은 러너 비교라 새 국내 저녁 호출 1건이 양쪽에 같이 들어간 것(환경 일치 확인, 새 실패 아님). 나머지 r2 시험(news-peek·alert-ticker·m40-forecast·m40-forward·pmo-retry·stop-alert)은 이 판정 시각에 아직 돌고 있거나 대기 중이라 **미확인**, 단 이 6개는 T-170 이 건드린 시험 파일이 아니고 러너 변경은 추가만(K6 「변경 전 모든 줄 유지」 통과)이라 위험이 낮다고 판단한다 [가능성 높음].
- [02:12] 한계: 기준에서도 실패하는 단언(D1·D6, J1·J8·J13 등, U4·U5, H9)은 새 회귀가 같은 이름으로 가려질 수 있다. 그 영역은 새 전용 시험 K6(추가만·call() 해시)·isolation 의 블록 고정 단언·`call()` byte-identical 확인(diff 에 삭제 0줄)으로 보완했다.
- [02:13] **최종 판정: CONDITIONAL_PASS (scope: scripts/cron-runner.sh, scripts/test-cron-runner-daily-bars.sh, scripts/test-cron-runner-daily-bars-kr.sh, scripts/test-cron-runner-holdings-premarket.sh, scripts/test-cron-runner-job-run-log.sh, scripts/test-cron-runner-news-split.sh, scripts/test-cron-runner-overseas-universe.sh, src/app/api/cron/daily-bars/route.ts, src/app/api/cron/daily-bars/__tests__/route.test.ts, src/app/api/cron/daily-bars/__tests__/route-integration.test.ts, src/lib/profit-engine/__tests__/isolation.test.ts, src/lib/strategy/records/job-slots.ts, src/lib/profit-engine/daily-bars-store.ts, src/lib/profit-engine/daily-bars-collector.ts, src/lib/profit-engine/daily-bars-request.ts, src/lib/profit-engine/__tests__/daily-bars-collector.test.ts, src/lib/profit-engine/__tests__/fake-bars-db.ts, src/lib/ops/reason-dictionary.ts, src/lib/ops/__tests__/reason-dictionary-t130.test.ts)**
- [02:40] 후속 3 — 남은 r2 러너 시험 6개를 로그에서 직접 확인했다(`r2/all.log` 끝에 완료 표시). news-peek 79/2 = 기준 79/2, 실패 2건(P7 peek 블록 밖 실행 줄·P7 call() 본문) 이름 동일, 달라진 줄은 P1·P2 「peek 를 뺀 모든 호출」 건수 5114→5115, 10228→10230 뿐(하루당 국내 저녁 호출 1건 — 1일·2일 시나리오와 일치, 양쪽 비교에 같이 들어가 ok). alert-ticker 106/0·SKIP 0, pmo-retry 76/0, stop-alert 23/0, m40-forecast·m40-forward 종료 0·FAIL 줄 0. 앞의 넷은 기준을 따로 돌리지 않았으나 실패 0이라 기준보다 많을 수 없다. 새 실패 없음. 이로써 r2 12개 전부가 기준과 같거나 더 적게 실패하고 새로 생긴 실패는 0건이다.
- [02:40] 남은 사정: Codex 검토는 서버 Codex 설정 오류로 실패해(지적 0건) 검토 완료가 아니다 — 이 판정은 Codex 결과에 의존하지 않는다. 기준에서도 실패하는 단언에 새 회귀가 가려질 수 있다는 한계(위 「한계」 bullet)는 K6·isolation 고정 단언·call() byte-identical 확인으로 보완한 상태 그대로이며, Minor 2·3 은 코디네이터가 알려진 위험으로 기록한다. 미확인 항목은 GROUP BY 실행 계획과 정렬 제거 변이 실행 둘뿐이다.
- [02:41] **최종 판정: PASS (scope: scripts/cron-runner.sh, scripts/test-cron-runner-daily-bars.sh, scripts/test-cron-runner-daily-bars-kr.sh, scripts/test-cron-runner-holdings-premarket.sh, scripts/test-cron-runner-job-run-log.sh, scripts/test-cron-runner-news-split.sh, scripts/test-cron-runner-overseas-universe.sh, src/app/api/cron/daily-bars/route.ts, src/app/api/cron/daily-bars/__tests__/route.test.ts, src/app/api/cron/daily-bars/__tests__/route-integration.test.ts, src/lib/profit-engine/__tests__/isolation.test.ts, src/lib/strategy/records/job-slots.ts, src/lib/profit-engine/daily-bars-store.ts, src/lib/profit-engine/daily-bars-collector.ts, src/lib/profit-engine/daily-bars-request.ts, src/lib/profit-engine/__tests__/daily-bars-collector.test.ts, src/lib/profit-engine/__tests__/fake-bars-db.ts, src/lib/ops/reason-dictionary.ts, src/lib/ops/__tests__/reason-dictionary-t130.test.ts)**

## QA

- [02:43] 실행 주체: Claude(qa 역할). 서버 worktree `~/.node-local/stockinvest-t170`(T-170)과 기준 `~/.node-local/stockinvest-t170-base`(b90e2c9)에서만 실행. 무거운 명령은 전부 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 timeout …` 로 감쌌다(다른 러너 시험이 lock 을 오래 잡아 약 1시간 대기). DB 쓰기·마이그레이션·cron 라우트 호출·pm2·실거래·git 쓰기·파일 수정 없음. 로그는 `~/.node-local/t170-logs/qa/`(repo 밖)에만 남겼다.
- [02:43] 항목 1 `npx tsc --noEmit`(node_modules/typescript 직접 실행): 종료 0. 로그 `t170-logs/qa/tsc-t170.log`. 통과.
- [02:43] 항목 2 jest 7개 파일을 두 worktree 에서 같은 명령으로 실행. T-170: 7 파일 중 5개 suite 통과(route.test·route-integration.test·daily-bars-collector.test·daily-bars-time.test·reason-dictionary-t130.test), 실패 4건(2 suite) = 277 tests 중 273 통과. 기준: 253 중 249 통과, 실패 4건. 실패 이름이 두 쪽에서 글자 단위로 같다 — isolation 3건(`import 대상은 허용 목록뿐` 의 daily-bars-store → `@/lib/strategy/universe-overseas-static` 참조, `"@/lib/strategy" 참조 0건`, `daily_bars 테이블 참조 0건`) 과 job-slots E11 1건(`m40-forward` 가 표에 없음, 기대 빈 배열). 기준 대비 새 실패 0건, 기준에서 사라진 실패 0건. 두 쪽 모두 실패 suite 는 이 2개뿐. 통과 판정 대상 로그 `t170-logs/qa/jest-t170.log`·`jest-base.log`. 단 T-170 이 추가한 테스트 24건(277−253)은 이 명령 범위에서 통과. 통과 자체는 사실. 기준 실패 2 suite 는 T-156 유래라 T-170 의 회귀 검증 능력은 그 두 단언에 대해 제한된다(Reviewer 기록과 같은 한계).
- [02:43] 항목 3 러너 정적: `bash -n scripts/cron-runner.sh` 종료 0. `git diff b90e2c9 -- scripts/cron-runner.sh` 의 `-` 줄 0. `call()` 본문 md5 를 T-170 과 기준에서 각각 뽑았더니 같다(`7d83064487fad2c28bf4e16cba97f0ca`). 셋째 인자(본문)를 넘기는 `call "…" "…" "…"` 줄 0(T-170·기준 모두). 새 호출 줄은 1193행 `call "/api/cron/daily-bars?market=KR" "daily-bars-kr"` 하나(기존 950행 07:40 호출은 그대로). 통과.
- [02:43] 항목 4 새 러너 블록(1165~1206행, `>>> daily-bars-daily-kr (T-170)` ~ `<<<`): 창 18:10~18:54, 하루 1회, 날짜파일 기록(성공·실패 무관), peek 와 같은 틱이면 미룸, 18:55 이후 건너뜀 로그 1회, 하트비트 상한 200초 — 이 블록 코드 읽기로 확인. 러너 시험 로그 `t170-logs/r2/test-cron-runner-daily-bars-kr.sh.log` 결과 **PASS=71 FAIL=0**. K1(1440틱·18:10 1회·호출 줄 정확) · K2(409·503·000 각 날짜파일 기록) · K3(18:09 미호출, 18:54 1회, 18:55 이후 0, 건너뜀 로그 1줄, 이미 돈 날 재기동 0) · K4(18:21 미루기 후 1회, 18:54 재기동 시 미루기로 18:55 넘어 그날 건너뜀) · K5(18:10 틱 최악 200초 < 300) · K6(추가분 제거 시 기준과 한 글자 동일, 변경 전 줄 순서 유지, call 본문 동일) 전부 ok. 제한: 이 로그는 23:37 실행본이다. `daily-bars-collector.ts` 는 23:38 에 바뀌었으나 이 시험은 가짜 curl 로 러너만 돌리므로 영향 없다고 판단 [가능성 높음]. 나머지 r2 로그(daily-bars·job-run-log·news-split·overseas-universe·holdings-premarket)는 이번에 재실행하지 않고 읽기만 했다(`r2/all.log`: overseas 26/3, holdings 51/2). 통과(범위: 새 블록 K 시험).
- [02:43] 항목 5 라우트 순서(`route.ts` 30~53행): `checkCronAuth` → 본문 `req.text()`·JSON 파싱(잘못된 JSON 400) → `parseDailyBarsRequest`(400) → `checkOffHoursWindow`(409) → `getPool()`·`runDailyBarsCollect`. route.test: 인증 실패 401 에서 본문·풀·수집기·시각 판정 미호출 단언 통과, 창 밖 409 에서 `getPoolMock`·`runMock` 미호출 단언 통과, 쿼리 `?market=KR` 시험과 본문 `}` 결함 재현 시험 400 + `runMock` 미호출 통과. 400 경로에서 `getPool` 미호출은 단언이 없고 코드 순서로만 확인했다. 통과.
- [02:43] 항목 6 안전 경로 비접촉: `git diff --name-only b90e2c9` 18개 파일에 `src/lib/safety/`·`src/lib/exchanges/`·주문(`orders`)·시그널 생성 경로 0. 미추적은 `agent-vault/.../T-170-*.md`·`scripts/test-cron-runner-daily-bars-kr.sh` 두 개뿐(`node_modules` 는 기준 worktree 에도 있는 공용 심볼릭 링크). 통과.
- [02:43] 항목 7 `npx next build`: **NOT_VERIFIED** — 실행하지 않았다(무거운 빌드, 선택 항목, 시간·lock 비용). 필요하면 별도 지시.
- [02:43] 보고 한계: 기준 worktree 의 jest 실패 4건은 T-170 과 같은 이름이라 허용했지만, 그 단언들로는 T-170 회귀를 잡지 못한다. 이번 실행은 `npx jest` 전체가 아니라 지정 7 파일만이다(전체 suite 회귀는 미검증). 러너 시험 12개 중 K(T-170 전용)만 로그로 확인하고 나머지 11개는 Reviewer 와 같은 로그 읽기 수준이다.
- [02:43] **QA 판정: PASS** (항목 1~6 통과, 항목 7 NOT_VERIFIED. Critical·High 결함 0건. 지정 jest 7 파일에서 기준 대비 새 실패 0건)

## Codex 검토

### [2026-11-15 02:16] C2 adversarial-review focus=error_handling — 실패(codex_exit_1: 모델 `gpt-6.1-sol` 미지원, ChatGPT 계정)
- judge 판정: [2026-11-15 02:13] codex_gate/C2 (codex_required=true, mode=adversarial-review, focus=error_handling) / 호출 차수: 1/4
- 대상: repo=/home/brownjeon/.node-local/stockinvest-t170 base=b90e2c9(task_file) snapshot=4f695f1
- 지적 0건: Codex 가 diff 를 검토하지 못했으므로 지적 없음(검토 완료 아님)
- 검토하지 못한 범위: 전체 변경(base..snapshot). 실패 원인은 서버 `~/.codex/config.toml` 의 `model = "gpt-6.1-sol"`(CLI 가 ChatGPT 계정에서 거부, HTTP 400 model_not_found). 재시도는 사용자 결정 사항
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261114T171610Z-T-170-C2/raw.txt (stderr.txt 동일 디렉터리)

## 배포 기록

## 실행 도구·절차 이력

- E1 2026-11-14 20:2x KST — 시작(origin_tool=claude, current_tool=claude, procedure=claude_standard). 범위: 조사부터 커밋까지, push·배포는 사용자 승인 후. 근거: 사용자 지시 「근본 수정부터」·범위 선택 「저녁 KR + 낡은 순」. 작업 위치: 서버 worktree `~/.node-local/stockinvest-t170`(base `b90e2c9`, 로컬 클론 `stockinvest-t157` 기반). 남은 일: judge 접수 → 구현 → Reviewer → C2 → QA → 커밋 → push 승인 요청.
- E2 2026-11-15 02:5x KST — 담당 변경 없음(claude, claude_standard). Reviewer 최종 PASS·QA PASS·Codex C2 실패(설정 오류, 지적 0) 뒤 서버 worktree 에서 커밋, status `review`·waiting `push_confirm`(push = 운영 배포, 사용자 승인 필요)·`user_decision`(Codex 재실행 여부·데모 게이트 기록). 남은 일: push 승인 → push(`<커밋>:main`) → 배포 결과 확인(18:10 첫 국내 저녁 실행) → 최종 요약.

## 최종 요약

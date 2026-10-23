---
task_id: T-076
title: 비상 전체 취소 확장 — 부분체결 주문의 잔량도 취소 요청 (T-071 WP-4)
status: todo
priority: medium
roles_involved: [leader, developer, reviewer, qa, deployer, judge, codex]
related_tasks: [T-071, T-072, T-064]
tags:
  - type/task
  - domain/orders
  - domain/safety
aliases:
  - WP-4
  - 비상취소확장
created: 2026-10-23
updated: 2026-10-23
base_ref: fa0669c9a651119e362100d1f711bd42eda9ec89
risk_level: R2
developer_model: opus
waiting: [사용자 해석 확인(아래), Stage 0 결과]
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

# T-076 — 비상 전체 취소 확장 (T-071 WP-4)

> **수익 경로 연결(제1원칙)**: 실주문이 나간 뒤 일부만 체결된 주문의 남은 수량이 비상 상황에서 살아남으면 "멈추라고 했는데 계속 걸려 있는" 손실 경로가 된다. 새 검증 관문(T-072)이 신규 매수를 막고 있어도, 이미 걸린 주문과 보유 종목 매도 주문은 이 경로의 대상이다.

## 사용자 결정 (2026-10-23) — **해석 확인 필요**
- 원문: "해외 비상 취소에 대하여 취소요청 코드 추가에 대하여 '수용'하니까 작업진행해줘".
- Leader 해석: 사용자는 **취소 요청 코드를 추가하는 작업을 승인했다**(T-071 이 "별도 승인"으로 남겨 둔 WP-4). 이전 보고에서 Leader 질문("한계를 수용할지")이 모호했다 — 사용자가 "한계만 받아들이고 구현은 하지 않는다"는 뜻이었다면 이 task 는 취소한다. **이 해석은 사용자에게 알렸고, Stage 0(읽기 전용)까지만 진행한다. 배포 전에 한 번 더 보고한다.**

## 배경 (T-071 문서 근거)
- `safety/cancel-all`(비상 전체 취소)은 `partially_filled` 주문을 대상에 넣지 않는다. 그걸 넣는 것은 **취소를 더 보내는 변경**이라 T-071 의 금지 조항에 걸려 제외됐고(WP-1b 는 `result.ok` 검사까지만), WP-4 로 이월됐다.
- 해외 `market` 주문은 브로커에서 지정가(±0.5%)로 나가므로 부분체결·미체결 잔량이 장 마감까지 살아남을 수 있다(T-071 WP-0).
- 현재 운영에서 자동으로 주문을 내는 곳: 신규 매수는 T-072 로 전부 차단, 자동 청산 엔진 꺼짐(`exit_engine_enabled=false`). 즉 노출은 **이미 걸려 있는 주문과 사용자의 수동 경로**에 한정된다 [Stage 0 이 실측].

## 범위 (안 — Stage 0 이 코드 근거로 확정)
1. 비상 전체 취소가 `partially_filled`(국내·해외) 주문의 **잔량** 취소를 요청하고, 결과(`ok`)를 검사해 성공/실패를 정직하게 기록(`cancelled` / `cancel_failed`, 체결된 수량은 보존·장부 규약 T-071 유지).
2. 자동 잔량 취소·시간 초과 취소(새 자동 주문 경로)는 **이 task 에 넣지 않는다** — 사용자가 말한 것은 '비상 취소'다. 필요하면 별도 승인.
3. 실행 권한·인증은 기존 `cancel-all` 과 동일(무인증 노출 금지), 대상 선정은 읽기 → 취소 호출 순서에서 경쟁(취소 직전 체결) 처리.

## 단계
- **Stage 0 (읽기 전용 Developer)**: `cancel-all` 호출 경로, KIS 국내/해외 취소 API 사용, `order-sync` 의 부분체결 처리와의 충돌, 취소 결과 해석, 상태 전이, 시험 가능성, 사용자에게 물을 질문.
- 이후 judge C1 → (필요 시) Codex → Developer → Reviewer → judge C2 → Codex → QA → **사용자 보고 후** 오프아워 배포.

## 판단 기록 (judge)
- 2026-10-23 07:38 intake(규칙 엔진): 1차 요약의 '화면 변경은 없다' 부정 표현이 `DM-kw-risky-cta`(delta)로 **오탐**됨(알려진 유형) → 부정 표현 없이 사실대로 재접수: risk R2, developer opus, 데모 none, next=assign.

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: delta (DM-kw-risky-cta) | 10-23 07:38 |
| - | 해당없음 | - | - | judge: none | 10-23 07:38 |

## Developer

### Stage 0 — 읽기 전용 조사 (2026-10-23 07:46, 코드·DB·설정 변경 0)

- [07:46] 읽은 것: `cancel-all/route.ts`·시험, `kis.ts` 취소 라우팅, `kis-overseas.ts` 주문·취소·미체결·체결조회, `kis-domestic.ts` 주문·취소·미체결, `kis-http.ts`(HEAD — 타 세션 미커밋 변경이 있어 `git show HEAD:`), `order-sync.ts` 판정부(402~740·1048~1185), `strategy-eval` 트리거, `middleware.ts`·`current-user.ts`, `SafetyBar.tsx`, `ActiveOrdersSection.tsx`, `orders/[id]/route.ts`, `types.ts`, SAFETY_PATHS(awk 읽기). 위 소스는 작업 트리 = HEAD(`fa0669c`) 확인(`git status` 에 없음). 운영 DB 는 읽기 전용 러너 SELECT/SHOW 만(`scratchpad/t076-s0-1~6.sql`). KIS 호출·시험 실행·쓰기 없음.

**0. 맨 위 — 불편한 사실**
- [확실] **앱이 보낸 취소가 성공한 기록이 운영에 한 건도 없다.** `trade_logs` 의 `cancelled`·`cancel_requested` 0행, `cancel_failed` 1행(#2582, 해외)뿐. 국내 취소는 시도 기록조차 없다. 즉 대상만 넓혀도 "그 취소가 실제로 먹히는지"는 해외·국내 모두 미검증이다.
- [확실] #2582 의 실패(`KIS overseas cancel HTTP 500`)는 **"요청 형식 결함"의 증거로 약하다**: 해외 market 매도 3주, 생성 22:48:20 → 취소 시도 22:48:46(+26초) → 22:54:38 `filled`. 이미 체결돼 취소할 잔량이 없었을 가능성이 있다[추측]. 코드는 비정상 응답의 **본문을 버리고 상태코드만** 남겨(`kis-overseas.ts:667`) 원인을 가릴 수 없다.
- [가능성 높음] 해외 취소 요청 형식은 여전히 의심스럽다 — 거래소 `NASD` 고정·종목코드 빈값·수량 `0`(`kis-overseas.ts:653~657`). 과거 해외 접수 17건 중 **NYS 6·AMS 2 = 8건은 거래소가 NASD 가 아니다**(운영 실측). 주문 송신은 종목별 거래소·티커를 보낸다(`:626~627`)는 점과 비대칭.
- [확실] 현재 노출 0: 미결 주문(`pending/accepted/partially_filled` + 거래소 번호) **0건**, 최근 30일 주문 0건, `partially_filled` 0행, `executions` 0행, `exit_engine_enabled=false`, `safety_kill_switch=false`, `safety_dry_run=false`. 이 변경의 가치는 "미국 자동 매매·청산이 다시 켜질 때"를 위한 준비다.
- [가능성 높음] 사용자 원문의 "해외 비상 취소 … 취소요청 코드 추가"는 T-071 v2-16 결정 3("해외 비상 취소 한계 수용 — 권고: 수용하고 WP-4 에서 **해외 취소 계약 수정**")을 가리킬 가능성이 높다. 그렇다면 사용자가 승인한 것은 **해외 취소 요청 형식 수정**이고, 이 task 범위(부분체결 잔량을 대상에 추가)와 겹치되 같지 않다 — 아래 F 의 갈림길.

**A. 현재 비상 전체 취소 동작**

| 항목 | 현재 동작 | 근거 |
|---|---|---|
| 호출자 | 화면 `SafetyBar` 의 "🚨 비상 청산" → 확인 → `POST /api/safety/cancel-all`. 다른 호출자(킬스위치 연동·cron) 없음 [확실 — grep] | `SafetyBar.tsx:94~112`, grep `cancel-all` |
| 인증 | 미들웨어 세션 쿠키만(라우트 자체 `requireUserId` 없음). 무인증 노출 아님. 계정 1·사용자 1(운영 실측) | `middleware.ts:95~137` |
| 대상 | `status IN ('pending','accepted') AND exchange_order_id IS NOT NULL` — **`partially_filled` 제외**, 시장·방향 무관 | `route.ts:26~30` |
| 취소 호출 | 행마다 `kis.cancelOrder({symbol, exchangeOrderId})` 1회, 직렬. 심볼로 국내/해외 라우팅 | `route.ts:37`, `kis.ts:159~162` |
| 결과 처리(WP-1b) | `ok:false` → 상태 불변 + `cancel_failed` / `ok:true` → CAS `UPDATE … status='cancelled' WHERE id=? AND status IN ('pending','accepted')` → 1행이면 `cancelled` 감사, 0행이면 `cancel_requested` 감사 + 결과는 실패로 집계 / 예외 → `cancel_failed` | `route.ts:38~83` |
| 응답 | `{ok:true, cancelled, failed, unconfirmed, results}` — 화면은 `cancelled`·`failed` 만 읽는다(둘 다 0 이면 "취소할 주문 없음") | `route.ts:86~89`, `SafetyBar.tsx:37~41` |
| 안전장치 | DRY_RUN·KILL_SWITCH 검사 없음 — 취소는 늘 거래소로 간다. `submitOrder` 무관(새 주문 아님). `kisFetch` 는 레이트리밋 본문일 때만 재시도(5xx 재시도 없음) | 라우트·어댑터에 검사 0, `kis-http.ts`(HEAD) 159~214 |
| 알림 | 텔레그램 등 알림 없음, 화면 결과 표시뿐 | 라우트에 notify 호출 0 |

- 덧붙임[확실]: 화면 문구 "(DRY_RUN: 실거래소 미호출)"은 DRY_RUN 전에 나간 실주문이 남아 있으면 사실이 아니다(취소는 호출된다). 버튼 이름 "비상 청산"도 보유 청산이 아니라 **주문 취소**다. 둘 다 이 task 범위 밖(화면).

**B. 부분체결의 의미와 운영 실측**
- [확실] `orders.status` ENUM = `pending,accepted,partially_filled,filled,cancelled,rejected,failed,dry_run,blocked` — `cancel_requested` 없음(추가는 DDL). `trade_logs.event` 는 `varchar(32)` 라 새 이벤트명은 DDL 없이 가능.
- [확실] order-sync 규약(T-019·T-071 WP-1): 조회 대상 `pending/accepted/partially_filled`(`order-sync.ts:402~407`). 체결목록에 있으면 `settleDecision`(`:1116~1185`) — 국내 market 은 즉시 `filled`(`:1137`, 그래서 **국내 `partially_filled` = 국내 지정가뿐**), 그 외는 신뢰 가능한 미체결 목록에 **있으면 `partially_filled`**(`:1147`), **없으면 종결**: 전량이면 `filled`, 모자라면 `filled` + `executions` 실수량 1행(상태 쓰기 **전**, `:528~537`) + `partial_fill_settled` 감사. 미체결 목록을 신뢰할 수 없으면(해외 NYS/AMS 커버리지 밖·조회 실패) 수량이 전량일 때만 `filled`, 아니면 `partially_filled` 유지 → 30분 뒤 `partial_fill_unconfirmable` 경고(`:606~622`). 상태 쓰기는 전부 CAS(`:1048~1051`).
- [확실] **order-sync 는 `trade_logs.cancel_requested` 를 읽지 않는다**(grep: 쓰는 곳은 cancel-all 하나). 잔량 취소 뒤 종결은 오직 "미체결 목록에서 사라졌는가"로 판정된다.
- [확실] 트리거: `strategy-eval` 이 5분마다 `void syncPendingOrders()`(`strategy-eval/route.ts:28`, `cron-runner.sh:193~195`) — 장 시간과 무관하게 돈다.
- 운영 실측(07:4x): 상태별 rejected 1,716 · blocked 941 · dry_run 552 · filled 17 · cancelled 2 · pending 1(#2107, 거래소 번호 없음 — 대상 밖). 거래소 접수 19건 = 전부 **매도**(filled: 국내 market 1·NAS 지정가 2·NAS market 6·NYS market 6·AMS market 2 / cancelled: 국내 지정가 1(04-28)·NAS 지정가 1(#3137, 05-26)). 마지막 접수 주문 2026-05-27, 마지막 주문 행 2026-08-12. 취소 2건은 취소 이벤트가 없어 **order-sync 추론 취소**로 보인다[가능성 높음]. `partially_filled` 는 상태가 덮어써지므로 과거 존재 여부는 알 수 없다(`partial_fill_settled`·`fill_progress` 0행).

**C. 거래소 취소 API (코드에서 읽히는 만큼만)**

| 항목 | 국내 `kis-domestic.ts:348~372` | 해외 `kis-overseas.ts:647~671` |
|---|---|---|
| TR | `TTTC0803U`(모의 `VTTC0803U`) `order-rvsecncl` | `TTTT1004U`(모의 `VTTT1004U`) `order-rvsecncl` |
| 원주문 | `ORGN_ODNO` = 거래소 번호 | 같음 |
| 수량 | `ORD_QTY:'0'` + **`QTY_ALL_ORD_YN:'Y'`(잔량 전부)** → 부분체결 주문에 보내면 잔량만 취소되는 형식[가능성 높음 — 필드 의미, 실응답 미확인] | `ORD_QTY:'0'`, 잔량전부 플래그 **없음** → "0 = 잔량 전부"인지, 잔량 수량을 넣어야 하는지 [모름] |
| 기타 | `KRX_FWDG_ORD_ORGNO:''`(원주문 응답에는 값이 있다, 예 `91256` — 빈값 허용 여부 [모름]), `ORD_DVSN:'00'` 고정 | `OVRS_EXCG_CD:'NASD'` 고정, `PDNO:''` (필수 여부 [모름]), `OVRS_ORD_UNPR:'0'` |
| 실패 해석 | `!res.ok` → `KIS cancel HTTP n`, `rt_cd≠0` → `msg1` (예외 아님 `{ok:false}`) | 같음, 본문 버림(#2582 원인 불명의 이유) |
| 성공 의미 | `rt_cd='0'` = **취소 요청 접수**. 확정 시점·지연은 코드로 알 수 없다 [모름] | 같음 |
| 잔량 수량을 아는가 | 미체결 조회가 `rmn_qty` 를 받지만 반환에서 버린다(`:536`, 반환 `{orderId,symbol}`) | 미체결 조회가 `nccs_qty` 로 거르기만 하고 버린다(`:778~785`), 커버리지 NAS 한 곳(`:697~699`) |

**D. 경쟁·정합성**

| 시나리오 | 지금(WP-1b) | 대상에 `partially_filled` 를 넣고 상태를 직접 쓰면 |
|---|---|---|
| ① 조회~취소 사이 **전량 체결** | KIS 취소 실패(잔량 없음 추정) → `cancel_failed`, 상태 불변 → order-sync 가 `filled`. 정직하지만 화면엔 "일부 실패" | 같음 |
| ② 조회~CAS 사이 **일부 체결**, order-sync 아직 모름(`accepted`) | 브로커 잔량 취소 성공 → CAS 가 `accepted` 와 일치 → **`cancelled` 로 종결 → 체결분이 장부에서 영구 소실**(order-sync 대상 밖). 기존 결함이 이미 있다 [확실 — 코드 논리] | 같음 |
| ③ `partially_filled` 주문 잔량 취소 성공 | 대상 밖 | 상태를 `cancelled` 로 쓰면 ②와 같은 소실이 **확정적으로** 일어난다 → **상태를 쓰면 안 된다** |
| ④ 취소 접수 후 확정 지연 중 추가 체결 | `accepted` 행은 이미 `cancelled` 라 추가 체결 소실 | 상태를 안 쓰면 order-sync 가 다음 회차에 최종 수량으로 종결 — 정합 |
| ⑤ 같은 버튼 두 번 | 이미 `cancelled` 된 행은 대상 밖 | `partially_filled` 는 상태가 안 바뀌므로 다시 대상 → 두 번째 취소는 KIS 거절 추정 → `cancel_failed` 소음(무해) |
| ⑥ cancel-all 과 order-sync 동시 실행 | 둘 다 CAS 라 덮어쓰기 없음 | 잔량 경로는 `orders` 를 쓰지 않으므로 충돌 면이 없다 |

- [가능성 높음] 해외 market(마케터블 지정가)은 수 초 안에 체결되고 order-sync 는 5분 주기라 **DB 의 `accepted` 는 대개 낡은 값**이다(#2582: 26초 뒤 취소 시도 시점에 이미 체결 추정). 그래서 ②는 해외 market 에서 드물지 않다.
- [확실] 잔량 취소 뒤 order-sync 의 최종 처리: 국내·해외 NAS → 잔량이 목록에서 사라진 회차에 `filled` + `executions`(실수량) + `partial_fill_settled` + 매수/매도 알림(T-019 규약 그대로, 코드 변경 불필요). 해외 **NYS/AMS → `partially_filled` 에 영구히 남고 30분 뒤부터 6시간마다 경고**(기존 한계 — 잔량 만료 때도 같다).

**E. 위험 평가**
- [확실] 이 변경은 **새 주문을 만들지 않는다** — `createOrder`/`submitOrder` 경로 0, 늘어나는 것은 `partially_filled` 행 수만큼의 취소 요청뿐.
- [확실] 손절 매도가 부분체결 중일 때 잔량을 취소하면 **남은 보유분은 보호 주문 없이 열린 채** 남는다. 다만 지금도 `accepted` 손절 매도(0주 체결)는 같은 버튼에 취소된다 — 매도 포함은 현행 의미("모든 진행 주문 취소")와 일관된다. 의도인지는 사용자 결정(F-Q3).
- [가능성 높음] 실패 시 부분 상태: 행 단위 직렬이라 중간 실패는 그 행만 `cancel_failed`, 나머지는 계속. 예외로 라우트가 중간에 죽으면 앞 행만 처리 — 재실행은 안전(취소는 멱등에 가깝고, 상태를 쓰지 않는 잔량 경로는 재대상).
- [가능성 높음] 해외 취소 형식이 실제로 틀렸다면 확장의 효과는 해외에서 **`cancel_failed` 기록이 늘어날 뿐**이다(정직한 실패, 손해는 아님). 국내도 `KRX_FWDG_ORD_ORGNO` 빈값 때문에 실패할 수 있다 [추측].

**F. 최소 설계안과 갈림길**
- **안 A (최소, 범위 그대로)** — 파일 `src/app/api/safety/cancel-all/route.ts` 1개 + 시험.
  - 대상: `status IN ('pending','accepted','partially_filled')`, SELECT 에 `status` 추가.
  - `partially_filled` 행: `cancelOrder` 1회 → `ok:true` 면 **상태를 쓰지 않고** `cancel_requested`(`{reason:'emergency_cancel_all', prevStatus:'partially_filled', scope:'residual'}`) 감사 → 집계는 `cancelled` 에 넣고(안 넣으면 화면이 "취소할 주문 없음"으로 오표시) 응답에 `residualRequested` 를 따로 둔다(화면 수정 없음). `ok:false`·예외 → `cancel_failed`, 상태 불변.
  - `pending/accepted` 경로는 WP-1b 그대로. order-sync·어댑터·DDL·새 상태 **변경 없음**.
  - 상태 전이: `partially_filled` →(잔량 취소 접수, 상태 그대로)→ order-sync 가 목록 부재 확인 → `filled` + `executions`(실수량). NYS/AMS 는 `partially_filled` 유지 + 경고.
  - 규모: 라우트 +25줄, 시험 +80~120줄.
- **안 B (A + 기존 경쟁 ② 수정)**: 커버리지 안 시장(국내·해외 NAS)의 `pending/accepted` 도 `cancelled` 를 직접 쓰지 않고 `cancel_requested` 만 남겨 order-sync 가 종결. 체결분 소실이 사라진다. 대가: 화면·일일 합산에 최대 5분(+유예 120초, 해외 market 은 2회차 확인) `accepted` 로 남음(보수 방향). NYS/AMS 는 현행 CAS `cancelled` 유지. WP-1b 시험 기대값 일부 변경.
- **안 C (해외 취소 요청 형식 수정 — 사용자 원문이 가리킬 가능성이 높은 것)**: `kis-overseas.ts` `cancelOrder` 가 종목의 거래소(`toOvrsExcgCd(parseOverseas(symbol).excd)`)·티커(`PDNO`)를 보내고, 비정상 응답 본문 앞부분을 오류에 담는다. **수량(`ORD_QTY`) 의미는 실응답 없이는 정할 수 없다** → KIS 모의(`VTTT1004U`) 또는 실계좌 카나리 1회 확인이 선행돼야 한다(KIS 호출 = 사용자 승인).
- **안 D (취소 전 생존·잔량 확인)**: 미체결 조회 1회로 `rmn_qty`/`nccs_qty` 를 받아 이미 끝난 주문엔 취소를 보내지 않고, 해외는 잔량 수량을 실어 보낸다. #2582 유형 소음 제거·C 의 수량 문제 해소. 어댑터 반환 필드 확장이 필요하고 NYS/AMS 커버리지 한계는 그대로.
- **안 0 = "(a) 한계 수용만"**: 코드 0. 현재 노출 0 이라 **지금은** 타당하다. 단 청산 엔진·T-062 카드 실행·sell-proposal 실행을 켜기 **전에** C(+A)를 끝낸다는 조건이 붙어야 한다.
- 개발자 권고 [가능성 높음]: A 단독은 효과가 작다(취소 성공 실적 0, 해외 형식 의심). **C 의 실응답 확인 → A + C 를 한 배포**가 가장 작은 "실제로 작동하는" 단위다. B 는 같은 파일·같은 원리라 함께 넣을 가치가 크지만 범위 확대라 결정 항목. KIS 확인이 승인되지 않으면 A 만 하고 "해외 취소 미검증"을 그대로 고지.
- **사용자에게 물을 것**
  1. 원문 해석: (a) 한계 수용만 / (b) 해외 취소 요청 형식 수정(안 C) / (c) 부분체결 잔량을 비상 취소 대상에 추가(안 A) / (b)+(c). 권고: (b)+(c).
  2. 국내 포함 여부 — 권고: 포함(국내 취소는 이미 '잔량 전부' 형식, 시장 분기를 새로 만드는 쪽이 더 복잡).
  3. 매도 잔량 포함 여부 — 권고: 포함(현행 `accepted` 매도도 취소 대상, 의미 일관). 손절 잔량 취소 = 미보호 보유가 남는다는 점 고지.
  4. KIS 실응답 확인 1회 승인(모의 또는 실계좌 체결 불가 지정가 1주 → 취소) — 권고: 승인, 오프아워 아닌 미국 정규장 필요.
  5. 자동 잔량 취소·시간 초과 취소 제외 확인 — 권고: 제외 유지.
  6. 안 B 포함 여부 — 권고: 포함.
  7. 개별 `DELETE /api/orders/:id` 맞춤(T-071 V-07: `partially_filled` 도 API 로 취소 가능하고 성공 시 무조건 `cancelled` → 체결분 소실, `orders/[id]/route.ts:49·59`) — 권고: 같은 task 에 포함(같은 규칙, 작은 변경).
  8. DRY_RUN/KILL 켜짐 상태에서도 비상 취소가 거래소를 부르는 현행 유지 — 권고: 유지(위험을 줄이는 방향), 화면 문구 정정은 별도.

**G. 시험 계획·파일·SAFETY_PATHS·변이 후보**
- 변경 파일(안별): A·B `src/app/api/safety/cancel-all/route.ts` + `__tests__/route.test.ts` / C·D `src/lib/exchanges/kis-overseas.ts`(D 는 `kis-domestic.ts`·`kis.ts` 도) + `src/lib/exchanges/__tests__/` 새 시험 / Q7 `src/app/api/orders/[id]/route.ts` + 새 시험 / 연동 고정 시험 `src/lib/safety/__tests__/`(order-sync 코드 변경 없음).
- SAFETY_PATHS(awk 읽기) [확실]: `^src/app/api/safety/` · `^src/lib/exchanges/` · `^src/app/api/orders/` · `^src/lib/safety/` 모두 포함 → 커밋은 Reviewer 판정 scope 필수. `src/components/SafetyBar.tsx` 는 목록 밖(이번에 수정 안 함).
- 라우트 시험(mock): ① 대상 SQL 에 `partially_filled` 포함 — **기존 시험 '대상 쿼리 불변 — partially_filled 는 대상이 아니다'(`route.test.ts:97~108`)는 사양 반전이라 고쳐야 한다**(약화가 아니라 의도된 반전임을 Reviewer 가 확인) ② `partially_filled` + ok → `UPDATE orders` 0건 · `cancel_requested`(prevStatus) 1건 · `cancelled` 집계 +1 · `residualRequested` 1 ③ `partially_filled` + ok:false → 상태 불변 · `cancel_failed` ④ 예외 → `cancel_failed` ⑤ 혼합(accepted 성공·partially_filled 성공·실패) 집계 ⑥ 행마다 `cancelOrder` 정확히 1회 ⑦ accepted 경로 CAS SQL 이 여전히 `IN ('pending', 'accepted')`(partially_filled 미포함) ⑧ (B 채택 시) NAS·국내 accepted 는 UPDATE 0 + `cancel_requested`, NYS/AMS accepted 는 CAS `cancelled`.
- 연동 고정 시험(order-sync, mock): 잔량 취소 뒤 국면 = `partially_filled`, 체결 4/10, 신뢰 가능한 미체결 목록에 없음, 유예 경과 → `executions` 4 → `filled` → `partial_fill_settled` / 해외 NYS 같은 입력 → `partially_filled` 유지(종결 금지).
- (C) 해외 취소 본문: NAS→`NASD`, NYS→`NYSE`, AMS→`AMEX`, `PDNO`=티커, 비정상 응답 오류에 본문 일부, `priority:'critical'` 유지(`kis-order-priority.test.ts` 무회귀).
- 검증 환경: 작업 트리 jest 는 타 세션 변경으로 일부 스위트가 안 뜬다(T-071 V-06) → T-071 처럼 `git archive HEAD` + T-076 파일만 덮은 격리 사본에서 tsc·전체 jest·eslint.
- 변이 후보: M1 대상 SQL 에서 `partially_filled` 제거 · M2 잔량 성공에 `cancelled` UPDATE · M3 accepted CAS 를 `IN (…,'partially_filled')` 로 확장 · M4 `cancel_requested` 감사 누락 · M5 잔량 성공을 `failed` 로 집계 · M6 잔량 성공을 어느 집계에도 안 넣음(→ 화면 "취소할 주문 없음") · M7 ok:false 에도 `cancel_requested` · M8 행당 취소 2회 · (C) M9 거래소 `NASD` 고정 복귀 · M10 `PDNO` 빈값 복귀.
- 안전장치 self-check 영향: 새 주문 0, 한도·심볼 검사 무관(취소), DRY_RUN·KILL 은 현행처럼 취소를 막지 않음(결정 8), 결과는 `trade_logs` 에 전부 남음.

**H. 확인 못 한 것 (실 KIS 응답 없이는 닫히지 않음)**
- 해외 취소 `ORD_QTY='0'`·`PDNO=''` 허용 여부와 의미, #2582 `HTTP 500` 의 실제 원인, 국내 `KRX_FWDG_ORD_ORGNO` 빈값 허용 여부, 취소 접수→확정 지연, 장외 시간 취소 요청 처리, NASD 미체결 조회가 NYSE/AMEX 주문도 돌려주는지, 과거 `partially_filled` 발생 이력(상태가 덮어써져 DB 로는 불명).

---
task_id: T-058
title: 현금이 모자라는 매수는 시그널을 만들지도, 텔레그램을 보내지도 않는다 — 생성 시점 실시간 잔고 점검 (T-044 흡수)
status: doing
priority: high
risk_level: R2
base_ref: f00758b0a2c308f9e3978feb0247d33baef06d55
roles_involved: [leader, developer, reviewer, qa, deployer]
related_tasks: [T-044, T-042, T-051, T-053, T-056, T-057]
tags:
  - type/task
  - domain/signals
  - domain/notify
  - domain/safety
aliases:
  - 시그널 생성 현금 게이트
  - signal cash gate
created: 2026-10-21
updated: 2026-10-21
demo_gate:
  required: true
  level: "delta"
  status: "waived"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: "JV-ui_change"
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: "user"
  waived_at: "2026-10-21T12:12:52+09:00"
  waiver_quote: "데모 생략"
  active: true
---

# T-058 — 시그널 생성 시점 현금 게이트

> 🔁 **인수인계(2026-10-21 10:50)**: 이어받는 세션은 [[HANDOFF-T-058-2026-10-21]] 을 먼저 읽는다. 설계·접수 완료, 구현 미착수, 데모 게이트 사용자 "데모 생략" 대기. 병행 세션 T-059(미국 종목 수집기)와 겹치는 파일 목록이 거기 있다.

## 사용자 요구 (2026-10-21 원문)

> 종목에 대한 매도/매수에 대한 시그널을 생성할때에 지금 현재 잔고를 체크해서 매수시그널에 대해서 잔고가 부족하면 시그널 및 텔레그램으로 메시지를 발송하지 않도록 해줘.

## 사용자 결정 (2026-10-21, Leader 질문 2건에 대한 답)

1. **해외(미국) 매수에도 적용한다 — USD 예수금 기준.** (Leader 권고는 "국내만"이었다. 사용자가 위험 고지를 받고도 선택했다. 같은 반론을 반복하지 않고 진행하되, 아래 "위험"과 "되돌리기"를 설계에 넣는다.)
2. **T-044 를 이 task 에 흡수해 한 번에 배포한다.** (T-044 는 작업 트리에 미커밋으로 남아 있고 Reviewer PASS·Codex C2 까지 끝난 상태이며 사용자 결정 1건을 기다리고 있었다. 이 task 의 "시그널을 만들지 않는다" 방식이 그 Codex medium 지적을 해소한다 — 행이 없으면 TTL 중복 방지가 재알림을 막지 않는다.)

3. **(10-21 오후, 구현 후 추가 결정) 해외 지정가 반올림은 정수 달러로 유지한다 — 현행 `kis-overseas.ts roundToTickOverseas`($1 이상은 정수 달러, $1 미만은 소수 넷째 자리).** Developer 가 범위 밖 발견으로 올린 항목(미국 호가 $0.01 과 어긋나 지정가가 주당 최대 약 $0.5 틀어지고, 매수 지정가가 시세보다 낮아져 미체결이 날 수 있음)에 대해 사용자가 "달러단위로 반올림해서 맞춰줘" 라고 했고, 모호해서 되묻자 "정수 달러 유지 (현행)" 를 골랐다. → **의도된 동작**이다. 주문 어댑터·게이트 코드 변경 없음(게이트는 이미 같은 반올림으로 USD 단가를 만들고 주문 단가 대조 시험이 실제 송신 본문과 9개 가격에서 고정한다). 고치기 시작하지 말 것 — 센트 단위로 바꾸려면 사용자가 다시 지시해야 하고, 어댑터·게이트·대조 시험을 함께 바꾸는 SAFETY 경로 변경이다. 후속 후보 목록(R-2·R-3·R-6, 게이트 버퍼)에서 이 항목은 빠진다.

## 왜 (사실, 2026-10-21 코드 읽기 — 실행·DB 조회 없음)

- `createSignal`(`src/lib/signals/service.ts:320`)은 **잔고를 보지 않고** 시그널 행을 INSERT 한다. 알림은 그 뒤 `notifyApprovalRequest`(`approval-notify.ts`)가 보낸다.
- 알림 쪽 현금 판정 `assessExecutability`(`approval-context.ts`)는 **최대 3시간 묵은 스냅샷**(`:38`)의 현금이 **금액×0.5 보다 작을 때만**(`:36,164`) 부족으로 본다. 알림 생략에만 쓰이고 시그널 생성은 막지 않는다.
- 운영(HEAD)에는 아직 "📭 실행 불가 매수 시그널 요약"이 남아 있다. 그 제거(T-044)는 미커밋이다.
- 실시간 현금 점검은 진입 감시(T-051, `entry-cash-precheck.ts`)에만 있고 **국내 전용**이다. 주문 단계(`dry-run.ts`)에는 내부 잔고 검사가 없고 KIS 가 거부한다.
- 해외 USD 예수금 읽기는 T-056 으로 신설됐다(`getBalancesDetailed().cash.USD` — `known` / `unknown` / `not_queried`). 10-20 밤 장중 실측에서 USD 잔액이 0 이었다.

## 관련 과거 이력 요약

- [[T-044-drop-unexecutable-summary-alert]] — 알림 생략 완료·감사 PASS·미커밋. Codex medium(중복 방지 때문에 현금이 생겨도 재알림 없음), low(`notify_skip_unexecutable` 를 `!== false` 로 읽어 비정상 값이 생략을 켬). Reviewer Low-1(`approval-context.ts` 주석 낡음)·Low-2(문서에 생략 로그 위치 없음).
- [[T-051-entry-cash-precheck]] — 실시간 국내 현금 `readDomesticAvailableCashKRW`(TTL 30초·공유 마감 8초·던지지 않음), 판정 `judgeEntryCash`(`unknown` 이면 기존 동작). **"모르면 막지 않는다"** 원칙. 이 task 는 이 모듈을 재사용·확장한다.
- [[T-053-card-affordability-filter]] — post-market 카드는 1주 가격>카드 예산 후보를 이미 제외한다(직접 INSERT 경로라 이 task 의 대상 아님).
- [[T-056-usd-cash-snapshot]] — USD 예수금 읽기. `unknown` 을 0 으로 읽지 않는다.
- [[T-057-us-stock-analysis-data-collection]] — 주력이 미국주식으로 전환됨. 해외 국내 고정 6곳 제거(P2)와 겹칠 수 있다.
- 사용한 교훈 ID: 없음 (`/이슈기록 관련 signals`·`알림` → 승인된 교훈 없음).

## 요구 (Leader 정리)

1. **대상**: 매수(`side==='buy'`) 시그널 생성 요청. 매도는 현금 점검 대상이 아니다(보유 수량이 기준이고 이 task 범위 밖).
2. **위치**: `createSignal` 안, **심볼 블랙리스트 검사 뒤 · 중복 검사/INSERT 앞.** 승인 대기 경로(`awaiting_approval`·`detected`)와 자동 제출 경로(`auto_submit`) 모두 같은 지점에서 막는다.
3. **판정**: 실시간 KIS 현금으로 "1주 이상 비용"을 본다.
   - 필요 금액 = 수량 × (호가 추격 반영 지정가) × (1 + 0.002) — T-051 `estimateEntryCostKRW`·`judgeEntryCash` 재사용. 수량·가격은 `buildOrderRequest`(사이징)와 **같은 값**을 쓴다(다르면 막는 기준과 실제 주문이 어긋난다).
   - 현금이 필요 금액보다 **엄격히 적을 때만** `insufficient`.
   - **국내**: 국내 KRW 예수금(`prvs_rcdl_excc_amt`, T-051 과 동일). **해외**: `cash.USD` 가 `known` 일 때만, 시그널 비용과 같은 통화로 비교한다(아래 "해외 단위" 참조).
4. **모르면 막지 않는다** (T-051·T-044 와 같은 원칙): 조회 실패·상한(8초) 초과·`unknown`/`not_queried`·값 이상·수량/가격 미확정·시장가(가격 모름)·환율 미확정 → 기존 동작(시그널 생성). 캐시는 T-051 과 같은 TTL 30초·공유 마감.
5. **막힐 때의 동작**:
   - 시그널 행을 만들지 않는다. RAG 색인·텔레그램·슬랙 알림도 없다.
   - 반환값은 `{ ok:false, signalId:0, autoSubmitted:false, errorCode:'insufficient_cash', error:… }`. **모든 호출자**(`engine.ts`·`analyst/run`·`research-cycle-*`·`scenario-builder`·`POST /api/signals`·`trade-report` 계열 중 실제 `createSignal` 호출자)가 이 코드를 "오류·경보"가 아니라 정상 건너뜀으로 다루는지 전수 확인한다. `duplicate_active_signal` 처리 방식이 선례다.
   - **조용히 사라지지 않게** 흔적을 남긴다: 서버 로그 1줄(`[signal-cash-gate] …`, 금액·잔고 수치 없음 — 시그널 번호가 없으니 심볼·방향·시장·사유 코드만) + 기존 퍼널/`trade_logs` 관측 방식에 건너뜀 집계 1줄. **룰은 매 틱 재발화**하므로 (심볼, 방향) 단위로 로그·기록을 스로틀한다(권장: 1시간 1회). 알림 채널(텔레그램·슬랙)로는 절대 보내지 않는다.
6. **끄는 방법(재배포 없이)**: `system_config` 키 두 개 — `signal_cash_gate_domestic_enabled`, `signal_cash_gate_overseas_enabled`. **키 없음 = 켜짐**, `true` = 켜짐, **그 밖의 모든 값(`false`·문자열·0·null·파싱 불가) = 꺼짐(막지 않음)** — "모르면 막지 않는다"와 방향을 맞춘다. 매 호출 DB 를 읽지 않도록 짧은 캐시를 둔다(기존 `getSignalNotifyFlags` 선례).
7. **T-044 흡수** (미커밋 변경 4파일을 이 task 의 일부로 함께 검토·커밋):
   `src/lib/signals/approval-notify.ts` · `src/lib/signals/__tests__/approval-notify.test.ts` · `src/lib/signals/service.ts`(주석 1줄 — 이 task 가 같은 파일을 수정하므로 겹침 주의) · `docs/telegram-approval.md`.
   - 알림 쪽 판정(`assessExecutability`: 스냅샷 현금·일일 한도·1회 한도)은 **그대로 남긴다.** 시그널 생성 시점 게이트는 "실시간 현금", 알림 쪽은 "한도"까지 포함하는 다른 층이다. 현금이 `unknown` 이라 통과한 시그널도 한도 초과면 알림이 생략된다(이미 사용자 승인된 T-044 동작).
   - Codex low 반영: `notify_skip_unexecutable` 는 **키 없음 또는 정확히 `true` 일 때만** 생략, 그 밖의 값은 "불확실 → 보낸다". 테스트는 실제 `defaultDeps` 로 `false`/`"false"`/`0`/`null`/파싱 실패를 고정한다.
   - Reviewer Low-1(`approval-context.ts` 머리 주석의 "요약" 서술)·Low-2(문서에 생략 로그 위치 `pm2-out.log` + grep 문구) 반영. `approval-context.ts` 는 SAFETY 경로이므로 **주석만** 고치고 Reviewer scope 에 넣는다.
   - Codex medium(재알림 없음)은 이 task 로 현금 부족 사유에 한해 해소된다 — 그러나 **한도(daily/order) 사유로 생략된 시그널의 TTL 중복 방지 문제는 남는다.** 문서에 한계로 적고 사용자 결정 사항으로 올린다(이 task 에서 고치지 않는다).

## 해외 단위 — Developer 가 코드·읽기 전용 증거로 먼저 확정할 것

`sizeOrderQuantity`(`service.ts:197-199`) 주석: "해외주식: input.price 가 USD 라면 amountKRW 를 USD 로 환산해야 하지만 여기서는 동기 함수라 KRW 가정 (기존 동작)". 즉 해외 시그널의 `price`·`quantity`·`amountKRW` 의 통화 단위가 코드 주석만으로는 확정되지 않는다.

- 확정 방법: ① 해외 시그널을 만드는 호출자(`engine.ts` 해외 분기, `research-cycle-overseas`)가 `price` 에 무엇을 넣는지 읽는다 ② 어댑터 `kis-overseas.ts createOrder` 가 가격·수량을 어떻게 보내는지 읽는다 ③ 운영 DB `signals` 의 최근 해외 행 `price`·`quantity`·`amount_krw` 를 **읽기 전용 SELECT** 로 몇 건 대조한다(쓰기·KIS 호출 금지).
- 단위가 확정되면 `필요 비용(원) ÷ 환율 = 필요 USD` 또는 `USD 예수금 × 환율 = 현금(원)` 중 한쪽으로 통일해 비교한다. 환율은 `fx` 모듈의 기존 경로를 쓰고, **환율을 못 구하면 `unknown`.**
- **확정하지 못하면 해외는 `unknown`(막지 않음)으로 출시하고 task 에 사유를 적은 뒤 Leader 에게 보고한다.** 사용자가 해외 적용을 선택했으므로 이는 "조용한 미적용"이 아니라 보고 대상이다.

## 알려진 위험 (사용자 고지 완료)

- **USD 예수금이 0 이면 해외 매수 시그널이 전부 생성되지 않는다.** KIS 가 원화 통합증거금으로 해외 매수를 받는 계좌라면 실제로는 살 수 있는 시그널까지 막힌다 — 이 계좌의 통합증거금 여부는 **실측된 적 없다.** 10-20 밤 장중 USD 잔액은 0 이었다. 주력이 미국주식으로 바뀐 직후라 영향이 크다.
  - 완화: 해외 건너뜀 집계를 따로 센다(국내와 구분). 해외 스위치만 끌 수 있다(요구 6). 배포 후 첫 미국장(KST 22:30 이후)에서 건너뜀 건수를 사용자에게 보고한다.
- 현금이 입금되기 전에 발화한 시그널은 사라진다(승인 대기 목록·분석 화면·RAG 에 남지 않음). 입금 후 같은 조건이 다시 발화하면 새로 만들어진다.
- 실시간 잔고 조회로 KIS 호출이 늘어난다 — 30초 캐시·단일 조회 공유로 억제한다. `kis_rate_limit_per_sec` 5 와 `EGW00201` 이력이 있다.
- 미체결 매수 주문이 묶은 현금은 조회 값에서 빠지지 않는다 → "충분"으로 보아 생성된다(막는 쪽으로 틀리지 않음, T-051 과 동일).
- **(Reviewer R-1, Medium — 구현 후 추가)** 해외 가용 USD 는 구매력이 아니라 **예수금**(`frcr_dncl_amt_2`)이다. 미결제·재사용 가능 매도대금이 빠져 있을 수 있다(T-056 이력서가 두 값을 구분하나 미결제 포함 여부는 미관측). 주력이 미국주식이라 "매도 후 같은 날 재매수" 순환이 생기면 KIS 가 받아 줄 매수를 게이트가 "현금 부족"으로 막을 수 있다 — 막는 쪽 오차이며 금전 손실 경로는 아니다. 코드 보정은 하지 않는다(추측 위에 보정을 넣으면 반대 방향 오류). **첫 해외 매도 직후 `frcr_dncl_amt_2` 와 `ustl_sll_amt_smtl` 을 대조해 가용액 정의를 확정한다**(T-056 단계 4). 끄는 키: `signal_cash_gate_overseas_enabled`.
- **(실측 10-21 14:02 — 사용자 승인 KIS 읽기 전용 GET 1회, 금액 원문은 기록하지 않음)** `TTTS3007R` 해외 매수가능금액 조회(NAS:INTC 가정 단가, 정상 `rt_cd=0`): ① 외화 주문가능금액이 07:18 이후 스냅샷의 USD 예수금과 **같은 값** — 05:19 스냅샷(#5400)의 USD 0 은 직후 값이었고 #5401(07:18 KST)부터 USD 가 0 이 아니다(원인은 미확인). 해외 게이트의 가용액(예수금)과 KIS 의 주문가능외화금액이 현재 일치한다. ② 환전 후 주문가능금액·통합 외화주문가능 필드 0, 원화 예수금(스냅샷 8만원대)을 합쳐도 최대 주문가능수량이 늘지 않음 → **원화 통합증거금으로는 해외 매수가 안 되는 계좌로 보인다 [가능성 높음]** → 사용자가 걸어 둔 "원화로 해외 매수 가능이면 재질문" 조건에 해당하지 않음, 양쪽 켜고 배포 결정 유지. ③ 매도재사용가능금액 0 — 지금은 미결제 매도대금이 없어 R-1(예수금≠구매력)은 현재 영향 없음, 첫 해외 매도 직후 재확인 필요는 유지. ④ 주문가능금액은 예수금의 약 99.5%(수수료 예비분으로 보임 [추측]) → 게이트 버퍼 0.2% 보다 커서 경계 구간(필요액이 예수금의 99.5~99.8%)에서는 게이트가 "충분"으로 통과시키고 KIS 가 거부할 수 있다 — 막지 않는 방향 오차(안전 쪽), 코드 변경 없음, 버퍼 상향은 후속 후보. ⑤ 결과: 배포하면 최근 해외 룰 시그널(주문 금액 100만원대)은 예수금(50만원 안팎)을 넘어 **대부분 막힌다** — 의도한 동작이다.
- 운영 DB 에 게이트 스위치 키 2개가 **없다**(읽기 전용 SELECT) → 키 없음 = 켜짐이라 **배포하는 순간 국내·해외 게이트가 모두 켜진다.**

## 변경 범위 (예상)

- 신규: `src/lib/signals/signal-cash-gate.ts`(판정·스로틀·플래그) + 테스트
- 수정: `src/lib/signals/service.ts`(게이트 호출·반환 코드·`CreateSignalResult.errorCode` 유니온), `src/lib/signals/entry-cash-precheck.ts`(해외 현금 읽기 확장 시 — 국내 동작은 불변, 기존 테스트 유지), 호출자 중 `errorCode` 분기가 필요한 곳
- T-044 흡수: 위 4파일
- 문서: `docs/telegram-approval.md`(스위치 표), 게이트 스위치 설명 위치(Developer 가 정함)
- **건드리지 않는다**: `submitOrder`·`order-limits`·`kill-switch`·`dry-run`(주문·안전장치 경로), `assessExecutability` 판정 로직·`CASH_SHORTFALL_RATIO`, post-market 엔진·`custom/confirm`(직접 INSERT 경로 — 사용자 확정 시나리오와 다음 날 카드는 "오늘 잔고"가 기준이 아니다), entry-watcher T-051 점검, 승인·텔레그램 폴러.

## 시험 (필수)

- 게이트 단위: sufficient / insufficient(경계: 필요 금액과 같으면 통과, 1원 모자라면 막힘) / unknown(조회 실패·8초 초과·`unknown`·`not_queried`·환율 없음·시장가·수량 0·값 이상) — 국내·해외 각각.
- `createSignal` 통합(모킹): insufficient → INSERT 0회·알림 0회·RAG 0회·반환 `insufficient_cash`; unknown → 기존과 동일하게 생성; 매도는 게이트 호출 0회; 스위치 키 없음/`true`/`false`/`"false"`/0/null; 캐시·동시 호출 공유(조회 1회).
- 호출자: 각 호출자가 `insufficient_cash` 를 오류·경보로 취급하지 않는다(경보 0회, 응답 코드/카운터 확인).
- 스로틀: 같은 (심볼, 방향) 반복 발화 시 로그·집계는 1시간 1회, 건너뜀 자체는 매번.
- 알림 경로: 건너뜀일 때 텔레그램·슬랙 호출 0회(실제 `defaultDeps` 발송 함수 기준).
- T-044 흡수 시험: 기존 34건 유지 + `notify_skip_unexecutable` 비정상 값 → 발송.
- `npm run typecheck` · 관련 jest · 전체 jest · 변이 시험(Reviewer). 전체 jest 는 **타 세션 미커밋 변경 때문에 신뢰 불가할 수 있다** — `git archive HEAD` 격리 사본에 이 task 파일만 덮어써서 돌린다(T-046 선례).

## 역할별 지시사항

- **developer (Opus)**: 위 요구·범위대로 구현. 작업 트리에 타 세션 미커밋 변경(`.codex/`·`AGENTS.md`·`CLAUDE.md`·`notify/slack.ts`·`notify/telegram*.ts`·`news-fetch`·`ai-filter`·`market-context-client`·T-042/T-046/T-049 문서 등)이 섞여 있다 — **건드리지 않는다.** `docs/telegram-approval.md` 는 타 세션 변경이 섞였던 이력이 있으므로 수정 전 `git diff` 로 현재 구간을 확인하고 안전하게(임시 파일→교체) 쓴다. 운영 경로(`/home/brownjeon/apps/stockinvest`)·`npm run build`(NFS `.next`)·DB 쓰기·KIS 실계좌 호출 금지. DB 는 읽기 전용 SELECT 만(해외 단위 확인용). 커밋·push 하지 않는다(push=배포).
- **reviewer (Sonnet)**: `src/lib/signals/` 는 SAFETY 경로 — 독립 감사 후 `## Reviewer` 마지막 줄에 프로젝트 지침 형식의 판정 줄(리터럴 대문자 + scope)을 남기고 **scope 는 실제 검토한 파일만**. 중점: ① "모르면 막지 않는다"가 모든 분기에서 지켜지는가(특히 환율·단위·`not_queried`·8초 상한) ② 게이트 수량·가격이 실제 주문(`buildOrderRequest`)과 같은 값인가 ③ 해외 통화 단위 ④ `insufficient_cash` 가 호출자에서 경보·재시도 폭주·응답 오류로 새지 않는가 ⑤ 스로틀이 건너뜀 자체를 가리지 않는가 ⑥ 스위치 비정상 값 방향 ⑦ T-044 흡수분 정합(문서·주석) ⑧ 로그에 수치·비밀이 없는가 ⑨ 변이 시험(격리 사본).
- **qa (Haiku)**: 시험 목록 직접 실행 + 경계(필요 금액 = 현금, 1원 차이), 스위치 전환, 호출자 응답.
- **deployer (Haiku)**: QA PASS 후 **사용자 확인을 받은 뒤** 장외 배포. 국내 장(09:00~15:30)과 미국 정규장(KST 약 22:30~05:00)을 피한 창(KST 15:40~22:00 권장). `docs/deploy-order.md` 절차. 배포 확인 항목: pm2 online·재시작 0·핵심 파일 해시·`/api/health` 200·인증 없는 요청 401·신규 오류 0·`[signal-cash-gate]` 로그가 첫 틱부터 정상.

## 판단 기록 (judge)

- [10-21] 접수(`judge-result@2`, engine jev, 규칙 dev-rules@0.5.0): task_type `feature` · complexity 1.91 · risk **R2** · developer=**opus** · `demo=delta/designer`(`JV-ui_change`, behavior_change 0.64) · `next=demo_first` · `blocking_gate=demo`. 데모 게이트 `init` → `drafting`. 결과 원본은 세션 스크래치패드 `judge-T-058-result.json`.
- [10-21] Leader 관찰: T-044 와 같은 오탐으로 보인다 — 이 task 가 바꾸는 것은 서버 시그널 생성 로직과 텔레그램 메시지 유무이고 **새로 그릴 화면·화면 파일이 없다.** 사용자에게 데모 생략 여부를 묻는다. 대리 생략·승인 금지(`waive` 는 사용자 원문이 있어야 한다). 생략 전에는 developer 를 배정하지 않는다.
- [10-21] 사용자 영향으로는 앱 승인 대기 목록·분석 목록에서 현금 부족 매수 시그널이 더 이상 생기지 않는다(기존 행은 그대로). 이 변화를 사용자가 데모 대신 설명으로 이해했는지 확인 필요.
- [10-21 12:12] 사용자 "데모 생략" 입력 → `check.mjs waive --quote "데모 생략"`(`DEMO_GATE_WAIVED`) → `activate`(`DEMO_GATE_PASSED`). 상태 `waived`, 사유는 위 Leader 관찰(새 화면 없음 — 서버 시그널 생성 로직과 알림 억제). **데모 게이트 통과 — developer 배정 가능.** `waiting: user_decision` 제거.

- [10-21 오후] **인수**: 사용자 지시("T-058 매수시그널 게이트 작업 진행해줘")로 project-52 세션이 구현 진행을 이어받는다. 원 담당 세션(매수로직개선 _ 주식매매)은 세션 목록에 없어 알림을 보내지 못했다 — 이 문서가 인수 기록이다. 설계·결정은 변경 없음.
- [10-21 오후] Leader 읽기 전용 증거(해외 단위 1차): 운영 DB `signals` 해외 매수 최근 8건의 `price`·`amount_krw` 는 **원화 환산값**(NAS:SNDK price 1,814,446.89 / amount_krw 1,023,899, 환율 1327.84 로 나누면 약 1,366 USD), 시그널 시점 `quantity` 는 null. 해외 `orders` 최근 6건도 가격이 원화 규모(NAS:SNPS 722,595, quantity 5, status blocked). → 해외 필요 비용은 원화이므로 `원 ÷ 환율 = 필요 USD` 로 비교해야 하고 환율 미확정이면 unknown. 최종 확정(주문 단계 환산 방식 포함)은 Developer 가 코드로 확인한다.
- [10-21 오후] judge C1(`codex_gate`, R2, 요약 322자·코드 없음): `codex_required=true` · mode `adversarial-review` · focus `error_handling` · 규칙 `CX-limit-unknown-r2`(남은 한도 불명 → R2 는 실행) · `codex_switch=on` · 호출 0/4. 입력·결과: 세션 스크래치패드 `judge-T-058-c1.json` / `.out.json`.
- [10-21 13:47] judge C2(`codex_gate`, R2, Reviewer PASS 직후): `codex_required=true` · mode `adversarial-review` · focus `design_assumption`(confidence 0.92) · 규칙 `CX-limit-unknown-r2` · `codex_switch=on` · 호출 1→2/4. 입력·결과: 스크래치패드 `judge-T-058-c2.json` / `.out.json`.
- [10-21 13:56] (시각 정정: 파일 시각 기준 — judge C2 13:47, Codex C2 13:49, 이 문서·주석 수정 13:55, QA 절의 `[14:05]~[14:12]` 표기는 에이전트가 쓴 시각이 실제(14:00)보다 뒤여서 틀렸다. 순서와 내용은 영향 없음. 내가 쓴 앞선 `13:58`·`14:20` 표기도 위 값으로 바로잡았다.) Reviewer PASS 유지(Codex C2 2건 모두 수용·채택 0건, `## Reviewer` 절 마지막 줄 = 최종 판정 PASS). Reviewer Low 반영 — **Leader 가 PASS 이후 직접 한 수정(로직 0, 설명 문장만)**: ① `service.ts:110` · `eval-funnel-labels.ts:138` 주석의 "1주 비용" → "사이징된 주문 전체 비용(수량 × 지정가 × 1.002)"(실제 거동은 사이징 수량 전체 — 요구의 필요 금액 정의와 같고 설명만 부정확했음) ② `docs/telegram-approval.md` §2.1 같은 표현 2곳 정정, 되돌리기 SQL 을 ` ```sql ` 블록으로(인라인 중첩 백틱은 복사 시 `key` 예약어 구문 오류), 퍼널 규모 "약 3~10%"+순증이 더 작다는 설명. 변경 전 백업: 스크래치패드 `bak-1021/telegram-approval.md.before-leader-limits`. 후속으로 미룬 Low: R-2 시험 공백 3건(throttleCheck suppressed 이월·orderType 항상 limit·chase_disabled 사례)·R-3(해외 평가마다 `getUsdKrwRate()` 갱신 유도 — `fx_rates` 5분 미만이면 생략 권고)·R-6(T-051 기존 시험이 TTL 상수를 import)·R-7(`positions/status/route.ts:30` 이 `fx_rates` 를 `'USD/KRW'` 로 읽음 — T-058 무관).
- [10-21 오후] 실제 `createSignal` 호출자 3곳 확인(테스트·주석 제외): `src/app/api/signals/route.ts:67`, `src/app/api/analyst/run/route.ts:58`, `src/lib/strategy/engine.ts:234`(`createSignalGuarded`, 결과를 `eval_funnel` 게이트로 기록 — `eval-funnel-labels.ts` 에 게이트 라벨·순서 표가 있음). `scenario-builder`·`research-cycle-*`·`trade-report` 는 주석 언급뿐 실제 호출자가 아니다.

## 설계 보강 (Codex C1 반영 — Developer 필독)

Codex C1 지적 5건을 Leader 가 코드와 대조했다(채택·오탐의 최종 판정은 Reviewer). 아래는 위 "요구"에 **추가**되는 설계 확정 사항이다.

- **S-1 환율(Codex high — 코드로 확인됨)**: `getUsdKrwRate()`(`fx.ts:122-162`)는 외부 조회와 DB 조회가 다 실패해도 DB 의 오래된 값 또는 env/하드코딩 1380 을 **반드시 숫자로 돌려준다.** 그대로 쓰면 "환율 미확정 → unknown" 을 표현할 수 없다. `fx.ts` 에는 **타 세션 미커밋 변경(T-040 호출 기록 +8/−1)이 있으므로 수정하지 않는다.** 게이트 전용 환율 판독을 새로 둔다: ① `getUsdKrwRate()` 를 호출해 캐시·`fx_rates` 갱신을 유도하되 반환값은 쓰지 않는다 → ② `fx_rates`(pair `USD_KRW`) 행을 읽기 전용 SELECT 해서 `fetched_at` 이 허용 시간 이내일 때만 그 `rate` 를 known 으로 인정. 행 없음·오래됨·조회 실패·비정상 값(NaN·0 이하) = unknown(막지 않음). 폴백 사용 = DB 행이 오래됨 = unknown. 허용 시간은 Developer 가 근거와 함께 정한다(`fx.ts` 캐시 TTL 5분, 제안 상한 1시간). 시험: 외부 실패+DB 오래됨 / 환경변수·하드코딩 폴백 → unknown.
- **S-2 엔진 호출자(Codex medium — 코드로 확인됨)**: `strategy/engine.ts:234-257` `createSignalGuarded` 는 `duplicate_active_signal`·`symbol_blacklisted`·`quantity_below_min` 만 정상 skip 이고 나머지는 `signal_create_failed`/verdict `error` + 매 건 `console.warn` 이다. `insufficient_cash` 를 그대로 두면 정상적인 현금 부족이 "엔진 고장"으로 집계된다. → `eval-funnel-labels.ts`(`FUNNEL_GATES`·`GATE_STAGE`·`GATE_LABEL_KO`)에 `insufficient_cash` 게이트를 추가해 verdict `skip` 으로 매핑한다(T-020 `quantity_below_min` 이 선례). 이 결과에는 `console.warn` 을 내지 않거나 게이트 로그와 같은 스로틀을 적용한다. `outcome.kill` 전이 의미를 확인하고 시험한다. 퍼널 행은 평가마다 남는 기존 관측이므로 별도 스로틀은 두지 않는다(Developer 가 확인 — 행 수 증가가 문제면 보고).
- **S-3 `analyst/run`(Codex medium — 코드로 확인됨)**: `route.ts:58-59` 는 `r.ok` 를 보지 않고 모두 `created` 에 넣는다 → `signalId:0` 이 생성 성공처럼 응답된다. `insufficient_cash` 는 `skipped`(reason `insufficient_cash`)로 보내고 `created` 에 넣지 않는다. **최소 범위**: 다른 `ok:false` 코드(`duplicate_active_signal` 등)의 기존 취급은 이 task 에서 바꾸지 않고, 발견 사실로 Developer 가 보고한다(후속 후보). `created` 에 `signalId:0` 이 안 들어가는 회귀 시험.
- **S-4 `POST /api/signals`(Codex medium — 코드로 확인됨)**: `route.ts:84` 는 `!ok` 를 전부 HTTP 400 으로 돌린다. `insufficient_cash` 는 입력 오류가 아니라 정책 건너뜀이므로 HTTP 200 + `{ ok:false, skipped:true, reason:'insufficient_cash', data: result }` 로 구분한다(다른 `!ok` 는 400 유지). 이 엔드포인트를 POST 로 부르는 화면·스크립트가 있는지 Developer 가 확인하고(GET 목록 호출은 무관) API 시험을 추가한다.
- **S-5 설정·스로틀·관측 실패 격리(Codex medium — 설계 빈칸)**: ① `system_config` 읽기는 3상태 — 키 없음(켜짐) / 값 있음(`true` 만 켜짐) / **읽기 오류(꺼짐 = 막지 않음).** `approval-notify.ts:154-161` `readConfig` 처럼 오류를 `undefined`(키 없음=켜짐)로 합치지 않는다. ② 게이트 함수 전체는 **어떤 예외도 밖으로 던지지 않고 unknown(막지 않음)** 으로 닫는다. ③ 건너뜀 관측(로그·집계 쓰기)은 별도 try/catch 의 best-effort — 관측이 실패해도 `insufficient_cash` 반환은 유지한다. ④ 스로틀 상태는 프로세스 로컬이다(~~`stockinvest` 와 `stockinvest-cron` 이 별개 프로세스 → 1시간 1회는 **프로세스별** 제한임을 코드 주석과 문서에 명시~~ → **정정(Developer·Reviewer 확인, Leader 전제 오류)**: `stockinvest-cron` 은 bash(`cron-runner.sh`)가 curl 로 라우트를 부르는 프로세스이고 `stockinvest` 는 `instances: 1` 이라, 게이트 코드는 한 프로세스에서만 돌며 "1시간 1회"는 사실상 전체 1개 — 재시작하면 창이 새로 시작한다. 코드 주석·문서는 이 사실대로 적혀 있다). 오래된 키를 정리해(접근 시 prune 또는 개수 상한) 장기 가동 메모리가 늘지 않게 한다.
- **S-6 해외 단위(Leader 1차 증거)**: 위 "판단 기록"의 읽기 전용 증거대로 해외 시그널 가격·금액은 원화 환산값이다. 필요 USD = 필요 비용(원) ÷ S-1 의 known 환율. Developer 는 `kis-overseas.ts createOrder`·`sizeOrderQuantity`/`buildOrderRequest` 코드로 주문 단계 환산 방식을 확인해 같은 값을 쓰는지 대조하고 결과를 `## Developer` 에 적는다.

## Developer

- [13:30] **상태: 구현 완료·Reviewer 인계 대기. 커밋·push·배포·build·pm2·DB 쓰기·KIS 호출·실발송 0건.** DB 는 읽기 전용 SELECT 1회(아래 해외 단위)만.
- [13:30] **해외 단위 결론(S-6) — 확정, 해외 게이트 출시(unknown 강등 없음).** [확실] ① `kis-overseas.ts getTicker` 가 USD 시세를 fetch 직후 원화로 환산(`price = last × fx`)해 시그널 `price` 는 원화다. ② `sizeOrderQuantity` 는 `floor(amountKRW ÷ 추격 반영 원화 가격)` — 분자·분모 모두 원화라 수량(주)은 정확하다(197-199 주석의 "KRW 가정"은 실제로 맞는 가정이라 오해 소지만 있다, 주석 미수정). ③ `createOrder` 는 원화 지정가 `÷ fetchUsdKrwRate()` → `roundToTickOverseas`(**$1 이상은 1달러 단위 반올림**, 미만 0.0001) 를 `OVRS_ORD_UNPR` 로 송신. ④ 읽기 전용 SELECT(10-21 13:1x): `fx_rates USD_KRW 1327.84 · age 59초`, 해외 매수 시그널 5건 `price` 원화 규모·`quantity` null(예: NYS:BAC 67,109원 → $50.54), 해외 `orders` 5건 정수 수량·원화 가격. 게이트 단가 = `overseasLimitUnitUsd(원화가, 환율)` 이 ③ 을 복제하고, `signal-cash-gate-order-parity.test.ts` 가 **진짜 `createOrder` 송신 본문의 `OVRS_ORD_UNPR`·`ORD_QTY`** 와 9개 가격(정수·$50.54→$51·$1 경계 위아래·$1 미만·고가)에서 일치를 고정한다. 필요 USD = 수량 × 그 단가 × 1.002, `cash.USD` 와 **센트 단위** 비교(달러 단위 올림으로 과차단하지 않게).
- [13:30] 남는 차이(보고): 주문 시점 환율은 `fetchUsdKrwRate()`(폴백 포함), 게이트 환율은 신선한 `fx_rates` 행 — 정상 운영에서는 같은 원천(5분 캐시)이다 [가능성 높음]. 승인 대기 경로는 승인 시점까지 가격·환율이 움직인다(기존 구조, 게이트는 생성 시점 판단).
- [13:30] **환율 허용 시간 = 1시간(`FX_MAX_AGE_SEC` 3600) + 상식 범위 100~10,000.** 근거: `fx.ts` 는 TTL 5분으로 외부 조회→`fx_rates` 갱신을 하고 해외 `getTicker` 마다 그 경로를 타므로 정상 나이는 5분 안팎(실측 59초). 1시간 초과 = 외부 조회 약 12회 연속 실패 = `fx.ts` 가 오래된 값/1380 폴백을 주는 상황 → unknown. 더 짧게 해도 정밀도 이득이 없다(외부 원천 자체가 일 단위 갱신). 나이는 `TIMESTAMPDIFF(SECOND, fetched_at, NOW())` 로 DB 가 계산(시간대 해석 차이 제거). 갱신 유도용 `getUsdKrwRate()` 호출은 **반환값을 쓰지 않고** 8초 상한, 지연 import(국내 경로가 fx 를 끌어오지 않게). `fx.ts` 미수정(S-1).
- [13:30] **현금 읽기 공유**: `entry-cash-precheck.ts` 의 캐시·진행 중 조회 단위를 "국내 값"에서 "잔고 응답 하나(`AvailableCash` = 국내 KRW + 해외 USD)"로 넓혔다. `readDomesticAvailableCashKRW` 는 그 국내 값 — TTL 30초·공유 마감 8초·늦은 결과 미캐시·실패 캐시·경고 문구 모두 그대로, 기존 T-051 시험(entry-cash-precheck + entry-watcher 5개 스위트 134건) 무수정 통과. 신규 `readAvailableCash`·`overseasUsdCashFromBalances`(known 만 값, `unknown`/`not_queried`/형식 이상은 null + 이유 코드).
- [13:30] **게이트 위치·사이징**: `createSignal` 블랙리스트 검사 직후·`routeSignal`/중복 검사/INSERT 앞, `side==='buy'` 일 때만. 수량·가격은 `size()` 콜백 안에서 `getStyleConfig()`+`getEffectiveChasePct()`+`buildOrderRequest(input, chasePct)` — 자동 제출 경로·`approveSignal` 과 같은 함수·같은 추격. 스위치를 먼저 보고 꺼져 있으면 사이징·잔고 조회를 하지 않는다(I/O 0). 켜져 있으면 매수 시그널마다 DB 읽기 2회(style·chase)가 늘고 잔고는 30초 캐시 공유.
- [13:30] **unknown(막지 않음) 사유 코드**: `cash_timeout`·`domestic_cash_unknown`·`usd_unknown`·`usd_not_queried`·`usd_invalid`·`usd_missing`·`balances_read_failed`·`fx_missing`·`fx_stale`·`fx_invalid`·`fx_read_failed`·`market_order`(국내·해외 모두 — 작업서 요구대로)·`quantity_unresolved`·`quantity_zero`·`quantity_invalid`·`price_invalid`·`sizing_failed`·`unit_price_invalid`·`gate_timeout`(전체 10초)·`gate_exception`. 게이트는 던지지 않는다.
- [13:30] **스위치**: `system_config` 한 쿼리(`key IN (?, ?)`), 30초 캐시. 키 없음·JSON `true` = 켜짐 / 그 밖(`false`·`"true"`·`"false"`·0·1·null·파싱 불가)= 꺼짐 / **읽기 오류 = 꺼짐(read_error, 키 없음과 합치지 않음 — S-5 ①)**. 운영 DB 에 두 키 모두 없다(읽기 전용 확인) → **배포 즉시 국내·해외 게이트가 켜진다.**
- [13:30] **관측·스로틀 저장 방식**: 프로세스 로컬 `Map`. 키 `skip:<시장>:<심볼>:<방향>`(건너뜀 → `console.info` 1줄 + `trade_logs` `signal_cash_gate_skip` 21자) · `unknown:<시장>:<사유>` · `disabled:<시장>:<출처>` · `ok:<시장>`(뒤 셋은 로그만). 창 1시간, 억제 건수는 다음 기록의 `suppressed_since_last`/`suppressedSinceLast` 로. 256개 초과 시 만료 키 정리, 1,000개 초과 시 오래된 것부터 삭제. 관측은 fire-and-forget·이중 try/catch — 실패해도 `insufficient_cash` 반환 유지(S-5 ③). 로그·payload 에 금액·잔고 수치 없음. ⚠ S-5 ④ 전제 정정: [확실] `stockinvest-cron` 은 bash(`cron-runner.sh`)가 curl 로 라우트를 부르는 프로세스라 Node 코드는 `stockinvest` 한 프로세스에서만 돈다 → 지금은 사실상 전역 1시간 1회, 재시작(배포)하면 창이 새로 시작. 코드 주석·문서에 그대로 적었다.
- [13:30] **호출자(전수 재확인 — 작업서와 같음)**: 실제 `createSignal` 호출자는 `strategy/engine.ts`(createSignalGuarded)·`api/analyst/run/route.ts`·`api/signals/route.ts` 3곳뿐(나머지는 주석). ① 엔진: `insufficient_cash` → funnel gate `insufficient_cash`/verdict `skip`, `outcome.kill(sym, 11, 'insufficient_cash')`(quantity_below_min 과 같은 전이), 이 코드만 `console.warn` 생략, `recordedVerdict:'skip'` 이라 exit 경로도 `exit_create_failed` 를 덧쓰지 않는다. `eval-funnel-labels.ts` 끝에 append·stage 11·라벨 "실시간 현금 부족 (매수 시그널 미생성)". `eval_funnel.gate` 는 VARCHAR(48) 이라 **마이그레이션 없음**. 퍼널 행은 평가마다 1행(기존 관측 방식) — 그 후보는 원래 `signal_created`/`duplicate_active_signal` 행이 남던 자리라 행 수 순증은 거의 없다 [가능성 높음]. ② analyst/run: `insufficient_cash` 만 `skipped`(reason `insufficient_cash`), `created` 에 `signalId 0` 이 들어가지 않음. ③ POST /api/signals: HTTP 200 + `{ ok:false, skipped:true, reason:'insufficient_cash', data }`, 다른 `!ok` 는 400 유지. 저장소에 이 엔드포인트를 POST 로 부르는 화면·스크립트 없음(화면 10곳은 GET 목록만), `analyst/run` 도 저장소 내 호출자 없음(grep).
- [13:30] **T-044 흡수**: 작업 트리 미커밋 변경 위에서 이어 고쳤다(되돌림 없음). `approval-notify.ts` — `readConfigState`(읽기 오류를 키 없음과 구분) + `skipUnexecutableFromConfig`: 키 없음 또는 정확히 `true` 만 생략, 그 밖의 값·읽기 오류는 보냄(Codex low). 다른 스위치의 `readConfig` 해석은 그대로. `approval-context.ts` — **머리 주석 3줄만**(Low-1, 판정 로직 0줄). `service.ts` T-044 주석 1줄 유지. `docs/telegram-approval.md` — 표 기본값 문구, "운영 메모"를 새 해석·생략 로그 위치(`pm2-out.log` = `ecosystem.config.js` out_file, grep 문구·줄 형식, Low-2)·**한도 사유 TTL 중복 방지 한계(남음, 사용자 결정 사항)** 로 다시 씀, 신규 §2.1 게이트 스위치 표·판정·로그 grep·위험·되돌리기, §3 1번·§6.4 로그 목록 보강. 문서는 읽기→임시 파일→`os.replace`(백업: 스크래치패드 `t058/telegram-approval.md.bak`). ⚠ 인수인계가 "T-044 Reviewer 가 보지 않은 5줄"이라 한 블록은 내용상 T-044 운영 메모였고, 그 안의 "`"false"`·0·null 은 켜짐(생략)" 문장은 이번 수정으로 틀린 말이 되어 **다시 썼다** — 스테이징 때 이 블록이 T-044/T-058 몫인지 Leader 가 판단.
- [13:30] **변경 파일(HEAD 대비 numstat, T-044 몫 포함)**: `src/lib/signals/signal-cash-gate.ts` 신규 364 · `entry-cash-precheck.ts` +56/−9 · `service.ts` +34/−2(T-044 +1/−1 포함) · `approval-notify.ts` +36/−49(T-044 +9/−48 포함) · `approval-context.ts` +3/−1(주석) · `strategy/engine.ts` +6/−1 · `strategy/eval-funnel-labels.ts` +8 · `api/analyst/run/route.ts` +6 · `api/signals/route.ts` +4 · `docs/telegram-approval.md` +32/−4(T-044 +7/−2 포함). 시험: `__tests__/signal-cash-gate.test.ts` 신규 423 · `__tests__/service-cash-gate.test.ts` 신규 302 · `__tests__/signal-cash-gate-order-parity.test.ts` 신규 62 · `strategy/__tests__/engine-insufficient-cash.test.ts` 신규 68 · `api/analyst/run/__tests__/route.test.ts` 신규 57 · `api/signals/__tests__/route-insufficient-cash.test.ts` 신규 46 · `__tests__/approval-notify.test.ts` +129/−68(T-044 +75/−68 포함, 이번 몫은 끝에 describe 5 추가 + 머리 주석 1줄).
- [13:30] **시험 결과(격리 사본 — `git archive HEAD` + 위 17개 파일 덮어쓰기, 스크래치패드 `t058/iso`)**: `tsc --noEmit` exit 0 · 전체 jest **174 스위트 / 3,999건 전부 통과**(HEAD 기준선 168 / 3,859, +6 스위트·+140건) · 관련 8개 스위트 224건 통과(게이트 단위 74 · createSignal 통합 28 · 주문 대조 9 · 엔진 4 · analyst/run 2 · POST 3 · approval-notify 34+17=51 · entry-cash-precheck 기존 그대로). 자체 변이 19개 전부 죽음(스위치 해석·읽기 오류 방향·환율 나이·단가 반올림·센트 경계·수량 0·시장가·스로틀·매도 제외·insufficient 반환·추격 사이징·USD unknown·엔진 경고/게이트 매핑·analyst skipped·POST 200·skip 플래그 2종). lint: 저장소에 ESLint 설정이 없어 **미실행**(`next lint` 는 설정 마법사를 띄움).
- [13:30] 작업 트리(타 세션 변경 포함) 결과는 신뢰 불가로 구분: `npm run typecheck` 오류 4건은 전부 내 파일 밖(`src/lib/api-usage.ts` 의 `@workspace/api-usage` 미해결 ×2, `llm/claude-cli.ts:78`, `strategy/ai-filter.ts:435` — 타 세션 T-040 등). jest 는 `service.test.ts`·`order-sizing.test.ts` 등이 `kis-http.ts → api-usage.ts → @workspace/api-usage` 로드 실패(타 세션 T-040 미커밋)로 스위트 자체가 안 뜬다 — 격리 사본에서는 통과.
- [13:30] **못 한 것·남은 위험**: dev 서버 + curl 시험 **미실행** — 게이트가 실 KIS 잔고를 조회하게 되므로(KIS 실계좌 호출 금지) 라우트 시험(jest)으로 대체. 실제 KIS·텔레그램·DB 쓰기 경로 실측 없음. USD 0 / 통합증거금 여부 미실측(배포 후 첫 미국장 보고 대상). 해외 수수료(약 0.25% [추측]) 는 여유 0.002 로 다 덮지 못해 좁은 구간에서 "충분"으로 보고 만든다 — 막지 않는 방향. 국내 매수도 `getBalancesDetailed()` 가 해외 보유·USD 조회까지 기다린다(T-051 과 같은 기존 성질, 8초 상한).
- [13:30] **발견했지만 범위 밖이라 안 고친 것**: ① [가능성 높음] `kis-overseas.ts roundToTickOverseas` 가 $1 이상 가격을 **1달러 단위로 반올림**해 송신한다(미국 호가 단위는 $0.01) — 지정가 매수가 최대 ±$0.5/주 어긋난다(실측 형태 NYS:BAC $50.54 → $51, +0.9%). 게이트는 이 동작을 그대로 따른다. 별도 task 후보. ② `analyst/run` 의 다른 `ok:false`(예: `duplicate_active_signal` 은 기존 행 번호로 `created` 에 들어감) — 현행을 시험으로 고정만 하고 미수정, 후속 후보. ③ `service.ts:197-199` 사이징 주석("KRW 가정")은 오해 소지 — 미수정. ④ 1주 가격 > 금액인 해외 시그널(실측 NAS:SNDK 181만 원 vs 102만 원)은 수량 0 → 게이트 unknown → 기존대로 생성되고 승인 시 `quantity_below_min` — 기존 동작. ⑤ 한도(daily/order) 사유 생략 시그널의 TTL 중복 방지 한계 — 문서에 한계로만 적음(사용자 결정 사항).
- [13:30] **이 task 로 건드린 SAFETY 경로(Reviewer scope 용)**: `src/lib/signals/signal-cash-gate.ts` · `src/lib/signals/entry-cash-precheck.ts` · `src/lib/signals/service.ts` · `src/lib/signals/approval-notify.ts` · `src/lib/signals/approval-context.ts`(주석) · `src/lib/signals/__tests__/{signal-cash-gate,service-cash-gate,signal-cash-gate-order-parity,approval-notify}.test.ts` · `src/lib/strategy/engine.ts` · `src/lib/strategy/eval-funnel-labels.ts` · `src/lib/strategy/__tests__/engine-insufficient-cash.test.ts` · `src/app/api/signals/route.ts` · `src/app/api/signals/__tests__/route-insufficient-cash.test.ts` · `src/app/api/analyst/run/route.ts` · `src/app/api/analyst/run/__tests__/route.test.ts`. 비 SAFETY: `docs/telegram-approval.md`. 건드리지 않음 확인: `submitOrder`·`order-limits`·`kill-switch`·`dry-run`·`assessExecutability` 로직·`CASH_SHORTFALL_RATIO`·post-market·`custom/confirm`·entry-watcher 라우트·폴러·`fx.ts`·`kis-overseas.ts`·`docs/deploy-order.md`. 마이그레이션 없음.
- [13:30] Reviewer 재현 방법: 격리 사본 재생성 = `git archive HEAD | tar -x -C <dir>` → 위 17개 파일 복사(목록: 스크래치패드 `t058/files.txt`) → `node_modules` 심볼릭 링크 → `npx tsc --noEmit` · `npx jest`. 단위 시험만이면 작업 트리에서도 `npx jest src/lib/signals/__tests__/signal-cash-gate.test.ts src/lib/signals/__tests__/service-cash-gate.test.ts src/lib/signals/__tests__/signal-cash-gate-order-parity.test.ts src/lib/signals/__tests__/approval-notify.test.ts src/app/api/signals/__tests__/route-insufficient-cash.test.ts src/app/api/analyst` 가 돈다(엔진 시험은 격리 사본 필요).

## Reviewer

- [13:45] **감사 개시 — T-058 reviewer(Sonnet) 독립 감사 1라운드.** 방법: `git archive HEAD` 새 격리 사본(`t058-rev/iso`, node_modules 심볼릭 링크)에 이 task 17개 파일만 작업 트리에서 덮어쓴 뒤 jest·tsc·변이 시험. 소스·시험·다른 절은 수정하지 않았다(작업 트리 파일 17개와 사본의 동일성을 변이 시험 뒤에 `cmp` 로 재확인 — 전부 일치). DB 는 읽기 전용 SELECT(`SET SESSION TRANSACTION READ ONLY`)만, KIS·텔레그램·pm2·build·커밋·push·운영 경로 접근 0건. 화면 파일 변경이 없어(데모 게이트 사용자 생략 기록 `waived`) `check.mjs` 는 실행하지 않았다.
- [13:45] [확실] **실행 결과(격리 사본)**: `tsc --noEmit` exit 0 · 전체 jest **174 스위트 / 3,999건 전부 통과**(Developer 보고와 일치) · T-051 시험 파일(`entry-cash-precheck.test.ts`·`entry-watcher/__tests__/*`)은 `git status` 상 미수정이고 그대로 통과. 작업 트리 전체 jest·typecheck 는 타 세션 미커밋(T-040 등) 때문에 신뢰 불가라 돌리지 않았다.
- [13:45] **지적 요약: Critical 0 · High 0 · Medium 1 · Low 6.** 아래 번호는 심각도순이다.
- [13:45] **R-1 (Medium) 해외 게이트의 "가용 USD"는 구매력이 아니라 예수금(`frcr_dncl_amt_2`)이다 — 미결제·재사용 가능 매도대금이 빠져 있을 수 있다.** 위치: `signal-cash-gate.ts:255-269`(해외 분기), `entry-cash-precheck.ts:87-96`(`cash.USD.usd` 만 읽고 `ustlSllAmtSmtl` 은 버림). 근거: T-056 이력서 54행이 구매력(TTTS3007R `sll_ruse_psbl_amt` 등)과 예수금(CTRP6504R `frcr_dncl_amt_2`)을 "서로 다른 두 값"으로 구분했고, `frcr_dncl_amt_2` 가 미결제 매도대금을 포함하는지는 **[추측]** 으로 남아 있으며, 이를 가릴 관측(T-056 단계 4, `docs/deploy-order.md:206` "첫 해외 매도 직후 확인")은 아직 없다. 영향 [가능성 높음, 규모는 추측]: 주력이 미국주식이라 "매도 → 같은 날 재매수" 순환이 생기면, KIS 가 받아 줄 매수를 게이트가 "현금 부족"으로 막을 수 있다. 막는 쪽 오차이고 금전 손실 경로는 아니며, 이 계좌의 통합증거금 여부와 함께 "알려진 위험"에 **적혀 있지 않다**(작업서 98-104행·문서 §2.1 은 USD 0·통합증거금·미체결 매수만 적음). 재현: 해외 매도 체결 직후 `frcr_dncl_amt_2` 가 매도대금을 아직 반영하지 않은 상태에서 해외 매수 시그널이 발화. 권고: ① 위험 목록·문서에 한 줄 추가 ② T-056 단계 4 관측에서 `frcr_dncl_amt_2` 와 `ustl_sll_amt_smtl` 을 대조해 해외 가용액 정의를 확정(그 전에는 해외 스위치가 유일한 완화책) ③ 코드는 이번에 고치지 않아도 된다(추측 위에서 가용액 보정을 넣으면 반대 방향 오류가 생긴다).
- [13:45] **R-2 (Low) 시험 공백 3건 — 변이가 살아남음.** (a) `throttleCheck` 가 재기록 때 `suppressed` 를 0 으로 되돌리지 않아도(M40) 통과 — 시험이 창 2개만 보고 3번째 창의 `suppressed_since_last` 이월을 보지 않는다(로그 숫자만 틀어짐). (b) `service.ts` 가 게이트에 `orderType` 을 항상 `'limit'` 으로 넘겨도(N03) 통과 — 시장가는 게이트 단위 시험(`market_order`)에서만 막히고, 서비스 통합 시험의 시장가 사례는 수량 미확정이라 `quantity_unresolved` 로 우연히 통과한다. 수량이 명시된 시장가 매수가 가격만 보고 막히는 회귀는 못 잡는다. (c) `safety_limit_chase_disabled` 켜짐(추격 0 강제) 사례가 게이트 시험에 없어, 사이징이 `getEffectiveChasePct` 대신 `style.limitChasePct` 를 직접 써도(N05) 통과한다. 현재 코드는 셋 다 올바르다. 권고: 시험 3줄 추가.
- [13:45] **R-3 (Low) 해외 평가마다 환율 갱신 유도 호출이 돈다.** `signal-cash-gate.ts:168` 은 DB 행이 방금 갱신된 경우에도 매번 `getUsdKrwRate()` 를 부른다. 정상 시에는 메모리 캐시 적중이라 무료지만, 환율 원천 3곳이 멈춰 응답하지 않는 구간(각 5초 타임아웃)에는 해외 매수 후보마다 최대 8초(`CASH_READ_TIMEOUT_MS`)를 기다린다(후보 간 공유 없음, `fx.ts` 에 진행 중 호출 공유가 없음). 상한이 있고 미국 매수 후보가 하루 한 자릿수(최근 7일 해외 매수 시그널 75건)라 영향은 작다. 권고: `fx_rates` 행 나이가 5분 미만이면 갱신 유도를 생략.
- [13:45] **R-4 (Low) `suppressedSinceLast` 꼬리 유실.** 마지막 기록 이후 억제된 건수는 같은 키가 1시간 뒤 다시 발화해야 로그·`trade_logs` 에 실린다. 발화가 끊기면 영영 안 남는다. 건너뜀 자체는 매번 일어나고(시험 확인), 숫자는 집계 보조일 뿐이라 결함은 아니다 — 문서에 "하한 값"이라고 한 줄 적으면 충분.
- [13:45] **R-5 (Low) 문서 보강.** `docs/telegram-approval.md` §2.1 에 두 스위치를 끄는 SQL 예시가 없고(키가 현재 DB 에 없어 `INSERT` 형태가 필요), `docs/db-schema.md` 의 `trade_logs.event` 예시 목록에 `signal_cash_gate_skip` 이 없다. 후자는 타 세션이 수정 중인 파일이라 이번 범위 밖으로 둔다.
- [13:45] **R-6 (Low, T-058 이 만든 것 아님) T-051 시험의 TTL 자기참조.** `ENTRY_CASH_CACHE_TTL_MS` 를 30초에서 5초로 바꿔도(N22) 기존 시험이 통과한다 — 시험이 상수를 import 해 쓰기 때문. T-058 은 이 상수를 건드리지 않았고 기존 시험도 수정하지 않았다. 별도 후속 후보.
- [13:45] **R-7 (Low, 범위 밖 참고) `src/app/api/positions/status/route.ts:30` 은 `fx_rates` 를 `pair = 'USD/KRW'` 로 조회하지만 작성자(`fx.ts`)는 `'USD_KRW'` 로 쓴다**(운영 DB 의 유일한 행도 `USD_KRW`) — 그 화면의 환율은 항상 null 일 가능성 [가능성 높음, 화면 동작은 미확인]. T-058 과 무관하며 수정하지 않았다.
- [13:45] **항목별 판정 ①~⑥ (코드·시험·변이로 확인).** ① [확실] "모르면 막지 않는다"는 모든 분기에서 지켜진다: 막는 경로는 `judgeEntryCash` 가 `cash < required` 일 때 `insufficient` 를 내는 두 곳(국내 `:250`, 해외 `:262`)뿐이고, 그 앞의 조회 실패·8초(`cash_timeout`)·10초(`gate_timeout`)·USD `unknown`/`not_queried`/형식 이상·환율 없음/오래됨/범위 밖·시장가·수량 미확정/0/소수·가격 이상·사이징 예외·스위치 읽기 오류·내부 예외가 전부 `unknown`/`disabled` 로 닫힌다. `evaluateSignalCashGate` 는 던지지 않고(바깥 try/catch, 경쟁에서 진 약속은 `Promise.race` 가 처리해 미처리 거부 없음), `createSignal` 호출부는 `observe` 도 `.catch` 로 이중 방어한다. ② [확실] 수량·가격은 `size()` 가 자동 제출 경로·`approveSignal` 과 같은 `getStyleConfig`+`getEffectiveChasePct`+`buildOrderRequest(input, chasePct)` 로 만든다(코드 대조). 해외 단가는 `roundToTickOverseas` 복제본이지만 `signal-cash-gate-order-parity.test.ts` 가 **복제본이 아닌 진짜 `kis-overseas.createOrder` 를 `kisFetch` 목으로 돌려 실제 송신 본문의 `OVRS_ORD_UNPR`·`ORD_QTY`** 와 9개 가격(경계 $1 위아래·고가·$1 미만 포함)에서 비교한다 — 적절하다. 변이 M09(반올림 제거)가 이 시험에서 실제로 죽는 것을 확인했다. 남는 차이는 주문 시점 환율(`fetchUsdKrwRate`, 실패 시 1)과 게이트 환율(신선한 `fx_rates` 행)의 시차뿐이며 정상 운영에서는 같은 5분 캐시 원천이다. ③ [확실] 필요 USD = 수량 × 반올림 단가 × 1.002 를 **센트 정수**로 올림하고, `cash.USD` 는 `Math.round(×100)` 로 센트화해 `cash >= required` 면 통과(엄격 부등호는 `cash < required` 일 때만 막힘). `$601.20` 통과·`$601.19` 차단 경계가 단위·서비스 두 층에서 고정돼 있다(M01·M10 사망). 환율 판독(S-1)은 `getUsdKrwRate()` 반환값을 버리고 `fx_rates` 행의 `TIMESTAMPDIFF(SECOND, fetched_at, NOW())` 만 본다. `fx_rates` 의 유일한 작성자는 `fx.ts`(`writeDbCache`)이고 같은 `NOW()` 로 쓰며 폴백(1380·env)은 DB 에 쓰이지 않으므로, 폴백 상황은 곧 "행 없음/오래됨"이다. 폴백 수용(M08)·나이 검사 제거(M07)·반환값 사용(M36) 변이가 모두 죽는다. `fx.ts` 에는 T-058 흔적이 없다(변경분은 타 세션 T-040 `trackCall` 뿐). ④ [확실] `createSignal` 의 실제 호출자는 `engine.ts`(`createSignalGuarded`)·`analyst/run`·`POST /api/signals` 3곳뿐(grep, 나머지는 주석·문서). 엔진은 `insufficient_cash` 를 퍼널 gate `insufficient_cash`·verdict `skip`·stage 11 로 기록하고 `console.warn` 을 생략하며 `outcome.kill(sym, 11, gate)` 로 `quantity_below_min` 과 같은 전이를 한다 — `recordedVerdict:'skip'` 이라 청산 경로(`exit_create_failed` 덧쓰기)에도 영향이 없다(청산은 매도라 게이트 대상도 아니다). `eval-funnel-labels.ts` 는 `FUNNEL_GATES`·`GATE_STAGE`·`GATE_LABEL_KO` 세 표에 모두 추가돼 `Record<FunnelGate,…>` 컴파일로 누락이 막히고, 라벨·단계 시험이 있다(M39 사망). `eval_funnel.gate` 는 운영 DB 에서 `varchar(48)`, `verdict` ENUM 에 `skip` 이 있어 **마이그레이션 불필요를 운영 스키마로 확인**했다. 퍼널 "최다 차단 top3"·"이상 배너" 쿼리는 `final/skip` 의 reason·`verdict='error'` 만 보므로 이상 집계로 새지 않는다(`eval-funnel-query.ts:136-181` 확인). `analyst/run` 은 `skipped`, `POST` 는 HTTP 200+`skipped:true`, 다른 `!ok` 는 400 유지(시험이 구분). ⑤ [확실] 스로틀은 로그·`trade_logs` 만 줄이고 건너뜀(반환)은 매번이다(서비스 시험: 4회 연속 전부 `insufficient_cash`·행 0, 로그 1건; 변이 M12 사망). 키 정리: 256 초과 시 만료 삭제, 1,000 초과 시 가장 오래 발화한 키부터 삭제 — 재발화 시 `delete`+`set` 으로 순서를 갱신하므로 Map 삽입 순서가 곧 발화 순서이며, 정리 논리 오류는 찾지 못했다(M26·M27 사망). `ecosystem.config.js` 의 `stockinvest` 는 `instances: 1`(`exec_mode` 없음)이고 `stockinvest-cron` 은 `bash scripts/cron-runner.sh` 가 curl 로 `/api/cron/*` 를 부르는 프로세스(`:38`)이며 `scripts/` 에 `createSignal` 호출이 없다 → 코드 주석·문서의 "프로세스 로컬 = 사실상 전체 1개, 재시작하면 창이 새로 시작"은 **맞는 문장**이다(설정 파일 기준 — 실제 pm2 상태는 조작 금지라 조회하지 않았다). Next 프로덕션 번들에서 라우트 간 모듈 싱글턴 공유는 기존 코드(`notifyFlagCache` 등)가 같은 전제를 쓰므로 [가능성 높음]으로만 둔다. ⑥ [확실] 스위치: 키 없음·JSON `true` 만 켜짐, `false`·`"true"`·`"false"`·0·1·null·파싱 불가·읽기 오류는 꺼짐(`read_error`로 키 없음과 구분). 서비스 시험이 국내 8종 값(키 없음/`true`/`false`/`"false"`/`"true"`/0/`null`/파싱 불가)과 읽기 오류를 실제 `createSignal` 로 확인하고, 꺼져 있으면 잔고 조회·사이징이 0회임도 단언한다(M23·M24·M25·M06 사망). 30초 캐시(M41 사망). 운영 DB 에 두 키가 모두 없음을 재확인했다 → 배포 즉시 국내·해외 모두 켜진다.
- [13:45] **항목별 판정 ⑦~⑭.** ⑦ [확실] T-044 흡수분 정합: `approval-notify.ts` 는 `readConfigState`(읽기 오류를 키 없음과 분리)+`skipUnexecutableFromConfig`(키 없음·정확히 `true` 만 생략)이고 오류는 `.catch(()=>false)` 로 "보냄" 쪽이다(M19·M20 사망, 실제 `defaultDeps` 로 값 11종 시험). 요약 코드(`tallyUnexecutable`·`sendSummary`)는 완전히 제거됐고 부재 시험이 있다. 생략 시 서버 로그 1줄에 금액·잔고 수치가 없다(M47 사망). `approval-context.ts` 는 `git diff` 로 **머리 주석 3줄만** 바뀌었고(+3/−1) 상수·판정 로직 변경 0줄이다. 문서의 생략 로그 위치(`pm2-out.log`)·§2.1 표·한도 사유 TTL 중복 방지 한계 서술은 코드(`service.ts` 중복 검사, `approval-context.ts:38-40,166`)와 맞는다. `docs/telegram-approval.md` diff 는 전부 T-044/T-058 구간이었고 타 세션 혼입 구간은 없었다. ⑧ [확실] 로그·`trade_logs` payload·API 응답·퍼널 detail 어디에도 금액·잔고·비밀이 없다(시장·심볼·방향·사유 코드·억제 건수만; M37·M38 사망). `trade_logs` 는 `order_id` NULL 허용·`event varchar(32)`(21자)·`payload` JSON(longtext) 이며 운영 DB 로 확인했다. `trade_logs` 를 읽는 코드는 `/api/orders/[id]`(order_id 로 필터)뿐이라 신규 이벤트가 소비처를 깨지 않는다. 최근 이벤트 종류가 9종뿐이라 볼륨 부담도 없다(건너뜀 기록은 심볼·시장·방향당 1시간 1건). ⑨ 변이 시험 — 아래 표. ⑩ [확실] `entry-cash-precheck.ts` 확장은 T-051 동작을 바꾸지 않는다: `readDomesticAvailableCashKRW` 시그니처·`readAvailableCash` 의 TTL 30초·공유 마감 8초·늦은 결과 미캐시·실패 캐시·진행 중 조회 공유가 그대로이고, T-051 시험(수정 0)이 통과한다. T-051 회귀 변이 6개(캐시 제거 M21·진행 공유 제거 M22·실패 캐시가 0 M45·항상 null M46·늦은 결과 캐시 N19·상한 80초 N23)를 넣자 모두 기존 T-051 시험이 잡았다 — 시험이 이 코드에 실제로 민감하다. ⑪ [확실] 게이트는 `getBalancesDetailed` 를 새로 부르지 않고 같은 30초 캐시·진행 중 공유를 쓴다(서비스 시험: 동시 3건+연속 1건=조회 1회, M21·M22 사망). 스위치가 꺼져 있거나 시장가·수량 0 이면 잔고도 사이징도 하지 않는다. 전체 상한 10초는 국내 8초(첫 호출만, 이후는 공유 마감으로 즉시 unknown)·해외 환율 갱신 8초이고 `gate_timeout` 이 있다(M28·N06 사망). 해외 환율 갱신 대기만 후보마다 반복될 수 있어 R-3 로 적었다. ⑫ [확실] 금지 목록(`submitOrder`·`order-limits`·`kill-switch`·`dry-run`·post-market·`custom/confirm`·entry-watcher 라우트·`assessExecutability` 로직·`CASH_SHORTFALL_RATIO`·`fx.ts`(T-058 몫 0)·`docs/deploy-order.md`(변경분은 T-059 문서))는 `git status`·`git diff` 로 T-058 변경이 없음을 확인했고, 17개 파일 밖에서 "T-058/insufficient_cash/signal-cash-gate" 문구가 든 변경은 vault 문서(`board.md`·`RESUME.md`)뿐이다. ⑬ 시험의 질: 기대값을 손계산(350,700원·$601.20)해 구현을 복제하지 않았고, 경계(같으면 통과·1원/1센트 모자라면 차단)·스위치 값·동시 공유·진짜 `createOrder` 대조·진짜 `defaultDeps` 발송 함수(0회)를 실제로 검증한다. 약점은 R-2 의 3건과 일부 상수 자기참조(`GATE_LOG_WINDOW_MS` 등 — 다른 시험이 간접으로 고정). ⑭ Developer "범위 밖 발견" 판정(코드 확인, 수정 안 함): ① 사실 — `kis-overseas.ts:564-571` `roundToTickOverseas` 는 $1 이상이면 `Math.round(usdPrice)`(1달러 단위)이고 `createOrder:631` 이 그대로 송신한다. 미국 호가단위 $0.01 과 어긋나 지정가가 최대 ±$0.5 흔들린다 — 별도 task 후보(실체결가·미체결 위험은 주문 쪽 문제). ② 사실 — `analyst/run/route.ts` 는 이번 가드 외의 `!ok` 를 `created.push({signalId: r.signalId…})` 로 넣는다(`duplicate_active_signal` 은 기존 행 번호). 현행을 시험이 고정했다 — 후속 후보. ③ 사실 — `sizeOrderQuantity` 는 `floor(amountKRW/chasedKRW)` 가 0 이면 수량 0 → 게이트 `quantity_zero`(unknown)로 생성되고 승인/자동 제출 시 `quantity_below_min`(기존 동작); 운영 DB 최근 7일 해외 매수 시그널 75건이 전부 `expired` 인 것과 부합한다.
- [13:45] **Codex C1 지적 5건 채택·오탐 가름(Reviewer).** 1 [high] 환율 폴백 — **채택**(`fx.ts` 가 외부·DB 실패 시에도 오래된 값/1380 을 숫자로 반환함을 코드로 확인) → `readGateUsdKrwRate` 로 해소, 변이 3종 사망. 2 [medium] 엔진 분류 — **채택** → 퍼널 skip 게이트+경고 생략+kill 전이로 해소. 3 [medium] `analyst/run` — **채택** → `skipped` 분기로 해소. 4 [medium] `POST /api/signals` 400 — **채택** → 200+`skipped:true` 로 해소(저장소에 POST 호출자 없음을 grep 으로 확인). 5 [medium] 설정 읽기 오류·관측 격리·프로세스별 스로틀·키 정리 — **채택(전제 일부 정정)**: 읽기 오류 3상태·관측 best-effort·키 정리는 해소됐고, "프로세스별 제한" 전제는 cron 이 bash 라 사실상 전역 1개라는 점에서 Codex·설계 문구가 과장이었다(코드·문서는 사실대로 적음).
- [13:45] **변이 시험 결과(격리 사본, 총 64개 — 대상은 T-058 시험 7개 스위트+T-051 시험 2개 스위트, 매번 원상 복구).** 사망(시험이 실패로 포착) 58 · 생존 6. **사망 대표**: M01 경계(`>=`→`>`) · M02 매도에 게이트(evaluate) · M04/M05 unknown 을 0 으로 · M06 스위치 읽기 오류=켜짐 · M07 환율 나이 검사 제거 · M08 폴백 1380 수용 · M09 반올림 제거 · M10 센트 단위 오류 · M11 스로틀 무력화 · M12 스로틀이 건너뜀을 삼킴 · M13a/b 기록 실패 예외 전파 · M14 건너뜀 분기에 알림 남김 · M15 `signalId 0` 이 `created` 로 · M16 엔진 verdict error 복귀 · M17 경고 복귀 · M18 POST 400 복귀 · M19/M20 T-044 비정상 값/읽기 오류를 생략으로 · M21/M22 캐시·공유 제거 · M23 꺼진 스위치에서도 조회 · M24 `"true"` 문자열 켜짐 · M25 키 없음=꺼짐 · M26/M27 스로틀 정리 제거 · M28 전체 상한 제거 · M29 시장가 검사 제거 · M30/M31 환율 범위·경계 · M32 추격 미반영 · M33 내부 예외 전파 · M34 사이징 예외=insufficient · M35 환율 unknown 수용 · M36 환율 반환값 사용 · M37/M38 로그·payload 에 수치 · M39 단계 번호 · M41 스위치 캐시 0 · M42 kill 제거 · M43 이벤트명 변경 · M44 USD 0 을 unknown 으로 · M45 실패 캐시=현금 0 · M46 T-051 항상 null · M47 생략 로그 제거 · M48/M49 항상 sufficient · M50 반환 코드 변경 · N06 상한 1ms · N19 늦은 결과 캐시 · N21 verdict pass · N23 상한 80초 · N24 USD state 검사 제거 · N25 환율 나이 음수 허용 · Q07 흔적 제거 · Q08 행 생성 계속 · Q09 퍼널 gate 오기록.
- [13:45] **변이 시험 생존 6개.** M03 (`service.ts` 의 `side==='buy'` 조건 제거) — **동치 변이**: `evaluateSignalCashGate` 가 매도에 `not_applicable` 을 돌려주므로 거동이 같다(이중 방어, 시험 공백 아님). M13c (`void observe(…).catch` 의 `.catch` 제거) — **동치 변이**: `observe` 가 내부에서 전부 삼킨다(이중 방어). **시험 공백**: M40(R-2a)·N03(R-2b)·N05(R-2c). N22 는 T-051 기존 시험의 공백(R-6).
- [13:45] **확인한 사실 vs 확인하지 못한 것.** 확인: 위 코드 대조·격리 사본 jest/tsc·운영 DB 스키마(`eval_funnel`·`trade_logs`·`fx_rates`·`system_config`)·게이트 키 부재·`fx_rates` 행 나이(221초)·`trade_logs` 이벤트 종류·최근 7일 시그널 분포(읽기 전용). 못 한 것(미실행): 실제 pm2 상태(`instances`는 설정 파일로만 확인) · 실제 KIS 응답(통합증거금 여부·`frcr_dncl_amt_2` 의 미결제 포함 여부) · dev 서버+curl · `npm run build`(Next 번들 내 모듈 싱글턴 공유) · 텔레그램 실발송 · lint(저장소에 ESLint 설정 파일 없음 — Developer 보고 사실) · Codex C2(Leader 가 judge 판정에 따라 별도 실행).
- [13:45] **Developer 주장 대조.** 틀린 주장은 찾지 못했다. 보고한 수치(174/3,999, tsc 0, T-051 시험 무수정 통과, 호출자 3곳, 운영 DB 키 부재, 스키마 VARCHAR(48), S-5 ④ 전제 정정)를 모두 독립 확인했다. 다만 "자체 변이 19개 전부 죽음"은 사실이지만 범위가 좁았다 — 같은 시험에 64개를 넣으면 3건(R-2)이 살아남는다. 틀렸던 것은 설계(Leader) 쪽의 S-5 ④ "별개 Node 프로세스" 전제이며 Developer 가 이미 정정했다.
- [13:45] **QA 인계 high_risk_areas**: `signal-cash-gate.ts:229-270`(해외 분기·센트 비교) · `signal-cash-gate.ts:166-181`(환율 판독) · `service.ts:341-366`(게이트 위치·반환) · `entry-cash-precheck.ts:173-202`(공유 캐시·늦은 결과) · `engine.ts:241-261`(건너뜀 분류·kill) · `approval-notify.ts` `skipUnexecutableFromConfig`. QA 실행 권고: 경계(국내 350,700 vs 350,699원·해외 $601.20 vs $601.19), 스위치 값 6종, 국내만 끄기/해외만 끄기, `analyst/run`·`POST /api/signals` 응답 계약, 배포 후 첫 미국장에서 `[signal-cash-gate]` 로그(`usd_unknown`·`fx_stale`·`disabled`·`현금 부족`) 분포와 건너뜀 건수 보고(R-1 관측 겸용).
- [13:45] **Leader 에게(결정 사항 아님, 확인 요청 1건)**: 이 task 는 키가 없으면 배포 즉시 국내·해외 모두 켜진다(사용자가 해외 적용을 선택하고 위험을 고지받은 상태 — 같은 반론은 반복하지 않는다). 다만 R-1 은 고지된 위험 목록에 없던 항목이므로, QA 이후 사용자 보고에 "미국 시그널이 USD 예수금 기준으로만 걸러지고 매도대금 재사용분은 반영되지 않을 수 있음, 첫 해외 매도 직후 확인 예정, 끄는 키는 `signal_cash_gate_overseas_enabled`" 한 줄을 넣어 주길 권한다. R-2 시험 3줄·R-3·R-5 는 Developer 재순환 없이 QA 이후 후속으로 미뤄도 판정에 영향이 없으나, 재순환이 생기면 함께 고치길 권한다.
- [13:46] **최종 판정: PASS (scope: src/lib/signals/signal-cash-gate.ts, src/lib/signals/entry-cash-precheck.ts, src/lib/signals/service.ts, src/lib/signals/approval-notify.ts, src/lib/signals/approval-context.ts, src/lib/signals/__tests__/signal-cash-gate.test.ts, src/lib/signals/__tests__/service-cash-gate.test.ts, src/lib/signals/__tests__/signal-cash-gate-order-parity.test.ts, src/lib/signals/__tests__/approval-notify.test.ts, src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/strategy/__tests__/engine-insufficient-cash.test.ts, src/app/api/signals/route.ts, src/app/api/signals/__tests__/route-insufficient-cash.test.ts, src/app/api/analyst/run/route.ts, src/app/api/analyst/run/__tests__/route.test.ts)**
- [13:55] **Codex C2 판정 개시** — 지적 2건의 채택·오탐 가름 + Leader 가 pass 판정 뒤에 추가한 `docs/telegram-approval.md` §2.1 "알려진 한계" 4줄·되돌리기 SQL 검토. 소스·시험은 읽기만 했고 수정하지 않았다. DB 는 읽기 전용 SELECT(`SET SESSION TRANSACTION READ ONLY`)만, `.env` 값 출력 0.
- [13:55] **C2-1 [medium] 퍼널 `insufficient_cash` 행 누적 — 가름: 사실은 맞으나 결함 아님(오탐으로 분류, 코드 수정 불요).** [확실] 직접 SELECT 로 Leader 수치를 재현했다: `eval_funnel` 일별 행 수 10-13~10-20 = 13,863 / 13,026 / 13,691 / 5,417 / 8,152 / 13,130 / 10,496 (최대 13.9천), 총 280,308행·151MB·최고(最古) 행 09-21 → 30일 보존 삭제(`eval-funnel.ts:29,186` `RETENTION_DAYS=30`)가 실제로 돌고 있다. 같은 틱 수도 맞다(`run` 행: 국내 46~61 · 해외 15~65 /일 — Leader 의 "78" 은 보수적 상한). 최악 추정 "후보 3~5 × 틱 78 × 두 시장 = 468~780행/일 = 기존의 3~10%"는 합리적이다. 다만 **실제 순증은 그보다 작다** [가능성 높음]: 지금도 룰이 재발화하는 틱마다 후보 1행이 남고(최근 3일 `cooldown_entry` 378~683행/일 + `signal_created` 27~54 + `duplicate_active_signal` 105), 게이트 이후에는 시그널이 안 만들어져 진입 쿨다운(`setCooldown` 은 `res.ok` 일 때만)이 안 걸리므로 그 행들이 같은 개수의 `insufficient_cash` 행으로 **대체**된다(발화 사건 수 ≈ 하루 약 400~800건으로 동일). Codex 의 예시 "60종목×6.5h×12회=4,680행"은 모든 종목이 5분마다 단계 11 에 도달한다는 가정이라 실측 발화율의 약 6~10배다. 보존 삭제 용량도 충분하다: 삭제는 프로세스당 6시간마다 5,000행(≈ 20,000행/일)이고 현재 유입 최대 13.9천/일이라 증가분(≤ 약 0.8천)을 더해도 여유가 있다(기존 구조). 스로틀을 퍼널에 넣지 않는 것은 퍼널 설계(T-002: skip 은 후보 단위 전건 기록)와 일치하며, 넣으면 "왜 시그널이 없는가" 관측이 흐려진다. 결론: 수용, 추가 스로틀 불필요. 문서 문구만 보강 권고(아래 D-2).
- [13:55] **C2-2 [medium] 후보 합계 미예약 — 가름: 사실이며 Leader 의 수용(예약 미구현·한계 명시)에 동의. 코드 수정 불요.** [확실] 코드로 확인: 통과한 후보의 비용을 차감하지 않고 30초 캐시를 공유하므로, 현금 15만·필요액 각 10.02만 두 건은 모두 `sufficient` 다. 동의 근거(Leader 논거에 하나 더 보탠다): (a) 이는 T-058 이전에도 마찬가지였고(전부 생성) 게이트가 순수하게 줄이는 방향이라 회귀가 아니다. (b) **예약을 30초 캐시 수명에만 걸면 효과가 거의 없다** — 막힌 후보는 다음 틱(캐시 갱신 후)에 예약이 풀려 그대로 생성되므로 "지연"일 뿐이고, 효과를 내려면 승인 대기·만료·거절 상태를 추적하는 지속형 예약이 필요한데 그것은 이 task 범위를 넘고 "승인되지 않을 시그널이 현금을 점유해 막으면 안 될 것을 막는" 반대 방향 오류를 만든다. (c) 마지막 방어선이 살아 있다: 승인 시 KIS 거부는 `order_not_accepted` 로 시그널이 대기에 남고(T-042), 국내 진입 감시는 T-051 선점 전 현금 점검이 있다 — 최악이 "일부 승인이 거부됨"이고 금전 손실 경로가 아니다. Codex 권고 둘 중 "한계 명시"만 채택·완료(문서에 있음), "예약·차감"은 채택하지 않는다.
- [13:55] **D-1 (문서 검토) Leader 추가분의 사실 확인.** [확실] 4줄 모두 코드·증거와 맞다: ① 예수금≠구매력은 내 R-1 과 같은 서술이고 "T-056 단계 4"·`frcr_dncl_amt_2`/`ustl_sll_amt_smtl` 필드명이 T-056 이력서·`deploy-order.md:206` 과 일치한다. ② 후보 합계 예시(15만/10.02만)는 코드 동작과 같다. ③ 퍼널 규모(8천~1.3만·30일 보존)는 내 SELECT 와 일치한다(상한은 "약 3~10%"로 쓰는 편이 정확 — D-2). ④ `suppressed_since_last` 하한 값은 R-4 와 일치한다. SQL 예시의 컬럼은 운영 스키마와 맞다: `system_config.key varchar(64) PK`·`value longtext(JSON 별칭)`·`updated_at` 기본값 있음(`db.ts:311-315`, 같은 INSERT 형태가 `db.ts:612` 에 있다), 값 `'false'`·`'true'` 는 유효한 JSON, `ON DUPLICATE KEY UPDATE value = VALUES(value)` 는 MariaDB 10.11 에서 유효, "다시 켜려면 `true` 로 두거나 행을 지운다"는 게이트 해석(키 없음·`true` = 켜짐)과 일치한다.
- [13:55] **D-2 (Low, 문서 표현 3건 — 코드 아님, 판정에 영향 없음, 커밋 전 Leader 보정 권고).** (a) **SQL 예시가 인라인 코드 안에 백틱을 넣었다** (`` `INSERT INTO system_config (`key`, value) …` ``) — 마크다운 렌더링에서 코드 구간이 `key` 앞뒤로 끊겨 화면에서 복사하면 `(key, value)` 가 백틱 없이 되고, `key` 는 MariaDB 예약어라 구문 오류가 난다(실행 전 실패라 해는 없으나 되돌리기 수단이 막힌다). 코드 블록(```` ```sql ````)으로 바꾸길 권한다. (b) **"현금이 1주 비용에 못 미치면"은 부정확하다** — 게이트는 사이징된 수량 전체(수량 × 지정가 × 1.002)를 본다(시험: 5주×70,000원 필요 350,700원, 현금 350,000원이면 차단 — 1주 70,000원은 살 수 있어도 막힌다). 문서 §2.1 첫 단락·운영 메모 "현금 부족은 이제 앞 단계에서…" 줄이 같은 표현이고, 코드 주석 2곳(`service.ts:110`, `eval-funnel-labels.ts:138`)도 그렇다. 사용자 요구("잔고가 부족하면")와 거동은 일치하므로 거동 결함이 아니라 설명 오류다 — 문서는 "그 시그널의 주문 수량 전체 비용"으로 고치고, 코드 주석 2곳은 다음 Developer 접촉 때 함께 고치면 된다(주석뿐이라 재순환 불요). (c) 퍼널 규모 문장의 "약 3~8%"는 내 계산으로 3~10% 가 정확하고, "지금의 `cooldown_entry`·`signal_created` 행을 대체하므로 순증은 더 작다"를 한 구절 덧붙이면 오해가 줄어든다. 위 합계 미예약 서술(§2.1 한계 2번째 줄)은 사용자가 오해할 소지가 없다 — "생성된 시그널이 모두 동시에 실행 가능하다는 뜻이 아니다"가 이미 예시와 함께 드러나 있다.
- [13:56] **최종 판정: PASS (scope: src/lib/signals/signal-cash-gate.ts, src/lib/signals/entry-cash-precheck.ts, src/lib/signals/service.ts, src/lib/signals/approval-notify.ts, src/lib/signals/approval-context.ts, src/lib/signals/__tests__/signal-cash-gate.test.ts, src/lib/signals/__tests__/service-cash-gate.test.ts, src/lib/signals/__tests__/signal-cash-gate-order-parity.test.ts, src/lib/signals/__tests__/approval-notify.test.ts, src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/strategy/__tests__/engine-insufficient-cash.test.ts, src/app/api/signals/route.ts, src/app/api/signals/__tests__/route-insufficient-cash.test.ts, src/app/api/analyst/run/route.ts, src/app/api/analyst/run/__tests__/route.test.ts)**

## QA

- [14:05] **상태: 실행 검증 완료. 격리 사본(`git archive HEAD` + T-058 17파일 덮어쓰기, `node_modules` 심볼릭 링크, 원본 작업 트리는 읽기만) 기준. 커밋·배포·DB 쓰기·KIS 호출·실발송 0건.** 임시 블랙박스 파일은 iso 에서만 만들고 삭제했다(원본 시험 파일·소스 미수정).
- [14:05] **실행 1 — 타입체크**: `npx tsc --noEmit` exit **0**.
- [14:05] **실행 2 — 전체 jest (iso)**: Test Suites **174 passed / 174** · Tests **3,999 passed / 3,999** · 실패 0 (기대치와 일치). 스크래치패드 `t058-qa/jest-all.txt`.
- [14:06] **실행 3 — T-058 관련 스위트 (iso, 개별)**: `signal-cash-gate` **74** · `service-cash-gate` **28** · `signal-cash-gate-order-parity` **9** · `engine-insufficient-cash` **4** · `route-insufficient-cash` **3** · `analyst/run/__tests__/route` **2** · `approval-notify` **51** · T-051 `entry-cash-precheck` **53** · entry-watcher `cash-precheck` **33** — 전부 통과(묶음 실행 12 스위트 305건 통과, exit 0).
- [14:07] **실행 4 — 핵심 케이스 단독 `-t` 실행 (전부 통과)**: "경계: 필요 금액과 같으면 sufficient" · "1원 모자라면 insufficient" · "[양성 대조] 같은 조건에서 … 생성" · "매도는 게이트를 타지 않는다" · "자동 제출 경로(auto)도 같은 지점에서 막는다" · "manual(detected) 경로도 막는다" · "건너뜀은 매번, 로그·trade_logs 는 1시간 1회" · "관측(trade_logs) 이 실패해도 insufficient_cash 반환은 유지" · "동시 호출·연속 호출은 잔고 조회 1회" · "해외 스위치만 끄면" · "국내 1원 부족 → insufficient_cash" · "막는 기준은 실제 주문과 같은 사이징" · "모르면 기존대로" · "insufficient_cash → funnel skip" · "→ 200" · "→ skipped" · "진짜 기본 배선의 발송 함수가 한 번도 불리지 않는다" · "1시간 안·밖 연속 발송 0회" · "키 없음이면 실행 불가 매수는 생략" · "notify_skip_unexecutable" 묶음(18 통과, 비정상 값 → 발송 포함).
- [14:08] **실행 5 — 블랙박스 (iso 임시 시험, 모킹 전용, 35건 전부 통과)**:
  - 국내 경계(필요 350,700원 = 5주×70,000×1.002): 같음 350,700 → sufficient ✅ · 1원 적음 350,699 → insufficient ✅ · 1원 많음 350,701 → sufficient ✅ · 현금 0 → insufficient ✅
  - 해외 USD 경계(NAS:AAPL 280,000원÷1400=$200 → 3주 필요 $601.20): $601.20 → sufficient ✅ · $601.19 → insufficient ✅ · $601.21 → sufficient ✅ · 국내 KRW 가 아무리 많아도 해외는 USD 로만 판정 ✅
  - unknown 은 막지 않음: 시장가 ✅ · 수량 0 ✅ · 수량 undefined ✅ · 가격 0/NaN ✅ · 국내 현금 null ✅ · 현금 객체 null(조회 실패) ✅ · 해외 USD not_queried/unknown ✅ · 환율 fx_missing/fx_stale/fx_invalid/fx_read_failed 전부 unknown ✅ · 상한 초과 → gate_timeout 반환(던지지 않음) ✅ · 현금 읽기 throw → unknown ✅ · size() throw → sizing_failed ✅
  - 매도: `not_applicable`, 스위치·현금·환율·size 호출 **0회** ✅
  - 스위치: 저장값 `true` 켜짐 ✅ · `false`/`"true"`/`"false"`/`1`/`0`/`null` 꺼짐 ✅ · 행 없음 → 켜짐 ✅ · 읽기 오류 → 꺼짐 ✅ · 꺼짐이면 size 미호출·`disabled` ✅
  - 환율 행: 신선 → known ✅ · 3601초 → fx_stale ✅ · 0/NaN/50 → fx_invalid ✅ · 해외 단가 $50.54→$51, $1 미만 0.0001 단위 ✅
  - 자기 시험 오류 1건(정정): 처음엔 `gateSwitchValueEnabled(undefined)` 을 켜짐으로 기대했으나, 설계상 키 없음=켜짐은 `readGateSwitches` 가 담당하고 드라이버 값 undefined 는 꺼짐이다(기존 시험 line 207 과 일치). 기대값을 고쳐 35/35 재실행 — 제품 결함 아님.
- [14:09] **실행 6 — 실매매 안전장치 체크리스트**:
  - 변경 파일 대조(T-058 17파일 기준): `submitOrder`·`order-limits`·`kill-switch`·`dry-run` 본체·post-market·`custom/confirm`·entry-watcher·`docs/deploy-order.md`·`fx.ts`·`kis-overseas.ts` — **T-058 변경 0**. 단 작업 트리에 타 세션 변경이 있다: `fx.ts`(T-040 `trackCall` 호출 기록), `docs/deploy-order.md`(T-059 확인 절), `kis-overseas.ts`(타 세션), `kis-order-usage-scenario.ts`(미추적) → "T-058 아님"으로 표시.
  - `service.ts` 의 T-058 diff 는 게이트 호출 블록(중복 검사·INSERT 앞)과 `insufficient_cash` 반환 추가만이다. `submitOrder` 호출 2곳(자동 제출·`approveSignal`)은 그대로이고 게이트 거부 경로에서는 도달하지 않는다(코드 대조).
  - 시험으로 확인: 게이트 거부 시 INSERT 0 · `submitOrder` 미호출(`service-cash-gate` 1번 그룹, 자동·manual 경로 모두) ✅. 게이트 판정 실패는 막지 않는 방향으로만 닫힌다(블랙박스 unknown 전 분기) ✅.
  - 방향 확인: 모든 불확실 경로가 "막지 않음"으로 닫힌다. 막는 쪽으로 틀리는 경로는 (a) 해외 가용액=예수금(구매력 아님) — Reviewer R-1 로 기록돼 있음, (b) 현금 입금 전 발화 시그널 소실 — 기록 있음.
- [14:10] **실행 7 — 배포 인계 점검**:
  - 마이그레이션: `scripts/migrations/` 에 T-058 관련 파일 **없음** (`T-059-us-data-collector.sql` 은 타 task) ✅
  - 환경변수: T-058 변경 파일에 `process.env.*` **신규 참조 0건** ✅ (스위치는 `system_config` 키 2개 — 재배포 없이 끔)
  - 운영 DB 읽기 전용 SELECT: `system_config` 에 `signal_cash_gate%` 키 **0개** → 배포 즉시 국내·해외 게이트 **둘 다 켜짐** (task 알려진 위험과 일치). `notify_skip%` 키도 0개(T-044 기본값 = 켜짐).
  - 배포 후 확인 항목: `docs/telegram-approval.md` 에 로그 grep(`[signal-cash-gate] 현금 부족 매수`), `trade_logs event='signal_cash_gate_skip'`, 엔진 퍼널 gate `insufficient_cash`·verdict `skip`, `POST /api/signals` 200+`skipped`, 해외 스위치 끄는 SQL·되돌리기 명시 ✅. 첫 미국장(KST 22:30 이후) 건너뜀 건수 보고 항목도 알려진 위험에 있음 ✅.
  - 배포 주체: deployer. **지금은 배포하지 않았다**(QA 는 배포 실행 금지, 사용자 확인 대기 — task "역할별 지시" 기재).
- [14:11] **호출자 전수 확인 (grep, iso 기준)**: `createSignal(` 실제 호출자 **3곳** — `src/app/api/signals/route.ts:67`, `src/app/api/analyst/run/route.ts:58`, `src/lib/strategy/engine.ts:234`(`createSignalGuarded`). `research-cycle-*`·`trade-report`·`scenario-builder`·`research/*` 의 `createSignal` 언급은 **주석뿐**(호출 0). 3곳 모두 `insufficient_cash` 를 정상 건너뜀으로 처리하는 시험 있음 ✅.
- [14:11] **결함 목록**:
  - Critical 0 · High 0 · Medium 0 · Low 0 (QA 가 발견한 제품 결함 없음).
  - 참고(결함 아님, 기록용): `createSignal` 에서 게이트가 중복 검사보다 **앞**이라, 이미 활성 시그널이 있는 (심볼,방향)이 현금 부족이면 `duplicate_active_signal` 대신 `insufficient_cash` 가 나온다. 둘 다 "행 없음·알림 없음"이라 사용자 결과는 같다. 응답 코드만 다르다 — 수정 요청 아님.
- [14:12] **미실행·공백 (커버 못 했거나 QA 범위 밖)**:
  - 시험 매핑 공백: "호출자 경보 0회"를 `console.warn`/알림 mock 까지 전부 본 시험은 engine 1건(경고 0 확인)·analyst 1건(created 제외)만 있다. `research-cycle`·`trade-report` 는 호출자가 아니므로 시험 없음(해당 없음).
  - **변이(mutation) 시험 미실행** — Reviewer 담당 영역이라 QA 는 돌리지 않았다.
  - 브라우저 화면 검증 미실행 — 화면 변경 없음(데모 `waived`, 사용자 "데모 생략"). 해당 없음.
  - 실 KIS 잔고·실제 텔레그램·실 DB 쓰기: 미실행(금지 조건 준수). 실 해외 잔고 `frcr_dncl_amt_2` 대 `ustl_sll_amt_smtl` 대조 미실행(알려진 한계 R-1, 첫 해외 매도 후 확인 대상).
  - 운영 배포 후 관측(로그 첫 틱·퍼널 행·첫 미국장 건너뜀 건수) 미실행 — 배포 전이라 불가.
  - `entry-cash-precheck` 의 "조회가 던지면 모든 값이 null" 1건은 개별 `-t` 가 아니라 전체 스위트 실행으로만 확인(통과).
- [14:12] **QA 판정: PASS** (결함 0건 · 실행 전부 통과 · 미실행 항목은 위 목록에 명시. 배포 인계 대상 = deployer, 배포는 사용자 확인 후.)

## Codex 검토

### [2026-10-21 13:04] C1 adversarial-review focus=error_handling — done
- judge 판정: 위 "판단 기록 (judge)" 10-21 오후 C1 줄 참조 / 호출 차수: 1/4
- 대상: repo=StockInvest base=f00758b(task_file) snapshot=326b8f4
- 지적 5건:
  1. [high] T-058 설계 "해외 단위" (환율 미확정=unknown) — 외부 환율 API 와 `fx_rates` 가 모두 실패해도 `getUsdKrwRate()` 가 폴백 숫자를 반환해 환율 미확정을 표현할 수 없음 → 임의 환율로 차단·통과 오판 (권고: 게이트용 환율 판독을 `number|null` 로 분리, 폴백은 unknown)
  2. [medium] `strategy/engine.ts:240` — `insufficient_cash` 가 `signal_create_failed`/error 로 분류되고 매 건 `console.warn` → 정상 현금 부족이 엔진 장애로 집계 (권고: 퍼널 skip 게이트 추가, 경고 억제)
  3. [medium] `api/analyst/run/route.ts:58` — `r.ok` 미검사로 `signalId:0` 이 created 로 응답 (권고: skipped 로 분기 + 회귀 시험)
  4. [medium] `api/signals/route.ts:84` — `!ok` 전부 HTTP 400 (권고: 정책 건너뜀의 명시적 응답 계약)
  5. [medium] 설계 "요구 5·6" — 설정 조회 오류가 키 없음(켜짐)으로 합쳐질 수 있고, 관측 쓰기 실패 격리·프로세스별 스로틀·키 정리가 미정의 (권고: 3상태 조회, best-effort 관측, 만료 정리)
- 검토하지 못한 범위: 구현 전 설계 단계라 `signal-cash-gate.ts` 와 테스트가 없어 예외 격리 구현을 검증하지 못함 / 운영 DB·KIS 실계좌 미조회 / T-058 과 무관한 대규모 미커밋 변경
- Leader 대조 결과: 1·2·3·4 는 코드에서 사실 확인(위 "설계 보강" S-1~S-4), 5 는 설계 빈칸으로 S-5 에 반영. 최종 채택·오탐 판정은 Reviewer.
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261021T040301Z-T-058-C1/raw.txt

### [2026-10-21 13:49] C2 adversarial-review focus=design_assumption — done
- judge 판정: 위 "판단 기록 (judge)" 10-21 13:58 C2 줄 참조 / 호출 차수: 2/4
- 대상: repo=StockInvest base=f00758b(task_file) snapshot=2460545
- 지적 2건:
  1. [medium] `strategy/engine.ts:250` — 현금 부족이 계속되고 시그널 행이 안 생기면(중복 방지 없음) 룰이 재발화하는 매 틱 `insufficient_cash` 퍼널 행이 쌓여 DB 행 수·분석 집계를 키울 수 있음 (권고: 퍼널 기록에도 시간 창 또는 run 단위 집계)
  2. [medium] `signal-cash-gate.ts:246` — 30초 캐시를 공유하는 후보 여러 건이 각각은 가용 현금 이하이지만 합계는 초과하면 모두 통과해 일부 승인 건이 잔고 부족으로 거부됨 (권고: 엔진 실행 단위에서 통과 비용을 예약·차감하거나, 개별 주문의 순간 구매 가능성만 판정한다는 한계를 명시)
- 검토하지 못한 범위: 운영 계좌의 통합증거금·미결제 매도대금 재사용 여부(저장소 밖 실측 필요) / 실제 운영 DB 의 장기 `eval_funnel` 증가율·보존 정책
- Leader 대조 결과(읽기 전용 SELECT 실측, 10-21): 지적 1 — `eval_funnel` 은 기존에도 평가마다 기록하며 하루 약 8천~1.3만 행(최근 3일 8,152 / 13,130 / 10,389), 총 28만 행·151MB, `eval-funnel.ts:186` 이 30일 보존 삭제를 한다. 모든 매수 후보가 매 틱 막히는 최악(후보 3~5 × 틱 78 × 두 시장)도 하루 수백 행으로 기존의 약 3~8% → **수용(추가 스로틀 없음)**, 규모를 문서 한계에 적음. 지적 2 — 설계 한계로 사실이지만 사용자 요구(개별 시그널의 잔고 부족)의 범위 밖이고, 예약·차감은 승인되지 않을 시그널이 현금을 점유해 막으면 안 될 것을 막는 반대 방향 오류를 만든다 → **수용(예약 미구현), 한계를 문서에 명시**(`docs/telegram-approval.md` §2.1 "알려진 한계"). 최종 채택·오탐 판정은 Reviewer.
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261021T044831Z-T-058-C2/raw.txt

## 배포 기록

## 최종 요약

(완료 시 Leader 작성)

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: delta (JV-ui_change) | 10-21 10:41 |
| - | 생략 | - | - | "데모 생략" | 10-21 12:12 |

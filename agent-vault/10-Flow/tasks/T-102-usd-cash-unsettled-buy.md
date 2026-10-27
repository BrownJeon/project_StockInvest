---
task_id: T-102
title: 해외 USD 예수금 판정이 "미결제 매수(매수증거금)" 상태에서 불가로 떨어지는 오탐 수정 — 대시보드 총자산 "-" 해소
status: done
priority: high
project: StockInvest
created: 2026-10-27
updated: 2026-10-28
base_ref: 6052525
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex]
related_tasks: [T-056-usd-cash-snapshot, T-080-killswitch-usd-misread, T-101-settings-post-market-overseas-switch]
tags:
  - type/task
  - domain/safety
  - domain/portfolio
aliases:
  - USD예수금미결제매수
waiting: [Developer 구현, Reviewer·Codex·QA, 장외 배포(10-28 15:40 이후)]
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

# T-102 해외 USD 예수금 판정 오탐(미결제 매수) 수정

## 사용자 지시 (2026-10-27 23시대, 스크린샷 첨부)
"지금 앱에서 kis에 대한 조회가 안되는것같은데 업로드한 화면에서 어떤부분이 문제인지 보고 로그나 소스를 통해서 원인 확인 후 수정해줘"

## 증상 (스크린샷·로그, 사실)
- 대시보드 총자산이 "- KRW", 빨간 문구 "잔고 조회 실패: 해외 예수금(USD)을 확인하지 못했습니다 — 평가액을 표시할 수 없습니다", 보유 탭 "-", 포트폴리오 오늘 "준비 중".
- 서버 로그(`shared/logs/pm2-err.log`): 2026-10-27 **22:47:06 첫 발생**(그 전에는 0건), 이후 46건 모두 같은 문장 — `[kis] overseas usd cash failed (0 으로 해석하지 않음): CTRP6504R USD 예수금 판정 불가 — output3.frcr_evlu_tota=<A> ≠ Σ output2.frcr_evlu_amt2=<B>` → `[api/portfolio] 예수금 확인 불가 — 평가액 미표시`, `[order-limits] overseas 포트폴리오 평가액 모름 → 1회 한도 0 (신규 매수 차단)`. KIS 호출 자체는 성공(`rt_cd 0 KIOK0530`).

## 원인 (실측 — 읽기 전용 KIS 1회 조회로 응답 구조 확인)
- 앱 밖(KIS 앱 등)에서 미국주식 3주 매수가 체결됐고 아직 **결제 전**이다(앱 주문 기록은 오늘 0건, 보유가 3→4종목으로 늘고 매수증거금이 생김).
- 이 상태에서 KIS 응답의 관계가 바뀐다(아래 합성 예시 — 실계좌 값은 문서에 남기지 않는다):
  - `output2[USD].frcr_dncl_amt_2`(예수금 전체)는 그대로, `frcr_buy_mgn_amt`(매수증거금, 미결제 매수)가 생긴다.
  - `output2[USD].frcr_evlu_amt2`가 **(예수금 − 매수증거금) × 환율** 이 된다(출금가능금액 × 환율). 이전 가정은 `예수금 × 환율`.
  - `output3.frcr_evlu_tota`는 여전히 **예수금 전체 × 환율**. 그래서 `tota ≈ Σ frcr_evlu_amt2` 가 깨지고 차이는 정확히 `output3.buy_mgn_amt`(= 매수증거금 × 환율, 미결제매수금액 `ustl_buy_amt_smtl` 과 같음)다.
  - 독립 검산: `output3.tot_asst_amt ≈ evlu_amt_smtl_amt(보유 평가) + tot_dncl_amt(원화 예수금) + Σ frcr_evlu_amt2` — **KIS 자신도 총자산에 순예수금을 쓴다.**
- 합성 예시(환율 1300): 예수금 $1,000.00·매수증거금 $900.00·출금가능 $100.00 → `frcr_evlu_amt2`=130,000, `frcr_evlu_tota`=1,300,000, `buy_mgn_amt`=1,170,000, `tot_dncl_amt`=50,000, `evlu_amt_smtl_amt`=10,000,000, `tot_asst_amt`=10,180,000.
- T-056 의 검산(`parseUsdCashFromPresentBalance`)은 "미결제 매수가 없다"는 가정으로 만들어졌고(설계 주석: 첫 매도/매수 직후 관측은 단계 4 로 보류) **미결제 매수 첫 관측**이 오늘이다. 검산이 막은 것 자체는 안전(이중 계상 방지)이지만 매매할 때마다 결제(T+1)까지 평가·한도가 막히는 설계 결함이다.

## 수정 방향 (Leader 설계 — 보수적, 실측 1건 + KIS 자체 총자산 항등식 근거)
`parseUsdCashFromPresentBalance` 의 USD 행 분기(분기 1)를 확장한다. **분기 2(USD 행 없음)·미결제 매도 처리·그 밖의 실패 경로는 그대로 닫아 둔다(모르면 던진다).**
1. `margin = output2[USD].frcr_buy_mgn_amt`(USD). 키가 없거나 빈 값이면 0(과거 응답 모양 호환), 값이 있는데 숫자가 아니면 던진다. `margin < 0` 이면 던진다. `margin > dncl + 허용오차` 면 던진다(순예수금이 음수 — 통합증거금 등 모르는 상태).
2. `net = dncl − margin`(소수 6자리 반올림). **평가에 쓰는 USD 예수금 `usd` 는 `net`** — 방금 산 종목은 이미 보유 목록(output1)에 시가로 들어 있으므로 총예수금을 그대로 쓰면 이중 계상된다. 결제가 끝나 증거금이 0 이 되면 `net` = 예수금이라 값이 연속이고, 결제 시점에 총자산이 튀지 않는다(킬스위치 손실 계산 보호).
3. 정합 검사(모두 허용오차 ±1원, 분기 1 공통):
   - 행: `frcr_evlu_amt2 ≈ net × frst_bltn_exrt` (margin=0 이면 기존 식과 같다)
   - 합계: `output3.frcr_evlu_tota ≈ Σ output2.frcr_evlu_amt2 + margin × 환율` (margin=0 이면 기존 식과 같다)
   - 교차: margin > 0 이면 `output3.buy_mgn_amt` 가 있어야 하고 `≈ margin × 환율`. margin = 0 이면 `output3.buy_mgn_amt`(있다면)가 `≈ 0` 이어야 한다.
   - 독립 검산(margin > 0 일 때만 추가 요구 — 새 경로라 더 엄격하게): `output3.tot_asst_amt ≈ evlu_amt_smtl_amt + tot_dncl_amt + Σ frcr_evlu_amt2` (세 항이 각각 반올림이라 허용오차 2원).
   - 하나라도 실패하면 어느 식이 어긋났는지 적어 던진다(fail-closed 유지).
4. 반환: `usd = net`. 호출부 호환을 위해 `UsdCashReading` 에 **선택 필드** `grossDepositUsd`(총예수금)·`unsettledBuyUsd`(margin)만 추가한다(기존 소비자는 `usd` 만 읽는다). `types.ts` 주석을 "순예수금(미결제 매수 차감)"으로 정정한다.
5. 새 시험(합성 픽스처, 실계좌 값 금지): 정상(margin 0)·미결제 매수 정상(위 합성 예시)·margin>예수금·margin 음수·margin 있는데 `buy_mgn_amt` 없음/불일치·margin 0 인데 `buy_mgn_amt`≠0·`frcr_evlu_amt2` 가 예수금 기준(=이전 가정)인데 margin>0 → 던짐·`tot_asst_amt` 독립 검산 불일치·USD 행 2개·환율 ≤ 0·비유한 값. 기존 시험은 모두 그대로 통과해야 한다(지우거나 약화 금지).
6. 소비자 영향 점검(읽기): `getUsdCash` → `kis.ts` 의 상태 변환 → `portfolio/route.ts`·`portfolio-snapshot`·`order-limits`·`entry-cash-precheck`·킬스위치 평가가 `usd` 를 "순예수금"으로 읽어도 맞는지(총자산·매수 가능 현금 모두 순이 맞다) 확인하고 보고한다. D1a 원장(`broker-ledger/normalize.ts`)은 별도 판정이라 이번에 바꾸지 않는다 — 미결제 매수 상태에서 `position_snapshot` 판정이 어떻게 되는지 읽어서 보고만(내일 07:20 수집).

## 하지 않는 것
미결제 **매도** 처리 확장(실측 없음 — 계속 던짐), KIS 호출·주문·킬스위치·스위치 변경, 화면 변경(이 수정으로 "-" 가 풀리는 것이 목적), D1a 원장 코드 변경. 실계좌 수치를 문서·시험·커밋 메시지에 남기지 않는다.

## 소유 파일 (예상, 모두 훅 감시 `^src/lib/exchanges/`)
`src/lib/exchanges/kis-overseas.ts`(parse 함수)·`src/lib/exchanges/types.ts`(선택 필드·주석)·`src/lib/exchanges/__tests__/kis-overseas-usd-cash.test.ts`(+필요 시 새 시험 파일). 커밋 시 이 task `## Reviewer` 마지막 판정 줄 필요, 메시지에는 T-102 만 인용.

## 배포
push=배포, 장외 창(15:40~22:00 KST). 지금은 미국 정규장 중이라 **10-28 15:40 이후**. 그때까지 앱은 결제 전이면 "-" 로 보인다(안전한 쪽 — 신규 매수 차단·킬스위치 ON 유지).

## 판단 기록 (judge)

- [2026-10-28 00:2x] intake 1차(요약에 "매수·결제·화면" 등 포함): risk=R2(`R2-kw-payment`) / opus(`MD-judge-failed-opus`) / **demo=delta**(`DM-kw-risky-cta`) / next=demo_first. 2차(중립 표현 — "해석 함수·타입 주석·시험뿐이고 사용자에게 보이는 요소는 바뀌지 않는다"): 결과 risk=R1 / opus / **demo=none** / next=assign → `check.mjs init` → not_required, `check` → `DEMO_GATE_PASSED`(입력 `scratchpad/judge-T-102-intake2.json`). 1차 데모 판정은 **키워드 매칭 오탐**이다(T-099·T-094 와 같은 패턴) — 이 task 는 화면 파일 변경이 없다.
- **Leader override(위험)**: R2 유지 — `src/lib/exchanges/` 가 훅 감시 경로이고 총자산·한도·킬스위치 평가의 입력을 바꾸므로 Reviewer·Codex·QA 를 모두 거친다.

## 진행 기록
- 2026-10-28 00:1x: Leader 접수. 읽기 전용 KIS 1회 조회(CTRP6504R, 숫자 필드만 출력·인증값 비출력)로 응답 구조 확인, 원인 확정.

## Developer

- [00:3x] **Developer(Opus, worktree `t102`, 미커밋) 1~3차** — 변경 3파일: `src/lib/exchanges/kis-overseas.ts`(+120/−16: 분기 1 확장 — margin=`frcr_buy_mgn_amt`(키 없음·공백 = 0, 비숫자·음수 던짐), `net = Math.min(round6(dncl − margin), dncl)`(margin>0 일 때만; margin=0 은 기존 경로 그대로), 정합 검사 5종(행 `evlu ≈ net×환율`·합계 `tota ≈ Σevlu + margin×환율`·교차 `buy_mgn_amt ≈ margin×환율`(margin>0 이면 필수, margin=0 이면 있으면 ≈0)·독립 검산 `tot_asst ≈ evlu_amt_smtl_amt + tot_dncl_amt + Σevlu`(margin>0, ±2원)·체결분 대조 `ustl_buy_amt_smtl ≈ buy_mgn_amt`(margin>0, 필수, ±1원)), `USD_CASH_TOT_ASST_TOLERANCE_KRW=2` export, 반환 선택 필드), `src/lib/exchanges/types.ts`(+11/−2: `usd` 주석을 순예수금으로 정정, 선택 필드 `grossDepositUsd?`·`unsettledBuyUsd?`), 신규 시험 `src/lib/exchanges/__tests__/kis-overseas-usd-cash-unsettled-buy.test.ts`(480줄 101건, 합성 픽스처만). 기존 `kis-overseas-usd-cash.test.ts` diff 0. 분기 2·미결제 매도·그 밖 실패 경로 불변(공통 합계 비교를 각 분기 안으로 옮김 — 검사 항목 줄지 않음).
- **설계와 다른 점(Leader 수락)**: "margin > dncl + 허용오차" 대신 "순예수금(소수 6자리) < 0 이면 던짐"(허용오차 단위(원 vs 달러) 모호성 회피, 더 엄격), margin=0 에서도 `buy_mgn_amt` 가 숫자가 아니면 던짐(키 없음·공백은 통과, 실제 margin=0 캡처와 호환).
- **Leader 추가 지시 2건 반영**: ① 5번째 검사(체결분 대조) 채택 — 미체결 주문 예약금이 증거금에 섞인 상태를 fail-closed 로 막음(Leader 가 실제 응답을 임시 시험으로 대조해 **통과**·`ustl_buy_amt_smtl == buy_mgn_amt` 확인, 임시 파일은 삭제) ② Reviewer F1(`usd` 가 총예수금보다 최대 5e-7 USD 커질 수 있음) → `Math.min` 한 줄 + 재현 입력 시험.
- 소비자 영향(읽기 점검): `portfolio/route.ts`·`portfolio-snapshot`·`portfolio-total`→`order-limits`·`entry-cash-precheck`/`signal-cash-gate`·`kill-switch`·`markets/status` 모두 `usd` 를 순예수금으로 읽어도 맞음(총예수금을 쓰면 한도·현금 게이트가 fail-open 쪽으로 커짐). 선택 필드를 저장·직렬화하는 곳 없음. D1a `broker-ledger/normalize.ts` 는 output1 합과 `evlu_amt_smtl` 만 비교 — 이번 관계 변화의 영향 없음.
- 검증(최종): USD 시험 3파일 177건 통과, tsc 0(시험 파일 임시 tsconfig 도 0), 영역 jest 1,871 통과, **전체 jest 7,905 통과·149 건너뜀·실패 0**(첫 전체 실행에서 `order-sizing.test.ts` 2건이 1회 실패 — 단독 21/21·재실행 통과, 이 시험은 `kis-overseas` 를 import 하지 않음, `[추측]` 부하 타이밍 흔들림, 최종 HEAD 검증에서 다시 확인), 변이 19종(+F1 되돌림) 전부 시험이 잡음. 보고서: scratchpad `t102/dev-report.md`.
- **알려진 한계(숨기지 않는다)**: 매수 체결 직후 증거금(CTRP6504R)이 앱 보유 목록(TTTS3012R)보다 먼저 반영되는 구간이 실제로 있었다(10-27: 증거금 22:47:06·보유 4종목 22:52:40, 약 5분) — 이 구간에서 `usd = 순예수금` 은 총자산을 주문액만큼 **일시적으로 적게(차단 방향)** 잡는다. 과대 계상(fail-open) 경로는 찾지 못했다. 영향: 한도·현금 게이트 일시 축소, 변동폭 가드 오경보(−2%/−4%/−7%) 가능, 그 구간에 저장된 스냅샷 행이 24h 킬스위치 기준선이 되면 24시간 뒤 1회 검사에서 낙폭이 최대 매수 비중(%p)만큼 덜 보일 수 있음(옛 동작은 이 구간이 `usd_cash_unavailable` 로 스냅샷 보류라 왜곡 행이 저장되지 않았다). 지금은 킬스위치 ON 이라 즉시 영향 없음.
- [00:5x] **Developer 4·5차(Codex 높음 채택·주석)** — **환율 타당 범위 검사 도입**: `kis-overseas.ts` 에 `USD_KRW_RATE_MIN = 100`·`USD_KRW_RATE_MAX = 10_000`(KRW/USD, export), 분기 1(margin 0·>0 공통)에서 `rate > 0` 검사 뒤 범위 밖이면 `환율(frst_bltn_exrt)이 타당 범위(100~10000) 밖 (…)` 로 던짐(0·음수는 기존 "양수가 아님" 메시지 유지). 허용오차 ±1원은 환율 100 에서 최대 0.01 USD. **기존 시험은 정확히 1개 (e) 만 수정(+4/−2)** — T-056 라운드 4 의 "환율에 크기 하한을 두지 않는다 — 환율 타당성 범위 검사는 범위 밖" 결정을 **의도적으로 뒤집음**(사유: Codex C2 high — 환율이 양수이기만 하면 극단적으로 작은 값에서 ±1/±2원 검사가 무력화돼 손상된 응답이 과대 계상을 통과시킬 수 있음. 재현: rate=0.000001·dncl=1·margin=0.5·원화 항목 0 → usd=0.5 통과). 새 시험 +11건(경계 100·10000 통과/99.99·10000.01 던짐·margin 0/>0 양쪽·Codex 재현 입력·0/음수는 기존 메시지), 변이 8종 전부 사망. **주석 5차**: 코드 머리 주석 "판정 규칙 1번"을 환율 범위·순예수금 규칙·정합 검사 5종으로 정리(비주석 변경 0 — 새 주석만 되돌리면 직전 sha256 과 정확히 일치), 새 시험 환율 블록 주석 2줄. 기존 시험 303행 블록 주석은 "기존 시험은 (e) 하나만 수정" 지시에 따라 그대로 둠. 최종 변경: `kis-overseas.ts` +145/−19, `types.ts` +11/−2, 기존 `kis-overseas-usd-cash.test.ts` +4/−2, 새 시험 파일(519줄 112건). 최종 검증: USD 시험 3파일 188건·영역 jest 1,882·전체 jest 2회 7,916 통과·실패 0(`order-sizing.test.ts` 흔들림 재발 없음), tsc 0.

## Reviewer

- [00:11] **Reviewer(Sonnet, 독립 감사)** — fail-open 경로 탐색이 핵심. `[확실]` 증명 스케치: 행 검사가 `|net×rate − frcr_evlu_amt2| ≤ 1원` 을 강제해 `usd` 는 KIS 보고값 `evlu/rate` 에서 1/rate USD(약 $0.0008) 이상 벗어날 수 없고, `margin > 0`·`net ≥ 0` 이라 `usd ≤ dncl`. **속성·차분 시험 시드 6개 약 270만 건**(필드 삭제·null·공백·`'abc'`·`'1e3'`·`'-0'`·NaN·Infinity·±0.4~1000원 편차·필드 교환·다통화 행·극단 환율 등 0~3개 변형): 통과 입력의 불변식(`usd ≥ 0`, margin>0 이면 `usd === round6(dncl − margin)`, margin=0 이면 `usd === dncl`·선택 필드 키 없음, 분기 2 는 `usd === 0`) 위반은 F1 외 0건, **margin=0 에서 새 코드가 통과한 모든 입력은 옛 코드와 동일 반환**. 변이 36종 중 35 사망(생존 R14 는 허용치 사슬 차이뿐인 동치). 소비자(`portfolio-total`→`order-limits`·`portfolio-snapshot`·`portfolio/route`·`markets/status`·`signal-cash-gate`)는 순예수금이 맞다(총예수금이면 한도·현금 게이트 fail-open). D1a `normalize.ts` 영향 없음. 설계 이탈 2건·5번째 검사 수락. 범위: 변경 3파일, KIS 호출·주문·설정·킬스위치·소비자 파일 변경 0, 실계좌 수치 없음(합성 픽스처). 실행: 영역 jest 76묶음 1,870 통과·tsc 0.
- [00:11] findings: **F1 낮음(채택·반영)**: `round6` 이 `usd` 를 `grossDepositUsd` 위로 최대 5e-7 USD 올릴 수 있음 → `Math.min(round6(dncl − margin), dncl)` + 재현 시험 / F1b 정보(증거금이 예수금을 1e-8 만 초과하면 `-0` → 통과·`usd=0`, 실질 무해) / F2 낮음(기존 결함): 환율이 극단적으로 작으면(예 0.0001) 모든 ±1원 검사가 무력화 — 별도 후속(환율 하한 가드) / 소비자: **MEDIUM(후속)** — 위 일시 과소 구간의 스냅샷 행이 24h 킬스위치 기준선 오염·변동폭 가드 오경보를 낼 수 있음(옛 동작은 보류라 저장되지 않았음); 완화안(CTRP6504R output1 보유 수 ≠ 앱 보유 수면 unknown)은 두 TR 결합·종목 매칭 규칙 때문에 이번 task 에 넣지 않고 **킬스위치 OFF 전환(11-23 경) 전에 별도 task**, 더 단순한 대안 = `unsettledBuyUsd>0` 스냅샷에 표식을 남겨 킬스위치 기준선 선정에서 제외 / 후속 후보: margin=0 일 때 `ustl_buy_amt_smtl ≈ 0` 요구(H1), 출금가능(`frcr_drwg_psbl_amt_1`)을 `net` 과 대조하는 교차 검사(실제 margin>0 응답에서 이 값이 `net` 과 같음을 Leader 가 확인 — 도입은 선택) / 부수: `net == 0` 이면 스냅샷 USD 행 qty 0 이라 T-080 "USD 가려짐" 판별에 걸릴 수 있음(보류 방향, 킬스위치 ON 이라 즉시 영향 없음).
- [00:3x] Leader 확인: F1 반영분을 diff 로 직접 확인(`Math.min` 한 줄·주석만 바뀐 `types.ts`·시험 1건 추가, margin=0 경로 불변) — 한 줄 보강이라 재감사 없이 통과 판정을 유지한다(Reviewer 가 이 한 줄이 기존 시험 176건과 호환됨을 이미 확인).
- [00:11] **최종 판정: PASS (scope: src/lib/exchanges/kis-overseas.ts, src/lib/exchanges/types.ts, src/lib/exchanges/__tests__/kis-overseas-usd-cash-unsettled-buy.test.ts)**
- [00:50] **델타 재검토(Sonnet)** — 막아야 할 결함 0, 낮음·정보 4(비차단). 속성·차분 시험 **6시드 × 30만 = 180만 건**(환율 극단 1e-9~1e9·0·음수·경계 ±1e-8, 필드 삭제·null·공백·`abc`·NaN·Infinity, ±0.4~1e6원 편차, 필드 교환, 다통화·USD 행 중복, 구조 변형, 곱 보존 스케일, USD 행 없음): 통과 58.7만 건에서 위반 0, margin=0 통과 28.7만 건은 옛 코드와 동일 반환, 분기 2·USD 행 0/2개 이상 43.5만 건은 결과·반환·메시지까지 동일. `[확실]` ① F1: 통과한 모든 입력에서 `0 ≤ usd ≤ dncl` ② 환율 범위: Codex 재현 입력 던짐, 경계 100·10000 통과·99.99·10000.01 던짐(off-by-one 없음), 실측 환율 1332.1·1401.5 통과, 허용오차는 환율 100 에서 최대 0.01 USD(180만 건 최대 관측 0.01), 범위는 USD/KRW 역사(약 900~2,000)의 약 5~9배 여유라 현실적 정상 응답이 새로 막힐 경로 없음 ③ 기존 시험 변경은 **정확히 (e) 1개(+4/−2)**, HEAD 원본 시험을 새 코드에 돌리면 59 통과·1 실패((e)뿐) — 약해진 기존 시험 없음, 주석에 사유 정확 ④ Codex 중간(margin=0 의 `buy_mgn_amt` 검사)은 코드 변경 없이 유지에 동의 — 실제 margin=0 캡처에 `buy_mgn_amt='0'`·`ustl_buy_amt_smtl='0'`, 가장 그럴듯한 불일치(타통화 미결제 증거금)는 옛 코드도 합계 검사로 이미 던졌음, 새로 던지는 사유는 4범주(범위 밖 환율·증거금 형식 이상/음수·margin>0 필수 필드·margin=0 `buy_mgn_amt`)로 전부 분류되고 분류 불가 0 ⑤ 소비자 영향 불변. 변이 15종 전부 사망. 실행: 영역 jest 76묶음 1,882 통과·tsc 0.
- [00:50] findings(비차단): **L1 낮음(후속 task)**: (예수금, 환율)을 곱이 보존되게 함께 손상시키면 범위 안에서 통과(진짜 환율 1400 에서 `dncl=100k`·`rate=1400/k`, k ≤ 14 까지 최대 14배) — 단일 필드 손상으로는 만들어지지 않고 옛 코드는 어떤 k 도 통과시켰음(후퇴 아님), 완전히 막으려면 순수 함수 밖 `getUsdCash` 층에서 앱 자체 환율(`getUsdKrwRate()`)과 ±30% 교차 검증(후속) / L2 정보(반영): 머리 주석에 범위 규칙 누락 → 5차 주석 보강 / L3 낮음 `[추측]`: margin=0 `buy_mgn_amt` 검사는 "미체결 주문 예약금만 output3 에 잡히고 USD 행 증거금은 0" 상태가 실재하면 가용성 손실 — 지금은 모든 신규 매수가 검증 관문으로 막혀 관측 기회 없음, 오류 메시지가 명시적이라 해당 메시지가 로그에 나오면 재검토 / L4 정보: 증거금이 예수금을 5e-7 USD 미만 초과하면 `usd=-0`(무해).
- [00:5x] Leader 확인: 델타 이후 5차 주석 보강은 Developer 가 새 주석만 되돌려 직전 파일 sha256 과 일치함을 확인(비주석 변경 0)했고 이 문장도 diff 로 확인한다 — 통과 판정을 유지한다.
- [00:50] **최종 판정: PASS (scope: src/lib/exchanges/kis-overseas.ts, src/lib/exchanges/types.ts, src/lib/exchanges/__tests__/kis-overseas-usd-cash-unsettled-buy.test.ts, src/lib/exchanges/__tests__/kis-overseas-usd-cash.test.ts)**

## QA

- [01:0x] **QA(Sonnet, 직접 실행, 깨끗한 사본 + 변경 4파일, 최종 기능 버전 sha `kis-overseas.ts` 5b0fd98e…)** — **QA 결과: PASS**. 도중 구현이 바뀌어(환율 범위·기존 시험 (e)) **최종 상태로 2라운드를 전부 다시 실행**: tsc 0(시험 파일 임시 tsconfig 도 0, 일부러 넣은 타입 오류가 잡혀 유효) · USD 시험 3파일 188/188 · 영역 76묶음 1,882 통과 · **전체 jest 2회 모두 296묶음 통과·7,998 통과·149 건너뜀·실패 0**(기준선 base 295묶음 7,886) · `order-sizing.test.ts` 흔들림 재현 못 함(전체 4회+base 1회+단독 5+5회+CPU 14개 부하 단독 5회 모두 통과; 단 Developer 의 "이 시험은 kis-overseas 를 import 하지 않음"은 부정확 — v8 coverage 로 간접 로드되나 변경 함수는 미실행, 흔들림 원인은 `[추측]` 부하 타이밍) · **`next build` 성공**. **종단 시뮬레이션**(HTTP 계층·토큰·환율 소스·DB 풀만 가짜, 실제 `GET /api/portfolio` → `kis.ts` → `getUsdCash` → `parseUsdCashFromPresentBalance` 를 끝까지; 합성값 환율 1300·예수금 1000·증거금 900·앱 환율 1310): (a) 새 코드 200·`total_krw=1,622,000`(보유 1,441,000 + 원화 50,000 + USD 100×1310)·USD 행 qty 100(총예수금 1000 아님)·`cash.USD={known, usd:100, grossDepositUsd:1000, unsettledBuyUsd:900}` (b) **base 에서 같은 입력은 503 + 운영과 같은 문구 "해외 예수금(USD)을 확인하지 못했습니다 — 평가액을 표시할 수 없습니다"** — 수정 전 결함 재현·수정으로 해소 (c) 증거금 0 정상 응답과 증거금 키 없는 과거 모양은 새 코드와 base 가 응답 전체 동일 (d) 어긋난 응답 12종(독립 검산 100원 불일치·체결분 < 증거금(미체결 예약금 모양)·`buy_mgn_amt` 없음/불일치·행이 예전 가정·증거금 > 예수금·증거금 'abc'·합계 불일치·증거금 0 인데 `buy_mgn_amt` ≠ 0·USD 행 2개·환율 0·환율 0.0001) 모두 503 + 같은 오류 문구·`cash.USD=unknown`. 안전장치 입력: 스냅샷 크론이 넘기는 total 1,622,000·USD 행 qty 100·value 131,000, `getMarketTotal` 해외 1,572,000, **`getEffectiveOrderMax('overseas')` 157,200**(총예수금 1000 을 썼다면 약 11.8만원 부풀었을 값), 어긋난 응답에서는 스냅샷 저장 0건·한도 0(차단 방향). **결제 연속성**: 결제 전(예수금 1000·증거금 900)·후(예수금 100·증거금 0) 모두 `usd` 100·`/api/portfolio` 총자산 1,622,000 동일(튀지 않음; base 는 결제 전 unknown). 새 코드가 base 보다 엄격한 입력 3종(증거금>0 인데 행이 예전 가정·증거금 0 인데 `buy_mgn_amt`≠0·환율 0.0001) 모두 fail-closed 방향. 못 한 것: 실 KIS 응답·킬스위치 본체 낙폭 계산(모의)·알려진 한계(약 5분 일시 과소) 재현·D1a 원장·`submitOrder` 회로(이 변경이 닿지 않음). 재현용 임시 시험 2개는 저장소 밖(scratchpad `qa-t102-e2e*.test.ts`).

## 배포 기록

- **2026-10-28 05:11 KST push `61b80c9..5ac9119`(7커밋, [[T-101-settings-post-market-overseas-switch]] 와 같은 배포) → 웹훅 blue/green → `RELEASE_RESULT ok`, 릴리스 `20261028-051140-5ac91195`, `migrated=false`.** 새 `stockinvest` 프로세스 05:12:10·`stockinvest-cron` 05:12:11 기동, 배포 완료 05:12:54.
- 배포 창·사전 점검·롤백은 T-101 `## 배포 기록` 과 동일(킬스위치 ON·주문 id 3229·최근 3시간 주문 0·키 87·health 200·재시작 0).
- **운영 실측 증거(배포 직후 첫 조회)**: 새 프로세스가 뜬 직후 첫 `portfolio-snapshot`(05:12:11)이 **저장 보류 없이 스냅샷 id 5503 을 기록**했다 — 총 19,004,262원, 포지션에 `USD 85.64`(= 총예수금에서 미결제 매수 증거금을 뺀 순예수금, 환율 약 1,327.8)와 `NAS:AAPL 3주` 가 함께 있고, 같은 틱에서 `getBalancesDetailed()` 의 USD 상태가 `known` 이어야만 저장되는 경로라(`portfolio-snapshot/route.ts:140~164`) 수정 전이라면 "USD 예수금 확인 불가"로 보류됐을 입력이다. 직전 스냅샷 5502(22:42, USD 1121.29 gross·AAPL 없음)와 비교하면 (USD 순예수금 + AAPL 평가액) 1,496,919원 ≈ 이전 USD 행 1,486,023원으로 **현금→주식 이동이 합계에서 보존**된다(일시 과소 계상 없음). 마지막 `[kis] overseas usd cash failed` 로그는 05:12:10(옛 프로세스 종료 직전)이고 그 이후 없음. 이 값은 합성이 아닌 운영 실측이다.
- 못 한 것: 로그인한 대시보드 화면을 AI 가 직접 열어 보지는 못함(401, 세션 없음) — 사용자 확인 대상.
- 롤백: `git revert 227c5bf` 후 push. 되돌리면 같은 입력(미결제 매수 상태)에서 대시보드 총자산이 다시 "-" 로 돌아간다.

## Codex 검토

### [2026-10-28 00:2x] C2 review focus=none — done (지적 2건: 높음 1·중간 1)
- judge 판정: `codex_required: true`(`CX-r2-post-review`, 스위치 on) / 이 task 호출 1회 — 입력 `scratchpad/judge-T-102-c2.json`.
- 대상: repo=`/home/brownjeon/.node-local/stockinvest-t102`(미커밋 사본, `node_modules` 링크 제거 후) base=6052525 snapshot=a254e33, 실행 63초.
- 지적 1 **[high] `kis-overseas.ts:338` 환율 검사가 `rate > 0` 뿐이라 양수이되 극단적으로 작은 환율(예: 0.000001)에서 ±1/±2원 절대 허용오차가 1/rate USD 로 무제한 확대 → 모든 정합 검사 무력화, 손상 응답에서 `usd` 과대 계상(재현: rate=0.000001·dncl=1·margin=0.5·원화 항목 0·자산 항등식 0 → usd=0.5 통과, `evlu/rate`=0)**. 권고: 환율 유효 범위 또는 상대오차 상한. → **Leader 채택·반영**: 환율 타당 범위 100~10,000 KRW/USD(분기 1 공통), 허용오차는 환율 100 에서 최대 0.01 USD. T-056 라운드 4 의 "환율 타당성 범위 검사는 범위 밖" 결정(기존 시험 (e))을 이 사유로 의도적으로 뒤집음(기존 시험은 (e) 1개만 수정, Reviewer 델타 재검토 통과).
- 지적 2 **[medium] `kis-overseas.ts:387` margin=0 경로에도 `output3.buy_mgn_amt` 검사가 추가돼 인계의 "margin=0 경로는 정확히 같다"와 어긋나고, 이전에 통과하던 응답이 새로 던져질 수 있음**. → **Leader 판정: 유지(코드 변경 없음)**. 인계 문구가 부정확했고 실제는 "이전보다 엄격한 1검사 추가"다 — 설계 이탈 ②(Developer 제안, 1차 Reviewer 수락)이며 실제 margin=0 캡처(`buy_mgn_amt='0'`)와 호환, 새로 던지는 사유가 4범주로 전부 분류됨(델타 재검토 차분 시험 약 8,000건), 실응답에서 이 검사로 "-" 가 새로 뜰 현실적 경로는 못 찾음(L3 `[추측]` — 해당 오류 메시지가 로그에 나오면 재검토).
- 이 지적 외 Codex 가 확인한 것: 순예수금이 `Math.min` 으로 총예수금을 넘지 않게 제한되고 정상 범위 환율에서 5개 정합 검사가 상호 보완적으로 작동.
- 검토하지 못한 범위(Codex 보고): DB·KIS·네트워크를 쓰는 실응답 검증, 시험 스위트 실행 — QA 가 별도로 실행.
- 원본: `.claude/state/codex-review/runs/20261027T152540Z-T-102-C2/raw.txt`

## 최종 요약

**[T-102] 대시보드 총자산 "-" / "잔고 조회 실패: 해외 예수금(USD)을 확인하지 못했습니다" 수정**

- 상태: 완료·운영 반영(2026-10-28 05:12, 릴리스 `20261028-051140-5ac91195`). 운영 첫 스냅샷으로 동작 확인.
- 원인 [확실]: 앱 밖에서 미국 주식(AAPL 3주, 약 $1,035)을 사서 **결제 전(미결제 매수)** 이던 동안 KIS 해외 체결기준현재잔고 응답이 "예수금(총액)"과 "매수증거금"을 따로 담는 모양으로 바뀌었는데, 기존 검증(T-056)은 "USD 행 평가액 = 예수금 × 환율" 한 가지 모양만 인정해 **정상 응답을 어긋남으로 오판 → 안전하게 '확인 불가'로 막았고**, 그 결과 총자산·보유가 "-" 로 표시됐다. 스냅샷 크론·주문 한도도 같은 이유로 보류 중이었다(차단 방향이라 잘못된 주문은 없었다).
- 무엇이 바뀌었나: 총예수금에서 매수증거금을 뺀 **순예수금**을 USD 현금으로 인정하고, 어긋남을 가려내는 정합 검사 5개(행 평가액·합계·`buy_mgn_amt` 교차·KIS 총자산 항등식·체결 검사)를 새로 두었다. 환율이 100~10,000원 범위 밖이면 거절한다(Codex 높음 지적 반영). 숫자가 어긋나면 이전처럼 "확인 불가"로 막는 방향(fail-closed)은 그대로다.
- 배포: 05:11 push·05:12:54 `ok`, DB 변경 없음, T-101 과 같은 배포.
- AI 가 검증한 것: 실제 KIS 읽기 전용 1회 조회로 응답 구조 확인·합성 시험 112개·전체 jest 296묶음 통과(실패 0)·`next build`·HTTP 계층까지 종단 시뮬레이션(수정 전 코드는 운영과 같은 503/같은 문구를 재현, 수정 후 200)·Reviewer 2라운드 PASS·Codex C2·QA PASS. **운영 실측**: 새 프로세스 기동 직후 첫 스냅샷(id 5503, 05:12:11)이 보류 없이 저장됨(USD 순예수금 85.64 + AAPL 3주, 현금→주식 이동이 합계에서 보존).
- AI 가 못 한 것: 로그인한 앱 화면을 직접 열어 보기, 결제가 끝난 뒤(증거금 0) 실응답 확인, 알려진 한계(아래)의 재현.
- 👉 사용자가 확인할 것: 앱 대시보드를 새로고침해 **총자산 숫자와 보유(AAPL 포함)가 다시 보이는지**(정상: 총자산 약 1,900만 원대, 빨간 "잔고 조회 실패" 문구 없음). 계속 "-" 이면 알려 주세요(앱을 완전히 닫았다 열어야 할 수 있음). 
- 👉 사용자가 확인할 것(별건): **KRW 예수금이 10-27 20:52~22:42 사이 3,100,000원 줄었다**(스냅샷 5501 3,122,342 → 5502 22,342, 보유 증가 없음). 출금·이체로 추정 [추측] — 맞다면 '자산 기록'(입출금 원장, T-074)에 입력돼 있는지 확인. 기록이 없으면 킬스위치 낙폭·수익 계산에 3.1M 손실처럼 잡힌다(킬스위치는 ON 이라 매매 영향은 없음).
- 남은 일(후속 후보): ① 증거금 반영이 보유 목록 갱신보다 먼저 일어나는 약 5분 일시 과소 계상(차단 방향, 가짜 변동폭 알림·킬스위치 기준선 오염 가능 — 이번 건에서는 합계가 보존돼 발생하지 않았음) ② 환율 교차검증(앱 환율 ±30%) ③ 마진 0 인 경우 `ustl_buy_amt_smtl ≈ 0`/출금가능액 교차(선택) ④ `order-sizing.test.ts` 흔들림 관찰(재현 못 함).
- 이슈·위험: 위 한계 외 없음. 킬스위치 ON·실주문 0건 상태에서 반영했다.

## 데모 검토 (demo gate)

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | - |
| - | 작성중 | - | - | judge: delta (DM-kw-risky-cta) | 10-27 23:39 |
| - | 해당없음 | - | - | judge: none | 10-27 23:39 |

---
task_id: T-066
title: 설정 > 리스크 정책 — 손절 기준 한 번에 설정 + 보유 종목별 예상 손절가 실시간 표시 + 손절 합 한도 설정
status: doing
priority: high
roles_involved: [leader, designer, developer, reviewer, qa]
related_tasks: [T-064]
tags:
  - type/task
  - domain/settings
  - domain/risk
aliases:
  - 리스크정책설정
created: 2026-10-22
updated: 2026-10-22
waiting: []
demo_gate:
  required: true
  level: "delta"
  status: "approved"
  version: 3
  repo_path: "mockups/T-066-risk-policy-settings-v3.html"
  artifact_url: "https://claude.ai/artifact/LoHunHkWiSnSBbMpkLkyJf"
  content_sha256: "5f4bf2d9668ee68e2f49958b88e20a5297e860750e58e77db0798be379a07335"
  decided_by: "judge"
  rule_id: "JV-ui_change"
  approved_by: "user"
  approved_at: "2026-10-22T13:22:51+09:00"
  approval_quote: "손절기준가: 권고 구조: A 손절 설정: 손절분할수는 최대 3회로 변경하고 나머지는 권고대로 진행"
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: true
---

# T-066 — 설정 > 리스크 정책: 손절 기준 설정과 예상 손절가 실시간 표시

> 불변 원칙(사용자, 2026-10-22): 이 프로젝트는 수익을 내기 위해 존재한다. 리스크 정책은 *수익을 지키기 위한 손실 통제*이며, 이 화면은 그 정책을 사용자가 항상 볼 수 있게 하는 것이다. 설계 정본: [[T-064-profit-engine-design]] §7.

## 요구 (사용자 원문)

> "한번에 감내할 손해는 2%로 잡아주고 해당내역에 대해서 설정메뉴에서 볼수있도록 해줘" (2026-10-22)
> 보조 입력: 현재 자산 약 2,000만원(미국 70%·국내 30%라고 함), 시장 우선순위 미국 → 국내.

## 해석 (사용자 확정 2026-10-22 "예")

"한 번에 감내할 손해 2%"를 **포트폴리오 전체가 동시에 잃을 수 있는 최대 손실 = 총자산의 2%**(열린 포지션의 손절폭 합, T-064 의 *열(heat) 상한*)로 해석한다. 총자산 21,077,227원(스냅샷 2026-10-22) 기준 약 421,545원.
*단일 거래*의 손실 한도 2%로 읽으면 손절 3%에서 포지션이 총자산의 67%가 되어 "소량 분할·안정 수익" 원칙과 충돌하므로 채택하지 않는다. 다르게 의도했다면 정정을 받는다.

## 범위 (사용자 v2 검토 의견으로 재정의, 2026-10-22)

> "손절가는 한번에 설정해주도록하고 그게 맞춰서 보유 종목에 대한 예상 손절가를 실시간으로 표기해달라는거 였어. 그리고 손실 손절 합에 대한 %도 설정하도록 해주고 변경은 동일하게 리스크정책에서 변경할 수있도록 해줘" — **v2 의 종목별 손절가 수동 입력은 의도와 달랐다(내 오해). 폐기.**

- **한 번에 설정하는 값 3개를 리스크 정책에서 편집**: ① 손절폭 %(모든 보유 종목 공통, 제안 3%) ② 손실 손절 합 한도 %(= 한 번에 감내할 손실, 사용자 확정 2%) ③ 손절 기준가(평균단가 기준 권고 / 고점 대비). ③은 제 가정이라 열린 질문. 나머지 정책 값(최대 10종목·시장 우선순위·현금 하한 등)은 읽기 전용.
- **보유 종목별 예상 손절가를 자동 계산해 실시간 표시**(예상 손절가·현재가·손절가까지 거리·손절 시 손익). 현재가가 이미 손절가 아래면 "이미 손절가 아래"로 표시(자동 매도 아님).
- **손절 합** = 모든 보유 종목이 예상 손절가에 닿을 때 손실의 합. 총자산 대비 %를 한도와 비교하고, 한도를 지키려면 필요한 손절폭 상한(역산)을 보여 준다.
- **변경은 리스크 정책에서만**(안전장치 컨트롤·저장 흐름과 분리), 설정 화면의 안전장치 영역에 추가되는 별도 항목(요약 행 + 리스크 정책 화면).
- **시세**: 스냅샷(시간별) 기준 + 60초 DB 재조회(KIS 호출 없음), 오래됨 기준 3시간 초과(사용자 권고대로 확정).
- **저장소**: `system_config.risk_policy` 한 키(JSON·`version`, `safety_` 접두 금지). 종목별 테이블(`position_stops`)은 **필요 없어졌다 → DDL 없음 목표**(변경 이력은 JSON `history` 로 검토).
- **하지 않는 것**: 주문·청산 엔진과의 연결, 손절가 도달 알림(열린 질문), 수초 단위 시세.

## 진행 기록

- [10-22] 생성. judge 접수·데모 게이트 초기화 예정(화면 변경이므로 데모 승인 뒤에만 화면 코드).

## Designer 기록

- [12:06] 데모 v1 작성 → `mockups/T-066-risk-policy-settings-v1.html` (DEMO_LINT_PASSED, sha256 183ac2206f8a…). 구성: ① 설정 허브 현재 vs 제안(“내 계정” 아래 리스크 정책 요약 행) ② 하위 페이지 `/settings/risk-policy` 8개 상태(계산 불가[현재 실제]·일부 미설정·정상·한도 초과·스냅샷 오래됨·정책 없음·로딩·오류), 412px + 데스크톱(≥900px 2열) ③ 결정 필요 D1(위치: A 허브 행+하위 페이지 권장 / B 페이지 안 카드) · D2(손절가 없을 때: A 계산 불가만 권장 / B 기본 손절 가정 추정치). 검토 요청·Artifact 게시는 Leader.
- [12:06] 디자인 스킬: layout·component·system(부분)·design-review·a11y / 자체 점검 P0 0·P1 0·P2 2(정책 표 '거래당 리스크' 정책값 셀 412px 에서 4줄 줄바꿈 · 데모의 데스크톱은 container query 로 흉내—실구현은 @media), a11y Critical 0·Major 0·Minor 1(사용량 막대는 aria-hidden 이고 같은 내용을 본문 글자로 제공 — role=meter 미사용). 360·412px 8개 상태 가로 넘침 0, 11px 미만 글자 0, 44px 미만 터치 대상 0(본문 안 인라인 링크 제외).
- [12:06] 구현 가이드 초안은 Leader 보고에 포함. 사용자 승인(또는 생략) 전에는 developer 에게 넘기지 않는다.
- [12:12] Leader 정정 요청(designer.md 합성값 규칙)으로 v1 갱신(검토 요청 전): 실제 계좌 값을 전부 합성값으로 교체 — 총자산 20,000,000원·한도 400,000원, 종목 AAA~EEE(AAA 62%·같은 업종 87%·현금 3%·미국 70/국내 30%·5/5 손절가 미설정 유지), 예시 사용량 1.12/1.42/2.66%. 정책 값은 그대로. DEMO_LINT_PASSED, sha256 0c718242b8c4…, 실제 값 grep 0건.
- [12:29] 데모 v2 작성 → `mockups/T-066-risk-policy-settings-v2.html` (DEMO_LINT_PASSED, sha256 96b345bac161…, 실제 값 grep 0건, v1 불변). 사용자 지시 2건 반영: 안전장치 영역에 '리스크 정책' 항목 추가 + 손절가 편집은 리스크 정책 안에서만. 구조 A(안전장치에 요약 행 → /settings/risk-policy 화면에서 편집, 권장)·B(안전장치 안 접힌 카드) 전환. 손절가 입력·삭제·저장(자체 저장 흐름, 낙관적 반영→서버 보정/실패 되돌림/409 충돌), 입력 즉시 파생 값 갱신, 스냅샷 기준 시각·60초 재조회(KIS 미호출)·3시간 초과 오래됨, 손절가 하회·팔린 종목 정리 상태. 브라우저 360·412px 120개 조합 가로 넘침 0·44px 미만 터치 0(입력칸 42px 은 44px 상자 안)·11px 미만 0·콘솔 오류 0.
- [12:29] 디자인 스킬: layout·component·system(부분)·design-review·a11y / 자체 점검 P0 0·P1 0·P2 2(412px 에서 정책 표 셀 줄바꿈 · 데스크톱은 container query 흉내), a11y Critical 0·Major 0·Minor 1(사용량 막대 aria-hidden, 같은 내용 글자로 제공).
- [12:43] 데모 v3 작성 → `mockups/T-066-risk-policy-settings-v3.html` (DEMO_LINT_PASSED, sha256 5f4bf2d9668e…, 실제 값 grep 0건, v1·v2 불변). 사용자 의도 정정 반영: 종목별 손절가 입력 제거 → 리스크 정책에서 손절폭 %·손실 손절 합 한도 %·손절 기준가(평균단가 권고/고점) 3개만 한 번에 설정, 보유 종목 예상 손절가·손절가까지 거리·손절 시 손익·손절 합·한도 사용률·역산 손절폭 x% 를 입력 즉시 계산(안전장치 요약 행 포함). 기본 합성 시나리오 = 5종목 모두 손절가 아래(손절 합 3.36% 한도 초과, x ≤ 1.78%, 평가손 -300만원). 구조 A/B·자체 저장(낙관적 반영/실패 되돌림/409)·60초 재조회(KIS 미호출)·3시간 오래됨 유지. 브라우저 360·412px 60개 조합 가로 넘침 0·터치 42px 미만 0·11px 미만 0·콘솔 오류 0.
- [12:43] 디자인 스킬: 같은 5종 / 자체 점검 P0 0·P1 0·P2 2(412px 보유 종목은 표 대신 3열 dl 목록 — 데스크톱은 table · 고점 기준에서 손절 시 손익이 이익으로 보이는 착시는 D2 에 명시), a11y Critical 0·Major 0·Minor 1(한도 막대 aria-hidden, 수치는 글자로 제공).
- [10-22 12:16] 데모 v1 검토 의견: 손절가 입력을 이 task 에 포함, 위치는 설정 > 안전장치 항목(허브 행 방식 폐기). 게이트 상태 `changes_requested`. 범위가 쓰기(손절가 저장)를 포함하게 되어 judge 재접수.
- [10-22 12:22] 사용자 의견 2(위): 손절가 편집은 리스크 정책에서만·실시간 반영. designer 에게 전달(v2 에 함께 반영). 의견 1·2 모두 v2 로 한 번에 검토 요청 예정.
- [10-22 12:25] 시세 방식 확정(권고대로): 스냅샷 + 60초 재조회, KIS 실시간 시세 제외. designer 에게 전달.
- [10-22 12:30] 데모 v2 완료·검증(lint 통과, sha256 `96b345ba…dfd47`, 실제 값 grep 0건, v1 파일 불변) → 게이트 `review_requested` v2. 구조 A(안전장치 영역에 '리스크 정책' 항목 + 손절가는 `/settings/risk-policy` 에서만 편집, 자체 저장 흐름)를 권고, 구조 B(접힌 카드 안 편집)는 데모에서 전환 비교.
- [10-22 12:37] 사용자 의견 3: 종목별 수동 입력 → 한 번에 설정한 손절 기준으로 예상 손절가 자동 표시, 손절 합 % 도 설정, 변경은 리스크 정책에서. v2 게이트 `changes_requested`, designer 에게 v3 요청. `position_stops` 폐기(DDL 없음).
- [10-22 12:43] 데모 v3 완료·검증(lint 통과, sha256 `5f4bf2d9…7335`, 실제 값 grep 0건, v1·v2 파일 불변) → 게이트 `review_requested` v3. 종목별 수동 입력 폐기, 손절폭·손절 합 한도·기준가 3개를 리스크 정책에서 한 번에 설정, 예상 손절가·거리·손절 시 손익·손절 합·역산 손절폭 실시간 표시. 저장은 `system_config.risk_policy` 한 키(DDL 없음), 변경 이력은 JSON `history` 최근 20건(동시성: version 조건부 UPDATE→409).

## 구현 전 확인 사항 (Leader 가 코드·DB 로 대조한 것, 12:37 갱신)

- [확실] 청산 엔진(exit-engine)의 하드 손절 기준은 **평균단가**(`price ≤ avgEntry × (1 − 손절%)`, 기본 1.5%)다. 이 task 의 기본 기준가도 평균단가로 맞춘다. 단 엔진은 현재 OFF 이고 이 화면의 값과 연결하지 않는다(엔진을 켜면 이 화면의 3%보다 일찍 1.5%에서 팔 수 있어 화면에 안내).
- [확실] `position_state.entry_price` 는 틱마다 갱신된다(`upsertPositionState` ON DUPLICATE KEY UPDATE). 해외는 KIS 의 USD 평균단가(`pchs_avg_pric`)에 **그 시점 환율을 곱한 원화값**이고, 스냅샷 현재가도 같은 방식으로 환산되므로 평가손익률·손절가까지 거리 같은 **비율은 환율 영향이 없다**. 서버는 엔진과 같은 기준(원화)으로 계산한 뒤 스냅샷의 USD 행 환율로 USD 표시한다(두 환율의 시차에서 오는 소량 오차는 허용).
- [확실] 스냅샷 `positions` JSON 에는 평균단가·고점이 없다(`currency`·`qty`·`price`·`value_krw`·`locked` 만). 보유 목록·현재가는 스냅샷, 평균단가·고점은 `position_state` 에서 읽는다. 팔린 종목은 `reconcilePositionState` 가 정리한다(보유 목록이 비면 그 시장 전체를 삭제 — 그래서 사용자 데이터를 `position_state` 에 두지 않는다).
- [확실] `api/settings/safety/` 는 커밋 훅 SAFETY_PATHS 대상이다. 이 기능은 `api/settings/risk-policy/` 로 분리해 훅 밖이다. Reviewer 는 매도 경로(exit-engine·signals)가 `risk_policy` 를 import 하지 않는지 확인한다.
- [계산 사실, 현재 보유] 취득원가 합 약 2,570만원(평균단가 × 수량, 현재 환율 환산). **손절폭 3%이면 손절 합 약 77만원 = 총자산의 3.7%로 한도 2%를 넘는다.** 한도 2%를 지키는 손절폭 상한은 약 **1.6%**(= 2% × 총자산 ÷ 취득원가 합). 엔진 기본 1.5%는 약 1.8%라 이내다. 또 현재 보유 5종목의 현재가는 모두 평균단가 대비 -6%~-53% 라 어느 손절폭에서도 **이미 예상 손절가 아래**다.
- DDL 없음 목표. `system_config` 에 키 하나를 쓰는 것도 개발·운영 공용 DB 쓰기이므로 시딩 방식은 승인 때 정한다.
- 열린 질문: 구조 A/B 선택, 손절 기준가(평균단가 vs 고점 대비), 정책 값 추가 편집 여부, 손절가 도달 알림 여부, 2% 해석(D11).
- [10-22 13:23] **데모 v3 승인**(원문 위 인용) → 게이트 approved v3·active. 승인 수정: 구조 A, 기준가 평균단가, 편집 3값, 분할 최대 3회('손절분할수'를 분할 매수 횟수로 해석 — 분할 손절 매도 의미인지 사용자 확인 대기). Developer 착수.

## 구현 명세 (승인 데모 v3 + 승인 수정, 13:23 확정 — Developer 가 읽는 정본)

**승인**: 2026-10-22 13:22 데모 v3 승인(`mockups/T-066-risk-policy-settings-v3.html`, sha256 `5f4bf2d9…7335`). 사용자 원문: "손절기준가: 권고 / 구조: A / 손절 설정: 손절분할수는 최대 3회로 변경하고 나머지는 권고대로 진행". 데모 파일은 승인 해시가 고정돼 있으니 **수정하지 않는다**. 아래 수정은 구현에서 반영한다.

### 승인 수정 사항 (데모와 다른 점)
1. **구조 A만 구현**(안전장치 영역의 '리스크 정책' 요약 행 + `/settings/risk-policy` 화면). 구조 B(접힌 카드 편집)는 만들지 않는다.
2. **손절 기준가 기본값 = 평균단가(`avg`)**. 고점(`peak`)은 편집 가능한 선택지로 유지.
3. **편집 가능한 값은 3개뿐**: 손절폭 %(기본 3), 손실 손절 합 한도 %(기본 2, 사용자 확정), 손절 기준가. 나머지는 읽기 전용.
4. **분할 횟수 2 → 3**: 읽기 전용 정책표의 '분할 매수 최대 2회 (60/40)' 를 **'최대 3회'** 로 바꾼다(출처 배지는 '사용자 확정', 비율은 제안 40/30/30). 해석 주의: 사용자가 '손절분할수'라고 했고 데모의 유일한 분할 항목을 바꾸는 것으로 해석했다. *분할 손절 매도*(손절가에서 여러 번에 나눠 청산)를 뜻한 것일 수 있어 사용자 확인 대기 — 이 task 는 표시용 값만 바꾼다(집행 없음).
5. 알림·자동 매도·엔진 연동 없음. 화면의 안내 문구(표시·위험 계산 전용, 자동 청산 엔진과 별개)를 유지한다.

### 계산 (공용 순수 함수 `src/lib/risk/compute.ts`, 서버·클라이언트 공용, DB/fetch/Node 전용 API 금지)
- 입력: `holdings[{symbol, market, qty, avgKrw, peakKrw, priceKrw}]`, `totalKrw`, `fx`, `policy{stopPct, heatCapPct, stopBasis}`. **원화로 계산**(청산 엔진과 같은 기준)하고 표시 때만 USD 로 환산(미국: `원화 ÷ fx`, 센트 반올림).
- 기준가 ref = `avg`면 avgKrw, `peak`면 peakKrw. **예상 손절가 = ref × (1 − 손절폭/100)**. 손절 시 손익 = (예상 손절가 − avgKrw) × qty.
- **손절 합 = Σ max(0, (avgKrw − 예상 손절가) × qty)** (손실만 합산). 한도 금액 = 한도% × totalKrw. 사용률 = 손절 합 ÷ 한도 금액, 초과 = 사용률 > 100%.
- 현재가 ≤ 예상 손절가 → '이미 손절가 아래'(거리는 손절가 기준 "손절가보다 x% 낮음", 평가손익 금액·% 함께). 위 → "현재가에서 남은 폭", 1% 이내면 '손절가 근접'. 평가손 합계는 '이미 아래' 종목들의 (현재가 − 평균단가) × 수량 합.
- 역산 손절폭 상한: `avg` → `한도% × totalKrw ÷ Σ(avgKrw × qty)`(0.01% 단위 내림), `peak` → 이분법. 데모 JS 의 `stopOf`·`compute`·`gapsList` 가 기준 구현이다.
- 평균단가·고점이 없는 종목은 '계산 불가'. 손절 합·사용률은 계산 가능한 종목만으로 하고 '일부 계산 불가' 표시.

### 데이터 출처 (KIS 호출 금지)
- 총자산·보유 목록·수량·현재가 = 최신 `portfolio_snapshots`(`total_krw`, `positions` JSON, `ts`). 주식 행은 `currency` 필드에 **심볼**이 들어 있고(`NAS:MU` 등) 현금 행은 `KRW`/`USD`. 환율 = `USD` 행의 `price`.
- 평균단가·고점 = `position_state.entry_price`·`peak_price`(틱마다 갱신, 해외는 USD 평균단가 × 그 시점 환율의 원화값, 현재가도 같은 방식 환산이라 **비율은 환율 영향 없음**).
- 스냅샷 오래됨 = `now − ts > 3시간`.

### API (모두 `src/app/api/settings/risk-policy/`, `/api/settings/safety` 와 분리)
- `GET /api/settings/risk-policy` → `{ ok, data:{ enforcement:'display_only', policy|null, snapshot:{at, stale, totalKrw, cashKrw, fx}, holdings:[…], computed } }`. DB 만 읽는다. `policy=null` 이면 '정책 값 없음'(제안값으로 미리보기, 처음 저장 안내)과 HTTP 실패('조회 오류')를 **구분**한다.
- `PUT /api/settings/risk-policy` body `{ stopPct, heatCapPct, stopBasis, baseVersion }`. 검증: `stopPct` 0.5~20(10 초과는 저장하되 warning), `heatCapPct` 0.5~10, `stopBasis` ∈ `avg|peak`, 소수 2자리 반올림, `baseVersion` 불일치 **409**+최신 정책. 성공 시 GET 과 같은 `data` 반환. 처음 저장(정책 없음)은 기본 읽기 전용 값까지 포함한 전체 JSON 을 쓴다.
- 클라이언트: 열 때 1회 + **60초마다 재조회**(`cache:'no-store'`, 탭 숨김 시 중지), 입력 즉시 클라이언트 계산(저장 전 값 표시), 저장은 낙관적 갱신 후 서버 응답으로 보정, 실패 시 되돌림+입력값 유지, 409 는 '서버 값 쓰기 / 내 값으로 저장' 선택.

### 저장소 (DDL 없음)
`system_config` 키 **`risk_policy`** 하나(JSON, `safety_` 접두 금지)에는 **편집 가능한 값만** 저장한다: `{version, updatedAt, stopPct, heatCapPct, stopBasis, history:[최근 20건]}`. **읽기 전용 값(maxHoldings 10, marketPriority [overseas, domestic], tradeRiskPct 0.25, cashFloorPct 10, symbolMaxPct 15, weeklyLossPct -3, monthlyLossPct -5, annualLossPct -15, splitBuy {max 3, ratio [40,30,30]})과 출처 배지는 `src/lib/risk/defaults.ts` 상수에서 읽을 때마다 응답에 포함**한다(사용자가 현금 하한 등을 곧 바꿀 수 있어 낡은 값이 DB 에 굳지 않게 — 13:3x 명세 조정). 동시성: `UPDATE system_config SET value=? WHERE key='risk_policy' AND JSON_EXTRACT(value,'$.version')=?`, 영향 행 0 이면 409(첫 저장은 INSERT … 중복이면 409). 시딩 없음 — 사용자가 처음 저장할 때 생긴다.

### 파일
- 수정: `src/app/settings/SettingsPage.tsx`(안전장치 카드 맨 위 '● 집행 중' 띠 + 카드 뒤 `<RiskPolicySummaryRow />`; 기존 `Promise.all`·`handleSave`·저장 바는 그대로), `docs/screens.md`(설정 절을 실제 구조로).
- 신규: `src/app/settings/risk-policy/{page,RiskPolicyPage}.tsx`, `src/app/settings/RiskPolicySummaryRow.tsx`, `src/components/risk/*`(설정 폼·결과·종목 표·정책표·StatusText·SourceBadge), `src/lib/risk/{compute,defaults,policy-store}.ts`, `src/app/api/settings/risk-policy/route.ts`, 시험.
- 디자인: 승인 데모 v3 의 토큰·마크업·문구를 그대로 따른다(`--up`/`--down` 사용 금지). 412px 완결, 900px+ 에서만 데스크톱 표.

### 금지
KIS/외부 호출, `position_state`·`orders`·`signals` 쓰기, `exit-engine`·`signals`·`safety` 경로가 `risk_policy` 를 import/읽는 것, 스키마 변경, `/api/settings/safety` 수정, 다른 세션의 미커밋 변경 파일(`credentials/test/route.ts` 등) 수정, 커밋·push·배포.

### 시험·완료 기준
`compute.ts` 단위 시험(데모 JS 의 기본 시나리오 값: 손절 합 3.36%·사용률 168%·역산 x ≤ 1.78%·손절가 아래 5종목 평가손 -3,000,000원, 손절폭 1.5%→1.68% 등 손계산 + 경계: 고점 기준 이익 구간, 평균단가 없음, qty 0, totalKrw 0), 라우트 시험(null 정책, 저장, 검증 오류, 409, 반올림, history 20 상한), 화면 시험(주요 상태), 설정 화면 회귀. tsc/jest 는 내 파일 기준으로 판정하고 다른 세션 변경 때문에 생기는 오류는 보고만 한다. `check.mjs check --task <이 task>` PASS.
- [10-22 13:26] 사용자 답변: 계좌 밖 국내 자산 없음(D9 확정), 추가 200만원은 *추가 투자 목적*(현금 보유 아님 → 현금 하한 10% 정책과 충돌, D12). 명세 조정: 읽기 전용 정책 값은 DB 에 저장하지 않고 `defaults.ts` 에서 읽는다(Developer 에게 전달).
- [10-22 13:46] 2% 해석 확정(사용자 "예"): 포트폴리오 전체가 *동시에 손절될 때 손실의 합*의 상한. 구현 명세 변경 없음.

## Developer

- [13:55] 구현 완료(미커밋·git index 무변경). demo-gate `DEMO_GATE_PASSED` · approved v3 · hash verified. **명세 조정 반영**(읽기 전용 값은 DB 에 저장하지 않고 `defaults.ts` 상수에서 매번 응답 — 저장 JSON = `{version, updatedAt, stopPct, heatCapPct, stopBasis, history≤20}`).
- [13:55] 신규: `src/lib/risk/{defaults,compute,policy-store}.ts` · `src/app/api/settings/risk-policy/route.ts`(GET/PUT) · `src/app/settings/risk-policy/{page,RiskPolicyPage}.tsx` · `src/app/settings/RiskPolicySummaryRow.tsx` · `src/components/risk/{RiskStyles,StatusText,SourceBadge,EnforcedStrip,RiskSettingsForm,RiskResult,HoldingsStops,ReadOnlyPolicyTable,RiskSummary,FreshLine,useRiskPolicyFeed,draft,fmt}` · 시험 5개(`src/lib/risk/__tests__/{compute,isolation}.test.ts`, `src/app/api/settings/risk-policy/__tests__/route.test.ts`, `src/app/settings/risk-policy/__tests__/risk-policy-render.test.ts`, `src/app/settings/__tests__/settings-risk-row.test.ts`). 수정: `src/app/settings/SettingsPage.tsx`(+8줄: import 2·집행 중 띠·요약 행), `docs/screens.md`(설정 절).
- [13:55] 명세와 다른 점·가정: ① 버전 비교 SQL 을 `CAST(JSON_EXTRACT(value,'$.version') AS UNSIGNED) = ?` 로 명시 캐스팅(실 DB 동작 확인은 권한 거부로 못 함) ② 데모의 container query → `@media (min-width:900px)`, 데모 CSS 는 `.rp` 범위 `<style>` 로 주입(전역 CSS·jest 설정 무변경) ③ 카드 저장 바 sticky bottom 에 하단 탭 높이(`--nav-h`+safe-bottom)를 더함(데모 8px 그대로면 탭에 가림) ④ `.pv` 배지 색은 데모 전용 토큰 `--note` 대신 `--muted` ⑤ 안내 문구 '자동 청산 엔진(지금 OFF…)'을 사실대로 쓰려고 GET 이 `readExitEngineSwitch()`(엔진과 같은 판독기, 읽기 전용)로 `exitEngine.enabled` 를 함께 준다 — 방향은 risk→exit-switch 한쪽뿐 ⑥ 데모에 없는 상태 3개를 최소 문구로 추가: 스냅샷 없음 warnbox · 종목별 '계산 불가'(평균단가/고점/현재가 없음) · '일부 계산 불가 N종목' ⑦ 고점 기준은 데모처럼 max(고점, 현재가) ⑧ 반올림 후 범위 검사(0.499→0.5 통과) ⑨ PUT 은 숫자만 받음(문자열 "3" 은 400) ⑩ 종목명은 표시하지 않고 티커(`MU`·6자리)만.
- [13:55] 검증: 내 시험 140/140(compute 39·route 27·render 23·isolation·settings 회귀 4·기존 settings 2 파일). 격리 사본(`git archive HEAD` + 내 파일, node_modules 링크): **tsc 0 오류 · jest 196 스위트 4,580/4,580 통과**. 작업 트리 전체 tsc 오류 4건은 다른 세션 변경(`@workspace/api-usage` 미해결 — `src/lib/api-usage.ts`·`claude-cli.ts`·`ai-filter.ts`) 탓, 작업 트리 전체 jest 실패 다수도 같은 원인(보고만, 미수정). eslint(next core-web-vitals+typescript): 내 파일 0 오류, SettingsPage 기존 경고 4건만.
- [13:55] 렌더: 합성 데이터로 실제 컴포넌트를 정적 렌더(+globals.css+RISK_CSS)해 Playwright 로 5상태(정상·잘못된 입력/고점·미저장·409+오래됨·원격 변경+실패) × 360/412/1180px 점검 — 가로 넘침 0 · 11px 미만 글자 0 · 44px 미만 터치 0 · 모바일 목록/데스크톱 표 전환 정상. dev 서버+실 DB 렌더는 하지 않음(운영 데이터 읽기 권한 거부·세션 필요).
- [13:55] 금기: KIS 호출 0 · position_state/orders/signals 쓰기 0 · DDL 0 · `/api/settings/safety` 무수정 · 운영 DB 쓰기 0(시험은 가짜 DB) · git index 무변경 · 데모 v1~v3 무수정. SAFETY_PATHS 겹침 없음(새 경로 `src/lib/risk/`·`src/components/risk/`·`src/app/api/settings/risk-policy/`·`src/app/settings/**` 모두 목록 밖). 단 route 가 SAFETY 경로의 `src/lib/strategy/exit-switch.ts` 를 **import(읽기)** 한다.
- [13:55] Reviewer 중점: ① `policy-store.ts` 저장 동시성(읽기→조건부 UPDATE·INSERT 중복키→409, CAST 비교가 MariaDB 에서 기대대로인지) ② `RiskPolicyPage.tsx` 저장/재조회 상태 기계(낙관적 반영·실패 되돌림·409·편집 중 원격 변경) ③ `compute.ts` 계산식이 데모 v3·명세와 같은지(손실만 합산·역산·no_price 행을 손절 합에는 넣고 거리에서는 뺀 처리).
- [13:55] 열린 문제: 실 DB 에서 GET 1회·PUT 0회 확인 필요(QA, 운영 DB 쓰기는 사용자 승인 사항) · '손절분할수' 해석(분할 매수 3회로 표시만) 사용자 확인 대기 · 저장된 risk_policy 가 손상되면 GET/PUT 모두 500(수동 복구 필요).
- [14:30] Reviewer CONDITIONAL_PASS 수정 반영(미커밋·index 무변경): **M-1** 상태 전이를 순수 함수 `src/components/risk/policy-state.ts`(applyFeedPolicy·beginSave·classifySave·finishSave·cancelEdit·takeServer·keepMine·isStaleVersion)로 빼고 `RiskPolicyPage.tsx` 는 단일 상태+이 함수들만 호출, 버전 후퇴 가드(수신 version ≤ 화면이 아는 최대 version 이면 무시)를 페이지(applyFeedPolicy)와 피드 훅(`useRiskPolicyFeed.ts` maxVersionRef — 재조회·replace 모두) 두 곳에 넣음, 시험 `src/components/risk/__tests__/policy-state.test.ts`(늦은 v1 무시·편집 중 원격 충돌·조용히 반영·실패 되돌림+입력 유지·409·타임아웃 등 26건) · **M-2** `isolation.test.ts` 를 src 전체 걷기+허용 목록(risk 자신·SettingsPage·RiskPolicySummaryRow·risk-policy 화면/API·시험) 방식으로, 바늘에 상대경로 import·동적 import·`@/components/risk`·API 경로 추가, 'strategy 에서는 exit-switch 하나뿐'·'쓰기 SQL 대상은 system_config 뿐'·'SettingsPage 의 risk import 2개' 단언 · **L-3** parseStored 범위 검사(LIMITS 밖이면 invalid) + 500 문구에 복구 안내(`RECOVERY_HINT`) · **L-4** parsePct 쉼표 입력 거절 · **L-5** takeServer/keepMine 이 saveState·오류 정리, PUT 15초 AbortController 타임아웃→실패 처리, dirtyCount 반올림 후 비교(3.001=3 은 변경 아님) · route 에 `readExitEngineSwitch().catch(→OFF)` 한 줄 · compute 경계 시험 4건(근접 1% 경계·사용률 정확히 100%·역산 20 캡·round2 1.005). 결과: 내 파일 8 스위트 181/181, 격리 사본 tsc 0·jest 197 스위트 4,621/4,621, eslint 내 파일 오류 0, 작업 트리 tsc 4건은 기존 타 세션 원인 그대로. 손대지 않음: L-1·L-2·L-6.

## Reviewer

- [14:05] 감사 범위·방법: 변경 파일 전부 정독(route·policy-store·compute·defaults·화면 컴포넌트 13개·시험 5개·SettingsPage diff·docs/screens.md diff) 후 승인 데모 v3 의 JS(`stopOf`·`compute`·`validate`·`roHtml`)·문구와 대조. 코드·시험·데모는 수정하지 않았다(변이 시험은 스크래치패드 복사본에서만 실행).
- [14:05] 직접 실행: 내 시험 6개 스위트 123/123 통과(Developer 보고 '140/140' 은 합산이 틀렸다 — 파일별 isolation 13·render 23·settings-row 4·route 27·patch-setting 17·compute 39 = 123, 전부 통과) · tsc 전체 4건은 전부 타 세션(`@workspace/api-usage` 미해결 — `api-usage.ts`·`claude-cli.ts`·`ai-filter.ts`)이고 내 파일 0건 · eslint(next core-web-vitals 임시 설정) 내 파일 실오류 0(시험 한 줄의 `@typescript-eslint` 비활성 주석은 임시 설정에 플러그인이 없어 나온 가짜 오류) · 전체 jest 46 스위트 실패는 전부 타 세션 변경 탓(`api-usage` 미해결 124건 언급)이며 risk·settings 관련 실패 0.
- [14:05] 데모 게이트: `check.mjs check` 통과(approved v3, hash verified, sha256 `5f4bf2d9…7335` 직접 대조 일치, mockups v1~v3 미수정). `evidence.jsonl` 승인 줄의 quote_sha256 이 사용자 원문 해시와 일치하고 `prompts.jsonl` 에 같은 시각(13:21:43) 사용자 입력이 실재 — 에이전트가 대신 승인한 흔적 없음. 데모 대비 차이 분류: container query→`@media 900px`·sticky 저장 바에 하단 탭 높이 가산·`--note`→`--muted`·'(예시)'→'(스냅샷)'·스냅샷 없음 warnbox·종목별 계산 불가·엔진 ON 일 때 안내 문구 = implementation(허용). 분할 매수 2→3회·출처 '사용자 확정'·구조 A 만·기준가 기본 평균단가·편집 3값 = 승인 수정 그대로. material·defect 없음. 단 데모에 없던 새 문구(스냅샷 없음 warnbox, 엔진 ON 문구)는 Leader 가 인지할 것.
- [14:05] 격리(최우선) — 확인: ① risk 모듈의 쓰기 SQL 은 `INSERT INTO system_config`·`UPDATE system_config` 2건뿐이고 둘 다 `risk_policy` 키 한정 ② position_state·portfolio_snapshots 는 SELECT 만, orders·signals 접근 0 ③ KIS·거래소·`submitOrder` import 0 ④ 저장소 전체 grep(`src`·`scripts`)에서 `risk_policy`·`lib/risk`·`RISK_POLICY_KEY` 참조는 risk 파일·SettingsPage·시험·docs 뿐, strategy·signals·safety·exchanges·cron·orders 쪽 참조 0 ⑤ `/api/settings/safety` 무수정, `getOverrides` 의 `LIKE` 패턴(safety_/strategy_/vol_guard_/report_trade_/notify_signal_)에 `risk_policy` 키가 걸리지 않고 키 전체를 훑는 조회도 없음 ⑥ SAFETY_PATHS 와 겹치는 변경 파일 0(커밋 훅 대상 아님) ⑦ 인증: `middleware.ts` matcher 가 `/settings/risk-policy`·`/api/settings/risk-policy` 모두 세션 검증(API 는 401 JSON)으로 보호.
- [14:05] exit-switch import 편차 판정 = 허용(조건부). 근거: `readExitEngineSwitch()` 는 `getPool()`·query 가 try 안에 있어 throw 하지 않고(DB 오류→`enabled:false` 로 수렴), `system_config` 2키 SELECT 1회뿐이며 캐시·타이머·네트워크·쓰기 없음. 모듈 부작용은 해석 불가 값 1회 `console.error` 뿐. 방향은 route→exit-switch 한쪽이고 exit-switch 가 의존하는 `safety/flags` 는 import 0 인 순수 파서라 순환 없음. 엔진과 같은 판독기를 재사용하므로 '지금 OFF' 안내가 엔진 실제 값과 어긋날 수 없다(직접 SQL 로 중복 구현하면 fail-closed 규칙이 갈라질 위험이 더 큼). 실DB 읽기로 `exit_engine_enabled` 가 유효 JSON `false` 임도 확인. 조건: (a) isolation 시험에 'risk 파일이 `@/lib/strategy` 에서 가져오는 것은 `exit-switch` 하나뿐' 단언 추가 (b) 선택: route 에서 `.catch(() => ({ enabled: false }))` 방어 한 줄(현재는 throw 안 하므로 필수 아님).
- [14:05] 동시성(실DB 읽기 전용 확인, SET SESSION TRANSACTION READ ONLY·쓰기 0): MariaDB 10.11.11, `system_config.value` 는 longtext NOT NULL(JSON 별칭). `CAST(JSON_EXTRACT('{"version":3}','$.version') AS UNSIGNED)` = 3, 따옴표 문자열 `"3"` 은 0 — 앱은 version 을 숫자로 저장하므로 Developer 의 명시 캐스팅이 기대대로 동작한다. 조건부 UPDATE 는 PK 행 잠금 후 재평가라 같은 version 두 요청 중 하나는 영향 0행→409, INSERT 경합은 PK 중복(errno 1062)→409. `risk_policy` 행은 아직 0건(미저장 상태). 스냅샷 `positions` 는 문자열로 와서 `JSON.parse` 분기가 실제로 쓰이고, 보유 5종목의 심볼 형식이 정규식과 맞으며 `position_state` 5/5 일치.
- [14:05] 계산·의도 일치: 예상 손절가=기준가×(1−손절폭), 손절 합=Σmax(0,(평균단가−손절가)×수량), 사용률, 이미 손절가 아래 `≤`, 거리 정의(위: (현재가−손절가)÷현재가, 아래: (손절가−현재가)÷손절가), 역산 손절폭(평균단가 폐쇄식 0.01% 내림·고점 40회 이분법, 상한 20), 현재가 없는 종목(손절 합엔 넣고 거리는 모름)이 데모 JS·명세와 같다. 편집 가능한 값은 손절폭·한도·기준가 3개뿐이고 PUT 은 그 3개와 baseVersion 외 필드를 무시하며, 읽기 전용 값·출처는 응답마다 `defaults.ts` 에서 채워 DB 에 저장되지 않는다(시험이 저장 JSON 키 6개를 단언). 차이: 데모는 예상 손절가를 원/센트로 반올림해서 합산하고 구현은 정밀 산술(표시만 반올림) — 데모 기본 시나리오 값(3.36%·168%·1.78%·-3,000,000원)은 시험으로 재현되므로 implementation.
- [14:05] 변이 시험(스크래치패드 복사본, compute.ts 24종): 18종 사망, 생존 6종 = 근접 임계 1%→2% · `over` `>`→`>=`(손절 합=한도 정확 일치) · 평균단가 기준 역산 상한 20 캡 제거 · `round2` 의 EPSILON 보정 제거(`' 2.345 '` 케이스가 보정 없이도 2.35 가 나와 변별 못 함) · 취득원가에 현재가 없는 종목 포함(동치에 가까움) · 평가손 합 음수 한정(평균단가 기준에서는 동치). 계산식·부호·분모·경계 대부분은 시험이 잡는다.
- [14:05] **발견 M-1 (Medium, 가능성 높음 — 코드 정독, 브라우저/DOM 시험 환경이 없어 재현 실행은 못 함)** `src/app/settings/risk-policy/RiskPolicyPage.tsx:54-70`(`onData`) + `src/components/risk/useRiskPolicyFeed.ts:61-85`: 오래된 재조회 응답이 방금 저장한 값을 되돌린다. 순서: ① 60초 재조회 GET 이 비행 중(서버가 정책 v1 을 읽음) ② 사용자가 저장 → PUT 이 v2 로 확정, 응답 도착, `saved=v2`·`saveState='saved'` ③ 그 뒤 GET 응답(v1) 도착 → `saveState` 가 더 이상 'saving' 이 아니라 가드를 통과하고, `:59` 는 version '같음'만 걸러서 v1≠v2 → `edited()` 거짓(초안=저장값) → `setSaved(v1)`·`setDraft(v1)`·`saveState='idle'`·"다른 기기에서 저장한 값을 반영했습니다(버전 1)" 안내. 결과: 화면이 옛 값·옛 버전으로 후퇴하고 다음 저장은 baseVersion 1 로 가서 409. DB 는 정상이고 다음 60초 재조회에서 자가 복구, 매매 영향 없음. 확률은 낮다(GET 소요 ÷ 60초, 저장 클릭과 겹쳐야 함). 권고: `onData` 에서 `sp && sp.version < (cur.saved?.version ?? 0)` 이면 무시(버전은 단조 증가) + 이 판정을 순수 함수로 빼서 시험. 저장/재조회 상태 기계(`onSave` 낙관적 갱신·실패 되돌림·409·원격 변경)에는 시험이 0건이다 — 화면 시험이 전부 `renderToStaticMarkup` 정적 렌더라 상태 전이는 한 번도 실행되지 않는다(jsdom·testing-library 없음). 최소한 `onData` 결정과 `onSave` 결과 처리(200/409/실패)를 순수 함수/리듀서로 빼서 단위 시험할 것.
- [14:05] **발견 M-2 (Medium)** `src/lib/risk/__tests__/isolation.test.ts:21-29`: 격리 시험이 이 기능의 유일한 기계적 보호인데 구멍이 있다. ① 감시 폴더가 10개뿐 — `lib/notify`(텔레그램 승인→주문 경로)·`lib/analyst`·`app/api/analyst`·`app/api/settings/{strategies,hybrid,credentials,blocked-symbols}`·`app/api/profile/kis`·`instrumentation.ts` 가 빠짐 ② 바늘이 `@/lib/risk`·`lib/risk/`·`risk_policy`·`RISK_POLICY_KEY` 인데 상대경로 `'../risk/compute'`(`lib/risk/` 를 포함하지 않음)로 import 하면 통과한다. 지금은 저장소 전체 grep 으로 실제 참조가 0건임을 내가 확인했으므로 현재 결함은 아니다. 권고: `src` 전체를 걷되 허용 목록(risk 파일 자신·SettingsPage·RiskPolicySummaryRow·시험)만 제외하고, 바늘에 `/risk/(compute|defaults|policy-store)` 와 `from '\.\.?/.*\brisk\b` 류 상대경로 패턴 추가. (+ exit-switch 판정 조건 (a))
- [14:05] 발견 L-1 (Low) `src/lib/risk/policy-store.ts:179,187,210`: 미국 종목은 평균단가(`position_state.entry_price`, 마지막 엔진 틱 시점 환율×USD 평단)와 현재가(스냅샷 시점 환율×USD 현재가)의 환율 시점이 달라 '손절가까지 거리'·'이미 손절가 아래' 판정에 환율 변동분만큼 오차가 낀다(미국 장 마감 후 최대 며칠, 환율 0.3~1% 수준 추정 — 실측 못 함). Leader 명세의 '비율은 환율 영향이 없다'는 두 환율이 같은 시점일 때만 참이다. 표시 전용이라 매매 영향은 없다. 권고: 화면 안내에 한 줄 또는 후속 task 로 USD 기준 계산.
- [14:05] 발견 L-2 (Low) `route.ts:123-135`: 저장(UPDATE/INSERT)이 커밋된 뒤 응답용 `buildData`(스냅샷·position_state 조회)가 실패하면 500 을 돌려준다. 화면은 '저장하지 못했습니다'로 되돌리지만 DB 에는 이미 저장돼 있어 '다시 시도'가 409 가 된다(복구 가능, 확률 극히 낮음). 권고: 커밋 후 조회 실패는 정책만 담은 200 으로 응답하거나 클라이언트가 실패 시 재조회로 대조.
- [14:05] 발견 L-3 (Low) `policy-store.ts:36-60`·`route.ts:69-74`: 저장 JSON 이 의미상 손상되면(수동 편집 등) GET·PUT 모두 500 이고 화면에서 복구할 길이 없다. MariaDB 가 `JSON_VALID` 를 강제해 구문 손상은 못 들어가므로 수동 편집 외 경로가 없어 수용 가능. 다만 오류 문구에 복구 방법이 없다(`DELETE FROM system_config WHERE key='risk_policy'` 후 재저장). `parseStored` 가 범위(`stopPct`·`heatCapPct` 가 LIMITS 안인지)를 검사하지 않아 수동으로 0 이나 100 이상을 넣으면 `computeRisk` 에서 0 나눗셈/`Infinity` 표시가 난다 — 범위 밖도 invalid 로 취급 권고.
- [14:05] 발견 L-4 (Low) `compute.ts:247`: `parsePct` 가 쉼표를 천 단위 구분으로 지워 `1,5` → 15 가 된다(데모의 `num()` 과 같은 동작이라 편차는 아니다). 손절폭 15% 는 범위 안이라 경고(10% 초과)만 뜨고 저장된다. 퍼센트 값에는 천 단위 구분이 필요 없으니 쉼표 포함 입력은 오류 처리 권고.
- [14:05] 발견 L-5 (Low) `RiskPolicyPage.tsx:94-103`: `onTakeServer`·`onKeepMine` 이 `saveState` 를 되돌리지 않아 'failed' 상태에서 원격 값을 받아들이면 '저장하지 못했습니다…입력한 값은 그대로' 막대가 남는다(다시 시도는 변경 0건이라 무동작). 같은 파일 `:118` PUT 에 타임아웃·AbortController 가 없어 응답이 안 오면 'saving'(입력 잠금·재조회 중지)이 브라우저 포기 때까지 이어진다. `draft.ts:44-51` 은 `3.001` 같은 입력을 변경 1건으로 보지만 반올림하면 값이 같아, 저장 시 값 동일 상태로 version·history 만 올라간다.
- [14:05] 발견 L-6 (Low, designer 몫 — Leader 경유) `components/risk/RiskResult.tsx:19`(`BelowBox`): 고점 기준에서는 손절가 아래인데 평균단가보다 이익인 종목이 생기는데(예: 평단 100·고점 200·현재 150) '평가손 합계'와 "실제 손실이 이미 손절 기준보다 큽니다"가 거짓이 된다. 데모 v3 의 같은 문구를 그대로 옮긴 것이라 구현 결함은 아니고 기준가 '고점'을 선택했을 때만 해당한다.
- [14:05] 발견 Info: 응답 `error` 에 `e.message` 를 그대로 싣는 것은 다른 `/api/settings/*` 라우트와 같은 관례(변경 불필요). GET 응답의 `policy.history`·`policy.readOnly`·`policy.sources` 는 화면이 쓰지 않거나 최상위와 중복(페이로드 약간 낭비). 인증은 전역 세션뿐이고 계정 단위 구분이 없는 것은 기존 `/api/portfolio`·`system_config` 설정과 같은 전제(단일 KIS 계정). 해외 정규식은 `kis-symbols.ts` 와 같은 값을 의도적으로 복제(거래소 import 금지). XSS: 모든 출력이 React 텍스트 노드이고 `dangerouslySetInnerHTML` 은 상수 CSS 한 곳뿐. `--up`/`--down` 사용 0, 표시 전용 문구(상단 띠·배지·저장 바 부제·안내 상자)는 로딩·오류 상태에서도 유지. 실제 계좌 값·종목은 코드·시험 픽스처에 없음(합성 AAA~EEE, 환율 1,250; `fmt.ts` 주석의 예시 티커 하나뿐).
- [14:05] QA 에 넘길 high_risk_areas: ① `RiskPolicyPage.tsx:54-148` 저장·재조회 상태 전이(특히 M-1 수정 뒤 stale 응답, 409, 원격 변경) ② 실DB GET 1회(읽기)·PUT 은 운영 DB 쓰기라 사용자 승인 후 1회(첫 저장 INSERT→두 번째 UPDATE→같은 baseVersion 재전송 409) ③ 412px 폭 저장 바와 하단 탭 겹침 ④ 시장 마감 시간대(스냅샷 오래됨 3시간 경계) ⑤ 보유 0건·스냅샷 0건 빈 상태.
- [14:05] 확인하지 못한 것: 브라우저에서의 실제 상호작용(저장 중 재조회 겹침·409·원격 변경 — DOM 시험 환경 없음, 정독만) · 운영 DB 쓰기 경로(PUT)의 실제 실행(읽기 전용 원칙) · `next build`(`.next` 를 건드리지 않으려 생략, tsc 로 대체) · 환율 시점 오차의 실제 크기 · Developer 가 말한 격리 사본 tsc/jest(196 스위트)는 재현하지 않음.
- [14:05] 수정 요청(Developer): M-1(`onData` 버전 후퇴 가드 + 상태 전이 순수 함수 시험), M-2(격리 시험 범위·상대경로·exit-switch 단일 허용 단언). 나머지 L-1~L-6 은 Leader 재량(권고: L-3 범위 검사와 L-4 쉼표 거절은 한 줄이라 같이 처리). 수정 뒤에는 Reviewer 부터 재순환. 조건 충족 전까지 Critical 0·High 0 이므로 QA 선행 착수는 Leader 판단.
- [14:05] **최종 판정: CONDITIONAL_PASS (scope: src/lib/risk/, src/components/risk/, src/app/api/settings/risk-policy/, src/app/settings/risk-policy/, src/app/settings/RiskPolicySummaryRow.tsx, src/app/settings/SettingsPage.tsx, src/app/settings/__tests__/settings-risk-row.test.ts, docs/screens.md)**
- [14:19] 재감사(M-1·M-2·L-3~L-5 수정분): `policy-state.ts`·`RiskPolicyPage.tsx`·`useRiskPolicyFeed.ts`·`isolation.test.ts`·`policy-state.test.ts`·`parseStored`·`parsePct`·`dirtyCount`·route 변경분을 정독하고 시나리오를 따라갔다. git 상태 그대로(HEAD `a71b300`, `git diff --cached` 0건, `scripts/` 미실행).
- [14:19] M-1 해소 확인. ① 저장 응답 v2 확정 뒤 늦게 도착한 v1: `onSave` 가 `feed.replace(v2)`(훅 `maxVersionRef`=2)를 `setEdit(finishSave)` 보다 먼저 같은 동기 구간에서 실행하므로 v1 응답은 훅에서 버려지고(`isStaleVersion(1,2)`), 설령 훅을 지나도 `applyFeedPolicy` 가 `incoming.version <= known` 으로 무시한다(이중 방어). ② 저장 중 도착한 재조회: `saveState==='saving'` 이면 페이지는 무시하고 `paused` 로 새 재조회도 시작하지 않는다. 훅 max 만 올라가도 같은 version 재응답은 훅을 통과(strict `<`)해 페이지가 뒤늦게 받으므로 영구 누락 없음. ③ 편집 중 원격 변경: `edited()` 면 덮어쓰지 않고 `remote` 로만 안내, 같은 원격 값 반복은 무변화. ④ 409 후 내 값으로 저장: `saved`=최신 정책이라 `baseVersion` 이 최신 version 으로 간다(시험 확인). ⑤ 낙관적 갱신 롤백: 낙관 상태는 version 을 올리지 않고(`baseVersion` 유지) 실패 시 `req.backup`(원래 version)으로 복원. 훅 가드와 페이지 가드가 어긋나 정지하는 경로는 찾지 못했다.
- [14:19] 변이(스크래치패드 복사본, `policy-state.ts` 19종): 15종 사망(`<`↔`<=`·반전·`known` 에서 remote 제외·저장 중/편집 중/버전/null 가드 제거·실패 시 낙관값 유지·409 초안·takeServer/keepMine 상태 정리·dirty 검사·baseVersion·낙관 version+1). 생존 4종 = 응답과 타임아웃이 동시일 때 우선순위(`classifySave` 순서)·`beginSave` 의 saving 가드(낙관 상태에서 dirty 0 이라 중복 방어)·첫 조회가 초안을 안 채워도 통과(P(1) 이 기본값과 같아 변별 못 함)·조용한 반영에서 `remote:null` 제거(시험이 remote 없는 상태에서 시작). 모두 Low. 훅의 `maxVersionRef` 가드는 시험이 없다(페이지 상태 가드만 시험됨) — 이중 방어 중 한쪽이라 위험은 낮다. `compute.ts` 변이는 24종 중 이전 생존이던 근접 1%·`over` 동률·평균단가 20 캡·`round2` 보정이 이제 사망, 남은 생존 3종은 동치(쉼표 거절 제거도 `Number('1,5')` 가 NaN 이라 동치).
- [14:19] M-2 해소 확인. `src` 전체 순회(검사 대상 200+ 파일, `lib/strategy/engine.ts`·`exit-engine.ts`·`safety/dry-run.ts`·`notify/telegram.ts`·`instrumentation.ts`·`middleware.ts`·`analyst`·`settings/strategies` 포함 단언), 허용 목록은 risk 자신의 5개 경로 + SettingsPage 한 파일 + 시험 파일뿐이라 넓지 않다. `src` 밖(`.next`·`node_modules`)으로 새지 않는다(순회 루트가 `src`). 바늘 자체 점검: 크래프트한 import 13종에 직접 돌려 `../risk/compute`·`../../lib/risk`·`require('../risk')`·`@/lib/risk/*`·`src/lib/risk/*`·API 경로·`export * from '../risk'`·`../../components/risk/Foo` 를 전부 잡고, 놓치는 것은 `import '../risk/x'` 형태의 존재하지 않는 파일·`riskiness` 같은 다른 이름·문자열 조립 난독화뿐(현실 경로 아님). 저장소 전체 grep(`src`·`scripts`·루트 설정, agent-vault·mockups·docs 제외) 결과 참조 파일은 risk 파일·SettingsPage·그 시험뿐이고 strategy·signals·safety·exchanges·cron·orders·notify 쪽 0건. risk 파일의 import 지정자 전수 나열도 react·next·mysql2 타입·`@/lib/db`·`@/lib/strategy/exit-switch`(route 1건)·risk 내부뿐이다.
- [14:19] L-3~L-5 확인. L-3: `parseStored` 가 LIMITS 밖 값을 invalid 로 취급하고 GET·PUT 의 500 문구에 복구 안내(`RECOVERY_HINT`)가 붙었다. L-4: 쉼표 포함 입력은 NaN 오류(서버 PUT 은 원래 숫자만 받으므로 영향 없음). L-5: `takeServer`/`keepMine` 이 `saveState`·오류를 정리하고, PUT 은 15초 `AbortController` 후 실패 처리(응답 본문 읽는 중 중단돼도 실패로 분류되고 문구가 '저장됐을 수 있으니 확인하세요'), `dirtyCount` 는 반올림 뒤 비교(3.001=3 은 변경 아님). 새 문구들은 '표시 전용·자동 매도 없음' 원칙을 해치지 않는다(상단 띠·배지·저장 바 부제는 그대로). 데모 `num()` 은 쉼표를 허용하나 구현은 거부 — 입력 검증 편차로 implementation 분류(데모 의미·흐름 변화 없음).
- [14:19] 타임아웃 후 서버 반영된 경우: 화면은 저장 전 값(옛 version)으로 되돌아가고 입력값은 유지, 막대는 '저장됐을 수 있으니…'. 재조회는 'failed' 상태에서도 계속되어 최대 60초 안에 v+1 을 받으면 `remote`(원격 변경 안내)로 뜨고 '서버 값 쓰기'/'내 값 유지' 어느 쪽이든 정리된다 — 거짓 상태가 남지 않고 자가 복구. 그 사이 '다시 시도'를 누르면 baseVersion 이 옛 값이라 서버가 409 로 막고(덮어쓰기 없음) 최신 정책(=내 값)을 돌려준다.
- [14:19] 발견 L-7 (Low) `policy-state.ts:136-138`(`finishSave` conflict)·`RiskSettingsForm.tsx`(conflict 막대): 위 타임아웃 뒤 '다시 시도'→409 가 돌려준 최신 정책이 내 입력과 같으면 `dirtyCount` 가 0 이라 `beginSave` 가 null 을 돌려, 충돌 막대의 주 버튼 '내 값으로 저장'이 눌러도 아무 일도 안 한다(문구도 '다른 기기에서 먼저 바뀌었습니다'로 틀림). '서버 값 쓰기'로 정리는 된다. 권고: conflict 에서 최신 정책이 초안과 같으면(`dirtyCount(req.sent, latest)===0`) 저장 성공('saved')으로 처리, 같은 이유로 `applyFeedPolicy` 도 원격 값이 초안과 같으면 `remote` 안내 대신 조용히 채택.
- [14:19] 발견 L-8 (Low) `useRiskPolicyFeed.ts:73,127`: 가드가 응답 전체를 버린다. 운영자가 복구 안내대로 `risk_policy` 키를 지우고 재저장해 version 이 1 부터 다시 시작하면, 그 전에 열려 있던 화면은 max version(예: 5) 미만 응답을 계속 버려 보유·현재가 데이터가 새로고침 전까지 얼어붙는다(재조회 표시는 정상처럼 보임). 같은 이유로 정책이 사라진 응답(`policy:null`)도 max>0 이면 버려진다. 복구 경로 한정이라 Low. 권고: 정책 부분만 version 으로 거르고 `holdings`·`snapshot` 은 항상 반영, 또는 복구 안내에 '열려 있는 화면은 새로고침'을 추가.
- [14:19] 발견 L-9 (Low) `isolation.test.ts:96-107`: 반대 방향(risk 가 거래 경로를 쓰지 않는지)은 `@/lib/exchanges|safety|signals|orders|notify` 문자열과 strategy 상대경로만 본다. 상대경로 `'../safety/dry-run'`(lib/risk 에서)·`@/lib/credentials`·`@/lib/analyst` 는 못 잡는다. 현재 risk 파일의 import 전수는 깨끗함을 내가 확인했다. 권고: 허용 import 목록(react·next·mysql2 타입·`@/lib/db`·risk 내부·exit-switch) 외에는 실패시키는 방식으로 교체.
- [14:19] 직접 재실행: jest `src/lib/risk src/components/risk src/app/api/settings/risk-policy src/app/settings` 7 스위트 164/164 통과(여기에 `src/app/api/settings` 의 safety patch-validation 을 더하면 8 스위트 181/181 — Developer 보고와 일치, 이번엔 합산 정확) · tsc 전체 오류 4건은 이전과 동일한 타 세션 `@workspace/api-usage` 계열이고 내 파일 0건 · eslint(next core-web-vitals 임시 설정) 내 파일 0건 · 데모 게이트 check.mjs 통과(approved v3, hash verified).
- [14:19] 확인하지 못한 것: 브라우저에서의 실제 저장·재조회 겹침(DOM 시험 환경 없음 — 순수 함수 시험과 정독으로 갈음) · 운영 DB 쓰기(PUT) 실제 실행 · 훅 `maxVersionRef` 가드의 통합 동작(시험 없음, 정독만) · 환율 시점 오차(L-1)는 미해소 상태로 Leader 판단 사항.
- [14:19] 남은 권고(필수 아님, 후속/재량): L-7·L-8·L-9, 그리고 이전 L-1(환율 시점 오차)·L-2(커밋 뒤 응답 조회 실패)·L-6(고점 기준 문구)은 그대로 열려 있다. Critical 0·High 0·Medium 0 이므로 QA 로 넘겨도 된다. QA 집중점: 저장→재조회 겹침, 409, 타임아웃 후 재시도, 실DB 1회 PUT(사용자 승인 후).
- [14:19] **최종 판정: PASS (scope: src/lib/risk/, src/components/risk/, src/app/api/settings/risk-policy/, src/app/settings/risk-policy/, src/app/settings/RiskPolicySummaryRow.tsx, src/app/settings/SettingsPage.tsx, src/app/settings/__tests__/settings-risk-row.test.ts, docs/screens.md)**

## Leader 기록 (검증 순환)

- [10-22 14:09] **Reviewer CONDITIONAL_PASS** (Critical 0·High 0·Medium 2·Low 6). 조건: M-1(오래된 재조회 응답이 방금 저장한 값을 되돌림 → 버전 후퇴 가드+상태 전이 순수 함수 시험), M-2(격리 시험이 감시 폴더 10개뿐 → `src` 전체+허용 목록·상대경로 패턴·`strategy` 에서는 `exit-switch` 하나만 허용 단언). Developer 에게 M-1·M-2 와 소규모 L-3·L-4·L-5 수정 요청, 완료 후 Reviewer 재검증→QA. exit-switch import 편차는 **조건부 허용**(읽기 전용·throw 안 함·순환 없음, 조건 (a)=M-2 단언).
- Reviewer 가 실수로 `scripts/test-git-hooks.sh` 를 1회 실행했다고 공개 → Leader 가 사후 확인: HEAD `a71b300` 불변, origin 보다 정확히 2개 앞섬, index 비어 있음, hooksPath·reflog 변화 없음, 임시 잔재 없음.

### 후속으로 남기는 항목 (이번 범위 밖, 사용자 공개 대상)
- **L-1 환율 시점 불일치**: 평균단가(position_state)는 마지막 엔진 틱 시점 환율, 현재가는 스냅샷 시점 환율이라 '손절가까지 거리'·'이미 손절가 아래' 판정에 환율 변동분(추정 0.3~1%, 실측 못 함)만큼 오차가 낄 수 있다. 앞서 "비율은 환율 영향이 없다"고 한 것은 *두 환율이 같은 시점일 때만* 참이다. 표시 전용이라 매매 영향 없음. 후속: USD 기준 계산 또는 화면 안내 한 줄.
- **L-2**: 저장 커밋 뒤 응답용 스냅샷 조회가 실패하면 500 → 화면은 실패로 되돌리지만 DB 는 저장됨, '다시 시도'는 409(복구 가능, 확률 극히 낮음).
- **L-6**: 고점 기준에서 손절가 아래인데 평단보다 이익인 종목이 생기면 '평가손 합계' 문구가 거짓이 될 수 있음(데모 문구 그대로 — designer 몫).
- [10-22 14:21] **Reviewer 재검증 PASS**(14:19, Critical 0·High 0·Medium 0·Low 새 3건). M-1·M-2·L-3~L-5 해소 확인(변이 시험 policy-state 15/19·compute 이전 생존 4종 사망), exit-switch import 조건부 허용 유지. 필수 수정 없음 → QA 로 진행. (위 14:09 줄의 'CONDITIONAL_PASS' 는 *이전 판정*이고 현재 유효 판정은 `## Reviewer` 절 마지막 줄의 PASS 이다.)
- 재검증에서 나온 새 Low 3건 — **후속 처리(이번 배포 범위 밖)**: L-7(타임아웃 뒤 재시도가 409 를 받았는데 서버 값이 내 입력과 같으면 '내 값으로 저장'이 무동작), L-8(`risk_policy` 키를 지우고 새로 저장해 version 이 1 로 돌아가면 *열려 있던 화면*이 이전 max version 미만 응답을 버려 새로고침 전까지 데이터가 얼어붙음 → 복구 안내에 '열려 있는 화면은 새로고침' 추가), L-9(격리 시험의 *반대 방향*(risk → 거래 경로)이 문자열 몇 개만 봄 → 허용 import 목록 방식으로 교체). 앞의 L-1(환율 시점)·L-2·L-6 도 열려 있다.
- 커밋 순서 규칙: 16:36 WP-S 예약 push 의 사전 조건('origin 보다 정확히 2커밋 앞섬·staged 없음') 때문에 **T-066 커밋은 그 push 가 끝난 뒤에만** 한다.
- [10-22 14:48] **QA PASS**(14:45, Critical 0·High 0·Medium 0, Info 3). 독립 재현: 격리 사본 tsc 0·전체 jest 197 스위트 4,621/4,621, 데모 JS↔TS 차등 시험 ≈1만건 불일치 0(반올림 한계 22건만), **운영 DB 읽기 전용 GET 실행 200**(SELECT 4개뿐)·독립 손계산과 소수점까지 일치, PUT·저장소 97건(44개 비정상 입력 전부 400·동시 경합 1건만 성공·history 20 상한·손상 18종 500+복구 안내), 미들웨어 deny-by-default(무인증 401 동일), SAFETY_PATHS 일치 0, `next build` 통과(`/settings/risk-policy` 정적·API 동적). 못 한 것: 로그인한 실제 화면, 실제 브라우저 저장·재조회 겹침, **운영 DB 쓰기(첫 PUT)**, 실기기.
- QA Info(차단 아님, 후속): ① `parseStored` 가 `version` 문자열 `"3"` 을 3 으로 읽지만 조건부 UPDATE 는 CAST 0 이라 수동 편집으로 문자열이 들어가면 영구 409(키 삭제로 복구; 권고 `typeof o.version === 'number'` 한 줄) ② `fmt.ts:48` 주석의 예시 티커 `MU` 제거 ③ 하단 탭 10px 라벨은 기존 전역 내비.
- **지금 실제 포트폴리오로 첫 화면에 뜨는 값(QA 실측)**: 총자산 2,1xx만원, 취득원가 합 25,700,483원, 손절 합(손절폭 3%) 771,014원 = 총자산의 3.67% → 한도(2%) 사용률 **183%**, 역산 손절폭 상한 **1.63%**, 이미 손절가 아래 **5/5**, 평가손 합 **-5,253,959원(총자산의 -25.0%, 취득원가 대비 -20.4%)**. 현재는 평단 환율과 현재가 환율이 같아 L-1 시점 오차 0.
- 위험 메모: 보유 5종목이 모두 엔진 기본 하드 손절(평단 -1.5%)보다 아래라 **자동 청산 엔진을 켜면 즉시 청산 시그널이 생길 수 있다**(엔진은 사용자 설정으로 OFF; T-066 과 무관, 엔진 코드는 이번에 재검증하지 않음).
- 배포 계획: ① 16:36 WP-S 예약 push 완료 확인 ② T-066 커밋(명시 경로 29개 + task 문서 + 데모 v1~v3) ③ **사용자 확인 후** 오프아워 창에서 push ④ 배포 후 사용자가 로그인해 첫 저장(INSERT)·두 번째 저장(UPDATE)·두 탭 충돌(409) 확인 — 운영 DB 쓰기는 이때 처음 일어난다.

## QA

- [14:45] 범위·방법: Developer·Reviewer 보고를 믿지 않고 직접 실행했다. HEAD `a71b300` 을 `git archive` 로 풀어 T-066 파일 29개를 덮어 얹은 격리 사본(스크래치패드)에서 검증했고, git 쓰기 0(index 비어 있음·HEAD 불변 재확인)·`scripts/` 미실행·코드/시험/데모 무수정. 운영 DB 는 `SET SESSION TRANSACTION READ ONLY`(tx_read_only=1 확인) 연결로 SELECT 만 실행했다(가드로 SELECT 외 문장 거부, 쓰기 0). 데모 게이트 `check.mjs check` 통과(approved v3, hash verified, sha256 `5f4bf2d9…7335` 직접 대조 일치).
- [14:45] A) 격리 사본 재현 PASS: `tsc --noEmit` 0 오류, 전체 jest **197 스위트 4,621/4,621 통과**(Developer 보고와 정확히 일치). 작업 트리에서 T-066 관련 7 스위트 164/164 통과(Reviewer 보고와 일치). 작업 트리 전체의 타 세션 오류(`@workspace/api-usage`)는 사본에 없어 T-066 과 무관함을 확인.
- [14:45] B) 차등 시험(데모 v3 JS `stopOf`·`heatAt`·`compute` 를 추출 실행 ↔ TS `computeRisk`) PASS: 무작위 3,000건(보유 1~10종목·미국/국내·손절폭 0.5~20·한도 0.5~10·avg/peak) + 평균단가/현재가/고점 없는 종목 포함 2,000건 + 경계 표적(현재가=손절가±ulp, near 갭 0.5/0.99/1.01/1.1/1.5%) 4,571건. **데모 반올림만 끈 변형과 비교하면 불일치 0**(비교 필드 약 32만개, 반올림 유무 두 변형 합산: 손절가·거리·손절 시 손익·상태·손절 합·사용률·초과·이미 아래 목록·평가손·역산 손절폭·구성). 예외 1건은 near 임계 정확히 1.0% 에서 부동소수 5e-15 차이(TS 0.99999999999999 / 데모 1.00000000000003)로 로직 불일치가 아님. 데모 원본(원/센트 반올림) 대비 편차는 22건 전부 반올림 한계로 설명됨(고점 기준 역산 손절폭 21건 ≤0.02%p, 손절 합≈한도에서 초과 판정 1건) — Developer 보고의 '정밀 산술·표시만 반올림' 편차와 일치, 설명 안 되는 편차 0. 데모 v3 에 `gapsList` 는 없었다(지시문의 함수명 — 같은 로직은 compute 의 rows·below 계산). 차등 시험 자체의 변별력은 변이 5종으로 확인(`<=`→`<`, near 1→1.2, 손절 합 ×1.001, 사용률 분모, 손절가 식 모두 적발; `over` `>`→`>=` 는 이 시험이 못 잡고 Developer 의 compute.test 몫).
- [14:45] C) 실제 DB 읽기 전용 PASS: 실제 `GET` 핸들러를 `@/lib/db` 모킹(READ ONLY 풀·부팅 DDL 차단)으로 운영 DB 에 대해 실행 → 200, 실행된 SQL 은 SELECT 4개뿐(정책 1·스냅샷 1·exit-switch 2키 1·position_state 1). 스냅샷 13:28 KST(stale false), 총자산 2,1xx만원, 보유 5종목이 스냅샷과 `position_state` 에 5/5 매칭, `risk_policy` 키 없음 → `policy: null`·`defaults` 3/2/avg, `exitEngine.enabled=false`(DB `exit_engine_enabled` 가 `false` 와 일치), `enforcement: display_only`. **원시 SQL 로 독립 손계산**(risk 코드와 무관한 별도 스크립트): 취득원가 합 25,700,482.9969 · 손절 합 771,014.4899(=원가×3%) · 총자산 대비 3.6688% · 한도 금액 420,304.54(=2%×총자산) · 사용률 183.44% · 초과 true · 역산 손절폭 1.63%(1.6354→0.01 내림) · 이미 손절가 아래 5/5 · 평가손 합 −5,253,959.6354(총자산의 −25.0007%) — API 값과 소수점까지 동일. 미국 3종목 평균단가÷스냅샷 환율(1325.57)이 정확히 센트 단위(1067.49·173.17·590.94)로 떨어져 **지금 스냅샷에서는 평단 환율과 현재가 환율이 같다**(Reviewer L-1 의 시점 불일치는 이번 실측에서 0, 다른 시각엔 달라질 수 있음). 스키마 실측: `system_config.key` 는 PK(varchar 64)·`value` longtext+`json_valid` CHECK·`updated_at` 기본값 있음 → `INSERT (key,value)` 첫 저장이 컬럼 누락 없이 가능하고 중복은 1062. 조건부 UPDATE 술어를 리터럴 SELECT 로 검증: `{"version":3}`·base 3 → 일치, base 2 → 불일치, `{"version":"3"}` 문자열 → CAST 0(불일치), version 없음 → NULL. (EXPLAIN UPDATE/INSERT 는 READ ONLY 트랜잭션이 거부해 못 했다 — 실제 UPDATE 문 실행은 못 봤다.)
- [14:45] D) PUT·저장소 PASS(97건, Developer 시험과 다른 입력 + 원자적 비교-교환·지연 있는 가짜 DB): 400 이어야 하는 44건(NaN·Infinity·문자열 "3"·"3%"·배열·null·객체·불리언·음수·0·-0·1e308·1e-9·0.494·20.005·21·heat 0.49/10.005/11·basis AVG/average/빈 값/null/숫자/배열/객체/"avg "·baseVersion 음수/1.5/"1"/NaN/Infinity/배열/불리언·빈 객체·배열·문자열·숫자·null·false 본문·JSON 파싱 실패) 전부 400 + DB 쓰기 0. 반올림 11건(3.001→3·3.005→3.01·2.675→2.68·0.499→0.5·20.004→20·heat 10.004→10·0.495→0.5 등)과 무작위 1,000건(저장값은 항상 소수 2자리 이하·범위 안, 범위 밖은 절대 저장 안 됨). extra 키(`version`·`history`·`readOnly`·`enforcement` 등)는 무시되고 저장 JSON 키는 정확히 6개, `__proto__`·`constructor`·`prototype` 키로 프로토타입 오염 없음. 409: 정책 없음+baseVersion 5, 있음+baseVersion 0/과거/미래/1e308 → 409+최신 정책, 값 불변·쓰기 0. 동시 첫 저장 2건 → 200 1·409 1, 동시 갱신 8건(같은 baseVersion) → 정확히 1건 성공·version +1·history +1(지연 0/1/7ms 모두), INSERT 경합 → 409+최신. history: 27회 저장 후 20건·버전 8~27, 기존 30건이어도 다음 저장 뒤 20건. 손상 18종(JSON 아님·배열·null·숫자·version 0/-1/1.5/abc/없음·stopPct 0/100/20.5/문자열/null·heat 11/0.4·basis x/없음) → GET·PUT 모두 500 + 복구 안내, PUT 은 덮어쓰기 없음. GET 은 어떤 상태(없음/있음/손상)에서도 쓰기 SQL 0, 읽는 테이블은 `system_config`·`portfolio_snapshots`·`position_state` 뿐. 변이 7종 중 6종 적발(조건부 UPDATE 의 version 조건 제거만 이 가짜 DB 가 못 잡음 — 그 술어는 위 C) 의 실 DB SELECT 로 따로 확인).
- [14:45] E) 인증 보호 PASS: `middleware.ts` 는 `/api/settings/risk-policy`·`/settings/risk-policy` 를 공개 목록에 넣지 않아 기본 차단(코드). 운영 앱 `http://localhost:3003` 에 인증 없이 GET(로그인 시도 없음): `/api/settings/risk-policy`·`/api/settings/safety`·임의의 없는 `/api/settings/*` 모두 **401 `{"ok":false,"error":"unauthorized","detail":"session missing"}`(62바이트, 동일)**, 후행 슬래시는 308 후 401, 페이지 `/settings/risk-policy` 는 307 → `/login?next=…`. 본문에 민감 정보 없음.
- [14:45] F) 안전 불변식 PASS: 변경 29개 파일을 `commit-msg` 훅의 SAFETY_PATHS 35개 정규식에 직접 대입 → **0건 일치**(정규식 자체 자기일치 점검 포함). strategy·signals·safety·exchanges·cron·notify·analyst·orders·credentials·instrumentation·middleware 에서 `risk_policy`·`@/lib/risk`·`risk-policy` 참조 0건, 저장소 전체(src·scripts·루트 설정)에서 참조는 risk 파일·SettingsPage·RiskPolicySummaryRow·시험뿐. 새 코드 KIS/거래소/`submitOrder`/외부 URL 0, `fetch` 는 자기 API 2곳(`/api/settings/risk-policy`)뿐. 쓰기 SQL 은 `INSERT INTO system_config`·`UPDATE system_config` 2개(둘 다 `risk_policy` 키 파라미터 고정), DDL 0, `position_state`·`orders`·`signals` 는 읽기(SELECT)만·orders/signals 접근 0. `src`·`scripts` 의 `system_config` 쿼리 82문(T-066 제외)을 전수 훑어 `risk_policy` 를 쓸어 담는 키 없는 전체 조회가 0건이고 LIKE 접두도 safety_/strategy_/vol_guard_/report_trade_/notify_signal_/style_ 뿐임을 확인. `dangerouslySetInnerHTML` 은 상수 CSS 1곳, `process.env` 0, SQL 은 전부 `?` 바인딩. `--up`/`--down` 사용 0(주석 1곳에서 '쓰지 않는다'고 언급), 실제 계좌 값·종목은 코드·시험·픽스처·docs/screens.md·데모에 0건(주석 `fmt.ts:48` 의 예시 티커 `MU` 하나뿐 — 값 아님). 외부 문자열(심볼·오류·동기화 메모·시각)에 `<img src=x onerror=alert(1)>` 를 넣어 렌더 → img 요소 0개, 텍스트(`&lt;img`)로 남음. 주문 경로 코드 변경이 없어 DRY_RUN·Kill Switch·주문 한도·화이트리스트·감사 로그 체크는 해당 없음(위 격리 확인으로 대체).
- [14:45] G) 화면 PASS(정적 렌더 한계 명시): 데모 핵심 문구 확인 — 안전장치 카드 맨 위 `● 집행 중` 띠 + '이 카드의 설정은 실제 주문에 바로 적용됩니다', 요약 행·화면의 `◌ 표시·위험 계산 전용` 배지, '아직 주문을 막지 않습니다·자동으로 팔지 않습니다', '자동 매도는 없습니다 — 직접 판단하세요', 정책표 `분할 매수 최대 3회 / 40 / 30 / 30 (비율은 제안)` + `✓ 사용자 확정` 배지(리터럴 '(40/30/30)' 표기는 아니고 두 줄로 나뉨, 의미 동일·'최대 2회' 잔존 0), '현재가·총자산 기준 HH:MM 스냅샷 (… 3시간 넘으면 오래됨 표시)', 오래됨 때 '! 오래됨'+'! 스냅샷이 26시간 전(10-21 12:39) 값입니다'+엔진 ON 문구, 정책·스냅샷 없음 안내. **브라우저 실측**(실제 컴포넌트를 정적 렌더한 HTML 15장 × 360/412/1280px = 45조합, Playwright MCP 브라우저): 가로 넘침 0, T-066 화면의 11px 미만 글자 0(10px 는 하단 탭 라벨 5개뿐 — 기존 전역 내비게이션), 44px 미만 터치 대상 0(버튼 44, 입력 44~46, 라디오 라벨 63, 뒤로 링크 50×44), 모바일(<900px)은 3열 목록·1280px 은 표로 전환 정상(412px 에 표 0, 1280px 에 목록 0), 저장 바는 sticky 라 낮은 뷰포트(560px)에서도 하단 탭 위 8px 에 붙고 겹침 0. 시각 검증 재현 조건: Playwright MCP 브라우저(Chromium 계열, 정확한 버전은 확인 못 함 — 이 PC 의 시스템 Chrome 은 147), 뷰포트 360×850·412×850(대표 412×915)·1280×850, DPR 1, 다크 전용 앱(라이트 없음), locale/timezone 시스템 기본(시각 포맷은 코드가 KST 직접 계산), 네트워크 fixture 없음(정적 HTML, 합성값·환율 1,333.25), 애니메이션 없음(정적), 캡처 범위=전체 페이지 1장 확인(저장 안 함·삭제), 차이 허용은 수치 측정(넘침·글자·터치·겹침) 기준. **상호작용(저장·재조회 겹침)**은 DOM 시험 환경이 없어 못 했다 → 순수 함수 `policy-state.ts` 를 서버(조건부 저장)·지연·응답 역전·타임아웃·원격 변경을 섞은 모델로 무작위 3,000회×60단계(180,000단계: 저장 성공 1,025·409 2,482·실패/타임아웃 4,294·옛 응답 폐기 1,185·원격 변경 안내 2,535)로 따라가 불변식 위반 0건(화면이 아는 version ≤ 서버, 저장 중 영구 잠금 없음, 편집 중 입력이 사용자 조작 없이 바뀌지 않음, 정지 후 서버 version 으로 수렴). 이 무작위 시험은 변이 6종 중 3종만 적발(약한 검증력)이라 Developer 의 policy-state.test(26건, Reviewer 변이 15/19)와 합쳐서 본다. 훅(`useRiskPolicyFeed`)의 maxVersion 가드는 모델로 흉내 냈을 뿐 실제 훅 실행은 못 했다.
- [14:45] H) 배포 빌드 PASS: 격리 사본에서 `next build`(Next 15.5.22) **exit 0** — 컴파일·린트·타입 통과, 정적 페이지 18/18, `/settings/risk-policy` 정적(7.89 kB), `/api/settings/risk-policy` 동적(`ƒ`), `/settings` 16.1 kB. 첫 시도는 `@workspace/auth-oauth` 해석 실패로 실패했는데 원인은 사본 위치(`node_modules/@workspace/auth-oauth` 가 `../../../shared/auth-oauth` 상대 심볼릭 링크라 /tmp 사본에서 끊김)이고 HEAD 코드·T-066 과 무관 — 사본 옆에 `shared` 링크를 두고 재시도해 통과. `.env` 는 사본에 복사하지 않았다(빌드에 환경변수 부재로 인한 실패 없음).
- [14:45] I) 커밋 대상(명시 경로 29개, 다른 세션 파일 제외, SAFETY_PATHS 0건): `docs/screens.md`·`src/app/settings/SettingsPage.tsx`(수정 2) + 신규 27 = `src/lib/risk/{compute,defaults,policy-store}.ts`·`src/lib/risk/__tests__/{compute,isolation}.test.ts` · `src/components/risk/{EnforcedStrip,FreshLine,HoldingsStops,ReadOnlyPolicyTable,RiskResult,RiskSettingsForm,RiskStyles,RiskSummary,SourceBadge,StatusText,draft,fmt,policy-state,useRiskPolicyFeed}.ts(x)`·`src/components/risk/__tests__/policy-state.test.ts` · `src/app/api/settings/risk-policy/route.ts`·`…/__tests__/route.test.ts` · `src/app/settings/risk-policy/{page,RiskPolicyPage}.tsx`·`…/__tests__/risk-policy-render.test.ts` · `src/app/settings/RiskPolicySummaryRow.tsx`·`src/app/settings/__tests__/settings-risk-row.test.ts`. 코드 밖 동반 파일(Leader 판단): 이 task 문서 `agent-vault/10-Flow/tasks/T-066-risk-policy-settings.md`, 승인 데모 `mockups/T-066-risk-policy-settings-v3.html`(데모 게이트 hash 대조 대상 — 커밋 권고)·v1·v2. 타 세션 파일(`credentials/test/route.ts`·`api-usage` 계열·`.codex`·vault 다수 등 `git status` 항목 약 65개)은 제외. 커밋 순서 규칙(16:36 WP-S push 이후)은 Leader 기록 그대로.
- [14:45] 발견 결함: Critical 0 · High 0 · Medium 0. Low/Info 3건(차단 아님): ① Info — 저장 JSON 의 `version` 이 문자열 `"3"` 이면(수동 편집에서만 가능) `parseStored`(`policy-store.ts:46-49`, `Number()` 변환)는 3 으로 읽지만 조건부 UPDATE(`:131`)의 `CAST` 는 0 이라 화면이 baseVersion 3 으로 저장해도 **영구 409**(재현: 가짜 DB·실 DB 술어 SELECT 로 확인, 복구 안내대로 키 삭제하면 해소). 권고: `typeof o.version === 'number'` 요구 한 줄. ② Info — `fmt.ts:48` 주석의 실제 보유 티커 예시 `MU`(값 아님, 제거 권고). ③ Info — 하단 탭 라벨 10px(기존 전역 내비게이션, T-066 아님). Reviewer 가 남긴 L-1·L-2·L-6·L-7·L-8·L-9 는 그대로 열려 있고 이번에 새로 재현·악화시킨 것은 없다(L-1 은 위 C) 실측에서 현재 불일치 0).
- [14:45] 직접 확인하지 못한 것(NOT_VERIFIED): ⓐ 로그인한 실제 `/settings`·`/settings/risk-policy` 화면(운영에는 아직 라우트가 없고 로그인 시도 금지 — 정적 렌더로 갈음) ⓑ 실제 브라우저에서의 저장·재조회 겹침·409·타임아웃 상호작용(DOM 시험 환경 없음 — 순수 함수 모델로 갈음) ⓒ 운영 DB 쓰기 경로의 **실제 실행**(첫 저장 INSERT → 갱신 UPDATE → 같은 baseVersion 재전송 409 — 사용자 승인 사항이라 안 함, UPDATE 술어는 SELECT 로만 검증) ⓓ 훅 `maxVersionRef` 가드의 실제 실행 ⓔ 실기기(갤럭시 S25+)·크롬 모바일 실측 ⓕ 시장 마감·주말 전후 스냅샷 오래됨 경계의 실시간 관측.
- [14:45] 배포 전 알아둘 위험: ① **첫 사용자 저장이 개발·운영 공용 DB 에 `risk_policy` 행을 만드는 쓰기**다(DDL 없음, 되돌리기는 `DELETE FROM system_config WHERE key='risk_policy'` 한 줄). INSERT 는 스키마상 가능하지만 이번에 실행해 보지는 못했다 — 배포 뒤 사용자가 첫 저장 1회, 두 번째 저장 1회(UPDATE), 다른 탭에서 같은 기준 버전 저장(409)을 눈으로 확인해야 실 UPDATE 문이 검증된다. ② 지금 실제 포트폴리오로는 **첫 화면부터 경고색이 뜬다**: 손절 합 3.67% 한도 초과(사용률 183%), 5/5 이미 손절가 아래, 평가손 −25%, 역산 손절폭 1.63% — 표시 전용·자동 매도 없음이라고 화면이 설명하지만 사용자가 놀랄 수 있다. ③ 자동 청산 엔진은 지금 OFF(DB 실측)이고 화면 안내('켜면 이 손절가보다 먼저 팔릴 수 있습니다')는 정확하다 — 현재 5종목이 모두 엔진 기본 하드 손절(평단 −1.5%)보다 아래라서, 엔진을 켜면 즉시 청산 시그널이 생길 수 있다는 점은 이 task 가 아니라 T-015 엔진 사양에서 나오는 것(Leader 의 "구현 전 확인 사항" 기록 기준, QA 가 엔진 코드를 새로 검증하진 않았다). ④ 설정 화면과 리스크 정책 화면이 각각 60초마다 DB 읽기(4 SELECT)를 하므로 탭을 열어 둔 동안 약간의 읽기 부하가 생긴다(탭 숨김 시 중지). ⑤ push=blue/green 자동 배포라 커밋 목록에 타 세션 파일이 섞이지 않게 명시 경로로만 커밋해야 한다.
- [14:45] 배포 후 점검 제안(post_deploy_checks): 로그인 후 `/settings` 의 안전장치 카드 상단 `● 집행 중` 띠와 '리스크 정책' 요약 행(손절 합·이미 아래 5종목), `/settings/risk-policy` 에서 값 변경 → 저장 → '저장됨 버전 1' → 새로고침 후 유지, 두 탭 충돌 시 409 안내, `curl /api/settings/risk-policy`(무인증) 401, `pm2` cron 앱이 정확히 1개인지.
- [14:45] 산출물 정리: QA 브라우저 산출물 4개(스냅샷 2·콘솔 로그 1·스크린샷 1) 삭제, 임시 로컬 서버(127.0.0.1:8765) 종료·브라우저 닫음. 격리 사본·시험 파일은 스크래치패드에만 있고 repo 에는 없다.
- [14:45] **QA 판정: PASS (결함 Critical 0·High 0·Medium 0, Low/Info 3건 비차단 — 격리 사본 tsc 0·jest 4,621/4,621·next build exit 0, 차등 시험 불일치 0, 실 DB 읽기 독립 손계산 일치, 운영 쓰기 경로 실행·실제 브라우저 상호작용은 NOT_VERIFIED)**

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: delta (JV-ui_change) | 10-22 11:55 |
| v1 | 검토요청 | mockups/T-066-risk-policy-settings-v1.html | https://claude.ai/artifact/DrFJg1c3hxWSL2uW4WwmNy | 사용자 검토 요청 | 10-22 12:12 |
| v1 | 수정요청 | mockups/T-066-risk-policy-settings-v1.html | https://claude.ai/artifact/DrFJg1c3hxWSL2uW4WwmNy | "손절가입력은 해당 작업에서 함께 작업하며 설정은 설정화면에서 안전장치 항목에 추가해줘" | 10-22 12:16 |
| v2 | 검토요청 | mockups/T-066-risk-policy-settings-v2.html | https://claude.ai/artifact/EptuxBqAtoNn2djSqWnRJZ | 사용자 검토 요청 | 10-22 12:30 |
| v2 | 수정요청 | mockups/T-066-risk-policy-settings-v2.html | https://claude.ai/artifact/EptuxBqAtoNn2djSqWnRJZ | "손절가는 한번에 설정해주도록하고 그게 맞춰서 보유 종목에 대한 예상 손절가를 실시간으로 표기해달라는거 였어. 그리고 손실 손절 합에 대한 %도 설정하도록 해주고 변경은 동일하게 리스크정책에서 변경할 수있도록 해줘" | 10-22 12:37 |
| v3 | 검토요청 | mockups/T-066-risk-policy-settings-v3.html | https://claude.ai/artifact/LoHunHkWiSnSBbMpkLkyJf | 사용자 검토 요청 | 10-22 12:43 |
| v3 | 승인 | mockups/T-066-risk-policy-settings-v3.html | https://claude.ai/artifact/LoHunHkWiSnSBbMpkLkyJf | "손절기준가: 권고 구조: A 손절 설정: 손절분할수는 최대 3회로 변경하고 나머지는 권고대로 진행" | 10-22 13:22 |

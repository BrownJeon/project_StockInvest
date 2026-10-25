---
task_id: T-074
title: 자금 이동(입금·출금·환전) 원장 — 앱에서 직접 기록하고 순입금을 반영해 자산 손익을 다시 계산
status: in-progress
priority: high
roles_involved: [leader, analyst, designer, developer, reviewer, qa, deployer, judge]
related_tasks: [T-069, T-064, T-070, T-073, T-066]
tags:
  - type/task
  - domain/assets
  - domain/dashboard
aliases:
  - 입출금원장
  - cash-flow-ledger
created: 2026-10-23
updated: 2026-10-23
base_ref: fa0669c9a651119e362100d1f711bd42eda9ec89
risk_level: R1
developer_model: opus
waiting: [analyst 회계 방식 자문, 사용자 확인 — 달러 예수금 불일치, designer 데모 승인]
demo_gate:
  required: true
  level: "full"
  status: "approved"
  version: 1
  repo_path: "mockups/T-074-cash-flow-ledger-v1.html"
  artifact_url: "https://claude.ai/artifact/FStzx9Jd3Rsh5s8QxqqZz2"
  content_sha256: "eab12bff3067d37ec672b1a0fdceae684adee5d4b3bc303d5f0639ba8d9c89d7"
  decided_by: "judge"
  rule_id: "DM-kw-full"
  approved_by: "user"
  approved_at: "2026-10-23T09:26:36+09:00"
  approval_quote: "T-074 작업 진행해줘"
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: true
---

# T-074 — 자금 이동 원장

> **수익 경로 연결(제1원칙)**: "얼마 벌었는지"는 입금·출금을 빼야 정직하게 나온다. 시스템은 계좌의 입출금을 모르므로(T-069 리포트 §7) 총자산 변화가 투자 손익인지 입금인지 구분하지 못한다. 이걸 못 하면 이후 어떤 전략·대시보드도 틀린 손익 위에서 평가된다.

## 사용자 요구 (2026-10-23)
- 시스템이 입출금을 모른다면, **내 잔고에 입출금을 기록하는 기능을 앱에 넣어서 자산 계산을 다시 할 수 있게** 해 달라.
- 사용자 답변(근거): 2026-10-22 에 200만원을 입금하고 달러로 환전했다. 손익 기준일은 **오늘(2026-10-23)**. T-064 D18 = 앱 안 입력 화면으로 수기 원장(권고 ① 의 확장).
- 순서: 이 task 와 T-070 적용·T-075·T-076 을 마친 뒤 대시보드 개편(T-073)을 지시하겠다(사용자).

## 이미 알려진 사실 (읽기 전용 실측 2026-10-23 07:3x)
- **달러 예수금 불일치 — 사용자 확인 대기**: 사용자가 KIS 앱에서 확인한 값 **$118.60**. 시스템 최신 스냅샷(#5434 07:13)의 USD 행은 2,541,435원 ≈ **$1,918.6**(환율 1324.63), 02:34~04:58 에는 2,053,177원 ≈ $1,550.00. 차이가 정확히 **$1,800.00** → 주문 증거금(예약·미체결 주문에 묶인 금액) 또는 앱 항목 차이(외화예수금 vs 주문가능외화) 가능성. 어느 쪽인지에 따라 기준 총자산이 최대 약 238만원 달라진다. **확정 전에는 기준 총자산을 확정하지 않는다.**
- 스냅샷 원화 현금: 10-22 22:59 = 2,080,138원 → 10-23 02:34 이후 23,226원(원화 약 205.7만원이 달러로 환전된 것으로 보임, 환전 시각·환율은 사용자 확인 필요).
- `portfolio_snapshots` 은 KIS 잔고에서만 생성(입출금 반영 없음), `executions` 0행.
- 설정 화면에 `risk-policy` 하위 화면 선례(T-066): 단일 키 저장·낙관적 잠금.

## 범위 (안 — analyst 자문과 데모 승인 뒤 확정)
1. **원장 테이블**(신규, 가산 전용 DDL — 사용자 승인 사항): 입금·출금·환전 기록(날짜·종류·통화·금액·환율·메모·생성 시각), **삭제는 소프트 삭제**(감사 가능), 계좌 범위(`accounts`) 확인.
2. **입력 화면**(설정 하위 화면 또는 자산 화면 — designer 가 제안): 기록 추가/정정/취소, 목록, 입력 검증(금액 > 0, 통화, 미래 날짜 제한, 중복 의심 경고), 기준일 표시.
3. **계산 라이브러리**(순수 함수·읽기 전용): `순입금 반영 손익 = (현재 총자산 − 기준 총자산) − 기간 순입금`, 필요 시 시간가중수익률. 사용처: 수익 엔진 리포트(T-069/T-070 후속)와 이후 대시보드(T-073). **기존 화면의 숫자는 이 task 에서 바꾸지 않는다**(바꾸면 데모 필요 — designer 몫).
4. **외부 이동 후보 알림**(선택): T-069 리포트의 스냅샷 점프 탐지 규칙을 재사용해 "기록 안 된 입출금 같은 점프"를 사용자에게 알려 기록을 유도.
5. **기준 총자산(opening) 기록**: 기준일 스냅샷 + 사용자가 확인한 현금 잔액.

## 하지 않는 것
- 주문·시그널·`position_state`·`orders`·`executions` 쓰기 금지. KIS 입출금 조회 연동은 범위 밖(D18 ② 는 가능 여부 확인 전까지 보류).
- 사용자가 기록하지 않은 입출금을 추정으로 채우지 않는다.

## 단계
1. judge intake → 데모 `full`(새 화면) 판정 → `check.mjs init`.
2. **analyst 자문**(읽기 전용): 회계 방식(순입금 조정 vs 시간가중), 환전의 취급, 데이터 모델, 오입력 방지 → 계획서에 반영.
3. **designer 데모 v1**(합성값만) → Leader 가 Artifact 게시·`review_requested` → 사용자 승인(승인 전 화면 코드 금지).
4. Developer(Opus) → Reviewer → QA → 사용자 확인 → 마이그레이션 승인 → Deployer(오프아워).

## 사용자 결정·확인 필요
- **(확인) KIS 앱의 어느 항목이 $118.60 인가** — 외화예수금(총액)인가 주문가능외화인가, 미체결/예약 주문이 있는가. 그리고 10-22 원화 입금·환전의 정확한 날짜·환전 금액·적용 환율(모르면 "모름").
- 데모 단계에서: 화면 위치, 입력 항목, 환율 입력 방식.

## 판단 기록 (judge)
- 2026-10-23 07:38 intake(규칙 엔진 `dev-rules@0.5.0`, 외부 전송 없음, `demo_pref: require`): risk R1, developer opus, 데모 **full**(`DM-kw-full`, owner designer), next=demo_first. 승인 전 화면 코드 금지.

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: full (DM-kw-full) | 10-23 07:38 |
| v1 | 검토요청 | mockups/T-074-cash-flow-ledger-v1.html | https://claude.ai/artifact/FStzx9Jd3Rsh5s8QxqqZz2 | 사용자 검토 요청 | 10-23 08:31 |
| v1 | 승인 | mockups/T-074-cash-flow-ledger-v1.html | https://claude.ai/artifact/FStzx9Jd3Rsh5s8QxqqZz2 | "T-074 작업 진행해줘" | 10-23 09:26 |

## Analyst

- [07:49] 읽기 전용 자문 시작(Q1~Q5). 읽은 것: `analyst.md` · 이 task · T-069 리포트 §6·§7 · `scripts/profit-engine/holdings-core.mjs`(`RULES` 46~65, `decomposeStep` 619~665, `detectFlows` 668~700, `detectUsdFlips` 553~608) · `src/lib/risk/compute.ts` · `src/app/api/cron/portfolio-snapshot/route.ts` · `src/lib/exchanges/kis-overseas.ts` 181~343 · `src/lib/exchanges/kis.ts` 42~139 · `src/lib/db.ts` 188~224·1437~1486 · `src/lib/risk/policy-store.ts` · T-056 task 실측 표(271~298). 운영 DB 는 읽기 전용 러너로 `portfolio_snapshots`(10-21 이후 40행·#5426/5428/5429/5433/5434 positions) · `accounts` · `users` 행수 · `user_settings` · `system_config` 키 목록 · `orders` · `fx_rates` · `VERSION()` 만 조회. KIS 호출·쓰기 0. 타 세션 미커밋 `fx.ts` 는 `git show HEAD:` 로만 읽었다. 시각은 `date` 확인값.

### A. 이 자문에서 새로 확인한 사실 (스냅샷 DB 직접 조회, [확실])

| 구간(KST) | 변화 | 해석 |
|---|---|---|
| 10-22 20:15(#5426) → 22:20(#5427) | KRW 예수금 **+2,000,000원**, USD·보유 수량 불변 | 사용자가 말한 원화 200만원 입금 |
| 10-22 22:59(#5428) → 10-23 00:11(#5429) | KRW **−2,056,912원**, USD **0 → +1,550.00** | 환전 1건. 내재 환율 2,056,912 ÷ 1,550 = **1,327.04원/$**. 같은 틱 앱 환율 1,324.63 대비 +0.18%(약 3,700원) — 환전 비용(스프레드)의 실례 |
| 10-23 04:58(#5433) → 07:13(#5434) | USD **1,550.00 → 1,918.60 (+368.60)**, 보유 5종목 수량·KRW 불변 | T-069 R2 의 "X" 가 1,550 위에 다시 올라탐. 앱 `orders` 는 2026-08-12 이후 0건 → 앱 주문 아님 |
| X 의 추이 | 368.51(10-20 08:24, T-056 실측) → 368.54(10-21) → 368.57(10-22) → **368.60(10-23)** | **영업일마다 정확히 +$0.03**. 16~17시 사이 사라지고 06~07시 사이 돌아온다 |
| 사용자 KIS 앱 값 | 1,918.60 − 118.60 = **1,800.00** (정확히 둥근 수) · 1,550 − 118.60 = 1,431.40(둥글지 않음) | 사용자가 본 118.60 은 X 가 포함된 시간대의 1,918.60 에서 1,800.00 이 빠진 값 |

기준 스냅샷 #5434 의 달러 자산 비중(해외 3종목 + USD 현금) ≈ **85%** — Q1③ 의 근거.

### Q1. 회계 방식

**용어.** `V_t` = 스냅샷 `total_krw`(원화, 보유 평가 + KRW 예수금 + USD 예수금×그 틱 환율). `B₀` = 기준 총자산(기준 스냅샷 + 사용자 확인 현금 보정). `CF_i` = 기준 이후 i 번째 **외부** 자금 이동의 원화 환산(입금 +, 출금 −). `a(CF_i)` = **앵커 스냅샷**: 그 흐름이 처음 반영된 스냅샷(⑤).

**MVP — 순입금 보정 손익 (권고, 가장 작은 정직한 안)**

```
보정 손익 P(t)   = (V_t − B₀) − Σ CF_i            (i: 기준 시각 < 발생 ≤ t, 앵커가 잡힌 것만)
보정 수익률 R(t) = P(t) ÷ ( B₀ + Σ w_i·CF_i ),  w_i = (t − t_i) ÷ (t − t₀)      ← Modified Dietz
```

- 원 단위 `P` 가 주 숫자, `R` 은 보조. `R` 의 분모는 "기간 중 평균적으로 투자돼 있던 돈"이다. 단순 `P ÷ B₀` 를 쓰면 입금이 있을 때 수익률 크기가 과장된다(입금 200만/기준 2,180만이면 약 9% 상대 오차). Modified Dietz 는 공식 하나로 그 오차 대부분을 없애고 시간가중수익률의 표준 근사다(GIPS 에서 허용되는 방법 — **일반 금융 이론 근거이며 이 프로젝트 데이터로 검증된 것은 아니다**).
- 분모 ≤ 0 이면 `R` 은 "계산 불가"로 표시하고 `P` 만 보여 준다.
- 사용자 표현: `P` = **"입금·출금을 빼고 투자로 늘어난(줄어든) 돈"**, `R` = **"기간 중 투자돼 있던 돈 100만원당 번 돈"**. "순입금" 대신 "넣은 돈 − 뺀 돈".

**④ 환전 = 내부 이동(CF 0).** 환전은 `Σ CF` 에 넣지 않는다. 스프레드 비용은 자동으로 `V` 하락 → `P` 의 손실로 들어간다(10-23 00:11 의 약 3,700원이 그 예). 따로 *보여 주려면* 환전 행에서 `비용(추정) = 내준 원화 − 받은 달러 × 앵커 스냅샷 환율`(KRW→USD 기준; 반대 방향은 부호 반대). 라벨은 반드시 "추정(기준 = 앱 환율, KIS 고시환율 아님)". 환전 행은 **양쪽 금액을 입력**받고 환율은 유도한다(환율+한쪽 금액 입력은 반올림 불일치를 만든다).

**⑤ 입금 시각 ≠ 스냅샷 시각.** 규칙: **"흐름은 그것이 처음 보이는 스냅샷 시각에 들어온 것으로 본다."** `발생 시각 ≤ ts` 인 첫 스냅샷부터 36시간 안에서 ΔKRW(또는 ΔUSD) 가 금액과 맞는(허용치 Q3) 첫 행을 앵커로 잡는다. 앵커가 없으면(`pending`) `Σ CF` 에서 제외한다 — `V` 에 아직 없는 돈을 빼면 `P` 가 그만큼 과소다. 앵커 이후 스냅샷이 있는데도 맞는 변화가 없으면(`unmatched`) 사용자 기록을 믿고 포함하되 경고를 띄운다(시스템이 기록을 지우거나 채우지 않는다 — task "하지 않는 것"). USD 입출금의 원화 환산은 **앵커 스냅샷 USD 행의 `price`(환율)** 로 하면 `V` 와 같은 자로 재는 셈이라 환율 입력이 필요 없다. 현금은 입금~앵커 사이에 움직이지 않으므로 이 근사의 오차는 ≤ 스냅샷 간격(약 70분) 동안의 환율 변동 × 달러 입금액뿐이다.

**기준일 주의 두 가지 (설계 결정 필요).**
1. 10-22 의 입금·환전은 **기준일(10-23) 이전**이라 `B₀` 에 이미 들어 있다 → 원장에 "기준 이전(참고)"으로만 적고 `Σ CF` 에서 제외해야 한다. 넣으면 `P` 가 200만원 과소가 된다(Q3 시나리오 6).
2. X($368.6)가 하루 중 들락날락하므로 **기준 스냅샷과 비교 스냅샷을 같은 시간대에서 고르지 않으면 약 49만원(2.2%)이 손익으로 둔갑**한다. 권고: 일별 비교의 "일 평가 시각"을 **07:00~09:00 KST 의 첫 스냅샷**으로 고정(미국 정규장 마감 뒤·국내 개장 전·X 가 돌아와 있는 시간대 — 10-20~10-23 4일 모두 07~08시대에 X 존재). 장중 "현재" 값은 그대로 보여 주되 X 가 빠진 시간대면 "일부 달러 현금 표시 안 됨" 표지(Q4). X 의 정체는 Q5 질문 3 으로 확정한다.

**확장 1 — 시간가중수익률(TWR), 스냅샷으로 체인 연결 (②)**

```
구간 경계 = 기준 스냅샷 a₀, 입출금 앵커 a₁…a_{K−1}, 최신 스냅샷 a_K
r_k  = ( V(a_k) − CF_k ) ÷ V(a_{k−1}) − 1       CF_k = a_k 에 앵커된 입출금 합(마지막 구간은 0)
TWR  = Π (1 + r_k) − 1
```
흐름을 "구간 끝 직전 도착"으로 두는 이유: 앵커 정의상 `V(a_{k−1})` 에는 그 돈이 없고 `V(a_k)` 에는 있으며 그 사이 현금은 수익을 내지 않는다. 환전은 경계를 만들지 않는다(CF 0, 스프레드는 그 구간 수익률에 음수로 남는다). R1·R1b 제외 후보 행은 앵커로 쓰지 않고 다음 정상 행을 쓴다. 입출금이 자산의 수 % 수준이고 변동이 완만하면 Modified Dietz 와 차이가 작다 — 그래서 MVP 에서 뺐다. 사용자 표현: "입금 타이밍 운을 빼고, 구간별 수익률을 이어 붙인 값".

**확장 2 — 환율 효과와 투자 손익 분리 (③)**

연속 스냅샷(prev→cur, USD 행 환율 f_p→f_c)마다:
```
달러 자산(USD)  U_p = USD 현금 + Σ 해외 종목 value_krw ÷ f_p
환율 효과       = U_p × (f_c − f_p)                      ← holdings-core:650 의 fxEffect 와 같은 정의(기초 잔액 × Δ환율)
투자 손익(해외) = Δ(해외 value_krw + USD value_krw) − 환율 효과
투자 손익(국내) = Δ(국내 value_krw)
```
기준일부터 합산한다. 필요성: 달러 자산이 85% 라 환율 1% 변동 ≈ 총자산 0.85% 가 전략과 무관하게 `P` 에 섞인다 — 수익 엔진(T-064/T-067)이 미국 종목 전략을 평가할 때는 달러 기준 손익이 맞다. 전제 [가능성 높음]: 같은 틱의 해외 종목 KRW 단가가 USD 행과 같은 환율(`getUsdKrwRate` 5분 캐시)로 환산됐다는 것(`kis-overseas.getTicker` 주석, 코드로 실환율 일치는 확인 못 함). USD 행이 없는 10-21 05:19 이전 구간은 분리 불가(기준일이 10-23 이라 영향 없음). MVP 에서는 "원화 기준 손익(환율 변동 포함)" 한 줄 표기로 충분.

### Q2. 데이터 모델

**계정 범위 [확실 — DB·코드].** `accounts` 1행(id 1, kis/default) — `orders.account_id` 가 참조. `users` 1행(T-009/T-011 회원별 KIS 자격증명), `user_settings` 는 안전장치 4키. `portfolio_snapshots` 에는 account/user 열이 **없다**(계좌 하나의 전역 로그). 돈의 주체는 KIS 계좌이므로 원장은 **`account_id`(기본 1) 로 스코프**하고 `users` 는 "누가 입력했나" 감사 열로만 둔다. 스냅샷에 범위가 없는 이상 user 스코프는 의미가 없다.

**원칙.** ① 금액은 항상 양수, 방향은 `kind`(부호 입력이 1순위 오입력). ② 정정은 **추가 전용**: 새 행 + 옛 행 소프트 삭제 + `supersedes_id` 연결(금액·종류·시각의 in-place UPDATE 금지; UPDATE 는 `deleted_*`·`anchor_*` 만). ③ 환전은 양쪽 금액 저장, 환율은 유도. ④ 중복: 폼 UUID 멱등키(이중 제출) + 살아 있는 행의 (종류·통화·금액·분) 유니크 + 24시간 내 같은 금액 재입력 경고(소프트).

```sql
-- T-074 가산 전용 DDL 초안 (MariaDB 10.11.11 실측 — CHECK·PERSISTENT 생성열 사용 가능). 사용자 승인 뒤 scripts/migrations/T-074-*.sql
CREATE TABLE IF NOT EXISTS cash_flow_ledger (
  id                 BIGINT PRIMARY KEY AUTO_INCREMENT,
  account_id         INT NOT NULL DEFAULT 1,                 -- accounts(id). orders 와 같은 범위(현재 1행)
  client_entry_id    CHAR(36) NOT NULL,                      -- 폼이 만든 UUID — 이중 제출 멱등키
  kind               ENUM('deposit','withdrawal','exchange') NOT NULL,
  occurred_at        DATETIME NOT NULL,                      -- KST 벽시계(portfolio_snapshots.ts 와 같은 규약), 분 단위
  currency           CHAR(3) NOT NULL,                       -- 입출금: 통화 / 환전: 내준 통화(from)
  amount             DECIMAL(18,2) NOT NULL,                 -- 항상 양수. 방향은 kind
  counter_currency   CHAR(3) NULL,                           -- 환전 전용: 받은 통화(to)
  counter_amount     DECIMAL(18,2) NULL,                     -- 환전 전용: 받은 금액(양수). 환율 = counter_amount/amount 로 유도(저장 안 함)
  fx_rate_used       DECIMAL(12,4) NULL,                     -- USD 입출금 원화 환산에 쓴 환율(앵커 스냅샷 USD 행 price, 없으면 사용자 입력)
  fx_source          ENUM('snapshot','user') NULL,
  krw_equiv          DECIMAL(18,2) NULL,                     -- 순입금용 원화 환산. KRW 흐름 = amount, USD 흐름 = amount×fx_rate_used, 환전 = NULL
  anchor_snapshot_id BIGINT NULL,                            -- 처음 반영된 portfolio_snapshots.id (FK 안 둠 — 스냅샷은 T-012 처럼 정리된 적 있는 로그 테이블)
  anchor_snapshot_ts DATETIME NULL,
  anchor_status      ENUM('pending','matched','unmatched') NOT NULL DEFAULT 'pending',
  anchor_detail      VARCHAR(200) NULL,                      -- 매칭 근거(ΔKRW/ΔUSD·허용치) 또는 불일치 사유
  memo               VARCHAR(200) NULL,
  source             ENUM('user','import') NOT NULL DEFAULT 'user',   -- import = 향후 KIS 입출금 조회(D18 ②) 자리
  supersedes_id      BIGINT NULL,                            -- 정정: 이 행이 대체한 행(그 행은 deleted_at 이 찍힌다)
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id INT UNSIGNED NULL,                      -- users(id) — 감사용
  deleted_at         DATETIME NULL,                          -- 소프트 삭제(복구 = NULL 로 되돌림, 사유 기록)
  deleted_by_user_id INT UNSIGNED NULL,
  delete_reason      VARCHAR(200) NULL,
  live               TINYINT AS (IF(deleted_at IS NULL, 1, NULL)) PERSISTENT,  -- 살아 있는 행만 유니크 대상(NULL 은 충돌 안 함)
  CONSTRAINT fk_cfl_account  FOREIGN KEY (account_id)    REFERENCES accounts(id),
  CONSTRAINT fk_cfl_super    FOREIGN KEY (supersedes_id) REFERENCES cash_flow_ledger(id),
  CONSTRAINT chk_cfl_amount  CHECK (amount > 0),
  CONSTRAINT chk_cfl_ccy     CHECK (currency IN ('KRW','USD')),
  CONSTRAINT chk_cfl_exch    CHECK (
       (kind =  'exchange' AND counter_currency IN ('KRW','USD') AND counter_currency <> currency AND counter_amount > 0)
    OR (kind <> 'exchange' AND counter_currency IS NULL AND counter_amount IS NULL)),
  UNIQUE KEY uq_cfl_client_entry (client_entry_id),
  UNIQUE KEY uq_cfl_live_dup     (account_id, kind, currency, amount, occurred_at, live),
  KEY idx_cfl_account_time (account_id, deleted_at, occurred_at),
  KEY idx_cfl_anchor       (anchor_snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**기준(opening) 표현 — DDL 없이 `system_config` 한 키, T-066 `policy-store.ts` 패턴(version·history·낙관적 잠금) 재사용 권고.** 키 `cash_ledger_baseline`:
```json
{ "version": 1, "updatedAt": "…",
  "baselineAt": "2026-10-23 07:13:04", "snapshotId": 5434,
  "snapshot":  { "totalKrw": 0, "krwCash": 0, "usdCash": 0, "fx": 0 },          // 스냅샷에서 복사해 동결
  "confirmed": { "krwCash": null, "usdCash": null, "usdCashLabel": "외화예수금|주문가능|출금가능", "note": "" },   // 사용자 확인값, 없으면 null
  "baselineTotalKrw": 0,   // = snapshot.totalKrw + (confirmed.usdCash − snapshot.usdCash)×snapshot.fx + (confirmed.krwCash − snapshot.krwCash)
  "history": [] }
```
- 기준은 바꾸면 새 version(이력 유지). 원장은 `occurred_at > baselineAt` 인 행만 `Σ CF` 에 넣는다. 기준 이전 날짜 입력은 **차단**(문구: "기준일 이전 입출금은 기준 총자산에 이미 포함돼 있습니다") — 상태 수를 줄이기 위해. 참고 기록이 꼭 필요하면 `memo` 전용 "기준 이전(참고)" 종류를 확장안으로.
- 여러 기준(기간 리셋)이 필요해지면 그때 `ledger_baselines` 테이블로 승격한다.

### Q3. 오입력·누락 방지

| # | 시나리오 | `P` 에 미치는 영향 | 막는 장치 |
|---|---|---|---|
| 1 | 입금을 출금으로(방향 반대) | +2×금액 과대 | 부호 입력 없음·`kind` 라디오, 저장 전 확인문 "총자산이 X원 **늘어난** 것으로 기록합니다", 앵커 매칭에서 방향 불일치 → `unmatched` 경고 |
| 2 | KRW→USD 환전을 "USD 입금"으로 | −달러 금액만큼 과소 | 앵커 단계에서 같은 틱 KRW 감소가 보이면 "환전으로 기록하시겠어요?" 제안 |
| 3 | 환전을 두 줄(KRW 출금 + USD 입금)로 | 거의 상쇄(−스프레드)지만 원장 오염·앵커 2중 | 같은 시간대 반대 방향 쌍 감지 → 환전 1건으로 합치기 제안 |
| 4 | 자릿수(200,000/20,000,000)·통화 칸 바꿈(2,000,000 USD) | 수십 배 왜곡 | 천 단위 구분 표시 + 금액 한글 표기("이백만 원") 확인문, USD 금액 > 총자산(USD 환산) 이면 경고, 소수 2자리 초과 거부, 앵커 매칭 불일치 경고 |
| 5 | 중복 입력(이중 제출·다음날 재입력) | 금액만큼 과소 | `client_entry_id` 유니크, 살아 있는 행 (종류·통화·금액·분) 유니크, 24h 내 같은 금액 경고 |
| 6 | **기준일 이전 입출금을 넣음**(이번 10-22 입금이 정확히 이 경우) | 200만원 과소 | `occurred_at ≤ baselineAt` 차단(Q2) |
| 7 | 미래 날짜·스냅샷 전 입력 | 일시 과소 | 미래 시각 거부, 최신 스냅샷 이후면 `pending` 으로 두고 "다음 스냅샷 반영 전" 표시 |
| 8 | 환율을 손으로 넣고 금액 한쪽만 | 반올림 불일치·스프레드 왜곡 | 환전은 양쪽 금액 필수, 환율은 표시만. 유도 환율이 앱 환율과 ±3% 넘게 다르면 경고 |
| 9 | 맞는 행을 잘못 삭제 | 금액만큼 왜곡 | 소프트 삭제 + 복구 + 사유 |
| 10 | 배당·이자·수수료를 입금/출금으로 | 투자 손익이 입출금으로 새어 나감 | 입력 화면 안내: "배당·이자·수수료는 투자 손익입니다 — 기록하지 마세요". 탐지기(아래)가 소액 USD 증가를 "배당·이자일 수 있음(소액)"으로 분류 |

**앵커 매칭 허용치(제안).** KRW: `max(1,000원, 금액×0.1%)`, USD: `max($1, 금액×0.1%)`. 입금 KRW 는 ΔKRW(free+locked) 로, USD 는 ΔUSD qty 로, 환전은 같은 단계(또는 연속 2단계)에서 두 Δ 가 함께 맞아야 한다. 검색 창 36시간, 넘기면 `unmatched`.

**누락(기록 안 된 입출금) 탐지 — T-069 규칙 재사용 여부.**
- `decomposeStep`(holdings-core 619~665)의 `externalCandidate = qtyEffect + krwFlow + usdFlow` 는 그대로 쓸 수 있는 **순수 함수**다. 다만 `scripts/profit-engine/*.mjs` 에 있어 Next 앱(`src/`)에서 import 하려면 `src/lib/ledger/flow-detect.ts` 로 **이식**(동일 공식, 시험 데이터는 T-069 리포트 §6.2 의 R3 10건으로 대조)해야 한다.
- **임계값은 바꿔야 한다.** T-069 R3 의 `max(직전 총액 1%, 10만원)`(`RULES.flowMinPct/flowMinKrw`)은 "큰 외부 이동"을 훑는 용도라, 총자산 2,200만원이면 **22만원 미만 입출금을 놓친다.** 원장 누락 경고는 현금 변화 자체를 보는 게 맞다: 보유 수량 불변 단계에서 `|ΔKRW| ≥ 50,000원` 또는 `|ΔUSD| ≥ $50` 이고 **그 단계에 앵커된 원장 행이 없으면** 후보. 수량 변화가 있는 단계는 R3 그대로(매매 금액 2% 안에서 상쇄되면 내부 매매). 50,000원/$50 근거: 이 포트폴리오 크기에서 월 배당·이용료 합이 그 아래이고[추측 — 이 계좌 배당 내역 미확인], 사용자가 굳이 기록할 입출금의 하한으로 충분하다. 상수는 한곳(`RULES` 식)에 두고 화면 설명문에 그대로 인쇄한다.
- **R2(USD 왕복) 억제는 필수이고, 현행 R2 는 재사용 전 일반화가 필요하다.** `detectUsdFlips`(553~608)는 **0 ↔ X** 만 본다(`zeroA/zeroB`). 10-23 부터 잔액이 1,550 위에 X 가 얹히므로(1,550 ↔ 1,918.60) 현행 규칙은 **잡지 못한다** → "Y ↔ Y+X(허용 $0.05, 수량 불변, 전환 ≥2회)" 로 바꾸고, X 가 영업일마다 +$0.03 씩 변하는 것도 허용치에 넣어야 한다(아니면 4일마다 새 패턴으로 쪼개진다). 억제하지 않으면 누락 경고가 **매일 2번** 울린다.
- 화면 표현: 경고 1건 = "시각 · 방향·금액(예: 원화 +2,000,000원) · 보유 변화 없음 · [기록하기] [무시(사유)]". 무시는 `system_config` 나 원장의 `memo` 행으로 남겨 재경고를 막는다. **후보를 입출금으로 확정하지 않는다**(T-069 §6.1 제외 규칙 3 유지).

### Q4. 사용자에게 있어야 쓸모 있는 정보 (designer 입력 — UI 설계 아님)

**머리(항상 보임).** 기준일·기준 시각(스냅샷 id) · 기준 총자산(원) · 기준 현금 확인 상태(스냅샷값/사용자 확인값/미확정 — 미확정이면 손익에 "기준 미확정" 띠) · 현재 총자산(원)과 그 스냅샷 시각·나이(분) · **보정 손익 P(원)** · 보정 수익률 R(%, "입출금 보정·근사" 라벨) · 기간(기준일부터 n일).
**순입금 묶음.** 넣은 돈 합 · 뺀 돈 합 · 순입금 · 반영 대기(`pending`) 건수·금액 · 불일치(`unmatched`) 건수.
**신뢰도 표지.** 미설명 자금 이동 후보(건수 + 최근 1건 요약 + 기록하기) · "일부 달러 현금(약 $X) 이 16~06시에 표시되지 않음"(R2 패턴 활성 시) · 스냅샷 보류/건너뜀(`usd_cash_unavailable` 등) · 환율 출처(앱 환율, 시각).
**원장 목록.** 날짜·종류·통화·금액 · 환전은 내준/받은 금액 + 유도 환율 + 비용(추정) · 메모 · 반영 상태 · 정정 이력 · 삭제/복구.
**확장(2차).** 투자 손익(달러 자산, 환율 고정) vs 환율 효과 두 줄 · 월별 순입금·손익 표 · 일별 지수(기준=100, 입출금 보정 — T-069 §6.4 지수의 보정판, 일 평가 시각 07~09시 고정).
**원칙.** 확률·예측·"예상 수익" 없음. 환율·스프레드가 들어간 숫자에는 "추정" 라벨. 기록되지 않은 입출금은 숫자에 넣지 않고 경고로만. 기존 화면의 `today_change_pct` 등은 입출금을 빼지 않은 값이므로 이 화면과 **같은 이름을 쓰지 않는다**(혼동 방지 — 이름 결정은 designer).

### Q5. 달러 예수금 불일치 — 코드 추적과 가설

**스냅샷이 쓰는 필드 [확실 — 코드].**

| 단계 | 위치 | 내용 |
|---|---|---|
| 1 | `src/app/api/cron/portfolio-snapshot/route.ts:116-120` | `getBalancesDetailed()` → `detailed.cash.USD` |
| 2 | `src/lib/exchanges/kis.ts:97-109, 137` | USD 는 보유와 따로 `ovs.getUsdCash()` 로 묻고 실패는 `unknown`(0 아님) |
| 3 | `src/lib/exchanges/kis-overseas.ts:311-343` | **CTRP6504R** `/uapi/overseas-stock/v1/trading/inquire-present-balance`(해외 체결기준현재잔고), `WCRC_FRCR_DVSN_CD=02(외화)·NATN_CD=840·TR_MKET_CD=00·INQR_DVSN_CD=00` |
| 4 | `kis-overseas.ts:283-297` | `output2` 의 `crcy_cd='USD'` 행 **`frcr_dncl_amt_2`(외화예수금액2) 하나**를 값으로 쓴다. 정합 검사: `frcr_evlu_amt2 ≈ frcr_dncl_amt_2 × frst_bltn_exrt`(±1원), `output3.frcr_evlu_tota ≈ Σ frcr_evlu_amt2` |
| 5 | `kis-overseas.ts:265-266, 297` · `route.ts:163-167` | 함께 읽는 보조값은 `output3.ustl_sll_amt_smtl`(미결제 **매도**)뿐 — 0 보다 클 때만 행에 기록, 총액 미반영. **미결제 매수(`ustl_buy_amt_smtl`)·매수증거금(`frcr_buy_mgn_amt`)·출금가능(`frcr_drwg_psbl_amt_1`)·주문가능(TTTS3007R `ord_psbl_frcr_amt`)은 읽지도 빼지도 않는다** |
| 6 | `route.ts:150-167` | 환산 환율은 KIS `frst_bltn_exrt` 가 아니라 앱 `getUsdKrwRate()`(5분 캐시) — #5434 의 1,324.63 |
| 7 | `kis-overseas.ts:190-194` 주석 · T-056 task 54 | 설계 의도: 평가에는 "보유 외화 예수금"을 쓰고 **구매력(매수가능금액)은 쓰지 않는다** — 매수가능금액은 미체결 매수 주문이 묶은 돈이 빠져 주문 중 총자산이 일시 감소하고, 통합증거금 계좌면 KRW 와 이중 계상될 수 있어서 |

**필드 의미와 주문 증거금의 영향.** 코드 어디에도 예수금에서 주문 증거금을 빼는 지점이 없다[확실]. KIS 응답에는 같은 `output2` 행에 `frcr_buy_mgn_amt`(외화매수증거금액)·`frcr_drwg_psbl_amt_1`(외화출금가능금액1)이 따로 있고, 주문이 없던 10-20 실측에서는 증거금 0·출금가능 = 예수금(368.51)이었다[확실 — T-056 실측 표 283~287]. 미체결(또는 예약) 매수 주문이 있을 때 **`frcr_dncl_amt_2` 는 그대로이고 증거금에 주문금액이 잡혀 출금가능·주문가능만 줄어드는지**는 코드·문서로 확인할 수 없다[추측 — 필드 이름이 그렇게 읽힐 뿐 관측 없음]. 사용자가 KIS 앱에서 본 "예수금"이 이 중 어느 항목인지에 따라 1,800.00 의 해석이 갈린다.

**가설(확신순).**
- **H1 [가능성 높음] 미체결·예약 매수 주문 $1,800.00 의 증거금.** 근거: ① 차이가 정확히 둥근 1,800.00(체결이면 수수료 0.25% 가 붙어 둥글지 않다) ② #5433→#5434 사이 보유 수량 불변·USD 증가 → 07:13 까지 체결된 매수는 없다 ③ 앱 주문 0건이라 사용자가 KIS 앱에서 낸 주문 ④ 사용자 값 118.60 = 1,918.60 − 1,800.00 은 "주문가능/출금가능" 류 항목과 모양이 같다. 이 경우 **시스템 값 1,918.60 이 평가용으로 맞고**, 주문이 체결되면 그만큼 주식으로 바뀌어 총자산은 유지된다(수수료만 감소).
- **H2 [추측] 07:13 이후 체결.** 07:13~사용자 확인 시각 사이(애프터마켓)에 $1,800 매수가 체결됐다면 다음 스냅샷(08:3x 전후)에서 USD 가 118.60 근처로 줄고 **새 종목이 보유에 나타난다**. H1 이면 USD 1,918.60 그대로다. → **다음 스냅샷 1행으로 H1/H2 가 갈린다**(Leader 가 확인 가능, KIS 호출 불필요).
- **H3 [추측] 사용자 값이 X 를 뺀 기준.** 1,550 − 118.60 = 1,431.40 으로 둥글지 않아 가능성 낮음.

**$0 ↔ $368.5x 왕복(T-056/T-064/T-069 R2)과의 관계.** 왕복은 CTRP6504R `frcr_dncl_amt_2` 자체가 시간대별로 다른 값을 돌려준 것이지 앱 로직의 결과가 아니다[확실 — 파서는 값을 가공하지 않음, 268~297]. 새 사실은 **X 가 영업일마다 정확히 +$0.03 씩 늘고, 16~17시 KST 에 예수금에서 빠졌다가 06~07시 KST 에 돌아온다**는 것이다. $0.03/$368.5 ≈ 하루 0.0081% ≈ 연 3.0% — 매일 이자가 붙으면서 밤사이 예수금 밖(별도 상품 잔고)으로 나가는 **달러 자동투자 상품(외화 RP 자동매수·달러 발행어음 자동투자·외화 MMF 류)** 의 모양이다[가능성 높음 — 4일 패턴 근거 / 상품 종류는 추측]. T-056 10-20 23:07 실측에서 `tot_asst_amt` 도 그만큼 줄었으니 그 상품은 해외주식 잔고 조회 범위 밖이다. 이 가설이 맞으면 ① X 는 사용자의 실제 돈이고 ② 16~06시 스냅샷은 그만큼 과소이며 ③ 1,800 과는 무관하다(1,800 은 X 가 포함된 시간대 위에 얹힌 별개 차이). 원장 설계에는 "일 평가 시각 07~09시"(Q1)와 R2 일반화(Q3)로 반영한다. 기존 R2 규칙(0↔X)은 이제 1,550↔1,918.60 이라 **더 이상 잡지 못한다**(Q3).

**사용자에게 물을 질문(3개).**
1. **$118.60 을 본 화면·항목 이름과 시각**은 무엇인가요? (예: "외화예수금" / "주문가능금액" / "출금가능금액" / "D+1 예수금") 같은 화면에 "외화예수금(총액)"·"매수증거금"·"미체결" 항목이 있으면 그 값도 함께 알려 주세요.
2. 10-22 밤 ~ 10-23 아침에 KIS 앱(또는 다른 경로)으로 **미국주식 매수 주문**(지정가·예약주문 포함)을 내셨나요? 냈다면 종목·수량·지정가·총액(약 $1,800 인지)·현재 상태(미체결/체결/취소). 체결됐다면 체결 시각.
3. **달러 자동투자 상품**(외화 RP 자동매수, 달러 발행어음, 외화 MMF 등)에 가입돼 있나요? 약 $368 이 매일 16시 전후 사라지고 아침 06~07시에 돌아오며 하루 $0.03 씩 늘어납니다. 맞다면 그 상품 잔고가 KIS 앱 어느 메뉴에 보이는지(기준 총자산에 넣을지 결정에 필요).

**후속 후보(이 task 범위 밖, 개발 결정은 Leader).** USD 행에 `frcr_buy_mgn_amt`·`frcr_drwg_psbl_amt_1`·`ustl_buy_amt_smtl` 을 `ustl_sll_amt_smtl` 처럼 **기록만**(총액 미반영) 해 두면 다음부터 이런 차이를 데이터로 판별할 수 있다(T-056 단계 4 와 같은 성격, `kis-overseas.ts` 파서 변경 → 안전 경로라 Reviewer 감사 필요).

### 확인하지 못한 것
- KIS 실제 응답(호출 금지): `frcr_dncl_amt_2` 가 미체결 매수 증거금을 빼는지, 체결기준인지(T-056 미해결 ②와 같은 항목). H1/H2 는 다음 스냅샷으로, X 의 정체는 사용자 답으로만 확정된다.
- 해외 종목 KRW 단가와 USD 행이 같은 틱에 같은 환율로 환산됐는지(Q1 확장 2 전제) — 코드 주석 근거, 실측 대조 안 함.
- 배당·이용료 규모(누락 탐지 임계값 50,000원/$50 의 하한 근거) — 이 계좌 입금 내역 미확인.
- Modified Dietz·TWR·환율 분해는 일반 금융 이론을 근거로 썼다. 이 프로젝트 데이터로 검증된 공식이 아니며, developer 구현 뒤 reference 수치(이 섹션 A 표의 10-22~10-23 구간을 테스트 데이터로 쓰면 된다: 입금 200만 → 환전 1,550 → X 복귀)로 대조해야 한다.

```json
{ "taskId": "T-074", "status": "DONE",
  "deliverables": ["Q1 회계 방식(MVP 순입금 보정 + Modified Dietz, 확장 TWR·환율 분리, 앵커 규칙)", "Q2 cash_flow_ledger DDL 초안 + 기준 JSON(system_config)", "Q3 오입력 10건·누락 탐지 임계값·R2 일반화", "Q4 정보 목록", "Q5 코드 추적(file:line)·가설 H1~H3·사용자 질문 3"],
  "blockers": ["사용자 답(질문 1~3) 전에는 기준 총자산 확정 불가", "다음 스냅샷 1행으로 H1/H2 판별 필요"],
  "risk_level": "MEDIUM" }
```
- [07:54] 자문 완료. 20-Log 색인 줄은 이번 지시의 "쓰기는 이 섹션뿐" 규칙에 따라 남기지 않았다(Leader 가 필요하면 추가).

## Designer

- [08:26] 데모 v1 작성 → `mockups/T-074-cash-flow-ledger-v1.html` (단일 HTML·인라인 CSS/JS, 토큰 스냅샷 `src/app/globals.css@sha256:04e7b5bc8394`). `check.mjs lint --expect T-074-v1` → **DEMO_LINT_PASSED**. 합성값만 썼다(기준 2026-09-01 07:10 · 기준 총자산 20,000,000원 · 입금 1,000,000원 · 환율 1,250원/$ 등) — 실제 잔고·입출금·환율·이 task 의 실측 값(10-22 입금 등)은 옮기지 않았다. 대시보드(T-073)는 그리지 않았다. Artifact 게시·`check.mjs status`·20-Log 색인은 하지 않았다(Leader 몫 / 이번 지시의 쓰기 범위 밖).
- [08:26] 디자인 스킬: layout·component·system(부분)·design-review·a11y-review / 자체 점검 P0 0·P1 0·P2 3, a11y Critical 0·Major 0·Minor 2 (남은 항목은 아래 "자체 점검 남은 항목")
- [08:26] 브라우저 확인(127.0.0.1 임시 서버 + Playwright, 확인 뒤 서버 종료·사본 삭제): 412·360px 에서 모든 상태(정상·빈·기준 없음·로딩·오류 × 신뢰도 표지 4종, 모든 행 펼침) 가로 넘침 0 · 44px 미만 터치 영역 0 · 11px 미만 글자 0 · 중복 id 0 · 콘솔 오류 0(favicon 404 제외) · Tab 가두기·Esc 닫기·포커스 복귀 · 1280px 데스크톱 복원. 점검 중 고친 결함: 목록/표 id 중복, 날짜·금액 입력이 라디오 선택자에 숨겨짐, 접힌 행이 펼쳐져 보임(`[hidden]` 덮어씀), `.sr` 요소가 데스크톱 상자 밖으로 문서 폭을 늘림, `.mini` 클래스 충돌, 토글 버튼 이중 신호(`aria-pressed`+글자 변경), 재시도 뒤 포커스 유실.

### 화면 구성·상태 (v1)

| 영역(모바일 위→아래) | 내용 | 상태 |
|---|---|---|
| 머리 | ‹ 설정 · 입출금 기록 · `◌ 기록·계산 전용` 배지 + 띠 "계좌의 돈을 움직이지 않고 주문도 만들지 않습니다" | — |
| 요약 카드 | **입출금 뺀 투자 손익**(원, 빨강/파랑 + 부호 + "늘어남/줄어듦") · 수익률(근사) · 기준부터 n일 · ⓘ 뜻 펼침 · 공식 줄(현재 − 기준 − 순입금 = 손익) · 기준일/기준 총자산(현금 확인 상태)/현재 총자산(스냅샷 시각·나이)/순입금(넣은 돈·뺀 돈)/마지막 기록/기록 n건 | 기준 미확정이면 `임시 · 기준 미확정` 표지 |
| 기록 안 된 변화 카드 | "09-14 22:20 스냅샷 · 원화 +700,000원 · 보유 수량 변화 없음" + 손익에 섞여 있다는 경고 + [입금으로 기록] [입출금 아님] + 알림 기준 문장(5만원·$50) | 열림 / 입출금 아님 표시(되돌리기) / 기록되면 사라짐 |
| 신뢰도 표지 | 기준 미확정(+기준 현금 확인) · 스냅샷 오래됨(3시간↑) · 밤 스냅샷(달러 일부 안 보임) · 반영 대기 n건(손익에서 빠져 있음) · 불일치 n건(+기록 보기) | 해당할 때만 |
| 기록 추가 버튼 | `+ 입출금 기록 추가` (전폭) | — |
| 기록 목록 | 최신순, 행 = 종류 칩·#id·금액(중립색, 부호) / 시각·통화·메모 / 상태 / 부가(USD 원화 환산·환전 환율·비용(추정)·정정 출처). 행 눌러 펼침 → 발생·기록 시각, 반영 근거, 메모, [정정하기] [기록 취소] 또는 [되살리기] | 살아 있는 기록만 기본, "취소·정정된 기록 n건 보기"로 펼침 · 빈 상태 · 모두 취소됨 |
| 손익 기준 카드 | 기준 시각·스냅샷 id·기준 총자산·원화/달러 현금(✓확인/!스냅샷 값)·환율·버전 + [기준 현금 확인] [기준 바꾸기] | — |
| 기록 안내(접힘) | 넣는 것/넣지 않는 것(배당·이자·수수료)/환전은 선택/시각 모르면 이르게/기준 이전 금지/**달러 현금 두 값 1줄** | — |
| 시트 | 기록 추가·정정(폼 → 확인 2단계), 기록 취소, 되살리기, 입출금 아님, 기준 정하기·바꾸기·현금 확인 | 저장 중 · 실패(500, 입력 유지, "두 번 기록되지 않음") · 충돌(409) · 중복 |
| 화면 상태 | 로딩(스켈레톤+sr 문구) · 조회 오류("기록이 없어진 것이 아닙니다"+다시 시도) · 기준 없음(기준 정하기) · 빈 상태(기준만, "없으면 그대로 두어도 손익이 맞습니다") | — |
| 설정 진입 행 | '내 계정' 바로 아래 새 섹션 "자산 기록" — 행: 입출금 기록 · 배지 · 손익(부호·%)·기준일 · 경고 칩(기록 안 된 변화·불일치·반영 대기·기준 미확정) · 기록 n건·마지막 · "입출금 기록 · 손익 보기 ›" | 로딩·오류·기준 없음 문구 |

### 설계 결정과 근거
1. **이름**: 주 숫자 "입출금 뺀 투자 손익", "순입금"은 처음 나오는 곳마다 "(넣은 돈 − 뺀 돈)". 분석가 Q4 — 기존 `today_change_pct`·평가손익은 입출금을 빼지 않은 값이라 같은 이름을 쓰면 혼동.
2. **색**: 빨강/파랑은 손익에만. 입금·출금 금액은 중립색 + 부호 + 종류 칩 — 입금이 '번 돈'처럼 빨갛게 보이는 것을 막는다. 경고·차단·기록 취소 버튼은 amber(T-066 선례: 빨강·파랑은 손익 뜻).
3. **오입력 방지(분석가 Q3 #1·#4·#5·#8)**: 부호 입력 거부(종류로 방향) · 금액 아래 즉시 '만 단위 읽기'(예 "205만 6,912원") · 확인 단계에서 "들어온/빠져나간" 문장 + 반영 뒤 손익 변화(전→후)를 저장 전에 보임 · 현재 총자산의 50% 이상 금액 경고(분석가 제안 "총자산 초과"보다 낮춤 — 2,000만원 계좌에서 200만→2,000만 자릿수 실수를 잡으려면 초과 기준으로는 못 잡음, 상수 `bigPct`) · 24시간 안 같은 금액 경고 · 환전 환율이 앱 환율과 ±3% 넘게 다르면 경고 · 저장 버튼 멱등(“두 번 눌러도 한 번”).
4. **기준 이전 차단**(분석가 Q2·Q3 #6): 날짜 선택기 `min` + 직접 입력 시 차단 상자("기준 총자산에 이미 들어 있어 같은 돈을 두 번 빼게 됨") + 저장 버튼 비활성 + 이유 문장.
5. **추가 전용**: 삭제 버튼 없음. 취소 = '취소됨'(사유 필수, 되살리기 가능, 되살릴 때 중복 주의 문구). 정정 = 새 기록 + 원래 기록 '정정됨 → #n'(정정된 기록은 되살리지 않음 — 이중 계상 방지). 취소·정정 확인 시 손익 전→후를 먼저 보인다.
6. **반영 상태 3종**(분석가 Q1⑤): ◌ 반영 대기(손익에서 빠져 있음을 그 자리에 명시) · ✓ 반영됨(근거 스냅샷·허용치 표시) · ! 불일치(기록대로 계산에 넣었음 + 확인 요청, 환전 같으면 [환전으로 정정] 제안 — Q3 #2).
7. **기록 안 된 변화**: 자동 기록 금지(task "하지 않는 것"). [입금으로 기록]은 폼을 채워 주기만 하고 사용자가 확인·저장. [입출금 아님]은 사유와 함께 남기고 되돌리기 가능. 알림 기준 문장을 카드에 그대로 인쇄(분석가 Q3 — 상수 한곳).
8. **환전**: 양쪽 금액 입력 → 적용 환율 유도, 앱 환율 대비 %·비용(추정) 표시(분석가 Q1④). "손익 영향 없음 · 기록은 선택"을 폼·목록·안내 세 곳에 — 사용자의 기록 부담을 줄이는 핵심 사실.
9. **달러 현금 두 값 안내(분석가 Q5) — 최소 문구 2곳**: 기준 현금 확인의 달러 칸 도움말 "KIS 앱 ‘외화예수금’을 넣으세요. ‘주문가능금액’은 아직 체결되지 않은 주문에 묶인 돈이 빠져 더 작게 보일 수 있습니다." + 기록 안내 1줄(같은 뜻). **사용자 답(분석가 Q5 질문 1)에 따라 바뀔 수 있다** — 답이 '외화예수금'이 아니면 문구 수정 필요.
10. **기준 미확정으로 시작 가능**: 기준 현금을 비워 두면 스냅샷 값으로 임시 계산하고 `임시` 표지를 단다. $118.60 확인 전에도 화면을 쓸 수 있고, 확인 뒤 기준 현금 확인으로 값을 넣으면 기준 총자산이 다시 계산된다(미리보기에 전→후·차액 근거).
11. **정확도 라벨**: 수익률 '근사', 환전 비용 '추정(기준 = 앱 환율, KIS 고시환율 아님)', 반영 전 달러 기록 원화 환산 '임시'. 확률·예측 없음.
12. **목록 vs 표**: 모바일은 2줄 목록 행(412px 에서 7열 표는 판독 불가), ≥900px 은 표(`ui-component-builder` "유용한 표를 카드로 바꾸지 말 것")로 분기.

### 진입 위치 비교

| | 기본안: 설정 › '자산 기록' 하위 화면 (`/settings/cash-ledger`) | 대안: 대시보드 자산 영역의 링크·요약 |
|---|---|---|
| 찾기 | 설정 탭 첫 화면, '내 계정' 바로 아래 한 줄 | 가장 자주 여는 화면에서 바로 |
| 범위·위험 | 새 화면 + 설정에 행 1개. 기존 숫자 무변경 | T-073(보류) 대시보드 개편과 겹친다 — 지금 그리면 개편 때 다시 바뀌고, 기존 손익(입출금 미보정) 옆에 다른 정의의 숫자가 나란히 서서 혼동 |
| 선례 | 리스크 정책(T-066) 요약 행 → 하위 화면과 같은 패턴 | 없음 |
| 대가 | 안전장치 카드가 행 하나(약 130px)만큼 아래로 내려간다(가려지지는 않음). 대안 배치로 '리스크 정책 행 바로 아래'도 가능하나 발견성이 낮다 | — |
| 결론 | **이번 채택** | T-073 에서 "입출금 뺀 손익 요약 + 이 화면 링크"를 추가하도록 제안 |

### 사용자에게 물을 질문 (권고 포함 — 데모 '결정 필요' D1~D4 와 같은 내용)
1. **진입 위치**: 설정 › '자산 기록'(내 계정 아래) 하위 화면으로 둘까요? — 권고: 예. 대시보드 요약·링크는 T-073 개편 때 추가.
2. **기준 시각 이전 입출금 (D2)**: 입력 차단 vs '기준 이전(참고)'로 저장만 허용 — 권고: 차단(분석가 권고, 손익 왜곡 원천 차단).
3. **현재 총자산 표시 (D1)**: 최신 스냅샷 + 밤 시간대 표지 vs 매일 아침 07~09시 값 고정 — 권고: 최신 + 표지(분석가 권고).
4. **수익률 % (D3)**: 원 단위 주 + '근사' 수익률 보조 vs 원 단위만 — 권고: 보조 표시.
5. **발생 시각 입력 (D4)**: 날짜+시각(분) 필수·"모르면 조금 이르게" 안내 vs 날짜만 필수 — 권고: 분 단위 필수(스냅샷 맞춤 정확도, 기준일 당일 기록 막힘 방지).

### 자체 점검 남은 항목 (P2·Minor — Leader 판단으로 v2 또는 구현 때)
- P2-1 '정상 + 기록 안 된 변화 + 반영 대기'가 겹치면 `+ 입출금 기록 추가` 버튼이 412px 첫 화면 아래(프레임 위에서 약 970px)로 밀린다. 후보 카드의 [입금으로 기록]이 첫 화면에 있어 막히지는 않음. 피드백이 있으면 머리 오른쪽 '+ 추가' 버튼을 검토.
- P2-2 환전 기록이 '불일치'일 때도 amber `!` 를 쓴다 — 손익 영향이 없는데 경고처럼 보일 수 있다. 구현 때 환전은 `◌ 확인 전`(중립)으로 낮추는 안 검토.
- P2-3 종류 선택의 환전 설명("원화↔달러 · 손익 영향 없음")이 412·360px 에서 2줄로 감긴다(넘침 없음).
- Minor-1 목록 행 버튼의 접근 이름이 길다(종류·금액·시각·통화·메모·상태·부가 정보 전부). 구현 때 `aria-label`="입금 1,000,000원, 09-03 10:00, 반영됨" 수준으로 줄이고 나머지는 펼친 상세에서 읽게.
- Minor-2 데모는 프레임을 통째로 다시 그려 손익의 `aria-live` 영역이 교체된다 — 변화 알림은 토스트(`role=status`)가 맡는다. React 구현에서는 영역이 유지되므로 해당 없음(추정).

### 구현 가이드 초안 (Developer 인계용 — 사용자 승인 전이라 아직 넘기지 않음)
승인 데모: **미승인 — v1 검토 대기** (승인되면 이 줄을 `mockups/T-074-cash-flow-ledger-vN.html (vN)` 로 바꾸고 차이를 반영) · 적용 토큰: `--bg`, `--bg2`, `--bg3`, `--bg4`, `--border`, `--border2`, `--text`, `--muted`, `--up`, `--down`, `--accent`, `--ok`, `--warn`, `--safe-top`, `--safe-bottom`, `--nav-h` (새 토큰 없음)

#### 0. 레이아웃 설계
- **목표**: 입금·출금·환전을 직접 기록해, 입출금을 뺀 투자 손익을 정직하게 보고 오기록을 저장 전에 막는다.
- **주요 위계**: ① 입출금 뺀 손익(원) ② 손익을 틀리게 하는 요인(기록 안 된 변화·반영 대기·불일치·기준 미확정·오래됨·밤 스냅샷) ③ 기록 추가 ④ 기록 이력 ⑤ 기준·안내.
- **영역**: 머리+띠 / `lg-top`(요약·후보·표지·추가) / `lg-list`(목록) / `lg-bot`(기준·안내). DOM 순서 = 모바일 시각 순서.
- **컴포넌트**: 아래 5절.
- **상태**: 로딩·오류·기준 없음·빈·정상 × 표지, 시트별 저장 중·실패·충돌·중복.
- **행동**: 주 = 기록 추가 / 보조 = 후보 기록·입출금 아님, 정정, 기준 현금 확인·기준 바꾸기 / 위험 = 기록 취소(확인 시트, 사유 필수).
- **반응형**: <900px 한 열(목록 행), ≥900px `grid-template-areas: "top list" "bot list"`(왼쪽 420px, 오른쪽 표), 시트는 하단 시트 → 가운데 대화상자(최대 520px).

#### 1. 화면 개요
- 진입: 설정 › '자산 기록' 행 → `/settings/cash-ledger`. 계좌 돈 이동·주문 없음(배지·띠로 명시). 안전장치 상태 표시와 무관한 화면(리스크 정책 화면과 같음).
#### 2. UI 구조 (데모 함수 인용)
```
CashLedgerPage
 ├ Head(back '/settings', '입출금 기록', DisplayBadge '◌ 기록·계산 전용') + Strip     ← ledgerScreen()
 └ main.app-body
    ├ load=loading → Skeleton / error → ErrorBox(reload) / !baseline → NoBaseline(BaselineSheet set)
    └ .lg-body
       ├ .lg-top: SummaryCard(summaryHtml) · FlowCandidateCard(candHtml) · TrustSignals(signalsHtml) · AddButton
       ├ .lg-list: ListHeader(void 토글) · EntryList(.only-m, 행=disclosure) / EntryTable(.only-d) · EntryDetail(entryDetail)
       └ .lg-bot: BaselineCard(baseCardHtml) · LedgerGuide(details)
 Sheets: EntrySheet(form → confirm: entryForm/entryConfirm) · CancelSheet · RestoreSheet · DismissSheet · BaselineSheet(set|change|confirm)
Settings: SectionHeader '자산 기록' + CashLedgerSummaryRow(rowSummary) — '내 계정' 링크 바로 다음
```
#### 3. API 호출 계획 (제안 — 경로·스키마는 Leader 확정, DDL 은 분석가 Q2 초안·사용자 승인 사항)

| 엔드포인트 | 메서드 | 파라미터 | 사용 필드 | 에러 처리 |
|---|---|---|---|---|
| `/api/cash-ledger` | GET | — | `baseline{at,snapshotId,totalKrw,krwCash,usdCash,fx,confirmed{krwCash\|null,usdCash\|null},version}` · `snapshot{id,ts,totalKrw,fx,stale,usdGapHint}` · `entries[]`(+`anchor{status,snapshotTs,detail}`·`void{type,reason,at,by}`·`supersedes`) · `summary{P,R,net,inflow,outflow,pending{count,krw},unmatched,voids,last}` · `candidates[]` · `rules{…}` · `now` | 실패 → 오류 상태("기록이 없어진 것이 아닙니다") |
| `/api/cash-ledger/entries` | POST | `clientEntryId`·`kind`·`occurredAt`(KST 분)·`currency`·`amount`·`counterCurrency?`·`counterAmount?`·`memo?`·`fromCandidateKey?`·`baseVersion` | 새 entry(반영 상태)·summary | 422 필드별 code(`before_baseline`·`future`·`amount`·`decimals`) / 409 `duplicate{existingId}`·`baseline_version` / 500 → 입력 유지 |
| `/api/cash-ledger/entries/:id/correct` | POST | 위 + `reason` | 새 entry·원래 entry | 409 `already_voided` |
| `/api/cash-ledger/entries/:id/cancel` | POST | `reason` | entry | 409 `already_voided` |
| `/api/cash-ledger/entries/:id/restore` | POST | — | entry | 409 `not_voided`·`superseded`(정정된 기록 복구 거부) |
| `/api/cash-ledger/baseline` | PUT | `snapshotId`·`confirmed{…}`·`baseVersion` | baseline | 409 `version{latest}` → "최신 기준 쓰기 / 내 값으로 저장" |
| `/api/cash-ledger/candidates/:key/dismiss` | POST | `reason` | candidate | 409 `already_handled` |
- 모두 인증 필요(`OAUTH_PUBLIC_PATHS` 에 넣지 않음). 클라이언트 검증은 UX 일 뿐 — 서버가 같은 규칙(기준 이전·미래·금액>0·통화·소수 자리·환전 양쪽)을 다시 검사.
- 취소·정정·복구 충돌 판정은 조건부 UPDATE(`WHERE id=? AND deleted_at IS NULL`, 영향 0행 → 409).
- **열린 결정(Leader)**: 반영 대기 → 반영됨 전환 시점(조회 때 지연 매칭 vs 스냅샷 cron 후처리). cron 은 안전 경로라 조회 시 매칭(별도 POST `/rematch` 포함)을 권고.
#### 4. 상태 관리
- 서버 상태: GET 결과 하나(`feed`), 저장 성공 응답으로 교체(낙관적 반영은 하지 않음 — 반영 상태·앵커가 서버에서 정해지므로). 
- 시트 상태: `{type, step(form|confirm), draft, saving, err{kind: fail|dup|conflict|conflictClose|baseConflict}}` — 데모 `M.sheet` 구조. 폼 닫을 때 미저장 draft 보관 → 다시 열면 "이어서 씁니다".
- 미리보기(확인 단계·취소·되살리기의 손익 전→후)는 `src/lib/ledger/compute.ts` 순수 함수로 클라이언트에서 계산(데모 `simCalc`).
- `clientEntryId` 는 폼을 열 때 만들고 재시도에도 유지.
#### 5. 생성/수정 파일 (안)
- 새로: `src/app/settings/cash-ledger/{page.tsx,CashLedgerPage.tsx}`, `src/app/settings/CashLedgerSummaryRow.tsx`, `src/components/ledger/{LedgerStyles,SummaryCard,FlowCandidateCard,TrustSignals,EntryList,EntryTable,EntryDetail,BaselineCard,LedgerGuide,EntrySheet,CancelSheet,RestoreSheet,DismissSheet,BaselineSheet}.tsx`, `src/components/ui/Sheet.tsx`(공용 대화상자 — 앱에 대화상자 기본 부품이 없고 삭제 확인은 `window.confirm` 뿐), `src/lib/ledger/{compute,validate,korean-amount,rules}.ts` + 단위 시험, API route(3절).
- 수정: `src/app/settings/SettingsPage.tsx`('내 계정' 다음에 SectionHeader '자산 기록' + 행), `docs/screens.md`(설정 절에 '자산 기록 — 입출금 기록 행', 서브 화면 `/settings/cash-ledger` 항목: 요약·후보·표지·목록·기준·시트·추가 전용·반영 상태 3종).
- 재사용: `StatusText`(상태 어휘), `.mode.disp` 배지, `Toast`(`useToast`) — 토스트·오류 문구는 데모 그대로.
- `Sheet` 요구: `role=dialog`·`aria-modal`·`aria-labelledby`, 열 때 첫 입력(없으면 제목) 포커스, Tab 가두기(라디오 묶음은 선택된 것만), Esc 닫기(저장 중 제외), 배경 `inert`+스크롤 잠금, 닫을 때 연 버튼으로 포커스 복귀(사라졌으면 목록 제목).
#### 6. 구현 순서
1. 순수 함수(compute·validate·krRead·rules) + 단위 시험 — reference 는 분석가 "확인하지 못한 것"의 대조 구간을 **합성 데이터로 옮겨** 사용, 데모 수치(P +830,000원, R +3.99%, 후보 기록 뒤 +130,000원)와도 대조.
2. API(Leader 확정·DDL 사용자 승인 뒤) → 3. `Sheet` → 4. 화면 본문·상태 → 5. 시트 5종 → 6. 설정 행 → 7. `docs/screens.md`.
#### 7. 주의사항
- 기존 화면 숫자(대시보드 등) 미변경. KIS 호출·주문·`position_state`·`orders` 쓰기 없음.
- 시각은 KST 벽시계 분 단위(스냅샷과 같은 규약). `<input type=date>` `min`=기준일·`max`=오늘, `<input type=time step=60>`.
- 금액: `inputmode` numeric(원)/decimal(달러), 쉼표 허용·부호 거부, 원 소수 금지·달러 2자리.
- 상수는 `rules.ts` 한곳(5만원·$50·허용치 ±1,000원/±$1·36시간·50%·3%)이고 화면 문장도 그 상수로 찍는다.
- 412·360px 가로 넘침 0, 목록/표 분기는 `@media (min-width: 900px)`(데모의 container query 를 대체). 숨긴 쪽(목록·표)의 id 가 겹치지 않게.
- 달러 현금 안내 문구는 사용자 답(분석가 Q5 질문 1)에 따라 수정될 수 있다.

```json
{ "taskId": "T-074", "status": "DONE", "deliverables": ["mockups/T-074-cash-flow-ledger-v1.html", "task Designer 절(화면 구성·결정·진입 비교·질문 5·구현 가이드 초안)"], "blockers": ["사용자 데모 승인 전 — 구현 가이드 미인계", "API 경로·반영 매칭 시점 Leader 확정 필요", "달러 현금 안내 문구는 분석가 Q5 질문 1 답에 의존"], "risk_level": "MEDIUM" }
```

### 구현 점검 (T-074 v1)

- [12:00] Leader 요청 ④ 구현 후 디자인 점검. 승인 데모 v1(`eab12bff…`) ↔ WP-B 구현을 실제 브라우저로 대조했다. `src/`·`scripts/`·`mockups/` 수정 0, git 쓰기·배포·pm2 0, 운영/공용 DB 접근 0, `.env` 출력 0, `check.mjs` 상태 변경 명령 0.
- [12:00] 디자인 스킬: design-review·a11y-review / 구현 점검 P0 0·P1 2(1건 조건부)·P2 6(+선택 2·후속 1), a11y Critical 0·Major 0·Minor 5
- [12:00] **판정: 수정 필요(경미)** — 데모 일치도는 높다(412·360·1280 모든 상태가 데모와 같은 배치·문구·색). 막는 결함(P0)은 없고 P1 2건(토스트가 시트를 가림 · 마이그레이션 전 503 표시)을 고치면 된다.

#### 점검 환경
- 격리 사본: `scratchpad/t074-iso-b` 를 `scratchpad/t074-dsg` 로 복사(작업 트리 T-074 파일 63개와 바이트 대조 bad=0, 빌드는 11:14 것 — 그 뒤 바뀐 것은 시험 파일 1개뿐).
- 일회용 DB: 로컬 `mariadb:11`(11.8.8) 컨테이너 `t074-dsg-db`, `127.0.0.1:33076` 전용, 마이그레이션 SQL 적용, **합성 데이터만**(데모 흐름을 지금 시각으로 옮긴 스냅샷 5~11행 + API 로 넣은 기록 — 실제 계좌 값 0). 시나리오: 정상·빈·기준 없음·기준 미확정·오래됨(4시간)·밤(달러 $250 왕복)·불일치(환전 제안)·후보 3건.
- 서버: `env -i` + `DB_*`=일회용 DB, 임시 세션 서명키(로컬 전용 문자열), `DRY_RUN=true KILL_SWITCH=true CRON_WATCHDOG_ENABLED=false`, `next start -H 127.0.0.1 -p 3976`, **`NODE_OPTIONS=--require scratchpad/block-external-net.cjs` — 시작 로그 첫 줄 `[block-external-net] 로컬 외 TCP 연결 차단 활성` 확인.** 서버 로그의 외부 연결 시도 0건(차단 메시지 0·환율 조회 0). 시드 스크립트도 같은 사전 로드로 실행.
- 브라우저: playwright-core + 로컬 Chrome, `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"` + 컨텍스트 라우트로 127.0.0.1·file 외 요청 중단(중단된 요청 0건). 인증은 로컬 서명키로 만든 세션 쿠키(운영 자격증명·세션 미사용).
- 끝나고 서버 종료·컨테이너 제거·포트 3976/33076 닫힘 확인(12:00). 스크린샷·스크립트는 `scratchpad/t074-dsg-work/`(합성값만, 저장소 밖).

#### A. 데모 대조 (412·360·1280)
- **일치**: 머리·배지·띠, 요약 카드(공식 줄·6칸), 후보 카드, 신뢰도 표지 5종(문구 그대로), 목록 행(칩·#·금액 중립색·상태·부가 줄), 펼친 상세·동작 버튼, 기준 카드, 안내, 로딩 스켈레톤, 기준 없음, 빈 상태, 데스크톱 2열(왼쪽 420px + 표), 설정 '자산 기록' 행. 빨강/파랑은 손익에만(입금·출금 금액 중립) 확인. 시트: 추가 폼·기준 이전 차단(`aria-invalid`·확인하기 비활성·이유 문장)·자릿수 경고(2천만 출금 → "절반이 넘는 금액")·부호 거부·환전(적용 환율 +0.22%·비용 추정)·확인 단계(바로 반영 +705,000 → +5,000원)·취소·되살리기·입출금 아님·기준 확인/바꾸기·실패 500(다시 시도 → 1건 저장)·중복 409·기준 버전 충돌 → '새 기준으로 기록하기'·다른 곳에서 먼저 취소 → '닫고 최신 목록 보기' 전부 데모 문구·버튼 구성대로.
- 측정(모든 상태·펼침·시트): 가로 넘침 0 · 44px 미만 터치 0 · 11px 미만 글자 0 · 중복 id 0 · 콘솔 오류 0. 대비: muted/bg2 5.66 · warn/경고상자 7.59 · ok/bg2 7.64 · 상승 빨강/bg2 4.63 · 하락 파랑/bg2 4.73 · 검정/accent 9.78 — 모두 4.5:1 이상.
- 토스트: `role=status`·`aria-live=polite`, 412px 에서 줄바꿈(잘림 0), 하단 탭 위 16px. 데스크톱 시트 520px 가운데.

#### B. 접근성 (실제 브라우저)
- 통과: 시트 `role=dialog`·`aria-modal`·`aria-labelledby=sh-t`, 열면 기록 폼 = 금액 칸·나머지 = 제목, Tab 30회 시트 밖 0회(라디오 묶음 1개 정지), Esc 닫기 → 연 버튼 복귀(`lg-add`·`lg-bs-conf`·`lgt-ac-*-cor`), 저장 성공 뒤 목록 제목, 배경 body 자식 전부 `inert` + 스크롤 잠금·복원, 포커스 링 2px `--text`, 상태는 기호(aria-hidden) + 글자(색만으로 전달 0), 폼 오류 `aria-describedby`·`aria-live`, 표 `caption`·`th scope`. 접근성 트리 스냅샷 `scratchpad/t074-dsg-work/aria-*.yml`.
- Minor 5건은 아래 수정 목록.

#### C. Developer ★ 판단
1. **P2-2 딸린 문장 변경 → 채택.** 환전은 순입금에 들어가지 않으므로 "기록대로 계산에 넣었습니다"는 사실과 달랐다. 상세 "◌ 확인 전 … 환전이라 손익 영향은 없습니다"·토스트 "‘확인 전’으로 표시했습니다(손익 영향 없음)" 를 실제로 확인했고 상태 어휘와 일치한다.
2. **화면 내 토스트 → 채택(조건: P1-1 수정).** 공용 `Toast.tsx` 는 `role`/`aria-live` 없음·`nowrap`+말줄임·3초를 코드로 확인 — 결과 문장(손익 전→후)이 핵심인 이 화면에는 부적합. 단 z-index 60(시트 50 위)이라 시트를 가리는 결함이 있다(P1-1). 공용 토스트 개선·통합은 별도 task 로(후속).
3. **기준 현금 확인 시트를 확인값으로 채워 열기 → 채택 + 수정 요구(P2-1).** 빈 칸으로 열면 그대로 저장할 때 확인값이 지워진다 — 데모의 빠뜨림이었다. 다만 미리보기 기준점이 스냅샷 값이라, 확인값(예 $1,400)이 이미 저장된 상태에서 아무것도 안 바꿔도 "기준 총자산 16,060,000원 → 15,936,000원 · 달러 −$100.00 × 1,240" 처럼 바뀌는 것으로 읽힌다(재현 확인). 정하기·바꾸기는 빈 칸 유지가 맞다.
4. **후보 여러 건 → 수정 요구(P2-2).** 후보 3건이면 카드 3장(각 약 265px)이 모두 "…변화 1건" 제목·같은 손익 문장·같은 알림 기준 문장을 반복하고 '+ 입출금 기록 추가'가 약 1,380px 로 밀린다(스크린샷 `el-multicand-412-top.png`). 기준: **열린 후보 2건 이상이면 카드 1장으로 묶음**(제목 "기록 안 된 입출금 같은 변화 N건", 줄마다 `시각 · 통화 현금 ±금액 · [입금/출금으로 기록] [입출금 아님]`, "위 손익에 섞여 있습니다" 문장과 알림 기준 문장은 한 번). **'입출금 아님' 표시는 가장 최근 1건만 지금 모양으로 두고 2건째부터 "입출금 아님으로 표시한 변화 n건 더 보기"(접힘 disclosure)** — 건수 기준, 기간으로 숨기지 않는다(되돌리기 경로 유지, 서버 스캔 창이 이미 기간을 제한). 표시된 카드 테두리는 amber 점선 대신 중립 `--border2` 점선(해결된 상태를 경고처럼 보이지 않게). 실데이터는 지금 후보 1건이라 묶음은 이번 또는 후속 중 Leader 판단, 표시 카드 접기·중립 테두리는 이번 권고.
5. **상태 조각 원장 전용 복제 → 채택.** `St` 와 T-066 `StatusText` 마크업·클래스, `.lg .st*` 와 `.rp .st*` CSS 가 한 글자도 다르지 않음을 대조했다(시각 차이 0). 후속으로 리스크 경계 밖의 공용 `components/ui/StatusText` + `.st` 공용 스타일로 올려 두 화면이 함께 쓰게(별도 task — T-066 파일·경계 시험을 건드림).
- (그 밖의 차이) 7 "(기록 뒤 첫 스냅샷 환율 …)" 새 문구·9 `$250.00` 표기 → 채택. `fxMissing`·`scanTruncated`·`persisted` 미표시 → P2-6 참고.

#### D. 디자인 스킬 점검 (ui-design-reviewer · ui-accessibility-reviewer)
| 심각도 | 위치 | 문제 · 재현 | 권고 |
|---|---|---|---|
| **P1-1** | `CashLedgerPage.tsx` `openSheet` · `LedgerStyles` `.lg .toast`(z 60) vs `SHEET_CSS` `.sheet-root`(z 50) | 결과 토스트(7초)가 떠 있는 동안 다른 시트를 열면 토스트가 시트 위에 그려져 **확인 단계의 손익 전→후 줄·취소 시트 안내·기준 미리보기**를 가린다. 재현: 입출금 아님 → 되돌리기 → 7초 안에 '입금으로 기록' → 확인하기(`k-confirms.png`·`k-cancel-base.png`·`k-errs.png`). 토스트는 그때 배경과 함께 `inert` 라 읽히지도 않는다. 데모도 같은 층 순서였다(내 데모의 빠뜨림). | 시트를 열 때 토스트와 타이머를 지운다(`setToast(null)`). 보조로 `.lg .toast` z-index 를 시트 아래로. |
| **P1-2 (조건부)** | `useLedgerFeed.fetchLedgerFeed`(응답 `code` 버림) · `CashLedgerRowSummary` 오류 분기 · `LedgerBody` 오류 분기 | 마이그레이션 전(지금 운영) 503 `not_migrated` 이면 **설정 첫 화면 행이 amber "! 불러오지 못했습니다 — 눌러서 다시 확인"** 으로 늘 보이고, 원장 화면은 "기록이 없어진 것이 아닙니다"가 두 번(화면 문장 + 서버 문장) + "마이그레이션(T-074) 적용 전" 기술 용어 + 소용없는 '다시 시도'. 코드를 DDL 보다 먼저 배포하면 사용자는 고장으로 읽는다. | ① (권장·Leader) DDL 을 코드와 같은 배포 창에 적용 → 이 상태가 운영에 안 나온다. ② 코드 쪽: `code==='not_migrated'` 를 따로 — 설정 행 `◌ 준비 중 — 서버 준비 뒤 쓸 수 있습니다`(중립 `na`), 원장 화면 중립 상자 한 문장 + '다시 시도' 숨김, 서버 문장 중복 제거. ①이면 P2 로 내려도 된다. |
| P2-1 | `BaselineSheet` `basePreview`(confirm 모드) | ★3 미리보기 기준점이 스냅샷 값 → 변화 없는데 "→ 15,936,000원" 표시, 달러 칸을 비우면 "16,060,000원"만(지금 값 15,936,000 대비 변화가 안 보임). | confirm 모드는 지금 기준 총자산(`baselineTotalKrw`)과 비교: 같으면 "기준 총자산 15,936,000원 (지금과 같음)", 다르면 "15,936,000원 → X" + 저장된 확인값 대비 차이. 스냅샷 값은 칸 아래 도움말(이미 있음)로. |
| P2-2 | `FlowCandidateCard`·`LedgerBody` 후보 반복 · `.lg .cand.done` | ★4 — 위 C-4 기준. | 묶음 카드·표시 카드 접기·중립 테두리. |
| P2-3 | `BaselineSheet` 기준 스냅샷 fieldset 의 `.hint` · `LedgerStyles` `.lg .field .hint` | 정하기·바꾸기 시트의 "아침 07~09시 스냅샷을 권장합니다…" 가 `.field` 밖이라 규칙이 안 걸려 **14px·본문색**으로 보인다(측정). 데모에도 있던 CSS 구멍. | `.lg .hint` 로 넓히거나 `.lg .kseg > .hint` 추가(12px·muted·margin-top 4px). |
| P2-4 | `EntryList` 행 `.m`(메모 포함 meta) | 메모 200자면 접힌 행 머리가 13줄로 길어진다(360px, `long-360-row.png`). 메모 전문은 펼친 상세에 이미 있다. | 접힌 행 `.m` 을 2줄 말줄임(`-webkit-line-clamp: 2`), 상세는 그대로. |
| P2-5 | `TrustSignals` 밤 표지 | 판정은 데이터로 하는데 문장은 "(16~06시)" 고정 → 낮 시각과 함께 나오면 "이 시각(11:34)…시간대입니다(16~06시)"처럼 모순(합성 데이터로 재현). | "(보통 16~06시)"로 바꾸거나 시각 범위 밖이면 괄호를 뺀다. |
| P2-6 | `summary.fxMissing`·`scanTruncated` 미표시 | 환율이 없어 계산에서 뺀 달러 기록이 있으면 손익이 틀리는데 표지가 없다. | `fxMissing>0` 이면 amber 표지 "! 환율이 없어 계산에서 뺀 달러 기록 n건 — 다음 스냅샷에서 다시 계산합니다". `scanTruncated` 는 후보 카드 아래 muted 한 줄 "최근 N일 스냅샷만 대조했습니다". `persisted:false` 는 숫자가 맞으므로 표시 불필요. |
| 선택 | `useLedgerFeed` | 주기 재조회 없음 — 탭을 다시 열기 전까지 반영 대기가 안 바뀐다. | `visibilitychange`(화면으로 돌아올 때) 조용한 `refresh()` 1회. |
| 선택 | `LedgerStyles` ≥900px | 넓은 화면에서 표가 끝까지 늘어난다. | `.lg .app-body` 최대 폭(예 1240px) 가운데 정렬. |
| 후속 | 공용 부품 | ★2·★5 로 생긴 중복(토스트·상태 조각). | 별도 task: 공용 `Toast` 접근성·줄바꿈 개선 후 통합, 공용 `StatusText` 로 승격. |
| a11y Minor-1 | `view.rowAriaLabel` | 행 접근 이름에 `#번호`가 없다. 상세·상태·표지가 "#4 를 정정한 기록"·"정정됨 → #5"·"#54 기록 보기"로 번호를 쓰므로 읽기 프로그램 사용자는 어느 행인지 맞출 수 없다(내가 제안한 Minor-1 형식의 빠뜨림). | "#7 입금 500,000원, 10-23 11:33, 반영 대기". |
| a11y Minor-2 | `SummaryCard` `.sc-big aria-live` | 쓰기 뒤 토스트가 손익 전→후를 읽는데 요약 숫자도 live 라 조회·교체 때 이중 낭독 가능(TalkBack 미확인). | `.sc-big` 의 `aria-live` 제거(결과 전달은 토스트가 맡음). |
| a11y Minor-3 | `CancelSheet`·`DismissSheet` 사유 라디오 | '기타'를 고르면 포커스가 글 칸으로 옮겨져 방향키로 라디오를 돌던 흐름이 끊긴다(데모 동작 그대로). | 포커스 이동 없이 글 칸을 라디오 바로 뒤 탭 순서에 둔다. |
| a11y Minor-4 | `EntryList` `ul aria-labelledby=lg-list-t` | 취소·정정 보기 중에도 목록 이름이 "기록 5건"(실제 항목 7개). | 목록에 `aria-label="입출금 기록 목록"`. |
| a11y Minor-5 | 취소·입출금 아님 시트 `conflictClose` | '닫고 최신 목록 보기'만 남은 뒤에도 사유 라디오가 활성. | 그 상태에서 입력 비활성. |
- 범위 밖 관찰: 공용 `BottomTabs` 의 포커스 표시가 브라우저 기본(어두운 1px)이라 하단 탭 배경에서 거의 안 보인다 — T-074 아님, 필요하면 별도.

#### E. 못 본 것
- 실제 갤럭시 S25+ 크롬: 터치·안전 영역·**가상 키보드가 하단 시트 입력 칸을 가리는지**, 날짜·시각 선택기 모양.
- TalkBack 낭독(시트 진입 안내·토스트·요약 live 이중 낭독 여부).
- 마이그레이션 적용 뒤 실데이터 화면, 운영 MariaDB 10.11, 실제 '외화예수금' 문구 적합성(사용자 Q5 답 대기).

#### Developer 에게 넘길 수정 목록 (심각도 순 — 배정은 Leader)
1. P1-1 시트 열 때 토스트 지우기(+ z-index 를 시트 아래로).
2. P1-2 `not_migrated` 표시 — Leader 가 DDL 동시 적용을 정하면 생략 가능, 아니면 설정 행 중립 '준비 중' + 원장 화면 중립 상자·다시 시도 숨김·문장 중복 제거.
3. P2-1 기준 현금 확인 미리보기 기준점 = 지금 기준 총자산.
4. P2-3 `.hint` CSS 범위.
5. P2-2 후보 묶음/표시 카드 접기·중립 테두리(묶음은 Leader 판단으로 후속 가능).
6. P2-4 접힌 행 메모 2줄 말줄임 · P2-5 밤 표지 괄호 문구 · P2-6 `fxMissing` 표지.
7. a11y Minor-1~5.
8. (선택) 돌아올 때 조용한 재조회 · 넓은 화면 최대 폭. (후속 task) 공용 Toast·StatusText.

```json
{ "taskId": "T-074", "status": "DONE", "deliverables": ["task Designer 절 '구현 점검 (T-074 v1)'", "scratchpad/t074-dsg-work/ (스크린샷·접근성 트리·점검 스크립트, 합성값만)"], "blockers": [], "risk_level": "LOW" }
```

### 델타 점검 (Stage 3)

- [12:25] Developer `### Stage 3 — designer 점검 반영`의 코드 diff(Stage 2 사본 대비)를 읽고, Stage 3 빌드(`t074-iso-b`, 작업 트리와 바이트 대조 bad=0, 빌드 12:14)를 화면으로 다시 확인했다. 환경은 이전과 같다. 일회용 `mariadb:11`(127.0.0.1:33076, 합성값만), 서버 `NODE_OPTIONS=--require …/block-external-net.cjs`(시작 로그 첫 줄 차단 활성 확인), 준비 확인은 `/login`(`/api/health` 안 씀). 서버 로그의 외부 연결 시도 0건(`[fx]` 0줄), 브라우저 외부 요청 0건. 끝나고 서버 종료·컨테이너 제거·포트 닫힘 확인(12:25). `src/`·`scripts/`·`mockups/` 수정 0, git·운영 DB·배포 0.
- [12:25] **판정: 반영 확인 — 차단할 수정 없음.** P1 2건·★3·★4·P2 6건·a11y Minor 5건 모두 의도대로 들어갔다. Developer가 물은 ★ 3건은 문구·표시만 경미하게 고치기를 권한다(P2, 비차단).

#### 1. 반영 확인
| 항목 | 판정 | 근거 |
|---|---|---|
| P1-1 토스트·시트 | 반영 | `openSheet` 첫 줄 `clearToast()`(타이머까지), `.lg .toast` z-index 45 < 시트 50. Developer 브라우저 확인(시트 열면 토스트 `display:none`)과 코드가 맞다. |
| P1-2 준비 중 | 반영 | `isNotMigrated` = 상태 503 **그리고** code `not_migrated`일 때만. 원장 화면은 중립 상자 한 문장(`role=status`, 다시 시도 없음), 설정 행도 같은 문장. 실제 표 이름 변경 → 두 화면 모두 "◌ 준비 중 — 서버 준비 뒤 쓸 수 있습니다" 확인. |
| ★3 / P2-1 현금 확인 미리보기 | 반영 | 현금 확인 모드는 `baselineTotalKrw`와 지금 확인값을 기준으로 비교하고, 안 바꾸면 "(지금과 같음)"으로 보인다. 칸을 비우면 스냅샷 값으로 돌아가는 차이도 보인다. 정하기·바꾸기는 그대로. |
| ★4 / P2-2 후보 묶음·접기 | 반영 | 열린 후보 3건이 카드 1장(약 430px, 이전 카드 3장 약 800px)으로 묶이고, 알림 기준 문장은 한 번. 표시 2건이면 최근 1건 + "1건 더 보기" 접힘, 테두리 `--border2` 점선. 412·360px 가로 넘침·작은 터치·작은 글자 0. |
| P2-3 ~ P2-6 | 반영 | 도움말 `.lg .kseg > .hint` 12px·muted, 접힌 행 메모 2줄 말줄임, 밤 괄호는 실제 시간대일 때만, `fxMissing` 표지·스캔 안내 추가. |
| a11y Minor-1 ~ 5 | 반영 | "#n" 접근 이름, `.sc-big` live 제거, '기타' 포커스 이동 없음, 목록 이름 고정, 충돌 뒤 사유 입력 비활성(취소·입출금 아님 둘 다). |

#### 2. Developer ★ 3건 판단
1. **방향이 섞인 묶음 문장 → 수정 요구(경미).** 지금 문장 "입출금이었다면 기록해 주세요. 기록하기 전까지 이 돈은 위 손익(…)에 투자 손익처럼 섞여 있습니다"는 틀리지 않다. 다만 여러 건인데 "이 돈은"이라고 쓰고, "투자 손익처럼"은 한 방향일 때의 "번/잃은 돈처럼"보다 추상적이다. 또 묶음 카드에서는 이 이유 문장이 버튼 아래에 와서 단일 카드의 순서(사실 → 이유 → 버튼 → 기준)와 다르다.
   - 대안 문구(방향 섞임): "입금·출금이었다면 줄마다 기록해 주세요. 기록하기 전까지 이 변화들은 위 손익(−305,000원)에 **투자로 번 돈·잃은 돈처럼** 섞여 있습니다."
   - 한 방향이고 2건 이상이면 "이 돈은"을 "이 변화들은"으로.
   - 이 문장을 목록 위(제목 바로 아래)로 옮긴다.
   - 버튼마다 `aria-describedby`로 그 줄을 붙인 것은 채택.
2. **접힘 표시 ▾/▴ → 수정 요구(경미).** 기본 표시가 사라지니 보이는 표시가 필요하다는 판단은 맞다. 문제는 두 가지다. 펼쳤을 때도 글자가 "… 1건 더 보기 ▴"라 말이 어긋난다. 또 접근성 트리에 삼각형 기호까지 이름으로 들어간다(확인함).
   - 권고: 기록 안내(`details.guide`)와 같은 방식으로 맞춘다. 요약 글자는 "입출금 아님으로 표시한 변화 n건"으로 하고, `::after`를 "펼치기 ▾" / "접기 ▴"로 둔다.
   - 기호를 읽히지 않게 하려면 `content: "펼치기 ▾" / "펼치기"`처럼 대체 텍스트 문법을 쓴다(선택).
3. **스캔 안내 "최근 스냅샷만 대조했습니다"(N일 뺌) → 일수 생략은 채택, 문장은 보강 요구(경미).** 응답이 실제 대조 범위를 주지 않으니 `scanDays`(120)를 쓰지 않은 것이 정직하다. 다만 지금 문장만으로는 사용자가 무엇을 놓칠 수 있는지 모른다.
   - 대안: "스냅샷이 많아 최근 것만 대조했습니다 — 그보다 오래된 기록 안 된 변화는 여기 보이지 않을 수 있습니다."
   - 이 안내는 화면 재현 없이 코드로만 봤다(`scanTruncated` 데이터를 만들지 않음).

#### 3. 새 위험 — "준비 중"이 오류를 가리는가
- **실측(브라우저, 원장 화면·설정 행 둘 다):** 아래 경우는 모두 기존 amber 경고 + 다시 시도로 남았다.
  - 다른 code의 503(`auth_not_configured`)
  - 본문 없는 HTML 503(프록시 오류 모양)
  - 500 `server_error`
  - **500인데 code가 `not_migrated`**
  - 네트워크 끊김
- "준비 중"은 실제 서버 503 `not_migrated` 하나에서만 나왔다. 일시적 서버 오류가 "준비 중"으로 보이는 경로는 없다.
- 남은 주의(비차단, 설계 메모): 서버 `isNoTable`은 **어느 표든** 없으면(1146) `not_migrated`를 낸다. 운영 DDL을 적용한 뒤에는 "준비 중"이 다시 나오면 안 된다. 나온다면 표 유실 같은 실제 장애를 중립 문구가 가리는 셈이다.
  - 필요하면 WP-A에서 원장 표 이름으로 좁히거나, DDL 적용 뒤 이 분기를 다시 볼지 정한다. Leader·Reviewer 판단이고 designer 범위 밖이다.

#### 4. 수정 요구 목록 (모두 P2·비차단 — 배정은 Leader)
1. 묶음 카드 섞임 문장 문구와 위치(위 2-1).
2. 접힘 요약을 "펼치기 ▾ / 접기 ▴" 방식으로(위 2-2).
3. 스캔 안내 뒤에 놓칠 수 있는 내용 한 마디 추가(위 2-3).

```json
{ "taskId": "T-074", "status": "DONE", "deliverables": ["task Designer 절 '델타 점검 (Stage 3)'"], "blockers": [], "risk_level": "LOW" }
```

## Leader 확정 (구현 착수 — 2026-10-23 09:3x)
- **승인 해석**: 사용자 원문 "T-074 작업 진행해줘"(Artifact 링크와 '권고대로 승인' 요청 뒤)를 **데모 v1 + Designer 질문 5개·D1~D4 의 권고안 그대로 승인**으로 해석해 `check.mjs approve --version 1` 로 기록했다(해시 `eab12bff…`). 사용자에게 이 해석을 알렸다 — 다른 선택(예: 기준일 이전 입력 허용, 날짜만 입력)을 원하면 구현 전에 바꿀 수 있다.
- **API·경로 확정**: 화면 `/settings/cash-ledger`, API `/api/cash-ledger/*` (Designer 3절 표 그대로) + `POST /api/cash-ledger/rematch`. 모두 인증 필요(`OAUTH_PUBLIC_PATHS` 에 넣지 않음).
- **반영 대기 → 반영됨 전환 = 조회 시 지연 매칭**(GET 때 `portfolio_snapshots` 와 대조, 필요 시 `rematch`). **크론·스냅샷 생성 코드는 건드리지 않는다**(안전 경로).
- **기준(opening)** = `system_config` 키 `cash_ledger_baseline` 한 개, T-066 `src/lib/risk/policy-store.ts` 의 version·history·낙관적 잠금 패턴 재사용.
- **DDL** = Analyst Q2 초안(`cash_flow_ledger`)을 `scripts/migrations/T-074-cash-flow-ledger.sql`(멱등, `setupDB`/`src/lib/db.ts` 에 넣지 않음)로. **운영 DDL 적용은 QA 통과 뒤 사용자 명시 승인 후에만.** 일회용 MariaDB(로컬 `mariadb:11`)에서 시험하고 운영 10.11.11 호환(CHECK·PERSISTENT 생성열 — 분석가 실측)은 문서·구문으로 점검. 마이그레이션 SQL 은 T-075 로 `SAFETY_PATHS` 대상이 되었으므로 **커밋 시 Reviewer 판정 scope 에 포함**돼야 한다.
- **달러 현금 안내 문구**는 데모 문구 유지(사용자의 Q5 답에 따라 나중에 수정 가능).
- **단계**: Developer WP-A(순수 함수·DDL·저장 계층·API·시험) → WP-B(공용 `Sheet`·화면·설정 행·`docs/screens.md`) → Reviewer → QA → 사용자 DDL 승인 → 오프아워 배포. 사용자가 지시한 순서: 이 작업은 T-070·T-075·T-076 정리 뒤 대시보드(T-073)보다 먼저.
- **금지**: KIS 호출·주문·`position_state`·`orders`·`executions` 쓰기, 기존 화면 숫자 변경, 실제 계좌 값을 시험·문서에 사용(합성값만).

## Developer

### Stage 1 — WP-A 구현 (백엔드: 순수 함수·DDL·저장 계층·API·시험)

- [10:28] 범위·방법: 지시대로 `src/lib/ledger/**`·`src/app/api/cash-ledger/**`·`scripts/migrations/T-074-cash-flow-ledger.sql`·각 `__tests__` 만 새로 만들었다(**기존 파일 수정 0** — `db.ts`·`safety`·`signals`·`exchanges`·`strategy`·`cron`·`middleware.ts`·화면 `*.tsx` 무변경). 기준 HEAD `fa0669c`. 검증은 격리 사본 `scratchpad/t074-iso-a`(= `git archive HEAD` + 내 파일만, `node_modules` 링크, 동기화 `scratchpad/t074-a-sync.sh` 바이트 대조 bad=0)에서만 했다. git 쓰기·배포·pm2·KIS·외부 네트워크 0, 운영/공용 DB 쓰기 0, `.env` 출력 0, 훅 스크립트 실행 0. 운영 DB 는 읽기 전용 러너로 3번만 조회했다(① `VERSION`·`sql_mode`·`SHOW CREATE TABLE users/accounts/system_config/portfolio_snapshots`·키 목록·positions JSON **키 구조** ② 소스 분포·행 간격 ③ 10-16 이후 스냅샷 — 출력은 scratchpad 임시 파일로만 받아 격리 사본 임시 스크립트가 **개수·예/아니오만** 내고 곧바로 둘 다 지웠다. 값은 어디에도 남기지 않았다). 시험·fixture 는 전부 데모와 같은 합성값.

#### 1. 변경 파일 (전부 신규)

| 파일 | 줄 | 요지 |
|---|---|---|
| `src/lib/ledger/rules.ts` | 102 | 상수 한 곳 `RULE`(데모 키 그대로 krw 5만·usd $50·tolKrw 1,000·tolUsd $1·tolPct 0.1·windowH 36·bigPct 50·fxWarnPct 3 + dupWarnH 24·staleH 3·memoMax 200·X 왕복 허용치·scanDays 120·금액 상한), `tolKrwFor/tolUsdFor`, `candidateRuleSentence()`(후보 카드 문장), `isUsd()`, system_config 키 이름 |
| `src/lib/ledger/kst.ts` | 86 | KST 벽시계 파싱·형식(서버 TZ 무관, DB Date → +9h) |
| `src/lib/ledger/korean-amount.ts` | 73 | `krRead`(데모 이식, 만 단위) · 원/달러/환율 표기(− = U+2212) |
| `src/lib/ledger/compute.ts` | 287 | `computeSummary`(데모 `calc`) · `baseTotal` · `krwEquivOf`(`keq`) · `simulateSummary`(`simCalc`) · `predictAnchor`(`predict`) · `draftEntryView`(`buildEntry`) · `exchangeRate/exchangeCostKrw` · 정수 돈 산술(`usdToKrw` BigInt) |
| `src/lib/ledger/validate.ts` | 272 | `parseAmount`(데모 `parseAmt`, 문구 그대로) · `parseCash`(0 허용) · `validateEntryInput`(데모 `validateEntry` + 서버 추가 검사) · `toFieldErrors` · 키 형식 검사 |
| `src/lib/ledger/snapshots.ts` | 193 | 스냅샷 해석(KRW free/locked·USD 센트·환율·보유) · 연속 단계 · `isExchangeLike` · **USD Y ↔ Y+X 왕복 탐지**(`detectUsdFlips`, 지금 빠져 있으면 `gapHint`) |
| `src/lib/ledger/match.ts` | 268 | 지연 매칭(입금·출금·환전, 허용치·36h 창·소비 키·환전 정정 제안) |
| `src/lib/ledger/candidates.ts` | 72 | 기록 안 된 입출금 후보(안정 키 `${스냅샷 id}-${통화}`) |
| `src/lib/ledger/store.ts` | 664 | DB 계층(아래 3절 쓰기 범위), 트랜잭션 정정·복구, 기준·후보 표시 낙관적 잠금 |
| `src/lib/ledger/service.ts` | 565 | 화면 데이터 구성(`buildFeed`) · 쓰기 흐름 8개 |
| `src/lib/ledger/handlers.ts` | 93 | HTTP: `requireUserId` 이중 확인 · 응답 봉투 · 503/500 변환 |
| `src/lib/ledger/types.ts` | 359 | **WP-B 용 API 타입**(4절) |
| `src/app/api/cash-ledger/**/route.ts` | 9 × 13 | 라우트 9개(연결만) — 3절 표 |
| `scripts/migrations/T-074-cash-flow-ledger.sql` | 83 | `cash_flow_ledger`(가산 전용, `IF NOT EXISTS`, 되돌리기 주석). **`setupDB` 미포함** |
| 시험 `src/lib/ledger/__tests__/`·`src/app/api/cash-ledger/__tests__/` | 8 + 헬퍼 2 | compute·validate·matching·store-parse·static-invariants·routes·**t074-disposable-mariadb**(env 게이트) + `helpers/{fake-db,fixtures}.ts` |

#### 2. 설계 대비 차이와 사유 (임의 변경 아님 — 근거)

**DDL (Analyst Q2 초안 → 수정 5, 근거는 일회용 DB 시험)**
1. 🔴 `chk_cfl_exch` NULL 구멍: 초안 식은 환전인데 `counter_*` 가 NULL 이면 `NULL IN (…)` → 식 전체 UNKNOWN → **CHECK 통과**(SQL CHECK 는 FALSE 만 거부). 일회용 DB 에서 초안 그대로의 표에 환전 counter NULL 행이 **실제로 들어가는 것**을 재현(시험 B-0) → `IS NOT NULL` 명시로 거부(4025).
2. `chk_cfl_krw_int`(원 정수, 받은 원화 포함)·`chk_cfl_minute`(초 = 0) 추가 — 앱 검증과 같은 규칙을 DB 가 한 번 더(중복 키가 '분' 기준이라 초가 섞이면 UNIQUE 가 무력해진다).
3. `uq_cfl_supersedes` 추가 — 한 기록은 한 번만 정정(동시 정정 두 건이 둘 다 들어가는 것을 DB 가 막는다), `fk_cfl_super` 인덱스 겸용.
4. `client_entry_id` CHAR(36) → VARCHAR(36)(폼 키 8~36자).
5. `COLLATE=utf8mb4_general_ci` 명시 — 운영 서버 기본이 **utf8mb3_general_ci**(실측), 운영 테이블은 전부 utf8mb4_general_ci(T-072 선례).
그대로 둔 것(검토 결과 문제없음): `live` PERSISTENT 생성열 UNIQUE(살아 있는 행 1·삭제 행 NULL → NULL 끼리 충돌 없음 — 실 DB 확인), `fk_cfl_super` 자기 참조(CREATE 한 번에 생성 — 확인), `created_by_user_id`·`deleted_by_user_id` INT UNSIGNED = 운영 `users.id int(10) unsigned`(SHOW CREATE 실측, 시험 A-2 가 타입 일치 단언) — FK 는 두지 않음(감사 열), `account_id INT` = `accounts.id int(11)`.

**계산(데모 대비 — 의미 동일, 돈 정확성)**
6. 원화 환산·기준 보정은 **정수 산술**: 달러 = 센트, 환율 = 소수 4자리(DDL 과 같은 자), 원 단위 반올림(`Math.round` 와 같은 '반은 +∞'). V·b₀·순입금이 모두 정수 원이라 "현재 − 기준 − 순입금 = 손익" 이 1원도 어긋나지 않는다. 데모 수치(+830,000원 · +3.99% · 후보 기록 뒤 +130,000원)는 **정확히 일치**(compute.test).
7. 환율이 없어 환산 못 하는 USD 기록은 계산에서 빼고 `summary.fxMissing` 로 센다(데모엔 늘 환율이 있다).
8. '기준 미확정' 판정: 스냅샷에 USD 행이 없으면(해외 비활성) 달러 확인을 요구하지 않는다(데모 규칙이면 해외 안 쓰는 계좌는 영원히 미확정).
9. 기준 현금 확인값은 **0 허용**(`parseCash`) — 데모 `baseVals` 는 `parseAmt` 를 써서 0원을 거부했는데 0원 현금은 실제 확인값이다.
10. 금액 상한(원 1조·$10억, 코드 `max`) 추가 — DECIMAL(18,2)·부동소수 안전 범위 + 자릿수 실수 차단. `krRead` 음수는 '−' 접두(데모 미처리 입력).

**반영 상태(지연 매칭)**
11. pending/unmatched 경계는 데모 `predict` 와 같다: 기록 시각 뒤 스냅샷이 **없으면** 반영 대기(순입금 제외), **있는데** 맞는 변화가 없으면 불일치(기록대로 포함 + 경고). 불일치는 창(36h)이 열려 있는 동안 조회마다 다시 맞춰 보고 나중에 맞으면 반영됨으로 바뀐다 — Analyst Q1⑤ "앵커 이후 스냅샷이 있는데도 맞는 변화가 없으면 unmatched" 를 이렇게 읽었다.
12. **한 변화는 한 기록만**(소비 키 `${cur id}:${통화}`): 같은 입금을 두 번 적으면 두 번째는 불일치(Q3 #5 를 반영 단계에서도 드러냄). 저장된 반영됨이 먼저 자기 변화를 차지하고, 두 반영됨이 같은 변화를 잡고 있으면(동시 저장 경합) 늦은 쪽을 다시 맞춘다.
13. 🔴 입출금으로 맞춘 단계에서 반대 통화가 반대 방향으로 비슷한 가치(내재 환율 ±3%)만큼 움직였으면 **맞추지 않고** `anchor.suggest = {kind:'exchange', …}` + 데모 문구 모양의 근거("…환전이었다면 환전으로 정정하세요")를 단다(Q3 #2 — 그대로 맞추면 P 가 그 금액만큼 과소).
14. 불일치 USD 기록의 원화 환산은 **기록 시각 뒤 첫 스냅샷 환율로 고정**(fx_source='snapshot', anchor 는 NULL). 데모는 미반영 USD 를 최신 환율로 '임시' 환산했는데, 불일치는 순입금에 들어가므로 최신 환율로 두면 그 달러의 환율 손익이 순입금 쪽으로 새어 P 가 흔들린다. 반영 대기(pending)는 순입금 밖이라 미리보기만 최신 환율.
15. 환전은 같은 단계 양쪽 또는 **연속 두 단계에 나눠** 맞으면 반영됨(앵커 = 뒤 단계, `fx_rate_used` = 앵커 환율 — 비용 추정용, `krw_equiv` 없음).
16. 복구하면 반영 상태를 pending 으로 되돌려 다음 조회가 다시 맞춘다(그 사이 다른 기록이 같은 변화를 잡았을 수 있다). 취소 사유·취소한 사람 열은 '마지막 취소 기록'으로 남긴다(살아 있는 행에선 안 읽음).
17. 조회(GET)가 매칭 결과를 **바뀐 것만** 조건부 UPDATE(`WHERE id AND deleted_at IS NULL AND anchor_status=<읽은 값> AND anchor_snapshot_id <=> <읽은 값>`)로 저장. 저장이 실패해도 이번 계산은 그대로 200(`persisted:false`), `/rematch` 는 실패를 500 으로.

**X(USD 예수금 왕복, Analyst Q3·Q5)**
18. T-069 R2(0 ↔ X)를 **변화량 크기 묶음**으로 일반화(Y ↔ Y+X): 보유·원화 불변 단계의 |ΔUSD| 를 시간순으로 묶되 허용치 = $0.05 + $0.05 × 경과일(올림) — X 의 하루 +$0.03·주말 누적을 흡수. 묶음이 2단계 이상 + 양방향이면 왕복 → 후보에서 뺀다. 매칭(사용자가 적은 기록)에는 쓰지 않는다.
19. 밤 표지는 시계(16~06시) 대신 **데이터로**: 진행 중(마지막 전환 3일 안) 패턴의 마지막 전환이 '빠짐'이면 `snapshot.usdGapHint = {usd, krw, sinceTs}`. 화면 문구의 "(16~06시)" 는 `RULE.usdGapHoursKst`. **실데이터 모양 대조(값 미기록)**: 10-16 이후 111행에서 왕복 1패턴(5단계, #5434 포함)을 억제했고 지금(09시대) 표지 없음, 후보는 #5427 원화 입금 단계 1건뿐, #5429 환전 단계는 환전으로 인식돼 후보 아님 — Analyst A 표와 같다.
   한계: 실제 입출금이 같은 크기로 들어왔다 나가면(보유·원화 불변) 왕복으로 보여 후보에서 빠진다. X 복귀와 실제 달러 입금이 같은 단계에 겹치면 그 기록은 불일치로 남는다.

**API·저장 범위**
20. 라우트는 Designer 3절 표 그대로 + **`POST /api/cash-ledger/candidates/:key/reopen` 추가** — 승인 데모의 '입출금 아님' [되돌리기] 동작에 필요한데 표에 경로가 없었다(의미 변경 아님). `GET` 응답에 **`baselineOptions`**(오늘 07~09시 첫 스냅샷 '권장'·최신·어제 아침 — 데모 BASE_OPTS)·`persisted`·`scanTruncated` 를 더했다(기준 시트가 고를 목록).
21. 에러 코드 추가: 400 `bad_request` · 404 `not_found` · 409 `no_baseline`(기준 없음)·`duplicate`(복구·정정 결과가 살아 있는 기록과 겹침 포함) · 503 `not_migrated`(테이블 없음 — 코드 먼저 배포돼도 화면만 오류, "기록이 없어진 것이 아닙니다") · 422 필드 코드 `required·format·sign·amount·decimals·max·future·before_baseline·kind·currency·same_currency·too_long·no_fx·not_found`. 기준 이전 차단은 `fieldErrors.occurredAt.code='before_baseline'`(클라이언트 `validateEntryInput` 은 데모처럼 `blocked` 로 따로).
22. '입출금 아님' 표시는 **새 테이블 없이** `system_config` 키 `cash_ledger_candidate_marks`(version·marks·log, 낙관적 잠금 + 최대 3회 재시도, 표시 1,000건·기록 200건 상한). 쓰기 범위 = `cash_flow_ledger` + `system_config` 의 `cash_ledger_baseline`·`cash_ledger_candidate_marks` 두 키뿐(라우트 시험 afterEach 가 매 시험 단언).
23. 🔴 기존 울타리 시험 `src/lib/__tests__/usd-cash-balance-fence.test.ts`(T-056, 수정 범위 밖)가 원장 코드의 `currency === 'USD'` 9곳을 "잔고에서 USD 를 골라 읽는 새 지점"으로 잡아 실패했다. 원장 값은 닫힌 유니온 `'KRW'|'USD'` 라 `Balance[]` 와 무관하지만, 울타리를 고칠 권한이 없어 **원장의 통화 분기를 `isUsd()`(조회표 — 통화가 늘면 타입 오류) 한 함수로 모았다** → 울타리 통과. `snapshots.ts` 는 스냅샷 positions JSON 의 USD 행(크론이 기록한 행)을 `cur === 'USD'` 로 판별한다 — 울타리 허용 목록의 `kill-switch.ts` 와 같은 성격이지만 변수 이름 때문에 울타리에 안 잡힌다. **Reviewer 판단 요청**: 울타리 허용 목록에 원장을 올리는 쪽이 더 정직하다고 보면 Leader 가 그 시험 수정을 따로 지시.
24. `GET` 도 `requireUserId` 로 다시 확인(미들웨어와 이중 방어, `OAUTH_PUBLIC_PATHS` 무변경 — 정적 시험).

#### 3. 라우트·쓰기 범위 요약

| 경로 | 동작 | 충돌·오류 |
|---|---|---|
| `GET /api/cash-ledger` | feed + 지연 매칭 저장(바뀐 것만) | 503 not_migrated · 500 |
| `POST …/entries` | clientEntryId 멱등(사전 확인 + UNIQUE) · baseVersion · 서버 재검증 | 422 · 409 no_baseline/baseline_version/duplicate · 500 `retrySafe` |
| `POST …/entries/:id/correct` | 트랜잭션: 원래 행 잠금 → 조건부 소프트 삭제 → 새 행(supersedes) | 404 · 409 already_voided/duplicate/baseline_version · 422 · 500 `retrySafe` |
| `POST …/entries/:id/cancel` | 조건부 UPDATE(`deleted_at IS NULL`), 사유 필수 | 404 · 409 already_voided · 422 |
| `POST …/entries/:id/restore` | 트랜잭션: 잠금 → 대체 여부(잠금 읽기) → 조건부 UPDATE | 404 · 409 not_voided/superseded/duplicate |
| `PUT …/baseline` | 스냅샷 값 동결 + 확인 현금 보정, version·history(20) | 409 version{latest} · 422 |
| `POST …/candidates/:key/dismiss` · `…/reopen` | 표시·되돌리기(사유 필수/없음) | 409 already_handled/not_dismissed · 404 · 422 |
| `POST …/rematch` | 살아 있는 기록 전부 다시 맞춤(저장 실패 500) | — |

`cash_flow_ledger` 의 UPDATE 는 3개뿐(취소·정정 void / 매칭 / 복구)이고 바꾸는 열 ⊆ `deleted_*`·`anchor_*`·`fx_rate_used`·`fx_source`·`krw_equiv`(정적 시험이 SET 절을 파싱해 단언). 금액·종류·통화·시각·메모·키는 UPDATE 하지 않는다. DELETE 없음.

#### 4. WP-B 가 쓸 것
- **타입: `src/lib/ledger/types.ts`** — `LedgerFeed`(GET `data`), `LedgerEntryView`·`BaselineView`·`SnapshotView`·`LedgerSummary`·`CandidateView`·`BaselineOption`, 성공 응답 `LedgerFeedResponse`·`EntryWriteResponse`(기록·정정: `entry`·`original`·`warnings`·`replayed`·`candidateResolved`)·`EntryActionResponse`(취소·복구)·`BaselineWriteResponse`·`CandidateWriteResponse`·`RematchResponse`, 실패 `LedgerErrorBody`(`code`·`error`·`fieldErrors`·`existingId`·`latest`·`retrySafe`·`data`), 요청 `EntryRequestBody`·`CorrectRequestBody`·`CancelRequestBody`·`BaselineRequestBody`·`DismissRequestBody`. 모든 쓰기 성공 응답·대부분의 409 에 최신 `data` 가 실린다(Designer 4절 "저장 성공 응답으로 교체").
- **화면에서 그대로 import 가능한 순수 모듈**(서버 모듈 import 없음 — 정적 시험): `compute.ts`(미리보기 `simulateSummary` + `predictAnchor` + `draftEntryView`, 환전 `exchangeRate/exchangeCostKrw`), `validate.ts`(`parseAmount`·`validateEntryInput`·`toFieldErrors`·`entryOneLine`·`isClientEntryId`), `korean-amount.ts`(`krRead`·표기), `rules.ts`(`RULE`·`candidateRuleSentence`), `kst.ts`.
- 요청 규약: 시각 `occurredAt` = 'YYYY-MM-DD HH:mm'(KST, 날짜·시각 칸을 합쳐 보냄), 금액은 **문자열 권장**(쉼표 허용), 환전은 `currency/amount`(낸 쪽)·`counterCurrency/counterAmount`(받은 쪽, 데모 `dir` 를 이것으로 바꿔 보냄), `baseVersion` = `feed.baseline.version`, `clientEntryId` 는 폼 열 때 1회 생성(재시도 유지), 후보에서 열었으면 `fromCandidateKey`.
- 반영 근거 문장(`anchor.detail`)은 서버가 만든 한국어 문장 그대로 보여 주면 된다(데모 문구 모양).

#### 5. 검증 수치 (격리 사본, 2026-10-23 10:2x)
- 기준선(내 변경 전, 같은 사본): `tsc --noEmit` 0 오류 · jest **221 스위트 통과 + 1 건너뜀, 5,424 통과 / 17 건너뜀 / 5,441**.
- 변경 후: **`tsc --noEmit -p .` 0 오류** · 시험 포함 타입 검사(`tsconfig.t074-tests.json`: 프로젝트 설정 상속, `types: jest,node`, T-074 시험·헬퍼 9파일) **0 오류** · jest 전체 **227 통과 + 2 건너뜀(T-072·T-074 DB 시험) — 5,647 통과 / 41 건너뜀 / 5,688** · T-074 일회용 DB env 를 켠 전체 **228 통과 + 1 건너뜀(T-072 DB) — 5,671 통과 / 17 건너뜀 / 5,688**. 새 시험 247건(7 스위트). `TZ=America/New_York` 에서도 원장 시험 223 통과(DB 24 건너뜀) — 시간대 무관.
- `next build`(Next 15.5.27, `NEXT_TELEMETRY_DISABLED=1`) **exit 0** — `/api/cash-ledger*` 9개 모두 ƒ(동적), 라우트 export 위반 없음.
- 일회용 DB(로컬 `mariadb:11` = **11.8.8**, `127.0.0.1:33074` 전용, 운영 sql_mode, 기존 4개 테이블 DDL = 운영 SHOW CREATE 실측) **24/24**: 적용 전 ER_NO_SUCH_TABLE → 503 경로 · **2회 적용 멱등**(인덱스 6·UNIQUE 3·CHECK 5·FK 2·콜레이션·users.id 타입 일치) · CHECK 8종 4025 · 초안 CHECK NULL 구멍 재현 · STRICT ENUM 거부 · live UNIQUE(살아 있는 행만, 삭제 뒤 재입력 가능, 복구 시 1062) · 멱등키·정정 1회·FK 1452 · DECIMAL 문자열·Date→KST 벽시계 실물 · **취소 동시 5회 중 1회 · 정정 동시 5회 중 ok 1/already_voided 4 · 복구 동시 5회 중 1회** · 낡은 매칭 UPDATE 0행 · 기준 동시 저장 5회 중 1회 · 후보 표시 동시 3건 전부 저장 · service 전체 흐름(합성 손익 +705,000원 → 후보 기록 뒤 +5,000원, 두 번째 조회 쓰기 0) · 되돌리기 2회 → 재적용. 끝나고 컨테이너 제거·포트 닫힘 확인. **운영 10.11.11 로는 돌리지 못했다**(로컬 이미지 11.8.8 뿐, 새 이미지 받지 않음 — CHECK·PERSISTENT 는 10.2+ 문법).
- 재현: 시험 파일 머리 주석의 `docker run …` + `T074_TEST_DB_PORT=33074 T074_TEST_DB_PASSWORD=t074test npx jest src/lib/ledger/__tests__/t074-disposable-mariadb.test.ts`.
- dev 서버 curl: 개발·운영이 같은 NAS DB 라 **마이그레이션 전에는 모든 `/api/cash-ledger*` 가 503 `not_migrated` 가 정상**이다(DDL 은 사용자 승인 사항). 동작 검증은 위 가짜 DB·일회용 DB 시험으로 한다. 마이그레이션 뒤 확인 예: `curl -s -b <세션쿠키> http://localhost:3003/api/cash-ledger` → `{ok:true,data:{baseline:null,…}}`.
- eslint: 실행 못 함(저장소에 ESLint 설정 없음 — T-072 와 같음). 작업 트리 jest/tsc 는 돌리지 않았다(타 세션 변경).

#### 6. 변이 시험 — **75/77 포착 (자기 변이 세트 기준, Reviewer 독립 재현 필요)**
별도 사본 `scratchpad/t074-iso-mut` 에서 1개씩 적용 → 원장·라우트 시험 + 일회용 DB → 원복·sha256 대조(78회 전부 원본과 같음). 실행기 `scratchpad/t074-a-mut/{run.py,mutations.py}`, 결과 `result-final.json`. 1차 78개 중 생존 4개(X11 반영 환율 대신 고정 환율·S02 왕복 양방향 요구 삭제·S03 X 하루 증가 흡수 삭제·D07 DECIMAL 형식 검사 삭제)는 시험 공백이라 시험을 보강해 포착(환율 1,324.63 스냅샷·한 방향 반복·주말 +$0.09·손상 DECIMAL 11종).

| 묶음 | 변이(예) | 결과 |
|---|---|---|
| 계산 C01~C12 | 순입금 부호 · 환전 제외 2곳 · 반영 대기 포함 · 기준 이전 경계/삭제 · 기준 보정 부호/삭제 · 가중치 시각 · 수익률 분모 · 환산 내림 · 불일치 집계 | 12/12 |
| 검증 V01~V12 | 기준 이전 경계/삭제 · 미래 · 부호 · 원 소수 · 달러 3자리 · 0원 · 큰 금액 경계 · 24h 경계 · 환율 경고 · 같은 통화 환전 · 상한 | 12/12 |
| 매칭 X01~X12 | 허용치 경계/2배 · 창 경계 · 소비 확인 삭제 · 환전처럼 보임 무시 · pending 없음 · 방향 · 반영됨 선점 없음 · 경합 감지 삭제 · 환전 한쪽만 · 고정 환율 · 스캔 범위 | 12/12 |
| 스냅샷·왕복 S01~S06 | 원화 free 만 · 양방향 요구 · 하루 흡수 · 원화 불변 요구 · 표지 조건 · 환전 판정 범위 | 6/6 |
| 후보 K01~K08 | 임계 경계 2 · 매매 단계 · 기준 이전 · 왕복 억제 · 기록된 변화 · 환전 단계 · 임계 10만 | 8/8 |
| 저장 D01~D10 | 취소/복구/매칭 조건부 UPDATE 조건 삭제 · 정정 0행 확인 · 정정된 기록 복구 · 중복 키 구분 · DECIMAL 형식 · 바인딩 형식 · 낙관적 잠금 조건 | 9/10 — **D09 생존** |
| 흐름 F01~F10 | 기준 버전 확인 · 멱등 사전 확인 · 매번 UPDATE · 재검증 차단 누락 · 사유 필수 · 재표시 · 후보 소비 · 오래됨 · retrySafe · 503 구분 | 9/10 — **F06 생존** |
| DDL Q01~Q07 | 초안 CHECK · live 제외 UNIQUE · 정정 1회 UNIQUE · 분 CHECK · 원 정수 CHECK · 멱등키 UNIQUE→일반 · IF NOT EXISTS | 7/7 |
| 대조 Z00 | 무변경 | 생존(기대대로) |

생존 2개는 **등가 변이**(관찰 가능한 차이 없음)로 판단: D09 = 기준 저장의 버전 사전 검사 삭제 → 바로 뒤 조건부 UPDATE(`JSON_EXTRACT(version) = baseVersion`)가 0행으로 같은 409 를 낸다(D10 이 그 조건을 지우면 포착). F06 = 이미 표시된 후보의 사전 거절 삭제 → `updateMarks` 가 같은 키를 보고 쓰지 않고 같은 409 를 낸다. 둘 다 이중 방어의 바깥 겹이다.

#### 7. 남은 위험·미확인
- **MariaDB 10.11.11 실행 미확인**(11.8.8 로만). 기본 콜레이션 차이는 명시로 막았다.
- **마이그레이션 SQL 은 `SAFETY_PATHS`(`^scripts/migrations/`) 대상** — 커밋 때 Reviewer 판정 scope 에 `scripts/migrations/T-074-cash-flow-ledger.sql` 이 들어가야 한다. `src/lib/ledger/`·`src/app/api/cash-ledger/` 는 대상 아님(실측 `awk` 목록, 작업 트리 훅은 T-075 타 세션 변경 포함).
- 운영 DDL 적용 전에는 화면이 503 이다(설계상 안전 — 다른 경로 영향 없음). 적용 순서·시점은 사용자 승인 사항.
- 지연 매칭 한계(기록): 같은 구간 같은 통화 여러 건은 합계로 맞추지 않음(각각 불일치 가능 — P 는 기록대로 맞다), 같은 단계의 입금+환전 혼합은 둘 다 불일치, 시각을 실제보다 늦게 적으면 못 찾는다(데모 안내 "모르면 조금 이르게").
- P 는 **최신 스냅샷 기준**이다(D1 결정 '최신 + 표지'). 기준 스냅샷과 최신 스냅샷이 X 있고/없는 시간대로 엇갈리면 그만큼(합성 기준 $250 × 환율) 손익에 섞이며, 화면은 `usdGapHint` 로만 알린다(Analyst Q1 기준일 주의 2).
- 복구는 '누가 언제 되살렸는지'를 따로 남기지 않는다(DDL 에 열이 없다 — 취소 사유는 마지막 값으로 남음). 필요하면 이벤트 로그 열/표를 후속으로.
- 후보 표시 저장은 동시 3건까지 재시도로 흡수(실 DB 확인), 그 이상 동시면 일부가 500("잠시 뒤 다시 시도") — 1인 사용 앱이라 허용.
- `usd-cash-balance-fence` 울타리 처리(2절 23) — Reviewer 판단 요청.
- `docs/db-schema.md`(새 테이블 문서)·`20-Log` 색인 줄은 이번 쓰기 허용 범위 밖이라 쓰지 않았다(Leader 가 필요하면 지시).
- 운영 DB 조회 3회 외 쓰기 0, 일회용 컨테이너 제거 확인, scratchpad 의 실데이터 임시 파일 삭제 확인.

```json
{ "taskId": "T-074", "status": "DONE",
  "deliverables": ["src/lib/ledger/{rules,kst,korean-amount,compute,validate,snapshots,match,candidates,store,service,handlers,types}.ts", "src/app/api/cash-ledger/**/route.ts (9)", "scripts/migrations/T-074-cash-flow-ledger.sql", "시험 7 스위트 247건 + 헬퍼 2(일회용 DB 시험 env 게이트)"],
  "blockers": [],
  "risk_level": "MEDIUM",
  "self_check": { "unit_test": true, "lint": false, "type_check": true } }
```

### Stage 2 — WP-B 구현 (화면: 공용 Sheet·입출금 기록 화면·설정 행·docs)

- [11:28] 범위·방법: 승인 데모 v1(`eab12bff…`)의 앱 화면 CSS·문구·상태 어휘·접근성 속성을 옮겼다. 화면 수정 전 `check.mjs check` → `DEMO_GATE_PASSED` / `task: T-074`. **WP-A 파일(`src/lib/ledger/**`·`src/app/api/cash-ledger/**`·마이그레이션 SQL) 수정 0**, 그 밖의 금지 파일 수정 0(기존 파일 수정은 `SettingsPage.tsx` 5줄·`docs/screens.md` 뿐). git 쓰기·배포·pm2·운영/공용 DB 쓰기·`.env` 출력·훅 스크립트 실행 0. 운영 DB 조회 0. 시험·문서는 데모 합성값만. 검증은 격리 사본 `scratchpad/t074-iso-b`(= `git archive HEAD` + WP-A·WP-B 파일 64개, 동기화 `scratchpad/t074-b-sync.sh` 바이트 대조 bad=0)에서만.

#### 1. 변경 파일

| 파일 | 줄 | 요지 |
|---|---|---|
| `src/components/ui/Sheet.tsx` (신규) | 262 | 공용 대화상자. `role=dialog`·`aria-modal`·`aria-labelledby=sh-t`(부제 있으면 `aria-describedby`), 첫 입력(없으면 제목)/지정 id 포커스, Tab 가두기(라디오 묶음은 선택된 것만), Esc 닫기(저장 중 무시), body 다른 자식 `inert`+스크롤 잠금(원래 값 복원), 닫을 때 후보 id 중 보이는 첫 요소로 포커스 복귀 → `onAfterClose`. 모바일 하단 시트 / ≥900px 가운데 520px(미디어 쿼리). DOM 조작은 순수 도우미(`collectFocusables`·`trapTarget`·`handleSheetKey`·`setBackgroundInert`·`focusFirstAvailable`) + 마크업 `SheetFrame` 로 분리(시험용) |
| `src/components/ledger/LedgerStyles.tsx` (신규) | 203 | 데모 앱 CSS 를 `.lg` 범위로(RiskStyles `.rp` 방식). container query → `@media (min-width: 900px)` |
| `…/ledger/view.ts` (신규·분리) | 204 | 데모 `statusParts`·`entryAmt`·`entryMeta`·`entryExtra`·`md`·`ago`·`spct` 등 순수 표시 함수 + P2-2·Minor-1 |
| `…/ledger/Parts.tsx` (신규·분리) | 81 | `St`(상태 어휘)·`KindChip`·`LedgerBadge`·시트 공용(`ErrBox`·`failNode`·`BusyFoot`·`WarnList`·`SheetErr`·`SheetDecision`) |
| `…/ledger/useLedgerFeed.ts` (신규·분리) | 83 | GET 조회 상태(화면·설정 행 공용 — risk `useRiskPolicyFeed` 선례). `reload`(로딩 보임)·`refresh`(조용히)·`replace`(쓰기 응답으로 교체, 그보다 먼저 출발한 조회 응답은 버림). 주기 재조회 없음 |
| `…/ledger/actions.ts` (신규·분리) | 123 | 쓰기 래퍼(15초 시간 초과)·응답 판정 `classifyWrite`(WP-A 응답 규약 → ok/dup/baseConflict/versionConflict/handledElsewhere/conflict/invalid/fail)·`createSubmitter`(중복 제출 잠금)·경로 |
| `…/ledger/entry-draft.ts` (신규·분리) | 202 | 폼 초안(`cid` = clientEntryId 를 열 때 1회)·서버와 같은 `validateEntryInput`·요청 본문(환전 ku/uk → currency/counterCurrency)·반영 예측(열린 후보 전부와 대조)·손익 전→후 미리보기(`compute.ts`)·정정/환전으로 정정 초안 |
| `…/ledger/{SummaryCard,FlowCandidateCard,TrustSignals,EntryList,EntryTable,EntryDetail,BaselineCard,LedgerGuide}.tsx` (신규) | 55·54·63·109·72·110·39·22 | 가이드 5절 그대로. `EntryList.tsx` 는 머리·빈 상태·목록·표 묶음(`LedgerList`)도 가진다 |
| `…/ledger/{EntrySheet,CancelSheet,RestoreSheet,DismissSheet,BaselineSheet}.tsx` (신규) | 378·137·108·116·235 | 시트 5종. 저장 응답 처리는 각 파일의 순수 함수(`decideEntryOutcome`·`entryRequest`·`decideCancelOutcome`·`decideRestoreOutcome`·`decideDismissOutcome`·`decideBaselineOutcome`·`baselineRequest`)로 — 시험 대상. `initialState`·`writeImpl` 은 시험·미리보기용 선택 prop |
| `src/app/settings/cash-ledger/{page,CashLedgerPage}.tsx` (신규) | 5·327 | 머리·띠·본문 상태(`LedgerBody`)·시트 조율·토스트·포커스 복귀 |
| `src/app/settings/CashLedgerSummaryRow.tsx` (신규) | 60 | 설정 '입출금 기록' 행(데모 `rowSummary`), 자체 조회 |
| `src/app/settings/SettingsPage.tsx` (수정) | +5 | import 1줄 + '내 계정' 링크 다음에 `SectionHeader '자산 기록'` + `<CashLedgerSummaryRow />`(주석 1줄). 기존 항목·순서·조회·저장 무변경 |
| `docs/screens.md` (수정) | +17/−1 | 탭 표 · 설정 주 화면 '자산 기록 — 입출금 기록 행' · 서브 화면 `/settings/cash-ledger`(요약·후보·표지·목록·기준·시트·추가 전용·반영 상태 3종·데이터) · 공용 `Sheet` · 이력 |
| 시험 7 스위트 + 픽스처 | 182·91·129·111·546·111·81 (+98) | `components/ui/__tests__/sheet` · `components/ledger/__tests__/{view,entry-draft,actions,ledger-render}` · `app/settings/cash-ledger/__tests__/cash-ledger-page` · `app/settings/__tests__/settings-cash-ledger-row` · `components/ledger/__tests__/fixtures.ts`(합성) — **128건** |

파일을 가이드보다 나눈 이유: jsdom 이 없는 node jest 환경이라(`package.json` 수정 금지) DOM·상태 흐름을 순수 함수로 빼야 오류 분기·중복 제출·포커스 규칙을 시험할 수 있다(`view`·`entry-draft`·`actions`·`Parts`·각 시트의 `decide*`). 조회 훅은 화면·설정 행이 같이 쓴다.

#### 2. 데모 대비 차이와 사유 (의미 변경 없음 — designer 확인 요청 표시 ★)
1. **Leader 승인 반영** — Minor-1: 목록 행 버튼 `aria-label` = "입금 1,000,000원, 09-03 10:00, 반영됨"(메모·부가 정보는 펼친 상세에서). P2-2: 환전 '불일치' → 중립 `◌ 확인 전`. P2-1·P2-3 은 데모 그대로.
2. ★ **P2-2 에 딸린 문구** — 환전 확인 전의 반영 근거 문장 끝을 "기록대로 계산에 넣었습니다"(사실과 다름) 대신 "환전이라 손익 영향은 없습니다", 저장 토스트를 "‘불일치’로 표시했습니다(손익 영향 없음)" 대신 "‘확인 전’으로 표시했습니다(손익 영향 없음)". 신뢰도 표지·설정 칩의 '불일치 n건'은 원래도 환전을 세지 않는다(WP-A `summary.unmatched`).
3. **상태 어휘 `St` 를 원장 전용으로** — 가이드는 T-066 `StatusText` 재사용을 제안했지만 T-066 경계 시험이 허용 목록 밖의 리스크 컴포넌트 폴더 참조를 0건으로 고정한다(시험 수정 범위 밖). 마크업·클래스는 같다.
4. ★ **토스트를 화면 내 `.toast`(데모 그대로, `role=status`·`aria-live=polite`·7초)로** — 공용 `useToast` 는 `role`/`aria-live` 가 없고 `white-space: nowrap`+말줄임이라 데모의 긴 결과 문장("기록했습니다 (#8) … 손익 +830,000원 → +130,000원")이 412px 에서 잘린다(`Toast.tsx` 수정 범위 밖). 토스트는 시트가 닫혀 배경 `inert` 가 풀린 뒤에 띄운다(읽기 프로그램이 놓치지 않게).
5. ★ **기준 현금 확인 시트는 이미 확인한 값을 칸에 채워 연다** — 데모는 늘 빈 칸이라 그대로 저장하면 확인값이 지워져 '기준 미확정'으로 돌아간다. 정하기·바꾸기(새 스냅샷)는 데모처럼 빈 칸.
6. **후보가 여러 건이면 카드를 건마다 최신순으로**(데모는 1건만 그림). '입출금 아님' 표시한 후보도 서버가 주는 동안 데모 `candHtml` 의 dismissed 카드로 보인다 — ★ 표시가 많이 쌓이면 접기 검토(designer).
7. **WP-A 가 바꾼 데이터에 맞춘 표시** — 달러 기록 '불일치'는 WP-A 가 기록 뒤 첫 스냅샷 환율로 고정하므로 "(기록 뒤 첫 스냅샷 환율 …)"(★ 새 문구), 반영됨은 데모 그대로 "(반영 시점 환율 …)". 스냅샷에 달러 행이 없으면 기준 카드의 달러·환율 줄과 기준 시트의 달러 칸을 그리지 않는다(서버가 no_fx 로 거부). 현금 0 허용(`parseCash`).
8. **데모에 없던 응답의 처리**(문구는 서버 문장 또는 데모 문장 재사용): 409 superseded·duplicate(되살리기)·no_baseline → 서버 문장 + "최신 목록을 불러왔습니다" + 닫기만. 정정·취소 충돌에서 상대가 '정정'한 경우 "먼저 정정됐습니다"(데모는 늘 '취소됐습니다'). 실패 사유는 "서버 응답 500" / "네트워크 오류로 요청하지 못했습니다" / "응답이 15초 안에 오지 않아 중단했습니다" / 422 첫 필드 문장. '되돌리기'(reopen) 실패는 토스트("되돌리지 못했습니다 — …"). 409 baseline_version 은 최신 데이터를 싣지 않아 조용히 다시 읽고, '새 기준으로 기록하기'는 서버가 준 최신 버전 + **같은 clientEntryId** 로 보낸다. 기준은 있는데 최신 스냅샷이 없으면 조회 오류 모양으로 "최신 포트폴리오 스냅샷이 없어 손익을 계산하지 못했습니다".
9. **표시 형식** — 밤 스냅샷 달러 금액을 `$250.00`(데모 `$250`)처럼 다른 달러 표기와 맞췄다. 데모 하단 탭은 앱 공용 `BottomTabs` 가 그린다. 정정 요청의 사유는 데모 `applyDraft` 처럼 '정정'.
10. **포커스·동작 세부** — 열 때: 기록 폼 = 금액 칸, 확인·취소·되살리기·입출금 아님·기준 시트 = 제목(데모). 단계 전환 = 제목/‹ 고치기 뒤 '확인하기', 저장 중 = 제목(비활성 버튼은 포커스 불가), 결과 뒤 = 주 버튼. 닫을 때 = 연 버튼 → 없으면 목록 제목 → 추가 버튼, 기록 저장 성공은 목록 제목(데모). 연 버튼 id 는 **닫는 순간** 잡는다(시트 효과 정리 때는 화면이 이미 다시 그려져 있다 — 구현 중 찾은 결함). 펼친 상세는 열렸을 때만 그린다(숨긴 목록/표에 같은 버튼이 두 벌 생기지 않게 — id 앞머리 `lg-`/`lgt-` 로도 분리).

#### 3. 격리 사본 검증 (2026-10-23 11:2x)
- `tsc --noEmit -p .` **0 오류** · 시험 포함 타입 검사(`tsconfig.t074-tests.json`, WP-A·WP-B 시험·헬퍼 17파일) **0 오류**.
- jest 전체 **234 통과 + 2 건너뜀(T-072·T-074 DB env 게이트) — 5,775 통과 / 41 건너뜀 / 5,816** (WP-A 뒤 기준 227+2 · 5,647/41/5,688 → 새 7 스위트 128건). WP-B 7 스위트는 `TZ=America/New_York` 에서도 128/128.
- 처음 전체 실행에서 T-066 리스크 경계 시험이 `Parts.tsx` **주석**의 경로 문자열에 걸려 실패 → 주석 표현만 바꿔 통과(코드 import 는 원래 없음).
- `next build`(15.5.x, telemetry off, `.env` 없음) **exit 0** — `/settings/cash-ledger` ○ 정적 21.7 kB, `/settings` 16.7 kB, `/api/cash-ledger*` 9개 ƒ.
- eslint: 저장소에 설정 없음(실행 못 함).

#### 4. 화면 확인 (일회용 MariaDB `mariadb:11` 127.0.0.1:33075 + 격리 사본 `next start` 127.0.0.1:3975, `env -i` 로 DB_*·임시 세션 비밀만 넣음, 합성 스냅샷 11행 — 끝나고 서버·컨테이너 제거, 포트 닫힘 확인, 스크린샷 파일 삭제)
- 기준 없음 → UI 로 기준 저장(토스트 "기준을 저장했습니다 (버전 1) …", 연 버튼 사라져 목록 제목으로 포커스) → curl 로 데모 모양 기록 7건(취소 1·정정 1) → 정상 상태. 서버 손익 +705,000원(합성 보유가 데모와 달라 WP-A 일회용 DB 시험의 +705,000원과 같은 값) · 반영 대기 1 · 후보 1.
- **412px**: 정상 상태 가로 넘침 0(scrollWidth 412) · 중복 id 0 · 44px 미만 터치 0 · 11px 미만 글자 0, 데모와 같은 배치. **360px**: 7행 전부 펼침·취소·정정 보기 상태에서 넘침 0·중복 id 0·작은 터치 0, 환전 폼 시트 넘침 0. **1280px**: `grid-template-areas "top list" "bot list"`(왼쪽 420px, 표 보임·목록 숨김), 정정 시트 가운데 520px.
- 키보드·포커스(실제 브라우저): 시트 열면 배경 body 자식 전부 `inert` + `overflow:hidden`, Tab 30회 순회 동안 시트 밖으로 0회, 라디오 묶음은 선택된 것만, Shift+Tab 처음→끝, Esc 닫기 → 연 버튼(`lg-nb-set`·`lgt-ac-5-cor`)으로 복귀, inert·스크롤 원복. 기록 폼 열면 금액 칸.
- 흐름: 폼 닫기 → 다시 열면 "닫기 전에 쓰던 내용을 이어서 씁니다"+값 유지 · 강제 500 → 오류 상자("다시 눌러도 두 번 기록되지 않습니다")·입력 유지 → '다시 시도' **두 번 클릭해도 요청 1번**, 두 요청의 clientEntryId 동일, 1건만 저장 · 후보 [입금으로 기록] → 미리보기 "바로 반영 … +705,000원 → +5,000원" → 저장 뒤 카드 사라짐 · 중복 409(#1) 문구·[목록으로] · 다른 곳(curl)에서 기준을 바꾼 뒤 저장 → 409 "버전 3" → '새 기준으로 기록하기'가 baseVersion 3·같은 clientEntryId 로 저장 · 다른 곳에서 먼저 취소 → "먼저 취소됐습니다"+[닫고 최신 목록 보기] · 되살리기 · 기준 이전 날짜 차단 상자·`aria-invalid`·확인하기 비활성 · 조회 503 → 오류 상자 → 다시 시도 뒤 요약 제목 포커스. 실제 서버의 503 `not_migrated`(일회용 DB 표 이름을 잠시 바꿈)도 확인.
- 설정 화면: '내 계정' 다음 '자산 기록' 행(손익·칩·기록 수) 확인.
- 🔴 **확인 중 사고(보고)**: 설정 화면을 열 때 브라우저 쪽 API 막기(context route)가 적용되지 않아 `/api/settings/*` 가 격리 서버에 닿았다. 격리 서버는 KIS 키가 없어 KIS 는 HTTP 전에 실패했지만, `/api/settings/safety` 경로의 환율 조회가 **공개 환율 API(frankfurter) 에 1회 외부 요청**을 보냈다(서버 로그 `[fx] fetched USD/KRW=… from frankfurter`). 자격증명·계좌 값 전송 없음, 운영/공용 DB 접근 없음(일회용 DB 만). '외부 네트워크 금지' 위반이라 기록한다 — 그 뒤 설정 화면은 다시 열지 않았다.
- 못 한 것: 실제 갤럭시 기기·스크린리더(TalkBack) 낭독, 운영 MariaDB 10.11.11(로컬은 11.8.x), 마이그레이션 적용 뒤 실데이터 화면(운영 DDL 미적용 — 지금 운영은 화면이 오류 상태로 나와야 정상). designer 시각 점검 이어서 필요.

#### 5. 변이 시험 — **1차 30/32, 시험 보강 뒤 32/32 포착** (자기 변이 세트 기준 — Reviewer 독립 재현 필요)
실행기 `scratchpad/t074-b-mut/run.py`(1개씩 적용 → WP-B 7 스위트 → 원본 복사·sha256 대조, 결과 `result.json`, 대조 Z00 무변경 PASS).
| 묶음 | 변이 | 결과 |
|---|---|---|
| Sheet S01~S09 | 라디오 중복 제거 · 비활성 포함 · Shift+Tab 경계 · 밖에서 Tab · 저장 중 Esc · inert 원래 값 복원 · 호스트 조상 inert · 숨긴 요소로 포커스 복귀 · aria-modal | 9/9 |
| 오류 분기 E01~E08 | 409 baseline_version 분기 · 시간 초과 · 본문 ok:false 성공 처리 · 충돌 뒤 재조회 · 새 기준 버전 무시(기록·기준) · 취소 충돌을 실패로 · 실패 문구 | 8/8 |
| 차단·중복 D01~D06 | 🔴 다시 시도마다 새 clientEntryId · 🔴 제출 잠금 삭제 · 기준 이전 차단 무력화 · 차단 이유 문장 · 차단 상자 · 후보 키 누수 | 6/6 |
| 표시 V01~V06 | P2-2 · Minor-1 · `[hidden]` 규칙 · 목록/표 id 겹침 · 오류 문장 상태 코드 · 입금 금액 빨강 | 6/6 |
| 배선 P01~P03 | 닫는 순간 연 버튼 id 잡기 삭제 · 시트가 잠금 우회 · 설정 섹션 순서 | 1차 1/3 → 2차 3/3 |
1차 생존 P01·P02 는 DOM 없이 실행할 수 없는 컴포넌트 배선이라, 실제 동작은 브라우저에서 확인했고(위 4) 소스 배선 시험 2건을 더해 회귀를 잡게 했다(약한 시험 — 패턴 검사).

#### 6. 남은 위험·미확인
- 위 4의 외부 요청 1회(공개 환율 API) — 절차 위반으로 Leader 판단 필요.
- 화면 배선(포커스 복귀·제출 잠금 연결)은 jsdom 이 없어 소스 패턴 시험 + 이번 브라우저 확인뿐. QA 가 실제 브라우저로 다시 돌릴 것.
- 조회는 주기 재조회가 없다 — 반영 대기 → 반영됨은 다시 열거나 쓰기 뒤에 바뀐다(가이드 4절대로). `summary.fxMissing`·`persisted:false`·`scanTruncated` 는 데모에 없어 화면에 표시하지 않는다(★ designer 판단).
- 시트 열린 동안 배경 inert 에는 공용 토스트·하단 탭도 포함된다(데모와 같은 의도).
- 이번 작업 중 `docs/db-schema.md`·`20-Log` 는 쓰기 허용 밖이라 쓰지 않았다.
- 커밋 범위 주의: 이번 WP-B 파일은 `SAFETY_PATHS` 대상이 아니다(실측 목록). 마이그레이션 SQL(WP-A)은 대상.

```json
{ "taskId": "T-074", "status": "DONE",
  "deliverables": ["src/components/ui/Sheet.tsx", "src/components/ledger/*.ts(x) (19)", "src/app/settings/cash-ledger/{page,CashLedgerPage}.tsx", "src/app/settings/CashLedgerSummaryRow.tsx", "src/app/settings/SettingsPage.tsx (+5)", "docs/screens.md", "시험 7 스위트 128건 + 픽스처"],
  "blockers": ["화면 확인 중 공개 환율 API 외부 요청 1회 — Leader 판단", "designer 시각 점검·★ 표시 차이 확인"],
  "risk_level": "MEDIUM",
  "self_check": { "unit_test": true, "lint": false, "type_check": true } }
```

### Stage 3 — designer 점검 반영

- [12:18] designer `### 구현 점검 (T-074 v1)` 수정 목록 1~7 전부 반영(Leader 승인). 선택 항목(돌아올 때 재조회·넓은 화면 최대 폭)과 후속(공용 Toast·StatusText 승격)은 하지 않았다. 수정 범위: WP-B 파일·`__tests__`·`docs/screens.md`·이 절. **WP-A 파일·그 밖 금지 파일 수정 0**, git 쓰기·운영 DB·배포·`.env` 출력 0, 합성값만.

#### 1. 반영 내역
| 항목 | 반영 | 파일 |
|---|---|---|
| P1-1 토스트가 시트를 가림 | 시트를 열 때(`openSheet` — 시트는 모두 여기로만 연다) 토스트·타이머를 지운다(`clearToast`). 보조로 `.lg .toast` z-index 60 → 45(시트 50 아래) | `CashLedgerPage.tsx`·`LedgerStyles.tsx` |
| P1-2 마이그레이션 전 503 | `fetchLedgerFeed` 가 응답 `code` 를 남기고(`loadCode`), **상태 503 + code `not_migrated` 둘 다**일 때만 '준비 중'(`isNotMigrated`). 원장 화면: 중립 상자 한 문장 `◌ 준비 중 — 서버 준비 뒤 쓸 수 있습니다`(`role=status`, 다시 시도·기술 용어·"기록이 없어진…" 중복 없음). 설정 행: 같은 문장(중립 `na`). 다른 원인의 503(code 없음·다른 code)·500 등은 기존 경고 + 다시 시도 그대로. 문장은 `view.ts` `NOT_READY_TEXT` 한 곳(설정 행이 원장 화면 모듈을 끌어오지 않게) | `useLedgerFeed.ts`·`CashLedgerPage.tsx`·`CashLedgerSummaryRow.tsx`·`view.ts` |
| P2-1 현금 확인 미리보기 | 현금 확인 모드만 **지금 기준 총자산(`baselineTotalKrw`)·지금 확인값**과 비교: 안 바꾸면 "기준 총자산 X원 (지금과 같음)"(designer 목록 문구 — Leader 메시지의 "변화 없음"과 같은 뜻), 바꾸면 "X → Y" + 지금 확인값 대비 차이(칸을 비우면 스냅샷 값으로 되돌아가는 차이도 보인다). 정하기·바꾸기는 새 스냅샷 값과 비교(그대로) | `BaselineSheet.tsx` |
| P2-2 후보 여러 건 | 열린 후보 2건 이상 → 카드 1장(제목 "… N건", 줄마다 `시각 · 통화 현금 ±금액` + [입금/출금으로 기록] [입출금 아님], 섞임 문장·알림 기준은 한 번). '입출금 아님' 표시는 **가장 최근에 표시한(`dismissedAt`) 1건**만 지금 모양, 2건째부터 `<details>` "입출금 아님으로 표시한 변화 n건 더 보기"(건수 기준, 기간으로 숨기지 않음, 되돌리기 유지). 표시 카드 테두리 `--border2` 점선 | `FlowCandidateCard.tsx`(`FlowCandidates`·`FlowCandidateGroup`·`arrangeCandidates`)·`LedgerStyles.tsx` |
| P2-3 기준 스냅샷 도움말 | `.lg .kseg > .hint` 를 `.field .hint` 규칙에 추가(12px·muted) | `LedgerStyles.tsx` |
| P2-4 긴 메모 행 | 접힌 행 `.m` 2줄 말줄임(`-webkit-line-clamp: 2`), 상세는 전문 | `LedgerStyles.tsx` |
| P2-5 밤 표지 괄호 | "(16~06시)"는 그 스냅샷 시각이 실제로 그 시간대일 때만(`inHourRange`, 자정 넘김), 아니면 괄호 없이 — designer 의 두 안 중 사실과 어긋나지 않는 쪽 | `TrustSignals.tsx` |
| P2-6 환율 없음·스캔 잘림 | `summary.fxMissing > 0` → amber "! 환율이 없어 계산에서 뺀 달러 기록 n건 — 다음 스냅샷에서 다시 계산합니다". `scanTruncated` → 후보 아래 muted "최근 스냅샷만 대조했습니다" — ★ designer 문구의 "N일"은 뺐다: 잘렸을 때 실제 대조 일수를 응답이 주지 않아 `scanDays`(120)를 쓰면 사실과 다르다. `persisted:false` 미표시(designer 판단대로) | `TrustSignals.tsx`·`FlowCandidateCard.tsx` |
| a11y Minor-1 | 행 접근 이름 "#7 입금 500,000원, 10-23 11:33, 반영 대기" | `view.ts` |
| a11y Minor-2 | `.sc-big` 의 `aria-live` 제거(결과는 토스트가 읽음) | `SummaryCard.tsx` |
| a11y Minor-3 | '기타'를 골라도 포커스 이동 없음(글 칸은 라디오 바로 뒤 탭 순서) | `CancelSheet.tsx`·`DismissSheet.tsx` |
| a11y Minor-4 | 모바일 목록 `aria-label="입출금 기록 목록"` | `EntryList.tsx` |
| a11y Minor-5 | 충돌로 닫기만 남으면 사유 라디오·글 칸 비활성(입출금 아님 시트는 저장 중에도 비활성 — 취소 시트와 맞춤) | `CancelSheet.tsx`·`DismissSheet.tsx` |
- ★ 데모·목록에 없던 작은 결정 2개(designer 확인 요청): ① 묶음 카드에서 방향이 섞이면 "입출금이었다면 기록해 주세요. … 위 손익(…)에 **투자 손익처럼** 섞여 있습니다"(한 방향이면 기존 "번/잃은 돈처럼"). 같은 이름의 버튼이 여러 개라 각 버튼에 그 줄을 `aria-describedby` 로 붙였다. 묶음 줄 사이 구분선은 amber 25%. ② 접힘 요약에 "▾/▴" 표시를 붙였다(요약을 inline-flex 로 두면 기본 펼침 표시가 사라져서 — 기록 안내의 "펼치기 ▾" 와 같은 방식).
- `docs/screens.md`: 준비 중 상태·묶음/접기·밤 괄호·환율 없음 표지·#번호 접근 이름·현금 확인 비교 기준·토스트 지움을 반영.

#### 2. 🔴 Stage 2 '확인 중 사고' 원인 정정
Stage 2 4절에서 외부 환율 요청을 '설정 화면을 연 탓'으로 적었지만 **원인은 서버 준비 확인용 `curl /api/health` 였다.** `/api/health` 는 실효 주문 한도를 계산하며 포트폴리오 평가 → KIS 잔고(키 없어 HTTP 전 실패) + **환율 조회(외부)** 를 부른다. 이번에 사전 로드를 켠 첫 기동에서 같은 확인 3회가 환율 조회 9회(3곳 × 3)를 시도했고 **모두 사전 로드가 막았다**(서버 로그 `[fx] … fetch failed`, 실제 연결 0). 두 번째 기동부터 준비 확인을 공개 정적 페이지 `/login` 으로 바꿔 **외부 연결 시도 0건**(로그 `[fx]` 0줄). 앞으로 이 앱의 개발 서버 준비 확인에 `/api/health` 를 쓰지 않는다.

#### 3. 격리 사본 검증 (`t074-iso-b`, 동기화 bad=0, 2026-10-23 12:1x)
- `tsc --noEmit -p .` **0 오류** · 시험 포함 타입 검사(T-074 시험·헬퍼 17파일) **0 오류**.
- jest 전체 **234 통과 + 2 건너뜀 — 5,791 통과 / 41 건너뜀 / 5,832**. WP-B 7 스위트 **144건**(Stage 2 128 → +16), `TZ=America/New_York` 에서도 144/144.
- `next build`(사전 로드 켬) **exit 0**, 빌드 중 외부 연결 차단 메시지 0 — `/settings/cash-ledger` ○ 22.6 kB · `/settings` 16.8 kB.

#### 4. 브라우저 재확인 (사전 로드 `block-external-net.cjs` — 시작 로그 첫 줄 `[block-external-net] 로컬 외 TCP 연결 차단 활성` 확인 · 일회용 `mariadb:11` 127.0.0.1:33075 · `env -i` 로 DB_*·임시 세션 비밀·`DRY_RUN=true KILL_SWITCH=true` · 브라우저는 페이지 라우트로 127.0.0.1:3975 밖 요청 중단(0건)·원장 외 API 는 브라우저에서 가짜 응답(서버에 닿지 않음) · 합성 스냅샷 15행(기록 안 된 변화 5건 — 2건 열림·3건 표시))
- P2-2: 열린 2건 → 카드 1장 "변화 2건"·줄 2개·섞임 문장(방향 섞임)·알림 기준 1번, 표시 3건 → 가장 최근에 표시한 1건(스냅샷은 가장 오래된 것 — 표시 시각 기준 확인) + "2건 더 보기"(접힘 ▾, 펼치면 ▴·카드 3장), 표시 카드 테두리 `rgb(50,56,72)` 점선. 다른 곳에서 1건을 표시하자 열린 1건은 데모 단일 카드로 돌아오고 "3건 더 보기".
- P1-1: 기준 저장 토스트가 떠 있는 동안 '+ 입출금 기록 추가' → 시트 열림과 함께 토스트 내용 비고 `display:none`, z-index 45.
- P1-2: 일회용 DB 표 이름을 잠시 바꿔 실제 서버 503 `not_migrated` → 원장 화면 `<div class="sumcard" role="status">◌ 준비 중 — 서버 준비 뒤 쓸 수 있습니다</div>` 하나(다시 시도·경고 없음), 설정 행도 같은 문장. 되돌린 뒤 정상.
- P2-1: 확인값 $1,400(스냅샷 $1,500)인 기준에서 현금 확인을 열면 "기준 총자산 15,936,000원 (지금과 같음)", $1,450 → "15,936,000원 → 15,998,000원 · 달러 +$50.00 × 1,240.00원/$".
- P2-3 도움말 12px·muted, P2-4 200자 메모 행 2줄, Minor-1 "#5 입금 500,000원, …", Minor-4 목록 이름, Minor-3 방향키로 '기타'까지 가도 포커스는 라디오(`sh-r-2`) → Tab 이 글 칸, Minor-5 다른 곳에서 먼저 처리 → 라디오 3개·글 칸 비활성 + [닫기].
- 360·412·1280px(묶음·접힘 펼침·7행 펼침): 가로 넘침 0 · 중복 id 0 · 44px 미만 0 · 11px 미만 0, 1280 은 2열 그대로.
- 끝나고 서버 종료·컨테이너 제거·포트 3975/33075 닫힘·스크린샷 파일 삭제 확인.
- 못 한 것(그대로): 실제 갤럭시·TalkBack, P2-5 밤 괄호·P2-6 환율 없음은 실서버 데이터로 재현하지 않고 렌더 시험으로만(합성 왕복·환율 없는 스냅샷을 만들지 않음).

#### 5. 변이 시험 — **Stage 3 세트 30/30 포착**, Stage 2 세트 재실행 31/31(+V02 1건은 대상 줄이 바뀌어 적용 불가 → Stage 3 A01 이 같은 것을 본다) — 자기 변이 세트 기준
실행기 `scratchpad/t074-b-mut/run3.py`(결과 `result3.json`, 1개씩 적용 → WP-B 7 스위트 → 원본 복사·sha256 대조, 대조 Z00 PASS).
| 묶음 | 변이 | 결과 |
|---|---|---|
| 토스트 T01~T03 | 🔴 시트 열 때 안 지움 · setToast(null) 삭제 · z-index 60 | 3/3 |
| 준비 중 N01~N06 | 🔴 원장 분기 삭제 · 503 조건 삭제 · code 버림 · 설정 행 분기 삭제 · 행에 code 안 넘김 · 다른 503 도 준비 중 | 6/6 |
| 비교 기준 C01~C04 | 🔴 스냅샷 값으로 되돌림 · 달러 차이 기준 · 지금 기준 안 넘김 · "(지금과 같음)" 삭제 | 4/4 |
| 후보 G01~G06 | 🔴 카드마다로 되돌림 · 표시 순서 · 🔴 접기 삭제 · 테두리 경고색 · 섞임 문장 · 버튼 구분 | 6/6 |
| 표지 S01~S03 | 밤 괄호 늘 · 환율 없음 표지 · 스캔 안내 | 3/3 |
| 접근성·CSS A01~A08 | #번호 · live 되살림 · 목록 이름 · 충돌 뒤 비활성(취소·입출금 아님) · 기타 포커스 이동 · 도움말 CSS · 2줄 말줄임 | 8/8 |
배선 시험 보강 2건(소스 패턴): 시트는 `openSheet` 로만 열고 그 안에서 토스트를 먼저 지운다 · 사유 '기타' 선택에 포커스 이동이 없다.

#### 6. 남은 위험
- 준비 중 판정은 서버 code 문자열(`not_migrated`)에 기대 — WP-A 가 코드를 바꾸면 일반 오류로 보인다(시험이 둘 다 고정).
- 묶음 카드 시각 세부(줄 구분선·버튼 배치)·★ 2건은 designer 확인 필요. 실데이터는 지금 후보 1건이라 운영에서는 당분간 단일 카드.
- Stage 2 의 남은 위험(배선은 소스 패턴 시험 + 브라우저 확인뿐, 주기 재조회 없음)은 그대로.

```json
{ "taskId": "T-074", "status": "DONE",
  "deliverables": ["designer 수정 목록 1~7 반영 — CashLedgerPage·CashLedgerSummaryRow·useLedgerFeed·view·FlowCandidateCard·TrustSignals·SummaryCard·EntryList·CancelSheet·DismissSheet·BaselineSheet·LedgerStyles", "docs/screens.md", "시험 +16건(WP-B 144)"],
  "blockers": ["designer 확인: ★ 방향 섞임 문장·접힘 표시·스캔 안내 문구(N일 제외)"],
  "risk_level": "LOW",
  "self_check": { "unit_test": true, "lint": false, "type_check": true } }
```

### Stage 4 — 문구 3건

- [12:31] designer `### 델타 점검 (Stage 3)` 2-1~2-3 문구만 반영(범위 확대 없음). 변경 파일: `src/components/ledger/FlowCandidateCard.tsx`(묶음 섞임 문장 "입금·출금이었다면 줄마다 기록해 주세요. 기록하기 전까지 이 변화들은 위 손익(…)에 **투자로 번 돈·잃은 돈처럼** 섞여 있습니다." — 한 방향 2건 이상은 "이 변화들은", 단일 카드는 그대로 / 문장을 제목 바로 아래로 / 접힘 요약 "입출금 아님으로 표시한 변화 n건" / 스캔 안내 "스냅샷이 많아 최근 것만 대조했습니다 — 그보다 오래된 기록 안 된 변화는 여기 보이지 않을 수 있습니다.") · `src/components/ledger/LedgerStyles.tsx`(접힘 `::after` "펼치기 ▾"/"접기 ▴", 대체 텍스트로 기호 미낭독) · `src/components/ledger/__tests__/ledger-render.test.ts`(옛 문구 단언 수정 + 문장 위치·접힘 표시 단언) · `docs/screens.md`.
- 검증(격리 사본 `t074-iso-b`, 동기화 bad=0): 앱 `tsc` 0 · 시험 포함 `tsc` 0 · jest `components/ledger`·`components/ui`·`app/settings` 10 스위트 **207/207** · `next build`(사전 로드) exit 0·차단 0.
- 360px 캡처(사전 로드 서버·준비 확인 `/login`·일회용 DB·합성값): 섞임 문장 3줄 줄바꿈 정상(목록 위), 접힘 "…변화 2건 펼치기 ▾" → 펼치면 "접기 ▴", 가로 넘침 0, 외부 연결 시도 0(`[fx]` 0줄)·브라우저 외부 요청 0. 스캔 안내는 데이터 재현 없이 렌더 시험으로만. 끝나고 서버·컨테이너 제거·포트 닫힘·캡처 파일 삭제.

### Stage 5 — Reviewer 조건 반영

- [13:12] 범위: Reviewer 조건 ①(M1)·②(L8) + 권고 L1·L2·L4·L5·변이 구멍 11개·`isUsd` 정리((c)). L3·L6·L7 은 코드 변경 없음(Leader 기록). **마이그레이션 SQL 무변경**(sha256 `ab17ad46…` = WP-A 와 같음). 격리 사본 `t074-iso-b` 에서만 검증(동기화 bad=0, 이번부터 울타리 시험·`docs/db-schema.md` 포함), 앱·시험·빌드·DB 시험 모두 `block-external-net.cjs` 사전 로드, 서버는 띄우지 않음. git 쓰기·운영 DB·배포·`.env` 출력 0, 합성값만.

#### 1. 변경 파일
| 파일 | 내용 |
|---|---|
| `src/lib/ledger/service.ts` | M1: `sameEntryContent`(종류·통화·금액(원 정수/센트)·발생 시각(분)·환전 받은 통화·금액·메모(trim, 빈 칸=없음)·정정 대상) + `replayOrConflict` — 기록 추가·정정의 사전 확인과 UNIQUE 경합 경로(4곳) 모두. 같으면 `replayed`, 다르면 409 `client_entry_conflict`{existingId, data}, 문장 "같은 요청 번호로 다른 내용이 와서 저장하지 않았습니다. 방금 저장된 기록을 확인해 주세요". 정정 키를 다른 대상에 쓴 경우(옛 409 `duplicate`)도 이 코드로 통일 |
| `src/lib/ledger/types.ts` | `LedgerErrorCode` 에 `client_entry_conflict` |
| `src/lib/ledger/store.ts` | L8: `isNoTable` = 1146 **그리고** 메시지(`sqlMessage`/`message`)에 `cash_flow_ledger` |
| `src/lib/ledger/handlers.ts` | L2: 500 응답 = `SERVER_ERROR_TEXT`("서버 오류로 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.") + `code` — 원문은 기존 `console.error` 로만. 우리가 만든 `LedgerDataError`(손상 기준 복구 안내)만 문장 유지 |
| `src/lib/ledger/validate.ts` | L1: 쉼표는 `^\d{1,3}(,\d{3})+(\.\d+)?$` 일 때만, 그 외 format("숫자만 넣어 주세요."). 부호 검사가 쉼표 검사보다 먼저. 쉼표만(`' , '`)은 빈 값이 아니라 format |
| `src/lib/ledger/match.ts` | L4: 입출금이 **보유가 바뀐 단계**에서 맞으면 근거 문장 끝에 "같은 단계에 매매가 있어 정확히 입금(출금) 때문이라고 확인하지는 못했습니다."(`tradeNoteText`). 상태·순입금·P 계산은 무변경(환전 매칭은 대상 아님) |
| `src/lib/ledger/rules.ts`·`snapshots.ts` | `isUsd` 를 조회표(울타리 회피 형태)에서 단순 비교 `currency === 'USD'` 로 되돌리고 주석을 사실 설명으로. 스냅샷 USD 행 판독을 `p.currency === 'USD'` 로(울타리가 센다) |
| `src/lib/__tests__/usd-cash-balance-fence.test.ts` | `ALLOWED` 에 `lib/ledger/rules.ts: 1`(원장 통화 판별 단일 함수 — 잔고 배열 아님)·`lib/ledger/snapshots.ts: 1`(크론이 기록한 스냅샷 positions USD 행 — kill-switch.ts 와 같은 성격) 사유와 함께 추가. 다른 줄 무변경 |
| `src/components/ledger/actions.ts`·`EntrySheet.tsx`·`src/app/settings/cash-ledger/CashLedgerPage.tsx` | M1 화면: `classifyWrite` 새 분기 `clientConflict` → 시트 결정 `stale` → 페이지가 **초안을 버리고**(같은 입력을 새 번호로 다시 보내지 않음) 최신 목록으로 교체(응답 `data`, 없으면 다시 읽기), 저장된 기록을 펼쳐 그 행으로 포커스, 토스트 "방금 보낸 기록이 이미 저장되어 있습니다. 목록에서 확인하고 필요하면 정정해 주세요" |
| `docs/db-schema.md` | L5: `cash_flow_ledger`(컬럼·CHECK 5·UNIQUE 3·인덱스·FK 2·"앱 시작 시 자동 생성 안 함, 마이그레이션 수동 적용")와 `system_config` 키 2개 절 추가 |
| 시험 | 새 `src/lib/ledger/__tests__/stage5-reviewer.test.ts` · 수정 `src/app/api/cash-ledger/__tests__/routes.test.ts`(317행 계약 교체 + M1·MX10·MH05·L2·L8) · `validate.test.ts`(쉼표만 → format) · `store-parse.test.ts`(isNoTable 표 이름) · `components/ledger/__tests__/{actions,ledger-render}.test.ts`·`app/settings/cash-ledger/__tests__/cash-ledger-page.test.ts`(M1 화면·배선, isUsd 시험 이름을 사실 설명으로) |

#### 2. `isUsd` 처리와 울타리 — 의도 약화 없음 확인
- 원장 쪽 USD 같음 비교는 이제 **두 곳뿐이고 둘 다 울타리가 센다**: `rules.ts` 의 `isUsd`(원장의 모든 USD 분기가 거치는 한 곳)와 `snapshots.ts` 의 스냅샷 행 판독. 다른 원장·화면 코드는 `isUsd()` 를 부른다(직접 비교를 흩지 않는다는 화면 시험은 이름·주석을 사실 설명으로 바꿔 유지). `validate.ts` 의 `isCurrency`(`v === 'KRW' || v === 'USD'`)는 형식 검사라 그대로.
- 약화 점검(울타리 시험만 돌림, 아래 F01~F05): 금지 위치(`kill-switch.ts`)에 잔고 배열 USD 선택 추가 · 원장 `service.ts` 에 USD 같음 비교 추가 · 허용된 `snapshots.ts` 에 비교 1개 더 · `rules.ts` 를 조회표(회피 형태)로 되돌림 · 거래소 어댑터 `kis.ts` 에 USD 비교 추가 → **5개 모두 울타리 시험 실패**. 즉 회피 형태도 이제 개수 불일치로 잡힌다.
- 🔴 **훅 범위**: `src/lib/__tests__/usd-cash-balance-fence.test.ts` 는 `SAFETY_PATHS` 에 **걸리지 않는다**(HEAD·작업 트리 목록 둘 다 대조 — 작업 트리는 타 세션 T-075 가 `^scripts/migrations/` 를 더했을 뿐). 안전 회귀망을 바꾸는 변경인데 훅이 강제하지 않으므로, 커밋 전 Reviewer 델타 검토 범위에 이 파일을 명시해 달라(사람의 규율). T-074 파일 중 훅 대상은 여전히 `scripts/migrations/T-074-cash-flow-ledger.sql` 하나.

#### 3. 변이 대응표 — **27/27 포착** (자기 변이 세트 + Reviewer 생존 11개 원문 재적용, 실행기 `scratchpad/t074-b-mut5/run5.py`, 결과 `result5.json`, 1개씩 적용 → 스위트 → 원본 복원·sha256 대조, 무변경 대조 Z00 통과)
| 변이 | 내용 | 잡은 시험 | 결과 |
|---|---|---|---|
| MU02 💰 | 환율 4자리 반올림 → 내림 | `stage5-reviewer` 1,250.11(부동소수 곱 …9.999) → `toFx4`·`usdToKrw(1e6)` = 1,250,110,000 | 포착 |
| MU08 💰 | 반영 대기 금액 부호 제거 | 반영 대기 출금 → `pending.krw = −300,000` | 포착 |
| MX10* 💰 | 정정 멱등의 대상 확인 삭제(새 코드: `sameEntryContent` 의 supersedes 비교) | 단위(대상 다르면 false) + 라우트(같은 키로 다른 기록 정정 → 409, 쓰기 0, 다른 기록 살아 있음) | 포착 |
| MH05 | restore 라우트가 경로 id 무시('1') | 라우트: 취소된 두 기록 중 두 번째만 되살림 | 포착 |
| MS06 | 스냅샷 환율 0·음수 허용 | `parseSnapshotRow` fx 0/−5 → null | 포착 |
| MM10 | `firstAfter` 의 `>=` → `>` | 최신 스냅샷과 같은 분의 기록 → 반영 대기 아닌 불일치 | 포착 |
| MM13 | 환전 같은 시각 앵커 제외 | 환전 13:40(스냅샷과 같은 분) → 반영됨 #104 | 포착 |
| MM08 | 스캔 시작 경계 `<` → `<=` | 스캔 시작과 같은 시각 기록 → 이번 스캔에서 반영됨 / 1분 뒤 시작이면 결과 없음 | 포착 |
| MX06 | `beforeBaseline` 경계 | 기준과 같은 분 → true, 1분 뒤 → false | 포착 |
| MX05 | 경로 id 0·선행 0 허용 | `parseId('0'·'007'·'-1'·'1.5'·'')` → null | 포착 |
| MU06 | 마지막 기록 동률 규칙 | 같은 발생 시각이면 id 큰 쪽(입력 순서 두 가지) | 포착 |
| N01~N04 | M1 비교 없이 늘 replayed · 메모 비교 삭제 · 금액 비교 삭제 · 환전 받은 금액 비교 삭제 | 라우트 M1 시험(금액 9 → 409, 필드별 409, 환전 받은 금액) + 단위 | 4/4 |
| N05~N07 | 화면 `clientConflict` 분기 삭제 · 시트가 stale 무시 · 🔴 충돌 뒤 초안 유지 | actions·render·배선 시험 | 3/3 |
| N08 | L8 표 이름 확인 삭제 | 라우트 L8(다른 표 1146 → 500) + 단위 | 포착 |
| N09 | L2 원문 노출 되살림 | 라우트 L2(`192.168…`·SQL 조각 미포함) | 포착 |
| N10 | L1 쉼표 자리 검사 삭제 | Reviewer 재현 입력 8개 | 포착 |
| N11 | L4 문장 삭제 | 매매 단계 반영됨 근거 문장 | 포착 |
| F01~F05 | 울타리 약화 점검(위 2절) | `usd-cash-balance-fence` | 5/5 |
Reviewer 가 등가로 본 7개(MU04·MU09·MU11·MT07·MX08·MX11·MB03)는 손대지 않았다.

#### 4. 검증 수치 (2026-10-23 13:1x, Stage 3·4 때와 나란히)
| 항목 | Stage 3·4 | Stage 5 |
|---|---|---|
| 앱 `tsc --noEmit` | 0 | **0** |
| 시험 포함 타입 검사 | 0 (17파일) | **0** (19파일 — `stage5-reviewer`·울타리 시험 추가) |
| 원장·라우트·화면·UI·설정 + 울타리 2종 | — | **19 스위트 통과 + 1 건너뜀(DB) · 480 통과 / 24 건너뜀** |
| jest 전체 | 234 통과 + 2 건너뜀 · 5,791 / 41 / 5,832 | **235 통과 + 2 건너뜀 · 5,834 / 41 / 5,875** |
| 일회용 DB 시험(`T074_TEST_DB_PORT`) | 24/24 (mariadb:11 = 11.8.8) | **24/24 (로컬 `mariadb:10.11` = 10.11.19, 서버 기본 utf8mb3·운영 sql_mode, 127.0.0.1:33082, 끝나고 제거·포트 닫힘)** — 이미지는 이미 로컬에 있어 새로 받지 않음 |
| `next build`(사전 로드) | exit 0 · `/settings/cash-ledger` 22.6 kB | **exit 0 · 22.9 kB · 외부 연결 차단 0** |

#### 5. 남은 것
- M1 의 화면 흐름(409 → 시트 닫힘·저장된 기록 펼침·토스트)은 소스 배선·렌더 시험으로만 확인했고 브라우저로는 다시 보지 않았다(QA high_risk (2) — 응답을 늦춰 시간 초과 뒤 금액을 고쳐 재전송).
- 서비스·검증·매칭 코드가 바뀌었으므로 Reviewer 델타 재검증 필요(마이그레이션 무변경 → 훅 scope 는 그대로). 울타리 시험 파일은 훅 대상이 아니니 델타 범위에 명시.
- L3(회원 1명 전제)·L6(DB 시험 기본 건너뜀 — `docs/db-schema.md` 에 "마이그레이션 변경 시 필수" 한 줄은 넣었다)·L7 은 코드 변경 없음.

### Stage 6 — QA 결함 반영

- [14:28] 범위: QA 결함 D-1·D-2·D-4 만(범위 확대 없음). **마이그레이션 SQL 무변경**(sha256 `ab17ad46…`). 격리 사본 `t074-iso-b` 에서만 검증(동기화 bad=0), 시험·빌드·서버 모두 `block-external-net.cjs` 사전 로드, 서버 준비 확인은 `/login`. git 쓰기·운영 DB·배포·`.env` 출력 0, 합성값만.

#### 1. 변경 파일
| 파일 | 내용 |
|---|---|
| `src/components/ledger/BaselineSheet.tsx` | D-1: `cashGaps`(통화별 스냅샷 값·입력값·차이·원화 환산, 정수 산술) · `cashGapParts`/`cashGapLine`/`cashGapNote` · 미리보기(`#sh-bprev`) 아래 `warnbox role=note id=sh-bgap`. 임계는 새 상수 없이 `feed.rules`(= `RULE.krw` 50,000원 · `RULE.usd` $50, 후보 탐지와 같은 '이상' 비교). **저장은 막지 않는다**(버튼 그대로). 빈 칸·형식 오류 칸은 비교하지 않음, 스냅샷에 달러 행이 없으면 달러 비교 없음. 조각(스냅샷 값·입력값·차이)마다 줄바꿈 금지 — 첫 360px 캡처에서 '차이 −' 와 '$1,800.00' 이 줄 끝에서 갈라져 고쳤다 |
| `src/lib/ledger/store.ts` | D-2: `assertLedgerTable()` = `SELECT 1 FROM cash_flow_ledger LIMIT 0`(행 안 읽음). 표가 없으면 1146 이 그대로 던져져 handlers 가 503 `not_migrated` |
| `src/lib/ledger/service.ts` | D-2: `putBaseline` 이 본문 검증(422) 뒤, 스냅샷 읽기·`system_config` 쓰기 **전에** `assertLedgerTable()` |
| `src/components/ledger/EntrySheet.tsx` | D-4: M1 충돌 토스트 끝에 "방금 고친 값은 저장되지 않았습니다." |
| `docs/screens.md` | 시트 상태 줄에 같은 요청 번호 충돌 409 흐름(초안 버림·저장된 기록 펼침·토스트 전문)과 기준 시트 현금 차이 경고 한 줄 |
| 시험 | `components/ledger/__tests__/ledger-render.test.ts`(D-1 3건 + D-4 문구 단언 갱신) · `app/api/cash-ledger/__tests__/routes.test.ts`(D-2 1건) · `lib/ledger/__tests__/helpers/fake-db.ts`(표 확인 SQL) · `lib/ledger/__tests__/t074-disposable-mariadb.test.ts`(A-1 안에 실제 MariaDB 단언 추가 — 시험 수 24 그대로) |

#### 2. 처리
- **D-1**: 기준 정하기·바꾸기·현금 확인 세 모드 모두 '확인값 대 그 스냅샷 값'을 비교한다(현금 확인 시트를 다시 열 때도 저장된 확인값이 스냅샷과 다르면 경고가 다시 보인다 — 그 차이가 손익에 계속 남아 있으므로 의도). 미리보기 계산(`baseTotal`)은 바꾸지 않았다. 원화 환산은 스냅샷 환율 × 센트 정수(`usdToKrw`) 뒤 천 원 단위 반올림으로 '약'.
- **D-2**: 순서만 바꿨다 — 본문 검증 오류(422)는 여전히 먼저(다른 쓰기 경로와 같은 순서, 쓰기 0). 표가 있으면 SELECT 1회가 늘 뿐이다. 실제 MariaDB 10.11 에서도 `LIMIT 0` 확인이 1146(`ER_NO_SUCH_TABLE`, 메시지에 표 이름)을 내고 `putBaseline` 뒤 `system_config` 의 `cash_ledger_baseline` 행이 0 임을 확인했다. 참고(코드 변경 없음): 후보 '입출금 아님'은 쓰기 전에 원장을 먼저 읽고, '되돌리기'는 표시가 없으면 쓰지 않으므로(마이그레이션 전에는 표시가 생길 수 없음) 같은 문제가 없다.
- **D-4**: 토스트 문구 한 문장 추가와 `docs/screens.md` 한 줄. designer 문구 확인은 받지 않았다.

#### 3. 경고 최종 문구 전문
- 제목: `! 확인한 현금이 스냅샷 값과 크게 다릅니다`
- 달러 줄: `달러 현금: 스냅샷 $1,918.60 · 입력 $118.60 · 차이 −$1,800.00(약 −2,383,000원)` (합성 케이스, 환율 1,323.89)
- 원화 줄: `원화 현금: 스냅샷 1,000,000원 · 입력 3,000,000원 · 차이 +2,000,000원`
- 끝 문장: `이 차이는 앞으로의 손익에 그대로 남습니다. 스냅샷이 틀린 값을 읽고 있다면 먼저 원인을 확인하고, 모르면 달러 현금 칸을 비워 두세요.` — 원화만이면 '원화 현금 칸', 두 통화 모두면 '두 칸'
- D-4 토스트: `! 방금 보낸 기록이 이미 저장되어 있습니다. 목록에서 확인하고 필요하면 정정해 주세요. 방금 고친 값은 저장되지 않았습니다.`

#### 4. 변이 대응표 — 9/9 포착 (실행기 `scratchpad/t074-b-mut6/run6.py`, 결과 `result6.json`, 1개씩 적용 → 스위트 → 원본 복원·sha256 대조, 무변경 대조 Z00 통과, 줄바꿈 수정 뒤 다시 돌려 같은 결과)
| 변이 | 내용 | 잡은 시험 |
|---|---|---|
| S01·S02 | 달러·원화 경고 조건 반전(`>=` → `<`) | D-1 임계 표 + 시트 렌더 |
| S03 | 임계 0(조금만 달라도 경고) | 49,999원 / $49.99 차이 → 경고 없음 |
| S04 | 달러 경계 '이상' → '초과' | 정확히 $50.00 차이 → 경고 |
| S05 | 시트에 경고 상자 안 그림 | 시트 렌더(`id="sh-bgap"`·문장) |
| S06 | 입력 대신 스냅샷 값과 비교(늘 경고 없음) | 시트 렌더 |
| S07 | 🔴 D-2 표 확인 삭제 | 라우트: 503 인데 `system_config` 쓰기 1 → 실패 |
| S08 | 🔴 D-2 순서 되돌림(저장 뒤 표 확인 — QA 가 본 원래 순서) | 라우트: 첫 SQL 이 표 확인이 아님·쓰기 1 |
| S09 | D-4 문장 삭제 | 토스트 문구 단언 |

#### 5. 검증 수치 (2026-10-23 14:28, Stage 5 와 나란히)
| 항목 | Stage 5 | Stage 6 |
|---|---|---|
| 앱 `tsc --noEmit` | 0 | **0** |
| 시험 포함 타입 검사 | 0 (19파일) | **0** (19파일) |
| jest 전체 | 235 통과 + 2 건너뜀 · 5,834 / 41 / 5,875 | **235 통과 + 2 건너뜀 · 5,838 / 41 / 5,879** (새 시험 4건) |
| 원장·라우트·화면·UI·`src/app/settings` 전체 + 울타리 2종(USD·risk 격리) | — (Stage 5 의 480 은 경로 묶음이 달라 직접 비교 불가) | **19 스위트 통과 + 1 건너뜀(DB) · 510 통과 / 24 건너뜀** |
| 일회용 DB 시험(`mariadb:10.11` = 10.11.19, 서버 기본 utf8mb3·운영 sql_mode, 127.0.0.1:33083) | 24/24 | **24/24** — 끝나고 제거·포트 닫힘 |
| `next build`(사전 로드) | exit 0 · 22.9 kB | **exit 0 · `/settings/cash-ledger` 23.4 kB · 외부 연결 차단 0** |
| D-1 화면 캡처(일회용 DB 127.0.0.1:33075 + `next start` 3975, 합성 스냅샷 #110 달러 $1,918.60·환율 1,323.89, 달러 칸 118.60) | — | **360px**: 상자 폭 326px, 줄 3개(제목 1줄 · 값 줄 2줄 — '스냅샷 $1,918.60 · 입력 $118.60 ·' / '차이 −$1,800.00(약 −2,383,000원)' · 끝 문장 3줄), 조각 3개 모두 한 줄 안(갈라짐 0), 시트·문서 가로 넘침 0, 저장 버튼 활성. **412px**: 같은 줄 구성(끝 문장 2줄), 넘침 0. 미리보기 `기준 총자산 17,005,015원 → 14,622,013원`. 서버 외부 연결 시도 0, 브라우저 외부 요청 0. 캡처 파일은 판정 뒤 삭제 |

#### 6. 남은 것
- D-1·D-4 문구는 designer 확인을 받지 않았다(QA 권고는 'designer 확인'). 경고 위치는 미리보기 바로 아래.
- 바뀐 코드: 원장 서비스·저장 계층(`service.ts`·`store.ts`)과 화면 2파일 — Reviewer 델타 재검증 대상. 마이그레이션 무변경이라 훅 scope 는 그대로.
- D-1 은 경고일 뿐이다. 사용자의 실제 달러 값을 어떻게 넣을지(Q5)는 여전히 사용자 결정 사항이다.

### Stage 7 — designer 문구·구조

- [14:38] 범위: designer 의 Stage 6 점검 4건만(저장을 막지 않는 경미한 수정, 문구는 그대로 채택). Reviewer 가 Stage 6 을 감사하는 동안 **격리 사본 `t074-iso-b` 에서만** 구현·검증했고, 감사 종료(14:37)를 확인한 뒤 작업 트리에 반영했다. **마이그레이션 SQL 무변경**(sha256 `ab17ad46…`). git 쓰기·운영 DB·배포·`.env` 출력 0, 합성값만, 시험·빌드·서버 모두 `block-external-net.cjs` 사전 로드, 서버 준비 확인은 `/login`.
- 반영 절차: ① 작업 트리의 T-074 파일 67개를 사본과 대조해 63개가 같고 4개만 다름을 확인 ② 그 4개는 작업 트리 사본에 Stage 7 편집을 그대로 다시 적용하니 격리 사본과 바이트가 같았다(= Stage 6 이후 다른 변경이 끼지 않음) ③ `base-sha256.txt` 재확인 → `patch -p1` 로 `stage7.diff` 적용 → 반영 파일 4개를 사본과 바이트 대조, 다른 파일 0(bad=0), `.orig`·`.rej` 없음. 사본·diff: `scratchpad/t074-stage7/{files/,stage7.diff,base-sha256.txt,stage7-sha256.txt}`.

#### 1. 변경 파일
| 파일 | 내용 |
|---|---|
| `src/components/ledger/BaselineSheet.tsx` | ① 경고 끝 문장 교체(`cashGapNote`): 손익 영향 = −(통화별 차이의 원화 환산 합). 입력이 스냅샷보다 낮으면 '많게', 높으면 '적게'. 금액은 합계 절댓값을 천 원 단위로 반올림(환산은 Stage 6 `cashGaps` 의 `usdToKrw` 값 그대로). ② 차이 경고가 있으면 미리보기의 '두 값 모두 확인'을 초록 ✓ 대신 **중립 ◌**(`St kind="na"`). 경고 상자는 aria-live 영역 `#sh-bprev` **밖**(시트 본문 형제 — 시트 본문 간격 14px 를 쓰도록 `marginTop` 을 지움). 저장 버튼 두 개(기준 저장·충돌 시 내 값으로 저장)에 경고가 있을 때만 `aria-describedby="sh-bgap"`. ④ 현금 칸 도움말 교체(달러·원화 같은 구조, 스냅샷 값은 그 스냅샷 숫자로 보간) |
| `src/components/ledger/EntrySheet.tsx` | ③ M1 충돌 토스트 교체(`clientConflictToast(existingId)`): 서버가 준 저장된 기록 번호로 보간. 조사는 번호 끝자리로 정함(`idWithRo` — 0·3·6 은 '으로', 나머지는 '로'; '#17로'·'#13으로'). 번호가 없는 비정상 응답이면 '펼쳐 두었습니다' 대신 목록 확인 안내 |
| `docs/screens.md` | 시트 상태 줄의 충돌 토스트 문구와 기준 시트 경고(끝 문장 요지·중립 ◌·live 밖·aria-describedby·도움말) |
| `src/components/ledger/__tests__/ledger-render.test.ts` | 문구 단언 갱신 + 새 describe 'designer 점검 반영 (Stage 7)' 3건 |

#### 2. 최종 문구 전문
- 경고 제목: `! 확인한 현금이 스냅샷 값과 크게 다릅니다`
- 경고 값 줄(Stage 6 그대로): `달러 현금: 스냅샷 $1,918.60 · 입력 $118.60 · 차이 −$1,800.00(약 −2,383,000원)` / `원화 현금: 스냅샷 … · 입력 … · 차이 ±…원`
- 경고 끝 문장: `그대로 저장할 수 있지만, 그러면 손익이 스냅샷 값으로 계산할 때보다 약 2,383,000원 많게 보이고 이 차이가 앞으로도 남습니다. 왜 다른지 모르면 달러 현금 칸을 비우고 저장하세요. 확인되면 나중에 넣을 수 있습니다.`
  - 칸 이름: 원화만 '원화 현금', 두 통화면 '두'. 방향: 합이 음수면 '많게', 양수면 '적게'.
  - 반올림해 0원이 되면 '약 …원' 대신 '1,000원 미만'.
  - 덧붙인 예외 문장(designer 문구 밖): 두 차이가 정확히 상쇄되어 합이 0이면 `그대로 저장할 수 있지만, 두 차이가 서로 상쇄되어 지금은 손익 차이가 없어 보일 뿐 값이 틀렸다면 앞으로 어긋날 수 있습니다. 왜 다른지 모르면 두 칸을 비우고 저장하세요. 확인되면 나중에 넣을 수 있습니다.` — designer 확인 필요.
- 미리보기 상태(경고 있을 때): `◌ 두 값 모두 확인 — 저장하면 ‘현금 확인됨’` (경고 없으면 `✓` 초록 그대로)
- M1 충돌 토스트: `! 방금 고친 값은 저장되지 않았습니다. 먼저 보낸 내용이 이미 #{id}로 저장되어 있어 펼쳐 두었습니다. 다르면 정정해 주세요.` (번호 끝자리가 0·3·6 이면 '으로'.) 번호가 없으면: `! 방금 고친 값은 저장되지 않았습니다. 먼저 보낸 내용이 이미 저장되어 있습니다. 목록에서 확인하고 다르면 정정해 주세요.`
- 달러 칸 도움말: `스냅샷 값 $1,918.60 · KIS 앱 ‘외화예수금’ 기준(‘주문가능금액’은 미체결 주문에 묶인 돈이 빠져 더 작을 수 있음). 확실하지 않으면 비워 두세요.` (금액은 보간, ‘외화예수금’ 굵게 유지)
- 원화 칸 도움말(같은 구조로 맞춤, 달러 문구 없음): `스냅샷 값 1,465,000원 · KIS 앱 ‘원화 예수금’ 기준. 확실하지 않으면 비워 두세요.` — 원래 `스냅샷 값 … · KIS 앱 ‘원화 예수금’` 로 모순은 없었지만 '비워 두세요' 안내를 같은 형식으로 붙였다.

#### 3. 변이 대응 — 5/5 포착 (실행기 `scratchpad/t074-b-mut7/run7.py`, 결과 `result7.json`, 1개씩 적용 → 스위트 → 원본 복원·sha256 대조, 무변경 대조 Z00 통과)
| 변이 | 내용 | 잡은 시험 |
|---|---|---|
| U01 🔴 | 끝 문장 많게/적게 부호 반전 | `cashGapNote` 단언(달러 낮음 → 많게 · 원화 높음 → 적게 · 두 통화 합) |
| U02 | 경고가 있어도 초록 ✓ 유지 | Stage 7 ◌/✓ 시험 |
| U03 | 저장 버튼 aria-describedby 제거 | Stage 7 구조 시험·Stage 6 렌더 단언 |
| U04 | 토스트 번호 하드코딩(#17) | Stage 7 토스트 시험(#42·#23) |
| U05 | 조사 판정 삭제(늘 '로') | '#13으로'·`idWithRo` 표 |

#### 4. 검증 수치 (2026-10-23 14:3x, Stage 6 와 나란히)
| 항목 | Stage 6 | Stage 7 |
|---|---|---|
| 앱 `tsc --noEmit` | 0 | **0** |
| 시험 포함 타입 검사 | 0 (19파일) | **0** (19파일) |
| jest 전체 | 5,838 / 41 / 5,879 (235 + 2 건너뜀) | **5,841 / 41 / 5,882** (235 + 2 건너뜀, 새 시험 3건) |
| 원장·라우트·화면·UI·`src/app/settings` + 울타리 2종 | 19 + 1 건너뜀 · 510 / 24 | **19 + 1 건너뜀 · 513 / 24** |
| 일회용 DB 시험(`mariadb:10.11` = 10.11.19, utf8mb3 서버 기본·운영 sql_mode, 127.0.0.1:33084) | 24/24 | **24/24** — 끝나고 제거·포트 닫힘 |
| `next build`(사전 로드) | exit 0 · 23.4 kB | **exit 0 · `/settings/cash-ledger` 23.7 kB · 외부 연결 차단 0** |
| 360·412px 캡처(일회용 DB 127.0.0.1:33075 + `next start` 3975, 합성 스냅샷 #110 달러 $1,918.60·환율 1,323.89, 원화 칸 = 스냅샷 값, 달러 칸 118.60) | — | 경고 상자가 `#sh-bprev` 밖 · 저장 버튼 `aria-describedby=sh-bgap` · 미리보기 상태 `st na`(◌) · 값 조각 3개 모두 한 줄 안 · 경고 끝 문장 4줄(360·412 모두) · 달러 도움말 3줄(360)/2줄(412) · 원화 도움말 2줄 · 미리보기와 경고 사이 14px(시트 본문 간격) · 시트·문서 가로 넘침 0 · 서버·브라우저 외부 연결 0. 캡처 파일은 판정 뒤 삭제 |

#### 5. 남은 것
- 합이 0일 때의 예외 문장과 원화 칸 도움말에 붙인 '확실하지 않으면 비워 두세요.'는 designer 원문 밖이라 designer 확인이 필요하다.
- 바뀐 것은 화면 2파일·시험·문서다(서버·저장 계층·마이그레이션 무변경). Stage 6 Reviewer 판정 scope 밖의 화면 변경이므로, Reviewer 델타 확인이 필요한지는 Leader 가 판단한다.

### Stage 8 — 합 0 문장 교체

- [23:22] 범위: designer Stage 7 확인 결과 중 1건만 — 두 통화 차이의 원화 환산 합이 0일 때 경고 끝 문장을 교체(로직·분기 조건 무변경, 문자열과 시험 단언만). designer 는 원화 칸 도움말의 "확실하지 않으면 비워 두세요."를 채택했다. 기준 환율이 고정이라 합이 0이면 손익은 지금도 앞으로도 바뀌지 않으므로, 옛 문장("앞으로 어긋날 수 있습니다")은 사실과 달랐다.
- Reviewer 가 Stage 7 을 감사하는 동안 **격리 사본에서만** 구현·검증했다. 감사 종료(23:21)를 확인한 뒤 반영했다.
  - 반영 전: `base-sha256.txt` 가 작업 트리와 일치했고, 나머지 T-074 파일 64개도 사본과 같아 다른 변경이 끼지 않았다.
  - 반영: `patch -p1` 로 `stage8.diff` 적용.
  - 반영 후: 사본과 바이트 대조 bad=0, `.orig`·`.rej` 없음.
  - 마이그레이션 SQL 무변경(sha256 `ab17ad46…`). git 쓰기·운영 DB·배포 0, 외부 TCP 차단 사전 로드.
  - 사본·diff: `scratchpad/t074-stage8/`.

#### 1. 변경 파일
| 파일 | 내용 |
|---|---|
| `src/components/ledger/BaselineSheet.tsx` | `cashGapNote` 의 `sum === 0` 분기 문자열만 교체(뒷부분 `${tail}` 그대로) |
| `src/components/ledger/__tests__/ledger-render.test.ts` | 합 0 단언을 전문 `toBe` 로 바꾸고, 시트 렌더 단언 추가: 원화 +1,000,000원, 달러 −$800.00 × 1,250 → 새 문장이 보이고 '많게'·'적게'는 없음 |
| `docs/screens.md` | 기준 시트 경고 설명에 합 0 문장 추가 |

#### 2. 최종 문구 전문 (합 0일 때)
`그대로 저장해도 두 차이가 서로 상쇄되어 손익은 바뀌지 않습니다. 다만 두 값 모두 스냅샷과 크게 달라 어느 쪽이 맞는지 확인이 필요합니다. 왜 다른지 모르면 두 칸을 비우고 저장하세요. 확인되면 나중에 넣을 수 있습니다.`

#### 3. 검증
| 항목 | Stage 7 | Stage 8 |
|---|---|---|
| 앱 `tsc --noEmit` | 0 | **0**(반영 직후 다시 실행해도 0) |
| 시험 포함 타입 검사 | 0 | **0**(반영 직후 다시 실행해도 0) |
| 화면 스위트(`src/components/ledger`·`src/app/settings/cash-ledger`) | 125 통과 | **125 통과**(반영 직후 다시 실행) |
| jest 전체 | 5,841 / 41 / 5,882 | **5,841 / 41 / 5,882**(기존 시험 안에 단언만 추가) |
| `next build`(사전 로드) | exit 0 · 23.7 kB | **exit 0 · 23.7 kB · 외부 연결 차단 0** |
| 변이(`scratchpad/t074-b-mut8/run8.py`) | — | **2/2 포착**: V01 합 0 문장 삭제 · V02 합 0 분기 조건 반전, 무변경 대조 Z00 통과 |
| 360px 캡처(일회용 DB + `next start`, 합성 스냅샷 원화 1,465,000원·달러 $2,700·환율 1,250 → 원화 2,465,000원, 달러 $1,900 입력) | — | 미리보기 `기준 총자산 17,840,000원` 화살표 없음(합 0과 일치), 상태 중립 ◌, 경고 상자: 값 줄 2개와 새 문장, 값 조각 6개 모두 한 줄 안, 가로 넘침 0, 서버·브라우저 외부 연결 0. 캡처 파일 삭제, 컨테이너 제거, 포트 닫힘 |


## Reviewer

- [12:57] 범위·방법: 대상은 T-074 전체(WP-A + WP-B + Stage 3 + Stage 4). 읽기 전용 감사 — `src/`·`scripts/`·`mockups/`·`docs/` 수정 0, git 쓰기·배포·pm2·크론 0, 운영/공유 NAS DB 접근 0(이번 감사에 운영 DB 조회 자체가 없음), `.env` 값 출력 0(초대 코드 설정 여부를 줄 수로만 센 것이 전부), 앱·시험·빌드의 외부 네트워크 0(전부 `block-external-net.cjs` 사전 로드, 서버는 띄우지 않음). 격리 사본 3개: (a) `scratchpad/t074-rev-main` = 작업 트리 통째 사본(T-074 관련 65개 파일 sha256 대조 bad=0), (b) `scratchpad/t074-rev-head` = `git archive HEAD`(fa0669c) + T-074 파일 64개 덧씌움(개발자 격리 방식과 같음), (c) `scratchpad/t074-rev-mut` = (b)의 복사본 — 변이는 여기서만 적용하고 끝난 뒤 75개 파일을 원본·(b)와 sha256 대조해 전부 같음을 확인했다. 탐침 시험(`src/__rev__/`)은 사본에만 있고 `$P` 에는 없다.
- [12:57] 독립 재현(항목 6-i) [확실]: (b)에서 앱 `tsc --noEmit` 0 오류 · 시험 포함 타입 검사(T-074 시험 17파일) 0 오류 · jest 전체 234 스위트 통과 + 2 건너뜀, 5,791 통과 / 41 건너뜀 / 5,832 · WP-B 7 스위트 144건 — 개발자 수치와 정확히 같다. `TZ=America/New_York`·`Asia/Tokyo` 에서도 원장·화면 시험 통과(시간대 무관). `next build`(15.5.22, 사전 로드) exit 0 — `/api/cash-ledger*` 9개 ƒ, `/settings/cash-ledger` ○ 22.7 kB. 참고: 작업 트리 사본(a)은 tsc 4건·jest 16 스위트가 실패하지만 원인은 전부 타 세션 T-040 의 `@workspace/api-usage` 미설치(`src/lib/api-usage.ts`)이고, T-074 스위트(26개/752건)는 같은 사본에서도 통과 — T-074 와 무관하지만 이 상태 그대로는 작업 트리 전체의 커밋·빌드가 막힌다는 뜻이다.
- [12:57] 항목 1 돈 계산 — 직접 실행(탐침 4 스위트) [확실]: ① 회계 정본대로다. `P = V − b0 − Σ순입금(반영 대기 제외, 불일치 포함)`, 환전 순입금 0, 기준 시각 이전·같은 분 기록은 계산 제외. 합성 기준 22,000,000원에서 입금 100만 반영됨 → P=+200,000(순입금을 뺀 값), 같은 입금이 반영 대기면 P=+100,000(순입금 제외), 출금 50만 → P=+100,000, 환전은 P 불변, 기준 07:13:04 에 07:13 기록 → 제외(pre)·07:14 → 포함. USD 입금 $500·저장 환산 650,000 → P=0. ② 정수 산술: `usdToKrw(118.6, 1324.63)=157,101`(손계산 157,101.118 과 일치), 반올림은 Math.round 와 같은 '반은 +∞'(0.5→1, −0.5→0), `usdToKrw(1e9,1500)=1.5e12` 오버플로 없음, 달러→센트 변환은 0.01~20,000.00 구간 2,000,000개에서 `round(x*100)` 불일치 0건. ③ 입력 파서: `1,000,000`(원)=1000000, `100만`·`1e5`·`1_000`·`+5`·`0x10`·`5.`·전각 숫자·`NaN`·`Infinity`·`1e21` 은 전부 format 오류(조용한 오해석 없음), 원 소수·달러 3자리·`−5`(U+2212)·0·상한(원 1조/$10억)+1 은 거부, 상한 값은 허용. 예외: 쉼표를 위치 검증 없이 지우므로 `118,60`(USD)=11,860 · `1,5`(USD)=15 로 읽는다(발견 L1). ④ 매칭 경계: 원화 200만 입금(허용 ±2,000) → 변화 2,002,000 반영됨 / 2,002,001 불일치, 50만(±1,000) → 501,000 / 501,001, $100(±$1) → 101 / 101.01, $10,000(±$10) → 10,010 / 10,010.01, 36시간 창은 정각이면 반영됨 / +1분이면 불일치, 같은 시각 스냅샷은 앵커(반영됨), 기록 시각 뒤 스냅샷이 없으면 반영 대기, 같은 입금 두 번 → 두 번째는 불일치(소비 키), 출금 기록 vs 입금 변화 → 불일치, 환전은 같은 단계·연속 두 단계 모두 반영됨, 입금으로 적었는데 환전처럼 보이면 `suggest`. ⑤ 환전 비용 `exchangeCostKrw`: 2,056,912원→$1,550 @1324.63 = 3,735원, $1,550→2,050,000원 = 3,177원(분석가 표의 '약 3,700원'과 일치), 달러 0 이면 환율 null. ⑥ X 왕복: 분석가 A 표 모양(Y=1550, X=368.51 → 하루 +0.03, 4일 7단계)은 왕복 1패턴으로 억제되어 후보 0건·`gapHint=$368.60` 정상. X 복귀와 같은 단계에 진짜 $500 입금이 겹치면 후보 delta 가 868.57 로 합쳐져 나온다(개발자가 적은 한계 그대로). 진짜 +$100/−$100 이 왕복으로 억제되는 것도 문서화된 한계. ⑦ 이상 입력: `toCents`/`usdToKrw`/`baseTotal` 에 NaN·Infinity 가 들어가면 BigInt RangeError 로 던진다(조용히 0 이 되지 않음) — 현재 데이터 경로(`dec()`·`parseBaselineDoc` 가 유한 수만 통과)로는 도달하지 않는다.
- [12:57] 항목 2 DDL — MariaDB 10.11 실증 [확실]: docker 가 되어 공개 이미지 `mariadb:10.11`(10.11.19)로 일회용 컨테이너를 띄웠다(127.0.0.1:33081 전용, 서버 기본을 운영과 같이 `utf8mb3`/`utf8mb3_general_ci` + 운영 sql_mode 로 기동, 끝나고 컨테이너 제거·포트 닫힘 확인). 이미지 내려받기가 이번 감사의 유일한 외부 접속이다(앱·시험 프로세스가 아님). 결과: ① 개발자 일회용 DB 시험 24/24 통과(적용 전 ER_NO_SUCH_TABLE → 2회 적용 멱등 → CHECK 8종 4025 → live UNIQUE → 정정 1회 → 동시성(취소/정정/복구 5회 중 1회) → 기준 낙관적 잠금 → 서비스 전체 흐름 → 되돌리기 2회). ② 운영과 같은 경로(CLI 로 `< 파일`)로 2회 적용 모두 성공, `SHOW CREATE TABLE` 이 개발자 DDL 과 같다(생성열 STORED, CHECK 5, UNIQUE 3, FK 2). ③ 내가 따로 넣어 본 탐침: 환전 counter 누락·counter_currency 없이 금액만·입출금에 counter 값·받은 원화 소수·USD 0.004(반올림 0) → 전부 4025 거부, 같은 (계좌·종류·통화·금액·분) 살아 있는 중복 1062, 대문자만 다른 멱등키 1062(콜레이션 CI), 같은 행 두 번 정정 1062, 없는 supersedes/계좌 FK 1452, 초 `.5` 입력은 DATETIME(0)으로 잘려 CHECK 통과(앱은 이미 분 단위만 받음), ENUM 밖 값 1265, DECIMAL 범위 초과 1264, 이모지 메모 200자 허용·201자 1406. ④ CHECK 의 NULL 구멍: 환전 분기는 `IS NOT NULL` 명시로 막혀 있고 나머지 CHECK 는 전부 NOT NULL 열만 참조해 구멍 없음. ⑤ 인덱스 길이(utf8mb4 VARCHAR(36) UNIQUE 144바이트)·콜레이션(표에 utf8mb4_general_ci 명시, 서버 기본이 utf8mb3 여도 영향 없음) 이상 없음. ⑥ 롤백: 이 표를 참조하는 객체가 없어 표 삭제 한 문장만으로 되돌려진다(자기 참조 FK 포함, 시험 A-3 이 2회 확인), `system_config` 의 두 키는 남아도 무해(주석에 정리 문장 있음). ⑦ 다른 테이블 영향: `accounts` 를 참조하는 FK 하나(계정 행 삭제만 막음, 현재 삭제 경로 없음)와 CREATE 순간의 짧은 메타데이터 잠금뿐이며 `lock_wait_timeout=5` 로 상한. 한계 [확실]: 운영 10.11.11 이 아니라 10.11.19 였다(같은 마이너, 이 DDL 이 쓰는 CHECK·생성열·FK 는 10.2 이후 동일 동작). `T074_TEST_DB_PORT` 를 주지 않으면 이 24건은 건너뛴다(발견 L6).
- [12:57] 항목 3 API 보안 [확실, 코드 전수 + 시험]: ① 9개 엔드포인트 전부 `run()` → `requireUserId`(`handlers.ts:44-48`)를 거친다 — 인증 이중 확인 삭제 변이(MH02)는 시험이 잡았다. 미들웨어 `PUBLIC_EXACT`/`OAUTH_PUBLIC_PATHS` 에 cash-ledger 경로 없음(`middleware.ts` 무변경, 정적 시험이 고정), 세션 쿠키는 `SameSite=Lax` 라 교차 사이트 POST(CSRF)에는 쿠키가 안 붙는다. ② SQL: 모든 값은 `?` 바인딩(템플릿 보간은 상수 컬럼 목록·`FOR UPDATE` 뿐), 경로 id 는 `^[1-9]\d{0,17}$`·후보 키 `^[1-9]\d{0,17}-(KRW|USD)$`·멱등키 `^[A-Za-z0-9_-]{8,36}$` 를 서버에서 다시 검사(탐침으로 확인). ③ 서버 재검증: 화면과 같은 `validateEntryInput` 을 서버가 다시 돌려 기준 이전·미래·부호·소수·상한·같은 통화 환전·메모 길이를 422 로 거부 — 각각 변이로 확인(MX03·MV01~MV07). ④ 멱등·동시성: 취소 조건부 UPDATE·정정 트랜잭션(FOR UPDATE + 0행 확인 + UNIQUE)·복구 잠금 읽기·기준 JSON_EXTRACT 조건부 UPDATE 가 실제 10.11 에서 동시 5회 중 1회만 성공(위 24건 + 변이 MT01~MT06 포착). ⑤ 사용자 간 분리: **원장은 사용자별로 나뉘지 않는다** — `LEDGER_ACCOUNT_ID=1` 고정이고 `requireUserId` 의 id 는 감사 열(created_by·deleted_by·표시한 사람)에만 쓰인다. 로그인한 어느 회원이든 같은 원장·기준을 읽고 쓰고 취소한다(응답에 회원 id 숫자가 실림). 설계(분석가 Q2: 돈의 주체는 KIS 계좌)이고 앱의 다른 대시보드·잔고 API 도 회원별로 나뉘어 있지 않아 새로운 종류의 노출은 아니다(발견 L3). 요청하신 '사용자 id 필터 제거' 변이는 **필터가 존재하지 않아** 만들 수 없었고 대신 계좌 범위 상수 변경(MR05)을 넣어 포착됐다. ⑥ 에러 메시지: 500 응답 본문이 `서버 오류로 처리하지 못했습니다: ${e.message}` 로 원문을 싣는다 — 실행해 보니 `connect ECONNREFUSED 192.168.219.100:3306`(내부 DB 주소)·SQL 구문 오류 조각이 로그인한 회원에게 나간다(발견 L2; 다른 114개 라우트도 같은 관행). ⑦ `not_migrated` 변환: **그 경우에만 일어나지 않는다** — `isNoTable` 이 어느 표든 1146 이면 변환하므로 `portfolio_snapshots`·`system_config` 가 없을 때도 503 `not_migrated`('원장 테이블이 아직 없습니다 … 기록이 없어진 것이 아닙니다')가 나가고 화면은 중립 '준비 중'으로 오류·다시 시도를 숨긴다(실행 확인, 발견 L8). 다른 오류(연결 거부·구문 오류)는 500 으로 남는다. ⑧ 요청 본문 크기 제한은 없다(Next 기본, 인증된 회원 한정이라 낮음).
- [12:57] 항목 4 안전장치 분리 [확실]: `src/lib/ledger/**` 의 import 는 `./*`·`next/server`·`mysql2`(타입)·`@/lib/db`(`getPool` 만)·`@/lib/auth/current-user` 뿐 — safety·signals·strategy·orders·cron·exchanges·notify 0건(grep + 정적 시험 `static-invariants` 고정). 거꾸로 ledger 를 import 하는 곳은 `src/components/ledger`·`src/app/settings/**`·`src/app/api/cash-ledger/**` 뿐이고 매매 경로(`lib/safety|signals|strategy|exchanges`, `app/api/orders|signals|cron|safety`)에서는 0건. 쓰기 SQL 은 `cash_flow_ledger`·`system_config` 의 키 2개뿐(정적 시험이 SET 절·대상 표를 파싱), KIS·fetch 호출 0. 미마이그레이션·DB 오류는 ledger 라우트 안에서 끝나며 매매 경로에 닿지 않는다. 유일한 접점은 설정 화면 요약 행(`CashLedgerSummaryRow`)이 방문마다 `GET /api/cash-ledger` 를 부르는 것 — 자체 상태라 실패해도 안전장치 스위치 화면은 그대로이고(행만 경고/준비 중), 풀(최대 10)은 조회 때 최대 5개를 동시에 쓴다. 이 조회는 방문마다 최대 120일치 스냅샷(현재 수천 행 미만)을 읽고 JSON 을 파싱하며 바뀐 반영 상태를 UPDATE 하므로 시간이 갈수록 설정 첫 화면의 부담이 늘어난다(발견 L7).
- [12:57] 항목 5 `isUsd()` 판단: **(b)와 (c)의 혼합 — 울타리의 의도(잔고 배열에서 USD 를 골라 읽지 않는다)를 깨지는 않지만 울타리를 '우회'한 형태이므로 (c)로 정리하길 권고**. 근거(울타리 시험 본문 `src/lib/__tests__/usd-cash-balance-fence.test.ts` 100행 전체를 직접 읽음): 이 시험의 의도는 `Balance[]`(거래소 잔고 배열)에서 USD 행을 다시 '골라 읽어' 예수금 값으로 쓰는 새 지점을 막는 것이고, 새 지점이 정말 필요하면 허용 목록에 사유와 함께 추가해 리뷰 대상이 되게 하라고 머리 주석이 적고 있다. ① 원장의 `currency` 는 닫힌 유니온 `'KRW'|'USD'` 라 `Balance[]` 와 무관 — 이 분기 9곳이 울타리가 막으려는 위험이 아니라는 개발자 설명은 맞다 [확실]. ② 그런데 해결 방식이 허용 목록 추가가 아니라 **정규식이 못 보는 모양으로 바꾸기**다: `isUsd()` 는 `USD_FLAG[c] === true` 조회표(`rules.ts:65-68`)이고, `cash-ledger-page.test.ts:122-129` 는 '울타리 모양의 비교를 쓰지 않는다'를 시험으로 굳혀 두었다. 앞으로 원장 쪽 USD 비교는 울타리에 영영 보이지 않는다. ③ 더 중요한 한 곳: `snapshots.ts:71` 의 `if (cur === 'USD')` 는 **포트폴리오 스냅샷 positions 의 USD 행에서 달러 예수금 값을 읽는 코드**로, 허용 목록에 사유와 함께 올라 있는 `lib/safety/kill-switch.ts`(`isUsdRow`, 스냅샷 positions 판별)와 같은 종류인데 변수 이름(`cur`)이 정규식(`currency` 단어를 요구)을 피해 목록 밖에 있다. 개발자 보고(Stage 1 2절 23)에 이 사실이 적혀 있어 은폐는 아니다. 권고(c): ㉮ `snapshots.ts:71` 을 `(p).currency === 'USD'` 모양으로 바꿔 울타리가 세게 하고, `ALLOWED` 에 `'lib/ledger/snapshots.ts': 1` 을 '크론이 기록한 스냅샷 positions 의 USD 행 — kill-switch.ts 와 같은 성격, Balance[] 아님' 사유로 추가. ㉯ `isUsd()` 조회표는 닫힌 유니온 가독성용으로 유지해도 되지만 울타리 회피를 설명하는 주석(`rules.ts:60-64`)·시험 이름은 '울타리 대상 아님'이라는 사실 설명으로 바꾼다. ㉰ 울타리 시험 수정은 안전 회귀망을 건드리는 일이라 Leader 지시 뒤 별도 변경으로(이번 범위 밖). 현재 상태로도 울타리 시험은 통과하고 매매 경로 영향 0 이라 차단 사유는 아니다.
- [12:57] 항목 6-ii 독립 변이 — 내가 새로 고안한 97개(두 배치 84 + 13, 대조군 2개는 별도)를 격리 사본에서 1개씩 적용해 원장·라우트·화면·UI 공용·설정 스위트 19개 + 울타리 2개 + 실제 10.11 DB 시험 24건을 돌렸다(`--bail=1`, 끝날 때마다 원본 복원·sha256 대조, 무변경 대조군은 통과). **97개 중 79개 포착, 18개 생존.** 생존 18개 중 7개는 등가(관찰 가능한 차이 없음 — 방어 겹이거나 불변식상 도달 불가): 가중치 클램프(MU04, 흐름 시각은 [기준, 스냅샷] 안), 총자산 내림(MU09, bigint)·원화 환산 내림(MU11, 정수 원), FOR UPDATE 제거(MT07, 조건부 UPDATE·UNIQUE 가 같은 결과), 이미 표시한 후보 재표시(MX08, 안쪽 `updateMarks` 가 같은 409), 정정 사전 취소 확인 삭제(MX11, 트랜잭션이 같은 409), 후보 키 인코딩 제거(MB03, 키에 특수문자 없음). **진짜 시험 구멍 11개**: MU02 환율 4자리 반올림→내림(2자리 환율 100,001개 중 5,230개에서 값이 달라지는데 시험 환율이 우연히 안전한 값), MU08 반영 대기 금액의 부호(`pending.krw` 부호 미단언), MS06 스냅샷 환율 0/음수 허용(운영에서는 크론이 `rate>0` 으로 막아 도달 불가지만 시험 없음), MM10 `firstAfter` 의 `>=`→`>`(같은 시각 스냅샷 앵커가 흐름 시험 G 에서만 간접 확인), MM13 환전의 같은 시각 앵커, MM08 스캔 시작 경계, MX06 `beforeBaseline` 경계, MX05 경로 id `0`·선행 0 허용(무해), MU06 마지막 기록 동률 규칙(표시만), **MX10 정정 멱등의 대상 id 확인 삭제**(같은 clientEntryId 로 다른 기록을 정정해도 성공으로 돌려줌 — 시험 없음), **MH05 restore 라우트가 경로 id 를 무시하고 '1' 을 써도 통과**(라우트 시험이 id 1 만 씀 — 연결 배선 시험 구멍). 요청하신 종류는 모두 포착됐다: 부호 반전·`<`↔`<=` 경계(MV05·MV01·MU10·MM01·MM03·MM12)·허용치 0(MR01·MR02·MR06)·소비 키 무시(MM04·MM05·MM11)·기준 이전 차단 제거(MX03·MV05)·정정 UNIQUE 우회(DD01·MT05)·낙관적 잠금 무시(MT02·MX01)·`not_migrated` 가 모든 오류를 삼킴(MH01)·인증 제거(MH02)·DDL 변이 18종(CHECK NULL 구멍 복원 DD05 포함). DDL 쪽 변이는 `T074_TEST_DB_PORT` 를 준 실행에서만 잡힌다(발견 L6).
- [12:57] 항목 7 화면(WP-B) 코드 감사: ① XSS [확실]: 사용자 입력(메모·사유·서버 문장)은 전부 JSX 텍스트로만 렌더된다 — `dangerouslySetInnerHTML` 은 `LedgerStyles`·`Sheet` 의 **고정 CSS 상수** 두 곳뿐(보간 0, 규칙 215개 전부 `.lg`/`.sheet-root`/`.sh-` 범위라 전역 누출 없음 — 스크립트로 확인). `<img onerror>` 메모는 서버·화면 검증이 문자열로 통과시키되 React 가 이스케이프한다. ② 이중 제출: `createSubmitter`(진행 중 두 번째 호출은 요청 안 함) + 저장 중 버튼 비활성 + 서버 멱등키의 3중 — 변이(MB01)·시험이 잡음. 후보 되돌리기는 `busyCand`. ③ 서버 응답 불일치: `classifyWrite` 가 200+`ok:false`·409 세부 코드·422·404·네트워크·15초 시간 초과를 가르고(MB02 포착) 시트는 입력을 유지한 채 오류 상자를 낸다. **그러나 `replayed:true` 응답을 화면이 전혀 쓰지 않는다**(`replayed` 참조 0건) — 서버 쪽 발견 M1 과 맞물린다. ④ 붙여넣기 파서: 위 항목 1-③. 화면이 쓰는 `parseAmount` 는 서버와 같은 함수라 두 곳이 어긋나지 않는다(L1 의 쉼표 문제도 양쪽 동일). ⑤ 취소·정정·되살리기·입출금 아님은 전부 확인 시트(사유 필수·손익 전→후 미리보기)를 거치고 삭제 버튼은 없다. 정정 초안은 `String(e.amount)` 로 채우는데 DB 값이 DECIMAL 에서 온 수라 지수 표기 위험이 없다(상한 $10억·1조원). 디자인 판단은 하지 않았다.
- [12:57] 항목 8 범위·훅 [확실]: 변경은 신규 파일 + 기존 파일 2개뿐 — `src/app/settings/SettingsPage.tsx`(+5줄: import 1, 빈 줄 1, 주석 1, '자산 기록' 섹션 헤더 1, `<CashLedgerSummaryRow />` 1 — 기존 항목·순서·조회·저장 무변경을 diff 로 확인), `docs/screens.md`(+17/−1). `src/lib/db.ts`·`src/middleware.ts`·`lib/safety`·`lib/signals`·`jest.config.js`·`package.json` 은 T-074 가 건드리지 않았다(작업 트리의 `jest.config.js`·`package.json`·`api-usage` 변경은 타 세션 T-040). 마이그레이션은 `setupDB` 에 들어가지 않았다(정적 시험 고정). `SAFETY_PATHS`(`awk` 목록)에 걸리는 T-074 파일은 **`scripts/migrations/T-074-cash-flow-ledger.sql` 하나**(`^scripts/migrations/`) — 커밋 때 판정 scope 에 반드시 들어 있어야 하고 아래 마지막 줄에 넣었다. `src/lib/ledger/`·`src/app/api/cash-ledger/`·`src/components/**`·`src/app/settings/**` 는 대상이 아니다. `docs/db-schema.md` 에는 `cash_flow_ledger` 표와 `system_config` 두 키(`cash_ledger_baseline`·`cash_ledger_candidate_marks`)가 아직 적혀 있지 않다(발견 L5).
- [12:57] 발견 M1 [심각도: 중간] `src/lib/ledger/service.ts:332-333`(기록 추가), `:372-376`(정정) — 같은 `clientEntryId` 로 **내용이 다른** 요청이 다시 오면 서버가 내용을 비교하지 않고 처음 저장된 기록을 `200 replayed:true` 로 돌려주고, 화면은 `replayed` 를 쓰지 않아 '기록했습니다 (#id)' 로 보인다. 폼의 `cid` 는 시트를 열 때 한 번 만들어 실패 뒤 수정해도 그대로다(`entry-draft.ts:7,38`, `EntrySheet.tsx:186-202`). 재현: 입금 1,000,000 저장 요청이 15초 시간 초과(서버는 이미 저장) → 화면 '실패, 입력 유지, 다시 눌러도 두 번 기록되지 않음' → 사용자가 금액을 100,000 으로 고쳐 다시 저장 → 200 `replayed:true`, 저장된 금액 1,000,000 그대로(`routes.test.ts:317-330` 이 금액 9 로 바꿔 보내도 1,000,000 이 돌아오는 것을 오히려 고정해 둠). 영향: 사용자가 입출금 뺀 손익의 금액을 잘못 믿게 된다(목록을 보면 드러나지만 토스트는 금액을 말하지 않음). 권고(하나 이상): ㉮ 서버가 기존 행의 정규화 값(종류·통화·금액·발생 시각·환전 counter·메모)과 요청을 비교해 다르면 409 `idempotency_mismatch`(새 `cid` 로 다시 보내라)로 답하고 시험 추가, ㉯ 화면이 실패 뒤 초안이 바뀌면 `cid` 를 새로 만들되 '시간 초과 직후 같은 내용 재시도'는 유지하도록 마지막 시도 본문과 비교, ㉰ 최소한 `replayed:true` 일 때 토스트에 저장된 금액을 보여 준다. 조건부 통과의 조건 1.
- [12:57] 발견 L8 [심각도: 낮음] `src/lib/ledger/handlers.ts:23`, `store.ts:113-116` — `isNoTable` 이 표 이름을 보지 않아 `portfolio_snapshots`·`system_config`·`accounts` 의 1146 도 503 `not_migrated`('원장 테이블이 아직 없습니다 … 기록이 없어진 것이 아닙니다')로 나가고, 화면은 중립 '준비 중'으로 오류·다시 시도를 숨긴다. 재현(실행): `Table 'x.portfolio_snapshots' doesn't exist` 오류를 `errorResponse` 에 넣으면 503 `not_migrated`. DDL 적용 뒤 '준비 중'이 다시 보이면 표 유실 같은 장애를 가리는 셈(designer 델타 점검 3절도 같은 우려). 권고: 메시지에 `cash_flow_ledger` 가 있을 때만 변환(한 줄) + 다른 표 1146 은 500 으로 두는 시험 1건. 조건부 통과의 조건 2(값싼 수정이라 배포 전 권장).
- [12:57] 발견 L1 [심각도: 낮음] `src/lib/ledger/validate.ts:37` — 쉼표를 자리 검증 없이 모두 지운다. 재현: USD `118,60`→11,860 · `1,5`→15 · `1,00,0`(원)→1000 · `12,34.56`→1234.56. 확인 단계가 '$11,860.00' 등으로 다시 보이고 총자산의 50% 이상이면 큰 금액 경고가 뜨지만 15 같은 값은 경고가 없다. 권고: 쉼표는 `^\d{1,3}(,\d{3})+(\.\d+)?$` 모양일 때만 허용하고 나머지는 format 오류('숫자만 넣어 주세요').
- [12:57] 발견 L2 [심각도: 낮음] `src/lib/ledger/handlers.ts:31` — 500 응답이 원문 오류를 그대로 싣는다(재현: `connect ECONNREFUSED 192.168.219.100:3306`, SQL 구문 오류 조각). 로그인한 회원에게만 보이고 다른 라우트 114곳도 같은 관행이라 이 task 의 신규 위험은 아니다. 권고: 응답은 일반 문장 + `code`, 원문은 이미 있는 `console.error` 로만.
- [12:57] 발견 L3 [심각도: 낮음] `src/lib/ledger/rules.ts:71`, `handlers.ts:44-48` — 원장·기준이 회원별이 아니라 계좌 1 전역이다(항목 3-⑤). 초대 코드 설정이 켜져 있어(`.env` 에 키 존재 여부만 확인, 값 미출력) 가입에는 코드가 필요하지만, 회원이 2명 이상이 되면 누구나 같은 원장을 바꿀 수 있다. 권고: 설계 전제(회원 1명)를 task 에 한 줄 남기고, 회원이 늘면 쓰기 API 를 소유자 한정으로 좁히는 후속 항목으로.
- [12:57] 발견 L4 [심각도: 낮음] `src/lib/ledger/match.ts:71-78,104-131` — 매칭이 `holdingsSame` 을 보지 않아 주식 매도로 현금이 입금액과 비슷하게 늘어도(탐침: 보유가 바뀐 단계 +1,000,000) 입금 기록이 '반영됨 ✓'으로 확인된다. 손익 P 는 반영됨·불일치를 똑같이 순입금에 넣으므로 숫자는 안 틀리지만 '스냅샷과 맞아 반영' 문구가 거짓 안심이 될 수 있다. 권고: 보유가 바뀐 단계의 일치는 반영됨 대신 불일치(근거 문장에 '매매가 같은 단계에 있음')로 낮추거나 문장에 명시.
- [12:57] 발견 L5 [심각도: 낮음] `docs/db-schema.md` — `cash_flow_ledger` 표와 `system_config` 두 키가 문서에 없다(개발자도 쓰기 허용 밖이라 미작성으로 보고). 배포 전 Leader 지시로 추가.
- [12:57] 발견 L6 [심각도: 낮음] 시험 인프라 — 실제 DB 시험 24건(CHECK·UNIQUE·동시성·낙관적 잠금)은 `T074_TEST_DB_PORT` 가 없으면 건너뛴다. 기본 `npm test`(5,791 통과/41 건너뜀)에는 DDL 회귀망이 없다. DDL 변이 18종은 환경을 켠 실행에서만 포착됐다. 권고: 배포 절차에 '마이그레이션 변경 시 일회용 DB 시험 필수'를 한 줄 적고, 가능하면 한 줄 스크립트(별도 변경).
- [12:57] 발견 L7 [심각도: 낮음] `src/app/settings/CashLedgerSummaryRow.tsx:56-60` · `src/lib/ledger/service.ts:148-211` — 설정 화면을 열 때마다 `GET /api/cash-ledger` 가 최대 120일치 스냅샷을 읽고 파싱하며, 바뀐 반영 상태가 있으면 UPDATE 한다(조회 = 쓰기 동반). 지금은 수천 행 미만이라 문제없지만 기간이 늘수록 설정 첫 화면 부담이 커진다. 권고: 요약 행 전용 가벼운 응답 또는 서버 캐시(T-073 때), 매칭 저장은 쓰기 경로에서만.
- [12:57] 판정 근거 요약: 치명 0 · 높음 0 · 중간 1(M1) · 낮음 8(L1~L8). 안전장치·주문·시그널 경로 영향 0(항목 4), 돈 계산은 회계 정본·정수 산술·경계값 직접 실행 모두 일치(항목 1), DDL 은 10.11 에서 24/24 + 별도 탐침 통과(항목 2), 인증·입력 검증·동시성은 이상 없음(항목 3). 변이 포착 79/97(등가 7 제외 79/90) — 남은 11개 구멍 중 돈과 연결된 것은 MU08·MX10·MU02 이며 코드가 아니라 시험이 비어 있는 것이다.
- [12:57] 조건부 통과의 조건: ① (배포 전) M1 을 고치거나 사용자에게 위험을 설명해 명시적으로 수용 — 고치면 시험 1건(내용이 다른 재전송 → 409 또는 새 `cid`)을 함께 추가하고, 서비스 코드를 바꾸게 되므로 Reviewer 델타 재검증(마이그레이션 SQL 이 바뀌지 않으면 훅 scope 는 그대로). ② (배포 전, 한 줄) L8 을 표 이름으로 좁힘. ③ (권고) L1 쉼표 규칙·L4 문장·L5 문서·MX10/MH05/MU08 시험 3건 보강, `usd-cash-balance-fence` 처리는 항목 5의 (c) 로 Leader 가 따로 지시. 운영 DDL 적용은 사용자 명시 승인 뒤 오프아워(이미 Leader 확정 사항)이며, 이 감사는 적용 전 코드·DDL 에 대한 것이다.
- [12:57] QA 에 넘기는 high_risk_areas: (1) 실제 갤럭시 크롬에서 하단 시트 안 입력 칸이 가상 키보드에 가려지는지·TalkBack 낭독(개발자·designer 모두 못 본 것) (2) M1 재현 — 응답을 일부러 늦춰 15초 시간 초과 뒤 금액을 고쳐 재전송 (3) DDL 적용 후 첫 조회에서 `GET /api/cash-ledger` 가 기준 없음 상태로 200 인지, 설정 행이 '준비 중'에서 '손익 기준이 아직 없습니다'로 바뀌는지 (4) 기준 정하기에서 달러 현금 칸에 '외화예수금'과 '주문가능'을 구분해 넣을 때 기준 총자산이 의도대로 바뀌는지(분석가 Q5 미확정) (5) 같은 분·같은 금액 두 번째 기록의 409 문구와 취소→재입력→취소 흐름 (6) 설정 화면 진입 후 안전장치 저장 동작이 그대로인지(행이 오류여도 저장 바·스위치 영향 0).
- [12:57] 확인하지 못한 것: 운영 MariaDB 10.11.11 자체(이미지는 10.11.19), 실제 갤럭시 기기·스크린리더, 마이그레이션 적용 뒤 운영 실데이터 화면, 실계좌 값 기반 검증(요청대로 합성값만 사용), 외화예수금 문구의 적합성(사용자 Q5 답 대기). 이 감사는 디자인 취향을 판단하지 않았다.
- [12:57] **최종 판정: CONDITIONAL_PASS (scope: scripts/migrations/T-074-cash-flow-ledger.sql, src/lib/ledger/, src/app/api/cash-ledger/, src/components/ledger/, src/components/ui/Sheet.tsx, src/components/ui/__tests__/, src/app/settings/cash-ledger/, src/app/settings/CashLedgerSummaryRow.tsx, src/app/settings/SettingsPage.tsx, src/app/settings/__tests__/settings-cash-ledger-row.test.ts, docs/screens.md, docs/db-schema.md)**
- [13:26] 델타 재검증(Stage 5) 범위·방법: 기준선은 감사 시점 작업 트리 사본(`scratchpad/t074-rev-main`)이고 지금 작업 트리와의 차이가 Stage 5 변경이다. 차이 파일은 Developer 보고와 정확히 일치한다(보고에 없는 파일 0) — `src/lib/ledger/{service,types,store,handlers,validate,match,rules,snapshots}.ts`, `src/lib/__tests__/usd-cash-balance-fence.test.ts`, `src/components/ledger/{actions.ts,EntrySheet.tsx}`, `src/app/settings/cash-ledger/CashLedgerPage.tsx`, `docs/db-schema.md`, 신규 `stage5-reviewer.test.ts`, 수정된 기존 시험 6개(routes·cash-ledger-page·actions·ledger-render·store-parse·validate). **마이그레이션 SQL sha256 `ab17ad46d6a5…` 가 감사 때와 같음을 직접 대조**했고, `compute.ts`·`candidates.ts`·`kst.ts`·`korean-amount.ts`·`view.ts`·`Sheet.tsx`·`CashLedgerSummaryRow.tsx`·`SettingsPage.tsx`·`middleware.ts`·`db.ts` 도 바이트 동일하다. 새 사본: `t074-rev2-head`(`git archive HEAD` + T-074 파일 67개, sha 대조 bad=0), 변이는 그 복사본 `t074-rev2-mut` 에서만 적용하고 끝난 뒤 131개 파일을 원본과 sha256 대조해 전부 같음을 확인했다. 앱·시험·빌드는 `block-external-net.cjs` 사전 로드, 운영/공유 DB 접근 0, `$P/src` 수정 0, git 쓰기 0, `.env` 값 출력 0. 이번에는 이미지를 새로 받지 않았다(`mariadb:10.11` 은 이미 로컬에 있음).
- [13:26] 독립 재현(항목 6-i) [확실]: 앱 `tsc` 0 오류 · 시험 포함 타입 검사(18파일) 0 오류 · jest 전체 235 스위트 통과 + 2 건너뜀, 5,834 통과 / 41 건너뜀 / 5,875 — Developer 수치와 같다. 원장·라우트·화면·UI·설정 + 울타리 2종 20 스위트 504 통과(`mariadb:10.11.19` 일회용 컨테이너, 서버 기본 utf8mb3·운영 sql_mode, 127.0.0.1:33081 전용, 실제 DB 시험 24건 포함), `TZ=America/New_York`·`Asia/Tokyo` 에서도 473 통과 / 24 건너뜀(DB 제외). `next build` exit 0 — `/settings/cash-ledger` 22.9 kB, `/api/cash-ledger*` 9개 ƒ. 작업이 끝난 뒤 컨테이너 제거·포트 33081/3977 닫힘 확인.
- [13:26] 항목 1 M1 수정 정확성 [확실, 실제 10.11 DB 서비스 직접 호출 + 실제 브라우저]: ① 정상 재시도는 안 깨졌다 — 같은 clientEntryId 에 같은 내용이면 금액 `1000000`·`1,000,000`·` 1000000 `·숫자 1000000, 메모 ` 월급 `·`\t월급\n`(trim), 시각 `2026-09-03T10:00`·`… 10:00:00`, 다른 `fromCandidateKey`·모르는 필드·다른 `baseVersion` 모두 `200 replayed:true`. 저장된 메모가 없을 때 `undefined`·`null`·`''`·`'  '` 도 모두 replay. USD `118.6`·`118.60`·숫자 118.6 replay, 환전은 받은 금액 `1,000.00`·숫자 1000 replay(JSON 필드 순서는 무관). ② 거짓 일치 없음 — 종류·통화·금액(±1원, ±1센트 `118.61`/`118.59`)·시각(±1분·±1일)·메모(변경·삭제·추가·공백만)·환전 받은 금액(±0.01)·환전 방향 바꿈·환전을 입금으로 바꿈 중 하나만 달라도 `409 client_entry_conflict{existingId, data}`, DB 쓰기 0. 입출금 요청에 환전 상대 필드가 붙은 경우는 기존 검증과 같이 무시되어 replay(거짓 충돌 아님). ③ 정정 — 같은 키·같은 대상·같은 내용(사유만 다름 포함) replay, 금액 변경·다른 대상에 같은 키·정정 키로 새 기록 추가·추가 키로 정정 → 전부 409. ④ 경합(실제 UNIQUE): 같은 키·같은 내용 16개 동시 → 신규 1 + replay 15, 행 1개. 같은 키에 내용 2종 16개 동시 → 신규 1 + 같은 내용 replay 7 + 409 8, 행 1개. 정정 같은 키 8개 동시 → 성공 1 + `409 already_voided` 7, 행 1개 — 동시 정정은 사전 확인보다 원본 행 잠금·취소 확인이 먼저 걸려 replay 대신 already_voided 가 나간다(이중 기록은 없음, 기존 동작이며 발견 D3). ⑤ 화면 흐름(브라우저 격리 서버 + 일회용 DB, 412px, 외부 요청 차단 0): 입금 1,000,000 저장 요청의 응답만 끊어(서버는 저장) 화면이 실패 상자를 내게 한 뒤 '‹ 고치기'로 금액을 100,000 으로 고쳐 다시 저장 → 서버 409 → **시트가 닫히고** 토스트 "방금 보낸 기록이 이미 저장되어 있습니다. 목록에서 확인하고 필요하면 정정해 주세요", 목록에 **1,000,000원 기록이 펼쳐진 채 그 행으로 포커스**(`lg-eh-1`), 고친 값 100,000 은 목록에 없고 DB 행 1개. 이어서 '+ 입출금 기록 추가'를 다시 열면 초안 복원 문구 없이 빈 금액, 새 기록은 **새 cid** 로 정상 저장(`기록했습니다 (#2)`). 같은 내용 재시도(응답 끊김 뒤 '다시 기록하기')는 같은 cid → 200 replay, 토스트 '기록했습니다 (#3)', 행 추가 1개뿐. 요청 본문의 cid 5개를 대조: 충돌 쌍과 재시도 쌍은 각각 같은 cid, 서로 다른 시도는 모두 다른 cid. **같은 cid 로 이중 기록되는 경로는 남지 않았다**(코드 추적: `onStale` 이 `lastDraft.current = null` 로 초안을 버리고 시트를 닫으며, 다시 여는 폼은 `newDraft` 의 새 cid; 서버 UNIQUE 가 마지막 방어).
- [13:26] 항목 2 L8: 1146 이면서 `sqlMessage ?? message` 에 `cash_flow_ledger` 가 있을 때만 `not_migrated`. 실행 결과: `Table 'db.cash_flow_ledger' doesn't exist`·접두 없는 `Table 'cash_flow_ledger'…`·`sqlMessage` 만 있는 오류·`errno` 만 있는 오류 → 503, `portfolio_snapshots`·`system_config`·`accounts` → 500(`server_error`), 코드가 다른 오류·null·문자열 오류 → 변환 안 함. 실제 DB 의 표 없음 시험(A-1)도 통과. 한계(발견 D1): 대소문자를 구분해 `CASH_FLOW_LEDGER` 는 변환 안 함(우리 쿼리는 소문자라 문제없음), 반대로 단순 부분 문자열이라 DB 이름에 `cash_flow_ledger` 가 들어 있거나(`'cash_flow_ledger_db.portfolio_snapshots'`) 표 이름이 `cash_flow_ledger_old` 면 변환된다 — 비현실적 이름이지만 `Table '<db>.<표>'` 의 표 이름만 비교하면 닫힌다.
- [13:26] 항목 3 L1 쉼표: 기록 금액·기준 현금 모두 동일 규칙. 허용: `1,000,000`(원)=1000000, `100`, `0.01`·`1000.50`·`1,234.5`·`1,234.50`(달러), 공백 포함 `1 000 000`·` 1 000 `·`1, 000`·`1,000 `(공백 제거 뒤 판정), 상한 값(`999,999,999,999`원·`1,000,000,000.00`달러). 거절(format): `118,60`·`1,5`·`1,00,0`·`12,34.56`·`1,0000`·`1,000,00`·`,100`·`100,`·`1,,000`·`,`·` , `·`1,000.`·전각 숫자·전각 쉼표 `１，０００`·`100만`·`1e5`·`.5`·`5.`. 부호는 쉼표보다 먼저(`-1,000`·`−1,000` → sign), `1,000.5`(원)·`1,000.123`(달러)는 소수 규칙(decimals), 상한 초과 max. 부호·0·소수 규칙은 이전과 같다. 한계(발견 D5): 첫 묶음 앞 0 을 허용해 `01,000`=1000, `0,001`=1 로 읽는다(해롭지 않은 이상 입력).
- [13:26] 항목 4 L2·L4: ① L2: 연결 거부(`192.168…:3306`)·SQL 구문 오류 조각·중복 키 메시지·Error 아닌 값·`sql` 속성이 붙은 오류 모두 500 응답은 일반 문장 + `code` + `retrySafe` 뿐이고, 같은 원문이 `console.error` 에는 그대로 남는다. 직접 만든 `LedgerDataError`(손상 기준 복구 안내, 값 없이 열 이름·키 이름만 있음)만 문장을 유지. 부작용: 일반 `Error` 로 던지던 친절한 문장(예: 후보 표시 경합 '잠시 뒤 다시 시도하세요')도 이제 일반 문장이 된다 — 의도된 보수적 선택. ② L4: `compute.ts` 는 바이트 동일, `match.ts` 는 삭제된 줄이 `detail` 한 줄뿐(문장 끝에 `tradeNote` 추가)이고 `status`·`snapshotId`·`fxRateUsed`·`krwEquiv`·소비 키·`suggest` 는 그대로다. 변이로 확인: 매매 단계 일치를 반영됨에서 빼는 변이(R31)·문장 조건 반전(R32)을 시험이 잡는다. 따라서 손익 P 와 상태 분류는 바뀌지 않았다 [확실].
- [13:26] 항목 5 `isUsd()`·울타리 (c): ① 울타리 시험 변경은 `ALLOWED` 에 두 줄뿐 — `'lib/ledger/rules.ts': 1`(원장 통화 판별 단일 함수 `isUsd`, 이제 `currency === 'USD'` 단순 비교)·`'lib/ledger/snapshots.ts': 1`(크론이 기록한 스냅샷 positions 의 USD 행 판독, `p.currency === 'USD'`) — 사유는 타당하고 `kill-switch.ts` 항목과 같은 성격이다. 정규식 회피 형태(조회표·`cur` 별칭)는 원장에서 걷혔다(원장의 `=== 'USD'` 는 `rules.ts:66`·`snapshots.ts:72` 두 곳뿐, `validate.ts:67` 의 `isCurrency` 는 형식 검사). ② 의도 약화 여부를 직접 변이 8개로 확인: 안전 경로 `lib/safety/dry-run.ts` 에 잔고 배열 USD 선택 추가, 허용된 `strategy/engine.ts`·`ledger/rules.ts`·`safety/kill-switch.ts` 에 두 번째 비교, 거래소 `exchanges/kis.ts`, 허용 목록 밖 `ledger/service.ts`, `api/balances/route.ts`(`'USD' == b.currency`) → **7개 모두 울타리 시험 실패**, `isUsd` 를 `!== 'KRW'` 로 바꾸면(개수 0) 실패 — 새 지점은 여전히 막힌다. ③ 이 파일이 `SAFETY_PATHS` 에 걸리는지 `awk` 목록으로 대조: 변경 파일 14개 중 걸리는 것은 `scripts/migrations/T-074-cash-flow-ledger.sql`(`^scripts/migrations/`) 하나이고 울타리 시험은 **걸리지 않는다**(Developer 보고와 같음). 안전 회귀망을 바꾸는 변경이라 훅이 강제하지 않으므로 이 델타의 scope 에 명시했다. ④ 기존 한계(이번 변경과 무관, 발견 D6): 별칭 변수(`const cur = b.currency; cur === 'USD'`)는 이 울타리 정규식이 못 본다(변이 8번째로 확인, 통과) — 원장이 스스로 그 형태를 걷어낸 것이지 울타리가 강해진 것은 아니다.
- [13:26] 항목 6-ii 독립 변이(델타): 내가 새로 고안한 34개(M1 비교 필드별 삭제·±1분 허용·금액을 원 단위로만 비교·메모 정규화 삭제·409 분기 제거·UNIQUE 경합 두 경로·충돌 응답 상태/필드 삭제, 화면 초안 유지·stale 무시·`client_entry_conflict` 를 duplicate 취급·폼마다 같은 cid, L8 조건 제거·느슨화, L1 정규식 3종·부호 순서, L2 원문 되살리기 3종·로그 삭제, L4 2종, `isUsd`·스냅샷 판독 2종) + 이전 생존 11개를 새 코드에 다시 적용(10개는 원문 그대로, 정정 멱등 대상 확인 MX10 은 코드가 바뀌어 같은 효과의 R01·R18 로) = 44개 적용, **38개 포착 / 6개 생존**. 이전 생존 11개는 전부 포착 [확실]. 생존 6개: R08(환전 받은 통화 비교 삭제 — 환전은 낸 통화가 정해지면 받은 통화도 정해져 등가), R34(스냅샷 판독에 다른 통화 추가 — 울타리는 정확히 'USD' 만 센다, 비현실적 변이), **시험 구멍 4개**: R07(달러 금액을 원 단위로만 비교 → 달러 센트 차이 충돌 시험 없음; 실제 코드는 센트 비교임을 탐침 `118.61`/`118.59` 로 확인), R13·R14(사전 확인을 지나친 뒤 UNIQUE 로 걸리는 경합 경로가 비교 없이 replay 해도 통과; 실제 코드는 위 ④ 경합 탐침에서 409/replay 를 바르게 나눔), R25(첫 묶음 자릿수 제한 제거 → `1234,567` 허용을 시험이 안 봄). 모두 코드가 아니라 시험이 비어 있는 곳이다. 변이는 원본 sha256 대조로 매번 복원 확인.
- [13:26] 항목 7 `docs/db-schema.md`: 마이그레이션 SQL 과 대조해 일치 [확실] — 컬럼 25개(쌍으로 묶은 표기 포함)·타입·NOT NULL·기본값, CHECK 5개 이름·내용(환전 `IS NOT NULL` 포함), UNIQUE 3개(`uq_cfl_client_entry`·`uq_cfl_live_dup` 열 구성·`uq_cfl_supersedes`), 인덱스 2개, FK 2개, 콜레이션 명시, 롤백(표 삭제 + 키 2개 삭제), "부팅 DDL 아님·사용자 승인 후 오프아워 수동 적용·멱등·10.2+" 문구, 마이그레이션 변경 시 일회용 DB 시험 필수 한 줄이 모두 맞다. `system_config` 키 2개(`cash_ledger_baseline`: version·updatedAt·baselineAt·snapshotId·snapshot·confirmed·baselineTotalKrw·history 최근 20 / `cash_ledger_candidate_marks`: version·marks 최대 1,000·log 최대 200, 낙관적 잠금 + 재시도 3회)도 `store.ts` 와 일치. `docs/screens.md` 는 이번에 바뀌지 않았다(stale 토스트 흐름 미반영, 발견 D4).
- [13:26] 항목 8 새 위험·회귀: ① 타입 변경(`LedgerErrorCode`·`WriteOutcome` 에 `clientConflict`·`EntryDecision` 에 `stale`·`EntrySheetProps.onStale` 필수)으로 인한 호출부 불일치는 tsc 0 오류·시험 통과로 없음. ② `classifyWrite` 의 새 분기는 `duplicate` 보다 먼저 판정해 기존 중복 409 문구와 섞이지 않고, 정정에서 옛 `409 duplicate`('이 저장 키로 이미 다른 기록…')였던 경로가 `client_entry_conflict` 로 통일됐지만 화면은 둘 다 처리한다. ③ 기준 버전 충돌 뒤 '새 기준으로 기록하기'는 같은 cid·같은 내용이라 replay 또는 신규 저장 — 이중 기록 없음. ④ 오류 문구가 일반 문장으로 바뀐 것은 화면 분기에 쓰이지 않는다(조회 실패 문구 "서버 응답 500 — …"에만 붙음). ⑤ 이번 변경이 새로 연 쓰기 대상·외부 호출·안전 경로 import 는 없다(`service.ts` 가 추가로 가져온 것은 같은 모듈 안의 `sameAmount`·`isEntryKind`·`isCurrency`·`parseAmount`·`parseKstMinute`).
- [13:26] 발견 D1 [심각도: 낮음] `src/lib/ledger/store.ts:113-120` — `isNoTable` 이 표 이름을 정확히 파싱하지 않고 부분 문자열로 비교한다(대소문자 구분, DB 이름·`cash_flow_ledger_old` 같은 이름이 걸림). 비현실적이라 차단 사유 아님. 권고: `/Table '(?:[^'.]+\.)?cash_flow_ledger' doesn't exist/` 로 좁히고 시험 1건.
- [13:26] 발견 D2 [심각도: 낮음] 시험 구멍 4건 — R07 달러 센트 단위 충돌(`118.61` vs `118.60`), R13·R14 UNIQUE 경합 경로의 비교(사전 확인 이후 걸리는 경로), R25 첫 묶음 자릿수(`1234,567`). 권고: 라우트 시험 3건 추가(가짜 DB 에서 사전 확인 이후 중복 키를 강제하는 방식 포함).
- [13:26] 발견 D3 [심각도: 낮음] `src/lib/ledger/service.ts` 정정 경로 — 같은 cid·같은 내용 정정 요청이 동시에 오면 둘째는 replay 가 아니라 `409 already_voided`('다른 기기에서 먼저 정정됐습니다')를 받는다(이중 기록은 없음). 응답이 끊긴 직후 재시도가 첫 요청 처리 중에 겹치는 드문 순간에만 생긴다(Stage 5 이전부터의 동작). 권고: 정정에서 `already_voided` 를 돌려주기 전에 같은 cid 의 행이 있는지 한 번 더 보고 있으면 `replayOrConflict`.
- [13:26] 발견 D4 [심각도: 낮음] 충돌 토스트 문구·문서 — 토스트가 "처음 보낸 내용으로 저장돼 있고 방금 고친 값은 저장되지 않았습니다"를 말하지 않아 고친 값이 저장됐다고 오해할 수 있다(초안은 버려지고 목록에는 옛 금액만 보임). `docs/screens.md` 에도 이 흐름(409 → 시트 닫힘·저장된 행 펼침)이 없다. 권고: 문구 한 줄 보강(designer 확인)과 screens.md 한 줄 추가.
- [13:26] 발견 D5 [심각도: 낮음] `src/lib/ledger/validate.ts:41` — 첫 묶음 앞 0 허용(`01,000`=1000, `0,001`=1). 권고: 첫 묶음은 `[1-9]\d{0,2}|0` 로.
- [13:26] 발견 D6 [심각도: 낮음] `src/lib/__tests__/usd-cash-balance-fence.test.ts` — 정규식이 `currency` 라는 이름에 의존해 별칭 변수 비교를 못 본다(이번 변경 이전부터). 권고: Leader 지시로 `\b(\w+)\b\s*===\s*'USD'` 류까지 세는 보강을 별도 task 로 검토(허용 목록과 개수 재측정 필요).
- [13:26] 판정 근거 요약: 치명 0 · 높음 0 · 중간 0 · 낮음 6(D1~D6, 이전 낮음 중 L1·L2·L4·L5·L8 은 수정·반영 확인, L3·L6·L7 은 Leader 기록대로 코드 변경 없음). 이전 조건 ①(M1)은 서버·화면·실제 DB 경합·실제 브라우저로 해소를 확인했고 조건 ②(L8)는 해소(경미한 한계 D1)됐다. 손익 P·상태 분류·마이그레이션은 변하지 않았고 울타리는 약해지지 않았다. 따라서 조건부 통과를 통과로 올린다 — 위 낮음 항목은 배포를 막지 않는 권고다.
- [13:26] QA 에 넘기는 high_risk_areas(갱신): (1) 실제 갤럭시 크롬에서 응답을 늦춰 15초 시간 초과를 만든 뒤 금액을 고쳐 재전송 — 시트 닫힘·토스트·저장된 행 펼침·포커스 확인(브라우저 격리 서버에서는 응답 끊김으로 재현) (2) 하단 시트 입력 칸이 가상 키보드에 가려지는지·TalkBack 낭독(여전히 미확인) (3) DDL 적용 직후 첫 조회의 기준 없음 상태와 설정 행 문구 (4) 달러 기준 현금 입력에서 '외화예수금'과 '주문가능'(Q5) (5) 쉼표 입력 `1,000,000`·`1,234.50` 정상, `118,60` 거절 문구 (6) 설정 화면 진입 후 안전장치 저장 동작 불변.
- [13:26] 확인하지 못한 것: 운영 MariaDB 10.11.11 자체(이미지는 10.11.19), 실제 갤럭시 기기·스크린리더·가상 키보드, 마이그레이션 적용 뒤 운영 실데이터 화면, 15초 시간 초과 자체(브라우저 검증은 응답을 끊는 방식으로 대신함), 실계좌 값 기반 검증(합성값만).
- [13:26] **최종 판정: PASS (scope: scripts/migrations/T-074-cash-flow-ledger.sql, src/lib/ledger/, src/app/api/cash-ledger/, src/components/ledger/, src/components/ui/Sheet.tsx, src/components/ui/__tests__/, src/app/settings/cash-ledger/, src/app/settings/CashLedgerSummaryRow.tsx, src/app/settings/SettingsPage.tsx, src/app/settings/__tests__/settings-cash-ledger-row.test.ts, src/lib/__tests__/usd-cash-balance-fence.test.ts, docs/screens.md, docs/db-schema.md)**
- [13:31] Codex C2 지적 2건 판정(읽기 전용, 코드 수정 0) — task 파일 `## Codex 검토` 절과 코드를 대조하고 이번 세션에서 이미 실행한 재현 결과(실제 10.11 DB 서비스 호출·오류 응답 탐침)를 근거로 썼다.
- [13:31] 지적 1 `service.ts:422`(정정 동시 요청의 `already_voided`): **채택 — 내 델타 감사 발견 D3 와 같은 건**(같은 줄, 같은 경로). 재현(실제 MariaDB 10.11.19, 서비스 직접 호출): 같은 cid·같은 대상·같은 내용의 정정 8개 동시 → 성공 1 + `409 already_voided` 7, 원장 행 추가 1개(이중 기록·금액 유실 없음). 원인: `correctEntryTx` 가 원본 행 잠금 뒤 취소 여부를 먼저 보고 `dup_client` 에 닿기 전에 끝난다. 같은 경합이 기록 추가 쪽은 정상 — 같은 cid 16개 동시 → 신규 1 + replay 15. 영향은 응답 문구뿐이다(화면은 '먼저 정정됐습니다'와 함께 최신 목록을 불러오고 저장된 정정이 보임). 발생 조건이 좁다 — 화면은 한 번에 하나만 전송(`createSubmitter`)하므로 같은 cid 두 요청이 겹치려면 15초 시간 초과 재시도가 첫 요청 처리 중에 겹쳐야 한다. 돈 계산·중복 기록·권한 영향 0 → **후속 허용(배포 전 필수 아님)**. 수정안은 Codex 권고 그대로: `already_voided` 응답 전에 `findByClientEntryId` 로 같은 cid 행을 재조회해 있으면 `replayOrConflict(existing, body, id, now)`, 시험은 가짜 DB 에서 원본이 막 취소된 직후 같은 cid 행이 있는 상황.
- [13:31] 지적 2 `handlers.ts:52`(`LedgerDataError` 문장 노출): **부분 채택 — 내가 L2 델타에서 의도적으로 남긴 예외이며 L2 와 같은 `errorResponse` 500 경로**(별개 경로 아님). `LedgerDataError` 는 저장 값이 손상됐을 때만 던져진다 — 원장 행의 열 값 오류(`store.ts:70,75,88,162,167-170,251`: `cash_flow_ledger.<열> 값 …`), 손상된 `cash_ledger_baseline`(`service.ts:157,263,278`·`store.ts:498`: 복구 안내 포함), 손상된 `cash_ledger_candidate_marks`(`store.ts:592`). 실행 결과: 그 오류를 `errorResponse` 에 넣으면 500 본문에 문장이 그대로 실리고(예: '저장된 cash_ledger_baseline 값이 손상돼 … system_config 의 cash_ledger_baseline 키를 삭제한 뒤 …'), 연결 거부·SQL 오류·일반 Error 는 일반 문장만 나간다. 보이는 사람은 세션이 있는 회원이고(원장은 계좌 1 전역이라 같은 회원이 GET 으로 기준·기록 전체도 읽는다 — L3), 노출 내용은 표·열·`system_config` 키 이름과 복구 절차뿐이며 SQL·자격증명·값·내부 주소는 없다. 안정 코드(예: `ledger_data_corrupt`) + 일반 문구로 바꾸고 복구 절차는 서버 로그·운영 문서로 옮기자는 권고는 타당하나, 현재는 단일 소유자에게 복구 안내가 실용적이고 돈 계산·중복 기록·권한에 영향이 없다 → **후속 허용(배포 전 필수 아님)**. 바꿀 때는 `routes.test.ts` 의 '손상된 기준 값 → 500 + 복구 안내' 시험과 조회 실패 문구를 함께 고치고, 회원이 늘면(L3) 우선순위를 올린다.
- [13:31] 결론: 두 건 모두 후속 허용이라 새 판정 줄을 쓰지 않는다 — 이 절의 마지막 판정 줄(13:26, pass, scope 는 그 줄 참조)이 그대로 유효하다. 후속 항목: 정정 경합 재조회(D3) · `LedgerDataError` 응답 문구 정리(L2 잔여).
- [14:37] 델타 재검증 2차(Stage 6: QA 결함 D-1·D-2·D-4) 범위·방법: 기준선은 지난 델타 때 사본(`t074-rev2-head`, Stage 5 상태)이고 지금 작업 트리와의 차이가 Stage 6 변경이다. 차이 파일은 Developer 보고와 일치한다(미보고 파일 0) — `src/lib/ledger/{service,store}.ts`, `src/components/ledger/{BaselineSheet,EntrySheet}.tsx`, `docs/screens.md`, 시험 3개(`routes.test`·`ledger-render.test`·`t074-disposable-mariadb.test`) + `helpers/fake-db.ts`. **마이그레이션 SQL sha256 `ab17ad46d6a5…` 가 감사 때와 같음을 직접 대조**했고 `compute.ts`(sha `6aca51542056…`)·`rules.ts`·`match.ts`·`validate.ts`·`handlers.ts`·`actions.ts`·`docs/db-schema.md` 도 Stage 5 와 바이트 동일하다. 새 사본 `t074-rev3-head`(`git archive HEAD` + T-074 파일 67개, 바이트 대조 bad=0), 변이는 그 복사본 `t074-rev3-mut` 에서만 적용하고 끝난 뒤 710개 파일을 원본과 대조해 전부 같음을 확인했다. 앱·시험·빌드·서버는 `block-external-net.cjs` 사전 로드, 운영/공유 DB 접근 0, `$P/src` 수정 0, git 쓰기 0, `.env` 값 출력 0, 이미지는 새로 받지 않았다.
- [14:37] 독립 재현(항목 5) [확실]: 앱 `tsc` 0 오류 · 시험 포함 타입 검사(18파일) 0 오류 · jest 전체 235 스위트 통과 + 2 건너뜀, 5,838 통과 / 41 건너뜀 / 5,879 — Developer 수치와 같다. 원장·라우트·화면·UI·설정 + 울타리 2종 20 스위트 508 통과(`mariadb:10.11.19` 일회용 컨테이너, 서버 기본 utf8mb3·운영 sql_mode, 127.0.0.1:33081 전용, 실제 DB 시험 24건 포함). `next build` exit 0 — `/settings/cash-ledger` 23.4 kB. 끝난 뒤 컨테이너 제거·포트 33081/3977~3979 닫힘 확인.
- [14:37] 항목 1 D-1 현금 차이 경고 [확실, 함수 직접 실행 + 실제 브라우저(360px, 일회용 DB)]: ① 임계는 `rules.ts` 한 곳(`krw: 50_000`·`usd: 50`)이며 시트는 새 상수 없이 `feed.rules` 를 쓴다 — 비테스트 코드의 임계 리터럴은 `rules.ts:14,16` 둘뿐. 후보 탐지(`candidates.ts`)와 같은 '이상' 비교다. ② 경계(스냅샷 원화 1,000,000원 · 달러 $1,918.60, 환율 1,323.89): 원화 차이 49,999 → 없음 / 정확히 50,000 → 경고 / 50,001 → 경고, 아래쪽(950,001·950,000·949,999)도 대칭, 달러 $49.99 → 없음 / 정확히 $50.00 → 경고 / $50.01 → 경고(센트 정수 비교), 아래쪽 대칭. 입력 비움(null) → 경고 없음, 같은 값 → 없음, 스냅샷에 달러 행이 없거나 환율이 없으면 달러 비교 없음, 원화 0원 입력 → 차이 −1,000,000 경고, 큰 수(원 1조·달러 $10억)도 정수로 계산되어 오버플로·NaN 없음. 두 통화 모두면 원화 → 달러 순서 두 줄. ③ 환산은 정본 재사용: `BaselineSheet.tsx:18,103` 이 `compute.ts` 의 `usdToKrw`·`toCents`·`baseTotal` 을 그대로 가져다 쓰고 `compute.ts` 는 바이트 동일 — 새 환산 없음. 달러 차이 −$1,800.00 → 원화 환산 −2,383,002원, 화면 표기는 천 원 단위 반올림 '약 −2,383,000원'(음수·양수 모두 방향 일치). ④ 저장을 막지 않는다: 브라우저에서 경고가 떠 있는 채 저장 버튼 활성 → 클릭 → PUT 본문 `confirmed.usdCash:"118.60"` → 토스트 '기준을 저장했습니다 (버전 2) 기준 총자산 7,354,180원'. 경고가 계산을 바꾸지 않는다 — 미리보기 '9,150,000원 → 7,354,180원'과 저장된 `baselineTotalKrw` 7,354,180 이 같고 `basePreview` 값(17,616,998)은 `baseTotal` 직접 계산과 같다. ⑤ 형식 오류 칸(`118,60`)은 경고 없이 저장 버튼만 비활성(기존 동작 그대로), 비우면 경고가 사라지고 '비운 칸은 스냅샷 값 — 저장하면 기준 미확정'이 보인다. 현금 확인 시트를 저장 뒤 다시 열면 확인값이 채워져 경고가 다시 보인다(차이가 계속 손익에 남아 있으므로 의도).
- [14:37] 항목 2 D-2 표 존재 확인 [확실, 실제 MariaDB 10.11 + 실제 빌드 서버]: ① 원장 표가 없는 일회용 DB(`accounts`·`system_config`·`portfolio_snapshots`만 있음)에서 `PUT /api/cash-ledger/baseline` → **HTTP 503 `not_migrated`, 실행된 SQL 은 `SELECT 1 FROM cash_flow_ledger LIMIT 0` 하나뿐, `system_config` 쓰기 0**(서비스 직접 호출과 빌드된 서버 양쪽에서 같은 결과). 본문 검증 오류(422)는 표 확인보다 먼저라 SQL 0 으로 거절된다. ② 같은 상태에서 기록 추가·후보 표시·되돌리기·다시 맞추기·되살리기·조회도 전부 1146(not_migrated)로 끝나고 `system_config` 에는 아무것도 남지 않는다(취소는 UPDATE 를 시도하지만 없는 표라 실패 — 남는 것 없음). ③ 정상 경로(표 있음): SQL 순서 `표 확인 → 스냅샷 읽기 → system_config 읽기 → INSERT` 로 SELECT 한 번만 늘었고 트랜잭션 경계는 없다(기준 저장은 풀 직접 쿼리, 원래도 트랜잭션 아님). 낙관적 잠금 그대로 — 낡은 `baseVersion` → 409 `version`, 같은 버전 동시 8건 → 성공 1 + 409 7, 실제 DB 시험 F-1 도 통과. 마이그레이션 적용 후 같은 요청이 200 으로 저장돼 `system_config` 에 키가 생긴다. ④ L8 과의 상호작용: 확인 쿼리의 1146 메시지가 `Table 'db.cash_flow_ledger' doesn't exist` 라 `cash_flow_ledger` 한정 변환(L8)이 그대로 503 으로 바꾼다 — 다른 표 1146 은 여전히 500. 확인과 쓰기 사이에 표가 사라지는 극단은 무시(요청대로).
- [14:37] 항목 3 D-4: 토스트 실제 문장 '방금 보낸 기록이 이미 저장되어 있습니다. 목록에서 확인하고 필요하면 정정해 주세요. 방금 고친 값은 저장되지 않았습니다.' 가 `docs/screens.md` 의 같은 문장 인용과 글자까지 일치하고, 동작과도 맞다(충돌 시 초안을 버리고 아무것도 저장하지 않음 — Stage 5 브라우저 확인과 같은 흐름). 기준 시트 경고 설명(원화 5만원·달러 $50 이상, `rules.ts` 기준, 저장은 막지 않음)도 구현과 일치한다.
- [14:37] 항목 4 회귀: 기준 정하기·바꾸기·현금 확인의 정상 입력(차이 임계 미만·빈 칸)에서 경고 상자가 그려지지 않고(`sh-bgap` 없음), 미리보기·'지금과 같음'·'기준 미확정' 문구·저장 버튼 상태(`disabled={errs > 0 || !r}`)는 바뀌지 않았다 — 저장 버튼에 경고 조건을 얹는 변이(T12)를 시험이 잡는다. `actions.ts`(`classifyWrite`)·오류 문구 분기·`handlers.ts` 는 바이트 동일해 영향 0.
- [14:37] 항목 5 독립 변이(Stage 6): 내가 새로 고안한 25개를 격리 사본에서 1개씩 적용해 원장·라우트·화면·UI 공용·설정 + 울타리 + 실제 10.11 DB 시험을 돌렸다(`--bail=1`, 끝날 때마다 원본 복원·sha256 대조). 경고 조건 반전(원화·달러 각각)·임계 0(원화·달러)·`>=`→`>` 경계(원화·달러)·달러 차이 부호 반전·원화 환산에 고정 환율·빈 원화 칸에서도 경고·경고 상자 미출력·**경고가 저장 버튼을 막음**·끝 문장 칸 이름 고정·차이 부호 표시 삭제·천 원 반올림을 내림으로·**D-2 표 확인을 저장 뒤로(원래 순서)**·표 확인 오류를 삼킴·엉뚱한 표를 확인·표 확인 삭제·본문 검증 삭제·D-4 문장 삭제·D-4 문장을 반대로·`RULE.krw` 값 변경은 모두 포착. **25개 중 대조군(의미 불변) 1개 제외 24개 중 22개 포착 / 2개 생존.** 생존 2개: T10(`r.usd != null` 가드 삭제 — 호출부 `hasUsd`·`r.fx` 가드와 겹쳐 등가), **T16(시트가 `feed.rules` 대신 따로 정의한 임계 {50만원, $500}를 써도 통과 — 시험 구멍)**: 함수 `cashGaps` 의 임계 인자는 시험되지만 시트가 `feed.rules` 를 실제로 넘기는 배선은 시험이 안 본다(실제 코드는 `feed.rules` 를 넘김을 읽어 확인, 발견 E1).
- [14:37] 항목 6 경고 설명과 동작의 일치 [확실, 코드 + 실제 DB 실행]: 끝 문장 '모르면 달러 현금 칸을 비워 두세요'는 실제 동작과 같다 — 빈 칸은 요청에 `usdCash:null` 로 실려(`baselineRequest`) 서버가 확인값 없음으로 저장하고, 기준 총자산은 스냅샷 총자산 그대로(예: 스냅샷 16,060,000원 → 달러 비움 시 16,060,000원, `unconfirmed:true`), 달러 $118.60 확인 시 14,347,064원으로 내려간다. 현금 확인 시트에서 이미 저장된 $118.60 을 비우고 저장해도 같은 결과로 스냅샷 값(16,060,000원)으로 되돌아간다. '이 차이는 앞으로의 손익에 그대로 남습니다'도 맞다(P = 현재 총자산 − 기준 총자산 − 순입금에서 기준 쪽에 차이가 상수로 들어감). 경고는 값을 대신 채우거나 특정 값을 입력하라고 유도하지 않는다. 행동 유도 위험은 없다.
- [14:37] 발견 E1 [심각도: 낮음] `src/components/ledger/BaselineSheet.tsx`(`cashGaps(r, cv.k, …, feed.rules)` 호출부) — 시트가 임계를 `feed.rules` 에서 가져오는 배선을 가리는 시험이 없다(T16 생존). 권고: `feed.rules` 를 `{krw: 10_000, usd: 5}` 로 바꾼 피드로 시트를 렌더해 작은 차이에도 경고가 뜨는지 확인하는 시험 1건.
- [14:37] 발견 E2 [심각도: 낮음, 정보] 원화 비교 기준은 스냅샷의 `free`(D+2 확정 예수금, 결제 대기 `locked` 제외)이다 — 사용자가 KIS 앱의 다른 예수금 항목(결제 대기 포함)을 넣으면 임계 이상 차이가 날 수 있고, 그때 경고는 '스냅샷이 틀린 값을 읽고 있다면' 이라고만 말한다. 해롭지 않고(경고만, 저장 가능) 달러의 '외화예수금 vs 주문가능' 문제(분석가 Q5)와 같은 종류의 사용자 확인 사항이다. 권고 없음(문구 변경이 필요하면 사용자 Q5 답과 함께 designer).
- [14:37] 판정 근거 요약: 치명 0 · 높음 0 · 중간 0 · 낮음 2(E1·E2; 이전 낮음 D1~D6 은 후속 목록 그대로 유지). D-1 은 정본 환산 재사용·임계 단일 정의·저장 비차단·계산 불변, D-2 는 실제 10.11 에서 표 없음 시 `system_config` 쓰기 0 과 정상 경로의 원자성·낙관적 잠금 불변, D-4 는 문구와 문서 정합을 확인했다. 마이그레이션·`compute.ts` 는 변하지 않았고 안전 경로 import 도 없다.
- [14:37] **최종 판정: PASS (scope: scripts/migrations/T-074-cash-flow-ledger.sql, src/lib/ledger/, src/app/api/cash-ledger/, src/components/ledger/, src/components/ui/Sheet.tsx, src/components/ui/__tests__/, src/app/settings/cash-ledger/, src/app/settings/CashLedgerSummaryRow.tsx, src/app/settings/SettingsPage.tsx, src/app/settings/__tests__/settings-cash-ledger-row.test.ts, src/lib/__tests__/usd-cash-balance-fence.test.ts, docs/screens.md, docs/db-schema.md)**
- [23:21] 델타 재검증 3차(Stage 7: designer 문구·구조) 범위·방법: 주간 한도(429)로 중간에 끊긴 요청을 처음부터 다시 했다(그 전에 이 절에 쓴 Stage 7 bullet 은 없음). 작업 트리를 새 사본 `t074-rev4-head`(`git archive HEAD` + T-074 파일 67개, 바이트 대조 bad=0)로 떠서 Stage 6 때 사본과 대조했다 — 달라진 파일은 **4개뿐이고 Developer 보고와 일치**한다: `src/components/ledger/BaselineSheet.tsx`, `src/components/ledger/EntrySheet.tsx`, `src/components/ledger/__tests__/ledger-render.test.ts`, `docs/screens.md`. 14:39 반영 이후 다른 T-074 파일 변경은 없다. 마이그레이션 SQL sha256 `ab17ad46d6a5…` 불변, `compute.ts`·`rules.ts`·`service.ts`·`store.ts`·`handlers.ts`·`match.ts`·`validate.ts` 바이트 동일, `docs/db-schema.md` 동일. 변이는 복사본 `t074-rev4-mut` 에서만 적용하고 끝난 뒤 710개 파일을 원본과 대조해 전부 같음을 확인했다. 앱·시험·빌드·서버는 `block-external-net.cjs` 사전 로드, 운영/공유 DB 접근 0, `$P/src` 수정 0, git 쓰기 0, `.env` 값 출력 0, 이미지는 새로 받지 않았다.
- [23:21] 독립 재현(항목 6) [확실]: 앱 `tsc` 0 오류 · 시험 포함 타입 검사(18파일) 0 오류 · jest 전체 235 스위트 통과 + 2 건너뜀, 5,841 통과 / 41 건너뜀 / 5,882 — Developer 수치와 같다. 원장·라우트·화면·UI·설정 + 울타리 2종 20 스위트 511 통과(`mariadb:10.11.19` 일회용 컨테이너, 서버 기본 utf8mb3·운영 sql_mode, 127.0.0.1:33081 전용, 실제 DB 시험 24건 포함). `next build` exit 0 — `/settings/cash-ledger` 23.7 kB. 끝난 뒤 컨테이너 제거·서버 종료·포트 닫힘 확인.
- [23:21] 항목 1 경고 끝 문장의 '많게/적게' [확실, 함수 직접 실행 + 실제 `baseTotal` 대조]: 문장의 방향·금액은 통화별 차이의 원화 환산 합(`Σ diffKrw`)에서 나오며 환산은 Stage 6 의 `cashGaps` 가 쓰는 `usdToKrw` 값 그대로(새 환산 없음), 금액 표기는 합계 절댓값의 천 원 단위 반올림 + 기존 `won()`(천 단위 쉼표)이다. 부호는 실제 계산과 일치 — 확인값을 넣었을 때 기준 총자산 변화(`baseTotal(확인) − baseTotal(스냅샷만)`)를 직접 구해 비교했다: 달러 $118.60 입력(스냅샷 $1,918.60, 환율 1,323.89) 합 −2,383,002 = 기준 총자산 −2,383,002 → 손익 +2,383,002 → '약 2,383,000원 **많게**'; 달러 $2,500 입력 +769,710 → '약 770,000원 **적게**'; 원화 3,000,000 입력 +2,000,000 → '적게', 원화 0원 입력 −1,000,000 → '많게'; 두 통화(+2,000,000 / −2,383,002) 합 −383,002 → '약 383,000원 많게' + '두 칸'; 한 통화만 경고일 때 그 통화 칸 이름; 달러 정확히 $50.00 → +66,195 '약 66,000원 적게', 소수 $50.01 → 66,208; 스냅샷에 환율이 없으면 달러 비교가 없어 원화 문장만. 입력 < 스냅샷 → 기준이 낮아져 '많게', 입력 > 스냅샷 → '적게'가 모든 경우 일치한다. 경계: 두 차이가 정확히 상쇄(원화 −1,323,890 / 달러 +$1,000.00 = +1,323,890)되어 합 0 → 방향·금액을 뺀 **예외 문장**(실제 손익 영향 0 확인), 합 ±1·±499 → '1,000원 미만' + 방향 유지(많게/적게), ±500 → '약 1,000원'. 예외 문장의 "값이 틀렸다면 앞으로 어긋날 수 있습니다"는 기준 시점에서만 상쇄될 뿐 환율이 움직이면 달러 쪽 환산이 달라진다는 뜻으로 읽히며 거짓은 아니다.
- [23:21] 항목 2 동작과 설명의 일치 [확실, 코드 + 실제 MariaDB 10.11 `putBaseline` 직접 호출]: '칸을 비우면 스냅샷 값을 쓴다'는 원화·달러 **모두 사실**이다. 원화 칸은 필수가 아니다 — 비워도 오류가 아니고(`errs` 는 형식 오류만 센다) 저장 버튼이 활성이며(브라우저 확인), 요청에 `krwCash:null` 로 실려 서버가 확인값 없음으로 저장한다. 스냅샷 총자산 16,060,000원 기준: 둘 다 비움 → 16,060,000원(차이 0, '기준 미확정'), 원화만 비우고 달러 $2,700 → +1,488,000(달러만 반영), 원화 비우고 달러 $118.60 → −1,712,936(원화는 스냅샷 값), 원화 3,000,000 + 달러 비움 → +1,800,000(원화만 반영), 원화 1,200,000(스냅샷과 같음) → 0, 둘 다 확인 → 87,064 + '현금 확인됨', 이미 저장된 확인값에서 원화만 비우고 다시 저장하면 원화 항만 스냅샷 값으로 되돌아가고(−1,712,936), 둘 다 비우면 16,060,000원으로 복귀. 도움말 '확실하지 않으면 비워 두세요'와 경고 끝 '…칸을 비우고 저장하세요. 확인되면 나중에 넣을 수 있습니다'(나중에 넣기 = 기준 현금 확인 시트)가 모두 이 동작과 맞는다. 거짓 안내 없음.
- [23:21] 항목 3 중립 ◌·aria [확실, 서버 렌더 + 실제 브라우저(360px, 일회용 DB)]: ① 차이 경고가 있을 때만 '◌ 두 값 모두 확인'(`st na`), 경고가 없으면 기존 초록 '✓'(`st ok`) 그대로, 한쪽을 비워 '미확정'이면 기존 '! 비운 칸은 스냅샷 값' 그대로(경고만 있어도 이 문구가 우선). ② 경고 상자(`#sh-bgap`, `role=note`)는 `aria-live` 영역 `#sh-bprev` **밖**이다(브라우저에서 `prev.contains(gap)` = false, 렌더 시험도 `#sh-bprev` 가 경고 앞에서 닫힘을 단언). ③ 저장 버튼의 `aria-describedby="sh-bgap"` 는 경고가 있을 때만 붙고(충돌 뒤 '내 값으로 저장' 버튼에도 같음), 그때 `#sh-bgap` 은 DOM 에 정확히 1개 존재(`describedTargetExists: true`); 경고가 없으면 속성 자체가 없어 존재하지 않는 id 를 가리키지 않는다. 입력 전환 시: 달러 $118.60 → ◌+describedby → 차이 없는 값으로 바꾸면 ✓ + 속성 제거. ④ 저장 버튼 활성/비활성 로직(`disabled={errs > 0 || !r}`)과 미리보기 숫자는 불변 — 경고가 있어도 버튼 활성, 형식 오류(`118,60`)는 비활성·경고 없음, 미리보기 '9,150,000원 → 7,354,180원'이 저장된 `baselineTotalKrw` 와 같고 서버 렌더의 17,616,998원은 `baseTotal` 직접 계산과 같다. 경고 안 보이는 정상 입력에서의 회귀 없음.
- [23:21] 항목 4 충돌 토스트 [확실]: `existingId` 는 `classifyWrite` 가 `typeof === 'number'` 일 때만 통과시키고(문자열 `<img onerror…>`·객체는 `null` 로 떨어짐을 실행으로 확인), 토스트는 `#${id}` 를 JSX 텍스트로만 쓴다(React 가 이스케이프, 속성·HTML 주입면 없음). 숫자 id 의 조사는 끝자리 규칙(`idWithRo`)이 정상 읽기와 맞다 — #1로 #2로 #3으로 #4로 #5로 #6으로 #7로 #8로 #9로 #10으로 #11로 #13으로 #16으로 #20으로 #100으로 #1000으로. 번호가 없으면 '펼쳐 두었습니다' 없는 대체 문구('이미 저장되어 있습니다. 목록에서 확인하고 다르면 정정해 주세요')로 나가고, 페이지는 번호가 있을 때만 행을 펼치므로 문구와 동작이 맞는다. 실제 브라우저 재현(응답만 끊고 값을 고쳐 재전송): 토스트 '! 방금 고친 값은 저장되지 않았습니다. 먼저 보낸 내용이 이미 #1로 저장되어 있어 펼쳐 두었습니다. 다르면 정정해 주세요.', 목록에 1,000,000원 행이 펼쳐져 포커스(`lg-eh-1`), 고친 값은 없음, DB 행 1개. `docs/screens.md` 의 같은 문구 설명(`#n`·조사 규칙)과 일치.
- [23:21] 항목 5 도움말의 스냅샷 값 보간 [확실]: 달러·원화 도움말의 '스냅샷 값'은 하드코딩이 아니라 그 스냅샷 옵션(`r.usd`·`r.krw`)에서 보간된다 — 옵션 값을 $777.77 / 123,456원 으로 바꿔 렌더하면 그대로 따라가고(변이로도 확인), 값이 큰 경우($1조)도 `$1,000,000,000,000.00` 으로 오류 없이 표기, 스냅샷에 달러 행이 없으면 달러 칸·도움말이 아예 그려지지 않는다. `$` 표기는 기존 `usd()`(= `fmtUsd`)다. 이 함수는 절댓값을 찍어 음수 부호가 없고 NaN 이면 `$NaN.NaN` 이 되지만, 입력은 서버 JSON(NaN 불가)·`hasUsd` 가드(값이 있을 때만 그림)를 지나므로 도달하지 않는다 — 정보 사항.
- [23:21] 항목 6 독립 변이(Stage 7): 내가 새로 고안한 22개를 격리 사본에서 1개씩 적용해 원장·라우트·화면·UI 공용·설정 + 울타리 + 실제 10.11 DB 시험을 돌렸다(`--bail=1`, 끝날 때마다 원본 복원·sha256 대조). 많게/적게 부호 반전·합 대신 첫 통화만·절댓값 합·합 0 분기 제거·합 0 분기를 1,000원 미만으로 확장·'1,000원 미만' 분기 제거·◌ 조건 반전·aria id 오타·경고 없을 때도 id 참조·저장 버튼 aria-describedby 삭제·경고 상자 role 변경·달러/원화 도움말 스냅샷 값 하드코딩·원화 도움말 비움 안내 삭제·안내 동사를 '채우고'로 바꿈(동작과 반대)·칸 이름 반대·토스트 번호 하드코딩·조사 판정에서 '육' 누락·번호 없을 때도 번호 문구·토스트 첫 문장을 동작과 반대로 바꿈은 모두 포착. **22개 중 20개 포착 / 2개 생존**: V06(합계 금액의 천 원 반올림을 내림으로 — 시험의 합계가 우연히 반올림·내림 결과가 같은 값 2,383,002·383,002 뿐이라 방향을 못 가림) · V20(`client_entry_conflict` 의 `existingId` 숫자 검증을 지워도 통과 — 실제 코드는 문자열·객체를 `null` 로 처리함을 위 탐침으로 확인). 둘 다 코드가 아니라 시험이 비어 있는 곳이다.
- [23:21] 발견 F1 [심각도: 낮음] `src/components/ledger/__tests__/ledger-render.test.ts`(Stage 7 `cashGapNote` 단언) — 합계 금액의 반올림 방향 시험이 없다(V06 생존). 권고: 합이 66,500 처럼 반올림과 내림이 갈리는 값(→ '약 67,000원') 단언 1건.
- [23:21] 발견 F2 [심각도: 낮음] `src/components/ledger/__tests__/actions.test.ts` — `client_entry_conflict` 응답의 `existingId` 가 문자열·객체일 때 `null` 이 되는 시험이 없다(V20 생존; `duplicate` 분기와 같은 방어). 권고: 시험 1건.
- [23:21] 판정 근거 요약: 치명 0 · 높음 0 · 중간 0 · 낮음 2(F1·F2, 이전 낮음 D1~D6·E1·E2 는 후속 목록 그대로). 경고 문장의 방향·금액은 실제 기준 총자산 변화와 일치하고, '비우면 스냅샷 값' 안내는 원화·달러 모두 실제 동작(실제 DB 저장 결과)과 일치하며, ◌/✓·aria-describedby 는 경고가 있을 때만 존재하는 id 를 가리키고, 토스트는 숫자 id 를 텍스트로만 쓴다. 마이그레이션·`compute.ts`·서비스·저장 계층은 변하지 않았다.
- [23:21] **최종 판정: PASS (scope: scripts/migrations/T-074-cash-flow-ledger.sql, src/lib/ledger/, src/app/api/cash-ledger/, src/components/ledger/, src/components/ui/Sheet.tsx, src/components/ui/__tests__/, src/app/settings/cash-ledger/, src/app/settings/CashLedgerSummaryRow.tsx, src/app/settings/SettingsPage.tsx, src/app/settings/__tests__/settings-cash-ledger-row.test.ts, src/lib/__tests__/usd-cash-balance-fence.test.ts, docs/screens.md, docs/db-schema.md)**

## QA

- [14:10] 범위·방법: QA(Sonnet 직접 실행 — 돈 계산 task 라 Haiku 대신). 코드 수정 0, git 쓰기·배포·pm2·크론·`rm -rf` 0, 운영/공유 NAS DB 접속 0, `.env`·비밀 값 읽기·출력 0(세션 서명키는 로컬 전용 합성 문자열). 모든 값은 합성값(KRW 100만 단위·달러·환율 1,300.00·보유 `AAA001`/`NAS:CCC`). 판정은 아래 `실행 근거`로만 적었고 추측은 없다.

### 환경·재현 조건
| 항목 | 값 |
|---|---|
| 격리 사본 | `scratchpad/t074-qa-sonnet` = `git archive HEAD`(`fa0669c9`) + T-074 파일 덧씌움(원장·라우트·화면·시트·설정 행·문서·울타리 시험·마이그레이션·데모). `sha256` 대조 **bad=0 / 68파일**(`t074-qa-sync.sh`). 데모 `mockups/T-074-cash-flow-ledger-v1.html` sha = 승인 해시 `eab12bff…` 일치, `check.mjs check` = `DEMO_GATE_PASSED`(v1 approved) |
| DB | 로컬 `mariadb:10.11` 일회용 컨테이너 2개(127.0.0.1 전용 33091 jest·33092 화면) = **10.11.19**, 운영 sql_mode(`IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION`), 서버 기본 **utf8mb3**(`--character-set-server=utf8mb3`), 전역 time_zone +09:00(운영과 동일 KST), 기존 4표 DDL = 운영 `SHOW CREATE` 와 같은 모양, 나머지 표는 앱 `setupDB`, `paper_fills` 는 T-072 마이그레이션 |
| 서버 | `next start -H 127.0.0.1 -p 3992`, `env -i`(DB_*·합성 세션 키·`DRY_RUN=true KILL_SWITCH=true CRON_WATCHDOG_ENABLED=false`·`TZ=Asia/Seoul`), 사전 로드 `block-external-net.cjs`(시작 로그 첫 줄 차단 활성 확인), 준비 확인은 `/login`(`/api/health` 미사용) |
| 브라우저 | HeadlessChrome 147(Playwright), ko-KR, Asia/Seoul, DPR 1, 폭 412×915 · 360×780(시트 360×700) · 1280×900, 앱은 **다크 단일 테마**(라이트 토큰 없음 — `prefers-color-scheme: light` 에도 같은 색 실측), 애니메이션 비활성은 하지 않음(대기 후 측정), 브라우저가 127.0.0.1:3992 밖으로 나가는 요청은 라우트로 중단, 스냅샷은 SQL 로 합성(크론 미사용) |
| 시험 때 쓴 시각 | 전부 2026-10-23 13:35~14:06 KST(스냅샷 14개 · 최종 기록 22행(번호는 #43 까지 — 실패 시도가 소비), 전부 합성) |

### A. 자동 시험 재실행 (격리 사본, 사전 로드 차단)
| 항목 | 결과 | Reviewer 수치 |
|---|---|---|
| 앱 `tsc --noEmit -p .` | **0 오류** | 0 |
| 시험 포함 타입 검사(`tsconfig.t074-tests.json`, 19파일) | **0 오류** | 0 |
| jest 전체(`CRON_WATCHDOG_ENABLED` 해제) | **235 스위트 통과 + 2 건너뜀 · 5,834 통과 / 41 건너뜀 / 5,875** | 5,834 / 41 — 일치 |
| jest 전체(지시한 `CRON_WATCHDOG_ENABLED=false` 로) | 5,833 통과 + **1 실패** `cron-watchdog.test.ts › 두 번 호출해도 타이머는 하나만 등록된다`(`startCronWatchdog` 가 env 로 꺼져 `true` 대신 `false`) | **T-074 와 무관한 환경 변수 산물** — 변수를 빼면 22/22, 전체 5,834 통과 |
| 일회용 DB 시험 `T074_TEST_DB_PORT` | **24/24**(10.11.19) · 전체 jest 236 통과 + 1 건너뜀(T-072) · 5,858 통과 / 17 건너뜀 | 24/24 — 일치 |
| 원장·라우트·화면·UI·설정·울타리 스위트만(19스위트) | **500 통과 / 0 실패**(DB 시험 포함) | — |
| 시간대 `TZ=UTC` · `TZ=America/New_York` (DB 제외) | 각 410 통과 / 24 건너뜀 | 시간대 무관 |
| `next build`(사전 로드, telemetry off) | **exit 0**, 20.7초 · `/api/cash-ledger*` 9개 ƒ · `/settings/cash-ledger` ○ **22.9 kB** · `/settings` 16.8 kB | 22.9 kB — 일치 |

### B. 마이그레이션 전/후 흐름 (운영 배포 순서 리허설 — 서버를 한 번도 재시작하지 않은 채 DDL 적용)
| # | 입력 | 실제 결과 | 판정 |
|---|---|---|---|
| B1-a | DDL **전** `/api/cash-ledger*` 9개 | GET·PUT baseline·cancel·restore·dismiss·reopen·rematch → **503 `not_migrated`**("기록이 없어진 것이 아닙니다"), POST entries·correct 는 `baseVersion:1` 일 때 503(`baseVersion:0` 은 본문 검증이 먼저라 422) · 로그인 없음 401 | PASS (D-2 참고) |
| B1-b | DDL 전 `/settings`(412px) | '자산 기록' 행 = 중립 `◌ 준비 중 — 서버 준비 뒤 쓸 수 있습니다`, 콘솔 오류는 의도된 503 하나뿐 | PASS |
| B1-c | DDL 전 설정 다른 기능 | 변동폭 가드 스위치 토글 → 저장 바 → `PATCH /api/settings/safety` **200** → 새로고침 후 값 유지. 표 이름을 바꿔 503 을 다시 만든 상태에서도 같은 결과(저장 200·값 유지) | PASS |
| B2 | `mysql < T-074-cash-flow-ledger.sql` 2회(`docker exec -i … < 파일`) | 1회·2회 모두 rc=0(멱등), 표 1개·인덱스 6·UNIQUE 3·CHECK 5·FK 2·`live` STORED, 콜레이션 utf8mb4_general_ci, 행 0 | PASS |
| B3 | DDL 직후 **서버 재시작 없이** 첫 `GET /api/cash-ledger` | **200** `baseline:null · summary:null · candidates:[] · baselineOptions 3개(오늘 아침 '권장'·최신·어제 아침) · persisted:true` · 설정 행 → "**손익 기준이 아직 없습니다 / 눌러서 기준을 정하면 입출금을 기록할 수 있습니다**" | PASS |

### C. 사용자 시나리오 (손계산 ↔ 화면 ↔ API 일치)
기준 시각 10-23 07:30 스냅샷 #2 = 총자산 10,130,000(원화 1,000,000 · 달러 $100.00 @1,300 = 130,000 · 보유 9,000,000), 이후 최신 스냅샷 #4 = 10,230,000(보유 시세 +100,000).

| # | 입력 | 손계산 | 실제(화면·API) | 판정 |
|---|---|---|---|---|
| C1 | 기준 정하기, 원화 1,000,000 + 달러 **$118.60('외화예수금')** | 기준 총자산 10,130,000 + (118.60−100.00)×1,300 = **10,154,180** · P = 10,230,000 − 10,154,180 = **+75,820**, R = 0.747% | 시트 미리보기 `10,130,000원 → 10,154,180원`, 저장 후 `+75,820원 · +0.75%`, 토스트 "기준을 저장했습니다 (버전 1)" | PASS |
| C1' | 같은 칸에 **'주문가능'으로 보이는 $18.60** | 10,130,000 + (18.60−100.00)×1,300 = **10,024,180** | 미리보기 `→ 10,024,180원`(구분 입력이 기준 총자산을 의도대로 바꿈), 입력 `118,60`·`1,5` → "숫자만 넣어 주세요." 저장 버튼 비활성, `-5` "부호는 넣지 않습니다…", 0 허용(기준 현금 0원 = 실제 값), `118.605` "센트까지만" | PASS — 문구는 **D-1 참고** |
| C1'' | 기준 미확정(확인값 없음) 저장 → '기준 현금 확인' 시트 | b0 = 10,130,000 → 확인 후 10,154,180 | 칩 "임시 · 기준 미확정"·경고 상자 → 확인 시트(빈 칸으로 열림) 저장 후 P +660,000 → **+635,820**(차이 24,180 = 18.60×1,300) | PASS |
| C2 | 입금 KRW 1,000,000 @13:35(최신 스냅샷 13:30 뒤) | 스냅샷 없음 → **반영 대기**, 순입금 제외 → P 불변 75,820 | 토스트 "다음 스냅샷에서 반영 여부를 확인", P `+75,820` 유지, 배너 "반영 대기 1건 · +1,000,000원 … 지금 손익에는 빠져 있습니다" | PASS |
| C2' | 스냅샷 #5(13:41) 원화 +1,000,000, 총자산 11,230,000 | 매칭 → 순입금 1,000,000 · P = 11,230,000 − 10,154,180 − 1,000,000 = **75,820** | `matched#5` "원화 현금 +1,000,000원 확인 (허용 ±1,000원)", P=75,820, net=1,000,000 | PASS |
| C3 | 입금 USD $200(13:42) → 스냅샷(13:43) USD +$200, 총자산 +260,000 | 순입금 +260,000(반영 시점 환율 1,300) → P 불변 75,820 | 반영 대기(`pending krw 260,000`·P 불변) → `matched#6`, `krwEquiv 260,000`, P=75,820 | PASS |
| C3' | **환전** 원화 650,000 → $500.00(13:44) → 스냅샷(13:45) 원화 −650,000·달러 +$500 | 순입금 0, 손익 불변 | 미리보기 "적용 환율 1,300.00원/$ · 환전 비용(추정) 약 0원", "손익 변화 없음", 반영 `matched#7` "같은 스냅샷에서 원화 −650,000원 · 달러 +$500.00 확인", net·P 불변 | PASS |
| C4 | **출금** 300,000(13:46, 메모에 `<img src=x onerror=alert(1)>`) → 스냅샷(13:47) 원화 −300,000 | 순입금 1,260,000−300,000 = 960,000 · P = 11,190,000 − 10,154,180 − 960,000 = **75,820** | 반영 대기(`pending krw −300,000`) → `matched#8`, P=75,820, 확인 문장 "총자산이 이만큼 줄어든 것은 투자 손실로 보지 않습니다" | PASS |
| C5 | **정정** #5 출금 300,000 → 250,000(스냅샷은 −300,000) | 불일치 → 기록대로 포함, 순입금 1,010,000, P = **25,820** | 정정 시트 미리보기 `순입금 960,000 → 1,010,000 · 손익 +75,820 → +25,820`, 저장 토스트 "불일치로 표시했고 기록대로 계산에 넣었습니다", 배너 "불일치 1건 … #6 기록 보기", 기록 안 된 변화 후보 1건(−300,000) 등장 | PASS |
| C5' | #6 → 300,000 원복(#7), 정정 체인 | 체인 #5→#6→#7, P = 75,820 | `voids=2`, #7 `matched#8`. **같은 대상을 또 정정**(#5·#6) → 409 `already_voided`, 같은 키·같은 내용 재전송 → 200 replay, **DB 직접 `INSERT … supersedes_id=5` → ERROR 1062 `uq_cfl_supersedes`** | PASS |
| C5'' | **취소** #3($200)(사유 필수) / **복구** | 취소하면 순입금 960,000→700,000, P = 11,190,000 − 10,154,180 − 700,000 = **335,820** | 시트 "취소하면 … 순입금 960,000원 → 700,000원 · 손익 +75,820원 → +335,820원", 사유 미선택 시 버튼 비활성, 취소 뒤 후보 카드(달러 +$200) 등장, 복구 → P 75,820 복귀. 되살린 기록 재복구 409 `not_voided`, 정정으로 대체된 #5 복구 409 `superseded` | PASS |
| C6 | 후보 카드: ① 달러 +$200 후보 → '입출금 아님'(사유 필수)·[되돌리기] ② '입금으로 기록'(미리보기 "바로 반영 … +335,820 → +75,820") ③ 원화 +500,000/−400,000 두 건(방향 섞임) | — | ① 표시 후 P 불변, 되돌리기로 카드 복귀 ② 기록 #10 저장·후보 소멸 ③ **"입금·출금이었다면 줄마다 기록해 주세요. 기록하기 전까지 이 변화들은 위 손익(+175,820원)에 투자로 번 돈·잃은 돈처럼 섞여 있습니다."**, 출금으로 기록(−400,000)하면 P +175,820 → +575,820(500,000 입금 변화는 기록 안 됨 → 투자 손익에 그대로) · 표시 2건 이상이면 접힘 `펼치기 ▾`/`접기 ▴`(Enter 로 토글, `::after` 대체 텍스트 "펼치기"/"접기") | PASS (D-6 참고) |
| C6' | **환전을 입금으로 오기록** USD $100(13:53), 스냅샷(13:56) 원화 −130,000·달러 +$100 | 입금으로 맞추면 P 과소(−130,000) | 맞추지 않고 `불일치` + "같은 스냅샷에서 원화가 130,000원 줄었습니다 — 환전이었다면 환전으로 정정하세요", **[환전으로 정정]** 버튼 → 환전 130,000원 → $100.00 사전 입력 → 저장 후 P 505,820 → **635,820** | PASS |
| C7 | 기준 이전·같은 분 입금 | 어제 입금 불가 | 화면: "기준 시각(10-23 07:30) 이전이라 기록할 수 없습니다. … 같은 돈을 두 번 빼게 되어 손익이 그만큼 틀어집니다." 확인하기 비활성(07:29·**07:30 차단, 07:31 허용**). 서버(화면 우회): `10-22 10:00`·`10-23 07:30` → **422 `before_baseline`**, 미래 시각 → 422 `future` | PASS |
| C8 | 같은 분·같은 금액·다른 키 | 중복 | 409 `duplicate`("같은 종류·통화·금액·시각(분)의 기록이 이미 있습니다…") `existingId:2`. 취소→같은 내용 재입력(200)→취소→복구 A(200)→복구 B **409 `duplicate`**("두 번 빠집니다")→A 취소→B 복구(200). 같은 키 10개 **동시**: 신규 1 + replay 9, 다른 키 같은 내용 10개 동시: 신규 1 + 409 9, 행 1개 | PASS |
| C9 | 입력 검증(시트 20종 + 서버 직접) | — | `118,60`·`1,5`·`1e3`·`100만`·`1억`·전각·`abc` "숫자만 넣어 주세요." · 빈 값 확인하기 비활성 · 음수 "부호는…" · 0 "0보다 큰 금액…" · 소수 원 "1원 단위로…" · 달러 3자리 "센트까지만" · 9,999,999,999,999원 "너무 큽니다" · 1,000,000,000,000원 허용 · `1,000,000`·`  50,000  `·`1,234.50` 허용(`insertText` 붙여넣기 경로도 `1,000,000` 정상) · 메모는 `maxlength=200` 으로 201자 입력 불가(서버 직접 201자 → 422 `too_long`) · `<img onerror>`·`<script>`·`'); DROP TABLE…` 메모 → 확인 시트·목록·펼친 상세 모두 **텍스트**(img·script 요소 0, `alert` 0, 표 보존) · 이모지·4바이트 한자 메모 정상 저장 | PASS (D-5) |
| C10 | **M1 재현**: 기록 POST 응답을 프록시로 17초 붙잡음(서버는 27ms 에 저장 완료) | 15초 뒤 시간 초과 | 시트에 "저장하지 못했습니다 — 응답이 15초 안에 오지 않아 중단했습니다 / 입력한 내용은 그대로 있습니다. 다시 눌러도 두 번 기록되지 않습니다" + [다시 시도]. 금액을 77,000→79,000 으로 고쳐 재전송 → **409 `client_entry_conflict`**(`existingId:17`) → **시트 닫힘**, 토스트 "방금 보낸 기록이 이미 저장되어 있습니다. 목록에서 확인하고 필요하면 정정해 주세요", 저장된 **#17(77,000)이 펼쳐지고 포커스**. DB: 13:39 행 1개(77,000), 78,000·79,000 **0행**. 같은 내용 재전송 → 200 `replayed:true`(행 수 불변), 같은 키·다른 종류 → 409 | PASS (D-4) |
| C11 | 저장 버튼 같은 tick 3번 클릭 | 1건 | POST **1번**, 행 1개(#18, 같은 `clientEntryId`) | PASS |
| C12 | 로그아웃 | — | 페이지 `/settings`·`/settings/cash-ledger` → 307 `/login?next=…`, 원장 API 9개 전부 **401**, 변조 쿠키 401 | PASS |
| C13 | 원장 오류 중 설정 | 영향 0 | `cash_ledger_baseline` 값을 손상 → 원장 GET·rematch **500**(로그에 원문, 응답에 복구 안내 문장) → 설정 행 "불러오지 못했습니다 — 눌러서 다시 확인", 안전장치 스위치 토글·저장 `PATCH /api/settings/safety` **200**·새로고침 후 유지. 표 이름 변경 → 503 도 같은 결과. 원장 화면은 오류 상자("기록이 없어진 것이 아닙니다") + [다시 시도]. 복원 후 정상 | PASS |
| C+ | 기준 바꾸기: 낡은 `baseVersion` → 409 `version`, 기준 #5(13:41)로 변경 | 기준 이전 기록 제외 | `pre=1`, b0 11,230,000, 순입금 −440,000(260,000−700,000), P = 11,350,000 − 11,230,000 + 440,000 = **560,000** 일치, 새 버전 뒤 옛 `baseVersion` 기록 409 `baseline_version`. 밤 스냅샷 표지: 어제·오늘 달러 −$1.80 왕복 패턴 + 최신이 '빠짐' → `usdGapHint {usd:1.8, krw:2340}`, 화면 "이 시각(14:05) 스냅샷은 달러 현금 약 $1.80이 빠져 보이는 시간대입니다. 손익이 약 2,340원 작게 보일 수 있습니다…" | PASS |

### D. 안전장치 분리
- **매매 표 0행 변경** [확실]: `orders`·`signals`(0)·`paper_fills`·`trade_logs`·`executions`·`holdings`·`position_state`·`cooldowns`·`eval_funnel`·`user_settings` 행 0·체크섬 0 불변, `information_schema.update_time` = `orders/position_state/executions/paper_fills/trade_logs/holdings` **NULL(한 번도 안 쓰임)**, `strategies`(16행) 체크섬 `2666332475` 가 원장 기록 전(T0)·후 **동일**, `users`·`accounts` 체크섬 불변. `system_config` 에서 원장이 바꾼 키는 `cash_ledger_baseline`·`cash_ledger_candidate_marks` 둘뿐(그 외 변경은 내가 설정 화면 저장 바를 시험한 `vol_guard_enabled` 등 설정 키).
- **코드 정적 확인**: `src/lib/ledger`·`src/app/api/cash-ledger`·화면에 `fetch(`·`http(s)://`·거래소·안전·시그널·전략·크론·LLM·알림 import **0건**, 원장 저장 계층의 쓰기 SQL 은 `INSERT/UPDATE cash_flow_ledger`·`INSERT/UPDATE system_config` 뿐.
- **외부 네트워크**: 사전 로드 차단 활성, 서버 로그 `EBLOCKED`·`[fx]`·`fetch failed`·`frankfurter` **0줄**, 서버 프로세스 소켓은 127.0.0.1:33092(DB) 뿐. (설정 화면 `/api/settings/safety` 가 환율 조회를 시도하는지는 로그에 없었다 — 시도 횟수 자체는 계측하지 않음.)
- **로그 비밀**: 서버 로그 55줄에서 DB 비밀번호·세션 키·쿠키·내부 IP 패턴(`qa074`·`secret`·`password`·`192.168`·`si_session=`) **0건**. 500 응답에 SQL·자격증명 없음(손상 기준 복구 안내 문장은 Codex 지적 2건 중 2번과 같은 동작 — D-8).
- **인증**: 모든 원장 라우트 미들웨어 + 라우트 이중 확인(401), `OAUTH_PUBLIC_PATHS` 미포함.

### E. 접근성·모바일 (확인한 범위)
- 가로 스크롤 **0**: 412·360·1280px 에서 모든 기록 펼침 상태 `scrollWidth == clientWidth`, 시트(기록·환전 오류 표시·기준) 3폭 모두 시트 안 가로 스크롤 0.
- 터치 대상 **44px 미만 0개**(페이지·시트의 button·a·input·summary·라디오 라벨 실측), 중복 `id` 0. 11px 미만 글자는 공용 하단 탭 라벨 5개(10px, T-074 이전 컴포넌트)뿐.
- 시트: `role=dialog`·`aria-modal=true`·`aria-labelledby` 제목, 열면 금액 칸 포커스, **Tab 24번 + Shift+Tab 6번 시트 밖 0회**, 배경 `inert`·본문 스크롤 잠금, **Esc → 연 버튼(`lg-add`)으로 포커스 복귀**·`inert`·스크롤 원복. 입력 오류는 `aria-invalid`+`aria-describedby`, 토스트 `role=status`.
- 1280px: 2열(왼쪽 카드 420px · 오른쪽 표, 행마다 [자세히]), 시트 가운데 520px.

### 발견 결함·지적
| ID | 심각도 | 내용 | 재현 | 권고 |
|---|---|---|---|---|
| **D-1** | **중간 — 설계 위험·사용자 결정 대기(Q5)**. 달러 불일치가 실제와 같다면 실데이터에서는 높음이 될 수 있다 | 기준 현금 **확인값이 스냅샷 값과 크게 달라도 경고가 없다**. 기준 총자산만 `(확인−스냅샷)×환율` 만큼 보정되고 **현재 총자산은 스냅샷 값 그대로**라, 그 차이는 이후 모든 손익에 **상수 오프셋**으로 남는다(실측: 확인 $118.60 vs 스냅샷 $100 → P 가 24,180원 낮아진 채 유지, 미확정으로 두면 660,000/확인하면 635,820). 안내 문구는 "KIS 앱 '외화예수금'을 넣으세요"라 사용자가 KIS 값을 넣게 된다. [가능성 높음 — 메커니즘은 합성값으로 실측, 실데이터 적용은 추론] 작업 문서의 실데이터는 스냅샷 $1,918.6 vs KIS 앱 $118.60(차이 $1,800 ≈ 238만원)이므로, 이후 스냅샷이 계속 $1,9xx 로 읽힌다면 그대로 확인값을 넣을 때 **약 +238만원의 가짜 수익**이 손익에 들어간다(밤 시간대 왕복 X 가 빠지는 스냅샷이면 달라질 수 있음 — Q5 미확정) | 기준 시트에 달러 $1,900.00(스냅샷 $100)·원화 3,000,000(스냅샷 1,000,000)을 넣어도 미리보기는 `기준 총자산 10,130,000원 → 12,470,000원` 화살표뿐, 경고·저장 비활성 없음 | **Q5 확정 전에는 달러 칸을 비워 '기준 미확정'으로 저장**(스냅샷 대 스냅샷이라 일관). 코드는 후속으로 "시스템 값과 KIS 값이 다릅니다 — 이 차이는 앞으로 손익에 계속 남습니다" 경고(예: 차이가 총자산의 1% 또는 10만원 초과)와 스냅샷 값·확인값 나란히 표시를 권고. **배포·DDL 승인 전에 Leader 가 사용자에게 알릴 것** |
| D-2 | 낮음 | DDL **전**에 `PUT /api/cash-ledger/baseline` 직접 호출 시 `system_config.cash_ledger_baseline` 을 **저장한 뒤** 원장 표 읽기에서 1146 → **503 반환**(저장은 남음). 화면은 조회가 먼저 503 이라 기준 시트에 닿을 수 없어 사용자 경로로는 발생하지 않음 | DDL 전 `curl -X PUT …/baseline -d '{"snapshotId":2,"confirmed":{…},"baseVersion":0}'` → 503, DB 에 version 1 키 존재(시험 중 확인·삭제) | 쓰기 전에 원장 표 존재 확인(또는 `buildFeed` 를 저장 전 한 번 시도). 배포 후 그 키가 남아 있어도 해롭지 않으나 "기준 없음" 상태(B3)가 어긋날 수 있다 |
| D-3 | 낮음 | 기록 시트 검증이 현재 시각을 **입력이 바뀔 때만** 다시 읽는다(`EntrySheet.tsx:181` `useMemo([d, feed])`). 시각을 현재 분보다 한 분 앞(13:41:59 에 13:42)으로 넣어 "아직 오지 않은 시각입니다. 지금(10-23 13:41) 이전으로…" 오류가 뜬 뒤, **분이 바뀌어도 아무 칸도 건드리지 않으면 오류·확인하기 비활성이 그대로**(30초 뒤에도 13:41 표시). 칸을 하나 고치거나 닫았다 다시 열면(초안 이어쓰기) 풀린다. 서버는 그 시각을 받는다 | 13:41:59 경 시각 칸에 13:42 입력 후 30초 대기, 확인하기 비활성 유지(이번 시험에서 1회 우연히 재현) | 분 단위 타이머로 재검증하거나 '아직 오지 않은' 판정에 1분 여유 |
| D-4 | 낮음(Reviewer D4 재확인) | M1 충돌 토스트가 "방금 고친 값은 저장되지 않았습니다"를 말하지 않는다 — 고친 값이 저장됐다고 오해 가능 | C10 | 문구 한 줄 보강(designer 확인) + `docs/screens.md` 에 흐름 추가 |
| D-5 | 낮음(정보) | 메모에 제어문자(NUL·BEL·개행)가 API 로는 저장된다(`a\0b\x07c\n줄바꿈` 그대로 DB 저장, 화면은 텍스트로 안전 표시). 화면 입력으로는 개행 불가 | API 직접 호출 | 서버에서 C0 제어문자 제거 |
| D-6 | 정보(문구·표시) | '입출금 아님으로 표시한 변화'가 2건이면 카드 제목과 접힘 요약이 둘 다 "1건"이라 합계 오해 소지 · 금액 읽기 `= 1,000,000,000,000원 · 10,000억원`(1조 표기 없음) | C6·C9 | 접힘 요약을 "이전 표시 n건"으로, 만 단위 위는 조 단위 |
| D-7 | 정보(이미 기록된 것) | Codex 지적 2(`LedgerDataError` 복구 문장이 500 본문·화면에 노출 — 표·키 이름)를 화면에서 재현: "서버 응답 500 — 서버 오류로 처리하지 못했습니다: 저장된 손익 기준을 읽을 수 없습니다 … system_config 의 cash_ledger_baseline 키를 삭제한 뒤 …". 원장은 계좌 1 전역이라 **다른 회원 세션(`sub=2`, 존재하지 않는 id)도 200 으로 전체 기록을 읽는다**(Reviewer L3, 회원 1명 전제). 정정 동시 요청 `already_voided`(D3)는 이번에 재현하지 않았다 | C13 · 세션 `sub=2` GET 200 | Reviewer·Codex 판정대로 후속 허용. 회원이 늘면 L3 우선순위 상향 |

### 확인하지 못한 것
- **실제 갤럭시 크롬의 가상 키보드가 하단 시트의 입력 칸을 가리는지**, TalkBack·스크린리더 낭독(ARIA 속성·포커스 이동만 실측) — 실기기 없이 불가.
- **운영 MariaDB 10.11.11 정확 버전**(이미지는 10.11.19), **운영 실데이터·실계좌 값으로 마이그레이션 뒤 화면**, 크론이 만든 실제 스냅샷(이번엔 SQL 합성).
- '스냅샷 3시간 초과' 배지(`stale`)의 브라우저 실표시(렌더 시험만 — 합성 스냅샷이 계속 최근이라 못 만듦), 두 기기 동시 사용, Chromium 외 브라우저, 라이트 모드(앱이 다크 단일이라 해당 없음).
- 데모↔구현 픽셀 대조는 다시 하지 않았다(designer 구현 점검 절 신뢰, 승인 해시·문구·흐름·수치만 대조). 외부 네트워크 시도 '횟수'는 계측하지 않고 차단·로그 0줄·소켓 0개로만 확인.
- 정리: 서버 종료·포트 3992/33091/33092 닫힘·컨테이너 `t074-qa-db-a`·`t074-qa-db-b` 제거 확인, `/tmp/qa-artifacts` 에 만든 스크린샷·콘솔 로그 7개 삭제. 격리 사본·합성 스크립트는 scratchpad 에 남김(작업 트리·운영 무관).

QA 가 Leader 에게: **D-1 은 코드 결함이 아니라 사용자 결정(Q5) 대기 항목이지만 DDL 승인 전에 사용자에게 반드시 알려야 한다.** 승인 후 첫 사용 때 달러 칸을 비워 저장하는 것이 안전하다.

- [14:10] **QA 판정: PASS**

## Codex 검토

### [2026-10-23 13:30] C2 review focus=none — done
- judge 판정: judge-result@2 (codex_gate, C2) — codex_required=true, mode=review, focus=none, budget_rule=CX-limit-unknown-r2, codex_calls_used=0, codex_switch=on / 호출 차수: 1/4
- 대상: repo=/home/brownjeon/NFS/homes/brownjeon/project/StockInvest base=fa0669c(task_file) snapshot=08ba923
- 지적 2건:
  - [low] `src/lib/ledger/service.ts:422` — 같은 clientEntryId·같은 내용의 정정 요청 두 개가 거의 동시에 실행되어 둘째가 잠금에서 깨어날 때 → `already_voided` 로 바로 409, 같은 cid 행을 재조회해 replayOrConflict 하지 않음 → 서버 저장은 한 번이나 멱등 요청의 성공 응답 재현이 깨짐(중복 기록·금액 유실 없음) (권고: already_voided 응답 전에 findByClientEntryId 재조회 후 replayOrConflict 처리)
  - [low] `src/lib/ledger/handlers.ts:52` — LedgerDataError 는 메시지를 그대로 응답에 실음 → 저장 구조(테이블·컬럼명, system_config 키, 복구 절차)가 인증된 호출자에게 노출(SQL·자격증명 값은 미노출) → 외부 응답은 일반 문구, 상세는 서버 로그 (권고: 안정 코드·일반 문구로 응답하고 구체 내용은 로그에만 기록)
- Codex 요약: 금액 정수화, Modified Dietz 가중치, 환전의 순입금 제외, 스냅샷 매칭 경계, DDL CHECK·UNIQUE, 취소·정정·복구 트랜잭션, API 9개의 requireUserId 경유를 코드상 검토. 돈을 틀리게 계산하거나 중복 원장 행을 만드는 결함은 확인되지 않았다고 보고.
- 검토하지 못한 범위:
  - 허용 범위 밖 동시 포함 변경 141개 중 api-usage, 인증 제공자, KIS HTTP, git hook 및 다른 task 변경
  - 운영 MariaDB 마이그레이션 실행·실데이터 검증(읽기 전용 제약으로 미수행)
  - 브라우저 실기기 동작, 전체 Jest·Next.js 빌드 재실행
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261023T042842Z-T-074-C2/raw.txt

## Leader 기록 (배포 전 — 2026-10-23 23:3x)

- **파이프라인 현황**: Analyst → Designer 데모 v1 승인 → WP-A·WP-B → designer 점검(Stage 3·7·8 문구 반영) → Reviewer 전체(12:57 조건부) → 델타 3회 → 최종 pass(23:21, Stage 7까지) → Codex C2(1/4, low 2건 후속 허용) → QA pass(14:10) → QA D-1·D-2·D-4 반영(Stage 6) → designer 구조·문구(Stage 7) → 합 0 문장 교체(Stage 8).
- **Stage 8 확인 범위(정직 기록)**: Reviewer 의 마지막 델타(23:21)는 Stage 8 이전이다. Stage 8 은 `BaselineSheet.tsx` 합 0 문장 **문자열 상수 한 줄 교체 + 시험 단언 + screens.md** 뿐(분기 조건·계산 불변)이라 Leader 가 `stage8.diff` 를 직접 읽고 원장·화면·울타리 스위트(17 통과/464 통과·24 건너뜀)와 마이그레이션 SQL sha(`ab17ad46d6a5`) 불변을 확인했다. Reviewer 재감사는 하지 않았다(주간 한도 소진 방지). QA 도 Stage 6~8 이전 코드로 돌렸고, 이후 변경은 Reviewer 가 일회용 mariadb:10.11 DB·브라우저(360px)로 확인했다. **QA 부분 재실행은 하지 않음** — 필요하면 배포 후 사용자 확인 단계에서 기준 정하기 흐름을 실제 화면으로 먼저 본다.
- **후속 허용(배포 후 별도 task 후보)**: Reviewer D1(표 이름 부분 문자열 비교)·D2(시험 구멍 4)·D3(동시 정정 `already_voided`; Codex 지적 1 과 동일)·D4(충돌 토스트 보강 — Stage 7 에서 해소)·D5(`validate.ts` 첫 묶음 앞 0 허용)·D6(울타리가 별칭 변수 비교 못 봄, 기존 한계)·E1(`feed.rules` 배선 시험 없음)·E2(원화 비교 기준이 `free`)·F1(합계 반올림 방향 시험)·F2(`existingId` 타입 방어 시험)·Codex 지적 2(`LedgerDataError` 메시지 노출)·QA D-3(미래 시각 오류 해제)·D-5(API 메모 제어문자). **설계 전제 기록(L3)**: 원장·기준은 회원별이 아니라 계좌 1 전역 — 회원 1명 전제, 회원이 늘면 쓰기 API 를 소유자 한정으로 좁힌다. **L6**: 마이그레이션이 바뀌면 `T074_TEST_DB_PORT` 일회용 DB 시험(24건)을 켜서 돌려야 DDL 회귀를 잡는다(기본 `npm test` 는 건너뜀). **L7**: 설정 화면을 열 때마다 스냅샷 스캔 — T-073 때 요약 전용 응답/캐시 검토.
- **배포 순서(승인 후)**: ① 05:10~08:30 창 ② 사용자 DDL 명시 승인 확인 ③ `mysql < scripts/migrations/T-074-cash-flow-ledger.sql` 운영 적용(멱등, 2회 적용 무해; 코드 배포 전후 어느 쪽이든 안전 — 표가 없으면 API 가 503 `not_migrated`, 설정 행은 "준비 중") ④ 커밋: T-075(훅) 먼저 → T-074(코드+SQL, 메시지에 `T-074`, 마지막 `최종 판정` = 23:21 pass, scope 에 마이그레이션 SQL 포함) → 한 번의 push(=배포 1회, 타 세션 T-040 변경은 스테이징 제외) ⑤ `RELEASE_RESULT ok` ⑥ 설정 → '자산 기록' 행이 "손익 기준이 아직 없습니다"로 바뀌었는지 사용자 확인. **롤백**: 코드는 이전 릴리스(`20261023-051045-fa0669c9`)로, DDL 은 `DROP TABLE cash_flow_ledger` 와 `system_config` 키 2개 삭제(기록이 있으면 먼저 백업).
- **사용자 안내(승인 요청에 반드시 포함)**: 기준 정하기에서 **달러 현금 칸은 KIS 달러 불일치($1,918.60 대 $118.60) 해소 전에는 비워 저장** — 채우면 약 +238만원 가짜 수익이 손익에 상수로 남는다(경고가 뜨지만 막지는 않음).
- **배포 기록 (2026-10-24, 사용자 승인: "T-074에 대하여 배포 순서대로 배포 진행해주고…")**: 토요일(국내·미국 장 모두 폐장)이라 표준 창(05:10~08:30) 밖인 08:58~09:02 에 진행 — 사용자 직접 지시. ① 사전 확인(읽기 전용): `cash_flow_ledger` 없음·`accounts`(id int(11), 1행)·대기 시그널 0·미체결 주문 0·원장 설정 키 없음. ② **DDL 08:59:24** — 운영 MariaDB 10.11.11 에 `mysql --defaults-extra-file < scripts/migrations/T-074-cash-flow-ledger.sql`(Reviewer 가 검증한 경로 그대로, sha `ab17ad46d6a5`), 2회 적용 모두 OK(멱등), 구조 컬럼 25·PK 1·UNIQUE 3·FK 2·CHECK 5·행 0(Reviewer 의 10.11 일회용 DB 결과와 동일). 임시 접속 파일 삭제. ③ **커밋 `330314e`**(70파일 = 기대 목록과 정확히 일치·범위 밖 0, 훅 "Reviewer 감사 기록 확인: T-074") → ④ push 09:00:15 → ⑤ **릴리스 `20261024-090050-330314e5` `RELEASE_RESULT ok`**(09:02, 직전 `20261024-051605-45572784`). ⑥ 사후 확인: pm2 stockinvest·stockinvest-cron online·재시작 0, `/login` 200·`/settings`·`/settings/cash-ledger` 307→로그인·`/api/cash-ledger*` 무인증 401(503 아님=표 인식), 원장 행 0·`cash_ledger_*` 키 없음·배포 후 주문 0건, pm2 err 로그는 부팅 배너뿐. **미확인**: 로그인한 화면에서 첫 조회가 "손익 기준이 아직 없습니다"로 바뀌는지(사용자 확인), 갤럭시 실기기.
- **롤백(변동 없음)**: 코드 → 릴리스 `20261024-051605-45572784`, 표 → `DROP TABLE IF EXISTS cash_flow_ledger` + `system_config` 키 `cash_ledger_baseline`·`cash_ledger_candidate_marks` 삭제(기록이 있으면 먼저 백업).

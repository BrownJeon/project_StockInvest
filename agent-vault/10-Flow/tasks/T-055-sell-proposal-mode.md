---
task_id: T-055
title: 매도 제안 모드 — 조건 충족 시 매도 시그널을 만들고 사람이 건별 승인해야 실행 (자동 매도 없음) · 설계안 + 현 포지션 영향 분석
status: in-progress
priority: high
roles_involved: [leader, analyst, developer, reviewer, qa]
related_tasks: [T-015, T-042, T-043, T-047, T-049, T-041, T-046, T-051]
tags:
  - type/task
  - domain/strategy
  - domain/safety
aliases:
  - 매도 제안 모드
  - sell proposal mode
  - 청산 제안
created: 2026-10-19
updated: 2026-10-19
---

# T-055 — 매도 제안 모드 (청산 제안, 사람 승인) 설계안

> **이 문서는 코드를 쓰기 전에 사용자 승인을 받기 위한 계획서다.** 앱 소스·운영 DB·설정은 아직 아무것도 바꾸지 않았다. 아래 수치는 2026-10-19 읽기 전용 조회(스냅샷·`position_state`·`eval_funnel`·`orders`)와 코드 읽기로만 얻었고, KIS 호출은 하지 않았다. 사용자가 고른 방향은 **(b) 시그널 생성 + 건별 사람 승인** 이며, (a) 현상 유지·(c) 자동 재가동은 다루지 않는다. 마지막 §6 의 질문에 답을 주면 Leader 가 구현 task 로 넘긴다.

관련 이력: [[T-015-disable-auto-exit-engine]](자동 청산 전면 중단·fail-closed 스위치) · [[T-042-telegram-approval-buttons]](승인 알림·버튼) · [[T-043-entry-watcher-preorder-claim]](주문 전 선점) · [[T-047-poller-hardening]](폴러) · [[T-049-dashboard-executing-label]](표시 문구) · [[T-041-killswitch-composition-guard]](킬스위치 구성 변화 가드) · [[T-051-entry-cash-precheck]].

---

## 0. 먼저 알아야 할 불편한 사실 3가지

1. **[확실] 지금 코드의 청산 임계값(하드 손절 −1.5%)을 그대로 "제안"으로 바꾸면 보유 5종목 전부가 첫 틱에 제안 대상이 된다.** 5종목이 이미 −6.6% ~ −51% 이고, 엔진 자신이 매 틱 `eval_funnel` 에 "꺼져 있지 않았다면 발화했다(`exit_engine_disabled`, wouldHaveFired)"를 남기고 있다(10-19 국내 61틱 × 2종목, 10-17 해외 50틱 × 3종목). 즉 이 작업의 핵심은 "시그널을 만드는 배관"이 아니라 **어떤 조건에서 제안할 것인가(§3)** 와 **같은 제안을 하루에 몇 번 들이밀 것인가(§2)** 다.
2. **[확실] 승인 = 실제 주문이다.** `safety_dry_run=false`(2026-10-18 18:22 갱신)·`safety_kill_switch=false`·`KIS_MOCK=false`. 매도는 1회·일일 한도·변동폭 가드를 **통과하지 않는다**(`src/lib/safety/dry-run.ts:173-199` — 청산 우선 정책). 승인 뒤 되돌릴 방법은 없다(체결 전 취소만 가능하고 그 UI 도 없다).
3. **[확실] 승인 인프라에 매수 전용 가정이 박힌 곳이 있고, 그중 하나는 제안 시그널을 승인 없이 바로 주문으로 보낸다.** `src/lib/signals/router.ts:253,283-285` — `indicators.exit_kind` 가 `hard_stop`·`eod_loss_cut` 이면 모드와 무관하게 `auto_submit`. T-015 는 이 분기를 의도적으로 두었다(생산자가 없어 도달 불가). 제안 모드가 기존 `buildSellSignal` 출력을 그대로 `createSignal` 에 넣으면 **이 분기가 되살아난다.** 구조적으로 막는 방법을 §2.1 에 적었다.

---

## 1. 현황 정리

### 1.1 exit-engine 이 무엇을 어떤 임계값으로 판정하는가

판정기는 순수 함수 `evaluateExit` 하나다(`src/lib/strategy/exit-engine.ts:61-158`). 우선순위대로 **첫 매칭 하나만** 발화한다.

| 순서 | 종류(`exit_kind`) | 조건 | 임계값 출처 | 현재 실효값 |
|---|---|---|---|---|
| 1 | `eod_loss_cut` | 국내 + KST 15:20~15:29(`isEodWindowKST` :164-170) + 손익 ≤ −`eodLossCutPct` | `style.eodLossCutPct` (`style.ts:107`) · DB `style_default_eodLossCutPct` 키 없음 | **−1.5%** |
| 2 | `hard_stop` | 손익 ≤ −`hardStopPct` (시나리오 있으면 `stopHi`) | `style.ts:106`, 범위 `[0.3, 10]`(:146) · DB 키 없음 | **−1.5%** |
| 3 | `hard_stop`(시나리오 stopLo) | 시나리오 포지션 전용 | `position_state.scenario_exit` | 5종목 모두 null → 해당 없음 |
| 4·5 | `target_profit` | 손익 ≥ `targetProfitPct`(시나리오 targetHi/targetLo) | `style.ts:99` · DB 키 없음 | **+2.5%** |
| 6 | `trailing_stop` | 고점 수익 ≥ `trailingActivatePct` **이고** 고점 대비 ≥ `trailingDrawdownPct` 하락 | DB override 있음 | **활성 3.5% / 풀백 1.2%** |

- 단위 안전장치: `price/entry` 비율이 `[0.3, 3.0]` 밖이면 거부(:35-36, :78-86) — 2026-05-13 USD/KRW 불일치 사고 재발 방지. 000660 의 비율 0.49 는 범위 안이라 **데이터 오류로 걸러지지 않는다.**
- 보유기한: `holding_deadline` 은 `holding-checker`(`src/app/api/cron/holding-checker/route.ts`)가 **알림만** 보내고 매도 시그널을 만들지 않는다. 5종목 모두 null.
- 발화 결과(`buildSellSignal` :198-219): `side='sell'`·`orderType='market'`·`quantity=보유 전량`·`amountKRW=수량×현재가`·`indicators.exit_kind/entry_price/current_price/peak_price/pnl_pct`·`strategyId='exit-engine-v1'`.

### 1.2 엔진 실행 사슬과 T-015 스위치의 위치

`src/lib/strategy/engine.ts` `runExitEngine`(:721-939), 호출자는 strategy-eval 틱(:1152-1154, 5분 주기 `scripts/cron-runner.sh:104-106`, 장중만 :1121).

```
readExitEngineSwitch (:732, fail-closed)
 → 잔고 모름이면 전부 중단 (:745-753)
 → reconcilePositionState (:760)          ← 계속 동작
 → 종목별 kis.getTicker (:792)
 → upsertPositionState 고점 갱신 (:805)     ← 계속 동작
 → 단위 불일치 계측 (:819-826)
 → evaluateExit (:828)                    ← 계속 동작 (부작용 없음)
 → 🔕 마스터 게이트 (:847-860) → eval_funnel 'exit_engine_disabled' + 12h 스로틀 알림 (:925-936)
 → hard_stop 개별 스위치 (:863-867)  → exit 쿨다운 15분 (:876-883) → createSignalGuarded (:886) → 쿨다운 설정 (:891)
```

[확실] 운영 DB 현재값: `exit_engine_enabled=false`(10-18 18:22:17 갱신), `exit_hard_stop_enabled=false`(07-02), `autopilot_mode="assist"`, `engine_enabled=true`, `hybrid_mode_enabled=true`, `notify_signal_pending=true`, `notify_channel="telegram"`, `safety_order_max_pct=6`, `safety_daily_order_max_pct=10`. `telegram_approval_enabled`·`telegram_poller_enabled` **키 없음(=꺼짐)**. env(운영 release 동일): `SIGNAL_DEFAULT_TTL_MIN=30`, `SIGNAL_AUTO_SUBMIT_MAX_KRW=50000`, `DRY_RUN=true`(그러나 DB `safety_dry_run=false` 가 우선 — `dry-run.ts:32-69`).

꺼진 상태에서도 계속 도는 것: 고점·진입가 추적, reconcile, 평가+깔때기 기록, 12시간 1회 "🔕 자동 청산 OFF — 청산 조건 N건" 경보, holding-checker 알림, 룰 전략의 일반 매도 시그널(`rsi-overbought-exit-v1` 등 — 승인 경로; 최근 발화는 09-30 만료 1건이 마지막).

> [확실] **(c) 를 택했다면 어땠나(참고)**: 오늘 `exit_engine_enabled=true` 로만 바꾸면 `exit_hard_stop_enabled=false` 라 hard_stop 은 건너뛰고, **15:20 에 000660·005930 두 종목에 EOD 시장가 매도가 승인 없이 자동 송신**된다(`router.ts:283` 강제 auto). 해외 3종목은 트레일링 미활성·EOD 미적용이라 아무 일도 없다. 사용자가 (c) 를 택하지 않은 판단과 부합한다.

### 1.3 승인 인프라를 매도 시그널에 그대로 쓸 수 있는가 — 매수 가정이 박힌 곳 전수

흐름: `createSignal`(`src/lib/signals/service.ts:320`) → `routeSignal` → `awaiting_approval` INSERT(:387-406) → `notifyApprovalRequest`(:430-446) → 사람이 앱 `POST /api/signals/:id/approve`(또는 텔레그램 버튼, 지금은 꺼짐) → `resolveApprovalPath`(zone 없으면 immediate) → `approveSignal`(:516) → `claimAwaitingSignal('executing')`(:563) → `submitOrder`(:570) → `approved`+`consumed_order_id`(:640).

| # | 위치 | 가정·결함 | 제안 모드에 미치는 영향 | 대응 |
|---|---|---|---|---|
| A | `router.ts:253,283-285` `FORCED_AUTO_EXIT_KINDS` | `exit_kind∈{hard_stop,eod_loss_cut}` → **승인 없이 auto_submit** | 🔴 제안이 `exit_kind` 를 그대로 쓰면 자동 매도 부활 | §2.1 구조적 차단 |
| B | `router.ts:290-303` auto 모드 | 금액 ≤ 50,000 이면 auto. 지금 assist | 모드가 바뀌어도 제안은 항상 pending 이어야 함 | §2.1 |
| C | `service.ts:374-386` 중복 방지 | 활성 집합 = awaiting+detected 만(`expires_at > NOW()`) | **승인돼 주문이 미체결(`approved`/`executing`)인 동안 같은 종목에 두 번째 제안 생성 가능** | §2.4 이중 매도 방지 |
| D | `service.ts:516-654` `approveSignal` | side 무관하게 동작. **저장된 `price`로 주문**, 보유 수량 재확인 없음, 제안 당시 조건 재평가 없음 | 지정가면 가격 노후, 이미 청산된 포지션도 주문 시도(KIS 가 `주문가능수량` 로 거부 → `order_not_accepted`, 시그널은 대기로 복귀) | §2.3·§2.5 |
| E | `approval-transitions.ts:74-82` | `indicators.ai.scenario.entry.price_zone` 있으면 hybrid(진입 감시) | 제안에 zone 이 섞이면 매도가 "진입 감시"로 가 의미 오류 | 제안 indicators 에 `ai.scenario` 금지(테스트) |
| F | `entry-watcher/route.ts` | side 는 그대로 쓰지만 "진입"·현금 사전점검(T-051) 등 매수 전제 | 제안은 이 경로를 타면 안 됨 | E 로 보장 |
| G | `dry-run.ts:173,183,192`·`order-limits.ts:131` | **매도는 1회·일일 한도·변동폭 가드 제외.** 킬스위치(:150)·블랙리스트(:156)·DRY_RUN(:202)은 적용 | 매도 금액 상한 없음(MU 1,317만 원 1건 가능). 킬스위치 ON 이면 승인해도 `kill_switch` 거부 → 대기 복귀 | §2.6 |
| H | `approval-context.ts:116-117` | 매도는 항상 "실행 가능", 계좌 맥락(총자산·현금) 없음 | 메시지에 총자산 비중이 안 실림 | §2.7 문구 |
| I | `approval-notify.ts:69-102`·`approval-message.ts:41-46,108-122,190-194` | 간단 본문은 "매도 ₩X · TTL N분 / 유형 / 사유" — **손익·되돌릴 수 없음 없음.** 버튼 본문 "승인하면 지정가 주문 (신호가 기준)"(시장가 매도여도)·결과 "지정가" | 제안 전용 문구 필요 | §2.7 |
| J | `ApprovalQueue.tsx:68-80,135-138` | `price` 라벨 **"진입가"**, "주문 금액", 승인 버튼 즉시 POST(확인 대화상자 없음) | 매도 제안에 "진입가" 표기·원탭 실주문 | §5 화면 변경(데모 게이트) |
| K | `service.ts:737-747` `rejectSignal` | 거절 쿨다운 `scope:'entry'` 4h | exit 쿨다운(scope `'exit'`, 15분)과 **다른 키** → 거절해도 15분 뒤 재제안 | §2.2 재제안 정책 |
| L | `kis-overseas.ts:348-371` | 해외 시장가 미지원 → 지정가 ×0.995, **fx 실패 시 1400 고정 폴백(:350)** | 해외 "시장가" 매도는 사실상 −0.5% 지정가. 가격이 그 사이 더 내리면 미체결 | §2.5 |
| M | `kis-domestic.ts:231`·`kis-overseas.ts:281` | 보유 수량 = `hldg_qty`/`ovrs_cblc_qty`(**주문가능수량 아님**) | 미체결 매도 주문 수량이 보유에 그대로 포함 → C 와 결합 시 수량 초과 주문 시도 | §2.4 |
| N | `kis-overseas.ts:287-293`·`position-state.ts:121` | 해외 진입가 = USD 평단 × 잔고 시점 fx, 매 틱 덮어씀 | 손익% 은 **FX 중립**(가능성 높음: 시세도 같은 5분 캐시 fx). 원화 손익은 환율 변동분만큼 다름 | §2.7 두 값 병기 |
| O | `signals.status` ENUM | 제안 전용 상태 없음. `superseded` 존재 | awaiting_approval 재사용 + `strategy_id` 구분, 철회는 superseded | §2.3 |
| P | `kill-switch.ts:214-216` 주석 + 10-03~05 스냅샷 실측 | **해외 매도 대금(USD)이 스냅샷 총자산에 잡히지 않는다**(10-03 SNPS 매도 뒤 총자산 23.5M→6.53M 로 보임, 10-05 재매수 때 복귀) | MU(64%) 매도 승인 뒤 총자산이 −64% 로 보이고 1회·일일 한도(평가액 비례)도 줄어든다. T-041 가드는 "순수 소실 → 발동 보류 + critical"로 처리(가능성 높음) | §4·§5 위험 |

[확실] **결론**: 배관(생성→대기→승인→선점→주문→기록)은 side 에 중립이라 재사용 가능하다. 단 A 는 반드시 구조적으로 막아야 하고, C·D·K·J·I 는 "제안" 의미에 맞게 손봐야 한다. 텔레그램 버튼은 꺼져 있으므로 **1차는 앱 승인만**이다(간단 본문 알림은 간다).

---

## 2. 설계 옵션 비교와 권고

### 2.1 옵션 (i) 기존 판정 재사용 vs (ii) 새 판정기

| | (i) `evaluateExit` 재사용, 시그널만 생성 | (ii) 제안 전용 판정기 `evaluateSellProposal` + 배관 재사용 |
|---|---|---|
| 임계값 | `style.hardStopPct` 등 엔진 파라미터 공유. `hardStopPct` 상한 10%(`style.ts:146`) → **−20% 같은 값 설정 불가** | 제안 전용 키(`sell_proposal_*`), 범위 독립 |
| 자동 엔진 재가동 시 | 제안용으로 바꾼 임계값이 자동 엔진에도 적용됨(결합) | 분리. 자동 엔진은 T-015 상태 그대로 |
| 강제 auto 분기(A) | `exit_kind` 그대로 → 추가 차단 필수 | indicators 키를 달리해 **생산 시점부터 분기 자체를 밟지 않음** |
| 재사용 범위 | 거의 전부 | 보유 조회·시세·`position_state`·`createSignal`·승인·알림 전부 재사용, 판정 함수와 임계값만 신규 |
| 코드량 | 작음 | 판정기 ~150줄 + 테스트 |

**[가능성 높음] 권고: (ii).** 근거는 두 가지 코드 사실이다 — ① `hardStopPct` 범위 상한 10% 라 이미 −25%·−51% 인 포지션에 맞는 임계값을 (i) 로는 넣을 수 없다. ② (i) 는 강제 auto 분기를 "막는 코드 한 줄"에 의존하는 반면 (ii) 는 그 분기의 입력(`exit_kind`)을 만들지 않는다. 다만 **배관은 (i) 처럼 전부 재사용**한다 — 새 주문 경로를 만들지 않는다(analyst 계약 3항).

**구조적 차단(둘 다 적용, 방어 3겹)**:
1. 제안 시그널은 `strategyId='sell-proposal-v1'`, indicators 에 `exit_kind` 를 **쓰지 않고** `proposal: { kind, entry_price, current_price, pnl_pct, reference_price, trigger }` 를 쓴다. → `readExitKind` 가 null → 강제 auto 불가.
2. `routeSignal` 에 명시 규칙 추가: `strategyId === 'sell-proposal-v1'` 이면 switches·금액과 무관하게 `pending_approval/awaiting_approval`. 단위 테스트가 auto·assist·manual 세 모드 × forced exit_kind 주입 변이에서 모두 pending 임을 고정.
3. 생산자가 `createSignal` 결과의 `autoSubmitted===true` 를 받으면 **예외 + critical 경보**(도달 불가여야 하는 경로의 감시).

### 2.2 제안 생성 주기·중복·만료·재제안

- **평가 주기**: strategy-eval 틱(5분, 장중)에 `runExitEngine` 과 같은 자리에서 돈다(보유·시세·state 를 이미 가진 지점, `engine.ts:828` 직후). 마스터 스위치 OFF **그리고** 새 스위치 `sell_proposal_enabled=true` 일 때만. 둘 다 true 면 자동 엔진이 우선이고 제안은 만들지 않는다(두 경로가 같은 종목에 동시에 나가는 것 금지).
- **같은 종목 활성 제안 1건**: 기존 중복 방지(C) + **추가로 `approved`/`executing` 이고 `consumed_order_id` 의 주문이 `accepted`/`partially_filled`(미체결) 인 행도 활성으로 본다** (§2.4).
- **만료(TTL)**: 기본 30분(`SIGNAL_DEFAULT_TTL_MIN`)은 제안에 너무 짧다 — 사용자가 장중에 폰을 못 볼 수 있다. 권고: **해당 시장의 당일 장 마감까지**(국내 15:30 KST, 해외 ET 16:00). 장 마감 뒤 만료된 제안은 `signal-expiry` 가 `expired` 처리(`EXPIRABLE_STATUSES` 포함, `statuses.ts:63-66`). 다음 거래일에 조건이 유지되면 새 제안.
- **하루 1회 원칙**: 종목당 거래일 1건. 만료 후 같은 날 재생성 금지(생성 시각 기준 KST 날짜 비교 — 해외는 세션 기준일).
- **거절 뒤 재제안(K 해소)**: 거절은 "오늘은 안 판다"로 해석. 이후에는 §3 의 "추가 하락 단계(restep)" 가 충족될 때만 다시 제안한다 — 같은 가격대에서 매일 같은 제안을 반복하지 않는다. **판정 근거는 `signals` 의 마지막 결정 행**(같은 종목 `sell-proposal-v1` 의 최신 `rejected`/`expired`/`superseded` 행과 그때의 `indicators.proposal.current_price` = 기준가)이다. `cooldowns` 테이블(`src/lib/strategy/cooldowns.ts:28-37`, exit 15분·entryRejected 240분)은 **조회 실패 시 fail-open**(:14-17 — 스팸 억제 필터지 안전장치가 아니라는 설계)이라 재제안 억제를 거기에만 맡기면 DB 블립 한 번에 같은 제안이 다시 나간다. 쿨다운은 보조로만 쓴다.
- **가격이 움직였을 때**: 매 틱 활성 제안을 재평가한다. 조건이 해소되면(가격이 임계값 위로 **히스테리시스 1%p** 이상 회복) 제안을 `superseded` 로 닫고 "제안 철회(가격 회복)" 알림 1건. 승인 시점에는 §2.3.

### 2.3 승인 시 주문 방식·가격

- **주문 유형**: 국내 = 시장가(`ORD_DVSN 01`, 즉시 체결). 해외 = KIS 가 시장가를 지원하지 않아 코드가 지정가 −0.5% 로 바꾼다(L). 제안 메시지에 이 차이를 그대로 적는다("해외는 현재가 −0.5% 지정가, 미체결 가능").
- **가격 노후**: `approveSignal` 은 저장된 `price` 를 쓴다(D). 권고: 승인 처리 안에서 **제안 시그널에 한해** 현재가를 다시 조회해(`kis.getTicker`, 승인 경로라 호출 가능) ① 주문 가격 갱신 ② 제안 가격 대비 ±`sell_proposal_approve_drift_pct`(기본 3%) 이상 움직였으면 주문하지 않고 "가격이 바뀌었습니다 — 앱에서 다시 확인" 응답(시그널은 대기 유지). 조회 실패 시 **주문하지 않는다**(fail-closed: 모르면 팔지 않는다 — T-015 원칙과 동일).
- **보유 재확인**: 승인 직전 `getBalancesDetailed()` 로 보유 수량을 다시 읽어 ① 0 이면 `superseded`("이미 청산됨") ② 제안 수량보다 적으면 **적은 쪽으로** 수량 축소(부분 체결·수동 매도 반영) 후 주문. 잔고 조회 실패 → 주문하지 않음.

### 2.4 이중 매도 방지 (T-043·T-046 과의 정합)

- 승인 경로의 선점(`claimAwaitingSignal('executing')`, `service.ts:563`)은 그대로 쓴다 — 웹·텔레그램 동시 승인은 이미 한 쪽만 이긴다.
- 추가 방어(C·M 해소): 생성 시 **같은 종목의 매도 주문 중 `accepted`/`partially_filled`/`pending` 이 `orders` 에 있으면 제안을 만들지 않는다**(`sell_order_open` 스킵 게이트, eval_funnel 기록). KIS 측 `주문가능수량` 거부(`insufficient_qty` 분류, `dry-run.ts:270`)는 마지막 그물이지 설계 근거가 아니다.
- 제안 1건당 주문 1건: `consumed_order_id` 연결 뒤 같은 시그널 재승인 불가(기존 상태 전이).

### 2.5 보유량이 이미 청산됐을 때·해외 종목

- 틱마다 `reconcilePositionState` 가 미보유 row 를 지운다(:760). 제안 생산자는 **활성 제안 중 `position_state` row 가 사라진 종목을 `superseded`** 로 닫고 알림("보유 없음 — 제안 철회").
- 해외: 통화 USD, 장시간 ET 09:30~16:00(KST 22:30~05:00 DST / 23:30~06:00). 알림이 밤에 온다. 제안 TTL 은 세션 마감(ET 16:00). 환율 폴백 1400(L) 은 지정가를 수 % 틀리게 할 수 있다 — 제안 승인 경로에서는 `getUsdKrwRate()` 실패 시 주문하지 않게 한다(폴백 금지).

### 2.6 한도·킬스위치·DRY_RUN 과의 관계

- 매도 한도: 지금 없음(G). **새 한도를 만들지 않는다**(청산 우선 정책 유지) — 대신 제안 메시지에 금액·총자산 비중을 명시한다. 사용자가 원하면 `sell_proposal_max_krw`(건당 상한, 초과분은 수량 축소) 를 선택지로 둔다(§6 Q4).
- 킬스위치 ON: `submitOrder` 3단계에서 매도도 차단된다(:150). 승인하면 `order_not_accepted: kill_switch` 로 대기 복귀. 제안 생성 자체는 막지 않는다(사람이 판단할 정보는 계속 준다).
- DRY_RUN ON 이면 `dry_run` 주문으로 끝난다 — 운영 DB 는 **false** 라 실주문이다. 시험 단계에서는 DB `safety_dry_run=true` 로 돌려 전 경로를 통과시킬 수 있다(§5 시험).

### 2.7 알림·화면 문구 (승인 요청 본문)

간단 본문(텔레그램 스위치 OFF 시에도 가는 형식, `renderPlainRequest`)에 제안 전용 줄을 추가한다. 모든 동적 값은 기존처럼 `h()` 이스케이프.

```
📩 매도 제안: 마이크론 (NAS:MU)
매도 11주 · 현재가 ₩1,197,425 (USD −15.8%, 진입 ₩1,422,003)
금액 ₩13,171,672 (총자산의 64.2%) · 평가손실 −₩2,470,364
사유: [손절 제안] 손익 −15.8% ≤ −6% (sell_proposal_stop_pct)
주문: 해외 지정가(현재가 −0.5%) · 체결 시 되돌릴 수 없음
만료: 05:00 KST (세션 마감) · 승인은 앱에서 — 설정 > 전략 > 승인 대기
```

- "되돌릴 수 없음"·손익·비중은 필수. 총자산은 최신 스냅샷(3시간 이내, `approval-context.ts:38`)에서 읽되 모르면 적지 않는다(기존 원칙).
- 앱 `ApprovalQueue`: 매도 제안 카드에 "진입가"→"제안가/진입가" 라벨 교정, 손익·비중 줄, **승인 버튼은 확인 단계 1회**("11주 시장가 매도, 되돌릴 수 없음 — 승인"). 이 둘은 화면 변경이라 데모 게이트 대상(§5).

---

## 3. 임계값 제안과 현 포지션 읽기 전용 시뮬레이션

### 3.1 현 포지션 (진입가 = `position_state`, 가격 = 스냅샷)

| 종목 | 수량 | 진입가(₩) | 10-17 23:53 가격 | 손익% | 평가손익(₩) | 10-19 17:15 가격 | 손익% | 비중(10-17) |
|---|---|---|---|---|---|---|---|---|
| 000660 | 1 | 2,641,000 | 1,265,000 | **−52.10%** | −1,376,000 | 1,294,000 | −51.00% | 6.3% |
| 005930 | 9 | 331,500 | 217,000 | **−34.54%** | −1,030,500 | 220,000 | −33.63% | 9.7% |
| NAS:MU | 11 | 1,422,003 | 1,170,703 | **−17.67%** | −2,764,300 | 1,197,425 | −15.79% | **64.1%** |
| NYS:ORCL | 6 | 230,680 | 170,815 | **−25.95%** | −359,190 | 173,042 | −24.99% | 5.1% |
| NAS:SMH | 4 | 787,191 | 719,054 | **−8.66%** | −272,548 | 735,237 | −6.60% | 14.3% |
| 합계 | | 취득원가 25,799,381 | 평가 19,996,839 | **−22.49%** | −5,802,542 | | | 현금 80,138 |

트레일링·익절 상태: MU 고점 1,457,686 → 고점 수익 +2.51% < 활성 3.5% → 미활성. 나머지 4종목은 고점 < 진입가. 익절 대상 없음. 시나리오·보유기한 전부 null.

### 3.2 코드의 현 임계값을 그대로 적용하면

| 임계값 | 대상 | 근거 |
|---|---|---|
| hard_stop −1.5% | **5종목 전부** | 가장 작은 손실 SMH 도 −6.6% |
| eod_loss_cut −1.5% (15:20~15:29) | 000660·005930 | 국내만 |
| trailing 3.5%/1.2% | 없음 | 활성 조건 미충족 |
| target +2.5% | 없음 | |

[확실] 엔진 자신의 기록이 이를 확인한다 — `eval_funnel` `exit_engine_disabled`(wouldHaveFired): 10-19 000660·005930 각 61틱(09:05~15:29, 15:20 이후 `eod_loss_cut`), 10-17 MU·ORCL·SMH 각 50틱(00:05~04:55 KST). SMH 는 10-13 까지 `exit_no_fire`(60틱) 였다가 10-14 에 −1.5% 를 넘어 `exit_engine_disabled` 로 바뀌었다(38→27→65틱). 즉 (i) 그대로면 **켜는 첫 틱에 5건 제안**이 생기고, 이후는 §2.2 의 재제안 규칙이 없으면 만료마다 반복된다.

### 3.3 임계값 제안 (제안 전용 키, 자동 엔진과 분리)

| 키 | 의미 | 권고 기본값 | 근거 |
|---|---|---|---|
| `sell_proposal_stop_pct` | 진입가 대비 손실이 이 값 이상이면 제안 | **6** | `docs/trading-strategy.md:90` — swing 기본 −3%, 개별 조정 상한 −6%. 문서가 정한 "허용 최대 손절폭"을 그대로 쓴다. 코드의 1.5% 는 엔진이 스스로 진입한 1~10일 포지션용이라 지금 포지션과 척도가 다르다 |
| `sell_proposal_restep_pct` | 거절·만료 뒤 **기준가**(그때 가격) 대비 추가 하락이 이 값 이상이면 재제안 | **5** | 같은 가격대 반복 제안 방지. "−6% 에서 안 팔았으면 −11% 에서 다시 묻는다" |
| `sell_proposal_rebound_exit_pct` | 제안 뒤 가격이 임계값 위로 이만큼 회복하면 제안 철회(히스테리시스) | **1** | 경계에서 생성·철회가 떨리는 것 방지 |
| `sell_proposal_approve_drift_pct` | 승인 시 제안가 대비 괴리가 이 값 이상이면 주문 보류 | **3** | §2.3 |
| `sell_proposal_concentration_pct` | 단일 종목 비중이 이 값 이상이면 **비중 축소** 제안(부분 매도) | 50 (**3단계에서만**) | MU 64%. 부분 매도는 수량 편집 UI 가 필요(§5) |
| `sell_proposal_daily_max` | 하루 최대 제안 건수(알림 피로) | 5 | 보유 종목 수 |

[가능성 높음] 이 기본값으로 **첫 활성화 시 제안 대상은 여전히 5종목 전부**다(SMH −6.6% ≥ 6%). 이것은 임계값의 문제가 아니라 포지션 상태의 사실이다. 그래서 §6 Q2 에서 "첫 일괄 검토"를 별도로 묻는다 — 첫날 5건을 한 번에 받고 건별로 결정한 뒤, 이후는 restep 규칙으로만 다시 묻는 방식을 권한다.

### 3.4 진입가 검증 — 제안을 만들기 전에 필요한가

**[확실] `orders`/`trade_logs` 대조는 불가능하다.** 보유 5종목에 대해 이 앱이 낸 `accepted`/`filled` 주문은 **0건**이다(실측). 000660·005930 은 08-06·08-07 킬스위치로 막힌 EOD 매도 시도 2건씩, MU 는 05-18~22 `dry_run` 매도 131건(05-13 단위 사고 시기), SMH 는 04-29 차단 3건뿐이다. 5종목 모두 **앱 밖(HTS/MTS)에서 산 포지션**이다.

**[확실] 진입가의 출처는 KIS 잔고의 `pchs_avg_pric`(증권사 매입평균단가)다** — `kis-domestic.ts:233`, `kis-overseas.ts:287`. 앱이 계산한 값이 아니라 증권사 기록이다.

**[가능성 높음] 000660 −52% 는 데이터 오류가 아니라 실제 가격 경로다.** 스냅샷 가격 이력: 000660 은 06-24 처음 관측(2주, 2,691,000) → 06-30 최고 2,724,000 → 10-19 최저 1,221,000. 07-02 의 엔진 시그널도 "매수단가 ₩2,641,000 → 현재 ₩2,279,000, −13.71%" 로 같은 진입가를 쓰고 있다(signals #9146). 005930 도 06-30 326,500~339,750 에서 처음 보이고 진입가 331,500 과 맞는다. MU 는 10-05 23:44 첫 관측가 1,429,921 vs 진입가 1,422,003(그 사이 10-03 SNPS 23주 매도 → MU 11주·KO 21주 매수 가 스냅샷에 보인다). SMH 는 10-12 재매수 4주. 단위 비율도 전부 [0.3, 3.0] 안이다.

남는 불확실성과 권고 검증(둘 다 읽기 전용, 5분):
1. 사용자가 KIS MTS 잔고 화면의 **매입평균단가 5개**를 눈으로 대조한다(증권사 UI ↔ `position_state`). 평단은 분할 매수·일부 매도 뒤 사용자가 기억하는 값과 다를 수 있다(000660 은 06-25 2주→1주 흔적).
2. 1단계 시뮬레이션 리포트(§5)에서 `getBalancesDetailed()` 원본(`pchs_avg_pric`·수량)과 `position_state` 를 나란히 찍어 둔다 — 코드가 매 틱 덮어쓰므로 지금은 같을 것이지만 기록으로 남긴다.
3. 해외는 **USD 손익%와 원화 평가손익을 병기**한다(N). 진입가(원화)는 환율에 따라 매 틱 바뀌는 값이라 "진입가 ₩1,422,003" 하나만 보여 주면 오해를 낳는다.

[확실] 결론: **진입가 검증을 제안 생성의 선행 차단 조건으로 둘 필요는 없다**(증권사 값이고 가격 이력과 정합). 단 ①은 1단계에서 사용자가 한 번 해 주면 좋고, 제안 본문에는 진입가와 함께 "KIS 매입평균 기준"을 적는다.

---

## 4. 포트폴리오 위험 관찰 (읽기 전용 — 사실과 메커니즘)

### 4.1 총자산 −18.1% (10-08 → 10-17) 의 종목별 기여

10-08 23:12 24,499,965 → 10-17 23:53 20,076,977, **−4,422,988**. 그 사이 보유 구성이 바뀌었다(KO 21주·V 2주 매도 → SMH 4주 매수, 앱 밖 거래; 현금은 80,138 로 변동 없음 = 매도 대금을 전부 재투자).

| 요인 | 금액(₩) | 기여 |
|---|---|---|
| NAS:MU 11주 가격 하락 (1,433,687 → 1,170,703) | −2,892,824 | **65.4%** |
| KO+V(3,457,972) → SMH(2,876,217) 교체 (실현 손익 + SMH 10-12 이후 하락 −272,548 포함) | −581,755 | 13.2% |
| 000660 (1,686,000 → 1,265,000) | −421,000 | 9.5% |
| 005930 (263,000 → 217,000) | −414,000 | 9.4% |
| NYS:ORCL (189,717 → 170,815) | −113,409 | 2.6% |

10-19 17:15 총자산 20,505,010(+2.1%, MU 반등). 데이터 주의: 10-03 04:16~10-05 22:32 스냅샷의 6.53M 은 SNPS 매도 대금(USD)이 집계에서 빠진 **관측 오류**이지 실제 자산이 아니다(P). 같은 이유로 10-03 킬스위치 오발동이 있었고 T-041 이 가드를 넣었다.

### 4.2 집중도 64% 가 뜻하는 것

- MU 가 ±10% 움직이면 총자산이 ±6.4% 움직인다. 10-08→10-17 의 MU −18.3% 가 총자산 −11.8%p 를 설명한다.
- 취득원가 기준으로도 MU 가 15.64M / 25.80M = 60.6% — **진입 시점부터 집중**이었다(앱의 1회 한도 6%·일일 10% 는 앱이 내는 매수에만 적용되고, 이 포지션은 앱 밖에서 들어왔다).
- 전체 미실현 손실 −5.80M 중 MU 가 −2.76M(47.6%), 000660 −1.38M(23.7%), 005930 −1.03M(17.8%).

### 4.3 이 앱이 제어할 수 있는 것과 없는 것

| 할 수 있다 | 할 수 없다 |
|---|---|
| 조건 충족 시 **제안**하고 사람이 승인하면 주문을 낸다(이 작업) | 가격·환율을 바꾸지 못한다. 매도는 손실을 **확정**할 뿐 회복을 만들지 않는다 |
| 앱이 내는 신규 매수의 1회·일일 한도(평가액 6%/10%) | 앱 밖(MTS) 매수·매도 — 5종목 전부 그 경로로 들어왔다 |
| 포트폴리오 급락 시 킬스위치(전 주문 차단) | 이미 보유한 종목의 하락을 막지 못한다 |
| 집중도·손익 **알림**(지금은 12시간 1회 "청산 OFF" 경보뿐) | 매도 뒤 USD 대금은 스냅샷에 잡히지 않아 총자산이 과소 표시된다(P) — 고치기 전까지 화면·한도·킬스위치 판단이 왜곡 |

[확실] 매도 제안은 "손실을 더 키우지 않을 선택지를 제때 보여 주는 도구"다. 수익이나 손실 축소를 보장하지 않으며, 승인 직후 반등하면 그 기회는 사라진다. 이 문서는 그 결정을 사용자에게 남기고, 결정에 필요한 숫자(손익·비중·주문 방식·되돌릴 수 없음)를 빠짐없이 보여 주는 것까지가 앱의 역할이라고 본다.

---

## 5. 구현 계획 초안

### 5.1 단계

| 단계 | 내용 | 주문 가능성 | 화면 변경 |
|---|---|---|---|
| **1. 읽기 전용 시뮬레이션** | 새 판정기 + 제안 전용 임계값을 넣되 **시그널을 만들지 않고** `eval_funnel` 게이트 `sell_proposal_preview`(verdict pass/skip, detail: kind·pnl·threshold)만 기록. 하루 1회 텔레그램 요약("제안 시뮬레이션: 오늘 N건 — 종목·사유") + `getBalancesDetailed` 원본 대조 1회 기록 | 없음 | 없음 |
| **2. 시그널 생성 + 앱 승인** | `sell_proposal_enabled` 스위치(fail-closed, 기본 false) ON 시 제안 시그널 생성·간단 본문 알림·앱 승인(확인 단계·문구 교정)·승인 시 재조회(§2.3)·이중 매도 게이트(§2.4)·거절 쿨다운(§2.2) | **있음**(승인 시) | 있음 — ApprovalQueue 카드·확인 단계, 설정 토글 1개 |
| **3. 텔레그램 버튼·부분 매도** | [[T-042-telegram-approval-buttons]] 스위치를 켠 뒤 제안에도 버튼. 비중 축소(부분 매도) 제안 + 수량 편집 | 있음 | 있음 — 수량 편집 UI |

1→2 전환 조건: 1단계 리포트가 **3거래일 이상** §3.3 임계값대로 나오고(대상·사유가 사용자 예상과 일치), 사용자가 §6 답을 준 뒤.

### 5.2 변경 파일 후보 (🔒 = 커밋 훅 안전 경로, Reviewer 판정 scope 필요)

| 파일 | 변경 | 단계 |
|---|---|---|
| 🔒 `src/lib/strategy/sell-proposal.ts` (신규) | 순수 판정기 `evaluateSellProposal(state, ticker, policy, lastDecision)` — 입력·출력 형식은 `evaluateExit` 와 대칭, `exit_kind` 를 만들지 않음 | 1 |
| 🔒 `src/lib/strategy/sell-proposal-policy.ts` (신규) | `system_config` `sell_proposal_*` 판독(fail-closed, 범위 검증), `sell_proposal_enabled` 스위치 판독기(`exit-switch.ts` 패턴 복제) | 1 |
| 🔒 `src/lib/strategy/engine.ts` | `runExitEngine` 마스터 게이트(:847-860) 안에서 미리보기/제안 분기 호출. 생성 성공 시 쿨다운·활성 제안 철회 재평가 | 1·2 |
| `src/lib/strategy/eval-funnel-labels.ts` | 게이트 `sell_proposal_preview`·`sell_proposal_created`·`sell_proposal_withdrawn`·`sell_order_open` + 라벨 | 1·2 |
| 🔒 `src/lib/signals/router.ts` | `sell-proposal-v1` 은 무조건 pending (§2.1-2) | 2 |
| 🔒 `src/lib/signals/service.ts` | `approveSignal` 에 제안 전용 사전 점검(현재가·보유 재조회, 보류 응답 `price_drifted`/`position_gone`), 중복 방지 집합 확장(§2.4), `rejectSignal` exit 범위 쿨다운 | 2 |
| `src/lib/signals/approval-notify.ts`·`approval-message.ts` | 제안 본문·결과 문구(§2.7). 순수 모듈 퍼징 테스트 유지 | 2 |
| `src/lib/signals/statuses.ts` | 변경 없음 — `superseded` 재사용 | — |
| `src/app/strategy/components/ApprovalQueue.tsx` | 매도 제안 카드(라벨·손익·비중·확인 단계) — **데모 게이트** | 2 |
| `src/app/settings/SettingsPage.tsx`·`src/app/api/settings/safety/route.ts` | "매도 제안" 토글 + 임계값 입력 — **데모 게이트** | 2 |
| `src/lib/db.ts` | `sell_proposal_enabled` 부팅 시드 `INSERT IGNORE 'false'`, 임계값 시드 | 1·2 |
| `src/lib/safety/snapshot-composition.ts` 등 | (별건 권고) 해외 USD 예수금을 스냅샷 positions 에 `currency:'USD'` 행으로 수집 — P 해소. 이 task 범위 밖이지만 **2단계 전에** 하는 편이 안전 | 별건 |
| 테스트 | `sell-proposal.test.ts`(경계·히스테리시스·restep·보유 0), `router` 변이(forced exit_kind 주입·auto 모드), `service` 승인 사전 점검, `approval-message` 퍼징, 엔진 레벨(두 스위치 조합 4가지) | 1·2 |

### 5.3 시험 계획

- 단위·변이: 판정기 경계값(−5.99/−6.00/−6.01, 히스테리시스 상하), 거절 뒤 restep(−6 거절 → −10.9 침묵 → −11.0 재제안), 보유 0·수량 감소, 두 스위치 4조합(off/off=아무것도 없음, on/on=자동 엔진 우선·제안 0건), forced auto 변이 3종.
- 통합(가짜 DB, T-043 `fakeSignalsDb` 재사용): 생성→알림→승인→선점→`submitOrder` 1회, 웹+텔레그램 동시 승인 1회만, 미체결 매도 중 재생성 0건.
- 운영 전 리허설: DB `safety_dry_run=true` 로 돌려 제안 1건을 실제로 승인 → `dry_run` 주문·메시지·상태 전이 확인 → 다시 false. (사용자 입회)
- 1단계 관측: 3거래일 `sell_proposal_preview` 집계가 §3.2 표와 일치.
- 킬스위치 시나리오(QA): 제안 승인 → 매도 체결 가정으로 스냅샷에서 종목 제거 → T-041 가드가 "보류 + critical" 인지, 발동인지 실측(P).

### 5.4 위험과 롤백

| 위험 | 완화 | 롤백 |
|---|---|---|
| 제안이 승인 없이 주문으로 감 | §2.1 3겹 + 변이 테스트 | `sell_proposal_enabled=false`(즉시, 캐시 없음) |
| 승인 뒤 가격 급변·미체결(해외 지정가) | 승인 시 재조회·drift 보류 | 미체결 주문은 KIS MTS 에서 취소(앱 취소 UI 없음 — 알려진 한계) |
| 이중 매도 | §2.4 + KIS 주문가능수량 | — |
| MU 매도 뒤 총자산 −64% 표시·한도 축소·킬스위치 판단 왜곡(P) | USD 예수금 수집 선행(별건) 또는 사용자에게 사전 고지 | 수동 확인 |
| 알림 피로 → 승인 습관화(오탭) | 하루 1회·restep·확인 단계 | — |
| 첫 활성화에 5건 동시 | §6 Q2 "첫 일괄 검토" 명시 | 거절 = 다음 거래일까지 침묵 |

### 5.5 데모 게이트·감사·외부 검토·규모

- **데모 게이트**: 2단계의 ApprovalQueue 카드 변경·설정 토글은 `delta`(기존 화면 부분 변경). 1단계는 화면 없음(`none`). judge 접수 때 "화면" 단어 오인(T-043 기록)을 피하려 긍정형으로 적을 것.
- **Reviewer 독립 감사 필수**(안전 경로 🔒 5개). 판정 scope 에 `src/lib/strategy/`, `src/lib/signals/` 포함.
- **Codex**: 2단계 C2(승인 경로·강제 auto 차단)에서 개입 권고 — T-042·T-043 때 실제 결함을 찾아낸 영역이다. 스위치 off 면 "codex검토기능은 지금 off상태입니다" 고지 후 진행.
- 규모(추정): 1단계 소(판정기+정책+깔때기+테스트, 파일 5~6개). 2단계 중(안전 경로 4개 + 화면 2개 + 테스트, 파일 12개 안팎 — light 트랙 범위 초과, standard). 3단계는 T-042 스위치 결정 이후 별도.

---

## 6. 사용자가 결정해야 할 질문 (최소)

| # | 질문 | 선택지 | 권고 | 근거 |
|---|---|---|---|---|
| Q1 | 손절 제안 임계값(진입가 대비) | (a) −3% (b) **−6%** (c) −10% (d) 직접 입력 | **(b)** | `docs/trading-strategy.md:90` 의 허용 상한. 어느 값이든 지금 5종목은 전부 대상 |
| Q2 | 첫 활성화 때 5건이 한 번에 오는 것 | (a) **첫 거래일에 5건 일괄 제안, 건별 결정** (b) 큰 손실 순 하루 1건씩 (c) 손실 −20% 이상만 먼저(000660·005930·ORCL) | **(a)** | 숨길 이유가 없다. 거절은 다음 거래일까지 침묵이므로 피로는 1회 |
| Q3 | 거절 뒤 재제안 조건 | (a) **추가 −5% 하락 시** (b) 매 거래일 1회 (c) 재제안 없음(수동) | **(a)** | 같은 가격대 반복 방지 + 계속 내리면 다시 묻기 |
| Q4 | 매도 건당 금액 상한 | (a) **없음(현 정책)** (b) 상한 두고 초과분 수량 축소 | **(a)** | 청산을 한도로 막는 것은 T-015 이전 설계가 버린 방향. MU 1,317만 원 1건은 메시지에 비중으로 보여 준다 |
| Q5 | 부분 매도 | (a) **2단계 전량만, 3단계에서 비중 축소 제안** (b) 처음부터 수량 편집 | **(a)** | 수량 편집은 화면·검증이 커진다. 집중도 제안(50%)은 3단계 |
| Q6 | 진입가 검증 | (a) **MTS 평단 눈대조 1회 + 1단계 리포트에 KIS 원본 병기** (b) 제안 전 자동 차단 조건으로 | **(a)** | §3.4 — 증권사 값이고 가격 이력과 정합. 차단 조건은 과도 |
| Q7 | 해외 USD 예수금 스냅샷 수집(P)을 2단계 **전에** 할지 | (a) **먼저** (b) 나중, 당분간 고지로 대체 | **(a)** | MU 매도 승인 직후 화면·한도·킬스위치가 −64% 를 본다. 별건 task 로 분리 |
| Q8 | 제안 TTL | (a) **당일 장 마감까지** (b) 30분(현 기본) (c) 2시간 | **(a)** | 폰을 못 보는 시간대(해외는 새벽) |

Q1~Q8 에 답이 오면 1단계(시뮬레이션)부터 착수한다. Q7 (a) 면 별건 task 를 먼저 만든다.

---

## 확인하지 못한 것

- [확실] KIS 를 호출하지 않았으므로 **지금 이 순간의** 잔고·평단·주문가능수량은 보지 못했다(마지막 틱 값은 `position_state` 10-16 23:05 / 스냅샷 10-19 17:15).
- `exit_engine_enabled`·`safety_dry_run` 행이 10-18 18:22 에 갱신된 경위(값은 각각 false·false 로 동일). 부팅 시드는 `INSERT IGNORE` 라 updated_at 을 바꾸지 않는다 — 누군가 설정 화면에서 저장한 것으로 보이나 감사 로그는 확인하지 않았다.
- T-041 가드가 "해외 종목 매도 → USD 대금 미관측" 을 실제로 보류 처리하는지는 코드 주석과 설계 기록으로만 판단했다(실행 재현 안 함).
- 해외 시세·잔고가 같은 5분 환율 캐시를 쓰는지(N 의 FX 중립 주장)는 호출 순서를 끝까지 추적하지 않았다.

## Analyst

- [18:11] 역할 규칙·T-015·T-043·관련 task 머리 읽음. 코드 읽기: `exit-engine.ts`·`exit-switch.ts`·`engine.ts`(721-939, 1120-1170)·`router.ts`(236-316)·`signals/service.ts`·`approval-transitions.ts`·`approval-notify.ts`·`approval-message.ts`·`approval-context.ts`·`telegram-approval.ts`·`entry-watcher/route.ts`·`holding-checker/route.ts`·`safety/dry-run.ts`·`order-limits.ts`·`style.ts`·`position-state.ts`·`statuses.ts`·`market-hours.ts`·`kis-domestic.ts`/`kis-overseas.ts` createOrder·잔고 파싱·`ApprovalQueue.tsx`·approve route. 읽기 전용 DB: `system_config`·`position_state`·`portfolio_snapshots`(4,664행 가격 이력)·`orders`·`signals`·`eval_funnel`. KIS 호출·쓰기·배포·git 없음. 계산 스크립트는 scratchpad `t055_*.js` 에만.
- [18:40] 설계 문서 작성 완료(이 파일). 앱 소스·운영 DB 변경 0건. `20-Log/2026-10-19.md` 는 없어서 만들지 않았다(Leader 가 당일 로그를 열 때 한 줄 색인 요청).

---

## 사용자 결정과 착수 (2026-10-19 밤)

사용자 지시 원문: "매도제안은 Q5로 진행. 텔레그램 스위치는 바로 진행해줘. 그외에는 권고안으로 작업 진행해줘". Leader 해석: "Q5로 진행" = Q5 권고 (a)(2단계는 전량 매도만, 비중 축소는 3단계)를 받아들인다는 뜻, "그외" = Q1~Q4·Q6~Q8 도 권고안. (해석이 다르면 알려 달라고 사용자에게 보고한다.)

| Q | 확정 |
|---|---|
| Q1 | (b) 진입가 대비 −6% |
| Q2 | (a) 첫 거래일 5건 일괄 제안, 건별 결정 |
| Q3 | (a) 거절 뒤 추가 −5% 하락 시 재제안 |
| Q4 | (a) 금액 상한 없음 |
| Q5 | (a) 2단계 전량만, 3단계에서 비중 축소 제안 |
| Q6 | (a) MTS 평단 눈대조 1회 + 1단계 리포트에 KIS 원본 병기 |
| Q7 | (a) USD 예수금 수집 먼저 → 별건 [[T-056-usd-cash-snapshot]] |
| Q8 | (a) TTL 은 당일 장 마감까지 |

**착수 범위: 1단계(읽기 전용 시뮬레이션)만.** 시그널·주문·승인 경로·화면은 이번 착수에 포함하지 않는다. 2단계(시그널 생성 + 앱 승인)는 ① 1단계 리포트가 3거래일 이상 §3.3 임계값대로 나오고(대상·사유가 사용자 예상과 일치) ② T-056 이 배포되고 ③ 데모 게이트(ApprovalQueue 카드·설정 토글, delta)를 통과한 뒤에 별도 착수한다. 3단계는 텔레그램 승인 스위치 운영 후.

judge 접수(1단계): Jev, 위험 R2(안전 경로), developer=opus, 역할 developer·reviewer·qa, 데모 none. `needs_info` 0.60(점수 높음) — 판정 도구는 요구사항 부족으로 사용자 질문을 권했지만, 정본이 이 설계 문서와 위 사용자 답변이라 추가 질문 없이 진행한다. 도구는 `request_summary` 300자 초과를 차단해(규칙 엔진으로 폴백) 첫 두 번의 접수는 무효였고 요약을 줄여 다시 접수했다.

## Developer

- [23:31] 1단계(읽기 전용 시뮬레이션) 구현 완료 — **미커밋**(커밋·add·push·배포·운영 DB 쓰기·KIS 호출 없음). 신규 3: `src/lib/strategy/sell-proposal.ts`(순수 판정기 `evaluateSellProposal(state, ticker, policy, lastDecision)`), `sell-proposal-policy.ts`(스위치·임계값 판독, fail-closed), `sell-proposal-preview.ts`(관측·eval_funnel 기록·하루 1회 요약). 수정 3: `engine.ts`(+41줄, 삽입만), `eval-funnel-labels.ts`(게이트 `sell_proposal_preview` stage 26), `db.ts`(부팅 시드 INSERT IGNORE). 테스트 신규 4: `__tests__/sell-proposal.test.ts`·`sell-proposal-policy.test.ts`·`sell-proposal-preview.test.ts`·`engine-sell-proposal-preview.test.ts`. 기존 테스트 수정 0건. `notify/telegram.ts` 무수정(공개 함수 `dispatchAlert`·`getSymbolLabel` 만 호출).
- [23:31] 판정 규칙: 직전 결정 없음 → 손익 ≤ −stopPct(6) 이면 대상(`stop`). `lastDecision.status='active'` → 손익 < −6+1 이면 유지(`hold`), −5.00% 이상 회복 시 철회(히스테리시스). `rejected/expired/superseded` → −6% 이하 **그리고** 기준가 대비 ≤ −5% 일 때만 `restep`(설계 §2.2 문구대로 superseded 도 포함 — 2단계 재검토 대상). 손익은 소수 6자리 반올림 후 비교(1,092.5→1,026.95 처럼 정확히 −6% 가 JS 에서 −5.999999999999996 이 되는 경우 실측). 결손·비정상(현재가·진입가·수량·단위비 [0.3,3.0]·정책·기준가·결정 상태)은 전부 skip. 수량은 정수 내림, 1주 미만 skip. 1단계 엔진은 `lastDecision` 에 항상 null.
- [23:31] 출력 초안: strategyId `sell-proposal-v1`, side sell·market·전량, `indicators.proposal{kind,trigger,entry_price,current_price,pnl_pct,threshold_pct,reference_price}`. **`exit_kind`·`ai` 키 없음**(테스트가 어떤 깊이에도 없음을 고정 — router 강제 auto_submit·진입 감시 분기 입력 차단). router 를 import 하지 않는다.
- [23:31] 정책 판독: 키 `sell_proposal_preview_enabled`(시드 false)·`sell_proposal_stop_pct`(6)·`sell_proposal_restep_pct`(5)·`sell_proposal_rebound_exit_pct`(1). 켜짐 = JSON 디코드 결과가 **불리언 true** 뿐(`"true"`·`1`·`on`·`TRUE` 꺼짐). 임계값은 JSON 숫자만, 범위 stop [1,50]·restep [1,50]·rebound [0,5]·rebound < stop. 하나라도 누락·무효·DB 오류면 전체 꺼짐(코드 기본값으로 메우지 않음). 캐시 없음, 쿼리 1회. 설계 §3.3 의 drift·concentration·daily_max 는 읽는 코드가 2·3단계라 시드하지 않았다. 시드 값의 단일 소스는 `SELL_PROPOSAL_CONFIG_SEED`, db.ts 는 순환 import 를 피해 동적 import(exit-switch 와 같은 방식).
- [23:31] 마스터 게이트 결정: 미리보기는 **`exit_engine_enabled` 가 true 가 아닐 때만** 연다(§2.2 "둘 다 켜지면 자동 엔진 우선, 제안 없음"). 현재 운영값 false 이므로 미리보기 스위치만 켜면 돈다. 관측 호출 위치는 마스터 게이트 블록 **안이 아니라** `loadPositionState`·단위 계측 직후, `evaluateExit` 앞 — 게이트 블록은 `evaluateExit` 가 발화한 종목에만 도달하므로(no-fire 는 그 전에 continue) 그 안에 두면 −6% 이하인데 자동 엔진 임계값(예: hardStopPct 10)엔 못 미친 종목이 빠진다(엔진 테스트로 고정). 자동 엔진 제어 흐름은 한 줄도 바꾸지 않았다 — 삽입 3곳(열기·관측·요약 시작) 모두 try/catch, 관측은 동기·자체 격리, 요약은 `void finish()` 로 기다리지 않음.
- [23:31] 하루 1회 표식: `system_config.sell_proposal_preview_report_<market>` = 마지막 선점 거래일(JSON 문자열). ① `INSERT IGNORE`(값 `""`) ② `UPDATE … SET value=<오늘> WHERE key=? AND value <> <오늘>` 영향 1행이면 선점. mysql2 기본 `FOUND_ROWS` 에서도 조건에 `value <> 오늘` 이 있어 "맞은 행 = 바꾼 행"이라 정확(ODKU 한 문장은 FOUND_ROWS 아래에서 신규 삽입과 이미-오늘을 구분 못 해 기각). 거래일 = 국내 KST, 해외 ET(해외 세션이 KST 자정을 넘어 KST 날짜면 한 세션 2회). 전 채널 실패 → 표식 되돌려 재시도(거래일·시장당 최대 3회), 선점 쿼리 오류 → 보내지 않음(중복보다 누락), `notify_channel=none` → 재시도 없음. 평가 못 한 종목이 있으면 최대 3틱(15분) 미룸. 프로세스 로컬 Map 은 매 틱 선점 쿼리를 줄이는 보조일 뿐 권위는 DB. 선례: `trade-report` 의 `report_trade_last_sent_at`. 기존 `system_config` 전체 조회(`LIKE 'safety_%'` 등)에 이 키 접두사가 걸리지 않음을 확인.
- [23:31] KIS 병기: **새 KIS 호출 0건.** 틱이 이미 가진 `getBalancesDetailed()` 결과(`held.amounts` 의 qty·avgPrice = KIS `pchs_avg_pric`)와 `position_state` 진입가·수량을 eval_funnel detail(`kisQty`·`kisAvgPrice`·`qty`·`entry`)과 요약 "KIS 잔고 원본 대조" 줄에 나란히 적고 일치/⚠ 불일치를 표시(허용 오차 max(0.01, 1e-6×값)). 엔진 테스트가 미리보기 ON/OFF 의 getTicker·getBalancesDetailed 호출 수가 같음을 고정. 한계: 해외 매입평균은 어댑터가 USD 평단 × 잔고 시점 환율로 바꿔 넘겨 **USD 원값이 없다**(`kis-overseas.ts` 는 안전 경로라 손대지 않음 — 요약에 주의 문구).
- [23:31] USD 현재가 병기는 뺐다: `currency-mixing-fence.test.ts`(T-035)가 USD 원가 필드를 읽는 파일 목록을 고정하고 있어 처음 구현이 그 가드에 걸렸다. 가드 허용 목록을 넓히는 대신 1단계는 원화 환산가만 쓴다. 2단계 메시지(§2.7 "USD −15.8%")는 `display-amount` 경유 + fence 목록 갱신을 리뷰와 함께 할 것.
- [23:31] 검증(격리 사본 = `git archive HEAD` cb68cfc + 내 파일 10개만 덮어씀, node_modules 심링크): `tsc --noEmit` 0 오류. jest **153 스위트 / 3,544 테스트 전부 통과**(기준선 HEAD 149 / 3,371 → 신규 4 스위트·173 테스트). 테스트 파일은 tsconfig 가 tsc 대상에서 제외(기존 규약). lint 는 저장소에 ESLint 설정이 없어 `next lint` 가 설정 마법사를 띄움 — 실행 불가.
- [23:31] 변이 46종 전부 사망(최종 생존 0): 임계 `<=`↔`<`·반올림 제거·`exit_kind` 주입·`ai` 주입·히스테리시스 `>=`→`>`/제거·restep 경계/무시·기준가 검증 제거·단위 sanity 제거·수량 내림 제거·보유 0 허용·판정기 정책 검증 생략·rebound≥stop 교차검증 제거·진입가 0 허용·미지 결정 허용 / 스위치 `"true"`·`1`·on·yes 허용·임계값 누락 시 기본값·문자열 숫자 허용·범위 검증 생략·DB 오류 시 켜짐·시드 기본 true·로그 스팸 / 표식 제거(선점 항상 성공)·조건부 UPDATE 무력화·로컬 캐시 제거·재시도 상한 제거·실패 시 미되돌림·미루기 제거·해외 거래일 KST·observe/finish 격리 제거·선점 오류 시 발송·이스케이프 제거·마지막 줄 누락·스위치 무시·KIS 대조 항상 일치 / 자동 청산 ON 에도 미리보기·요약 await·관측을 게이트 안으로·엔진+내부 격리 동시 제거·미리보기가 createSignal 호출·정책 열기 격리 제거 / db.ts 시드 ODKU. 1차 실행에서 '스위치 무시(enabled 미검사)' 1종이 살아남아 모순 입력(`enabled:false`+정책, `enabled:'true'`) 케이스를 추가해 죽였다. 러너: scratchpad `mutate.py`(격리 사본만 바꾸고 되돌림, 원본 무변경 cmp 확인).
- [23:31] 안전장치 self-check: 이번 변경은 주문·체결 경로를 건드리지 않는다 — 소스 수준 테스트가 신규 3파일에서 `signals/service|router|approval|telegram`·`safety/dry-run|order-limits|kill-switch`·`exchanges/kis*` import 와 `createSignal`·`submitOrder`·`createOrder`·`approveSignal`·`claimAwaitingSignal`·`getTicker`·`getBalancesDetailed`·`upsertPositionState`·`setCooldown` 식별자 0건을 고정. 엔진 테스트 5시나리오(청산 OFF hard_stop / ON hard_stop·target·trailing / 매수 룰 발화)에서 미리보기 ON/OFF 의 createSignal 인자·쿨다운·경보·position_state upsert·reconcile·기존 eval_funnel 행이 **완전히 같음**을 비교. DRY_RUN·KILL_SWITCH·한도·블랙리스트·orders 기록 5항목은 이번 변경과 무관(주문 경로 무변경).
- [23:31] 남은 위험·사용자 결정: ① **배포만으로는 아무 일도 없다** — `sell_proposal_preview_enabled` 를 `true` 로 바꿀 UI 가 없다(1단계 화면 변경 금지). 켜는 주체·방법(DB 직접 기입) 결정 필요. ② "하루 1회"를 **시장별 거래일 1회**로 해석했다 — 국내·해외 보유가 둘 다 있으면 하루 최대 2건(국내 장중 오전, 해외 밤). 하나로 합치려면 한 시장 틱에서 다른 시장의 지난 틱 값을 써야 해 정확도가 떨어진다. ③ 요약은 그 거래일 **첫 완전한 틱** 기준이라 장중에 새로 −6% 를 넘은 종목은 다음 거래일 요약에야 보인다(eval_funnel 에는 틱마다 남는다). 3거래일 관측 판정은 eval_funnel 집계로 보완 권장. ④ restep 대상에 superseded(가격 회복 철회)를 넣은 것은 설계 문구를 따른 것 — 2단계에서 "회복 철회 뒤 재하락은 즉시 재제안"이 맞는지 재판단 필요. ⑤ 해외 USD 원값 병기 불가(위). ⑥ system_config 에 런타임 쓰기 2키가 생긴다(표식).
- [23:31] Reviewer 인계 — scope 후보: `src/lib/strategy/sell-proposal.ts`, `src/lib/strategy/sell-proposal-policy.ts`, `src/lib/strategy/sell-proposal-preview.ts`, `src/lib/strategy/engine.ts`, `src/lib/strategy/eval-funnel-labels.ts`, `src/lib/strategy/__tests__/sell-proposal.test.ts`, `src/lib/strategy/__tests__/sell-proposal-policy.test.ts`, `src/lib/strategy/__tests__/sell-proposal-preview.test.ts`, `src/lib/strategy/__tests__/engine-sell-proposal-preview.test.ts`, `src/lib/db.ts`(커밋 훅 SAFETY_PATHS 에는 `^src/lib/strategy/` 만 걸리고 db.ts 는 아님 — 그래도 부팅 시드라 검토 권장). 중점: 엔진 삽입 3곳이 자동 청산 흐름을 바꾸지 않는가, 표식 SQL 의 원자성(MariaDB JSON=LONGTEXT 비교 가정), fire-and-forget 이 프로세스 종료·테스트 누수에 미치는 영향. 공유 트리 주의: `engine.ts`·`db.ts`·`eval-funnel-labels.ts` 는 내 변경만 있음(diff 확인), 같은 트리의 다른 미커밋 변경(`notify/telegram.ts` 등)은 내 범위 밖.
- [00:09] 라운드 2(Codex C2 high·medium + Reviewer R-1·R-2) 완료 — 미커밋. 바뀐 파일 3개: `sell-proposal-preview.ts` 67e819177fc5→0f05cc6efc94, `__tests__/sell-proposal-preview.test.ts` c6db6a3aca31→3d3a7d65ab2d, `__tests__/engine-sell-proposal-preview.test.ts` fcae5e0a0950→3f542399ded0. 나머지 7개는 그대로(`engine.ts` f28d0170289b 그대로 — 삽입 3곳 무변경).
- [00:09] ① 전송 reject: `finishReport` 에서 `d.dispatch` 를 try/catch 로 감싸, reject 를 "모든 채널 실패 결과"와 같은 경로로 처리한다 — 재시도 1회로 세고 상한(3) 안이면 표식을 되돌림(`send_failed_released`), 넘으면 유지(`send_failed_kept`). 되돌림은 기존 `releaseDailyReport` 그대로("아직 이 거래일 값일 때만" 조건부 갱신) — 전송 중 다른 프로세스가 다음 거래일로 선점한 표식을 덮지 않음을 테스트로 고정. 종목명 조회 예외는 기존대로 코드 폴백이고 표식·되돌림과 무관함을 테스트로 확인. 본문 조립·시계 예외는 종전대로 바깥 catch → `error`(표식 유지).
- [00:09] ② 열기 타임아웃: `openSellProposalPreview` **안에서** `Promise.race` 로 정책 판독에 상한 `POLICY_READ_TIMEOUT_MS=2000` 을 둔다. 초과 시 null(미리보기만 비활성, 엔진 흐름 그대로), 늦게 온 결과는 어디에도 쓰지 않고(열기가 이미 null 을 돌려줌), 타이머는 `finally` 에서 정리, `unref`. 2초 근거: PK `IN` 4키 SELECT 1회라 정상은 [추측] 수~수십 ms, 5분 틱 안에서 2초는 무시할 만하고, 그보다 느리면 DB 이상 상태라 정보성 미리보기는 그 틱에 빠져도 된다. mysql2 연결 대기(기본 10초)보다 짧게 잡아 풀이 막혔을 때 이 지점에서 10초씩 서지 않게 했다. `engine.ts` 는 바꾸지 않았다. 늦은 reject 의 unhandled 방지는 `Promise.race` 가 이미 처리기를 달아 두므로 별도 `.catch` 를 두지 않았다(테스트로 고정).
- [00:09] ③ R-1: 소스 수준 금지 검사의 지정자 수집기를 정적 `from`·`import type`·`export … from`·부수효과 `import '…'`·동적 `import('…')`(줄바꿈 포함)·`require*('…')` 로 넓히고, 수집기 자체를 문자열 표본으로 자기 검증. 금지 식별자에 `routeSignal`·`readExitKind`·`resolveApprovalPath` 추가. ④ R-2: 엔진 테스트 3건 추가 — 보유 1·관측 1 "평가 1/1종목", 보유 2·관측 2 "평가 2/2종목" 첫 틱 전송, 보유 2·시세 실패 1 → 3틱 미룬 뒤 "평가 1/2종목 (… 확인 실패 1종목)". 엔진 타임아웃 테스트 2건(가짜 타이머로 1.9초엔 대기·2.1초엔 진행, 미리보기 행 0·청산 차단 기록·upsert 그대로 / 정상 판독 뒤 남은 타이머 0).
- [00:09] 기존 expect 변경 1건(의도적): "dispatch 가 reject 해도 finish 는 resolve(error)" 의 `toBe('error')` → `toBe('send_failed_released')` + 표식 `""` 확인. 그 기대값이 바로 Codex high 가 지적한 "reject 면 표식이 남아 그날 영구 누락" 동작을 고정하던 것이라 고쳐야 했다. "던지지 않는다"는 원래 계약은 그대로 검사하고, 바깥 catch 를 지키는 시험(시계 예외 → `error`)을 따로 추가했다. 나머지는 추가만.
- [00:09] 검증(격리 사본 HEAD cb68cfc + 내 파일 10개): `tsc --noEmit` 0 오류, jest **153 스위트 / 3,564 테스트 전부 통과**(라운드 1 대비 +20). 변이 — 이번 변경분 15종을 라운드 1 테스트 사본(Reviewer 사본 `t055rev` 의 c6db6a3aca31·fcae5e0a0950 을 읽어 복사)과 새 테스트 양쪽에서 실행: 옛 테스트로 생존·새 테스트로 사망 = reject 원래 동작 복원·reject 시 즉시 포기·reject 재시도 카운트 미증가·타임아웃 제거·늦은 결과 사용·타이머 미정리·상한 10초·동적 import(router) 3모듈 + require(service)(M24 4종)·보유 수 0(M31)·보유 수 1. 둘 다 사망 = 되돌림 무조건 갱신·종목명 예외를 전송 실패로. 새 테스트 생존 0. 라운드 1 변이 46종 재실행 — 처음엔 'finish 바깥 catch 제거'(R09)가 살아남았고(reject 를 안에서 처리하게 되면서 그 catch 에 닿던 유일한 시험이 사라짐) 시계 예외 시험을 더해 다시 사망, 최종 46/46 사망. 러너: scratchpad `mutate_t055r2.py`·`mutate.py`.
- [00:09] 알려진 한계(수용, Leader 결정): ① 선점 뒤 전송 전에 프로세스가 강제 종료되면 그날 요약은 누락된다(최대 한 번 전송 — at-most-once). 읽기 전용 관측 리포트이고 판정 데이터는 eval_funnel 에 틱마다 남아 lease·상태 머신을 두지 않는다(코드 주석에 명시). ② 재시도 횟수 `sendRetries` 가 프로세스 로컬이라 재시작·다중 프로세스에서는 상한이 지켜지지 않는다 — 운영 `instances:1`, 최악은 정보성 요약 중복 몇 건(코드 머리 주석에 명시). ③ (새로 확인) 채널 쪽에는 전달됐는데 응답 타임아웃으로 reject 되면 이제 재시도로 같은 요약이 한 번 더 갈 수 있다 — 라운드 1 은 이 경우 누락, 라운드 2 는 중복(최대 상한 횟수). 지시대로 누락보다 중복을 택한 결과다. ④ 정책 판독이 2초를 넘긴 틱에는 SELECT 자체는 취소되지 않고 풀 연결을 계속 잡는다(결과만 버림) — DB 가 막힌 상황이면 앞선 `readExitEngineSwitch` 도 같이 막히므로 새 위험은 아니다.

## Codex C2 — 1단계 (외부 읽기 전용 검토, 2026-10-20 새벽)

- judge C2: `codex_required=true` · `adversarial-review` · focus `concurrency` · 규칙 `CX-limit-unknown-r2` · 스위치 on. 인계서 `scratchpad/handoff-T-055-c2.md`, 실행 70초, 스냅샷에서 파일 변경 0. 결과 원본 `scratchpad/codex-T-055-c2.out.json`. Codex 가 검토하지 못했다고 밝힌 것: 다른 세션 변경 약 60개, 실제 MariaDB·실제 알림 채널로의 다중 프로세스 통합 실행.
- **Codex 가 찾지 못한 것**: 조건부 UPDATE 로 요약을 선점하는 정상 경합과 JSON 문자열 비교에서 중복 선점 결함 없음 — Reviewer 의 실DB 동시 시험(동시 20건·프로세스 4개×8건 모두 정확히 1건)과 일치한다.
- 지적 3건과 Leader 확인:
  1. **high — 전송 호출이 예외로 끝나면 요약이 그날 영구 누락**(`sell-proposal-preview.ts` 289·307 근처): 표식을 전송 전에 기록하고, `dispatch` 가 *실패 결과*를 돌려줄 때만 되돌린다(309-314). 전송 호출이 *예외로 reject* 하면 바깥 catch(254-260)로 빠져 표식이 남는다 — 코드에 "선점한 뒤에는 예외가 나도 되돌리지 않는다(같은 예외가 매 틱 반복될 가능성)"는 주석이 있어 **의도된 선택임을 Leader 가 확인**했다. 다만 같은 목적(매 틱 반복 방지)을 이미 있는 재시도 상한(최대 3회)이 달성하므로 reject 도 재시도 1회로 세어 되돌리는 쪽이 낫다. 프로세스 강제 종료 중 누락은 lease 상태 머신이 필요하지만, 이 요약은 **읽기 전용 관측 리포트**(데이터는 `eval_funnel` 에 틱마다 남음, 돈이 걸린 경로 아님)라 **최대 한 번 전송(at-most-once)을 수용**한다. [확실 — 코드 대조] 영향은 요약 하루치 누락뿐.
  2. **medium — 재시도 횟수가 프로세스 로컬**(`sendRetries` Map, 112 근처): 재시작·여러 프로세스에서는 상한이 지켜지지 않아 실패 전송이 반복되거나, 상대 채널에는 전달됐는데 타임아웃으로 실패 판정한 경우 중복 요약이 생길 수 있다. 운영은 `instances:1` 이고 최악도 정보성 요약 몇 건 중복이라 **알려진 한계로 수용**(문서화).
  3. **medium — 열기 `await` 에 타임아웃이 없다**(`engine.ts:792` → `sell-proposal-policy.ts:105` `pool.query`): 미리보기 스위치 판독 SELECT 가 오래 걸리면 미리보기만이 아니라 시세 조회·`position_state` 갱신·청산 조건 평가 이후 진입 평가와 cron 응답까지 지연된다. Reviewer 는 NIT(R-3)로 봤으나 Codex 는 medium. 같은 풀에 의존하는 앞선 조회들(`readExitEngineSwitch` 등)이 이미 있어 DB 가 멈추면 엔진도 어차피 멈추지만, 이 기능이 **새로 더하는 대기점**이므로 짧은 타임아웃(시간 초과 시 미리보기만 비활성)을 두는 것이 맞다.
- Leader 결정: 1·3 은 수정, 2 는 수용 후 문서화, Reviewer 의 MINOR R-1(동적 import 검사 정규식 보강)·R-2(`heldSymbols.length` 인자 검증 시험)도 같은 라운드에서 고친다. 수정 뒤 Reviewer 가 변경분만 재검증한다.

## Reviewer

- [23:52] 감사 대상·방법: 작업 트리 10개 파일의 SHA-256 앞 12자리가 의뢰서 값과 전부 일치(sell-proposal.ts e202f0074e97 · policy 388d69cbffa7 · preview 67e819177fc5 · engine.ts f28d0170289b · eval-funnel-labels.ts 9d151bd5ef5b · db.ts 1ea8b5c80955 · 테스트 4개 f90274f005a8/23bdb4588fec/c6db6a3aca31/fcae5e0a0950), HEAD cb68cfc. `git diff HEAD` 는 engine.ts +41(3곳, 삭제 0줄)·eval-funnel-labels.ts +9·db.ts +16 으로 Developer 변경뿐이다. 신규 7개는 untracked, `src/lib/strategy/__tests__/` 의 tracked 테스트 수정은 0건(기존 expect 삭제 없음 — `src/lib/signals/__tests__/approval-notify.test.ts` 변경은 타 세션 몫). 격리 사본 2개(검증용·변이용)를 `git archive HEAD` + 10개 파일로 만들고 node_modules 는 심볼릭 링크. 앱 소스(작업 트리)는 수정하지 않았고, 종료 후 해시 재대조·변이 사본 `cmp` 로 복원을 확인했다. 운영 DB·KIS 접근 0, 시험 DB 는 일회용 mariadb:11 컨테이너(11.8.8)였고 `docker rm -f t055r-scratch` 로 제거했다.
- [23:52] 직접 실행 결과: `tsc --noEmit` 종료 0, 신규 4 스위트 173 테스트 통과(`--runInBand` 5회 반복 동일, `--detectOpenHandles` 경고 없음), 전체 jest 153 스위트 / 3,544 테스트 통과 — Developer 보고와 일치. tsconfig 가 테스트 파일을 tsc 대상에서 제외하는 기존 규약이라 테스트 코드 타입 검사는 하지 못했다.
- [23:52] 의도 충족 [확실]: 요구(보유 −6% 이하를 시그널·주문 없이 `eval_funnel` 게이트 `sell_proposal_preview` 와 하루 1회 텔레그램 요약으로만 기록, 기본 꺼짐)를 코드·실DB 시험으로 확인했다. 자동 청산 엔진·주문·시그널·승인 경로는 변경되지 않았다.
- [23:52] 자동 청산 엔진 불변 [확실]: engine.ts 삽입 3곳(열기·관측·요약 시작)은 순수 추가다. 열기는 `!exitSwitch.enabled` 분기에서만 실행되고(자동 청산 ON 이면 호출·정책 쿼리 자체가 없음 — 엔진 테스트가 고정), 내부 try/catch 와 엔진 쪽 try/catch 2겹이다. 관측 `observe` 는 동기이고 입력(state·ticker·entry)을 바꾸지 않으며 `rec.pass/skip` 외 부작용이 없다(전체 try/catch, 기록기가 던져도 격리). 요약 `finish()` 는 `void … .catch` 로 기다리지 않고 내부가 전부 try/catch 라 reject 될 수 없다. 운영은 pm2 장수 Next 서버(instances 1)에서 틱이 돌므로 응답 뒤에도 비동기 작업이 이어진다(기존 `void syncPendingOrders()` 와 같은 패턴). 선점 직후 프로세스가 죽으면 그날 요약이 누락되는데, 이는 설계된 '중복보다 누락'이다.
- [23:52] 시그널/주문 경로 무접촉 [확실]: 신규 3파일에서 createSignal·submitOrder·approve*·routeSignal·signals/·dry-run·kill-switch·order-limits·exchanges/kis* 호출 0, 동적 `import()`·`require()` 0, `exit_kind` 는 주석에만 있다. 판정기 출력 `indicators` 는 `proposal` 하나뿐이고 `ai` 도 없다. 런타임 import 는 `@/lib/db`·`@/lib/notify`(dispatchAlert·getSymbolLabel)·`@/lib/notify/escape`·`@/lib/safety/flags`(로그 중복 억제 헬퍼)·`./exit-engine`(단위 비율 상수 2개)뿐이다. 엔진 diff 추가분에는 createSignal·setCooldown·upsertPositionState·kis.*·직접 DB 쿼리가 없다.
- [23:52] 실DB 시험 1 — fail-closed·시드(MariaDB 11.8.8, 운영과 같은 `value JSON NOT NULL` DDL, db.ts 부팅 코드 그대로 실행): 새 DB 부팅 시 시드는 false/6/5/1. 운영자가 스위치 true·임계값 8 로 바꾼 뒤 부팅을 다시 돌려도 값이 유지됐다(INSERT IGNORE). 판독기는 JSON 컬럼 왕복에서 `true` 만 켜짐이고 `"true"`·`1`·`0`·`null`·`"on"`·`"TRUE"`·`[true]`·`{"a":1}`·`false` 는 전부 꺼짐이었다. 임계값이 `"6"`·0.5·51·null·키 누락이거나 rebound ≥ stop 이면 전체 꺼짐이다. 공백이 낀 JSON ` true ` 는 켜지는데 유효한 JSON 불리언이라 결함으로 보지 않는다.
- [23:52] 실DB 시험 2 — 하루 1회 표식 원자성: 풀 하나에서 동시 20 claim → 정확히 1건. 같은 날 재시도 5건 → 0건, 다음 날 동시 10건 → 1건. 같은 값으로 조건부 UPDATE 를 다시 실행하면 affectedRows 0·changedRows 0 이라 mysql2 기본 FOUND_ROWS 에서도 '맞은 행 = 바꾼 행'이 성립한다. 별도 프로세스 4개(jest) × 동시 8 = 32 claim 을 배리어 시각(모두 79초 전 준비 완료, 시작 편차 0ms)에 맞춰 쏘았을 때 정확히 1건만 선점했다. 실제 claim/release 에 가짜 전송을 붙인 전체 흐름: 6개 동시 finish → 전송 1건(sent 1·claim_lost 5), 재시작 뒤 같은 날 → claim_lost, 전 채널 실패 → released 3회 → kept → already_sent 로 멈추고 전송은 총 4회(최초 1 + 재시도 3)였다.
- [23:52] 판정기 정확성: 진입가 소수 2자리·가격 −6.5%~−5.5% 구간 200,000건을 정확한 정수 비교(100P ≤ 94E)와 대조해 불일치 0건. 히스테리시스 −5.00% 경계 100,000건 불일치 0건. 현재가·진입가·수량이 NaN·0·음수·문자열·undefined 이면 skip(코드 확인 + 테스트). 해외는 원화 환산가만 쓴다. 시각 경계: `sessionDateFor` 를 DST 시작(03-08)·종료(11-01)·KST 자정 직후·ET 장 마감 시각 10개 입력으로 확인했고 기대값과 전부 일치했다.
- [23:52] 요약 본문 샘플 출력(5종목, 해외 시장) 확인: 한국어, 버튼 없음, 마지막 줄이 '시뮬레이션 — 시그널·주문 없음', 동적 값은 escape(`A<B&C` → `A&lt;B&amp;C`), 정적 문구에 `<`·`>`·`&` 없음(텔레그램 HTML 모드로 본문이 그대로 나가므로 확인함), 길이는 4,096자 한도의 한참 아래다. 새 KIS 호출은 0건이다(신규 모듈에 exchanges import 없음, 엔진 테스트가 getTicker·getBalancesDetailed 호출 수 동일을 고정). 추가 DB 쿼리는 자동 청산 OFF 인 틱마다 정책 SELECT 1회, 켜진 날은 요약 선점 전까지 틱당 INSERT IGNORE + UPDATE 뿐이다. eval_funnel 증가는 틱 × 보유 종목 수(현 5종목 기준 하루 약 270행, 기존 일 약 2만행의 1.4%)이며 30일 보존 정리 대상과 같다. 기존 eval_funnel 소비자(`eval-funnel-query.ts`)는 gate 별 집계라 새 게이트가 6단계 깔때기·시그널 건수·이상 배너(verdict=error 만)에 섞이지 않는다. `system_config` 의 `LIKE` 조회 패턴(`safety_%`·`style_%`·`vol_guard_%`·`report_trade_%`·`notify_signal_%`·`strategy_%`) 중 새 키 접두사 `sell_proposal_` 에 걸리는 것은 없다.
- [23:52] 변이 시험 직접 재현: Developer 세트와 별개로 독립 37종을 격리 사본에서 돌렸다(엔진 3 — 자동 청산 ON 에도 열기·finish await·관측 위치 이동 2종 / 정책 4 — 스위치 완화·DB 오류 시 켜짐·임계값 기본값 보충·시드 true / 판정기 8 — 경계 방향·`>=`·exit_kind 주입 2종·반올림 제거·히스테리시스·단위 sanity·restep 경계·수량 내림·교차검증 제거 / 표식·전송 10 — value<>today 제거·선점 항상 true·되돌리기 생략·ET→KST·선점 오류 시 전송·escape 제거·재시도 상한 제거·미루기 제거·release 날짜 가드 제거·claim_lost 무시 / 기타 — 마지막 줄 제거·observe 격리 제거·stateQty 출처·db.ts 시드 REPLACE·게이트 stage 변경·`import('@/lib/signals/router')` 삽입·heldCount 0 전달). 35종 사망, 2종 생존: 신규 모듈에 동적 import 삽입(R-1)과 엔진이 넘기는 heldCount 값(R-2). 생존 2종은 현 코드의 결함이 아니라 테스트 틈이다.
- [23:52] R-1 (MINOR) 소스 수준 금지 테스트의 사각: `sell-proposal-preview.test.ts:405-415` 의 `imports()` 는 `from '…'` 정적 import 만 훑는다. 신규 모듈에 `void import('@/lib/signals/router')` 한 줄을 넣어도 전체 테스트가 통과했다(변이 생존). 현재 코드에는 동적 import·require 가 0건임을 grep 으로 확인했으므로 오늘 결함은 아니다. 권고: 정규식에 `import\(\s*['"]`·`require\(\s*['"]` 를 더하고 금지 식별자에 `routeSignal`·`approveSignalForUser` 등을 보태 설계 §0-3(승인 없는 자동 주문 경로 재생 금지)의 회귀망을 동적 경로까지 넓힌다. 차단 사유는 아니다.
- [23:52] R-2 (MINOR) 엔진 배선 테스트 틈: engine.ts 가 `openSellProposalPreview(market, heldSymbols.length)` 로 넘기는 보유 수 값을 아무 테스트도 보지 않는다(0 으로 바꿔도 통과). 틀리면 요약의 '평가 N/M종목'과 '평가 못 한 종목 미루기'가 조용히 틀어진다. 권고: 엔진 테스트에서 요약 본문의 '평가 1/1종목'(또는 보유 2·관측 1 → 미루기)을 확인하는 단언 1개 추가. 차단 사유는 아니다.
- [23:52] R-3 (NIT) 열기 await 에 자체 타임아웃이 없다(engine.ts 792). 다만 직전의 `readExitEngineSwitch`·`reconcilePositionState` 가 같은 DB 풀에 의존하고, 이 await 는 자동 청산이 꺼진 분기에서만 실행되므로 지연돼도 청산 주문이 늦어지는 상태가 아니다(켜진 상태에서는 실행되지 않는다). 새로운 장애 유형이 아니라서 수정은 필수가 아니다. 지연 상한을 두고 싶다면 `Promise.race` 3~5초가 가장 작은 변경이다.
- [23:52] R-4 (NIT) 요약의 'KIS 잔고 원본 대조 → 일치'는 구조상 거의 항상 일치한다. `position_state.entry_price`·`qty` 는 같은 틱에서 `upsertPositionState`(position-state.ts:117-125, ON DUPLICATE KEY UPDATE 로 매 틱 덮어씀)가 KIS 잔고값으로 쓴 직후 읽은 값이라 DECIMAL 반올림 외에는 갈릴 수 없다. 사용자가 MTS 평단과 눈대조하는 Q6(a) 가 실제 검증이고, 이 '일치' 표시를 외부 검증처럼 읽지 않게 해야 한다. 헤더 문구('이번 평가 틱의 잔고 조회값')는 정직하게 적혀 있어 결함은 아니다.
- [23:52] R-5 (NIT, 사용자·Leader 확인 사항) '하루 1회'는 시장별 거래일 1회라 국내·해외 보유가 둘 다 있으면 하루 최대 2건이고, 요약은 그날 첫 완전한 틱 기준이라 장중에 새로 −6% 를 넘은 종목은 다음 거래일 요약에야 나온다(eval_funnel 에는 틱마다 남는다). Developer 보고 ②③과 같은 내용이며 설계 의도와 어긋나지 않는다. 3거래일 관측 판정은 eval_funnel 집계로 보완하라는 Developer 권고에 동의한다. 또 1단계 스위치명 `sell_proposal_preview_enabled` 는 설계 §2.2 의 `sell_proposal_enabled` 와 다르다 — 2단계에서 별도 스위치를 추가할 때 두 스위치의 관계(둘 다 true 일 때)를 문서에 못 박아야 한다.
- [23:52] R-6 (NIT, 절차) 이 작업 트리에는 타 세션의 미커밋 변경이 안전 경로에도 섞여 있다(`src/lib/strategy/ai-filter.ts`·`market-context-client.ts`, `src/lib/signals/`, `src/lib/notify/telegram-api.ts` 등). 커밋은 이 판정의 scope 10개 파일만 스테이징해야 한다. 섞여 들어오면 commit-msg 훅이 scope 밖 안전 파일로 차단하는데, 이는 의도된 fail-closed 동작이다. `src/lib/db.ts` 는 훅의 안전 경로 목록에는 없지만 부팅 시드라 이번 scope 에 포함해 검토했다.
- [23:52] 확인하지 못한 것: ① `next build`(webpack 번들에서 db.ts 의 동적 import 해석 — 같은 파일의 exit-switch 동적 import 선례가 있어 위험은 낮다고 본다) ② 실제 텔레그램 HTML 렌더·실전송(코드 경로와 본문 문자열만 확인) ③ 운영 NAS MariaDB 의 실제 버전·서버 설정(시험은 11.8.8 기본 설정) ④ 타 세션 미커밋 변경 60여 개와 함께 돌린 전체 jest·tsc(HEAD + 10파일 사본에서만 실행) ⑤ 운영 DB·KIS 실데이터(접근하지 않음) ⑥ 스위치를 실제로 켠 뒤의 운영 동작(켜는 UI 가 없어 DB 직접 기입이 필요 — Developer 보고 ①) ⑦ Codex 개입 여부는 judge C2 판정 사항이라 이 감사에 포함하지 않았다.
- [23:52] 종합 의견: CRITICAL 0 · MAJOR 0 · MINOR 2(R-1·R-2) · NIT 4(R-3~R-6). 위 시험 범위에서 자동 청산 엔진·시그널·주문·승인 경로에 영향을 주는 경로는 발견되지 않았고, 하루 1회 표식은 실DB 동시 시험(단일 풀 20, 4프로세스 × 8)에서 중복 없이 1건으로 수렴했다. R-1·R-2 는 후속 task 에서 보강해도 되는 테스트 틈이다. QA 인계 high_risk_areas: engine.ts 782-797·846-855·952-962(삽입 3곳), sell-proposal-preview.ts 87-106(claim·release SQL)·254-321(finishReport 흐름), sell-proposal-policy.ts 101-154(스위치 엄격 판독), sell-proposal.ts 172-278(판정 분기), db.ts 717-731(부팅 시드). 켜기 전 확인 사항: 스위치를 DB 에 직접 기입할 때 JSON 불리언 `true`(따옴표 없음)로 넣어야 한다.
- [23:52] 1차(2026-10-19) 감사 종합은 pass 였다(scope 는 같은 10개 파일). 이 줄은 바로 아래 2차 재검증 항목과 맨 끝 판정 줄로 대체된다.
- [00:20] [2차 재검증 시작] Codex C2 지적 3건 수정과 R-1·R-2 보강분만 다시 감사했다. 작업 트리 해시가 Leader 통보값과 일치한다: sell-proposal-preview.ts 0f05cc6efc94 · 테스트 3d3a7d65ab2d(preview) · 3f542399ded0(engine). 나머지 7개(sell-proposal.ts e202f0074e97 · policy 388d69cbffa7 · engine.ts f28d0170289b · eval-funnel-labels.ts 9d151bd5ef5b · db.ts 1ea8b5c80955 · 테스트 f90274f005a8·23bdb4588fec)는 1차와 같고 HEAD 는 cb68cfc 이다. engine.ts 의 HEAD 대비 diff 는 여전히 삽입만(삭제 0줄)이다. 새 격리 사본 `t055rev2`(HEAD + 10파일, node_modules 심링크), 변이용 사본 2개, 일회용 mariadb:11(`t055r2-scratch`, 11.8.8)을 썼고 시험 뒤 `docker rm -f` 로 지웠다. 앱 소스 수정·git add·커밋·배포·운영 DB·KIS 접근은 없다.
- [00:20] 직접 실행: 사본 `tsc --noEmit` 종료 0, 전체 jest 153 스위트 / 3,564 테스트 통과(Developer 보고와 일치, 1차 대비 +20).
- [00:20] 확인 1 — 기존 expect 변경은 정당하고 약화가 아니다 [확실, diff 전수 대조]. 1차 사본(`t055rev`)의 옛 파일과 현재 파일을 diff 했다. engine 테스트는 삭제·변경 0줄(추가만)이고, preview 테스트에서 지워지거나 바뀐 줄은 정확히 4줄이다. (a) `dispatch 가 reject 해도 finish 는 resolve(error)` 의 제목과 `toBe('error')` → 제목 변경 + `toBe('send_failed_released')` + 표식이 `""` 로 되돌려졌는지 확인(동치가 아니라 의도된 계약 변경). (b) `imports()` 의 `from '…'` 단일 정규식 → 정적·`import type`·`export…from`·부수효과 import·동적 `import()`(줄바꿈·백틱 포함)·`require*()` 수집기(상위집합, 강화). (c) 금지 식별자 배열 끝에 `routeSignal`·`readExitKind`·`resolveApprovalPath` 추가(상위집합, 강화). 이 밖에 mock DB 에 '조건 없는 UPDATE' 한 형태를 실제 DB 처럼 덮어쓰게 허용하는 분기가 추가됐는데, 실제 코드가 쓰지 않는 SQL 모양이라 기존 검사를 느슨하게 하지 않고 변이(N04)를 '엉뚱한 이유로 죽는 것'이 아니라 의미 있게 죽게 만든다. (a)가 동작 고정 자체를 뒤집은 것임을 변이로 확인했다: 변이 'reject 를 다시 던짐'(옛 동작 복원)은 옛 테스트에서 생존하고 새 테스트에서 사망한다 — 옛 `toBe('error')` 가 바로 Codex high 가 지적한 '표식이 남아 그날 영구 누락' 동작을 고정하고 있었다는 Developer 설명이 맞다. 새 테스트는 여전히 (i) finish 가 reject 하지 않음(await 가 던지면 실패), (ii) 표식 되돌림 조건(같은 거래일 값일 때만), (iii) 상한, (iv) 바깥 catch → error 를 따로 지킨다. 지시한 '기존 expect 삭제·약화 금지'는 위반이 아니다.
- [00:20] 확인 2 — reject 되돌림이 타 프로세스의 정상 선점·전송을 덮지 않는다 [확실, 실DB]. 실제 mysql2 풀(기본 플래그)과 프로세스별 독립 모듈 레지스트리로 시험했다. S1 reject → 표식 `""` → 다음 틱 sent → already_sent, 전송 2회. S2 전송 도중 다른 프로세스가 다음 거래일(10-20)을 실제로 선점한 뒤 reject → 되돌림이 `"2026-10-20"` 을 덮지 않았다. S3 타 프로세스가 같은 날 먼저 선점·전송 → 나는 claim_lost, 전송 0·되돌림 0. S3b A 가 전송 중(reject 직전) B 가 같은 날 선점을 시도하면 claim_lost 이고 A 가 되돌린 뒤 재시작한 B' 가 sent, A 의 재시도는 claim_lost — 동시에 전송 중인 프로세스는 한 번에 하나뿐이었다. S4 reject 지속 → released×3 → kept → already_sent, 전송 총 4회(최초 1 + 재시도 3), 표식은 그날 값으로 남음. S5 reject 와 실패 결과 혼합도 같은 상한을 공유. S6a 독립 프로세스 3개 정상 → 전송 1건. S6b 독립 프로세스 3개 장애 지속 → 전송 시도 10회(프로세스별 상한 4회, 한 프로세스가 kept 에 이르면 나머지는 claim_lost 가 되어 12 미만). S7 어제 건 지연 되돌림이 오늘 표식을 지우지 않음. 재시도 상한은 프로세스 로컬이므로 재시작·다중 프로세스에서 늘어난다는 Developer 의 알려진 한계 ②는 실측과 일치한다(운영 instances 1).
- [%s] 확인 3 — 타임아웃 [확실]. (가) 엔진 테스트가 가짜 타이머로 1.9초 시점에는 `runAll` 이 아직 끝나지 않았고(done=false) 2.1초에 끝나며, 그 뒤 미리보기 행 0·`exit_engine_disabled` 기록·`upsertPositionState` 호출·시그널 0·요약 전송 0 을 확인한다. 정상 판독 뒤 `jest.getTimerCount()` 0, preview 테스트는 판독 예외 뒤에도 타이머 0, 늦은 켜짐 결과는 DB 쓰기·전송 0, 늦은 reject 는 unhandled rejection 0 을 확인한다. 변이 사망: 타임아웃 제거(await pending)·시간 초과 시 늦은 결과 대기·타이머 미정리·상한 1초/3.5초/10초·정책 없이 열기. (나) 실제 타이머로 확인했다: 영원히 끝나지 않는 판독에 기본 상한을 주면 2001ms 에 null 로 돌아오고, 그 시점에 남은 핸들이 없어 프로세스가 즉시 끝났다. 상한 60초를 주고 판독을 매단 채 두면 `unref` 덕분에 프로세스가 0.02초에 종료되고, `unref` 를 지운 사본은 20초 타임아웃까지 매달렸다(종료 차단 확인). (다) 늦게 도착한 policy 가 observe/finish 로 새는 경로는 없다: policy 는 race 반환값에서만 꺼내 지역 변수로 쥐고, 모듈 전역 상태·캐시가 없으며, 시간 초과 시 열기가 null 이라 `observe`/`finish` 를 가진 run 객체 자체가 만들어지지 않는다. 변이 '늦은 결과를 기다려 사용'이 엔진·preview 테스트에서 사망했다. 다음 틱은 정책을 새로 읽는다.
- [00:20] 확인 4 — R-1·R-2 보강 효과 [확실, 직접 재현]. R-1: 1차에서 생존했던 M24(동적 `import('@/lib/signals/router')`)가 사망하고, `require('@/lib/signals/service')`·policy 의 동적 `import('@/lib/safety/dry-run')`·sell-proposal.ts 의 줄바꿈 동적 import·`import type` router·템플릿 리터럴 동적 import·`routeSignal` 식별자 코드 삽입이 모두 사망했다. 수집기 자체도 표본 문자열로 자기 검증한다. 남는 사각: 지정자를 문자열 조립 변수로 만드는 `import(변수)` 는 못 잡는다(적대적 우회라 사고 방지 목적에는 충분하고, 오늘 코드에는 동적 import 가 0건이다 — NIT R-7). R-2: 1차의 M31(heldCount 0)이 사망하고 heldCount 1·+1·99 변형도 모두 사망했다(엔진 테스트 '평가 1/1종목'·'평가 2/2종목'·미루기 3틱). 1차 변이 37종 전체를 새 코드·새 테스트에 재실행하니 37/37 사망이다(1차 생존 2종 포함).
- [%s] 확인 5 — 1차 항목 회귀 없음 [확실]. engine.ts·policy·db.ts·eval-funnel-labels.ts 해시 불변이라 엔진 삽입 3곳과 판독기·시드·게이트 정의는 1차 감사 때와 바이트 단위로 같다. 신규 3파일에서 createSignal·submitOrder·approve*·routeSignal·signals/·dry-run·kill-switch·order-limits·exchanges/kis* 호출과 동적 import·require 는 0건(타입 import `Market` 하나만 exchanges 를 가리킨다)이다. 1차 실DB 시험을 새 코드로 다시 돌렸다: 부팅 시드 false/6/5/1, 운영자 값(true/8) 부팅 후 보존, 스위치 `true` 만 켜짐(나머지 9개 형태 꺼짐)·임계값 무효 시 전체 꺼짐, 단일 풀 20 claim → 1, 같은 값 UPDATE affectedRows 0, 6개 동시 finish → 전송 1, 전체 실패 → released×3 → kept → 전송 4회. 별도 프로세스 4개 × 8 동시 = 32 claim(배리어 79초 전 준비, 시작 편차 0ms) → 정확히 1건.
- [00:20] 확인 6 — Developer 가 밝힌 새 위험 ⑦은 합리적 트레이드오프다 [가능성 높음]. 근거 1: 실제 `dispatchAlert` 는 채널별 `attempt()` 가 예외를 결과로 바꾸고 `getChannel` 이 DB 오류를 삼켜서, 운영 코드에서 reject 가 나올 경로가 사실상 없다 — reject 처리는 방어 코드다. 근거 2: '채널에는 전달됐는데 응답 타임아웃으로 실패 판정'이 만드는 중복은 1차에도 이미 있었다(`sendTelegramAlert` 가 fetch 예외를 실패 결과로 돌려주면 전 채널 실패 → 되돌림 → 재시도). 즉 새 위험이라기보다 기존 위험이 reject 모양까지 확장된 것이고, 상한 3회로 한 프로세스·하루·시장당 최대 4통이다. 읽기 전용 정보성 요약이라 누락보다 중복을 택한 결정에 동의한다. 정책 판독 2초 상한이 SELECT 를 취소하지 않고 풀 연결을 붙잡는 점(Developer 한계 ④)은 직전 `readExitEngineSwitch` 가 같은 테이블·같은 풀에 타임아웃 없이 의존하므로(코드 확인) DB 가 멈추면 이 지점에 오기 전에 이미 멈춘다 — 새 장애 유형이 아니다.
- [00:20] R-7 (NIT) 소스 수준 금지 검사는 지정자가 리터럴일 때만 잡는다(`import(변수)`·문자열 조립은 통과 — 변이 R1h 생존). 적대적 우회까지 막는 것은 이 테스트의 목적이 아니고 현 코드엔 0건이라 조치 불필요. R-8 (NIT) `unref` 를 검증하는 자동 테스트가 없다(변이 N10 생존). 실행 환경(Next 서버)에는 다른 핸들이 있어 운영 영향은 없고, 스크립트·테스트 프로세스 종료에만 영향을 주며 위 (3-나)에서 수동으로 확인했다. R-9 (NIT) 제안: 시계 예외 시험('요약 처리 중 예상 밖 예외')은 `now()` 가 첫 호출에서 던져 선점 이전 경로만 지킨다. 선점 이후·전송 이전 예외에서 '표식 유지(at-most-once), 재전송 없음' 은 시험으로 고정돼 있지 않다. R-10 (NIT) `releaseDailyReport` 자체가 실패(DB 오류)해도 결과 라벨은 `send_failed_released` 이고, 이 경우 표식이 오늘 값으로 남아 다음 틱은 claim_lost 가 되어 그날 재시도가 조용히 끝난다(중복보다 누락, 진단 라벨만 부정확). R-11 (NIT) `POLICY_READ_TIMEOUT_MS` 주석의 'mysql2 연결 대기(connectTimeout 10초)'는 새 연결 수립 한도이고 풀 큐 대기(queueLimit 0)는 무한이다 — 그래서 2초 race 가 더 유용하다는 결론은 같다. 모두 차단 사유가 아니다.
- [00:20] 확인하지 못한 것(2차): ① `next build`·실제 텔레그램 실전송 ② 운영 NAS MariaDB 버전·설정(시험은 11.8.8 기본) ③ 실제 DB 지연 상황에서의 2초 상한 발동 빈도(운영 데이터 접근 없음) ④ 타 세션 미커밋 변경과 함께 돌린 전체 jest·tsc ⑤ Codex 지적 원문 대조(`## Codex C2` 절의 요약을 읽기만 함) ⑥ 스위치를 켠 뒤의 운영 동작(켜는 UI 없음 — DB 에 JSON 불리언 true 직접 기입). 커밋 시 주의(R-6)는 그대로다: 스테이징은 아래 scope 의 10개 파일만.
- [00:20] 2차 종합 의견: 신규 CRITICAL 0 · MAJOR 0, 1차 MINOR R-1·R-2 는 해소됨, 신규 NIT 5(R-7~R-11). Codex high(reject 영구 누락)·medium(열기 무기한 대기)은 코드·실DB·실타이머 시험으로 해소를 확인했고, 하루 1회 표식의 동시성(32 claim → 1)과 fail-closed 판독·시드 보존은 회귀가 없다. QA 인계 추가 확인점: sell-proposal-preview.ts 82-93·207-236(정책 판독 상한), 342-381(finishReport 전송 실패 처리·되돌림), 엔진 테스트의 타임아웃·보유 수 시나리오.
- [00:20] **최종 판정: PASS (scope: src/lib/strategy/sell-proposal.ts, src/lib/strategy/sell-proposal-policy.ts, src/lib/strategy/sell-proposal-preview.ts, src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/db.ts, src/lib/strategy/__tests__/sell-proposal.test.ts, src/lib/strategy/__tests__/sell-proposal-policy.test.ts, src/lib/strategy/__tests__/sell-proposal-preview.test.ts, src/lib/strategy/__tests__/engine-sell-proposal-preview.test.ts)**

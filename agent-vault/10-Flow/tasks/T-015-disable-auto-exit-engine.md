---
task-id: T-015
project: StockInvest
created: 2026-08-09
updated: 2026-08-09
status: review
tags:
  - type/task
  - domain/safety
  - domain/strategy
aliases:
  - 자동 청산 엔진 비활성화
  - exit engine master switch
  - exit_engine_enabled
related_tasks:
  - "[[T-012-zero-price-snapshot]]"
---

# T-015 · 자동 청산 엔진 마스터 스위치 (자동 매도 중단)

## 목표 (사용자 결정)

시스템이 **사람 동의 없이 자동으로 매도하는 동작을 전면 중단**한다. 대상은 exit-engine 이
만드는 네 종류 전부 — `hard_stop` · `eod_loss_cut` · `trailing_stop` · `target_profit`.

전제 조건:
- 코드는 **삭제하지 않는다.** 되돌릴 수 있는 스위치여야 한다.
- 기존 `exit_hard_stop_enabled` 패턴(런타임 `system_config` 판독)을 그대로 재사용한다.
- **매수 파이프라인은 절대 건드리지 않는다.**
- `position_state`(진입가·트레일링 고점) 추적은 **계속 살아 있어야 한다.**
- 꺼진 상태가 **오해될 수 없어야 한다.**

## 배경 — 왜 지금인가 (자금 위험)

- `safety_kill_switch=true` 가 현재 **모든 주문**을 막고 있다 (941건 `blocked_by='kill_switch'`).
- 사용자는 이 작업이 검증·배포된 **뒤에** 킬스위치를 내릴 예정이다. 순서가 의도적이다 —
  자동 청산이 살아 있는 채로 킬스위치를 풀면 −13% ~ −46% 포지션들에 **즉시 시장가 매도**가 나간다.
- 즉 **이 변경이 킬스위치를 안전하게 해제할 수 있게 만드는 조건**이다.
- `exit_hard_stop_enabled` 는 이미 운영에서 `false`(hard_stop 만 개별 OFF). 나머지 3종은 살아 있었다.

## 설계 결정

### 1. 스위치: `system_config.exit_engine_enabled`

| 값 | 의미 |
|---|---|
| `true` (정확히) | 자동 청산 **활성** — 변경 전과 100% 동일 동작 |
| `false` / 키 없음 / 해석 불가 / DB 조회 실패 | 자동 청산 **비활성** |

판독기는 `src/lib/strategy/exit-switch.ts` 단 하나. 엔진·설정 API·부팅 배너가 **전부 같은
함수**를 쓴다 (화면이 엔진과 다른 추정을 하면 그 순간 UI 가 거짓 보호막을 약속하게 된다).

### 2. 기본 방향: **fail-closed (비활성)** — 형제 플래그와 반대

`exit_hard_stop_enabled` 는 DB 실패 시 **활성**으로 떨어진다. 그건 "보호 장치는 켜 두는 쪽이
안전"하기 때문이고 맞다. 이 마스터 스위치는 목적이 반대다:

- 실패 방향 A(잘못 켜짐): DB 블립 한 번에 −46% 포지션이 시장가로 청산된다. **되돌릴 수 없다.**
- 실패 방향 B(잘못 꺼짐): 포지션을 계속 들고 있는다. 로그·UI·텔레그램으로 즉시 드러나고 값 하나로 복구된다.

A 가 비가역, B 가 가역이므로 B 를 택한다. 프로젝트에 같은 원칙이 이미 있다 —
`autopilot_mode='auto'`(무인 주문 송신)는 **명시적 직접 기입으로만** 도달 가능하다
(`signals/router.ts`). 자동 매도도 동일하게 **명시적 opt-in** 으로만 켜진다.

부팅 시드도 `INSERT IGNORE ... 'false'` 라, 운영자가 나중에 켠 값을 재부팅이 되돌리지 않는다.

### 3. 차단 위치: `evaluateExit` **뒤**, `createSignalGuarded` **앞**

```
ticker 조회 → upsertPositionState(고점 갱신) → loadPositionState
   → evaluateExit(순수 함수)          ← 계속 실행 (부작용 없음)
   → 🔕 마스터 스위치 게이트          ← 여기서 끊는다
   → exit 쿨다운 → createSignal → submitOrder
```

이 위치를 고른 이유:
1. `createSignal` 이 이 심볼의 **유일한 주문 경로**다. 그 앞에서 끊으면 주문은 확실히 없다.
2. 고점 추적(`upsertPositionState`)이 **이미 실행된 뒤**다 → 재활성 시 트레일링 기준선이 정확하다.
3. `evaluateExit` 를 그대로 돌려서 **"껐지만 무엇이 발화했을 뻔했는가"** 를 `eval_funnel`
   (`exit_engine_disabled`)에 남긴다. 깜깜이로 끄지 않는다.
4. 차단 시 **쿨다운을 걸지 않는다** — 차단은 "시도했다"가 아니다. 다시 켜면 즉시 정상 평가된다.

### 4. 청산 시그널 생산자는 하나뿐임을 확인

`exit_kind` 인디케이터를 만드는 곳은 `exit-engine.ts`의 `buildSellSignal` 뿐이고,
그 유일한 호출자가 `evaluateExit`, 그 유일한 호출자가 `runExitEngine` 이다
(테스트 제외). 따라서 게이트 1개로 네 종류가 모두 막힌다.
`routeSignal` 의 `FORCED_AUTO_EXIT_KINDS`(hard_stop·eod_loss_cut 강제 자동제출) 분기는
**손대지 않았다** — 생산자가 없으므로 도달 불가이고, 재활성 시 종전 동작이 정확히 복원되어야 한다.

## 변경 파일

| 파일 | 내용 |
|---|---|
| `src/lib/strategy/exit-switch.ts` (신규) | 스위치 판독기 + 사람이 읽는 요약 문구. 단일 판독 출처 |
| `src/lib/strategy/engine.ts` | `runExitEngine` 마스터 게이트, 반환형 `number → ExitEngineRunResult`, 틱 로그·스로틀 알림, `run` 행에 `exitTrack` 기록 |
| `src/lib/strategy/eval-funnel-labels.ts` | 게이트 `exit_engine_disabled` (stage 25) + 한글 라벨 |
| `src/lib/db.ts` | `exit_engine_enabled` 부팅 시드(INSERT IGNORE, `false`) + 부팅 배너 |
| `src/app/api/settings/safety/route.ts` | GET 에 `exitEngineEnabled`/`exitHardStopEnabled`/`exitSwitchSource`/`exitSwitchSummary`, PATCH 허용 키 + 엄격 불리언 검증 + 변경 감사 로그 |
| `src/app/settings/SettingsPage.tsx` | "자동 청산 엔진" 토글 + OFF 경고 박스, 기존 "손절은 승인 없이 즉시 주문" 안내를 상태별 분기 |
| `src/app/strategy/components/AnalystStatusBanner.tsx` | `자동청산 OFF` 칩 + 배너 경고 |
| `src/app/analytics/components/TrailingStopTab.tsx` | 종목별 **"손절가"** 를 숫자로 보여주던 화면 — OFF 시 배너 + `손절가(미실행)`·`조건 충족(미실행)` 라벨로 교정 |
| `src/lib/strategy/__tests__/exit-switch.test.ts` (신규) | 판독기 계약 14건 |
| `src/lib/strategy/__tests__/engine-exit-disabled.test.ts` (신규) | 엔진 레벨 계약 22건 |

## 검증

- `npm run typecheck` → exit 0
- `npm test` → **80 suites / 1161 tests, 전부 통과** (baseline 78/1125 → +2 suites, +36 tests, 회귀 0)

## 남긴 것 (의도적으로 하지 않음)

- `safety_kill_switch` · `exit_hard_stop_enabled` 값은 **건드리지 않았다** (사용자 지시).
- 룰 전략이 만드는 일반 매도 시그널(`ma-cross` 데드크로스, `rsi-overbought-exit` 등)은 그대로다.
  이들은 자동 청산이 아니라 **승인 경로**를 타므로 이번 범위 밖이다.
- `routeSignal`의 강제 자동제출 분기 미변경 (위 §4 참조).
- 커밋·푸시 없음. DB 수기 변경 없음. `system_config` 값은 부팅 시드 코드로만 다룬다.

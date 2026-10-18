---
task_id: T-046
title: post-market 시나리오 카드의 valid_from·expires_at 이 UTC 문자열로 저장돼 9시간 어긋난다 — 카드가 개장 전에 만료되어 한 번도 실행되지 못했다 (구현 중 — 사용자 승인 2026-10-18)
status: in-progress
priority: high
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-045, T-043, T-048, T-047, T-042, T-044]
tags:
  - type/task
  - domain/signals
  - domain/strategy
  - domain/safety
aliases:
  - 시나리오 카드 시간대 오류
  - post-market timezone bug
created: 2026-10-17
updated: 2026-10-18
---

# T-046 — post-market 카드 시간대 오류 (T-045 독립 감사 R-2, Leader 재검증) · 설계안

> 설계안(2026-10-18 저녁)에 대한 **사용자 결정을 받아 구현 중**이다(아래 "사용자 결정"). 이 변경은 시나리오 카드를 **처음으로 실주문을 낼 수 있게** 만든다.

## 1. 사실 (2026-10-17~18 읽기 전용 실측)

- DB 서버 시간대 = **KST**(`NOW()` 23:35 ↔ `UTC_TIMESTAMP()` 14:35), 앱 풀도 `timezone: '+09:00'`(`src/lib/db.ts:47`).
- `post-market-engine.ts` 는 `validFromDate.toISOString()`(**UTC**) 문자열을 KST `DATETIME` 컬럼에 그대로 넣는다. 의도: 다음 거래일 **09:00** 에 유효, **15:30** 에 만료. 실제 저장: `valid_from = 해당일 00:00:00`, `expires_at = 해당일 06:30:00`(KST 로 읽힘). **post-market 카드 46장 전부** 같은 값.
- **주문과 연결된 카드(`consumed_order_id`) 0장.** 상태: expired 38 · pending 4 · approved 2(주문 없음) · superseded 2.
- 만료 판정은 모두 `expires_at` 을 DB 시각(`NOW()`)으로 본다: `signal-expiry`(30분마다) · `entry-watcher`(장 중에만 돎, 09:00 에 처음 볼 때 이미 06:30 이 지남) · 승인 전이(`expires_at > NOW()`) · `/api/signals`·`/api/favorites` 목록. → 카드는 **대상일 06:30 KST 전까지만 승인할 수 있고, 승인해도 장중에 실행될 수 없다.**
- `valid_from` 소비자: `entry-watcher`(`valid_from <= NOW()`) · 대시보드 "진입 가능: …" 표시(지금은 "00:00" 으로 보인다) · 생성하는 엔진뿐.

## 2. 새로 확인한 사실 — **설계 판단에 직접 영향**

| # | 사실 | 의미 |
|---|---|---|
| 1 | **`exit_engine_enabled = false`** (부팅 배너 "자동 청산 엔진 OFF — 하드손절·EOD손절·트레일링스탑·목표익절이 자동 매도 주문을 내지 않습니다") | 카드가 실행돼 포지션이 생겨도 **자동 손절·익절·보유기한 청산이 없다.** 카드의 `target_pct`/`stop_pct`/`holding_deadline` 은 `position_state.scenario_exit` 에 저장되지만 청산 엔진이 꺼져 있어 쓰이지 않는다 → **무방비 진입.** 사용자가 직접 관리해야 한다. |
| 2 | **카드 금액은 10만 원 고정**(`amount_krw=100000`), 주문은 1주 단위 | 최근 post-market 카드 38장 중 **26장은 수량 0**(1주가 10만 원 초과 → 주문 자체가 안 나감, `quantity_below_min`), 12장만 주문 가능. 현재 대기 카드 4장 중 주문 가능한 것은 **#19078 신한지주(1주 ≈93,000원) 한 장**. |
| 3 | **현금 80,138원**(보유 종목은 삼성전자 9주·SK하이닉스 1주·해외 종목들, 총자산 20,076,977원) | #19078(≈93,000원)도 현금이 모자라 **거래소가 거부**한다 → 확정 거부는 선점을 되돌려 **다음 틱에 다시 시도**한다(1분마다). 과거에도 자동 주문 거부 1,716건이 쌓인 이력이 있다(마지막 8/12) — 이 반복 경로는 이미 한 번 겪었다. |
| 4 | `docs/trading-strategy.md` 는 "**백테스트 미검증 상태**"라고 적고, 이 프로젝트 금기 사항에 "**백테스트 미검증 전략의 실매매 운용 금지**"가 있다 | 카드 전략(eod-high-close·inside-bar·oversold-bounce)의 백테스트 검증 이력은 확인하지 못했다. 현재 방어는 **카드를 사용자가 직접 승인**해야 한다는 점(`autopilot_mode=assist`)뿐이다. |
| 5 | **총자산 10-08 24,499,965 → 10-17 20,076,977 (−18.1%)** (일별 −1.8·−4.6·−3.4·−1.4·−0.8·−4.7·−1.2·−1.5%) | 원인 미분석(보유 종목 평가 변화로 보이나 확정 아님). 하락장에서 무방비 진입을 늘리는 변경이라는 맥락. |

→ **T-046 을 배포해도 당장 주문이 나갈 가능성은 낮다**(수량 0 · 현금 부족). 다만 *구조는 처음으로 끝까지 작동하게* 되고, 현금이 늘거나 싼 종목 카드가 승인되면 청산 엔진 없이 진입한다.

## 3. 제안 — 변경 범위

| # | 변경 | 파일 | 비고 |
|---|---|---|---|
| A | 카드의 `valid_from`/`expires_at` 을 **KST 문자열**로 저장(09:00 / 15:30). `Date` 에 +9h 한 뒤 포맷하는 `toKstDatetime()` | `post-market-engine.ts` | 핵심 수정. `nextTradingDayOpen()`(00:00Z=09:00 KST)은 그대로 쓰고 변환만 바꾼다. `holding_deadline`·프롬프트의 날짜 부분은 영향 없음(확인함) |
| B | `insertScenarioCardIfAbsent` 가 `ER_DUP_ENTRY`(1062)를 `duplicate` 로 처리 | `post-market-engine.ts` | T-048 유니크 인덱스에서 동시 삽입에 진 쪽이 `insert_fail` 로 보고되던 것을 정리 |
| C | 오래된 무번호 `executing` **자동 경보**(틱마다 `status='executing' AND consumed_order_id IS NULL AND updated_at < NOW()-10분`, 스로틀) | `entry-watcher/route.ts` | T-043 감사 R-1. 선점 뒤 프로세스 사망 시 무음이던 것 |
| D | 중복 검사는 **정확 일치 유지** + 배포 전 점검 SQL | (코드 변경 없음) | 새 카드는 항상 09:00 이고 대상일이 구 카드와 겹치지 않는다(아래 4절) → `DATE(valid_from)` 로 바꿀 필요 없음. 전환 위험을 점검 SQL 로 확인 |
| — | **제외**: 청산 엔진 · 공휴일을 건너뛰는 다음 거래일 계산 · 현금 사전 점검 · 카드 전략 백테스트 · 대시보드 "주문 실행됨" 문구(화면) | | 별도 task. 문구 정정은 화면 변경이라 데모 게이트 대상 → **T-049 로 분리** 권고 |

## 4. 기존 대기 카드 4장(#19077~19080, 월 10-19용)

- 이 카드들은 `valid_from 10-19 00:00 / expires_at 10-19 06:30` 으로 저장돼 있어 **월요일 06:30 에 자연 만료**된다. 코드 수정과 무관하게 월요일 장중에 실행되지 않는다.
- **권고(A안): 건드리지 않는다.** 월요일 16:00 post-market 이 *새 코드로* 화요일용 카드를 만들고, 그것이 첫 실행 가능 카드가 된다 → 월요일은 T-043/T-045 를 *개장 중 운영*에서 관찰하는 완충일이 된다. 구 카드(10-19)와 새 카드(10-20)는 대상일이 달라 중복 검사·유니크 인덱스에서 충돌하지 않는다.
- 대안(B안): 4장의 시각을 `UPDATE` 로 보정(`09:00/15:30`)해 월요일에 승인·실행 가능하게 한다. 월요일 06:30 전에 코드 배포와 데이터 보정이 모두 끝나야 하고, 첫 실행 경로를 서두르게 된다 → **권하지 않는다.**

## 5. 배포 시점·순서

1. 구현 → 테스트 → 변이 → 실DB 롤백 검증 → 독립 감사 → judge C2/Codex → 커밋. (T-043·T-045 와 같은 절차)
2. **장외에 배포**(월 07:00~08:30 또는 월 15:30 이후). 월요일 16:00 실행 전에 새 코드여야 화요일 카드가 올바른 시각으로 생성된다.
3. 배포 직후: `post-market` 을 수동 호출하지 **않는다**(평일 호출은 카드를 만든다) — 확인은 월요일 16:00 자동 실행 로그로(`valid_from … 09:00:00`, `expires_at … 15:30:00`).
4. 롤백: 이전 릴리스로 되돌린다. 새 형식으로 만들어진 카드는 시각만 맞을 뿐 구조는 같아 되돌려도 해가 없다.

## 6. 시험 계획

- 단위: `toKstDatetime` 경계(금 16:00 KST → 월 09:00/15:30, 일요일 스킵과의 조합, 자정 전후 UTC/KST 날짜 차이), 엔진 INSERT 파라미터(`valid_from`·`expires_at` 새 값), `ER_DUP_ENTRY` → `duplicate`, 무번호 `executing` 경보(상태를 가진 가짜 DB: 10분 전/후, 번호 있음/없음, 스로틀).
- 변이: 오프셋 제거·부호 뒤집기·`06:30` 복귀·1062 매핑 제거·경보 조건 완화.
- 실DB(롤백 트랜잭션): 새 형식 카드가 `entry-watcher` 조회(`valid_from <= NOW()`)·`signal-expiry`(`expires_at < NOW()`)·승인 전이(`expires_at > NOW()`)에서 *09:00~15:30 에만 유효*한 것으로 평가되는지 — `NOW()` 기준 상대 시각으로 합성해 확인.
- 기존 테스트(`post-market-engine.test.ts`)가 `'…06:30:00'`·`'…00:00:00'` 을 정답으로 고정하고 있으므로 같이 고친다.

## 7. 위험과 완화

| 위험 | 완화 |
|---|---|
| 카드가 처음으로 끝까지 작동 → 청산 엔진 없이 진입 | **결정 요청 2** — 카드가 승인돼야만 주문이 나감(사용자 승인이 유일한 관문) |
| 현금 부족으로 거부가 1분마다 반복 | 기존 동작(T-043 이후에도 선점→거부→복귀 반복). 현금 사전 점검은 별도 task 후보 |
| 시각 계산 오류가 반대로 늦게/일찍 만료 | 단위·변이·실DB 로 경계 시험, 월요일 16:00 실행 로그로 첫 관측 |
| 구·신 카드 혼재 | 4절: 대상일이 겹치지 않음. 배포 전 점검 SQL(`valid_from` 이 `00:00:00` 이 아닌 post-market 행이 없음 / 신 형식 대상일과 겹치는 구 카드 없음) |

## 사용자 결정 (2026-10-18 저녁, "위의 방안으로 작업진행해줘 / 청산엔진 a안 / 제안한 방안으로 진행해줘 / 분리해서 작업해줘")

| # | 결정 | 근거 |
|---|---|---|
| 1 | **착수 승인**: 3절 A·B·C·D 로 구현 | 사용자 "1. 위의 방안으로 작업진행해줘" |
| 2 | **청산 엔진 = (a)**: `exit_engine_enabled=false` 유지, 진입 포지션은 **사용자가 직접 청산** | 사용자 "2. 청산엔진: a안으로 진행해줘" |
| 3 | **백테스트 미검증 규칙·기존 대기 카드 4장 → Leader 권고안 수락**: 카드는 사용자가 건별 승인(assist)하는 구조 유지, 대기 카드 4장(#19077~19080)은 건드리지 않고 월요일 06:30 자연 만료 | 사용자 "3. 제안한 방안으로 진행해줘" — 번호가 하나 비어 있어 남은 두 질문(Q3·Q4)의 권고안 수락으로 **Leader 가 해석**(사용자에게 알림) |
| 4 | **UI 문구는 T-049 로 분리** | 사용자 "4. 분리해서 작업해줘" |

> 카드를 승인하기 전에 알아 둘 점(사용자 확인 사항 아님, 기록): 청산 엔진이 꺼져 있어 카드로 진입한 포지션은 자동 손절·익절·보유기한 청산이 없다. 카드 금액은 10만 원 고정·1주 단위이며 현금이 모자라면 거래소가 거부한다.

## 8. (참고) 결정 요청 — 위 결정으로 갈음

1. **착수 승인**: 위 3절 A·B·C·D 로 구현을 진행해도 되는가(첫 실행 가능 카드가 화요일 이후에 생김).
2. **청산 엔진**: 카드 실행을 허용하기 전에 어떻게 할 것인가 — (a) 현 상태 유지: 진입 포지션은 사용자가 직접 청산 (b) 청산 엔진을 별도 task 로 검증해 켠 뒤 (c) 카드 승인은 계속 하지 않는다. *Leader 권고: (a) 를 알고 쓰되, 카드 승인은 1주 단위 소액이고 청산은 사용자가 직접 한다는 점을 문서에 명시.*
3. **백테스트 미검증 규칙**: 프로젝트 금기 사항("백테스트 미검증 전략의 실매매 운용 금지")과 이 카드 전략의 관계를 사용자가 명시적으로 승인하는가(카드는 사용자가 건별 승인).
4. **기존 대기 카드 4장**: 자연 만료(권고 A) vs 시각 보정(B).
5. **UI 문구**(대시보드 "주문 실행됨" → "처리 중/확인 필요"): T-049 로 분리(권고).

## 선행 조건 (T-045·T-043 감사, 기록)

1. ✅ **[완료 2026-10-18, T-048]** 유니크 인덱스(또는 직렬화)가 먼저 또는 같이 나가야 한다.
2. ✅ **[완료 2026-10-18, T-048 — 중복 4그룹의 초과 6행을 `post-market-dup-<id>` 로 정리하고 인덱스 `uq_signals_scenario_card` 생성]** 마이그레이션 사전 조건.
3. **키 설계**: T-046 이 `valid_from` 값(00:00 → 09:00)을 바꾸므로 `NOT EXISTS`·유니크 인덱스(정확 일치)와의 정합성이 필요하다 → 위 4·D 절로 해소(새 카드 대상일이 구 카드와 겹치지 않음, 배포 전 점검 SQL).
4. **코드 → 마이그레이션 순서**: 마이그레이션이 먼저 끝났으므로 B(`ER_DUP_ENTRY` 매핑)는 이번에 함께 낸다.
5. 프로세스 내 실행 중 표식·`GET_LOCK` 은 유니크 인덱스로 불필요해졌다.
6. **T-043 감사 R-1**: 오래된 무번호 `executing` 자동 경보 → 3절 C.
7. **T-043 감사 R-7(표시 문구)**: 3절 제외 항목, T-049.

## Developer (구현·검증 기록, 2026-10-18)

감사 대상 파일과 해시(SHA-256 앞 12자리) — Reviewer 가 본 버전과 커밋될 버전이 같은지 이 표로 대조한다.

| 파일 | 해시 | 변경 |
|---|---|---|
| `src/lib/strategy/post-market-engine.ts` | `ac24a8d0c112` | A: `toKstDatetime()` 도입·`valid_from`/`expires_at` KST 저장 · B: `isDuplicateKeyError`(errno 1062 / `ER_DUP_ENTRY`) → `duplicate` |
| `src/lib/signals/entry-claim.ts` | `ed9cdf148b9d` | C: `findStuckExecutions()` 추가 (기존 `claimEntrySignal`·`releaseEntryClaim`·`recordEntryOrder` 불변) · 선점 시각을 KST 벽시계로 반환(Reviewer R-1) |
| `src/app/api/cron/entry-watcher/route.ts` | `d48a266e1a10` | C: `alertStuckExecutions()` — critical·스로틀 1시간·본문 10줄 상한·실패해도 주문 경로 계속 · 본문 시각에 ` KST` 표기(R-1) · 스로틀 키에 멈춘 ID 집합 포함(Codex C2) |
| `src/lib/strategy/__tests__/post-market-engine.test.ts` | `2fe89ce10093` | KST 기대값(`09:00:00`/`15:30:00`) · `toKstDatetime` 경계 · 1062 매핑 |
| `src/lib/signals/__tests__/entry-claim.test.ts` | `04ffb6c469c6` | `findStuckExecutions` · KST 벽시계·날짜 경계·문자열 통과 |
| `…/entry-watcher/__tests__/claim.test.ts` | `9ada93df26ec` | 경보 시험(본문 KST 는 `Intl` 독립 계산으로 단언) · 스로틀 키 집합별 시험 · `'stuck-check'` 이벤트 무시하는 순서 시험 |
| `…/entry-watcher/__tests__/fakeSignalsDb.ts` | `ff4f594e06bb` | 상태 가진 가짜 DB 에 stuck 조회 지원 |
| `…/entry-watcher/__tests__/sizing.test.ts` | `40cc331fdfa0` | 가짜 DB 변경 따라가는 최소 수정 |

**설계 결정 (D 항목 — 코드 변경 없음):** 새 카드는 항상 09:00 이고 대상일이 구 카드(00:00)와 겹치지 않아 중복 검사는 정확 일치를 유지한다. 대신 배포 직전 점검 SQL 로 확인한다(아래 배포 체크).

**검증 결과**

| 항목 | 결과 |
|---|---|
| 대상 5 suite | 100 테스트 통과 (최종 버전, Reviewer 가 TZ 3종에서도 확인) |
| **격리 사본 전체**(HEAD `d27e08f` + 위 8개 파일만 덮어씀) | `tsc` 오류 **0** · jest **144 suite / 2962 테스트 전부 통과** (최종 버전. 첫 구현 시점은 2960) |
| 변이 시험 (격리 사본 `scratchpad/mutrepo`) | 22개 변이 전부 사망(오프셋 제거·부호 반전·`06:30` 복귀·1062 매핑 제거·경보 조건 완화·스로틀 제거 등). 약한 변이(R11 동치·R3 준동치·S6=S7)는 정당한 변이(R3b·R11b·R3c·S6b)로 교체 |
| 실DB (롤백 트랜잭션) | 새 형식 카드가 `entry-watcher` 조회(`valid_from <= NOW()`)·`signal-expiry`(`expires_at < NOW()`)·승인 전이(`expires_at > NOW()`)에서 09:00~15:30 에만 유효하게 평가됨 |
| 커밋 훅 시나리오 | `scripts/test-git-hooks.sh` 전체 통과 |

**⚠ 공유 작업 트리의 전체 jest 는 신뢰할 수 없다.** 작업 트리에는 다른 세션(T-040 api-usage 연동, T-044)의 미커밋 변경이 수십 개 있어 `tsc` 오류 4건(`src/lib/api-usage.ts` ×2·`llm/claude-cli.ts`·`strategy/ai-filter.ts`)과 jest 35 suite 실패가 나온다. 실패 목록에 post-market·entry-watcher·entry-claim 은 **하나도 없고**, 위 격리 사본에서는 전부 통과한다 → 원인이 제 변경이 아님을 사본 대조로 확인했다. 이 8개 파일 밖은 커밋하지 않는다.

**한계 (기록)**
- `nextTradingDayOpen()` 은 공휴일을 건너뛰지 않는다(T-045 부터의 알려진 한계, 제외 항목).
- 변경 후에도 `exit_engine_enabled=false` — 카드 진입 포지션의 자동 청산 없음(사용자 결정 2).
- 멈춘 `executing` 경보는 시장이 열린 틱에서만 돈다(Reviewer R-2) — 국내 마감 직전 선점 뒤 사망하면 다음 개장(미국장 약 22:30 KST 포함)까지 무음. 배포 차단 사유 아님.
- 경보 스로틀은 프로세스 로컬이다(Codex low) — `instances: 1` 이고 재시작 시 초기화는 `throttle.ts` 의 의도라 변경하지 않는다. 인스턴스를 늘리면 재검토.
- **현금이 카드 1주 가격보다 적을 때 승인하면** 선점→거래소 거부→복귀가 매 분 반복된다(T-043 부터의 동작, 카드당 하루 최대 약 390회 `orders`/`trade_logs` 행과 KIS 호출). 현재 현금 약 8만 원 < #19078 신한지주 약 9.3만 원 — 현금 사전 점검은 별도 task 후보.

## Codex C2 (외부 읽기 전용 검토, 2026-10-18)

- judge C2: `codex_required=true` · `adversarial-review` · focus `concurrency` · 규칙 `CX-limit-unknown-r2`(R2 라 한도 미상이어도 개입) · 스위치 on. 인계서 `scratchpad/handoff-T-046-c2.md`, 실행 66초, 스냅샷에서 파일 변경 0.
- **이중 주문 경로는 찾지 못했다** — 선점·만료 조건 유지(요약).
- 지적 2건:
  1. **medium — 경보 스로틀 키가 고정이라** 한 건 경보 후 1시간 안에 다른 시그널이 새로 멈추면 그 경보가 억제된다 → **수용·수정**: 키에 멈춘 ID 집합을 넣어 같은 집합만 1시간 스로틀, 새 ID 는 즉시 경보. 시험 추가, 고정 키로 되돌린 변이 2개 테스트 실패. Reviewer 재검증 PASS.
  2. **low — 스로틀이 프로세스 로컬**이라 다중 인스턴스에서 같은 사고가 중복 통보 → **변경 없음**: `instances: 1`(실측 `pm2 jlist`), 재시작 시 초기화는 `throttle.ts` 가 의도로 문서화, 과다 통보 방향이라 주문 불변식 무관. 위 "한계"에 기록.

## Reviewer

- [18:43] 독립 감사 시작 (task T-046, 2026-10-18). 대상 8개 파일의 SHA-256 앞 12자리를 Developer 표와 대조: 작업 트리 8/8 일치, 격리 사본(`scratchpad/headrepo`, HEAD `d27e08f` + 8개 덮어씀) 8/8 일치 → 감사 대상 버전 불일치 없음 [확실]. 변이 시험은 격리 사본에서만 했고 끝난 뒤 8개 파일 해시를 원본과 재대조해 복원 확인. 작업 트리 소스는 수정하지 않았다(이 문서만 수정). DB 는 SELECT/EXPLAIN 만 사용.
- [18:43] 의도 검증: 목적은 "카드 valid_from/expires_at 을 KST 09:00/15:30 으로 저장해 개장 중 실행 가능하게 한다(A) + 동시 삽입 패배를 중복으로 정리(B) + 선점 뒤 멈춘 executing 경보(C) + 정확 일치 중복 검사 유지(D)". A·B·D 는 의도대로 구현됐다. C 는 동작하지만 경보 본문의 시각이 틀린다(R-1). 설계 문서(3절 A~D)와 코드 사이에 다른 의도 불일치는 찾지 못했다 [가능성 높음].
- [18:43] 시각 계산(요청 1) — 이상 없음 [확실]. `nextTradingDayOpen()`(`post-market-engine.ts:61-79`)은 KST 달력 날짜 D+1 의 00:00Z(=09:00 KST)를, `nextTradingDayClose()`(`:93-96`)는 +6.5h 인 06:30Z(=15:30 KST)를 돌려주고, `toKstDatetime()`(`:88-90`)이 +9h 후 포맷해 `YYYY-MM-DD 09:00:00` / `15:30:00` 을 만든다. 세 함수 모두 `getUTC*`/`setUTC*`/epoch 산술만 써서 프로세스 TZ 에 의존하지 않는다. 독립 검증: 세 함수 본문을 정규화 비교로 원본과 동일함을 확인한 뒤, 2026-01-01~2027-12-31 사이 30분 간격 35,040개 시각 × 프로세스 TZ 4종(UTC·Asia/Seoul·America/Los_Angeles·Pacific/Kiritimati)을 `Intl.DateTimeFormat(timeZone:'Asia/Seoul')` 기반 독립 오라클(KST 날짜 + 1일, 토·일 건너뜀, 09:00/15:30)과 비교 → 불일치 0. 자정 전후·월말·연말·일요일 스킵·금→월 조합 포함. jest 도 TZ 4종에서 35개 전부 통과. 공휴일은 건너뛰지 않음(알려진 한계, 안전한 방향: `isDomesticOpen()` 이 공휴일에 닫혀 있어 휴장일 카드는 실행되지 않고 만료).
- [18:43] 저장·비교 경로의 시간대 일관성(요청 2) — 이상 없음 [확실]. 실DB 조회: `@@system_time_zone=KST`, `@@session.time_zone=SYSTEM`, `valid_from`/`expires_at`/`updated_at` 모두 `datetime`(시간대 변환 없음). mysql2 풀 `timezone:'+09:00'`(`db.ts:47`) 아래에서 문자열 파라미터 `'2026-10-19 09:00:00'` 은 그대로 DATETIME 이 되고 다시 읽으면 `2026-10-19T00:00:00Z`(=09:00 KST)로 돌아온다(프로세스 TZ 를 UTC·Asia/Seoul 로 바꿔 돌려도 동일). `TIMESTAMPDIFF(MINUTE, NOW(), '2026-10-19 09:00:00')`=859 로 DB 의 `NOW()` 도 KST 벽시계임을 재확인. 읽는 쪽은 전부 DB 시각(`NOW()`)이거나 풀이 만든 정확한 `Date` 로 비교한다: `entry-watcher/route.ts:163`(`valid_from <= NOW()`)·`:182-186`(만료)·`entry-claim.ts:34`·`signal-expiry/route.ts:27`·`approval-transitions.ts:138,143`·`api/signals/route.ts:121`·`api/favorites/route.ts:34`. 화면은 `new Date(valid_from).toLocaleString` 이라 KST 단말에서 09:00 으로 보인다. UI 쪽 라벨 "KST" 는 고정 문자열(변경 없음).
- [18:43] R-1 [MAJOR] 경보 본문의 선점 시각이 UTC 이고 표기가 없다 — 9시간 어긋난다. 근거: `entry-claim.ts:106`(`r.updated_at instanceof Date ? r.updated_at.toISOString()`) → `entry-watcher/route.ts:125`(`s.updatedAt.replace('T',' ').slice(0,19)`). 풀이 `timezone:'+09:00'` 이라 `updated_at` 은 올바른 순간의 `Date` 로 오고, `toISOString()` 은 그것을 UTC 로 찍는다. 실DB 로 확인: 시그널 5330 의 DB 벽시계 `2026-05-26 23:41:05` 가 `2026-05-26T14:41:05.000Z` 로 나오므로 경보에는 "선점 2026-05-26 14:41:05"(KST 로 읽으면 9시간 전)로 찍힌다. 단위 테스트가 이 UTC 문자열을 정답으로 고정해 둔다(`entry-claim.test.ts` findStuckExecutions 의 `updatedAt: '2026-10-18T01:00:00.000Z'`). 영향: 국내장(09:00~15:30 KST = 00:00~06:30Z)에서는 날짜가 같아 덜 위험하지만, 미국장 세션(KST 22:30 이후~익일 새벽)에서 자정 이후 선점된 건은 표시 날짜가 하루 앞선다. 이 경보를 받은 사람은 "KIS 체결/미체결 내역을 확인해 주문이 나갔는지 보고, 안 나갔으면 DB 상태를 되돌리라"는 절차(`docs/telegram-approval.md` 6.1)를 따르는데, 그 되돌리기가 곧 재주문이다. 시각이 틀리면 엉뚱한 구간을 보고 "체결 없음"으로 오판해 되돌릴 여지가 생긴다 [가능성 높음 — 심볼 기준으로 조회하면 완화되나 알림 자체가 틀린 값을 준다]. 이 작업이 시간대 오류를 고치는 작업이라는 점에서도 같은 부류의 결함이 안전망 출력에 남는 것은 부적절하다. 권고: `route.ts` 의 표시 직전에 +9h 후 포맷하고 " KST" 를 붙이거나(`toKstDatetime` 재사용), SQL 에서 `DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s')` 로 벽시계를 그대로 받는다. 테스트 기대값도 같이 고친다.
- [18:43] B 매핑(요청 3) — 동작은 안전하다 [확실]. `isDuplicateKeyError`(`post-market-engine.ts:99-102`)는 `errno===1062 || code==='ER_DUP_ENTRY'` 만 인정한다. 1213(교착)·1467(AUTOINC 읽기 실패)·연결 오류·정보 없는 오류는 던져지고(`:154-157`) 호출자 루프가 `insert_fail:<심볼>:<메시지>` 로 `errors` 에 남기고 `signalsSkipped++` 한 뒤 다음 종목으로 간다(`:401-404`). 동시 삽입에서 REPEATABLE READ 의 INSERT…SELECT 는 NOT EXISTS 읽기에 갭 잠금을 걸어 한쪽이 교착(1213)이나 1467 로 지는 경우가 있는데, 그때 중복 행은 생기지 않고(이긴 쪽이 삽입) 진 쪽은 `insert_fail` 로 보고된다 — 재시도·무시가 필요 없다. 이긴 쪽이 존재하므로 카드 누락도 없다. 실제 삽입 실패를 `duplicate` 로 가리는 경로는 현재 스키마에서 없다: `signals` 의 유니크 키는 `PRIMARY` 와 `uq_signals_scenario_card` 둘뿐이고(실DB `information_schema.STATISTICS`) 1062 는 사실상 후자다. 이 분기는 단위 테스트 7개가 지킨다(1213·1467·ECONNRESET·빈 오류는 throw, 1062/ER_DUP_ENTRY 만 duplicate). cron 은 직렬이라 정상 운영에서는 동시 삽입이 없다.
- [18:43] R-2 [MINOR] 멈춘 executing 경보는 시장이 열린 틱에서만 돈다. 근거: `alertStuckExecutions` 호출(`route.ts:155`)이 국내·해외 둘 다 닫혔을 때의 조기 반환(`:146-148`)보다 뒤에 있고, 테스트 "장외에는 점검하지 않는다"가 이를 고정한다. 선점은 개장 중에만 일어나고 죽은 프로세스는 곧 대체되므로 대부분 +10분 안에 개장 중 경보된다. 다만 국내 마감 직전(15:20 이후) 선점 뒤 사망은 미국장 개장(약 22:30 KST) 또는 다음 개장 때까지 무음이다(이전 상태보다는 낫다). 설계 결정이면 Developer "한계" 절에 한 줄 추가 권고. 배포 차단 사유는 아님 [확실].
- [18:43] C 경보 나머지(요청 4) — ① `updated_at` 은 실DB 스키마가 `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` 이고(`information_schema.COLUMNS` EXTRA 확인), ② `claimEntrySignal` 이 명시적으로 `updated_at=NOW()` 를 쓰므로(`entry-claim.ts:33`) 기준 시각은 선점 시점이다 [확실]. `executing` 행을 건드리는 다른 UPDATE 는 `releaseEntryClaim`·`recordEntryOrder`(둘 다 이 경보 조건을 해소)와 `approval-transitions.ts:158`(복귀)뿐이라 시계가 중간에 리셋되지 않는다. ③ 경보는 `try/catch` 로 감싸져 던지지 않고(`route.ts:122-137`) 실패 시 `console.error` 후 주문 경로가 이어진다 — 변이(catch 를 rethrow 로 교체)가 테스트에서 죽는 것을 확인. `sendAlertThrottled` 는 동기·`sendAlert` 는 fire-and-forget 이라 알림 I/O 가 틱을 막지 않는다. 쿼리 비용: 실DB `EXPLAIN` = `ref`/`idx_signals_status`/rows 3, 매 틱 1회로 무시할 수준. 쿼리에 별도 타임아웃은 없으나 이어지는 메인 조회도 같은 DB 라 새 병목은 아니다. 지금 DB 에 경보 조건에 걸리는 행 0건이라 배포 직후 경보 폭주 없음(`executing` 3건은 모두 `consumed_order_id` 있음). ④ 스로틀 키 `entry-watcher:stuck-executing`·TTL 1시간·프로세스 메모리 `Map`(`notify/throttle.ts`) — 재시작·blue/green 전환 때 초기화되고 인스턴스마다 따로이므로 최악의 경우 인스턴스 수만큼 중복 경보(허용 가능). 해소 전까지 1시간마다 반복 경보되는 것은 의도(확인 필요 상태). ⑤ 본문은 시그널 번호·종목코드·방향·시각·고정 안내문뿐이고 키·계좌·금액은 없다. 종목코드는 `escapeAlertText` 처리.
- [18:43] T-043 불변식(요청 5) — 회귀 없음 [확실]. `git diff HEAD` 로 `entry-claim.ts` 는 `recordEntryOrder`(`:61-67`) 뒤에 추가만 있고 `claimEntrySignal`·`releaseEntryClaim`·`recordEntryOrder` 본문은 바이트 단위로 불변. `route.ts` 의 diff 는 import 한 줄 수정 + `alertStuckExecutions` 신규 함수 + 호출 한 줄뿐이고, 선점·`submitOrder`·확정 거부 복귀(`giveBackEntryClaim`)·결과 불명(`outcomeUnknown`) 잠금·후처리 예외 분기(`:344-499`)는 변경 없음. 8개 파일 밖 변경은 없다(범위 요청 7): 변경된 파일은 정확히 표의 8개이고 안전 경로 파일에 의도 밖 수정이 없다.
- [18:43] 테스트 품질(요청 6): 대상 5개 suite 98개 통과, 격리 사본 전체 jest 144 suite / 2960 테스트 통과, `tsc --noEmit` 오류 0 — Developer 보고와 일치 [확실]. 내가 만든 유효 변이 18개(격리 사본): validFrom 만 UTC 로 되돌림·expiresAt 만 UTC 로 되돌림·오프셋 제거·부호 반전·마감 +6h·1062 매핑 4종(항상 참·errno 존재만·없음·code 만)·경보 SQL 에서 `consumed_order_id IS NULL` 제거·`status` 교체·catch 를 rethrow 로·TTL 1분·level warning·경보 호출 삭제·경보를 조회 뒤로 이동·10건 상한 변경 → 17개 사망, 1개 생존. 생존: `toKstDatetime` 을 로컬 getter 로 구현한 변이는 TZ=Asia/Seoul 러너에서 통과하고 TZ=UTC 에서는 9개 실패로 죽는다(R-5). 옛 UTC 로직으로 되돌리면(validFrom/expiresAt 각각) 3개·2개 테스트가 실패해 이번 버그의 회귀는 잡힌다. 변이 목록 중 1개("lib 안에서 DB 오류 삼킴")는 치환 문자열이 원문과 같아 무효였고 결과에서 제외했다.
- [18:43] R-3 [MINOR, 범위 밖] 같은 UTC 문자열 패턴이 한 곳 더 남아 있다: `src/app/api/signals/custom/confirm/route.ts:134-135` — `new Date(Date.now()+24h).toISOString().replace('T',' ').slice(0,19)` 를 `signals.expires_at`(DATETIME, KST)에 바인딩해(`:170-183`) 사용자 시나리오가 24시간이 아니라 15시간 만에 만료된다. 실행 방향은 일찍 만료(보수적)라 자금 위험은 아니지만 사용자에게 보이는 결함이다 [확실 — 패턴·컬럼 타입·풀 시간대 근거]. 이 파일은 안전 경로(`^src/app/api/signals/`)라 이번 커밋에 끼워 넣지 말고 별도 task 로 감사받길 권고. 그 밖의 `toISOString` 사용은 표시·프롬프트·메타 용도로 DB 시각 컬럼에 쓰이지 않음을 grep 으로 확인(`src`·`scripts`).
- [18:43] R-4 [NIT] `isDuplicateKeyError` 가 키 이름을 보지 않는다(`post-market-engine.ts:99-102`). 현재는 유니크 키가 둘뿐이라 안전하지만, 예컨대 AUTO_INCREMENT 값이 꼬여 `PRIMARY` 가 충돌하면 실제 삽입 실패가 `duplicate` 로 분류돼 카드 누락이 조용히 숨는다. 에러 메시지에 `uq_signals_scenario_card` 가 있는지까지 보면 좁혀진다(기존 테스트의 `dupErr` 메시지에 키 이름이 이미 들어 있어 호환).
- [18:43] R-5 [NIT] 시각 테스트가 러너의 TZ 에 기대는 변이를 KST 환경에서는 못 잡는다(위 생존 변이). 운영 서버는 KST 라 실해는 없고, 테스트에서 프로세스 TZ 를 UTC 로 고정(`process.env.TZ`/jest `globalSetup`)하거나 CI 에 UTC 실행을 추가하면 닫힌다.
- [18:43] R-6 [MINOR, 절차] 사용자 결정 3(백테스트 미검증 금기와 카드 실행의 관계)과 결정 4 는 "번호가 하나 비어 있어 Leader 가 권고안 수락으로 해석"한 것이다(이 문서 "사용자 결정" 절). 질문 5개에 답이 4개였고, 프로젝트 금기("백테스트 미검증 전략의 실매매 운용 금지")는 이번 배포가 카드를 처음 실행 가능하게 만드는 순간 사실상 예외가 된다. 코드 결함은 아니며 Leader 가 사용자에게 알렸다고 적혀 있으나, 배포 직전에 해당 항목을 한 번 더 명시적으로 확인받길 권고한다 [가능성 높음 — 해석의 문제이며 사용자 의도를 내가 확인한 것은 아님].
- [18:43] R-7 [NIT] `docs/telegram-approval.md` 116행이 "틱에서 자동 경보하는 것은 T-046 선행 조건이다"라고 적고 있어 C 가 들어가면 낡은 서술이 된다. 이 문서는 다른 세션(T-044)의 미커밋 변경이 섞여 있어 이번 감사에서 건드리지 않았다. 커밋 후 Leader 가 갱신하길 권고.
- [18:43] 참고(비결함) 2건: (a) 카드가 개장 중 실행 가능해지면 현금 부족(현재 약 8만 원) 상태의 승인 카드는 이미 알려진 T-043 동작대로 선점→거부→복귀를 매 분 반복한다(주문당 `orders`/`trade_logs` 행과 KIS 호출 1회, 하루 최대 약 390회/카드). 수량 0 카드는 매 분 `trade_logs`(`sizing_below_min_qty`) 1행이다. T-046 문서 2절 3·7절이 이미 인정한 위험이며 현금 사전 점검은 별도 task 후보. (b) 즉시 주문 승인 경로(`approveSignal`)는 `valid_from` 을 보지 않는다 — 운영 DB 의 `hybrid_mode_enabled=true` 라 카드 승인은 `approved_pending_entry`(진입 감시) 경로를 타므로 지금은 영향 없고, 하이브리드를 끄면 미래 `valid_from` 카드도 승인 즉시 주문된다(이번 변경과 무관한 기존 동작). 참고로 실DB `safety_dry_run=false`(`.env` 의 `DRY_RUN=true` 는 DB 값이 덮어씀)·`safety_kill_switch=false`·`exit_engine_enabled=false` 이므로 실주문 가능 상태다 — 이 변경은 그 상태에서 카드를 처음 실행 가능하게 한다.
- [18:43] QA 인계(high_risk_areas): ① R-1 수정 후 `route.ts:121-138` 경보 본문의 시각(KST 표기) 재확인 ② 배포 전 점검 SQL — post-market 행의 `TIME(valid_from)` 이 전부 `00:00:00`(현재 40행 모두 그렇다), 신 형식 대상일과 겹치는 구 카드 없음 ③ 월요일 16:00 자동 실행 로그의 `valid_from=… 09:00:00`·`expires_at … 15:30:00` 과 생성 행의 `TIME(valid_from)='09:00:00'`·`TIME(expires_at)='15:30:00'` ④ 신 카드를 승인했을 때 09:00 이전 틱에서는 `entry-watcher` 조회에 안 잡히고 09:00~15:30 에만 선점 대상이 되는지(실DB 롤백 검증은 Developer 가 했음, 나는 읽기 전용이라 재현하지 않음) ⑤ 월요일 06:30 자연 만료 예정인 구 카드 4장(#19077~19080)이 승인되지 않은 채 만료되는지.
- [18:43] 종합: 핵심 수정 A(시각)·B(중복 매핑)·D(유지)는 독립 검증으로 올바르고 T-043 선점·복귀·기록 로직은 불변이다. 막아야 할 CRITICAL 은 없다. 다만 C 의 경보 본문 시각이 9시간 틀린 값(R-1)이라, 이 경보를 근거로 사람이 "주문이 나갔는지" 판단하고 DB 를 되돌릴 수 있다는 점에서 커밋 전 수정을 조건으로 건다: R-1 의 한 줄 수정과 테스트 기대값 갱신 → Reviewer 가 해당 hunk 만 재검증(또는 Leader 가 수용 사유를 이 절에 기록). R-2~R-7 은 비차단.
- [18:43] (1차 감사 판정은 조건부 통과였고 조건은 R-1 수정이었다. 아래 18:50 재검증으로 조건이 충족돼 이 줄은 교체했다 — 유효한 판정은 이 절의 마지막 줄 하나뿐이다.)
- [18:50] 재검증(R-1 수정분만): 해시 4개 직접 대조 — `entry-claim.ts` `ed9cdf148b9d`·`route.ts` `920e6aea6e6b`·`entry-claim.test.ts` `04ffb6c469c6`·`claim.test.ts` `cec08434b6ed` 모두 일치, 나머지 4개(`post-market-engine.ts` `ac24a8d0c112`·`post-market-engine.test.ts` `2fe89ce10093`·`fakeSignalsDb.ts` `ff4f594e06bb`·`sizing.test.ts` `40cc331fdfa0`)도 1차 감사 때와 동일 [확실]. `git diff HEAD` 상 `entry-claim.ts` 는 여전히 `recordEntryOrder` 뒤에 추가만 있고(SQL·선점·복귀·기록 본문 불변), `route.ts` 의 1차 대비 변경은 경보 본문 라인의 ` KST` 라벨 추가뿐이다. 작업 트리 소스는 수정하지 않았고 격리 사본(`headrepo`)에만 새 4개 파일을 복사해 실행했다.
- [18:50] R-1 닫힘 [확실]: `findStuckExecutions` 가 `Date` 를 `toKstWallClock()`(`entry-claim.ts`, `+9h` 산술 후 `YYYY-MM-DD HH:mm:ss`)로 바꾸고 문자열 값(dateStrings)은 그대로 통과시킨다. 실DB 대조: 실제 `findStuckExecutions` 를 격리 사본에서 실DB 의 `executing` 3행(5326·5327·5330)에 대해 읽기 전용 SELECT(`consumed_order_id IS NULL` 조건만 완화)로 실행해 `updatedAt` 을 `DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s')` 와 비교 — 5330 `2026-05-26 23:41:05`(이전 UTC 표기 14:41:05)·5326 `23:22:04` 일치, 날짜 경계 행 5327 은 `2026-05-27 00:18:54`(UTC 로 찍으면 전날 15:18:54)로 일치. 프로세스 TZ 를 Asia/Seoul·UTC·America/Los_Angeles 로 바꿔도 동일했고, `dateStrings:true` 풀에서도 같았다. 경보 본문은 `선점 <KST 시각> KST` 로 표기된다(`route.ts:125`).
- [18:50] 소비처 grep: `findStuckExecutions`/`StuckExecution`/`updatedAt` 의 비테스트 소비처는 `route.ts:123-125` 의 `alertStuckExecutions` 한 곳뿐이다(`src`·`scripts`·`docs` 전체 검색). 인터페이스 필드 의미만 UTC ISO → KST 벽시계로 바뀌었고 다른 코드·화면·API 에는 영향이 없다 [확실]. `route.ts` 의 `.replace('T',' ').slice(0,19)` 는 새 형식에서 무해한 방어 코드다.
- [18:50] 실행 검증: 대상 5개 suite 99개 통과를 TZ 3종(Asia/Seoul·UTC·America/Los_Angeles)에서 확인, 격리 사본 전체 jest 144 suite / 2961 테스트 통과, `tsc --noEmit` 오류 0 — 코디네이터 보고와 일치. 새 단언의 품질: `entry-claim.test.ts` 가 UTC 01:00→KST 10:00·날짜 경계(UTC 15:00→다음 날 00:00, 12-31 14:59:59Z→23:59:59)·문자열 통과를 고정하고, `claim.test.ts` 는 구현과 다른 경로인 `toLocaleString('sv-SE',{timeZone:'Asia/Seoul'})` 로 기대값을 만들어 `선점 <KST> KST` 포함·UTC 표기 불포함을 단언한다. 내가 만든 변이 8개(격리 사본): UTC 표기로 되돌림·오프셋 제거·부호 반전·route 에서 ` KST` 라벨 제거·라벨을 `UTC` 로 교체·route 에서 +9h 이중 적용은 사망(3·3·3·1·1·1개 테스트 실패), 로컬 getter 구현은 TZ=Asia/Seoul 에서 생존·TZ=UTC 에서 사망, 문자열 경로를 변환하는 변이는 KST 러너에서 동치라 생존 — 둘 다 1차 감사 R-5(테스트가 러너 TZ 에 기대는 NIT)와 같은 부류이며 운영(KST)에는 영향이 없다. 변이 후 격리 사본의 두 파일 해시를 원본과 재대조해 복원 확인.
- [18:50] 남은 항목: R-2(경보는 개장 중 틱에서만 동작)·R-3(`custom/confirm` 의 같은 UTC 패턴, 별도 task)·R-4~R-5(NIT)·R-6(결정 3·4 재확인 권고)·R-7(문서 갱신)은 1차 기록 그대로이며 모두 비차단이다. CRITICAL·MAJOR 미해결 0건. 배포 직전 R-6 재확인과 월요일 16:00 자동 실행 로그 확인(QA 인계 ②③)은 유지.
- [18:50] (이 시각의 판정은 통과였으나 아래 18:52 재검증이 Codex C2 반영본을 다시 본 것이라 이 줄을 교체했다 — 유효한 판정은 이 절의 마지막 줄 하나뿐이다.)
- [18:52] 재검증 2차(Codex C2 반영분): 새 해시 `route.ts` `d48a266e1a10`·`claim.test.ts` `9ada93df26ec` 직접 대조 일치, 나머지 6개(`post-market-engine.ts` `ac24a8d0c112`·`post-market-engine.test.ts` `2fe89ce10093`·`entry-claim.ts` `ed9cdf148b9d`·`entry-claim.test.ts` `04ffb6c469c6`·`fakeSignalsDb.ts` `ff4f594e06bb`·`sizing.test.ts` `40cc331fdfa0`)도 직전 값과 동일 [확실]. 변경은 `route.ts` 의 `sendAlertThrottled` 키 한 곳(`entry-watcher:stuck-executing:<멈춘 ID 목록>`)뿐이며 `findStuckExecutions`·KST 표기(R-1 수정)·SQL·선점/복귀/기록 로직·try/catch·TTL 1시간·critical 수준은 그대로다. 키 문자열의 소비처는 `route.ts:130` 한 곳(`src`·`scripts`·`docs` grep)이라 다른 코드에 영향이 없다.
- [18:52] 키 변경 평가: 고정 키에서는 먼저 난 사고의 경보가 1시간 동안 이후 독립 사고의 경보를 가리는 결함이 실제로 있었고(내가 1차에서 짚지 못한 부분), ID 집합 키가 이를 닫는다 [확실 — 코드·테스트 근거]. `ORDER BY id` 로 집합이 결정적이라 같은 집합은 같은 키(1시간 스로틀)이고 새 ID 가 추가되면 즉시 경보한다. 부수 효과는 허용 범위다: 일부를 정리해 집합이 줄어도 남은 건에 대해 한 번 더 알림(드문 사고라 수용), `findStuckExecutions` 의 20건 상한 밖으로 밀려난 신규 건은 키에 안 들어간다(20건 이상 동시 멈춤은 이미 대형 사고), 키가 `Map` 에 쌓이지만 사고 집합 수만큼이라 사실상 무한 증가 아님. 실행 검증: 대상 5개 suite 100개를 TZ 3종에서 통과, 격리 사본 전체 144 suite / 2962 테스트 통과, `tsc` 오류 0. 내가 만든 변이 5개(고정 키로 복귀 2개 실패·개수만 키 2개 실패·첫 ID 만 키 1개 실패·구분자 없는 연결 1개 실패·TTL 1분 1개 실패)가 모두 사망했고, 변이 뒤 격리 사본 `route.ts` 해시를 원본(`d48a266e1a10`)과 재대조해 복원을 확인했다. 단위 테스트는 `sendAlertThrottled` 를 모의로 바꾸므로 키별 억제 동작 자체는 `notify/throttle.ts`(키별 `Map` + TTL) 읽기로 확인했다 [확실].
- [18:52] Codex 두 번째 지적(low, 스로틀이 프로세스 로컬이라 다중 인스턴스 중복 경보)에 대한 판단: 동의한다(오탐/범위 밖). 근거 — `ecosystem.config.js` 가 `stockinvest`·`stockinvest-cron` 모두 `instances: 1`(29·51행)이고, 읽기 전용 `pm2 jlist` 로 실제 기동 상태도 `stockinvest` 1(cluster 모드)·`stockinvest-cron` 1 임을 확인했다. `throttle.ts` 가 재시작 시 초기화를 의도된 동작으로 문서화하고 있어, 재시작·배포 때 아직 해소되지 않은 사고가 한 번 더 알려지는 것은 결함이 아니다. 인스턴스를 늘리거나 공유 저장소 스로틀이 필요해지면 그때 재검토.
- [18:52] R-1 은 계속 닫힌 상태이고(위 18:50 실DB 대조 유효, 이번 변경이 시각 포맷을 건드리지 않음), R-2~R-7 은 1차 기록 그대로 비차단이다. CRITICAL·MAJOR 미해결 0건.
- [18:52] **최종 판정: PASS (scope: src/lib/strategy/post-market-engine.ts, src/lib/signals/entry-claim.ts, src/app/api/cron/entry-watcher/route.ts, src/lib/strategy/__tests__/post-market-engine.test.ts, src/lib/signals/__tests__/entry-claim.test.ts, src/app/api/cron/entry-watcher/__tests__/)**

## Leader 기록

- [10-18 저녁] Developer 구현·검증 완료(위). 다음: 독립 Reviewer → judge C2/Codex → 커밋(8개 파일 + vault 문서만) → 장외 배포.
- [10-18 18:43~18:52] 독립 Reviewer 1차 **조건부 통과**(R-1 MAJOR: 경보 본문 선점 시각이 UTC) → Leader 가 코드·테스트로 재현 확인 후 수정(KST 벽시계 + ` KST`) → Reviewer 재검증 통과. judge C2 → Codex(이중 주문 경로 없음, 스로틀 키 medium 1건 수정·low 1건 기록) → 키 수정 → Reviewer 2차 재검증 **최종 PASS**(해시 8/8 일치, Leader 도 커밋 직전 재대조). Reviewer 의 범위 밖 지적 R-3 은 [[T-050-custom-signal-expiry-timezone]] 로 분리.
- [10-18] 배포 전 점검(읽기 전용 SQL): `scenario_source='post-market'` 카드 40장(pending 4·approved 2·expired 34) 전부 구 형식(00:00/06:30; T-048 로 키를 바꾼 중복 6행은 제외) — 처음 보고에서 44장으로 잘못 적었다가 정정 · 화요일 10-20 대상일과 겹치는 행 0 · 유니크 인덱스 존재 · `updated_at` ON UPDATE 확인 · `executing` 3건(5326·5327·5330)은 모두 `consumed_order_id` 있음 → 새 경보 쿼리 0건(배포 직후 거짓 경보 없음).
- **남은 확인(배포 후)**: ① 월요일 10-19 16:00 post-market 자동 실행 로그에 `valid_from … 09:00:00` · `expires_at … 15:30:00` 과 생성 행 `TIME()` ② 구 카드 4장(#19077~19080) 월요일 06:30 자연 만료 ③ 화요일 카드 승인 전 사용자 확인 사항(위 "한계": 청산 엔진 OFF·현금<카드 가격이면 매 분 거부 반복·백테스트 미검증).
- [10-17] T-045 독립 감사(Reviewer)가 발견(R-2) → Leader 가 DB·코드로 재확인.
- [10-18] 사용자 "진행해줘"(T-046 설계안 작성). 읽기 전용 조사로 2절의 5개 사실 확인(청산 엔진 OFF·수량 0·현금·백테스트 규칙·총자산 추이). **코드·DB 변경 없음.** 사용자 결정 대기.

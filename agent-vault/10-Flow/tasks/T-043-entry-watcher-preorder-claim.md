---
task_id: T-043
title: entry-watcher 주문 전 조건부 선점 — 틱이 겹쳐도 같은 시그널에 실주문이 두 번 나가지 않게 (T-042 외부 검토 파생)
status: done
priority: high
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-042, T-045, T-046, T-047, T-037, T-025]
tags:
  - type/task
  - domain/safety
  - domain/signals
aliases:
  - entry-watcher 선점
  - entry-watcher preorder claim
created: 2026-10-12
updated: 2026-10-18
---

# T-043 — entry-watcher 주문 전 조건부 선점

## 왜 (사실)

T-042 의 Codex 외부 검토(C2, 2026-10-12)가 지적했고 Leader·Reviewer 가 각각 코드로 확인했다.

- `src/app/api/cron/entry-watcher/route.ts`: `SELECT … status='approved_pending_entry'` → `submitOrder` → **그 뒤** `UPDATE signals SET status='executing' … WHERE id=?`. 주문 전 조건부 선점이 없고, 주문 뒤 UPDATE 의 WHERE 에도 상태 조건이 없었다.
- `submitOrder` 의 `client_order_id` 는 호출마다 `co-<randomUUID>` 이고 entry-watcher 는 고정 키를 넘기지 않아 DB 수준 멱등성이 없다.
- Reviewer 하니스 재현(T-042 5라운드): 같은 프로세스에서 두 틱이 겹치면 같은 시그널에 `submitOrder` 가 2회 불렸다.
- **T-042 이전부터 있던 구조**다. T-042 는 악화시키지 않았다(결과 불명 재제출 차단 추가, 구간 없는 룰 시그널의 막다른 길 제거).

## 노출 크기 (2026-10-12 읽기 전용 실측)

- 정상 운영에서는 틱이 겹치지 않는다: 호출자는 `scripts/cron-runner.sh` 하나, 단일 루프 curl 동기 호출 + `sleep 60`.
- 겹치는 조건: ① `stockinvest-cron` 중복 기동 ② 수동 curl ③ 배포 중 새 cron-runner 첫 틱과 옛 릴리스의 진행 중 요청 ④ 배포 중 주문 송신 뒤 기록 전 프로세스 종료.
- 상한: 중복 주문도 1회·일 한도 검사를 각각 통과해야 하므로 하루 한도. 과거 흔적 없음(접수·체결 자동 주문 19건, 3분 이내 쌍 0건).
- **지금까지는 카드가 개장 전에 만료돼(T-046) 실행되지 못해 노출이 사실상 0이었다.** T-046 을 고치는 순간 이 결함이 실제 방어선이 된다 → T-046 보다 먼저 들어가야 한다.

## 사용자 결정 (2026-10-18 "이대로 진행해줘")

순서 **T-043 → (유니크 인덱스 마이그레이션 승인) → T-046 → 텔레그램 버튼 스위치**. 마이그레이션·스위치 켜기는 해당 시점에 구체 내용을 보여 주고 다시 확인한다.

## 범위 (Leader 결정: 폴러 하드닝은 분리)

| 포함 | 제외 |
|---|---|
| `entry-watcher/route.ts` 의 주문 전 조건부 선점 · 새 모듈 `src/lib/signals/entry-claim.ts` · 테스트 · 문서(`docs/telegram-approval.md` §6.1·§7) | **폴러 Low 하드닝 3건 → T-047 로 분리.** 폴러는 스위치가 꺼져 있어 지금 동작하지 않는 코드이고, 이 task 는 실주문 경로라 감사 대상을 한 곳으로 좁히는 편이 안전하다 · 유니크 인덱스(마이그레이션=사용자 승인) · `approval-transitions.ts`(감사받은 파일, 건드리지 않음) |

## 설계 (구현됨)

1. **주문 직전 선점** — `claimEntrySignal(pool,id)`: `UPDATE signals SET status='executing', updated_at=NOW() WHERE id=? AND status='approved_pending_entry' AND (expires_at IS NULL OR expires_at > NOW())`, `affectedRows===1` 인 실행만 `submitOrder`. 위치는 **모든 건너뛰기 경로(만료·장외·구간·분할 대기·수량 0) 뒤, `submitOrder` 직전**. 선점 UPDATE 가 던지면(DB 장애) **주문하지 않는다**(`order_failed: claim_failed`), 지면 `claim_lost`.
2. **결과별 처리**
   - 성공·`dryRun`: `executing` 유지 + `recordEntryOrder`(주문 번호 연결). 연결 실패는 재주문 위험이 없으므로 warning 경보.
   - 결과 불명(`outcomeUnknown`): `executing` 유지 + 주문 번호 연결 + critical 경보(기존). 이미 잠겨 있어 다시 잠글 필요 없음.
   - 확정 거부: `releaseEntryClaim`(`WHERE id=? AND status='executing' AND consumed_order_id IS NULL`)으로 `approved_pending_entry` 복귀 → 다음 틱 재시도. 복귀 실패는 재주문 위험은 없으나 더는 감시되지 않으므로 warning 경보.
   - `submitOrder` 가 **던진 경우**(송신 전 실패 — 송신 이후 예외는 T-042 의 `outcomeUnknown` 으로 돌아온다): 복귀.
3. **`submitOrder` 호출만 별도 try** — 호출 뒤의 후처리(알림·포지션 기록)는 다른 try 로 분리했다. 후처리 예외가 "송신 전 실패"로 오인돼 선점이 풀리면 **이미 나간 주문이 재주문된다**(구현 중 자체 점검에서 발견한 허점). 후처리 예외는 선점을 건드리지 않고 `post_order_error` 로 분류, 경보.
4. **프로세스 로컬 `Set`(`orderSentButUnrecorded`, T-042 R3-1) 제거** — 선점된 행은 다음 틱의 `SELECT` 에 잡히지 않으므로 필요 없고, 재기동·다중 인스턴스에서 깨지던 방어였다.
5. **잠금은 DB 에 있다** — 재기동·배포·다른 인스턴스에도 유효. 선점 뒤 프로세스가 죽으면 `executing` 으로 남아 재주문은 없고 6.1 절차로 수동 확인.

## 시험

- `entry-claim.test.ts` (헬퍼 SQL 형태·반환값·DB 오류), `claim.test.ts` (순서·경합·fail-closed·복귀·후처리 예외·선점 위치), `unknown-outcome.test.ts` (결과별 최종 상태·다음 틱 재주문 없음), `sizing.test.ts` 가짜 풀 보정. **상태를 가진 가짜 DB**(`fakeSignalsDb.ts`)로 "두 실행이 같은 시그널을 본다"를 재현.
- 변이 20개(+ 무효 변이 대체 3개) 전부 단언 실패로 검출: 선점 제거·판정 뒤집기·fail-open·패배에도 주문·복귀 누락·결과 불명 복귀·후처리 복귀·번호 미연결·경보 강등·선점 순서 위반, 헬퍼 SQL 조건 제거·완화.
- 실제 DB(롤백 트랜잭션, 소스에서 꺼낸 SQL 그대로) 11건 확인: 최초 선점 1 · 재선점 0 · 복귀 1 · 재선점 1 · 번호 연결 1 · **번호가 연결된 행은 복귀 0** · 만료 행 0 · 미래 만료 1 · `pending` 행 0 · `expired` 행 0 · 비-`executing` 번호 연결 0. 롤백 뒤 `signals` 19,075행·잔여 가짜 행 0.

## 롤아웃

1. 일요일(10-18, 장외)에 배포한다(push = 배포). 이 변경은 `approved_pending_entry` 시그널이 있어야 작동하는데 **지금은 0건**이라 배포 직후 관측되는 동작 변화는 없다. 선점 경로는 단위·통합·실DB SQL 검증으로 증명하고, 운영 첫 실사용은 T-046 이후다.
2. 배포 후: pm2·health·소스 해시, `/api/cron/entry-watcher` 가 장외에 `market_closed` 로 정상 응답.
3. 롤백: 이전 릴리스로 되돌린다(DB 변경 없음).

## 알려진 한계

- 선점 이후 프로세스가 죽으면 `executing` 으로 남는다(수동 확인).
- `submitOrder` 가 송신 이후에 던지는 경로가 남아 있다면 선점 복귀가 재주문을 부를 수 있다 — T-042 에서 `sendReached` 로 송신 이후 예외를 `outcomeUnknown` 으로 돌려주게 했으므로 설계상 없음(감사 대상).
- 결과 불명 주문이 일 한도 집계에서 빠지는 문제는 별건(T-042 문서 §7).

## Leader 기록

- [10-18] 사용자 "이대로 진행해줘". judge 접수(`judge-result@2`): **R2**·복잡도 2.87·developer=opus·데모 불필요. **판정 도구의 오탐 기록**: 첫 접수에서 요청 문장의 "화면 변경 없음"이라는 **부정 표현 속 "화면"을 화면 문맥으로 오인**해 키워드 규칙 `DM-kw-risky-cta` 가 데모 필요(delta)로 판정했다(Jev 자체 신호는 `ui_change: none` 0.94). 실제로 서버 cron 로직만 바꾸는 작업이라 사실대로 부정 표현 없이 다시 적어 재접수 → 데모 불필요. (T-042 접수에서도 같은 유형의 판정이 나왔던 이유로 보인다.)
- [10-18] 관련 승인 교훈: 없음(`/이슈기록 관련 domain/signals`).
- [10-18] 구현·테스트·변이·실DB 검증 완료(위). 독립 감사(Reviewer) 전에는 커밋하지 않는다.

## Developer

- [10-18] **변경 파일(7개)**: `src/lib/signals/entry-claim.ts`(신규) · `src/app/api/cron/entry-watcher/route.ts`(수정) · 테스트 `src/lib/signals/__tests__/entry-claim.test.ts`(신규) · `src/app/api/cron/entry-watcher/__tests__/{claim.test.ts(신규), unknown-outcome.test.ts(전면 재작성), sizing.test.ts(가짜 풀 보정), fakeSignalsDb.ts(테스트 헬퍼, 신규)}` · 문서 `docs/telegram-approval.md`(§6.1·§7 — 다른 세션 T-044 변경과 섞이지 않게 제 수정 구간만 스테이징).
- [10-18] 검증(Developer 측): 전체 jest 144 suites / 2,924, `tsc --noEmit` 0, 훅 시나리오 통과, 변이·실DB 검증(위).
- [10-18] **독립 감사 1라운드 PASS 후 반영(2차 변경)**: 감사의 비차단 권고 중 코드 3건을 받아들였다 — ① R-2 만료 UPDATE 에 `AND status='approved_pending_entry'` 추가(시계 편차로 방금 선점된 `executing` 을 `expired` 로 덮는 실제 버그) ② R-3 `claim_lost` 경고 로그·주문 번호 연결 대상 행이 없으면 실패로 간주해 경보·회차 요약 로그에 `claim_lost`/`order_uncertain` 건수 ③ R-6 선점 복귀 실패 경보에서 `await getSymbolLabel` 제거(`escapeAlertText(symbol)`). 테스트 보강(R-4): 감사가 살아남았다고 한 변이 4건(후처리 예외의 결과 불명 분류·후처리 경보 조건·dryRun 성공 취급·송신 전 예외 복귀 `await`)과 분할 게이트 비선점 시험 추가, 가짜 DB 에 UPDATE 지연·상태 조건 평가·분할 게이트 응답 추가. 검증: 49/49, 변이 28개 전부 단언 실패로 검출(감사 생존 4건 포함), 전체 jest·tsc 는 재실행 예정. 문서 R-5·R-8 정정, R-1(오래된 무번호 `executing` 자동 경보)은 T-046 선행 조건으로, R-7(UI 문구)은 T-046 후속으로 이관. **코드가 감사 이후 바뀌었으므로 변경분 재확인을 요청한다(이전 PASS 를 빌리지 않는다).**

## Reviewer

- [01:06] 2라운드 범위·방법 — [확실] 이전 판정을 빌리지 않고 변경분을 다시 확인했다. 대상 해시: `route.ts` 9e31025f65e5…(1라운드 31b412e6…, 2차 d4bb4b52… 에서 만료 분기가 한 번 더 바뀜), `entry-claim.ts` 487317fb6c8d…(불변), `claim.test.ts` f3d62628…, `fakeSignalsDb.ts` 5f1e4fee…, `sizing`·`unknown-outcome`·`entry-claim` 시험은 1라운드와 동일. 읽은 것: 1라운드 시점 `route.ts` 복사본 대비 diff 전체, `fakeSignalsDb.ts`·`claim.test.ts` 변경분, `docs/telegram-approval.md` §6.1·§7, T-046 문서의 R-1/R-7 이관 항목. 직접 실행한 것: 대상 jest·tsc·전체 jest, 변이 23건(기준선 별도), 감사자 스크래치 시험 8건(프로젝트 밖 복사본), 운영 DB 읽기 전용 SELECT.
- [01:06] 재실행 — [확실] 대상 `npx jest src/app/api/cron/entry-watcher src/lib/signals/__tests__/entry-claim.test.ts` 4 suites / 51 tests 통과, `npx tsc --noEmit` exit 0, 전체 `npx jest --silent` 144 suites / 2,936 tests 통과. 실행 끝에 `route.ts` 해시가 시작 때와 같음(9e31025f…)을 다시 확인했다.
- [01:06] Q1 만료 분기 정상 경로 — [확실] 새 만료 조건 `expires_at IS NOT NULL AND expires_at <= NOW()` 와 선점 조건 `expires_at IS NULL OR expires_at > NOW()` 는 정확히 상보다. 운영 DB 19,075행 전체에서 두 조건을 SELECT 로 평가해 겹침 0·빈틈 0을 확인했다(정각 NOW() 는 선점 불가·만료 가능). 앱·DB 시계가 일치하면 JS 판정(`expires_at` < 틱 시작 시각)이 참인 행은 UPDATE 시점의 DB 시각에서도 만료이므로 1행이 갱신되어 `expired` 로 보고된다(claim.test.ts:207 과 스크래치 '정상 만료' 시험 통과). `continue`(:173)는 try/catch 뒤라 성공·0행·DB 오류 세 경우 모두 만료 후보는 주문 경로로 가지 않는다(변이 X06 검출). `claim_lost` 분류의 소비자: HTTP 응답 본문뿐이고 cron-runner 는 상태 코드만 보며, 요약 로그에는 `claim_lost=N` 으로 집계된다(스크래치 시험으로 확인: 0행 만료가 `expired=0 … claim_lost=1`). 다만 이 이름이 "선점 패배"와 "만료 처리 대상 아님" 두 뜻으로 겹쳐 쓰여 "실행자가 둘"이라는 이상 신호의 순도가 떨어진다(LOW, 이름만 분리 권고, 예 `expire_skipped`).
- [01:06] Q2 오류 시 `expired` 보고 — [확실] 상태는 바뀌지 않았는데 결과·요약의 `expired=N` 에 세어진다(detail 의 `expire update failed:` 로만 구분). 오해 소지가 있다(LOW). 제안: 선점 쪽 관례와 같이 `outcome: 'order_failed'` + detail `expire_failed: …`, 또는 전용 outcome. 동작(상태 불변·다음 틱 재시도·`continue`)은 옳다.
- [01:07] Q3 시계 편차 상호작용 — [확실] 앱 시계가 DB 보다 **늦은** 경우: JS 가 만료로 보지 않아 선점 UPDATE 까지 가지만 DB 시각 조건(`expires_at > NOW()`)이 막아 `claim_lost`, 주문 없음, 상태는 `approved_pending_entry` 유지. 앱 시계가 만료를 넘긴 다음 틱에 새 만료 UPDATE 가 DB 시각 조건을 충족해 `expired` 로 확정된다(스크래치 시험으로 두 틱을 재현해 통과). 앱 시계가 DB 보다 **앞선** 경우: JS 만료 판정 → UPDATE 0행 → `claim_lost` + `continue`(주문 없음) — DB 기준 만료 직전 구간(편차 δ)의 주문이 미뤄지는 fail-closed 방향이라 허용. 두 UPDATE 가 같은 DB 시각을 기준으로 상보라서 "만료인데 주문" 또는 "유효한데 만료 확정" 경로는 없다.
- [01:07] **필수에 가까운 권고 R2-1 (MEDIUM, 시험 공백 — 커밋 전 1줄 반영 권고)**: 만료 UPDATE 의 상태 조건(`AND status='approved_pending_entry'`)을 지워도 프로젝트 시험이 전부 통과한다(변이 X01 생존). 원인: claim.test.ts:219 시험의 DB 행 `fakeSignal(21,{status:'executing'})` 에 `expires_at` 이 없어서, 새 시간 조건(`expires_at IS NOT NULL`)이 먼저 0행을 만들고 상태 조건이 가려진다. 상태 조건이 실제로 필요한 경우는 DB 행이 이미 만료 시각을 지난 채 다른 실행이 선점해 `executing` 인 때다(느린 틱 + 앱 시계 앞섬). 프로덕션 코드는 옳다. 감사자 스크래치 시험(만료 시각이 과거인 `executing` 행 + 낡은 pending 스냅샷)이 X01 을 검출함을 확인했다. 권고: 해당 시험의 DB 행을 `fakeSignal(21,{status:'executing', consumed_order_id:null, expires_at:new Date(Date.now()-1_000)})` 로 바꿔 상태 조건을 단독 검증.
- [01:07] Q4-a R-3 0행 throw — [확실] 성공 분기: throw 는 `recordEntryOrder` 를 감싼 안쪽 try 안에서 일어나 안쪽 catch 가 warning 경보 후 계속한다 — 스크래치 시험에서 경보 뒤에도 '🎯 진입 실행' 알림, `setPositionScenarioExit` 1회, 결과 `submitted`(detail 에 post_order_error 없음)가 그대로였다. 결과 불명 분기: `recordNote` 만 붙고 critical 경보는 정확히 1건, 결과는 `order_uncertain` 하나. 재주문과 무관한 경로(복귀가 아님)라 새 위험은 없다. `FOUND_ROWS` 가 mysql2 기본 플래그(connection_config.js:218)라 같은 값 재연결도 1행으로 세어져 오경보가 나지 않는다. 지적(LOW, R2-3): 0행 경보 본문이 모순이다 — 사유는 "시그널이 더는 executing 이 아님"인데 본문은 "시그널은 executing 으로 잠겨 있어 재주문 없음"이라 안심시킨다. 그 상태가 `approved_pending_entry` 로 돌아가 있다면(운영자 수동 SQL 오조작 등) 다음 틱에 재주문되므로, 0행일 때는 "시그널 상태를 먼저 확인(executing 이 아니면 재주문 위험)"으로 문구를 분기하길 권한다. 수동 개입 외 도달 경로는 찾지 못했다.
- [01:07] Q4-b 새 문자열이 던질 수 있는가 — [확실] 선점 패배 `console.warn` 은 `signalId`(number)·`row.symbol`(string) 보간뿐, 요약 로그의 `claimLost`·`uncertain` 은 `results.filter(...).length` 라 던질 수 없다. 만료 분기의 `res.affectedRows` 접근은 try 안이라 `res` 가 비정상이어도 catch 로 간다. 복귀 실패 경보 제목은 순수 함수 `escapeAlertText(symbol)` 만 쓴다(R-6 해소, 라벨 조회 실패 시험이 되돌림 변이 N07 을 검출).
- [01:07] Q4-c 시험 실효성 — [확실] 복사본에서 변이 23건(기준선 통과 확인 후): 만료 UPDATE 의 시간 조건 제거·`<=`→`<`·IS NOT NULL 제거·`affectedRows` 검사 제거/항상 1행·0행 분류를 expired 로·`continue` 제거·DB 오류 결과 누락·JS 사전 판정 제거, 0행 throw 제거(성공·결과 불명)·판정 반전, 선점 패배 로그·요약 `claim_lost` 제거, 복귀 경보 라벨 조회 복귀, 복귀 `await` 제거 2곳, `dryRun` 성공 취급 제거, 후처리 예외 분류·경보 조건, 게이트 앞 선점 이동 — 21건 검출. 생존 2건: X01(상태 조건 제거, 위 R2-1)과 N06b(요약 로그의 `order_uncertain=N` 제거 — 로그 문자열, LOW). 1라운드의 생존 4건(R13·R14·R15·R17 계열)은 새 시험으로 모두 검출됨. 가짜 DB: 만료 UPDATE 정규식이 `^…$` 고정이고 상태·시간 조건을 SQL 에 실제로 있는 것만 평가(조건을 지우면 덮어쓰도록 구현)해 정직한 모델이다. 시간 조건은 `<= NOW()` 한 형태만 받아 변이 `<` 은 "예상하지 못한 signals UPDATE" 로 검출된다. `delayMs` 는 UPDATE 에만 적용되고 `await` 누락을 드러낸다(T1a·T1b 검출). 분할 게이트 응답은 SQL 정규식이 실제 쿼리와 일치하고 그룹·회차·상태 필터가 실제 의미와 같다 — 운영 DB 로 `JSON_EXTRACT(...) = ?` 가 비따옴표 인자로 매칭됨(n=1)을 확인해 가짜의 평문 비교와 의미가 같다. 단 위 R2-1 때문에 "R-2 시험이 상태 조건을 지킨다"는 주장은 현재 시험으로는 성립하지 않는다.
- [01:08] Q5 문서 — [확실] 알림 제목 '진입 주문 후처리 예외'·'진입 감시 선점 복귀 실패'·'주문 번호 기록 실패'·'진입 주문 결과 불명' 이 코드와 일치하고, §6.1 이 후처리 예외 알림을, §7 이 프로세스 사망 시 무음과 R-1 점검 SQL·분할 게이트 의미 차이를 설명한다. 새 점검 SQL 을 운영 DB 에서 읽기 전용으로 직접 실행: 정체 `executing` 조회 0행(실행계획은 `idx_signals_status`, 예상 3행), 중복 주문 조회(1 DAY 창) 0행·전체 기간 쌍 0. 구문 오류 없음. 지적(LOW): 점검 SQL 아래 "접수·체결된 자동 주문 19건·마지막 05-26" 은 같은 상태 필터로 지금 17건·마지막 05-27 00:18 이라 수치가 낡았다(0쌍 결론은 동일). 만료 분기 변경으로 `claim_lost` 가 선점 패배 외에 "만료 처리 대상 아님"도 뜻하게 됐지만 §7 의 `claim_lost` 설명은 앞쪽 뜻만 적는다(LOW).
- [01:08] 이번 라운드에서 일회용 DB 는 띄우지 않았다(1라운드의 컨테이너·이미지는 이미 정리 완료, 추가 정리 없음). 운영 DB 는 SELECT 만 실행했다(쓰기 0). 프로젝트의 코드·테스트·문서는 수정하지 않았고(task 문서와 로그만 기록), 변이는 scratchpad 복사본에서만 했다. 변이 후 4개 파일 해시 대조 OK.
- [01:08] 확인하지 못한 것 — [확실] 새 만료 UPDATE 를 일회용 MariaDB 에서 실제 UPDATE 로 실행하지는 않았다(WHERE 절을 운영 DB SELECT 로 옮겨 구문·상보성만 확인). 훅 시나리오·운영 배포 동작은 보지 않았다. 요약 판단 근거는 1라운드 기록(superseded 절)과 이번 라운드 재실행에 있다.
- [01:08] **최종 판정: PASS (scope: src/app/api/cron/entry-watcher/, src/lib/signals/entry-claim.ts, src/lib/signals/__tests__/entry-claim.test.ts)**

## 1라운드 감사 기록 (superseded)

- [00:51] 아래는 1라운드(당시 route.ts sha256 31b412e6…) 기록이다. 이후 코드 변경(2차: R-2/R-3/R-6, 3차: Codex C2 만료 분기)으로 2라운드 재감사가 대체한다. 판정 단어는 훅 오인을 막으려고 소문자로 바꿨다.
- [00:51] 범위·방법 — [확실] 읽은 것: reviewer.md·CLAUDE.md·이 문서, `route.ts` 전체와 `git diff HEAD`, `entry-claim.ts`, `dry-run.ts` 전체, `kis-domestic.ts`·`kis-overseas.ts` 의 `createOrder`, `kis-http.ts` 의 `kisFetch`, `statuses.ts`·`approval-transitions.ts`·`signal-expiry`·`signals/[id]` DELETE·`SignalFeed`·`MyDecisionTab`·`service.ts` 일부, 테스트 5개 전부, `docs/telegram-approval.md` 의 §6.1 마지막 문단·§7 해당 항목. 직접 실행한 것: 대상 테스트·전체 jest·tsc, 운영 DB 읽기 전용 SELECT, 일회용 MariaDB 컨테이너 동시성 실험, 원본 불변 복사본에서 변이 시험. 프로젝트의 코드·테스트 파일은 수정하지 않았다(대상 파일 해시 전후 동일 확인).
- [00:51] 재실행 — [확실] `npx jest src/app/api/cron/entry-watcher src/lib/signals/__tests__/entry-claim.test.ts` 4 suites / 39 tests 통과. 전체 `npx jest --silent` 144 suites / 2,924 tests 통과(Developer 수치와 일치, 작업 트리에 섞인 다른 세션 변경분 포함 수치). `npx tsc --noEmit` exit 0.
- [00:51] (1) 이중 주문 경로 — [확실] 선점(route.ts:310-322)은 `submitOrder`(:328) 앞이고, 만료·장외·구간·분할 게이트·수량 0 건너뛰기가 모두 선점 앞이다. 복귀(`giveBackEntryClaim`)의 호출처는 두 곳뿐이다: submitOrder 가 던졌을 때(:337)와 확정 거부일 때(:430). dry-run.ts 를 줄 단위로 읽고 복사본에서 직접 짠 하니스 6건으로 확인한 계약: submitOrder 가 reject 하는 것은 `orders` 행 생성(:128) 이전(계정 조회·금액 산정·INSERT)뿐이다. 행 생성 뒤에는 `auditLog` 가 자체 try/catch 라 던지지 않고, 송신 전 안전층 예외는 바깥 catch(:241)가 `{ok:false}`(outcomeUnknown 없음)로 돌려주며, 송신 단계(`sendReached=true` :211 이후) 예외는 안쪽 catch 도 바깥 catch 도 `outcomeUnknown:true` 로 돌려준다(안쪽 catch 의 `failed` UPDATE 가 던져도 바깥이 받음 — 하니스 C·D). KIS 응답 분류는 HTTP 5xx·네트워크류=불명, HTTP 4xx·rt_cd≠0(잔고 부족 등)=확정 거부(하니스 F). `kisFetch` 재시도는 레이트리밋 본문(미처리 응답)일 때만이다. 결론: "송신 이후 던짐 → 복귀 → 재주문" 경로는 현 코드에서 찾지 못했다.
- [00:51] `consumed_order_id IS NULL` 의 한계 — [확실] 이 조건은 이중 주문의 실제 방어선이 아니다. 복귀 호출처 두 곳은 모두 `recordEntryOrder` 이전이라 이 조건은 항상 참이다. 실제 방어선은 ① 복귀를 두 분기로만 한정한 호출부 구조 ② submitOrder 의 던짐/반환 계약이다. 이 조건이 막는 것은 "다른 행위자가 이미 번호를 연결한 행의 되돌림"뿐이며, 번호 연결이 실패한 상태(NULL)에서 후처리 분기가 복귀를 부르는 미래 변경은 SQL 이 막지 못한다 — 그 경우는 claim.test.ts 의 후처리 예외 시험들(변이 R05 검출)이 막는다. 현재 결함은 아니다.
- [00:51] (2) fail-closed — [확실] `let claimed: boolean;`(:310)는 try 에서만 할당되고 catch 가 `continue`(:317)하므로 미할당 사용 경로가 없다(변이 R03 'catch 에서 claimed=true' 검출). 선점 UPDATE 가 던지면 submitOrder 는 불리지 않고 시그널당 결과는 `order_failed`/`claim_failed:` 하나다(claim.test.ts:104).
- [00:52] (3) 후처리 분리 — [확실] submitOrder 호출만 try(:327-340), 결과 처리는 별도 try(:342-456)다. 후처리 catch(:438-456)는 선점을 건드리지 않는다(변이 R05 '후처리 catch 에서 복귀' 검출). 그 catch 안은 `console.error`·`results.push`·`sendAlert`(void, 내부 .catch)·`escapeAlertText`(순수)뿐이고 `getSymbolLabel` 을 일부러 쓰지 않아 재던짐 경로가 없다. 이론상 남는 재던짐은 `giveBackEntryClaim` catch 안의 `await getSymbolLabel`(:112)뿐인데 그 함수는 "절대 던지지 않는다"가 계약(symbol-name.ts)이라 실도달 가능성은 낮다(R-6).
- [00:52] (4) `executing` 의 다른 소비자 — [확실] src 비테스트 grep 전수. `statuses.ts`(ENUM·ACTIVE_SIGNAL_STATUSES 정의만이고 `EXPIRABLE_STATUSES` 는 awaiting 계열+detected 라 `executing`·`approved_pending_entry` 를 만료시키지 않는다 → signal-expiry 무해), `approval-transitions.ts`·`service.ts`(즉시 주문 경로가 이미 같은 뜻의 선점 용법), `SignalFeed.tsx:39`('체결 대기'), `MyDecisionTab.tsx:25,37`('주문 실행됨'), `approval-message.ts:167`('주문 처리 중'). signal-followup 은 `ai_skipped` 만, 중복 발화 방지 쿼리(service.ts:377)는 awaiting+detected 만 보므로 깜빡임이 중복 발화를 열지 않는다. 운영 DB 실측: `executing` 3건 전부 주문 번호가 있다(05-26/27 해외 체결). 해를 끼치는 소비자는 없고 번호 없는 `executing` 에 표시 문구만 부정확하다(R-7). `DELETE /api/signals/:id`(`status='approved_pending_entry'` 조건)는 선점 구간에 404 를 주는데 주문 중 삭제를 막으므로 오히려 바람직하다.
- [00:52] (5) 확정 거부 재시도 루프 — [확실] 틱마다 시그널당 UPDATE 2건(선점·복귀)이 추가되고 둘 다 PK 단일 행이라 교착·다행 락 순서 문제가 없다(실DB 3-way 루프 시험 통과). 상태 깜빡임은 submitOrder 소요(수 초) 동안 `approved_pending_entry` 조회 화면(Dashboard·TradingBoard·recommend)에서 잠깐 빠지고 SignalFeed 가 '체결 대기'로 보이는 표시 수준이다. 킬스위치 중 매분 blocked 주문·critical 경보는 변경 전부터의 동작이며 이번 변경이 늘리지 않는다. `updated_at` 이 매분 갱신되는 부작용은 이 컬럼을 신선도 판정에 쓰는 소비자가 없어(grep) 무해하나, R-1 의 정체 탐지를 만들 때는 "주문 번호 없고 `updated_at` 이 오래된 executing"만 대상으로 해야 한다.
- [00:52] (6) 분할 진입 게이트 — [확실] 게이트 쿼리(route.ts:245-251)는 `status='approved_pending_entry'` 인 이전 회차만 본다. 단일 실행자(정상 운영)에서는 같은 틱이 `created_at ASC` 순으로 회차를 순차 처리하고 이전 회차의 submitOrder·복귀가 끝난 뒤 다음 회차 게이트를 평가하므로 변경 전과 동일하다(성공·불명→executing→다음 회차 해제, 확정 거부→복귀→계속 대기). 달라지는 경우는 둘이다. ① 실행자가 둘일 때: 한쪽이 1회차를 선점해 주문 중이면 다른 쪽의 2회차 게이트가 열려 1회차 결과 확정 전에 2회차가 나갈 수 있다(변경 전엔 1회차가 pending 이라 막혔지만, 그 상황은 어차피 1회차 이중 주문 상황이라 순손실은 아니다). ② 1회차의 확정 거부 복귀 UPDATE 가 DB 오류로 실패하면 1회차가 주문 없이 executing 에 남아 2회차가 풀린다(복귀 실패 경고는 나감). 둘 다 좁은 경우다(R-5). 게이트 시험은 없다(가짜 DB 가 게이트 쿼리에 빈 결과를 줌).
- [00:52] (7) SQL·동시성 — [확실] `entry-claim.ts` 소스에서 SQL 3문장을 정규식으로 그대로 꺼내 일회용 MariaDB 10.11.19(운영 10.11.11, 기본 REPEATABLE-READ·autocommit·mysql2 기본 플래그 동일)에서 실행했다. 선점 300행×12 동시 → 승자 정확히 1(300/300), 대조군(status 조건 없는 UPDATE)은 행마다 승자 12(실험이 결함을 검출한다는 증거). 만료 과거 0·미래 1·NULL 1·정각 NOW() 0(경계 제외), 다른 상태(awaiting_approval·executing·expired) 0, 선점 1→복귀 1→재복귀 0→재선점 1, 번호가 있는 행 복귀 0, pending 행 번호 연결 0, 3개 실행자 claim/release 루프 200회씩에서 선점 횟수=복귀 횟수(이중 보유 없음). 자리표시자 순서는 코드와 일치(변이 E08 검출). 시간대: 운영 DB `@@system_time_zone=KST`·세션 SYSTEM, 앱 풀 timezone '+09:00', 컬럼 DATETIME 이라 `expires_at > NOW()` 와 JS 비교가 같은 벽시계다(post-market 카드 시각 문제 T-046 은 제외). 운영 DB 는 SELECT 만 실행했다(쓰기 0).
- [00:53] 일회용 DB 정리 — [확실] 띄운 것: 컨테이너 `rv43-mariadb-tmp`(이미지 mariadb:10.11, 127.0.0.1:33907 한정, `--rm`) 1개와 그 이미지(`docker pull`). 정리: `docker stop` 으로 컨테이너 자동 삭제 확인(`docker ps -a --filter name=rv43` 빈 결과), `docker rmi mariadb:10.11` 로 이미지 삭제, 포트 33907 해제 확인. 이전부터 있던 mariadb:11 이미지와 dangling 볼륨은 건드리지 않았다. 시스템 mysqld·운영 DB 는 접촉하지 않았다. 임시 스크립트·복사본은 프로젝트 밖 scratchpad 에만 있다.
- [00:53] (9) 테스트 실효성 — [확실] 원본을 scratchpad 복사본에 두고 변이 시험(무효 앵커 1건 제외, 유효 32건 시도): 선점 호출 제거·패배 무시·선점 DB 오류 시 fail-open·송신 전 예외 복귀 제거·후처리/결과 불명/성공 직후 복귀 추가(위험 변이)·번호 미연결·확정 거부 복귀 제거·선점 위치 이동(만료 판정 앞·시장 개장 앞·현재가 앞·분할 게이트 앞·사이징 앞)·SQL 조건 제거/완화/자리표시자 뒤바꿈·affected 파싱·가짜 DB 의 상태 조건 제거를 모두 검출했다(선점을 `orderReq` 직전으로 옮기는 변이 1건은 의미가 같아 생존). 의미 있는 생존 4건: R13(후처리 예외 분류에서 결과 불명을 order_failed 로)·R14(후처리 경보를 성공일 때만)·R15(`dryRun` 결과를 성공으로 취급 안 함)·R17(송신 전 예외 복귀의 `await` 제거 — 가짜 DB 가 동기 실행이라 검출 못 함). 변이 후 4개 파일을 해시로 원본과 대조해 복원 확인(OK). 가짜 DB 의 정규식은 `^…$` 로 고정돼 실제 SQL 과 한 글자만 달라도 "예상하지 못한 signals UPDATE" 로 던지므로 느슨한 수용은 없다(만료 UPDATE 정규식만 접두 일치 — 이 변경 범위 밖). 지적: claim.test.ts 머리말은 "분할 대기 시그널은 선점하지 않는다"를 지키는 것으로 적었지만 해당 시험은 없다(R-4).
- [00:53] (10) 문서 정확성 — [확실] SQL(6.1 의 2·3번 진입 감시)과 알림 제목('진입 주문 결과 불명'·'진입 감시 선점 복귀 실패'·'주문 번호 기록 실패')은 코드와 일치한다. 불일치·누락: (a) '진입 주문 후처리 예외' 알림(route.ts:451)이 docs 6.1 어디에도 없어 받은 운영자의 조치 근거가 없다 (b) docs:104 가 `claim_failed` 를 결과(outcome)처럼 적었으나 코드는 outcome=`order_failed`, detail=`claim_failed: …` (c) docs:89 의 `**… **전에** …**` 중첩 굵게가 렌더링을 깨뜨린다 (d) docs:121 은 프로세스 사망 시 "6.1 절차로 수동 확인"이라 하지만 그 경우 알림이 없어 발견 수단이 문서에 없다(R-1) (e) 점검 SQL 아래 "전체 기간 0행" 서술과 쿼리의 `1 DAY` 창이 다르다(T-043 이전부터).
- [00:53] (12) 범위 밖 한계 재평가 — [가능성 높음] 유니크 인덱스 없음: 같은 시그널 중복에 대해서는 선점 한 문장이 단일 행 비교-교환이라 실DB 실험으로 충분히 확인했고, 다른 시그널의 같은 종목 중복은 이 변경 범위가 아니다. 일 한도 과소 집계: 평가 불변. 선점 뒤 프로세스 사망: 위험의 방향이 "이중 주문"(변경 전)에서 "주문 누락 + 무음"(변경 후)으로 바뀐 것이 이 변경의 실제 트레이드오프다. 안전한 쪽이지만 발견 수단이 없다는 점이 평가를 바꾼다 → R-1. 운영 DB 실측: `safety_dry_run=false`(실주문 모드)·`safety_kill_switch=false`·`approved_pending_entry` 0건이라 배포 직후 동작 변화는 없고 노출은 T-046 이후에 시작된다.
- [00:53] 발견 R-1 (MEDIUM, 비차단 — T-046 켜기 전 처리 권고): 선점 뒤 프로세스가 죽거나(배포 재기동 중 요청 중단 등) 복귀 UPDATE 가 0행이면 `executing` + 주문 번호 NULL 로 남고 무음이다. 권고: 틱 시작 시 `SELECT id, symbol, updated_at FROM signals WHERE status='executing' AND consumed_order_id IS NULL AND updated_at < NOW() - INTERVAL 10 MINUTE` 결과가 있으면 스로틀된 warning 경보 1건, 같은 SQL 을 docs §7 에 수록.
- [00:53] 발견 R-2 (LOW): route.ts:156-159 의 만료 UPDATE 에 `AND status='approved_pending_entry'` 가 없다. 앱 시계가 DB 시계보다 앞서면 방금 선점된 `executing` 행을 `expired` 로 덮을 수 있고(주문은 나가며 번호 연결은 `status='executing'` 조건에 막혀 무음 실패) 재주문은 없다. 기존 문장이라 새 위험은 아니나 선점 상태가 생기며 의미가 커졌다. 권고: 조건 1줄 추가.
- [00:53] 발견 R-3 (LOW): `recordEntryOrder`·`releaseEntryClaim` 이 false(0행)를 돌려줘도 호출부가 무시한다(복귀 false 는 console.warn 뿐, 번호 연결 false 는 무음). `claim_lost` 는 "실행자가 둘"이라는 이상 신호인데 로그도 없다. 권고: 번호 연결 false 면 warning 경보, `claim_lost` 에 console.warn, 요약 로그(:465)에 claim_lost·order_failed 개수 추가.
- [00:53] 발견 R-4 (LOW, 시험): 생존 변이 R13·R14·R15·R17, 분할 게이트 시험 부재(머리말 과장), 결과 불명·확정 거부 분기에서의 후처리 예외 시험 부재, `dryRun` 결과 경로 시험 부재. 선점 위치를 게이트 앞으로 옮기는 변이는 수량 0 시험이 대신 잡으므로 현재 방어는 유지된다.
- [00:53] 발견 R-5 (LOW): 분할 게이트 의미 차이 두 가지((6)의 ①②)를 §7 에 한 줄 적을 것. R-6 (LOW): `giveBackEntryClaim` 의 catch 에서 `await getSymbolLabel` 대신 `escapeAlertText(symbol)` 를 쓰면 이론상 재던짐이 사라진다. R-7 (LOW, 표시): 번호 없는 `executing` 을 MyDecisionTab 이 '주문 실행됨'으로 표시한다(T-042 결과 불명부터의 성질). R-8 (LOW, 문서): (10)의 a~e.
- [00:53] 확인하지 못한 것 — [확실] 운영 배포 중 요청 중단 동작(pm2 blue/green 실측)은 보지 못했다. `test-git-hooks.sh`·커밋 훅 시나리오는 실행하지 않았다(Developer 보고에 의존). `kis-overseas.ts` 의 응답 파싱 하단과 `order-sync` 는 읽지 않았다. 폴러·`approval-notify`·T-044 변경은 범위 밖이라 보지 않았다. 실제 KIS 에 주문을 보내는 시험은 하지 않았다.
- [00:53] QA 에 넘기는 high_risk_areas — route.ts:310-340(선점·fail-closed·submit try 경계), :342-456(후처리 분리), :103-117(복귀·경보), :155-162(만료 UPDATE), entry-claim.ts:31-67(SQL 3문장). 운영 스모크 제안: 장외에 `/api/cron/entry-watcher` 가 `market_closed` 로 응답, 배포 뒤 `pm2 list | grep stockinvest-cron` 1행, 첫 실사용(T-046 이후)에서 `executing` + 주문 번호 연결과 킬스위치 중 복귀 루프를 관찰.
- [00:53] **최종 판정: pass (scope: src/app/api/cron/entry-watcher/, src/lib/signals/entry-claim.ts, src/lib/signals/__tests__/entry-claim.test.ts)**

## QA

- [10-18 01:16] **운영 배포 후 검증(Leader 직접 실행, QA 역할 겸임)**: 릴리스 `20261018-011511-d27e08f2` · `RELEASE_RESULT ok` · exit 0. `pm2` stockinvest/stockinvest-cron online(cron 1행) · `/api/health` ok·killSwitch false·safety green · 배포본 `entry-watcher/route.ts` `9e31025f65e5`·`entry-claim.ts` `487317fb6c8d` = 커밋·감사본과 일치. 배포 이후 `pm2-err` 에 entry-watcher 관련 새 오류 없음.
- [10-18 01:16] **장외 호출 실측**: `POST /api/cron/entry-watcher` → `{ok:true, skipped:true, reason:"market_closed", processed:0}`, 4ms, `signals` 상태 분포 호출 전후 동일. 진입 감시 대상(`approved_pending_entry`) 0건이라 **선점 경로는 운영에서 아직 한 번도 실행되지 않았다** — 이 경로의 증거는 단위·통합·실DB SQL·일회용 DB 동시성 실험이다.
- **아직 관측하지 못한 것**: 운영에서 실제로 `claim_lost`·선점·복귀가 일어나는 모습(카드가 승인되고 T-046 이 들어간 뒤 첫 실사용), 틱 요약 로그의 `claim_lost`/`order_uncertain` 건수.

## 최종 요약 (사용자용)

**무엇이 문제였나**: 진입 감시 cron 이 시그널을 조회한 뒤 주문하고 나서야 상태를 바꿔, 같은 시그널을 보는 실행이 둘이면 실주문이 두 번 나갈 수 있었다(T-042 외부 검토가 지적).

**무엇을 했나**
- 주문 **직전**에 조건부 UPDATE 로 선점하고 이긴 쪽만 주문. 선점 실패·DB 오류면 주문하지 않는다. 성공·결과 불명은 잠금 유지, 확정 거부와 송신 전 예외만 되돌려 다음 틱에 재시도.
- 구현 중 자체 점검으로 **후처리 예외가 선점을 풀어 이미 나간 주문이 재주문되는 허점**을 찾아 `submitOrder` 호출만 별도 try 로 분리했다.
- 독립 감사가 만료 UPDATE 의 상태 조건 누락(R-2)을 찾았고, Codex 가 앱·DB 시계 편차와 0행 거짓 보고를 지적해 만료 UPDATE 도 DB 시각·상태 조건부로 바꿨다.
- **검증**: 테스트 52개(상태를 가진 가짜 DB 로 경합 재현) · 변이 38개 전부 검출 · 운영 DB 롤백 트랜잭션 SQL 11건 · 일회용 MariaDB 에서 300행×12 동시 선점(승자 정확히 1, 상태 조건 없는 대조군은 12) · 독립 감사 2라운드 통과 · Codex 반영 · 운영 배포 후 장외 호출 확인.

**남은 위험·후속**
- 위험의 방향이 "이중 주문"에서 "주문 누락 + 무음"으로 바뀌었다 — 선점 뒤 프로세스가 죽으면 `executing`+주문 번호 없음으로 남고 알림이 없다. 틱 자동 경보는 **T-046 선행 조건**, 그때까지는 `docs/telegram-approval.md` §7 의 점검 SQL.
- 폴러 Low 하드닝 3건은 **T-047**(텔레그램 스위치를 켜기 전까지).
- 이 경로는 운영에서 아직 실행된 적이 없다(대상 시그널 0건). 첫 실사용은 T-046 이후.
- **작업 사고**: 마무리 중 `docs/telegram-approval.md` 작업 트리 파일을 제 스크립트 실수로 0바이트로 비웠다(다른 세션 T-044 의 미커밋 변경 포함). 커밋에는 영향이 없다(HEAD 기반 블롭으로 스테이징). 복원 완성본(세션 scratchpad `telegram-approval.RESTORED.md`)을 사용자가 직접 `cp` 로 복원했고, 바이트 일치·`git diff HEAD` 가 T-044 원래 규모(7+/2-)와 같음을 확인했다(2026-10-18). 재발 방지 규칙은 메모리 `feedback_safe_file_rewrite.md`.

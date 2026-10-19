---
task_id: T-050
title: 사용자 시나리오 확정(custom/confirm)의 expires_at 이 UTC 문자열로 저장돼 24시간이 아니라 약 15시간 만에 만료된다 (T-046 감사 R-3, 범위 밖이라 분리)
status: todo
priority: normal
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-046, T-045]
tags:
  - type/task
  - domain/signals
  - domain/safety
aliases:
  - custom confirm 만료 시각
  - custom signal expiry timezone
created: 2026-10-18
updated: 2026-10-19
---

# T-050 — `signals/custom/confirm` 의 만료 시각 UTC/KST 어긋남

## 배경

T-046 독립 감사(Reviewer, R-3 MINOR)가 발견하고 Leader 가 코드로 재확인했다(2026-10-18).

`src/app/api/signals/custom/confirm/route.ts:134-135`:

```ts
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  .toISOString().replace('T', ' ').slice(0, 19);
```

`now + 24h` 라는 **올바른 시점**을 UTC 벽시계 문자열로 만들어 KST `DATETIME` 컬럼(`signals.expires_at`, DB 서버·앱 풀 모두 KST)에 넣는다. DB 는 이 값을 KST 로 읽으므로 실제 만료는 `now + 24h − 9h = now + 15h` 이다. T-046 의 카드 시각 버그와 **같은 원인**이다.

## 영향

- 방향이 **조기 만료**라 자금 위험은 아니다(늦게 만료돼 낡은 가격으로 주문이 나가는 쪽이 아님). 사용자가 24시간으로 기대한 시나리오가 15시간 뒤 사라지는 기능 결함.
- 이 파일은 안전 경로(`src/app/api/signals/` 등 커밋 훅 대상)라 수정에는 독립 감사가 필요하다 → T-046 에 섞지 않고 분리했다.
- 같은 패턴이 다른 곳에 있는지는 2026-10-18 `grep`(`toISOString()` + `valid_from|expires|deadline`)으로 post-market 엔진 외에는 이 한 곳만 확인했다(`post-market-engine.ts:247` 의 `nextDay` 는 날짜 부분만 쓰고 00:00Z = 그 거래일이라 정상).

## 작업 범위 (제안)

1. 위 한 곳을 KST 벽시계로 저장(`toKstDatetime` 같은 공용 헬퍼로 모을지 판단 — 현재 `post-market-engine.ts`·`entry-claim.ts` 에 각각 있음. 세 번째 사용처가 생기므로 `src/lib/` 공용 유틸 승격을 검토).
2. 기존 `scenario_source='user'` 행은 만료가 지난 것이 대부분이라 데이터 보정은 불필요할 가능성이 높다 — 착수 때 `expires_at` 이 미래인 `user` 행이 있는지 읽기 전용으로 확인.
3. 시험: 24시간 만료가 실제 KST 로 24시간 뒤인지(서버 TZ 가 UTC/KST 어느 쪽이든).

## 우선순위 판단

사용자 시나리오 기능을 실제로 쓰는 빈도(`scenario_source='user'` 행이 전체 9행뿐 — T-048 실측 2026-10-18)가 낮아 급하지 않다. T-046 배포 후 여유가 있을 때.

## Developer (구현·검증 기록, 2026-10-18)

judge 접수: `local_fix` · 복잡도 0.91 · 위험 R2 · developer opus · 데모 불필요 · 다음 `assign`. 복잡도가 낮아 Leader 가 직접 구현하고 독립 Reviewer 가 감사한다.

| 파일 | 해시(SHA-256 앞 12자리) | 변경 |
|---|---|---|
| `src/lib/time.ts` | `dac77c104318` | `toKstDatetime(date)` 추가 — KST 벽시계 `YYYY-MM-DD HH:mm:ss`, +9h 산술 |
| `src/app/api/signals/custom/confirm/route.ts` | `4d252c662a43` | `expiresAt = toKstDatetime(new Date(Date.now() + 24h))` (옛: `toISOString()` 을 잘라 UTC 벽시계로 저장) |
| `src/lib/__tests__/time.test.ts` | `31726d00e08b` | `toKstDatetime` 시험 3개 — UTC 01:00→10:00 · 날짜 경계(UTC 15:00→다음 날 00:00, 12-31 14:59:59Z, 연말) · `Intl`(sv-SE, Asia/Seoul) 독립 계산과 윤일 포함 비교 |
| `src/app/api/signals/custom/confirm/__tests__/route.test.ts` | `4d59168f62b0` | INSERT 의 `expires_at` = 지금(KST)+24h 단언 2개(단일·분할 2건), 옛 UTC 값이 아님을 명시 |

**왜 새 파일이 아니라 `src/lib/time.ts` 인가:** 이미 KST 헬퍼(`kstTodayStart`·`formatAbsoluteKST` 등)가 모인 모듈이고 다른 세션이 건드리지 않은 파일이다. 같은 변환이 `post-market-engine.ts`(`toKstDatetime`)와 `entry-claim.ts`(`toKstWallClock`)에 각각 있지만, 감사·배포를 마친 파일이라 이번에 합치지 않았다(합치기는 선택적 후속).

**수정 전 실패 확인(TDD):** 새 테스트 5개가 수정 전 코드에서 실패 — 라우트 2개는 값이 옛 UTC 문자열(`2026-10-20 00:00:00`), `toKstDatetime` 3개는 함수 없음.

**검증**

| 항목 | 결과 |
|---|---|
| 대상 suite(time·custom 전체) | 3 suite / 65 테스트 통과 |
| 격리 사본(HEAD `216914c` + 위 4개 파일) 전체 | `tsc` 오류 **0** · jest **144 suite / 2967 테스트 전부 통과** |
| 변이 6개(격리 사본) | **6/6 사망** — 라우트를 옛 UTC 방식으로 복귀(2 실패)·오프셋 제거(5)·부호 반전(5)·오프셋 8시간(5)·만료 12시간(2)·`T` 치환 누락(5). 변이 뒤 해시 4/4 원복 확인 |
| 실데이터(읽기 전용) | `scenario_source='user'` 9행의 TTL 이 **전부 15시간** — 버그가 실제로 작동하고 있었다는 직접 증거. 만료 전(`expires_at > NOW()`) 행 **0건** → 데이터 보정 불필요 |

**한계(기록)**
- 방향이 조기 만료였으므로 자금 위험은 없었다. 이 수정으로 사용자 시나리오는 의도한 24시간 동안 `approved_pending_entry` 로 진입 감시에 남는다 — 이전에는 15시간 만에 조용히 사라졌다. 즉 **진입 감시가 보는 시간이 9시간 늘어난다**(정상화이지만 동작 변화이므로 사용자에게 알린다).
- 이 경로는 사람 승인 없이 곧바로 `approved_pending_entry` 로 들어간다(T-029). 이번 변경은 그 성질을 바꾸지 않는다.

## Codex C2 (외부 읽기 전용 검토, 2026-10-18)

- judge C2: `codex_required=true` · `adversarial-review` · focus `concurrency` · 규칙 `CX-limit-unknown-r2` · 스위치 on. 인계서 `scratchpad/handoff-T-050-c2.md`, 실행 67초, 스냅샷에서 파일 변경 0. KST 변환 자체와 응답 호환성에서는 결함 없음.
- **high 2건 — 둘 다 코드로 사실 확인(Leader 직접). 둘 다 T-050 이 만든 결함이 아니라 기존 구조 결함이고, 15시간 만료가 우연히 완충하던 노출 구간을 이 수정이 24시간으로 넓힌다.**
  1. **확정 API 에 서버 멱등성이 없다**(`custom/confirm/route.ts:168-198`): INSERT 는 무조건 실행되고 원본 시그널 소비(`UPDATE … WHERE status IN …`)는 INSERT 뒤다. 같은 시나리오를 두 번 확정(동시 요청·재시도·탭 두 개·성공 후 리다이렉트 1.2~1.8초 사이 재클릭)하면 서로 다른 signal 두 건이 각각 선점돼 **한 번 의도한 시나리오에 실주문 둘**이 나갈 수 있다. 유니크 인덱스 `uq_signals_scenario_card` 는 `valid_from` 이 NULL 인 `user` 행을 막지 않는다(NULL 은 서로 다른 값). UI 는 제출 중 버튼을 비활성화하지만 서버 방어가 아니다.
  2. **`holding_deadline` 을 주문 전에 검사하지 않는다**: `resolveHoldingDeadline`(`entry-watcher/route.ts:49`)은 **주문 뒤** `position_state` 기록에만 쓰인다. 보유 마감이 이미 지난 시나리오도 `expires_at` 전이면 선점·주문을 통과한다. 청산 엔진이 꺼져 있어 그 포지션은 자동 정리되지 않는다(`holding-checker` 가 "보유기간 초과" 경고만).
- **Leader 판단:** T-050 단독 배포를 **보류**한다. 근거: ① 15시간 버그는 안전한 방향의 오류(조기 만료)였고 ② 이 기능은 거의 쓰이지 않아(`scenario_source='user'` 전체 9행, 마지막 09-03) 서두를 이유가 없으며 ③ 고치면 위 두 결함의 노출이 넓어지므로 **하드닝이 먼저**여야 한다. 하드닝은 [[T-052-custom-confirm-hardening]] 로 분리. 코드는 작업 트리에 있고 커밋·배포하지 않는다(커밋하면 다음 push 에 실려 배포되므로).
- 사용자 선택지(알림 완료 시 기록): (1) T-052 후 T-050 배포(권고) · (2) T-050 지금 배포 + T-052 후속 · (3) T-050 폐기(15시간 유지).

## Reviewer

- [20:20] 독립 감사 시작 (task T-050, 2026-10-18). 대상 4개 파일의 SHA-256 앞 12자리를 Developer 표와 대조: 작업 트리 4/4 일치, 격리 사본(`scratchpad/t050repo`) 4/4 일치(`dac77c104318`·`4d252c662a43`·`31726d00e08b`·`4d59168f62b0`) [확실]. 격리 사본이 HEAD `216914c` 와 이 4개 파일만 다름을 `git archive HEAD` 대조(`diff -rq`)로 확인했고, `package.json`·`jest.config.js`·`tsconfig.json` 은 HEAD 와 동일하다. 변이는 격리 사본에서만 했고 끝난 뒤 4개 파일 해시를 원본과 재대조해 복원을 확인했다. 공유 트리에 섞인 타 세션 변경(T-040·T-044·T-047)은 감사 대상이 아니라 읽지 않았다.
- [20:20] 의도 검증: 목적은 "사용자 시나리오 확정(`custom/confirm`)의 `expires_at` 을 코드가 의도한 24시간으로, DB·앱 풀이 KST 인 DATETIME 에 KST 벽시계로 저장한다". 구현은 이 목적을 충족한다 [확실]. 라우트 diff 는 import 1줄 + 산식 1줄(+주석)이고(`route.ts:17,135-136`) 응답 형태·상태 코드·알림·`sourceSignalId` 처리·INSERT SQL 은 바이트 단위로 불변이다. `git diff HEAD --stat` 4개 파일 61줄 추가·3줄 삭제.
- [20:20] 변환 정확성(요청 1) — 이상 없음 [확실]. 구현 복제가 아니라 **실제 `src/lib/time.ts` 를 `typescript.transpileModule` 로 읽어** `Intl.DateTimeFormat`(Asia/Seoul, `hourCycle:'h23'`) 오라클과 비교했다: 2026-01-01~2029-01-01 구간 17분13초 간격 + 모든 일자의 UTC 15:00(=KST 자정) 경계 ±2초 총 102,701개 시각, 프로세스 TZ 4종(UTC·Asia/Seoul·America/Los_Angeles·Pacific/Kiritimati) 불일치 0건. 별도로 연말(2026·27·28-12-31 15:00Z)·윤일(2028-02-28/29 15:00Z)·3월 1일 경계 ±3초를 촘촘히 넣은 구현 복제본 102,876개를 TZ 6종에서 비교해 불일치 0건. `Invalid Date` 는 `RangeError` 로 던지지만 `Date.now()+24h` 는 항상 유한이라 도달하지 않고, 도달해도 라우트 try/catch 가 500 으로 처리한다(조용한 쓰레기 값은 없음).
- [20:20] 저장·읽기 일관성(요청 2) — 이상 없음 [확실]. 실DB 읽기 전용 조회: `@@system_time_zone=KST`, `@@session.time_zone=SYSTEM`, `signals.expires_at`·`created_at`·`updated_at` 모두 `datetime`(TIMESTAMP 가 아니라 세션 TZ 변환 없음). 앱 풀과 같은 옵션(`db.ts:47` `timezone:'+09:00'`)으로 접속해 실제 `toKstDatetime(now+24h)` 리터럴을 `TIMESTAMPDIFF(MINUTE, NOW(), ?)` 로 재니 **새 값 1440분 / 옛 UTC 값 900분**(프로세스 TZ 3종에서 동일)이고, 풀이 만든 `Date` 와 `Date.now()+24h` 의 차이는 1초 미만이다. `scenario_source='user'` 9행의 TTL 이 전부 정확히 900분(= 24h − 9h)인 것도 재확인했다(버그가 실제로 작동). 읽는 쪽 전수: `entry-claim.ts:34`(선점 `expires_at > NOW()`), `entry-watcher/route.ts:185-189`(앱 시계는 후보 선별만, 확정은 DB `<= NOW()` 조건부 UPDATE), `approval-transitions.ts:111,138,143`, `service.ts:378,525,675`, `api/signals/route.ts:121`, `favorites/route.ts:34`, `signal-expiry/route.ts:27` 모두 DB `NOW()`(KST) 또는 풀이 만든 `Date` 와 비교한다. `signal-expiry` 의 만료 대상(`EXPIRABLE_STATUSES`)에는 `approved_pending_entry` 가 없어 이 행의 만료는 entry-watcher(장중 틱)와 선점 조건이 맡는데, 둘 다 DB 시각이라 저장 형식과 맞는다.
- [20:20] 같은 패턴 잔존 여부(요청 2) — 없음 [확실]. `src`·`scripts` 에서 `toISOString()` 뒤 `slice/replace/substring`, `slice(0,19)`, `replace('T',' ')` 를 전수 grep 했다. DATETIME 에 문자열로 바인딩하는 곳은 `post-market-engine.ts:89`·`entry-claim.ts:80`(둘 다 +9h 보정 후)과 이번 `time.ts:25` 뿐이다. 나머지는 표시·프롬프트(`ai-filter.ts:119,542`·`rag/format.ts:169`)·KIS 질의 일자(`kis-domestic.ts:106-107`)·날짜 키(`rag/retrieval.ts:54`·`research/*:44,52`·`ScenarioBuilder.tsx:50,54`·`post-market-engine.ts:182,247,352`)이며 DATETIME 바인딩이 아니다. `engine.ts:684` 는 SQL `DATE_ADD(NOW(), …)`, `service.ts:403` 은 `Date`(`router.ts:311-318`)라 풀이 변환한다.
- [20:20] 동작 변화 안전성(요청 3) — 새 자금 위험 없음 [확실], 다만 "원래 사양 복원"의 근거는 코드 의도와 산술 일치뿐이고 명세 문서는 없다 [가능성 높음]. 15h 가 의도된 안전 장치였다는 근거를 찾지 못했다: (a) `expiresAt = now + 24h` 산식은 파일 최초 커밋 `9e77103`(2026-05-25)부터 같고 15h 언급은 코드·`docs/`(`db-schema.md:85` 는 기본 TTL 언급뿐)·T-029 어디에도 없다, (b) 900분은 정확히 24h − UTC 오프셋 9h 라 산술 부산물이다, (c) UI 에 TTL 약속 문구가 없고 `recommend/page.tsx:263` 은 실제 `expires_at` 을 그대로 보여준다. 오래된 가격 위험: 진입 감시는 매 틱 `kis.getTicker` 현재가를 가져와(`entry-watcher/route.ts:252`) `price_zone` 과 비교하고 구간 밖이면 주문 없이 끝낸다(`:262-270`). 주문가는 구간 중간값 `row.price` × (1 ± chasePct)(`:306`)라 구간에 묶여 있고, 24시간 뒤에도 "낡은 호가"가 아니라 **그 시점 현재가가 구간 안일 때만** 나간다. 선점(`:353`)은 DB `expires_at > NOW()` 라 만료 후 주문 불가, `submitOrder` 의 DRY_RUN·KILL_SWITCH·매수 1회/일일 한도는 주문 시점에 평가된다. 분할 게이트(`:285-296`)는 모든 슬라이스가 같은 `expiresAt` 을 써 동시에 만료하므로 새 경합이 없다. `holding_deadline` 은 진입 전 관문이 아니라 진입 **후** `setPositionScenarioExit`(`:436-437`)로 기록되고 `holding-checker` 가 경고만 보낸다(자동 청산 없음).
- [20:20] 실제로 늘어나는 노출(비결함, 사용자 고지 필요): 구간 도달 기회가 9시간 더 생긴다. 국내 시나리오를 장중에 확정하면 15h 로는 확정 당일 장중만 가능했고(만료가 자정~06:30 사이), 24h 로는 **다음 거래일 장 시작 후 확정 시각까지**가 추가된다 — 밤새 갭으로 구간에 들어온 가격이 개장 직후 틱에서 체결될 수 있다. 이는 사용자가 구간을 정한 시나리오의 정의 그대로다. 매도는 1회/일일 한도에서 제외돼 있으나(`dry-run.ts:173,183,192`) 수량이 확정 시점 `holdingQty` 로 고정이고 보유 초과 주문은 KIS 가 거부한다(`dry-run.ts:270` `insufficient_qty`). 현재 `approved_pending_entry` 행은 0건이라(실DB) 진행 중이던 15시간 행도 없다 [확실].
- [20:20] 테스트 품질(요청 4): 대상 3 suite 65개를 TZ 4종(Asia/Seoul·UTC·America/Los_Angeles·Pacific/Kiritimati)에서 모두 통과, 격리 사본 전체 jest 144 suite / 2967 테스트 통과, `tsc --noEmit` 오류 0 — Developer 보고와 일치 [확실]. INSERT 열은 13개이고 `expires_at` 은 11번째(`route.ts:169-172`), params 배열에서도 11번째(`:174-187`)라 `params[10]` 이 맞다 [확실]. 변이 14개(격리 사본): 라우트 7개 중 옛 UTC 로 복귀·`+24h` 제거·15h·25h·params 순서 교환(`expires_at`↔`market`)·`null` 6개는 각각 2개 실패로 사망, **SQL 열 목록만 교환(RM6)은 생존**(R-2). `time.ts` 7개 중 오프셋 제거·부호 반전·`T` 치환 누락(각 5개 실패)·초 반올림(1개 실패)은 사망, 등가 변이(`sv-SE` + `timeZone:'Asia/Seoul'`)는 생존이 정상, **프로세스 TZ 에 기대는 2종(`getTimezoneOffset`·무-TZ `toLocaleString('sv-SE')`)은 KST 러너에서 52/52 통과로 생존**하고 TZ=UTC(두 변이)·America/Los_Angeles(`getTimezoneOffset` 변이만 실행)에서만 5개 실패(R-1). 라우트를 옛 방식으로 되돌리면 새 테스트가 실패함을 직접 확인했다.
- [20:20] 범위(요청 5) — 이상 없음 [확실]. 변경은 4개 파일 안에 있다. `time.ts` 는 export 추가뿐이고 기존 export(`kstTodayStart` 등)는 불변이며, 클라이언트 컴포넌트도 import 하는 모듈이지만 추가 함수는 순수·무의존이다. 같은 이름 `toKstDatetime` 이 `post-market-engine.ts:88` 에도 export 돼 있어 이름 충돌 소지가 있으나, 라우트는 `@/lib/time` 에서만 가져오고 두 모듈은 서로 import 하지 않아 현재 충돌은 없다(R-3).
- [20:20] R-1 [MINOR] `toKstDatetime` 시험이 러너의 TZ 에 기대는 회귀를 KST 환경에서는 못 잡는다. 근거: `time.test.ts:47-65` 가 프로세스 TZ 를 고정하지 않고 `jest.config.js` 에도 TZ 설정이 없으며 러너(개발 서버)가 KST 다 — 변이 TM1(`getTimezoneOffset`)·TM2(무-TZ `sv-SE`)가 KST 에서 생존, UTC/LA 에서는 사망 [확실]. 운영·개발이 모두 KST 라 현재 실해는 없다(T-046 R-5 와 같은 지적). Developer 문서가 "서버 TZ 가 UTC/KST 어느 쪽이든"을 시험 항목으로 적었는데 시험이 그것을 스스로 강제하지는 않는다. 권고: 시험 안에서 `process.env.TZ` 를 UTC·America/Los_Angeles 로 바꿔 가며 반복(Node 20 에서 런타임 변경이 `getTimezoneOffset` 에 반영됨을 확인).
- [20:20] R-2 [NIT] 라우트 시험이 `params[10]` 을 하드코딩해 SQL 열 목록과 묶여 있지 않다. 근거: 변이 RM6(`status, expires_at` → `expires_at, status` 를 SQL 에서만 교환)이 65개 시험을 전부 통과한다 [확실]. 기존 T-029 시험도 `params[4]` 식으로 같은 방식이라 관행과는 일관되고, 실DB 였다면 DATETIME 에 `'approved_pending_entry'` 가 들어가 엄격 모드에서 오류가 난다(조용한 오염은 아님) [가능성 높음]. 권고: INSERT SQL 의 열 목록을 파싱해 `expires_at` 위치를 구하는 헬퍼.
- [20:20] R-3 [NIT] 같은 변환이 세 벌이고 그중 둘이 같은 이름으로 export 된다: `time.ts:24`(신규)·`post-market-engine.ts:88`(export)·`entry-claim.ts:79`(`toKstWallClock`, private). 세 구현이 현재 같은 식임을 확인했다 [확실]. Developer 가 감사·배포를 마친 파일을 건드리지 않으려 의도적으로 합치지 않았다고 기록했고 그 판단은 이번 task 범위에선 타당하다. 권고: 별도 task 로 `time.ts` 하나로 합치고 `post-market-engine.ts` 는 재export — 그 전까지 한쪽만 고치는 드리프트 위험이 남는다.
- [20:20] R-4 [NIT, 정보] 보유 마감일(`holding_deadline`)이 오늘·내일인 시나리오는 진입이 마감 이후에 일어날 수 있는 구간이 15h → 24h 로 늘어난다. 그 경우 `holding-checker`(`holding-checker/route.ts:33-35,65-68`)가 진입 직후 "보유기간 초과" 경고를 한 번 보내고 마감을 비운다. 경고뿐이고 자동 청산은 없으며 기존에도 있던 가장자리 사례라 비차단이다 [확실 — 코드 근거].
- [20:20] 범위 밖 관찰 1건(이번 변경과 무관, 조치 불요): `api/signals/route.ts:77` 의 `body.expiresAt` 문자열은 `router.ts:313-315` 에서 `new Date(raw)` 로 프로세스 TZ 기준 해석된다. 운영 서버가 KST 라 현재 문제없고, 이번 task 의 `Date` 바인딩 경로와는 다르다 [가능성 높음].
- [20:20] QA 인계(high_risk_areas): ① 배포 후 첫 `scenario_source='user'` 행에서 `TIMESTAMPDIFF(MINUTE, created_at, expires_at)` 이 900 이 아니라 **1440** 인지(읽기 전용 SELECT) ② 사용자에게 "사용자 시나리오가 15시간이 아니라 24시간 진입 감시에 남는다(국내는 다음 거래일 개장 후까지)"를 고지 ③ R-1·R-3 은 후속 task 후보. CRITICAL·MAJOR 0건, 비차단 MINOR 1·NIT 3.
- [20:20] **최종 판정: PASS (scope: src/app/api/signals/custom/confirm/route.ts, src/app/api/signals/custom/confirm/__tests__/route.test.ts, src/lib/time.ts, src/lib/__tests__/time.test.ts)**

## Leader 기록

- [10-18] T-046 Reviewer 가 발견(R-3) → Leader 가 코드 확인 후 분리. 코드·DB 변경 없음.
- [10-18 저녁] Developer(Leader 직접)→Reviewer PASS(R-1 MINOR·R-2~4 NIT, 비차단)→judge C2→Codex high 2건(위)→**배포 보류**, [[T-052-custom-confirm-hardening]] 로 분리. 미커밋.
- [10-19 19:20] 선행 조건이던 [[T-052-custom-confirm-hardening]] 이 구현·독립 감사(4라운드, pass)를 마쳐 **T-052 와 함께 2차 배포**한다. 이 task 의 코드(`time.ts` `toKstDatetime`, `custom/confirm/route.ts` 의 만료 문자열)는 감사본 그대로(`time.ts` `dac77c104318` · `time.test.ts` `31726d00e08b`)이고 T-052 감사 scope 에도 포함됐다. 배포 뒤 확인은 T-052 Leader 기록 참조.
- [10-19 19:23] **배포 완료** — [[T-052-custom-confirm-hardening]] 과 함께 커밋 `cb68cfc`·릴리스 `20261019-192141-cb68cfc4`. `time.ts`·`time.test.ts` 는 감사 해시 그대로 배포됨(`time.ts` `dac77c104318` 확인). 24시간(1440분) 만료의 실제 확인은 첫 `scenario_source='user'` 행에서 한다(T-052 Leader 기록 참조). 이 문서 변경은 다음 코드 커밋에 함께 싣는다.

---
task_id: T-054
title: 텔레그램 폴러 — 단조 증가 오프셋 저장 SQL 을 정확 일치로 고정하는 테스트 (T-047 Reviewer R-2·R-10, 스위치 켜기 전)
status: in-progress
priority: normal
roles_involved: [leader, developer, reviewer]
related_tasks: [T-047, T-042]
tags:
  - type/task
  - domain/safety
  - domain/notify
aliases:
  - 폴러 SQL 고정
created: 2026-10-19
updated: 2026-10-19
---

# T-054 — 폴러 테스트 보강 (R-2·R-10)

## 배경

T-047 은 오프셋 저장을 단조 증가 SQL 로 바꿨고, 락을 잃은 뒤에도 처리가 끝난 업데이트의 오프셋을 저장하는 설계의 **안전 근거가 이 SQL** 이다(더 큰 값을 되돌리지 못함). 그런데 jest 에는 DB 가 없어 SQL 은 문자열 구조 검사로만 고정돼 있고, Reviewer R-2 는 `OR→AND` 변이(오프셋이 영영 오르지 않음)가 테스트를 통과함을 보였다. R-10 은 락 상실 후 재주문 재현 테스트 제목이 순차 경로만 모사해 과대하다는 지적.

## 사용자 결정 (2026-10-19)

"권고대로" — 텔레그램 스위치를 켜기 **전**에 R-2 를 먼저 한다(스위치는 수요일 이후 평일 장 마감 뒤 폰 앞에서).

## 사양

1. 저장 SQL 문장을 **전체 정확 일치(`toBe`)** 로 고정한다(공백 정규화 후). 파라미터 값(`telegram_poll_offset`, JSON 직렬화된 정수)도 정확 일치.
2. 변이(`OR→AND`, 비교 방향 `>`→`<`, `IF` 분기 뒤바꿈, `NOT REGEXP` 가드 제거, `VALUES(value)` 제거)가 이 테스트로 죽는지 격리 사본에서 확인.
3. R-10: 재현 테스트 제목을 실제 모사 범위("순차 재수신 시나리오")로 바로잡는다. 단언은 약화 금지.
4. **서버 모듈(`telegram-poller.ts` 등)은 수정하지 않는다.** 테스트 파일만.

## Reviewer

- [18:12] [확실] 감사 대상·해시. 작업 트리 4/4 일치(SHA-256 앞 12자리): 폴러 테스트 `0646f0a8e329` · wiring 테스트 `77b11456ef99` · 서버 모듈 `telegram-poller.ts` `4730b949056a` · `telegram-approval.ts` `1546a94a5fb0`. 서버 모듈 2개는 `git diff HEAD` 변경 0줄(수정 시각도 10-18 이후 불변). 격리 사본(`scratchpad/t054repo` = HEAD `22aa440` + 감사 2파일)도 4/4 일치하고, 변이 시험 뒤 `telegram-poller.ts` 를 `4730b949056a` 로 원복한 것을 확인했다. `src/lib/signals/` 안의 다른 미커밋 변경(`approval-notify*`·`service.ts`·`entry-cash-precheck*`·`custom-confirm-guard.test.ts`)과 `notify/telegram*.ts`·`docs/telegram-approval.md` 는 이번 task 소속이 아니라 감사하지 않았다.
- [18:12] [확실] 감사 1 — 고정 상수와 실제 소스. `MONOTONIC_SAVE_SQL` 는 테스트 파일 안의 문자열 리터럴이고 소스에서 import 하지 않는다(순환 검증 아님 — 소스 SQL 을 바꾸면 테스트가 죽는다는 것을 아래 변이로 확인). 소스(`telegram-poller.ts:420-423` 의 두 조각을 이은 문장)·테스트 상수·T-047 Developer 가 실측했다고 적은 문장(T-047 `[20:17]`)을 바이트 단위로 비교해 3자가 같다. 호출 인자는 `(sql, ['telegram_poll_offset', JSON.stringify(n)])` 두 개이고 테스트가 `toHaveLength(2)`·`toStrictEqual` 로 고정한다(숫자형 파라미터는 사망). 오프셋 키를 쓰는 곳은 소스 전체에서 `saveOffset`(쓰기)과 `loadOffset`(읽기) 한 곳씩이라 이 고정이 쓰기 경로 전체를 덮는다.
- [18:13] [확실] 감사 2 — 변이 시험(격리 사본, 매번 원복). 죽어야 하는 변이 19/19 사망: `OR→AND`(4건 실패) · `>`→`<` · `>`→`>=` · IF 분기 뒤바꿈 · `NOT REGEXP` 가드 제거 · `NOT REGEXP`→`REGEXP` · 참 분기 `VALUES(value)`→`value` · 비교식 `VALUES(value)`→`value` · 단조 전체 제거(무조건 `VALUES(value)`) · IF 전체를 `value` 로 · 앵커 `+`→`*` · 앵커 `$` 제거 · 파라미터 키 변경 · 파라미터 숫자형 · 파라미터 `n+1` · `UNSIGNED`→`SIGNED` · CAST 제거(문자열 비교) · 테이블명 변경 · `query` 추가 인자(4건). 살아야 하는 공백만 바꾼 동치 변이 6개 중 5개 생존(이중 공백·줄바꿈+들여쓰기·`OR` 주변 공백 확대·문장 앞 개행·탭). 끝 공백 변이만 사망했는데 이를 죽인 것은 새 테스트가 아니라 **기존 T-047 테스트**(`/, VALUES\(value\), value\)$/` 가 trim 없이 끝을 앵커)다 → R-3. 의미는 같고 글자만 다른 변이(키워드 소문자 `or` · `VALUES (` 공백 · 쉼표 뒤 공백 제거 · 비교 양변 교환)는 4개 모두 사망 — "한 글자라도 바뀌면 재실측"이라는 설계 의도대로이고 실패 시 `toBe` 가 문장 차이를 그대로 보여 주며, 서식 도구는 문자열 내용을 바꾸지 않으므로 부당한 취약성으로 보지 않는다.
- [18:14] [확실] 감사 3 — R-10 diff 를 줄 단위로 읽음. `telegram-poller-wiring.test.ts` 변경은 +4/-1: 제목 한 줄 교체 + 주석 3줄 추가가 전부이고 본문(픽스처·`makeLoop` 인자·단언 6개 `submits`·`handled`·`saved`·`offsets`·`sleeps`·`conns`) 변경 0줄 → 단언 약화 없음. 새 제목 "순차 재수신 시나리오 — … 처리·저장한 직후 락을 잃고 재획득해도 …"는 픽스처(`lockGranted [true,true]` · `heldChecks [true,true,false]` · `offsets [100,104]`)와 일치해 모사 범위를 정확히 말한다. 제목에는 과대 표현이 남지 않았다.
- [18:15] [가능성 높음] R-1 [LOW] 새 주석이 과대하다(제목이 아니라 주석). wiring `:580-581` 주석은 "두 소비자가 같은 배치를 동시에 처리하는 경합(… 두 프로세스의 겹침)"은 모사하지 않는다고 하면서 그 경합을 "처리 전 락 확인과 원자적 전이가 **담당한다**"고 쓴다. 그러나 T-047 Reviewer R-9(T-047 이력서 45행 "남은 창")는 새 소유자가 이전 소유자의 저장 전에 오프셋을 읽고 `releaseClaim` 뒤에 선점하면 두 번째 주문 시도가 가능하다고 기록했고, 창은 "좁아졌을 뿐 없어지지 않았다"(수백 ms, 확정 거부 건 한정, 이중 체결 아님, 근본 해결은 `callback_query.id` 별 처리 기록이라는 후속 과제)이다. 락 확인은 창을 좁힐 뿐이고 원자적 선점은 `releaseClaim` 이후의 재선점을 막지 않는다 → R-10 이 막으려던 "R-9 창까지 막는다는 읽힘"이 주석에 새로 생겼다. 권고(주석만 수정, 실행 코드 영향 0): "…모사하지 않는다 — 동시·겹침 경합은 T-047 R-9 의 잔여 창(좁아졌을 뿐 닫히지 않음, 후속 과제: callback_query.id 별 처리 기록)이고, 실제 DB 의 단조 SQL 의미는 저장 SQL 정확 일치 테스트 + 일회용 MariaDB 실측이 근거다."
- [18:15] [확실] R-2 [NIT] 증빙 문구 정정. Developer 기록의 "`tsc --noEmit` 오류 0"은 테스트를 보지 않는다: `tsconfig.json` 의 `exclude` 가 `**/__tests__/**/*`·`**/*.test.ts` 이고 jest 는 `@swc/jest` 라 타입 검사를 하지 않는다. 그래서 이번 변경(테스트 2개)의 타입 안전성은 그 증빙으로 확인된 것이 아니다. 내가 임시 tsconfig(`extends` + 두 테스트 파일만 include, `types: [jest, node]`)로 따로 검사해 오류 0 을 확인했다 — 결과는 같지만 "테스트 파일은 `tsc` 대상 밖"이라고 적는 편이 정확하다.
- [18:15] [확실] R-3 [NIT] 새 테스트의 `.trim()` 은 기존 T-047 테스트의 끝 앵커(trim 없음)와 의도가 어긋나, 끝 공백 변이는 새 테스트가 아니라 기존 테스트가 죽인다. 동작 영향 없음 — 이번 task 에서 손댈 필요 없다.
- [18:16] [확실] 감사 4 — 정직한 한계 기록. 폴러 테스트 주석(`:223-225`)이 "jest 에는 DB 가 없어 SQL 의미는 일회용 MariaDB 실측이 근거이고 여기서는 그 문장 그대로를 고정한다 — 한 글자라도 바뀌면 실측을 다시 해야 한다는 신호"라고 밝히고, Developer 기록도 "정확 일치는 문장이 바뀌지 않았음만 보증"을 적었다. 빠진 한 가지: 근거 실측은 MariaDB 11.8.8 이고 운영은 10.11.11 이라는 점(T-047 Reviewer 의 확인하지 못한 것 (1))이 테스트 주석에는 없고 이 이력서 Developer 절에만 있다 — 주석에 한 문장 더할지는 선택. 의미 검증을 jest 로 끌어올릴 현실적 방법: (a) JS 로 SQL 의미를 흉내 내는 가짜 저장소는 wiring 테스트의 `Math.max` 가짜가 이미 하는 일이며 MariaDB 동작을 검증하지 못해 순환이다. (b) SQLite 등 다른 엔진은 `ON DUPLICATE KEY UPDATE`·`VALUES(col)`·`NOT REGEXP`·`CAST AS UNSIGNED` 의미가 달라 같은 문장을 돌릴 수 없다. (c) 현실적인 것은 일회용 MariaDB 접속 정보가 환경변수로 있을 때만 도는 opt-in 통합 테스트 또는 `scripts/` 검증 스크립트 — T-047 R-2 가 "반복 가능한 스크립트"로 권고했던 것이고 이번 사양 밖이라 후속 후보로만 남긴다. 스위치를 켜기 전 운영 10.11 대기 중 점검 실측(T-047 QA 인계 권장)은 여전히 열려 있다.
- [18:17] [확실] 감사 5 — 범위·검증. 변경은 테스트 2개 파일 안이고 서버 모듈은 0줄. 격리 사본(HEAD + 감사 2파일) 전체 jest 146 스위트 / 3149 테스트 전부 통과, `tsc --noEmit --incremental false` 도 오류 0(단 R-2). 공유 작업 트리에서 두 테스트 파일만 실행해도 91/91 통과(타 세션 미커밋 변경과 공존).
- [18:17] 확인하지 못한 것: 운영 MariaDB 10.11 에서의 SQL 실행(읽기 전용 원칙·일회용 DB 미사용), 텔레그램 실서버 동작, 타 세션 미커밋 변경이 합쳐진 작업 트리 전체의 jest/tsc(격리 사본으로 대체). 판정 사유: 사양 1·2·4 충족, 사양 3 은 제목은 충족하나 주석에 R-1 과대가 남아 조건부 통과. 조건은 wiring 테스트 주석 한 군데 수정뿐이고 실행 코드 변경이 없으므로, 수정 뒤 `git diff` 가 주석 줄 밖 변경 0 인지만 Reviewer 가 한 번 더 확인하면 된다(전체 재순환 불필요).
- [18:18] **최종 판정: CONDITIONAL_PASS (scope: src/lib/signals/__tests__/telegram-poller.test.ts, src/lib/signals/__tests__/telegram-poller-wiring.test.ts)**

## Leader 기록

- [10-19] 등록. judge 접수: `local_fix` · 복잡도 0.81 · 위험 R1 · 데모 불필요 · 다음 `assign`. T-047 Developer(맥락 보유)에게 이어서 지시.
- [10-19 18:1x] **Reviewer CONDITIONAL_PASS 조건 충족:** 조건은 wiring 테스트 주석 한 군데(R-1 LOW — 동시 처리 경합이 "원자적 전이가 담당"으로 읽혀 T-047 R-9(창이 좁아졌을 뿐 닫히지 않음)와 어긋남)의 과대 표현 정정이었다. Leader 가 Reviewer 대체 문구를 따라 주석 3줄로 고쳤다(R-9 창과 후속 과제, 단조 SQL 의 근거가 일회용 MariaDB 11.8 실측이며 운영 10.11 미실행임을 명시). diff 확인: 주석 줄 밖 변경은 Reviewer 가 승인한 R-10 제목 1줄뿐, 폴러 테스트 2개 파일 91/91 통과. **wiring 테스트 최종 해시 `e0bc9207bd91`**(Reviewer 가 본 `77b11456ef99` 에서 주석만 변경). Reviewer 판정 줄은 수정하지 않았다(CONDITIONAL_PASS 유지). R-2(tsc 가 테스트를 안 본다는 증빙 문구 정정)·R-3(NIT)은 비차단 기록. 후속 후보: 환경변수가 있을 때만 도는 일회용 MariaDB opt-in 통합 테스트.

## Developer

- [18:04] 구현 완료(미커밋, HEAD `22aa440` 기준). **테스트 파일 2개만** 바꿨다. 서버 모듈 `telegram-poller.ts`(`4730b949056a`)·`telegram-approval.ts` 는 `git diff HEAD` 변경 없음.

  | 파일 | 새 SHA-256 앞 12자리 | 요지 |
  |---|---|---|
  | `src/lib/signals/__tests__/telegram-poller.test.ts` | `0646f0a8e329` | 사양 1: 새 테스트 "🔴 [T-054] 저장 SQL 은 실측한 단조 증가 문장과 전체가 정확히 같다"(4건: 오프셋 0·110·123456789012·2^53-1). 공백 정규화 + `trim` 뒤 상수 `MONOTONIC_SAVE_SQL` 과 `toBe`, 호출 인자 개수 2, 파라미터 `toStrictEqual(['telegram_poll_offset', '<JSON 직렬화 정수>'])`. 기존 부분 일치 테스트는 실패 시 읽기 쉬워 그대로 둠 |
  | `src/lib/signals/__tests__/telegram-poller-wiring.test.ts` | `77b11456ef99` | 사양 3(R-10): 재현 테스트 제목을 "🔴 [T-047 C2] 순차 재수신 시나리오 — 확정 거부로 선점이 풀린 승인을 처리·저장한 직후 락을 잃고 재획득해도, 같은 입력을 다시 받지 않아 주문 시도는 한 번뿐이다"로 바꾸고 모사 범위·범위 밖(동시 처리 경합, 실DB 의미)을 주석으로 적음. 단언은 한 줄도 바꾸지 않음 |

- [18:04] 변이 시험(격리 사본 `scratchpad/t054repo` = `git archive 22aa440` 새로 만듦, 폴러 테스트 2개 파일). 수정 **전**(HEAD 테스트): V1 `OR→AND` **생존**(87/87 통과 — R-2 재현). V2 `>`→`<` · V3 IF 분기 뒤바꿈 · V4 `NOT REGEXP` 가드 제거 · V5a 참 분기 `VALUES(value)`→`value` · V5b 비교식 `VALUES(value)`→`value` · V6 REGEXP 앵커 변경 · V7 파라미터 키 변경 · V8 파라미터를 숫자형으로는 기존 부분 일치 검사로도 이미 사망 → 9개 중 8개 사망. 수정 **후**: **9개 중 9개 사망**(V1 4건, 나머지 각 5건 실패).
- [18:04] 격리 사본 전체 검증: `tsc --noEmit` 오류 0 · jest **146 스위트 / 3149 테스트 전부 통과**(이번 추가 4건 포함; HEAD 기준선 전체 실행은 따로 하지 않음). 폴러 테스트 2개 파일 91/91.
- [18:04] 남은 한계: 정확 일치는 문장이 **바뀌지 않았음**만 보증한다 — 의미(단조 증가·손상값 복구)는 여전히 T-047 의 일회용 MariaDB 11.8 실측이 근거이고 운영 10.11 직접 실행은 아니다. 문장을 고칠 일이 생기면 이 상수와 실측을 함께 갱신해야 한다(테스트 주석에 명시).

---
task_id: T-142
title: 킬스위치·DRY_RUN 의 값 해석 실패가 fail-open 이다 — 비 JSON 값을 문서화된 의도대로 안전 방향으로 돌린다
status: approved-deploy
priority: high
project: StockInvest
created: 2026-11-01
updated: 2026-11-01
base_ref: origin/main d0d203c (릴리스 20261101-093319-d0d203cf)
risk_level: R2
roles_involved: [leader, reviewer, qa]
related_tasks: [T-141-killswitch-presend-recheck, T-138-token-issue-single-flight]
tags:
  - type/task
  - domain/safety
aliases:
  - 킬스위치파싱실패
  - T-142
---

## 발단

사용자 지시 「먼저 T-141 배포 후에 **고치는 작업 진행해줘**」. [[T-141-killswitch-presend-recheck]] QA 가 **F-2** 로 찾은 것 중 **①(파싱 실패 분기)** 이다. QA 가 「별 task 로 미루는 것은 맞지 않다 — 파싱 실패 분기는 **트레이드오프 없이** 고칠 수 있다」고 반대해 받아들였다.

**F-2②(DB 읽기 오류 → 활성?)는 이 task 에서 하지 않는다.** 그쪽은 「DB 부분 장애에 주문을 전면 중단할지」라는 운영 성향 문제라 사용자 결정 사항이다.

## 결함 (코드로 확인)

`src/lib/safety/kill-switch.ts:134` · `src/lib/safety/dry-run.ts:41` — **같은 한 줄 패턴이 두 곳에 있다.**

```ts
const r = parseBoolFlag(JSON.parse(rows[0].value));   // ← JSON.parse 가 try 안에 있다
...
} catch {
  // DB unavailable — fall through to env
}
```

- `system_config.value` 는 JSON 문자열을 담는 규약이다(`/api/settings/safety` PATCH 가 `JSON.stringify` 로 쓴다). 그런데 사람이 콘솔·SQL 로 **`yes` 처럼 날 값**을 넣으면 JSON 이 아니다.
- 그러면 `JSON.parse` 가 던지고, 그 예외를 **「DB 를 못 읽었다」용 `catch` 가 받는다.** 결과적으로 **DB 값이 아예 없었던 것처럼** env 폴백으로 내려간다.
- env 가 미설정이면 `isKillSwitchActive()` 는 **`false`(제동 없음)** 를 돌려준다.
- **그런데 같은 파일 주석(`kill-switch.ts:109`)은 「해석 불가(오타 등) → `true`(활성) + console.error + critical 알림」이라고 적혀 있다.** 코드가 자기 문서를 지키지 못하고 있다. `flags.ts` 의 3분기 교리(`unparsable` = 항상 안전 방향)도 같은 말을 한다.
- `parseBoolFlag` 는 **`yes`·`ON`·`1` 을 이미 알아본다**(`flags.ts:28`). 즉 값을 그대로 넘기기만 하면 제대로 해석되는데, 그 전에 `JSON.parse` 가 먹어 버린다.

근거: T-141 QA 가 실행으로 재현했다 — **B**(DB 값 `yes`·env 미설정 → 송신) · **G**(1차 false·재확인 값이 JSON 아님 → 송신). 감사자는 이 두 경로를 보지 않았다.

> 🔴 **위험 등급 정정 (T-142 감사 C-1, 2026-11-01 10:09)**: 그 재현은 **모의 풀**이다. 운영 `system_config.value` 에는 **`CHECK (json_valid(value))`** 가 걸려 있어(감사자가 운영과 같은 MariaDB 10.11.11 일회용 컨테이너에서 INSERT·UPDATE·REPLACE·`ON DUPLICATE KEY`·`INSERT IGNORE` 전부 errno 4025 거부 확인, 메인 세션이 운영 `SHOW CREATE TABLE` 로 제약 존재 확인) **평범한 SQL 로는 비 JSON 값을 넣을 수 없다.** 넣으려면 `SET SESSION check_constraint_checks=0` 같은 **제약 우회**가 필요하다. 그래서 이 task 는 **「운영에서 실주문이 나갈 Critical」이 아니라 제약이 없는 환경(복원본·마이그레이션 중 테이블·우회 세션·다른 스토리지)에 대한 방어층 + 코드가 자기 문서를 지키게 하는 수정**이다. 내가 처음 적은 「Critical·실주문 재현」은 과장이었다. `priority` 는 **`critical` → `high`** 로 내렸다(감사 비차단 지적 b: O-2 는 감사자 등급 **Medium** 이고 **별 task** 사안이라, 그것을 이 task 의 critical 근거로 쓰는 것은 일관되지 않다 — 등급은 O-2 task 를 열 때 그쪽에서 매긴다).

### `isDryRun` 에도 같은 구멍이 있고, 이쪽은 **방향까지 위험하다** [확실]

`dry-run.ts:41` 은 같은 패턴이고, unset 기본값이 `true`(안전)라 「DB 비 JSON + env 미설정」은 결과적으로 안전하다. 그러나 **env 에 `DRY_RUN=false` 가 있으면 다르다**:

1. 사용자가 DB `safety_dry_run` 에 `yes`(= DRY_RUN ON, 비 JSON)를 넣는다 → 모의매매로 돌리려는 의도
2. `JSON.parse('yes')` 가 던진다 → `catch` → env 폴백
3. env `DRY_RUN=false` → **`parsed(false)` → 실거래**

즉 **「모의로 돌려 달라」는 설정이 「실거래」로 뒤집힌다.** 운영 `.env` 의 `DRY_RUN` 값은 아직 읽지 않았다(T-141 QA 미검증 목록 (3)). 값과 무관하게 경로는 존재한다.

그래서 **두 파일을 한 번에 고친다** — 범위 확대가 아니라 같은 결함의 두 인스턴스다. 다른 선택(킬스위치만 고치기)은 같은 감사를 두 번 돌게 하고, 더 위험한 쪽을 남긴다.

## 변경 (WP)

- **WP1 `src/lib/safety/flags.ts`** — `decodeFlagValue(raw: unknown): unknown` 추가. `string` 이면 `JSON.parse` 를 시도하고 **실패하면 원문 문자열을 그대로** 돌려준다. `string` 이 아니면 그대로 통과. `flags.ts` 가 3분기 교리의 집이므로 여기에 둔다. 선례가 저장소에 있다 — `order-sync.ts:1477` 이 이미 `try { decoded = JSON.parse(raw) } catch { /* 비 JSON 원문 그대로 */ }` 로 같은 일을 한다.
- **WP2** `kill-switch.ts:134` · `dry-run.ts:41` 을 `parseBoolFlag(decodeFlagValue(rows[0].value))` 로 바꾼다. **`try` 범위·`catch` 거동·env 폴백은 건드리지 않는다**(F-2② 는 이 task 밖).
- **WP3 시험** — 아래 「시험 설계」.

## 하지 않는 것

- **F-2② (DB 읽기 오류 → 활성)** — 사용자 결정 사항. `catch` 블록과 env 폴백을 그대로 둔다.
- **F-1 (잔고 캐시 적중 창)** — serve-stale(T-138 후속 1)이 주문 게이트를 건드리지 않고 없앤다.
- `parseBoolFlag` 의 토큰 집합·3분기 의미 변경. 날 값을 넘기기만 한다.
- 다른 `system_config` 독자(`order-limits.ts`·`volatility-guard.ts`·`asset-profile.ts`)의 `JSON.parse`. 숫자·객체 설정이라 불리언 교리가 적용되지 않고, 각자 실패 거동이 다르다 → 후속 후보.
- `/api/settings/safety` 쓰기 경로. 쓰기는 이미 `JSON.stringify` 라 규약을 지킨다. 문제는 **사람이 손으로 넣은 값**이다.

## 시험 설계 (변이로 확인할 것)

| # | 시험 | 잡는 변이 |
|---|---|---|
| 1 | 킬스위치 DB 값 `yes`(비 JSON)·env 미설정 → **활성(true)** | WP2 되돌림 |
| 2 | 킬스위치 DB 값 `no`(비 JSON)·env 미설정 → **비활성(false)** | 「실패하면 무조건 true」 변이 |
| 3 | 킬스위치 DB 값 `뭔가이상한값` → **활성 + console.error + critical 알림** | 「실패하면 unset」 변이 |
| 4 | 킬스위치 DB 값 `"yes"`(**JSON 으로 감싼** 문자열) → 활성이고 **알림 없음**(`parsed`, `unparsable` 아님) | 「JSON 해석을 아예 버리고 원문만 쓴다」 변이 |
| 5 | 킬스위치 **DB 읽기 예외** → env 폴백 그대로(F-2② 경계 고정) | `catch` 범위를 건드리는 변이 |
| 6 | DRY_RUN DB 값 `yes` + **env `DRY_RUN=false`** → **dryRun true**(위 뒤집힘 차단) | `dry-run.ts` 쪽 WP2 되돌림 |
| 7 | DRY_RUN DB 값 `no`(비 JSON) → false | 「무조건 true」 변이 |
| 8 | `decodeFlagValue` 단위 — 정상 JSON(`true`·`"true"`·`1`·`{}`)·비 JSON 통과·비 문자열 통과 | 헬퍼 자체 |
| 9 | **T-141 8a-0 경로(G)** — 1차 false → 송신 직전 DB 값 `yes` → `realSubmit` **0회**·`blocked_by='kill_switch'` | 재확인이 수정을 상속하는지 |

## 검토자가 먼저 볼 지점

1. **`isKillSwitchActive`·`isDryRun` 은 주문 경로만이 아니라 `/api/health`·스냅샷·설정 화면도 쓴다.** 이 변경이 그쪽 의미를 바꾸는가(감사자 F-2 권고는 「다른 호출점의 의미는 바꾸지 않는다」였다 — 나는 **함수 하나를 고쳐 전부 바꾸는 쪽**을 골랐다. 문서화된 의도가 호출점별로 다르지 않기 때문인데, 이 판단을 독립 확인해 달라).
2. **기존 시험이 지금의 fail-open 을 고정하고 있는지.** 있으면 그 시험이 의도적이었는지(= 내가 교리를 잘못 읽었는지) 판단해 달라.
3. **`decodeFlagValue` 가 바꾸는 값의 집합.** 정상 JSON 에 대해서는 거동이 완전히 같아야 한다. `"true"`(따옴표 포함)·` "yes" `(공백 포함)·`null`·`{}` 같은 경계를 직접 깨 보라.
4. **알림 폭주 가능성** — 파싱 실패가 `unparsable` 로 분류되면 `reportUnparsableKillSwitch` 가 critical 알림을 쏜다. `shouldReportUnparsable` 이 (key, raw) 당 프로세스 1회로 억제하지만, 프로세스가 2개(web·cron)이고 재기동마다 초기화된다. 지금까지 **조용히 무시**되던 값이 갑자기 알림을 내게 되는 것이 운영상 문제인지 판단해 달라.
5. **운영 DB 의 현재 값이 비 JSON 인지 먼저 확인할 것** — `safety_kill_switch` 가 `false`, `safety_dry_run` 이 `true`(둘 다 JSON 으로 유효)인 것은 확인했다. 다른 안전 플래그 행에 비 JSON 값이 있으면 **이 배포 순간 거동이 바뀐다**(알림 또는 차단). 내가 본 것은 두 행뿐이다.

## 진행 기록

- [09:40][leader] T-141 배포(릴리스 `20261101-093319-d0d203cf`) 확인 후 착수. 설계 근거를 코드로 확인했다 — ① 같은 패턴이 정확히 두 곳(`grep "parseBoolFlag(JSON.parse"`) ② `parseBoolFlag` 가 이미 `yes`·`on` 을 안다 ③ `order-sync.ts:1477` 에 같은 해결의 선례가 있다 ④ `isDryRun` 쪽은 env 에 `false` 가 있으면 **의도가 뒤집힌다**.

## 구현 (메인 세션이 직접 — developer 역할 겸함)

- [09:55] **WP1 `flags.ts` `decodeFlagValue(raw)`** — `string` 이면 `JSON.parse` 를 시도하고 **실패하면 원문 문자열 그대로**, `string` 이 아니면 손대지 않는다. 주석에 왜(파싱 예외가 「DB 를 못 읽었다」용 `catch` 로 흘러 env 폴백이 된다)·무엇을 바꾸지 않는지(DB 조회 실패 경로)·선례(`order-sync.ts` 가 `broker_payload` 를 같은 방식으로 되읽는다)를 적었다.
- [09:56] **WP2 두 호출점** — `kill-switch.ts:134` · `dry-run.ts:41` 을 `parseBoolFlag(decodeFlagValue(rows[0].value))` 로. `try` 범위·`catch`·env 폴백은 **한 줄도 건드리지 않았다**(F-2② 는 범위 밖).
- [09:58] **범위에 하나 더 넣었다 — `src/lib/ops/metrics/safety-state.ts` `crossCheck`.** 그 함수는 머리 주석에 「판독기와 **같은 해석**(`parseBoolFlag(JSON.parse(value))`)」이라고 적고 같은 판정을 복제하고 있었다. 판독기만 고치면 **그 약속이 거짓**이 되고, 비 JSON 값에서 판독기는 올바른데 ops 화면은 `mismatch`(「확인 필요」)를 띄운다. 같은 헬퍼를 쓰게 맞췄고, 주석에 「비 JSON 이라는 사실만으로는 어긋나지 않는다 — 해석 못 하는 값이면 양쪽이 활성으로 수렴하고 판독기가 critical 알림으로 따로 알린다」를 적었다. 이 파일은 `SAFETY_PATHS` 밖이지만 **같은 변경의 일부라 감사 scope 에 포함**해야 한다.
- [10:02] **WP3 시험 2파일 + ops 2건** — ① `t142-flag-decode.test.ts`(단위·17건): `decodeFlagValue` 3건(정상 JSON 7종·비 JSON 7종·비문자열 5종) · `isKillSwitchActive` 7건(`yes`→활성·알림 없음 / `ON`·`1` / `no`·`off`·`NO`→비활성 / 모르는 값→활성+critical+console.error / **`"yes"`(JSON 감싼)→알림 없음** / 빈 문자열→env / **DB 조회 실패→env 폴백 그대로**) · `isDryRun` 5건(**`yes`+env `DRY_RUN=false`→ON** / `no`→OFF / 모르는 값→ON+경고 / `"off"`→경고 없이 OFF / 조회 실패→env) ② `t142-submit-order-raw-flag.test.ts`(통합·4건): `submitOrder` 를 통째로 돌려 **B**(3단계 `yes`→송신 0·읽기 1회)·**G**(3단계 `false` → 송신 직전 `yes`→송신 0·읽기 2회)·**과차단 아님**(`no`·`no`→송신 1회)·모르는 값→차단. T-141 시험은 값을 `JSON.stringify` 로 넣어 비 JSON 경로를 전혀 지나지 않으므로 별 파일이다. ③ ops `safety-state.test.ts` 에 비 JSON 대조 2건.
- [10:10] **변이 7종 — 전부 사살.** 기준선 7스위트 **77건 통과**.

| 변이 | 실패 건수 | 뜻 |
|---|---|---|
| M1 `kill-switch.ts` 를 `JSON.parse` 로 되돌림(결함 복원) | **6** | 킬스위치 단위 4 + 통합 B·G·모르는값 |
| M2 `dry-run.ts` 를 `JSON.parse` 로 되돌림 | **3** | `isDryRun` 비 JSON 3건 |
| M3 decode 실패 → `undefined`(= 미설정 → env) | **12** | 결함과 사실상 같다 |
| M4 decode 실패 → `true`(무조건 활성) | **7** | **과차단**을 잡는다(`no`·`off`·`NO`·통합 `no`) |
| M5 JSON 해석을 아예 버리고 원문만 | **5** | `"yes"`·`"off"` 가 `unparsable` 로 떨어져 알림이 뜬다 |
| M6 비문자열 가드 삭제 | **1** | 단언 추가 전에는 **생존**했다(아래) |
| M7 ops `crossCheck` 되돌림 | **2** | 비 JSON 대조 2건 |

- [10:10] **🔴 내 변이 도구가 먼저 틀렸다 — 1차 실행의 M6·M7 결과는 쓰지 않았다.** 패치 스크립트에 작은따옴표를 `\u0027` 로 적었는데 그것이 셸 단계에서 실제 `'` 로 바뀌어 **단일 인용 문자열을 끊었다**. 결과: M6 는 `assert` 가 걸려 패치 실패(결과 없음), **M7 은 `typeof row.value === string` 같은 깨진 코드로 돌아 「9건 실패」가 나왔다** — 변이를 잡은 것이 아니라 파일이 깨진 것이다. `chr(39)` 로 다시 짜서 재실행한 값이 위 표다(M7 은 **2건**). 「실패 건수가 많다」를 성공 신호로 읽으면 안 된다는 사례다.
- [10:12] **M6 생존을 단언 하나로 닫았다.** 가드를 지워도 지금 두 호출점은 DB **문자열**만 넘기므로 거동이 같다(동등 변이). 다만 배열은 `JSON.parse` 가 문자열로 강제해 `JSON.parse([1]) === 1` 이 되고, `unparsable`(안전 방향 + 알림)이던 값이 조용히 `parsed(true)` 로 바뀐다. 그 한 줄을 단위 시험에 넣어 변이를 사살했다 — **실효는 없지만 가드의 뜻을 시험이 지키게 했다.**

- [10:18] **검증(서버, `flock` 아래)** — `npm run typecheck`(`tsc --noEmit`) **exit 0** · **필터 없는 전체 jest: 365 스위트 통과·7 스킵, 10476 통과·245 스킵, 실패 0, exit 0, 161초** · 대상 7스위트 77건 통과. `git diff --stat` 로 제 변경이 코드 4파일(`flags.ts` +22 / `kill-switch.ts` ±4 / `dry-run.ts` ±4 / `safety-state.ts` ±14)·시험 3개(신규 2 + ops 2건 추가)뿐임을 확인했다. 같은 트리의 `.codex/agents/*`·`AGENTS.md`·`RESUME.md` 변경은 **다른 세션 것이라 손대지 않았다.**

## 감사 조건 이행 (라운드 1 CONDITIONAL_PASS)

> ⚠ **이 절과 위 「구현」 절의 시각은 분 단위가 추정이다**(감사 R-4·비차단 d). 명령 출력으로 확정된 것은 배포 **09:33~09:34**(웹훅 로그)·서버 시계 **10:10**·감사자 확인 **10:13~10:16**·이 정정을 쓰는 시점 **10:17** 뿐이다. 앞으로 기록 시각은 명령 출력에서 가져온다.

- [10:12] **C-1 (조건) 이행 — 서술만 고쳤고 코드 줄은 그대로다.** ① `flags.ts` 주석 첫 문단을 「운영 표는 `CHECK (json_valid(value))` 로 비 JSON 저장을 막는다 — 이 함수는 제약이 없는 환경(복원본·마이그레이션 중 테이블·`check_constraint_checks=0` 세션)에 대한 방어층」으로 바꿨다. ② 위 「결함」 절에 위험 등급 정정 블록을 넣었다. ③ 사용자 보고도 같은 내용으로 맞춘다. **제약을 직접 확인했다** — 운영 `SHOW CREATE TABLE system_config` 에 `CHECK (json_valid(\`value\`))` 가 있다(`value` 는 `longtext ... COLLATE utf8mb4_bin NOT NULL`).
- [10:13] **R-2 (권고) 이행 — 새로 존중되는 비 JSON falsy 는 의도된 거동이다.** `no`·`off`·`n`·`False` 같은 비 JSON falsy 값은 예전에 env 폴백으로 **무시**됐고 이제 **DB 값으로 존중**된다. 특히 DRY_RUN 은 env 가 미설정·`true`·오타 어느 쪽이든 DB 의 `off` 가 **OFF(실거래 방향)** 가 된다. 이것은 결함이 아니라 문서화된 우선순위(DB override > env)대로이고, 「값을 넣었으면 그 값을 쓴다」는 3분기 교리와도 같다. 단, 제약 우회로 그런 값이 들어온 환경에서는 **DB 가 env 보다 세다**는 뜻이므로 여기 명시한다.
- [10:14] **R-3 (권고) 이행** — `safety-state.test.ts` 에 정상 JSON falsy·`null`·빈칸 3건을 더해 생존 변이 2종(S3 decode 제거 · S4 unset 행을 항상 활성)을 사살한다. **시험 파일이 바뀌었으므로 감사자에게 재확인을 요청했다**(구현 코드 줄은 그대로).
- [10:1x] **R-3 이행 확인 — 생존 변이 2종 사살됐다.** 사본에서 재실행(서버 시계 기준): 기준선 ops **17건 통과**·대상 7스위트 **78건 통과**(+1) → **S3**(`crossCheck` 에서 `decodeFlagValue` 제거) **1건 실패** · **S4**(unset 행을 항상 활성) **1건 실패** · 복원 후 17건 통과. S3 가 1건인 이유를 확인했다 — `row.value` 가 날 문자열이면 `parseBoolFlag` 가 그대로 `yes` 를 알아보므로 **비 JSON 시험은 S3 에서도 통과한다**. 깨지는 것은 **정상 JSON** `'"off"'` 다(`parseBoolFlag('"off"')` → `unparsable` → 활성 기대 → `mismatch`). 감사자가 예측한 그대로다.
- [10:14] **R-4 (Info) 이행** — `</content>` 잔재 한 줄을 지웠다. **시각 지적은 맞다**: 구현 절의 `[09:55]`~`[10:12]` 는 작업을 한 번에 적으면서 **추정으로 쓴 값**이고 일부는 감사자가 파일을 읽은 시각(약 09:50)보다 뒤였다. 실제로 확인된 시각은 배포 09:33~09:34(웹훅 로그)·서버 시계 10:10(명령 출력)뿐이다. 앞으로 기록 시각은 명령 출력에서 가져온다.

### 범위 밖 발견 (감사자 → Leader, 코드 읽기만 — 실행 안 함)

- 🔴 **O-2 (Medium, 운영에서 도달 가능)** `order-limits.ts:74-79` `getBlockedSymbols` — 값이 **유효 JSON 이지만 배열이 아니면**(`"AAPL"`·`{}`) env 목록으로 떨어진다. env 가 비어 있으면 **블랙리스트가 조용히 빈다**. CLAUDE.md 가 「화이트리스트 폐기 후 **유일한 실효 심볼 안전장치**」라고 적은 바로 그것이다. **유효 JSON 이라 `json_valid` CHECK 로 막히지 않는다** — T-142 의 CHECK 논리가 여기엔 통하지 않는다. → **별 task 권고**(이 task 에 끼워 넣지 않는다).
- **O-1 (Low)** `settings/safety/route.ts:36,62` — 설정 GET 이 `killSwitch` 를 판독기가 아니라 `getOverrides()` 로 읽는다. 비 JSON 행이 하나만 있어도 override 전체가 비어 **판독기는 활성인데 화면은 비활성**으로 보일 수 있다. → O-2 와 같은 task 로 묶는 것이 맞다.

### 검토자가 먼저 볼 지점 (스스로 아는 약한 곳)

1. **범위를 `safety-state.ts` 까지 넓힌 판단**(위 09:58). 감사자 F-2 권고는 「다른 호출점의 의미는 바꾸지 않는다」였는데, 나는 **판독기 함수 하나를 고쳐 모든 호출점을 바꾸는 쪽**을 골랐다. 문서화된 의도가 호출점별로 다르지 않다는 근거인데, `/api/health`·스냅샷·설정 화면에서 **비 JSON 값일 때 갑자기 활성으로 보이는** 것이 운영상 문제가 되는지 판단해 달라.
2. **알림 폭주** — 지금까지 조용히 무시되던 값이 `unparsable` 이면 critical 알림을 낸다. `shouldReportUnparsable` 이 (key, raw) 당 **프로세스 1회**로 억제하고 재기동마다 초기화된다. 🔴 **정정(감사 검증 5·비차단 c)**: 내가 「프로세스가 2개(web·cron)」라고 적은 것은 틀렸다 — `stockinvest-cron` 은 bash+curl 이라 플래그를 평가하는 Node 프로세스는 **web 하나**다. 운영 현재 값은 둘 다 유효 JSON(`true`·`false`)이라 **배포 순간 알림은 0건**이다(실측).
3. **`decodeFlagValue` 의 경계** — `''`(빈 문자열)은 `JSON.parse` 가 던져 원문 `''` 이 되고 `parseBoolFlag` 가 `unset` 으로 본다(의도대로). `'null'`→`null`→unset, `'{}'`→객체→unparsable. `' TRUE '`(비 JSON, 공백 포함)→원문→`parsed(true)`. 이 네 개를 직접 깨 보라.
4. **F-2② 를 남긴 경계가 시험으로 고정됐는지** — 「DB 조회 실패 → env 폴백」 2건(킬스위치·DRY_RUN)을 넣었다. 나중에 누가 `catch` 를 건드리면 이 시험이 깨져야 한다.
5. **통합 시험의 하네스가 T-141 것의 복사**라는 점(`killRaw` 만 원문 문자열로 바꿨다). 복사가 원본과 어긋나 **거짓 통과**를 만들 여지가 있는지 봐 달라.

## Reviewer

- [10:09] **범위 확인(직접)** — `git diff --stat -- src` 5개 + `git ls-files --others` 신규 시험 2개가 전부다(감사 시점에 다른 세션의 `src/` 변경은 없었다). `kill-switch.ts`·`dry-run.ts` 의 HEAD 대비 차이는 **import 1줄 + `parseBoolFlag(...)` 1줄**뿐이고 `try` 범위·`catch`·env 폴백은 한 글자도 안 바뀌었다(`git show HEAD:…` 와 대조). 변이·프로브는 서버 사본 `~/.node-local/t142-audit-base` 에서만 했고, 운영 트리 7개 파일의 sha256 은 감사 전후가 같다. 운영 DB 는 SELECT 만 했다(아래). 운영 쓰기·pm2·배포·커밋·push 없음.
- [10:09] **🔴 전제 정정 [확실] — 운영 `system_config.value` 는 `longtext NOT NULL` + CHECK `json_valid(value)` 다**(`information_schema` 실측, 서버는 MariaDB 10.11.11). 같은 버전·같은 모양의 일회용 컨테이너(`mariadb:10.11.11`, 루프백 전용, 내 컨테이너 ID 로만 제거)에서 쓰기를 시험했다: `yes`·`ON`·`no` 를 INSERT·UPDATE·ON DUPLICATE KEY UPDATE·REPLACE·INSERT IGNORE 하면 **전부 errno 4025 로 거부**되고 `UPDATE IGNORE` 는 조용히 0행이다. 비 JSON 이 들어가려면 `SET SESSION check_constraint_checks=0` 같은 **제약 우회**가 필요하다(그 세션에서만 성공). 따라서 이 task 의 「사람이 콘솔·SQL 로 `yes` 를 넣으면」과 T-141 QA 의 B·G 「실제 주문이 나가는 것을 재현」은 **모의 풀에서만 재현된다 — 운영에서 평범한 SQL 로는 도달하지 못한다.** 수정 자체는 맞다(제약 없는 복원본·마이그레이션·우회 세션에 대한 방어층이고, 코드가 자기 주석과 어긋난 것도 사실이다). 그러나 「Critical·실주문 재현」이라는 서술과 `flags.ts:69-73` 주석 첫 문단은 **과장**이다 → 조건 C-1.
- [10:09] **검증 7 — 운영 현재 값 [확실]**: `safety_kill_switch`=`false`(hex `66616C7365`), `safety_dry_run`=`true`(hex `74727565`) — 순수 ASCII·BOM/공백 없음·유효 JSON. 더 나아가 `safety_%` 이름공간만 **집계로**(키·값을 반환하지 않는 `COUNT` 와 `JSON_VALID` 합) 확인했다: 6행 중 비 JSON **0행**. 자격증명 행이 있는 다른 이름공간은 조회하지 않았다. 배포 순간 바뀌는 거동은 없다.
- [10:09] **검증 1 — 범위 판단은 맞다(독립 확인).** ① T-141 감사자의 「다른 호출점의 의미는 바꾸지 않는다」는 F-2② 변형(**읽기 오류 → 활성**을 주문 경로 두 곳에만 두자)에 대한 말이었다(T-141 task 감사 기록 00:45 F-2 줄). 파싱 실패 분기는 QA 도 「트레이드오프 없이 파일 주석의 의도대로」라 했고, 문서화된 계약(`unparsable` → 활성/ON)은 호출점마다 다르지 않다. ② 호출점 전수: `submitOrder` 두 곳(`dry-run.ts:181,268`)·`checkAndTriggerDrawdownKillSwitch`(`kill-switch.ts:235`, 이미 활성이면 건너뜀)·`telegram-approval.ts:221`(활성이면 승인 거부)·`portfolio-snapshot`(응답 표시)·`/api/health`·ops 안전상태·설정 GET 의 `isDryRun`. **전부 `true` 를 제한 방향으로 소비**한다. `/api/health` 는 `dryRun`·`killSwitch` 를 `ok`·`safetyStatus`·HTTP 상태 어디에도 쓰지 않는다(`health/route.ts:56` 주석 + 코드) — 활성으로 보여도 배포 헬스 판정이 뒤집히지 않는다. 호출점별로 해석을 달리하면 오히려 「화면이 엔진과 어긋나는」 부류를 만든다.
- [10:09] **검증 3 — 정상 JSON 거동 불변 [확실, 차분 시험]**: HEAD 판독기(`git show HEAD:…` 사본)와 작업 트리 판독기를 같은 모의 풀에서 비교했다. 유효 JSON 374종(열거+퍼지) × env 4상태(미설정·`true`·`false`·`garbage`) × (킬스위치·DRY_RUN) = 2,992건에서 **결과·`sendAlert` 호출 수·`console.error` 호출 수가 전부 같고** `crossCheck` 도 같다. 순수 함수로는 유효 JSON 10,801개에서 `decodeFlagValue` 가 `JSON.parse` 와 같은 값을 주고 `parseBoolFlag` 결과도 같다. 지정한 경계 — `true`·`"true"`·`"on"`·`1`·`0`·`2`(→unparsable)·`null`(→unset)·`{}`·`[]`·`""`(→unset)·`" TRUE "`(JSON 문자열→parsed true) — 모두 이전과 동일. 비 JSON 쪽은 `yes`·`no`·`ON`·`off`·`y`·`" TRUE "`(공백 비 JSON)·`True` 가 parsed, `maybe`·`01` 이 unparsable, `''`·`'  '` 가 unset 이다. 행 없음·조회 예외·값이 `null`/`undefined` 인 경우도 이전과 같다.
- [10:09] **검증 2 — 과차단은 없다. 대신 반대편이 문서에 없다.** `no`·`off`·`n`·`NO`·`False`·`FALSE`(+ 공백·개행·BOM 변형, 고유 22종)는 킬스위치·DRY_RUN 모두 `false` 로 해석된다. 변이 F2(실패→`true`)가 7건을 깨고 통합 `no`/`no` 는 송신 1회다. 그러나 이 값들은 **이전에는 env 폴백으로 무시되던 것이 이제 DB 값으로 존중된다**: 차분 시험에서 old=활성/ON → new=비활성/OFF 로 가는 경우가 존재한다 — 킬스위치는 env `KILL_SWITCH=true`·`garbage` 일 때 DB `off` 가 env 를 이긴다, **DRY_RUN 은 env 가 미설정·`true`·`garbage` 어느 쪽이든 DB `off`/`no` 가 OFF(실거래 방향)가 된다**(22종 × env 3상태 = 66건). 문서화된 우선순위(「DB override 가 env 에 우선」)·`dry-run.ts` 머리 주석(`off` 를 명시적 OFF 로 나열)·유효 JSON `false` 의 거동과 같아서 **결함은 아니다.** 다만 task 는 과차단(M4)만 다뤘고 「새로 존중되는 OFF」는 한 줄도 없다 → R-2. 대안은 비 JSON 을 토큰과 무관하게 unparsable 로 보는 것(이전→이후 이동이 전부 제한 방향이 된다)이나, 그러면 `no` 를 쓴 사람이 차단+critical 알림을 받는다 — 운영 판단이다.
- [10:09] **검증 4 — F-2② 경계 불변 [확실].** diff 상 `try`·`catch`·env 폴백 줄이 그대로이고, 변이 K2(킬스위치 `catch` → `return true`)·D2(DRY_RUN 동일)가 각각 1건씩 깨졌다(시험 「DB 조회 실패는 env 폴백」). 차분 시험에서 조회 예외·행 없음·값 `null`/`undefined` 가 이전과 같은 결과였다. `decodeFlagValue` 는 던질 수 없고(`JSON.parse` 가 `try` 안), [추론] JSON 에서 나온 객체는 `JSON.stringify` 가 성공하므로 `parseBoolFlag` 도 던지지 않는다 — 판독기 안에 새 예외 경로가 없다.
- [10:09] **검증 5 — 알림 폭주 판단: 문제 아님.** ① **프로세스 수 정정**: 「프로세스 2개(web·cron)」는 틀리다. `ecosystem.config.js` 에서 `stockinvest` 는 `instances: 1`, `stockinvest-cron` 은 `scripts/cron-runner.sh`(**bash + curl**)라 플래그를 평가하는 Node 프로세스는 **web 하나**다(cron 의 호출은 web 라우트 안에서 평가된다). 억제 키는 (key, raw) 당 프로세스 1회이므로 최악은 「서로 다른 해석 불가 값마다 web 재기동당 critical 1건」이다. 실 드라이버 E2E 에서 같은 값으로 3회 호출해도 `sendAlert` 는 1회였다. ② env 의 해석 불가 값은 **이미 같은 경로로 알림을 내고 있었다**(`kill-switch.ts:146-149`) — 새 종류의 알림이 아니라 같은 알림이 DB 경로에도 생기는 것이다. ③ 배포 순간 0건(비 JSON 0행), 제약 우회로 해석 불가 값이 들어가야 1건 + 주문 차단이며 그것이 문서화된 의도다. 미확인: Next 번들이 `flags.ts` 의 모듈 상태(`reported`)를 레이어별로 둘로 쪼개는지는 실측하지 않았다 [추측: 라우트 핸들러끼리는 같은 런타임을 공유해 1건].
- [10:09] **검증 6 — 시험은 실패할 수 있다. 변이 20종 중 18종 사살, 2종 생존.** 내가 정의한 패치를 서버 사본에서 돌렸다(셸 인용 문제를 피하려고 파일 기반 파이썬 드라이버를 쓰고, 패치는 `occurrences==1` 단언 후 적용하며, 매번 사본을 복원하고, 스위트 실행 실패는 별도 `INVALID` 로 분류해 「많이 깨졌다 = 성공」 착시를 막았다). 기준선 35건 통과. 결함 복원 K1(킬스위치)=6건·D1(DRY_RUN)=3건·S1(ops)=2건 사살 — K1 에서 통합 시험 B·G·모르는 값 3건이 실제로 깨지고 `no` 통합만 통과한다(과차단 변이 전용 시험이라 맞다). decode 변이: 실패→`undefined` 12·`true` 7·`false` 12·`null` 12·원문만 3·비문자열 가드 삭제 1·`'yes'` 만 인정(오버피팅) 7·성공값 문자열화 1·`null`→`'null'` 1 사살. 경계·불변: K2·D2(DB 예외→`true`) 각 1, K3·D3(unparsable→`false`) 2·1, K4(알림 삭제) 1, S2(crossCheck unparsable→`false`) 2 사살. **생존 2건은 둘 다 `crossCheck`**: S3 `parseBoolFlag(row.value)`(decode 제거)와 S4(unset 행을 항상 `true`)가 35건을 전부 통과한다 → R-3. 리더 기록의 M5(JSON 해석 포기)는 5건이라 했으나 내 두 정의로는 3건·2건이었다 — 변이 정의 차이로 보이며 모두 사살이라 결론은 같다.
- [10:09] **통합 하네스 대조(검증 6 뒤쪽)**: `submit-order-killswitch-presend.test.ts` 와 `diff` 했다. 차이는 의도된 것뿐이다 — 값을 `JSON.stringify` 하지 않고 원문 그대로, env `KILL_SWITCH` 를 `'false'` 로 두지 않고 **삭제**(폴백이 새면 「제동 없음」으로 드러나므로 T-141 것보다 엄격), 쓰지 않는 캡처(strategy·logs·queries) 생략. 거짓 통과 여지: SQL 모양이 바뀌어 `FROM system_config` 분기를 못 타면 차단 기대 3건은 **큰 소리로 깨진다**(조용한 통과가 아니다). 조용히 통과할 수 있는 것은 `no` 통합 한 건뿐인데 `killReads===2` 단언이 읽기 발생을 고정한다.
- [10:09] **실 드라이버 E2E(모의 아님)**: 일회용 MariaDB 10.11.11 + 실제 mysql2 풀 + 운영 모양 표. 유효 JSON 거동 불변 · 비 JSON 은 우회 없이 저장 불가(errno 4025) · 우회 후 `yes`→활성(알림 없음) · `off`→비활성(env `true` 를 이김) · 모르는 값→활성+critical 1건(반복 호출 dedupe) · DRY_RUN `yes`+env `false`→ON · `off`→OFF · 모르는 값→ON · `crossCheck` 일치. 드라이버가 항상 **문자열**을 돌려주므로(`typeof` 확인) `decodeFlagValue` 의 비문자열 분기는 운영에서 닿지 않는 방어 코드다(Buffer·`{}` 에서 이전 대비 제한 방향으로만 갈라진다). `submitOrder` 전체를 실 드라이버로 돌리지는 않았다(판독기까지).
- [10:09] **전체 시험·타입**: 서버 사본에서 전체 jest 365개 스위트(7개는 DB 전용 skip) 10,476건 통과, `tsc --noEmit` 오류 0, `git diff --check` 깨끗. 기존 시험 중 현재의 fail-open 을 고정하던 것은 **없다**(task 지점 2: 전체 통과가 증거). 저장소에 ESLint 설정 파일이 없어 lint 는 실행하지 못했다.
- [10:09] **범위 밖 발견 — Leader 전달(T-142 판정과 무관, 코드 읽기만 했고 실행하지 않았다)**: **O-1 (Low)** `settings/safety/route.ts:36,62` 설정 GET 의 `killSwitch` 는 판독기가 아니라 `getOverrides()`(행 하나라도 비 JSON 이면 `JSON.parse` 가 던져 override 전체가 `{}`)를 `Boolean(...)` 으로 읽는다. T-142 후 비 JSON 행이 있으면 판독기·주문은 활성인데 이 화면은 비활성으로 보일 수 있다(T-142 전에는 둘 다 같은 방향으로 틀려 있었다). 같은 화면의 `dryRun` 은 이미 `isDryRun()` 을 쓴다 → 후속으로 `isKillSwitchActive()` 로 교체. 운영 도달에는 제약 우회가 필요하다. **O-2 (Medium, 운영 도달 가능)** `order-limits.ts:74-79` `getBlockedSymbols`: 유효 JSON 이지만 **배열이 아닌 값**(`"AAPL"`·`{}` 등)이면 `Array.isArray` 가 거짓이라 env 목록으로 떨어지고, env 가 비어 있으면 **블랙리스트가 조용히 빈다** — CLAUDE.md 가 「현재 유일한 실효 심볼 안전장치」라고 적은 것의 fail-open 이다. 비 JSON 과 달리 **CHECK 제약이 막지 못한다**(유효 JSON). T-142 가 건드리지 않았고 task 도 후속 후보로만 적었으나 도달 가능성은 이쪽이 높다 → 별 task 권고(PATCH 라우트의 값 검증 여부는 보지 않았다). 같은 `JSON.parse`-in-`try` 패턴이 `volatility-guard.ts:14,41,304`·`asset-profile.ts:45` 에도 있다(방향은 각자 다르다 — 확인하지 않음). `order-limits.ts` 의 한도 %는 파싱 실패 시 0(매수 전면 거부)이라 안전 방향이다.
- [10:09] **지적 요약** — critical 0 · high 0 · medium 1 · low 2 · info 1 (+ 범위 밖 O-1/O-2). **C-1 (Medium, 조건)** 서술 정정: ① `flags.ts:69-73` 주석 첫 문단을 「운영 표는 `json_valid` CHECK 로 비 JSON 저장을 막는다 — 이 함수는 제약이 없는 환경(복원본·마이그레이션·`check_constraint_checks=0` 세션)에 대한 방어층」으로 ② 이 task 의 「Critical·실주문 재현」을 「모의 풀 재현, 운영 도달에는 제약 우회 필요」로 ③ 사용자 보고에도 같은 내용. 주석·문서만 바뀌고 코드 줄이 그대로면 재감사는 필요 없다(T-141 의 C-1 선례와 같은 취급). 코드 줄이 바뀌면 나에게 다시 요청. **R-2 (Low, 권고)** 새로 존중되는 비 JSON falsy(검증 2)를 task 에 「의도된 거동」으로 한 줄 명시. **R-3 (Low, 권고)** `safety-state.test.ts` 에 `crossCheck(false,{value:'"off"'})`→`false`, `crossCheck(false,{value:'null'})`→`false`(S3 사살), `crossCheck(true,{value:''})`→`true`(S4, 이전부터 있던 빈칸) 추가. **R-4 (Info)** task 파일 정리 — 진행 기록 끝에 `</content>` 잔재 한 줄이 있고, 내가 이 파일을 처음 읽은 시각(약 09:50)에 이미 구현 기록에 `[10:10]`·`[10:12]` 가 적혀 있었다 — 실제 시계보다 뒤의 시각이라 추정치나 오기로 보인다.
- [10:09] **QA 인계 high_risk_areas** — `src/lib/safety/flags.ts:82-85`(`decodeFlagValue`) · `src/lib/safety/kill-switch.ts:126-150`(`try` 범위·env 분기) · `src/lib/safety/dry-run.ts:33-67` · `src/lib/ops/metrics/safety-state.ts:92-98`(`crossCheck`). 제안 시나리오: ① 실 드라이버 + 운영 모양 일회용 DB 로 **`submitOrder` 전체**(3단계·8a-0)를 비 JSON `yes`/`off`/모르는 값으로 — 내 E2E 는 판독기까지만 갔다 ② 배포 직전 운영 읽기로 두 행이 여전히 `false`/`true` 이고 `safety_%` 비 JSON 이 0행인지 재확인 ③ 배포 후 `/api/health` 200·`dryRun`/`killSwitch` 불변, pm2 로그에 `해석할 수 없음` 줄이 없음 확인 ④ 설정 화면 GET 이 비 JSON 행 하나로 override 전체를 비우는 경로(O-1)는 별도 task 전까지 알려진 한계로 기록.
- [10:09] **남은 위험·미확인** — 운영 `.env` 의 `DRY_RUN`·`KILL_SWITCH` 값은 읽지 않았다(DB 값이 유효 JSON 이라 env 폴백을 타지 않으므로 이 판정에 불필요). Next 번들의 모듈 상태 단일성 미실측. `submitOrder` 전체의 실 드라이버 E2E 미실시. O-1·O-2 는 코드 읽기만. lint 미실행(설정 없음). 감사 부산물: 서버 `~/.node-local/t142-audit-base`(변이 드라이버 `mut_driver.py` 포함, DB 접속 스크립트는 삭제)·내 컨테이너는 제거했고 `t108-qa-db` 는 건드리지 않았다.
- [10:09] **최종 판정: CONDITIONAL_PASS (scope: src/lib/safety/flags.ts, src/lib/safety/kill-switch.ts, src/lib/safety/dry-run.ts, src/lib/safety/__tests__/t142-flag-decode.test.ts, src/lib/safety/__tests__/t142-submit-order-raw-flag.test.ts, src/lib/ops/metrics/safety-state.ts, src/lib/ops/metrics/__tests__/safety-state.test.ts)**
- [10:16] **재확인(라운드 2) — 조건 C-1 의 ①②는 이행됐고, 재감사는 필요 없다.** 내가 감사한 사본과 지금 트리를 `cmp`·`diff` 로 대조했다: `flags.ts` 는 **주석 69-73줄이 69-77줄로 바뀐 것뿐**(코드 줄 동일), `safety-state.test.ts` 는 `it` 1개(단언 3개) 추가, 나머지 5개 파일은 **바이트 동일**이고 `src/` 의 다른 변경은 없다. 변이 20종 드라이버를 현재 트리로 다시 돌렸다: 기준선 **36건 통과**, **20종 전부 사살** — 생존이던 S3(decode 제거)·S4(unset 행을 항상 활성)가 새 `it` 한 건에 각각 걸린다(내가 정의한 패치라 코디네이터 기록과 독립). `src/lib/safety`+`src/lib/ops` 56개 스위트 1,668건 통과, `tsc --noEmit` 오류 0, `git diff --check` 깨끗. 새 `flags.ts` 주석(「방어층 — 운영 표는 CHECK 로 막는다」)과 task 「결함」 절의 정정 블록은 내가 실측한 사실(errno 4025·우회 조건)과 일치한다. **③ 사용자 보고는 내가 확인할 수 없다** — Leader 가 최종 보고에 같은 정정을 싣는 것을 전제로 한다.
- [10:16] **남은 지적(비차단, 코드 재검토 불요)** — (a) `t142-flag-decode.test.ts:7,11` 파일 머리 주석이 아직 정정 전 이야기(「사람이 콘솔·SQL 로 `yes` 를 넣으면」·「실제 주문이 나가는 것을 재현」)를 그대로 말한다 — 주석만 같은 식으로 고치면 된다. (b) `priority: critical` 의 근거로 O-2 를 인용했는데 내 O-2 등급은 **Medium** 이었고 별 task 사안이다 — T-142 의 priority 를 내리고 O-2 task 를 열 때 올리는 쪽이 일관된다(조정은 Leader). (c) 「스스로 아는 약한 곳」 2번이 여전히 「프로세스가 2개(web·cron)」라고 적는다 — 검증 5 의 정정(web 하나, cron 은 bash+curl)과 다르다. (d) 이행 기록에 `[10:22]` 가 있는데 내가 확인한 서버 시계는 10:13~10:16 이다 — R-4 에서 약속한 「시각은 명령 출력에서」가 한 곳에서 다시 추정치가 됐다.
- [10:16] **최종 판정: PASS (scope: src/lib/safety/flags.ts, src/lib/safety/kill-switch.ts, src/lib/safety/dry-run.ts, src/lib/safety/__tests__/t142-flag-decode.test.ts, src/lib/safety/__tests__/t142-submit-order-raw-flag.test.ts, src/lib/ops/metrics/safety-state.ts, src/lib/ops/metrics/__tests__/safety-state.test.ts)**

## QA

- [10:31] **검증 범위·환경** — 서버 사본 `~/.node-local/t142-qa`(NFS 작업 트리 복사, `.env` 미복사, `node_modules` 심볼릭 링크). 일회용 `mariadb:10.11.11`(운영과 같은 버전, 루프백, 실행 후 삭제). 운영 DB 는 SELECT·SHOW 만. 운영 트리 쓰기·pm2·배포·커밋·push 없음. 대상 파일 해시는 검증 시작·종료 때 동일(`flags.ts 2bcb6524` · `kill-switch.ts ee103ea6` · `dry-run.ts 1e331376` · `safety-state.ts 2ed9ba3c` · `ops 시험 5afdc1bf` · `통합 시험 b1e06d93`). `t142-flag-decode.test.ts` 는 검증 중 머리 주석만 바뀌었고(코디네이터 이행), 현재본 해시 `022baef3` 를 기준으로 봤다. 단언·본문 불변을 확인했다.
- [10:31] **운영 DB 실측(읽기 전용)** — `system_config.value` = `longtext … NOT NULL CHECK (json_valid(value))` (information_schema 확인). `safety_kill_switch`=`false`(hex 66616C7365), `safety_dry_run`=`true`(hex 74727565), 둘 다 유효 JSON. `safety_%` 6행 전부 유효 JSON. 전체 101행 중 비 JSON 0행.
- [10:31] **제약 실측(일회용 DB, 운영 DDL 그대로)** — 평범한 INSERT·UPDATE 는 `yes`·`no`·`off` 모두 `ERROR 4025` 로 거부. `SET SESSION check_constraint_checks=0` 우회 세션에서만 저장된다(`yes` 저장 → `json_ok=0`). 운영 도달에는 우회가 필요하다는 감사 C-1 서술은 맞다.

| # | 확인 항목 | 판정 | 근거 (실행 출력) |
|---|---|---|---|
| 1 | 막는 쪽만 늘었나 / 반대편 방향 | PASS — 반대 방향 변화 **있음**, 아래 M-1 | 차분 시험 (아래 표) |
| 2 | 정상 JSON 거동 불변 | PASS | 동등 비교 408건 (JSON 유효 43 + 조회실패·행없음·null·undefined·숫자·불리언 8 × env 4 × 함수 2), 불일치 0건 |
| 3 | F-2② 경계 (DB 읽기 실패 → env 폴백) | PASS | 변이 M09·M10 사살. 실 드라이버 DB 실패 주입 2건 통과 |
| 4 | 주문 경로 (B·G·과차단 아님·모르는 값) | PASS | 기준선 6스위트 52건 통과. 8a-0 차단의 `markBlocked` UPDATE 실패 주입 시 송신 0 · `outcomeUnknown` 없음 |
| 5 | 시험이 실패할 수 있나 (R-3 생존 변이 포함) | PASS | 변이 23종 **23/23 사살** (아래) |
| 6 | 알림 폭주·알림 경로 | PASS (코드 + 실 드라이버) | `sendAlert` 는 fire-and-forget (`notify/index.ts:145` `void dispatchAlert(...).catch`) → 동기 예외가 try 로 올라와 env 폴백되는 경로 없음. 실 드라이버 3회 호출 → `sendAlert` 1회. 운영 값 비 JSON 0행 → 배포 순간 알림 0건. `ecosystem.config.js`: `stockinvest`(instances 1, next) · `stockinvest-cron`(cron-runner.sh, bash+curl) → 플래그 평가 Node 프로세스는 web 하나 |
| 7 | 배포 후 확인 항목 | 아래 목록 | — |

- [10:31] **M-1 (Medium, 설계 판단 — 사용자 결정, Critical 아님)** — 비 JSON 거짓 토큰(`no`·`off`·`n` 등)이 HEAD 에서는 무시되어 env 로 떨어지고, 이제는 DB 값으로 존중된다. 차분 실측 (scratchpad 원본 `diff-old-new.test.ts`):

| 입력 (DB 비 JSON) | 플래그 · env 조건 | HEAD (배포 전) | 변경 후 |
|---|---|---|---|
| `no`·`off`·`n`·`NO`·`Off` (공백 변형 포함) | `safety_dry_run` · env DRY_RUN 미설정·`true`·`garbage` | ON | **OFF (실거래 방향)** |
| `no`·`off`·`n`·`NO`·`Off` | `safety_kill_switch` · env KILL_SWITCH=`true`·`garbage` | 활성 | **비활성 (차단 해제)** |
| `yes`·`ON`·`y` 등 참 토큰 | `safety_kill_switch` · env 미설정·`false` | 비활성 | 활성 |
| `yes`·`ON` 등 | `safety_dry_run` · env DRY_RUN=`false` | OFF | ON (안전 방향) |
| 모르는 값(`뭔가`·`maybe`·`01` 등) | 두 플래그 공통 | env 따라감 | 활성·ON + console.error (킬스위치는 critical 알림 1회) |

  - 같은 효과는 JSON `"off"`·`false` 로 **HEAD 에서 이미 가능했다** (동등 비교 대상에 포함, 결과 동일). 변경은 "쓰는 방법"의 차이를 없앤 것이다. 공격 표면이 새로 생긴 것은 아니다.
  - 도달 조건: 제약 우회(`check_constraint_checks=0`) 또는 제약 없는 테이블. 일반 쓰기는 4025 로 거부된다.
  - 등급: Medium. 근거 — 실주문 경로 재현 없음, 도달에 DB 쓰기 권한 + 제약 우회 필요, 문서화된 우선순위(DB override > env)와 일치. **M-1 수용 여부는 사용자가 결정한다.** 대안(감사자 언급): 비 JSON 거짓 토큰을 unparsable 로 되돌리기 — 모든 이동이 제한 방향이 되지만, `no` 를 쓴 운영자는 차단 + critical 알림을 받는다.
- [10:31] **변이 23종 결과 (사본, 원복 검사 통과)** — M01·M02 결함 복원 → 11·7건 실패 · M03~M05 decode 실패 처리 변형 → 20·13·21건 · M06 비문자열 가드 삭제 → 2건 · M07 JSON 포기 → 6건 · M08 빈 값 → 3건 · M09·M10 F-2② 경계 침범 → 3·3건 · M11·M13·M14·M16·M17 판독 교리 위반 → 5·4·4·2·2건 · M12 critical→warning → 2건 · M15 기본값 OFF → 3건 · M18 옛 대조 복원 → 3건 · **M19(감사 S3 decode 제거) → 1건, M20(감사 S4 unset 항상 활성) → 1건**, 각각 단언 한 줄에만 걸린다 — 얇다 · M21 8a-0 재확인 제거(T-141 G 경로) → 4건 · M22 3단계 확인 제거 → 4건 · M23 차단 실패 시 `outcomeUnknown` 강제 → 1건.
- [10:31] **전체 시험 (사본)** — `npx tsc --noEmit` exit 0. `npx jest` 전체: 프로젝트 원본 스위트 전부 통과(365). 실패 1건은 **제 차분 시험 파일** `src/__qa_t142__/diff-old-new.test.ts` — 복사본에서 HEAD 소스 디렉터리를 치운 뒤 import 가 깨진 것이다(그 전 실행에서 통과). 중간에 HEAD 복사본을 `src/` 안에 두었더니 `submit-order-callsites`·`usd-cash-balance-fence` 두 펜스 시험이 그 사본을 호출부로 세어 실패했다 — **QA 전용 산출물이 만든 실패이고 운영 트리에는 없다.** 두 번째 실행에서 해소 확인.
- [10:31] **재현 절차** — ① 사본: 운영 트리에서 `node_modules`·`.git`·`.env*` 를 뺀 복사 + `node_modules` 심볼릭 링크 ② 일회용 DB: `docker run -d -e MARIADB_ROOT_PASSWORD=… -p 127.0.0.1::3306 mariadb:10.11.11`, 운영 `SHOW CREATE TABLE system_config` 를 그대로 적용 ③ `T142_QA_DB_PORT`·`T142_QA_DB_PW` 를 환경변수로 주고 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 npx jest src/lib/safety/__tests__/t142-flag-decode src/lib/safety/__tests__/t142-submit-order-raw-flag src/lib/ops/metrics/__tests__/safety-state` ④ 실 드라이버 E2E 13건·차분 시험·markBlocked 시험은 QA 세션 scratchpad 원본(사본과 함께 지움, 재현 필요 시 재작성).
- [10:31] **미검증 목록** — (1) O-1 `settings/safety` GET 의 override 전체 비움, O-2 `getBlockedSymbols` 비배열 → env 폴백은 **코드 읽기만**(감사 기록 인용, 실행 안 함). (2) `submitOrder` 전체의 실 드라이버 E2E 는 안 함(판독기 실 드라이버 + 주문 경로는 모의 풀). (3) lint 설정 없음 — 미실행. (4) 운영 `.env` 의 `DRY_RUN`·`KILL_SWITCH` 값 미확인(DB 값이 유효 JSON 이라 이번 판정에는 불필요). (5) 기존 F-2 계열: `getPool()` 이 스키마 치명 상태면 던지고(`db.ts:53`) 같은 `try` 안에서 env 폴백된다 — **이번 변경으로 생긴 것은 아니다**, 사용자 결정 대기 항목과 같은 경계. (6) 배포 전후 실제 `/api/health` 값 — 배포 후 확인 목록에서 본다.
- [10:31] **배포 후 확인 목록 (deployer)** — 스키마 변경 없음(`migration_required: false`). 기대값은 **변하면 안 되는 것** 중심:
  1. `pm2` 목록: `stockinvest` online 1 인스턴스, `stockinvest-cron` online **정확히 1개** (중복 기동 확인).
  2. 배포 대상 서버 `GET /api/health`: `ok: true`, `safetyStatus` 가 배포 전과 같다, `dryRun` 과 `killSwitch` 값이 배포 전 기록과 같다(기대: dryRun true · killSwitch false).
  3. `pm2 logs stockinvest` 최근 로그에 `해석할 수 없음` 줄 **0건** (운영 값 비 JSON 0행이므로 배포 순간 발생하지 않아야 한다).
  4. DB 읽기: `safety_kill_switch` hex `66616C7365`, `safety_dry_run` hex `74727565` 불변. `SELECT COUNT(*) FROM system_config WHERE JSON_VALID(value)=0` = 0.
  5. `orders` 에 배포 이후 `blocked_by='kill_switch'` 신규 행이 없어야 한다(제동 상태가 아니므로).
  6. 롤백: 코드 되돌리기만(스키마·데이터 변경 없음).
- [10:31] **산출물 정리** — 사본 `~/.node-local/t142-qa` 삭제 완료. 일회용 DB 컨테이너 `t142-qa-db-1793496005` 삭제, 잔존 0. 운영 트리 7개 파일 해시 불변 확인. 이 세션은 pm2·운영 DB 쓰기·배포·커밋을 하지 않았다.
- [10:31][qa] **QA 판정: PASS** — 결함 0건(Critical 0 · High 0 · Medium 1 = M-1 설계 판단). 배포 인계 전 **M-1(반대 방향 변화 — DRY_RUN 비 JSON `off`/`no` 는 OFF, KILL_SWITCH 비 JSON `no`/`off` 는 env 차단을 해제)을 사용자가 수용하거나 대안을 고르는 것**을 Leader 가 확인해야 한다. 그 전까지 배포 확정으로 읽지 않는다.

## Leader 정리 — 감사 PASS · QA PASS, 사용자 결정 1건(M-1)

- [10:34] **감사 PASS**(라운드 2 — 조건 C-1 이행 확인, 변이 20종 전부 사살, `cmp`·`diff` 로 구현 코드가 주석 한 문단 외 바이트 동일임을 확인) · **QA PASS**(결함 0·Critical 0, 변이 23종 전부 사살, 정상 JSON 차분 408건 불일치 0, 실 드라이버 E2E 13건). 두 역할이 **CHECK 제약을 각자 독립 실측**했다 — QA 는 운영 101행 중 비 JSON **0행**까지 확인했다.
- [10:34] **내가 두 번 과장했고 둘 다 잡혔다.** ① 「Critical·운영에서 실주문이 나갔다」 → 운영 표의 `CHECK (json_valid(value))` 때문에 평범한 SQL 로는 도달 불가(감사 C-1). ② 「프로세스 2개(web·cron)」 → cron 은 bash+curl 이라 플래그를 평가하지 않는다(감사 검증 5). 기록 시각도 두 번 서버 시계보다 앞섰다(감사 R-4·c·d).
- [10:34] **R-2 를 보완한다 — 제동을 푸는 방향은 DRY_RUN 뿐이 아니었다.** QA 가 차분으로 실측했다: **킬스위치도** env `KILL_SWITCH=true`(또는 오타)인 상태에서 DB 에 비 JSON `no`·`off` 가 있으면 **활성 → 비활성(차단 해제)** 이 된다. 내가 R-2 에 DRY_RUN 만 적은 것은 불완전했다.

### 🔴 M-1 (Medium) — 사용자 결정: 비 JSON 거짓 토큰을 「값」으로 볼지 「해석 불가」로 볼지

| | 현행(이번 구현) | 대안 |
|---|---|---|
| DB `no`·`off`·`n` (비 JSON) | **값으로 존중** → DRY_RUN OFF·킬스위치 비활성 | **해석 불가** → 양쪽 모두 활성(차단) + critical 알림 |
| 움직이는 방향 | 양방향(풀기도 한다) | **항상 제한 방향** |
| 비용 | 제약 우회 환경에서 `no` 가 브레이크를 푼다 | `no` 를 **의도적으로** 쓴 운영자가 차단 + 알림을 받는다 |
| 도달 조건 | 둘 다 `check_constraint_checks=0` 같은 **제약 우회 필요** |

**Leader 권고: 현행 유지.** 근거 셋이다. ① `no`·`off` 는 `parseBoolFlag` 가 **이미 아는 토큰**이고, env 쪽에서는 `KILL_SWITCH=no` 가 예전부터 비활성이다 — 현행은 **DB 칸을 env 와 같은 규칙으로** 읽게 만드는 것이고, 대안은 **같은 글자가 출처에 따라 다른 뜻**이 된다. ② 「애매하면 안전 방향」은 파서가 **못 읽는** 값에 대한 규칙이다(`flags.ts` 3분기 표). 읽을 수 있는 값을 「JSON 으로 감싸지 않았다」는 이유로 해석 불가 취급하면, **무엇을 말했는지**와 **어떤 문법으로 실렸는지**를 섞는다. ③ 같은 효과(`"off"`·`false`)는 HEAD 에서도 이미 가능했다 — 대안이 막는 것은 「우연히 비 JSON 인 거짓 토큰」 하나뿐인데, 대가로 명확한 지시를 거부한다.

**반대 근거도 적는다**(사용자가 이쪽을 고를 수 있다): 이 두 플래그는 브레이크이고, 비 JSON 값이 존재하는 환경은 **이미 비정상**(복원본·마이그레이션 중)이다. 그 상황에서 흘러든 값을 신뢰하는 것보다 **브레이크를 걸고 알림을 받는** 편이 낫다고 볼 수 있다. 이쪽을 고르면 `decodeFlagValue` 가 **참 토큰만** 해석하게 바꾸고 **감사부터 다시 돈다.**

### 사용자 결정 (11:01)

**「네, 현행대로 배포」** — M-1 은 **현행 유지**(비 JSON `no`·`off` 를 값으로 존중, env 와 같은 규칙)로 확정됐다. Leader 권고와 같다. 코드 변경이 없으므로 **재감사 없이** 커밋·push 한다.

수용된 거동을 다시 적는다(제약 우회 환경에서만 도달): DB 에 비 JSON `no`·`off`·`n` 이 있으면 **DRY_RUN 은 OFF(실거래 방향)**, **킬스위치는 비활성(차단 해제)** 이 되고 env 값보다 세다. 같은 효과는 `"off"`·`false` 로 HEAD 에서도 가능했다.

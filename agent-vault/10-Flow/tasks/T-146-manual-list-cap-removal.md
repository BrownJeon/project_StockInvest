---
task_id: T-146
title: 해외 수동 목록 125종목 주입(나스닥100) + MANUAL_LIST_MAX 상한 제거
status: done
priority: high
project: StockInvest
created: 2026-11-03
updated: 2026-11-03
base_ref: origin/main 8f101d0 (릴리스 20261102-225046-8f101d03)
risk_level: R2
roles_involved: [leader, developer, reviewer, qa, deployer]
waiting: >-
  후속 2건 대기 — ① H-1(post-market-overseas 무제한 팬아웃) 수정 전에는 수동 목록을 151종목 이상으로
  늘리지 않는다(상한은 500 이지만 실질 안전 한계는 약 154, 코드 가드 없음). ② M-1 화면 문구(view.ts:243)
  거짓 이유 절은 designer 경유 수정 또는 사용자 수용 결정 대기.
related_tasks:
  - T-143-overseas-universe-source-replacement
  - T-145-wpa-enable-blockers
tags:
  - type/task
  - domain/strategy
  - domain/safety
aliases:
  - 나스닥100 주입
  - MANUAL_LIST_MAX 제거
  - T-146
---

## 발단

사용자 지시 2건(2026-11-03, 같은 세션):

1. **「12월에 정기갱신하기 전에 지금 바로 나스닥100 조회해서 목록에 추가해줘」** → 수동 목록 125종목 주입(완료, 아래 ①).
2. **「상한을 제거해줘」** → `MANUAL_LIST_MAX` 150 제거(이 task 의 코드 변경, 아래 ②).

②는 Leader 가 위험을 먼저 보고한 뒤 사용자가 재확인한 결정이다. 보고한 위험 3가지를 그대로 옮긴다 —
(a) 상한을 지워도 무제한이 아니다(표 `chk_rev_count CHECK (symbol_count <= 500)` 백스톱이 남아 **실효 상한 500**),
(b) `MANUAL_LIST_MAX` 는 붙여넣기 화면만이 아니라 **제안 적용 경로의 서버측 재검사**(`store.ts` `checkManualSymbols`)에도
쓰이고 그 경로는 **사람이 확인하지 않는 무인 경로**다(WP-A 잡이 넣은 값), (c) 상한 주석 자신의 근거가
「WP-C 목표치 ~150 이고 **그마저 08시 틱 최악 287~359초로 아직 빨간불**」이다. 사용자는 셋을 듣고 제거를 지시했다.

## ① 수동 목록 125종목 주입 (완료 — 코드 변경 0)

나스닥100 **101티커**(100사 + Alphabet 2클래스) + 현재 목록의 NYSE **24종목** = **125종목**.

- **구성종목 명단 출처**: 공개 문서(위키백과 Nasdaq-100, 최종 편집 2026-10-24 · 업종 분류 기준일 2026-07-01). **공식 지수 문서가 아니다.**
  `api.nasdaq.com` 은 [[T-137-dynamic-overseas-universe]] 폐기 사유(원천 이용 권리 없음)라 쓰지 않았다.
- **티커·거래소 검증**: SEC `company_tickers_exchange.json`(2026-11-03 내려받음, 10,423행) 과 **101개 전부 대조**.
  전부 `Nasdaq` 상장이라 접두어는 모두 `NAS:`. 이름이 약어라 자동 대조가 안 된 4건은 티커 직접 조회로 확인했다 —
  `ADP`(AUTOMATIC DATA PROCESSING) · `AMD`(ADVANCED MICRO DEVICES) · `MSTR`(**SEC 등록명 `Strategy Inc`**) ·
  `SPCX`(**SPACE EXPLORATION TECHNOLOGIES CORP**).
- **지수 구성이 크게 바뀌어 있었다**(이번 대조로 드러난 것): 하니웰 분할 → `HON`(Technologies) + `HONA`(Aerospace) **2종목**,
  신규 `SPCX`·`CRWV`(CoreWeave)·`NBIS`(Nebius)·`ALAB`(Astera Labs)·`RKLB`(Rocket Lab)·`SNDK`(Sandisk)·`FER`(Ferrovial).
  2026-06 분기 재구성에서 `CHTR`·`VRSK`·`ZS` 가 빠진 것도 확인했다.
- **주입**: `scripts/migrations/T-143-overseas-universe.sql` 머리 주석이 안내한 시드 INSERT 형태 그대로.

| 항목 | 값 |
|---|---|
| 행 | `revision_no=1` · `symbol_count=125` · `change_source='seed'` · `updated_by='manual-sql'` · `created_at=2026-11-03 07:20:06` |
| 검증 | `JSON_VALID=1` · `JSON_LENGTH=125` · 첫 `NAS:AAPL` / 끝 `NYS:XOM` · NAS 101 / NYS 24 |
| 안 건드린 것 | `overseas_universe_auto` 0행 · `system_config.overseas_universe_refresh` **0행(스위치 꺼짐)** · `overseas_universe_proposal` 0행 |
| 적용 시점 | **즉시** — 판독기가 성공한 조회를 캐시하지 않는다(`캐시는 폴백 전용`). 배포·재시작 불필요 |
| 주입 직후 상태 | pm2 web·cron online · restarts 0 · `/api/health` 200 green(`dryRun:true`) · cron 하트비트 56초 · `[universe-overseas]` 경고 0건 |

**이것이 T-143 DDL 주석이 말한 「그 첫 저장이 실질적인 전환점」이다** — 이제 분석 대상을 환경변수·코드 하드코딩이 아니라 DB 가 정한다.

### ① 의 미검증 항목

- **KIS 가 새 75종목을 전부 조회해 주는지 확인하지 못했다.** 개발에서 KIS 를 부르지 않는 규칙 때문에 미리 치지 못했고,
  **11-04 08:00 pmo · 08:30 스냅샷**에서 드러난다. 오늘(11-03) 08시 분은 주입(07:20) 뒤지만 **예약 점검은 T-145 ⑨ 틱 길이만** 본다.
- `NYS:BRK.B` 는 종전처럼 계속 실패한다(KIS 가 `.` 표기를 거부 — 올바른 표기 미확인, 손대지 않았다).
- 125종목에서의 **08시 틱 실측이 없다.** T-145 ⑨ 도 시뮬레이션(220~240초)으로만 검증된 상태다.

### ① 용량 산정 (실측 기반)

2026-10-31 운영 기록 `post-market-overseas` = `evaluated 54 / 38초 / ok`. 종목당 한계비용은 **일봉 1콜(유량 5건/초)**뿐이고
**LLM 은 후보 수와 무관하게 1회**(`LLM_TIMEOUT_MS = 90_000`)다.

| 경로 | 현재 | 125종목 | 보호장치 |
|---|---|---|---|
| `post-market-overseas` | 38초 | 평시 **~53초** / LLM 타임아웃 최악 **~121초** | curl 상한 120초 · **이어받기 없음** · 하루 3회 재시도 |
| `kis-fundamentals-snapshot` | 25~50초 | ~90초 | 90초 예산 + **창 안 이어받기**(T-145 ⑨) |
| 유니버스 갱신(strategy-eval) | 일봉 11초 | ~26초 | TTL 15분 + 최저 `bulk` 레인 |
| `us-edgar/sync-job` | — | — | 100초 예산 + 이어받기 |

사용자가 **러너 `--max-time` 을 240 으로 올리자**고 했으나 Leader 가 거절 근거를 제시해 보류됐다 —
`scripts/cron-runner.sh:150` 주석이 이미 그 숫자를 적어 두었다(`240 이면 240+60+30+60 = 390초로 순찰이 러너를 재시작한다`),
워치독은 `projects.json` 의 `stockinvest-cron` `health_type: heartbeat_file` · `max_age_seconds: 300` 으로 확인됐고,
**LLM 자신이 90초에 포기하므로 curl 시간을 더 줘도 결과가 생기지 않는다.** 여유가 필요하면 올릴 곳이 아니라
내릴 곳이 `LLM_TIMEOUT_MS`(90→60)라고 보고했다. **이 task 범위 밖 — 사용자 결정 대기.**

## ② 상한 제거 — 범위

| 파일 | 변경 |
|---|---|
| `src/lib/universe/parse-manual-list.ts` | `MANUAL_LIST_MAX` 150 → **500**(표 백스톱과 일치). 근거 주석 전면 교체 |
| `src/lib/universe/refresh-config.ts` | `topN` clamp 상한을 `MANUAL_LIST_MAX` 에서 **분리**해 150 유지(아래 「왜 분리하나」) |
| `src/lib/universe/__tests__/parse-manual-list.test.ts` | 상수 절대값 시험 추가(기존 시험은 상수 상대값이라 바뀐 값을 잡지 못한다) |

### 왜 「삭제」가 아니라 500 인가

검사 자체를 지우면 500 초과 입력이 **표의 CHECK(errno 3819)로 떨어져** 깔끔한 400 대신 DB 오류가 사용자에게 보인다 —
요청에 없던 새 실패 경로다. 사용자에게 보고한 결과는 「실효 상한 500」이었고, 500 으로 맞추면 **앱의 정책 상한(150)은 사라지고**
표의 사고 방지 백스톱 하나만 남으면서 실패 메시지는 그대로 깔끔하다. 문구는 모두 `MANUAL_LIST_MAX` 를 받아 쓰므로
API(`manual/route.ts:70`)·화면(`DIFF_TOO_MANY_NOTE`)·제안 경로(`store.ts:793`) 문구가 자동으로 500 으로 바뀐다.

### 왜 `topN` clamp 을 분리하나

`refresh-config.ts:148` 이 WP-A 의 `topN`(NYSE 상위 N)을 `clampInt(..., 1, MANUAL_LIST_MAX)` 로 묶어 둔다.
상수만 500 으로 올리면 **사용자가 요청하지 않은 변경**이 따라온다 — WP-A 의 `topN` 천장이 150 → 500 이 되고,
그 경로는 `system_config` 값 하나로 바뀌는 **무인 경로**다. 요청은 「수동 목록 상한 제거」이므로 `topN` 천장은
**현재 동작(150)을 그대로 유지**한다. 범위를 좁히는 것이지 요청을 줄이는 것이 아니다.

### ② 로 보호가 사라지는 지점 (사용자가 수용한 위험 — 기록용)

1. **08시 틱 시간 예산을 앱이 더 이상 막지 않는다.** 150 이 「분명히 예산을 넘는 입력」의 1차 관문이었다.
   WP-C(대상 확대 시간 예산)는 **미완**이고 ~150 에서 이미 287~359초(한도 300초)로 측정돼 있었다.
   남은 방어선은 **거래일 1회 실측(운영 관문)** 과 각 경로의 자체 예산·이어받기뿐이다.
2. **제안 적용(무인) 경로의 한도가 500 으로 느슨해진다.** `store.ts` 재검사가 존재하는 이유 자체가
   「제안 행은 사람이 확인하지 않는다」였다. WP-A 를 켠 뒤 이 경로가 목록을 키울 수 있는 폭이 넓어진다.
3. 붙여넣기 사고(수만 줄)는 **여전히 막힌다**(500 초과 + 형식 검사).

## 하지 않는 것

- 러너 `--max-time` 변경(위 근거로 보류) · `LLM_TIMEOUT_MS` 변경(사용자 결정 대기)
- NYSE 상위 50 수동 주입 — 시총 순위라 KIS 조회 **후보 2,763건 · 21~43분**이 필요하고 손으로 세면 추측이 된다.
  합집합(수동 ∪ 자동) 구조라 **수동에 넣은 추측값은 WP-A 월간 갱신이 지울 수 없다.** WP-A 로 간다(창 설정 `nth` 를
  `system_config` 같은 행에서 2 로 두면 **11-08(일) 01:10** 도 가능 — 코드 변경 불필요)
- WP-A 스위치 켜기 — 운영 DB 쓰기 2건이고 각각 별도 승인([[T-145-wpa-enable-blockers]] 남은 차단 조건 6개)
- `chk_rev_count` CHECK(500) 변경 — ALTER 는 사용자 건별 승인이고 요청에 없다

## Developer

- [07:38] **구현 완료 — 변경 4파일, 전부 `src/lib/universe/`(SAFETY_PATHS `^src/lib/universe/`).**

| 파일 | 변경 |
|---|---|
| `src/lib/universe/parse-manual-list.ts` | `MANUAL_LIST_MAX` **150 → 500**. 근거 주석 전면 교체 — 옛 150 의 근거(WP-C ~150·08시 틱 287~359초)와 바꾼 경위·수용한 위험·「검사를 지우지 않고 500 으로 맞춘 이유」를 남겼다 |
| `src/lib/universe/refresh-config.ts` | `AUTO_TOP_N_MAX = 150` **신규**(파일 상단). `topN: clampInt(..., 1, MANUAL_LIST_MAX)` → `AUTO_TOP_N_MAX`. `parse-manual-list` import 제거 |
| `src/lib/universe/__tests__/parse-manual-list.test.ts` | 절대값 시험 추가 — `expect(MANUAL_LIST_MAX).toBe(500)` |
| `src/lib/universe/__tests__/auto-refresh-schedule.test.ts` | `topN` 천장 분리 회귀망 추가(150 통과 · 151·500 은 기본값 50 으로 떨어짐 · `AUTO_TOP_N_MAX !== MANUAL_LIST_MAX`) |

- [07:38] **왜 절대값 시험을 더했나**: 기존 상한 시험(`parse-manual-list.test.ts:132`)은 `MANUAL_LIST_MAX + 1` / `MANUAL_LIST_MAX` 로 쓰여 **상수 상대값**이다 → 수를 아무 값으로 바꿔도 통과한다. 이번처럼 상한 수치가 결정 사항이 된 뒤에는 그 시험이 회귀망 역할을 못 한다.
- [07:38] **문구는 손대지 않았다** — API(`manual/route.ts:70`)·화면(`view.ts` `DIFF_TOO_MANY_NOTE`)·제안 경로(`store.ts:793`)가 모두 `MANUAL_LIST_MAX` 를 받아 쓰므로 상수 하나로 「…500개까지입니다」로 자동 반영된다. `store.ts` 는 **건드리지 않았다**(감사 범위를 줄이려고 — 시험도 `refresh-config` 에서 직접 가져온다).
- [07:38] **하드코딩 상한 잔재 조사**: `grep -rn "150"` 중 상한 관련은 0건. 나머지 150 은 무관하다(오류 메시지 `slice(0,150)`·화면 예시 문구 `150종목 · 수동 98`·백테스트 표본 최소치).
- [07:40] **실행 증빙** (우분투, `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`):
  - `npx tsc --noEmit` → **exit 0**
  - `npx jest src/lib/universe src/app/api/settings/overseas-universe src/app/api/cron/overseas-universe-refresh src/components/universe` →
    **16 suites passed / 412 passed · 22 skipped** (skip 은 일회용 MariaDB 미기동분), exit 0
- [07:40] ⚠ **`next build` 는 아직 돌리지 않았다** — 타입·시험만으로 끝낸 상태다.
- [07:40] ⚠ **배포 금지 구간**: 지금 07:4x 이고 **08:00 pmo · 08:30~08:55 스냅샷 창**이 임박했다. 그 구간에 blue/green 컷오버가 들어가면 오늘 첫 125종목 실행과 T-145 ⑨ 첫 실측을 동시에 깬다 → **배포는 08:55 이후.**


## Reviewer

- [07:58] **감사 범위·방법** — 미커밋 4파일(`src/lib/universe/` 의 `parse-manual-list.ts`·`refresh-config.ts`·두 시험)의 diff 전문 + 상한을 쓰는 모든 소비처(`manual/route.ts:70`·`ManualListDiff.tsx:45`·`view.ts:243`·`store.ts:793`·`checkManualSymbols`·`replaceManualList`·`actOnProposal`) + 대상 목록을 받는 KIS 호출 경로 5곳(`post-market-overseas.ts:545`·`universe.ts:225`·`kis-fundamentals-snapshot.ts`·`us-edgar/sync-job.ts`·`ticker/all`)을 읽었다. 실행: 서버에서 `tsc --noEmit` exit 0(33초), jest(`src/lib/universe`·`api/settings/overseas-universe`·`api/cron/overseas-universe-refresh`·`components/universe`·`strategy/__tests__`) 43 suites 1167 passed / 22 skipped / 실패 0. dev 서버·KIS·pm2·배포 0건, 운영 DB 는 SELECT 5문장뿐(`system_config` 3키·`overseas_universe_revision` 메타·보유/즐겨찾기 건수·`VERSION()`·`@@sql_mode`). **변이 시험은 공유 트리가 아니라 `/tmp/rev-t146-mut` 격리 사본에서만 했다.** `next build` 는 돌리지 않았다(Developer 와 같다 — 이 diff 는 상수 1개·import 1개 변경이라 타입 검사로 충분하다고 봤고, 빌드 미확인은 그대로 남는다).
- [07:58] **결과 요약 — critical 0 · high 1 · medium 2 · low 3.** 4파일의 **코드 변경 자체는 지시(「수동 목록 상한 제거」)를 정확히 구현했고 요청에 없던 동작 변화는 섞이지 않았다.** 걸리는 것은 코드가 아니라 **500 이라는 수가 부딪히는 환경(스로틀)**과 **사용자에게 보인 문구·보고의 정확성**이다.
- [07:58] **H-1 (high) — 500 은 해외 일봉 팬아웃의 실제 수용 한도(≈154)의 3배이고, 넘으면 「조용한 부분 분석」이 된다.** 증거: `src/lib/strategy/post-market-overseas.ts:545` 가 `Promise.allSettled(symbols.map((s) => kis.getCandles(s,'1d',60)))` 로 **동시성 제한 없이** 전 종목을 한꺼번에 쏘고, 이 경로 어디에도 `withKisPriority` 가 없어 `normal` lane 을 탄다(`kisFetch` 는 `currentKisPriority()` 기본값 — `kis-http.ts:321`). `kis-throttle.ts` 는 `LANE_CAPACITY.normal = 192`(즉시 거절) + `DEFAULT_MAX_QUEUE_WAIT_MS = 30_000`(대기 데드라인), 운영 유량 `system_config.kis_rate_limit_per_sec = 5`(SELECT 실측). **실제 모듈을 가짜 타이머로 돌린 결과(경합 없는 최선의 경우)**: N=125 → 125 성공 · N=150 → 150 성공 · N=155 → 154 성공 / 타임아웃 1 · N=197 → 154 / 43 · N=200 → 154 / 타임아웃 43 / 대기열 초과 3 · **N=500 → 154 성공 / 대기열 초과 303 / 타임아웃 43**. 실패 종목은 `candle_fail:` 로 `errors` 에만 쌓이고(`:581`) **전부 실패일 때만** 503 이라(`:549`) 일부 실패는 그대로 진행해 **HTTP 200 → 날짜파일 기록 → 재시도 없음**이다. 잘리는 쪽은 `loadUsTargetSymbols` 의 `.sort()` 때문에 **알파벳 뒤쪽 = `NYS:` 종목**이 체계적으로 먼저 빠진다(편향, 무작위 아님). 대기열이 찬 30초 동안 같은 `normal` lane 의 다른 호출(화면 단건 시세 등)도 거절될 수 있다. **현재 목록은 안전하다**(125 + 보유 5 + 즐겨찾기 3 = 최대 133 ≤ 154, 여유 약 21). 그러나 ① 사용자가 받은 위험 3가지 보고에는 이 항목이 없었다 — 「300초 넘을 수 있다(느려진다)」와 달리 이것은 **느려지는 것이 아니라 결과가 틀려지는 것**이고 시간 예산보다 먼저(155종목부터) 온다. ② 옛 상한 150 은 우연히 이 한도(154) 바로 아래였다 — 상한이 막던 것은 시간 예산만이 아니었다. ③ **상한과 무관하게** WP-A 를 켜 자동 50 이 합집합에 들어오면 133 에서 NYSE 겹침만큼만 빠지므로 154 를 넘을 수 있다 `[추측 — 겹침 수는 미측정]`. **권고(이 diff 의 수정 요구 아님)**: Leader 가 사용자에게 「pmo 경로의 실효 한도는 상한과 무관하게 ≈150」임을 보고하고, 후속 task 로 팬아웃을 `mapWithLimit`+`bulk` 로 묶되 그러면 N/5초가 선형이라 500 이면 일봉만 100초 + LLM 90초가 curl 120초를 넘는다는 점(= 시간 예산 문제로 되돌아온다)과 함께 결정. `parse-manual-list.ts` 주석의 「남은 방어선」 목록에 이 한도를 한 줄 추가할 것을 권한다.
- [07:58] **M-1 (medium) — 상한 초과 안내 문구의 「이유」가 이제 거짓이다.** `src/components/universe/view.ts:243` `DIFF_TOO_MANY_NOTE` = 「…넣을 수 있는 ${max}개를 넘어 저장할 수 없습니다. **분석 시간 예산을 넘기지 않으려는 제한입니다** — 줄이고 다시 대조하세요.」 Developer 는 「숫자는 상수를 받아 자동으로 500 이 된다」고 했고 숫자는 맞다. 그러나 이유 절은 하드코딩이다. 같은 diff 의 새 주석이 「500 은 분석 시간 예산을 막지 않는다」고 쓰고 Leader 도 그 관문 상실을 사용자에게 보고했는데, 화면은 여전히 「500 이하면 시간 예산 안」으로 읽히게 한다(허위 안심). 재현: 수동 목록에 501줄을 붙여 넣으면 보인다(시험 0건 — 이 상수를 단언하는 시험이 없어 깨지지 않았다). `src/components/universe/` 는 SAFETY_PATHS 밖이고 문구는 designer 판단 영역이라 **Leader 경유로 designer 에게** 넘긴다(예: 이유 절을 「표 저장 한도입니다」로).
- [07:58] **M-2 (medium) — 용량 산정 표(`## ① 용량 산정`)의 유니버스 갱신 비용이 종목당 1콜로 세어져 있으나 코드는 2콜이다.** `universe.ts:225-226` 해외 분기는 전 종목 `getKisOverseasTickers(overseasSyms)`(종목당 현재가 1콜, `mapWithLimit` 4 동시성, `bulk`)를 먼저 하고 그다음 거래대금 상위 `UNIVERSE_TOP_N=150` 의 일봉(`:241`)을 한다. 5 req/s 에서 N=125 → ≈25초+≈25초, **N=500 → 현재가 ≈100초 + 일봉 ≈30초 ≈ 130초가 `strategy-eval` 한 호출 안**(TTL 15분)이다 `[가능성 높음 — 코드 산술, 실측 아님]`. 동시성 4 라 대기열 초과는 없다(안전). 표의 「일봉 11초 → ~26초」는 후반부만 센 값으로 보인다. `strategy-eval` 호출에 curl 상한이 있는지는 확인하지 않았다 `[미확인]`.
- [07:58] **L-1 (low) — 이미 적용된 DDL 파일의 주석이 새 값과 모순이다.** `scripts/migrations/T-143-overseas-universe.sql:13`(「실질 상한은 앱의 150」)·`:88-91`(「이 500 은 … 앱 상한과 같은 수가 아니다(앱 150) … 불일치는 의도된 설계」). 새 주석은 「두 수를 일부러 다르게 두던 설계는 끝났다」라고 한다. Developer 의 150 잔재 조사는 `src/` 만 훑어 이 둘을 놓쳤다. `^scripts/migrations/` 는 SAFETY_PATHS 라 고치면 그 커밋은 scope 에 이 경로를 넣고 별도 감사를 받아야 한다 — 적용 끝난 DDL 을 건드리지 말고 이 task 에 정오표로 남기는 편이 마찰이 작다(Leader 판단).
- [07:58] **L-2 (low) — 새 주석의 오류 번호가 틀렸다.** `parse-manual-list.ts:35` 와 시험 `parse-manual-list.test.ts:140` 이 CHECK 위반을 「errno 3819」라 쓰는데 운영 DB 는 **MariaDB 10.11.11**(`VERSION()` 실측)이고 이 저장소 자신이 CHECK 위반을 4025 로 쓴다(`safe-text.ts:77-79`·`flags.ts:70`). 3819 는 MySQL 8 번호다. 또 「깔끔한 400 대신 DB 오류가 사용자에게 보인다」도 과장이다 — 실제로는 `replaceManualList` 가 `error` 를 돌려 라우트가 `500 internal_error`(분류어만) 를 준다. **검사를 지우지 않고 500 으로 맞춘 결론은 그대로 옳다**(500 초과가 500 응답이 되는 것을 400 으로 바꾸는 효과는 실재한다).
- [07:58] **L-3 (low) — 변이 M8 이 생존했다(시험이 못 잡는 곳).** `buildManualListDiff` 의 `tooMany`(저장 버튼을 끄는 화면 플래그, `parse-manual-list.ts:113`)를 `false` 로 고정해도 42개 시험이 전부 통과한다. 이 diff 가 만든 구멍은 아니고(옛 시험도 같다) 서버 재검사가 400 으로 막으므로 돈·데이터 위험은 없다. 다만 상한이 정책 수치에서 표 백스톱으로 바뀐 지금 경계 시험(500줄 → `tooMany:false`, 501줄 → `tooMany:true`·`blocked:true`)을 하나 두는 것이 값싸다. 라우트(`manual/route.ts`)·`actOnProposal` 재검사의 상한 거절 경로도 시험이 0건이다(기존 상태).
- [07:58] **질문별 답 ①완전성** — 문구 3곳(`manual/route.ts:70`·`store.ts:793`·`view.ts:243`+`ManualListDiff.tsx:45`)은 모두 `MANUAL_LIST_MAX` 를 받아 쓴다는 판단이 **맞다**(숫자 기준). 단 `view.ts:243` 의 이유 절은 M-1. 하드코딩 150 잔재는 `src/` 에는 상한 용도가 없고(`daily-bars` `maxCalls` 150·`UNIVERSE_TOP_N`·`DEFAULT_MAX_CALLS` 는 별개 상수) `scripts/migrations/…sql` 에 주석 2곳(L-1)이 남았다.
- [07:58] **질문별 답 ②topN 분리** — **옳은 판단이고 종전 동작과 동일하다.** 옛 `clampInt(…,1,MANUAL_LIST_MAX=150)` 과 새 `clampInt(…,1,AUTO_TOP_N_MAX=150)` 은 같은 함수·같은 경계라, HEAD 의 두 모듈(`git show HEAD`)과 현재 `readAutoRefreshConfig` 를 나란히 놓고 **1,048개 입력**(경계 -1·0·1·49·50·149·150·151·500·501·1e9, 소수 150.7, 문자열 `'150'`·`' 150 '`·`'abc'`, `null`·`undefined`·`NaN`·`Infinity`·배열·객체·BigInt, 정수 -10…1000 전수)을 비교해 **전부 같았다**. 분리하지 않았다면 `topN` 천장이 500 이 되고(소비처는 `overseas-universe-refresh/route.ts:298` 하나) 그것은 지시에 없던 무인 경로 변경이다 — Developer 판단이 맞다. 참고: 합집합 총량의 상한은 어디에도 없다(수동 ≤500 + 자동 ≤150 + 보유·즐겨찾기 무제한 → 이론상 650+). 지시의 귀결이라 결함으로 세지 않는다.
- [07:58] **질문별 답 ③500이 깨는 전제** — 깨지는 것: **pmo 팬아웃(H-1)**, 유니버스 갱신 시간(M-2). **안 깨지는 것(근거 있음)**: `symbols TEXT` — 운영 개정판 1(125종목)이 **1,325바이트**(`LENGTH(symbols)` 실측, 종목당 ≈10.6B)라 500종목 ≈5.3KB(최악 ≈7.5KB) ≪ 65,535 · `symbol_count SMALLINT UNSIGNED`(≤65,535) · `loadEarningsEvents` 의 `IN (?)` 500개 전개(mysql2 가 배열을 펼침 — 플레이스홀더·패킷 한도 문제 없음) · `getKisOverseasTickers` 는 `mapWithLimit(4)`+`bulk` 라 대기열 초과 없음 · `kis-fundamentals-snapshot` 은 직렬+`bulk`+90초 마감+DB 이어받기 · `us-edgar/sync-job` 은 100초 마감+이어받기 · `ticker/all` 은 해외에 KIS 호출이 없고 목록 문자열만 돌려준다.
- [07:58] **질문별 답 ④501 경계** — 깔끔하다. `checkManualSymbols` 는 **중복 제거 전** 배열 길이로 먼저 거절(`:138`)하고 통과해도 `out` 은 중복 제거 후라 ≤500, `revisionParams` 의 `symbol_count` 는 그 `symbols.length` 다. `overseas_universe_revision` 에 쓰는 코드는 `store.ts` 의 `replaceManualList`(호출자는 `manual/route.ts` 하나, 검사 뒤에만 호출)와 `actOnProposal`(`checkManualSymbols(nextManual)` 재검사 뒤 `recheck.symbols` 만 삽입) 둘뿐이라 앱을 우회해 501행이 들어오는 경로는 **직접 SQL 시드뿐**이다. 제안 경로는 사람 1명이 제안 1건을 처리하는 POST 이고 `applyProposalToManual` 은 한 번에 최대 1종목을 더하므로, 「무인 경로가 500으로 느슨해졌다」(Leader 보고 위험 b)는 **실제로는 목록이 이미 499~500일 때만 의미가 있다**(위험을 줄여 읽어도 된다는 정정).
- [07:58] **질문별 답 ⑤변이 시험(격리 사본, 시험 2파일 42건 기준 — 기준선 42/42 통과)**: M1 `MANUAL_LIST_MAX` 500→150 → **2건 실패**(절대값 시험 + `AUTO_TOP_N_MAX !== MANUAL_LIST_MAX`) · M2 →501 → 1건 실패 · M3 →499 → 1건 실패 · **M4 clamp 이 다시 `MANUAL_LIST_MAX` 사용(분리 되돌림) → 1건 실패(topN 천장 시험)** · **M5 `AUTO_TOP_N_MAX = MANUAL_LIST_MAX` → 1건 실패** · M6 150→151 → 1건 실패 · M7 150→149 → 1건 실패 · M7b 150→500 → 1건 실패 · **M8 `tooMany` 항상 false → 42건 전부 통과(생존, L-3)** · M9 `checkManualSymbols` 상한 검사 삭제 → 1건 실패 · M10 `>` → `>=` 오프바이원 → 1건 실패. 즉 요청한 두 변이(상수를 150 으로, 분리를 되돌림)는 **둘 다 잡힌다.**
- [07:58] **질문별 답 ⑥「기존 시험은 상대값이라 회귀망이 아니었다」** — **맞다.** HEAD 의 두 시험 파일을 `MANUAL_LIST_MAX` = 150·500·5000 으로 각각 돌리면 세 번 다 40/40 통과했고, 분리 되돌림(M4)에서도 40/40 통과했다. 옛 시험으로는 이번 두 변경 어느 쪽도 잡히지 않는다 — 새 시험 2건이 실제 신규 회귀망이다.
- [07:58] **원복·무변경 증명** — 변이는 `/tmp/rev-t146-mut`(격리 사본)에서만 했고 공유 트리의 파일을 쓴 적이 없다. 시험 직후 `diff -r src/lib/universe /tmp/rev-t146-pristine` 가 **동일**(사본은 시작 시점에 트리와 `diff -r` 로 동일 확인), `git diff --stat -- src/` = 4파일 +52/−11(감사 전 diff 와 같음), `git diff -- src/ | md5` 앞 12자 `ad6936c260c4`, `git status --short` 의 수정 4파일 외 변화 없음(스테이징 0). 임시물(`/tmp/rev-t146-*`)은 감사 끝에 지운다.
- [07:58] **QA 인계 high_risk_areas** — `src/lib/strategy/post-market-overseas.ts:545`(무제한 팬아웃 — KIS 를 부르지 말고 `kis-throttle` 단위로만 재현) · `src/lib/exchanges/kis-throttle.ts:74-78`(`LANE_CAPACITY`)·`:114`(30초 데드라인) · `src/components/universe/view.ts:243`(허위 이유 절) · `src/lib/universe/parse-manual-list.ts:113,138`(500/501 경계) · `src/lib/universe/store.ts:790-795`(제안 재검사 거절 문구) · `src/lib/data/us-data-db.ts:53-72`(합집합 `.sort()` `:71` — 잘림의 편향 원인). QA 가 **하면 안 되는 것**: KIS 호출·dev 서버·운영 DB 쓰기(이 task 는 이미 개정판 1 이 들어간 운영 DB 와 같은 DB 를 본다).
- [07:58] **조건(진행 전 Leader 확인 2건)** — ① H-1·M-2 를 사용자에게 보고하고 결정을 task 에 남길 것(이 diff 를 되돌리라는 뜻이 아니다 — 상한 제거는 사용자 결정이고 위험 3가지 보고 뒤의 재확인이었다. **보고되지 않은 네 번째 위험**이라 알려야 한다). ② M-1 문구를 designer 를 거쳐 고치거나 사용자가 「그대로 둔다」고 정하게 할 것. L-1·L-2 는 이 diff 의 4파일에 주석 몇 줄을 더하는 정도라 한 번에 고치면 좋지만 요구가 아니다 — **4파일을 다시 고치면 Reviewer 부터 재순환**한다. 배포 시점은 Leader 가 정한 08:55 이후를 따르며 이 감사가 배포를 승인하는 것은 아니다.
- [07:58] **최종 판정: CONDITIONAL_PASS (scope: src/lib/universe/)**

## QA
- [09:52] **QA 사후 회귀 검증(배포 후) — 대상 커밋 `1dfd57d`.** 운영 `current` → `releases/20261103-093323-1dfd57d6` 과 NFS HEAD 가 같은 커밋임을 확인했다. 배포 게이트가 아니라 회귀 검증이다. 코드·설정 수정 0, 커밋 0, KIS 호출 0, dev 서버 기동 0, 운영 DB 쓰기 0(SELECT·SHOW 만). NFS 트리 `git status` 는 시작 시점과 같다.
- [09:52] **실행 ① typecheck** — 서버 `npm run typecheck` → `TSC_EXIT=0` (로그 `~/.node-local/qa-t146/tsc.log`).
- [09:52] **실행 ② 전체 jest** — 서버 `npm test`(flock 직렬) → Test Suites 386 passed · 7 skipped, Tests 11,021 passed · 267 skipped · 0 failed, `JEST_EXIT=0`. 신규 시험 두 파일(`parse-manual-list`·`auto-refresh-schedule`) 모두 PASS 확인. (로그 `~/.node-local/qa-t146/jest.log`)
- [09:52] **실행 ③ 경계·topN probe** — 격리 사본에서 `qa-t146-probe.test.ts` 23건 전부 통과, 저장소 파일은 건드리지 않았다.
  - 고유 500: 서버 통과, 화면 `tooMany=false`·`blocked=false`·`next=500`. 고유 501: 서버 `too_many`, 화면 `tooMany=true`·`blocked=true`. 경계 500/501 판정이 화면과 서버에서 일치한다.
  - 중복 1개 포함 501줄(고유 500): 화면 통과(`next` 500), 서버 재검사 통과. 중복 2개 포함 501줄(고유 499): 화면 통과(`next` 499), 서버 통과. 화면이 보내는 값은 중복 제거 후 `next` 라서 사용자 경로는 유효·고유 개수로 판정된다.
  - 같은 중복 입력을 원시 배열 501개로 API 에 직접 보내면 서버는 중복 제거 전 길이로 `too_many` 를 낸다. 사용자 화면 경로에서는 나오지 않는다. 기존 동작이고 T-146 이 만든 차이가 아니다(관찰, 결함 아님).
  - 빈 줄 10개 포함 500줄은 통과(빈 줄 미계수). 501줄 중 형식 오류 1개: 서버는 길이 검사가 형식보다 먼저라 `too_many`, 화면은 `tooMany=false`·`blocked=true`(형식 오류 사유). 차단은 양쪽 모두 일치하고 표시 사유만 다르다.
  - topN(`readAutoRefreshConfig` 실경로, 가짜 DB): 0→50 · 1→1 · 149→149 · 150→150 · 151→50 · 500→50 · 1e9→50 · `"150"`→150 · `"500"`→50 · -5→50 · 미설정→50. 상수 확인: `MANUAL_LIST_MAX=500`, `AUTO_TOP_N_MAX=150`, `AUTO_REFRESH_DEFAULT.topN=50`. topN 천장은 500 과 분리되어 150 그대로다.
  - probe 1차 실행에서 2건이 실패했다. 둘 다 시험 쪽 원인이었다(생성기 ID 충돌, 화면 `tooMany` 기대값 오류). 고친 뒤 23/23. 제품 결함은 아니다.
- [09:52] **소비처 일관성** — `MANUAL_LIST_MAX` 참조는 `manual/route.ts:70`(문구)·`ManualListDiff.tsx:45`·`store.ts:793`(제안 재검사 문구)·`parse-manual-list.ts` 내부 2곳으로 모두 상수를 쓴다. `src/` 에 상한 용도의 하드코딩 150 은 없다.
- [09:52] **운영 실측(읽기 전용)** — `/api/health`: `ok:true`, `db:true`, `safetyStatus:green`, `dryRun:true`, `killSwitch:false`, `authConfigured:true`, `cronSecretConfigured:true`(값이 아니라 여부만 확인). pm2: `stockinvest`·`stockinvest-cron` 각 1개 `online`, restarts 0, cwd 는 릴리스 `1dfd57d6`. 최신 개정판 `revision_no=1`·`symbol_count=125`·`change_source=seed`. 운영 DB 의 `chk_rev_count` 가 `symbol_count <= 500` 으로 실제 존재함을 `information_schema` 로 확인했다(백스톱 전제 충족).
- [09:52] **안전장치 체크리스트** — 이 변경은 주문·한도·Kill Switch·DRY_RUN 경로를 건드리지 않는다. 근거: 변경 src 는 `src/lib/universe/` 4파일이고 diff 에 SQL 변경 0줄. `parse-manual-list.ts` 는 import 가 없고 `refresh-config.ts` 는 `mysql2` 타입·`@/lib/db` 만 가져오며, 둘 다 `safety`·`exchanges`·주문 함수를 import 하지 않는다. 주문 엔드포인트 호출 시험(DRY_RUN 응답·KILL_SWITCH 차단·ORDER_MAX·화이트리스트·감사 로그)은 **미실행, NOT_VERIFIED**다. developer 가 준 실매매 시험 명령이 없어 실행하지 않았고, 변경과도 무관하다.
- [09:52] **보안 점검** — 헬스 응답에 비밀값 없음(불리언만). diff 에 SQL·신규 입력 경로 0.
- [09:52] **화면 검증 — NOT_VERIFIED.** 바뀐 화면 요소는 문구 숫자(150→500) 하나라 레이아웃·색·터치 대상 변화는 없다. 실제 렌더는 로그인된 운영 세션이 필요해 QA 가 확인하지 못했고(자격증명을 쓰지 않는다), dev 서버 기동도 금지다. 문구 내용은 소스로만 확인했다(`view.ts:242-243`).
- [09:52] **Reviewer 발견 재확인**
  - **M-1 (medium) — 확인됨.** `view.ts:243` 이유 절 「분석 시간 예산을 넘기지 않으려는 제한입니다」는 지금 상한(표 백스톱)과 맞지 않는 설명이다. 501줄 붙여넣기에서 이 문구가 나간다(소스 확인, 브라우저 재현은 NOT_VERIFIED).
  - **L-3 (low) — 확인됨.** `tooMany` 를 단언하는 저장소 시험이 0건이다(`grep -rln tooMany src --include=*.test.*` 결과 없음). 이번 probe 가 경계를 고정했지만 그 시험은 저장소에 없다.
  - **L-1·L-2 — 확인됨.** `parse-manual-list.ts:35` 가 여전히 `errno 3819` 라고 적고 있다(운영 MariaDB 10.11.11 에서는 4025). `T-143-overseas-universe.sql:14` 의 「두 수가 다른 것은 의도된 설계」 정오표는 아직 없다.
  - **H-1 (high, Reviewer 보고) — QA 미재현, NOT_VERIFIED.** 코드 사실만 확인했다. `post-market-overseas.ts:545` 가 `Promise.allSettled(symbols.map(...))` 로 동시성 제한 없이 발사하고 `withKisPriority` 가 없다. Reviewer 의 실모듈 측정(한도 약 154, 초과분 조용히 누락)은 인용만 했다. 운영 목록 125종목은 여유 안이지만, 151 이상을 막는 코드 가드는 지금 없다.
  - **M-2 (medium) — NOT_VERIFIED.** 코드 산술이고 실측은 없다.
- [09:52] **QA 신규 결함: 0건.** Critical·High·Medium·Low 신규 없음. 위 원시 배열 판정 차이는 관찰 1건이고 기존 동작이다.
- [09:52] **Leader 결정 필요 2건** — ① M-1 문구: 이유 절을 고칠지, 사용자가 수용할지. QA 는 이것을 이유로 반송하지 않았다. 사용자가 배포를 이미 결정했고 UI 문구는 designer 경유로 미뤄진 상태다. 고치기로 하면 이 4파일 밖이라 별도 task 와 재순환이 필요하다. ② H-1: 151 이상 적재를 막는 가드(코드 또는 운영 절차)가 없다는 점을 사용자가 알고 수용했는지 확인.
- [09:52] **미검증 목록(NOT_VERIFIED)** — 브라우저 화면(다크·라이트, 412/1280, 가로 스크롤) · H-1 실재현 · M-2 실측 · 주문 경로 안전장치 시험 · `next build` 재실행(커밋 메시지·Reviewer 보고 인용, QA 는 `.next` 를 공유 트리에 만들지 않으려고 실행하지 않았다).
- [09:52] **산출물 정리** — 서버 임시 사본(`proj`, 소스 복사본과 node_modules symlink) 삭제 완료. 로그와 probe 시험 파일은 근거 재현용으로 서버 `~/.node-local/qa-t146/` 에 남긴다(`jest.log`·`tsc.log`·`probe.log`·`qa-t146-probe.test.ts`). 스크린샷과 프로젝트 내 산출물은 0개다.
- [09:52] **QA 판정: CONDITIONAL_PASS (근거: 전체 jest 386 suites·11,021 passed·0 failed, typecheck 0, 경계·topN probe 23/23, 신규 결함 0 · 조건: M-1 거짓 이유 문구는 사용자 결정 대기, H-1 은 실재현하지 않은 채 사용자 수용 상태로 남음)**


## Leader

- [08:10] **Reviewer 판정 줄 접수: conditional_pass (scope: `src/lib/universe/`)** — 형식·범위 확인(판정 줄 1개 · `## Reviewer` 절에 소제목 0개 · 안전 파일 4개가 전부 그 scope 안). **이 감사는 배포 승인이 아니다.**
- [08:10] 코드 변경 자체는 결함 0이다 — Reviewer 가 HEAD 모듈과 현재 모듈을 **입력 1,048개 전수 비교**해 `topN` 판정이 전부 같음을 확인했고, 돌연변이 9종 중 8종이 새 시험에 잡혔다(생존 1종은 L-3).

### 🔴 H-1 — 사용자에게 보고할 **네 번째 위험**(듣지 못한 것)

`post-market-overseas.ts:545` 의 일봉 조회가 **동시성 제한 없이** `Promise.allSettled(symbols.map(...))` 로 전 종목을 한 번에 발사하고 `normal` 레인을 탄다. 스로틀 대기열 상한 **192** · 대기 데드라인 **30초** · 운영 유량 **5건/초**(DB 확인). Reviewer 가 **실제 모듈로 측정**한 결과:

| 종목 수 | 성공 | 실패 |
|---|---|---|
| 125 · 150 | 전부 | 0 |
| **155** | **154** | 1 |
| 500 | 154 | 대기열 초과 303 · 타임아웃 43 |

**일부만 실패하면 그대로 진행해 HTTP 200 으로 끝나고 재시도가 없다.** 잘리는 쪽은 `.sort()` 때문에 알파벳 뒤쪽 = **`NYS:` 종목**이다. 즉 **느려지는 문제가 아니라 결과가 조용히 틀려지는 문제**이고, 시간 예산(300초)보다 **먼저** 155종목에서 나타난다.

**현재는 안전하다 — 여유 21종목.** 운영 실측(2026-11-03): 보유(해외) **5** · 즐겨찾기(해외 형식) **3** · 수동 목록 **125** → 합집합 최대 **133** < 154.

🔴 **그런데 이 작업의 발단이던 151종목은 안전하지 않다.** 151 + 5 + 3 = **159 > 154** → 약 5종목이 조용히 누락된다. **상한 제거만으로는 사용자가 원한 수에 도달하지 못한다.** 후속 안(Reviewer 제시): 일봉 조회를 `mapWithLimit` + `bulk` 레인으로 묶기 — 다만 그러면 500종목에서 일봉만 100초 + LLM 90초로 curl 120초를 넘는다(별 task).

### 내가 사용자에게 잘못 보고한 것 (정정)

- **용량 산정 표의 유니버스 갱신 행이 틀렸다(M-2).** 「종목당 일봉 1콜」로 셌는데 `universe.ts:225~241` 은 **현재가 전 종목 + 일봉 상위 150종목 = 2콜**이다. N=500 이면 약 100초 + 30초가 `strategy-eval` 한 호출 안에 들어간다. (코드 산술이고 실측은 아니다.)
- **새 주석의 `errno 3819` 가 틀렸다(L-2).** 운영은 MariaDB 10.11.11 이라 CHECK 위반은 **4025** 이고, 실제 사용자에게 보이는 것은 「DB 오류 노출」이 아니라 **500 `internal_error`** 다. 주석의 논지(검사를 지우면 깔끔한 400 이 사라진다)는 유효하지만 **수치와 표현이 부정확하다.**
- 「무인 제안 경로가 느슨해진다」는 보고는 **과장이었다.** Reviewer 확인 — 제안 경로는 사람이 한 번에 한 제안을 처리하고 **한 번에 최대 1종목만** 늘린다. 실제로 의미가 생기는 것은 목록이 **499~500일 때만**이다.

### 미처리로 남기는 것

| ID | 내용 | 처리 |
|---|---|---|
| M-1 | `view.ts:243` 안내 문구의 「분석 시간 예산을 넘기지 않으려는 제한입니다」가 이제 **거짓**(표 백스톱이다). 501줄 붙여넣을 때 보인다 | **사용자 결정 대기** — UI 문구라 designer 경유 |
| L-1 | 적용 끝난 DDL 주석(`T-143-overseas-universe.sql:13`·`88~91`)이 아직 「앱 상한 150·두 수가 다른 것은 의도된 설계」라고 적혀 있다 | 정오표로 남긴다(적용된 DDL 은 건드리지 않는다 — 고치면 `scripts/migrations/` 가 scope 에 들어가 재감사) |
| L-2 | 위 errno 오류 | H-1 수정 task 와 같은 감사 주기에 묶는다 |
| L-3 | `buildManualListDiff` 의 `tooMany` 경계 시험 없음(돌연변이 생존). 서버 재검사가 400 으로 막아 구멍은 아니다 | 후속 |

- [08:10] **QA 는 아직 돌리지 않았다.** Reviewer 조건이 「사용자에게 보고하고 결정을 남겨라」라서, 배포 여부가 정해지기 전에 QA 를 돌리는 것은 순서가 아니다.
### ✅ ① 125종목 첫 실측 (2026-11-03 08:00, 운영)

`job_run_log` — `post-market-overseas` **08:00:49 · 55초 · `ok`**:

```
{"evaluated":126,"candidates":7,"llm_input":1,"created":0,"blocked":1,"duplicate":0,"skipped":1}
```

| 항목 | 어제(11-02 기준 10-31 실행) | 오늘 | 판정 |
|---|---|---|---|
| `evaluated` | 54 | **126** | ✅ 125종목 반영이 실제로 작동했다(합집합 중복 제거 뒤 126, 최대치 133) |
| 소요 | 38초 | **55초** | ✅ Leader 예측 「~53초」와 일치 — **이제 추정이 아니라 실측이다** |
| `status` | ok | **ok** | ✅ |
| 일봉 실패 | — | **0** (`counts_json` 에 `candle_fail` 없음 · pm2 `post-market` 경고 0건) | ✅ **KIS 가 새 75종목을 전부 처리했다** — Leader 가 미검증으로 남긴 가장 큰 항목이 해소됐다 |
| 목록 판독 | — | **경고 0건**(`[universe-overseas]`) | ✅ DB 개정판을 degraded 없이 읽었다 |
| `candidates` | 1 | **7** | 분석 대상이 2.3배가 되니 후보도 늘었다. `llm_input` 은 설계대로 **1회**, `created: 0` |

**H-1 관점**: `evaluated 126` < 154(Reviewer 측정 한계) → **여유 28**. 누락 없이 `ok` 로 끝난 것이 그 측정과 일치한다.

**아직 안 본 것**: 스냅샷(`kis-fundamentals-snapshot`)은 **08:30~08:55 창**이라 08:05 시점에는 실행 전이다 — `us_fundamentals_snapshot` 이 53행 → 126행 근처로 가야 하고, 90초 예산을 넘으면 **창 안 이어받기**(T-145 ⑨)가 받는지가 같이 드러난다. `NYS:BRK.B` 는 종전처럼 실패할 것이다.

- [08:10] **배포 보류 — 사용자 결정 대기.** 상한 제거 자체는 되돌릴 필요가 없지만, 발단이던 151종목이 H-1 구간이므로 ① 지금 배포(125종목은 안전, 151 은 H-1 수정 뒤) ② H-1 수정과 함께 배포 중 어느 쪽인지 사용자가 정해야 한다.

### ✅ ② 스냅샷 창 실측 (2026-11-03 08:30~08:56, 운영) — T-145 ⑨ 첫 실전

`job_run_log` — `kis-fundamentals-snapshot` **08:30:12 시작 · 창 전체 1,546초(≈25.8분) · `ok` · `error_code` NULL**(틱 묶음 rollup 행).

| 항목 | 직전(11-02) | 오늘 | 판정 |
|---|---|---|---|
| `us_fundamentals_snapshot` 행수 | 53 | **125** | ✅ 125종목 중 거의 전부 수집 — 90초 틱 예산을 **창 안 이어받기**로 넘겼다 |
| `status` | — | **ok** | ✅ `partial`·`degraded` 아님 |

**T-145 ⑨(창 안 이어받기)가 실전에서 처음 작동했고 설계대로 동작했다.** 90초 한 틱으로는 125종목이 끝나지 않는데, 창이 닫힐 때까지 DB 커서를 이어받아 125행을 채웠다 — 이것이 어제 넣은 변경의 존재 이유였고, 이제 추정이 아니라 실측이다. 125행(126 아님)인 것은 `NYS:BRK.B` 가 종전처럼 실패했기 때문으로 보인다(예측과 일치, 신규 결함 아님).

### 관찰 — `strategy-eval` 348초 (제 변경 **이전부터**, 새 결함 아님)

09:00 슬롯 `strategy-eval` rollup 의 `maxMs` 가 **347,800ms(348초)** 다. 125종목 주입(11-03) 탓으로 읽힐 수 있어 전후를 비교했다:

| 날짜 | runs | failed | maxMs | status |
|---|---|---|---|---|
| 10-31 | 12 | 0 | 12ms | ok |
| 11-01 | 20 | 2 | 17ms | partial |
| **11-02**(주입 전) | 10 | **2** | **278,264ms** | **partial** |
| **11-03**(주입 후) | 4 | **0** | **347,800ms** | **ok** |

[확실] **278초짜리 실행이 주입 전날에 이미 있었다** — 내 변경이 만든 것이 아니다. 오늘은 70초 더 길지만 `failed` 가 2 → **0**, `status` 가 partial → **ok** 로 오히려 나아졌다. 긴 실행 때문에 창 안 틱 수가 10 → 4 로 줄었다(한 틱이 길어 적게 들어간다).

[확실] **순찰(watchdog)은 재시작하지 않았다** — `pm2` `stockinvest`·`stockinvest-cron` 둘 다 `restart_time=0`·`unstable_restarts=0`, uptime 2026-11-02T13:51Z 무중단. 348초가 하트비트 300초 한계를 깨지 않았다는 뜻이다(러너가 틱 바깥에서 하트비트를 쓰기 때문으로 보이나 그 경로는 이번에 읽지 않았다 — [추측]).

👉 **후속 후보**(이 task 범위 밖): 09:00 `strategy-eval` 이 왜 278~348초인지, 그 길이가 러너 curl 상한·하트비트와 어떤 관계인지. `scripts/cron-runner.sh:465` 의 `call` 에 전용 `*_CURL_MAX_TIME` 이 없다.

### 사용자 결정 (2026-11-03 09:28) — ① 지금 배포

Reviewer 조건 ①(H-1·M-2 를 보고하고 결정을 남길 것) **충족**:

- Leader 가 H-1(pmo 무제한 팬아웃 — 154종목 넘으면 조용히 누락)과 M-2(유니버스 갱신이 종목당 2콜이라 500종목에서 `strategy-eval` 안에서 ~100초+30초)를 **보고되지 않은 네 번째·다섯 번째 위험**으로 사용자에게 알렸다.
- 사용자 답: **「1번으로 진행해줘」** = 지금 배포한다. 즉 **상한 제거는 그대로 반영하고, 발단이던 151종목 목록은 H-1 수정 뒤로 미룬다.** 현재 운영 목록은 125종목(`evaluated` 126)이고 H-1 한계 154 까지 여유 28 이라 이 결정으로 지금 위험해지는 것은 없다.
- 🔴 **이 결정이 남기는 것**: 상한은 500 이 되지만 **실질 안전 한계는 154**다(코드가 막지 않는다). 151종목을 넣으려면 H-1 수정이 선행 조건이고, 그것은 이 task 가 아니다.

Reviewer 조건 ②(M-1 문구) — **사용자가 정하지 않았으므로 그대로 둔다.** `src/components/universe/view.ts:243` 은 이번 4파일 밖이고 UI 문구라 designer 경유가 맞다. 후속으로 올린다.

- [09:58] **QA 판정 접수: conditional_pass · 신규 결함 0건.** QA 가 내 주장들을 **독립적으로 재현**했다 — 고유 500 통과/501 거절이 화면·서버에서 일치, `topN` 0→50·150→150·151→50·500→50(천장 150 분리 확인), 운영 DB 에 `chk_rev_count (symbol_count <= 500)` 실존(`information_schema`), 전체 jest 386 suites·11,021 passed·0 failed·typecheck 0. 안전장치 경로 무접촉도 import 근거로 확인했다.
- [09:58] **QA 결정요청 ① M-1 문구 → 고치지 않고 둔다.** `src/components/universe/view.ts:242-243` 의 「분석 시간 예산을 넘기지 않으려는 제한입니다」는 이제 거짓 이유다(실제로는 표 백스톱). 다만 ⓐ 이번 4파일 밖이고 ⓑ UI 문구라 designer 경유가 규칙이며 ⓒ 501줄을 붙여넣을 때만 보이는 문구다. 사용자가 정하지 않았으므로 **후속 task 로 올린다**. 고치면 Reviewer 부터 재순환이다.
- [09:58] **QA 결정요청 ② H-1 수용 여부 → 사용자가 알고 수용했다.** Leader 가 H-1 을 「보고되지 않은 네 번째 위험」으로 명시해 보고하고 두 선택지를 냈으며, 사용자가 **①(지금 배포 · 151종목은 H-1 수정 뒤)** 를 골랐다. 즉 수용 범위는 **「상한을 500 으로 올리는 것」까지이고 「151종목을 실제로 넣는 것」은 아니다.**
- [09:58] 🔴 **그래서 지금 살아 있는 구멍 하나를 분명히 적어 둔다.** 종전에는 상한 150 이 **우연히** 151종목 적재를 막아 주고 있었다. 그 우연한 보호가 이 배포로 사라졌다 — 지금 화면에 151줄을 붙여넣으면 **저장이 되고**, 다음 08시 해외 분석에서 154종목을 넘는 초과분이 `post-market-overseas.ts:545` 에서 **조용히 누락**될 수 있다(오류도 경고도 없이). **코드 가드는 없다.** 현재 운영은 125종목(`evaluated` 126)으로 여유 28 이라 발현하지 않는다. 151종목을 넣으려면 H-1 수정이 **선행 조건**이다.

### 🚀 배포 기록 (2026-11-03 09:34 KST) — ① 결정에 따른 운영 반영

| 항목 | 값 |
|---|---|
| 커밋 | `1dfd57d` (`feat(T-146): 수동 목록 상한 제거 …`) |
| 릴리스 | **`20261103-093323-1dfd57d6`** (이전 `20261102-225046-8f101d03`) |
| 방식 | push = webhook blue/green (`git push origin main`, `8f101d0..1dfd57d`) |
| 시각 | 09:33:13 시작 → 09:34:52 종료 (**89초**) |
| 결과 | `RELEASE_RESULT {"status":"ok", …, "migrated":false}` · `END … exit=0` |
| 마이그레이션 | **없음** (`migrated: false`) — 이 변경은 코드 상수뿐이다 |
| 같은 배포에 실린 다른 작업 | `0387b1b`(T-126 문서 1파일) · `9d767df`(T-145 문서 1파일) — **둘 다 `agent-vault/` 문서, 코드 변경 0**. `0387b1b` 메시지에 「push 안 함」이라 적혀 있으나 조상 커밋이라 함께 나갔다(배포 내용은 바뀌지 않는다) |

**커밋 전 검증(서버 재실행)**: `tsc --noEmit` exit 0 · `jest` 전체 **386 suites / 11,021 passed / 267 skipped / 0 failed** exit 0 · `src/lib/universe` 13 suites / 306 passed exit 0 · `next build` exit 0.

**커밋 안전장치**: 서버에서 커밋했고 훅이 돌았다 — `✅ [commit-msg] Reviewer 감사 기록 확인: T-146`. (Mac 에서는 `core.hooksPath` 가 우분투 경로라 훅이 무음으로 건너뛰어진다 — 안전경로 커밋은 서버에서만.) push 전 `git-refs-clean.sh --check` **깨끗**(실제 ref 22개), push 후 재점검도 깨끗.

**배포 후 확인(직접 실측)**:

| 확인 | 결과 |
|---|---|
| `current` 심링크 | → `releases/20261103-093323-1dfd57d6` ✅ |
| `/api/health` | `ok:true` · `safetyStatus:"green"` · `dryRun:true` · `killSwitch:false` ✅ |
| pm2 | `stockinvest`·`stockinvest-cron` 둘 다 `online` · `restart_time=0` · 09:33:54/55 reload ✅ |
| 배포된 상수 | `parse-manual-list.ts:50` `MANUAL_LIST_MAX = 500` · `refresh-config.ts:23` `AUTO_TOP_N_MAX = 150` ✅ |
| 운영 목록 | `overseas_universe_revision` 개정판 **1 = 125종목**(1,325바이트·`seed`) **변화 없음** ✅ |
| WP-A | `system_config` 에 자동갱신 설정 행 **없음** → `AUTO_REFRESH_DEFAULT.enabled=false` 로 **꺼짐** · `overseas_universe_auto` **0행** ✅ |
| 장중 재기동 영향 | 09:33:53~54 에 cron 호출 `HTTP=000` 5건(web 재기동 중 — 예상된 것) → 09:33:55 러너 재시작 후 `entry-watcher`·`holding-checker`·`stop-alert` 정상 ✅ |

**AI 가 검증하지 못한 것**: 상한 변경의 **실제 효과**(151종목 붙여넣기가 저장되는지)는 운영 DB 쓰기라 확인하지 않았다 — 사용자 결정대로 151종목은 H-1 수정 뒤로 미뤘다. 지금 검증된 것은 ⓐ 배포된 코드의 상수값, ⓑ 시험·빌드, ⓒ 운영 무중단·목록 불변까지다.

### 🔴 배포 확인 중 발견 — `strategy-eval` 이 러너를 묶어 분당 잡이 굶는다 (기존 결함, 이 변경과 무관)

배포 직후 cron 로그가 **145초간 멈춘 것**을 보고 추적했다.

[확실] **원인**: `scripts/cron-runner.sh:113` 의 `call()` 은 `CALL_MAX_TIME` 이 **비어 있지 않을 때만** `--max-time` 을 붙인다(`:120~122`). `strategy-eval`(`:465`)은 전용 상한이 없어 **curl 이 무한정 기다린다**. 러너는 단일 순차 루프라 그 동안 분당 잡(`entry-watcher`·`holding-checker`·**`stop-alert`**)이 전부 멈춘다.

[확실] **실측(2026-11-03)**:

| 측정 | 값 |
|---|---|
| 배포 직후 블록 | 09:33:56 → **09:36:21** = **145초** (`ps` 로 `strategy-eval` curl 이 106초째 살아 있는 것을 직접 확인) |
| 그 사이 `stop-alert` | **0회** — 보유 **6종목**의 손절 알림이 145초 공백 |
| 하트비트 최대 나이 | **168초** (임계 300초 — 이번엔 안 걸렸다) |
| 오늘 09:00 슬롯 최악 | `job_run_log` rollup `maxMs` = **347,800ms (348초)** |
| 전날(11-02, 125종목 주입 전) | `maxMs` **278,264ms (278초)** · `failed 2` · `partial` |
| pm2 재시작 | **0회** (두 프로세스 모두 무중단) |

[확실] **내 변경 탓이 아니다** — 278초짜리 실행이 125종목 주입 **전날**에 이미 있었다. 오늘이 70초 더 길지만 `failed` 2→**0**, `status` partial→**ok** 로 오히려 나아졌다. [추측] 그 +70초가 125종목 때문인지 단순 편차인지는 `strategy-eval` 라우트를 읽지 않아 가릴 수 없다.

[가능성 높음] **순찰이 막아 주지 않는다**: 하트비트는 `cron-runner.sh:446~448` 에서 **틱 시작에만** 기록되고, 순찰은 crontab `*/5 * * * * check-and-recover.sh --periodic` 으로 **5분마다 샘플링**하며 임계는 `max_age_seconds: 300`(`HOME-SERVER_CONFIG/.../projects.json:84`)이다. 348초 블록이면 하트비트가 300초를 넘기지만, 그 초과 구간(≈48초)에 5분 샘플이 걸릴 때만 재시작된다. 즉 **재시작 0회는 안전해서가 아니라 샘플이 비켜간 것**이고, 거꾸로 **장중에 무작위로 cron 이 재시작될 수도 있다**.

👉 **후속 task 후보**(이 task 범위 밖 — `scripts/cron-runner.sh` 는 `SAFETY_PATHS` 라 Reviewer 재감사가 필요하다): ⓐ `STRATEGY_EVAL_CURL_MAX_TIME` 신설, ⓑ 블록 중에도 하트비트를 갱신할지(그러면 굶는 것을 순찰이 영구히 못 본다 — 설계 판단 필요), ⓒ `strategy-eval` 이 왜 145~348초인지(분당 잡과 같은 루프에 둘 일인지).

## 최종 요약 (Leader, 2026-11-03 10:05)

### [T-146] 해외 종목목록 125종목(나스닥100) 주입 + 목록 상한 제거

**상태**: 운영 반영 완료 · 후속 2건 대기

**무엇이 바뀌었나**
1. **해외 분석 대상이 54종목 → 126종목**이 됐다. 나스닥100(101종목) + 기존 NYSE 24종목 = 125종목을 `overseas_universe_revision` 개정판 1로 넣었다(코드 변경 0 — DB 한 줄). 종목 선정은 나스닥 공개 구성 + **SEC 공개 자료로 티커·거래소를 대조**해 확정했다(`api.nasdaq.com` 은 이용 권리가 없어 쓰지 않았다).
2. **수동 목록 상한 150 → 500.** 표 백스톱 `chk_rev_count CHECK (symbol_count <= 500)` 과 같은 수로 맞췄다. 검사 자체는 남겼다 — 지우면 깔끔한 400 응답이 표 CHECK 위반으로 바뀌어 요청에 없던 실패 경로가 생긴다.
3. **WP-A `topN` 천장은 150 그대로 분리**했다(`AUTO_TOP_N_MAX` 신규). 같이 올리면 `system_config` 값 하나로 바뀌는 **무인 경로**의 천장이 500 이 되는데, 지시는 「수동 목록 상한 제거」였다.

**배포**: 커밋 `1dfd57d` → 릴리스 **`20261103-093323-1dfd57d6`**, push=webhook blue/green, 09:33:13→09:34:52(89초), `status: ok`, **`migrated: false`**. 같은 배포에 실린 다른 작업: `0387b1b`(T-126 문서)·`9d767df`(T-145 문서) — 둘 다 `agent-vault/` 문서 1파일, 코드 변경 0.

**AI 가 검증한 것**
- 운영 실측: 08:00 `post-market-overseas` **`evaluated` 54→126 · 55초 · `ok` · 일봉 실패 0건 · 목록 판독 경고 0건** → KIS 가 새 75종목을 전부 처리했다. 08:30 `kis-fundamentals-snapshot` **53행→125행 · `ok`** → T-145 ⑨ 창 안 이어받기가 실전에서 처음 작동했다.
- 코드: `tsc` 0 · `jest` 386묶음 11,021건 0실패 · `next build` 0 · Reviewer 돌연변이 11종 중 10종 탐지 · QA 경계 probe 23/23(고유 500 통과·501 거절, `topN` 151·500→기본값 50).
- 배포 후: `current` 심링크·health `green`·`dryRun:true`·pm2 둘 다 online·재시작 0 · 배포된 상수 500/150 · 운영 목록 125종목 불변 · WP-A 꺼짐(설정 행 없음·자동 표 0행).
- 커밋 훅이 실제로 돌았다 — `✅ [commit-msg] Reviewer 감사 기록 확인: T-146`(서버에서 커밋. Mac 은 훅이 무음으로 건너뛰어진다).

**AI 가 검증하지 못한 것**
- **151종목이 실제로 저장되는지** — 운영 DB 쓰기라 하지 않았다(사용자 결정으로 미룬 부분).
- 브라우저 실제 화면(로그인 필요) · H-1 실재현 · M-2 실측 · 주문 경로 안전장치 시험(이 변경과 무관).

**👉 사용자가 확인할 것**
- **어디서**: 내일(11-04) 08:00 이후 해외 분석 결과와 텔레그램 알림. **무엇을**: 분석 대상이 126종목으로 유지되고 후보·알림이 오는지. **정상 기준**: 오늘과 같이 `evaluated` 126 전후, 일봉 실패 0. **언제부터**: 이미 적용돼 있다(오늘 08시부터).
- 화면에서 보려면 설정 → 해외 분석 대상 목록이 125종목으로 보이면 된다.

**👉 사용자가 결정할 것**
1. **M-1 화면 문구** — 501줄을 붙여넣을 때 나오는 「분석 시간 예산을 넘기지 않으려는 제한입니다」가 이제 거짓 이유다(실제로는 표 백스톱). **권고: 후속으로 designer 를 거쳐 고친다**(이번 4파일 밖이라 지금 고치면 Reviewer 부터 재순환).
2. **H-1 수정을 할지** — 아래 「이슈·위험」의 첫 항목. **권고: 151종목을 넣고 싶다면 선행 필수.**

**남은 일**
- H-1 수정(`post-market-overseas.ts:545` 동시성 제한 + `bulk` 레인). 500종목에서는 일봉만 ~100초가 되어 `LLM_TIMEOUT_MS` 90→60 도 함께 가야 한다.
- M-1 문구 수정(designer 경유) · L-3 `tooMany` 경계 시험 저장소 반영 · L-1·L-2 주석 정오표.
- **NYSE 상위 50 은 이 task 로 들어가지 않았다** — WP-A(월 1회 자동 산출) 경로이고, 켜려면 WP-A DDL 적용 + 스위치 행 추가(각각 사용자 승인) + T-145 잔여 조건이 먼저다.
- 이 문서 커밋은 **push 하지 않았다**(push=배포라 장중 재배포를 피했다). 다음 기능 push 에 함께 나간다.

**이슈·위험**
- 🔴 **종전에는 상한 150 이 우연히 151종목 적재를 막아 주고 있었고, 그 보호가 이 배포로 사라졌다.** 지금 151줄을 붙여넣으면 저장되고, 154종목을 넘는 초과분이 다음 08시 분석에서 **오류도 경고도 없이 누락**될 수 있다(H-1). 코드 가드는 없다. 현재 125종목은 여유 28 로 발현하지 않는다.
- ⚠ **`strategy-eval` 이 러너를 묶어 분당 잡이 굶는다**(기존 결함, 이 변경과 무관). 오늘 실측 145초, 오늘 최악 348초, 전날 278초. 그 사이 보유 6종목의 손절 알림(`stop-alert`)이 멈춘다. 하트비트가 틱 시작에만 갱신되고 순찰은 5분 샘플·임계 300초라, **재시작 0회는 안전해서가 아니라 샘플이 비켜간 것**이다. 거꾸로 장중 무작위 재시작도 가능하다.
- QA 가 `CONDITIONAL_PASS`(신규 결함 0)로 통과했으나 **배포 뒤에 돌았다** — 사용자 결정으로 배포를 먼저 했기 때문이고, 순서상 이탈이다.

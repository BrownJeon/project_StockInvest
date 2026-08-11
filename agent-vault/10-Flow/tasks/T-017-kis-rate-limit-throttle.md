---
task-id: T-017
project: StockInvest
created: 2026-08-10
updated: 2026-08-11
status: done
deployed: 2026-08-11
commit: bbe074b
tags:
  - type/task
  - domain/exchanges
  - domain/safety
  - domain/infra
aliases:
  - KIS 레이트리밋 스로틀
  - EGW00201
  - EGW00215
  - 초당 거래건수 초과
  - kis-throttle
related_tasks:
  - "[[T-012-zero-price-snapshot]]"
  - "[[T-015-disable-auto-exit-engine]]"
  - "[[T-005-next15-upgrade]]"
---

# T-017 · KIS 초당 요청 유량 제어 (EGW00201/EGW00215 해소)

## 문제 — 실측

KIS 가 `EGW00201`/`EGW00215`("초당 거래건수를 초과하였습니다")를 상시 반환한다.

| 지표 | 값 | 출처 |
|---|---|---|
| 누적 발생 | **2,750건** (`EGW00201` 2,237 + `EGW00215` 513) | `~/.node-local/stockinvest/logs/pm2-err.log` |
| 과거 일일 | 24~32건/일 | 07-28 ~ 08-08 |
| **오늘(08-10)** | **521건** | 하루 만에 16배 |
| 시각 분포 | 24시간 **고르게** 발생 (시간당 17~55건) | 장중·장외 무관 |
| 초 단위 분포 | 오늘분 521건 중 **461건(88%)이 `:08`~`:10`초** | — |

### ⚠️ 초기 가설 수정 — `:09` 집중의 범인은 cron 이 아니라 **대시보드다**

착수 시 가설은 "`cron-runner.sh` 가 `entry-watcher` 와 `holding-checker` 를 같은 초에 연달아
쏜다"였다. **실측 결과 이 가설은 오늘의 스파이크를 설명하지 못한다.**

1. **`holding-checker` 는 KIS 를 한 번도 호출하지 않는다.** import 가 `db`·`cron-auth`·`notify`
   뿐이다(시세·잔고 조회 없음). 같은 초에 두 번 쏜다는 그림 자체가 성립하지 않는다.
2. **cron 의 `entry-watcher` 완료 초는 `:09` 가 아니다.** 오늘 분포는 `:00`~`:03` 에 몰려 있고
   회차마다 표류한다(작업시간 + `sleep 60` 이라 초가 밀린다). `:09` 는 상위에 없다.
3. **`:09` 에 찍히는 것은 `/api/portfolio` 다.** 오늘 `[api/portfolio]` 에러 366건 중
   **361건(99%)이 `:09`/`:10`** 에 있다.
   원인은 **브라우저의 백그라운드 탭 타이머 클램프**다 — `Dashboard.tsx` 는
   `REFRESH_MS = 30_000` 으로 폴링하지만, 탭이 백그라운드로 내려가면 브라우저가
   `setInterval` 을 **60초로 클램프**한다. 그래서 주기가 60초로 고정되고 특정 초에 계속
   재정렬돼 한 자리에 쌓인다. (초기 가설은 "30초 폴링이 우연히 정렬됐다"였으나, 그렇다면
   `:39` 에도 같은 양이 찍혀야 하는데 실제로는 없다. reviewer 정정 반영.)

오늘 에러의 발생 지점(메시지별 집계) — **대시보드 경로가 지배적이다**:

| 메시지 | 건수 | 경로 |
|---|---|---|
| `[api/portfolio] 잔고 부분 실패` | **213** | 대시보드 폴링 |
| `[kis] domestic balances failed` | 155 | (위의 하위 로그 포함) |
| `[kis] overseas balances failed` | 129 | (위의 하위 로그 포함) |
| `[portfolio-total] 잔고 조회 실패` | 23 | 주문 한도 산정 |
| `[engine] domestic 잔고 조회 실패` | 13 | strategy-eval 틱 |

→ **결론은 바뀌지 않는다.** 어느 쪽이든 원인은 "통제되지 않은 동시 팬아웃"이고, 해법도 같다.
다만 **우선 조치 대상이 cron 오프셋이 아니라 `/api/portfolio` 팬아웃**이라는 점이 달라진다.
그래서 `cron-runner.sh` 는 건드리지 않고, `/api/portfolio` 에 `bulk` lane + 동시성 제한을 넣었다.

### 근본 원인 — "총량"이 아니라 **통제되지 않은 동시성**

논리적 조회 1건이 여러 요청으로 팬아웃되고, 전부 `Promise.all`/`Promise.allSettled` 로
**동시** 발사됐다. 어디에도 페이싱이 없었다.

| 경로 | 순간 발사량 | 근거 |
|---|---|---|
| 잔고 1회 | 2~3 (국내 1 + 해외 1~2) | `kis.ts:getBalancesDetailed` `Promise.all` |
| `/api/portfolio` | 잔고 + 보유종목 16~20 **×2 화면 ≈ 40** | `Dashboard.tsx`·`TradingBoard.tsx` 가 **각자** 호출하고 중복 제거가 없다 (그 외 `ScenarioDetail`·`ScenarioBuilder` 도 호출) |
| `universe.ts` | **150** | `UNIVERSE_TOP_N = 150`, `Promise.all(top20.map(...))` |
| `/api/health` | 최대 4배 증폭 | 무인증. 한도 4건이 전부 `portfolio-total` 로 수렴, in-flight 중복 제거 없음 |

즉 순간 유량이 초당 수십~수백 건으로 튀었다. **어떤 한도든 넘는다.**

### 두 번째 결함 — 재시도 증폭

레이트리밋은 **HTTP 500 + 본문 `msg_cd:"EGW00201"`** 로 온다. 그런데
`kis-domestic.getTicker` 는 `res.status === 500` 만 보고 300ms 뒤 재시도했다.
→ **레이트리밋을 맞을 때마다 곧바로 한 번 더 때려서 과부하를 스스로 키웠다.**

## 사전 확인 — 단일 프로세스인가 (in-memory 스로틀의 전제)

프로세스 밖 카운터(Redis 등) 없이 in-memory 버킷이 **전역적으로** 옳으려면 KIS 를 호출하는
프로세스가 정확히 하나여야 한다. 실측으로 확인했다:

| 확인 | 결과 |
|---|---|
| `pm2 describe stockinvest` | `exec mode: cluster_mode`, **`instances: 1`** |
| `ps -eo pid,args \| grep next-server` | stockinvest 용 `next-server` **정확히 1개** (pid 659688) |
| `stockinvest-cron` | bash 루프. KIS 직접 호출 없음 — `curl localhost:3003/api/cron/*` 로 위 단일 프로세스에 위임 |
| 자매 프로젝트 `TradingInvest` | `grep -rl "koreainvestment\|KIS_APP_KEY" TradingInvest/src` → **0건** (코인원 전용) |
| KIS 앱키 | `system_config.cred_KIS_APP_KEY` 단일 계정 (사용자별 앱키 아님) |

→ **단일 프로세스 확정. in-memory 스로틀이 전 트래픽을 덮는다.**

⚠️ **`instances` 를 2 이상으로 올리는 순간 이 전제가 깨진다** — 그때는 버킷이 트래픽의 1/N 만
통제한다. 이 경고는 `kis-throttle.ts` 상단 주석에도 박아 두었다.

## 설계

### 1. 단일 관문 — `kisFetch()`

호출 지점 16곳을 각각 손보는 대신 **길목 하나를 만들고 전원을 통과**시켰다.

```
모든 KIS 요청
  → kisFetch()            (src/lib/exchanges/kis-http.ts)
      ├ acquireKisSlot()  (src/lib/exchanges/kis-throttle.ts) — 토큰 버킷·우선순위·유한 대기열
      ├ 타임아웃 타이머    — **토큰 획득 이후**에 건다
      └ 레이트리밋 식별   — 백오프 후 재대기열 (즉시 재시도 금지)
```

**모든 KIS 트래픽이 여기를 지난다는 증거** — `src` 전체에서 KIS 호스트로 나가는 `fetch(` 를
검색하면 0건이다(`kisFetch` 제외). 관문에 합류시킨 호출 지점:

| 파일 | 호출 |
|---|---|
| `kis-auth.ts` | `tokenP` (토큰 발급) |
| `kis-domestic.ts` | getTicker · getDailyCandles · getMinuteCandles · getBalances · **createOrder** · **cancelOrder** · marketCapRanking · getActiveOrders · getCompletedOrders |
| `kis-overseas.ts` | getTicker · getDailyCandles · usdCash · getBalances · **createOrder** · **cancelOrder** · getActiveOrders · getCompletedOrders |
| `/api/ticker/all` | search-info (어댑터 우회 경로였음) |
| `/api/symbols/lookup` | search-info (어댑터 우회 경로였음) |
| `/api/symbols/search` | search-info (어댑터 우회 경로였음) |

> 라우트 3곳은 어댑터를 거치지 않고 **직접 KIS 를 부르고 있었다.** 어댑터만 고쳤다면 그대로
> 새어 나갔을 트래픽이다.

**의도적 제외 — `src/lib/auth/kis-verify.ts`**: 회원이 입력한 **남의 앱키**로 `tokenP` 를
호출한다. KIS 유량 한도는 앱키 단위라 서로 다른 통이며, 같은 버킷에 넣으면 회원 한 명의
검증 시도가 라이브 엔진의 유량을 갉아먹는다. 사용자 버튼 클릭으로만 발생하고 `EGW00133`
(1분당 1회)을 KIS 가 직접 강제한다. 사유는 해당 파일 상단 주석에 기록.

### 2. 유량 값 — **검증되지 않은 추정치임을 명시**

> 🔺 **코드베이스·주석·`agent-vault/` 전체를 검색했으나 KIS 의 실제 허용 초당 요청수를 기록한
> 문서는 이 저장소에 존재하지 않는다.** 따라서 초기값 **5 req/s** 는 "알려진 한도"가 아니라
> 아래 근거로 고른 **보수적 출발점**이며, 실측 후 올려야 하는 값이다. 이 사실은
> `kis-throttle.ts`·`db.ts`·설정 API 응답 문구에 모두 박아 두었다.

고른 근거 — 위·아래 양쪽에서 조인 값이다:

1. **위쪽(안전) 마진**: 현재 에러는 순간 20~150건 동시 발사에서 나온다. 5 req/s 는 그 버스트를
   완전히 제거한다. 실제 한도가 얼마든 5 req/s 가 그보다 낮을 개연성이 높다.
2. **아래쪽(지연) 한계**: 아래 §지연 예산 참조. 5 미만으로 내리면 `entry-watcher` 의 60초 주기가
   눈에 띄게 늘어난다.
3. 즉 5는 "가장 낮은 값"이 아니라 **버스트를 없애면서 cron 주기를 망가뜨리지 않는 가장 낮은 값**.

**재배포 없이 조정**: `system_config.kis_rate_limit_per_sec` → 없으면 env
`KIS_RATE_LIMIT_PER_SEC` → 없으면 코드 기본값 5. 변경은 **최대 15초 안에** 반영된다
(hot path 를 블록하지 않도록 백그라운드 재조회 + 캐시). 지원 경로는
`PATCH /api/settings/safety { "kisRateLimitPerSec": 8 }` (0.2~50 범위 검증 + 변경 로그).
판독기에도 `clampRatePerSec` 방어가 있어 `0`·`500` 같은 오타가 시스템을 멈추거나 레이트리밋을
되살리지 않는다.

### 3. 우선순위 lane — 주문이 대량 스캔 뒤에 서지 않는다

| lane | 대기열 상한 | 배정 |
|---|---|---|
| `critical` | 64 | 주문 송신·취소, 토큰 발급, **주문을 게이팅하는 잔고 조회** |
| `normal` | 192 | 단건 시세, `entry-watcher`, UI 조회 (기본값) |
| `bulk` | 640 | strategy-eval 틱 전체, universe 스캔, RS 갱신, `/api/portfolio` 팬아웃, signal-followup |

lane 배열이 분리돼 있어 **bulk 가 넘쳐도 critical/normal 의 대기 자리를 잠식하지 못한다.**
토큰이 생기면 항상 critical → normal → bulk 순으로 배분한다.

lane 전달은 `AsyncLocalStorage` 기반 `withKisPriority()` — 중간 계층에 인자를 뚫지 않아도
비동기 하위 전체가 상속한다(새 호출 경로가 생겨도 자동). 신규 의존성 없음(Node 코어).

## 안전성 검토 — 스로틀 자체가 만드는 실패 모드

### ① 주문이 대량 스캔 뒤에 서는가 → **아니다. 면제가 아니라 최우선 순위를 줬다.**

방어가 두 겹이다.
1. `submitOrder()` **전 구간**을 `withKisPriority('critical')` 로 감쌌다. 주문이 나가기까지
   KIS 를 두 번 타는데 — ①5~6단계 한도 산정(`getEffectiveOrderMax/DailyMax` → `portfolio-total`
   → **잔고+시세**), ②8단계 `realSubmit` — ①이 스캔 뒤에 서면 주문 자체가 그만큼 늦는다. 즉
   **주문을 게이팅하는 잔고 조회도 주문의 일부**로 취급했다.
2. `createOrder`/`cancelOrder` 는 호출 지점에서 `priority:'critical'` 을 **명시**한다. 주변
   컨텍스트가 `bulk` 여도(strategy-eval 틱 안의 청산 주문) 강등되지 않는다.

**면제(유량 상한 자체를 벗어남)를 택하지 않은 이유**: 면제는 레이트리밋을 다시 유발할 수 있고,
하필 그 대상이 주문이면 최악이다. 주문은 빈도가 낮아(하루 수십 건) 우선순위만으로 사실상 즉시
통과한다 — 실측상 대기 중인 스캔이 20건 있어도 주문이 **첫 번째로** 나간다(테스트로 고정).

### ② cron 오버런 — 겹쳐 쌓이는가 → **구조적으로 불가능. 다만 주기가 늘어난다.**

`cron-runner.sh` 는 **직렬 bash 루프**다(`call` 이 blocking curl, 끝난 뒤 `sleep 60`).
따라서 실행이 겹치거나 쌓이는 일은 일어나지 않는다. 대신 **주기가 늘어난다**:
`entry-watcher` 간격 = 60초 + 그 회차의 작업 시간.

실측 기준선(직전 24시간, cron-out.log 7,350 회차):

| 항목 | p50 | p90 | 최대 |
|---|---|---|---|
| `entry-watcher` 주기 | 60초 | 61초 | **138초** |
| `strategy-eval` 소요 | 0초(장외) | 13초 | 77초 |
| `rs-update-domestic` | 26초 | 74초 | 74초 |

**5 req/s 에서의 예상 지연** (요청 수는 실측 `ran=25~36` 종목 × 2~3요청 기준):

| cron | 요청 수 | 5 req/s 소요 | 현재 실측 | 판정 |
|---|---|---|---|---|
| `entry-watcher` (1분) | 시그널당 1 + 주문 시 소수 — 통상 < 10 | **~2초** | ~0초 | ✅ 무시 가능 |
| `holding-checker` (1분) | **0** (KIS 미호출 — import 가 DB·notify 뿐) | 0초 | 0초 | ✅ 영향 없음 |
| `strategy-eval` 통상틱 (5분) | ~120 | **~24초** | 7~12초 | ✅ 예산 300초 |
| `strategy-eval` universe 갱신틱 (15분) | ~470 (국내 152 + 해외 ~200 + 평가 120) | **~94초** | 30~56초 | ✅ 예산 300초 |
| `signal-followup` (15분) | ≤ 50 | ~10초 | 0~8초 | ✅ |
| `rs-update` (1일 1회) | ≤ 250 (이미 순차 100ms) | 변화 없음 | 74초 | ✅ |

**최악 회차의 `entry-watcher` 주기**: 60 + 94 + 2 ≈ **156초**.
다만 reviewer 지적대로 이는 낙관적이다 — 15분 주기 잡들이 같은 회차에 겹치면
**~175~180초**까지 간다(현재 실측 최대 138초 대비 약 +30%).
5분마다 1회, 그중 15분마다 1회만 이 수준이고 나머지 회차는 60~85초다.
→ **예산 내지만 여유가 크지 않다.** T-017 이 감수한 가장 큰 트레이드오프이므로 QA 는 배포 후
`entry-watcher` 주기 분포(p90/최대)를 반드시 재측정할 것. 구조적 개선은 위 **M-3** 참조.

**보상 요인**: 지금은 `entry-watcher` **자신의** `getTicker` 가 `EGW00201` 로 실패해
`price_fetch_failed` 로 회차를 통째로 날리고 있다. 몇 초 늦더라도 성공하는 편이 낫다.

### ③ 대기열은 유한한가 → **유한. 가득 차면 기다리지 않고 즉시 실패한다.**

무한 대기열은 "요청 과다"를 **"무한 지연"으로 바꿔치기**할 뿐이고, 매매 시스템에서 무한 지연은
조용한 실패다. lane 별 상한(64/192/640)을 넘으면 `KisThrottleQueueFullError` 를 **즉시** 던진다
(실측 <50ms, 테스트로 고정). 오류 메시지에 원인과 조정 키(`kis_rate_limit_per_sec`)를 담아
"조용한 빈 결과"와 구분되게 했다. `isKisThrottleQueueFull()` 로 프로그램적 식별도 가능.

### ④ 타임아웃 상호작용 → **타이머를 토큰 획득 이후로 옮겼다.**

기존 타임아웃을 전수 조사했다.

| 위치 | 기존 | 조치 |
|---|---|---|
| `kis-overseas.getTicker` | 5초 `AbortController` (대기 전 시작) | `kisFetch({timeoutMs:5000})` — **토큰 획득 후** 계측 |
| `/api/symbols/search` | 4초 `AbortSignal.timeout` (생성 시점부터) | `kisFetch({timeoutMs:4000})` — 동일 |
| 그 외 KIS 호출 | 타임아웃 없음 | **없는 채로 유지** (기본값 무제한) |
| `cron-runner.sh` `call()` | `--max-time` 없음 | 변경 없음 — cron 은 무제한 대기라 잘림 없음 |
| `/api/settings/credentials/test` `fetchWithRetry` 10초 | Telegram/Slack 전용 (KIS 아님) | 변경 없음 |

타이머를 대기 **전에** 걸면 "5초 타임아웃"이 "대기+통신 합쳐 5초"가 돼 스로틀이 만든 대기가
그대로 새 실패 모드가 된다. 없던 곳에 타임아웃을 **새로 도입하지 않은** 것도 의도적이다 —
범위를 넘는 회귀를 만들지 않기 위함.

### ⑤ T-014 잔고 실패 처리와 충돌하는가 → **충돌 없음. 경로를 그대로 탄다.**

- 스로틀 대기열 초과/레이트리밋은 어댑터에서 **throw** 된다 → `getBalancesDetailed()` 가
  `failed[]` 에 담는다 → `complete:false` → `kis.getBalances()` 가 `BalancesIncompleteError`
  → engine 의 `getHeldAmounts()` 가 **`{known:false}`** 를 반환한다.
- 즉 **"스로틀 때문에 못 읽었다"가 "보유 없음"으로 읽히는 경로는 없다.** 빈 배열로 바뀌는
  지점이 새로 생기지 않았다(어댑터의 throw 계약을 건드리지 않았다).
- `checkSnapshotFreshness` · 스냅샷 기록기 · 킬스위치 기준선 로직은 **한 줄도 건드리지 않았다.**
- 회귀 테스트 `kis-balances-partial.test.ts`(T-012) · `engine-balances-unknown.test.ts`(T-014) ·
  `engine-exit-disabled.test.ts`(T-015) 전부 통과.
- 추가로 `portfolio-total-dedup.test.ts` 에 T-012 계약("실패 시 낮은 총액으로 대체하지 않고
  직전 캐시 유지")을 **재확인하는 테스트**를 넣었다.

### ⑥ `tokenP` 의 1분당 1회 제한과 이중 계산되는가 → **아니다.**

- `tokenP` 는 `critical` lane 으로 관문을 지난다(초당 유량만 소비, 1건). 굶지 않는다 —
  토큰이 없으면 다른 모든 KIS 호출이 막히므로 최우선이어야 한다.
- `EGW00133`("1분당 1회")은 `kis-http` 의 레이트리밋 패턴(`EGW00201|EGW00215|초당 거래건수`)에
  **일부러 넣지 않았다.** 따라서 `kisFetch` 가 백오프하지 않고, 기존
  `issueAndStore` 의 60초 대기 분기가 그대로 유일한 처리자다. **이중 백오프 없음**(테스트로 고정).
- `invalidateKisToken()` 의 `refreshInFlight` 단일화도 손대지 않았다.

## Reviewer 지적 반영 (PASS WITH FINDINGS → 재작업)

### HIGH-1 — `strategy-eval` 라우트가 **안전 경로를 강등**하고 있었다 ✅ 수정

`runAll` 전체를 `withKisPriority('bulk')` 로 감쌌던 것이 잘못이었다. 무거운 배치는
**이미 자기 함수 안에서 `bulk` 를 선언**하므로(`refreshUniverse`·`updateRsRatings`),
래퍼가 실제로 강등시킨 것은 배치가 아니라:

- `getHeldAmounts()` — T-014 가 굳힌 잔고 조회
- `runExitEngine()` — 하드손절·EOD손절·트레일링스탑 발화 판단

즉 **손절 판단이 universe 스캔 뒤에 줄 서는 구조**였다.

> **"지금 exit-engine 은 꺼져 있으니 나중에" 가 통하지 않는 이유**: [[T-015]] 는 재활성화를
> `system_config.exit_engine_enabled` **런타임 판독**으로 만들었다 — 값 하나로 배포 없이
> 즉시 살아난다. 그 사이에 이 결함을 걸러낼 **배포 게이트가 없다.** 사용자가 "보호를
> 되살렸다"고 믿는 바로 그 순간 손절 평가가 최하위 lane 에서 돌게 된다.

**조치**: 라우트의 lane 래퍼를 **제거**했다(기본 `normal`). 배치는 자기 선언을 유지하므로
잃는 것이 없다. 실주문은 `submitOrder`(critical) + 호출 지점 `priority:'critical'` 명시로
이미 보호되므로 라우트에서 lane 을 지정할 이유 자체가 없었다.
**회귀 방지**: `src/app/api/cron/__tests__/strategy-eval-lane.test.ts` 가 `runAll` 실행 시점의
lane 이 `bulk` 가 아님을 고정한다(exit-engine on/off 와 무관하게).

### HIGH-2 — 대기 자체에 데드라인이 없어 **cron 루프가 무한 정지**할 수 있었다 ✅ 수정

타임아웃을 토큰 획득 **이후**에 거는 설계는 옳지만, 뒤집으면 "토큰을 기다리는 동안에는
아무 타임아웃도 없다"가 된다. `cron-runner.sh` 는 `--max-time` 없는 blocking curl 을
**직렬로** 도는 루프이므로, 요청 하나가 영원히 기다리면 **그 잡 하나가 아니라 cron 루프
전체가 조용히 멈춘다.** 오늘 유량에서는 확률이 낮지만, **유량 값을 올리거나 사용자를 늘리는
것이 명시적 계획**이므로 그때 절벽이 된다.

**조치**: `acquireKisSlot(priority, { maxWaitMs })` — 기본 **30초** 데드라인.

| 실패 | 의미 | 시점 |
|---|---|---|
| `KisThrottleQueueFullError` | 줄이 꽉 차서 **서지도 못했다** | 즉시 |
| `KisThrottleTimeoutError` | 줄에 섰는데 **차례가 오지 않았다** | 대기 후 |

둘을 섞지 않는다 — 전자는 호출량을, 후자는 유량 설정을 의심해야 하므로 대응이 다르다.
`isKisThrottleTimeout()` / `isKisThrottleQueueFull()` / `isKisThrottleFailure()` 로 식별한다.

- **빈 결과로 퇴화하지 않는다**: 만료는 `throw` 되어 어댑터 → `getBalancesDetailed().failed[]`
  → `BalancesIncompleteError` → `{known:false}` 경로를 그대로 탄다.
  테스트로 고정(`kis-order-priority.test.ts`): 국내·해외 잔고 모두 두 오류에 대해 **reject**
  하며 빈 배열을 돌려주지 않는다.
- **조용하지 않다**: 만료 시 `console.error` 로 lane·대기시간·유량·lane별 대기열 스냅샷·조치
  방법(`kis_rate_limit_per_sec`)을 남긴다. 테스트로 문구를 고정했다.
- 만료된 대기자는 큐에서 **제거**되어 토큰을 낭비하지 않는다(테스트로 고정).
- `getKisThrottleStats().timedOut` 으로 누적 집계 노출 — 0 이 아니면 유량 부족 신호다.

## 변경 파일

| 파일 | 내용 |
|---|---|
| `src/lib/exchanges/kis-throttle.ts` **(신규)** | 토큰 버킷 + 우선순위 lane + 유한 대기열 + **대기 데드라인(HIGH-2)** + 런타임 설정 판독 + `withKisPriority`(AsyncLocalStorage) + `mapWithLimit` |
| `src/lib/exchanges/kis-http.ts` **(신규)** | 단일 관문 `kisFetch`. 토큰 획득 후 타임아웃 + **대기 데드라인 `maxWaitMs`**, 레이트리밋 식별·백오프·재대기열, 본문 재생(replay), `isKisRateLimited`/`kisBodyText` |
| `src/lib/exchanges/kis-auth.ts` | `tokenP` → `kisFetch(critical)`. EGW00133 분기 불변 |
| `src/lib/exchanges/kis-domestic.ts` | 9개 호출 전부 `kisFetch` 경유. **getTicker 재시도 증폭 제거**. 주문·취소 `critical` 명시. `getKisTickers` 동시성 제한 |
| `src/lib/exchanges/kis-overseas.ts` | 8개 호출 전부 `kisFetch` 경유. getTicker 타임아웃 이관 + 레이트리밋 재시도 금지. 주문·취소 `critical` 명시. `getKisOverseasTickers` 동시성 제한 |
| `src/app/api/ticker/all/route.ts` | 어댑터 우회 KIS 호출 → `kisFetch`. 이름 보강 팬아웃 `bulk` + 동시성 제한 |
| `src/app/api/symbols/lookup/route.ts` | 어댑터 우회 KIS 호출 → `kisFetch` |
| `src/app/api/symbols/search/route.ts` | 어댑터 우회 KIS 호출 → `kisFetch`, 4초 타임아웃 이관 |
| `src/lib/safety/dry-run.ts` | `submitOrder` 전 구간 `withKisPriority('critical')` |
| `src/lib/safety/portfolio-total.ts` | **in-flight 중복 제거** + 시세 실패 로깅(무음 제거) + `isPortfolioTotalFetchInFlight` |
| `src/app/api/portfolio/route.ts` | 보유종목 시세 팬아웃 `bulk` + 동시성 4 |
| `src/lib/strategy/universe.ts` | `refreshUniverse` 전체 `bulk`, 150건 동시 발사 → 동시성 4 |
| `src/lib/strategy/rs-rating.ts` | `updateRsRatings` `bulk` |
| `src/app/api/cron/strategy-eval/route.ts` | **(HIGH-1)** lane 래퍼 **제거** — 안전 경로 강등 방지. 재발 금지 사유를 주석으로 고정 |
| `src/app/api/cron/signal-followup/route.ts` | 시세 루프 `bulk` |
| `src/lib/db.ts` | `kis_rate_limit_per_sec` 부팅 시드(INSERT IGNORE, `'5'`) + 부팅 로그 |
| `src/app/api/settings/safety/route.ts` | GET 노출 + PATCH 허용 키 + 0.2~50 수치 검증 + 변경 감사 로그 |
| `src/lib/auth/kis-verify.ts` | 주석만 — 스로틀 **의도적 제외** 사유 기록 |
| `src/lib/exchanges/__tests__/kis-throttle.test.ts` **(신규)** | 33건 (유량·우선순위·유한 대기열 26 + **HIGH-2** 대기 데드라인 7) |
| `src/lib/exchanges/__tests__/kis-http.test.ts` **(신규)** | 23건 |
| `src/lib/exchanges/__tests__/kis-order-priority.test.ts` **(신규)** | 13건 (주문 lane 8 + **HIGH-2** 스로틀 실패의 T-014 계약 5) |
| `src/app/api/cron/__tests__/strategy-eval-lane.test.ts` **(신규)** | 3건 — **HIGH-1** 회귀 방지 |
| `src/lib/safety/__tests__/portfolio-total-dedup.test.ts` **(신규)** | 8건 |

## 검증

```
npm run typecheck  → exit 0
npm test           → 85 suites / 1241 tests, 전부 통과
                     (원 baseline 80/1161 → +5 suites, +80 tests, 회귀 0)
                     (reviewer 재작업 전 84/1226 → +1 suite, +15 tests)
```

신규 테스트가 고정한 계약:
- **유량**: 설정한 초당 요청수대로 배분 / 버스트 용량만큼만 즉시 통과 / 150건 동시 발사가 평탄화
- **재시도 증폭 금지**: 레이트리밋은 즉시 재시도 없음(최소 400ms 백오프) · 재시도마다 토큰 재소비
  (대기열 우회 금지) · 진짜 5xx 는 `kisFetch` 가 재시도하지 않음(호출부 로직 보존) ·
  `EGW00133` 은 레이트리밋으로 취급 안 함
- **유한 대기열**: 상한 초과 시 즉시(<50ms) `KisThrottleQueueFullError` · 식별 가능한 오류 ·
  bulk 가 가득 차도 critical 은 거절되지 않음(lane 격리)
- **우선순위**: 20건 스캔이 밀려 있어도 주문이 첫 번째 · critical→normal→bulk 순 ·
  bulk 컨텍스트에서도 주문 강등 안 됨
- **in-flight 중복 제거**: `/api/health` 패턴 4건 동시 호출 → 잔고 조회 1회, 시세 팬아웃 1회분
- **T-012/T-014 회귀 방지**: 잔고 실패 시 낮은 총액으로 대체하지 않고 직전 캐시 유지 ·
  **스로틀이 만든 두 실패(대기열 초과·대기 시간 초과)도 빈 배열이 아니라 throw**
- **대기 데드라인(HIGH-2)**: 30초 기본 · QueueFull 과 별개 오류로 식별 · `console.error` 로 크게
  기록 · 만료 대기자는 큐에서 제거되어 토큰 낭비 없음 · 제때 오면 미발동
- **lane 강등 금지(HIGH-1)**: `strategy-eval` 의 `runAll` 이 `bulk` 가 아닌 lane 에서 실행

## 남긴 것 (의도적으로 하지 않음)

- **커밋·푸시 없음.** 작업 트리에 그대로 두었다 (승인 대기).
- **DB 수기 변경 없음.** `kis_rate_limit_per_sec` 은 `db.ts` 의 부팅 `INSERT IGNORE` 로만 생긴다.
- **신규 의존성 없음.** `AsyncLocalStorage` 는 Node 코어(`node:async_hooks`).
- **`npm run build`/`install`/`dev` 미실행, pm2 미조작.** 검증은 `typecheck` + `test` 만.
- **`cron-runner.sh` 미변경.** 위 §가설 수정대로 `:09` 스파이크의 원인이 아니었다
  (`holding-checker` 는 KIS 를 호출조차 하지 않는다). 오프셋을 넣을 이유가 실측으로 사라졌다.
- **`UNIVERSE_TOP_N=150` 자체는 줄이지 않았다.** 전략 품질에 영향을 주는 값이라 이번 범위 밖.
  동시성만 제한했다.

## 후속 — 사용자가 해야 할 일

1. **배포 후 24시간 관측**: `grep -c "EGW00201\|EGW00215" ~/.node-local/stockinvest/logs/pm2-err.log`
   → 0 에 수렴하는지. 그리고 `entry-watcher` 주기 분포(p90/최대)가 위 예측 범위인지.
2. **유량 단계적 상향**: 5 → 8 → 12 → 15 … 각 단계 최소 1일 관측. 재배포 불필요:
   `PATCH /api/settings/safety {"kisRateLimitPerSec": 8}` (최대 15초 내 반영).
   ⚠️ **KIS 의 실제 한도는 여전히 모른다.** 올린 뒤 `EGW00201` 이 다시 나오면 그 직전 값이
   경험적 상한이다 — 그 값을 이 문서에 기록할 것.
3. **`pm2 instances` 를 절대 2 이상으로 올리지 말 것** (올릴 거라면 스로틀을 프로세스 밖으로 이관).

## 📋 백로그 이관 대상 (reviewer MEDIUM ×3 — **이번 변경 범위에 포함하지 않음**)

> Leader 에게: 아래 3건은 `board.md` Backlog 로 옮겨 주세요. 다른 세션과의 쓰기 충돌을 피하려고
> developer 는 `board.md` 를 직접 건드리지 않았습니다.

### M-1. 주문이 in-flight `bulk` 조회에 편승해 지연될 수 있다 (지연이지, 거부는 아님)

`portfolio-total.ts` 의 in-flight 중복 제거는 **먼저 시작한 호출의 lane 을 그대로 물려준다.**
`bulk` 컨텍스트(예: `/api/portfolio` 팬아웃)가 이미 조회를 시작한 상태에서 주문이 들어오면,
주문의 `critical` 한도 산정이 **그 bulk 조회가 끝나기를** 기다린다 — 최대 수 초.
거부가 아니라 지연이고 오늘 유량에서는 작지만, 유량을 올리기 전에 정리하는 것이 맞다.
**수정 위치**: `src/lib/safety/portfolio-total.ts` — lane 별로 in-flight 를 분리하거나,
`critical` 진입 시 기존 in-flight 에 편승하지 않고 별도 조회를 띄우는 방식.

### M-2. `order-sync.ts` 의 `getActiveOrders` 실패가 이중으로 삼켜진다 (T-014 와 같은 계열, **선행 결함**)

`kis.getActiveOrders()` 는 `.catch(() => [])` 로, `kis-domestic/overseas.getActiveOrders()` 는
`catch { return [] }` 로 **두 번** 실패를 빈 배열로 만든다. 그 결과 조회 실패가
"미체결 주문 없음"으로 읽혀 **살아 있는 지정가 주문이 DB 에 `cancelled` 로 잘못 기록**될 수 있다.
정확히 T-014 가 잔고에서 제거한 그 패턴이고, **이번에 추가된 `KisThrottleQueueFullError`·
`KisThrottleTimeoutError` 가 새로운 트리거가 된다.**
**수정 방향**: 두 `catch` 를 걷어내고 fail-closed(실패 시 동기화 자체를 건너뜀)로.

### M-3. cron 최악 지연 과소 추정 + 루프가 "분"이 아니라 "회차"를 센다 (**선행 구조 결함**)

- 아래 §지연 예산의 최악값 **156초는 낙관적이다.** 15분 주기 잡(universe 갱신)과 다른 잡이
  같은 회차에 겹치면 **~175~180초**가 된다.
- 더 근본적으로 `cron-runner.sh` 는 `i` 를 **회차**로 세고 매 회차 끝에 `sleep 60` 한다.
  따라서 "5분마다 strategy-eval" 은 실제로는 "**5회차마다**"이고, 회차 길이가 늘어날수록
  주기가 **누적해서** 늘어난다(장중 부하 시 실측으로도 표류가 보인다).
  스로틀이 회차를 늘리므로 이 표류가 **더 커진다.**
- **수정 방향**: 벽시계 기준 스케줄링(`date +%M` 기반 분기) 또는 systemd timer.

## 발견했으나 고치지 않은 것 (별도 판단 필요)

- **`portfolio-total` 콜드 캐시 실패가 0/0/0 을 60초간 캐시한다** (T-017 이전부터 그랬다).
  그 사이 주문 한도 pct 가 0 이 돼 신규 매수가 막힌다. 방향은 안전한 쪽(fail-safe)이지만,
  [[T-005-next15-upgrade]] 가 지적한 "레이트리밋 → 잔고 실패 → 한도 0 → 매수 차단" 사슬의
  마지막 고리다. **이번 스로틀이 잔고 실패 자체를 없애면 이 고리도 사실상 닫힌다**는 것이
  현재 판단이라 별도 수정은 하지 않았다. 관측 후 재평가할 것.
- **`/api/health` 가 무인증인 채로 잔고·시세 팬아웃을 유발한다.** in-flight 중복 제거로 4배
  증폭은 제거했지만, 외부에서 반복 호출하면 여전히 60초마다 1회분이 나간다. 인증 또는
  캐시 전용 응답 검토 필요 — 이번 범위 밖.

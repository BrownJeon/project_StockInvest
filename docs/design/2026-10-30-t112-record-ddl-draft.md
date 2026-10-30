# T-112 실행·판단 기록 — DDL 초안 (문서 단계)

작성: 2026-10-30 11:5x KST · T-112 Developer · **상태: 초안 — 적용 금지.** DDL 은 이 문서 안 코드블록뿐이다. `scripts/migrations/` 에 파일을 만들지 않았고, 코드·운영 DB·설정·크론은 바꾸지 않았으며, 운영 DB 를 조회하지 않았다(U6 대기).

입력(정본 순): [2차 설계서](2026-10-28-corporate-intelligence-second-design.md) §9.5(`job_run_log` 확정안 — 이 문서의 정본 입력)·§9.4(J1~J9)·§7 단계 3·§2.6·§6.3·§6.8 · [공동 인계서](../../agent-vault/10-Flow/handoffs/2026-10-28-joint-collection-integration-and-menu-home-handoff.md) §4·§5·D-1~D-3·§11 · [통합 계획](2026-10-28-collection-menu-integrated-plan.md) §3·§5 · [[T-104-cron-jobs-market-grouping]] ★절·「C 설계」 · [[T-108-automation-menu-home-overhaul]] 10-28 17:09 결정 · [[T-112-run-judgment-record-foundation]].
기준: 저장소 HEAD `c2fedaf`(2026-10-30 11:07). 소스는 이 시점 작업 트리에서 읽었다.

확신 표기: **[확실]** 이번 세션에서 직접 읽거나 실행해 확인 · **[가능성 높음]** 강한 추론 · **[추측]** 가정·추정치.

---

## 0. 먼저 읽는 요약

**불편한 사실 (먼저)**

1. **§9.5 대로 `call()` 안에서 기록 라우트로 바로 POST 하면 가장 무거운 틱이 순찰 한도(300초)를 넘을 수 있다 [가능성 높음].** 08시 틱의 최악은 이미 290초다(러너 주석: 해외 분석 120 + KIS 스냅샷 60 + 매 분 잡 30 + stop-alert 20 + sleep 60 — [확실]). 앱이 느린 그 순간에 기록 POST 가 한 번에 2초 상한씩 최대 약 10번 붙으면 약 +20초가 된다 [추측]. 그래서 이 초안은 **"로컬 스풀 파일에 한 줄 쓰기 + 가벼운 틱에서만 일괄 전송"** 을 권고한다(§5.1). §9.5 의 "후크 → 라우트 POST" 와 목적은 같고 전송 시점만 다르다.
2. **§9.5 의 키·어휘를 그대로 쓰면 충돌하거나 쓸 곳이 없는 경우가 있다 [확실: 키 정의로 추론].** ① 매 분 잡의 "실패 즉시 한 줄"과 "시간당 롤업 한 줄"이 같은 `(job_id, scheduled_slot_at, recorder='runner_hook')` 를 가질 수 있다(예: 10:00 틱 실패와 10시 롤업). ② 재대사 잡이 합성하는 `missing` 행을 쓸 `recorder` 값이 없다. ③ 같은 슬롯 재시도(해외 분석 하루 최대 3회)가 한 줄을 덮어쓰면 **재시도 횟수와 첫 시작 시각이 사라진다**. → 초안은 `recorder` 에 2개 값(`runner_rollup`·`reconciler`)과 `attempt` 열을 더하고, `missing` 행을 위해 `started_at` 을 NULL 허용으로 바꿨다(시각을 지어내지 않는다 — 설계서 §4.2). **§9.5 대비 변경 4건**(아래 표) — 승인 전 합의가 필요하다.
3. **기준 판단 기록은 설계서 §3·§7 이 말한 "비차단 기록 호출 1곳"으로 끝나지 않는다 [확실: 엔진 소스].** 후보별 제외 사유를 남기려면 해외 엔진의 거르기 지점 약 12곳, 국내 약 8곳에 메모리 표시를 넣어야 하고, ① 국내 엔진은 분석한 마지막 봉 날짜(D0)를 들고 있지 않으며 ② 카드 생성 함수 `insertScenarioCardIfAbsent` 는 새 카드 id 를 돌려주지 않고(`'created'` 문자열만) ③ `runLlm` 은 실제 쓴 공급자·모델을 돌려주지 않는다. 모두 감시 경로(`src/lib/strategy/`) 수정이다.
4. **후보 제외 사유를 기록하는 기존 테이블 `eval_funnel` 이 이미 있다 [확실: `src/lib/db.ts` 1367행].** 5분 전략 평가용(T-002)이며 장마감 분석은 쓰지 않는다. 30일이 지나면 자동 삭제되고 판단 필드(프롬프트 해시·RAG 문맥·신뢰도)가 없어서 재사용하지 않는다(§3.1). 다만 "메모리에 모았다가 끝에 한 번에 INSERT·실패는 삼킴·행 상한·즉시 끄는 스위치" 패턴은 그대로 따른다.
5. **DDL 문법은 검증하지 못했다.** 서버 `~/.node-local/` 아래에 실행 중인 일회용 MariaDB 가 없었다(`docker ps` 빈 결과). 다른 세션의 임시 `mysqld`(포트 33177, 다른 세션 scratchpad) 하나가 떠 있었지만 남의 시험 자원이고 MariaDB 10.11 인지 확인되지 않아 쓰지 않았다. **문법 미검증.**
6. `export-llm-trainset` 은 `call()` 을 거치지 않는 bash 스크립트라 러너 후크로는 기록되지 않는다 [확실: 러너 519~538행].

**제안 테이블 3개** (모두 `CREATE TABLE IF NOT EXISTS`, 가산 전용, 외래키 없음, 부팅 DDL 미포함)

| 테이블 | 한 줄 | 하루 행 수 [추측] |
|---|---|---|
| `job_run_log` | 크론 잡 실행 1건(또는 매 분 잡 1시간 롤업 1건) = 1행. §9.5 확정안 + 변경 4건 | 약 850(§9.5 규칙) / 약 230(대안: 60분 미만 잡 전부 롤업) |
| `judgment_run` | 장마감 분석 1회 = 1행(시장·세션·시각·후보 수·공급자/모델·프롬프트 해시·RAG 문맥·자료 상태·`judgment_role`) | 2~4 |
| `judgment_candidate` | 그 분석의 종목 1개 = 1행(패턴·제외 사유·LLM 전송 여부·BUY/SKIP·신뢰도·근거·카드 id) | 약 10~60 |

**§9.5 대비 변경 (승인 전 합의 필요)**

| # | 변경 | 이유 | 되돌리면 |
|---|---|---|---|
| D-a | `recorder` 에 `runner_rollup`·`reconciler` 추가 | 롤업 행과 실패 행의 UNIQUE 충돌 방지, `missing` 합성 주체 표시 | 롤업은 슬롯 규칙을 비틀어야 하고 `missing` 의 출처가 섞인다 |
| D-b | `attempt TINYINT UNSIGNED` 추가 | 같은 슬롯 재시도(해외 분석 ≤3회, T-104 E7 재시도 창)를 한 줄로 갱신하면서도 횟수를 남긴다 | 재시도 사실이 사라진다 |
| D-c | `started_at` NULL 허용(`missing` 일 때만, CHECK) | 실행되지 않은 슬롯에 시각을 지어내지 않는다 | `missing` 에 가짜 시각이 들어간다 |
| D-d | `run_id` 를 `BIGINT UNSIGNED` 로 | 이미 적용된 `ci_raw_item.run_id` 가 `BIGINT UNSIGNED` [확실: T-116 SQL 43행] | 조인 열의 부호가 어긋난다 |

---

## 1. 근거와 확인 범위

| 구분 | 내용 |
|---|---|
| 읽은 문서 | T-112 이력서 전문, 2차 설계서 §0·§1·§2.6·§3·§4·§5·§6·§7~§11, 공동 인계서 전문, 통합 계획 전문, T-104 ★절·「C 설계」, T-108 task 전문, T-109 요구 절(21~24행) |
| 읽은 소스 | `scripts/cron-runner.sh` 전문(541행), `src/app/api/cron/post-market-analysis/route.ts`, `src/lib/strategy/post-market-engine.ts`(40~160·300~687행), `post-market-overseas.ts`(550~796행 + 거르기 지점 grep), `src/lib/rag/news-health.ts`(30~70·287~330행), `src/lib/rag/retrieval.ts`(RagContext), `src/lib/rag/m4-kb.ts`(KbHit `id`), `src/lib/llm/provider.ts`(93~198행), `scripts/profit-engine/postmortem-core.js`(진입 모델·지평), `src/lib/strategy/eval-funnel.ts` 머리, `src/lib/db.ts`(signals·eval_funnel 정의), `scripts/migrations/T-116-ci-raw-item.sql`·`T-070-daily-bars.sql`·`T-081`(broker_fill_runs 머리) |
| 실행한 것 | `awk` 로 `SAFETY_PATHS` 확인, 서버 읽기 전용 `ssh`: `docker ps`·`pgrep mysqld`·`bash --version`(5.1.16)·`jq --version`(1.6)·`base64 --version`(coreutils 8.32) |
| 하지 않은 것 | 운영 DB 조회(SELECT 포함), DDL 적용(일회용 포함), 코드·설정 변경, M4·KIS·SEC·LLM 호출, pm2, 커밋 |
| 확인 못 한 것 | 각 cron 라우트의 응답 본문 모양 전수(분류 규칙은 국내/해외 분석만 소스로 확인), `dbq.py` 위치, T-108 지표 계약 초안 전문(11:59 에는 없었고 12:01 에 생겨 §5·§6 만 읽었다 — §4.4), 운영 `sql_mode` |

---

## 2. `job_run_log` DDL 초안

### 2.1 DDL (문법 미검증)

```sql
-- T-112 — 실행·판단 기록 기반 ①: 크론 잡 실행·상태 기록 job_run_log (가산 전용: 기존 테이블 변경 없음)
--
-- ⚠ 초안. 승인 뒤 scripts/migrations/T-112-run-judgment-record.sql 로 옮긴다(이 문서 단계에서는 파일을 만들지 않는다).
-- ⚠ 이 파일은 **앱 부팅 때 실행되지 않는다**(src/lib/db.ts 의 setupDB 에 넣지 않는다). 개발·운영이 같은 NAS MariaDB 라서
--   배포만으로 DDL 이 돌면 "DDL 은 사용자 건별 승인" 원칙(공동 인계서 J2, T-059·T-116 선례)이 무력화되기 때문이다.
--   사용자 승인 후 사람이 직접 적용한다(T-116 과 같은 절차 — 이 문서 §7).
--   적용 직전 `SHOW TABLES LIKE 'job_run_log'` 로 없음을 확인하고, 적용 직후 `SHOW CREATE TABLE job_run_log` 를 task 이력서에 남긴다.
--   CREATE TABLE IF NOT EXISTS 라 두 번 실행해도 안전하다.
--   적용 전에는 기록 코드가 ER_NO_SUCH_TABLE 을 받아 건너뛴다(프로세스당 경고 1회). 크론·분석·주문 동작은 그대로다.
-- 정본: docs/design/2026-10-28-corporate-intelligence-second-design.md §9.5. 차이 4건(D-a~D-d)은 docs/design/2026-10-30-t112-record-ddl-draft.md §0.
-- 시각 규칙(T-046·T-059): DB·앱 풀 모두 KST. *_at DATETIME = KST 벽시계(앱이 toKstDatetime 문자열로 바인딩). *_et DATE = America/New_York 날짜.
-- 외래키 없음: 쓰기 경합·잠금 전파 방지(설계서 §5). ci_raw_item.run_id 가 이 run_id 를 가리킨다(외래키 없이).
-- 되돌리기: 맨 아래 주석의 DROP 1줄(쌓인 기록 함께 삭제 — 되살릴 수 없다, 사용자 승인 사항). 먼저 기록 스위치를 끄는 것이 롤백이다.

CREATE TABLE IF NOT EXISTS job_run_log (
  run_id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id            VARCHAR(64)  NOT NULL,             -- 러너 라벨 그대로(T-104 §7-1: 라벨 불변). 예: news-peek-overseas-23
  run_kind          VARCHAR(24)  NOT NULL,             -- ingest·peek·drain·reconcile·analysis·other (앱이 허용 목록 검사)
  market            ENUM('domestic','overseas','common') NOT NULL,
  target            VARCHAR(64)  NULL,                 -- 원천: rss·sec·kis·llm·m4 (없으면 NULL)
  scheduled_slot_at DATETIME     NULL,                 -- 예정 슬롯(KST). NULL = 슬롯 밖 임의 실행. 롤업 행은 그 시각의 정시
  started_at        DATETIME     NULL,                 -- 실제 시작(KST). 재시도는 첫 시도 시각 유지. NULL 은 missing 행만
  ended_at          DATETIME     NULL,                 -- 실제 종료(KST). 재시도는 마지막 시도 종료
  status            ENUM('ok','partial','failed','skipped','missing','degraded') NOT NULL,   -- 공동 인계서 §5 어휘 그대로
  attempt           TINYINT UNSIGNED NOT NULL DEFAULT 1,  -- (D-b) 같은 슬롯 시도 횟수. missing 은 0
  http_code         SMALLINT UNSIGNED NULL,            -- 러너가 본 응답 코드. 000(연결 끊김·curl 상한) → 0
  counts_json       JSON NULL,                         -- {fetched,new,processed,candidates} 또는 롤업 {runs,failed,maxMs} — 있는 키만, 2KB 이하
  error_code        VARCHAR(64)  NULL,                 -- 짧은 분류어. 예: HTTP=000/curl=28, HTTP=503:in_progress, ai_fail
  degraded_reason   VARCHAR(128) NULL,                 -- 짧은 분류어. 예: news=0, skip:weekend (skipped 사유도 여기 — 초안 문서 §4.3 E7)
  session_date_kst  DATE NOT NULL,                     -- 슬롯(없으면 시작) 시각의 KST 날짜
  session_date_et   DATE NULL,                         -- 미국 잡만: 같은 시각의 America/New_York 날짜
  recorder          ENUM('runner_hook','route','runner_rollup','reconciler') NOT NULL,   -- (D-a)
  UNIQUE KEY uq_job_slot_recorder (job_id, scheduled_slot_at, recorder),   -- §9.5 중복 기록 방지 키(재시도·재전송이 한 줄 갱신)
  KEY idx_job_started (job_id, started_at),            -- 잡별 "마지막 실행"
  KEY idx_session_market (session_date_kst, market),   -- 날짜·시장별 가동률, 보존 정리
  CONSTRAINT chk_jrl_started CHECK (status = 'missing' OR started_at IS NOT NULL),
  CONSTRAINT chk_jrl_missing CHECK (status <> 'missing'
                                    OR (scheduled_slot_at IS NOT NULL AND started_at IS NULL AND recorder = 'reconciler')),
  CONSTRAINT chk_jrl_counts  CHECK (counts_json IS NULL OR CHAR_LENGTH(counts_json) <= 2048),
  CONSTRAINT chk_jrl_http    CHECK (http_code IS NULL OR http_code <= 999)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 되돌리기(쌓인 기록 함께 삭제 — 사용자 승인 사항, 되살릴 수 없음):
-- DROP TABLE IF EXISTS job_run_log;
```

### 2.2 컬럼별 결정과 이유

| 컬럼 | 결정 | 이유 (한 줄) |
|---|---|---|
| `run_id` | `BIGINT UNSIGNED` AI PK | `ci_raw_item.run_id` 와 같은 타입(D-d). 연 30만 행 [추측]이라 INT 도 되지만 조인 타입 일치가 우선 |
| `job_id` | `VARCHAR(64)` | 가장 긴 라벨 `kis-fundamentals-snapshot` 25자 [확실]. T-104 잡 정의 id 와 같은 값(공동 인계서 J1) |
| `run_kind` | `VARCHAR(24)`(ENUM 아님) | §9.5 그대로. 단계 1a 의 `drain`·`reconcile` 처럼 값이 늘어날 예정이라 ALTER 없이 받는다. 허용 목록은 앱이 검사 |
| `market` | ENUM 3값 | 값이 고정이고 집계 필터 열. daily-bars·broker-fills 는 두 시장을 다 다뤄 `common` |
| `target` | `VARCHAR(64) NULL` | §9.4 J1 추가 요청. 피드 호스트까지 담을 수 있게 64 |
| `scheduled_slot_at` | `DATETIME NULL`, 실제 시작과 분리 | 07:00 잡이 07:03 에 돌아도 슬롯은 07:00 — 가동률 분모(예정 회차)와 `missing` 합성의 기준. NULL = 수동·시험 실행 |
| `started_at`/`ended_at` | `DATETIME NULL`(D-c) | KST 벽시계(T-046). 초 단위(`DATETIME(0)`) — 롤업의 `maxMs` 는 JSON 에 ms 로 |
| `status` | ENUM 6값 | 공동 인계서 §5 어휘 그대로. `yield`(다음 틱으로 미룸)는 실행이 아니라 넣지 않았다(§4.3 E6) |
| `attempt` | `TINYINT UNSIGNED`(D-b) | 해외 분석 하루 3회 상한(`PMO_MAX_ATTEMPTS=3` [확실])·T-104 E7 재시도 창. 255 이하 |
| `http_code` | `SMALLINT UNSIGNED NULL` | `000` 을 0 으로. 러너가 호출하지 않은 `skipped`·`missing` 은 NULL |
| `counts_json` | `JSON NULL`, 2KB CHECK | §9.5 이름. 후크가 본문 앞 2KB 에서만 뽑으므로 2KB 를 넘을 이유가 없다. 넘으면 앱이 키를 버린다(CHECK 는 마지막 방어선) |
| `error_code` | `VARCHAR(64)` | 분류어만. **응답 본문 원문은 저장하지 않는다**(내부 오류 문자열·경로 노출 방지) |
| `degraded_reason` | `VARCHAR(128)` | 분류어만. `skipped` 사유도 `skip:` 접두로 여기 둔다(§9.5 에 사유 열이 따로 없음) |
| `session_date_kst` | `DATE NOT NULL` | 슬롯 기준 날짜(슬롯이 없으면 시작 시각) — "오늘 미실행" 판정의 날짜 |
| `session_date_et` | `DATE NULL` | 미국 잡만. 그 시각의 ET 달력 날짜(기계적 변환). 분석 대상 거래일(D0)은 `judgment_run.session_d0` 가 따로 가진다 |
| `recorder` | ENUM 4값(D-a) | 같은 슬롯에 후크·라우트·롤업·재대사 기록이 공존할 수 있게 UNIQUE 에 포함 |
| 문자셋 | `utf8mb4`(콜레이션 미지정) | T-116 과 같다. 일회용 DB 시험에서 서버 기본(utf8mb3)을 따르지 않는지 확인(§7) |
| UNIQUE 길이 | 64×4+2 + 5 + 1 ≈ 264바이트 | InnoDB 3072바이트 한도 안 [확실: 계산] |

**ODKU(재시도·재전송) 의미 — 구현 때 지킬 것**: `INSERT … ON DUPLICATE KEY UPDATE` 로 같은 키 한 줄을 갱신한다. `started_at` 은 유지(첫 시도), `attempt = IF(VALUES(ended_at) > ended_at, attempt + 1, attempt)`, `status`·`http_code`·`error_code`·`counts_json` 은 더 늦은 시도일 때만 바꾸고, `ended_at = GREATEST(...)` 는 **맨 마지막**에 둔다. MariaDB 는 ODKU 대입을 왼쪽부터 적용하므로 `ended_at` 을 먼저 바꾸면 뒤의 비교가 틀어진다 [가능성 높음] — 같은 줄을 두 번 보내도 `attempt` 가 늘지 않는 시험과, 대입 순서를 바꾼 변이 시험을 둔다(§7.3).

### 2.3 상태 판정 규칙 (기록 라우트의 TypeScript 분류기 — 러너는 판정하지 않는다)

| 관측 | `status` | 분류어 |
|---|---|---|
| curl 실패(`HTTP=000`: 연결 끊김·curl 상한) | `failed` | `error_code = HTTP=000/curl=<종료코드>`(종료코드를 잡을 수 있게 `call()` 을 고칠 때) |
| 4xx·5xx | `failed` | `HTTP=<코드>` + 본문 `status` 단어(예: `HTTP=503:in_progress`, `HTTP=502:ai_fail`) |
| 200 + 본문에 정상 건너뜀 사유(`skipped`: weekend·overseas_disabled·no_new_session·tables_missing·스위치 꺼짐) | `skipped` | `degraded_reason = skip:<사유>` |
| 200 + 국내 장마감 분석 `errors` 에 `ai_fail`·`insert_fail` | `failed` | `ai_fail` 등 — **국내 분석은 실패해도 항상 200** 이라 본문으로만 구분된다 [확실: route.ts 11~14행] |
| 200 + 일부 단위만 실패(예: 국내 분석 `candle_fail` 일부, edgar-sync 미완 종목 남음) | `partial` | `candle_fail=n` 등 |
| 200 + 품질 저하(뉴스 0건 등) | `degraded` | `news=0` |
| 200 + 본문 `"ok":false` | `failed` | 본문 `error` 앞 64자 대신 분류어(없으면 `ok_false`) |
| 200 그 밖 | `ok` | — |
| 예정 슬롯 + 유예 경과, 기록 없음 | `missing` | 재대사가 합성(`recorder=reconciler`, `attempt=0`) |
| (T-104 이후) 러너가 그룹·자기 스위치 꺼짐·휴장으로 부르지 않음 | `skipped` | `recorder=runner_hook`, `http_code` NULL, `skip:group_off` 등 — T-104 §7-2 "꺼진 날은 `missing` 으로 세지 않는다" |

잡별 본문 모양은 국내·해외 분석만 소스로 확인했다. 나머지 라우트의 `partial`·`degraded` 규칙은 구현 때 라우트마다 확인한다 [미확인]. 모르는 본문은 "200 → `ok`, `"ok":false` → `failed`" 기본값으로 둔다.

### 2.4 잡 매핑 (슬롯 표 = 공동 인계서 J8 의 "현행 하드코딩 표" — T-104 단계 1 이 검증된 스케줄로 교체)

| job_id (러너 라벨) | run_kind | market | target | 슬롯 규칙 | 기록 방식(§9.5 규칙) |
|---|---|---|---|---|---|
| entry-watcher · holding-checker · stop-alert | other | common | kis(holding-checker 는 NULL) | 매 틱 | 시간 롤업 1줄 + 실패 즉시 1줄 |
| strategy-eval · trade-report | analysis · other | common | — | 5틱(시계 아님 — T-104 C 에서 "마지막 실행 + N분") | 실행마다 1줄(대안: 롤업, §6 U2) |
| signal-followup · signal-expiry | other | common | m4 · — | 15틱 · 30틱 | 실행마다 1줄 |
| portfolio-snapshot | other | common | kis | 60틱 | 실행마다 1줄 |
| news-fetch-overseas / -domestic | ingest | overseas / domestic | rss | 06:00 (국내는 다음 틱이어도 슬롯 06:00) | 실행마다 |
| news-fetch-domestic-pm | ingest | domestic | rss | 15:30(창 15:30~15:59) | 〃 |
| news-peek-overseas-HH ×19 · news-peek-domestic-10/13 | peek | overseas / domestic | rss | HH:00 | 〃 |
| research-cycle-overseas · edgar-sync | analysis · ingest | overseas | — · sec | 07:00 | 〃 |
| broker-fills | ingest | common | kis | 07:20 | 〃 |
| daily-bars | ingest | common | kis | 07:40(창 07:40~07:54) | 〃 |
| post-market-overseas | analysis | overseas | llm | 08:00, 같은 슬롯 ≤3회(`attempt`) | 〃 |
| kis-fundamentals-snapshot | ingest | overseas | kis | 08:00 | 〃 |
| post-market-domestic · research-cycle-domestic | analysis | domestic | llm · — | 16:00 | 〃 |
| sync-stock-meta · rs-update-domestic | ingest · analysis | domestic | kis · — | 17:00 · 17:30 | 〃 |
| holdings-premarket | ingest | overseas | sec | ET 08:00 평일 → KST 21:00(EDT)/22:00(EST), `session_date_et` 기록 | 〃 |
| export-llm-trainset | — | — | — | 03:00 | **기록 안 됨**(`call()` 밖, §0-6) |

주기 잡(5·15·30·60틱)은 시계 슬롯이 없다. 재전송 중복을 막으려고 `scheduled_slot_at` 에 **실제 시작을 분 단위로 내린 값**을 넣고(의사 슬롯), `missing` 합성 대상에서 뺀다. 이 둘을 슬롯 표의 `kind: daily|window|slots|periodic|tick` 로 구분한다.

---

## 3. 기준 판단(baseline) 기록 DDL 초안

### 3.1 테이블 1개 / 2개 / 기존 `eval_funnel` 재사용 비교

| 기준 | A. 1개(후보 행에 실행 정보 반복) | **B. 2개(실행 헤더 + 후보 행) — 제안** | C. 기존 `eval_funnel` 에 게이트 추가 |
|---|---|---|---|
| 후보 0건인 실행 | **남지 않는다**(행이 없다) — "후보 0" 추이가 사라짐 | 헤더만 남는다 | run 행으로 남는다 |
| 실행 단위 필드(프롬프트 해시·RAG 문맥·공급자·as_of) | 후보마다 중복 저장 | 헤더 1곳 | `detail` JSON 에 섞임(스키마 없음) |
| LLM 실패 실행(ai_fail) | 후보 행으로만 추론 | 헤더 `data_status.llm=error` 로 명시 | 가능 |
| 쓰기 횟수 | 1문장 | 2문장(헤더 INSERT → id → 후보 multi-row INSERT) | 1~2문장 |
| 보존 | 우리가 정함 | 우리가 정함 | **30일 자동 삭제**(`RETENTION_DAYS=30` [확실]) — 11-23 판단·사후 성과(D+10)에 빠듯하고 장기 비교 불가 |
| 다른 기록과 섞임 | 없음 | 없음 | 5분 전략 평가 행과 같은 표(규모 차이 큼), 게이트 라벨 의미 충돌 |
| DDL | 1개 | 2개 | 0개(부팅 DDL 테이블) |

**제안: B.** 후보 0건 실행이 증거로 남아야 하고(§2.6 "후보 전체"), 실행 단위 필드가 6개라 반복 저장은 낭비다. C 는 DDL 이 없다는 장점이 있지만 30일 자동 삭제와 스키마 부재가 이 기록의 목적(11-23 판단·사후 성과·shadow 비교)과 맞지 않는다.

### 3.2 DDL (문법 미검증)

```sql
-- T-112 — 실행·판단 기록 기반 ②: 장마감 분석 기준 판단 기록 judgment_run(실행 1회) + judgment_candidate(종목 1개)
-- (가산 전용, 외래키 없음, 부팅 DDL 미포함 — 위 job_run_log 머리 주석과 같은 적용·되돌리기 절차)
-- 정본: 2차 설계서 §7 단계 3(기준 판단 기록 필수 필드)·§2.6(후보 전체)·공동 인계서 J4(judgment_role)·J3(사후 성과 정의 공유).
-- 쓰기: 장마감 분석 엔진(post-market-engine.ts·post-market-overseas.ts)이 분석이 끝난 뒤 한 번, 절대 던지지 않고 상한 안에서.
--       해외 카드 트랜잭션 연결은 쓰지 않는다(커밋 뒤 getPool()).
-- 읽기: 홈·분석 지표(baseline 만), 사후 성과 스크립트(T-095 정의), T-114 단계 3·T-109 shadow 비교.
--       shadow 기록은 시그널·승인·주문 경로로 전달 금지(설계서 §6.8).
-- 시각 규칙: *_at DATETIME = KST 벽시계. session_d0 DATE = 거래소 현지 거래일(KR=KST, US=ET) — daily_bars.trade_date 와 같은 규약.

CREATE TABLE IF NOT EXISTS judgment_run (
  judgment_run_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  market           ENUM('domestic','overseas') NOT NULL,
  judgment_role    ENUM('baseline','shadow') NOT NULL,
  session_d0       DATE NULL,                    -- 분석한 마지막 일봉의 현지 거래일(해외 = 엔진의 d0). 국내는 엔진이 아직 보유하지 않음(§3.5)
  valid_from       DATETIME NOT NULL,            -- 카드가 겨냥한 다음 세션 시작(KST) = signals.valid_from
  started_at       DATETIME NOT NULL,
  ended_at         DATETIME NULL,
  as_of            DATETIME NULL,                -- 판단 입력을 고정한 시각(RAG 조회 직전, KST). LLM 전에 끝나면 NULL
  candidate_count  SMALLINT UNSIGNED NOT NULL DEFAULT 0,   -- 종목당 1개로 줄인 후보 수(엔진의 candidatesFound 와 같은 정의)
  llm_provider     VARCHAR(24) NULL,             -- claude·home-m4-api·hybrid — 설정 기준(§3.5)
  llm_model        VARCHAR(64) NULL,             -- 설정 기준. 모르면 NULL
  prompt_sha256    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,   -- runLlm 에 넘긴 프롬프트 문자열 그대로의 sha256 16진
  rag_context_ids  JSON NULL,                    -- {"news":[KbHit.id…],"signals":[…],"macro":[…]} — 4KB 이하
  data_status      JSON NULL,                    -- {"candles":"available|partial|…","news":…,"earnings":…,"fx":…,"llm":…} — J5 어휘, 1KB 이하
  KEY idx_market_session (market, session_d0, judgment_role),
  KEY idx_started (started_at),
  CONSTRAINT chk_jr_prompt CHECK (prompt_sha256 IS NULL OR prompt_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_jr_rag    CHECK (rag_context_ids IS NULL OR CHAR_LENGTH(rag_context_ids) <= 4096),
  CONSTRAINT chk_jr_status CHECK (data_status IS NULL OR CHAR_LENGTH(data_status) <= 1024)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS judgment_candidate (
  candidate_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,   -- ci_decision_snapshot.baseline_record_id 가 가리킬 단일 키(설계서 §5)
  judgment_run_id  BIGINT UNSIGNED NOT NULL,                     -- judgment_run 참조(외래키 없음)
  judgment_role    ENUM('baseline','shadow') NOT NULL,           -- 헤더와 같은 값(앱이 보장). 후보 단위 집계를 조인 없이
  symbol           VARCHAR(32) NOT NULL,                         -- 앱 심볼('005930','NAS:MU') = signals.symbol·daily_bars.symbol 과 같은 형식
  pattern          VARCHAR(32) NULL,                             -- eod-high-close·inside-bar·oversold-bounce. 종목 단계 제외면 NULL
  exclusion_code   VARCHAR(40) NULL,                             -- §3.4 어휘. NULL = 끝까지 통과(BUY → 카드) 또는 AI 가 SKIP
  sent_to_llm      TINYINT(1) NOT NULL DEFAULT 0,
  ai_decision      ENUM('BUY','SKIP','NONE','INVALID') NULL,     -- NONE = LLM 응답에 이 종목 결정이 없음, INVALID = 형식 불량. 미전송·LLM 실패면 NULL
  confidence       DECIMAL(5,2) NULL,                            -- LLM 이 준 0~100
  ai_reasoning     VARCHAR(500) NULL,                            -- LLM 판단 근거(SKIP 포함). 500자에서 자른다. 외부 데이터로만 취급
  signal_id        BIGINT NULL,                                  -- signals.id(BIGINT 부호 있음 [확실: db.ts 782행]). 카드가 없으면 NULL
  UNIQUE KEY uq_run_symbol (judgment_run_id, symbol),            -- 종목당 1행(엔진이 종목당 후보 1개로 줄인다)
  KEY idx_symbol (symbol),                                       -- 종목별 이력·사후 성과
  KEY idx_signal (signal_id),                                    -- 카드 → 판단 역조회
  CONSTRAINT chk_jc_sent     CHECK (sent_to_llm IN (0,1)),
  CONSTRAINT chk_jc_decision CHECK (sent_to_llm = 1 OR ai_decision IS NULL),
  CONSTRAINT chk_jc_conf     CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 되돌리기(쌓인 판단 기록 함께 삭제 — 사용자 승인 사항, 되살릴 수 없음):
-- DROP TABLE IF EXISTS judgment_candidate;
-- DROP TABLE IF EXISTS judgment_run;
```

이름: 기업정보 전용이 아니므로 `ci_` 접두어를 쓰지 않았다. 저장소에 `CREATE TABLE IF NOT EXISTS` 로 정의된 기존 테이블 45개(`db.ts`·migrations)와 겹치지 않는다 [확실: grep]. 운영 DB 의 실제 테이블 목록은 조회하지 않았다 — 적용 직전 `SHOW TABLES LIKE` 로 확인한다.

### 3.3 필수 필드 대조표 (이 표에 없는 컬럼은 넣지 않았다)

| 출처 | 요구 필드 | 위치 | 비고 |
|---|---|---|---|
| 지시(실행 1회) | 시장 | `judgment_run.market` | |
| 〃 | 세션 | `session_d0`(분석한 거래일) + `valid_from`(겨냥한 세션) | "세션"을 두 열로 해석 — 사후 성과는 `session_d0`, 카드 조인은 `valid_from` 이 필요하다 |
| 〃 | 시작/종료 | `started_at`·`ended_at` | |
| 〃 | 후보 수 | `candidate_count` | 평가 종목 수·생성 카드 수는 `job_run_log.counts_json`(본문 `symbolsEvaluated`·`signalsCreated`)에 있다 |
| 〃 | 모델/공급자 | `llm_provider`·`llm_model` | 설정 기준(§3.5-③) |
| 〃 · J4 | `judgment_role` | 두 테이블 모두 | |
| 지시(후보별) | 종목 | `judgment_candidate.symbol` | |
| 〃 | 패턴 | `pattern` | |
| 〃 | 후보 단계 제외 사유 코드(블랙아웃·오래된 봉·사전 금액 초과 등) | `exclusion_code`(`sent_to_llm=0`) | 오래된 봉·봉 조회 실패는 **종목 단계** 제외라 `pattern` NULL 행(§3.4) |
| 〃 | LLM 에 보낸 여부 | `sent_to_llm` | |
| 〃 | AI 결정 BUY/SKIP | `ai_decision` | BUY/SKIP 외에 `NONE`·`INVALID` 를 더했다 — 응답에 결정이 없거나 깨진 경우를 SKIP 으로 뭉개지 않기 위해 |
| 〃 | 카드 id 연결 | `signal_id` | |
| 〃 | 판단 근거 문자열 저장 여부·길이 상한 | `ai_reasoning VARCHAR(500)` — **저장 제안**(§8 U4) | |
| §7 단계 3 | 후보 전체 | `judgment_candidate` 전 행(제외된 것 포함) | 같은 종목의 낮은 우선순위 패턴(종목당 1개로 줄일 때 버려진 것)은 행으로 남기지 않는다 |
| 〃 | BUY/SKIP | `ai_decision` | |
| 〃 | 신뢰도 | `confidence` | |
| 〃 | 프롬프트 해시 | `prompt_sha256` | |
| 〃 | 사용한 RAG 문맥 ID | `rag_context_ids` | `KbHit.id` [확실: m4-kb.ts 21행] |
| 〃 | 자료 상태 | `data_status` | J5 어휘. `llm` 키는 해석(LLM 응답도 판단 입력의 상태로 본다) |
| 〃 | `as_of` | `as_of` | §2.6 의 "판단 시각 A" |
| 〃 | `judgment_role=baseline` | 〃 | |
| 키(근거) | 후보 단일 키 | `candidate_id` | 설계서 §5 `ci_decision_snapshot.baseline_record_id` |
| 키(근거) | 실행 ↔ 후보 연결 | `judgment_run_id` | |

표에 없어서 **넣지 않은 것**: 평가 종목 수, 버려진 패턴, 다음 세션 S1(해외), 환율, 진입 구간·목표·손절(카드가 있으면 `signals` 에 있다), shadow 변형 이름(§4.3 E15).

### 3.4 `exclusion_code` 어휘 (엔진 분기와 1:1)

| 단계 | 코드 | 국내 | 해외 | 엔진 근거 [확실: 소스] |
|---|---|---|---|---|
| 종목(pattern NULL, sent 0) | `candle_fail` | ○ | ○ | `candle_fail:<종목>` 오류 |
| 〃 | `stale_candle` | — | ○ | 마지막 봉 날짜 ≠ D0(`staleCandleSkipped`) |
| 후보(sent 0) | `blackout` | — | ○ | `judgeBlackout` 차단 |
| 〃 | `prefilter_unaffordable` | — | ○ | D-5 사전 금액 필터 |
| LLM 뒤(sent 1) | `llm_error` | ○ | ○ | 실행 전체 `ai_fail`·`ai_parse_fail` — `ai_decision` NULL |
| 〃 | `schema_invalid` | ○(BUY 필수값 없음) | ○(`chk.kind='schema'`) | |
| 〃 | `zone_out_of_range` | — | ○ | `chk.kind='zone'` |
| 〃 | `low_confidence` | ○(<60) | ○(`MIN_CONFIDENCE=60`) | |
| 〃 | `unaffordable` | ○ | ○ | 수량 0(`cardBuysZeroShares`) |
| 카드 | `duplicate` | ○ | ○ | 같은 카드가 이미 있음(`signal_id` 는 그 기존 카드) |
| 〃 | `validation_blocked` | ○ | ○ | 승인 불가 `skipped` 카드로 기록됨(`signal_id` 있음) |
| 〃 | `insert_fail` | ○ | ○ | 해외는 실행 전체 되돌림 |
| — | NULL | | | `ai_decision=BUY` → 카드 생성(`signal_id` 있음) / `SKIP` → AI 가 거름 |

LLM 이 후보에 없는 종목을 답하면(엔진은 건너뛴다) 행이 없다 — 그 수는 기록되지 않는다.

### 3.5 사후 성과와의 조인 키 (계산은 범위 밖)

`judgment_candidate.symbol` = `daily_bars.symbol`, `judgment_run.market` → `daily_bars.market`(`domestic→KR`, `overseas→US`), `judgment_run.session_d0` = D0 `trade_date`, 이후 봉은 `trade_date > session_d0` 오름차순. T-095 의 일봉 진입 모델(`d1open`·`d0close`)은 일봉과 종목·D0 만 쓰므로 SKIP 후보도 같은 지평(D+1·3·5·10)으로 계산된다 [확실: postmortem-core.js 20·31·470행]. 같은 `(market, session_d0, baseline)` 에 헤더가 여럿이면(해외 재시도) `data_status.llm` 이 정상인 마지막 실행 하나만 쓴다. 카드가 있는 후보는 `signal_id` 로 `signals`·`paper_fills` 와 잇는다.

구현에서 풀어야 할 것(모두 감시 경로):
- ① **국내 D0**: 국내 엔진은 마지막 봉 날짜를 보관하지 않는다(`DailyCandidate` 에 날짜 없음 [확실]). 봉 조회 콜백이 마지막 봉 날짜를 함께 돌려주게 바꾸거나, 그 전까지 `session_d0` NULL 로 둔다. "실행 날짜(KST)"로 대신 채우면 공휴일 실행(국내는 공휴일에도 돈다 [확실: 467~472행])에서 틀린다.
- ② **카드 id**: `insertScenarioCardIfAbsent` 는 생성 시 id 를 돌려주지 않는다. 함수를 바꾸지 말고, 기록기가 분석 뒤 `signals` 의 자연 키 `(symbol, side='buy', valid_from, scenario_source='post-market')`(유니크 인덱스 `uq_signals_scenario_card` 의 열 그대로 [확실: post-market-engine.ts 289~299행 주석])로 한 번 SELECT 해 채우는 것을 권고한다.
- ③ **모델/공급자**: `runLlm` 은 문자열만 돌려준다. `getProviderConfig()` 로 기록 시점의 설정을 읽어 채우며, 실제 호출과 어긋날 수 있다(호출 중 설정 변경, `claude` 의 기본 모델) [가능성 높음].
- ④ **RAG 문맥**: `ragCtx` 가 `try` 블록 안 지역 변수라 기록기로 넘기려면 바깥으로 꺼내야 한다.

---

## 4. G-J1 호환 표

4.1·4.2 의 T-108 칸은 **10-28 17:09 사용자 결정·공동 인계서 §11 17:25 합의**(가동률 최소 필드: 잡 id·시장·예정 슬롯·시작/종료·status·건수·error_code·degraded_reason)를 기준으로 채웠다(이 문서를 쓰기 시작한 11:59 에는 T-108 계약 초안이 없었다). 계약 초안 `docs/design/2026-10-30-t108-metrics-contract-draft.md` 이 12:01 에 생겨 §6 만 읽고 1차 대조를 §4.4 에 남겼다 — 최종 대조(G-J1)는 Leader 몫이다.

### 4.1 `job_run_log`

| 컬럼 | T-104 판정 상태(설정 화면 표시) | T-108 가동률 | T-114 §9.5·단계 1a | T-109 shadow |
|---|---|---|---|---|
| run_id | 미소비 | 미소비 | 소비(`ci_raw_item.run_id`) | 미소비 |
| job_id | 소비(라벨 = id) | 소비 | 소비 | 미소비 |
| run_kind | 미소비 | 미소비(필터로 쓸 수 있음) | 소비 | 미소비 |
| market | 소비(그룹) | 소비 | 소비 | 미소비 |
| target | 미소비 | 미소비 | 소비 | 미소비 |
| scheduled_slot_at | 소비("오늘 미실행") | 소비(예정 회차) | 소비(`missing`) | 미소비 |
| started_at / ended_at | 소비("마지막 실행 + N분") | 소비 | 소비 | 미소비 |
| status | 소비 | 소비(정상 회차) | 소비 | 미소비 |
| attempt | 소비(E7 재시도 창) | 미정(E9) | 미소비 | 미소비 |
| http_code | 미소비 | 미소비 | 소비(`000`) | 미소비 |
| counts_json | 미소비 | 소비(건수) | 소비(fetched/new/processed) | 미소비 |
| error_code | 소비(표시) | 소비 | 소비 | 미소비 |
| degraded_reason | 미소비 | 소비(`news=0`) | 소비 | 미소비 |
| session_date_kst / _et | 소비("오늘") | 소비(미국은 ET 세션일) | 소비 | 미소비 |
| recorder | 미소비 | 소비(롤업·`missing` 구분) | 소비 | 미소비 |

### 4.2 `judgment_run` · `judgment_candidate`

| 컬럼 | T-104 | T-108(사후 성과·후보/제외 추이) | T-114 §7 단계 3 | T-109 shadow |
|---|---|---|---|---|
| judgment_run_id · candidate_id | 미소비 | 소비 | 소비(`baseline_record_id`) | 소비 |
| market · session_d0 | 미소비 | 소비(조인 키) | 소비 | 소비 |
| judgment_role | 미소비 | 소비(baseline 만) | 소비 | 소비 |
| valid_from | 미소비 | 소비(카드 조인) | 미소비 | 미소비 |
| started_at · ended_at | 미소비 | 미소비 | 소비 | 미소비 |
| as_of | 미소비 | 미소비 | 소비 | 소비(입력 스냅샷 시각) |
| candidate_count | 미소비 | 소비 | 소비 | 소비 |
| llm_provider · llm_model · prompt_sha256 · rag_context_ids | 미소비 | 미소비 | 소비 | 소비 |
| data_status | 미소비 | 소비(자료 상태 표시) | 소비 | 소비 |
| symbol · pattern | 미소비 | 소비 | 소비 | 소비 |
| exclusion_code | 미소비 | 소비(제외 사유 추이) | 소비 | 미소비 |
| sent_to_llm · ai_decision | 미소비 | 소비 | 소비 | 소비 |
| confidence | 미소비 | 미정 | 소비 | 소비 |
| ai_reasoning | 미소비 | 미소비(화면에 보이면 소비) | 미소비 | 소비(비교) |
| signal_id | 미소비 | 소비(카드 ↔ 판단) | 미소비 | 미소비 |

### 4.3 이견 (숨기지 않는다)

| # | 이견 | 근거 | 제안 |
|---|---|---|---|
| E1 | `recorder` 2값 추가(D-a) | §0-2 의 충돌·`missing` 주체 | 채택 요청 |
| E2 | `attempt` 추가(D-b) | §9.5 "재시도가 한 줄을 갱신"하면 횟수가 사라진다 | 채택 요청 |
| E3 | `started_at` NULL 허용(D-c) | 설계서 §4.2 "시각을 지어내지 않는다" | 채택 요청 |
| E4 | **이름: `counts_json` vs `detail_json`** | §9.4 J1·공동 인계서 §11 17:10/17:25·T-112 지시문은 `detail_json`, §9.5 확정안은 `counts_json`(같은 뜻: 원천별 fetched/new/processed) | §9.5 를 정본으로 `counts_json`. T-108 계약 초안(12:01)도 `counts_json` 을 쓴다 — 이름은 해소, 남은 것은 인계서·지시문의 옛 이름 정리뿐 |
| E5 | `run_id` UNSIGNED(D-d) | T-116 SQL | 채택 요청 |
| E6 | `yield` 를 status 로 넣지 않음 | §5·§9.5 어휘에 없다. 러너의 `yield_tick` 은 다음 틱으로 미루는 것이지 실행이 아니고, 그 슬롯의 실제 실행이 한 줄을 남긴다 | 미룬 횟수가 필요하면 그 실행의 `counts_json.yielded` 로(구현 때) |
| E7 | `skipped` 사유 열이 없다 | §9.5 는 `error_code`/`degraded_reason` 만 둔다 | `degraded_reason = skip:<사유>`. 이름이 어색하면 구현 전 열 이름 결정 |
| E8 | **T-104 의 실행 판정은 이 테이블을 읽으면 안 된다** | T-104 「C 설계」 3번: "DB·앱이 죽어도 러너 동작은 지금과 같다"(로컬 캐시·날짜파일) | T-104 는 실행 판정을 러너 로컬 상태로, 이 테이블은 **표시·감사용 사본**으로만 쓴다. 기록이 실패하면 둘이 어긋날 수 있다 — 화면 문구는 "기록 기준"임을 밝힌다 |
| E9 | 가동률의 "정상 회차"에 재시도 성공(`attempt>1`)을 넣는가 | T-108 계약 미작성 | Analyst 결정 |
| E10 | §9.5 "5분 이상 간격 잡은 실행마다" → 하루 약 850행 중 744행이 주기 잡(strategy-eval·trade-report 만 576) | §6 계산 | 60분 미만 잡도 롤업하면 약 230행. 사용자 결정(U2) |
| E11 | 예정 슬롯을 누가 아는가 | `call()` 은 경로·라벨·본문만 받는다 [확실: 러너 50~68행] | 기록 라우트의 슬롯 표(J8 "현행 하드코딩 표")가 라벨·시각으로 슬롯을 정한다. T-104 단계 1 이 검증된 스케줄로 교체. 표 ↔ 러너 라벨 정합 시험 필수 |
| E12 | 국내 D0·카드 id·실제 모델을 엔진이 모른다 | §3.5 | 위 권고대로. "1곳 비차단 호출"보다 변경 범위가 크다는 사실을 설계서 §3·§7 단계 3 에 반영 요청 |
| E13 | 기록 POST 시점 | §0-1 | 스풀 + 가벼운 틱 일괄 전송(§5.1 B) |
| E14 | 분석 쪽 기록을 기다리는가 | news-health 는 4초 상한으로 **기다린다**. 해외 분석은 러너 curl 상한 120초 안이어야 성공으로 센다 [확실: `PMO_CURL_MAX_TIME=120`] — 기록 대기가 경계 실행을 120초 밖으로 밀면 실패로 세어 10분 뒤 재시도(LLM 1회 더) | 결과를 정한 뒤 **기다리지 않는 기록**(자체 상한·예외 삼킴, 시험용 대기 함수 제공) 권고. Reviewer 판단(§8 R2) |
| E15 | shadow 를 이 테이블에 둘 것인가 | 설계서 §5 는 shadow 를 `ci_decision_snapshot`·`ci_shadow_judgment` 에 둔다. 이 테이블에 shadow 를 넣으려면 변형 이름 열이 필요한데 지시 표에 없다 | 지금은 baseline 만 쓴다(`judgment_role` 은 J4 일관성용). T-109·단계 3 이 여기에 쓰려면 `variant` 열을 가산 ALTER 로 추가 — 그때 결정 |

### 4.4 T-108 지표 계약 초안(12:01, §5·§6 만 읽음)과의 1차 대조

계약 §6 이 이 기록에 **더 요구하는 필드**와 이 초안의 처리. 이 초안은 지시대로 "대조표에 없는 컬럼은 넣지 않는다"를 지켰으므로, 아래 "미포함"은 Leader 가 넣을지 정할 항목이다.

| 계약 §6 요구 | 이 초안 | 판단 |
|---|---|---|
| `counts_json` 분석 키 `{evaluated, candidates, llm_input, created, blocked, duplicate, skipped}` | §9.5 키 `{fetched,new,processed,candidates}` 로 적었다 | **계약 키 채택에 이견 없음** — JSON 이라 DDL 영향 0. 분류기가 본문 `symbolsEvaluated`·`llmCandidates`·`signalsCreated`·`validationBlocked`·`duplicatesSkipped`·`signalsSkipped` 를 옮긴다 |
| 해외 data_unknown(503)을 `degraded`, 정상 건너뜀을 `skipped` 로 | §2.3 은 4xx·5xx 를 `failed` 로 | **이견 E16** — 503 data_unknown 은 그 회차에 판단이 나오지 않았다. `degraded`("돌았으나 품질 저하")로 두면 가동률 분자·분모 해석이 흐려진다. 분석 실패로 세고 `error_code=HTTP=503:data_unknown` 을 권고. E2 정의 소유자(Analyst) 결정 |
| `session_date_et` 해외 필수 · 매 분 롤업은 E2 대상 아님 | 같다 | 일치. 매 분 롤업 제외는 U2(롤업 권고)의 근거가 된다 — E2 의 데이터 그룹에 strategy-eval·trade-report 가 없다 |
| 판단 기록 `run_id`(→`job_run_log`) | 미포함 | 엔진은 러너가 나중에 쓰는 `run_id` 를 모른다(스풀 방식이면 더 늦게 생긴다). 지금은 `market` + `started_at` 이 `job_run_log` 의 `started_at~ended_at` 안에 드는지로 잇는다. 정확한 연결이 필요하면 러너가 호출마다 실행 토큰을 헤더로 보내 양쪽에 같은 값을 적는 1열 가산 — **합의 필요** |
| `session_date_kst/et`·`d0_trade_date` | `session_d0`(현지 거래일 = 해외 ET D0) + `started_at` | 같은 뜻으로 덮인다. 이름만 다르다 |
| `rule_hits`(종목의 규칙 3개 적중 전부) | 미포함 — 종목당 남긴 패턴 1개만 | **이견 E17** — 엔진이 종목당 1개로 줄이며 버린 패턴을 남기지 않는다. E3 깔때기의 "규칙 후보 수"를 패턴 단위로 셀지 종목 단위로 셀지 Analyst 가 정하면, 필요 시 `pattern` 대신 적중 목록 열(가산) |
| `stage` · `reject_reason` · `decision`(BUY/SKIP/NA) | `sent_to_llm`·`ai_decision`·`exclusion_code`·`signal_id` 조합 | 덮인다 — 계약의 stage 8개는 이 4열에서 결정적으로 계산된다(§3.4). 별도 열을 두면 두 값이 어긋날 수 있다 |
| `news_count` | 미포함 | `rag_context_ids.news` 배열 길이로 계산 가능 |
| `ref_price_native`·`currency`·`fx_usdkrw`·`fx_at` | 미포함 | **이견 E18** — T-095 의 `d1open`·`d0close` 진입은 `daily_bars` 현지 통화 원값만 쓴다 [확실: postmortem-core.js 460~470행]. SKIP 후보에는 시그널 가격이 없어 환율이 필요한 `legacy` 모델을 쓸 수 없다. 엔진이 본 종가와 `daily_bars` 가 같은지 대조하려는 목적이면 1~2열 가산 — Leader 결정 |
| `engine_version`(git sha) | 미포함 | 기준선 대장(§10) 대조에 쓸모가 있다. 런타임에 sha 를 얻는 방법(릴리스 디렉터리 이름 `…-a16bc0cb` 또는 빌드 환경변수)이 정해져야 한다 [가능성 높음]. 1열 가산 후보 |
| `data_status_json`·`signal_id`·`prompt_hash`·`model`·`rag_context_ids`·`confidence`·`judgment_role`·`as_of` | 있음(이름: `data_status`·`prompt_sha256`·`llm_model`) | 일치(이름 차이만) |
| 보존 90일 이상 | 처음엔 아무것도 지우지 않음 | 일치 |

---

## 5. 기록 지점과 "영향 0" 원칙

원칙: **기록은 관찰 전용이다.** 기록이 느리거나 실패해도 잡 호출·순서·시각·날짜파일·`CALL_LAST_CODE`(해외 분석 재시도)·하트비트, 분석 결과·카드·주문이 한 비트도 달라지지 않는다(공동 인계서 J1-③, `news-health.ts` "절대 던지지 않는다").

### 5.1 러너 `call()` 사후 후크

**위치** [확실: 러너 57~67행]: `curl` 이 끝나 `code`·`CALL_LAST_CODE` 가 정해진 **뒤**, `rm -f /tmp/cron-runner-$$.out` **앞**. 이 자리에서만 응답 코드와 본문 앞부분을 볼 수 있다. `HTTP=000`(10-26 edgar-sync 사례)은 라우트가 아니라 여기서만 관측된다. 슬롯 누락(`missing`)은 후크가 아니라 재대사가 본다.

**전송 방식 비교** (지연 수치는 모두 [추측] — 실측 전)

| 방식 | 내용 | 틱에 더하는 시간 | 위험 |
|---|---|---|---|
| A. 즉시 POST | 후크가 `curl --max-time 2` 로 기록 라우트 호출 | 평소 호출당 약 0.02~0.05초, **앱이 느릴 때 호출당 최대 2초 × 최대 약 10회 ≈ +20초** → 08시 틱 290 → 약 310초 > 300초(순찰 재시작) | §0-1 |
| **B. 로컬 스풀 + 일괄 전송 — 권고** | 후크는 로컬 디스크(`~/.node-local/stockinvest/job-run-spool`, 하트비트와 같은 NFS 밖 위치)에 한 줄 덧붙이기만. 틱 끝(`sleep 60` 앞)에서 한 번, 틱 경과가 150초 미만일 때만 `curl --max-time 3` 으로 묶어 보냄. 200 이면 보낸 줄 삭제, 아니면 다음 틱에 다시 | 줄 쓰기 호출당 약 5~15ms(`date`·`head`·`base64` 몇 번) → 틱당 약 0.1초. 전송은 가벼운 틱에서만 최대 3초 → 최악 틱(≥150초)에는 0 | 기록이 1틱~수 분 늦게 DB 에 들어간다. 스풀 크기 상한 필요(예: 2MB 초과 시 오래된 줄 버리고 로그 1줄) |
| C. 스풀 + 백그라운드 전송 | 전송을 `&` 하위 프로세스로 | 약 0 | 러너가 "병렬화하지 않는다(임시파일 `$$` 충돌)" 원칙을 둔다 [확실: 384~385행]. 겹침·좀비 관리가 필요 |

B 의 계산: 최악 틱 290초에 줄 쓰기 약 0.1초만 더해진다(전송은 건너뜀) → 약 290.1초 < 300초. 전송하는 틱은 150 + 3 + 0.1 + 60 ≈ 213초 < 300초 [추측: 줄 쓰기·전송 시간은 실측 필요].

**스풀 줄 형식(제안)**: 탭 구분 한 줄 — `v1 · 라벨 · 경로 · http 코드 · curl 종료코드 · 시작 ms · 종료 ms · 본문 앞 2KB 의 base64`. base64 라 본문의 따옴표·줄바꿈·탭이 줄을 깨지 않는다(`jq` 이스케이프보다 단순). 매 분 잡 3개는 200 이면 본문을 싣지 않는다. 롤업은 라우트가 스풀 줄을 시간별로 모아 만든다(러너는 세지 않는다 — 재기동해도 계수가 사라지지 않는다). 선택: 호출 **전**에 시작 표시 줄을 쓰면, 호출 도중 러너가 죽었을 때(순찰 재시작) 다음 러너가 짝 없는 시작 줄을 `failed`(`runner_killed`)로 보낼 수 있다 — `missing`(아예 안 돎)과 구별된다.

**후크가 지킬 것**: 러너는 `set -u` 다 [확실: 40행] — 후크 안 변수는 모두 `${VAR:-}` 로 읽는다(정의 안 된 변수 하나가 러너 전체를 죽인다). 모든 명령 끝에 `2>/dev/null || true`. `CALL_LAST_CODE`·`code` 를 건드리지 않는다. 전송 curl 은 `call()` 을 거치지 않는다(재귀 기록 방지). 배포 때 러너 두 개가 1~3초 겹쳐도(설계서 §11 LOW) 작은 줄 덧붙이기는 섞이지 않고 [가능성 높음: 로컬 파일 `>>` 4KB 미만], 전송은 `mv` 로 파일을 넘겨받아 겹치지 않는다.

### 5.2 기록 라우트 (신규, 제안 이름 `POST /api/cron/job-run-log`)

- 인증: 다른 cron 라우트와 같은 `checkCronAuth`(`x-cron-secret`).
- 하는 일: 스풀 줄 파싱 → §2.3 분류기·§2.4 슬롯 표로 행 구성 → ODKU. 응답 본문 원문은 저장하지 않는다.
- 상한: 요청 크기(예: 256KB·500줄), 처리 전체 2.5초(curl 3초보다 짧게, news-health 의 `Promise.race` 방식). 넘기면 비-200 → 러너가 다음 틱에 다시 보낸다.
- 스위치: `system_config.job_run_log_enabled`, **키 없음 = 꺼짐**(T-104 §7-2 새 기능 fail-closed, T-116 선례). 꺼져 있으면 200 + 버림(러너 스풀이 쌓이지 않게).
- 재대사(`missing` 합성): 이 라우트가 **매시 첫 전송 때** "유예 지난 슬롯 중 기록 없는 것"을 `reconciler` 로 채운다(별도 잡을 만들지 않는 안). 휴장·스위치 꺼짐은 `skipped` 로 써야 하므로 같은 판정 함수를 써야 한다 — 위치·주기는 §8 R4.
- 알려진 한계: 라우트가 커밋한 뒤 응답이 3초 안에 못 가면 러너가 같은 줄을 다시 보낸다. 실행 행은 ODKU 로 무해하지만 **롤업의 `runs` 는 과대 집계될 수 있다** [추측: 드묾].

### 5.3 분석 쪽 기록 지점 (`post-market-engine.ts`·`post-market-overseas.ts`)

| 후보 지점 | 장점 | 단점 |
|---|---|---|
| 후보 확정 직후 | LLM 이 죽어도 후보가 남는다 | 결정·카드가 없다 → 같은 실행을 두 번 써야 한다 |
| LLM 결과 직후 | 결정까지 | 카드 결과(중복·관문·저장 실패)가 없다 |
| 카드 INSERT 직후 | 전부 | 중간에 끝나는 경로(ai_fail·parse_fail·LLM 후보 0·insert_fail)를 놓치기 쉽다 |
| **제안: 단계마다 메모리에 표시 + 끝에서 1회 기록** | 전부, 쓰기 1회(헤더 + 후보 multi-row) | 거르기 지점마다 표시 호출(해외 약 12·국내 약 8곳) |

- 메모리 표시는 **순수 함수**(I/O 없음, 내부에서 예외 삼킴). 기록은 모든 반환 경로를 덮도록 한 곳(`finally` 또는 반환 직전 공통 함수)에서. `eval-funnel.ts` 와 같은 방식(누적 → 끝에 multi-row INSERT·실패 삼킴·행 상한) [확실: eval-funnel.ts 머리 주석].
- 해외는 카드 저장이 트랜잭션이다 → 기록은 **커밋 뒤, `getPool()` 별도 연결**에서. 트랜잭션 안에서 쓰면 기록 실패가 카드 되돌림을 부른다.
- 스위치 `system_config.judgment_record_enabled`, 키 없음 = 꺼짐. 테이블 없음 → 건너뜀(경고 1회).
- 기다림: E14 — 결과를 정한 뒤 기다리지 않는 기록(자체 4초 상한) 권고. Next 는 pm2 의 상주 프로세스라 반환 뒤 남은 Promise 가 계속 돈다 [가능성 높음].
- 증명할 것: 기록기가 정상·예외·영원히 대기·테이블 없음·스위치 꺼짐일 때 **분석 반환값·카드 INSERT 인자·`errors` 가 같다**(국내 골든 시험 `post-market-domestic-golden.test.ts` 와 해외 시험에 같은 시나리오 추가).

### 5.4 훅 `SAFETY_PATHS` 해당 여부 (2026-10-30 11:5x 에 `awk` 로 확인 — 목록은 복제하지 않는다)

| 구현 때 바뀔 파일(예정) | 걸리나 |
|---|---|
| `scripts/migrations/T-112-run-judgment-record.sql` | 걸린다 |
| `scripts/cron-runner.sh`(후크·전송) | 걸린다 |
| `src/app/api/cron/job-run-log/route.ts`(신규) | 걸린다 |
| `src/lib/strategy/post-market-engine.ts`·`post-market-overseas.ts`·`src/lib/strategy/judgment-record.ts`(기록기를 여기 두는 안) | 걸린다 |
| 기록기를 `src/lib/run-log/` 같은 새 디렉터리에 두는 안 | **안 걸린다** — 분석 엔진이 부르는 코드라 감시가 필요하다. `src/lib/strategy/` 아래 두거나 목록에 한 줄 추가(T-098 선례) |
| 러너 시험 `scripts/test-cron-runner-*.sh`(신규 포함) | 안 걸린다(기존 러너 시험도 밖) |
| `src/lib/db.ts` | 걸린다 — **고치지 않는다**(부팅 DDL 미포함) |
| `docs/db-schema.md`·이 문서·task 이력서 | 안 걸린다 |

---

## 6. 증가량·인덱스·보존

**하루 행 수 계산식** (틱 수는 약 1,440 으로 둔다 — 실제 틱은 60초 + 잡 시간이라 조금 적다 [추측])

```
job_run_log (§9.5 규칙)
  매 분 잡 롤업      3 잡 × 24시간                         =  72
  주기 잡(실행마다)  strategy-eval 1440/5 + trade-report 1440/5
                     + signal-followup 1440/15 + signal-expiry 1440/30
                     + portfolio-snapshot 1440/60          = 288+288+96+48+24 = 744
  하루 1회 잡        call() 경유 14개(holdings-premarket 은 평일)  =  14
  peek               해외 19 + 국내 2                       =  21
  합계                                                     ≈ 851 행/일 (+ 실패 즉시 행·missing 행)
대안(60분 미만 잡 전부 롤업): 72 + 4×24 + 24 + 14 + 21      ≈ 227 행/일
judgment_run         국내 1(평일·공휴일) + 해외 1~3(재시도)  ≈ 2~4 행/일
judgment_candidate   후보 + 종목 단계 제외                 ≈ 10~60 행/일 (10-28 국내 후보 8건 [설계서 §2.6])
```

행당 약 400~450바이트(인덱스 포함) [추측] → `job_run_log` 약 850행/일 ≈ 0.4MB/일 ≈ 연 140MB, 대안이면 연 약 40MB. 판단 기록은 연 수 MB. 설계서 §8.4 의 "DB 증가 월 100MB 이하"[추측] 안이다.

**조회 패턴별 인덱스**

| 조회 | 쿼리 모양 | 인덱스 |
|---|---|---|
| 가동률(날짜·시장) | `WHERE session_date_kst BETWEEN ? AND ? AND market = ?` | `idx_session_market` |
| 잡별 최근 상태 | `WHERE job_id = ? ORDER BY started_at DESC LIMIT 1` | `idx_job_started` |
| 슬롯 존재 확인(재대사) | `WHERE job_id = ? AND scheduled_slot_at = ?` | `uq_job_slot_recorder`(앞 두 열) |
| 후보·제외 추이 | `judgment_run` 을 `(market, session_d0, role)` 로 → `judgment_candidate` 를 `judgment_run_id` 로 | `idx_market_session` · `uq_run_symbol`(앞 열) |
| 종목별 판단 이력·사후 성과 | `WHERE symbol = ?` | `idx_symbol` |
| 카드 → 판단 | `WHERE signal_id = ?` | `idx_signal` |

**보존·정리(제안)** — 삭제 연산은 모두 **사용자 승인 사안**이다(설계서 §9.5 "삭제 없음" 원칙). 처음에는 아무것도 지우지 않는다.

| 대상 | 제안 | 시점 |
|---|---|---|
| `job_run_log` 주기 잡 실행 행 | 90일 뒤 시간 롤업으로 접고 원 행 삭제 | 90일이 차는 시점(약 2027-01 말)에 사용자에게 묻는다 |
| `job_run_log` 하루 1회·peek·롤업·missing | 보존(연 약 1.3만 행) | — |
| `judgment_*` | 보존(증거, 연 수 MB) | — |

---

## 7. 적용·시험 절차 (계획만 — 이 단계에서 실행하지 않음)

### 7.1 일회용 MariaDB 시험 (T-088·T-116 선례)

1. 127.0.0.1 에만 묶은 일회용 MariaDB 10.11.x 컨테이너(T-116 은 10.11.19, 서버 기본 utf8mb3·운영과 같은 `sql_mode`). **만들지 결정은 구현 단계 Reviewer/QA 몫이다** — 이번에는 실행 중인 것이 없어 문법을 검증하지 못했다.
2. DDL 2회 연속 적용(멱등) → `SHOW CREATE TABLE` 3개: 문자셋 utf8mb4, 이름 붙인 CHECK 10개(+ JSON 열의 자동 `json_valid`), 인덱스.
3. CHECK 동작: `missing` + `started_at` 있음 거부, `started_at` NULL + `ok` 거부, `counts_json` 2049자 거부, `prompt_sha256` 대문자·63자 거부, `sent_to_llm=0` + `ai_decision='SKIP'` 거부 — strict 와 비 strict 두 `sql_mode` 에서.
4. ODKU: 같은 줄 2회 → `attempt` 불변, 새 시도 → +1, `started_at` 유지·`ended_at` 증가, 대입 순서 뒤집기 변이가 잡히는지.
5. `ai_reasoning` 501자·이모지(4바이트) — 앱이 자르기 전 값으로 strict 모드 오류가 나는지(앱이 자르지 않으면 기록 실패 → 삼킴 확인).
6. NULL 슬롯 2행이 UNIQUE 를 통과하는지(임의 실행은 중복 방지 대상이 아님을 확인).

### 7.2 운영 적용 (사용자 건별 승인 뒤)

1. 승인 원문을 task 이력서에 기록 → 적용 파일 sha256 기록.
2. 적용 직전 `SHOW TABLES LIKE 'job_run_log'`, `SHOW TABLES LIKE 'judgment\_%'` 빈 결과 확인(있으면 `SHOW CREATE TABLE` 대조 후 중단).
3. T-116 과 같은 `dbq.py -f` 로 적용(파일 1개, 위치는 이번에 확인하지 않음) → `SHOW CREATE TABLE` 3개를 task 이력서에.
4. 순서: 공동 인계서 J2 의 건별 직렬(T-112 → 단계 1a 첫 DDL). 스위치 ON 은 별도 승인(T-116 처럼 DDL → 배포 → 스위치 순).
5. 롤백: 스위치 끄기(즉시, 데이터 보존) → 코드 `git revert` → `DROP` 은 사용자 승인.
6. 공동 인계서 §10 대장에는 배포·스위치 시각만 남긴다(판단 불변·기록 전용).

### 7.3 구현 단계 시험 목록 초안

| # | 영역 | 시험 | 변이 후보(잡혀야 함) |
|---|---|---|---|
| 1 | 러너 | 후크가 있어도 잡 호출 순서·날짜파일·`CALL_LAST_CODE`·해외 분석 재시도가 기존 시험(`test-cron-runner-*.sh` 6개)과 같다 | 후크가 `CALL_LAST_CODE` 를 덮어씀 |
| 2 | 러너 | 스풀 디렉터리 쓰기 불가·디스크 가득 → 잡 동작 동일, 러너 생존 | `|| true` 제거 |
| 3 | 러너 | `set -u` 아래 정의 안 된 변수 경로 | `${VAR:-}` → `$VAR` |
| 4 | 러너 | 기록 라우트 다운(000)·지연 → 스풀 유지, 다음 틱 재전송, 틱 경과 150초 이상이면 전송 생략 | 생략 조건 제거 → 하트비트 시험 실패 |
| 5 | 러너 | 가짜 느린 curl 로 최악 틱(08시) 하트비트 나이 < 300초 | 전송 `--max-time` 제거 |
| 6 | 러너 | 본문에 따옴표·줄바꿈·탭·비 ASCII → 스풀 한 줄 유지(base64) | base64 대신 원문 |
| 7 | 라우트 | 비밀 없음 → 401, 크기 초과 → 413 | 인증 호출 제거 |
| 8 | 라우트 | 분류기: 200 정상 / 200 `skipped` / 국내 분석 200 + `ai_fail` / 503 `in_progress` / 000 + curl 28 / `"ok":false` | 국내 `ai_fail` 을 `ok` 로 |
| 9 | 라우트 | 슬롯 표 ↔ 러너 라벨 정합(러너 소스에서 `call … "<라벨>"` 을 뽑아 대조, peek 21개 포함) | 표에서 잡 하나 삭제 |
| 10 | 라우트 | 서머타임: holdings-premarket 슬롯이 11-01 전후 KST 21:00/22:00, `session_date_et` 정확 | ET 대신 KST 고정 |
| 11 | 라우트 | 재전송 멱등(같은 줄 2회 → 행 1·`attempt` 불변), 응답 본문 원문 미저장 | ODKU 대입 순서 |
| 12 | 라우트 | DB 지연 → 2.5초 안 비-200, 테이블 없음·스위치 꺼짐 → 200 + 버림 | 상한 제거 |
| 13 | 엔진 | 기록기 정상·예외·무한 대기·테이블 없음·스위치 꺼짐 → 반환값·카드 INSERT 인자 동일(국내 골든 + 해외) | 기록 호출의 `catch` 제거 |
| 14 | 엔진 | 분기별 `exclusion_code`(§3.4 의 13개 경로) — LLM 후보 전부가 정확히 1행 | 코드 두 개 맞바꿈 |
| 15 | 엔진 | ai_fail·ai_parse_fail·LLM 후보 0·insert_fail 경로에서도 헤더가 남는다 | 조기 반환 경로 하나에서 기록 누락 |
| 16 | 엔진 | 해외 기록이 트랜잭션 연결을 쓰지 않는다(호출 대상 감시) | 기록에 `conn` 전달 |
| 17 | 엔진 | `prompt_sha256` = `runLlm` 에 넘긴 문자열의 sha256 | 프롬프트 생성 전 문자열로 해시 |
| 18 | 경계 | 시그널·주문·안전장치 경로가 `judgment_*` 를 읽지 않는다(정적 import 시험 — `isolation.test.ts` 방식) | 허용 목록 확대 |

---

## 8. 열린 질문

**사용자에게 (결정 5건)**

| # | 질문 | 선택지 | 권고·근거 |
|---|---|---|---|
| U1 | §9.5 대비 변경 4건(D-a~D-d)을 받아들이는가 | 받아들임 / §9.5 그대로(충돌·재시도 횟수 손실 감수) | 받아들임 — §0-2 |
| U2 | 60분 미만 주기 잡을 실행마다 남길까, 시간 롤업할까 | 실행마다(약 850행/일) / 롤업(약 230행/일, 실패는 즉시 1줄) | 롤업 — T-108 계약 초안 E2 의 분석·데이터 잡 그룹에 strategy-eval·trade-report·signal-* 가 없고 매 분 롤업도 지표 대상이 아니라고 적었다 [확실: 계약 110·118행]. 매 5분 잡의 개별 이력은 pm2 로그가 있다 |
| U3 | DDL 승인 단위 | 파일 1개(3테이블, 승인 1회) / 2개(`job_run_log` 먼저) | 1개 — 둘 다 4주 관찰 증거라 같이 시작해야 의미가 있다. 엔진 기록 구현이 늦어지면 2개 |
| U4 | AI 판단 근거(SKIP 포함)를 저장하는가 | 저장(500자) / 저장 안 함 | 저장 — 판단 비교(T-109·단계 3)와 오독 사례 확인(T-124)에 필요, 연 수 MB |
| U5 | 주기 잡 원 행 90일 뒤 정리 | 그때 묻기 / 지금 규칙만 승인 / 정리 안 함 | 그때 묻기 — 삭제는 건별 승인 |

**Analyst 에게**: ① "정상 회차"에 재시도 성공을 넣는가(E9) ② 해외 503 data_unknown 을 `failed` 로 셀지 `degraded` 로 셀지(E16) ③ 규칙 후보를 패턴 단위로 셀지 종목 단위로 셀지(E17 — `rule_hits` 열 필요 여부) ④ 기준가·환율 열이 `daily_bars` 기반 사후 성과에 정말 필요한지(E18) ⑤ 국내 D0 를 "마지막 봉 날짜"로 정의하는 데 동의하는가(공휴일 실행). 계약은 `counts_json` 이름을 이미 쓴다(E4 해소).

**Reviewer 에게**: R1 스풀 방식 B 와 생략 임계 150초가 맞는가(실측 전 추정) · R2 분석 기록을 기다리지 않는 방식(E14)이 허용되는가 · R3 기록기 위치(`src/lib/strategy/` 아래 vs 새 디렉터리 + `SAFETY_PATHS` 추가) · R4 `missing` 합성을 기록 라우트가 매시 하는 안 vs 별도 잡 vs 조회 시 계산(행 없음) — 별도 잡이면 T-104 J8 에 따라 잡 정의에 등록해야 한다.

---

## 9. 검증 이력과 한계

- **한 것**: 위 §1 의 문서·소스 정독, `SAFETY_PATHS` 확인, 서버 읽기 전용 확인(일회용 DB 유무·bash/jq/base64 버전). 계산(행 수·키 길이·틱 시간)은 손으로 했다.
- **하지 않은 것**: DDL 실행(일회용 포함 — **문법 미검증**), 운영 DB 조회, 코드 변경, 라우트 응답 실측, 지연 실측.
- **확신이 낮은 곳**: 틱·POST·줄 쓰기 시간(전부 [추측]), 하루 행 수(틱 수 근사), 행 크기, ODKU 대입 순서 동작(일회용 DB 에서 확인할 것), 상주 프로세스에서 기다리지 않는 Promise 의 완료(가능성 높음), 다른 라우트 본문 모양(미확인), T-108 계약과의 실제 일치(미작성).
- **다음**: Leader 가 T-108 지표 계약 초안과 §4 를 대조(G-J1) → 사용자 결정 U1~U5 → (승인 시) 구현 task: Judge 접수(R2, Codex 필수) → 일회용 DB 시험 → Developer → Reviewer → QA → DDL 적용 승인 → 배포 → 스위치 ON.

-- T-167 — 거시 레짐 라벨 이관: eval_funnel 최종 pass run 행의 detail.macroRegime 을 macro_regime_label_log 로 옮긴다(멱등 — 몇 번 다시 돌려도 같은 결과).
--   전제: T-167-macro-regime-label-log.sql(DDL)이 먼저 적용돼 있어야 한다(없으면 1146 으로 실패할 뿐 아무것도 바뀌지 않는다).
--   바꾸는 것: macro_regime_label_log 에 행 추가(INSERT … SELECT 1문장)뿐이다. eval_funnel 은 읽기만 한다(행 변경·삭제 없음).
--   DDL 과 파일을 나눈 이유: DDL 은 1회, 이관은 코드 배포 뒤 한 번 더 돌려 그 사이 런을 메운다(아래 적용 순서 ⑤).
--
-- ⚠ 사람이 직접 적용한다(앱이 실행하지 않는다). 장외 창 실행을 권장한다:
--     mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < scripts/migrations/T-167-macro-regime-label-backfill.sql
--   권장 적용 순서(T-167 Leader G6): ① DDL(장외 창) → ② 이 이관 1차 → ③ push(웹 0.8.0 배포) → ④ 배포 뒤 첫 장중 런 기록 확인 →
--   ⑤ 이 이관 2차(멱등 — ①~③ 사이 런을 메운다) → ⑥ 아래 확인·대조 쿼리(삭제 전 마지막 대조 포함).
--   🔴 마감: 첫 라벨 행 eval_funnel id 904956 = 2026-11-12 10:20:40 KST → eval_funnel 정리로 **2026-12-12 10:20 KST 이후 첫 prune 부터 삭제**된다.
--   이관은 그 전에(권장 여유 2026-12-05 이전). 원본이 지워진 런은 되살릴 수 없다.
--
-- 대상: eval_funnel 중 gate='run' · verdict='pass' · ts >= '2026-11-12 00:00:00'(T-165 첫 배포일) · ts < NOW() − 2분 · detail.macroRegime 이 JSON 객체인 행,
--   그리고 같은 (run_id, as_of_utc) 행이 아직 이 표에 없는 것(NOT EXISTS — 실시간이 이미 쓴 런은 건너뛴다).
--   상한 ts < NOW() − 2분(Codex C1 지적 3 — Leader 채택): 막 끝난 런은 실시간 기록기(flush 뒤 상한 4초)가 쓰는 중일 수 있으므로 이관이 집지 않는다.
--   그 런은 실시간이 쓰거나 다음 재실행이 잡는다.
-- 🔴 원본 중복은 가장 작은 id 하나만 옮긴다(대조 쿼리 ⓑ 로 수 확인)(G10 R-1 — Reviewer 1차 발견): 같은 시장의 두 런이 같은 분에 시작해 같은 초에 끝나면
--   eval_funnel 에 같은 (run_id, as_of_utc) 행이 2개 생긴다(G9-1 한계). 둘 다 옮기려 하면 이 문장이 1062 로 **매번** 실패해 이관 전체가 막히므로,
--   키마다 eval_funnel.id 가 가장 작은 행 하나만 옮기고(ROW_NUMBER … = 1) 나머지 관측은 남기지 않는다 — 몇 개를 버렸는지는 ⓑ 가 숫자로 보여 준다.
-- 🔴 1062 가 나면: 이 INSERT 는 **문장 전체가 0행으로 롤백**된다(부분 반영 없음). 그대로 **다시 실행하면 된다(멱등)** — 실시간 기록과 경합한 드문 경우다.
--   그래도 1062 가 반복되면 장중 실시간 경합이다 — 장외에 다시 실행한다(원본 중복은 위 규칙으로 1062 를 내지 않는다).
--   다른 오류(strict 변환 실패 등)도 같은 이유로 0행이다 — INSERT IGNORE 를 쓰지 않는 이유(IGNORE 는 변환 실패를 경고로 낮춰 숨긴다).
-- 잠금: READ COMMITTED — 원본 eval_funnel 을 잠금 없는 일관 읽기로 훑는다. REPEATABLE READ 의 INSERT … SELECT 는 원본 범위에 공유 잠금을 걸어
--   엔진의 eval_funnel INSERT(런 끝 await rec.flush())를 막을 수 있다. 잠금 대기 상한 5초(운영 innodb_lock_wait_timeout 50·lock_wait_timeout 86400 대신).
--   이 세션 설정은 이 연결에만 걸린다(운영 binlog_format = ROW 라 READ COMMITTED 쓰기가 허용된다).
-- 변환(Analyst A7): 불리언 = JSON_EXTRACT 결과 'true'/'false' 의 CASE(명시적) · JSON null·경로 없음 = SQL NULL · 숫자 = CAST(JSON_VALUE … AS DECIMAL/SIGNED) ·
--   날짜시각 = STR_TO_DATE(NULLIF(…,''),'%Y-%m-%dT%H:%i:%sZ')(🔴 STR_TO_DATE('') 는 NULL 이 아니라 0000-00-00 을 돌려주므로 NULLIF 필수) ·
--   날짜·월 문자열 = NULLIF(…,'') · reason_codes = JSON 배열을 쉼표 결합(빈 배열 = '') · record_json = JSON_COMPACT(JSON_EXTRACT(…)) — 앱 JSON.stringify 원문과 같은 바이트 ·
--   as_of_utc = asOfUtc(없거나 빈 값이면 eval_funnel.ts − 9시간 폴백) · as_of_kst = CONVERT_TZ(as_of_utc,'+00:00','+09:00')(오프셋 표기 — tz 표 불필요) ·
--   source = 'backfill' · source_eval_funnel_id = eval_funnel.id · source_ts_kst = eval_funnel.ts · engine_release = NULL.
-- 정본: T-167 task Analyst A2·A3·A7 · Leader G2·G6·G9.

SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET SESSION innodb_lock_wait_timeout = 5;
SET SESSION lock_wait_timeout = 5;

INSERT INTO macro_regime_label_log (
  source, source_eval_funnel_id, source_ts_kst, run_id, market, as_of_utc, as_of_kst, as_of_et_date,
  rule_version, label, is_type5, reason_codes, reason_first, reason_count,
  cpi_fetch_status, cpi_reference_month, cpi_expected_reference_month, cpi_lags_schedule, cpi_release_at_utc,
  cpi_index, cpi_base_month, cpi_base_index, cpi_yoy_pct_raw, cpi_yoy_pct, cpi_hot, cpi_month_gap,
  cpi_fetched_at_utc, cpi_cache_age_sec,
  rate_upper_pct, rate_upper_effective_from, rate_compare_date, rate_upper_6m_ago_pct, rate_delta_pct, rate_direction,
  rate_table_verified_through, rate_next_known_decision_date,
  engine_release, record_json
)
SELECT
  'backfill',
  x.id,
  x.ts,
  x.run_id,
  x.market,
  x.as_of_utc,
  CONVERT_TZ(x.as_of_utc, '+00:00', '+09:00'),
  NULLIF(JSON_VALUE(x.mr, '$.asOfEtDate'), ''),
  JSON_VALUE(x.mr, '$.ruleVersion'),
  JSON_VALUE(x.mr, '$.label'),
  CASE JSON_EXTRACT(x.mr, '$.isType5') WHEN 'true' THEN 1 WHEN 'false' THEN 0 ELSE NULL END,
  REPLACE(REPLACE(REPLACE(JSON_COMPACT(JSON_EXTRACT(x.mr, '$.reasonCodes')), '[', ''), ']', ''), '"', ''),
  JSON_VALUE(x.mr, '$.reasonCodes[0]'),
  JSON_LENGTH(x.mr, '$.reasonCodes'),
  JSON_VALUE(x.mr, '$.cpi.fetchStatus'),
  NULLIF(JSON_VALUE(x.mr, '$.cpi.referenceMonth'), ''),
  NULLIF(JSON_VALUE(x.mr, '$.cpi.expectedReferenceMonth'), ''),
  CASE JSON_EXTRACT(x.mr, '$.cpi.lagsSchedule') WHEN 'true' THEN 1 WHEN 'false' THEN 0 ELSE NULL END,
  STR_TO_DATE(NULLIF(JSON_VALUE(x.mr, '$.cpi.releaseAtUtc'), ''), '%Y-%m-%dT%H:%i:%sZ'),
  CAST(JSON_VALUE(x.mr, '$.cpi.index') AS DECIMAL(12,4)),
  NULLIF(JSON_VALUE(x.mr, '$.cpi.baseMonth'), ''),
  CAST(JSON_VALUE(x.mr, '$.cpi.baseIndex') AS DECIMAL(12,4)),
  CAST(JSON_VALUE(x.mr, '$.cpi.yoyPctRaw') AS DECIMAL(10,4)),
  CAST(JSON_VALUE(x.mr, '$.cpi.yoyPct') AS DECIMAL(6,1)),
  CASE JSON_EXTRACT(x.mr, '$.cpi.hot') WHEN 'true' THEN 1 WHEN 'false' THEN 0 ELSE NULL END,
  CAST(JSON_VALUE(x.mr, '$.cpi.monthGap') AS SIGNED),
  STR_TO_DATE(NULLIF(JSON_VALUE(x.mr, '$.cpi.fetchedAtUtc'), ''), '%Y-%m-%dT%H:%i:%sZ'),
  CAST(JSON_VALUE(x.mr, '$.cpi.cacheAgeSec') AS SIGNED),
  CAST(JSON_VALUE(x.mr, '$.rate.upperPct') AS DECIMAL(6,2)),
  NULLIF(JSON_VALUE(x.mr, '$.rate.upperEffectiveFrom'), ''),
  NULLIF(JSON_VALUE(x.mr, '$.rate.compareDate'), ''),
  CAST(JSON_VALUE(x.mr, '$.rate.upper6mAgoPct') AS DECIMAL(6,2)),
  CAST(JSON_VALUE(x.mr, '$.rate.deltaPct') AS DECIMAL(6,2)),
  JSON_VALUE(x.mr, '$.rate.direction'),
  NULLIF(JSON_VALUE(x.mr, '$.rate.tableVerifiedThrough'), ''),
  NULLIF(JSON_VALUE(x.mr, '$.rate.nextKnownDecisionDate'), ''),
  NULL,
  JSON_COMPACT(x.mr)
FROM (
  SELECT
    y.*,
    ROW_NUMBER() OVER (PARTITION BY y.run_id, y.as_of_utc ORDER BY y.id) AS rn   -- 원본 중복(같은 키 2행 이상)은 가장 작은 id 만(G10 R-1)
  FROM (
    SELECT
      ef.id,
      ef.ts,
      ef.run_id,
      ef.market,
      JSON_EXTRACT(ef.detail, '$.macroRegime') AS mr,
      COALESCE(
        STR_TO_DATE(NULLIF(JSON_VALUE(ef.detail, '$.macroRegime.asOfUtc'), ''), '%Y-%m-%dT%H:%i:%sZ'),
        CONVERT_TZ(ef.ts, '+09:00', '+00:00')
      ) AS as_of_utc
    FROM eval_funnel ef
    WHERE ef.gate = 'run'
      AND ef.verdict = 'pass'
      AND ef.ts >= '2026-11-12 00:00:00'
      AND ef.ts < NOW() - INTERVAL 2 MINUTE
      AND JSON_TYPE(JSON_EXTRACT(ef.detail, '$.macroRegime')) = 'OBJECT'
  ) y
) x
WHERE x.rn = 1
  AND NOT EXISTS (
    SELECT 1 FROM macro_regime_label_log m
    WHERE m.run_id = x.run_id AND m.as_of_utc = x.as_of_utc
  )
ORDER BY x.id;

-- ─── 확인·대조 쿼리(실행하지 않는 주석 — 이관 뒤 사람이 하나씩 돌린다. 운영 조회라 사용자 승인 게이트에 포함) ────────────────
-- 아래 [check:…] 블록은 일회용 MariaDB 시험(label-log-disposable-mariadb.test.ts)이 주석을 벗겨 그대로 실행해 문법·결과를 확인한다
-- (블록 안에서 「-- 」 뒤 공백 3칸으로 시작하는 줄이 SQL 이고, 공백 1칸 줄은 설명이다).
-- 공통 대상 조건은 위 INSERT 의 원본 조건과 같다(ts 상한 포함). 「대상 런」= 그 조건의 eval_funnel 행.
--
-- [check:1] 원본 대상 수 = 이관 행 수 + 같은 런의 실시간 행 수. 기대: ef_targets = backfill_rows_with_source + live_rows_same_runs (ⓑ 충돌이 0일 때).
-- backfill_rows_with_source 는 원본이 아직 남아 있는 이관 행만 센다(원본이 30일 삭제로 사라진 뒤에는 이 대조를 쓰지 않는다).
--   SELECT
--     (SELECT COUNT(*) FROM eval_funnel ef WHERE ef.gate = 'run' AND ef.verdict = 'pass' AND ef.ts >= '2026-11-12 00:00:00' AND ef.ts < NOW() - INTERVAL 2 MINUTE
--        AND JSON_TYPE(JSON_EXTRACT(ef.detail, '$.macroRegime')) = 'OBJECT') AS ef_targets,
--     (SELECT COUNT(*) FROM macro_regime_label_log m JOIN eval_funnel ef ON ef.id = m.source_eval_funnel_id WHERE m.source = 'backfill') AS backfill_rows_with_source,
--     (SELECT COUNT(*) FROM macro_regime_label_log m WHERE m.source = 'live' AND EXISTS (
--        SELECT 1 FROM eval_funnel ef WHERE ef.gate = 'run' AND ef.verdict = 'pass' AND ef.ts >= '2026-11-12 00:00:00' AND ef.ts < NOW() - INTERVAL 2 MINUTE
--          AND JSON_TYPE(JSON_EXTRACT(ef.detail, '$.macroRegime')) = 'OBJECT' AND ef.run_id = m.run_id
--          AND COALESCE(STR_TO_DATE(NULLIF(JSON_VALUE(ef.detail, '$.macroRegime.asOfUtc'), ''), '%Y-%m-%dT%H:%i:%sZ'), CONVERT_TZ(ef.ts, '+09:00', '+00:00')) = m.as_of_utc
--      )) AS live_rows_same_runs;
--
-- [check:2] record_json 바이트 대조 — 불일치 0 이어야 한다(이관 행은 원본 id 로, 실시간 행은 (run_id, as_of_utc) 로 원본과 잇는다).
--   SELECT
--     (SELECT COUNT(*) FROM macro_regime_label_log m JOIN eval_funnel ef ON ef.id = m.source_eval_funnel_id
--        WHERE m.source = 'backfill' AND SHA2(m.record_json, 256) <> SHA2(JSON_COMPACT(JSON_EXTRACT(ef.detail, '$.macroRegime')), 256)) AS backfill_sha_mismatch,
--     (SELECT COUNT(*) FROM macro_regime_label_log m JOIN eval_funnel ef ON ef.run_id = m.run_id
--        AND ef.gate = 'run' AND ef.verdict = 'pass' AND JSON_TYPE(JSON_EXTRACT(ef.detail, '$.macroRegime')) = 'OBJECT'
--        AND STR_TO_DATE(NULLIF(JSON_VALUE(ef.detail, '$.macroRegime.asOfUtc'), ''), '%Y-%m-%dT%H:%i:%sZ') = m.as_of_utc
--        WHERE m.source = 'live' AND SHA2(m.record_json, 256) <> SHA2(JSON_COMPACT(JSON_EXTRACT(ef.detail, '$.macroRegime')), 256)) AS live_sha_mismatch;
--
-- [check:a] (Codex C1 지적 2) 대상 런 중 이 표에 (run_id, as_of_utc) 로 대응되지 않는 행 수 — 0 이어야 한다(아니면 이관을 다시 돌리고, 그래도 남으면 원인 조사).
--   SELECT COUNT(*) AS unmatched_ef_rows FROM eval_funnel ef
--   WHERE ef.gate = 'run' AND ef.verdict = 'pass' AND ef.ts >= '2026-11-12 00:00:00' AND ef.ts < NOW() - INTERVAL 2 MINUTE
--     AND JSON_TYPE(JSON_EXTRACT(ef.detail, '$.macroRegime')) = 'OBJECT'
--     AND NOT EXISTS (SELECT 1 FROM macro_regime_label_log m WHERE m.run_id = ef.run_id
--       AND m.as_of_utc = COALESCE(STR_TO_DATE(NULLIF(JSON_VALUE(ef.detail, '$.macroRegime.asOfUtc'), ''), '%Y-%m-%dT%H:%i:%sZ'), CONVERT_TZ(ef.ts, '+09:00', '+00:00')));
--
-- [check:b] (Codex C1 지적 1 · G10 R-1) 같은 (run_id, as_of_utc) 를 가진 대상 런이 2개 이상인 키 수 — 0 이 정상이다. 0 이 아니면 그 키마다 가장 작은 id 하나만 옮겨졌고
-- 나머지 런은 이 표에 남지 않았다(그 수만큼 ①·ⓒ 의 원본 쪽 수가 이 표보다 많고, ② 의 live 쪽은 버려진 중복 행 때문에 불일치를 셀 수 있다).
--   SELECT COUNT(*) AS collided_keys FROM (
--     SELECT ef.run_id,
--       COALESCE(STR_TO_DATE(NULLIF(JSON_VALUE(ef.detail, '$.macroRegime.asOfUtc'), ''), '%Y-%m-%dT%H:%i:%sZ'), CONVERT_TZ(ef.ts, '+09:00', '+00:00')) AS as_of_utc,
--       COUNT(*) AS n
--     FROM eval_funnel ef
--     WHERE ef.gate = 'run' AND ef.verdict = 'pass' AND ef.ts >= '2026-11-12 00:00:00' AND ef.ts < NOW() - INTERVAL 2 MINUTE
--       AND JSON_TYPE(JSON_EXTRACT(ef.detail, '$.macroRegime')) = 'OBJECT'
--     GROUP BY ef.run_id, as_of_utc HAVING COUNT(*) > 1
--   ) t;
--
-- [check:c] 일별(ET 날짜·시장) 행 수 비교 — eval_funnel 쪽 행이 남아 있는 날짜만. ef_rows 와 log_rows 가 다르면 그 날짜를 조사한다
-- (log_rows 가 더 많으면 eval_funnel 에 run 행이 없던 런 — EVAL_FUNNEL_ENABLED=false·flush 실패 — 이고, 더 적으면 이관 누락이나 ⓑ 충돌이다).
--   SELECT d.et_date, d.market, d.ef_rows, COALESCE(l.log_rows, 0) AS log_rows FROM (
--     SELECT CAST(NULLIF(JSON_VALUE(ef.detail, '$.macroRegime.asOfEtDate'), '') AS DATE) AS et_date, ef.market, COUNT(*) AS ef_rows
--     FROM eval_funnel ef
--     WHERE ef.gate = 'run' AND ef.verdict = 'pass' AND ef.ts >= '2026-11-12 00:00:00' AND ef.ts < NOW() - INTERVAL 2 MINUTE
--       AND JSON_TYPE(JSON_EXTRACT(ef.detail, '$.macroRegime')) = 'OBJECT'
--     GROUP BY et_date, ef.market
--   ) d LEFT JOIN (
--     SELECT as_of_et_date AS et_date, market, COUNT(*) AS log_rows FROM macro_regime_label_log GROUP BY as_of_et_date, market
--   ) l ON l.et_date <=> d.et_date AND l.market = d.market
--   ORDER BY d.et_date, d.market;

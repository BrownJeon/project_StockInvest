---
project: StockInvest
created: 2026-10-31
tags:
  - type/knowledge
  - type/runbook
  - domain/safety
aliases:
  - exit_judgment 첫 틱 검증
  - T-126 수동 점검
---

# T-126 `exit_judgment` 첫 틱 수동 검증 (예약 점검의 사람용 대체)

[[T-126-exit-judgment-persistence]] 의 기록 표 `exit_judgment` 는 10-31 15:41 에 만들어졌고 기록 스위치가 켜졌다(`exit_judgment_record_enabled=true`). 토요일 휴장이라 **아직 행이 한 줄도 없다(0행이 정상)**. 첫 행은 11-02(월) 국내 장중, 해외는 11-02 밤~11-03(화) 새벽에 처음 생긴다.

이 문서는 Claude 세션에 걸어 둔 예약 점검(11-02 09:22 국내 · 11-03 07:20 해외)이 **세션이 닫혀 사라졌을 때** 사람이 같은 일을 하도록 정리한 것이다. 모든 쿼리는 읽기 전용이고 2026-10-31 20:5x 에 운영 DB 에서 **구문만** 검증했다(표가 비어 있어 결과 행은 아직 본 적이 없다).

## 0. 쓰는 법

```bash
ssh -o BatchMode=yes -o ConnectTimeout=20 home_ubuntu      # 접속은 한 번만 열고 안에서 모두 실행 (SSH 접속 제한이 걸린 적이 있다)
```

DB 는 읽기 전용 도구로만 본다. 따옴표·백틱 문제를 피하려면 SQL 을 아래처럼 감싼다:

```bash
python3 -I ~/.node-local/tools/dbq.py -e "$(cat <<'SQL'
<여기에 SQL>
SQL
)"
```

날짜(`2026-11-02 09:00:00`)는 점검하는 날에 맞게 바꾼다. **쓰기는 하지 않는다**(예외: 4절 롤백 한 줄).

## 1. 전제 확인 (먼저 한다)

```sql
SELECT `key`,`value`,updated_at FROM system_config
 WHERE `key` IN ('exit_judgment_record_enabled','safety_dry_run','safety_kill_switch','exit_engine_enabled','exit_hard_stop_enabled','job_run_log_enabled')
 ORDER BY `key`;
```

기대값(10-31 20:5x 실측):

| 키 | 값 | updated_at |
|---|---|---|
| `exit_engine_enabled` | true | 10-30 09:08:29 |
| `exit_hard_stop_enabled` | false | 07-02 16:39:53 |
| `exit_judgment_record_enabled` | true | 10-31 15:41:54 |
| `job_run_log_enabled` | true | 10-30 21:05:27 |
| `safety_dry_run` | true | 10-30 09:08:14 |
| `safety_kill_switch` | false | 10-30 09:08:18 |

**어긋나면 이 점검보다 먼저 사용자에게 보고한다**(특히 `safety_dry_run` 이 false 면 청산 엔진이 실주문을 낼 수 있다). 현재 릴리스 이름: `basename "$(readlink -f /home/brownjeon/apps/stockinvest/current)"` → 10-31 20:52 기준 `20261031-192807-8ed1ba7b`(이후 배포가 있으면 달라진다).

## 2. 국내 — 11-02(월) 09:20 이후 (5분 틱이 몇 번 돈 뒤)

**Q1 틱별 행 수** — 틱마다 *보유 종목 수만큼*, 종목당 1행:

```sql
SELECT run_id, COUNT(*) AS n, COUNT(DISTINCT symbol) AS syms, MIN(evaluated_at) AS t0, MAX(evaluated_at) AS t1
  FROM exit_judgment
 WHERE market='domestic' AND evaluated_at >= '2026-11-02 09:00:00'
 GROUP BY run_id ORDER BY run_id;
```

**Q1b 같은 틱에서 `eval_funnel` 이 본 청산 종목 수**(비교 기준) — 위 `n` 과 `syms` 가 이 값과 같아야 한다:

```sql
SELECT run_id, COUNT(DISTINCT symbol) AS syms_in_funnel FROM eval_funnel
 WHERE market='domestic' AND side='sell' AND ts >= '2026-11-02 09:00:00'
   AND ((stage BETWEEN 21 AND 29 AND gate <> 'sell_proposal_preview') OR (gate='signal_created' AND strategy_id='exit-engine-v1'))
 GROUP BY run_id ORDER BY run_id;
```

(`sell_proposal_preview` 는 판정이 아닌 미리보기 행, 청산 발화 `signal_created` 만 `strategy_id='exit-engine-v1'`·단계 99, 나머지 청산 게이트는 단계 21~29 이고 `strategy_id` 가 NULL 이다 — 금요일 실데이터로 확인.)

**Q2 `decision_code` 가 같은 틱의 마지막 청산 게이트와 같은가** — 결과가 **0행이면 정상**:

```sql
SELECT j.run_id, j.symbol, j.decision, j.decision_code,
       (SELECT f.gate FROM eval_funnel f
         WHERE f.run_id=j.run_id AND f.symbol=j.symbol AND f.side='sell'
           AND ((f.stage BETWEEN 21 AND 29 AND f.gate <> 'sell_proposal_preview') OR (f.gate='signal_created' AND f.strategy_id='exit-engine-v1'))
         ORDER BY f.id DESC LIMIT 1) AS last_gate
  FROM exit_judgment j
 WHERE j.market='domestic' AND j.evaluated_at >= '2026-11-02 09:00:00'
HAVING last_gate IS NULL OR last_gate <> j.decision_code
 LIMIT 20;
```

설명 가능한 불일치: 시그널 생성 단계의 정책 스킵·실패(`signal_create_failed` 등은 단계 11 처럼 위 범위 밖) · 같은 분에 틱이 두 번 돌아 `run_id` 가 겹친 경우(Q7).

**Q3 발화(`fired`)는 시그널과 이어지는가** — 각 행의 `sig_id` 가 NULL 이 아니고 `side='sell'`:

```sql
SELECT j.judgment_id, j.symbol, j.trigger_kind, j.signal_id, s.id AS sig_id, s.side, s.status
  FROM exit_judgment j LEFT JOIN signals s ON s.id = j.signal_id
 WHERE j.decision='fired' AND j.evaluated_at >= '2026-11-02 09:00:00';
```

**Q4 분포와 부호** — `threshold_pct`: `eod_loss_cut`·`hard_stop` 은 음수, `target_profit` 은 양수, `trailing_stop`·`none` 은 NULL:

```sql
SELECT market, decision, decision_code, trigger_kind, COUNT(*) AS n,
       MIN(pnl_pct) AS pnl_min, MAX(pnl_pct) AS pnl_max, MIN(threshold_pct) AS thr_min, MAX(threshold_pct) AS thr_max
  FROM exit_judgment WHERE evaluated_at >= '2026-11-02 09:00:00'
 GROUP BY market, decision, decision_code, trigger_kind ORDER BY market, n DESC;
```

**Q5 나머지 열**:

```sql
SELECT market, currency, COUNT(*) AS n FROM exit_judgment WHERE evaluated_at >= '2026-11-02 09:00:00' GROUP BY market, currency;   -- 국내는 전부 'KRW'
SELECT engine_release, COUNT(*) AS n FROM exit_judgment GROUP BY engine_release;                                                   -- 1절의 현재 릴리스 이름과 같아야 한다
SELECT exit_engine_enabled, exit_hard_stop_enabled, COUNT(*) AS n FROM exit_judgment GROUP BY 1,2;                                -- 기대: (1,0)
SELECT COUNT(*) AS n, SUM(price IS NULL) AS price_null, SUM(pnl_pct IS NULL) AS pnl_null, SUM(currency IS NULL) AS cur_null
  FROM exit_judgment WHERE evaluated_at >= '2026-11-02 09:00:00';                                                                   -- 국내는 NULL 이 거의 없어야 한다
```

**Q7 같은 틱·종목 중복** — `run_id` 가 분 단위라 같은 분에 틱이 두 번 돌면 겹칠 수 있다(UNIQUE 를 일부러 안 걸었다). 이 경우 `evaluated_at`(초)으로 구분한다:

```sql
SELECT run_id, symbol, COUNT(*) AS c FROM exit_judgment WHERE evaluated_at >= '2026-11-02 09:00:00' GROUP BY run_id, symbol HAVING c > 1 LIMIT 10;
```

### 정상으로 보이는 모습 (금요일 10-30 실측 기준)

- 청산 게이트 중 흔한 것은 `exit_no_fire`(pass, 단계 24 — 금요일 65 틱)와 `exit_hard_stop_disabled`(skip, 단계 25 — **250행/120 틱**). 즉 **보유 종목이 손실 임계를 넘었는데 `exit_hard_stop_enabled=false` 이면 매 틱 `skip_policy / exit_hard_stop_disabled` 행**이 쌓이는 것이 정상이다.
- 10-30 15:26 국내 `eod_loss_cut` 발화(`signal_created`, 시그널 19743)는 `dry_run` 주문으로만 기록됐다. 같은 일이 생기면 `decision='fired'`·`decision_code='signal_created'`·`trigger_kind='eod_loss_cut'`·`threshold_pct<0` 행이어야 한다.
- 금요일 국내 틱당 청산 종목은 1개(15:07~15:26), 해외 틱당 4개(10-31 04:45~04:58) — 월요일 값은 실제 보유에 따른다.

### 행이 0 이라도 이상이 아닌 경우

보유 종목이 0 이거나, 그 틱이 **잔고 미확인**(`balances_unknown` — 보유 목록을 모르면 종목 행이 없다, 설계)이거나, 장이 닫힌 시각이거나, 스위치를 방금 켜서 캐시(30초)에 걸린 경우. 장중 몇 틱이 지나도 0 이고 `eval_funnel` 에는 청산 행(Q1b)이 있다면 그때부터 이상이다 → 3절.

## 3. 해외 — 11-03(화) 07:20 이후

미국 서머타임이 11-01 에 끝나 정규장은 **월요일 23:30 ~ 화요일 06:00 KST** 이다. 위 쿼리의 `market='overseas'`, 날짜를 `2026-11-02 22:00:00` 로 바꿔 쓰고 추가로:

```sql
SELECT run_id, COUNT(*) AS n, COUNT(DISTINCT symbol) AS syms, MIN(session_date_et) AS et0, MAX(session_date_et) AS et1, MIN(evaluated_at) AS t0, MAX(evaluated_at) AS t1
  FROM exit_judgment WHERE market='overseas' AND evaluated_at >= '2026-11-02 22:00:00' GROUP BY run_id ORDER BY run_id;
```

- `session_date_et` 는 **America/New_York 날짜**(월요일 장이면 `2026-11-02`), 국내 행은 NULL.
- `currency` 는 `'KRW'`(어댑터가 시세·평단을 원화로 환산) 또는 NULL(단위 검사 실패 — 비율이 [0.3, 3.0] 밖이거나 가격 없음). NULL 이 많으면 보고한다. `price`/`entry_price` 는 **원화 환산값**(수천~수십만 원대)이어야 한다.
- 알려진 한계: 환율을 못 얻어 시세·평단이 둘 다 달러 값(1배)이면 `'KRW'` 로 잘못 남는다 — 이 규칙으로 못 거른다.

## 4. 서버·프로세스 쪽 확인과 롤백

```sql
SELECT ID, TIME, LEFT(INFO,70) AS q FROM information_schema.PROCESSLIST
 WHERE (INFO LIKE '%job_run_log%' OR INFO LIKE '%judgment_%' OR INFO LIKE '%exit_judgment%') AND INFO NOT LIKE '%PROCESSLIST%';   -- 기록 표 INSERT 가 몇 초 넘게 남아 있으면 이상
```

앱 로그는 `~/.pm2/logs/` 가 아니라 **`/home/brownjeon/apps/stockinvest/shared/logs/{pm2-err,pm2-out,cron-err,cron-out}.log`** 다. 파일이 있어야 grep 0건이 의미가 있으니 `wc -l` 과 마지막 수정 시각(`date -r`)을 같이 본다. `cron-out.log` 는 `grep -a` 가 필요하다. **11-01(일) 04:15 부터 로그가 주 1회 회전**하므로([[stockinvest-log-rotation]]) 일요일 04:15 이전 시각을 찾을 때만 `*.log-20261101`(압축 전)도 본다 — 월요일·화요일 첫 틱 점검은 새 파일 안이다. 볼 것: `청산 판단 기록` 경고(분류어·errno·시장·개수만 찍힌다), `[exit-engine]` 오류 줄. `pm2 status` 에서 두 앱 restarts 0, `/api/health` green.

**이상 판단 기준**: 경고가 반복되거나, 기록 INSERT 가 몇 초 넘게 멈춰 있거나, 안전 키가 바뀐 경우. 이때는 **사용자에게 먼저 보고**한다. 이 기능은 *기록 전용*이라 끄는 것이 청산 평가·시그널·주문에 영향을 주지 않는다는 것이 설계(Reviewer 가 변경 전/후 동치 329건·QA 가 확인)다. 끄기(롤백):

```sql
UPDATE system_config SET value='false' WHERE `key`='exit_judgment_record_enabled';
```

서버 캐시가 30초라 최대 30초 뒤 멈춘다. 쌓인 기록은 보존된다. **`DROP TABLE exit_judgment` 는 기록이 사라지므로 사용자 승인 사항**이다. 켰다 끈 이유와 시각은 [[T-126-exit-judgment-persistence]] `## 배포 기록` 과 `20-Log/` 에 남긴다.

## 5. 결과 남기기

[[T-126-exit-judgment-persistence]] `## 배포 기록` 끝에 `- [시각] 첫 틱 검증(국내|해외) …` 한 줄로: 확인한 틱 수·종목 수, Q2 불일치 건수와 사유, `fired` 건수, 경고 유무, 이상 여부. 문서 커밋은 **서버에서** 파일을 명시해 `git add` 한 뒤 `git show :경로 | cmp - 경로` 로 대조하고 커밋한다(Mac 에서 방금 쓴 파일은 서버가 옛 내용으로 읽을 수 있다). push 하지 않는다 — push 는 곧 배포다.

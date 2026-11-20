---
task_id: T-181
title: 국내 시총 순위 조회 요청 파라미터 오류 수정 — 국내 universe 등급(core·satellite)이 매겨지지 않아 국내 매수 후보 전부가 코어 비율 가드에 막히는 문제
status: done
waiting: [domestic_session_observation, kill_switch_user_decision]
priority: high
project: StockInvest
created: 2026-11-20
updated: 2026-11-20
base_ref: 8d9e9803910dd45f6e2f99e7452509ae3f2b417c
risk_level: R2
roles_involved: [leader, judge, analyst, developer, reviewer, qa, deployer]
related_tasks: [T-176-universe-refresh-failure-isolation, T-168-paper-fill-engine-restore, T-175-outbound-connect-timeout-and-alert-retry]
tags:
  - type/task
  - domain/strategy
  - domain/kis
aliases:
  - 국내 시총 순위 파라미터 수정
  - 코어 비율 가드 국내 전면 차단
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: 원인 확인·설계부터 구현·감사·QA·서버 worktree 커밋까지. push(=운영 배포)는 사용자 승인 후
  last_event_id: E2
demo_gate:
  required: true
  level: "delta"
  status: "drafting"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: "DM-kw-risky-cta"
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-181 국내 시총 순위 조회 요청 파라미터 오류 수정

작업 worktree: 서버 `~/.node-local/stockinvest-t181` (detached, base `8d9e980` = origin/main = 운영 릴리스 `20261120-224257-8d9e9803` — 22:55 에 `72b9729` 에서 옮김: 그사이 T-180(m40 파일·기록만, 겹침 없음)이 배포됐다. `node_modules` 도 공유 트리 `node_modules` 로의 링크로 바꿨다 — 운영 릴리스 링크로는 `@workspace/*` 가 풀리지 않아 `next build` 가 실패했다). 커밋은 이 worktree 에서 한다(`commit-msg` 훅 — `src/lib/exchanges/` 는 `SAFETY_PATHS`). `node_modules` 는 `/home/brownjeon/apps/stockinvest/current/node_modules` 로의 심볼릭 링크다 — **스테이징하지 않는다.**

⚠ 같은 시각 다른 세션이 `~/.node-local/stockinvest-t180`(T-180 BRK 8-K, `src/lib/strategy/m40/**`)에서 작업 중이다. 그 폴더·파일은 건드리지 않는다.

## 목표·배경 (Leader)

2026-11-20 대기 항목 점검(메인 세션)에서 [[T-176-universe-refresh-failure-isolation]] WP-3 진단 로그가 KIS 의 거부 사유를 처음으로 보여 줬다. 국내 시총 순위 조회는 **KIS 장애가 아니라 우리 요청이 잘못돼서** 매번 빈 결과다. 그 결과 국내 universe 전 종목이 `speculative` 로 매겨지고, auto 모드의 코어 비율 가드(`portfolio_core_ratio`)가 국내 매수 후보를 전부 거른다. 국내 전략이 사실상 평가되지 않는 상태다(실주문은 DRY_RUN 으로 막혀 있어 자금 위험은 없다).

목표: 순위 조회가 KIS 규격대로 성공하게 고치고, 그 결과로 국내 universe 등급·구성이 **의도한 뜻**대로 매겨지게 한다. 단, 이 조회는 **실제로 한 번도 성공한 기록이 없다**(아래) — 고치면 "원래대로 복구"가 아니라 국내 universe 구성과 매수 관문 통과가 **처음으로** 바뀐다. 그래서 등급 기준은 analyst 가 설계하고 사용자 결정을 받는다.

### 확인한 사실 (Leader, 2026-11-20 21:37~22:30 KST 서버 읽기 전용 실측)

- 운영 로그(`/home/brownjeon/apps/stockinvest/shared/logs/pm2-out.log`·`pm2-err.log`) 11-20 13:26·14:27·15:28 [확실]:
  - 코스피: `[kis-domestic] 시총 순위 빈 결과 market=J(코스피) why=rt_cd http=200 rt_cd=2 msg_cd=OPSQ2001 msg1=ERROR INPUT FIELD NOT FOUND [FID_INPUT_PRICE_1]`
  - 코스닥: `market=Q(코스닥) why=rt_cd http=200 rt_cd=2 msg_cd=OPSQ2001 msg1=ERROR INVALID FID_COND_MRKT_DIV_CODE`
- 요청 코드: `src/lib/exchanges/kis-domestic.ts` `fetchMarketCapPage`(약 511행)·`fetchMarketCapRanking`. 파라미터는 `FID_COND_MRKT_DIV_CODE=market('J'|'Q')`·`FID_COND_SCR_DIV_CODE=20174`·`FID_INPUT_ISCD`·`FID_DIV_CLS_CODE=0`·`FID_BLNG_CLS_CODE=0`·`FID_TRGT_CLS_CODE=111111111`·`FID_TRGT_EXLS_CLS_CODE=0000000000`. 코스닥은 `fetchMarketCapPage('Q','1001')`. 이 함수는 저장소 최초 커밋(`4cfab6c`, 2026-04-26) 이후 바뀐 적이 없다.
- KIS 공식 예제(`koreainvestment/open-trading-api` `examples_llm/domestic_stock/market_cap/market_cap.py`·`chk_market_cap.py`, 2026-11-20 web-fetch 로 원문 확인) [확실 — 예제 기준]:
  - 요청 파라미터 9개: `fid_input_price_2`·`fid_cond_mrkt_div_code`·`fid_cond_scr_div_code`·`fid_div_cls_code`·`fid_input_iscd`·`fid_trgt_cls_code`·`fid_trgt_exls_cls_code`·`fid_input_price_1`·`fid_vol_cnt`. 빈 문자열 = 전체.
  - `fid_cond_mrkt_div_code` 는 예제 검증상 **`J` 만** 허용(문서 문자열은 "J:KRX, NX:NXT"). **`Q` 는 없다.** 시장 구분은 `fid_input_iscd`(0000 전체·0001 거래소·1001 코스닥·2001 코스피200)로 한다.
  - `fid_trgt_cls_code`·`fid_trgt_exls_cls_code` 예제 값은 `"0"`. `FID_BLNG_CLS_CODE` 는 예제에 없다.
  - 응답 `output` 필드(예제 `COLUMN_MAPPING`): `mksc_shrn_iscd`·`data_rank`·`hts_kor_isnm`·`stck_prpr`·`prdy_vrss`·`prdy_vrss_sign`·`prdy_ctrt`·`acml_vol`·`lstn_stcn`·`stck_avls`·`mrkt_whol_avls_rlim`. **`acml_tr_pbmn`(누적 거래대금)은 없다** — 지금 코드는 `quoteVolume: Number(o.acml_tr_pbmn)` 이라 고치면 `NaN` 이 된다(아래 위험 2).
  - 한 번 호출당 행 수: 예제에 명시 없음(확인 못 함). 연속조회는 응답 헤더 `tr_cont="M"` 이면 `tr_cont="N"` 으로 다음 페이지. **KIS 순위 계열 API 는 보통 30행 상한이라는 말이 있으나 [추측] — 실측 필요.**
- 성공 기록: api-usage 로그(10-25부터 27개 파일)에 `domestic.market-cap-ranking ok:true` **0건** [확실]. 그 이전은 기록이 없어 모른다. 다만 코스닥 `Q` 는 규격 밖이고 코드가 최초 커밋 그대로라 [가능성 높음] **처음부터 한 번도 성공하지 않았다.**
- 영향 실측(DB `eval_funnel`, 11-16 이후 국내 매수 깔때기) [확실]: `portfolio_core_ratio` skip 3,630 · `late_session_buy_block` 240 · `losing_position_buy_block` 115 · `prefilter_liquidity_dead` 89. 코어 비율 skip 은 10-21 부터 기록(10월 399건, 11월 3,869건). `symbol_universe` 국내 3,977행 **전부 `speculative`**. 국내 `paper_fills origin=engine` 11-14 이후 0건(해외는 하루 16~67건 정상).
- 순위 결과 쓰임새(`src/lib/strategy/universe.ts` `refreshUniverseImpl`): 순위가 있으면 ① 시총 순 1~100 = `core`, 101~200 = `satellite`(`TIER_CORE_LIMIT`·`TIER_SATELLITE_LIMIT`, "KOSPI 100/200 근사") ② 그 순위 목록을 `quoteVolume` 으로 정렬해 상위 `UNIVERSE_TOP_N`(150)을 분석 후보로 ③ `stock_meta` 이름 upsert. 순위가 비면 정적 목록 `ALL_SYMBOLS`(KOSPI_TOP+KOSDAQ_TOP)의 시세로 후보를 만들고 등급은 전부 `speculative`.

### 고치면 생기는 문제 — 설계에서 결정할 것 (analyst)

1. **행 수**: `fetchMarketCapRanking(200)` 은 코스피·코스닥 두 번 호출 결과를 합쳐 200까지 쓴다는 가정이다. 한 번에 30행이면 합쳐 60행 → 전부 `core`(1~100) 가 되고 satellite 는 0. "KOSPI 100/200 근사" 라는 뜻과 다르다. 연속조회로 200까지 채울지, 등급 기준을 바꿀지(예: 코스피 시총 상위만 core 등).
2. **거래대금 필드 부재**: `acml_tr_pbmn` 이 없으면 `quoteVolume` 이 `NaN` → 후보 정렬·`analyzeSymbol`·`Math.log(quoteVolume+1)` 점수가 깨진다. 대안: `acml_vol × stck_prpr` 근사 / 후보는 지금처럼 정적 목록 시세(`getKisTickers`)의 거래대금으로 고르고 순위는 **등급에만** 쓰기 등.
3. **universe 구성 변화**: 지금 국내 후보는 정적 목록(`ALL_SYMBOLS`)에서 나온다. 순위가 살아나면 후보가 순위 목록으로 바뀐다(코스닥 포함 여부·종목 수 달라짐). 코어 비율 가드도 처음으로 통과 후보를 내보낸다 → 국내 가상 체결이 생기기 시작한다(DRY_RUN 유지). 이 변화의 크기를 미리 가늠한다.
4. **부분 실패**: 한 시장 페이지만 성공하면? T-176 은 "부분 결과로 tier 를 매기면 뜻이 바뀐다"며 `Promise.all` 을 유지했다. 연속조회를 넣으면 페이지 일부 실패도 같은 원칙으로.
5. 호출량: 연속조회를 넣으면 갱신 1회(TTL 15분)당 KIS 호출이 늘어난다(유량 lane `bulk`).

### 실측 결과 (Leader, 2026-11-20 22:2x KST, 운영 KIS 읽기 전용 3회)

방법: 서버 `~/.node-local/t181-probe/probe.cjs`(저장소 밖) — DB 의 기존 토큰을 읽기만(만료 5분 전이면 중단, **새 발급 없음**), 앱키는 운영 `.env` 에서 읽어 헤더로만 사용·출력 안 함, 주문·DB 쓰기 없음. 파라미터는 공식 예제 그대로(`fid_cond_mrkt_div_code=J`, `fid_trgt_cls_code=0`, `fid_trgt_exls_cls_code=0`, `fid_input_price_1/2=''`, `fid_vol_cnt=''`, `FID_BLNG_CLS_CODE` 없음), 키는 소문자. [확실]

| fid_input_iscd | 결과 | 행 수 | 응답 `tr_cont` | 1위 / 30위 |
|---|---|---|---|---|
| 0001(거래소) | rt_cd=0 `MCA00000 정상처리` | 30 | 빈 값 | 삼성전자 avls 10,575,918 / 한국전력 164,022 |
| 1001(코스닥) | rt_cd=0 | 30 | 빈 값 | 알테오젠 120,921 / 티에스이 18,450 |
| 0000(전체) | rt_cd=0 | 30 | 빈 값 | 삼성전자 / 30위 **KODEX 200**(ETF 포함) |

- **한 번에 30행이 상한이고 연속조회 표시가 없다** → 시장당 30, 합쳐 최대 60행. `TIER_SATELLITE_LIMIT=200`·`TIER_CORE_LIMIT=100` 은 이 API 로는 채울 수 없다.
- 응답 필드 11개는 예제와 같고 **`acml_tr_pbmn` 없음**(→ `quoteVolume` 이 `NaN`). `stck_avls` 단위는 억원(삼성전자 10,575,918억 ≈ 1,058조 — 지금 코드의 `×1e8` 환산이 맞다).
- 코스닥 1위(알테오젠 12.1조)가 코스피 30위(한국전력 16.4조)보다 작다 → 두 목록을 시총으로 합치면 상위 30이 전부 코스피다.
- `0000` 은 ETF 가 섞인다(`isExcluded` 가 거르는지 확인 필요).

### 실측 결과 2 — 시세 응답의 시가총액·지수 표시 (Leader, 2026-11-20 22:4x KST, 운영 KIS 읽기 전용 44회)

방법: `~/.node-local/t181-probe/probe2.cjs`(저장소 밖, 위와 같은 토큰·비밀 취급), 운영 코드와 같은 `inquire-price`(`FHKST01010100`, `FID_COND_MRKT_DIV_CODE=J`)로 정적 목록 `KOSPI_TOP`+`KOSDAQ_TOP` 44개(중복 1) 각 1회, 250ms 간격. [확실]

- `hts_avls` 단위는 **억원**이다 — 005930 `10575918` 이 순위 API `stck_avls` 와 같다. 지금 `getTicker` 는 이 필드를 매핑하지 않는다.
- **`rprs_mrkt_kor_name`(대표 시장명)이 지수 편입을 알려 준다**: `KOSPI200` 33종목 · `KSQ150`(코스닥150) 9종목 · `KOSPI` 2종목. 임계값 추정 없이 "KOSPI 200" 이라는 원래 의도를 그대로 쓸 수 있다.
- 시총(억원) 분포: 1위 삼성전자 10,575,918 … 28위 042660 128,387 · 30위 030200 115,552(여기까지 코스닥은 29위 196170 하나) · KOSPI200 최소 000880 35,090 · KSQ150 최소 112040 4,906.
- 🔴 **정적 목록에 죽은 종목 2개**: `042670`·`091990` 은 `rt_cd=0` 이지만 가격·시총·상장주수가 전부 0 이다(합병 등으로 상장폐지된 코드로 보임 [가능성 높음] — 091990 셀트리온헬스케어는 2023-12 셀트리온에 합병). `247540` 은 두 목록에 중복.
- 지금 국내 실보유 005930 은 `KOSPI200`·시총 1위라 어느 기준이든 core 가 된다 → 코어 비율 가드는 현 계좌에서 사실상 전부 통과로 바뀐다(Analyst 계산과 같은 결론).

## 사용자 지시·승인 (원문 보존)

- 2026-11-20 22:1x KST, 대기 항목 점검 결과의 질문 「국내 순위 조회 파라미터 오류를 새 task로 고칠까요?」 에 사용자 답: 「새 task로 수정」.
- push(=운영 배포)·DDL·운영 DB 쓰기·안전 스위치 변경은 이 승인에 포함되지 않는다(별도 승인).
- 2026-11-20 22:4x KST(처음에 23:2x 로 잘못 적었다가 22:55 정정 — 서버·Mac 시계 22:5x 기준), 메인 세션 질문 카드 4문항에 대한 사용자 선택(카드 선택지 문구 그대로):
  - 등급 기준: 「지수 편입 기준 (권장)」 — KOSPI200 → core, 코스닥150 → satellite, 나머지 → speculative.
  - 순위 조회: 「갱신 경로에서 제거 (권장)」.
  - 변화 수용(국내 매수 후보가 코어 비율 가드를 처음 통과, 국내 가상 체결·감사 기록 하루 약 80~120건 추정, DRY_RUN 유지): 「수용하고 진행」.
  - 데모: 「데모 생략」. ⚠ `check.mjs waive --quote "데모 생략"` 은 `DEMO_GATE_REFUSED`(질문 카드 답은 사람 입력 턴 기록에 없음) — 게이트 상태는 `drafting`(init, `DM-kw-risky-cta`) 그대로이고 도구 증거는 없다. 화면 파일 변경이 없어 편집 전 훅 대상도 없다. 판정은 키워드 오탐으로 본다([[T-168-paper-fill-engine-restore]] 와 같은 유형).

- 2026-11-20 23:18 KST, PR #8 머지 시점 질문(권고: 다음 날 05:10 이후 — 미국 장중 재시작 영향 고지)에 사용자가 처음 「내일 05:10 이후」를 고른 뒤 바로 「지금 머지해줘」 로 바꿈 → 즉시 머지(=운영 배포) 승인. 미국 장중 배포는 사용자 합의 아래 진행(`docs/deploy-order.md` 「장중 임의 배포 — 사용자 합의 없이 하지 않는다」).

## 설계 (Leader — Developer 구현 사양)

사용자 결정(위)과 [Analyst 절](#analyst)·실측 결과 1·2 를 근거로 한다. 범위는 아래 파일과 그 시험뿐이다. **화면·DB 구조·주문·청산·안전장치 코드는 바꾸지 않는다.**

1. **`src/lib/exchanges/kis-domestic.ts` `getTicker`** — 반환값에 두 필드를 더한다(선택 필드, 해외·다른 호출부 영향 없게):
   - `marketCapKrw`: `Number(o.hts_avls) * 1e8`(단위 억원 — 실측 2). 유한수가 아니거나 0 이하면 `undefined`.
   - `indexTag`: `String(o.rprs_mrkt_kor_name ?? '').trim()` — 빈 문자열이면 `undefined`. 값 예: `KOSPI200`·`KSQ150`·`KOSPI`.
   - `Ticker` 타입(정의 위치는 developer 가 확인)에 두 필드를 **선택(optional)** 으로 추가. 기존 필드 계산은 그대로.
2. **`fetchMarketCapPage`·`fetchMarketCapRanking`** — 갱신 경로에서는 더 이상 부르지 않지만 함수는 규격대로 고쳐 둔다(실측 1에서 성공한 형태 그대로):
   - 쿼리: `fid_input_price_2=''`, `fid_cond_mrkt_div_code='J'`, `fid_cond_scr_div_code='20174'`, `fid_div_cls_code='0'`, `fid_input_iscd`(코스피 `0001`·코스닥 `1001`), `fid_trgt_cls_code='0'`, `fid_trgt_exls_cls_code='0'`, `fid_input_price_1=''`, `fid_vol_cnt=''`. 키는 실측과 같은 소문자. `FID_BLNG_CLS_CODE` 삭제. 코스닥도 `'J'` — 시장 구분은 `fid_input_iscd` 로만.
   - 응답에 `acml_tr_pbmn` 이 없으므로 반환 객체에서 `quoteVolume` 을 **없앤다**(NaN 을 만들지 않는다). 진단 로그(`logMarketCapEmpty`)의 시장 표기는 `iscd` 기준으로 맞춘다.
   - 다른 호출부가 있으면(developer 가 전수 확인) 그 쓰임에 맞게 고치고 보고. 없으면 export 유지(시험용).
3. **`src/lib/strategy/universe.ts` `refreshUniverseImpl` 국내 분기**:
   - `fetchMarketCapRankingOrEmpty` 호출을 제거한다. 후보는 지금 실제로 돌던 경로 그대로 `getKisTickers(ALL_SYMBOLS)` → 거래대금 정렬 → 상위 `UNIVERSE_TOP_N`.
   - 등급: 같은 시세 결과의 `indexTag` 로 매긴다 — `'KOSPI200'` → `core`, `'KSQ150'` → `satellite`, 그 밖·없음 → `speculative`(정확 일치, 대소문자·공백은 trim 후 대문자 비교). 시총(`marketCapKrw`)은 이번에는 등급에 쓰지 않는다(기록용으로 `score_detail` 등에 넣지 말 것 — 범위 밖).
   - 시세를 받은 종목이 1개 이상인데 `core`·`satellite` 가 **하나도 없으면** 경고 한 줄(`[universe:domestic] 지수 편입 표시 없음 — 전 종목 speculative`)을 남긴다(KIS 응답 형식이 바뀐 신호). 갱신은 계속한다.
   - `fetchMarketCapRankingOrEmpty` 와 그 순위 기반 `stock_meta` upsert 는 함께 제거(한 번도 실행된 적 없음). `TIER_CORE_LIMIT`·`TIER_SATELLITE_LIMIT` 는 더 쓰이지 않으면 삭제하고, 주석의 「시총 상위 1~100 = core (KOSPI 100 근사)」 류 설명을 새 기준으로 고친다.
   - `ALL_SYMBOLS` 는 중복 제거(`247540` 이 두 목록에 있다 — `[...new Set(...)]`). 죽은 코드 `042670`·`091990` 의 삭제는 **이번 범위 밖**(후속 후보로 남긴다).
4. **시험**: `universe-ranking-fallback-t176.test.ts`·`kis-market-cap-diag-t176.test.ts` 등 순위 호출을 전제하는 시험을 새 동작에 맞추되 **약화하지 않는다**(바꾼 단언마다 이유를 Developer 절에 적는다). 새 시험: ① `getTicker` 의 `hts_avls`·`rprs_mrkt_kor_name` 매핑(0·빈 값·비숫자) ② 등급 매핑(KOSPI200/KSQ150/KOSPI/없음/공백·소문자) ③ 갱신 경로가 순위 API 를 부르지 않음 ④ 전 종목 표시 없음 경고 ⑤ `fetchMarketCapPage` 쿼리 문자열이 위 9개 키·값과 정확히 같고 `FID_BLNG_CLS_CODE` 가 없음 ⑥ 중복 제거.
5. **버전**: 웹 표시 버전을 마이너 1단계 올린다(현재 값은 `package.json` 에서 확인 — 사용자 전달 단위 1회).
6. **실행 증빙**: `tsc --noEmit` · 관련 jest · 전체 jest 를 base(`72b9729`) 실패 목록과 이름 대조(새 실패 0) · `next build`. 무거운 시험은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 …` 직렬.
7. **커밋하지 않는다.** 구현이 끝나면 worktree 에 변경을 둔 채 보고한다(커밋은 Reviewer·QA 뒤 Leader).

후속 후보(이번 범위 밖): 정적 목록의 죽은 코드 2개 정리 · `lookupTier` 48시간 unknown 회귀(Analyst §6) · 시총 기반 세분(KOSPI100 근사)이 필요해지면 `marketCapKrw` 활용.

## Analyst

- [22:33] 범위·방법: 설계·분석만(실행 도구 claude, analyst). 코드는 서버 worktree `~/.node-local/stockinvest-t181`(base `72b9729`)에서 읽기만, DB 는 `dbq.py` 읽기 전용 조회만 했다. KIS 호출·시그널 생성·DB 쓰기·코드 수정 0건. 아래 수치 중 KIS 응답에 의존하는 것(시세의 시가총액 값, 종목별 등급 개수)은 직접 재지 못해 추정으로 표시했다.
- [22:33] 🔴 [확실] 가장 먼저 알아야 할 사실 — **이 가드를 여는 것은 "매수 후보의 등급"이 아니라 "지금 보유한 삼성전자의 등급"이다.** 계산식(`src/lib/strategy/portfolio-stability.ts:83-97` `calcCoreRatio`): `비율 = (보유 중 core 평가액 + (매수 종목이 core 면 매수 금액)) / (보유 평가액 합 + 매수 금액)`, 평가액 = 수량 × 평균단가, 보유 합이 0 이면 무조건 통과(1 반환). 임계는 `style.stableCoreRatioMin` = **0.20**(`style.ts:102`, `NUMERIC_FIELDS` 에 없어 DB 로 못 바꾸는 고정값). 국내·매수·auto 모드에서만 막는다(`portfolio-stability.ts:133-134`, `engine.ts:1244` — assist/manual 은 경고 라벨로 강등). 보유는 KIS 실계좌 국내 잔고다(`engine.ts:363-385` `getHeldAmounts` → `getBalancesDetailed`; 가상 체결은 포함되지 않는다).
- [22:33] [확실] 현재 국내 실보유는 **005930 삼성전자 13주 × 평균단가 238,000 = 3,094,000원 하나뿐**이다(쿼리: `broker_position_snapshots` market=domestic, as_of 11-10~11-20 매일 1행 동일). 005930 이 `speculative` 라서 core 평가액 0 → 어떤 종목을 사도 비율 0.0%. 실제로 11-16 이후 skip 3,630건 **전부** 상세가 `core 비율 0.0%` 다(쿼리: `eval_funnel` gate=portfolio_core_ratio, `detail LIKE '%core 비율 0.0%%'` = 3,630/3,630; 매수 종목 등급은 speculative 3,532 · unknown 98).
- [22:33] [확실 — 계산] 따라서 005930 이 core 가 되는 순간, 매수 종목의 등급과 무관하게 `3,094,000 / (3,094,000 + X) ≥ 0.20` ⇔ **1회 매수 금액 X ≤ 12,376,000원이면 전부 통과**한다(speculative·unknown 종목 포함). 계좌 총평가가 16.66백만원(`portfolio_snapshots` 11-20 21:42)이라 1회 주문이 이 금액을 넘을 가능성은 낮다 [가능성 높음]. 반대로 005930 을 전량 매도하면 보유 합 0 → 역시 전부 통과. 즉 **현 계좌에서 이 가드는 "전부 차단(지금)" 아니면 "전부 통과(수정 후)" 둘 중 하나**이고, 아래 대안 A·B·C 어느 것을 골라도 005930 은 core 가 되므로 **당장의 통과 건수는 대안 간 차이가 없다.** 대안의 차이는 (가) 앞으로 보유 구성이 바뀔 때의 의미 (나) 장애 시 동작 (다) 호출량·복잡도에서 난다.
- [22:33] [확실] 등급을 읽는 곳 전수(`grep tier|symbol_universe`, 시험 제외): ① `portfolio-stability.ts:43-54` `lookupTier`(가드 — 심볼의 **가장 최근 `symbol_universe` 행**의 tier, 없으면 unknown) ② `universe.ts:353-357` `getUniverseSymbols` 의 tier 필터 — 그러나 `engine.ts:1485` 가 `'volume-top'` 으로 고정이라 **죽은 분기**다 ③ `ai-filter.ts:140-191`·`rs-rating.ts` 는 `rank_pos`·rs 컬럼만 읽고 tier 는 안 읽는다. 결론: **살아 있는 의미는 "core 인가 아닌가" 하나뿐**이고 satellite 와 speculative 는 현재 동작상 구별되지 않는다. (참고: `style.ts:27` 의 `universeSource` 타입은 `'volume-top'|'top50'|'top200'`, `universe.ts` 는 `'kospi100'|'kospi200'` — 서로 안 맞는 죽은 설정이다. 이번 범위 밖, 기록만.)
- [22:33] [확실] 가드 뒤 경로: 통과한 매수 후보는 `publish` → `createSignalGuarded` → 검증 관문(`safety/validation-gate.ts:102`)으로 간다. `strategies` 16개 전부 `validation_status=unvalidated`(쿼리 확인)라 **실제 시그널·주문은 만들어지지 않고** 감사 경로(`engine.ts:1741-1759`, T-168)로 가상 체결(`paper_fills origin=engine`)과 진입 쿨다운 120분(`cooldowns.ts:30`) 선점만 생긴다. 가드 뒤에 AI 호출은 없다(`engine.ts:1773` 주석 「AI 관문이 사라져 여기가 곧 터미널」; 검증된 전략이 0개라 `allocateAdaptiveBuys` LLM 배분도 0회 — `engine.ts:1721`). DRY_RUN 과 검증 관문 두 겹이 그대로라 자금 위험은 없다.
- [22:33] [추측 — DB 재생 추정] 변화 크기: 11-16~11-20 skip 3,630건을 (종목, 전략) 쌍별로 "첫 건 통과 → 120분 쿨다운 동안 같은 쌍 억제" 로 재생하면 **5일 합 451건, 하루 76~116건**(11-16 80 · 11-17 76 · 11-18 116 · 11-19 87 · 11-20 92; 하루 고유 쌍은 46~66개)의 국내 가상 체결·감사 행이 새로 생긴다. 즉 가드 통과 자체는 3,630건(100%)이지만 대부분은 쿨다운 선점으로 사라져 실제 사건은 약 1/8 이다. 해외 실측(하루 16~67건)보다 조금 많다. 한계: 쿨다운 외 뒤쪽 관문(블랙리스트·중복 활성 시그널·가상 체결 기록 실패)은 재생에 넣지 않았고, 통과가 시작되면 후보 분포 자체가 달라질 수 있다. 전략별 skip 비중은 rsi-oversold-v1 1,929 · price-breakout-v1 1,387 · rsi-macd-reversal-v1 234 · pullback-trend-v1 50 · bb-breakout-v1 29 · rsi-divergence-v1 1.
- [22:33] 대안 A(순위 API 만 — 시장당 30행): [확실] 지금 코드 그대로 파라미터만 고치면 코스피 30 + 코스닥 30 = 60행 이하가 전부 `idx < 100` → **전부 core, satellite 0**(`universe.ts:239-243`). 코스닥 30위(티에스이 1.8조)가 core 인데 코스피 31~100위(최대 16조)는 speculative 가 되는 **역전**이 생겨 "KOSPI 100 근사" 의 뜻이 깨진다(A1 — 권하지 않음). 변형 A2: 코스피 30위까지만 core, 코스닥 30위까지 satellite, 나머지 speculative — 측정 가능한 값만 쓰고 뜻이 분명하지만 "KOSPI 30" 으로 원래 의도(100)보다 훨씬 좁다. 호출량: 갱신당 2회(현행과 같음). 실패 시: 순위가 비면 그 갱신분 전 종목이 speculative 로 **다시 기록**되고 `lookupTier` 는 최신 행을 읽으므로 그 15~20분 동안 국내 매수가 다시 전부 막힌다(차단 방향이라 안전하지만 통과·차단이 갱신마다 뒤바뀐다) → A 를 쓰려면 "마지막 성공 등급표" 캐시가 필수다. 또 분석 후보(정적 44종목) 중 순위 60행 밖 종목은 등급을 알 방법이 없다.
- [22:33] 대안 B(시세의 시가총액으로 종목별 산정 — 순위 API 의존 제거): [확실] 국내 갱신은 지금 매번 `getKisTickers(ALL_SYMBOLS)` 로 정적 목록 시세를 부른다(`universe.ts:250`, 순위가 비는 현재 실제 경로). 시세 API(`FHKST01010100`) 응답에 `hts_avls`(HTS 시가총액)·`lstn_stcn`·`rprs_mrkt_kor_name`·`acml_tr_pbmn` 이 있다 — KIS 공식 예제 `examples_llm/domestic_stock/inquire_price/chk_inquire_price.py` 의 `COLUMN_MAPPING` 원문 확인(오늘 web-fetch). 그러나 **코드는 이 값을 매핑하지 않는다** — `getTicker` 반환은 price·open/high/low·volume·quoteVolume 뿐(`kis-domestic.ts:108-118`), `Ticker` 타입에도 시총 필드가 없다(`exchanges/types.ts:53-67`). [가능성 높음 — 미실측] `hts_avls` 단위는 억원(순위 API `stck_avls` 와 같은 계열) — 예제에 단위 표기가 없어 **배포 전 1회 실측 필요**(005930 시세 1건에서 `hts_avls` ≈ 10,575,918 인지). 장점: 추가 호출 0(순위 2회가 없어져 오히려 −2), 등급이 종목 자기 데이터에서 나오므로 "한 시장만 성공" 이라는 부분 실패 개념 자체가 없음, 캐시 불필요, 분석하는 종목 전부에 등급이 매겨짐. 단점: ① 임계값(원 단위)을 정해야 하고 KOSPI 100위·200위 시총 경계를 KIS 로는 잴 수 없다(순위 30행 상한) ② 고정 원 금액은 지수 수준이 바뀌면 느슨해지거나 빡빡해진다(분기 1회 점검 필요) ③ `Ticker` 타입·`getTicker`(안전 경로) 수정이 필요하다.
- [22:33] 대안 C(혼합 — B + 순위 API 를 기준점으로): 순위 API 의 "코스피 30위 시총"(오늘 16.4조)을 받아 `core ≥ k1 × 30위 시총`, `satellite ≥ k2 × 30위 시총` 처럼 시장 수준에 따라 임계가 자동으로 움직이게 한다. 장점: 고정 금액의 낡음 문제 해소. 단점: k1·k2(100위/30위 비율 등)를 우리가 잴 수 없어 [추측] 값이 되고, 순위 API 실패 처리·캐시·호출 2회가 다시 필요해 A 의 약점을 그대로 가져온다. 이득에 비해 부품이 많다 — 권하지 않음.
- [22:33] "KOSPI 100/200 근사" 보존 정도 판단: A1 은 뜻이 깨짐(역전), A2 는 뜻은 분명하나 30으로 축소, B 는 임계를 100위 수준으로 잡으면 폭이 가장 가깝다(단 경계값이 추정), C 는 B 와 같되 자동 보정. 어느 것도 원래의 "200위까지 순위로" 는 이 API 로 구현 불가다 [확실 — Leader 실측: 30행 상한·연속조회 없음].
- [22:33] 대안별 등급 개수(최신 갱신분 11-20 15:28:37, 국내 100행·고유 41종목 — 쿼리: `symbol_universe` 최신 `refreshed_at` GROUP BY symbol): **전부 [추측]** — 종목별 시총을 이번에 못 쟀다(KIS 호출 금지, `stock_fundamentals` 국내는 5행뿐이고 AI 가 적은 낡은 값이라 못 씀). A1: core 약 28~34 · satellite 0. A2: core 약 20~25(코스피 30위 안) · satellite 약 5~9(코스닥 30위 안) · speculative 약 8~15. B(core ≥ 5조, satellite ≥ 2조 가정): core 약 30~35 · satellite 약 3~8 · speculative 0~5. 정확한 수는 Leader 탐침으로 읽기 전용 시세 44건(또는 순위 2건)을 한 번 더 부르면 확정된다 — 구현 전에 재기를 권한다.
- [22:33] 분석 후보(universe 구성) 권고: **지금처럼 정적 목록 시세의 거래대금 정렬을 유지하고, 순위·시총은 등급에만 쓴다.** 근거: ① [확실] 순위 응답에 `acml_tr_pbmn` 이 없어 후보 정렬(`universe.ts:246`)·`analyzeSymbol`·`Math.log(quoteVolume+1)`(`universe.ts:284`)이 NaN 으로 깨진다 — `acml_vol × stck_prpr` 근사는 가능하나 새 수식이다 ② 후보를 순위 60행으로 바꾸면 코스닥 소형주가 섞이며 구성이 통째로 바뀌는데, 같은 배포에서 가드도 처음 열린다 — 두 변화를 한 번에 넣으면 가상 체결 결과가 어느 쪽 때문인지 가를 수 없다 ③ 정적 목록 경로는 10-25 이후 매일 실제로 돈 경로다(이력서 「확인한 사실」). 후보 구성 변경은 가드 개방 뒤 관찰을 거쳐 별도 task 로 다루는 것이 맞다.
- [22:33] `quoteVolume` NaN 처리 사양: 순위 조회 함수를 남긴다면 반환 타입에서 `quoteVolume` 을 **없앤다**(없는 필드를 `Number(undefined)` 로 읽지 않는다). 근사값이 필요하면 이름을 `approxQuoteVolume = acml_vol × stck_prpr` 로 따로 두고, 둘 중 하나라도 유한수가 아니면 0. universe 쪽은 `analyzeSymbol` 에 넘기기 전 `Number.isFinite(v) && v >= 0 ? v : 0` 로 한 번 더 막는다(0 은 `log(0+1)=0` 이라 안전).
- [22:33] 부분 실패 원칙: B 에서는 종목 단위다 — 어떤 종목의 시세가 실패하면 그 종목은 이번 갱신 후보에서 빠지고(현행 `getKisTickers` 동작 그대로) 다른 종목 등급에 영향이 없다. 시세는 왔는데 `hts_avls` 가 없거나 0·음수·비유한수면 그 종목만 `speculative`(차단 방향, fail-closed)로 두고 종목 수를 1줄 경고로 남긴다. **전 종목의 시총이 비면**(필드명 변경 등) 전부 speculative 가 되어 지금과 같은 전면 차단으로 돌아가므로, 이때는 갱신 1회당 1줄 경고를 반드시 남긴다(T-176 WP-3 처럼 원인을 로그로 볼 수 있게). A·C 를 고르면 T-176 원칙 유지: 두 시장 중 하나라도 실패·0행이면 순위 전체를 실패로 보고 부분 결과로 등급을 매기지 않는다.
- [22:33] 캐시 필요 여부: B 는 불필요(시세마다 시총이 같이 온다). A·C 는 필요 — 호출량 때문이 아니라(갱신당 2회뿐) 실패 시 통과·차단이 뒤바뀌는 것을 막기 위해 "마지막 성공 등급표"를 최대 24시간 재사용한다(시총 순위는 하루 안에 거의 안 바뀜). 프로세스 재시작 직후 실패하면 캐시가 없어 전부 speculative(차단) — 허용.
- [22:33] **권고안: B** — 등급을 시세의 시가총액 임계로 종목별 산정, 분석 후보는 현행 유지, 순위 조회는 갱신 경로에서 뺀다. 이유: 당장의 효과는 세 대안이 같고(005930 core → 전부 통과), B 만 부분 실패·캐시·호출 증가·역전 문제가 없으며 분석하는 종목 전부에 등급이 붙는다. 약점 두 가지(단위 미실측, 임계 추정)는 배포 전 읽기 전용 실측 1회로 닫을 수 있다.
- [22:33] B 구현 사양(의사코드 — Developer 인계용): ① `Ticker` 에 선택 필드 `marketCapKRW?: number`(국내 시세만 채움, 해외는 미정의) ② `getTicker`: `avls = Number(o.hts_avls)`; `marketCapKRW = Number.isFinite(avls) && avls > 0 ? avls * 1e8 : undefined` ③ `refreshUniverseImpl` 국내: 순위 호출 없이 `getKisTickers(중복 제거한 ALL_SYMBOLS)` → 후보 정렬은 현행(`quoteVolume24h` 내림차순, 상위 150) → `tierMap.set(symbol, tierOf(marketCapKRW))` ④ `tierOf(cap)`: `cap ≥ CORE_MIN_KRW → core`, `cap ≥ SATELLITE_MIN_KRW → satellite`, 그 외·undefined → `speculative` ⑤ 상수 주석의 "KOSPI 100/200 근사" 문구와 `engine.ts:1231` 의 사용자 문구 「코어(KOSPI 100) 비율 미달」, `db.ts:1105` 주석을 새 정의(시총 임계)로 고친다. 참고 [확실]: `ALL_SYMBOLS` 에 `247540` 이 코스피·코스닥 목록에 중복돼 있어(`universe.ts:57,62`) 지금도 시세를 두 번 부른다 — 중복 제거를 같이 넣는다(고유 44종목).
- [22:33] 임계값 제안: `CORE_MIN_KRW = 5조`, `SATELLITE_MIN_KRW = 2조`. **[추측]** — 근거는 실측 2점(코스피 30위 16.4조, 코스닥 30위 1.85조)과 "100위는 30위의 약 1/4~1/3, 200위는 약 1/10" 이라는 일반적 분포 가정뿐이고, 이 시장의 실제 100위·200위 시총은 재지 못했다. 방향성: 임계를 높게 잡을수록 가드가 보수적(차단 쪽)이다. 보정 방법(선택): 순위 API 의 가격대 필터(`fid_input_price_1/2`)로 구간을 나눠 10~15회 읽기 전용 호출하면 코스피 상위 100~200위 시총을 한 번 재구성할 수 있다 — 운영 코드가 아니라 일회성 탐침으로.
- [22:33] 엣지 케이스: (1) `hts_avls` 빈 문자열·"0"·음수·문자 → undefined → speculative (2) 거래정지 종목은 시총은 오지만 캔들 부족·ATR 미달로 `analyzeSymbol` 이 null → 행이 안 생김(현행) (3) 임계 경계값은 `≥` 로 포함 (4) 해외는 `marketCapKRW` 미정의이고 tier 로직을 타지 않는다(현행 `speculative` 기본값 유지, 가드는 해외 통과) (5) 🔴 [확실] `lookupTier` 는 `symbol_universe` 에 행이 있어야 등급을 안다 — 보유 종목이 어느 프로파일 상위(30·40·30)에도 못 들거나 `analyzeSymbol` 이 null 이면 예전 행(48시간 보존)을 읽다가 그 뒤엔 unknown(=비core)이 되어 **전면 차단으로 되돌아간다.** 지금은 005930 이 최근 48시간 갱신 40회 전부에 들어 있어(쿼리: `COUNT(DISTINCT refreshed_at)` 40/40) 당장은 문제 없지만 구조적 약점이다 — 이번 범위에 넣을지는 Leader 판단(넣지 않으면 후속 과제로 기록 권고). 같은 이유로 정적 목록 밖 종목(예: 347700, skip 96건, tier=unknown)은 B 에서도 등급이 없다.
- [22:33] 시험 데이터(입력 → 기대): ① `tierOf`: 5조 정확히 → core / 4,999,999,999,999 → satellite / 2조 정확히 → satellite / 1,999,999,999,999 → speculative / undefined·NaN·0·음수 → speculative ② `getTicker` 매핑: `hts_avls="10575918"` → `marketCapKRW=1,057,591,800,000,000` / `hts_avls=""`·`"0"`·`"-1"`·`"abc"`·필드 없음 → undefined(다른 필드 값은 그대로) ③ 가드 재현(계좌 실측값): 보유 {005930: 13주 × 238,000, core} + speculative 종목 100,000원 매수 → 비율 3,094,000/3,194,000 = 0.9687 → 통과 / 같은 보유에 12,376,000원 매수 → 정확히 0.2000 → 통과(`<` 비교라 경계 포함) / 12,376,001원 → 0.19999… → skip / 보유 005930 이 speculative 면 금액과 무관하게 0.0 → skip(현 운영 재현) ④ 갱신 통합: 시세 44건 중 1건만 시총 없음 → 그 종목만 speculative, 나머지 등급 정상 / 전 종목 시총 없음 → 전부 speculative + 경고 1줄 / `fetchMarketCapRanking` 이 호출되지 않음(T-176 시험 `universe-ranking-fallback-t176.test.ts` 는 순위 호출을 전제하므로 함께 고쳐야 한다).
- [22:33] 배포 전 확인(읽기 전용 KIS, Leader 탐침 — 나는 호출하지 않았다): (가) 005930 시세 1건의 `hts_avls` 값·단위가 순위 API `stck_avls`(10,575,918)와 맞는지 (나) 정적 44종목의 시총을 한 번 받아 위 임계에서 core/satellite/speculative 개수를 확정 (다) 같은 응답의 `rprs_mrkt_kor_name` 값 종류 기록 — 만약 "KOSPI200" 같은 지수 편입 표시가 온다면 [추측] 임계 추정 없이 진짜 지수 기준을 쓸 수 있어 후속 개선 재료가 된다.
- [22:33] 사용자 결정 사항 ① 등급 기준: (a) **B 시세 시총 임계 — 권고** / (b) A2 순위 API(코스피 30 core·코스닥 30 satellite): 의미는 분명하나 30으로 좁고 캐시·부분 실패 처리 필요 / (c) A1 현 코드에 파라미터만 수정(60행 전부 core): 가장 작게 고치지만 등급의 뜻이 틀어짐. 세 안 모두 현 계좌에서는 국내 매수 후보 전부가 가드를 통과한다. ② 임계값(B 선택 시): (a) **core 5조·satellite 2조 — 권고(추정치)** / (b) 보수적으로 core 10조·satellite 3조 / (c) 배포 전 탐침으로 100위·200위 시총을 재서 확정(호출 10~15회, 하루쯤 지연). ③ 순위 조회 코드: (a) **갱신 경로에서 호출 제거 — 권고**(한 번도 성공한 적 없어 잃는 기능 없음, 종목명 저장도 원래 0건) / (b) 파라미터를 고쳐 종목명 저장·대조 로그용으로만 유지(호출 2회 유지). ④ 변화 수용 확인: 배포하면 국내 가상 체결이 하루 약 80~120건(추정) 생기기 시작한다 — 실제 주문·시그널은 전략이 전부 미검증이고 DRY_RUN 이라 0건. 그리고 현 계좌(삼성전자 1종목 보유)에서는 이 가드가 사실상 아무것도 막지 않게 된다는 점(1회 1,237만원 초과 매수만 차단)을 알고 진행할지.
- [22:33] 검증 범위 정리 — 확인한 것: 가드 계산식·임계·적용 조건, 보유 실측, skip 3,630건의 상세 문구, 가드 뒤 경로(검증 관문·쿨다운), 시세 예제의 필드 존재, 코드의 미매핑. 확인 못 한 것: `hts_avls` 의 실제 값·단위, 종목별 시총과 그에 따른 등급 개수, KOSPI 100위·200위 시총, 가드 개방 뒤 뒤쪽 관문에서 추가로 걸러질 비율. 이 설계는 과거 데이터 재생과 코드 읽기에 근거한 것이며 운영 실측이나 수익 근거가 아니다. Stage 전환과 무관하다(DRY_RUN·검증 관문 변경 없음).

## Developer

- [22:53] 실행 도구 claude(developer, Opus). 작업 위치 서버 worktree `~/.node-local/stockinvest-t181`(base `72b9729`), 편집은 scratch 미러 → tar over ssh. 커밋·push·KIS 호출·DB 쓰기·pm2·cron 호출 0건. `src/lib/strategy/m40/**`·t180 폴더 미접촉. 변경은 worktree 에 미커밋 상태로 둔다.
- [22:53] 변경 파일(`git diff --stat` 8 files, +182 −138, 신규 2): `src/lib/exchanges/kis-domestic.ts` · `src/lib/exchanges/kis.ts` · `src/lib/exchanges/types.ts` · `src/lib/strategy/universe.ts` · `package.json` · `package-lock.json` · 시험 수정 `src/lib/exchanges/__tests__/kis-market-cap-diag-t176.test.ts` · `src/lib/strategy/__tests__/universe-ranking-fallback-t176.test.ts` · 시험 신규 `src/lib/exchanges/__tests__/kis-domestic-t181.test.ts` · `src/lib/strategy/__tests__/universe-index-tier-t181.test.ts`.
- [22:53] 설계 1 `getTicker`: `hts_avls`→`marketCapKrw`(억원×1e8), `rprs_mrkt_kor_name`→`indexTag`(trim). 파서 `parseMarketCapKrw`·`parseIndexTag` 를 export 함수로 분리. 값이 비정상이면 **키 자체를 싣지 않는다**(조건부 spread — 기존 반환 모양 그대로, `toStrictEqual` 류 영향 없음). 기존 필드 계산 불변. `Ticker`(`types.ts`)에 두 필드를 선택 필드로 추가. 설계와 다른 점: 설계는 `String(o.rprs_mrkt_kor_name ?? '')` 였으나 문자열이 아닌 값(숫자·객체)은 `undefined` 로 둔다(객체가 `[object Object]` 로 새지 않게 — 실측 값은 모두 문자열이라 동작 차이 없음).
- [22:53] 설계 2 순위 조회: 쿼리를 `buildMarketCapQuery(iscd)`(export)로 분리, 키 9개 소문자·`fid_cond_mrkt_div_code='J'` 고정·`FID_BLNG_CLS_CODE` 삭제·`fid_trgt_cls_code`/`fid_trgt_exls_cls_code`='0'. `fetchMarketCapPage(iscd: '0001'|'1001')` 로 시그니처 변경(시장 구분은 iscd 만). 반환에서 `quoteVolume` 제거. 진단 로그 표기 `market=J(코스피)` → `iscd=0001(코스피)`·`iscd=1001(코스닥)`. 호출부 전수: 운영 코드 호출부는 universe 하나뿐이었고 제거됨. **`kis.ts` 의 `kis` 객체 타입 선언에 `quoteVolume` 이 있어 함께 고쳤다**(설계 2 「다른 호출부」 해당 — 타입만, 동작 변화 없음). 함수·`kis.fetchMarketCapRanking`·재export 는 유지.
- [22:53] 설계 3 universe 국내 분기: 순위 호출·`fetchMarketCapRankingOrEmpty`·순위 기반 `stock_meta` upsert·`TIER_CORE_LIMIT`/`TIER_SATELLITE_LIMIT`·`describeErrorCause` import 삭제. 후보는 `getKisTickers([...ALL_SYMBOLS])` → 거래대금 정렬 → 상위 150(종전 대체 경로 그대로). 등급은 `tierFromIndexTag`(export): trim+대문자 후 `KOSPI200`→core, `KSQ150`→satellite, 그 외·없음→speculative, 정확 일치(`hasOwnProperty` 로 `__proto__` 등 원형 키 차단). 시세 1건 이상인데 core·satellite 0개면 `[universe:domestic] 지수 편입 표시 없음 — 전 종목 speculative` 경고 1줄 후 계속. `ALL_SYMBOLS` 는 `[...new Set(...)]` 로 중복 제거(45→44, 순서 유지, 시험용 export, `readonly`). 주석의 「KOSPI 100/200 근사」 설명은 universe.ts 안만 고쳤다(`getUniverseSymbols` 의 `kospi100` 주석 포함).
- [22:53] 설계 5 버전: `package.json`·`package-lock.json`(루트 2곳) `0.19.0` → `0.20.0`(마이너). ⚠ 같은 시각 T-180 세션도 버전을 올리면 병합 충돌이 난다 — 커밋 순서에 따라 Leader 가 조정 필요.
- [22:53] 바꾼 기존 단언과 이유 — `kis-market-cap-diag-t176.test.ts`: ① `market=J(코스피)`/`market=Q(코스닥)` → `iscd=0001(코스피)`/`iscd=1001(코스닥)`(로그 표기가 설계대로 바뀜, 줄 수·내용 단언은 그대로) ② 정상 응답 시험의 시장 판별 `FID_COND_MRKT_DIV_CODE=J` → `fid_input_iscd=0001`(두 시장 모두 J 라 더는 가를 수 없음), 입력에서 실재하지 않는 `acml_tr_pbmn` 제거, 기대값에서 `quoteVolume` 제거 + 「`quoteVolume` 키가 없다」 단언 **추가**. 억제·비밀 미포함·길이·HTTP 오류·예외 전파 단언은 손대지 않음.
- [22:53] 바꾼 기존 단언과 이유 — `universe-ranking-fallback-t176.test.ts`: ① 순위가 던질 때·빈 배열일 때 시험에 `fetchMarketCapRanking` **not called** 단언 추가(강화) ② 「원인(코드·주소)을 한 줄 남긴다」·「URL 쿼리스트링·제어문자 가림, 문자열화 불가」 두 시험은 **삭제** — 대상 코드(`fetchMarketCapRankingOrEmpty` 와 그 실패 로그)가 설계 3 으로 사라져 검사할 대상이 없다. 대신 「순위 조회 실패 로그가 없다 + 갱신은 끝까지 간다」 시험을 넣었다 ③ 「순위가 오면 대체 경로를 타지 않고 시총 순으로 tier」 → 뜻이 뒤집혔다: 순위가 값을 줄 수 있어도 호출되지 않고 정적 목록 시세 경로 + indexTag 등급(core·satellite), stock_meta 0건, 경고 0 ④ 시세 0건 → refreshed:false 는 유지 + 「지수 표시 없음」 경고가 안 나간다 단언 추가.
- [22:53] 새 시험(설계 4): `kis-domestic-t181.test.ts` 18건 — ① 매핑(실측 10575918→1,057,591,800,000,000·KSQ150 trim·hts_avls 빈/공백/0/음수/문자/Infinity/null 이면 키 없음·두 필드 없으면 예전 키 8개 그대로·rprs 빈/공백/숫자/null 이면 키 없음·파서 단위) ⑤ 쿼리 문자열 정확 일치(0001·1001)·실제 나가는 두 URL 의 경로·`blng` 부재·대문자 키 부재·J·tr_id `FHPST01740000`·합산 정렬. `universe-index-tier-t181.test.ts` 23건 — ② 매핑 15+1 케이스(공백·소문자·`KOSPI 200`·`KOSPI2000`·`__proto__` 등) ③ 순위 미호출 + 종목별 등급 기록 ④ 경고 1줄(정확 문구)·satellite 만 있으면 경고 없음 ⑥ 44개·중복 없음·247540 1회·갱신에 같은 목록 전달. 추가로 시총이 커도 표시 없으면 speculative·`score_detail` 에 시총 없음·해외는 indexTag 가 와도 speculative·경고 없음.
- [22:53] 실행 증빙: 관련 jest 10 suites/135 tests 전부 통과(`~/.node-local/t181-logs/jest-related-2.log`) · `tsc --noEmit` exit 0, 출력 0줄(`tsc.log`) · 전체 jest 를 base `72b9729`(임시 worktree `stockinvest-t181base`, 실행 뒤 `git worktree remove` 로 삭제 확인)와 변경본에서 같은 방법(`--json`, flock 직렬)으로 돌려 실패 이름 대조: base 실패 10건(7 suites) / 변경본 실패 10건(7 suites), **새 실패 0 · 사라진 실패 0**, 통과 12,844 → 12,884(+40 = 신규 41건 − T-176 시험 순감 1건), 총 13,144 → 13,184(`jest-base.json`·`jest-new.json`·`cmp.py`·`cmp.txt`). base 실패 7 suites: `corp-intel/isolation`·`ops/reason-dictionary-keys`·`profit-engine/isolation`·`strategy/records/job-slots`·`currency-mixing-fence`·`usd-cash-balance-fence`·`t108-terms-fence`(전부 이번 변경 밖). 참고: 이력서 지시의 「기존 실패 416건」은 지금 base 에서 재현되지 않았다(이번 base 실측 10건) — 환경 차이로 보이며 [추측] 원인은 확인하지 않았다.
- [22:53] 실행하지 못한 것: ① `next build` — exit 1, `Failed to read source code from /home/brownjeon/apps/stockinvest/shared/api-usage/index.js`·`.../shared/auth-oauth/...`(`build.log`). `node_modules` 가 운영 릴리스로의 심볼릭 링크라 `@workspace/*`(`file:../shared/*`) 의 상대 링크 `../../../shared/...` 가 존재하지 않는 경로로 풀린다. 실패 파일은 이번 변경과 무관한 `src/lib/auth/oauth/providers.ts`·`src/app/api/auth/[provider]/route.ts` 경로라 [가능성 높음] 환경 문제이고 base 도 같을 것이나 base 빌드는 돌리지 않았다. 운영 경로에 링크를 만드는 우회는 하지 않았다 — 빌드는 QA/Leader 가 정상 node_modules 환경에서 확인 필요 ② lint — 이 프로젝트에 ESLint 설정이 없어 `next lint` 가 설정 마법사를 띄우고 멈춘다(`lint.log`, 설정 파일 생성 안 됨 확인) ③ 운영 KIS 응답으로의 실호출 검증(금지 사항이라 시험은 전부 모의).
- [22:53] 발견(범위 밖, 후속 후보): `isExcluded` 의 우선주 판정 `symbol[4] === '5'` 는 6자리 코드의 끝자리(색인 5)가 아니라 색인 4 를 본다 — `005935`(삼성전자우)를 거르지 못한다. 운영 호출부가 없어져 영향 없음, 고치지 않았고 시험에서 이 동작을 고정하지도 않았다(주석으로 기록). 또 `engine.ts:1231` 「코어(KOSPI 100) 비율 미달」·`ai-filter.ts:300,733`·`skip-reason-formatter.ts:46`·`portfolio-stability.ts:6,147` 의 「KOSPI 100」 문구는 새 기준(core = KOSPI200 편입)과 맞지 않지만 설계 범위(파일 목록) 밖이라 두었다.
- [22:53] 남은 위험: ① 국내 코어 비율 가드가 처음 열린다(사용자 수용 완료 — 국내 가상 체결·감사 행 하루 약 80~120건 [추측], DRY_RUN·검증 관문 유지) ② `rprs_mrkt_kor_name` 값이 바뀌면 다시 전면 차단 — 경고 줄로 감지 ③ `lookupTier` 48시간 후 unknown 회귀(Analyst §6) 미해결 ④ 정적 목록 죽은 코드 `042670`·`091990` 그대로 ⑤ 안전장치 self-check: 주문·DRY_RUN·KILL_SWITCH·한도·심볼 블랙리스트·`orders` 기록 경로는 손대지 않았다(diff 에 `safety/`·주문·`submitOrder` 경로 없음). `src/lib/exchanges/`·`src/lib/strategy/` 는 `SAFETY_PATHS` 대상이라 커밋에 Reviewer 판정 줄이 필요하다.

- [22:58] (Leader 확인) 작업 폴더를 `8d9e980`(T-180 배포분, m40·기록만 — T-181 파일과 겹침 없음, 버전 0.19.0 그대로)으로 옮긴 뒤 `node_modules` 를 공유 트리 `node_modules` 링크로 바꿔 `next build` 재실행 → **rc=0**(`~/.node-local/t181-logs/build-2.log`). Developer 때의 build 실패는 운영 릴리스 `node_modules` 링크에서 `@workspace/*` 가 풀리지 않던 환경 문제였다. 같은 이동 뒤 미커밋 변경 10개 파일 그대로 유지 확인.

## Reviewer

- [23:00] 범위·방법(실행 도구 claude, reviewer): 서버 worktree `~/.node-local/stockinvest-t181`(base `8d9e980`, 미커밋)의 `git diff` 전체와 신규 시험 2개를 읽었다. 코드 수정·커밋·KIS 호출·DB 쓰기 0건. 관련 jest(순위 진단·kis-domestic-t181·universe 순위 대체·universe-index-tier + `src/lib/strategy` 전체)를 `flock` 직렬로 재실행: 103 suites 통과, 실패 1건(`records/__tests__/job-slots.test.ts` — m40-forward·m40-forecast 불일치, Developer 가 기록한 base 실패 7 suites 중 하나이고 이번 변경 밖). 전체 jest 는 돌리지 않았다(Developer 의 base 대비 새 실패 0 기록을 신뢰, 재현 안 함).
- [23:00] 의도 검증(통과, [확실] 코드 대조): 등급은 `tierFromIndexTag`(trim+대문자, `hasOwnProperty` 정확 일치)로 `KOSPI200`→core·`KSQ150`→satellite·그 밖·없음→speculative. 국내 분기는 `fetchMarketCapRanking` 을 더 이상 부르지 않고(운영 코드 호출부 grep 0건: `kis-domestic.ts` 정의·`kis.ts` 재노출·타입만 남음), 후보는 종전 대체 경로 그대로 `getKisTickers([...ALL_SYMBOLS])`→`quoteVolume24h` 정렬→상위 150 으로 바뀌지 않았다. `ALL_SYMBOLS` 중복 제거는 순서 유지.
- [23:00] 영향 경로 추적(통과): `tier` 를 읽는 살아 있는 코드는 `portfolio-stability.ts` `lookupTier`(최신 행)·`calcCoreRatio` 한 곳뿐이다. `getUniverseSymbols` 의 tier 필터는 `engine.ts:1485` 가 `'volume-top'` 고정이라 죽은 분기, `ai-filter`·`rs-rating`·`getUniverseSnapshot` 은 tier 를 읽지 않는다. 가드를 통과한 매수는 `publish`→`createSignalGuarded`→`evaluateValidationGate`(`unvalidated` 는 `blocked`, 조회 오류도 `blocked`)에서 막히고 `auditBuys` 경로는 `validationAuditOnly` 로 시그널·주문 없이 가상 체결·감사 행만 남긴다. 새로 닿는 실주문·시그널 승인 길은 찾지 못했다(DRY_RUN·KILL_SWITCH 값 자체는 보지 않았고 코드 경로만 확인). 사용자가 수용한 변화(국내 가상 체결·감사 기록 시작)와 일치.
- [23:00] `Ticker` 확장(통과): 새 필드는 값이 비정상이면 키를 싣지 않는 조건부 spread 라 기존 반환 모양이 유지된다(`Object.keys` 시험으로 고정). `getTicker` 호출부(주문·청산·진입 감시·시세 표시·포트폴리오 등 20여 곳)는 새 필드를 읽지 않고 `marketCapKrw`·`indexTag` 를 참조하는 곳은 universe 한 곳뿐이다. `/api/ticker` 응답에 공개 시장 데이터 두 필드가 더 실릴 뿐 비밀이 아니다. `quoteVolume` 제거는 `fetchMarketCapRanking` 의 운영 사용처가 없어(시험 파일 제외 전수 grep) 깨지는 곳이 없다.
- [23:00] 시험 평가(통과): T-176 시험 2건 삭제는 정당하다 — 삭제된 시험은 `fetchMarketCapRankingOrEmpty` 의 실패 로그 문구·쿼리스트링 가림을 검사했고 그 함수가 이번 변경으로 코드에서 사라졌다(대상 부재). 대신 「순위 조회가 던지든 비든 값을 주든 호출되지 않는다」 단언을 3곳에 추가해 오히려 강화됐다. 진단 시험의 바꾼 단언(로그 표기 `market=`→`iscd=`)은 줄 수·억제·비밀 미포함 단언을 그대로 두었다. 새 시험은 변이를 잡는다: 쿼리 문자열 정확 일치(키·값·순서)·`blng`/대문자 키 부재, 등급 15케이스(공백·소문자·`KOSPI 200`·`__proto__` 등), 경고 문구 정확 일치와 satellite-only 무경고, 시총이 커도 표시 없으면 speculative, 해외 무영향.
- [23:00] 안전 경로·비밀·NaN(통과): 새 `console.warn` 은 고정 문구뿐이고 `indexTag`·응답 본문을 로그에 싣지 않는다(로그 주입 경로 없음). 진단 로그의 비밀 미포함 처리는 그대로. `parseMarketCapKrw` 는 비유한수·0 이하·문자·null 을 `undefined` 로 막아 NaN 이 등급·정렬로 새지 않는다(`quoteVolume24h` 의 기존 `Number(acml_tr_pbmn)` 은 변경 전과 같다). 등급 판단에 시총을 쓰지 않아 `score_detail` 도 그대로.
- [23:00] 지적 1 (low) `src/lib/strategy/engine.ts:1231`·`portfolio-stability.ts:6,147`·`ai-filter.ts`·`skip-reason-formatter.ts:46` — 사용자에게 보이는 문구 「코어(KOSPI 100) 비율 미달」이 새 기준(core = KOSPI200 편입)과 어긋난다. Developer 가 범위 밖으로 기록했고 동의한다. 기능 영향 없음, 후속 문구 정리 권고.
- [23:00] 지적 2 (low) `src/lib/strategy/universe.ts:210-217` — 편입 표시 경고는 「전 종목 표시 없음」일 때만 나간다. 일부 종목만 `rprs_mrkt_kor_name` 이 빈 값으로 오면 그 종목은 그 갱신분에서 speculative 로 기록되고 `lookupTier` 가 최신 행을 읽으므로 최대 한 주기(15~20분) 코어 비율 가드가 차단 쪽으로 흔들릴 수 있다. 방향은 fail-closed(안전)이고 005930 이 이 값을 잃을 가능성이 낮아 관찰 사항으로만 남긴다. Analyst 의 `lookupTier` 48시간 unknown 회귀(후속 과제)와 같은 계열.
- [23:00] 지적 3 (low, 운영 메모) `package.json`·`package-lock.json` 0.19.0→0.20.0 — T-180 세션이 같은 시각 버전을 올리면 병합 충돌이 난다(Developer 기록과 같음). 커밋 순서에서 Leader 조정 필요. 감시 대상 아님.
- [23:00] 미확인·한계: 운영 KIS 응답으로의 실호출 시험은 금지 범위라 하지 않았다(`rprs_mrkt_kor_name` 의 값 종류는 Leader 의 실측 2 기록에 의존). `next build` 는 Developer 가 환경 문제로 실패 기록, 이 감사에서 재실행하지 않았다(Leader 가 별도 수행 중). 커밋 훅 감시 대상 판정(`awk` 로 `SAFETY_PATHS` 확인): staged 예정 파일 중 `src/lib/exchanges/kis-domestic.ts`·`kis.ts`·`types.ts`(`^src/lib/exchanges/`), 시험 `src/lib/exchanges/__tests__/kis-market-cap-diag-t176.test.ts`·`kis-domestic-t181.test.ts`(같은 접두), `src/lib/strategy/universe.ts`·`src/lib/strategy/__tests__/universe-ranking-fallback-t176.test.ts`·`universe-index-tier-t181.test.ts`(`^src/lib/strategy/`) 6~7개가 감시 대상이고 `package.json`·`package-lock.json` 은 아니다.
- [23:00] **최종 판정: PASS (scope: src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis.ts, src/lib/exchanges/types.ts, src/lib/exchanges/__tests__/kis-market-cap-diag-t176.test.ts, src/lib/exchanges/__tests__/kis-domestic-t181.test.ts, src/lib/strategy/universe.ts, src/lib/strategy/__tests__/universe-ranking-fallback-t176.test.ts, src/lib/strategy/__tests__/universe-index-tier-t181.test.ts)**
- [23:12] Codex C2 high 지적(`universe.ts:215`, 과거 core 행이 남아 코어 비율 가드가 오래된 등급으로 통과) 판정 — **부분 채택, 심각도 high → low(관찰), 이번 T-181 에서는 고치지 않고 후속 task**. 코드(`universe.ts` 244~285행 저장 루프·`portfolio-stability.ts` `lookupTier`)와 운영 DB(읽기 전용)를 직접 대조했다. 코드 수정·커밋·KIS 호출·DB 쓰기 0건.
- [23:12] 사실 여부([확실]): 구조는 사실이다. 등급은 `tierMap` 에만 담기고 `symbol_universe` 저장은 분석 통과 + 전략별 상위(30·40·30) 선별을 통과한 종목에만 일어나며, `lookupTier` 는 `ORDER BY refreshed_at DESC LIMIT 1` 로 나이를 보지 않는다. 행 정리는 갱신이 성공한 뒤의 `DELETE ... INTERVAL 48 HOUR` 한 곳뿐이라, 정상 운영에서 낡은 등급의 최대 지속 시간은 그 종목의 마지막 저장 시각으로부터 **48시간**이고, 갱신 자체가 멈추면(성공해야 삭제가 돈다) 그 이상도 가능하다. 실제 증거: 운영 DB 에 112040 이 40회 중 11회만 저장되고 마지막 저장이 11-19 12:26 인데 11-20 15:28 현재도 최신 행으로 남아 있다(27시간 경과) — 탈락 종목의 낡은 행이 읽히는 메커니즘이 지금도 돈다. Codex 의 메모리 재현(강등 + 탈락 시 과거 core 로 통과)도 코드 경로상 맞다.
- [23:12] 발동 조건이 좁다([확실] 코드·DB): 해를 끼치려면 (가) 보유 종목의 지수 표시가 `KOSPI200` 에서 다른 값으로 바뀌고 **동시에** (나) 세 전략 모두에서 상위 선별 밖이거나 `analyzeSymbol` 이 null(ATR 0.5% 미만·캔들 부족·시세 실패)이어야 한다. 표시만 바뀌고 저장되면 최신 행이 speculative 로 정확히 갱신되고, 표시가 그대로 core 이고 탈락하면 낡은 core 가 오히려 맞다. 실측 분포: 최신 갱신 100행에 고유 41종목(분석 가능한 전부), mean-rev 가 40개를 받아 사실상 분석을 통과한 종목은 모두 저장된다 — 탈락은 거의 분석 실패(ATR 미달 등) 쪽이다. 40회 중 41종목 가운데 빠진 것은 112040(영구 탈락)·032830(1회) 뿐이다. 현 보유 005930 은 40/40 이고 KOSPI200 에서 빠질 가능성이 사실상 없어 **현 계좌에서의 실현 가능성은 매우 낮다**. 현실적 시나리오는 정기 지수 변경(6월·12월)으로 KOSPI200 에서 빠진 저변동 보유 종목이다.
- [23:12] T-181 이 만든 결함인가: **구조는 원래 있던 것, 영향은 이번 변경으로 처음 생긴다.** 변경 전에는 순위 조회가 한 번도 성공하지 못해 core 행이 존재한 적이 없어 낡은 행이 곧 speculative(차단 방향)였다. 지금은 core 가 처음 저장되므로 낡은 core(통과 방향)가 처음 가능해졌다. 원래 있던 반대 방향 결함(보유 종목이 선별에서 빠지면 행이 없다가 48시간 뒤 unknown → 비core → 차단)과 **같은 뿌리**다: 등급 저장이 점수 선별에 종속되어 「보유 종목의 현재 등급」이 보장되지 않는다. 두 방향 모두 `lookupTier` 에 최신성·부재 처리가 없는 데서 온다.
- [23:12] 영향 크기: 이 가드(`stableCoreRatioMin` 0.20)는 포트폴리오 집중도 선호 가드이지 주문 안전장치가 아니다. 낡은 core 로 통과해도 그 뒤에 검증 관문(전략 16개 전부 unvalidated → blocked 또는 `validationAuditOnly` 가상 체결)과 DRY_RUN·KILL_SWITCH·주문 한도가 그대로이고, 이번 diff 는 `safety/`·주문·`submitOrder` 경로를 건드리지 않았다. 지속 시간 ≤ 48h. 실주문 위험은 확인하지 못했다(코드 경로 기준, 검증 관문이 unvalidated 인 동안).
- [23:12] 이번 범위에 넣지 말라는 이유: 가장 작은 수정인 「`lookupTier` 가 최신 갱신(refreshed_at 최댓값) 행만 보게」 단독은 **해롭다** — 보유 종목이 탈락하면 즉시 unknown(차단)이 되어 위의 반대 방향 결함이 커진다(분석 실패 하나로 국내 매수 전면 차단). 올바른 수정은 둘의 결합이다: ① 등급 저장을 선별과 분리해 시세를 받은 전 종목의 최신 등급을 보존(예: 전용 테이블·`system_config` 또는 `symbol_universe` 에 전략과 무관한 행 — 후자는 `getUniverseSymbols`·`ai-filter`·`rs-rating` 이 profile·rank_pos 를 읽으므로 오염 위험을 먼저 확인) ② `lookupTier` 가 그 값을 읽고 최신성 한도(예: 1일) 밖이면 unknown. 변경 파일은 `universe.ts`·`portfolio-stability.ts`·(저장소 변경 시) 마이그레이션·`db.ts`·시험이고 `SAFETY_PATHS` 대상이며 DB 마이그레이션은 사용자 승인 사항이다. 이는 T-181 의 목적(순위 파라미터 오류 해소·지수 편입 등급)을 넘는 설계 변경이고, 현 계좌 위험이 낮아 지금 끼우면 위험(새 저장소·마이그레이션)이 이득보다 크다.
- [23:12] 권고: ① T-181 은 그대로 진행(수정 불필요). ② Analyst §6 의 `lookupTier` 48시간 unknown 회귀와 이번 지적을 **한 후속 task 로 묶어** 기록 — 제목 예: 「코어 비율 가드의 보유 종목 등급 보존」, 해법은 위 ①+② 결합, 시험은 (가) 보유 종목이 탈락해도 등급 유지 (나) 강등 + 탈락 연속 갱신에서 낡은 core 로 통과하지 않음 (다) 한도 초과 시 unknown. ③ 그 사이 완화책은 이미 있다 — 지적 2 의 경고 줄 외에, 후속에서 보유 종목의 등급 갱신 경과를 로그로 남기는 것을 권한다. ④ 사용자 결정 사항: 후속 task 로 올릴지(권고)·올린다면 시점. 수정이 불필요하다고 판단하므로 재감사 요청은 없다.
- [23:12] 미확인·한계: 운영 KIS 응답으로 보유 종목의 실제 `rprs_mrkt_kor_name` 변동을 재현하지 않았다(금지 범위). 지수 정기 변경 시 표시가 즉시 바뀌는지는 추정이다. Codex 가 못 본 범위(전체 jest·tsc·build)는 이 판정과 무관하다.
- [23:12] **최종 판정: PASS (scope: src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis.ts, src/lib/exchanges/types.ts, src/lib/exchanges/__tests__/kis-market-cap-diag-t176.test.ts, src/lib/exchanges/__tests__/kis-domestic-t181.test.ts, src/lib/strategy/universe.ts, src/lib/strategy/__tests__/universe-ranking-fallback-t176.test.ts, src/lib/strategy/__tests__/universe-index-tier-t181.test.ts)**

## Judge

- [2026-11-20 22:28] intake engine=jev → task_type=local_fix · risk=R2 · developer_model=opus · next=ask_user(blocking=requirements) · demo=delta/designer(DM-kw-risky-cta) · roles=designer,developer,reviewer,qa · needs_info=true | overrides=DM-kw-risky-cta | fallback=- | tokens=1377

판정 도구 출력(`judge-result@2`, 원문 그대로):

```json
{
  "schema": "judge-result@2",
  "engine": "jev",
  "kind": "intake",
  "checkpoint": null,
  "task_id": "T-181",
  "project": "StockInvest",
  "spec_version": "dev-judge@0.2.0",
  "rules_version": "dev-rules@0.5.0",
  "model": "jev-1.13.0",
  "decision": {
    "task_type": "local_fix",
    "complexity": 1.9,
    "needs_info": true,
    "risk": "R2",
    "developer_model": "opus",
    "roles": [
      "designer",
      "developer",
      "reviewer",
      "qa"
    ],
    "demo": {
      "required": true,
      "level": "delta",
      "owner": "designer",
      "publish": "artifact+repo",
      "source": "jev",
      "rule_id": "DM-kw-risky-cta",
      "rule_ids": [
        "DM-kw-risky-cta"
      ],
      "waiver_requested": false,
      "configuration_error": null
    },
    "next": "ask_user",
    "next_actions": [
      "clarify_requirements",
      "prepare_demo",
      "request_demo_approval",
      "assign_developer"
    ],
    "blocking_gate": "requirements"
  },
  "signals": {
    "task_type": {
      "choice": "local_fix",
      "confidence": 0.82
    },
    "complexity": {
      "score": 1.9,
      "confidence": 0.83
    },
    "needs_info": {
      "noul": 0.69
    },
    "risk": {
      "choice": "high",
      "probabilities": {
        "low": 0.01,
        "normal": 0.36,
        "high": 0.63
      }
    },
    "ui_detect": "listed",
    "ui_change": {
      "valid": true,
      "choice": "none",
      "confidence": 0.71,
      "probabilities": {
        "none": 0.76,
        "minor_visual": 0,
        "partial_restructure": 0.02,
        "behavior_change": 0.22,
        "overhaul": 0,
        "new_screen": 0
      }
    }
  },
  "rule_overrides": [
    {
      "field": "demo.level",
      "value": "delta",
      "rule_id": "DM-kw-risky-cta"
    }
  ],
  "fallback": null,
  "input_tokens": 1377,
  "cost_usd": 5.8e-05,
  "latency_ms": 493
}
```


- [2026-11-20 23:01] codex_gate/C2 engine=jev → codex_required=true · mode=adversarial-review · focus=design_assumption · budget_rule=CX-limit-unknown-r2 · codex_calls_used=0 · codex_switch=on | overrides=- | fallback=- | tokens=1098

判정 도구 출력(`judge-result@2`, 원문 그대로):

```json
{
  "schema": "judge-result@2",
  "engine": "jev",
  "kind": "codex_gate",
  "checkpoint": "C2",
  "task_id": "T-181",
  "project": "StockInvest",
  "spec_version": "dev-judge@0.2.0",
  "rules_version": "dev-rules@0.5.0",
  "model": "jev-1.13.0",
  "decision": {
    "codex_required": true,
    "wanted_before_budget": true,
    "mode": "adversarial-review",
    "focus": "design_assumption",
    "budget_rule": "CX-limit-unknown-r2",
    "codex_calls_used": 0,
    "codex_switch": "on"
  },
  "signals": {
    "codex_calls_used": 0,
    "focus": {
      "choice": "design_assumption",
      "confidence": 0.53
    },
    "high_risk_change": {
      "noul": 0.12
    },
    "reviewer_doubt": {
      "noul": 0.83
    }
  },
  "rule_overrides": [],
  "fallback": null,
  "input_tokens": 1098,
  "cost_usd": 0.000046,
  "latency_ms": 1419
}
```

## QA

- [23:09] 실행 도구 claude(qa, Haiku). 서버 worktree `~/.node-local/stockinvest-t181` HEAD `8d9e980`, 미커밋 변경 8개 + 신규 2개 그대로(`git diff --stat` 182/138, 실행 전후 동일). 코드 수정·커밋·push·DB 쓰기·KIS 호출·pm2·cron 호출 0건. 무거운 실행은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 직렬, 출력은 `~/.node-local/t181-logs/qa-*.log`.
- [23:09] 항목 1 시험: 신규·수정 4개 파일(`kis-market-cap-diag-t176`·`kis-domestic-t181`·`universe-ranking-fallback-t176`·`universe-index-tier-t181`) 4/4 suites, 55/55 tests 통과(`qa-jest-new4.log`, rc=0). `src/lib/exchanges`+`src/lib/strategy` 전체 136 suites: 3,432 tests 중 3,325 통과·106 skip·1 실패. 실패는 `strategy/records/__tests__/job-slots.test.ts` 「E11 슬롯 표 ↔ 러너 라벨 정합」이며 base 실행(`~/.node-local/stockinvest-t181base`, `jest-base.json`)에도 같은 이름으로 실패 → 기존 실패, 이번 변경과 무관(`qa-jest-related.log`·`qa-jest-related.json`). 참고: `cmp.txt` 대조 기준은 base `72b9729`이고 worktree 는 지금 `8d9e980`이라 전체 jest 를 다시 돌려 대조하지는 않았다.
- [23:09] 항목 2 `npx tsc --noEmit`: rc=0, 출력 0줄(`qa-tsc.log`).
- [23:09] 항목 3 의도 확인: (a) 등급 — `universe.ts` `INDEX_TAG_TIER`·`tierFromIndexTag`(trim·대문자·정확 일치·hasOwnProperty)를 코드로 확인, KOSPI200→core·KSQ150→satellite·그 밖·없음→speculative 시험 통과. (b) 국내 갱신이 순위 API 를 부르지 않음 — 국내 분기에 `fetchMarketCapRanking` 호출 없음(코드 확인), 시험 「③ 순위 조회를 부르지 않고…」·「순위가 값을 줘도 쓰지 않는다」 통과. (c) 후보 선택 — 코드상 `getKisTickers([...ALL_SYMBOLS])` → `quoteVolume24h` 내림차순 → `slice(0, UNIVERSE_TOP_N)`(상수 150) 그대로. **길이 150 을 직접 단언하는 시험은 없고 코드 읽기만 근거다.** (d) `getTicker` — `parseMarketCapKrw` 가 undefined·null·빈 문자열·비유한·0 이하를 `undefined` 로 돌리고 키를 싣지 않는 것을 코드로 확인, 시험 「두 필드가 아예 없으면 두 키 모두 없다」·「파서 단위」 통과. (e) `buildMarketCapQuery` — 소문자 키 9개·`FID_BLNG_CLS_CODE` 없음 확인, 시험 「키 9개·값·순서가 정확히 같다」·「실제로 나가는 두 요청(0001·1001, J, blng 없음, 대문자 키 없음)」 통과. (f) `ALL_SYMBOLS` = `[...new Set(...)]`, 시험 「중복 없고 247540 은 한 번만」 통과.
- [23:09] 항목 4 안전장치 회귀: 변경 파일은 `src/lib/exchanges/**`·`src/lib/strategy/universe.ts`·시험·버전 파일 2개뿐이다. `git diff -- src` 의 `+`/`-` 줄에서 `submitOrder`·`createOrder`·`DRY_RUN`·`KILL_SWITCH`·`ORDER_MAX`·`DAILY_ORDER`·블랙리스트·`safety/`·`orders`·`trade_logs` 일치 0건. `engine.ts` 는 diff 에 없다. 검증 관문 경로(코드 확인, 변경 없음): `engine.ts:1710` `evaluateValidationGate` → `:1716-1718` 미검증 전략은 `auditBuys` → `:1755-1758` `publish(…, { validationAuditOnly: true })`(시그널·주문 없이 감사 경로). 시험 6개 파일(`safety/submit-order`·`signals/service-validation-audit-only-t168`·`signals/approve-validation-gate`·`strategy/engine-validation-gate`·`strategy/engine-adaptive-validation-audit-t168`·`strategy/post-market-validation-gate`) 6/6 suites, 96/96 tests 통과(`qa-jest-gate.log`, rc=0). **한계: 「국내 core 등급 → 코어 비율 가드 통과 → 검증 관문」을 한 번에 잇는 시험은 없다. 구간 시험은 통과했고 연결은 코드 읽기 근거다.**
- [23:09] 항목 5 엣지: 시세 전부 실패(0건) — 시험 「대체 경로의 시세가 0건이면 종전처럼 refreshed:false」 통과, 빈 결과에서는 경고가 나가지 않는다(코드 `tickers.length > 0` 조건). 일부 종목 누락 — 시험 「한 종목의 시세가 실패해도 다른 종목 등급은 그대로」 통과. 해외 universe 무영향 — 시험 「해외 갱신은 등급 로직을 타지 않는다」 통과. 지수 표시 전부 없음 — 시험 「core·satellite 가 하나도 없으면 경고 한 줄, 갱신은 계속」 통과.
- [23:09] 항목 6 버전: `package.json` 3행 `0.20.0`, `package-lock.json` 3행(루트)·9행(`packages[""]`) `0.20.0`. 일치, base `0.19.0` 에서 마이너 1단계.
- [23:09] 결함 0건(Critical·High·Medium·Low 해당 없음). Reviewer 지적 1·2·3(문구의 「KOSPI 100」 잔존, 부분 빈 값 시 짧은 가드 흔들림, 버전 병합 충돌)은 결함이 아니라 후속 관찰 항목으로 둔다.
- [23:09] 검증하지 않은 항목(NOT_VERIFIED): ① 프로젝트 필수 안전장치 **런타임** 점검 — DRY_RUN 응답 플래그·Kill Switch HTTP 차단·주문 한도 누적 거부·감사 행을 mock 으로 실행하지 않았다(지시된 6항목 범위 밖이고 이번 변경은 그 경로를 건드리지 않는다는 diff 확인만 했다). 이 항목이 필요하면 별도 지시가 필요하다. ② `next build` 를 QA 가 다시 돌리지 않았다(Leader `build-2.log` rc=0 인용). ③ ESLint 설정이 없어 lint 미실행. ④ 전체 jest 를 `8d9e980` 기준으로 재실행하지 않았다. ⑤ 운영 KIS 실호출·`hts_avls` 실값 재확인은 금지 범위라 하지 않았다. ⑥ **Codex C2 검토 미완료**(`codex_exit_1 model_not_found`, 2026-11-20 23:04 기록). 이 QA 판정과 별개이며 사용자 결정이 필요하다. ⑦ **데모 게이트 상태 `drafting`**(`demo_gate.waived_by` 비어 있음, `DEMO_GATE_REFUSED` 기록). QA 는 게이트를 판정하지 않으며 Leader 확인이 필요하다.
- [23:09] 산출물 정리: 프로젝트 안에 만든 파일 없음(이 기록 외 쓰기 0건). 서버 로그는 `~/.node-local/t181-logs/qa-*.log`·`qa-jest-related.json`(1.5MB)에 보관.
- [23:09] QA 결과: pass

## 배포 기록

- [23:25] 서버 worktree 브랜치 `t181-domestic-index-tier` 커밋 `cfaa186`(코드, 커밋 훅 「Reviewer 감사 기록 확인: T-181」) + `ea5ba80`(기록) → 브랜치 push(웹훅은 `/main` 으로 끝나는 ref 만 배포 — 배포 없음) → **PR #8** https://git.xn--lh0b87pnudm10a4vd.com/brownjeon/project_StockInvest/pulls/8 (head `ea5ba80`, base `main`=`8d9e980`). 머지(=운영 배포)는 사용자 승인 대기.
- [23:20] 사용자 「지금 머지해줘」(23:18) → 승인 원문 커밋 `0bb9535` 를 브랜치에 push 한 뒤 Gitea API 머지(`head_commit_id=0bb9535`, 검토한 head 고정) → 머지 커밋 **`774bef6`** → 웹훅 `START sha=774bef6`(23:19:31 KST) → `RELEASE_RESULT ok` 릴리스 `20261120-231945-774bef64`, `migrated:false`, `END exit=0`(23:20:17). 롤백 대상 `20261120-224257-8d9e9803`. 배포 후 확인(23:20): 운영 `package.json` 0.20.0 · pm2 `stockinvest`·`stockinvest-cron` online·restarts 0 · health ok·db·safetyStatus green·dryRun true. 같은 배포에 실린 다른 작업 없음. 미국 장중 배포(사용자 합의).
- [23:21] ⚠ health `killSwitch:true` — **T-181 과 무관**: `system_config.safety_kill_switch=true` updated 21:42:26, 로그 `[kill-switch:drawdown] 자동 발동: 24h 손실 -10.2% (-1,884,476원) — 임계 -10% 초과`(21:42:27, 배포 37분 전). 해제는 사용자 전용이라 건드리지 않음. 켜져 있는 동안 국내 장중 관측(가상 체결 발생)이 영향을 받을 수 있다 [추측 — 엔진의 킬스위치 처리 경로 미확인].

## 실행 도구·절차 이력

- E1 2026-11-20 22:30 KST — 시작 도구 claude(메인 세션이 Leader 역할 겸임), 절차 claude_standard. 범위: 원인 확인·설계·구현·감사·QA·서버 커밋. 근거: 사용자 「새 task로 수정」. 남은 일: judge 접수 → analyst 설계 → 사용자 결정 → 구현.

- E2 2026-11-20 23:20 KST — 같은 도구(claude)·절차(claude_standard). 구현·Reviewer PASS(23:12 재판정)·judge C2·Codex(2회째 done, high 1건 → Reviewer 부분 채택·low·후속)·QA pass 까지 끝. 서버 worktree 브랜치 커밋 → PR 생성. 남은 일: 사용자 PR 검토·머지 승인 → 머지(=운영 배포) → 장중 관측.
## Codex 검토

### [2026-11-20 23:04] C2 adversarial-review focus=design_assumption — 실패(codex_exit_1: 모델 거부 model_not_found)
- judge 판정: `## Judge` 절 `codex_gate/C2` 줄 [2026-11-20 23:01] (codex_required=true, budget_rule=CX-limit-unknown-r2, 스위치 on) / 호출 차수: 1/4 (`count T-181` 기준)
- 대상: repo=/home/brownjeon/.node-local/stockinvest-t181 (cwd) base=8d9e980(task_file) snapshot=8eb97ae
- 지적 0건 — 실행이 끝나지 않아 지적 없음. 이것은 검토 통과가 아니다.
- 실패 사유: stderr 에 `The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account` (400, model_not_found). 서버 Codex CLI 0.157.1(0.167.0 이 아님), `~/.codex/config.toml` model `gpt-6.1-sol`. 래퍼 명령은 `codex exec -s read-only --ephemeral` 폴백 모드로 실행됐다(review 모드 아님).
- 재시도 안 함. 모델·설정 변경도 하지 않음 — 사용자 결정 필요.
- 검토하지 못한 범위: C2 설계 가정 검토 전부(시총 등급 지수 표시 가정, 순위 API·quoteVolume 제거 경로, core 등급의 코어 가드·관문·주문 경로 통과, 시험 누락 변이). Reviewer PASS 는 이 검토와 별개다.
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261120T140346Z-T-181-C2/ (stderr.txt, command.txt, prompt.md; raw.txt 비어 있음)
- 서버 worktree 정리: 이력서 복사본 삭제 확인, `git status` 는 시작 시와 같은 변경 10건만 남음.

- [23:10] (Leader) **재실행 done** — 첫 실행 실패 원인은 래퍼가 비로그인 ssh 셸 PATH 의 낡은 `/usr/bin/codex`(0.157.1)를 쓴 것. 서버 설정은 바꾸지 않고 `CODEX_BIN=/home/brownjeon/.local/bin/codex`(0.167.0, T-177 이 쓴 것)로 같은 인계 묶음(`~/.node-local/t181-codex/run-c2.sh`) 1회 재실행 → rc=0. 호출 누계 2/4. 원본 `/home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261120T140457Z-T-181-C2/last.txt`. worktree 상태는 실행 전과 같은 10개 파일.
- [23:10] Codex 지적 1건(원문 요지): severity high · `src/lib/strategy/universe.ts:215` · 조건: 이전 갱신에서 core 였던 보유 종목이 다음 시세에서 KOSPI·표시 없음으로 바뀌고 전략별 상위 후보에서 빠지거나 캔들 분석에 실패하는 경우 · 근거: 최신 등급은 tierMap 에만 담기고 저장은 분석·점수 선별을 통과한 종목에만 된다(244~285행), `portfolio-stability.ts:45` 는 최신 갱신 여부를 보지 않고 과거 행을 읽는다; 메모리 내 재현에서 과거 core 로 가드가 통과(실제 코어 비율 0% 를 90.9% 로 계산) · 권고: 등급 갱신을 점수 선별과 분리하고 가드가 오래된 core 를 쓰지 않게 최신성 검증 + 연속 갱신 회귀시험. 검토 못 한 것: 운영 KIS 실응답·운영 DB·전체 jest/tsc/build 재실행. 채택 여부는 Reviewer 판정 대기.

## 최종 요약

### [T-181] 국내 종목 등급을 지수 편입 표시로 매기기 — 국내 매수 후보 전면 차단 해소

- **상태**: ✅ 운영 배포 완료(2026-11-20 23:20 KST, 0.20.0) · ⏳ 다음 국내 장중 관측 대기 · ⚠ 킬스위치 자동 발동 중(이 task 와 무관, 21:42).
- **무엇이 바뀌었나**
  - 원인: 국내 시총 순위 조회가 KIS 규격과 다른 요청(코스피 필수 필드 누락·코스닥 시장코드 `Q`)이라 처음부터 한 번도 성공하지 않았다. 그래서 국내 종목이 전부 `speculative` 로 매겨졌고, 자동 모드의 코어 비율 가드가 11-16 이후 국내 매수 후보 3,630건을 모두 막았다(국내 가상 체결 0건).
  - 국내 등급을 시세 응답의 지수 편입 표시로 매긴다: KOSPI200 → core, 코스닥150 → satellite, 그 밖 → speculative(사용자 결정). 순위 조회는 갱신 경로에서 뺐고, 함수는 KIS 규격대로 고쳐 남겼다.
  - 분석 후보 선택(정적 목록 → 거래대금 순 상위)은 그대로다. 정적 목록 중복 1개 제거. 웹 버전 0.19.0 → 0.20.0.
- **배포**: ✅ PR #8 머지 커밋 `774bef6` · 2026-11-20 23:19:31~23:20:17 KST webhook blue/green · `RELEASE_RESULT ok`(릴리스 `20261120-231945-774bef64`, 마이그레이션 없음) · 사용자 「지금 머지해줘」(미국 장중 배포 합의). 같은 배포에 실린 다른 작업: 없음. DB 구조·앱(APK) 변경 없음. 롤백: 이전 릴리스 `20261120-224257-8d9e9803`.
- **AI 가 검증한 것**: 운영 KIS 읽기 전용 실측(순위 API 규격·30행 상한, 시세의 `hts_avls` 억원 단위·`rprs_mrkt_kor_name` 값) · 새 시험 41건 포함 관련 시험 통과 · 전체 jest base 대비 새 실패 0 · `tsc` 0 · `next build` rc 0 · Reviewer PASS(low 3 + Codex 지적 부분 채택) · QA pass(안전장치 경로 diff 변경 0).
  - 검증 못 한 것: 실제 운영 갱신에서의 등급 저장 결과와 국내 가상 체결 건수(배포 뒤 첫 국내 장중에 읽기 전용으로 확인) · 안전장치 런타임 mock 실행(이번 diff 가 그 경로를 건드리지 않음만 확인) · lint(설정 없음).
- **👉 사용자가 확인할 것**: PR 의 소스 검토. 배포 뒤 화면 확인은 필수 아님 — 다음 국내 장중(평일 09:00~) 이후 AI 가 `symbol_universe` 국내 core·satellite 행 생성, `eval_funnel` 의 `portfolio_core_ratio` skip 감소, 국내 `paper_fills origin=engine` 발생(하루 수십~백여 건 추정)을 읽기 전용으로 확인한다. 이상 기준: 장중인데 국내 core 0개 / 승인 가능 상태 매수 시그널 생성 / 하루 수천 건.
- **👉 사용자가 결정할 것**: ① 킬스위치 해제 여부(21:42 drawdown 자동 발동, 사용자 전용 — 이 task 와 무관) ② 후속 task 「코어 비율 가드의 보유 종목 등급 보존」 등록 여부(아래).
- **남은 일 (후속 후보)**
  - 코어 비율 가드의 보유 종목 등급 보존: 등급 저장이 전략 점수 선별에 묶여 있어, 보유 종목이 선별에서 빠지면 과거 등급이 최대 48시간 남거나(낡은 core 로 통과 — Codex 지적) 48시간 뒤 unknown 으로 차단된다. 현 보유(삼성전자)에선 가능성 매우 낮음. 저장소 분리가 필요해 DDL 승인 사항일 수 있다.
  - 화면·로그 문구 「코어(KOSPI 100) 비율 미달」 → 새 기준(KOSPI200 편입)에 맞게(`engine.ts`·`portfolio-stability.ts`·`ai-filter.ts`·`skip-reason-formatter.ts`).
  - 정적 목록의 상장폐지 코드 2개(`042670`·`091990`, 시세가 전부 0) 정리 · `isExcluded` 의 우선주 판정 자리 오류(현재 호출부 없음).
- **이슈·위험**: 코어 비율 가드는 현 계좌(국내 보유 삼성전자 1종목)에서 사실상 전부 통과로 바뀐다 — 사용자 수용(「수용하고 진행」). 실주문은 DRY_RUN·검증 관문(전략 16개 모두 미검증)으로 계속 막힌다. 데모 게이트는 도구상 `drafting`(질문 카드 답은 도구가 인정 못 함, 화면 변경 없음). Codex 첫 실행은 서버의 낡은 CLI 때문에 실패했고 재실행으로 완료(호출 2/4).

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: delta (DM-kw-risky-cta) | 11-20 22:38 |

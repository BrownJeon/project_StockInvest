---
project: StockInvest
task: T-081
wp: WP-D
created: 2026-10-25
updated: 2026-10-25
status: design-v3-not-applied
author: analyst
sources: [integrated-execution-procedure §6 S01·§8.1·§9 C01/C05, s00-baseline-report §2.5·§2.8, execution-ledger §5 A04·A06·A12·R05·R06·R10, T-071 WP-2, T-074, profitability-audit F02·§8.4, T-081 "설계 검토 (WP-D, 독립)" 1차·2차]
tags: [type/design, domain/restructure, domain/safety]
---

# T-081 WP-D — 브로커 체결 원장 설계 v3 (원가·실현손익·입출금 설명의 원천) + DDL 초안

> **이 문서는 설계다. 코드·운영 DB 변경은 없다.** DDL 은 [`drafts/T-081-wpd-broker-fills.sql.draft`](drafts/T-081-wpd-broker-fills.sql.draft) 에 **적용하지 않는 초안 v3** 로 두었다(`scripts/migrations/` 에 두지 않았다 — Reviewer·사용자 승인 뒤 옮긴다). 이 문서는 자체 완결이다(v1·v2 본문은 이 문서로 대체됐다).
> **v3.1 변경(좁은 재확인 — DDL 승인 전 1건 + 문안 7건):** N-1 비연속 TR(잔고 조회 — CTRP6504R 헤더 빈 값 `[확실]`)은 `position_snapshot` 종류에 한해 `last_tr_cont IS NULL` 허용(체결·기간손익은 D/E 필수 유지, 분기별 `IS NULL`/`IS NOT NULL` 명시) · L-3 3개월 TR 창 상한 92일 → **85일** · N-2 `yield_tick` 판단을 블록 시작에 읽은 변수 `LAST_RESEARCH_OVS`·`LAST_EDGAR`(호출 전 값)로 · L-a 양성 대조 (a) 는 매도 합 0 이면 적용 안 함 · L-b (b) 의 보유 수량 출처를 창에 따라 구분 · L-c 85일 밖 청크는 행을 쓰지 않고 건너뜀 · L-d 지문 키 교체·개발/운영 키 차이 절차 · L-e `positive-check.ts` 는 D2 소유. 재시험 결과 §9-A.
> **v3 변경(독립 재검토 — 문안·DDL CHECK 추가만):** M-A 첫 삽입 교착(1213) → 재시도 계약·"갭 락 직렬화" 철회 / M-B 빈 응답이 `complete` → 양성 대조(`positive_check`)·부재 주장 제한 / M-C U-1 권고 답 정정 → 질문 삭제·"있다" 기록 / M-D 계좌 지문 → 서버 비밀 HMAC·문구 정정 / L-1 짝 CHECK / L-2 병합 기준 `effective_to` / L-3 잔고 대조 대상·허용치 / L-4 `settle_state` 단방향 / L-5 `fee_*` 소유 / L-6 커버리지 구간 `[prev−L, cur]` / L-7 baseline 절단 / L-8 호출 상한 통일 / L-9 틱 충돌 / §0-6 허용치 숫자.
> **v2 변경(1차 검토):** H-1 완전성 모델 · H-2 upsert 계약 · M1 seed 재정의 · M2 D1a/백필 분리 · M3 `ok` 희소화 문구 철회 · M4 크론 · M5 날짜 기준 · M6 SAFETY_PATHS 결정 · M7 계좌 지문 · M8 수수료·세금 배분 · M9 기업행위·배당 · M10 D0 분리 · L 사실 정정. 처리표는 T-081 `## Analyst 기록`.
> **확신 태그:** `[확실]` 이번 세션에서 파일·운영 DB(읽기 전용)·2026-10-25 KIS 캡처(필드 이름·페이지 신호·합계·상대차만)·일회용 DB 시험으로 직접 확인 / `[가능성 높음]` 강한 추론 / `[추측]` 빈틈을 메우는 중.
> **민감 정보 규칙:** 실제 금액·수량·종목·계좌번호·키는 없다. 예시는 전부 합성값이다. 계좌번호 **원문**은 저장하지 않으며, 지문은 서버 비밀 키 HMAC 의 앞 16 hex 다(§2.3 — 익명화가 아니라 변경 감지 태그).

## 0. 요약 (먼저 읽을 10줄)

1. **권고 유지: `executions` 를 확장하지 말고 새 테이블 5개**(`broker_fill_runs`·`broker_fills`·`broker_fill_revisions`·`broker_realized_pnl`·`broker_position_snapshots`)에 "브로커가 말한 체결·기간손익·오늘 잔고"를 앱 주문과 분리 저장한다. 근거 `[확실]`: 05-27 이후 모든 거래가 앱 밖이고 **앱 주문으로 매수가 접수된 적이 한 번도 없다**(§1 F13). `executions`(order_id NOT NULL+FK) 확장안과 `order_id` nullable 안 모두 기각(§2.1).
2. **수집 완전성(H-1):** 커버리지 = (계좌·시장·종류)별 `complete` 창 `[window_from 00:00, effective_to]` 의 **`effective_to` 기준 병합** 합집합(날짜 인접 병합은 틈을 메우므로 금지 — L-2), 단계는 `[prev.ts − L, cur.ts]`(L-6). `complete` = `finished_at`·마지막 `tr_cont` 명시 D/E(**비연속 TR 인 잔고 조회(position_snapshot)만 빈 헤더 허용** — N-1)·합계 대조·중복 0·**호출을 실제로 했음**(`pages·kis_calls ≥ 1`) + kind·시장·TR 짝(L-1, 3개월 TR 창은 **85일**). **그러나 `complete` 는 "없음"의 증거가 아니다(M-B)** — 같은 날 캡처된 구형 TR 의 빈 응답(행 0·요약 전부 0·`tr_cont=E`)이 `complete` 를 통과한다 `[확실]`. 부재 주장은 `positive_check='confirmed'`(다른 TR·잔고와 교차 합의) 창에서만.
3. **upsert 계약(H-2·M-A):** 행마다 `SELECT … FOR UPDATE` 트랜잭션. **행이 없을 때 INSERT 하는 구조는 연결 2개만 겹쳐도 매회 한쪽이 교착(1213)한다** — 일회용 DB 2연결×25회에서 25/25 재현 `[확실]`. v2 의 "갭 락이 직렬화해 오류 0" 관측은 우연이었고 **철회**한다. 계약: 1213/1205 는 ROLLBACK 후 지터 10~50ms, 최대 2회 재시도(재시도로 25/25 수렴). `raw_hash` 는 마지막 대입(변이 시험 고정), 단조 가드는 수량 + **`closed→open` 단방향**(L-4), `fee_*` 는 D2 소유라 `allocated/actual` 을 수집기가 덮지 않는다(L-5, 시험 고정).
4. **원가·실현손익 정본은 KIS.** 해외 기간손익은 종목·일별 매도마다 원가·실현손익·매도 제비용·환율, 국내는 일별 합산만(`fee`=매수+매도 합, `tl_tax`=매도만) `[확실]`. 앱은 이동평균으로 교차검증, 허용치 **초기값 해외 `max($0.05, 매도대금×0.6%)`·국내 `max(10원, 0.6%)`** 를 D2 첫 달 실측으로 보정. 원가 미상은 KIS 원가 또는 `불명` — 전액 이익 금지.
5. **단계(M2):** **D1a = 원장 기준일(2026-10-25) 이후 앞으로 수집**(DDL + 어댑터 + 수집기 + 크론)이 먼저 — 핵심 가치(Q4 입출금 설명)는 이것만으로 얻는다. **백필(4~10월, 국내 체결은 3개월 한도)은 D1b 로 분리**해 수동 실행만. D2 교차검증 → D3 후보 설명 연결(관측 전용 → 연결) → D4 리포트·보유 원가 표시·`executions` 확장. **D0(별도 소형 작업 제안): `computeLifoPnl` 의 0원가 가드.** WP-E(#2107 정리)는 `positive_check='confirmed'` 창이 생기기 전에는 "없음"을 근거로 쓸 수 없다.
6. **`ok` 희소화(M3):** v1 의 "`ok` 는 좁아지는 쪽으로만" 문구는 **철회**됐다. 억제 규칙은 `ok` 를 늘릴 수 있고(§5.4 경로 2개), `partial` 사유 증가로 C05("월 −5% 판정은 `ok` 만")가 사실상 돌지 않을 수 있다. 억제는 특정 체결 1건과 **정확 일치(허용치 초기값 = 해외 `max($0.05, 0.6%)`·국내 `max(10원, 0.6%)`, D2 보정) + 1회 소비** 조건으로만. WP-F 연결은 1~2개월 정량화 + C3 정책 결정 뒤(U-6).
7. **크론(M4·L-8·L-9):** 백필은 크론 밖. 일일 수집 `HH=07 && MM>=20` + 날짜파일, `--max-time 90`, 라우트 예산 75초, single-flight, 스위치 `broker_fills_cron_enabled`(기본 꺼짐), **KIS 호출 상한 = run 당 12(하루 크론 1회 ≤ 6 run)**, 연속 실패 3회 중단. 러너가 07:20 이후 재기동되면 edgar·research 와 한 틱에 겹치므로 **그 두 블록이 틱 시작에 읽어 둔 변수 `LAST_RESEARCH_OVS`·`LAST_EDGAR`(호출 전 값)가 오늘이 아니면 수집을 다음 틱으로 미룬다**(§3.7 — 날짜파일을 다시 읽으면 같은 틱에서 이미 오늘로 바뀌어 있어 발동하지 않는다, N-2). 하트비트 정상 최악 90+30+60 = 180 < 300초.
8. **DDL 영향:** 기존 테이블 변경·행·락 0, 새 테이블 5개 `IF NOT EXISTS`, 롤백 DROP 5줄. 일회용 MariaDB 10.11(운영 sql_mode·서버 utf8mb3)에서 v3 초안 2회 적용 멱등·롤백 2회·재적용·CHECK 43건(짝 CHECK 16건 포함)·2연결/6연결 교착 재현 + 재시도 수렴·단방향·수수료 소유·병합 시험 통과 `[확실]`(§9). 운영 적용 순서는 **격리 DB 시험 → Reviewer → 사용자 승인 → 오프아워 적용 → 코드 배포**.
9. **사용자 결정(§8):** **U-1 삭제**(M-C — 2026-04-26 첫 스냅샷에 이미 보유 16행 `[확실]`, 답은 "있다") · U-2 삭제(미니스탁 포함은 AI 결정) · U-3 수수료·세금 확정 기준 = KIS 기간손익 값(권고 예) · U-4 백필 최소 35~42 GET + 크론 등록·스위치(권고 예) · U-5 SAFETY_PATHS 에 `^src/lib/broker-ledger/` 추가(권고 추가) · U-6 `ok` 희소화 정책(권고: 정량화 전 미연결).
10. **확인하지 못한 것(§10):** 해외 체결 조회 기간 한도·날짜 기준·주문번호 날짜 간 재사용·해외 기간손익 (날·종목) 유일성·`pchs_amt` 수수료 포함·해외 매도 대금 반영 시점·취소 행 모양·배당 TR·`splt_buy_attr_name` 의미·틱 소요 — 첫 라이브 확인 목록(§3.8), 수집기는 그 전까지 fail-closed. **양성 대조는 거래가 0 인 창을 "세 원천 합의"로만 확정할 수 있어 조용한 누락을 완전히 배제하지 못한다.**

## 1. 전제와 이번에 확인한 사실

| # | 사실 | 근거 |
|---|---|---|
| F1 | `executions` 0행, `cash_flow_ledger` 0행, `orders` 3,229행(filled 17), `portfolio_snapshots` 4,755행(04-26~), **`fx_rates` 1행**(PK=`pair` 5분 TTL 캐시 — 이력이 구조적으로 없다 → 과거 환율 DB 복원 불가라는 결론은 유지) | `[확실]` 운영 DB 읽기 전용(`SET SESSION TRANSACTION READ ONLY` → `tx_read_only=1` 확인 후 SHOW/SELECT/COUNT 만) |
| F2 | 운영 DB: MariaDB 10.11.11-log, `sql_mode=IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION`(**NO_ZERO_DATE 없음** → `'0000-00-00'` 이 들어간다), `innodb_strict_mode=1`, 서버 기본 utf8mb3_general_ci(테이블은 utf8mb4_general_ci — **general_ci 라 `'usd'` 도 `IN ('USD')` 를 통과**), TZ=KST, 앱 DB 계정이 스키마 ALL PRIVILEGES | `[확실]`. 두 함정은 DDL 에서 날짜 범위 CHECK·`utf8mb4_bin` 통화 열로 막았다(§6) |
| F3 | 앱 체결 기록 경로는 `order-sync.ts recordSettledFill` 한 곳, `INSERT … SELECT ?, ?, ?, 0, ? …` 로 **fee=0 하드코딩**, 해외는 `orders.price`(KRW) 고정(T-071 R-07 1안) | `[확실]` `src/lib/safety/order-sync.ts:1293-1295` |
| F4 | `trade-report.ts fetchOrderRows` 는 `status='filled'` 주문만, 30일 prefetch; `computeLifoPnl` 은 재고(stack)가 **완전히 비면** `matchedQty=0` → `sellRevenue=amount_krw` → 매도대금 전액이 이익, **부분 재고면** 초과분 매도가 수익·원가 모두에서 빠져 **과소 계상** | `[확실]` `src/lib/reports/trade-report.ts:201-227, 259-289` |
| F5 | `candidates.ts:57 if (!st.holdingsSame) continue;` — 보유가 바뀐 단계는 후보 탐지에서 통째로 빠진다 | `[확실]` |
| F6 | KIS 응답 모양(2026-10-25 캡처, 필드 이름·페이지 신호·합계·상대차만): **국내 체결 TTTC0081R**(`PDNO=''`·`EXCG_ID_DVSN_CD=ALL` 전 종목, 행 = 주문별 `odno·orgn_odno·ord_dt·ord_tmd·pdno·sll_buy_dvsn_cd·ord_qty·ord_unpr·tot_ccld_qty·tot_ccld_amt·avg_prvs·rmn_qty·rjct_qty·cncl_cfrm_qty·cncl_yn·excg_id_dvsn_cd·ord_dvsn_cd·…`, 요약 `output2.tot_ccld_qty/tot_ccld_amt/tot_ord_qty/prsm_tlex_smtl`, **Σ행 = 요약 정확 일치**, `tr_cont=E`) / **해외 체결 TTTS3035R**(`OVRS_EXCG_CD='%'`·`PDNO=''` 전 거래소·전 종목, 행 = 주문별 `odno·orgn_odno·ord_dt·dmst_ord_dt·ord_tmd·thco_ord_tmd·pdno·ovrs_excg_cd·sll_buy_dvsn_cd·ft_ord_qty·ft_ord_unpr3·ft_ccld_qty·ft_ccld_unpr3·ft_ccld_amt3·nccs_qty·prcs_stat_name·rvse_cncl_dvsn·rjct_rson·tr_crcy_cd·splt_buy_attr_name·…`, **요약 블록 없음**, 수수료·환율 없음, `tr_cont=D`) / **국내 기간손익 TTTC8708R**(행 = **일별 합산** `trad_dt·buy_qty1·buy_amt·sll_qty1·sll_amt·rlzt_pfls·fee·tl_tax·loan_int·pfls_rt` — 종목 없음, **`fee`=매수+매도 합·`tl_tax`=매도만**, 요약 `output2.tot_rlzt_pfls/tot_fee/tot_tltx/…`, Σ행 = 요약 정확 일치, `tr_cont=D`) / **해외 기간손익 TTTS3039R**(행 = 종목·일별 매도 `trad_day·ovrs_pdno·ovrs_excg_cd·slcl_qty·pchs_avg_pric·frcr_pchs_amt1·avg_sll_unpr·frcr_sll_amt_smtl1·stck_sll_tlex·ovrs_rlzt_pfls_amt·pftrt·exrt·frst_bltn_exrt`, 요약 `output2.ovrs_rlzt_pfls_tot_amt/stck_sll_amt_smtl/…`, **첫 페이지 `tr_cont=M` 이고 Σ행 ≠ 요약**) / **잔고 TTTC8434R**(`pchs_avg_pric·pchs_amt·hldg_qty·thdt_buyqty·thdt_sll_qty`, Σ`evlu_amt` = `output2.evlu_amt_smtl_amt` 정확 일치) / **잔고 CTRP6504R**(`avg_unpr3·frcr_pchs_amt·cblc_qty13·thdt_buy_ccld_qty1·thdt_sll_ccld_qty1`, Σ`frcr_evlu_amt2` vs `output3.evlu_amt_smtl` 상대차 **4.0e-5**, vs `frcr_evlu_tota` 상대차 **9.95e-1** — 후자는 달러 예수금 줄; Σ`frcr_pchs_amt` vs `pchs_amt_smtl` 5.2e-5; 행별 `qty×price` vs `frcr_evlu_amt2` 최대 1.3e-7; **기준일 파라미터 없음 — 오늘 잔고만**; **`tr_cont` 헤더 빈 값(비연속 TR — 국내·해외 주문가능조회도 같음, 국내 잔고 TTTC8434R 은 'D')**). **구형 TR(A06) 빈 응답은 rt_cd 0·`tr_cont=E`·행 0·요약 전부 0** | `[확실]` 스크래치패드 `s00/kis-capture*-raw.json` 키·합계·상대차 추출(값은 보지 않음) |
| F7 | 체결 조회 시각은 **주문 시각**(`ord_tmd`, 해외 `dmst_ord_dt+ord_tmd`)이고 해외 조회 창의 날짜 기준(현지/KST)은 **미확인** | `[확실]` 어댑터 주석·코드 / 기준은 `[추측]` |
| F8 | 국내 TTTC0081R 은 "3개월 이내 조회" TR, 3개월 초과는 `CTSC9215R` 필요(기존 제약으로 기록됨) | `[확실 — 코드 주석·T-081 후속 ④]`, CTSC9215R 응답 모양은 `[추측]` |
| F9 | `kisFetch` 는 우선순위(`critical/normal/bulk`)·유량 토큰(기본 5/초)·대기 상한 30초·레이트리밋 백오프를 공유. 계좌번호는 `getCredential('KIS_ACCOUNT_NO')`(system_config `cred_*` > env, 60초 캐시)로 설정에서 바뀔 수 있다 | `[확실]` `kis-http.ts`·`kis-throttle.ts`·`kis-auth.ts`·`credentials.ts` |
| F10 | 커밋 훅 SAFETY_PATHS 에 `^src/lib/exchanges/`·`^src/lib/db\.ts$`·`^src/lib/auth/…`·`^src/app/api/cron/`·`^scripts/cron-runner\.sh$`·`^scripts/migrations/` 는 **있고**, `src/lib/ledger/`·`src/lib/reports/`·(신설 예정) `src/lib/broker-ledger/` 는 **없다** | `[확실]` `awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg` |
| F11 | `scripts/cron-runner.sh`: 직렬 루프(틱 + sleep 60), 하트비트 300초 한도(HOME-SERVER 순찰이 넘으면 재시작), `HH` 패턴은 **그 시의 첫 틱**(07:00)에서 돈다. 07시 틱 = `research-cycle-overseas`(**상한 없음**) + `edgar-sync`(라우트 예산 100초), 08시 틱 = `post-market-overseas`(`--max-time 120`) + `kis-fundamentals-snapshot`, 06시 = `news-fetch`, 16시 = 국내 post-market + research, 17시·17:30 = meta·rs-update, 03시 = trainset. `--max-time` 은 `CALL_MAX_TIME` 변수로 호출별 적용(선례 2곳). 각 하루 1회 블록은 **블록 시작에 `LAST_*` 변수를 읽고**(`LAST_RESEARCH_OVS` 258행·`LAST_EDGAR` 267행) call 직후 날짜파일을 `$TODAY` 로 쓴다 — 변수는 그 틱 안에서 바뀌지 않지만 파일은 바뀐다 | `[확실]` `scripts/cron-runner.sh:39-77, 180-290` |
| F12 | 마이그레이션 선례 형식: 머리 주석 + `SET SESSION lock_wait_timeout = 5;` + `IF NOT EXISTS` + 되돌리기 주석 `-- DROP …`(일회용 DB 시험이 정규식으로 읽어 실행). `ledger/store.ts` 는 테이블 부재(1146)를 503 `not_migrated` 로 바꾼다 | `[확실]` `scripts/migrations/T-072·T-074`, `t074-disposable-mariadb.test.ts`, `store.ts:118-125` |
| **F13 (M-C)** | **2026-04-26 첫 스냅샷에 이미 수량>0 인 비현금 보유 16행(해외 형식 14·국내 6자리 2)**. 앱 `filled` 주문 17건은 **전부 매도**(국내 1·해외 16, 05-12~05-27), 앱으로 접수·체결된 **매수 주문은 0건**. 즉 현재·과거 보유의 취득은 전부 앱 밖이고 04-26 이전 보유가 **있다** | `[확실]` 운영 DB 읽기 전용(건수·형식만 조회). v2 의 "없다 [가능성 높음]"은 S00 §2.8 의 현재 보유 서술을 과거에 잘못 적용한 오류 — 정정 |
| **F14 (M-D)** | 서버 비밀은 `CREDENTIALS_ENCRYPTION_KEY`(env, 32바이트 base64; `src/lib/auth/secret-box.ts` — `readKey()` 비공개, `isEncryptionConfigured()` 공개). 솔트 없는 sha256 지문은 8자리 계좌 공간을 분 단위로 역산할 수 있다(독립 재검토 측정, 단일 코어 초당 약 160만 해시) | `[확실 — 코드]`·역산 속도는 재검토 인용 |

## 2. Q1 — 무엇을 어디에 저장하나: 새 테이블 묶음 (권고 유지)

### 2.1 결정과 기각안

**권고안 A — 브로커 원장(새 테이블 5개)과 앱 주문 장부의 분리.** 돈의 사실은 브로커 원장이 정본, 앱 장부(`orders`·`executions`)는 "앱이 보냈다고 믿는 것"이며 `broker_fills.app_order_id` 소프트 링크로 **대사**만 한다.

| 비교 | 기각안 B — `executions` 확장(T-071 WP-2 방향) | 기각안 B′ — `executions.order_id` 를 NULL 허용으로 | 권고안 A — 새 테이블 |
|---|---|---|---|
| 앱 밖 거래(05-27 이후 전부, 매수는 처음부터 전부 앱 밖 — F13) | `order_id NOT NULL`+FK → 가짜 `orders` 행 필요. 그 행이 `checkDailyMax`·종목 게이트·`trade-report`(`status='filled'`)를 오염(T-072 L-3 와 같은 기각 사유) `[확실 — 구조]` | 가짜 주문은 피하지만 `executions` 의 의미("앱 주문의 체결")가 둘로 갈라져 `order-sync`·`trade-report` 의 모든 조회에 `order_id IS NULL` 분기가 생긴다 | 필요 없음. `app_order_id NULL` 이 정상값 |
| 추가 열 | 통화·원가격·환율·수수료 종류·요율 등 7개 ADD + `orders` 3개 ADD | 같은 7개 ADD + FK 변경(WP-1 의 `INSERT … SELECT … FROM orders WHERE status=?` 크래시 안전 규약이 NULL 행에는 무의미) | 신규 테이블이라 구 코드 영향 0 |
| T-019 "UNIQUE 금지·주문당 1행" 규약, WP-1 통과 전제 | 바꾸면 `order-sync` 재감사 | 같다 — 브로커 주문번호 자연키 UNIQUE 를 `executions` 에 걸 수 없다(T-019 결정과 충돌) | 자연키 UNIQUE 가능 |
| 완전성 증명(runs)·오늘 잔고(snapshots)·기간손익(realized_pnl) | 어차피 별도 테이블이 필요하다 — `executions` 확장만으로는 "없음"을 주장할 수 없고 교차검증 정본이 없다 | 같다 | 묶음 안에 있다 |
| 롤백 | 두 테이블 ALTER 되돌리기(데이터 손실 검토) | 같다 | DROP 5줄, 코드 revert 영향 0 |
| 앱 주문이 다시 생길 때 | 필요(해외 USD 단가·추정 수수료) | 필요 | **대체하지 않는다** — `executions` 확장은 D4 로 이월(폐기 아님) |

### 2.2 테이블 5개의 역할

| 테이블 | 1행 | 핵심 열·제약(v2·v3 누적) |
|---|---|---|
| `broker_fill_runs` | 수집 실행 1회(시장·종류·창) | `account_fingerprint`·`query_from/to`·`date_basis`·`last_tr_cont`(utf8mb4_bin)·`sum_check`·**`positive_check`**(M-B)·`effective_to`(생성열 `LEAST(TIMESTAMP(window_to)+1일, started_at)`)·`kis_calls`·`rows_stale_skipped`·`duplicate_keys`. CHECK: `chk_bfr_complete`(`finished_at`·`sum_check IN ('match','unavailable')`·`duplicate_keys=0`·**`pages≥1 ∧ kis_calls≥1`**·`last_tr_cont` 는 **체결·기간손익 창에서 `IS NOT NULL AND IN ('D','E')`, 잔고 스냅샷 창에서 `IS NULL OR IN ('D','E')`**(N-1)), `chk_bfr_finished`(running ⇔ `finished_at` NULL, 아니면 `≥ started_at`), **짝 CHECK(L-1)**: kind↔TR, market↔TR, `unavailable` 은 해외 체결 창만, `_TTC0081R` 은 `query_from ≥ DATE(started_at)−85일`(v3.1), position_snapshot 은 하루 창·query=window, `positive_check`(스냅샷 ⇔ n/a, confirmed ⇒ complete), 날짜 범위, `query ⊇ window` |
| `broker_fills` | 브로커 주문번호별 누적 체결 집계(체결 0 포함) | 열을 **원문열 / 수집기 파생열(`settle_state`·KRW `amount_krw_est`) / D2 파생열(`fee_*`·`tax_native`·`fx_*`·USD `amount_krw_est`·`app_order_id`·`reconcile_state`) / 메타** 로 구분, `derived_for_revision`(+CHECK `≤ revision`, D2 파생값이 있으면 필수), `account_fingerprint`, `fractional_hint`(`splt_buy_attr_name` 원문), `tax_native` 는 매도 행만(CHECK), `currency` utf8mb4_bin, 날짜 범위 CHECK, `fx_source=none ⇒ fx NULL`(1·1380 폴백 거부) |
| `broker_fill_revisions` | 교체된 이전 원문 | 추가 전용. **v1 범위에 유지**(판단 §2.4) |
| `broker_realized_pnl` | KIS 기간손익 행(국내 `day` / 해외 `day_symbol`) | `symbol NOT NULL DEFAULT ''`(NULL 이면 UNIQUE 가 중복을 못 막는다), 날짜 범위·`currency` bin. **M-B 양성 대조의 짝** |
| `broker_position_snapshots` (v1 `*_seeds`) | **조회일(오늘) 기준** 보유·평균단가 1종목 | 잔고 TR 에 기준일 파라미터가 없어 과거 기준 잔고는 만들 수 없다(M1). `as_of`=조회일, `is_baseline`, 매일 1세트 누적 → "baseline + 누적 체결 = 오늘 잔고" 대사(L-7 절단 규칙 §4.3). 거래 0 창의 양성 대조(M-B) |

### 2.3 그레인과 열 설계에서 특별히 다룬 것
- **이중 통화(해외):** 원통화 열(`currency`·`avg_fill_price`·`fill_amount`·`fee_native`·`tax_native`)과 환산 열(`fx_usdkrw`·`fx_source`·`amount_krw_est`) 분리. **환율을 모르면 NULL**(CHECK `chk_bf_fx` 가 `fx_source='none' AND fx_usdkrw IS NOT NULL` 을 거부 — `fetchUsdKrwRate` 의 "실패 시 1", `fx.ts` 의 1380 폴백은 들어오지 못한다). 환율 원천은 ① 기간손익 매도 행 `exrt`(매도 건) ② 앱 스냅샷 USD 행 `price`(그 시간대, 추정 라벨) ③ 수동 — `fx_rates` 는 이력이 없어(F1) 못 쓴다.
- **부분체결·정정·취소:** 같은 주문번호의 누적 수량이 늘면 같은 행 UPDATE(revision+1, 이전 원문은 revisions). 정정·취소로 새 번호가 나오면 새 행 + `orig_order_no`. `settle_state`: 잔량 > 0 `open` / 잔량 0·취소·거부 `closed` / 판독 불가 `unknown`(가짜 0 금지). **전이는 단방향**(L-4): `closed → open` 은 취소·정정 신호(`revise_cancel_code`·`cancelled_qty`)가 있을 때만 — 같은 수량의 낡은 `open` 응답이 닫힌 행을 되돌리던 것을 시험으로 고정. 체결 0 행도 저장 — 조회 파라미터는 "체결만"(`01`)이 아니라 **전체**(`00`) `[가능성 높음 — 캡처는 01·00 이 같은 행 수였고 취소가 없던 날이라 차이를 보지 못했다 → 첫 라이브 확인]`.
- **계좌 지문(M7·M-D 정정):** `HMAC-SHA256(key, CANO||'-'||ACNT_PRDT_CD)` 앞 16 hex. 키는 **서버 비밀 `CREDENTIALS_ENCRYPTION_KEY` 에서 HKDF(라벨 `broker-ledger/account-fp`)로 파생** — `secret-box.ts` 의 `readKey()` 가 비공개라 D1a 에서 `secret-box.ts` 에 `fingerprintSecret(input)` 한 함수를 추가한다(`src/lib/auth/` 는 SAFETY_PATHS → Reviewer scope 포함). 키가 없으면(`isEncryptionConfigured()=false`) 수집기는 **실행하지 않는다**(`failed`, `error='fingerprint_key_missing'`). 같은 `account_id` 의 직전 run 지문과 다르면 쓰지 않고 `failed`+`error='account_changed'`(fail-closed); 계좌가 바뀌면 사용자가 `accounts` 행을 새로 만들어 `account_id` 를 바꾼다(운영 설정). **문구 정정:** 지문은 **익명화가 아니다** — 키 보유자는 계좌번호 후보를 대조할 수 있다; 키 없는 공격자가 역산할 수 없다는 뜻이다. **대안(기각):** `system_config.cred_KIS_ACCOUNT_NO` 의 `updated_at` 또는 `getCredentialState().source` 로 변경 감지 — env 원천 계좌는 시각이 없고 DB 원천만 잡혀 fail-closed 보장이 안 된다. 열 정의 `CHAR(16)` 은 그대로. **운영 절차(L-d):** 지문이 `CREDENTIALS_ENCRYPTION_KEY` 에 묶여 있어 **키 교체**(secret-box 모듈 머리에 "로테이션 범위 밖")나 **개발·운영 키 차이**가 그대로 `account_changed` 중단으로 나타난다. ① 비교 대상은 "직전 **성공**(complete/incomplete) run 의 지문"이다 — 실패한 run 의 지문과 비교하면 한 번 틀린 환경이 이후 운영 수집까지 막는다 ② 키를 바꾸기 전에 수집 스위치를 끄고, 교체 뒤 첫 실행이 `failed(account_changed)` 로 멈추면 사용자 승인 아래 재설정 스크립트(`scripts/broker-ledger/refingerprint.mjs`, 별도 작업·Reviewer)가 runs·fills·pnl·snapshots 의 `account_fingerprint` 를 새 값으로 일괄 갱신한다 ③ 개발과 운영이 같은 DB 를 보므로 **수집기는 운영 서버에서만** 돌린다 — 다른 키를 가진 개발 환경에서 띄우면 즉시 중단되고(의도) 그 `failed` 행은 운영 수집을 막지 않는다(①).
- **국내 NXT/KRX/SOR:** `exchange_code` 에 `excg_id_dvsn_cd` 원문 보존(CHECK 없음), 자연키에 넣지 않음. SOR 분할 체결로 같은 주문번호가 거래소별로 둘 오면 메모리 중복 검사에 걸려 `duplicate_keys`→`incomplete` 로 드러난다(첫 라이브 확인).
- **미니스탁(소수 수량) — AI 결정: 포함.** `DECIMAL(24,8)` 소수 허용, 해외 `splt_buy_attr_name` 을 `fractional_hint` 에 원문 보존해 표지 후보로 쓴다(`[가능성 높음 — 필드 이름 "소수점매수속성명" 해석, 값 미확인]`). 스냅샷 `positions` 에 소수 보유가 없으므로(S00 §2.8) §5 의 보유 변화 매칭에는 못 쓰고 현금 설명에만 쓴다.
- **개인·단말 필드 제거:** `raw_json` 저장 전 `ctac_tlno`·`inqr_ip_addr`·`ordr_empno` 제거 `[확실 — 캡처 키에 존재]`. 계좌번호는 응답 행에 없고 요청에만 있다.

### 2.4 `broker_fill_revisions` 를 v1 에 두는 판단
빼도 되는 근거: 소비자 없음, D1a 범위 축소. 두는 근거: 부분체결 진행(3→5주)·정정 취소(5→4주)에서 이전 수량은 **그 행에서 사라지고** `revision` 숫자만 남는다 — S01 완료 기준 "부분체결·재시작·취소 대사에서 장부를 잃지 않음"의 증거가 이 테이블뿐이다. 비용은 트랜잭션 안 INSERT 1회·시험 2건. **결정: 유지.** Leader 가 D1a 를 더 줄이기로 하면 이 테이블과 §3.2 의 revisions INSERT 한 줄만 빼면 되고 다른 테이블·CHECK 는 영향이 없다.

### 2.5 합성 예시(값은 전부 가짜)
```
broker_fills: market=overseas, order_date=2026-11-03, broker_order_no='0000012345', symbol='NAS:XMPL', side=buy, currency=USD,
  order_qty=3, filled_qty=3, remaining_qty=0, avg_fill_price=101.2345, fill_amount=303.7035,
  fee_native=0.759259, fee_kind=estimated, fee_rate_pct=0.25000 (수집기가 estimated 상태에서만 기록), fx_source=none, amount_krw_est=NULL,
  settle_state=closed, app_order_id=NULL, reconcile_state=unlinked, derived_for_revision=NULL, revision=1, account_fingerprint='0123456789abcdef'(합성)
broker_realized_pnl(day_symbol): trade_date=2026-11-10, symbol='NAS:XMPL', sell_qty=3, avg_buy_price=101.2345, avg_sell_price=99.0000,
  realized_pnl_native=-7.4035(합성), fee_native=0.7425(stck_sll_tlex), fx_usdkrw=1400.0000
broker_realized_pnl(day): market=domestic, trade_date=2026-11-04, symbol='', sell_amount_native=1234000, fee_native=185(매수+매도 합), tax_native=2221(매도만), realized_pnl_native=-5600
broker_fill_runs: market=overseas, kind=fills, source_tr='TTTS3035R', window 2026-11-03..2026-11-03, query 2026-11-02..2026-11-04, status=complete,
  last_tr_cont='D', sum_check=unavailable, positive_check=confirmed(같은 창 realized_pnl Σ매도 수량과 일치), pages=1, kis_calls=1
```

## 3. Q2 — 멱등 수집

### 3.1 자연키
- `broker_fills` 자연키 `(account_id, broker, market, order_date, broker_order_no)`. 주문번호 유일성이 **영업일 단위**라는 가정 `[가능성 높음 — KIS 번호 체계 관행, 라이브 미확인]` 때문에 주문일을 넣는다. 수량·방향은 바뀌는 값이라 키에 넣지 않는다. 계좌 지문은 키가 아니라 가드(§2.3).
- `broker_realized_pnl` 자연키 `(account_id, broker, market, trade_date, grain, symbol)`, `broker_position_snapshots` `(account_id, broker, market, as_of, symbol)`.

### 3.2 쓰기 계약(H-2·M-A·L-4·L-5) — 일회용 DB 로 검증
1. **응답 단위 메모리 검사:** 한 응답(전 페이지)의 행을 자연키로 묶어 **겹치는 키는 쓰지 않고** `run.duplicate_keys++`. `duplicate_keys>0` 이면 CHECK 가 `complete` 를 거부한다.
2. **행 단위 트랜잭션:** `BEGIN` → `SELECT … FOR UPDATE`(자연키) →
   - 없음 → INSERT(`rows_inserted++`)
   - 있음·`raw_hash` 같음 → `last_seen_at·last_run_id` 만 UPDATE(세지 않음)
   - 있음·다름·**단조 가드**: ① 새 `filled_qty` < 현재 `filled_qty` ② 현재 `settle_state='closed'` 인데 새 응답이 `open` — 둘 다 취소·정정 신호가 없으면 **쓰지 않음**(`rows_stale_skipped++`, `run.error` 에 주문번호 메모)
   - 있음·다름 → `broker_fill_revisions` 에 이전 행 INSERT → 원문열·`settle_state`·(KRW `amount_krw_est`) UPDATE, **`fee_*` 는 현재 `fee_kind IN ('unknown','estimated')` 일 때만 estimated 재계산**(`allocated/actual` 보존 — L-5), `revision+1`, **`raw_hash` 는 마지막 대입**(`rows_updated++`)
   → `COMMIT`.
3. **교착·락 대기(M-A):** "FOR UPDATE 뒤 행이 없으면 INSERT" 구조는 두 연결이 같은 새 키를 동시에 넣을 때 **매회 한쪽이 1213** 으로 실패한다 — 일회용 DB 2연결×25회에서 재시도 없이 25/25 교착, 6연결×25회에서 교착 103·삽입 25·unchanged 22 `[확실]`. 계약: 1213(`ER_LOCK_DEADLOCK`)·1205(`ER_LOCK_WAIT_TIMEOUT`)는 ROLLBACK → 10~50ms 지터 → 같은 행 재시도 **최대 2회**(재시도 적용 시 2연결 `inserted 25·unchanged 25`, 6연결 `inserted 25·unchanged 125` 로 전부 수렴 `[확실]`). 그 뒤에도 실패하면 그 행만 건너뛰고 `run.error` 메모(그 run 은 `incomplete`). v2 의 "동시 6회 오류 0 — 갭 락이 직렬화" 주장은 **철회**한다(우연한 타이밍).
4. **`raw_hash` 대입 순서:** 단일문 ODKU 를 쓰더라도 `raw_hash = VALUES(raw_hash)` 는 목록의 **마지막**. 먼저 두면 값·revision 은 갱신되지 않고 해시만 전진해 변경이 **영구 유실**된다(시험으로 재현, 변이 시험 고정 §9-D).
5. **파생열 소유(L-5 정정):** 원문열(KIS 매핑) / 수집기 파생열(`settle_state`·KRW `amount_krw_est`) / **D2 파생열(`fee_native`·`fee_kind`·`fee_rate_pct`·`tax_native`·`fx_*`·USD `amount_krw_est`·`app_order_id`·`reconcile_state`·`derived_for_revision`)**. 수집기가 `fee_*` 를 쓰는 유일한 경우는 `estimated` 상태 유지(0.25%×체결대금 재계산). 하향 금지(actual > allocated > estimated > unknown, `fx_source` 는 kis_period_profit > app_snapshot > manual)는 **DB 가 아니라 앱 규칙**이라 시험으로 고정한다(일회용 DB 시험: D2 `allocated 0.5` 위로 수집기 revision 이 돌아도 `allocated`·값 보존, revision 2·`derived_for_revision` 낡음 표시 `[확실]`). D2 는 `derived_for_revision <> revision` 행을 `idx_bf_stale_derived` 로 집어 재계산한다.
6. **건수(H-2 ⑥):** `rows_inserted/updated/stale_skipped` 는 위 분기 결과로 센다. `affectedRows` 는 삽입 1·완전 동일 1 또는 0·`last_seen` 만 갱신 2·내용 변경 2 라 구분할 수 없다.
7. **`raw_hash`** = 민감 필드를 제거하고 키를 정렬한 원문 JSON 의 SHA-256. KIS 가 필드를 추가해도 "바뀜"으로 기록된다(과탐 방향 — 안전).

### 3.3 삭제·취소·사라진 행
DELETE 없음. 창에서 사라진 행은 `last_seen_at` 이 멈춘 채 남고 D2 리포트가 "최근 complete 창에 재관측되지 않음"으로 표시한다. 취소 확정은 새 행(`orig_order_no`) 또는 같은 행의 `cancelled_qty`/`revise_cancel_code` 갱신 + `settle_state=closed`.

### 3.4 완전성 모델(H-1·M-B·L-1·L-2·L-3·L-6)
- **`complete` 정의(CHECK):** `finished_at ≥ started_at` · 마지막 `tr_cont`: **체결·기간손익(연속 TR)은 `∈ {D,E}` 명시**(NULL·빈 헤더·`M`·`F`·소문자 불가), **잔고 스냅샷(비연속 TR — CTRP6504R 은 헤더가 빈 값 `[확실]`, N-1)은 NULL 또는 D/E 허용**(`M`/`F` 는 거부, 요약 합계 대조 `sum_check` 는 그대로 요구) — 분기마다 `IS NULL`/`IS NOT NULL` 을 먼저 묶어 `NULL IN (…)` 함정 없음 · `sum_check ∈ {match, unavailable}`(`unavailable` 은 해외 체결 창만) · `duplicate_keys = 0` · **`pages ≥ 1 ∧ kis_calls ≥ 1`** · kind↔TR·market↔TR 짝 · `_TTC0081R` 은 **85일** 안 창만(L-3: 달력 3개월은 89~92일이라 92 는 연중 약 41% 날짜에서 KIS 실제 한도보다 느슨할 수 있다 — 한도 정의 미확인, 7일 여유; 그 밖은 `CTSC9215R`) · position_snapshot 은 하루 창.
- **합계 대조 규칙(L-3 정정):** 국내 체결 `Σtot_ccld_qty = output2.tot_ccld_qty ∧ Σtot_ccld_amt = output2.tot_ccld_amt`(정확) / 국내 기간손익 `Σrlzt_pfls = tot_rlzt_pfls ∧ Σfee = tot_fee ∧ Σtl_tax = tot_tltx`(정확) / 해외 기간손익 `Σovrs_rlzt_pfls_amt = ovrs_rlzt_pfls_tot_amt ∧ Σfrcr_sll_amt_smtl1 = stck_sll_amt_smtl`(**전 페이지 합**, 정확) / 국내 잔고 `Σevlu_amt = output2.evlu_amt_smtl_amt`(정확) / **해외 잔고 `Σfrcr_evlu_amt2 = output3.evlu_amt_smtl`, 상대 허용치 1e-3**(실측 상대차 4.0e-5 — 정확 일치로 구현하면 영구 mismatch; `frcr_evlu_tota` 는 달러 예수금 줄이라 대상이 아니다) / 해외 체결 `unavailable`. "정확"은 소수 2자리 반올림 뒤 비교. 캡처로 판별력 확인: 완료 응답은 일치, 해외 기간손익 첫 페이지(`M`)는 불일치 `[확실]`.
- **양성 대조(M-B) — `positive_check`:** 합계 대조는 응답의 **내부 일관성**만 본다. 구형 TR 빈 응답(행 0·요약 0·`tr_cont=E`)이 `complete` 를 통과하면서 실제 체결 2건을 숨긴 캡처가 있다 `[확실]`. 그래서 창마다 다른 원천과 교차한다: **(a)** 같은 창의 fills Σ매도 체결수량 = realized_pnl Σ매도 수량(해외 종목별·국내 일별) **이고 그 합이 0 이 아닐 때** → `confirmed`(L-a: 양쪽 0 은 0=0 이라 증거가 아니다 — 매도 합이 0 이면 (a) 를 적용하지 않고 (b)·보유 대사로 넘긴다) / **(b)** 두 TR 모두 행 0 이고 창 양끝 보유 수량이 같음(세 원천이 "거래 없음"에 합의) → `confirmed`. **양끝 보유 수량의 출처(L-b):** D1a 이후 창은 `broker_position_snapshots`(그날 잔고 TR, 소수 보유 포함, L-7 절단 가능) / **백필 창과 #2107(5월) 확정은 `portfolio_snapshots`**(04-26~ 시간당, 창 시작 직전 행과 끝 직후 행 — 소수 보유가 없고 당일 체결 절단이 불가하므로 결과를 `confirmed(secondary)` 로 표시해 구분) / 그 외 `unconfirmed`, 짝 창이 아직 없으면 `pending`. 쓰는 주체(L-e): 수집기는 `pending`/`n/a` 만, `confirmed`/`unconfirmed` 는 D2 `positive-check.ts` 가 쓴다. CHECK: 스냅샷 ⇔ `n/a`, `confirmed ⇒ complete`. **사용 제한:** `complete` 는 "받은 행은 사실·창을 끝까지 봤다"이고, **"이 창에 없다"는 주장은 `positive_check='confirmed'` 창에서만** 허용한다 — D3 의 "체결 없음 → `unexplained_holdings_change`" 판정, WP-E(#2107)의 "complete 창에 그 주문이 없다" 근거 모두 해당. **한계:** (b) 는 거래 0 인 창에서만 성립하고 세 원천이 같은 방식으로 틀리면(같은 계좌 파라미터 오류) 못 잡는다; 매수만 있고 매도가 없는 창은 기간손익에 행이 없어 (a) 로 확정할 수 없다 → 잔고 변화(스냅샷 ΔQ = Σ매수 체결)로 보조 확정(D2 보유 대사 `match`).
- **커버리지 판정(L-2·L-6):** (계좌·시장·종류)별 `complete` 행들의 `[TIMESTAMP(window_from), effective_to]` 를 **`effective_to` 기준으로 병합**(다음 창 `window_from 00:00 ≤` 앞 창 `effective_to` 일 때만 이어짐)한 합집합에 단계 **`[prev.ts − L, cur.ts]`**(L = 체결 매칭 여유 1일)가 통째로 들어갈 때만 커버됨. `effective_to = min(window_to 24:00, started_at)`(생성열 — 실행 뒤에 생긴 체결은 보증하지 않는다). v2 의 "`window_to+1일 = 다음 window_from` 날짜 인접 병합"은 앞 창이 당일 07:25 에 돌았을 때 그날 오후를 커버됨으로 읽어 **금지**(시험: effective_to 병합 false, 날짜 병합 true 로 대비 확인 `[확실]`). 독립 검토의 fail-open 시나리오(5월 incomplete·6월 failed·10월 complete → 옛 단일 워터마크는 6월을 커버됨으로 읽음)도 v2·v3 규칙에서 false. **테이블이 없으면(1146)** D3 소비자(`src/lib/ledger/`)는 예외를 올리지 않고 **모든 단계를 `coverage_gap`** 으로 다룬다(`store.ts` 의 `not_migrated` 패턴).

### 3.5 조회 창·연속조회·날짜 기준(M5)
- `tr_cont` `M`/`F` 면 `ctx_area_fk/nk` 로 다음 페이지(`tr_cont:'N'`). 페이지 상한 30(제안값). 상한 초과·중간 페이지 실패 → 받은 행은 저장, run `incomplete`, 다음 실행에서 창을 반으로 쪼개 재시도. `rt_cd≠0`·HTTP 오류·레이트리밋 소진 → `failed`, 행 0, 레이트리밋이면 그 실행 안 추가 재시도 금지(`isKisRateLimited` 규약).
- **날짜 기준:** 해외 조회 창이 현지 날짜 기준일 수 있다 `[추측]` → 해외는 `query_from = window_from − 1일`, `query_to = window_to + 1일` 로 보내고(CHECK `query ⊇ window`), 행의 `order_date` 는 `dmst_ord_dt`(KST)로 저장, 커버리지 주장은 `window_*` 로만 한다. `run.date_basis` 는 첫 라이브에서 `dmst_ord_dt`·`ord_dt` 를 비교해 확정하기 전까지 `unknown`.
- **창 설계:** D1a 일일 실행 = `[오늘−7일, 오늘]`(정정·늦은 체결·D+2 정산 겹침) / 주 1회 `[오늘−35일, 오늘]` / 백필(D1b)은 월 청크, 수동. 국내 체결 TTTC0081R 은 **85일** 창 안에서만(CHECK), 그 밖은 `CTSC9215R`.

### 3.6 호출량·스로틀(L-8 통일)
- `kisFetch(url, {headers}, { priority: 'bulk', timeoutMs: 20_000, label })` — 기존 토큰 버킷 공유, `bulk` 라 주문·시세 경로를 밀어내지 않음. 페이지 순차, 청크 사이 1초.
- **상한은 run 당 12**(초과 → `incomplete`). 하루 크론 1회는 (시장 2 × 종류 3) 최대 6 run → 이론 상한 72, 실제 **7~9 GET**/일(국내 체결 1 + 해외 체결 1~2 + 국내 기간손익 1 + 해외 기간손익 2~3 + 잔고 2).
- **백필(D1b, 2026-04~10 7개월):** 월 청크 7 × TR 4종(국내 체결·국내 기간손익·해외 체결·해외 기간손익) = 28 + 해외 기간손익이 첫 페이지부터 `M` 이라 청크마다 최소 1페이지 추가 = 7 → **최소 35**; 페이지가 3장이면 42. 그 밖에 잔고 2회, 4~7월 국내 체결용 `CTSC9215R` 4회는 별도(+6). 국내 체결 TTTC0081R 은 85일 한도라 7청크 중 약 3청크만 유효하고 나머지 청크는 **KIS 를 부르지 않고 run 행도 쓰지 않은 채 건너뛴다**(L-c — CHECK 가 85일 밖 창의 run 행을 `failed` 포함 전부 거부하므로 v3 의 "범위 밖으로 기록"은 성립하지 않았다; 건너뜀은 호출 로그에만 남기고 그 창은 `CTSC9215R` 로 따로 수집).

### 3.7 크론(M4·L-9) — `scripts/cron-runner.sh` 직접 확인 결과를 반영한 설계
- **백필은 크론 밖**: `POST /api/cron/broker-fills {from,to,market,kind,trigger:'backfill'}` 을 Leader 가 사용자 고지 뒤 수동 호출(cron-auth). 러너에는 넣지 않는다.
- **일일 수집 시각:** `HH=07 && MM>=20` + 날짜파일(하루 1회). 07:00 틱(`research-cycle-overseas`·`edgar-sync` 예산 100초)과 다른 틱에서 돌고, 08시 틱(`post-market-overseas` 120초 + `kis-fundamentals-snapshot`)보다 앞이며, 국내·미국 모두 폐장이고 USD 행이 보이는 시간대(T-074)다. `HH_MM="07:20"` 정확 일치는 틱이 분을 건너뛰면 그날을 놓치므로 쓰지 않는다(rs-update 선례의 약점).
- **시간 예산:** 러너 `CALL_MAX_TIME=90`(선례 `PMO_CURL_MAX_TIME`·`STOP_ALERT_CURL_MAX_TIME` 패턴) + 라우트 자체 예산 75초(넘기면 남은 조회를 `incomplete` 로 닫고 응답). 하트비트 정상 최악 = 90 + 매분 잡 약 30 + sleep 60 = 180 < 300초.
- **틱 충돌(L-9):** 러너가 07:20 이후 재기동되면 첫 틱에서 `edgar-sync`(100초)·`research-cycle-overseas`(**상한 없음** — 기존 위험, 이 설계가 고치지 않음)·수집이 겹쳐 300초를 넘길 수 있다. **완화(N-2 정정):** 수집 블록을 edgar·research 블록 **뒤**에 두되, 판단은 날짜파일을 다시 읽지 않고 **그 두 블록이 틱 시작에 읽어 둔 변수 `LAST_RESEARCH_OVS`·`LAST_EDGAR`**(`scripts/cron-runner.sh` 258·267행 — 호출 전 값, 같은 틱 안에서 바뀌지 않는다)로 한다: 둘 중 하나라도 `$TODAY` 가 아니면 이 틱에서 그 블록이 방금 돌았다는 뜻이므로 수집을 **다음 틱으로 미룬다**(`skipped:'yield_tick'`). v3 의 "날짜파일을 다시 읽어 판단"은 두 블록이 call 직후 파일을 `$TODAY` 로 써 두어 재기동 틱에서도 미루기가 발동하지 않았다(독립 재확인 시뮬레이션 `l9-sim.sh` 재현). 수집은 다음 틱(정상일 07:21~, 재기동일 재기동+1틱)에 실행된다. 그래도 HOME-SERVER 순찰이 재시작시키면: 행 단위 트랜잭션이라 데이터 손상 없음, `running` run 은 다음 실행의 single-flight 가 10분 뒤 `failed(stale_running)` 로 닫는다.
- **single-flight:** 프로세스 뮤텍스(order-sync 와 같은 패턴) + DB 에 `status='running'` 이고 `started_at` 이 10분 이내인 run 이 있으면 즉시 `skipped`.
- **끄는 스위치:** `system_config.broker_fills_cron_enabled`(기본 꺼짐 = 키 없음). 켜는 것은 사용자의 운영 설정. 백필 수동 호출은 스위치와 무관.
- **중단:** 같은 (시장·종류)에서 **연속 3회 `failed`** → 다음 자동 실행을 건너뛰고(`skipped:'halted'`) 알림 1회, 수동 실행이 성공하면 해제.
- 크론 등록(`cron-runner.sh`·`api/cron/`)은 SAFETY_PATHS → Reviewer 필수, 배포(push) 와 스위치 켜기는 사용자 승인.

### 3.8 첫 라이브 확인 목록(수집기는 그 전까지 fail-closed)
① 주문번호가 날짜를 넘어 재사용되는가(→ 키 충돌은 `duplicate_keys`/1062 로 드러남) ② 해외 기간손익이 같은 (날·종목)에 행을 둘 이상 주는가 ③ 해외 체결 조회 가능 기간 한도 ④ 해외 조회 날짜 기준(현지/KST) → `date_basis` 확정 ⑤ `CCLD_DVSN=00`·`CCLD_NCCS_DVSN=00` 으로 취소 행이 오는가 ⑥ 미니스탁 행의 `pdno`·소수 수량·`splt_buy_attr_name` 값 ⑦ `TTTS3039R` 연속조회 키 이름(캡처가 ctx 필드를 저장하지 않았다) ⑧ SOR 분할 체결 시 키 충돌 ⑨ 해외 매도 대금의 `frcr_dncl_amt_2` 반영 시점 ⑩ 실제 크론 틱 소요 시간 ⑪ 배당 입금을 돌려주는 TR 유무 ⑫ 양성 대조 (a)/(b) 가 실제 창에서 `confirmed` 로 닫히는 비율.

## 4. Q3 — 원가·실현손익

### 4.1 원가 방식: 이동평균(KIS 방식) 정본, LIFO 는 참고로
KIS 는 평균매입단가(`pchs_avg_pric`·`avg_unpr3`)로 보유 원가를 관리하고 기간손익의 원가 필드도 그 체계다 `[가능성 높음 — 필드 의미, 산식 미확인]`. 앱의 `computeLifoPnl`(LIFO)은 세무·브로커 어느 쪽과도 맞지 않는 임의 선택이라 교차검증이 구조적으로 실패한다. 권고: 순수 함수 `computeAvgCostPnl(baselineLots, fills)`(매수마다 `avg=(avg×qty + price×q + 매수수수료)/(qty+q)`, 매도마다 `realized=(sellPrice−avg)×q − 매도비용`)를 D2 에 두고 LIFO 는 D4 에서 참고 전용으로 내린다. 매수 수수료를 원가에 넣을지(`cost_includes_fee`)는 KIS `pchs_amt` 의 수수료 포함 여부에 달렸고 **미확인** → `unknown` 으로 시작, D2 에서 (KIS 원가 vs 체결대금 합) 차이로 판별.

### 4.2 수수료·세금(M8)
| 항목 | 원천 | 배분 규칙 | `fee_kind` |
|---|---|---|---|
| 해외 매수 수수료 | 없음(체결 조회에 수수료 없음) | 사용자 확정 요율 0.25% × 체결대금(T-067 §8.4) | `estimated`(수집기, `fee_kind IN ('unknown','estimated')` 일 때만 revision 마다 재계산) |
| 해외 매도 제비용 | 기간손익 `stck_sll_tlex`(종목·일별) | 그날 그 종목 매도 체결대금 비례 | `allocated`(D2) |
| 국내 수수료 | 기간손익 `fee`(일별 합산, **매수+매도 합**) | 그날 **전체** 체결대금(매수+매도) 비례 | `allocated` |
| 국내 제세금 | 기간손익 `tl_tax`(일별, **매도만**) | 그날 **매도** 체결대금 비례, 매수 행에는 쓰지 않음(CHECK `chk_bf_tax_sell`) | `tax_native` |
| 브로커 주문별 확정값 | 현재 TR 에 없음 | — | `actual`(자리만) |

### 4.3 원가 미상·이월(M1·M-C·L-7)
- **데이터 사실(F13):** 2026-04-26 첫 스냅샷에 보유 16행이 있고 앱 매수는 0건 → **과거 보유의 취득은 전부 앱 밖**이며 취득일·취득가는 KIS 가 주지 않는다. 그래서 질문 U-1 은 시스템이 답할 수 있어 삭제한다(답: 있다). D1a 는 이 사실에 영향받지 않는다(앞으로 수집은 10-25 이후만 다룬다).
- **원가 출처:** 해외 매도분은 기간손익 `pchs_avg_pric`(`cost_source='broker_avg'`), 보유 중인 것은 잔고 스냅샷 평균단가. 국내 종목별은 `불명`(일별 합산 TR 만 있다). **과거 수량 기준은 `portfolio_snapshots`**(04-26~, 시간당)로 잡는다 — 체결 원장이 없는 구간의 수량 변화 증거. 0 원가·전액 이익은 어떤 경로에도 없다.
- **잔고 TR 의 한계(M1):** 기준일 파라미터가 없어 **"수집 시작일 기준 잔고"는 조회할 수 없다.** D1a 첫 실행의 오늘 잔고가 `is_baseline=1` 스냅샷이 되고, 그날 이후 체결과 합쳐 "baseline + 누적 체결 = 오늘 잔고"를 매일 대사한다(불일치 = 수집 누락·앱 밖 거래 신호). **역산(보조):** 기준 이전 보유 수량은 (오늘 잔고 − 그 사이 체결)로 되짚을 수 있지만 **평균단가는 되짚을 수 없다**(그 사이 매수가 섞이면 비가역).
- **baseline 절단(L-7):** 잔고 TR 은 조회 시점까지의 당일 체결을 포함한다(국내 `thdt_buyqty/thdt_sll_qty`, 해외 `thdt_buy_ccld_qty1/thdt_sll_ccld_qty1` — `raw_json` 보존). 대사식: `(baseline.qty − 당일매수 + 당일매도) + Σ(order_date ≥ as_of 체결 ±qty) = (비교 스냅샷.qty − 그날 당일매수 + 당일매도)` — 양끝을 "그날 0시 수량"으로 맞추고 사이 체결을 **주문일** 기준으로 더한다. 첫 실행 7일 창의 `order_date < as_of` 행은 baseline 에 이미 반영돼 있어 더하지 않는다.

### 4.4 교차검증 규칙(D2)
| 시장 | 비교 단위 | 앱 값 | KIS 값 | 허용치(초기 제안값 → D2 실측 보정) | 결과 |
|---|---|---|---|---|---|
| 해외 | (매도일, 종목) | `computeAvgCostPnl` 실현손익(USD) | `realized_pnl_native` | **초기 `max($0.05, 매도대금×0.6%)`**(수수료 두 다리 0.5% + 반올림) — 0.1% 는 한 다리 0.25% 보다 작아 체계적 불일치가 난다 → 첫 달 실측 분포로 보정 | `match / mismatch / unknown / uncalibrated` |
| 해외 | (매도일, 종목) | 매도 수수료 `estimated` | `stck_sll_tlex` | `max($0.05, 5%)` | 확정값으로 `allocated` 교체 |
| 국내 | 거래일 | Σ 종목 실현손익(KRW) | `rlzt_pfls` | 초기 `max(10원, 매도대금×0.6%)` → 보정 | 일별만(종목별은 그레인상 불가) |
| 국내 | 거래일 | — | `fee`·`tl_tax` | — | 배분(§4.2) |
| 공통 | 보유 종목 | baseline + 누적 체결(§4.3 절단식) | 오늘 잔고 스냅샷 | 수량 1e-6, 단가 0.1% | `match` 가 아니면 **수집 누락 신호** |
| 공통 | 잔고 합계 | Σ행 | 요약(§3.4) | 국내 정확, 해외 상대 1e-3 | `sum_check` |

다를 때 어느 쪽도 덮어쓰지 않는다. 표시 정본은 KIS 값, 앱 값은 "재계산(참고)", 차이·후보 사유(원가 미상 lot·수수료 추정·소수 수량·환율·보정 전)를 리포트 행에 남긴다. 반복되면 사람이 본다(자동 보정 금지).

### 4.5 환차손익 분리(해외)
원통화 실현손익(USD)이 1차 숫자. 매도 환율(`exrt`, 확정)과 매수 환율(스냅샷 USD 행 `price` 근사 — `fx_source=app_snapshot`, 추정 라벨)이 **둘 다 있을 때만** `환율효과 = 원가(USD)×(매도환율−매수환율)`, `투자손익(KRW) = 실현손익(USD)×매도환율` 로 분리하고, 하나라도 없으면 `fx_unknown`. 환전 스프레드는 `cash_flow_ledger` 환전 행(T-074)에만 있고 거래마다 빼지 않는다(T-067 §8.4).

## 5. Q4 — 입출금·환전 설명 능력(핵심 가치)

### 5.1 지금 못 하는 것
`candidates.ts` 는 보유 수량이 바뀐 단계를 전부 건너뛴다(F5). **입금 + 같은 시간대 매수**, **출금 + 매도**는 후보 0건이 되고 WP-F 월 수익률은 그 상태에서 `ok` 를 낼 수 있다(A12 C2). **이 가치는 원장 기준일(2026-10-25) 이후 앞으로 수집(D1a)만으로 얻는다** — 백필은 필요 없다(M2).

### 5.2 알고리즘(D3, 순수 함수 `explainStepByFills`)
입력: 스냅샷 단계 `st(prev→cur)`, 그 계좌·시장의 `broker_fills`(`filled_qty>0`, `settle_state≠unknown`), 커버리지 합집합(§3.4), 창별 `positive_check`, 규칙 상수.
1. **커버리지(L-6):** 단계 `[prev.ts − L, cur.ts]`(L = 1일)가 합집합에 통째로 들어가지 않으면 `coverage_gap` — 후보도 "설명됨"도 만들지 않는다. 테이블이 없으면(1146) 전 단계 `coverage_gap`.
2. **보유 변화:** 종목별 `ΔQ = cur.holdings[s] − prev.holdings[s]`(없던 종목은 0 기준).
3. **체결 매칭:** 주문 시각이 `(prev.ts − L, cur.ts]` 인 미소비 체결을 종목·방향별로 모아 `Σ±filled_qty = ΔQ`(1e-6) 인 **최소 집합**을 찾는다. **체결 수 상한 8**/(종목·단계) — 넘으면 주문 시각 순 그리디로 한 번만 시도하고 실패 시 `unexplained_holdings_change`(지수 탐색 금지).
4. **설명되는 현금:** `expectedΔKRW = Σ(매도 fill_amount − fee − tax) − Σ(매수 fill_amount + fee)`(국내), `expectedΔUSD` 도 같은 식(해외, 원통화). `fee_kind=unknown` 이면 설명량에 0.25% 상한 폭을 허용치로 더한다.
5. **잔차:** `residual = Δcash − expectedΔcash`. `|residual| ≥ RULE(5만원 / $50)` 이고 환전 모양(`isExchangeLike`)·USD 왕복(`detectUsdFlips`)·원장 소비 키에 걸리지 않으면 **후보**(`CandidateView` 에 `explainedByFills`·`residual`·`matchedFillIds` 추가 — "매수 X 는 체결로 설명, 남은 Y 가 입출금 후보").
6. **ΔQ 를 체결로 설명하지 못하면**(수집 누락·분할·합병·권리락·미니스탁) — 그 단계가 **`positive_check='confirmed'` 창 안**이면 `unexplained_holdings_change`, 아니면 `coverage_unconfirmed`(M-B: 체결이 없다는 주장을 할 수 없는 창). 어느 쪽도 후보를 만들지 않되 상태로 드러낸다(fail-closed, M9).
7. 보유 불변 단계는 기존 규칙 그대로. 단 그 단계에 걸친 체결(지정가 다음 단계 체결)이 있으면 5단계를 함께 돈다.

### 5.3 기업행위·배당·휴일(M9)
- **분할·병합·권리락·합병:** ΔQ 가 체결 없이 바뀌므로 6단계 `unexplained_holdings_change` 로 fail-closed. 자동 보정 없음. 사용자가 "기업행위" 로 표시하면(후보 표시 마크의 새 사유) 그 단계는 설명 대상에서 제외하고 월 수익률에는 `corporate_action_marked` 를 남긴다.
- **배당·이자:** 보유 불변·현금 증가라 **입금 후보 오탐**이 된다. 임계값(5만원/$50) 아래면 울리지 않고, 위면 후보로 올라오되 사유 선택지에 `dividend_or_interest` 를 둔다(기존 '입출금 아님' 마크 확장). 그 마크는 **외부 흐름이 아니라 투자 수익**이므로 WP-F `flows` 에 넣지 않는다(수정 Dietz 에서 배당은 수익). KIS 기간손익에는 배당이 없고 배당 TR 유무는 미확인(§3.8 ⑪) → 자동 판별은 하지 않는다.
- **해외 휴일·반일장:** 체결 0 인 날은 정상이며 창 `complete` 와 무관(양성 대조 (b) 로 확정될 수 있다). 날짜 기준은 §3.5.

### 5.4 `ok` 희소화(M3) — v1 문구 철회
v1 의 "`ok` 는 좁아지는 쪽으로만 바뀐다"는 **성립하지 않는다.** 두 방향을 모두 적는다.
- **`ok` 를 늘릴 수 있는 경로(억제가 진짜 입출금을 지우는 경로):** ① 연속 두 단계 상쇄 — 단계 경계를 넘은 체결이 +X/−X 잔차를 만드는 것과, 실제로 X 입금 뒤 X 출금이 일어난 것은 모양이 같다. ② `settlement_lag` 소급 억제 — 며칠 뒤 USD 잔차가 어떤 매도 대금과 같다고 억제하면, 그 금액과 같은 실제 USD 입금을 숨길 수 있다. **규칙:** 억제는 **특정 체결 1건의 현금 효과와 정확 일치(허용치 초기값 해외 `max($0.05, 0.6%)`·국내 `max(10원, 0.6%)`, D2 보정)** 하고 **그 체결을 1회만 소비**할 때만 허용하며, 억제된 잔차는 `explained_by_lagged_fill(fill_id)` 로 표시해 침묵하지 않는다. 그래도 동액 우연은 남는다(정량화 대상).
- **`partial` 이 늘어 C05 가 사실상 돌지 않는 경로:** `coverage_gap`(수집 실패·창 밖)·`coverage_unconfirmed`(양성 대조 미확정)·`unexplained_holdings_change`(기업행위·미니스탁·수집 누락)·`settlement_lag` 대기·`fill_coverage_incomplete` 가 한 달에 하나라도 있으면 `partial` → "월 −5% 판정은 `ok` 만" 정책(C05)에서는 **그 달 판정이 없다.** 일봉 매매가 매일 있고 기업행위가 분기마다 있는 계좌에서는 대부분의 달이 `partial` 일 수 있다 `[가능성 높음]`.
- **연결 조건:** D3 는 먼저 **관측 전용**으로 돈다 — D1a 수집 1~2개월 동안 달별 `ok/partial/unknown` 건수와 사유 분포, 억제 규칙이 지운 잔차 건수·금액, `positive_check` 확정 비율을 집계해 사용자에게 보고하고, WP-F C3(이월만 있는 `partial` 허용 여부·`cautionCodes` 화이트리스트)과 **함께** 정책을 정한 뒤에만 월 −5% 판정에 연결한다(U-6).

## 6. Q5 — DDL 안전성

| 항목 | 결정 | 근거 |
|---|---|---|
| ADD COLUMN vs 새 테이블 | **새 테이블만**(5개) | 기존 테이블 락·리빌드 0, 구 코드 호환 100%, 코드 롤백 영향 0 |
| 멱등 | `CREATE TABLE IF NOT EXISTS` ×5, 순서 runs → fills → revisions/realized_pnl/position_snapshots(FK) | 시험 A2·A3(2회 적용 오류 0, 경고 "이미 있음" 5건만) |
| STRICT | 금액 DECIMAL, NOT NULL 은 "항상 아는 값"에만 | 시험 거부 확인 |
| 날짜 | 모든 DATE 열 `BETWEEN '2000-01-01' AND '2100-12-31'` CHECK | 운영 sql_mode 에 NO_ZERO_DATE 없음(F2) → `'0000-00-00'` 거부 확인 |
| 통화·`tr_cont` | `CHAR(3) COLLATE utf8mb4_bin` + CHECK, `last_tr_cont CHAR(1) COLLATE utf8mb4_bin` | general_ci 에서 `'usd'`·`'d'` 가 통과하던 것을 거부. `broker_order_no` 는 `orders.exchange_order_id`(general_ci)와 조인하므로 테이블 기본 콜레이션 유지 + 앱 trim·형식 검증 |
| NULL 함정 | CHECK 의 모든 분기에 `IS NULL/IS NOT NULL` 명시 | `last_tr_cont IN ('D','E')` 만 두면 NULL 이 통과했다(v2 시험 R2 에서 재현 → `IS NOT NULL` 추가 후 거부). T-074 QA 의 `chk_cfl_exch` 와 같은 함정 |
| ENUM vs VARCHAR+CHECK | 앱 소유 상태 = ENUM, 브로커 코드 = VARCHAR 원문·CHECK 없음, **`source_tr` 는 앱이 고르는 값이라 짝 CHECK 대상**(패턴 `_TTC…`/`_TTS…` 로 실전·모의 둘 다) | §2 원칙 |
| `complete`·짝 CHECK(L-1·N-1·L-3) | `chk_bfr_complete`(`pages·kis_calls ≥ 1` 포함, **`last_tr_cont` 분기: 연속 TR 은 D/E 필수·잔고 스냅샷은 NULL 허용**)·`chk_bfr_finished`·`chk_bfr_kind_tr`·`chk_bfr_market_tr`·`chk_bfr_sum_unav`(해외 체결 창만)·`chk_bfr_3m_tr`(**85일**)·`chk_bfr_snapshot`·`query ⊇ window` | 재검토 B1~B7 전부 수용되던 것 → v3 시험 16건 거부. v3.1: 해외 잔고 빈 헤더가 complete 불가였던 것(N-1) 수용으로, 92→85 경계 재시험 §9-A `[확실]` |
| `positive_check`(M-B) | ENUM + `chk_bfr_positive`(스냅샷 ⇔ n/a, confirmed ⇒ complete) | 부재 주장 제한을 DB 가 기억한다(시험 4건 거부) |
| 생성열 | `effective_to` PERSISTENT — 앱이 틀리게 쓸 수 없다, 명시 값 삽입은 거부 | 시험 A5·재검토 R13 |
| 파생열 무효화 | `derived_for_revision` + CHECK 2개 | H-2 ②(시험) |
| 인덱스 | 자연키 UNIQUE ×3, (시장·종목·주문일), (주문일·주문시각), `app_order_id`, `(derived_for_revision, revision)`, runs 커버리지 인덱스 | 소비 쿼리 4종 |
| 외래키 | `accounts`·`broker_fill_runs`·`broker_fills`(revisions)에만. `orders`·`portfolio_snapshots` 에는 없음 | 수명·정리 정책 분리(T-074 와 같음). DROP 순서 위반은 1451 로 막힘 |
| 롤백 | 초안 끝 `DROP TABLE IF EXISTS` 5줄(FK 역순), system_config 키 없음 | 시험(2회)·재적용 |
| 적용 순서 | **격리 DB 시험 → Reviewer → 사용자 승인 → 오프아워 적용 → 코드 배포**(T-071 R-12) | 순서가 바뀌면 수집기가 매 회차 실패한다 |
| 운영=개발 DB | `--with-migrate` 금지, 사람이 `mysql < …` 적용, 적용 전 `SHOW TABLES LIKE 'broker_%'` 부재 확인 | `docs/deploy-order.md`·T-074 절차 |
| 부팅 DDL 금지 | `setupDB` 에 넣지 않는다 | 배포 = DDL 방지. 앱 계정 ALL PRIVILEGES 라 DB 가 막아 주지 않는다 `[확실]` — 전용 DDL 계정 분리는 범위 밖 제안 |
| 용량 | 행 수백~수천, `raw_json` 약 700바이트/행 → 연 1MB 미만(독립 검토 실측) | — |

## 7. Q6 — 소비자와 연결 순서 (단계 분해, M2·M6·M10·M-B 반영)

| 단계 | 내용 | 얻는 가치 | 선행 조건 | 파일(소유) | 안전 경로/Reviewer | 필요한 권한 |
|---|---|---|---|---|---|---|
| **D0 (별도 소형 작업 제안 — WP-D 범위 밖)** | `computeLifoPnl` 의 0원가 가드: 재고를 넘는 매도 수량은 `unknownCostQty` 로 분리해 손익에서 **제외**하고 리포트에 "원가 미상 N주 제외" 표시. `amount_krw` 폴백으로 전액 이익이 되는 경로와 부분 재고 과소 계상을 같이 닫는다(약 30줄 + 시험) | 사용자가 보는 F02 오류를 **가장 먼저** 고친다 | 없음 | `src/lib/reports/trade-report.ts` | 훅 밖 — Reviewer 자발 요구 | 없음 |
| **D1a DDL + 앞으로 수집** | `scripts/migrations/T-081-wpd-broker-fills.sql`(초안 승격) · 어댑터 4함수 `kis-domestic.{getDailyOrderFills,getPeriodProfit}`·`kis-overseas.{getDailyOrderFills,getPeriodProfit}`(전 종목·연속조회·`bulk`·합계 대조·`tr_cont` 반환) + 잔고 스냅샷 추출 · `secret-box.ts` `fingerprintSecret()` · `src/lib/broker-ledger/{collector,normalize,hash,coverage}.ts`(FOR UPDATE 트랜잭션·1213/1205 재시도·단조 가드·fee 소유·메모리 중복 검사; 수집기는 `positive_check` 를 `pending`/`n/a` 로만 쓴다 — 판정은 D2 소유, L-e) · `src/app/api/cron/broker-fills/route.ts`(cron-auth·예산 75초·single-flight·스위치·run 당 12·연속 실패 3회) · `cron-runner.sh` `HH=07&&MM>=20` + edgar·research 뒤 `yield_tick` | **핵심 가치의 전부**: 2026-10-25 이후 체결·기간손익·오늘 잔고가 쌓여 D2·D3 입력이 된다 | 격리 DB 시험 → Reviewer → DDL 승인·적용 | T-081 소유 범위에 `src/lib/broker-ledger/`(신규)·`src/lib/auth/secret-box.ts`(1함수) 추가 | **YES**(`exchanges/`·`auth/`·`api/cron/`·`cron-runner.sh`·`migrations/`) + `broker-ledger/` 는 **훅 밖**(U-5) → Reviewer scope 명시·Judge C2 | DDL 승인 · 크론 등록·스위치 = 운영 설정 · KIS 읽기(기승인, 일일 7~9 GET) · **운영 DB 쓰기 = 새 테이블만**(첫 실행 전 확인) · 서버에 `CREDENTIALS_ENCRYPTION_KEY` 존재(없으면 수집기 미실행) |
| **D1b 백필(수동)** | 4~10월 월 청크, 국내 체결은 3개월 한도(그 밖은 `CTSC9215R` 어댑터 추가) | 10월 취득 보유 3종목의 **원가 복구**(해외 체결 3개월 안 `[가능성 높음]`), 4월~ 실현손익 역사, 역산 범위 확대 | D1a 안정 + 사용자 U-4 동의 | 같은 파일 + `kis-domestic.ts`(CTSC9215R) | YES | KIS 읽기 **35~42 GET**(고지) |
| **D2 교차검증 리포트** | `broker-ledger/{reconcile,positive-check}.ts`(이동평균·KIS 대조·배분·대사 `linked/conflict`·허용치 보정 통계·**양성 대조 산출 — `positive-check.ts` 의 소유자는 D2 하나다(L-e), `confirmed`/`unconfirmed` 는 여기서만 쓴다**) + 읽기 전용 출력. `fee_kind=allocated`·`derived_for_revision` 갱신은 D2 후반 | 수수료·세금 확정, 원가 미상 식별, 허용치 보정, 부재 주장 가능 창 확정 | D1a 첫 `complete` 창 | `src/lib/broker-ledger/`·`scripts/broker-ledger/` | 훅 밖(U-5 전까지) — Reviewer 요구 | 새 테이블 쓰기만 |
| **D3 후보 설명 연결(관측 전용 → 연결)** | `ledger/candidates.ts` 에 `explainStepByFills` 입력, `service.ts` 에서 fills·커버리지·`positive_check` 조회, 테이블 부재 → `coverage_gap`, `CandidateView` 확장, 월별 `ok/partial` 분포 집계 | 사각지대 해소. **WP-F 월 −5% 판정 연결은 U-6 결정 뒤** | D2 보유 대사 `match`, A12 C1·C3·C4 | `src/lib/ledger/` | 훅 밖 — Reviewer 요구 | 정책 결정 U-6 |
| D4 | `trade-report.ts` 브로커 원장 기준 전환(이동평균·원통화 분리·원가 미상 `불명`), 보유 원가·실현손익 표시(S06/S07 — **designer 데모 게이트**), `executions` 확장(T-071 WP-2 잔여, 앱 주문 재개 전) | 표시 | D2 안정 | `reports/`·화면·`db.ts`/`migrations/` | 부분 YES | DDL(`executions`) 별도 승인 |
| WP-E(별도) | `#2107` 정리 — D1a `complete` 만으로는 부족: 해당 창 `positive_check='confirmed'` 가 생긴 뒤에만 "브로커 원장에 없음"을 정리 근거로 쓴다. 그 전에는 S00 §2.8 의 KIS 미체결 0건 관측과 사용자 확인으로만(별도 승인) | — | D2 양성 대조 | — | — | DB 쓰기 승인 |

- D1a·D2 는 `exchanges/`·`auth/` 를 건드리므로 T-080(`kill-switch.ts`)·T-082(`profit-engine/`)와 파일이 겹치지 않는다.
- **M6:** 수집기·대사 코드(`src/lib/broker-ledger/`)는 안전 판단(원가·실현손익·월 수익률 `ok`)의 입력을 만든다. SAFETY_PATHS 밖이면 D1a 를 쪼개 커밋할 때 본체가 훅 없이 들어간다 → **권고: `^src/lib/broker-ledger/` 추가(U-5)**. 훅 파일(`scripts/git-hooks/commit-msg`) 변경은 그 자체가 SAFETY_PATHS 라 별도 작업·Reviewer 다. 결정 전까지는 Leader 가 Reviewer 소환을 수동 보장하고 판정 scope 에 경로를 명시한다(T-071 R-11 과 같은 운용).

## 8. Q7 — 사용자 결정 (각각 권고 답 포함)

| ID | 질문 | 권고 답 | 근거 |
|---|---|---|---|
| ~~U-1~~ | **삭제.** "2026-04-26 이전부터 보유한 종목이 있었는가"는 운영 DB 가 답한다 — **있다**(첫 스냅샷 보유 16행, 앱 매수 0건 `[확실]`). 과거 보유의 원가는 해외 기간손익 `pchs_avg_pric`·잔고 평균단가로, 수량 기준은 `portfolio_snapshots` 로 잡는다. D1a 영향 없음 | — | F13 |
| ~~U-2~~ | 삭제(미니스탁 포함은 AI 결정, `splt_buy_attr_name` 원문 보존) | — | §2.3 |
| U-3 | 수수료·세금 "확정"의 기준을 KIS 기간손익 값(일별 fee·tax, 해외 매도 제비용)으로 봐도 되는지 | **예** | 다른 원천(월간 거래명세)은 TR 로 받을 수 없다. 명세서가 정본이어야 하면 그때 `actual` 로 덮어쓴다(자리 있음) |
| U-4 | ① 백필 KIS 읽기 **최소 35~42 GET**(§3.6 근거, 주문 0) 승인 ② 일일 수집 크론 등록(`HH=07&&MM>=20`, `--max-time 90`, edgar·research 뒤 `yield_tick`)과 스위치 `broker_fills_cron_enabled` 켜기(운영 설정) | ① 예(D1b 착수 시) ② 예(D1a 배포 뒤) | 기승인 "KIS 읽기" 범위이나 호출량이 커서 고지. 크론·스위치는 운영 설정 |
| U-5 | 커밋 훅 SAFETY_PATHS 에 `^src/lib/broker-ledger/` 를 추가할지 | **추가** | 수집기·대사 코드가 원가·실현손익·월 수익률 `ok` 의 입력을 만든다 — 안전 판단에 쓰이는 코드다. 훅 변경은 별도 작업 |
| U-6 | `ok` 희소화 정책 — WP-F C3(이월만 있는 `partial` 허용 여부·`cautionCodes` 화이트리스트)과 함께: ⓐ `ok` 만(C05 현행, 판정이 드묾) ⓑ 정보성 코드 화이트리스트가 붙은 `partial` 허용 ⓒ 단계형 | **정량화 전까지 미연결 + D3 관측 전용 1~2개월 뒤 ⓑ 검토** | §5.4 — 억제가 `ok` 를 늘리는 경로와 `partial` 폭증 경로를 수치로 본 뒤 정해야 한다 |
| (별도) | DDL 적용 승인 | Reviewer 검토 뒤 스크립트로 요청 | "준비 허용"의 다음 단계 |

**AI 가 정하는 것(근거는 본문):** 테이블 이름·열·자연키·ENUM·CHECK, 이동평균 원가·LIFO 참고화, 허용치 초기값과 보정 절차, 페이지 상한 30, `bulk` 우선순위, 창 7일/35일, 민감 필드 제거 목록, 하향 금지 규칙, **미니스탁 포함**, 체결 수 상한 8, 크론 시각·예산·single-flight·연속 실패 3회·`yield_tick`, 계좌 지문 HMAC 파생 라벨, 재시도 2회, 85일 경계(v3.1), 양성 대조 규칙 (a)/(b)와 출처 구분, `yield_tick` 의 `LAST_*` 변수 기준, revisions 유지.

## 9. Q8 — 검증 계획과 실행 결과

**A. 일회용 MariaDB(로컬 `mariadb:10.11` 이미지 → 서버 10.11.19, `127.0.0.1:33085`, 운영 `sql_mode`, `--character-set-server=utf8mb3 --collation-server=utf8mb3_general_ci`, 끝나면 제거) — v3 초안으로 실행함 `[확실]`**
1. 적용 전 1146 / 2회 적용 오류 0(2회차 경고 "이미 있음" 5건만) / FK 부모 먼저 DROP → 1451 / 되돌리기 5줄 2회 오류 0·테이블 0 / 재적용 오류 0 / CHECK 42개 / 테이블 5개 utf8mb4_general_ci·`currency`·`last_tr_cont` utf8mb4_bin / 생성열 `effective_to` 두 경우(실행이 창 뒤 → 창 24:00, 창 안 → started_at) — **통과**.
2. CHECK·UNIQUE 43건 전부 기대대로 — **L-1 거부 16건**(국내 창 `unavailable` 2종·kind↔TR 2종·market↔TR 2종·3개월 TR 의 7개월 창·93일 경계·`pages=0`/`kis_calls=0` complete·`finished<started`·running+finished·스냅샷 3일 창·query≠window·스냅샷에 체결 TR), 92일 경계 수용, **M-B 4건**(스냅샷 pending·fills n/a·incomplete/failed 에 confirmed) 거부, v2 회귀 10건(`last_tr_cont NULL`·`mismatch`·`duplicate_keys`·`'0000-00-00'`·지문 길이·`'usd'`·D2 파생 표지·매수 행 세금 등), 유효 행 12종(각 kind·market·TR 조합, confirmed/unconfirmed/running/failed) 수용. (v2 시험에서 `last_tr_cont IS NULL` 이 통과하던 것은 `IS NOT NULL` 추가로 닫혔다.)
2b. **v3.1 재시험(N-1·L-3 반영 초안, 같은 컨테이너 사양):** 2회 적용 멱등(오류 0)·부모 먼저 DROP 1451·되돌리기 2회·재적용 0·생성열 2경우 그대로. **CHECK 개수 42 → 42**(변동 없음 — `chk_bfr_complete` 는 분기만 바뀌고 `chk_bfr_3m_tr` 는 값만 92→85; runs 테이블 12개). 독립 재확인의 사례 목록을 그대로 재생 + N-1 사례: **56/56 기대대로(수용 25 · 거부 31)** — 해외 잔고 CTRP6504R **빈 헤더(NULL) + `sum_check=match` 수용**(N8b, v3 에서는 거부되던 것), 국내 잔고 빈 헤더 수용, 해외 잔고 `'M'`·소문자 `'d'`·빈 헤더+`mismatch` **거부**, 국내 체결·해외 체결·해외 기간손익의 빈 헤더 **거부 유지**, `_TTC0081R` **85일 경계(2026-08-02) 수용·86일(08-01) 거부**, 85일 밖 `failed` 행도 거부(→ L-c "건너뜀"), 그 밖의 정상 사례(각 kind·market·TR·모의 TR·failed/incomplete/running·`±1일` 청크·confirmed)와 거부 사례(짝 CHECK·`positive_check`·`pages/kis_calls`·`finished<started`·스냅샷 창) 전부 v3 결과와 동일. 스크립트 `wpd/t31-checks.cjs`.
3. **M-A 교착:** 2연결×25회 재시도 없음 → `inserted 25 · ER_LOCK_DEADLOCK 25`(매회 한쪽 교착) / 6연결×25회 → `inserted 25 · 교착 103 · unchanged 22` / 재시도(최대 2) → 2연결 `inserted 25 · unchanged 25`, 6연결 `inserted 25 · unchanged 125`(전부 수렴, 키마다 행 1) — **통과**.
4. **L-4:** 닫힌 행에 같은 수량 낡은 `open` → `stale_skipped`·`closed` 유지·revision 1 / 정정 신호 동반 `open` → `updated`·revision 2. **L-5:** D2 `allocated 0.5` 위로 수집기 revision → `allocated`·0.5 보존·revision 2(`derived_for_revision` 낡음) / `estimated` 상태면 재계산. **L-2:** 10-25 22~23시 단계 — `effective_to` 병합 false, 날짜 인접 병합 true(재검토 재현 대비), DDL 단일 창 질의 false — **통과**.
5. v2 결과 유지: 순차 5단계 계약(삽입→동일→진행→낡은 수량 skip→취소 코드), D2 파생 표지 낡음 감지, `raw_hash` 먼저 대입 → 변경 유실(변이 재현), 메모리 중복 검사(3행→1키 중복), 커버리지 합집합 4경우(옛 단일 워터마크 "6월 커버됨" → false 등). 스크립트: 스크래치패드 `wpd/t-lib.cjs`·`t-apply.cjs`·`t-checks.cjs`·`t-upsert.cjs`·`t3-checks.cjs`·`t3-contract.cjs`.

**B. 구현 단계 시험(D1a Developer 가 추가할 것 — 이번에 실행하지 않음)**
6. KIS 합성 픽스처(필드 이름은 캡처와 동일, 값 합성): 국내 체결 2행·해외 체결(거래소 2종) 3행·국내 기간손익 일별 3행·해외 기간손익 2페이지(`M`→`N`→`D`) → 정규화·해시·심볼 매핑(NASD→`NAS:`)·KST 주문시각·민감 필드 제거·**합계 대조(일치/불일치, 해외 잔고 상대 1e-3)** 확인.
7. `tr_cont=M` 상한 초과 → 행 저장 + `incomplete`; 2페이지째 HTTP 500 → `incomplete`; 빈 `tr_cont` 헤더 → `incomplete`(complete 금지); `rt_cd≠0` → `failed`·행 0; 레이트리밋 → 추가 재시도 없이 `failed`; 합계 불일치 → `incomplete`; 호출 0 회 → `complete` 불가.
8. 재수집 멱등(같은 픽스처 2회 → 행 수 불변), 부분체결 진행·낡은 응답 skip(수량·`closed→open`)·취소 확정, **응답 안 자연키 중복(체결 쪽 픽스처)** → `duplicate_keys`, 계좌 지문 변경 → `failed(account_changed)`·쓰기 0, 지문 키 없음 → 미실행.
9. **재시도 경로:** 1213 주입 → 재시도 1회 뒤 성공, 3회 연속 → 행 건너뜀·`incomplete`·`run.error` 메모.
10. **양성 대조:** 구형 TR 빈 응답 픽스처 → `complete` 이지만 `positive_check='unconfirmed'`(기간손익 매도 수량과 불일치) / 거래 0 창 픽스처(두 TR 행 0 + 양끝 스냅샷 동일) → `confirmed` / 매수만 있는 창 → 보유 대사 보조 확정.
11. 크론 라우트: 예산 75초 초과 중단·single-flight(running 10분)·스위치 꺼짐 → `skipped`·run 당 호출 12·연속 실패 3회 → `halted`·edgar/research 날짜파일이 오늘이 아니면 `yield_tick`.

**C. 교차검증·설명(D2·D3 순수 함수)**
12. baseline 1 lot + 매수 2 + 매도 1 → 이동평균 실현손익 = 합성 KIS 값 `match`; 허용치 밖 → `mismatch`·덮어쓰기 없음; lot 없는 매도 → 해외 `broker_avg`, 국내 `unknown`(결과에 0 이 나오면 실패). 국내 `fee` 를 매수+매도 전체 대금 비례·`tl_tax` 를 매도만 비례로 배분하는 시험. **L-7 절단식**(당일 체결 포함 baseline) 보유 대사.
13. 수수료 `estimated` → `allocated` 교체, `actual`/`allocated` 행에 수집기가 `estimated` 쓰기 거부, 체결 진행 뒤 `derived_for_revision ≠ revision` 재계산.
14. 입출금 설명: "입금 + 같은 단계 매수" → 현재 `detectCandidates` 0건(재현) → `explainStepByFills` 후 잔차 후보 1건 = 입금액; "출금 + 매도" 대칭; 창 밖 → `coverage_gap`; **테이블 부재(1146) → 전 단계 `coverage_gap`·예외 없음**; ΔQ 미설명(분할 픽스처) → `confirmed` 창이면 `unexplained_holdings_change`, 아니면 `coverage_unconfirmed`; 체결 9건 → 상한 8 그리디 경로; 억제 정확 일치 조건(동액 입금 픽스처는 억제되지 않아야 함, 체결 1회 소비).
15. WP-F 연결 가드: `partial` 신호가 들어가면 `ok` 를 내지 않음(A12 C2 회귀) + 관측 전용 집계(달별 상태·사유 분포·`positive_check` 비율).

**D. 변이 후보(각각 적용 → 해당 시험 실패 → 원복 sha256 확인)**
`uq_bf_natural` 제거 → 중복 시험 실패 / **`raw_hash` 대입을 앞으로** → 변경 유실 시험 실패(재현됨) / `FOR UPDATE` 제거 → 동시 upsert 1062 / **1213 재시도 제거** → 2연결 교착 시험 실패 / 수량 단조 가드 제거 → stale 5→3 적용됨 / **`closed→open` 단방향 제거** → L-4 실패 / **`fee_*` 를 수집기 UPDATE 목록에 넣음** → L-5 실패 / 메모리 중복 검사 제거 → `duplicate_keys` 0 인 채 조용히 개정 / `complete` 판정에서 합계 대조·`tr_cont` 명시·`pages≥1` 제거 → 7 실패 / **`positive_check` 조건 제거** → 10 실패(빈 응답이 부재 근거가 됨) / 커버리지를 `MAX(window_to)` 로 → 옛 규칙 재현 / **날짜 인접 병합으로 되돌림** → L-2 실패 / `effective_to` 를 24:00 고정 → 같은 날 실행 뒤 단계가 커버됨으로 / 커버리지 구간에서 `−L` 제거 → 경계 체결 시험 실패 / **85일 CHECK 제거** → L1g·N4b 실패 / 스냅샷 분기에서 `IS NULL` 허용을 체결 창까지 넓힘 → X21·X21b·X21c 실패 / (a) 의 "매도 합 ≠ 0" 조건 제거 → 거래 0 창이 (a) 로 확정되는 시험 실패 / `derived_for_revision` 비교 제거 → 13 실패 / 허용치 10배 → 12 `mismatch` 시험 실패 / 민감 필드 제거 목록 비움 → 6 실패 / `symbol NOT NULL DEFAULT ''` 를 NULL 허용으로 → 일별 중복 시험 실패 / 억제 규칙에서 정확 일치 제거 → 14 동액 입금 시험 실패.

**E. 운영 첫 실행(사용자 승인 뒤) 관측 항목:** 모든 run `complete`·`positive_check` 분포, `duplicate_keys` 0, `sum_check` 분포(해외 잔고 상대차), `date_basis` 확정, 보유 대사 `match`, 19건 앱 주문 `linked`, `#2107` 부재(confirmed 창에서만), 해외 기간손익 페이지 수, 미니스탁 행 모양, 재시도 발생 건수, `yield_tick` 횟수, 틱 소요 시간 — §3.8 목록을 닫는 증거.

## 10. 위험·한계·확인하지 못한 것

- **[확인 못 함 — §3.8 과 같다]** 해외 체결 조회 기간 한도 · 해외 조회 날짜 기준 · 주문번호 날짜 간 재사용 · 해외 기간손익 (날·종목) 유일성 · `pchs_amt` 수수료 포함 · 해외 매도 대금 반영 시점 · `CCLD_DVSN=00` 취소 행 · `TTTS3039R` 연속조회 키 · `CTSC9215R`·국내 종목별 손익 TR(`TTTC8715R` `[추측]`) · 배당 TR · `splt_buy_attr_name` 값 · 실제 크론 틱 소요 · 양성 대조 확정 비율. 수집기는 그 전까지 fail-closed(`incomplete`·`unknown`·`coverage_gap`·`coverage_unconfirmed`).
- **[한계]** KIS 체결 조회가 주문 단위라 같은 주문의 체결 건별 가격 분포는 영원히 모른다(브로커 원가도 같은 평균이라 교차검증에는 문제없다). 국내 종목별 실현손익은 일별 합산 TR 로는 검증할 수 없다. **양성 대조는 조용한 누락을 완전히 배제하지 못한다**(세 원천이 같은 파라미터 오류를 공유하면 통과; 거래 0 창은 (b) 로만 확정). 계좌 지문은 익명화가 아니다(키 보유자는 대조 가능). HMAC 키(`CREDENTIALS_ENCRYPTION_KEY`)가 없는 환경에서는 수집기가 아예 돌지 않고, 키 교체·개발/운영 키 차이는 `account_changed` 중단으로 나타나 재설정 절차(§2.3 L-d)가 필요하다(의도된 fail-closed). 양성 대조 (b) 를 `portfolio_snapshots` 로 하는 백필·#2107 창은 소수 보유·당일 절단이 빠진 보조 확정이다. `research-cycle-overseas` 의 상한 없음은 기존 위험이며 이 설계가 고치지 않는다. 이번 일회용 DB 시험은 **DDL·쓰기 계약·교착/재시도·커버리지 질의**만 검증했고 KIS 어댑터·수집기·설명 함수 코드는 아직 없다(§9-B·C 는 구현 단계 시험).
- **[위험]** 설명 알고리즘은 주문 시각 근사·결제 지연·미니스탁·기업행위 때문에 완전하지 않고, 억제 규칙은 동액 우연을 완전히 배제하지 못한다(§5.4). `ok` 의 의미 변화는 정량화 전까지 월 −5% 판정에 연결하지 않는다. 앱 DB 계정이 ALL PRIVILEGES 라 부팅 코드의 DDL 을 DB 가 막지 못한다(이 설계는 `setupDB` 를 건드리지 않음). `src/lib/broker-ledger/` 는 U-5 결정 전까지 Leader 의 Reviewer 소환 수동 보장에 의존한다.
- **[하지 않은 것]** 소스·시험·기존 설계 문서 수정, git 조작, 운영 DB 쓰기·DDL, KIS·텔레그램 호출, 킬스위치 변경(true 유지), `.env` 열람(프로세스 환경으로만 로드). 운영 DB 는 M-C 확인을 위해 읽기 전용(`tx_read_only=1`)으로 건수·형식만 조회했다. 일회용 컨테이너는 시험 뒤 제거(T-081 기록에 확인).

---
task_id: T-057
title: 미국 종목 분석·데이터 수집 체계 설계 — StockInvest 의 주력을 미국주식으로 (분석가 에이전트 범위 확장)
status: design-approved
priority: high
roles_involved: [leader, analyst]
related_tasks: [T-055, T-056, T-053, T-046]
tags:
  - type/task
  - domain/strategy
  - domain/data
  - domain/adoption
aliases:
  - 미국주식 분석 체계
  - US 데이터 수집
  - ADP-006-C01 연계
created: 2026-10-20
updated: 2026-10-21
---

# T-057 — 미국 종목 분석·데이터 수집 체계 설계

> **이 문서는 코드를 쓰기 전에 사용자 승인을 받기 위한 설계 task다.** 앱 소스·운영 DB·설정은 바꾸지 않는다. 구현은 설계 승인 뒤 별도 task 로 나눈다.

## 사용자 지시 (2026-10-20 밤, 원문)

> "분석가 에이전트가 분석하는 범위가 현재의 국내주식에 제한되는 것이 아니라 미국주식도 적용되어야해. 오히려 지금의 투자하는 범위는 미국주식이기때문에 오히려 지금 프로젝트의 메인 처리의 방향성은 미국주식이 되어야해. 그렇다면 종목에 대한 분석이나 데이터수집을 미국기업과 종목도 분석할 수 있도록 해줘"

## 배경

- 2026-08-02 사용자 확정 결정 #1 "해외주식 보류(코드 보존·비활성, 국내 루프 완성 후 재개)"(`agent-vault/00-Context/ACTIVE.md`)는 **이 지시로 대체된다.** 결정 #2 "장중 AI 제거(장중은 결정론적 룰, AI 는 post-market 배치에만)"는 유지.
- 현실은 이미 해외가 돌고 있다: 해외 종목 전략 평가가 매 틱 돌고 시그널이 생성된다(최근 NAS:INTC·NAS:SNDK 카드). 보유 종목도 MU·ORCL·SMH 등 미국이 대부분이다.
- `src/lib/strategy/post-market-engine.ts` 에 `PostMarketMarket = 'domestic' | 'overseas'` 와 해외 분기(`loadSymbols`)가 있지만 카드 INSERT(약 170행)·수량 계산(약 70행)·캔들(`kis-domestic`)이 국내로 고정돼 있다 — 분석가가 확인할 것.
- ADP-006(Anthropic financial-services 이식) D-01 은 국내 표본·웹 검색 금지(L0)를 전제했다. 이 지시로 [D-02](../../../../adoption/ADP-006-anthropic-financial-services/20-결정.md)가 G2 를 미국 기업 공개 정보 수집에 한해 완화하고 C01 을 재설계 대기로 둔다.
- 알려진 한계: `/api/fundamentals` 의 `stock_fundamentals` 는 LLM 기억값(`data_source: 'claude_ai'`)이라 관측값이 아니다. 뉴스 RAG(M4)는 한국어 헤드라인 수준. `src/lib/research/` 는 사용자가 "LLM 없이 순수 통계"로 확정한 모듈. 컨센서스·실적 일정·재무제표 원천은 없다.

## 범위

- **설계만.** 현황 조사(읽기), 데이터 요구 정의, 소스 후보 평가, 단계별 아키텍처, ADP-006-C01 재설계안, 사용자 결정 항목.
- **하지 않는 것**: 코드·DB·설정 변경, KIS 호출, 운영 DB 쓰기, 보유 수량·평단·손익 등 사용자 데이터를 외부(웹 질의 포함)로 보내는 일, 매매 경로 변경.

## Analyst 요청 사항

1. **현황 조사(코드)**: 해외 시세·캔들·잔고 어댑터, 해외 유니버스, 해외 전략 평가·시그널 경로, post-market 해외 분기와 국내 고정 지점, fundamentals·RAG·market-context·research 모듈의 해외 적용 가능성, 장 시간·휴장·환율·통화(T-056 연계)·한도 처리, 분석가 정의. 실제 본 파일·줄 번호만 적는다.
2. **데이터 요구 정의**: 미국 종목 분석에 필요한 데이터 범주(시세·일봉, 실적 일정·컨센서스·서프라이즈 이력, 분기 재무, 공시 8-K·10-Q·10-K, 실적 콜 전사록, 뉴스·촉매, 비교 기업 지표, 매크로 등)별 중요도와 현재 보유 여부.
3. **소스 후보 평가표**: SEC EDGAR(공식·무료), KIS 해외 API 가 제공하는 종목 정보, 웹 검색(분석가 도구), 회사 IR 페이지, 무료 티어 API(예: Alpha Vantage·Finnhub·FMP 류), 유료/MCP(S&P·FactSet·LSEG·Polygon 류). 각각 제공 데이터·인증·요금·속도 제한·**상업 이용 약관(StockInvest 는 수익화가 목표)**·신뢰성·구현 난이도. 공식 문서·약관 페이지를 직접 읽고 URL 과 조회일을 적는다. 못 읽은 것은 "확인 못 함".
4. **아키텍처 단계 제안**: P0 개발 시점 분석가 노트(웹 검색 + 공식 문서 fetch + ADP-006 정책) / P1 데이터 수집기(DB 테이블, cron, 캐시, 출처·기준일 메타) / P2 post-market 해외 확장(국내 고정 제거 지점) / P3 런타임 AI 프롬프트 연결(ADP-004-C02 이후). 단계마다 SAFETY_PATHS 해당·데모 게이트·Reviewer·Codex 필요 여부·규모·위험.
5. **ADP-006-C01 재설계안**: 미국 표본(후보: 보유 MU·ORCL·SMH, 앱 신호 종목 INTC·SNDK 등), 전향적 이벤트(향후 수주 안 실적 발표 — 일정은 공식 출처로 확인해 출처 표기), 군 정의(웹 허용 조건), 지표(발표 후 실제 EPS·매출과 인용 컨센서스의 정확도 등 사후 정답 대조), 비용.
6. **위험**: 환각·출처 불명 수치, 웹 문서 속 지시문(프롬프트 주입), 약관·수익화, 데이터 신선도, 시차(미국 장 시간 vs KST).
7. **사용자 결정 항목**과 권고(Q 표), 확인하지 못한 것.

## Analyst

- [22:50] 착수. 읽은 것: `analyst.md`·프로젝트 `CLAUDE.md`·이 문서·T-055 Analyst 절(형식)·ADP-006 `20-결정`(D-01·D-02)·`11` §3-2-2·§4-3·§5-2·`10` §4-5·ADP-004 D-02·C01 `설계.md`. 코드: `post-market-engine.ts` 전체, `kis-overseas.ts`(1-210·431-513), `kis.ts`·`fx.ts`·`market-flags.ts`·`market-hours.ts`·`universe-overseas-static.ts`·`universe.ts`(205-245·342-365)·`engine.ts`(1040-1100·1155-1175·1300-1320·1515-1545)·`order-limits.ts`(40-60)·`macro.ts`·`fundamentals/[symbol]/route.ts`·`rag/retrieval.ts`·`rag/m4-kb.ts`·`market-context-client.ts`·`research/{types,run-cycle,storage,data/history-source,data/yahoo-finance-source}.ts`·`rs-rating.ts`·`cron/{entry-watcher,news-fetch,post-market-analysis,rs-update,sync-stock-meta}/route.ts`·`scripts/cron-runner.sh`·`scripts/git-hooks/commit-msg`(SAFETY_PATHS)·home-m4-api `config.py`. 운영 DB 는 **읽기 전용 SELECT/SHOW/DESCRIBE 만**(스크립트 `scratchpad/t057_db_readonly*.js`, 비밀값·보유 수량·평단 미출력). 웹은 공개 문서·약관·IR 보도자료·SEC API 만(질의·URL 에 티커·분기·문서명만). KIS 호출·쓰기·커밋·배포 없음.

### 0. 먼저 알아야 할 불편한 사실 5가지

1. **[확실] post-market 해외 분기는 "일부 구현"이 아니라 사실상 미구현이고, 국내 가정이 6곳에 박혀 있다.** `loadSymbols('overseas')` 가 빈 배열을 돌려주고(`post-market-engine.ts:196-199`) 그 뒤 전부 국내 고정이다: 캔들 import 가 `kis-domestic` 직결(:14, 호출 :306 — 심볼 디스패치하는 `kis.getCandles` 가 아님), INSERT 의 `market` 이 `'domestic'` 리터럴(:170), 프롬프트 첫 줄 "국내주식"·가격 `toFixed(0)`(:223-229), `valid_from`/`expires_at` 이 다음 거래일 **09:00/15:30 KST**(:95-130 — 미국장은 22:30/23:30 KST 개장이라 카드가 개장 전에 만료된다. T-046 과 같은 종류의 시각 결함이 해외에서 재현된다), 주말 판정이 KST 요일(:289), 수량·추격·금액 필터가 `market==='domestic'` 조건(:376-382·:401-412). `cron-runner.sh:143` 은 매일 08:00 KST 에 해외 post-market 을 호출하지만 결과는 늘 `no_symbols` 다(DB: `scenario_source='post-market'` 행 45건 전부 domestic, overseas 0건).
2. **[확실] 앱이 가진 미국 데이터는 KIS 시세·일봉·잔고뿐이고, 분석가가 쓸 재무·실적·일정·뉴스 원천은 없거나 쓰면 안 되는 것이다.** `stock_fundamentals` 는 LLM 기억값(`route.ts:28-74` 프롬프트, `:132` `data_source='claude_ai'`)이며 해외 행도 이미 있다(DB: `NAS:SNDK` 10-11, `NAS:SNPS`·`NAS:AAPL` — 프롬프트는 "EPS 원화·시가총액 억원"을 요구하므로 미국 종목엔 단위부터 틀리다). 미국 뉴스 RAG 는 M4 의 **WSJ Markets RSS 한 피드**(`home-m4-api/app/config.py:136` `feeds.a.dj.com/rss/RSSMarketsMain.xml`)에서 온 헤드라인이고 종목별 필터가 없다(`retrieval.ts:63-69` `news.us_market`). DB 에 candle·news·earnings 테이블은 없다(SHOW TABLES 30개 실측).
3. **[확실] `src/lib/research/` 는 Yahoo Finance 비공식 chart API 를 1차 원천으로 쓴다**(`data/history-source.ts:19,36-38`, `data/yahoo-finance-source.ts:19,127-131` — 브라우저 UA 위장, `query1→query2` 폴백, 5년 일봉). 이것은 ADP-004 D-02 조건 "Yahoo 는 StockInvest 사용자 화면·서비스 기능에 쓰지 않는다"와 **이미 충돌**한다(research-cycle cron 이 매일 돌고 `research_rally_results` 가 해외 3종목 × 60회 적재, 화면 `recommendation-view.ts` 로 노출). 이 task 가 만든 충돌이 아니라 기존 상태이고, 사용자 결정이 필요하다(Q4).
4. **[확실] "앞으로의 실적 발표일"을 주는 공식·무료 API 는 없다.** SEC EDGAR 는 과거(8-K Item 2.02 보고일)와 실제값(XBRL companyfacts)을 주고, 미래 일정은 회사 IR 보도자료(BusinessWire 등)로만 나온다. 보유·신호 종목 6곳의 IR 뉴스 RSS 를 서버에서 받아 봤더니 403/404(Micron·Oracle·Sandisk·NVIDIA 403, Intel 404, AMD 301)였고 IR 이벤트 페이지는 JS 렌더링이라 fetch 로 비어 있다. 실적 캘린더를 주는 무료 API(Finnhub·FMP·Alpha Vantage)는 **약관이 개인·비상업 전용**이라 서비스 기능에 못 쓴다(§3). 그래서 P1 수집기의 실적 일정 필드는 `confirmed(IR 원문)/estimated(EDGAR 패턴)/manual(사용자)` 상태를 반드시 가져야 한다.
5. **[확실] KIS 해외 API 에는 우리가 안 쓰는 관측 재무지표가 있다.** `해외주식 현재가상세`(tr_id `HHDFS76200200`, `/uapi/overseas-price/v1/quotations/price-detail`)의 출력에 `perx`(PER)·`pbrx`(PBR)·`epsx`(EPS)·`bpsx`(BPS)·`tomv`(시가총액)·`shar`(상장주수)·`h52p`/`l52p`(52주 고저)·`e_icod`(업종)이 있다(KIS 공식 저장소 `examples_llm/overseas_stock/price_detail/chk_price_detail.py` 의 `COLUMN_MAPPING`, 2026-10-20 조회). 우리 어댑터는 기본 시세 `HHDFS00000300`(`kis-overseas.ts:83`)만 부른다. 이것이 `stock_fundamentals` LLM 기억값을 **관측값으로 바꿀 수 있는 가장 싼 경로**다(계약·키 추가 없음).

### 1. 현황 조사 — 코드·DB (미국 지원 현재 / 없음)

| 영역 | 현재 코드 (파일:줄) | 미국 지원 | 비고 |
|---|---|---|---|
| 시세 | `kis-overseas.ts:81-135` `getTicker` — `HHDFS00000300`, 5s 타임아웃·1회 재시도, **KRW 환산 후 반환**(:122-134, `priceUsd` 병기 `types.ts:58`) | ✅ | 환율 실패 시 1 배(:30-37 — 환산 미적용으로 조용히 떨어짐) |
| 일봉 | `kis-overseas.ts:138-179` `HHDFS76240000` dailyprice, 수정주가, KRW 환산, 1페이지만 | ✅ (단기) | 분봉 미지원 → 일봉 폴백(:140-141). 100봉 상한은 ADP-006 11 §3-2-2 기재 [가능성 높음 — 직접 호출 안 함] |
| 잔고·USD 예수금 | `kis-overseas.ts:398-430`(TTTS3012R), `:311-345`(CTRP6504R, T-056) | ✅ | T-056 배포 10-21 05:17 예약 |
| 주문 | `kis-overseas.ts:440-513` — 지정가 고정, **KRW 가격을 fx 로 USD 역산**(:470-473), fx 실패 시 **1400 고정**(:470) | ✅ | 2026-05-13 USD/KRW 단위 사고의 뿌리. P2 카드 가격 통화 설계 시 이 역산을 전제로 해야 함 |
| 한도·블랙리스트 | `order-limits.ts:47-50` USD→KRW 환산, `:58-66` `safety_blocked_symbols_overseas` | ✅ | `ORDER_MAX_OVERSEAS_KRW`(CLAUDE.md 표) |
| 유니버스 | `universe-overseas-static.ts:6-19` 정적 50종(`OVERSEAS_UNIVERSE_SYMBOLS` env 오버라이드 :21-26), `universe.ts:220-226` 거래대금 정렬, 즐겨찾기 편입 `:346-356` | ✅ | DB `symbol_universe` overseas 2,600행, `stock_meta` overseas 11,700행(적재 경로는 `sync-stock-meta` 가 국내 전용이라 **확인 못 함**) |
| 전략 평가·시그널 | `engine.ts:1161-1162` 개장 가드(ET), `:1309-1310` 해외 universeSrc 고정, `runAll :1521-1545` 현재 열린 시장 1곳 | ✅ 동작 중 | DB 30일: `rsi-oversold-v1` 519 expired + 1 awaiting(10-20 `NAS:INTC`), `pullback-trend-v1` 65, `eval_funnel` overseas 하루 5~7천 행 |
| post-market(AI 시나리오) | §0-1 의 6곳 | ❌ | `cron-runner.sh:143` 08:00 KST 호출만 존재 |
| 승인 → 진입 감시 | `entry-watcher/route.ts:254-262`(시장별 개장), `:390-391` `currency:'USD'`, `:398` 현금 사전점검 **국내만** | ✅(시장 중립) | 카드 `price` 는 KRW 전제(`:349-353`, `currentPrice=ticker.price` KRW) |
| 장 시간·휴장·DST | `market-hours.ts:36-43` 휴장(DB `market_holidays`), `:55-62` DST 계산, `:80-88` 09:30~16:00 ET, `:152-170` 세션 phase | ✅ | DB overseas 휴장 2025~2030 연 11~13건 적재 |
| 환율 | `fx.ts:17` 5분 TTL, `:126-140` 메모리→`fx_rates`→외부 폴백 | ✅ | `fx_rates` 1행(10-20 14:36) |
| fundamentals | `fundamentals/[symbol]/route.ts:28-74` LLM 프롬프트(원화·억원 단위), `:132` `claude_ai`, 24h 캐시 | ❌ (기억값) | 해외 행 3건 존재(§0-2). **근거로 쓰지 않는다**(ADP-006 규칙 3) |
| 뉴스 RAG | `retrieval.ts:63-69` 시장별 컬렉션, M4 `config.py:135-136` RSS 2개(연합 경제 / WSJ Markets) | △ | 종목별 뉴스 없음. KIS `해외뉴스종합(제목)` `HHPSTH60100C1`(종목코드 필터 입력 있음) 미사용·미검증 |
| market-context | `market-context-client.ts:26,46-70` `overseas` 지원, M4 `market_context.py:98` `news.us_market`+`news.macro` | ✅ | 심리 라벨 수준 |
| macro | `macro.ts:23` `NYS:SPY` 등락, USD/KRW 24h 비교 | △ | 지수 1개 |
| research(순수 통계) | `research/types.ts:6-9` LLM 없음·`overseas` 타입, `storage.ts:72-75` `stock_favorites.research_enabled`, 원천 Yahoo(§0-3) | ✅ 동작 중 | DB: `NAS:MU`·`NAS:SNDK`·`NAS:SNPS` 각 60회, 최신 10-19 |
| RS rating | `rs-rating.ts:76-90` 시장 인자 있음 | ❌ 미실행 | `cron-runner.sh:137` 국내만 17:30. DB overseas `rs_rating` 채워진 행 0/2,600 |
| 분석가 정의 | `analyst.md:130` "해외는 NAS:AAPL 형식" 한 줄 | △ | 미국 데이터·출처 규칙 없음(ADP-006 C01 이 채울 자리) |
| 보유 | `position_state` overseas 3종(`NAS:SMH`·`NYS:ORCL`·`NAS:MU`, 10-20 14:01 갱신) + 국내 2종 | — | 수량·평단은 적지 않는다(D-01 #2-1) |

### 2. 데이터 요구 정의 (미국 종목 분석)

| # | 범주 | 쓰임(분석가) | 중요도 | 현재 보유 | 후보 원천 |
|---|---|---|---|---|---|
| D1 | 현재가·일봉(USD·수정주가) | 기술 패턴, 이벤트 전후 반응 계산 | 높음 | ✅ KIS(단기 100봉) / Yahoo(5년, 약관 문제) | KIS 유지. 장기 이력은 Q4 |
| D2 | 실적 발표 일정(미래) | 이벤트 노트 시점·블랙아웃 프리필터 | **최고** | ❌ | IR 보도자료(공식) → EDGAR 8-K 2.02 패턴 추정 → 사용자 입력 |
| D3 | 과거 실적 발표일 | 과거 반응 이력(규칙 5 "2건 이상") | 높음 | ❌ | EDGAR submissions 8-K `items` 에 `2.02` (실측: INTC·ORCL·SNDK 각 6~10건 즉시 추출) |
| D4 | 분기 실제 EPS·매출·가이던스 | 사후 정답, 직전 분기 근거 | 높음 | ❌ | EDGAR companyfacts(XBRL, `frame` 있는 분기값) + 8-K EX-99.1 보도자료(가이던스는 XBRL 에 없음) |
| D5 | 컨센서스(EPS·매출) | 서프라이즈 판정 | 중 | ❌ | 공식 원천 없음. 웹(2차, 교차 확인) 또는 유료. 없으면 `알 수 없음` |
| D6 | 분기 재무제표(10-Q/10-K) | 테제 근거·반증 | 중 | ❌ | EDGAR companyfacts·frames(무료) |
| D7 | 공시 8-K(2.02 외 — 5.02 임원, 8.01 기타) | 촉매·리스크 | 중 | ❌ | EDGAR submissions |
| D8 | 실적 콜 전사록 | 가이던스 톤 | 낮음 | ❌ | 공식 무료 없음(회사 웹캐스트). 삭제 유지(ADP-006 치환표) |
| D9 | 종목 뉴스·촉매 | 이벤트 전 맥락 | 중 | △ WSJ 피드 | KIS 해외뉴스(제목) 검증 필요, 웹 검색(P0 만) |
| D10 | 밸류에이션 스냅(PER·PBR·EPS·시총·52주) | 테제 근거 | 중 | ❌(LLM 기억값만) | **KIS price-detail**(관측값, 추가 계약 없음) |
| D11 | 배당·권리 | 보유 점검 | 낮음 | ❌ | KIS `기간별권리조회` `CTRGT011R`(유형 03 배당 등, "예정"은 참고용 — 저장소 주석) |
| D12 | 비교 기업·ETF 구성 | SMH 같은 ETF 보유 분석 | 중 | ❌ | 운용사 팩트시트(VanEck, 2차 확인만 됨)·SEC N-PORT |
| D13 | 매크로(지수·금리·환율) | 레짐 | 낮음 | △ SPY·USD/KRW | FRED 등은 범위 밖 |
| D14 | 휴장·DST·시차 | 모든 시각 계산 | 높음 | ✅ | 유지 |

### 3. 소스 후보 평가표 (조회일 전부 2026-10-20)

| 소스 | 제공 데이터 | 인증 | 요금 | 속도 제한 | **상업 이용·재배포 약관** | 한국 서버 접근 | 신뢰성 | 난이도 | 판정 |
|---|---|---|---|---|---|---|---|---|---|
| **SEC EDGAR APIs** (`data.sec.gov` submissions·companyfacts·companyconcept·frames, `efts.sec.gov` 전문검색, 야간 bulk zip) | D3·D4·D6·D7 (XBRL 표준 태그만, 가이던스 없음) | 없음("do not require any authentication or API keys") | 무료 | **10 req/s**, User-Agent 에 "회사명 연락 이메일" 선언 요구, 봇넷·크롤 금지 | 페이지에 상업 이용·재배포 제한 **없음**("Anyone can access and download this information for free") — 미국 정부 공공데이터 | ✅ 실측: `data.sec.gov`·`efts.sec.gov` HTTP 200(이메일 없는 UA). `www.sec.gov/files/company_tickers.json` 은 **403**(UA 두 종류 모두) — 티커→CIK 매핑은 submissions 응답의 `tickers` 필드나 사용자 제공으로 대체 가능 | 최고(원천) | 낮음(JSON) | **P1 1순위** |
| **KIS 해외 API**(기계약) | D1(시세·일봉 100봉)·D10(price-detail)·D11(권리)·D9(뉴스 제목)·조건검색. **실적 일정·컨센서스·재무제표 API 는 없음**(저장소 `examples_llm/overseas_stock` 50개 디렉토리 열람) | 기존 키 | 무료(계좌) | 기존 스로틀(`kis-throttle.ts`) | 개인 계좌용 API. **데이터 재배포·수익화 약관은 확인 못 함**(포털 약관 페이지 JS) | ✅ | 높음(증권사 관측값) | 낮음(어댑터 1함수 추가 — 단 `src/lib/exchanges/` 는 SAFETY_PATHS) | **P1 2순위**(D10) |
| 웹 검색·공개 문서 읽기(분석가 도구) | D2·D5·D9·D12 | — | — | — | D-02 조건 a~e(개발 시점 노트 한정, 조건 e) | ✅ | 2차(교차 확인 필요) | — | **P0 전용** |
| 회사 IR 보도자료 | D2(공식 미래 일정)·D4(가이던스) | 없음 | 무료 | — | 공개 보도자료 — 사실 인용 가능 [가능성 높음] | △ 보도자료 상세 페이지는 fetch 가능(Intel·AMD 실측), IR 이벤트 페이지·RSS 는 JS·403 | 최고 | 자동화 어려움(사이트별 상이, 봇 차단) | P0 수동 + P1 `manual/confirmed` 입력 |
| Alpha Vantage(무료 키) | 시세·재무·실적 캘린더 [추측: 캘린더 엔드포인트는 미확인] | API 키 | 무료 25 req/일, 프리미엄 유료 | 25/일 | ToS §2(a): "**for personal, non-commercial use**", 타인이 정보에 접근하는 상업 활동은 commercial → `premium@` 문의 | 미확인 | 중 | 낮음 | 서비스 기능 **불가**(개인 연구만) |
| Finnhub(무료) | 실적 캘린더·기초 재무·뉴스 | API 키 | 무료 티어(60/분은 2차 출처) | 30 calls/s 상한(약관) | ToS: "strictly for personal use", "**can't be used by any business even internally without a written approval**", 재배포·파생 결과 공유 금지, 구독 종료 시 데이터 삭제 | 미확인 | 중 | 낮음 | 서비스 기능 **불가** |
| Financial Modeling Prep(무료) | 재무·실적 캘린더 | API 키 | 무료 250 req/일 | 250/일 | ToS 페이지 **403 으로 직접 못 읽음**. FMP 자사 안내(검색 요약, 2차): 개인·비상업, 조직 사용 불가, 제3자 접근 도구 통합 금지 | 미확인 | 중 | 낮음 | 서비스 기능 **불가**(약관 원문 확인 못 함) |
| Polygon → **Massive**(`polygon.io/pricing` 301 → `massive.com`) | 시세 EOD 2년 | API 키 | 무료 5 req/분 EOD, Starter $29/월 | 5/분 | 가격 페이지에 "Individual use" 라벨, "Non-pros only" 링크. 상업·재배포 약관 **확인 못 함**(Terms 페이지 미열람) | 미확인 | 중 | 낮음 | 보류 |
| Yahoo Finance 비공식 chart API | 5년 일봉(현재 research 사용) | 없음(UA 위장) | 무료 | 비공개 | ADP-004 D-02: 서비스 기능 사용 금지. 비공식 API | ✅(현재 동작) | 중(비공식) | — | **충돌 중(Q4)** |
| 유료·MCP(S&P Capital IQ·FactSet·LSEG 류) | 컨센서스·전사록 | 계약 | 가격 비공개(기관 계약) | — | 계약별 | — | 최고 | 높음 | 범위 밖(D-01 #3 MCP 설치 금지, 비용 미공개) |
| Nasdaq.com 실적 캘린더 등 포털 | D2 | — | — | — | 약관 **확인 못 함** | — | 2차 | 스크래핑 | 평가 안 함 |

출처(조회일 2026-10-20): SEC API 안내 `https://www.sec.gov/search-filings/edgar-application-programming-interfaces`, 접근 정책 `https://www.sec.gov/os/accessing-edgar-data`(10 req/s·UA), Alpha Vantage ToS `https://www.alphavantage.co/terms_of_service/`(PDF §2(a)·§2(a)(iii)), 지원 `https://www.alphavantage.co/support/`(25/일), Finnhub ToS `https://finnhub.io/terms-of-service`, FMP ToS `https://site.financialmodelingprep.com/terms-of-service`(403), Massive `https://massive.com/pricing`, KIS 저장소 `https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm/overseas_stock`(+ `price_detail/chk_price_detail.py`, `search_info/search_info.py`=`CTPF1702R` 상품기본정보, `period_rights/period_rights.py`=`CTRGT011R`, `news_title/news_title.py`=`HHPSTH60100C1`).

**상업 이용 판정 요약** — 서비스 기능(화면·자동매매 입력·수익화)에 지금 쓸 수 있는 것은 **SEC EDGAR 와 KIS(기계약 범위) 둘뿐**이다. 무료 티어 API 3종은 전부 개인·비상업 조건이라 P0(개발 시점 노트)에서도 쓰지 않기를 권한다 — 노트가 나중에 화면 문안으로 승격될 때 출처 세탁이 된다. 웹 검색은 D-02 조건대로 P0 전용.

**EDGAR 실측(읽기 전용, UA 선언, 2026-10-20)** — `companyfacts/CIK0000723125`(Micron) 4.15MB 200: `EarningsPerShareDiluted` 분기값이 `frame`(예 `CY2026Q2` end 2026-05-28 val 24.67 filed 2026-06-25)으로 구분되고, FY2026 10-K 가 2026-10-09 에 접수돼 있다(관측: EDGAR companyfacts). `submissions/CIK0000050863`(Intel) 200: 8-K `items` 에 `2.02` 가 있는 보고일 = 2026-07-23·04-23·01-22·2025-10-23·07-24·04-24…(과거 실적일 10건 즉시). Oracle(CIK 1341439): 2026-09-10·06-10·03-10·2025-12-10·09-09·06-11…, Sandisk(CIK 2023554, FYE 06-28): 2026-08-05·04-30·01-29·2025-11-06·08-14·05-07. 전문검색 `efts.sec.gov/LATEST/search-index?q="first quarter"&ciks=0000723125&forms=8-K&…` 200, Micron 2025-12-17 8-K 보도자료 적중. → **D3·D4 는 오늘부터 코드 없이도 쓸 수 있다.**

### 4. 실적 일정 — 전향적 이벤트 후보 (공식 출처 우선, 조회일 2026-10-20)

| 종목 | 분기 | 발표(현지) | KST 환산 | 출처 | 확인 수준 |
|---|---|---|---|---|---|
| NAS:INTC (앱 신호) | Q3 2026 | **2026-10-29 목 장 마감 직후**, 콜 14:00 PDT | 10-30 금 05:00~06:00 | 공식 보도자료 2026-10-06 `https://www.intc.com/news-events/press-releases/detail/1782/…` ("will report third-quarter financial results on Thursday, October 29, 2026, promptly after close of market") | [확실] |
| NAS:SNDK (앱 신호·즐겨찾기) | FQ1 FY2027 | **2026-10-29 목**, 콜 13:30 PT | 10-30 금 05:30 | 공식 보도자료 2026-09-29 `https://www.sandisk.com/company/newsroom/press-releases/2026/2026-09-29-sandisk-to-report-first-quarter-fiscal-year-2027-results-on-october-29-2026`(제목으로 날짜 확인, 본문 시각은 검색 요약) | 날짜 [확실] / 시각 [가능성 높음] |
| NAS:AMD (SMH 구성 4위) | Q3 2026 | **2026-11-03 화 장 마감 후**, 콜 17:00 ET | 11-04 수 07:00 | 공식 보도자료 2026-10-06 `https://ir.amd.com/news-events/press-releases/detail/1300/…` | [확실] |
| NAS:MU (보유) | FQ1 FY2027 | 공식 **미공지** | — | 패턴: FQ1 FY2026 8-K 2025-12-17(EDGAR 전문검색), 트래커 추정 12-16 | [추측] 12월 셋째 주 |
| NYS:ORCL (보유) | FQ2 FY2027 | 공식 **미공지** | — | 패턴: 8-K 2.02 2025-12-10·2024-12-09, Oracle 은 약 1주 전 공지(FQ1 FY27 은 09-02 공지→09-10) | [추측] 12월 둘째 주 |
| NAS:NVDA (SMH 구성 1위) | Q3 FY2027 | 공식 **미공지** | — | 트래커 추정 11-18 | [추측] |
| NAS:SMH (보유, ETF) | 해당 없음 | — | — | VanEck 팩트시트(2026-07-31 기준) 상위: NVDA 21.38 / TSM 9.57 / AVGO 6.60 / AMD 5.62 / ASML 5.01 / MU 4.92 / AMAT 4.91 / TXN 4.70 — 검색 요약 경유, 팩트시트·보유 페이지 직접 fetch 는 리다이렉트 루프로 실패 | [가능성 높음] |
| NYS:TSM·NAS:AVGO (SMH 2·3위) | — | 확인 못 함 | — | — | — |

C01 전향적 시험에 **지금 쓸 수 있는 확정 이벤트는 INTC·SNDK(10-29)·AMD(11-03) 3건**이고, 보유 종목(MU·ORCL)은 12월이라 공지가 나오면(11월 말~12월 초) 추가한다.

### 5. 단계별 아키텍처 제안 (P0 → P3)

| 단계 | 내용 | 변경·산출 위치 | SAFETY_PATHS | 데모 게이트 | Reviewer | Codex | 규모 | 주요 위험 |
|---|---|---|---|---|---|---|---|---|
| **P0** 개발 시점 분석가 노트 | 코드 0. 분석가가 ① EDGAR(curl, `SEC_USER_AGENT` 선언) ② KIS 시세 조회(기존 범위) ③ 웹 검색·IR 보도자료(D-02 a~e) ④ ADP-006 정책 블록으로 vault 노트 작성. 매 노트 머리에 데이터 기준일·출처 괄호 | `agent-vault/10-Flow/tasks/*`(노트), scratchpad 스크립트 | 해당 없음 | none | 7번 금지 문구·질의 감사만 | 불필요 | 소 | 환각·2차 출처·주입(§6) |
| **P1** 데이터 수집기 | 테이블 4개 + cron 2개 + 어댑터 1함수: `symbol_cik_map`(symbol, cik, source, verified_at) · `us_filings`(cik, accession, form, items, report_date, filed, primary_doc_url) · `us_financial_facts`(cik, taxonomy, tag, unit, frame, start, end, val, form, filed, accn — companyfacts 의 `frame` 있는 분기·연간만) · `us_earnings_events`(symbol, fiscal_period, event_date_et, event_time_class[BMO/AMC/unknown], **status[confirmed/estimated/manual]**, source_kind, source_url, observed_at, superseded_by) · `us_fundamentals_snapshot`(symbol, per, pbr, eps, bps, market_cap, shares, h52, l52, sector, observed_at — **KIS price-detail**). cron `edgar-sync`(매일 07:00 KST, 종목당 submissions 1 + companyfacts 1 호출, 10 req/s 아래로 직렬, UA 필수, ETag/`filed` 증분) · `kis-fundamentals-snapshot`(매일 1회, 보유+즐겨찾기+universe 50). `estimated` 는 과거 8-K 2.02 보고일의 요일·주차 패턴으로 다음 분기 ±7일 창만 계산(날짜 단정 금지). `/api/fundamentals` 는 해외 심볼이면 LLM 호출 대신 스냅샷을 돌려주고 `data_source='kis_price_detail'` | `src/lib/data/us-edgar/*`(신규), `src/lib/exchanges/kis-overseas.ts`(price-detail 1함수), `src/app/api/cron/{edgar-sync,kis-fundamentals-snapshot}/route.ts`, `scripts/cron-runner.sh`, 마이그레이션(`--with-migrate` 사용자 승인) | ✅ `src/lib/exchanges/`, `src/app/api/cron/`, `scripts/cron-runner.sh` | none(화면 없음) · fundamentals 카드 표기 변경 시 delta | 필수(scope 포함) | **C2 권고** — 외부 JSON 파싱·레이트리밋·증분 동기화 결함은 사람 리뷰가 놓치기 쉬운 영역 | 중(파일 8~12) | SEC 403(UA)·XBRL 태그 변동(Revenues vs RevenueFromContract…)·분기값 vs 누적값 혼동(`frame` 없는 YTD 행 배제 필수)·마이그레이션 |
| **P2** post-market 해외 확장 | §0-1 의 6곳 제거: `loadSymbols('overseas')` = 정적 50 + 즐겨찾기 + **보유**; 캔들을 `kis.getCandles`(심볼 디스패치)로; INSERT `market` 파라미터화 + `uq_signals_scenario_card` 유니크키가 market 을 포함하는지 확인; `valid_from/expires_at` 을 **다음 미국 세션 09:30/16:00 ET → KST** 로(DST 는 `market-hours.ts:55-62` 재사용), 주말·휴장 판정을 ET+`market_holidays`; 프롬프트를 시장별로(USD 표기 `toFixed(2)`, "미국주식"); 카드 금액·수량: 카드 `price` 는 현행 KRW 환산값 유지(entry-watcher·createOrder 가 KRW 전제 — `:349-353`, `kis-overseas.ts:470-473`)하되 **fx 기준일을 `indicators` 에 기록**; `cardBuysZeroShares` 에 market 인자; **실적 블랙아웃 프리필터**(P1 `us_earnings_events` 에서 `confirmed` 이벤트가 N거래일 안이면 BUY 카드 생성 안 함 — 결정론적, 2026-08-02 결정 #2 부합) | `src/lib/strategy/post-market-engine.ts`, `rules/*`(KRW 가정 점검), 테스트 | ✅ `src/lib/strategy/` | none(카드 화면 동일) | 필수 | **C2 권고**(T-046 시각 결함 전례와 같은 부류) | 중~대(파일 6~10) | KRW/USD 단위 사고 재발, 시차, 중복 카드, 08:00 KST 실행 시 미국 당일 종가 반영 여부(KIS 일봉 갱신 시각 확인 필요) |
| **P3** 런타임 AI 프롬프트 연결 | post-market 프롬프트에 P1 관측값(직전 분기 EPS·매출 A/E, 다음 실적일 status, PER/PBR 스냅샷)과 "알 수 없음" 규칙을 넣는다. **선행 조건**: ADP-004-C02 기준선 측정(현재 `설계.md` status=design, 10-07 — 미측정)·C01 go·`llm_provider` 확인(현재 `"hybrid"`) | `post-market-engine.ts buildPrompt`, 카드 `indicators` 필드 | ✅ | delta(카드에 새 필드 노출 시) | 필수 | C2 | 중 | 기준선 오염, 프롬프트 길이·Qwen 한국어 |

순서 권고: **P0 는 승인 즉시**(C01 과 묶음) → **P1 은 T-056 배포 검증 뒤 첫 구현 task** → P2 는 P1 의 `us_earnings_events` 가 1개월 쌓인 뒤(블랙아웃 프리필터 입력 확보) → P3 는 C02 기준선 뒤. P2 를 P1 보다 먼저 하면 해외 카드가 실적 발표 전날 생성되는 것을 막을 데이터가 없다.

### 6. ADP-006-C01 재설계안 — 유지·변경

| 항목 | 현 설계(`설계.md`) | 재설계 | 이유 |
|---|---|---|---|
| 표본 | 국내 8종목 | **미국 6 + 국내 2**: INTC·SNDK(표본 내, 10-29 이벤트 — 문안 다듬기용)·AMD(11-03)·NVDA(11월, 공식 공지 후 확정)·MU·ORCL(12월, 공지 후 확정) 표본 외 + 005930·000660(보유, L0 테제 노트 — 지표 1~6 만) | 미국 주력(D-02 #1). 보유 2종은 12월이라 11월 안에 판정하려면 AMD·NVDA 가 필요 |
| 노트 종류 | 테제/이벤트 | 미국 = **이벤트 노트**(발표 전 작성, 마감 = 발표일 현지 06:00 ET 이전 KST 저녁), 국내 = 테제 노트 | 전향성 확보 |
| 군 | (가) 대조 / (나) 규칙만 / (다) 이식본, 모두 L0 | 구조 유지. **미국 종목은 세 군 모두 웹 허용(D-02 a~e, 같은 조건)**, 국내는 세 군 모두 L0. 웹 유무는 군 변수가 아니라 시장 변수 | 정책 블록 효과와 웹 효과가 섞이지 않게. (가)에서 웹을 막으면 "(다)가 더 낫다"의 원인을 가를 수 없다 |
| 과거 사건 소급 평가 | (없음) | **금지** — 검색 결과에 발표 결과가 들어 있어 예측이 아니라 회상이 된다 | 전향적 지표 무효화 방지 |
| 지표 1·2·3·4·5·6 | 유지 | 유지. 2 의 "데이터 없는 항목"은 P0 에서는 컨센서스·실적 콜·옵션만 남는다(실적일·직전 실적은 이제 관측 가능 — EDGAR·IR) | — |
| 지표 7 금지·웹 0회 | (b) `WebSearch/WebFetch` 0회 | (a) 유지. (b) 국내 노트 0회 / 미국 노트는 **질의 사후 감사: 보유 수량·평단·손익·계좌·회원 정보 혼입 0건**(D-02 d), 비공식·개인용 API 호출 0건 | D-02 완화 반영 |
| **지표 8(신설) 직전 실적 정확도** | — | 노트가 인용한 직전 분기 EPS·매출을 EDGAR companyfacts `frame` 값과 대조 — (다) 6건 **100% 일치 또는 `알 수 없음`**, 출처 괄호 100% | **즉시 검증 가능한 사후 정답**. 환각 지표 1 의 수치판 |
| **지표 9(신설) 전향적 검증 가능성** | — | 발표 전 노트의 시나리오 표(상/중/하 기준치)가 발표 후 실제값(EDGAR 8-K EX-99.1·companyfacts)으로 **분류 가능한 비율 100%**(기준치가 수치여야 함). 실제 결과·주가 반응(KIS 일봉, 발표 다음 거래일 종가 변화)은 **사후 기록**(판정 아님 — 표본 4건) | 예측 적중률 판정은 표본이 너무 작다(4건). 판정은 "검증 가능하게 썼는가"까지 |
| 컨센서스 | `알 수 없음` 고정 | 웹 2차 출처는 **도메인·조회일 표기 + 교차 2곳 일치 시만 수치**, 아니면 `미확인(출처 1곳)` | D-02 b |
| 판정 규칙 go/축소/hold/중단 | 유지 | 유지 + **중단 조건 추가**: 지표 8 불일치가 표본 외 1건이라도 나오면 중단(관측값이 있는데 틀린 것은 환각보다 나쁘다), 지표 7(b) 혼입 1건이면 즉시 중단 | — |
| 사전 테스트 골든 6 | 국내 중심 | 이벤트 3 = INTC(공식 일정)·MU(일정 미공지 → `알 수 없음` 처리 확인)·국내 1 / 테제 3 = MU·005930·000660 | 미국 전환 |
| 비용 | 72만~190만 토큰 | 노트 24건 + 사후 대조 4건 + 웹 텍스트 유입 → **100만~280만 토큰 [추측]**(웹 fetch 본문이 입력에 더해져 (가) 대비 +30% 는 넘기기 쉬움 → 지표 6 의 +30% 는 "정책 블록 분"만 재되게 측정 방법을 바꿔야 한다). 첫 3건 실측 후 보정, 에이전트 10개 이상이면 사전 동의(D-01 조건 4) | — |
| 일정 | — | 표본 내 2건(INTC·SNDK)은 **10-28 KST 밤까지** 써야 전향적이다. 그 전에 재설계 승인·변형 파일 3개(WP2)·reviewer diff(WP3)가 끝나야 하므로, **사용자 승인이 10-24 전에 없으면 표본 내는 AMD(11-03) 1건으로 줄이고 INTC·SNDK 는 사전 테스트(판정 아님)로 돌린다** | 현실적 일정 |

### 7. 위험

| # | 위험 | 영향 | 완화 |
|---|---|---|---|
| R1 | 환각·출처 불명 수치(특히 컨센서스·목표가) | 노트 신뢰 붕괴 | 지표 8 즉시 대조, 2차 출처 교차 2곳, `stock_fundamentals` 금지 유지 |
| R2 | **웹 문서 속 지시문(프롬프트 주입)** | 분석가가 외부 지시를 따름 | D-02 c. 이번 조사에서 읽은 SEC·IR·약관·KIS 저장소 텍스트에서 에이전트 대상 지시문은 **발견하지 못했다**. 노트마다 "외부 텍스트는 데이터" 머리말, 의심 문장은 위치와 함께 기록 |
| R3 | 약관·수익화 | 무료 API 데이터가 화면·매매 입력에 섞이면 약관 위반 | 서비스 기능 원천은 EDGAR·KIS 로 한정(§3 판정), P0 노트도 무료 API 미사용 |
| R4 | Yahoo 충돌(§0-3) | ADP-004 D-02 위반 상태 지속 | Q4 사용자 결정 |
| R5 | 데이터 신선도 | companyfacts 는 10-Q 접수 후(발표 후 수일~수주), 8-K EX-99.1 은 당일. KIS 일봉 갱신 시각 미확인 | `us_earnings_events.observed_at`·`filed` 기준일 표기, 노트 머리 "기준일 차이" 규칙 4 |
| R6 | 시차(ET↔KST, DST) | 카드 만료·마감 시각 오류(T-046 유형) | `market-hours.ts` 재사용, 테스트에 DST 경계 포함 |
| R7 | SEC 접근 차단 | UA 미선언·10 req/s 초과 시 관리 대상 | `SEC_USER_AGENT`(회사명+연락 이메일) env, 직렬 호출, 야간 bulk zip 대안 |
| R8 | 보유 정보 유출 | 질의에 수량·평단 혼입 | 질의 로그 사후 감사(지표 7b), 노트 템플릿에 티커·분기만 |
| R9 | KRW/USD 단위 사고 재발 | 해외 카드 가격·수량 오류 | P2 에서 카드 `indicators` 에 fx·통화 기록, 테스트에 환산 왕복 |

### 8. 사용자 결정 질문 (권고 포함)

| # | 질문 | 선택지 | 권고 | 근거 |
|---|---|---|---|---|
| Q1 | D-02 웹 조건 a~e 확정과 P0 착수 | (a) **a~e 그대로 확정, P0 즉시** (b) 조건 수정 | **(a)** | 조건은 이번 조사에서 그대로 지킬 수 있었다(질의에 티커·분기·문서명만) |
| Q2 | SEC User-Agent 에 넣을 연락 이메일 | (a) **사용자가 지정한 이메일**(env `SEC_USER_AGENT`) (b) 이메일 없이 | **(a)** | SEC 가 "회사명 연락 이메일" 선언을 요구. 이메일 없는 UA 로도 `data.sec.gov` 는 응답했지만 `www.sec.gov/files` 는 403 |
| Q3 | KIS price-detail 어댑터 추가(P1) | (a) **추가, `/api/fundamentals` 해외는 관측값으로 교체** (b) LLM 기억값 유지 | **(a)** | 추가 계약 없음, `src/lib/exchanges/` 안전 경로라 Reviewer 필수 |
| Q4 | research 모듈의 Yahoo 사용 | (a) **유지하되 "개발·연구용, 매매 입력 아님" 으로 ADP-004 D-02 에 예외 기록** (b) KIS 100봉으로 축소(5년 이력 상실) (c) 유료 원천 | **(a)** | 지금 바꾸면 rally 통계가 끊긴다. 단, 화면 노출(`recommendation-view`)이 "서비스 기능"인지 사용자 판단 필요 |
| Q5 | P2 카드 금액·통화 | (a) **KRW 100,000 고정 유지 + fx 기준일 기록** (b) USD 기준 금액 신설 | **(a)** | entry-watcher·createOrder 가 KRW→USD 역산 전제. USD 기준은 한도·킬스위치까지 번진다 |
| Q6 | 실적 블랙아웃 프리필터 N | (a) 2거래일 (b) **5거래일** (c) 없음 | **(b)** | 1~5일 보유 카드가 발표를 가로지르지 않게 |
| Q7 | C01 표본·일정 | (a) **§6 안(미국 6+국내 2, INTC·SNDK 표본 내, 10-24 전 승인 조건)** (b) 12월 보유 종목 공지 뒤 시작 | **(a)** | 12월까지 미루면 재검토 기한(11-04)을 넘긴다 |
| Q8 | 유료 데이터(컨센서스·전사록) 검토 | (a) **지금은 안 함** (b) 견적 요청 | **(a)** | 가격 비공개·MCP 설치 금지. 컨센서스는 `미확인` 표기로 충분한지 C01 에서 먼저 본다 |
| Q9 | 무료 API(Alpha Vantage·Finnhub·FMP) | (a) **쓰지 않음** (b) 개인 연구 한정 사용 | **(a)** | 개인·비상업 약관. 노트→화면 승격 시 출처 세탁 위험 |
| Q10 | P1 마이그레이션(테이블 5개) | (a) **별도 task, `--with-migrate` 승인 때 함께** (b) 보류 | **(a)** | 개발·운영이 같은 DB |

### 9. 확인하지 못한 것

- KIS `HHDFS76200200` 의 PER·PBR 값이 **어느 회계 기준·갱신 주기**인지(저장소에 필드명만 있고 정의서는 포털 JS). KIS 해외 일봉 100봉 상한과 일봉 갱신 시각(08:00 KST 실행 때 당일 종가 반영 여부) — 직접 호출하지 않았다.
- KIS 해외 데이터의 재배포·수익화 약관(포털 약관 페이지 미열람).
- FMP ToS 원문(403), Massive 상업 약관, Finnhub 무료 티어 분당 한도(2차 출처만), Alpha Vantage 실적 캘린더 엔드포인트 존재 여부.
- Micron·Oracle·NVIDIA 의 다음 실적 **공식** 일정(미공지), TSM·AVGO 일정, SMH 보유 비중의 10월 기준값(7-31 팩트시트만, 그것도 검색 요약 경유).
- `stock_meta` overseas 11,700행이 어디서 적재됐는지(`sync-stock-meta` 는 국내 전용).
- `uq_signals_scenario_card` 유니크 인덱스에 `market` 컬럼이 포함되는지(P2 전 DDL 확인 필요).
- SEC `company_tickers.json` 403 의 원인이 UA 형식인지 호스트 정책인지.

- [23:55] 설계 작성 완료(이 절). 앱 소스·설정·운영 DB·KIS·git 변경 0건. 임시 산출물은 scratchpad(`t057_db_readonly*.js`, EDGAR 응답 JSON)에만 있다. `20-Log/2026-10-20.md` 에 색인 한 줄 추가.

## Leader 기록

- [10-20 밤] 사용자 지시로 등록. judge 접수는 설계 task 라 생략하고 분석가 설계 후 구현 task 로 나눌 때 한다. 분석가(Fable) 읽기 전용 설계 착수.
- [10-20 23:58] 분석가 보고 수령 → Leader 독립 검증(직접 실행·읽기):
  - ✅ 코드: `post-market-engine.ts` 국내 고정 :14(import)·:70(수량)·:170(INSERT)·:201(심볼)·:289(주말)·:376/:401(필터), 해외 `loadSymbols` 는 `return []`(:195-198) — 보고와 일치.
  - ✅ DB(읽기 전용 SELECT): signals 의 `scenario_source='post-market'` 45건 전부 `domestic`·dup 표식 6건도 domestic, 해외 0건. `stock_fundamentals` 7행 전부 `data_source='claude_ai'`(해외 3·국내 4). 후보 신규 테이블(`us_*`·earning·candle·`symbol_cik_map`) 없음.
  - ✅ Yahoo 충돌: ADP-004 `20-결정.md:70` "Yahoo 는 개인 사용 약관 — StockInvest 사용자 화면·서비스 기능에 쓰지 않는다" ↔ `src/lib/research/data/yahoo-finance-source.ts` 가 1차 원천, `scripts/cron-runner.sh:17-18,156,163` 이 해외 07:00·국내 16:00 매일 호출, 결과가 `ResearchTab.tsx`·`FavoritesPage.tsx` 에 노출 — 실제 충돌.
  - ✅ 실적일: INTC 2026-10-29(목, 장 마감 후)·AMD 2026-11-03(화, 장 마감 후) — IR 보도자료(10-06) 페이지가 검색 결과에 있고 요약이 일치. SNDK·MU·ORCL·NVDA 는 직접 재확인 안 함.
  - ✅ 약관·KIS: Alpha Vantage ToS "personal, non-commercial use" 문구 확인, KIS 저장소 `chk_price_detail.py` 에 시가총액·52주 고저·PER·PBR·EPS·BPS 필드 확인(TR ID 는 직접 확인 안 함).
  - ✅ 분석가의 앱 소스 변경 0건: `git status` 의 src 변경 10여 개는 mtime 10-18(타 세션).
  - ⚠ **분석가 SEC 요청의 User-Agent 가 실연락처 없는 임시값**(`StockInvest-T057-analyst/1.0 (read-only research)`, `stockinvest-analyst@localhost`). SEC 접근 정책(회사명+연락 이메일 요구)에 맞지 않는 요청 약 10여 건. `company_tickers.json` 403 은 이 때문일 가능성이 높다([가능성 높음], 미확정). 이후 SEC 호출은 사용자가 UA 연락처를 정할 때까지 하지 않는다(Q2).
  - 미검증 그대로: 유료 데이터·Finnhub/FMP/Massive 약관, SMH 비중, KIS 재배포 약관, 보고 §9 전체.
- [10-21 10:29] **사용자 결정 수령 — Q1~Q10 모두 권고대로 승인**("T-057은 권고대로 진행"). 추가 사항: ① Q2 SEC 연락처 제공 → `.env` 에 `SEC_USER_AGENT="StockInvest-Research <사용자 이메일>"` 추가(git 무시 파일, 이 문서에는 이메일을 적지 않는다). 전화번호는 SEC 가 요구하지 않고 요청마다 외부로 나가므로 UA 에 넣지 않았다. ② Q9 질문에 답함 — 무료 API 3종은 공식 원천에 없는 미래 실적 발표일·재무제표·시세를 채우려던 후보였고 약관 때문에 쓰지 않는다([ADP-006 D-03](../../../adoption/ADP-006-anthropic-financial-services/20-결정.md)). ③ Q4 → [ADP-004 D-04](../../../adoption/ADP-004-vibe-trading/20-결정.md) 로 "개발·연구용" 예외 기록(약관 위험은 남음). ④ "국내주식" 문구 정정 완료: `StockInvest/CLAUDE.md` 3·5행, 워크스페이스 `CLAUDE.md` 프로젝트 표 5행, `ACTIVE.md` 결정 #1·`2026-08-02-restructure-plan.md` 결정 #1(취소선+대체 표시). 에이전트 역할 파일(`analyst.md` 등)과 Codex 미러·`AGENTS.md` 는 건드리지 않았다(역할 파일은 ADP-006 승격 때, 미러는 동기화 스크립트로 재생성).
- [10-21 10:29] **다음 단계**: P0 = ADP-006 C01 재설계 반영(`설계.md`) 후 사용량 동의를 받아 시작. P1 = 별도 구현 task(T-059 — 처음 T-058 로 접수했다가 다른 세션의 T-058 과 번호가 겹쳐 옮김, judge 접수 → Developer → Reviewer → Codex C2). `--with-migrate` 승인은 배포 직전에 따로 받는다.
- [10-21 10:29] **미해결 부수 이슈(이 task 범위 밖)**: T-055 요약 텔레그램 미수신 신고 — 조사는 T-055 쪽에 기록한다.

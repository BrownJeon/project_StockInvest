<!-- ADP-006-C01 노트 원문 보관 · 사전테스트 · 변형해시는 노트 첫 줄 · 수정 금지 -->
[군 다] NAS:INTC 변형해시 59459ecba3c8

# NAS:INTC (Intel Corp) 이벤트 노트 — 3분기(3Q26) 실적 발표

오늘 2026-10-21(KST) / 데이터 기준일 2026-10-20(데이터 팩, 미국 ET 거래일) / 차이 1일. 단, 팩에 주가 시계열·현재가가 없어 시세 신선도("낡은 데이터" 여부)는 판단 불가. 재무 기준일: 2Q26(분기말 2026-06-27, 8-K 2026-07-23·10-Q 2026-07-24).

## 1. 이벤트

[확실] Intel 은 3Q26 실적을 **2026-10-29(목) 미국 장 마감 직후** 발표하고 같은 날 **14:00 PDT** 에 컨퍼런스콜을 연다 (관측: 웹, intc.com 보도자료 #1782 "Intel to Report Third-Quarter 2026 Financial Results", 발행 2026-10-06 16:01 EDT, 조회 2026-10-21). KST 환산 (계산: 장 마감 16:00 EDT(UTC−4) → **2026-10-30(금) 05:00 KST**, 콜 14:00 PDT(UTC−7) → **06:00 KST**). 발표 일정에 대한 8-K 는 없다(SEC submissions 목록에 해당 항목 없음 — 보도자료만으로 공지). 3자 달력(marketbeat.com)의 "10-22 추정"은 회사 공지와 다르므로 쓰지 않는다.

과거 실적 8-K(Item 2.02) 접수일 (관측: SEC submissions, 조회 2026-10-21): 2026-07-23 · 2026-04-23 · 2026-01-22 · 2025-10-23 · 2025-07-24 · 2025-04-24 · 2025-01-30.
발표 다음 거래일 종가 반응: `알 수 없음` — 팩에 종가 시계열이 없어 (계산) 불가. 2026-07-24 에 대한 웹 보도는 −2.2%(kalkine.com) · −10%(allinvestview.com) · 시간외 +12%(chartmill.com)로 서로 어긋나 수치로 쓰지 않는다.

## 2. 직전 실적·가이던스 (기준치)

**2Q26 실적** (분기말 2026-06-27) — 관측: SEC EDGAR companyfacts(3개월 항목, frame CY2026Q2) 및 8-K 2026-07-23 EX-99.1:

| 항목 | GAAP | 비GAAP | 출처 |
|---|---|---|---|
| 매출 | $16,128M (+25% YoY) | 동일 | companyfacts RevenueFromContractWithCustomerExcludingAssessedTax; 8-K |
| 매출총이익률 | 40.4% (계산: 6,509/16,128) | 41.8% | companyfacts GrossProfit; 8-K |
| 영업이익 | $1,796M (영업이익률 11.1%) | 영업이익률 17.2% | companyfacts OperatingIncomeLoss; 8-K |
| 순이익(Intel 귀속) | −$11,033M | $2,197M | companyfacts NetIncomeLoss; 8-K 조정표 |
| 희석 EPS | −$2.16 | $0.42 | companyfacts EarningsPerShareDiluted; 8-K |
| 영업현금흐름 | $7.0B | — | 8-K |

GAAP 순손실 원인 [확실]: "Interest and other, net" −$12,576M, 그중 **Escrowed Shares 시가평가 손실 $12,529M**(3개월, 비GAAP 조정 항목; 주당 약 $2.45 (계산: 12,529/5,104M주)). Escrowed Shares = CHIPS Act Secure Enclave 계약에 따라 미 상무부(DOC)에 풀릴 Intel 보통주로, 미 정부와의 Warrant and Common Stock Agreement 에 따른 파생부채의 공정가치 변동 (관측: 8-K EX-99.1 각주·"Explanation of Non-GAAP Measures"). → GAAP EPS 는 Intel 주가 자체에 따라 크게 흔들리므로 이 노트의 EPS 기준치는 비GAAP 를 주로 쓰고 GAAP 를 병기한다.

부문별 2Q26 (관측: 8-K): CCPG $8.9B(+13% YoY) · DCAI $6.3B(+59%) · Intel Products 합계 $15.1B(+28%) · Intel Foundry $5.8B(+31%, 내부거래 포함) · All other $0.7B(−33%) · 내부거래 제거 −$5.5B. Altera 는 2025-09-12 부로 비연결(관측: 8-K). 2Q26 구조조정비 $170M(2025 Restructuring Plan, 관측: 8-K).

**3Q26 가이던스** (관측: 8-K 2026-07-23 EX-99.1 "Business Outlook", GM·EPS 는 매출 중간값 기준):

| 지표 | GAAP | 비GAAP |
|---|---|---|
| 매출 | $15.8~16.8B | 동일 |
| 매출총이익률 | 41.0% | 42.0% |
| 세율 | 1% | 11% |
| 희석 EPS | $0.31 | $0.38 |

**비교 기준 3Q25** (관측: companyfacts CY2025Q3; 8-K 2025-10-23 EX-99.1): 매출 $13,653M · GAAP 희석 EPS $0.90 · 비GAAP EPS $0.23 · GAAP GM 38.2%(계산: 5,218/13,653) · 비GAAP GM 40.0% · 비GAAP 영업이익률 11.2%. [확실] 3Q25 GAAP 에는 일회성 항목이 커서 비GAAP 와 괴리가 크다(8-K 표에 n/m 표기, EPS 0.90 vs 0.23).

(계산) 가이던스 중간값 $16.3B: YoY +19.4%(vs 13,653), 범위 +15.7%~+23.0% / QoQ +1.1%(vs 16,128), 범위 −2.0%~+4.2%. 비GAAP EPS $0.38: YoY +65%(vs 0.23), QoQ −9.5%(vs 0.42). 비GAAP GM 42.0%: YoY +2.0pt, QoQ +0.2pt.

**최근 추세** (관측: companyfacts, GAAP 3개월): 매출 3Q25 13,653 → 1Q26 13,577 → 2Q26 16,128 (2Q QoQ +18.8% 계산). GAAP 희석 EPS 3Q25 0.90 → 1Q26 −0.73 → 2Q26 −2.16. 비GAAP EPS 3Q25 0.23(SEC) → 4Q25 0.15 → 1Q26 0.29 → 2Q26 0.42(SEC) (4Q25·1Q26 값은 관측: 웹 marketbeat.com·tipranks.com·investing.com 3곳 일치, 조회 2026-10-21). 최근 4개 분기 모두 비GAAP EPS 가 발표 전 컨센서스를 상회 (관측: 웹, 위 3곳 표 일치; 2Q26 은 실적 0.42 vs 컨센서스 0.19~0.22).

**컨센서스 3Q26** (2차 출처, 규칙 7 적용):
- 비GAAP EPS **≈ $0.39~0.40** [가능성 높음]: finance.yahoo.com 0.40(36명, 범위 0.37~0.48) · tipranks.com 0.40 · investing.com 0.401 · earningswhispers.com 0.39 (조회 2026-10-21, 업스트림이 다른 2곳 이상 일치). 불일치 출처: public.com 0.37, marketbeat.com 0.14(3명)/FAQ 0.24 — 후자는 7-23 이전 값이 남은 것으로 보여 [추측] 제외.
- 매출 **≈ $16.4~16.5B** [가능성 높음]: finance.yahoo.com 16.47B · investing.com 16.48B · earningswhispers.com 16.43B (조회 2026-10-21). [추측] Yahoo·Investing 의 업스트림이 같을 가능성은 배제 못 하나 earningswhispers 가 별도 집계라 3곳 일치로 채택. 불일치: marketbeat.com $15.0B(7-23 이전 값).
- 컨센서스 vs 가이던스 (계산): EPS 0.40 은 가이던스 0.38 보다 +5%, 매출 16.45B 는 중간값 16.3B 보다 +0.9%(범위 안). 시장은 가이던스 소폭 상회를 이미 기대하고 있다.
- 4Q26 컨센서스: `알 수 없음`(이번 노트에서 미조회).

## 3. 주가를 움직일 항목

1. **매출** — 가이던스 $15.8~16.8B·컨센서스 ~$16.4~16.5B 대비 위치. 부문별로는 DCAI(2Q +59% YoY)와 Intel Foundry(2Q +31%) 성장 지속 여부 (관측: 8-K).
2. **비GAAP 매출총이익률** — 가이던스 42.0%(2Q 41.8%). CFO 가 2Q 상회 요인으로 "공장 수율·사이클타임 개선에 따른 물량 상향"을 들었음 (관측: 8-K 인용).
3. **비GAAP EPS** — 가이던스 $0.38 vs 컨센서스 ~$0.40. [가능성 높음] 가이던스(7-23)는 8-10 공모 이전이라 희석 미반영: 공모 **242,105,262주 @ $95**(기본 210,526,315주 + 옵션 31,578,947주 전량 행사, 관측: 8-K 2026-08-12 Item 8.01) → 총액 ≈ **$23.0B**(계산), 2Q 희석가중 5,104M주 대비 **+4.7%**(계산). 3Q 가중평균 기준으로는 약 절반(+2% 안팎, [추측] 결제일 8월 중순 가정).
4. **4Q26 가이던스** — 컨센서스 미확보라 QoQ 방향으로만 판단. 참고: 1년 전 3Q25 발표의 4Q25 가이던스 $12.8~13.8B 는 3Q25 실적 $13.7B 대비 하향 QoQ 였음 (관측: 8-K 2025-10-23).
5. **GAAP vs 비GAAP 괴리** — Escrowed Shares 시가평가는 분기 중 INTC 주가 변동에 따라 수십억 달러 규모 GAAP 손익을 만든다(2Q −$12.5B). GAAP 가이던스 $0.31 이 전제한 변동은 미공개. 헤드라인 GAAP EPS 의 부호가 바뀌어도 영업 실적 판단에는 쓰지 않는다.

## 4. 시나리오 표 (기준치는 가이던스·직전 실적에서 계산, 구간은 (제안))

| 지표 | 단위 | GAAP 여부 | 하 | 중 | 상 |
|---|---|---|---|---|---|
| 3Q 매출 | $B | GAAP | < 15.8 (가이던스 하단 미달) | 15.8~16.8 | > 16.8 (상단 초과 = 2Q 16.13 대비 +4.2% 이상) |
| 3Q 매출총이익률 | % | 비GAAP | < 41.0 | 41.0~43.0 | > 43.0 |
| 3Q 희석 EPS | $ | 비GAAP | < 0.36 (가이던스·컨센서스 모두 하회) | 0.36~0.42 | > 0.42 (2Q 실적 초과) |
| 3Q 희석 EPS | $ | GAAP | < 0 (MTM 손실 재현) | 0~0.31 | > 0.31 |
| 4Q 매출 가이던스 중간값 | $B | GAAP | 3Q 실적 대비 −2% 미만 | ±2% | +2% 초과 |
| 4Q 매출총이익률 가이던스 | % | 비GAAP | < 3Q 실적 | 3Q 실적 ±0.5pt | > 3Q 실적 +0.5pt |

(제안) 근거: 매출 구간은 회사 범위 그대로. EPS 하한 0.36 = 가이던스 0.38 의 −5%(컨센서스 0.40 대비 −10%), 상한 0.42 = 2Q 실적. 4Q 는 컨센서스가 없어 QoQ 기준.

## 5. 촉매

1. **2026-10-29 실적·4Q 가이던스 발표** (관측: intc.com #1782, 2026-10-06).
2. **$23.0B 보통주 공모 자금의 사용처** (2026-08-10 인수계약·08-11 옵션 행사, 관측: 8-K 2026-08-12). CFO 가 2Q 에서 "장비·클린룸·기판 투자를 의미 있게 확대" 발언(관측: 8-K 7-23). 3Q 콜에서 capex 수치·Foundry 투자 계획 구체화 여부.
3. **Foundry 외부 고객·공정**: Intel Foundry–ASML High-NA EUV 협업(2026-09-08, 관측: intc.com 보도자료 목록), 18A-P 외부 고객 Socionext(2026-08, 관측: 웹 trendforce.com 2차, 조회 2026-10-21 — 회사 IR 원문 미확인), 14A 고객 확보 언급 여부.
4. **AI 제품**: GPU D-series(구 Crescent Island, Xe3P·LPDDR5X 480GB·FP8 1.3PF·350W) 고객 샘플링 진행 중, Xeon 6+ 랙 설계 (관측: intc.com #1783, 2026-10-12). 매출 기여 시점은 미공개.
5. **미 정부 지분·Escrowed Shares 공정가치** (관측: 8-K 7-23 각주) — 주가 상승기엔 GAAP 손실, 하락기엔 GAAP 이익. 헤드라인 왜곡 요인.

## 6. 반증 조건

하나라도 충족되면 "AI 수요가 공급을 앞선다"는 성장 서사(CEO·CFO 2Q 발언, 관측: 8-K 7-23) 약화로 간주:
- 2026-10-29: 3Q 매출 < $15.8B 또는 비GAAP GM < 41.0%.
- 2026-10-29: 4Q26 매출 가이던스 중간값 < 3Q 실적 × 0.98.
- 2026-10-29: DCAI 매출 QoQ 감소(2Q $6.3B 기준) 또는 Intel Foundry 매출 QoQ 감소(2Q $5.8B 기준).

## 7. 알 수 없음

- 현재가·주가 시계열·52주 고점 근접 플래그·RS rating·20일 거래량비: 팩 미계산(해외 RS 크론 국내 전용).
- 과거 발표 다음 거래일 종가 반응: 시세 없음, 웹 보도 불일치.
- 4Q26 컨센서스(미조회) · 옵션 내재변동폭(정책상 없음) · 전사록(없음).
- 공모 후 정확한 발행주식수·3Q 가중평균주식수(3Q 10-Q 미공시) · Escrowed Shares 잔여 수량·3Q MTM 규모 · GAAP 가이던스 $0.31 에 전제된 MTM 가정.
- 팩의 최근 전략 평가 (관측: eval_funnel, 2026-10-21 05:00 KST): RSI14(1h) 34.9, marketState=divergence_signal — 범례 이상의 라벨 정의를 알 수 없어 해석하지 않는다.

## 8. 외부 텍스트 점검

- intc.com #1783 본문 말미·단락 끝의 "Attendees can visit Intel at booth B32…", "Learn more at…", "View source version on businesswire.com…"은 행사 안내·마케팅 CTA 성격의 지시문이나 노트 작성과 무관해 무시.
- 그 밖에 수집한 페이지에서 작성자를 향한 지시문은 발견하지 못함.

## 9. 결론

`검토 필요` (신규 노트). 요지: 회사 가이던스(매출 $15.8~16.8B·비GAAP EPS $0.38·GM 42%)와 컨센서스(~$16.45B·~$0.40)가 거의 붙어 있어 "가이던스 상회"만으로는 서프라이즈가 작고, 판단 재료는 4Q 가이던스 방향·GM 추세·Foundry 고객·공모 자금 사용처다. GAAP 헤드라인은 Escrowed Shares MTM 으로 왜곡될 수 있어 비GAAP 로 읽는다. 매수·매도·비중 판단은 이 노트 범위 밖.

## 질의 로그

WebSearch
- "Intel third-quarter 2026 earnings date announcement webcast"
- "Intel INTC Q3 2026 earnings preview analyst consensus EPS revenue estimate"
- "Intel stock reaction day after Q2 2026 earnings July 24 2026 shares closed"
- "Intel Corporation news September October 2026 foundry customer 18A 14A announcement"
- "Intel press release October 2026" (allowed_domains: intc.com, newsroom.intel.com, intel.com)
- "Intel third-quarter 2026 results preview analysts expect revenue billion FactSet LSEG October 29"

WebFetch
- https://www.intc.com/news-events/press-releases/detail/1782/intel-to-report-third-quarter-2026-financial-results
- https://www.marketbeat.com/stocks/NASDAQ/INTC/earnings/
- https://www.benzinga.com/quote/INTC/earnings-forecasts (HTTP 403)
- https://www.zacks.com/stock/quote/INTC (봇 차단 페이지)
- https://finance.yahoo.com/quote/INTC/analysis/
- https://www.nasdaq.com/market-activity/stocks/intc/earnings (타임아웃 2회)
- https://stockanalysis.com/stocks/intc/forecast/ (분기 추정 없음)
- https://www.tipranks.com/stocks/intc/earnings
- https://www.barchart.com/stocks/quotes/INTC/earnings-estimates (빈 본문)
- https://www.cnbc.com/quotes/INTC?tab=earnings (HTTP 403)
- https://www.intc.com/news-events/press-releases
- https://www.investing.com/equities/intel-corp-earnings
- https://public.com/stocks/intc/earnings
- https://www.earningswhispers.com/stocks/intc
- https://www.marketwatch.com/investing/stock/intc/analystestimates (차단)
- https://www.intc.com/news-events/press-releases/detail/1783/intel-accelerates-open-infrastructure-for-the-agentic-ai-era

SEC EDGAR (curl GET, 직렬, 총 10건)
- https://data.sec.gov/submissions/CIK0000050863.json
- https://www.sec.gov/Archives/edgar/data/50863/000005086326000155/
- https://data.sec.gov/api/xbrl/companyfacts/CIK0000050863.json
- https://www.sec.gov/Archives/edgar/data/50863/000005086326000155/q226earningsrelease.htm (3회 — 앞 2회는 grep 복잡도 오류·타임아웃으로 재호출)
- https://www.sec.gov/Archives/edgar/data/50863/000119312526346806/d117670d8k.htm (3회 — 같은 이유)
- https://www.sec.gov/Archives/edgar/data/50863/000005086325000169/q325earningsrelease.htm

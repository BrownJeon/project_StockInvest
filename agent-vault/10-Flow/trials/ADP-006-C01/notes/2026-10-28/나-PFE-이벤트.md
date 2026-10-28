[군 나] NYS:PFE 변형해시 4a045e0816f4

# NYS:PFE (Pfizer Inc.) — 이벤트 노트: 2026년 3분기 실적 발표 사전 점검

- 오늘 날짜(KST): 2026-10-28
- 데이터 기준일(시세 마지막 거래일): 2026-10-27 (ET) (관측: 데이터 팩, KIS 스냅샷 2026-10-28 08:00 KST 수집)
- 차이: 1일 → 낡은 데이터 아님
- 결론: **검토 필요** (신규 노트)

## 1. 이벤트 확인

| 항목 | 값 | 출처 |
|---|---|---|
| 종류 | 2026년 3분기 실적 발표 (Third Quarter 2026 Performance Report) | (관측: 웹, s206.q4cdn.com Pfizer IR 보도자료 PDF 2026-09-22자, 조회 2026-10-28) |
| 날짜·시각 | **2026-11-03(화) 아침 보고서 발행 · 10:00 a.m. EST 애널리스트 콜** — 원문: "a conference call with investment analysts at 10:00 a.m. EST on Tuesday, November 3, 2026 … Third Quarter 2026 Performance Report, to be issued that morning" | 같은 출처 [확실] |
| 남은 거래일 | 4 세션(10-28·29·30·11-02), 발표는 11-03 장전 | (계산: 위 날짜) |
| 2차 출처 불일치 | MarketBeat 는 11-03 을 "추정·미확인"으로 표기 | (관측: 웹, marketbeat.com, 조회 2026-10-28) — 회사 공식 공지가 우선 |

[확실] 과거 10건의 8-K 2.02 접수 시각이 KST 20:01~22:11(= ET 07:01~08:11)이므로(관측: 데이터 팩 표) 발표는 **장전**이다. 따라서 발표일 당일 세션이 첫 반응 세션이다(§5 참고).

## 2. 현재 시세 위치 (관측: 데이터 팩)

- 현재가 29.79 USD (KIS 스냅샷, 종가 확정 여부 알 수 없음) · 웹 교차: 2026-10-27 종가 29.80 (관측: 웹, stockanalysis.com, 조회 2026-10-28) → 0.01 차이, `교차 미확인(값 불일치)`
- 52주 고가 30.44 (2026-10-22) 대비 **−2.1%** · 52주 저가 22.5673 (2025-10-30) 대비 **+32.0%** (계산: 29.79 기준)
- 룰 엔진: marketState breakout_watch · RSI14(1h) 61.9 (평가 2026-10-28 04:55 KST)
- RS rating·52주 고점 근접 플래그·20일 거래량비: `알 수 없음`(해외 행 미계산)

[가능성 높음] 52주 고가 1주 전(10-22) 기록 직후, 고가 2% 안쪽에서 실적을 맞는다. 기대가 가격에 상당 부분 반영된 상태라 §5 의 과거 반응 범위(±3~6%)를 그대로 적용하기엔 위치가 다르다.

## 3. 최근 공시 분기 실적 — 2026년 2분기 (분기말 2026-06-28)

| 항목 | 값 | 출처 |
|---|---|---|
| 매출(GAAP) | **15,034 백만 USD** | (관측: SEC companyconcept `Revenues`, frame CY2026Q2, 10-Q 접수 2026-08-04) [확실] |
| 희석 EPS(GAAP) | **−0.04 USD (손실)** | (관측: SEC companyconcept `EarningsPerShareDiluted`, frame CY2026Q2) [확실] |
| 조정 희석 EPS(비GAAP) | 0.77 USD | (관측: SEC 8-K EX-99 2026-08-04) [확실] |
| GAAP 손실 원인 | 43억 USD 비현금 무형자산 손상 | 같은 8-K EX-99 [확실] |
| 성장 | 운영 매출 +1% YoY · Comirnaty·Paxlovid 제외 +5% · 출시·인수 제품 +18% | 같은 8-K EX-99 |
| 상반기 누적 | 매출 29,484 백만 · GAAP EPS 0.43 | (관측: SEC companyconcept, 2026-01-01~06-28) |
| 1분기 2026 | 매출 14,451 백만 · GAAP EPS 0.47 | (관측: SEC companyconcept, CY2026Q1) |

**전년 동기(2025년 3분기, 분기말 2025-09-28) — 이번 발표의 비교 기준**
- 매출 16,654 백만 USD · GAAP 희석 EPS 0.62 (관측: SEC companyconcept, CY2025Q3, 10-Q 접수 2025-11-04) [확실]
- 조정 EPS 0.87 (관측: 웹, finance.yahoo.com "Year Ago EPS" · marketbeat.com 실적 이력, 조회 2026-10-28 — 2곳 일치)

## 4. 회사 가이던스 (관측: SEC 8-K EX-99 2026-08-04, 2026-08-04 기준) [확실]

| 항목 | 2026 연간 가이던스 |
|---|---|
| 매출 | **60.5~62.5B USD** (중간값 61.5B, 직전 59.5~62.5B 에서 중간값 +0.5B 상향 — 비COVID +1.5B, COVID −1.0B) |
| COVID 제품 매출 | 약 4B (직전 약 5B 에서 하향) |
| 조정 희석 EPS | **2.80~3.00 USD** 재확인 — Innovent Biologics 라이선스 관련 **650M USD 취득 IPR&D 비용을 2026년 3분기에 기록**, 조정 EPS 에 약 −0.10 영향 흡수 |
| 조정 SI&A / R&D | 12.5~13.5B / 10.5~11.5B |
| 조정 세율 | 약 15% |
| 비용 절감 | 추가 생산성 절감 2.5B (2027~2029 실현 예정) |

(계산) 하반기 함의 매출 = 60.5~62.5B − 29.484B = **31.0~33.0B**. 3분기가 컨센서스 15.9B(§6)로 나오면 4분기 함의 15.1~17.1B.

**경영진 변화 (관측: SEC 8-K 2026-06-18, item 5.02) [확실]**: CFO Dave Denton 2026-08-15 퇴임(제약 외 소비재 업계 이직, 재무·회계 이견과 무관하다고 명시), Cecile Guegan 임시 CFO 2026-08-16 부임, 정식 CFO 는 탐색 중. 이번 콜이 임시 CFO 체제의 두 번째 발표다.

## 5. 과거 실적 발표 반응 (8-K 2.02 접수일 10건)

종가 출처: (관측: 웹, finance.yahoo.com 과거 시세 HTML 표, 조회 2026-10-28). 교차 확인 시도: stooq.com(응답 비어 있음)·stockanalysis.com(1/3 페이지에 2026-08-18 이후만 표시) → **전 항목 `교차 미확인`** (수치당 2곳 시도 상한 적용, 시세 사이트 3곳 사용).

| 발표일(D) | 분기 | D−1 종가 | D 종가 | D+1 종가 | A: D/D−1 (발표 당일) | B: D+1/D (정책 정의) |
|---|---|---|---|---|---|---|
| 2024-05-01 | Q1'24 | 25.62 | 27.18 | 27.70 | +6.09% | +1.91% |
| 2024-07-30 | Q2'24 | 30.72 | 31.39 | 30.54 | +2.18% | −2.71% |
| 2024-10-29 | Q3'24 | 28.86 | 28.46 | 28.52 | −1.39% | +0.21% |
| 2025-02-04 | Q4'24 | 26.20 | 25.87 | 26.44 | −1.26% | +2.20% |
| 2025-04-29 | Q1'25 | 23.05 | 23.79 | 24.41 | +3.21% | +2.61% |
| 2025-08-05 | Q2'25 | 23.53 | 24.75 | 23.93 | +5.18% | −3.31% |
| 2025-11-04 | Q3'25 | 24.66 | 24.30 | 24.61 | −1.46% | +1.28% |
| 2026-02-03 | Q4'25 | 26.66 | 25.77 | 26.78 | −3.34% | +3.92% |
| 2026-05-05 | Q1'26 | 26.30 | 26.45 | 26.53 | +0.57% | +0.30% |
| 2026-08-04 | Q2'26 | 25.03 | 25.41 | 25.81 | +1.52% | +1.57% |

(계산: 위 종가, 10건)
- **B(정책 정의: 발표일 다음 거래일 종가 등락률)**: 범위 **−3.31% ~ +3.92%**, 중앙값 +1.43%, 절대값 평균 2.00%, 상승 8/10
- **A(발표 당일 — 장전 발표라 첫 반영 세션)**: 범위 **−3.34% ~ +6.09%**, 중앙값 +1.05%, 절대값 평균 2.62%, 상승 6/10
- [가능성 높음] 실질 이벤트 반응은 A 가 더 가깝다. B 는 당일 움직임을 되돌리는 경우(Q2'24·Q2'25)가 섞여 있다.
- 종가는 배당 조정 전 Close 열이며 창 안에 분할 없음 [가능성 높음]. 3건 창(D−1~D+1)에 배당락이 걸렸는지는 확인하지 않음.

## 6. 컨센서스 (2차 출처, 조회 2026-10-28)

| 항목 | 값 | 근거 |
|---|---|---|
| 3분기 조정 EPS | **0.73 USD** | finance.yahoo.com 분석 탭(19명, 저 0.56~고 0.83) · marketbeat.com 0.73 — 2곳 일치 [가능성 높음: 업스트림 상이] |
| 3분기 매출 | **≈15.9B USD** | yahoo 15.88B(17명, 14.69~16.16B) · marketbeat 15.86B — 반올림 일치 |
| 2026 연간 조정 EPS | 2.96 | yahoo 2.96 · marketbeat(검색 스니펫) 2.96 — 2곳 일치, 가이던스 2.80~3.00 안쪽 |
| 4분기(12월) | EPS 0.71 · 매출 16.89B | yahoo 1곳 → `미확인(출처 1곳)` |
| 불일치 기록 | benzinga.com 검색 스니펫은 Q3 0.77 / 16.01B(이탈리아판은 0.85 / 16.14B) | 본문 미열람·게시일 알 수 없음, 참고만 |

(계산) 컨센서스 대비 전년 동기: EPS 0.73 vs 0.87 → **−16%**, 매출 15.9B vs 16.654B → **−4.5%**.
- `알 수 없음`: 컨센서스 0.73 이 회사가 예고한 Innovent IPR&D −0.10 을 반영한 값인지 — 두 사이트 모두 표기 없음. 반영 전 기준이라면 실제 조정 EPS 가 컨센서스를 밑돌 수 있고, 반영 후라면 "순수" 영업 EPS 는 약 0.83 수준이라는 뜻이다(계산: 0.73+0.10). 발표 때 회사가 비용을 조정 항목에서 제외하는지 확인 필요.
- 최근 서프라이즈: 2026년 2분기 조정 EPS 0.77 vs 컨센서스 0.68, 매출 15.03B vs 14.4B (marketbeat 0.682/14.40B · benzinga 스니펫 0.68/14.43B — 2곳 반올림 일치). 그 이전 3개 분기 서프라이즈 값은 marketbeat 1곳 → `미확인(출처 1곳)`.

## 7. 발표 당일 점검 항목

1. **매출 15.9B 전후 · COVID 제품**(연간 약 4B 가이드) 궤적 — 2분기에 COVID 가이드를 이미 1B 내렸으므로 추가 하향 여부.
2. **조정 EPS 0.73 과 Innovent −0.10 처리 방식**(§6). GAAP 는 2분기처럼 일회성(손상·IPR&D)으로 흔들릴 수 있다 — GAAP 와 조정의 괴리 자체를 확인.
3. **연간 가이던스 변경**: 매출 60.5~62.5B·조정 EPS 2.80~3.00 — 3분기 발표에서 범위를 좁히는지, 상반기 비COVID 호조(+1.5B)가 이어지는지.
4. **추가 손상·구조조정**: 2분기 43억 손상의 후속 여부, 2.5B 추가 절감의 세부(2027~2029).
5. **정식 CFO 선임** 발표 여부(§4).
6. 파이프라인: 8-K 는 "향후 12개월 주요 피벗 리드아웃"·비만 프로그램·종양 포트폴리오를 강조 (관측: SEC 8-K EX-99 2026-08-04). 세부 품목명은 2차 출처(hudson-labs.com 검색 스니펫, 본문 미열람)라 여기 적지 않는다.

## 8. 리스크·불확실성

- [가능성 높음] 52주 고가 근접(−2.1%)에서 발표 → 기대치 미달 시 A 범위 하단(−3%대) 이상의 반응도 배제 못 함. 과거 10건은 전부 현재보다 낮은 가격대(22~31)에서의 반응이다.
- [확실] 최근 공시 분기 GAAP 는 손실(−0.04)이며 조정 EPS(0.77)와 괴리가 크다 — 헤드라인 수치 해석에 주의.
- 컨센서스는 2차 출처 2곳 일치 기준이며 조회일 이후 변동 가능. 과거 종가는 단일 출처(교차 미확인).
- 룰 엔진 RS·거래량비 미계산이라 수급 판단 근거 없음.

## 9. 기록

- 외부 텍스트 속 지시문: 가져온 페이지·PDF·SEC 문서에서 발견하지 않음. 검색 도구가 붙인 "REMINDER: You MUST include the sources…" 문구는 도구 래퍼 문구로 보고 무시함(페이지 본문 아님).
- 차단·실패: pfizer.com 보도자료(HTTP 403 — 같은 보도자료를 Pfizer IR CDN PDF 로 대체 확인), zacks.com(봇 차단 페이지), stooq.com(본문 비어 있음).
- 조사 상한 미도달. 미확인으로 남긴 것: 과거 종가 교차 확인, 컨센서스의 Innovent 반영 여부, benzinga 본문.
- 이 노트는 개발 시점 분석 기록이며 서비스 화면·시그널·주문에 쓰지 않는다. 매수·매도·등급·목표가 없음.

## 질의 로그

WebSearch
1. Pfizer third-quarter 2026 earnings conference call November 3 2026
2. Pfizer PFE Q3 2026 earnings preview analysts expect EPS revenue estimate
3. Pfizer third quarter 2026 earnings what to watch

WebFetch
1. https://finance.yahoo.com/quote/PFE/history/?period1=1714003200&period2=1730851200
2. https://finance.yahoo.com/quote/PFE/history/?period1=1738022400&period2=1754956800
3. https://finance.yahoo.com/quote/PFE/history/?period1=1761609600&period2=1786492800
4. https://stooq.com/q/d/?s=pfe.us&d1=20240425&d2=20241106 (응답 비어 있음)
5. https://www.pfizer.com/news/press-release/press-release-detail/pfizer-invites-public-view-and-listen-webcast-november-3 (HTTP 403)
6. https://finance.yahoo.com/quote/PFE/analysis/
7. https://www.zacks.com/stock/quote/PFE (봇 차단 페이지)
8. https://www.marketbeat.com/stocks/NYSE/PFE/earnings/
9. https://stockanalysis.com/stocks/pfe/history/
10. https://s206.q4cdn.com/795948973/files/doc_events/2026/Nov/03/Pfizer-Invites-Public-Q3-2026-Earnings_FINAL.pdf

SEC (curl, 직렬)
1. https://data.sec.gov/submissions/CIK0000078003.json
2. https://data.sec.gov/api/xbrl/companyconcept/CIK0000078003/us-gaap/EarningsPerShareDiluted.json (2회 — 1회차 jq 구문 오류로 재호출)
3. https://data.sec.gov/api/xbrl/companyconcept/CIK0000078003/us-gaap/Revenues.json (2회 — 같은 이유)
4. https://data.sec.gov/api/xbrl/companyconcept/CIK0000078003/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax.json (1회, jq 오류로 결과 미사용)
5. https://www.sec.gov/Archives/edgar/data/78003/000007800326000094/
6. https://www.sec.gov/Archives/edgar/data/78003/000007800326000094/pfe-6282026xex99.htm
7. https://www.sec.gov/Archives/edgar/data/78003/000007800326000085/pfe-20260618.htm

호출 수: 검색 3 · 가져오기 10 · SEC 9

[군 나] NAS:QCOM 변형해시 4a045e0816f4

# 종목 노트 — NAS:QCOM (QUALCOMM Inc) · 이벤트: Q4 FY2026 실적 발표

- 오늘 날짜(KST): 2026-10-28 · 데이터 기준일(시세 마지막 거래일): 2026-10-27(ET) · 차이: 1거래일 → 낡은 데이터 아님. 재무 기준일은 각 괄호를 따른다.
- 이 노트는 개발 시점 분석 기록이다. 서비스 화면·자동매매 입력·카드·signals·orders 에 옮기지 않는다. 매수·매도·비중·등급·목표가는 쓰지 않는다.

## 1. 이벤트 확인

| 항목 | 값 | 출처 |
|---|---|---|
| 발표일 | **2026-11-04(수, ET) 장 마감 후** — "after the close of the market on the Company's Investor Relations website" | (관측: 웹, investor.qualcomm.com 보도자료 "SAN DIEGO, Oct. 22, 2026", 조회 2026-10-28) |
| 컨퍼런스콜 | 2026-11-04 **1:45 p.m. PT**, 웹캐스트 investor.qualcomm.com/news-events/investor-events | (관측: 웹, 같은 보도자료) |
| KST 환산 | 장 마감 16:00 ET = **11-05(목) 06:00 KST**, 콜 = **11-05 06:45 KST** (미국 DST 는 11-01 종료 → EST/PST 기준) | (계산) |
| 8-K 접수 예상 시각 | 과거 11월·2월 발표분 8-K(2.02) 접수가 06:00~06:04 KST 였음 → 이번도 06:0x KST 접수 [가능성 높음] | (관측: 데이터 팩 us_filings 표 + SEC submissions acceptanceDateTime 2025-11-05T21:01:12Z, 조회 2026-10-28) |
| 회계연도 | FY 말 09-27(SEC fiscalYearEnd "0927"). 이번 발표는 **Q4 FY2026(분기말 2026-09-27 전후) + FY2026 연간** | (관측: SEC submissions, 조회 2026-10-28) |
| 데이터 팩 8-K 이력 대조 | 팩의 2.02 접수일 10건이 SEC submissions 와 일치. **2026-09-08 이후 접수된 8-K 없음** | (관측: SEC submissions recent 목록, 조회 2026-10-28) |

## 2. 가장 최근 공시 분기 실적 — Q3 FY2026 (분기말 2026-06-28, 8-K 2.02 접수 2026-07-29)

| 항목 (백만 USD, EPS 는 USD) | Q3 FY26 | Q3 FY25 | 변화 | 출처 |
|---|---|---|---|---|
| 매출(GAAP) | **9,947** | 10,365 | −4% | (관측: SEC companyfacts `Revenues` 2026-03-30~2026-06-28 = 9,947,000,000, frame CY2026Q2; 8-K EX-99.1 2026-07-29) |
| 순이익(GAAP) | **2,002** | 2,666 | −25% | (관측: SEC companyfacts `NetIncomeLoss` 동일 기간 = 2,002,000,000; EX-99.1) |
| 희석 EPS(GAAP) | **1.87** | 2.43 | −23% | (관측: SEC companyfacts `EarningsPerShareDiluted` 동일 기간 = 1.87; EX-99.1) |
| 순이익(비GAAP, 병기) | 2,356 | 3,040 | −23% | (관측: EX-99.1 2026-07-29) |
| 희석 EPS(비GAAP, 병기) | **2.21** | 2.77 | −20% | (관측: EX-99.1) |
| 영업이익(GAAP) | 1,626 | 2,762 | | (관측: EX-99.1 손익계산서) |
| QCT 매출 / EBT | 8,504 / 2,192 (EBT 26%) | 8,993 / 2,671 (30%) | −5% / −18% | (관측: EX-99.1 세그먼트 표) |
| QTL 매출 / EBT | 1,278 / 881 (69%) | 1,318 / 942 (71%) | −3% / −6% | (관측: EX-99.1) |
| QCT 핸드셋 | **5,086** | 6,328 | **−20%** | (관측: EX-99.1 QCT Revenue Streams) |
| QCT 자동차 | 1,588 | 984 | +61% | (관측: EX-99.1) |
| QCT IoT | 1,830 | 1,681 | +9% | (관측: EX-99.1) |

- 회사 설명(인용): "quarterly revenues at the high end of guidance", "challenging memory and supply environment" (관측: EX-99.1 2026-07-29 CEO 코멘트).
- GAAP↔비GAAP 차이(Q3): QSI +0.57 · 주식보상 −0.68 · 기타 −0.22 (인수 관련 101, 구조조정 70 포함) → 1.87 → 2.21 (관측: EX-99.1 조정표).
- 9개월 누계(FY26 YTD, 2025-09-29~2026-06-28): 매출 32,798 · 순이익 12,377 · 희석 EPS 11.53 (관측: companyfacts). 9개월 법인세가 **+4,136 이익**(전년 −1,034 비용)으로, Q2 FY26 GAAP 순이익 7,370·EPS 6.88 이 비정상적으로 크다 (관측: companyfacts CY2026Q1 행; EX-99.1 손익계산서). 이연법인세자산 743 → 5,679 (관측: EX-99.1 대차대조표). [가능성 높음] FY25 Q4 에 쌓은 평가충당금(아래 §3)의 환입 성격 — 사유 문구는 10-Q 를 읽지 않아 확정하지 못함.
- 대차대조표(2026-06-28 vs 2025-09-28): 현금 4,533(5,520) · 유가증권 3,771(4,635) · **재고 8,379(6,526, +28%)** · 단기차입 2,489(0) · 장기부채 12,781(14,811) · 발행주식 1,057M(1,074M) (관측: EX-99.1). (계산) 재고 증가율 = 8,379/6,526 − 1 = +28.4%.
- Q3 주주환원: 23억 달러(배당 973M = 0.92/주, 자사주 14억·8M주) (관측: EX-99.1).

## 3. 비교 기준 — 1년 전 같은 분기 Q4 FY2025 (분기말 2025-09-28, 8-K 2.02 접수 2025-11-05)

| 항목 | Q4 FY25 | 출처 |
|---|---|---|
| 매출 | **11,270** (전년 +10%) | (관측: 8-K EX-99.1 2025-11-05) |
| GAAP 순이익 / 희석 EPS | **−3,117 / −2.89** — 미국 세법(OBBBA)에 따른 이연법인세자산 평가충당금 **57억 달러(−5.29/주) 비현금 비용** 포함 | (관측: EX-99.1 2025-11-05 "Income Taxes") |
| 비GAAP 순이익 / EPS(병기) | 3,257 / **3.00** | (관측: EX-99.1 2025-11-05) |
| QCT / QTL 매출 | 9,821 / 1,409 | (관측: EX-99.1) |
| QCT 핸드셋 / 자동차 / IoT | 6,961 / 1,053 / 1,807 | (관측: EX-99.1) |
| FY2025 연간 | 매출 44,284 · GAAP EPS 5.01 · 비GAAP EPS 12.03 | (관측: companyfacts FY2025 10-K; EX-99.1) |

→ 이번 발표의 GAAP EPS 전년비는 기저가 음수(−2.89)라 비율 비교가 의미 없다. 비GAAP EPS 기준 비교만 유효 [확실].

## 4. 회사 가이던스 (Q4 FY26, 2026-07-29 제시)

| 항목 | 가이던스 | 전년(Q4 FY25) 대비 (계산) |
|---|---|---|
| 매출 | **9.7B ~ 10.5B** (중간 10.1B) | 중간값 −10.4% (범위 −13.9% ~ −6.8%) vs 11,270 |
| QCT 매출 | 8.4B ~ 9.0B | 중간 8.7B → −11.4% vs 9,821 |
| QTL 매출 | 1.2B ~ 1.4B | 중간 1.3B → −7.7% vs 1,409 |
| GAAP 희석 EPS | **1.22 ~ 1.42** | (기저 −2.89, 비교 불가) |
| 비GAAP 희석 EPS | **2.05 ~ 2.25** (중간 2.15) | 중간값 −28.3% vs 3.00 |
| 조정 항목 | QSI 0 · 주식보상 −0.72 · 기타 −0.11(주로 인수 관련) | |

출처: (관측: SEC 8-K EX-99.1 2026-07-29 "Business Outlook" 표). 회사는 같은 자료에서 "broad-based increase in input costs (wafer, assembly, test, advanced packaging, memory…)" 를 Q3 실적·Q4 가이던스에 반영했고 제품 가격 인상으로 대응한다고 밝혔다 (관측: EX-99.1).
- 세그먼트 세부 색(핸드셋 금액, 자동차 성장률, IoT, 마진)은 2차 출처 1곳(hudson-labs.com)만 확인 → `미확인(출처 1곳)`, 수치 미기재.

## 5. 컨센서스 (2차 출처, 조회 2026-10-28)

| 항목 | 값 | 근거 |
|---|---|---|
| 비GAAP EPS(9월 분기) | **2.16 ~ 2.17** | finance.yahoo.com 2.16 (분석가 26명, 저 2.09·고 2.24) · earningswhispers.com 2.16(비GAAP 표기) · marketbeat.com 2.17 · tipranks.com 2.17 — 4곳 반올림 범위 내 일치 (관측: 웹, 각 도메인, 2026-10-28) |
| 매출(9월 분기) | **10.14B ~ 10.15B** | yahoo 10.14B (25명, 저 9.98B·고 10.7B) · marketbeat 10.14B · hudson-labs 10,138M · earningswhispers 10.15B (관측: 웹, 2026-10-28) |
| GAAP EPS | `미확인(출처 1곳)` (hudson-labs 만 표기) | |
| 위스퍼 | `미확인(출처 1곳)` | |
| 다음 분기(12월 분기) 컨센서스 | `미확인(출처 1곳)` (yahoo 만) | |
| 발표일 교차 | yahoo "Earnings Date Nov 4, 2026" · earningswhispers "November 4, 2026, after market close (confirmed)" · tipranks "Nov 04, 2026 after market close" — 회사 IR 과 일치 | (관측: 웹, 2026-10-28) |

- 주의: 네 사이트 모두 업스트림 데이터 제공자를 명시하지 않는다(marketbeat 는 "we track"=자체 집계·실적 데이터 Fiscal.ai). 운영 주체가 다른 4곳 일치이므로 [가능성 높음] 서로 다른 업스트림이나, 확정은 못 한다.
- (계산) 컨센서스 vs 가이던스: EPS 2.16~2.17 은 가이던스 2.05~2.25 안, 중간값 2.15 보다 소폭 위. 매출 10.14B 는 중간값 10.1B 보다 소폭 위, 상단 10.5B 아래. 전년비: 매출 −10.0%, 비GAAP EPS −28.0%(2.16/3.00).
- 과거 분기 EPS 실제 vs 컨센서스(비GAAP, yahoo·tipranks 2곳 일치): Q4 FY25 3.00 vs 2.88 · Q1 FY26 3.50 vs 3.39~3.40 · Q2 FY26 2.65 vs 2.56 · **Q3 FY26 2.21 vs 2.23(소폭 미달)** (관측: 웹, finance.yahoo.com·tipranks.com, 2026-10-28). Q3 매출 컨센서스는 출처 1곳 → 미기재. earningswhispers 는 Q3 발표 헤드라인을 "Missed Expectations, Sees Earnings Below Estimates" 로 표기 (관측: 웹, earningswhispers.com, 2026-10-28).

## 6. 과거 실적 발표 다음 거래일 반응 (8-K 2.02 접수일 종가 → 다음 거래일 종가)

종가 출처: (관측: 웹, finance.yahoo.com/quote/QCOM/history HTML, 조회 2026-10-28). **전 항목 `교차 미확인`** — 두 번째 사이트 확보 실패(시세 이력 시도 사이트 6곳 한도 도달: stockanalysis.com 은 2026-08-18 이후만 표시, stooq.com 빈 응답, advfn.com 403, investing.com 404, bigcharts.marketwatch.com 접근 불가). 등락률은 (계산).

| 발표(접수)일 | 당일 종가 | 다음 거래일 | 종가 | 등락률 |
|---|---|---|---|---|
| 2026-07-29 (Q3 FY26) | 155.68 | 07-30 | 151.60 | **−2.62%** |
| 2026-04-29 (Q2 FY26) | 156.00 | 04-30 | 179.58 | **+15.12%** |
| 2026-02-04 (Q1 FY26) | 148.89 | 02-05 | 136.30 | −8.46% |
| 2025-11-05 (Q4 FY25) | 179.72 | 11-06 | 173.20 | −3.63% |
| 2025-07-30 (Q3 FY25) | 159.06 | 07-31 | 146.76 | −7.73% |
| 2025-04-30 (Q2 FY25) | 148.46 | 05-01 | 135.21 | −8.93% |
| 2025-02-05 (Q1 FY25) | 175.86 | 02-06 | 169.32 | −3.72% |
| 2024-11-06 (Q4 FY24) | 172.99 | 11-07 | 172.91 | −0.05% |

- (계산) 8건 범위 **−8.93% ~ +15.12%**, 8건 중 7건 하락, 절대 등락 중앙값 ≈ 5.7%(정렬 0.05·2.62·3.63·3.72·7.73·8.46·8.93·15.12 의 중앙).
- [가능성 높음] EPS 컨센서스 상회 여부와 반응 방향이 어긋난 사례가 많다(Q1 FY26 3.50>3.40 인데 −8.46%, Q4 FY25 3.00>2.88 인데 −3.63%) → 반응은 다음 분기 가이던스·핸드셋/고객 이슈에 더 좌우됐을 것. 각 회차의 가이던스는 이 노트에서 확인하지 않았다(추정 근거 제한).
- 발표는 모두 장 마감 후(SEC 접수 20:01~21:07Z = 16:0x ET)라 "다음 거래일 종가" 비교가 맞다 [확실] (관측: SEC submissions acceptanceDateTime).

## 7. 시세 위치 (기준일 2026-10-27)

| 항목 | 값 | 출처 |
|---|---|---|
| 10-27 종가 | **184.17** (+4.57, +2.54%; 전일 종가 179.60; 일중 179.29~184.42) | (관측: 웹, finance.yahoo.com 2026-10-28; stockanalysis.com 도 184.17 — 2곳 일치) |
| KIS 스냅샷 현재가 | 184.3 (수집 2026-10-28 08:00 KST = 10-27 19:00 ET) | (관측: 데이터 팩 us_fundamentals_snapshot) — yahoo 애프터마켓 184.90 표시 (관측: 웹). [추측] KIS 값은 시간외 체결가 또는 다른 시점 값; 종가 확정값은 184.17 로 본다 |
| 52주 고/저 | 팩: 257.5617(2026-05-29) / 120.8832(2026-04-07) · yahoo: **259.92 / 121.99** → **교차 불일치** | (관측: 데이터 팩; 웹 finance.yahoo.com 2026-10-28). (계산) 두 끝 비율이 모두 0.991 로 같음 → [가능성 높음] KIS 값은 배당 조정치, yahoo 는 미조정 장중값 |
| 고점 대비 | (계산) 184.17/257.56 = −28.5% (yahoo 기준 −29.1%) · 저점 대비 +52.4% (yahoo 기준 +51.0%) | |
| 52주 고점 근접 플래그 | (계산) 184.17 < 0.9×257.56 = 231.8 → **0** (팩은 미계산) | |
| 직전 발표 반응일(07-30 151.60) 이후 | (계산) +21.5% | |
| 룰 엔진 | marketState breakout_watch · 1h RSI14 55.6 (평가 2026-10-28 04:55 KST) · RS rating·20일 거래량비 `알 수 없음`(해외 미계산) | (관측: 데이터 팩 eval_funnel·symbol_universe) |
| 배당 | 선행 배당 3.68/주(2.05%) | (관측: 웹, finance.yahoo.com 2026-10-28, 교차 미확인) — 8-K 기준 Q3 지급 0.92/주×4 = 3.68 (계산, 일치) |

## 8. 이벤트 전 맥락 — 공식 공시 기준

1. **Modular Inc 인수 완료** — 2026-06-21 계약, Q3 발표(07-29) 시점 완료. 대가로 보통주 **17,826,566주** 사모 발행, 07-31 재판매 등록 (관측: SEC 8-K 2026-07-31 Item 8.01; EX-99.1 2026-07-29). (계산) 발행주식 1,057M 대비 ≈ 1.7%.
2. **Amazon 서버칩 전략 협업 + 워런트** — 2026-09-03 Amazon 계열에 **최대 25,000,000주, 행사가 161.26 USD, 2036-09-03 만기** 워런트 발행. 베스팅은 QTI 서버칩 제품·기술·시스템·제조 서비스 구매(최대 **600억 달러**)에 연동, 발행 시 3,750,000주 즉시 베스팅 (관측: SEC 8-K 2026-09-08 Item 3.02). (계산) 25M주 ≈ 발행주식의 2.4%. 데이터센터 매출 가시성과 직결되는 공시라 콜에서 진행 상황 언급 가능성 [가능성 높음].
3. **Investor Day(2026-06-24) 목표** — 비핸드셋 매출 FY2029 **400억 달러**(2024-11 목표의 약 2배), 비핸드셋(데이터센터 포함) 성장률 FY26 24% → FY27 **60% 초과** 전망 (관측: EX-99.1 2026-07-29 CEO 인용).
4. **투입원가 인상·가격 전가** — 웨이퍼·조립·테스트·패키징·메모리 전반 원가 상승, 가격 인상 진행 중이며 "benefit our gross margins over time" (관측: EX-99.1 2026-07-29).
5. 핸드셋 −20% y/y(Q3) 와 재고 +28%(9개월) 는 공식 수치 [확실]; 원인 분해(고객별·Apple 비중)는 10-Q 미열람으로 `알 수 없음`.
6. 2026-09-08 이후 8-K 없음 → 발표 전 사전 공시(프리어나운스) 없음 [확실, 2026-10-28 조회 기준].

## 9. 발표 때 점검할 항목 (판단·시그널 아님)

- Q4 실적이 가이던스(매출 9.7~10.5B, 비GAAP EPS 2.05~2.25, GAAP 1.22~1.42) 어디에 놓이는지 · 컨센서스(10.14~10.15B / 2.16~2.17) 대비.
- **Q1 FY27 가이던스**(가장 반응을 좌우했을 변수 [가능성 높음]) — 12월 분기 컨센서스는 출처 1곳만 확보해 수치 미기재.
- 핸드셋 매출 감소폭·QTL 매출, 가격 인상의 총마진 반영 시점, 재고 8,379M 추이.
- 데이터센터: Amazon 워런트 베스팅(구매 약정) 진전, Modular 통합 비용(비GAAP "기타" 항목 −0.11/주 가이던스).
- GAAP 순이익의 세금 항목 변동(FY25 Q4 −5.7B 충당 → FY26 환입 흐름) — GAAP EPS 는 분기 간 비교가 어려움.
- 반응 규모 참고치: 다음 거래일 절대 등락 중앙값 ≈ 5.7%, 범위 −8.9% ~ +15.1% (교차 미확인).

## 10. 데이터 품질·주의

- `교차 미확인`: §6 종가 8쌍 전부(yahoo 1곳), 배당 수치. `교차 불일치`: 52주 고/저(KIS vs yahoo).
- `미확인(출처 1곳)`: GAAP EPS 컨센서스, 위스퍼, 12월 분기 컨센서스, Q3 FY26 매출 컨센서스, 가이던스 세그먼트 세부.
- `알 수 없음`: RS rating·52주 고점 플래그(원본)·20일 거래량비(해외 미계산), 핸드셋 감소 원인 분해, Q2 FY26 세금 이익의 공식 사유 문구.
- 웹 검색 도구의 요약문 속 수치(예: "컨센서스 2.22~2.23", "매출 9.69B 기대", "11월 11일 추정")는 값으로 쓰지 않았고 URL 탐색에만 썼다.
- 외부 텍스트 속 지시문: 발견 없음. 참고 — hudson-labs.com 상단 배너 "No Hallucination Guarantee"·무료 체험 CTA, marketbeat.com "Get the Deal/Sign Up" 은 마케팅 문구이며 지시문 아님. hudson-labs 전망 표의 "Non-GAAP EPS 컨센서스 $3.00" 셀은 Q4 FY25 실제값과 같아 오류로 보이며 사용하지 않았다.
- marketbeat 알림 페이지는 7월 작성(dateModified 2026-07-29)이면서 "Upcoming Earnings Consensus" 블록만 현재값(2.17/10.14B)으로 갱신돼 있어 같은 페이지 안 수치가 서로 다름(FAQ 2.23/10.0B, 표 평균 2.05) — 현재값 블록만 인용.
- 접근 실패: benzinga.com 403, zacks.com 봇 차단, stooq.com 빈 응답, advfn.com 403, investing.com 404, bigcharts.marketwatch.com 접근 불가, investor.qualcomm.com 이벤트 페이지 JS 미로딩.
- SEC 호출 10건(한도 15), 웹 합계 26건(검색 3·가져오기 23, 한도 38) — 상한 미도달, 마무리 기준(약 30)에서 종료.

## 결론

**검토 필요** (신규 노트). 발표 전 확인된 것: 일정·가이던스·컨센서스·전년 비교 기준은 공식/2곳 이상 출처로 확인됨 [확실]. 확인 못 한 것: 과거 반응 종가의 교차 검증, 다음 분기 컨센서스.

## 질의 로그

### WebSearch (3)
1. `Qualcomm to announce fourth quarter fiscal 2026 results November 4 2026 conference call`
2. `Qualcomm Q4 fiscal 2026 earnings preview analysts expect EPS revenue consensus November 2026`
3. `"Qualcomm Schedules Fourth Quarter and Fiscal 2026 Earnings Release and Conference Call"` (allowed_domains: businesswire.com, qualcomm.com, investor.qualcomm.com)

### WebFetch (23)
1. https://stockanalysis.com/stocks/qcom/history/
2. https://finance.yahoo.com/quote/QCOM/history/?period1=1730419200&period2=1785888000
3. https://investor.qualcomm.com/
4. https://www.qualcomm.com/news/releases/2026/10/qualcomm-schedules-fourth-quarter-and-fiscal-2026-earnings-relea (제목만 반환)
5. https://www.marketbeat.com/instant-alerts/qualcomm-nasdaqqcom-issues-q4-2026-earnings-guidance-2026-07-29/
6. https://www.benzinga.com/quote/QCOM/earnings-forecasts (403)
7. https://www.hudson-labs.com/research/qualcomm-q4-2026-earnings-preview-qcom-revenue-guidance-key
8. https://stooq.com/q/d/?s=qcom.us&d1=20241101&d2=20260805 (빈 응답)
9. https://www.zacks.com/stock/quote/QCOM (봇 차단)
10. https://investor.qualcomm.com/news-events/investor-events (이벤트 미로딩)
11. https://finance.yahoo.com/quote/QCOM/analysis/
12. https://www.earningswhispers.com/stocks/qcom
13. https://www.tipranks.com/stocks/qcom/earnings
14. https://www.advfn.com/stock-market/NASDAQ/QCOM/historical/more-historical-data?current=0&Date1=11/01/24&Date2=08/05/26 (403)
15. https://www.investing.com/equities/qualcomm-historical-data (404)
16. https://investor.qualcomm.com/news-events/press-releases/news-details/2026/Qualcomm-Schedules-Fourth-Quarter-and-Fiscal-2026-Earnings-Release-and-Conference-Call/default.aspx
17. https://bigcharts.marketwatch.com/historical/default.asp?symb=QCOM&closeDate=7%2F29%2F2026 (접근 불가)
18. https://bigcharts.marketwatch.com/historical/default.asp?symb=QCOM&closeDate=7%2F30%2F2026 (접근 불가)
19. https://bigcharts.marketwatch.com/historical/default.asp?symb=QCOM&closeDate=4%2F29%2F2026 (접근 불가)
20. https://bigcharts.marketwatch.com/historical/default.asp?symb=QCOM&closeDate=4%2F30%2F2026 (접근 불가)
21. https://bigcharts.marketwatch.com/historical/default.asp?symb=QCOM&closeDate=2%2F4%2F2026 (접근 불가)
22. https://bigcharts.marketwatch.com/historical/default.asp?symb=QCOM&closeDate=2%2F5%2F2026 (접근 불가)
23. https://finance.yahoo.com/quote/QCOM/

### SEC curl (10, GET·직렬)
1. https://www.sec.gov/files/company_tickers.json
2. https://data.sec.gov/submissions/CIK0000804328.json
3. https://data.sec.gov/api/xbrl/companyfacts/CIK0000804328.json (jq 식 오류로 재호출)
4. https://www.sec.gov/Archives/edgar/data/804328/000080432826000085/index.json
5. https://www.sec.gov/Archives/edgar/data/804328/000080432826000085/qcom062826erex991.htm
6. https://www.sec.gov/Archives/edgar/data/804328/000110465926089234/tm2621612d2_8k.htm
7. https://www.sec.gov/Archives/edgar/data/804328/000110465926105718/tm2623289d1_8k.htm
8. https://data.sec.gov/api/xbrl/companyfacts/CIK0000804328.json
9. https://www.sec.gov/Archives/edgar/data/804328/000080432825000084/index.json
10. https://www.sec.gov/Archives/edgar/data/804328/000080432825000084/qcom092825erex991.htm

호출 수: 검색 3 · 가져오기 23 · SEC 10

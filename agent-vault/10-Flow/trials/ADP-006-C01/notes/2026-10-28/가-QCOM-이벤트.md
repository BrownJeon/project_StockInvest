[군 가] NAS:QCOM 변형해시 eb3b4d3d7798

# 종목 노트 — NAS:QCOM (QUALCOMM INC) · 이벤트: FY2026 4분기 실적 발표 · 기준일 2026-10-28

> 개발 시점 분석 기록. 서비스 화면·자동매매 입력·카드·signals·orders 에 옮기지 않는다. 역할 파일의 시그널 생성·Stage 권고·Output Schema 는 이번 노트에 적용하지 않았다. 확신 태그: `[확실]` = 이번 세션에서 SEC 원문·공식 문서를 직접 읽음 · `[가능성 높음]` = 2차 출처 2곳 일치 또는 강한 추론 · `[추측]` = 빈틈을 추론으로 메움.

## 0. 요약 (중요한 것부터)

1. `[확실]` 발표는 **2026-11-04(수) 미국 장 마감 후**, 컨퍼런스콜 **13:45 PT**(회사 보도자료 2026-10-22, PRNewswire 신디케이션 원문 확인). KST 환산: 발표 8-K 접수는 관행상 **11-05(목) 06:0x KST** 전후(직전 4회 접수 KST 05:01~06:04, 11월은 EST 라 06시대), 콜 **11-05 06:45 KST**, 반응 거래일은 **11-05(목) ET 정규장 = KST 11-05 23:30 ~ 11-06 06:00**(11-01 DST 종료 → ET=UTC−5).
2. `[확실]` 회사 가이던스(2026-07-29 8-K EX-99.1): 매출 **$9.7~10.5B**(중간값 $10.1B, 전년 동기 $11.27B 대비 **−10.4%**), 비GAAP EPS **$2.05~2.25**(중간값 $2.15, 전년 $3.00 대비 **−28%**), QCT $8.4~9.0B, QTL $1.2~1.4B, GAAP EPS $1.22~1.42. 콜에서 CFO 가 추가: QCT 핸드셋 **약 $5.2B**(전년 $6,961M 대비 약 −25%), 자동차 **약 +60% YoY**, IoT 전년과 **대략 flat**, QCT EBT 마진 **23~25%**, 비GAAP OpEx **약 $2.7B**.
3. `[가능성 높음]` 매출 컨센서스 **≈ $10.14B**(marketbeat $10.14B · hudson-labs $10,138M, 조회 2026-10-28) — 가이던스 범위 안, 중간값보다 약 0.4% 위. **비GAAP EPS 컨센서스는 `미확인(출처 1곳)`**(marketbeat 만 조회됨, benzinga 403·nasdaq 타임아웃으로 2곳 추가 시도 실패). 주의: 사이트마다 EPS 기준이 다르다(alphaquery $1.46·earningswhispers $1.50·hudson GAAP $1.29·marketbeat 비GAAP) — 발표 당일 헤드라인의 "beat/miss" 는 기준을 확인하고 읽어야 한다.
4. `[확실]` 이번 분기의 핵심 쟁점은 숫자 자체보다 **12월 분기(FY27 Q1) 가이던스와 FY27 프레이밍**이다. 7/29 콜에서 CFO 는 ① Apple 제품 매출이 **9월 분기 → 12월 분기 약 −50%**(신규 iPhone 점유가 종전 추정 20% 보다 "materially lower") ② 그럼에도 12월 분기 QCT 매출은 Android 성장 + **데이터센터 커스텀 실리콘 첫 매출(하이퍼스케일러 2곳, 12월 분기부터)** 으로 **"slightly up on a sequential basis"** ③ 3월 분기가 12월 분기보다 큰 **역계절성** ④ FY27 비핸드셋 매출 **+60% 이상**, 데이터센터 FY27 **$5B**·FY29 **$15B+** 를 제시했다. 이 네 가지가 유지·상향되는지가 반응의 축이다.
5. `[가능성 높음]` 과거 4회 발표 다음날 종가 반응: **−3.6% / −8.5% / +15.1% / −2.6%**(절대값 평균 **7.5%**, 갭 절대값 평균 7.0%) — 네 번 모두 실적 자체가 아니라 **다음 분기 가이던스 vs 컨센서스**가 방향을 갈랐다(2월: 메모리發 가이던스 쇼크 −8.5%, 4월: 가이던스 미달에도 하이퍼스케일러 출하 공개로 +15%). 아래 §6 (yahoo 일별 데이터 계산, 2건은 교차 미확인).
6. `[확실]` 현재가 **$184.17**(2026-10-27 종가, yahoo·stockanalysis 일치). 7/29 발표일 종가 $155.68 대비 **+18.3%**, 9/25 고점 종가 $201.97 대비 −8.8%, 최근 3거래일(10/23~27) **+6.6%**. 분석가 컨센서스는 **Hold**(39명: Strong Buy 3·Buy 12·Hold 21·Sell 3), 목표가 평균 **$205.83**(+11.8%) — marketbeat 1곳.
7. `[추측]` 셋업 판단: 발표 전 3일 급등으로 기대치가 다소 올라간 상태 + Hold 우위 컨센서스 + 역사적 ±7.5% 반응. 가이던스가 "12월 분기 소폭 증가·DC 첫 매출 인식" 을 확인하면 상방, Apple 감소를 Android·DC 가 못 메우는 숫자(12월 분기 QCT 매출 < 9월 분기)면 2월형 하방이 열린다. 이 판단은 수치 근거가 아니라 추론이다.

## 1. 이벤트 개요

| 항목 | 값 | 출처·상태 |
|---|---|---|
| 발표 대상 | FY2026 4분기(회계연도 말 9월 말, SEC fiscalYearEnd 0927) 및 FY2026 연간 | `[확실]` SEC submissions |
| 발표일·시각 | 2026-11-04(수) 장 마감 후, IR 사이트 게시 + 8-K 제출 | `[확실]` 회사 보도자료 2026-10-22 (qualcomm.com 원 페이지는 JS 렌더링으로 본문 미수신 → PRNewswire 신디케이션(ariva.de)에서 원문 확인: "SAN DIEGO, Oct. 22, 2026 … Wednesday, November 4, 2026, after the close of the market") |
| 콜 | 2026-11-04 13:45 PT 생중계, 전화 리플레이 30일 | `[확실]` 같은 보도자료 |
| KST | 8-K 접수 11-05 06:0x 경(추정) · 콜 11-05 06:45 · 반응 정규장 11-05 23:30~11-06 06:00 | `[가능성 높음]` 데이터 팩 접수 시각 이력(05:01~06:04 KST) + DST 종료(11-01) 반영 |
| 직전 8-K 2.02 | 2026-07-29 20:01 UTC 접수(=KST 07-30 05:01) — 데이터 팩 표와 일치 | `[확실]` |
| 발표 전 특이 공시 | 2026-09-08 8-K **Item 3.02**: Amazon 에 **워런트 2,500만 주**(행사가 **$161.26**, 2036-09-03 만료, 서버칩 구매액 최대 **$600억**에 연동해 트랜치 베스팅, 발행 시 375만 주 즉시 베스팅) · 2026-07-31 8-K 8.01: **Modular Inc 인수 대가 17,826,566주** 재판매 등록 · 2026-06-24 8-K 3.02(미열람) | `[확실]` SEC 원문 |

## 2. 데이터 팩 요약 (팩 값 그대로)

- 평가 2026-10-28 04:55 KST · marketState **breakout_watch** · interval 1h · **RSI14 55.6**.
- KIS 스냅샷(10-28 08:00 KST): 현재가 **184.3 USD**(종가 확정 여부 알 수 없음 — yahoo/stockanalysis 10-27 종가 184.17, marketbeat 시간외 184.39~184.61 과 정합), 52주 고가 **257.5617(2026-05-29)**, 52주 저가 **120.8832(2026-04-07)**, 섹터 반도체 및 반도체장비.
- RS rating·52주 고점 근접 플래그·20일 거래량비: **알 수 없음**(해외 미계산).
- `[추측]` 52주 고가 257.56 은 이번 조사에서 교차 확인하지 않았다. 8/18~10/27 최고 **종가**가 201.97(9/25)이고 4/30 종가 179.58·5/1 177.01 이어서, 5월 말 257 은 장중 고가이거나 KIS 값 특이치일 가능성을 배제 못 한다 → 사용 시 주의(교차 미확인). 그대로 쓰면 현재가는 고가 대비 −28.5%, 저가 대비 +52.4%.

## 3. 직전 실적(FY26 Q3, 2026-07-29)과 FY26 분기 추이 — SEC 원문 `[확실]`

| 분기(발표일 ET) | 매출 가이던스 | 매출 실제 | 비GAAP EPS 가이던스 | 비GAAP EPS 실제 | QCT 핸드셋 / 자동차 / IoT (M) | QTL (M) |
|---|---|---|---|---|---|---|
| FY25 Q4 (2025-11-05) | — | **$11,270M** (+10% YoY) | — | **$3.00** (+12%) | 6,961 / 1,053 / 1,807 | 1,409 |
| FY26 Q1 (2026-02-04) | $11.8~12.6B | **$12.3B**(기록) | $3.30~3.50 | **$3.50**(상단) | 7,824 / 1,101 / 1,688 | — |
| FY26 Q2 (2026-04-29) | $10.2~11.0B | **$10.6B**(중간) | $2.45~2.65 | **$2.65**(상단) | 6,024 / 1,326 / 1,726 | — |
| FY26 Q3 (2026-07-29) | $9.2~10.0B | **$9,947M**(상단, −4% YoY) | $2.10~2.30 | **$2.21**(중간, −20% YoY) | **5,086(−20%) / 1,588(+61%) / 1,830(+9%)** | 1,278(−3%), EBT 69% |
| **FY26 Q4 (2026-11-04)** | **$9.7~10.5B** | ? | **$2.05~2.25** | ? | 가이드 약 5,200 / 약 +60%(≈1,685) / flat(≈1,807) | $1.2~1.4B, EBT 68~72% |

- Q3 QCT 매출 $8,504M(−5%), QCT EBT 마진 **26%**(전년 30%) → Q4 가이드 **23~25%**: 메모리·웨이퍼·패키징 등 **전방위 투입원가 상승**이 마진을 누른다(보도자료 Business Outlook 명시).
- 패턴: FY26 들어 매출은 가이던스 중간~상단에 꾸준히 착지했고, EPS 는 Q1·Q2 상단 → Q3 중간으로 **처음 상단을 놓쳤다**(원가). 주가 반응은 실적이 아니라 **다음 분기 가이드**가 결정했다(§6).
- 주주환원(Q3): $2.3B — 배당 $973M(**주당 $0.92/분기**, 연 $3.68 → 현재가 기준 수익률 약 2.0%) + 자사주 $1.4B(800만 주). 4월에 **$200억 신규 자사주 한도** 공표. 희석 주식수 **1,069M**(Q3 비GAAP 조정표).
- GAAP 잡음: FY25 Q4 GAAP 순손실 −$3,117M, FY26 Q2 GAAP EPS $6.88 — 일회성 항목(원인 **알 수 없음**, 미조사) → 비교는 비GAAP 기준으로.
- 전사록 수치 불일치 1건: 콜에서 CFO 는 배당 "$937 million" 이라 했으나 보도자료는 $973M → 보도자료 우선.

## 4. 컨센서스 (교차 확인 상태)

| 항목 | 값 | 상태 |
|---|---|---|
| Q4 매출 | **≈ $10.14B** | `[가능성 높음]` marketbeat $10.14B(조회 10-28) · hudson-labs $10,138M(메모 10-07) 일치 |
| Q4 비GAAP EPS | 값 없음 | **미확인(출처 1곳)** — marketbeat 만 조회됨; 2곳 추가 시도 실패(benzinga 403·nasdaq 타임아웃). 기준 혼재 경고: alphaquery $1.46·earningswhispers $1.50·hudson GAAP $1.29 |
| 세그먼트 컨센서스 | QTL $1,409M·자동차 $1,053M·IoT $1,807M·QCT $9,821M·핸드셋 $6,961M (hudson-labs) | **미확인(출처 1곳)** — 더구나 이 값들은 **FY25 Q4 실적치와 정확히 같아** 컨센서스가 아니라 전년 실적 열이 잘못 들어간 것으로 보임 → 사용 금지 |
| FY27 Q1(12월 분기) 컨센서스 | — | **조사하지 않음** → 알 수 없음 |
| 옵션 내재 변동폭 | — | **조사하지 않음** → 알 수 없음 |
| 분석가 등급·목표가 | Hold(39명: SB 3·B 12·H 21·S 3), 평균 PT $205.83(최고 $400 Baird, 최저 $120). 10월 액션: 10/16 Arete 업그레이드 Strong Buy · 10/19 TD Cowen Buy PT 175→200 · 10/21 Susquehanna Neutral PT 160→185 | **출처 1곳(marketbeat)** |

## 5. 사업 쟁점 — 7/29 콜 전사록(회사 IR CDN 게시 LSEG 편집본) `[확실]` + SEC

1. **Apple 이탈 가속**: 공급 제약으로 신규 iPhone 점유가 20% 추정보다 "materially lower" → Apple 제품 매출 **9월→12월 분기 약 −50%**. FY27 Apple 매출은 종전 가이드("a little over $2 billion")보다 더 낮다. 번스타인 추정 "FY26 Apple 약 $7.5B, 대부분 FY27 에 소멸" 에 CFO 가 "fair range" 라 답함. 회사 입장: FY27 비핸드셋 +60% 성장이 Apple 전체를 **연내 대체**.
2. **12월 분기 가이드 예고(이번 발표의 핵심)**: Apple −50% QoQ 를 Android 성장 + DC 첫 매출이 상쇄해 QCT 매출 **"slightly up" QoQ**, 3월 분기 > 12월 분기(역계절성). 11-04 에 실제 Q1 FY27 가이드가 이 틀을 지키는지가 1순위 관전 포인트.
3. **데이터센터**: 커스텀 실리콘 고객 **하이퍼스케일러 2곳**, 둘 다 PO 수령·웨이퍼 착수, **12월 분기부터 매출**. 이후 SEC 로 확인된 것: **Amazon**(9/3 워런트, 구매액 최대 $600억 연동) `[확실]`. 두 번째 고객은 **미확인(출처 1곳: TIKR 기사 제목 "Meta data center deal")**. HBC(고대역 메모리 결합 컴퓨트) Gen 1 테이프아웃 완료, 2027 중반 출시 목표. DC 매출은 기본 GM(48~50%)보다 낮아 QCT 가중 GM 에 **1.5~2%p 드래그**.
4. **가격 인상·GM**: 산업 전반 투입원가 상승 → "double digit" 가격 인상을 계약·제품 주기에 따라 순차 반영, "next couple of quarters" 에 GM 회복 기대. 보도(검색 요약)로는 9/1 부터 인상 — 출처 1곳. **Q4 는 인상 효과가 처음 섞이는 분기**: QCT EBT 마진 23~25% 가이드 대비 실제가 상단이면 인상 전가가 먹히는 신호.
5. **메모리·중국**: 중국 OEM 핸드셋 매출은 6월 분기가 바닥, 9월 분기 **두 자릿수 QoQ 증가** 예상(채널 재고 소진). 2027 핸드셋 시장 **low-teens 감소** 가정, QCT Android −20% YoY 의 EPS 영향 **>$1.50**(정상화 시 잠재 tailwind). 삼성 플래그십 Snapdragon 비중 약 70%.
6. **자동차·IoT**: 자동차 23분기 연속 두 자릿수 성장, BMW 차세대 ADAS·디지털 콕핏 리드 컴퓨트 선정, FY26 말 연환산 run-rate **$7B**(종전 $6B 상향). 산업용 디자인윈 파이프라인 $7B+. FY29 목표: 자동차+IoT $24B+, DC $15B+, 비핸드셋 합계 **$40B**(종전 $22B).
7. **M&A·희석**: Modular 인수 완료(7/31, 17.8M 주 발행) · Alphawave 완료(2월 보도자료) · Amazon 워런트 25M 주(현재가 기준 내가격: 행사가 161.26 vs 184.17). 합산 약 43M 주 ≈ 희석 주식수 1,069M 의 **약 4%**. OpEx 는 Investor Day 가이드 유지(Alphawave·Modular 반영, DC 로드맵 투자 증가).
8. **QTL**: 디바이스 ASP 상한까지는 가격 인상 수혜, 상한 위는 무관. 미·중 규제: 현재 DC 엔게이지먼트는 "not restricted".

## 6. 과거 발표 반응 — yahoo 일별 데이터로 계산(D0 = 발표일 ET 종가)

| 발표일(ET) | D−1→D0 | D0 종가 | D+1 시가(갭) | D+1 종가(변동) | D+2 누적 | D+1 거래량 | 교차 상태 |
|---|---|---|---|---|---|---|---|
| 2025-11-05 (FY25 Q4) | +4.0% | 179.72 | 177.80 (−1.1%) | 173.20 (**−3.6%**) | −4.9% | 16.2M | **교차 미확인** |
| 2026-02-04 (FY26 Q1) | +1.2% | 148.89 | 132.92 (−10.7%) | 136.30 (**−8.5%**) | −7.8% | 30.2M | 교차 확인(marketscreener/Reuters 보도 "8.5% lower" — 정성 검색 중 부수 확인) |
| 2026-04-29 (FY26 Q2) | +4.0% | 156.00 | 172.05 (+10.3%) | 179.58 (**+15.1%**) | +13.5% | 61.1M | 교차 확인(수치: TIKR "약 15%"; 단 TIKR 은 4/29 로 표기·날짜 틀 상이) |
| 2026-07-29 (FY26 Q3) | −4.4% | 155.68 | 146.55 (−5.9%) | 151.60 (**−2.6%**) | −5.2% | 24.3M | **교차 미확인**(itiger 제목 "7% 하락"은 시간외·장중 기준으로 보임 `[추측]`) |

- 절대값 평균: D+1 종가 **7.5%**, 갭 7.0%. 4회 중 3회 하락, 하락 3회는 모두 갭다운 후 일부 회복 없이/부분 회복.
- 반응 원인(보도·전사록 기준): **2월** = Q1 기록 실적(비GAAP $3.50·$12.25B)에도 Q2 가이드($10.2~11.0B·$2.45~2.65)가 컨센서스(보도 $11.11B·$2.89 — 출처 1곳) 미달, Amon "100% related to memory" `[가능성 높음]`(siliconangle·marketscreener·tikr 보도 일치). **4월** = Q3 가이드($9.2~10.0B) 컨센서스 미달로 시간외 −7% → 하이퍼스케일러 커스텀 실리콘 연내 출하 공개로 반전 +15% `[가능성 높음]`(TIKR 1곳 + 콜 내용 정합). **7월** = Q4 EPS 가이드 중간값 $2.15 가 컨센서스(보도 $2.23 — 출처 1곳) 아래 + Apple 감소 가속.
- 교차 시도 기록: 시세 이력 사이트 3곳 시도(stockanalysis = 8/18 이후만 표시·yahoo = 1년치 확보·alphaquery = 가격 열 없음) → 규칙상 추가 시도 중단.

## 7. 최근 주가 흐름·수급 (2026-08-18 ~ 10-27, stockanalysis 50거래일) `[가능성 높음]`

- 8/18 160.19 → **8/24 158.53(기간 최저 종가)** → 9/3 Amazon 워런트 체결(8-K 는 9/8 09:00 ET 접수) → **9/8 시가 180.40(+6.9% 갭) 종가 174.09(+3.2%, 26.1M 주)** `[가능성 높음]` 9/7 Labor Day 휴장 후 첫 세션 반응.
- 9/15 +4.3% · **9/18 −5.8%(54.5M 주, 원인 미조사)** · **9/21 +9.3%**(Bloomberg Línea +9.18%·194.18 — 근사 일치; 원인은 AI 광 인터커넥트 데모 보도 1곳) · **9/25 201.97 기간 최고 종가** · **9/28 −7.2%**(TIKR 201.97→187.48 일치; 원인 분분 — 차익실현·삼성 2nm 협상 보도·CEO 10b5-1 매도 약 $4M).
- 9/30 184.04 → 10/15 178.40 → 10/22 172.83(−2.9%) → 10/23~27 3연속 상승 **184.17**(+6.6%, 거래량 7.3M→9.7M→12.3M 증가).
- 평균 거래량 약 **12.0M 주/일**(50일 합계 ≈599.5M 추정, 9/18 특이일 포함). 팩 RSI14(1h) 55.6·breakout_watch 와 "최근 반등·중립 모멘텀" 그림이 어긋나지 않는다.
- Street 사건 연쇄: 투자자데이(6월 추정, 비핸드셋 $40B 목표) → Modular 인수(7/31) → Amazon 워런트(9/3) → Snapdragon Summit(9/22~24) → 10월 목표가 상향 3건.

## 8. 11-04 관전 체크리스트 (노트 독자용 · 시그널 아님)

| # | 확인 항목 | 기준(회사 가이드·콜 발언) | 해석 |
|---|---|---|---|
| 1 | Q4 매출·비GAAP EPS | $9.7~10.5B / $2.05~2.25 (컨센 매출 ≈$10.14B) | 중간값 미만이면 FY26 첫 하단권 착지 |
| 2 | QCT 핸드셋 | ≈$5.2B, 중국 OEM 두 자릿수 QoQ 반등 | 반등 미달 = "6월 바닥" 서사 훼손 |
| 3 | QCT EBT 마진 | 23~25% | 상단이면 가격 인상 전가 진행 신호 |
| 4 | 자동차 / IoT | ≈+60% YoY / flat | 자동차 $1.6B 후속 기록 여부 |
| 5 | **Q1 FY27 가이드** | QCT "slightly up" QoQ, Apple −50% QoQ 흡수 | **핵심**. 9월 분기 QCT 아래면 2월형 반응 위험 |
| 6 | DC 첫 매출 | 하이퍼스케일러 2곳 12월 분기 인식, FY27 $5B 유지 | 지연·축소 시 밸류에이션 축 흔들림 |
| 7 | GM 경로 | 기본 48~50% 복귀 + DC 드래그 1.5~2%p | 메모리 원가 추가 악화 여부 |
| 8 | 자본환원 | $0.92 배당 유지, $200억 한도 집행 속도 | 희석(≈4%) 상쇄 여부 |
| 9 | FY27 프레이밍 | 비핸드셋 +60%, 3월 분기 > 12월 분기 | 하향 시 Hold 컨센서스가 Sell 쪽으로 움직일 재료 |

`[추측]` 시나리오: 체크 5·6 이 유지·상향 + 체크 3 상단이면 과거 4월형(갭업), 체크 5 가 "flat~down" 이거나 DC 인식이 밀리면 2월형(−8% 급). 숫자 근거가 아니라 과거 4회 패턴과 콜 발언에서 추론한 것이며, 옵션 내재 변동폭·Q1 컨센서스를 조사하지 않아 시장 기대치의 정확한 바는 모른다.

## 9. 리스크·불확실성·미확인 목록

- 미확인/알 수 없음: 비GAAP EPS 컨센서스(출처 1곳) · Q1 FY27 컨센서스(미조사) · 옵션 내재 변동폭(미조사) · 52주 고저 교차(팩 값) · 과거 반응 2건 교차 미확인 · 9/18 −5.8% 원인 · 두 번째 DC 고객 신원(출처 1곳) · RS·거래량비(팩 미계산) · 분석가 등급(출처 1곳) · 2월 컨센서스 보도값(출처 1곳) · 2026-06-24 8-K 3.02 내용(미열람).
- 구조 리스크: Apple 모뎀 매출 소멸(FY26 약 $7.5B 추정) · 메모리 가격發 핸드셋 TAM 축소(2027 low-teens 감소 가정) · DC 신규 진입자 실행 리스크(HBC 2027 중반) · 미·중 규제 · 워런트·인수 주식 희석 · 삼성 파운드리 협상 보도(미확인).
- 데이터 품질: marketbeat 실적 페이지는 7/29 기준으로 낡았고 "회사 미확정" 이라 적혀 있으나 회사는 10/22 에 일정을 확정했다. hudson-labs 세그먼트 컨센서스 열은 전년 실적치와 동일(오류 추정). 전사록은 LSEG 편집본("material errors" 면책).
- 의심 문장(외부 텍스트 속 지시문): 가져온 본문·SEC·전사록에서 지시문 없음. 검색 결과 목록(검색 #4·#6)에 금융 콘텐츠를 긁어 붙인 비관련 도메인(mycpd2.moh.gov.my·accred.deac.org·bvwd.ca.gov·2026niag.ncu.edu.tw·cccba.ac.in·portjervislibrary.org)이 섞여 있었고 내용이 뒤섞여 있어 **사용하지 않았다**.

## 질의 로그

WebSearch (8)
1. Qualcomm fourth quarter fiscal 2026 results conference call November 4 2026
2. Qualcomm Q4 fiscal 2026 earnings preview analyst consensus EPS revenue estimate November 2026
3. Qualcomm October 2026 news Amazon server chip warrant Snapdragon Summit price increase analyst
4. Qualcomm QCOM stock analysts October 2026 ahead of earnings Apple modem data center Amazon shares
5. Qualcomm Q3 fiscal 2026 earnings call Amon Apple share iPhone fourth quarter handset data center Amazon shipments December quarter
6. Qualcomm shares fell after earnings February 5 2026 guidance; Qualcomm stock surges April 30 2026 earnings; Qualcomm stock July 30 2026 after results
7. Qualcomm stock falls February 5 2026 after fiscal first quarter results memory shortage Samsung guidance shares drop
8. Qualcomm stock September 21 2026 jumps 9% reason; Qualcomm shares September 28 2026 fall 7% reason

WebFetch (15)
1. https://investor.qualcomm.com/news-events/press-releases (목록 미렌더링)
2. https://www.marketbeat.com/stocks/NASDAQ/QCOM/earnings/
3. https://stockanalysis.com/stocks/qcom/history/
4. https://www.qualcomm.com/news/releases/2026/10/qualcomm-schedules-fourth-quarter-and-fiscal-2026-earnings-relea (제목만 수신)
5. https://www.benzinga.com/quote/QCOM/earnings-forecasts (403)
6. https://www.nasdaq.com/market-activity/stocks/qcom/earnings (타임아웃)
7. https://finance.yahoo.com/quote/QCOM/history/
8. https://stockanalysis.com/stocks/qcom/history/?p=2 (1페이지와 동일 범위)
9. https://www.hudson-labs.com/research/qualcomm-q4-2026-earnings-preview-qcom-revenue-guidance-key
10. https://www.alphaquery.com/stock/QCOM/earnings-history
11. https://www.ariva.de/news/investor-advisory-s-amp-w-seed-company-to-acquire-seed-4469215
12. https://www.barchart.com/story/news/36966953/what-you-need-to-know-ahead-of-qualcomm-s-earnings-release (본문 비어 있음)
13. https://stockanalysis.com/stocks/qcom/history/ (재조회)
14. https://s204.q4cdn.com/645488518/files/doc_financials/2026/q3/Q3FY26_Earnings_Call-Transcript_7-30-26_FINAL.pdf (받은 PDF 본문은 로컬에서 읽음)
15. https://www.marketbeat.com/stocks/NASDAQ/QCOM/forecast/

SEC curl (11)
1. https://data.sec.gov/submissions/CIK0000804328.json
2. https://www.sec.gov/Archives/edgar/data/804328/000080432826000085/
3. https://www.sec.gov/Archives/edgar/data/804328/000110465926105718/tm2623289d1_8k.htm
4. https://www.sec.gov/Archives/edgar/data/804328/000110465926089234/tm2621612d2_8k.htm
5. https://www.sec.gov/Archives/edgar/data/804328/000080432826000085/qcom062826erex991.htm
6. https://www.sec.gov/Archives/edgar/data/804328/000080432825000084/
7. https://www.sec.gov/Archives/edgar/data/804328/000080432825000084/qcom092825erex991.htm
8. https://www.sec.gov/Archives/edgar/data/804328/000080432826000016/
9. https://www.sec.gov/Archives/edgar/data/804328/000080432826000016/qcom122825erex991.htm
10. https://www.sec.gov/Archives/edgar/data/804328/000080432826000060/
11. https://www.sec.gov/Archives/edgar/data/804328/000080432826000060/qcom032926erex991.htm

호출 수: 검색 8 · 가져오기 15 · SEC 11

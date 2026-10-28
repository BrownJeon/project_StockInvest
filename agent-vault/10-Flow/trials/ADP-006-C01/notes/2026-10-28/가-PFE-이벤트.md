[군 가] NYS:PFE 변형해시 eb3b4d3d7798

# 종목 노트 — NYS:PFE (PFIZER INC) · 종류: 이벤트(실적 발표) · 기준일 2026-10-28

> 개발 시점 분석 기록. 서비스 화면·자동매매 입력·카드·signals·orders 에 옮기지 않는다(접근 규칙 5). 시그널·주문 판단은 이 노트 범위 밖이다(규칙 6). 데이터 팩 기준일 2026-10-27, 웹 조회일은 전부 2026-10-28(KST).

## 0. 결론 먼저

- **이벤트** [확실] 2026-11-03(화) 아침 "Third Quarter 2026 Performance Report" 발행 → 10:00 a.m. EST 애널리스트 콜. 회사 IR 보도자료(2026-09-22, s206.q4cdn.com 원문 PDF) 그대로. MarketBeat 가 "추정(미확정)" 이라고 표기한 것은 MarketBeat 쪽 오류다.
- **기대치는 이미 YoY 역성장** [확실·2곳 일치] Q3 컨센서스 조정 EPS **$0.73**(MarketBeat/Fiscal.ai · Investing.com $0.733 · finviz $0.73) vs Q3 2025 실적 **$0.87**(SEC 8-K) → −16%. 매출 컨센서스 **약 $15.9B**(MarketBeat $15.86B · Investing.com $15.91B, 반올림 범위 일치) vs **$16.7B** → 약 −5%. 역성장 자체는 서프라이즈가 아니다.
- **관전 포인트** [가능성 높음] ① FY2026 가이던스(매출 $60.5~62.5B · 조정 EPS $2.80~3.00)의 상향/유지 — 작년 Q3 발표 때는 EPS 가이던스를 "상향·축소" 했다. ② COVID 제품 FY 가정(~$4B, Q2 때 $5B→$4B 하향)의 재하향 여부. ③ 비용 절감(2027~29 추가 $2.5B)과 2027 전망 언급. ④ 비만 berobenatide(Metsera 인수 자산) 3상 10건 진행 업데이트.
- **주가 위치** [확실] 10-27 종가 **$29.80**(stockanalysis·investing.com 일치) — 직전 발표일(08-04) 종가 $25.41 대비 **+17.3%**, 10-22 52주 신고가 $30.44 대비 −2.1%. 10-05 저점 $27.41→10-22 $30.42 로 +11% 급등 뒤 이벤트를 맞는다 → 기대치가 올라간 상태.
- **과거 반응** [확실, 단 교차는 1건만] 최근 6회 발표일 종가 반응 −3.3%~+5.2%(평균 절대값 2.6%). EPS 를 6분기 연속 비트했는데도 방향은 제각각 — Q3'25·Q4'25 는 비트에도 하락. 발표 당일 "비트/미스" 만으로 방향을 예단할 근거가 없다.
- **발표 3거래일 뒤 11-06 배당락**($0.43) — Yahoo 배너 1곳만 확인(교차 미확인).

## 1. 이벤트 사실관계

| 항목 | 내용 | 출처·상태 |
|---|---|---|
| 발표 형식 | 보고서("Performance Report")를 당일 아침 발행, 10:00 a.m. EST 콜, 24시간 내 리플레이, 90일 보관 | [확실] 회사 IR PDF(2026-09-22) |
| 8-K 접수 예상 | 과거 10건 모두 발표 당일 접수, 접수 시각 KST 20:00~22:11(데이터 팩) — 최근 4회는 발표 전 오전(ET) 접수(SEC acceptanceDateTime 11:01~12:01Z) | [확실] 데이터 팩 + SEC submissions |
| Q3 2026 분기 말 | 2026-09-27(회사 회계 분기, 10-Q 보고일 패턴) | [가능성 높음] 10-Q 보고 기준일 패턴(06-28·03-29) |
| 배당락 | 11-06, $0.43 | finance.yahoo.com 배너 1곳 → 교차 미확인 |

## 2. 시세 맥락 (데이터 팩 ↔ 웹 교차)

| 항목 | 데이터 팩(KIS, 10-28 08:00 KST) | 웹(조회 10-28) | 상태 |
|---|---|---|---|
| 현재가 | 29.79 | 10-27 종가 29.80 (stockanalysis.com · investing.com) | 0.01 차이 — KIS 값이 시간외/다른 시점일 가능성 [추측] |
| 52주 고가 | 30.44 (2026-10-22) | 10-22 고가 30.44 (두 사이트), finviz 52W High 30.44 | 일치 |
| 52주 저가 | 22.5673 (2025-10-30) | finviz 52W Low 23.62 | **불일치**(기준 차이로 보임) → 교차 미확인 |
| RSI14(1h) | 61.9 (10-28 04:55 KST, marketState breakout_watch) | — | 팩만 |
| RS·거래량비 | 미계산 | — | 알 수 없음 |

10월 일별(investing.com, stockanalysis 로 10-20 이후 교차 일치): 10-01 28.12 → 10-05 27.41(저점) → 10-14 29.21(+2.96%) → 10-20 30.11(+2.28%) → 10-22 30.42(고점) → 10-27 29.80. 10-20 Reuters 헤드라인 "헬스케어·가치주 로테이션"(finviz 경유) 과 시기가 겹친다 [가능성 높음].

밸류에이션(finviz 1곳, 교차 미확인): 시가총액 $169.85B · P/E 39.5(GAAP, 손상차손 왜곡) · 선행 P/E 10.3 · 배당수익률 5.8% · 공매도 비중 2.42% · 목표주가 28.99(현재가 아래) · Recom 2.66. 자체 점검: 29.80 ÷ FY26 EPS 가이던스 중간값 2.90 = 10.3배로 finviz 선행 P/E 와 맞는다.

## 3. 직전 분기(Q2 2026) 실적·가이던스 — SEC 8-K EX-99 (2026-08-04) [확실]

- 매출 **$15,034M**(+3% 보고, +1% 영업 기준). COVID 제외 +5%, 출시·인수 제품 +18%. H1 매출 $29,484M.
- 보고 EPS **−$0.04**(무형자산 손상 $4.3B, 그중 $3.8B 는 sigvotatug vedotin 2L NSCLC 3상 실패 관련 IPR&D) · 조정 EPS **$0.77**.
- 제품: Eliquis $2,425M(+19% 영업) · Padcev +23% · Vyndaqel 군 +8% · Lorbrena +37% · **Paxlovid −95% · Comirnaty −34%**. R&D +13%(종양·비만).
- **FY2026 가이던스**: 매출 $59.5~62.5B → **$60.5~62.5B**(중간값 +$0.5B = 비COVID +$1.5B, COVID $5B→**$4B**). 조정 EPS **$2.80~3.00 유지**(Innovent 라이선스 IPR&D $650M, 약 −$0.10 흡수). SI&A $12.5~13.5B · R&D $10.5~11.5B · 세율 ~15%.
- 비용: 추가 생산성 절감 **$2.5B(2027~2029)** 발표, 그중 "Realigning Our Cost Base" 추가 순절감 $1.0B.
- 자본: 2026년 자사주 매입 0, 잔여 한도 $3.3B, 가이던스는 매입 미가정.
- 가이던스 이력: 2025-12-16 도입(당일 −3%대, zacks.com/nasdaq.com 기사) → 05-05 유지 → **06-18 CFO 교체 공시(8-K 5.02) 직후 7.01 로 재확인**(당일 종가 25.92→25.21, −2.7%, 거래량 1.2억, Yahoo 1곳) → 08-04 매출 상향. 현재 CFO 는 Cecile Guegan(Incoming Interim).

## 4. Q3 2026 기대치와 내재 수치

| 항목 | 값 | 근거 |
|---|---|---|
| 비교 기준 Q3 2025 | 매출 $16.7B(−7% 영업, 비COVID +4%) · 조정 EPS $0.87 · 보고 EPS $0.62 | [확실] SEC 8-K EX-99(2025-11-04) |
| 컨센서스 EPS | **$0.73** | MarketBeat(Fiscal.ai) 0.73 · Investing.com 0.733 · finviz 0.73 → 채택 |
| 컨센서스 매출 | **약 $15.9B** | MarketBeat 15.86B · Investing.com 15.91B(반올림 일치) · Benzinga 403 · Zacks 봇 차단 |
| 내재 YoY | EPS −16% · 매출 −5% | 계산 |
| 내재 H2 | FY 가이던스 − H1 = **$31.0~33.0B**; Q3 컨센 15.9B 가정 시 Q4 내재 **$15.1~17.1B**(Q4'25 실적 $17.56B 대비 −14%~−3%) | 계산 [가능성 높음] |
| 옵션 내재 변동폭 | 미확인 | marketchameleon.com 유료 구간 |

[추측] Q4 는 COVID 백신 시즌 매출이 몰리는 분기라, 가이던스 상단 달성 여부는 Q3 자체보다 Q3 콜에서 제시하는 Q4 COVID 가정에 더 달려 있다.

과거 6분기 서프라이즈(MarketBeat · Investing.com 두 곳, 값이 다르면 둘 다 표기):

| 발표일 | 조정 EPS 실적/추정 | 매출 실적/추정 | 판정 |
|---|---|---|---|
| 2026-08-04 | 0.77 / 0.68 | 15.03B / 14.40~14.42B | 둘 다 비트 |
| 2026-05-05 | 0.75 / 0.72 | 14.45~14.50B / 13.84B | 둘 다 비트 |
| 2026-02-03 | 0.66 / 0.57~0.58 | 17.56~17.58B / 16.91~16.93B | 둘 다 비트 |
| 2025-11-04 | 0.87 / 0.79(MB)·0.66(Inv) | 16.65~16.70B / 16.94(MB)·16.80(Inv) | EPS 비트, 매출 미스(추정치 불일치 → 교차 미확인) |
| 2025-08-05 | 0.78 / 0.57~0.58 | 14.65B / 13.43~13.47B | 둘 다 비트 |
| 2025-04-29 | 0.92 / 0.67~0.68 | 13.72B / 14.09~14.43B | EPS 비트, 매출 미스 |

## 5. 과거 발표일 주가 반응 (종가 기준, finance.yahoo.com HTML 이력 페이지)

| 발표일 | 전일 종가 | 당일 종가 | 당일 | 익일 종가 | 당일 거래량 | 교차 |
|---|---|---|---|---|---|---|
| 2025-04-29 | 23.05 | 23.79 | **+3.2%** | 24.41 | 98.5M | 교차 미확인 |
| 2025-08-05 | 23.53 | 24.75 | **+5.2%** | 23.93 | 114.0M | 교차 미확인 |
| 2025-11-04 | 24.66 | 24.30 | **−1.5%**(장중 고가 25.20 후 반락) | 24.61 | 166.2M | 교차 미확인 |
| 2026-02-03 | 26.66 | 25.77 | **−3.3%** | 26.78 | 92.0M | 교차 미확인(한 집계 사이트는 −1.87% 라 적어 불일치) |
| 2026-05-05 | 26.30 | 26.45 | **+0.6%** | 26.53 | 57.7M | 교차 미확인 |
| 2026-08-04 | 25.03 | 25.41 | **+1.5%** | 25.81 | 62.2M | **확인**(marketchameleon.com +1.5%·25.41, marketbeat.com 장중 +1.3%) |

평균 절대 변동 2.6%, 발표일 거래량은 평상시(최근 2,000~3,500만주)의 2~5배. 시세 이력 시도 사이트 5곳(stockanalysis·investing.com·yahoo·marketchameleon·stooq) 중 과거 발표일을 모두 담은 곳은 Yahoo 뿐이었다 — stockanalysis 는 최근 50영업일만(페이지 인자 무효), investing.com 은 최근 1개월만, stooq HTML 은 빈 페이지, marketchameleon 은 최근 1회만 무료.

## 6. 발표 직전 최근 뉴스·촉매 (10-20~10-28)

- **10-26 FDA 승인: Talzenna + Xtandi, HRR 변이 전이성 호르몬 감수성 전립선암(TALAPRO-3, rPFS 위험 52% 감소)** — pfizer.com 보도자료 제목(검색 결과)·finviz Business Wire 헤드라인 10-26 13:41. Q2 보도자료에 "우선심사 sNDA 접수" 로 예고됐던 건이 확정된 것.
- **10-27~28 Elrexfio 3상 MagnetisMM-32 톱라인 양성**(anti-CD38·레날리도마이드 진행 후 R/R 다발골수종, 표준요법 대비 우월) — pfizer.com 제목(검색)·finviz 10-28 06:45. 출처별 날짜 1일 차이. 4월의 MagnetisMM-5 와는 다른 시험.
- **10-24 25가 소아 폐렴구균 백신(PF-07872412) 2상, IDWeek 2026** — 25개 혈청형 모두 면역반응, 안전성 Prevnar 20 과 유사. 3상 소아 프로그램은 2026-05 개시(Q2 보도자료).
- 10-26 Earnings Whispers "비용 절감이 COVID 매출 감소를 상쇄할 수 있다는 기대로 Q3 앞두고 랠리"(헤드라인만, 본문 미열람).
- 10-23 Barron's "미 재무부, 중국 바이오텍·AI 기업과의 거래 제한 추진" — Innovent(중국) 라이선스 완료(07-10) 이후라 직접 영향은 불명 [추측].
- 회사 보도자료 원문은 pfizer.com 이 403 을 두 번 돌려줘 열지 못했다. 위 세 건의 날짜는 검색 결과 제목·요약과 finviz 헤드라인 두 경로로 맞췄다.

## 7. 남은 2026 촉매 — 회사 공식 슬라이드 "Key Anticipated 2026 Catalysts"(cdn.pfizer.com, 2026-07-10 갱신) [가능성 높음 — 슬라이드 점 색상을 이미지에서 읽음]

- 달성 표시: 규제 Hympavzi(억제제 보유 혈우병)·Padcev EV-303·EV-304 승인; 판독 berobenatide VESPER-3(2b)·Elrexfio MagnetisMM-5·라임병 백신 VALOR·sigvotatug Be6A LUNG-01(OS 미달 — 실패)·Talzenna TALAPRO-3; 피벗 개시 berobenatide 10건·Padcev EV-309·PCV25·PD-1×VEGF(GI-03·Lung-01).
- **2026 안에 남은 것**: 규제 Tukysa HER2CLIMB-05(1L HER2+ 유방암 유지) · 판독 Litfulo 백반증(TRANQUILLO)·mevrometostat MEVPRO-1(mCRPC)·berobenatide+아밀린 유사체 병용 1/2상 · 피벗 개시 Hympavzi 중등도·Litfulo 원형탈모·Nurtec 만성편두통/재투여·PD-1×VEGF 자궁내막암·PD-1×VEGF+Padcev 1L 요로상피암·sigvotatug 1L NSCLC(이 중 일부는 "2026 내 개시 안 함" 으로 표시됐을 수 있음 — 이미지 해석 한계).
- 11-03 콜에서 이들 일정의 지연·취소 언급이 나오면 가이던스보다 주가 반응이 클 수 있다 [추측].

## 8. 판단 — 시나리오와 비대칭성

- [가능성 높음] **상방 조건**: 조정 EPS 가이던스 상향(작년 Q3 패턴 반복) + COVID $4B 가정 유지 + 비COVID 성장률(Q2 +5%) 유지. 컨센서스 EPS 0.73 은 H1 실적(0.75·0.77)보다 낮게 잡혀 있어 "비트" 자체는 발생 확률이 높다(6분기 연속). 다만 §5 가 보여 주듯 비트가 상승을 보장하지 않았다.
- [가능성 높음] **하방 조건**: COVID 재하향(Paxlovid −95% 추세), Q4 내재 매출이 전년 대비 두 자릿수 감소로 읽히는 경우, 2027 특허 만료(LOE) 절벽 선반영 발언, 추가 손상차손. 주가가 52주 고점 2% 아래·발표 전 3주 +11% 랠리 상태라 "기대치 충족" 만으로는 차익 매물이 나올 수 있다.
- [추측] 비대칭: 선행 P/E 10.3배·배당수익률 5.8% 는 하방을 받치는 요인이지만, 애널리스트 평균 목표가(28.99, finviz 1곳)가 현재가 아래라는 점은 랠리가 목표가를 앞질렀음을 뜻한다. 이벤트 당일 기대 변동폭은 과거 평균 ±2.6%, 꼬리 −3.3%/+5.2% 를 기준으로 두는 것이 합리적이다.
- 이 노트는 매수·매도 시그널을 만들지 않는다(규칙 5·6).

## 9. 데이터 품질·미확인·의심 문장

- 접근 실패: investors.pfizer.com 이벤트 페이지 404 · pfizer.com 403 ×2 · benzinga.com 403 · zacks.com 봇 차단 페이지 · stooq.com HTML 빈 응답 · stockanalysis.com `?p=` 페이지네이션 무효(1페이지 반복).
- 교차 미확인: 과거 발표일 반응 5건(Yahoo 1곳) · 11-06 배당락 · 52주 저가(팩 22.57 vs finviz 23.62) · finviz 밸류에이션 전부 · 06-18 −2.7% 반응 · Q3'25 컨센서스 추정치(두 사이트 0.79 vs 0.66).
- 조사 상한 도달 전 마무리(검색 7/8 · 가져오기 19/30 · 합계 26): 미확인 — 옵션 내재 변동폭, 10/26·10/27 보도자료 원문 수치, 2027 LOE 영향 정량치.
- 외부 텍스트 속 지시문: 데이터로 취급할 만한 지시문 없음. zacks.com 봇 차단 페이지의 "쿠키·JS 를 켜고 다시 열라" 는 안내문으로 무시했고, 데이터 팩·역할 파일 외 파일은 읽지 않았다(로컬에서 읽은 것은 내 호출 결과가 저장된 tool-results 사본 2건 — SEC 본문 텍스트·회사 PDF 2건 — 뿐).
- 보유·수량·평단·계좌 정보는 어떤 질의·URL 에도 넣지 않았다.

## 질의 로그

WebSearch
1. `Pfizer third-quarter 2026 earnings conference call November 3 2026`
2. `Pfizer Q3 2026 earnings preview analysts expect EPS revenue consensus`
3. `Pfizer PFE stock news October 2026`
4. `Pfizer announces October 2026 FDA approval OR phase 3 results OR obesity OR acquisition`
5. `Pfizer Elrexfio Phase 3 multiple myeloma October 28 2026 Talzenna Xtandi FDA approval October 26 2026 Business Wire`
6. `Pfizer press release October 2026 Elrexfio Talzenna Xtandi pneumococcal` (allowed_domains: businesswire.com, pfizer.com)
7. `Pfizer shares earnings day reaction "Pfizer shares" rose OR fell after quarterly results 2025 2026 Reuters CNBC`

WebFetch
1. https://investors.pfizer.com/Investors/Events--Presentations/default.aspx (404)
2. https://www.pfizer.com/news/press-release/press-release-detail/pfizer-invites-public-view-and-listen-webcast-november-3 (403)
3. https://www.pfizer.com/newsroom/press-releases (403)
4. https://www.benzinga.com/quote/PFE/earnings-forecasts (403)
5. https://www.marketbeat.com/stocks/NYSE/PFE/earnings/
6. https://www.zacks.com/stock/quote/PFE (봇 차단)
7. https://stockanalysis.com/stocks/pfe/history/
8. https://www.investing.com/equities/pfizer-historical-data
9. https://s206.q4cdn.com/795948973/files/doc_events/2026/Nov/03/Pfizer-Invites-Public-Q3-2026-Earnings_FINAL.pdf (PDF 로컬 판독)
10. https://stockanalysis.com/stocks/pfe/history/?p=2 (1페이지 반복)
11. https://stockanalysis.com/stocks/pfe/history/?p=3 (1페이지 반복)
12. https://finance.yahoo.com/quote/PFE/history/?period1=1745539200&period2=1755302400
13. https://www.investing.com/equities/pfizer-earnings
14. https://finviz.com/quote.ashx?t=PFE
15. https://finance.yahoo.com/quote/PFE/history/?period1=1761523200&period2=1770681600
16. https://finance.yahoo.com/quote/PFE/history/?period1=1777248000&period2=1786492800
17. https://marketchameleon.com/Overview/PFE/Earnings/ (무료 구간만)
18. https://stooq.com/q/d/?s=pfe.us&d1=20250425&d2=20260212&i=d (빈 응답)
19. https://cdn.pfizer.com/pfizercom/pfe-key-anticipated-2026-catalysts-2026-07-10.pdf (PDF 로컬 판독)

SEC (curl GET, 직렬)
1. https://data.sec.gov/submissions/CIK0000078003.json
2. https://www.sec.gov/Archives/edgar/data/78003/000007800326000094/
3. https://www.sec.gov/Archives/edgar/data/78003/000007800326000094/pfe-6282026xex99.htm
4. https://www.sec.gov/Archives/edgar/data/78003/000007800325000149/
5. https://www.sec.gov/Archives/edgar/data/78003/000007800325000149/pfe-09282025xex99.htm (1차, 필터 오류로 재실행)
6. https://www.sec.gov/Archives/edgar/data/78003/000007800325000149/pfe-09282025xex99.htm (2차)
7. https://www.sec.gov/Archives/edgar/data/78003/000007800326000087/pfe-20260618.htm

호출 수: 검색 7 · 가져오기 19 · SEC 7

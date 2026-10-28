# 기업정보 통합 수집 시스템 개선 작업계획서

## 1. 작업 목적

현재 운영 중인 기업정보 수집 기능을 개선하여 SEC 공시, 언론사 RSS, 기업 IR, 실적 및 재무정보를 통합 수집하고, 동일 기업에 대한 정보를 하나의 이벤트 단위로 정규화하여 활용할 수 있는 구조를 구축한다.

단순 주기 수집 방식에서 벗어나 평상시에는 저빈도로 데이터를 수집하고, 특정 기업에 대한 중요 이벤트가 감지된 경우 해당 기업의 수집 빈도를 일시적으로 높이는 **Adaptive Polling 구조**를 적용한다.

최종적으로 다음과 같은 흐름을 구성하는 것을 목표로 한다.

```text
외부 데이터 수집
    ↓
기업/종목 식별
    ↓
이벤트 탐지
    ↓
관련 소스 추가 수집
    ↓
SEC / 기업 IR 사실 검증
    ↓
이벤트 통합
    ↓
재무 및 실적 데이터 분석
    ↓
LLM 분석
    ↓
기업정보 및 이벤트 저장
```

---

# 2. 주요 개선 목표

## 2.1 데이터 소스 확대

현재 기업정보 수집 구조에 다음 데이터 소스를 통합한다.

### SEC

수집 대상

- 8-K
- 10-Q
- 10-K
- Form 4
- 기타 필요 공시

주요 활용 목적

- 기업 공식 공시 확인
- 실적 발표 확인
- 재무정보 확인
- 경영진 및 내부자 거래 확인
- 언론보도 사실 검증

특히 실적 발표의 경우 다음 데이터까지 함께 수집한다.

```text
8-K
 └─ Item 2.02
      └─ Exhibit 99.1
            └─ Earnings Release
```

---

## 2.2 언론사 RSS

복수 언론사의 RSS 또는 News Feed를 수집한다.

대상 예시

- Reuters
- Bloomberg
- CNBC
- MarketWatch
- Yahoo Finance
- AP
- 기타 금융/기업 뉴스

수집된 뉴스는 개별 기사 단위로 관리하되 동일 기업 및 동일 사건에 대한 기사는 하나의 이벤트로 통합한다.

예:

```text
Reuters
"NVIDIA reports Q3 earnings"

CNBC
"NVIDIA beats estimates"

Yahoo Finance
"NVIDIA Q3 results"

SEC
NVDA 8-K

NVIDIA IR
Q3 Earnings Release
```

위 데이터를 각각 독립적인 사건으로 처리하지 않고 다음 하나의 이벤트로 구성한다.

```text
NVDA
2026 Q3 Earnings
```

---

# 3. 데이터 소스 우선순위

정보의 신뢰도를 판단하기 위해 소스별 우선순위를 정의한다.

## Tier 1 - 공식 데이터

```text
SEC
기업 IR
기업 공식 홈페이지
```

용도

- 최종 사실 확인
- 재무정보 기준값
- 이벤트 확정

---

## Tier 2 - 주요 언론

```text
Reuters
Bloomberg
AP
```

용도

- 이벤트 조기 탐지
- 시장 반응 확인
- 이벤트 설명 보완

---

## Tier 3 - 금융 전문매체

```text
CNBC
WSJ
MarketWatch
Barron's
```

용도

- 이벤트 추가 분석
- 시장 해석
- 관련 기업 영향 분석

---

## Tier 4 - 기타 정보

```text
Yahoo Finance
Seeking Alpha
기타 RSS
```

용도

- 보조 데이터
- 추가 이벤트 후보 탐지

Tier 4 정보만으로 중요 이벤트를 확정하지 않는다.

---

# 4. 수집 주기 개선

모든 데이터를 동일한 주기로 수집하지 않고 데이터 종류와 시간대에 따라 수집 빈도를 다르게 적용한다.

## 기본 수집 주기

| 데이터 | 기본 수집 주기 |
|---|---:|
| 뉴스 RSS | 2~5분 |
| SEC Latest Filing | 2~5분 |
| 기업 IR | 3~5분 |
| SEC Structured / XBRL | 10분 |
| 기업 상세 SEC 조회 | 10~15분 |
| 기업 기본정보 | 1일 1회 |
| 재무정보 | 신규 공시 발생 시 |

---

# 5. 미국시장 시간 기반 수집 정책

한국시간 기준 미국시장 주요 시간대에 수집 빈도를 높인다.

서머타임 기준 예시

## 19:00 ~ 21:00

```text
RSS : 3분
SEC : 5분
```

미국 SEC 업무시간 시작 구간.

---

## 21:00 ~ 24:00

미국 장전 및 장 시작 구간.

```text
RSS : 1~2분
SEC : 1~2분
기업 IR : 2분
```

---

## 00:00 ~ 04:30

미국 정규장 운영 시간.

```text
RSS : 3분
SEC : 3~5분
```

---

## 04:30 ~ 07:30

가장 중요한 수집 시간대.

미국 장 마감 및 장후 실적 발표 집중 구간.

```text
RSS : 1분
SEC : 1분
기업 IR : 1분
```

---

## 07:30 ~ 11:00

장후 공시 후속 수집 구간.

```text
RSS : 3~5분
SEC : 5~10분
```

---

## 기타 시간

```text
RSS : 5~10분
SEC : 15~30분
```

서머타임 종료 시 미국시장 관련 수집시간을 한국시간 기준 +1시간 조정한다.

---

# 6. Adaptive Polling 적용

이번 개선 작업의 핵심 기능으로 Adaptive Polling을 적용한다.

기본적으로 전체 기업을 높은 빈도로 조회하지 않는다.

```text
평상시

기업 A
SEC → 10분

기업 B
SEC → 10분

기업 C
SEC → 10분
```

특정 이벤트가 감지되면 해당 기업만 Fast Watch 상태로 변경한다.

예:

```text
Reuters RSS

"NVIDIA announces Q3 earnings"

        ↓

Ticker = NVDA 탐지

        ↓

NVDA 상태 변경

NORMAL
   ↓
FAST_WATCH
```

FAST_WATCH 상태에서는

```text
SEC        30~60초
기업 IR     30~60초
뉴스 RSS    기본 유지
```

형태로 수집 빈도를 높인다.

---

# 7. Fast Watch 종료 조건

무한정 고빈도 수집이 유지되지 않도록 종료 조건을 정의한다.

예:

```text
8-K 발견
또는
기업 IR Earnings Release 발견
또는
30분 경과
```

조건 충족 시

```text
FAST_WATCH
      ↓
VERIFY
      ↓
NORMAL
```

상태로 복귀한다.

권장 상태값

```text
NORMAL
WATCH
FAST_WATCH
VERIFY
COMPLETE
ERROR
```

---

# 8. Event Detector 구현

수집된 개별 데이터를 기업 이벤트 단위로 분류한다.

대표 이벤트

```text
EARNINGS
GUIDANCE
M&A
DIVIDEND
BUYBACK
CEO_CHANGE
CFO_CHANGE
SEC_INVESTIGATION
LAWSUIT
PRODUCT_LAUNCH
CONTRACT
INSIDER_TRADE
CAPITAL_RAISE
BANKRUPTCY
OTHER
```

---

# 9. 기업 식별

뉴스 및 공시에서 기업을 식별하기 위해 다음 정보를 통합 관리한다.

```text
Company

companyId
companyName

ticker

CIK

ISIN

exchange

sector

industry
```

Alias도 관리한다.

예:

```text
NVIDIA Corporation
NVIDIA
NVDA
엔비디아
```

모든 값이 동일한 companyId를 참조하도록 구성한다.

---

# 10. Event Entity 구조

동일 사건에 대한 여러 소스를 하나의 Event로 통합한다.

예:

```json
{
  "eventId": "NVDA_2026_Q3_EARNINGS",
  "companyId": "NVDA",
  "eventType": "EARNINGS",
  "status": "CONFIRMED",
  "sources": [
    "Reuters",
    "CNBC",
    "NVIDIA_IR",
    "SEC"
  ],
  "secForm": "8-K",
  "confidence": 0.99
}
```

---

# 11. 이벤트 상태

이벤트는 다음 단계로 관리한다.

```text
DETECTED

↓

COLLECTING

↓

VERIFYING

↓

CONFIRMED

↓

ANALYZED

↓

COMPLETED
```

실패 상태

```text
FAILED
```

또는

```text
PARTIAL
```

을 별도 관리한다.

---

# 12. 이벤트 중복 제거

동일 사건에 대한 뉴스 중복을 제거한다.

판단 기준

```text
기업
+
이벤트 종류
+
발생시간
+
제목 유사도
+
본문 유사도
```

예:

```text
NVDA

Reuters
NVIDIA Q3 earnings beat estimates

CNBC
Nvidia beats Wall Street estimates

Bloomberg
Nvidia posts stronger Q3 earnings
```

→ 하나의 이벤트

```text
NVDA_Q3_EARNINGS
```

으로 병합한다.

---

# 13. Event Confidence

이벤트의 신뢰도를 관리한다.

예:

```text
SEC                1.0
기업 IR             1.0

Reuters            0.95
Bloomberg          0.95

CNBC               0.90

Yahoo Finance      0.80

기타 뉴스          0.60
```

예를 들어 Reuters 기사만 존재할 경우

```text
status = DETECTED
confidence = 0.95
```

SEC 또는 IR이 추가되면

```text
status = CONFIRMED
confidence = 1.0
```

으로 변경한다.

---

# 14. SEC 수집 처리

SEC 데이터 수집 시 다음 항목을 저장한다.

```text
accessionNumber

CIK

formType

filingDate

acceptedDate

primaryDocument

items

documentUrl
```

8-K인 경우 Item을 분석한다.

예:

```text
Item 2.02
Results of Operations and Financial Condition

Item 5.02
Departure / Appointment of Directors or Officers

Item 7.01
Regulation FD Disclosure

Item 8.01
Other Events
```

---

# 15. SEC Exhibit 분석

8-K에 Exhibit가 존재하면 별도 수집한다.

대표적으로

```text
EX-99.1
```

은 중요 분석 대상으로 처리한다.

예:

```text
SEC 8-K

↓

Exhibit 탐색

↓

EX-99.1 발견

↓

HTML / PDF 다운로드

↓

본문 추출

↓

LLM 분석
```

---

# 16. Earnings 데이터 추출

실적 이벤트의 경우 다음 데이터를 구조화한다.

```text
Revenue

Revenue YoY

EPS

EPS YoY

Net Income

Operating Income

Gross Margin

Guidance

Cash Flow
```

가능하다면 시장 예상치도 별도 저장한다.

```text
Actual

Consensus

Difference

Beat / Miss
```

---

# 17. 재무 데이터 관리

10-Q / 10-K 및 XBRL에서 주요 재무정보를 추출한다.

대표 항목

```text
Revenue

Gross Profit

Operating Income

Net Income

Assets

Liabilities

Cash

Debt

Operating Cash Flow

Free Cash Flow
```

분기 및 연간 데이터로 관리한다.

---

# 18. LLM 분석 단계

공식 데이터 및 뉴스 취합이 완료된 후 LLM 분석을 수행한다.

LLM이 분석할 항목

```text
이벤트 요약

핵심 변화

실적 영향

가이던스 변화

시장 기대 대비 결과

긍정 요소

부정 요소

리스크

향후 확인 필요사항
```

---

# 19. 데이터 분석 순서

LLM 분석은 다음 우선순위로 데이터를 제공한다.

```text
1. SEC
2. 기업 IR
3. Reuters / Bloomberg
4. 기타 금융언론
5. 기타 뉴스
```

공식 데이터와 언론 보도가 충돌할 경우 공식 데이터를 우선한다.

---

# 20. 전체 처리 흐름

```text
Scheduler
   │
   ├─ RSS Collector
   ├─ SEC Collector
   ├─ IR Collector
   │
   ▼
Raw Data
   │
   ▼
Company Resolver
   │
   ▼
Event Detector
   │
   ▼
Event Candidate
   │
   ├─ 중복 제거
   ├─ 이벤트 분류
   └─ Confidence 계산
   │
   ▼
Adaptive Polling
   │
   ├─ SEC Fast Watch
   └─ IR Fast Watch
   │
   ▼
Verification
   │
   ▼
Event Confirmed
   │
   ▼
Financial Parser
   │
   ▼
LLM Analyzer
   │
   ▼
Corporate Intelligence DB
```

---

# 21. Collector 구성

Collector를 소스별로 분리한다.

```text
Collector

├─ RSSCollector
├─ SECCollector
├─ IRCollector
├─ FinancialCollector
└─ MarketDataCollector
```

Collector는 수집 기능만 담당하고 이벤트 판단 기능은 별도 서비스에서 처리한다.

---

# 22. Scheduler 구성

Scheduler는 Collector별 실행 주기를 제어한다.

예:

```text
CollectionScheduler

RSS
  → every 2 min

SEC
  → every 5 min

XBRL
  → every 10 min
```

Adaptive Polling이 발생할 경우 Scheduler 정책을 동적으로 변경한다.

---

# 23. 권장 서비스 구조

```text
CorporateInformationService

├─ CollectionService
│
├─ CompanyResolver
│
├─ EventDetectionService
│
├─ EventMergeService
│
├─ VerificationService
│
├─ FinancialAnalysisService
│
├─ LLMAnalysisService
│
└─ CollectionPolicyService
```

---

# 24. 수집 정책 관리

수집 주기를 코드에 하드코딩하지 않고 정책으로 관리한다.

예:

```yaml
collection:

  rss:
    normal: 300
    active: 120
    fast: 60

  sec:
    normal: 600
    active: 180
    fast: 60

  ir:
    normal: 600
    fast: 60
```

단위

```text
seconds
```

---

# 25. 기업별 수집 정책

중요 기업은 별도 정책을 설정할 수 있도록 한다.

예:

```yaml
companies:

  NVDA:
    priority: HIGH

  AAPL:
    priority: HIGH

  MSFT:
    priority: NORMAL
```

우선순위

```text
HIGH
NORMAL
LOW
```

에 따라 기본 수집 주기를 다르게 적용할 수 있다.

---

# 26. Rate Limit 관리

외부 API 및 SEC 요청량을 중앙 관리한다.

```text
RateLimitManager
```

역할

```text
요청 횟수 제한

재시도

Backoff

429 처리

사이트별 요청 속도 관리
```

---

# 27. 실패 처리

외부 소스 장애를 고려하여 Retry 정책을 적용한다.

예:

```text
1차 실패
↓
30초

2차 실패
↓
1분

3차 실패
↓
5분

4차 실패
↓
ERROR
```

필요 시 Exponential Backoff 적용.

---

# 28. Raw 데이터 보존

수집 원본 데이터를 삭제하지 않고 저장한다.

예:

```text
raw_source_data
```

저장 항목

```text
source

url

receivedAt

content

contentHash
```

향후 Parser 또는 LLM 분석 로직 변경 시 재분석 가능하도록 한다.

---

# 29. 데이터 계층

권장 데이터 구조

```text
RAW

↓

NORMALIZED

↓

EVENT

↓

ANALYSIS
```

### RAW

외부 데이터 원본

### NORMALIZED

기업 및 문서 구조 표준화

### EVENT

동일 사건 통합

### ANALYSIS

LLM 및 금융 분석 결과

---

# 30. 데이터베이스 주요 테이블

초기 설계 대상

```text
company

company_alias

source

raw_document

sec_filing

financial_statement

corporate_event

event_source

event_analysis

collection_policy

collection_job

collection_history
```

---

# 31. Collection History

모든 수집 결과를 기록한다.

예:

```text
source

target

startTime

endTime

status

documentCount

newDocumentCount

error
```

이를 통해 수집 상태를 운영화면에서 확인할 수 있도록 한다.

---

# 32. 운영 화면

현재 운영 시스템에 다음 화면을 추가하거나 기존 화면에 통합한다.

## 기업정보 수집 현황

표시 항목

```text
데이터 소스

마지막 수집시간

다음 수집시간

수집 상태

수집 건수

신규 데이터

오류
```

---

# 33. 이벤트 모니터링 화면

기업별 이벤트를 시간순으로 표시한다.

예:

```text
05:01 Reuters
NVIDIA Earnings

05:02 CNBC
NVIDIA Earnings

05:03 NVIDIA IR
Q3 Results

05:04 SEC
8-K

05:05
Event CONFIRMED
```

---

# 34. Fast Watch 모니터링

현재 Fast Watch 대상 기업을 확인할 수 있도록 한다.

예:

```text
NVDA

Reason
EARNINGS

Started
05:01

SEC Interval
60 sec

IR Interval
60 sec

Expires
05:31
```

관리자가 직접

```text
Start Fast Watch

Stop Fast Watch
```

를 실행할 수도 있도록 한다.

---

# 35. 운영 알림

다음 이벤트 발생 시 시스템 알림을 생성한다.

```text
중요 이벤트 감지

SEC 공식 확인

실적 발표

M&A

CEO 변경

SEC 조사

Collector 오류

수집 지연
```

---

# 36. 단계별 구현 계획

## Phase 1 — 수집 구조 정리

구현

```text
Collector 인터페이스

RSS Collector

SEC Collector

IR Collector

Collection Scheduler

Raw Data 저장
```

목표

수집 기능과 분석 기능 분리.

---

## Phase 2 — 기업 식별

구현

```text
Company Master

Ticker

CIK

Alias

Company Resolver
```

목표

다양한 데이터 소스의 기업명을 하나의 기업으로 통합.

---

## Phase 3 — Event Detector

구현

```text
이벤트 분류

중복 이벤트 탐지

Event Entity

Event Source 연결
```

목표

기사 중심 데이터 구조를 이벤트 중심 구조로 변경.

---

## Phase 4 — Adaptive Polling

구현

```text
Event Trigger

FAST_WATCH

동적 Polling Interval

Timeout

Normal 복귀
```

목표

중요 이벤트 발생 시 해당 기업을 집중 모니터링.

---

## Phase 5 — SEC 심화 분석

구현

```text
8-K Item Parser

Exhibit Parser

10-Q

10-K

XBRL
```

목표

SEC 데이터를 구조화된 기업정보로 변환.

---

## Phase 6 — 재무 분석

구현

```text
Revenue

EPS

Guidance

YoY

QoQ

Consensus 비교
```

목표

실적 데이터를 분석 가능한 형태로 변환.

---

## Phase 7 — LLM 분석

구현

```text
Event Summary

Impact Analysis

Risk Analysis

Financial Analysis
```

목표

수집 데이터의 의미를 자동 분석.

---

## Phase 8 — 운영 기능

구현

```text
수집 현황

이벤트 현황

Fast Watch

오류 상태

수집 이력

수집 정책
```

---

# 37. 우선 구현 범위

초기에는 기능을 지나치게 확대하지 않고 다음 범위까지 우선 구현한다.

### 1차

```text
RSS
SEC
기업 매핑
Raw 저장
```

### 2차

```text
Event Detector
중복 제거
Event 통합
```

### 3차

```text
Adaptive Polling
Fast Watch
```

### 4차

```text
SEC 8-K
Exhibit 99.1
실적 분석
```

### 5차

```text
10-Q
10-K
XBRL
재무분석
```

### 6차

```text
LLM 기업 이벤트 분석
```

---

# 38. 완료 기준

다음 조건을 만족하면 1차 기업정보 수집 개선 작업을 완료한 것으로 정의한다.

- RSS / SEC / 기업 IR 데이터 수집 가능
- 기업별 Ticker / CIK 매핑 가능
- 동일 기업 뉴스 중복 제거 가능
- 동일 사건을 하나의 Event로 병합 가능
- 중요 이벤트 발생 시 Fast Watch 자동 전환
- SEC 공시 발생 시 이벤트 공식 확인 처리
- 8-K 및 Exhibit 99.1 수집 가능
- 이벤트별 데이터 출처 확인 가능
- 수집 및 오류 이력 확인 가능
- 수집 주기 정책 변경 가능

---

# 39. 향후 확장 대상

초기 구현 이후 다음 기능을 추가 검토한다.

```text
실적 발표 일정 Calendar

Economic Calendar

Analyst Rating

Insider Trading

Institutional Holdings

13F

13D / 13G

Options Flow

Short Interest

Social Media

Earnings Call Transcript

기업 간 연관관계 분석

Supply Chain 분석

Sector Event 분석
```

---

# 40. 최종 목표 구조

최종적으로 기업정보 시스템을 단순 뉴스 수집기가 아니라 다음 구조로 발전시킨다.

```text
Corporate Intelligence Engine

             ┌─ SEC
             │
             ├─ Company IR
             │
External ────┼─ News
Sources      │
             ├─ Financial
             │
             └─ Market Data
                    │
                    ▼

             Event Detection
                    │
                    ▼

              Verification
                    │
                    ▼

              Event Graph
                    │
                    ▼

          Financial Analysis
                    │
                    ▼

              LLM Analysis
                    │
                    ▼

        Corporate Intelligence
```

핵심 설계 원칙은 다음과 같다.

```text
뉴스를 저장하는 시스템
        ↓

기업의 사건을 이해하는 시스템
```

으로 발전시키는 것이다.
---
task_id: T-124
title: 뉴스 입력 오독·본문 절단 위험 보완 후보 — AI 가 시황 헤드라인을 반대로 읽은 사례(카드 19702)와 KB 본문 180자 절단
status: proposed
priority: low
project: StockInvest
created: 2026-10-30
updated: 2026-10-30
base_ref: origin/main 9d087a4
risk_level: R2
roles_involved: [leader, analyst, developer, reviewer, qa, judge]
related_tasks: [T-120-news-score-threshold-query, T-105-news-rag-zero-hits]
tags:
  - type/task
  - domain/analysis
  - domain/rag
aliases:
  - 뉴스오독보완
waiting: [사용자 착수 결정]
---

# T-124 뉴스 입력 오독·본문 절단 위험 보완 (후보 — 착수 전)

## 후보 등록 근거 (T-120 해외 Analyst 점검, 2026-10-30)
- **사용자 결정**: T-120 에서 "(가) 유지로 정리"(2026-10-30) — 임계·질의는 바꾸지 않고, 점검에서 드러난 아래 위험을 별도 후보로 등록한다. 이 task 는 **착수 전 후보**이며 코드·운영 변경이 없다.
- **사례 1건 [확실]**: 카드 19702(NAS:NFLX, `skipped`, 2026-10-30 08:01:37)의 판단문 끝 — "…최근 뉴스에서 알파벳의 하락으로 인한 시장 불안감이 있지만, NASDAQ와 S&P 500의 3일 연속 상승은 긍정적 신호." 입력으로 통과한 기사는 Yahoo "Update: Nasdaq, S&P 500 Snap 3-Day Rise on Alphabet Sell-Off, Inflation Anxiety"(`ci_raw_item` raw_id 1846, 발행 10-30 05:32 KST, 유사도 0.5032)인데 "Snap 3-Day Rise" 는 3일 상승이 **끊겼다**는 뜻이다. 같은 적재분의 다른 기사("Stocks Break Winning Streak…" 등)가 하락 마감을 확인한다. 카드는 검증 관문에 막힌 skipped 라 주문 영향 0.
- **본문 절단 [확실]**: KB 에 저장된 "본문"은 제목+RSS 요약 87~516자(118건 중앙값 210자)이고 위 기사는 180자에서 단어 중간("The Nasdaq Composit")에 끊겨 있다. 유사도 비교도 사실상 제목 임베딩끼리다.
- 표본 1건이다. 일반화(오독이 흔하다)는 **[추측]** — 빈도는 측정하지 않았다.

## 선택지 (가설 — 모두 미검증)
| 안 | 내용 | 비고 |
|---|---|---|
| 1 | M4 `_parse_rss` 의 본문 저장 길이·절단 정책 개선(예: 단어 경계 절단, 길이 상향) | M4(`home-m4-api`)는 공유 운영 서버 — push 는 사용자 승인, 본문 길이 증가는 임베딩·비용 영향 |
| 2 | 장마감 후 프롬프트에 "뉴스 헤드라인의 방향(상승 종료·하락 등)을 신중히 해석, 불확실하면 인용하지 않는다" 지시 추가 | `src/lib/strategy/` = 훅 `SAFETY_PATHS` — Reviewer `최종 판정` 줄 필요 |
| 3 | 뉴스를 판단문에 인용하지 않고 참고로만 쓰게 제한 | AI 판단 출력이 바뀐다 |
- 어느 안이든 AI 입력·출력이 바뀌므로 **4주 관찰 기준선(11-23 경 재검토)**이 움직이고, 공동 인계서 §10 변경 대장에 기록해야 한다. T-120 D1 과 같은 이유로 **구현은 11-23 이후**를 권고한다.

## 착수 조건
1. 사용자 착수 결정.
2. **먼저 읽기 전용 점검**: 최근 N일 장마감 후 카드(created·skipped)의 "최근 뉴스" 인용 문장을 통과 기사 제목과 대조해 오독 빈도를 센다(표본 1건 → 빈도). 빈도가 낮으면 이 task 는 닫는다.
3. 점검 결과를 보고 안 1~3 중 선택 → judge 접수 → Developer → Reviewer → QA → 배포 창.

## 하지 않는 것
임계·질의 변경(T-120 결정), 프롬프트·M4 변경, KB 삭제·백필 — 이 후보 등록으로는 아무것도 바꾸지 않는다.

## 진행 기록
- [2026-10-30 10:52] 후보 등록(Leader). T-120 해외 Analyst 점검 결과에서 파생. 코드·DB·운영 변경 없음.

## 최종 요약
(미작성)

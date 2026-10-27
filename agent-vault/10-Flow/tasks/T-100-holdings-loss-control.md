---
task_id: T-100
title: 보유 종목 손실 통제 규칙 초안 — 읽기 전용 분석(사용자 킬스위치 해제 판단 자료)
status: done
priority: medium
project: StockInvest
created: 2026-10-27
updated: 2026-10-27
base_ref: f7e4444
risk_level: R0
roles_involved: [leader, analyst]
related_tasks: [T-096-strategy-validation-p2-p3, T-064-profit-engine-design, T-079-s00-baseline-and-ledger]
tags:
  - type/task
  - domain/portfolio
  - domain/risk
aliases:
  - 보유손실통제
waiting: [사용자 결정 Q1~Q8 (킬스위치 해제 판단 11-23 경)]
demo_gate:
  required: false
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "leader"
  rule_id: ""
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-100 보유 종목 손실 통제 규칙 초안 (읽기 전용 분석)

## 목표
T-096 이 종결돼(신규 매수 엣지 0) 이 계좌에서 손익을 결정하는 변수는 **보유 미국 3종목**이다. Analyst 가 현재 보유 현황·변동성·현재 설정이 킬스위치 해제 시 자동으로 무엇을 하는지 읽어 **규칙 후보(집중도 축소 일정·손절선·재진입 금지·현금 허용치)** 를 사용자의 11-23 경 판단 자료로 정리한다. 코어 배분(지수 ETF vs 현금)은 사용자 수동 결정 사항으로 의견만.

## 하지 않는 것
주문·킬스위치·설정·코드·DB 쓰기, KIS 호출, 신규 백테스트. **실행·결정은 사용자.** 킬스위치는 ON 유지.

## 근거 / 연결
- 사용자 위임(2026-10-27): "여기서부터는 내 승인없이 너가 판단해서 권고안으로 기존에 계획되어있던 작업 끝까지 진행하고 작업내역만 정리해서 알려줘."
- Analyst 보고 [[T-096-analyst-s1-failure-and-s2s4-value-20261027]] §4-2 순위 1·2. 설계 근거 [[T-064-profit-engine-design]] §13-4, [[T-079-s00-baseline-and-ledger]](S00 보고서 §0·§7·§9, 원장 C03·C08).

## 산출물
`agent-vault/10-Flow/reports/T-100-holdings-loss-control-proposal-20261027.md`

## 진행 기록
- 2026-10-27 20:3x: Leader 접수·Analyst(Fable) 투입(읽기 전용, DB SELECT 만).

## Analyst

- [20:4x] 읽기 전용 분석 완료 → 보고서 `agent-vault/10-Flow/reports/T-100-holdings-loss-control-proposal-20261027.md` (**.gitignore 로 커밋 제외** — 보유 종목·수량·평단·금액 포함, 이 서버에만 보관). DB SELECT 만·쓰기 0·KIS 0·주문 0. 핵심: 한 종목이 총자산의 약 61%·반도체 합계 74%, 보유를 보호하는 동작 중 장치 0(킬스위치는 앱 주문만 막고 KIS 앱 수동 매매는 가능), 사용자 확정 heat 2% 와 현 보유는 양립 불가, 실적 창 12-02~23(해제 직후), 자동 청산 두 스위치를 켜면 하드손절 1.5% 에 3종목 모두 걸려 승인 없이 시장가 매도(켜지 말 것), USD 예수금 약 $800 감소(10-26 17:28~19:29, 앱 주문 0건·원인 미확인). 권고 규칙 후보: 축소 B안(3단계, 실적 창 전 완료)·남는 수량 손절 재설정·재진입 금지 20거래일·heat 는 신규 전용. 사용자 결정 질문 Q1~Q8 은 보고서 §7.

## 최종 요약

**[T-100] 보유 종목 손실 통제 규칙 초안 — 분석 완료, 결정은 사용자(11-23 경)**

- **상태**: 분석 완료(읽기 전용). 코드·설정·주문 변경 없음. 킬스위치 ON 유지.
- **무엇이 바뀌었나**: 없음(보고서 1건). 상세·수치는 보고서(커밋 제외 — 계좌 수치 포함).
- **배포**: 없음.
- **AI 가 검증한 것 / 못 한 것**: DB 의 확정 봉·KIS 평단 스냅샷으로 비중·변동성을 계산했고 현재 설정이 해제 후 무엇을 하는지 코드로 읽었다. 실시간 현재가·매도 가능 수량(KIS 미호출)·수수료/세금 정확값·USD 감소 원인은 확인하지 못했다.
- **사용자가 확인할 것**: ① USD 예수금이 10-26 17:28~19:29 KST 사이 약 $800 줄었다(정확한 잔액은 보고서). 앱 주문은 0건이고 종목 수량 변화도 없다 — 환전·출금 등 앱 밖에서 직접 한 일인지 확인 필요. ② 킬스위치는 앱 주문만 막는다 — KIS 앱의 수동 매매는 지금도 가능하다.
- **사용자가 결정할 것**: 보고서 §7 의 Q1~Q8(축소 안 A/B/C·손절선·재진입 금지·heat 해석·코어 배분 등). 해제 판단 시점 11-23 경에 맞춰 보면 된다(MU 실적 창 12-09~23 전 완료가 목표라면 11-24·12-01·12-08 일정). **자동 청산 스위치(`exit_engine_enabled`·`exit_hard_stop_enabled`)는 지금 켜지 말 것** — 하드손절 1.5% 에 보유 3종목이 전부 걸려 다음 미국 정규장에 승인 없이 전량 시장가 매도가 나간다.
- **남은 일**: 사용자 결정 뒤 규칙을 코드·설정으로 확정하는 후속 task(결정 후 착수).
- **이슈·위험**: 한 종목 비중이 매우 높고(약 61%) 현재 구성의 1개월 1σ 가 총자산의 약 16%다. 이는 이 앱이 아니라 포트폴리오 구성의 위험이다.

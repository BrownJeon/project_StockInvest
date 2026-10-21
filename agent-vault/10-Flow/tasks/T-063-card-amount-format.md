---
task_id: T-063
title: 추천 카드의 매수 금액이 "약 100000.00원"으로 보이는 표시 버그 — 문자열을 숫자로 바꿔 "약 100,000원"으로 서식
status: merged
priority: medium
risk_level: R1
base_ref: 7cd47e756cb768502d6a6ed431dd64327c587780
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-062]
tags:
  - type/task
  - domain/ui
aliases:
  - 카드 금액 서식
  - 100000.00원
created: 2026-10-21
updated: 2026-10-21
demo_gate:
  required: true
  level: "delta"
  status: "drafting"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: "DM-kw-risky-cta"
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-063 — 추천 카드 매수 금액 표시 서식 버그

## 사용자 요구 (2026-10-21 원문, T-062 데모 v1 피드백 중)

> 매수원화 표기의 소수점 단위는 표시하지말고 ,도 붙혀서 가독성을 좋게 해줘. 100000.00원 -> 100,000원

## 원인 (Leader 읽기 전용 확인, 2026-10-21 16:40)

- DB `signals.amount_krw` 는 `DECIMAL(18,2)` 이고 DB 풀(`src/lib/db.ts`)에 `decimalNumbers` 옵션이 없어 mysql2 가 **문자열**(`"100000.00"`)로 돌려준다.
- 코드는 이미 쉼표·소수점 제거 서식을 쓴다: `src/components/ScenarioCard.tsx:56` `amountKrw.toLocaleString('ko-KR', { maximumFractionDigits: 0 })`, `src/app/recommend/page.tsx:241` 같은 서식. 그러나 두 곳 모두 타입을 `number | null` 로 선언했고(`ScenarioCard.tsx:14`, `recommend/page.tsx:19`) **실제 값은 문자열**이라 `String.prototype.toLocaleString` 이 옵션을 무시하고 `"100000.00"` 을 그대로 돌려준다 → "약 100000.00원".
- 다른 화면은 이미 `parseFloat`/`Number` 로 변환해서 쓴다(`ActiveOrdersSection`·`SkippedSignalLog`·`SignalDecisionLog`·`ApprovalQueue`·`SignalFeed`·`MyDecisionTab`·`OrderHistoryTab`·`StrategyHistoryTab`·`OrderDetail`·`MyDecisionSection`·`RecentExecutionsSection`). 문제는 위 **두 파일**에 국한된다. 국내 카드도 같은 증상이다.

## 요구

1. `ScenarioCard.tsx` 와 `recommend/page.tsx` 에서 `amount_krw` 를 **숫자로 변환한 뒤** 서식한다 → "약 100,000원". 유효하지 않은 값(NaN)·0 이하·null 은 지금처럼 표시하지 않는다.
2. 타입 선언을 실제 값에 맞게 바로잡는다(`number | string | null`). 같은 두 파일에서 DECIMAL 문자열을 숫자로 가정하는 다른 필드(`price`·`quantity` 등)가 있으면 같은 방식으로 처리하고 보고한다.
3. 서버·API·`db.ts` 풀 옵션은 **건드리지 않는다**(`decimalNumbers` 를 켜면 모든 쿼리의 반환형이 바뀌어 주문 경로까지 영향 — 범위 밖).
4. 문구·레이아웃·정렬은 바꾸지 않는다(T-062 데모 v2 의 정렬·배지는 별도 화면 작업).

## 변경 범위

`src/components/ScenarioCard.tsx`, `src/app/recommend/page.tsx` (+ 시험). 안전 경로 없음.

## 시험

- 단위: 금액 서식 함수(또는 컴포넌트 렌더)에 `"100000.00"`·`100000`·`"100000"`·`"1234567.89"`·`null`·`""`·`"abc"`·`0`·`"0.00"` → 각각 기대 문자열(`약 100,000원`·`약 1,234,568원`(반올림)·표시 없음 등). 소수 반올림은 `maximumFractionDigits: 0`(반올림)임을 시험에 고정.
- 국내/해외 카드 모두 같은 서식.
- `npm run typecheck`·관련 jest. 격리 사본(`git archive HEAD` + 내 파일만)에서 전체 실행.

## 역할별 지시

- **developer (Opus)**: 위 요구대로. 타 세션 미커밋 변경은 건드리지 않는다. 커밋·push·배포·DB 쓰기·KIS 호출·`npm run build` 금지.
- **reviewer (Sonnet)**: 변이 시험(서식 옵션 제거, `Number()` 제거 등), 국내/해외 동일성, 다른 DECIMAL 문자열 사용처 누락 점검.
- **qa (Haiku)**: 렌더 결과에서 "약 100,000원" 확인(스크린샷 또는 DOM 텍스트), 금액이 없는 카드가 깨지지 않는지.

## 판단 기록 (judge)

- [10-21 17:14] 접수 1차(`judge-result@2`): task_type `local_fix` · complexity 0.92 · risk R2 · developer opus · **demo=full(`DM-kw-full`)** — 요약문의 "페이지"·"정보구조" 같은 단어(부정 문맥)에 키워드 규칙이 반응한 것으로 보인다.
- [10-21 17:15] 접수 2차(부정문의 키워드를 뺀 같은 내용의 요약): complexity 0.91 · risk R2 · developer opus · **demo=delta(`DM-kw-risky-cta`)**, judge 의 화면 변경 분류는 `minor_visual`(신뢰도 1). 키워드 규칙이 "매수 금액" 의 "매수" 에 반응한 것으로 보인다. 결과 원본: 스크래치패드 `judge-T-063-intake.out.json`(1차)·`judge-T-063-intake2.out.json`(2차). 데모 게이트 `init` 은 2차 결과로 기록.
- [10-21 17:15] Leader 관찰: **오탐으로 보인다** — 새 화면·조작 요소·CTA 없음, 숫자 서식 한 줄이고 사용자가 원하는 결과 문자열("100,000원")을 요구에 직접 적었다. 게이트 표(docs/demo-review-gate.md §3)로는 "정보구조·사용자 행동이 바뀌지 않는 표시 버그 수정 = none". 그러나 **생략은 사용자 발화가 있어야 확정**된다(대리 생략 금지) → 사용자에게 "데모 생략"을 요청한다. 생략 전에는 developer 를 배정하지 않는다. (대안: T-062 데모 v2 에 이 서식이 이미 들어가므로 v2 승인에 합쳐 같은 화면 작업 묶음으로 구현할 수도 있다.)

## 종결 — T-062 WP-U 로 합침 (10-21 18:49)

사용자가 T-062 데모 v2 를 "v2승인"(18:48)했고 v2 의 모든 카드 금액이 "약 100,000원" 서식이다. 따라서 이 task 의 구현은 [[T-062-post-market-overseas-p2]] WP-U 에서 한다(같은 파일 `ScenarioCard.tsx`·`recommend/page.tsx`). 이 문서의 요구·원인·시험 절은 WP-U 구현 지시에 그대로 쓴다. 이 task 의 데모 게이트(`drafting`)는 쓰지 않는다.

## Developer

## Reviewer

## QA

## 배포 기록

## 최종 요약

(완료 시 Leader 작성)

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: delta (DM-kw-risky-cta) | 10-21 17:15 |

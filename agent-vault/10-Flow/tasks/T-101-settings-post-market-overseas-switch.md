---
task_id: T-101
title: 설정 > 안전장치에 '해외 장마감 후 분석' 스위치(post_market_overseas_enabled) 추가 — 데모 없이 진행(사용자 생략)
status: doing
priority: high
project: StockInvest
created: 2026-10-27
updated: 2026-10-27
base_ref: 8f91ecb
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex]
related_tasks: [T-062-post-market-overseas-p2, T-072-validation-gate]
tags:
  - type/task
  - domain/settings
  - domain/safety
aliases:
  - 해외분석스위치
waiting: [Developer 구현, Reviewer·Codex·QA, 장외 배포]
demo_gate:
  required: false
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: "DM-kw-waiver"
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-101 설정 > 안전장치에 '해외 장마감 후 분석' 스위치 추가

## 사용자 지시 (발화 그대로, 2026-10-27)
"'post_market_overseas_enabled' 설정에 대해서는 설정메뉴의 안전장치항목쪽에 추가해주고 별도 데모없이 바로 작업진행해줘."

## 배경 (실측)
- `system_config.post_market_overseas_enabled` 는 **키 없음 = 꺼짐**, 정확히 JSON `true` 일 때만 켜진다([[T-062-post-market-overseas-p2]]). 지금 키가 없어 해외 장마감 후 분석(매일 08:00 KST, 미국 종목 시나리오)이 꺼져 있다.
- 설정 API(`src/app/api/settings/*`)·설정 화면에 이 스위치를 다루는 항목이 없다. Leader 의 운영 DB 직접 쓰기는 권한 분류기에서 거부됐고(우회하지 않음), 사용자가 메뉴에서 직접 켜기를 원한다.
- 기존 `PATCH /api/settings/safety` 에 필드→키 매핑(예: `analystEnabled` → `strategy_analyst_enabled`)과 boolean 검증 패턴이 이미 있다.

## 요구사항
1. `GET /api/settings/safety` 응답에 `postMarketOverseasEnabled`(boolean)를 추가한다. **값은 엔진이 쓰는 판정식과 같은 것**(키 없음·`true` 외 값·읽기 오류 = `false`)을 재사용해 화면과 엔진이 갈라지지 않게 한다 — 판정식을 복제하지 말고 `post-market-overseas.ts` 의 기존 함수를 export 해 쓴다. 지금 `getOverrides()` 의 LIKE 목록에 `post_market_%` 가 없으니 이 키만 정확히 읽도록 추가한다.
2. `PATCH /api/settings/safety` 에 `postMarketOverseasEnabled` → `post_market_overseas_enabled` 매핑을 추가한다. **boolean 만 허용**(문자열 "true"·숫자 등은 400), 저장 값은 JSON `true`/`false`. 다른 키에는 영향이 없어야 한다.
3. 설정 화면 **안전장치 섹션**에 기존 토글과 같은 컴포넌트·스타일로 한 줄 추가한다. 라벨 예: "해외 장마감 후 분석(미국 시나리오)". 설명 한 줄 예: "켜면 매일 08:00(KST) 미국 종목 시나리오를 만듭니다. 주문은 하지 않으며 승인·킬스위치·검증 관문이 그대로 적용됩니다." 켜기/끄기 확인 대화상자는 기존 안전장치 토글의 패턴을 따른다. 새 화면·새 섹션·구조 변경은 없다(행 하나 추가).
4. 시험: GET 기본값(키 없음=false)·true/false 반영, PATCH 검증(boolean 만·잘못된 타입 400·다른 키 불변), 엔진 판정식과 GET 값 일치, 설정 화면 렌더(토글 존재·상태 표시·저장 호출).
5. 국내 동작·기존 안전장치 항목·엔진(`post-market-overseas.ts` 로직)은 바뀌지 않는다(판정식 export 한 단어 외).

## 하지 않는 것
- **스위치 값 자체를 바꾸지 않는다**(배포 뒤 사용자가 메뉴에서 켠다). 엔진 로직·cron·주문 경로·킬스위치·D5 관문 변경 금지. 비밀 값 출력 금지. 새 화면·섹션 신설 금지.

## 소유 파일 (예상)
`src/app/api/settings/safety/route.ts`(+`__tests__`, **훅 감시 대상**) · `src/app/settings/SettingsPage.tsx`(+시험) · `src/lib/strategy/post-market-overseas.ts`(판정식 export 만, **훅 감시 대상 여부는 `SAFETY_PATHS` 로 확인**). 훅 감시 파일을 커밋할 때는 이 task 의 `## Reviewer` 마지막 판정 줄이 필요하다(메시지에는 T-101 만 인용).

## 데모 게이트
사용자가 "별도 데모없이 바로 작업진행해줘"라고 했다 → judge 판정과 무관하게 `check.mjs waive` 로 생략을 기록한다.

## 배포
push=배포. 장외 창(15:40~22:00 KST)에만. 지금(10-27 23시대)은 미국 정규장 중이라 **다음 창(10-28 15:40 이후)**. 배포 후 사용자가 메뉴에서 켜면 첫 정기 실행은 그다음 날 08:00 KST.

## 판단 기록 (judge)

- [2026-10-27 23:2x] intake: engine=rules → risk=R1 / developer_model=opus(`MD-judge-failed-opus`) / **demo=none**(`DM-kw-waiver` — 사용자 생략 요청 감지) / next=assign | 입력 `scratchpad/judge-T-101-intake.json`. `check.mjs init` → `DEMO_GATE_INIT`(not_required/none), `waive` 는 "데모가 필요 없는 task 입니다(생략 불필요)"로 거부됨(정상 — 이미 불필요), `check` → `DEMO_GATE_PASSED`.
- **Leader override(위험)**: R1 → **R2**. 변경 대상 `src/app/api/settings/safety/` 가 커밋 훅 `SAFETY_PATHS` 의 안전 경로라 독립 감사(Reviewer 판정 줄)·Codex(`CX-r2-post-review` 예상)·QA 를 모두 거친다.

## 진행 기록
- 2026-10-27 23:2x: Leader 접수. 사용자 지시 원문 기록, 데모 생략 기록 진행.

## Developer

## Reviewer

## QA

## 배포 기록

## Codex 검토

## 최종 요약

(완료 시 Leader 가 작성)

## 데모 검토 (demo gate)

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | - |
| - | 해당없음 | - | - | judge: none (DM-kw-waiver) · 생략 요청 감지(확정 전) | 10-27 23:11 |

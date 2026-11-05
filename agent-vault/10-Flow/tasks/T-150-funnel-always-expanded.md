---
task_id: T-150
title: 거래 운영 기록의 장중 룰 평가 깔때기 상세 상시 표시
status: review
priority: low
project: StockInvest
created: 2026-11-04
updated: 2026-11-05
base_ref: 5696d8cb069650025471d877817116f902390a92
risk_level: R2
roles_involved: [leader, judge, designer, developer, reviewer, qa]
related_tasks: [T-108, T-130, T-144]
tags:
  - type/task
  - domain/ui
  - domain/metrics
aliases:
  - 운영 기록 깔때기 항상 펼침
demo_gate:
  required: true
  level: "delta"
  status: "approved"
  version: 2
  repo_path: "mockups/T-150-funnel-always-expanded-v2.html"
  artifact_url: ""
  content_sha256: "389cfb9eb6f8f595a452139aa7f58e274cc6d149812ec9bb90413753ce89f587"
  decided_by: "judge"
  rule_id: "JV-ui_change"
  approved_by: "user"
  approved_at: "2026-11-04T03:40:29.064Z"
  approval_quote: "데모 확인했어. 이대로 적용해주고"
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
  approval_source: "historical"
---

# T-150 거래 운영 기록의 장중 룰 평가 깔때기 상세 상시 표시

## 목표

- 사용자 요청 요지(상위 메인 세션 전달): 거래 → 운영 기록의 장중 룰 평가 깔때기를 항상 펼쳐서 표시한다.
- 이 화면에서 단계별 수치·최다 차단·청산 및 시장상태 부가 설명을 추가 클릭 없이 볼 수 있게 한다. 펼침/접힘 조작과 해당 방향 표시는 이 화면에서 제거한다.
- 적용 범위는 `EvalFunnelCard`의 `source="session"` 소비자인 거래 운영 기록이다. 기본 `legacy` 소비자의 기존 펼침/접힘 동작은 보존한다(상위 메인 범위 확정).
- 현재 날짜·시장 선택·집계·API·주문·안전장치·운영 데이터는 이 표시 변경에 포함되지 않는다.
- 최초 구현 지시에는 commit·push·배포 승인이 없었다. 이후 사용자가 검증 완료 및 운영 커밋·푸시를 명시 승인했다(아래 최신 Leader 기록). QA 전체 통과 후 T-150 범위만 운영에 반영한다.
- [추가 요청, 2026-11-04] 사용자가 v2를 확인한 뒤 “데모 확인했어. 이대로 적용해주고 용어를 평가 깔대기 -> 평가 필터로 변경해줘. 혹시 깔대시라는 용어가 다른 화면에도 있을 경우 함께 수정해줘”라고 지시했다. `깔대기`·`깔대시`는 현행 화면의 `깔때기`를 가리키는 것으로 해석한다. 사용자 노출 명칭을 `평가 필터`로 통일한다. 데이터/파일/API 식별자 및 개발용 명칭 변경은 범위 밖이다.

## 관련 과거 이력 요약

- [[T-108-automation-menu-home-overhaul]]에서 거래 운영 기록과 세션별 평가 깔때기 화면을 도입했다. 상세 영역은 현재 제목 클릭으로 펼치는 방식이다.
- [[T-130-t108-visual-followups]]에서 운영 화면 문구 및 표시를 보완했다.
- [[T-144-trade-log-overseas-label]]은 해외 탭의 ET 표시만 제거했다. 시장별 세션 계산과 조회 범위는 유지했다.
- 이번 세션의 읽기 전용 원인 조사에서 `룰 미발화`는 상세 이력이 삭제된 표시가 아니라 최다 병목 한 줄임을 확인했다. 사용자 요청은 그 아래 상세를 상시 보이게 하는 것이다.

## 역할별 지시사항

- Leader: 현재 task만 조율하고 Judge 결과로 데모 수준을 초기화한다. 병행 T-148·T-149 및 공통 현황 변경을 보존한다.
- Judge: 상시 펼침과 클릭 제거의 UI 변경을 intake로 판정한다. 결과 JSON 및 Codex 모델 라우터 결과를 기록한다.
- Designer: Judge가 데모를 요구하면 변경 영역의 데모를 작성하고 승인 후 구현 가이드를 남긴다.
- Developer: 데모 게이트 검사가 통과한 뒤 `src/components/dashboard/EvalFunnelCard.tsx`에서 session 상세를 상시 렌더한다. session 제목의 토글 동작·접힘 아이콘을 제거하고 legacy 동작은 유지한다. 필요한 직접 관련 시험만 보완한다.
- Developer 추가 범위: `src/app/recommend/TradeLogPanel.tsx`의 영역 제목·스크린리더용 시장 라벨과 `EvalFunnelCard.tsx`의 session/legacy 제목 및 청산 부가 설명에 있는 사용자 노출 `깔때기`를 `평가 필터`로 바꾼다. 코드 주석·과거 승인 목업·데이터 키·API 경로는 일괄 치환하지 않는다.
- Reviewer: 실제 scope에 대해 표시 변경과 legacy 회귀 여부를 독립 확인하고 본인 섹션에 결과를 기록한다.
- QA: 운영 API·DB 쓰기 없이 격리된 데이터로 국내·해외·0건·조회 실패를 확인한다. session 상세 상시 표시와 제목 클릭 후 유지, legacy 토글 회귀, 대표 모바일/데스크톱 폭을 검증한다.

## 판단 기록 (judge)

- [2026-11-04 KST] 정식 T-150 intake 결과를 `agent-vault/10-Flow/artifacts/T-150-intake-20261104.json`에 보존했다. engine=jev·task_type=feature·complexity=0.84·needs_info=false·risk=R2·developer_model=opus·next=demo_first·demo=delta/designer. 적용 규칙은 `JV-ui_change`·`DM-kw-risky-cta`, 위험도/모델 상향은 `R2-kw-payment`·`MD-r2-opus`다. 도구 판정값을 임의로 낮추지 않았다. Claude용 developer_model을 Codex 모델명으로 사용하지 않으며 실제 호출 전 Codex 모델 라우터 결과를 따른다.

- [C2 Jev 판정·호출 미수행, 2026-11-04 KST] `/tmp/judge-T150-C2.out.json`의 정식 결과는 `codex_required=true`, `mode=adversarial-review`, `focus=design_assumption`, `budget_rule=CX-limit-unknown-r2`, `codex_switch=on`, 적용 규칙 `CX-r2-post-review`다. 상위 메인 지시에 따른 `override: codex_unavailable_in_codex`. Codex 세션에서 별도 Codex CLI·외부 codex 역할은 실행하지 않았고 코드·diff 원문을 전송하지 않았다. 따라서 C2 설계 전제의 외부 적대 검토 범위는 `skipped`이며 내부 Reviewer/QA 결과와 구분한다. 이 기록은 Claude 전용 판정·외부 검토의 실행 또는 완료를 뜻하지 않는다. 원본 JSON은 수정하지 않았다.

## Leader

- [착수, 2026-11-04 KST] ACTIVE·board와 기존 task 및 `EvalFunnelCard`를 확인했다. 현행은 `expanded=false`로 시작하고 제목 클릭·회전 아이콘·조건 렌더를 사용한다. 지정 UI 파일에는 착수 전 미커밋 변경이 없었다. 작업본 main은 origin/main보다 9커밋 앞서 있고 T-148·T-149가 운영 배포 대기이므로 함께 push하지 않는다.
- [범위 확정, 2026-11-04 KST] 상위 메인 세션이 `source="session"`만 상시 펼침으로 바꾸고 legacy는 유지하도록 확정했다. 구현 전 Judge 결과와 데모 게이트를 따른다.
- [검토 요청, 2026-11-04 KST] 정본 CLI `init`으로 delta·drafting 초기화, Designer v1 `lint` 통과, `status --to review_requested --version 1 --repo-path mockups/T-150-funnel-always-expanded-v1.html` 실행. 해시 `1694ce1ad7b96fd84f501777d697a6c1bfbdfd18b92135776fd74f249002fdd9`. 승인/waive/activate는 실행하지 않았다. `check`는 `review_requested`에서 사용자 승인 미기록으로 예상대로 차단된다. 브라우저 확인과 사용자에게 검토본을 보여주는 작업은 상위 메인 세션이 진행한다.
- [v2 검토 요청, 2026-11-04 KST] 상위 메인 검증에서 v1 단계명이 현재 운영 데이터와 다름을 발견해 Designer가 v2를 작성했다. v1은 사용자에게 승인 요청할 대상에서 제외했다. v2 단계명 6개가 `eval-funnel-labels.ts`의 `FUNNEL_STEPS`와 일치함을 확인했고 `lint --expect T-150-v2` 통과. 정본 CLI로 `drafting --version 2` 후 `review_requested --version 2 --repo-path mockups/T-150-funnel-always-expanded-v2.html` 전환. 승인 대상 해시는 `389cfb9eb6f8f595a452139aa7f58e274cc6d149812ec9bb90413753ce89f587`이다. 사용자 승인 대기 상태를 유지하며 실제 브라우저 검증은 상위 메인 세션이 담당한다.
- [승인 수신·기계 검증 실패, 2026-11-04 KST] 상위 메인에서 위 추가 요청 원문에 포함된 v2 승인 발화를 전달받았다. 정식 CLI `approve --version 2 --quote <사용자 원문>` 실행 결과 `DEMO_GATE_REFUSED`: 최근 24시간 사용자 발화·사람 세션 대화 기록에서 원문을 찾지 못했다. 실제 도구는 `UserPromptSubmit`의 `prompts.jsonl`과 Claude 형식/경로의 human transcript만 읽고 Codex 형식은 지원하지 않는다(`gate.mjs:80~105`). 현재 prompts에 해당 승인 문구도 없다. 승인 상태·증거 파일을 수동 작성하거나 테스트용 경로 환경변수로 우회하지 않았다. 같은 사용자 승인을 재요청하지 않고 메인에 지원 범위와 거부 사유를 보고했다.
- [추가 용어 범위, 2026-11-04 KST] `src`의 runtime 문구를 조사한 결과 실제 사용자 노출은 `EvalFunnelCard.tsx`와 `TradeLogPanel.tsx` 두 파일이다. 추가 요청은 기존 평가 흐름의 순수 명칭 교체이며 사용자가 그 변경까지 명시했다. 승인된 v2 원본 파일·해시는 보존한다. 구현 전 유효 게이트 검증 문제는 별도로 해소해야 한다.
- [사용자 별도 진행 지시, 2026-11-04 KST] 사용자가 도구 문제에 대해 “그거랑은 별개로 작업해줘”라고 명시했다는 원문을 상위 메인에서 전달받았다. 앞서 수신한 v2 승인 및 명칭 교체 지시와 이 발화에 따라 앱 구현·독립 검토·QA를 진행한다. 이 사용자 지시는 앞의 도구상 검사 선행 지시보다 우선한다. `demo_gate`의 기계 상태는 `review_requested`로 남아 있고 정식 `check` 미통과·`activate` 미실행 사실도 유지한다. 이를 도구 승인 완료로 표시하거나 증거를 대신 만들지 않는다. 도구의 Codex 발화 지원 보완은 별도 문제로 관리한다. commit·push·배포 승인은 포함되지 않는다.
- [Codex 모델 라우팅, 2026-11-04 KST] 정식 T-150 intake JSON을 `codex-model-router.mjs` stdin에 전달한 결과 `model=gpt-6.1-terra`, `reason=below_threshold`, `complexity=0.84`, `threshold=1.5`를 받았다. 구현 역할 호출 시 이 모델을 명시하는 책임은 상위 메인에 전달했다.

- [운영 반영 승인 수신, 2026-11-04 KST] 상위 메인에서 사용자가 T-150 변경의 검증 완료 및 운영 커밋·푸시를 명시 승인했음을 전달받았다. 승인 범위는 거래 운영 기록 session 상세 상시 표시와 모든 실제 사용자 노출 명칭의 `평가 필터` 통일이다. 기존 v2 사용자 승인 사실과 정식 CLI의 Codex 발화 미지원·기계 승인 미등록은 그대로 유지한다. 운영·origin 기준 `5696d8c` 위에 이 범위만 격리 통합하고 Reviewer 및 QA 검증을 완료한 뒤 push한다. 공유 main의 후속 T-147·T-148 기록 커밋과 병행 변경은 자동 동승시키지 않는다. 기존 QA는 일부 fixture·34/34 시험의 부분 검증이며 전체 통과 선언은 아직 없으므로 그 기록을 배포 전 QA PASS로 대체하지 않는다.

- [격리 통합 준비, 2026-11-04 KST] Ubuntu 로컬에 새 clone `/home/brownjeon/.node-local/stockinvest-t150-release-20261104`, branch `codex/t150-eval-filter-release`를 만들고 origin/main `5696d8cb069650025471d877817116f902390a92`를 기준으로 체크아웃했다. T-150 UI 2파일·직접 시험 1파일·이 task·Judge JSON·데모 v1/v2만 복사했다. 코드 diff 3파일 +37/-10, `git diff --check` 통과. 기존 QA가 검증한 3파일 SHA와 동일함을 대조했다. 신규 clone에서 `install-git-hooks.sh` 및 `test-git-hooks.sh` 전체 통과(`/tmp/t150-hooks-20261104.log`). 이는 훅 설치 검증이며 앱 QA를 대신하지 않는다. 공유 main의 후속 문서 4커밋은 격리본에 포함하지 않았다. 검토·QA는 이 격리본에서 수행하고 push는 전체 QA PASS 이후 메인 조율에 따른다.

- [라벨 너비 보완 반영, 2026-11-04 KST] 개발자가 session 단계 라벨의 데모 일치 보완을 수행한 파일만 격리 배포 작업본에 다시 복사했다. 전후 SHA는 `de4e01f19f6d647ad956a738e59a47cbc488ad234b9d9a339ce78dc9212e6b7b` → `7b35a6363dde08849d638d0cfeec709f9c5f82c6d31cbc0ea141df03ff1192c3`이며 NFS 원본·격리본 모두 기대 SHA와 일치했다. 다른 코드 2파일은 변경하지 않았다. 새 diff는 코드·시험 3파일 +41/-14, `diff --check` 통과. 격리 HEAD와 원격 main을 각각 조회해 둘 다 `5696d8cb069650025471d877817116f902390a92`임을 확인했다. 앞선 SHA 기준 QA는 현재 파일의 통과 증거로 재사용하지 않으며 Reviewer·QA가 재검토 중이다. commit·push 미실행.

## Designer

## Developer

- [2026-11-04 KST] 승인 도구 오류로 정본 gate가 통과하지 않은 상태에서 사용자가 승인한 화면 변경을 진행하라고 명시 지시해 구현했다. gate 상태·증거는 임의 변경하지 않았다. session 상세 상시 표시 및 토글·화살표 제거, legacy 토글 유지, 화면·접근성 문구를 평가 필터로 변경. 관련 렌더 테스트를 추가했다. `git diff --check` 통과. 로컬 Jest는 NFS 읽기 대기로 중단(exit 130)하여 결과 미확인; QA 격리 환경 재실행 필요.

## Reviewer

- [2026-11-04 KST, Leader 수신 전재] 독립 Reviewer 재감사 원문: “T-150 보완 포함 3파일 독립 재감사: 코드 변경 범위 내 결함 없음. session 라벨 86px·nowrap 및 막대 minWidth 0, legacy 68px/기존 토글 보존; 수치 계산·API·주문 경로 diff 없음. EvalFunnelCard SHA256 7b35a6363dde08849d638d0cfeec709f9c5f82c6d31cbc0ea141df03ff1192c3; 다른 두 파일 해시 QA 기록과 동일. 실제 브라우저 재검증·전체 운영 및 gate machine pass는 미확인입니다.” 실제 검토 범위: `src/components/dashboard/EvalFunnelCard.tsx`, `src/app/recommend/TradeLogPanel.tsx`, `src/__tests__/t108-trade-render.test.ts`. 이는 독립 Reviewer가 상위 메인에 전달한 결과를 Leader가 전재한 기록이다. Reviewer가 별도 대문자 훅 최종 판정 줄을 발급했다고 주장하지 않는다. 이후 브라우저 검증은 QA 기록과 구분한다.

## QA

- [2026-11-04 KST] QA 산출물 정리: 브라우저 뷰포트 복구·QA 탭과 localhost 서버 종료. 직접 만든 Mac 임시 QA 디렉터리의 정규 파일 1,069개와 서버 임시 사본을 삭제했다. 저장된 스크린샷 파일은 0개다.

- [2026-11-04 KST, 최종] 최종 SHA `7b35a6363dde08849d638d0cfeec709f9c5f82c6d31cbc0ea141df03ff1192c3`에서 기본 Jest 재실행: Mac 로컬 격리 사본에서 프로젝트 원본 `jest.config.js`, `@swc/jest`, `@swc/core` 1.15.26을 사용하고, 동일 버전의 공식 macOS arm64 optional binding만 임시 `NODE_PATH`에 별도 설치했다. `node ./node_modules/jest/bin/jest.js src/__tests__/t108-trade-render.test.ts --runInBand --silent --no-cache` 1 suite / 34 tests 통과(exit 0, Jest 13.112초). 기존 개발 의존성·저장소·서버 공유 락은 변경하지 않았다. 이전 TypeScript 대체 변환기만 검증됐다는 제한을 해소한다. 아래 합성 fetch 및 실제 CSS browser 시험 결과와 묶어 **변경된 표시·기능 범위 QA PASS**로 판정한다. 실 API·로그인된 실제 운영 화면·실매매 안전장치 전체는 검증 범위 밖이다. 사용자가 데모 v2를 승인하고 도구 문제와 별개로 진행하라고 명시했으나 프로젝트 데모 승인 CLI의 실제 기계 상태는 여전히 `review_requested`/`BLOCKED`다. 이를 통과로 기록하지 않으며 관련 후속은 Leader가 판단한다.

- [2026-11-04 KST, 재검증] Reviewer 재감사 후 최종 `EvalFunnelCard.tsx` SHA-256 `7b35a6363dde08849d638d0cfeec709f9c5f82c6d31cbc0ea141df03ff1192c3`, `TradeLogPanel.tsx` `dd12722a803e4d17123dccdfa87b86b525e7fc4f780d1f0f3345da427f16c202`, 시험 파일 `a56ed92cb3159199e006bece83835c4c2b141b748ea676830b8dc64939f95015`. 운영 DB·API에 접근하지 않는 Mac 임시 디렉터리에서 최종 파일과 실제 `TradeLogPanel`, `EvalFunnelCard`, `globals.css`, `ops.module.css`를 사용하고 fetch/Next 링크만 합성한 브라우저 fixture를 실행했다. Chrome 156.0.8078.80, DPR 1, `lang=ko`, dark 배경 `rgb(15,17,21)`, 글꼴 loaded 조건의 360×800·412×915·1280×900에서 여섯 단계 레이블 각각 86×14px(한 줄), 가로 스크롤 0, 시장 버튼 44px을 확인했다. 360px 라벨 14–100px·막대 108–268px·수치 276–346px로 서로 겹치지 않았다. 국내→해외 변경 시 합성 종목평가 42→51과 상세 상시 표시, 제목 클릭 시 상세 유지, 0건·조회 실패 표시, legacy 클릭 펼침과 라벨 68px 보존을 확인했다. XSS 문자열 `<img src=x onerror=alert(1)>`은 텍스트로 남고 img 0개였다. 비교한 변경 전 운영 코드(sha256 `ef120e9dabef62dda811aca5b153f0b71854a9d67151cb8ddb5109ab7f0f515b`)의 펼침 레이블은 360/412/1280에서 기존 68×28px(두 줄)였다. 최종 파일 기준 Mac 임시 TypeScript 변환기로 동일 Jest 파일 34/34 통과(기존 SWC 변환기와 다름); 서버 정본 SWC 재실행은 T-149 공유 락 점유로 `NOT_VERIFIED`이고 직전 변경 SHA에서만 34/34였다. 시각 표시·기능 범위 PASS이며 실제 인증·운영 연동·실주문·보안 전체·라이트 테마 및 legacy 키보드 조작은 `NOT_VERIFIED`. 데모 승인 CLI는 승인 발화 인식 실패로 blocked이나 사용자 승인과 별도 진행 지시를 상위에서 확인했으며 도구 통과로 기록하지 않는다. 스크린샷 파일 저장 0개.

- [2026-11-04 KST] Reviewer 보고 수신 후 운영 DB에 연결하지 않은 Ubuntu 격리 사본에서 개발자 지정 Jest `src/__tests__/t108-trade-render.test.ts --runInBand --silent` 실행: 1 suite, 34/34 통과(`flock /tmp/stockinvest-heavy-tests.lock`, `nice -n 10`). 검증한 변경 파일 SHA-256: `EvalFunnelCard.tsx` `de4e01f19f6d647ad956a738e59a47cbc488ad234b9d9a339ce78dc9212e6b7b`, `TradeLogPanel.tsx` `dd12722a803e4d17123dccdfa87b86b525e7fc4f780d1f0f3345da427f16c202`, 시험 파일 `a56ed92cb3159199e006bece83835c4c2b141b748ea676830b8dc64939f95015`. 실제 수정 `EvalFunnelCard`를 임시 번들로 만들고 합성 fetch·임시 스타일을 쓴 IAB 격리 fixture에서 session 국내→해외 데이터 42→51·6단계 상시 표시, 제목 클릭 후 유지, legacy 초기 접힘→클릭 펼침을 확인했다. 412×915, DPR 1, 글꼴 loaded, 문서 폭/스크롤 폭 412/412로 가로 초과 없음. 브라우저 화면은 도구 응답으로만 확인했고 저장한 스크린샷은 0개다. 실제 전체 앱·TradeLogPanel 레이아웃 및 CSS, 360/1280px·light, 실제 API·운영 화면, 시각 QA 전체는 `NOT_VERIFIED`다. 앱/주문/안전 코드 및 DB/API 호출을 하지 않아 실매매 안전장치 전체 시험도 수행하지 않았다. 데모 v2의 사용자 승인·별도 진행 지시는 전달받았지만 `check`는 `DEMO_GATE_BLOCKED`, `review_requested`(사용자 승인 기록 미인식)이며 기계적 gate 통과로 표기하지 않는다. 부분 기능 시험 결과이며 전체 QA PASS는 선언하지 않는다.

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: delta (JV-ui_change) | 11-04 12:27 |
| v1 | 검토요청 | mockups/T-150-funnel-always-expanded-v1.html | - | 사용자 검토 요청 | 11-04 12:27 |
| v2 | 작성중 | mockups/T-150-funnel-always-expanded-v1.html | - | - | 11-04 12:28 |
| v2 | 검토요청 | mockups/T-150-funnel-always-expanded-v2.html | - | 사용자 검토 요청 | 11-04 12:28 |
| v2 | 승인 | mockups/T-150-funnel-always-expanded-v2.html | - | historical transcript (consent interpreted separately) | 11-04 12:40 |

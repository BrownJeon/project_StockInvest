---
task_id: T-153
title: 공통 Codex 데모 승인 도구 재검증
project: StockInvest
status: done
base_ref: dbeca9d8873c599ac54009ddede954e79423db18
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-150, T-151]
tags: [type/task, domain/tooling, domain/governance]
created: 2026-11-05
updated: 2026-11-05
waiting: "별도 QA 추가 여부(표준 순환의 QA 생략 확정) · 선택 훅 생성기 16건 pwsh 재현 환경 · 실제 Codex 훅 런타임·다른 플랫폼 관측 — 사용자 결정·환경 제약"
execution_context:
  schema_version: 1
  origin_tool: codex
  current_tool: claude
  current_procedure: claude_standard
  current_scope: "인계된 고정 6파일의 해시 대조와 격리 환경 최종 검사·회귀망 변이 감도·읽기 전용 승인 상태 확인과 기록. 운영 push·배포·훅 신뢰 상태 변경은 범위 밖"
  last_event_id: exec-003
---

## 실행 도구·절차 이력

| 이벤트 ID | 시각(KST) | 사건 | 이전 → 현재 담당 / 현재 절차 | 범위·인계 대상·남은 일 | 근거 |
|---|---|---|---|---|---|
| exec-001 | 2026-11-05 14:32 | start | 없음 → codex / codex_scoped | 기존 공통 도구 변경의 별도 재검증, 결함 분석 및 다음 작업 조율. Claude 최종 검증의 실제 수신 미확인 | 현재 Codex 대화의 사용자 재검증 지시와 실제 Leader·Reviewer·QA 역할 호출 |
| exec-002 | 2026-11-05 20:00 | handoff_prepared | codex → codex / codex_scoped | Claude 최종 검증과 작업 종결용 로컬 인계문 준비. 실제 수신 미확인. 별도 비운영 T-153TEST v1 실제 Codex 사용자 발화 대기 | 사용자 실제 Codex 검증·Claude 인계 지시, [T-153 인계문](../../../docs/handovers/T-153-claude-handover-2026-11-05.md), Codex 메인 세션의 `review_requested` 등록 보고 |
| exec-003 | 2026-11-05 23:17 | handoff_received | codex → claude / claude_standard | 고정 6파일 해시 대조·격리 최종 검사·변이 감도·읽기 전용 상태 확인과 기록 인수. 선택 훅 생성기 16건(pwsh 부재)·실제 훅 런타임·다른 플랫폼·비협조 편집자 경쟁은 미검증으로 남김 | 사용자 지시 「T-153의 docs/handovers/T-153-claude-handover-2026-11-05.md를 읽고 최종 검증을 이어받아줘」(2026-11-05), [T-153 인계문](../../../docs/handovers/T-153-claude-handover-2026-11-05.md), Claude 세션 `3122e789-6938-4e57-9c63-e0a2abf34aaf` |

## 목표

- 사용자가 데모를 보고 그대로 적용하라고 한 경우, 승인 대상과 버전이 명확한 맥락을 공통 승인 도구가 인식하도록 한 변경을 역할별로 재검증한다. 기존 엄격 승인 경로와 프로젝트별 승인 범위를 유지한다.
- 적용 범위는 공통 도구와 기존 선택 생성기로 설정된 대상 프로젝트다. 이 task의 base_ref는 StockInvest 작업문서 기준이며, 상위 공유 도구 경로 자체는 Git 저장소가 아니므로 구현 리뷰·QA 입력은 허용된 파일 목록과 각 SHA-256으로 식별한다.
- 기존 사용자 승인 문구를 재요청하거나 합성 승인으로 대체하지 않는다. 거래·DB·서버 운영 및 다른 프로젝트의 기존 상태를 보존한다. 코드·사용자 데이터를 외부 브로커에 전송하지 않는다.

## 관련 과거 이력 요약

- [[T-150-funnel-always-expanded]]은 평가 필터 UI와 기존 v2 데모 승인 작업이다. 정본 CLI의 읽기 전용 check에서 historical 증거의 v2 승인 및 해시를 확인했다. 해당 UI 작업의 기존 파일, 승인, 상태와 커밋·배포 절차는 별개다.
- [[T-151-agent-procedure-pilot]]의 지침 전달·실행 증거 분리 기준을 적용한다. 정본 파일 존재, fixture 결과, 실제 세션 전달, 상대 도구의 인수를 구별한다.

## Leader 지시사항 (역할별)

- Judge: 접수 입력에는 요청 요약과 예정된 경로만 쓴다. 결과와 적용 모델 근거를 남긴다.
- Developer: 승인 도구에 이미 반영된 contextual 경로의 결함을 최소 수정한다. 현재 리뷰에서 보고된 과거 receipt 재사용과 subagent 등록으로 인한 세션 귀속 불일치를 먼저 분석한다. 실제 수정은 근거와 고정 파일 범위를 확인한 뒤 지정 사본에서 수행한다. 실제 증거·T-150을 건드리는 시험을 실행하지 않는다.
- Reviewer: 공통 demo-gate 실행 코드·회귀 테스트, 필요한 선택 생성기/대상 설정·절차 파일의 허용 목록만 읽는다. 승인 증거의 세션·프로젝트·task·버전·경로·해시 귀속과 대상 모호성, 과거 receipt 재사용, 다른 세션·거절·수정·위조, 락·중복·중간 실패, historical 보존, 기존 strict 및 Claude 경로를 독립 감사한다. 코드·파일은 직접 편집하지 않고 Leader에게 판정과 근거를 전달한다.
- QA: 승인 상태·HOME·프로젝트 경로를 격리하고 동결된 구현본으로 정상·거절·재시도·동시성 및 선택 생성기 회귀를 검증한다. 기존 T-150의 읽기 검증, 합성 이벤트, 실제 새 요청에 대한 사용자 훅 관측을 구분한다. 실제 후크 테스트는 확인된 안전한 새 요청에 한하며 기존 승인 증거를 재사용하지 않는다.
- Leader: C1·C2·C3 해당 여부와 실행 범위를 기록한다. 이번 작업의 외부 전송 금지 제약과 공유 도구 저장소 특성을 지킨다. 실제 Claude 주 작업 세션이 범위와 검증본을 수신·수락했다는 증거가 생기기 전에는 현재 담당을 전환하지 않는다.

## Leader

- [14:32] 앞선 진행 기록에는 공유 도구 contextual 승인 경로와 선택 프로젝트 설정이 반영되었다고 남아 있다. 이번 역할 호출에서 stale receipt 수용 결함이 보고되어 현재 후보를 완료로 판정하지 않는다. 메인 세션과 subagent의 등록 ID가 갈릴 경우 발생할 수 있는 거부는 소스·절차 근거와 실제 훅 관측 여부를 구분해 추가 확인한다.
- [14:32] T-150은 read-only check에서 approved v2, hash verified, DEMO_GATE_PASSED. 새 자연어 사용자 승인 전체 경로는 실제 훅 관측이 아직 없다. 별도 운영 변경·배포 및 Claude 최종 검증 인수 증거도 현재 없다.
- [14:33] Codex README는 root/main 세션에서 검토 요청을 등록하라고 명시한다. 공통 워크플로우와 생성 Leader의 표는 등록 주체를 Leader로만 명시한다. 도구는 등록 호출의 CODEX_THREAD_ID를 그대로 기록하므로, 메인과 서브에이전트의 ID가 다르면 해당 사용자의 훅과 매칭되지 않는다. 후속 실행에서는 메인 세션이 검토 요청 등록·승인 CLI를 직접 담당한다. 실제 서브에이전트의 훅 발생 및 거부는 관측하지 않았다.
- [14:36] 접수 판단 적용 `override: user_scope_explicit, no_screen_delta`. Jev 원출력은 `needs_info=true`, `next=ask_user`, `demo=delta/designer(JV-ui_change)`다. 사용자는 이번 대화에서 승인 도구 변경의 역할별 재검증과 남은 작업 진행을 지시했고, 앞서 같은 도구의 자연어 승인 인식 수정과 다른 프로젝트 적용을 승인했다. 요청 범위에서 사용자에게 다시 물어야 할 구체적인 정보는 확인되지 않았다. 재현한 결함의 범위는 워크스페이스 공통 `.claude/tools/demo-gate/codex-evidence.mjs`, `historical-plan.mjs`, 회귀 시험 `test/demo-gate.test.mjs`다. 이 범위에는 화면·디자인 변경이 없으므로 접수 판정의 재질문·화면 데모 단계를 적용하지 않고 공통 도구 작업을 진행한다. 실제 사용자 훅, 수정본의 검증 및 Claude 인수 상태는 미확인으로 유지한다.
- [15:01] 독립 Reviewer의 고정 해시 5개 파일 정적 감사는 `CONDITIONAL_PASS`다. 대상은 `gate.mjs`, `codex-evidence.mjs`, `historical-plan.mjs`, `test/demo-gate.test.mjs`, 공통 `docs/demo-review-gate.md`다. 후속 `README-CODEX.md` 정정본은 별도로 `PASS`다. 승인 락에 참여하지 않는 외부 편집과 플랫폼별 실제 훅은 감사 조건으로 남는다.
- [15:01] 독립 QA는 고정 후보의 격리 합성 승인 도구 95/95건과 선택 생성기 16/16건을 통과했다. 최종 README도 설정과 코드의 정적 대조 범위에서 별도로 통과했다. 해당 결과는 새 사용자 발화를 신뢰된 Codex 훅에서 수집해 승인하는 실제 전체 흐름을 포함하지 않는다.
- [15:01] 메인 Codex 세션이 실제 T-150에 읽기 전용 `check`를 실행해 `DEMO_GATE_PASSED`, approved v2, hash verified를 재확인했다. 이 확인은 기존 historical 승인에 해당한다. 새 자연어 승인 훅 E2E는 미검증이다.
- [15:01] C2 Claude 외부 검토는 `skipped`다. 공유 도구는 정식 브로커의 제출 조건에 해당하지 않고 이 작업에는 외부 전송 제한이 있어 브로커 실행·파일 전송이 없었다. Claude 주 작업 세션의 최종 검증 인수는 별개이며 실제 수신·수락이 미확인이다. 현재 담당은 Codex로 기록하고 task 상태는 `review`를 유지한다.
- [20:00] 실행 도구 Codex. 사용자 지시에 따라 [Claude 인계문](../../../docs/handovers/T-153-claude-handover-2026-11-05.md)을 준비했고, 선택한 6개 파일 해시가 기존 Reviewer·QA 기록과 일치함을 로컬에서 확인했다. 공식 CLI에서 StockInvest의 기존 대화 5개(유휴 4, 작업 중 1)의 최소 메타데이터를 확인했으나 T-153의 지정 인수 세션을 식별하지 못했다. 현재 자동 실행 인계 경로가 확정되어 있지 않으므로 인계문 발송·Claude 수신은 미실행이다. Codex 메인 세션은 비운영 `T-153TEST` v1 `review_requested`를 등록했다. 새 사용자 발화 수집 및 승인 확인과 실제 Claude 인수·최종 검증이 남아 있다.
- [21:44:57] Codex 메인 세션의 실제 자연어 승인 E2E를 확인했다. 비운영 `T-153TEST` v1의 `review_requested` 등록·데모 제시 후 사용자가 실제 자연어로 승인했다. 메인 세션이 동일 발화 원문으로 `approve-codex-context`를 실행해 `DEMO_GATE_APPROVED`를 받았고, 이후 읽기 전용 `check`도 `DEMO_GATE_PASSED`, `approved` v1, `hash verified`를 반환했다. 데모 SHA-256 `8b7e63140ec7645a2d9849efce3982a7fc0d60654ba1c9de85b1fd09890784c0`. 앞선 발화 대기 상태를 해소했으며 이번 테스트 대화·데모 범위에 한정한다. Claude 실제 인수 및 최종 검증은 미확인이라 `current_tool: codex`, `status: review`를 유지한다.

- [23:48] **사용자 결정: 「기록만 남기기」** — Reviewer 지적 ①(closure 가 claim 6필드 중 `source`·`content_sha256`·`quote_sha256` 을 비교하지 않는다)은 **구현을 바꾸지 않고 알려진 사항으로 기록만 한다.** 권고와 같다. 근거: 이 task 에서 조이는 수정을 두 번 했고(14:33 HIGH 2건) 둘 다 *정당한 승인이 막히는* 쪽 결함이었다 — `source` 없는 옛 claim 형식 호환 분기(`gate.mjs:345`)가 있는 상태에서 여기를 더 조이면 레거시 claim 복구가 fail-closed 로 막힐 위험이 결박을 좁혀 얻는 이득보다 크다. **그래서 아래가 현재 알려진 한계다**: closure(`codex-evidence.mjs:70-87`)는 claim 의 task·version·turn_id 만 대조하고 나머지 3필드는 쓰기만 되고 무시된다. 「claim 필드가 전부 고정됐다」로 읽으면 틀린다. 이 한계를 바꾸려면 옛 claim 호환을 함께 설계해야 하므로 별 작업으로 다룬다.

## 판단 기록 (judge)

- [2026-11-05 14:35] intake engine=jev → bug_investigation / R1 / opus / next=ask_user; demo=delta/designer(JV-ui_change) | overrides=- | fallback=- | tokens=1325

## Developer
- [14:40] 실행 도구 Codex. 동일 세션 과거 검토의 task 파일 누락 시 사후 기록된 동일 task·버전·해시·세션의 Codex 승인과 새 발화 이전 시간, contextual claim까지 확인해 종료된 경우만 제외한다. 원인 불명·증거 손상은 차단하며 검증 가능한 task 원본 복원 절차를 기록했다.
- [14:40] 수집 당시 유일한 검토 요청 영수증을 발화에 고정하고 같은 턴 재전달의 다른 task 귀속을 차단했다. 기존 미바인딩 발화는 당시 같은 프로젝트·세션의 유일 등록 및 기존 provenance를 입증하는 경우만 사용한다. 이미 저장된 승인 및 claim 복구 경로는 유지한다. 고정 historical 경로에서 합성 fixture 디렉터리 조회를 생략한다.
- [14:40] 개별 /tmp 소스 사본에서 HOME/TMPDIR을 격리하고 합성 historical 루트 문자열만 치환해 node --test 89/89 통과, 구문 검사 통과. 사후 원장 일치·불일치, 레거시 유일·모호, 교차 task 재전달 및 합성 경로 없는 고정 historical 분기를 시험했다. 실제 T-150·실제 원장·운영 호출 없음. 수정 파일 SHA-256 및 격리 결과를 Reviewer·Leader에 전달했다. 독립 재검증과 실제 훅 E2E는 남아 있다.
- [14:50] 동일 ID·버전의 다른 task 두 건에 정형 턴 하나가 재사용되고, 첫 자연어 수집이 모호해서 실패한 뒤 남은 작업으로 재귀속되는 두 반례를 합성 재현했다. 정형 중복 검토를 차단하고 세 Codex 승인 경로에 동일 세션 잠금·턴 claim/원장 대조를 적용했다. 자연어 수집 거부를 원자 저장하고, 최초 거부 기록이 실패한 경우도 실제 원발화 시점에 유일한 검토였는지 다시 검증한다.
- [14:50] 수정본 격리 Node 94/94 통과. 중복 정형·거부 기록 잠금/쓰기 실패·mtime 역조작 뒤 재전달·이전 정형 원장과 historical 재사용·공용 세션 락·정형/자연어 저장 후 append 장애 복구를 검증했다. 기존 실제 승인, task, transcript, 원장에 접근하지 않았다. 5개 원본 SHA-256을 Reviewer·Leader·QA에 전달했다. 실제 훅 관측과 독립 판정은 별도다.
- [14:54] Reviewer·QA가 발견한 NAS 시계 오차 반례를 반영했다. 파일 mtime/ctime으로 원발화 당시 상태를 판정하는 구현을 제거했다. 새 검토 등록 때 같은 세션 잠금 안에서 종료된 선행 영수증 지문을 고정하고, 검증 때 원장의 상대 순서와 현재 종료 상태를 다시 본다. 겹쳐 있던 요청의 종료 순서나 기존 영수증을 입증할 수 없으면 원 발화와 원본 영수증을 보존해 조사한다. 실제 대화의 공식 CLI 호출/응답 형식을 확인하지 못해 해당 경로의 자동 복구는 미지원이다.
- [14:54] 격리 Node 95/95 통과. NAS 파일 시각을 ±5초 및 경계로 모의해 선행 종료 후 새 검토는 승인되고, 겹친 검토·최초 거부 소실·이후 경쟁 종료·재전달은 거부되는 것을 확인했다. 실제 사용자 transcript·T-150 및 실제 원장을 사용하지 않았다. 최종 후보 5개 SHA-256을 Leader·Reviewer·QA에 인계했다.
- [15:00] 실행 도구 Codex. 공통 README-CODEX.md의 적용 범위와 historical 이관 상태를 정정했다. 등록 UI 프로젝트 10개 생성 설정에 codex-prompt 각 1개를 확인했다. 생성기상 StockInvest·BJJ는 기존 Mac 핀, 나머지 8개는 Darwin guard와 Windows no-op이다. T-150 정본 CLI 읽기 전용 검사에서 DEMO_GATE_PASSED, approved v2, hash verified를 확인했다. 새 실사용자 훅 전체 흐름은 미검증으로 명시했다. 격리 문서 회귀 1/1 통과. README SHA-256 `ada72fb1d516d204eb9dda570c3e2e96b92331ac25b7332de691a2eb54adf6eb`. 실제 승인·원장·세션 변경이나 훅 재현 없음.
- [15:00] Reviewer 지적 반영. 정형·자연어 수집기의 30일 기준은 후보 처리 중 정리 시도이며, 후보가 없거나 정리가 실패하면 더 오래 남을 수 있다고 README-CODEX.md를 정정했다. 정리 코드와 대조했다. 새 SHA-256 `381e4a839fc121cf6569c673d0ace9974e2e0d9007da4a3794161c51a463a2d9`.

## Reviewer

- [14:33] 실행 도구 Codex. 독립 정적 감사 범위: 공통 demo-gate의 gate.mjs, codex-evidence.mjs, historical-plan.mjs, ubuntu-publish.mjs, check.mjs, hook.mjs, schema.mjs, projects.mjs, test/demo-gate.test.mjs의 관련 부분 및 cc-sync-codex/sync-projects.ps1의 선택 훅 부분. 검토 범위 외 코드·회사 자료 전송 없음. 테스트 실행은 QA 담당.
- [14:33] HIGH: codex-evidence.mjs:69-81, 97-99, 195-201은 같은 세션의 과거 receipt가 참조하는 task가 없어지면 전체 후보 조회가 실패하여 현재 유일한 검토의 유효한 승인도 기록·검증하지 못한다. QA는 격리 합성 재현에서 오래된 파일 유무만 바꿔 이 현상을 확인했다. 종료 증거가 확인된 receipt만 제외하고 미확인 건은 차단을 유지하며 안전한 복구 수단을 제공해야 한다.
- [14:33] HIGH: historical-plan.mjs:11,60은 운영·합성 분기 전 합성 시험용 /tmp/t150-history-integrated에 realpathSync를 호출한다. 그 디렉터리가 없으면 운영 T-150 historical 준비가 예외, receipt 검증이 false가 되어 기존 승인이 차단될 수 있다. 실제 운영 파일 변경 없는 격리 재현을 QA에 요청했다.
- [14:33] 추가 확인: codex-evidence.mjs:120-123은 검토 요청 등록자의 CODEX_THREAD_ID를 사용하며 사용자 발화도 같은 세션에 귀속해야 한다. 하위 에이전트가 별도 thread에서 등록하면 메인 대화 승인 수집이 실패할 수 있다는 정적 추론이며 실제 세션 재현은 미확인이다. 의미 판단은 Leader의 책임으로, 해시·출처 검증만으로 부정 발화의 의미를 자동 판별한다고 주장할 수 없다.
- [14:33] 미확인: 새 승인 발화의 실제 Mac 훅 전달과 전체 인식, 다른 운영체제의 런타임, 수정본 재감사 및 Claude 최종 검증. 기존 일반 task 편집자가 게이트 락에 참여하지 않는 동시 수정 위험과 비정상 종료 후 lock/claim 복구도 추가 검토 대상이다. 결함 해소 전 완료·배포 판단 보류.


- [14:40] 수정본 재감사(Codex, 정적): codex-evidence.mjs SHA-256 `96bdae32f2846089de9026c714ecb6d26e605c0ea859953c04d425f7c5fe96e8`, historical-plan.mjs `d33506ba4a89f3a0d20fadaab446037580814da827d08808b17645b16f9dbf3b`, test/demo-gate.test.mjs `9f7f90a48035a813c88db91605fa797ee23825ed4a7327dcf5a6a72821989e87`, docs/demo-review-gate.md `847cf37f5e55ea4c1925f3cc234f720192077d9a0902d314ec2fc9f974c46` 일치 확인. 기존 gate.mjs의 저장·복구 경로와 함께 대조했다.
- [14:40] 앞선 두 결함 수정 확인: 누락 task는 정확히 일치하고 이전에 기록된 Codex 사후 승인 및 contextual claim으로 종료 증명이 되는 경우에만 제외하며, 증명 불가·깨진 링크는 차단한다. T-150 고정 운영 루트는 단락 평가로 합성 임시 경로에 접근하지 않는다. 수집된 발화는 당시 유일한 요청에 귀속하고 같은 턴을 다른 요청에 재연결하지 않는다. 기존 형식은 당시 다른 등록이 없어야 허용하며 불명확하면 차단한다. 기록 복구는 같은 원문·task·claim 확인 경로를 유지한다.
- [14:40] 위 수정 범위 정적 감사상 추가 Critical/High 없음. Developer는 고립 사본 89/89 통과를 보고했으나 Reviewer가 직접 실행한 결과가 아니다. 실제 사용자 훅의 새 발화 수집, QA의 독립 수정본 검증, 비협조적 task 편집자와의 경쟁·SIGKILL 후 소유 확인 복구, Claude 최종 인수는 별도 미확인이다. 기존 자료 복원이나 출처 증명이 불가능한 옛 기록은 자동 복구되지 않으며 사용자에게 같은 승인을 재요구해서 해결하는 절차로 간주하지 않는다.
- [14:40] **최종 판정: CONDITIONAL_PASS (scope: 공통 .claude/tools/demo-gate/codex-evidence.mjs, historical-plan.mjs, gate.mjs 관련 승인·복구 경로, test/demo-gate.test.mjs 관련 회귀, docs/demo-review-gate.md 관련 절)** — 이 판정은 명시된 파일의 정적 감사에 한정하며 QA·실제 훅·배포 승인으로 확장하지 않는다.


- [14:41] 추가 검토 접수: 같은 프로젝트·세션에 동일 task_id/version인 서로 다른 task 경로가 사용자 발화 전에 등록되면 strict 경로에서 한 발화를 각각 승인에 사용하는 조건이 코드상 성립한다. strict 경로는 이번 수정 전부터 claim 및 복수 대상 판별이 없으며, 새 결함인지 여부는 전후 대조와 격리 재현이 필요하다. 최초 contextual 수집이 복수 대상으로 실패한 뒤 strict 승인과 동일 턴 훅 재전달을 거쳐 남은 다른 대상에 연결되는 가능성도 격리 재현을 요청했다. 위 14:40 판정의 효력은 이 검토가 끝날 때까지 보류한다.


- [14:43] QA와 Developer가 각각 합성 격리 환경에서 두 반례를 재현했다. 동일 task_id/version의 별도 파일 두 건에 같은 정형 승인 턴 하나가 각각 승인되었다. 또 활성 요청 2건으로 최초 자연어 수집이 거절된 후 한 건 종료·동일 훅 입력 재전달로 남은 요청을 승인했다. 실제 훅 재전달 발생 여부는 미확인이다. 사용한 자료는 합성물이며 기존 운영 자료는 변경하지 않았다. 기존 strict 결함과 최초 거절 턴의 재귀속 방지에 대한 수정·재감사를 요청하여 판정 보류를 유지한다.


- [14:50] 두 반례 수정 후보 재감사: Developer 고정 해시 gate.mjs `895520b5883f45de22cf0cc6c67c843b94d73a76ed0cd5318646a1602ce6c7d8`, codex-evidence.mjs `a5005fb14d423327e527751c1e2dc90c45c140f900664d75839b552820b6c514`, historical-plan.mjs `d33506ba4a89f3a0d20fadaab446037580814da827d08808b17645b16f9dbf3b`, test/demo-gate.test.mjs `3ae42b579b81a4befdc0f4009d4205d0e3f1442c742f6c255518cf7342e2908f`, docs/demo-review-gate.md `040e427ab8ab34ff2d1a9d8fa533874b008445f79f343818cc61b9b5910fee9f` 일치. Developer 격리 94/94 보고는 독립 QA 결과가 아니다.
- [14:50] 추가 HIGH 우려: codex-evidence.mjs:119-134는 서로 다른 머신일 수 있는 공유 파일 서버의 task mtime/ctime과 Codex transcript 발화 시각을 직접 비교해 과거 종료를 증명한다. 파일 서버 시계가 대화 기록 호스트보다 늦으면 실제 발화 뒤 종료도 발화 전으로 오판해 최초 복수 대상 발화가 뒤늦게 승인될 가능성이 있다. 정적 추론이며 QA 합성 재현 요청 중. 서로 다른 시계에 기대지 않는 증명·legacy fail-closed·원본 보존 복구 요건을 Developer에 전달했다. 판정 보류 유지.


- [14:51] QA가 공유 파일 시계를 합성 mock한 독립 반례를 재현: 실제 발화 뒤 task를 닫고 해당 파일의 stat 시각만 발화 5초 전으로 보이게 하면 최초에 모호해 거절된 발화의 재전달이 다른 task 승인으로 이어졌다. 실제 서버 시계 차이와 훅 재전달 발생 여부는 미확인이다. 종료 기록의 실행 host가 현재 host와 같다는 사실만으로 transcript 생성 host·시간원이 같음은 증명되지 않으므로, 같은 순서원에서 원발화 당시 유일성을 확인할 수 없는 경우 차단하도록 Developer에 요청했다.


- [14:54] 최신 고정본 정적 재감사: gate.mjs `895520b5883f45de22cf0cc6c67c843b94d73a76ed0cd5318646a1602ce6c7d8`, codex-evidence.mjs `5e6722dc9433cf4a56414f26d59a55156e4aff10fa9d37ee6668a8e2469703dc`, historical-plan.mjs `d33506ba4a89f3a0d20fadaab446037580814da827d08808b17645b16f9dbf3b`, test/demo-gate.test.mjs `cc53bc444bbe81cce877865ec6dc089c83fc01caeb5582408d45ae0fa7ea2409`, docs/demo-review-gate.md `a605b2b8c468a82f1d8801a2dababd982872d62418b6a504d0a439e0f1f22ea7` 일치. 등록 시 이전 종료 지문을 고정하고 검증에서 원장상 선행과 현재 종료를 함께 확인하며, 파일 mtime/ctime 판단은 제거됐다. 기존 승인 확인과 strict/contextual/historical의 claim·복구 경로를 대조했다.
- [14:54] QA 집중 범위: 동일 ID/version의 별도 task에 같은 strict 턴 재사용, 여러 대상의 원 발화 실패 뒤 재전달 및 실패 기록 유실·시계 오차, A 종료 후 B 등록 정상 경로, 누락 task 종료 증명과 legacy 자료 부족, 기존 승인·동일 원문 복구, 다른 프로세스·SIGKILL 중 claim/lock 보존 및 historical 임시 경로 부재. Developer가 95/95 격리 통과를 보고했으나 Reviewer나 독립 QA가 수행한 결과는 아니다.
- [14:54] **최종 판정: CONDITIONAL_PASS (scope: 공통 .claude/tools/demo-gate/gate.mjs, codex-evidence.mjs, historical-plan.mjs, test/demo-gate.test.mjs, docs/demo-review-gate.md)** — 지정 해시의 정적 감사에 한정한다. 독립 QA 및 실제 Mac 사용자 훅 관측은 미완료이며, 락에 참여하지 않는 task 외부 편집의 경쟁 위험·실행 플랫폼별 기능 범위·Claude 인수는 남는다. 이 판정은 사용자 승인이나 배포 승인이 아니다.


- [15:01] 별도 문서 감사: 공통 `.claude/tools/demo-gate/README-CODEX.md` 정정본 SHA-256 `381e4a839fc121cf6569c673d0ace9974e2e0d9007da4a3794161c51a463a2d9`. 설정 존재와 훅 신뢰·실제 발화 수집 및 전체 승인 검증을 구분하고 기존 T-150 historical check와 새 자연어 훅 경로를 구분함을 확인했다. 30일 기한을 넘는 기록이 남을 수 있다는 보존 문구 누락을 발견해 Developer에 요청했고 수정본을 확인했다. 새 README의 설명 정적 감사 PASS. 기존 5개 코드·문서 판정 범위에 합산하지 않으며, 실제 훅 E2E·다른 프로젝트 런타임은 검증하지 않았다.

- [23:33] 실행 도구 Claude(reviewer 역할 서브에이전트, 독립 감사). 대상은 추가된 회귀 1건뿐 — `.claude/tools/demo-gate/test/demo-gate.test.mjs` 659-704행의 시험 `context skips a missing old task…`(새 케이스 `claim-task`·`claim-version`·`claim-turn`)과 `codex-evidence.mjs:70-87`·`gate.mjs:139-141,332-366,480,540-553` 읽기 검토. **변이 6종을 자기 격리 사본에서 직접 재현해 전부 포착**(무변이 95/95, 각 변이 94/95). 케이스 독립성 확인 — conjunct 를 하나만 제거하면 대응 케이스에서만 처음 실패한다. 단독 1/1·이웃 context 시험 4/4·전체 3회 반복 95/95. 실제 상태 디렉터리 해시 전후 동일, 쓰기 명령·`check.mjs` 호출 0.
- [23:33] Reviewer 지적 3건(전부 LOW, critical·high·medium 0). ① **closure 는 claim 6필드 중 3개만 비교한다** — `source`·`content_sha256`·`quote_sha256` 을 변조해도 `recordContextualPrompt` 가 참을 돌려준다(reviewer 가 실험으로 확인). 이번 변경이 만든 문제가 아니고 조건도 아니지만, 「claim 필드가 전부 고정됐다」로 읽으면 틀린다. 옛 claim 형식(`source` 없음) 호환이 이유일 가능성이 높다 — 구현 변경은 Developer·Leader 판단. ② 새 3케이스는 **정상 쓰기 경로로는 도달 불가한 일관성 불변식** 시험이다(claim 은 `wx` 로 먼저 만들고 원장 행을 같은 값으로 쓰므로 어긋난 상태가 생기지 않는다) — **「변조 방어 증거」로 인용하면 과대 해석**이고, 심층 방어 시험으로 명시해 둘 것. ③ 루프가 fail-fast 라 한 변이가 여러 케이스를 깨는지는 가려지고, 두 번째 단언 `assert.throws` 는 closure 의 독립 탐침이 아니다(조치 불필요).
- [23:33] **최종 판정: PASS (scope: .claude/tools/demo-gate/test/demo-gate.test.mjs 659-704행 시험과 codex-evidence.mjs:70-87·gate.mjs:139-141,332-366,480,540-553 읽기 검토, 격리 사본 변이 6종·무변이·단독·전체 3회 재현, 실제 상태 디렉터리 해시 전후 비교)** — 공통 도구 시험 파일에 한정하며 사용자 승인·배포 승인이 아니다. 실제 Codex 훅 런타임·선택 훅 생성기 16건·`integration/` 하위·`check.mjs`·`hook.mjs`·`schema.mjs` 는 검토 범위 밖이다.

## QA
- [21:45] Codex QA 실제 비운영 테스트 독립 읽기 전용 확인: 메인 세션의 신규 사용자 발화·승인 CLI 실행 보고 후 `node ../.claude/tools/demo-gate/check.mjs check --task agent-vault/10-Flow/tasks/T-153TEST-live-approval-check.md` 실행 종료 0, `DEMO_GATE_PASSED`, approved v1, `mockups/T-153TEST-v1.html` hash verified. 테스트 task는 review_requested 후 승인 이력과 `approval_source: codex_contextual`을 표시한다. 실제 사용자 발화 및 훅 실행 순간은 본 QA가 직접 관찰하지 않았으며 메인 세션 실행 보고와 본 도구의 증거 검사 결과를 구분한다. 이 확인은 해당 Mac·대화·테스트 1건 범위이며 다른 프로젝트·플랫폼의 실제 훅이나 Claude 인수의 검증이 아니다. 실제 T-150 승인·원장은 변경하지 않았다.
- [19:58] Codex QA 실제 훅 검증 준비: 공통 README와 CLI 사용법을 대조했다. 기존 T-150 승인·원장을 사용하거나 변경하지 않고, 메인 세션에서 별도의 비운영 데모를 검토 요청한 후 사용자에게 제시하고 그 이후 실제 사용자 발화를 신뢰된 훅으로 수집해야 신규 전체 흐름을 검증할 수 있다. 서브에이전트의 thread ID로 등록하거나 과거 발화·합성 이벤트를 재전달한 결과는 실제 메인 대화 경로의 증거가 아니다. 이 시점에 신규 검토 등록·사용자 발화·훅 실행은 관찰하지 않았으므로 실제 E2E는 NOT_VERIFIED다.
- [15:01] Codex QA 최종 README 문서 재확인 PASS (정적 대조 범위): 최종 SHA-256 `381e4a839fc121cf6569c673d0ace9974e2e0d9007da4a3794161c51a463a2d9`. 30일 경과 항목은 적격 새 후보 처리 시 정리 시도이며 후보 부재·실패 시 더 남을 수 있다는 정정이 codex-evidence.mjs의 두 수집기 필터·조기 반환·오류 처리와 부합한다. 기존 프로젝트 설정 대조와 T-153 Leader 기존 기록에 대한 T-150 문구 대조도 유지된다. 코드 실행·실제 보존 기간·실제 훅은 이 문서 검사로 검증하지 않았다. 앞선 README SHA의 문서 판정은 이 최종본 판정으로 대체한다.
- [15:00] Codex QA 문서 별도 검증 PASS: `README-CODEX.md` SHA-256 `ada72fb1d516d204eb9dda570c3e2e96b92331ac25b7332de691a2eb54adf6eb`. projects.json 등록 UI 10개와 각 .codex/hooks.json의 UserPromptSubmit 내 codex-prompt 각 1건을 읽기 전용으로 대조했고 대상 목록이 일치한다. T-150의 approved v2/hash verified 표현은 T-153 Leader의 기존 read-only check 기록과 일치하며 본 QA가 실제 T-150/원장을 재조회한 것은 아니다. 설정 파일 존재는 실제 훅 신뢰·전달이나 전체 승인 E2E를 증명하지 않는다. 이 문서 대조는 기존 95/16 합성 시험과 별개다.
- [14:56] **QA 판정: PASS (범위: 고정 SHA 수정본의 격리 합성 승인 도구 95/95 및 선택 생성기 16/16 회귀)**. 실제 Codex trusted hook 전체 흐름과 Claude 인수·외부 최종 검증은 **NOT_VERIFIED**이며 이 판정에 포함하지 않는다. 실제 T-150 승인 보존이나 운영 반영 후 동작을 통과로 판정하지 않는다.
- [14:56] Codex QA 수정본 합성 회귀: Reviewer CONDITIONAL_PASS 이후 원본 SHA-256 전후 대조 gate `895520b5883f45de22cf0cc6c67c843b94d73a76ed0cd5318646a1602ce6c7d8`, codex-evidence `5e6722dc9433cf4a56414f26d59a55156e4aff10fa9d37ee6668a8e2469703dc`, historical-plan `d33506ba4a89f3a0d20fadaab446037580814da827d08808b17645b16f9dbf3b`, test `cc53bc444bbe81cce877865ec6dc089c83fc01caeb5582408d45ae0fa7ea2409`, 문서 `a605b2b8c468a82f1d8801a2dababd982872d62418b6a504d0a439e0f1f22ea7` 일치. Mac의 `/tmp/qa-final-_pi_mia6` 격리 사본에서 3개 파일의 합성 역사 fixture 루트만 치환하고 HOME/TMPDIR 분리 후 `node --test …/test/demo-gate.test.mjs`: 95/95, 실패·skip 0. 중복 ID/version 거부, 원래 모호한 턴 재전달 거부, ±5초 clock mock 및 순차 승인, 고아·legacy 증명, 원장 손상 보존, 원 발화 복구·claim·lock·SIGKILL을 포함. Ubuntu 로컬 격리 사본에서 `PWSH=… python3 …/test_demo_prompt_selective.py`: 16/16 PASS(30.676초). 생성기 입력 해시는 이전 검사와 동일 e51615bc…/a35d9836…/4dd73b89…/3158df43…/7af21a11….
- [14:56] historical 부재 시험은 운영 분기 함수에 고정 필드의 합성 receipt와 합성 transcript를 제공하고 파일 읽기·realpath를 mock하여 유효 결과 true를 확인했다. 실제 T-150 receipt·transcript나 운영 승인 보존은 확인하지 않았다. 실제 Codex trusted hook 전달·E2E, 운영 반영 후 작동, Claude 최종 검증은 NOT_VERIFIED. 실 task/원장/사용자 transcript 접근·변경 없음. 상기 결과는 합성 환경 범위의 PASS이며 전체 운영 PASS 아님.
- [14:51] Codex QA 추가 합성 clock-skew 반례: 두 검토 중 원 발화 수집 실패(합성 lock), 실제로 원 발화 이후 경쟁 task 변경(changes_requested, 실제 ctime > 발화)을 수행한 뒤 격리 사본에서 해당 task stat의 mtime/ctime만 발화보다 5초 전으로 mock하면 동일 훅 입력 재전달로 남은 task의 contextual 승인이 성공했다. `initial=false, replay=true, outcome=ok`; 실제 공유 서버 시계 오차 및 훅 재전달 여부는 NOT_VERIFIED. 보안 기대 충족 PASS가 아니다.
- [14:43] Codex QA 추가 결함 재현(실 task·ledger 불사용, 수정본 격리 사본): 같은 프로젝트·세션의 서로 다른 두 task 파일이 같은 ID/version이면 정형 승인 발화 한 건으로 양쪽 approveCodex가 성공했다. 또 정상 event 순서·원래 timestamp의 자연어 턴이 검토 두 건일 때 수집 실패한 후 별도 정형 발화로 하나를 종료하고 첫 훅 입력을 재전달하면 나머지 task에 수집·승인되었다. 실제 Codex 훅의 재전달 여부는 NOT_VERIFIED. 관찰용 코드의 실행 종료 0은 기대 보안 동작 PASS가 아니다. 수정 및 Reviewer 재감사 전 최종 QA PASS 보류.

- [14:40] 실행 도구 Codex. 공유 도구 격리 사본에서 합성 fixture 전용 Node 회귀 `node --test …/demo-gate.test.mjs`: 85/85 통과, 실패·skip 0. 기존 공유 /tmp fixture 충돌 방지를 위해 사본 3개 파일의 합성 루트 문자열만 격리 경로로 치환했다. 실제 T-150 및 실제 승인 원장 변경 없음. Ubuntu 로컬 /tmp 격리 사본의 `test_demo_prompt_selective.py`: 16/16 통과. 등록 프로젝트 10개의 설정에서 codex-prompt 각 1개 확인은 설정 관찰이며 실제 훅 실행 증거가 아니다.
- [14:40] 결함 재현: 같은 세션의 종료된 과거 요청과 유효한 현재 요청을 합성한 경우 수집 성공; 과거 요청의 합성 task 파일만 삭제하면 동일 조건의 새 발화 수집이 false. 기대는 과거 종료가 신뢰 가능하게 확인된 경우 현재 요청 처리이며, 미확인 과거 요청을 무조건 무시해서는 안 된다. 수정 후 Reviewer부터 재검증 필요.
- [14:40] historical 합성 루트 의존성: 격리 사본에서 해당 realpath만 존재/ENOENT로 바꾸자 준비 함수는 각각 다음 단계 오류/ENOENT를 반환하고 receipt 검증도 해당 경로를 읽었다. receipt 입력은 비유효이므로 유효 운영 receipt의 true→false는 직접 확인하지 않았고 운영 영향은 정적 분석이다. 자연어의 승인·거절 의미는 Leader 판단이며 도구가 이를 독립적으로 분류한다는 증거는 없다. 실제 Codex 신뢰 훅 전달·전체 E2E, 수정본과 Claude 최종 검증은 NOT_VERIFIED. 결함 해소 및 Reviewer 재감사 전 최종 PASS 아님.

## Claude 검토

### [2026-11-05 14:56 KST] C2 — skipped
- 호출 근거: Leader의 C2 실행 가능성 확인 지시. 정식 판정기·실행기는 호출하지 않았다.
- 대상: StockInvest T-153 / 기준 dbeca9d8873c599ac54009ddede954e79423db18(작업문서 기준) / 공통 `../.claude/tools/demo-gate/` 변경분 / 실제 외부 검토 파일 없음.
- 실행: 미실행 / 시도 0 / response.json 없음.
- 사유: 정식 Git 검토는 해당 저장소 커밋의 선택 파일을 요구하고, 비 Git 공통 문서 경로는 워크스페이스 `docs/` 바로 아래 Markdown 한 파일만 지원한다. 대상 공유 도구는 어느 경로에도 해당하지 않는다. T-153은 코드·사용자 데이터의 외부 브로커 전송도 금지한다.
- 지적: 외부 검토 미실행으로 산정 불가. 전송된 파일 없음.
- 검토하지 못한 범위: 공유 demo-gate 변경 코드 전체. Claude의 독립 분석·판정은 수행되지 않았다.
- 후속: Leader에게 미실행 사유와 범위 전달. 내부 Reviewer·QA 결과는 Claude 검토로 대체하지 않는다.

## Claude 최종 검증 (주 작업 인수)

- [23:17] 실행 도구 Claude. 인수 근거는 사용자 지시 「T-153의 docs/handovers/T-153-claude-handover-2026-11-05.md를 읽고 최종 검증을 이어받아줘」(2026-11-05)다. 수신 시각 2026-11-05 23:17 KST, Claude 작업 세션 `3122e789-6938-4e57-9c63-e0a2abf34aaf`(Mac, Claude Code desktop), 맡은 단계는 인계문 「인수 후 완료 기준」 1~4의 최종 검증과 기록이다. 대상 버전은 작업문서 `base_ref` `dbeca9d8873c599ac54009ddede954e79423db18` 과 인계문의 고정 6파일 해시다.
- [23:10] **고정 6파일 SHA-256 로컬 대조: 6/6 일치**(인계문 표와 완전 동일). `gate.mjs` `895520b5…2ce6c7d8` · `codex-evidence.mjs` `5e6722dc…69703dc` · `historical-plan.mjs` `d33506ba…6f9dbf3b` · `test/demo-gate.test.mjs` `cc53bc44…a7ea2409` · `docs/demo-review-gate.md` `a605b2b8…f1f22ea7` · `README-CODEX.md` `381e4a83…1a463a2d9`. 외부 전송 없음 — 해시 계산과 시험은 전부 이 Mac 로컬이다.
- [23:12] **격리 환경 최종 검사: node --test 95/95 통과, 실패·skip 0**(5.56초, Node v22.22.0). 격리 구성: 워크스페이스 사본 `/private/tmp/claude-501/-Volumes-homes-brownjeon-project-StockInvest/3122e789-6938-4e57-9c63-e0a2abf34aaf/scratchpad/t153-final/ws` (`DEFAULT_WORKSPACE`·기본 state 가 사본 안을 가리키는 것을 실행 전 확인) · `HOME=/private/tmp/claude-501/-Volumes-homes-brownjeon-project-StockInvest/3122e789-6938-4e57-9c63-e0a2abf34aaf/scratchpad/t153-final/home` · `TMPDIR=/private/tmp/claude-501/-Volumes-homes-brownjeon-project-StockInvest/3122e789-6938-4e57-9c63-e0a2abf34aaf/scratchpad/t153-final/tmp` · 합성 역사 fixture 루트를 공유 `/tmp/t150-history-integrated` 에서 `/private/tmp/claude-501/-Volumes-homes-brownjeon-project-StockInvest/3122e789-6938-4e57-9c63-e0a2abf34aaf/scratchpad/t153-final/fixture/t150-history-integrated` 로 치환(`gate.mjs`·`historical-plan.mjs`·`test/demo-gate.test.mjs` 3파일, 치환 후 원 문자열 잔존 0건). `diff -rq` 로 **원본과 다른 파일이 정확히 그 3개뿐**임을 확인했다. ⚠ 재현 기록 보완: `gate.mjs` 가 `../jev-judge/rules.mjs`·`lib.mjs` 를 import 하므로 `demo-gate` 만 복사하면 `ERR_MODULE_NOT_FOUND` 로 **0/1 적재 실패**한다(첫 시도에서 실제로 발생). `jev-judge` 디렉터리도 사본에 넣어야 한다 — 기존 QA 기록의 「3개 파일 치환」에는 이 의존성이 적혀 있지 않다.
- [23:13] **실제 상태 불변 증거(시험 전후 SHA-256 대조)**: 승인 원장 디렉터리 `.claude/state/demo-gate/` 9개 파일(`evidence.jsonl`·`codex-prompts.jsonl`·`codex-contextual-prompts.jsonl`·`review-requests.jsonl`·`prompts.jsonl`·`events.jsonl`·claim 2개·historical archive 1개) **전부 불변**, 실제 T-150 task·데모(v2)와 T-153TEST task·데모(v1) 4파일 **전부 불변**. 공유 `/tmp/t150-history-integrated`(11-05 11:35 잔존물) mtime 도 불변 — 이번 시험은 그 경로를 쓰지 않았다. 격리 `HOME` 은 비어 있어, 시험이 `homedir()` 기반 transcript 루트를 건드리지 않고 케이스별 임시 디렉터리만 썼음을 확인했다.
- [23:14] **회귀망 변이 감도 3건(격리 사본, 원본 무변경) — 2/3 포착**. ① `codex-evidence.mjs` `closedByCodexApproval` 의 `matches.length !== 1` → `< 1`(복수 대상 수용): **포착**(94/95, 실패 1). ② `gate.mjs` `hasBoundCodexEvidence` 에서 `r.content_sha256 === hash` 제거(승인된 데모 해시 비결박): **포착**(94/95). ③ `codex-evidence.mjs:86` 의 claim 내용 대조 `claim.task === row.task && claim.version === row.version && claim.turn_id === row.turn_id` → `return true`: 🔴 **미포착(95/95 그대로 통과)**.
- [23:15] 🔴 **발견 — 회귀망 공백 1건(구현 결함이 아니라 시험 공백)**: 위 ③의 claim 내용 대조는 Developer 가 14:50 에 「같은 턴을 다른 task 로 재귀속」 반례를 막으려고 넣은 장치인데, 그 비교를 상수 참으로 바꿔도 **95개 시험 중 하나도 실패하지 않는다.** 같은 함수 안의 ①이 포착된 것으로 **함수 자체는 시험이 실행한다**는 것이 확인되므로 사문화된 코드가 아니고, `readFileSync(claimPath)` 는 그대로 남아 **claim 파일 부재**는 여전히 걸린다. 즉 현재 회귀망은 「claim 파일이 있다」까지만 고정하고 **「claim 이 이 task·version·turn 에 묶여 있다」는 성질은 고정하지 않는다.** 악용에는 승인 행의 `session_id:turn_id` 해시와 이름이 같으면서 내용의 task/version 이 다른 claim 파일이 필요하므로 **실증된 우회 경로는 아니다(심층 방어의 미고정)**. 닫는 길은 회귀 1건 추가 — 다른 task/version 으로 claim 을 쓰고 `provenClosed` 가 거짓이 되는지 보는 시험이다. 보강 여부는 사용자 결정 사항으로 남긴다.
- [23:16] **읽기 전용 승인 상태 독립 확인**(실제 상태 변경 없음, `checkTask` 가 읽기 전용임을 `gate.mjs` 에서 먼저 확인): `T-153TEST` → `DEMO_GATE_PASSED`·`approved`·`v1`·`mockups/T-153TEST-v1.html`·`hash: verified`, 종료 0. `T-150` → `DEMO_GATE_PASSED`·`approved`·`v2`·`hash: verified`, 종료 0. T-153TEST 데모 파일 해시가 인계문·Leader 기록의 `8b7e6314…890784c0` 과 일치함을 별도로 계산해 확인했다. 승인 경로 분기도 함께 읽어, `codex`/`codex_contextual` 은 결박된 원장 행, `historical` 은 보관 영수증 일치, 그 밖은 원장 또는 기록된 사용자 발화를 **각각 요구**함을 확인했다(frontmatter 만 손으로 고치면 통과하지 않는다).
- [23:16] **설정 확인(런타임 확인이 아니다)**: `projects.json` 의 `ui_projects` 10곳(TheAdmin·TheKaiwa·TheMeal·VoiceVault·TheRoute·bjj-trainning·StockInvest·TheCareerMng·TheThinker·OdinueAnalysis) 각각의 `.codex/hooks.json` `UserPromptSubmit` 에 `codex-prompt` 훅이 **정확히 1건**씩 있음을 읽기 전용으로 확인했다(기존 QA 기록과 일치). 이것은 파일 설정의 존재이며 실제 훅 전달·신뢰·발화 수집의 증거가 아니다.
- [23:17] **미검증으로 남는 범위**(각각 구분해 보고): ① **선택 훅 생성기 회귀 16건 재현 불가** — 이 Mac 과 우분투 서버 모두 `pwsh` 가 없다(`/opt`·`/snap`·`dotnet` 까지 확인). 🔴 덧붙여, pwsh 없이 `python3 tests/test_demo_prompt_selective.py` 를 돌리면 **종료 코드 0 과 `OK (skipped=16)`** 이 나온다 — 종료 코드만 보는 자동 점검은 16건을 「통과」로 읽는다(실제로는 16건 전부 skip). 기존 QA 는 `PWSH=` 를 지정해 16/16 을 받았으므로 그 기록 자체는 유효하다. ② **실제 Codex 신뢰 훅의 런타임 전체 흐름**은 2026-11-05 21:44:57 Codex 메인 세션의 T-153TEST 1건 범위이고, 내가 관찰한 것은 그 결과물의 읽기 전용 검사뿐이다. ③ **다른 OS(Windows no-op·Darwin guard)와 나머지 9개 프로젝트의 실제 훅 런타임** 미확인. ④ **게이트 락에 참여하지 않는 외부 편집자**(일반 편집기·`sed -i`·다른 세션)의 task 파일 동시 저장 경쟁은 Reviewer 의 열린 조건 그대로 남아 있고 이번에 재현·검증하지 않았다. ⑤ C2 외부 검토는 `skipped` 유지(공유 도구는 브로커 제출 조건 밖, 이 작업은 외부 전송 금지).
- [23:17] **Claude 최종 검증 결과**: 인계문 완료 기준 1~4 중 내가 실행할 수 있는 범위는 전부 수행해 **조건부 통과**로 판정한다 — 고정 6파일은 인계된 그 버전이고(해시 6/6), 격리 최종 검사 95/95 가 독립 재현되며, 실제 승인 원장·T-150·T-153TEST 는 바뀌지 않았고, 읽기 전용 승인 상태가 두 건 모두 유효하다. 조건은 위 ①~⑤의 미검증 범위와 23:15 의 회귀망 공백 1건이다. 이 판정은 공통 승인 도구의 검증에 한정하며 **사용자 승인·배포 승인이 아니다.** T-150 제품 화면의 구현·커밋·배포는 별개이고, 이번 작업에서 운영 push·배포·거래·DB 변경·서비스 재시작·훅 신뢰 상태 변경은 하지 않았다. 이 task 기록 파일은 추적되지 않은 상태로 두었고 커밋하지 않았다.
- [23:33] **사용자 승인 「회귀 추가」로 23:15 의 회귀망 공백을 닫았다.** 변경은 **시험 파일 1개뿐** — `.claude/tools/demo-gate/test/demo-gate.test.mjs` 의 시험 `context skips a missing old task…` 에 kind `claim-task`·`claim-version`·`claim-turn` 3케이스를 더했다(claim 파일의 task·version·turn_id 중 하나만 변조하고 나머지는 그대로 두어, 「claim 이 읽히기만 하면 된다」가 아니라 「그 turn 이 이 task·version 에 묶여 있어야 한다」를 고정한다). `test()` 수는 95 로 그대로다(기존 시험의 루프 케이스가 7→10 으로 늘었을 뿐). 구현 파일은 **바이트 불변** — 동작을 바꾸지 않았다.
- [23:33] **변이 감도 재시험 6/6 포착**(종전 2/3). claim 대조 전체를 `return true` 로 바꾼 변이, 세 conjunct 를 하나씩 제거한 3변이, 기존 2변이(모호 수용·데모 해시 비결박) 전부 94/95 로 실패한다. 반영 후 원본을 새로 복사한 격리 사본에서 전체 95/95 재확인(5.31초).
- [23:33] **고정 해시 갱신**: `test/demo-gate.test.mjs` `cc53bc44…a7ea2409` → **`9f61f1783c5637aa197d4ea4c7e0a13574eaf8ed0dd182b2af17540bd86d620b`**. 인계문 표의 그 한 줄은 이 값으로 대체된다. 나머지 5파일(`gate.mjs`·`codex-evidence.mjs`·`historical-plan.mjs`·`docs/demo-review-gate.md`·`README-CODEX.md`)은 변경 전후 모두 인계 값 그대로라 기존 Reviewer·QA 의 그 파일들에 대한 판정 범위는 유효하다. 두 문서가 시험 건수나 claim 보장을 인용하지 않아 문서 갱신은 필요 없다(읽어서 확인).
- [23:33] **변경 전후 직접 대조**(독립 감사자가 사본이 없어 못 한 항목): 내가 수정 전에 떠 둔 사본의 SHA-256 이 인계문 고정 값 `cc53bc44…a7ea2409` 과 일치하므로 **감사받은 그 버전에서 출발했음이 확인된다.** diff 는 hunk 2개·변경 11줄(kind 배열 1줄 교체 + 분기 9줄 추가)로, 이 시험 하나 밖은 건드리지 않았다.
- [23:33] **독립 감사: reviewer PASS**(위 `## Reviewer` 23:33 세 줄). 지적 3건 전부 LOW 이고 그중 ①(closure 가 claim 의 `source`·`content_sha256`·`quote_sha256` 을 비교하지 않는다 — reviewer 실험 확인)은 **이번 변경과 무관한 기존 사항**으로 구현 변경 여부가 사용자·Leader 판단 사항이다. ②를 받아들여 기록한다 — **새 3케이스는 심층 방어(일관성 불변식) 시험이고 「변조 방어 증거」가 아니다.** 정상 쓰기 경로(`gate.mjs:336-351` 의 `wx` 선행 생성 + 같은 값으로 원장 기록)로는 어긋난 claim 이 생기지 않는다.
- [23:33] **별도 QA 는 돌리지 않았다** — 변경이 시험 파일 1개이고 실행 증빙(무변이·변이 6종·단독·이웃·전체 3회)을 **구현자가 아닌 독립 감사자가 직접 재현**했기 때문이다. 표준 순환의 QA 단계를 생략한 것이므로, 별도 QA 가 필요하다고 보면 사용자 지시로 추가한다.
- [23:33] 🔴 **정정 — 23:13 의 「원장 9파일 불변」은 그 시점 기준이고, 이후 `prompts.jsonl` 이 바뀌었다. 내 시험 때문이 아니다**: 23:21:37 에 추가된 행이 **이 Claude 세션(`3122e789-…`)의 사용자 발화 기록**이고(866행, `project: StockInvest`), 워크스페이스 `UserPromptSubmit` 훅의 `recordPrompt` 정상 동작이다. **승인 증거 파일은 전부 불변** — `evidence.jsonl`·claim 2개·`review-requests.jsonl`·`codex-prompts.jsonl`·`codex-contextual-prompts.jsonl`·`events.jsonl`·historical archive, 그리고 T-150·T-153TEST task·데모 4파일. 덧붙여 이것은 **Claude 쪽 훅이 이 세션에서 실제로 도는 것을 관측한 것**이지만, T-153 이 고친 Codex contextual 경로의 런타임 증거는 아니다. ⚠ reviewer 보고의 「state 11개 파일」은 실측과 다르다 — 지금도 **9개**다(전후 해시 동일이라는 그쪽 결론 자체는 내 대조와 일치).
- [23:33] **남는 미검증은 23:17 목록에서 ①②③④⑤ 그대로이고, 회귀망 공백 1건은 해소됐다.** 새로 남는 결정은 Reviewer 지적 ①(claim 3필드 미비교)의 처분 하나다. 공통 도구는 비 Git 경로라 커밋 대상이 아니고, 이 작업에서 운영 push·배포·거래·DB·서비스 재시작·훅 신뢰 상태 변경은 하지 않았다.
- [23:48] 사용자 결정 「기록만 남기기」를 받아 Reviewer 지적 ① 을 **알려진 한계로 확정**했다(위 `## Leader` 23:48). 구현 파일은 이번 작업 전체에서 바이트 불변이고, 공통 도구에 남은 변경은 시험 파일 1개(`9f61f178…`)뿐이다. 남는 것은 별도 QA 추가 여부와 23:17 목록의 미검증 5건이다.

## 최종 요약

### [T-153] 데모 승인 도구 — Claude 최종 검증과 회귀 1건 추가

- **상태**: 완료. 2026-11-05 23:17 Codex → Claude 주 작업 인수(`claude_standard`), 23:33 회귀 추가와 독립 감사 통과, 23:48 사용자 결정 반영.
- **무엇이 바뀌었나**: 공통 승인 도구의 **시험 파일 1개**(`.claude/tools/demo-gate/test/demo-gate.test.mjs`)에 claim 결박 회귀 3케이스(`claim-task`·`claim-version`·`claim-turn`)를 더했다. 승인 도구의 **구현 동작은 바뀌지 않았다**(구현 5파일 바이트 불변). 새 해시 `9f61f1783c5637aa197d4ea4c7e0a13574eaf8ed0dd182b2af17540bd86d620b` 이 인계문 표의 그 한 줄을 대체한다.
- **배포**: 공통 도구 자체는 상위 워크스페이스의 비 Git 경로라 커밋·배포 대상이 아니다(파일 교체로 이미 반영, 해시로만 식별). **문서·vault 기록은 사용자 지시 「지금 push」로 운영에 나갔다** — 커밋 `18c1dc7`(+ 동승 `254dce4` T-147 배포 기록, 둘 다 내 것·문서 전용·코드 0건), push 2026-11-06 00:01:5x KST, webhook `START sha=18c1dc7`(15:01:57 UTC) → `END exit=0`(15:03:45 UTC), **릴리스 `20261106-000207-18c1dc73` · `RELEASE_RESULT status=ok` · `migrated:false`**, 롤백 지점 `20261105-225235-50ac5ad1`. 다른 세션 커밋 `86571cc`(T-150 demo_gate 기록)가 push 직전에 로컬에 생겨 있었고 **승인 범위가 아니라 올리지 않았다**(`git push origin 18c1dc7:main`). 🔴 **미국 정규장 개장 중(10:01 ET) 배포였다** — 위험을 사전 보고하고 사용자가 「지금 push」로 결정했다. 컷오버 공백 `HTTP=000` 7건(00:02:37~00:02:40, strategy-eval·signal-followup·signal-expiry·portfolio-snapshot·trade-report·job-run-log), 00:03:04 부터 정상. 배포 후: pm2 두 앱 online·cron 러너 부모 1 + 티커 자식 1 · `stop-alert` 00:03:04·00:04:00 분당 1회로 재개(중복 없음) · `cron-err` 0바이트.
- **AI 가 검증한 것**: 고정 6파일 SHA-256 6/6 일치 · 격리 환경 `node --test` **95/95**(반영 전후 각각, HOME·TMPDIR·합성 fixture 루트 분리) · **변이 감도 6/6 포착**(종전 2/3) · 읽기 전용 `check` 로 T-153TEST `approved v1`·T-150 `approved v2` 둘 다 `hash: verified` · 승인 증거 8파일과 T-150·T-153TEST task·데모 4파일 **시험 전후 해시 불변** · 수정 전 사본 해시가 인계문 고정 값과 일치(감사받은 버전에서 출발) · UI 프로젝트 10곳 `codex-prompt` 훅 각 1건(설정 확인) · 독립 Reviewer 가 변이 6종을 자기 격리 사본에서 **직접 재현**해 PASS(LOW 3건, critical·high·medium 0).
- **AI 가 못 한 것**: 선택 훅 생성기 16건 — Mac·우분투 서버 둘 다 `pwsh` 가 없어 **재현 불가**(pwsh 없이 돌리면 종료 0 + `OK (skipped=16)` 이라 종료 코드만 보면 오독한다) · 실제 Codex 신뢰 훅 런타임은 2026-11-05 21:44:57 T-153TEST **1건 범위**이고 내가 본 것은 그 결과물의 읽기 전용 검사뿐 · 다른 OS·나머지 9개 프로젝트의 실제 훅 런타임 · 게이트 락에 참여하지 않는 외부 편집자의 task 저장 경쟁(Reviewer 열린 조건) · C2 외부 검토는 `skipped` 유지 · **표준 순환의 QA 단계를 생략**했다(reviewer 가 실행 증빙을 직접 재현했고 변경이 시험 파일 1개라서다 — 이탈을 기록해 둔다).
- **👉 사용자가 확인할 것**: 없음(운영 거동 변화 없음). 다음에 Codex 세션에서 데모 승인을 받을 때 평소처럼 되는지만 봐 두면 된다 — 승인 도구 구현은 그대로다.
- **👉 사용자가 결정할 것**: ① 알려진 한계 — closure 가 claim 6필드 중 task·version·turn_id 만 대조한다(23:48 「기록만 남기기」로 확정, 바꾸려면 옛 claim 호환 설계가 필요해 별 작업) ② 선택 훅 생성기 16건을 검증하려면 pwsh 설치가 필요하다(설치는 사용자 판단) ③ 생략한 QA 를 뒤늦게라도 돌릴지.
- **남은 일**: 위 ②③ 과 Reviewer 열린 조건(외부 편집자 경쟁)뿐. 이 task 범위의 작업은 남지 않았다.
- **이슈·위험**: 새 3케이스는 **정상 쓰기 경로로는 도달 불가한 일관성 불변식** 시험이다 — 「변조 방어 증거」로 인용하면 과대 해석이다(Reviewer 지적 ②). 공통 도구는 비 Git 경로라 이 변경에 버전 관리가 없다 — 되돌리려면 해시와 이 기록을 근거로 수동 복원해야 한다.

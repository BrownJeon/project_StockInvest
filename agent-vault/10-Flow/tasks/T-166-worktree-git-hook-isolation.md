---
task_id: T-166
title: 맥 워크트리 Git 훅 격리와 우분투 설치 보존
status: done
roles_involved: [leader, developer, reviewer, qa, judge]
related_tasks: [T-025, T-156]
tags: [type/task, domain/process, domain/safety]
aliases: [맥 Git 훅, worktree hooksPath 격리, T-165-worktree-git-hook-isolation]
execution_context:
  schema_version: 1
  origin_tool: codex
  current_tool: codex
  current_procedure: codex_scoped
  current_scope: "Git 훅 설치/검증 두 스크립트 최소 보완·맥 worktree 설정 분리·양쪽 실제 훅 검증; 우분투 기존 훅/공유설정/다른변경 보존"
  last_event_id: exec-003
created: 2026-11-11
updated: 2026-11-12
---

# T-166 — 맥 Git 훅 경로 격리

## 실행 도구·절차 이력

| 이벤트 ID | 시각(KST) | 사건 | 담당 / 절차 | 범위·근거 |
|---|---|---|---|---|
| exec-001 | 2026-11-11 23:52 | start | codex / codex_scoped | 사용자 맥 훅 복구·우분투 기존 훅/다른 변경 보존·양쪽 실검증 요청 |
| exec-002 | 2026-11-12 00:20 | task_id_disambiguated / done | codex / codex_scoped | 병행 primary의 별도 T-165-macro-regime-label-c0 번호와 충돌해 본 작업만 T-166으로 이관. T-165로 발행된 Jev·리뷰·fixture·영수증은 동일 작업의 원이력으로 보존, 제품 두 파일 동결 SHA 불변 |
| exec-003 | 2026-11-12 10:47 | scoped_publish_authorized | codex / codex_scoped | 사용자 후속 지시로 installer/test 2파일+T-166 문서5파일만 로컬 커밋·main 정상 FF 푸시. 최신 main의 다른 작업 이력을 보존하고 해당7파일 외의 수정·Ubuntu 훅 재설치 금지. 발행 SHA/자동 웹훅 결과는 별도 보호 영수증과 최종 보고에 기록 |

## 목표

맥 현재 linked worktree가 공유 Git 설정의 리눅스 절대 경로를 상속해 훅을 건너뛰는 문제를 복구한다. 설치 재실행도 공유값을 덮어쓰지 않게 하고, 두 호스트에서 실제 안전 커밋 차단/허용을 검증한다. 주문·DB·서비스·배포·기존 커밋·사용자 index를 바꾸지 않는다.

## 관련 과거 이력 요약

- [[T-025-commit-reviewer-safeguard]]: noexec에서도 실행 가능한 우분투 로컬 shim 및 Reviewer scope 강제, 원본 훅과 정상 우분투 shim을 이번에는 그대로 보존한다.
- [[T-156-us-stock-entry-exit-forecast-design]]: 문서 커밋 직전 맥에서 공유 core.hooksPath가 없는 리눅스 경로임을 발견, 해당 커밋은 우분투 정상 훅으로 처리했다. M40 제품/운영 변경은 이번 범위가 아니다.

## Leader 설계와 보존 조건

- 맥 Git2.53/우분투2.34, extensions.worktreeConfig=true가 이미 설정돼 있다. core.bare=false, core.worktree없음. 다른 codex worktree 설정도 있으므로 확장 flag나 공유 config는 변경하지 않는다.
- installer는 저장소 로컬 확장이 켜졌으면 논리 worktree scope를 택하고, 실제 쓰기 대상을 해당 GIT_DIR/config.worktree 파일로 고정한다. 전역/command 확장값 혼입과 검사 후 OFF 경합도 공유 설정 쓰기로 폴백하지 않아야 한다. 확장이 꺼진 단일 clone만 기존 local을 사용하고 peer가 있는 경우는 쓰기 전에 차단·안내한다. 선택 파일과 실제 유효 hooksPath·TARGET 일치/실행가능 검사를 모두 확인한다. 해제 안내도 고정 파일을 반영한다.
- test runner의 --local 한정 검사는 실제 유효값 조회로 보완하고, 같은 파일 안에 설치/재설치/공유·다른worktree 불변/음성/실커밋 fixture를 추가한다. 훅 원본 commit-msg는 변경하지 않는다.
- 기존 full runner는 실제 index/HEAD에 영향을 주므로 맥 live/우분투 primary에서 실행하지 않는다. 전체 회귀는 양쪽 별도 임시 저장소에서, 현재 설치 검증은 호스트별 실제 유효 설정·실행 경로를 확인한 뒤 실제 설치된 동일 ABS 훅 파일을 호출하는 일회용 저장소에서 문서 허용/무판정·범위오류 거절/유효 synthetic fixture 허용의 실제 커밋을 수행한다. live worktree 직접 커밋은 COMMIT_EDITMSG 등 메타데이터도 갱신하므로 생략한다. HEAD/index/메시지 파일은 전후 읽기 지문으로 보존을 확인한다.
- 적용 전 맥 worktree config만 보호 백업, 공유/다른 worktree config·실 index/HEAD·우분투 shim/source 해시를 저장했다. 다른 변경은 reset/clean/stash하지 않는다. 현재 사용자 요청은 복구·검증이며 새 commit/push/앱 배포는 수행하지 않는다.

- [2026-11-12 00:15] Reviewer/C2·Mac격리전체526/0 및 QA의 개발자로그 독립열람 뒤, 맥 현 worktree에서 동결 installer를 /bin/bash로 실행(exit0). 실효 core.hooksPath=scripts/git-hooks, origin=worktree config.worktree, mode755/direct다. 공통 config SHA88a9c6a0…와 다른 worktree 설정/기존 codex.localEnvironmentConfigPath, Mac HEAD·원 index bytes/entries·COMMIT_EDITMSG·commit-msg 원본을 모두 보존했다. 보호 백업 mac-config.worktree.before 및 전후/비교 JSON을 보관한다. 우분투는 installer를 실행하지 않았으며 기존 ABS shim의 fixture4사례 통과를 QA가 확인했다.

- [2026-11-12 00:20] 최종 보존 검산: Mac 실제 HEAD ba3120ae…·index 원바이트/entries·COMMIT_EDITMSG·원본 commit-msg 및 공유 config SHA88a9c6a0…·다른 worktree config/기존 codex 키·기존 untracked ledger 파일은 동일하다. Ubuntu 최종 실효값은 원래 local Linux ABS shim이며 executable/두 shim 파일 및 mode·원본·공유 config·HEAD를 다시 읽어 확인했다. 사전/사후 스냅샷상 기존 tracked 75파일의 내용과 staged entries·COMMIT_EDITMSG는 동일하나 raw index SHA는 0620973d…→bb539332…로 달랐다. 병행 untracked T-165-macro-regime-label-c0.md의 bytes 변화도 관찰됐다. 원인을 단정하거나 사용자/다른 세션의 index·문서를 복구/덮어쓰지 않았다. 해당 관찰은 바이트 전체 불변 보증의 한계이며, 실제 hook 실행 기능 검증과 구분한다.

## 판단 기록 (judge)

- [2026-11-11 23:54] intake engine=jev → task_type=null (signal=local_fix, confidence=0.49) / complexity=1.83 / needs_info=false / risk=R2 / developer_model=opus / next=demo_first; demo=delta/designer(DM-kw-risky-cta); actions=prepare_demo,request_demo_approval,assign_developer | overrides=R2-kw-payment,MD-judge-failed-opus,DM-kw-risky-cta | fallback=- | tokens=1319

- [2026-11-11 23:54] codex_gate/C1 engine=jev → codex_required=false / mode=null / focus=null / budget_rule=CX-limit-unknown-r2 / codex_switch=on | overrides=없음 | fallback=- | tokens=787

- [2026-11-12 00:05] intake CLI 범위 명확화 재실행(engine=jev, Root가 정본 judge.mjs 호출; 원결과 보존): 두 shell 스크립트·Git CLI 설정/fixture만 대상으로 설명 → task_type=local_fix / complexity=1.02 / needs_info=false / tool risk=R1 / developer_model=sonnet / demo.required=false(level=none, ui.none=1.0) / next=assign / blocking_gate=null / overrides=없음 / fallback=없음 / tokens=1245 / costUSD=0.000052. 첫 접수의 화면·결제 키워드 오분류를 정정했으며 사용자 승인이나 게이트 상태를 수동 작성하지 않았다. 안전 훅 설치·시험을 고치므로 Leader 검토 위험도 R2와 독립 Reviewer→C2→QA는 유지한다. 원본/정정 영수증은 보호된 t165-hook-isolation-20261111 폴더에 보관한다.

- [2026-11-12 00:11] Reviewer 동결2파일 감사 완료 후 C2 정본 judge.mjs 실행(engine=jev): codex_required=true / wanted_before_budget=true / mode=adversarial-review / focus=concurrency / budget_rule=CX-limit-unknown-r2 / calls=0 / switch=on / overrides=없음 / fallback=없음 / tokens=685 / costUSD=0.000029 / latency=541ms. Codex 세션의 순환 호출 금지 규정에 따라 `override: codex_unavailable_in_codex`를 기록하고 추가 Codex CLI를 호출하지 않았다. 독립 Reviewer의 범위·동결 SHA를 유지한 채 양호스트 격리실행/QA로 진행한다. 영수증 judge-c2-input.json/judge-c2-result.json은 보호된 t165-hook-isolation-20261111에 보관.

## Developer

- [2026-11-12 00:17] 소유 두 shell 파일만 수정·동결했다. installer는 common config 직접(no-includes) 확장값과 실효값을 검사하고, enabled scope의 읽기/쓰기를 물리 config.worktree 파일에 고정해 검사 후 확장 OFF의 공유 fallback을 제거한다. disabled linked/main+peers·확장 혼입/충돌·기존 config symlink·별도 Git 대상/GIT_CONFIG 환경을 쓰기 전에 거절하고, 최종 확장/실효 hooksPath/TARGET·실행가능 검증 뒤에만 완료를 출력한다. 내부 Git 위치 변수는 HOOK_GIT_DIR/HOOK_GIT_COMMON으로 분리했다. commit-msg 원본과 실제 호스트 설정은 Developer가 변경하지 않았다.
- [2026-11-12 00:17] test runner는 실효 hooksPath를 조회하고 GIT_CONFIG 가짜 조회를 사전 차단한다. 새 35회귀는 ordinary local·main/두 linked worktree 설정 분리·재설치/공유·peer bytes·permissions 보존, global/command 확장 혼입·쓰기 실패·config symlink·효과 shadow·확장 toggle 경합, Git 위치/config/template 환경 제거와 격리 XDG, origin config/index/HEAD/objects 불변, 실제 설치 fixture 커밋의 문서/무task/오류scope/유효synthetic 4사례를 포함한다. 최종 기존 E2E도 정확 commit-msg 차단 문구+실패 exit+HEAD 불변을 요구해 서명/신원 실패를 오인하지 않는다.
- [2026-11-12 00:17] Mac Git2.53.0/Bash3.2.57·Ubuntu Git2.34.1/Bash5.1.16에서 각각 새 일회용 repo로 syntax0/install0/전체526통과0실패(기존491+신규35)·마지막 설치 E2E exit1/정확차단토큰/HEAD불변을 확인했다. Ubuntu heavy run은 flock /tmp/stockinvest-heavy-tests.lock nice -n10으로 직렬화했다. 두 fixture 모두 종료 status빈값/commitcount1, 시작 전·종료 후 제품 두 SHA 동일이다. Mac GIT_CONFIG runner 음성 별도1건도 exit1/토큰/config·index·HEAD 불변. 전체 회귀는 Developer 실행이며 QA의 실제 설치 ABS 훅·호스트 지문 검증과 구분한다. live Mac/Ubuntu primary에서 full runner·Ubuntu primary installer 실행0, 실제 index/HEAD·config·서비스·DB·commit/push 변경0이다.
- [2026-11-12 00:17] 동결 SHA: installer d0c234812d21d5e44c4e55a669baba08dfb140b78d6288063c5e81390fab5359 / test 2536b6d04fb6537d2b33effee4a1af621f9bcb5ab21e8a95231b882982f48a1d, commit-msg d3e36ec07e1a2d900c99813b9284013d223dfb0e62dd526dc45036b62c303900 불변. 가린 종합영수증 developer-two-host-final-20261112.json SHA46c9d46639ded3cc40d96ef60b9cac9912b180a4c947a0e31e8f7a5e938e6209 및 두 host 전체/설치/syntax 로그를 ignored T-165-worktree-hook-isolation artifact에 보존했다. Ubuntu full log SHA43c49d3cb3d28dd81f078f33ffe43aa651189e5158893cc272ffb6409d3b5ed5, Mac8aff8ef1b308aa2e83b7d11f64b1e372d1cf24fe89dbbd6841b95755901b0aa7. 초기 Mac fixture 복사 전 syntax1회127은 미완성 준비 실패로 제외했으며 최종526에 섞지 않았다. noexec mount 신규 생성 없이 로컬 디스크를 사용했고 기존 운영 Ubuntu shim 검증은 Root/QA 소관이다. 실행 fixture/source의 T165 표기는 이력으로 보존하고, 문서 T166 이관은 Leader가 역할 기록 완료 뒤 수행한다.

## Reviewer

- [00:10] 최종 동결 설치기 `d0c234812d21d5e44c4e55a669baba08dfb140b78d6288063c5e81390fab5359`·테스트 `2536b6d04fb6537d2b33effee4a1af621f9bcb5ab21e8a95231b882982f48a1d`를 HEAD `ba3120ae2db9e3ab56c91435cc17fbd2defe905a` 대비 독립 정적 감사했다. 공유 config의 실제 확장값과 실효값 대조·worktree 물리 파일 고정·symlink/환경 혼입·비활성 linked 및 main+peer 차단, peer/공유 config 보존, 일회용 Git 테스트 환경과 commit-msg 차단 토큰 확인을 검토했다. 원본 commit-msg SHA `d3e36ec07e1a2d900c99813b9284013d223dfb0e62dd526dc45036b62c303900`는 HEAD와 동일하다. 실제 설정 적용·시험 실행은 하지 않았으며, 기존 full runner의 index/HEAD 변경 위험 때문에 독립 fixture에서만 실행해야 한다. ext OFF 단일 clone과 새 worktree 생성의 동시 경합은 원자적으로 차단하지 않으며 현재 적용대상은 ext ON linked다. 가린 리뷰 영수증 `reviewer-t165.json` SHA `c02c7952d70970b683cfc15e1b16e2208d6989309769170835dd3fd5a2f9452c`.
- [00:10] **최종 판정: PASS (scope: scripts/install-git-hooks.sh, scripts/test-git-hooks.sh)**

## QA

- [00:15] QA 독립 실행: Mac 실제 worktree 실효 `scripts/git-hooks`/origin worktree `config.worktree`/훅·원본 SHA `d3e36ec0…`·mode755를 Root 사후 읽기영수증과 대조. Ubuntu 기존 실제 ABS shim `/home/brownjeon/.local/share/stockinvest-git-hooks/361294826755`/origin local `.git/config`/shim SHA `badbde9c…`·원본 SHA `8b358bea…`·실행가능을 사전영수증과 대조. 각 실제 ABS 훅을 별도 Git init 임시 저장소에 연결해 문서 허용·무task 안전파일 차단·잘못된 scope 차단·정확한 synthetic scope 허용을 각각 4/4 실커밋으로 확인했고 훅·원본 SHA 전후 불변. 모든 상속 GIT_* 제거·빈 template·전용 TMPDIR/XDG·독립 git-dir 확인. 실저장소 커밋은 COMMIT_EDITMSG까지 쓰므로 시행하지 않음. Developer Mac 전체 526/0 및 설치훅 실 E2E/HEAD불변 로그 SHA `8aff8ef1…`를 독립 열람했으며 QA 직접 재실행이 아님. Root 비교상 Mac 실제 HEAD/index bytes/COMMIT_EDITMSG/shared config/다른 worktree config·원 훅은 불변. Ubuntu 실제 HEAD/index entries/COMMIT_EDITMSG/shared config/shim/source/기존 tracked 75파일은 불변이나 raw index SHA 및 다른 세션의 untracked macro 문서 bytes는 변경 관찰돼 원인 단정·복구/덮어쓰기하지 않음. Ubuntu Developer 전체회귀 영수증 확인 대기.

- [00:18] 기능 범위 독립 QA **PASS**: Reviewer 두 파일 PASS/C2 후 Mac·Ubuntu 실제 실효 ABS 훅/원본을 각 SHA로 고정한 별도 Git init fixture 실커밋 각4/4. Developer 양호스트 full suite는 보호로그 독립 열람 결과 각526/0(기존491+신규35), 최종 설치훅 E2E 차단/fixture HEAD 불변이며 QA 재실행은 아니다. Mac로그 `8aff8ef1b308aa2e83b7d11f64b1e372d1cf24fe89dbbd6841b95755901b0aa7`, Ubuntu로그 `43c49d3cb3d28dd81f078f33ffe43aa651189e5158893cc272ffb6409d3b5ed5`, developer 종합 `46c9d46639ded3cc40d96ef60b9cac9912b180a4c947a0e31e8f7a5e938e6209`. QA 보호영수증 SHA `fda1f02f229d0bf100f425eeb8137cfe08b1f0bfad9703ea1550e01896b40001`. 실제 worktree 커밋은 메타데이터 변경을 피하려 하지 않았다. Root 전후읽기에서 Ubuntu index entries/HEAD/COMMIT_EDITMSG는 같았으나 raw index SHA가 달랐고 타 세션 untracked 문서도 변경돼 raw bytes 보존은 **NOT_VERIFIED**·원인미확정으로 보고하며 덮어쓰지 않는다. 이 검증은 앱·DB·배포·실매매 허가가 아니다.

## 최종 요약

### [T-166] 맥 Git 훅 복구와 우분투 기존 설치 보존

- **상태**: ✅ 완료 — 현재 Mac worktree의 경로 복구·양호스트 검증 범위.
- **무엇이 바뀌었나**: Mac만 worktree config에 `core.hooksPath=scripts/git-hooks`를 지정해 실행 가능한 원본 훅을 사용한다. installer/test 두 파일을 보완해 재설치 시 공유 Linux 설정을 덮어쓰지 않고, 실제 훅 미실행을 차단 성공으로 오인하지 않게 했다. Ubuntu 기존 훅·shim·공유 config는 그대로다.
- **배포**: Git 개발환경 설정은 현 Mac에 적용했다. 후속 사용자 승인은 동결 스크립트2파일과 T-166 문서5파일의 main 발행만 포함한다. 커밋 자기참조를 피하기 위해 발행 SHA·웹훅 결과는 별도 보호 영수증과 최종 채팅에 기록한다. Ubuntu 훅 재설치·APK·DB·매매 설정 변경은 없다. 이번 발행에 새로 포함할 다른 작업: 없음.
- **AI 가 검증한 것**: Reviewer 정확2파일 감사, C2 정본판정/명시된 Codex 세션 예외 기록, Developer Mac/Ubuntu 각 전체526/0 및 QA의 두 로그 독립열람, QA의 실제 설치 ABS 훅 각4/4 실커밋 검증(일회용 저장소만), 실제 설정/경로/executable·호스트 보존 지문 대조.
  - 검증 못 한 것: 실제 사용자 worktree 직접 시험 커밋은 index/COMMIT_EDITMSG 보호를 위해 수행하지 않았다. Ubuntu raw index bytes 보존은 확인되지 않았고 원인 미확정이며 staged entries/HEAD/메시지는 동일하다.
- **👉 사용자가 확인할 것**: 없음.
- **👉 사용자가 결정할 것**: 없음.
- **남은 일**: 구현·호스트 검증 범위 없음. 후속 발행은 exec-003 승인 범위로 한정하고 실제 결과는 Git 이력·보호 영수증·최종 보고로 확인한다. 기존 T-156 후속 관측 예약과 상태는 그대로다.
- **이슈·위험**: ext OFF 단일 clone에서 peer 목록 확인과 새 worktree 생성의 동시 경합까지 원자화하지 않는다(이번 실제 대상은 ext ON linked). 기존 full runner는 index/HEAD를 사용할 수 있어 실제 작업트리에서 실행하지 않는다. Mac 복구가 필요하면 보호된 원 config.worktree 백업만 복원하며 공유 설정/다른 세션 작업은 건드리지 않는다. 병행 T-165 macro 작업과 번호만 분리했고 그 문서는 변경하지 않았다.

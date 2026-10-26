---
task_id: T-094
title: 앱·인증 후속 보강 묶음(WP-1~5) — 전략 검증 줄기(Q3) 종료 뒤 착수
status: todo
priority: low
project: StockInvest
created: 2026-10-26
updated: 2026-10-26
base_ref: 53b97d9
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-091-app-version-gate-and-m2, T-092-hook-safety-paths-auth-impl, T-093-hook-safety-paths-auth-tests, T-089-open-redirect-next-path, T-095-postmortem-script-p1]
tags:
  - type/task
  - domain/mobile-app
  - domain/auth
  - domain/safety
aliases:
  - 앱인증후속
waiting: [Q3 줄기 종료 보고(T-095 P1 → P2 사전 등록 → P3 결과 또는 중단 결정), 사용자 "T-094 착수" 지시]
demo_gate:
  required: false
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: ""
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-094 앱·인증 후속 보강 묶음 — **지금 착수하지 않는다**(절차만 정의)

## 목표와 사용자 결정

- **사용자 결정 원문**(2026-10-26 15:30 이전, "다음 작업" 목록의 Q5 에 대한 답): "Q5: Q3 이후에 진행하도록 절차 만들어줘" → 이 task 는 **Q3 줄기(전략 검증)가 끝난 뒤에** 착수하도록 **절차를 만들어 둔다.** 지금은 아무것도 구현하지 않는다.
- **Leader 해석(틀리면 사용자가 정정)**: "Q3 이후" = **Q3 줄기의 종료 보고 이후**. Q3 줄기 = [[T-095-postmortem-script-p1]](P1) → P2(합격 기준 사전 등록, 사용자 확정) → P3(백테스트 — 착수는 사용자 승인) 이며, 종료 보고 = P3 결과 보고 **또는** 사용자가 P3 를 하지 않기로 한 결정. P3 는 오래 걸릴 수 있어(수 주) 이 task 가 그만큼 밀린다는 점을 알고 있다 — 더 일찍 착수하길 원하면 "P1 완료 직후" 같은 다른 기준을 사용자가 지정하면 된다(아래 §착수 절차 G0).
- **왜 보류가 맞나(Leader 근거, [가능성 높음])**: 이 묶음의 5건은 모두 **제품 결함이 아니라 방어 보강·문서 정리**다. 수익 경로(시그널→집행)와 직접 연결되지 않고(제1원칙), 앱 1.1.0 은 사용자 실기기 확인까지 끝났다(2026-10-26 14:50).

## 묶음 구성 (T-091·T-093 에서 나온 후속 후보 — 새 요구를 만들지 않는다)

| WP | 무엇 | 왜 | 파일(예상) | 안전 경로 | 배포 | 예상 규모 |
|---|---|---|---|---|---|---|
| WP-1 | `login-screen-t088.test.ts` 조이기 — 로그인 후 이동 관문이 **T-089 이전 원문**(`startsWith('/') && !startsWith('//')`)으로 되돌려져도 통과하는 시험의 느슨함 제거(수정형만 통과) | T-093 으로 이 시험이 훅 감시에 들어왔는데 원문 회귀를 못 잡는다(T-093 한계). 열린 리다이렉트(T-089) 회귀 방어선 | `src/components/auth/__tests__/login-screen-t088.test.ts` | **감시 대상**(T-093) → Reviewer 판정 scope 필수 | 시험만 — 배포 불필요 | 작음 |
| WP-2 | `mail/header-safe.ts`(+ `mail/__tests__/header-safe.test.ts`) 를 훅 `SAFETY_PATHS` 에 추가 | 요청 유래 메일 제목·주소의 CR/LF 정화 — 약화되면 Bcc 삽입으로 초대코드 유출 가능(T-092 후보 ①, 중~약) | `scripts/git-hooks/commit-msg`·`scripts/test-git-hooks.sh`·CLAUDE.md 한 문장 | 훅 자신이 안전 경로 | 훅은 커밋 즉시 활성, push 불필요 | 작음(T-093 과 같은 방식) |
| WP-3 | 앱 `getAppVersion()` 조회 시간 제한 — `App.getInfo()` 가 끝내 응답하지 않으면 로그인 화면의 Google 자리·구분선이 영구히 비는 문제(이메일 로그인은 됨) → 시간이 지나면 "버전 모름"(= 막지 않음)으로 처리 | T-091 한계 ①(Reviewer·QA 낮음 평가) | `src/lib/native/bridge.ts`(+ `OAuthButtons.tsx` 사용처 확인)·시험 | 아니오(UI 상태 전이만, 새 화면 없음) — 데모 불필요 [가능성 높음, judge 가 확정] | **웹 배포 필요**(push=배포, APK 불필요) | 작음 |
| WP-4 | `scripts/build-apk.sh` Manifest 검사 보강 — 딥링크 intent-filter 의 **부모 activity 이름이 MainActivity 인지**, 병합 Manifest 의 `exported=true`·`launchMode=singleTask` 확인 | T-091 Codex C2 low | `scripts/build-apk.sh`·`src/lib/native/__tests__/manifest-deeplink-t088.test.ts` | 아니오 | 스크립트·시험만 — 다음 APK 빌드부터 적용(APK 재빌드 불필요) | 작음 |
| WP-5 | 문서·시험 보강: Reviewer N1(`app-version-gate-t091.test.ts` 소스 가드에 이미 있는 `code()` 한 줄 적용 — effect 줄 주석 처리 우회 변이 3종 검출), N2(`deploy-order.md` 의 L3 순서 문장 "① 기능 코드 배포 → ② APK 공개 → ③ 표 값 상향 push" 분리) | T-091 비차단 후속 | `src/components/auth/__tests__/app-version-gate-t091.test.ts`·`docs/deploy-order.md` | 아니오 | 시험·문서만 | 매우 작음 |

> WP-3 만 웹 배포를 부른다. 나머지는 훅·스크립트·시험·문서라 **다음 push 에 동승**(문서·스크립트만을 위한 배포는 하지 않는다 — 프로젝트 기존 원칙).
> 새 후보가 생기면 이 표에 한 줄을 더하되, 착수 전에 사용자에게 알린다. 이 묶음 밖(예: 새 앱 기능·M3 앱 잠금·M4 푸시)은 별도 task.

## 착수 절차 (이 순서로만 시작한다)

**G0 — 착수 조건(둘 다 충족해야 시작)**
1. Q3 줄기 종료 보고가 사용자에게 나갔다(T-095 최종 요약 + P2 사전 등록 확정 기록 + P3 결과 보고 또는 "P3 중단" 사용자 결정). 또는 사용자가 다른 기준을 말로 지정했다.
2. 사용자가 **"T-094 착수"**(또는 WP 를 지정해 "WP-n 착수")라고 말했다. 이 문서의 존재·AI 판단만으로 착수하지 않는다.
- **예외(핫픽스)**: 앱 결함 신고(링크가 앱을 안 연다·로그인이 막힌다 등)가 들어오면 이 절차와 무관하게 **단건 task** 로 즉시 처리한다(이 묶음에 합치지 않는다).

**G1 — 착수 전 점검(Leader, 읽기 전용, 10분 안)**
1. 상태 재확인: `git status`·`git log origin/main..HEAD`(타 세션 미커밋 변경 목록 기록 — 건드리지 않는다), 훅 sha(`scripts/git-hooks/commit-msg`)와 설치 shim 이 메인 트리 훅을 실행하는지, `app_release` 최신 행(현재 1.1.0·versionCode 3), 킬스위치·최근 3시간 주문 수·`/api/health`.
2. `/이슈기록 관련 앱·인증 안전` 으로 승인된 교훈(최대 5개)을 조회해 task "관련 과거 이력 요약"에 넣고 ID 를 적는다. 교훈 전체를 읽지 않는다.
3. 이 표의 5개 WP 중 **그 사이 낡아진 것**(이미 다른 task 가 처리·코드가 바뀜)을 코드로 대조해 걸러낸다. 걸러낸 것은 표에 취소선 + 사유.
4. 사용자에게 **WP 별 go/no-go**(권고 포함)를 한 표로 묻는다(WP-3 은 웹 배포가 따르므로 배포 시점 선택 포함: 장외 창 15:40~22:20 KST 권고, 사전 조건 킬스위치 ON·3시간 주문 0건·health 200).

**G2 — 순서와 묶음 규칙**
- 권고 순서: **WP-1 → WP-2**(시험을 먼저 조여야 훅 감시가 의미 있다) → WP-5 → WP-4 → **WP-3**(웹 배포를 부르는 것은 마지막). WP 마다 **별도 커밋**(되돌리기 단위) — 한 번에 합치지 않는다.
- 안전 경로(WP-1·WP-2 와 WP-4 의 시험): **격리 worktree** 에서 작업, **Reviewer 판정 줄**(`## Reviewer` 마지막 `최종 판정: PASS (scope: …)`, 실제 검토한 파일 전부) 없이는 커밋하지 않는다(훅이 막는다). 판정 설명문에는 "최종 판정" 구절·대문자 PASS/FAIL 을 쓰지 않는다(훅 인식 규칙).
- WP-2 는 T-093 방식 그대로: 정확 일치 항목 + 근거 주석(**근거 주석의 사실 오류가 매번 Reviewer 에게 걸렸다 — 각 파일이 실제로 무엇을 고정하는지 코드로 확인**)·`test-git-hooks.sh` 로직 단계 시험(전체 스크립트 금지 — `# [E2E]` 앞까지 자른 사본)·일회용 저장소 실 커밋 QA.

**G3 — 역할·판정**
- 각 WP: judge 접수(`demo_pref` 없이 — WP-3 이 화면 상태를 바꾸는지 judge 가 판정, 새 화면·구조 변경이면 데모 게이트) → Developer(judge 가 모델 지정) → Reviewer(Sonnet, 독립 감사) → judge C2(Codex 필요 시) → QA(격리 사본) → Leader 커밋.
- 화면 표시가 바뀌는 WP-3 은 데모 불필요 판정이 나와도, 상태 전이 표(응답 있음·없음·시간 초과)를 task 에 적고 사용자에게 알린다.

**G4 — 배포·기록**
- push·배포 시점은 사용자 승인. 배포 직전·직후 점검은 T-091 `## 배포 기록` 과 같은 항목(킬스위치 ON·3시간 주문 0건·pm2 새 릴리스·cron 1행·health 200·`system_config` 키 불변·주문 id 불변 — 비교 파일은 `kis_access_token`·`cred_%` 키를 **제외**하고 값은 출력하지 않는다).
- APK 가 필요한 변경은 이 묶음에 없다. 만약 WP 가 `android/**`·`capacitor.config.ts`·`public/app-shell/index.html`·Manifest 를 건드리게 되면 즉시 중단하고 `docs/mobile-app-procedure.md` 의 네이티브 변경 절차(versionCode 증가·재설치 고지)를 따르는 별도 task 로 분리한다.
- 완료 보고는 `docs/user-report-format.md` §3 블록(WP 마다 1블록), 상태·`waiting` 갱신, board·ACTIVE·RESUME·`20-Log` 갱신.

**G5 — 종료 조건**
- 사용자가 보류를 해제한 WP 가 모두 `done` 이거나 `취소` 사유가 기록되면 이 task 를 닫는다. 일부 WP 만 사용자가 승인하면 나머지는 이 문서에 남겨 둔다(`status: doing`·`waiting` 에 남은 WP).

## 하지 않는 것

지금(Q3 줄기 중) 이 task 의 어떤 WP 도 구현·커밋·배포하지 않는다. 앱 새 기능·M3·M4 는 범위 밖. 훅 판정 로직 변경 금지(WP-2 는 목록 항목 추가뿐).

## 허용 권한

현재 없음(문서 정의만). 착수 후 권한은 G1 에서 사용자에게 WP 별로 받는다.

## 판단 기록 (judge)

(착수 시 WP 별로 접수)

## 관련 과거 이력 요약

- [[T-091-app-version-gate-and-m2]]: 비차단 후속(N1·N2·`getInfo` 시간 제한·Codex low). 사용자 실기기 확인 완료(10-26 14:50).
- [[T-093-hook-safety-paths-auth-tests]]: login-screen 시험 한계·header-safe 다음 후보 1순위·정확 일치라 새 인증 시험 파일은 자동 감시되지 않음.
- [[T-092-hook-safety-paths-auth-impl]]: header-safe 후보 의견(중~약, nodemailer 9.0.5 가 제목 CRLF 를 자체 치환).
- [[T-089-open-redirect-next-path]]: 이동 경로 관문(WP-1 이 지키려는 것).
- 사용한 교훈 ID: 없음(착수 때 G1-2 로 조회).

## 진행 기록

- 2026-10-26 15:3x: Leader 작성(절차 정의만). 착수 조건 G0 미충족 — `status: todo`.

## Developer

## Reviewer

## QA

## 배포 기록

## Codex 검토

## 최종 요약

(완료 시 Leader 가 작성)

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음(착수 때 WP-3 재판정) | - | - | judge: none(미접수) | 10-26 15:3x |

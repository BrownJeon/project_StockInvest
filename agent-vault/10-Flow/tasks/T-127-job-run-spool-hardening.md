---
task_id: T-127
title: 러너 스풀 후속 보강 후보 — 금액 본문 마스킹·스풀 파일 0600·롤업 failed 전이 시험 (T-112 Codex·Reviewer 후속)
status: proposed
priority: low
project: StockInvest
created: 2026-10-30
updated: 2026-10-30
base_ref: origin/main 9d087a4
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-112-run-judgment-record-foundation, T-108-automation-menu-home-overhaul]
tags:
  - type/task
  - domain/data
  - domain/ops
aliases:
  - 러너스풀보강
waiting: [T-112 배포 완료, 사용자 착수 결정]
---

# T-127 러너 스풀 후속 보강 (후보 — 착수 전)

## 후보 등록 근거
- T-112 의 Codex 검토(C2, 2026-10-30 19:50, 1차)가 지적 1건(medium)을 냈고 Reviewer 가 **부분 채택·Low(Minor-4)·이번 배포를 막지 않음**으로 판정했다(근거: [[T-112-run-judgment-record-foundation]] `## Reviewer`·`## Codex 검토`). 배포를 막지 않으므로 별도 task 로 분리한다.
- **무엇이 문제인가 [확실 — Reviewer 가 러너 `call` 24곳 전수 확인]**: 러너 후크가 응답 앞 2KB 를 base64 로 스풀(`~/.node-local/stockinvest/job-run-spool`, 644)에 적는데, 금액·잔액·손익을 싣는 라벨이 둘이다 — `portfolio-snapshot`(`totalKRW`·`cash.KRW`·`cash.USD`, 매시 1회)과 `trade-report`(`headerPnlKRW`·`lifoPnlKRW`, 보고서를 보낸 호출). 정상 때 스풀 수명은 약 60초, 기록 라우트 장애 때는 장애 기간(상한 2MiB).
- **왜 낮은가**: 같은 본문이 이미 `/tmp/cron-runner-$$.out`(644, 호출 중·러너가 죽으면 잔존)에 있고, 스풀이 새로 만드는 것은 파일 1개와 지속 시간뿐이다. 읽을 수 있는 쪽도 넓어지지 않는다(`/home/brownjeon` 750 → 같은 계정·root 뿐). 서버는 본문 원문을 DB 에 저장하지 않는다(`counts_json` 허용 키 숫자·분류어만, 금액 키 이름 참조 0건).

## 범위(착수 시)
1. **금액 값 마스킹** — `jrl_hook` 에서 두 라벨만 base64 전에 금액 키(`totalKRW|KRW|USD|headerPnlKRW|lifoPnlKRW`)의 값을 0 으로 바꾼다. 본문 생략(`b64_skip`)은 권하지 않는다: `portfolio-snapshot` 은 200 본문의 `skipped` 신호로 상태를 가르는 비롤업 잡이라 본문을 빼면 상태가 전부 `ok` 가 된다. 마스킹은 `classifyRun`·`job-slots.ts` 표·`job-slots.test` 변경이 0 이다.
2. **스풀 0600** — `jrl_hook`·`jrl_flush` 안에서만 umask 를 저장·`077`·복원(`jrl_flush` 는 `return 0` 이 여러 곳이라 `_jrl_flush_body` 래퍼). 서브셸 `( umask 077; jrl_flush )` 는 `JRL_FAILING` 상태가 사라져 금지, 디렉터리 0700·러너 전체 umask 는 하트비트·날짜파일(T-037 워치독·순찰)에 영향이라 금지.
3. **롤업 `failed` 전이 시험 한 케이스**(Reviewer Minor-1, `job-run-log.ts:522` 의 `>=`→`>` 변이가 안 잡힘): "failed 2건 → failed 배치 1건 더 → status failed" 약 5줄.
4. **문서**(Reviewer Minor-2): 롤업 `runs` 는 근사값 — 서버 처리 상한 2.5초를 넘기면 503 으로 답하지만 `work()` 가 계속 돌아 커밋되고 러너가 같은 줄을 다시 보내 두 배가 될 수 있다. T-108 지표 계약에 "롤업 `runs` 는 근사값" 명시. **실측(T-112 관찰 22:13)**: 21:55:27 의 503(처리 상한 초과 뒤 커밋) 때 `runs` 합 71 대 실제 틱 68 로 +3 과대 집계가 실제로 발생 — 문서만이 아니라 재전송 중복 억제(예: 줄마다 멱등 키로 롤업 가산을 한 번만)를 후속 설계 후보로 둔다. 전송 실패 503 은 62회 중 2회(약 3%)이고 사유가 로그에 없다(5번).

5. **503 사유 로그**(T-112 관찰 21:30 — 전송 실패 HTTP=503 1건, 1분 뒤 회복, 사유 미상): 라우트의 스위치 읽기·처리 2.5초 상한 초과 경로는 로그를 남기지 않고 러너는 응답 본문을 버린다 → 상한 초과·스위치 읽기 실패 때 `console.warn` 한 줄(원인 분류어만, 본문·금액 없음)과, 러너가 503 일 때 응답 본문 앞 80자(`reason`)를 실패 로그 한 줄에 함께 적는 안. 러너 수정이므로 1·2 와 같은 재시험·Reviewer 재순환에 묶는다.

## 재시험 범위(Reviewer 추정)
새 러너 시험 `scripts/test-cron-runner-job-run-log.sh` 약 11분(마스킹·"umask 022 에서 600" 케이스 추가), `job-slots.test` 수 초, 기존 러너 시험 6종 약 40분, Reviewer 재순환·QA 포함 1시간 반 이상. 러너(`scripts/cron-runner.sh`)는 훅 감시 경로라 Reviewer `최종 판정` 필요.

## 착수 조건
사용자 착수 결정. 배포는 push=blue/green(웹·크론 둘 다 재기동)이므로 장외 창.

## 하지 않는 것
이 후보 등록으로는 코드·스위치·DB 를 바꾸지 않는다.

## 진행 기록
- [2026-10-30 20:00] 후보 등록(Leader). T-112 Codex C2 지적 1건 + Reviewer Minor-1·2 를 모아 둠.

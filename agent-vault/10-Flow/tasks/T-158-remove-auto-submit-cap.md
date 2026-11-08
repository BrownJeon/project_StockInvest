---
task_id: T-158
title: 운영 자동 제출 상한 제거 및 환경 설정 확인
status: done
project: StockInvest
created: 2026-11-07
updated: 2026-11-07
roles_involved: [leader]
related_tasks: [T-154]
tags: [type/task, domain/safety, domain/ops]
aliases: [자동 제출 5만 원 상한 제거]
execution_context:
  schema_version: 1
  origin_tool: codex
  current_tool: codex
  current_procedure: codex_scoped
  current_scope: "사용자가 지정한 운영 환경변수 한 줄 제거, 현행 릴리스 반영 확인, 나머지 키의 사용처 조사"
  last_event_id: exec-001
---

## 목표

운영의 5만 원 자동 제출 상한을 제거하고 앱 설정에서 관리할 수 없는 환경 설정을 확인한다. [[T-154-auto-approval-mode-setting]]의 자동승인모드 ON 상태에서 마이크론 매도 시그널이 금액 초과로 승인 대기에 들어간 것이 계기다.

## 실행 도구·절차 이력

| 이벤트 ID | 시각(KST) | 사건 | 이전 → 현재 담당 / 현재 절차 | 범위·남은 일 | 근거 |
|---|---|---|---|---|---|
| exec-001 | 2026-11-07 00:02 운영 반영 | start | 없음 → codex / codex_scoped | 운영 환경변수 한 줄 제거, 기존 웹 프로세스 재기동, 환경 설정 사용처 확인 | 본 채팅에서 사용자가 상한 제거와 다른 환경 설정 확인을 명시 요청 |

## 최종 요약

- 00:02 KST 운영 `shared/.env`에서 `SIGNAL_AUTO_SUBMIT_MAX_KRW=50000` 한 줄을 제거했다. 기존 릴리스 `20261106-231601-c33e4678`의 웹 프로세스만 재기동했다. 파일의 나머지 바이트와 접근 권한을 보존했다.
- Next.js 운영 환경 로더에서 키가 빠졌고 새 웹 프로세스에도 상속되지 않았음을 확인했다. 헬스체크 `ok`와 DB 연결이 정상 응답했고 cron PID는 동일했다. `auto`, 킬스위치 ON, DRY_RUN ON을 확인했다. 별도의 매수 주문 한도 미구성(`order_limits_unconfigured`)은 변경 전후 모두 관측됐다. 실제 시그널 생성과 주문 제출은 검증에 사용하지 않았다.
- 운영 `.env`에 남은 54개 키를 값 출력 없이 확인했다. 해외 거래 환경, KIS 디버그·기본 거래소, DB·인증·메일·서비스 연동 설정에는 서버 전용 항목이 있다. 변동성 가드, 차단 종목, LLM 설정 일부, KIS·텔레그램 자격증명은 앱이나 DB로 덮어쓸 수 있다. 시그널 기본 유효기간과 검증 단계 생략 옵션은 DB 읽기 경로도 있다.

---
task_id: T-039
title: 재배포 때 '자동 청산 OFF' 알림 2건 중복 + 텔레그램 간헐 ETIMEDOUT 으로 승인 요청 유실
status: todo
waiting: [보류 — 사용자 10-26 "권고대로"; 재개 조건: 텔레그램 실패 빈도 재상승 또는 사용자 지시]
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-037, T-038-llm-base-url-setting]
tags:
  - type/task
  - domain/notify
  - domain/ops
aliases:
  - 알림 중복
  - 텔레그램 ETIMEDOUT
  - 승인 요청 유실
created: 2026-09-22
updated: 2026-10-26
---

## 배경 (사용자 보고, 2026-09-22)

> "11:12 에 LG 에 대한 매수알람은 왔으며 그 뒤에는 자동청산에 대한 알람이 11:49 에 2건이 2초 간격으로 수신됐어.
> 이것에 대한 확인 및 수정작업을 위해서 작업내역서를 작성해서 … 주식매매 세션을 생성해서 작업할 수 있도록 준비해줘."

두 가지가 섞여 있다: **(A) 11:49 알림 2건 중복**, **(B) 11:12 이후 11:49 까지 알림이 끊긴 것(= 그 사이 승인 요청 유실)**.

## 사실 (Leader 사전 조사 — 09-22 11:5x, 읽기 전용 실측)

### 먼저: 실제 주문은 나가지 않았다
- 운영 DB `orders` 테이블 `created_at >= 2026-09-22 11:00` → **0건**. 매도 없음. 11:12 LG 매수도 승인 대기였을 뿐 체결 없음.
- 11:49 로그: `[exit-engine] 🔕 000660 hard_stop 발화 조건 충족 (평가손익 -27.36%) — 자동 청산 엔진 OFF 이므로 시그널·주문을 만들지 않습니다`, 005930(-15.38%) 동일.
  `system_config.exit_engine_enabled=false` 상태(사용자 설정). **보유 2종목이 하드손절 조건을 충족한 채 자동 청산이 꺼져 있다**는 사실 자체는 알림 내용대로다.

### (A) 11:49 알림 2건 — 원인 확정
1. **11:49 는 재배포 시각**이다(사용자가 M4 키 반영을 위해 `scripts/deploy.sh StockInvest --ref 4a50f007…` 실행, 릴리스 `20260922-114923-4a50f007`).
2. **배포가 앱을 두 번 기동한다**: pm2-out `✓ Ready` 11:49:50 · 11:49:55, cron-out `[cron-runner] started` 11:49:52 · 11:49:55.
   원인은 `HOME-SERVER_CONFIG/servers/linux/deploy/release.sh` — `reload_apps` 의 `pm2 startOrReload … --update-env`(L78) 뒤에
   `ensure_current_cwd` 가 cwd 가 옛 릴리스면 `pm2 delete` + `pm2 start`(L112-113)를 한 번 더 한다. **전 프로젝트 공통**(HOME-SERVER 소관).
3. **알림 출처**: `src/lib/strategy/engine.ts:925` —
   `sendAlertThrottled('exit-engine:disabled:${market}', 'warning', '🔕 자동 청산 OFF — 청산 조건 N건이 주문 없이 지나갔습니다 (…)', …, 12h)`.
4. **스로틀이 프로세스 메모리에만 있다**: `src/lib/notify/throttle.ts:20` `const lastSentAt = new Map<string, number>()`.
   → 12시간 1회 제한이 **기동마다 초기화**. 두 번 기동 → 기동 직후 holding-checker(11:49:53, 11:49:55) 마다 1건씩 = **2초 간격 2건**.
   (재기동이 없으면 12시간에 1회라 평소엔 안 보였다. `db.ts:749` 의 `[boot] 자동 청산 엔진 OFF` 배너는 console 전용이라 무관)

### (B) 11:12 이후 알림 두절 — 텔레그램 간헐 ETIMEDOUT
- pm2-err: `[notify] telegram 전송 실패 — level=info title="📩 승인 요청: 현대차" reason=fetch failed (ETIMEDOUT / Error: connect ETIMEDOUT 149.154.166.110:…)` (11:19), `현대글로비스` (11:31).
- 오늘 실패 **49건**(00시 8 · 01시 2 · 02~04시 각 4 · 09시 5 · 10시 1 · 11시 5 …), 어제 19건. 해외 종목 승인 요청(BANK OF AMERICA·BOOKING·COSTCO·COMCAST·NIKE·MICRON…)도 다수.
- 같은 시간대에 성공도 섞여 있다 → **완전 차단이 아니라 간헐**. 11:5x 에 `curl https://api.telegram.org` 는 0.8s 로 정상.
- **영향**: 승인 기반 매매에서 승인 요청이 사용자에게 도달하지 못하면 시그널은 TTL 로 만료 → 기회 손실(오주문은 아님).
- 가설(미검증): Node `fetch`(undici) 가 IPv6 경로를 먼저 시도하다 타임아웃 / 텔레그램 IP 대역 일부 경로 불안정. 재시도 없이 1회 실패로 유실되는 것이 확정적 문제.

## 해결 방향 (Leader 제안 — 세션에서 확정)

1. **(A-1) 스로틀 영속화**: `throttle.ts` 의 `lastSentAt` 을 DB(또는 `shared/` 파일) 로 — 재기동해도 12h 창이 유지되게. 최소안: 기동 후 N분 grace + 영속 키 조회.
2. **(A-2) 이중 기동 제거**는 `release.sh` 수정 = **HOME-SERVER 소관 별건**(모든 프로젝트 배포에 영향). 이 task 에서는 A-1 로 증상을 막고, `release.sh` 는 제안(diff)만 남겨 워크스페이스 세션에 인계.
3. **(B-1) 텔레그램 재시도/큐**: 실패 시 백오프 재시도(예: 3회), 그래도 실패하면 **미전송 큐에 적재 후 다음 틱에 재발송**. 승인 요청은 특히 유실되면 안 된다 — 만료 전에 재시도.
4. **(B-2) 원인 조사**: 실패 시각 분포·대상 IP·IPv4/IPv6 여부(`dns.setDefaultResultOrder('ipv4first')` 실험), 타임아웃 값.
5. **(B-3) 오늘 유실분 보고**: 09-22 텔레그램 실패로 전달되지 못한 승인 요청 목록과 그 시그널의 현재 상태(만료/대기)를 사용자에게 보고.

## ⚠️ 주의

- `src/lib/notify/**`·`src/lib/strategy/engine.ts` 는 `SAFETY_PATHS` 여부 확인 후 Reviewer 게이트(`awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg`).
- 알림 코드 수정이 **주문 경로를 건드리지 않게** — T-037 워치독처럼 자금 경로와 격리.
- 배포는 장 마감 후, `scripts/deploy.sh StockInvest` 를 사용자가 직접 실행(에이전트 실행은 분류기가 차단).
- 이 배포 자체도 앱을 두 번 기동한다 — A-1 이 들어가기 전의 마지막 배포에서는 같은 중복 알림이 한 번 더 올 수 있음을 사용자에게 미리 알린다.

## 검증 체크리스트 (QA)

- [ ] 스로틀 키가 재기동 후에도 유지된다(같은 키 12h 내 재발송 없음) — 테스트 + 운영 재기동 1회 관측
- [ ] 텔레그램 fetch 를 강제로 실패시키면 재시도 → 큐 적재 → 다음 틱 재발송이 된다(단위 테스트)
- [ ] 승인 요청 알림이 재시도 끝에 성공하면 중복 발송되지 않는다(멱등)
- [ ] 알림 경로 실패가 strategy-eval·entry-watcher 등 주문 경로를 막지 않는다

## Leader 기록

- **2026-10-26 16:29 상태 정리(T-083 R01 후속)** — 사용자 발화 그대로: "2. T-042·T-044 상태는 권고대로 진행해줘 / 3. T-038, T-039도 권고대로 진행해줘"(10-26 16:29 이전, T-083 `## Leader 기록` 4개 task 대조표의 권고에 대한 답). **결정: 보류**(Leader 권고 수용). 사실(T-083 대조표): (A) 스로틀 영속화 미착수 — `src/lib/notify/throttle.ts` 는 여전히 프로세스 메모리 `Map`, 이중 기동은 HOME-SERVER 소관. (B) 텔레그램 전송 실패는 10-10 하루 12건에서 10-16 3·10-22 1·10-23 1건으로 줄었으나 지속, 재시도는 1회(500ms), 큐·백오프 없음. 재개 시 범위 후보: 스로틀 영속화 + IPv4 우선 실험(좁힌 범위). 승인 요청이 앱 링크(M2)와 연결된 지금 유실이 다시 늘면 우선순위를 올린다. frontmatter `status` 는 todo 로 두고 `waiting` 에 보류 사유·재개 조건을 적었다.


- [09-22] 워크스페이스 세션이 사실 조사·작업서 작성. 코드·DB 변경 없음.

## Developer

## Reviewer

## QA

## 최종 요약 (사용자용)

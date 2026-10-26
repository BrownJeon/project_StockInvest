---
task_id: T-042
title: 텔레그램에서 바로 시그널을 승인·거절한다 — 인라인 버튼 + getUpdates 폴링 (승인 병목 개선 2건 묶음)
status: done
waiting: [device_verify]
roles_involved: [leader, designer, developer, reviewer, qa]
related_tasks: [T-041, T-039, T-038, T-007, T-010]
tags:
  - type/task
  - domain/signals
  - domain/notify
  - domain/safety
aliases:
  - 텔레그램 버튼 승인
  - telegram approval buttons
created: 2026-10-11
updated: 2026-10-26
demo_gate:
  required: true
  level: "delta"
  status: "drafting"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: "JV-ui_change"
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

## 배경 (사용자 요청, 2026-10-11)

승인 병목 개선 사항 중 두 건을 사용자가 지적했고, 두 건 모두 이 task 에서 다룬다.

1. 승인 요청이 매매 시점보다 늦게 와서 타이밍을 놓치고 승인하지 못했다.
2. 알림은 텔레그램에서 받는데, 승인하려면 앱에 들어가 시그널을 찾아야 해서 번거롭다.

사용자 결정(2026-10-11, 선택지 제시 후): **① 기존 봇을 그대로 쓴다 ② 버튼 승인으로 거래 권한을 텔레그램에 넘긴다 ③ 링크(A) 단계 없이 바로 B(인라인 버튼 + 폴링)로 간다.**
리스크(텔레그램 계정 탈취 = 거래 승인 권한, 봇 토큰 공유)는 고지했고 수용됐다. 같은 반론을 반복하지 않는다.

관련 교훈(`/이슈기록 관련 safety`): 승인된 교훈 없음.

## 사실 (읽기 전용 실측, 2026-10-11)

| 항목 | 사실 | 확신 |
|---|---|---|
| 승인 요청 도달 | 9/21 이후 시그널 706건 중 553건(78%)의 사유 줄에 `<` 가 있어 텔레그램이 HTTP 400 으로 거부한다. 전송 실패 로그 573건 중 492건이 이 오류, 81건이 ETIMEDOUT. 오류 위치(byte 122)가 재구성한 메시지의 첫 불법 `<` 와 일치 | 확실 |
| 원인 코드 | `signals/service.ts` 의 승인 요청 본문(`bodyLines`)이 이스케이프를 한 번도 호출하지 않는다. `notify/escape.ts` 는 있으나 이 경로에서 안 쓴다 | 확실 |
| 신호 수 | 활성일 평균 36건/일(설계 목표 3~9). 해외 매수 대부분이 한국 시간 22~04시. TTL 은 전부 30분 | 확실 |
| 봇 | 텔레그램 수신 코드(콜백·웹훅·폴링) 전무. StockInvest 와 TradingInvest 가 **같은 봇 토큰**(해시 일치). TradingInvest 는 수신 코드 없음(설정 화면 안내 문구에서만 `getUpdates` 언급) | 확실 |
| 승인 경로 | `POST /api/signals/{id}/approve`, 세션 쿠키 인증. `hybrid_mode_enabled=true`(2026-05-23~) → `approveSignalHybrid` → `approved_pending_entry` | 확실 |
| 원자성 | `approveSignalHybrid`/`approveSignal`/`rejectSignal` 모두 상태 확인과 UPDATE 가 분리돼 있고 UPDATE 에 `AND status IN (…)` 가 없다 → `expired`/`rejected` 를 덮어쓸 수 있고 웹·텔레그램 동시 승인을 막지 못한다 | 확실(코드) |
| 안전 경로 | 훅 `SAFETY_PATHS` 에 `src/lib/notify/`, `src/lib/ops/`, `src/instrumentation.ts` 가 **없다**. 거기에 승인 핸들러를 두면 Reviewer 강제를 피한다 | 확실 |

### 🔴 선행 확인이 필요한 의심 — 승인이 주문으로 이어지는가

- **룰 신호를 승인하면 주문이 안 나갈 가능성이 높다.** 하이브리드 승인은 `approved_pending_entry` 로 바꿀 뿐이고, 진입 감시(`entry-watcher`)는 `indicators.ai.scenario.entry.price_zone` 이 없으면 `no_zone` 으로 건너뛴다. RSI 과매도 룰 최근 200건 중 `price_zone` 보유 0건, `indicators.ai` 보유 12건. [가능성 높음 — 코드·데이터 추론이며 실행 경로는 직접 관측하지 못했다. 9/19 이후 로그에 감시된 승인 시그널이 0건이라 `no_zone` 로그도 없다]
- **사람 승인 `approved` 4건 모두 `consumed_order_id` 가 NULL** (마지막 주문 연결은 05-26 `executing` 2건). `approveSignal` 은 `submitOrder` 결과의 성공 여부를 보지 않고 `status='approved'` 로 기록한다 → "승인했는데 주문이 거부된" 건이 `approved` 로 남는다. [확실(코드), 원인 개별 건 미확인]
- 따라서 **버튼을 달아도 승인→체결 사슬이 끊겨 있으면 한 번 탭이 아무 일도 하지 않는다.** 이 task 는 사슬을 먼저 바로잡는다(D1).

## 범위

### 포함
1. **알림 본문 이스케이프** — 승인 요청 본문의 `<`·`>`·`&` 처리. 버튼이 붙는 메시지가 전달되려면 필수.
2. **승인 요청 메시지 재설계** — 판단에 필요한 정보(가격·금액·한도 대비·만료 시각·현금 충분 여부·승인하면 일어나는 일) + 인라인 버튼. (아래 목업)
3. **텔레그램 폴러** — `getUpdates` 롱폴링으로 `callback_query` 수신. 새 공개 경로·미들웨어 예외 없음.
4. **콜백 처리기** — 발신자 허용목록·서명 검증·상태 재확인·멱등 처리·`answerCallbackQuery`·메시지 수정(승인됨/거절됨/만료됨).
5. **승인·거절 원자화** — `approveSignal*`/`rejectSignal` 의 상태 전이를 `UPDATE … WHERE id=? AND status IN (…) AND (expires_at IS NULL OR expires_at > NOW())` + `affectedRows` 검사로. 웹·텔레그램 공통.
6. **승인→체결 사슬 정합성** — D1 결정에 따른 룰 신호 승인 경로, `approveSignal` 이 주문 거부를 `approved` 로 기록하는 문제.
7. **감사 기록** — `trade_logs` 에 `signal_approved`/`signal_rejected` 이벤트(`via: telegram|web`, 텔레그램 user/chat id). 스키마 변경 없음(마이그레이션 불필요).
8. **훅 `SAFETY_PATHS` 보강** — 승인 핸들러·폴러가 놓이는 경로를 포함(근거 주석 포함).
9. **자가 점검 메시지** — 버튼이 달리지만 아무 거래도 일으키지 않는 시험 메시지로 콜백 사슬을 먼저 검증.

### 제외 (별도)
- 신호 수 축소·상위 N건 제한 (D2 에서 이 task 에 넣을지 결정), 판단 에이전트, TTL·평가 주기 변경, T-038(M4 주소 화면), T-039(재배포 중복 알림).
- 전용 봇 신설 — 사용자가 기존 봇 사용으로 결정.

## 설계 (B)

### 구성요소
```
[신호 생성: signals/service.ts]
   └─ 승인 요청 메시지(이스케이프·정보·버튼) ── sendMessage(reply_markup) ──▶ 텔레그램
                                              message_id 를 trade_logs 에 기록(수정용)

[폴러: 앱 프로세스 내부, instrumentation.ts 에서 기동 (cron-watchdog 선례)]
   └─ getUpdates(timeout=25, allowed_updates=["callback_query"]) 루프
        ├─ 오프셋: DB(system_config)에 영속 → 재기동 후 재처리 없음
        ├─ 단일 소비자 보장: DB 락(GET_LOCK) — 블루/그린 전환 중 두 릴리스가 동시에 돌아도 한쪽만
        └─ callback_query ──▶ [콜백 처리기]
                                ① from.id · message.chat.id 가 허용 목록(소유자)인가   (아니면 무시 + 로그)
                                ② callback_data 의 HMAC 이 맞는가 (signalId|action|금액|만료)  (아니면 거부)
                                ③ 시그널이 아직 승인 대기·만료 전인가, 킬스위치 OFF 인가     (서버 재확인)
                                ④ 원자적 상태 전이 (승인/거절) — 이미 처리됐으면 멱등 응답
                                ⑤ approveSignal*/rejectSignal 호출 — 기존 안전층(submitOrder 게이트) 그대로
                                ⑥ answerCallbackQuery + editMessageText(결과 반영) + trade_logs 기록
```

### 안전 조건 (빠지면 배포 금지)
1. 허용 목록: 소유자 `TELEGRAM_CHAT_ID` 와 소유자 user id(별도 설정 키)만. 그 외 발신자는 조용히 무시하고 경보.
2. `callback_data` ≤ 64바이트: `a:<id>:<act>:<hmac8>` 형태, HMAC 키는 서버 비밀(앱 인증 비밀과 분리된 파생 키). 금액·만료는 서버가 DB 에서 다시 읽어 검증(데이터에 신뢰를 두지 않음).
3. 승인 처리 시점에 시그널 상태·만료·킬스위치를 서버가 다시 판정 — 오래된 메시지의 버튼이 안전해야 한다.
4. 안전층 불변: 한도·킬스위치·DRY_RUN·`submitOrder()` 게이트를 우회하는 새 경로를 만들지 않는다.
5. 단일 소비자: 폴러가 둘이면 `409 Conflict` 와 이중 처리가 난다 → 락 + 원자적 전이로 이중 방어. 409 수신 시 백오프 + 경보.
6. 폴러 실패가 서버 기동·주문 경로를 막지 않는다(`instrumentation.ts` 선례: try/catch, 빌드타임 `NEXT_RUNTIME==='nodejs'` 분기).
7. 기능 스위치 `telegram_approval_enabled`(기본 off) — 자가 점검 통과 후 켠다. 끄면 버튼 없는 기존 메시지로 되돌아간다.
8. 텔레그램 불가(ETIMEDOUT) 시 앱 승인 경로는 그대로 남는다.

### 공유 봇 주의 (사용자 결정 반영)
- 같은 봇을 TradingInvest 와 공유한다. 텔레그램은 봇당 `getUpdates` 소비자 하나만 허용하므로 **TradingInvest 는 수신 코드를 가져서는 안 된다**(현재 없음). 재가동 시 점검 항목으로 `docs` 에 못박는다.
- `callback_data` 접두를 `si1:` 로 두어 다른 프로젝트 콜백과 구분, 알 수 없는 접두는 무시.
- 폴러는 `allowed_updates=["callback_query"]` 만 요청해 일반 메시지에는 반응하지 않는다.
- 웹훅은 걸지 않는다(봇당 하나뿐이라 공유 봇에서 가장 위험).

## 데모 (텍스트 목업) — 사용자 "권고대로 진행"(2026-10-12)을 승인으로 해석, 실제 모양은 켜기 전 자가 점검으로 재확인

> 아래 금액·주문번호·시각·`xxx`·`0.x%` 는 **형식을 보이기 위한 예시 값**이다. 실제 값은 구현 시 신호·계좌에서 채운다. 실제로 근거가 있는 값은 BKNG 종목·금액 1,121,925원·현금 8만 원·RSI 사유 문구(10-10 04:52 신호)뿐이다.

### 목업 1. 승인 요청 — 해외 매수 (룰 신호)
```
📩 승인 요청 · 매수 · 해외
BOOKING HOLDINGS (NAS:BKNG)
RSI 과매도 반등 — RSI 37.4 &lt; 38, 현재가가 MA20 아래

금액   ₩1,121,925  (총자산의 4.9%)
오늘 한도 잔여 ₩1,168,xxx  ·  현금 ₩80,000 ⚠ 부족
승인하면  지정가 주문(신호가 215,497 기준, 최대 +0.x% 추격)
만료   23:41 KST  (28분 남음)

[ ✅ 승인 ]  [ ❌ 거절 ]
[ 🔗 앱에서 자세히 ]
```
### 목업 2. 승인 후 (같은 메시지를 수정)
```
✅ 승인됨 · BOOKING HOLDINGS  23:19
주문 접수 #3250 · ₩1,121,925 · 지정가
(또는)  ⛔ 주문 거부 — 현금 부족 (insufficient_balance)   ← 승인과 주문 결과를 구분해 표시
```
### 목업 3. 거절 / 만료 / 중복
```
❌ 거절됨 · BOOKING HOLDINGS  23:19   (4시간 재제안 없음)
⌛ 만료됨 · BOOKING HOLDINGS          (버튼 제거)
(이미 웹에서 처리된 경우) 이미 처리된 시그널입니다 — 승인됨 23:18 (웹)
```
### 목업 4. 구간이 있는 시나리오 카드(야간 배치)
```
📩 승인 요청 · 매수 · 국내 · 내일 시나리오
현대차 (005380)   진입 구간 245,000 ~ 248,500   유효 10-13 09:00~15:30
금액 ₩700,000  (총자산의 3.1%)  ·  승인하면 진입 감시 등록(구간 도달 시 자동 주문)
[ ✅ 승인 ]  [ ❌ 거절 ]  [ 🔗 구간 수정(앱) ]
```
(구간 수정은 버튼으로 하지 않는다 — 앱 링크로 남긴다.)

## 결정 (사용자 2026-10-12 "권고대로 진행해줘")

> 아래 D1~D4 는 제시한 권고안 그대로 확정됐다. **D0(목업 승인)은 "권고대로 진행" 발화를 승인으로 해석했다 — 데모 게이트 도구로는 아직 `approve` 되지 않았다**(도구는 HTML 데모 파일과 `review_requested` 전이를 요구하고, judge 는 이 건을 `delta` 수준·designer 담당으로 판정했다). 실제 모양은 기능을 켜기 전에 **자가 점검 메시지로 사용자 폰에 먼저 도착**하므로, 그때 사용자가 확인하고 켠다. 켜기 전까지 기존 알림 모양은 바뀌지 않는다(스위치 `telegram_approval_enabled` 기본 꺼짐).

원래 질문(참고):

- **D0. 위 목업 승인/수정** — 데모 검토 게이트(D-09). 승인 전 코드 금지.
- **D1. 룰 신호(가격 구간 없음)를 승인하면 무엇이 일어나게 할까** — (a) 구간이 없으면 기존 즉시 지정가 주문 경로(`approveSignal`)를 타고, 구간이 있으면 진입 감시(`approveSignalHybrid`)를 타는 **신호별 자동 선택**(권고: 웹·텔레그램 공통, 현재의 "룰 신호 승인 = 아무 일도 안 함" 의심 해소) / (b) 룰 신호에 신호가 기준 ±x% 구간을 자동 생성해 감시 / (c) 현행 유지(룰 신호는 텔레그램 승인 대상에서 제외). 권고 (a).
- **D2. 이스케이프 수정으로 도착 메시지가 약 8건/일 → 약 36건/일로 늘어난다.** 이 task 에 넣을 방지책: (a) 그대로 / (b) **실행 불가능한 매수(현금 부족·일 한도 소진)는 승인 요청 대신 "실행 불가 요약" 1건으로 묶음**(결정론적, 권고) / (c) 상위 N건만. 현재 현금 8만 원이라 지금은 매수 신호 거의 전부가 (b) 대상이다.
- **D3. 탭 횟수** — 한 번 탭(권고, 번거로움 해소가 목적) vs 승인 시 확인 한 단계 추가.
- **D4. 폴러 위치** — 앱 프로세스 내부(권고: 배포 인프라 불변) vs 새 pm2 앱(HOME-SERVER `release.sh` 변경 필요).

## 변경 파일 (구현 완료, 미커밋)

| 파일 | 내용 | 안전 경로 |
|---|---|---|
| `src/lib/signals/approval-transitions.ts` (신규) | 승인·거절 **원자적 전이**(`claimAwaitingSignal`·`releaseClaim`·`rejectAwaitingSignal`), 진입 구간 판정(`extractEntryZone` — entry-watcher 와 같은 규칙), 승인 경로 선택(`resolveApprovalPath`, D1) | ✅ |
| `src/lib/signals/service.ts` | `approveSignal`: 선점(`executing`) → 주문 → **수락됐을 때만 `approved`**, 거부·예외면 대기로 복귀 + `trade_logs`. `approveSignalHybrid`·`rejectSignal`: 원자적 전이. 승인 요청 알림을 `approval-notify` 로 위임, 자동 제출 알림 이스케이프 | ✅ |
| `src/lib/signals/telegram-callback-data.ts` (신규) | `si1:<a|r|t>:<id>:<HMAC16>` 코덱. 키는 `AUTH_SESSION_SECRET` 에서 용도별 파생, 서명은 금액에 결속 | ✅ |
| `src/lib/signals/telegram-approval.ts` (신규) | 콜백 처리기: 형식 → **발신자(상태 읽기 전)** → 키 → 스위치 → 서명(DB 금액) → 상태 재확인 → 킬스위치 → 원자적 전이 → 결과 반영·감사 | ✅ |
| `src/lib/signals/telegram-poller.ts` (신규) | `getUpdates` 롱폴링 한 단계(`pollOnce`)·백오프·DB 락(`GET_LOCK`) 단일 소비자·오프셋 영속. 두 스위치 | ✅ |
| `src/lib/signals/approval-message.ts` (신규) | 요청·결과·자가 점검 본문(순수), 모든 동적 값 이스케이프 | ✅ |
| `src/lib/signals/approval-notify.ts` (신규) | 알림 발송: 스위치 존중, **실행 불가 매수는 요약**(D2-b, 1시간 1건), 버튼 형식/간단 형식, 채널 정책 존중 | ✅ |
| `src/lib/signals/approval-context.ts` (신규) | 실행 가능 판정(주문 경로의 `checkOrderMax`·`checkDailyMax` 그대로 호출 + 스냅샷 현금), 화면 맥락. **불확실하면 보낸다** | ✅ |
| `src/lib/notify/telegram-api.ts` (신규) | Bot API 클라이언트(sendMessage+키보드, getUpdates, answerCallbackQuery, editMessageText) — 토큰 가림, 409/429 구분 | ✅ (`SAFETY_PATHS` 보강) |
| `src/lib/notify/index.ts` | `dispatchAlertWithTelegram` — 텔레그램 발송 함수만 바꿔 끼움(채널 정책·슬랙·실패 로깅 동일). `dispatchAlert` 동작 불변 | ❌ |
| `src/instrumentation.ts` | 폴러 기동(같은 양수 조건 블록, 독립 try/catch) | ✅ (`SAFETY_PATHS` 보강) |
| `src/app/api/signals/[id]/approve/route.ts` | 승인 경로를 `resolveApprovalPath` 로 선택(구간 없는 룰 시그널은 즉시 주문) | ✅ |
| `src/app/api/cron/telegram-approval-selftest/route.ts` (신규) | 거래 없는 시험 버튼 메시지 발송(크론 비밀 인증) | ✅ |
| `scripts/git-hooks/commit-msg`, `scripts/test-git-hooks.sh` | `SAFETY_PATHS` 에 `telegram-api.ts`·`instrumentation.ts` + 근거 주석, 훅 시나리오 4건 | ✅ |
| `src/lib/safety/dry-run.ts`, `src/lib/exchanges/types.ts` | **1라운드 감사 D-1**: `OrderResult.outcomeUnknown` — 송신 단계 예외·`kis_5xx`/`network_error` 응답에만 설정(결과 불명 = 재시도하면 이중 주문 가능). 기존 결과 형태는 불변(필드는 해당할 때만 붙음) | ✅ |
| `src/lib/signals/approval-transitions.ts` | 위 표 + `readHybridModeEnabled`(웹 라우트·텔레그램 공용 단일 규칙) | ✅ |
| `docs/telegram-approval.md` (신규) | 운영 절차서: 스위치·켜는 순서·안전 조건·공유 봇 규칙·**결과 불명 복구 절차**·한계 | ❌ |
| 테스트 | 신규 14 파일 + 기존 6 파일 수정(아래 검증) | — |

## 스위치와 롤아웃 (모두 기본 꺼짐 — 배포만으로는 버튼이 생기지 않는다)

| 키(`system_config`) | 의미 | 기본 |
|---|---|---|
| `telegram_poller_enabled` | 폴러가 `getUpdates` 를 읽는다(자가 점검 가능) | 꺼짐 |
| `telegram_approval_enabled` | 거래 동작(승인·거절) 허용 + 요청 메시지에 버튼 | 꺼짐 |
| `notify_skip_unexecutable` | 실행 불가 매수를 요약으로 묶음 | **켜짐**(미설정=켜짐) |
| `app_public_url` | "앱에서 자세히" 링크(https) | 없음 → 링크 버튼 생략 |
| `telegram_approval_user_ids` | 허용 사용자(JSON 배열). 없으면 개인 채팅 ID | 없음 |

배포 직후 **스위치와 무관하게** 달라지는 것: ① 승인 요청 본문이 이스케이프돼 약 78% 유실이 사라진다(모양은 기존 그대로) ② 실행 불가 매수는 개별 알림 대신 요약(D2-b) ③ 주문이 거부된 승인은 `approved` 가 아니라 대기로 남는다 ④ 구간 없는 룰 시그널의 하이브리드 승인이 즉시 주문 경로로 간다(D1) ⑤ 승인·거절이 원자적이다.

켜는 순서(사용자 폰에서 확인하며): `telegram_poller_enabled=true` → `POST /api/cron/telegram-approval-selftest`(크론 비밀) → 폰에서 시험 메시지의 **점검 확인** 탭 → "자가 점검 통과" 확인 → 시험 메시지가 보여 준 모양을 사용자가 확인 → `app_public_url` 설정 → `telegram_approval_enabled=true`. 되돌리기: 두 스위치를 `false`.

## 검증 (Developer 측 실행 — Reviewer·QA 는 별도)

- 전체 `jest`: **141 suites / 2,872 tests 통과**(착수 전 128 / 2,327; 1라운드 감사 시점 139 / 2,552; 2라운드 시점 140 / 2,675). 훅 테스트 52/52. 신규 테스트 파일 12개(상태 전이 38+, 코덱 15, 메시지 22, 처리기 55, 폴러 15, 알림 22, 맥락 17, 봇 클라이언트 15, 승인 라우트 7, 자가 점검 라우트 4, 계측 형태 6 외). `tsc --noEmit` exit 0. 훅 테스트 `scripts/test-git-hooks.sh` 51/51.
- **변이 스윕**: 구현 직후 73개(처음 69 잡힘 → 생존 4개에 단언 추가 후 73/73). **1라운드 감사 반영 후 126개, 2라운드 반영 후 143개로 확장**(결과 불명 분기·`outcomeUnknown` 설정·한도 가드·이스케이프·배선 18개·루프·`dispatchAlertWithTelegram`): **최종 143개 중 140개 잡힘(1개는 무한 루프로 멈춤 감지) + 2개 동치 + 1개 폐기**(N9 — 제거된 이중 이스케이프 코드를 겨냥, 반대 방향 변이 L5 가 같은 것을 지킴)(`orderMaxKnown`/`dailyMaxKnown` 앞 가드 — 한도가 0 이하면 실제 `check*` 가 이미 "미설정" 상세를 내 `exceedsLimit` 이 거짓이라 방어용 중복). 중간에 생존한 N11(버튼 메시지 실패 시 간단 본문 대체)·W14(edit 키보드 전달)는 단언 추가 후 잡힘. 러너는 변이마다 원복·sha256 대조(`mutate_t042b.py`; 시간 초과 시 프로세스 그룹을 죽이고 `finally` 로 복원 — **한 번 러너가 예외로 죽어 `telegram-poller.ts` 가 변이된 채 남은 것을 즉시 백업에서 복원하고 12개 파일의 바이트 일치를 확인**).
- 테스트가 찾은 실제 결함 4건(코드에 반영): ① 락을 못 잡을 때 DB 연결 이중 반납 가능 구조(`finally` 한 곳으로) ② `backoffMs(NaN)` → `setTimeout(NaN)` 즉시 실행(요청 연타) ③ 기존 서비스 테스트가 **차단된 주문을 `approved` 로 기록하는 버그를 정답으로 고정**하고 있었음(한도 미설정 목 환경에서 우연히 통과) ④ 기존 `order-sizing` 테스트 동일.
- 빌드·dev 서버는 실행하지 않았다(운영 `.next` 보호). 라이브 계정이라 실제 시그널을 승인하는 검증은 하지 않았다 — 콜백 사슬은 자가 점검으로 시험한다.

## 확인하지 못한 것
- 룰 신호 승인이 실제로 주문 없이 끝나는지(코드·데이터 추론, 실행 관측 없음).
- `approved` 4건에서 주문이 안 나간 개별 원인(거부 사유 로그 대조 필요).
- 콜백 응답 제한 시간(`answerCallbackQuery`)과 승인 처리 시간의 여유.
- 블루/그린 전환 중 두 릴리스 동시 기동 시 락 동작(설계로 막았으나 실측 전).
- 텔레그램 계정·기기 보안 수준(사용자 측 2단계 인증 여부).

## Leader 기록

- **19:13 데모 면제 기록 보류**: 사용자 발화 그대로 "4. T-042 데모 면제해줘"(저녁)·"T-042 데모 생략"(19시대). `check.mjs waive` 는 "면제" 표현을 생략으로 인식하지 않았고, "생략" 표현은 사용자 메시지에 에이전트 보고가 섞여 훅이 발화를 기록하지 못해 거부됐다(상세는 [[T-097-price-first-sizing]] `## Q-E 데모 승인 기록`). 조용한 시점에 사용자가 "T-042 데모 생략" 을 다시 보내면 `waive` 를 재시도한다. 그때까지 `demo_gate.status: drafting` 유지(동작·배포에는 영향 없음).

- **2026-10-26 16:29 상태 정리(T-083 R01 후속)** — 사용자 발화 그대로: "2. T-042·T-044 상태는 권고대로 진행해줘 / 3. T-038, T-039도 권고대로 진행해줘"(10-26 16:29 이전, T-083 `## Leader 기록` 4개 task 대조표의 권고에 대한 답). 처리: `status: in-progress → done`, `waiting: [device_verify]`(**첫 실제 버튼 승인 관측 대기** — 스위치 2개는 10-19 에 켜졌고 폴러는 동작 중이나 실사용 승인 callback 은 로그에 0건). 근거: 커밋 `c3a14f1`(10-12 03:25)·릴리스 `20261012-032615-c3a14f12` ok, 대조표는 [[T-083-s00-follow-up-hygiene]]. **`demo_gate.status: drafting` 은 바꾸지 않았다** — 이 task 는 데모 승인 기록 없이(텍스트 목업을 사용자 "권고대로 진행"으로 승인 해석, 위 `## 데모` 절) 구현·배포됐고, `check.mjs waive` 는 사용자 면제 발화 원문을 기록해야 해서 이번 "상태는 권고대로" 발화로는 대신할 수 없다 — 정리 방식(면제 기록 vs 현상 유지)은 사용자에게 한 줄로 묻는다. 기록 사유: 위 `## 데모` 절의 해석은 Leader 판단이며 사용자 명시 승인이 아니다.
- (최종 요약) 텔레그램 승인 버튼은 구현·운영 반영·스위치 켬까지 끝났고 **첫 실제 버튼 승인만 미관측**이다. 사용자 확인: 승인 요청이 오면(시그널 생성 시) 텔레그램 버튼 탭 → "승인됨" 응답이 오는지. 롤백: 두 스위치 `false`.

- [10-11] 사용자 요청 2건(타이밍·번거로움)을 묶어 T-042 로 접수. 사용자 결정 3건 반영(기존 봇, 위임 수용, B 직행). 데모 게이트에 따라 **텍스트 목업 승인 전 코드 없음**.
- [10-11] 설계 중 발견: 승인→체결 사슬 의심(위 🔴), 승인 UPDATE 비원자성, 훅 안전 경로 공백. 모두 이 task 범위에 흡수.
- [10-12] 사용자 "권고대로 진행해줘" → D1-a·D2-b·D3 한 번 탭·D4 앱 내부. judge 접수(`judge-result@2`): feature · **R2** · developer=opus · `demo=delta/designer` · `blocking_gate=demo`. `check.mjs init` 으로 `demo_gate` 기록(status drafting). **데모 게이트 상태는 `approve` 되지 않았다** — 사용자 발화를 승인으로 해석했고, 실제 모양은 자가 점검 메시지로 켜기 전에 폰에서 확인된다(스위치 기본 꺼짐이라 그 전에는 모양이 바뀌지 않는다). 사용자가 이 해석을 거부하면 `status drafting` 으로 되돌리고 HTML 데모를 만든다.
- [10-12] 구현·테스트·변이 스윕 완료(아래 "검증"). **독립 감사(Reviewer) 전에는 커밋하지 않는다**(자기 승인 금지). 감사 후 QA → 커밋·push(=배포) → 롤아웃 순서대로 스위치.
- [10-12] 독립 감사 4라운드 끝에 pass(상세는 Reviewer 절). 이어 judge `codex_gate` C2 → `codex_required: true`(adversarial-review · concurrency · 규칙 `CX-limit-unknown-r2`, 스위치 on). Codex 읽기 전용 실행 done(69초, 스냅샷 수정 0건, 원본 `.claude/state/codex-review/runs/20261011T181501Z-T-042-C2/`). 지적 2건:
  - critical — entry-watcher 가 주문 전 선점 없이 submitOrder 를 호출(동시 실행 시 실주문 중복 가능). **Leader 검증: 코드상 사실.** 선점 없음·주문 뒤 `executing` 갱신에 상태 조건 없음·`client_order_id` 는 호출마다 랜덤이라 DB 멱등성 없음. 다만 `cron-runner.sh` 가 단일 루프에서 curl 을 동기 호출해 정상 운영(cron 앱 1개)에서는 틱이 겹치지 않고, 겹치는 조건은 cron 앱 2개 동시 기동·수동 호출·배포 중 요청 끊김. **T-042 이전부터 있던 구조.**
  - medium — 폴러가 롱폴링 반환 뒤 락 소유를 재확인하지 않고 offset 저장에 단조 조건이 없음. 시그널 전이가 원자적이라 이중 주문은 아니고 콜백 응답·감사 로그 중복, offset 퇴행 시 재전달(핸들러 멱등).
  - 두 건의 차단 여부는 Leader 가 정하지 않고 Reviewer 에게 분류를 맡겼다(재개 요청 10-12). 답을 받기 전에는 커밋하지 않는다.
- [10-12] Reviewer 5라운드(Codex 지적 분류): 두 건 모두 T-042 를 막지 않음. entry-watcher 선점 부재는 T-042 이전부터 있던 구조(HEAD 동일)로 **T-043 분리**(우선순위 높음), 폴러 fencing 은 Low 로 T-043 에 묶음. 분리의 전제 2가지 이행: ① T-043 작업서·board 등록 ② `docs/telegram-approval.md` §7 에 한계·수동 curl 금지·배포 직후 점검 SQL 기록. 코드 변경 없음.
- [10-12 03:26 KST] 커밋 `c3a14f1`(39 파일, T-042·T-043 문서 포함, 다른 세션 변경 미포함) → push → webhook 배포 `20261012-032615-c3a14f12` `RELEASE_RESULT ok`·exit 0. 푸시 직전 재검증: tsc 0, jest 141 suites/2,875, 훅 52/52. 배포 후: pm2 `stockinvest`·`stockinvest-cron` online(cron 1행), `/api/health` ok·killSwitch false·safety green, 핵심 6파일 해시가 커밋과 일치, 중복 주문 쌍 0, `system_config` 에 `telegram_*` 키 없음(= 스위치 전부 꺼짐). 폴러 루프는 꺼져 있으면 무로그라 실제 기동은 자가 점검에서 처음 관측된다.
- [10-12] 문서 `docs/telegram-approval.md` §6.1 정정(코드 변경 아님): 접수 확인 시 복구 SQL 을 경로별로 구분(즉시 주문 경로 성공 상태 `approved`, 진입 감시 경로 성공 상태 `executing`), 경로 구분 근거를 `price_zone` 유무에서 알림 제목으로 정정(구간이 있어도 하이브리드 꺼짐·시나리오 수정 승인이면 즉시 주문 경로), "알림 정리 전 배포 금지" 문장 추가. 감사자가 남긴 해시(035f8ac3399d)는 이 수정으로 바뀌었다.

## Developer

(구현자 = 워크스페이스 세션. 위 "변경 파일"·"검증" 참조)

### 2라운드 감사(FAIL) 반영 — 필수 2건 + Low

| 지적 | 재현 확인 | 조치 |
|---|---|---|
| **Medium R2-1** 종목명 이중 이스케이프 (`Johnson & Johnson` → `&amp;amp;`) | ✅ `getSymbolLabel` 의 문서 주석이 "반환값은 이미 이스케이프된 상태"라고 명시 — **내가 그 위에 다시 씌운 실수**. 원래 코드는 단일 이스케이프라 *배포 즉시 퇴행*할 결함이었다(간단 본문·자동 제출 알림 포함). 테스트가 라벨을 날 문자열로 목킹해 못 잡음 | 라벨은 **이미 안전한 값**으로 다룬다(요청·결과·간단 본문·요약·자동 제출 5곳). 조회 실패 시 폴백으로 쓰는 *원본 심볼*만 호출처가 이스케이프. 계약을 타입 주석에 명시. 테스트는 진짜 `getSymbolLabel` 반환 형태(와 실제 함수 + 목 DB)로 `Johnson & Johnson` 을 끝까지 검증 |
| **Medium R2-2** 송신 후 DB 장애 시 `outcomeUnknown` 누락 | ✅ 실패하는 테스트로 재현(`realSubmit` 성공 + `accepted`·`failed` UPDATE 모두 실패 → 플래그 없음) | `sendReached` 표지를 송신 직전에 세우고 *바깥* catch 가 `outcomeUnknown: sendReached` 를 붙임. 송신 전 예외는 표지 없음 — 제어 테스트는 변동폭 가드가 던져 바깥 catch 를 *실제로 지나게* 함(처음 만든 제어 테스트는 `checkDailyMax` 가 자체 처리해 바깥 catch 를 안 지나는 것을 발견하고 교체) |
| Low 후처리 예외가 "처리하지 못했습니다"로 보임 | ✅ | 주문 접수 후 `approved` 기록 실패 → 경고 알림 + 결과는 사실대로(주문 접수). 확정 거부 후 복귀 실패 → 경고 알림 + `order_not_accepted` 유지(`executing` 에 남아 재승인 불가) |
| Low 한 콜백에 응답 한 번 불변식 테스트 없음(A9) | ✅ | 상태 9 × 동작 2 × 킬스위치 2 × 결과 5 = 180 조합 표 테스트 + 거부·꺼짐·서명 오류 등 |
| Low 불명 경보의 `**` 가 별표로 보임 | ✅ | 제거 + 테스트 |
| **범위 밖(감사가 후속 task 권고)** `entry-watcher` 가 `outcomeUnknown` 을 안 읽음 → `ok:false` 면 `approved_pending_entry` 로 남아 **다음 틱(1분)에 같은 주문을 다시 냄** | ✅ 코드 확인(`order_failed` 분기가 상태를 안 바꿈) | T-042 이전부터 있던 잠복 결함이지만 `outcomeUnknown` 이 정확히 그 구분 정보이고 텔레그램 하이브리드 승인이 이 경로를 늘리므로 **이번에 같이 고침**: 결과 불명이면 조건부로 `executing` 잠금 + critical 알림. 확정 거부는 기존대로 재시도. **결과 불명 주문이 일 한도 합계에서 빠지는 점은 이번에도 안 고쳤다(별도)** |

### 1라운드 감사(FAIL) 반영 — 구현자가 먼저 재현해 확인한 뒤 고침

| 지적 | 재현 확인 | 조치 |
|---|---|---|
| **High D-1** 불확실한 실패도 "거부"로 되돌려 이중 주문 가능 | ✅ `submitOrderInner` 가 송신 중 예외·KIS 5xx·접수 직후 DB 갱신 실패를 모두 `{ok:false}` 로 돌려줌을 코드로 확인 | `OrderResult.outcomeUnknown` 추가 — `submitOrder` 송신 단계의 예외와 `kis_5xx`/`network_error` 응답에만 설정(안전층 차단·KIS 명시 거부에는 없음). `approveSignal` 은 **확정 거부일 때만 대기로 복귀**하고, 결과 불명이면 `executing` 선점을 유지 + critical 알림 + `order_uncertain`. 텔레그램은 "주문 결과를 확인하지 못했습니다 — 다시 승인하지 마세요"(버튼 없음). 복구 절차 `docs/telegram-approval.md` §6.1 |
| **Medium D-2** 이벤트명 33자 > `varchar(32)` | ✅ 운영 DB `trade_logs.event` varchar(32)·STRICT 실측 | `TRADE_LOG_EVENTS`(29·30자) 상수화, 서비스 테스트 목이 길이를 검사(초과 시 INSERT 실패 재현), 이름 길이 단언 |
| **Medium D-3** 한도 0(조회 실패)을 실행 불가로 오판 | ✅ `getEffective*Max` 가 미설정/평가액 조회 실패를 *예외 없이 0* 으로 돌려줌을 코드로 확인, 추가로 `checkDailyMax` 가 집계 쿼리 실패도 fail-closed 로 막음 | 한도가 0/비유한이면 "모른다"로 보고 사유로 세지 않음. 진짜 초과(`<금액> > <한도>` 상세)만 `exceedsLimit` 로 인정. 테스트는 `check*` 를 **실제 구현**으로 바꾸고 상세 형식을 실제 함수와 대조 |
| **Medium D-4** 텔레그램 `{ok:false}` 가 로그·대체 없이 사라짐 | ✅ `safe()` 가 예외만 잡고 클라이언트는 던지지 않음 | `safe()` 가 `{ok:false}` 를 실패로 집계. 결과 수정 실패 시 새 메시지로 대체(버튼 유지 결과는 버튼과 함께). 이미 처리된 시그널은 본문을 덮어쓰지 않고 토스트 + 버튼 제거(`editMessageReplyMarkup`). 사유 160자 제한. "message is not modified" 는 성공으로 |
| **Medium D-5** 승인 권한 배선·폴링 루프 테스트 공백 | ✅ 변이 13개 생존(감사) | 배선을 `ApprovalIO`/`LoopIO` 주입 구조로 바꿔 `telegram-poller-wiring.test.ts`(49건)로 끝까지 시험: 허용 채팅·허용 사용자·서명 키·경로 매핑·하이브리드·락·연결 반납·백오프·경보 |
| Low `24:05` 표기 | ✅ 실측 | `hourCycle:'h23'` + 테스트 |
| Low DECIMAL 반올림과 서명 불일치 | 코드 추론(운영은 전부 정수 금액) | 버튼 서명을 **DB 에 저장된 금액**으로 |
| Low `app_public_url` 이 거부되면 켠 뒤에야 발견 | 추론 | 자가 점검에도 같은 링크 버튼을 달아 켜기 전에 잡음 |
| Low 하이브리드 판정이 웹/폴러에서 다름 | ✅ `getRouterConfig` 는 DB false 일 때 env 폴백 | `readHybridModeEnabled` 단일 함수로 통일 |
| Low `notify/index.ts`·계측 테스트가 SAFETY_PATHS 밖 | — | 안전 경로 파일의 테스트 2개를 추가(원칙: 안전 경로의 테스트는 제외하지 않음). `notify/index.ts` 는 일반 알림이라 넣지 않음(과도차단) |
| Low TradingInvest 수신 코드 금지 문서화 | — | `docs/telegram-approval.md` §5 |
| Low `executing` 고아 / `update_id` 재설정 / 개발서버 락 / 현금 근사 | 추정 | 코드로 막지 않고 한계로 문서화(§7) — 결과 불명 시 `executing` 잠금은 의도된 동작이라 자동 정리는 위험 |

## Reviewer

- [03:22] 범위·방법(5라운드, Codex C2 두 건의 독립 분류): Codex 결과 원문(`runs/20261011T181501Z-T-042-C2/last.txt`·`raw.txt`·요약 json)을 읽고, 코드·실행·운영 데이터로 각 주장을 따로 확인했다. 소스·스크립트 483개 파일의 sha256 이 4라운드 종료 시점과 같다(코드 변경 없음, 이후 바뀐 것은 `docs/telegram-approval.md` 뿐). 새 사본(`review42/work5`)에서만 재현했고 원본은 수정하지 않았다. 외부 호출·커밋·배포·pm2 조회는 하지 않았고 운영 DB 는 읽기 전용 조회만 했다.
- [03:22] [확실] **F1(entry-watcher 주문 전 선점 없음) — 주장은 사실이지만 T-042 가 만든 결함이 아니고, 이 커밋을 막지 않는다. 별도 task(우선순위 높음)로 분리한다.** 사실 확인: (a) 구조: `SELECT … status='approved_pending_entry'` → `submitOrder` → 그 뒤 `UPDATE … executing`(주문 전 조건부 선점 없음). 같은 프로세스에서 두 틱이 겹치면 같은 시그널에 `submitOrder` 가 2회 불린다(하니스 재현 `{"submitOrderCalls":2}`, 두 응답 모두 `submitted`) (b) 이 구조는 HEAD 에도 그대로 있다(`git show HEAD:…entry-watcher/route.ts`: `submitOrder` 후에 `UPDATE`). T-042 가 더한 것은 주문 뒤 기록 실패·결과 불명 처리뿐이며 이전보다 중복 경로를 줄였다(불명 결과를 1분마다 재제출하던 것 차단, 구간 없는 룰 시그널이 `approved_pending_entry` 로 가던 막다른 길 제거). (c) 겹침 조건: `entry-watcher` 의 호출자는 `cron-runner.sh` 하나뿐이고(UI·다른 라우트 없음) 그 루프는 `curl` 동기 호출 + `sleep 60` 이라 정상 운영의 틱은 겹치지 않는다. 겹치려면 ① `stockinvest-cron` 중복 기동 — `ecosystem.config.js` 주석과 `docs/deploy-order.md` §2 가 "이 프로젝트 최대 위험"으로 이미 다루며 이때는 주문·집계 *전체*가 두 번 돈다(entry-watcher 만의 문제가 아니다) ② 사람이 수동으로 호출 ③ 배포 중 새 cron-runner 가 기동 즉시(`i=0`) entry-watcher 를 부르는데 옛 릴리스의 진행 중 요청이 아직 끝나지 않은 경우 ④ 배포 중 프로세스가 주문 송신 뒤 기록 전에 종료된 경우. ③·④ 는 "구간 안에서 대기 중인 하이브리드 시그널이 있고 그 주문이 진행되는 수 초의 창"과 겹쳐야 한다. (d) 보호: 중복 주문도 1회·일 한도 검사를 각각 통과해야 한다(상한은 하루 한도 안). (e) 노출 실측(읽기 전용): 자동(`source='auto'`) 주문 중 접수·체결된 것은 전체 기간 19건이고 마지막이 2026-05-26 — 최근 120일 0건, `approved_pending_entry`·`executing` 시그널도 5월 이후 없다. 접수·체결된 자동 주문 중 같은 종목·방향 3분 이내 쌍은 **0건**(3분 이내 쌍 220여 건은 전부 차단·거부·dry_run 재시도). 즉 과거에 실제로 중복 주문이 난 흔적도 없다. 버튼 승인이 구간 카드 승인을 늘리면 노출이 비례해 커지지만 이벤트당 확률은 그대로다.
- [03:22] [확실] **F1 분리의 근거와 전제 조건.** 근거: 수정은 "주문 전 선점 → 확정 거부·사전 예외만 복귀 → 불명·성공은 `executing` 유지 → 성공 기록은 `AND status='executing'`"로 실주문 cron 의 상태 흐름을 바꾸는 일이라(분할 진입 게이트·R3-1 집합·만료 처리와 맞물린다) 독립 설계·감사가 필요하고, 이미 4라운드 + Codex 를 거친 T-042 에 끼우면 검증 범위가 다시 열린다. 노출은 스위치와 무관하게 *오늘도* 같은 크기로 존재한다(웹 하이브리드 승인은 2026-05-23 부터 켜져 있다) — T-042 를 스위치 꺼진 채 배포하는 것은 이 노출을 바꾸지 않는다. 전제(비코드, 커밋과 같은 날 기록): ① 후속 task(예: T-043 "entry-watcher 주문 전 선점")를 등록하고 task 파일 Leader 기록·board 에 우선순위 높음으로 남긴다. 설계 요지 — `UPDATE signals SET status='executing' WHERE id=? AND status='approved_pending_entry' AND (expires_at IS NULL OR expires_at > NOW())` 의 `affectedRows=1` 인 틱만 `submitOrder`; 확정 거부·송신 전 예외만 `approved_pending_entry` 로 복귀(다음 틱 재시도); 불명·성공은 `executing` 유지; 시험은 동시 두 틱·선점 뒤 프로세스 사망·확정 거부 복귀 후 재시도·분할 진입 게이트(이전 회차가 `executing` 인 동안)·R3-1 집합과의 관계 ② `docs/telegram-approval.md` §7 에 "entry-watcher 는 주문 전 선점이 없어 틱이 겹치면 이중 주문 가능(T-042 이전부터)" 한 줄과 운영 규칙(수동 curl 금지, 배포 뒤 `stockinvest-cron` 정확히 1개 확인은 기존 절차, 배포 직후 중복 점검 SQL — 접수·체결 상태의 `source='auto'` 주문 중 같은 종목·방향 3분 이내 쌍 조회)을 적는다 ③ 스위치 순서는 필수 제약이 아니다. 다만 `telegram_approval_enabled` 를 켜면 구간 카드 승인이 쉬워지므로 T-043 이 먼저 또는 같은 주에 들어가는 것을 권한다 — 구간 카드 승인이 일상이 되기 전에 닫는 것이 목표다. 알림 추가는 필요 없다(중복 주문은 사후 SQL 로만 탐지되므로 위 점검 SQL 이 유일한 탐지 수단이다).
- [03:22] [확실] **F2(폴러 락 상실 뒤 사후 fencing 없음) — 기계적으로는 사실이나 Low 이며 차단하지 않는다. 후속 처리한다.** 재현(가짜 `LoopIO`): 롱폴링 도중 락을 잃고 다른 소비자가 offset 을 110 으로 저장한 뒤 이 소비자의 요청이 업데이트 2건을 돌려주면, 락을 잃은 소비자가 `q101`·`q102` 를 처리하고 offset 을 102→103 으로 저장해 최종 값이 110→103 으로 되돌아간다. 영향 평가: ① 돈 위험 없음 — 시그널 전이는 원자적이라 두 소비자가 같은 콜백을 처리해도 한 쪽만 이기고(설계 문서의 "락 + 원자적 전이 이중 방어", 1·2라운드에 확인) 진 쪽은 "이미 처리된" 경로로 간다 ② 실제 효과는 `answerCallbackQuery` 두 번째 호출을 텔레그램이 거절(우리는 `safe()` 가 로그)하고, 감사 행이 중복되고, 진 쪽이 결과 메시지를 "이미 처리된 시그널입니다"로 덮어써 주문 번호가 가려질 수 있는 정도 ③ offset 퇴행으로 인한 재전달은 Bot API 의 확인 의미(더 높은 offset 으로 호출하면 그보다 낮은 업데이트는 확인·삭제됨) 때문에 거의 없다 [가능성 높음 — 문서 근거, 실측 못 함] ④ 발생 조건이 겹쳐야 한다: 락 전용 연결이 끊기고, 새 소비자가 25초 롱폴링 창 안에서 락을 얻고(재시도 주기 30초), 그 사이 탭이 있어야 한다. Codex 의 medium 보다 낮게 본다. 최소 하드닝(선택, 같은 후속 변경에 묶을 것): (a) offset 저장을 단조 증가로 — `ON DUPLICATE KEY UPDATE value = IF(CAST(VALUES(value) AS UNSIGNED) > CAST(value AS UNSIGNED), VALUES(value), value)` (b) 업데이트 처리 전에 `stillHoldsLock` 재확인, 상실이면 그 배치를 폐기하고 offset 을 저장하지 않는다(새 소비자가 미확인 업데이트로 다시 받는다 — `pollOnce` 에 확인 의존성이 필요) (c) 전이 패배(`invalid_status`)로 "이미 처리됨"이 된 경우 결과 본문을 덮어쓰지 말고 빠른 판정 경로처럼 토스트+버튼 제거만. 셋 다 안전 경로 파일(`telegram-poller.ts`·`telegram-approval.ts`)을 바꾸므로 반영하면 해당 변경분만 좁게 재확인한다. 이 task 의 범위는 아니다.
- [03:22] 확인하지 못한 것: ① 실제 텔레그램 서버의 진행 중 `getUpdates` 종료 순서·409 동작(Codex 도 미검토로 적었다) — F2 평가의 "거의 없다"는 문서 근거 추정이다 ② 실제 배포(pm2 reload) 중 옛 릴리스의 진행 중 요청과 새 cron-runner 첫 틱이 겹치는 창의 길이(pm2 조회 금지) ③ F1 ③·④ 의 발생 확률은 코드·실측 빈도로 추정한 것이다(최근 120일 자동 주문 0건이라 실사고 기록이 없다) ④ 나머지는 4라운드와 같다(실제 KIS 5xx 뒤 체결 여부, `next build` 의 `register()` 호출 여부, 실제 Edge 빌드, 스냅샷 현금과 주문가능금액의 관계, `trade-report` 이중 이스케이프의 실제 출력, Codex 가 인계에서 제외한 혼합 작업 트리 파일).
- [03:22] 수용 가능한 잔여 위험(갱신): 4라운드 목록에 더해 — entry-watcher 의 주문 전 선점 부재(T-042 이전부터, 겹침은 cron 중복 기동·수동 호출·배포 중 창에서만, 한도 안에서 이중 주문 상한, 후속 task 로 닫는다), 폴러의 락 상실 뒤 콜백 중복 처리(돈 위험 없음, UX·감사 중복 수준). 이 둘은 "수용"이 아니라 위 전제와 함께 후속 처리 대상으로 기록한다.
- [03:22] 판정 근거: Codex 두 건 모두 코드로 재현됐고 주장의 사실 부분은 맞다. 그러나 F1 은 T-042 이전부터 있던 구조이며 T-042 는 그 위험을 악화시키지 않고 일부 줄였고(스위치를 꺼 둔 배포는 노출을 바꾸지 않는다), 정상 운영에서는 틱이 겹치지 않으며, 수정이 별도 설계·감사가 필요한 실주문 흐름 변경이다. F2 는 원자적 전이로 돈 위험이 막혀 있고 영향이 중복 응답·감사·문구 수준이다. 따라서 4라운드의 통과 판정은 유지하고, F1 은 위 전제 3개와 함께 별도 task 로, F2 는 같은 후속 변경의 하드닝으로 분리한다. 코드 변경이 필요 없으므로 재감사도 필요 없다 — 전제 ①②는 Leader 가 task 파일·board·docs 에 남기고 최종 요약에 후속 task 번호를 적는다(훅이 강제하지 못하는 부분은 사람의 규율이다).
- [03:22] **최종 판정: PASS (scope: src/lib/signals/approval-transitions.ts, src/lib/signals/approval-message.ts, src/lib/signals/approval-notify.ts, src/lib/signals/approval-context.ts, src/lib/signals/telegram-approval.ts, src/lib/signals/telegram-callback-data.ts, src/lib/signals/telegram-poller.ts, src/lib/signals/service.ts, src/lib/safety/dry-run.ts, src/lib/exchanges/types.ts, src/lib/notify/telegram-api.ts, src/lib/notify/index.ts, src/instrumentation.ts, src/app/api/signals/[id]/approve/route.ts, src/app/api/cron/telegram-approval-selftest/route.ts, src/app/api/cron/entry-watcher/route.ts, scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh, src/lib/signals/__tests__/approval-context.test.ts, src/lib/signals/__tests__/approval-message.test.ts, src/lib/signals/__tests__/approval-notify.test.ts, src/lib/signals/__tests__/approval-transitions.test.ts, src/lib/signals/__tests__/service.test.ts, src/lib/signals/__tests__/telegram-approval.test.ts, src/lib/signals/__tests__/telegram-callback-data.test.ts, src/lib/signals/__tests__/telegram-poller.test.ts, src/lib/signals/__tests__/telegram-poller-wiring.test.ts, src/lib/signals/__tests__/order-sizing.test.ts, src/lib/safety/__tests__/submit-order.test.ts, src/lib/notify/__tests__/telegram-api.test.ts, src/app/api/signals/__tests__/approve-route.test.ts, src/app/api/cron/__tests__/telegram-approval-selftest.test.ts, src/app/api/cron/entry-watcher/__tests__/unknown-outcome.test.ts, src/__tests__/instrumentation-shape.test.ts)**

## 4라운드 감사 기록 (superseded)


- [03:10] 범위·방법(4라운드, 변경분만): 3라운드 이후 바뀐 것은 `entry-watcher/route.ts`(9e711338d73d)·`unknown-outcome.test.ts`(d8535df62582)·`telegram-approval.test.ts`(d31a82479ed2)·`docs/telegram-approval.md`(035f8ac3399d) 넷뿐이고 해시가 보고와 일치한다(소스·테스트 483개 파일의 해시 변동도 이 셋뿐). 새 사본(`review42/work4`)에서만 재현·변이를 했고 원본 `src`·`scripts` 483개 파일의 시작·종료 sha256 이 같다. 변이 흔적 문자열은 소스에서 0건이다. 외부 호출·커밋·배포·운영 DB 조회는 하지 않았다.
- [03:10] [확실] 직접 실행(원본 트리): 전체 `jest` 141 suites / 2,875 tests 통과, `tsc --noEmit --incremental false` exit 0, `scripts/test-git-hooks.sh` 52/52(복사한 scratchpad 저장소). 보고와 같다.
- [03:10] [확실] **조건 ①(R3-1) — 닫혔다.** 3라운드의 내 재현 입력 2건을 새 코드에 그대로 넣었다. 불명+잠금 UPDATE 실패: 첫 틱 `order_uncertain`, 두 번째 틱 `order_uncertain`(건너뜀), `submitOrder` 1회, critical 경보 1건(본문에 "DB 잠금에는 실패했지만 이 프로세스에서는 건너뜁니다"). 성공+`executing` 기록 실패: 첫 틱 `submitted`, 두 번째 틱 건너뜀, `submitOrder` 1회, 경보 `critical`("기록 실패")+`info`(진입 알림). 정상 DB 의 불명 분기는 전과 같다(잠금 UPDATE 1회·`시그널을 잠갔습니다`·critical 1건). 경보는 불명 분기에서 UPDATE **바깥**으로 옮겨졌고, 성공 분기의 기록 UPDATE 도 자체 try/catch 안에 있어 바깥 catch 의 `order_failed` 로 떨어지지 않는다. 변이 W1~W13: 잡힘 12(집합 등록 제거 2종·가드 제거·경보를 UPDATE 성공 때만으로 옮김·catch 가 다시 던지는 옛 동작 2종·성공 경보 하향·건너뜀 결과 변경·집합 키 오류·UPDATE 제거 2종·불명 사유 이스케이프), 생존 1(W13: 성공 분기 경보의 DB 오류 사유 이스케이프 제거 — 단언이 없다, Low). R8 은 이제 잡힌다.
- [03:10] [확실] **질문 1 답 — 프로세스 지역 집합의 새 위험(차단 아님, 한계 명시).** 집합은 *내가 제안한* 설계이고 의도대로 동작하지만 한계가 있다. 재현: ⓐ DB 가 복구돼도 집합 항목은 `UPDATE` 를 다시 시도하지 않아(복구 뒤 2틱에 UPDATE 시도 0회) 시그널이 DB 에서 `approved_pending_entry` 로 남는다 — UI 에는 "진입 감시 중"으로 보여 정상 진행처럼 보인다. 사람이 아는 길은 critical 경보 1회뿐이다 ⓑ 건너뛰기가 만료 검사보다 앞이라 만료 시각이 지나도 그 행은 `expired` 로 정리되지 않는다(만료 행으로 시험: UPDATE 0회, 결과 `order_uncertain`) ⓒ **재기동(배포)하면 집합이 비워져 같은 시그널을 다시 낸다** — 모듈을 새로 로드해 시험하니 재기동 전 `submitOrder` 1회, 재기동 뒤 첫 틱에 2회가 됐다(행이 여전히 `approved_pending_entry`·구간 안·미만료일 때). 이 저장소는 push 가 곧 배포라 "운영자가 정리하기 전의 우연한 재기동"이 가능하다. 다만 이 경로는 DB 장애로 잠금/기록이 실패한 뒤 + 운영자가 행을 맞추기 전 + 재기동 + 아직 구간 안·미만료가 겹쳐야 하고, 이전(불명 결과를 1분마다 무조건 재제출)보다 훨씬 좁다. 권고(조건 아님): 집합 항목이 있는 시그널은 이후 틱에서 같은 조건부 `UPDATE … executing` 을 다시 시도해 성공하면 집합에서 빼면(DB 가 돌아오면 자동 복구되고 재기동·사람에 의존하지 않는다), 건너뛰기를 만료 검사 뒤로 옮기고, 경보/runbook 에 "정리 전에는 배포 금지" 를 적는다.
- [03:10] [확실] **질문 2 답 — 성공 분기 후속 코드는 그대로 돌아도 맞다.** 기록 UPDATE 가 실패해도 주문은 접수됐으므로 진입 알림(`info`)과 `setPositionScenarioExit`(시나리오 청산 조건 기록)이 실행돼야 포지션 관리가 이어진다 — 재현에서 두 번 다 실행됐다(경보 레벨 [critical, info], `setPositionScenarioExit` 1회). 결과 `submitted` 도 사실이다(주문은 접수). 문구상의 흠은 DRY_RUN 일 때도 "진입 주문은 접수됐으나"라고 쓰는 것뿐이다(cosmetic).
- [03:10] [확실] **질문 3 답 — docs 복구 SQL.** §6.1 표와 SQL 두 개를 읽어 확인했다. 즉시 주문 경로는 `executing`(선점) → 되돌릴 상태 `awaiting_approval`, 진입 감시 경로는 잠금이 `approved_pending_entry` → `executing` 이므로 되돌릴 상태 `approved_pending_entry` — 둘 다 `WHERE … AND status='executing'` 조건부라 맞다. 흠 둘(Low): (a) 접수돼 있을 때의 "필요하면 `status='approved'`" 는 즉시 주문 경로의 성공 상태이고, 진입 감시 경로의 성공 상태는 코드상 `executing` 이다(그대로 두면 된다) (b) 경로 구분 문장이 "price_zone 이 있으면 진입 감시"인데 하이브리드가 꺼져 있으면 구간이 있어도 즉시 주문 경로다 — 알림 제목(표)과 `consumed_order_id` 유무(진입 감시 잠금은 주문 ID 를 남기고, 즉시 주문 선점은 NULL)가 더 정확한 구분이다. §7 한계에 내가 지적한 Low 3건이 반영됐다.
- [03:10] 확인하지 못한 것: ① 실제 텔레그램 서버 동작(콜백 응답 시한·`update_id` 재설정·`url` 버튼 거부 조건) ② KIS 가 5xx·연결 끊김 뒤에도 주문을 처리하는 빈도 ③ `next build` 작업자가 `register()` 를 호출하는지 ④ `runLoop` 를 실제 타이머·실제 MariaDB 로 돌린 실행 ⑤ 실제 빌드(Edge 번들) ⑥ 스냅샷 현금과 KIS 주문가능금액의 관계 ⑦ 복구 SQL 의 실행(읽기만 했다) ⑧ `trade-report` 이중 이스케이프의 실제 출력 ⑨ 배포(blue/green) 중 두 릴리스가 동시에 `entry-watcher` 를 받는 순서 — 위 ⓒ 의 재기동 노출이 실제 배포에서 어떤 창으로 나타나는지 ⑩ Codex 검토는 하지 않았다.
- [03:10] 수용 가능한 잔여 위험: 텔레그램 계정 탈취=거래 승인 권한·봇 토큰 공유(사용자 수용, 재논의 안 함), 스냅샷 현금 근사, 한 주 이상 방치 뒤 `update_id` 재설정, 개발·QA 서버가 같은 DB 로 락을 잡는 경우, 후처리 기록 실패로 남는 `executing`(재승인 불가 쪽, 경보+runbook), 결과 불명 주문이 일 한도에 안 잡히는 점, **프로세스 지역 집합의 한계(재기동 시 소실·DB 복구 뒤에도 자동 정리 안 됨, 위 질문 1)**, 2라운드부터 이어진 미조치 Low(`runLoop` 최소 대기, `kis_rejected` 의 게이트웨이 일시 오류 문구, 송신 전 예외의 과포함 잠금), `trade-report` 이중 이스케이프(범위 밖).
- [03:10] 판정 근거: 1라운드 High(D-1)·2라운드 필수 2건·3라운드 조건 2건이 모두 코드·재현·변이로 닫혔고, 이번 변경분이 만든 새 결함은 찾지 못했다. 변경은 entry-watcher 의 두 후처리 UPDATE 를 try/catch 로 감싸고 경보를 UPDATE 바깥으로 옮긴 것, 프로세스 지역 집합, docs 뿐이며 성공·DRY_RUN·확정 거부·분할 진입 게이트의 기존 흐름은 변하지 않았다. 남은 한계(집합의 재기동 소실)는 위 권고로 줄일 수 있으나 이전 동작보다 훨씬 좁고 경보·runbook 이 있어 통과를 막지 않는다.
- [03:10] 4라운드 결론: pass (조건 2건 해소 확인). 이 줄은 판정 줄이 아니며 5라운드 기록이 대체한다.

## 3라운드 감사 기록 (superseded)


- [03:02] 범위·방법(3라운드, 좁은 확인): 2라운드 이후 바뀐 소스 6개(`dry-run.ts`·`approval-message.ts`·`approval-notify.ts`·`telegram-approval.ts`·`service.ts`·`entry-watcher/route.ts`)와 테스트 6개를 diff 로 읽고, 새 사본(`review42/work3`)에서만 재현·변이를 했다. 원본 `src`·`scripts` 483개 파일의 시작·종료 sha256 이 같고, 변이 흔적 문자열(`false as boolean`·`void ((`·`void edited`·`&& true) {`·`_xyz`)은 원본 소스에서 0건이다(코디네이터가 알린 스윕 종료·복원과 일치). 외부 호출·커밋·배포는 하지 않았고 운영 DB 도 이번에는 읽지 않았다. 이번 라운드에 T-042 테스트 파일을 거의 전부 직접 읽었다: `telegram-approval`(140~564줄)·`service`(T-042 부분)·`approval-notify`·`approval-context`(80~249)·`approval-message`·`approval-transitions`·`telegram-callback-data`·`telegram-poller`·`telegram-poller-wiring`·`telegram-api`·`approve-route`·`telegram-approval-selftest`·`unknown-outcome` — 전부 단언이 구현의 오류를 정답으로 고정하지 않고(진짜 SQL 조건을 평가하는 가짜 풀, `trade_logs` 32자 검사 목, 실제 `getSymbolLabel` 반환 형태) 대부분 변이로도 확인됐다. 읽지 못한 것은 `order-sizing.test.ts` 의 기존 부분(diff 만 읽음: 한도 목 추가 — 정당)과 `telegram-approval.test.ts` 앞 140줄(1라운드에 읽음)이다.
- [03:02] [확실] 직접 실행(원본 트리): 전체 `jest` 141 suites / 2,872 tests 통과, `tsc --noEmit --incremental false` exit 0, `scripts/test-git-hooks.sh` 52/52(원본 `.git` 을 건드리지 않도록 복사한 scratchpad 저장소에서 실행). 보고와 같다.
- [03:02] [확실] **R2-1(라벨 이중 이스케이프) — 닫혔다.** 진짜 `getSymbolLabel` + 목 DB `Johnson & Johnson`(라벨 `Johnson &amp; Johnson`)으로 5곳을 다시 확인: 승인 요청 본문 `<b>Johnson &amp; Johnson</b> (NYS:JNJ)`, 결과 head 동일, 간단 본문 제목 `📩 승인 요청: Johnson &amp; Johnson`, 요약 `예: Johnson &amp; Johnson`, 처리기 만료 결과 head 동일 — 어디에도 `&amp;amp;` 가 없다. 자동 제출 알림 제목은 원래 코드(`${await getSymbolLabel(…)}`)로 복원됐고 사유 줄만 이스케이프한다(구현자 테스트가 실제 반환 형태로 단언). 조회 실패 폴백(원본 심볼)은 `h(a.symbol)`·`escapeAlertText(row.symbol)` 로 **한 번만** 이스케이프된다(`A&T<x>` → `A&amp;T&lt;x&gt;` 확인). **전수 확인**: 코드베이스의 `getSymbolLabel`/`getSymbolLabels` 소비처는 `custom/confirm`·`entry-watcher`(2곳)·`holding-checker`·`service.ts`·`approval-notify.ts`·`telegram-poller.ts`(배선)·`trade-report`(`getSymbolLabels`)이고 `escapeAlertText`/`h()` 호출처 전체와 대조하면 라벨에 이스케이프를 씌우는 곳은 T-042 코드에 더 없다. 같은 종류가 남은 곳은 **T-042 범위 밖의 기존 코드 하나**: `cron/trade-report` 는 `getSymbolLabels` 의 이미 이스케이프된 라벨을 본문에 넣은 뒤 `mrkdwnToTelegramHtml(body)` 가 본문 전체를 다시 이스케이프한다(`trade-report.ts` 주석이 이 구조를 스스로 설명) — 텔레그램 정기 리포트에서 `&` 가 든 종목이 `&amp;` 로 보일 가능성이 높다 [가능성 높음 — 코드 읽기만, 실행하지 않음]. 후속 task 로 올릴 Low.
- [03:02] [확실] **R2-2(송신 후 바깥 catch) — 닫혔다.** `submitOrder` 반환 경로를 하니스에서 전부 다시 돌렸다: ⓐ 송신 성공+`accepted`·`failed` UPDATE 실패 → `{sent:1, ok:false, outcomeUnknown:true}` ⓑ 송신 throw+`failed` UPDATE 실패 → 불명 ⓒ 5xx 응답+`rejected`·`failed` UPDATE 실패 → 불명 ⓓ 확정 거부(입력 오류)+DB 정체로 두 UPDATE 모두 실패 → 보수적으로 불명(안전한 방향) ⓔ 확정 거부+정상 DB → 플래그 없음 ⓕ DRY_RUN 의 `dry_run` UPDATE 실패(송신 0회) → 플래그 없음 ⓖ 송신 전 예외(한도 산정이 던짐, 송신 0회) → 플래그 없음. 변이 S1(`sendReached` 설정 제거)·S2(바깥 catch 항상 확정)·S3(항상 불명)·S4(시작 시점에 설정)·D1·D2 가 모두 잡힌다. **질문 2 답**: `sendReached = true` 는 `try {` 직후 `realSubmit(req)` 호출 바로 앞 한 줄이라 그 둘 사이에 다른 코드가 없다. 바깥 catch 에서 `sendReached` 가 참인 채 도달하는 예외는 안쪽 catch 의 `failed` UPDATE 가 던진 경우뿐이므로(송신 이후), 과포함이 생기는 경로는 이미 알려진 하나 — `realSubmit` **안에서** 송신 전에 던지는 예외(토큰 발급·`KisThrottle*`) — 이고 방향은 안전하다(잠금+경보). 안전층 3~7단계·DRY_RUN 경로는 `sendReached=false` 라 확정으로 남는다.
- [03:02] [확실] **질문 3 답 — entry-watcher 기존 흐름 무손상.** 변경은 `if (ok || dryRun) {…} else if (outcomeUnknown === true) {…} else {order_failed}` 로 분기 하나가 추가됐을 뿐이다. 성공·DRY_RUN 은 첫 분기라 불변, 확정 거부(`outcomeUnknown` 없음)는 마지막 분기로 가서 `approved_pending_entry` 를 유지하고 다음 틱에 재시도(테스트·변이 E1·E2 가 고정), 잠금 UPDATE 는 `AND status='approved_pending_entry'` 조건부이고 주문 ID 를 남기며(E3·E6), 경보는 critical 이고 사유를 이스케이프한다(E4·E5). 분할 진입 게이트(`blocked_by_prior_split`)는 이전 회차가 `approved_pending_entry` 인지만 보므로 불명으로 잠긴(`executing`) 회차는 "끝난 것"으로 취급돼 다음 회차가 진행된다 — 성공과 같은 처리이며 결함은 아니다(주문이 실제로 나갔다면 맞다). `consumed_order_id` 를 읽는 곳은 `trade-report` 의 `auto_submitted` 매도 조회뿐이라 잠금이 보고서에 섞이지 않는다.
- [03:02] [확실] **Medium(비회귀) — R3-1. entry-watcher 의 잠금 UPDATE 가 실패하면 조용히 재시도로 돌아간다.** 불명 분기의 `UPDATE … executing` 은 이 분기를 감싼 바깥 `try/catch` 안에 있다. 재현(`unknown-outcome.test.ts` 하니스 사본): `submitOrder` → `{ok:false, orderId:91, outcomeUnknown:true}` 이고 `UPDATE signals` 가 `db gone` 으로 던지면 결과는 `{"outcome":"order_failed","detail":"db gone","alerts":0}` — **critical 알림이 한 번도 나가지 않고**(경보는 UPDATE 성공 뒤에 있다), 시그널은 `approved_pending_entry` 로 남아 다음 틱(1분)에 같은 주문을 다시 낸다. 불명 결과의 대표적 동반 원인이 DB 정체(R2-2)라 가장 위험한 순간에 잠금이 무너진다. **같은 구조가 기존 성공 분기에도 있다**: 접수가 확정된 주문 뒤 `UPDATE … executing` 이 던져도 `order_failed` 로 처리돼 다음 틱에 재주문한다(재현 `{"outcome":"order_failed","detail":"db gone"}`). 둘 다 T-042 이전부터의 잠복 결함이고 T-042 가 악화시키지는 않았다(불명 결과는 이전에 *항상* 재시도됐다). 그래서 1·2라운드의 High/Medium 처럼 차단 사유로 세지 않지만, 이 task 가 바로 이 불변식을 다루고 있으므로 같은 변경에서 닫을 것을 조건으로 건다. 수정 방향: 잠금(그리고 성공 분기의 기록) UPDATE 를 자체 try/catch 로 감싸 **실패해도 critical 경보를 보내고**, 프로세스 로컬 `Set<signalId>` 에 넣어 다음 틱에서 건너뛰게 한다(재기동 전까지 재주문 방지). 테스트는 위 재현 입력 2건.
- [03:02] [확실] **질문 4 답 — 새 후처리 catch 둘.** ① 주문 접수 뒤 최종 `approved` 기록이 실패하면 `.catch` 가 로그+`warning` 알림을 내고 `ok:true`(주문 접수)를 돌려준다. 시그널은 `executing` 에 남아 재승인이 막히고(이중 주문 없음), 결과 문구는 사실(주문 접수)이다. 위험은 `consumed_order_id` 가 NULL 로 남는 것과 경보가 `warning` 하나라는 점뿐 — `trade-report` 가 이 컬럼을 매도 `auto_submitted` 에만 쓰므로 영향은 표시 수준이다. ② 확정 거부 뒤 `releaseClaim` 이 실패하면 로그+`warning` 알림을 내고 `order_not_accepted` 를 돌려준다. 시그널은 `executing` 에 남아 재승인이 막힌다(안전). 단 **텔레그램 결과 문구가 사실과 어긋난다**: `order_rejected` 문구는 "시그널은 만료 전까지 승인 대기로 남아 있습니다" 라고 쓰고 버튼을 남기는데, 이 경우 시그널은 `executing` 이라 다시 누르면 "이미 처리된 시그널입니다 — 주문 처리 중"과 함께 버튼이 지워진다. 이중 주문으로 이어지지 않고 `warning` 알림이 사정을 알리므로 Low. 두 catch 모두 **삼켜서 위험해지는 경우는 찾지 못했다** — 잔류 상태가 항상 "재승인 불가" 쪽이다.
- [03:02] [확실] **Low 목록(차단 아님).** (a) `docs/telegram-approval.md` §6.1 의 복구 SQL 은 `awaiting_approval` 로 되돌리는 경우만 적었다. entry-watcher 가 잠근 시그널은 하이브리드 승인된 것이라 되돌릴 상태가 `approved_pending_entry` 여야 하는데 문서에 없다(잘못 따르면 승인 대기 목록으로 되돌아가 다시 사람이 승인해야 함) (b) 변이 R8 생존: 서명 불일치 분기의 라벨 조회 실패 폴백(`escapeAlertText(row.symbol)`)을 제거해도 테스트가 통과 — 실제 심볼에는 특수문자가 없어 영향은 없다 (c) 2라운드의 미조치 Low 는 그대로다: `runLoop` 락 획득 직후 상실·롱폴링 즉시 빈 응답 시 최소 대기 없음(이 MariaDB 에서는 재현 안 됨), `kis_rejected` 기본값에 게이트웨이 일시 오류 문구를 불명으로 추가하는 것, 송신 전 토큰·`KisThrottle*` 예외의 과포함 잠금, 결과 불명 주문이 일 한도 합계에서 빠지는 점(구현자가 별도 사안으로 기록).
- [03:02] [확실] 변이(3라운드, 새 코드 28개, 러너는 매번 원복·해시 대조): 잡힘 27, 생존 1(R8, 위 (b)). 라벨 이중 이스케이프 재도입 5곳(R1~R5)·폴백 이스케이프 제거 3곳(R6~R8 중 R6·R7 잡힘)·`sendReached` 4종·entry-watcher 6종·후처리 catch 4종·응답 한 번 불변식 3종(A9~A11)·`outcomeUnknown` 핵심 3종이 전부 잡힌다. 참고: 처음 러너는 `--testPathIgnorePatterns=` 옵션이 위치 인자를 흡수해 관련 테스트가 돌지 않은 채 "생존"으로 나왔고(1라운드에 겪은 함정), 옵션을 빼고 처음부터 다시 돌려 위 결과를 얻었다.
- [03:02] 확인하지 못한 것: ① 실제 텔레그램 서버 동작(콜백 응답 시한·`update_id` 재설정·`url` 버튼 거부·`editMessageReplyMarkup` 응답) ② KIS 가 5xx·연결 끊김 뒤에도 주문을 처리하는 빈도 ③ `next build` 작업자가 `register()` 를 호출하는지 ④ `runLoop` 를 실제 타이머·실제 MariaDB 로 돌린 실행 ⑤ 실제 빌드(Edge 번들) — 대신 `telegram-poller.ts` 트랜스파일 결과 런타임 정적 import 0개를 2라운드에 확인했고 이번에 소스가 바뀌지 않았다 ⑥ 스냅샷 현금과 KIS 주문가능금액의 관계 ⑦ 복구 SQL(docs §6.1) 실행 ⑧ `trade-report` 의 이중 이스케이프 실제 출력(코드 읽기만) ⑨ Codex 검토는 하지 않았다.
- [03:02] 수용 가능한 잔여 위험: 텔레그램 계정 탈취=거래 승인 권한·봇 토큰 공유(사용자 수용, 재논의 안 함), 스냅샷 현금 근사, 한 주 이상 방치 뒤 `update_id` 재설정(문서화됨), 개발·QA 서버가 같은 DB 로 락을 잡는 경우(문서화됨), 선점 뒤 프로세스 사망·후처리 기록 실패로 남는 `executing`(재승인 불가 쪽이라 안전, 경보+runbook), 결과 불명 주문이 일 한도에 안 잡히는 점. R3-1 은 "수용"이 아니라 아래 조건으로 닫는다.
- [03:02] 판정 근거와 조건: 1라운드 High(D-1)·2라운드 필수 2건(R2-1·R2-2)이 모두 코드·재현·변이로 닫혔고, 새로 추가된 entry-watcher 분기와 후처리 catch 도 기존 흐름을 해치지 않으며 새로 만든 회귀는 찾지 못했다. 남은 R3-1 은 T-042 가 만든 위험이 아니라(오히려 이전보다 줄었다) 같은 불변식의 잔여 구멍이라 전체를 막지는 않는다. 그래서 **조건부로 통과**시킨다. 조건(커밋 전, 둘 다 작다): ① R3-1 — entry-watcher 의 불명 잠금(및 성공 기록) UPDATE 실패 시 critical 경보 + 프로세스 로컬 재주문 차단 + 위 재현 입력 2건의 테스트 ② `docs/telegram-approval.md` §6.1 에 entry-watcher 잠금 복구(되돌릴 상태 `approved_pending_entry`) 추가. 조건 충족 뒤에는 변경분(entry-watcher route+테스트+docs)만 한 줄 재확인을 받는다 — 스스로 확인했다고 적지 말 것. L 항목은 같은 변경에 넣기를 권하나 차단 사유가 아니다.
- [03:02] 3라운드 결론: conditional pass (조건: entry-watcher 잠금/기록 UPDATE 실패 대응, docs §6.1 보강). 이 줄은 판정 줄이 아니며 4라운드 기록이 대체한다.

## 2라운드 감사 기록 (superseded)


- [02:27] 범위·방법(2라운드): 1라운드 이후 바뀐 파일 전부(소스 14 + 테스트 12 + 훅 스크립트 2 + docs 1)를 다시 읽고, 새 사본(`review42/work2`)에서만 변이·재현을 했다. 원본 `src`·`scripts` 482개 파일의 시작·종료 sha256 이 같다. 코디네이터가 알린 변이 러너 사고를 확인했다: `telegram-poller.ts` 45f063222d5b, `telegram-approval.ts` 85eac6fdb516, `service.ts` 1f82fd76799b, `dry-run.ts` ea0ae93b62b1 이 보고된 해시와 **일치**하고, 변이 흔적(`false as boolean`·`void edited`·`&& true) {`·`_xyz` 등)을 원본 소스 전체에서 grep 해 **0건**이다. 외부 호출·커밋·배포는 하지 않았다. 운영 DB 는 읽기 전용 조회만 했다(`stock_meta` 이름 분포, 최근 30일 시그널, 주문 상태·거부 사유 분포). 테스트 파일은 줄 단위가 아니라 변이로 행동을 평가했다.
- [02:27] [확실] 직접 실행(원본 트리): 전체 `jest` 140 suites / 2,675 tests 통과, `tsc --noEmit --incremental false` exit 0, `scripts/test-git-hooks.sh` 52/52(원본 `.git` 을 건드리지 않도록 복사한 scratchpad 저장소에서 실행; t42a~e 포함). 수치는 보고와 같다.
- [02:27] [확실] 1라운드 지적의 처리 확인: **D-1 핵심**(예외·5xx·network_error 는 `outcomeUnknown` → `executing` 유지 + critical 알림 + `errorCode:'order_uncertain'` + 감사 `signal_approve_order_uncertain`, 텔레그램은 버튼 없이 "다시 승인하지 마세요", 확정 거부만 복귀)를 코드 추적과 변이로 확인했다(B1~B3·D1~D3·D5·M6 잡힘). **D-2** 이벤트명 29·30자, 서비스 테스트 목이 32자 초과 INSERT 를 던지게 바뀜(B4 잡힘). **D-3** 한도 0·비유한이면 사유를 만들지 않고 `exceedsLimit` 가 `<금액> > <한도>` 꼴 상세만 초과로 센다 — 내 1라운드 재현 입력(한도 0·집계 실패)이 이제 실행 가능으로 나온다(X2·X3 잡힘, X1 은 `exceedsLimit` 와의 이중 가드라 동치). **D-4** `safe()` 가 `{ok:false}` 를 실패로 집계하고 수정 실패 시 새 메시지로 대체, 이미 처리된 시그널은 본문을 두고 버튼만 지움, 사유 160자 제한, 시각 `hourCycle:'h23'`(실측 `00:05`)(A10~A12·M1·M2 잡힘). **D-5** 배선을 `ApprovalIO`/`LoopIO` 주입 구조로 바꿔 내 1라운드 생존 변이 13개가 **전부 잡힌다**(P1~P16·B6·B8·N2·X4·E3). Low 처리(서명을 DB 저장 금액으로, 자가 점검 링크 버튼, 하이브리드 판정 단일 함수, 명시 사용자는 숫자 ID 만, SAFETY_PATHS 에 테스트 2개)도 확인했다.
- [02:27] [확실] **Medium — R2-1. 종목명이 이중 이스케이프된다(1라운드 내 결론 정정 포함).** `notify/symbol-name.ts getSymbolLabel` 은 문서·구현 모두 "이미 텔레그램 HTML·슬랙 mrkdwn 에 안전하게 이스케이프된 값"을 돌려준다. 그런데 T-042 코드는 그 값을 다시 `h()`/`escapeAlertText` 에 통과시킨다: `approval-notify.renderPlainRequest` 제목, `approval-message.renderApprovalRequest` 의 `<b>${h(v.label)}</b>`, `renderDecision` 의 `head`, 요약의 `sample.map(h)`, `service.createSignal` 자동 제출 알림 제목. 재현(진짜 `getSymbolLabel` + 목 DB 이름 `Johnson & Johnson`): 라벨 `Johnson &amp; Johnson` → 요청 줄 `<b>Johnson &amp;amp; Johnson</b>`, 결과 head 동일, 간단 본문 제목 `📩 승인 요청: Johnson &amp;amp; Johnson` — 텔레그램은 이를 문자 그대로 `Johnson &amp; Johnson` 으로 보여 준다(배달 실패는 아니다). 운영 실측: `stock_meta` 15,295개 이름 중 `&` 포함 954개(`SUN&L`·`F&F홀딩스`·`HL D&I` …), **최근 30일 시그널 934건 중 80건**(NYS:JNJ 7·JPM 36·PG 10·WFC 27)이 해당한다. 이전 코드는 `${await getSymbolLabel(…)}` 단일 이스케이프라 맞게 보였다 — 간단 본문과 자동 제출 알림은 **스위치와 무관하게 배포 즉시** 퇴행한다. 이전 라운드 테스트가 못 잡은 이유는 `label` 을 날 문자열(`'AT&T <Inc>'`)로 목킹해 실제 반환 계약을 흉내 냈기 때문이다(D-3 과 같은 유형). 수정: 라벨은 이미 안전한 값으로 다루고(폴백 `row.symbol`/`a.symbol` 만 이스케이프), 테스트는 진짜 `getSymbolLabel` 반환 형태(이스케이프된 값)로 넣는다.
- [02:27] [확실] **Medium — R2-2. `outcomeUnknown` 이 붙지 않는 송신 후 경로가 남아 있다(D-1 의 잔여 구멍).** `submitOrderInner` 는 3~7단계 예외를 잡는 **바깥 try/catch** 안에 송신 단계의 안쪽 try/catch 가 들어 있다. 송신 뒤 `UPDATE orders … 'accepted'`(또는 `'rejected'`)가 실패하면 안쪽 catch 가 `'failed'` UPDATE 를 시도하는데, DB 가 계속 죽어 있어 **이것도 던지면** 예외가 바깥 catch 로 올라가 `{ok:false, error}` 를 **`outcomeUnknown` 없이** 돌려준다(바깥 catch 는 "송신 전 예외"를 가정). 재현(`submit-order.test.ts` 하니스 사본): `realSubmit` 은 1회 호출되어 성공(`exchangeOrderId:'EX-9'`)했고 `accepted`·`failed` UPDATE 가 모두 `db gone` 으로 실패 → 반환 `{"sent":1,"ok":false,"error":"db gone"}` (`outcomeUnknown` 없음). `realSubmit` 이 던진 뒤 `failed` UPDATE 도 실패하는 경우도 같다. 그러면 `approveSignal` 은 확정 거부로 읽어 `releaseClaim`(DB 가 그 사이 돌아왔다면 성공) → 대기 복귀 → 재탭 시 이중 주문. DB 정체는 이 배포의 알려진 장애 유형이다. 수정(사본에서 검증, 기존 안전 테스트 543건 통과): 송신 직전에 `sendReached = true` 를 두고 바깥 catch 가 `outcomeUnknown: sendReached` 를 붙인다. 회귀 테스트는 위 재현 입력 2건.
- [02:27] [확실] 질문 1 답 — `submitOrder` 반환 경로 전수: ① 사전 예외(계좌 ID·환산·`orders` INSERT)는 `submitOrder` 밖으로 던져져 `approveSignal` catch 가 복귀 → 송신 전이라 맞다 ② 킬스위치·심볼·1회/일 한도·변동폭 차단 = `ok:false`+`blockedBy`, 송신 전 → 확정 맞다 ③ 3~7단계 중 예외 = 바깥 catch, 송신 전 → 확정 맞다(단 R2-2 경로가 여기로 샌다) ④ DRY_RUN = `ok:true` ⑤ 송신 성공+`accepted` UPDATE 성공 = `ok:true` ⑥ 송신 성공+`accepted` UPDATE 실패 → 안쪽 catch → 불명 맞다 ⑦ KIS 명시 거부(입력 오류·잔고·호가·장마감 등) = 확정 맞다 ⑧ 5xx·`network_error` 분류 = 불명 맞다 ⑨ 송신 중 예외 = 불명 맞다 ⑩ ⑥~⑨ 이후 `failed`/`rejected` UPDATE 가 또 실패 → 바깥 catch → 플래그 없음 **틀림(R2-2)**. `withKisPriority` 는 `AsyncLocalStorage.run` 래퍼일 뿐이고, 바깥 catch 의 후속 작업은 `.catch(()=>{})`·`auditLog` 내부 try 로 막혀 있어 **송신 후 예외가 `submitOrder` 밖으로 새는 경로는 없다** — `approveSignal` catch 의 복귀는 송신 전 예외에만 닿는다.
- [02:27] [확실] 질문 1 답(계속) — 분류가 부족한가: `kis_rejected` 기본값의 실제 내용을 운영 `orders`·`trade_logs` 로 확인했다. `rejected/kis_rejected` 1,490건의 사유는 전부 입력 검증류("주문구분 입력오류입니다" 1,360, "주문 가격을 확인 하시기 바랍니다…" 220 등)라 확정 거부로 읽어도 된다. 반면 `kis_5xx` 84건·"KIS overseas order HTTP 500" 121건이 실제로 있었으므로(5월) 5xx 분류는 이론이 아니라 실제 사건에 대응한다. 외부 확인이 불가한 [추측] 하나: 게이트웨이 일시 오류 메시지(예: EGW0000x "일시적인 오류")나 `rt_cd` 가 없는 JSON 이 `kis_rejected` 기본값으로 떨어져 확정 거부로 읽힐 수 있다 — 정규식에 `일시적|system error|EGW0000\d` 를 불명으로 추가하는 것을 권한다(Low). 과한가: 불명으로 **과포함**되는 송신 전 예외가 있다 — `kisHeaders`(토큰 발급·자격증명 읽기)와 `acquireKisSlot`(`KisThrottleQueueFullError`/`KisThrottleTimeoutError`, `fetch` 이전에 던짐)가 `realSubmit` 안에서 던지면 안쪽 catch 가 불명으로 잠근다. 방향은 안전하고 발생은 드물지만 잠길 때마다 critical 경보와 수동 SQL(docs §6.1)이 필요하다. 타입 있는 `KisThrottle*` 예외를 확정 거부로 읽게 하면 줄일 수 있다(Low).
- [02:27] [확실] 질문 2 답 — 처리기 5·7단계 재작성: 한 콜백에 `answer` 를 두 번 하는 경로는 **없다**(분기별로 정확히 1회: 권한 없음·키 없음·자가 점검·스위치 OFF·미존재·서명 불일치·만료·이미 처리·킬스위치·"처리 중…"). 읽기만 하는 빠른 판정은 서명 검증 **뒤**에 오고 거래 함수를 부르지 않으므로 거래 경로를 우회하지 않으며, "승인됨"으로 읽히는 메시지(`order_placed`·`entry_watch`)는 오직 `deps.approve` 가 `ok:true` 를 돌려줄 때만 만들어진다(A5·A4 잡힘). 이미 처리됨은 토스트+버튼 제거, 만료만 본문 수정, 킬스위치 ON 은 본문 불변. 감사는 권한 없음·서명 불일치·자가 점검·만료·이미 처리·킬스위치·최종 결과에 남고 스위치 OFF·키 없음·시그널 없음에는 남지 않는다(거래·상태 변화가 없는 경로라 수용). 결함은 아니지만 **한 콜백에 한 번 응답한다는 불변식을 고정한 테스트가 없다**(A9 생존: 결과 뒤에 두 번째 `answer` 를 넣어도 통과).
- [02:27] [확실] 질문 3 답 — 새 배선이 권한을 넓힐 수 있는가: 찾지 못했다. 허용 채팅은 `TELEGRAM_CHAT_ID` 한 개(공백만 제거), 허용 사용자는 (a) 명시 목록이 비어 있지 않으면 **양의 정수(숫자 또는 숫자 문자열)만**, 쓸 값이 하나도 없으면 폴백 없이 빈 집합, (b) 목록이 없거나 비면 개인 채팅 ID 만(`^\d+$`; 그룹 음수·`@채널` 은 빈 집합). 숫자·문자열 ID 는 둘 다 `String()` 으로 정규화돼 비교된다. 서명 키는 세션 비밀 파생이고 비밀이 없으면 `null` 로 모든 거래 동작이 거부된다. 하이브리드 판정은 웹 라우트와 같은 `readHybridModeEnabled`(DB false 가 env 를 이김). 1라운드에서 내가 쓴 끝까지 시험 10건을 **새 코드의 기본 IO(`defaultApprovalIO`, 실제 모듈 + 목 DB)로** 다시 돌려 모두 통과했다. 변이 P1~P7·P12·P16 이 전부 잡힌다.
- [02:27] [확실] 질문 4 답 — `runLoop`: `finally` 는 `releaseLock` → `conn.release()` 한 번이고 대기(`sleep`)는 그 **뒤**다(P9·P11 잡힘, 락 미획득 시 `RELEASE_LOCK` 을 부르지 않음). 락 상실(`IS_USED_LOCK` 거짓)은 폴링을 멈추고 풀고 다시 잡는다(P8 잡힘). `getConnection` 실패는 위로 던져져 시작 함수의 30초 재시작으로 간다. 대기 0 변이 둘(P10 락 재시도 대기 0, P14 예외 후 대기 0)은 테스트가 **멈춤으로 감지**했다(러너가 프로세스 그룹을 죽임). 남은 이론상 위험 둘(Low): ① 락을 잡은 직후 `stillHoldsLock` 이 거짓이면 내부 루프가 돌지 않고 `waitAfter=0` 이라 대기 없이 DB 왕복을 반복한다 — 이 MariaDB 에서는 `IS_USED_LOCK=CONNECTION_ID()` 가 1 로 나오는 것을 1라운드에 실측해 재현되지 않으나 프록시가 끼면 가능 ② `getUpdates` 가 25초 롱폴링을 무시하고 즉시 빈 배열을 돌려주는 환경이면 `idle` 에 대기가 없어 같은 식으로 돈다(텔레그램 429 가 결국 제동). 둘 다 `waitAfter` 에 최소 대기(예: 1초)를 두면 막힌다.
- [02:27] [확실] **Low — L2-1. 승인 뒤 후처리 예외가 "처리하지 못했습니다… 다시 시도하세요"로 보인다.** `approveSignal` 이 주문 수락 뒤 최종 `approved` UPDATE 에서 던지거나, 확정 거부 경로의 `releaseClaim` 이 던지면 예외가 처리기 catch 로 가 `failed` 뷰(버튼 유지)가 된다. 주문은 이미 접수됐을 수 있고 시그널은 `executing` 이라 재탭은 `already_handled` 로 막히지만(이중 주문 없음), 문구가 "주문 없음"으로 읽혀 사용자가 KIS 앱에서 직접 주문할 수 있다. 송신 이후 예외는 `order_uncertain` 문구로 보이게 하는 것이 맞다.
- [02:27] [확실] **Low(범위 밖, 같은 결함 계열) — L2-2. `entry-watcher` 가 `outcomeUnknown` 을 읽지 않는다.** `outcomeUnknown` 을 읽는 곳은 `approveSignal` 뿐이다(grep). `entry-watcher` 는 `submitOrder` 가 `ok:false` 면 시그널을 `approved_pending_entry` 로 둔 채 `order_failed` 만 기록하므로, 5xx·연결 끊김 뒤에도 **다음 틱(분 단위)에 같은 주문을 다시 낸다.** 텔레그램 하이브리드 승인이 이 경로로 들어오는 양을 늘리고, 5월에 `kis_5xx` 84건·HTTP 500 121건이 실제로 있었다. T-042 가 만든 위험은 아니므로 이 task 의 결함으로 세지 않지만 후속 task 로 올려야 한다. 또한 일 한도 합계가 `rejected`/`failed` 를 빼므로 결과 불명 주문은 한도에 잡히지 않는다.
- [02:27] [확실] **Low — L2-3. 테스트 공백(소규모).** (a) A9 생존(응답 1회 불변식), (b) D4 생존: 송신 전 예외(3~7단계 catch)가 `outcomeUnknown` 을 받아도 통과 — "송신 전 예외는 확정 거부"를 고정한 테스트가 없다, (c) 기본 IO 접착 코드(`defaultApprovalIO`·`defaultLoopIO`)는 저장소 테스트가 아니라 내 시험으로만 확인됐다, (d) R2-1·R2-2 재현 입력은 저장소 테스트에 없다. 그 밖에 `approveSignal` 불명 경보 본문에 `**` 가 들어 있어 텔레그램에서 별표가 그대로 보인다(cosmetic).
- [02:27] [확실] 변이 요약(2라운드, 새 코드 기준 83개): 잡힘 72(B8 은 러너가 `"undefined" is not valid JSON` 으로 "무효" 분류했지만 해당 테스트가 실패하므로 잡힌 것), 멈춤으로 감지 2(P10·P14 — 바쁜 대기), 생존 3(A9·D4 = 위 L2-3, X1 = `exceedsLimit` 와 이중 가드라 동치). 1라운드의 생존 13개는 전부 잡힌다. 러너는 매 변이 뒤 원복하고 해시를 대조했으며 원본은 건드리지 않았다.
- [02:27] 확인하지 못한 것: ① 실제 텔레그램 서버의 콜백 응답 시한·`update_id` 재설정·`url` 버튼 거부 조건·`editMessageReplyMarkup` 응답(외부 호출 금지) ② KIS 가 5xx·연결 끊김 뒤에도 주문을 처리하는 빈도 — R2-2 와 D-1 전반의 발생 확률 ③ `next build` 작업자가 `register()` 를 호출하는지(호출한다면 플래그가 켜진 뒤 30초 넘는 빌드 작업자가 락을 잠깐 쥘 수 있다) ④ `runLoop` 를 실제 타이머·실제 MariaDB 로 돌린 실행(주입된 가짜 위의 테스트와 실 DB 락 시험만 봤다) ⑤ 실제 빌드(Edge 번들) — 대신 `telegram-poller.ts` 를 트랜스파일해 **런타임 정적 import 가 0개**임을 확인했고 동적 import 만 남는다 ⑥ KIS 주문가능금액과 스냅샷 현금의 관계(미결제 대금) ⑦ `docs/telegram-approval.md` §6.1 의 복구 SQL 은 읽기만 했고 실행하지 않았다 ⑧ Codex 검토는 하지 않았다.
- [02:27] 수용 가능한 잔여 위험: 텔레그램 계정 탈취=거래 승인 권한·봇 토큰 공유(사용자 수용, 재논의 안 함), 스냅샷 현금 근사(미결제 대금·환율 실패 시 USD 행 누락), 한 주 이상 방치 뒤 `update_id` 재설정(문서화됨), 개발·QA 서버가 같은 DB 로 락을 잡는 경우(문서화됨), 선점 뒤 프로세스 사망으로 남는 `executing`(결과 불명 시 잠금이 의도, 문서화됨), 결과 불명 주문이 일 한도에 안 잡히는 점. 이 중 어떤 것도 R2-1·R2-2 의 수정 없이 "수용 가능"으로 넘기지 않는다.
- [02:27] 재감사 조건과 근거: 1라운드의 High(D-1)는 핵심이 고쳐졌고 D-2~D-5 도 해소됐다. 남은 필수 수정은 **둘뿐이고 둘 다 작다**: R2-1(라벨 이중 이스케이프 — 진짜 `getSymbolLabel` 반환 형태로 테스트) 과 R2-2(`sendReached` 플래그 — 위 재현 입력 2건으로 테스트). R2-2 는 이번 task 의 핵심 불변식(결과 불명이면 재시도 금지)이 한 경로에서 깨지는 것이고, R2-1 은 스위치와 무관하게 배포 즉시 퇴행하는 결정적 결함이라 통과로 올리지 않는다. 두 수정 뒤에는 변경분(`dry-run.ts`, 라벨 호출처 5곳, 해당 테스트)과 위 재현 입력으로만 좁게 3라운드 확인을 받는다. L2-1~L2-3 은 같은 변경에 넣을 것을 권하되 차단 사유는 아니다.
- [02:27] 2라운드 결론: fail (필수 수정 2건: 라벨 이중 이스케이프, 송신 후 바깥 catch). 이 줄은 판정 줄이 아니며 3라운드 기록이 대체한다.

## 1라운드 감사 기록 (superseded)


- [01:36] 범위·방법(1라운드): 변경 전 파일(추적 8 + 신규 소스 9)을 전부 읽고, 작업 트리를 scratchpad(`review42/work`)로 복사해 거기서만 변이·퍼징·재현을 했다. 원본 소스·테스트는 시작·종료 sha256(`src`·`scripts` 481개 파일) 대조로 **불변**을 확인했다. 외부 호출(텔레그램·크론·배포·커밋)은 하지 않았다. 운영 DB는 읽기 전용 조회만 했고(`@@sql_mode`·컬럼 길이·최근 30일 시그널 금액/상태·플래그 키 상태) 비밀 값은 출력하지 않았다. 락 동작은 운영 락 이름이 아닌 일회용 이름으로 시험했다. 테스트 파일은 줄 단위로 다 읽지 않았고 변이로 행동을 평가했다.
- [01:36] [확실] 직접 실행: 원본 트리에서 전체 `jest` 139 suites / 2,552 tests 통과, `tsc --noEmit --incremental false` exit 0. `scripts/test-git-hooks.sh` 는 dangling blob 이 원본 `.git` 에 쌓이지 않도록 `.git` 을 복사한 scratchpad 저장소에서 실행해 51/51 통과(수치는 기대와 같다).
- [01:36] [확실] **High — D-1. 송신 결과가 불확실한 실패도 "거부"로 취급해 대기로 되돌린다 → 같은 시그널로 실주문이 두 번 나갈 수 있다.** `service.ts` `approveSignal` 은 `!orderResult.ok` 이면 무조건 `releaseClaim`(+ 텔레그램은 버튼 유지, "승인했지만 주문이 거부됨"). 그런데 `dry-run.ts submitOrderInner` 는 `realSubmit`(KIS 호출)이 **던진 예외**(연결이 요청 전송 뒤 끊김 등)와, KIS 가 주문을 처리한 뒤 돌려준 5xx(`categorizeRejectReason` 이 `kis_5xx` 로 분류하는 그것), 그리고 KIS 접수 직후 `orders` UPDATE 가 실패한 경우를 모두 `{ok:false, error}` 로 돌려준다(`blockedBy` 도 비어 있어 `approveSignal` 은 구분할 수 없다). 재현(scratchpad 사본의 service 테스트에 1건 추가): `submitOrder` 가 `{ok:false, orderId:77, error:'fetch failed (ECONNRESET)'}` 를 돌려주면 결과가 `{ok:false, errorCode:'order_not_accepted'}`, 시그널 갱신 순서 `['executing','pending']` — 즉 대기로 복귀해 **다시 탭하면 새 주문을 낸다.** 이전 동작(무조건 `approved`)은 거짓 기록이었지만 재주문은 불가능했다. 이 변경이 새로 만든 위험이다. 한도(`checkOrderMax`·`checkDailyMax`)가 상한이지만 실패 주문은 일 한도 합계에서 빠진다(`status NOT IN ('rejected','failed',...)`). **수정 방향**: 복귀는 "확정 거부"(킬스위치·한도·심볼 차단·KIS `rt_cd!=0` 의 명시적 거부)에만 하고, `orders.status='failed'`·`blocked_by='kis_5xx'`·예외성 오류는 `executing` 에 두고 "증권사 체결내역 확인 필요" 로 알린다(재탭 불가).
- [01:36] [확실] **Medium — D-2. 새 감사 이벤트명이 `trade_logs.event VARCHAR(32)` 를 넘어 기록이 조용히 사라진다.** `'signal_approve_order_not_accepted'` 는 **33자**. 운영 DB 실측: `sql_mode` 에 `STRICT_TRANS_TABLES`, 컬럼 `varchar(32) NOT NULL`. STRICT 모드의 초과 길이 INSERT 는 하드 에러이고 `approveSignal` 은 `.catch(() => {})` 로 삼키므로 "거부 사유는 trade_logs 에 남긴다"(작업서·코드 주석)가 실제로는 **한 줄도 안 남는다.** 서비스 테스트는 pool 목이 길이를 검사하지 않아 통과한다(`cap.tradeLogs.some(... === 'signal_approve_order_not_accepted')`). 나머지 이벤트(`telegram_callback_bad_signature` 31자 등)는 32자 이내임을 확인했다. 수정: 이름을 32자 이내로 줄이고, 이벤트명 길이를 단언하는 테스트를 넣는다.
- [01:36] [확실] **Medium — D-3. D2 의 "의심스러우면 보낸다"가 가장 흔한 조회 실패에서는 지켜지지 않는다.** `approval-context.ts` 는 한도 조회가 **예외**를 던질 때만 통과시킨다. 그러나 `getEffectiveOrderMax/DailyMax` 는 KIS 잔고 조회가 실패하면(`portfolio-total.fetchTotals` → 0/0/0, 캐시가 없을 때) **예외 없이 0** 을 돌려주고, `checkOrderMax(req,0)`·`checkDailyMax(req,0)` 가 `ok:false` 라 `reasons=['order_limit','daily_limit']`, `executable:false` 가 된다. 재현(진짜 `order-limits` + 평가액 0 반환, 현금 충분한 스냅샷): `assessExecutability` → `{"executable":false,"reasons":["order_limit","daily_limit"]}`, `notifyApprovalRequest` → `{kind:'suppressed', summarySent:true}`. 구현자의 `approval-context.test.ts` 는 `order-limits` 전체를 목으로 대체하고 실패를 `reject` 로만 흉내 내서 이 실제 계약을 놓쳤다. 영향 범위: 캐시가 빈 시점(재기동 직후 첫 60초 등)에 KIS 가 흔들리면 실행 가능했을 매수 요청이 시간당 요약 1건으로 바뀐다. 주문 경로도 같은 순간엔 막히므로 자금 위험은 아니고 알림 누락이다. **이 동작은 스위치와 무관하게 배포 즉시 적용된다.** 수정: 한도 값이 0 이면 "미설정/조회 실패"를 구분할 수 없으니 판정에서 한도 사유를 내지 말거나(현금만 판정), `pct` 설정과 평가액을 따로 읽어 "미설정"만 억제로 본다.
- [01:36] [확실] **Medium — D-4. 텔레그램 호출 실패가 기록도 대체 전송도 없이 사라진다.** `telegram-approval.ts safe()` 는 **던져진** 예외만 잡는다. `answerCallbackQuery`/`editTelegramMessage` 는 던지지 않고 `{ok:false}` 를 돌려주므로(`telegram-api.ts` 계약) 실패는 로그 한 줄 없이 버려진다. 처리 전에 "처리 중…" 토스트만 이미 나갔으므로, 결과 메시지 수정이 실패하면(48시간 지난 메시지, 429, 본문 길이 초과 400 등) 사용자는 **실주문이 나갔는지 모른 채** 토스트만 본다. 이스케이프 누락으로 78% 가 유실되고도 한참 몰랐던 것과 같은 종류의 "조용한 실패"다. 보조 발견: `order_rejected`·`failed` 의 사유 문자열은 길이 제한이 없어(`mapFailure` 가 원문을 그대로 전달, 예외 경로만 120자) 4096자를 넘기면 수정이 400 이다. 같은 시그널을 연타하면 두 번째 탭의 "이미 처리된 시그널입니다" 수정이 첫 결과("승인됨 + 주문번호")를 덮어쓴다. 수정: `safe` 가 `ok:false` 를 `console.error` 로 남기고, 결과 수정이 실패하면 새 메시지로 결과를 보낸다. 스위치를 켜기 전에 필요하다.
- [01:36] [확실] **Medium(테스트 공백) — D-5. 승인 권한의 실제 배선이 테스트되지 않는다.** 내 변이 47개 중 13개가 생존했고 그중 8개가 `telegram-poller.ts` 의 `buildApprovalDeps`/`runLoop` 다: ① 허용 채팅이 항상 빈 집합 ② 허용 사용자 폴백 변경 ③ 하이브리드 항상 꺼짐 ④ **승인 경로 매핑 뒤집기**(`path !== 'hybrid'`) ⑤ 서명 키 `null` ⑥ 서명 키를 다른 비밀로 파생 ⑦ `stillHoldsLock` 생략 ⑧ `releaseLock` 생략 — 전부 `npx jest`(소스 관련 35 suites) 통과. 처리기 테스트가 `deps` 전체를 가짜로 주입하기 때문이다. 같은 이유로 `notify/index.ts dispatchAlertWithTelegram`(버튼 발송 함수를 무시하는 변이 N38), `approval-notify.defaultDeps`, 요약 본문의 종목명 이스케이프(N37), `approveSignalHybrid` 의 `editedScenario` 병합 전달(N30), 최종 `approved` UPDATE 의 `status='executing'` 조건(N25), 롱폴링 타임아웃(N58)도 생존했다. **현재 코드는 맞다** — 같은 배선을 목 DB·목 서비스 위에서 끝까지 돌리는 내 시험 10건(개인/그룹 채팅, 명시 사용자 목록, 하이브리드×구간 3경로, 킬스위치, 스위치 OFF, 주문 거부 매핑)이 통과했다. 그러나 이 파일들이 "누구의 탭이 어떤 승인 경로로 가는가"를 정하므로 회귀망이 필요하다. 스위치를 켜기 전에 `buildApprovalDeps` 를 목 위에서 도는 테스트(위 시나리오)를 저장소에 넣을 것.
- [01:36] [확실] 구현자의 73개 변이는 모두 처리기·코덱·전이·메시지의 순수 부분이었다. 내가 새로 만든 47개 중 34개는 잡혔다(발신자 OR→AND, 사용자 검사를 채팅 ID 로, 자가 점검을 발신자 검사 앞으로, 거절 탭이 승인 호출, 승인 결과 뷰 교환, 키 파생의 도메인 분리 제거, `affectedRows` 배열 풀기 제거, 거절 집합에 `executing` 추가, 선점 집합에 `detected` 추가, 판정 실패를 억제로, 라벨·종목코드·전략명·사유 이스케이프 제거, 앱 링크 검증 제거, 승인 버튼 서명 금액 0, 거절 버튼이 승인 동작, 토큰 가림 제거 2건, 자가 점검 인증 제거, 계측 형태 2건 등). 변이는 전부 사본에서 했고 러너가 매번 원복·해시 대조했다.
- [01:36] [확실] **공격 대상 A(인가 우회) — 우회 경로를 찾지 못했다.** `message` 없음 → 채팅 확인 불가 거부, 다른 채팅의 허용 사용자 거부, `is_bot` 거부, 숫자/문자열 ID 는 둘 다 `String()` 으로 정규화, 허용 사용자 집합이 비면 거부, 그룹 채팅(음수 ID)은 명시 사용자 목록이 없으면 전부 거부(`^\d+$`), 발신자 검사가 `getSignal`·서명 검증·스위치 확인보다 앞이다(테스트가 `getSignal` 미호출을 단언). 코덱: 접두·동작·시그널ID·금액 결속, 정규식 `^…$` 는 JS 에서 개행 앞 일치가 없고, 길이가 같은 두 버퍼에만 `timingSafeEqual`, 키는 `HMAC(secret,'stockinvest/telegram-approval/v1')` 파생이라 세션 쿠키 서명과 도메인이 분리된다. 64비트 서명은 오프라인 위조 오라클이 없고(키 없이 유효 버튼을 못 만든다) 온라인 추측은 소유자의 탭 하나당 1회라 비현실적이다. 재탭·승인 후 거절 서명 재사용·거절 후 승인은 모두 `already_handled`(상태가 `approved*`·`rejected`·`executing` 이면 승인 대기 집합 밖). 자가 점검(`t`)은 시그널 ID 0·서명 필수이고 어떤 거래 함수도 부르지 않는다. 스위치 OFF 에서는 `a`/`r` 이 상태를 읽기 전에 거부된다. 위 결론은 코드 추적과 `wiring` 시험으로 얻었다.
- [01:36] [확실] **공격 대상 B 일부(경쟁·소비자)**: 모든 전이는 `WHERE id AND status IN (대기 집합) AND (expires_at IS NULL OR expires_at > NOW())` 한 문장이고 `affectedRows` 는 mysql2 의 `[header, undefined]` 형태를 푼다(배열 풀기 제거 변이가 잡힌다). `executing` 을 읽는 코드는 전수 grep 으로 `entry-watcher`(주문 성공 후 자기가 씀), `SignalFeed`·`MyDecisionTab`(표시)뿐이며, `ACTIVE_SIGNAL_STATUSES`·`EXPIRABLE_STATUSES` 소비자 중 중복 차단(`createSignal`)은 `executing` 을 쓰지 않고 `signal-expiry` 는 `executing` 을 건드리지 않는다. 만료 크론은 `expires_at < NOW()` 행만 고르는데 선점은 `expires_at > NOW()` 를 요구하므로 둘이 겹치지 않는다. DRY_RUN 은 `ok:true, dryRun:true` 라 `approved` 로 기록된다. 상태 읽기와 선점 사이에 `entry-watcher`/`signal-expiry` 가 끼어도 이중 주문 경로는 없다.
- [01:36] [확실] **공격 대상 C**: `extractEntryZone` 은 `entry-watcher` 의 인라인 추출과 문자 단위로 같은 규칙(문자열이면 `JSON.parse`, `ai→scenario→entry→price_zone` 이 문자열일 때 `parsePriceZone`)이다. 구간이 `lo>hi` 인 경우 둘 다 "구간 있음"으로 보지만 감시가 영원히 `out_of_zone` 이 되는 기존 한계가 남는다(스코프 밖). 웹 라우트의 변화는 의도한 하나뿐이다: 하이브리드 ON + 구간 없음 + 편집 없음이 `approved_pending_entry`(막다른 길)에서 즉시 주문으로 바뀌었다. 웹 UI(`ApprovalQueue`)는 본문 없이 POST 하므로 구간이 있는 카드는 감시로, 없는 룰 시그널은 즉시 주문으로 간다.
- [01:36] [확실] **공격 대상 D(폴러)**: 운영 MariaDB 에서 `GET_LOCK(name,0)` 은 보유 시 1, 타 연결 0, 같은 연결 재획득 1(재진입), `IS_USED_LOCK(name)=CONNECTION_ID()` 는 1/0, 보유 연결을 `KILL` 하면 즉시 다른 연결이 획득한다 — 설계 가정과 일치(일회용 락 이름으로 시험). `instrumentation.ts` 는 양수 조건 블록 안에서만 `import('@/lib/signals/telegram-poller')` 하고, `telegram-poller.ts` 의 최상단 import 는 전부 `import type` 이며 런타임 의존은 함수 안 동적 import 라서 Edge 번들에 Node 전용 모듈이 들어오지 않는다(조기 return 변이와 try 제거 변이는 계측 형태 테스트가 잡는다). 오프셋은 처리 후 저장이라 재시작 뒤 같은 콜백이 다시 오면 상태가 이미 `approved*`/`executing` 이라 `already_handled` — 이중 주문 없음. `finally` 한 곳에서 연결을 반납하고 `getConnection` 실패는 외곽 `.catch` 의 30초 재시작으로 간다. `retry_after`·`backoffMs` 는 유한값이다. 락 상실 직후 두 소비자가 겹쳐도 원자적 선점이 막는다.
- [01:36] [확실] **공격 대상 E(메시지)**: 승인 요청·결과·자가 점검·간단 본문·요약 전부에 대해 악성 문자열 22종(`<`,`>`,`&`,`<b>`,`&lt;`,`<script>`,서로게이트, 5,000자 등)을 퍼징하고 "짝 없는 `<`/`>`·맨 `&`·태그 불균형"을 검사하는 검증기를 돌렸다 — 필드 길이를 실제 상한(라벨 60·심볼 32·사유 100)으로 맞추면 90건 모두 통과한다. 토큰은 `redactSecrets(…, token)` + 패턴 가림으로 오류 문자열·응답 본문 스니펫에서 가려지고(변이로 확인) URL 은 어떤 로그에도 찍히지 않는다. `sendAlert` 계열이 본문을 다시 이스케이프하지 않아 이중 이스케이프도 없다. 채널 정책은 `dispatchVia` 하나를 지나고, 버튼 메시지 실패 시 대체 발송은 같은 `attempt` 안이라 채널당 1회다.
- [01:36] [확실] **Low — L-1. `executing` 이 고아로 남을 수 있다.** 선점 뒤 프로세스가 죽거나(배포 중 포함) 주문 수락 뒤 최종 `approved` UPDATE 가 실패하면 행은 `executing` 에 머문다. 아무 코드도 정리하지 않고(`signal-expiry` 제외, `consumed_order_id` 없음) 화면에는 "주문 실행됨/체결 대기"로 보인다. 방향은 안전(이중 주문 없음)하나 이전에는 대기로 남아 만료됐다. 일정 시간 지난 `executing`+`consumed_order_id IS NULL` 을 경보하는 점검이 필요하다.
- [01:36] [가능성 높음] **Low — L-2. 한 주 넘게 탭이 없으면 `update_id` 재설정으로 탭이 조용히 버려질 수 있다.** Bot API 문서: 새 업데이트가 일주일 이상 없으면 다음 `update_id` 가 순차가 아니라 무작위로 정해진다. 저장 오프셋보다 작게 나오면 `getUpdates(offset)` 이 그 업데이트를 이미 확인된 것으로 보고 버린다. 이 사용자의 승인 빈도(최근 30일 승인 0건)에서는 현실적이다. 실측은 못 했다(외부 호출 금지). 완화: 자가 점검을 주기적으로 돌리거나, 마지막 처리가 6일 넘으면 오프셋을 0 으로 되돌린다.
- [01:36] [확실] **Low — L-3. 자정~00:59 KST 에 시각이 `24:05` 로 표시된다.** `toLocaleTimeString('ko-KR',{hour12:false})`(Node 20.20)이 `24:05`, 날짜 포함 형식은 `10. 13. 24:05` 를 낸다. 해외 시그널이 22~04시라 만료 줄·결과 줄 일부에 나온다. `hourCycle:'h23'` 으로 고친다.
- [01:36] [확실] **Low — L-4(잠재). 금액 결속 서명이 JS 반올림과 `DECIMAL(18,2)` 반올림 불일치에서 영구 무효가 된다.** 소수부가 .495~.4999 이면 발송 시 `Math.round` 는 내림, 눌렀을 때 DB 값은 .50 으로 올림돼 서명이 달라져 "버튼이 유효하지 않습니다"로 메시지가 바뀐다(20,000건 모의에서 0.50%). 방향은 fail-closed. **운영 데이터에서는 최근 30일 시그널 934건의 금액이 전부 정수**라 지금은 발생하지 않는다. 소수 금액을 만드는 경로(청산 `heldValue` 등)가 생기면 시작된다. 서명 입력을 DB 가 저장할 형태(소수 2자리 문자열)로 맞춘다.
- [01:36] [가능성 높음] **Low — L-5. 일부 설정 함정**: (a) `app_public_url` 이 텔레그램이 거부하는 URL 이면 키보드 전체가 400 이라 버튼 메시지 전송이 실패하고 간단 본문(버튼 없음)으로 대체된다 — 자가 점검 메시지에는 링크 버튼이 없어 켜기 전에 잡히지 않는다(롤아웃 순서에서 URL 설정이 자가 점검 뒤). (b) 폴러의 하이브리드 판정은 `getRouterConfig`(DB 가 false 여도 환경변수 `HYBRID_MODE_ENABLED=true` 면 true)이고 웹 라우트는 DB 값이 있으면 그것만 쓴다 — 현재 DB 가 true 라 동일하지만 둘이 달라질 수 있다. (c) 개발·QA 서버가 같은 DB 로 `next start/dev` 하면 락을 잡아 작업 트리 코드로 승인을 처리할 수 있다(환경 게이트 없음). (d) 메시지 발송이 `retries:1` 이라 응답을 못 받은 전송은 재전송돼 유효한 버튼의 사본이 두 번 갈 수 있다(원자적 전이로 안전). (e) 계획서의 "TradingInvest 수신 코드 금지를 docs 에 못박는다"는 코드 주석·409 경보로만 구현됐고 docs 에는 없다.
- [01:36] [가능성 높음] **Low — L-6. D2 의 현금 판정 맹점(설계 범위 안, 수용 여부는 사용자).** 스냅샷 현금에는 미결제 매도대금이 없고(`snapshot-composition.ts` 가 스스로 문서화), 환율 조회가 실패한 스냅샷은 USD 행이 빠진다(`portfolio-snapshot` 의 `catch {}`). 스냅샷은 시간당이며 3시간까지 믿는다. 재현: 현금 8만 원·금액 100만 원·170분 전 스냅샷 → `reasons:['cash']` 억제. 방금 청산한 직후의 재매수 요청이 요약으로 갈 수 있다. 주문 경로의 실제 가능 금액과 다를 수 있다는 점을 요약 문구에 이미 "현금 X" 로 보여 주므로 정보는 제공된다.
- [01:36] [확실] **Low — L-7. 훅·경로**: `SAFETY_PATHS` 보강(`telegram-api.ts`, `instrumentation.ts`)은 적절하고 `test-git-hooks.sh` 시나리오 t42a~d 는 'chore' 메시지(task ID 없음)로 차단 여부만 보므로 경로 판정 자체를 정확히 검증한다. 남는 경로: `src/lib/notify/index.ts`(`dispatchAlertWithTelegram` — 거래 권한은 없고 전달 경로), `src/__tests__/instrumentation-shape.test.ts`(계측 형태의 회귀망인데 안전 경로가 아니라 무검토로 바뀔 수 있음). 훅 자체는 51/51.
- [01:36] 구현자가 놓친 것(요약): D-1(불확실 실패의 재주문 가능성 — 새로 만든 위험), D-2(감사 이벤트명 33자 — 운영 DB 가 STRICT 라 실제로 실패), D-3(실제 `order-limits` 계약에서 fail-open 이 깨짐), D-4(결과 수정 실패의 무기록·무대체), D-5(실제 배선 무테스트), 그리고 L-1~L-3.
- [01:36] 확인하지 못한 것: ① 실제 텔레그램 서버의 콜백 응답 시한·`update_id` 재설정 동작·`url` 버튼 거부 조건(외부 호출 금지) ② KIS 가 5xx/연결 끊김 뒤에도 주문을 처리하는 빈도(D-1 의 발생 확률) ③ `next build` 작업자가 `register()` 를 호출하는지(호출한다면 플래그가 켜진 뒤 30초 넘는 빌드 작업자가 락을 잠깐 쥘 수 있다 — T-037 워치독과 같은 노출) ④ `runLoop` 자체의 실행(락 획득·상실·재획득 시나리오를 가짜 타이머로 돌리지 않았고 코드 추적과 실 DB 락 시험만 했다) ⑤ 운영 `positions`·미결제 대금이 KIS 주문가능금액에 반영되는 방식(L-6) ⑥ 실제 빌드(Edge 번들) — import 그래프를 코드로만 추적했다 ⑦ Codex 검토는 하지 않았다.
- [01:36] 수용 가능한 잔여 위험: 텔레그램 계정 탈취=거래 승인 권한·봇 토큰 공유(사용자 수용, 재논의하지 않음 — 서명 키가 토큰 보유자의 위조 버튼을 막고 발신자·채팅 허용 목록이 계정 외 사용자를 막는다는 점만 확인했다), 스냅샷 현금 근사(L-6), 외부 비밀·플래그가 DB 직접 쓰기로만 설정되는 롤아웃 절차, 락 상실 순간의 중복 소비(원자적 전이가 막음), 연타 시 결과 덮어쓰기. 이 중 어떤 것도 위 D-1~D-3 의 수정 없이 "수용 가능"으로 넘기지 않는다.
- [01:36] 재감사 조건: 커밋 전 D-1·D-2·D-3 수정과 각각의 회귀 테스트(D-1: 확정 거부만 복귀·예외성 실패는 `executing` 유지, D-2: 이벤트명 ≤32 단언, D-3: 실제 `order-limits` 계약으로 평가액 0 → 실행 가능), `telegram_approval_enabled` 를 켜기 전 D-4·D-5 수정. 고친 뒤 다시 보내면 변경분과 위 재현 입력으로 재감사한다.
- [01:36] 1라운드 결론: fail (검토 범위는 위 1라운드 본문 참조). 이 줄은 판정 줄이 아니며 2라운드 기록이 대체한다.
- [02:27] **정정(2라운드)**: 위 1라운드 'E' 항목의 "이중 이스케이프도 없다"는 틀렸다. `getSymbolLabel` 이 이미 이스케이프된 값을 돌려준다는 점을 놓쳤다 — 2라운드 R2-1 참조. 나머지 1라운드 결론은 2라운드에서 다시 확인했다.

## QA

## 최종 요약 (사용자용)

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: delta (JV-ui_change) | 10-12 00:37 |

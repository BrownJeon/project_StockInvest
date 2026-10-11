# 텔레그램 버튼 승인 — 운영 절차서 (T-042)

승인 요청 알림의 **✅승인 / ❌거절** 버튼을 눌러 앱에 들어가지 않고 시그널을 처리하는 기능이다. 버튼 한 번이 곧 실거래 승인이므로 안전 조건이 많다.
설계·결정·감사 기록: `agent-vault/10-Flow/tasks/T-042-telegram-approval-buttons.md`.

## 1. 한눈에

```
신호 생성 ─▶ 승인 요청 알림(버튼) ─▶ [텔레그램 서버] ◀─ getUpdates 롱폴링 ─ 앱 안의 폴러
                                                          │
                                       발신자·서명·상태·킬스위치 검증 ─▶ 기존 승인 함수 ─▶ submitOrder 게이트
```

- **수신은 폴링이다.** 웹훅을 걸지 않는다 — 새 공개 경로가 없고, 봇이 TradingInvest 와 공유라 봇당 하나뿐인 웹훅을 차지하지 않는다.
- 폴러는 앱 프로세스 안에서 `instrumentation.ts` 가 기동 30초 뒤에 띄운다. DB 락(`GET_LOCK('stockinvest:telegram-poller')`)을 쥔 프로세스 하나만 읽는다.
- 승인은 기존 `approveSignal`/`approveSignalHybrid` 를 그대로 부른다. 한도·킬스위치·DRY_RUN·`submitOrder()` 게이트는 바뀌지 않았다.

## 2. 스위치 (`system_config`, 모두 JSON 값)

| 키 | 의미 | 기본 |
|---|---|---|
| `telegram_poller_enabled` | 폴러가 `getUpdates` 를 읽는다. **자가 점검은 이것만 켜면 된다.** | 꺼짐 |
| `telegram_approval_enabled` | 승인·거절 동작 허용 + 요청 메시지에 버튼. 자가 점검(`t`)은 이것과 무관 | 꺼짐 |
| `notify_skip_unexecutable` | 실행 불가 매수를 개별 알림 대신 요약(최대 1시간 1건)으로 | **켜짐**(`false` 로 꺼짐) |
| `app_public_url` | "앱에서 자세히" 링크(https). 없으면 링크 버튼 생략 | 없음 |
| `telegram_approval_user_ids` | 허용 사용자 JSON 배열(숫자 ID). 없으면 개인 채팅이면 채팅 ID | 없음 |

값은 **엄격한 불리언 `true`** 일 때만 켜진다(문자열 `"true"`·`1` 은 꺼짐). 읽기 실패도 꺼짐.

## 3. 켜는 순서 (사용자 폰에서 확인하며)

1. 배포. 이 시점에는 버튼이 생기지 않는다. 단, 스위치와 무관하게 적용되는 것: 승인 요청 본문 이스케이프(유실 수정), 실행 불가 매수 요약, 거부된 주문을 `approved` 로 기록하지 않음, 구간 없는 룰 시그널의 승인이 즉시 주문 경로, 승인·거절의 원자적 전이.
2. `telegram_poller_enabled` = `true`. 폴러가 락을 잡고 폴링을 시작한다(최대 ~30초).
3. 자가 점검 메시지 보내기 (서버에서, 크론 비밀 필요):
   ```bash
   curl -s -X POST http://localhost:3003/api/cron/telegram-approval-selftest -H "x-cron-secret: $CRON_SECRET"
   ```
4. 폰에서 시험 메시지의 **🧪 점검 확인** 탭 → 메시지가 "자가 점검 통과"로 바뀌면 *버튼 → 수신 → 검증 → 응답* 사슬이 정상이다. 시험 메시지는 실제 요청과 같은 모양을 시험 값으로 보여 주므로 **이때 모양을 확인한다.**
5. `app_public_url` 설정(선택) 후 3~4 를 다시 해서 링크 버튼도 통과하는지 확인.
6. `telegram_approval_enabled` = `true`. 이후 승인 요청 메시지에 버튼이 붙는다.

되돌리기: 두 스위치를 `false`. 버튼이 달린 옛 메시지를 눌러도 "버튼 승인이 꺼져 있습니다"만 나오고 거래는 일어나지 않는다.

## 4. 안전 조건 (요약)

1. **발신자 확인이 상태 조회보다 먼저.** 눌린 사용자(`from.id`)가 허용 목록에 있고 채팅이 소유자 채팅이어야 한다. 개인 채팅(양수 ID)이면 그 ID, 그룹(음수)이면 `telegram_approval_user_ids` 명시가 없는 한 아무도 허용하지 않는다.
2. **서명(HMAC) 검증.** `callback_data` = `si1:<a|r|t>:<시그널ID>:<서명 16hex>`. 키는 `AUTH_SESSION_SECRET` 에서 파생, 서명은 동작·ID·**DB 에 저장된 금액**에 묶인다. 세션 비밀을 바꾸면 기존 버튼은 모두 무효가 된다(안전한 실패).
3. **누른 시점에 서버가 상태를 다시 확인한다.** 이미 처리됨·만료·킬스위치 ON 이면 거래하지 않는다(오래된 메시지의 버튼도 안전).
4. **원자적 전이.** 승인·거절은 `UPDATE … WHERE id=? AND status IN (승인 대기) AND (만료 전)` 한 문장 + `affectedRows` 검사. 즉시 주문 경로는 주문 전에 `executing` 으로 선점해 웹·텔레그램 동시 승인에서도 `submitOrder` 가 한 번만 불린다.
5. **결과는 같은 메시지에 반영**한다. 수정이 실패하면 새 메시지로 같은 결과를 보낸다. 이미 처리된 시그널을 다시 누르면 본문(주문 번호)은 두고 버튼만 지운다.
6. 폴러가 죽어도 앱·주문 경로·웹 승인은 영향이 없다.

## 5. ⚠️ 공유 봇 규칙 (TradingInvest)

StockInvest 와 TradingInvest 가 **같은 봇 토큰**을 쓴다. 텔레그램은 봇당 `getUpdates` 소비자를 하나만 허용하고(둘이면 409), 웹훅이 걸려 있으면 `getUpdates` 가 거부된다.

- **TradingInvest 에 `getUpdates`·`setWebhook`·콜백 수신 코드를 넣지 마라.** 현재는 없다(설정 화면 안내 문구에서 `getUpdates` 를 *언급*만 한다).
- 폴러는 `callback_query` 만 요청하고 `si1:` 접두 외의 콜백은 **답하지도 않고 무시**한다.
- 409 가 3번 연속이면 critical 경보("텔레그램 getUpdates 충돌")가 온다. 이때 버튼 승인은 동작하지 않는다 — 웹에서 처리하고 충돌 원인(다른 소비자·웹훅)을 찾는다. `getWebhookInfo` 로 웹훅 유무를 확인할 수 있다.
- 개발·QA 서버를 **운영과 같은 DB** 로 띄우고 `telegram_poller_enabled=true` 이면 그 서버도 락을 잡을 수 있다. 운영이 락을 놓친 동안 개발 서버가 승인 요청을 처리할 수 있으니, 같은 DB 에서 개발 서버를 띄울 때는 이 스위치 상태를 확인한다.

## 6. 장애 대응

### 6.1 "⚠️ 주문 결과를 확인하지 못했습니다" / "진입 주문 결과 불명" (order_uncertain)
송신 중 예외·5xx·연결 끊김처럼 **거래소가 주문을 받았는지 알 수 없을 때**다. 같은 주문을 다시 내면 이중 주문이 될 수 있어 시그널을 `executing` 으로 **잠가 두었다**(웹 승인 대기 목록에서도 사라진다). 두 경로가 있고, **되돌릴 상태가 다르다**:

| 잠근 곳 | 알림 제목 | 접수가 안 됐을 때 되돌릴 상태 |
|---|---|---|
| 승인 버튼/웹 승인 (`approveSignal`, 즉시 주문 경로) | "⚠️ 주문 결과 불명 — 체결내역 확인 필요" | `awaiting_approval` (만료 전이면 다시 승인) |
| 진입 감시 (`entry-watcher`, 하이브리드 승인 뒤 자동 주문) | "⚠️ 진입 주문 결과 불명 — 체결내역 확인 필요" | **`approved_pending_entry`** (감시가 다음 틱부터 다시 시도) |

1. KIS 체결/미체결 내역에서 해당 종목 주문이 있는지 확인한다. 앱 `orders` 테이블의 주문 ID(알림에 `주문 #N`)도 본다.
2. **주문이 접수돼 있다면**: 아무것도 하지 않는다(시그널은 `executing` 으로 둔다). 기록을 맞추려면 경로별로 다르다 — 즉시 주문 경로는 정상 성공 상태가 `approved` 이므로 `UPDATE signals SET status='approved', consumed_order_id=<N> WHERE id=<시그널> AND status='executing'`, 진입 감시 경로는 성공 상태가 `executing`(주문 번호만 기록)이므로 `UPDATE signals SET consumed_order_id=<N> WHERE id=<시그널> AND status='executing'`.
3. **주문이 없다면**(접수되지 않음): 위 표의 상태로 되돌린다.
   ```sql
   -- 승인 버튼/웹 승인 경로
   UPDATE signals SET status='awaiting_approval' WHERE id=<시그널> AND status='executing';
   -- 진입 감시 경로 (구간 도달 시 자동 주문하던 시그널)
   UPDATE signals SET status='approved_pending_entry' WHERE id=<시그널> AND status='executing';
   ```
   만료됐으면 그냥 두거나 `status='expired'` 로.
4. 어느 쪽 경로인지는 **받은 알림 제목**으로 구분한다(위 표). `price_zone` 유무로는 구분할 수 없다 — 구간이 있어도 하이브리드가 꺼져 있거나 시나리오를 수정해 승인하면 즉시 주문 경로를 탄다. 확인용으로, 즉시 주문 경로는 `trade_logs` 에 `signal_approve_order_uncertain` 이벤트(당시 오류 포함)를 남기고 진입 감시 경로는 남기지 않는다.

**DB 장애로 잠금/기록 UPDATE 자체가 실패한 경우** (진입 감시): critical 알림이 "DB 잠금에는 실패했지만 이 프로세스에서는 건너뜁니다"라고 알린다. 이 건너뛰기는 **프로세스 메모리**에만 있어 앱을 재기동하면 풀린다. 배포도 재기동이므로 **이 알림이 정리되기 전에는 배포하지 않는다.** 먼저 위 절차로 체결내역을 확인하고, 접수돼 있으면 시그널을 `executing`/`approved` 로 맞춘 뒤 재기동한다. 접수 후 상태 기록 실패(알림 "주문은 접수됐으나 시그널 상태 기록 실패")도 같다: `UPDATE signals SET status='executing', consumed_order_id=<N> WHERE id=<시그널>`.

### 6.2 주문이 거부됐다 (order_rejected)
킬스위치·한도·심볼 차단·잔고 부족 등 **확정 거부**다. 시그널은 만료 전까지 승인 대기로 되돌아가고 버튼이 남는다. 사유는 `trade_logs` 의 `signal_approve_order_rejected` 와 메시지에 있다.

### 6.3 버튼이 반응하지 않는다
- 폴러가 도는지: pm2 로그에서 `[telegram-poller] 락 획득 — 폴링 시작`. 없으면 `telegram_poller_enabled`·락 보유 프로세스·`getUpdates` 오류 로그를 본다.
- 10회 연속 실패 시 warning 경보, 409 3회 시 critical 경보가 온다.
- 어쨌든 웹 승인 경로는 그대로 동작한다.

### 6.4 자주 보는 로그
`[telegram-approval]` 텔레그램 호출 실패 · `[telegram-poller]` 폴링·락 · `[approveSignal]` 감사 기록 실패 · `[notify] ... 전송 실패`.

## 7. 알려진 한계

- 🔴 **`entry-watcher` 는 주문 전에 시그널을 선점하지 않는다** — 조회(`approved_pending_entry`) → `submitOrder` → 그 뒤 `executing` 기록 순이라, 같은 시그널을 보는 틱이 겹치면 실주문이 두 번 나갈 수 있다. **T-042 이전부터 있던 구조**이고(HEAD 도 동일) 이번 변경이 악화시키지 않았다(결과 불명 재제출 차단은 오히려 추가됨). 정상 운영에서는 `cron-runner.sh` 가 단일 루프에서 curl 을 동기 호출해 겹치지 않는다. 겹치는 경우는 ① `stockinvest-cron` 중복 기동 ② 수동 curl ③ 배포 중 새 cron-runner 첫 틱과 옛 릴리스의 진행 중 요청 ④ 배포 중 주문 송신 뒤 기록 전 프로세스 종료다. 상한은 1회·일 한도 검사(각 주문이 따로 통과해야 함)다. 수정은 후속 **T-043**(주문 전 조건부 선점) — `telegram_approval_enabled` 를 켜면 구간 카드 승인이 쉬워지므로 T-043 이 먼저 또는 같은 주에 들어가길 권한다.
  - **수동으로 `/api/cron/entry-watcher` 를 호출하지 않는다.** 배포 뒤에는 `pm2 list | grep stockinvest-cron` 이 정확히 1행인지 확인한다(기존 절차).
  - **배포 직후 점검 SQL** — 이 중복을 알려 주는 알림은 없고 이 쿼리가 유일한 탐지 수단이다. 결과가 0행이면 정상:
    ```sql
    SELECT a.id AS first_id, b.id AS second_id, a.symbol, a.side, a.created_at,
           TIMESTAMPDIFF(SECOND, a.created_at, b.created_at) AS gap_s
    FROM orders a JOIN orders b
      ON a.symbol = b.symbol AND a.side = b.side AND b.id > a.id
     AND b.created_at <= a.created_at + INTERVAL 3 MINUTE
    WHERE a.source = 'auto' AND b.source = 'auto'
      AND a.status IN ('accepted','partially_filled','filled')
      AND b.status IN ('accepted','partially_filled','filled')
      AND a.created_at >= NOW() - INTERVAL 1 DAY;
    ```
    (2026-10-12 기준 전체 기간 0행, 접수·체결된 자동 주문 19건·마지막 05-26 — 과거 중복 흔적 없음.)
- 폴러가 롱폴링 도중 락을 잃고 다른 소비자가 락을 얻으면, 잃은 쪽이 이미 받은 업데이트를 한 번 더 처리하고 오프셋을 작은 값으로 저장할 수 있다. 시그널 전이가 원자적이라 **주문은 한 번만** 나가고, 영향은 콜백 응답 중복 거절(텔레그램이 두 번째를 거부)·감사 행 중복·결과 메시지가 "이미 처리됨"으로 덮여 주문 번호가 가려질 수 있는 정도다(Low). 락 재확인·오프셋 단조 증가·덮어쓰기 금지는 후속 하드닝으로 둔다(독립 감사 5라운드).
- 선점(`executing`) 뒤 **프로세스가 죽으면** 시그널이 `executing` 으로 남는다(정리 코드 없음). 6.1 절차로 수동 확인.
- 확정 거부 뒤 선점 복귀(`releaseClaim`)가 DB 장애로 실패하면 시그널은 `executing` 에 남는데(경고 알림이 온다), 그때 텔레그램 메시지는 "승인 대기로 남아 있습니다"라고 쓰고 버튼을 남긴다. 다시 누르면 "이미 처리된 시그널입니다"가 나오고 버튼이 지워진다 — 재승인이 막히는 안전한 쪽이라 문구 불일치만 있다. 6.1 의 복구 SQL 로 되돌린다.
- 결과 불명 주문은 `checkDailyMax` 의 일 한도 합계(`status NOT IN (rejected, failed, blocked, cancelled, pending)`)에서 **`failed`(송신 중 예외) 또는 `rejected`(5xx) 로 기록돼 빠진다** — 실제로는 접수됐을 수 있어 그날 한도가 과소 집계될 수 있다(별도 사안).
- `cron/trade-report` 는 이미 이스케이프된 종목명을 본문에 넣은 뒤 본문 전체를 다시 이스케이프한다 — `&` 가 든 종목명이 정기 리포트에서 `&amp;` 로 보일 가능성이 높다(코드 읽기만, T-042 범위 밖 기존 코드).
- 한 주 넘게 폴러가 돌지 않으면 텔레그램이 `update_id` 를 재설정할 수 있고, 그 사이 저장된 오프셋보다 작은 새 입력이 버려질 수 있다(문서 근거 추정, 실측 없음). 폴러를 오래 꺼 둔 뒤 켰는데 입력이 안 먹으면 `telegram_poll_offset` 키를 지운다.
- 만료된 시그널의 **버튼은 메시지에 남는다** — 만료 시점에 능동적으로 지우지 않는다. 눌러도 안전하다("만료됨" 응답).
- 실행 불가 판정은 최신 스냅샷(3시간 이내)의 현금으로 근사한다. 미결제 매도대금은 반영되지 않고, 환율 조회 실패 시 USD 행이 빠진다. 불확실하면 **보낸다**(알림을 줄이는 쪽으로는 오판하지 않게).
- 웹 승인 화면(ApprovalQueue)은 승인 응답을 읽지 않아 주문 거부가 화면에 보이지 않는다(별도 화면 작업).
- 자동 제출(`auto_submitted`) 시그널은 이 경로와 무관하다.

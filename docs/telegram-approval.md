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
| `notify_skip_unexecutable` | 켜짐: 지금 실행할 수 없는 매수(현금 부족·한도 소진·1회 한도)는 **알림을 보내지 않는다**(요약도 없음, 서버 로그 `[approval-notify] 실행 불가 매수 알림 생략` 1줄만). 시그널은 앱 승인 대기 목록에 그대로 있다. `false`: 실행 불가여도 개별 승인 요청을 보낸다. 매도·판정 실패는 항상 보낸다 (T-044) | **켜짐**(키 없음 또는 정확히 `true` 일 때만 생략 — 그 밖의 값·읽기 오류는 보낸다) |
| `app_public_url` | "앱에서 자세히" 링크(https). 없으면 링크 버튼 생략 | 없음 |
| `telegram_approval_user_ids` | 허용 사용자 JSON 배열(숫자 ID). 없으면 개인 채팅이면 채팅 ID | 없음 |

> **`notify_skip_unexecutable` 운영 메모 (T-044, T-058 에서 해석 수정)**
> - 생략은 **키 없음 또는 JSON 불리언 `true`** 일 때만이다. `false`·`"false"`(문자열)·`"true"`(문자열)·`0`·`null`·파싱 불가·읽기 오류는 모두 "불확실 → 보낸다"(T-044 Codex low 반영. 예전에는 `!== false` 로 읽어 `"false"`·`0`·`null` 이 생략을 켰다).
> - 생략 로그 위치: 앱 프로세스 `stockinvest` 의 표준 출력 `/home/brownjeon/apps/stockinvest/shared/logs/pm2-out.log`(`ecosystem.config.js` 의 `out_file`). 건수 확인: `grep '실행 불가 매수 알림 생략' /home/brownjeon/apps/stockinvest/shared/logs/pm2-out.log` — 줄 형식 `[approval-notify] 실행 불가 매수 알림 생략: signal <번호> <종목> reasons=<cash|daily_limit|order_limit,…>`(금액·잔고 수치 없음). 앱 승인 대기 목록과 대조한다.
> - **현금 부족은 이제 앞 단계에서 걸러진다(T-058)**: 실시간 현금이 사이징된 주문 전체 비용(수량 × 지정가 × 1.002)에 못 미치는 매수는 시그널 자체가 만들어지지 않는다(아래 §2.1). 여기(알림 단계)에 남는 현금 사유는 실시간 현금을 몰랐던(unknown) 시그널에 대해 스냅샷이 부족을 말한 경우뿐이다.
> - **알려진 한계(남음 — 사용자 결정 사항)**: **한도(일 한도 소진·1회 한도) 사유로** 알림이 생략된 시그널은 행이 남아 있어서, 유효시간(30분) 안에 한도가 풀려도 다시 알림이 오지 않는다 — 같은 종목·방향의 활성 시그널이 있으면 새 시그널이 만들어지지 않기 때문이다(`service.ts` 중복 방지). 그 시그널은 앱 승인 대기 목록에서 승인할 수 있고, 만료 후 다시 발화하면 새 알림이 간다. T-058 은 이 부분을 고치지 않았다. 현금 판정(알림 단계)은 최대 3시간 된 스냅샷 × 0.5 비율이다.

### 2.1 시그널 생성 현금 게이트 (T-058)

매수 시그널을 만들기 **전에** 실시간 가용 현금을 본다(`src/lib/signals/signal-cash-gate.ts`, `createSignal` 의 블랙리스트 검사 뒤·중복 검사 앞). 현금이 사이징된 주문 전체 비용(수량 × 지정가 × 1.002 — 5주 주문이면 5주 값)에 못 미치면 **시그널 행·RAG 색인·텔레그램/슬랙 승인 요청을 아무것도 만들지 않는다.** 승인 대기·자동 제출·manual(detected) 경로 모두 같다. 매도는 대상이 아니다.

| 키 (`system_config`) | 의미 | 기본 |
|---|---|---|
| `signal_cash_gate_domestic_enabled` | 국내 매수 게이트 — 국내 KRW 예수금(`prvs_rcdl_excc_amt`, T-051 과 같은 값·30초 캐시) | **켜짐**(키 없음) |
| `signal_cash_gate_overseas_enabled` | 해외 매수 게이트 — USD 예수금(`cash.USD`, T-056). 필요 USD = 수량 × (원화 지정가 ÷ 환율을 주문 어댑터와 같게 반올림한 단가) × 1.002 (반올림은 `roundToTickOverseas` — $1 이상은 **정수 달러**, 의도된 동작: 사용자 결정 10-21) | **켜짐**(키 없음) |

- 값 해석: **키 없음·JSON `true` = 켜짐. 그 밖의 모든 값(`false`·문자열·`0`·`null`·파싱 불가)과 읽기 오류 = 꺼짐(막지 않음).** 30초 캐시라 바꾸면 최대 30초 뒤 반영된다(재시작 불필요).
- 판정: 필요 금액 = 수량 × 호가 추격 반영 지정가 × 1.002(주문 사이징 `buildOrderRequest` 와 같은 값). 현금이 **엄격히 적을 때만** 막는다(같으면 통과). 해외는 센트 단위 비교.
- **모르면 막지 않는다**: 잔고 조회 실패·8초 초과·USD `unknown`/`not_queried`·환율 없음/1시간보다 오래됨/상식 범위 밖·시장가·수량 미확정/1주 미만·값 이상·스위치 읽기 오류·게이트 내부 예외 → 기존대로 시그널을 만든다. 환율은 `fx_rates` 의 `USD_KRW` 행 나이로 판단하며 `fx.ts` 의 폴백 값(오래된 DB 값·`FX_USDKRW_FALLBACK`·1380)은 쓰지 않는다.
- 로그(`pm2-out.log`, 알림 채널로는 보내지 않음, 금액·잔고 수치 없음):
  - `grep '\[signal-cash-gate\] 현금 부족 매수' …/pm2-out.log` — 건너뜀. (시장·종목·방향)마다 **1시간 1회**만 찍고 `suppressed_since_last=<n>` 에 그 사이 억제된 건수를 싣는다. 같은 내용이 `trade_logs` 에 `event='signal_cash_gate_skip'` 으로 남는다(payload: market·symbol·side·reason·suppressedSinceLast).
  - `[signal-cash-gate] 현금 판단 불가 — 막지 않고 기존대로 생성: market=… reason=…` — (시장·사유)마다 1시간 1회. 해외가 계속 `usd_unknown`·`fx_stale` 이면 해외 게이트가 사실상 일을 못 하고 있다는 뜻이다.
  - `[signal-cash-gate] 스위치 꺼짐 — 점검 생략` / `[signal-cash-gate] 점검 통과(현금 충분)` — 시장마다 1시간 1회(배포 직후 게이트가 살아 있는지 확인용).
  - 스로틀은 프로세스 로컬이다 — 재시작(배포)하면 창이 새로 시작한다. 지금 이 코드는 `stockinvest` 프로세스에서만 돈다(`stockinvest-cron` 은 bash 가 HTTP 로 라우트를 부른다).
- 엔진 퍼널(`eval_funnel`)에는 평가마다 gate `insufficient_cash`·verdict `skip` 행이 남는다(국내·해외는 행의 `market` 으로 구분). 오류(`error`) 집계에는 올라가지 않는다.
- `POST /api/signals` 는 이 경우 HTTP 200 + `{ ok:false, skipped:true, reason:'insufficient_cash' }` 를, `POST /api/analyst/run` 은 `skipped` 목록에 `reason:'insufficient_cash'` 를 돌려준다.
- **알려진 위험**: USD 예수금이 0 이면 해외 매수 시그널이 전부 만들어지지 않는다. 이 계좌의 원화 통합증거금 여부는 10-21 KIS 매수가능금액 조회(읽기 전용 1회)로 확인했다 — 원화 예수금을 합쳐도 최대 주문가능수량이 늘지 않아 원화로는 해외 매수가 안 되는 계좌로 보인다([가능성 높음]). 그래도 원화로 받는 것으로 드러나면 살 수 있는 시그널까지 막히므로 그때는 `signal_cash_gate_overseas_enabled` 를 `false` 로 둔다. 해외 주문 금액(100만원대)이 예수금보다 크면 시그널이 만들어지지 않는 것이 정상 동작이다. 현금이 들어오기 전에 발화한 시그널은 남지 않는다(입금 후 같은 조건이 다시 발화하면 새로 만들어진다). 미체결 매수 주문이 묶은 현금은 조회 값에서 빠지지 않는다(그때는 "충분"으로 보고 만든다 — 막는 쪽으로 틀리지 않음).
- **알려진 한계 (T-058 Reviewer·Codex C2, 고치지 않음)**:
  - **해외 가용액 = 예수금**(`frcr_dncl_amt_2`)이지 구매력이 아니다. 미결제·재사용 가능 매도대금이 빠져 있을 수 있다(미결제 포함 여부는 관측 전). "매도 후 같은 날 재매수"에서 KIS 가 받아 줄 매수를 "현금 부족"으로 막을 수 있다 — 막는 쪽 오차이며 손실 경로는 아니다. 첫 해외 매도 직후 `frcr_dncl_amt_2` 와 `ustl_sll_amt_smtl` 을 대조해 정의를 확정한다(T-056 단계 4).
  - **후보 여러 건의 합계는 보지 않는다.** 30초 캐시를 공유하는 후보가 각각 현금 이하이면 모두 통과한다(예: 현금 15만, 필요액 10.02만짜리 두 건 → 둘 다 생성). 전부 승인하면 일부는 KIS 가 잔고 부족으로 거부한다. 승인되지 않을 시그널이 현금을 점유하면 막으면 안 될 것을 막게 되어 예약·차감은 하지 않았다.
  - 엔진 퍼널 `insufficient_cash` 행은 룰이 재발화하는 틱마다 남는다(스로틀은 로그·`trade_logs` 에만 적용). 운영 실측(10-21): `eval_funnel` 은 하루 약 8천~1.3만 행이고 30일 보존 삭제가 있다. 모든 매수 후보가 매 틱 막히는 최악이어도 하루 수백 행(기존의 약 3~10%)이고, 시그널이 안 만들어지면 진입 쿨다운이 안 걸려 기존 `cooldown_entry`·`signal_created` 행을 대체하므로 실제 순증은 더 작다.
  - 로그의 `suppressed_since_last` 는 다음 발화가 있어야 찍히므로 마지막 창의 억제 건수는 기록되지 않는다(하한 값).
- 되돌리기: 두 키를 `false` 로(DB, 재시작 불필요) → 필요하면 커밋 revert. 해외만 끄는 예(국내는 키 이름만 `signal_cash_gate_domestic_enabled` 로). 다시 켜려면 값을 `true` 로 두거나 행을 지운다:

  ```sql
  INSERT INTO system_config (`key`, value) VALUES ('signal_cash_gate_overseas_enabled', 'false')
    ON DUPLICATE KEY UPDATE value = VALUES(value);
  ```

값은 **엄격한 불리언 `true`** 일 때만 켜진다(문자열 `"true"`·`1` 은 꺼짐). 읽기 실패도 꺼짐. (예외: `notify_skip_unexecutable` 와 §2.1 의 게이트 키 두 개는 **키 없음도 켜짐**이다 — 그 밖의 해석은 같다.)

## 3. 켜는 순서 (사용자 폰에서 확인하며)

1. 배포. 이 시점에는 버튼이 생기지 않는다. 단, 스위치와 무관하게 적용되는 것: 승인 요청 본문 이스케이프(유실 수정), 실행 불가 매수 알림 생략(T-044 — 이전의 시간당 요약은 제거됨), 현금 부족 매수는 시그널 자체를 만들지 않음(T-058 §2.1, 키 없음 = 켜짐), 거부된 주문을 `approved` 로 기록하지 않음, 구간 없는 룰 시그널의 승인이 즉시 주문 경로, 승인·거절의 원자적 전이.
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

**진입 감시 경로는 주문 전에 시그널을 먼저 `executing` 으로 선점한다(T-043).** 그래서 ① 결과 불명이면 알림이 오기 전에 이미 잠겨 있고 ② 주문 번호 연결(`consumed_order_id`)이 DB 장애로 실패해도 시그널은 `executing` 에 남아 **재주문이 없다** — 알림 "주문은 접수됐으나 주문 번호 기록 실패"(warning) 또는 결과 불명 알림 본문의 안내대로 위 2번의 SQL 로 주문 번호만 맞추면 된다. 선점 복귀가 실패한 경우(알림 "진입 감시 선점 복귀 실패", warning)는 주문이 나가지 않았음을 확인한 뒤 위 3번의 진입 감시 SQL 로 되돌린다. 주문 결과를 받은 **뒤** 알림·포지션 기록 같은 후처리에서 예외가 나면 선점은 그대로 두고(재주문 방지) 알림 "진입 주문 후처리 예외"(warning)가 온다 — 주문 결과와 포지션 기록을 확인한다. 잠금은 DB 에 있으므로 앱을 재기동하거나 배포해도 풀리지 않는다 (T-042 시절의 "이 프로세스에서만 건너뛰기"는 없어졌다).

### 6.2 주문이 거부됐다 (order_rejected)
킬스위치·한도·심볼 차단·잔고 부족 등 **확정 거부**다. 시그널은 만료 전까지 승인 대기로 되돌아가고 버튼이 남는다. 사유는 `trade_logs` 의 `signal_approve_order_rejected` 와 메시지에 있다.

### 6.3 버튼이 반응하지 않는다
- 폴러가 도는지: pm2 로그에서 `[telegram-poller] 락 획득 — 폴링 시작`. 없으면 `telegram_poller_enabled`·락 보유 프로세스·`getUpdates` 오류 로그를 본다.
- 10회 연속 실패 시 warning 경보, 409 3회 시 critical 경보가 온다.
- 폴러는 정상인데 입력만 안 먹으면 §7 의 `update_id` 재설정 항목을 본다 — `system_config` 의 `telegram_poll_offset` 행을 지운다.
- 어쨌든 웹 승인 경로는 그대로 동작한다.

### 6.4 자주 보는 로그
`[telegram-approval]` 텔레그램 호출 실패 · `[telegram-poller]` 폴링·락 · `[approveSignal]` 감사 기록 실패 · `[notify] ... 전송 실패` · `[approval-notify] 실행 불가 매수 알림 생략`(T-044) · `[signal-cash-gate]`(T-058 §2.1 — 현금 부족 건너뜀·판단 불가·스위치 꺼짐·점검 통과).

## 7. 알려진 한계

- ✅ **`entry-watcher` 의 "주문 전 선점 부재"는 T-043 에서 해결됐다**(2026-10-18). 조회 → **조건부 선점(`executing`)** → `submitOrder` 순이라 같은 시그널을 보는 실행이 둘이어도(cron 앱 2개·수동 호출·배포 중 끊김 후 새 인스턴스) 선점에 이긴 쪽만 주문한다. 선점하지 못하면(경합·만료·DB 오류) **주문하지 않는다**(결과 `claim_lost`, 또는 `order_failed` + detail `claim_failed:`). `claim_lost` 는 선점 패배와, 만료 UPDATE 가 0행일 때(다른 실행이 이미 처리했거나 DB 시각 기준 아직 유효) 둘 다에 쓰인다 — 어느 쪽인지는 detail 로 구분. 확정 거부와 송신 전 예외만 `approved_pending_entry` 로 되돌려 다음 틱에 다시 시도하고, 성공·결과 불명은 `executing` 을 유지한다.
  - `client_order_id` 는 여전히 호출마다 랜덤이라 DB 수준 멱등성은 없다 — **방어는 이 선점 UPDATE 한 문장**이다. 그래서 `entry-claim.ts` 의 WHERE 조건을 바꾸는 변경은 안전 경로 감사 대상이다.
  - 수동으로 `/api/cron/entry-watcher` 를 호출하는 것은 이제 안전하지만(선점이 막는다) 불필요하다. 배포 뒤에는 `pm2 list | grep stockinvest-cron` 이 정확히 1행인지 확인한다(기존 절차).
  - 점검 SQL(선택): 같은 종목·방향의 접수·체결 자동 주문이 3분 안에 둘 이상이면 이중 주문의 신호다. 결과가 0행이면 정상:
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
    (참고: 이 질의에서 `created_at` 조건을 빼고 전체 기간으로 돌렸을 때 0행 — `accepted`/`partially_filled`/`filled` 상태의 자동 주문 17건·마지막 2026-05-27 00:18, 과거 중복 흔적 없음. 2026-10-18 재확인.)
- (T-047 이전 동작) 폴러가 롱폴링 도중 락을 잃고 다른 소비자가 락을 얻으면, 잃은 쪽이 이미 받은 업데이트를 한 번 더 처리하고 오프셋을 작은 값으로 저장할 수 있다. 시그널 전이가 원자적이라 **주문은 한 번만** 나가고, 영향은 콜백 응답 중복 거절(텔레그램이 두 번째를 거부)·감사 행 중복·결과 메시지가 "이미 처리됨"으로 덮여 주문 번호가 가려질 수 있는 정도다(Low). **T-047 로 하드닝했다**: 락 재확인(`getUpdates` 직후·매 저장 뒤) · 오프셋 단조 증가 저장 · 전이에 진 쪽은 본문을 덮지 않고 버튼만 지움 · 처리가 끝난 업데이트의 오프셋은 락을 잃어도 저장(단조라 더 큰 값을 되돌리지 못함). **남은 창**: 새 소유자가 이전 소유자의 저장 **전에** 오프셋을 읽고 그 뒤에 선점하면, 확정 거부로 선점이 풀린 입력에 한해 두 번째 주문 시도가 가능하다(수백 ms 창, 이중 체결은 아님). 근본 해결은 `callback_query.id` 별 처리 기록(후속 과제).
- 선점(`executing`) 뒤 **프로세스가 죽으면** 시그널이 `executing` + 주문 번호 없음으로 남는다(정리 코드 없음) — 즉시 주문 경로와 진입 감시 경로 모두. 재주문은 없다. T-046 전에는 **알림도 오지 않았다**(위험의 방향이 "이중 주문"에서 "주문 누락 + 무음"으로 바뀐 것이 T-043 의 실제 트레이드오프다). **T-046 이후**에는 진입 감시 틱(장중)이 10분 넘게 주문 번호 없이 멈춘 `executing` 을 critical 로 경보한다(스로틀 키는 멈춘 시그널 ID 집합별 1시간, 본문 시각은 KST). 장외에는 점검하지 않으므로 아래 SQL 로 직접 찾아 6.1 절차로 확인할 수도 있다:
  ```sql
  SELECT id, symbol, side, status, updated_at FROM signals
   WHERE status = 'executing' AND consumed_order_id IS NULL AND updated_at < NOW() - INTERVAL 10 MINUTE;
  ```
- **분할 진입 게이트의 의미 차이 (T-043, 좁은 경우)**: 같은 group 의 2회차 이후는 이전 회차가 `approved_pending_entry` 인 동안 대기한다. 선점 때문에 이전 회차가 주문 중에는 `executing` 이라 게이트가 열린다 — 단일 실행자(정상 운영)에서는 전과 같지만, 실행자가 둘이면 1회차 주문 도중에 2회차가 풀릴 수 있고, 1회차 복귀 UPDATE 가 DB 오류로 실패해도 2회차가 풀린다(경고 알림은 나간다).
- 확정 거부 뒤 선점 복귀(`releaseClaim`)가 DB 장애로 실패하면 시그널은 `executing` 에 남는데(경고 알림이 온다), 그때 텔레그램 메시지는 "승인 대기로 남아 있습니다"라고 쓰고 버튼을 남긴다. 다시 누르면 "이미 처리된 시그널입니다"가 나오고 버튼이 지워진다 — 재승인이 막히는 안전한 쪽이라 문구 불일치만 있다. 6.1 의 복구 SQL 로 되돌린다.
- 결과 불명 주문은 `checkDailyMax` 의 일 한도 합계(`status NOT IN (rejected, failed, blocked, cancelled, pending)`)에서 **`failed`(송신 중 예외) 또는 `rejected`(5xx) 로 기록돼 빠진다** — 실제로는 접수됐을 수 있어 그날 한도가 과소 집계될 수 있다(별도 사안).
- `cron/trade-report` 는 이미 이스케이프된 종목명을 본문에 넣은 뒤 본문 전체를 다시 이스케이프한다 — `&` 가 든 종목명이 정기 리포트에서 `&amp;` 로 보일 가능성이 높다(코드 읽기만, T-042 범위 밖 기존 코드).
- 한 주 넘게 봇에 업데이트가 없으면(폴러가 꺼져 있었든, 켜져 있어도 입력이 없었든) 텔레그램이 `update_id` 를 재설정할 수 있고, 그 사이 저장된 오프셋보다 작은 새 입력이 버려질 수 있다(문서 근거 추정, 실측 없음). 폴러를 오래 꺼 둔 뒤 켰거나 오래 안 눌렀는데 입력이 안 먹으면, 또는 봇 토큰을 교체했으면 `telegram_poll_offset` 키를 지운다(T-047 의 단조 증가 저장은 값을 낮추지 않으므로 코드로는 복구되지 않는다).
- 만료된 시그널의 **버튼은 메시지에 남는다** — 만료 시점에 능동적으로 지우지 않는다. 눌러도 안전하다("만료됨" 응답).
- 실행 불가 판정은 최신 스냅샷(3시간 이내)의 현금으로 근사한다. 미결제 매도대금은 반영되지 않고, 환율 조회 실패 시 USD 행이 빠진다. 불확실하면 **보낸다**(알림을 줄이는 쪽으로는 오판하지 않게).
- 웹 승인 화면(ApprovalQueue)은 승인 응답을 읽지 않아 주문 거부가 화면에 보이지 않는다(별도 화면 작업).
- 자동 제출(`auto_submitted`) 시그널은 이 경로와 무관하다.

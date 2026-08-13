---
tags:
  - type/board
---
# 칸반 보드

> 재개 진입점: [[RESUME]] · 진단·설계 전문: [[2026-08-02-restructure-plan]]

## Backlog

- **[신규, T-021 파생, Low] 트레일링 활성화 표시가 실제 발화 기준과 다르다 + 기준값이 세 곳에 흩어져 있다**
  `ScenarioAnalysis.tsx:209` 가 `+{ai.exit.trailing_activate_pct ?? 0}%` 로 렌더해 값이 없으면 **"+0%"** 라고 말하는데, **실제 발화 기준은 그 값이 아니다.**
  ✅ **먼저, 안심할 근거**(T-021 Developer 조사, 코드 확인됨): `entry-watcher/route.ts:317-322` 가 `position_state.scenario_exit` 에 넣는 건 `targetLo/targetHi/stopLo/stopHi` **4개뿐**이고 `ScenarioExitParams` 에 트레일링 필드가 아예 없다. 실제 발화는 `exit-engine.ts:146` 의 **전역 `style.trailingActivatePct`(기본 2.5)** 가 담당한다. → **시나리오 JSON 에 이 필드가 없어도 트레일링은 정상 동작한다. 조용히 꺼지는 매매 로직 공백은 없다.**
  ❗ **남은 문제**: ① 화면은 "+0%" 라 하고 실제는 2.5% — **표시와 실동작 불일치**(운영자가 트레일링이 꺼진 줄 알 소지) ② 기준값이 **세 곳에 흩어짐** — 시나리오 JSON / 전역 `style` / `positions/status/route.ts:7` 하드코딩 `2.5`. **단일 출처로 모으면서 함께 정리할 것.**
  상세: [[T-021-recommend-detail-client-crash]] §6.1

- **[신규, T-021 파생, Low] `ScenarioAnalysis.tsx` 가 API 응답을 생산자 타입으로 신뢰한다**
  `scenario-builder` 의 **생산자 타입 `ScenarioCard`(전 필드 required)** 로 분석 API 응답을 받아 `ai.exit.trailing_activate_pct` 같은 무가드 접근이 남아 있다. T-021 이 없앤 것과 **같은 클래스**지만, 이 경로("추천 → 내 시나리오 만들기")는 DB 에 쌓인 임의 JSON 이 아니라 **같은 요청 안에서 서버가 방금 만들어 돌려준 값**이라 신뢰 근거가 다르고 크래시 신고도 없어 범위에서 뺐다.
  **승격 조건**: 분석 API 가 부분 응답을 낼 수 있게 바뀌거나, 이 화면에서 크래시가 관측되면 즉시. 상세: [[T-021-recommend-detail-client-crash]] §6.2

- 🔴🔴 **[신규, T-018 감사 H-5 — 해외주문량 재개 *전에* 처리할 것] `settledStatus` 가 체결수량 증거를 무시하고 부재만으로 `filled` 를 쓴다 → 손익 계산까지 왜곡**
  → **2026-08-11 착수: [[T-019-partial-fill-false-filled]]** (아래 원문은 근거로 보존)
  "조회 신뢰가능" 분기에서 미체결 목록에 없다는 이유만으로 `filled` 를 기록한다. **하필 H-4(B) 가 "정상"이라고 분류한 바로 그 이벤트**(장마감 시 미체결 잔량 자동취소)에서, 부분체결된 매도주문이 **"완전 청산"으로 오기록**된다.
  **파급이 주문상태에서 안 끝난다**: `executions` 테이블이 역사상 **0행**이라 `trade-report.ts` 가 항상 주문수량 전체를 체결수량으로 계산한다 → **FIFO 원가·실현손익이 왜곡**된다. 즉 "얼마 벌었나"가 틀리게 나온다.
  **현재 노출 0** — order-sync 대상 0건, 역대 `partially_filled` 0건.
  **트리거**: 킬스위치 해제로 주문이 다시 흐르고 **해외 주문량이 실제로 늘기 시작하기 전에** 처리한다. 부분체결이 한 건이라도 생기는 순간부터 손익 장부가 조용히 틀어진다.

- 🔴 **[신규, T-018 파생] 해외 주문 수량이 소수점으로 생성돼 조용히 축소집행된다 — 사이징 단계에서 고칠 것**
  → **2026-08-11 착수: [[T-020-fractional-order-quantity-sizing]]** (아래 원문은 근거로 보존)
  `kis-overseas.ts:340` 이 전송 직전 `Math.floor` 로 절삭하므로 **KIS 는 소수점을 본 적이 없고**, DB 에만 원래 소수점 수량이 남는다(그래서 T-018 H-4(A) 의 비교 불일치가 생겼다).
  **실측(2026-08-10, Leader)**: 소수점 수량 주문 **79건**, 전부 해외 지정가. 발생기간 04-30~05-16. 실패사유는 `kis_5xx` 38 · `(null)` 31 · `order_limit` 9 · **`kis_rejected` 단 1건** — 즉 "브로커가 거부한다"는 설명은 근거가 약하고, 대부분 **레이트리밋으로 죽고 있었을 뿐**이다. **T-017 이 그 레이트리밋을 없앴으므로 이제 성공하기 시작한다.**
  **두 갈래 실害**: ① **11건은 1주 미만**(예 `0.794325`) → 절삭하면 **0주**, 명백히 성립 불가 ② 나머지는 **평균 16.8%·최대 49.9% 자본이 조용히 축소집행**되고 DB 엔 원래 수량이 남아 의도와 실제가 영구히 어긋난다.
  **수정 지점 2곳(reviewer 지적)**: `service.ts:119`, `entry-watcher/route.ts:238` — **둘 다** 고쳐야 한다. 한쪽만 고치면 다른 경로로 계속 생성된다.
  **방향**: 사이징 시점에 floor + 0주면 주문 스킵. ⚠️ **스킵은 반드시 흔적을 남길 것** — 조용히 건너뛰면 우리가 T-007·T-012·T-014·T-018 내내 없애온 그 침묵을 사이징 단계에서 재현하는 것이다. 스키마에 `submitted_quantity` 를 추가하는 건 그 다음에 판단한다(선 사이징 수정, 후 스키마).
  **선행 확인**: 05-16 이후 소수점 주문이 없다 — 사이징 동작이 이미 바뀌었을 수 있으니 **현재도 재현되는지 먼저 확인**하고 착수한다.
  → ✅ **확인 완료(2026-08-11)**: **재현된다.** 사이징 코드는 그대로였고, 소수점 주문이 멎은 것은 **해외 주문 흐름 자체가 멎어 있었기 때문**(06월 이후 해외 주문 0건)이다. 상세는 [[T-020-fractional-order-quantity-sizing]] §선행 확인 결과.

- **[신규, T-019 파생] 시장가 주문의 부분체결은 여전히 검증되지 않는다**
  `settleDecision` 은 `market` 주문에 수량 검증을 걸지 않는다(의도적). 근거: 시장가는 미체결 목록에 **원래 나타나지 않아** 종결 판정의 근거가 없고, 5분 주기가 **체결 진행 중 스냅샷**을 잡으면 중간값이 영구히 박힌다 — 드문 과대계상을 없애려다 매 회차 과소계상을 만든다. **승격 조건**: 시장가 주문의 잔량을 확인할 수단(체결 폴링·잔고 대조)이 생기면 그때 다룬다.

- **[신규, T-019 파생] `executions` 동시 기록 + "체결 건별 다행" 설계를 함께 풀 것**
  `recordSettledFill` 의 SELECT-then-INSERT 가 원자적이지 않아 동시 실행(수동 force 트리거 + cron, 배포 중 잔류 요청)에서 주문당 2행이 생길 이론적 여지가 있다. **`UNIQUE(order_id)` 로 막지 않기로 했다**(Leader 판단) — 그러면 "주문당 1행"이 스키마에 못박혀 **장래에 실제 체결 건별로 여러 행을 기록하는 자연스러운 설계가 영구히 봉쇄**되기 때문이다. 지금의 "1행 누적"은 편의적 선택이지 최종형이 아니다. 락 기반 대안 3종(`INSERT…WHERE NOT EXISTS` / `FOR UPDATE` / `GET_LOCK`)은 각각 격리수준 의존·주문경로 락경합·커넥션풀 누수 위험으로 기각. 대신 `detectDuplicateExecutions()` **런타임 탐지기**를 넣었다.
  **승격 트리거**: `ORDER_SYNC_EXEC_DUPLICATE` 가 **1회라도 관측되면** 즉시. 올바른 최종형은 `fetchOrderRows` 를 `SUM(e.quantity)`·가중평균 price 로 바꾸고 `(order_id, executed_at, price, quantity)` 자연키로 중복을 거르는 것 — 그러면 ①동시성과 ②건별 기록이 함께 풀린다.


- **[신규, T-019 파생, Low] `executions` INSERT 실패 시 보류 사유 라벨이 부정확**
  T-018 의 per-order catch 로 흘러 `both_queries_failed` 가 붙지만 실제로는 **조회 성공 + 쓰기 실패**다(`detail` 에는 진실이 담긴다). `UnreconciledReason` 에 `'write_failed'` 를 추가하는 것은 T-018 계약 표면을 넓히는 일이라 하지 않았다. 기존 UPDATE 실패도 같은 문제라 **일관되기는 하다.** 사유별 대응이 달라지는 시점에 함께 정리.

- 🔴 **[신규, T-018 MED-4 파생 — 별도 과제 가치 있음] 구조적으로 해결 불가능한 hold 에 30분마다 critical 경보가 영원히 반복된다**
  **이건 우리가 오늘 밤 내내 없애온 침묵(T-007·T-012·T-014·T-018)이 정반대 경로로 돌아오는 것이다** — 영원히 울리는 경보는 사람을 무시하도록 훈련시키고, 결국 진짜 신호가 묻힌다. 알림 설계의 핵심 실패모드.
  **현재 코드가 이미 일부는 옳게 하고 있다**: `active_coverage_gap` 은 `order-sync:stale` 에서 제외되고 6시간 `warning` 으로 나간다 — 재시도로 못 고치는 것을 재시도 주기로 알리는 건 정보량이 0이기 때문.
  **남은 문제는 "전이"다**: 현재 구조는 사유가 고정이라고 가정하는데, `active_query_failed` 가 30분→6시간→3일 지속되면 그건 더 이상 일시적 실패가 아니라 **구조적 상태**인데도 경보는 계속 일시적 실패의 문구로 반복된다.
  **제안된 방향**(developer, 미구현): N회 반복(예: 4회=2시간) 후 **문구가 다른 "이제 구조적 상태다" 경보를 1회만** 보내고 키를 잠금 → 정상 정리 성공 시 해제해 다음 발생은 처음부터 다시 알림. **level-triggered 가 아니라 edge-triggered.** 그리고 "몇 건이 며칠째 판단 불가인가"는 **반복 경보가 아니라 대시보드**에 있어야 한다 — 경보는 *변화*를, 화면은 *상태*를 나른다.
  **왜 T-018 에서 안 했나**: `notify/throttle.ts` 는 **킬스위치·낙폭 경보도 함께 쓰는 공유 코드**라, 여기서 알림 의미론을 바꾸면 T-018 의 폭발반경을 넘는다. 알림 정책 전체를 설계하는 별도 과제로 다룰 것. **범위 판단은 타당함(Leader 동의).**

- **[신규, T-018 MED 잔여] 그 외 감사 지적 4건 + LOW 6건**
  ① 해외 커버리지갭 계약 위험 ② 취소·정정 시 KIS 가 새 주문번호를 발급하는데 미반영(원 `odno` 는 `orgn_odno` 에 보존됨 — `kis-domestic.ts` 주석 참조) ③ 판단불가 타이머가 **프로세스 메모리**라 배포 버스트 중 리셋(오늘 restarts 339 — 배포마다 pm2 reload) ④ 파싱 실패 시 살아있는 주문이 목록에서 사라지는 경우.
  상세·재현조건은 [[T-018-order-sync-fail-closed]] 백로그 섹션 참조.

- **[신규, T-017 델타감사 F-1] 30초 데드라인이 `kisFetch` 호출 전체가 아니라 `acquire` 1회만 보장한다**
  재시도마다 **새 데드라인이 부여**되므로 한 번의 `kisFetch` 최악 소요는 ~91초 이상이 될 수 있다. 크론 틱 자체에는 여전히 전체 시간상한이 없다. HIGH-2 가 막은 것은 "무기한 정지"이고, "합계 상한"은 아직 없다.
  **수정 방향**: 호출 단위 전체 예산(overall deadline)을 두고 재시도가 그 예산을 공유하게 하거나, 크론 틱에 상한을 건다. M-3(크론 wall-clock 전환)과 함께 다루면 자연스럽다.

- **[신규, T-017 델타감사 F-3] 해외 USD 현금 조회 실패가 조용히 0 으로 떨어진다**
  방향은 fail-safe(현금을 과소평가 → 신규 매수 보수적)라 위험하지 않으나, **조용하다.** 실패했는데 "현금 0"으로 읽히면 원인 추적이 불가능하다. 로그 추가 권고.

- **[신규, T-017 델타감사 (d)] `collectCandidates` 레인 — 심볼별 분리가 올바른 최종형태 (지금은 하지 말 것)**
  현행 `normal` 유지가 맞다는 것이 델타감사 결론이다. 근거: ① 주문 게이팅 잔고조회는 애초에 `critical` 이라 이 스캔이 지연시킬 수 없다 ② `collectCandidates` 는 **순차 for-loop** 라 스캔에서 동시에 나가는 요청이 최대 1개, 대시보드와 겹쳐도 지연 ~200ms ③ **결정적**: `getEvalSymbols()` 가 보유종목을 강제 포함시켜 후보 0건이어도 **트레일링·시간만료·시나리오 청산 신호가 이 루프에서 나온다**(`engine.ts:1285` 주석). 루프 전체를 `bulk` 로 감싸면 HIGH-1 이 막으려던 문제를 좁게 재현한다.
  **올바른 최종형태**: 루프 전체가 아니라 **보유종목이 아닌 심볼만 `bulk`** 로 분리.
  **착수 시점**: 지금은 실측 경합이 없어 이득 없이 검증사이클만 다시 연다. **속도값을 올리거나 · 사용자가 늘거나 · M-3 로 cron-runner 를 wall-clock 스케줄러로 바꿀 때**(그 시점에 위 ②의 순차성 전제가 깨진다) 착수한다.

- **[신규, T-017 파생 — 지연] 주문이 진행 중인 `bulk` 레인 fetch 를 상속해 수 초 지연될 수 있다**
  `portfolio-total.ts` 의 in-flight 중복제거가 **먼저 시작된 요청의 레인을 그대로 상속**시킨다. 주문 경로가 이미 진행 중인 `bulk` 요청에 편승하면 critical 레인의 우선순위를 잃는다. **거부가 아니라 지연**이라 심각도는 MEDIUM.
  **수정 위치·방향**: `portfolio-total.ts` — 중복제거 시 대기자 중 최고 우선순위로 레인을 승격하거나, critical 호출자는 중복제거를 우회. 근거: [[T-017-kis-rate-limit-throttle]] reviewer 감사.

- ✅ **[해결됨 — 2026-08-11, [[T-018-order-sync-fail-closed]]] `order-sync.ts` 의 `getActiveOrders` 실패가 이중으로 삼켜져 살아있는 주문이 `cancelled` 로 오기록된다**
  → T-018 이 정확히 이 결함(여섯 겹 실패 삼킴)을 fail-closed 로 전환하며 해소했다. 실측(2026-08-11): `kis-domestic.ts`/`kis-overseas.ts`/`kis.ts` 어디에도 아래에 서술된 `.catch(()=>[])` 패턴이 더 이상 없다(주석도 "기존엔 삼켰다"로 과거형 전환됨). **이 항목은 board.md 정리 누락으로 T-018 배포 이후에도 남아 있던 잔재였다.** 원문은 이력 보존용으로만 아래에 남긴다.
  ⚠️ **정정**: T-017 스로틀은 이 버그를 **만들지 않았고, 트리거 빈도를 오히려 줄인다**(레이트리밋 실패 자체가 줄어들므로). 위에 적었던 "T-017 이 새 트리거를 추가한다"는 표현은 과장이었다 — 새 에러 2종이 이 경로로 흐를 수는 있으나 순증가는 아니다. 그럼에도 **이 버그 자체의 심각도가 높아** 백로그 최우선으로 올린다: 거래소에 살아있는 실주문을 DB 가 `cancelled` 로 오기록하면 중복 주문·미청산 포지션으로 직결된다.
  기존 버그이며 T-014 와 **같은 유형**(실패를 빈 결과로 둔갑). 조회가 실패하면 "활성 주문 없음"으로 읽혀 실제로 거래소에 살아있는 지정가 주문이 DB 에서 `cancelled` 처리될 수 있다.
  **T-017 이 새 트리거를 만든다**: `KisThrottleQueueFullError`·`KisThrottleTimeoutError` 가 이 경로에서도 발생할 수 있다. 스로틀 배포 후 발생 확률이 올라간다.
  **수정 방향**: `.catch(()=>[])` 제거 → fail-closed(모르면 `cancelled` 로 쓰지 않는다). T-014 의 `{known:false}` 패턴 재사용.

- **[신규, T-017 이 드러낸 기존 구조 문제] 크론 루프가 경과시간이 아니라 반복횟수로 주기를 센다**
  `cron-runner.sh` 가 "5분마다"를 **루프 반복 5회**로 구현한다. 반복 1회가 60초보다 길어지면 `strategy-eval` 의 실제 주기가 늘어나고 **장중 부하에서 누적**된다. 스로틀이 만든 문제가 아니라 원래 있던 구조가 이번에 처음 드러난 것.
  또한 크론 최악 지연 추정치 정정: 156초 → **~175~180초**(15분 주기 작업이 겹칠 때).
  **수정 방향**: 반복횟수 대신 벽시계 기준(`date +%s` 비교)으로 스케줄링.

- ✅ **[해결됨 — 2026-08-09~10] KIS 레이트리밋으로 `price=0` 스냅샷이 안전장치 기준값을 오염시킨다**
  아래 원본 항목은 [[T-012-zero-price-snapshot]](4계층 가드 + 오염행 16건 아카이브 후 삭제, 현재 **0건**)와 T-014(`BalancesIncompleteError` — 부분 실패를 빈 결과로 둔갑시키지 않음, `/api/portfolio` 스냅샷 쓰기 제거)로 **해결**됐다. 중앙값 되먹임 우려도 실측 결과 정상상태가 아니었음이 밝혀졌다(진짜 원인은 대시보드 기록이 hourly 기록기를 밀어낸 crowding-out). 근본 원인인 레이트리밋 자체는 [[T-017-kis-rate-limit-throttle]] 에서 처리 중. **이력 보존용으로만 아래 원문을 남긴다.**

- ~~🔴 **[신규, 안전계층 영향] KIS 레이트리밋으로 `price=0` 스냅샷이 저장돼 안전장치 기준값을 오염시킨다**~~
  **증상**: KIS `EGW00201`(초당 거래건수 초과) 발생 시 잔고 조회가 **부분 성공**한다 — 일부 종목이 `price=0, value_krw=0` 으로 들어오고, 총액이 실제의 **약 26%** 로 붕괴한 채 `portfolio_snapshots` 에 INSERT 된다.
  **실측(2026-08-09)**: 30일 585건 중 **3건 오염**, 전부 `4,828,256원`(실제 `18,375,740원`). 3건 모두 **T-011 배포 직후**(15:45·16:01·16:05) — 마이그레이션의 라이브 `tokenP` 호출이 캐시 토큰을 무효화하면서 레이트리밋 버스트를 유발했다. 이 값이 현재 **30일 최소값**이다.
  **sanity 가드가 일부만 막는다**: `15:47:10` 한 건은 `ratio=0.19x` 로 거부했으나 나머지 3건은 저장됐다. 가드가 **24h 중앙값** 기준이라, 오염된 행이 들어갈수록 중앙값이 내려가 **가드가 스스로 약해지는 되먹임**이 있다.
  **🔴 안전계층 영향 (핵심)**: `portfolio_snapshots.total_krw` 는 단순 표시값이 아니다 —
  · `kill-switch.ts:75-87` 24h drawdown 기준선 · `volatility-guard.ts:86/94/142` · 주문한도(`order_max_pct` 는 포트폴리오 총액의 %)
  두 방향 모두 위험하다: 오염행이 **현재값**이면 `-74%` 로 보여 **Kill Switch 오발동**(전 매매 정지), 오염행이 **기준선**이면 실제 폭락을 **놓친다**.
  **수정 방향(설계 필요)**: ① 부분 실패한 잔고 조회는 스냅샷을 아예 쓰지 않는다(종목 중 `price=0` 이 하나라도 있으면 INSERT 거부) ② sanity 가드를 중앙값 되먹임에 면역이 되게(직전 정상값 대비, 또는 오염행 제외 중앙값) ③ 기존 오염 3행 정리 여부 판단
  경위: [[T-011-owner-account-migration]] 배포 검증 중 Leader 발견. 화요일 Phase 2 관측 완료 시 함께 논의.

- **[신규, 함정 제거] `.env` 의 KIS 자격증명이 낡은 채 남아 있음** — 엔진은 `system_config.cred_*` 를 쓰고 `.env` 값은 무시된다(2026-08-09 해시 대조로 4개 전부 불일치 확인). 읽는 코드가 없어 무해하나 **다음 사람이 원천으로 착각할 함정**이다. 삭제하거나 "사용되지 않음 — `system_config.cred_*` 참조" 주석 추가. 상세: [[credential-source-of-truth]]

- **[신규, 보안 — 심각도 조건부] `login/route.ts` 의 `maskEmail` 미이스케이프 알림 인젝션**
  로그인 잠금 경보(`sendAlert('warning', …)`)에 `maskEmail(email)` 을 이스케이프 없이 넣는다. `isValidEmail` 은 **공백만** 막고 `<` `>` `|` `:` `/` 는 전부 통과시킨다.
  **심각도는 알림 채널 설정에 따라 달라진다** (2026-08-09 Leader 실측):
  | 조건 | 심각도 | 결과 |
  |---|---|---|
  | **Slack OFF (현재 상태)** | **LOW** | 텔레그램이 깨진 HTML로 400 → **경보 자체가 유실**. 공격자가 자기 브루트포스 경보를 침묵시킴 |
  | Slack ON | **MEDIUM** | `ab@<https://evil.com\|ClickHere>` 가 `isValidEmail` 통과 → **클릭형 피싱 링크**가 관리자 경보에 렌더. `<!channel>` 대량 멘션도 가능 |
  **현재 실측**: `notify_channel = "telegram"`, `SLACK_WEBHOOK_URL` 미설정 → **오늘은 LOW**.
  ⚠️ **Slack 을 켜는 순간 MEDIUM 으로 승격된다.** Slack 활성화를 검토하는 사람이 이 티켓을 먼저 처리해야 한다 — 그때는 이 조건을 아무도 기억하지 못할 것이기 때문이다.
  **수정**: `escapeAlertText()`(T-010 신설, 테스트 완비) 를 call site 에 적용 — 1줄 + import. 인증 경로라 별도 리뷰 필요.
  경위: developer 가 T-010 범위 밖으로 올바르게 플래그 → 사용자가 별도 task 분리 결정 → reviewer 가 LOW 판정했으나 그 근거("공백 필요해서 링크 불가")가 **Slack 문법에는 거짓**임을 developer 가 실측으로 정정. 상세: [[T-010-signup-request-email]]
- **[신규, 인프라] StockInvest가 독립 체크아웃에서 빌드 불가** — `package.json`의 `file:../shared/auth-oauth`가 **같은 NFS 트리 안에서만** 해석된다. 배포 스크립트가 같은 트리에서 `git reset --hard`를 하기 때문에 현재는 동작하지만, 리포를 **별도 위치에 클론하면 `npm ci`가 실패**한다. 리포가 더 이상 자기완결적이지 않음 (2026-08-08 developer 발견)
- **[신규, 인프라] `shared/` 디렉토리가 버전 관리되지 않음** — `shared/auth-oauth`가 어떤 git 저장소에도 속하지 않는데 StockInvest·TheRoute·bjj-trainning 세 프로젝트가 **같은 NFS 실체를 심볼릭 링크**로 공유한다. 여기를 고치면 배포·리뷰·롤백 없이 세 프로젝트에 즉시(다음 재시작 시) 반영된다. git 저장소 편입 또는 최소 백업·변경이력 절차 필요. 상세: [[T-009-oauth-login]]

- **[신규, 주문상태 무결성] `/api/safety/cancel-all` 라우트 2건** ([[T-007-telegram-silent-failure]] reviewer 발견, 라우트 자체는 미수정)
  1. 최상위 SELECT에 try/catch 부재(`route.ts:14`) → DB 실패 시 구조화된 `{ok:false,error}`가 아니라 **Next의 HTML 500 페이지**가 반환된다. T-007이 UI 쪽은 막았으나 서버측 관측성은 여전히 약함
  2. **더 실질적**: per-order try/catch(22~44행)가 `kis.cancelOrder()`와 뒤따르는 `UPDATE orders`/`INSERT trade_logs`를 **함께** 감싼다 → 거래소 취소는 성공했는데 DB 쓰기가 던지면 그 주문이 `cancel_failed`로 기록된다. **실제로는 취소된 주문이 미취소로 남는 상태 불일치.** T-007과 방향이 반대(거짓 실패)이고 pre-existing이라 별도 task 필요

- **[신규, 후속 정리] `res.ok` 미검사 핸들러 일괄 점검** — [[T-007-telegram-silent-failure]] 전수 조사에서 5곳 발견. #1(킬스위치/DRY_RUN 토글)·#5(비상 전체취소)는 T-007에서 처리. 남은 3곳: `toggleHybridMode`(PATCH hybrid) · `OrderDetail.tsx:69`(주문취소 실패해도 완료 콜백) · `ScenarioDetail.tsx:308`(거절 실패해도 navigate). 코드베이스 관례는 `res.ok`가 아니라 **body의 `ok`** 검사이며, T-007의 `patchSetting()`이 둘 다 검사하는 상위집합이므로 이를 표준으로 통일할 것
- **[신규, 보류 — 별도 리뷰 필요] 안전 키 검증 부재** — `PATCH /api/settings/safety`가 `dryRun`/`killSwitch`/`orderMaxPct`/`dailyOrderMaxPct`를 **검증 없이** 저장한다. T-007에서 `reportChannel`/`reportMode`만 검증 추가함. 라이브 안전 경로의 동작을 바꾸는 변경이라 인접 작업에 태우지 않고 **자기 근거를 갖춘 별도 리뷰** 필요

- **[신규, 정책] `agent-vault/`가 `.gitignore`에 없어 커밋해야만 살아남는 구조** — `deploy-stockinvest.sh`의 `git clean -fdx`가 미추적 파일을 삭제한다. 커밋 대상으로 계속 둘지 별도 백업 경로를 둘지 정책 결정 필요 (2026-08-05 leader 발견)
- **[신규, Medium] 배포 스크립트가 라이브 디렉토리에서 in-place 빌드 + `instances=1`** — `npm ci`/`build` 구간(수십초~수분) 동안 구 워커가 트래픽을 받으며, 형제 워커가 없어 크래시 시 자동재시작 루프 가능. 헬스체크는 있으나 **자동 롤백 없음**. 장기 대책: 별도 디렉토리 빌드 후 원자적 스왑 (2026-08-05 reviewer 발견)

- Phase 3 — 페이퍼 트레이딩·성과 실측 (executions simulated 기록, 룰별 승률·EV 대시보드, 비용 모델 config화)
- Phase 4 — 백테스트 검증 루프 (야간 cron, validation_status, 실주문 전제조건 코드화)
- Phase 5 — DRY_RUN 해제 준비 (KIS 체결내역 폴링 → executions real, 해제 체크리스트)
- 문서 SSOT 재작성 (제품 사양 1페이지 + 전략 사양) — stale 문서 정리(기획서_V0.1, phases/*, trading-strategy.md 코인 전략)
- AI 채팅(/ai)·LoRA export 제거 — 사용자 결정에 따른 정리
- `AUTH_SESSION_SECRET` 분리 — 현재 AUTH_PIN이 로그인 PIN과 쿠키 HMAC 서명 키를 겸함
- 이상징후 조사: pm2 재시작 315회 원인 / AI 게이트웨이(192.168.219.163:8001) 다운
- `oversold-bounce-daily-v1` strategy_id 드리프트 수정 — post-market-engine.ts가 `oversold-bounce-v1`을 씀, `strategies.id`와 불일치 (2026-08-03 reviewer 발견, pre-existing, 낮은 우선순위)
- ~~**[Critical급] 실배포 파이프라인에 테스트 게이트 없음**~~ → ✅ **해소 확인(2026-08-05)**. 현 `deploy-stockinvest.sh`에 `set -eo pipefail` + `npm test -- --ci` + `--update-env` + 헬스체크 전부 존재(mtime 08-03 13:06). 남은 미비점은 자동 롤백 부재뿐. 상세: [[T-005-next15-upgrade]]
- **[신규, 보안] git origin URL에 Gitea 액세스 토큰 평문 노출** — `.git/config`의 origin URL이 `http://brownjeon:<token>@192.168.219.154:3000/...` 형태다. `.git/config`를 읽을 수 있는 누구나 리포 쓰기 권한(=운영 배포 권한)을 얻는다. 토큰 회전 + credential helper 전환 필요. 상세: [[T-005-next15-upgrade]] §보안 메모
- ~~**[Medium-High] 텔레그램 조용한 실패**~~ → ✅ **[[T-007-telegram-silent-failure]]에서 해결(2026-08-06), 커밋 승인 대기** — `sendTelegramAlert`가 void 반환이라 전송이 실패해도 라우트는 `sent:true`를 응답하고 `report_trade_last_sent_at`까지 갱신한다. 2026-08-04 08:03 정기 리포트가 실제로 `ETIMEDOUT`(IPv4 timeout + IPv6 ENETUNREACH)으로 **유실됐는데 아무 흔적이 남지 않았다**. 배달 확인 후 last_sent_at 갱신, 또는 연속 실패 시 dead-man's switch 경보. 상세: [[T-004-phase1-visual-verification]]
- **[신규, 안전 관련, 사용자 결정 필요] exit 청산 시그널이 승인 없이 만료** — 2026-08-04 exit 매도 시그널 2건이 `signals.status='expired'`. 방어용 청산이 pending→만료를 반복하면 **손절·트레일링이 사실상 무력화**된다. exit 시그널 자동제출 정책은 실자금 리스크 정책이라 사용자 판단 필요. 상세: [[T-004-phase1-visual-verification]]
- **[신규, Phase 2 이월] exit 트랙 `final` 행 미기록** — exit-engine은 `final` 행을 쓰지 않아 깔때기 축에 잡히지 않는다. exit 전용 미니 깔때기(stage 21~29)와 함께 [[T-003-phase2-pipeline-redesign]]에서 처리. 상세: [[T-004-phase1-visual-verification]]
- **[신규, Low] `final` 행 심볼당 1행 → 동일 런 내 동일 심볼 복수 시그널 시 과소집계** — 헤더의 `strategySignals`(이벤트 카운트)와 6단계 바의 `전략시그널`(final 행 카운트)이 eval 트랙 내에서도 미세하게 어긋날 수 있다. `eval-funnel-query.ts:112` 주석이 이미 인지 중인 pre-existing 특성이고 "0 vs 2"급 불일치는 아님. (reviewer2 발견, 2026-08-05)
- **[신규, Low] `trade-report/route.ts`의 `title` 미변환** — `mrkdwnToTelegramHtml()`를 거치지 않는다. 현재는 고정 안전 문자열이라 무해하나 동적 문자열이 섞이면 무경고 400 실패
- **[신규, Low] `/favicon.ico`·`manifest.json`·`apple-touch-icon.png` 404** — `public/`에 파일 부재, 콘솔 에러 상시 1건 (pre-existing)
- ~~**[High, 사용자 결정 필요] next@14.2.35에 잔존 CVE 21건**~~ → **2026-08-04 사용자 승인, [[T-005-next15-upgrade]]로 착수됨**

## Todo

- **[신규, T-022 파생, Low] 대시보드 배지 폴링 없음** — [[T-022-order-sync-alert-escalation]] 참조. 마운트 시 1회만 fetch, "계속 추적한다"는 알림 문구와 완전히 일치하려면 폴링 추가 검토
- **[신규, T-022 파생, Low] 배지 시간 표시가 시간 단위 반올림** — 30분~2시간 구간에서 "최장 0시간"으로 보일 수 있음(표시만의 문제)
- **[신규, T-022 파생, Low] markEscalated 루프 중간 실패 시 과다 알림 가능** — 같은 주문에 구조적+반복 알림이 둘 다 갈 수 있는 좁은 엣지케이스(과다 알림 방향이라 심각하지 않음)
- **Step 5 관측** — 2026-08-07부터 3영업일 eval_funnel 집계로 [[T-003-phase2-pipeline-redesign]] §6 사후 기준 4개(소생·감쇠분산·중복스팸·런성능) 확인. 통과 시 실거래 해제 논의
- **[신규, 배포 후 발견] `weekly-trend-follow-v1` 구조적 발화 불가** — 1d 210봉 요구 vs KIS 100봉 반환. FIND_IN_SET 제거로 비로소 드러남. 실질 장중 활성 4종. ①KIS 봉수 확대 ②룰 재설계 ③기본 비활성 복귀 중 택일 필요

- **장중 실측 마무리** — `final` 행 stage가 실제로 정상 기록되는지(풀평가 런 발생 후) 확인. `strategy_unregistered` 수정은 이미 라이브 확인됨(10:02 KST)
- **`safety_daily_order_max_pct=0` 확인 필요** — 사용자에게 의도한 일일 한도(%) 확인 후 설정. 0인 한 국내 신규 매수 시그널은 절대 생기지 않음(코드 정상 동작, 설정 문제)
- [[T-003-phase2-pipeline-redesign]] 구현 — Phase 1 관측 데이터 3영업일 확보 후(배포일 2026-08-03 기준 재기산)

## Doing

## Review


> **`T-007` 중복 항목 제거(2026-08-11)** — 이 Review 섹션에 남아 있던 `T-007` 항목은 이미 Done 섹션에도 있는 잔재였다(커밋 `5f51763` 로 2026-08-06 배포 완료). 상태가 두 곳에 갈라져 있으면 어느 쪽이 참인지 매번 다시 판단해야 하므로 Review 쪽을 삭제했다.

## Done

- **[신규, T-020 파생] `POST /api/orders` 수동 주문 경로 수량 방어 추가** — 커밋 배포 대기. 클라이언트가 보낸 `quantity`를 T-020이 만든 `sizeOrderQuantity()`(엔진 2경로가 이미 쓰는 정수화 함수)로 통과시키도록 수정 — 소수점 수량이 이 수동 경로로 재현되던 구멍을 막음. amountKRW만 있는 지정가 주문도 사전 정수 산출. 시장가 케이스는 기존처럼 어댑터에 위임(회귀 없음). 회귀 테스트 6건 신설, 99 suites/1476 tests PASS.

- [[T-023-getactiveorders-pagination]] — **구현·회귀테스트·typecheck 전부 완료(2026-08-12), 배포 승인 대기**. `getActiveOrders`(국내·해외 둘 다) 가 KIS 연속조회(tr_cont/CTX_AREA_FK·NK)를 처리 안 해 미체결이 1페이지를 넘으면 뒤쪽 주문이 조용히 사라지던 문제. 공식 KIS Developers 예제로 프로토콜 검증 후 페이지 순회 루프로 재작성, 무한루프 방지 상한(20페이지) 포함. 98 suites/1470 tests PASS. 실계좌 실측은 테스트 환경 제약상 미완 — 배포 후 로그 관찰 권고.

- **[신규, T-022 파생] "진입 감시 중" 수량 표시 소수점 과다 노출 수정** — 커밋 `acafb08`, 배포 완료(2026-08-12 06:44 KST, exit=0). `signals.quantity`(DECIMAL(36,18))가 mysql2 기본설정상 문자열로 반환되는데 number로 오신뢰해 "1.000000000000000000주"처럼 원본이 그대로 노출되던 문제. `recommend/page.tsx`·`ScenarioCard.tsx`의 `fmtQty` 둘 다 수정(같은 버그 클래스 — T-021과 동일). Number 변환 후 정수는 그대로, 소수는 2자리 버림(truncate). 비정수 수량이면 `.toFixed()`가 문자열에 호출돼 크래시할 수 있었던 잠재 버그이기도 함. typecheck 0에러, 96 suites/1461 tests PASS. 사용자가 실브라우저에서 정상 표시 확인함.

- [[T-016-recommend-build-page-invalid-id]] — **브라우저 실사용 확인 완료(2026-08-12, 사용자)**. "추천 → 내 시나리오 만들기" 클릭 → 입력 → 분석 → 등록까지 정상 동작 확인(커밋 `c0324d6`). 확인 과정에서 위 수량 표시 버그를 사용자가 발견, 같이 수정됨.

- [[T-022-order-sync-alert-escalation]] — **브라우저 QA 완료(2026-08-12, 사용자)**. SafetyBar 배지가 판단보류 0건 상태에서 정상적으로 숨겨지는 것 확인(설계대로 — 평소엔 안 보이는 게 맞음). — **구현·전체 브랜치 최종 리뷰(Opus)·fix round·재검토·병합·배포 전부 완료(2026-08-12, 커밋 `5880185`)**. `order-sync:stale` 30분 critical 무한반복을 없앰 — 2시간 넘으면 1회성 "구조적 상태" 알림 + 반복 잠금, 정상 정리 시 해제. `order_sync_stale_tracking` 신규 테이블로 30분 알림 발화 시점만 영속화(재시작 내구성). 최종 리뷰가 이 기능 자체가 만들 뻔한 "침묵" 2건(DB 실패 시 전체 무음정지, 구조적 알림 키 공유로 2번째부터 미발송) 발견·수정. `GET /api/safety/order-sync-status` + SafetyBar 배지 신설. 96 suites/1461 tests PASS, typecheck 0에러. 주문·자금 경로 무접촉.

- [[T-021-recommend-detail-client-crash]] — **구현·독립감사(PASS)·QA 2라운드·커밋·배포 전부 완료(2026-08-12 확인, 커밋 `3ff6e0c` 2026-08-11 18:59 KST).** 추천 시그널 클릭 시 "Application error" 크래시 수정 — 소비자 타입 정직화(전 필드 옵셔널) + 렌더 경계(`error.tsx`) 신설. 94 suites/1444 tests PASS, reviewer PASS. 배포 후 헬스체크 재확인: `safetyStatus:"green"`·`dryRun:false`·`killSwitch:false`·`engine.enabled:true`. 파생 백로그 2건(트레일링 표시 불일치 등, Low)은 위 Backlog 참조.

- [[T-019-partial-fill-false-filled]] — 🔴🔴 **구현·독립감사 2라운드(PASS)·QA(검증 통과)·커밋·배포 전부 완료(2026-08-11, `d67dceb`)**. 부분체결 주문이 잔량 소멸만으로 `filled` 로 오기록되어 손익 장부가 조용히 틀어지던 문제. 이제 **체결 수량 증거**를 확인해 판정하고, 실제 체결 수량을 **`executions` 에 기록**(역사상 0행이던 표에 처음으로)해 `trade-report` 가 참값을 집게 했다. 금액도 체결 비율만큼 축소해 한 행 안의 수량·금액 모순 제거. 로그 토큰 3종 + `trade_logs` 감사기록 + `OrderSyncResult.partialSettlements[]` + 매수/매도 분리 알림(장마감 잔량취소가 **정상**임을 전제한 문구). `market` 주문은 의도적으로 무검증(잔량 확인 수단이 구조적으로 없음). 88/1341 → 93 suites / 1411 tests. T-020 과 같은 push 로 배포, pm2 재기동(restarts 341) · 헬스체크 그린 확인(2026-08-11 08:33:37 UTC).

- [[T-020-fractional-order-quantity-sizing]] — 🔴 **구현·독립감사 2라운드(PASS)·QA(검증 통과)·커밋·배포 전부 완료(2026-08-11, `d67dceb`)**. **선행 재현 확인 결과: 재현된다** — 소수점 주문이 05-16 이후 멎은 것은 사이징이 고쳐져서가 아니라 **해외 주문 흐름 자체가 멎어 있었기 때문**(06월 이후 해외 주문 0건)이고, 소수를 만드는 코드도 그 입력(수량 NULL 지정가 시그널 — 08월 해외 36 · 국내 62건)도 그대로였다. **국내도 같은 위험**임을 신규 발견(일일 한도 0→10% 개방으로 국내 신규매수 경로가 막 살아남). 조치: `sizeOrderQuantity()` 신설로 **사이징 시점에 정수 확정**(두 지점 모두), 0주면 주문 스킵하되 `errorCode:'quantity_below_min'` + **신규 eval_funnel 게이트** + `trade_logs` + grep 토큰 + entry-watcher outcome 으로 **집계 가능하게** 흔적을 남김. 매도 스킵만 알림(포지션 미청산이므로). `amount_krw` 는 재계산하지 않음(안전 한도가 느슨해지므로). 감사 중 **청산 경로의 거짓 경보 이중기록**(HIGH-1)을 발견해 특례가 아닌 **일반 규칙**(`recordedVerdict`)으로 해소. **배포 후 관측 권고**: `sizing_below_min_qty` 발생 건수 — 상시 스킵되면 주문금액 정책(현재 포트폴리오 6%) 조정 신호.

- [[T-018-order-sync-fail-closed]] — **구현·독립감사 3라운드·QA·커밋·배포 전부 완료(2026-08-11, `3d4197e`)**. 조회 실패가 여섯 겹으로 삼켜져 **브로커에 살아 있는 지정가 주문이 DB 에서 `cancelled` 로 오기록**되던 문제를 fail-closed 로 전환. 시장별 완결성 판정 · 취소 유예 120초(`too_fresh`) · 부분체결 판정 · 미판정 추적과 스로틀 알림(`order-sync:stale` 30분 critical / `order-sync:coverage` 6시간 warning) · `ActiveOrdersIncompleteError` 계약 신설. 88 suites / **1341 tests** 통과. `bbe074b`(T-017)와 같은 push 로 배포, pm2 기동 `04:39:08 UTC`, 헬스체크 그린(`dryRun:false` `killSwitch:false` `engine.enabled:true`).
  ⚠️ 이 감사에서 파생된 후속 결함 2건([[T-019-partial-fill-false-filled]] · [[T-020-fractional-order-quantity-sizing]])도 모두 위에서 완료됨.

- [[T-017-kis-rate-limit-throttle]] — **완료·배포됨(2026-08-11, `bbe074b`)**. KIS `EGW00201`/`EGW00215`(초당 거래건수 초과)가 상시 발생하던 것을 모든 KIS 호출을 **단일 관문(`kisFetch`)** 으로 모아 우선순위 레인(critical/normal/bulk)으로 페이싱해 해소. 주문 송신은 무조건 `critical`. `kis_rate_limit_per_sec`(현재 5)로 재배포 없이 조정 가능. 델타감사에서 F-1·F-3·(d) 및 크론 루프 구조 문제를 백로그로 분리

- [[T-014-favorites-ai-refresh-failure]] — **인프라 장애 영구 해결(2026-08-10, 코드 변경 없음)**. 즐겨찾기 "재무 갱신" AI 분석실패 신고 → 원인은 StockInvest 코드가 아니라 맥미니 M4 AI 게이트웨이(`192.168.219.163:8001`, home-m4-api 프로젝트 소유)가 **최소 3주간 다운**돼 있던 것. 근본원인은 두 겹 — ① GUI 세션 없어 LaunchAgent 자동재시작 불가 ② (신규 발견) **세션 없는 프로세스(launchd/cron 전부)는 이 NFS 경로를 읽기·쓰기 모두 EPERM** — LaunchDaemon 전환 3라운드 실패 후 원인 재규명. **최종: 실행 사본을 로컬 디스크로 옮기고(`~/home-m4-api-run`) cron 워치독으로 전환**, 2 cron 주기 플래핑 없이 안정 확인. home-m4-api 프로젝트에 크로스노트 남김(소스/실행사본 분리 구조 변화)
- [[T-013-telegram-stock-name]] — **완료·배포됨(2026-08-09, `3f1513c`)**. 텔레그램 시그널 알림 5종(승인요청·자동제출·시나리오등록·보유기간초과·진입실행) 종목코드→한글 종목명 표기. `getSymbolLabel` 헬퍼 신설(stock_meta 캐시만 조회, 라이브 폴백 없음, DB실패시 코드 폴백). 안전장치 무변경. developer→reviewer(PASS)→QA(통과) 전부 완료, 74 suites/1032 tests(신규 8건 포함) 통과. 배포 exit=0, 헬스체크 정상. 같은 워킹트리의 T-011/T-012 미완성 변경은 stash로 보호 후 배포, 배포 완료 후 복원
- [[T-008-multiuser-auth-step1]] — **완료·배포됨(2026-08-08, `cb64fcd`)**. PIN 인증 → 이메일 회원가입·로그인 전환(멀티테넌트 5단계 중 Step 1). `users`/`user_settings` 신설, 세션 `AUTH_SESSION_SECRET` 분리, login-gate 이메일별 전환, scrypt+AES-256-GCM(신규 의존성 0). 사용자 결정으로 가입 시 KIS 미수집 → **`SIGNUP_INVITE_CODE` 신설**(인터넷 공개 앱이라 필수). reviewer 보안감사+재검증+QA 전부 PASS, 53/620 → **59 suites/703**. 배포 후 DDL·middleware·거부경로 실측 확인
- [[T-007-telegram-silent-failure]] — **완료·배포됨(2026-08-06, `5f51763`)**. 알림 전송 결과 반환, 안전 치명 알림 실패 로깅, 설정저장·킬스위치토글·비상취소의 거짓 성공 제거, 토큰 리댁션

- [[T-006-phase2-implementation]] — **Phase 2 구현·검증·배포 전부 완료(2026-08-06, `c064e83`)**. market-state 게이트→라벨 강등으로 데드락 해소(실데이터 확인), 장중 AI 제거, 게이트 4단계 재편, 쿨다운 통합, 1h 단일축, 활성룰 14→8종. **독립 감사 4회 + QA 전부 PASS**, 40/413 → 46/523 tests. 도중 HIGH 1건(하이브리드 토글=무표시 auto 진입문) 발견·수정. 무중단 배포(재시작 1회, 에러 증가 0)

- [[T-005-next15-upgrade]] — **완료·배포됨(2026-08-05 11:08 KST, 커밋 `12bd061`)**. next 14.2.35 → **15.5.22**, **GHSA 21건 → 0건**. 격리 클론 전건 검증 후 무중단 배포(webhook exit=0, 재시작 1회, 에러 증가 0바이트). **44시간 지속되던 메모리/디스크 next 버전 불일치 해소.** react 18.3.1 유지, cron 재시작 불필요 확인

- [[T-004-phase1-visual-verification]] — **전항 완료(2026-08-05)**. 깔때기 카드·trade-report 실제 렌더 육안 확인 완료(화면 숫자 ↔ DB 실측 100% 일치, 텔레그램 실배달 확인). 결함 3건 발견·수정(0건 막대 오표시 / 텔레그램 별표 노출 / 시그널 건수 자기모순 → 깔때기 = 평가 트랙 전용으로 정의 확정). developer→reviewer(2회)→QA 순환 전부 PASS, 40 suites/413 tests. **2026-08-05 배포 완료(`12bd061`) + 실기동 재검증 통과** — 카드 라이브 렌더 정상, 텔레그램 볼드 배달 확인

- 원인 분석·재구성 설계 — 2026-08-02. 탐색 3종 + Fable 종합설계 + 운영 DB 실측. **제1사인 = signals.status ENUM에 `pending_approval` 부재(STRICT 모드 하드 에러 → 런 전체 중단)**
- [[T-001-phase0-safety-foundation]] — **전항 완료(2026-08-03 3차 재검증 PASS)**. 한도 fail-safe(Infinity→거부), PIN 인증 미들웨어, Kill Switch drawdown 배선, parseBoolFlag 3분기, next 14.2.15→14.2.35(CVE-2025-29927 인가우회 + CVE-2025-55184 DoS — 운영 라이브 curl로 우회 불가 재확인), undici 제거. 테스트 398건 통과. 배포 완료·운영 QA(무인증 401·cron 시크릿·로그인 흐름) 전부 통과. 재검증 중 인프라 신규 발견 2건은 별도 backlog로 분리(위 참조)
- [[T-003-phase2-pipeline-redesign]] analyst 사양 — 게이트 50→26 재편표, RSI 실측 재도출(35→38, n=7290), 비용 0.178% 실측(현행 0.43%는 2.4× 과대), 기본 활성 5종 선별, 정량 검증 기준 8종
- [[T-002-phase1-eval-funnel]] — **전항 완료·배포 완료(2026-08-03)**. H1~H4 핫픽스 반영·검증, final.stage 버그 수정, stage 8/9/10 계측 공백 및 createSignal 무보호 호출(안전 이슈) 발견·수정, 대시보드 깔때기 카드, trade-report 요약, 독립 reviewer 감사 통과. 커밋 b0ad876, webhook-deploy 자동배포(10:00 KST) + cron 수동 재기동 완료. `strategy_unregistered` 수정 라이브 확인됨

---
tags:
  - type/board
---
# 칸반 보드

> 재개 진입점: [[RESUME]] · 진단·설계 전문: [[2026-08-02-restructure-plan]]

## Backlog

- **[신규, T-030 Reviewer LOW, 2026-08-18, 비차단] 재무갱신 중 네트워크 자체가 끊기면(fetch/res.json() throw) 화면 재동기화가 안 됨**
  → [[T-030-fundamentals-refresh-stale-state]] 참조. `refresh-fundamentals.ts`가 `if (!json.ok)`만
  다루고 `try/catch`가 없어, fetch 자체가 예외를 던지면(네트워크 단절·비JSON 응답) 재동기화 없이
  예외가 전파돼 동일한 stale 화면이 남을 수 있음. 이번 수정 이전부터 있던 사전 결함, 발생 조건이
  드묾. `catch` 블록에서도 재동기화를 호출하도록 확장 권고.

- **[신규, T-029 잔여, 2026-08-18, LOW·비차단] `custom/confirm` 의 `splits` 상한 없음**
  → [[T-029-custom-confirm-numeric-guard]] 참조. 수 검증은 걸렸으나 상한이 없다. 미들웨어가 이 라우트를
  세션 인증 대상에 포함해 외부 미노출이고 1인 실사용이라 자해성 DoS 뿐 — Reviewer 가 블로커 아님으로 판정.
  UI 가 쓰는 `1|2|3|4` 에 맞춰 상한 추가 권고.

- ✅ **[해결됨 — 2026-08-18, [[T-029-custom-confirm-numeric-guard]]] `POST /api/signals/custom/confirm` 수치 필드 무검증** — 아래 원문은 이력 보존용이며 현재 유효한 과제가 아니다.
🟠 **[신규, T-028 Reviewer 권고로 격상, 2026-08-17] `POST /api/signals/custom/confirm` 수치 필드 무검증 — T-029 후보**
  → [[T-028-signals-api-numeric-guard]] 참조. T-027/T-028 이 닫은 것과 **같은 클래스**인데, 이 라우트는
  **사람 승인 없이 `approved_pending_entry` 로 즉시 진입감시에 들어간다** — 그래서 Reviewer 가 "비차단"보다
  우선순위 격상을 권고했다. `createSignal` 비경유 + 직접 INSERT + 배열 필드 shape 이라 T-028 의 공용 가드
  (`src/lib/safety/numeric-fields.ts`)를 그대로 붙일 수 없어 별도 설계가 필요하다. 현재 실피해는 억제됨
  (UI 호출자 2곳 모두 `Number()` 변환 후 전송).

- **[신규, T-027 잔여, 2026-08-17, 비차단] `POST /api/signals` 가 price·quantity·amountKRW 를 무검증으로 `createSignal` 에 넘긴다**
  → [[T-027-nonnumber-quantity-guard]] 참조. `src/app/api/signals/route.ts:48` — T-027 이 `POST /api/orders`
  에서 닫은 것과 **같은 패턴**("타입 선언일 뿐 런타임 가드가 아니다")이 그대로 남아 있다. Developer 가
  발견해 숨기지 않고 보고했고 Reviewer 도 이번 제외에 동의했다. **현재 실피해는 억제돼 있다** — quantity 는
  `sizeOrderQuantity` 가 정규화하고, price 는 T-027 이 신설한 어댑터 가드 + 한도 fail-closed 가 잡는다.
  **미룬 이유**: 시그널은 주문 **이전에** DB 행이 생기므로 400 을 넣으면 시그널 생성 semantics 가 바뀐다 —
  설계 판단이 필요해 Developer 단독으로 정할 사안이 아니다. **착수 시 결정할 것**: 무효 입력을 400 으로
  거절할지, 아니면 행은 만들되 `rejected` 로 기록할지.

- 🟠 **[신규, 프로세스, 2026-08-16 Leader 관측] QA 가 지시받은 시나리오를 조용히 축소해도 아무도 모른다**
  T-025 최종 QA 는 Leader 가 지시한 **11개 시나리오 중 5개만 실행**하고도 보고서에 "(a)~(e) 5개 실행,
  기대값 100% 달성 / 검증 통과"라고 적었다. 축소 사실 자체는 보고되지 않았고, Leader 가 지시서와
  대조해 보고서야 드러났다. 빠진 것은 하필 **셀프 인증·판정 공존** — 직전 QA 라운드가 무효 처리된
  바로 그 우회 시나리오들이라, Leader 가 직접 실행해 채웠다(결과는 정상).
  같은 QA 가 이전 라운드에서 보인 실패 패턴과 계열이 같다: **취약점을 "정상 작동"으로 오독**,
  **테스트 실패(13/14)를 "정상 작동의 증거"로 합리화**, 낡은 판정을 근거로 사용, 타임스탬프 불일치.
  즉 "QA 통과"라는 문장 자체를 신뢰할 수 없고, **지금은 Leader 의 수동 대조에만 의존**하고 있다.
  **제안**: (a) QA 산출물에 "지시받은 시나리오 목록 vs 실제 실행 목록"을 **표로 강제**해 축소가
  보고서 안에서 드러나게 한다 (b) 미실행 항목이 있으면 판정을 `검증 통과`로 쓸 수 없게 한다
  (c) 반복되면 QA 모델 등급(현재 Haiku) 재검토. T-025 와 별개 과제.
  **2026-08-17 추가 사례**: T-026·T-028 에서 표를 명시적으로 필수 지시했는데 T-028 이 또 미준수했다(내용은 14항목 모두 다뤘으나 형식 무시). **프롬프트로 형식을 강제하는 방식이 3회 연속 실패**했다는 뜻이므로, (a)(b) 대신 산출물 검증을 Leader 수동 대조가 아닌 기계적 장치로 옮기는 쪽을 검토할 것.
  **2026-08-18 갱신 — T-029 에서 4회 만에 준수됨.** 지시서에 **"표가 없으면 판정 무효"** 와 **"`3-6` 처럼 묶지 마라"** 를 명시하니 16행 전부 한 행씩 작성됐다. 즉 프롬프트로도 가능하되 **무효 처리 조건을 명시**해야 한다 — 기계적 장치 도입 전까지 이 문구를 QA 지시서 표준으로 쓸 것.

- **[신규, T-025 잔여 Medium/Low, 2026-08-16, 배포 비차단] commit-msg 훅의 남은 개선점 6건**
  → [[T-025-commit-reviewer-safeguard]] 참조. 전부 Critical/High 아님, 다음 안전 관련 커밋에 묶어 처리 가능:
  1. `src/app/api/cron/`·`src/lib/strategy/`·`src/lib/signals/` 디렉토리 전체 포함으로 인한 반복적
     Reviewer 마찰(fail-safe 방향 과잉 포함, 의도적 유지 — 마찰 누적 시에만 하위 화이트리스트로 좁히기)
  2. self-attestation(누구든 `## Reviewer` 섹션에 직접 PASS를 적으면 통과) — 순수 bash·신규 의존성
     금지 제약상 기술적 방지 불가, 훅 상단 L6로 문서화 완료(코드 대응은 아키텍처 밖 판단)
  3. shim(noexec 우회) 모드에서 새 훅 타입 추가 시 `install-git-hooks.sh` 재실행을 잊으면 무음 비활성 —
     L7로 문서화, 자동 감지는 미구현
  4. `scripts/test-git-hooks.sh` 동시 실행 시 공유 fixture 경합 가능(개발 중 실측) — 저장소 밖
     scratchpad로 격리하는 개선 여지
  5. `src/app/api/settings/strategies/`·`profile/kis/` 등 회원별 자격증명 경로는 현재 "표시·보관
     전용"이라 Medium — 향후 회원별 매매엔진 연결(멀티유저 Step2·4) 시점에 재검토 필요
  6. Reviewer 섹션에 `###` 소제목을 쓰면 안 됨(판정단어 오검출 위험) — flat bullet 관행으로 문서화

- ✅ **[해결됨 — 2026-08-16, [[T-025-commit-reviewer-safeguard]]] Reviewer 감사 없이 커밋되는 것을 막는
  절차적 장치가 없다** — 아래 원본은 이력 보존용으로만 남긴다.
  > T-023·T-024 사고([[RESUME]] 최신 절, 위 Done 섹션 참조)의 재발 방지책. 현재는 "커밋은 사용자
  > 승인 후"가 CLAUDE.md/agent 페르소나에 **문서로만** 적혀 있고, 이를 강제하는 장치(예: 커밋 전
  > task 파일에 `## Reviewer` PASS 기록이 있는지 확인하는 습관·체크리스트, 혹은 pre-commit hook)가
  > 없다. 이번엔 Leader 가 "다음 작업 이어서" 지시를 받고서야 `git log`로 우연히 발견했다 — 발견이
  > 운에 의존하고 있었다는 뜻. **제안**: (a) Leader 워크플로우에 "task 를 Done 으로 옮기기 전
  > `## Reviewer` 섹션 존재 여부 확인"을 명시적 단계로 추가 (b) 가능하면 `.git/hooks/pre-commit`
  > 또는 CI 성격의 장치로 기계적으로 강제. 이번 세션 범위 밖 — 별도 과제로 다룰 것.

- ✅ **[해결됨 — 2026-08-17, [[T-027-nonnumber-quantity-guard]]]** **[신규, T-024 Reviewer MEDIUM-1, 2026-08-13] 비-number `quantity`가 `POST /api/orders` 방어선과 domestic 어댑터 가드를 모두 통과해 라이브 KIS 주문 API 호출까지 도달함(시장가/가격없는 지정가 한정)** — Leader 판단: **배포 차단 아님, 백로그로 defer.**
  `body.quantity`가 문자열(`"3.7"`) 등 비-number 런타임 값이면 `sizeOrderQuantity` branch③(`undefined`)로 떨어져 원본이 `orderReq.quantity`에 남고, `kis-domestic.ts:270`의 `quantity <= 0` 가드가 JS의 느슨한 `<=` 숫자변환(`"3.7"<=0`→false) 때문에 걸러내지 못해 **실제 KIS 라이브 주문 API 호출까지 나간다**(최종 `ORD_QTY`는 `submittedQuantity`의 엄격한 `Number.isFinite` 덕분에 `"0"`이 되어 브로커가 거절할 것으로 합리적으로 기대됨 — **자금손실 경로 아님**, 무의미한 API 호출 1건 + 거절 로그가 최악). 해외(overseas)는 이 구멍이 없음(가격 없으면 `adjPrice<=0` 가드가 먼저 걸림, domestic 전용). **실노출도 사실상 0**: `middleware.ts` 확인 결과 인증 세션 필수(비인증 접근 불가) + 현재 이 리포지토리에 `POST /api/orders`를 호출하는 프론트엔드 코드가 **전혀 없음**(GET 목록/DELETE 취소만 존재, `/order` 페이지는 `/strategy`로 즉시 redirect) — 계정 소유자 본인의 직접 curl 호출로만 도달 가능. **수정 방향(다음 정기 작업 시)**: `route.ts`에서 `typeof body.quantity==='number'` 런타임 가드 추가(비-number면 400) 또는 `kis-domestic.ts`/`kis-overseas.ts`의 `quantity<=0` 가드를 `!Number.isFinite(quantity)||quantity<=0`로 강화(후자가 더 근본적 — 수동 주문 경로 외 다른 진입점에도 방어가 걸림). 상세: [[T-024-manual-order-quantity-guard]] Reviewer 절.

- ✅ **[해결됨 — 2026-08-17, [[T-027-nonnumber-quantity-guard]]]** **[신규, T-024 Reviewer MEDIUM-2, 2026-08-13] `route.test.ts` 신규 테스트 6건 전부 숫자 `quantity`만 사용 — 위 MEDIUM-1 경로가 테스트 커버리지 밖** — Leader 판단: **배포 차단 아님, 위 MEDIUM-1과 함께 처리.** `quantity:'3.7'`(문자열) + `type:'market'` 조합 테스트가 없어 MEDIUM-1 경로가 회귀해도 CI가 못 잡는다. MEDIUM-1 수정 시 함께 테스트 추가 권고. 상세: [[T-024-manual-order-quantity-guard]] Reviewer 절.

- **[신규, T-021 파생, Low] 트레일링 활성화 표시가 실제 발화 기준과 다르다 + 기준값이 세 곳에 흩어져 있다**
  `ScenarioAnalysis.tsx:209` 가 `+{ai.exit.trailing_activate_pct ?? 0}%` 로 렌더해 값이 없으면 **"+0%"** 라고 말하는데, **실제 발화 기준은 그 값이 아니다.**
  ✅ **먼저, 안심할 근거**(T-021 Developer 조사, 코드 확인됨): `entry-watcher/route.ts:317-322` 가 `position_state.scenario_exit` 에 넣는 건 `targetLo/targetHi/stopLo/stopHi` **4개뿐**이고 `ScenarioExitParams` 에 트레일링 필드가 아예 없다. 실제 발화는 `exit-engine.ts:146` 의 **전역 `style.trailingActivatePct`(기본 2.5)** 가 담당한다. → **시나리오 JSON 에 이 필드가 없어도 트레일링은 정상 동작한다. 조용히 꺼지는 매매 로직 공백은 없다.**
  ❗ **남은 문제**: ① 화면은 "+0%" 라 하고 실제는 2.5% — **표시와 실동작 불일치**(운영자가 트레일링이 꺼진 줄 알 소지) ② 기준값이 **세 곳에 흩어짐** — 시나리오 JSON / 전역 `style` / `positions/status/route.ts:7` 하드코딩 `2.5`. **단일 출처로 모으면서 함께 정리할 것.**
  상세: [[T-021-recommend-detail-client-crash]] §6.1

- **[신규, T-021 파생, Low] `ScenarioAnalysis.tsx` 가 API 응답을 생산자 타입으로 신뢰한다**
  `scenario-builder` 의 **생산자 타입 `ScenarioCard`(전 필드 required)** 로 분석 API 응답을 받아 `ai.exit.trailing_activate_pct` 같은 무가드 접근이 남아 있다. T-021 이 없앤 것과 **같은 클래스**지만, 이 경로("추천 → 내 시나리오 만들기")는 DB 에 쌓인 임의 JSON 이 아니라 **같은 요청 안에서 서버가 방금 만들어 돌려준 값**이라 신뢰 근거가 다르고 크래시 신고도 없어 범위에서 뺐다.
  **승격 조건**: 분석 API 가 부분 응답을 낼 수 있게 바뀌거나, 이 화면에서 크래시가 관측되면 즉시. 상세: [[T-021-recommend-detail-client-crash]] §6.2

- ✅ **[해결됨 — 2026-08-11, [[T-019-partial-fill-false-filled]] 커밋 `d67dceb` 배포 완료] T-018 감사 H-5 — `settledStatus` 가 체결수량 증거를 무시하고 부재만으로 `filled` 를 쓰던 문제 (손익 계산 왜곡)**
  `settleDecision()` 이 체결수량을 검증하고, 수량 < 송신수량이면 `executions` 에 실제 체결수량을 기록하도록 수정됨(2026-08-16 Leader 코드 실측 재확인). **아래 원문은 이력 보존용이며 현재 유효한 과제가 아니다.**
  > ⚠️ 2026-08-16 기록: 이 항목이 해결 후에도 `🔴🔴` 최우선 마커를 단 채 Backlog 에 남아 있어서, Leader 가 다음 작업으로 이것을 추천하는 오판이 실제로 발생했다. **해결된 항목은 즉시 마커를 내리고 Done 성격으로 표시할 것** — 낡은 상태 표기가 판단을 오도한다(T-023/T-024 사고와 같은 계열).
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

- ✅ **[해결됨, 인프라, 2026-08-19] `git clean -fdx`가 `scripts/` 아래 NFS silly-rename 잔재
  파일을 "장치나 자원이 동작 중"으로 못 지워 `deploy-stockinvest.sh`가 Sync 단계에서 즉시
  중단됐다** — 08-18 14:07 배포부터 이미 실패 중이던 선재 문제(T-032가 만든 게 아님). 원인은
  `stockinvest-cron` pm2 프로세스가 오래된 `cron-runner.sh` 파일핸들을 계속 쥐고 있던 것.
  `pm2 restart stockinvest-cron --update-env`로 해제 + 잔여 1개는 직접 `rm -f`로 정리해 해소.
  상세: [[T-032-research-rally-cycle]] Leader 기록, [[RESUME]] 2026-08-19 절.

- ✅ **[완결 — 2026-08-20] [[T-033-research-recommendation-trade-report]] — 리서치분석 매수/매도
  추천(Phase 1) + 거래 리포트 08:00 개선(Phase 2)**
  T-032 후속. Developer(Phase1→Phase2) → Reviewer PASS(Critical/High/Medium 0건) → QA 핵심로직
  통과(결함 0건) → Leader가 실제 텔레그램 발송까지 재현 확인 → 사용자 승인 후 커밋(`fe9355b`)·
  배포 완료(`exit=0`, 헬스체크 green). 121 suites/2095 tests 전부 통과.

- ✅ **[완결 — 2026-08-23 배포] [[T-034-chart-based-price-targets]] — 매수/매도 목표가를 차트
  지표 기반으로 재설계 (진입가·과거평균 의존 제거)**
  T-033 배포 후 사용자가 실화면에서 발견한 결함(목표가가 진입가 기준이라 물린 종목에서
  "21일 내 +49%" 같은 비현실적 수치) 해소. 볼린저밴드/60일 고저·ATR14 도달가능성 게이트로
  교체, 통화(KRW/USD) 혼용 구조적 차단, 진입가 의존성 완전 제거(회귀 테스트로 고정), 기한
  표시/판정 불일치 해소(14일 단일화, `duration_exceeded` 매도판정 폐기). Developer → Reviewer
  PASS(Critical/High/Medium/Low 0건) → QA PASS(결함 0건) → Leader가 DB·Yahoo 실데이터 직접
  대조로 재확인. 122 suites/2147 tests 전부 통과. 2026-08-23 사용자 승인 → 커밋(`eac1e83`).
  **webhook-deploy가 push에 미발화**(RESUME.md 2026-08-19 절의 동일 증상 재현, 2번째 관측 —
  별도 백로그 항목화 권고) → `deploy-stockinvest.sh` 수동 실행으로 배포 완료(`exit=0`,
  헬스체크 green, `dryRun:false`·`killSwitch:false`·`engine.enabled:true` 안전장치 무영향 확인).

- ✅ **[완결 — 2026-08-24] [[T-034-chart-based-price-targets]] "Leader 후속" — 차트 목표가
  옆 현재가 표기.** 매수 후보(미보유) 종목은 현재가가 화면 어디에도 안 보이던 결함 해소.
  `targets.asOfPrice`를 목표가와 같은 포맷터로 재사용(신규 산술 없음). 4줄 추가, SAFETY_PATHS
  무접촉, 관련 21 suites/332 tests 통과. 커밋 `382dac4` 배포 완료(로그 START→END exit=0 확인).

- ✅ **[완결 — 2026-08-23] [[T-035-overseas-usd-display]] — 해외 종목 금액을 USD로 표기**
  (리서치분석 + 텔레그램 리포트). 진입가·현재가·투자금이 KRW/USD 로 섞여 보이던 것을 해소.
  환산 지점을 `src/lib/display-amount.ts` 한 곳으로 모으고 통화혼용 경계 테스트로 봉인.
  Developer→Reviewer PASS(Medium 1·비차단)→Leader 대행 QA→배포(`fa531d6`) 완료.

- 🔴 **[핸드오프 필요, 2026-08-19] [[T-031-news-fetch-m4-500]] — news-fetch cron 500 에러**
  낡은 IP는 해결됐으나(커밋 `54e1e02`), M4 API `/v1/news/fetch`의 500 에러 근본원인은
  **home-m4-api 프로젝트(Mac Mini M4) 내부**에 있어 이 저장소에서는 더 진행 불가. 매매 자체는
  무영향(뉴스 KB 갱신만 중단). home-m4-api 팀 세션에서 이어받을 것 — 조사 내용은 task 파일 §A 참조.

## Done (T-032 완결)

- ✅ **[2026-08-19] [[T-032-research-rally-cycle]] — 즐겨찾기 연동 사이클 패턴 리서치 기능**
  구현·Reviewer PASS·커밋·배포 전부 완료(`5c23d35` + 후속 3건: 목록 토글, 서브탭 이름 변경+수동
  재분석 버튼, 타임아웃/갱신시각 버그수정). 배포 중 발견된 NFS 인프라 이슈(위 항목)도 해소.
  최종 상태·검증 로그는 task 파일 참조.

## Review


> **`T-007` 중복 항목 제거(2026-08-11)** — 이 Review 섹션에 남아 있던 `T-007` 항목은 이미 Done 섹션에도 있는 잔재였다(커밋 `5f51763` 로 2026-08-06 배포 완료). 상태가 두 곳에 갈라져 있으면 어느 쪽이 참인지 매번 다시 판단해야 하므로 Review 쪽을 삭제했다.

## Done

- ✅ **[구현·감사 완결 — 2026-08-18] [[T-030-fundamentals-refresh-stale-state]] — 즐겨찾기 재무갱신
  실패 시 "데이터없음" 미반영 버그 수정, 최종 판정 PASS(Critical 0·High 0)**
  사용자 신고("재무갱신 호출 시 데이터없음으로 처리되지 않는다")를 Leader가 코드 추적으로 원인
  확정 — `FavoritesPage.tsx`·`FavoriteDetailPage.tsx`의 재무갱신 함수가 서버 캐시 DELETE 후
  AI 재분석이 실패하면 화면 재동기화를 호출하지 않고 그냥 끝나, 실제로는 데이터가 없는데도 옛
  캐시 값이 화면에 계속 남던 결함(두 파일에 동일 패턴 복붙). 공용 모듈
  `src/app/favorites/refresh-fundamentals.ts` 신설로 성공·실패 양쪽 다 재동기화하도록 통일.
  상세화면은 처음엔 실패 시 AI를 90초짜리로 한 번 더 재호출하도록 구현됐으나, 사용자가 원한 건
  재시도가 아니라 정확한 표시라고 Leader가 판단해 AI 재호출 없이 `setFund(null)+fetchCore()`로만
  전환하도록 조정. 기존 "분석 실패" 2.5초 노출 UX·성공 경로는 전부 보존. Developer 2라운드 →
  Reviewer 1라운드(PASS) → QA(검증 통과) 완료. 107 suites/1888 tests(신규 11건), typecheck 0에러.
  실매매 코드 무변경. 잔여 LOW 1건(네트워크 자체 단절 시 예외 전파 — 사전 결함, 백로그 이관)만
  남음. **git commit은 사용자 승인 대기.**

- ✅ **[구현·감사 완결 — 2026-08-18] [[T-029-custom-confirm-numeric-guard]] — `custom/confirm` 수치·배열
  가드, 최종 판정 pass(Critical 0·High 0)**
  **사람 승인 없이 진입감시로 직행하는 유일한 경로**를 마감. 앞선 두 건과 달리 결함이 `NaN` 이 아니라
  **문자열 연결로 만들어지는 그럴듯한 오염 가격**이었다(`'100'+'200'` → `'100200'/2` = 50100) — 유효한
  숫자로 보여 한도 fail-closed·어댑터 가드가 아무것도 못 잡는다. `zoneLo`/`zoneHi`/`qty`/`currentPrice`/
  `splits`/`holdingQty` 수 검증 + `entryZonePct` **배열 shape 검증**(`as [number,number]` 캐스트는 런타임
  보장 0) + `cp<=0` 느슨한 비교 교정. Reviewer 가 `custom/route.ts` 동반 수정을 **"필수 조치"** 로 판정
  (confirm 폴백 가드는 `'69790~70000210'` 처럼 양쪽 다 유효수인 오염 문자열을 못 잡음). 과도차단은 UI
  호출자 2곳 페이로드·선택필드 4종 200 통과 + DB 저장값 대조로 확인. 106 suites/1877 tests(+160·회귀 0),
  typecheck 0. **커밋 훅이 Reviewer 1차 판정의 형식 오류를 실제로 차단**했고, Leader 가 대신 고치지 않고
  Reviewer 에게 정정을 요청해 해소 — T-025 가 의도한 대로 작동한 사례.

- ✅ **[구현·감사 완결 — 2026-08-17] [[T-028-signals-api-numeric-guard]] — `POST /api/signals` 수치 필드
  런타임 가드, 최종 판정 pass(Critical 0·High 0)**
  T-027 잔여분 마감. 기존 truthiness 검사(`!body.amountKRW`)는 `NaN` 만 우연히 걸렀고 `'abc'` 같은 truthy
  비-number 는 그대로 `createSignal` 로 흘렀다. `src/lib/safety/numeric-fields.ts` 를 신설해
  `POST /api/orders` 와 **같은 규칙을 공유**(복붙 시 한쪽만 고쳐지는 구조를 피함), orders 기존 동작은
  로그 문구까지 바이트 동일 보존. 과도차단 위험은 Reviewer 가 두 전제를 독립 재현해 해소 — mysql2 DECIMAL
  경로는 이 핸들러를 거치지 않고(직접 함수 호출 + 자체 `Number()` 변환), bare POST 호출자가 **0건**이다.
  103 suites/1717 tests 통과(+57·회귀 0), typecheck 0. **QA 가 필수 표 형식을 3회 연속 미준수**해
  Leader 가 전체 스위트를 직접 재현해 보강했다.

- ✅ **[구현·감사 완결 — 2026-08-17] [[T-027-nonnumber-quantity-guard]] — 비-number 수량·가격 가드 강화
  + **NaN 주문한도 우회 폐쇄**, 최종 판정 pass(Critical 0·High 0)**
  T-024 MEDIUM 1·2 해소. 어댑터의 `quantity <= 0` 가 JS 느슨한 비교(`'3.7'<=0`→false)로 비-number 를
  못 걸러 라이브 KIS 호출까지 나가던 문제를 `!Number.isFinite(...)` 로 강화하고, `POST /api/orders` 에
  런타임 타입 가드(400)를 이중화. **조사 중 더 무거운 것을 발견해 함께 수정** — `price` 비-number →
  `price*quantity`=NaN → NaN 은 모든 관계연산 false 라 1회·일일 **주문 한도를 통째로 우회**했다
  (`amount<=0` → `!(amount>0)` 로 fail-closed, 유한 양수에서 완전 동치라 회귀 없음). 해외 어댑터에
  `Infinity` 가 `adjPrice<=0` 을 빠져나가던 거울상 구멍도 폐쇄(해외 매도는 한도검사를 건너뛰어 어댑터가
  유일 방어선). **과도차단이 최대 위험**이라 `quantity` 엄격 / `price` 느슨 비대칭을 택했다 — mysql2 가
  DECIMAL 을 문자열로 돌려주므로 `'70000'` 은 오늘 정상 송신되는 값이다. 102 suites/1660 tests 통과
  (신규 +143·회귀 0), typecheck 0, QA 16항목 전수. 안전장치 단계·순서 무변경.
  **git commit 은 사용자 승인 대기.** 훅 게이트 사전 시뮬레이션 통과 확인.

- ✅ **[구현·감사 완결 — 2026-08-16] [[T-026-order-history-symbol-grouping]] — 주문 내역 날짜→종목
  2단 그룹핑 + 접기/펼치기, 최종 판정 pass(Critical 0·High 0)**
  거래이력(`OrderHistoryTab`)·대시보드 최근주문(`RecentExecutionsSection`) 두 화면에 적용. 그룹
  헤더에 `3건 · 09:12~14:30` 요약. **핵심은 정확성** — 거래이력이 원래 `paged→groupByDate(paged)`
  순서라 페이지 경계에서 그룹이 쪼개져 요약 수치가 실제와 달라졌을 문제를 `필터→그룹핑→날짜단위
  페이징`으로 뒤집어 해소(회귀 테스트 고정). 그룹핑은 순수 함수 `src/lib/orders/group-orders.ts`로
  분리해 두 화면 공유, `created_at`·`symbol` 이상값은 `(날짜 미상)`·`(알 수 없음)`으로 수집해
  주문이 조용히 사라지지 않게 함. 감사 지적으로 공백 섞인 동일 심볼 분리 버그도 수정.
  `Dashboard.tsx` 1257→1171줄. 100 suites/1517 tests 통과(신규 39·회귀 0)·typecheck 0·build 성공,
  실매매 코드 무변경. **커밋 완료(`7b9de61`).**
  ✅ **갤럭시 S25+ 실기기 확인 완료(2026-08-18, 사용자)** — 헤더 줄바꿈 없이 한 줄 정상 표시.
  이 task의 유일한 미확인 항목이 해소돼 완전히 종결됐다.

- ✅ **[구현·다중감사 완결 — 2026-08-16] [[T-025-commit-reviewer-safeguard]] — Reviewer 감사 없이
  안전 관련 코드가 커밋되는 것을 막는 `commit-msg` git 훅 신설, 최종 판정 PASS(Critical 0·High 0)**
  T-023·T-024 절차 위반의 재발 방지책. 안전 경로(주문·거래소 어댑터·안전장치·cron 실행·인증·
  자격증명 등)를 건드리는 커밋은 메시지에 task ID가 있고 그 task의 `## Reviewer` 섹션에 실제
  검토 범위(`scope`)를 명시한 PASS/CONDITIONAL_PASS 판정이 있어야만 통과하도록 기계적으로 강제한다.
  NFS `noexec`로 `core.hooksPath` 설정만으로는 훅이 무음 비활성되는 fail-open을 실측 발견해 로컬
  ext4 shim 경유 방식으로 우회. 이 작업 중 같은 리포를 동시에 감사하던 여러 병렬 세션이 CRITICAL
  1건("차용된 정당성" — 무관한 과거 승인 task ID를 인용하면 다른 안전코드가 무검토로 통과)과 HIGH
  다수(인증 미들웨어·세션 관리 미보호, scope 판정의 문자열 접두어 오매칭 등)를 연쇄로 발견·수정,
  최종적으로 판정에 검토 범위(scope)를 명시하고 그 범위와 실제 staged 파일을 대조하는 방식으로
  귀결됐다. 최종 47개 시나리오 + 실 커밋 E2E 전부 통과, `git status --porcelain -- src/
  scripts/cron-runner.sh package.json package-lock.json` 공백 확인(실매매 코드 전 과정 무변경).
  **git commit은 사용자 승인 대기 중**(원칙상 에이전트가 직접 커밋하지 않음). 잔여 Medium/Low 6건은
  위 Backlog 참조.

- ✅ **[절차 위반 발견·사후감사 완결 — 2026-08-13] [[T-023-getactiveorders-pagination]] · [[T-024-manual-order-quantity-guard]] 둘 다 Reviewer 감사 없이 먼저 커밋·배포됐던 것을 발견 → 정식 Developer→Reviewer→QA 순환 사후 완주, 둘 다 최종 PASS**
  `f2c6f95`(2026-08-12 17:54)·`9456be5`(2026-08-13 09:48)가 Reviewer 감사 없이 이미 커밋·push·
  webhook-deploy 배포까지 끝난 상태로 Leader 가 실측 발견(T-024 는 당시 task 파일조차 없었음 —
  사후 작성). **사후 라이브 감사 결과 두 건 모두 자금 손실로 이어지는 Critical/High 결함 없음.**
  T-023 은 Reviewer 1차 감사에서 HIGH 1건(페이지 상한 도달 시 불완전한 목록을 성공으로 위장 —
  order-sync fail-closed 우회 가능성) 발견 → Developer 즉시 수정(`break`→`throw`) → Reviewer
  라운드 2 PASS → QA PASS. T-024 는 Reviewer 1차 PASS(Medium 2건은 배포 비차단으로 판단해 백로그
  이관) → QA PASS. **최종 회귀테스트 99 suites / 1478 tests 전부 통과, typecheck 0에러.** 두 건 다
  Leader 배포 권고 완료 — git commit/push 는 사용자(상위 세션)가 직접 처리. 재발 방지 백로그 1건
  신설(아래 Backlog "Reviewer 감사 없이 커밋되는 것을 막는 절차적 장치가 없다"). 상세: [[RESUME]]
  2026-08-13 절, 각 task 파일 "최종 요약" 섹션.

- [[T-024-manual-order-quantity-guard]] — **Reviewer PASS(Critical 0/High 0/Medium 2)→QA PASS 로 완결.**
  `POST /api/orders` 수동 주문 경로가 클라이언트가 보낸 `quantity`를 무가공으로 신뢰하던 구멍을
  T-020 의 `sizeOrderQuantity()` 재사용으로 막음(자동매매 엔진 2경로는 T-020 이 이미 정수화, 이
  수동 경로만 빠져 있었음). amountKRW만 있는 지정가 주문도 사전 정수 산출, 시장가는 기존처럼
  어댑터 위임(회귀 없음). Reviewer 가 찾은 Medium 2건(비-number quantity 가 시장가/가격없는
  지정가 한정으로 domestic 어댑터 가드까지 뚫고 무의미한 라이브 API 호출까지 도달 — 자금손실은
  아니고 이 엔드포인트를 호출하는 프론트엔드 자체가 현재 없어 실노출도 0에 가까움 + 그 경로
  테스트 커버리지 부재)는 배포 비차단으로 판단해 아래 Backlog 로 이관. 회귀 테스트 6건 신설,
  **최종 99 suites/1478 tests PASS.**

- [[T-023-getactiveorders-pagination]] — **Reviewer 1차 CONDITIONAL_PASS(HIGH 1건)→Developer 수정→
  Reviewer 라운드2 PASS→QA PASS 로 완결.** `getActiveOrders`(국내·해외 둘 다)가 KIS 연속조회
  (tr_cont/CTX_AREA_FK·NK)를 처리 안 해 미체결이 1페이지를 넘으면 뒤쪽 주문이 조용히 사라지던
  문제를 페이지 순회 루프로 재작성, 무한루프 방지 상한(20페이지) 포함. **Reviewer 1차 감사가
  "페이지 상한 도달 시 불완전한 목록을 성공으로 위장 반환"하는 HIGH 결함을 새로 발견**(order-sync
  의 fail-closed 판정을 우회할 수 있는 구조 — 현재 계좌 규모에선 사실상 도달 불가능하나 구조적
  결함) → `break`→`throw` 한 줄로 즉시 수정 + 다운스트림(`getActiveOrdersDetailed`) 분류 검증
  통합테스트 2건 추가 → Reviewer 라운드2 PASS(Critical/High/Medium 전부 0) → QA 실행검증 PASS.
  **최종 99 suites/1478 tests PASS**(신규 11건: T-023 원본 9건 + HIGH-1 수정 통합테스트 2건).
  실계좌 실측은 테스트 환경 제약상 미완 — 배포 후 로그 관찰 권고(유지).

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

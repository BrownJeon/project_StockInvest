# T-156 일일 수집·모의분석·예측 발행 복구

2026-11-10 · 상태: 구현/독립감사 진행. 최종 검증·운영 반영 완료 전이다.

사용자 승인: 당일 분할조정 일봉 누락과 수집·재시도 문제를 해결하고 실제 DRY_RUN 수집→모의분석→예측 발행을 확인한다. 실거래 OFF, 기존 가격/PIT/분할근거/owner/불변원장/lease 관문을 유지한다. v6 구성/M40 정책/에이전트 참고전용은 유지한다. 새 웹 버전은 0.3.0으로 한 번 준비하고 APK 변경은 없다.

## 직접 확인한 원인

| 항목 | 확인한 상태 | 복구 방향 |
|---|---|---|
| 일봉 | 세 번들 126종목×raw/split 모두11/06까지. 현재 원천 IBM은11/09 도착 | 제공 시각 뒤 유한 재수집, 캐시 퇴행 방지 |
| 시장 지수 | Node FRED 운송 오류. curl TLS정상이나CSV도11/05로2세션 부족 | bounded curl/기존 원문복구 + 공식 KIS SPX 검산 후 사용 |
| 모의/예측 | 11/09 모의blocked·T0null/revision2, 당일예측503 | 현재가격·보유분할근거 적격 통과 후 실제 forward/예측 |
| 실행 기록 | 202 예약접수가 실패로 기록됨 | accepted_pending과 실제 DB 완료 분리 |
| 재시도/발행 | 입력 hash 변화시 같은 세션 중복가능, 예약저장 실패 및 개장 경계 결함 | 세션고정 lease·기존 published guard, atomic 예약 실패차단, 실제 DBclock cutoff |

## 원천 계약과 시점

기존 KIS 공식 시세 GET의 N/SPX/D/FHKST03030100, 평가전용 INDEX/source ID로 순수 KIS 원문 페이지·요청·실수신시각·SHA를 보존한다. 70일 이하 구간 요청 후 정본 달력에서 실제 빠진 일자를 짧은 요청으로 추가한다. 16회/90초, 최소253/실제최후까지내부갭0, FRED 공통200일 decimal 정확 일치, source identity/원문/PIT가 필수다. 기존 INDEX 최대1세션 지연은 유지하며 producer는 당일까지 요청한다. FRED proof는 자신의 요청창과 실관측시각을 유지해 비교에만 사용한다. 서로 다른 원천 행을 FRED로 가장하지 않는다.

실제 probe는2025-09-05~2026-11-09 canonical297일/누락0, FRED공통295 전부정확/차이0. 총11GET, 신규토큰발급·계좌번호전송없음. 공개 보고는 kis-index-history-complete-probe.json, 실제 계좌 fixture/원문은0700/0600 private에만 둔다.

수집 ET06:45~08:45·예측 ET07:00~09:00에서 각각최대4회/30분, 실제 당일 forward 완료 후 예측한다. running lease/완료와202를 구분하고 주문 cron을 수분간 점유하지 않는다. 예약파일 atomic 저장에 실패하면 호출하지 않는다. 새 KIS GET만 opt-in 본문 시간·크기·취소를 공통 transport에 보강하고 기본 주문/시세 경로는 유지한다. 예측 및 forward commit에 실제 현재시각 next-open 경계를 재검사한다.

## 검증·운영 반영 계획

독립 Reviewer → 공식 C2 → Ubuntu 로컬 격리 QA/typecheck/build → 안전·기존원본 preflight → 정상 hook/정확SHA/단일webhook 배포 → 실수집/forward/T0/4기간예측/반복중복차단/만기전pending 확인 순이다. 중간545검사와 후속들은 중복 합산하지 않는다. 전체 cron J1은 중단/미완료, lint는 저장소 설정 부재로 미완료이며 이를 통과로 기록하지 않는다.

기존 DDL/보호트리거/권한/전역설정은 변경하지 않는다. 실패시 관문 유지, 코드복구와 이미 쓴 모의 원장/과거예측 보존을 구분한다. 공개가능 근거만 기존 테스트 이력 DB에 아카이브/재읽기 검산한다. private금액·수량·키는 제외한다.

미래 수익성·미보정 확률/84일·100왕복·20개입일·역사 구성/공시/뉴스 공백은 이번 복구와 별도다.

## 동결·통합 기준

제품36파일이0.3.0으로동결됐다. 독립감사와최종QA전에는배포하지않는다. 작업중다른세션T-012의문서/웹0.2.0이f98f55ac(운영20261110-173140-f98f55ac)으로전달됐음을확인해그커밋을부모로통합한다. T-012문서/roadmap은유지하고이번제품36파일외코드변경을싣지않는다.

혼합버전의레거시SQL까지신코드가소급보장한다고주장하지않는다. 컷오버직전/직후미만료forecast running=0,구web작업종료,cron각1및현재창밖을직접확인한다. 실제DBclock은쓰기전/commit직전에재검사하지만마지막검사응답과COMMIT완료사이의극히짧은지연을수학적으로제거하는것은아니다. 입력고정issuedAt과실제created_at을구분한다.

## F37 최종 실행 검증 및 전환 펜스 준비

- 제품36파일/웹0.3.0 동결 SHA dd10309601469101571e6dc9a7ee803e0c2a2e27d1550b930d875a724676e522. 독립 QA44suites788tests/cron2/type/build 및 network-none실MariaDB 경합/만료·개장경계rollback/가상시계5일emptysettle·commit·sidecar 통과. source전후36SHA일치, 합성DB/소켓정리완료. lint설정부재/넓은cronJ1중단은통과로표기안함.
- Reviewer CONDITIONAL_PASS: 새/구예측writer혼합위험은운영전환펜스필요. 실제09:08Z preflight는forecast/paperactivelease각0·구forecast10KST예약/개장321분여유·DRYtrue/8trigger·전역/권한불변이나oldweb는online이다. 단순전제추정으로최종수용/배포하지않는다. 마지막DBclock→COMMIT완료의비원자시간차는이번개장여유에서알려진수용한계,100%보장주장금지.
- 별도ops안: 독립모의계좌만배포동안paused로잠깐전환하면구/신publish/forward경제commit이모두거부한다. 구web종료/new각1/lease0/원경제SHA검산후active복구한다. 사용자승인일일복구의일시안전강화이며실거래/global/grant/정책/잔고변경없음. Root초안operator미실행,developer가readback/잠금경합/실패복구와격리하네스보강중→Reviewer→QA→Root실제pause→최종운영조건수용순. 모든DB쓰기(기존만기평가/usage/sourcearchive)전면차단이라고주장하지않는다.
- Ubuntu기존검증clone에서원격부모f98f55ac(T012문서/웹0.2.0)로제품36동일내용통합,회복stash75e2df2346f0634635a0129dce3ecb61fdc40e59보존. 현재branch codex/t156-daily-flow-repair-20261110/HEAD부모f98,제품워킹변경미커밋. root원작업트리는06b기반dirty유지. push/새배포/운영write는아직0. 최종commit은정상hook검사뒤한번push→webhook만,중복--yes금지.
- C2공식Jev는codex_required=true/data_integrity였으며AGENTS규정 `override: codex_unavailable_in_codex`기록·외부CLI실행안함. 정본 daily-flow-repair아티팩트 qa-daily-flow-receipt.json/reviewer-final.json/operator계획 및구현보고서. 운영완료를뜻하지않고전체T156 doing유지.


## F38 실제 펜스 증거 및 반영 준비

- 제품36/웹0.3.0·788검사/타입/build/실DB 검증 후 ops5파일·23case를 독립 수용했다. 09:34:44Z Root만운영pause를실행: 독립모의계좌paused/revision2/경제SHA7d7c5391…1443e·원forecast1/4/4 hashes보존/양activelease0/새연결readbacktrue. 09:35:07Z 별도읽기에서도일치·health200/DRYtrue/전역·앱권한·8trigger·환경/안전지문불변. 실계좌/실거래는변경없다.
- Reviewer reviewer-fenced-cutover.json 현전환PASS·36scope,코드legacy경합영구제거가아니라paused유지로HIGH완화라는제한을유지한다. QA는배정변경영향범위실행PASS/실제펜스증거수용,전역clientOrderId동일주문실행미확인을별도표시했다. user범위에없는전면주문보증을주장하지않으며추가ignored한정검사명령을개발자가준비중이다. 모든실API/운영orders테스트금지.
- 다음: 정상hook(484/실commitE2E차단통과)로동일36/정본문서만commit→정본deployer계획/단일mainpush webhook. 모의계좌paused유지. 새릴리스fullSHA·36SHA/oldrelease全프로세스0/newwebcron각1/양lease0/경제원장동일검사후검토operator로active복구/readback→실수집·forward/T0·4기간예측·재시도중복차단을운영에서검증한다. 아직새commit/push/새배포/수집/예측0이다.


## 최종 반영 전 검증 수용

독립 QA가 추가 동일 clientOrderId 순차·동시 직접함수(mock UNIQUE) 3건까지 통과한 뒤 T-156 변경·필수 안전 회귀 범위의 검증 통과를 선언했다. 운영 orders 고유키는 별도 읽기 metadata로 확인했으며 실운영 중복요청·HTTP 성공 replay는 검증/보장하지 않는다. 기존 788개 회귀·ops23·타입/build·정상hook484/실commit차단과 제품36SHA 불변을 함께 확인했다. Reviewer 현전환 수용과 paused 유지/전환후 검산 조건, 마지막 시계→commit 비원자 한계는 유지한다. 아직 웹 반영 및 실제 수집→분석→예측 결과는 후검증 대상이다.

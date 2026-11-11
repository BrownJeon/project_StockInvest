# T-156 무료 대체 일봉 원천 검토와 연결 계획

기준: 2026-11-11, 미국 11/10 마감분. 사용자 요청은 부족한 고정 후보 105종목을 무료 원천으로 보완하고 모의분석→4기간 예측 발행을 실제 확인하는 것이다. 신규 무료 원천 조사는 승인됐다. 실거래 OFF, 편도 수수료 0.25%, 고정 후보 123개와 실계좌 복제 모의 장부, 첫 적격일 T0 규칙은 유지한다.

## T-156 무료 대체 원천 0.4.0 검증 완료·운영 연결 준비 — F52/exec-095

- BRK.B 한정 coherent raw/split/KIS proof·일별 CA/SEC·원문/시간·same-analysis bundle·pending/음성격리·원천전환 사후비교 보호 구현43파일을 동결했다(manifest80ea3265…f30953/productDigestc8e1eee8…b948f0). 제품 Reviewer 범위감사·공식Jev C2와 codex_unavailable_in_codex override·독립 QA를 마쳤다. 외부Codex재귀검토는 실행하지 않았다.
- QA는 최종동결본 31 suites/509 tests, 별도 안전22 suites/480 tests, 독립typecheck0·실보관원문raw/split각297 재생·사건증거/NYday차단, 실제격리InnoDB 공통락/차단3건·기존fence core23건을 통과했다. 서로 겹친 시험은 합산하지 않는다. 개발자동결 type/build0·양환경43SHA불일치0을 확인했다. QA 초기Mac Docker없음과합성fixture형식3실패는 별도기록했고제품수정은없다. 전용network-none DB/소켓/임시폴더는제거확인했다.
- BRK기업행동/SECmetadata·8K/EX/424원문과양성대조 등10원문731562bytes를 별도연구dataset event-src-a1ddbac9f7869dc4c61a920dcc918fd328faac482d1491ee에 저장/재읽기10검산했다. finite no_conflicts_reported_asof이며 10Q는공식표지/자본주석targeted만검토·rawSHA없음,CA보고지연/심볼coverage·NYSE11/09·발행사403한계는그대로다. 새미검토material/기업행동/미완료durable pending은차단한다.
- 새모의계좌펜스 wrapper e1831b…d22c7/policy053972…13f7b는 기존core/proof/process SHA를유지해별도Reviewer조건부정적수용했다. core해시검사후동적import·freshrevision3경제/원예측baseline·old0.3미성숙target0·실Next.env loader/cron위임·fullrelease/oldworkerdrain을검사한다. 실제메모리/실API사용은정상흐름으로후확증한다. 실패시모의계좌paused유지,실거래/전역/앱권한/보호trigger불변이다.
- 18:50KST fresh읽기에서 운영0.3/04afa·active/rev3/T0null·원예측1run4horizon4pending·paper/forecastlease0·healthdrytrue/killfalse·source145cda55/후보122of123상태를확인했다. 정본0.4배포/새profile2경로설정·모의재개·정상수집→첫forward/T0→새4기간발행·중복·실앱확인은아직완료전이다. 이미받은구현/운영반영/키승인을반복요청하지않는다.

## 기업행동·공시 근거와 운영 수용 범위 (최종 감사 전)

BRK.B의 일관된 raw/split 가격 쌍 외에, 판단·발행 시점의 뉴욕 날짜로 새 Alpaca 기업행동 조회와 SEC 제출 목록을 받는다. 가격 캐시가 남아 있어도 사건 증거는 당일 새로 검증한다. 기업행동 조회는 2000-01-01부터 조회일의 처리일 기준, 모든 유형·품질, 완결 페이지를 요구한다. 빈 응답은 `no_conflicts_reported_asof`이며 분할 부재나 전체 역사 완전성의 증명이 아니다. 지연 신고·정정·빈 응답의 심볼 확인 한계는 남는다. 유한 v1에서 새 기업행동이나 미검토 중요 공시는 자동 추정하지 않고 차단한다.

| 근거 | 실제 확보·검토 범위 | 남은 한계 |
|---|---|---|
| Alpaca BRK.B 기업행동 | 11/11 실제 수신, 빈 전체 유형·품질 응답, 끝 페이지 null | 처리일과 공시·효력 발생일은 다르며 지연·정정·심볼 누락 가능 |
| SEC 제출 목록 | Berkshire CIK·BRK-B/NYSE 신원, 최근 14일 이상 병렬 목록·접수 시각 검산 | 목록이 전 세계 공시 부재를 입증하지 않음 |
| 11/09 8-K와 EX99.1 | 두 원문 전체 저장, 실적 발표·기존 A/B 전환 관련 범위 검토 | 모든 기업행동의 부재 증명 아님 |
| 11/09 424B5 | 원문 전체 저장, 엔화 무담보 채권 예비 투자설명서 범위 검토 | 조건부 조항과 실제 주식 사건을 구분 |
| 11/09 10-Q | 공식 SEC 표시본의 표지와 자본 주석 대상 검토 | 전체 원문은 512KiB 상한 초과로 미보관, raw SHA 없음 |
| Form 4 두 건 | 제출 목록의 소유 변동 메타데이터 | 원문 재무·가격 기준 검토로 간주하지 않음 |
| NYSE 공개 MEF | 15개/끝 페이지, 11/10~11/24 효과일 범위 | 11/09 전체 사건 완결 자료 아님 |
| Berkshire 발행사 페이지 | 접근 실패/403 기록 | 우회하지 않았으며 근거로 승격 안 함 |

NVDA·NFLX의 알려진 분할이 동일 기업행동 API에서 반환되는 양성 대조를 확인했다. 이는 해당 endpoint의 작동 확인이며 BRK.B 심볼·전 기간 완결성의 증명은 아니다. NFLX 분할 전 가격의 10배 exact는 2/12만 일치했고, 분할 후16/16·거래량7/7이었다. 반올림 진단을 수용 오차로 쓰거나 BRK.B 규칙을 완화하지 않았다.

원천 증거 원문 10개/731,562bytes는 실제 DB dataset `event-src-a1ddbac9f7869dc4c61a920dcc918fd328faac482d1491ee`에 저장하고 10개 모두 다시 읽어 SHA를 확인했다(09:15:32 UTC). `liveEligible=false` 연구 근거이며 이 저장만으로 모의분석용 가격 번들을 교체하지 않는다. 최초 수신·SEC 접수 시각과 미보관 사유를 구분한다. 별도 중간 테스트 이력 `artifact-e1fb2a02c123af86da1afd660b27d3e7`은 이후 0.4 최종 코드·운영 결과를 포함하지 않는다.

0.4 구현은 동일 분석 번들 SHA에 예측을 고정하고, 최신 번들이 달라지거나 알려진 부정 근거가 있으면 발행을 차단한다. 새 수집 전 검증 진행 표식을 먼저 원자적으로 저장해, 실패 근거를 저장하지 못해도 이전 정상 자료가 바로 부활하지 않도록 한다. 해당 표식·격리 보존의 마지막 독립 검증이 진행 중이다. 실제 source publication·forward/T0·4기간 발행은 아직 확인 전이다.

## 최신 연결안 — 실제 무료 권한·BRK.B 원천 쌍 검산 후 구현 중

사용자가 무료 계정과 키 등록을 완료했다. Alpaca 역사 SIP를 실제 2 GET으로 조회해 raw/split 각각 AAPL·BRK.B의 297거래일을 받았다. 첫 실행은 상위 폴더 그룹 쓰기 권한으로 API 전 0 GET 차단됐으며, 조건을 낮추지 않고 별도 사용자 홈 보호 폴더(0700)로 옮겨 실행했다. 앱 계정 권한·DB 전역 설정은 바꾸지 않았다. 키와 응답 헤더는 원천·검증 이력에 넣지 않는다.

**초기 추가 수용 조건은 실측 후 수정했다.** 처음 제안한 ‘신규 raw가 Kibot raw 시가·종가와 공통 200일 exact’는 통과하지 못했다. BRK.B split은 Kibot와 295/295 일치했지만 raw는 달랐다. 이를 수치 허용오차로 통과시키지 않았다. 공식 KIS 보관 master의 BRK/B 매핑을 확인하고 cached-token 읽기 전용 3 GET을 추가해 아래 교차검산을 수행했다. 두 API가 상위 SIP를 공유할 수 있으므로 독립된 거래소 두 곳의 관측이라고 표현하지 않는다.

| 비교 | 시가 | 종가 | 의미 |
|---|---:|---:|---|
| KIS native USD raw ↔ Alpaca raw | 297/297, 최근200/200 | 297/297, 최근200/200 | BRK.B 새 raw의 별도 수집 API 교차검증 |
| 기존 Kibot split ↔ Alpaca split | 295/295 | 295/295, 최근200/200 | 기존 조정 이력 연속성. 새 11/09·10은 구 원천에 없음 |
| Alpaca raw ↔ Alpaca split | 297/297 | 297/297 | 같은 공급자 쌍. OHLCV 전 필드도 297/297 |

KIS↔Alpaca의 고가·저가는 각각296/297, 거래량112/297이다. Kibot split↔Alpaca split의 고가·저가는293/295, 거래량112/295이다. 따라서 공급자 전 필드 일치나 고저가·거래량 지표 적격으로 일반화하지 않는다. 현재 M40 수치·체결·예측이 소비하는 시가·종가를 검증 대상으로 삼고 각 원문의 OHLCV 형상·양수성·무결성은 별도로 검사한다.

독립 리뷰는 BRK.B에 한해서 `KIS raw 시가/종가 ≥200 exact + 기존 Kibot split 연속성 ≥200 exact + 기존 장부/PIT/253일 관문 유지`를 새 후보 수용 근거로 검토할 수 있다고 판단했다. 기존 모든 주식에 적용돼 있던 공통 안전장치를 완화한 것이 아니라 이번에 제안했던 대체 원천 수용 기준을 사후 수정한 것이며, 수정 사실·실측 근거·한계를 보존한다. AAPL이나 공급자 전체를 승인하지 않는다.

split만 교체하면 기존 raw와 공급자 종가 정의 차이가 예측 입력의 `raw.open × split.close / raw.close`에 섞인다. 일별 종가 수익률에서는 일부 비율이 소거돼도 야간/장중 분해·개장 체결 모의에 영향이 있을 수 있다. 따라서 **BRK.B raw+split 한 쌍을 원자적으로 채택**하는 방향으로 구현한다. 두 기준 중 하나만 넣거나 다른 공급자의 행을 이어 붙이지 않는다. 향후 실제 분할 등으로 이 v1 쌍의 사전등록 조건이 달라지면 자동 추정하지 않고 조정 검토 전 차단한다.

16:40 KST 읽기 전용 장부 점검과 QA 재검산에서 현재 BRK.B 보유분과 BRK.B 장부 분할 기준점은 없었다. 존재하는 다른 네 기준점은 기존 검사 범위 안에서 유지됐고, 같은 장부에서 BRK.B raw만 바꾼 비교 평가액 차이는 0%였다. 기존 현금·수량·최초투자금·기존 예측은 수정하지 않았다. 기록된 intent는 rehearsal4/awaiting0이다. source-ready 부족의 현재 원인은 후보군 BRK.B 자료이며 과거 blocked 행의 오류명을 BRK.B 실보유 증거로 쓰지 않는다.

구현에는 진짜 provider 식별/원문 손실 없는 숫자 파싱/페이지 SHA 연쇄·시각·신원·공유 수집 예산, 현재 source-ready 판정과 예측이 쓰는 **동일 bundle/hash 자체 검증**, 안정적인 공급자 기준 fingerprint를 포함한다. 기존 예측 원장은 그대로 두고, 만기 전에 pending을 유지하며 공급자 기준이 바뀐 이후의 사후비교는 비교 가능성이 입증되지 않으면 actual 없이 unconfirmed/incomparable로 남긴다. 새 기준 예측은 새 기준점으로 별도 고정한다. UI·DDL·주문/실거래 변경은 없다. 준비하는 새 웹 릴리스는 0.4.0으로 한 번 증가하며 아직 운영은 0.3.0이다.

공식 C1 delta는 `codex_required=true/data_integrity`였고 AGENTS 규칙의 `override: codex_unavailable_in_codex`를 기록했다. 코드 독립감사·C2·QA·정본 배포와 실제 forward/T0→신규 4기간 발행 확인은 아직 남았다. 원천 원문 검산 통과와 제품/전체 흐름 통과를 구분한다.

## 기존 원천 재수집 결과 — 16:12 KST

07:06 UTC에 기존 공급자 2종목×2basis를 제한 조회해 일부 갱신을 확인했다. 이어 16:07:28 KST 정상 `m40-forward`를 한 차례 더 실행했고, 16:11:59 상태 조회에서 worker 종료/blocked를 확인했다. 202 접수와 실제 종료를 구분했다. 새 대체 공급자로 자료를 넣은 것이 아니라 기존 무료 원천의 새 판본을 정상 경로로 수집한 결과다.

| 항목 | 시작 시 | 재수집 후 |
|---|---:|---:|
| 고정 후보 자료 적격 | 18/123 | **122/123** |
| 고정 후보 자료 부족 | 105 | **1 — BRK.B** |
| 전체 수집 대상 raw 최신 | 18/126 | **126/126** |
| 전체 수집 대상 split 최신 | 96/126 | **125/126** |
| 실제 정상 forward/T0 | 0/미정 | **0/미정** |
| 새 4기간 예측 | 0 | **0 — 안전 차단 유지** |

- 부족했던 후보 **104개가 복구**됐다. 새 원문 판본은 `paper-src-145cda55a56a44bea875a80c25d3170ce06a2cb9bb83de1b`로 운영 DB에 보존됐다. 원문 252개와 FRED SP500 297일/11/10을 유지한다.
- BRK.B split은 295행·11/06까지로 11/09·11/10 두 행이 없다. 원문 SHA는 이전과 같지만 성공적으로 다시 수신해 관측 시각은 새 시각이다. 과거 HTTP502 실패에서 원본 전체를 유지했던 경우와 구분한다.
- 독립 QA는 252개 원문 SHA/CSV 행 재생성 오류0·이전 날짜 범위 퇴행0·마감 전 수신0, 253 필수 거래일 기준 후보122/123을 재계산했다. 이번 새 HTTP 실패는0이며 이전 두502 이력은 보존됐다.
- 15:57→16:12 운영 읽기 비교에서 paperAccount/paperCycles/paperSignals/safety 지문, revision3/T0null, 원예측 SHA/1run·4horizon·4pending, 보호8trigger·전역/앱권한/환경·안전 지문, web/cron 프로세스, orders 상태별 건수는 같다. 개별 주문 행 전체 불변을 보증하는 검사는 아니다.
- 원장 연결 검산은 `status=pending`, issues0, 실제 forward0·신규 signal0·새 forecast0이다. 필수 자료 미달이므로 예측 API를 강제 호출하지 않았다. 사후비교 pending4는 기존 예측이며 새 발행으로 계산하지 않는다.
- Alpaca 비운영 읽기 전용 probe는 독립 정적 검토 조건부 수용 및 독립 합성24/24 통과다. 실제 Alpaca 키·API 조회는0이며 제품·배포·자료 적격성·전체 흐름 통과 판정이 아니다. 최신 private script SHA `7535f2865e2bb32841c72a4b4017ba40291551fb3faf3c954353cdf74505fe35`, test SHA `ec550b6df97043d78f72e01ed330e9cb99a60df025d8b52fdf4d3b182db8648a`.

이 점검 당시 남은 단계는 BRK.B의 적격 split 전체 시계열 확보였다. 이후 키 등록과 원천 검산 진전은 문서 맨 위에 기록했다. 무한 재수집·후보 제외·안전 조건 완화는 하지 않았다. 이 재수집 자체에는 제품/버전/배포 변경이 없었다.

## 작업 시작 시 확인한 결과

- 기존 수집 대상 126개는 후보 123개와 장부용 추가 종목을 포함한다. 최신 DB 번들에서 raw 18/126, split 96/126만 11/10까지 있고 고정 후보 중 105개가 양 기준 동시 충족에 미달했다. BRK.B split은 11/06까지다.
- 정상 경로의 즉시 수집 2회 결과는 이미 원문·SHA·실수신 시각과 함께 DB에 보존했다. 정상 forward 0, T0 미정, 새 예측 0이며 기존 예측 1건·4기간·사후비교 대기 4건을 보존했다. 이 문서 작성으로 완료 상태가 바뀌지 않는다.
- KIS raw 표본은 실제 4 GET으로 확인했다. AAPL은 297일/11/10까지 있지만 기존 Kibot와 종가 decimal 정확 일치가 전체 23/297, 최신 공통 15/200이다. 파싱·SHA 검산으로 설명되지 않는다. BRK.B 문자 그대로의 요청은 응답 identity 부재·0행이었다. 대체 수용하지 않았다. 원문 가격·인증값은 공개 문서에 넣지 않는다.

## 무료 원천 비교

| 원천 | 확인한 장점 | 현재 제한과 조치 |
|---|---|---|
| Kibot 기존 guest | 기존 split-only/raw 계약과 원문 이력 존재 | 최신 행 지연을 현재 해결하지 못함. 원본 유지, 누락을 추정하지 않음 |
| KIS 일봉 | 기존 인증, native USD raw 표본 297일 확보 | raw 가격 정합 미달, BRK.B identity 미확인. MODP=1의 배당 범위 미확인. 적용 안 함 |
| Alpaca Basic 역사 일봉 | 공식 API가 raw와 split을 배당 조정과 구분. SIP·USD·기간·페이지 명시 가능 | 키 없음. Paper Only의 IEX 한정 안내와 역사 SIP 무료 안내가 달라 실제 권한 확인 필요. 일봉 마감 정의·가격 정합·BRK.B identity도 미검증. 현재 후보일 뿐 |
| Alpha Vantage | 공식 API와 무료 범위 안내 존재 | 무료 compact 100행, full/adjusted 제한과 키 필요. 현재 253거래일 필수 조건을 충족하는 해법으로 확인되지 않음 |
| Yahoo | 화면의 Close/Adjusted Close 정의 구분 | 자동 수집 허가·chart OHLC 계약 미확인 및 약관 제한. 우회 수집 0회, 연동하지 않음 |
| Stooq 등 공개 CSV | 가입 없는 후보로 조사 | 공식 가격 조정·통화·자동 수집 허가·원문 계약을 확인하지 못함. 단순 다운로드 성공을 적격 근거로 쓰지 않음 |

## Alpaca를 사용할 경우의 구체 계약 초안

실제 권한 및 원천 검증 전에 운영 원천으로 채택하지 않는다. 무료 Basic/Paper 계정의 데이터 키는 보호 파일에 사용자가 직접 등록하도록 안내했다. 신규 유료 계약·입금·주문 연동은 범위에 없다. 보호 파일은 저장소 밖 0600이며 키는 채팅·로그·자료 번들·테스트 이력에 포함하지 않는다.

필요한 입력은 구현 승인의 재확인이 아니라 신규 공급자의 인증값이다. [공식 Paper 안내](https://docs.alpaca.markets/us/docs/paper-trading)에서 무료 Paper Only 계정으로 [공식 대시보드](https://app.alpaca.markets)에 가입/로그인한 뒤 발급한 Paper 키를 보호 파일 `/Users/brownjeon/.codex/tmp/t156-free-source-20261111/alpaca.env`의 `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY` 두 빈 값에 직접 등록한다. 값은 채팅에 보내지 않고 등록 완료만 알린다. 무료 플랜을 유지하며 브로커 실계좌 개설·유료 전환을 대신 수행하지 않는다. 키 등록 자체로 원천 채택이나 예측 발행을 자동 승인/완료 처리하지 않는다.

| 항목 | 필수 조건 | 미충족 조치 |
|---|---|---|
| 목적지·방법 | `GET https://data.alpaca.markets/v2/stocks/bars` 하나, TLS 검증, redirect 0. 주문 호스트 사용 0 | 네트워크 요청/자료 거부 |
| feed·통화·조정 | `feed=sip`, `currency=USD`, `timeframe=1Day`, `adjustment=raw` 또는 `split` 한 개 | IEX·dividend·spin-off·all·묵시적 기본값 수용 안 함 |
| identity·기간 | 응답 심볼과 고정 거래소 심볼 매핑 입증, `asof`는 목표 세션, start/end 고정 | alias 추정·다른 종목 자료 대입 금지 |
| PIT | 실제 수신 UTC 기록. `asof`는 심볼 식별용이며 과거 입수 가능성 증명이 아님 | 수신 시각 소급 금지. 현재 수신 자료로 과거 판단을 재현했다고 표시하지 않음 |
| 원문·페이지 | 각 응답 body·SHA·HTTP·시각과 page-token 연쇄 보존. null token까지 완결 | 중간 실패·반복 token·예산 초과면 해당 전체 basis 거부 |
| 일봉 의미 | 미국 정규장 OHLC의 기존 가격·거래일 의미와 정합 입증. Alpaca는 NY 날짜와 거래조건별 집계를 쓰며 연장시간 거래량을 포함하므로 모든 필드가 정규장 전용이라고 표시하지 않음 | 장후 종가·단일 거래소 가격 등 의미가 다르면 자동 대체 금지 |
| 수치·이력 | 원문에서 OHLCV 전부 재생성, hash/rows 대조, 현재일 및 필요한 장부 기준일·253 canonical 거래일·내부 갭 0 | 반올림/임의 허용오차/행 추정으로 통과시키지 않음 |
| 교차 원천 검증 초안 | 기존 원문과 공통 200일 종가 및 raw 시가 exact 검산, 장부 기준일 정합. 모의체결은 raw open을 사용하므로 종가만 비교해서 통과시키지 않음. 이 기준은 대체 원천 채택을 위한 추가 검토안이며 기존 모든 주식 원천에 이미 적용됐다는 뜻이 아님 | 차이가 있으면 정의·정밀도·corporate action 원인을 조사하고 현재는 차단. 근거 없는 수치 완화 없음 |
| 기업행동 기준 | target 이후 분할 소급 반영 여부를 별도 사건 근거와 raw↔split 당일 기준 및 장부 sharebasis로 검사. 심볼 asof나 request end를 조정 기준일 증거로 쓰지 않음 | 이후 사건으로 기준이 변했거나 설명되지 않으면 거부 |
| 교체 방식 | 종목·basis별 단일 원천의 전체 시계열 선택. 기존 원문/수신 시각 보존, 날짜 범위 퇴행 없음 | 다른 원천의 일부 행 이어 붙이기 금지 |
| 요청 예산 | 기존 최대 150종목·301요청·응답512KiB·총20MiB·7분·1초 간격·연속실패3의 유한 예산을 공급자 간 공유 | 401/403/429 및 예산 초과 중단, 새 경로로 예산 리셋 금지 |
| 자격 | evaluation_only/liveEligible=false, 실제 키로 무료 SIP 권한 검증 | 권한 실패를 IEX 자동 대체·유료 결제로 해결하지 않음 |

기존 Kibot로 먼저 수백 회를 소진한 뒤 같은 일일 작업에서 새 원천을 추가로 수백 회 호출하면 예산을 넘긴다. 현재 301회/7분 한도는 `collectForwardSources` 안의 지역 한도이며, runtime의 지수 복구는 별도 경로다. 공급자와 지수 복구까지 한 실행 예산으로 묶는 것은 새 구현·회귀로 입증할 사항이며 현재 운영에 이미 보장된다고 말하지 않는다. 대체 원천 검증 후에는 시작 시 누락 종목에 대한 원천 선택을 확정하고 한 공유 예산으로 수집해야 한다. 이 선택 정책과 재시도 예산은 C1·독립감사 대상으로 둔다.

## 구현·검증·운영 연결 순서

1. 실제 무료 권한과 AAPL/BRK.B의 원문 표본을 보호 폴더에서 확인한다. 신규 계정 생성·약관 동의는 사용자 수행이며 기존 관리자 권한이나 DB 보안 설정을 바꾸지 않는다.
2. source 계약과 가격 정합을 통과할 때만 C1 뒤 provider 별 순수 검증기/읽기 전용 adapter를 구현한다. 기존 mapper/collector 연결은 최소화한다. 제품 버전은 실제 새 릴리스 준비 시 0.4.0 한 번만 확정하며 현재 0.3.0은 유지한다.
3. Ubuntu 로컬 격리에서 실패·변조·PIT·페이지·예산·원천 퇴행·raw/split 혼동·원장 기준일 시험과 기존 영향 회귀를 실행한다. Reviewer→C2→QA를 거치며 실제 자료 미확보를 합성 시험 통과로 대신하지 않는다.
4. 검토된 코드만 정본 배포 절차로 반영한다. 필요하면 독립 모의계좌에만 일시 정지 펜스를 쓰고 새 원장 상태로 사전 스냅샷/복구 검산한다. 실거래/전역 보안/앱 권한/보호 트리거/기존 정책은 유지한다.
5. 정상 수집 API→원문 DB 저장→고정 123후보·장부 자료 적격→정상 forward/T0→새 1주·1개월·3개월·1년 예측 원장 저장→동일 세션 재호출 중복 차단→만기 전 actual 없음/pending을 실제 DB로 확인한다. 다음 개장 뒤 지난 세션을 소급 발행하지 않는다.
6. 실제 자료는 원천 DB에, 가린 검증 영수증은 기존 별도 testartifact/blob 이력에 저장하고 재읽기 SHA를 확인한다. 기존 원예측과 모의 경제 장부 보존·DRY_RUN을 전후 비교한다.

이 절은 작업 시작 시 계획이며, 최신 단계는 상단 F52의 제품 검증 완료·실운영 연결 대기다. 무료로 조회 가능하다는 문서만으로 105종목 복구나 4기간 발행을 완료했다고 표시하지 않는다. 키가 없거나 원천 계약이 미달하면 부족한 기간·종목·사유를 남기고 기존 안전 차단을 유지한다.

15:57 KST 읽기 재검산: health200/DBtrue·DRY_RUNtrue, 계좌 active/revision3/T0null, 양 lease0, 기존 1run/4horizon/4pending와 원본 SHA 보존, 보호8trigger·전역/앱권한/안전/환경 지문 불변. filled17은 같고 dry_run은 이전 즉시 점검의575에서576이므로 orders 전체 건수 불변이라고 표기하지 않는다. 이 새 원천 준비 작업에서는 수집/전진/예측/주문/설정변경을 실행하지 않았다.

## 공식 근거

- [Alpaca 역사 일봉 API](https://docs.alpaca.markets/us/reference/stockbars): adjustment·asof·feed·currency·pagination 계약.
- [Alpaca Market Data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq): 역사 SIP 조회에서 end 15분 지연 조건과 권한 오류.
- [Alpaca Paper Trading](https://docs.alpaca.markets/us/docs/paper-trading): 이메일 기반 전세계 Paper Only 가입, Paper Only IEX 권한 안내. 역사 SIP와의 적용 관계는 실제 확인 필요.
- [Alpaca 데이터 플랜](https://docs.alpaca.markets/us/docs/about-market-data-api): Basic 무료 및 역사 범위·요청 한도.
- [KIS 공식 dailyprice 예제](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/overseas_stock/dailyprice/chk_dailyprice.py): MODP 0/1 설명. 배당 범위 보증과 구분.
- [Alpha Vantage 공식 문서](https://www.alphavantage.co/documentation/): DAILY/DAILY_ADJUSTED 및 출력 제한.
- [Yahoo 공식 약관](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html): 자동 수집 제한 검토.

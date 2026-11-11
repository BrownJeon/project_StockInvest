---
project: StockInvest
updated: 2026-11-11
tags:
  - type/context
aliases:
  - 이어서 작업
  - RESUME
---

# ▶ 이어서 작업 — 재개 진입점

## T-156 무료 대체 원천 0.4.0 검증 완료·운영 연결 준비 — F52/exec-095

- BRK.B 한정 coherent raw/split/KIS proof·일별 CA/SEC·원문/시간·same-analysis bundle·pending/음성격리·원천전환 사후비교 보호 구현43파일을 동결했다(manifest80ea3265…f30953/productDigestc8e1eee8…b948f0). 제품 Reviewer 범위감사·공식Jev C2와 codex_unavailable_in_codex override·독립 QA를 마쳤다. 외부Codex재귀검토는 실행하지 않았다.
- QA는 최종동결본 31 suites/509 tests, 별도 안전22 suites/480 tests, 독립typecheck0·실보관원문raw/split각297 재생·사건증거/NYday차단, 실제격리InnoDB 공통락/차단3건·기존fence core23건을 통과했다. 서로 겹친 시험은 합산하지 않는다. 개발자동결 type/build0·양환경43SHA불일치0을 확인했다. QA 초기Mac Docker없음과합성fixture형식3실패는 별도기록했고제품수정은없다. 전용network-none DB/소켓/임시폴더는제거확인했다.
- BRK기업행동/SECmetadata·8K/EX/424원문과양성대조 등10원문731562bytes를 별도연구dataset event-src-a1ddbac9f7869dc4c61a920dcc918fd328faac482d1491ee에 저장/재읽기10검산했다. finite no_conflicts_reported_asof이며 10Q는공식표지/자본주석targeted만검토·rawSHA없음,CA보고지연/심볼coverage·NYSE11/09·발행사403한계는그대로다. 새미검토material/기업행동/미완료durable pending은차단한다.
- 새모의계좌펜스 wrapper e1831b…d22c7/policy053972…13f7b는 기존core/proof/process SHA를유지해별도Reviewer조건부정적수용했다. core해시검사후동적import·freshrevision3경제/원예측baseline·old0.3미성숙target0·실Next.env loader/cron위임·fullrelease/oldworkerdrain을검사한다. 실제메모리/실API사용은정상흐름으로후확증한다. 실패시모의계좌paused유지,실거래/전역/앱권한/보호trigger불변이다.
- 18:50KST fresh읽기에서 운영0.3/04afa·active/rev3/T0null·원예측1run4horizon4pending·paper/forecastlease0·healthdrytrue/killfalse·source145cda55/후보122of123상태를확인했다. 정본0.4배포/새profile2경로설정·모의재개·정상수집→첫forward/T0→새4기간발행·중복·실앱확인은아직완료전이다. 이미받은구현/운영반영/키승인을반복요청하지않는다.

## T-156 BRK.B 일관된 원천 쌍·원천 전환 보호 구현 중 — F51/exec-094

- Alpaca실제2GET297일중 BRK.B split은구Kibot295/295일치하지만새raw는구Kibotraw와불일치했다. 최초추가제안rawKibot200exact를그대로통과했다고표시하지않았다. 공식KISmasterSHA634f61d3…ff61e0의NYS/BRK/B고유매핑을확인해cachedtoken신규3GET(누적KIS7,새토큰0)으로nativeUSD원주를받았다. KIS↔AlpacaRAW OPEN/CLOSE297/297·최근200/200/최신11/10일치, 구KibotSPLIT↔AlpacaSPLIT OPEN/CLOSE295/295·최근200/200으로 BRK한정대체후보근거가생겼다.
- 두API의상위SIP공유가능성을열어두고별도수집API교차검산이라고표현한다. 사후수정한추가수용조건은KISraw시가종가200exact+기존조정이력연속성200exact이며종래주식253/PIT/sharebasis/owner/불변·clock·fee관문완화가아니다. AAPL/다른종목/공급자전체로승격하지않는다. KIS와Alpaca H/L296/297·V112/297, 구Kibot과Alpaca조정H/L293/295·V112/295이므로crossprovider전OHLCV동일주장/새고저가거래량지표적격은금지한다.
- Reviewer는forecast가raw.open*(split.close/raw.close)로야간·장중수익률을분해하므로BRKsplit만바꾸는혼합안에공급자정의차이가계수로섞일수있음을발견했다. 일별종가곱의상쇄와향후개장체결/경로영향을구분한다. BRK한정AlpacaRAW+SPLIT동일시점한쌍원자선택으로구현하며within-Alpaca전297일OHLCV동일사전조건을검사한다. 향후실제분할등으로v1조건불명확해지면추정없이차단/조정검토한다.
- QA가저장원문/receipt/master/297canonical/중복2·창밖1을Decimal로독립재검산했다. 기존125당일완비종목은그날raw/split close같음,BRK만최신공통일11/06에서다름;최근200일차이가있는추가5개는분할/정밀도가능성이있어오류로일괄판정하지않는다. 날짜적격122와외부가격정합확인을구분한다.
- Root16:40읽기SELECT/READ ONLY/ROLLBACK및QA보관기준본검산: BRK현재미보유/BRK전용priorbasis없음,다른4prior기존관문통과/초기자본·현금·수량불변·rehearsal4/awaiting0. 같은장부에서BRKraw만교체하는비교평가차이0%,실제손익이나장부재기준설정아님. 과거blocked사유를BRK실보유증거로삼지않는다.
- C1delta공식Jev codex_required=true/data_integrity, AGENTS overridecodex_unavailable_in_codex/재귀CLI미호출기록. developer가0.4.0을한번준비해신규lossless JSON/provider계약·cachedKISproof/보호프로필·공유데이터요청예산/페이지·동일bundle/hash재검증·source-regime기준의만기사후비교보호를구현중이다. 기존index인증통신은데이터요청301과별도임을명시하고전체deadline은공유한다. UI/DDL/실주문/운영설정수정없음. 원forecast1/4pending은불변,목표일전pending/원천비교불명확하면incomparable또는unconfirmed·actualnull테스트를포함한다.
- 현재운영은0.3.0/04afa·기존source145cda55/실제forward0·새forecast0/T0null·실거래OFF다. 새원천원문은보호폴더이며운영계약발행전이다. 다음은developer동결/격리시험→Reviewer/C2→QA→정본배포(필요시모의계좌fresh펜스)→정상수집/첫T0·모의분석·신규4기간/중복·pending검증→testDB이력저장이다. live/global/grant/보호trigger/가격·시간관문을그대로유지한다. 구현승인·키등록·현재자료수용검증을반복요청하지않는다.

## T-156 104종목 DB 복구·무료키 실조회 성공 / 대체 자료 검증 중 — F50/exec-093

- 시작시고정후보105부족에대해Kibot4GET제한조회로갱신확인후16:07:28KST정상수집1회를추가실행,16:11:59blocked종료/16:12DB검산. raw126/126·split125/126최신11/10,고정후보122/123적격으로104개회복/BRK.B1개부족이다. BRK.B split295행/11/06·11/09/10갭2;누락후보제외/추정행대체없음.
- 새원문판본paper-src-145cda55a56a44bea875a80c25d3170ce06a2cb9bb83de1b를운영DB보존. QA는252원문SHA·CSV전수재생성/253canonical검산·이전날짜퇴행0·마감전관측0·신규HTTP실패0(이전502이력2유지)를독립확인했다. 성공적으로다시받은낡은BRK.B본문은SHA같지만실수신시각이갱신됐으며실패시원문보존사례와구분한다.
- 15:57→16:12KST paperAccount/paperCycles/paperSignals/safety지문·revision3/T0null·원forecast1/4/4pending·보호8trigger/전역/앱권한/환경/안전·web/cron·orders상태별건수동일. 개별orders전수동일보증아님. 원장검산pending/issues0/실제forward0·신규signal0·새forecast0,자료미달로forecast강제호출0.
- 조사+비운영probe독립24합성검사+실수집QA·실제가린근거16파일/27633bytes를testartifact/blob에저장하고재읽기확인: artifact-e1fb2a02c123af86da1afd660b27d3e7 / SHA e1fb2a02c123af86da1afd660b27d3e74e1436f3bc03bcea60a589d838b0b0dd. 실제가격본문/실계좌fixture/인증키미포함. 원천실자료는별도sourceDB에보존했다.
- 사용자무료계정·키등록진행응답과실제보호파일등록완료지시를받았다. Ubuntu동일SHA privateprobe24합성재확인후Alpaca실제SIP2GET200, AAPL/BRK.B각raw/split297행2025-09-08~2026-11-10확보/관측07:21:02~03Z. paid/live주문요청0. 최초probe는groupwritable.node-local상위로0GET차단,글로벌권한변경없이별도home보호폴더700로옮겨실행했다. 키값·HTTP오류본문/응답헤더출력·저장없음.
- 실제무료권한·페이지완결은확인됐지만200공통시가/종가·253canonical·기업행동/PIT·장부기준검산전신규원천채택0이다. sourceagent독립검산중/C1Jevsecurity개입필요는AGENTSoverridecodex_unavailable_in_codex기록. developer는genericoptional계약·공유예산설계를준비하며실자료정합통과뒤제품구현→Reviewer/C2→QA/정본배포→실제전진·4기간검증순이다. 현재제품0.3.0/버전/배포변경0·실거래OFF. 전체T156 doing·장기표본/확률보정과제유지.

## T-156 무료 대체 원천 조사·보완/전체 흐름 검증 진행 — F49/exec-092

- 사용자105종목무료보완지시로기존Kibot외원천을검토중이다. KISraw실제4GET표본AAPL297일/11/10확보하였으나Kibot exact23/297·최근15/200이고BRK.B identity부재/0행으로미채택. 새토큰/운영DB쓰기/제품변경0,원문·가린영수증보존.
- Alpaca Basic의공식raw/split/SIP·무료역사자료계약을확인했다. PaperOnly IEX안내와역사SIP무료의적용관계·실제권한/BRK.B identity/종가정합은미확인. 기존키없어저장소밖0600빈template과한번의무료키등록질문을준비했으며응답대기중이다. 키를채팅에보내거나유료가입·입금·주문연동하지않는다.
- 구체설계 docs/implementation/2026-11-11-t156-free-source-fallback.md: 평가전용전체basis선택·rowsplice금지·raw/split정의·원문SHA/실수신시각·253canonical/장부·공유301요청/7분예산·권한/페이지오류failclosed·IEXfallback0. 대체원천공통200exact는추가검토안이며기존전종목기적용이라고표기하지않는다.
- 현재0.3.0유지/실거래OFF·안전관문불변,기존105부족/T0null/정상forward0/새예측0이다. source검증·C1후만구현/독립감사·QA/정본배포/실제4기간발행확인으로진행. 전체정상화는미완료이며이전실수집2판본·원예측1/4/4와경제장부보존근거는F48에있다.

## T-156 즉시 실행 2회·자료 저장/보존 검증 완료, 전체 흐름 보류 — F48/exec-091

- 사용자즉시실행지시대로예약을기다리지않고13:57:16·14:27:39KST 정상m40-forward를2회실행했다. 각각약14:02·14:32에자료적격미달blocked로종료. 단순상태조회가아니라실제원문수집과연구DB발행을수행했으며새예측발행성공으로표기하지않는다.
- 미국11/10마감분 기준 수집대상126중raw18/split96만최신,raw108/split29는11/09·BRK.Bsplit1은11/06. 고정후보123중양기준충족18/부족105로2차에도동일했다. FRED SP500원문297일/최신11/10은정상확보했다. 2차HTTP5022건은이전유효whole record와원문/SHA/실수신시각을보존,252원천기준날짜범위퇴행0을독립검산했다.
- 실제새source판본2개(8a8102d4…/a46055fa…)를DB에보존했다. 별도2GET동시진단에서도BRK.B splitdefault와type=stocks가동일295행/11/06/SHA로요청옵션추가효과없음. 원문은보호폴더/DB에두고공개증거는날짜·개수·hash만보존했다. 자료추정/날짜변조/누락종목제외/신규공급자임의대체없음.
- 11/10 blocked회차1개가저장돼revision2→3,2차중복blocked는추가되지않았다. T0null/정상forward0·신규시그널0·새forecast0/원예측1run4기간4pending·기존rehearsal4보존. QA가revision만이전값으로정규화해policy/state/clone경제SHA일치를확인,현금·보유/수취금·기존intent/outcome은이비교범위에서변화0. 신규forecast API는입력적격미달로호출하지않았다.
- 14:34~14:40후검사health200/DBtrue·DRY_RUNtrue/killfalse/계좌active·web/cron각1online·양lease0,보호8trigger/전역보안/앱권한/환경/안전지문·기존forecast hash불변. 이번13:57동시읽기대비orders상태별건수도같음(전체행동일보증아님). 편도0.25%/제품0.3.0·36SHA불일치0/정책·epoch수동설정·retrycounter초기화·새코드·배포변경0.
- 독립QA최종 qa-immediate-final-20261111.json은전체일일흐름 NOT_VERIFIED로구분했다. 현재실행근거16파일/12,064bytes를기존별도testartifact/blob DB에저장·재읽기검산: artifact-e06c33c9896d36017781cef696ab643e/SHA e06c33c9896d36017781cef696ab643e1e7cf735bd13a8f0c560bb6da65f6b95. 실제가격/계좌fixture/금액/키는테스트아카이브에서제외. 기존788회귀를지금새로돌린것은아니다.
- 전체정상화는미완료다. 남은실제관문은당일raw/split·BRK.B11/09·11/10내부갭의적격원천확보이며그후첫정상T0/forward→4기간예측저장/중복차단/사후평가를확인해야한다. 자료가현재없는데예측을발행하거나수익을만들어보이지않는다. 향후기존정기수집/11/12 23시예약은유지했으며새자동화나추가수동수집을무한반복하도록설정하지않았다. T156 doing/장기표본·확률보정과제도유지.

## T-156 즉시 1차 수집 완료·적격성 차단 / 재수집 준비 — F47/exec-090

- 13:57:16KST 정상수집을지금실행했고14:02:43 상태blocked로종료확인했다. 원천실제DB새번들 paper-src-8a8102d418d25975646dc5bc14b9f74f89a0ac820701b14b/asOf11/10/window2025-09-06..11/10으로발행. 저장만으로모의분석완료를뜻하지않는다.
- 수집대상126종목 raw18/split96이당일11/10,raw108/split29는11/09·BRK.Bsplit1은11/06이다. 고정후보123중필수양기준이채워진종목18/누락105. FRED지수원문297/11/10 직접확보,transportfailures0. 원문은수신됐지만날짜미갱신인대상이많아sourceReadyfalse다. 전체목록/원문SHA/PIT는보존하고값·보유/금액은공개artifact에출력하지않았다.
- 1차blocked회차1개가11/10에기록돼계좌revision2→3/T0null; 실제forward0·새정상시그널0·새forecast0/원1run4기간4pending보존. blockedcheckpoint의revision변화와실제경제상태변경은QA가구분검산중이며아직경제상태불변이라고단정하지않는다. 신규예측API는준비미달상태에서호출하지않았다.
- 첫시작으로부터30분간격인05:27UTC(14:27KST)이후누락대상정상재수집1회를준비한다. 실제원문갱신이관건이며기준일수동입력·가격대체·날짜조작·관문완화없음. 당일재시도counter초기화/새배포/실거래설정변경0. 문서진단상Kibot type기본값stocks/BRK.B표기·splitadjusted계약은현재요청과맞고type생략을지연원인으로확정할근거가없다(데이터API추가probe0).

## T-156 지금 수집→모의분석→예측 실행 중 — F46/exec-089

- 사용자 “지금도 미국장은 마감된 상태이니까 지금 바로 작업 진행”에 따라 예약시각을 기다리지 않고 정상앱 경로를 실행했다. 직전조회만허용범위와구분하여이번에는실자료수집·sourcearchive·적격시독립모의전진/예측원장정상저장이승인범위다. 실거래/설정·권한·전역보안·정책/수동epoch·배포변경은하지않는다.
- 11/11 13:56KST API는미국11/10세션/pending/sourceReadyfalse/beforeNextOpentrue. 13:57:16KST POST m40-forward는202접수,13:58:34에는running으로실제worker수집진행확인. 아직source적격/전진/T0/4기간예측완료로판정하지않는다. 조건통과뒤에만forecast정상경로를호출한다.
- 13:57:26동시운영읽기 health200/DBtrue/DRYtrue·계좌active/revision2/T0null·원1run4horizon4pending/안전·권한·전역·8trigger지문보존. 당일조회전후파일중 immediate-before는이전12:25완료snapshot을worker시작전복사한것이며새완료preflight로간주하지않는다; immediate-inflight-crosscheck가13:57:26동시읽기다. 실행전최신API상태및정상route의필수관문은유지됐다.
- 예정시각변경질문대신사용자가즉시실행을선택해현재진행한다. 기존11/12 23시1회점검예약은취소/변경지시없어유지. 현재실행과그예약은별개다. 최신원천이아직미도착이면원문/시각을확인해실제차단사유를보고하며추정행·카운터초기화로우회하지않는다. QA는읽기전용으로원장연결/보존/안전독립검산만배정했다.

## T-156 금일 미국장 마감분 점검 — F45/exec-088 (11/11 12:25~12:31 KST)

- 사용자 “금일 미국장 마감 후 분석 결과 점검 여부” 요청으로 지금 직접 읽기 점검했다. 해당 미국 마감 거래일은11/10이다. 일반 research-cycle07:00:18~19,일봉07:40:53~07:42:33,해외마감분석08:00:47~08:02:16은각HTTP200/jobstatusok다. 이사실을M40의전진·예측완료나전종목성과검증으로확대하지않는다.
- 오늘08:02:16 M40참고(shadow)경로는blocked/m40_policy_not_configured/초안0·판단0 기록이있다. loadM40Input의환경기준일요건(T156_M40_EPOCH_SESSION)미충족사유이며독립모의계좌의저장정책과별개다. 그blocked행의session11/06은연구달력fallback으로오늘11/10유효분석결과가아니다. 기준일·설정을임의입력하지않았다.
- 오늘마감분M40정기수집은오늘20:45KST부터다. 현재API는session11/10/pending/sourceReadyfalse/beforeNextOpentrue. 실제forward0·모의signal0·T0null/revision2·새forecast0/원본1run4기간4pending보존. DB최신번들은아직11/09기준/raw126·split125·KIS297/BRK.Bsplit11/06이며공급자현재파일을새로받지는않았다.
- 실거래OFF/health200/DBtrue·보호8trigger/안전·권한·전역·환경지문불변. web/cron각1online,cron은restart1(원인추적안함),web0. filled17동일·dry_run575이며현재검증에서주문·수집·예측발행·DB쓰기·설정·배포·새테스트0. 가린근거 postclose-review-summary-20261111.json 및현재운영/원문/회차읽기영수증.
- 자동점검t-156은기존11/12 23:00KST 1회ACTIVE로등록돼그예약시각은아직전이다. 현재질문의“금일”에맞춰오늘11/11 23시로앞당길지선택을비동기로요청했으며응답전에는일정을변경하지않았다. 오늘즉시읽기점검과내일예약을구분한다. T156 doing·오늘수집후실제전진→새예측완료확인남음.

## T-156 미국장 마감 후 재점검 예약 — F44/exec-087

- 사용자 “익일 미국장 마감 후 분석내용 다시 점검” 지시로 한국 시간 2026-11-12 23:00에 이 채팅으로 돌아오는 1회 점검을 등록했다. 첫 안내의 11/11은 익일 해석에 맞춰 11/12로 바로잡아 안내했다. 해당 마감 뒤 정기 수집·예측 결과를 확인하는 시각이며 지금 미래 작업을 실행한 것은 아니다.
- Codex 앱 automation t-156 / heartbeat / ACTIVE / 실행1회. 도구 create·view와 저장된 COUNT1/월일·시각·current-thread 연결을 확인했다. 도구가 DTSTART 포함 즉시생성을 거절한 첫 요청은 생성되지 않았고, 도구가 수용한 일회성 규칙으로만 등록했다. 서버 cron이나 직접 예약 파일을 작성하지 않았다.
- 범위는 운영 DB·로그·원문 적격성·실제 모의분석/T0·모의시그널·신규 1주/1개월/3개월/1년 예측·사후비교·원본 보존·실거래 OFF를 읽어 정상/차단/미확인을 보고하는 것이다. 강제 수집/예측/주문·DB쓰기·설정/권한/정책 변경·재시도 초기화·배포를 실행하지 않는다. 자료가 부족해도 성공으로 보고하지 않고 이번 1회 보고 뒤 종료한다.
- 기존 운영상태는 아래 F43 확인이 마지막이며 이번에 정상화 재판정을 내리지 않았다. T156 doing 및 원천/실제 전진·예측·장기 검증 대기는 유지한다. 로컬 예약 실행에는 해당 Mac과 데스크톱 앱 및 작업 폴더/SSH 연결이 사용 가능해야 한다. 근거 scheduled-followup-20261112.json, 앱 예약 카드. 코드/운영DB/거래 설정 변경0.

## T-156 전체 흐름 재확인 — F43/exec-086 (2026-11-11 00:23 KST)

- 검증 전용으로 운영 API·DB·보존 원문을 다시 읽었다. 운영0.3.0/04afa·web/cron각1online/restarts0·health200/DBtrue·DRY_RUNtrue/killfalse·보호8trigger/전역/앱권한/환경/안전지문과원예측hash는유지됐다. 기존788검사를오늘새로돌린것은아니다.
- 결과는 전체 흐름 미완료다. DB최신번들은전날08:16ET수신본그대로: raw126/split125·KIS297은11/09,필수BRK.Bsplit은11/06/11/09행없음. 공급자현재원문을새로받지는않았으므로현재공급자에도없다고확정하지않는다. sourceReady=false/실제forward0/T0null/revision2/신규모의signal0·새forecast0,기존1run/4기간/4pending보존.
- 이전ET일의자동수집4/예측준비4 기록그대로이며재시도횟수초기화0. 이제미국11/10개장후라beforeNextOpen=false도확인했고11/09회차를소급실행하지않았다. 다음정기수집예약은11/11 20:45KST부터지만적격원천확보·완료는보장하지않는다.
- 전점검이후orders상태별건수차이는dry_run+1뿐,filled17은동일(전체행/원인추적보증아님). 이번검증의수집시작/예측발행/주문/DB쓰기/설정변경/배포/새테스트0. 새로그인UI검사없음. 실제자료수집과성과발행을성공으로표기하지않는다.
- 근거 followup-operating-verification-20261111.json. 원천복구후첫정상전진/T0·신규4기간예측·같은세션중복차단의운영긍정검증과기존장기표본/보정과제는남아T156 doing유지. 이번추가확인기록은local Vault/가린artifact로만보존하고운영테스트DB추가쓰기나문서push배포는하지않았다.

## T-156 수집·재시도 복구 반영 / 원천 1건으로 전체 흐름 보류 — F42/exec-085

- 웹0.3.0/04afa341/릴리스20261110-185657-04afa341 배포·제품36SHA불일치0. 코드/독립회귀788·타입/build·격리실DB 검증과 ops읽기검산기17 합성검사 통과. 기존 broadcronJ1중단/lint설정부재는통과로표시하지않는다. 추가제품/버전/배포/DDL/APK변경0.
- 실제자동수집 예약4회 KST20:45:02·21:15:33·21:45:54·22:16:18,각HTTP202/partial/accepted_pending. 예측준비조회도21:00:19·21:30:46·22:01:08·22:31:27에4회/source_not_ready. 202접수는완료아니며과거오탐실패로그는보존. 현재ET예산4/4는초기화하지않았다.
- 최종수신08:16ET 원문도BRK.B split296행/11/06,raw297행/11/09. 분할조정11/09행0·원문SHA/날짜전체와parser일치·06:30수신과같아파서누락아님. 전체raw126/split125최신11/09·KIS SPX297/최신11/09/동결후보123. 공급자내부원인·이후갱신보장없음. 대체KIS개별주식MODP1의split-only/배당정의·USD전체원문계약은미검증이므로적용안함.
- 22:33 운영검산은정상pending/issues0: accountactive/revision2/T0null/실제forward0·신규모의signal0·새forecast0. 기존rehearsal4와원forecast1run/4horizon/4pending·경제원장보존. 신규T0/4기간발행/동일세션운영중복차단의긍정검증은미완료이며기존모의성과/원예측으로대신통과판정하지않는다. QA최종도PENDING_SOURCE_NOT_READY/전체flow NOT_VERIFIED.
- health200/DBtrue·DRY_RUNtrue/killfalse,web·cron각1online/restarts0·양lease0·보호8trigger/앱권한/전역/환경/안전지문불변. 실orders상태별건수도전후동일(전체행불변보증아님). 기록저장후22:39health도동일. 실거래OFF·분할/가격/PIT/owner/immutable/개장시각관문유지.
- 최종운영근거25파일/11,641bytes를별도testartifact/blob DB에저장·재읽기검산: artifact-ee274df8c5d6e392588c577866d2f4ca/SHA ee274df8c5d6e392588c577866d2f4caeaeecc55aca99df7561a60703d7e7ae9. 기반88파일·중간20파일도별도보존. 실계좌fixture/원문가격/키제외. Root postrelease문서는local유지하며기록push로추가배포하지않는다.
- 다음: 원천의누락행/내부갭이실제로복구되거나별도적격원천계약이검증된뒤정상forward→첫적격T0/4기간발행/재시도중복·만기전pending을실제로확인한다. 다음날정상화보장없고미도착시계속안전차단한다. 전체T156 doing·최소84일/신규왕복100건/에이전트거래변경20일·미보정확률/역사원천공백도남는다. 정본구현보고서와operating-result-final-summary/qa-operating-result-final/operating-final-history-receipt참고.

## T-156 자동 수집·예측 관문 실측 — F41/exec-084

- 20:45:02KST(06:45ET) 새cron의첫수집이실제실행돼상태1/accepted·job_run_log20:45:03 HTTP202/partial/accepted_pending을확인했다. 과거202실패행은보존했다. 21:00:19KST 예측예약1/source_not_ready로안전대기,준비미달예측API/새forecast발행없음.
- 06:30ET 정상재수집및06:45ET자동수집도BRK.B split원문296행/11/06·raw297행/11/09로동일. 원문SHA/날짜전체와parser날짜목록일치,당일행원문0으로공급자미갱신임을독립확인했다. 기타raw126/split125·KIS297/11/09 유지. 관문/동결123후보·원문/PIT/분할근거불변,누락종목제외·raw대체금지.
- ops읽기검산기최종3파일/공통core SHA를Reviewer정적수용,Root격리17검사통과(첫SSHhome cwd실행16/17은상대경로ENOENT,정상repo cwd 재실행17/17/코드변경0). 11:52:33Z 실제DB READ ONLY 검산은정상pending/issues0: actualforward0/T0null/revision2/새forecast0,기존1run/4horizon/4pending보존. 원장연계검산과별도sourceblobSHA검산범위구분.
- 다음자동수집07:15/07:45/08:15ET,예측07:30/08:00/08:30ET에서갱신과완료확인. 시간은매틱지연가능,각최대4/30분/관문유지. 아직전체수집→forward→새4기간발행완료아님. 웹0.3.0/04afa·실거래OFF·보호8trigger/권한/전역설정유지. 새제품/추가배포0. 최종운영증거별도testhistory저장남음.

## T-156 예약 기록 이관·자동 운용 확인 대기 — F40/exec-083

- 웹0.3.0/04afa·모의계좌active/revision2·실거래OFF 유지. 전날 ET 실행을 KST 11/10로 기록한 레거시 예약2개가 새 파서에서 오늘 수집2회/예측4회 소진으로 읽히는 문제를 확인했다.
- Reviewer 정적수용 후 Root11:21:27Z에 정확한 3/1필드 두 파일만 같은FS/0700배타백업으로 이동, 원문SHA/횟수 보존·현재ET카운터수동수정0. 각rename만원자적/한묶음비원자적이며부분실패자동복원금지. 실제둘다성공. 독립QA06:22:23ET에두SHA일치/활성경로부재/cron1/예약창이전확인. 계획갱신시각2필드만변경·entries/ET날짜/release동일을검산했다.
- 실제DB/수집자료/주문/안전설정 변경0. sourceReady=false/BRK.B split11/06 1종목은아직공급자갱신대기다. 20:45KST자동수집→21:00예측의실제완료·T0/4기간/pending·중복차단확인후별도testhistory저장필요. 제품추가변경·버전증가·추가배포없음. 이전F39근거/기존예측1/4/4보존.

## T-156 웹 반영·복구 완료 / 마지막 원천 1종목 대기 — F39/exec-082

- 웹0.3.0/commit04afa341c07bb39675907898299d4aee9c5c21bb/릴리스20261110-185657-04afa341 정상배포: START09:56:54Z→RELEASE_RESULTok/fullSHA일치/migratedfalse→END09:57:59Z0. web·cron각1online/새cwd·health200. 구중간stopping/health실패는컷오버관측으로해소됐다. 추가--yes/DDL/APK/실거래활성화없음.
- 실제paperpause 09:34:44Z 뒤09:58resume는같은UID authdaemon cwd EACCES로safe차단. 새권한/sudoer/ptrace설정변경없이 관측appworker 검사로보완: 기록oldPID2부재/effectiveUID1000 readablecwd·구pathargs0/unknownEACCES거부/정확5authclass메타·PID/startTicks재확인. 실image·메모리·allOScwd 인증불가/trustedoperator가정명시. 최종ops9파일467854d2…/49QA 및read-only실scan/Reviewer범위한정PASS. corec648/기존DB23/제품36불변.
- 10:34:41Z 검토된operator4파일SHA확인뒤resume성공·active/revision2·경제SHA7d7c5391…1443e/원forecast1·horizon4·evaluation4 hashes보존/양lease0·freshDBreadbacktrue. 새연결검산도통과했다. before/resume/guard는서버ops/private 보호폴더에있다.
- 정상앱POST m40-forward 10:35:34Z202는접수만,10:41blocked로확인. 실제최신bundle paper-src-8e9cea…의 raw126종목/분할조정125종목이11/09,시장지수KIS297일/11/09로복구됐다. frozen BRK.B 1종목의split 원문만11/06(HTTP200/296행),raw11/09(297행)여서sourceReady=false/epochnull·revision2/실제모의시그널0을유지한다. 두번째정상재수집10:45도같은원문끝날짜임을확인했다. 기존rehearsal4/기존blocked기록은보존.
- 공급자공식조정약06:00ET/06:30이후수집권고·08:00정렬참고가있으며보장시각아니다. 수신05:45ET는권고이전이다. 새정기수집06:45~08:45ET(최대4회/30분),예측07~09ET(최대4회/30분)에서actualsource준비를확인해야한다. 현재한국날짜11/10 첫수집20:45/예측21시. BRK.B제외/이전가격전일행대체/raw→split추정/시각조작/관문완화금지. 당시원문가격/SHA는private/DB원문으로보존하고공개증거는날짜·행수·hash만.
- 아직새forecast4기간발행/첫전진T0완료가아니다. 다음은공급자갱신후정상forward재실행또는정기수집관측→sourceReady/completed→forecast실제4기간발행/동일세션중복차단/만기전pending→별도testhistory DB저장·재읽기검산이다. 전체T156 doing/미래84일·100왕복·20개입일·확률보정/자료공백유지.
- Root작업트리도04afa로ff/제품36SHA불일치0,postrelease문서만local유지(기록push로추가배포금지). 회복stash Root07b70cdc8b838a8f8e14c480948d497806735c6d/Ubuntu75e2df2 보존,원래recovery2개및기타artifacts도보존. 보조source-only스크립트periodcap연결오류는저장전실패/제품실경로430cap/directKIS선택은정상. genericmerge별도실험을prod결함으로확대하지않고0.4제안취소·제품0.3유지한다.

## T-156 최종 펜스 수용·웹 반영 준비 — F38/exec-081

- 제품36/웹0.3.0·788검사/타입/build/실DB 검증 후 ops5파일·23case를 독립 수용했다. 09:34:44Z Root만운영pause를실행: 독립모의계좌paused/revision2/경제SHA7d7c5391…1443e·원forecast1/4/4 hashes보존/양activelease0/새연결readbacktrue. 09:35:07Z 별도읽기에서도일치·health200/DRYtrue/전역·앱권한·8trigger·환경/안전지문불변. 실계좌/실거래는변경없다.
- Reviewer reviewer-fenced-cutover.json 현전환PASS·36scope,코드legacy경합영구제거가아니라paused유지로HIGH완화라는제한을유지한다. QA는배정변경영향범위실행PASS/실제펜스증거수용,전역clientOrderId동일주문실행미확인을별도표시했다. user범위에없는전면주문보증을주장하지않으며추가ignored한정검사명령을개발자가준비중이다. 모든실API/운영orders테스트금지.
- 다음: 정상hook(484/실commitE2E차단통과)로동일36/정본문서만commit→정본deployer계획/단일mainpush webhook. 모의계좌paused유지. 새릴리스fullSHA·36SHA/oldrelease全프로세스0/newwebcron각1/양lease0/경제원장동일검사후검토operator로active복구/readback→실수집·forward/T0·4기간예측·재시도중복차단을운영에서검증한다. 아직새commit/push/새배포/수집/예측0이다.

## T-156 일일 복구 최종 시험 통과·안전한 전환 준비 — F37/exec-080

- 제품36파일/웹0.3.0 동결 SHA dd10309601469101571e6dc9a7ee803e0c2a2e27d1550b930d875a724676e522. 독립 QA44suites788tests/cron2/type/build 및 network-none실MariaDB 경합/만료·개장경계rollback/가상시계5일emptysettle·commit·sidecar 통과. source전후36SHA일치, 합성DB/소켓정리완료. lint설정부재/넓은cronJ1중단은통과로표기안함.
- Reviewer CONDITIONAL_PASS: 새/구예측writer혼합위험은운영전환펜스필요. 실제09:08Z preflight는forecast/paperactivelease각0·구forecast10KST예약/개장321분여유·DRYtrue/8trigger·전역/권한불변이나oldweb는online이다. 단순전제추정으로최종수용/배포하지않는다. 마지막DBclock→COMMIT완료의비원자시간차는이번개장여유에서알려진수용한계,100%보장주장금지.
- 별도ops안: 독립모의계좌만배포동안paused로잠깐전환하면구/신publish/forward경제commit이모두거부한다. 구web종료/new각1/lease0/원경제SHA검산후active복구한다. 사용자승인일일복구의일시안전강화이며실거래/global/grant/정책/잔고변경없음. Root초안operator미실행,developer가readback/잠금경합/실패복구와격리하네스보강중→Reviewer→QA→Root실제pause→최종운영조건수용순. 모든DB쓰기(기존만기평가/usage/sourcearchive)전면차단이라고주장하지않는다.
- Ubuntu기존검증clone에서원격부모f98f55ac(T012문서/웹0.2.0)로제품36동일내용통합,회복stash75e2df2346f0634635a0129dce3ecb61fdc40e59보존. 현재branch codex/t156-daily-flow-repair-20261110/HEAD부모f98,제품워킹변경미커밋. root원작업트리는06b기반dirty유지. push/새배포/운영write는아직0. 최종commit은정상hook검사뒤한번push→webhook만,중복--yes금지.
- C2공식Jev는codex_required=true/data_integrity였으며AGENTS규정 `override: codex_unavailable_in_codex`기록·외부CLI실행안함. 정본 daily-flow-repair아티팩트 qa-daily-flow-receipt.json/reviewer-final.json/operator계획 및구현보고서. 운영완료를뜻하지않고전체T156 doing유지.

## T-156 일일 수집·재시도 복구 진행 — F36/exec-079 (2026-11-10)

- 사용자 지시로 당일 분할조정 일봉 누락과 일일 수집→모의분석→예측 발행을 복구 중이다. 기본 구현과 강화 delta 개발 중이며 독립감사·최종 QA·배포·운영 재실행은 아직 완료 전이다. 실거래 OFF·안전 관문·기존 원본/원장을 유지한다.
- 실제 원천 확인: 이전 세 번들 126종목×2기준 모두 11/06까지였고 FRED 운송 오류로 지수가 없었다. 현재 Kibot IBM raw/split 모두 11/09 도착을 확인했다. Node FRED TLS 운송은 실패하지만 TLS 검증 유지 curl은 수신 가능하며 최신 날짜는 11/05로 2세션 부족하다. 지수 지연 허용치를 늘리지 않는다.
- 기존 KIS 읽기 전용 공식 SPX 지수의 70일 요청+실제 누락 짧은 요청 총11회 검산은 2025-09-05~2026-11-09 canonical297/누락0, FRED 공통295 전부 decimal 정확 일치다. 계좌번호/주문 전송·신규 토큰 발급 없이 기존 캐시로 조사했다. 프로덕션 어댑터는 기존 인증·시세 경유, 16회/90초 한도·원문/실수신시각/SHA·253이상/공통200일 검산 후에만 적격이다.
- 구현: 최신 whole-source 퇴행 방지·기존 FRED 원문 복구·bounded curl·ET 수집/예측 유한 재시도·보호된 읽기 상태·202 접수와 완료 분리. 세션 고정 forecast job/기존 published 감지로 입력 해시가 바뀐 재시도도 중복 발행을 막는 delta를 추가한다. C1 본체/강화 delta 모두 공식 Jev 도구 결과 codex_required=false; recursive Codex 호출 없음. 웹 새 릴리스는 0.3.0으로 한 번만 준비, APK 변경 없다.
- 정본 계획·검증 현황 docs/implementation/2026-11-10-t156-daily-flow-repair.md. private 실계좌 fixture·원문은 보호 디렉터리, 공유 아티팩트는 가린 근거만. 기존 F35 차단/기존 forecast1건4기간은 보존한다. 전체 T156의 전진84일·100왕복·20개입일/자료 공백은 별도다.

## T-156 후속 우선순위 점검 — F35/exec-078 (2026-11-10)

- 16:47 KST 운영읽기점검: 기존06b릴리스/health200·DBtrue·DRY_RUNtrue/killfalse. 신규코드/설정/수집/작업재호출/주문변경없이확인했다. 11/09가격세션의실제모의회차는blocked/errorCode=paper_current_basis_observation_missing,보유종목현재세션분할조정일봉근거부족이다. 계좌revision2/T0null·모의시그널은기존리허설4개뿐이다.
- 오늘10시예측은HTTP503/forecast_input_blocked·완료경로0으로새발행없음. 기존가격기준11/06의원본1건/대기4건은보존됐다. 오늘09시경11/09세션자료번들게시가있어도전체핵심가격적격을뜻하지않는다. 구체누락종목/원천·forecast세부prepare사유는추가조사대상이다.
- 우선후속권고: ①당일분할조정일봉/출처시각·기존보유기준정합·재시도점검으로일일수집→모의분석→예측흐름복구(관문완화금지) ②m40-forward202접수와실제완료상태를분리해실패오탐검토 ③첫적격T0및실제전진원장/만기사후평가 ④미보정확률·자료/장기국면보완 ⑤참고전용에이전트의거래변경설계·같은비용병행검증. 현재사용자질문은남은작업확인이며새수정·재배포를실행하지않았다.
- 기존F34로그인UI표시검증완료와오늘일별자동운영차단은구별한다. 첫1주목표11/13은조건충족시평가예정이며자동completed보장은없다. 최소84일/신규왕복100건/에이전트변경20일,미래수익성/보정·Android실기기·당시전체구성/뉴스원천공백은남는다. 정본증거 followup-assessment-20261110.json.

## T-156 로그인 운영 UI 4기간·사후비교 확인 완료 — F34/exec-077

- 2026-11-09 08:34~08:38 KST: 사용자가직접로그인한IAB탭15에서실제운영웹을확인했다. 1주/1개월/3개월/1년 USD·% P10/P90·평균·중앙값·손실확률/경로수가운영DB원본d33ba129…와각각일치. sourceDataset/sourceSHA/inputSHA와297역사관측표시도대조했다. 기간전환중선택원본유지·편도0.25%·미보정/꼬리범위안내확인.
- 사후비교도각기간목표일대기·actual미확인·완료0/Brier없음. 화면요약은선택기간1건/대기1이며4기간DB합계는pending4다. 최초검사기의전체4가정은실제SQL의기간필터를확인해정정했으며제품결함아니다. 첫목표11/13,12/04,2027/02/05,11/05.
- 설정실거래여부aria-checked=false와홈OFF·서버dryRuntrue를직접확인. 버튼토글/저장/주문/예측재발행/배포없음. 사후health200/33SHA·원모의/안전/전역/앱권한/env불변,run1/horizon4/pending4. 실제운영로그인UI미확인이라는F32/F33제한은해소됐고Android물리기기·미래실성과/수익성/보정은별도남는다.
- 영수증 authenticated-ui-verification.json/authenticated-ui-postflight.json 및 테스트DB별도2파일아카이브ui-history-receipt.json(readback일치). 원본금액/실제스크린샷은0700/0600로컬private에만보존하고공개artifact·Git·공유테스트아카이브에넣지않았다. 운영탭15를1주예상성과에두고deliverable보존,CUA완료요약전송. post-release기록은로컬유지하며추가push/배포없음.


## T-156 실자료 예측 발행·웹 배포 완료 — F32/exec-075

- 2026-11-09 00:29 KST: main/코드 HEAD06bce08a와 운영20261109-002723-06bce08a 일치. 정확SHA START→RELEASE_RESULTok→END0, 정본 status health200. 검토33파일·보호트리거8개 일치, web/cron각1online/restart0·DRY_RUN=true/killfalse, 원모의/안전·전역보안/앱권한·동일선택환경 지문 불변. 보호DDL은 별도승인실행이며 release.migrated=false와 구분한다.
- 실제 archived자료/독립 모의계좌로 최초1run·4기간·2000경로 발행(37.571초), 두번째요청은중복차단. DB job1/run1/horizon4/evaluation4(pending)/continuation0. 원본ID d33ba129ee7a…f7cfe72, 입력/결과/기간/9파일코드해시 검산일치. 미래실적을 생성하지 않았다.
- 소유자 실제서버reader에서 week/month/quarter/year·편도0.25%·값유효/선택원본유지·pending/actualnull·조회전후쓰기0을 확인했다. 익명API401·양수미등록principal403, 실제운영브라우저는로그인화면으로이동했다. HTTP로그인 ownerUI/Android는미확인이다. 앱 분석→오늘분석→종목별→모의분석→모의성과→향후예상성과/예측사후비교, /analytics?tab=m40.
- 신규최종QA PASS/결함0과 운영증거15파일을 기존test_artifact/blob에 별도저장·readback일치(13037bytes/SHA c22eba25074b…7779f9a). 과거55파일아카이브도보존. post-release 기록은로컬변경으로유지하며기록push로추가배포하지않는다. recovery stash2개/별도검증자료 보존.
- 전체T156 doing은 미래84일/100왕복/20개입일·원천당시구성/뉴스/가격공백과 실제미래보정·수익성미검증을뜻한다. 현재M40+agent참고전용/297최근수익·1일지수잠재추정·예측임시주기/정책·epoch변경시비교불가·2027달력상한을유지한다. 이번엔구현/보호DDL/발행/배포대기없음. 상세 forecast-engine.md F32와 final-verification.json.


## T-156 실자료 예측엔진·불변원장 구현 중 — F28/exec-069

- 사용자명시승인으로실수집자료기반4기간손익범위/미보정손실확률·원본원장·이후모의성과비교를구현한다. 과거엔진제외/미지원상태는새요청으로확장. 기존v6승인구성에binding·실거래OFF유지·동일승인재질문금지.
- 실제frozen123+held추가1=가격vector124/297joint수익관측/B2000L10. 별도실markedpaperbaseline·source/issued시각·1일latentindex가정/표본한계명시. clone기준대체/실T0변경/미래actual조작금지. 엔진/원장개발팀과QA·독립review순환,신규forecast표만계획. 운영39b2f749이며신규DDL/예측발행/새게시미실행.
- 사후비교를영원미지원으로남기지않도록forward-runtime/store의before/aftercontinuation증거메타만추가허용(실매매정책/기존papercommit불변). 단계계약/실사/모형안은taskF28·docs/design/2026-11-08-t156-forecast-engine-analyst-spec.md/ui-binding.md와artifacts/T-156-forecast-engine/에있다.

## ✅ T-156 v6 조회 UI·부팅 진단 운영 반영 완료 — F27/exec-068

- 현재main/작업트리/운영은39b2f749,릴리스20261108-212559-39b2f749다. 아래319실패/963자동복구는이력이며불일치·배포보류대기는진단포함새버전통과로해소됐다. 같은UI/배포/진단승인재질문금지.
- 독립23파일검토/소스SHA일치,기존UI388검사·신규진단/안전208검사(합산고유수주장X)/타입/build·실mysql2호환·CUA360/412/1280. health200/DBtrue/safetygreen·DRYtrue/killfalse·web/cron각1online/restart0·익명API401·안전선택env해시불변. DBmigrate/APK/실거래활성화없음.
- 앱경로 분석 → 오늘 분석 → 종목별 → 모의분석 (analytics?tab=m40). 4탭고정/10페이지/관측주월·달력길이/경과/향후4기간선택. 예측원장/엔진없음은미지원빈값,현재agent참고전용. 진단은이번setup79.3초지연을식별했지만최초실패근본원인은미확정. 인증운영UI/안드로이드실기기와미래84일/100왕복/20변경일은별도남음.
- 정본보고 docs/implementation/2026-11-08-t156-paper-v6.md·boot-diagnostics.md 및 artifacts/.../deployment/final-deployment-verification.json. 실제배포후결과문서만로컬수정상태로보존하며기록만push해추가배포하지않는다. 복구stash/검증증거보존,모니터/합성컨테이너정리완료.

## T-156 부팅 진단 보완 사용자 승인 — F26/exec-066

- 사용자가공통부팅/DB초기화진단보완까지명시승인했다. 아래범위결정대기는해소. developer(Sol)가로그관측만구현하고기존Reviewer/QA가비간섭/비밀보호/실SQL일치·coldstart를검증한다. SQL/DDL/health조건·시간/실거래불변. 기존main319/운영963복구상태이며새검증완료뒤진단포함정본배포를진행한다. 같은UI/배포/진단승인재질문금지. 상세F26·boot-diagnostics아티팩트.

## 🔴 T-156 v6 웹 배포 실패·자동 복구 — 최신 운영 기준

- 구현·검증 소스/main은319caf6, 실제운영은963bfeba(릴리스20261108-174944-963bfeba)다. 새v6 릴리스205843-319caf64는health_failed로자동복구(12:02:32UTC). web/cron각1 online/restart0·health200/dbtrue/safetygreen·DRYtrue/killfalse·안전env불변 확인. v6운영반영성공으로표시하지않는다.
- 원인미확정:실패중DB시간상한경고있으나SQL/잠금이력없음. 원인확정전같은코드재배포/단순기록push금지(main push가자동배포). docs/implementation/2026-11-08-t156-paper-v6-deployment-followup.md 진단범위검토. 원래v6 UI/즉시배포승인은유효하며동일승인재질문금지. 현재남은선택은부팅/DB초기화진단까지후속범위를확장할지다.

## ▶ T-156 최신 재개 기준 — 2026-11-08

- **최신F24/exec-063: 승인v6 조회 화면 구현·최종 검증 완료, 사용자 즉시 웹배포 승인 후 반영 준비.** 독립19파일검토·디자인수용, 격리21스위트/388검사·타입/build, 실제합성MariaDB reader와실React CUA360/412/1280 통과. qa/visual 원본증거와19SHA보존. 운영DB/실거래·commit/push/배포없음. 실제예측엔진/원장과에이전트거래반영은미구현이며4기간은미지원빈상태. 상세docs/implementation/2026-11-08-t156-paper-v6.md. 같은UI승인재질문금지. 다음은deployer정본의배포시점합의 후최신T162문서보존통합/웹배포·실운영확인이다.

- **19:52 v6 원본승인공식연결/check/activate PASS,구현진행.** 아래자동기록blocked대기는해소. F22/exec-061. Backend/frontend역할은 paper_v6_backend/paper_v6_frontend, designer가guide확정. owner/read-only·10행서버페이지·관측기간/기준/coverage·정책판본과승인UI구현,예측자료없음은4horizon선택+미지원/empty로표시. 원본demo수정/실제예측·DBDDL/실거래·배포금지. 최종독립review→Ubuntu격리QA/CUA남음.

- **v6 사용자승인수신,재승인요청금지.** F22/exec-060부터확인. 정식native기록은질문quote경계222회귀보완후옛v3~v5pending오판정까지수정중. 격리후보 `~/.codex/tmp/t156-v6-approval-lineage-fix`, 원본msg/question은F22. checkpass전제품편집0/activefalse. backend/frontend준비완료이며승인된조회UI만구현하고실예측엔진/agent거래/DBDDL·실거래/배포범위확대금지.

- **v6 검토본 cce67b2f 완성·review_requested.** `mockups/T-156-paper-analysis-v6.html`·F21/exec-059. 네 예상기간/독립장기합성경로/편도0.25%·날짜/수치검산·lint·CUA360/412/1280 완료. 새 v6 검토를 기다리며 이전v5질문으로승인연결금지. 앱/DB/모델/주문·실거래변경없음.
- **최신은 v6 향후3개월·1년 추가 데모다.** 기존1주/1개월에두기간추가·날짜/기간별합성손익/범위/손실확률/장기비교대기, 편도0.25%유지. v5는수정요청/파일보존이며아래검토대기를대체한다. F21/exec-058. 검토전앱/DB/모델/주문·실거래변경금지.

- **v5 검토본 2b86a975 완성·review_requested.** `mockups/T-156-paper-analysis-v5.html`·F20/exec-057. 독립 수치/기간/비교 검산·lint·CUA360/412/1280 통과. 합성 예시이고 실제 예측엔진/정량성능 검증이 아니다. 새 v5 사용자검토를 기다리며 v4 질문으로 승인 연결 금지.
- **최신은 v5 관측/미래 예측/사후비교 데모다.** 사용자 요청에 따라 모의성과 내부 관측성과와 향후1주·1개월 손익범위/손실확률·사후비교를 합성자료로 추가한다. 편도0.25% 유지. v4는수정요청/불변보존이며 아래v4검토대기는대체됐다. task F20/exec-056부터확인. 검토전앱/API·DB·모델/주문·운영정책/실거래변경금지.

- **최신요청은 기간 표시 v4 데모다.** 모의투자전체기간/시그널발생기간/실제성과관측기간을 날짜·주/월·관측일수로 구분한다. v3는검토피드백에따라수정요청으로보존, v4승인전앱·정책·설정변경없음. F19확인. 아래v3검토대기는이최신요청으로대체됐다.
- **v4 검토본은 ad504e9b로 완성·review_requested.** `mockups/T-156-paper-analysis-v4.html`과 F19를 확인한다. 기간/합성수치 독립검토·lint·CUA360/412/1280 및 주월/누락/페이지 일관성 완료. 현재 실제 DB는 리허설만이고 전진 성과기간이 없다. 데모 날짜/금액은 합성이며 사용자 승인 전 앱 변경/실거래 활성화 금지. 이전 v3 질문을 v4 승인으로 연결하지 않는다.

- **최신요청은 모의분석 v3 데모다.** 명칭/정책표시/한줄고정4탭/목록10개페이지를 데모로 검토받고 이후구현한다. 현재앱코드·DB/실행설정은 바꾸지 않는다. 현재agent는참고전용, 규칙을매매에반영하는목표정책과구분. v3데모91cc9d49·정적검토/CUA완료/정식review_requested, 사용자검토대기. taskF18부터확인.

- **F15 M40 조회 화면은 운영 반영 완료다.** 앱 분석 → 오늘 분석 → 종목별 → M40 모의분석. main e9dccee·릴리스163137-e9dccee5,487검사/타입/build/합성CUA 및 운영소스14개/health/web·cron각1/DRYtrue/API401 검증. F16 승인도구지원193통과·원래v2승인연결완료, 같은승인/이메일재질문금지. 실제로그인운영UI/실기기 확인과 미래전진/원천공백은 별도대기. 배포후기록문서만 현재작업트리에추가했으며 코드변경은 모두 게시됐다.

1. [[T-156-us-stock-entry-exit-forecast-design]] F14와 `docs/implementation/2026-11-08-t156-forward-paper-pilot.md`를 읽는다. 사용자 승인으로 Codex가 구현·DB이관·DRY_RUN 연결을 직접 수행한다. 첫 적격 T0고정·실계좌복사·제한군 시험판 선택은 재확인하지 않는다.
2. 운영DB 독립 모의 장부에 미국보유4개+USD 현금 최초복사 완료, 공개125개중123개 적격,11/06 리허설1회/모의시그널4개. 전진0·T0미설정이다. 등록후실제관측한 첫적격 세션만T0로잠근다. 과거리허설을전진실적으로세지 않는다.
3. `status='paused'`는모의계좌만정지. 전역DRY_RUNtrue유지 및 paper전략/ID 영구주문차단. 기본M40거래변경 에이전트 arm은꺼져있다. 84일·신규왕복100건/agent변경20일은아직검증해야하며 실거래를켜지 않는다.
4. 배포완료 여부와최신릴리스는task배포영수증/현재운영으로확인한다. 아래다른task의낡은운영값을현재값으로사용하지 않는다. 공유원본트리의무관한미커밋자료는그대로보존한다.

## ▶ T-137 최신 재개 기준 — 2026-11-01 01:32 KST

1. [[T-137-dynamic-overseas-universe]] 맨 위 최신 진입점과 마지막 Leader·Developer·QA·Judge 절을 읽는다. 이전 Windows/10-31 ZIP만으로 복원하지 않는다. 최신79파일 통합본은 main18896 기준 `agent-vault/10-Flow/artifacts/T-137-main18896-integration-review-20261101-r2.zip`, 정확경로/해시는 `T-137-integration-source-manifest79-20261101-r2.json`에 있다.
2. 전체 코드 감사의 조건부 의견과 격리 QA는 보강됐다(통합10,548건, DB22건, 전체합성cron4,320틱, 실제Next OFF6조건). 그러나 공식 Reviewer 기록은 역할편집금지 충돌로 아직 없고, 원천계약/API권한도 없으며 실제기능ON·KIS150+·실DBworker/운영전환은 미검증이다. task는doing/user_decision이다.
3. 다음은 사용자의 데이터 공급/대체원천 결정과 T-137 Reviewer 자기기록 한정 예외 또는 정본규정 정정이다. 그 뒤 동일 독립감사자가 실제scope로 직접기록하며 Leader대필/no-verify금지. 운영DDL·스위치·commit/push/배포는 별도 유효승인과 검증 전 금지.01:32읽기 당시 remote main/운영릴리스18896, healthgreen·DRY_RUNtrue·killfalse·engineenabled.
4. 아래10-31 절의 예약·타task 일정은 삭제하지 않았고 여전히 참고한다. T-137의 최신 상태·자료와 예전 인계의 충돌은 이 절 및 task 최신절을 우선한다.


> **🟢 T-137은 위 「T-137 최신 재개 기준 — 2026-11-01」이 정본이다.** 그 밖의 10-31 업무·예약은 아래 「최신 — 2026-10-31」을 참고한다. 10-30 이전 절들은 **이력**이며 현재 사실과 다른 곳이 있다(특히 킬스위치·청산 엔진·"다음 task 번호"). 세부 경과는 [[ACTIVE]] 맨 위.

## ▶ 최신 — 2026-11-01 09:45 (T-139·T-140 운영 배포 완료 — 이 절이 아래 00:55 절보다 우선한다)

- **운영은 `origin/main` `81a1aab` / 릴리스 `20261101-094008-81a1aabe`** — push `d0d203c..81a1aab`(09:39:37), webhook 09:39:59~09:41:41 `exit=0`, `RELEASE_RESULT ok`, `migrated:false`. 안에 T-139(`3d40f6a`)·T-140(`967259f`)·문서(`81a1aab`). 바로 앞 배포는 다른 세션의 T-141(`d0d203c`, 09:33). 롤백 대상 `20261101-093319-d0d203cf`.
- **배포 후 점검 이상 없음(09:42~09:45, 읽기 전용)**: pm2 두 앱 online·restarts 0 · `/api/health` green(dryRun true·killSwitch false) · 안전 키 6개 불변 · `pm2-err/out/cron-err` 에 `[strategy/records/switch]` 경고 0줄·배포 후 새 err 줄 0 · `Aborted_clients` 불변 수준(공용 DB 전체 카운터) · `cron-runner.sh` 1개. 근거·미확인은 [[T-139-record-switch-bounded-read]] 「배포 기록」.
- **승인 시점 계획(05:10~08:30 창)과 달리 승인 응답이 09:3x 에 와서 일요일 09:39(휴장일)에 나갔다** — 사용자에게 보고함. base 가 T-141 로 바뀌어 병합 상태를 다시 검증했다(tree `8ec03ee8`, jest 10455 통과·실패 0, tsc 0, build 0).
- **사용자/후속 확인 대기**: 홈 → 운용현황 A4 「데이터 이상」 숫자 불변(T-140, AI 는 로그인이 없어 못 봄) · 약 10:45 이후와 월요일(11-02) 개장 후 `grep -c "\[strategy/records/switch\]" …/pm2-err.log` 증가분 0 · 평시 `Aborted_clients` 증가 없음. 이전부터의 사용자 대기 항목은 아래 00:55 절 마지막 줄 그대로 유효(T-139·T-140 승인 건만 해소).
- 로컬 미커밋 문서: `ACTIVE`·`RESUME`·`board` 는 다른 세션(T-137·T-141·T-142)의 편집과 섞여 있어 이번에 커밋하지 않았다.

## ▶ 최신 — 2026-11-01 00:55 (보고 직전 읽은 값; 아래 10-31 절과 어긋나면 이 절이 맞다. **단 「승인 대기: T-139+T-140」·「T-141 미커밋」 줄은 09:45 에 해소됨**)

- **운영은 `origin/main` `18896a8` / 릴리스 `20261031-235854-18896a8b`** — T-136·T-138(KIS 토큰, 다른 세션)이 23:59 에 push 로 배포됨(문서 커밋 2개 `0b8b013`·`287b637` 도 함께 나감). pm2 `stockinvest`·`stockinvest-cron` online restarts 0, `/api/health` green(DRY_RUN true·킬스위치 false). 로컬 `main`(`6610dc0`)은 origin 보다 **문서 커밋 1개** 앞(다른 세션의 T-136/T-138 배포 기록, 미push).
- **승인 대기: T-139(기록 스위치 읽기 상한, R2) + T-140(준비 중 원천 수, R1)** — 둘 다 구현·Reviewer·QA PASS, `status: ready-to-deploy`. 코드는 **서버 side branch 에만** 있다(main·origin 미반영): `wip/T-139-record-switch-bounded-read`=`d14ac78`, `wip/T-140-prep-source-count`=`cbc85ee`(둘 다 base `a064722`). 병합 상태(origin `18896a8` 위에 d14ac78+cbc85ee cherry-pick) 검증 완료 — worktree `~/.node-local/stockinvest-integ4`, HEAD `385b836`, **tree `83f870141c09b5f1bf7d1583ea95a876e0378fd0`**, 전체 jest 10449 통과·0 실패, `tsc` 0, `next build` 0. 배포하려면: ① 사용자 승인 ② 05:10~08:30 또는 15:40~22:20 KST 창(07:35~07:57 피함) ③ 서버 main 에 `git cherry-pick d14ac78 cbc85ee` — **결과 tree 가 위 tree 와 같은지 `git rev-parse HEAD^{tree}` 로 대조**(다르면 push 하지 않는다. 로컬 main 의 문서 커밋 `6610dc0` 때문에 tree 가 다를 수 있으니 코드 파일 14개의 diff 로 대조) ④ push → 웹훅 ⑤ 배포 완료는 `START … sha=<푸시 sha>` 이후의 `END` 만 인정 ⑥ 배포 후 확인은 각 task `## 최종 요약`.
- **같은 체크아웃의 다른 세션**: T-141(킬스위치 송신 직전 재확인, `src/lib/safety/dry-run.ts` **미커밋 수정 중**)·T-137(해외 분석 대상 갱신, Doing). 건드리지 않는다. `.codex/agents/*.toml`·`AGENTS.md` 의 미커밋 변경도 동기화 도구 산물로 보이며 내 것이 아니다.
- **취소한 예약**: 11-01 05:15 문서 푸시 크론(가드 `origin==3669090` 이 더 이상 성립하지 않고, 문서는 승인된 배포 push 에 함께 싣는 편이 재시작 1회로 끝난다). 남은 예약(세션 한정): 11-01 04:30 로그 회전 확인 · 11-02 09:22·11-03 07:20 exit_judgment 첫 틱 · 11-02 16:13 T-112 4회차.
- **T-136 실효 확인은 11-01 14:02 KST 토큰 갱신 창**(다른 세션 소관) — 그 전에 배포해도 토큰 로직은 안 바뀌지만 프로세스가 재시작된다(토큰은 DB 에 있어 재읽기).
- 사용자 대기 항목(이전부터): 러너 하드닝 4건(T-131 #27) 지금/보류(권고 보류) · T-125 관찰 종료일 · T-124 보류 · T-131 승격 항목 · #28 설계 결정 · 정리 승인(서버 worktree `stockinvest-t1xx`·`integ*`·`wip/*` 브랜치).

## ▶ 최신 — 2026-10-31 21:0x (이 절의 값은 20:52 에 읽어 확인한 것)

### 1. 지금 운영 상태
- **릴리스** `20261031-192807-8ed1ba7b` (= `origin/main` `8ed1ba7`). 오늘 **코드** 배포 4회(문서만 올린 푸시도 재배포를 일으키므로 현재 릴리스 이름은 매번 `readlink -f /home/brownjeon/apps/stockinvest/current` 로 확인), 전부 `RELEASE_RESULT ok`·`migrated:false`: 05:20(T-108·T-129) · 14:01(T-132 + T-126·T-127·T-128·T-130 코드) · 19:00(T-133 `getTicker` HTTP200 재시도) · 19:27(T-134·T-135). pm2 `stockinvest`·`stockinvest-cron` online·restarts 0, health green.
- **안전 상태는 사용자 의도다**(10-30 12:47 「의도한 변경」 확인, [[ACTIVE]] 10-30 항목): `safety_dry_run=true` · `safety_kill_switch=false` · `exit_engine_enabled=true` · `exit_hard_stop_enabled=false`. 뜻: **실주문은 DRY_RUN 으로 막고, 킬스위치는 풀어 시그널 생성·청산 평가는 가동한 채 감사 기간을 지켜본다.** ⚠ `DRY_RUN` 이 false 가 되면 청산 엔진이 실주문을 낼 수 있다(검증 관문은 매수만 막는다). 10-30 15:26 국내 `eod_loss_cut` 발화는 `dry_run` 주문으로만 기록됐다.
  - **낡은 문구 주의**: 이 문서 아래 절과 [[ACTIVE]] 일부, T-080 의 「킬스위치 ON 유지·11-23 경 해제 판단」은 10-30 변경 이전 계획이다. 현재 값은 위와 같다.
- **기록 스위치·표**: `job_run_log_enabled=true`(10-30 21:05) · `exit_judgment_record_enabled=true`(표 `exit_judgment` 10-31 15:41:30 생성, 스위치 15:41:54, **행 0 — 첫 행은 11-02 장중**) · `judgment_record_enabled` 키 없음(꺼짐).
- **로컬 `main` 은 `origin/main` 보다 문서 커밋이 앞서 있다**(push 안 함). **push 는 곧 배포**라 문서만 올려도 blue/green 재배포가 일어나고, 같은 브랜치를 쓰는 다른 세션이 push 하면 함께 나간다.

### 2. 시간이 정해진 일
| 때 | 일 | 방법 |
|---|---|---|
| 11-01(일) 04:15 | pm2 로그 **첫 자동 회전**(4개 파일) — 04:30 확인 예약(세션 한정) | [[stockinvest-log-rotation]] 의 확인 명령 |
| 11-02(월) 09:22 · 11-03(화) 07:20 | `exit_judgment` 첫 틱 행 검증(국내·해외) | Claude 예약은 **세션 한정** — 사라졌으면 [[T-126-exit-judgment-first-tick-check]] 런북(복붙 쿼리·기대값·롤백) |
| 11-02(월) 16:13 | T-112 `job_run_log` 4회차 점검 + `judgment_record_enabled` 켤지 의견 | 쿼리는 [[ACTIVE]] 10-30 21:05 항목. **켜기는 사용자 승인** |
| 11-02(월) 장중 | 사용자: 홈 「데이터 이상」 건수 확인(T-134 새 게이트 「청산: 포지션 조회 실패」) | 0 이 아니면 그 게이트를 눌러 본다 |
| 11-02 이후 | 원장 D1b 백필·수집 실패 알림 결정 | 사용자 결정 |
| 약 11-05 | [[T-104-cron-jobs-market-grouping]] 착수 가능(T-117~T-119 배포 10-29 + 1주 관측) | 범위 C 설계 확정부터 |
| 12-07 | `rsi-oversold-v1` `enabled=0` 판단 | 사용자 결정 |

### 3. 사용자 결정·행동 대기 (AI 가 임의로 못 한다)
- 새 문구 「청산: 포지션 조회 실패」([[T-134-exit-engine-state-load-isolation]], 디자이너 미검토) · 비정상 응답 로그 마스킹 범위([[T-135-recorder-pool-hold-and-runner-tmp]] 최종 요약).
- [[T-131-t126-t130-followup-candidates]] **2순위 묶음**(안전 스위치 저장 직렬화 + 위험 방향 확인 시트 = 1·2번, 화면 변경 → 디자이너 데모 승인 먼저): **실거래 단계 1 진입 일정이 정해지면 그 1~2주 전에** 시작. 그 밖 후보는 보류 권고.
- `proposed` 3건 — [[T-124-news-input-misread-truncation]](**보류 권고**: 선결은 11-02 이후 `judgment_record_enabled` 결정, 구현은 11-23 이후) · [[T-125-news-zero-alert-cleanup]](10-30 이후 분석 3회 연속 뉴스 통과·경고 0건 → 전제 약화, **11-02~11-04 국내 3일 관찰 뒤 닫기 권고**) · [[T-131-t126-t130-followup-candidates]](후보 모음 — 승격할 항목을 골라 새 task 로) · 사용자 결정 대기: T-100 보유 손실 통제 초안([[ACTIVE]] 10-27 항목).
- 서버 정리 승인(worktree `stockinvest-t134`·`t135`·`integ2`·이전 task 것들, 브랜치 `wip/T-134-…`·`wip/T-135-…`, QA 일회용 DB 컨테이너, `~/.node-local/t1*` 로그 폴더). (pm2 로그 회전은 10-31 설정 완료 — [[stockinvest-log-rotation]], 첫 회전 11-01(일) 04:15).
- **Codex 복구됨(10-31 22:1x, 사용자 「CLI 갱신」)**: 계정은 `gpt-6.1-sol` 을 쓸 수 있고, 실패 원인은 PATH 의 `codex` CLI(nvm 25.6.1 전역 0.156.1)가 낡은 것이었다 → **0.166.0 으로 갱신**, 래퍼 끝까지 시험 통과([[T-131-t126-t130-followup-candidates]] 19번). ⚠ `codex` 설치본이 셋(nvm=이것 · Homebrew=깨진 0.116.0 · 앱 번들 alpha)이고 이 셸에서 그냥 `npm i -g` 는 Homebrew 쪽에 깔리니 갱신은 **nvm 의 npm** 으로. 이전 문서(T-126·127·128·134·135)의 「모델 설정 장애」는 틀린 진단이었고 정정 기록이 있다. **소급 Codex 검토 5건 완료**(사용자 승인 10-31 22:3x; 한도는 사용자가 초기화) — 지적 6건, 독립 Reviewer 판정은 **전부 Low~Medium 이하(부분 채택 또는 채택·Low)**, `critical`·`high` 확정 0. 후속 코드: [[T-139-record-switch-bounded-read]](기록 스위치 읽기 연결 상한)·[[T-140-anomalies-prep-source-count]](prep 원천 수 정정) — 별도 브랜치에서 진행, 배포 승인 전. 러너 하드닝 4건은 묶음 후보([[T-131-t126-t130-followup-candidates]] 27번). **실거래 전 별도 결정: 엔진·주문의 스위치 읽기 정체 비대칭(28번)**. 입력·수동 실행법은 [[retro-codex]].

### 4. 이어서 한다면 (권고 순서)
1. 읽기 확인: health · 현재 릴리스 · 위 안전 키 6개(런북 1절 표) · `git log origin/main..main`(문서 커밋만 앞서 있는지).
2. 11-02 장중 첫 틱 검증(예약 또는 런북) → 결과를 [[T-126-exit-judgment-persistence]] `## 배포 기록` 에.
3. 사용자 결정(위 3절)을 받아 착수. **새 task 번호는 T-137 이상**(T-136 `token-retry-single-source` 은 다른 세션 작업으로 보임 — 번호는 `ls agent-vault/10-Flow/tasks` 로 확인).
4. 칸반의 오래된 `in-progress`·`todo`(T-046~T-055 등)는 상태 표기가 낡아 실제 진행 여부를 확인하지 않았다 — 정리하려면 하나씩 확인한다.

### 5. 환경·작업 규칙 (이번에 확인된 것)
- **Mac 에서 서버 작업은 `ssh -o BatchMode=yes -o ConnectTimeout=20 home_ubuntu`**(pm2·DB·시험·worktree). 접속은 한 번만 열고 안에서 모두 실행 — 에이전트가 연결을 많이 열어 접속 제한이 걸린 적이 있다(10-31 19:09, 1분 내 복구). DB 는 `python3 -I ~/.node-local/tools/dbq.py -e "SELECT …"`(쓰기는 `DBQ_ALLOW_WRITE=1`+사용자 승인).
- **안전 경로(`SAFETY_PATHS`) 코드는 서버 worktree 에서 커밋**한다(`commit-msg` 훅은 Mac 에서 돌지 않는다). Reviewer 판정 줄 형식은 프로젝트 `CLAUDE.md`. 훅이 worktree 최상위에서 task 이력서를 읽으므로 이력서를 복사해 넣었다가 커밋 후 지운다.
- **승인 전 코드는 `main` 에 올리지 않는다** — worktree 별도 브랜치(`wip/T-NNN-…`)에 커밋해 두고, QA 통과 + 사용자 승인 + **합친 상태 검증**(`main` 위에 cherry-pick 한 별도 worktree 에서 `tsc`·jest·`next build`) 뒤에 `main` 으로 cherry-pick(트리 해시가 검증한 트리와 같은지 확인)해 push. 이유: 10-31 14:01 에 다른 세션 push 가 DDL·승인 전 코드를 실어 보냈다.
- **배포** = push → webhook blue/green(웹+크론 재기동 약 1.5~2.5분). 창은 05:10~06:50 · 15:40~20:00 KST(07:35~07:57 피함). 완료 판정은 웹훅 로그(UTC)에서 **push 한 sha 의 `START` 이후 `END`** 만 인정 — 로그 끝에는 이전 배포의 `RELEASE_RESULT` 가 남아 있다.
- 무거운 시험(`jest`·`tsc`·`next build`·`test-*.sh`)은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 …` 직렬(10-28 서버 정지 사고), Node 24.22.2(`~/.node-local/v24.22.2/bin`).
- **Mac 에서 쓴 파일을 서버에서 곧바로 `git add` 하면 옛 내용이 스테이징될 수 있다** — `git show :경로 | cmp - 경로` 로 대조하는 재시도 루프(8초 간격, 최대 4회)로 전부 일치할 때만 커밋. 문서 커밋은 파일을 명시해 `git add`.
- 앱 로그: `/home/brownjeon/apps/stockinvest/shared/logs/{pm2-err,pm2-out,cron-err,cron-out}.log`(`~/.pm2/logs` 아님, `cron-out.log` 는 `grep -a`). **11-01 부터 주 1회(또는 20MB) 회전** — 회전 경계를 넘는 시간대는 `*.log-YYYYMMDD`·`.gz`(`zgrep -a`)도 읽는다([[stockinvest-log-rotation]]). grep 0건은 파일 존재·최근 수정 시각과 함께 봐야 의미가 있다.
- 사용자 보고는 `docs/user-report-format.md` 양식, 확신 태그(`[확실]`/`[가능성 높음]`/`[추측]`). Codex 연계는 정상(CLI 0.166.0) — 호출은 judge `codex_gate` 판정을 따르고, 소급·임의 호출은 코드가 외부로 나가므로 사용자 승인 후(호출해도 즉시 실패, 이력서에 사유를 남긴다).

### 6. 하지 말 것
- 승인 없이: `DRY_RUN`·킬스위치·청산 스위치 변경, 기록 스위치 켜기, DDL(`--with-migrate` 포함), 운영 DB 쓰기, push·배포, `git commit --no-verify`.
- 다른 세션의 파일(`src/lib/exchanges/*` 등 T-133·T-136 작업)을 건드리지 않는다. 커밋은 항상 명시 경로로.
- 개발 환경에서 `/api/cron/*` 를 호출하지 않는다(운영과 같은 DB).

---
**⬇ 아래는 이력이다 (현재 사실과 다를 수 있음).**

> **🔄 2026-10-30 05:2x — 아래 10-29 HANDOFF 는 05:1x(재기동 직전) 기준이라 낡았다.** T-117·T-118·T-119 는 10-29 13:51 배포, T-121 은 15:44 배포, T-119 는 10-29 21:01 첫 실행 정상으로 `done`. **최신 상태·오늘 할 일은 [[ACTIVE]] 맨 위 2026-10-30 항목**을 먼저 읽는다.

> **⚡ 2026-10-29 05:1x — 서버 재기동(사용자 PC 업데이트) 직전 인수인계가 있다: [[HANDOFF-2026-10-29-reboot-resume]] 를 먼저 읽는다.** T-117 일봉 크론·T-118 해외 peek 19슬롯·T-119 보유 종목 개장 전 공시(B)가 진행 중이고, 10-28 23:49 서버 정지 사고와 무거운 시험 직렬화 규칙(flock)이 거기 있다. 아래 10-26 이후 내용은 낡았다.

> **2026-10-28 이번 대화 작업 종료:** 사용자가 통합 작업절차서에 따른 작업 완료를 알렸고, T-077/T-078 인터뷰·설계·문서 인수인계 범위를 종료했다. 인수인계의 옛 S00 시작 문구를 자동 재실행하지 않는다. 구현/운영을 이번에 재검증한 것은 아니며 별도 후속 task의 상태를 일괄 완료로 바꾸지 않았다. 아래 작업을 다시 수행하려면 최신 ACTIVE·실행 원장·해당 task와 새 사용자 지시를 기준으로 범위를 확인한다.

## ▶ 최신 — 2026-10-26 15:39 전략 검증 줄기(Q3) 진행 · 앱 후속(T-094) 보류 · 킬스위치 ON 유지

이어서 한다면 이 순서(상세는 [[ACTIVE]] 맨 위 15:39 항목):
1. **T-095(P1 사후검증 스크립트 보강)** — developer 결과 확인 → Reviewer → judge C2 → QA → Leader 가 명시 경로로 커밋(스크립트·시험만이라 push 불필요, 다음 배포에 동승). worktree `~/.node-local/stockinvest-postmortem-t095`. 끝나면 정리(`git worktree remove`·브랜치 삭제).
2. **P2 합격 기준 사전 등록 초안**(P1 의 지표 정의 뒤) → 사용자 확정. **P3 백테스트는 착수 전 범위·예상 토큰 고지 + 사용자 승인**. **P4 자본·유니버스 정합은 사용자 결정**.
3. **T-080 Phase 2** — 원시 응답 캡처 방식 재승인(위 ACTIVE Q1) 받고 평일 16:40~06:30 창에서 1회. 킬스위치 해제 판단은 **2026-11-23 경**(사용자 결정 Q2).
4. **2026-11-02 이후**: 원장 D1a 1주 관측 요약 → D1b 백필·수집 실패 알림 결정(사용자 Q4). 10-27 05:35 이후엔 T-070 ⑥·[[T-082-s02-daily-bars-universe-remaining]] 일봉 증분 확인(KIS 읽기 권한 필요)과 원장 2일차 수집 확인(읽기 전용).
5. **T-094(앱·인증 후속)** 는 Q3 줄기 종료 보고 + 사용자 "T-094 착수" 전까지 착수하지 않는다(절차는 task 의 G0~G5).
6. 새 task 번호 **T-096 이상**.

## ⏸ 일시 중지 — 앱 런칭(다른 세션: [[T-084-mobile-app-m1-shell]]·T-088) 뒤 재개 (2026-10-25 23:45)

> ▶ **앱 런칭은 끝났다(10-26 06:52 기준)** — [[T-084-mobile-app-m1-shell]] 사용자 실기기 확인 완료 · [[T-088-app-google-login]]·[[T-089-open-redirect-next-path]] 운영 반영(05:21~05:30)과 사용자 실기기 검증 완료. **재개 조건이 충족됐다 — 아래 재개 문구로 이어서 한다.** 아래 "이 중지 기록은 로컬 커밋만"의 `dee03b2` 는 T-089 배포(05:21)에 동승해 **이미 push 됐다**. 새 task 번호는 **T-094 이상**(T-088·T-089 는 앱 로그인·오픈 리다이렉트, T-090 은 커밋 훅 인증 라우트 감시, **T-091 은 앱 버전 게이트+M2 — WP-A·WP-M2 웹 배포 완료·APK 1.1.0 공개·`app_public_url` 설정(10-26 14:12), 사용자 실기기 확인 완료(10-26 14:50), T-092·T-093 은 훅 인증 구현·시험 감시 — 모두 배포 완료** 가 사용 — 10-26 14:17 정정; 최신 상태는 [[ACTIVE]] 맨 위 14:17 항목). **T-090(`53509bd`)은 10-26 09:02 사용자 지시로 push·배포 완료**(릴리스 `20261026-090312-784151b3` ok) — 이후 이 기록 갱신용 문서 전용 커밋 1개만 로컬이다([[T-090-hook-safety-paths-auth-routes]]).

사용자 지시("앱 런칭을 다른 세션에서 진행 중이라 현재 작업은 여기서 마무리, 런칭 후 이어서")로 StockInvest 원장 작업(T-081 WP-D)을 **D1a 가동까지** 하고 멈췄다. **재개 문구: "StockInvest 작업 이어서 진행해줘"** → 이 문서부터 읽는다.

**멈춘 시점의 운영 상태 (그대로 둠)**
- 코드: 릴리스 `20261025-232833-b6cd82fe`(`b6cd82f` 까지 push 완료). 이 중지 기록은 **로컬 커밋만** 했다 — 앱 런칭 중 재배포를 피하려고 push 를 보류했으며, 다음 push 에 동승한다(문서 전용).
- 킬스위치 `true`(10-23 22:42 자동 발동, **해제는 사용자 전용**) · 주문 0건 · 청산 엔진 OFF.
- DB: `broker_*` 5개 테이블 존재(행: `broker_fill_runs` 7·`broker_position_snapshots` 7, 나머지 0). **수집 스위치 `system_config.broker_fills_cron_enabled` = `true` → 매일 07:20 KST 이후 자동 수집이 계속 돈다**(KIS 읽기 약 7~9건/일, 쓰기는 `broker_*` 뿐, 주문·알림 없음, 같은 지문 3회 연속 실패하면 해당 작업 halted).
- cron 로그에 `broker-fills HTTP=503 …` 줄이 보이면 이 수집기 때문이다(실패·정지는 알림 없이 로그와 `broker_fill_runs` 에만 남는다). 앱 런칭과 무관.
- **수집을 멈추려면**: ``UPDATE system_config SET value='false' WHERE `key`='broker_fills_cron_enabled';`` (행 삭제도 같음). 다시 켜기는 ``UPDATE system_config SET value='true' WHERE `key`='broker_fills_cron_enabled';``. 값은 JSON 리터럴 텍스트(`true`/`false`)여야 한다 — 따옴표를 포함한 `"true"`·`1`·`on` 은 꺼짐으로 읽힌다.

**재개하면 이 순서로**
1. 헬스·현재 릴리스·킬스위치·최근 6시간 주문 수 확인(읽기 전용).
2. 중지 동안 쌓인 `broker_fill_runs` 점검(읽기 전용): `trigger_kind='cron'` run 이 날마다 6개(국내/해외 × 체결·기간손익·잔고)씩 생겼는지, 상태가 `complete`/`incomplete`(사유)/`failed` 중 무엇인지, `error` 문구, `account_changed` 없음(지문 기준값 유지). 이상이면 [[T-087-wpd-d1a-broker-fills-collect]] 의 복구 런북과 "첫 라이브 확인 목록"(체결이 있는 날의 응답·다중 페이지 R3·부분 취소 R4·국내 날짜 범위 L-S2·해외 날짜 기준).
3. **사용자 결정 받기**: ① D1b 백필 착수(KIS 읽기 약 35~42건 — `CTSC9215R` 합계 규칙·백필 모드가 선행 코드라 새 task 로, 번호는 `ls agent-vault/10-Flow/tasks` 로 확인해 타 세션과 겹치지 않게 **T-094 이상** — T-088~T-093 은 이미 사용됨) ② 수집 실패·정지를 텔레그램으로 알릴지.
4. **T-080 Phase 2**(킬스위치 오집계의 달러 행 원인): 평일 저녁(17:10~22:00 KST)에 달러 행이 0 으로 읽히는지 읽기 전용으로 확인한다. 10-26 17:10 예약 크론은 **취소했다** → 수동으로 한다. 방법 후보: 운영 앱(포트 3003)에 `POST /api/cron/broker-fills?trigger=manual&market=overseas&kind=position_snapshot`(헤더 `x-cron-secret` = 운영 `.env` 의 CRON_SECRET; 비밀은 인자가 아니라 헤더 파일로 전달)을 호출해 `broker_position_snapshots` 와 같은 시각의 `portfolio_snapshots.positions` 달러 행을 비교 [추측 — 해외 잔고 응답에 달러 예수금 행이 들어오는지는 미확인; 없으면 S00 §2.8 의 KIS 읽기 캡처 절차]. **그때까지 킬스위치 ON 유지 권고.**
5. 그 밖 대기: T-076 해석 질문 Q1~Q8 · T-055 3일 리포트 확인 · 실행 원장 후속 A13~A17(`docs/design/2026-10-24-execution-ledger.md` §5.1).

**하지 말 것**
- 개발 환경(`next dev` 등)에서 `/api/cron/broker-fills` 를 호출하지 않는다 — 운영과 같은 DB 라 지문 기준값이 오염될 수 있다(기준값은 이미 운영에서 만들어졌다: run 1).
- 타 세션 파일을 건드리지 않는다: `T-084*`·`T-088*`, `mockups/T-088-*`, `board.md`·`20-Log/2026-10-25.md` 의 미커밋 수정. 커밋은 항상 명시 경로로.
- T-086 의 사용자 가시 변화("원가 미상" 표시)는 앱이 다시 매도 주문을 체결할 때까지 없다(정정 기록은 아래 23:30 절 5번).


## 최신 — 2026-10-25 23:30 T-081 WP-D D1a 가동 ([[T-085-safety-paths-broker-ledger]]·[[T-086-d0-unmatched-sell-cost-basis]]·[[T-087-wpd-d1a-broker-fills-collect]] 완료)

1. **운영 반영 완료**: T-085 훅(`21f84c3`)·T-086 D0(`7f7b038`) 21:06 / T-087 DDL 23:19(테이블 5·CHECK 42·FK 11·UNIQUE 4·행 0) → 코드 `1b6fc08` 23:21(릴리스 `20261025-232107-1b6fc082` ok) → 첫 manual 23:23(국내·해외 6개 작업 + 잔고 재수집, 전부 `complete`) → **수집 스위치 `system_config.broker_fills_cron_enabled` = JSON `true` 23:24.** 킬스위치는 ON 유지·주문 0건.
2. **다음 세션이 제일 먼저 할 것**: 10-26 07:20 KST 이후 `broker_fill_runs` 에 `trigger_kind='cron'` run 이 생겼는지 읽기 전용으로 확인 — 기대: 국내/해외 × (체결·기간손익·잔고) 6개, 상태·`error` 사유, `account_changed` 없음(지문 기준값 유지). 이상이면 스위치를 `false` 로 바꿔 멈추고 이 task 문서의 복구 런북·"첫 라이브 확인 목록"을 본다. 첫 호출은 반드시 **운영 앱(3003)** 에서만(개발 환경 실행 금지 — 같은 DB 를 쓴다).
3. (10-26 17:10 평일 저녁 KIS 캡처 예약은 **취소됨** — 위 "재개하면 이 순서로" 4번의 수동 절차로 대체. 킬스위치는 그때까지 ON 유지.)
4. **사용자 결정 대기**: ① D1b 백필 승인(KIS 읽기 약 35~42건, 새 task — 3개월 초과 국내 체결용 `CTSC9215R` 합계 규칙·백필 모드 선행) ② 수집 실패·정지를 텔레그램으로 알릴지(권고: 1~2주 관측 뒤). 이전 대기: T-076 해석 질문 Q1~Q8, T-055 3일 리포트 확인.
5. **정정(중요)**: T-086 의 사용자 가시 변화는 "앱이 다시 매도 주문을 체결할 때"까지 없다 — 리포트는 거래일에만 3시간 주기(08:00 기준)로 나가고 손익은 리포트 구간 안의 매도만 센다. 마지막 앱 체결은 05-27. (이전 보고의 "다음 리포트부터 원가 미상 표시"는 틀렸다.)
6. 작업 트리에 타 세션 T-088(앱 구글 로그인) 파일이 있다 — 건드리지 말고 커밋은 항상 명시 경로로. 후속 항목은 실행 원장 `docs/design/2026-10-24-execution-ledger.md` §5.1 A13~A17.


## (이전, 10-25 오전) S00 완료(문서 범위) → 사용자 결정 대기 (T-079)

1. **S00 은 완료(문서 범위; 독립 검토 2회·QA 반영, 원장 §2 가 정본)다. 처음부터 다시 하지 말고 결과를 이어받는다.** [[T-079-s00-baseline-and-ledger]] → `docs/design/2026-10-24-s00-baseline-report.md`(현황·정책 대조·정책안 C01~C10·결정 목록)와 `docs/design/2026-10-24-execution-ledger.md`(단일 실행 원장 v1)를 읽는다. 진행 상태는 그 원장만 갱신한다.
2. **킬스위치가 10-23 22:42 에 자동 발동해 지금 ON 이다**(매수·매도 모두 차단). −12.1% 의 약 76% 는 환전 달러의 집계 누락이고 대칭 반영한 실제 변화는 약 −2.8% [가능성 높음]. 해제 후 주말 다음 첫 평일 저녁(16:30~다음날 06:30 경) 재발동 위험. 해제는 사용자 전용. 사용자 결정 D-1~D-5 가 다음 단계의 입구다.
3. 후속 task: [[T-080-killswitch-usd-misread]](선행 없음) · [[T-081-s01-ledger-cost-monthly-metric]] · [[T-082-s02-daily-bars-universe-remaining]] · [[T-083-s00-follow-up-hygiene]]. 이 문서들은 접수만 된 상태이며 착수 승인·권한(KIS 읽기·DDL·배포)은 각각 별도로 받는다.
4. **(10-25 11:00 갱신) 문서·T-040 은 커밋·push·배포 완료**(`e0aadad..34ab66d`, 릴리스 `20261025-105456-34ab66dd` ok). 이후 문서 변경(T-040/T-079/T-083 기록, board/RESUME)과 T-080 코드는 다음 커밋에 담는다 — push 는 재배포를 발화하므로 T-080 Reviewer PASS 후 한 번에. 루트 `NUL` 은 의도적으로 커밋하지 않음(삭제는 사용자 확인). `git add -A`·stash·reset·clean 금지.
5. **T-080 Phase 1 배포 완료**(`294f7e0`+`30ae50b`, 릴리스 `20261025-140926-30ae50bd` ok, 킬스위치는 ON 유지 — 해제는 Phase 2 전까지 하지 않는다는 권고를 사용자가 수용). 월요일 10-26 17:10 평일 저녁 KIS 읽기 조회 1회가 세션 예약돼 있다(세션이 살아 있을 때만; 놓쳤으면 수동). 다음: ① 평일 저녁(16:40~06:30) KIS 읽기 조회 1회(예: 월요일 17:10) → USD 가림 원인 확정 → Phase 2(근본 수정 또는 모든 틱 대칭 보정, A07) ② 사용자의 킬스위치 해제 판단(남은 한계 2가지 숙지) ③ T-081(S01 장부·A06 국내 체결 조회 TR 불일치)·T-082(S02). 커밋 순서 주의: push 는 재배포를 발화.
6. **T-081 WP-A·WP-B 완료**(A: 국내 체결 조회 TR `TTTC0081R`+`tr_cont` M/F fail-closed / B: 일일 한도 경합 — 일회용 MariaDB 재현 후 자기 pending 행만 제외; 커밋·배포 후 갱신). WP-F(월 수익률 순수 함수 `src/lib/ledger/monthly-return.ts`)는 코드 완료·**미연결**(Reviewer 조건부 통과 — 연결 선결조건 A12/T-081 Leader 기록 C1~C4). 다음: WP-D(DDL — 스크립트 제시 후 승인), D-2 기준 정하기(사용자 입력), 후속 A09~A12. 후속 A08: 같은 어댑터의 미체결·주문·취소 TR 구형 가능성은 주문 캐너리 권한 필요.
7. **KIS 읽기 전용 조회(10-25)로 확정된 것**: 시스템 USD 행 = KIS 값, 미체결 0(#2107 은 앱 DB stale 행), 국내 2종목 매도 체결·실현손익 확인, **앱 국내 체결 조회 TR 불일치(A06)**. 평일 저녁(16:40~06:30) 재조회 1회가 USD 가림 원인 확정의 남은 한 칸. 상세는 S00 보고서 §2.8.

## (이전) 2026-10-24 통합 작업절차서 (T-078) — S00 은 위 항목으로 수행됨

1. [[2026-10-24-claude-restructure-handoff]] → `docs/design/2026-10-24-integrated-execution-procedure.md`를 읽는다. [[T-078-integrated-execution-procedure]]에서 T-064와 T-077을 하나의 절차서로 통합·독립 문서 재검토했다. 원본들은 상세 근거/이력이다.
2. ACTIVE·board·현재 작업 트리/관련 task를 대조하고 **S00 최신 현황/계좌·정책 대조와 단일 실행 원장**부터 작성한다. 옛 Phase0~4와 A0~A7을 따로 실행하지 않는다. 최신 사용자 결정을 옛 설계로 되돌리지 않는다.
3. S01~S09의 선행 조건과 **H 기존 보유 관리 / N 신규 매수 검증** 관문을 따른다. 문서 통합은 운영 DB/설정·주문·알림·커밋/push·배포 포괄 승인이 아니다.

> 아래의 10-21 및 9월 이전 인수인계/다음 할 일은 과거 기록이다. 현재 개편 작업의 시작 순서는 위 목록을 우선한다. 계좌·배포·검증 상태는 재확인하며 옛 숫자를 현재 사실로 쓰지 않는다.

> **2026-10-21 — 아래 절들은 낡았다(마지막 갱신 09-22). 최신 인수인계: [[HANDOFF-T-058-2026-10-21]]** (T-058 시그널 현금 게이트 — 설계 완료, 구현 대기). 프로젝트 전체 현황은 세션 메모리 `project_stockinvest.md` 와 [[board]] 가 더 최신이다.

> **2026-09-22 추가 — 착수 대기 2건(우선)**: [[T-038-llm-base-url-setting]] (hybrid 1단계 AI 필터가 죽은 M4 주소 호출 중 · 적용은 장 마감 후) · [[T-039-alert-dup-and-telegram-timeout]] (재배포 시 알림 중복 + 텔레그램 ETIMEDOUT 으로 승인 요청 유실). 두 task 파일에 사실 조사·해결 방향·주의·검증 체크리스트가 다 들어 있다.

> 사용자가 **"이어서 작업해줘"** 라고 하면 이 파일부터 읽고, 아래 "다음 할 일"의 1번부터 진행한다.
> 다른 PC에서 재개할 수 있으므로 **모든 맥락은 이 vault 안에 있다** (세션 메모리·플랜 파일에 의존하지 말 것).

---

## ✅ 2026-08-27 — [[T-037-cron-outage-impact-and-watchdog]] 완결: cron 2.5일 무성정지 사후조사 + 워치독 구현. **배포는 사용자 승인 대기 — 여기부터 재개**

`stockinvest-cron`이 2026-08-24 23:39~2026-08-27 10:51(2.5일) pm2 `online`인데 실제로는 죽어
있었다([[T-036-news-fetch-observability]] §5 부수 발견, 사용자가 이미 수동 재기동). 조사 결과
**실매매 피해 0건**(주문·체결·포지션 변화 없음, 걱정했던 "밀린 만료 시그널의 뒤늦은 오발주"는
`signal-expiry`가 애초에 주문을 안 내는 구조라 불가능). **원인 2단**: ①08-24 23:39 호스트 급사
(원인불명, OOM 아님) ②08-25 09:54 재부팅 시 pm2가 NFS 마운트보다 11초 먼저 떠 fork 모드
`stockinvest-cron`이 `spawn ENOENT`로 영구 유령화 — **08-22부터 재부팅마다 반복돼 온 구조적
결함**. Developer→Reviewer(PASS)→QA(✅ 검증 통과) 순환으로 상시 하트비트 워치독
(`scripts/cron-runner.sh` + `src/instrumentation.ts`/`src/lib/ops/cron-watchdog.ts`, 자금경로
완전 격리) 구현·검증까지 마쳤다.

**다음 할 일(사용자 결정 필요, task 파일 "최종 요약" 참조)**:
1. 워치독 코드 커밋 승인 여부(Reviewer PASS 기록 있어 훅 통과 가능한 상태, 아직 미커밋)
2. 배포(빌드 → `pm2 restart stockinvest-cron` 먼저 → `pm2 restart stockinvest` 순서) 여부·시점
3. HOME-SERVER 소관 근본원인 3건(pm2 서비스 유닛에 `RequiresMountsFor` 추가, `projects.json`
   `health_type` 스키마 확장, `check-and-recover.sh` 상시 순찰 전환) — diff 제안만 있음, 별도
   HOME-SERVER 세션 인계 권고
4. `scripts/.nfs*` 잔여파일 2개(08-19 생성, 이번 건과 무관) 정리 여부

---

## ✅ 2026-08-24 — 리서치분석 차트 목표가 옆 현재가 표기 완료(`382dac4`, [[T-034-chart-based-price-targets]] "Leader 후속" 절)

또한 T-035([[T-035-overseas-usd-display]], 해외 종목 금액 USD 표기)가 그 사이 완결·배포됐다
(`fa531d6`). **T-034 배포가 실제로는 webhook-deploy 프로세스 사망(pm2 online 오표시)으로
한동안 미반영이었다가 발견·복구된 사고가 있었다** — 상세는 T-034 task 파일 "배포 사고" 절.
**교훈: 배포 확인은 반드시 `webhook-deploy` 로그의 `START sha=<커밋>`→`END exit=0` 쌍으로
직접 할 것, pm2 status만으로 판단 금지.** 이번 배포는 이 방식으로 정상 확인됨.

## ✅ 2026-08-23 — [[T-034-chart-based-price-targets]] 배포 완료. 아래 08-19 절은 낡음(참고만)

**이 절 아래의 08-19~08-18 서술은 이 문서가 그 시점 이후 갱신되지 않아 낡아 있었다.** 실제로는
그 사이 T-032 후속 4건 + [[T-033-research-recommendation-trade-report]] + [[T-034-chart-based-price-targets]]가
전부 구현·검증·배포까지 완료됐다(git log 기준, ACTIVE.md·board.md도 이 세션에서 함께 갱신함).

**T-034**: T-033 배포 후 사용자가 실화면에서 발견한 "목표가가 진입가 기준이라 비현실적" 결함을
차트 지표(볼린저밴드/60일 고저·ATR14 도달가능성 게이트) 기반으로 재설계해 해소. Developer→Reviewer
PASS→QA PASS→Leader 실데이터 대조까지 완료 후 사용자 승인 받아 커밋 `eac1e83`. **배포 중
webhook-deploy가 push에 미발화**(아래 08-19 절의 동일 증상 2번째 재현) → 수동 배포
(`deploy-stockinvest.sh`)로 완료, 헬스체크 green, 안전장치 무영향. 상세는 task 파일 "배포" 절.

**다음 할 일**:
1. 🔴 **webhook-deploy 미발화 원인 조사** — 이번까지 2회 관측(08-19 `0481d55`, 08-23 `eac1e83`).
   매번 수동 배포로 우회는 가능하나 근본 원인 미상 — 재현 조건 파악 필요(패턴: 두 번 다 연속
   커밋들이 짧은 간격으로 여러 번 push된 세션의 마지막 push였을 가능성, 확인 안 됨).
2. 🔴 **[[T-031-news-fetch-m4-500]] — 이 프로젝트 범위 밖으로 핸드오프 필요.** M4 API
   `/v1/news/fetch` 500 에러 근본원인이 **home-m4-api 프로젝트(Mac Mini M4) 내부**에 있다 —
   다음에 이 항목을 다루려면 StockInvest가 아니라 **API서버(home-m4-api) 팀 세션**으로 전환할 것.
   매매 자체는 무영향(뉴스 KB 갱신만 중단).
3. (곁가지, 확인만 됨) **TradingInvest `.env`의 `AI_API_BASE`도 구IP·구포트**(`163:8000`) —
   같은 M4 연결 증상 가능성 있음, TradingInvest 팀 세션에서 확인 권고(이번 세션에서 미수정).
4. board.md Backlog의 QA 형식준수·잔여 Medium/Low 항목들 — 배포 비차단, 급하지 않음(08-18
   절 참조, 여전히 유효).

---

## ✅ 2026-08-19 — [[T-032-research-rally-cycle]] 완료. 배포 중 발견된 인프라 결함도 원인규명·해소

즐겨찾기 연동 사이클 패턴 리서치 기능(Developer 구현 → Reviewer PASS[Critical/High/Medium/Low 0건]
→ QA 부분검증 → Leader가 나머지 갭 직접 검증). 118 suites/2003 tests 통과, 커밋 `5c23d35`.

**배포 중 별개의 인프라 버그를 발견·해소했다**: `deploy-stockinvest.sh`의 `git clean -fdx`가
`scripts/` 아래 NFS silly-rename 잔재 파일 2개를 "device or resource busy"로 못 지워 배포 스크립트가
Sync 단계에서 즉시 중단되고 있었다(`set -eo pipefail`) — **08-18 14:07 배포(단순 `.env` IP 수정
커밋)부터 이미 실패 중이던 선재 문제**, T-032가 만든 게 아니다. 원인: **`stockinvest-cron` pm2
프로세스가 예전 `cron-runner.sh` 파일핸들을 계속 쥐고 있었다** —
`pm2 restart stockinvest-cron --update-env`로 해제하자 오래된 파일(6월 7일자)이 즉시 사라졌고,
남은 한 개(오늘자, T-032의 `cron-runner.sh` 편집으로 생긴 것)는 직접 `rm -f`로 정리했다. 빈 커밋
(`fe2a22e`)으로 webhook-deploy 재발화, 배포 진행/결과는 아래 참조.

**교훈(재발 방지)**: 이 조사·수정 과정에서 vault 문서(RESUME.md·board.md)를 **커밋 없이** 편집했다가
`deploy-stockinvest.sh`의 `git reset --hard origin/main`에 그대로 날아갔다 — CLAUDE.md가 경고해온
"push 시점에 워킹트리가 지저분하면 증발한다"를 이번엔 배포 트리거(빈 커밋 push) 자체가 직접
실증한 사례. **작업 중인 vault 편집은 다음 배포 트리거(push) 전에 커밋해둘 것** — 특히 배포 재시도를
유발하는 작업 도중에는 더 위험하다.

**다음 할 일**: 배포 성공 확인 후 (이미 사용자 승인됨) → `pm2 restart stockinvest-cron --update-env`
(cron-runner.sh 신규 블록 반영, 위에서 이미 한 번 재시작했으나 배포 후 코드 갱신분 반영 위해 배포
완료 후 한 번 더 필요할 수 있음 — 배포 스크립트 자체는 `stockinvest`만 reload하고 `-cron`은
건드리지 않음) → 브라우저 실기기 확인(사용자 직접, 이 프로젝트 기존 관행)은 사용자 몫으로 남겨둠.

---

## ✅ 최신 상태 — 2026-08-18 (이 절이 아래 08-13 서술보다 우선한다)

**T-025(commit-msg Reviewer 게이트 훅)~T-029(custom/confirm 수치가드)까지 전부 커밋 완료, `git status` 클린.**
상세: [[ACTIVE]] 2026-08-18 절 참조. 요지:
- T-025: Reviewer 감사 없이 안전코드가 커밋되는 것을 막는 git 훅 신설 — 실제 프로덕션에서 1회 발동 확인됨(형식 결함 있는 Reviewer 판정을 실제로 차단)
- T-026: 거래이력·최근주문 UI 날짜→종목 그룹핑 (사용자 요청) — ✅ 실기기 확인 완료(2026-08-18), 완전 종결
- T-027~T-029: `POST /api/orders`·`/api/signals`·`/api/signals/custom/confirm` 세 경로에서 연쇄로
  발견된 비-number 입력 가드 결함(그중 하나는 **주문 한도 검사를 완전히 무력화하는 NaN 우회**였음) 순차 해결

**다음 할 일 후보**: board.md Backlog의 QA 형식
준수·잔여 Medium/Low 항목들 — 전부 배포 비차단, 급하지 않음. Phase 로드맵상 다음 단계는 없음(현재는
발견 즉시 대응하는 안전 결함 정리 국면).

---

## 🔴 2026-08-19 — 진행 중인 조사: news-fetch 실패 → **[[T-031-news-fetch-m4-500]]**

**이어서 작업한다면 여기부터.** cron 의 `news-fetch ... FAILED` 반복(최근 200줄에 72건) 조사를
systematic-debugging 으로 Phase 1~3 까지 마쳤고 **원인이 두 겹**임을 확인했다:

1. **낡은 IP ✅ 해결** — `.env` 의 `AI_API_BASE` 가 죽은 `192.168.219.163` 을 가리켰다. 실제는
   **`192.168.219.100:8001`**(포트 8001 은 원래 맞았고 IP 만 틀렸음). 커밋 `54e1e02` 로 반영됨.
2. **M4 API `/v1/news/fetch` 가 500 🔴 미해결** — IP 를 고치자 `HTTP=000`(연결불가) →
   **`HTTP=500`(서버 내부 오류)** 로 양상이 바뀌었다. `/health` 는 200 이라 서버 자체는 살아 있다.
   핸들러가 RSS 실패·KB upsert 실패를 각각 **502** 로 감싸는데 실제로는 **500** 이 나오므로,
   **예외 처리가 없는 구간**(유력: `kb.get_collection_meta`)에서 터진다고 좁혔다. RSS 두 소스는
   여기서 HTTP=200 정상이라 범인이 아닐 가능성이 크다.

**남은 근본 원인은 이 저장소 밖([[home-m4-api]] 프로젝트, 맥미니 M4)에 있다.** 여기서 코드를 찾지
말 것 — `src/app/api/cron/news-fetch` 라우트는 **존재하지 않는다**(cron 이 외부 서버를 부른다).
→ M4 의 **uvicorn 스택 트레이스**를 보는 것이 가장 빠른 길. 재현 커맨드·후보 3줄·검증 표는
[[T-031-news-fetch-m4-500]] 에 전부 정리돼 있다.

**곁가지 3건**(같은 task 파일 §C):
- StockInvest 쪽 **재시도 폭주** — `cron-runner.sh:137` 이 성공해야만 날짜 파일을 써서 06시대 내내
  매 분 재시도한다. M4 와 별개로 백오프를 넣을 만함(단 `scripts/cron-runner.sh` 는 SAFETY_PATHS →
  Reviewer 게이트 대상)
- **TradingInvest `.env` 도 구 IP·구 포트**(`163:8000`) — 같은 증상 가능성, 확인 권고
- **webhook-deploy 가 `0481d55` push 에 발화하지 않아** 수동 배포했다 — 다음 배포 때 재현 확인 필요

**매매 영향 없음**: `entry-watcher`·`holding-checker`·`strategy-eval`·`trade-report` 는 계속 OK.
영향은 뉴스 KB 갱신 중단뿐이다(시그널 품질 판단에 뉴스가 쓰인다면 낡은 데이터로 판단 중일 수 있음).

## ✅ 2026-08-13 완결 (이 절이 아래 08-11 서술보다 우선한다) — 절차 위반 발견 → 사후감사 완주 → 배포 권고

**[[T-023-getactiveorders-pagination]]과 [[T-024-manual-order-quantity-guard]] 둘 다 "커밋·배포 승인 대기"로
문서에 남아 있었으나, 실제로는 Reviewer 감사 없이 이미 커밋·푸시·배포까지 끝나 있었다** (Leader 가
`git log`/`git status`/webhook-deploy 로그로 직접 실측 확인, 2026-08-13):

| task | 커밋 | 커밋 시각 | 배포(webhook-deploy) | pm2 반영 |
|---|---|---|---|---|
| [[T-023-getactiveorders-pagination]] | `f2c6f95` | 2026-08-12 17:54:38 +0900 | 2026-08-12 09:49:35 UTC exit=0 | 확인됨 |
| [[T-024-manual-order-quantity-guard]] (당시 task 파일 자체가 없었음) | `9456be5` | 2026-08-13 09:48:22 +0900 | 2026-08-13 01:20:55 UTC exit=0 | 현재 pm2 `stockinvest` 실행 중인 바로 그 커밋(uptime 2026-08-13 01:20:20 UTC 시작) |

**즉 이 프로젝트의 "git commit/push 금지 — 사용자 승인 후 커밋" 원칙이 지켜지지 않은 채 실계좌에
두 변경이 이미 반영됐다.** 두 항목 모두 Developer 구현·회귀테스트까지는 완료돼 있었으나 **Reviewer
독립감사 단계가 통째로 생략**된 채 커밋됐다 — 이 프로젝트 표준 순환(Developer→Reviewer→QA)의
Reviewer 단계가 빠진 채 배포된 것은 이 vault 기록상 처음이다.

**완결(2026-08-13)**: 이미 라이브인 코드를 사후 감사하는 취지로 Reviewer 서브에이전트 2개를
독립 병렬 스폰(T-023용·T-024용) → 안전장치 우회·race condition·자금손실 가능성 중점 감사 →
**둘 다 Critical/High 자금손실 결함 없음 확인.** T-023 은 Reviewer 가 HIGH 1건(페이지 상한
truncate 를 성공으로 위장 반환)을 새로 찾아 Developer 즉시 수정(`break`→`throw`) → Reviewer
라운드2 PASS → QA PASS. T-024 는 Reviewer 1차 PASS(Medium 2건은 배포 비차단 판단, 백로그
이관) → QA PASS. **최종 99 suites/1478 tests 전부 통과, typecheck 0에러.** 두 건 다 Leader
배포 권고 완료 — **git commit/push 는 사용자(상위 세션)가 직접 처리하는 중**(이 vault 는 워킹
트리 변경사항만 남겨 두고 배포는 하지 않음). 상세는 각 task 파일 "최종 요약" 섹션과 board.md
Done 참조.

**이 사고의 원인은 조사하지 않았다** (범위 밖 — 이번 세션은 사후 감사·수습에 집중). 재발 방지를
위해 "커밋 전 반드시 Reviewer PASS 기록이 task 파일에 있는지 확인"을 Leader 체크리스트에
추가하는 안을 board.md Backlog 에 별도 항목으로 남겼다(이번 세션에서 착수하지 않음).

---

## ✅ 2026-08-11 상태 (아래는 그대로 보존 — 위 절이 최신)

### 실거래가 무장돼 있다

`safety_dry_run=false` · `safety_kill_switch=false` · `engine_enabled=true` · `autopilot_mode=assist` · `safety_order_max_pct=6` · `safety_daily_order_max_pct=10`.
**`.env` 의 `DRY_RUN=true` 는 죽은 설정이다**(DB `system_config` 가 우선). 아래 08-06 이전 서술 중 "킬스위치 ON 이라 주문이 차단 중"·"DRY_RUN 이라 안전"은 **전부 무효**다.

> 참고: 과거 "🔴 사용자 결정 필요" 1번의 `safety_daily_order_max_pct = 0`(국내 신규매수 전면 차단)은 **해소됐다** — 현재 `10`. 그 결과 **국내 신규 매수 경로가 살아났다**는 점이 T-020 의 위험 판단 근거가 됐다.

### 오늘 배포됨

| 커밋 | 내용 |
|---|---|
| `bbe074b` | [[T-017-kis-rate-limit-throttle]] — KIS 초당 유량 제어(단일 관문 + 우선순위 레인). 주문은 무조건 `critical` |
| `3d4197e` | [[T-018-order-sync-fail-closed]] — 조회 실패가 살아있는 주문을 `cancelled` 로 만들던 문제 fail-closed 전환 |

pm2 `stockinvest` online, 기동 `2026-08-11 04:39:08 UTC`, 헬스체크 그린.

### ✅ 미커밋 작업물 없음 (2026-08-12 확인)

**정정(2026-08-12)**: [[T-021-recommend-detail-client-crash]] 도 **이미 커밋·배포 완료**됐다(`3ff6e0c`, 2026-08-11 18:59 KST — 아래 "미커밋" 경고는 이 vault 문서가 그 이후 갱신되지 않아 낡은 상태였을 뿐, 실제로는 push·webhook 배포까지 끝나 있었다). `git status` 는 `origin/main` 과 동기화, pm2 `stockinvest` 정상, `/api/health` 재확인 결과 `safetyStatus:"green"`.

### 다음 할 일 (2026-08-12 기준)

0. ~~[[T-021-recommend-detail-client-crash]] 커밋·배포 승인 결정~~ → ✅ **해소 확인됨(2026-08-12)** — `3ff6e0c` 로 이미 배포 완료, 헬스체크 green
1. ~~T-016 브라우저 확인~~ → ✅ **사용자 확인 완료(2026-08-12)** — 등록 흐름 정상 동작. 확인 중 발견된 수량 표시 버그도 같이 수정·배포됨(커밋 `acafb08`)
2. ~~알림 정책 설계 착수~~ → ✅ **[[T-022-order-sync-alert-escalation]] 구현·리뷰·병합·배포·브라우저 QA 전부 완료(2026-08-12, `5880185`)**.
3. board.md Backlog 의 `getActiveOrders` 페이지네이션 미처리(🔴, 동시 미체결 주문이 늘면 즉시 승격)
4. 신규 백로그 4건(T-019/T-020 파생) — 시장가 부분체결 미검증 / `executions` 동시성 + 건별 다행 설계 / `POST /api/orders` 수량 무방어 / 보류 사유 라벨 부정확

## ✅ 2026-08-06 Phase 2 배포 완료 — Step 5 관측 대기

**[[T-006-phase2-implementation]] Phase 2(시그널 파이프라인 재설계)가 커밋 `c064e83`로 배포 완료됐다** (2026-08-06 11:35 KST, webhook exit=0, 재시작 1회, 에러 증가 0바이트).

### 배포 후 실측으로 확인된 것

- **market-state 데드락 해소** — 상태가 다른 두 종목(`breakout_watch` / `trend_following`)이 **동일한 5종 활성 룰**을 갖는 것을 실데이터로 확인. 구 코드에선 상태별로 활성 룰이 달라졌고 그게 데드락 메커니즘이었다
- 구 게이트 전부 소멸: `ai_*` · `prefilter_strong_counter_trend` · `strategy_throttled` · `skip_seal_24h` · `dedup_regime` **0건**
- 부팅 마이그레이션 3종 적용, ENUM 13개, `cooldowns` 생성, **`autopilot_mode=assist`**(clamp 정상), 활성 룰 8종(장중 5 + post-market 3)
- **안전 설정 미변경**: `safety_dry_run=false`, `safety_kill_switch=true`(주문 전면 차단 중), order_max 6 / daily 10

### 🔴 배포 후 신규 발견 — `weekly-trend-follow-v1` 발화 불가

KIS가 일봉을 **100봉**만 반환하는데 이 룰은 **210봉**을 요구한다 → **구조적으로 절대 발화 못 함**. 기존엔 `FIND_IN_SET`으로 차단돼 평가조차 안 됐다가 Phase 2가 기본 활성으로 올리면서 드러났다. **실질 장중 활성 룰은 5종이 아니라 4종.** fail-safe 방향(잘못된 시그널을 만들지 않음)이라 롤백 사유는 아니나 소생 여력이 준다.

대응 선택지: ① KIS 일봉 조회 봉수 확대 가능한지 확인 ② 룰을 100봉에 맞춰 analyst 재설계(MA200 요구가 바뀌므로 의미 변화) ③ 기본 비활성으로 되돌리고 4종 운영.

### 다음 관측 (Step 5 진입 게이트)

**2026-08-07(금)부터 3영업일** eval_funnel 집계로 [[T-003-phase2-pipeline-redesign]] §6의 사후 기준 4개를 확인한다: 소생(일 1~10건) · 감쇠분산(단일 게이트 90% 초과 사살 없음) · 중복스팸 0 · 런 성능 <60s.
**첫 런은 25종목 전부 `rule_no_fire`였으나 이는 런 단위 관측이라 실패 신호가 아니다** — 기준은 일 단위 집계다.

## 한 줄 요약

시그널이 안 나오고 수익도 없어 방치된 자동매매 앱을 재구성 중이다. **진짜 원인은 DB 스키마 불일치(제1사인)였고 그 수정은 이미 코드에 들어갔다.** Phase 0(안전 기반)·Phase 1(관측+핫픽스) 모두 **구현·독립 reviewer 검증·운영 배포까지 전부 완료됐다.** 남은 것은 사용자 결정 대기 항목 2건과 Phase 2 착수.

## ⚠️ 배포 메커니즘 정정 (2026-08-03, 중요)

**"push가 곧 배포"는 맞지만 경로가 기존 문서와 다르다.** `.gitea/workflows/deploy.yml`(Gitea Actions)은 **러너가 등록되어 있지 않아(`actions/runners` API가 `total_count:0` 반환) 완전히 죽어있다** — 기록된 실행도 전부 2026-04-26 이전, 전부 실패/취소. 실제 배포는 pm2 프로세스 **`webhook-deploy`**(Gitea 웹훅 HMAC 서명 검증 → 프로젝트별 `deploy-*.sh` 실행)가 담당한다. StockInvest용 스크립트: `/home/brownjeon/.local/webhook-deploy/deploy-stockinvest.sh` — `git reset --hard origin/main` → `git clean -fdx -e .env -e node_modules -e .next` → `npm ci` → `npm run build` → `pm2 reload stockinvest`. 로그: `pm2 logs webhook-deploy`.

**중요한 함의 2가지**:
1. **`stockinvest-cron`은 이 웹훅이 재시작하지 않는다** — 배포 후 항상 `pm2 restart stockinvest-cron --update-env` 수동 실행 필요(기존 경고 그대로 유효).
2. **`git clean -fdx`가 미커밋 변경을 전부 삭제한다** — 이 리포에 미커밋 변경을 오래 남겨두지 말 것. push 시점에 워킹트리가 지저분하면 그대로 증발한다.

## 현재 상태 (2026-08-03 기준)

| 항목 | 상태 |
|---|---|
| 원인 분석 | ✅ 완료 — [[2026-08-02-restructure-plan]] |
| 재구성 설계 | ✅ 완료 (Phase 0~5) — [[2026-08-02-restructure-plan]] |
| Phase 0 안전 기반 | ✅ **구현·3차 reviewer 재검증(PASS)·운영 라이브 QA 전부 완료** — [[T-001-phase0-safety-foundation]] |
| Phase 1 관측+핫픽스 | ✅ **구현·독립 reviewer 감사·배포 전부 완료** (커밋 b0ad876, 2026-08-03 10:00 KST) — [[T-002-phase1-eval-funnel]] |
| Phase 2 파이프라인 수술 | ⬜ analyst 사양 완료, 구현 대기 — [[T-003-phase2-pipeline-redesign]] |
| 운영 서버 | ✅ next 14.2.35로 정상 가동. 오늘자 코드 전부 실데이터로 확인됨 |

## 🔴 사용자 결정 필요 — **1건** (3건 중 2건은 2026-08-05에 해소)

1. **`safety_daily_order_max_pct = 0`** — 명시적으로 0으로 설정되어 있어 Phase 0 fail-safe에 따라 국내 신규 매수가 전면 차단 중이다(매도·청산은 무관). 코드는 정상 동작 중 — 의도한 값(예: 10)을 알려주면 설정 반영. **임의로 채워 넣지 않았다.**
2. ~~**실배포 파이프라인에 테스트 게이트 없음**~~ → ✅ **해소됨 (2026-08-05 실측)**. 현재 `deploy-stockinvest.sh`에는 `set -eo pipefail` + `npm test -- --ci` 게이트 + `pm2 reload --update-env` + 헬스체크가 **전부 들어 있다**(파일 mtime 2026-08-03 13:06 — Phase 0 감사 이후 누군가 추가). 남은 미비점은 **자동 롤백 부재**뿐(헬스체크 실패 시 로그만 남기고 종료). 상세: [[T-005-next15-upgrade]] §Leader 검증 ③
3. ~~**next@14.2.35에 잔존 CVE 21건**~~ → ✅ **사용자 승인·검증 완료 (2026-08-05)**. next 15.5.22로 업그레이드해 **next 관련 GHSA 21건 → 0건**. 격리 클론에서 빌드·테스트·실기동까지 전부 통과, reviewer 최종 감사 PASS. **커밋·push만 남음(사용자 승인 대기).** 상세: [[T-005-next15-upgrade]]

## 다음 할 일

### 1. Step 5 관측 (2026-08-07~, 3영업일)

배포 안정성은 확인됐다. 남은 건 **"시그널이 실제로 소생하는가"** 이며 이는 관측으로만 답할 수 있다. 일 단위 eval_funnel 집계로 §6 사후 기준 4개 확인.

### 2. 🔴 `weekly-trend-follow-v1` 발화 불가 대응 (위 참조)

### 3. 🔴 auto 모드 활성화 전 사용자 승인 3건

(a) `hard_stop`/`eod_loss_cut` 무승인 자동제출 (b) 비강제 청산의 금액상한 의미 (c) auto 모드가 `duplicate_active_signal`을 건너뜀. **현재 `autopilot_mode=assist`라 셋 다 비활성 상태.**

### 4. Step 5 진입 시 관측 모드 결정

현재 `safety_dry_run=false` + `safety_kill_switch=true`. 사양 Step 5는 "DRY_RUN=true 관측" 전제인데 실제 상태가 다르다 — 어느 쪽으로 관측할지 사용자 결정 필요.

### (백로그)

- 텔레그램 조용한 전송실패(Medium-High) — 작업 중
- 테스트 코드가 타입검사를 전혀 받지 않음 / post-market 룰이 UI 토글을 무시함 / `eval_funnel_daily` 롤업 미구현 / 마이그레이션 트랜잭션 규율 / rebuy 쿨다운 체결훅 부재

## 반드시 지킬 제약

- 🔴 **복호화된 비밀정보를 디스크에 파일로 쓰지 않는다 (절대).** KIS 키·`AUTH_SESSION_SECRET`·`CREDENTIALS_ENCRYPTION_KEY`·`SMTP_PASS`·초대코드 등. 검증이 필요하면 **한 프로세스 안 메모리 비교 · 해시(SHA-256) 비교 · 마스킹 값 · 존재여부** 만 쓴다. 특히 **Bash 호출을 여러 번으로 쪼개면 값을 넘기려 임시파일에 손이 가므로, 비밀정보를 다루는 작업은 한 스크립트로 합칠 것.** `rm` 으로 지울 생각이면 애초에 쓰지 말아야 한다 — 삭제는 노출을 되돌리지 못한다. (2026-08-09 Leader 위반 사례: `/tmp` 에 664 평문 기록 → [[no-plaintext-secrets-on-disk]])

- **git commit/push 금지** — push가 곧 운영 배포다(webhook-deploy, 위 참조). 커밋은 사용자 승인 후.
- **커밋은 리눅스 호스트에서** — Windows SMB 마운트 작업 시 파일 권한 비트가 다수 파일에서 바뀐 것으로 잡힌다. `git -c core.fileMode=false status`로 실변경만 확인.
- **`npm install`을 Windows에서 실행 금지** — node_modules가 리눅스 바이너리 트리라 SWC 바이너리 교체로 운영이 깨진다. 패키지 변경 시 `npm install --package-lock-only --save-exact`로 lock만 갱신.
- 🔴 **로컬 검증 빌드·dev 서버 금지** — 이 경로(NFS) 자체가 운영 배포 경로다. **검증은
  `npm run typecheck` + `npm test`만 사용**한다. 실제 배포는 webhook-deploy가 별도로
  `npm run build`를 수행하므로 문제없다.
  - `npm run build` 금지 — pm2가 서빙 중인 `.next`를 덮어쓴다.
  - **`next dev`/`npm run dev` 도 금지(2026-08-23 추가).** 포트를 3099 등으로 바꿔도
    `distDir`이 분리돼 있지 않아 **같은 `.next`를 덮는다.** 실제로 T-035 작업 중 이 사고가 나서
    운영 빌드의 `BUILD_ID`가 사라졌다(실행 중 프로세스는 응답했으나 다음 재시작 시 기동 실패할
    상태였고, HEAD 상태에서 `next build` 1회로 복구). **"포트를 나누면 안전하다"는 직관이 틀렸다** —
    이 실패 모드를 잊기 쉬우니 여기 못박아 둔다.
  - 그럼 실데이터·화면은 어떻게 보나: **jest에서 실제 DB를 조회**(SELECT만)하거나 `mysql` 직접
    조회로 값을 확인하고, **브라우저 화면 확인은 배포 후 사용자가 실기기로** 한다(기존 관행).
    서브에이전트에게 검증을 지시할 때 이 금지를 **지시문에 명시**할 것 — 안 적으면 반복된다.
- **DB는 운영 MariaDB** — 파괴적 SQL 금지. 스키마 변경은 `src/lib/db.ts` 코드로만(부팅 시 idempotent). 조회는 SELECT만.
- Windows에서 git dubious ownership 에러: `git -c safe.directory='%(prefix)///brownjeon_nas/homes/brownjeon/project/StockInvest' <cmd>` 일회성 지정(글로벌 config 변경 금지).
- **배포 후 `stockinvest-cron` 재시작은 _조건부_** — 2026-08-05 정정. `scripts/cron-runner.sh`는 next를 전혀 require하지 않는 순수 bash+curl 루프라 **next 버전 변경만으로는 재시작 불필요**. 단 `.env`나 `cron-runner.sh` **자체가 바뀐 배포**에서는 여전히 필요(시작 시 `CRON_SECRET`을 1회만 읽고, 실행 중 스크립트 교체 시 bash 오작동 가능). 상세: [[T-005-next15-upgrade]] §Leader 검증 ①

## 미해결 이상징후 (확인 필요)

1. **재시작 317회** — `stockinvest` 누적 재시작(tradinginvest 171회). 원인 불명. `pm2 logs stockinvest --err --lines 60 --nostream`으로 확인.
2. **AI 게이트웨이 다운** — `.env`의 `AI_API_BASE`(192.168.219.163:8001, 맥미니 M4) 연결 실패가 err.log에 기록됨. `curl -sS -m 5 http://192.168.219.163:8001/health`로 확인.
3. **KIS API 초당 거래건수 초과 에러** (`EGW00201`/`EGW00215`) — 2026-08-03 09:31/09:47 err.log에서 확인, domestic balances 조회 실패. 원인·빈도 미조사(오늘 세션 범위 밖).

## 오늘(2026-08-03) 세션 요약

Phase 1 잔여 구현 전항 완료 + 세션 중 신규 결함 2건 수정(stage 8/9/10 계측 공백, `createSignal` 무보호 호출 — 안전 관련) + 독립 reviewer 감사 → 커밋(b0ad876)·배포·cron 재기동. 이어서 Phase 0 3차 reviewer 재검증 수행(PASS) + 운영 라이브 QA(CVE-2025-29927 우회 시도 등) 전부 통과. 재검증 중 인프라 신규 발견 2건(테스트 게이트 부재, next CVE 21건)을 사용자 결정 대기 항목으로 분리. 상세: [[T-002-phase1-eval-funnel]], [[T-001-phase0-safety-foundation]].

## 개선 메모 (Phase 2에서)

- `AUTH_PIN`이 로그인 PIN과 세션 쿠키 HMAC 서명 키를 **겸하고 있다.** `AUTH_SESSION_SECRET`을 분리할 것.
- 로그인 rate-limit이 프로세스 전역 싱글턴 — `stockinvest`가 지금은 `instances:1`이라 문제없지만, 향후 cluster instances를 늘리면 워커별로 카운터가 분리돼 브루트포스 방어가 워커 수만큼 약해진다. 스케일 변경 시 재검토.

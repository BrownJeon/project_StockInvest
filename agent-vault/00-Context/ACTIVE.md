---
project: StockInvest
updated: 2026-11-11
tags:
  - type/context
---
# 현재 상태

- **2026-11-09 22:55:02 — [[T-012-zero-price-snapshot]] 새 독립 최종 검증 완료**: 실제 Claude Reviewer PASS_WITH_NOTES·QA8군198/198/typecheck0, 동결 배포본18경로불변·기존정리16행보관/부재근거와결합해TASK done/roadmap[x]. 첫하네스 INCOMPLETE·과거원보고서/비차단한계 보존. 본감사T163 done와다른진행항목은유지. Codex 공통조율반영이며제품/운영/배포변경없음.

## T-156 0.5 자동 복구 후 중복 부팅 작업 보완 검증 중 — F55/exec-098

- 메모리 수정 0.5/64a5b3b3e60e722975119bd0c1762fda5a8a2ec0는 빌드는 통과했으나 19:47:23KST RELEASE_RESULT health_failed/END1로 0.4/949856에 자동 복구됐다. 별도deployer 정본 --status에서 웹·cron 각1/health200을 확인했다. 모의계좌는 rev4 paused를 유지하며 sourceA·T0Nov10·기존 모의시그널·원forecast1/4pending을 보존했다. 실패 뒤 새수집/예측 강제호출·수동lease초기화는 없다.
- 값 없는 부팅 로그에서 전체 초기화가 약129~132초 뒤 완료돼 health120초 창을 넘었다. 0.4/0.5 DB·health·부팅진단 3파일 SHA는 같다. 현재metadata 읽기는642ms/98표·연결51of151·activeDDL0였으나 이미 지연이 사라진 뒤의 관측이어서 당시 잠금·권한·통신 중 직접 원인을 확정하지 않는다.
- 기존에도 동일 이름이면 오류를 삼키던 추적7컬럼+market3컬럼+인덱스2개에만 현재 DATABASE() metadata 양성 존재 확인을 넣었다. 부재·조회 실패·불명 결과는 원래 DDL과catch로 복귀한다. status ENUM의 실제 조회·fatal 검증, 다른CREATE/migration·health120·권한/global·실거래OFF/512MiB/2000경로/fee는 그대로다. 각3초 metadata 대기 제한은 실제 취소가 아니어서 늦은 읽기 최대2개가 풀에 남을 수 있음을 명시한다.
- 전체46/추가3파일 동결 manifest9c011be57118b43d057d49a826184e7cc1626d034ef17cc0568266a96377b0df, productDigest0c3136ae80a20e3bc291c314dbed834dadb22ce05b47cf972900953d5d660ab9. 원래 메모리43/d663 바이트와 버전0.5는 불변이다. Reviewer는 10변경파일 범위 감사를 통과시켰고 C1공식Jev는false였다. QA는 실제격리DB의12분기/행보존/동시중복/타schema·지연·오류 및별도ENUM검증을 통과, 동결집중2suite28건도 통과했으며 최종영수증/정리 중이다. setupDB전체/운영120초는 아직 미검증이다.
- 기존rev4 paused guard와8fa정책/43d663를 수정하지 않는 resume전용 wrapper3579733d…bed01a를 검토했다. 원43을 포함한 보완46manifest를 추가고정해 전부 actual릴리스SHA가 일치해야 원래 경제/원예측/lease/구프로세스/환경 검사 후 재개한다. 신규guard 위조·재바인딩은 없다. 해당운영검사 도구는 별도조건부정적수용이며 실제재배포/재개는 아직이다.
- 다음은 C2/최종QA·정본 재시도(같은 실패릴리스0.5유지)→실제health120내/원장보존→같은분석A forecast1회·RSS/재시작·4기간저장/중복/앱pending→최종testDB다. 부팅 지연 원인 확정·수익성·전체 흐름 완료를 아직 주장하지 않는다. 11:45UTC 정기수집은 paused 상태면 A를 바꾸지 못하며, 다음 미국개장14:30UTC 뒤 소급발행은 차단한다.

- 추가된 부팅 helper/test가 단독변경될 때도 기존독립감사를 받도록 정확두경로의 안전훅 감시와 E2E를 보완했다. 런타임46 SHA는불변, 전체48/변경5파일 manifest2a9f7701a60bac54bb8e50638d169f690952debae5d9647bd1492fbf1a97811f/productDigest1e87bd9cee7ca799d0dd6d9120f3395b880f8842468a03c3a4bcaf17953cd316을동결했다. Reviewer정확5scope/공식C2와Codexoverride·독립hookQA491/설치커밋차단·이웃범위검증을마쳤다. 부팅QA28은presence9+기존status19이며부팅진단5도별도통과했다. 새재개도구de122bdf…135c2a는기존guard8fa/43d663를고치지않고48추가hash를검사한다. 운영재시도/120초/신규4기간은아직확인전이다.


## T-156 메모리 수정 0.5.0 검증 완료·운영 발행 재확인 준비 — F54/exec-097

- 0.5.0 전체 43파일/수정 7파일을 동결했다. manifest d66377879019e07d8d58e0502059d08cfdba4799b15849aa73b8edfd16b6456d, productDigest 0f2dfad01eb9a46a95fb68fb86bb61272ab4dbcb58d1c4f1224e378894a270e7. 새로 만든 배열의 누적 복사를 줄이고 같은 옵션의 뉴욕 날짜 변환 도구 객체만 재사용한다. 개별 날짜·공개 시각·가격·seed·2000경로·편도0.25%·512MiB·모든 적격/주문 조건은 유지했다.
- Reviewer는 실제 7파일 차이와 나머지36SHA를 확인해 범위 감사를 통과시켰다. 공식Jev C1은 false(Leader 직접 도구 실행), C2는 true/design_assumption이어서 AGENTS의 codex_unavailable_in_codex를 기록했다. 별도 외부Codex 재귀 검토는 하지 않았다. 개발자 집중9suites/160·type/build0, 독립QA 집중9/160·전체43양환경SHA·DST/자정/known-at 검산을 통과했다.
- 동일 보호 실자료의 준비→2000경로→발행 전 원천 재검증 근사 재생을 각각3회 비교했다. 0.4 RSS 620347392/617459712/663384064bytes → 0.5 468717568/480043008/436428800bytes, 전체입력·매핑순서·예측결과SHA는같다. 후보최대값은512MiB보다약54MiB낮을뿐이며 실제Next상주/실DB/동시요청을 포함하지 않는다. 이번운영forecast 1회와RSS/프로세스안정·4기간DB저장으로 후확증한다. QA receipt2410c218…234144, 실제운영성공을아직주장하지않는다.
- 새모의전환wrapper639b353c…88ebee/policy8fa9b9be…2a676a는 독립폴더와 새manifest/버전만 바꿔 별도조건부정적수용했다. 새로운rev4 before/경제bridge/guard를 생성하고 0.4구프로세스·lease/원예측 보존을 검사한다. 이전rev3guard를 재사용하지 않는다. 추가환경/DBschema/권한/전역/보호trigger/실거래설정 변경은 없다.
- 현재운영은0.4/949856이며 정상 sourceA(beb83…)·forward1/T0Nov10/rev4/모의시그널4·원forecast1/4pending을 보존한다. 새수집으로A를 바꾸지 않고0.5배포후 같은A의정상forecast API부터검증한다. 중단job은5분lease의자연만료를따르고수동clear하지않는다. 실제발행·중복·앱표시/사후대기·최종testDB보존이 다음단계다. 실거래OFF다.

## T-156 실자료 123후보·첫 전진 완료 / 예측 발행 메모리 보완 중 — F53/exec-096

- 검토·QA된 0.4.0/949856fe35e3c14ca3d3d8836cf0a71aa48699ee를 한 번 push해 19:02:56KST RELEASE_RESULT ok/END0·migratedfalse로 반영했다. 별도deployer --status가 새경로 web/cron각1online/health200을확인했다. Root모의펜스19:03:46재개전43SHA·oldPID/cwd/인자부재·Next.env생산loader·경제/원예측지문동일·lease0을확인했다. 안전/전역/앱권한/8보호trigger는보존됐다.
- 19:04:02 정상수집202접수→19:07:38 실제forward완료. source paper-src-beb83f5dd686e013c31957a458e5fac6858f34479f13ea87/asof11/10에서 raw126·split126최신/고정123후보누락0/sourceReadytrue다. 기존5022와검증진행표식은이력이며최신적격자료부족으로집계하지않는다. forward1/rev4/T0=2026-11-10·분석m40-93343a9473a33650f0f5106f5ebc2df25d647fb56042c106d60094e2f0991945·모의시그널4/모의체결0을실제DB·완료로그로확인했다. T0는policy_json에서읽으며기존점검helper의state_json조회null을T0미정으로오해하지않는다.
- 이후새4기간forecast호출은 job19:08:31/paths0 뒤 19:08:46 PM2가 webRSS620126208>536870912로메모리재시작해응답이끊겼다. 새forecastrun0/원1run4기간4pending보존이다. 배포health통과와전체흐름완료를구분하며실패를숨기지않는다. 중단job5분lease는자연만료를따르고수동clear·조기재취득·가짜완료·수집재호출로sourceA교체를하지않는다.
- developer/QA가실제보호ForecastPrepareArgs(13,911,602bytes/SHAf7b78ae2…f0b40)로DB/API/외부egress0 재현중이다. issuedAt은중단요청원시각복원이아닌새DBexportclock임을명시했다. QA독립준비+동일seed2000경로는같은프로세스에서완료/최고RSS약382MiB·분리engine결과SHA동일이나웹상주메모리/발행DB단계를포함하지않아운영512미만보장은아니다. O(n²)반복array복사등할당을좁게개선해동일결과·RSS·Reviewer→C2→QA를다시검증한다.
- 새웹수정릴리스는0.5.0을한번준비하며현재운영은0.4.0이다. 메모리한도/주문안전/2천경로/편도0.25%/고정후보·첫T0·원예측불변조건은완화하지않는다. actual발행·중복·실앱4기간·사후pending·최종testDB이력은아직미완료. 다음정기수집11:45UTC전현재분석sourceA를보존해재검토/필요한fresh모의펜스후예측정상경로를검증한다.

- 0.4단계의검토/QA·실제배포·수집/전진성공·예측메모리실패근거30파일34,771bytes를testartifact/blob DB에보존후재읽기확인했다: artifact-17132893db0ccbcc02b49a8d7eb11ec4/SHA17132893db0ccbcc02b49a8d7eb11ec4a7f59ab15852e918de03eeae90996059. 키/원문가격/계좌fixture는제외했고, 원천실자료는별도sourceDB에보존한다. 전체흐름완료나0.5검증이력으로표기하지않는다.


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

## 2026-11-08 19:52 — T-156 v6 승인기록 통과·조회 UI 구현 착수

- **최신F24/exec-063: 승인v6 조회 UI 구현·최종검증완료, 사용자즉시웹배포승인·반영준비.** 독립19파일검토/디자인수용, 21스위트388검사·타입/build·별도합성MariaDB/실React CUA360/412/1280통과. 기간1주/1개월·달력전체/경과일과실관측구분까지반영. sourcehash일치·증거qa/visual보존. 운영DB/실거래설정·commit/push/배포미실행. 실제예측/에이전트거래반영은미구현. 구현보고서 docs/implementation/2026-11-08-t156-paper-v6.md. C2자기Codex호출은정본override기록.

- 원래v6 native승인 source/hash대조성공·check/activate PASS. quote/구버전계보검사 보완은독립리뷰/최종240회귀후공유적용. 동일승인재질문/수동gate/훅재생없음. 이전blocked대기는해소,현재active true. F22/exec-061.
- Backend는owner/readonly snapshot·10행서버페이지·관측주월집계·달력순수export/정책판본,Frontend는명칭/고정4탭/각10행/관측·향후4기간/사후비교UI 구현. 예측원장없으므로미지원/빈상태,합성제품혼입금지.
- 구현후독립정적리뷰→Ubuntu격리 Jest/tsc/build·실컴포넌트CUA. 실거래/운영설정·DBDDL·모델/수집실행·배포는아직하지않는다.

## 2026-11-08 — T-156 v6 사용자 승인·기계기록 보완 후 구현

- 실제사용자 `v6 승인` 확인. 동일승인재질문금지. 질문닫는따옴표검사수정은222검사·독립검토후공유반영됐고,이어옛v3~v5수정요청을pending으로세는native버전이력검사보완중이다. 원본msg/question·상세F22/exec-060.
- 정식check/activate미통과이므로제품편집0·activefalse. 현재backend/frontend계약·가이드준비완료, 도구정상통과뒤조회UI구현. 실제예측/agent거래/DBDDL/운영스위치/실거래·배포는안켠다. 아래v6사용자검토대기는응답으로해소됐고기계증거기록과구분한다.

## 2026-11-08 — T-156 향후3개월·1년 기간확장 v6 데모 검토 대기

- v6 cce67b2f 완성·review_requested. 독립 날짜/비용/분포 delta검산·lint·CUA360/412/1280/4기간/N0/장기대기/10개페이지 확인. 합성 예시이며 사용자검토대기. F21/exec-059 참조.
- 사용자요청으로 예상기간을1주/1개월/3개월/1년으로 확장한다. 기간별합성예시·편도0.25%·관측/예측/사후비교·고정4탭/10개페이지유지. v5검토대기는수정요청으로대체, v5파일불변보존.
- 데모검토전앱/DB/예측엔진/운영설정·실거래변경없음. 달력3/12개월·월말/윤년과장기사후비교대기검증. task F21/exec-058부터확인.

## 2026-11-08 — T-156 관측성과·미래 예상성과 v5 데모 검토 대기

- v5 2b86a975 완성·review_requested. 독립 비용/분포/기간/사후비교 검산·lint 및 CUA360/412/1280/0경로/상태/10개페이지 확인. 전부 합성 예시이며 사용자 v5 검토 대기. F20/exec-057 참조.
- 최신 요청은 모의성과 내부 관측성과/향후1주·1개월 예측/사후비교다. 손익범위·손실확률·원본예측대비관측오차를 합성자료로 표시, 편도0.25%고정. 기존뷰/기간/고정4탭/10개페이지 보존.
- v4 ad504e9b는 수정요청으로 보존, v5 데모만 작성한다. 실제 앱/API·DB·운영정책/스위치·모델/백테스트/주문 변경은 없다. 사용자 검토 전 구현 금지. task F20/exec-056 참고.

## 2026-11-08 — T-156 모의분석 기간 표시 v4 데모 검토 대기

- 사용자요청: 모의기간·시그널발생기간·성과관측기간을 날짜/주·월과관측길이로표시. v3날짜없는합성시리즈와기간해석불가를설명했고 v4로보완한다. 기존고정4탭/목록10개/운영정책현재·목표구분유지.
- v3는미승인/수정요청기록후보존. v4검토전앱/실행/DB쓰기·실거래변경없음. 전체계좌기간수익과신규시그널귀속성과를섞지않고,관측중/자료누락·기준금액·거래일수 구분. 상세taskF19.
- v4 HTML ad504e9b·독립 기간/합성수치 검산·lint·CUA360/412/1280 완료, review_requested/v4. 전체/주간/월간과 실제 관측 첫날~마지막날·기준금액을 표시하고 10개 페이지와 무관하게 집계한다. 운영 SELECT는 리허설만·전진 성과기간 없음. 사용자 v4 검토 후 구현하며 정책선택 엔진 연결은 별도 범위 판단을 유지한다.


## 2026-11-08 — T-156 모의분석 v3 데모 검토 착수

- 사용자후속: 명칭 모의분석·정책/에이전트 적용상태표시·한줄고정4탭·목록별10개페이지. 데모 검토 후 구현을 요청했으므로 현재앱소스/DB/실행스위치 변경없음.
- v3데모91cc9d49·독립정적검토/lint/CUA360/412/1280 완료, 사용자검토대기. - 현재코드의 M40기본결정+agent참고기록과 목표인 규칙선택/매매반영을 구분한다. 저장결과 조회는 모의전용이지만 실행기는DRY_RUN조건을 요구한다. v2불변보존, v3초안진행. 상세taskF18.


## 2026-11-08 16:34 — T-156 M40 조회 화면 운영 반영 완료

- 앱: 분석 → 오늘 분석 → 종목별 → M40 모의분석 (`/analytics?tab=m40`). 기존상단3분류/하단5메뉴 유지, 수집/종목판단·제외/모의신호/성과를 소유자만 조회한다.
- 승인도구지원193검사·실제원문연결/check통과 후 구현. T162와합친 e9dccee는487검사/tsc/build 및 합성CUA360/412/1280통과. 운영163137-e9dccee5 동일SHA START/RESULTok/END0·핵심14파일SHA·healthgreen/web와cron각1/DRYtrue/API익명401 확인. 실거래OFF, 이배포DDL없음.
- 운영reader확인125참조/123적격/126판단대상/제약5/리허설신호4,전진미시작·성과null,비viewer비공개읽기차단. 실제로그인운영UI/안드로이드실기기는 별도확인. 도구/UI/최종QA·배포묶음은 테스트DB에 원본SHA로 보존.
- F15앱조회는완료. T156은 미래전진84일/100왕복/agent변경20일·전체원천공백때문에doing. 배포후문서만 현재트리에추가했으며 문서만재배포하지않음. 사용자에게동일승인/계정재질문금지.


## 2026-11-08 15:57 — T-156 승인 도구 지원 보완·실제 v2 승인 연결 완료

- 사용자가 예외 대신 도구 지원 보완을 선택해 공유 도구14파일을 격리 수정·독립 감사/QA·원본 해시 대조/백업 후 반영했다. 독립/적용 후 각193개 검사 통과. 훅 정의/신뢰/강제모드·운영DB·거래설정 변경 없음.
- 실제 원래v2 사용자 답변·질문ID·메시지/완료이벤트·등록worktree·데모SHA를 대조한 명시적 native 복구 성공, 공식check/activate통과. 훅재생/수동승인/재질문 없음. 원본 대화·이메일을 제외한 증거 archive SHA d0b66dc1d6f8cc5f2b8300b5edc0ad3c0f8518a1849a79e9ac04f88ee25cfa7c.
- 승인된 화면 구현 재개. 상세 `docs/implementation/2026-11-08-t156-approval-tool-support.md`, task F16. 아래15:14의 처리 선택 대기는 해소됐다. 실거래OFF 유지.


## 2026-11-08 15:14 — T-156 M40 조회 화면 준비·자동 승인 기록 처리 대기

- 사용자 v2 데모 승인(‘v2 구성으로 구현 진행’)과 조회 이메일 확인은 완료. 전용 viewer 한 계정만 연결·원장/설정 불변, 실제 SELECT reader125참조/123적격/리허설4신호·비viewer거부 검산.
- 기존 메뉴를 유지한 v2 데모를360/412/1280 CUA로확인. 신규readonly API6파일·시험준비, 최종15 tests/tsc통과(이전533/2skip·합성DB2와범위분리).
- 자동 approve-codex-context는원문영수증미연결로거부. demo_gate는review_requested/v2그대로,수동승인/훅재생없음. Reviewer가check未통과화면수정을보류하여,사용자가‘승인도구지원부터보완’을선택.공유도구보완193검사통과·실제v2원문복구/check통과하여화면구현재개. 같은v2승인/이메일은다시묻지않음.
- 화면 소스·배포는 아직 미착수이며 기존실거래OFF. 상세 [[T-156-us-stock-entry-exit-forecast-design]] F15 및 docs/design/2026-11-08-t156-m40-paper-view-review.md.


## 2026-11-08 13:50 — T-156 DRY_RUN 독립 모의 시그널 연결

- 사용자 3개 선택: **첫 적격 거래일 T0 1회 고정 / 현재 실계좌 복사 모의 장부 / 한정 후보군 시험판**. 미국 보유4개와 USD 순예수금을 전용 장부에 복사했고 실제 보유·주문·귀속·DRY_RUN 등 기존 설정은 불변이다.
- 공개 원주/분할조정250판본114,900행, 127세션 적격123종목. HONA/SPCX 초기 제외는11/06 원본 SHA에 한정. S&P50011/05까지로11/06 리허설만 적격이며 다음 전진에는 최신 자료가 필요하다.
- 운영DB 리허설1회·모의매도시그널4개, 체결0·전진0·T0아직없음. `m40-paper-v1`/`m40p_`는 주문 관문 양방향 영구차단. 정상 승인 signals와 독립된 `t156_paper_account/cycle/signal` 사용.
- 독립감사 조건부 통과·최종지정1,594 tests PASS/15 SKIP·tsc/build0, 실제 격리SQL/runtime12검사통과. 초기c296116배포·인증202후already_observed·23파일SHA일치확인. 초기부분자료재시도보완은최종영수증구분. 미래84일/신규왕복100건/에이전트거래변경20일은 미달이며 실거래는 해제하지 않는다.
- 상세·수집/시각 계약·흐름도·복구: `docs/implementation/2026-11-08-t156-forward-paper-pilot.md`, [[T-156-us-stock-entry-exit-forecast-design]] F14.

## 2026-11-08 10:20 — 🔴 기록 커밋 `ebbcdca` 배포 헬스 실패·자동 롤백 (12:15 해소)

- `RELEASE_RESULT {"status":"health_failed","release":"20261108-101556-ebbcdca7","rolled_back_to":".../20261108-093050-8248226b"}`, `END exit=1`. 운영은 직전 릴리스로 되돌아가 정상이었고(health 200·`safetyStatus green`·web·cron 각 1행), 커밋 `ebbcdca` 만 원격에 있고 배포되지 않은 상태가 됐다.
- 내용은 `agent-vault` 문서 2개뿐이라 **앱 동작·빌드와 무관**하다. 실패 원인은 변경 내용이 아니다.
- [가능성 높음] 원인은 **헬스 창(120초) 동안의 NAS·DB 지연**이다 — 게이트는 `--health /api/health --health-timeout 120`(`~/.local/webhook-deploy/deploy-stockinvest.sh`)이고 `/api/health` 는 DB 를 확인한다. 10:15~10:19 앱 로그에 `[strategy/records/job-run-log] 503 reason=timeout (deadline=2500ms)` 가 매분 찍혔고, 같은 시각 내가 공유 트리 `reset --hard`(107파일)·NAS 백업 23MB 쓰기·NFS 커밋을 돌려 NAS 를 함께 쓰는 MariaDB 가 느려졌다. **교훈: 배포와 NAS 대량 작업을 같은 시간대에 돌리지 않는다.**
- ⚠ 그 `job-run-log` 503 은 **롤백 뒤 정상 릴리스에서도 찍혔다**(10:22:42). 2500ms 데드라인의 기록 전용 경로라 잡 동작·주문과는 무관하지만, 상시 조건인지는 별건으로 봐야 한다.
- **정정(12:20)**: 위 503 은 내 작업 시간대 현상이 아니라 **상시 간헐**이다 — 실제 로그 `/home/brownjeon/apps/stockinvest/shared/logs/cron-out.log` 에서 11-08 04:15 이후 **20회**(08:48·09:11·…·11:14·12:13), 「전송 회복」 18건. 매번 스풀에 남아 다음 가벼운 틱에 재전송되고 잡 동작·주문과 무관하다. 따라서 헬스 실패의 근거로 이 503 을 든 부분은 약하다(NAS·DB 지연 가설 자체는 유지 — 헬스 창은 120초로 훨씬 크다). 처음에 `~/.pm2/logs/stockinvest-out.log` 를 본 「0건」은 **파일이 없어 무효한 측정**이었다. 사용자 결정(2026-11-08 「그냥 두기」)으로 **별도 이슈 등록은 하지 않는다.**
- **해소(12:10~12:15)**: 사용자 「지금 재시도」 시점에 원격은 이미 T-156 커밋 5개로 `dd8c5c3` 까지 나아가 있었고 그 배포가 11:43·11:47 두 번 `RELEASE_RESULT ok` 였다(현재 운영 `20261108-114747-dd8c5c3a`). `ebbcdca` 는 `dd8c5c3` 의 조상이므로 **그 기록은 이미 운영에 반영됐다** — 같은 커밋을 다시 밀 필요가 없어, 이 실패 기록 자체를 커밋해 남긴다.
- 공유 트리에서 `git fetch` 가 `fatal: bad object … @eaDir/…@SynoEAStream` 로 막혀 `scripts/git-refs-clean.sh` 로 사이드카 5개를 격리한 뒤 통과했다(ISS-0013 재발 — 11-01 정리 뒤 또). 격리본 `~/.local/share/git-eadir-quarantine/20261108-121030/StockInvest`.
- ⚠ 공유 NFS 트리는 다시 **5커밋 뒤처졌다**(`ebbcdca` vs `dd8c5c3`). 그 5커밋이 추가한 파일 다수가 이 트리에는 **미추적 사본**으로 있어 다음 `reset`·`checkout` 은 덮어쓰기로 막힌다 — 사본의 주인은 T-156 세션이라 함께 정리해야 한다. 보존해 둔 미커밋 `src/lib/profit-engine/daily-bars-store.ts`(+7/−2)도 원격이 같은 파일을 바꿔 이제 중복·낡음일 수 있다(손대지 않았다).

## 2026-11-08 10:00 — 공유 NFS 트리를 원격 `main` 과 맞춤

- 사용자 지시로 공유 트리(`/Volumes/homes/brownjeon/project/StockInvest` = 서버 `/home/brownjeon/NFS/homes/brownjeon/project/StockInvest`)를 **`8248226`(origin/main)** 로 맞췄다. 12커밋 뒤처져 있었고, 코드 **6,532줄**이 이 트리에만 없었다(예: `src/lib/strategy/adaptive-buy-sizing.ts` 146줄·`src/lib/chat/ownership.ts` 37줄). 이제 0커밋 차이.
- **Mac(SMB)에서는 reset 이 실패한다**: `public/mockups` 심볼릭 링크를 만들 수 없어(`Permission denied`) 107파일을 갱신한 뒤 `fatal: 인덱스 파일을 리셋할 수 없습니다` 로 멈췄다. 같은 저장소를 **서버에서** reset 해 완료했다(서버는 NFS 에 심볼릭 링크를 만들 수 있다). 앞으로 이 트리의 reset·checkout 은 서버에서 한다.
- 백업(되돌리기 자료): `/Volumes/homes/brownjeon/backup/stockinvest-shared-tree/2026-11-08-0940/` — `dirty-and-untracked.tar.gz`(177파일) · `agents-skills.tar.gz`(이름이 한글이라 첫 tar 가 빠뜨린 3경로) · `paths-utf8.txt`(대상 112경로).
- **보존한 것**: 원격에 없는 로컬 편집 8파일은 reset 뒤 되돌려 **미커밋 그대로** 뒀다 — `CLAUDE.md`(+30)·`AGENTS.md`(+43/−1)·`.claude/agents/leader.md`(+14/−2)·`.codex/agents/leader.toml`(+32/−3)·`.codex/hooks.json`(+67/−56)·`.agents/skills/신규도입/SKILL.md`(+1/−1)·`docs/design/2026-10-24-integrated-execution-procedure.md`(+2)·`src/lib/profit-engine/daily-bars-store.ts`(+7/−2, T-156 진행 중). 원격이 `f47cf28` 이후 이 8파일을 건드린 적이 없어 병합 충돌은 없었다.
- 원격에 없는 **미추적 파일 91개**(T-156 `docs/research-data/`·`src/lib/strategy/m40/`·`packages/chat-ui/`·`scripts/t156/`·`.codex-attachments/` 등)는 `reset --hard` 가 건드리지 않아 그대로다. `git clean` 은 쓰지 않았다.
- ⚠ **Mac 에서는 `git status` 가 `public/mockups` 를 늘 `D`(삭제)로 보여 준다** — SMB 가 심볼릭 링크를 그대로 못 보여 주기 때문이다. 서버에서는 `-> ../mockups` 로 정상이다. **Mac 에서 이 경로를 커밋하면 운영 저장소의 심볼릭 링크가 지워진다 — 커밋하지 않는다.**

## 2026-11-08 09:20 — 비서 챗봇 실기기 확인 + 기록 일괄 커밋

- 사용자가 **실기기에서 비서 메뉴의 챗봇 화면을 확인**했다(이상 보고 없음). [[T-161-draft-review-thread-ownership]]·[[T-157-assistant-tab-and-chat-errors]] 의 화면 확인 대기를 해소했다 — 항목별 결과 보고는 아니다. [[T-113-chat-ownership-authorization]] 의 「대화 13건」 건수 확인만 남는다.
- 사용자 지시로 **공유 트리의 미커밋 기록을 일괄 커밋**했다(agent-vault 기록 전용 — 코드·설정·목업은 손대지 않았다).
- ⚠ 그 과정에서 **공유 트리의 11-06 기록 3곳이 낡은 사본으로 덮여 T-154 기록이 지워져 있던 것**을 발견해 되살려 합쳤다: `20-Log/2026-11-06.md` 12줄(T-154 전 과정) · 이 파일의 「11-06 13:45 T-154 운영 적용」 절 · `board.md` 의 T-154 완료 줄. 의도한 정리였다면 알려 주면 다시 정리한다.

## 2026-11-07 19:06 — 비서 채팅: 초안 검토 카드가 자기 대화로 전송(ⓑ)

- [[T-161-draft-review-thread-ownership]] 운영 배포 완료(`20261107-190639-bc845fa1`, 커밋 `bc845fa`, 19:06:39 push → webhook `RELEASE_RESULT ok`, `migrated:false`). 초안 검토 카드가 **자기 대화를 기억**해, 카드가 열린 채 대화를 바꿔도 「확정 전송」이 **초안을 만든 대화**로 간다. 종전 5경로(남의 대화 저장·「+ 새 대화」·404·삭제·정제 중 전환)에서 어긋나거나 버튼이 무반응이던 것이 사라진다. 전송 200 뒤 화면 갱신만 실패하면 「전송 완료 — 화면 갱신만 실패했습니다」로 전송 여부를 먼저 말한다. 웹 전용(앱 재설치 불필요).
- 데모 게이트 **delta**: v1 `mockups/T-161-draft-review-ownership-v1.html` **사용자 승인**(「권고안으로 승인」, 18:08) — 결정 1-A(검토 카드 머리글에 조건부 한 줄) · 2-B(안내 띠 호박색 + `role="status"`) · 문구 3종.
- Reviewer 2라운드 PASS(scope 2파일, medium 0·low 1·info 2)·QA PASS(범위 한정). jest **98/98**(기준선 80)·tsc 0, 변이 13종으로 새 가드 각각 포착. 배포 후 health 200·`safetyStatus green`·cron 1행·안전장치 값 불변(`dryRun:true`·`killSwitch:false`).
- 👉 **사용자 확인 대기**: 검토 카드 머리글 한 줄 · 다른 대화 확정 시 호박색 안내 · 「+ 새 대화」 확정이 무반응 아닌지 · 같은 대화면 평소 화면 불변 · 412/360px 띠 두 줄(53px). **브라우저·실기기·TalkBack 확인은 0건**이다.
- **후속 1 완료(23:52)**: 회귀망 **N-2**(승인 문구의 글자)를 사용자 지시로 메웠다 — 커밋 `24027b7` → 릴리스 `20261107-235004-24027b7f`. 시험 6건이 문구 3종·안내 접두·머리글 한 줄을 **리터럴로** 고정한다(시험 전용 +104/−0, 구현 변경 0건, jest 66/66·104/104·tsc 0, 변이 9종 포착). Reviewer 라운드 3 PASS.
- 현재 운영 릴리스: **`20261108-090655-6c671602`**(2026-11-08 09:06 — T-161 기록 커밋, 코드 0건). 직전 `20261107-235004-24027b7f`(N-2 시험).
- **회귀망 보강 종료(2026-11-08)**: 사용자 지시 「여기서 멈추고 작업 마무리해줘」로 **N-1**(검토 대화가 로드 404·DELETE 404 로 사라지는 두 경로)은 **보류**한다 — 현재 동작은 맞고 그 동작을 지키는 시험만 없는 상태로 남긴다.
- **결정 완료(2026-11-08 14:45)**: QA-L1(「새 대화」에서 보낸 뒤 안내가 바뀐 제목 대신 「새 대화」라고 말한다)은 사용자 결정 「후속으로 남기기」로 **고치지 않고 후속 후보로 남긴다**(코드 변경 0건). 쉬운 고침인 확정 뒤 `loadThreads()` 재조회가 **T-157 의 늦은 응답 경합을 다시 열기** 때문이다 — 권고 착수 형태는 확정 응답에 현재 제목을 실어 보내고 재조회는 하지 않는 쪽. **T-161 결정 대기 0건.** 후속 후보: QA-L1 · Reviewer I-1 확정 버튼 라벨 미고정 · I-2 제목 폴백 `'대화'` 문구 · I-3 `tid == null` 방어 분기 문구 · 보류된 회귀망 N-1. 새 task ID 는 떼지 않았다.

## 2026-11-07 — 하단 「비서」 탭 공개 + 채팅 오류 처리

- [[T-157-assistant-tab-and-chat-errors]] 운영 배포 완료(`20261107-115837-013d88f6`, 커밋 `013d88f`, 11:58:32 push → webhook `RELEASE_RESULT ok`). 하단 탭이 5칸이 되고 4번째 「비서」가 `/ai`(T-113 채팅)로 간다. 채팅 화면은 401·조회 404·삭제 실패를 조용히 삼키지 않고, 늦게 온 응답이 화면을 덮어쓰지 않는다. 웹 전용이라 앱은 다시 열면 반영된다(재설치 불필요).
- Reviewer 9라운드 PASS(scope 5파일)·QA PASS·Codex C2 지적 2건 판정. 커밋되는 트리에서 jest 80/80·tsc 0. 배포 후 cron 러너 1개·안전장치 값 불변(`dryRun: true`·`killSwitch: false`) 확인.
- 👉 **사용자 확인 대기**: 하단 5칸·비서 탭·대화 목록(웹·앱), 360/412px 라벨 잘림. 결정 대기: 초안 검토 상태의 대화 소속 정리 방향(권고 — 확인을 원래 대화로 보낸다).

## 2026-11-07 — 매수 한도 0% 동작 변경 요청

- [[T-159-explicit-unlimited-buy-limits]] 운영 배포 완료(20261107-092140-fb3b9bbb). 기존 0과 명시 저장한 무제한을 구분하며, 1회 무제한이면 판단 에이전트가 시장별 가용 잔금을 후보별로 배분한다. 독립 감사·QA 통과. 실제 격리 화면에서 두 한도 0 저장·새로고침과 실패 시 안전 설정 보존을 확인했다.

## 2026-11-07 — 자동 제출 금액 상한 제거

- [[T-158-remove-auto-submit-cap]]에서 운영 `.env`의 자동 제출 5만 원 상한을 제거하고 기존 릴리스의 웹 프로세스에 반영했다. 확인 시 자동승인모드 `auto`, 킬스위치 ON, DRY_RUN ON이다. 별도 매수 주문 한도 미구성 경고는 변경 전후 동일하다.

## 2026-11-06 — 미국 종목분석 개선안 조사

- [[T-156-us-stock-entry-exit-forecast-design]] — 11/8 Codex 직접 승인으로 M40 shadow·4단계 판단·증분 보관 구현. 연구27표 4,383,186행 운영 게시, 테스트 원본28개 DB readback SHA 일치. 최종1,426 tests PASS/15 SKIP·타입·build PASS. 운영 배포9237fff·health/API 확인 완료. F09·적격 입력·실매매 연결은 미완료. 상세 F13.
- 추가 조사에서 S&P 500·Nasdaq Composite 1990-01-05~2026-10-30 주간 파생 데이터 1,922행을 연구 입력으로 추가했다. 2017년 이후 4주 방향 예측에서 두 지수 조합은 단순 상승률 기준을 앞서지 못했고, 동반 하락의 추가 5% 하락 빈도는 전체의 13.2% 대비 25.0%였다. 개별 종목 성과는 미검증이다.

## 2026-11-06 13:45 — T-154 자동승인모드 운영 적용

- [[T-154-auto-approval-mode-setting]] 웹 릴리스 `20261106-134049-17187541` 배포 성공. 로그인한 운영 설정의 안전장치에서 자동 청산 엔진 바로 아래에 OFF·승인형으로 표시됐다. 웹·스케줄러 각 1개 online, 실거래여부 OFF·모든거래차단 ON.
- 13:55 KST 사용자 실기기 ON 전환 뒤 운영 헬스와 전환 로그에서 국내·해외 공통 자동형을 확인했다. 실거래여부 OFF·모든거래차단 ON.
- 14:24 KST 확인창 문구 수정 릴리스 `20261106-142246-056aaa79` 배포 성공. 공개 운영 설정 파일과 동일 소스의 격리 확인창에서 새 안내만 표시됨을 확인했다. 운영 자동승인모드는 ON.
- 15:32 KST ON 스위치 바로 아래 안내 위치 정정 릴리스 `20261106-153029-35065a9e` 배포 성공. 사용자가 Android 앱 재시작 후 새 안내 문구를 확인했다.

## 2026-11-06 00:03 — 🔴 **킬스위치 자동 발동(24h -17.7%)** + T-153 문서 배포(릴리스 `20261106-000207-18c1dc73`)

- 🔴 **`safety_kill_switch` = `true`(자동 발동, `updated_at` 2026-11-06 00:03:30).** 로그: `[kill-switch:drawdown] 자동 발동: 24h 손실 -17.7% (-3,689,878원) — 임계 -10% 초과`. **해제는 사용자 전용.** 이 키의 종전 값은 `false`(11-01 09:53:56 사용자 설정)였다.
- **산수는 기록과 맞는다**: 기준선 `portfolio_snapshots` 2026-11-05 00:21:59 `total_krw` **20,795,028**(24h 전 ±60분 창) → 현재 2026-11-06 00:03:29 **17,105,150** = **-3,689,878원 / -17.74%**. 로그 수치와 정확히 일치한다.
- 🔴 **값이 떨어진 실체는 보유 1종목 소멸이다**: 스냅샷 포지션 수가 **8 → 7**, `NAS:AAPL` 3주(기준선 평가 1,369,868원)가 **22:53:08 스냅샷까지 있고 00:02:39 부터 없다**. 22:53 19,246,507 → 00:02 17,079,308 = **-2,167,199원** 이고 그중 AAPL 이 약 1.37M 이다. 나머지는 미국 개장(23:30 KST) 뒤 가격 변동과 삼성전자 221,500 → 201,500(13주, -260,000원) 등이다.
- ✅ **원인 확정 — 사용자가 직접 매도했다**(2026-11-06 사용자 확인). 조회 누락(②)이 아니다. 그 창에 조회 실패 경고 0건·`holding-checker` 전부 `OK` 였던 것과 일치한다.
- 🔴 **그래서 드러난 것: 매도 대금이 총액에서 빠져 손실률이 과대 보고됐다.** 현재 USD 행에 `ustl_sll_amt_smtl: 1,408,391`(미결제 매도 대금, T+2)이 **기록돼 있지만** `total_krw` 에는 들어가지 않는다 — 이는 **T-056 의 의도된 설계**다(`src/lib/exchanges/types.ts:94` 「총액에 넣지 않는다」, `kis-overseas.ts:247`, 시험 `src/lib/safety/__tests__/portfolio-snapshot-usd-cash.test.ts` 가 「행에 기록만(총액 미반영)」을 단언). `src/lib/ledger/monthly-return.ts` 의 M-3 은 그 신호를 보지만 **킬스위치 drawdown 경로에는 보정이 없다.**
- **보정 계산(검산 일치)**: 기준선 20,795,028 → 현재 17,105,150 = 보고 **-3,689,878 / -17.74%**. 미결제 매도 1,408,391 을 더하면 18,513,541 → **-2,281,487 / -10.97%**. 종목별 기여: `NAS:MU` **-1,706,408(-14.0%)** · `005930` -260,000(-9.0%) · `NAS:SMH` -237,960(-8.6%) · `NYS:ORCL` -70,878(-6.9%) · `NYS:CVX` +1,198 · `NAS:AAPL` 매도분 -7,438(대금으로 대체돼 사실상 보합). 합계 -2,281,487 로 정확히 맞는다.
- ⚠ **그러므로 오발동이 아니다** — 보정값 **-10.97% 도 임계 -10% 를 넘는다.** 킬스위치는 **실제 drawdown(주로 MU -14%)에 정상 발동**했다. 다만 **보고 수치가 6.8%p 과대**했고, 해외 매도 뒤 T+2 동안은 늘 이 방향으로 치우친다(T-080 Phase 2 계열, 별 작업 후보).
- ✅ **실주문은 나가지 않았다**: 최근 24h `orders` 3건 전부 `status: dry_run` · `exchange_order_id` NULL(`NAS:SMH` sell 23:45, `NAS:MU` sell 23:40, `005930` sell 15:24). `safety_dry_run` 은 `true` 그대로다. **AAPL 주문은 이 표에 없다** — 이 시스템이 팔지 않았다.
- **내 배포가 손실을 만든 것은 아니다. 다만 검사가 돌게 된 계기일 수 있다**: 종전 킬스위치 평가 3건(11-01 09:08·19:23, 11-02 22:34)은 전부 `24h 전 ±60분 창에 스냅샷이 없음 — 검사 생략`이었다. 이번 재기동이 00:02:39·00:03:29 에 비정기 스냅샷 2개를 만들었고(평시 시간당 1회), 그 현재값으로 평가가 실제로 수행돼 임계를 넘었다. 22:53 값(-7.4%)으로는 임계 미달이라 발동하지 않았을 것이다.
- 배포는 T-153 문서·vault 전용(코드 0건) — 커밋 `18c1dc7`(+동승 `254dce4`), `RELEASE_RESULT ok`·`migrated:false`, 롤백 지점 `20261105-225235-50ac5ad1`. 미국 장중 배포였고 사용자 결정(「지금 push」)이다. 상세는 [[T-153-contextual-demo-gate-revalidation]] 최종 요약.
- ✅ **사용자 결정(2026-11-06): 킬스위치 「유지」.** 권고와 같다 — 보정 후에도 -10.97% 로 임계를 넘고, 실제 원인은 `NAS:MU` -14% 다. **해제는 사용자 전용**이므로 AI 가 다시 켜거나 끄지 않는다. `DRY_RUN=true` 라 해제해도 실주문은 나가지 않았겠지만, 유지하는 동안은 **주문 송신 경로가 차단**된 상태다(청산 엔진 포함).
- ✅ **②(발동 문구가 손실 출처를 설명하지 않는 문제)는 [[T-155-killswitch-drawdown-attribution]] 으로 해소**했다 — 2026-11-06 09:57 운영 배포(릴리스 `20261106-095719-1927e705`). 판정 로직은 바꾸지 않았고 문구만 소실 종목·미설명 금액·보정 손실률·미결제 대금의 치우침 방향·확인 방법을 적는다. Reviewer 5라운드 PASS·QA PASS.
- ✅ **커밋 게이트 문제는 `ISS-0017` 로 등록**(2026-11-06 사용자 지시, security·StockInvest·owner `user`·점검일 2026-11-13). 커밋 메시지에 적은 다른 task 의 넓은 scope 판정이 Reviewer 안전 게이트를 대신 만족시킨다 — AI 관행은 교정했고(커밋 메시지에 다른 task ID 를 쓰지 않는다) 훅 구조 변경은 사용자 결정으로 남았다. 남은 관측 항목은 T-155 `waiting:` 에 있다.

## 2026-11-04 17:30 — T-147 **실전 검증 완료** + T-148·T-149 운영 배포(릴리스 `20261104-172711-5696d8cb`)

- **T-147 검증(내가 직접 측정)**: 11-04 국내 장중은 **T-147 만 배포된 구간**이고 긴 틱이 그대로 있었다(`strategy-eval` mean 134초·max 299초·100초 초과 42/58회, 틱 주기 mean 87.7초·max 360초·300초 초과 3틱). 그 조건에서 **손절 알림 간격 419건이 mean 60.0초·max 65초·정상 100.0%, 늦은 건 0건**이다(11-03 은 mean 77.5초·max 411초·3분 이상 7.4%). **워치독 복구 0건** — 300초 초과 틱 3개에도 재시작이 없었다(하트비트 추가 쓰기가 창을 막았다).
- **미검증**: `risk_stop_alert_state` 가 `sentToday 0` 이라 **텔레그램 중복 발송은 여전히 경험적으로 미확인**이다. 티커의 419회 정확한 호출은 확인됐고, 발송 경로는 손절가에 닿는 날에만 확인된다.
- **T-148**(전략 평가 수집 루프 동시성 4 — 국내 median 136초 → 약 55초 기대) · **T-149**(러너 틀린 제약 주석 정리 + 티커 pid 재사용 ppid 가드)가 **같은 릴리스**로 17:27:11 배포됐다(국내 마감 후·미국 개장 전 창). health green·`dryRun true`·`killSwitch false`·두 앱 online·재시작 0. **두 작업의 효과는 다음 영업일 장중에만 확인된다.**
- 🔴 **이 작업에서 내가 틀린 서술이 7건이고 전부 정정했다** — 공통 패턴은 「로그·DB 로 직접 측정한 것은 전부 맞았고, 코드 주석·상수·산수에서 끌어온 추론을 측정값처럼 서술한 것은 전부 틀렸다」이며 3건은 다른 세션 인계로 번졌다(T-149 감사 M-1 의 출처가 나다). `/이슈기록` 정식 등록 후보 — 사용자 확인 대기. 상세 [[T-147-cron-tick-starvation]].

## 2026-11-03 20:40 — T-147 장중 cron 틱 묶임(손절 알림 공백) **운영 배포 완료**

- [[T-147-cron-tick-starvation]]: 장중 `strategy-eval`(국내 150종목 **직렬** 평가, 실측 53~297초)이 끝날 때까지 러너의 분당 잡이 전부 멈추던 문제. **알림만 하는 `stop-alert` 하나를 자식 프로세스(티커)로 떼어냈다** — 플래그 `ALERT_TICKER_ACTIVE` 가 호출자를 항상 정확히 하나로 고르고, 티커를 못 띄우거나 자식이 죽으면 메인 루프가 인수한다(fail-open). 하트비트를 틱 끝에 한 번 더 쓴다.
- **피해 규모(실측)**: 국내 장중 `stop-alert` 간격 824건 중 **10.7% 가 늦고 7.4% 는 3분 이상**(최장 411초). 야간·주말 포함 전체로는 94.6% 정상이라 **평균만 보면 안 보인다**. 보유 6종목에 손절가가 걸려 있다.
- 릴리스 **`20261103-202418-17a4257f`** `status: ok` · `migrated: false` · 커밋 `17a4257`(+조상 `1db9103` T-146 문서) · 20:24:18~20:25 · 롤백 지점 `20261103-093323-1dfd57d6`.
- **배포 후 실측**: 티커 기동 1줄(pid 491802)·🔴🔶 0줄 · `stop-alert` 매 분 `:00` 정확히 1회(20:25~20:34 전수)·메인 루프 0회 · 자식 1개 · 하트비트 52~53초 · health green(`dryRun true`·`killSwitch false`).
- 🔴 **배포 중 20:24 분 2회는 중복 발송이 아니다**: 둘 다 pm2 reload 가 되살린 **옛 코드** 러너의 메인 루프 호출(그 러너엔 티커 0줄)이고, 실제 발송은 `risk_stop_alert_state.sentToday: 0`·마지막 갱신 04:27 로 **오늘 0건**이다.
- **남은 위험**: 틱 **길이**가 300초를 넘는 틱(3,358틱 중 3~4, 최장 352초)에서는 워치독 오재시작이 여전히 가능하다. 닫는 길은 임계 상향(HOME-SERVER `max_age_seconds` + 앱 `CRON_HEARTBEAT_STALE_SEC` — **사용자 결정**) 또는 근본 원인 단축.
- **이번 수정이 못 고치는 것**: `entry-watcher`(주문 집행)는 여전히 평균 95초·최장 412초 간격이다.
- 🔴 **내가 이 task 에서 반복한 전제가 틀렸다**(2026-11-03 21:0x, [[T-149-entry-watcher-unbounded-call]] 반증·내가 재확인): 「러너의 무제한 동기 호출이 cron 끼리의 **유일한** 주문 직렬화 장치」는 사실이 아니다 — **T-081 WP-B**(`src/lib/safety/order-limits.ts:220-253`)가 `pending` 행 선예약 + 다른 주문 pending 합산으로 동시 매수 경합을 **DB 에서 이미 막는다**. `order-sync.ts:1226-1227` 이 `FOR UPDATE`·`GET_LOCK()` 을 기각한 것은 사실이지만 거기서 "아무것도 직렬화하지 않는다"를 추론한 것이 오류다. **T-147 의 안전성에는 영향 없음**(알림 전용 잡만 옮겼고 주문 동시성을 추가하지 않았다). 영향받는 것은 `strategy-eval` **상한 기각 근거**이고 [[T-148-strategy-eval-serial-fanout]] 에서 다시 판단해야 한다. 이 틀린 문장이 **배포된 `cron-runner.sh` 주석과 커밋 `17a4257` 메시지**에 들어 있다 — 주석은 러너를 이미 여는 T-148 에 묶어 고친다.
- 🔴 **「국내 약 150종목」도 틀렸다**(T-148 반증·내가 운영 로그로 재확인): 실제 **42~51종목(대개 43)** 이고, 150 은 `universe.ts` 의 `UNIVERSE_TOP_N` 주석에서 측정 없이 추론한 값이다. 피해 수치(53~297초·틱 412초·알림 간격 824건)는 직접 측정이라 영향 없다. 바뀌는 것은 원인 설명 — 회차당 median **279 호출** / 레이트 5 req/s = **바닥 약 56초**라 ⚠ **여기 적었던 「병목은 레이트 한도」는 다시 틀렸다**(T-149 감사 M-1·2026-11-04 03:5x 정정) — T-148 실측은 「루프는 레이트 바운드가 아니라 **지연 바운드**」이고 유량 상한이 구속한 회차는 7회뿐이다. 56초는 **바닥**이고 관측 median 136초를 설명하지 못한다(136 ≫ 56) — 나는 바닥을 병목으로 바꿔 불렀다. 🔴 이 문장을 믿고 `kis_rate_limit_per_sec` 를 올리면 실매매 유량 제한의 잘못된 조작이다. 194초 → 55~60초면 **틱 길이가 300초 밑으로 내려와 워치독 잔여 창은 닫힌다.** 이 숫자도 배포된 러너 주석·커밋 `17a4257` 에 있다(앞 항목과 같은 주석 블록 → 러너를 여는 작업에 묶어 함께 정정).
- 🔴 **「10-08 재시작은 `entry-watcher` 14분 무응답」도 틀렸다**: **호스트 약 15분 동결**이다(순찰 crontab 이 15:40 다음 15:45·15:50 을 건너뛰고 15:55:55 에 복귀). 정정된 재시작 4건 내역 = 긴 틱 **2건**(T-147 이 막는다) + 호스트 동결 1건 + 원인 불명 1건. `entry-watcher` 는 느린 잡이 아니다(T-149 실측 5,436 호출 최악 799ms).
- **후속 2건 제안(사용자 시작 대기)**: `engine.ts:1455` 직렬 루프에 동시성 제한(근본 원인 — 주문 간격·워치독 창까지 함께 해결) · `entry-watcher` 무제한 대기(주문 잡에 시간 상한 없음, 10-08 워치독 재시작의 원인. 단순 상한은 주문 직렬화를 깨므로 설계 필요).
- 👉 **사용자 확인 대기**: 다음 영업일(11-04) 국내 장중에 `stop-alert` 가 매 분 유지되는지 + **텔레그램 손절 알림 중복 없음**. 배포 후 관찰은 장외 10분뿐이다.

## 2026-11-03 10:05 — T-146 해외 목록 125종목 주입 + 상한 제거 **운영 반영 완료**

- [[T-146-manual-list-cap-removal]]: 해외 분석 대상이 **54 → 126종목**이 됐다. 나스닥100(101) + 기존 NYSE 24 = 125종목을 `overseas_universe_revision` **개정판 1**(1,325바이트·`seed`)로 주입했다 — 코드 변경 0, DB 한 줄. 성공 판독은 캐시하지 않으므로 재시작·배포 없이 즉시 반영됐다.
- **운영 실측(추정 아님)**: 08:00:49 `post-market-overseas` `evaluated` **126** · **55초** · `ok` · `candidates` 7 · `llm_input` 1 · `created` 0 · **일봉 실패 0건** · `[universe-overseas]` 경고 0건. 08:30:12 `kis-fundamentals-snapshot` **125행**(전날 53) · `ok` → **[[T-145-wpa-enable-blockers]] ⑨ 창 안 DB 이어받기가 실전에서 처음 작동**했다(90초 틱으로는 125종목이 안 끝난다). 125행인 것은 `NYS:BRK.B` 가 종전처럼 실패해서다(예측과 일치).
- **상한 제거**: `MANUAL_LIST_MAX` 150→**500**(표 백스톱 `chk_rev_count` 와 같은 수), `AUTO_TOP_N_MAX = 150` 신규로 WP-A `topN` 천장은 **분리해 그대로 둠**. 커밋 `1dfd57d`(훅 통과) → 릴리스 **`20261103-093323-1dfd57d6`** `status: ok` · **`migrated: false`** · 09:33:13→09:34:52(89초). 롤백 지점 `20261102-225046-8f101d03`.
- **배포 후**: `current` 심링크 전환 · health `ok:true`·`safetyStatus:green`·`dryRun:true`·`killSwitch:false` · pm2 둘 다 `online`·재시작 0 · 배포된 상수 500/150 · 목록 125종목 불변 · WP-A 여전히 **꺼짐**(`system_config` 설정 행 없음 → `AUTO_REFRESH_DEFAULT.enabled=false`, `overseas_universe_auto` 0행). 컷오버 공백은 09:33:53~54 `HTTP=000` 5건, 09:33:55 러너 재시작 후 정상.
- 🔴 **지금 살아 있는 구멍**: 종전에는 상한 150 이 **우연히** 151종목 적재를 막아 주고 있었고 그 보호가 사라졌다. 151줄을 붙여넣으면 저장되고, 154종목 초과분은 `post-market-overseas.ts:545` 의 무제한 `Promise.allSettled` 팬아웃(H-1)에서 **오류·경고 없이 누락**된다. **코드 가드 없음.** 사용자가 보고받고 「지금 배포 · 151종목은 H-1 수정 뒤」를 선택했다. 현재 126종목은 한계 154 까지 여유 28.
- **NYSE 상위 50 은 들어가지 않았다** — WP-A(월 1회 자동 산출) 경로다. 켜려면 WP-A DDL 적용 + 스위치 행 추가(각각 사용자 승인) + T-145 잔여 조건이 먼저다.
- ⚠ **범위 밖 발견(기존 결함)**: `cron-runner.sh` 의 `call()` 은 `CALL_MAX_TIME` 이 설정된 잡에만 `--max-time` 을 붙이는데 `strategy-eval` 에는 없다 → 러너가 **145~348초** 묶이고 그 사이 분당 `entry-watcher`·`holding-checker`·**`stop-alert`** 가 전부 굶는다(보유 6종목 손절 알림 공백). 11-02 에 278초로 이미 있었고(내 변경 탓 아님), 11-02 ACTIVE 기록의 「cron 3분 45초 무기록」도 같은 현상이다. 하트비트는 `:446~448` 에서 **틱 시작에만** 기록되고 순찰은 crontab 5분 샘플·임계 300초다. ⚠ **여기 적었던 「재시작 0회」는 내 탐색 실패로 틀렸다** — 실제로는 `stockinvest-cron` 복구가 **4건**(09-29·10-08·10-30·**11-03 10:00:02 장중**) 있었고, 그중 2건이 긴 틱 때문이다(T-147 실측·정정). → [[T-147-cron-tick-starvation]] 로 해소(2026-11-03 배포).
- QA 는 **배포 뒤에** 돌았다(`CONDITIONAL_PASS`·신규 결함 0) — 사용자가 배포를 먼저 결정했기 때문이고 순서상 이탈이다.
## 2026-11-02 10:02 — T-143 WP-A(해외 분석 대상 월 1회 자동 산출) **운영 배포 완료 — 꺼진 상태로 나갔다**

- [[T-143-overseas-universe-source-replacement]] WP-A: 사용자 승인 「커밋·push 진행」 → 「운영에도 배포되도록 푸시해줘」 로 **운영 반영까지 끝났다**. 릴리스 **`20261102-095756-f6b32b09`**, `RELEASE_RESULT status=ok`, webhook `exit=0`(push 09:57:35 → END 09:59:25), **`migrated:false`**. 내용은 `27f40b7`(WP-A 코드 40파일·6,808 추가/26 삭제) + `2967478`(기록) + `f6b32b0`(main 병합, 충돌 0 — 교집합 파일 0). 롤백 지점 `20261102-002939-cec935ac`.
- **배포 전 검증을 병합 트리에서 다시 받았다**(병합 전 수치로 대신하지 않았다): `tsc` 0 · `jest` 384 suites / 10,892 통과 / 실패 0 · `next build` 0 · `git-refs-clean --check` 0 · 배포 직전 운영 표 4개 0행·스위치 행 0개 재확인.
- **배포 후**: 두 앱 모두 새 릴리스·online·재시작 0 · **`stockinvest-cron` 1행** · health 가 배포 전과 같다(`ok:true`·`db:true`·`safetyStatus:"green"`·`dryRun:true`·`killSwitch:false`·`engine.enabled:true`·`autopilotMode:"assist"`) · 배포 후 새 에러 0건(`pm2-err` 마지막 줄 09:36:34, `cron-err` 0바이트) · 24h `orders` 0행.
- **컷오버 공백 7건**: 09:58:27~28 `HTTP=000`(strategy-eval·signal-followup·signal-expiry·portfolio-snapshot·trade-report·job-run-log) — 배포 스크립트가 예고한 cron 재등록 중단이고 09:58:29 복귀, `job-run-log` 는 스풀 재전송. 장외라 주문·시세 판단에 걸린 것 없음. 재등록 후 cron 이 3분 45초 무기록이던 것은 **10:02:14 `strategy-eval OK`** 로 「긴 잡 진행 중」이 확정됐다.
- **커밋 훅이 실제로 돌았다** — 서버 worktree(`~/.node-local/stockinvest-t143`)에서 커밋, `✅ [commit-msg] Reviewer 감사 기록 확인: T-143`. 커밋 전 임시 index 로 모의 실행해 exit 0 을 먼저 봤다. 마지막 판정 줄 `[03:18] CONDITIONAL_PASS` 의 scope 가 🔴 9파일을 전부 덮는다. push 직전 `git-refs-clean.sh --check` exit 0.
- **🔴 배포됐지만 산출은 돌지 않는다**: `system_config` 에 `overseas_universe_refresh` 행이 **없고**(배포 후 재확인), 라우트가 「키 없음·해석 불가 = 꺼짐」으로 읽어 외부 호출 0건으로 끝낸다. WP-A 표 `overseas_universe_{run,candidate}` 는 **여전히 미생성**(DDL `T-143-wpa-universe-run.sql` 미적용 — 적용은 별도 승인). WP-B 표 4개 전부 **0행**. 새 잡 호출 기록 **0건** — 창이 아니다(다음 12-06(일) 01:10).
- **Reviewer r4 CONDITIONAL_PASS**(critical 0 · high 2) — **「꺼진 상태로 커밋·배포」에 한한 판정**이다. 켜기·DDL 적용·1회차 호출은 포함하지 않는다. 검증: tsc 0 · jest 384 suites / 10,892 통과 / 실패 0 · 산출 경로 변이 감도 5/5.
- **다음은 「켜기」 하나이고 사용자 승인 사항이다** — 아래 조건 선행. 켜려면 ① WP-A DDL 적용(`run`·`candidate` 2표) ② `system_config.overseas_universe_refresh` 행 추가, 둘 다 운영 DB 쓰기라 각각 승인이 필요하다. **배포 기록 커밋 `20cabc6` 은 `wip` 에만 있다** — 문서 전용 push 가 또 한 번의 운영 재빌드·cron 공백을 만들기 때문이고, 다음 기능 push 에 함께 실린다.
- **켜기 전 조건**(task 정본에 전문): ADR/블랙아웃을 `isdr` 라벨이 아니라 실제 위험으로 판정 · 1회차 알림 문구 · 롤백 절차(또는 판독기가 스위치를 따르게) · 만료·실패가 사람에게 닿는 경로(M-2) · DB 시험을 `T143_WPA_DB_PORT` 로 QA 가 실행(없으면 핵심 변이 4개가 살아남는다) · 1회차 전 `kis_enam` 비어 있지 않은지 SELECT · M-3~M-6 · WP-C 08시 틱 실측 · BRK.B 표기(별 task).
- **미해결 경계 틈**(별 건): `scripts/test-cron-runner-*.sh` 5개가 🔴 `cron-runner.sh` 의 회귀망인데 `SAFETY_PATHS` 밖이다 — 편입 자체가 🔴 라 새 판정이 필요하다. `us-data-db.ts` 간접 회귀망 2개·`src/lib/universe/**` 편입 여부와 같은 묶음.

## 2026-11-02 00:00 — T-144 거래 운영 기록 해외 탭 ET 문구 제거 운영 반영 완료

- [[T-144-trade-log-overseas-label]]: 해외 세그먼트의 `ET` 표시만 제거했으며 날짜 계산·주문 필터·다른 화면은 불변이다. 사용자 commit/push 승인 아래 최신 remote main `63f1044` 위에 UI 1파일+task만 커밋 `fff0293`으로 올렸다. 공유 main(`2c2308e`)·타 세션 dirty 변경은 보존했다.
- webhook SHA `fff0293`: 11-01 23:58:34 시작 → 11-02 00:00:32 종료(`exit=0`), `RELEASE_RESULT ok`·릴리스 `20261101-235837-fff0293a`·`migrated:false`. 후속 health green·DRY_RUN true·kill false·engine enabled·assist, pm2 두 앱 online·재시작 0·cron 1개 및 배포 소스 해시 일치를 확인했다.
- 독립 Reviewer 채팅 판정 수신·QA 표시/날짜 범위 통과. Reviewer 자기기록 규정 충돌은 미완료로 분리했고 안전경로 밖 문구 수정에 추가 승인 관문을 만들지 않았다. Claude C2는 조건 미충족으로 미전송·미검토. 실제 로그인 운영 화면은 미확인이다. 기동 중 health 첫 timeout은 회복했지만 배포 직후 telegram timeout·공시 상태 deadline·작업 기록 503 경고가 각 1건 있어 신규 경고 0건은 아니다.
- 이 추가 현황 문서는 타 세션 편집과 섞여 미커밋으로 보존한다. 아래 T-143의 미배포 표시는 이력이며 현재 운영 부모는 T-143 `63f1044`였음을 이번 읽기에서 확인했다. T-143 남은 WP-A/WP-C 판단은 해당 task 정본을 따른다.

## 2026-11-01 21:0x — T-143(해외 분석 대상 원천 교체) WP-B: 운영 DDL 적용 완료, **코드는 미커밋·미배포**

- **지금 상태**: WP-B 구현 완료 → Reviewer PASS(`[20:14]`) → Codex C2 지적 5건 전부 반영 → QA 「DDL 적용 게이트 통과」(`[20:59]`) → **운영 DDL 적용**(사용자 승인 「적용 진행」·「QA가 통과되면」·「직접 실행해주세요」, 실행 주체 Leader — `docs/deploy-order.md` §471).
- **운영 DB**: `overseas_universe_{revision,proposal,auto,watch}` **4개 표 생성, 전부 0행.** 전체 표 50 → 54, 기존 표 무변경. `chk_rev_count <= 500`(앱 상한 150 과 다른 의도된 백스톱). **배포본 `fe6775a` 에 이 표를 읽는 코드가 없어 운영 동작은 바뀌지 않았다**(QA 확인).
- **🔴 상시 주의**: 표가 존재하므로 `overseas_universe_revision` 에 **행 하나만 들어가도 코드 배포 순간 그것이 실제 해외 분석 대상이 된다.** 운영 쓰기 금지, 공유 DB 를 보는 dev 서버에서 `PUT …/manual`·`POST …/proposals/[id]` 호출 금지, 쓰기 검증은 일회용 MariaDB 로만. **코드 배포 직전 `COUNT(*) = 0` 재확인.**
- **브라우저 실측 완료**(격리 환경 — 일회용 `mariadb:10.11.11` + 터널, 운영 무접촉 사후 확인): 360·412·1280px 가로 스크롤 0·44px 미만 터치 영역 0 · Esc 로 포커스 트리거 복귀 · 배경 `inert` · 오류 상태에 내부 분류어 유출 0건.
- **남은 것**: ① task frontmatter 에 `base_ref` 추가 ② **`fe6775a` 기준 재검증**(지금 증빙은 전부 `2c2308e` 기준) ③ **서버 worktree 에서 경로 지정 커밋**(신규 파일이 대부분이라 `git diff` 로는 안 보인다) ④ 코드 배포 — **별도 승인**, 그 전에 QA 가 남긴 6건(제안 카드 화면·빈 상태 2변형 등 WP-A 의존분 포함)을 다시 따진다.
- **WP-A**(NYSE 상위 50 자동 산출): 설계 완료([`docs/design/2026-11-01-t143-wpa-nyse50-spec.md`](../../docs/design/2026-11-01-t143-wpa-nyse50-spec.md)), **미구현**. 1회차 자동 실행 예정 2026-12-06(일) 01:10 KST. **WP-C**(대상 ~150 확대 전 시간 예산 실측): 거래일 실측 대기 — 08시 틱 최악 287~359초로 **300초 초과 위험**이라 실측 전 확대 금지.
- **T-137 은 닫히지 않았다** — 아래 별도 항목 참조.

## 2026-11-01 11:08 — T-142(안전 플래그 비 JSON 값) 운영 배포 완료 (릴리스 `20261101-110613-0dbf6c9a`)

- **사용자 결정**: 「네, 현행대로 배포」 — M-1(비 JSON `no`·`off` 를 값으로 존중할지) **현행 유지**. Leader 권고와 같다.
- **배포**: merge `0dbf6c9`(1부모 `9f6f980` 다른 세션 `.codex` 정책 · 2부모 `2c2308e` T-142), push 11:05:49 → webhook 11:06:04~11:07:51 `exit=0`, `RELEASE_RESULT ok`, `migrated:false`. 롤백 지점 `20261101-095812-9f6f9809`.
- **배포 후 확인**: pm2 둘 다 online·restarts 0 · cron 1개 · health green(`dryRun true`·`killSwitch false`, 배포 전과 같다) · 배포본 4파일에 `decodeFlagValue` · `system_config` 101행 전부 유효 JSON·비 JSON 0행 · 로그 `해석할 수 없음` 0건 → **거동이 바뀐 것 없음**(예측대로) · 24h `orders` 0행.
- **🔴 push 가 한 번 막혔고 저장소를 수리했다**: `.git/refs/` 안 Synology 확장속성 사이드카(`@eaDir/*@SynoEAStream` 8개) 때문에 `git fetch` 가 `fatal: bad object refs/codex/@eaDir/turn-diffs@SynoEAStream` 로 하드 실패했다. 삭제하지 않고 `~/.local/share/stockinvest-eadir-quarantine/20261101-110414/` 로 격리(진짜 ref 13개 불변, 격리 후 fetch 정상). **Codex 가 `refs/codex/*` 를 쓰면 재발한다** — 근본 조치(Synology 색인 제외 / `.git` 을 로컬 디스크로 / Codex ref 미사용)는 미정, `/이슈기록` 후보.
- **공유 트리는 origin 보다 1커밋 뒤에 있다**: 다른 세션이 `.codex/agents/leader.toml` 을 커밋 전으로 들고 있어 공유 트리 merge 가 막혀 별도 worktree(`~/.node-local/t142-push`, 사용 후 제거)에서 합쳐 push 했다. 로컬 `main`(`2c2308e`)은 `0dbf6c9` 의 조상이라 그 세션이 커밋한 뒤 `git merge --ff-only origin/main` 으로 따라온다. **그 세션에 알렸다.** 그래서 이 배포 기록·board·ACTIVE 갱신은 **커밋하지 않았다**(커밋하면 다시 갈라져 그 세션의 ff 를 막는다).
- **⚠ 관측(내 작업 아님)**: `safety_kill_switch` 의 `updated_at` 이 **09:53:56** 로 바뀌어 있다 — 값은 `false` 그대로이고 health 도 평시다. 설정 화면 PATCH 나 다른 세션으로 보이지만 **출처는 확인하지 못했다.** → **해결(2026-11-02): 사용자가 직접 설정한 것으로 채팅 확인 — 의도한 변경, 조치 불필요.** 이후 점검의 `safety_kill_switch` 기대 `updated_at` 은 11-01 09:53:56 이다(옛 10-30 09:08:18 은 낡음).
- **다음**: ① **11-01 14:02 KST(휴장일) 토큰 갱신 리허설** — `api-usage-2026-11-01.jsonl` 의 `token-p` 가 1건(많아야 2건)·403 0건이면 T-138 단일 비행 실증 ② **F-1 = serve-stale**(T-138 후속 1위, 11-02 장중 전) ③ **O-2 블랙리스트 별 task** 열지 사용자 결정 ④ **F-2②**(DB 읽기 오류 → 활성?) 사용자 결정 ⑤ 11-02(월) 장중 관측(T-133 시세 재시도 소진율·`[portfolio-total] 시세 조회 실패` 감소).

## 2026-11-01 09:45 — T-139·T-140 운영 배포 완료 (릴리스 `20261101-094008-81a1aabe`)

- **사용자 지시**: 「T-139,T-140 푸시 및 배포 진행해줘. 배포 직후 pm2 로그파일 확인은 너가 검증 후에 결과알려줘」. push `d0d203c..81a1aab` 09:39:37(T-139 `3d40f6a`·T-140 `967259f`·문서 `81a1aab`), webhook 09:39:59~09:41:41 `exit=0`, `RELEASE_RESULT ok`, `migrated:false`, 롤백 대상 `20261101-093319-d0d203cf`.
- **재검증**: 승인 사이에 다른 세션이 T-141(`d0d203c`)을 배포해 base 가 바뀌어, 그 위에 cherry-pick 한 상태(tree `8ec03ee8`)로 전체 jest **10455 통과·실패 0**, `tsc` 0, `next build` 0 을 다시 돌린 뒤 `--ff-only` 로 main 에 올려 push. 승인 시점 계획의 배포 창(05:10~08:30)은 지났고(승인 응답이 09:3x) 일요일 휴장일에 나갔다.
- **배포 직후 pm2 로그 점검(요청분) 이상 없음**: 기록 스위치 경고 0줄 · 배포 후 `pm2-err.log` 새 줄 0 · `cron-err.log` 0B · pm2 online·restarts 0 · health green · 안전 키 불변. 배포 전(05:09~06:04) `job-run-log` 타임아웃 13줄은 배포와 무관한 DB 지연 창. 상세는 [[T-139-record-switch-bounded-read]] 「배포 기록」.
- 같은 체크아웃의 다른 세션(T-142 `src/lib/safety/{dry-run,flags,kill-switch}.ts` 미커밋 수정, T-137)의 파일은 건드리지 않았다.

## 2026-11-01 09:40 — T-141(킬스위치 송신 직전 재확인) 운영 배포 완료 (릴리스 `20261101-093319-d0d203cf`) + T-142 즉시 착수

- **사용자 지시**: 「먼저 T-141 배포 후에 고치는 작업 진행해줘」. **내 권고와 반대 순서**다(나는 「배포 보류 → F-2① 먼저 고치고 한 번에 감사」를 권했다). 사용자 결정이므로 위험을 한 번 적고 그대로 진행했다.
- **배포**: push `18896a8..d0d203c` 09:32:53(코드 `d0d203c` + 로컬 문서 `6610dc0` 동승) → webhook 09:33:10~09:34:11 `exit=0`, `RELEASE_RESULT ok`, `migrated:false`. 롤백 대상 `20261031-235854-18896a8b`.
- **배포 후 읽기 확인**: pm2 둘 다 새 릴리스·online·restarts 0 · cron 1개 · health 200 green(`dryRun true`·`killSwitch false`·`schemaFatal false`) · `safety_dry_run`·`safety_kill_switch` 둘 다 10-30 09:08 그대로(배포가 설정을 바꾸지 않았다) · 배포본 `dry-run.ts:252` 8a-0 주석·빌드 청크 `KILL_SWITCH_ACTIVE` 2건 · **24시간 `orders` 0행**(= `kill_switch` 차단 기준선 0 유지) · 오류 로그 0줄.
- **🔴 QA 판정은 FAIL 이었다 — 변경이 아니라 잔존 결함 때문이다.** 변경 자체는 결함 0·회귀 0(전체 jest 363스위트 10400건, 변이 15종 중 14종 탐지). 남은 것은 킬스위치 우회 **2건**:
  - **F-1 (사용자 수용)** — `getMarketTotal` 60초 캐시가 적중하면 5~6단계가 KIS 를 타지 않아 **토큰 대기가 재확인 뒤**(`realSubmit` 안)에 남는다. QA 가 `sent=1` 로 재현. 「틈을 닫았다」는 내 표현이 과장이었다 — **「5~6 이 KIS 를 타는 경우에 한해 닫았다」**가 정확하다. 진짜 해결은 **serve-stale**(T-138 후속 1위)이고 그것은 주문 게이트를 건드리지 않는다.
  - **F-2 ①(T-142 로 착수)·②(사용자 결정 대기)** — 값 해석 실패가 fail-open. QA 가 감사자도 못 본 **B·G**(DB 값·재확인 값이 JSON 아님) 경로를 찾았다.
- **🔴 지금 실주문은 나가지 않는다**: 운영 `safety_dry_run=true`(10-30 09:08), 14일간 주문 1건(dry_run). 그래서 두 우회가 현재 돈을 움직이지는 않는다. **DRY_RUN 을 끄기 전에 둘 다 닫혀 있어야 한다.**
- **T-142 결과(10:34)**: **감사 PASS · QA PASS**(결함 0·Critical 0, 변이 23종 전부 사살, 정상 JSON 차분 408건 불일치 0, 실 드라이버 E2E 13건). **🔴 위험 등급이 내려갔다** — 운영 `system_config.value` 에 `CHECK (json_valid(value))` 가 있어 평범한 SQL 로는 비 JSON 값을 넣을 수 없다(감사·QA 각자 실측·운영 101행 중 0행). T-141 QA 의 B·G 재현은 **모의 풀**이고, 내가 적은 「Critical·실주문 재현」은 과장이었다. 이 수정의 값은 ① 제약 우회 환경(복원본·마이그레이션 중 테이블·`check_constraint_checks=0`)에 대한 방어층 ② 코드가 자기 주석을 지키게 하는 것. **M-1 사용자 결정 대기**(비 JSON `no`·`off` 를 값으로 볼지 해석 불가로 볼지 — 권고는 현행 유지) · **커밋 안 함.**
- **T-142 착수**: [[T-142-killswitch-parse-failure-fail-closed]] — `flags.ts` 에 `decodeFlagValue`(비 JSON 이면 원문 그대로)를 두고 `kill-switch.ts`·`dry-run.ts` 두 호출점에 적용했다. `isDryRun` 쪽은 **env 에 `DRY_RUN=false` 가 있으면 「DB 에 `yes`(모의로 돌려라)」가 실거래로 뒤집히는** 더 위험한 경로라 같이 고쳤다. ops 대조(`safety-state.ts crossCheck`)도 같은 해석으로 맞췄다. 구현·시험 완료, **감사 대기**.
- **다음**: ① T-142 감사 → QA → 사용자 배포 결정 ② **11-01 14:02 KST(휴장일) 토큰 갱신 리허설** 확인(`token-p` 1건·403 0건이면 T-138 단일 비행 실증) ③ F-1 해결 = serve-stale(11-02 장중 전) ④ F-2②(DB 읽기 오류 → 활성?) 사용자 결정 ⑤ 11-02(월) 장중 관측.

## 2026-11-01 01:32 — T-137 전체 코드 감사·격리 QA 보강, 운영/공식 기록 관문 대기

- 사용자 지시로 현행 모델 정의 팀을 재소집해 [[T-137-dynamic-overseas-universe]] 인계를 이어 진행했다. source main에 직접 반영하지 않고 별도 서버 격리본에서 처리 기아·빈 결과 identity·협조 SEC 갱신의 근거 일관성 3건을 수정했다. 신규표는7개 초안이며 운영DDL 미적용. 최신 main `18896a8bc9788f0cab98b2cba9860d6b3d0414dd`에 정확79파일을 통합·해시고정했고 타main파일은 보존했다.
- 검증: Reviewer가79파일 전체 변경과 신규/안전시험을 읽고 독립 해시 대조한 코드 범위 조건부 의견을 제출. 전체 통합 Jest385 suites/10,548 tests·tsc·Next/worker build 통과(13suites/252tests skip). QA가775건·DB22건·추가관문183건·worker watchdog 및 실제 Next OFF HTTP6을 독립 확인했고, 전체 합성 cron J1 4,320틱/23조건도 통과했다. J1은 기록 후크 비간섭의 합성 비교이고 T-137 ON/실KIS 성능이 아니다. 상세범위·해시·복원순서는 task 최신 진입점을 따른다.
- 사용자/운영 대기: 공급계약/API 이용권 없음→Nasdaq 자동수집 권한 미충족. Reviewer 역할의 직접편집금지와 본인기록 요구 충돌→공식 task판정줄 없음/커밋관문 미충족(대필금지). 사용자가 자기감사기록 한정 예외를 명시하거나 정본규정을 정정해야 한다. SEC 공유예산·실KIS150+·실제DB worker전환/구작업drain·운영전체스키마·운영DDL/배포승인도 남았다. task는doing·waiting:user_decision, 전체운영QA/done은 아니다.
- 최종 읽기(01:32:33 KST): remote main18896/운영릴리스 `20261031-235854-18896a8b`, 웹·cron online·재시작0, healthgreen·DRY_RUNtrue·killfalse·engineenabled. T-137 환경키5개는01:23조회당시 두PM2앱/.env모두미설정. 운영설정/DB쓰기/주문/실원천수집/commit/push/배포 변경 없음. 기존 예약·타task 상태는 아래 이력을 유지한다.

## 2026-10-31 23:59 — T-136·T-138(KIS 토큰) 운영 배포 완료 (릴리스 `20261031-235854-18896a8b`)

- **사용자 지시**: 「네, 고쳐주세요」(T-133 후속) → 「지금 바로 처리해줘」(T-138) → 「지금 배포」.
- **배포**: push `3669090..18896a8`(커밋 4개 — 코드 T-136 `a064722`·T-138 `18896a8`, 문서 2개는 다른 세션) → webhook 23:58:54~00:00:45 `exit=0`, `RELEASE_RESULT ok`, `migrated:false`. 롤백 대상 `20261031-215102-36690909`.
- **배포 후 읽기 확인**: pm2 둘 다 새 릴리스·online·restarts 0 · cron 1개(틱 OK) · health 200 green(`dryRun true`·`killSwitch false`·`schemaFatal false`) · 안전 키 6개 불변 · 배포본에 `kis-token-codes.ts`·`kis-token-retry.ts`·`issueOnce`·`TOKEN_ISSUE_TIMEOUT_MS` 존재.
- **🔴 실효 확인은 11-01 14:02 KST(휴장일) 토큰 갱신 창**이다 — 배포 시점에서 약 14시간 뒤. `api-usage-2026-11-01.jsonl` 의 `token-p` 가 **1건(많아야 2건)·403 0건**이면 단일 비행 실증, **같은 초 2건 이상 + 403** 이면 비행이 안 걸린 것이다(Next 번들 간 `kis-auth` 모듈 인스턴스 분리 가능성 — 감사·QA 가 미검증으로 남긴 유일한 핵심 가정). 배포 직전 10-31 15:02:07 에 `issued new token` 이 **같은 초 3줄**로 찍혀 문제 재현을 확인했다.
- **🔴 QA 가 찾은 기존 결함 — 사용자 결정 대기**: 킬스위치를 **송신 직전에 다시 확인하지 않는다**(`dry-run.ts:178` 확인 → `:261` 송신). 토큰 대기가 그 틈을 **최대 약 180초**까지 넓힌다 — 사용자가 킬스위치를 내려도 이미 그 지점을 지난 주문은 최대 3분 뒤 나갈 수 있다. **HEAD 부터 있던 구조**이고 고치려면 주문 송신의 최종 관문 `src/lib/safety/dry-run.ts` 를 건드려야 해 **별 task** 로 분리했다.
- **품질 기록**: T-136 감사 5라운드(FAIL→CONDITIONAL_PASS→PASS→PASS→PASS)·QA 3회차(FAIL→FAIL→FAIL(문서)), T-138 감사 1라운드(CONDITIONAL_PASS)·QA 1회차(PASS 조건부). 메인 세션이 만든 결함을 감사·QA 가 **5건** 잡았다 — H-1(원장 가드 순서)·F-1(혼합 토큰 회귀)·F-A(무계 정지)·사실 오류 2건(「2분간 토큰 없음」·「11-03(월)」은 화요일). 셋 다 "고치려다 다른 곳을 나쁘게" 였다.
- **다음**: ① 11-01 14:02 KST 리허설 확인 ② 후속 1위 **serve-stale**(감사자 하네스에서 모든 시나리오 0초·0실패, 11-02 장중 전) ③ 킬스위치 재확인(F-2) 사용자 결정 ④ 11-02(월) 장중 관측(T-133 시세 재시도 소진율·`[portfolio-total] 시세 조회 실패` 감소).

## 2026-10-31 19:30 — T-134·T-135 운영 배포 완료 (릴리스 `20261031-192807-8ed1ba7b`)

- **사용자 승인**: 「오늘 검증 통과 시」(배포 시점 질문의 답). 합친 상태 검증(`tsc` 0 · jest 149 스위트 4442 통과 · `next build` 통과) 통과 후 19:27:34 push `90f858f..8ed1ba7`, webhook 19:27:54~19:30:17 `exit=0`, `RELEASE_RESULT ok`, `migrated:false`. 이전 릴리스 `20261031-185943-90f858f5`.
- **내용**: [[T-134-exit-engine-state-load-isolation]](청산 평가 중 한 종목의 상태 조회 실패가 남은 종목 평가를 멈추지 않음) · [[T-135-recorder-pool-hold-and-runner-tmp]](기록기 풀 연결 점유 상한 + 러너 응답 임시 파일 0600 전용 디렉터리). 코드는 `main` 이 아니라 별도 브랜치에서 QA 까지 마친 뒤 사용자 승인 후에 cherry-pick 해 push 했다(14:01 에 다른 세션 push 에 실려 나간 사고의 재발 방지).
- **배포 후 읽기 확인**: pm2 둘 다 online·restarts 0 · 러너 단일 프로세스·새 릴리스 · `call-tmp` 0700·잔존 0 · `/tmp/cron-runner-*` 0 · 스풀 비움 · `job_run_log` 계속 증가 · PROCESSLIST 비어 있음 · 안전 키 불변 · health green. 컷오버 때 `job-run-log 전송 실패 HTTP=000/503 reason=timeout` 가 났지만 스풀로 재전송돼 비워졌다(기저선과 같은 종류, T-127 의 `reason=` 형식을 운영에서 처음 관찰).
- **다음**: 20:07 배포 후 40분 점검(예약) · 11-02(월) 09:22 국내·11-03(화) 07:20 해외 `exit_judgment` 첫 틱 검증(예약, 세션 한정) · 11-02 장중 홈 「데이터 이상」 확인. 후속 후보는 [[T-131-t126-t130-followup-candidates]](남은 1·2번 = 2순위, 실거래 단계 진입 전).
- **정리 대기(사용자 확인 후)**: 서버 worktree `stockinvest-t134`·`t135`·`integ2`·이전 task worktree들, 브랜치 `wip/T-134-state-load-isolation`·`wip/T-135-recorder-pool-runner-tmp`(내용은 `main` 에 cherry-pick 되어 있음), QA 일회용 DB 컨테이너·`~/.node-local/t1*` 로그 폴더.

## 2026-10-31 19:01 — T-133(시세 HTTP200 업무실패 재시도) 운영 배포 완료 (릴리스 `20261031-185943-90f858f5`)

- **사용자 지시**: 「네, 고쳐주세요」(T-132 보고의 결정 ①) → 「지금 배포」.
- **배포**: push `ad45efc..90f858f`(커밋 4개 — 코드는 T-133 `90f858f` 하나, 문서 3개) → webhook blue/green 18:59:43~19:01:34 `exit=0`, `RELEASE_RESULT ok`, `migrated:false`. 이전 릴리스 `20261031-135945-ad45efc2`(롤백 대상). **다른 세션의 T-134·T-135 코드는 미커밋이라 들어가지 않았다.**
- **배포 후 읽기 확인**: pm2 둘 다 새 릴리스·online·restarts 0 · `cron-runner.sh` 1개(19:02 까지 매분 OK) · `/api/health` 200 green(`dryRun true`·`killSwitch false`·`schemaFatal false`) · `system_config` 안전 키 6개 불변 · 새 릴리스 소스·빌드에 T-133 코드 존재.
- **🔴 배포 직후 시세·토큰 로그 0건 = "정상" 이 아니라 "표본 없음"**. KIS 실패율이 최근 1시간 1.8% 로 가라앉았고 토요일 휴장이다. T-132 때처럼 복구 사례를 본 것이 아니므로 **실효 확인은 11-02(월) 개장 첫 틱 이후**다.
- **T-132 운영 실적(14:00~19:00, 5시간)**: 재시도 성공 **21** · 소진 **6**(복구율 78%) · 잔고 폴백 **0건**(배포 전 하루 188건) · 총액 제외 2건(T-133 이 고친 경로).
- **품질 기록**: 감사 6라운드(CONDITIONAL_PASS → FAIL → PASS → PASS → FAIL → PASS) · QA 2회차(1회차 FAIL). 감사·QA 가 메인 세션의 오류를 다수 잡았다 — 멱등성 울타리 구멍 **2회**(M-1 블록 닫고 코드 · M-3 파서 전환으로 잃은 커버리지) · 토큰 재발급 **악화**(M-2, 60초 정지로 `createOrder` 차단) · `EGW00121` 사각지대 · 수치 오류 3건 · 자기 시험이 변이를 못 잡은 것 2회. 정적 울타리 추가 보강은 감사자·QA 와 합의해 중단(잔여 7종은 런타임 GET 가드가 차단).
- **다음**: ① 11-02(월) 개장 후 관측 — `[kis-http] 일시 실패 재시도` 성공/소진 비율(기준 T-132 직후 17건 중 소진 4건)·`[kis-domestic getTicker] token` 로그 유무·`[portfolio-total] 시세 조회 실패` 건수 감소 ② 후속 후보 9건 중 ⑧(토큰 판정 사본 3곳 — 재읽기 우선으로 함께)·⑦(울타리 재귀 스캔)·①(해외 시세 토큰 분기).

## 2026-10-31 15:42 — T-126 DDL 적용 + 기록 스위치 켬 (`exit_judgment`)

- **사용자 승인**: 「T-126 승인하니 DDL작업 진행해줘」(06:50)·「배포 승인하니 이어서 작업 진행해줘」(15:40 창)·「1. 기록 스위치 켜기 승인」.
- **결과**: 15:41:30 DDL 1회 exit 0(`CREATE TABLE IF NOT EXISTS exit_judgment`), 가드 7개 통과, `SHOW CREATE TABLE` 이 Reviewer 기대 정의와 **완전 일치**(21열·인덱스 2·CHECK 2). 15:41:54 `exit_judgment_record_enabled=true`. 켠 뒤 안전 키 5개 값·시각 불변, 멈춘 INSERT 0, 앱 로그 경고 0, health green, 행 0(토요일 휴장 — 정상).
- **정정**: 예약 프롬프트의 로그 파일명이 틀려(`~/.pm2/logs/stockinvest-*.log` 없음) 첫 로그 점검이 헛돌았다 — 실제 경로 `shared/logs/pm2-err.log` 등으로 재점검, 결과 동일. 상세: [[T-126-exit-judgment-persistence]] 「배포 기록」.
- **다음**: 11-02(월) 09:22 국내 첫 틱 행 검증 · 11-03(화) 07:20 해외 첫 틱 행 검증(예약은 세션 한정). 이상이면 스위치를 false 로(롤백).
- **병행 착수(사용자 「권고대로 착수」)**: [[T-134-exit-engine-state-load-isolation]](청산 엔진 상태 조회 실패 종목 단위 격리) · [[T-135-recorder-pool-hold-and-runner-tmp]](T-112 기록기 풀 점유 상한 + 러너 임시 파일 0600) — Developer 구현 중, 코드 변경은 서버 worktree(`stockinvest-t134`·`t135`)에만 있고 미커밋. `getTicker` HTTP200 은 다른 세션의 [[T-133-ticker-business-failure-retry]] 가 맡는다(이 두 task 는 `src/lib/exchanges/*` 를 건드리지 않는다).

## 2026-10-31 14:01 — T-132 + 대기였던 T-126·T-127·T-128·T-130 운영 배포 완료 (릴리스 `20261031-135945-ad45efc2`)

- **사용자 지시**: 10-31 「지금 배포」(T-132 보고에서 "push 하면 8커밋이 함께 배포된다"를 명시한 뒤 받은 승인).
- **배포**: push `4c6f595..ad45efc`(커밋 9개·94파일, 코드 6개) → webhook blue/green 13:59:37~14:01:03 `exit=0`, `RELEASE_RESULT ok`, `migrated:false`. 이전 릴리스 `20261031-052042-4c6f5950`(롤백 대상).
- **배포 후 읽기 확인**: pm2 `stockinvest`·`stockinvest-cron` 둘 다 새 릴리스 경로·online·restarts 0 · `cron-runner.sh` 1개 · `/api/health` 200 green(`dryRun true`·`killSwitch false`·`schemaFatal false`) · `system_config` 안전 키 5개 값·`updated_at` 불변 · 새 릴리스 소스·빌드에 T-132 재시도 코드 존재.
- **T-132 실제 복구 3건(배포 후 12분, 14:00~14:12:47)**: `14:01` status=200(SESSION FULL) · `14:04`·`14:06` status=500(EGW00300) — 전부 2회차에서 1초 안에 복구, `재시도 소진` 0건. 같은 창에서 `[portfolio-total] 잔고 조회 실패→직전값/unknown` **0건**(배포 전 시간당 24~56건, 오늘 188건). 휴장일 12분 저트래픽 표본이라 추세는 아니다. KIS 장애는 진행 중 — 오늘 실패율 **13.8%**(1233건 중 170건), 최근 60분 14.1%.
- **🔴 절차 이탈(사실 기록)**: 11:00 절의 계획은 「DDL 적용 → push」였고 배포 창도 15:40 로 적어 뒀는데, 이 세션이 **ACTIVE.md 를 먼저 읽지 않고 13:59 에 push** 했다. 결과: **T-126 코드가 DDL 보다 먼저 운영에 들어갔다.** 피해는 없다 — `exit_judgment` 표 없음(`information_schema` 0건)이고 기록 스위치 `system_config` 키가 없어 **꺼짐**이라 기록 코드가 아무것도 쓰지 않는다(스위치를 켠 채 표가 없으면 errno 1146 을 받아 조용히 건너뛴다. 청산 평가·시그널·주문은 그대로, `schemaFatal:false` 확인). 10-31 은 토요일 휴장이라 장중 영향도 없다. **DDL 적용·스위치 켜기는 손대지 않았다** — 사용자 건별 승인 사항이고 T-126 은 다른 세션 범위다.
- **배포 중 발견(T-132 범위 밖)**: `getTicker` 의 HTTP200 업무실패(SESSION FULL)로 보유 종목이 오늘 **11번** 총액에서 제외됐다(09:41~13:59, 그중 SESSION FULL 10건). 시세 경로는 HTTP 500 만 2회 재시도하고 HTTP200 `rt_cd≠0` 은 보지 않는다. 기록된 스냅샷(`portfolio_snapshots` 5548~5550)은 7포지션 모두 든 완전한 값이라 축소 총액이 DB 에 남지는 않았다. T-012 계열 조용한 축소 경로 — 후속 우선순위 상향.
- **다음**: ① `getTicker` HTTP200 수정 여부 사용자 결정 ② T-126 DDL 적용·스위치 켜기(다른 세션 + 사용자 승인) ③ 11-02(월) 개장 장중에 「스냅샷 건너뜀」 경보 감소·`재시도 소진` 비율 확인.

## 2026-10-31 11:00 — T-126·T-127·T-128·T-130 구현·감사·QA 완료, 배포 승인 대기 (로컬 main `967d77e`, push 안 함)

- **사용자 지시**: 10-31 06:50 "T-126 승인하니 DDL작업 진행해줘. 이후에 T-127,T-128도 이어서 진행해줘", 07:50 T-130 데모 v1 "전부 권고대로"(demo_gate=approved). DDL 승인 범위 해석(Leader): 가산 전용 새 표 1개 `CREATE TABLE IF NOT EXISTS`, 웹 배포보다 먼저·장외 창, **기록 스위치 켜기는 별도 승인**.
- **로컬 main**: `ec6723c`(문서) ← `fe6f095` T-128 ← `c9fc415` T-127 ← `dd30ef8` T-130 ← `0116228` T-126 ← `967d77e`(T-130 후속: T-119 격리 시험 허용 목록 2파일). origin/main=`4c6f595`. 최종 통합 검증(tsc·전체 jest·build)은 서버 `/tmp/final-integ/status.txt` 에서 진행.
- **T-126** exit_judgment: DDL 파일 sha256 `dfa0967c…e5fe1`, 운영에 표 없음(읽기 확인), sql_mode STRICT_TRANS_TABLES·MariaDB 10.11.11. Reviewer PASS(R1 풀 연결 점유 수정 후)·QA PASS. 적용 절차 = DDL(`DBQ_ALLOW_WRITE=1 dbq.py`) → push → 스위치는 별도 승인.
- **T-127** 러너: 마스킹(금액 키 5개+detail)·스풀 0600·503 사유(`reason=`)·롤업 failed 전이 시험. Reviewer PASS·QA PASS. 배포 뒤 운영 스풀 권한·실패 줄 확인 필요(미검증).
- **T-128** WP-A 5건·**T-130** 화면 후속: Reviewer PASS·QA PASS. T-130 QA 결함 N1(검증 관문 차단 집계가 gate 없는 skipped 포함, 표시 정확성)은 후속 [[T-131-t126-t130-followup-candidates]] 6번.
- **Codex 연계 장애**: `~/.codex/config.toml` 의 `model = "gpt-6.1-sol"` 이 ChatGPT 계정에서 미지원(HTTP 400 `model_not_found`) — C1 2건 실패, C2 는 호출 생략(override 기록). 사용자가 모델을 고치면 소급 실행 가능.
- **다음**: 사용자 배포 승인 → 15:40 창에 사전 점검 → DDL 적용 → push → `RELEASE_RESULT` 확인 → 읽기 전용 확인 → 스위치 켜기 승인 요청. 후속 후보 19건은 T-131.

## 2026-10-31 05:22 — T-108·T-129 운영 배포 완료

- **05:20 배포**: push `df4b4a2..4c6f595`(코드 커밋 `52442c5` T-108 + `4c6f595` T-129, 나머지 문서), 릴리스 `20261031-052042-4c6f5950` `RELEASE_RESULT ok`·`migrated:false`. 스위치·DB 변경 없음. 안전 설정 4개(`safety_dry_run=true`·`safety_kill_switch=false`·`exit_engine_enabled=true`·`exit_hard_stop_enabled=false`)와 `job_run_log_enabled=true` 불변, `judgment_record_enabled` 키 없음(꺼짐) 불변. 상세 [[T-108-automation-menu-home-overhaul]] `## 배포 기록`.
- **배포 순간 일회성**: 새 크론 러너 첫 틱 05:21:10 에 `signal-expiry`·`portfolio-snapshot`·`trade-report` 가 `HTTP=000`(웹 앱이 포트 열기 전) → 1초 뒤 OK. `job_run_log` 에 `failed` 2행·롤업 `partial` 1행이 남음(집계 해석 때 제외). `job-run-log` 전송 05:22:15 회복, 스풀 비어 있음.
- **사용자 확인 대기**: ① 운영 홈 화면(하단 탭 4칸·섹션 순서·값 표시) ② 다음 텔레그램 알림에서 새 문구 ③ `/api/ops/home` 응답 시간은 홈을 연 뒤 앱 로그로 확인(목표 4초, 최악 추정 8.8초).
- **알려진 한계(T-128 9번)**: 텔레그램 청산 승인 메시지는 제목이 새 이름(「손실한도 손절」)인데 DB 저장 사유 앞머리 `[하드 손절]`/`[EOD 손절]` 이 같이 보임.
- **다음 점검**: 08:13 T-112 `job_run_log` 관찰 3회차(08:00 해외 분석 뒤) · 11-02 16:13 4회차(+ `judgment_record_enabled` 켜기 의견, 사용자 승인 필요).

## 2026-10-30 05:2x — 10-28 밤~10-30 새벽 진행 정리 (운영 상태 스냅샷은 05:15 실측, 낡을 수 있음)

- **12:47 확인 — 안전 스위치 변경(10-30 09:08)은 사용자 의도**: 사용자 답 "의도한 변경"(질문: 오늘 09:08 안전 스위치 변경은 의도하신 건가요?). `safety_dry_run=true`(09:08:14) · `safety_kill_switch=false`(09:08:18) · `exit_engine_enabled=true`(09:08:29) · `exit_hard_stop_enabled=false`. 유효 상태(health): `dryRun true · killSwitch false · safetyStatus green`, 최근 72시간 주문 0, `executions` 0, 전략 16개 전부 `unvalidated`(D5 관문이 신규 매수 차단). 아래 "운영" 줄의 "킬스위치 `true`"는 05:15 실측이라 낡았다. 주의: DRY_RUN 이 `false` 가 되면 청산 엔진이 실주문을 낼 수 있다(검증 관문은 매수만 막는다). **사용자 설명(원문)**: "실거래만 막아놓고 킬스위치는 해제해서 시그널생성과 청산관련 로직은 켜놓은채로 남은 감사기간 지켜보기위해서 옵션을 변경했어" → 실거래만 막고(DRY_RUN) 시그널 생성·청산 로직을 켠 채 남은 감사 기간(~11-23)을 관찰하는 모드. 13:44 관측: 청산 엔진 기록은 005930 `exit_hard_stop_disabled` 스킵 40건(09:14~13:39)뿐, 장중 룰 엔진 buy 시그널 22건 전부 `skipped`, 주문 0. D1 = (a) 장마감 AI 분석만 유지 + **「청산 로직」 관찰 지표 신설**(사용자 결정 10-30 "(c) 청산 로직 지표 신설") — T-108 계약 §11 작성 중(Analyst).
- **16:11 결과 — 15:26:55 국내 보유 종목 `eod_loss_cut` 발화(signalId=19743), 매도 주문 1건이 `dry_run`(15:26:51)으로 기록, 실 송신 0**(예측 적중, 사용자 결정 D10 응답 전에 발생; 스위치 변경 없음). 텔레그램 "자동 제출" 알림은 `notify_signal_auto_submit=false` 라 오지 않았을 가능성이 높다(U7-7, 앞선 안내 정정). 16:16 사용자 "권고안 확정" — D11~D14 확정·U7 9건 실행 완료(계약 §11.8), 청산 판단 영구 보존은 후보 [[T-126-exit-judgment-persistence]].
- **16:11 T-125 관찰 1일차**: 16:03 국내 분석 `news=2`(후보 1개) 통과 → streak 2→0, **경고 미발송**(예상 빗나감). 통과 여부가 후보 수에 의존할 가능성 [가능성 높음, 표본 작음]. T-105 완료 조건(국내·해외 `news>0`)은 각각 1회 관측.
- 16:11 관측: 16:00 국내 분석 소요 약 3분 36초(16:00:03 시작→16:03:36 종료; 어제는 약 50초). 원인 미확인 [추측: 킬스위치 해제 뒤 KIS 호출 경합] — 다음 분석일 소요와 비교.
- **14:45 운영 위험 후보(범위 밖)**: pm2 로그(`shared/logs/pm2-out.log` 8.2MB·`pm2-err.log` 3.7MB)에 **회전 설정이 없다**(2026-09-19 컷오버부터). 지금은 작지만 계속 자란다 — 별도 task 후보(미등록, 사용자 판단).
- **21:38 T-112 관찰(32분)**: `job_run_log` 8행 전부 ok, 롤업 runs = 틱 수(이중 집계 없음). 전송 실패 1건(21:30:54 HTTP=503, 1분 뒤 자동 회복, 원인 미상·관찰 공백은 [[T-127-job-run-spool-hardening]] 5번). 안전 설정·하트비트 영향 없음.
- **21:15 T-108 A/B 7건 확정("권고대로 확정" = 전부 A)**: 데모 v3 의 승인·결정이 모두 닫힘(표: [[T-108-automation-menu-home-overhaul]] Designer 절). 화면 구현 미시작 — 다음은 Designer 구현 가이드(v3), 착수 시점 사용자 결정(지금/DP1 ~11-05).
- **21:05 T-108 데모 v3 승인 + `job_run_log_enabled` 켬**: 사용자 "T-108 데모 v3 승인하며 job_run_log_enabled를 켜고 관찰하는 작업도 진행해줘". `demo_gate=approved`(v3, sha `f3230e69cd05…`). A/B 7건은 21:15 에 확정(위). T-112 관찰 예약(세션 한정 크론): 10-30 22:12·23:42, 10-31 08:13, 11-02 16:13 — 세션이 끝나면 사라지니 그 시각에 사람이 `job_run_log` 를 보면 된다(`python3 -I ~/.node-local/tools/dbq.py -e "SELECT job_id,status,COUNT(*) FROM job_run_log GROUP BY 1,2"`). 다음 결정: `judgment_record_enabled`(11-02 점검 뒤), T-127 착수, T-108 구현 순서(DP1 ~11-05).
- **20:18 T-112 운영 반영 완료**: 커밋 `df4b4a2`·릴리스 `20261030-201752-df4b4a2d` ok·DDL 적용(테이블 3개·행 0). 러너 후크는 활성(스풀→전송→비움 확인), **기록 스위치 2개는 꺼짐**. 응답 필요: `job_run_log_enabled` 켜기(권고 먼저) 승인. 오늘 밤 21:00 holdings-premarket·22:30 미국장 틱, 내일 08:00 해외 분석에서 이상 없는지 확인할 것. 후속 후보 [[T-127-job-run-spool-hardening]].
- ~~18:20 T-108 데모 v3 사용자 검토 대기~~(21:05 승인으로 완료): https://claude.ai/artifact/SiyXU1cB6nD2JZhnHnfDNq (파일 `mockups/T-108-menu-home-v3.html`, `demo_gate=review_requested`, sha `f3230e69cd05…`). v2 는 사용자 용어 정정 요청(7항목)으로 대체. 응답 필요: 승인 또는 변경 요청 · 「AI 매수 판단」·「손실한도 손절」 이름 유지 여부 · 「결정 필요」 A/B 7건(권고 전부 A). 주의: 「실거래여부」 ON/OFF 는 내부 `safety_dry_run` 과 방향이 반대(계약 §12).
- ~~17:36 T-108 데모 v2 사용자 검토 대기~~(18:19 수정요청으로 v3 로 대체): https://claude.ai/artifact/6ev1RzsZivkd8nHbJvEUjr (파일 `mockups/T-108-menu-home-v2.html`, `demo_gate=review_requested`, sha `6fabba424ad8…`). v1 은 사용자 변경 요청(아이콘을 정해 둔 Lucide 원본으로)으로 대체. 응답 필요: 승인 또는 변경 요청 + 「결정 필요」 A/B 7건(권고 전부 A). T-112 구현은 별도 병행 중.
- **운영**: 릴리스 `20261030-051343-9d087a4d`(Node 24.22.2) · `stockinvest`·`stockinvest-cron` online·재시작 0·cron 정확히 1행 · health green · 킬스위치 `true`(10-23 22:42 자동 발동, **해제는 사용자 전용**) · 최근 24h 주문 0.
- **끝난 것**: T-115 국내 15:30 추가 수집(10-29 첫 실동작 정상) · T-116 최초 관측 캡처(`done`, 10-30 정리 — `ci_raw_item` 1,109행 정상) · T-117 일봉 정기 수집 `done`(10-30 07:41 첫 실행 정상) · T-118 해외 peek 19슬롯 `done` · T-119 보유 종목 개장 전 공시 `done`(10-29 21:01 첫 실행 정상) · T-121 Node 24 골든 시험 정리(배포) · 문서 전용 push(10-30 05:13).
- **오늘 10-30 관측·예정**: ① ✅ T-117 일봉 첫 자동 실행 07:41:56 정상(`daily-bars OK` 1줄·날짜파일 2026-10-30·`targets=93 processed=93 written=5430`·`aborted` 없음) → [[T-117-daily-bars-cron-registration]] `done`(09:3x). 국내 10-30 봉은 개장 전 자리표시(`is_final=0`)이니 소비 쪽은 `is_final=1` 만 쓴다. ② 16:00 국내 분석 뒤 T-106 `뉴스 0건` 경고(국내 3일째)가 울릴 수 있다 — 맞는 경고. ③ 해외는 정정: 10-30 08:01 해외 검색에서 뉴스 1건이 통과(`news=1`)해 카운터가 0 으로 리셋 — 앞서 적은 "10-31 08:00 해외 3일째" 예측은 틀렸고, 해외 경고는 빨라도 11-02 이후다.
- **사용자 결정 대기**: [[T-120-news-score-threshold-query]] **(가) 유지로 종료**(10-30, 변경 없음) → T-106 국내 경고 반복(`streak ≥ 3`·재발송 20시간 — 뉴스 0건인 동안 분석일마다)은 후보 [[T-125-news-zero-alert-cleanup]] 로 등록(10-30, 착수 전; 먼저 3~5 분석일 관찰) · [[T-105-news-rag-zero-hits]] 는 열어 둠(국내 `news>0` 는 10-30 16:03 에 1회 관측 — 종료 여부 사용자 결정) · Jev 판정 예산 구간 갱신(10-25 만료로 judge 가 규칙 엔진 대체 모드) · home-m4-api 커밋 M4 push 승인 · 11-23 = 남은 감사(관찰) 기간 종료 시점(킬스위치는 10-30 09:08 에 이미 해제 — 문서의 "11-23 킬스위치 해제 판단"은 "11-23 감사 기간 종료 판단"으로 읽는다; 그날의 결정 내용은 사용자가 정함).
- **대기 중 task**: [[T-104-cron-jobs-market-grouping]](planned) · [[T-108-automation-menu-home-overhaul]](deployed 10-31 05:21 — 운영 홈 화면 사용자 확인 대기, 후속 [[T-128-t108-followups]]) · [[T-129-alert-wording-terms]](deployed 10-31 05:21 — 다음 텔레그램 알림에서 새 문구 확인 대기) · [[T-112-run-judgment-record-foundation]](deployed — job_run_log 관찰 중, judgment_record 꺼짐) · [[T-127-job-run-spool-hardening]](proposed 후보) · [[T-109-research-context-for-analysis]](todo) · [[T-122-t118-followup-feed-check]]·[[T-123-t119-followup-silent-skip]](planned 후속) · [[T-105-news-rag-zero-hits]](in-progress — 후보 E 는 T-120 에서 (가) 유지로 결정) · [[T-124-news-input-misread-truncation]](proposed 후보) · [[T-125-news-zero-alert-cleanup]](proposed 후보) · [[T-126-exit-judgment-persistence]](proposed 후보).
- **로컬에만 있는 커밋(push 안 함)**: 이 갱신·배포 기록(`1d2dc07` 등). 문서만 push 해도 blue/green 배포가 돌므로 다음 기능 배포에 동승한다. push 는 배포 창(05:10~06:50 또는 15:40~20:00, 07:35~07:57 피함; 미국 정규장은 지금 22:30~05:00 KST 지만 서머타임이 끝나는 11-01 이후 23:30~06:00 으로 바뀌어 05:10 창이 장중과 겹칠 수 있다 [가능성 높음 — 11-02 전에 재확인])에서만.
- **주의**: 골든 시험 `t062-domestic-golden-head.ts` 는 ICU 78.3(Node 24.22.2) 기준이라 Node 20.20.2 에서는 실패한다(ICU 패치 민감). 무거운 명령(`jest`·`tsc`·`test-*.sh`)은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 으로 한 번에 하나만(10-28 23:49 서버 정지 사고).

## 2026-10-28 — 통합 절차서 작업 완료 보고·이번 설계/인수인계 종료

- 사용자가 통합 작업절차서에 따른 작업을 완료했다고 알리고 마무리를 요청했다. 이번 대화의 인터뷰·개편안·통합 절차서·Claude 인수인계(T-077/T-078)를 종료한다. [[T-078-integrated-execution-procedure]]에 완료 보고를 기록하고 [[2026-10-24-claude-restructure-handoff]]를 closed로 정리했다.
- 구현 완료는 사용자 확인으로 기록했으며 이번에는 실제 구현/배포/운영이나 S00~S09 검증 증거를 재감사하지 않았다. 실행 원장과 별도 진행 task의 상태를 일괄 완료로 바꾸지 않는다.
- 추가 작업을 자동 재개하지 않는다. 운영 안전/매매 설정·DB·주문·알림·배포 변경 및 커밋/push 없음. 이 대화에서 실행 중인 보조 에이전트 없음 확인. 아래 다른 작업의 이력·후속 상태는 보존한다.

## 2026-10-28 16:17 — T-111 기존 일일 수집 유지 기반 기업정보 통합 1차 설계

- **16:53 인계 완료**: 사용자가 1차 설계안을 Claude에 직접 전달했다고 알렸다. T-111의 1차 설계·인계 작업을 마무리한다. Claude 2차 설계의 착수·완료 여부는 미확인이고 구현·운영 반영은 후속이다.
- **16:45 인계 보강**: [[2026-10-28-corporate-intelligence-second-design-claude]]에 2차 설계 완료 기준·7개 권고 검토·T-104/105/106 및 T-078/T-079 정본 대조·미추적 파일 접근 주의·Claude 시작 문구 추가. Claude 실행·코드/운영 변경 없음.
- **16:41 후속**: 사용자 요청으로 1차 설계서 §8.1에 미결정 7개별 권고·대안·한계를, §8.2에 ‘기존 자료를 읽어 별도 공간에서 시험하는 병행 관찰’과 판단 병행 비교의 차이를 추가. Claude 인계도 갱신. 구현·운영 변경 없음.
- [[T-111-corporate-intelligence-first-design]]: 독립 일일 크론을 기준선으로 유지하면서 자료별 비동기 증분 계층·사건/근거 버전을 추가하는 1차 설계 `docs/design/2026-10-28-corporate-intelligence-first-design.md`와 [[2026-10-28-corporate-intelligence-second-design-claude]] 인계 작성. 사용자 첨부 원본은 `docs/reference/2026-10-28-corporate-collection-plan-v0.0.4.md`에 동일 복사(SHA-256 일치). 하루 1회로는 분 단위 최초 탐지 불가, Fast Watch는 추가 경로. 현재 원본 유실/덮어쓰기·서비스 간 전달·08시/16시 순서·기존 매매 영향·비용 후 비교를 명시. Claude 2차 설계·확정은 후속, T-078 정본 유지. 코드·DB·운영 설정·주문·배포 변경 및 운영 실측 없음, T-068 재감사 제외.

## 2026-10-28 15:44 — 리서치 참고 작업 접수·기업정보 수집계획 검토

- [[T-109-research-context-for-analysis]]: 사용자 지정 최신 3일의 동일 종목 리서치를 분석의 보조 근거로 연결하는 후속 작업 접수(todo). 자료 기준일·시점 재현·shadow 비교·기존 안전관문 유지. 구현·모의시험·운영 적용 전.
- [[T-110-corporate-intelligence-review]]: 업로드 계획서 8단계와 현 SEC/KIS/RSS·크론·M4 소스를 대조한 `docs/reports/2026-10-28-corporate-intelligence-review.md` 완료. 회사 식별·원본 증거·사건 병합·시점/정정 이력 선행, 미국 실적 한 유형으로 수직 검증 후 Adaptive Polling 확장 권고. M4 007/008 배포는 당시 이력 근거이며 이번 운영 실측은 아님. 코드·DB·설정·주문·배포 변경 없음, T-068 재감사 제외. 기존 T-078 단일 원장에 우선순위 조율 필요.

## 2026-10-28 13:28 — T-107 분석 처리 절차 도표·설명 완료(소스 조사)

- [[T-107-analysis-flow-visualization]]: 장중 룰·장마감 AI·리서치 통계·상세 AI 설명과 검증/승인/주문 연결을 현재 소스로 분리해 설명. 근거 보고서 `docs/reports/2026-10-28-analysis-processing-flow.md`와 대화용 6개 도표 작성. 소스 링크 39개·도표 18개 화면 조합 확인. 봉 시간축·입력 원천·뉴스 품질·비용 후 성과·리서치 검증·단계별 중단 사유를 후속 개선 후보로 기록. T-068 재감사 제외. **앱 소스·설정·DB·주문·배포 변경 없음**, 운영 상태 재조회 없음, 필수 사용자 확인/결정 없음. 기존 진행 작업 상태는 이 문서화로 변경하지 않음.

## 2026-10-28 11:50 — T-103 배포 완료 · T-105 뉴스 RAG 0건 진단 완료(수정은 M4 task-007 진행 중)

- **T-103 완료·운영 반영**: 뉴스 수집 크론을 국내·해외 독립 잡으로 분리(`?market=` 파라미터, 해외 06시 첫 틱→국내 다음 틱, 날짜 파일·알림 키 시장별). 11:21 KST push `5ac9119..414cc3b`(3커밋, 코드는 `8b1e712`)·릴리스 `20261028-112124-414cc3b4` ok. 사용자 지시("푸시해주고")로 예정(15:47)보다 앞당겨 실행 — 킬스위치 ON·24시간 주문 0 확인 후. 검증: pm2 둘 다 online·재시작 0, cron 1행, 하트비트 71초, health 200, 인증 없는 `?market=bad` 401. **내일 06:13 예약 검증**(해외 06:00·국내 다음 틱 각 1회). 알림 변화: 시장 하나 실패 시 시장별 critical.
- **T-105 원인 확정(M4 지식베이스 읽기 전용 진단)**: 분석에 뉴스가 0건인 이유 — ① M4 가 RSS 발행일을 RFC 822 문자열 그대로 저장해 앱의 ISO 날짜 필터에 안 걸림(국내·해외 공통, 국내 31/31회 `news=0`) ② 해외 원천(Dow Jones RSS)이 2025-01-27 에서 멈춤 ③ `news.macro` 는 05-12 시드 15건뿐·적재 경로 없음. 접속·인증·점수 컷은 원인 아님(시그널은 정상 검색). `ingested_at` 으로 필터를 바꾸는 우회는 2025-01 기사를 최신으로 오인시켜 금지.
- **수정**: M4(`home-m4-api`) `task-007` — `_parse_rss` 발행일 UTC ISO 정규화+원문 보존, 해외 RSS 기본 URL 교체(권고 CNBC Top News). M4 격리 워크트리 `~/.node-local/m4api-t007`·로컬 venv `~/.node-local/m4api-venv`. 흐름 Developer(Opus)→Reviewer→Codex(C2 판정)→Tester→**M4 push 는 공유 운영 서버라 사용자 승인**.
- **사용자 몫**: ① M4 push 승인(감사·시험 통과 후 요청) ② T-105 후속 후보 A 감시 알림(T-106)·B `news.macro` 처리·C 낡은 2025-01 기사 정리(삭제)·D 수집 건수 ③ ADP-006: 가-QCOM 위반 처리 방침·3단계 여부·지표 7(b) 해석(아래 09:10 섹션) ④ 크론 잡 해외/국내 그룹 정리(T-104) 착수.

## 2026-10-28 09:10 — ADP-006 C01 2단계 완료 (T-061, 사용자 지시: 10-30 을 기다리지 않고 바로 착수)

- **표본**: 규칙 추첨(시드 20261028) → **NAS:QCOM**(발표 2026-11-04 장 마감 후)·**NYS:PFE**(발표 2026-11-03 아침). INTC·SNDK 는 설계 §8 사전 고정 "표본 내(판정 제외)"라 풀에서 제외(adoption D-08). 노트 6건(가·나·다 × 2종목) `trials/ADP-006-C01/notes/2026-10-28/` 보관, 팩 `datapacks/2026-10-28/`. 코드·DB·배포 변경 없음(문서만).
- **기록 감사**: **가-QCOM 규칙 위반 1건**(가져온 SEC 공개 문서를 세션 임시 폴더에 4개 파일로 저장·`for` 반복문 — 호출 문구 규칙 1·6). 설계 §8 즉시 중단 조건은 아니나 절차서 5 에 따라 **3단계·코스닥 보조 관찰은 사용자 방침 전까지 미착수**. 군 간 오염 없음. 다-QCOM 질의 로그 SEC URL 1건 누락(경미 — 지표 7(b) 문구상 위반으로 셀 수 있음, 최종 판정 때 해석 결정), 가-QCOM·가-PFE 외부 인용 목표가·등급(지표 7(a)). 변형 파일·팩 sha256 불변. 점수·우열 없음.
- **비용**: 노트 6건 1,220,198 토큰(고지 ≈115만의 1.06배, 노트당 18.5만~22.4만) + 후보 공식 일정 확인 서브에이전트 3개 324,947(고지에 없었음) = 1,545,145. 누적 약 345만(하네스 보고 토큰 기준).
- **사용자 몫**: ① 가-QCOM 위반 처리 방침(권고: 노트 보관·판정 입력으로 기록, 재시험 안 함) ② 3단계·코스닥 보조 관찰 착수 여부(각 단계 전 비용 고지) ③ 지표 7(b) 해석(최종 판정 전). **사후 기록**: PFE 11-03·QCOM 11-04 발표 뒤 8-K EX-99.1 실제값으로 지표 8·9(보관 노트 수정 금지).

## 2026-10-28 05:15 — T-101·T-102 운영 반영(사용자 위임 "승인 확인 없이 끝까지 진행하고 결과만")

- **T-101 완료**: 설정 > 안전장치(공통)에 '해외 장마감 후 분석' 스위치(`post_market_overseas_enabled`) 추가 — 05:11 push `61b80c9..5ac9119`(7커밋)·05:13 릴리스 `20261028-051140-5ac91195` ok, `migrated=false`. 키는 **여전히 없음=꺼짐**, 켜는 것은 사용자 몫(켜면 다음 영업일 08:00 KST부터 미국 종목 카드). → [[T-101-settings-post-market-overseas-switch]]
- **T-102 반영**: 대시보드 총자산 "-"(미결제 매수로 KIS 응답이 T-056 검증에 걸려 "해외 예수금 확인 못함") 원인 수정 — 매수증거금을 뺀 순예수금 인식 + 정합 검사 5개 + 환율 범위 100~10,000. 사용자 대시보드 정상화는 배포 직후 첫 조회(또는 KIS 결제 완료)로 확인 대기. → [[T-102-usd-cash-unsettled-buy]]
- **ADP-006 C01**: 표본 선정 D-07(규칙 추첨·코스닥 보조 관찰)·절차서 현행화 반영, (→ 10-28 09:10 정정: 2단계는 10-30 을 기다리지 않고 10-28 에 실행·완료, 아래 최신 섹션). 코스닥100/NYSE 전체가 아니라 앱 분석 유니버스(국내 시총 상위·미국 S&P500 상위 50 정적)에서 뽑는다.
- **운영 실측(T-102)**: 새 프로세스 기동 직후 첫 스냅샷 id 5503(05:12:11) 보류 없이 저장 — USD 순예수금 85.64 + AAPL 3주, 합계 보존. 사용자는 대시보드에서 총자산이 숫자로 돌아왔는지만 확인하면 된다.
- **사용자 확인 별건**: KRW 예수금이 10-27 20:52~22:42 에 3,100,000원 줄었다(스냅샷 5501→5502, 보유 증가 없음 — 출금·이체 추정 [추측]). 입출금 원장(자산 기록)에 기록됐는지 확인 필요, 없으면 킬스위치 낙폭·수익이 손실처럼 잡힌다.
- 킬스위치 ON 유지(11-23 경 판단), 주문 id 3229·최근 3시간 주문 0 그대로. 새 task 번호는 T-103 이상. 문서 전용 변경(이 절·board·20-Log·T-101/T-102 최종 요약)은 로컬 미커밋 — 다음 배포에 동승.
- 후속 후보: 약 5분 일시 과소 계상(증거금 반영 ↔ 보유 목록 갱신 시차)·킬스위치 해제 전 기준선 표시, 앱 환율 교차검증(±30%), PATCH 쓰기 트랜잭션, 카드 안내 "매일 08:00" 과장 문구, 스위치 터치 영역/tabIndex(designer), read_error 화면 경고.

## 2026-10-27 21:50 — 전략 검증 줄기 종결·T-082 수집 완료·T-094 반영(사용자 위임 "승인 없이 권고안으로 끝까지")

- **전략 검증(T-096) 종결**: S1·S7 IS 합격 0, S2·S4 미시험(근거 [[T-096-analyst-s1-failure-and-s2s4-value-20261027]] — 종목 선택 효과 0 + 왕복 비용 0.65%, 같은 검정력 공유, S4 는 v1.1 규칙상 구조적 INSUFFICIENT). 다시 열 조건 = PIT 유니버스(≥150종목) 확장 재등록(v2.0). 신규 매수 경로는 D5 관문으로 닫힌 채 유지, 킬스위치 ON 유지.
- **T-082 나머지 수집 완료**(96호출, `adj_stale` 0행): T-099 수정이 운영에서 의도대로 동작. 후보군 원천·Yahoo 교차검증·정기 증분 cron 은 PIT 확장 결정 때까지 보류.
- **T-094 완료·21:38 운영 반영**(릴리스 `20261027-213849-61b80c96` ok): WP-3 `getAppVersion` 3초 제한(웹)·WP-1/2/5 시험·훅·문서, WP-4 보류.
- **T-100 보유 손실 통제 초안**: 사용자 결정 대기(보고서는 `.gitignore` 로 커밋 제외, 이 서버 `agent-vault/10-Flow/reports/T-100-holdings-loss-control-proposal-20261027.md`). **자동 청산 두 스위치(`exit_engine_enabled`·`exit_hard_stop_enabled`)를 켜지 말 것** — 보유 3종목이 전부 하드손절 1.5% 에 걸려 다음 미국장에 전량 시장가 매도가 승인 없이 나간다. USD 예수금 약 $800 감소(10-26 17:28~19:29, 앱 주문 0건) 원인 사용자 확인 필요.
- **일정 대기**: 11-02 이후 D1b 백필·수집 실패 알림 결정(브로커 체결 원장 7일치) · 11-23 경 킬스위치 해제 판단 · 12-07 `rsi-oversold-v1`(30분 룰) `enabled=0` 판단.
- **새 task 번호는 T-101 이상**(T-100 사용). 로컬 `main` 은 이 기록 커밋 1개가 origin 보다 앞설 수 있음(문서 전용은 다음 배포에 동승).

## 2026-10-26 15:39 — "다음 작업" 목록 Q1~Q6 사용자 결정 반영(전략 검증 줄기 시작)

사용자 발화 그대로: "Q1: 승인 / Q2: 킬스위치는 페이즈1 이후에 4주정도 분석내역 지켜본 후에 결정하자 / Q3: 권고대로 진행해줘 / Q4: 권고대로 1주 관측 후에 진행하자 / Q5: Q3 이후에 진행하도록 절차 만들어줘 / Q6: 권고대로 진행해줘 / 작업은 지금 바로 진행해줘".

- **Q1 Phase 2 — 종결(원인 확정)**: 평일 저녁 USD 0 의 원인은 **외화RP 자동매매 서비스**(한국투자증권 — USD 를 매일 외화RP 로 자동 매수·익 영업일 자동 매도), 사용자가 주말에 해제함(18:55 확인). 17:10 KIS 캡처·17:28 앱 스냅샷 모두 USD 정상. 근본 수정·대칭 보정 불필요, Phase 1 은 안전망 유지, 재가입 시 재발 가능(외화RP 잔고 집계 task 후보). 상세 [[T-080-killswitch-usd-misread]].
- **Q2**: 킬스위치는 **ON 유지**, 해제 판단은 Phase 1(10-25 배포) 이후 약 4주 관측 뒤 **2026-11-23 경**. 그날 근거(Phase 1 보류 알림·킬스위치 상태·야간 USD 가림 빈도)를 Leader 가 제시. Phase 2 는 이제 킬스위치 해제의 선행 조건이 아니라 USD 집계 정확도(T-081 D-2 달러 칸·월 지표)의 선행 조건.
- **Q3 = A 전략 검증 줄기 시작**: ⚠ **정정 — "T-070 Analyst 검토"는 이미 2026-10-24 에 끝나 있었다**([[T-070-daily-bars-phase0]] `## Analyst 검토`; 세션 메모리가 낡아 "검토 진행 중"이라고 잘못 적혀 있었다). 실제 줄기는 그 검토의 P1~P5: **P1 = [[T-095-postmortem-script-p1]] 진행 중**(사후검증 스크립트 보강 — 환율 무관 진입·D+10 구간·같은 날 유니버스 기준선·가격 없음 라벨·가정 명시, 결정 불필요·DB 쓰기 0), P2 합격 기준 사전 등록(사용자 확정 필요 — P1 지표 정의 뒤 초안), P3 T-064 Phase 2 일봉 백테스트(**토큰 큼 — 착수 전 범위·예상 사용량 고지 + 사용자 착수 승인**), P4 자본·유니버스 정합(사용자 결정 — 슬롯 10만 상향 vs 1주≤슬롯 종목만 vs 미국 저가 유니버스), P5 전략 ID 정리(`oversold-bounce-v1` ↔ `oversold-bounce-daily-v1`).
- **Q4**: D1b 백필·수집 실패 알림은 **1주 관측 뒤(2026-11-02 이후)** — [[T-087-wpd-d1a-broker-fills-collect]] `waiting` 갱신. 그날 `broker_fill_runs` 7일치 요약을 근거로 제시.
- **Q5**: [[T-094-app-auth-followups]] 작성 완료(**착수 안 함**) — 앱·인증 후속 5건(WP-1 login-screen 시험 조이기·WP-2 header-safe 훅 감시·WP-3 `getAppVersion` 시간 제한(웹 배포)·WP-4 build-apk 부모 activity 검사·WP-5 N1·N2 문서·시험). 착수 조건 G0: Q3 줄기 종료 보고 + 사용자 "T-094 착수". 해석 "Q3 이후 = Q3 줄기 종료 보고 이후"(틀리면 정정).
- **Q6**: T-083 R01 상태 문서 동기화·보드 낡은 줄 정리·T-042/T-044/T-038/T-039 실제 상태 대조(문서 전용, 서브에이전트) 진행 — 결과는 T-083 `## Leader 기록`. R04(삭제 필요 항목: 루트 `NUL`·낡은 stash)는 삭제하지 않는다. T-039 착수 여부는 결과를 보고 별도로 묻는다.
- **P4 지시(주가 기준 사이징)**: [[T-097-price-first-sizing]] — 영향 조사 완료, 사용자 설계 결정 Q-A~Q-E 대기(구현 안 함). 핵심 [확실]: 슬롯(10만 원)은 1회 한도(자산의 4%)에서 나오며 최소 1주를 허용해도 1회 한도가 막아 MU·국내 50만 원대는 안 풀린다. 전략 16개 `unvalidated`·킬스위치 ON 이라 어떤 규칙이든 지금 앱 매수는 집행되지 않는다.
- **P2/P3**: [[T-096-strategy-validation-p2-p3]] — **Analyst 1단계 완료**(초안 `docs/design/2026-10-26-strategy-validation-preregistration.md` v0.1: 사용자 확정 U1~U14·P3 명세·규모 추정 코드 4.5k~6.8k 줄·토큰 약 300~670만 [추측]·"판정 대상 3개 전부 불합격" 확률 55~75% [추측]). 사용자 확정·go 대기. Leader 권고: 단계 go(M1 엔진+S1·S7 먼저). 사용자 질문 "어떤 사용자 등록이 필요해?" 는 "사전 등록"을 "사용자 등록"으로 오해한 것으로 보고 설명함(합격 기준을 결과 보기 전에 고정하는 일, 사용자가 할 일은 초안 확정뿐).
- **새 task 번호는 T-098 이상**(T-094~T-097 사용).
- **세션 상태**: T-095 developer 가 격리 worktree `~/.node-local/stockinvest-postmortem-t095`(브랜치 `postmortem-p1-t095`)에서 작업 중 — 끝나면 Reviewer → judge C2 → QA 순환. 메인 트리 `main` = `53b97d9`(origin 보다 문서 커밋 3개 앞 — 다음 push 에 동승).

## 2026-10-26 14:50 — T-091(앱 1.1.0)·T-092·T-093 모두 운영 반영·사용자 실기기 확인 완료

- **운영 상태**: main `92b86ac` = origin 동기(push 14:07 KST) · 릴리스 `20261026-140750-92b86ac7` ok · 킬스위치 `true`(10-23 22:42 자동 발동 이후 유지, 해제는 사용자 전용) · `safety_dry_run=false` · 주문·거래 로그 id 불변(3229/8305). 로컬에는 **문서 전용 미커밋/미push 변경**(이 기록·task 최종 요약·CLAUDE.md 공개 버전·AGENTS.md 재생성)이 있고 다음 push 에 동승한다 — 문서만을 위한 push 는 불필요한 배포라 하지 않는다.
- **[[T-091-app-version-gate-and-m2]] 완료(실기기 확인 완료, `waiting` 해제)**: WP-A(옛 앱 로그인 화면 "업데이트 필요" 띠, 웹 `9a03245` 12:23 배포) + WP-M2(텔레그램 "앱에서 자세히" 링크 → 앱 열기, 웹 `92b86ac` 14:07 배포·`/.well-known/assetlinks.json` 공개) + **APK 1.1.0(versionCode 3) 14:11 공개**(`app_release` id 3) + 운영 설정 `system_config.app_public_url` = `https://stock.xn--lh0b87pnudm10a4vd.com/`(끝 슬래시 필수, 14:12) + 텔레그램 자가 점검 메시지 14:12 발송(messageId 3840). **이제 실제 승인 요청 메시지에도 "앱에서 자세히" 버튼이 붙는다**(끄려면 `app_public_url` 행 삭제).
- **사용자 실기기 확인 완료(14:50)**: 1.1.0 설치 → 텔레그램 점검 확인 통과 → 재발송한 시험 메시지(3841)의 "🔗 앱에서 자세히" 탭 → 앱이 열리고 대시보드 정상. T-091 `waiting` 해제. 남은 잠재 위험: 안드로이드 15+ 주기적 재검증(풀리면 링크가 브라우저로 열림 → `adb shell pm verify-app-links --re-verify com.miraclepenguin.stockinvest`). adb 출력 확인은 사용자가 생략.
- **[[T-093-hook-safety-paths-auth-tests]] 완료**: 훅 SAFETY_PATHS 에 감시 밖 인증 시험 15개 + `login-screen-t088` 시험 + `mail/config.ts`(정확 일치 17줄, 50→67항목), 커밋 `eba6610` 13:58 main(훅 즉시 활성, 14:15 설치된 훅 확인), push 14:07 와 함께 반영. 한계: login-screen 시험은 T-089 이전 원문 회귀를 못 잡음.
- **후속 후보(T-094 이상, 권고: 실기기 결과를 본 뒤 결정)**: ① `login-screen-t088` 시험 조이기 + `mail/header-safe.ts` 훅 감시(훅 후보 1순위) ② 앱 `getInfo` 조회 시간 제한(끝내 응답 없으면 Google 자리가 비어 있음) ③ `build-apk.sh` 의 부모 activity·exported·launchMode 검사(Codex low) ④ T-091 Reviewer N1(소스 가드 `code()` 한 줄)·N2(deploy-order 순서 문장 분리) 비차단 보강.
- **사용자 결정 대기(이전부터)**: 원장 D1b 백필(KIS 약 35~42건 읽기, 새 task) · 수집 실패 텔레그램 알림 · 훅 `SAFETY_PATHS` 추가 후보 4개(보류 권고).
- **새 task 번호는 T-094 이상**(T-091·T-092·T-093 사용).
- **worktree·임시 디렉터리 정리 완료(14:16)**: 저장소 worktree 는 메인 트리 하나, 브랜치는 `main` 하나, `~/.node-local/` 의 StockInvest 용은 `stockinvest`·`stockinvest-apk`(기본 APK 작업 디렉터리)만 남았다. 낡은 임시 디렉터리 10개(약 8.9GB)는 앞서 정리했다.
- **세션 위생 기록**: 14:13 `kis_access_token`(24시간, 19:06 KST 만료)이 세션 기록에 한 번 찍혔다(외부 전송 없음, 임시 파일에서 제거). 배포 기준선은 앞으로 `kis_access_token`·`cred_*` 둘 다 제외하고 값은 출력하지 않는다.

## (낡음 — 위 14:17 항목이 최신) 2026-10-26 11:45 — T-092 완료(훅 인증 구현 감시, 로컬 병합) · T-091 WP-A 완료(웹 전용, 격리 브랜치·미push) · WP-M2 미착수

- **[[T-092-hook-safety-paths-auth-impl]]**: 훅 `SAFETY_PATHS` 에 인증 관련 구현 6곳(+시험) 정규식 10줄 추가 — 새로 걸리는 추적 파일 10개(`signup-gate`·`signup-request`·`mail/send`·`safe-next-path` 와 각 시험, `profile/password/`, 미들웨어 공개 경로 시험). 속도 제한 `*-gate.ts` 는 제외 유지. 로컬 커밋 `945ba0c` 가 11:43 main 에 병합돼 **이 서버에서는 이미 활성**(설치된 shim 경유 확인). **origin 에는 없다(push 대기 — 급하지 않음, 문서·스크립트뿐)**. 사용자 결정 대기: 아직 훅 밖인 후보(`auth/__tests__/` 시험 15개·`login-screen-t088.test.ts`·`mail/config.ts`·`header-safe`·`signup-request-mail`·`profile/route.ts`) — AI 권고는 시험 15개+`login-screen-t088`+`mail/config.ts` 를 묶어 다음 task 로, 나머지 보류.
- **[[T-091-app-version-gate-and-m2]]**: 사용자 결정 "t-091은 권고대로 진행해줘"(M2 에 포함) + 데모 승인 "T-091 데모 v1 의 B. 옛 앱 로그인 화면은 B안으로 진행해줘"(대안 B: 화면 위 경고 띠 + Google 버튼 비활성). **WP-A(웹 전용)**: 앱이고 설치 build 가 필요 최소(2) 미만일 때만 로그인 화면 맨 위에 "앱 업데이트가 필요합니다" 띠 + 비활성 Google 버튼(웹·새 앱·버전 모름은 변화 없음) — 구현·Reviewer 2라운드·Codex 0건·QA(실제 브라우저 11시나리오) 통과, 로컬 커밋 `7844a91`(브랜치 `app-gate-t091`, worktree `~/.node-local/stockinvest-app-gate-t091`, **main 미병합·미push — 웹 push 가 곧 배포라 사용자 승인 대기, 장외 창 15:40~22:20 KST 권고**). 표 값 `googleLogin: 2` 가 공개 APK 1.0.1 과 일치해 지금 배포해도 막다른 길 없음. **WP-M2(App Links)는 미착수 — 사용자 결정 대기**(task T-091 "WP-M2 착수 전 사용자 결정·몫" 4항: M2-0 예측 시험·시험 APK 1.1.0·assetlinks 서빙 방식 middleware 권고·착수 시점/수익 연결).
- **새 task 번호는 T-093 이상**(T-091·T-092 사용).
- ⚠ **T-091 이 `src/middleware.ts` 를 고치게 되면(M2 assetlinks) Reviewer 판정 scope 에 `src/middleware.ts` 와 `src/__tests__/middleware-public-paths.test.ts` 를 둘 다 적어야 훅이 통과**(T-092 로 후자도 감시).
- worktree 상태(11:48): T-092 worktree·브랜치 `hook-auth-impl-t092` 는 병합 완료라 **정리했다**. **`~/.node-local/stockinvest-app-gate-t091`(브랜치 `app-gate-t091`, 커밋 `7844a91`)는 T-091 push 승인 전이라 보존** — `node_modules`(`npm ci` 로 설치한 실제 디렉터리, 정리 때 `rm -r`)·`.next` 94MB 포함. 저장소의 worktree 는 메인 트리 + 이것 하나.

## 2026-10-26 09:05 — T-090 완료: 커밋 훅이 인증 API(`src/app/api/auth/`)를 감시 — push·운영 배포 완료

- **[[T-090-hook-safety-paths-auth-routes]]**: `SAFETY_PATHS` 에 `'^src/app/api/auth/'` 추가(새로 걸리는 파일 11개) — 이제 `app-exchange`·`[provider]`·`login`·`signup` 등 세션 발급 입구 수정은 Reviewer 판정 줄이 없으면 커밋이 막힌다. 로컬 커밋 `53509bd` 를 08:18 main 에 병합했고 **이 서버에서는 이미 활성**(설치된 shim 이 메인 트리 훅을 실행 — 08:19 확인). **09:02:57 사용자 지시("푸시 진행해줘")로 push·배포 완료**(`3cc7418..784151b`, 릴리스 `20261026-090312-784151b3` ok, migrated=false — 국내장 개장 직후였지만 킬스위치 ON·최근 3시간 주문 0건 확인 후 진행, cron 1행·79키·감사 로그 id 불변). 이 기록 갱신용 문서 전용 커밋은 origin 에 올리지 않았다(다음 코드 push 에 동승). 앱·웹 동작 변화 없음.
- **새 task 번호는 T-091 이상**(T-090 사용) — 11:45 정정: 지금은 **T-093 이상**(위 최신 절).
- **~~새 사용자 결정(T-090 에서 파생)~~ — 해소(10-26: "나누지 말고" → [[T-092-hook-safety-paths-auth-impl]] 로 6곳 한 번에 추가)**: 훅 밖에 남은 인증 관련 파일 — `src/lib/auth/signup-gate.ts`·`signup-request.ts`·`src/lib/mail/send.ts`·`src/lib/safe-next-path.ts`·`src/app/api/profile/password/`·`src/__tests__/middleware-public-paths.test.ts` 를 별도 task 로 넣을지(권고: 앞 셋은 검토, 나머지 보류).
- **~~T-091 후보(미착수)~~ — 착수됨(위 11:45 절: WP-A 완료·WP-M2 미착수)**: 옛 앱 버전(1.0.0)이 새 웹을 받는 버전 어긋남 방지 — 웹이 먼저 배포돼 옛 앱에도 Google 버튼이 보였고 딥링크 수신 설정이 없어 첫 로그인이 무응답이었다([[T-088-app-google-login]] ⑫ 의미 3). 권고: M2(App Links) 때 같이 처리.

## 2026-10-26 06:52 — 앱 런칭 완료: T-084 M1·T-088 앱 Google 로그인·T-089 오픈 리다이렉트 차단 (사용자 실기기 확인 완료)

- **운영 반영(05:21~05:30 KST)**: T-089 `6d6efc0`(릴리스 `20261026-052150-6d6efc09`) → 운영 DB `app_auth_code` 적용 → T-088 `1b379ac`(릴리스 `20261026-052603-1b379acc`) → APK **1.0.1(versionCode 2)** 공개와 `app_release` INSERT. 안전장치 스위치·감사 로그 배포 전후 불변, cron 1행. 사용자 검증: "실기기에서 앱설치해서 로그인 검증완료했어"([[T-088-app-google-login]]) · "T-084에 대한 확인도 완료했어"([[T-084-mobile-app-m1-shell]]). T-089 는 [[T-089-open-redirect-next-path]].
- **앞선 원장 작업 일시 중지의 재개 조건("앱 런칭 뒤")이 충족됐다.** 재개 문구 "StockInvest 작업 이어서 진행해줘", 진입점 [[RESUME]] — 제일 먼저 10-26 07:20 이후 `broker_fill_runs` 의 cron run 확인. 새 task 번호는 T-091 이상(08:21 정정 — T-090 은 훅 작업이 사용).
- **사용자 결정 보류**: ~~커밋 훅 `SAFETY_PATHS` 에 `^src/app/api/auth/` 추가 여부~~(해소 — [[T-090-hook-safety-paths-auth-routes]] 로 추가됨) · 이번 작업 것이 아닌 `~/.node-local/stockinvest-*` 10개(약 9GB) 삭제 여부. 후속: T-084 의 M2 App Links→M3 앱 잠금→M4 푸시 · T-088 후속 후보(Codex 지적: 앱 state 만료·쿠키 유실 시 웹 `invalid_state`, 화면 시험 공백).
- 정리(06:08): 임시 복사본 25개·worktree 3개·브랜치 3개·깨진 Synology ref 삭제 — 저장소 worktree 는 메인 트리 하나(다음 작업은 새 worktree 로).


## ⏸ 2026-10-25 23:45 — StockInvest 원장 작업 일시 중지(앱 런칭 뒤 재개 → 위 06:52 항목: 재개 가능) — 재개 지점은 [[RESUME]] 맨 위

- T-081 WP-D D1a 까지 운영 반영 완료([[T-085-safety-paths-broker-ledger]]·[[T-086-d0-unmatched-sell-cost-basis]]·[[T-087-wpd-d1a-broker-fills-collect]]). **수집 스위치는 ON 으로 두었다** — 매일 07:20 KST 이후 읽기 전용 자동 수집이 돈다(멈추는 방법은 RESUME). 킬스위치 ON·주문 0건 불변.


## 2026-10-25 23:30 — T-081 WP-D D1a 브로커 체결 원장 수집 가동 ([[T-087-wpd-d1a-broker-fills-collect]])

- 국내·해외 일별 체결·기간 실현손익·보유 잔고를 KIS 조회 API(읽기 전용)에서 매일 07:20 KST 이후 받아 새 테이블 5개(`broker_*`)에 쌓는다. 어디에도 연결하지 않았다(표시·판정 불변). 스위치 ON(23:24), 첫 자동 실행은 10-26 07:20 이후.
- 함께 반영: [[T-085-safety-paths-broker-ledger]](커밋 훅이 `src/lib/broker-ledger/` 감시) · [[T-086-d0-unmatched-sell-cost-basis]](거래 리포트가 원가 모르는 매도를 이익으로 세지 않음 — 앱이 다시 매도할 때까지 눈에 띄는 변화 없음).
- 다음: 첫 크론 실행 확인 → 사용자 결정(D1b 백필·실패 알림) → D2 교차검증. 킬스위치 ON 유지(10-26 17:10 캡처 후 T-080 Phase 2).


## 2026-10-25 — 모바일 앱 "주식캐기" M1 배포·APK 공개 완료, 사용자 실기기 확인 완료(10-26) ([[T-084-mobile-app-m1-shell]])

- 운영 웹을 그대로 띄우는 Capacitor 안드로이드 앱(appId `com.miraclepenguin.stockinvest`, v1.0.0)과 앱 업데이트 안내를 배포했다. 코드 `46d4148`·문서 `b435399`, 20:53 KST push(webhook blue/green), 릴리스 `20261025-205329-b4353994`, `RELEASE_RESULT ok`. 정본 절차서는 [`docs/mobile-app-procedure.md`](../../docs/mobile-app-procedure.md)(v3), 배포 절은 [`docs/deploy-order.md`](../../docs/deploy-order.md) "앱(APK) 배포".
- 운영 DB 에 `app_release` 테이블 생성(DDL 20:51, 사용자 승인)·APK 공개 파일 `shared/app-releases/stockinvest-1.0.0.apk`(2,990,678 B, sha256 `ab7d5901…a225`)·`app_release` 1행 INSERT(20:59). 공개 도메인 `…/app/download/latest.apk` 200·sha·서명 지문 일치 확인. **실매매 영향 없음**(주문·청산·승인·cron·safety 코드 변경 0, 배포 전후 스위치 동일 — 킬스위치 ON·`safety_dry_run=false`·`exit_engine_enabled=false`, 감사 로그 id 불변).
- **다음 재개 지점**: ① ~~사용자 실기기 확인~~ — **완료(10-26)** ② 후속 M2(텔레그램 링크→앱 App Links, 서명 지문 `6fa5ad6f…0f08` 확정됨)→M3(앱 잠금)→M4(푸시 FCM — `/신규도입` 검토·Firebase 준비·DB 마이그레이션 승인 필요) ③ ~~잠복 결함 2건(`android/gradlew` git 모드 100644, 기본 APK 작업 디렉터리의 옛 빌드 캐시)~~ — T-088 에서 수정 완료 ④ 미들웨어 공개 경로 시험의 SAFETY_PATHS 편입(사용자 결정, 훅 수정은 타 세션 작업이 끝난 뒤).
- 서명 키(전용): `~/.android/stockinvest-release.keystore`·`stockinvest-signing.env`(권한 600), 백업 `NFS/homes/brownjeon/backup/android-signing/stockinvest/`. **분실 시 덮어쓰기 설치 불가.**

## 2026-10-24 — T-064·T-077 통합 작업절차서 완료 (T-078)

- 실행 정본은 `docs/design/2026-10-24-integrated-execution-procedure.md`다. [[T-078-integrated-execution-procedure]]에서 기존 연구·검증과 최신 계좌 운용 정책을 S00~S09 한 순서로 합쳤다. T-064/T-077 원문은 근거/이력이며 Phase/A 단계를 별도 실행하지 않는다.
- T-064 D1~D20을 통합 §9 C01~C10과 연결했다. 시점 데이터·H1~H5·체결/비용·과적합·OOS/전진·운영 실패 대응을 보존하고 최신 월5%/매수 독립·점수 축소·3개월 승인/재알림과의 충돌을 해소했다.
- 기존 보유 H와 신규 매수 N을 구분한다. H 관리가 매수 알파 합격 대기로 묶이지 않게 하되 안전/운영 검토를 유지하고, N은 전체 정책의 필수 과거/전진 증거와 검증 관문을 충족해야 한다. 주문 없는 관측은 실제 매수 승급과 다르다.
- 독립 문서 검토 보완 3건(관측/실매수 승급, 비용/주기/정밀도 선결, 운영 실패 조치) 반영·재검토 완료. 다음은 Claude에서 S00 대조 보고서와 단일 실행 원장 작성이다. 시작 지시문은 통합 §12/인수인계 §7에 동일하게 있다.
- 문서 작업만 완료했다. 실제 계좌/운영 조회·소스/설정·주문/취소·알림·커밋/push·배포는 하지 않았다. 통합 착수 HEAD는 `e0aadadf1604a15b269a6c2a240eefa2b778b400`이며 현재 상태는 S00에서 다시 확인한다.

## 2026-10-24 — 개편안·Claude 인수인계 문서 완료 (T-077)

- [[T-077-portfolio-restructure-handoff]]는 문서 작업 완료. 본문은 `docs/design/2026-10-24-portfolio-restructure-plan.md`, 재개 진입점은 [[2026-10-24-claude-restructure-handoff]]다. 핵심 인터뷰는 [[2026-10-23-project-direction-interview]]에 보존했다.
- 요구 추적표·기존 정책 대체 관계·코드 재사용 위치·공동 예산/슬롯과 매도 수량 선점·월 손실 재평가·기한/연장 승인·미응답 재알림·A0~A7 단계와 수용 기준을 작성했다. 투자 수치·점수식은 검증할 제안/운영 전 결정 목록으로 구분했다.
- 독립 문서 검토의 보완 3건(동시 매도, 현금 스냅샷 정합, 조건부 매수 만료)을 반영하고 재검토에서 추가 지적 없음. 이는 코드 감사·수익성·운영 QA 완료가 아니다.
- T-078 통합 전 A0 단계는 현재 통합 S00으로 대응한다. 최신 코드·배포·안전 설정·보유/시장 자금·원가/현금 대사, 기존 T-071/T-072/T-074/T-076 남은 범위 확인을 단일 원장에서 진행하며 별도 A0 작업 큐를 만들지 않는다. 이미 답한 인터뷰를 반복하지 않는다.
- 기준 HEAD `330314e545b5dbfa1c9523ea68f134cc91bb2042`, 다른 작업의 미커밋 변경이 다수였다. 이번에는 문서와 judge JSON만 작성/갱신했으며 실제 DB/API 계좌 조회·소스/설정 변경·주문/취소·알림·커밋/push·배포는 하지 않았다.

## 2026-10-23~24 — 프로젝트 방향 인터뷰 요구 정리

- 사용자와 수익 목표·운용 권한·투자 범위의 핵심 요구를 정리했다. 확인된 요구와 후속 설계 결정은 [[2026-10-23-project-direction-interview]] 참조.
- 사용자 진술 기준 현재 약 1,800만 원을 추가 자금 없이 재편하고 기존 보유 전부를 관리한다. 추가 지시 "지금의 잔고 비율로 유지"에 따라 미국·국내의 현재 자금 배분을 기준으로 각 시장 한도 안에서 운용한다. 실제 금액·비율은 미확인이며, 평가 비율 변화만으로 시장 간 자금을 자동 이동하지 않는다. 개별 종목 비중 고정이나 예시 배분 비율의 채택을 뜻하지 않는다.
- 동시 보유는 미국·국내 전체 계좌 합산 최대 10종목으로 사용자 확정. 기존 보유와 ETF를 포함하며, 적합한 기회가 적으면 더 적게 보유한다.
- 새 분석에 따른 추가 매수도 종목·시장 한도 안에서 자동 허용한다. 사용자 요구로 **복수 매수 시그널의 공유 예산 배분·중복 예약 방지·분석 평가에 따른 금액 조정**을 새 설계 요건에 추가했다. 점수식·배분 비율·한도 수치는 미정이며 구현하지 않았다.
- 서버와 AI 구독료는 비용 검토에서 제외한다. **기존 웹검색·공식 원천 조회로 데이터를 먼저 집계한 뒤 유료 사용 여부를 결정**하며, 사용자 지시로 유료 서비스 설명을 마치고 다음 인터뷰 주제로 진행한다.
- 통상 매수·매도·관망은 자동, 운용 기준 밖은 사용자 승인. 월 손실 5%는 관리 목표이며, 도달 시 재평가해 조정이 필요하거나 지표가 나쁘면 매도한다. 신규·추가 매수는 그 시점에 별도로 판단하며 월 손실률에 따른 일괄 중지안은 채택하지 않았다. 공유 예산·집중도 한도 등은 계속 적용한다. 전망에 근거한 보유 예외와 종목별 최대 3개월 운용 기준은 유지하며, 판정 항목·임계값·매도 규모·세부 예외/종료 규칙은 미정이다.
- 사용자 경험: 추천 확인 시 가격 상승/매수가 미도달로 진입을 놓쳤고, 일부 놓친 시그널 종목의 이후 하락이 반복돼 분석 신뢰도도 낮아졌다. 후속 답변에서 조건부 매수 추천이었으며 약 3일 안에 하락했다고 설명했다. 구체적인 조건 충족 여부·낙폭·장기 가격 경로는 미확인이다.
- 요구사항 인터뷰와 문서 기록 단계다. 기존 구현안의 포괄 승인이나 실거래 활성화를 뜻하지 않으며, 이 세션에서 코드·운영 변경은 실행하지 않았다. 아래 과거 상태의 현재 적용 여부는 별도 확인이 필요하다.
- 2026-10-24 사용자 결정: 기존 보유가 앞으로 정할 종목·업종 한도를 초과하면 **조정 대상 종목을 분석·점수화하고 점수에 따른 우선순위로 점진적 자동 축소**한다. 한도 초과 해소에 기여하는 후보를 추린 뒤 '축소 우선순위 점수'가 높은 순서로 줄이고, 체결 후 다시 평가하는 구조를 제안했다. 점수 방향·가중치·한도 수치·축소량은 구체화/검증 전이다. 미국·국내 자금 배분 유지 합의는 그대로이며, 실제 점수 산출·주문·코드/운영 변경은 하지 않았다.
- 2026-10-24 사용자 결정: 종목별 **3개월 만료 후 보유 연장은 직접 승인**, **기한 내 미응답이면 보유하며 재알림**한다. 재평가 결과 매도·축소가 필요하면 합의한 기준 안에서 자동 처리하고, 연장이 타당하면 근거와 제안 기간을 제시해 승인받는다. 승인 대기 중에도 기존 재평가·매도 기준과 안전장치는 적용한다. 미응답을 자동 승인이나 자동 정리 사유로 취급하지 않는다. 기산일·추가매수 시 기간 계산·연장 기간/횟수·거절 시 처리·재알림 간격/채널 등은 미정이다. 실제 알림 발송·예약 작업 생성·운영 변경은 하지 않았다.

## 2026-10-22 — 수익화 감사 보고 완료 (운영 변경 없음)

- [[T-067-profitability-audit]]: 사용자 요청으로 종목분석 개선 문서·소스를 순수익 관점에서 감사. 상세 [리포트](Z:/project/StockInvest/docs/reports/2026-10-22-profitability-audit.md).
- [확실] 원본 함수 모의 실행에서 해외 부분체결의 전량체결 오판·추적 종료, 백테스트 보유 중 낙폭 누락을 재현. 장부의 체결가/비용/통화/이월원가와 성과·사후검증 경로 문제도 확인.
- 현재 운영 DB·KIS·실발생은 재조회하지 않음. 기존 문서의 설정·계좌 수치는 해당 기록 시점 한정. 소스·설정·주문·배포 변경 없음. 결함 수정은 미착수.
- 권고 우선순위: 체결·손익 장부 복구 → 미국시장 입력·비용 계약 → 측정 체계 → 최소 전략 OOS·전진 검증. 아래 오래된 상태를 현재 실측으로 간주하지 말 것.
- [18:14 추가] 사용자 후속 확인을 [[T-067-profitability-audit]] 보고서 §8에 반영: 부분체결은 진행 중, 시간 초과 잔량취소는 확인 뒤 부분종결·실체결 대사. 현행 취소 경로 결함도 추가 확인. 미국 수수료는 매수·매도 각 0.25% 확정이며 장부 미반영이 P0. 문서만 보완, 코드·운영 미변경.
- [20:11 범위 정정] 사용자 지시로 [[T-068-risk-policy-followups]]의 현금 정보화·분할 정렬·손절 알림 관련 개선 요구를 이번 감사에서 제외. F06은 배경/보류로 변경하고 보고서 §9에 구현 후 재검토 조건 기록. P0 주문·장부 결함은 T-068과 별개라 유지. T-068 자체 상태·작업물과 운영은 변경하지 않음.

## 🟠 2026-09-22 — 착수 대기 2건 (워크스페이스 세션이 조사·작업서 작성)

- [[T-038-llm-base-url-setting]] — `system_config.home_m4_api_base` 가 옛 주소 `http://192.168.219.163:8001` 이라 **hybrid 1단계 AI 필터가 08-19 이후 매번 실패 → legacy 로 대체** 중. 설정 화면은 hybrid 에서 주소 칸을 숨긴다(`LlmProviderSection.tsx:197`). 적용은 **장 마감 후**(매매 판단 경로가 바뀜).
- [[T-039-alert-dup-and-telegram-timeout]] — 09-22 11:49 재배포 때 앱이 두 번 기동하며 in-memory 스로틀이 초기화돼 `🔕 자동 청산 OFF` 알림 2건 중복(**실주문 0건 확인**). 별개로 텔레그램 간헐 ETIMEDOUT(오늘 49건)으로 **승인 요청이 유실**되고 있다.
- 09-22 `AI_API_KEY` 재발급(게이트웨이 미등록이었음)·11:49 재배포 완료 — RAG 401 해소. 보유 000660(-27%)·005930(-15%)는 하드손절 조건 충족 상태이나 `exit_engine_enabled=false` 로 자동 매도 없음.

## 🔴 2026-08-27 — 운영 중단 발견: `stockinvest-cron`이 죽은 채 pm2는 "online"으로 표기

[[T-036-news-fetch-observability]] 조사 중 부수 발견. **자동매매가 2026-08-24 23:38 이후
2일 11시간 멈춰 있었다.**

- `pm2 jlist` → `stockinvest-cron`: `status=online` 이지만 **`pid=None`**, `ps`에 `cron-runner.sh` 없음.
- 마지막 cron 로그: `~/.node-local/stockinvest/logs/cron-out.log` `2026-08-24 23:38:28`.
- 멈춘 것: `entry-watcher`(**진입 도달 시 자동 주문 실행**)·`holding-checker`·`strategy-eval`·
  `signal-followup`·`signal-expiry`·`portfolio-snapshot`·`trade-report` **전부**.
- 같은 유령 상태: `n8n`, **`webhook-deploy`** ← 08-19·08-23 두 차례 관측된 "webhook 미발화"의 원인.
- 앱 본체(`stockinvest`, pid 7705 next-server)는 **정상** — `/api/health` 200, 3003 리스닝.
- **기동은 자금이 걸린 자동주문을 되살리는 행위라 에이전트 판단으로 실행하지 않았다 — 사용자 승인 필요.**
- 워크스페이스 메모리의 기존 gotcha(`pm2 "online"≠실제 응답`, 2026-08-22 HOME-SERVER)와 **동일 실패모드 재발**.
  pm2 유령이 3개 프로세스에 걸쳐 있으므로 **근본 대응은 HOME-SERVER(인프라) 소관**이다.
- **2026-08-27 완결**: 사용자가 직접 재기동 완료(10:51:23, pid 1193580).
  [[T-037-cron-outage-impact-and-watchdog]]가 후속 조사·재발방지를 마쳤다 — **실매매 피해 0건**
  확인(만료 시그널 뒤늦은 오발주는 구조적으로 불가능함을 코드로 확인). **원인은 2단**: ①08-24
  23:39 호스트 급사(원인 불명, OOM 아님) ②08-25 09:54 재부팅 시 pm2가 NFS 마운트보다 11초 먼저
  떠 fork 모드 `stockinvest-cron`이 `spawn ENOENT`로 영구 유령화 — **08-22부터 재부팅마다 반복돼
  온 구조적 결함**이고 `check-and-recover.sh`가 이를 놓치고 "전체 정상"으로 오판정했다(원인은
  이미 그 스크립트 헤더 주석에 적혀 있었음 — 대응이 우회책이었을 뿐). **재발방지 워치독**
  (`scripts/cron-runner.sh` 하트비트 + `src/instrumentation.ts`/`src/lib/ops/cron-watchdog.ts`,
  자금경로 완전 격리) 구현·Reviewer PASS·QA 검증통과까지 완료, **배포는 사용자 승인 대기**(빌드+
  cron 먼저 재기동→앱 재기동 순서 필요). HOME-SERVER 소관 근본원인(pm2 서비스 유닛 순서 —
  `RequiresMountsFor` 필요, 등록부 스키마 확장, 상시 순찰 전환) 3건은 diff 제안만 하고 별도
  세션 인계 권고. `scripts/.nfs*` 잔여파일 2개(08-19 생성, 이번 건과 무관) 정리 여부도 사용자
  판단 필요. 상세는 task 파일 "최종 요약" 참조.
  > **2026-08-27 오후 추가 — 빌드 실패 재순환 완료**: 커밋(`a8dab3a`) 후 사용자가 실배포 중
  > `npm run build`가 webpack 에러(mysql2→crypto 미해석)로 실패하는 것을 발견 — `middleware.ts`
  > 존재로 `instrumentation.ts`가 Edge용으로도 컴파일되는데 기존 가드가 "조기 return" 형태라
  > webpack이 죽은 코드로 못 지워 Edge 번들에 Node 전용 의존성이 남던 것. `src/instrumentation.ts`
  > 1개 파일만(양수조건 `if` 블록으로 교체) 수정해 해결. Developer→Reviewer PASS→QA ✅ 검증
  > 통과 재순환 완료, 격리 클론에서 3자 모두 독립적으로 build/test/typecheck 재현. **이 수정은
  > 아직 커밋되지 않았다** — 다음 커밋 시 `a8dab3a` 위에 반드시 함께 포함해야 한다. 상세는
  > task 파일 "최종 요약 추가" 절 참조.

## ✅ 2026-08-27 — [[T-036-news-fetch-observability]] 완결(사고로 삭제 후 재구현): news-fetch 107일 무성 실패

[[T-031-news-fetch-m4-500]](done으로 승계 종료) 후속. **마지막 성공 2026-05-13, 이후 107일간
매일 실패했고 아무도 몰랐다** — 실측 누적 실패 12,060건 / 성공 2건.

- **근본원인(home-m4-api 소유, 이번에도 미수정)**: Redis에 `kbcoll:<name>` 메타가 없고 Qdrant에는
  컬렉션이 있는 불일치 상태에서 `create_collection`이 Qdrant **409**를 받는데, 이는 `ValueError`가
  아니라 `UnexpectedResponse`라 미포착 → 500. 배포본 트레이스백 줄번호가 NFS 사본과 일치함을 대조
  확인. **409만 삼켜서는 안 고쳐진다** — `upsert_items`가 메타를 다시 조회해 502가 된다. Redis 메타를
  Qdrant 실체로부터 복구(reconcile)하는 것이 옳은 수정. → 직접 고치지 않고 제안서를 main 경유 인계,
  아직 미해결.
- **현재 우연히 잠복 중**: 08-27 09:24경 M4 Redis가 재시작되며 RDB(04-26 메타)를 재적재해 200이
  나온다. uvicorn은 08-19 이후 재시작 없음 — **코드는 안 바뀌었다. 회복이지 수정이 아니다.**
- **실피해**: 뉴스 KB가 `ingested_at` 기준 **2026-05-12에 얼어붙어 있었다**(`news.kr_market` 70건 중
  67건이 05-12). `src/lib/rag/retrieval.ts`가 이걸 전략 분석 RAG 입력으로 먹인다.
- **StockInvest 쪽 수정(완료)**: news-fetch를 `/api/cron/news-fetch` 라우트로 이관(시장별 최대
  3회 재시도+타임아웃+`sendAlertThrottled` 실패 알림), news-fetch·export-llm-trainset 둘 다
  날짜파일 성공/실패 무관 무조건 기록으로 재시도 폭주(실측 누적 약 18,600건) 해소,
  export-llm-trainset NFS noexec `bash` 경유 실행 수정.
  > **2026-08-27 사고·재구현**: T-037 커밋(`a8dab3a`) 직후 `webhook-deploy` 자동발동이 이
  > task의 최초 미커밋 구현을 전부 삭제 → 신규 leader가 이미 커밋돼 살아남은 원인분석을
  > 근거로 task 이력서 재작성, Developer→Reviewer PASS→QA ✅ 검증통과 전체 순환을 같은 날
  > 다시 완주(세 역할 모두 독립 `~/.node-local/` 클론에서 build 재현). 126 suites/2221 tests.
  > **git commit/push는 사용자 승인 대기.** 상세는 task 파일 "최종 요약" 참조.
- 🟠 **별건, 미해결**: StockInvest의 `AI_API_KEY`가 M4에서 **401 `invalid or disabled api key`**.
  `src/lib/rag/m4-kb.ts`의 검색·upsert가 전부 이 키를 쓰므로 **RAG 검색 자체가 실패**하고
  `retrieval.ts`는 빈 컨텍스트로 조용히 진행한다. M4에서 키 재발급 필요(사용자 액션).

## ✅ 2026-08-23 — [[T-034-chart-based-price-targets]] 배포 완료 (아래 08-18 절부터는 이 사이 갱신되지 않아 낡아 있었음)

이 절과 08-18 절 사이(08-19~08-21)에 T-032 후속 4건([[T-032-research-rally-cycle]]) +
[[T-033-research-recommendation-trade-report]](리서치분석 매수/매도 추천 + 거래리포트 개선) +
T-034가 전부 구현·검증·배포됐다. ACTIVE.md가 그 기간 갱신되지 않았던 것이지, 실제 프로젝트가
멈춰 있었던 게 아니다 — 상세는 [[RESUME]] 최신 절과 각 task 파일 참조.

**T-034**: 목표가 산출을 진입가·과거평균 의존에서 차트 지표(볼린저밴드/60일 고저·ATR14 도달가능성
게이트) 기반으로 재설계. 진입가 의존 완전 제거(회귀 테스트 고정), 통화(KRW/USD) 혼용 구조적 차단,
기한 표시/판정 불일치 해소. Developer→Reviewer PASS(0건)→QA PASS(0건)→Leader 실데이터 대조 완료.
122 suites/2147 tests. 사용자 승인 → 커밋 `eac1e83` → **webhook-deploy 미발화(2회째 관측, 백로그)**
→ 수동 배포 완료, 헬스체크 green, 안전장치(`dryRun:false`/`killSwitch:false`/`engine.enabled:true`)
무영향.

**미해결로 남긴 것**: webhook-deploy 미발화 원인 조사(백로그), [[T-031-news-fetch-m4-500]]은
home-m4-api 프로젝트로 핸드오프 필요(이 저장소 범위 밖), TradingInvest `.env` 구IP 확인 권고(그
프로젝트 팀 소관).

## ✅ 2026-08-18 (추가) — [[T-030-fundamentals-refresh-stale-state]] 완료: 즐겨찾기 재무갱신 "데이터없음" 미반영 버그 수정

사용자 신고("재무갱신 호출 시 데이터없음으로 처리되지 않는다")를 Leader가 코드 추적으로 원인
확정 → Developer 2라운드 → Reviewer PASS → QA PASS로 완결. 캐시 DELETE 후 AI 재분석이 실패하면
화면 재동기화를 안 하던 결함(목록·상세 두 화면 동일 패턴)을 고쳤다. 상세화면은 처음 구현된
"실패 시 AI 재호출" 방식을 Leader 판단으로 제거하고 "재호출 없이 표시만 정확히 전환"으로
조정했다. 107 suites/1888 tests, 실매매 코드 무변경. **git commit은 사용자 승인 대기.**

## ✅ 2026-08-18 — T-025~T-029 전부 커밋 완료 (아래 08-16 절의 "커밋 대기 중"은 낡은 서술, 무효)

`git status` 클린, 최근 커밋 5개: `cc6dd03`(T-025 훅)·`7b9de61`(T-026 UI)·`c2533aa`(T-027)·
`cec5423`(T-028)·`0481d55`(T-029). T-025 이후 다른 세션들이 이어서 작업했고, **T-025의
commit-msg 훅이 실제 프로덕션에서 동작 확인됨** — T-029 커밋 시도 중 Reviewer 판정 형식 결함으로
실제 차단(exit=1)됐고 Reviewer가 직접 정정 후 통과, 훅이 의도대로 작동한 첫 실사례.

- [[T-026-order-history-symbol-grouping]]: 거래이력·최근주문 UI를 날짜→종목 2단 그룹핑으로 개선.
  페이지네이션이 그룹핑보다 먼저 적용되던 정확성 버그도 같이 수정(순서 반전). 100 suites/1517
  tests. 갤럭시 S25+ 실기기 헤더 줄바꿈 여부 → ✅ 2026-08-18 사용자 확인 완료(정상, 한 줄 유지).
- [[T-027-nonnumber-quantity-guard]]: `POST /api/orders`의 비-number quantity/price 가드. 조사 중
  더 심각한 결함 발견 — price가 NaN이면 주문 한도 검사가 전부 무력화(관계연산에서 NaN은 항상
  false)돼 **금액 무제한 주문**이 가능했음. 해외 어댑터의 대칭 구멍(Infinity)도 같이 닫음.
  102 suites/1660 tests.
- [[T-028-signals-api-numeric-guard]]: `POST /api/signals`에 같은 클래스의 수치 가드. 공용 모듈
  `src/lib/safety/numeric-fields.ts` 신설로 orders·signals 두 경로가 규칙 공유. 103 suites/1717 tests.
- [[T-029-custom-confirm-numeric-guard]]: `POST /api/signals/custom/confirm` — **사람 승인 없이
  즉시 진입감시로 전환되는 유일한 경로**라 우선순위 격상. 문자열 `+` 연산이 NaN이 아니라 "그럴듯한
  틀린 값"을 만들어(`'100'+'200'`→`'100200'`) 아래 단계 가드를 전부 통과하던 결함. 106 suites/1877
  tests. 잔여 LOW(`splits` 상한 없음, 자해성 DoS뿐)만 백로그.

**남은 것**: board.md Backlog의 QA 형식 준수 이슈(4회 중
3회 미준수 후 4회째 준수 — 지시문에 "표 없으면 무효" 명시가 효과 있었음, 기계적 강제는 미도입),
T-025 잔여 Medium/Low 6건(비차단).

## ✅ 2026-08-16 — [[T-025-commit-reviewer-safeguard]] 완료: Reviewer 감사 없이 커밋되는 것을 막는 git 훅 신설

2026-08-13 절차 위반(T-023·T-024가 Reviewer 감사 없이 커밋·배포됨)의 재발 방지책. 안전 관련 코드를
건드리는 커밋은 task ID + 그 task의 Reviewer 승인 기록(검토 범위 명시 포함)이 없으면 `commit-msg`
git 훅이 기계적으로 차단한다. NFS noexec로 훅이 무음 비활성되는 함정을 로컬 shim으로 우회.

같은 리포를 동시에 감사하던 여러 병렬 세션(다른 인터랙티브 세션들)이 CRITICAL 1건("무관한 과거
승인 task를 인용하면 다른 안전코드가 무검토로 통과")과 HIGH 다수(인증 미들웨어·세션관리 미보호,
scope 문자열 접두어 오매칭)를 연쇄로 찾아내 전부 수정 완료. 최종 Reviewer PASS(Critical 0·High
0)·QA PASS, 47개 시나리오+실 커밋 E2E 통과. 실매매 코드는 전 과정 무변경. **git commit/push는
사용자 승인 대기 중** — 아직 안 함. 잔여 Medium/Low 6건은 board.md Backlog 참조.

**동시 세션 관련 참고**: 이 작업 중 워크스페이스에 이 프로젝트를 동시에 다루는 인터랙티브 세션이
최소 1개 더 있었다(다른 세션이 board.md에 [[T-026-order-history-symbol-grouping]]을 등록하고,
T-025 Reviewer 감사에도 독립적으로 참여함). 파일 동시수정으로 인한 충돌은 append-only 관행 덕분에
데이터 손실 없이 넘어갔으나, 다음에 이 프로젝트를 다룰 때 다른 세션이 동시에 열려 있는지 먼저
확인하는 습관이 필요하다.

## ✅ 2026-08-13 — Reviewer 감사 없이 이미 배포된 것을 발견 → 사후 감사 완주 → 배포 권고

아래 08-11 절이 "커밋 배포 대기"라고 적어 둔 [[T-023-getactiveorders-pagination]]과 (당시 task
파일도 없던) `POST /api/orders` 수량 방어 건이, 실제로는 이 문서가 갱신되지 않은 사이에
**Reviewer 감사 단계 없이 이미 커밋·push·webhook-deploy 배포까지 끝나 있었다**(`f2c6f95`
2026-08-12 17:54 · `9456be5` 2026-08-13 09:48, 둘 다 webhook-deploy exit=0 확인, pm2 `stockinvest`
당시 후자 커밋으로 기동 중이었음). Leader 가 사용자의 "이어서 작업" 지시로 재개하며 `git log`/
`git status`/webhook-deploy 로그 실측 중 발견.

**사후 감사 완주 결과(같은 날 완료)**: 두 건 모두 자금 손실로 이어지는 Critical/High 결함 없음.
T-023 은 Reviewer 1차 감사가 HIGH 1건(페이지 상한 도달 시 불완전한 목록을 성공으로 위장 반환 —
order-sync fail-closed 우회 가능성, 현재 계좌 규모에선 사실상 도달 불가하나 구조적 결함)을 발견
→ Developer 즉시 수정(`break`→`throw` + 다운스트림 검증 테스트 2건 추가) → Reviewer 라운드2
PASS → QA PASS. T-024 는 Reviewer 1차 PASS(Medium 2건 — 비-number quantity 가 시장가/가격없는
지정가 한정으로 무의미한 라이브 API 호출까지 도달하나 자금손실 아니고 호출 프론트엔드 자체가
없어 실노출 0에 가까움 — 배포 비차단 판단, board.md 백로그 이관) → QA PASS. **최종 회귀테스트
99 suites / 1478 tests 전부 통과, typecheck 0에러.** git commit/push 는 사용자(상위 세션)가
직접 처리 예정. 상세는 [[RESUME]] 최신 절, 각 task 파일 "최종 요약" 섹션, board.md Done 참조.

## ✅ 2026-08-11 상태 (아래는 그대로 보존 — 위 절이 최신) — 실거래 무장 상태 + 주문경로 결함 2건 수정(승인 대기)

**실계좌 실거래 중이다.** `safety_dry_run=false` · `safety_kill_switch=false` · `engine_enabled=true` · `autopilot_mode=assist` · `safety_order_max_pct=6` · `safety_daily_order_max_pct=10`(과거 0 → 개방). `.env` 의 `DRY_RUN=true` 는 **죽은 설정**이다(DB `system_config` 가 우선). 아래 문서 중 "DRY_RUN 이라 안전하다"는 취지의 옛 서술은 전부 무효다.

### 오늘 배포됨

- [[T-017-kis-rate-limit-throttle]] (`bbe074b`) · [[T-018-order-sync-fail-closed]] (`3d4197e`) — 같은 push 로 배포. pm2 기동 `04:39:08 UTC`, 헬스체크 그린.
- [[T-019-partial-fill-false-filled]] · [[T-020-fractional-order-quantity-sizing]] (`d67dceb`) — 사용자 승인 후 커밋·푸시·배포 완료(2026-08-11 08:33:37 UTC). pm2 재기동(restarts 341), 헬스체크 그린(`dryRun:false` `killSwitch:false` `engine.enabled:true` `safetyStatus:green`).
  - T-019: 부분체결이 `filled` 로 오기록되어 손익 장부가 틀어지던 문제. `executions` 에 실제 체결 수량 기록 시작(역사상 0행이던 표에 처음으로)
  - T-020: 소수점 주문 수량이 전송 직전 절삭돼 조용히 축소집행되던 문제. 사이징 시점 정수화 + 0주 스킵의 관측 가능한 흔적
  - 둘 다 developer(Opus) → reviewer(Sonnet, 2라운드 **PASS**) → QA(**검증 통과**) 순환 완료. 93 suites / 1411 tests, typecheck exit 0.

### 🔴 미커밋 작업물 — 승인 대기: [[T-021-recommend-detail-client-crash]]

사용자 신고 "추천 목록에서 시그널 클릭 시 **Application error: a client-side exception has occurred**".
**구현·독립감사(PASS)·QA 2라운드 전부 완료, 커밋 안 함.** HEAD 는 여전히 `8d68a0c`.

- **원인**: 소비자 타입이 DB JSON 을 신뢰해 required 로 선언 → `ScenarioDetail.tsx:418` `sc.risk_factors.length` 무가드. **post-market 엔진이 `risk_factors`·`why_now`·`context`·`ev` 를 채우지 않고 INSERT** 하는데 **타입이 거짓말을 해서 컴파일러가 못 잡았다.**
- **만성 문제**: 06월 중순~08-11 거의 매일 발생. 과거 것들은 `expired` 라 클릭이 안 됐을 뿐이고, 신고 시점 pending 노출은 1건(17211).
- **수정**: `scenario-view-model.ts` 신설(소비자 타입 `StoredScenario` 전 필드 옵셔널 + 표시 판정 순수 함수). 타입을 정직하게 만드니 **컴파일러가 같은 클래스 15곳을 스스로 찾아 전부 방어**(`TradingBoard.tsx` 는 진단에 없던 4번째 파일). `NaN%` EV 거짓 수치 제거. **`src/app/error.tsx` 신설** — 이 앱에 렌더 예외 경계가 하나도 없었다.
- **`post-market-engine.ts` 무변경(의도적)** — 근거 없는 값을 지어내지 않는다. 특히 `ev` 를 LLM confidence 에서 유도하는 건 "거짓 데이터" 문제의 재발.
- 94 suites / **1444 tests** · typecheck 0에러 · reviewer PASS(Critical 0/High 0) · **주문·자금·안전장치 파일 전부 무변경(순수 UI)**.
- 파생 백로그 2건(트레일링 표시/실동작 불일치 + 기준값 3곳 분산, `ScenarioAnalysis` 생산자 타입 신뢰) → board.md Backlog.

> 🔴 `deploy-stockinvest.sh` 의 `git clean -fdx` 가 **미추적 파일을 삭제**한다. 신규 파일 3개(`src/app/error.tsx`, `src/components/scenario-view-model.ts`, `src/components/__tests__/scenario-view-model.test.ts`)와 이 task 파일이 여기 해당한다 — **다른 이유로 push 가 먼저 일어나면 증발한다.**

### 배포 후 관측 권고 (신규)

- `sizing_below_min_qty` 발생 건수 — 상시 스킵되면 주문금액 정책(현재 포트폴리오 6%) 조정 신호
- 매도/청산 스킵 알림 — 뜨면 실제 포지션 미청산 상태이니 확인 필요
- `ORDER_SYNC_EXEC_DUPLICATE` 경보 — 1건이라도 관측되면 즉시 에스컬레이션([[T-019-partial-fill-false-filled]] 백로그 참조)

### 현재 노출도 (후속 판단 기준선, 2026-08-11 실측)

`executions` 0행 · 역대 `partially_filled` 0건 · order-sync 대상 0건 · 06월 이후 해외 주문 0건 · 08월 시그널은 전부 `expired`/`ai_skipped` 로 주문 도달 0건.
→ 두 결함 모두 **아직 발화한 적 없다.** 다만 킬스위치 해제 · T-017 의 레이트리밋 제거 · 일일한도 개방으로 **억제 요인이 전부 풀렸다** — "현재 0건"은 안전의 근거가 아니라 시한의 근거다.

---

## 지금 상태 (이하 2026-08-06 기준 — 재구성 맥락)

**프로젝트 재구성 진행 중** (사용자 요청: "시그널도 안 나오고 수익도 없어 사용 중단 → 다시 쓸 수 있게 재구성").

원인 분석 완료 — 코드 수준에서 확정:
- 매수 시그널 1건이 사용자에게 도달하려면 직렬 게이트 ~10개 통과 필요, 그중 3개가 확률 ~0
  1. `ANALYST_ENABLED=false`가 engine.ts:843에서 엔진 자체를 차단 (router.ts:92의 라우팅 플래그와 이중 의미 — 공식 가이드 1단계 설정이 곧 시그널 0)
  2. market-state 게이트(RSI<35 선점)와 유일 매수 룰 rsi-oversold-v1(RSI<35 발화)의 **구간 배타** — 활성 창과 발화 창의 교집합이 공집합
  3. ai-filter.ts:422가 LLM_PROVIDER 무시하고 `claude` CLI 직접 spawn → 실패 시 비보유 종목 전량 ai_failed
- 수익 부재는 구조적: DRY_RUN=true + `executions` INSERT 코드 전무 → 페이퍼 손익조차 측정 불가
- 안전장치는 거꾸로 fail-open (한도 미설정 시 Infinity, Kill Switch drawdown dead code, 71라우트 중 61개 무인증)

전체 진단·설계는 플랜 파일 참조: `C:\Users\admin\.claude\plans\majestic-imagining-raccoon.md`

## 재구성 전략

**최소 동작 루프 우선(strangler)** — 검증된 자산(KIS 어댑터, submitOrder 단일 관문, UI 셸, 알림, post-market 시나리오 카드) 보존 + 파손된 시그널 파이프라인만 단순·관측 가능하게 재구축. 매 Phase가 사용자가 눈으로 확인할 결과물을 낸다.

Phase 0(안전 기반) → 1(관측: 깔때기) → 2(시그널 복구: 게이트 9→4, 스위치 의미 분리, 장중 AI 제거) → 3(페이퍼 손익 실측) → 4(백테스트 검증 루프) → 5(DRY_RUN 해제 준비)

## 사용자 확정 결정 (2026-08-02)

1. ~~해외주식 **보류** (코드 보존·비활성, 국내 루프 완성 후 재개)~~ → **2026-10-20 사용자 지시로 대체: 프로젝트 주력 = 미국(해외)주식, 국내 병행.** 해외 전략 평가·시그널·보유는 이미 운영 중이었다. 설계·단계 계획: [[T-057-us-stock-analysis-data-collection]]. (2번 이하는 그대로 유효)
2. 장중 AI **제거** — 장중은 결정론적 룰만, AI는 post-market 시나리오 생성(밤 배치)에만
3. 부가기능: **RAG 되먹임 유지 + 투자일지 유지** / AI 채팅(/ai)·LoRA export 비활성·삭제
4. 크리덴셜: DB 평문 유지 + 인증(PIN/PSK)으로 접근 봉쇄

## 다음 할 일

**2026-08-06: [[T-006-phase2-implementation]] Phase 2 배포 완료(`c064e83`).** market-state 데드락 해소를 실데이터로 확인. 남은 건 관측.

1. **Step 5 관측** — 2026-08-07부터 3영업일, §6 사후 기준 4개 확인
2. 🔴 `weekly-trend-follow-v1` 발화 불가(1d 210봉 필요 vs KIS 100봉 반환) 대응
3. 🔴 auto 모드 활성화 전 승인 3건 (현재 `autopilot_mode=assist`)
4. Step 5 진입 시 DRY_RUN/KILL_SWITCH 관측 모드 결정

## Phase 0 최종 상태 (developer 완료분)

- 한도 fail-safe 전환(미설정·조회실패 → 0 = 거부), safety 기본값 seed(회당 5%/일일 10%)
- PIN 인증 미들웨어(Edge HMAC 세션) + /login + 전역 지수 백오프 로그인 잠금
- Kill Switch drawdown을 portfolio-snapshot cron에 배선
- `parseBoolFlag` 3분기(unset/parsed/unparsable) — 해석 불가 시 안전 방향 + critical 알림
- next 14.2.15 → **14.2.35** (CVE-2025-29927 인가우회 + CVE-2025-55184 DoS). lock의 deprecated 필드 소멸로 검증
- undici 제거(초기 커밋부터 미설치 = 동작한 적 없음), /api/health 금액 비노출, CI에 npm test 게이트
- 테스트 39 suites / 398건 통과, build·tsc 통과 (Phase 0 시점 기준)

## 열린 결정

- ~~배포 파이프라인이 이미 red였음~~ → **정정(2026-08-02 pm2 실측)**: `stockinvest`는 **online, next 14.2.15, uptime 4h**로 정상 가동 중이고 cron도 5분마다 정상 동작(`strategy-eval skipped — all_markets_closed`, 장 마감 시간이라 정상). 배포는 red가 아니었다. 단 `undici` 미선언으로 `npm run build`가 실패하는 것은 사실이므로, **마지막 성공 배포 이후 CI가 계속 실패해 왔을 가능성**은 남아 있다(운영 프로세스는 그 이전 빌드로 계속 서빙).
- **미해결 이상징후 3건 (리눅스에서 확인 필요)**:
  1. `.next/`가 SMB 마운트(Z:)에서는 `trace` 파일 하나(Apr 22)뿐인데 앱은 정상 서빙 중. `ecosystem.config.js`는 `cwd: __dirname` + distDir 오버라이드 없음 → 같은 `.next`를 읽어야 정상. **실행 중 프로세스가 열린 파일 핸들로 버티고 있고 실제 `.next`는 삭제된 상태일 가능성** → 그렇다면 다음 pm2 restart 때 기동 실패한다.
  2. **restart 315회** (tradinginvest도 171회). 반복 재시작 원인 불명.
  3. `AI_API_BASE`(192.168.219.163:8001 = 맥미니 M4 AI 게이트웨이) **연결 실패**가 err.log에 기록됨 → RAG 검색·hybrid stage1 무력화. analyst가 찾은 `claude exit 143` 실패와는 별개 장애.
- **운영 코드에는 H1 핫픽스가 아직 없다** — 워킹트리에만 있으므로 시그널은 여전히 0건. 배포해야 소생한다.
- 워킹트리에 커밋되지 않은 변경 다수(원래 30여 개) — Phase 별 검증 완료 후 커밋 전략 결정 필요. **push = Gitea Actions 자동 배포**이므로 신중.

## 2026-11-08 15:53 — T-162 지정 구현·독립 검증 완료(미배포)

- [[T-162-entry-watch-order-outcomes]]: 승인 v1 구현, 완료 주문은 이력을 보존하며 현재 감시 목록/홈·거래 집계에서 제외하고 실제 주문 결과를 표시한다. 독립 Reviewer·QA PASS, 143 tests·타입·격리 build 통과. 운영 SELECT 검증으로 원본 3행 보존/제안 목록0건 확인. 미커밋·미배포이며 운영 앱은 아직 변경 전. 외부 Claude는 미커밋 경계로 미실행. 실제 앱 인증/실기기/실시간 poll 미검증, 기존 병렬 count/list 순간차이 LOW 유지.

## 2026-11-08 16:04 — T-162 운영 배포·3건 제외 및 이력 보존 검증 완료

- [[T-162-entry-watch-order-outcomes]]: 사용자 추가 승인으로 T-162만12파일 커밋 `57600fff` → 릴리스 `20261108-160042-57600fff`, RELEASE_RESULT ok/END0/migrated:false. 후속 health200·green·web/cron각1·DRY_RUN=true/killSwitch=false 유지. 배포 전후 별도 READ ONLY 거래에서 signals3/orders3/executions0/관련로그6 전체행셋 SHA·건수 일치, 운영 SQL 목록·집계0 및 대상3건제외 확인. 인증된 HTTP/실기기 화면은 미관측이며 운영 소스·빌드·SQL에 의한 확인이다. 앞선 미배포 기록은 이 절로 대체된다. 공유 checkout/타 세션 변경은 보존.

## 2026-11-08 17:25 — T-162 사용자 앱 확인 완료·최종 종결

- [[T-162-entry-watch-order-outcomes]]: 사용자가 앱에서 기존3건이 진입 감시에서 사라진 것을 직접 확인하고 마무리를 지시했다. 기존 운영 SQL 제외·전체 이력 해시 보존 검증에 사용자 앱 확인까지 반영해 done/waiting없음으로 최종 종결. 커밋57600fff·릴리스20261108-160042-57600fff 배포는 기존 기록대로이며 이번에는 코드·운영·배포 변경 없이 기록만 갱신. 이전 실기기 미관측 서술은 이 확인으로 해당3건 범위에서 해소됐다. 새 주문 모든 상태/실시간 갱신/증권사 원장·안전회로까지 검증으로 확대하지 않는다.

## 2026-11-08 17:41 — T-162 완료 기록 원격 반영·자동 배포 확인

- [[T-162-entry-watch-order-outcomes]]: 사용자 요청대로 기록커밋 f01e5b8 하나만 main push(e9dccee→f01e5b8). 기록4파일만, 다른작업 추가/코드변경0. 자동배포 릴리스20261108-173820-f01e5b8e, 17:39:40 KST RELEASE_RESULT ok/END0/migrated:false. 배포기록4파일 Git blob SHA일치, 후속health200·DB정상·green·web/cron각1·restart0·DRY_RUN=true/killSwitch=false 유지. 사용자 확인을 포함한 T-162 최종종료 유지, 남은 요청없음.

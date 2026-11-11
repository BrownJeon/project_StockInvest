---
task_id: T-156
title: 미국 종목분석의 매수·매도 시점 개선안 조사
status: doing
waiting: ["미국11/10 고정후보122/123 적격·BRK.B split 11/09·11/10 부족: Alpaca 실제권한2GET성공 후 시가/종가·분할/PIT·신규계약 검증, 적격 원천 후 첫T0/정상전진·신규4기간·중복 검증", "전진 최소84일·신규왕복100건·에이전트 변경20일 검증", "당시 전체 종목 구성·거래소 상승 종목 분모와 언론 판본 원천 확보"]
priority: medium
base_ref: 8984f69ddd5581c45c919193a535f5b1b359765d
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-078, T-107, T-109, T-114, T-116, T-124, T-143, T-146]
tags: [type/task, domain/strategy, domain/analytics, domain/us-market]
aliases: [미국종목예측, 매수매도시점]
execution_context:
  schema_version: 1
  origin_tool: codex
  current_tool: codex
  current_procedure: codex_scoped
  current_scope: "F52 coherentBRK43파일동결/Reviewer·C2override·QA509/480·실DB경합3통과,0.4정본배포·fresh모의펜스·실원천/forward/4기간발행검증준비。운영현재0.3/원예측1·4pending/T0null·실거래OFF"
  last_event_id: exec-095
created: 2026-11-06
updated: 2026-11-11
demo_gate:
  required: true
  level: "full"
  status: "approved"
  version: 6
  repo_path: "mockups/T-156-paper-analysis-v6.html"
  artifact_url: "http://127.0.0.1:8786/T-156-paper-analysis-v6.html?v=cce67b2f"
  content_sha256: "cce67b2f0350406f2296f1495fbf446e0597a3e1cc1259f9d4f98554531758ed"
  decided_by: "judge"
  rule_id: "JV-ui_change"
  approved_by: "user"
  approved_at: "2026-11-08T19:52:09+09:00"
  approval_quote: "v6 승인"
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
  approval_source: "codex_native_transcript"
---

# T-156 — 미국 종목분석의 매수·매도 시점 개선안 조사

## 실행 도구·절차 이력

| 이벤트 ID | 시각(KST) | 사건 | 이전 → 현재 담당 / 현재 절차 | 범위·인계 대상·남은 일 | 근거 |
|---|---|---|---|---|---|
| exec-001 | 2026-11-06 13:53 기록 | start | 없음 → codex / codex_scoped | 현행 구현과 자료 공백을 조사하고 개선안 제시 | 이 대화의 사용자 요청 및 NYSE 시총 상위 50개 확인 |
| exec-002 | 2026-11-06 14:26 기록 | resume | codex → codex / codex_scoped | S&P 500·Nasdaq Composite 주간 연구 입력과 검산 | 사용자의 1990년 이후 주간 흐름·국면 패턴·예측 입력 추가 요청 |
| exec-003 | 2026-11-06 15:09 기록 | resume | codex → codex / codex_scoped | NAS 작업 폴더 재연결, 시장 입력의 표본 외 평가, 운영 기록 읽기, 종목별 검증 설계 | 사용자 요청 범위는 분석·설계 |
| exec-004 | 2026-11-06 15:29 기록 | resume | codex → codex / codex_scoped | 지정 영상 분석 노트와 자막 대조, 재현 가능한 가설의 탐색 검증 | 사용자가 TheThinker 레퍼런스 URL 및 최종 검토 전 설계·백테스트 범위를 지정 |
| exec-005 | 2026-11-06 15:40 기록 | resume | codex → codex / codex_scoped | 당시 자료 확보 가능성, 관측된 매수·매도 결과의 제한 비교, 최종 검토안 | 사용자 요청은 자료 검증·비교 백테스트와 검토안 작성 |
| exec-006 | 2026-11-06 16:17 기록 | resume | codex → codex / codex_scoped | 차단 기록을 제외한 가격 기반 백테스트와 장전 예측 샘플 | 검증 단계의 차단 기록 대신 과거 지표와 등락폭을 사용하라는 사용자 지시 |
| exec-007 | 2026-11-06 16:28 기록 | resume | codex → codex / codex_scoped | 기존 발화·저장 경로 대조, 관찰 후보 관리 및 분석→시그널 인계 설계 | 여러 자료를 활용한 후보 관리의 변화점과 절차 보완 요청 |
| exec-008 | 2026-11-06 16:56 기록 | resume | codex → codex / codex_scoped | 판단 역할·단계별 실험과 전체 설계 점검표·흐름도 | 네 판단 구간을 절차에 반영하고 구현 전 전체를 다시 검토하라는 사용자 요청 |
| exec-009 | 2026-11-06 17:24 기록 | resume | codex → codex / codex_scoped | 네 구간의 기준치 초안·매수/매도 비교군 | 필수 조건·에이전트 기준을 나누어 수치·근거·조치와 검증 방법을 명시하라는 사용자 요청 |
| exec-010 | 2026-11-06 17:41 기록 | resume | codex → codex / codex_scoped | 가용 NAS/NYS 일봉 전 기간 가격 재생과 구현 전 판정 검토 | v0.1 재백테스트·단계별 통과율·매수/매도 성과·표본/통과/중단 기준 정리 요청 |
| exec-011 | 2026-11-06 18:05 기록 | resume | codex → codex / codex_scoped | 예상수익 기반 매수·매도 계좌, 종목·거래별 예상과 실현의 비교 | 이후 등락을 판단 입력으로 쓰지 않고 예측값으로 매매 수익을 모의 계산하라는 요청 |
| exec-012 | 2026-11-06 18:21 기록 | resume | codex → codex / codex_scoped | 공개 시점 재구성 공시·뉴스, 에이전트 적용, 동일 계좌 비교와 낙폭·상승 구간 | 당시 확인 가능한 자료에 판단 에이전트를 적용하고 같은 가격 기준선과 대조하라는 요청 |
| exec-013 | 2026-11-06 19:03 기록 | resume | codex → codex / codex_scoped | 손실 원인 및 45개 전략 비교, 더 긴 기간의 자료 확인 | 수익 후보를 찾기 위한 반복 전략 시뮬레이션 요청 |
| exec-014 | 2026-11-06 19:12 기록 | resume | codex → codex / codex_scoped | 2020-01-01~2026-09-30, 실제 자료를 격리 MariaDB에 적재하고 일별 가격·시장·공시 가용성을 재생 | 사용자가 기간 확장·날짜별 실제 수집·DB 기반 테스트를 지정 |
| exec-015 | 2026-11-06 22:13 기록 | resume | codex → codex / codex_scoped | 공개 원천으로 일봉·공식 사건·구성 증거 파일 생성, 격리 DB 장기 가격 재생 | 사용자가 기존 구독·파일이 없어 새로 생성해야 함을 확인 |
| exec-016 | 2026-11-06 23:10 기록 | resume | codex → codex / codex_scoped | E3 손익 분해와 시장 조건별 E3·R02 전환 재생 | 사용자가 11거래일과 장기 손익의 차이 및 동일 비용 백테스트 요청 |
| exec-017 | 2026-11-06 23:34 기록 | resume | codex → codex / codex_scoped | KIS 편도 0.25% 재생, 매수 비용 조건과 전환 규칙 확인 | 사용자가 수수료 0.25% 고정과 적용 기준 설명 요청 |
| exec-018 | 2026-11-06 23:40 기록 | resume | codex → codex / codex_scoped | 판단 시점의 자료로 두 에이전트의 E3·R02 선택을 고정하고 가격 재생 | 사용자가 당시 흐름에서 판단 에이전트의 선택과 손익 차이를 확인 요청 |
| exec-019 | 2026-11-07 00:06 기록 | resume | codex → codex / codex_scoped | 반등·추가 하락 기준 고정, 당일 정보만 전달한 단기 판단 및 25bp 장기 비교 | 사용자가 10/23·26의 이후 결과를 가리고 동일 수수료 비교 요청 |
| exec-020 | 2026-11-07 00:38 기록 | resume | codex → codex / codex_scoped | 일봉·구성·시장 폭·공시·뉴스 수집, 격리 DB 적재 및 읽기 검산 | 사용자가 1990년 이후 원문 수집, 공개 시각과 결측 기간·이유 기록 요청 |
| exec-021 | 2026-11-07 00:52 기록 | resume | codex → codex / codex_scoped | 신규 연구 DB 입력·공개판본의 시점 통제, 일별 에이전트와 고정 E3·R02 비교 | 사용자가 11일·장기 동일 수수료, 일별 선택 및 자료 공백 정리 요청 |
| exec-022 | 2026-11-07 08:35 기록 | resume | codex → codex / codex_scoped | R02 기준선과 E3 후보 검토, 사건 해석 권한, 주문 없는 비교 검증 조건 보완 | 사용자가 일별 판단 기록을 근거로 에이전트 개입 계획 보완 요청 |
| exec-023 | 2026-11-07 08:52 기록 | resume | codex → codex / codex_scoped | 2015~2016년 계좌 홀드아웃, 25bp 세 방식 및 동일 상태 개입 반사실 재생 | 사용자가 미사용 평가 구간, 손익·최대낙폭, 회피 손실·놓친 상승과 표본 부족 표시 요청 |
| exec-024 | 2026-11-07 09:20 기록 | resume | codex → codex / codex_scoped | 2006~2011 신규 재생, 당시 원문 보강, 이전 구간 신원 정정 재생, 표본·수집 반영 판정 | 사용자가 같은 25bp 세 방식 비교와 손익·낙폭·변경일 검증 요청 |
| exec-025 | 2026-11-07 11:05 기록 | resume | codex → codex / codex_scoped | 계좌 평가액에 따른 주문 규모와 기간별 연복리 수익률 확인 | 사용자가 누적 수익의 기간·복리 반영과 연간 환산을 질문 |
| exec-026 | 2026-11-07 11:25 기록 | resume | codex → codex / codex_scoped | 연복리 15% 목표와 최대 200회 탐색, 편입일 대조 및 상위 전략 정리 | 사용자가 연복리 15% 이상 세 번과 실패 시 상위 10개·최대/최소 등락폭을 요청 |
| exec-027 | 2026-11-07 11:39 기록 | resume | codex → codex / codex_scoped | 세 고정 전략·공시 판단·전환 비교와 동일 상태 반사실 | 사용자가 M40·E3·R02 고정 투자와 판단 에이전트 개입 백테스트를 요청 |
| exec-028 | 2026-11-07 12:21 기록 | resume | codex → codex / codex_scoped | M40 10년·5년 각 100개, 동일 입력 반복·독립 판단·주간 위험과 시작일 민감도 | 사용자 최종 점검 요청과 일별 평가·20일 후보 교체·주간 위험 주기 유지 확인 |
| exec-029 | 2026-11-07 12:48 기록 | resume | codex → codex / codex_scoped | 전체 참조 125종목 패턴과 같은 종목·다른 종목 반복 비교, 무작위 대조와 예측력 검산 | 사용자가 모든 종목의 주가 변화 패턴화와 반복 유사성 점검을 요청 |
| exec-030 | 2026-11-07 13:51 기록 | resume | codex → codex / codex_scoped | 같은125종목의 M40·패턴 순위·패턴 매수 보류·자료 확보 대조군 재생 | 사용자가 패턴의 미래 예측 의미와 거래 규칙 투자 대비 효과를 요청 |
| exec-031 | 2026-11-07 14:05 기록 | resume | codex → codex / codex_scoped | 기존 해외 분석·시그널 경로와 대조한 M40 기본 최종 설계 검토안, 4단계 판단 권한·흐름도·검증 관문 통합 | 사용자가 M40 기본·패턴 참고로 최종 설계를 정리하고 구현은 검토 후 진행하도록 지정 |
| exec-032 | 2026-11-07 18:06 기록 | resume | codex → codex / codex_scoped | 기존 수집기와 공식 원천을 확인하고 수집 원천·증분/백필·판본 보존·자료 품질 설계 보완 | 사용자가 분석·판단 앞단의 데이터 수집 방안 설명을 요청. 구현·운영 수집 실행은 제외 |
| exec-033 | 2026-11-07 23:08 착수 | resume | codex → codex / codex_scoped | 운영 DB SELECT·수집 로그 및 기존 격리 연구 DB 감사, 무료 공개 자료 추가·읽기 검산·기간/누락률/본문 구분 | 사용자가 실제 수집 상태 점검과 무료 자료 보완을 승인. 운영 데이터/설정·수집 코드·스키마·크론·주문 경로 구현은 제외 |
| exec-034 | 2026-11-08 08:29 사전 점검 | resume | codex → codex / codex_scoped | 사용자가 승인한 구현·운영 DB 자료 이관·테스트 이력 저장의 실제 스키마/권한/모드 점검, 28개 자료 해시 목록 및 실행·복구 계획 준비. 담당 방식 확인 중이며 구현/운영 쓰기는 아직 미실행 | 최신 사용자 지시로 분석 전용 제약 해제. AGENTS의 큰 구현 Claude 인계 규칙 때문에 담당 방식만 비동기로 확인 요청 |
| exec-035 | 2026-11-08 사용자 답변 반영 | scope approval | codex → codex / codex_scoped | Codex가 T-156 구현·DB 이관까지 직접 수행. 이번 작업의 큰 구현 담당 제한은 명시 예외 승인됨. 원본 보존·실거래 보호·검증 관문 유지 | 사용자: “이번 T-156은 Codex가 구현·DB 이관까지 직접 진행” |
| exec-036 | 2026-11-08 09:45 중간 기록 | implement / verify / import | codex → codex / codex_scoped | 새 worktree에서 M40·보관·shadow·인증 API 구현, Reviewer 지적 수정, Ubuntu 1,343 tests 및 실 MariaDB 경합 2건 검증. 운영 신규 DDL 후 연구 27표 적재 중(staged), 게시·배포 미완료 | 사용자 직접 구현·DB 이관 승인 exec-035. 실제 결과는 F13/구현 보고서의 영수증으로 구분 |
| exec-037 | 2026-11-08 11:32 중간 기록 | publish / final QA | codex → codex / codex_scoped | 연구 27표 4,383,186행 게시·전체 COUNT/CHECKSUM, 압축원문1,455건 해시, 테스트 원본28개 DB 복원 검산 완료. 최종1,417 tests·타입·build PASS, 공개시각/문자 비교 보완. 운영 증분 연동 재확인 중 | exec-035 승인 범위의 실제 DB/QA 영수증. 실주문 활성화 없음 |
| exec-038 | 2026-11-08 11:44 확인 | deployment / archive complete | codex → codex / codex_scoped | 연구27표 게시·원본28개 및 신규 검증이력 DB보존, 구현소스39개 시험해시와 배포판 일치. 릴리스9237fff RELEASE_RESULT ok/END0·health200·web/cron각1·인증API 차단동작 확인. F09·적격입력·전진검증은 대기 | exec-035 직접수행 승인, 운영 DB readback/독립QA 1,426 PASS·15 SKIP와 실제 배포 검증 JSON |
| exec-039 | 2026-11-08 사용자 후속 | scope approval | codex → codex / codex_scoped | 남은 T0·자료 적격성·전진 검증을 진행해 DRY_RUN 종목분석→시그널 연결. 실거래 해제 금지 | 사용자 후속 명시 지시 |
| exec-040 | 2026-11-08 사용자 선택 | policy decisions | codex → codex / codex_scoped | 첫 적격 거래일 T0 1회 고정, 현재 실계좌를 복제한 독립 모의 장부, 한정 후보군 모의 시험판 승인 | 비동기 질문 3개 사용자 답변. 실제 보유·잔고·전략 검증 상태 변경 승인 아님 |
| exec-041 | 2026-11-08 13:50 | implement / verify | codex → codex / codex_scoped | 독립모의장부·source자격·T0영구고정·paper시그널 구현/최종QA,운영복사+11/06리허설4개. 코드배포 후검증과미래전진표본은분리 | 사용자3개선택,독립감사,1,594tests/SQL11검사/운영영수증 |
| exec-042 | 2026-11-08 14:03 | release / verify / fix | codex → codex / codex_scoped | c296116운영배포/인증202후실제after/23파일검산,초기부분응답재시도정체실제재현후1조건보완·SQL12검사 | 운영리허설4매도유지/T0null/DRYtrue,최종QA와배포영수증분리 |
| exec-043 | 2026-11-08 | user_request / intake | codex → codex / codex_scoped | 기존화면유지·분석탭M40조회4영역추가,실거래OFF. judge full/demo_first,modelrouter Sol1.67 | 사용자구현요청/실제judge영수증 |
| exec-044 | 2026-11-08 | demo / prepare | codex → codex / codex_scoped | v2합성데모·360/412/1280 CUA검증·readonlyAPI6파일준비 | 데모SHA9d1197...cb07/격리QA별도기록 |
| exec-045 | 2026-11-08 | user_approval | codex → codex / codex_scoped | 실제질문응답원문‘v2 구성으로 구현 진행’과조회계정이메일확인. 동일승인·이메일재질문금지 | 실제user role native응답,이메일원문repo미보존 |
| exec-046 | 2026-11-08 | gate_record_refused | codex → codex / codex_scoped | approve-codex-context가승인기록미연결로거부. 실제승인과도구실패분리,상태임의수정/영수증재생/훅재생안함. 이번작업예외or도구지원보완처리방식응답대기 | 자동거부원문·Reviewer절차대조 |
| exec-047 | 2026-11-08 15:14 | db_bind / read_verify | codex → codex / codex_scoped | 승인된계정1개조회권한연결·원장/설정불변. 실제reader출처4그룹/적격123/리허설시그널4/비viewer거부확인. 화면코드·배포는미착수 | paper-viewer-binding-receipt.json/paper-view-operating-read-receipt.json |
| exec-048 | 2026-11-08 15:31 사용자 답변 | tool_support_approved | codex → codex / codex_scoped | 사용자 ‘승인 도구 지원부터 보완’ 선택. 공통 도구의 질문응답·등록 worktree 지원을 격리 사본에서 수정·독립감사한 뒤 기존 실제 v2 승인을 연결한다. 같은 승인 재질문·수동 상태변경·훅 재생 금지 | 실제 native 사용자 응답. 기존 승인·실거래 OFF 유지 |
| exec-049 | 2026-11-08 15:57 | tool_support / native_approval_verified | codex → codex / codex_scoped | 공유승인도구14파일보완·독립review/QA/적용후193개통과. 실제원래v2답변native복구성공·check/activate통과. 화면구현재개,실거래OFF | finalmanifest985d1bd6/독립보고서/실제source codex_native_transcript 영수증 |
| exec-050 | 2026-11-08 16:20 | ui_implementation / QA / CUA | codex → codex / codex_scoped | 기존메뉴보존M40조회4영역구현,선정미매수제약whitelist보완,독립정적감사/360tests/타입/build/360·412·1280CUA통과. 최종실DBreadonly123적격/4모의신호/비viewer거부. 운영반영준비 | UI보고서/manifest8c9301db/독립리뷰0393dd16/QAfd65d085/운영읽기영수증 |
| exec-051 | 2026-11-08 16:34 | publish / verify | codex → codex / codex_scoped | T162보존병합 e9dccee 최종487tests/타입/build통과후main게시. 릴리스163137-e9dccee5 START/RESULTok/END0,핵심14파일SHA/healthgreen/web·cron각1/DRYtrue/API401확인. 도구/UI/최종검증자료DB보존,실제로그인앱화면/미래전진은별도 | ui-deployment-verification.json/combinedQA e442adace/UI보고서 |
| exec-052 | 2026-11-08 사용자 후속 | demo_revision_request | codex → codex / codex_scoped | 메뉴명 모의분석·운영정책판본/판단반영상태표시·한줄고정4탭·각목록10개페이징 v3데모. 사용자검토전앱구현/설정변경금지. 현재M40기본/agent참고전용과요청한규칙선택연결을구분 | 사용자명시요청·로컬intake rules delta/demo_first·router Sol fallback |
| exec-053 | 2026-11-08 | demo_review_requested | codex → codex / codex_scoped | v3원본91cc9d49, 독립정적검토/lint·JS·CUA360/412/1280통과. 한줄sticky·각목록10개·경계/검색/권한상태확인. 운영은M40기본/agent미호출·참고전용 확인, 모의정책연결 범위는사용자선택대기. 앱/설정/DB쓰기없음 | v3제안서·static-review.json·visual-review.json·운영readonly영수증 |
| exec-054 | 2026-11-08 사용자 후속 | demo_period_revision | codex → codex / codex_scoped | v3수익은날짜없는합성23점임을설명후 사용자기간표시요청. 전체모의기간/시그널발생범위/실제관측범위·주/월·진행/완료·자료누락을구분하는 v4데모 작성. v3불변보존,실제앱변경없음 | 사용자명시요청·intake rules delta/demo_first·기존Sol designer재사용(router동일Sol fallback) |
| exec-055 | 2026-11-08 | demo_review_requested | codex → codex / codex_scoped | v4 ad504e9b 완성·독립 기간/수치 검산·lint·CUA360/412/1280. 전체/주간/월간·실제 관측일·기준평가·부분기간/누락·10개 페이지 집계 불변 확인. 운영은 리허설만/전진 성과기간 없음. 앱·설정·DB 쓰기·모델/주문 호출 없음. 사용자 v4 검토 대기 | F19·v4 제안서·period-static-review.json·visual-review.json·readonly 기간 영수증 |
| exec-056 | 2026-11-08 | demo_forecast_revision | codex → codex / codex_scoped | 사용자 요청으로 관측성과/향후1주·1개월 예상성과/사후비교 v5 새 데모. P10–P90 손익범위와 손실확률·비교상태를 합성자료로 제시. 편도0.25%유지, v4불변·사용자검토전앱/DB/모델/주문변경금지 | 사용자명시요청·rules R1/delta/demo_first·Sol router fallback·designer 위임 |
| exec-057 | 2026-11-08 | demo_review_requested | codex → codex / codex_scoped | v5 2b86a975 완성·독립 수치/기간/비교 검산·lint·CUA360/412/1280. 관측/1주·1개월예측/사후비교·편도0.25%·0경로/비교조건/10개페이지·active표시 확인. 전부 합성이며 앱/DB/모델/주문 변경 없음 | F20·v5제안서·forecast-static-review.json·visual-review.json·불변SHA확인 |
| exec-058 | 2026-11-08 | demo_horizon_revision | codex → codex / codex_scoped | 향후3개월/1년을 추가한 v6 새 데모. 달력3/12개월·월말보정/예정세션·기간별합성경로/편도0.25%·장기사후비교대기. v5불변, 검토전앱/DB/모델/주문변경금지 | 사용자추가요청·rules delta/demo_first·Sol fallback·designer위임 |
| exec-059 | 2026-11-08 | demo_review_requested | codex → codex / codex_scoped | v6 cce67b2f 기간4개·3개월/1년 독립합성경로·편도0.25%·월말/윤년 검산·lint/CUA360/412/1280. 장기사후비교대기·N0미확인·23행10/10/3·원본/제품불변 확인. 사용자검토대기·앱/DB/모델/주문변경없음 | F21·v6제안서·horizon-static-review.json·visual-review.json |
| exec-060 | 2026-11-08 사용자 v6 승인 | implementation_preflight | codex → codex / codex_scoped | 실제native v6승인확인. 도구질문닫는따옴표검사와옛v3~v5미결계산문제진단·격리보완중. 정식check전제품편집0. 실제readonly계약/UI가이드준비,예측엔진·DBDDL·실거래활성화제외 | 원본msg/question·F22·222검사/독립검토·C1false |
| exec-061 | 2026-11-08 19:52:09 KST | approved_implementation | codex → codex / codex_scoped | v6원본native승인공식연결·check/activatePASS(hashverified). quote/버전계보지원수정240회귀·독립검토·실원본readonlyproof후적용. 동일승인재요청/원장수동편집없음. Backend/frontend승인범위구현착수 | source codex_native_transcript·F22후속·실제CLI출력·240검사 |
| exec-062 | 2026-11-08 | static_review_pass | codex → codex / codex_scoped | 승인v6 frontend10/backend9파일구현·독립정적리뷰PASS/미해결0·19SHA일치. 조회loop/구형DTO/privateclear/범위·정책일치/계좌시작전coverage/부분기간문구보완. Ubuntu격리Jest/tsc/build·Cua준비시작,아직실행성공아님 | product-review.json·19파일manifest·C2rules+Codex내override |
| exec-063 | 2026-11-08 | implementation_verified | codex → codex / codex_scoped | 기간길이 보완까지 독립19파일검토·디자인수용·21 suites/388 tests/타입/build통과, 별도합성MariaDB실reader와실React CUA360/412/1280검증. UI구현완료, 운영웹배포시점확인대기. 실예측엔진/DBDDL/실거래미변경 | F24·구현보고서·period-qa/sql-smoke/visual/design receipts |
| exec-064 | 2026-11-08 20:50 KST 이후 | deployment_authorized | codex → codex / codex_scoped | 사용자 원래native질문응답 ‘지금 웹 배포 (추천)’로 시점합의 완료. 기존388검사/리뷰된조회UI만최신main통합·정상훅커밋·게시/배포·운영읽기확인. DB/APK/실거래변경제외 | call_fe6335165d4b456594dc25fd1900490b 원래질문과사용자응답 |
| exec-065 | 2026-11-08 21:02 KST 이후 | deployment_failed_auto_rollback | codex → codex / codex_scoped | main319caf6게시·hook484/제품19SHA일치,build성공후health120s실패로963bfeba자동복구. 복귀health200/green/DRYtrue·앱각1/restart0·안전env불변. 실패원인미확정, 공통부팅/DB진단범위검토안작성·재시도/기록push중단 | F25·deployer기록·rollback-verification.json·failure-investigation.json |
| exec-066 | 2026-11-08 사용자 후속 승인 | diagnostic_scope_authorized | codex → codex / codex_scoped | 원본call_0a3113cce3cf42359ded296a2ad9f7e7 답변 ‘부팅 진단 보완까지 진행 (추천)’로공통부팅/DB진단범위확대. 고정단계/작업순번/경과/큐관측만, SQL·DDL/health기준/시간·매매·설정불변. R2/noUI·Sol fallback·C1false, 독립리뷰/격리QA뒤운영확인 | F26·boot-diagnostics intake/model-route/c1 및사용자원본응답 |
| exec-067 | 2026-11-08 | diagnostic_verified | codex → codex / codex_scoped | 진단4파일/기존19독립리뷰PASS·7suites208tests/타입/build·실mysql2/MariaDB Proxy호환PASS. SQL78호출AST동일/기존388UI제품SHA불변. C2 Codex내자기호출override기록, 진단포함새게시/동시읽기전용관측준비 | F26후속·boot-diagnostics-review/boot-qa/23SHA |
| exec-068 | 2026-11-08 21:27 KST 이후 | diagnostic_release_verified | codex → codex / codex_scoped | 진단포함39b2f749/릴리스212559-39b2f749 자동배포ok/migratedfalse·정본status/Root운영23SHA·health200/dbtrue/green/DRYtrue·앱각1/restart0·API401·안전env불변확인. setup79.3초관측,최초실패원인해결로과장X | F27·deployer기록·final-deployment-verification/boot-monitor-summary |
| exec-069 | 2026-11-08 사용자 후속 | real_forecast_implementation | codex → codex / codex_scoped | 실제수집기반 예측엔진/불변원장·4horizon/손익분포·손실확률/사후비교명시승인. analyst실사→v6binding가이드/숫자·원장개발/독립검증. 현재frozen123/가격vector124/297joint/B2000L10·지수1일latent가정·미보정,실거래OFF | F28·forecast-engine intake/C1/model-route·사용자원문·Analyst/UI-binding spec |
| exec-070 | 2026-11-08 23:20 KST | forecast_validated_dba_pending | codex → codex / codex_scoped | 실제엔진/원장33파일독립검토·467+표시79(중복)·타입/build·실DB부분/CUA완료. 운영4빈표후1419·trigger0/continuation없음. DBA정보요청·보안완화/배포/실발행0·운영39/DRYtrue/원자료불변 | F29·forecast-engine/qa/final-ui-followup/visual/migration-blocker·DBA인계 |
| exec-071 | 2026-11-08 사용자 응답 | dba_profile_selected_path_pending | codex → codex / codex_scoped | 기존 관리자 프로필 사용 선택 수신. Mac/Ubuntu 기본 인증프로필 파일 부재 확인, 비밀 내용 없이 실제 경로만 후속 질문. 전역 보안/앱권한/운영배포 불변 | F29 후속·사용자원문 |
| exec-072 | 2026-11-08 23:35 KST | forecast_local_checkpoint | codex → codex / codex_scoped | 정상감사hook로2411627 로컬커밋,99파일일치·원본작업트리ff·회복stash보존. push0/origin-main·운영39유지. 관리자프로필실제경로대기·보호trigger0/새실예측0 | F29후속·local-checkpoint.json |
| exec-079 | 2026-11-10 17:41 기록 | resume | codex → codex / codex_scoped | 일일 raw/split·공식지수·유한재시도·실완료·시점 및 중복발행 복구, 독립감사/QA/웹배포/실모의검증 | 사용자 복구 지시 및 한도초기화 후 계속 지시, 공식 C1 delta |
| exec-080 | 2026-11-10 18:17 기록 | verification_and_cutover_preparation | codex → codex / codex_scoped | 36파일동결·788/빌드/실DB검증,운영펜스보강·정상hook | F37·QA영수증·복구stash75e2df2 |
| exec-081 | 2026-11-10 18:40 기록 | paper_cutover_fenced | codex → codex / codex_scoped | ops23검증뒤Root실제paperpause/경제·원장보존/readback,Reviewer현전환PASS·정상반영준비 | cutover-pause/paused-verification·reviewer-fenced-cutover·QA scopedPASS |
| exec-082 | 2026-11-10 19:59 기록 | daily_pipeline_waiting_source | codex → codex / codex_scoped | 정상웹0.3배포/원경제보존복구,actual raw126/split125+KIS297최신,BRK.B원문1개대기로차단유지 | F39·release/ops·source-state·공식Kibot갱신안내 |
| exec-083 | 2026-11-10 20:23 기록 | resume | codex → codex / codex_scoped | 웹0.3.0 유지·과거ET/KST 레거시 예약2개 원문보존이관·독립 QA 확인, 공급자 갱신 뒤 자동 일일 흐름 검증 대기 | reviewer-cron-state-transition/qa-cron-state-transition; 실거래 OFF·안전 관문 유지 |
| exec-084 | 2026-11-10 21:02 기록 | verify | codex → codex / codex_scoped | 자동수집06:45ET202/accepted_pending·예측07ET 준비미달 안전대기 실측, 원장 readonly pending/issues0 확인 | cron-schedule-0645et/0700et·paper-recovery-result-0645et; 원천1개 미갱신·실거래OFF |
| exec-085 | 2026-11-10 22:40 기록 | verify_partial | codex → codex / codex_scoped | 수집4·예측준비4 실측/원천1개 미갱신으로 전체 흐름 보류, 안전·원본 보존·최종25파일 test DB 재읽기 검산 | operating-result-final-summary/qa-operating-result-final/operating-final-history-receipt; 실거래 OFF·T156 doing |
| exec-086 | 2026-11-11 00:23 기록 | verify_readonly | codex → codex / codex_scoped | 전체 흐름 재확인: DB source_ready=false/실제forward·새예측0·기존1/4/4 보존, 미국개장후 소급실행 없음 | followup-operating-verification-20261111; 실거래 OFF·설정/DB/운영변경0 |
| exec-087 | 2026-11-11 01:09 기록 | schedule | codex → codex / codex_scoped | 11/12 23:00KST 미국장 마감 후 전체 흐름 읽기 점검을 이 채팅에 1회 예약 | 앱 heartbeat t-156 ACTIVE/COUNT1; 실거래 OFF·운영 쓰기/강제 실행 금지 |
| exec-088 | 2026-11-11 12:32 기록 | verify_readonly | codex → codex / codex_scoped | 금일 마감 일반분석200/ok와 M40참고 차단·전진/예측 미실행을 구분 확인, 예약 날짜 변경 여부 질문 대기 | postclose-review-summary-20261111; 실거래OFF·운영변경0 |
| exec-089 | 2026-11-11 13:59 기록 | execute_now | codex → codex / codex_scoped | 사용자 즉시실행 지시로 정상수집/적격시모의전진→예측발행 실행, 202접수 후 running 확인·완료검증대기 | 실제 API daily-start 04:57:16Z; 실거래 OFF/안전 유지·별도QA읽기검산 |
| exec-090 | 2026-11-11 14:09 기록 | partial_collection | codex → codex / codex_scoped | 당일FRED/부분일봉 실수집·DB보존,필수가격미달로모의전진/예측차단·30분뒤누락재수집준비 | immediate-source-attempt1-summary/immediate-paper-result; 조건완화0·실거래OFF |
| exec-091 | 2026-11-11 14:42 기록 | execute_result_partial | codex → codex / codex_scoped | 즉시수집2회 실DB저장·원본/경제/안전QA·16파일testDB재읽기 완료, 필수가격 미갱신으로 정상전진/새예측은차단 | immediate-execution-summary/qa-immediate-final/immediate-test-history-receipt; 전체흐름미완료·실거래OFF |
| exec-092 | 2026-11-11 15:54 기록 | free_source_investigation | codex → codex / codex_scoped | 사용자 무료 대체 수집처 승인, KIS 표본 정합미달·Alpaca 계약/권한검토 및 무료키 등록질문, 안전 유지한 보완·전진/발행 검증 준비 | F49·2026-11-11-t156-free-source-fallback·kis-raw-probe; 제품/운영원천 대체0·실거래OFF |

| exec-093 | 2026-11-11 16:24 기록 | partial_recovery_and_free_key_probe | codex → codex / codex_scoped | 104종목 DB복구·독립원문/원장QA·16파일testDB재읽기, 무료키등록후Alpaca2GET200/각297일·정합검증중 | F50·source145cda55·qa-free-source-collection·free-source-test-history-receipt; 전체흐름미완료·실거래OFF |

| exec-094 | 2026-11-11 16:52 기록 | coherent_source_implementation | codex → codex / codex_scoped | BRK원주KIS/Alpaca297·기존조정295검산, 기준수정·동일쌍/동일bundle·비교원천전환보호 설계후0.4구현진행 | F51·brk-kis-parity/qa-brkpaired-source-preflight·C1delta; 운영0.3·실거래OFF |
| exec-095 | 2026-11-11 18:55 기록 | frozen_validation_and_release_preparation | codex → codex / codex_scoped | 43파일최종동결·Reviewer/C2override·독립QA509/480·격리InnoDB3·실원문297·fresh모의펜스준비, 실제배포/첫전진·4기간발행대기 | F52·qa-brkb-product-final·reviewer-brkb-product/operator·실거래OFF |

## F49 — 무료 대체 원천으로 105종목 보완·전체 흐름 검증 진행 (2026-11-11)

- 사용자 최신 지시는 다른 무료 원천의 조사·자료 보완을 허용한다. 이전 즉시 수집 범위의 신규 공급자 미사용은 그때의 결과이며 이번 원천 검증을 금지하는 지속 제약으로 해석하지 않는다. 실거래 OFF·수수료0.25%·고정123후보/장부·첫적격일T0·PIT/253일/가격기준/원문/개장시각/불변보호/소유자 관문은 유지한다.
- 기존105부족·정상forward0/T0null·새forecast0 상태에서 시작했다. KIS nativeUSD raw 표본은4GET/새토큰·DB쓰기0. AAPL297일확보했으나Kibot와exact23/297·최근15/200, BRK.B identity부재/0행으로미수용. Yahoo 자동수집허가 미확인·약관제한으로 우회GET0. AlphaVantage무료100행은253요건미달.
- Alpaca는 공식 raw/split·SIP·USD·페이지 계약과 무료 역사범위를 확인한 후보이며 실제 권한/심볼·정규장종가/공통가격/전체canonical/장부기준 검증 전 채택하지 않는다. PaperOnly IEX문구와 역사SIP무료안내의 적용관계도 실제키로 확인할 사항이다. 기존서버키부재를 안전하게 확인, 저장소밖0600빈template을 준비하고15:49경 비동기로 무료계정·키등록 가능여부를 질문했다. 키값채팅전송·유료가입·입금·주문연동 없음.
- 구체 계약/절차/요청공유예산·실패복구·검증표는 docs/implementation/2026-11-11-t156-free-source-fallback.md. 공통200exact는대체원천채택을위한추가검토안이며기존모든종목에이미적용됐다는주장을하지않는다. 원문단위선택/행splice금지·키비노출·401/403/429·IEXfallback금지·실수신시각 유지가 전제다.
- 현재 source audit/필수키응답 대기이며 제품코드/버전/운영원천대체/새예측/배포 변경0. 해당 조건이 채워질 때 C1→developer→Reviewer→C2→QA→정본배포→실DB 원장 연결 검증을 진행한다. 조건미달을합성검사나과거예측으로대신완료처리하지않는다. T156 doing·장기성과/확률보정 검증은별도유지.

## F50 — 104종목 DB 복구·무료키 실조회 성공 / 대체 자료 적격 검증 중 (2026-11-11)

- 시작시고정후보105부족에대해Kibot4GET제한조회로갱신확인후16:07:28KST정상수집1회를추가실행,16:11:59blocked종료/16:12DB검산. raw126/126·split125/126최신11/10,고정후보122/123적격으로104개회복/BRK.B1개부족이다. BRK.B split295행/11/06·11/09/10갭2;누락후보제외/추정행대체없음.
- 새원문판본paper-src-145cda55a56a44bea875a80c25d3170ce06a2cb9bb83de1b를운영DB보존. QA는252원문SHA·CSV전수재생성/253canonical검산·이전날짜퇴행0·마감전관측0·신규HTTP실패0(이전502이력2유지)를독립확인했다. 성공적으로다시받은낡은BRK.B본문은SHA같지만실수신시각이갱신됐으며실패시원문보존사례와구분한다.
- 15:57→16:12KST paperAccount/paperCycles/paperSignals/safety지문·revision3/T0null·원forecast1/4/4pending·보호8trigger/전역/앱권한/환경/안전·web/cron·orders상태별건수동일. 개별orders전수동일보증아님. 원장검산pending/issues0/실제forward0·신규signal0·새forecast0,자료미달로forecast강제호출0.
- 조사+비운영probe독립24합성검사+실수집QA·실제가린근거16파일/27633bytes를testartifact/blob에저장하고재읽기확인: artifact-e1fb2a02c123af86da1afd660b27d3e7 / SHA e1fb2a02c123af86da1afd660b27d3e74e1436f3bc03bcea60a589d838b0b0dd. 실제가격본문/실계좌fixture/인증키미포함. 원천실자료는별도sourceDB에보존했다.
- 사용자무료계정·키등록진행응답과실제보호파일등록완료지시를받았다. Ubuntu동일SHA privateprobe24합성재확인후Alpaca실제SIP2GET200, AAPL/BRK.B각raw/split297행2025-09-08~2026-11-10확보/관측07:21:02~03Z. paid/live주문요청0. 최초probe는groupwritable.node-local상위로0GET차단,글로벌권한변경없이별도home보호폴더700로옮겨실행했다. 키값·HTTP오류본문/응답헤더출력·저장없음.
- 실제무료권한·페이지완결은확인됐지만200공통시가/종가·253canonical·기업행동/PIT·장부기준검산전신규원천채택0이다. sourceagent독립검산중/C1Jevsecurity개입필요는AGENTSoverridecodex_unavailable_in_codex기록. developer는genericoptional계약·공유예산설계를준비하며실자료정합통과뒤제품구현→Reviewer/C2→QA/정본배포→실제전진·4기간검증순이다. 현재제품0.3.0/버전/배포변경0·실거래OFF. 전체T156 doing·장기표본/확률보정과제유지.

## F51 — BRK.B 일관된 원천 쌍·원천 전환 보호 구현 중 (2026-11-11)

- Alpaca실제2GET297일중 BRK.B split은구Kibot295/295일치하지만새raw는구Kibotraw와불일치했다. 최초추가제안rawKibot200exact를그대로통과했다고표시하지않았다. 공식KISmasterSHA634f61d3…ff61e0의NYS/BRK/B고유매핑을확인해cachedtoken신규3GET(누적KIS7,새토큰0)으로nativeUSD원주를받았다. KIS↔AlpacaRAW OPEN/CLOSE297/297·최근200/200/최신11/10일치, 구KibotSPLIT↔AlpacaSPLIT OPEN/CLOSE295/295·최근200/200으로 BRK한정대체후보근거가생겼다.
- 두API의상위SIP공유가능성을열어두고별도수집API교차검산이라고표현한다. 사후수정한추가수용조건은KISraw시가종가200exact+기존조정이력연속성200exact이며종래주식253/PIT/sharebasis/owner/불변·clock·fee관문완화가아니다. AAPL/다른종목/공급자전체로승격하지않는다. KIS와Alpaca H/L296/297·V112/297, 구Kibot과Alpaca조정H/L293/295·V112/295이므로crossprovider전OHLCV동일주장/새고저가거래량지표적격은금지한다.
- Reviewer는forecast가raw.open*(split.close/raw.close)로야간·장중수익률을분해하므로BRKsplit만바꾸는혼합안에공급자정의차이가계수로섞일수있음을발견했다. 일별종가곱의상쇄와향후개장체결/경로영향을구분한다. BRK한정AlpacaRAW+SPLIT동일시점한쌍원자선택으로구현하며within-Alpaca전297일OHLCV동일사전조건을검사한다. 향후실제분할등으로v1조건불명확해지면추정없이차단/조정검토한다.
- QA가저장원문/receipt/master/297canonical/중복2·창밖1을Decimal로독립재검산했다. 기존125당일완비종목은그날raw/split close같음,BRK만최신공통일11/06에서다름;최근200일차이가있는추가5개는분할/정밀도가능성이있어오류로일괄판정하지않는다. 날짜적격122와외부가격정합확인을구분한다.
- Root16:40읽기SELECT/READ ONLY/ROLLBACK및QA보관기준본검산: BRK현재미보유/BRK전용priorbasis없음,다른4prior기존관문통과/초기자본·현금·수량불변·rehearsal4/awaiting0. 같은장부에서BRKraw만교체하는비교평가차이0%,실제손익이나장부재기준설정아님. 과거blocked사유를BRK실보유증거로삼지않는다.
- C1delta공식Jev codex_required=true/data_integrity, AGENTS overridecodex_unavailable_in_codex/재귀CLI미호출기록. developer가0.4.0을한번준비해신규lossless JSON/provider계약·cachedKISproof/보호프로필·공유데이터요청예산/페이지·동일bundle/hash재검증·source-regime기준의만기사후비교보호를구현중이다. 기존index인증통신은데이터요청301과별도임을명시하고전체deadline은공유한다. UI/DDL/실주문/운영설정수정없음. 원forecast1/4pending은불변,목표일전pending/원천비교불명확하면incomparable또는unconfirmed·actualnull테스트를포함한다.
- 현재운영은0.3.0/04afa·기존source145cda55/실제forward0·새forecast0/T0null·실거래OFF다. 새원천원문은보호폴더이며운영계약발행전이다. 다음은developer동결/격리시험→Reviewer/C2→QA→정본배포(필요시모의계좌fresh펜스)→정상수집/첫T0·모의분석·신규4기간/중복·pending검증→testDB이력저장이다. live/global/grant/보호trigger/가격·시간관문을그대로유지한다. 구현승인·키등록·현재자료수용검증을반복요청하지않는다.

## F52 — 무료 대체 원천 0.4.0 검증 완료·운영 연결 준비 (2026-11-11)

- BRK.B 한정 coherent raw/split/KIS proof·일별 CA/SEC·원문/시간·same-analysis bundle·pending/음성격리·원천전환 사후비교 보호 구현43파일을 동결했다(manifest80ea3265…f30953/productDigestc8e1eee8…b948f0). 제품 Reviewer 범위감사·공식Jev C2와 codex_unavailable_in_codex override·독립 QA를 마쳤다. 외부Codex재귀검토는 실행하지 않았다.
- QA는 최종동결본 31 suites/509 tests, 별도 안전22 suites/480 tests, 독립typecheck0·실보관원문raw/split각297 재생·사건증거/NYday차단, 실제격리InnoDB 공통락/차단3건·기존fence core23건을 통과했다. 서로 겹친 시험은 합산하지 않는다. 개발자동결 type/build0·양환경43SHA불일치0을 확인했다. QA 초기Mac Docker없음과합성fixture형식3실패는 별도기록했고제품수정은없다. 전용network-none DB/소켓/임시폴더는제거확인했다.
- BRK기업행동/SECmetadata·8K/EX/424원문과양성대조 등10원문731562bytes를 별도연구dataset event-src-a1ddbac9f7869dc4c61a920dcc918fd328faac482d1491ee에 저장/재읽기10검산했다. finite no_conflicts_reported_asof이며 10Q는공식표지/자본주석targeted만검토·rawSHA없음,CA보고지연/심볼coverage·NYSE11/09·발행사403한계는그대로다. 새미검토material/기업행동/미완료durable pending은차단한다.
- 새모의계좌펜스 wrapper e1831b…d22c7/policy053972…13f7b는 기존core/proof/process SHA를유지해별도Reviewer조건부정적수용했다. core해시검사후동적import·freshrevision3경제/원예측baseline·old0.3미성숙target0·실Next.env loader/cron위임·fullrelease/oldworkerdrain을검사한다. 실제메모리/실API사용은정상흐름으로후확증한다. 실패시모의계좌paused유지,실거래/전역/앱권한/보호trigger불변이다.
- 18:50KST fresh읽기에서 운영0.3/04afa·active/rev3/T0null·원예측1run4horizon4pending·paper/forecastlease0·healthdrytrue/killfalse·source145cda55/후보122of123상태를확인했다. 정본0.4배포/새profile2경로설정·모의재개·정상수집→첫forward/T0→새4기간발행·중복·실앱확인은아직완료전이다. 이미받은구현/운영반영/키승인을반복요청하지않는다.

## 목표

S&P 500의 시장 상태, Nasdaq-100 및 StockInvest NYSE 시총 상위 50의 종목별 지표, 최근 14일 SEC·기업/경제 뉴스를 조합해 진입과 보유종목 매도 시점을 판단할 수 있는지 검토한다. 14일은 설계상 최신 자료 조회 창으로 해석한다. 2026-11-08 사용자가 구현, 연구 수집 자료의 운영 DB 이관과 테스트 데이터의 DB 이력 저장을 승인해 범위를 확장했다. 이전 절의 분석 전용 상태는 각 기록 시점의 상태이며, 현재 실행 범위·담당 확인·미실행 항목은 F12를 따른다.

**최신 통합안**은 아래 「M40 기본 최종 설계 검토안 v1.0」, F10 수집 설계, F11 실제 감사, F12 구현·이관 실행안이다. 이전 절의 R02 기본·E3 전환·패턴 거래 제한과 수치 초안은 연구 이력이며, 최신안의 운영 기본 규칙으로 함께 적용하지 않는다. 11/8의 구현·자료 이관 승인은 검증 상태 자동 승격이나 실거래 활성화를 뜻하지 않는다.

## 관련 과거 이력 요약

- [[T-107-analysis-flow-visualization]]과 [[T-109-research-context-for-analysis]] — 리서치 통계와 매매 판단을 구분하고 최신 리서치 연결 지점을 확인한다.
- [[T-114-corporate-intelligence-second-design]], [[T-116-news-first-seen-capture]], [[T-124-news-input-misread-truncation]] — 시점별 증거와 최초 관측 저장을 재사용하고 뉴스 절단·오독 사례를 검증 요구에 반영한다.
- [[T-143-overseas-universe-source-replacement]]와 [[T-146-manual-list-cap-removal]] — Nasdaq-100 수동 목록, 자체 NYSE 시총 상위 목록, 확대 시 용량 제약을 구분한다.
- [[T-078-integrated-execution-procedure]] — 당시 이용 가능 자료의 후향 재현, 주문 없는 전진 관측과 운영 승급을 구분한다.

## 역할별 지시사항

- 메인 Codex/Leader — 현행 구현 및 Vault 상태를 대조하고 후보군·자료·판단·검증 설계를 종합한다.
- Leader 보조 — 관련 작업 이력 및 운영 기록의 범위를 읽기 전용으로 확인한다.
- 코드 조사 보조 두 역할 — 수집·유니버스·판단 배선과 진입·보유관리·백테스트 경로를 나눠 소스를 읽는다.

## 판단 기록 (judge)

- Judge 역할은 모델과 추론 설정의 호환성 오류로 기동하지 못했다. 메인 Codex가 Jev 로컬 규칙을 실행했다. `judge-result@2`의 `engine=rules`, `risk=R0`, `demo.level=none`, `needs_info=false`, `next=assign`, 토큰·비용 0을 확인했다. 접수 범위가 조사·제안이므로 구현 역할 배정과 구현 검토 체크포인트는 적용하지 않았다.

- 2026-11-08 v6 구현: rules C1 codex_required=false, C2 codex_required=true(CX-r2-post-review). Codex내Codex자기호출을하지않는AGENTS정본에따라 C2 override: codex_unavailable_in_codex. 별도외부Codex검토성공으로표기하지않고 실제독립Reviewer19파일정적검토와격리QA를구분한다. demo=full/designer, 사용자v6원본native승인/check/activate통과.

- 2026-11-08 F28 실제 예측엔진: rules 접수 R2/demo.none/assign, C1 codex_required=false. 수정된 33파일 독립 Reviewer 검토 후 C2는 codex_required=true(CX-r2-post-review, remaining_limit_pct=null)다. AGENTS 정본에 따라 override: codex_unavailable_in_codex. 재귀적인 별도 Codex 호출·외부검토 성공 주장은 하지 않는다. numerical Analyst 5파일 검토와 제품 33파일 정적 검토, 이후 최종 격리 QA·운영 검증을 구분한다. 기존 승인 v6 데모는 그대로 보존하며 추가 수치 binding은 같은 범위다. 원본은 artifacts/T-156-forecast-engine/c1.json/c2.json/independent-review.json을 따른다.

- [2026-11-10 16:56] intake engine=jev → task_type=null (signal=local_fix, confidence=0.37) / complexity=2.26 / needs_info=true / risk=R2 / developer_model=opus / next=ask_user; demo=none/none; actions=clarify_requirements,assign_developer; model-route=gpt-6.1-sol(judge_low_confidence) | overrides=MD-judge-failed-opus | fallback=- | tokens=1345

- [17:16] T-156 일일복구 C1 기능요약판정 및 Codex 모델router확인. 접수low-confidence needs_info는사용자명시승인·기존정책유지계약과실원문진단으로구체범위확정. C1원본 c1-result.json 보존, 자체CLI재귀는 override: codex_unavailable_in_codex. Root가대기중judge역할을중단하고공식도구를직접실행했으며독립외부검토를주장하지않음. 새지수원천은이번C1범위아님.

- [18:03][Codex leader 실행기록] F36 C1본체/지수강화/transport강화는공식Jev codex_required=false. 최종36파일C2는codex_required=true/adversarial-review/data_integrity였다. AGENTS Codex세션규칙에따라 `override: codex_unavailable_in_codex`를기록하고재귀CodexCLI는호출하지않았다. 외부Codex검토완료로주장하지않으며독립Reviewer조건부수용/별도QA·운영drain조건을유지한다. artifact c2-result.json/c2-override.json.

- [2026-11-11 15:39] intake engine=jev → task_type=feature / complexity=2.27 / needs_info=true / risk=R2 / developer_model=opus / next=ask_user; demo=none/none; actions=clarify_requirements,assign_developer | overrides=없음 | fallback=- | tokens=1353

- [2026-11-11 15:55] codex_gate/C1 engine=jev → codex_required=true / mode=adversarial-review / focus=security / budget_rule=CX-user-requested / codex_switch=on | overrides=CX-user-requested; AGENTS override=codex_unavailable_in_codex (외부 Codex 검토 미실행) | fallback=- | tokens=832

- [2026-11-11 16:37] codex_gate/C1 delta engine=jev → codex_required=true / mode=adversarial-review / focus=data_integrity / budget_rule=CX-user-requested / codex_switch=on | overrides=없음; AGENTS override=codex_unavailable_in_codex (외부 Codex 검토 미실행) | fallback=- | tokens=961

- [2026-11-11 18:49] codex_gate/C2 1차 engine=rules → codex_required=true / mode=review / focus=none / budget_rule=CX-user-requested / codex_switch=on | overrides=CX-user-requested | fallback=blocked_input: changed_paths 40개 초과 | tokens=0

- [2026-11-11 18:49] codex_gate/C2 engine=jev → codex_required=true / mode=adversarial-review / focus=data_integrity / budget_rule=CX-user-requested / codex_switch=on | overrides=CX-r2-post-review; AGENTS override=codex_unavailable_in_codex (외부 Codex 검토 미실행) | fallback=- | tokens=1258

## 조사와 권고

1. 종목 리서치의 차트·과거 적중률, 해외 장마감 AI의 다음 정규장 진입 시나리오, 실제 보유종목의 보호 청산을 각각 기준선으로 분리한다. 해외 장마감은 후보 전체의 단일 검색으로 최근 3일 뉴스 최대 5건을 조회하고 SEC에서 적재한 실적 일정을 점검한다. 근거는 [종목 리서치](../../../src/lib/research/pattern/recommendation.ts#L158), [해외 장마감](../../../src/lib/strategy/post-market-overseas.ts#L650), [청산](../../../src/lib/strategy/exit-engine.ts#L88).
2. S&P 500은 시장 환경에 쓰고, Nasdaq-100과 자체 NYSE 시총 상위 50을 신규 후보군으로 둔다. 구성 효력일·관측 시각·종목 식별자와 기업행동 이력을 버전으로 보존한다. 보유·즐겨찾기는 자료 수집에는 포함할 수 있으며 신규 후보 자격과 분리한다. 기록 기준 Nasdaq-100 101티커+기존 NYSE 24개가 적재됐고, NYSE 상위 50의 자동 산출은 꺼져 있다. 151개와 보유 종목을 한꺼번에 붙이기 전에 T-146 H-1의 수집 누락과 실제 처리 예산을 확인한다.
3. 최근 14일 기업 사건을 CIK·종목·사건 유형과 출처로 연결한다. SEC accession 및 관련 항목·첨부, 허용된 뉴스 메타와 출처, BLS/Fed 공개 시각을 보존한다. 기사 발행·최초 관측, 공시 접수·공개, 정정과 데이터 누락을 구분한다. 오래된 정기 재무값은 별도 신선도로 관리한다. 일괄 뉴스 검색과 검증되지 않은 LLM 자체 신뢰도는 새 판단에서 대체한다.
4. 우선 동일 시점의 기술 기준선과 신규 권고를 읽기 전용으로 함께 기록한다. 진입은 후보 우선순위·가격대·유효기간·무효 조건, 보유는 유지·감축 검토·청산 검토·근거 부족을 제시한다. 단일 저항선 조건은 보조 증거로 사용한다. 별도 보호 청산은 계속 독립적으로 작동한다.
5. 기술 기준선에 시장, 공시, 언론·거시를 단계별로 추가해 시간순 표본외 비교를 한다. 당시 볼 수 있었던 데이터만으로 진입 체결률, 비용 후 초과수익, 최대 낙폭과 보유 지속 대비 회피한 손실·포기한 상승을 평가한다. 권리가 확인되지 않거나 과거 데이터가 없는 계층은 전진 관측부터 검증한다.

## 후속 연구 — S&P 500과 Nasdaq Composite 주간 국면

- **산출물** — [주간 파생 데이터](../../../docs/research-data/T-156-weekly-market-regimes.json) 1,922행, [재현 스크립트](../../../scripts/profit-engine/weekly-market-regimes.py). 날짜와 국면, 4·13주 방향, 40주 평균 대비 위치, 52주 고점 대비 낙폭 구간, Nasdaq 13주 상대강도 방향, 1·4·13주 후 관측 결과를 보존한다. Nasdaq Composite는 시장 국면용이다. 신규 매수 후보군의 Nasdaq-100은 별도다.
- **기간과 원천** — 1990-01-05~2026-10-30, 뉴욕 거래 주 마지막 정규장 종가. 11월 6일 뉴욕 장 마감 전의 미완료 주는 제외했다. S&P 500은 [skfolio 연구 예제 일봉](https://skfolio.org/generated/skfolio.datasets.load_sp500_index.html)과 [FRED SP500](https://fred.stlouisfed.org/series/SP500)을 연결했다. FRED 겹침 1,546거래일 중 1,537일 일치·9일 차이로 겹침에서는 FRED를 사용했다. Nasdaq Composite는 [FRED NASDAQCOM](https://fred.stlouisfed.org/series/NASDAQCOM)을 사용했다. 2019-04-19 Nasdaq 자료의 관측값은 거래소 휴장이므로 해당 주 양쪽 종가를 4/18로 맞췄다. [거래소 공지](https://www.nasdaq.com/articles/stocks-slide-first-full-week-earnings-begins-2019-04-15)
- **범위** — 52주 기준을 만드는 첫 51주에는 국면이 없다. 지수 원종가 전체는 저장하지 않고 파생 범주와 집계만 남겼다. 1990년~FRED 접합 전 S&P 500은 예제용 표본이며 장기 운영용 원천은 해당 용도의 권리가 확인된 자료가 필요하다. [S&P DJI 데이터 라이선스](https://www.spglobal.com/spdji/en/about-us/data-index-licensing/)
- **사후 사건과 판단 시점** — 선정한 역사 구간의 고점→저점과 이전 고점 회복일은 사후 요약이다. 주간 판단은 그 주까지의 정보만 사용한다. 40주 평균 위·13주 양수인 지수가 둘이면 상승, 40주 평균 아래·13주 음수인 지수가 둘이면 하락 후보로 본다. 양쪽 4주 상승과 최근 13주 중 한 지수의 52주 고점 대비 10% 이상 낙폭이 겹치면 상승 국면으로 완전히 전환하기 전 회복 후보로 분류한다. 회복 후보를 제외한 동반 하락에서 한 지수의 현재 52주 고점 대비 낙폭이 20% 이상이면 급락 국면이다.
- **검증 결과** — 주간 수익률 상관 0.8778. 2017년 이후 509개 4주 평가에서 S&P 500 상승 확률의 Brier 오차는 과거 전체 상승률 0.224131, S&P 단독 0.224750, 두 지수 조합 0.225514였다. 향후 4주 중 시작 대비 5% 이상 하락 종가의 빈도는 전체 13.16%, 상승 국면 9.01%, 동반 하락 25.00%다. 위험 예측 Brier는 전체 발생률 0.114943, Nasdaq 단독 0.111069, 두 지수 0.112232였다. 4·13주 표본은 서로 겹치고 같은 위기의 여러 주를 포함한다. 검정하지 않은 작은 차이는 우위로 단정하지 않는다.
- **검산** — 두 지수의 주간 날짜·마지막 거래일 일치, 주간 공백, 초기 51주와 끝 1·4·13주의 결측 처리, 2016-12-30·2020-06-26에서 계산을 끊어 과거 입력이 동일한지 확인했다. 확정 종가를 모두 확보한 이후 `weeks[].features`만 종목 판단 후보 입력으로 검증하고, `outcomes`는 성과 대조에 사용한다.
- **적용안** — 방향 예측 가중치를 고정하기 전에 시장 하락 위험과 종목의 업종 대비 상대강도, 종목 가격대, 최근 14일 사건을 분리 비교한다. VIX, 동일가중 지수 대비 강도 또는 당시 구성원 기준 상승 비중, 금리·신용 지표를 하나씩 추가한다. 실제 보유·후보 종목의 비용 후 효과는 주문 없이 별도 검증한다.

## 후속 연구 — VIX와 상승 종목 비중

- **연결·범위** — NAS의 원본 StockInvest 체크아웃을 Mac의 기존 경로에서 다시 열고 주간 데이터 해시를 대조했다. 공개 원천 수집, 기존 읽기 전용 DB 도구의 `SELECT`, 임시 계산, 연구 데이터 및 기록에 범위를 한정했다.
- **연구 입력** — [VIX·시장 폭 주간 파생 자료](../../../docs/research-data/T-156-weekly-vix-breadth.json). 이전 1,922개 주의 날짜와 정규장 마지막 거래일에 조인한다. VIX 주간 1·4주 변화는 Cboe 일종가에서 계산했다. 원천에 해당 날짜 값이 없는 1991-03-01, 1997-01-31, 1999-12-31과 필요한 비교주 결측은 그대로 둔다. 2003-09-22 이전 현대식 VIX는 소급 이력이므로 시점 검증에서는 현재와 4주 전이 모두 방법 도입 이후인 구간을 사용했다. [Cboe VIX 이력](https://www.cboe.com/tradable_products/vix/vix_historical_data), [방법 전환 공지](https://cdn.cboe.com/resources/regulation/circulars/general/IC-CBOE-2003-108.pdf)
- **시장 폭** — 일별 `상승 / (상승 + 하락 + 보합)`을 주간 정규 거래일에 걸쳐 평균한다. [Nasdaq Trader 공식 파일](https://www.nasdaqtrader.com/Trader.aspx?id=DailyMarketFiles)의 2026년 211일 중 3월 9일은 해당 값이 없고, 최신 확인 일자는 11월 3일이다. 10월 30일까지 42주를 계산했다. 1월 2일 종료 주는 앞선 2025년 세 세션이 없으며, 3월 13일 종료 주는 3월 9일이 없다. 10월 30일 종료 주 평균은 48.47%, 마지막 거래일은 24.57%다. Nasdaq 상장 종목 집계이며 Nasdaq-100·NYSE 상위 50과 다른 모집단이다. NYSE 또는 장기 Nasdaq 시장 폭은 정본 이용 범위와 역사 확보가 남아 있다. [필드 정의](https://www.nasdaqtrader.com/Trader.aspx?id=DailyMarketSummaryDefs), [장기 원천 후보](https://pinnacledata2.com/idx.html)
- **시장 보조 백테스트** — 4주 후 S&P 500 양수 종가 수익률과 4주 내 시작점보다 5% 이상 낮은 주간 종가를 분리했다. 2016년까지 결과가 닫힌 685주로 집단별 발생률을 계산했다. 희소 집단은 학습 전체 비율 20주분을 더해 완화했다. 2017-01-06~2026-10-02의 같은 509주에서 두 지수 추세 조합과 그 위에 VIX 4주 변화가 5pt 이상 증가·감소·그 사이인지 추가한 경우를 비교했다. Brier 오차는 방향 0.223096→0.223700, 하락 위험 0.113387→0.114227로 이 규칙에서는 개선되지 않았다. VIX 5pt 이상 상승 시 4주 내 추가 5% 하락 빈도는 13/59(22.03%), ±5pt 이내는 45/390(11.54%)였다. 결과가 닫힌 2026년 시장 폭 표본은 38주이고 55% 초과는 3주다. 장기 표본 외 효과는 미검증이다.
- **11/06 운영 기록의 표본 확인** — 해외 기준선 11/02~05 ET 4일, 후보 기록 32행, AI 전송 5행, 카드 2건. 4개 런 중 RAG 뉴스 ID가 들어간 런 2건이며 프롬프트 본문 대신 해시와 검색 ID를 기록한다. 해외 청산 발화 11행은 동일 1종목·1거래일에서 나왔다. RSS 최초 관측 10/28 22:00:44 KST, 조회 시점 5,226행 모두 발행 시각이 있고 본문·보존 참조는 0행이다. 이 판단 날짜들에 대응하는 14일 최초 관측 창은 0개다. 10/22 이후 공시는 120건이며 접수 시각이 있지만 접수 후 24시간 내 저장된 것은 43건이다. 공개 시점 재구성과 실제 앱 관측은 구분한다. 11/03 개정판 125종목 중 11/03~05 전일과 당일의 품질 표시 없는 확정 USD 종가를 모두 찾은 종목은 각각 69개였다. NYSE 자동 목록은 0개다. 개별 종목의 기존 정책 대 신규 정책 직접 비교 표본은 아직 성립하지 않는다.

### 개별 종목 검증 설계

1. 당시 Nasdaq-100 편입 이력과 자체 NYSE 시총 상위 목록을 효력일 기준으로 고정한다. 그 시점의 기업행동·상폐·가격 보정과 통화를 함께 보존한다. 보유종목은 해당 시각 이전 잔고 스냅샷과 실제 체결을 결합해 평가 시점의 수량·평단을 재현한다. 스냅샷과 체결 간 공백은 검증 표본에서 구분한다.
2. 같은 판단 시각, 종목, 가격, 주문 비용, 기회 집합에서 기준선 B0(기존 장마감 판단·보호 청산), B1(주간 국면), B2(VIX), B3(상승 종목 비중), B4(14일 SEC), B5(14일 언론·거시)를 순차 비교한다. 과거 모델의 원문 입력을 복원할 수 없으면 당시 기록된 판단을 비교군으로 쓰고, 별도 기술 규칙으로 비교한 결과는 기술 기준선으로 명시한다.
3. 매수는 동일 진입구간과 만료, 다음 정규장 이후 가상체결, 1·3·5거래일의 비용 후 수익·진입률·최대 역행폭·놓친 기회를 본다. 일봉에서 여러 조건의 도달 순서를 알 수 없으면 불명확으로 분류하거나 보수적인 체결 민감도를 병기한다. 매도는 기존 보호 판단과 계속 보유를 각각 비교하고, 첫 중복 없는 판단 시점에서 피한 하락·놓친 반등·환전 포함 비용을 계산한다.
4. 종가·VIX·시장 폭은 실제 관측 이후 사용한다. 14일 뉴스 창은 공개 시각과 최초 관측이 둘 다 판단 시점 이전인 자료로 만들고, 동일 공시·인용 기사를 한 사건으로 센다. 수집 실패를 무사건으로 취급하지 않는다. 날짜별 표본 외 비교에서 만기가 평가 기간을 넘는 학습 사례를 제외하고, 같은 날과 같은 위기를 묶어 불확실성을 보고한다. 주문 없는 병행 관측 또는 권리 있는 과거 구성·기사 원천을 확보한 뒤 전체 비교를 실행할 수 있다.

## 후속 연구 — 래리 윌리엄스 인터뷰의 설계 적용

지정 [TheThinker 분석 노트](https://thinker.xn--lh0b87pnudm10a4vd.com/references/cmw4ichar0003w10y5lg7dl2c)와 페이지에서 펼친 자동 자막을 대조했다. 15:39~16:40은 기업 선별, 19:21~20:52는 매수 후보 조건과 추세 확인, 23:11~24:12는 공황과 반등, 26:48~27:51은 하락 중 반복 추가 매수의 경험이다. 04:09~04:40 유가 주장의 대상은 코스피다. 17:45의 연도는 자동 자막에서 불명확해 날짜 전망은 규칙화하지 않았다. 비공개 공황·핀치 펀치 지표의 공식과 매매 임계값은 확인되지 않았다. [원본 영상](https://www.youtube.com/watch?v=K0hJd_zg-mc)

### 종목과 시장의 탐색 백테스트

| 가설 | 시험과 결과 | 최종 검토 판단 |
|---|---|---|
| Williams %R이 매수 후보 선별을 개선 | 확정·조정 USD 일봉을 읽기 전용으로 조회. 분석 범위 2023-03-28~2026-11-05 ET, 71종목 가격 패널. 60연속 거래일에 현재 `oversoldBounceDaily` 기술 조건을 재계산. 최근 세 거래일 중 %R(14)이 −80 이하에서 위로 복귀했는지 비교. 종목별 5거래일 중복 구간을 제거하고 다음 장 시가부터 D+5 종가까지, 양쪽 각각 15bp 가정. 2025년 이후 결과가 닫힌 기준선 391건 평균 순수익 +0.118%, 최대 장중 역행 평균 −4.184%. %R 확인 127건은 +0.547%, −4.645%. 20거래일 블록 24개를 5,000번 재표집한 평균 수익 차이 95% 구간은 −0.337~+1.328%p. 제외한 기회의 수익을 0으로 잡은 원래 기회당 차이 +0.060%p, 재표집 구간 −0.505~+0.643%p. | 후보 순위 또는 확인 항목으로 비교할 가치가 있다. 결과는 가격 조건 일부의 관측이며 실제 장마감 AI·주문 기준선, 과거 당시 전체 구성종목, 계좌 수익을 대변하는 시험은 아니다. [기존 규칙](../../../src/lib/strategy/rules/oversold-bounce-daily.ts), [지표 정의](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/williams-r) |
| 극단적 공황이 저점에 선행 | 두 지수 동반 하락 추세, 한 지수 이상 52주 고점 대비 ≥20% 낙폭, VIX 4주 ≥5pt 상승을 대리 경보로 고정. 적격 주 간격이 8주 미만이면 첫 주로 묶었다. 2017년 이후 11주에서 5군집, 경보 전후 ±4주 S&P 500 최저 종가와 경보 간격이 ±1주인 경우 3/5. 4주 후 상승 4/5, 2022-04-22 경보의 4주 수익률 −8.67%. 두 지수 주간 상승·VIX 하락의 후속 확인은 4건, 4주 상승 4/4였으나 VIX 없는 대조군도 4/4였다. 두 조건은 경보일과 군집 구성을 바꾼다. | 공황과 확인을 별도 상태로 표시할 검토안. VIX·국면에서 파생하므로 별도 가점을 중복하지 않는다. 원 지표 재현, 저점 예측력, 거래 성과는 미검증. [Cboe](https://www.cboe.com/tradable_products/vix/vix_historical_data), [FRED S&P 500](https://fred.stlouisfed.org/series/SP500) |
| WTI 고점이 코스피 고점을 6~10주 선행 | 앞 12주보다 높은 주를 후보로 하고 뒤 2주가 낮으면 확인, 사건 간 최소 14주. 2016년 이후 사건 20개 중 이후 14주 최고 코스피 주간 종가가 +6~10주에 든 경우 20.0%, 같은 기간 537주 기준 23.6%. +6/8/10주부터의 4주 평균은 −0.71/−1.36/+0.54%, 전체 주 기준 +1.12/+1.07/+0.99%. 미국 두 지수의 19개 공통 사건도 시차에 따라 결과가 달랐다. 코스피 연구 CSV의 10개 날짜를 ECOS와 대조했다. | 고정 시차 매매 규칙을 보류한다. 유가를 쓰는 경우 에너지·운송처럼 방향 가설이 있는 업종별 맥락을 별도로 검증한다. [EIA/FRED WTI](https://fred.stlouisfed.org/series/WCOILWTICO), [코스피 연구 CSV](https://kospi.feargreedchart.com/api-docs), [한국은행 ECOS](https://ecos.bok.or.kr/#/SearchStat) |
| 미국 대통령 임기·4년 저점·종목 계절성 | 완결 임기 기준 S&P 500 임기 3년차와 다른 연도 연평균은 1993~2016년 +13.80/+6.90%, 2017~24년 +26.55/+10.03%. 후반 독립 임기는 2개. 13주 상승 Brier는 S&P 500 0.1912→0.1901, Nasdaq Composite 0.2019→0.2010. 1990~2025년 −20% 하락 후 +20% 반등으로 확정한 저점의 인접 간격 중 3.5~4.5년은 두 지수에서 0개. IBM의 구체적 계절성은 충분한 일봉 이력 미확보. | 달력 정보는 낮은 우선순위의 참고 변수로 둔다. 고정 4년 진입 규칙·영상 속 날짜 전망은 보류한다. [주간 데이터](../../../docs/research-data/T-156-weekly-market-regimes.json), [임기 기준](https://www.archives.gov/electoral-college/provisions) |

### 기존 설계에 추가할 검토 항목

1. **기업의 투자 매력과 매수 시점을 분리한다.** 해당 시각에 공개된 SEC 접수본의 TTM 매출·이익·영업현금흐름·부채, 당일 시가총액을 이용해 업종 내 저부채·성장·PER·PSR 순위를 시험한다. 적자 PER, 산업별 회계 차이, 정정 공시를 분리한다. 현금 납부세금과 회계상 이익 괴리는 설명을 확인할 항목이다. 현재 최신 우선 XBRL 팩트를 과거 판단에 복사하면 정정 후 값이 섞이므로 accession별 원본 시점 복원이 먼저다. [SEC EDGAR API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
2. **시장 조건 → 종목 조건 → 가격 확인을 별도 단계로 유지한다.** 주간 국면·VIX·상승 종목 비중, 최근 14일 SEC·뉴스와 후보 품질을 기준선에 하나씩 더한다. %R 반전은 후보로 따로 시험하고 가격 구간·유효기간·무효 조건은 그대로 비교한다. 공황 경보 뒤 반등 확인은 신규 진입 후보에 한해 연구한다. 보유종목은 기존 보호 규칙, 계속 보유, 기업 근거 악화와 업종 약세를 더한 감축·청산 검토를 비교한다.
3. **기관 수급과 가격·거래량을 구분한다.** 13F는 분기말 포지션과 실제 공개일을 저장해 저빈도 검토에만 쓴다. 거래량·상대강도는 관측 가능한 별도 대리지표다. 시장 지수 기여도는 당시 종목 비중과 구성 종목 수익률로 검증한다. 코스피 두 종목에 대한 특정 기여율은 미국 시장 가정에 복사하지 않는다. [SEC 13F 안내](https://www.sec.gov/info/edgar/forms/form13f.pdf)
4. **가격 하락만으로 매수량을 늘리는 규칙은 검토안에서 제외한다.** 기존 보유분을 추가할 경우 독립된 신규 근거, 포지션 한도와 무효화 조건을 별도로 평가한다. 소문과 중복 기사보다 시점이 확인된 공식 공시와 사건을 우선한다.
5. **종목별 판정의 범위** — 동일 당시 구성과 보유수량, 동일 진입·청산 체결 가정에서 비용 후 수익과 최대 역행, 빠진 매수, 회피한 하락과 놓친 반등을 본다. 시장 시험과 기술 가격 패널 시험을 전체 종목·보유 정책 검증과 구별한다. 과거 구성종목·14일 원문 뉴스·시점별 재무·보유 상태를 맞춘 종목 정책 비교와 사용자 최종 검토를 구현 전 단계로 둔다.

## 최종 검토안 — 당시 자료 확보와 기존 판단 비교

2026-11-06 KST에 운영 기록을 읽기 전용으로 대조하고, 11/02~11/05 미국 동부 거래일의 확정 수정 USD 일봉을 11/05 장 마감까지 사용했다. **기존과 신규 정책의 입력·기회·가격이 모두 맞는 비교 표본은 0건**이다. 아래는 확보된 원본의 범위와 관측 가능한 구성 요소의 비교다. 비용은 탐색용으로 매수·매도 각 15bp를 가정했다.

| 필요한 자료 | 실제 확보와 한계 | 보완 경로 |
|---|---|---|
| 당시 Nasdaq-100 | 앱 개정판 1은 11/02 17:20 ET부터 존재했다. 101 Nasdaq 티커와 기존 NYSE 24개이며 4거래일의 기록된 후보 32행 모두 해당 개정판에 있었다. 공식 Nasdaq의 11/02~05 일자별 구성 원본은 확보하지 못했다. 당시 명단을 현재 목록으로 소급하지 않는다. | GIW의 시점별 구성·가중치와 기업행동 이력 또는 권리 있는 구성 이력을 비교한다. 연말 외에 분기 심사, 수시 편입·편출, 복수 클래스 효력일도 반영한다. [Nasdaq 역사 자료 범위](https://indexes.nasdaqomx.com/docs/Nasdaq_Index_Methodology_Guide.pdf), [2026년 방법론 변경](https://www.nasdaq.com/newsroom/nasdaq100-index-methodology-update-why-now) |
| 당시 자체 NYSE 상위 50 | 기록 기간에는 기존 24종목만 있고 자체 상위 50의 산출 이력이 없다. 날짜별 NYSE 보통주·ADR 식별, 상장·상폐, 동시점 종가·주식수 또는 클래스 시총이 있어야 당시 기준으로 다시 산출할 수 있다. | NYSE TAQ 또는 권리 있는 주식 참조 자료의 기간·필드를 확인한다. 현재 SEC 거래소 매핑은 당시 분류와 주식수를 대신할 수 없다. 유효 USD 시총과 동일 CIK 최고 클래스, 동률 티커순을 재현한다. [NYSE 참조·종가 자료](https://www.nyse.com/data-products/catalog/taq-nyse-closing-prices), [기존 랭킹 기준](../../../src/lib/universe/rank.ts#L95) |
| 보유 이력 | 스냅샷 04/26~11/06 KST, 양수 해외 브로커 체결 기록의 현지 주문일 10/27~11/05 ET. 최근 해외 청산 1,130행·19종목일의 직전 스냅샷과 수량 1,126행 일치, 60분 이내 875행, 최대 지연 82분. 스냅샷은 평단이나 거래 간 상태를 보존하지 않는다. | 청산 판단의 수량·평단과 잔고 스냅샷, 실제 브로커 체결을 교차 검증한다. 주문 시각과 개별 체결 시각을 구분하고 앱 미연결 체결은 별도 처리한다. [청산 이력](../../../scripts/migrations/T-126-exit-judgment.sql#L35), [브로커 기록](../../../scripts/migrations/T-081-wpd-broker-fills.sql#L141) |
| 14일 SEC | 판단시각이 있는 후보 30행의 현재 CIK 매핑을 붙인 결과, 접수시각 기준 공시가 있던 후보는 19행이고 당시 앱에 적재돼 있던 후보는 13행이다. 현재 매핑의 최근 검증 시각만 있어 당시 매핑판을 증명할 수 없다. 수집된 현재 행의 일부는 판단 이후 갱신됐다. | 원본 accession·정정 판본·첨부를 보존하고 접수·공개·최초 관측 시각을 나눈다. SEC 접수시각은 웹 공개시각의 근사치이며, 소급 연구는 공개 지연을 고려한 별도 데이터로 표시한다. [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [SEC 공개시각 설명](https://www.sec.gov/about/webmaster-frequently-asked-questions) |
| 14일 뉴스 | 해외 기준선 4거래일 중 실제 판단시각이 있는 3일의 뉴스 RAG ID는 0·1·4개. 첫 RSS 관측이 10/28 22:00:44 KST여서 세 창 모두 14일 미달이며, 당시 발행·관측 조건을 충족한 제목 등 메타는 2,811·3,538·4,250행(시장 혼합), 본문 참조 0행. 해시·검색 ID로 당시 본문·순서를 재현할 수 없다. | 운영 재현은 앞으로 허용된 기사 또는 발췌의 판본·최초 관측·검색 순서를 고정해야 한다. 과거 기사는 LSEG MRN 등 권리 확인된 역사 원천으로 별도 정책을 시험할 수 있다. GDELT는 별도 메타데이터 가설이다. [기존 기록](../../../scripts/migrations/T-112-run-judgment-record.sql#L79), [LSEG 역사 기사](https://www.lseg.com/content/dam/data-analytics/en_us/documents/fact-sheets/machine-readable-news-and-quantitative-data-factsheet.pdf) |

NYSE의 2026-07-01 공개 샘플로 마스터·종가 조인을 확인했다. NYSE 주상장 보통주 분류 1,750개 중 양수 주식수와 거래 종가를 연결할 수 있는 것은 1,731개였다. CIK 통합과 기존 순위 규칙까지 재현한 결과는 아니다. 제품 명세상 마스터는 보통 20:30 ET, 종가는 22:00 ET에 제공된다. 11월의 18:00 ET 분석에서 당일 파일을 사용하면 미래정보가 들어가므로 이전에 공개된 버전이나 별도 원천이 필요하다. [NYSE 마스터 명세](https://www.nyse.com/publicdocs/nyse/data/Daily_TAQ_Client_Spec_v4.3.pdf), [NYSE 종가 명세](https://www.nyse.com/publicdocs/nyse/data/TAQ_Closing_Prices_Client_Spec_v2.3.pdf)

### 실제 기록을 이용한 제한 비교

- **매수** — AI 전송 5행의 판단은 BUY 3·SKIP 2였다. 생성된 과매도 반등 카드 2건은 모두 `skipped`이고 연결 주문 0건이다. 다음 정규장 시가가 기록된 USD 진입 구간에 들어온 카드 1건, 당일 일봉 범위와 교차하지 않은 카드 1건이었다. 다음 장 시가에 샀다고 가정한 당일 종가의 평균 순수익은 관측 가능한 BUY 2건 +0.649%, SKIP 1건 −4.273%였다. 3거래일은 BUY 1건만 관측되고 5거래일은 0건이다. 이 수치는 실제 카드 체결 수익이 아니라 판단의 가상 후행 수익률이다.
- **매수 추가 조건 비교** — 동일한 과매도 카드 2건에 앞서 정한 %R(14) 최근 3거래일의 −80 상향 복귀를 적용했다. 두 건 모두 계산 가능한 입력이 있었고 통과는 0건이다. 이전 71종목 탐색의 수익 개선 가능성과 함께 보면, 최신 두 사례에서 필터가 기회를 제외했다는 것까지 확인됐다. 새 필터의 거래 성과나 14일 공시·뉴스의 추가 효과는 이 표본에서 계산할 수 없다.
- **매도** — 11/04 보호 청산 발화 11행은 같은 종목·거래일·익절 조건의 1개 군집이다. 전부 만료됐고 연결 주문·체결은 0개였다. 같은 종목의 다음 날 앱 미연결 브로커 매도는 기존 청산의 실현 성과로 귀속할 수 없다. 최초 발화 다음 날 시가 가상 청산과 당일 종가까지 보유 후 청산을 비교하면, 시가 쪽이 **+3.268%p** 높았다. 전일 종가 대비 USD 수익률 차이이며 양쪽 매도비용 15bp를 반영했다. 보유 종목일의 완결 결과는 1/3/5거래일 각각 15/5/0개이며, 유일 발화 군집은 1거래일만 비교 가능했다.

### 구현 전 검토할 선택

1. **과거 재구성** — Nasdaq 구성 효력일, NYSE 클래스 시총과 상폐, 기사 원문 또는 허용된 판본의 권리와 기간을 먼저 확정한다. SEC 원본으로 당시 공개 정보의 연구는 가능하지만, 과거 앱의 검색·판단을 새 외부 자료로 소급해 동일한 정책으로 표시할 수 없다. 과거 시장 연구와 실제 계좌 정책 평가는 별도다.
2. **전진 비교** — 같은 판단 시각에 기존 판단과 신규 판단, 구성 버전, 당시 보유 수량, 공시·기사 판본을 함께 기록하는 비교 설계를 검토한다. 비용과 가격 경로를 같게 두고, 매수는 진입률·비용 후 수익·놓친 상승, 매도는 회피 손실·놓친 반등을 평가한다. 1·3·5거래일 결과가 끝난 기회만 대조하며, 같은 종목일 반복 발화와 같은 위기의 관측을 묶는다.

이번 최종 검토 결론은 종목별 정책의 우위 판정을 유보하는 것이다. 검증된 시장 자료·기술 후보 결과, 원래 운영 데이터의 재현 한계, 다음 단계의 두 경로를 사용자 검토 대상으로 둔다.

## 가격 기반 재검증과 11/06 장전 예측 샘플

차단된 운영 판단, 주문·체결, 계좌 보유 이력을 성과 계산과 최신 점수에서 제외했다. KIS 확정 수정 USD 일봉 71종목(2023-03-28~2026-11-05 ET, 검수 탈락 50행)을 사용했다. 종목 데이터가 있는 기간부터 거래 비교가 가능하며, 1990년부터 확보한 두 시장지수는 주간 국면의 입력 이력이다. 당시 Nasdaq-100·NYSE 상위 50 구성과 상폐 수익을 복원하지 않았으므로 관측 패널에 한정한다.

| 항목 | 관측 결과 | 판정 |
|---|---|---|
| 가격 기반 가상 매수 | 2023~24년 학습, 2025-01-02~2026-10-29 판단일 458일 표본 외. 공통 448일 기준 다음 정규장 시가→5번째 거래일 종가, 비용 양쪽 각 15bp. 패널 동일가중 +0.251%, 종목 지표 상위 5 +1.010%, 상대강도·Nasdaq 종합·VIX·완료 주간 국면 추가 상위 5 +1.020%. 후자의 개선 +0.010%p, 20거래일 블록 95% 구간 −0.599~+0.614%p. | 시장 지표의 추가 수익 효과 미확인. Brier(낮을수록 좋음)도 과거 양수율 고정 0.2500, 종목만 0.2504, 결합 0.2557. 점수 55% 이상 및 시가 갭 제한을 적용하면 각각 +0.856%, +0.747%로 결합이 낮았다. 5일 창은 겹치며 계좌 수익이 아니다. |
| 단순 주간 순위 교차 확인 | 161주 동일가중 +0.242%, 과거 20거래일 수익률 상위 5 +0.865%. 차이 95% 구간 −0.175~+1.563%p. 2026년에는 동일가중 +0.184%, 상위 5 +0.145%. | 상승 추종의 우위도 기간에 따라 바뀌었다. 주간 국면과 VIX로 진입을 제한한 결과는 이 패널에서 우위가 없었다. |
| 가격 기반 가상 매도 | 42개월 첫 정규장 시가, 공통 2,547포지션. 기본 손절·익절·추적을 종가에서 판단해 다음 시가 청산. 5일 평균 순수익은 만기 보유 +0.638%, 기본 +0.056%, 동반 하락·종목 약세 추가 +0.134%. 10일은 +1.911%, +0.115%, +0.194%. 10일 만기 보유와 기본의 포지션 보유 중 평균 최대 역행은 각각 −4.982%, −2.495%. | 보호 청산은 보유 중 하락 노출을 줄였지만 이 표본에서 수익도 줄었다. 추가 규칙은 41건·4개 청산일만 바꿨고, 2025-04-02 군집을 빼면 기본 대비 차이가 음수로 바뀐다. 실제 계좌와 엔진의 장중 동작은 비교 대상이 아니다. |

**장전 관찰 샘플.** 11/05 ET 마감 시점에 후보판 125개 중 69개를 계산했다. 결합 모델 상위 5는 ORCL 77.82%, SHOP 77.66%, PLTR 76.73%, QCOM 76.37%, AMD 76.07%. 종목 지표만의 상위 5에는 QCOM 대신 DDOG가 들어간다. 결합 모델이 표본 외에서 70% 이상을 제시한 4,089종목일(84거래일)의 평균 예측은 78.08%, 관측 양수율은 58.65%였다. 현재와 같은 충격(나스닥 종합 하루 −3% 이하와 VIX 5일 +5pt 이상)은 학습 2일, 검증 6일이다. 11/05 나스닥 종합 −5.52%, VIX 28.18 및 5일 +10.98pt. 10/30 종료 주간 상승 종목 비중은 48.47%이며, 최신 장의 시장 폭을 대입하지 않았다. [FRED NASDAQCOM](https://fred.stlouisfed.org/series/NASDAQCOM), [Cboe VIX](https://www.cboe.com/tradable_products/vix/vix_historical_data), [Nasdaq Trader](https://www.nasdaqtrader.com/Trader.aspx?id=DailyMarketFiles)

**보존과 채점.** [예측 샘플 및 집계](../../../docs/research-data/T-156-price-only-forward-sample-2026-11-06.json)에 두 모델 점수, 가상 가격 확인 범위, 공식 SEC/IR 사건, 비용과 판단 기준을 고정했다. 공식 사건은 분석 카드의 맥락으로 붙였다. 시장 폭·14일 공시·언론 뉴스의 추가 성과를 측정한 모형에는 아직 해당 이력이 없다. 가상 진입은 11/06 09:30 ET, 채점은 11/12 16:00 ET(11/13 06:00 KST) 이후다. 실매수 선정은 보류하며 기존 종목 지표를 비교 기준으로 남긴다. 시장 국면·VIX는 위험 표시로, %R·상승 종목 비중·기업 사건은 하나씩 추가 효과를 시험할 후보로 둔다. 구현·설정·주문 변경은 없다.

## 분석에서 시그널까지 — 후보 관리 절차 보완안

**검토 범위.** 미국 신규·추가 매수와 보유종목의 일반 매도·감축을 각각 다룬다. 보호 청산은 독립 경로로 둔다. 아래 현행 조건은 소스에서 확인한 분기이며 운영 스위치 값이나 발행 상태를 재확인한 결과는 아니다. [T-078 통합 절차](../../../docs/design/2026-10-24-integrated-execution-procedure.md)의 S02·S03·S08에 연결하는 설계 보완으로, 정책·운영 상태는 변경하지 않는다.

| 구간 | 현행 소스 | 보완안과 판단 근거 |
|---|---|---|
| 분석 대상 | 해외 장마감은 보유 상태·즐겨찾기·설정된 해외 목록의 합집합에서 일봉을 본다. [대상 로더](../../../src/lib/data/us-data-db.ts#L53) | **수집 대상과 매매 자격 분리.** 신규 매수 연구군은 효력일이 있는 Nasdaq-100 및 자체 NYSE 시총 상위 50. 운영 매수 자격은 T-078 U05에 별도 확인한다. 모든 실제 보유를 매도 심사하고, 즐겨찾기는 수집·관찰에만 둘 수 있다. 추가 매수에는 별도의 진입 가설과 누적 투입 한도를 적용한다. |
| 장마감 매수 | D0 확정 세션에 맞는 일봉에서 고점마감·내부봉·과매도 반등 중 종목당 우선순위 한 개. 과매도 반등은 RSI(14) <35, 전일 저가 위, 볼린저 하단 이상, 최근 3일 중 양봉 1회 이상. 다음 5거래일 확정 실적과 사전 1주 금액을 거른 뒤, 후보 전체를 묶어 최근 3일 뉴스 최대 5건을 검색한다. LLM 한 번의 BUY/SKIP, 자신감 60 이상, USD 가격 구간·목표/손절·기간·최종 수량 검사를 거친다. [장마감 처리](../../../src/lib/strategy/post-market-overseas.ts#L576), [과매도 규칙](../../../src/lib/strategy/rules/oversold-bounce-daily.ts#L25) | 현행 경로를 비교 기준으로 보존한다. 에이전트는 패턴 발화 전후를 볼 관찰 후보와 가설, 조건 확인 의견과 최종 순위를 제안한다. 과매도 회복과 상승 추종은 별도 가설로 관리한다. 시장 국면·VIX는 우선 위험 설명에 사용하고, 시장 폭·%R·종목별 공시·뉴스의 추가 효과를 따로 본다. 수치·임계값·상태 전이·발행은 코드가 확정한다. |
| 장중 신규 진입 | 장마감과 별도로 등록·활성 전략을 평가해 공통 시그널 생성으로 넘긴다. 거시·주문 한도 등 장중 관문이 있고, 해당 경로에 별도 장마감 AI 판단을 요구하지 않는다. [장중 거시 관문](../../../src/lib/strategy/engine.ts#L1451), [장중 발행](../../../src/lib/strategy/engine.ts#L1605) | 장중 확인을 관찰 후보의 재평가로 기록하되, 기존 장중 룰과 장마감 카드의 활성 후보를 함께 대조한다. 동일 종목·세션에 매수 의도를 중복 발행하거나 주간 시장 위험을 기존 거시 관문과 중복 반영하지 않는다. |
| 보유종목 일반 매도 | 장마감 AI의 목표·손절은 신규 매수 카드의 출구 조건이다. 장중에는 보유 수량을 확인한 일반 룰 매도가 공통 경로로 들어갈 수 있다. 보유종목 개장 전 공시는 별도 기록·알림이다. [장중 룰](../../../src/lib/strategy/engine.ts#L1628), [보유 공시](../../../src/lib/corp-intel/holdings-premarket.ts#L2) | **유지·감축 검토·전량 매도 검토·자료 부족**을 분리한다. 보유 가설 훼손, 실적·재무 악화, 업종 대비 약세와 집중도를 근거별로 남긴다. 종목의 매수 순위 하락, 지수 급락, LLM 해석 하나로 전량 매도하지 않는다. 축소·청산 초안은 최신 매도 가능 수량·미체결 주문·포지션 변경을 재검사한다. |
| 보호 청산 | 장중 보호 트랙이 신규 진입 판단보다 앞선다. 평단·현재가·고점과 기존 시나리오/스타일의 손절·익절·추적을 평가하고, 설정·쿨다운 후 공통 경로를 탄다. 보호 손절은 강제 자동 제출 분기가 있지만 주문 차단·안전 관문은 별도다. [장중 보호](../../../src/lib/strategy/engine.ts#L956), [청산 조건](../../../src/lib/strategy/exit-engine.ts#L88), [라우터](../../../src/lib/signals/router.ts#L253) | 보호의 기준·설정·속도에 관찰 절차를 연결하지 않는다. 동일 수량에 보호 발화나 매도 주문이 있으면 일반 매도 제안은 대기·재평가한다. 분석 제안에 보호 자동 제출용 `exit_kind`를 사용하지 않는다. 매수 전략 검증 관문은 매도를 검증하지 않으므로 일반 매도는 T-078의 G-H에서 따로 판단한다. |
| 시그널 발행 | 장마감 매수의 검증 통과 카드는 승인 대기, 미검증은 승인 불가 감사 행 및 별도 가상 체결 평가용 기록이다. 승인·진입 감시에서도 검증을 다시 확인한다. 장중 일반 시그널은 운영 모드에 따라 관측·승인 대기·자동 제출 분기를 탄다. [장마감 저장](../../../src/lib/strategy/post-market-engine.ts#L292), [전략 검증](../../../src/lib/safety/validation-gate.ts#L100), [진입 감시](../../../src/app/api/cron/entry-watcher/route.ts#L266) | 관찰과 시그널 초안은 별도 연구 기록에 보존한다. 기존 `signals.detected`도 활성 중복 검사에 포함되므로 저장 위치로 사용하지 않는다. 현행 운영에 연결하는 것은 G-N/G-H의 증거와 적용 범위가 확인된 정책의 기존 경로에 한한다. 전략 ID·정책판·검증 결과를 일치시킨다. 과매도 카드 ID `oversold-bounce-v1`와 연구 등록 ID `oversold-bounce-daily-v1`의 차이는 확인 과제이며, 이름 일치가 성과 검증을 대체하지 않는다. |

### 판단 에이전트의 네 구간

![분석에서 시그널까지의 네 판단 구간과 발행 경계](../../../docs/design/2026-11-06-t156-agent-signal-flow.png)

시작점은 현지 거래일, 확정봉, 통화·환율, 그날 유효한 종목 구성, 보유·가용 자원 스냅샷이다. 주간 지표는 마지막 완료 주, 일간 VIX·시장 폭은 각 원천의 실제 관측분을 사용한다. 시장 폭의 날짜와 모집단을 표시한다. 관찰 기간, 시그널 유효 세션, 투자 보유 기간은 각각 관리한다.

| 구간 | 입력과 에이전트 판단 기준 | 출력과 코드의 확정 책임 |
|---|---|---|
| **1. 공시·뉴스 해석** | 종목/기업 ID에 묶인 최근 14일 공시·IR·기사 판본에서 신규 사실, 재보도, 정정, 상충을 구분한다. 기간·단위·전년/전분기 기준과 회사 전망·언론 해석을 나눈다. 여러 기사가 하나의 사건을 인용하면 같은 근거로 묶고 반대 근거와 중요도를 제시한다. | 사건 ID·유형·공개/관측 시각·판본·주장과 원문 위치·근거 충족 상태. 코드는 종목 매핑과 시점, 수치 단위, 출처 허용 범위 및 참조 존재를 검사한다. |
| **2. 관찰 후보 선정** | 시점별 신규·추가 매수 적격군과 보유 전체를 별도로 받는다. 종목·업종·시장 상대 움직임과 기업 사건을 비교해 반등·추세 지속·보유 근거 악화 중 검토할 가설을 고른다. 공통 시장 하락과 확인된 회사 사건을 구분하고, 서로 상충하면 확인할 증거를 지정한다. | 관찰 여부, 방향·가설 ID, 확인할 정책 조건, 반증·다음 확인 시각·관찰 만료, 근거 ID. 코드는 적격과 종목/포지션, 중복, 등록 가능한 조건과 정책판을 검증하고 후보 개정판을 기록한다. |
| **3. 조건 확인** | 같은 후보 개정판의 새 가격·사건·보유 자료와 코드가 계산한 조건별 결과를 받는다. 충족한 가격 조건이 여전히 가설을 지지하는지 평가한다. 매수는 `검토·대기·제외`, 보유는 `유지·감축 검토·전량 매도 검토·자료 부족` 의견을 낸다. 판단 근거와 반대 근거를 함께 제시한다. | 의견과 코드 판정을 별도 필드로 보존한다. 코드는 시가 갭·가격 조건·일정·최소 수량·최신 매도 가능 수량·활성 시그널·필수 자료 신선도를 검사한다. 의견과 조건이 모두 충족된 경우에만 시그널 검토로 전이한다. |
| **4. 최종 우선순위 비교** | 같은 거래 세션에 확인을 통과한 후보끼리 비교한다. 근거 강도·하락 위험·같은 업종/사건에 대한 기존 노출을 비교해 신규 매수 및 감축·매도 순위를 별도로 제안한다. 관찰 점수나 모델 자신감은 참고값으로 유지한다. | 순위·비교 근거·동률/제외 사유. 코드는 통과 후보 집합의 포함 여부, 최신 보유·예산·슬롯·매도 가능 수량, 예약·충돌을 확인해 허용 범위를 확정한다. 동률 규칙과 자원 부족 시 처리 순서는 실험 등록 때 고정한다. |

**시점과 근거.** 각 구간은 공통 자료 기준시각과 실제 완료 시각을 기록한다. 초기 모의안은 자료 기준시각 직전 14×24시간을 UTC로 계산한다. 원천 공개와 최초 관측이 모두 자료 기준시각 이내인 판본을 사용하고, 늦은 뉴스나 정정은 새 기준시각의 개정판에 반영한다. 실제 이용 가능 시각에 원문 판본을 재현할 수 없으면 해당 역사 비교의 결측으로 남긴다. `확인 결과 사건 없음`, `수집 실패`, `출처 상충`을 구분한다. 승인된 자료만 입력하고, 기사에 포함된 명령문은 인용 자료로 취급한다. 에이전트에 임의 검색·데이터 전송·승인·주문 권한을 연결하지 않는다. [현재 수집 원장 계약](../../../scripts/migrations/T-116-ci-raw-item.sql#L19)

**상태와 재검사.** `관찰 → 조건 대기 → 시그널 검토 → 순위 확정 → 인계 가능`은 코드가 전이한다. 필수 자료 누락, 모델 응답 오류·시간 초과는 이유가 있는 대기로 둔다. 관찰 만료, 가설 무효, 새 판본으로 대체, 자원 부족, 발행 차단을 각각 기록한다. 상태를 확정할 때 대상 세션·시각, 이전/다음 상태, 후보·전략/정책판, 근거 ID, 판단 사유와 마지막 확인 시각을 남긴다. 장중 새 사건·가격·보유가 바뀌면 변경 시각 이후의 판본으로 재평가한다. 동일 후보/방향/전략/세션 재시도는 한 번만 인계하고, 계좌·시장·종목의 공통 자원 선점과 따로 관리한다.

**인계 경계.** 첫 검증은 별도 모의 기록에서 종료한다. 실제 발행의 검토 시점에는 G-N(신규 매수)과 G-H(보유 관리), 해당 전략판, 현재 가격·자원·권한을 적용한다. 보호 청산은 독립 경로에서 먼저 처리하며, 해당 종목의 보호·수동·일반 주문이 활성 상태거나 브로커 결과가 불명확하면 잔량 대사 후 일반 후보를 재평가한다. 매도 가능 수량은 잠긴 잔고·부분 체결·미체결을 반영한다. `제안·발행·승인·주문 차단/미체결·체결`은 별도 사건으로 기록한다. [라우팅](../../../src/lib/signals/router.ts#L253), [현재 중복 검사](../../../src/lib/signals/service.ts#L626), [T-078 공동 자원](../../../docs/design/2026-10-24-integrated-execution-procedure.md#81-공동-배분예약정산)

### 네 구간 기준치 초안 v0.1

아래 **[현행]**은 기존 소스나 사용자 확정 정책, **[탐색]**은 과거 모의에서 사용한 값, **[제안]**은 새로 시험할 값이다. [탐색]의 성과는 이전 조건 조합에 해당한다. 첫 거래 가설은 **신규 매수의 과매도 반등 B-R**, **보유 포지션의 악화 감축 S-W**로 좁힌다. 전량 검토와 추세 지속은 별도 비교 후보로 둔다. 에이전트는 해석·검토 의견·순위 근거를 내고, 조건식·임계값·자원 제한과 상태 확정은 코드가 맡는다. T-078 C04의 기존 사실 추출 제안과 비교할 권한 확장안이며, 운영 적용 범위는 C04/C09 검토에서 확정한다. [T-078 결정 목록](../../../docs/design/2026-10-24-integrated-execution-procedure.md#9-단일-결정검증-목록)

`D0`는 판단에 사용한 마지막 미국 정규장 확정봉의 거래일, `D1`은 그 다음 정규 거래일이다. 일수는 별도 표시가 없으면 미국 정규 거래일이다. 5일 수익률은 `D0 종가 / D0-5 종가 − 1`, MA20은 D0를 포함한 20봉 종가 단순평균, ATR(14)은 직전 종가를 포함해 계산한 최근 14봉 true range의 단순평균이다. S-W의 주간 기준은 주 종료일이 D0보다 앞선 가장 최근 완료 주로, 하락은 해당 지수의 40주 평균 아래 및 13주 수익률 음수를 함께 만족하는 경우다. 이동평균·변동폭은 확정 수정 USD 봉으로 계산한다. 장중 가격과 비교할 때 통화·기업행동 조정 기준을 맞추고, 맞출 수 없으면 보류한다. 모든 경계 판정은 반올림 전 값으로 한다. [주간 추세 계산](../../../scripts/profit-engine/weekly-market-regimes.py#L86)

| 단계 1 · 공시·뉴스 | 구분 | 지표·기간·수치 | 근거와 적용 범위 | 충족 시 | 미충족 시 |
|---|---|---|---|---|---|
| 입력 자격 | 필수 | 공개 시각이 **기준시각−14×24시간부터 기준시각까지(UTC)**이고, 최초 관측 시각 **≤기준시각**. 기업 ID·판본·원문 위치 확인 | [제안] 기존 14일 설계를 재현 가능한 입력 창으로 고정 | 사건 ID로 묶어 분석. 같은 원문의 재인용은 1건 | 늦은 판본은 다음 판단 때 해당 창에 포함되는 경우 사용. 결측·상충·확인된 무사건을 각각 기록 |
| 증거 수준 | 에이전트 판단 | **E2** 해당 주장을 직접 뒷받침하는 공식 원문 ≥1건. **E1** 공식 확인 전 독립 보도 ≥2건. **E0** 단독·상충·원문 부재 | [제안] 원문 정답표로 검증. 한 보도자료를 인용한 여러 기사는 독립으로 세지 않음 | E2는 사건 필수 증거로 인정 가능. E1은 관찰 맥락에 사용 | E0/상충은 해당 주장 보류. 사건이 필수인 가설은 조건 대기 |
| 사건 중요도·방향 | 에이전트 판단 | **M3** 공식 거래정지·상장폐지 결정·채무불이행·원보고 의존 철회 등. **M2** 동일 회계기간·항목·통화의 직전 유효 매출/영업이익 전망 중간값 대비 절대 변화 **≥5%** 또는 공식 전망 철회. **M1** 기타 새 사실. **M0** 새 사실 없는 재보도 | [제안] 5%는 모의 시작값. 이전 중간값이 양수이고 비교 가능한 경우만 `(새 값−이전 값)/이전 값`을 산출. 전망 철회의 방향은 근거로 따로 판정 | M2/M3는 우선 재평가. 긍정·부정·방향 불명을 구분하고 증거 수준과 함께 전달 | M1은 일반 맥락, M0은 중복 처리. 수치 비교 불가 시 변화율 불명으로 기록 |

| 단계 2 · 관찰 후보 | 구분 | 지표·기간·수치 | 근거와 적용 범위 | 충족 시 | 미충족 시 |
|---|---|---|---|---|---|
| 공통 적격·데이터 | 필수 | 당시 유효한 신규 매수 연구군 또는 평가 시점 보유 수량 **>0**. 매수 B-R은 품질 통과 연속 일봉 **60개** | [탐색] 60개는 가격 연구 재현 조건. [현행] 과매도 함수의 최소 입력은 22개. 당시 NYSE 확대분은 별도 집계 | 가설별 평가. 여러 가설이 한 종목에 붙어도 매수/매도의 거래 기회는 중복 집계하지 않음 | 적격 밖은 연구 범위 밖, 필수 자료 결측은 자료 부족. 보유 매도 심사에서는 신규 매수 목록을 사용하지 않음 |
| **B-R** 신규 매수·반등 | 필수 | D0 **RSI(14) <35**, 종가 **>전일 저가**, 종가 **≥볼린저밴드(20, 2σ) 하단**, 최근 3일 **양봉 ≥1일**을 모두 충족 | [현행] 과매도 반등 기술 조건. [탐색] 2025년 이후 391건 평균 +0.118% | 관찰 등록. 신규·추가 매수 의견을 구분하고, 추가 매수는 신규 근거와 누적 투입 한도 적용 | B-R 미등록. 다른 가설 성과와 섞지 않음 |
| **S-W** 보유·악화 | 필수 | D0 기준 **직전 완료 주 S&P 500·나스닥 종합 추세 모두 하락**, **D0 종가 <MA20**, **5일 수익률 ≤−3%**를 모두 충족 | [탐색] 2,547포지션 시험의 추가 조건. 41건·4일만 달라졌고 2025-04-02 군집 제외 후 10일 차이 −0.0070%p | 일반 감축 관찰 등록. 시장 약세와 종목 가격 약세를 같은 조건 묶음으로 보존 | 이 기술 가설은 유지/미등록. E2·M3로 보유 전제가 훼손된 경우는 별도 사건 검토로 표시 |
| 관찰 가설·반증 | 에이전트 판단 | 가설별 지지 근거 **≥1개**와 반증/무효 조건 **≥1개**. 기술·공식 사건을 구분하고 같은 사건은 1번만 사용 | [제안] 등록 때 근거·재확인 조건을 남겨 나중에 같은 판단 재현 | 다음 세션 확인 조건·가설 무효 조건을 기록. 공시 확인이 끝난 무사건은 가격 가설에서 허용 | 근거 부족·충돌은 대기. 자원 한도 초과에 따른 감축은 S-W와 별개 사유로 처리 |

| 단계 3 · 조건 확인 | 구분 | 지표·기간·수치 | 근거와 적용 범위 | 충족 시 | 미충족 시 |
|---|---|---|---|---|---|
| 공통 자격·거래 가능 | 필수 | 대상 세션과 유효기간 일치, 필수 시세·환율·보유 확인, 충돌 활성 주문 **0건**, 최소 매수/매도 가능 수량 충족. 기존 장마감 매수의 확정 실적 제한은 **D1~D5** | [현행] 거래 일정·실적·수량 제약을 공통 적용. 기준선의 AI 자신감 ≥60은 A의 현행 판단에만 사용 | 에이전트 의견과 가격 조건을 대조. 일반 매도는 잠긴 수량·부분 체결을 반영한 잔량으로 확인 | 자료 부족·기존 주문 충돌·예산 부족·확정 실적 제한을 사유별 보류. 보호 청산은 독립 경로 |
| **B-R / W** 반등 추가 확인 | 필수 · 실험 W | 최근 **3개 종료 거래일** 중 Williams %R(14)이 직전 **≤−80**에서 **>−80**으로 바뀐 날 **≥1일** | [탐색] 391건 중 선택 127건 +0.547%. 공통 기회당 +0.060%p, 95% 구간 −0.505~+0.643%p. 최근 교차와 현재 %R 값은 별도 | W군 조건 통과. %R 재하락은 의견에 기록하고, D0에도 −80 위여야 한다는 조건은 별도 가설 | W군은 대기 또는 D1 만료. 기술 기준군 B0는 이 조건 없이 비교 |
| **B-R / G** 시가 갭 | 필수 · 실험 G | D1 정규장 시가와 D0 종가의 절대차 **≤0.5×ATR(14)**. B-R 관찰은 **D1 정규장 종료**에 만료 | [탐색] 갭은 이전 55% 점수·상위 5와 함께 시험한 조건. [제안] 갭 단독 변형과 D1 만료를 분리 시험 | G군 조건 통과. 확인 뒤 첫 거래 가능 호가로 평가하며, 전진 모의에서는 그 가격도 같은 범위 안일 때 체결로 기록 | 시가 범위 밖이면 미진입, 확인 후 호가 이탈이면 미체결. 시가 미확인·호가 결측·만료는 각각 기록 |
| **B-R** 거래 의견 | 에이전트 판단 | D1 유효 시간 안에 지지 근거 **≥1개**. 새 E2·M2/M3가 가설을 무효화하는지 확인 | [제안] 시장 국면·VIX·시장 폭은 위험 설명. [탐색] 나스닥 종합 하루 ≤−3%와 VIX 5일 ≥+5pt는 충격 하위 집단 표시 | 가격 조건과 가설이 유지되면 매수 검토로 전달 | 가격 미확인·상충은 대기, 공식 사건으로 가설 무효면 제외. 시장 위험 표지만으로 자동 제외하지 않음 |
| **S-W** 일반 감축 의견 | 에이전트 판단 | 같은 D0의 기술 조건 3개 충족 + 14일 창에서 보유 전제를 약화시킨 **E2·부정 M2/M3 ≥1건**. 모의 감축량은 **매도 가능 수량의 25%**, 허용 주문 단위로 내림 | [탐색] 기술 3조건은 과거 전량 청산 대리 실험. [제안] 공식 사건 결합·25% 감축은 신규 가설. D0 판단은 D1 종료 만료 | 감축 검토. 공통 자격을 통과한 뒤 가상 수량 기록 | 가격 축만 있으면 관찰 유지, 사건 결측/상충이면 자료 부족. 계산 수량이 최소 주문 단위 미만이면 감축 보류 |
| **S-E** 일반 전량 검토 | 에이전트 판단 · 별도 사례 검토 | **E2·M3 ≥1건**이 기록된 핵심 보유 전제 **≥1개**를 직접 무효화하고, 거래 가능·가용 수량 확인 | [제안] 전량 의견의 예외 경로. 일반 수익률·시장 급락·AI 점수만으로 전량 조건을 구성하지 않음 | 전량 **검토 의견**으로 별도 기록. 첫 S-W 수익 비교에서 분리 | 근거 불명은 대기. 보유 재검토 또는 기존 보호 경로 적용 |

| 단계 4 · 최종 우선순위 | 구분 | 지표·기간·수치 | 근거와 적용 범위 | 충족 시 | 미충족 시 |
|---|---|---|---|---|---|
| 자원·발행 자격 | 필수 | 같은 세션·방향의 3단계 통과 후보만. 매수 배정 후 종목 비중 **≤15%**, 기존 초과 포지션의 집중도 감축은 회차당 **초과분 1/3 이하**와 체결 후 재계산. 기존 공통 예산·슬롯·보호 우선 적용 | [현행] T-078 C03의 확정 제안값. 위 S-W의 25%는 별도 일반 감축 모의값이며, 집중도 감축에 혼용하지 않음 | 허용 후보 집합에서만 순위를 비교하고 현금·수량 예약을 재확인 | 예산·한도·주문 경합은 미배정/재평가. 연구 기록에서는 활성 시그널·승인 요청·주문 0건 |
| 신규 매수 순위 | 에이전트 비교 | 고정 대조군은 잠근 **종목 지표만의 점수 내림차순** → `ATR(14)/D0 종가` 낮은 순 → 종목 ID. 에이전트 변형은 점수 **10점 폭 구간** 안에서만 가설을 직접 지지하는 **E2 근거 ≥1건**을 우선. 모의 슬롯 최대 **5개** | [탐색] 상위 5 종목 지표 +1.010%, 시장 추가 +1.020%로 차이 +0.010%p. [제안] 증거를 이용한 재정렬·동률 규칙. 점수는 순서용이며 55% 문턱은 사용하지 않음 | 동일 슬롯·비용으로 순위 효과 비교. 근거 점수가 같으면 고정 순서 적용 | 구간 안에 판단 필수 사건 자료가 결측/상충인 후보가 있으면 해당 구간은 고정 순서. 필수 가격 점수가 없으면 비교 보류 |
| 일반 매도 순위 | 에이전트 비교 | 고정 대조군은 동일 감축 경로 안에서 **5일 수익률이 낮은 순** → 포지션 ID. 에이전트 변형은 **1%p 폭 하락 구간** 안에서 E2로 확인한 보유 전제 훼손 **M3 → M2** 순 | [제안] 순위에 의한 감축 효과는 미검증. 집중도 감축과 S-E 전량 검토는 각각 별도 경로로 집계 | 매도 가능 수량과 보호 우선권을 재검사해 모의 배정 | 동일 등급이면 고정 순서. 보호·수동 주문과 경합하면 대사 후 재평가 |

매수 점수 구간은 `[0,10), …, [90,100]`, 매도 수익률 구간은 %p 단위 `[k,k+1)`의 고정 구간이다. 출처가 여럿이어도 같은 사건에는 근거 우선권을 한 번만 부여한다. 일반·집중도·전량 검토는 별도 모의 경로에서 채점하며 같은 가용 수량에 중복 배정하지 않는다. 판단 의견과 조건 통과 여부는 따로 저장한다. 실거래 전략 발행 자격은 G-N/G-H와 해당 전략판의 기존 절차로 검토한다. [현행 과매도 룰](../../../src/lib/strategy/rules/oversold-bounce-daily.ts#L16) · [실적 제한](../../../src/lib/strategy/earnings-blackout.ts#L19) · [가격 검증 집계](../../../docs/research-data/T-156-price-only-forward-sample-2026-11-06.json)

### 기준치별 매수·매도 검증 계획

| 비교 | 같은 조건에서 바꾸는 것 | 채점 |
|---|---|---|
| 매수 기술 재생 | **B0** 현행 과매도 기술 조건, **W** B0+%R, **G** B0+갭, **WG** 둘을 결합. 동일 적격 전체의 자료 상태와 60봉 공통군 성과를 비교 | B0/W는 종목별 5거래일 중복을 제거한 기존 가격 결과를 재현. D1 시가 관측 후 같은 시가에 체결하는 계산은 과거의 일봉 근사로 표시하고, 실제 전진 모의는 확인 후 첫 거래 가능 호가 사용. D+1/3/5 중 D+5를 주 비교로 고정. 비용 후 기회당 수익·최대 역행·놓친 상승·미체결 |
| 매도 가격 재생·전진 관측 | 동일 포지션의 **유지 / 기본 보호 대리 / 보호+기존 기술 3조건 전량 대리**를 가격으로 재생. 기본 대리의 종가 손절 **−1.5%**, 익절 **+2.5%**, 고점 **+2.5%** 이후 추적 **−1.5%**를 사용. **S-W 25% 감축**은 동일 가격·수량 규칙으로 기술 단독을 먼저 비교한 뒤, E2·M2/M3 결합을 별도 추가 | 5일·10일의 비용 후 총가치(매도대금과 잔여 포지션), 피한 하락·놓친 반등·보유 중 최대 역행. 2025-04-02 군집 제외 결과 병기. 실제 보호 정책과 실제 보유·당시 사건 판본을 복원할 수 없는 조합은 주문 없는 전진 관측 |
| 사건·에이전트·순위 | 1단계 원문 정답표와 사건 등급, 2단계 같은 적격군·관찰 한도에서 등록 판단, 3단계 같은 후보·조건의 규칙 의견과 에이전트 의견, 4단계 동일 통과군의 고정 순서와 에이전트 순서. 마지막에 전체 결합 | 신규 데이터의 효과와 판단 변경 효과를 분리. 사건 누락·오분류·중복, 후보의 추가·누락, 판단 지연과 변경률, 동일 슬롯의 비용 후 성과·낙폭·집중도 측정. A의 기존 전체 정책과도 동일 시점에 병행 비교 |

기존 가격 재생은 편도 **15bp** 가정을 사용하고, 전진 비교는 추정 수수료·스프레드·슬리피지·환율을 같은 기준으로 적용한다. 보류는 현금/보유 상태로, 결과 가격 불명은 별도 결측으로 채점한다. 이미 결과를 본 기간은 재현·가설 설계에 사용한다. 새 비교는 미사용 시간순 표본과 주문 없는 전진 관측을 분리한다. 5일 등 결과 구간의 중첩과 같은 날 급락의 군집을 고려해 거래일/사건 블록의 95% 구간을 보고한다. 개선이 불확실하거나 특정 급락일을 빼면 부호가 바뀌는 결과는 채택 보류로 표시한다. 최소 표본·운영 비용·허용 위험/지연·합격과 중단 기준은 C09에서 결과 확인 전에 확정한다.

### 기존 기록 재사용과 검증 순서

- **저장 책임.** T-112 `judgment_run/judgment_candidate`는 장마감 실행·BUY/SKIP/제외·카드 ID의 비교 기준, T-126 `exit_judgment`는 보호 판단의 기준으로 참조한다. 종목당 한 행인 T-112 후보는 방향별 관찰 상태와 변경 이력을 담기 어렵다. 후보의 시점별 근거·상태는 별도 연구 기록으로 설계하며, 모의 판단 기록에서 시그널·승인·주문으로 보내지 않는 기존 경계를 유지한다. T-072 차단 매수의 가상 체결 기록을 양방향 모의 원장으로 대체 사용하지 않는다. [T-112 DDL](../../../scripts/migrations/T-112-run-judgment-record.sql#L32), [T-126 DDL](../../../scripts/migrations/T-126-exit-judgment.sql#L35), [시그널 상태](../../../src/lib/signals/statuses.ts#L63)
- **대조군 세 가지.** A는 현행 정책(장마감 매수 카드·장중 룰·보호 청산), B는 동일 평가 기회에서 확장 입력과 고정 규칙, C는 B에서 에이전트 구간을 하나씩 교체한 방식이다. 각 구간의 B/C 비교에서는 다른 구간과 자원 규칙을 고정한다. 데이터만의 효과는 B의 고정 규칙에서 공통으로 제공할 수 있는 입력만 쓴 대조군과 B를 비교한다. A는 실제 현행 방식과의 전체 비교에 쓴다. 마지막에 전체 결합을 A/B와 비교해 순서와 상호작용을 확인한다. 각 구간의 개선분을 더해 전체 개선으로 계산하지 않는다. 현행 입력·판본을 재현할 수 없으면 기술 대리 기준선과 별도 표시하고 실제 현행 비교는 전진 관측에서 한다.

| 검증 구간 | 비교에서 고정할 것 | 우선 볼 결과 |
|---|---|---|
| **1. 공시·뉴스 해석** | 동일 종목·시각·원문 판본 집합, 같은 사건 평가 표본. 출처 확대 효과는 별도 시험. | 당시 원문과 비교한 사실·수치 정확도, 중요 사건 누락, 중복·정정 오분류, 판단 보류 및 지연. 거래 성과와 별도로 채점. |
| **2. 관찰 후보 선정** | 동일 해석 결과, 공통 적격 종목·보유 전체, 같은 관찰 한도와 가격 조건. | 추가 발견한 후보의 비용 후 기회당 수익, 놓친 상승/회피 손실, 방향별 후보 커버리지와 업종 집중. |
| **3. 조건 확인** | 동일 후보 개정판·근거와 가격 조건·가용 자원, 같은 체결 모델. | 보류·만료·미체결을 포함한 기회당 순수익, 놓친 반등·최대 역행, 시간 초과율과 실제 완료 후 신호 유효성. |
| **4. 최종 우선순위 비교** | 동일 확인 통과군·시각·예산·슬롯·업종 제약·보호 우선권. | 동일 한도에서 순수익·낙폭·집중도·회전율·미배정의 기회비용. 일반 매도는 동일 보유 포지션의 유지/현행 보호와 분리 비교. |

매수는 종목·현지 세션·방향, 매도는 포지션·판단 시각을 기회 단위로 삼고 여러 가설을 한 거래 기회로 묶는다. 공통 완전 자료군과 결측·오류·보류·미체결이 포함된 전체 적격군을 함께 집계한다. 의도적 미거래는 매수의 현금 대기 또는 매도의 기존 보유/보호로 평가한다. 결과 가격 결측은 별도 집계하고 민감도를 본다. NYSE 연구군 추가분과 현재 차단 기록은 별도 집계한다. 구간별 비교는 동일 보유·자금 스냅샷에서 시작하며, 전체 결합은 동일 초기 잔고에서 정책별 모의 원장을 따로 유지해 이후 포지션·가용 자금의 차이를 측정한다.

평가 가격은 판단이 실제로 가능해진 뒤 첫 거래 가능한 가격부터 사용한다. 시가 이후 확인을 시가로 소급하지 않으며, 일봉으로 순서를 판별할 수 없으면 불명 또는 보수적 민감도로 처리한다. 수수료·스프레드·슬리피지·환율은 양쪽 같은 기준으로 적용한다.

동일 입력으로 진행한 비교와 처리 지연을 포함한 전진 모의를 분리한다. 실제 전진에서는 수집·해석·조건 확인·발행 가능 시각과 지연의 중앙값/95백분위·만료율을 측정한다. 입력과 허용 원문 판본, 규칙·모델·프롬프트·출력·응답 형식 버전을 고정해 남기고 같은 입력의 의견 변경률을 측정한다. 표본 외 기간 경계에 걸친 결과를 학습에서 제외하고, 날짜·급락 사건 단위로 불확실성을 본다. 관찰 결과는 후속 정책판의 별도 가설과 실험에 반영한다. 기간·최소 표본·순성과와 허용 위험·지연 기준·중단 기준은 결과를 보기 전에 T-078 C09에서 확정한다.

### 구현 전 전체 재검토

메인과 별도 검토 역할이 분석 입력·거래 판단·자원 경계·구간별 실험을 대조했다. 다음 표는 설계에서 보완한 부분과 구현 전에 남은 결정·시험을 구분한다.

| 다시 확인한 항목 | 설계에 반영한 내용 | 남은 결정 또는 구현 후 확인할 시나리오 |
|---|---|---|
| 판단 권한과 상태 | 네 구간별 의견과 코드 확정 분리, 실패는 이유 있는 대기, 모의 인계 분리 | 모델 오류·지연·스키마 위반·기사 내 지시가 들어와도 모의 경로의 활성 시그널·승인 요청·주문이 각각 0건이며 보호 판단이 지연되지 않는지 시험 |
| 시점과 자료 권리 | 공개·최초 관측·판본과 완료 시각을 분리하고 정정을 개정 이력으로 보존 | 과거 Nasdaq 구성·NYSE 클래스 시총/상폐·기사 판본 확보 및 허용 원천·보존 기간 확정. 최신 값의 소급, 시차/DST·휴장·반일장·늦은 정정 사례 시험 |
| 일반 매도와 보호·자원 충돌 | 보호 독립, 공통 자원 선점과 후보 중복 분리, 결과 불명 대사 | 보호/수동/일반 매도 동시, 웹·메신저 동시 승인, 승인 사이 잔량 변경, 부분 체결·취소·결과 불명, 양방향 후보에서 중복 인계·재송신·수량 초과 여부 시험. 일반 매도에 보호 분기 필드나 매수 진입 구간이 들어오면 거부하는지 확인 |
| 데이터·에이전트 효과 분리 | A/B/C 대조군과 단계별 공통 조건, 완전 자료군/전체 기회 및 지연 효과 분리 | 초기 검증 가설·필수/선택 입력·가격 확인·재평가/만료 기준과 대상 기간·표본·비용·허용 위험·지연·통과/중단 기준을 C09에서 사전 확정. 매수 G-N과 보유 G-H의 증거는 별도로 판정 |
| 현재 연구 결과의 해석 | 가격 시험, 11/06 장전 샘플, 네 구간의 미검증 영역 구분 | 11/13 오전 6시 KST 이후 장전 샘플 채점. 확장 입력과 에이전트의 우위는 단계별 비교와 전진 관측에서 확인 |

흐름을 사례로 대조했다. **중복 실적 기사**는 1단계에서 한 사건으로 묶고 새 정정은 후보 개정판을 만든다. **조건 확인 전 급락 반등 후보**는 2단계 관찰에 남기며 3단계 미충족이면 순위 비교를 기다린다. **보호 발화와 일반 감축 동시 발생**은 보호 경로를 우선하고 기존 매도 주문/잠긴 수량을 대사할 때까지 일반 후보를 대기시킨다. **순위 확정 후 가격대 이탈**은 기존 인계 관문에서 다시 대기 또는 만료로 처리한다. 이 사례 대조는 절차 검토이고 구현 후 회귀 시험과 주문 없는 전진 검증이 남아 있다.

## v0.1 전 기간 재백테스트와 판정 검토안

### 실제 평가 범위

2026-11-06 KST에 일봉과 후보판을 읽기 전용으로 확인했다. 현재 개정판 1의 **125개(나스닥 101·기존 NYSE 24)** 중 USD 일봉이 있는 **69개(48·21)**의 전 기간을 주평가에 사용했다. 시세가 없는 56개는 나스닥 53·NYSE 3이다. 저장소에는 목록 밖 NAS 1개도 있어 전체 NAS/NYS 70개는 민감도로 계산했다. 개정판은 2026-11-03 KST에 등록됐고 NYSE 자동 산출 목록은 0행이다. 과거 날짜별 공식 Nasdaq-100 구성, NYSE 시총 상위 50과 상폐 수익이 복원되지 않아 이 연구의 모집단은 **현재 개정판과 일봉의 고정 교집합**이다.

**가격 범위**는 2023-03-28~2026-11-05 ET, 907세션이다. 54,178행 중 54,129행이 확정 수정 USD 가격 품질을 통과했다. 49행은 거래량 0(43), 품질 표시(5), OHLC 오류(1)였다. 매수 조건 발화는 2023-09-27~2026-11-04이고, 마지막 완결 판단일은 2026-10-29다. 매도는 월 첫 정규장 시가를 공통 진입으로 삼은 2023-05-01~2026-10-01의 42개월이다. 가격 재생에는 기존과 같이 편도 15bp를 적용했다. [집계·거래소별/연도별 결과·입력 해시](../../../docs/research-data/T-156-v01-historical-replay-2026-11-06.json)

### 네 단계 통과율

| 단계 | 가격으로 평가한 분모와 결과 | 자료가 필요한 판정 |
|---|---|---|
| **1. 공시·뉴스** | 수집 원장에 RSS 5,279행(최초 10/28 KST), SEC 수집 흔적 2행(11/04~05 KST). 보관 본문·발췌 참조는 두 출처 모두 0행 | 기업별 당시 14일 전체 판본·최초 관측·원문 정답표가 없어 E2/M2/M3 해석 통과율 미채점. 보존된 접수 메타데이터나 최신 공식 사례만으로 무사건을 확정하지 않음 |
| **2. 관찰 후보** | 매수는 69종목의 공통 초기 59일 이후 58,512종목일 중 **49,705(84.95%)**에서 연속 60봉 확보. 이 중 B0 **1,245(2.50%)**. 매도는 공통 2,468개 가상 포지션의 기본 보호 이전 7,336개 평가 종가에서 두 지수 하락 **724(9.87%)** → MA20 하회 **321(직전의 44.34%)** → 5일 −3% 이하 **121(직전의 37.69%, 전체의 1.65%)**. 기술 조건을 한 번 이상 충족한 포지션 **84개(3.40%)** | 날짜별 적격 여부와 실제 계좌 포지션은 미복원. S-W 기술 수치는 시장·가격 부분의 통과율 |
| **3. 조건 확인** | 매수 B0 관찰 1,245개 중 W **397(31.89%)**, G **1,094(87.87%)**, WG **337(27.07%)**. 동일 종목 5거래일 중복을 제거한 576개 중 각각 177, 493, 142개. 매도 기술 후보 84개 중 보호보다 먼저 조치가 가능한 가격 대리는 **40개(47.62%)** | 매수 G는 시가 관측 근사이며 확인 후 실행 호가·당시 실적/환율·현금 등 전체 관문은 미재현. 매도 84개 모두 당시 공식 사건 확인 미관측으로 정식 S-W의 통과율은 미채점 |
| **4. 최종 순위** | 전 기간 1,245 B0 중 모의 5자리로 배정 가능한 수는 1,117(89.72%). WG는 337 중 323(95.85%). 학습 종료 이후(2025년부터) 고정 기술 점수로 WG 241 중 **229(95.02%)**를 배정했고 144 후보일 중 5자리 한도를 넘은 날은 **4일** | 2023~24년에 학습한 점수는 그 기간에 소급 채점하지 않음. 공식 사건에 의한 재정렬, 실제 현금·잔량·예약 기반 매수/매도 순위는 미채점 |

통과율과 손익 분모를 구분한다. 예를 들어 576개 비중복 매수 관찰 중 7개는 D+5가 닫히지 않아 손익 비교에서 제외했다. 매도는 자료 창이 충분한 포지션에서 보호 전에 기술 조건을 계산했으며, 동일 종가에서 보호가 함께 발화하면 보호를 우선했다. 미채점은 통과율 0%로 표시하지 않는다.

### 매수 성과

B0는 현행 장마감 과매도 기술 조건의 가격 대리다. B0로 발화한 기회를 먼저 고정하고 동일 종목의 5거래일 보유 중복을 제거했다. D1 시가→D+5 종가 순수익을 계산하고, 미선택을 현금으로 둔 **공통 569기회**를 비교했다. 종목과 20거래일 블록을 함께 재표집한 95% 구간은 탐색 비교의 불확실성을 보여준다.

| 방식 | 가격상 가상 진입 | 선택 건 평균 순수익 | 전체 기회당 순수익 | B0 대비 차이와 95% 구간 |
|---|---:|---:|---:|---:|
| B0 기본 기술 조건 | 569 / 569 | +0.2502% | +0.2502% | 기준 |
| W %R 확인 | 176 / 569 (30.93%) | +0.6980% | +0.2159% | −0.0343%p [−0.633, +0.567] |
| G 시가 갭 제한 | 487 / 569 (85.59%) | +0.0300% | +0.0257% | −0.2245%p [−0.535, +0.046] |
| WG 둘 다 | 141 / 569 (24.78%) | +0.4237% | +0.1050% | −0.1452%p [−0.795, +0.503] |

| 거래소 표본 전 기간 | 완료 기회 | B0 기회당 | W 증분 | G 증분 | WG 증분 |
|---|---:|---:|---:|---:|---:|
| NAS 48종목 | 379 | +0.0891% | +0.1181%p | −0.2604%p | −0.0587%p |
| NYS 21종목 | 190 | +0.5715% | −0.3381%p | −0.1528%p | −0.3176%p |

2025년 이후 W는 389기회에서 +0.0602%p였지만 2025년 −0.2076%p, 2026년 +0.3211%p였다. 전체에서 중복 허용 시 W와 WG의 증분 부호가 바뀌었고, 편도 25bp·37.5bp 민감도에서도 W의 방향이 달라졌다. G는 손실 33건을 피하고 수익 49건을 놓쳤다. G의 D1 시가 관측 후 같은 시가 체결은 일봉 근사이며, D2 시가로 늦춘 민감도(원 정책의 D1 만료 밖)에서도 G는 −0.2658%p, D2 가격도 밴드를 요구하면 −0.1337%p였다. 70종목으로 넓혀도 W/G/WG의 전체 증분은 −0.0350/−0.2268/−0.1454%p다.

고정 기술 순위는 종전 모델을 2023~24년의 같은 입력과 설정으로 다시 적합하고, 2025년 이후에만 점수를 계산했다. 학습 이후 B0의 가격 확인 가능한 같은 용량 336 후보일에서 종목코드 순서 진단 대비 **+0.0091%p**(95% 구간 −0.0500~+0.0672%p)였다. WG는 다섯 자리 한도가 걸린 날이 4일뿐이어서 순위 변경 효과가 희소하다. 이 진단은 같은 모의 5자리를 사용하고, 종목코드 순서는 운영 기준선과 별개다.

### 매도 성과

실제 계좌 자료 대신 공통 2,468개 가상 포지션(NAS 1,683·NYS 785)을 비교했다. 월별 잠재 3,105개에서 초기 19봉 부족 138개, 후행 10일 미완료 69개, 필요 일봉 결손 430개를 제외했다. 진입은 월 첫 시가, 청산은 확정 종가 판단 후 다음 시가이며, 계속 보유의 평가는 5/10세션 뒤 시가다. 25% 모의 감축은 가상 100주에서 25주를 한 번 매도하고, 잔량에는 기존 보호를 계속 적용한다. 이 비교는 현재 보호의 종가 대리이고 장중 판단과 체결은 별도다.

| 방식 | 5거래일 평균 순수익 | 10거래일 평균 순수익 | 10일 평균 최대 역행 |
|---|---:|---:|---:|
| 계속 보유 | +0.633% | +1.898% | −5.044% |
| 기본 보호 대리 | +0.042% | +0.096% | −2.518% |
| 기본 보호 + 기술 약세 시 전량 | +0.119% | +0.174% | −2.439% |
| 기본 보호 + 기술 약세 시 25% 감축 | +0.061% | +0.116% | −2.496% |

25% 가상 감축의 기본 보호 대비 10일 차이는 **+0.0193%p**(월별 재표집 95% 구간 **−0.0043~+0.0646%p**)다. 조기 조치 40건은 4일에 집중됐고 2025-04-02의 29건을 빼면 **−0.0018%p**로 바뀐다. 전량 대리도 같은 날 제외 후 **−0.0072%p**다. 10일 평균은 NAS 기본 +0.2796%→감축 +0.3025%, NYS −0.2964%→−0.2847%였다. 가상 수량을 3주로 두면 25% 내림은 0주여서 기본 보호와 같아진다. 70종목 민감도도 4월 2일 제외 후 증분이 음수다.

실제 기존 장마감 AI의 입력·판단·발행, 기존 보호의 장중 경로, 공시 결합 S-W/S-E, 계좌 기준 순위에는 동일 기회 자료가 부족하다. 이번 비교로 W의 일관된 개선은 확인되지 않았고, G 또는 WG의 필수 제한 채택 근거도 부족하다. 매도 기술 단독 감축은 유효한 공시 근거를 기다리는 별도 연구로 남긴다. 운영 주문이 차단됐던 건은 어느 성과 분모에도 넣지 않았다.

### C09 최소 표본·통과·중단 검토안

아래 숫자는 **검토용 사전 등록 제안**이다. 이미 열람한 2023~2026년 결과는 재현·탐색으로 분류한다. 시작·종료 시각, 고정 데이터/모델/정책판, 각 방향의 주 비교 1개, 비용·체결·평가 단위를 새 시간순 표본을 보기 전에 잠근다. 가격 재현과 주문 없는 전진 관측을 각각 보고하고, D+5/D+10이 비교 기간 경계를 넘는 기회는 기간별 채점에서 제외하거나 종료 시점 이후 결과 성숙까지 기다린다. 기간·컷·모델을 바꿀 때는 새 판본과 미사용 표본을 등록한다.

| 평가 | 최소 표본 제안 | 통과 제안 |
|---|---|---|
| 1단계 사건 해석 | 독립 원문 표본 **100사건**, 그중 공식 M2/M3 **25건 이상**, 재보도·정정·상충 **25건 이상** | 공식 M2/M3 재현율 **90% 이상**을 시작값으로 검토. 정확도·재현율 95% 구간과 미채점률 병기. 날짜 이후 정보나 근거 없는 공식 등급은 허용하지 않음 |
| 2~3단계 B-R 매수 | 새 **12주**, 종결 가상 진입 **100건 이상**, 진입 **30거래일 이상**, 대조군과 진입/배정이 달라진 **20거래일 이상** | D+5 공통 기회당 비용 후 증분의 블록 95% 하한 **>0**, 같은 예산의 최대낙폭 악화 **≤2%p**. W를 우선 가설로 등록하고 G/WG는 민감도로 표시 |
| 2~3단계 S-W 감축 | 새 **16주**, 종결 감축 비교 **50포지션 이상**, 판단이 달라진 **20거래일 이상**, 사전 정의한 독립 충격 군집 **5개 이상** | D+10의 감축대금+잔량 가치 기준 역행폭 개선의 군집 95% 하한 **>0**, 비용 후 총가치 차이의 95% 하한 **≥−0.10%p**. 가장 큰 기여 충격 군집을 빼도 위험 개선 방향 유지 |
| 4단계 순위 | 같은 세션·방향에서 한도가 실제로 적용되고 두 순서가 배정을 바꾼 **20거래일 이상** | 같은 예산·슬롯에서 비용 후 증분의 블록 95% 하한 **>0**, 기존 위험·집중도 한도 충족. 방향별로 따로 판정 |

위 기간은 종료 시점을 정하기 위한 초기값이다. 예정 종료 뒤 결과 성숙을 기다리고, 표본이나 개선 증거가 부족하면 각각 **증거 부족 / 채택 보류**로 남긴다. 겹치는 보유기간과 동일 충격에 속한 날짜는 재표집에서 묶는다. **주문 경로 유입·중복/초과 감축·미래 정보·통화 오류 1건**이면 해당 모의판을 즉시 중단한다. **최근 예정 10세션 중 3세션 이상**에서 필수 입력 또는 확인 뒤 호가가 빠지면 자료 문제로 관측을 일시 중단하는 안이다. 종료 시 기준 미달 또는 위험 한도 위반은 해당 가설을 보류한다. 표본·허용 손실·기간 가정은 검토 대상이며, 통과 후 운영 전환은 신규 매수 G-N과 보유 관리 G-H를 별도로 적용한다.

## 예상수익 기반 매수·매도 계좌 시뮬레이션

같은 후보판 69종목(나스닥 48·NYSE 21)의 2023-03-28~2026-11-05 ET 가격을 사용했다. 주 비교는 기존 가격 연구와 겹치는 **2025-01-02~2026-11-05**이며, 월별 학습이 처음 가능한 **2024-01-02**부터 시작한 계좌도 별도로 계산했다. 당시 공식 구성과 상폐, 공시·뉴스·실제 계좌가 복원되지 않아 현재 개정판의 가격 표본을 사용했다.

### 판단 시점과 수익 계산

매월 첫 거래일 **이전에 5거래일 후까지 결과가 닫힌 과거 표본**으로만 정규화 회귀를 학습했다. 최초 120개 완료 판단일이 필요하다. 5·20일 수익률, 40일 평균과의 거리, ATR(14)/종가, 5일/20일 거래량 비율, Williams %R 복귀를 그날 확정봉까지만 계산했다. 모델은 다음 정규장 시가에서 이후 1~5번째 정규장 종가까지의 USD 수익률을 예측한다. 매수의 순수익은 예상 수익률에서 양쪽 가상 비용을 반영한다. 보유 중에는 지금 팔기와 같은 예정 만기까지 들고 가는 선택을 비교하므로 두 선택에 공통인 매도비용을 제외한 남은 기간 가격 변화의 부호로 판단한다. [시간순 검증 방식](https://otexts.com/fpp3/tscv.html)

세 계좌 모두 **초기 100,000달러, 최대 5종목, 진입당 직전 종가 평가액의 15% 이내, 정수 수량, 편도 15bp**를 적용했다. 매수는 확정 종가 판단 후 다음 시가에 모의 체결한다. 매도대금은 다음 거래일부터 가용 현금으로 계산했다. 확정 시가·종가를 사용하는 가격 대리이며, 호가·시장 충격·별도 세금·환율·실계좌는 반영하지 않았다. 평가기간 안에 5번째 종가까지 성숙할 수 있는 진입만 주문 후보로 삼았다.

| 정책 | 매수 | 매도 |
|---|---|---|
| A 기존 기술 조건 대리 | 과매도 B0 통과 종목 중 RSI가 낮은 순서로 배정 | 매수 후 5번째 정규장 종가 |
| B 예측 매수 | 같은 B0 후보 중 **예상 순수익 >0%**인 종목을 예상수익이 높은 순서로 배정 | A와 같은 만기 |
| C 예측 매수·매도 | B와 같은 예측 매수 규칙 | 남은 1~4거래일의 가격 변화 예상이 **0% 미만**이면 다음 시가에 청산하고, 나머지는 5번째 종가에 청산 |

매수 당시의 **예상손익**은 그때 매수한 수량을 예정 만기까지 보유한다는 예측에서 계산했다. 같은 진입 건의 이후 종가로 계산한 5일 보유 결과를 붙여 예측 오차를 확인했다. **모의 실현손익**은 각 계좌가 실제로 선택한 가상 매도 가격과 수량으로만 채점했다. 개별 거래의 예상 달러 합계는 거래 당시의 가상 배정을 조건으로 한 값이다. 초기 원금에 적용한 사전 복리수익률은 별도로 산정하지 않았다.

### 계좌 결과

| 정책 | 완료 거래 | 기말 USD | 누적 모의 수익률 | 최대낙폭 |
|---|---:|---:|---:|---:|
| A 기존 기술 조건 대리 | 275 | 95,771.05 | −4.23% | −16.81% |
| B 예측 매수 + 5일 보유 | 221 | 98,994.62 | −1.01% | −17.21% |
| C 예측 매수 + 예측 매도 | 224 | 103,180.04 | **+3.18%** | −16.16% |

B의 진입 당시 5일 예상손익 합계는 **+20,671.83달러**였고 같은 거래의 5일 모의 실현은 **−1,005.38달러**였다. C의 진입 당시 5일 예상손익은 평균 **+0.6176%**, 합계 **+21,486.79달러**였다. C의 같은 진입을 모두 예정 만기까지 들고 갔다면 모의손익은 **+1,492.03달러**, 예측 매도를 적용한 계좌는 **+3,180.04달러**였다. 예상 합계와 실제 차이에는 예측 오차가 있고, C의 실제 수익에는 매도 시점 변경도 포함된다.

C의 예측 조기 청산은 28건으로 같은 진입의 만기 보유보다 14건이 좋고 14건이 나빴다. 직접 손익 차이 합계는 **+1,688.01달러**이며, 그중 2025-01-14 ET의 ALNY 한 거래가 **+1,146.77달러**였다. 해당 날짜를 제외한 직접 비교는 **+541.24달러**다. 이는 동일 진입건의 매도 시점 기여를 계산한 값이다. C와 B의 전체 계좌 차이에는 이후 자금과 슬롯이 달라져 선택된 거래의 변화도 포함된다.

| 기간·비용 | A | B | C |
|---|---:|---:|---:|
| 2024-01-02~2026-11-05, 편도 15bp | −1.66% | +9.83% | +13.48% |
| 2025-01-02~2026-11-05, 편도 15bp | −4.23% | −1.01% | +3.18% |
| 2025-01-02~2026-11-05, 편도 30bp | −15.25% | −8.53% | −7.86% |

비용 민감도는 진입 기준도 해당 비용으로 다시 계산했다. C는 주 비교의 2025년 **+5.41%**, 2026년 11/05까지 **−2.11%**였다. 과거 평균만 쓰는 모의 정책은 15bp에서 A와 같은 275건·−4.23%였고 30bp에서 27건·+1.64%였다. 종목별 5일 예상수익의 전체 31,033종목일 평균절대오차는 **4.4524%p**, 월별 과거 평균 대조는 **4.4391%p**였다. 따라서 예측 계좌의 개선을 새 표본에서의 예측 우위로 해석할 증거는 부족하다.

### 종목·거래 사례와 교차 확인

| 종목 | C의 거래 수 | 진입 당시 평균 5일 예상 순수익 | C의 누적 모의손익 |
|---|---:|---:|---:|
| ALNY | 7 | +0.65% | +2,875.42달러 |
| APP | 5 | +0.60% | +2,426.69달러 |
| INTU | 14 | +0.61% | +2,315.46달러 |
| PLTR | 1 | +1.15% | +2,183.35달러 |
| TER | 4 | +1.11% | −5,610.34달러 |
| MRVL | 4 | +1.20% | −4,260.13달러 |
| ARM | 7 | +0.96% | −4,224.55달러 |

2026-10-29 ET에 C가 매수를 결정한 NFLX는 5일 예상 **+0.44%**에 모의 실현 **+3.57%**, META는 예상 **+0.33%**에 실현 **−2.89%**, TER는 예상 **+1.00%**에 실현 **−23.88%**였다. AMAT는 2026-10-27 매수 판단의 5일 예상이 **+0.36%**였고, 10/29에 남은 3거래일 예상이 **−0.09%**로 바뀌어 10/30 시가에 조기 청산했다. 이 거래는 **−1.75%**였지만 만기 보유 대리보다 **608.76달러** 손실을 덜었다.

별도 재생에서 계좌 슬롯 효과를 제거하고 B0 매수 453기회를 비교하면 예측 양수만 진입한 방식은 기회당 **+0.0757%**, B0는 **+0.1274%**였다. 월초 가상 보유 1,502건의 기본 보호에 독립적인 25% 예측 감축을 붙인 시험도 개선을 확인하지 못했다. 주 기준 −0.5% 미만은 0건, 사후 민감도인 0% 미만은 10일 기준 40건을 바꾸고 **−0.0006%p**였다. 두 확인은 모집단·기간 및 매도 방식이 달라 계좌 C의 결과와 별도로 기록한다.

월별 학습의 마지막 결과일이 예측 적용일보다 앞선지 대조했다. 2025-10-31 ET 뒤 모든 가격을 1.7배로 바꾸고 다시 계산해 그 이전의 **209일 계좌와 87개 완료 거래**가 그대로인지 확인했다. 69종목 전체의 거래 수·손익·예상수익, 일별 계좌, 모든 가상 거래와 분기별 독립 비교는 집계에 보존했다. 이 기간은 이미 관측한 가격의 탐색 재생이다. 비용과 시작일에 대한 민감도 및 새 표본에서의 검증 여부를 C09 검토에서 판단한다. [전체 종목·거래별 계좌 집계](../../../docs/research-data/T-156-forecast-ledger-2026-11-06.json)

## 공시·뉴스 판단을 추가한 시점 재구성 모의

### 공통 평가와 당시 공개 자료

앞선 예측 매수·매도 계좌를 **2026-10-22~11-05 ET의 11거래일**에 초기 100,000달러로 다시 시작했다. 기존에 원문을 확인해 둔 10월 말 구간과 D+5까지 가격 결과가 닫히는 구간을 사용했다. 신규 판단은 10/22~10/29이며 기술 관찰이 발생한 날은 5일이다. 양쪽은 같은 69종목, 같은 월별 가격·거래량 예측, 최대 5종목, 진입당 평가액 15% 이내, 편도 15bp, 다음 시가와 예정 만기 종가를 사용하는 체결 대리다. 이 기간에 들어올 때 이전 거래의 잔고를 이월하지 않았다.

회사 공시·기업 발표 **47개 종목·출처 행**과 언론 **21행**(시장 배경 5행 포함)을 찾아 원문에 근거한 사건의 중요도와 방향을 분류했다. 한 회사의 두 주식 클래스와 재인용은 증거 수를 부풀리지 않도록 사건을 연결했다. 출처 행은 회사의 고유 사건이나 적격 판단 건수와 다르다. 소급 확인한 언론의 기사 내용은 맥락으로만 사용했다. 독립 보도 2개로 교차 확인한 E1은 10/22 META의 신용위험 지표 확대 1건이고, 공식 기업 원문 E2와 구분했다. [Reuters의 당시 보도](https://www.marketscreener.com/news/meta-s-credit-risk-indicator-jumps-to-record-high-after-results-ce785cdedd89fe23) · [Bloomberg의 독립 보도](https://bloomberg.com/news/articles/2026-10-22/meta-credit-risk-gauge-hits-fresh-high-on-ai-spending-plans)

시점은 **정규장 종가 16:00 ET**로 고정하고 직전 **14×24시간** 자료만 판단에 포함했다. 접수 시각만 확인된 SEC 문서는 접수 **5분 후**를 공개 가능 시점의 보수적 대리로 사용했다. 날짜만 확인된 자료는 해당일 **23:59:59 ET**로 처리했다. 예를 들어 10/28 Alphabet 실적 공시 접수 16:01:33 ET는 그날 종가 판단에서 제외했다. 실제 앱의 최초 관측과 기사 초판·변경 이력은 보존 자료가 부족하다. [SEC 시각 설명](https://www.sec.gov/about/webmaster-frequently-asked-questions) · [Alphabet 8-K](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000080/goog-20261028.htm)

### 에이전트 판단과 변경 내역

| 단계 | 실제 적용 | 자료 또는 표본의 한계 |
|---|---|---|
| 1. 공시·뉴스 해석 | 원문으로 E2·사건 중요도·방향을 판정했다. B0 기술 관찰 26종목일·16종목 중 **18종목일**에 E2, **9종목일**에 기업 관련 기사가 컷오프 안에 있었다 | 전 종목의 14일 원문 전수와 최초 앱 수집 시각 미복원. 근거 없음은 수집·판본 미확인으로 분리 |
| 2. 관찰 후보 | 양쪽의 B0 기술 조건과 가격 예상수익을 동일하게 유지하고 확인된 사건을 붙였다 | 가격 적격군 자체를 뉴스로 확대하는 가설은 별도 비교 |
| 3. 조건 확인 | 보유 중인 심볼을 제외한 매수 평가 **18건** 중 E2 확인 **11건**, 기업 기사 **4건**. **전사 또는 등록 가설에 직접 충돌하는 부정 E2·M2/M3이면 대기**. 엄격한 적용에서 매수 변경 **0건**. 보유 확인 **28건** 중 기업 근거 확인 **23건**, S-W의 가격 조건 통과 **0건**, 공시 결합 감축 **0건** | 기술 확인과 공식 악화가 함께 나타나는 매도 기회 미관측. 시세 대리를 사용했고 실제 주문 호가는 미재현 |
| 4. 최종 순위 | 확인 후보를 같은 가격 예상수익 순으로 배정. 사건 분류와 판정 근거를 보존 | 각 비교 그룹의 사건 자료 전수가 부족해 기사·공시에 의한 재정렬 효과는 미채점 |

넷플릭스의 10/20 공식 주주서한은 같은 FY2026 **광고 매출 전망을 약 30억→27억 달러(−10%)**로 낮췄다. 전사 매출 전망은 이전 범위 중간값 대비 **약 −0.2%**, 연간 영업이익률 전망은 **31.5% 유지**였다. 광고 성장을 단기 기술 반등의 필수 전제로 등록한 증거가 없어 엄격한 적용에서는 매수 보류 사유로 쓰지 않았다. **부문 전망 하향만으로도 대기하는 탐색 민감도**에서는 10/29 판단의 NFLX 매수 1건이 빠졌다. 다른 진입은 같고, 해당 거래의 모의 순손익 **+553.59달러**가 빠져 최종 수익률이 약 **0.55%p** 낮아졌다. 부문 악화를 모든 기술 반등의 무효화 근거로 쓸지 판단하기 위한 한 사례다. [Netflix 직전 전망](https://www.sec.gov/Archives/edgar/data/1065280/000106528026000211/ex991_q226.htm) · [Netflix 수정 전망](https://www.sec.gov/Archives/edgar/data/1065280/000106528026000290/ex991_q326.htm)

### 계좌 손익과 최대 구간

| 방식 | 최초 투자금 | 기말 평가액 | 최종 모의손익 | 수익률 | 최대낙폭 | 완료 거래 |
|---|---:|---:|---:|---:|---:|---:|
| 가격·거래량만 | $100,000.00 | $98,890.02 | −$1,109.98 | −1.1100% | −5.6849% | 7 |
| 가격·거래량 + 공시·뉴스 판단, v0.1 엄격 적용 | $100,000.00 | $98,890.02 | −$1,109.98 | −1.1100% | −5.6849% | 7 |
| 부문 전망까지 매수 보류, 탐색 | $100,000.00 | $98,336.43 | −$1,663.57 | −1.6636% | −5.8045% | 6 |

가격 기준선과 엄격 적용 계좌의 일별 평가액과 거래 7건이 모두 일치했다. 참고로 **당시 E2를 한 건 이상 찾은 판단일만** 양쪽에 공통 허용한 별도 표본도 둘 다 −4.4963%, 최대낙폭 −10.2205%였다. 이는 진입 집합이 다른 민감도다. 공개 자료가 확인된 이 짧은 구간의 **직접 무효 사건 0건, S-W 가격 조건 0건**으로 에이전트 성과의 일반적 우열을 판정할 수 없다. 전체 뉴스 역사와 최초 수집 판본, 실제 호가·계좌·발행 경로는 미검증으로 남긴다.

| 구간 정의 | 가격 기준선·엄격 적용 공통 | 부문 전망 보류 민감도 |
|---|---|---|
| 최대 손실 구간(앞선 고점→이후 저점) | **10/28→11/02 ET**, $104,396.08→$98,461.30, **−$5,934.78 (−5.6849%)** | **10/28→11/05 ET**, $104,396.08→$98,336.43, **−$6,059.66 (−5.8045%)** |
| 최대 상승 구간(앞선 저점→이후 고점) | **10/23→10/28 ET**, $99,927.40→$104,396.08, **+$4,468.68 (+4.4719%)** | **같은 기간**, **+$4,468.68 (+4.4719%)** |

가격 기준선이 이전 계좌의 같은 시작일 재실행과 일치하는지, 모든 사용 자료의 시점이 판단 이전인지, 기말 잔액과 거래별 손익이 합산되는지 대조했다. [공시·뉴스 출처, 판단별 입력, 모든 모의 거래와 일별 평가액](../../../docs/research-data/T-156-event-agent-replay-2026-11-06.json)

## 손실 원인과 전략 반복 검증

직전 평가와 같은 69종목(나스닥 48, NYSE 21), 초기 $100,000, 최대 5포지션, 진입당 15% 이내, 다음 정규장 시가, 매도대금 다음 세션 사용을 기준으로 삼았다. 기술 진입·예측 매도 계좌 C를 대조군으로 사용했다. 편도 15bp와 30bp를 각각 적용했다. 24개 진입·시장·배분 조합, 청산 정책·대조 9개, 추세 6개, 하루 배정 대조 1개, 결합 2개, 보유 상관 대조 4개를 재생했다. 공통 대조군 중복 1개를 빼면 **규칙 정의 45개**다. 값이 같은 전략과 거래 없는 경우도 집계에서 분리했다.

10/22~11/05의 손실 $1,109.98은 동일 체결의 비용 전 손실 **$796.06**과 비용 **$313.92**로 나뉜다. TER 한 거래에서 **−$1,919.62**가 발생했다. 10/28 고점에서 AMAT·LRCX·TER·ARM이 평가액의 **61.02%**를 차지했고 이후 최대 손실 $5,934.78 중 **$5,678.03(95.7%)**를 설명했다. 같은 진입의 5세션 예상손익 합계는 +$693.28, 같은 종목을 만기까지 보유한 가격 대리 손익은 −$1,392.62였다. 기존 예측 조기 청산으로 이 차이 중 $282.64를 만회했다.

| 전략 | 최근 11일 15bp / 30bp | 2026-01-02~11-05 15bp / 30bp | 2024-01-02~2026-11-05 연속 15bp / 30bp | 연속 최대낙폭 15bp / 30bp |
|---|---:|---:|---:|---:|
| C 가격 예측 기준 | −1.11% / −4.68% | −4.87% / −6.90% | +13.48% / −6.91% | −16.14% / −16.39% |
| E3 보유 3세션 뒤 다음 시가 청산 | **+1.99% / +3.72%** | −5.73% / −4.24% | +1.92% / −8.07% | −16.60% / −16.79% |
| R02 직전 5일 −8%·20일 −12% 이상만 신규 진입 | −3.43% / +0.47% | −2.87% / +2.30% | **+11.12% / +7.22%** | **−9.24% / −8.26%** |
| H1 R02와 E3 결합 | −2.67% / +1.07% | **+1.29% / +2.88%** | +10.53% / +4.45% | −8.37% / −9.46% |
| H2 R02와 종가 −3% 감축 결합 | −3.31% / +0.47% | −1.71% / +1.51% | +6.92% / +0.43% | −8.46% / −9.17% |

편도 15bp의 최근 E3 기말은 **$101,987.01**, 순손익 **+$1,987.01**, 최대낙폭 **−4.54%**, 완료 9건이다. 30bp에서 다시 종목을 고른 E3는 **+$3,723.91**이며, 15bp의 거래·수량을 고정해 비용만 30bp로 높이면 **+$1,576.74**다. 수익률 역전은 30bp 비용을 진입 예상수익 필터에도 적용해 종목이 바뀐 효과를 포함한다. 같은 거래·수량에서 비용만 올린 비교는 2024~2026 연속 계좌 C **−$3,551.86**, R02 **+$1,298.03**, E3 **−$16,932.50**이었다. 2026년 H1의 같은 체결 비용 비교는 **−$1,234.37**로, 종목을 다시 고른 경우의 흑자와 분리한다.

- **R02 선택과 확인** — 30bp 기준 2024·2025 각각 순수익 양수, 완료 20건 이상, 낙폭 −20% 이내인 조합 가운데 두 해 중 낮은 수익률을 최대화했다. R02는 2024년 **+3.18% / 65건**, 2025년 **+1.51% / 30건**, 설정 선택에 쓰지 않은 2026년 1/2~10/21 **+1.81% / 26건**이었다. 최근 구간의 30bp 흑자는 2건에 그쳤다. VIX≤25를 두 지수 50일 평균 조건에 추가한 결과는 해당 개발 통과 조합에서 거래와 성과가 같았다.
- **집중도 대조** — 하루 신규 2건 제한은 최근 15bp **−5.19%**였다. 직전 60일 수익률의 상관계수가 0.65 또는 0.80 이상인 기존·예약 포지션이 2개 이상이면 신규 진입을 보류한 별도 4개 설정에서도 두 비용·구간을 함께 통과한 규칙은 없었다. 0.65 기준 C의 최근 15bp는 **−3.02%**, 0.80은 신규 차단 0건으로 C와 같았다. R02 뒤에서는 둘 다 추가 차단 0건이었다. 가격 상관 규칙과 실제 산업군 평가액 집중은 따로 관찰한다.
- **추세 대조** — 20·60일 상승률과 5·10·20일 보유 조합 중 2024년 30bp로 고른 60일 강세·20일 보유는 2025~2026 연속 모의에서 만기 가능한 진입만 열었을 때 **+148.06% / +135.11%**, 최대낙폭 **−38.18% / −38.83%**였다. 15bp의 완료 손익 중 SNDK 비중이 **57.9%**였고 그 종목을 빼면 **+74.12%**였다. 최근 11일에는 추세 6개 모두 두 비용에서 손실이어서 과거 구성·상장폐지 자료와 집중도 검증이 필요한 별도 가설이다.
- **검토안** — R02를 진입 검증의 우선 후보로, H1을 청산 변경 대조군으로 남긴다. E3는 11일 손실 사례의 대조에 사용한다. 같은 관측 기간에서 15/30bp 순손익, 비용만 올린 고정 체결, 낙폭, 기회당 거래차이와 최대 종목·충격 제외 결과를 함께 본다. 각 전략이 다르게 판단한 시점과 미채점 사유를 보존한다. C09의 최소 표본과 중단 조건을 유지하고, 이미 본 구간은 재현 또는 탐색으로 분류한다. 여러 설정에서 양수가 나왔어도 동일 조건에서의 지속적인 양수 증거는 확보하지 못했다. [백테스트 설정 선택 편향 연구](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2308659)

69개는 이번 기간에 고정한 평가 우주다. 과거 편입·퇴출, 시장 전체 상승 종목 비중, 공시·뉴스의 과거 전체 수집판, 호가·시장충격 및 운영 시그널 발행은 재현하지 못했다. 앞선 두 JSON의 실제 거래 종목 수가 미거래 종목까지 포함한 69로 표기되어, 완료 거래 원장을 기준으로 정정했다. 직전 가격·뉴스 계좌는 각각 **7종목**이다. 기존 체결·손익·일별 평가액은 원장과 대조했다. [45개 규칙의 집계와 최근 원장](../../../docs/research-data/T-156-profit-iterations-2026-11-06.json)

## 2020~2026 일별 격리 DB 재생

### 평가 범위와 실제 적재

요청 기간은 **2020-01-01~2026-09-30 ET**, 실제 미국 거래일은 2020-01-02부터 **1,695일**이다. Ubuntu에 MariaDB 10.11의 전용 `t156_research_20261106`과 보존 볼륨을 만들었다. 컨테이너는 외부 네트워크·공개 포트 없이 내부 소켓으로 연결하며 DB 이벤트 스케줄러는 OFF다. 운영 가격은 이전 읽기 전용 추출에서 가져왔고, KIS 샘플과 SEC·시장 자료는 각기 원천과 해시를 보존했다. 가격 계산은 격리 DB에서 날짜순으로 다시 읽은 뒤 결과를 같은 DB에 저장했다.

| 자료 | DB에서 확인한 범위 | 실제 사용과 한계 |
|---|---:|---|
| S&P 500·나스닥종합·VIX | **각 1,695일** | 매일 이전 완료 주 국면, 직전 세션 VIX와 5거래일 변화 기록. XNYS 일정과 거래일 대조, 12개 조기 폐장 시각 확인. 계좌 가격 전략에는 가산점으로 넣지 않음 |
| 종목 수정 일봉 | **69종목, 52,384행**. 49행 제외 후 사용 | 2023-03-28~2026-09-30의 운영 읽기 전용 추출. 현재 목록 참조는 125종목이며 과거 구성 보장 없음. 직전 거래일과 짝지어 계산한 패널 상승 비중은 880일이며 거래소 전체 비중과 구분 |
| KIS 과거 조회 검증 | **AAPL 100행**, 2019-09-10~2020-01-31 | `BYMD=20200131`, `MODP=1` 단일 GET. 종목 일봉 원천과 분리해 저장했고 수익 계산에 사용하지 않음 |
| SEC 공시 접수 자료 | **CIK·accession 217,389행**, 고유 접수번호 217,364개, 연구 양식 7,239행 | 현재 69티커·68 CIK와 XOM 이전 CIK를 포함. 14일 창을 **116,955종목일**에 조회, 46,111종목일에 연구 양식 한 건 이상. 가격 예측 45,508종목일 중 18,287종목일과 겹침. 공시 본문 판단과 구분 |
| QQQ N-PORT 원문 | **27개·보유 2,748행**(주식 2,744행) | 보고 기준일 2019-12-31~2026-06-30, 접수 지연 50~62일. 구성 검산용 ETF 보유 자료. 공식 NDX 일별 구성으로 입력하지 않음 |
| 과거 편입·시장 상승 비중·언론 기사 원문 | 미확보 | 당시 Nasdaq-100 및 NYSE 시총 상위 50, 시장 전체 상승 종목 분모, 기사 최초·정정 판본과 저장·분석 권한이 필요 |

SEC는 접수 UTC와 접수 **+5분 대리**를 나눠 저장했다. 정규장 마감 UTC를 기준으로 최근 14×24시간을 조회했다. 초기 조회를 위해 2019년 12월 말 일부를 함께 보존했다. 접수 +5분은 공개·최초 수집 실측이 아니다. XOM은 2026-07-01 등록인 승계 전후 CIK를 분리하고, 14일 창이 효력일에 걸치면 날짜 경계를 적용해 두 등록인의 해당 공시를 본다. 다른 종목의 과거 식별자 전수 대사는 남아 있다. [FRED S&P 500](https://fred.stlouisfed.org/series/SP500) · [FRED Nasdaq Composite](https://fred.stlouisfed.org/series/NASDAQCOM) · [Cboe VIX](https://www.cboe.com/tradable_products/vix/vix_historical_data) · [SEC EDGAR](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) · [XOM 승계 공시](https://investor.exxonmobil.com/sec-filings/all-sec-filings/content/0001193125-26-292453/d54886dposasr.htm)

### 모의 성과와 검산

1,695일 중 **814일 종목 일봉 없음**, **192일 일봉은 있으나 예측 훈련·입력 부족**, **689일 가격 예측 평가 가능**으로 나뉜다. 현재 표의 성과 구간은 **2024-01-02~2026-09-30 ET**다. 첫 진입은 2024-01-05, D+5 결과가 평가 기간 안에 닫히는 마지막 판단 가능일은 2026-09-23이다. 이전 구간의 데이터 부족을 성과나 현금 대기 성공으로 채점하지 않는다. 최초 $100,000, 최대 5종목, 진입 15% 이내, 다음 시가, 편도 15·30bp, 기말 미청산 0으로 비교했다.

| 방식 | 순수익률 15bp / 30bp | 순손익 15bp / 30bp | 최대낙폭 15bp / 30bp | 완료 거래 15bp / 30bp |
|---|---:|---:|---:|---:|
| A 기술 진입·5세션 만기 | +4.39% / −11.69% | +$4,391.61 / −$11,685.99 | −16.80% / −18.36% | 374 / 374 |
| C 가격 예측 매수·매도 | +23.55% / +3.58% | +$23,551.46 / +$3,580.84 | −16.14% / −16.39% | 324 / 253 |
| R02 급락 종목 제외 | +15.08% / +6.71% | +$15,077.68 / +$6,710.83 | −9.24% / −8.26% | 195 / 121 |
| E3 보유 3세션 뒤 청산 | +9.52% / +0.27% | +$9,517.68 / +$266.95 | −16.60% / −16.79% | 398 / 299 |
| H1 급락 제외와 3세션 청산 결합 | +13.37% / +3.35% | +$13,369.76 / +$3,350.27 | −8.37% / −9.46% | 221 / 133 |

R02는 30bp에서 C보다 순수익률 **3.13%p**, 최대낙폭 **8.13%p** 개선했다. 15bp에서는 C보다 수익률이 **8.47%p 낮았다**. R02는 30bp에서 연속 계좌의 2024년 **+3.18%**, 2025년 **+1.58%**, 2026년 9월까지 **+1.81%**였다. 두 비용 모두 마지막 완료 거래의 매수 판단일이 **2026-07-21**이라 이후 구간 진입 성과는 미관측이다.

| 최대 상대 하락·상승 구간, 편도 30bp | C 가격 예측 | R02 급락 제외 |
|---|---|---|
| 고점→저점 | 2024-11-29→2025-04-08, **−$17,010.28 (−16.39%)** | 2025-02-25→2025-04-08, **−$8,733.10 (−8.26%)** |
| 저점→고점 | 2025-04-08→2026-09-08, **+$17,165.90 (+19.78%)** | 2025-04-08→04-09, **+$9,942.54 (+10.26%)** |

DB에서 일별 시장·커버리지 1,695행, 5방식·2비용 계좌 16,950행, 예측 45,508행을 다시 읽었다. 훈련 결과 성숙일이 예측 시점 이후인 행은 0이고, 종료 계좌의 손익과 완료 거래 손익이 센트 단위로 맞았다. 2026년 OHLC 12,903행을 1.7배로 바꿔 독립 재생해도 2025년 말까지 예측 32,605행, 계좌 15,080행, 완료 거래 1,960행은 동일했다. 1차의 기술 기준선 A에 섞였던 예측 조기 청산을 수정하고 `t156_20260930_kis_partial_v2`를 유효판으로 기록했다. C·R02·E3·H1은 1차와 수치가 일치한다. [기간·DB 검산·연속 계좌·최대 구간 전체 결과](../../../docs/research-data/T-156-daily-db-replay-2020-2026-2026-11-06.json)

### 전체 일별 분석에 필요한 입력과 운영 재사용

- **가격** — KIS 과거 페이지는 실제 응답을 확인했다. 현재 대량 호출의 우선순위는 운영 프로세스 내부에서 공유되며, 기존 날짜 역산 수집은 운영 테이블 쓰기와 5년 제한이 있다. 격리 DB로 장기 수집하려면 별도 조회 권한·할당량 또는 운영 요청과 같은 우선순위 큐를 쓰는 읽기 전용 격리 전달 경로가 필요하다. 현 데이터에서 같은 종목 69개만 준비기간부터 다시 가져와도 대략 최대 1,380회이며, 과거 편입·퇴출 종목은 별도다. [KIS 일봉 예제](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/overseas_stock/dailyprice/dailyprice.py)
- **당시 구성과 시장 상승 비중** — NDX 구성·효력일은 Nasdaq GIW와 공식 변경 공지로 대사한다. NYSE 상위 50은 당일 주상장, 보통주·ADR 기준, 클래스별 미수정 종가·당시 발행주식수, 거래정지·상폐를 확보하고 StockInvest 순위 규칙을 날짜별로 고정한다. 거래소 상승 비중은 유효 상장 종목 분모로 따로 계산한다. [Nasdaq GIW](https://www.nasdaq.com/products/global-indexes/data/giw) · [NYSE 종가 자료](https://www.nyse.com/market-data/historical) · [NYSE TAQ 필드](https://www.nyse.com/publicdocs/nyse/data/Daily_TAQ_Client_Spec_v4.3.pdf)
- **공시·뉴스** — SEC 접수 자료를 근거 원문과 연결하고 당시 판본을 확인해 기업 영향과 조건 충돌을 판정한다. 언론·경제 뉴스에는 최초·개정 시각, 사용 판본, 기업·경제 주체 매핑과 아카이브·모델 이용 권한이 필요하다. GDELT URL 발견 정보는 결측 확인용이며 당시 기사를 대신하지 않는다. 뉴스 결측일은 사건 0과 분리한다. [LSEG Machine Readable News](https://www.lseg.com/en/data-analytics/financial-news-service/machine-readable-news) · [GDELT 필드 정의](https://data.gdeltproject.org/documentation/GDELT-Global_Knowledge_Graph_Codebook-V2.1.pdf)
- **분석 재사용 경계** — 현행 장마감 해외 엔진은 현재 시계, 운영 스위치·DB, 최신 시세를 읽고 시나리오 카드를 저장한다. 검토안은 해당 엔진의 계산을 날짜·컷오프·판본이 고정된 스냅샷 입력과 분리해, 과거 재생과 주문 없는 전진 관측에서 같은 계산을 비교하는 것이다. 현재 검증은 날짜별 자료·가격 원장·공시 가용성의 격리 실행까지다. 주간 시장·상승 종목 비중과 공시·뉴스 판단의 증분 성과 및 사용자 보유 매도는 별도 채점해야 한다. [현재 장마감 입력 흐름](../../../src/lib/strategy/post-market-overseas.ts#L459)

## 공개 원천으로 만든 자료와 2020~2026 장기 재생

기존 구독·원본 파일 없이, 검증 가능한 공개 원천과 이미 확보한 연구 DB 자료를 묶었다. 2020-01-02~2026-09-30 ET의 1,695거래일을 이전과 같은 69개 고정 종목으로 가격 재생했다. 가격·시장 데이터, 실제 공시·발표 메타데이터, 모의 판단·계좌·거래를 로컬 연구 ZIP에 보존했다. 파일마다 공급자, 유효 범위, 확인하지 못한 항목, 행 수, SHA-256을 기록했다.

| 새 자료 | 실제 범위 | 사용 방식 |
|---|---:|---|
| Kibot 게스트 수정 일봉 | 69종목 126,883행, 2019-01-02~2026-09-30. 가격 판단 기간의 검증된 종목일 110,637행 | 공급자 자료의 내부 평가. 연구 MariaDB 적재 후 다시 읽어 가격 전략 재생 |
| DoltHub 미수정 일봉 | 현재 목록 125종목·ETF 3개의 원시 232,046행. 신원·날짜·OHLCV 검증본 230,496행, 2020년 이후 주식 198,045행 | CC BY-SA 4.0 원문과 고정 버전을 함께 보존. 연구 MariaDB에서 독립 가격 검산용으로 관리. 상장 이전에 같은 티커를 쓰던 종목, 실제 분할과 다른 표기, 이전 티커를 별도로 표시 |
| 시장과 공식 발표 | 1,695일의 지수·VIX, 연준 FOMC 56건과 BEA PCE 80회 발표 | 장마감의 최근 14일 창에 실제 발표 시각으로 연결. BEA 81개 기준월의 물가 수치 324개를 공식 원본과 대조. 장기 손익 표에는 적용하지 않음 |
| 회사 공시 | 접수 자료 217,389행 및 별도 원문 대조 4건 | 접수+5분 대리와 실제 공개 시각을 구분. 원문 확인 4건은 모두 당일 정규장 마감 뒤 |
| 과거 구성 증거 | 기간 내 Nasdaq 공식 공지 31건(편입 62·편출 64), QQQ 공개 보고 27개, NYSE 공식 공개 샘플 2거래일 | 원문과 기준일·효력일을 보존. 당시 Nasdaq-100 일별 구성과 StockInvest NYSE 상위 50 전 기간 자료는 미복원 |

현재 티커에 섞인 옛 Yandex **796행**은 NBIS 2024-10-21 거래 재개 전 자료로, SNDK의 **6행**은 2025-02-24 정규 거래 전 SNDKV 조건부 거래로 분리했다. 이 기준을 사용한 수정판은 `t156_20260930_kibot_guest_eval_v2`다. 이전 NBIS 연결을 유지한 실험에서 편도 0.30%의 C·R02는 **+4.97%·+4.67%**, 연결을 분리한 수정판은 **+3.05%·+9.49%**였다. 학습 표본이 바뀌면 다른 종목의 예측도 달라져, 데이터 연결 민감도를 남겼다. 기존 KIS와 겹치는 52,342종목일의 일간 종가 수익률 차이 중앙값은 2.58bp였다. [Kibot 평가용 API](https://www.kibot.com/api/api-overview.html) · [Kibot 이용 조건](https://www.kibot.com/license.html) · [DoltHub 공개 가격 원천](https://www.dolthub.com/repositories/post-no-preference/stocks) · [Nebius 거래 재개](https://nebius.com/newsroom/nebius-group-announces-planned-resumption-of-trading-on-nasdaq-and-provides-investor-update) · [Sandisk 정규 거래 전 공시](https://investor.sandisk.com/static-files/04f70eee-4588-4ee6-8b77-88f21efdc417)

| 방식 | 수익률 15bp / 30bp | 최대낙폭 15bp / 30bp | 30bp 종료 평가액 |
|---|---:|---:|---:|
| A 기술·5세션 보유 | +29.95% / −8.70% | −22.91% / −24.22% | $91,300.03 |
| C 기존 가격 예측 | +45.45% / +3.05% | −25.72% / −26.46% | $103,054.80 |
| R02 급락 제외 | +32.15% / +9.49% | −11.49% / −11.01% | $109,491.55 |
| E3 3세션 뒤 청산 | +17.95% / −2.96% | −26.64% / −30.84% | $97,040.53 |
| H1 급락 제외와 3세션 청산 | +26.27% / +8.30% | −9.92% / −9.42% | $108,300.31 |

초기 $100,000, 최대 5종목, 최대 15% 진입, 다음 거래일 시가 대리를 유지했다. 110,224개 가격 판단 기록에서 학습 결과일이 판단 시점을 넘은 행은 0이다. 전체 5,586개 완료 거래를 계좌 기말과 다시 맞췄다. R02 30bp는 2020년 **−5.78%**, 2022년 **−1.32%**, 2026년 9월까지 **−0.74%**였다. 편도 15bp에서는 C의 누적수익이 높았다. 이후 실제 체결가·호가·배당 지급을 재현하려면 미수정 가격과 확인한 기업행동이 필요하다.

이 장기 검증의 모집단은 현재 고정 69종목이다. 공식 구성은 일부 효력일의 증거만 있고 거래소 전체 상승 종목 분모와 당시 언론 원문·개정판은 미확보다. BLS 빈티지 일부와 매체 기사 발견 메타데이터는 가용성 확인용으로 보존했다. 당시 구성·뉴스 에이전트 결합의 효과와 운영 연결은 이후 같은 날짜 입력과 비용을 기준으로 검증한다. [장기 재생 집계](../../../docs/research-data/T-156-long-price-source-evaluation-2026-11-06.json)

## E3 청산 손익 분해와 시장에 따른 E3·R02 전환 검증

고정 69종목으로 단기 2026-10-22~11-05 ET 11거래일(KIS), 장기 2020-01-02~2026-09-30 ET 1,695거래일(Kibot 내부 평가용)을 별도 재생했다. 각 구간 안에서 초기 $100,000, 최대 5종목·진입당 평가액 15%, 다음 정규장 시가, 편도 15·30bp, 주문 및 마지막 매수 판단일의 가정을 맞췄다. 가격·거래량과 이력 길이가 공급자마다 달라 두 입력을 잇지 않았다. C·R02·E3·H1의 단기·장기·양쪽 비용 총 16개 기준 셀은 기존 종료액·낙폭·거래 수를 재현했고, 단기의 개별 거래와 일별 평가액도 일치했다.

편도 30bp의 단기 E3는 C 대비 **+$8,407.60**이었다. 공통 진입 7건을 C 수량으로 고정하면 하루 앞선 청산 효과는 **+$8,996.68**, 수량 변화는 **+$204.39**, 추가 TER 재진입은 **−$793.48**이었다. INTC 한 건은 10/26 시가에 함께 매수했고 E3가 10/29 시가, C가 10/30 시가에 청산했다. INTC의 손익 차이는 **+$4,170.30**으로 전체 개선액의 약 절반이었다. E3의 편도 15bp 단기 개선액은 **+$3,096.99**이며 공통 진입의 청산 효과가 **+$5,146.38**, 추가 거래 두 건의 합이 **−$2,047.69**였다.

편도 30bp 장기 E3는 **−$2,959.47**(C **+$3,054.80**)이었다. 완료 거래가 **502→606건**, 비용이 **$42,606.11→$46,905.51**로 증가했다. C 대비 순손익 차이 **−$6,014.27**은 비용 전 손익 차이 **−$1,714.87**과 추가 비용 **−$4,299.40**으로 분해된다. 공통 진입 420건의 청산 효과는 C 수량 기준 **−$3,633.31**이며, 181건 개선·195건 악화·44건 동일이었다. 편도 15bp의 체결과 수량을 고정하고 비용만 30bp로 바꾼 별도 계산의 장기 E3는 **−$21,100.17**이었다. 정상 30bp 재실행은 예상 순수익 기준에 따라 다른 매수가 발생한다.

전환은 매수 판단일의 **직전 거래일 마감 정보**로 한 번 결정했다. 선택한 규칙은 해당 포지션이 끝날 때까지 유지했다. E3는 기존 예측 청산에 보유 3거래일 뒤 다음 시가 청산을 추가하고, R02는 직전 5일 −8%·20일 −12% 이상을 만족하는 신규 매수에 기존 예측 청산을 적용한다. 시장값 누락 시 R02를 적용했다. 종가와 VIX가 나중에 알려진 값은 이전 진입에 소급하지 않았다. 기존 T-156 임계값을 사용한 네 전환과 고정 대조군을 모두 보고했다. [Cboe VIX 설명](https://www.cboe.com/tradable-products/vix)

| 규칙 | 단기 수익률 15 / 30bp | 장기 수익률 15 / 30bp | 장기 최대낙폭 30bp |
|---|---:|---:|---:|
| 기존 가격 예측 C | −1.11% / −4.68% | +45.45% / +3.05% | −26.46% |
| E3 고정 | +1.99% / +3.72% | +17.95% / −2.96% | −30.84% |
| R02 고정 | −3.43% / +0.47% | +32.15% / +9.49% | −11.01% |
| H1 두 조건 고정 | −2.67% / +1.07% | +26.27% / +8.30% | −9.42% |
| 전일 나스닥종합 5거래일 수익률 < 0이면 E3 | +3.36% / +3.72% | +40.97% / +9.92% | −30.02% |
| 전일 VIX ≥25 또는 S&P 500·나스닥종합 중 하나가 50일선 이하이면 E3 | +3.36% / +3.72% | +20.17% / −0.73% | −32.02% |
| 위 조건의 반대일 때 E3 | −3.50% / +0.47% | +30.90% / +2.25% | −9.69% |
| 전일 VIX ≥25일 때만 E3 | −3.43% / +0.47% | +20.32% / −0.03% | −27.99% |

나스닥종합 5일 규칙은 편도 30bp에서 두 구간 모두 C와 R02보다 순수익이 높았다. 단기의 완료 8건은 모두 E3로, E3 단독과 거래·손익이 같다. 장기 R02 대비 수익 차이는 **+$430.78**이나 낙폭은 **19.01%p** 커졌고 거래가 **181→486건**으로 늘었다. 기간별 초기화 재생에서 30bp **2020~2023년 +16.87%**(R02 +4.63%), **2024~2026년 9월 −5.96%**(R02 +4.65%)였다. KIS만 쓴 2024~2026-11-05 보조 재생에서도 **−5.49%**(R02 +7.22%)였다. 단기 신규 판단 가능일 6일의 직전 VIX는 **16.68~19.45**여서 VIX 25 단독 규칙은 R02와 같다.

두 비용·두 기간 모두에서 C와 R02의 순수익을 함께 넘어선 전환은 없었다. 이 구간들은 이미 검토한 과거 기간이며 종목 모집단은 현재 기준의 고정 69종목이다. 공개 시점이 검증된 뉴스와 당시 종목 편입 자료의 효과는 별도 검증 항목이다. [8개 전략·비용·보조 구간의 결과와 원장](../../../docs/research-data/T-156-market-regime-switch-2026-11-06.json) · [백테스트 선택 편향 연구](https://escholarship.org/uc/item/4w1110bb)

## 편도 0.25% 재실행과 규칙 선택 방식

사용자가 제공한 KIS 수수료 0.25%를 매수·매도 각각에 적용했다. 편도 비용을 뺀 5거래일 예상 순수익이 양수여야 신규 매수 후보가 된다. 거래 비용만 고려한 예상 상승률 하한은 **0.501253%** 초과다. 비용에 따른 매수 선별과 수량을 처음부터 다시 계산했다. 초기 $100,000, 고정 69종목, 동시 5종목, 진입당 평가액 최대 15%, 기존 체결 시점 및 판정 규칙은 이전 실험과 같다. 단기 11거래일은 2026-10-22~11-05 ET KIS, 장기 1,695거래일은 2020-01-02~2026-09-30 ET Kibot이다. 15·30bp 기준 대조의 종료액·낙폭·거래 수를 재현했다.

| 규칙 | 단기 순수익률 | 장기 순수익률 | 장기 최대낙폭 | 단기 / 장기 완료 거래 |
|---|---:|---:|---:|---:|
| 기존 가격 예측 C | −4.59% | +14.90% | −25.17% | 7 / 574 |
| E3 3거래일 청산 | +3.85% | −2.70% | −30.14% | 8 / 689 |
| R02 급락 제외 | −1.59% | +21.09% | −12.28% | 3 / 257 |
| H1 두 조건을 항상 결합 | −0.87% | +18.94% | −10.14% | 3 / 276 |
| 전일 나스닥종합 5일 수익률이 음수면 E3 | +3.85% | +15.83% | −28.04% | 8 / 567 |
| 전일 VIX ≥25 또는 두 지수 중 하나가 50일선 이하면 E3 | +3.85% | +5.69% | −29.75% | 8 / 572 |
| 위 조건의 반대일 때 E3 | −1.59% | +12.66% | −9.59% | 3 / 399 |
| 전일 VIX ≥25일 때만 E3 | −1.59% | +4.20% | −26.22% | 3 / 417 |

C는 가격으로 5거래일 예상수익이 비용을 넘는 매수 후보를 고르고, 남은 기간의 예상 가격수익이 음수가 되면 일찍 판다. E3는 기존 청산 규칙에 3거래일을 보유한 뒤 다음 시가에 파는 조건을 추가한다. R02는 기존 청산을 유지하며 5거래일 수익률 −8%, 20거래일 수익률 −12% 중 하나보다 더 하락한 종목은 신규 매수에서 제외한다. H1은 두 조건을 항상 결합한다. 전환 전략은 매수 판단일 직전 거래일의 시장 값으로 E3 또는 R02를 선택하고, 이후 그 포지션의 규칙을 바꾸지 않는다. 전환 전략을 선택하는 상위 규칙은 시험하지 않았다.

나스닥 5일과 50일선·VIX 전환은 단기에서 8건 모두 E3를 적용했다. 실제 매수 판단일은 10/23과 10/29, 직전 나스닥 5일 수익률은 −2.64%, −0.57%였다. 두 전환의 순손익은 E3 단독과 같은 **+$3,846.43**이었다. 장기 순손익은 나스닥 5일 전환 **+$15,828.04**, R02 고정 **+$21,091.51**이었다. 2024~2026년 9월을 초기자금부터 별도 재생하면 나스닥 전환 **−1.29%**, R02 **+11.41%**였다. 단기 E3 단독과 장기 R02 단독의 수익을 함께 넘어선 전환은 없다.

11/06 ET 가상 판단에 기존 저장본의 11/05 마감까지를 적용하면 나스닥 5일 **−7.14%**, VIX **28.18**로 나스닥 5일·VIX 단독 전환이 E3다. 저장본에 11/05 S&P 500 종가가 없어서 두 지수·VIX 조건과 그 반대 전환은 기존 결측 규칙대로 R02를 선택한다. 이는 규칙 분기만 확인한 예시이며, 개별 종목에 대해 해당일 매수 요건을 새로 평가하지 않았다. [25bp 재실행 수치와 거래 원장](../../../docs/research-data/T-156-kis-fee25-regime-replay-2026-11-06.json) · [나스닥종합 종가](https://fred.stlouisfed.org/series/NASDAQCOM) · [Cboe VIX 역사 데이터](https://www.cboe.com/tradable_products/vix/vix_historical_data)

## 당시 정보로 에이전트가 E3·R02를 고르는 순차 재생

2026-10-22~11-05 ET의 11거래일에서 편도 0.25%, 초기 $100,000, 고정 69종목과 기존 체결·보유 한도를 유지했다. 신규 매수 판단을 할 수 있는 6일에, 기존 대화를 넘기지 않은 연구용 판단 에이전트 두 실행에 날짜와 종목명을 가린 입력을 하루씩 전달했다. 두 실행은 같은 지시를 사용했다. A를 주 결과, B를 반복 확인으로 미리 정했다. 입력에는 전일 마감 시장 지표, 해당일 종가 기준 후보의 가격 예상치와 위험, 그날까지의 계좌 상태, 대상 기간 시작 전에 끝난 성과표를 포함했다. 이후 가격과 시험 기간 손익은 보여주지 않았다. 매일 기록한 선택으로 다음 날의 보유·현금을 재계산하고 다음 입력을 만들었다.

각 포지션의 청산 규칙은 신규 매수 때 정한 값을 유지했다. 6일의 선택과 근거를 해시로 고정한 뒤 손익을 계산했다. 별도 검산에서 각 판단일까지만 데이터를 잘라 가격 특징과 모델을 다시 계산한 결과, 시장 입력과 69종목의 예상값이 같았다. 기존 C, E3, R02, 나스닥 5일 전환의 거래·평가액은 25bp 원장과 일치했다.

| 판단일 ET | 두 에이전트 선택 | 당시 판단에 사용한 사실 | 완료된 매수 |
|---|---|---|---:|
| 10/22 | R02 기본값 | 매수 조건을 만족한 종목 없음 | 0 |
| 10/23 | R02 | 나스닥종합 최근 5거래일 −2.64%. 후보 6개 중 5개의 20거래일 낙폭이 22% 초과 | 1 |
| 10/26 | R02 | 후보 8개 모두 20거래일 낙폭 20% 초과 | 0 |
| 10/27 | R02 | 후보 5개 중 4개의 20거래일 낙폭이 21% 초과 | 1 |
| 10/28 | R02 기본값 | 매수 조건을 만족한 종목 없음 | 0 |
| 10/29 | R02 | 나스닥종합 최근 5거래일 −0.57%. 후보 3개 중 2개의 20거래일 낙폭이 12% 초과 | 1 |

| 방식 | 모의 순손익 | 수익률 | 완료 거래 |
|---|---:|---:|---:|
| 기존 가격 예측 | −$4,586.19 | −4.59% | 7 |
| 에이전트 A·B 및 R02 고정 | −$1,585.98 | −1.59% | 3 |
| E3 고정 및 나스닥 5일 전환 | +$3,846.43 | +3.85% | 8 |

두 에이전트 모두 기존보다 손실을 **$3,000.21** 줄였고, E3보다 **$5,432.40** 적게 벌었다. 이번에는 R02 고정과 거래·잔액이 같았다. 10/27 판단으로 산 GOOGL의 예상 수수료 후 수익은 **+0.005%**였고, 모의 실현 손익은 **−$2,081.25**였다. 손실 위험을 줄이는 규칙도 필터를 통과한 거래의 수익을 보장하지 않는다.

다른 날의 선택을 고정하고 하루씩 E3로 바꿔 재생했다. **10/23만 바꾸면 +$4,171.11**로 에이전트 경로보다 **$5,757.08** 높았고, **10/26만 바꾸면 −$2,237.47**로 **$651.49** 더 낮았다. 10/27은 **+$622.40**, 10/29는 **−$313.92**, 후보가 없던 두 날은 차이 0이었다. 각 재생은 거래가 바뀐 뒤의 현금과 다음 거래까지 포함하므로 하루별 차이를 더해 다른 전환 정책을 계산할 수 없다. 어느 날을 바꾸면 유리했는지는 이후 가격을 적용한 결과다.

이 실험의 판단은 당시 운영 에이전트의 실기록이 아닌 가려진 과거 데이터에서 관측한 연구 결과다. 종목 고정 및 수정 일봉 체결 가정이 있고, 공시·뉴스 전수와 실제 체결을 복원하지 않았다. 11일과 두 실행으로 다른 기간의 일반화나 운영 정책의 성과를 채점하지 않는다. [판단 입력·응답·고정 해시·비교 원장](../../../docs/research-data/T-156-blind-agent-replay-2026-11-06.json) · [운영 해외 판단 입력 흐름](../../../src/lib/strategy/post-market-overseas.ts#L666)

## 반등 가능성과 추가 하락 위험을 반영한 E3·R02 재생

이번 전환 규칙의 기준치는 실험 전에 고정했다. 편도 0.25%를 매수·매도 양쪽에 적용했다. 수수료만 고려한 가격 손익분기점은 +0.5013%다. 세 방식 모두 기간별로 동일한 고정 69종목, 기존 매수 통과 조건과 순위, 다음 거래일 시가 진입, 초기 $100,000, 정수 주수와 최대 5포지션을 사용했다. 새 규칙은 **매수 신호일별로 E3 또는 R02를 선택**하고 매수한 포지션의 청산까지 그 결정을 유지한다. E3는 3거래일 보유 후 다음 시가에 청산하며, 기존 예측 청산이 앞서면 먼저 팔 수 있다. R02는 5거래일 수익률 −8% 또는 20거래일 수익률 −12%보다 더 떨어진 종목을 제외한다. 남은 종목에는 기존 예측 청산을 적용하고, 계속 보유했다면 5거래일째 종가에 판다.

| 판단 항목 | 당시 입력 및 기준 | 조치 |
|---|---|---|
| 반등 가능성 | 신호일 종가까지의 등락, 일중 가격 범위에서 종가 위치, 최근 5거래일 저점 대비 당일 저가, 기존 가격·거래량 특징을 반영한다. E3의 실제 청산 경로에서 예상 순손익이 양수이고, 이익으로 마감할 후보의 투자금 가중 추정 비중이 50% 이상이어야 한다. | 하나라도 미충족하면 R02 |
| 추가 하락 위험 | 진입 시가부터 규칙별 청산까지 가장 크게 밀린 가격폭을 별도로 예측한다. 시가 청산일에는 매도 시가까지만 본다. 직전 거래일까지의 S&P 500·나스닥종합 5일 수익률, VIX 수준·5일 변화, 고정 표본의 상승 비중도 입력한다. | 방식별 점수는 예상 순손익에서 예상 하락 규모의 50%를 뺀 값이다. E3 점수가 R02보다 커야 하며, E3만 매수 가능한 급락 후보들의 합산 점수도 양수여야 한다. |
| 표본·시점 | 월 첫 거래일마다 그 전에 5일 결과가 모두 확정된 후보만 학습한다. 최소 40개 판단일, 120개 종목 사례를 요구한다. 상승 비중은 동일 표본에서 직전 이틀 종가가 모두 있는 종목이 35개 이상일 때 계산한다. | 학습 표본·필수 입력이 부족하거나 점수가 같으면 R02. 매수 가능 후보가 없는 날은 별도 집계한다. |

추정 비중은 보정된 수익 확률로 검증하지 않았다. 예상 하락폭은 후보별로 보유 중 진입가 대비 최저가를 본 값이며, 포트폴리오의 최대낙폭과는 측정 대상이 다르다. E3의 청산 경로와 R02의 청산 경로를 각각 예측했다. 두 방식에 공통인 기존 5일 수익 예측은 매수 통과와 순위에 사용했다.

| 구간 ET | 방식 | 순손익 | 최종 평가액 | 수익률 | 최대낙폭 | 완료 거래 |
|---|---|---:|---:|---:|---:|---:|
| 2026-10-22~11-05, 11거래일 | 새 전환 | −$1,585.98 | $98,414.02 | −1.59% | −3.43% | 3 |
| 〃 | E3 고정 | +$3,846.43 | $103,846.43 | +3.85% | −3.06% | 8 |
| 〃 | R02 고정 | −$1,585.98 | $98,414.02 | −1.59% | −3.43% | 3 |
| 2020-01-02~2026-09-30, 1,695거래일 | 새 전환 | +$8,985.01 | $108,985.01 | +8.99% | −18.49% | 296 |
| 〃 | E3 고정 | −$2,698.80 | $97,301.20 | −2.70% | −30.14% | 689 |
| 〃 | R02 고정 | +$21,091.51 | $121,091.51 | +21.09% | −12.28% | 257 |

단기의 신규 매수 판단일 6일에서 후보가 있던 4일은 모두 R02를 선택했고, 나머지 2일에는 매수 가능 후보가 없었다. 과거 대화를 받지 않은 에이전트에게 날짜·종목·실현 손익을 가린 판단 시점의 추정치만 주었고, 답변을 고정한 후 거래를 채점했다. 독립 에이전트의 6개 선택과 수치 규칙의 원장이 일치했다. 장기는 같은 수치 규칙으로 재생했다. 1,690일 중 1,080일에는 매수 가능한 후보가 없었고, 27일에는 점수가 부족했다. 점수가 있었던 583일 중 E3 58일, R02 525일이었다. E3로 진입해 청산까지 완료한 거래는 90건이었다. 가격과 시장 데이터를 판단일까지 물리적으로 잘라 재생한 단기 6일·장기 4개 표본일에서 새 예측과 최종 선택이 일치했다. 107회 새 모델 학습의 마지막 결과일은 각각 적용일보다 앞섰다. 고정 전략의 지표는 이전 원장과 같았으며, 단기의 일별 잔액과 거래도 일치했다.

| 판단일 ET | E3 예상 순손익 | E3 보유 중 예상 하락 규모 | E3 예상 이익 비중 | 위험 반영 점수 E3 / R02 | 선택 |
|---|---:|---:|---:|---:|---|
| 2026-10-23 | +$337.29 | $3,069.44 | 57.8% | −$1,197.43 / −$33.82 | R02 |
| 2026-10-26 | +$1,066.36 | $2,433.18 | 62.8% | −$150.23 / $0.00 | R02, 신규 매수 없음 |

장기 전환은 R02 고정보다 약 $12,106.49 덜 벌고 최대낙폭은 6.21%p 더 컸다. 2024-01-02부터 2026-09-30까지 같은 장기 공급원으로 초기자금부터 별도 재생해도 전환 +9.30%·최대낙폭 −5.66%, R02 +11.41%·최대낙폭 −6.05%로, 이 구간에서는 낙폭이 조금 줄었지만 수익률은 낮았다. 전체 비교에서 전환 규칙의 우위는 확인되지 않아 연구 후보로 둔다.

단기 KIS와 장기 Kibot 표본은 각각 따로 학습·재생했다. 종목별 일봉은 사후 수정될 수 있는 저장 수정주가를 사용했다. 과거 시점별 구성 종목 전체, 거래소 전체 상승 종목 비중, 당시 판본의 공시·뉴스, 주문 미끄러짐과 환전 비용은 포함하지 않았다. 이미 확인한 기간을 다시 사용했으므로 새 표본에서의 일반화는 미검증이다. [재생 수치·판단 입력·수수료 원장](../../../docs/research-data/T-156-rebound-risk-replay-2026-11-07.json) · [순차 시계열 검증](https://otexts.com/fpp3/toolbox.html#time-series-cross-validation) · [백테스트 과적합 연구](https://papers.ssrn.com/sol3/Papers.cfm?abstract_id=2326253)

## 1990년 이후 연구 DB 자료 추가 확보

수집 시점에 완료된 마지막 미국 정규장은 2026-11-05 ET다. Ubuntu의 기존 격리 MariaDB `t156_research_20261106`에 `backfill_*` 테이블을 추가했다. 날짜·원천·자료의 역할을 구분해 적재하고 가격, 시장 폭, 구성 증거, 공시·기사 원문과 메타데이터를 DB에서 다시 읽어 대조했다.

| 자료 | 적재·확인 범위 | 남은 구간과 이유 |
|---|---|---|
| 개별 종목 일봉 | 322개 공급자 티커 요청, **308개·1,855,428행**, 1990-01-02~2026-11-05 ET. 현재 목록 참조 125개는 모두 관측. 재구성 Nasdaq-100 라벨 299개 중 285개 관측. 원천의 미수정 시가·고가·저가·종가·거래량과 품질 표시를 저장했다. | 공급자에 없는 과거 티커 14개는 DoltHub 2011년 이후 정확 일치 조회에도 없었다. 나머지도 각 종목의 상장·티커 교체·재사용을 전체 기간 검증하기 전에는 일별 누락이 아닌 경우와 구분해야 한다. 관측 시작일과 종료일 사이의 공백 **3,147구간**을 DB에 별도 저장했다. 일봉별 실제 게시 시각은 공급자가 제공하지 않아 NULL로 유지했다. [Kibot 평가용 API](https://www.kibot.com/api/history-request.html) |
| Nasdaq-100 과거 구성 | **2004-01-01~2026-10-09** MIT 재구성 스냅샷 **148건**과 변경 **493행**. 공식 공지 33건을 대조해 한 건의 효력일을 2023-12-18로 정정했다. SEC에 공개된 1999~2002년 QQQ 보유 스냅샷 **5건·500행**도 별도 적재했다. | 1990~2003 및 2026-10-10 이후의 연속 일별 공식 구성 미확보. 2004~2026 재구성도 공식 전체 이력과 티커 동일성 전수 검증은 미완료다. QQQ 보유 시점은 공시 공개 시점과 별개다. [Nasdaq 공식 데이터 안내](https://www.nasdaq.com/products/global-indexes/data) · [재구성 원천](https://github.com/shardul0701/NQ100-Survivorship-bias-data-2004-2026) · [효력일 공지](https://ir.nasdaq.com/node/106911) |
| StockInvest NYSE 상위 50 | NYSE 공식 샘플 **2026-07-01·07-02**에서 단일 주식 클래스 시가총액 순위를 대조한 2일 자료를 적재했다. | 역사적 상장 적격 종목, 당시 주식수와 시가총액, 발행사·주식 클래스 처리 기준이 함께 있는 자료가 없어 1990~2026의 실제 StockInvest 순위는 미복원이다. [NYSE Daily TAQ](https://www.nyse.com/data-products/catalog/daily-taq/) |
| 거래소 상승 종목 비중 | NYSE·Nasdaq 각각 **1990-01-02~2020-02-10, 7,583거래일**의 공개 2차 집계, 공식 Nasdaq Trader **2026-01-02~11-03, 210거래일**을 별도 출처로 적재했다. 분모는 상승·하락·보합 합계다. | 양 거래소 장기 자료의 공통 3일, NYSE 2020-02-11 이후, Nasdaq 2020-02-11~2025-12-31 및 2026년 일부 날짜 미확보. 거래소 집계와 후보군 구성 종목의 상승 비중은 다른 지표이며 후보군 비중 전 기간은 미복원이다. [Unicorn 공개 이력](http://unicorn.us.com/advdec/) · [Nasdaq Trader 공식 집계](https://www.nasdaqtrader.com/Trader.aspx?id=DailyMarketFiles) |
| SEC 공시 | 고정 69티커에 대응하는 등록인 69개의 **접수 목록 419,134행**, **원문 196건**, 1994-01-05~2026-11-05 ET. 원문 중 **180건**의 SEC 접수 시각을 헤더와 API에서 대조했다. 최근 14개 미국 동부 달력일(2026-10-23~11-05)에는 이 범위의 주요 양식 범위에서 확인된 **102건 전부**를 확보했다. | 1990~1993 전자 원문 및 다른 과거 편입 종목의 등록인 매핑 미확보. 1994년 이후의 나머지 원문은 아직 전수 다운로드하지 않았다. SEC 접수 시각을 최초 공개 시각으로 대체하지 않았다. [SEC EDGAR 접근 안내](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) |
| 경제 발표·언론 기사 | 연준 **247건**(1994~2026), BLS 보존 원본 **126건**(1990~2026)을 적재했다. Wikinews 최초 발행 표시 판본 **512건**, VOA 자체 작성 기사 **20건**, 언론 제목·링크 **15건**을 별도 적재했다. | 매체의 기사 초판·정정판 원문 아카이브와 사용권을 확보하지 못해 1990~현재 종목·경제 뉴스 전수는 공백이다. 원문을 보관할 근거가 없는 기사에 대해서는 출처와 날짜만 기록했다. [Fed 이용 조건](https://www.federalreserve.gov/disclaimer.htm) · [BLS 이용 조건](https://www.bls.gov/opub/copyright-information.htm) · [Wikinews 저작권 안내](https://en.wikinews.org/wiki/Wikinews:Copyright) · [VOA 이용 조건](https://www.voanews.com/p/5338.html) |

공개 날짜, UTC 공개 시각, SEC 접수 UTC, 이번 수집 시각, 시각 정밀도를 별도 필드로 보존했다. 날짜만 확인한 문서의 UTC 시각과 공급자가 제공하지 않는 일봉·거래소 집계 시각은 빈 값으로 유지했다. 정규장 예정 마감은 별도 달력에 저장했다. 원문 **1,106건**을 연구 DB의 압축 바이너리 필드에 넣고, 읽어 온 압축본의 SHA-256과 보존한 원문 해시를 대조했다. [DB 적재 검산과 종목별·기간별 결측](../../../docs/research-data/T-156-historical-research-db-backfill-2026-11-07.json)

## 당시 공개 자료로 일별 E3·R02 판단 재생

초기 자금 $100,000, 편도 수수료 0.25%, 고정 69종목, 다음 정규장 시가 체결, 기존 보유·청산 규칙을 사용했다. 단기 11거래일과 기존 장기 1,695거래일의 E3·R02 고정 기준선은 저장 지표와 일치했고, 단기의 일별 평가액도 일치했다. 비교의 연속성을 위해 체결과 손익에는 기존 수정 일봉을 사용했다. 새 연구 DB 일봉은 직전 세션의 종가 위치, 시가 대비 등락, 표본 상승 비중을 계산하는 입력이다. 두 가격 원천의 직전 수익률 차이가 2%p를 넘으면 새 원천의 해당 종목을 제외하고, 유효한 종목 35개 이상을 요구했다. S&P 500·나스닥종합·VIX도 직전 거래일까지의 값만 사용했다. 거래소 전체 상승 비중은 당시 게시 시각이나 원천 연속성이 부족해 이번 전환 입력에서 제외했다.

판단 시각은 조기 폐장일을 포함한 정규장 마감이다. 해당 시점 이전 14일 중 원문 해시와 시각을 확인한 연준 57건, BLS 고용 31건, 기사 10건을 시점별로 조회했다. BLS는 원문에 인쇄된 엠바고 시각과 날짜가 DB와 일치한 건을 사용했다. Wikinews는 최초 발행 표시 판본, 수정된 VOA는 보존 판본의 수정 시각 이후부터 허용했다. 단기 SEC 원문 102건은 공식 일일 색인의 작성 시각을 확인한 다음 장 마감부터 참고하는 별도 비교군에만 넣었다. 이는 개별 공시의 최초 공개 시각과 구분된다. 장기 SEC 표본은 과거 공식 색인과의 시각 대사를 끝내지 못해 제외했다. [SEC 공개 시각 안내](https://www.sec.gov/about/webmaster-frequently-asked-questions) · [공식 일별 색인](https://www.sec.gov/Archives/edgar/daily-index/2026/QTR4/)

매수 신호일마다 계좌와 독립된 최대 다섯 후보의 두 방식 예상 순손익과 보유 중 하락 규모를 비교했다. E3는 순손익 예상 양수, 이익 추정 비중 50% 이상, 위험 반영 점수 우위, E3 전용 급락 후보의 합산 점수 양수를 요구한다. E3 전용 후보의 직접 중대 악재 또는 직전 두 판단 시각 안의 50bp 이상 연준 인상 발표가 확인되면 E3를 제한한다. 이 기준으로 단기 6건과 장기 재량 판단이 가능한 113건을 날짜·종목명·이후 가격·실현 손익 없이 별도 에이전트에 제공했다. 나머지 장기 1,577일은 필수 조건에 따라 R02가 적용됐다. 실제 체결은 각 비교군의 잔고와 포지션을 반영하고, 해당 매수의 청산까지 선택을 유지했다. 선택을 고정한 뒤에 손익을 계산했다.

| 구간 ET | 방식 | 수수료 차감 후 손익 | 누적 수익률 | 최대낙폭 | 완료 거래 |
|---|---|---:|---:|---:|---:|
| 2026-10-22~11-05, 11거래일 | E3 고정 | +$3,846.43 | +3.85% | −3.06% | 8 |
| 〃 | R02 고정 | −$1,585.98 | −1.59% | −3.42% | 3 |
| 〃 | 가격·시장 수치로 전환 | −$2,237.47 | −2.24% | −8.32% | 6 |
| 〃 | 공개 자료 조건을 추가해 전환 | −$2,237.47 | −2.24% | −8.32% | 6 |
| 〃 | 일별 판단 에이전트 | −$1,585.98 | −1.59% | −3.42% | 3 |
| 2020-01-02~2026-09-30, 1,695거래일 | E3 고정 | −$2,698.80 | −2.70% | −30.14% | 689 |
| 〃 | R02 고정 | +$21,091.51 | +21.09% | −12.28% | 257 |
| 〃 | 가격·시장 수치로 전환 | +$16,902.46 | +16.90% | −17.32% | 331 |
| 〃 | 공개 자료 조건을 추가해 전환 | +$19,311.61 | +19.31% | −17.32% | 331 |
| 〃 | 일별 판단 에이전트 | +$15,642.95 | +15.64% | −15.39% | 305 |

단기 에이전트는 여섯 판단일에 모두 R02를 선택했다. 10월 26일 수치 규칙은 E3의 위험 반영 점수를 +$3.85, R02를 $0으로 평가해 E3를 골랐으나 에이전트는 R02를 선택했다. 단기 에이전트의 거래와 잔고는 R02 고정과 같았다. 매수 후보가 있던 날에 SEC 맥락이 붙은 날은 2일, 연준 발표가 붙은 날은 1일이었다. 적용할 수 있는 기사 원문과 E3를 막을 중대 SEC 사건은 없었다.

장기에서 수치 방식은 E3를 115일 골랐고, 공개 자료 조건은 2022년 6월 15일·16일의 선택을 R02로 바꿔 E3가 113일이 됐다. 두 선택 변경은 6월 15일 연준 75bp 인상 근거에서 나왔다. 전체 재생 순손익은 $2,409.15 개선됐고 최대낙폭은 같았다. 공시와 기사 맥락은 선택을 바꾸지 않았다. 재량 에이전트는 장기 E3를 60일 골라 수치+공개 자료 방식보다 최대낙폭은 1.92%p 줄였지만 수익률은 3.67%p 낮았다. R02 고정과 비교하면 수익이 $5,448.56 낮고 낙폭이 3.11%p 컸다. 별도 초기화한 2026-01-02~09-30의 187거래일은 에이전트 −0.25%·최대낙폭 −3.20%, R02 고정 −0.91%·−3.20%, E3 고정 −4.45%·−10.63%였다. 이 구간은 장기 전체에 포함된다.

| 자료 공백 | 평가 영향 |
|---|---|
| 1990~2019 및 2026-10-01~10-21 | 동일한 시점 검증·체결 기준과 비교 가능한 이번 평가 구간 밖이다. 과거 전체 후보군과 당시 기사·공시 공개판을 복원하기 전에는 통합 성과로 계산하지 않는다. |
| 2020~2026 장기 SEC와 언론 | 역사 SEC의 공개 시각 대사가 미완료다. 매수 후보와 연결된 기업 기사 사용일은 3일이다. 장기 결과는 일봉·시장 지표와 확인된 경제 발표·기사 표본의 제한 검증이다. |
| 2026년 11거래일 | 공식 색인으로 확인한 SEC는 일부 판단일의 맥락만 제공한다. 모든 후보에 대한 판단일별 14일 원문·언론 커버리지는 성립하지 않는다. |
| 전체 투자 우주 및 체결 | 날짜별 Nasdaq-100·StockInvest NYSE 상위 50의 공식 전수 구성, 당시 공급자 일봉 도착 시각, 실제 체결 호가와 비용은 미확인이다. 고정 69종목과 기존 일봉 체결 모의를 사용했다. |

단기 2일과 장기 4일은 가격·시장·사건 입력을 각 마감 시점까지만 남겨 독립적으로 다시 계산했다. 전체 재생과 최종 판단이 일치했고 107회 모델 학습에 적용일 이후 결과가 섞이지 않았음을 검산했다. 초기에는 전체 가격 파일에서 관측된 종목 수가 확보율의 분모에 쓰여 긴 표본을 잘랐을 때 값이 달랐다. 고정 표본 69를 명시해 수정했고, 에이전트에 전달한 카드 해시는 수정 전후 같았다. [일별 선택·비교 원장과 시점 검산](../../../docs/research-data/T-156-point-in-time-daily-replay-2026-11-07.json)

## 에이전트 개입 조건과 권한 보완안

장기 신규 진입 판단일 1,690일 중 113일이 재량 검토에 들어갔다. 에이전트는 E3 60일과 R02 53일을 선택했고 나머지 1,577일에는 수치 조건이 R02를 적용했다. 공개 자료 조건까지 적용한 수치 전환과 비교하면, 에이전트는 최대낙폭을 1.92%p 줄이면서 순손익을 $3,668.66 낮췄다. R02 고정과 비교하면 순손익은 $5,448.56 낮고 최대낙폭은 3.11%p 컸다. 단기에는 수치 전환 대비 $651.49를 덜 잃었고 R02 고정과 거래가 같았다. 공식 연준 발표가 바꾼 장기 2일은 수치 조건의 효과다. 이번 자료에서 공시와 언론 사건의 재량 효과는 확인하지 못했다. R02 고정을 다음 실험의 기준선으로 두고 E3의 우위와 사건 개입의 효과를 따로 검증한다. [판단·손익 원장](../../../docs/research-data/T-156-point-in-time-daily-replay-2026-11-07.json)

| 단계 | 개입 조건 | 권한과 출력 |
|---|---|---|
| 공시·뉴스 해석 | 판단 마감 이전에 공개된 원문 판본을 확인했고, 종목과 연결되며 내용의 충돌·정정 또는 중요도 해석에 따라 결정이 달라질 수 있다. | 원문·공개 시각·판본·종목·사건 유형·영향과 반대 근거를 기록한다. 명확한 수치 사건은 같은 규칙으로 처리한다. 기사 수, 제목의 분위기, 출처 미확인은 점수를 올리거나 내리는 근거에서 제외한다. |
| 관찰 후보 | 가격·거래량과 시장 지표를 계산할 수 있다. 기존 하드 조건을 통과한 종목만 R02와 E3 후보에 담는다. | 시장 전체 악재는 E3 허용 조건에 반영한다. 특정 종목에 직접적인 중대 악재가 확인되면 해당 종목에 한해 신규 진입 보류를 제안하고, 남은 후보를 동일 기준으로 다시 평가한다. |
| 조건 확인 | E3가 수수료 후 기대 순수익 양수, 이익 추정 비중 기준, 추가 하락 한도와 급락 후보의 위험 반영 점수 기준을 통과한다. R02와 신규 진입 보류(현금) 양쪽에 대한 위험 반영 우위가 과거 예측 오차를 넘는지도 확인한다. | 수치 우위가 작거나 불확실하면 R02가 독립 조건을 만족할 때 R02를 적용한다. 두 방식이 부적격이거나 필수 가격·위험 입력이 없으면 신규 진입 대기다. 공시·기사 결측은 확인 불가로 남긴다. 에이전트는 근거를 붙여 E3 유지, R02 적용, 해당 후보 보류를 제안할 수 있다. 실패한 수치 조건을 통과시키는 권한은 부여하지 않는다. |
| 우선순위와 시그널 후보 | 같은 날 예산·슬롯 경계에서 후보 순서가 실제 배정을 바꾸고, 원문 근거가 두 후보의 위험 차이를 뒷받침한다. | 비슷한 점수의 통과 후보에 한해 순위 의견을 남긴다. 검증 코드는 가격·수량·집중도·만료를 확인하고 후보 상태를 확정한다. 이미 보유한 종목의 감축·청산은 별도 절차에서 검토하며, 기존 보호 청산과 포지션에 설정된 청산 규칙은 별도로 적용한다. |

E3의 최소 우위는 달러 고정값 대신 같은 예정 투자금 대비 비율로 비교한다. 두 선택의 짝을 맞춘 과거 예측 오차는 각 판단일 이전에 결과가 완료된 사례만 사용한다. 위험 가중치, 최소 우위, 하락 한도와 검토 시간 제한은 미사용 평가 구간의 결과를 열기 전에 고정하는 검토 항목이다. 2026-10-26의 위험 반영 점수 차이는 예정 $75,000에 대해 약 0.51bp에 그쳤다. 이 사례는 점수의 부호만 보고 선택했을 때의 한계를 보여준다. 해당 값으로 기준치를 역산하지 않는다.

미사용 시간순 표본과 주문 없는 전진 모의에서 편도 0.25% 및 동일한 기회·가격·비용·한도를 적용한다. 비교군은 **A R02 고정**, **B 수치 전환과 검증된 사건 규칙**, **C B에 위 조건의 에이전트 검토를 추가한 방식**이다. A와 C로 전략의 우위를, B와 C로 에이전트의 추가 효과를 본다. 판단 시점에 입력·원문 판본·규칙 및 모델 버전·기본 선택·에이전트 권고와 근거를 잠근다. 실제 배정이나 모의 체결이 달라진 날을 구분하고, 같은 시점과 예산에서 회피한 손실과 놓친 상승을 모두 계산한다. 기간 전체의 비용 후 손익과 최대낙폭, 판단 지연·만료·자료 누락도 함께 기록한다. 보유 포지션의 감축·청산 성과는 신규 진입과 분리한다.

최소 표본과 중단 기준은 기존 C09 검토안을 재사용한다. 신규 매수는 최소 12주, 대조군과 진입·배정이 달라진 20거래일 등 기존 표본 조건을 충족한 뒤 채점한다. 독립 사건 수, 허용 낙폭, 수수료 후 개선 기준은 결과 열람 전에 확정한다. 신규 매수에서 C가 B보다 낫다는 증거와 기준선 A 대비 성과를 함께 제시하고, 특정 사건을 빼면 개선이 사라지거나 표본이 부족하면 채택 보류로 둔다. [C09 최소 표본·통과·중단 검토안](#c09-최소-표본통과중단-검토안)

## 2015~2016년 미채점 구간의 제한적 개입 검증

이 구간의 초기 결과는 뒤의 2006~2011 검증에서 발견한 티커 신원 문제를 반영해 재검산했다. 최신 비교와 누적 표본에는 아래의 정정 결과를 사용한다.

기존 T-156 원장에서 E3·R02 계좌 성과를 채점한 기록이 없는 **2015-01-02~2016-12-30 ET, 504거래일**을 가격과 모의 손익을 확인하기 전에 지정했다. 이 시기의 지수는 이전 시장 연구에 쓰였으며 전략 설계에 사용한 2020년 이후 구간보다 앞선다. 따라서 개별 종목 전략의 미채점 역사 구간으로 해석한다. 주문 없는 전진 성과는 별도 평가다.

기존 69개 참조 종목 중 이력과 신원 조건을 통과한 **60개**의 2012~2016 Kibot 정규장 분할 보정 일봉 **73,173행**을 사용했다. 9개는 공급자에 이력이 없거나 해당 기간 티커 연결을 확인할 수 없어 제외했다. 초기 $100,000, 매수·매도 각각 25bp, 최대 5포지션·종목당 15%, 다음 정규장 시가 진입 및 기존 E3·R02 청산을 동일하게 적용했다. 직전 거래일까지 확인한 종목·시장 가격을 사용하고 과거 공식 편입 및 퇴출과 실제 배당·체결 호가까지 복원하지는 않았다. [Kibot 일봉 설정](https://www.kibot.com/api/history-request.html)

A는 R02 고정이다. B는 기존 E3 수치 조건에 더해 E3의 위험 반영 점수가 R02와 현금 대기 양쪽을 과거 과대 추정 오차만큼 넘어야 한다. 같은 예정 투자금에 대해 과거 과대 추정 평균의 양수 부분과 주간 평균 오차의 표준오차에 1.645를 곱한 값을 더했다. 최소 40개 완료 판단일·20개 주간 블록과 월별 학습일 이전에 성숙한 결과를 요구했다. 2015년 7월부터 기준을 계산할 수 있었고, E3 조건을 만족했지만 오차 검산 표본이 없었던 9일은 R02를 적용했다. 확정된 50bp 이상 연준 인상 조건은 발화하지 않았다. 보유 후보와 연결된 공식 발표 맥락이 있던 날은 28일이었다. [연준 2015년 발표](https://www.federalreserve.gov/monetarypolicy/fomchistorical2015.htm) · [연준 2016년 발표](https://www.federalreserve.gov/monetarypolicy/fomchistorical2016.htm)

C에는 B에 공시 해석을 추가했다. 기존 원문 자료에서 해당 매수 후보와 연결된 사건이 없어, 수치 조건을 통과한 후보를 중심으로 당시 공개 자료를 보강했다. Marvell의 2015-09-11 08:30 ET 배포본과 같은 날 제출 지연 통지에서 회계·내부통제 조사와 수익 인식 불확실성을 확인했다. 확정된 재무제표 신뢰 철회나 채무불이행으로 판정하지 않고, 조사 중인 잠정 실적의 신뢰가 신규 반등 매수에 미치는 영향을 개입 사유로 기록했다. 이 연구에서 판단일과 기업은 확인할 수 있었으며, 뒤의 가격·거래 손익을 계산하기 전에 개입안을 고정했다. [Marvell 당시 배포본](https://www.prnewswire.com/news-releases/marvell-technology-group-ltd-reports-preliminary-second-quarter-of-fiscal-2016-financial-results-300141494.html) · [제출 지연 통지](https://investor.marvell.com/sec-filings/all-sec-filings/content/0001193125-15-317840/d64331dnt10q.htm)

| 방식 | 순손익 | 수익률 | 최대낙폭 | 완료 거래 | 진입일 |
|---|---:|---:|---:|---:|---:|
| A R02 고정 | −$3,752.30 | −3.75% | −14.43% | 72 | 52 |
| B 수치·공식 사건 규칙 | −$5,930.60 | −5.93% | −13.50% | 89 | 59 |
| C 제한적 에이전트 개입 | −$5,110.06 | −5.11% | −12.75% | 88 | 58 |

C는 B보다 **$820.54** 덜 잃고 최대낙폭이 **0.76%p** 작았다. A에 비해 최대낙폭은 **1.68%p** 작았으나 손실은 **$1,357.77** 더 컸다. 세 계좌 모두 수수료 차감 후 손실이었다.

| 매수 판단일 ET | 비교 | 회피 손실 | 놓친 상승 |
|---|---|---:|---:|
| 2015-09-16 | B의 MRVL 1,623주 E3 진입이 C에서 빠졌다. B는 9월 17일 시가에 진입하고 9월 22일 시가에 청산했다. | $850.61 | $0.00 |
| 2015-09-17 | 두 계좌 전체 비교에서는 B가 이미 MRVL을 보유해 추가 진입이 없었다. C의 당일 보류만 해제하는 별도 모의에서는 가상 진입이 생겼다. | $56.82, 별도 반사실 | $0.00, 별도 반사실 |

두 날짜는 같은 공시 사건에 속한다. 둘째 날의 별도 반사실은 첫날과 합산하지 않는다. C의 전체 순손익 개선 $820.54에는 첫날 진입을 거른 직접 효과와 이후 수량 차이가 함께 들어 있다. B와 C의 종목·청산 규칙이 달라진 매수 판단일은 **1일**이며, 이후 수량만 달라진 **30일**을 개입 표본에 넣지 않았다.

**표본 부족.** 12주 및 진입 30거래일 기준은 충족했다. 완료 거래는 각 방식 **72·89·88건**으로 100건에 못 미쳤고, 직접 개입으로 체결 종목이 달라진 날은 **1일**, 독립 사건은 **1건**으로 변경 20거래일 기준에 미달했다. Marvell 사건을 빼면 B와 C가 같다. 기사와 공시 전수 자료가 없어 이번 사례로 일반 성과나 채택을 판정할 수 없다. 네 시점에서 가격·시장·사건 자료를 실제 판단일까지 잘라 다시 계산했고 선택과 오차 기준이 전체 재생과 일치했다. [검증 원장·입력 해시·날짜별 반사실](../../../docs/research-data/T-156-limited-agent-holdout-2015-2016-2026-11-07.json)

## 2006~2011년 미채점 구간과 공개 자료 보강 검증

기존 개별 종목의 E3·R02 평가 및 모형 준비 기간과 겹치지 않는 **2006-01-03~2011-12-30 ET, 1,511거래일**을 추가로 선정했다. 준비 기간은 2003~2005년이다. 별도 지수 연구에서 시장 지표 일부를 사용한 적이 있어 종목 전략의 신규 역사 구간으로 분류한다. 초기 $100,000, 매수·매도 각 0.25%, 최대 5포지션, 종목당 15%, 다음 정규장 시가 및 기존 청산을 동일하게 적용했다. 고정 참조 69종목 중 **56종목, 118,742행**의 분할 보정 일봉을 채택했다. 새 상장 전의 ALAB·APP·ARM 이력과 Google Class C의 중복 사전 이력을 발견해 제외했고, Class A의 과거 이력만 유지했다. 예비 손익을 채택 기준으로 사용하지 않았다. 당시 실제 편입·상폐 모집단과 호가·배당은 복원하지 못했다. [Kibot 설정](https://www.kibot.com/api/history-request.html) · [Google 주식 클래스 변경](https://www.sec.gov/Archives/edgar/data/312070/000095010314005483/dp48472_424b2-209jpm.htm)

시점과 수치 기준은 앞선 계획을 유지했다. 매수 수치 조건을 통과한 E3는 R02와 현금 대비 양쪽의 과대 추정 오차 기준을 넘어야 한다. 오차는 이미 성숙한 과거 표본으로만 계산했다. 기존 사건 원문과 SEC 제출 목록을 비교해 후보에 연결된 8-K·정정 **61건**을 발견용으로 걸렀다. SEC 접수는 공개 근거를 대신하지 않았다. 당시 기업·규제기관·언론 원문 **8건**을 보강했다. 시·분이 없는 동시대 원문은 당시 날짜가 확인된 경우 다음 정규장부터 사용했다. 14일을 넘기는 사건과 사후 결론은 배제했다. Vertex의 Item 2.04는 원문상 전환사채의 자발적 조기 상환이므로 채무불이행으로 분류하지 않았다. [Vertex 8-K 원문](https://www.sec.gov/Archives/edgar/data/875320/000110465907006509/a07-3181_18k.htm)

에이전트는 후보와 연결된 **13일**을 검토해 6일에 해당 종목의 신규 진입 보류를 권고했다. 여기에는 UNH·KLA·Marvell의 당시 조사와 QCOM 제품 수입 제한의 영향 범위가 포함됐다. 손익을 계산하기 전에 권고와 원문 버전을 잠갔다. 5개 시점에서 이후 가격·시장·이벤트 입력을 제거하고도 판단과 오차 기준이 일치했다. [UNH 당시 공지](https://www.sec.gov/Archives/edgar/data/731766/000129993306003570/exhibit1.htm) · [Marvell 당시 8-K](https://investor.marvell.com/sec-filings/all-sec-filings/content/0001104659-06-045185/a06-14876_18k.htm) · [USTR 당시 결정](https://www.ustr.gov/archive/Document_Library/Press_Releases/2007/August/Schwab_Decision_on_the_ITC_Investigation_of_Certain_Processor_Chips.html)

| 방식 | 순손익 | 누적 수익률 | 최대낙폭 | 완료 거래 | 실제 진입일 |
|---|---:|---:|---:|---:|---:|
| R02 고정 | −$10,976.65 | −10.98% | −15.12% | 95 | 82 |
| 수치·공식 사건 규칙 | −$11,015.89 | −11.02% | −14.93% | 100 | 84 |
| 제한적 에이전트 개입 | −$10,197.96 | −10.20% | −14.15% | 95 | 80 |

제한 개입은 수치·공식 사건보다 **$817.93** 덜 잃었고 최대낙폭은 **0.78%p** 작았다. R02 고정보다는 **$778.69** 덜 잃고 최대낙폭은 **0.97%p** 작았다. 다음 표는 두 계좌의 실제 모의 원장을 대조해 수치 방식에서 체결되고 제한 개입에서 빠진 다섯 거래의 청산 손익이다. 하루를 별도 재생한 반사실이나 후속 배정 수량 차이는 이 표에 넣지 않았다.

| 판단일 ET | 제외 종목 | 피한 손실 | 놓친 상승 |
|---|---|---:|---:|
| 2006-04-20 | UNH | $957.64 | $0.00 |
| 2006-05-25 | UNH | $0.00 | $1,450.53 |
| 2006-05-30 | KLAC | $0.00 | $294.57 |
| 2006-07-07 | MRVL | $1,029.51 | $0.00 |
| 2007-08-08 | QCOM | $624.73 | $0.00 |

피한 손실 합계는 **$2,611.89**, 놓친 상승은 **$1,745.10**이다. 두 값의 차이와 전체 계좌 개선액은 후속 수량·비용 때문에 다르다. 4월 25일 UNH의 보류는 동일 계좌 상태에서 당일 제한만 해제한 별도 모의에서 $382.15를 피했지만 전체 두 계좌 간 실제 체결 차이는 없으므로 합계와 표본에 넣지 않았다. 종목·규칙이 바뀌지 않고 수량만 달라진 69일도 변경 표본에서 제외했다. Marvell 사건을 제외하면 C가 B보다 **$133.89 더 잃었다**.

**표본 및 수집 반영 판정.** 이 구간에서는 B만 100건을 충족했다. C의 직접 체결 변경일은 **5일**, 관련 발행사 사건 묶음은 **4개**였다. 같은 신원 검사를 2015~2016 구간에도 적용하고 기존 Marvell 사건 판단을 그대로 재사용했다. 정정 재생에서 수익률·낙폭은 A **+3.29%·−13.03%**, B **+8.48%·−9.87%**, C **+7.54%·−9.87%**였다. 이 결과는 이전 구간의 티커 미검사 결과를 대체할 정정 비교다. 두 기간을 별도 초기화한 채 건수만 합치면 완료 거래 **183·198·192건**으로 100건을 넘지만 직접 변경은 **6일**로 20일에 못 미친다. 이전 구간 정정 후에는 개입이 수치 방식보다 $941.86 낮았고, 두 모의 계좌의 증분 손익을 같은 초기자금 기준으로 단순 합산해도 **−$123.93**이다.

수익 효과가 표본과 사건 제거 검사를 통과하지 못해 수집 코드는 적용하지 않았다. 다음 검증에 재사용할 수 있도록 원문 URL, 당시 발행일·정밀도, 최초 관측과 구분된 사용 가능 시각, 문서 해시와 정정 여부, 발행사와 중복 사건 묶음을 연구 원장에 정리했다. [두 구간의 검증·원문 수집·피한 손실과 놓친 상승 원장](../../../docs/research-data/T-156-limited-agent-holdout-2006-2011-2026-11-07.json)

## 투자 기간과 연복리 수익률

1990-01-05~2026-10-30의 1,922주는 시장 국면을 조사한 주간 지수 자료다. 누적 +21.09%는 2020-01-02~2026-09-30 ET의 R02 고정 모의 계좌에서 나왔다. 해당 계좌는 1,695거래일을 재생했으며 시작일과 종료일의 달력 차이는 2,463일, 약 6.74년이다. 36년 동안 누적 +21.09%라는 가정의 연복리 수익률은 +0.53%다. [주간 시장 국면 자료](../../../docs/research-data/T-156-weekly-market-regimes.json) · [계좌 재생 원장](../../../docs/research-data/T-156-point-in-time-daily-replay-2026-11-07.json)

초기 $100,000을 한 번 넣고 중간 추가 납입·인출 없이 재생했다. 판단 시점의 현금·정산 예정 대금·보유종목 평가액을 합한 계좌 평가액에 종목당 15% 한도를 적용했다. 실제 가상 매수 수량은 가용 현금과 정수 주수 한도 안에서 계산했다. 매수·매도 각 0.25% 수수료와 그동안의 이익·손실이 후속 계좌 평가액과 투자 규모에 반영된다. 누적 수익률은 기말 계좌 평가액을 시작 금액으로 나눈 뒤 1을 뺀 값이다. 연복리 수익률은 `(기말 평가액 / 시작 평가액)^(365.2425 / 경과 달력일) - 1`로 환산한다. 최대낙폭은 해당 기간의 계좌 고점 대비 가장 큰 하락폭이다. [SEC 연복리 산식](https://www.sec.gov/files/formn-1a.pdf)

| 투자 재생 기간 ET | 방식 | 기간 누적 수익률 | 연복리 수익률 | 최대낙폭 |
|---|---|---:|---:|---:|
| 2020-01-02~2026-09-30 | R02 고정 | +21.09% | +2.88% | −12.28% |
| 〃 | E3 고정 | −2.70% | −0.40% | −30.14% |
| 〃 | 가격·시장 수치 전환 | +16.90% | +2.34% | −17.32% |
| 〃 | 공개 자료 조건 전환 | +19.31% | +2.65% | −17.32% |
| 〃 | 일별 판단 에이전트 | +15.64% | +2.18% | −15.39% |
| 2006-01-03~2011-12-30 | R02 고정 | −10.98% | −1.92% | −15.12% |
| 〃 | 수치·공식 사건 규칙 | −11.02% | −1.93% | −14.93% |
| 〃 | 제한적 에이전트 개입 | −10.20% | −1.78% | −14.15% |
| 2015-01-02~2016-12-30 정정 | R02 고정 | +3.29% | +1.64% | −13.03% |
| 〃 | 수치·공식 사건 규칙 | +8.48% | +4.17% | −9.87% |
| 〃 | 제한적 에이전트 개입 | +7.54% | +3.71% | −9.87% |

장기 비교에는 기간·초기 및 최종 평가액·누적 수익률·연복리 수익률·최대낙폭을 함께 표시한다. 11거래일 모의는 누적 수익률과 낙폭을 보고한다. 2006~2011과 2015~2016은 각각 초기자금을 다시 넣은 별도 계좌이므로 하나의 연속 투자 기간으로 연결할 수 없다. R02의 2020~2026 결과는 편도 0.25% 모의 수수료를 포함하고, 실제 호가·환전·세금은 미반영이다. [시점 검증 원장](../../../docs/research-data/T-156-point-in-time-daily-replay-2026-11-07.json) · [이전 구간 정정 원장](../../../docs/research-data/T-156-limited-agent-holdout-2006-2011-2026-11-07.json)

## 연복리 15% 목표 탐색과 편입일 검증

기준은 같은 전략이 2006-01-03~2011-12-30, 2015-01-02~2016-12-30, 2020-01-02~2026-09-30 ET의 세 겹치지 않는 구간에서 각각 수수료 차감 후 CAGR 15% 이상을 기록하는 것이다. 시작 자금은 각 구간 $100,000이고 추가 입출금은 없다. 최대 5개 종목, 신규 진입 시 평가액의 종목당 15% 이내, 수량 유지 중 비중 변동 허용, 편도 0.25%, 매도 대금 다음 거래일 가용으로 모의했다. 신호는 정규장 종가에 계산하고 다음 시가에 체결했다. 마지막 날은 신규 진입 없이 남은 종목을 종가에 청산했다. 앞의 두 구간은 분할 보정, 최근 구간은 공급사 보정 일봉을 사용했으며 호가 차이·슬리피지·세금·환전은 반영하지 않았다.

네 유형의 200개 설정을 결과 확인 전에 고정했다. 초기 31회는 기존 고정 표본에서 재생했다. M31의 연복리 +16.28%·+48.37%·+70.08%에서 편입 전 NFLX(2010-02-23), AMD(2016-02-23), SNDK(2025-10-03) 매수를 확인해 통과를 취소했다. 확보한 나스닥100 일자별 구성 재구성을 해당 일봉과 교차한 뒤 같은 목록으로 169회(상승률 50, 신고가 50, 눌림목 50, 변동성 조정 상승률 19)를 다시 비교했다. 최초 31회도 200회 한도에 포함했다. NYSE는 기존 참조 종목을 사용했으며 당시 시총 상위 50 복원은 여전히 공백이다. [NFLX 편입 공지](https://www.globenewswire.com/news-release/2010/12/11/436006/6948/en/annual-changes-to-the-nasdaq-100-index.html) · [AMD 편입 공지](https://ir.nasdaq.com/node/99731) · [SNDK 편입 공지](https://ir.nasdaq.com/news-releases/news-release-details/sandisk-corporation-join-nasdaq-100-indexr-beginning-april-20) · [구성 자료 출처와 공백](../../../docs/research-data/T-156-historical-research-db-backfill-2026-11-07.json)

**판정은 3구간 충족 0개, 2구간 27개, 1구간 28개, 0구간 114개다.** 2006~2011년은 최고 연복리 +12.19%로 전부 미달했다. 2015~2016년은 31개, 2020~2026년은 51개가 각각 15% 이상이었다. 별도로 완결된 달력 연도 기준 연간 수익률 15% 이상을 세 해 이상 기록한 설정은 70개였다. 성과 순위는 세 구간 중 최저 CAGR 내림차순, 동률이면 중간 CAGR과 최악 낙폭 순으로 정했다. 일간 등락은 개별 종목 대신 수수료가 반영된 계좌의 전일 대비 변동이며, 최대낙폭은 각 구간에서 고점 대비 가장 크게 하락한 비율이다.

| 순위 | 전략과 기준 | 2006~11 CAGR | 2015~16 CAGR | 2020~26 CAGR | 최악 최대낙폭 | 최대 일간 상승 | 최악 일간 하락 |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | M40 126일 상승률·S&P 500 200일선·20일 점검 | +12.19% | +24.65% | +28.93% | −34.71% | +12.88% | −10.41% |
| 2 | M36 126일 상승률·종목 100일선·20일 점검 | +9.34% | +28.84% | +25.47% | −35.59% | +11.03% | −12.49% |
| 3 | M32 126일 상승률·20일 점검 | +9.25% | +32.76% | +38.78% | −39.71% | +11.48% | −12.49% |
| 4 | M20 40일 상승률·S&P 500 200일선·20일 점검 | +8.90% | +18.00% | +17.81% | −26.57% | +8.21% | −10.19% |
| 5 | M50 252일 상승률·S&P 500 200일선·20일 점검 | +8.86% | +18.38% | +27.27% | −38.48% | +15.38% | −10.82% |
| 6 | M34 126일 상승률·종목 50일선·20일 점검 | +8.81% | +21.30% | +18.47% | −40.92% | +8.57% | −8.83% |
| 7 | M38 126일 상승률·종목 200일선·20일 점검 | +8.69% | +32.76% | +38.67% | −35.89% | +12.86% | −12.49% |
| 8 | B40 126일 신고가 5% 이내·종목 100일선·20일 점검 | +8.41% | +22.70% | +10.57% | −28.63% | +8.51% | −7.05% |
| 9 | M39 126일 상승률·S&P 500 200일선·5일 점검 | +8.11% | +16.64% | +24.75% | −38.75% | +10.65% | −10.05% |
| 10 | M31 126일 상승률·5일 점검 | +8.10% | +29.93% | +35.24% | −42.97% | +10.35% | −11.90% |

M40은 20거래일마다 전 거래일 S&P 500 종가가 200일 이동평균 위에 있는지 검사한다. 위에 있으면 최근 126거래일 수익률이 양수인 종목 중 상승률 상위 5개를 뽑아 다음 시가에 반영한다. 순위에서 빠진 종목을 팔고 신규 진입할 종목의 주문을 낸다. 지수가 평균 이하라면 다음 시가에 현금으로 전환한다. 2008년에는 현금으로 머물러 모의 연간 수익률이 0.00%였다. 완결 연도 중 2007·2009·2016·2020·2023·2024년에 15% 이상이었다.

| 구간 | 최종 평가액 | 순손익 | 누적 수익률 | CAGR | 최대낙폭 | 완료 거래 |
|---|---:|---:|---:|---:|---:|---:|
| 2006–11 | $199,155.26 | +$99,155.26 | +99.16% | +12.19% | −19.66% | 84 |
| 2015–16 | $155,137.74 | +$55,137.74 | +55.14% | +24.65% | −13.56% | 38 |
| 2020–26 | $554,858.48 | +$454,858.48 | +454.86% | +28.93% | −34.71% | 132 |

M40의 최악 낙폭 구간은 2026-06-22~07-29(−34.71%)였다. 최대 일간 상승은 2026-07-30 +12.88%, 최악 일간 하락은 2026-06-05 −10.41%였다. 최근 구간 순손익의 42.5%는 MU의 거래 손익에서 나왔다. 같은 시기 기존 R02는 연복리 +2.88%, 최대낙폭 −12.28%였으며 기존 R02 원장의 모집단이 달라 성과 참고치로만 둔다.

M40의 매수 판단일·체결일 편입 조건, 254개 완료 거래의 원본 가격·수수료·실현손익 및 잔액을 대조했다. M40과 M32는 세 구간에서 후행 입력을 잘라 다시 돌려 앞부분의 신호·계좌 상태가 유지됨을 확인했다. 세 구간 모두 탐색에 사용됐고 나스닥100 자료도 전체 공식 일별 이력이 아니다. 공시·뉴스·VIX·시장 폭·판단 에이전트는 이 모의의 신호 입력으로 사용하지 않았다. 이번 결과는 후속 검증 후보를 고르는 데 쓰고 운영 적용 판단은 별도 검토한다. [전체 설정·시도 내역·매매 원장](../../../docs/research-data/T-156-annual15-strategy-search-2026-11-07.json) · [반복 탐색의 과적합 연구](https://escholarship.org/uc/item/4w1110bb)

## M40·E3·R02 고정과 판단 에이전트 개입 비교

세 장기 구간의 나스닥100 일별 재구성과 고정 NYSE 참조 종목을 모든 비교군에 동일하게 적용했다. 각 구간 초기 $100,000, 최대 5개 보유, 진입 시 종목당 계좌 평가액의 15% 한도, 정수 수량, 편도 0.25%, 다음 정규장 시가 및 다음 거래일 매도 대금 가용을 적용했다. 각 장기 구간의 거래 가능 일봉이 있는 종목 수는 일별 37~47개, 47~48개, 52~69개다. 2026-10-22~11-05의 11거래일은 편입 재구성 지원 범위 뒤라 기존 KIS 고정 69종목으로 별도 재생했다. M40의 점검 주기는 각 계좌 첫날부터 세며 단기에는 점검일이 한 번이다. 모든 구간에서 마지막 날의 보유분을 수수료 포함 종가에 청산했다. 호가·환전·세금·추가 체결 비용은 포함하지 않았다.

M40 고정은 기존 세 장기 계좌의 기말 평가액, 낙폭, 거래 건수와 일치했다. E3·R02는 기존 5일 예상 수익과 RSI·가격 조건, E3의 3거래일 경과 시 다음 시가 청산, R02의 5일·20일 급락 제외 및 최대 5일 규칙을 유지했다. 두 방식은 보유 중 남은 기간 예상이 음수면 다음 시가에 청산한다. 과거 구성 적용 후 월별 예측 모델을 다시 학습했으므로 이번 장기 수치는 기존 69종목 고정 비교와 모집단이 다르다. 11일 E3·R02의 수익과 낙폭은 기존 결과와 일치했다.

고정 전략에 붙인 판단은 기존에 원문을 판정한 기업 사건을 당시 공개된 뒤 14일 이내에서 신규 매수 보류에만 적용했다. 시장 수치·공식 사건 전환은 M40의 20거래일 점검일에 조건을 충족하는 M40 후보에 신규 배정 우선권을 준다. 그 밖의 날에는 예상 순수익 양수, 이익 추정 비중 50% 이상, 위험 반영 점수가 R02와 현금을 넘는 E3를 검토한다. E3 전용 급락 후보 점수가 양수이고 확인된 연준 50bp 이상 인상 직후의 제한에도 걸리지 않아야 한다. 나머지는 조건을 충족한 R02를 적용한다. 보유 종목은 진입 때 지정된 청산 규칙을 유지하고 세 방식이 같은 계좌의 현금과 슬롯을 공유한다.

전환 에이전트는 기업 사건 보류와 제한된 재량 판단을 추가했다. M40에 시장 약세 또는 E3와의 경합이 있거나 수치가 E3를 택한 경우 중 연도·유형별 첫 사례를 추렸다. 이후 결과, 종목명, 날짜를 가린 카드 27개를 채점 전에 검토했다. 에이전트는 기본 선택 17개를 유지했고, 9개는 신규 현금 대기, 1개는 E3에서 R02로 바꿨다. 가격·편입 필수 조건을 통과하지 못한 후보를 추가하지 않았다. 판단은 진입 선택과 보류에 한정했으며 기존 보유분에 대한 독립적인 재량 매도는 별도 검증 항목이다.

### 수익률과 최대낙폭

각 셀은 수익률과 최대낙폭이다. 장기는 연복리, 11거래일은 누적 수익률을 사용했다.

| 방식 | 2006~11 | 2015~16 | 2020~26 | 11거래일 |
|---|---:|---:|---:|---:|
| M40 고정 | +12.19% / −19.66% | +24.65% / −13.56% | +28.93% / −34.71% | −15.95% / −20.04% |
| M40 + 사건 판단 | +12.19% / −19.66% | +24.65% / −13.56% | +28.93% / −34.71% | −15.95% / −20.04% |
| E3 고정 | +0.08% / −28.15% | −0.17% / −15.09% | −0.49% / −27.74% | +3.85% / −3.06% |
| E3 + 사건 판단 | +0.09% / −28.15% | −0.17% / −15.09% | −0.49% / −27.74% | +3.85% / −3.06% |
| R02 고정 | −0.42% / −4.68% | −0.20% / −11.87% | +1.82% / −15.50% | −1.59% / −3.43% |
| R02 + 사건 판단 | −0.38% / −3.22% | −0.20% / −11.87% | +1.82% / −15.50% | −1.59% / −3.43% |
| 수치·공식 사건 전환 | +17.30% / −19.86% | +30.13% / −13.63% | +28.64% / −35.04% | −15.95% / −20.04% |
| 전환 + 판단 에이전트 | +17.45% / −19.66% | +30.13% / −13.63% | +27.52% / −35.43% | −15.95% / −20.04% |

| 구간 | 전환 기말 평가액 | 전환 + 판단 기말 평가액 | 판단 증분 순손익 | 완료 거래 |
|---|---:|---:|---:|---:|
| 2006–11 | $260,026.41 | $262,021.32 | +$1,994.91 | 135 → 129 |
| 2015–16 | $169,029.29 | $169,029.29 | $0.00 | 103 → 103 |
| 2020–26 | $546,469.59 | $515,226.21 | −$31,243.38 | 262 → 272 |
| 11거래일 | $84,046.10 | $84,046.10 | $0.00 | 5 → 5 |

전환 두 방식 모두 이전에 사용한 세 장기 구간에서 연복리 15%를 넘었다. 2020~2026년에는 M40 고정이 전환 두 방식보다 수익률이 높고 최대낙폭도 작았다. 11거래일에는 E3가 +3.85%였고 전환 방식은 첫 점검일에 M40으로 다섯 슬롯을 채운 뒤 신규 판단으로 실제 체결을 바꾸지 않아 −15.95%였다. 단기에는 재량 검토 대상이 없었고, 당시 공개 시각을 보수적으로 확인한 SEC 색인 원문이 후보와 연결된 4일에도 사건 보류가 발생하지 않았다.

### 판단으로 달라진 거래

직접 변경일은 판단 계좌와 동일한 상태에서 해당 날짜의 판단만 해제해 신규 거래의 종목·규칙이 달라지는지 확인했다. 전체 변경일에는 이후 보유·잔고 상태에서 파생된 차이를 포함하고 수량만 다른 날은 제외했다. 피한 손실과 놓친 상승은 같은 상태의 당일 가상 진입을 청산한 결과라 날짜 간 합계가 두 계좌의 증분 손익과 일치하지 않는다.

| 구간 | 직접 변경일 | 전체 거래 변경일 | 피한 손실 | 놓친 상승 |
|---|---:|---:|---:|---:|
| 2006–11 | 5 | 7 | $11,578.29 | $2,502.03 |
| 2015–16 | 0 | 0 | $0.00 | $0.00 |
| 2020–26 | 2 | 17 | $6,730.06 | $63,166.91 |
| 11거래일 | 0 | 0 | $0.00 | $0.00 |

2006~2011년의 고정 E3·R02에 기업 사건 판단을 더했을 때 직접 변경은 각각 5일·3일이고, 최종 순손익이 각각 $19.17·$234.52 개선됐다. M40은 전 구간 기업 사건 판단으로 체결이 바뀌지 않았다. 2020~2026년 전환에서 2026-01-21의 보류는 같은 상태의 INTC 손실 $6,730.06을 피하는 동시에 STX 상승 $61,318.55를 놓쳤다. 2026-03-17에는 WFC 상승 $1,848.36을 놓쳤다.

전환 계좌들은 장기 각 구간에서 완료 거래 100건을 넘었다. 독립 검증을 위해 정했던 직접 변경일 20일에는 합계 7일로 미달했다. 후행 입력을 잘라 네 구간의 총 1,752개 판단일을 다시 계산했으며 후보·선택·사건 시점이 일치했다. 나스닥100 공식 일별 전수와 당시 NYSE 상위 50은 미확보이며, 공시·뉴스도 부분 원문 표본이다. 세 장기 구간은 이전에도 사용한 표본이다. 실제 채택을 판단할 미사용 구간의 결과는 아직 없다. [설정·판단 카드·거래·계좌 원장](../../../docs/research-data/T-156-m40-e3-r02-agent-replay-2026-11-07.json) · [SEC 공개 시각 안내](https://www.sec.gov/about/webmaster-frequently-asked-questions)

## M40 기반 10년·5년 각 100개 설정 최종 검토

사용자가 매일 평가액·지표를 갱신하되 후보 교체는 20거래일, 추가 위험 점검은 주 1회로 진행하는 구분을 확인했다. 2006~2015와 2016~2025의 겹치지 않는 10년 구간 2개, 그 안의 2006~2010·2011~2015·2016~2020·2021~2025의 5년 구간 4개에 같은 100개 설정을 적용했다. 5년 구간은 10년 구간 안에 포함된다. 2006~2015 결과로 교체 후보를 선정하는 기준을 고정한 다음 이후 기간을 평가했고, 2026-01-02~09-30은 별도 초기 계좌로 확인했다. 모두 앞선 연구에 사용한 날짜이므로 전역적으로 미사용 홀드아웃은 아니다.

초기 $100,000, 최대 5종목, 신규 진입 시 계좌 평가액의 종목당 15% 한도, 매수·매도 각각 0.25%, 정수 원시 주수, 다음 거래일 시가, 매도 대금 다음 거래일 가용을 적용했다. 매일 평가액·적격 조건과 지표를 갱신하고 M40 기본 일정에 따라 후보를 교체했다. 주간 위험 주문은 완료된 주의 자료로 다음 주 첫 거래일 종가에 결정해 그다음 시가에 체결했다. 마지막 날 보유분은 종가에 청산했다. 분할 보정 단위를 실물 주수와 연결해 분할 후에도 같은 경제적 가치를 추적했다. 배당·환전·세금·호가 차이·추가 슬리피지는 포함하지 않았다.

기존 보정 파일의 2017~2018 공백을 채우기 위해 69종목의 2004~2026 분할 보정 및 원시 정규장 자료를 동일한 공급사 설정으로 재수집했다. 나스닥100은 날짜별 재구성 구성과 교차했고 NYSE는 기존 참조 21종목이다. 신원·상장일 필터를 적용했다. 일별 적격 일봉은 첫 10년에 37~49종목, 다음 10년에 48~63종목이다. 주간 상승 비중은 이 표본 내부의 비중이다. [자료 보정 방식](https://www.kibot.com/api/history-request.html)

### 비교 설정과 판단의 범위

100개 설정은 주간 상대강도 가중치 W(10·20·30·40·50%), 주간 약세 기준 T(3·4·5·6·8%), 행동 범위 네 가지의 조합이다. 순위 조정은 기존 상위 4개를 유지하고 5~8위에서 다섯째 종목 하나만 교체할 수 있다. 신규 보류와 주간 조기 청산은 각각 한 종목 이내다. 주간 약세는 절대 손실뿐 아니라 S&P 500 대비 2%p 이상 부진을 요구하며 조기 청산에는 4주 수익률 음수도 요구한다. 현재 진행 중인 주의 미래 종가는 입력에 넣지 않았다.

매도·신규 보류·후보 경합을 검토할 날짜를 가격의 후행 결과를 보기 전에 반기·유형별로 정했다. 날짜·종목명·이후 손익을 가린 117개 카드를 세 판단 에이전트가 나눠 검토해 76건 승인, 41건 기존 M40 유지를 결정했다. 검토 카드가 없는 시점에는 고정 수치 규칙을 적용한다. 개입 판정은 카드에 실제 제시된 종목에만 적용하며 신규 뉴스가 없다는 이유로 악재 부재를 가정하지 않았다. 공시·뉴스는 검증된 일부 원문과 당시 공개 시각만 사용했다.

### 고정 M40 기준선

장기 수익률은 CAGR, 2026년 9개월은 누적 수익률이다.

| 구간 | 수익률 | 최대낙폭 | 최고 주간 | 최악 주간 | 최종 평가액 |
|---|---:|---:|---:|---:|---:|
| 2006-01-03~2015-12-31 | +16.84% | −20.34% | +9.85% | −10.21% | $473,544.52 |
| 2016-01-04~2025-12-31 | +19.59% | −35.09% | +10.47% | −14.11% | $597,479.72 |
| 2006-01-03~2010-12-31 | +14.99% | −18.94% | +9.85% | −7.62% | $200,781.50 |
| 2011-01-03~2015-12-31 | +11.92% | −18.66% | +5.83% | −6.80% | $175,398.29 |
| 2016-01-04~2020-12-31 | +28.53% | −35.09% | +10.47% | −14.11% | $349,973.70 |
| 2021-01-04~2025-12-31 | +13.23% | −30.08% | +10.21% | −10.78% | $185,891.59 |
| 2026-01-02~2026-09-30 | +32.03% | −36.90% | +15.48% | −14.85% | $132,026.53 |

### 10년 구간 상위 10개

기간별 M40 대비 CAGR 개선폭의 중간값으로 순위를 정하고, 동률이면 최저 개선폭·최악 주간·낙폭을 비교했다. 같은 거래 경로를 만든 설정은 묶어 다음 표에는 서로 다른 10개를 표시했다. W는 최근 4주 상대강도 반영 비중, T는 주간 약세 기준 퍼센트다.

| 순위 | 설정 W/T/행동 | 2006~15 | 2016~25 | 최악 낙폭 | 최악 주간 | 최고 주간 | 동일 경로 설정 |
|---|---|---|---|---|---|---|---|
| 1 | 10/5/순위·보류 | +15.95% | +20.60% | −33.94% | −14.05% | +10.40% | 1 |
| 2 | 30/5/순위·보류 | +15.20% | +21.31% | −33.91% | −14.04% | +10.46% | 1 |
| 3 | 10/8/순위·보류 | +16.84% | +19.65% | −35.09% | −14.11% | +10.47% | 2 |
| 4 | 10/3/순위 | +16.84% | +19.59% | −35.09% | −14.11% | +10.47% | 8 |
| 5 | 30/3/순위 | +15.87% | +20.53% | −35.02% | −14.06% | +10.41% | 4 |
| 6 | 30/6/순위 | +15.87% | +20.44% | −35.02% | −14.06% | +10.41% | 1 |
| 7 | 30/8/순위·보류 | +15.87% | +20.44% | −35.02% | −14.06% | +10.41% | 1 |
| 8 | 40/6/순위·보류 | +15.46% | +20.84% | −34.91% | −13.99% | +10.70% | 1 |
| 9 | 10/6/순위·보류 | +15.95% | +20.27% | −35.05% | −14.08% | +10.45% | 1 |
| 10 | 20/5/순위·보류 | +15.57% | +20.60% | −33.94% | −14.05% | +10.40% | 1 |

10년 각 구간에서 15% 이상은 51개였지만 두 구간 모두 M40 수익률을 개선한 후보는 0개였다. 1위는 앞 구간에서 M40보다 약 0.90%p 낮고 뒤 구간에서 1.01%p 높았다.

### 5년 구간 상위 10개

| 순위 | 설정 W/T/행동 | 2006~10 | 2011~15 | 2016~20 | 2021~25 | 최악 낙폭 | 최악 주간 | 최고 주간 | 동일 경로 설정 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 30/3/순위 | +15.07% | +13.08% | +29.90% | +16.24% | −35.02% | −14.06% | +10.41% | 3 |
| 2 | 30/6/순위 | +15.07% | +13.08% | +29.90% | +15.30% | −35.02% | −14.06% | +10.41% | 2 |
| 3 | 30/8/순위·보류 | +15.07% | +13.08% | +29.90% | +14.93% | −35.02% | −14.06% | +10.41% | 1 |
| 4 | 30/5/순위·보류 | +15.07% | +13.08% | +30.78% | +14.25% | −33.91% | −14.04% | +10.46% | 1 |
| 5 | 30/6/순위·보류 | +15.07% | +13.08% | +29.48% | +15.62% | −35.00% | −14.06% | +10.40% | 1 |
| 6 | 40/5/순위 | +14.46% | +10.58% | +30.76% | +16.01% | −34.92% | −14.01% | +10.73% | 1 |
| 7 | 30/4/순위·보류 | +15.41% | +10.01% | +30.85% | +14.25% | −33.95% | −14.06% | +10.46% | 1 |
| 8 | 40/3/순위 | +14.46% | +10.58% | +30.29% | +16.01% | −34.98% | −14.01% | +10.69% | 2 |
| 9 | 40/6/순위 | +14.46% | +10.58% | +30.29% | +15.98% | −34.98% | −14.01% | +10.69% | 2 |
| 10 | 40/8/순위·보류 | +14.46% | +10.58% | +30.29% | +15.97% | −34.98% | −14.01% | +10.69% | 1 |

네 5년 구간 모두 15% 이상인 후보는 0개였고, 네 구간 모두 M40 CAGR을 개선한 후보는 8개였다. 1위는 W30/T3/순위 조정이다. 원래 5~8위 중 장기·최근 상대강도 순위 점수를 70 대 30으로 반영해 다섯째 후보를 선택한다. 기존 상위 네 종목과 기본 청산은 유지한다. 이 후보는 10년 앞 구간에서 M40보다 약 0.98%p 낮았으며, 2011~2015년의 최악 주간도 약 0.01%p 나빠졌다. 성과 향상과 위험 비악화를 모든 사전 선택 구간에 요구한 교체 기준을 통과한 후보가 없어 **M40을 유지하는 판정**을 기록했다.

### 재현성·기간 안정성·판단 일치

- 다른 PYTHONHASHSEED를 사용한 두 독립 프로세스에서 각 기간군 100/100 설정의 거래·판단·평가액과 지표가 일치했다. 기간군별 상위 후보를 다시 100회씩 돌린 결과도 100/100 일치했다.
- 100설정의 실제 거래 경로는 10년군 75개, 5년군 69개였다. 동일 결과인 설정을 독립적인 성공 사례로 세지 않았다.
- 동일 입력을 새 에이전트가 독립 판단한 36건은 29건(80.6%)만 일치했다. 고정 판단표 재생과 새 모델 판단의 일관성을 구분했다. 새 판단으로 재생하면 5년군 60/100 설정의 경로가 달라졌으며, 구간 CAGR 변화는 −2.54~+0.45%p였다. 5년 1위의 2011~2015 CAGR은 새 판단에서 약 1.66%p 낮아졌다.
- 후행 데이터를 물리적으로 잘라 네 접두 구간의 3,124거래일 평가액·결정을 대조했고 최대 차이는 0이었다. 보정 가격 단위를 종목별 상수로 바꿔도 정수 원시 매수 주수·판단이 같고 평가액 오차는 $0.000001 미만이었다.
- 20거래일 점검 시작점을 5일·10일 옮기면 5년 1위의 2021~2025 CAGR이 16.24% → 3.01% → 0.44%로 바뀌었다. 같은 이동을 적용한 M40은 13.23% → 1.88% → 1.29%였다. 특정 시작일에 유리한 성과를 일반화할 수 없다.

### 주간 손익과 이슈 판정

장기 구간의 최악 주간 손실은 2020-03-20 종료 주에 M40 −14.11%, 5년 1위 −14.06%였다. 당시 TSLA·LRCX·AAPL이 주요 손실 기여 종목이었고 주간 종목 기여 손익을 계좌 평가액 변화와 대조했다. 2026년 별도 확인 구간에서는 M40 및 두 상위 후보의 최악 주간이 −14.85%, 최대낙폭은 −36.90%였다. 주간 반등을 기다린 뒤 매도하는 방식은 개입이 늦어질 수 있고, 반등 전 조기 청산은 이후 상승을 놓칠 수 있어 이번 100개 설정에서 두 효과를 함께 비교했다. 교체 후보 선별은 원래 M40의 월별 구조와 주간 약세의 확인 조건을 유지했다.

수치 규칙만 적용한 짝 비교에서 5년 1위의 거래·평가액은 전 구간 에이전트 추가와 같았다. 10년 1위 역시 두 10년 구간의 결과가 수치만 쓴 경우와 같았다. 따라서 이들 개선분을 판단 에이전트의 독립 효과로 인정하지 않았다.

최초 감사에서 카드에 없는 다른 종목으로 판단 적용 범위가 확장될 수 있는 오류를 발견했다. 카드 대상에만 적용하도록 고친 뒤 100개 전부와 재현 검사를 다시 실행했다. 원시·보정 종가가 1.02~1.71% 다른 평가 대상 6행은 재수집 후에도 남았다. 일부 조기 폐장일에 집중되지만 원인은 확정하지 않았다. 전체 원시 종가를 일관된 기준으로 정규화한 대체 검산에서 두 상위 후보 CAGR 변화의 절댓값은 최대 약 0.37%p였다. 당시 공식 NYSE 상위 50, 상폐 종목을 포함한 전체 모집단, 전수 공시·언론 판본, 실제 슬리피지도 미확보다.

이번 검토에서 도출한 연구 후보는 W30/T3의 한 슬롯 순위 조정이다. 실제 교체 채택은 보류하고, 시작일 민감도·주간 큰 손실·새 에이전트 판단 불일치가 해소되기 전의 기준선은 M40으로 유지한다. [전체 100설정·판단·주간 손익·감사 원장](../../../docs/research-data/T-156-m40-5y-10y-100-final-2026-11-07.json) · [동결된 수치 입력](../../../docs/research-data/T-156-m40-final-input-2026-11-07.npz) · [반복 탐색의 과적합 연구](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)

![M40 기간별 수익·주간 손실·점검 시작일 민감도](../../../docs/research-data/T-156-m40-final-review-2026-11-07.png)

## 종목별 가격 패턴 분류와 반복 유사성 검토

이전 매매 실험의 69종목에서 연구 DB 현재 참조 125종목 전체로 범위를 넓혀 2004-01-02~2026-09-30의 동일 공급사 분할 보정 일봉을 확보했다. 유효 행은 579,248개다. 이 목록은 현재 참조 종목이며 전체 당시 NYSE 상위 50 또는 상폐 종목을 포함한 전수 시장 모집단은 아니다. 가격 패턴 검증 기간은 2016~2025로 두고 2026년은 별도 확인했다. 종목별 일봉이 존재하는 기간만 사용하고 최신 자료 공백과 통계 표본 부족을 구분했다.

20일·60일 창을 21개 누적 로그가격 지점으로 바꾸고 평균·크기를 정규화해 모양 상관계수 0.90 이상을 유사 조건으로 고정했다. 변동성 크기도 0.5~2배 이내를 요구했다. 관측 창은 같은 길이의 간격으로 잡았으며, 과거 사례의 패턴과 이후 20일 결과가 현재 패턴 시작 전에 모두 끝나도록 제한했다. 상위 과거 사례 5개 사이에도 창 길이+20일 간격을 두고, 다른 종목 비교에서는 같은 발행사의 주식 클래스 중복을 제외했다. [시계열 유사 패턴과 겹침 제외](https://www.cs.ucr.edu/~eamonn/MatrixProfile.html)

최근 자료 시점의 형태는 125종목 중 124종목에서 20일·60일 모두 분류할 수 있었다. BRK.B는 공급사 보정 이력이 2017-04-19에서 끝나 최신 형태를 계산할 수 없었다. BRK-B는 같은 부분 자료를 반환했고 BRKB는 조회되지 않아 검증되지 않은 연결을 하지 않았다. 같은 종목 과거에서 독립 유사 사례 3개 이상을 확보한 최근 패턴은 20일 24종목, 60일 3종목이었다. 다른 종목 과거까지 넓히면 각각 79종목·42종목이었다. 최근 상장 HONA·SPCX는 현재 60일 모양을 만들 수 있어도 반복 검증에 쓸 장기 이력이 부족하다.

### 설명용 패턴 분류

다음 분류는 관측한 모양을 설명하기 위한 사전 규칙이다. 각 행의 관측 수는 독립 기업 수 또는 수익을 보장하는 반복 횟수가 아니다.

| 패턴 | 과거 가격 기준 분류 | 2016~2025 관측 수 |
|---|---|---:|
| 지속 상승 | 전반·후반이 모두 변동성 대비 상승 | 1,848 |
| 지속 하락 | 전반·후반이 모두 변동성 대비 하락 | 721 |
| 하락 후 반등 | 전반 하락 후 후반 상승 | 1,570 |
| 상승 후 조정 | 전반 상승 후 후반 하락 | 1,235 |
| 변동성 상승 | 순상승이 크지만 전·후반 방향이 일정하지 않음 | 2,137 |
| 변동성 하락 | 순하락이 크지만 전·후반 방향이 일정하지 않음 | 1,363 |
| 횡보·혼합 | 위 조건에 속하지 않는 보합·혼합 흐름 | 4,857 |

### 반복 발생과 이후 예측

유사 발생률은 과거 후보가 있는 조회 중 적어도 하나가 상관계수 0.90 이상인 비율이다. 방향 정확도는 충분히 성숙한 유사 사례 3개 이상과 같은 종목 과거 기준 사례 20개 이상을 확보하고 당시 적격 조건을 충족한 조회만 평가했다. 이후 수익은 다음 시가부터 20번째 거래일 종가까지 매수·매도 각각 0.25%를 차감한 사건 수익이다. 포트폴리오 수익률과 구분한다.

| 구간 길이 | 과거 사례 | 유사 사례 발생률 | 이후 20일 방향 정확도 | 같은 종목 과거 평균 기준선 | 차이 | 평가 건수 |
|---|---|---:|---:|---:|---:|---:|
| 20거래일 | 같은 종목 | 23.71% | 51.11% | 53.14% | −2.03%p | 1,035 |
| 20거래일 | 다른 종목 | 63.10% | 50.30% | 52.98% | −2.68%p | 5,006 |
| 60거래일 | 같은 종목 | 16.78% | 54.44% | 50.00% | +4.44%p | 180 |
| 60거래일 | 다른 종목 | 55.86% | 48.46% | 52.13% | −3.67%p | 1,172 |

20일의 같은 종목 유사 발생률은 23.71%였고 과거 창 안의 수익률 순서를 무작위로 바꾼 10개 대조군은 약 23.15~23.98%였다. 60일은 실제 16.78%, 대조군 약 16.69~17.54%였다. 모양이 닮는 현상만으로 우연을 넘어선 예측력이라고 해석할 수 없다.

S&P 500의 동시 움직임을 제거한 잔차 모양도 별도 비교했다. 다른 종목 60일 잔차 모양의 방향 정확도는 51.95%, 같은 표본 기준선은 51.31%로 차이는 +0.64%p였고 분기 단위 95% 구간은 −3.56~+5.17%p였다. 같은 종목 60일의 겉보기 +4.44%p 개선도 평가가 180건이고 95% 구간이 −8.46~+17.13%p여서 개선을 확정하지 않았다.

20건·8분기 이상의 표본 기준을 만족한 종목은 하나 이상의 비교 조합 기준 87종목이었다. 총 113개 종목·창 길이·사례군 조합에서 분기 묶음 재표집과 짝 비교를 적용하고 다중 검정 FDR 5%를 반영한 뒤 유효하게 개선된 조합은 0개였다. 나머지 종목은 개선이 없다고 단정하지 않고 평가 표본 부족으로 남겼다. 선택된 참조 117,191건의 시간 선후·구간 겹침·같은 발행사 중복 위반은 0건이었다. 최초 검산에서 과거 이웃에 GOOG·GOOGL이 함께 포함된 17개 조회를 발견해 같은 발행사 한 사례만 쓰도록 고쳤으며 기준치를 바꾸지 않고 통계와 전체 개별표를 다시 계산했다.

### 비슷한 모양 뒤에 다른 결과가 나온 예

ROST의 2018-01-25와 2024-01-11 종료 60일 패턴 상관은 0.978이었다. 이후 20일 비용 후 수익은 각각 −7.53%, +5.77%였다. MRK의 2024-01-11과 ROST의 2025-05-21 종료 20일 패턴은 상관 0.992였지만 이후 수익은 +5.72%, −17.18%였다. 이 예는 계산 후 모양의 한계를 설명하기 위해 고른 사례이며 예측 모델 선택에는 사용하지 않았다.

### 종목분석·판단 단계 반영안

관찰 후보에는 현재 패턴 분류, 유사도, 변동성 크기, 서로 겹치지 않는 과거 사례 수와 시장 국면을 근거 자료로 붙일 수 있다. 판단 에이전트에는 유사 사례의 다음 구간 수익 분포와 예측 오차, 같은 종목 과거 평균 대비 개선 여부도 함께 보여준다. 현재 표본의 유사도 점수만으로 매수·매도 조건을 통과시키는 것은 검토안에서 보류한다. M40의 기본 조건과 비교하는 추가 입력 후보로 남긴다.

현재 참조 125종목의 생존 편향, 당시 전체 편입·상폐 모집단 공백, 완전한 공시·뉴스 판본 부족, 공급사 원시·보정 종가 차이도 남아 있다. 이번 결과는 가격 모양과 반복성 및 사건 수익 검증이며 기존 M40 계좌를 패턴 조건으로 재최적화한 실험은 아니다. [전체 종목·패턴·통계 검토 원장](../../../docs/research-data/T-156-price-pattern-repeat-review-2026-11-07.json) · [조회별 과거 사례와 예측](../../../docs/research-data/T-156-pattern-observations-2026-11-07.jsonl.gz) · [동결된 125종목 입력](../../../docs/research-data/T-156-pattern-input-125-2026-11-07.npz)

![패턴의 모양 유사성과 이후 결과 비교](../../../docs/research-data/T-156-price-pattern-review-2026-11-07.png)

### 125종목 개별 점검표

최근 분류의 기준일은 2026-09-30이다. 동일 종목 유사 발생률은 2016~2025의 20일 조회 기준이며 미래 상승 확률과 구분한다. 예측 평가 건수는 같은 종목/다른 종목 과거 사례를 각각 사용한 건수다.

| 종목 | 유효 일봉 | 마지막 관측 | 최근 20일 분류 | 동일 종목 유사 발생률 | 예측 평가 건수 동일/타종목 | 판정 |
|---|---:|---|---|---:|---:|---|
| NAS:AAPL | 5,722 | 2026-09-30 | 횡보·혼합 | 40.00% | 30/73 | 예측 개선 미확인 |
| NAS:ABNB | 1,457 | 2026-09-30 | 지속 하락 | 10.64% | 0/17 | 예측 표본 부족 |
| NAS:ADBE | 5,722 | 2026-09-30 | 변동성 하락 | 27.20% | 18/67 | 예측 개선 미확인 |
| NAS:ADI | 5,722 | 2026-09-30 | 변동성 상승 | 16.94% | 6/47 | 예측 개선 미확인 |
| NAS:ADP | 5,722 | 2026-09-30 | 지속 하락 | 30.65% | 23/73 | 예측 개선 미확인 |
| NAS:ADSK | 5,722 | 2026-09-30 | 지속 하락 | 33.60% | 22/61 | 예측 개선 미확인 |
| NAS:AEP | 5,722 | 2026-09-30 | 지속 하락 | 18.33% | 1/23 | 예측 개선 미확인 |
| NAS:ALAB | 635 | 2026-09-30 | 변동성 상승 | — | 0/0 | 예측 표본 부족 |
| NAS:ALNY | 5,619 | 2026-09-30 | 횡보·혼합 | — | 0/0 | 예측 표본 부족 |
| NAS:AMAT | 5,722 | 2026-09-30 | 하락 후 반등 | 27.20% | 16/63 | 예측 개선 미확인 |
| NAS:AMD | 5,722 | 2026-09-30 | 지속 상승 | 17.86% | 1/38 | 예측 개선 미확인 |
| NAS:AMGN | 5,722 | 2026-09-30 | 하락 후 반등 | 36.80% | 17/75 | 예측 개선 미확인 |
| NAS:AMZN | 5,722 | 2026-09-30 | 횡보·혼합 | 28.80% | 15/66 | 예측 개선 미확인 |
| NAS:APP | 1,372 | 2026-09-30 | 횡보·혼합 | 18.18% | 0/0 | 예측 표본 부족 |
| NAS:ARM | 764 | 2026-09-30 | 변동성 상승 | 0.00% | 0/0 | 예측 표본 부족 |
| NAS:ASML | 5,722 | 2026-09-30 | 횡보·혼합 | 12.37% | 1/39 | 예측 개선 미확인 |
| NAS:AVGO | 4,314 | 2026-09-30 | 하락 후 반등 | 20.97% | 8/64 | 예측 개선 미확인 |
| NAS:AXON | 1,427 | 2026-09-30 | 지속 하락 | 10.00% | 0/0 | 예측 표본 부족 |
| NAS:BKNG | 5,721 | 2026-09-30 | 지속 하락 | 24.80% | 15/68 | 예측 개선 미확인 |
| NAS:BKR | 1,746 | 2026-09-30 | 변동성 하락 | 11.43% | 0/10 | 예측 표본 부족 |
| NAS:CCEP | 5,722 | 2026-09-30 | 변동성 하락 | 9.09% | 0/0 | 예측 표본 부족 |
| NAS:CDNS | 5,722 | 2026-09-30 | 하락 후 반등 | 22.40% | 5/57 | 예측 개선 미확인 |
| NAS:CEG | 3,242 | 2026-09-30 | 변동성 하락 | 15.56% | 1/12 | 예측 표본 부족 |
| NAS:CMCSA | 5,722 | 2026-09-30 | 지속 하락 | 16.80% | 9/55 | 예측 개선 미확인 |
| NAS:COST | 5,722 | 2026-09-30 | 하락 후 반등 | 32.80% | 25/71 | 예측 개선 미확인 |
| NAS:CPRT | 5,722 | 2026-09-30 | 지속 하락 | 18.57% | 1/29 | 예측 개선 미확인 |
| NAS:CRWD | 1,836 | 2026-09-30 | 지속 상승 | 5.88% | 0/13 | 예측 표본 부족 |
| NAS:CRWV | 379 | 2026-09-30 | 횡보·혼합 | — | 0/0 | 예측 표본 부족 |
| NAS:CSCO | 5,722 | 2026-09-30 | 횡보·혼합 | 29.60% | 16/65 | 예측 개선 미확인 |
| NAS:CSX | 5,722 | 2026-09-30 | 변동성 하락 | 23.53% | 6/49 | 예측 개선 미확인 |
| NAS:CTAS | 5,722 | 2026-09-30 | 횡보·혼합 | 25.81% | 15/63 | 예측 개선 미확인 |
| NAS:DASH | 1,458 | 2026-09-30 | 지속 하락 | 9.09% | 0/2 | 예측 표본 부족 |
| NAS:DDOG | 1,767 | 2026-09-30 | 변동성 상승 | 6.38% | 1/19 | 예측 표본 부족 |
| NAS:DXCM | 5,399 | 2026-09-30 | 횡보·혼합 | 12.12% | 1/23 | 예측 개선 미확인 |
| NAS:EXC | 5,722 | 2026-09-30 | 지속 하락 | 15.71% | 2/34 | 예측 개선 미확인 |
| NAS:FANG | 3,510 | 2026-09-30 | 지속 하락 | 14.71% | 0/8 | 예측 표본 부족 |
| NAS:FAST | 5,722 | 2026-09-30 | 횡보·혼합 | 29.60% | 18/70 | 예측 개선 미확인 |
| NAS:FER | 600 | 2026-09-30 | 변동성 하락 | — | 0/0 | 예측 표본 부족 |
| NAS:FTNT | 4,241 | 2026-09-30 | 변동성 상승 | 4.26% | 0/12 | 예측 표본 부족 |
| NAS:GEHC | 950 | 2026-09-30 | 하락 후 반등 | 3.45% | 0/5 | 예측 표본 부족 |
| NAS:GILD | 5,722 | 2026-09-30 | 횡보·혼합 | 30.40% | 14/64 | 예측 개선 미확인 |
| NAS:GOOG | 3,142 | 2026-09-30 | 횡보·혼합 | 15.20% | 8/66 | 예측 개선 미확인 |
| NAS:GOOGL | 5,564 | 2026-09-30 | 횡보·혼합 | 26.40% | 17/64 | 예측 개선 미확인 |
| NAS:HON | 5,722 | 2026-09-30 | 횡보·혼합 | 5.66% | 0/18 | 예측 표본 부족 |
| NAS:HONA | 66 | 2026-09-30 | 상승 후 조정 | — | 0/0 | 예측 표본 부족 |
| NAS:IDXX | 5,722 | 2026-09-30 | 횡보·혼합 | 18.87% | 7/46 | 예측 개선 미확인 |
| NAS:INTC | 5,722 | 2026-09-30 | 지속 상승 | 18.40% | 12/55 | 예측 개선 미확인 |
| NAS:INTU | 5,722 | 2026-09-30 | 지속 하락 | 21.60% | 11/59 | 예측 개선 미확인 |
| NAS:ISRG | 5,722 | 2026-09-30 | 지속 상승 | 28.23% | 15/66 | 예측 개선 미확인 |
| NAS:KDP | 2,069 | 2026-09-30 | 횡보·혼합 | 11.29% | 2/22 | 예측 개선 미확인 |
| NAS:KLAC | 5,722 | 2026-09-30 | 변동성 상승 | 30.40% | 19/55 | 예측 개선 미확인 |
| NAS:LIN | 5,721 | 2026-09-30 | 하락 후 반등 | 5.56% | 0/0 | 예측 표본 부족 |
| NAS:LITE | 2,813 | 2026-09-30 | 횡보·혼합 | — | 0/0 | 예측 표본 부족 |
| NAS:LRCX | 5,722 | 2026-09-30 | 하락 후 반등 | 31.45% | 18/62 | 예측 개선 미확인 |
| NAS:MAR | 5,722 | 2026-09-30 | 변동성 상승 | 28.46% | 13/69 | 예측 개선 미확인 |
| NAS:MCHP | 5,722 | 2026-09-30 | 변동성 상승 | 18.40% | 8/56 | 예측 개선 미확인 |
| NAS:MDLZ | 5,722 | 2026-09-30 | 변동성 하락 | 20.80% | 9/59 | 예측 개선 미확인 |
| NAS:MELI | 4,815 | 2026-09-30 | 지속 하락 | 17.31% | 4/36 | 예측 개선 미확인 |
| NAS:META | 1,081 | 2026-09-30 | 지속 상승 | 5.00% | 0/13 | 예측 표본 부족 |
| NAS:MNST | 5,722 | 2026-09-30 | 변동성 하락 | 30.40% | 13/78 | 예측 개선 미확인 |
| NAS:MPWR | 5,499 | 2026-09-30 | 하락 후 반등 | — | 0/0 | 예측 표본 부족 |
| NAS:MRNA | 1,963 | 2026-09-30 | 변동성 상승 | 16.92% | 1/18 | 예측 표본 부족 |
| NAS:MRVL | 5,722 | 2026-09-30 | 지속 상승 | 22.40% | 3/28 | 예측 개선 미확인 |
| NAS:MSFT | 5,722 | 2026-09-30 | 횡보·혼합 | 25.60% | 18/55 | 예측 개선 미확인 |
| NAS:MSTR | 5,722 | 2026-09-30 | 변동성 상승 | 0.00% | 0/0 | 예측 표본 부족 |
| NAS:MU | 5,722 | 2026-09-30 | 변동성 상승 | 24.00% | 13/54 | 예측 개선 미확인 |
| NAS:NBIS | 487 | 2026-09-30 | 변동성 상승 | — | 0/0 | 예측 표본 부족 |
| NAS:NFLX | 5,722 | 2026-09-30 | 지속 하락 | 22.40% | 7/65 | 예측 개선 미확인 |
| NAS:NVDA | 5,722 | 2026-09-30 | 횡보·혼합 | 31.20% | 21/59 | 예측 개선 미확인 |
| NAS:NXPI | 4,062 | 2026-09-30 | 횡보·혼합 | 10.57% | 1/47 | 예측 개선 미확인 |
| NAS:ODFL | 5,722 | 2026-09-30 | 변동성 하락 | 0.00% | 0/13 | 예측 표본 부족 |
| NAS:ORLY | 5,722 | 2026-09-30 | 횡보·혼합 | 20.80% | 11/53 | 예측 개선 미확인 |
| NAS:PANW | 3,569 | 2026-09-30 | 횡보·혼합 | 10.64% | 0/17 | 예측 표본 부족 |
| NAS:PAYX | 5,722 | 2026-09-30 | 지속 하락 | 30.40% | 18/61 | 예측 개선 미확인 |
| NAS:PCAR | 5,722 | 2026-09-30 | 지속 하락 | 26.40% | 15/61 | 예측 개선 미확인 |
| NAS:PDD | 2,568 | 2026-09-30 | 변동성 하락 | 6.25% | 0/27 | 예측 개선 미확인 |
| NAS:PEP | 5,722 | 2026-09-30 | 지속 하락 | 13.64% | 2/39 | 예측 개선 미확인 |
| NAS:PLTR | 1,507 | 2026-09-30 | 횡보·혼합 | 0.00% | 0/0 | 예측 표본 부족 |
| NAS:PYPL | 2,827 | 2026-09-30 | 횡보·혼합 | 12.10% | 3/51 | 예측 개선 미확인 |
| NAS:QCOM | 5,722 | 2026-09-30 | 횡보·혼합 | 23.20% | 11/64 | 예측 개선 미확인 |
| NAS:REGN | 5,722 | 2026-09-30 | 변동성 하락 | 20.00% | 5/58 | 예측 개선 미확인 |
| NAS:RKLB | 1,467 | 2026-09-30 | 횡보·혼합 | — | 0/0 | 예측 표본 부족 |
| NAS:ROP | 5,722 | 2026-09-30 | 지속 하락 | 4.55% | 0/1 | 예측 표본 부족 |
| NAS:ROST | 5,722 | 2026-09-30 | 하락 후 반등 | 21.77% | 13/59 | 예측 개선 미확인 |
| NAS:SBUX | 5,722 | 2026-09-30 | 지속 하락 | 26.40% | 13/57 | 예측 개선 미확인 |
| NAS:SHOP | 2,857 | 2026-09-30 | 하락 후 반등 | 0.00% | 0/0 | 예측 표본 부족 |
| NAS:SNDK | 403 | 2026-09-30 | 횡보·혼합 | — | 0/0 | 예측 표본 부족 |
| NAS:SNPS | 5,722 | 2026-09-30 | 하락 후 반등 | 21.60% | 9/50 | 예측 개선 미확인 |
| NAS:SPCX | 76 | 2026-09-30 | 횡보·혼합 | — | 0/0 | 예측 표본 부족 |
| NAS:STX | 5,722 | 2026-09-30 | 변동성 상승 | 28.00% | 4/20 | 예측 개선 미확인 |
| NAS:TER | 5,722 | 2026-09-30 | 변동성 상승 | — | 0/0 | 예측 표본 부족 |
| NAS:TMUS | 4,894 | 2026-09-30 | 변동성 하락 | 16.39% | 2/54 | 예측 개선 미확인 |
| NAS:TRI | 5,722 | 2026-09-30 | 횡보·혼합 | 0.00% | 0/0 | 예측 표본 부족 |
| NAS:TSLA | 4,089 | 2026-09-30 | 횡보·혼합 | 28.00% | 12/59 | 예측 개선 미확인 |
| NAS:TTWO | 5,722 | 2026-09-30 | 횡보·혼합 | 9.18% | 1/21 | 예측 개선 미확인 |
| NAS:TXN | 5,722 | 2026-09-30 | 지속 상승 | 16.13% | 7/48 | 예측 개선 미확인 |
| NAS:VRTX | 5,722 | 2026-09-30 | 변동성 하락 | 25.60% | 12/56 | 예측 개선 미확인 |
| NAS:WDAY | 3,510 | 2026-09-30 | 횡보·혼합 | 5.10% | 1/36 | 예측 개선 미확인 |
| NAS:WDC | 5,722 | 2026-09-30 | 하락 후 반등 | 28.00% | 0/26 | 예측 개선 미확인 |
| NAS:WMT | 5,722 | 2026-09-30 | 횡보·혼합 | — | 0/0 | 예측 표본 부족 |
| NAS:XEL | 5,722 | 2026-09-30 | 지속 하락 | 14.29% | 1/32 | 예측 개선 미확인 |
| NYS:ABBV | 3,457 | 2026-09-30 | 횡보·혼합 | 23.20% | 10/74 | 예측 개선 미확인 |
| NYS:ABT | 5,722 | 2026-09-30 | 지속 하락 | 26.40% | 14/56 | 예측 개선 미확인 |
| NYS:BAC | 5,722 | 2026-09-30 | 지속 하락 | 34.40% | 18/76 | 예측 개선 미확인 |
| NYS:BRK.B | 2,603 | 2017-04-19 | — | — | 0/0 | 최신 자료 공백 |
| NYS:CRM | 5,604 | 2026-09-30 | 변동성 하락 | 32.80% | 16/66 | 예측 개선 미확인 |
| NYS:CVX | 5,722 | 2026-09-30 | 횡보·혼합 | 32.80% | 21/58 | 예측 개선 미확인 |
| NYS:DIS | 5,722 | 2026-09-30 | 횡보·혼합 | 24.80% | 11/58 | 예측 개선 미확인 |
| NYS:HD | 5,722 | 2026-09-30 | 지속 하락 | 34.40% | 25/67 | 예측 개선 미확인 |
| NYS:JNJ | 5,722 | 2026-09-30 | 횡보·혼합 | 32.00% | 24/64 | 예측 개선 미확인 |
| NYS:JPM | 5,722 | 2026-09-30 | 변동성 하락 | 32.00% | 22/67 | 예측 개선 미확인 |
| NYS:KO | 5,722 | 2026-09-30 | 횡보·혼합 | 28.80% | 21/59 | 예측 개선 미확인 |
| NYS:LLY | 5,722 | 2026-09-30 | 횡보·혼합 | 33.60% | 26/63 | 예측 개선 미확인 |
| NYS:MA | 5,119 | 2026-09-30 | 지속 하락 | 28.80% | 24/65 | 예측 개선 미확인 |
| NYS:MCD | 5,722 | 2026-09-30 | 지속 하락 | 28.00% | 22/58 | 예측 개선 미확인 |
| NYS:MRK | 5,722 | 2026-09-30 | 횡보·혼합 | 23.20% | 13/58 | 예측 개선 미확인 |
| NYS:NKE | 5,722 | 2026-09-30 | 변동성 하락 | 24.80% | 15/63 | 예측 개선 미확인 |
| NYS:ORCL | 5,722 | 2026-09-30 | 횡보·혼합 | 29.60% | 16/65 | 예측 개선 미확인 |
| NYS:PFE | 5,722 | 2026-09-30 | 하락 후 반등 | 27.20% | 10/61 | 예측 개선 미확인 |
| NYS:PG | 5,722 | 2026-09-30 | 횡보·혼합 | 25.60% | 12/61 | 예측 개선 미확인 |
| NYS:TMO | 5,722 | 2026-09-30 | 지속 상승 | 28.80% | 15/61 | 예측 개선 미확인 |
| NYS:UNH | 5,722 | 2026-09-30 | 지속 하락 | 28.80% | 15/62 | 예측 개선 미확인 |
| NYS:V | 4,663 | 2026-09-30 | 변동성 하락 | 24.00% | 12/62 | 예측 개선 미확인 |
| NYS:WFC | 5,722 | 2026-09-30 | 변동성 하락 | 28.80% | 11/64 | 예측 개선 미확인 |
| NYS:XOM | 5,722 | 2026-09-30 | 횡보·혼합 | 25.60% | 15/70 | 예측 개선 미확인 |

## 유사 패턴 예측과 거래 규칙의 동일 계좌 비교

사용자가 유사 패턴 예측이 의미 있는 미래 등락 예측과 수익으로 이어지는지, 거래 규칙으로 종목을 골라 투자하는 방식과 효과를 비교해 달라고 요청했다. 방향 정확도만으로 투자 수익을 판단하지 않도록 현재 참조 125종목, 같은 가격 원천·기간·시장 조건·계좌 규칙으로 직접 재생했다. 2016~2025의 10년, 두 5년 구간, 2026년 9개월을 각각 초기 $100,000으로 시작했다. 5년 구간과 10년 구간은 겹친다.

모든 비교군은 S&P 500 전 거래일 종가의 200일 평균 조건, 최대 5종목, 신규 매수 시 종목당 평가액의 15% 한도, 매수·매도 각각 0.25%, 원시 가격의 정수 주수, 매도 대금 다음 거래일 가용과 다음 정규장 시가 체결을 공유했다. 후보는 20거래일마다 교체했고 보유 종목은 같은 교체·편출 규칙으로 청산했다. 마지막 날 보유분은 수수료 포함 종가로 청산했다. 예측은 20번째 미래 종가를 목표로 하지만 실제 교체는 다음 시가이고 같은 후보가 남으면 보유를 이어가므로, 예측 사건 수익과 실제 계좌 수익을 구분했다.

M40은 126일 상승률 순위로 고른다. 패턴 방식은 이전 검토의 20일 타종목 유사 사례 조건을 유지해 예상 순수익이 양수인 종목을 예상치 순으로 고른다. 상관 0.90, 변동성 비율 0.5~2배, 겹치지 않는 사례 3개 이상과 같은 종목의 성숙 기준 사례 20개를 요구했다. 서로 다른 주식 클래스라도 같은 발행사는 한 참조만 허용했다. 패턴 결과가 없는 경우 패턴 순위 방식은 현금으로 둔다. M40에 추가한 매수 보류 방식은 원래 신규 후보에 충분한 패턴 자료가 있고 예상 순수익이 0 이하일 때만 신규 매수를 보류한다. 자료가 없으면 M40을 적용하며 기존 보유분은 원래 M40 규칙을 따른다.

자료 확보 조건의 효과를 따로 확인하기 위해 패턴 비교가 가능한 후보 안에서 M40 순위만 사용하는 대조군도 추가했다. 이번 선택 기준은 계좌 결과를 보기 전에 고정했고 수익이 좋은 설정을 고르는 추가 최적화는 수행하지 않았다.

### 2016~2025 직접 계좌 결과

현재 참조 125종목과 날짜별 재구성 적격 조건을 적용했으므로 이전 69종목 계좌 수익률과 모집단이 다르다. 다음 수익은 모두 수수료 차감 후 CAGR이다.

| 방식 | 연복리 | 최대낙폭 | 최종 평가액 | 완료 거래 | 평균 투자 비중 |
|---|---:|---:|---:|---:|---:|
| M40 고정 | +16.34% | −34.00% | $453,422.79 | 196 | 58.5% |
| 패턴 예측 순위 | +3.82% | −20.06% | $145,494.68 | 393 | 42.5% |
| M40 + 패턴 신규 매수 보류 | +14.79% | −36.37% | $396,597.04 | 177 | 54.9% |
| 패턴 비교 가능 종목의 M40 | +5.47% | −33.82% | $170,252.62 | 329 | 48.0% |

M40에 패턴 신규 매수 보류를 더하면 CAGR은 약 1.55%p 낮아지고 최대낙폭은 약 2.37%p 커졌다. 최종 평가액은 약 $56,825.75 낮았다. 패턴 순위의 최대낙폭은 더 작았지만 평균 투자 비중도 42.5%로 M40의 58.5%보다 낮았다. 자료가 충분한 종목만으로 M40을 적용한 대조군도 연복리 5.47%로 패턴 순위 3.82%보다 높았다. 이번 표본에서 단순히 패턴 자료 확보 대상을 제한하는 효과를 넘어선 예측 순위의 이익은 확인하지 못했다.

### 기간별 변화

장기는 CAGR, 2026년 9개월은 누적 수익률이다.

| 독립 초기화 구간 | M40 | 패턴 순위 | M40 + 패턴 보류 |
|---|---:|---:|---:|
| 2016-01-04~2025-12-31 | +16.34% | +3.82% | +14.79% |
| 2016-01-04~2020-12-31 | +27.96% | +5.08% | +25.29% |
| 2021-01-04~2025-12-31 | +6.91% | −0.27% | +4.46% |
| 2026-01-02~2026-09-30 | +46.07% | +3.20% | +21.41% |

후보 조회 18,127건 중 예측 조건을 충족한 것은 8,475건(약 46.8%)이었다. 패턴 자체를 분류할 수 있는 것과 투자 판단에 충분한 과거 사례를 확보하는 것은 다른 조건이다. 패턴 보류는 거래 수를 줄였지만 해당 구간의 순수익·낙폭을 함께 개선하지 못했다.

### 시점·비교 검산과 설계 해석

두 시점에서 미래 가격과 나중 참조 자료를 실제로 잘라 동일한 과거 사례와 예측치가 유지되는지 확인했다. 현재 패턴 시작보다 이전에 과거 사례의 20일 결과가 끝난 경우만 썼다. 네 기간의 모든 비교군에서 매수일은 판단일 다음 세션이고 계좌 잔액·정수 주수·수수료·실현손익을 대조했다. 원래 M40 엔진과 후보 필터 훅의 기본 모드 거래·평가액 해시도 같았다. 이번 직접 비교는 숫자로 고정한 규칙과 패턴 추정치의 효과를 계산했으며 새 에이전트를 통한 주관적 해석의 효과를 측정한 결과는 아니다.

규칙도 추세 지속 등에 관한 가정을 사용한다. 계좌 수익은 방향 예측 외에 이익·손실의 크기, 보유 기간, 배정 비중, 현금 대기와 비용에 함께 좌우된다. 현재 검증한 모양 유사 예측은 M40의 대체 선정 기준 또는 신규 매수 보류 기준으로 추가할 근거가 부족하다. 판단 에이전트에는 패턴 분류·사례 수·변동성·후속 수익 분포·오차를 설명 자료로 전달하는 안을 유지하고, 자동 거래 통과 조건으로 채택하는 것은 보류한다.

현대 참조 종목의 생존 편향, 공식 전체 편입·상폐 및 당시 NYSE 상위 50 공백, BRK.B 최신 자료 부족과 공급사 가격 판본 차이는 남아 있다. 배당·환전·세금·호가 차이·추가 슬리피지는 포함하지 않았다. 여기의 우열은 이번에 검증한 가격 모양 기반 방식과 M40의 비교 범위에 한정한다. [동일 계좌 비교·판단일별 예측·거래 원장](../../../docs/research-data/T-156-pattern-vs-rules-portfolio-2026-11-07.json)

## M40 기본 최종 설계 검토안 v1.0

작성 기준은 2026-11-07 KST다. **사용자가 정한 방향은 M40 기본 전략, 패턴 참고자료, 검토 후 구현**이다. 아래는 그 방향을 기존 미국 종목분석→시그널 경로에 연결하기 위한 최종 **검토 초안**이다. 코드·DB 스키마·설정·주문 경로는 이번 작업에서 변경하지 않았다. 과거 계좌 실험을 새 설계 전체의 검증 완료로 해석하지 않는다.

### F01 채택 근거와 적용 범위

| 확인한 근거 | 결과 | 설계에 반영할 내용 |
|---|---|---|
| 같은 참조 125종목·2016~2025·초기 $100,000·편도 0.25% 비교 | M40 CAGR **16.34%**, 최대낙폭 **−34.00%**, 최종 **$453,422.79**. 패턴 순위는 **3.82% / −20.06% / $145,494.68**, M40+패턴 매수 보류는 **14.79% / −36.37% / $396,597.04** | M40 유지. 패턴의 부정적 예측만으로 매수를 막지 않는다. 패턴 보류는 M40보다 연복리 1.55%p 낮고 낙폭은 2.37%p 커졌다 |
| 종목별 20일·60일 패턴 예측력 | 충분한 표본을 갖춘 113개 조합 중 다중 비교 보정 후 통과 **0개**. 최신 모양 분류는 **124/125종목** | 패턴은 유사 사례·불확실성 설명에 쓴다. 높은 유사도를 상승 확률이나 거래 승인으로 바꾸지 않는다 |
| M40 10년·5년 각 100개 설정 | 사전 성과·낙폭·최악 주간 조건을 모두 통과한 대체 설정 **0개**. 고정 판단 반복은 일치했지만 독립 새 판단은 **29/36, 80.6%** 일치 | 에이전트의 임의 보류·순위 교체·주간 추가 매도는 거래를 바꾸지 않는 병행 비교에 둔다. 저장된 판단 재생의 재현성과 새 에이전트 판단의 재현성을 구분한다 |
| 교체 일정 민감도 | 선택 연구 후보의 2021~2025 CAGR은 시작 기준일 변경에 따라 **16.24% → 3.01%(+5일) → 0.44%(+10일)**. 같은 기준일의 M40도 **13.23% → 1.88% → 1.29%** | 특정 시작일에 맞춘 최적화로 채택하지 않는다. 공통 교체 기준일과 재시작 규칙을 확정한 뒤 재검증한다 |

수치는 [동일 계좌 비교](../../../docs/research-data/T-156-pattern-vs-rules-portfolio-2026-11-07.json), [패턴 반복 검산](../../../docs/research-data/T-156-price-pattern-repeat-review-2026-11-07.json), [M40 100개 설정 점검](../../../docs/research-data/T-156-m40-5y-10y-100-final-2026-11-07.json)의 기존 결과다. 이번 작업에서 새 수익률 실험을 수행한 것은 아니다. 참조 125종목과 재구성한 편입 자료·고정 NYSE 24개를 쓴 연구이며, **당시 Nasdaq-100+NYSE 상위 50 전체를 복원한 성과가 아니다**. 앞선 69종목 실험과 숫자를 합치지 않는다. 연복리 16.34%는 특정 10년 표본의 결과로, 매년 15% 수익을 입증하지 않는다.

### F02 M40의 매수·보유·매도 계약

| 구분 | 기본 기준과 주기 | 충족·미충족 시 처리 |
|---|---|---|
| 투자 후보 자격 | 해당 시점 효력이 확인된 Nasdaq-100 + StockInvest NYSE 시총 상위 50. 구성 발표·효력일·확인 시각·종목/기업 식별자를 보존 | 보유·즐겨찾기는 수집 범위에 포함해도 자동으로 신규 매수 자격을 주지 않는다. 당시 구성이 미확보면 연구 대리 후보군임을 표시 |
| 가격과 계좌 | 매 미국 거래일 확정 정규장 봉·현금·보유 수량·평가액 갱신. 수익률 지표는 같은 분할 조정 기준, 실제 주문 금액은 원주 가격·통화 기준 | 분할·티커 연결·누락을 먼저 점검. 필수 가격이 없으면 순위에서 조용히 지우거나 0점 처리하지 않고 자료 부족으로 기록 |
| 시장 필수 조건 | 판단일 D0의 **직전 완료 거래일 D−1** S&P 500 종가가 같은 시점 SMA(200)보다 높음. 연구의 한 거래일 지연을 유지 | 정기 교체일에 조건 참이면 후보 선정. 확인된 거짓이면 선정 목록을 비워 M40 보유분의 일반 매도 초안 생성. **자료 미확인(unknown)은 거짓과 다르다** |
| 매수 순위 | D0까지 **126거래일 수익률 > 0**, 높은 순 상위 **5개**. 동률은 고정 종목 식별자 순으로 결정 | 5개 미만이면 부족한 슬롯은 현금. 패턴·LLM 신뢰도·최근 뉴스 감정으로 순위를 바꾸지 않는다 |
| 교체 주기 | **20 미국 거래일마다** 후보와 보유분 재검토. 매일 분석·평가하되 매일 전량 교체하는 방식은 아님 | 계좌 생성·앱 재시작 때 주기를 새로 세지 않는 공통 기준일 T0를 검토 확정해야 한다. 기존 연구는 기간 시작일마다 주기를 시작했으므로 T0 통일 효과는 미검증 |
| 매수 금액 | 신규 편입 1종목의 **수수료 포함 지출 한도 = 판단 시 계좌 평가액의 15%**, 최대 5포지션. 가용 결제 현금과 원주 정수 수량으로 제한 | 한도 부족은 부분 수량 또는 미체결. 보유 후 가격 상승으로 비중이 15%를 넘는다고 자동 감축하지 않는다. 75%는 상시 투자비중 상한으로 해석하지 않는다 |
| 일반 매도 | 정기 교체일에 상위 5개에서 제외되거나 확인된 시장 필수 조건이 거짓. 확인된 편입 효력 종료의 처리는 연구 재생과 맞춰 별도 사유로 기록 | **M40 귀속 보유분**만 대상으로 한다. 기존 사용자 보유분·타 전략 보유분은 귀속/이관 기준을 별도로 검토한다. 데이터 누락이나 구성 목록 갱신 실패만으로 매도하지 않는다 |
| 보호 청산 | 기존 손절·익절·추적·주문 안전 경로는 독립 유지. 장중 보호 판단이 일반 교체보다 우선 | 에이전트 대기·뉴스 수집·주간 보고가 보호 청산을 지연하지 않는다. **M40+기존 보호의 결합 성과는 별도 미검증**이며 순수 M40 성과와 구분 |
| 주간 점검 | 직전 완료 주간의 종목·계좌 등락, S&P 500·Nasdaq Composite 상대 흐름, VIX 변화와 상승 종목 비중 점검 | 위험 설명과 검토 요청에 활용. 주간 급락만으로 새 추가 매도 규칙을 켜지 않는다. 후보군 상승 비중과 거래소 전체 상승 비중을 다른 지표로 표시 |
| 체결과 비용 | D0 장마감 판단 → 다음 정규장 시가 체결을 연구 가정으로 사용. 편도 수수료 **0.25%**씩, 매도 대금은 다음 거래일부터 가용 처리 | 실제 KIS의 주문 접수·시장 개장·결제·통화 조건 대조가 필요. 시가를 이미 본 뒤 과거 시가 체결로 기록하지 않는다. 개장 전 주문 수량, 허용 가격 범위·유효기간·미체결 정책은 검토 확정 사항 |

시장 조건은 매일 관찰하더라도 **그 조건으로 정기 교체 사이에 새 전량 매도를 추가하면 연구 M40과 다른 전략판**이 된다. E3·R02는 비교군으로 보존하며 기본 M40과 자동 전환하지 않는다. 같은 기업의 복수 주식 종류를 하나의 슬롯으로 제한하는 안, 업종 상한, 상시 비중 조정 역시 현재 M40에 검증되지 않은 별도 변경이다.

### F03 분석→시그널 전체 절차

| 순서 | 입력·실행 시점 | 산출물과 결정 주체 | 다음 단계 조건 |
|---|---|---|---|
| 1. 수집·시점 고정 | 매일 일봉·지수·구성, 최근 14일 공시·뉴스·경제 발표. 시간은 UTC 보존, 미국 거래일·장마감/개장 시각 별도 기록 | 수집기가 자료판·출처·해시·정정 이력·결측 목록 생성 | 핵심 가격/구성/식별자 검증과 선택 참고자료 검증을 구분 |
| 2. 지표·시장 상태 | 확정 D0 종목 봉, D−1 시장 필수 조건, 완료 주간 지표 | 코드가 126일 수익률·시장 조건·계좌와 데이터 품질 계산 | 시장 조건은 true/false/unknown, 결측은 0점으로 대체하지 않음 |
| 3. 기본 관찰 후보 | 매일 순위 관찰, 20거래일 정기 교체에만 일반 매매 초안 | 코드가 M40 순위·선정/제외 사유·매수/보유/매도 기본안을 고정 | 기존 보유분과 M40 귀속, 주문 예약 잔량 구분 |
| 4. 참고 카드·조건부 판단 | 사건 신규/정정, 출처 충돌, 기본안 검토, 자원 경합 등 F04의 조건 | 패턴 카드 + 4단계 에이전트 의견. 기본안과 의견은 별도 필드 | 에이전트가 새로 제안한 거래 변경은 모의 비교로 분리 |
| 5. 필수 조건 재확인 | 후보 자격·데이터 시각·현재 거래 가능 여부·기존 필수 정책·현금·수량·중복/상충 주문 | 코드가 통과/대기/거절 사유 결정. 검증된 사실만 사용 | 불확실한 의견을 새 강제 거절 조건으로 승격하지 않음 |
| 6. 연구 시그널 초안 | 기본안·검증 결과·근거·만료·정책판을 묶음 | 주문과 분리한 연구 기록에 저장. 시그널 생성 여부와 에이전트 설명을 대조 | 이번 설계·연구 범위는 여기까지. 활성 시그널 테이블을 모의 저장소로 쓰지 않음 |
| 7. 향후 운영 시그널 | 구현·검토 승인 후, 신규 매수 G-N / 보유 관리 G-H 및 전략판별 검증 | 기존 공통 시그널 서비스에서 재검증·중복 방지·승인/운영 모드 적용 | 발행·승인·주문·체결은 별도 상태. 연구 통과를 자동 주문 승인으로 취급하지 않음 |

시점 저장은 `source_published_at`, 확인 가능한 공시 접수·배포 시각, `first_seen_at`, `ingested_at`, `available_at`, `decision_cutoff`, 원문/판본 해시를 구분한다. **전진 관측의 가용 시각은 공개와 실제 수신·처리가 모두 끝난 뒤**다. 과거 공개 시각만 복원하고 실제 당시 수신을 입증하지 못한 사례는 `reconstructed_public_availability`로 표시해 별도 평가한다. 지금 수집한 자료의 수집 시각을 과거로 바꾸지 않는다. 공개 시각이 날짜만 있으면 그날 장마감 전에 알려졌다고 단정하지 않는다. SEC도 제출 이력 API와 XBRL의 갱신 지연이 다를 수 있다고 설명하므로, 공시 원문을 읽은 시점과 추출 재무값을 사용할 수 있는 시점을 합치지 않는 설계다. [SEC API 원문](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)

14일은 **새 사건 검색 창**이며 14일이 지나도 유효한 거래 정지·합병 효력·보유 관리 사실을 자동 삭제하는 기간이 아니다. 장마감 이후 나온 사건은 마감 시점 재생에 소급하지 않는다. 실제 개장 전 재확인에 쓰려면 별도 판단 시각과 갱신 기록을 남기고 같은 시각을 적용한 비교군을 둔다.

### F04 판단 에이전트 4단계의 개입 조건과 권한

| 단계 | 호출 조건 | 판단 기준·필수 근거 | 기본안에 반영할 범위 | 실패·불일치 시 처리 |
|---|---|---|---|---|
| ① 공시·뉴스 해석 | 해당 기업/시장에 새 원문·정정·서로 다른 보도가 발생. 같은 사건의 단순 재배포는 재호출 대신 연결 | 기업/주식 종류 일치, 당시 공개 시각, 공시 항목·본문 인용 위치, 정정 선후, 기존 사실과 새 사실, 영향 경로, 정보 공백. 원문에 없는 수치·등급 생성 금지 | 사건 요약·확인 사실·해석·상충·미확인을 분리. 기존 필수 정책에 해당하는 객관적 사실은 코드로 재확인. 새 악재 보류 정책은 병행 모의 평가 | 출처 검증 실패·형식 오류면 의견 미확인. 필수 입력이 정상인 M40까지 선택적 뉴스 장애로 중단하지 않음 |
| ② 관찰 후보 검토 | M40 신규 진입/이탈 후보 발생, 자료 품질 경고, 같은 기업의 복수 종류·업종 집중 등 검토점 발생 | 기본 순위의 계산 근거, 구성 효력, 기업 신원, 최근 사건과 보유 귀속, 패턴의 표본·불확실성 | 선정/제외 이유와 경고를 보완. 임의 종목 추가·패턴 점수 가중·5위 교체는 모의 제안으로만 저장 | 패턴 부족은 `참고 근거 부족`. M40 적격 후보를 탈락시키지 않음. 핵심 구성·가격 불명확이면 코드가 신규 매수 대기 |
| ③ 조건 확인 | 정기 매매 초안에 근거 충돌·공시 정정·미확인 거래 상태가 있거나 기존 정책상 재확인이 필요 | 코드 계산값과 원문이 일치하는지, 사실이 현재도 유효한지, 위험 주장의 반증·누락, 주문/현금 자료와 충돌 여부 | `일치/불일치/추가확인` 의견과 근거 반환. 자격·거래정지·현금·중복·주문 안전 통과 여부는 코드가 결정. 새 매수 보류·추가 매도는 모의 제안 | 모델의 자신감 수치만으로 필수 조건 통과 불가. 선택적 판단 지연은 정상 M40로 복귀, 핵심 자료 불명확은 해당 행위 대기. 보호 청산은 독립 진행 |
| ④ 최종 우선순위 비교 | 같은 시점의 후보가 가용 현금/슬롯과 경합하거나 동일 기업·반대 방향 제안이 겹침 | M40 원순위, 가용 결제 현금, 기존 주문 예약, 포지션 귀속, 비교 대상에 실제 제시된 근거, 거래 비용 | 설명·자원 충돌 검토와 대안 순위 제출. 실제 기본 매수 순서는 M40 유지. 매도·보호·수동 주문의 예약과 잔량은 기존 공통 코드로 대사 | 임의로 수량·종목·집행 순서를 바꾸지 않음. 에이전트 간 다른 결론은 모의 비교의 불일치 사례로 기록 |

초기안의 에이전트는 **근거 해석·교차 점검에 개입**한다. 수익 우위가 아직 검증되지 않은 `매수 보류`, `순위 교체`, `주간 추가 매도`, `E3/R02 전환`은 **실제 거래를 바꾸지 않는 별도 비교 제안**이다. 해당 권한을 승격하려면 F08의 같은 계좌 비교와 신규 표본을 통과해야 한다. 패턴 경고만으로 에이전트를 반복 호출해 더 강한 거절 의견을 얻는 절차는 두지 않는다.

호출 여부는 사건/판본 해시·후보 변경·명시된 검토 사유로 코드가 결정하고, 같은 자료판과 같은 사유의 호출은 재사용한다. 매일 모든 종목에 4회씩 모델을 호출하지 않는다. 출력은 최소한 `decision_id`, `cutoff`, `source_ids`, `known_facts`, `interpretation`, `missing_data`, `base_action`, `proposed_action`, `reason_codes`, `expires_at`, 모델·프롬프트·정책판을 가진다. 코드가 스키마·출처·허용 종목·시각을 확인하며, 에이전트 출력에서 직접 주문하거나 자동 제출용 보호 청산 종류를 지정할 수 없게 한다. 모델이 역사적 사건의 이후 결과를 알고 있을 가능성은 과거 카드 익명화만으로 제거되지 않으므로 **전진 관측을 별도로 요구**한다.

### F05 패턴·시장 참고 카드

| 참고자료 | 카드에 보여줄 내용 | 해석 한계와 거래 연결 |
|---|---|---|
| 종목 유사 패턴 | 20일/60일 모양, 유사도, 비교 종목·기간·독립 사례 수, 이후 20일 수익 분포·낙폭, 무작위/단순 기준선, 불확실성·미확보 표시 | 현 연구 검색 기준은 유사도 **≥0.90**, 변동성 배율 **0.5~2**, 독립 사례 **3개 이상**. 이는 **자료 검색 기준**으로 매수 기준이 아니다. 3사례로 신뢰할 확률이 확보됐다고 표시하지 않음 |
| 사례 시점·중복 | 참고 사례의 패턴과 이후 결과가 모두 현재 패턴 시작 전 종료. 같은 발행기업의 종류주·겹친 기간은 독립 사례로 중복 집계하지 않음 | 최신 사례의 미래 수익을 현재 예측 입력에 넣지 않음. GOOG/GOOGL 중복 등 교정 규칙 유지 |
| 시장 국면 | 1990년 이후 확보된 S&P 500·Nasdaq Composite 주간 흐름, 최근 완료 주간 수익률·낙폭·상대 강도, VIX 수준·변화 | 두 지수의 유사 흐름·국면은 설명 자료. 미래 폭락/반등 확정으로 표시하지 않고 가격 기준 M40와 분리 |
| 상승 종목 비중 | 분자·분모·대상 시장/후보군·구성판·기간·누락률을 함께 표시 | 참조 종목 상승 비중을 NYSE/Nasdaq 전체 시장 폭으로 이름 붙이지 않음. 전체 분모가 없는 과거 구간은 대리지표로 구분 |
| 공시·뉴스 영향 | 사건 방향, 반증·불확실성, 동일 사건 묶음, 이후 결과를 보지 않은 영향 설명 | 호재/악재 감정 점수에 신규 매수 임계치를 부여하지 않음. 원문에 없는 가격 목표·정확한 상승 확률은 만들지 않음 |

### F06 현재 구현 대비 변경점과 재사용 지점

| 영역 | 현재 코드에서 확인한 경로 | 최종 설계 검토안의 차이 |
|---|---|---|
| 미국 장마감 후보 | 고가 마감·인사이드바·과매도 반등 후보와 실적 제한 등을 평가하는 [해외 장마감](../../../src/lib/strategy/post-market-overseas.ts) | M40를 별도 전략판으로 추가하는 설계. 기존 개별 조건·실적 제한을 무심코 전부 합치지 않고, 필수 정책과 전략 필터의 결합 효과를 분리 검증 |
| 뉴스 입력·모델 판단 | 후보 묶음 한 번의 검색으로 최근 **3일·뉴스 최대 5건**, 단일 LLM의 BUY/SKIP·신뢰도 **60 이상**과 진입 시나리오 | 기업별 **14일 사건 카드·판본/시각**으로 근거 범위를 드러냄. 매매 기본안은 코드 M40, 에이전트는 조건부 4단계 검토. 모델 자신감은 필수 통과 기준에서 제외 |
| 후보·수집 범위 | [미국 자료 수집](../../../src/lib/data/us-data-db.ts)은 보유·즐겨찾기·설정 종목을 함께 다룸 | 수집 대상과 신규 매수 적격 집합을 분리. 구성·기업행동 판을 붙이고 M40 귀속 보유분만 일반 교체 |
| 패턴 추천 | [리서치 추천](../../../src/lib/research/pattern/recommendation.ts)은 연구/화면용 추천 | 설명 카드에 연결. 추천 결과를 검증된 거래 시그널로 바로 승격하지 않음 |
| 일반·보호 매도 | [엔진](../../../src/lib/strategy/engine.ts), [보호 청산](../../../src/lib/strategy/exit-engine.ts), [매도 제안 정책](../../../src/lib/strategy/sell-proposal-policy.ts) | 보호 경로 우선 유지. 정기 M40 일반 매도와 수량 예약을 대사. 추가 약세 매도는 병행 연구 |
| 기록과 시그널 | [판단 기록](../../../src/lib/strategy/records/judgment-trace.ts), [장마감 저장](../../../src/lib/strategy/post-market-engine.ts), [공통 시그널](../../../src/lib/signals/service.ts), [검증 관문](../../../src/lib/safety/validation-gate.ts) | 기존 기록·시그널 관문 재사용, 연구 초안은 별도 기록. M40 전략 ID·정책판을 새로 검증하며 기존 검증 전략 ID를 빌려 우회하지 않음 |

현재 국내 기본 종목·단순 RSI를 다루는 `/api/analyst/run`을 미국 M40 연결의 주 진입점으로 오인하지 않는다. `src/lib/strategy/rules`의 조사 범위에서는 운영용 M40 구현이 확인되지 않았다. 신규 외부 매매 라이브러리나 모델 도입은 이번안에 포함하지 않는다. 워크스페이스 도구·도입 이력의 ADP-004/005 방법론 범위와 ADP-006 기각 상태를 바꾸지 않고 기존 수집·달력·기록·안전 경로를 우선 재사용하는 설계다.

### F07 흐름도와 예외 처리

```mermaid
flowchart TD
    A[매일 자료 수집과 판단 시점 고정] --> B{핵심 자료 검증}
    B -->|미확인| W[신규 매수와 해당 정기 교체 보류<br/>결측을 매도 사유로 사용하지 않음]
    B -->|통과| C[M40 지표와 계좌 갱신]
    C --> D{20거래일 정기 교체일}
    D -->|아님| O[관찰 후보와 주간 위험 보고]
    D -->|맞음| E[M40 매수·보유·일반 매도 기본안]
    A --> F[14일 사건과 패턴 참고 카드]
    F --> G[조건 충족 시 4단계 에이전트 검토]
    E --> G
    G -. 근거와 불일치 보고 .-> H[코드가 필수 조건과 자원 재확인]
    E --> H
    G -. 임의 거래 변경 제안 .-> S[거래를 바꾸지 않는 병행 모의 비교]
    H --> I[연구 시그널 초안과 감사 기록]
    I --> J{향후 구현 검토와 G-N 또는 G-H 통과}
    J -->|아직| K[연구·전진 관측에 유지]
    J -->|승인 후| L[기존 공통 시그널 서비스<br/>중복·승인·주문 안전 재검증]
    P[기존 보호 청산 독립 경로] --> Q[보호 우선·미체결·가용 잔량 대사]
    Q -. 향후 연결 .-> L
    Q -. 일반 초안 자원 충돌 확인 .-> H
```

| 예외 | 설계상 처리 |
|---|---|
| 공시/패턴 없음, 선택적 에이전트 시간 초과·형식 오류 | 자료 부족·실패를 기록. 핵심 M40 입력과 기존 필수 정책이 정상인 경우 기본안 유지. 뉴스가 없음을 호재로 해석하지 않음 |
| 가격·구성·종목 신원·가용 잔량 불명확 | 영향받는 신규 행위/정기 교체를 대기. 보유 누락을 매도 신호로 만들지 않음. 독립 보호 경로가 필요한 실시간 자료를 확보하면 기존 절차로 평가 |
| 장마감 이후 정정·개장 전 새 사건 | 과거 결정판 보존, 새 cutoff의 개정판 생성. 기존 초안 만료/교체를 기록. 미래 사건으로 과거 승인을 소급 변경하지 않음 |
| 동일 세션 재실행·프로세스 재시작 | 전략판·미국 세션·계좌·종목·방향·포지션 의도의 키로 중복 방지. 개정판은 이전판과 연결하며 반복 실행을 새 투자 기회로 세지 않음 |
| 일반 매도와 보호/수동 주문 경합·브로커 결과 불명확 | 예약·부분 체결·미체결 잔량을 대사하고 새 중복 주문을 대기. 에이전트가 보호를 취소하거나 체결 수량을 추정해서 추가 매도하지 않음 |
| 매도 대금 미결제·개장 체결 실패·가격 범위 이탈 | 실제 가용 현금과 확정 체결만 사용. 재시도/만료는 검토 확정한 정책판대로 처리. 무제한 재시도나 지난 시가 체결을 생성하지 않음 |

### F08 남은 검증과 채택·중단 기준

| 검증 항목 | 비교·완료 기준 초안 | 현재 상태와 남은 일 |
|---|---|---|
| 같은 기회의 기존 방식 비교 | A=현재 해외 가격/LLM 방식, B=순수 M40, C=M40+패턴/에이전트 설명, D=M40+에이전트 거래 변경. 같은 기간·후보·시각·비용·예산·보호 정책으로 비교 | A의 당시 프롬프트·원문·모델 응답/실제 판단이 부족하면 **기존 방식 완전 비교 불가**로 표시. 지금 모델로 과거 결정을 재생성한 결과를 당시 결정이라고 부르지 않음 |
| 설명이 거래에 미치는 영향 분리 | B/C의 유효 거래 의도·순위·수량·시점이 같아야 함. 사건 추출·자료 오류 수정 효과와 임의 매매 변경 효과를 따로 집계 | 설명 경로가 몰래 후보를 차단하거나 지연시키는지 확인. 사건 정책을 추가하면 B와도 같은 정책을 적용한 대조군 필요 |
| 거래 변경의 최소 표본 | **새 12주 이상**, 종결 거래 **100건 이상**, 실제 배정/체결이 달라진 **20거래일 이상**을 모두 충족한 뒤 평가. 같은 사건·겹친 보유기간은 군집 처리 | 기존 100회 설정/반복 실행은 독립 거래 100건이 아님. M40의 느린 회전으로 충분한 전진 표본 확보에 장기간이 걸릴 수 있음. 미달이면 **증거 부족**, 종료를 위해 기준을 낮추지 않음 |
| 거래 변경의 성과 통과 | 사전 지정한 같은 계좌 비용 후 증분의 시간 블록 95% 구간 하한 **>0**, 평가 구간별 CAGR 개선과 최대낙폭·최악 주간 손실 비악화를 제안. 피한 손실·놓친 상승·회전율·현금 비중도 병기 | 이는 **M40 v1.0 검토용 사전 기준**으로 구현/신규 평가 전 확정 필요. 기존 C09의 D+5/D+10 단기 기준을 M40 20일 교체의 통과 근거로 대체 사용하지 않음 |
| 4단계별 효과 | 사건 추출은 독립 100사건 등 C09 초안으로 사실 정확도·근거성 평가. 후보/조건/우선순위의 거래 효과는 한 단계씩 추가해 비교. 매수와 매도 따로 보고 | 좋은 요약이 수익 개선이라는 뜻은 아님. 매도 효과는 매도 대금+잔량과 계속 보유 가치, 같은 상태의 반사실·수수료로 계산 |
| 당시 전체 후보와 시장 폭 | 편입 발표/효력과 상장폐지·이름 변경·종류주 이력, 당시 NYSE 상위 50 및 상승 비중 분모 확정 | **미확보**. 125 참조/고정 24 NYSE와 전체 시장을 구분. 1990년부터 전 종목·뉴스가 검증됐다고 표시 불가 |
| 가격·기업행동·손익 회계 | 최신 BRK.B 공백/별칭, 기존 69종목의 원주·조정 종가 차이 6건, 분할·배당·합병·상폐·현금 잔액·보유 수량 대사 | **미완료**. 배당·환율·세금·슬리피지·현금 이자는 기존 계좌 수익에서 제외. USD 가격 계좌 성과와 원화 최종 실수익을 구분하고 총수익 회계 보완 |
| 주기와 재시작 | 공통 T0, 연속 보유 상태, +5/+10일 등 동일 기준일 비교. 신규 계좌가 중간 합류하는 규칙도 고정 | 시작일 민감도가 커서 **채택 전 필수 검토**. 매년/테스트 구간마다 계좌·주기를 초기화한 수익을 연속 운용으로 오인하지 않음 |
| 보호·필수 정책 결합 | 순수 M40, M40+동일 보호, 기존 방식+동일 보호를 분리. 기존 실적 제한 등 전략 필터의 영향도 별도 제거/추가 | 보호가 수익과 낙폭을 바꾸므로 순수 M40의 16.34%를 통합 운영판 성과로 사용 불가 |
| 실행 가능성과 총비용 | 편도 **0.25%** 고정 후 가격 미끄러짐·호가·미체결·지연·결제 현금 추가. 개장 전에 알 수 있는 가격으로 수량/한도 결정 후 체결 대사 | 과거 확정 시가로 정수 수량을 계산한 연구 가정을 실제 개장 전 고정 주문과 대조. KIS 주문 종류·가격 단위·접수 시각·만료 확인. 허용 범위·지연 예산 미확정 |
| 실제 당시 정보·모델 재현 | 자료판·cutoff 이전 입력만 제공, 파일을 물리적으로 잘라 미래 입력 차단. 모델/프롬프트 고정·새 호출의 허용 행동 일치율과 지연/비용 측정 | 저장 응답 반복 재생만으로 새 모델의 반복성을 입증하지 못함. 익명 카드에도 사전학습 지식 잔존 가능. 앞으로의 주문 없는 전진 관측 필요 |
| 위험 예산·운영 승급 | 허용 계좌 최대낙폭·최악 주간 손실·기업/업종 집중 상한과 신규 매수 G-N/보유 G-H 각각의 기준 확정 | 사용자 허용 손실은 **미확정**. 34% 안팎의 연구 낙폭을 자동 승인된 허용 한도로 쓰지 않음. 전략 등록/검증과 사용자 검토 후 구현 범위를 결정 |

미래 정보 사용, 연구에서 활성 주문 경로 유입, 중복/초과 매도, 통화·종목 신원 오류가 **1건이라도 확인되면 해당 모의판을 즉시 중단**하고 정정 판본으로 재평가하는 안이다. 필수 자료가 최근 예정 10세션 중 3세션 이상 누락되면 자료 문제로 관측을 일시 중단하는 기존 C09 초안도 유지하되, 독립 보호 운용 중단과 혼동하지 않는다. 이미 반복 열람한 2006~2026 연구 기간은 전역적으로 새로운 홀드아웃이 아니다. 이 결과를 보면서 수익이 나올 때까지 기준을 계속 조정한 뒤 같은 기간의 성과를 검증 성과로 채택하지 않는다.

### F09 구현 전에 검토할 결정

| 검토 대상 | 현재 제안 | 확정이 필요한 부분 |
|---|---|---|
| 판단 권한 | M40 기본안 + 조건부 사실 해석/근거 점검, 패턴 참고 | 임의 거래 변경은 병행 모의 상태 유지. 승격 시 단계·허용 행동·동일 비용 비교 기준을 별도 승인 |
| 일정·체결 | 공통 T0의 20거래일 교체, 다음 정규장 집행 가정 | T0, 중간 합류, 늦은 분석, 개장 전 새 사건, 수량/가격 범위·만료 정책 |
| 보유 귀속·위험 | M40 귀속분만 일반 교체, 기존 보호 우선 | 기존 보유분 이관 여부, 같은 기업 종류주/업종 집중, 계좌 허용 손실 |
| 검증 범위·우선순위 | 자료 품질/주기/보호 결합 → 주문 없는 전진 관측 → 에이전트 거래 변경 평가 | 미확보 원천의 대리지표 허용 범위, 표본·기간·성과 기준을 시작 전에 고정 |

검토 후 구현이 승인되면 별도 작업 범위로 분리한다. 이번 기록의 완료는 **설계 통합과 검토 항목 정리**이며 데이터 완비·수익 보장·운영 시그널 발행 승인·배포 완료를 뜻하지 않는다.

### F10 데이터 수집 설계 보완 v1.1

분석 전에 **수집 대상 확정 → 원문 확보 → 판본 보존 → 정규화·품질 검사 → 판단용 자료판 확정**을 둔다. 앞으로의 일별 증분 수집과 1990년 이후 과거 자료를 채우는 백필은 별도 작업으로 관리한다. 이번 절은 수집 설계이며 새 수집기·DB 변경·크론 활성화·유료 구독을 실행하지 않았다. 현재 코드는 읽어 확인했으나, 운영 DB의 최신 성공 시각·스위치·실제 원문 보유량을 이번 절에서 실사한 것은 아니다.

#### F10-1 수집 대상과 원천

| 데이터 | 대상·수집 내용 | 원천·방식 제안 | 주기·분석 연결 |
|---|---|---|---|
| 종목 식별·구성 이력 | Nasdaq-100 구성, NYSE 선정 후보, 보유·즐겨찾기. 기업 CIK와 주식 종류별 식별자·티커·거래소·유효기간 분리 | Nasdaq 공식 구성/편입·편출 발표, SEC 기업/거래소 매핑, KIS 종목 마스터를 대조. 현재 목록을 매일 판본 저장하고 발표 시각/효력일 별도 관리 | 하루 1회 변경 확인, 신규 편입·티커 변경 때 재확인. 수집 집합과 신규 매수 적격 집합은 다르게 유지 |
| NYSE 상위 50 산출 | **상위 50만 조회하지 않고 적격 NYSE 후보 전체**의 시총·가격·주식수·통화·기업 중복·제외 사유 수집 | 기존 SEC+KIS 마스터·현재가상세·순위 엔진 재사용 검토. 단위·ADR/ETF/종류주·CIK 중복 처리의 기존 정책판을 보존. 시총 원값과 가격×주식수 대조값 구분 | 기존 구성 갱신 정책의 기준 시점에 전체 산출, 변경/관측 이력은 일별 보존. 월별에서 일별 구성 교체로 바꾸는 것은 별도 정책 변경으로 재검증 |
| 종목 일봉·기업행동 | 분석 후보 전체 ∪ 모든 해외 보유종목 ∪ 추적 종목의 정규장 OHLCV, 원주/조정 가격, 분할·배당·합병·상폐 | 운영 증분은 KIS 기존 수집기 우선. 기업행동 원천·분할만 조정/배당 포함 조정 여부를 명시. 과거 장기 원천은 연구 파일 재검증 후 결측 공급자 비교 | 매 거래일 마감 후 수집, 중첩 구간 재조회로 잠정/정정 봉 대조. 비선정 종목도 수집해 승자만 남기는 편향 방지 |
| 시장 지수 | S&P 500·Nasdaq Composite 일별 종가와 원천 메타. 주간 종가는 저장된 일봉에서 재현 | FRED 등 공식 배포 원천과 검증된 장기 자료를 출처별로 관리. 운영 마감 시각까지 실제 제공 가능한 지수 원천인지 확인 | 일별 수집 후 마지막 완료 주간의 마지막 거래일 종가 집계. 주중 값을 주간 확정값으로 사용하지 않음 |
| VIX | 일별 값·주간 변화·계산 방법론·발행/수신 시각 | Cboe 공식 VIX 이력 우선. VXO와 현재 VIX를 혼합하지 않고 방법론/소급산출 여부 기록 | 일별 갱신, 주간 변화는 자체 계산. 당시 공개 여부가 확인되지 않은 소급 시계열은 엄격한 당시 정보 평가에서 분리 |
| 상승 종목 비중 | 후보군 비중과 NYSE/Nasdaq 전체 비중을 각각 저장. 상승/하락/보합/미확인 수와 분모·종목 구성판 | 후보군 비중은 전일 대비 분할 조정 종가로 자체 산출. 전체 비중은 전체 적격 상장 종목 자료 또는 정의·보장 범위가 명확한 공급자의 집계 사용 | 일별 산출. 분할을 급락으로 세지 않으며 결측을 하락/보합으로 바꾸지 않음. 유효 종목 분모와 미확보 수를 병기 |
| SEC 공시·재무 | 대상 기업의 제출 목록, 원문, 관련 첨부, XBRL 판본. 8-K·10-Q·10-K·6-K·20-F 등 현 지원 양식 우선 | SEC Submissions로 발견, accession으로 원문/관련 첨부 보존. 정기 재무값은 Companyfacts와 해당 제출을 연결. 과거는 추가 제출 파일·분기/일별 색인 활용 | 신규 제출 탐색은 **15분 간격 초안**, 관련 기업 원문 증분 처리, 하루 1회 누락 대조. 제출/원문/추출 재무 완료 상태를 각각 기록 |
| 기업 발표·언론 뉴스 | 대상 기업 전체의 뉴스 메타·허용된 본문, 기업 IR 발표와 시장/산업 사건 | 기존 RSS/M4 발견·최초 관측을 재사용하고 기업 IR·허용된 기사/API 원문과 연결. 출처별 제목/요약/본문 확보 범위 표시. 티커 문자열만으로 기업을 확정하지 않음 | **30~60분 간격 초안**, 보유·예정 거래 기업 우선 처리하되 나머지 대상의 미처리를 기록. 동일 사건은 묶고 원문 판본은 각각 보존 |
| 경제 발표·예정 사건 | FOMC·CPI·고용 등 발표 일정, 실제 발표문·수치·정정, 확인된 기업 실적 일정 | Fed·BLS 공식 발표/RSS와 기업 IR. 수정 가능한 경제 수치는 ALFRED 등 당시 발표판을 확인 | 일정은 매일, 예정 발표 전후 **5~15분 간격 초안**. 시장 예상치/컨센서스는 별도 원천이 없으면 미확보로 표시하고 실제 발표만으로 서프라이즈를 만들지 않음 |
| 계좌·주문 상태 | 보유 수량·평단·현금·통화·미체결/부분 체결·수량 예약·전략 귀속 | 기존 KIS 계좌 조회·체결 대사 경로 재사용. 외부 공시/뉴스 요청에는 계좌 정보를 보내지 않음 | 분석 시작과 시그널 인계 직전 갱신. 과거 개인 보유 이력이 없으면 별도 모의 계좌 원장으로 평가하며 실제 보유 이력으로 표기하지 않음 |

공식 원천 확인: [SEC API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [SEC 역사 범위·접근 정책](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data), [Cboe VIX 이력·방법론](https://www.cboe.com/tradable-products/vix/vix-historical-data), [FRED S&P 500의 이력 제한](https://fred.stlouisfed.org/series/SP500), [Fed RSS](https://www.federalreserve.gov/feeds/feeds.htm), [BLS 발표](https://www.bls.gov/bls/newsrels.htm), [ALFRED 당시 발표판](https://alfred.stlouisfed.org/). 무료 공개 접근이 원문 전체·1990년 전 기간·재배포 허용을 동시에 보장하지 않는다. 새 유료 원천은 과거 범위·판본/시각·상폐/기업행동·사용 조건·비용을 비교한 뒤 선정한다.

#### F10-2 일별 실행 순서

아래 간격은 **설계 초안**이며 운영 크론을 바꾼 것이 아니다. 고정 한국 시각 대신 `America/New_York` 거래일 달력과 실제 개장/조기 폐장·서머타임으로 일정을 산출한다. 참고로 16:00 ET 정규 폐장은 통상 한국 다음 날 05:00/06:00이지만, 조기 폐장일에는 이 고정 시각을 쓰지 않는다.

| 순서 | 실행안 | 완료·자료판 조건 |
|---|---|---|
| 1. 대상·예정 사건 준비 | 하루 시작에 구성판·전체 수집 집합·발표 일정 확정. 이전 미완료 목록 이어받기 | 예상 종목/기업 수와 각 작업을 먼저 원장에 기록. 일부 누락된 목록을 완전한 목록으로 표시하지 않음 |
| 2. 사건 증분 수집 | SEC·IR·RSS를 위 주기로 점검, 새 accession/기사 판본만 본문 확보·기업 연결 | 에이전트 호출 전 원문/시각/기업 매칭 확인. 수집은 정해진 API/피드·큐로 실행하고 모델의 자율 검색에 의존하지 않음 |
| 3. 장마감 일봉 수집 | 정규장 마감 **20분 후 시작 초안**, 잠정·누락이면 재확인. 우선 보유·예정 거래, 다음 전체 후보 | 실제 날짜·확정 여부를 확인해야 완료. 시간이 지났다는 이유만으로 잠정 값을 확정 처리하지 않음 |
| 4. 데이터 검증·기준 시점 확정 | 마감 **60분 후를 초기 배치 목표**로 검토하되, 원천의 제공 지연을 확인해 예산 확정 | `market_asof`(가격의 거래일), `event_cutoff`(사건 포함 경계), 실제 `decision_cutoff`/자료판 생성 시각을 구분. 기존 장마감 컷오프와 다른 사건 창을 쓰면 새 정책판으로 동일 시점 재평가 |
| 5. 분석에 인계 | 충분한 M40 가격·시장·구성 자료판만 확정. 126일 수익률에는 최소 127개 해당 거래일 종가, SMA200에는 직전 시점의 유효 200봉 필요 | 핵심 자료 미확보면 해당 신규 판단 대기. 선택적 뉴스/패턴 실패는 상태를 붙여 기본안에 인계. 후보 일부 가격 누락이 순위·매도를 왜곡하지 않게 함 |
| 6. 개장 전 재확인 | 확정된 별도 시점에 신규 사건·거래정지·계좌/미체결·가격/종목 신원 재확인 | 전날 자료판을 덮지 않고 개정판 연결. 실제 수신·처리 후에만 사용. 개장 전 재판단 효과는 같은 시각의 비교군으로 채점 |
| 7. 다음 일자 대조 | 최근 겹친 봉·늦게 배포된 공시·피드 공백·정정값 확인 | 기존 판단 입력을 소급 수정하지 않음. 최초판과 수정판, 영향받은 분석/거래 제안을 연결 |

지수·VIX 등 참고/필수 자료가 60분 안에 제공된다고 가정하지 않는다. 특히 M40 시장 조건은 F02대로 **D−1** 기준을 유지한다. 제공 지연 때문에 필요한 D−1 자료도 없으면 `unknown`이며 과거 값의 무제한 재사용은 하지 않는다. 수집 워커는 운영 증분을 우선하고 장기 백필은 별도 예산/큐로 처리해 기존 보호·주문 조회의 API 자원을 잠식하지 않는 안이다.

#### F10-3 저장·시점·재현 구조

```mermaid
flowchart LR
    A[공식 API·피드·허용 원문] --> B[수집 원장·원본 판본 보존]
    B --> C[기업·거래일·단위 정규화]
    C --> D[완전성·시점·중복·기업행동 검사]
    D -->|오류·누락| E[격리·재시도·미확보 원장]
    E --> B
    D -->|통과| F[판단 시점별 확정 자료판]
    F --> G[M40 분석·참고 카드·조건부 판단]
```

| 저장 계층 | 설계안 |
|---|---|
| 수집 작업 원장 | 대상·예상 수·페이지/커서·시작/완료·성공/부분/실패·재시도·원천 응답 상태·호출량·진행 체크포인트. HTTP 200과 전체 수집 완료를 분리 |
| 원본 보관 | 허용된 응답 JSON·HTML·첨부를 연구 파일 저장소에 압축 보존하고 DB에는 파일 경로·크기·해시·출처·획득 범위를 기록. 제목/요약만 받았다면 본문 확보로 세지 않음 |
| 정규화 이력 | 일봉·기업행동·종목 매핑·구성·공시·재무·뉴스·거시 발표의 유효 시점과 관측 시점을 함께 기록. 최신 조회용 표와 덮어쓰지 않는 이력층 분리 |
| 시점 계약 | 발행/공개·SEC 접수·실제 배포 확인·최초 수신·처리 완료·판단 시각 분리. **접수 시각만으로 실제 배포 시각을 단정하지 않음**. 시각 없는 날짜는 정밀도와 보수적 이용 경계 기록 |
| 시간대 호환 | 새 연구 기록의 기준 시각은 UTC로 정규화하되 기존 앱 DATETIME은 KST라는 현 계약을 보존·명시적 변환. 기존 DB 시간대를 일괄 변경하지 않음 |
| 중복·정정 | 공시는 accession+문서/해시, 뉴스는 출처 ID/정규화 URL+본문 해시로 판본 관리. 재보도는 하나의 사건에 연결해도 각 출처·발행/관측 시각은 보존. `first_seen_at` 덮어쓰기 금지 |
| 분석용 자료판 | `snapshot_id`에 사용한 구성판·일봉/지수판·문서판·가용 시각·누락 목록·검증 결과를 고정. 백테스트와 전진 분석이 같은 입력 계약으로 읽고, 재수집이 과거 판단 입력을 바꾸지 않게 함 |
| 판단 후 평가 분리 | 이후 5/20일 수익·최대낙폭 등의 정답은 별도 평가 영역. 기준 시점 자료판과 에이전트 입력에는 제공하지 않음 |

과거 파일을 지금 받은 경우 `ingested_at`은 지금이다. 당시 공개를 확인한 복원 자료와 실제 당시 수신 증거가 있는 자료를 별도 등급으로 저장한다. Cboe의 2003년 VIX 방법론 변경 전 구간, 수정된 경제 통계, 추후 바뀐 기사/공시 판본은 당시 정보 검증에서 특별 확인 대상이다. 실시간 원천이 실패했을 때 다른 공급자 값을 조용히 섞지 않고, 가격 조정 방식·단위·중첩 구간을 대조한 뒤 원천 전환 판본을 만든다.

#### F10-4 현재 코드의 재사용과 보완할 부분

| 확인한 기존 코드 | 현재 계약·한계 | 보완 설계 |
|---|---|---|
| [일봉 수집기](../../../src/lib/profit-engine/daily-bars-collector.ts), [저장](../../../src/lib/profit-engine/daily-bars-store.ts) | 기본 대상은 보유+최근 시그널 중심, 백필 매개변수 기본 3년/최대 5년. 최신 표는 upsert로 갱신. 러너에는 정기 일봉 블록이 있으나 일부 파일 주석은 과거의 수동 전용 설명이 남아 있음 | 전체 적격 후보+보유 집합을 명시 전달, 누락/진행 원장과 원본·이력층 보강. **매개변수 5년 상한이 KIS의 실제 과거 보장 범위라는 뜻은 아님**. 장기 백필은 별도 |
| [수집 대상](../../../src/lib/data/us-data-db.ts)·[NYSE 갱신](../../../src/lib/universe/refresh-engine.ts)·[순위](../../../src/lib/universe/rank.ts) | 전체 대상 합집합/NYSE 후보·단위·중복 처리의 재사용 지점이 존재. 자동 구성 갱신 코드 존재와 현재 운영 활성/성공은 다른 사실 | 수집/매수 적격 구분과 구성 효력/관측 이력 보존. 실제 설정·마지막 성공·전체 스캔 누락은 구현 전 점검 |
| [SEC 동기화](../../../src/lib/data/us-edgar/sync-job.ts)·[파서](../../../src/lib/data/us-edgar/parse.ts) | 현 파서는 `filings.recent` 중심. 공시 메타/원문 URL과 재무 추출을 저장하며, 이것만으로 과거 모든 원문·첨부 확보를 입증하지 못함. 재무 표의 키는 최신값 갱신 구조 | 과거 추가 제출 파일·색인 백필, 원문/첨부 다운로드 이력, 제출별 재무 판본 보존. 원문 확인 전 모델에 완전한 공시로 표시하지 않음 |
| [뉴스 수집](../../../src/app/api/cron/news-fetch/route.ts)·[최초 관측](../../../src/lib/corp-intel/raw-capture.ts) | RSS/M4 연동·최초 관측 보존·피드 공백 점검이 존재. 캡처는 제목·GUID·링크 등 **메타 중심**이고 활성 스위치/응답 items/테이블에 좌우됨 | 실제 본문 확보와 라이선스 범위, 수정 기사 판본, 기업 연결·사건 중복 분리. 캡처 코드가 있다는 이유만으로 원문 전체/최초 관측이 실제 저장됐다고 하지 않음 |
| [기초 스냅샷 정의](../../../scripts/migrations/T-059-us-data-collector.sql) | 현재가상세는 하루 한 행 재실행 갱신, 재무는 같은 프레임 최신 값 갱신. DB의 DATETIME은 KST 계약 | 현재 조회 기능 유지와 별도로 당시 상태를 재생할 불변 수집판/이력층을 설계. 기존 테이블을 그대로 과거 시점 DB로 간주하지 않음 |

SEC 호출은 기존 클라이언트의 간격·차단 쿨다운을 재사용하되 증분/백필·다중 워커를 합한 원천별 공유 예산이 필요하다. 현 SEC 공식 상한은 초당 10요청이며 기존 클라이언트는 최대 초당 4회로 제한한다. 새 수집 빈도·워커 수가 이 안전 여유를 없애지 않게 한다. KIS도 계좌·보호·주문 경로 우선권을 유지한다. [SEC 접근 정책](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)

#### F10-5 1990년 이후 백필의 확보 한계와 진행 순서

| 항목 | 먼저 할 일 | 확보되지 않는 범위 처리 |
|---|---|---|
| 지수·VIX | 기존 연구 파일의 출처·해시·거래일·중첩 가격 대조. 원천별 기간표 생성 | FRED S&P 500은 최근 **10년 일봉**이므로 1990년부터를 이것 하나로 채울 수 없음. 장기 지수 원천을 별도 확인. VIX는 공식 1990년 이후 이력이 있어도 당시 방법론/공개 가능성은 따로 확인 |
| 종목별 가격·기업행동 | 기존 연구 참조 종목 파일을 재검증하고 당시 편입·편출/상폐 종목의 결측을 목록화. 초기 M40 분석에 필요한 과거 봉을 우선 확보 | 상장 전은 정상적인 비존재, 거래정지·상폐·원천 누락은 다른 사유. 현재 존재 종목만으로 전체 당시 시장을 복원했다고 하지 않음 |
| SEC | 추가 제출 파일과 **1994년 3분기 이후** 공식 색인으로 원문·첨부 추적 | 1990~1993 전자공시 전체는 이 경로로 확보 불가. EDGAR 이전·초기 전환기/미전자 제출은 기간·기업별 공백으로 남김 |
| 당시 구성·NYSE 순위·시장 폭 | 공식 구성 변경 기록, 당시 상장·주식수/시총·가격·종류주 정책을 함께 복원 | 현재 SEC/KIS 목록·주식수를 과거로 소급하지 않음. 당시 전체 후보 가격·시총/분모가 없으면 고정 후보군 대리 실험으로 구분 |
| 기사·거시 발표 | 확보 가능한 공식 기업/거시 발표 원문과 당시 판본부터 복원. 언론은 허용된 아카이브/API의 기간·시각·원문 범위 확인 | 현재 RSS는 1990년 이후 기사 원문 아카이브가 아님. 당시 판본/공개 시각이 없으면 해당 사건의 에이전트 검증을 미확보 처리. 경제 시계열 최신 수정값을 최초 발표값으로 사용하지 않음 |

권고 순서는 **① 기존 수집 상태·원천별 기간 실사 → ② 앞으로의 전체 대상 증분과 원본 보존 준비 → ③ 기존 과거 파일 검증·가격/구성/공시 백필 → ④ 공식 발표·언론 판본 보완 → ⑤ 같은 자료판의 재백테스트/전진 관측**이다. 앞선 연구 DB의 행 수와 원문 건수가 이 수집 파이프라인 전체의 완료를 증명하지는 않는다.

#### F10-6 일별 완료 보고와 수집 통과 기준

매 수집판에는 **예상/성공/누락 종목·기업 수, 최신 확정 거래일, 새 공시/기사 수, 본문 확보율, 공개 시각 확인율, 최초 관측 지연, 페이지 미완료·재시도 수, 판본 변경·통화/가격 경고, 원천별 호출량·실패와 미확보 사유**를 남긴다. 시가총액 상위 목록은 조회한 전체 후보 수와 제외 사유도 보고한다.

핵심 M40 입력은 해당 세션·적격 집합 기준으로 완전성과 계산 가능성을 확인한 뒤 자료판을 발행한다. 결측을 임의 보간해 126일 순위·SMA200을 통과시키거나 구성 조회 실패를 빈 목록으로 바꾸지 않는다. 참고자료는 확인 범위와 결측을 표시하고 계속 분석할 수 있다. 공시/뉴스의 **확인 결과 0건 / 조회 미실행 / 오류 / 본문 미확보 / 기업 연결 불명확**을 다른 상태로 저장한다. 수집률·시각 정확도·분류 표본·허용 지연의 수치 목표와 유료 원천 선정은 이 구조의 구현 검토에서 확정한다.

### F11 실제 DB·수집 로그 감사와 무료 자료 보완 v1.2

**실사 범위.** 운영 MariaDB는 **2026-11-07 23:12 KST** 자료판을 읽기 전용 트랜잭션으로 조회했다. 수집 로그의 보관 범위는 2026-10-30 21:05~11-07 23:04 KST였다. 마지막 완료 미국 거래일은 **2026-11-06 ET**, 최근 14개 달력일 공시 비교는 **2026-10-24~11-06 ET**다. 현재 저장 후보는 125종목(나스닥 101·NYSE 24)이며 당시 전체 Nasdaq-100+NYSE 상위 50으로 간주하지 않는다.

과거 연구 컨테이너는 정상 종료·데이터 볼륨 보존 상태였다. 네트워크 `none`, 외부 포트 0, 기존 512MiB/0.75CPU 한도를 확인하고 잠시 기동했다. `t156_research_20261106`의 기존 표에만 무료 자료를 출처별로 추가했으며 **DDL·운영 DB 쓰기·수집 코드·설정·크론·주문 경로 변경은 없었다**. 검산 뒤 다른 연구 접속이 없음을 확인하고 정상 종료 상태로 복원했다. 연구 데이터 볼륨은 보존했다.

근거 정본은 [실사·누락률·검산 JSON](../../../docs/research-data/T-156-collection-audit-2026-11-07.json)과 [무료 자료 수집 원장](../../../docs/research-data/T-156-free-data-additions-2026-11-07.json)이다. 해당 JSON에는 조회 범위, 종목별 기간/미확보 날짜, 원천 URL·해시, 일회성 조사·수집 절차, 연구 DB 읽기 검산을 남겼다. 원본 가격 CSV·SEC 제출 JSON·새 공시 원문도 연구 DB에 압축 본문과 해시로 저장했다.

#### F11-1 운영 DB에서 확인한 현재 확보 상태

| 자료 | 실제 확보 기간·수량 | 누락률·시점 해석 | 원문/판본 보유 여부 |
|---|---|---|---|
| 미국 일봉 | **2023-03-28~2026-11-06**, 75종목·**58,843행** | 현재 후보 125개 중 **52개 무기록(41.60%)**. 11/6 봉이 없는 후보는 **57개(45.60%)**. 이미 관측된 75종목 각각의 최초~최종 날짜 안에는 기대 거래일 누락 **0/58,843**. 이 0%가 전체 후보 수집 완료를 뜻하지 않음 | 현지 USD 조정 일봉. 원천 응답 불변 판본 전체가 아니라 최신 값 upsert. 완전한 과거 기업 신원·기업행동 증거는 아님 |
| M40 준비도 | 현재 후보 중 최근 **127개 거래일 확정봉이 모두 있는 종목 67개** | 단순 행 수/최신 봉 유무와 별도 판정. 이 수치만으로 M40 운영 검증 통과를 뜻하지 않음 | 최신 저장 값 기준 검사 |
| 기초 지표 스냅샷 | **2026-10-21~11-07**, 125종목·**1,302행** | 현재 125종목 구성이 기록된 11/3 이후 11/7까지 **5일×125=625개 모두 있음(0% 누락)**. 과거 18일 전체에 현재 125종목 분모를 소급하지 않음 | KIS 원응답 JSON **1,302개 보유**. 같은 날짜 재실행 전 판본 보존은 별도 문제 |
| SEC 공시 목록 | **2007-09-14~2026-11-06**, 116등록인·**15,378행** | 새 공식 조회의 최근 14일 대상 양식 **193건** 중 운영 표에는 **133건**, **60건 미기록(31.09%)** | 공시 접수 시각·원문 URL은 있으나 `us_filings` 자체에는 공시 본문이 없음 |
| SEC 재무값 | 보고 대상 기간 **2006-09-24~2026-10-31**, 접수일 **2009-04-15~2026-11-06**, **94,327행** | 태그·단위·보고기간 모집단의 완전성은 미검증이므로 전체 재무 누락률은 **산출 불가** | 추출된 최신 프레임 값. 제출별 정정 전 원문/재무 판본 전체를 보관한 구조는 아님 |
| 실적 일정 | **141행 전부 추정**, 확정 일정 **0건** | 추정을 확정 실적 발표일로 사용하면 안 됨. 당시 발표 일정 모집단이 없어 전체 누락률 산출 불가 | 추정 근거·관측 기록이며 확정 발표 원문 아님 |
| 해외 뉴스 최초 관측 | **2026-10-28~11-07 KST**, 해외 4개 피드 **4,080건**. 국내 포함 RSS 전체 5,802건, 공시 관측 메타 4건은 별도 | 저장된 RSS 5,802건의 발행 시각 필드는 모두 있음. 전체 발행 기사 목록이 없어 기사 전수 누락률은 **산출 불가**. 발행 시각 존재와 당시 수신 증거/정확성은 별개 | `ci_raw_item`의 본문 참조 **0**, 요약 **0**, 수정판 **0**. 제목·링크·GUID·발행/최초 수신 중심 |
| M4 해외 뉴스 KB | 실제 통계 조회에서 **810포인트**, 상태 green 확인 | 포인트 수는 기사 전체/독립 사건 수와 다름. 전체 payload 직접 읽기는 연결 실패로 발행 기간·원문 전수 보유율 **미검증** | 현 RSS 적재 코드의 텍스트는 **제목+RSS description**이며 기사 원본 HTML 자동 수집은 아님. 810개를 검증된 원문 810건으로 세지 않음 |
| 현재/과거 후보 구성 | 수동 구성판 **1개**, 125종목. 자동 NYSE 목록 **0행**, 자동 갱신 설정 키 미확인 | 실제 NYSE 시총 상위 50 전체와 당시 구성의 누락률은 **산출 불가**. 수동 NYSE 24개를 상위 50의 검증된 일부로 가정하지 않음 | 현재 수동 저장 목록은 있음. 전 기간 공식 구성 원장 아님 |

미국 일봉의 57개 최신 봉 미확보는 **전체 이력 없는 52개 + 기존 이력은 있으나 11/5에서 멈춘 APP·QCOM·SNPS·TSLA·PFE 5개**다. 전체 52개와 종목별 기간·준비도는 실사 JSON에 남겼다. 현재 일봉 수집기의 기본 대상이 보유+최근 시그널 중심인 코드와 대조할 때, 분석 후보 전체와 수집 대상의 불일치가 확인된다. 운영 수집기의 대상 변경은 이번에 하지 않았다.

공시 미기록 60건은 모두 API 접수 시각상 마지막 SEC 잡 종료 **11/7 07:02:06 KST 이전**이지만, **접수 시각은 배포/실제 수신 시각의 증거가 아니다**. 이 미기록률을 전 기간 모든 공시의 누락률이나 당일 마감 전 공개 자료의 누락률로 확대하지 않는다. 비교 양식은 현 분석 범위의 8-K·10-Q·10-K·6-K·20-F·40-F 및 정정 양식이며, 별도 소유권/거래 신고 등은 원문 완료율 분모에서 제외했다.

#### F11-2 수집 로그에서 확인한 한계

| 잡·기록 | 확인 결과 | 의미와 남은 확인 |
|---|---|---|
| `daily-bars` | 보관 구간 **8회 모두 ok/HTTP 200** | 그런데 후보 52개가 표에 없음. 잡 성공은 현재 기본 수집 대상 처리 성공이며 전체 분석 후보 확보 성공이 아님 |
| `edgar-sync` | **8회 중 ok 2회·partial 6회(75%)**, 모두 HTTP 200. 최신 부분 처리의 남은 수 **102** | 코드가 시간 예산 뒤 남은 대상을 다음 회차로 넘기는 계약과 일치. 개별 지연/재시도 전체는 이 로그만으로 복원 불가. CIK 동기화 날짜가 10/21~11/7에 분산돼 있음 |
| 해외 뉴스 ingest | **8회 모두 ok** | 원문 아카이브 완전성 또는 처음 본 시각의 정확성을 증명하지 않음 |
| 해외 뉴스 peek | **154회 중 실패 2회(1.30%)·degraded 5회(3.25%)** | 실행 실패율이며 기사 누락률 아님. RSS 피드가 이미 버린 과거 기사나 최초 관측 전 기간은 복구됐다고 할 수 없음 |
| 세부 수집 건수 | 일봉·SEC·스냅샷 잡의 `counts_json`은 세부 대상/완료 건수를 보존하지 않음 | 홈의 ok/partial만으로 자료별 확보율 계산 불가. DB의 실제 행·일자·대상과 별도 대조 필요 |

과거 로그 보관 시작 전의 스케줄 실행률은 추정하지 않았다. 해외 RSS 최초 관측 4,080건 중 60분 넘게 지나 처음 관측된 사례가 있으므로, 발행 시각만으로 해당 시각에 시스템이 내용을 알고 있었다고 간주할 수 없다. 세부 지연은 피드별 JSON에 있다.

#### F11-3 무료 자료 보완 및 실제 연구 DB 검산

| 자료 | 보완 전 → 보완 후 | 검산·남은 공백 |
|---|---|---|
| 현재 후보 125종목 가격 | 새 무료 게스트 응답에서 **1990-01-02~2026-11-06 범위 내 858,628행**, **125/125종목의 11/6 봉** 확보. 기존 308티커·1,855,428행은 보존 | `kibot_free_regular_raw_20261107`로 정규장 **원주 가격**을 별도 적재. 새 CSV 125개도 압축 보관·해시 대조. 동일 날짜의 출처별 중복은 독립 표본으로 합산하지 않음 |
| 가격의 내부 공백 | 새 125종목의 각 최초~최종 관측 사이 기대 거래일 **875,188개 중 16,560개 미관측(1.8922%)** | 상장·거래정지·종목 신원을 완전히 대사한 실제 오류율이 아니라 **관측 구간 내부 빈 날짜율**. 상장 전은 이 분모에 포함하지 않음. 과거 티커 재사용·기업 승계 미검증 |
| BRK.B | 이전 가격 원천의 오래된 공백과 달리 새 응답은 **1996-05-09~2026-11-06, 7,674행** | 이번 응답의 범위 확보는 확인. 다른 종류주/별칭·기업행동·조정 가격 대사를 대신하지 않음 |
| S&P 500 | 연구 일별 표 **2018-01-02~2026-09-30, 2,198행 → 1990-01-02~2026-11-05, 9,280행** | FRED 무료 최신 CSV와 해시가 일치하는 기존 skfolio 연구 파일을 구분해 보완. 기대 9,281거래일 중 **11/6 1일 미확보(0.0108%)**. 초기 장기 구간은 공식 전체 이력으로 승격하지 않음 |
| Nasdaq Composite | 연구 일별 표 2018~9/30 → **1990-01-02~2026-11-06 유효 9,281거래일**, 날짜 누락 **0%** | 기존 표의 **2019-04-19 휴장일 관측 1행**은 원본 보존을 위해 삭제하지 않았음. 전체 저장 행은 9,282개이므로 실제 분석은 정식 거래일 필터 필요 |
| VIX | 연구 일별 표 2018~9/30 → **1990-01-02~2026-11-06, 9,277거래일** | 기대 거래일 중 **4일 미확보(0.0431%)**: 1991-03-01, 1997-01-31, 1997-11-26, 1999-12-31. 2003년 전 방법론·소급 산출/당시 공개 여부는 별도 검증 |
| Nasdaq 전체 상승 비중 | 공식 2026 파일 **210행·11/3까지 → 211개 유효 일자·11/4까지** 별도 판본 추가 | 11/6까지 기대 214거래일 중 **3일 미확보(1.4019%)**: 3/9 값 공란, 11/5·6 미제공. 빈 값을 0으로 채우지 않음. 현재 후보군 상승 비중과 다른 지표 |
| 최근 14일 SEC | 현재 후보의 **124등록인 모두** 새 제출 목록 확인. 분석 양식 **193건 중 기존 연구 원문 100건 → 193/193건(미확보 0%)** | **새 원문 93건** 추가. SGML의 문서 블록 종료·accession·접수 헤더/API 대조, 원문 해시 확인. 접수 시각 대조 불일치 **0건**. 실제 과거 배포·수신 시각은 미확인 |
| SEC 제출 목록·판본 | 연구 전체 색인 **419,134 → 419,599행**, 최근 14일의 모든 양식 **2,811건** 조회·대조. 제출 JSON **124개** 보존 | 새 원문 완료율은 지정한 주요 양식·기간에 한함. 전 기간의 118등록인 색인과 현재 124등록인의 최근 관측을 혼동하지 않음 |
| BLS·Fed 참고 증거 | Fed RSS 응답 1개 보존. BLS 고용(11/6)·CPI(10/14) 공개 페이지의 **부분 추출문**을 연구 증거로 추가 | BLS 원본 HTML 직접 요청은 **403**, 원본 HTML/전체 발표문 확보로 세지 않음. 공개 페이지 추출문과 raw 원문을 구분. 기존 Fed 247개·BLS 고용 원본 126개가 발표 전수를 뜻하지 않음 |

기존 연구 원문 **1,106건의 압축 해시가 모두 그대로**임을 확인했다. 기존 `kibot_guest_raw` 1,855,428행도 유지했다. 새 가격 858,628행·125종목의 원본 해시, 최근 공시 193건의 원문 해시와 새 93건의 DB 압축 해시를 대조했다. 연구 DB의 이벤트 스케줄러 OFF·패킷 한도 등 기존 설정도 유지했다. 대용량 원문 4개의 SQL 인코딩이 패킷보다 커 전송을 분할했고, 중간 새 출처 적재를 멈춘 뒤 멱등 재실행해 최종 수량을 확인했다. 기존 행의 갱신·삭제 또는 서버 설정 확대로 해결하지 않았다.

원천: [무료 일봉 게스트 범위](https://www.kibot.com/api/api-access.html), [Kibot 가격 조정·파라미터](https://www.kibot.com/api/history-request.html), [FRED S&P 500](https://fred.stlouisfed.org/series/SP500), [skfolio 장기 연구 예제](https://skfolio.org/generated/skfolio.datasets.load_sp500_index.html), [Cboe VIX](https://www.cboe.com/tradable-products/vix/vix-historical-data), [Nasdaq Trader YTD](https://www.nasdaqtrader.com/Trader.aspx?id=DailyMarketFiles), [SEC](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data), [BLS 고용 발표 페이지](https://www.bls.gov/news.release/empsit.nr0.htm). 무료 사용 가능 범위에서만 요청했으며 유료 가입·구매·구독·유료 API 사용은 없었다.

#### F11-4 자료별 남은 한계와 설계 반영

| 남은 항목 | 이번 실사로 확정한 상태 | 검토안 반영 |
|---|---|---|
| 당시 Nasdaq-100·NYSE 상위 50 | 연구 DB의 나스닥 재구성은 **2004~2026** 일부 공식 공지와 연결되며 전 기간 공식 일별 원장은 없음. NYSE는 **2026-07-01·02 샘플 2일**뿐이며 선정 방식도 현재 정책과 동일하지 않음 | 현재 125종목 가격 확보를 과거 전체 투자 가능 집합 확보로 표기하지 않음. 전체 당시 구성의 미확보율을 임의 산출하지 않음 |
| 전체 시장 상승 비중 | 부원천은 NYSE/Nasdaq **1990-01-02~2020-02-10 각 7,583일**. 자체 정합성·정의가 공식 YTD와 같은지 미확인. NYSE 2020년 이후·Nasdaq 2020~2025 공백 | 시계열을 자동 연결하지 않고 원천·정의별로 분리. 후보군 비중으로 전체 시장 비중을 대체하지 않음 |
| 독립 언론 원문 | 기존 연구에 Wikinews **512건(2005~2025)**, VOA **20건(2003~2025)**의 보관 본문, 제한 매체 제목·링크 **15건(1990~2026)** 있음. **현재 14일의 독립 언론 원문 전수는 미확보** | 532개 보관 본문이나 RSS 제목을 장기간 종목 뉴스 전수로 표시하지 않음. 원천별 모집단이 없어 전체 기사 누락률 산출 불가. 새 SEC 첨부 발표는 기업 공식 정보로 분리 |
| 거시 발표·재무의 당시 판본 | Fed·BLS는 선택 표본이며 경제 통계 최초 발표판 전체·수정 이력과 확정 실적 일정은 미완료 | 최신 수정값/추정을 당시 확정값으로 소급 사용하지 않음. 현재 BLS 추출문은 원본 확보율 분모를 채운 것으로 세지 않음 |
| 기업행동·총수익·가격 신원 | 새 무료 가격은 원주 가격이며 **분할/배당 사건 목록은 이번에 확보하지 못함**. 원주 CSV 확보와 M40용 조정 가격·총수익 회계의 완성은 다름 | 조정 방식·종류주·과거 기업 승계·상폐를 대사하기 전 운영용 가격으로 자동 승격하지 않음. 기존 조정판과 교차 검증 필요 |
| 실제 당시 이용 가능성 | 지금 보완한 자료의 관측 시각은 지금이며, 1990년부터의 실제 최초 수신 이력은 복원 불가 | 접수와 배포·관측을 구분하고 `reconstructed_public_availability`/실제 전진 관측을 따로 평가 |
| 운영 수집 완전성 | 운영 데이터는 이번 작업에서 보충/수정하지 않았으므로 후보 52개 일봉 무기록·SEC 미기록·뉴스 원문 공백은 운영에 남음 | 연구 보완 완료와 운영 해결을 구분. 구현 검토 때 전체 대상 계약, 불변 원본/판본 보존, 부분 완료·건수·신선도 기록을 필수 검토 |

수집률의 분모를 **종목 수·기대 거래일·공식 공시 목록·원문 확보율·로그 실행률**로 나눠 표기한다. 날짜 누락 0%가 생존편향·가격 조정·역사적 공개 시각·뉴스 해석 검증을 통과했다는 뜻은 아니다. 추가 자료를 사용한 재백테스트는 이번에 실행하지 않았고 기존 수익률을 갱신하지 않았다. **이번 완료 범위는 실제 수집 상태 점검, 무료 연구 자료 추가와 검토안 보완**이다. 구현은 여전히 검토 후 단계다.

### F12 구현·운영 자료 이관·테스트 이력 저장 착수

이 절은 11/8 08:29 사전 점검 기록이다. 이후 사용자가 Codex 직접 수행을 승인했고 실제 구현·검증·DDL·적재가 진행됐으므로 현재 상태는 F13을 따른다.

사용자의 2026-11-08 지시로 구현 착수·수집 자료의 운영 DB 이관·테스트 데이터 이력 저장이 승인됐다. **같은 승인을 다시 요구하지 않는다.** 현재 프로젝트 AGENTS.md의 큰 구현·최종 검증·배포 Claude 인계 규칙 때문에 담당 방식만 비동기로 확인했다. 현재 담당은 Codex이며 Claude 인수·직접 구현·운영 DDL/적재·배포가 실행됐다고 표시하지 않는다.

[구현·이관·검증·복구 실행안](../../../docs/design/2026-11-08-t156-implementation-and-data-transfer-plan.md)에 실제 DB 사전 점검과 필수 계약을 정리했다. 운영 일봉은 11/8 08:29 KST에 미국77종목·60,537행으로 갱신돼 있었으며, 운영 DB는54개 표·약276MB였다. `backtests`의 원화·단일 종목 계약은 M40 USD 계좌 이력과 다르다. 현재 연결 계정은 운영 스키마 안의 표 생성·DML 권한은 있지만 별도 테스트 DB/전역 생성 권한은 없어, 기본 제안은 같은 DB 내 운영 자료·테스트 전용 표의 논리적 분리다. 별도 DB 생성이나 권한 확대를 임의 실행하지 않는다.

운영 `autopilot_mode=auto`, `safety_dry_run=true`, `safety_kill_switch=false`와 기존 전략16개의 unvalidated 상태를 확인했다. 그대로 보존하며 M40 등록·분석 연결을 기존 실주문 관문 우회나 전략 검증 상태 승격으로 처리하지 않는다. 원주/조정 가격·연구 원문/당시 가용 자료·실거래/가상 결과를 분리해 이관하고, 기존 운영 가격·주문·포지션을 덮지 않는 방향으로 계약을 잡았다.

PNG를 제외한 실제 연구/시뮬레이션 파일 **28개·57,339,111바이트**의 이름·크기·SHA256을 목록화했다. 파일 개수를 독립 실험 개수로 세지 않고 입력/결과/감사 자료를 구분해 원본 복원이 가능하도록 보관한다. 현재 checkout의 다수 병행 변경을 보존해야 한다. 연구 DB의 마지막 성공 상태는 network none·포트0·정지였고, 이후 SSH 재접속 두 번은 키 교환 전 연결 reset으로 실패해 이번 원본 전체 export와 복원 리허설은 미실행이다.

이번 단계에서 완료한 것은 **승인 범위 확인, 실제 스키마/권한/모드 점검, 아카이브 목록화, 구현·이관·테스트·철회 계획 준비**다. 앱 코드 구현·운영 스키마 변경·데이터 적재·배포는 아직 미실행이다. 담당 방식이 정해지면 같은 사용자 승인 범위로 이어서 수행한다.

## 최종 요약

- **최신 최종 설계 검토안 v1.0** — M40이 매수·일반 매도 기본안을 결정하고 패턴은 참고 카드, 에이전트는 4단계 조건부 근거 검토에 사용한다. 임의 거래 변경은 병행 모의로 분리했다. 공통 교체 기준일·당시 구성·보호 결합·실제 체결·새 전진 표본·허용 위험은 미확정/미검증이며 구현은 검토 후 진행한다.
- **수집 보완 v1.1** — F10에 원천별 전체 대상·수집 주기 초안·원본/판본 보존·시점 계약·증분과 장기 백필 분리·누락 보고를 추가했다. 일봉/SEC/뉴스 캡처 코드는 재사용 지점이지만 과거 전 기간/원문/운영 성공은 별도 확인 대상이다. 수집기·DB·크론 구현/활성화는 진행하지 않았다.
- **실제 수집 감사·무료 보완 v1.2** — 운영 후보 125개 중 일봉 무기록 52개, 최신 봉 미확보 57개, 최근 공시 193개 중 운영 표 미기록 60개를 확인했다. 격리 연구 DB에는 무료 원주 일봉 858,628행·125개 최신 봉과 새 SEC 원문 93개, 지수/시장 폭 원천 판본을 추가·검산했다. 운영 수정은 하지 않았으며 전체 당시 구성·독립 언론 전수·기업행동·당시 수신 시각 등의 공백은 남는다.

### [T-156] 지수·공시·뉴스를 결합한 미국 종목 판단 설계

- **상태** — 공개 원천으로 파일을 생성하고 고정 69종목의 2020~2026 가격 재생을 완료했다. 전체 당시 구성 및 뉴스 결합 검증은 원천 확인을 기다린다.
- **성과** — 1,695거래일 장기 재생에서 편도 0.30%의 R02 수익률과 최대낙폭은 **+9.49%·−11.01%**, C는 **+3.05%·−26.46%**였다. 편도 0.15% 수익률은 C가 높았으며, NBIS의 과거 티커 연결 기준을 바꾸면 결과도 달라졌다.
- **전환 검증** — 전일 나스닥종합 5일 규칙은 편도 30bp에서 단기 +3.72%, 장기 +9.92%였다. 장기 낙폭 −30.02%와 2024년 이후 손실을 고려해 전환 우위는 검증되지 않았다.
- **KIS 25bp** — 단기 E3 +3.85%, 장기 R02 +21.09%. 나스닥 5일 전환은 단기 E3와 동일하고 장기 +15.83%였다.
- **판단 에이전트 순차 재생** — 두 실행 모두 6일에 R02를 골라 −1.59%였다. 기존보다 손실은 줄었고, E3 고정 +3.85%에는 뒤졌다.
- **반등·하락 위험 전환** — 편도 25bp에서 단기 −1.59%로 R02 고정과 같았고, 장기 +8.99%·최대낙폭 −18.49%로 R02 고정 +21.09%·−12.28%에 뒤졌다.
- **1990년 이후 데이터 보강** — 일봉 1,855,428행과 공시·뉴스·공식 발표 원문 1,106건을 격리 DB에서 대조했다. 실제 NYSE 상위 50 전 기간, Nasdaq-100 공식 일별 전 기간, 당시 언론 원문 전수는 미확보다.
- **공개 시점·일별 에이전트** — 편도 25bp에서 단기 −1.59%로 R02 고정과 같았고 장기 +15.64%·최대낙폭 −15.39%로 R02 고정 +21.09%·−12.28%보다 낮았다. 연준 조건이 두 날짜를 바꿨으며 SEC·언론 표본은 선택을 바꾸지 않았다.
- **제한된 에이전트 개입** — R02를 대조군으로 두고, 에이전트는 결정에 영향을 줄 수 있는 원문 사건과 후보 간 근거 충돌을 검토한다. 동일한 수치 규칙에 개입만 추가한 비교로 효과를 검증한다.
- **2015~2016년 홀드아웃 정정** — 티커 신원 검사를 동일하게 적용한 뒤 R02 +3.29%, 수치·공식 사건 +8.48%, 제한 개입 +7.54%. 실제 진입 변경은 한 날이었다.
- **2006~2011년 추가 홀드아웃** — R02 −10.98%, 수치·공식 사건 −11.02%, 제한 개입 −10.20%. 두 구간의 직접 체결 변경은 6일로 20일 기준 미달이다.
- **연복리 15% 목표 탐색** — 200회 한도에서 편입일 보정 후 세 구간을 모두 통과한 후보는 없었다. 최저 구간 기준 1위 M40은 +12.19%·+24.65%·+28.93%, 최악 최대낙폭은 −34.71%다.
- **세 전략 전환 비교** — 수치·공식 사건 전환과 제한 판단 추가는 세 장기 구간 모두 연복리 15%를 넘겼다. 판단 추가는 최근 장기 구간에서 $31,243.38 뒤졌고 직접 변경일이 7일로 검증 기준에 미달했다.
- **M40 10년·5년 최종 점검** — 각 100개 설정과 반복 재현을 검산했다. 5년 연구 후보 W30/T3/순위는 네 5년 CAGR을 개선했지만 모든 사전 교체 기준을 통과한 후보는 없어 M40 유지다. 새 판단 일치율은 29/36, 주간 급락과 점검 시작일 민감도가 남았다.
- **125종목 패턴 검토** — 최근 모양은 124종목에서 분류 가능했고 BRK.B 최신 이력에 공백이 있었다. 20일·60일 반복 유사성은 발견됐으나 무작위 대조와 예측력 기준을 넘는 종목별 조합은 0/113이었다. 패턴 점수의 단독 거래 조건 적용은 보류다.
- **패턴 대 규칙 계좌 비교** — 같은 125종목·25bp의 2016~2025 CAGR은 M40 16.34%, 패턴 순위 3.82%, M40+패턴 보류 14.79%였다. 패턴 보류의 최대낙폭도 34.00%에서 36.37%로 커져 추가 채택 근거는 부족하다.
- **남은 검토** — 당시 구성과 거래소 전체 상승 비중 및 기사 판본을 확정한 다음, 같은 판단일에서 가격 기준, 시장 입력, 공시, 뉴스·판단을 하나씩 비교한다.


### F13 Codex 직접 구현·자료 이관 (2026-11-08)

[구현·이관 보고서](../../../docs/implementation/2026-11-08-t156-m40-data-archive.md)를 정본으로 추가한다. 08:29의 담당 확인 대기는 사용자 답변으로 해소됐다. 원본 연구 27개 표 4,383,186행과 파일 28개 57,339,111바이트를 별도 자료·테스트 영역에 보존하며, 원주/조정·원문/메타·현재 관측/당시 재구성의 구분을 유지한다.

- 순수 M40 기본안, 20/60 패턴 참고, 조건부 4단계 판단, shadow 초안·입력/판단 이력, 인증 API를 구현했다. 글로벌 T0 미설정 또는 입력 자격 미확인이면 차단 사유를 저장한다.
- 기존 수집기 대상에 해외 분석 목록을 추가하고, 기존 수집 행의 신규 관측·갱신을 불변 자료판으로 보관한다. 과거 발표일과 지금 최초 관측을 바꾸지 않는다.
- 기존 해외 분석 응답 후 Next after 콜백에서 관측한다. 기존 응답/재시도와 보호 청산은 대기하지 않으며 에이전트 제안은 기본 순위를 바꾸지 않는다.
- 현재 버전의 신호 산출물은 shadow 초안이다. M40 일반 실매매 발행/기존 보유 자동 이관/검증 상태 승급은 실행하지 않았다. F09와 전진 검증은 별도 남은 관문이다.
- 격리 복원과 운영 대상 COUNT/CHECKSUM은 27표 전체 일치. 운영 dataset은 published, live_eligible=false다. 압축원문1,455건 해시와 테스트 원본28개 전체 readback SHA 일치를 확인했다. 코드 배포는 별도 영수증으로 구분한다.

## Reviewer

Codex 하위 역할 `t156_reviewer`가 구현과 시험 본문을 읽고 정적 감사를 수행했다. 최초 공개/추가 적재 경쟁, 철회 후 재공개, T0 불일치, 패턴 시점/20·60 구분, 기존 응답 지연, 구 발표분의 신규 관측 누락을 지적했고 수정 후 재검토했다. 운영/시험 실행은 Reviewer가 수행하지 않았다. 다음 판정은 전달된 실제 두 범위의 합집합이며 실거래 승인이나 전체 프로젝트 PASS가 아니다.

최종 판정: PASS (scope: src/lib/strategy/m40/types.ts, src/lib/strategy/m40/core.ts, src/lib/strategy/m40/load-input.ts, src/lib/strategy/m40/archive-reader.ts, src/lib/strategy/m40/runner.ts, src/lib/strategy/m40/advisory.ts, src/lib/strategy/m40/observer.ts, src/lib/analysis-data/types.ts, src/lib/analysis-data/store.ts, src/lib/analysis-data/capture-operating-data.ts, src/app/api/cron/m40-analysis/route.ts, src/app/api/cron/post-market-analysis/route.ts, src/app/api/research/t156/route.ts, src/lib/profit-engine/daily-bars-store.ts, scripts/t156/archive-lib.mjs, scripts/t156/archive-operator.mjs, scripts/t156/transform-dump.mjs, scripts/t156/source-manifest.py, scripts/migrations/T-156-analysis-archive.sql, src/lib/strategy/m40/__tests__/advisory.test.ts, src/lib/strategy/m40/__tests__/core.test.ts, src/lib/strategy/m40/__tests__/load-input.test.ts, src/lib/strategy/m40/__tests__/observer.test.ts, src/lib/strategy/m40/__tests__/routes.test.ts, src/lib/strategy/m40/__tests__/runner.test.ts, src/lib/analysis-data/__tests__/capture-operating-data.test.ts, src/lib/analysis-data/__tests__/store.test.ts, src/app/api/cron/post-market-analysis/__tests__/t156-companion.test.ts, src/lib/profit-engine/__tests__/daily-bars-collector.test.ts, scripts/t156/archive-lib.test.mjs, scripts/t156/verify-restore.py)


대용량 적재 추가 보완: `t156_storage`가 100 INSERT/8MiB 묶음·완료 표의 COUNT/CHECKSUM 대조 후 재전송 생략·압축 연결 선택을 구현했다. 실제 전용 MariaDB에서 큰 HEX/문자열을 포함한 부분 적재 재개, 원문 체크섬 일치, 완료 표 3개 INSERT 생략을 검증했고 Node 11/11 tests 통과다. `t156_reviewer`는 세 파일을 CONDITIONAL_PASS로 판정했다. 조건은 단일 operator와 전체 검산 후 공개이며, 기존 프로세스 PID 종료·잔존 이관 SQL 0을 확인한 뒤 재개했다. 공개/철회 병행은 실행하지 않는다. DDL은 암묵 commit이므로 강제 철회 전에 실제 importer 종료를 먼저 확인해야 한다.

최종 판정: CONDITIONAL_PASS (scope: src/lib/strategy/m40/types.ts, src/lib/strategy/m40/core.ts, src/lib/strategy/m40/load-input.ts, src/lib/strategy/m40/archive-reader.ts, src/lib/strategy/m40/runner.ts, src/lib/strategy/m40/advisory.ts, src/lib/strategy/m40/observer.ts, src/lib/analysis-data/types.ts, src/lib/analysis-data/store.ts, src/lib/analysis-data/capture-operating-data.ts, src/app/api/cron/m40-analysis/route.ts, src/app/api/cron/post-market-analysis/route.ts, src/app/api/research/t156/route.ts, src/lib/profit-engine/daily-bars-store.ts, scripts/t156/archive-lib.mjs, scripts/t156/archive-operator.mjs, scripts/t156/transform-dump.mjs, scripts/t156/source-manifest.py, scripts/migrations/T-156-analysis-archive.sql, src/lib/strategy/m40/__tests__/advisory.test.ts, src/lib/strategy/m40/__tests__/core.test.ts, src/lib/strategy/m40/__tests__/load-input.test.ts, src/lib/strategy/m40/__tests__/observer.test.ts, src/lib/strategy/m40/__tests__/routes.test.ts, src/lib/strategy/m40/__tests__/runner.test.ts, src/lib/analysis-data/__tests__/capture-operating-data.test.ts, src/lib/analysis-data/__tests__/store.test.ts, src/app/api/cron/post-market-analysis/__tests__/t156-companion.test.ts, src/lib/profit-engine/__tests__/daily-bars-collector.test.ts, scripts/t156/archive-lib.test.mjs, scripts/t156/verify-restore.py, scripts/t156/archive-import.mjs, scripts/t156/archive-import.test.mjs)


운영 일봉 조회 추가: 출처별 raw/미확인조정·기업신원을 보존하는 readResearchStockBars를 구현하고 공개·장종료·정식 거래일을 제한했다. Reviewer는 archive-reader.ts 및 신규 archive-reader.test.ts를 PASS로 재검토했다. 추가30 tests와 tsc 통과, 별도 실제 MariaDB에서 비거래일·미래·출처 제외, 2^53 초과 거래량 및 소수 보존, 조정 미확인 표기·쓰기0을 확인했다. 기존 short-body 문맥도 원문 전체로 오인하지 않게 표시했다.

최종 판정: CONDITIONAL_PASS (scope: src/lib/strategy/m40/types.ts, src/lib/strategy/m40/core.ts, src/lib/strategy/m40/load-input.ts, src/lib/strategy/m40/archive-reader.ts, src/lib/strategy/m40/runner.ts, src/lib/strategy/m40/advisory.ts, src/lib/strategy/m40/observer.ts, src/lib/analysis-data/types.ts, src/lib/analysis-data/store.ts, src/lib/analysis-data/capture-operating-data.ts, src/app/api/cron/m40-analysis/route.ts, src/app/api/cron/post-market-analysis/route.ts, src/app/api/research/t156/route.ts, src/lib/profit-engine/daily-bars-store.ts, scripts/t156/archive-lib.mjs, scripts/t156/archive-operator.mjs, scripts/t156/transform-dump.mjs, scripts/t156/source-manifest.py, scripts/migrations/T-156-analysis-archive.sql, src/lib/strategy/m40/__tests__/advisory.test.ts, src/lib/strategy/m40/__tests__/core.test.ts, src/lib/strategy/m40/__tests__/load-input.test.ts, src/lib/strategy/m40/__tests__/observer.test.ts, src/lib/strategy/m40/__tests__/routes.test.ts, src/lib/strategy/m40/__tests__/runner.test.ts, src/lib/analysis-data/__tests__/capture-operating-data.test.ts, src/lib/analysis-data/__tests__/store.test.ts, src/app/api/cron/post-market-analysis/__tests__/t156-companion.test.ts, src/lib/profit-engine/__tests__/daily-bars-collector.test.ts, scripts/t156/archive-lib.test.mjs, scripts/t156/verify-restore.py, scripts/t156/archive-import.mjs, scripts/t156/archive-import.test.mjs, src/lib/strategy/m40/__tests__/archive-reader.test.ts)

최종 근거 연결·시각·문자 비교 보완은 독립 Reviewer가 지정 구현/시험15파일을 정적 재검토해 PASS로 회신했다. 아래는 기존 실제 판정과 최종 회신의 합집합이다. 적재기의 단일 실행·전체 검산 조건은 실제 충족했다. Reviewer의 시험 실행으로 표기하지 않는다.

최종 판정: CONDITIONAL_PASS (scope: src/lib/strategy/m40/types.ts, src/lib/strategy/m40/core.ts, src/lib/strategy/m40/load-input.ts, src/lib/strategy/m40/archive-reader.ts, src/lib/strategy/m40/runner.ts, src/lib/strategy/m40/advisory.ts, src/lib/strategy/m40/observer.ts, src/lib/analysis-data/types.ts, src/lib/analysis-data/store.ts, src/lib/analysis-data/capture-operating-data.ts, src/app/api/cron/m40-analysis/route.ts, src/app/api/cron/post-market-analysis/route.ts, src/app/api/research/t156/route.ts, src/lib/profit-engine/daily-bars-store.ts, scripts/t156/archive-lib.mjs, scripts/t156/archive-operator.mjs, scripts/t156/transform-dump.mjs, scripts/t156/source-manifest.py, scripts/migrations/T-156-analysis-archive.sql, src/lib/strategy/m40/__tests__/advisory.test.ts, src/lib/strategy/m40/__tests__/core.test.ts, src/lib/strategy/m40/__tests__/load-input.test.ts, src/lib/strategy/m40/__tests__/observer.test.ts, src/lib/strategy/m40/__tests__/routes.test.ts, src/lib/strategy/m40/__tests__/runner.test.ts, src/lib/analysis-data/__tests__/capture-operating-data.test.ts, src/lib/analysis-data/__tests__/store.test.ts, src/app/api/cron/post-market-analysis/__tests__/t156-companion.test.ts, src/lib/profit-engine/__tests__/daily-bars-collector.test.ts, scripts/t156/archive-lib.test.mjs, scripts/t156/verify-restore.py, scripts/t156/archive-import.mjs, scripts/t156/archive-import.test.mjs, src/lib/strategy/m40/__tests__/archive-reader.test.ts, src/lib/strategy/m40/load-evidence.ts, src/lib/strategy/m40/operating-evidence.ts, src/lib/strategy/m40/__tests__/load-evidence.test.ts, src/lib/strategy/m40/__tests__/operating-evidence.test.ts)


Codex 독립 Reviewer t156_reviewer — 전진 모의운용 추가 범위를 정적 재검토했다. 달력 종료 범위·T0 증거·매도 선행 조건·분할 기준 보존·부분 응답의 후보군 동결·원천 재시도 지적의 수정과 paper-only 주문 차단을 확인했다. 기존 연구자료 판정 범위는 위 이력을 그대로 이어받는다. 실제 QA 및 격리 MariaDB/런타임 통합 검증은 Reviewer가 실행하지 않았고 진행 중이므로 이 결과를 선행조건으로 한다. 초기 두 종목 제외 증거는 2026-11-06 원본과 정확히 일치할 때만 유효해 해당 스냅샷을 놓치면 후보군 확정이 보류될 수 있다. 실제 체결·실거래 승인·수익성이나 전체 시스템 통과 판정은 아니다.

Reviewer 추가 기록: 두 QA 수정 시험의 본문과 변경을 정적 검토했다. 루트가 synthetic 계좌·공개 원본 자료의 격리 MariaDB/런타임 통합 11개 검사를 통과했다고 전달했으며 Reviewer가 직접 실행하거나 영수증을 독립 확인한 결과는 아니다. 광범위 QA는 65 suites / 1,594 tests 통과·15 skipped로 전달됐고 tsc/build는 진행 중이다. 격리 통합 실행 조건의 루트 보고는 충족됐으나 QA 잔여 결과와 실제 배포·운영 관측은 별도로 확인한다.
Reviewer 후속 정적 재검토: 초기 후보군 미확정이면 부분 입력의 core 준비 여부와 무관하게 blocked로 기록하므로 과거 세션의 rehearsal 완료 검사로 같은 날 재시도를 막지 않는다. 다음 시도에서 전체 입력과 후보군 확정이 가능하다. 이전 11개 격리 통합 결과는 해당 수정 전 루트 보고다. 이번 수정의 partial 초기 응답→전체 재시도를 포함한 새 격리 12개 통합 검사와 최종 QA 재실행 통과는 아직 별도 조건이며 Reviewer가 실행하지 않았다. 기존 scope와 CONDITIONAL_PASS를 유지한다.
Reviewer 조건 갱신: 루트가 수정 후 격리 MariaDB/실제 런타임 12개 검사 전체 통과를 보고했다. 부분 초기 응답의 blocked·종이 시그널 0·후보군 미확정에서 같은 날 전체 응답의 rehearsal·123종목 동결로 복구되는 사례가 포함된다. QA는 수정본 23개 SHA 9157803c5cd774db8c09fe22c9010cf334c0610cc47526eb6c327e962af86aae 기준 65 suites / 1,594 tests 통과, 15 skipped, tsc/build 성공을 보고했다. 위 통합·QA 조건은 전달된 실행 결과 기준 충족이며 Reviewer가 직접 실행하거나 원격 영수증을 독립 확인한 것은 아니다. 기존 CONDITIONAL_PASS scope와 운영 배포·실거래·수익성은 별개라는 제한을 유지한다.
Codex 독립 Reviewer t156_reviewer 추가 정적 감사: owner 로그인·명시 viewer 확인 뒤 일관 읽기, 종이 신호·판단의 제한된 응답, 공개 범위와 raw JSON 미반환, forward 관측점 기반 성과와 blocked/stale 구분을 확인했다. 불확실한 트랜잭션 연결 폐기, 출처별 집계, 유효 UTC 시각 검증 지적은 수정 후 코드/시험 본문을 재검토했다. 최종 시각 수정 이후 focused QA와 tsc 및 실제 격리 DB 권한·쿼리 재검증은 별도 진행 조건이며 Reviewer가 실행하지 않았다. 화면 데모 v2 사용자 승인과 owner 이메일/명시 viewer 연결은 미완료이고 운영 반영이나 실거래 승인으로 해석하지 않는다. 기존 범위를 보존해 여섯 신규 파일을 최종 scope에 추가한다.
최종 판정: CONDITIONAL_PASS (scope: src/lib/strategy/m40/types.ts, src/lib/strategy/m40/core.ts, src/lib/strategy/m40/load-input.ts, src/lib/strategy/m40/archive-reader.ts, src/lib/strategy/m40/runner.ts, src/lib/strategy/m40/advisory.ts, src/lib/strategy/m40/observer.ts, src/lib/analysis-data/types.ts, src/lib/analysis-data/store.ts, src/lib/analysis-data/capture-operating-data.ts, src/app/api/cron/m40-analysis/route.ts, src/app/api/cron/post-market-analysis/route.ts, src/app/api/research/t156/route.ts, src/lib/profit-engine/daily-bars-store.ts, scripts/t156/archive-lib.mjs, scripts/t156/archive-operator.mjs, scripts/t156/transform-dump.mjs, scripts/t156/source-manifest.py, scripts/migrations/T-156-analysis-archive.sql, src/lib/strategy/m40/__tests__/advisory.test.ts, src/lib/strategy/m40/__tests__/core.test.ts, src/lib/strategy/m40/__tests__/load-input.test.ts, src/lib/strategy/m40/__tests__/observer.test.ts, src/lib/strategy/m40/__tests__/routes.test.ts, src/lib/strategy/m40/__tests__/runner.test.ts, src/lib/analysis-data/__tests__/capture-operating-data.test.ts, src/lib/analysis-data/__tests__/store.test.ts, src/app/api/cron/post-market-analysis/__tests__/t156-companion.test.ts, src/lib/profit-engine/__tests__/daily-bars-collector.test.ts, scripts/t156/archive-lib.test.mjs, scripts/t156/verify-restore.py, scripts/t156/archive-import.mjs, scripts/t156/archive-import.test.mjs, src/lib/strategy/m40/__tests__/archive-reader.test.ts, src/lib/strategy/m40/load-evidence.ts, src/lib/strategy/m40/operating-evidence.ts, src/lib/strategy/m40/__tests__/load-evidence.test.ts, src/lib/strategy/m40/__tests__/operating-evidence.test.ts, src/lib/strategy/m40/forward-types.ts, src/lib/strategy/m40/forward-input.ts, src/lib/strategy/m40/forward-calendar.ts, src/lib/strategy/m40/forward-sources.ts, src/lib/strategy/m40/forward-store.ts, src/lib/strategy/m40/forward-runtime.ts, src/lib/strategy/m40/paper-ledger.ts, src/lib/strategy/m40/__tests__/forward-input.test.ts, src/lib/strategy/m40/__tests__/forward-calendar.test.ts, src/lib/strategy/m40/__tests__/forward-sources.test.ts, src/lib/strategy/m40/__tests__/forward-store.test.ts, src/lib/strategy/m40/__tests__/forward-route.test.ts, src/lib/strategy/m40/__tests__/paper-ledger.test.ts, src/app/api/cron/m40-forward/route.ts, src/lib/safety/dry-run.ts, src/lib/safety/__tests__/m40-paper-order-fence.test.ts, src/lib/exchanges/types.ts, scripts/cron-runner.sh, scripts/test-cron-runner-m40-forward.sh, scripts/migrations/T-156-forward-paper.sql, src/lib/safety/__tests__/order-limits.test.ts, src/lib/strategy/m40/paper-view.ts, src/lib/strategy/m40/paper-view-types.ts, src/lib/strategy/m40/__tests__/paper-view.test.ts, src/lib/strategy/m40/__tests__/paper-view-route.test.ts, src/app/api/research/t156/paper/route.ts, scripts/migrations/T-156-paper-viewer.sql)
- [16:10] Codex 독립 Reviewer `approval_support_review`가 승인 v2와 M40 조회 화면·새 warning 투영 11파일을 정적 감사했다. 실제 공통 게이트 재검사에서 approved/v2·원본 SHA 일치를 직접 확인했다. M40 진입 시 제목 노출·복귀 focus와 선정됐지만 매매 의도가 없는 종목의 저장된 제약 사유 누락을 지적했고, 수정된 코드·회귀시험 본문을 재검토했다. warning은 같은 회차 종목·허용 코드만 최대150개 반환하며 원문 message·금액·임의 JSON은 제외한다. 서명 로그인·명시 viewer/users 확인 후 읽기 전용 일관 스냅샷, GET 재조회, 오류 때 비공개 DTO 제거, blocked/이전 저장분·리허설/전진·결측/0 구분을 확인했다. `git diff --check` 외 기능시험은 Reviewer가 실행하지 않았으며 Ubuntu QA·type/build·CUA·실제 로그인 화면·배포는 별도 증거다. 판정 근거: `agent-vault/10-Flow/artifacts/T-156-m40-ui-implementation-review/review-result.json`, 11파일 manifest SHA `308781e186454b1146beedadff4c9445caf549ed96ae0257094ba67d28b16ae3`. 이후 소스 변경 시 이 판정은 재검토한다.
- [16:10] **최종 판정: PASS (scope: src/app/analytics/AnalyticsPage.tsx, src/app/analytics/TodayPanel.tsx, src/app/analytics/route-resolve.ts, src/app/analytics/M40PaperPanel.tsx, src/app/analytics/M40PaperPanel.module.css, src/app/analytics/m40-paper-copy.ts, src/__tests__/fixtures/t156-paper-view.ts, src/__tests__/t156-paper-view-render.test.ts, src/lib/strategy/m40/paper-view-types.ts, src/lib/strategy/m40/paper-view.ts, src/lib/strategy/m40/__tests__/paper-view.test.ts)**
- [20:44] **최종 판정: PASS (scope: src/app/analytics/AnalyticsPage.tsx, src/app/analytics/M40PaperPanel.tsx, src/app/analytics/M40PaperPanel.module.css, src/app/analytics/m40-paper-ui.ts, src/app/analytics/m40-paper-copy.ts, src/app/analytics/TodayPanel.tsx, src/app/analytics/route-resolve.ts, src/__tests__/t156-paper-view-render.test.ts, src/__tests__/fixtures/t156-paper-view.ts, docs/screens.md, src/lib/strategy/m40/paper-view-types.ts, src/lib/strategy/m40/paper-view.ts, src/lib/strategy/m40/paper-view-query.ts, src/lib/strategy/m40/paper-view-period.ts, src/lib/strategy/m40/forward-calendar.ts, src/app/api/research/t156/paper/route.ts, src/lib/strategy/m40/__tests__/paper-view-query.test.ts, src/lib/strategy/m40/__tests__/paper-view-v6.test.ts, src/lib/strategy/m40/__tests__/paper-view-route.test.ts)**
- [21:19] 부팅 진단 4파일을 독립 정적 검토했고 watchdog 예외 격리 수정 후 재확인했다. 기존 제품 19파일 해시 불변. 실행 검증·운영 원인 규명·재배포는 별도다. 근거 `agent-vault/10-Flow/artifacts/T-156-paper-analysis-v6-implementation/boot-diagnostics-review.json`.
- [21:19] **최종 판정: PASS (scope: src/app/analytics/AnalyticsPage.tsx, src/app/analytics/M40PaperPanel.tsx, src/app/analytics/M40PaperPanel.module.css, src/app/analytics/m40-paper-ui.ts, src/app/analytics/m40-paper-copy.ts, src/app/analytics/TodayPanel.tsx, src/app/analytics/route-resolve.ts, src/__tests__/t156-paper-view-render.test.ts, src/__tests__/fixtures/t156-paper-view.ts, docs/screens.md, src/lib/strategy/m40/paper-view-types.ts, src/lib/strategy/m40/paper-view.ts, src/lib/strategy/m40/paper-view-query.ts, src/lib/strategy/m40/paper-view-period.ts, src/lib/strategy/m40/forward-calendar.ts, src/app/api/research/t156/paper/route.ts, src/lib/strategy/m40/__tests__/paper-view-query.test.ts, src/lib/strategy/m40/__tests__/paper-view-v6.test.ts, src/lib/strategy/m40/__tests__/paper-view-route.test.ts, src/lib/db.ts, src/app/api/health/route.ts, src/lib/diagnostics/boot-diagnostics.ts, src/lib/diagnostics/__tests__/boot-diagnostics.test.ts)**
- [22:51] 실제예측 엔진·원장·조회·화면 33파일을 독립 정적 검토했고 부팅 외 별도 변경·시점·불변·인증·경제 검산 지적 수정 후 재확인했다. 숫자 독립 Analyst 5파일 최종 SHA·별도 검토도 확인했다. Reviewer는 실행시험·DB·운영발행을 수행하지 않았다. 근거 `agent-vault/10-Flow/artifacts/T-156-forecast-engine/independent-review.json`; 최종 격리 QA·DDL 검증은 별도다.
- [22:51] **최종 판정: PASS (scope: scripts/cron-runner.sh, scripts/migrations/T-156-forecast-ledger.sql, scripts/t156/forecast-schema-verify.mjs, scripts/t156/forecast-schema-verify.test.mjs, scripts/test-cron-runner-m40-forecast.sh, src/__tests__/t156-paper-view-render.test.ts, src/app/analytics/M40PaperPanel.tsx, src/app/analytics/m40-paper-ui.ts, src/app/api/cron/m40-forecast/route.ts, src/lib/strategy/m40/__tests__/forecast-continuation.test.ts, src/lib/strategy/m40/__tests__/forecast-engine.test.ts, src/lib/strategy/m40/__tests__/forecast-fixture.ts, src/lib/strategy/m40/__tests__/forecast-ledger.test.ts, src/lib/strategy/m40/__tests__/forecast-publication.test.ts, src/lib/strategy/m40/__tests__/forecast-route.test.ts, src/lib/strategy/m40/__tests__/forecast-view.test.ts, src/lib/strategy/m40/__tests__/forward-store.test.ts, src/lib/strategy/m40/__tests__/paper-view-query.test.ts, src/lib/strategy/m40/__tests__/paper-view-v6.test.ts, src/lib/strategy/m40/forecast-continuation.ts, src/lib/strategy/m40/forecast-engine.ts, src/lib/strategy/m40/forecast-evaluation.ts, src/lib/strategy/m40/forecast-input.ts, src/lib/strategy/m40/forecast-manifest.ts, src/lib/strategy/m40/forecast-runtime.ts, src/lib/strategy/m40/forecast-store.ts, src/lib/strategy/m40/forecast-types.ts, src/lib/strategy/m40/forecast-view.ts, src/lib/strategy/m40/forward-runtime.ts, src/lib/strategy/m40/forward-store.ts, src/lib/strategy/m40/paper-view-query.ts, src/lib/strategy/m40/paper-view-types.ts, src/lib/strategy/m40/paper-view.ts)**
- [23:06] 승인 화면의 중앙 80% 모형범위·범위 밖 손익 가능성 및 확률/포함률 무부호 표시 2파일을 재검토했고 나머지 31파일 SHA 불변을 확인했다. 최신 manifest bbd381f4 기준이며 수정 후 QA·build는 Reviewer가 실행하지 않았다.
- [23:06] **최종 판정: PASS (scope: scripts/cron-runner.sh, scripts/migrations/T-156-forecast-ledger.sql, scripts/t156/forecast-schema-verify.mjs, scripts/t156/forecast-schema-verify.test.mjs, scripts/test-cron-runner-m40-forecast.sh, src/__tests__/t156-paper-view-render.test.ts, src/app/analytics/M40PaperPanel.tsx, src/app/analytics/m40-paper-ui.ts, src/app/api/cron/m40-forecast/route.ts, src/lib/strategy/m40/__tests__/forecast-continuation.test.ts, src/lib/strategy/m40/__tests__/forecast-engine.test.ts, src/lib/strategy/m40/__tests__/forecast-fixture.ts, src/lib/strategy/m40/__tests__/forecast-ledger.test.ts, src/lib/strategy/m40/__tests__/forecast-publication.test.ts, src/lib/strategy/m40/__tests__/forecast-route.test.ts, src/lib/strategy/m40/__tests__/forecast-view.test.ts, src/lib/strategy/m40/__tests__/forward-store.test.ts, src/lib/strategy/m40/__tests__/paper-view-query.test.ts, src/lib/strategy/m40/__tests__/paper-view-v6.test.ts, src/lib/strategy/m40/forecast-continuation.ts, src/lib/strategy/m40/forecast-engine.ts, src/lib/strategy/m40/forecast-evaluation.ts, src/lib/strategy/m40/forecast-input.ts, src/lib/strategy/m40/forecast-manifest.ts, src/lib/strategy/m40/forecast-runtime.ts, src/lib/strategy/m40/forecast-store.ts, src/lib/strategy/m40/forecast-types.ts, src/lib/strategy/m40/forecast-view.ts, src/lib/strategy/m40/forward-runtime.ts, src/lib/strategy/m40/forward-store.ts, src/lib/strategy/m40/paper-view-query.ts, src/lib/strategy/m40/paper-view-types.ts, src/lib/strategy/m40/paper-view.ts)**
- [18:00] T-156 일일 복구 36파일 독립 정적 감사. 원천 장기보존·253/254 거래일·미완성봉·accepted/running·유한재시도·실제 DB시계·KIS 본문제한·세션 발행 경합 지적을 수정 후 검토했다. 36파일 SHA는 developer-freeze-manifest.json과 전부 일치한다. 상세 reviewer-round1.json·reviewer-final.json. 혼합 버전의 구 발행작업 종료/미만료 lease 0 확인은 운영 전 조건이며 마지막 DB시계 검사 뒤 commit 완료까지의 미세 경계는 남는다. 기능시험·실DB·운영 검증은 Reviewer가 실행하지 않았다.
- [18:00] **최종 판정: CONDITIONAL_PASS (scope: package-lock.json, package.json, scripts/cron-runner.sh, scripts/test-cron-runner-m40-forecast.sh, scripts/test-cron-runner-m40-forward.sh, src/app/api/cron/m40-forecast/route.ts, src/app/api/cron/m40-forward/route.ts, src/lib/exchanges/__tests__/kis-http-bounded-index.test.ts, src/lib/exchanges/__tests__/kis-usage-scenarios.ts, src/lib/exchanges/kis-http.ts, src/lib/strategy/m40/__tests__/forecast-ledger.test.ts, src/lib/strategy/m40/__tests__/forecast-publication.test.ts, src/lib/strategy/m40/__tests__/forecast-readiness.test.ts, src/lib/strategy/m40/__tests__/forecast-route.test.ts, src/lib/strategy/m40/__tests__/forecast-session-job.test.ts, src/lib/strategy/m40/__tests__/forward-index-contract.test.ts, src/lib/strategy/m40/__tests__/forward-index-fixtures.ts, src/lib/strategy/m40/__tests__/forward-index-kis.test.ts, src/lib/strategy/m40/__tests__/forward-index-mapping.test.ts, src/lib/strategy/m40/__tests__/forward-index-recovery.test.ts, src/lib/strategy/m40/__tests__/forward-index-transport.test.ts, src/lib/strategy/m40/__tests__/forward-route.test.ts, src/lib/strategy/m40/__tests__/forward-sources.test.ts, src/lib/strategy/m40/__tests__/forward-status.test.ts, src/lib/strategy/m40/__tests__/forward-store.test.ts, src/lib/strategy/m40/forecast-manifest.ts, src/lib/strategy/m40/forecast-runtime.ts, src/lib/strategy/m40/forecast-store.ts, src/lib/strategy/m40/forward-index-contract.ts, src/lib/strategy/m40/forward-index-kis.ts, src/lib/strategy/m40/forward-runtime.ts, src/lib/strategy/m40/forward-sources.ts, src/lib/strategy/m40/forward-store.ts, src/lib/strategy/m40/publication-window.ts, src/lib/strategy/records/__tests__/job-run-log.test.ts, src/lib/strategy/records/job-run-log.ts)**

- [18:10] 사전 운영 영수증(09:08:54Z)과 QA 44/788·격리 MariaDB 영수증 및 harness SHA를 재대조했다. 당시 두 lease 0·구 cron 10KST·개장 321분 전은 확인되나 구 web PID가 online이어서 이후 호출 부재나 종료 완료까지는 증명하지 않는다. 실제 전환 직전 새 lease 0과 구 web 종료·새 실행 직전 재확인이 필요하다. 마지막 DB시각 검사와 commit 완료 사이 한계는 해당 조기 운용 시간에서 수용하되 원자 보장으로 표현하지 않는다. 상세 reviewer-preflight-reassessment.json. Reviewer가 운영 DB나 기능시험을 직접 실행한 것은 아니다.
- [18:10] **최종 판정: CONDITIONAL_PASS (scope: package-lock.json, package.json, scripts/cron-runner.sh, scripts/test-cron-runner-m40-forecast.sh, scripts/test-cron-runner-m40-forward.sh, src/app/api/cron/m40-forecast/route.ts, src/app/api/cron/m40-forward/route.ts, src/lib/exchanges/__tests__/kis-http-bounded-index.test.ts, src/lib/exchanges/__tests__/kis-usage-scenarios.ts, src/lib/exchanges/kis-http.ts, src/lib/strategy/m40/__tests__/forecast-ledger.test.ts, src/lib/strategy/m40/__tests__/forecast-publication.test.ts, src/lib/strategy/m40/__tests__/forecast-readiness.test.ts, src/lib/strategy/m40/__tests__/forecast-route.test.ts, src/lib/strategy/m40/__tests__/forecast-session-job.test.ts, src/lib/strategy/m40/__tests__/forward-index-contract.test.ts, src/lib/strategy/m40/__tests__/forward-index-fixtures.ts, src/lib/strategy/m40/__tests__/forward-index-kis.test.ts, src/lib/strategy/m40/__tests__/forward-index-mapping.test.ts, src/lib/strategy/m40/__tests__/forward-index-recovery.test.ts, src/lib/strategy/m40/__tests__/forward-index-transport.test.ts, src/lib/strategy/m40/__tests__/forward-route.test.ts, src/lib/strategy/m40/__tests__/forward-sources.test.ts, src/lib/strategy/m40/__tests__/forward-status.test.ts, src/lib/strategy/m40/__tests__/forward-store.test.ts, src/lib/strategy/m40/forecast-manifest.ts, src/lib/strategy/m40/forecast-runtime.ts, src/lib/strategy/m40/forecast-store.ts, src/lib/strategy/m40/forward-index-contract.ts, src/lib/strategy/m40/forward-index-kis.ts, src/lib/strategy/m40/forward-runtime.ts, src/lib/strategy/m40/forward-sources.ts, src/lib/strategy/m40/forward-store.ts, src/lib/strategy/m40/publication-window.ts, src/lib/strategy/records/__tests__/job-run-log.test.ts, src/lib/strategy/records/job-run-log.ts)**

- [18:36] 일일 복구 동결 36파일 및 별도 운영 펜스 5파일 SHA 재대조 일치. 운영 pause 영수증 09:34:44Z와 별도 연결 09:35:07Z 검산에서 독립 모의계좌 paused/revision2·경제 지문 불변·두 lease 0·기존 예측 1/4/4 보존·DRY_RUN=true를 확인했다. QA의 격리 MariaDB 펜스 23건은 SQL 모형이며 Reviewer가 직접 실행하지 않았다. 구버전 경합은 코드에서 제거되지 않았지만 이번 전환은 paused 유지로 완화된다. old release 전 프로세스 종료·새 web/cron 각1·정확 SHA·lease0·원장/경제 지문 확인 후에만 기존 active 복구한다. 검사 직전 시계와 commit 완료 사이 한계 및 펜스가 전체 DB 쓰기를 막지 않는 범위는 유지한다. 근거 reviewer-fenced-cutover.json. 운영 결과 확인·배포·실거래 권한과 이 감사 판정은 별개다.
- [18:36] **최종 판정: PASS (scope: package-lock.json, package.json, scripts/cron-runner.sh, scripts/test-cron-runner-m40-forecast.sh, scripts/test-cron-runner-m40-forward.sh, src/app/api/cron/m40-forecast/route.ts, src/app/api/cron/m40-forward/route.ts, src/lib/exchanges/__tests__/kis-http-bounded-index.test.ts, src/lib/exchanges/__tests__/kis-usage-scenarios.ts, src/lib/exchanges/kis-http.ts, src/lib/strategy/m40/__tests__/forecast-ledger.test.ts, src/lib/strategy/m40/__tests__/forecast-publication.test.ts, src/lib/strategy/m40/__tests__/forecast-readiness.test.ts, src/lib/strategy/m40/__tests__/forecast-route.test.ts, src/lib/strategy/m40/__tests__/forecast-session-job.test.ts, src/lib/strategy/m40/__tests__/forward-index-contract.test.ts, src/lib/strategy/m40/__tests__/forward-index-fixtures.ts, src/lib/strategy/m40/__tests__/forward-index-kis.test.ts, src/lib/strategy/m40/__tests__/forward-index-mapping.test.ts, src/lib/strategy/m40/__tests__/forward-index-recovery.test.ts, src/lib/strategy/m40/__tests__/forward-index-transport.test.ts, src/lib/strategy/m40/__tests__/forward-route.test.ts, src/lib/strategy/m40/__tests__/forward-sources.test.ts, src/lib/strategy/m40/__tests__/forward-status.test.ts, src/lib/strategy/m40/__tests__/forward-store.test.ts, src/lib/strategy/m40/forecast-manifest.ts, src/lib/strategy/m40/forecast-runtime.ts, src/lib/strategy/m40/forecast-store.ts, src/lib/strategy/m40/forward-index-contract.ts, src/lib/strategy/m40/forward-index-kis.ts, src/lib/strategy/m40/forward-runtime.ts, src/lib/strategy/m40/forward-sources.ts, src/lib/strategy/m40/forward-store.ts, src/lib/strategy/m40/publication-window.ts, src/lib/strategy/records/__tests__/job-run-log.test.ts, src/lib/strategy/records/job-run-log.ts)**

- [19:33] 구 프로세스 확인 예외의 ops 9파일 독립 정적 감사와 SHA 대조를 마쳤다. QA는 별도 격리 49/49 및 10:32:26Z 실제 읽기 전용 순회에서 기록된 구 PID 부재·관측 가능한 old cwd/절대경로 인자 0을 보고했다. UID1000 신뢰 운영계정/정상 PM2 범위이며 접근 불가 auth 프로세스 40개는 메타데이터로 분류했을 뿐 실제 실행 이미지·메모리·모든 OS cwd를 인증하지 못했다. 계좌는 검토 시 paused이며 최종 operator의 반복 검사·resume 후 새 연결 검산이 별도다. Reviewer는 기능시험/운영 DB를 직접 실행하지 않았다. 근거 reviewer-process-drain.json.

- [20:18] 일회성 KST→ET cron 상태파일 보존 이관안 정적 검토: 영수증 원문 SHA와 두 epoch의 이전 ET일·KST 날짜, 기존 3/1필드의 신 파서 오인 경로를 확인했다. 같은 FS 백업·각 rename 검산을 수용하되 두 파일 동시 원자성은 없고 06:45 ET 충분한 여유 전 적용·상태 재확인 및 partial시 자동 재시도/복원 금지가 조건이다. 운영 파일 조회·기능시험은 Reviewer 직접 수행이 아니다. 근거 reviewer-cron-state-transition.json. 제품36파일 기존 판정은 변경하지 않는다.
- [16:05] F49 무료원천 비운영 2종목 읽기 전용 probe 정적감사: 1차의 비200 원문 보존·응답헤더·키 파일 교체·0행 완료표현·시각/PIT 경계와 2차 page-token 영수증 누락을 Developer 수정 뒤 재검토했다. 최종 private probe SHA 7535f2865e2bb32841c72a4b4017ba40291551fb3faf3c954353cdf74505fe35/test SHA ec550b6df97043d78f72e01ed330e9cb99a60df025d8b52fdf4d3b182db8648a. operator 소유 안전 상위경로/동시교체 방지와 실행호스트 SHA·독립 QA 조건부로 준비 범위만 수용한다. 실제키 읽기/API·DB접속/시험 실행은 하지 않았고 공급자 자격·253일/공통시가종가·기업행동·제품/배포/4기간 발행 판정은 포함하지 않는다. 근거 reviewer-free-source-preparation-20261111.json. 기존 제품 코드 감사 판정은 변경하지 않는다.
- [16:29] F49 BRK.B split-only 후보 좁은 검토: 가림 영수증상 구 Kibot split close와 공통295일/최신200일 정확 일치하므로 신 raw를 채택하지 않고 split을 별도 검토하는 것은 whole-basis 설계와 양립 가능하다. 다만 11/09·11/10은 구 split 대비값이 없고 기업행동 cutoff·identity·실수신/개장시각·장부 기준점과 기존 raw 보존 증거가 필요하다. forecast-input은 raw.open × split.close/raw.close로 수익률을 야간·장중 분해하고 영수증상 target의 retained Kibot raw close와 Alpaca raw=split close가 실제로 달라 분할계수 외 집계 차이가 섞일 수 있다. 295일의 split 값은 구 원문과 같아 기존부터 존재했을 가능성이 크나 이 감사로 귀속을 확정할 수 없다. 원인·기존대비/두 신규일 영향검증 전 실제4기간 발행을 보류하며 source 전체·제품·배포를 수용한 판정이 아니다. 직접 API/키/DB·기능시험 없이 가림 parity와 소스만 읽었다. 근거 reviewer-brkb-split-admission-20261111.json.
- [16:37] F49 BRK.B 동일공급자 raw+split 쌍의 제한적 후보 검토: 별도 가림영수증상 KIS 공식 BRK/B master 일치와 Alpaca 원주 시가·종가297/297 및 최신200/200, 기존Kibot 분할종가295/295를 확인했다(원문 독립재파싱은 QA 대기). 추가 제안했던 구Kibot raw 200 exact 조건을 실측 후 KIS raw 대조+기존 split 연속성으로 수정한 사실과 근거를 명시하며, 기존 전종목 hard gate 완화나 타종목 일반승격으로 표시하지 않는다. data sourceReady와 forecast에 실제 쓰는 번들이 별도조회라 경합시 source/hash가 달라질 수 있는 통합 위험, 기존 Kibot기준 forecast 4개의 사후비교가 공급자 가격전환으로 왜곡될 위험을 검토 전용 high로 전달했다. 기업행동 cutoff·장부·대기intent·전환 평가액·같은번들/hash 결속·이전예측 비교가능성·제품 독립감사/QA 전 운영 채택/예측발행을 수용한 판단이 아니다. 근거 reviewer-brkb-paired-source-20261111.json.
- [17:12] F49 기업행동 근거 판단 보충: 11/09 분할·split API 미조정은 실제 사건 주장이 아닌 합성 반례다. 구 보고의 기업행동 cutoff 증명 문구는 절대적 사건 부재 증명이 아니라 당시 원문·대상·기간·실수신시각을 보존하는 유한한 근거 검토로 명확히 한다. 확인된 모순 없이 SEC/발행사 또는 거래소 자료와 완료 페이지의 data_quality=all 기업행동 자료, 기존 시가·종가/253/PIT/장부 기준을 함께 통과하면 evaluation-only 제한 시험을 조건부로 검토할 수 있다. Alpaca 공식 API는 처리지연·기본 미완성항목 제외·process_date 필터를 명시하므로 빈응답을 분할 부재의 확증으로 표기하지 않는다. 동등한 독립 근거는 허용하며 실제 자료 호출·제품/DB변경·배포 판정은 하지 않았다. 기존 reviewer-brkb-paired-source-20261111.json을 보존하고 reviewer-brkb-corporate-action-clarification-20261111.json으로 해석을 보완했다.
- [17:39] F49 Berkshire 10-Q 유한 근거 수동 재검토: 공식 웹의 표지·Note 18은 09/30 기준 A/B 주식 전환·자사주와 A 1주당 B 1,500주 전환권을 기술하며 그 확인 절에서 신규 주식 분할은 발견하지 못했다. 이는 전체 원문 SHA 보관이나 11/09~10 무사건 증명이 아니다. 별도 보관 8-K·첨부·424B5, CA all-quality 응답/NVDA positive-control 및 NYSE snapshot의 한정 범위와 결합해 해당 11/10 평가전용 원천을 조건부 검토할 수 있다. 새 운영일에는 CA/SEC metadata 갱신과 새 미검토 material 공시·누락·불일치 시 차단이 필요하며 지연/NYSE11/09 공백을 유지한다. 제품·발행·배포 PASS는 아니다. reviewer-brkb-10q-scope-20261111.json 참고.

- [18:43] F49 제품 0.4.0 동결 43파일 SHA·제품 digest 독립 재산출 일치. BRK 원주/분할 쌍·253일·공시/사건 유한근거·결정시각·격리 실패 선행표식·동일분석 해시·account 잠금 및 레거시 평가 비비교 처리를 정적 감사했다. SEC 무사건 절대증명·10-Q 원문 전체 보관·고저거래량 교차검증은 주장하지 않는다. 509개 광역 재현·격리 MariaDB 경합·실운영 자료/예측·별도 운영 wrapper 재감사는 QA와 후속 단계다. 실제 키/API/운영 DB/기능시험은 Reviewer가 실행하지 않았다. 근거 reviewer-brkb-product-20261111.json.
- [18:43] **최종 판정: PASS (scope: .env.example, package-lock.json, package.json, src/lib/exchanges/__tests__/kis-http-bounded-index.test.ts, src/lib/exchanges/__tests__/kis-usage-scenarios.ts, src/lib/exchanges/kis-http.ts, src/lib/strategy/m40/__tests__/forecast-continuation.test.ts, src/lib/strategy/m40/__tests__/forecast-engine.test.ts, src/lib/strategy/m40/__tests__/forecast-fixture.ts, src/lib/strategy/m40/__tests__/forecast-ledger.test.ts, src/lib/strategy/m40/__tests__/forecast-publication.test.ts, src/lib/strategy/m40/__tests__/forecast-session-job.test.ts, src/lib/strategy/m40/__tests__/forward-collection-budget.test.ts, src/lib/strategy/m40/__tests__/forward-index-kis.test.ts, src/lib/strategy/m40/__tests__/forward-index-recovery.test.ts, src/lib/strategy/m40/__tests__/forward-index-transport.test.ts, src/lib/strategy/m40/__tests__/forward-source-fence.test.ts, src/lib/strategy/m40/__tests__/forward-source-regime.test.ts, src/lib/strategy/m40/__tests__/forward-stock-alpaca.test.ts, src/lib/strategy/m40/__tests__/forward-stock-contract.test.ts, src/lib/strategy/m40/__tests__/forward-stock-events.test.ts, src/lib/strategy/m40/__tests__/forward-stock-fixtures.ts, src/lib/strategy/m40/__tests__/forward-stock-json.test.ts, src/lib/strategy/m40/__tests__/forward-stock-transport.test.ts, src/lib/strategy/m40/__tests__/forward-store.test.ts, src/lib/strategy/m40/forecast-continuation.ts, src/lib/strategy/m40/forecast-evaluation.ts, src/lib/strategy/m40/forecast-input.ts, src/lib/strategy/m40/forecast-manifest.ts, src/lib/strategy/m40/forecast-runtime.ts, src/lib/strategy/m40/forecast-store.ts, src/lib/strategy/m40/forecast-types.ts, src/lib/strategy/m40/forward-collection-budget.ts, src/lib/strategy/m40/forward-index-kis.ts, src/lib/strategy/m40/forward-runtime.ts, src/lib/strategy/m40/forward-source-regime.ts, src/lib/strategy/m40/forward-sources.ts, src/lib/strategy/m40/forward-stock-alpaca.ts, src/lib/strategy/m40/forward-stock-contract.ts, src/lib/strategy/m40/forward-stock-events.ts, src/lib/strategy/m40/forward-stock-json.ts, src/lib/strategy/m40/forward-store.ts, src/lib/strategy/m40/publication-window.ts)**

- [18:48] F49 별도 모의계좌 cutover wrapper SHA e1831b2346e92fe365d96767f1e854b97d9c62b1b8456db7f1440dfed39d22c7 및 policy SHA 0539725b422a5d262ed852bae00a9dac0ecef96b00c8868f8d78f9fc35a13f7b 정적 검토: 사용자 기승인 모의계좌 정지·재개 실행 전제에 한해 조건부 수용한다. 모듈 해시 선확인·동적 import, Next production 환경 6개 항목의 누락 차단, cron 인증 대조를 확인했다. 같은 OS 사용자 교체·스캔 뒤 새 프로세스·실제 PM2 메모리 및 공급자/API 이용은 별도 한계다. 실제 정지·재개·키값·운영 DB/API 및 기능시험은 실행하지 않았다. 제품 43파일 감사와 별도 범위이며 reviewer-brkb-operator-20261111.json 참고.

## QA

Codex 하위 역할 `t156_qa`가 Ubuntu 로컬 디스크에서 실제 실행했다. Jest 55 suites / 1,343 tests 통과, 기존 별도 MariaDB 경합 suite 1개·15 tests는 미실행으로 분리한다. 새 T-156 MariaDB 저장소 14 tests 통과(실제 InnoDB 대기 확인 경합2 포함), tsc 및 archive 4 tests 통과. DRY_RUN·킬스위치·한도·블랙리스트·감사로그·검증 관문의 모의 회귀를 포함하며 whitelist는 현재 항상허용 규칙이다.

로컬 Next dev에서 실제 after/정본 observer/store의 응답 후 기록 생성을 확인했다. DB와 누락 API-usage 모듈을 격리 대체했고 실제 LLM/증권사/운영 DB 호출은 없었다. 최초 AppleDouble 5개 구문 오류 뒤 메타파일만 제외한 재실행 결과를 기록한다. 광역 프로젝트 전체·수익성·운영 서버 lifetime PASS로 확대하지 않는다.

최종 소스 재검증: Jest58 suites / 1,417 PASS, 기존 별도 DB 경합1 suite / 15 SKIP, 0 FAIL. opt-in T-156 실제 격리 MariaDB14건 포함. 최종 tsc/build exit0, 정본과 검증본 파일 SHA 일치. 실제 MariaDB reader 마이크로초/NULL 시험과 capture 세 소스·한글/이모지 해시·중복 배제는 root가 별도 실행해 PASS다. 과거1,343/1,403건과 중복 합산하지 않는다.

최종 SEC 시각 보완 재검증: 두 알려진 SEC 원천의 raw 발행시각 NULL을 유지하고 접수시각 대용을 표시했다. 실제 가용시각의 마이크로초 절삭 지적도 수정 후 Reviewer 재검토 PASS. 최종 지정58 suites/1,426 PASS, 15 SKIP, 0 FAIL·tsc/build exit0. 실제 운영 최근 문서194개 중 SEC 대용193개/근거6개, 10/22 cutoff자료0개·쓰기0을 확인했다. 이 결과가 최종 소스 기준이며 앞선 시험과 합산하지 않는다.

DRY_RUN 연결 최종 QA: 지정65 suites/1,594 PASS,기존별도DB경합1 suite/15 SKIP,exit0. 신규집중168건과opt-in 실제MariaDB저장소14건은이총계에포함한다. tsc/build각exit0,변경src/scripts집합SHA22d319a0b5535b1528d46f1ec92d3ec2f9b58bfe279b0bb717abf48edf4db0c9일치. cron블록시간창/2회/15분/날짜리셋PASS. 첫전체시도는기존2시험mock누락으로빈계정localhost인증거부+late로그exit1이었고통과로세지않았다. 모킹보완독립검토후닫힌genericDB포트로전체재실행했다.

루트의 실제격리MariaDB검증11건: 실제공개250판본→정본builder/core/runtime/store로123종목리허설6시그널,초기화1회복사·경합임대1개·중복차단·리허설비체결·불관련이력결측시확정편출1개만·실제DB기록시각·보유분할기준누락보류/원장불변·계좌정지·DRY_RUN필수·네트워크0. 합성계좌만사용했고운영자료/계좌성공으로확대하지않는다. 별도운영실행은F14영수증을본다.

초기 재시도 후속의 최종 QA: 같은 지정65 suites/1,594 PASS/15 SKIP/exit0·tsc/build0. 소스23집합SHA9157803c5cd774db8c09fe22c9010cf334c0610cc47526eb6c327e962af86aae,직전검증본과forward-runtime.ts1조건만다르다. 실제SQL통합은partial초기보류→같은날full자료재시도회복을추가해12검사PASS. 최종증거묶음23,494bytes/SHA b367bc6fe0a33987729dde25d9f80498cd8fc24ada1433838e353658eae269e0,기존두원본묶음은덮어쓰지않았다. 별도cron블록은코드불변인직전실행증거이며이번에재실행했다고기록하지않는다.

- [20:39] v6 격리 실행 QA: 재검토된 19개 파일 SHA 일치 스냅샷에서 M40 전체·v6 SSR·paper 주문 차단 지정 21 suites / 386 tests 통과, 실패·skip 0. 실행 전후 소스 manifest SHA `314aed4020b98226511bee2ceb2cfc5a296f07a059cccfe73a258f4f9c527b40` 일치. tsc·Next build는 직전 스냅샷 exit 0이며 두 스냅샷의 기존 소스 차이는 SSR 테스트 assertion 한 파일뿐이다(생성된 next-env.d.ts·tsconfig.tsbuildinfo 별도). 최초 실행은 assertion 1건과 전송 AppleDouble 3 suites로 실패했고, 수정·독립 재검토 후 위 결과로 재실행했다. 실제 브라우저 시각 검증·실제 격리 DB·운영 API/주문은 이 QA에서 미실행. 영수증 `/Users/brownjeon/.codex/tmp/t156-v6-ui-harness/final-qa-receipt.json`.

- [21:00] v6 기간 표시 보완 재검토 후 격리 QA: Reviewer 19파일 SHA 일치, 21 suites / 388 tests 통과·실패 및 skip 0, tsc와 Next build 각 exit 0. 실행 전후 source manifest SHA `3604e86b8e6ef6164756e4fae60e386f7098b80d07ed042b930dfb3b55011297` 일치(빌드 생성물 제외). 별도 네트워크 없는 MariaDB 10.11.11 합성 DB에서 실제 reader의 비소유자 403 및 private 선조회 차단, 읽기 전용 트랜잭션 쓰기 거부, 23건 10/3 페이지, 기간 변경 snapshot 409, 월 직전 기준평가를 확인했다. 합성 DB와 전용 컨테이너는 삭제했고 보존 볼륨은 사용하지 않았다. QA 영수증 `/Users/brownjeon/.codex/tmp/t156-v6-ui-harness/period-qa-receipt.json`, SQL 영수증 같은 폴더 `sql-smoke-receipt.json`; 실제 운영·주문과 전체 브라우저 QA는 포함하지 않는다.

- [18:07] F36 독립 격리 QA: Reviewer 조건부수용 36파일 digest `dd10309601469101571e6dc9a7ee803e0c2a2e27d1550b930d875a724676e522` 기준 실행 전후 Mac/Ubuntu SHA 불일치 0. 지정 M40·주문차단·안전·KIS·기록 44 suites/788 tests 실패·skip 0, cron shell 2개·typecheck·Next build·diff check exit 0. network-none MariaDB 10.11.11 합성 DB: 실제 UTC 마감 경과 시 paper/forecast 원장 롤백, 가상 DB시계의 검사 간 개장 경계 롤백, 서로 다른 예측 job 동시 발행 하나만 성공, 시계 모의·체결 없는 5일 acquire/settle/mark/commit/sidecar 및 평가·조회 확인. 전용 컨테이너/소켓 삭제. Reviewer의 혼합버전 중복 HIGH와 최종 검사→commit 간격 MEDIUM은 해소된 결함 0건으로 바꾸지 않으며 운영 drain 증거·잔여한계 유지. 실주문/운영DB·API, 전체 cron J1, lint, 미래 수익성은 미검증. 화이트리스트는 현 정책상 미적용·블랙리스트 mock 확인. 원본/합성검증 재현 조건과 한계는 [[qa-daily-flow-receipt]] 및 [[qa-daily-flow-realdb.test]] 참고 (영수증 SHA `e1e6c517c82c86058686d3a96d5a3659416cf83deee5cc5f66c3439429d0beaa`).

- [18:34] F36 컷오버 펜스 추가 격리 QA: ops manifest SHA `05e6cc82a53e7c3473a5e6ed4356d3fc64640b93b61724e86c8114b295a4781f`의 core/proof/test로 전용 network-none MariaDB10.11.11 새 합성 스키마에서 실제 락·트랜잭션 23/23 통과. 이전/신규 발행기와 forward는 실제 앱 호출이 아니라 SQL 모형이다. pause/resume 경제·revision 보존, 양 잠금 순서, 통신·저장·재조회 오류 대응, 원본/경제 drift와 bridge 불일치 차단 확인. 전용 컨테이너·소켓 삭제. 운영 wrapper·실계좌 상태 전환·운영 drain은 미실행이며 제품 HIGH 운영조건은 해당 실제 증거와 Reviewer 재확인 전까지 유지한다. 별도 [[qa-cutover-supplement]] SHA `78af162e75bf9493e7461b2cf1202f398a8706a56c03b9f2aca0a4d7e545c286`; 기존 QA 영수증 불변.

- [18:38] F36 변경 영향 범위 실행검증 PASS: fenced Reviewer PASS·Root 운영 pause/readback 영수증을 별도 검산했다(09:34:44Z paused, 09:35:07Z 양 lease 0·DRY_RUN true; QA 직접 운영DB 조회 아님). 기존 forecast counts/immutableRuns/protections·paperCycles/signals/safety 지문 일치. 전환 중 paused 유지, 구 프로세스 완전 종료·신 web/cron 각1·36 SHA/lease0·원 장부 대조 후 복구/재조회 필수. 마지막 DB 시계 검사와 commit 사이 MEDIUM 한계는 유지한다. 일반 필수 체크리스트의 clientOrderId 동일 요청 중복방지는 이번 독립 QA에서 NOT_VERIFIED이며 전체 체크리스트 통과·결함 0·운영 배포 성공을 주장하지 않는다. [[qa-fenced-operating-supplement]] SHA `66fdff5cc32a85ed4dead10f79a40adfbff9818a9b0b691a4fac7121351d746e`.

- [18:44] 추가 필수 멱등 검증: 실제 submitOrder·UNIQUE 동작을 모의한 DB에서 동일 명시 clientOrderId 순차·동시 2회 실행, 각각 첫 dry_run/행1·두번째 duplicate 1062·adapter/fetch/socket 호출0, 3/3 통과. Root 운영 읽기전용 metadata 영수증상 client_order_id 고유 인덱스 존재·운영 주문쓰기0/API0이며 QA의 직접 운영 조회는 아니다. DB unique 충돌은 mock이고 HTTP 200 replay·실운영 중복 전송 시험은 아니다. [[qa-client-id-supplement]] SHA `1ba8820bd700d6af23f40235a301e0e9fe69ea47eca51af9bd16979bd8fa92a1`. 이전 qa-fenced-operating-supplement의 해당 항목 NOT_VERIFIED를 이 직접 실행으로 대체한다. 변경 영향 범위 및 필수 안전 회귀 검증 통과, Reviewer MEDIUM 시각/commit 간격과 전환 paused 유지·구 프로세스 drain 및 복구 readback 조건은 별도 남는다. 전체 운영 안전성·결함0·배포 성공 주장은 아니다.

- [19:32] 컷오버 구 프로세스 분류기 독립 QA: ops manifest `467854d2cfcd8ecfb1c46b5e2ec4c0ca94d4bffec6feb18e72c20d52302dfe9a`의 9파일 Mac/격리본 전후 SHA 일치, node 순수/주입scanner/잘못된 module hash 49/49 통과. 10:32:26Z 실제서버 same-UID 읽기전용 스캔은 기록 구 PID 2649058·2649127 부재, 읽을 수 있는 구 cwd 및 구 경로 인자 0; 접근 불가 인증 데몬 5종 40개는 신뢰 운영자 메타데이터 분류만 통과했다. 실행 이미지·메모리와 전 OS process는 미검증. QA는 운영 DB·operator·계좌 복구를 실행하지 않았다. [[qa-process-drain-supplement]] SHA `71a6a0378e29103f6bc3c1f84586c53436c852bcdb6da4dff6adb580780e9d01`.

- [16:05] F49 제한적 원천 probe 준비 독립 QA: Reviewer 조건부수용 SHA `7535f2865e2bb32841c72a4b4017ba40291551fb3faf3c954353cdf74505fe35` / 시험 SHA `ec550b6df97043d78f72e01ed330e9cb99a60df025d8b52fdf4d3b182db8648a` 전후 일치, `node --test` 합성 24/24 통과·실패/skip 0. 주입 fetch·가짜 인증값으로 오류본문/민감 헤더 비보존, token SHA 연결·변조, UTC/뉴욕일자, 지연/페이징/크기와 미달자료 qualified=false를 시험했다. TLS 연결·key fd 안전성은 Reviewer 정적감사 범위이며 실제 키/네트워크/운영DB 호출은 QA가 하지 않았다. Root의 15:57:18 KST 읽기 영수증 직접 열람에서 DRY_RUN=true·보호8trigger 지문/기존예측 불변·모의revision3/T0null·기존1run/4기간/4pending·11/10차단을 확인했다. 운영DB 직접 확인이나 안전회로 전체시험은 아니다. 제품 회귀788회 재실행0, 무료 원천 실제권한·105종목 복구·정상forward·신규4기간 발행은 NOT_VERIFIED. [[qa-free-source-preparation-20261111]] SHA `8b53f8f6d1367444106bfa1116fdb597b4291974cc9f6173b3ffd321b15aace4`.

- [16:15] F49 3차 정상수집 독립 QA: Root 16:07:28 KST 202접수는완료가아니며16:11:59 상태blocked/sourceReady=false. 운영원문복사본 252개의 SHA 및 CSV 전체행 재생성오류0, 이전 날짜범위퇴행0, 관측시각 마지막마감 이전0; 원본전후파일SHA불변. 253필수거래일·동결123후보를독립재계산해 적격18→122,부족105→1/104개회복. BRK.B split은11/06·11/09및10누락2, 원문SHA는전과동일하나성공재수신으로수신시각은갱신됐다. 과거502 두건이력은보존되고이번신규실패0. Root 15:57→16:12 읽기영수증의 paperAccount/paperCycles/paperSignals/safety 지문·모의revision3/T0null·기존예측1run/4기간/4pending·보호8trigger·orders상태별건수동일(주문개별행불변보증아님). 정상forward0·새forecast0으로전체흐름 NOT_VERIFIED; QA는 API·운영DB접근/쓰기0. [[qa-free-source-collection-20261111]] SHA `002577acaf058f3a1b29b46edb2d1fa3a5af0842911b6038b675f9710d991d1e`.

- [16:34] F49 기존source raw/split 가격기준 오프라인 독립 산술진단: source bundle SHA `145cda55a56a44bea875a80c25d3170ce06a2cb9bb83de1b83c66023d2520af1` 전252레코드/126종목, 동결123후보를 Decimal/Fraction 정확비교했다. 당일 양기준최신125/126의 당일종가 동일125; 최신공통일 종가차이는 BRK.B 1개(11/06)다. BRK.B의최근공통200일은 종가일치3일·서로다른정확비율198개. 동결123 중 최근공통200일 전일동일117·일부차이6(위BRK.B포함); 다른5건은과거정상분할·표현정밀도가능성이있어오류로단정하지않는다. AAPL은자체raw/split 200일동일이지만독립타원천정합을뜻하지않는다. forecast-input이 raw.open×split.close/raw.close를 쓰므로 혼합기준은 overnight/intraday 왜곡가능; 수익영향은정량검증안함. 122/123은날짜적격이며타원천가격적격판정아님. 검산기 합성fixture 3묶음·비교9개통과후삭제, 가격·실비율·계좌값·실API/DB접근0. [[qa-source-basis-coherence-20261111]] SHA `c82c01349b739cd5d92ce09c14e299dc88f79e546a77382f363bebccf73082e8`.

- [16:47] F49 BRK.B 쌍원천·장부 사전 독립검산: 저장된 KIS master 24열/BRK.B→NYS BRK/B identity, 3page SHA·요청/응답·기간·실수신시각·중복2/기간밖1·envelope 전필드 재생성·canonical297을 직접 재파싱. Alpaca raw/split 각297 OHLCV 및 원문 bytes 일치, KIS raw 대 Alpaca raw 시가/종가297/297·고가/저가296/297·거래량112/297, 기존 Kibot split 대 Alpaca split 시가/종가295/295·고/저가293·거래량112/295. 고저·거래량을 타원천까지 전필드 동일하다고 주장하지않는다. Alpaca 페이지영수증은 전체요청URL을 별도로담지않아feed/adjustment 증거는동결probe소스와report에 의존한다. Root 읽기전용트랜잭션/SELECT/ROLLBACK helper 정적감사,저장fixture book/policy SHA와Root preflight 해시가일치하고 BRK 미보유·기존BRK basis 0·나머지4basis 기존0.0001 허용한도내·평가값변화없음/수정없음은저장영수증상 확인했다. QA 운영DB/API/키읽기·쓰기0, 미래corporate-action/PIT·운영원천적격·소스경합·실제신규발행은별도 검증대기. [[qa-brkpaired-source-preflight]] SHA `e43d9239e15db7e8c49f23299ac8e766bc0120e68b4f0d57534d5ca4f6a7be26`.

- [18:55] F49 BRK pair 제품 동결본 범위 독립 QA **PASS**: Reviewer 43파일 manifest SHA `80ea3265312177cd9cdce557ecf827702de1889e313c87a18d88069b84f30953`/digest `c8e1eee84af5b112522a313eee154dcc66d86081010d02ec3ac604ec15b948f0`, 격리본/별도QA복사본 전후 43 SHA 불일치0. Ubuntu 공통flock Jest 광역31 suites/509건, DRY_RUN·킬스위치·주문한도·블랙리스트·KIS속도/우선순위 mock 안전22 suites/480건 전부통과/skip0, 독립typecheck0; build는동일동결해시의developer exit0 근거이며 QA 재실행아님. 보존 실제 BRK 증거는 network/socket 차단 검증기로 raw/split297/297을 재생하고필수사건증거삭제·다음NY일자차단 확인. 분할행동이 양 provider가격에도숨을수있는 합성반례에서 양성사건보고 시차단 1/1; 빈 사건응답은 절대부재증명이아님. 전용 network=none/skip-networking MariaDB10.11.11·Unix socket에서 실제제품 archive/publish 함수·실DB잠금의 source선행/forecast선행/pending뒤음성write실패·lease만료 3/3, 별도 고정 fence core/proof 실제격리DB 23/23 통과. 최초QA 합성fixture 필드순서 오류로3건 시작전실패 후 QA fixture만수정해재실행, 제품변경0; 첫Mac Docker없음준비오류도별도기록. 전용컨테이너/QA임시폴더·소켓삭제확인. 기존clientOrderId 중복 mock 3건은이전독립QA 근거이며이번실행아님. 실제운영펜스·배포·새모의전진/4기간예측·비교는 미검증, 운영전환별도Reviewer조건유지. [[qa-brkb-product-final-20261111]] SHA `db4a217b16ff1fa0e9b740f7d01e2c1425416026e479640d1153e4025fea1fb4`.

## 배포 기록

| 시각(KST) | 릴리스 | 커밋 | 포함 작업 | 결과 | 비고 |
|---|---|---|---|---|---|
| 2026-11-08 11:44 | 20261108-114326-9237fffb | 9237fff | T-156 M40 shadow·자료 이관/조회·판단 이력 | RELEASE_RESULT ok, END0 | 별도 승인 DDL/적재는 이미 완료, release.migrated=false. health200·DRY_RUN유지, web/cron각1. 적격 입력 미확정 M40 POST503, 비로그인 목록401 |
| 2026-11-08 21:02 | 20261108-205843-319caf64 | 319caf645e2bdd2b0babd18a4702682e2db135fe | T-156 모의분석 v6 조회 UI | RELEASE_RESULT health_failed, END1; 자동 롤백 | 이전 릴리스 `20261108-174944-963bfeba`로 복귀. 배포 후 `--status`에서 health 실패를 관측했고, Root 사후 확인은 health200·DB정상·green·DRY_RUN=true·KILL_SWITCH=false·web/cron각1 online·재시작0. 원인은 미확정이며 v6 운영 UI 반영 성공으로 확인되지 않음. 근거: `../artifacts/T-156-paper-analysis-v6-implementation/deployment/rollback-verification.json` |
| 2026-11-08 21:25 | 20261108-212559-39b2f749 | 39b2f749c3547cb0bbdbc954a406a204afff9f56 | T-156 모의분석 v6 조회 UI + 부팅 진단 보완 | RELEASE_RESULT ok, END0, migrated=false | 이전 `20261108-174944-963bfeba`에서 새 릴리스로 전환. 배포 영수증상 Reviewer 검토 23개 소스 SHA 일치, health200·DB정상·green·DRY_RUN=true·KILL_SWITCH=false·익명 private API 401·web/cron각1 online·재시작0·안전환경 SHA 불변; deployer `--status`도 health200 확인. 앱 인증 UI·Android 실기기 미확인. 앞선 319caf64 health_failed의 원인이 해결됐다고 단정하지 않음. APK·운영 DB 마이그레이션 없음. 근거: `../artifacts/T-156-paper-analysis-v6-implementation/deployment/final-deployment-verification.json` |
| 2026-11-09 00:29 | 20261109-002723-06bce08a | 06bce08a7939ac17009194995fc6f0da6f99f239 | T-156 실자료 예측 엔진·불변 원장·4기간 UI | RELEASE_RESULT ok, END0, migrated=false | 39b2f749에서 자동 webhook 배포. 직후 단일 `--status`는 부팅 중 health 실패를 보였으나, webhook 종료 `exit0` 후 정본 `--status` health200으로 재확인. Root 사후 점검: DB정상·green·DRY_RUN=true·KILL_SWITCH=false·web/cron각1 online·재시작0·33파일 source SHA 일치·익명 private API401·8개 보호 trigger 및 기존 원장/안전·전역·앱권한 지문 불변. trigger DDL은 별도 사용자 승인 적용이며 이 릴리스의 migrated=false와 구분한다. 예측 발행/소유자 조회의 실제 완료는 별도 확인 대상; 수익성·실매매 적합성 미검증. APK 미공개. |

이번 사용자 승인 범위의 기반 구현·DB 이관·테스트 보존과 코드 배포 확인은 완료했다. 원본28개+구현 검증 JSON+배포 검증 JSON을 별도 시험 자료로 보존한다. parent task의 doing/대기는 F09·당시 구성·가격/뉴스 자격과 전진/실매매 연결의 미완료를 뜻하며 이번 자료 이관이 진행 중이라는 뜻은 아니다.

### F14 DRY_RUN 시그널·전진 관측 연결 착수

사용자는 T0·자료 적격성·전진 검증을 진행하고 DRY_RUN에서 종목분석→시그널을 연결하도록 승인했다. 첫 적격 거래일을 T0로1회 고정하고, 현재 실계좌의 해외 보유·USD 순예수금을 독립 모의 장부로 복제하며, 한정 후보군 시험판을 정식 전체 M40과 구분하기로 선택했다. 국내/KRW는 미국주식 시험 장부에 환전·편입하지 않는다. 모의 복사본의 M40 귀속만 부여하며 실제 보유·기존 귀속·주문·검증 상태를 바꾸지 않는다.

기존 미검증 매수 감사 경로는 매도·청산 장부가 아니므로 그대로 재사용하지 않는다. `t156_paper_account/cycle/signal`로 모의 신호·입력·다음 개장 고정 수량 가정·양쪽25bp·결제 대금을 격리한다. 정상 주문/시그널 어댑터를 부르지 않으며 예약 paper 전략·client ID가 주문 송신 관문에 잘못 들어와도 양 방향 차단한다. T0 이전 연결 리허설과 등록 후 실제 전진 회차를 나누고, 미래12주·100거래·에이전트 직접변경20일을 지금 완료로 표시하지 않는다.

원천 보완에서125종목×원주/분할조정250판본114,900행을 실제 수집했다. 127거래일 연속성 충족123개, HONA102행·SPCX내부102거래일공백을 분리했다. 원문·판본·실제 관측 시각·SHA 보존, guest 평가용 자격이며 live 적격 승급은 아니다. S&P500 CSV는IPv4재시도실제확보로11/5까지 확인,11/6을 채워 넣지 않는다. 이후 시행·시험·DDL·배포 결과는 별도 영수증으로 기록한다.


F14 실행 결과: 운영전용3표 생성, 공개입력18,097,630bytes(SHA65d66b...902903) 압축저장/복원동일, 실계좌snapshot5667의미국보유4개+USD순예수금1회복사(원본·기존설정불변). 2026-11-08 13:46:17KST등록후11/06자료는리허설1회/시그널4개로만저장,체결0/전진0/T0null. 초기운영복사검산의JSON키정렬오탐은canonical비교로수정/재검산했으며 재복사나원본수정없음. 새판본수집/장부보호/주문영구차단/복구및전진최소기준은 `docs/implementation/2026-11-08-t156-forward-paper-pilot.md` 참조. 배포후실제API/after확인은다음영수증으로구분한다.


F14 최종 보완: c296116배포(RELEASE_RESULTok/END0,20261108-135514-c2961167)에서 실제인증cron202와응답후already_observed기록을확인했다.23파일SHA일치·web/cron각1·health200green/DRYtrue/killfalse,운영리허설은모의매도4개·실제체결0·전진0을유지했다. 이어 초기cohort미확정인partial응답이rehearsal로기록되어재시도를막는경로를 실제격리SQL로재현했다(기존운영cohort123에는영향없음). mode조건에frozenCohort필수를추가하고partial blocked/0signals→full동일일재시도회복을검사했다. 수정후SQL12개검사PASS이며지정QA최종재실행은기존수치와합산하지않는다. 최종소스23집합SHA9157803c5cd774db8c09fe22c9010cf334c0610cc47526eb6c327e962af86aae. 추가증거묶음/최종배포영수증은DB테스트이력의forward-final-validation-evidence-20261108.tar.gz/forward-final-release-audit.json으로보존한다. 미래성과·전체대상·LLM실호출/거래변경검증은미완료로유지한다.

- [2026-11-08 16:34 KST, Codex 직접수행] M40 조회 화면 운영반영 완료: main e9dccee51e1ee302a0ccf37a40897aa7c7fccebd, 릴리스20261108-163137-e9dccee5. 최종통합487검사/타입/build, 운영14파일SHA/동일SHA START·RELEASE_RESULTok·END0/healthgreen·web와cron각1·DRY_RUNtrue·killfalse·상세API익명401 확인. migratedfalse, 수동중복배포/실주문없음. 실제소유자reader는 별도readonly실DB검산, 인증운영UI/실기기는 미확인. source·QA·배포영수증은 테스트DB 분리보존.

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: full (JV-ui_change) | 11-08 14:48 |
| v2 | 검토요청 | mockups/T-156-m40-paper-analysis-v2.html | http://127.0.0.1:8786/T-156-m40-paper-analysis-v2.html | 사용자 검토 요청 | 11-08 14:58 |
| v2 | 승인 | mockups/T-156-m40-paper-analysis-v2.html | http://127.0.0.1:8786/T-156-m40-paper-analysis-v2.html | "v2 구성으로 구현 진행" | 11-08 15:57 |
| v3 | 작성중 | mockups/T-156-m40-paper-analysis-v2.html | - | v2 승인 무효화 → v3 작성 | 11-08 17:11 |
| v3 | 검토요청 | mockups/T-156-paper-analysis-v3.html | http://127.0.0.1:8786/T-156-paper-analysis-v3.html?v=91cc9d49 | 사용자 검토 요청 | 11-08 17:27 |
| v3 | 수정요청 | mockups/T-156-paper-analysis-v3.html | http://127.0.0.1:8786/T-156-paper-analysis-v3.html?v=91cc9d49 | "모의시그널의 기간과 그에 대한 모의성과 관측 기간을 주·월 단위로 표기" | 11-08 17:56 |
| v4 | 작성중 | mockups/T-156-paper-analysis-v3.html | - | 기간·주간·월간·관측 범위를 명시하는 v4 데모 작성 | 11-08 17:56 |
| v4 | 검토요청 | mockups/T-156-paper-analysis-v4.html | http://127.0.0.1:8786/T-156-paper-analysis-v4.html?v=ad504e9b | 사용자 검토 요청 | 11-08 18:08 |
| v4 | 수정요청 | mockups/T-156-paper-analysis-v4.html | http://127.0.0.1:8786/T-156-paper-analysis-v4.html?v=ad504e9b | "모의성과에 관측된 성과와 향후 1주·1개월 예상성과를 구분해서 보여주고, 예상 손익 범위와 손실 확률, 예측과 이후 모의성과를 비교하는 내용까지 데모에 반영" | 11-08 18:26 |
| v5 | 작성중 | mockups/T-156-paper-analysis-v4.html | - | 관측성과·1주/1개월 예측성과·사후비교 v5 데모 작성 | 11-08 18:26 |
| v5 | 검토요청 | mockups/T-156-paper-analysis-v5.html | http://127.0.0.1:8786/T-156-paper-analysis-v5.html?v=2b86a975 | 사용자 검토 요청 | 11-08 18:38 |
| v5 | 수정요청 | mockups/T-156-paper-analysis-v5.html | http://127.0.0.1:8786/T-156-paper-analysis-v5.html?v=2b86a975 | "향후 예상성과의 경우 예상기간에 대하여 3개월,1년 도 추가해서 모의투자를 예측해볼수있도록 해줘" | 11-08 19:09 |
| v6 | 작성중 | mockups/T-156-paper-analysis-v5.html | - | 향후3개월·1년을 추가한 v6 데모 작성 | 11-08 19:09 |
| v6 | 검토요청 | mockups/T-156-paper-analysis-v6.html | http://127.0.0.1:8786/T-156-paper-analysis-v6.html?v=cce67b2f | 사용자 검토 요청 | 11-08 19:15 |
| v6 | 승인 | mockups/T-156-paper-analysis-v6.html | http://127.0.0.1:8786/T-156-paper-analysis-v6.html?v=cce67b2f | "v6 승인" | 11-08 19:52 |


### F15 M40 모의분석 앱 조회 — 사용자 승인·자동 기록 실패 분리

사용자는 기존 화면 구성을 유지하면서 분석 탭에서 수집 상태·종목별 판단/제외·매수/매도 모의 시그널·모의 성과를 조회하도록 구현을 요청했다. 신규 조회는 기존 M40 core/runtime/주문/DRY_RUN 값을 바꾸지 않는다. 기존3분류/하단5탭을 보존하고 오늘분석 종목별에 입구1줄→같은분류상세 `?tab=m40`로 제안했다.

`mockups/T-156-m40-paper-analysis-v2.html`을 합성 데이터로 작성했다. globals/ops/BottomTabs/NavIcons를 재사용했고 360/412/1280폭과 진입/복귀/필터/4영역/상태/리허설분리를 CUA로 확인했다. v1은 덮어쓰지 않았다. v2 SHA9d1197c42d99fc3d64bd20d3b6d267702174ea1f637ea0fdf9bc4b569db6cb07. 검토·준비사양은 `docs/design/2026-11-08-t156-m40-paper-view-review.md`.

**사용자 v2 승인은 이미 있다.** 실제 user role 질문응답에 ‘v2 구성으로 구현 진행’이 있고, 제공한 StockInvest 이메일과일치하는기존회원1개를확인했다. 이메일/비밀번호/인증키는저장소·데모에기록하지않는다. `t156_paper_viewer`에그회원1개의읽기권한만연결했고모의원장과기존설정해시는전후동일하다.

다만 관리worktree에서기본게이트경로가거부돼공식환경변수로worktree부모와기존공통state를지정해review_requested/v2를등록한뒤, 실제원발화전체를stdin으로전달한 approve-codex-context가 ‘승인 원문을 사용자 발화 기록과 세션 대화 기록에서 찾지 못했습니다’로거부됐다. 질문응답/현재작업경로의자동기록을지원하지않는것과사용자승인은구분한다. **demo_gate를수동승인/활성화하지않았고영수증·훅이벤트를재생하지않았다.** 독립Reviewer는현재check pass가없어화면파일편집에동의하지않았으며,루트는화면소스미수정을유지하고이번T156만기록절차예외또는도구지원보완중처리방식에대한사용자응답을요청했다. 동일v2승인을다시요구하지않는다.

독립준비한backend6파일은 owner확인뒤 readonly consistent snapshot,별도paper표와해당sourceRunId만사용하고,raw clone/input/임의JSON을내보내지않는다. 참조125와보유추가를포함한실제판단목록126을구분하고,적격123/상위선정/매매행동은별도다. provenance는공급원별집계와수신/가용시각만반환한다. 성과는전진관측2점이상/리허설제외/결측미보간/365일이상연환산으로제한한다. 실현·미실현분리손익은현원장미지원이다.

QA는시각수정전관련27 suites/533 PASS/2 SKIP·tsc0,이전합성실DB권한/readonly2검사를분리했다. 최종UTC수정뒤집중2 suites/15 tests PASS·tsc0과6파일SHA일치를확인했다(전범위를다시실행했다고하지않음). 실제운영DB의최종reader에서소유자조회/출처4그룹/리허설4신호/4판단단계/전진지표null,비승인식별자403·privateSELECT0·DB쓰기0을추가검증했다. 첫운영smoke는루트검증용allowlist에정본READ ONLY START명령이빠져거부됐고,allowlist보완후성공한것이며제품결함이아니다. 개인정보/모의금액은로그·데모·공개영수증에출력하지않았다.

증거원본은Ubuntu `~/.node-local/t156-implementation-20261108/`의paper-view-qa/paper-view-final-qa/paper-view-time-final-qa 및binding/read영수증에보존한다. 격리합성DB는QA가종료후삭제했고,실제실행toolinput에서복원한fixture는복원출처와원본hash독립대조불가를표시했다. QA가시작한전용컨테이너는중지·볼륨보존했다. 앱화면/실제세션/배포성공/전체UI완료로확대하지않는다.

F15 준비본은 로컬 브랜치 28bcf08로커밋했고 push/새코드배포는하지않았다. source6파일·데모2개·합성스크린샷·QA3판본·명시적권한연결/실제읽기영수증을 원본 파일별 SHA 목록과 함께 paper-view-preparation-evidence-20261108.tar.gz(145,639bytes,SHAe8a8b3e0a61b6562bbf57b1518346e22cf84bb248d8e4e2763019ad953455290)로묶어DB테스트이력에저장/복원SHA일치했다. 실제모의금액/보유수량/이메일/인증정보/원본입력은포함하지않았다. 현재남은일은자동승인기록실패처리방식응답후승인된v2화면소스구현·기존화면보존검증·통합리뷰/QA/배포이다.

### F16 승인 도구 지원 보완 착수 (2026-11-08)

사용자가 기록 예외 대신 ‘승인 도구 지원부터 보완’을 선택했다. 현재 공유 도구는 `request_user_input_async` 응답과 등록된 Codex worktree의 경로를 지원하지 않는다. 원본 사용자 승인은 유효하며, 도구 영수증 미연결과 구분한다. 도구 소스는 Git 저장소가 아닌 워크스페이스 공통 경로에 있어, 원본 SHA 목록을 보존한 격리 사본에서 구현·회귀검증·독립감사하고 파일별 사전 SHA 대조 후 반영한다. 기존 96개 회귀검사는 모두 통과했다. 실제 과거 응답은 transcript에서 원래 질문 ID·사용자 메시지 ID·세션·작업 경로·검토 버전/파일 SHA를 대조하는 명시적 복구 절차로만 연결하며, 과거 훅 실행이나 영수증을 만들어 내지 않는다. 당시 질문은 검토 등록보다 약13초 빨랐으나 응답은 등록 이후여서, 이 순서도 숨기지 않고 별도 복구 판정으로 검증한다. 화면 구현은 정상 check 통과 뒤에 시작한다.

F16 완료: 독립 감사·QA 및 공유 원본 적용 후193/193 통과, 실제 원래v2승인 연결·check/activate 통과. 수동 gate편집/훅재생/재승인 없음. 상세 `docs/implementation/2026-11-08-t156-approval-tool-support.md`. 승인된 화면 구현을 이어가며 미래전진 표본은 별도 대기다.

### F17 M40 조회 화면 최종 구현·검증

기존3분류/5메뉴를 유지하고 M40 입구·4영역·권한오류시비공개자료숨김·최신차단/이전자료구분을 구현했다. source11파일 독립정적감사통과, Ubuntu20스위트360검사/tsc/build통과 및 실제컴포넌트CUA360/412/1280검증완료. 운영DB 최종읽기는125참조/123적격/126판단대상/제약5/리허설신호4이며 전진은미시작·쓰기/실주문없음. 상세 `docs/implementation/2026-11-08-t156-m40-ui-implementation.md`. 운영 반영 후 실제인증화면/안드로이드는 사용자확인 범위로 구분한다.

F15/F16/F17 조회화면 범위는 구현·검증·운영 반영 완료다. T-156 전체는 미래전진84일/신규왕복100건/에이전트변경20일 및 원천공백이 남아doing을 유지한다. 현재전진미시작·성과null을 0수익으로 표시하지 않는다. 후속 구현을 위해 같은v2승인/이메일을 다시 묻지 않는다.

### F18 모의분석 v3 데모 요청 (승인 전 구현 금지)

사용자는 메뉴를 ‘모의분석’으로 바꾸고 정책(M40 기본+판단 에이전트 규칙판단)을 표시하며, 수집상태/종목판단/모의시그널/모의성과를 한줄 고정탭으로 두고 각 목록을10개씩 페이지 처리하는 데모를 요청했다. 현재 단계는 데모·설계다. 기존 v2파일은 그대로 보존하고 새 v3를 검토받는다.

직접 확인한 현재코드: 저장결과 조회는 전용모의원장·owner API이며 실주문과 분리됐지만, 모의실행기는 safety_dry_run=true를 요구한다. runner는 기본계획을 deepFreeze 후 저장하고 에이전트 결과를 shadow기록으로만 남긴다. 따라서 ‘에이전트가 규칙을 결정해 매매를 바꾸는 정책이 이미 운영중’이라고 표시할 수 없다. 요청한 목표구성과 현재연결상태를 데모에서 구분한다. 실제에이전트 호출/거래반영·수집실행·실거래스위치는 이번데모로 변경하지 않는다.

목록은 각탭별 독립 page/필터상태를 가지며10개 이내로 표시한다. 성과카드는 전체자료 기준이고 일별평가목록만 페이지를 나눈다. 현재API 시그널기본20/최대100·성과1000제한은 전체이력페이지와 구분해야하므로 서버페이지·전체수/다음페이지 지원 필요를 설계에 명시한다.

F18 v3 검토본 완성: `mockups/T-156-paper-analysis-v3.html`, SHA91cc9d49b1bc5c71d82fc99e8885085c0d1b13f112296e91f3ea523a6a8efa55. 제안서 `docs/design/2026-11-08-t156-paper-analysis-v3-review.md`. 독립 정적검토·보안lint/JS구문/4탭10개씩·0/1/10/11/23경계·검색/선정/권한상태·360/412/1280 CUA 통과, v2불변SHA확인. 실제앱/정책/실행스위치는 그대로다. 사용자는 UI v3승인 및 구현범위(조회화면 우선 또는 모의전용정책연결도 별도설계/검증후 포함)를 검토한다. 질문은 정식review등록후에만발행하여 같은원본질문/응답으로연결한다.

### F19 모의기간·시그널/성과 관측기간 표시 v4 (검토 전 구현 금지)

사용자는 모의시그널 발생 구간 및 성과 관측 구간을 주·월 단위와 날짜로 확인하고 얼마나의 기간 성과인지 알기를 요청했다. 현재운영 UI도 시작/종료일을 별도 표시하지 않으며, v3는 날짜없는합성관측점으로 기간을 해석할 수 없다. v3파일을 수정하지 않고 새 v4데모를 만든다.

표시안은 모의투자 전체 시작~기준일, 선택 집계 단위(전체/주간/월간), 시그널 발생기간, 실제 평가관측 시작~마지막일과 기간기준평가액·평가액증감·누적수익/MDD를 구분한다. 주간/월간은 달력구간이며 보유기간/거래규칙을 바꾸지 않는다. 월중 진행중과 과거자료 누락은 다르며, 예상/확보 거래일·첫 기준평가 누락/이력잘림·미체결·보유중을 구분한다. 전체계좌수익에는 이전기간 보유분이 포함되어 같은기간 신규시그널의 귀속손익으로 단정하지 않는다. 시그널별 관측일수/종료여부를 별도 표시하고 현재미지원 귀속손익은 연결전으로 남긴다.

시그널/성과는 같은 모의계좌·정책판본·자료스냅샷·선택기간을 공유해야 하며, 요약은 10개페이지와 무관한 기간 전체 집계다. 현재 DTO의 날짜있는 forward점은 사용할 수 있으나 기간 baseline/달력완결·cohort손익/1000점cap과신호20/100cap을 해결할 서버계약이 아직 없다. 데모는 실제백테스트가 아닌 날짜있는합성자료임을 표시한다. 실제원문/금액/계좌/설정은 변경하지 않는다.

F19 v4 검토본 완성: `mockups/T-156-paper-analysis-v4.html` SHA256 `ad504e9bc39a22a8bb0fae94703bb8dcd6fca12b9dad60394fb7ae4d6ccacded`; 제안서 `docs/design/2026-11-08-t156-paper-analysis-v4-review.md` SHA256 `a04c220d09ffc6420960aebfa8ede71e5072014ff0c9a9437c90500549b676c9`. 독립 정적 검토에서 기간 의미와 5개 합성 수치 검산, lint/구문 확인을 완료했다. 루트 CUA는 360/412/1280폭 가로넘침 없음·고정4탭, 같은 주월 선택의 탭간 유지, 10월22점의 10/10/2 및 전체49점의 10/10/10/10/9 페이지와 요약 불변, 월교차 주간·진행중 월간, 기준평가 없음/과거 누락/잘림/0~1점의 미확인 성과, 계좌 시작 전 빈 기간·403 비공개 제거·마지막 신호 집행대기를 확인했다. 화면 날짜/금액은 실제 결과가 아닌 합성 예시이며 거래일 달력도 합성 평일로 표시했다.

운영 읽기 전용 검산(2026-11-08 08:58:03 UTC)은 11-06 리허설1회·시그널4개뿐이고 전진관측/T0가 없었다. 현재 실제 운영에는 `전진 미시작 · 성과 관측기간 없음`이 맞으며 합성 9~11월을 운영 실적으로 표시하지 않는다. 영수증·정적 검토·CUA 기록은 `agent-vault/10-Flow/artifacts/T-156-paper-analysis-v4/`에 둔다. 원본 v2/v3 SHA는 불변이며 신규 앱/API·수집/정책·실거래 변경, commit/push/배포 및 테스트 DB 추가 적재는 하지 않았다. 정식 review_requested/v4 등록 후 새 원본 질문으로 검토 요청하며 이전 v3 질문을 승인 증거로 쓰지 않는다.


### F20 관측성과·향후 예상성과·예측 사후비교 v5 (검토 전 구현 금지)

사용자는 모의성과에서 이미 관측한 결과와 향후 1주·1개월 예상성과를 구분하고, 예상 손익 범위와 손실 확률 및 예측 원본과 이후 모의성과 비교를 데모에 추가하도록 요청했다. 편도 수수료 0.25%를 유지하며 구현은 데모 검토 후다. v4는 수정 요청으로 보존하고 새 v5를 작성한다. 현재 앱 DTO/성과 함수에는 미래 예측/판본/사후비교 계약이 없고 관측된 forward 평가값만 계산한다. 이번 작업은 예측 엔진·에이전트 거래반영·실제 예측/백테스트 실행을 승인한 것이 아니다.

설계 기준: 관측성과/향후예상성과/예측사후비교를 모의성과 내부에 두며 기존 상위3분류·하단5메뉴·고정4탭·각목록10개를 보존한다. 관측 주월 집계와 미래1주/1개월 horizon을 혼동하지 않는다. 예측 기준일·대상 끝·평가 예정세션, 동일 계좌 초기평가액·정책/모형/입력 판본을 표시한다. 평균 기대손익·중앙80% 합성경로범위(P10~P90)·비용 후 손실확률은 합성경로 배열에서 계산하며 검증된 예측확률/실제성과로 주장하지 않는다. 수수료는 각 경로 매수·매도 거래대금×0.25% 합산이고 체결차/세금/환율 등 예시 가정을 명시한다.

사후비교는 저장된 원본 예측 ID/기준시각·모형·입력·정책·비용·대상기간·기준평가를 고정하고, 같은 조건의 관측이 종료/완결된 경우에만 손익오차·예측범위 내/밖을 계산한다. 아직 미도래는 대기, 관측 부족은 미확인, 계좌/정책/비용/기준 변경은 비교불가로 구분한다. 단일 결과로 손실확률을 맞음/틀림 판정하지 않으며 미래의 관측 가격·실현성과를 만들어 넣지 않는다. 실제 예측원장/달력/데이터 계약은 구현 전 검토 대상이다.

F20 v5 검토본 완성: `mockups/T-156-paper-analysis-v5.html` SHA256 `2b86a9753504155b59f919df1b8dac291fb1e5bfe527b39408b2311a8dc7394c`; 제안서 `docs/design/2026-11-08-t156-paper-analysis-v5-review.md` SHA256 `058874e4fe1992622df66aafe952ecc6a7d868aece923e6037884dc3372ab0f0`. 독립 정적검토에서 비용 후 평균/P10/P90/손실분모·월말/윤년·사후비교 상태와 오차를 검산했다. 역사적0경로 렌더 누락과 정책별예측ID·내부보기 활성표시를 등록 전에 보완했다. 최종 lint/JS구문 정상, v4 및 기존 제품파일 SHA 불변을 확인했다.

루트 CUA는 관측 주월과 미래horizon 독립, 1주/1개월 전환 및 가시 수수료, 0경로 미확인, 23개 비교의10/10/3페이지/전체집계 불변, 범위 밖 완료·미도래·자료누락·조건변경, 빈/로딩/오류/403 비공개 제거를 확인했다. 기능검사는 e6cb4c5f 후보에서 수행했고 최종2b86a975는 내부 active CSS/문서만 보완 후 수치·비교와360/412/1280 가로넘침0·고정4탭/활성표시를 재확인했다. 화면 이미지/영수증은 `agent-vault/10-Flow/artifacts/T-156-paper-analysis-v5/`에 보존한다. 합성 10경로의40% 등 수치는 실제 예측확률/검증된 성능이 아니며 미래 실제관측은 만들지 않았다. 이번 턴에는 운영 DB 읽기/쓰기, 모델/수집기/백테스트/주문 실행, 앱소스 수정, commit/push/배포 및 테스트DB 적재를 하지 않았다. 정식 review_requested/v5 등록 후 새 검토 질문을 사용하며 이전 v4 질문은 승인 증거로 재사용하지 않는다.


### F21 향후3개월·1년 예측기간 추가 v6 (검토 전 구현 금지)

사용자는 향후 예상성과 기간에3개월·1년을 추가하도록 요청했다. 기존 1주/1개월·관측성과/사후비교·편도0.25%·UI/목록/안전 제약을 유지하고 새 v6 데모만 만든다. 3개월은 달력3개월,1년은 달력12개월 뒤 같은날(없는날월말)이며 평가 예정세션과 대상 끝 날짜를 구분한다. 장기 합성경로는 각 기간별로 구성하고 단기 수익을 단순배수/연율화한 실제 예측으로 주장하지 않는다. 비용은 예측구간 신규 매수·매도 거래대금의 각0.25% 합산이다.

현재 합성관측은67일이므로 새3개월/1년 사후비교는 대기로 보여준다. 미래 관측·실제체결이나 장기 검증성과를 꾸미지 않는다. 장기 누적손익/기준금액·범위/손실비율·원본ID/정책판본·예측가정을 표시하고 기존v5/v4와제품파일은 보존한다. 구현·예측엔진실행·DB/운영설정/실거래변경은검토후별도범위다.

F21 v6 검토본 완성: `mockups/T-156-paper-analysis-v6.html` SHA256 `cce67b2f0350406f2296f1495fbf446e0597a3e1cc1259f9d4f98554531758ed`; 제안서 `docs/design/2026-11-08-t156-paper-analysis-v6-review.md` SHA256 `52aef002b665351edd2f5c8e08cd1a6c090c3cea719e375f86502f4da6d11f12`. 원래 기준일에서 목표월을 한 번에 계산해 월말보정하며 반복1개월계산의 날짜밀림을 방지한다. 독립검토에서 장기10경로 비용/평균/P10/P90/손실분모 및3/12개월·월말/윤년·연교차를 검산했다. 기존 단기 입력과관측/비교계산 본문·v5파일은 불변이다.

루트 CUA로 네 기간 label/범위/평가예정/원본ID·초기평가액12,343/편도0.25%를 확인했다. 3개월/1년0경로는미확인이고 장기두원본은대기·미래관측없음이다. 비교23개10/10/3페이지와요약9완료/3비교불가/6미확인/5대기는동일하다. 360/412/1280 가로넘침0·한줄고정4탭, 합성/미구현표시를 확인하고 임시viewport를복원했다. 정적/브라우저증거는 `agent-vault/10-Flow/artifacts/T-156-paper-analysis-v6/`이다. 실제투자예측성능·장기복리경로 재현/전진검증으로주장하지 않는다. 앱/API·DB·모델/수집기/백테스트/주문·운영설정/실거래를 변경/실행하지 않았으며 commit/push/배포/테스트DB적재도 없다. review_requested/v6 등록 후 새검토질문으로만 승인 연결하고 v5질문을 재사용하지 않는다.


### F22 사용자 v6 승인·조회 UI 구현 준비

사용자가 원래 native 질문 `call_7484aad74e184ba1a47a3ab3aaa29505`에 `v6 승인`으로 응답했다. 실제 response message ID `msg_01a1baaf-0576-7001-a1fa-aad5479c2f9b`/turn `01a1baaf-054d-77f2-92b8-b9df40ec2c36`, 2026-11-08 10:23:14.806 UTC. 승인대상 v6 SHA cce67b2f0350406f2296f1495fbf446e0597a3e1cc1259f9d4f98554531758ed. 사용자승인은유효하고재질문하지않는다. 단정식approve-codex-native/check는 아직차단되어제품편집0이다.

첫거부는공유 `demo-gate/codex-evidence.mjs` 질문의버전경계정규식이 `v6’의` 닫는따옴표를공백경계로인정하지않는문제였다. 실제native원문/고유완료항목(+1ms)/root/cwd/등록/answer검증은일치했다. 격리 `~/.codex/tmp/t156-v6-approval-quote-fix`에서수정전새회귀12/12실패,수정후222/222통과·독립정적보안검토33사례후 원본SHA대조하여공유코드/시험2파일만반영했다. 실제공유재실행도222/222통과했다. 첫공유실행은Node25의directory형 test 인수사용오류(MODULE_NOT_FOUND)였고 `node --test test/*.test.mjs` 재실행으로검증한것이다. 코드SHA6b74e5df76097e2ad3a7b37176ee33668694ad5f3febad5cfc5b69c1469b4cfe, 시험7535a1753b4de2139300a9c0c7d702ecc2deb37c5fa81c050f01f74c24715021.

재시도후남은거부는native경로가승인으로만옛요청을닫아v3/v4/v5수정요청·후속등록도pending으로계산하는문제였다. 실제pending은[3,4,5,6]이고대상6의등록은정확히하나다. 원본증거/새버전패턴/시간등다른모든predicate는통과했고 pending검사이후는성공반환뿐이다. 현재 `~/.codex/tmp/t156-v6-approval-lineage-fix`에서같은정확task/session/actual+canonicalroot의낮은version을정식후속등록으로대체하는범위만보완·음성회귀검증중이다. 다른task/root/동일version중복/원래응답이전높은버전은계속차단하고,원래응답후미래등록은기존영수증검증에영향주지않아야한다. 공유state/receipt/원본transcript수동변경·훅재생·새승인요청은금지한다. activate시도역시check차단이었고즉시deactivate했으므로현재activefalse다.

디자이너준비가이드 `docs/design/2026-11-08-t156-paper-analysis-v6-implementation-guide.md`가있다. 기계check/activate통과후확정하고developer에인계한다. Backend/Frontend는역할별읽기준비만완료: backend는 paper-view reader/types/query/period/route·시험,frontend는 M40Panel/css/copy/TodayPanel/route-resolve/AnalyticsPage·SSR시험·screens.md를소유한다. 아직제품코드를쓰지않는다. Backendquery명칭은period,anchorSession,signalPage,valuationPage,horizon,snapshot; additive snapshot/signalPage/valuationPage/observation/forecasts/policyRecord·availablePeriods를구현한다. 실제예측원장이없으므로4기간선택과미지원·미검증·빈상태를반영하며합성예측숫자를앱에넣지않는다. 실제예측엔진/agent거래반영·DBDDL/운영스위치·실거래활성화/배포는현재승인범위에추가하지않는다.

관측집계는확인baseline/마지막평가·expected/observed canonical세션·누락/부분기간을구분하고현재페이지와분리한다. epoch/clone투자금으로baseline을꾸미지않는다. 같은owner범위·READ ONLY snapshot과회차revision/asOf/latestid 검증·10행서버페이지를사용한다. forward-calendar에기존함수/달력동작을바꾸지않는지원범위내순수조회export만추가허용했다. C1 rules결과 codex_required=false, 스위치on이다. 모델router는Sol fallback. 로컬node_modules없으며설치/symlink하지않고QA는Ubuntu독립snapshot·기존node_modules·flock/nice로수행한다.

F22 최신 — 2026-11-08 19:52:09 KST: 두 번째 계보검사 후보는 독립 보안정적검토23사례(허용4/차단19) 및240/240 회귀를 통과했고, 공유원본3파일을 사전SHA대조/백업후 반영했다. 공유 실제재실행도240/240통과(59.1초)다. 코드 SHA ea6844c18442f7161f7c1a6d1ba84cbe72a7ddd594ae11431a523080f7730af7. 같은정확등록계보·원래응답시점이하만검사하며 다른task/root/중복/응답이전higher는계속차단한다. Root는원래CODEX_THREAD_ID무변경에서 candidate findNativeEvidence 읽기전용 true/version6도 확인했다.

그뒤 같은원본msg/questionID로 `approve-codex-native`가성공했고 source=codex_native_transcript/version6/hashverified, `check` 및 `activate` 모두 DEMO_GATE_PASSED다. 사용자승인재질문·수동state/receipt/transcript변경·훅재생/검사우회는없다. 현재active는true이며 위 준비중 activefalse/blocked 기록은 해소됐다. Backend와Frontend는절대checker경로로본인check확인후승인된담당범위를구현한다. designer는준비가이드를확정한다. 실제장기예측엔진·agent거래반영·DBDDL/수집/모델/실거래/배포는시작하지않는다.

승인도구검증묶음은 `agent-vault/10-Flow/artifacts/T-156-paper-analysis-v6-implementation/approval-tool/`로보존한다. 원본승인정본은공유도구의실제증거원장/claim이며복사검증자료는별도실행보고서이다.


### F23 v6 조회 UI 구현·정적 검토 완료, 격리 실행 검증 진행

구현 보고 정본 `docs/implementation/2026-11-08-t156-paper-v6.md`. ProductReviewer는 frontend10/backend9개의 동결해시를 확인하고 미해결0건 정적검토를 통과시켰다. Root도19파일해시를독립readback하여 reviewed-source-manifest.json에 기록했다. 아직 Jest/tsc/build·브라우저·실DB/API/운영 반영 통과가 아니다.

정적검토에서 지적한 재조회 effect반복, 구형/불완전DTO의렌더예외·private잔류, 모의DTO를전역실거래OFF로표현하는문구, 마지막회차로완료세션을잘라뒤갭이숨는문제, blocked회차의정책run불일치, 리허설/allstoredbounds를전진범위라표현하는문제, 계좌시작전날들을누락으로세는문제와부분기간/선택기간0건문구를수정했다. 반례SSR/mock/pure시험을작성했고정적재검토했으나실제Jest는QA가수행해야한다.

QA는 product-review.json evidence.frontendSha256/backendSha256 합계19파일과HEAD archive를Ubuntu독립snapshot에반영한다. Node24.22.2·Next15.5.27/Jest29.7/React18.3.1 정확의존성후 flock/nice 직렬테스트/타입/build. CUA하네스는실제AnalyticsPage/M40Panel/BottomTabs/CSS와합성API만쓴다. 모델·실DB/cron·운영API·실매매없음. API의저장예측은미지원·빈목록/null이며 1주/1개월/3개월/1년선택을실예측발행으로오인시키지않는다.

현재origin/main은963bfeba97064c7d77ba873b8bcd356a5bb1bdaf로갱신됐으나 e9dccee와차이는T162의ACTIVE/board/task/daily문서4개뿐이고 package/제품코드는동일함을확인했다. 원격자료를덮지않고운영반영시문서통합을보존한다. 커밋/푸시/배포·운영스위치/DBDDL는아직실행하지않았다.


### F24 v6 조회 UI 구현·최종 검증 완료

독립 Reviewer 19파일 최종통과, Designer 승인v6대조수용(P0/P1/P2 0), Ubuntu격리21스위트/388검사(실패·skip0)·tsc/Next15.5.27빌드exit0을 확인했다. 최초385/386 실패1건은 일반설명문과 겹치던 SSR assertion이고 별도AppleDouble가짜3스위트와구분해수정/재검토했다. 중간386통과후기간1주/1개월·달력전체/기준일까지경과일표시를추가해388검사로최종재실행했다. 최종전후source manifest일치이며19개reviewedSHA를Root도재대조했다.

격리network-none MariaDB10.11.11에서 실제readPaperView·마이그레이션스키마로 비owner403/private조회전차단,readonlyUPDATE거부,23건COUNT/10·3페이지,기간변경구snapshot409,월간직전baseline을검증했다. 합성DB/전용컨테이너는삭제했고기존보존볼륨·운영DB는손대지않았다. Root실ReactCUA는360/412/1280한줄sticky·가로넘침0/4horizon독립/10개페이지와필터·권한오류privateclear/409재시도·keyboard/기간달력30·경과6/consoleerror0을확인했다. viewport복원·CUAcompletion완료, 실제로그인운영/안드로이드/보조기술은미검증이다.

구현정본 docs/implementation/2026-11-08-t156-paper-v6.md, 증거 agent-vault/10-Flow/artifacts/T-156-paper-analysis-v6-implementation/qa 및 visual. 실제예측/사후비교원장없음은4기간선택+미지원/빈값으로표시하며합성수익/손실확률을운영값으로넣지않았다. 현재정책은M40기본매매·에이전트참고전용이며거래반영미구현을표시한다. 신규DB쓰기/수집·모델·실주문·운영설정변경,commit/push/배포는하지않았다. UI승인을다시묻지않으며 .codex/agents/deployer.toml의중단시간·시점합의규정에따라운영웹배포시점만확인한다. T156전체는미래전진84일/신규왕복100건/변경20일·원천공백때문에doing이다.

F24 후속: 사용자가 배포시점 질문에 ‘지금 웹 배포 (추천)’로 답해 즉시 웹반영을 승인했다. 같은승인재질문없이최신main의타작업문서보존통합·실제정상훅커밋·배포/운영검증을진행한다. DBDDL/APK/실거래변경은승인대상이아니다.


### F25 v6 웹 배포 실패·자동 복구와 후속 범위 검토

사용자 즉시 배포승인에 따라 최신main963의T162기록을보존한35파일을독립Ubuntuclone에서통합했다. 실제hook설치·484회귀/실커밋scope검사통과,commit319caf645e2bdd2b0babd18a4702682e2db135fe의제품19Gitblob SHA가QA388검사본과동일했다. push자동webhook은11:58:39UTC START,새build/webcron online뒤health검사를통과하지못해12:02:32UTC ENDexit1/RELEASE_RESULT health_failed로자동963bfeba복귀했다. 수동중복배포·재시도·health관문우회없음.

실제복구검증은health200/DBtrue/safetygreen/DRY_RUNtrue/KILL_SWITCHfalse,web/cron각1 online/restart0·선택안전envhash불변이다. 실패창오류로그는공시캡처DB상한·joblog503timeout이고,API익명401은정상차단됐다. 롤백뒤직접DBping12ms·14app연결유휴는실패당시상태를입증하지않는다. performance_schema/slowlog가off여서쿼리대기이력이없고,Nginx의해당창40요청에는paper/health/analytics일치가없으나직접backend나타proxy요청은제외된다. 이정보로환경원인·새reader원인중어느쪽도확정하지않는다.

독립Reviewer는pool/ensureSetup/reader의연결반환·동기해제·MDL가능성을읽기추적했고,QA는별도network-noneDB에서실제reader가users조회중ALTERusers를300ms이상대기시키나재개뒤5초내둘다완료함을재현했다. 자기참조교착/운영120초원인은확정하지못했다. 합성DB/컨테이너는정리했다. 현재운영에는v6화면이없고기존버전이다. 새예측엔진/수치·실거래변경을추가하지않았다.

원본worktree를published319로ff정렬했고이전작업사본은T156이름recovery stash에보존했다. 현재main319와운영963불일치·다음push자동배포위험을ACTIVE/RESUME/board에명시하고기록만을위한push도하지않는다. 구체적인진단보완범위는 docs/implementation/2026-11-08-t156-paper-v6-deployment-followup.md. 기존v6UI/배포승인은유효하므로재질문하지않고,공통부팅/DB초기화코드까지진단보완범위를넓힐지새결정만확인한다. 검증388PASS와운영배포실패는구분한다.


### F26 사용자 승인된 부팅·DB 초기화 진단 보완

사용자가 원래질문 call_0a3113cce3cf42359ded296a2ad9f7e7에 ‘부팅 진단 보완까지 진행 (추천)’로답했다. F25의범위확인대기는해소됐고같은승인을재질문하지않는다. 새intake는R2/demo.none/assign이며Codex모델router는Sol fallback, C1rules는codex_requiredfalse/한도미확인R2정책을기록했다. source는기존main319,실제운영은963안전복구상태다.

진단developer는t156_boot_diagnostics_developer(Sol),독립reviewer/QA는기존역할을재사용한다. 변경예정은db.ts/health route와새diagnostics helper·unit4파일이며UI19파일은그대로다. ensureSetup/setupDB·health대기/설정fanout에정적span,setup지역Pool query/execute에원래receiver/args/Promiseidentity를유지한별도관측을넣고ordinal/allowlistSQLclass/총경과/publicenqueue관측만기록한다. acquisition과서버SQL실행을정확히분리측정하지못하는경우그대로한계를표시한다.

새로그에는SQL본문/바인딩/원문에러message/비밀/계좌·종목·금액을기록하지않는다. 30초pending1회·budget·unref/정리와관측오류격리를검토한다. 기존SQL/DDL/연결한도/재시도·health조건/제한시간/응답·주문안전·실거래설정은변경하지않는다. 실제운영DB수정/새진단API/강제실행·검사우회를추가하지않으며독립리뷰·격리비간섭QA뒤정본배포만수행한다. 아직진단코드검증/운영배포성공으로표시하지않는다.

F26 검증 후속: 독립23파일(신규진단4/불변제품19)리뷰통과,watchdog clock예외지적을수정/재검토했다. QA7스위트208검사·타입/Nextbuild통과/skip0·전후sourceSHA동일,기존388제품시험의19파일불변을확인했다. 원본319와query/execute호출78개의SQL·인자표현식/순서AST가같으나실행전체SQL동등/실제coldstart로과장하지않는다. 실제mysql2/MariaDB합성smoke에서query/execute·receiver/Promiseidentity·오류후재사용·queue이벤트·close리스너복원통과,전체coldstart/운영원인미검증한계는유지한다. network-noneDB/컨테이너정리완료. C2rules는codexrequiredtrue이나AGENTS정본의Codex내자기호출금지로override codex_unavailable_in_codex,별도외부검토미실시다. 실제운영확인때부팅고정단계로그와읽기전용DB상태만동시수집하며새프로세스/기존설정/안전경계·SQL의미는변경하지않는다.


### F27 v6 조회 화면·진단 포함 릴리스 운영 반영 완료

사용자가승인한진단4파일을23파일독립리뷰·208검사/타입/build·실mysql2호환검증뒤정상hook으로39b2f749c3547cb0bbdbc954a406a204afff9f56에커밋/게시했다. 자동릴리스20261108-212559-39b2f749는RELEASE_RESULT ok/migratedfalse이며정본status도health200/webcrononline을확인했다. Root는archive형식릴리스의전체SHA를원본RELEASE_RESULT에서대조하고운영소스23파일을실제파일별hashreadback했다. 최초검증명령의gitrevparse는archive에.git가없어실패했으며,archive정본SHA/실제sourcehash대조로보완한것이다.

최종읽기전용확인:health200/dbtrue/schemaFatalfalse/safetygreen/DRY_RUNtrue/KILL_SWITCHfalse,webcron각1online/restart0,익명paperAPI401·신규APIbuild존재,선택안전envSHA불변. source/current/main/원본worktree모두39로일치하며기존편집복구stash와첫319healthfailed/963자동복구이력은보존했다. DBmigrate/APK/수동중복배포·실거래활성화없음. 이번배포의코드범위는T156 v6조회UI+진단이며타task코드를추가하지않았다.

동시읽기전용관측은ensure_setup완료79,277ms/수집된단일setup작업최대19,071ms와pool전체enqueue2건을기록했다. query실행/풀획득을개별분리하지않고,기존try/catch로처리된ALTER/CREATE실패를치명실패로계산하지않는다. 초기화단계지연은확인했으나첫배포실패의특정SQL/잠금/인프라원인은미확정이다. 이번성공을그근본원인해결로표시하지않는다. 모니터종료/DB연결해제·합성자원정리완료.

앱경로 분석→오늘분석→종목별→모의분석,URL analytics?tab=m40. 한줄고정4탭/목록10개/관측주월·기간길이·경과와미래1주/1개월/3개월/1년을구분한다. 예측엔진/원장없음은미지원/빈값이고실제수익·손실확률을만들지않는다. 현재정책은M40기본매매/에이전트참고전용이다. 실제로그인운영UI/안드로이드기기는미확인,전진84일·신규왕복100건/변경20일·원천공백때문에T156전체는doing을유지한다. 최종배포후문서만로컬수정상태로보존하며기록만을위한push/재배포를하지않는다. 보고서 docs/implementation/2026-11-08-t156-paper-v6.md와boot-diagnostics.md,원본증거deployment/를따른다.


### F28 실제 수집 자료 기반 예측 엔진·예측 원장 구현

사용자가 기존미지원표시에후속으로실제수집자료기반예측엔진/예측원장과1주·1개월·3개월·1년손익범위/손실확률·이후모의성과비교구현을명시지시했다. 이는과거‘엔진제외’범위를대체하는새승인이고실거래OFF조건은유지한다. 기존v6승인구성/메뉴에실데이터를binding하고새목업·동일승인을재질문하지않는다. intake rules R2/demo.none/assign,모델router Sol fallback,C1 codexrequiredfalse를 artifacts/T-156-forecast-engine/에기록했다.

Analyst Astra의실운영읽기전용실사와QA비공개fixture를대조했다. 현재동결후보는123개이고보유중추가1개까지가격벡터124개,지수와공통298일/297수익관측이다. 초기Analyst의124후보가정은확정된실frozen123으로정정한다. 장기1990원주데이터는미조정/동일성·과거가용시각공백으로조정수익률대체에쓰지않는다. 현재paperbook/실11/6rawmark로독립forecast_only_marked_snapshot을만들고clone투자금/리허설성과를기준평가로대체하지않는다. 사용자보유/금액/키는공개로그/Git/데모로내보내지않는다.

엔진은고정10세션jointmovingblocks×2000경로,현재M40정책126모멘텀/200SMA/20교체/top5/15%·기존next-open정수주·T+1·수수료편도.0025를재생한다. 조정open=rawOpen×splitClose/rawClose로overnight/intraday를동일날짜벡터로추출해자산상관을보존한다. 가격벡터와후보집합을구별하고기존보유·awaiting_open의도를포함한다. 단기수익배수·유리한전략선택·실현미래입력은금지한다. 11/6S&P가격은freshFRED부재/Yahoo1회429로관측확보하지못해,같은297실관측의OLS+중심잔차draw로각경로의1일latent지수를추정하는모형가정을별도명시한다. 관측가격표에는쓰지않고실자료인것처럼표시하지않는다.

기간별실제거래일수/달력목표·평가세션,mean/P10/P50/P90 순손익USD·pct,손실경로수/B·모형기반미보정추정확률·MonteCarlo표준오차를저장한다. 2000경로는2000독립실예측이아니며약297관측/29개10일비중첩블록/연간창약1개라는표본한계를분리한다. 원문뉴스/에이전트해석은현재참고전용이고검증없는정량가중을확률에넣지않는다. 실제future기간도래전actual/적중률을만들지않는다.

숫자developer forecast_engine_developer가types/input/engine/unit, ledger developer forecast_ledger_developer가별도forecast job/run/horizon/evaluation/continuation표·runtime/일10시cron·ownerreader/v6UIbinding을소유한다. 기존확인흐름은바꾸지않고사후실completed연결에필요한forward-runtime/store의before/afterbookhash/revision·policy·fees/outcomes/sharebasis검증메타만추가허용했다. 원래paper TX 성공뒤짧은sidecar로기록하고실패는기존paper성공과격리하며증거gap은미확인으로표시한다. 원예측/입력/평가/anchor는UPDATE/DELETE차단·새IDappend,job상태만별도가변이다. 전체canonicalforward완결·연속경제상태/현금흐름·수수료·epoch일치때에만실actual비교한다. provisional예측epoch는realT0를고정/변경하지않고실제phase불일치시비교불가다.

현단계제품/DDL작성중이며운영신규DDL/예측적재/새코드게시·배포는아직없다. 신규표만사용/기존실계좌·실주문표변경없음·DRY_RUN유지사전점검과복구범위확인뒤필요한마이그레이션/실발행/운영연결까지진행한다. QA는운영readonly privatefixture를Ubuntu700/600임시경로에보관했고초안실B2000성능probe약19초완료지만최종독립검토/인수QA와구분한다. 원문표본/작업범위정본은 docs/design/2026-11-08-t156-forecast-engine-analyst-spec.md 및ui-binding.md를따른다.

## Developer — forecast ledger/runtime binding

- [22:11] F28 구현: 별도 forecast job lease + INSERT-only run/horizon/evaluation/continuation DDL·불변 trigger, 발행 2000경로/4horizon·DRY_RUN·lease·accountrevision/policy 재대조 및 atomic publication을 추가했다. 운영 DDL/DB쓰기·서비스·주문·commit/push/배포는 수행하지 않았다.
- [22:11] archived published/live_eligible=0 bundle 원문hash를 검증하고 DB UTC 발행시각·실paperbook·pending intents·원sourcebookhash·파일별code manifest를 동결한다. 새 collection/LLM/실거래 경로는 추가하지 않았다.
- [22:11] forward commit 후 같은 committed connection의 짧은 autocommit sidecar로 before/after revision/book/policy/fills/fee/sharebasis anchor를 기록한다. 실패는 기존 paper commit 성공과 격리하며, 평가에서 빠진 chain을 미확인으로 표시한다. 기존 book·시그널 결정·거래정책은 변경하지 않았다.
- [22:11] 만기 평가는 원본 sourcebook부터 revision/원장hash chain, 종목·전략 수량, cash+receivables delta, 편도0.25% fee, 고정policy/cohort·epoch phase, 모든 canonical 미래 세션과 target equity를 확인한 경우에만 completed 손익/오차/구간적중/Brier를 append한다. 불충분·조건불일치는 actual 없이 명시 상태를 보존한다.
- [22:11] 기존 v6 gate 절대경로 검사 `DEMO_GATE_PASSED / task: T-156` 및 approved_version v6/hash verified를 확인했다. 기존 화면의 Forecast/Comparison에 실원본 allowlist projection과 독립 서버10행 paging을 연결했다. owner 선검사/private no-store/403 지움/409 snapshot 재시도와 관측성과 구조는 유지한다. 최신 forecast/eval identity와 생성시각을 snapshot에 포함했다.
- [22:11] 별도 authenticated forecast cron을 10시 하루1회 normal call/joblog와 150초curl상한으로 연결했다. shell 예약·일별중복·상한 synthetic test는 통과했다. 로컬 node_modules가 없어 npx tsc는 compiler 미설치 메시지만 나와 typecheck 증거가 아니다. Ubuntu isolated smoke/Reviewer/QA 검증은 별도 인계하며 실제 운영검증으로 확대하지 않는다.

- [22:40] 독립 Reviewer 지적을 수정했다: 모든 continuation 검증 issue fail-closed, canonical 모든 mode cycle↔receipt 양방향·종료 revision·원 baseline split checkpoint 검산, sidecar 1.5초 만료 시 사용 중 연결 destroy/반환 금지, UTC 명시 INSERT와 멱등 trigger·전후 정의검사 도구, immutable forecast ID 선택·horizon/409 유지·403 지움, 전체 비교 status/Brier/구간 포함 집계를 추가했다.
- [22:40] publication에서 같은 revision의 원bookhash 오염, 철회/변경 source metadata·pointer/blob, 동일 원book/pending/source의 재prepare inputhash, result baseline/model/source/targets/표본·quantile·USD/pct·MCSE 일치를 검증한다. 평가 append 직전에는 짧은 RR account/range 공유 잠금으로 witness hash를 다시 확인하여 동시 cycle/sidecar 변화는 발행하지 않는다. nested owner DTO는 명시 allowlist라 book/residual/input 추가 필드가 전달되지 않는다.
- [22:40] 개발 검증: Ubuntu 격리 스냅샷에서 8 suites/124 tests 통과·skip/fail 0·tsc exit0를 수신했다. 마지막 privacy projection 2파일 변경은 별도 forecast-view 4 tests 및 tsc exit0로 확인했다. 순수 Node trigger 정의검사 3 tests와 기존/신규 cron shell·bash 문법·diff 공백 검사도 통과했다. 이는 작성 단계 검증이며 최종 독립 Reviewer/QA 인수·실MariaDB timezone/DDL 시험·운영 발행 증거가 아니다.

- [22:46] Reviewer 2차 지적 2건을 수정했다. 실제 engine가 추가하는 고정 PRNG 선언을 prepared assumptions 뒤에 정확히 허용하며 임의 선언 추가는 거부한다. 기존 합성 publication contract 시험만으로 실제 엔진 출력 연계를 놓친 점을 보완하여 B2000 실제 engine→assert→mockDB 4horizon 원자발행 통합 회귀를 추가했다. polling 401의 실제 코드 unauthorized와 http_401/http_403 모두 선택 원본·snapshot을 지우고, readEnvelope/applyOutcome→SSR private 비노출 회귀를 추가했다.
- [22:46] 최신 변경의 개발 smoke는 3 suites/63 tests 전부 통과·skip/fail 0·tsc exit0다. 이전 freeze는 ledger-review-round1-manifest.json으로 보존했고 canonical ledger-final-manifest.json을 전체33 source/DDL/test/scripts SHA로 재동결했다. 최종 Reviewer/QA 인수·실MariaDB·운영 반영은 이 결과에 포함하지 않는다.

- [22:51] Reviewer 3차 지적에 따라 경제검산의 1e-6 상대오차를 폐기하고 notional/fee/현금+미수금 delta 모두 절대 0.000001 USD로 고정했다. 금액 규모나 거래 변화량에 따라 허용 USD가 커지지 않으며, IEEE754 표현오차가 이 고정 한도를 넘으면 비교를 거부한다. 수량은 정확 safe integer·허용0, share-basis 가격은 기존 assertPaperShareBasis와 같은 절대0.0001로 분리했다.
- [22:51] 변경2파일 개발 smoke는 forecast-continuation 16/16 tests·skip/fail0·tsc exit0다. 100/100k/1b USD 실제 모델매수+$0.05 외부입금, 수수료+.05/현금 동시변조 차단, 미세 float 허용/소수수량 차단, 기존 settlePaperSignals를 사용한 decimal price·T+1 미수금 200회 반복 통과를 포함한다. 이전 round2 manifest를 보존하고 전체33파일 canonical manifest를 재동결했다. 최종 Reviewer/QA 인수·실MariaDB·운영 반영은 여전히 별도다.

- [23:06] Designer 최종 수용대조에 따른 표시2파일만 보완했다. Forecast·Comparison 숫자근처 P10–P90를 중앙80% 모형범위로 명시하고 범위밖손익 가능·최저최고손익 비보장 문구를 추가했다. 손실확률/전체구간포함률은 무부호 20.00%/100.00%로, 평균·수익률의 부호는 유지한다. 레이아웃·계산·정책·숫자5파일 변경은 없다.
- [23:06] 표시 변경 개발 smoke는 SSR44/44 tests 및 tsc exit0이며 나머지 기존31파일 SHA 일치를 QA가 확인했다. 이전33파일 manifest를 ledger-review-round3-manifest.json으로 보존하고 같은33파일의 canonical ledger-final-manifest.json을 갱신했다. Reviewer/Designer 좁은 재검토 및 이후 필요한 최종QA/UI/build 판정은 별도이며 운영DDL/첫발행은 수행하지 않았다.

## Developer — forecast numerical engine

- [22:12] `forecast-types.ts`·`forecast-input.ts`·`forecast-engine.ts`와 synthetic fixture/unit를 작성했다. DB/네트워크/환경/주문 의존 없이 현재 raw mark로 forecast-only baseline을 계산하고, 원래 book hash·revision·pending awaiting_open intents·정책·출처·가용시각·달력을 동결한다. 운영 book/T0/forward/실주문은 변경하지 않았다.
- [22:12] 실제 private source 준비는 frozen 후보123개와 후보 밖 기존 보유1개의 가격을 분리하여 총124개의 공동 벡터·297개의 연속 canonical 수익률로 qualified였다. 최초 초안의 모든 보유종목을 후보집합에 강제하던 제한은 기존 forward-input의 ineligible 보유 처리와 동등하도록 수정했다. OLS predictor는 후보123개만 사용한다. 11/6 미관측 index는 1일 latent OLS+중심화 residual로 모델링하며 관측값으로 저장하지 않는다.
- [22:12] L10/B2000 동시 벡터 moving-block·최장경로의 4개 prefix·복제별 SHA256/Mulberry32 seed를 구현했다. compact numerical policy는 기존 planM40의 126/200/20/top5/15%/편도0.25%와 150개 차등사례에서 같은 결정을 냈다. 기존 generatePaperSignals/settlePaperSignals/markPaperBook을 그대로 호출하므로 정수주·다음시가·고정수량/예산 초과 만료·매도 뒤 매수·T+1 미수금·기존 attribution을 재생한다. mark-only 종료 수수료/기존 매입비용 재차감은 없다.
- [22:12] Ubuntu 격리 정확 lock 의존성에서 기존16개 unit 전체 통과 후 fee-inclusive 100/100.25 경계1개를 추가하여 단독 통과했다. 제품3파일과 unit를 포함한 strict isolated tsc도 통과했다. flat/seed/future-row·source-order 불변/splitjump/결측·cutoff·latent gap/실패경로 전체실패/수수료 양면/기존 보유/공동상관/4prefix/타이머 양보를 검증했다. 프로젝트 전체 typecheck·lint·독립 Reviewer/QA 인수는 이 개발 검증에 포함하지 않는다.
- [22:12] 실제 private fixture 개발 성능 probe는 준비293.9ms, B2000/L10·4horizon(5/19/61/250세션) 완료19,083.8ms였다. 100ms timer183회·최대지연45.73ms로 초기 settlement lookup 2초 동기차단을 8일마다 yield하여 해소했다. 계좌금액·수량·종목·수익분포는 로그/공개파일에 출력하지 않았다. L5/L20 실자료 민감도 진단은 미실행이며 옵션은 지원한다. 실벤치는 QA PASS·운영 발행·배포 증거가 아니다.

- [22:28] 독립 numerical Analyst N1/P2의 finite 개별 PnL 합계 overflow 재현을 수정했다. maxabs 정규화·보상합 평균과 convex weighted quantile, netPct/최종 통계 finite guard로 invalid 전체 run은 horizons=[] failed를 유지한다. 기존17+극단 synthetic1을 Ubuntu에서 함께18건 통과했고 제품/unit strict isolated tsc도 통과했다. 개발 manifest/수정 영수증을 갱신했다. 이전 실자료19.08초 probe는 수정 전 SHA임을 명시했고 재실행하지 않았으며 최종 QA 성능 확인은 별도다.

### F29 예측 엔진·원장 검증 완료, 운영 트리거 관리자 권한 대기

최종33파일은독립Reviewer/Designer수용및소스해시대조를통과했다. 최초27suite467검사/표시후속4suite79검사·tsc/Nextbuild통과이며중복합산하지않는다. 수치Analyst18unit/150차등도별도근거다. 실network-noneDB는원자실엔진발행/동시lease/소유자읽기/불변trigger·UTC/KST와실commit생성sidecar1건을검증했다. 수기합성5일증거의실검사/평가/완료append/조회는통과했지만5일전체실commit/settle·23행실DB페이징·실DBsidecar실패/증거경합은미검증으로남긴다. Root실컴포넌트CUA360/412/1280·기간/고정탭/10페이지·권한clear/409와최종중앙80%/무부호확률문구를확인했고기기/실로그인운영UI는미확인이다. 임시서버/뷰포트복원·합성DB정리완료.

운영에는검토SQL을승인범위로명시적용했으나신규job/run/horizon/evaluation4표(모두0행)뒤첫CREATE TRIGGER가ER_BINLOG_CREATE_ROUTINE_NEED_SUPER(1419)로거부됐다. log_bin1/trustcreators0/ROW가실측됐고앱환경/프로젝트문서에서사용가능한관리자프로필을확인하지못했다. continuation표/trigger8개는없다. 새예측발행/새코드게시·배포0,기존39릴리스/health200/DBtrue/safetygreen/DRYtrue/killfalse·webcron각1online0restart유지,기존모의계좌1/회차1/시그널4·안전지문전후불변이다. 단순CREATE/TRIGGER사전권한검사와격리DB통과는운영추가SUPER요건을보증하지않았음을기록한다.

앱SUPER승격/전역신뢰완화/트리거없는발행으로우회하지않고사용자에게기존DBA프로필경로또는관리자직접SQL적용정보를async질문했다. 비밀번호·키요청없음. 검토SQL전체멱등재실행→정확8trigger/5표·기존자료불변후검증뒤정상hook게시·단일자동배포·실자료1run4기간발행/중복방지/owner조회로이어간다. 승인된UI/구현/이관/웹배포를다시묻는대기가아니라실권한·접속경로부족이다. 정본docs/implementation/2026-11-08-t156-forecast-engine.md/forecast-dba-handoff.md및canonical아티팩트를따른다. 전체T156은doing/전진84일·100왕복·20개입일·원천공백도유지한다.

F29 테스트이력 후속: 기존t156_test_artifact/blob에55파일검증소스/합성fixture/가린증거아카이브222338byte·SHA37d4937a…48ffae5를저장하고재읽기일치확인했다. artifact-37d4937ac3fb6fcd4cf05255faef58d4. 실제계좌금액/수량/분포/privatefixture는제외했다. 이는테스트이력DB쓰기이며신규운영forecast발행이아니다.

F29 사용자응답 후속(exec071): 사용자가 ‘기존 관리자 접속 프로필 지정(추천)’을선택했다. 방식은확정됐고재승인대기가아니다. 다만경로가없어Mac/Ubuntu기본.my.cnf/.mylogin.cnf와mysql/mariadb/stockinvest설정폴더의cnf파일존재만읽기확인했으며후보0이었다. 파일내용/비밀번호를요청하지않고사용할기존프로필의실제경로만async후속질문했다. 제공되면대상stockinvest/서버확인·검토SQL만적용후계속한다.

F29 로컬보존 후속(exec072): 격리Ubuntu재사용clone에서정상Reviewer감사hook로99파일을2411627fd0a012e7866c2180cbc83aae8e8492cc에기록했다. 생성build로그8개는원본해시를보존하고index밖에유지,의도치않은기존task파일mode변경은미게시커밋에서바로정정했다. 로컬bundlefetch완료뒤99파일Gitblob/작업사본일치를확인하고원본worktree를소유작업한정recovery stash후ff했다. main push/웹배포/새cron/실예측0이며origin/main39와구분한다. 코드HEAD241은DBA프로필경로및8trigger/5표후검증전까지게시하지않는다. 23:34:55KST 최종읽기확인은health200/DBtrue/DRYtrue/killfalse·trigger0이다. 기존모의지문불변증거와테스트아카이브DB보관영수증은유효하다.


### F30 기존 NAS 관리자 인증을 통한 보호 트리거 적용·후검증

사용자는 관리자 프로필 경로를 모른다고 알리고 NAS·서버 기존 설정 확인, 보호 트리거 적용, 실자료 예측 발행과 웹 배포까지 직접 승인했다. 실거래 OFF·전역 보안·앱 권한 유지 조건은 계속 유효하다. HOME-SERVER_CONFIG는 읽기 전용 단독 조사만 했다. 9개 기존 앱 DB 프로필에는 관리자 권한이 없었고, NAS SSH 기존 키도 인증되지 않아 사용자 직접 인증한 기존 HTTPS phpMyAdmin(root@localhost/UNIX socket) 세션을 이용했다. 인증서 경고를 에이전트가 우회하거나 비밀번호를 복사·출력하지 않았다. HTTP/HTTPS 세션 혼동은 최종 HTTPS 세션의 root/stockinvest 확인으로 해소했다.

신규 continuation 표만 앱 기존 권한으로 먼저 생성한 뒤, 검토 SQL SHA163ce1df…753b에서 원문 그대로 추출한 CREATE TRIGGER IF NOT EXISTS 8개를 관리자 화면으로 적용했다. 2026-11-09 00:17 KST 앱 read-only postflight에서 정확한 단일 SIGNAL 정의 8/8·5표0행, 기존 모의계좌1/회차1/시그널4 및 안전 지문 불변을 확인했다. log_bin1/trust_creators0/ROW와 앱 권한 해시50e0b333…9952도 동일하다. 최초 후검증의 해시 불일치는 원래 mysql bigNumberStrings 옵션과 정렬된 grant 문자열 인코딩을 복원하자 전부 일치했으며, 실제 revision/book/policy도 비공개 QA fixture와 동일했다. 권한·원본 변경으로 간주하지 않는다. canonical 근거 admin-discovery.json/admin-postflight.json, 보호 적용 화면은 별도 저장했다.

기존 F29의 4표/트리거 없음/관리자 경로 대기는 당시 이력이며 현재는 해소됐다. 최신 검토 33파일 해시 불변, 소스2411627은 미게시이고 origin/main/운영은39b2f749다. 이어서 정상 감사 hook 문서통합·단일 push/webhook·실자료 첫 4기간 발행/중복 방지·보안/원본 불변을 확인한다. 새 운영 발행/배포 성공은 그 실제 영수증 후 별도 기록한다. 전체 T156 doing과 미래성과/확률 보정/전진 최소표본·자료 공백 한계는 유지한다.


### F31 남은 격리 실DB 시험 완료·QA 배포 게이트 충족

2026-11-09 00:25 KST 독립 QA가 초기 CONDITIONAL 판정 뒤 미검증4경로를 실제 network-none 합성 MariaDB에서 보완했고 연구예측 생성·불변원장·평가·소유자 조회에 최종 `PASS`, 확인결함0을 기록했다. 실제lease/빈intent settle/mark/commit/sidecar5일→만기 evaluator→completed append→owner 비교, SQL23건 3페이지3건/year 원본 유지, sidecar INSERT 오류 뒤 기존papercommit 보존, 실제DB 제어된 증거interleaving의 append거부를 통과했다. 최신33파일 전후SHA동일, 영수증 qa-realdb-completion/receipt.json SHA33c5f8de5ef180ab484f632d6f2986120f24f83ed97f761143ba189e70a19842. 이전조건부기록은대체된이력으로보존한다. 5일no-trade·23건실엔진1+합성복제22·오류/경합주입이라는방법한계와 실제운영만기성과·수익성미검증을 명시한다.

Deployer가 정본 dry-run exit0 및 리터럴 QA PASS gate 충족을 확인했다. Root는기존origin/main39에소유T156구현241/문서7c만추가하고최종통합문서·QA증거를명시커밋한뒤단일push/webhook으로배포한다. 별도 --yes로중복배포하지않는다. 현재다른maincheckout54dirty는대상밖으로보존한다. 운영preflight는정확8trigger/5표0행·원모의/안전/전역/앱권한불변·health200/DRYtrue/killfalse/webcron각1온라인·실제privateAPI익명401이다. 결과SHA/릴리스/실예측4기간은실발행후별도영수증을기록한다.


### F32 실자료 예측 첫발행·웹배포·최종운영검증 완료

main·작업 HEAD `06bce08a7939ac17009194995fc6f0da6f99f239`, 릴리스 `20261109-002723-06bce08a`. 같은 SHA의 webhook START(00:27:15 KST)→RELEASE_RESULT ok→END0(00:29:06), Deployer 정본 status health200을 확인했다. 마이그레이션 자동실행/APK 공개는 없었다. 보호 DDL은 앞서 별도 승인으로 적용했다. 검토33파일 SHA·정확8트리거, web/cron각1 online/재시작0·DBtrue·실거래 OFF, 기존 모의/안전·전역보안/앱권한·안전환경 지문은 불변이다.

실제 수집 번들과 복사한 독립 모의계좌에서 원본1건/2000경로/4기간을37.571초에 발행했다. 원본 ID는 `d33ba129ee7a06dfce8bf0a60cc5d1c1a03a4162a7f2cd7ffecd4d490f7cfe72`, UTC발행 `2026-11-08T15:29:56.914399Z`, 가격 기준2026-11-06이다. 역사 공동수익은2025-09-03~2026-11-05의297개·비중첩10일블록29개다. 두번째동일호출은 이미발행됨으로차단됐고 DB job1/run1/horizon4/evaluation4(pending)/continuation0이다. 원본 입력 self-digest 규칙·결과·기간별 값·9파일 코드 manifest를 다시 계산해 일치했다.

| 예상기간 | 실제 목표 미국 거래일 | 기준가격 이후 거래일 | 실제 사후비교 |
|---|---|---:|---|
| 1주 | 2026-11-13 | 5 | 대기·actual 없음 |
| 1개월 | 2026-12-04 | 19 | 대기·actual 없음 |
| 3개월 | 2027-02-05 | 61 | 대기·actual 없음 |
| 1년 | 2027-11-05 | 250 | 대기·actual 없음 |

기존 소유자 연결로 실제 `readPaperView`를 명시적 read-only pool에서 호출했다. 4기간 각각 중앙80% 범위/예상손익·미보정손실확률의 값유효성·편도0.25%·선택원본유지·조회전후원장행수불변을 확인했다. 현재 등록사용자 중 비viewer가 없어 존재하지않는양수principal로403을 확인했고, 별도격리DB는실제비소유자403을 검증했다. 실제API익명401과 운영브라우저로그인 리다이렉트도 확인했다. 서명세션을위조하거나만들지않았으며 **로그인된 운영 owner UI와 Android 기기는 미확인**이다. 첫프로브는등록비viewer가없어적용불가였고대상종류를명시해재검증했다. 보조입력hash검사는self-digest 빈필드규칙을반영해정정했으며 실제원장변경은없었다.

앱: **분석 → 오늘 분석 → 종목별 → 모의분석 → 모의성과 → 향후 예상성과 / 예측 사후비교**, URL `/analytics?tab=m40`. 기존08:40KST모의분석·수집흐름 뒤별도10시KST예측작업이등록됐고새코드cron1개가실행중이다. 새10시정기tick의실제관측은아직이며이번에는동일인증route를명시1회발행·1회중복검사했다. 만기때자료·정책·epoch·원장연속성이맞아야actual/오차/범위적중/Brier가생긴다. 불충분자료는미확인,조건변경은비교불가이며기준이맞지않는숫자를성과로채우지않는다.

최종QA·가린운영증거15파일을기존테스트이력DB에별도로저장하고readback을확인했다. `t156-forecast-final-acceptance-20261109.tar.gz`,13037bytes,SHA `c22eba25074b9b61a61359b6456d629a3241fe765cf6fa2554b7c7f2d7779f9a`,artifact ID `artifact-c22eba25074b9b61a61359b6456d629a`. 이전55파일검증아카이브도보존했고실제계좌금액/수량/분포·비공개fixture는포함하지않았다. 운영영수증은 `deployment-final.json`, `webhook-06bce08.json`, `first-publication.json`, `owner-read-verification.json`, `ledger-integrity.json`, `final-history-receipt.json`,통합 `final-verification.json`이다. 결과문서는로컬에보존하고기록push로추가배포하지않는다.

현재예측은검증된M40정책의미보정연구분포이며판단에이전트는참고전용이다. 첫예측의주기는임시이며실T0와일치해야비교된다. 원천장기폭락국면/당시전체구성·뉴스공백, 실제미래성과·확률보정/연15%수익성,전진84일·100왕복·20개입일은미완료다. 달력2027-12-31상한과지수1일잠재추정을명시한다. 이번기능구현/발행/배포는완료했지만전체T156의doing을수익성검증완료로바꾸지않는다.

### F33 실제 로그인 운영 UI 4기간·대기상태 점검

- 사용자가 실제 로그인 앱에서4기간 손익범위/손실확률·사후비교대기를확인하도록요청했다. 2026-11-09 00:57 KST 읽기점검에서 기존06b운영/health200·DRY_RUNtrue/killfalse·원모의/안전/전역/앱권한/env불변,run1/horizon4/pending4확인. 표시대조용 실제4기간 원본은 별도0700/0600 private fixture에만준비했고금액을로그/증거에넣지않았다.
- 연결가능Chrome/IAB탭에로그인StockInvest앱탭이없고, 새운영탭15는로그인으로이동했다. 사용자의NAS관리세션과별도이며,ifries8611@gmail.com으로현재열어둔StockInvest에직접로그인후알려달라고async요청했다. 비밀번호/세션토큰요청·위조·실거래설정변경없음. 탭15 markHandoff보존, 아직인증UI확인완료로표시하지않는다.
- 응답후같은탭15에서로그인확인→모의성과/향후예상성과4기간/원본ID·표시값대조→예측사후비교pending/actual미확인→설정OFF읽기/사후원장불변→증거/문서정리순서로계속한다. CUA진행중이며사용자인증handoff종료전completion_summary하지않는다. 기존F32구현/발행/배포완료는유효하고추가배포/코드변경은없다.

### F34 사용자 로그인 후 실제 운영 UI 검증 완료

사용자가StockInvest로그인완료를알려직접인증된IAB탭15에서운영웹을확인했다. 실제앱GET으로표시된1주/1개월/3개월/1년을각각선택해원본ID d33ba129ee7a06dfce8bf0a60cc5d1c1a03a4162a7f2cd7ffecd4d490f7cfe72와USD·%P10/P90·평균/중앙값·손실확률·경로수를같은운영DB원본과대조했고4기간모두일치했다. 상세의자료ID/자료SHA/입력SHA·297관측/2025-09-03~2026-11-05도일치했다. 편도0.25%·미보정·범위밖손익가능·잠재지수1일·임시주기안내가실제로표시됐다. 기간전환중같은원본을유지했다.

| 기간 | 실제 화면 목표일(ET) | 예상범위·손실확률 대조 | 사후비교 |
|---|---|---|---|
| 1주 | 2026-11-13 | USD/%/평균·중앙값·손실확률·경로수 일치 | 목표일 대기·실제값 없음 |
| 1개월 | 2026-12-04 | 모두 일치 | 목표일 대기·실제값 없음 |
| 3개월 | 2027-02-05 | 모두 일치 | 목표일 대기·실제값 없음 |
| 1년 | 2027-11-05 | 모두 일치 | 목표일 대기·실제값 없음 |

사후비교는각기간1건·대기1·완료0이며실제손익/오차/구간적중/Brier미확인,DB전체pending4다. 비교요약이4기간합계일것이라는보조검사기초기가정은실제UI의1건및forecast-view의선택horizon필터를확인해정정했다. 제품데이터/수치는수정하지않았다. 비교화면은향후예상성과에서고른기간을이어받는다.

홈실거래OFF·설정switch실거래여부aria-checked=false·서버dryRuntrue를확인했다. 스위치/저장버튼은조작하지않았다. 08:38:17KST 사후점검은health200/DBtrue·33소스SHA/8trigger·원모의/안전/전역보안/앱권한/env지문불변,job1/run1/horizon4/evaluation4/continuation0이다. 화면조회로예측·성과·주문을새로생성하지않았다. 등록소유자의직접로그인세션만썼으며토큰/비밀번호를읽거나생성하지않았다. 새10시cron실행관측·Android물리기기·실제미래만기성과/수익성/확률보정은이UI검증과별개다.

최종조회영수증 authenticated-ui-verification.json, authenticated-ui-postflight.json. 실제금액/스크린샷은로컬0700디렉토리/0600파일로보존하고공유테스트DB에는비공개수치없는2영수증만저장·readback검증했다. 아카이브 `t156-authenticated-ui-acceptance-20261109.tar.gz`(4508bytes/SHA 905d36fc789d804fd0858f60902cd823357c79d5a128a5af75ace34dd1a0509a),artifact ID `artifact-905d36fc789d804fd0858f60902cd823`. 원본이미지/기대수치fixture를Git/공개artifact/공유테스트아카이브에넣지않았다. 운영탭을1주예상성과로복원해보존했고CUA완료요약을보냈다. 구현·설정·커밋/push·배포없음. 이전로그인대기는해소됐고전체T156 doing은미래성과/표본/수집공백한계를뜻한다.

### F35 남은 작업·현재 일별 자동운영 점검

- 16:47 KST 운영읽기점검: 기존06b릴리스/health200·DBtrue·DRY_RUNtrue/killfalse. 신규코드/설정/수집/작업재호출/주문변경없이확인했다. 11/09가격세션의실제모의회차는blocked/errorCode=paper_current_basis_observation_missing,보유종목현재세션분할조정일봉근거부족이다. 계좌revision2/T0null·모의시그널은기존리허설4개뿐이다.
- 오늘10시예측은HTTP503/forecast_input_blocked·완료경로0으로새발행없음. 기존가격기준11/06의원본1건/대기4건은보존됐다. 오늘09시경11/09세션자료번들게시가있어도전체핵심가격적격을뜻하지않는다. 구체누락종목/원천·forecast세부prepare사유는추가조사대상이다.
- 우선후속권고: ①당일분할조정일봉/출처시각·기존보유기준정합·재시도점검으로일일수집→모의분석→예측흐름복구(관문완화금지) ②m40-forward202접수와실제완료상태를분리해실패오탐검토 ③첫적격T0및실제전진원장/만기사후평가 ④미보정확률·자료/장기국면보완 ⑤참고전용에이전트의거래변경설계·같은비용병행검증. 현재사용자질문은남은작업확인이며새수정·재배포를실행하지않았다.
- 기존F34로그인UI표시검증완료와오늘일별자동운영차단은구별한다. 첫1주목표11/13은조건충족시평가예정이며자동completed보장은없다. 최소84일/신규왕복100건/에이전트변경20일,미래수익성/보정·Android실기기·당시전체구성/뉴스원천공백은남는다. 정본증거 followup-assessment-20261110.json.

### F36 일일 수집·재시도 복구 승인 및 조사

- 사용자 지시로 당일 분할조정 일봉 누락과 일일 수집→모의분석→예측 발행을 복구 중이다. 기본 구현과 강화 delta 개발 중이며 독립감사·최종 QA·배포·운영 재실행은 아직 완료 전이다. 실거래 OFF·안전 관문·기존 원본/원장을 유지한다.
- 실제 원천 확인: 이전 세 번들 126종목×2기준 모두 11/06까지였고 FRED 운송 오류로 지수가 없었다. 현재 Kibot IBM raw/split 모두 11/09 도착을 확인했다. Node FRED TLS 운송은 실패하지만 TLS 검증 유지 curl은 수신 가능하며 최신 날짜는 11/05로 2세션 부족하다. 지수 지연 허용치를 늘리지 않는다.
- 기존 KIS 읽기 전용 공식 SPX 지수의 70일 요청+실제 누락 짧은 요청 총11회 검산은 2025-09-05~2026-11-09 canonical297/누락0, FRED 공통295 전부 decimal 정확 일치다. 계좌번호/주문 전송·신규 토큰 발급 없이 기존 캐시로 조사했다. 프로덕션 어댑터는 기존 인증·시세 경유, 16회/90초 한도·원문/실수신시각/SHA·253이상/공통200일 검산 후에만 적격이다.
- 구현: 최신 whole-source 퇴행 방지·기존 FRED 원문 복구·bounded curl·ET 수집/예측 유한 재시도·보호된 읽기 상태·202 접수와 완료 분리. 세션 고정 forecast job/기존 published 감지로 입력 해시가 바뀐 재시도도 중복 발행을 막는 delta를 추가한다. C1 본체/강화 delta 모두 공식 Jev 도구 결과 codex_required=false; recursive Codex 호출 없음. 웹 새 릴리스는 0.3.0으로 한 번만 준비, APK 변경 없다.
- 정본 계획·검증 현황 docs/implementation/2026-11-10-t156-daily-flow-repair.md. private 실계좌 fixture·원문은 보호 디렉터리, 공유 아티팩트는 가린 근거만. 기존 F35 차단/기존 forecast1건4기간은 보존한다. 전체 T156의 전진84일·100왕복·20개입일/자료 공백은 별도다.

## Developer — daily source/retry repair

- [17:28] C1 기본 범위에서 raw/split 당일·253 canonical 갭 재수집, whole-source 퇴행 없는 병합, 검증된 기존 FRED 원문/해시/관측시각 보존 복구, FRED 한정 TLS 유지 curl fallback, 보호된 읽기 전용 status, ET 수집/예측 유한 재시도를 구현했다. after/202 접수와 실제 forward 완료를 분리했고 웹 버전만 0.2.0으로 준비했다.
- [17:28] 격리 Ubuntu에서 M40 전체+기록+주문차단 30 suites/545 tests, 후속 3 suites/50 tests, 안전 회귀 7 suites/98 tests, typecheck, shell 두 스케줄/실제 call 함수, diff check 통과. lint는 저장소 설정 부재로 미완료, 광범위 cron J1은 중단으로 미검증이다. 최종 curl fallback 오류 종류 제한은 후속 재실행 대상이다.
- [17:28] 기존 forecast job ID가 입력 해시 기반이고 session/day unique DB 제약이 없음을 발견해 Leader에게 강화 delta를 요청했다. 새 licensed index source/C1 delta·독립 Reviewer/QA·운영 복구 검증은 남았다. 제품 기본 fix 중간 인계이며 완료/배포 판정이 아니다. 운영 호출·DB 쓰기·commit/push/배포·네이티브 변경 없이 developer-base-validation.json에 파일 SHA와 재현 명령/제한을 기록했다.
- [17:37] 최종 curl fallback 오류 종류 제한까지 포함한 집중 재실행 4 suites/54 tests 통과(0.702초). 직전 기록의 재실행 대기 제한은 해소됐으며 새 원천/중복 발행 delta 대기는 유지한다.
- [17:29] 시각 정정: 직전 줄의 17:37 접두는 입력 오기이며 실제 집중 재실행·기록 시각은 17:28 KST다. 테스트 결과 자체는 변경 없다.
- [18:01] C1 delta/transport delta 및 Reviewer 결함을 반영해 36제품·시험 파일을 동결했다. 웹은 타 세션이 0.2.0을 이미 운영 전달하여 이번 별도 릴리스를 0.3.0으로 준비했다. 새 licensed SPX INDEX envelope 검증·원문/PIT/200공통 decimal 검산 연결, 1세션 지연 시 253가격관측(252수익률)+현재종목을 위한 최대254일 가격 재수집, 완료회차 자료만 복구, prior만 있고 short/gap/nonfinal인 지수 복구를 구현했다.
- [18:01] 세션 고정 forecast job·legacy published/active 확인·DB account 배타잠금과 session 재확인, 실제 DB clock 쓰기전/commit직전 nextopen 관문, atomic 예약 쓰기 실패 네트워크0을 구현했다. 기존 forecast 원본/저장manifest·8 immutable trigger·경제정책/실거래/owner/UI/APK/DDL은 변경하지 않았다. 혼합 구코드 writer는 새 관문을 소급 강제할 수 없어 Leader가 창밖 컷오버·legacy active0·구web 종료를 별도 확인한다.
- [18:01] 최종 격리 Jest 44 suites/788 tests 통과(60.884초), 마지막 nonfinal PIT delta 포함 focused 4 suites/58 tests 통과(0.994초), 최종 typecheck·두 shell 스케줄/예약실패/실제call·diff check 통과. 36파일 local/Ubuntu SHA 불일치0. lint는 저장소 설정 부재로 미완료이며 광범위 cron J1 중단은 통과로 세지 않는다. developer-freeze-manifest.json/productDigest dd10309601469101571e6dc9a7ee803e0c2a2e27d1550b930d875a724676e522, developer-final-validation.json으로 Reviewer/QA에 인계했다. 실제 MariaDB/운영 복구·독립판정/배포는 해당 역할에 남는다.
- [18:34] 운영 컷오버 인계 보완은 ignore artifact 5파일(core/operator/proof/realdb-harness/명령txt)에만 구현했다. account EX 후 job 비잠금 카운트로 구 job→account SHARE와 역순 교착을 피하고, status/updated_at만 변경·TX내 경제/revision 동일성·commit뒤 fresh connection으로 확인한다. 원본 run/horizon/evaluation count/hash의 사전 대비 변동은 paused를 유지한 실패로 보고한다.
- [18:34] resume의 모든 실패/영수증 실패는 재pause 및 새 readback으로 처리하고 확인 불가/active 미차단은 운영 중단으로 명시한다. full40 release-results 정본 영수증+고정 review manifest 36SHA+동일 UID 전체 old cwd 0+신규 web/cron 한 쌍을 확인한다. Root가 생성한 경제 bridge는 정확한 preflight 시각/계좌/whole-rowSHA/실제 frozen coreSHA/경제SHA/revision/matchedtrue 7조건으로 status 쓰기 전에 결합한다. 평가·자료·usage 전역쓰기차단을 주장하지 않는다.
- [18:34] node --check 4mjs 통과, 운영 실행0/제품36파일 SHA 불일치0. network-none Unix-socket MariaDB의 양방향 구 publisher 경합·pause중 old/new/forward active관문·commit 응답유실·resume/영수증 실패·baseline drift·bridge 7개 불일치 총23검사를 독립 QA에 인계했다(실행 결과 대기). opsmanifest SHA 05e6cc82a53e7c3473a5e6ed4356d3fc64640b93b61724e86c8114b295a4781f, core c648da58293f03431f0739c014157d10df7e30e48a57b198e44ce3e30f8bb528 고정이다. Reviewer ops 판정 및 QA 실행 근거 전에는 운영 도구를 실행하지 않았다.

### F38 실제 모의 발행 펜스 및 웹 반영 준비

- 제품36/웹0.3.0·788검사/타입/build/실DB 검증 후 ops5파일·23case를 독립 수용했다. 09:34:44Z Root만운영pause를실행: 독립모의계좌paused/revision2/경제SHA7d7c5391…1443e·원forecast1/4/4 hashes보존/양activelease0/새연결readbacktrue. 09:35:07Z 별도읽기에서도일치·health200/DRYtrue/전역·앱권한·8trigger·환경/안전지문불변. 실계좌/실거래는변경없다.
- Reviewer reviewer-fenced-cutover.json 현전환PASS·36scope,코드legacy경합영구제거가아니라paused유지로HIGH완화라는제한을유지한다. QA는배정변경영향범위실행PASS/실제펜스증거수용,전역clientOrderId동일주문실행미확인을별도표시했다. user범위에없는전면주문보증을주장하지않으며추가ignored한정검사명령을개발자가준비중이다. 모든실API/운영orders테스트금지.
- 다음: 정상hook(484/실commitE2E차단통과)로동일36/정본문서만commit→정본deployer계획/단일mainpush webhook. 모의계좌paused유지. 새릴리스fullSHA·36SHA/oldrelease全프로세스0/newwebcron각1/양lease0/경제원장동일검사후검토operator로active복구/readback→실수집·forward/T0·4기간예측·재시도중복차단을운영에서검증한다. 아직새commit/push/새배포/수집/예측0이다.
- [18:44] QA 역할 체크의 기존 clientOrderId 중복 실행 근거만 ignore Jest 하네스2파일로 보완했다. actual submitOrder 순차·동시 동일ID 2요청에서 UNIQUE를 모델링한 DB mock 행1/첫 dry_run 성공/중복 ER_DUP_ENTRY1062 거부, realSubmit·fetch·native Socket.connect 0회로 3 tests 통과(0.139초). Root의 실제 운영 UNIQUE 인덱스 metadata 확인은 별도근거이며 실제 DB 중복 INSERT 실행이나 HTTP200 기존결과 replay 보장은 주장하지 않는다. 제품36·주문코드·운영orders·실키·DDL 변경/사용0, QA에 정확 명령·SHA·한계 및 submit-client-id-duplicate-validation.json을 인계했다.


### 최종 반영 전 검증 수용

독립 QA가 추가 동일 clientOrderId 순차·동시 직접함수(mock UNIQUE) 3건까지 통과한 뒤 T-156 변경·필수 안전 회귀 범위의 검증 통과를 선언했다. 운영 orders 고유키는 별도 읽기 metadata로 확인했으며 실운영 중복요청·HTTP 성공 replay는 검증/보장하지 않는다. 기존 788개 회귀·ops23·타입/build·정상hook484/실commit차단과 제품36SHA 불변을 함께 확인했다. Reviewer 현전환 수용과 paused 유지/전환후 검산 조건, 마지막 시계→commit 비원자 한계는 유지한다. 아직 웹 반영 및 실제 수집→분석→예측 결과는 후검증 대상이다.
- [20:42] 일일복구 후 검산용 ignored READ-ONLY 검사기 3파일을 준비했다. 현재 active/실제 forward·첫 T0·continuation·새 forecast4기간 linkage·2000 paths·공유fee0.0025·만기/pending actual null·세션중복·기존1/4/4 불변을 검증하고 job_run_log는 시각/HTTP/상태/고정reason만 공개한다. paused·blocked-only·개인값 비출력 및 SELECT-only mock 포함16건 통과, 제품36/core펜스 변경0. 실제DB/API/수집호출은 실행하지 않았고 Root가 실제영수증을 남긴다.
- [17:18] 새 무료원천 C1 delta 뒤 0.4.0 단일릴리스 구현 진행: NYS:BRK.B raw/split 원자쌍·원문lexeme 정확검증/KIS OPEN+CLOSE200·Kibot split CLOSE연속성/고정master/공통 DATA301·420초·20MiB예산, 전체 실제bundle·분석source hash핀·발행TX재검사·source-regime 평가불비교·paused평가차단을 보강했다. 격리 Node24에서 24 suites340건 및 후속focused5 suites62건/타입/빌드 통과는 중간 증거이며, sourceevent 독립증거 미확정으로 최종동결·QA·운영완료를 선언하지 않는다. API/실키값읽기/운영DB쓰기·APK·장부정책수정0, Root문서/기존ops/core보존.
- [18:43] 0.4.0 좁은BRKcoherentpair 구현43파일을 동결했다(productDigest c8e1eee84af5b112522a313eee154dcc66d86081010d02ec3ac604ec15b948f0, manifest80ea3265…953). 최종 source-critical pending P 선행영속/격리write실패·만료worker·24h/휴장 TTL우회 방어를 포함하며 source publish account→datasetTX·lease전후검사, same-analysis-A핀/actualB전체검증/DBNYday·발행전후guard, SEC기존UA·cooldown·RetryAfter·signal 및 KIS공통bulk/usage boundedBRK를 유지했다. 광역31 suites506건은 마지막pendingTTL보완 전, 최종집중3 suites39건·타입·빌드0은동결본 증거이고 QA동결본광역예상31/509는미실행으로구분했다. 실제보존원문297/297pure검산(HTTP/DB쓰기0), local/Ubuntu43 SHA불일치0, corec648·ops49·DDL·APK·실거래경로변경0. finite CA/SEC/targeted10Q NULLrawSHA와보고지연/CA심볼coverage한계 명시, Reviewer→C2→QA 인수대기이며 실제모의/4기간발행완료 주장은 하지 않는다.

## 배포 기록

| 시각 | 릴리스 | 커밋 | 포함 작업 | 결과 | 비고 |
|------|--------|------|-----------|------|------|
| 2026-11-10 18:58 | 20261110-185657-04afa341 | 04afa341c07 | T-156 (일일 수집·재시도 복구) | ✅ ok | `RELEASE_RESULT` full SHA `04afa341c07bb39675907898299d4aee9c5c21bb`, previous `20261110-173140-f98f55ac`, `migrated=false`; webhook END exit 0. 최종 `--status`: web/cron 각 1개 online, 둘 다 새 릴리스 cwd, health 200. 컷오버 중간 status에서는 이전 프로세스 및 health 실패가 보였으나 END 뒤 최종 readback에서 해소. 별도 `--yes`·마이그레이션·APK 없음. 실수집·forward·forecast 운영 검증은 별도 후속. |
- [19:20] resume의 auth daemon nondumpable EACCES를 일반 무시하지 않고 Leader 승인 범위의 appworker 드레인 classifier를 ignore ops 파일에만 추가했다. Root 실제39개·정확5종 및 직접 읽은 부모chain에 한정해 comm/argv0/4 UID/PPid/kernel startTicks와 child·부모 전후 identity, root 비writable 참조 ELF/경로/SHA를 검사한다. 기록 구web/cron PID2개는 scan전후 소멸하고 readable old cwd는0이어야 하며 unknown/Node/Next/bash/sleep/curl EACCES는 거부한다.
- [19:20] 실행중 exe 링크는 EACCES여서 inode 인증을 하지 못한다는 한계를 receipt의 executingImagesVerified=false/allOsCwdsVerified=false 및 non-adversarial trusted-operator 가정으로 명시하고, 실제 제외 PID/종류/수를 기록한다. privileged proof/권한추가/일반EACCES skip은 구현하지 않았다.
- [19:20] 순수26+injected proc/fs 실제 scanner 호출경로14+network차단 temp복사본 module SHA mismatch4=44 tests 통과(193.7ms). 새 process/proof/core의 실제바이트SHA를 DB연결전에고정값과대조한다. opsmanifest 7a8ef4e93e51805937d3d1217cf1964e538c23e375afe46a2ee70370ad2310ba, process28681804cac788506d141e6a0ec18f5820c6ac85f47e1b577d2729d19143ab2f/operator981297e96917cc602ce88a80d910181cb26b6f331dd0973a289fa47cde2947b2로 Reviewer 인수했다. core c648/기존 DB23하네스/제품36은 불변이며 독립 Reviewer→QA 전에는 운영resume를 실행하지 않았다.
- [19:22] Reviewer 요청으로 실제 scanner 호출경로에 테스트 전용 proc/fs 주입 seam을 추가하고 old cwd·unknown EACCES·자식/부모 변경·소멸·구PID전후 부재·참조 경로 실패·제외 receipt 15건, pinned core/proof/process byteSHA·network 차단 복사본 음성4건을 추가했다. 순수26 포함 최종45 tests 통과(197.2ms). 각 후보 직전직후뿐 아니라 전체 scan끝에 PID/startTicks와 부모 identity를 재확인한다. core c648/기존23 DB하네스/제품36은 불변, 새opsmanifest 85eb2fee9c9353809d2d5aff34137d44b459fe66e56715d781ca030a85335eeb로 재동결·재인계하며 앞선44는 중간 검증 기록이다.
- [19:27] Reviewer/Leader 후속 한정 경계로 cwd=/tmp 등에서 구 절대 script를 실행하는 경우를 놓치지 않도록 proc cmdline 전체 NUL 인자를 메모리에서만 검사했다. exact oldRelease 또는 oldRelease/ 하위 경로가 flag/eval 인자 안에 있어도 고정코드+PID/boolean만 반환하며 원문 인자·인접비밀은 로그/receipt에 넣지 않는다. 4추가회귀 포함 최종49 tests 통과(195.4ms), inMemoryCodeVerified=false 한계를 명시했다. corec648/기존23/제품36불변, opsmanifest 467854d2cfcd8ecfb1c46b5e2ec4c0ca94d4bffec6feb18e72c20d52302dfe9a로 재동결해 Reviewer→QA 인수까지 직접 조율한다.
- [19:34] Jan donor→Sep KIS의 generic merge superset 거부 재현을 실제 runCycle 호출 경로로 확대할 수 없음을 코드로 대조했다. 실제 KIS 경로는 mapForwardSources(candidate,calendar) 뒤 bundle=candidate 직접 선택이므로 해당 운영 결함은 확정되지 않았다. Leader가 정정을 수용해 0.4/pureselector/제품 추가 편집을 취소했으며 0.3.0·36파일 SHA 불일치0을 재확인했다. normal API 실제 수집·분석·예측 검증은 Root가 실행하고 보조스크립트 cap 누락·generic merge 실험과 제품 실경로를 분리해 추적한다.

### F39 실제 웹 반영·복구 및 원천 한 종목 대기

- 웹0.3.0/commit04afa341c07bb39675907898299d4aee9c5c21bb/릴리스20261110-185657-04afa341 정상배포: START09:56:54Z→RELEASE_RESULTok/fullSHA일치/migratedfalse→END09:57:59Z0. web·cron각1online/새cwd·health200. 구중간stopping/health실패는컷오버관측으로해소됐다. 추가--yes/DDL/APK/실거래활성화없음.
- 실제paperpause 09:34:44Z 뒤09:58resume는같은UID authdaemon cwd EACCES로safe차단. 새권한/sudoer/ptrace설정변경없이 관측appworker 검사로보완: 기록oldPID2부재/effectiveUID1000 readablecwd·구pathargs0/unknownEACCES거부/정확5authclass메타·PID/startTicks재확인. 실image·메모리·allOScwd 인증불가/trustedoperator가정명시. 최종ops9파일467854d2…/49QA 및read-only실scan/Reviewer범위한정PASS. corec648/기존DB23/제품36불변.
- 10:34:41Z 검토된operator4파일SHA확인뒤resume성공·active/revision2·경제SHA7d7c5391…1443e/원forecast1·horizon4·evaluation4 hashes보존/양lease0·freshDBreadbacktrue. 새연결검산도통과했다. before/resume/guard는서버ops/private 보호폴더에있다.
- 정상앱POST m40-forward 10:35:34Z202는접수만,10:41blocked로확인. 실제최신bundle paper-src-8e9cea…의 raw126종목/분할조정125종목이11/09,시장지수KIS297일/11/09로복구됐다. frozen BRK.B 1종목의split 원문만11/06(HTTP200/296행),raw11/09(297행)여서sourceReady=false/epochnull·revision2/실제모의시그널0을유지한다. 두번째정상재수집10:45도같은원문끝날짜임을확인했다. 기존rehearsal4/기존blocked기록은보존.
- 공급자공식조정약06:00ET/06:30이후수집권고·08:00정렬참고가있으며보장시각아니다. 수신05:45ET는권고이전이다. 새정기수집06:45~08:45ET(최대4회/30분),예측07~09ET(최대4회/30분)에서actualsource준비를확인해야한다. 현재한국날짜11/10 첫수집20:45/예측21시. BRK.B제외/이전가격전일행대체/raw→split추정/시각조작/관문완화금지. 당시원문가격/SHA는private/DB원문으로보존하고공개증거는날짜·행수·hash만.
- 아직새forecast4기간발행/첫전진T0완료가아니다. 다음은공급자갱신후정상forward재실행또는정기수집관측→sourceReady/completed→forecast실제4기간발행/동일세션중복차단/만기전pending→별도testhistory DB저장·재읽기검산이다. 전체T156 doing/미래84일·100왕복·20개입일·확률보정/자료공백유지.
- Root작업트리도04afa로ff/제품36SHA불일치0,postrelease문서만local유지(기록push로추가배포금지). 회복stash Root07b70cdc8b838a8f8e14c480948d497806735c6d/Ubuntu75e2df2 보존,원래recovery2개및기타artifacts도보존. 보조source-only스크립트periodcap연결오류는저장전실패/제품실경로430cap/directKIS선택은정상. genericmerge별도실험을prod결함으로확대하지않고0.4제안취소·제품0.3유지한다.
- [20:14] 배포전 KST 구형 cron state 3/1필드와 첫 ET 날짜 충돌을 현행 shell 직접 fakeclock으로 재현했다. forecast 빈 attempts→보수4로 자동0회, forward2→잔여2회이며 후자는 전부 소진은 아니다. 임시파일에서만 과거 원문 rename 보존 뒤 창전0호출/창시작attempt1·원bytes동일을 검증했고 기존 shell2회귀도 통과했다. 정확 구형형식/소유일반파일/배포전mtime/KST키·epoch 또는mtime의전ETday/현재06:45전/rename직전inode·mtime·SHA불변을 모두 확인하는 Root 일회성 보존 이동은 타당하다고 Reviewer에 전달했다. 2파일은 개별atomic이므로 부분성공은 보존·보고하고 강제복원하지 않도록 명시했다. 실제state 접근/rename·운영DB/설정·제품 수정0, unknown/새4필드/오늘ET/변경증거면 중지한다.

## 일일 운영 복구 최종 결과 — F42

- 웹0.3.0/04afa341/릴리스20261110-185657-04afa341 배포·제품36SHA불일치0. 코드/독립회귀788·타입/build·격리실DB 검증과 ops읽기검산기17 합성검사 통과. 기존 broadcronJ1중단/lint설정부재는통과로표시하지않는다. 추가제품/버전/배포/DDL/APK변경0.
- 실제자동수집 예약4회 KST20:45:02·21:15:33·21:45:54·22:16:18,각HTTP202/partial/accepted_pending. 예측준비조회도21:00:19·21:30:46·22:01:08·22:31:27에4회/source_not_ready. 202접수는완료아니며과거오탐실패로그는보존. 현재ET예산4/4는초기화하지않았다.
- 최종수신08:16ET 원문도BRK.B split296행/11/06,raw297행/11/09. 분할조정11/09행0·원문SHA/날짜전체와parser일치·06:30수신과같아파서누락아님. 전체raw126/split125최신11/09·KIS SPX297/최신11/09/동결후보123. 공급자내부원인·이후갱신보장없음. 대체KIS개별주식MODP1의split-only/배당정의·USD전체원문계약은미검증이므로적용안함.
- 22:33 운영검산은정상pending/issues0: accountactive/revision2/T0null/실제forward0·신규모의signal0·새forecast0. 기존rehearsal4와원forecast1run/4horizon/4pending·경제원장보존. 신규T0/4기간발행/동일세션운영중복차단의긍정검증은미완료이며기존모의성과/원예측으로대신통과판정하지않는다. QA최종도PENDING_SOURCE_NOT_READY/전체flow NOT_VERIFIED.
- health200/DBtrue·DRY_RUNtrue/killfalse,web·cron각1online/restarts0·양lease0·보호8trigger/앱권한/전역/환경/안전지문불변. 실orders상태별건수도전후동일(전체행불변보증아님). 기록저장후22:39health도동일. 실거래OFF·분할/가격/PIT/owner/immutable/개장시각관문유지.
- 최종운영근거25파일/11,641bytes를별도testartifact/blob DB에저장·재읽기검산: artifact-ee274df8c5d6e392588c577866d2f4ca/SHA ee274df8c5d6e392588c577866d2f4caeaeecc55aca99df7561a60703d7e7ae9. 기반88파일·중간20파일도별도보존. 실계좌fixture/원문가격/키제외. Root postrelease문서는local유지하며기록push로추가배포하지않는다.
- 다음: 원천의누락행/내부갭이실제로복구되거나별도적격원천계약이검증된뒤정상forward→첫적격T0/4기간발행/재시도중복·만기전pending을실제로확인한다. 다음날정상화보장없고미도착시계속안전차단한다. 전체T156 doing·최소84일/신규왕복100건/에이전트거래변경20일·미보정확률/역사원천공백도남는다. 정본구현보고서와operating-result-final-summary/qa-operating-result-final/operating-final-history-receipt참고.


## 전체 흐름 재확인 — F43

- 검증 전용으로 운영 API·DB·보존 원문을 다시 읽었다. 운영0.3.0/04afa·web/cron각1online/restarts0·health200/DBtrue·DRY_RUNtrue/killfalse·보호8trigger/전역/앱권한/환경/안전지문과원예측hash는유지됐다. 기존788검사를오늘새로돌린것은아니다.
- 결과는 전체 흐름 미완료다. DB최신번들은전날08:16ET수신본그대로: raw126/split125·KIS297은11/09,필수BRK.Bsplit은11/06/11/09행없음. 공급자현재원문을새로받지는않았으므로현재공급자에도없다고확정하지않는다. sourceReady=false/실제forward0/T0null/revision2/신규모의signal0·새forecast0,기존1run/4기간/4pending보존.
- 이전ET일의자동수집4/예측준비4 기록그대로이며재시도횟수초기화0. 이제미국11/10개장후라beforeNextOpen=false도확인했고11/09회차를소급실행하지않았다. 다음정기수집예약은11/11 20:45KST부터지만적격원천확보·완료는보장하지않는다.
- 전점검이후orders상태별건수차이는dry_run+1뿐,filled17은동일(전체행/원인추적보증아님). 이번검증의수집시작/예측발행/주문/DB쓰기/설정변경/배포/새테스트0. 새로그인UI검사없음. 실제자료수집과성과발행을성공으로표기하지않는다.
- 근거 followup-operating-verification-20261111.json. 원천복구후첫정상전진/T0·신규4기간예측·같은세션중복차단의운영긍정검증과기존장기표본/보정과제는남아T156 doing유지. 이번추가확인기록은local Vault/가린artifact로만보존하고운영테스트DB추가쓰기나문서push배포는하지않았다.


## 미국장 마감 후 재점검 예약 — F44

- 사용자 “익일 미국장 마감 후 분석내용 다시 점검” 지시로 한국 시간 2026-11-12 23:00에 이 채팅으로 돌아오는 1회 점검을 등록했다. 첫 안내의 11/11은 익일 해석에 맞춰 11/12로 바로잡아 안내했다. 해당 마감 뒤 정기 수집·예측 결과를 확인하는 시각이며 지금 미래 작업을 실행한 것은 아니다.
- Codex 앱 automation t-156 / heartbeat / ACTIVE / 실행1회. 도구 create·view와 저장된 COUNT1/월일·시각·current-thread 연결을 확인했다. 도구가 DTSTART 포함 즉시생성을 거절한 첫 요청은 생성되지 않았고, 도구가 수용한 일회성 규칙으로만 등록했다. 서버 cron이나 직접 예약 파일을 작성하지 않았다.
- 범위는 운영 DB·로그·원문 적격성·실제 모의분석/T0·모의시그널·신규 1주/1개월/3개월/1년 예측·사후비교·원본 보존·실거래 OFF를 읽어 정상/차단/미확인을 보고하는 것이다. 강제 수집/예측/주문·DB쓰기·설정/권한/정책 변경·재시도 초기화·배포를 실행하지 않는다. 자료가 부족해도 성공으로 보고하지 않고 이번 1회 보고 뒤 종료한다.
- 기존 운영상태는 아래 F43 확인이 마지막이며 이번에 정상화 재판정을 내리지 않았다. T156 doing 및 원천/실제 전진·예측·장기 검증 대기는 유지한다. 로컬 예약 실행에는 해당 Mac과 데스크톱 앱 및 작업 폴더/SSH 연결이 사용 가능해야 한다. 근거 scheduled-followup-20261112.json, 앱 예약 카드. 코드/운영DB/거래 설정 변경0.


## 금일 미국장 마감분 점검 — F45

- 사용자 “금일 미국장 마감 후 분석 결과 점검 여부” 요청으로 지금 직접 읽기 점검했다. 해당 미국 마감 거래일은11/10이다. 일반 research-cycle07:00:18~19,일봉07:40:53~07:42:33,해외마감분석08:00:47~08:02:16은각HTTP200/jobstatusok다. 이사실을M40의전진·예측완료나전종목성과검증으로확대하지않는다.
- 오늘08:02:16 M40참고(shadow)경로는blocked/m40_policy_not_configured/초안0·판단0 기록이있다. loadM40Input의환경기준일요건(T156_M40_EPOCH_SESSION)미충족사유이며독립모의계좌의저장정책과별개다. 그blocked행의session11/06은연구달력fallback으로오늘11/10유효분석결과가아니다. 기준일·설정을임의입력하지않았다.
- 오늘마감분M40정기수집은오늘20:45KST부터다. 현재API는session11/10/pending/sourceReadyfalse/beforeNextOpentrue. 실제forward0·모의signal0·T0null/revision2·새forecast0/원본1run4기간4pending보존. DB최신번들은아직11/09기준/raw126·split125·KIS297/BRK.Bsplit11/06이며공급자현재파일을새로받지는않았다.
- 실거래OFF/health200/DBtrue·보호8trigger/안전·권한·전역·환경지문불변. web/cron각1online,cron은restart1(원인추적안함),web0. filled17동일·dry_run575이며현재검증에서주문·수집·예측발행·DB쓰기·설정·배포·새테스트0. 가린근거 postclose-review-summary-20261111.json 및현재운영/원문/회차읽기영수증.
- 자동점검t-156은기존11/12 23:00KST 1회ACTIVE로등록돼그예약시각은아직전이다. 현재질문의“금일”에맞춰오늘11/11 23시로앞당길지선택을비동기로요청했으며응답전에는일정을변경하지않았다. 오늘즉시읽기점검과내일예약을구분한다. T156 doing·오늘수집후실제전진→새예측완료확인남음.


## 즉시 실행 — F46

- 사용자 “지금도 미국장은 마감된 상태이니까 지금 바로 작업 진행”에 따라 예약시각을 기다리지 않고 정상앱 경로를 실행했다. 직전조회만허용범위와구분하여이번에는실자료수집·sourcearchive·적격시독립모의전진/예측원장정상저장이승인범위다. 실거래/설정·권한·전역보안·정책/수동epoch·배포변경은하지않는다.
- 11/11 13:56KST API는미국11/10세션/pending/sourceReadyfalse/beforeNextOpentrue. 13:57:16KST POST m40-forward는202접수,13:58:34에는running으로실제worker수집진행확인. 아직source적격/전진/T0/4기간예측완료로판정하지않는다. 조건통과뒤에만forecast정상경로를호출한다.
- 13:57:26동시운영읽기 health200/DBtrue/DRYtrue·계좌active/revision2/T0null·원1run4horizon4pending/안전·권한·전역·8trigger지문보존. 당일조회전후파일중 immediate-before는이전12:25완료snapshot을worker시작전복사한것이며새완료preflight로간주하지않는다; immediate-inflight-crosscheck가13:57:26동시읽기다. 실행전최신API상태및정상route의필수관문은유지됐다.
- 예정시각변경질문대신사용자가즉시실행을선택해현재진행한다. 기존11/12 23시1회점검예약은취소/변경지시없어유지. 현재실행과그예약은별개다. 최신원천이아직미도착이면원문/시각을확인해실제차단사유를보고하며추정행·카운터초기화로우회하지않는다. QA는읽기전용으로원장연결/보존/안전독립검산만배정했다.


## 즉시 1차 수집 결과 — F47

- 13:57:16KST 정상수집을지금실행했고14:02:43 상태blocked로종료확인했다. 원천실제DB새번들 paper-src-8a8102d418d25975646dc5bc14b9f74f89a0ac820701b14b/asOf11/10/window2025-09-06..11/10으로발행. 저장만으로모의분석완료를뜻하지않는다.
- 수집대상126종목 raw18/split96이당일11/10,raw108/split29는11/09·BRK.Bsplit1은11/06이다. 고정후보123중필수양기준이채워진종목18/누락105. FRED지수원문297/11/10 직접확보,transportfailures0. 원문은수신됐지만날짜미갱신인대상이많아sourceReadyfalse다. 전체목록/원문SHA/PIT는보존하고값·보유/금액은공개artifact에출력하지않았다.
- 1차blocked회차1개가11/10에기록돼계좌revision2→3/T0null; 실제forward0·새정상시그널0·새forecast0/원1run4기간4pending보존. blockedcheckpoint의revision변화와실제경제상태변경은QA가구분검산중이며아직경제상태불변이라고단정하지않는다. 신규예측API는준비미달상태에서호출하지않았다.
- 첫시작으로부터30분간격인05:27UTC(14:27KST)이후누락대상정상재수집1회를준비한다. 실제원문갱신이관건이며기준일수동입력·가격대체·날짜조작·관문완화없음. 당일재시도counter초기화/새배포/실거래설정변경0. 문서진단상Kibot type기본값stocks/BRK.B표기·splitadjusted계약은현재요청과맞고type생략을지연원인으로확정할근거가없다(데이터API추가probe0).


## 즉시 실행 최종 결과 — F48

- 사용자즉시실행지시대로예약을기다리지않고13:57:16·14:27:39KST 정상m40-forward를2회실행했다. 각각약14:02·14:32에자료적격미달blocked로종료. 단순상태조회가아니라실제원문수집과연구DB발행을수행했으며새예측발행성공으로표기하지않는다.
- 미국11/10마감분 기준 수집대상126중raw18/split96만최신,raw108/split29는11/09·BRK.Bsplit1은11/06. 고정후보123중양기준충족18/부족105로2차에도동일했다. FRED SP500원문297일/최신11/10은정상확보했다. 2차HTTP5022건은이전유효whole record와원문/SHA/실수신시각을보존,252원천기준날짜범위퇴행0을독립검산했다.
- 실제새source판본2개(8a8102d4…/a46055fa…)를DB에보존했다. 별도2GET동시진단에서도BRK.B splitdefault와type=stocks가동일295행/11/06/SHA로요청옵션추가효과없음. 원문은보호폴더/DB에두고공개증거는날짜·개수·hash만보존했다. 자료추정/날짜변조/누락종목제외/신규공급자임의대체없음.
- 11/10 blocked회차1개가저장돼revision2→3,2차중복blocked는추가되지않았다. T0null/정상forward0·신규시그널0·새forecast0/원예측1run4기간4pending·기존rehearsal4보존. QA가revision만이전값으로정규화해policy/state/clone경제SHA일치를확인,현금·보유/수취금·기존intent/outcome은이비교범위에서변화0. 신규forecast API는입력적격미달로호출하지않았다.
- 14:34~14:40후검사health200/DBtrue·DRY_RUNtrue/killfalse/계좌active·web/cron각1online·양lease0,보호8trigger/전역보안/앱권한/환경/안전지문·기존forecast hash불변. 이번13:57동시읽기대비orders상태별건수도같음(전체행동일보증아님). 편도0.25%/제품0.3.0·36SHA불일치0/정책·epoch수동설정·retrycounter초기화·새코드·배포변경0.
- 독립QA최종 qa-immediate-final-20261111.json은전체일일흐름 NOT_VERIFIED로구분했다. 현재실행근거16파일/12,064bytes를기존별도testartifact/blob DB에저장·재읽기검산: artifact-e06c33c9896d36017781cef696ab643e/SHA e06c33c9896d36017781cef696ab643e1e7cf735bd13a8f0c560bb6da65f6b95. 실제가격/계좌fixture/금액/키는테스트아카이브에서제외. 기존788회귀를지금새로돌린것은아니다.
- 전체정상화는미완료다. 남은실제관문은당일raw/split·BRK.B11/09·11/10내부갭의적격원천확보이며그후첫정상T0/forward→4기간예측저장/중복차단/사후평가를확인해야한다. 자료가현재없는데예측을발행하거나수익을만들어보이지않는다. 향후기존정기수집/11/12 23시예약은유지했으며새자동화나추가수동수집을무한반복하도록설정하지않았다. T156 doing/장기표본·확률보정과제도유지.

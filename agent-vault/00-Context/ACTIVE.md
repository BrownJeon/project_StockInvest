---
project: StockInvest
updated: 2026-10-24
tags:
  - type/context
---
# 현재 상태

## 2026-10-26 11:45 — T-092 완료(훅 인증 구현 감시, 로컬 병합) · T-091 WP-A 완료(웹 전용, 격리 브랜치·미push) · WP-M2 미착수

- **[[T-092-hook-safety-paths-auth-impl]]**: 훅 `SAFETY_PATHS` 에 인증 관련 구현 6곳(+시험) 정규식 10줄 추가 — 새로 걸리는 추적 파일 10개(`signup-gate`·`signup-request`·`mail/send`·`safe-next-path` 와 각 시험, `profile/password/`, 미들웨어 공개 경로 시험). 속도 제한 `*-gate.ts` 는 제외 유지. 로컬 커밋 `945ba0c` 가 11:43 main 에 병합돼 **이 서버에서는 이미 활성**(설치된 shim 경유 확인). **origin 에는 없다(push 대기 — 급하지 않음, 문서·스크립트뿐)**. 사용자 결정 대기: 아직 훅 밖인 후보(`auth/__tests__/` 시험 15개·`login-screen-t088.test.ts`·`mail/config.ts`·`header-safe`·`signup-request-mail`·`profile/route.ts`) — AI 권고는 시험 15개+`login-screen-t088`+`mail/config.ts` 를 묶어 다음 task 로, 나머지 보류.
- **[[T-091-app-version-gate-and-m2]]**: 사용자 결정 "t-091은 권고대로 진행해줘"(M2 에 포함) + 데모 승인 "T-091 데모 v1 의 B. 옛 앱 로그인 화면은 B안으로 진행해줘"(대안 B: 화면 위 경고 띠 + Google 버튼 비활성). **WP-A(웹 전용)**: 앱이고 설치 build 가 필요 최소(2) 미만일 때만 로그인 화면 맨 위에 "앱 업데이트가 필요합니다" 띠 + 비활성 Google 버튼(웹·새 앱·버전 모름은 변화 없음) — 구현·Reviewer 2라운드·Codex 0건·QA(실제 브라우저 11시나리오) 통과, 로컬 커밋 `7844a91`(브랜치 `app-gate-t091`, worktree `~/.node-local/stockinvest-app-gate-t091`, **main 미병합·미push — 웹 push 가 곧 배포라 사용자 승인 대기, 장외 창 15:40~22:20 KST 권고**). 표 값 `googleLogin: 2` 가 공개 APK 1.0.1 과 일치해 지금 배포해도 막다른 길 없음. **WP-M2(App Links)는 미착수 — 사용자 결정 대기**(task T-091 "WP-M2 착수 전 사용자 결정·몫" 4항: M2-0 예측 시험·시험 APK 1.1.0·assetlinks 서빙 방식 middleware 권고·착수 시점/수익 연결).
- **새 task 번호는 T-093 이상**(T-091·T-092 사용).
- ⚠ **T-091 이 `src/middleware.ts` 를 고치게 되면(M2 assetlinks) Reviewer 판정 scope 에 `src/middleware.ts` 와 `src/__tests__/middleware-public-paths.test.ts` 를 둘 다 적어야 훅이 통과**(T-092 로 후자도 감시).
- 정리 대상(승인 대기): worktree 2개(`~/.node-local/stockinvest-app-gate-t091` — `node_modules`(npm ci 설치 실제 디렉터리, 정리 때 `rm -r`)·`.next` 94MB 포함 — T-091 push 승인 전에는 보존, `~/.node-local/stockinvest-hook-t092` — T-092 병합 완료라 정리 가능)

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

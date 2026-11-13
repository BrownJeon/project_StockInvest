---
type: roadmap
project: StockInvest
updated: 2026-11-13
phases:
  - { id: 0, name: "안전 기반",              status: done }
  - { id: 1, name: "관측·소생 핫픽스",       status: done }
  - { id: 2, name: "시그널 파이프라인 재설계", status: done }
  - { id: 3, name: "페이퍼 손익 실측",        status: todo }
  - { id: 4, name: "백테스트 검증 루프",      status: todo }
  - { id: 5, name: "실거래 해제 준비",        status: todo }
  - { id: 6, name: "기반 앱(재구성 이전)",    status: done }
  - { id: 7, name: "멀티유저 인증",           status: done }
  - { id: 8, name: "실거래 안정화·운영",      status: doing }
  - { id: 9, name: "리서치분석·추천",         status: done }
  - { id: 10, name: "멀티유저 확장",          status: todo }
tags: [type/roadmap]
---

# StockInvest 로드맵

## 공개 화면 · public
### /login | 로그인
- [x] (7) 이메일·비밀번호 로그인 [[T-008-multiuser-auth-step1]]
- [x] (7) 로그인 시도 제한·잠금 [[T-008-multiuser-auth-step1]]
- [~] (7) Google·GitHub 소셜 로그인(배포됨·앱 미등록으로 휴면) [[T-009-oauth-login]]

### /signup | 회원가입
- [x] (7) 초대코드 + 이메일 가입 [[T-008-multiuser-auth-step1]]
- [x] (7) 가입 시도 제한 [[T-008-multiuser-auth-step1]]

### /signup/request | 가입 요청
- [~] (10) 초대코드 요청 메일 발송 [[T-010-signup-request-email]]
- [~] (10) 요청 알림 이스케이프·요청 속도 제한 [[T-010-signup-request-email]]

### /oauth/invite | 소셜 가입 초대코드
- [~] (7) 소셜 신규 가입 시 초대코드 입력 [[T-009-oauth-login]]
- [x] (7) 이메일 미검증 기존 계정 연결 거부 [[T-009-oauth-login]]

## 투자 앱 · login
### / | 대시보드
- [x] (0) 안전장치 바(Kill Switch·모의 매매 토글) [[T-001-phase0-safety-foundation]] [[T-007-telegram-silent-failure]]
- [x] (1) 판단 깔때기 카드 [[T-002-phase1-eval-funnel]] [[T-004-phase1-visual-verification]]
- [x] (6) 투자 현황·승인 대기 배너·트레이딩 보드
- [x] (6) 보유·관심 목록과 캔들 차트
- [x] (8) 최근 주문 날짜→종목 그룹 [[T-026-order-history-symbol-grouping]]
- [x] (8) 주문 동기화 판단보류 배지 [[T-022-order-sync-alert-escalation]]

### /recommend | 추천
- [x] (8) 거래 운영 기록 해외 탭의 ET 표시 제거(세션 날짜 계산 유지) [[T-144-trade-log-overseas-label]]
- [x] (6) 승인 대기 시그널 카드(승인·거절)
- [x] (6) 진입 감시 중 목록·승인 철회
- [x] (6) 내 시나리오 만들기 진입

### /recommend/[id] | 시그널 상세
- [x] (6) 진입구간·매매수치 편집 후 승인·거절
- [x] (8) 누락 필드 방어(상세 크래시 수정) [[T-021-recommend-detail-client-crash]]

### /recommend/build | 시나리오 만들기
- [x] (8) 방향·종목·분할·기간 입력 → AI 분석 → 등록 [[T-016-recommend-build-page-invalid-id]]
- [ ] (8) 시나리오 기반 손절 알람(자동 청산 대체)

### /ai | AI 채팅
- [x] (6) 대화 스레드·메시지
- [x] (6) 종목 컨텍스트 주입

### /analytics | 분석
- [x] (8) 모의분석 v6 조회 화면(운영 반영) [[T-156-us-stock-entry-exit-forecast-design]]
- [ ] (8) 실자료 예측 엔진·불변 원장(구현/검증 완료, 운영 DBA 트리거 권한 대기) [[T-156-us-stock-entry-exit-forecast-design]]
- [x] (9) 리서치분석 탭 [[T-032-research-rally-cycle]]
  - [x] (9) 매수·매도 판단 + 신뢰도·기간·가격 [[T-033-research-recommendation-trade-report]]
  - [x] (9) 차트 기반 목표가·도달가능성 게이트 [[T-034-chart-based-price-targets]]
  - [x] (9) 지금 분석 버튼·해외 USD 표기 [[T-035-overseas-usd-display]]
- [x] (6) 포트폴리오 탭
- [x] (8) 포지션 추적 탭 [[T-015-disable-auto-exit-engine]]
- [x] (6) 주도주 탭
- [x] (6) 투자일지 탭
- [x] (6) 놓친 기회 탭
- [x] (8) 거래 이력 탭(날짜→종목 그룹) [[T-026-order-history-symbol-grouping]]
- [x] (1) 신호 진단 탭

### /favorites | 즐겨찾기
- [x] (6) 즐겨찾기 목록·재무지표 칩
- [x] (8) 재무 갱신 AI 호출 복구(M4 게이트웨이) [[T-014-favorites-ai-refresh-failure]]
- [x] (8) 재무 갱신 실패 시 데이터없음 반영 [[T-030-fundamentals-refresh-stale-state]]
- [x] (9) 리서치 추적 토글·추적중 배지 [[T-032-research-rally-cycle]]

### /favorites/[symbol] | 즐겨찾기 상세
- [x] (6) 종목 상세·차트 분석
- [x] (8) 재무 갱신 실패 표시 동기화 [[T-030-fundamentals-refresh-stale-state]]
- [x] (9) 리서치 추적 토글 [[T-032-research-rally-cycle]]

### /strategy | 분석가 운영 현황
- [x] (2) 주목 종목 TOP 3
- [x] (2) 운영 이력(시그널 결정 로그)
- [x] (6) 주문 중 이력
- [x] (6) 전략 관리(접힘)

### /markets | 시장 현황
- [x] (6) 국내·미국장 개장 상태
- [x] (6) 시장별 예수금·환율

### /order | 주문(리다이렉트)
- [x] (6) /strategy 로 리다이렉트
- [-] (6) 수동 주문 화면

### /profile | 내 계정
- [x] (7) 내 매매 설정(모의 매매·긴급 정지·한도) [[T-008-multiuser-auth-step1]]
- [x] (7) 한국투자증권 연결(키 암호 저장) [[T-008-multiuser-auth-step1]]
- [x] (7) 비밀번호 변경 [[T-008-multiuser-auth-step1]]
- [ ] (10) 내 설정을 매매 엔진에 반영

### /settings | 설정
- [x] (2) 승인 방식(assist·auto) [[T-006-phase2-implementation]]
- [x] (0) 안전장치(공통)·거래 보호 [[T-001-phase0-safety-foundation]] [[T-007-telegram-silent-failure]]
- [x] (6) 변동폭 가드·전략 설정
- [x] (8) 자동 청산 마스터 스위치 표시 [[T-015-disable-auto-exit-engine]]
- [x] (2) 국내·해외 공통 자동승인모드 전환 [[T-154-auto-approval-mode-setting]]
- [ ] (8) AI 제공자 M4 주소 설정·표시 [[T-038-llm-base-url-setting]]
- [x] (6) 거래소 계정·알람 채널·정기 거래 리포트

## API · api
### /api/health | 헬스체크
- [x] (0) 안전장치 green·red 종합 판정 [[T-001-phase0-safety-foundation]]
- [x] (0) 수치 비노출(설정됨·미설정만)

### /api/auth | 인증
- [x] (7) 로그인·로그아웃·가입 [[T-008-multiuser-auth-step1]]
- [~] (7) 소셜 로그인 콜백·계정 연결 [[T-009-oauth-login]]
- [~] (10) 가입 요청 [[T-010-signup-request-email]]

### /api/signals | 시그널
- [x] (2) 시그널 생성·조회·승인·거절 [[T-006-phase2-implementation]]
- [x] (8) 생성 수치·배열 필드 런타임 가드 [[T-028-signals-api-numeric-guard]]
- [x] (8) 사용자 시나리오 확정(custom/confirm) 가드 [[T-029-custom-confirm-numeric-guard]]
- [x] (6) 놓친 기회 집계

### /api/orders | 주문
- [x] (0) 모든 주문 submitOrder 단일 관문 경유 [[T-001-phase0-safety-foundation]]
- [x] (6) 주문 목록 조회·취소
- [x] (8) 수동 주문 수량 가드 [[T-024-manual-order-quantity-guard]]
- [x] (8) 비숫자 수량·가격 가드 [[T-027-nonnumber-quantity-guard]]

### /api/safety | 안전장치 API
- [x] (8) 주문 동기화 상태 조회 [[T-022-order-sync-alert-escalation]]
- [x] (6) 전체 주문 취소
- [ ] (8) 전체 취소 DB 쓰기 정합성·서버측 오류 구조화

### /api/settings | 설정 API
- [x] (0) 안전장치·킬스위치 저장 [[T-007-telegram-silent-failure]]
- [x] (6) 알림 채널·LLM 제공자·전략 설정
- [ ] (8) 안전 키(dryRun·한도) 서버 검증

### /api/portfolio | 포트폴리오·잔고
- [x] (6) 포트폴리오·잔고 조회
- [x] (8) 부분 실패 잔고를 빈 결과로 둔갑시키지 않음(독립 Reviewer·QA 검증 완료) [[T-012-zero-price-snapshot]]

### /api/analytics | 분석 API
- [x] (6) 포트폴리오·전략·상위 종목 지표
- [x] (1) 신호 품질 진단

### /api/research | 리서치 API
- [x] (9) 추적 종목 조회·사이클 결과 [[T-032-research-rally-cycle]]
- [x] (9) 종목별 즉시 재계산 [[T-032-research-rally-cycle]]

### /api/favorites | 즐겨찾기 API
- [x] (6) 즐겨찾기 CRUD
- [x] (6) 종목별 차트 분석·기술 지표
- [x] (9) 종목별 리서치 [[T-032-research-rally-cycle]]

### /api/chat | AI 채팅 API
- [x] (6) 스레드·메시지·초안
- [x] (6) 모델 목록

### /api/profile | 내 계정 API
- [x] (7) 프로필·비밀번호 [[T-008-multiuser-auth-step1]]
- [x] (7) KIS 연결 저장·검증 [[T-008-multiuser-auth-step1]]

### /api/backtest | 백테스트 API
- [x] (4) 백테스트 실행·결과 조회
- [ ] (4) 야간 검증 cron·룰별 검증 상태

## 매매 배치 · batch
### stockinvest-cron | 크론 스케줄 루프
- [x] (8) 1분 하트비트 기록 [[T-037-cron-outage-impact-and-watchdog]]
- [x] (8) 일일 잡 날짜파일(성공·실패 무관 하루 1회) [[T-036-news-fetch-observability]]
- [ ] (8) 호출 전체 타임아웃(--max-time)
- [ ] (8) 반복 횟수 대신 벽시계 기준 스케줄
- [ ] (8) scripts/.nfs* 잔재 ignore 등록

### entry-watcher | 진입 감시·자동 주문
- [x] (2) 진입 구간 도달 시 주문 실행
- [x] (0) 킬스위치·주문 한도 fail-closed [[T-001-phase0-safety-foundation]]
- [x] (8) 소수점 수량 정수화·0주 스킵 흔적 [[T-020-fractional-order-quantity-sizing]]

### strategy-eval | 전략 평가·시그널 발화
- [x] (2) 룰 8종·게이트 축소 [[T-006-phase2-implementation]] [[T-003-phase2-pipeline-redesign]]
- [x] (1) 평가 깔때기 계측 [[T-002-phase1-eval-funnel]]
- [x] (8) 주문 동기화 fail-closed [[T-018-order-sync-fail-closed]]
- [x] (8) 부분체결 판정·체결 기록 [[T-019-partial-fill-false-filled]]
- [x] (8) 미체결 연속조회 [[T-023-getactiveorders-pagination]]
- [x] (8) 판단보류 알림 에스컬레이션 [[T-022-order-sync-alert-escalation]]
- [ ] (2) weekly-trend-follow 룰 발화 불가 해소
- [ ] (8) 판단보류 구조적 상태 전이 경보
- [x] (4) 거시 레짐 라벨 기록(C0, 판단 영향 0) — 2026-11-12 운영 배포·기록 확인, 60거래일 관측 중(장기 보관은 아래 T-167) [[T-165-macro-regime-label-c0]]
- [x] (4) 거시 레짐 라벨 장기 보관(전용 표 `macro_regime_label_log`) — 2026-11-12 13:34 DDL·이관(31행)·13:35 운영 배포(0.8.0)·실시간 기록 확인 [[T-167-macro-regime-label-log]]
- [ ] (4) 거시 레짐 승격(C1 AI 참고자료 → B 사이징 계수) — C0 60거래일 관측 뒤 검토, 전면 차단(A)은 승격 금지(T-164 검토 결론)
- [ ] (4) 백테스트 MA100 레짐 필터가 라이브 엔진에 없음 — T-164 검토 중 부수 발견, 미판정
- [ ] (4) 장중 미검증 매수 후보 가상 체결 기록 복구(무제한 한도 모드) — 코드 커밋 `cde5f1d`·QA 통과, **11-14 02:16 운영 배포**·미국 장중 재개 확인, 국내 첫 장중 관측 대기 [[T-168-paper-fill-engine-restore]]

### holding-checker | 보유 점검·청산 엔진
- [x] (8) 자동 청산 마스터 스위치(꺼짐·fail-closed) [[T-015-disable-auto-exit-engine]]
- [x] (8) 포지션 상태(트레일링 고점) 추적 유지 [[T-015-disable-auto-exit-engine]]
- [x] (6) 보유기간 초과 텔레그램 알림
- [ ] (8) 트레일링 활성화 기준값 단일 출처화

### signal-followup | 시그널 후속·만료
- [x] (6) 발화 후 가격 추적(15분)
- [x] (6) TTL 만료 처리(30분)

### portfolio-snapshot | 스냅샷·변동폭 가드
- [x] (0) 시간별 스냅샷·변동폭 가드
- [x] (8) 가격 0 오염 방지 가드·오염행 정리(16행 보관/대상 부재 확인·독립 Reviewer·QA 검증 완료) [[T-012-zero-price-snapshot]]

### trade-report | 정기 거래 리포트
- [x] (6) 앵커 시각 기준 발송(텔레그램·슬랙)
- [x] (8) 텔레그램 종목명 표기 [[T-013-telegram-stock-name]]
- [x] (9) 08:00 리포트 개선 [[T-033-research-recommendation-trade-report]]
- [x] (8) 전송 실패 거짓 성공 제거 [[T-007-telegram-silent-failure]]
- [ ] (8) 텔레그램 간헐 타임아웃으로 승인 요청 유실 해소 [[T-039-alert-dup-and-telegram-timeout]]

### post-market-analysis | 장마감 시나리오 분석
- [x] (2) 국내 16:00·해외 08:00 익일 시나리오 [[T-006-phase2-implementation]]
- [x] (6) 시나리오 시그널 저장

### research-cycle | 리서치 사이클 재계산
- [x] (9) 국내 16:00 재계산 [[T-032-research-rally-cycle]]
- [x] (9) 해외 07:00 재계산 [[T-032-research-rally-cycle]]

### news-fetch | 뉴스 KB 갱신
- [x] (8) 라우트 이관·재시도·실패 알림 [[T-036-news-fetch-observability]]
- [x] (8) M4 주소 교정 [[T-031-news-fetch-m4-500]]
- [~] (8) M4 메타 불일치 근본 수정(API서버 소관) [[T-031-news-fetch-m4-500]]

### sync-stock-meta | 종목 마스터·RS 갱신
- [x] (6) 종목 마스터 17:00 현행화
- [x] (6) RS 레이팅 17:30 갱신

### export-llm-trainset | LLM 학습셋 추출
- [x] (8) 실행 방식 수정(bash 경유) [[T-036-news-fetch-observability]]
- [-] (6) LoRA 학습셋 export 유지

### cron-watchdog | 크론 정지 감시
- [x] (8) 하트비트 5분 정지 시 critical 알림 [[T-037-cron-outage-impact-and-watchdog]]
- [x] (8) Edge 번들 빌드 오류 수정 [[T-037-cron-outage-impact-and-watchdog]]
- [ ] (8) 운영 반영 확인

## 서비스 · service
### stockinvest | 웹앱·API 서버
- [x] (0) 미인증 차단 미들웨어 [[T-001-phase0-safety-foundation]]
- [x] (0) 안전장치 레이어(Kill Switch·모의 매매·주문 한도) [[T-001-phase0-safety-foundation]]
- [x] (8) Next 15 업그레이드(CVE 해소) [[T-005-next15-upgrade]]
- [x] (7) 소유자 KIS 자격증명 이관 [[T-011-owner-account-migration]]
- [x] (8) 알림 조용한 실패 제거 [[T-007-telegram-silent-failure]]
- [ ] (8) 재배포 시 알림 중복 방지 [[T-039-alert-dup-and-telegram-timeout]]

### kis-adapter | KIS 거래소 어댑터
- [x] (6) 국내 주문·잔고·시세
- [x] (6) 해외 주문·잔고
- [x] (8) 초당 유량 제어(우선순위 레인) [[T-017-kis-rate-limit-throttle]]
- [x] (8) 비숫자 수량·가격 어댑터 가드 [[T-027-nonnumber-quantity-guard]]

### llm-gateway | AI·RAG 연동
- [x] (6) LLM 제공자 전환(claude-cli·home-m4-api)
- [x] (2) RAG 검색·시그널 되먹임
- [ ] (8) M4 주소·1단계 AI 필터 정합 [[T-038-llm-base-url-setting]]

## 인프라 · infra
### blue-green-release | 운영 배포
- [x] (8) blue/green 릴리스 컷오버(2026-09-19)
- [x] (8) push 자동 배포·테스트 게이트·헬스체크 롤백
- [ ] (8) 라이브 디렉토리 in-place 빌드 잔존 점검

### commit-msg-hook | 커밋 Reviewer 게이트
- [x] (8) 안전 경로 커밋 시 Reviewer PASS 강제 [[T-025-commit-reviewer-safeguard]]
- [x] (8) noexec 마운트 우회 설치 [[T-025-commit-reviewer-safeguard]]
- [ ] (8) 훅 잔여 Medium·Low 6건

### pm2-boot-recovery | 재부팅 복구
- [ ] (8) pm2 서비스 유닛 마운트 순서 지정
- [ ] (8) 상시 순찰 전환

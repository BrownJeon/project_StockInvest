---
task_id: T-182
title: 거래 리포트 텔레그램 메시지를 핵심 요약으로 줄이고, 「앱에서 자세히 보기」로 여는 리포트 전문 화면 추가
status: done
waiting: [first_summary_0800_check, user_device_app_link_check]
priority: medium
project: StockInvest
created: 2026-11-20
updated: 2026-11-21
base_ref: 72b9729ffd6d1b90ffeacb0c1c2917868c077d81
risk_level: R2
roles_involved: [leader, judge, designer, developer, reviewer, qa, deployer]
related_tasks: [T-091-app-version-gate-and-m2, T-097-price-first-sizing, T-033, T-181-domestic-market-cap-ranking-params]
tags:
  - type/task
  - domain/notify
  - domain/ui
aliases:
  - 거래 리포트 요약
  - 리포트 전문 화면
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: 현황 조사·설계·데모부터 구현·감사·QA·배포까지. 데모 승인 전 화면·메시지 코드 작성 금지, DB 마이그레이션·배포는 사용자 승인 후
  last_event_id: E5
demo_gate:
  required: true
  level: "full"
  status: "approved"
  version: 1
  repo_path: "mockups/T-182-trade-report-v1.html"
  artifact_url: ""
  content_sha256: "b8df41ca7cd8e17dad37fba4702ee4f522231b18cd7cb978fc07fdcba9d21b39"
  decided_by: "judge"
  rule_id: "JV-ui_change"
  approved_by: "user"
  approved_at: "2026-11-20T22:52:49+09:00"
  approval_quote: "권고안으로 v1 승인"
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: true
---

# T-182 거래 리포트 요약 + 리포트 전문 화면

## 목표·배경 (Leader)

매일 08:00 KST 텔레그램으로 가는 「📊 거래 리포트」가 너무 길어 읽히지 않는다(사용자). 텔레그램에는 핵심만 보내고, 상세는 「👉 앱에서 자세히 보기」로 여는 **새 리포트 전문 화면**에서 보게 한다.

### 확인한 사실 (메인 세션, 2026-11-20 22:2x~22:40 KST, 읽기 전용)

- 생성: `src/lib/reports/trade-report.ts` `formatReportMessage()`(순수 함수) ← `src/app/api/cron/trade-report/route.ts` POST. `mrkdwnToTelegramHtml` 로 변환해 `sendTelegramAlert`. [확실]
- 설정(`system_config`): `report_trade_mode=fixed`·`anchor_kst=08:00`·`channel=telegram`·`enabled=true`. 11-20 발송 시각 08:04:53 KST. [확실]
- **보낸 원문을 어디에도 저장하지 않는다** — 로그에는 `trade-report OK` 한 줄뿐. [확실]
- 11-20 08:04 리포트를 운영 코드(`72b9729`)·운영 DB 읽기 전용으로 재현(NOW() 를 08:04 로 고정, KIS 시세 호출 차단, 보유·리서치는 재현 시점 값): **64줄·약 1,900자**. 매수 후보 15줄(전부 `blocked:portfolio_guard` — [[T-181-domestic-market-cap-ranking-params]] 의 원인과 같은 가드)·보유 6종목 상세 17줄이 대부분. [확실 — 재현본 기준]
- 「📉 매도 손익」 섹션은 **체결이 아니라 매도 시그널**(`signals` 25h)에서 온다. 재현본: 체결 매도 0건인데 「매도 손익 총 −₩1,279,200」(삼성전자 마감손절 신호 2건 −22.94%·−18.40%), 같은 종목 보유 현황은 고점대비 −1.05%·13주 보유. 실제 손익처럼 읽힌다. [확실] 두 수치의 기준 차이 원인은 미조사.
- 앱 링크: `AndroidManifest.xml:83` intent-filter 는 사이트 루트 `/` **정확 일치 한 경로뿐**. 다른 경로 링크는 앱이 아니라 Chrome 으로 열린다. 앱이 열리면 `src/lib/native/appLink.ts` `resolveAppLinkTarget` 이 받은 주소(경로+쿼리)로 WebView 를 옮긴다. [확실]
- 리포트 전용 웹 화면은 없다(`src/app/**/page.tsx` 목록). [확실]
- 재현 중 부작용 1건: 재현 스크립트가 `src/lib/db.ts` `ensureSetup()`(부팅 때와 같은 멱등 DDL·조건부 UPDATE)을 운영 DB 에 실행했고 연결 종료로 오류 끝남. 직후 `/api/health` ok·`schemaFatal:false`·pm2 두 앱 restarts 0. 치명 알림 발송 여부 [추측: 없음 — 판정 플래그 조건 불충족 가능성 높음]. 앞으로 재현 스크립트는 `ensureSetup` 을 막는다.

### 관련 과거 이력 요약

- [[T-091-app-version-gate-and-m2]]: 텔레그램 「🔗 앱에서 자세히」 = 루트 App Link(1.1.0). 경로 추가는 네이티브 변경(APK 재빌드·versionCode·재설치).
- [[T-097-price-first-sizing]]: 텔레그램 문구 변경도 데모 게이트 대상(선례 `mockups/T-097-telegram-sizing-line-v1.html`).
- T-033: 리포트에서 평가 깔때기를 빼고 리서치 요약으로 대체(대시보드에는 유지). 「익절 임박」 오독 문구 제거 이력.
- 교훈: LSN-0009(화면 검증은 단언 스크립트 1회로) · LSN-0003(배포까지 확인해야 조치 완료). `/이슈기록 관련` telegram·데모·migration 은 해당 없음.

## 사용자 지시·승인 (원문 보존)

- 2026-11-20: 「거래 리포트 메시지에 대하여 내용이 너무 많아서 읽고 싶지 않은 정도로 내용이 많은데 내용을 핵심만 간결하게 정리해서 보내주는 방안의 작업을 할 수 있어?」
- 선택지 A(요약 + 앱 링크)·B(섹션별 상한)·C(두 통 분리) 제시 → 「A안으로 했을때 오늘 발송했던 메시지를 기준으로 샘플 생성해서 알려줘」
- 링크 이동처 선택지(1 새 리포트 화면 · 2 홈 · 3 앱 링크 경로 추가) 제시 → 「새 리포트 화면(권고)」
- 데모 v1(결정 ①~④ 권고안 표시) 제시 → **「권고안으로 v1 승인」**(2026-11-20 22:52, `check.mjs approve` 기록). 결정 ①~④ 모두 권고안 확정.
- 구현·Reviewer PASS·QA PASS 보고 뒤 「테이블 생성과 배포(내일 05:10~07:30)를 승인할까요?」 → **「둘 다 승인」**(2026-11-21 10:14 KST 수신). 범위: ① 운영 DB 에 `scripts/migrations/T-182-trade-report-archive.sql` 적용 ② 커밋·PR·main 반영(=배포). 답을 받은 시각에 권고 창(05:10~07:30)은 지났고, 2026-11-21 은 토요일이라 국내·미국 시장이 모두 닫혀 있어(권고 창을 둔 이유 = 장중·08:00 발송 회피) 바로 진행한다.

## 설계 확정 (Leader, 2026-11-20 데모 v1 승인 후 — Developer 구현 사양)

화면·문구는 `## Designer` 의 **v1 구현 가이드**가 정본이다. 아래는 서버·데이터·발송 쪽 사양이다.

1. **원문 보관 테이블**(새 마이그레이션 `scripts/migrations/T-182-trade-report-archive.sql` — `SAFETY_PATHS`, 운영 적용은 사용자 승인): 회차 1행. 최소 컬럼 = `id`(PK) · `sent_at` · `range_start` · `range_end` · `is_test`(force=1 시험 발송) · `delivered`(텔레그램/슬랙 중 1곳 이상 성공) · `summary_text`(보낸 요약) · `full_text`(지금 형식 전문 — 보존용) · `payload` JSON(화면 렌더용 구조화 데이터, 필드는 Designer 가이드) · `created_at`. 인덱스 `(is_test, delivered, sent_at)`. 부팅 DDL(`src/lib/db.ts`)에 넣지 않는다(T-179 부팅 DDL 경합 이력).
2. **발송 흐름**(`src/app/api/cron/trade-report/route.ts` — `SAFETY_PATHS`): 보고서 계산 → 보관 행 INSERT(id 확보) → 요약 + 버튼 발송 → `delivered` 갱신. 버튼은 기존 `sendTelegramMessage(text, replyMarkup)`(`src/lib/notify/telegram-api.ts`, 수정하지 않고 import 만) 로 단다. URL = `system_config.app_public_url` + `?open=report&id=<id>`, https 검사는 승인 메시지와 같은 규칙. 
   - **실패 시 리포트를 잃지 않는다**: 보관 INSERT 실패(테이블 없음 포함) → 버튼 없는 요약을 보내고 오류 로그(테이블 마이그레이션 전 배포돼도 동작). `app_public_url` 없음 → 버튼 생략. 버튼 포함 발송이 400 이면 버튼 없이 1회 재시도.
   - 기존 의미 보존: 전송 실패 시 `last_sent_at` 미갱신·재시도, `force=1` 은 `last_sent_at` 미갱신(+`is_test=1`). 채널 판정·소급 한도 로직은 그대로.
   - Slack(`slack`·`both`)도 같은 요약 본문 + 링크 한 줄(버튼 없음).
   - 보관 기간 1년: 발송 성공 뒤 `sent_at < NOW() - 365일` 행 삭제(한 번에 상한 두고).
3. **요약 메시지 조립**: `trade-report.ts` 에 새 순수 함수(예: `formatReportSummary`)를 추가하고 `formatReportMessage` 는 `full_text` 보존용으로 남긴다. 「매도 손익」→「매도 신호 · 미체결 / 신호 기준」 문구는 요약과 화면 모두 적용(전문 `full_text` 는 기존 형식 그대로 보존할지 Developer 판단 — 문구 오독 방지를 위해 새 문구 권장).
4. **화면**: `/report`(Designer 가이드의 경로 권고 따름) + 조회 API(`/api/reports/trade` 류). 접근 모델은 기존 운용현황과 같다(로그인 사용자 전원 — 미들웨어 보호) + 라우트에서 `requireUserId` 이중 검증. `is_test=1`·`delivered=0` 행은 목록·회차 이동에서 제외(단 id 직접 지정은 delivered 무관 표시 허용 여부는 Developer 판단, 기록). 미들웨어·`/app/download/` 는 건드리지 않는다.
5. **링크 수신**: 홈 `/` 가 `?open=report&id=<숫자>` 를 받으면 `/report?id=<숫자>` 로 이동(클라이언트, 숫자 검증, 그 밖 값 무시). `appLink.ts`·`AndroidManifest.xml` 은 바꾸지 않는다(네이티브 변경 없음). 로그인 전이면 로그인 후 되돌아오는 경로에 쿼리가 보존되는지 확인(`src/lib/safe-next-path.ts` 는 `SAFETY_PATHS` — 바꿔야 하면 멈추고 Leader 에 보고).
6. **시험**: 요약 조립 순수 함수(경고 0건·총자산 조회 불가·매도 신호·해외 종목명 축약·12줄 목표 vs 경고 우선), 발송 흐름(보관 실패 시 버튼 없는 요약·400 재시도·force·last_sent_at), API 인증·제외 규칙, 홈 쿼리 이동 검증. 기존 trade-report 시험은 깨지지 않게.
7. **범위 밖**: 매도 신호 손익률과 보유 고점대비의 계산 기준 차이 원인(별건 후보), 국내 매수 후보 전면 차단 원인([[T-181-domestic-market-cap-ranking-params]]).

## 설계 초안 (Leader — 데모 전, 이력)

1. **요약 메시지**(텔레그램): 헤더(시각·기간) · 총자산과 변동 · 체결 수 · ⚠️ 확인 필요(손절 임박·회전매매·총자산 조회 불가·매도 신호 미체결·매수 후보 전면 차단 등 — **0건이 아니면 반드시 표시**) · 보유 종목 수와 조치 필요 수 · 리서치 매수 고려 종목명 · 「👉 앱에서 자세히 보기」 버튼. 목표 약 12줄.
2. **리포트 원문 보관**: 발송 때 상세 데이터(지금의 전문 + 구조화 JSON)를 새 테이블에 저장 → 마이그레이션(사용자 승인 사항). 「원문이 남지 않는」 문제도 해소.
3. **리포트 전문 화면**: 새 웹 화면(경로 후보 `/report`, 탭 밖 상세 화면). 최근 리포트 표시, 이전 회차 선택은 데모에서 결정.
4. **링크**: 루트 + 쿼리(`/?open=report&id=…` 형태)로 보내 앱이 열린 뒤 화면 이동 — 네이티브 변경 없이[가능성 높음: Android `android:path` 는 쿼리를 보지 않음, **실기기 확인 필요**]. 브라우저(PC 텔레그램)에서 눌러도 같은 화면(로그인 필요).
5. 「매도 손익」 문구를 「매도 신호(미체결)」 등으로 바로잡을지는 데모에서 사용자 결정.

결정 대기(데모에서): 요약 항목·순서 · 화면 구성 · 이전 회차 보기 여부 · 매도 신호 문구 · 보관 기간.

## Judge

- [2026-11-20 22:38 KST] intake engine=jev → task_type=feature · complexity=2.75 · risk=R2 · developer_model=opus · next=ask_user (blocking_gate=requirements, needs_info noul 0.76) · demo=full/designer(JV-ui_change; DM-kw-full, DM-kw-risky-cta) · next_actions=clarify_requirements,prepare_demo,request_demo_approval,assign_developer · roles=designer,developer,reviewer,qa | overrides=없음 | fallback=- | tokens=1332
  - 입력 범위: 요약 1건 + 예상 변경 경로 2건(`src/lib/reports/trade-report.ts`, `src/app/api/cron/trade-report/route.ts`). 코드·DB 원문은 보내지 않음.
  - 도구 결과 파일: `/private/tmp/claude-501/-Volumes-homes-brownjeon-project-StockInvest/33bc2213-a899-4347-b02e-d272ad76d2fb/scratchpad/judge-T-182-intake.out.json`
  - Codex C1: 미실행. intake 단계에는 Codex 게이트가 없고, C1은 설계가 확정된 뒤(구현 전) `codex_gate`로 호출한다. 현재 설계는 데모 승인 전 초안이다.
  - 다음: 도구가 `ask_user` 를 냈으므로 Leader가 요구사항 보완을 사용자에게 묻는다(도구는 부족한 항목을 명시하지 않았다).
- [2026-11-20 22:57 KST] codex_gate/C1 engine=jev → codex_required=true · mode=adversarial-review · focus=security · budget_rule=CX-limit-unknown-r2 (remaining_limit_pct=null, codex-review limit stale 2026-09-27) · codex_calls_used=0 · codex_switch=on | overrides=없음 | fallback=- | tokens=906
  - 도구 결과 파일: `/private/tmp/claude-501/-Volumes-homes-brownjeon-project-StockInvest/33bc2213-a899-4347-b02e-d272ad76d2fb/scratchpad/judge-T-182-c1.out.json`
  - 호출 판단: 도구가 Codex 개입을 요구했다. 아직 Codex 를 실행하지 않았으며, Leader 가 codex 에이전트를 호출한다. 한도 정보는 stale 이라 알 수 없다(도구 규칙에 따라 R2 한도 불명 규칙 적용).
- [2026-11-20 23:43 KST] codex_gate/C2 engine=jev → codex_required=true · mode=adversarial-review · focus=data_integrity · budget_rule=CX-limit-unknown-r2 (remaining_limit_pct=null, limit stale 2026-09-27) · codex_calls_used=1 · codex_switch=on | overrides=없음 | fallback=- | tokens=1116
  - 도구 결과 파일: `/private/tmp/claude-501/-Volumes-homes-brownjeon-project-StockInvest/33bc2213-a899-4347-b02e-d272ad76d2fb/scratchpad/judge-T-182-c2.out.json`
  - 호출 판단: 도구가 C2 Codex 개입을 요구했다. Codex 는 아직 실행하지 않았다(Leader 가 codex 에이전트 호출). 사용 횟수 1은 도구가 집계한 기록값으로, C1 의 실패한 시도가 포함됐을 수 있다(도구 근거 미확인). C1 은 서버 설정 오류(model_not_found)로 incomplete 이며 C2 로 대체되지 않는다.

## Designer

- [22:52] 실행 도구: claude(designer 서브에이전트). 데모 v1 `mockups/T-182-trade-report-v1.html` 작성 → lint `DEMO_LINT_PASSED` → `check.mjs status --to review_requested --version 1`(sha256 `b8df41ca7cd8…`). Artifact 게시는 하지 않음(역할 규칙상 Leader 담당). approve 안 함.
- [22:52] 데모 구성: ① 텔레그램 지금(재현 구조, 68줄) vs 제안 요약(13줄 + 「👉 앱에서 자세히 보기」 버튼) ② 리포트 전문 화면(412px 우선·360·1280px 전환, 위 총자산·확인 필요, 아래 섹션 접기/펼치기, 상태: 정상·확인 0건·총자산 조회 불가·로딩·빈·오류·로그인 필요·보관 기간 지남) ③ 결정 4가지 A/B(각 권고 표시, 선택이 미리보기에 즉시 반영) ④ 확인 필요 종류 표·버튼 흐름 ⑤ 지금 vs 제안 표. 금액·수량·투자금·비율·희망가는 모두 예시 값으로 교체, 「예시 수치」 표시.
- [22:52] 권고: ① A 순서(총자산→체결→확인 필요→보유→리서치) + 제목 줄에 「⚠️ 확인 n」, 면책 줄은 끄고 종목 줄에 「리서치 참고용」 ② A 「매도 신호 · 미체결」+「신호 기준」 ③ 회차 이동 넣기 + 보관 1년 ④ 1건 이상이면 종류별 한 줄로 반드시 표시, 0건이면 「✅ 확인 필요 없음」 한 줄.
- [22:52] Leader 전달(결정 아님): 공통 `sendTelegramAlert` 는 인라인 버튼을 붙이지 않음[확실] → 발송 경로 변경 필요 · 공통 제목 줄과 본문 첫 줄이 같은 말을 반복(제안에서 합침) · Slack 채널 포함 시 본문 처리 미정 · 매도 신호 손익률과 보유 고점대비의 기준 차이 원인 미조사 · 해외 종목 요약용 짧은 이름 규칙 미정 · 기존 승인 메시지 버튼 문구는 「🔗 앱에서 자세히」(이번은 지시대로 다르게 둠).
- [22:52] 디자인 스킬: Impeccable(앱 운영·읽기 화면 설계 — 이유: 기존 앱의 새 상세 화면) operate·mode-operate·mode-read·craft-floor 지침 적용, 실행기(`impeccable context`)는 엔진 내려받기가 필요해 미실행 + 워크스페이스 page-layout-designer·ui-component-builder·ui-design-reviewer·ui-accessibility-reviewer 읽음 / 자체 점검 P0 0·P1 0·P2 1(데스크톱 「모두 펼치기」 단독 줄 여백), a11y Critical 0·Major 0·Minor 1(미리보기 하단 메뉴는 데모용 비링크 텍스트) / 헤드리스 크롬으로 360·412·1280px 미리보기 넘침 0건·11px 미만 글자 0건·44px 미만 터치 0건 확인, 360px 안전 상태 띠 잘림 1건 발견해 줄바꿈으로 수정. 실기기 확인·사용자 승인 미실행.
- [22:58] **구현 가이드 — 승인 데모: mockups/T-182-trade-report-v1.html (v1, sha256 `b8df41ca7cd8e17dad37fba4702ee4f522231b18cd7cb978fc07fdcba9d21b39`, 사용자 「권고안으로 v1 승인」 11-20 22:52) · 결정 ①~④ 모두 권고안 확정.** 적용 토큰: `--bg` `--bg2` `--bg3` `--bg4` `--border` `--border2` `--text` `--muted` `--up` `--down` `--accent` `--warn` `--danger` `--ok` `--nav-h` `--safe-top` `--safe-bottom`, 숫자 `.num`, 등락 `.up`/`.down`. 새 토큰 없음. 실행 도구: claude(designer). 코드 미작성.
  - **0. 레이아웃 설계** — 목표: 매일 리포트를 「확인할 것이 있는가 → 총자산 변동 → 필요하면 상세」 순서로 읽게 한다. 위계: ① 총자산·확인 필요 ② 섹션 요약 줄(접힌 상태에서도 핵심 수치가 보임) ③ 섹션 상세 ④ 보낸 원문. 행동: 읽기 전용 — 주문·승인·설정 CTA 없음(추가 금지). 보조 행동: 확인 필요 행 → 해당 섹션 펼침·이동, 모두 펼치기/접기, 회차 이동, 뒤로.
  - **1. 텔레그램 요약 메시지**(`formatReportMessage` 를 대체하는 요약 조립 — 지금 전문 조립은 앱 화면용 데이터·원문 보관에 쓰일 수 있으니 삭제 여부는 developer 판단)
    - 제목(공통 래퍼 `sendTelegramAlert` 의 `title` 인자): `거래 리포트 · {MM/DD HH:mm} (최근 {N}시간)` + 확인 필요 n≥1 이면 ` · ⚠️ 확인 {n}`. 래퍼가 `[{태그}] ℹ️ ` 를 앞에 붙이고 `🕐 {발송시각} KST` 를 뒤에 붙인다(그대로 둠). **본문 첫 줄 「📊 거래 리포트 (24h)」·「🕐 분석 기간」 줄은 없앤다**(제목과 중복). `force` 테스트 발송의 `[테스트] ` 접두는 유지.
    - 본문 순서(블록 사이 빈 줄 1개, 빈 블록은 빈 줄도 없음):
      1. `💰 총자산 ₩{total}  ({±pct}%, {±₩delta})` — 기간 시작 스냅샷 없으면 `💰 총자산 ₩{total}  (기간 시작 스냅샷 없음)`, 조회 불가면 `💰 총자산 조회 불가 (기간 시작 ₩{base})`(base 없으면 괄호 생략). **0원·−100% 로 쓰지 않는다**(T-056 원칙 유지).
      2. `🔁 체결 없음 (매수 0 · 매도 0)` / 체결 있으면 `🔁 체결 매수 {b}건 ₩{amt} · 매도 {s}건 ₩{amt}`. 체결 매도가 있으면 다음 줄 `   실현 손익 {±₩}`(지금 LIFO 규칙 그대로 — 원가 미상 건이 있으면 「일부 원가 미상」 표기, `matched=0` 이면 숫자 대신 「원가 미상」).
      3. 확인 필요 블록: n≥1 → `<b>⚠️ 확인 필요 {n}</b>` + 종류별 한 줄 `• …`(아래 순서). n=0 → `✅ 확인 필요 없음` 한 줄. **n≥1 이면 줄 수 목표보다 우선해 전부 표시**(종류별 1줄로 묶음, 종목은 줄 안에 나열).
      4. `📦 보유 {k}종목 — 손절 임박 {x} · 매도 고려 {y}` (보유 0 → `📦 보유 없음`, 조회 실패 → 줄 생략하고 확인 필요에 「보유 정보를 읽지 못함」).
      5. `🔬 매수 고려 {m}종목 (리서치 참고용): {이름} · {이름} …` (m=0 → 줄 생략, 리서치 조회 실패 → 줄 생략. 면책 줄은 넣지 않는다 — 결정 ① 권고).
    - 확인 필요 종류·순서·문구(데모 4절 표): ① `총자산 조회 실패 — 증권사 잔고·환율을 읽지 못함` ② `손절 임박 {x}종목: {이름}(고점대비 {pct}%) …` — 기준 지금 그대로 `profitPct <= -1.5` ③ `{이름} 매도 신호 {c}건 미체결 ({종류} · 신호 기준 {±₩합})` — 종목별 1줄, 종류 라벨은 지금 `exitLabel`(손절·트레일링 스탑·목표 익절·마감손절·AI매도) ④ `회전매매: {이름}, …` — 지금 `churnSymbols` 조건 그대로 ⑤ `매수 후보 {c}종목 전부 차단 ({사유})` — 후보 ≥1 이고 전부 `blocked` 일 때, 사유는 `skipReason` 이 모두 같으면 사람말 라벨(예: 포트폴리오 보호), 다르면 「사유 여러 가지」 ⑥ `{보유|매수 후보|리서치} 정보를 읽지 못함 — 0건이 아님`. 사유 라벨 매핑 표는 developer 가 기존 `reason-copy.ts` 계열에 있으면 재사용.
    - 「매도 신호·미체결」(결정 ②): 체결되지 않은 신호만 ③ 으로. 신호가 체결됐으면 확인 필요에서 빼고 2번 체결 줄에 포함. **「매도 손익」이라는 말은 요약·화면 어디에도 쓰지 않는다.** 신호↔체결 연결 키는 아래 데이터 절 `signalId`·`filled` — 지금 `SellPnl` 에 없다(조회 추가 필요).
    - 해외 종목명 축약(요약 메시지에서만, 앱 화면은 전체 이름): 기본은 한글명이 있으면 한글명, 해외 영문명은 **첫 단어**(예: MICRON TECHNOLOGY INC → MICRON, SYNOPSYS INC → SYNOPSYS). 단 (a) 이름에 `ETF`·`ETN`·`TRUST`·` TR ` 포함, (b) 첫 단어 3자 이하, (c) 같은 메시지 안에서 첫 단어가 겹침 → **티커**(심볼 `NAS:SMH` 의 콜론 뒤)로 쓴다. 한글·국내명은 자르지 않는다.
    - 버튼: 인라인 키보드 1행 1버튼 `👉 앱에서 자세히 보기`, url = `{app_public_url}?open=report&id={reportId}`(설계 4번, 앱 루트 App Link + 쿼리 — 실기기 확인 필요). `app_public_url` 이 없거나 https 가 아니면 버튼 생략(지금 승인 메시지의 `/^https:\/\/[^\s]+$/i` 검사와 같게). 공통 `sendTelegramAlert` 는 `reply_markup` 을 못 보내므로 발송 경로 확장 필요(방식은 developer).
    - 줄 수 기준: 데모 기본 예시 13줄(제목·꼬리 포함, 빈 줄 포함). 상한을 코드로 자르지 않는다 — 확인 필요는 잘리면 안 됨.
    - parse_mode=HTML: 종목 이름·사유 문자열은 이스케이프(지금 `mrkdwnToTelegramHtml` 의 이스케이프 원칙 유지).
  - **2. 리포트 화면 — 경로·진입**
    - 권고 경로: **`/report?id={reportId}`**(쿼리), `id` 없으면 최신 회차. 동적 세그먼트(`/report/[id]`)보다 권고하는 이유: 페이지 파일 1개, 회차 이동을 `router.replace` 로 바꿔 **뒤로 버튼이 이전 회차가 아니라 이전 화면으로** 가게 하기 쉽다. `id` 는 불투명 정수(날짜를 쓰지 않음). 숫자 형식이 아니면 최신으로 보내지 말고 「찾을 수 없음」(= 보관 기간 지남 화면과 같은 틀, 문구 「이 리포트를 찾을 수 없습니다」).
    - 앱 링크 `/?open=report&id=…` → 루트 화면이 `open=report` 를 보면 `id` 를 숫자 검사 후 `router.replace('/report?id=…')`. 그 외 `open` 값은 무시(임의 경로로 보내는 열린 리다이렉트 금지).
    - 로그인 필요: 미들웨어 기존 흐름으로 `/login?next=/report?id=…` — `sanitizeNextPath`(`src/lib/safe-next-path.ts`, 커밋 감시 경로)가 쿼리 포함 경로를 허용하는지 developer 확인. 바꿔야 하면 그 파일 변경은 Reviewer 판정 대상.
    - 탭 밖 상세 화면: `BottomTabs` 는 그대로 보이고 활성 탭 없음(`/markets` 와 같은 처리 — `TABS.matches` 에 `/report` 를 넣지 않는다). `docs/screens.md` 에 「탭 밖 화면 — /report(거래 리포트, 텔레그램 버튼 진입)」 한 줄 추가.
  - **3. 리포트 화면 — 구조**(데모 `#app` 의 `body()` 기준, 위→아래)
    - 머리(`.ah`): 뒤로(44px, `aria-label="뒤로"`, `router.back()` — 기록 없으면 `/`) · 제목 「거래 리포트」 · 부제 `{MM/DD (요일) HH:mm} 발송 · 최근 {N}시간`. 기존 뒤로 버튼들은 「←」 문자·인라인 스타일이라 재사용하지 않고, 데모처럼 `NavIcons.tsx` 계열 SVG 아이콘(chevron-left)을 쓴다 — 없으면 `NavIcons` 방식으로 Lucide 경로 인라인 추가.
    - 회차 이동(`.hist`, 결정 ③ A): ‹ 이전 · 날짜 select(`aria-label="리포트 회차 선택"`, 항목 `MM/DD (요일) HH:mm`, 최신에 「· 최신」) · 다음 ›. 가장 옛 회차에서 이전 disabled, 최신에서 다음 disabled. 바꿀 때 `router.replace`. 목록은 보관 중 회차 최근 N개(권고 60개, 더 옛것은 select 끝 「더 보기」 없이 생략 — 필요 시 후속).
    - 지금 안전 상태 띠: 기존 `MiniStrip`(`src/components/ops/ui/MiniStrip.tsx`, 분석 탭의 짧은 머리 띠)을 재사용 — 「리포트 시각이 아니라 지금 값」이 드러나게 title 을 「지금」 계열로. 데이터는 `useSafetyState`. 360px 에서 잘리지 않고 줄바꿈되는지 확인(데모에서 잘림 1건을 줄바꿈으로 고쳤다).
    - 본문 `.abody`: 왼쪽 요약 열(`.colsum`) + 오른쪽 상세 열(`.coldet`). 412px 은 한 열(요약 → 상세), **≥900px 은 2열**(요약 열 340px, `position: sticky`, 전체 최대 1100px 가운데), 하단 바는 기존처럼 가운데 720px.
    - 요약 카드: 총자산(라벨 `총자산 · {MM/DD HH:mm} 기준`, 값 24px 굵게, 등락 `▲/▼ {pct} · {±₩}` 에 `.up`/`.down` — 색만으로 구분 금지라 부호·화살표 함께, 아래 `기간 시작 ₩{base} ({시각})`) + 3칸(체결 n건 · 보유 n종목 · 매수 고려(참고) n종목). 조회 불가면 값 자리에 「조회 불가」 + 「…확인하지 못했습니다. 0원이 아닙니다.」.
    - 확인 필요 카드: 기존 `Section`(`src/components/ops/ui/Section.tsx`) + `CheckRow`(`src/components/ops/ui/CheckRow.tsx`, severity `e`=조회 실패·`w`=그 외, glyph `!`) 재사용. 제목 옆 건수 칩. 행 탭 → 해당 섹션 `<details>` 를 열고 스크롤·포커스(요약 줄). 0건 → 한 행 「확인할 것 없음 — 총자산 조회·손절 임박·미체결 신호·회전매매·후보 전면 차단 모두 0건」(✓, 성공색). `CheckRow` 가 `href` 이동만 지원하면 같은 페이지 앵커(`#r-sell`)로 쓰고 열기는 `hashchange` 에서 처리.
    - 상세 섹션(네이티브 `<details>/<summary>`, 요약 줄 min-height 56px, 오른쪽에 접힌 상태 요약 `meta`): 순서 **거래 요약 → 매도 신호 → 보유 → 매수 후보 → 리서치 참고 → 보낸 요약 원문**. 「모두 펼치기/접기」 버튼(44px)은 섹션 목록 위 오른쪽.
      - 거래 요약: 매수 n건·₩ / 매도 n건·₩ / 실현 손익(체결 기준, 원가 미상 규칙 유지) / 회전매매(없음 또는 종목).
      - 매도 신호: 제목 「매도 신호」 + 칩 「미체결」(미체결 ≥1 일 때), meta `{c}건 · 신호 기준 {±₩합}`, 맨 위 설명 「체결된 매도가 아닙니다. 매도 신호가 만들어질 때 계산한 값이며…실제 손익은 체결된 뒤 「거래 요약」의 실현 손익에 잡힙니다.」 행: 이름 + `{종류} 신호 · 체결 안 됨|체결됨` / 오른쪽 금액(`.down`/`.up`) + 작은 `신호 기준 {pct}`. 0건 → 「이 기간에 만들어진 매도 신호가 없습니다.」
      - 보유: meta `{k}종목 · 손절 임박 {x} · 매도 고려 {y}`, 설명 「고점대비는 보유 중 최고가와 비교한 등락입니다. 수익률이 아닙니다. 손절 임박 기준: 고점대비 −1.5% 이하.」(T-033 오독 방지 — 「익절 임박」 문구 부활 금지). 행: 이름 + 수량 / 고점대비(색+부호) / 아래 줄 투자금(해외는 `formatDisplayAmount` 규칙 그대로, 환산 불가 문구 유지) · 최근추이 · 매도 판단(`formatSellSignalLine` 의미) · 보유 일수(`formatHoldingInfoLine` 의미). 손절 임박 종목은 행 앞에 `CheckRow` 와 같은 `!` 표시를 붙이고 맨 위로.
      - 매수 후보: meta `{c}종목 · 전부 차단` 또는 `대기 a · 차단 b`, 설명에 차단 사유·「새 매수 신호가 나가지 않습니다」(전부 차단일 때)·RSI 없음 수, 종목은 칩 목록(이름 + 상태 글자 대기/AI승인/AI거절/차단 — 지금 `statusLabel`). RSI·EV·AI신뢰도가 있으면 칩 안에 작게.
      - 리서치 참고: meta `추적 {tracked} · 매수 고려 {m}`, **맨 위에 면책 전문(`research.note`) 항상 표시**, 행: 이름 + 기준일 / 「매수 고려」 / 근거(`formatBuyEvidence` 의미) · 가격(`formatTargetFragment` 의미 — 희망가·기준·기한). 판단 보류 종목도 지금처럼 「판단 보류 (건수 적음…)」 행으로.
      - 보낸 요약 원문: meta `텔레그램 · {줄}줄 · 보관됨`, `<pre>` 고정폭 12px·줄바꿈 허용. 발송 실패 회차면 meta `발송 실패 — 화면 기록만` + 칩.
    - **기본 펼침 규칙**: 확인 필요 항목이 가리키는 섹션만 처음부터 펼침(미체결 신호 → 매도 신호, 전부 차단 → 매수 후보, 손절 임박 → 보유, 회전매매 → 거래 요약, 섹션 조회 실패 → 그 섹션). 확인 필요 0건이면 전부 접힘. 사용자가 바꾼 펼침 상태는 회차 이동 때 초기화.
    - 상태 변형(데모 「샘플 상태」 그대로): 로딩 = 자리 표시 막대(`SkeletonRows`·`SkeletonTile`·`SkelBar` 재사용, 가운데 스피너 금지, `aria-busy`) / 빈 = 「아직 보관된 리포트가 없습니다」 + 보관은 배포 뒤 첫 발송부터라는 설명 + 「홈으로」 / 오류 = 「리포트를 불러오지 못했습니다 · 비어 있는 것이 아닙니다」 + `RetryButton`, 회차 이동은 계속 보임 / 로그인 필요 = 미들웨어 리다이렉트가 기본, 화면 안에서 401 을 받으면 「로그인이 필요합니다」 + 로그인 버튼(next 포함), 회차 이동·안전 띠 숨김 / 보관 기간 지남·없는 id = 「보관 기간이 지난 리포트입니다」(보관 1년) + 「최신 리포트 보기」 / 부분 실패 = 해당 섹션 안에 오류 행(`StatusChip kind="error"`), 다른 섹션은 정상 표시.
  - **4. 화면에 필요한 데이터 필드(발송 시 저장할 최소 집합 — 저장 방식·테이블 설계는 developer/leader)**
    - 회차: `reportId`(불투명 정수) · `sentAt`(발송 시각) · `rangeStart`·`rangeEnd` · `channel`·`deliveryOk`(채널별 성공 여부) · `summaryText`(실제 보낸 요약 원문) · `schemaVersion` · `ownerUserId`(다사용자 — 본인 회차만 조회, 서버 권한 판단).
    - 총자산: `totalKRW | null`(null = 조회 불가) · `baselineKRW | null` · `baselineAt | null`.
    - 체결: `buys`·`buysAmountKRW`·`sells`·`sellsAmountKRW`·`lifoPnlKRW`·`matchedSellCount`·`unmatchedSellCount`·`churnSymbols[]`.
    - 매도 신호(행마다): `signalId` · `symbol` · `name` · `exitKind` · `pnlPct` · `pnlKRW` · `signalAt` · `filled`(체결 여부 — **신규**, 지금 `SellPnl` 에 없음).
    - 보유(행마다): `symbol` · `name` · `market` · `qty` · `profitPct`(고점대비) · `periodChangePct | null` · `investedKRW` · `investedDisplay`(해외 표시 금액·통화·환산 불가 여부) · `sellSignal` 표시용(판단·근거 문구 재현에 필요한 값) · `holdingDays | null`.
    - 매수 후보(행마다): `symbol` · `name` · `status` · `skipReason` · `rsi | null` · `evPct | null` · `aiConf | null`.
    - 리서치: `trackedCount` · `activeCount` · `note`(면책 전문) · 항목마다 `symbol` · `name` · `market` · `asOfDate` · `buy`(action·근거 문구 재현 값: 규칙·적중률·건수·lift·신뢰도) · `targets`(희망가·통화·기준·기한).
    - 섹션 조회 결과: `coverage = { asset, holdings, candidates, research, signals }` 각 `ok | failed` — 실패를 0건과 구분하기 위한 필드(필수).
    - 이름(`name`)은 발송 시점 라벨로 저장(나중에 라벨이 바뀌어도 그날 본 이름 유지). 금액은 원 단위 정수, 비율은 소수.
  - **5. 생성/수정 파일(예상 — 최종은 developer)**: `src/app/report/page.tsx`(+ 화면 컴포넌트, 위치는 `src/components/report/` 권고) · 루트 화면의 `open=report` 처리 · 리포트 조회 API Route(`{ ok, data | error }`, 로그인·본인 회차) · `src/lib/reports/trade-report.ts`(요약 조립·축약 규칙·확인 필요 판정 — 순수 함수로) · `src/app/api/cron/trade-report/route.ts`(저장·버튼 발송) · 텔레그램 발송 경로(버튼) · `docs/screens.md`. 커밋 감시 경로(`SAFETY_PATHS`)에 걸리는지는 developer 가 `awk` 명령으로 확인.
  - **6. 구현 순서 권고**: ① 확인 필요 판정·요약 조립·축약 규칙(순수 함수 + 시험: 기본·0건·총자산 null·체결 있음·축약 충돌) ② 저장(마이그레이션은 사용자 승인) ③ 조회 API ④ 화면(상태 변형 포함) ⑤ 버튼 발송·`open=report` 진입 ⑥ screens.md.
  - **7. 주의**: 읽기 전용 화면 — 주문·승인·안전장치 토글 넣지 않음 / 0·빈 목록과 조회 실패를 반드시 구분 / 등락은 색+부호(▲▼·±) / 412px·360px 가로 스크롤 0건, 안전 띠 잘림 0건 / 11px 미만 글자 금지, 터치 44px↑(행 56px) / `prefers-reduced-motion` 에서 펼침 화살표 전환 끔 / 앱 판별(`window.Capacitor`)을 권한 판단에 쓰지 않음 / 데모 className(`.ah` `.hist` `.abody` `.colsum` `.coldet` `details.sec` `.row` `.expl`)과 배치를 최대한 유지.

## Analyst

## Developer

- [23:36] 실행 도구: claude(developer 서브에이전트, Opus). 작업 폴더: 전용 worktree `StockInvest-t182`(base origin/main `8d9e980`, detached). **미커밋**(Reviewer 판정 뒤 Leader 커밋). 공유 트리 코드 파일은 건드리지 않음(이 기록만). 운영 DB 쓰기·`ensureSetup` 실행 0건 — 시험은 전부 DB mock, 빌드·시험은 DB 환경변수 없이 실행.
- [23:36] 데모 게이트: `check.mjs activate` → `check` 결과 첫 두 줄 `DEMO_GATE_PASSED` / `task: T-182` (approved v1). 승인 데모 파일은 공유 트리에만 있고 worktree 에는 없다(미추적) — 커밋 때 Leader 가 함께 넣을지 판단 필요. 데모 파일 수정 없음.
- [23:36] 바뀐 파일(worktree 기준) — 새 파일: `scripts/migrations/T-182-trade-report-archive.sql`(감시 경로) · `src/lib/reports/trade-report-view.ts`(요약·화면 공용 순수 모듈: payload 타입·확인 필요 판정·요약 조립·해외명 축약·링크/id/홈 이동 판정) · `src/lib/reports/trade-report-archive.ts`(보관 INSERT·delivered·1년 정리·화면 조회·app_public_url 읽기) · `src/app/api/reports/trade/route.ts`(조회 API, `requireUserId`) · `src/app/report/page.tsx` · `src/components/report/{ReportScreen.tsx,ReportLinkRedirect.tsx,report.module.css}` · 시험 5개(아래). 수정: `src/app/api/cron/trade-report/route.ts`(감시 경로 — 보관→요약+버튼→delivered→정리) · `src/lib/reports/trade-report.ts`(`buildReportPayload` 추가, `SellPnl` 에 `signalId·signalAt·filled`, `HoldingStatus.market`, 매도 신호 조회에 `s.id·s.created_at·o.status` 컬럼 추가) · `src/app/page.tsx`(`?open=report&id=` 수신 조각) · `docs/screens.md`(탭 밖 화면 한 줄) · 기존 시험 3개(아래 「설계와 다르게 한 점」 ⑤).
- [23:36] 「매도 신호 · 미체결」 판정 = 신호가 소비한 주문(`signals.consumed_order_id` → `orders.status`)이 `filled` 일 때만 체결, 주문 없음·취소·거부·부분체결(`partially_filled`)은 미체결. 체결 줄(🔁)은 기존대로 `orders` filled 집계. 「매도 손익」이라는 말은 요약·화면에 없음(시험 고정). 전문 `full_text` 는 기존 `formatReportMessage` 그대로 보존(문구 변경 안 함 — 보존용이라 화면·발송에 쓰지 않음).
- [23:36] 설계와 다르게 한 점·판단: ① payload 의 판단·근거·투자금 문구는 원시 값 대신 **발송 시점에 기존 포맷터가 만든 문장**(앞 장식만 제거)을 저장 — 화면용 포맷터를 클라이언트에 두 벌 만들지 않으려는 것(설계 4절 「재현 값」 대체). ② `ownerUserId` 는 저장하지 않음 — 리포트가 계정별이 아닌 전역이고 Leader 설계 4항이 「로그인 사용자 전원」 모델이라. ③ id 직접 지정은 시험(`is_test=1`)·발송 실패(`delivered=0`) 회차도 표시(시험 발송 버튼으로 들어오는 경로), 화면에 「시험 발송」·「발송 실패 — 화면 기록만」 칩. 목록·최신은 둘 다 제외. ④ 리서치 조회 실패 구분: `fetchResearchDigest` 가 실패 시 **`EMPTY_RESEARCH_DIGEST` 상수 객체 자체**를 돌려준다는 점을 라우트가 `===` 로 판정(기존 시험이 반환 모양을 고정하고 있어 필드 추가 대신 이 방식 — 시험으로 고정). ⑤ 기존 시험 수정: cron 라우트 시험 2개의 `trade-report` mock 에 `buildReportPayload` stub 추가(단언 변경 없음), `trade-report-unmatched-sell.test.ts` 의 `lifoPnlKRW` 소비자 고정 목록에 `lib/reports/trade-report-view.ts` 추가(새 소비자 — `realizedPnlText` 가 원가 미상 규칙 유지, 화면 .tsx 는 `lifoPnlKRW` 를 직접 쓰지 않음). ⑥ 조회 API 는 테이블이 없으면 「빈 상태」가 아니라 503 `archive_not_ready`(화면 「불러오지 못했습니다 · 비어 있는 것이 아닙니다」). ⑦ 텔레그램 버튼 발송 본문은 `sendTelegramAlert` 와 같은 `<b>[태그] ℹ️ 제목</b>`·`🕐 … KST` 모양을 라우트가 직접 조립(`getCredential('NOTIFY_PROJECT_TAG')`). 400 재시도·보관 실패·URL 없음은 `sendTelegramAlert`(버튼 없음)로 보냄. ⑧ 발송 실패 tick 마다 보관 행이 하나씩(delivered=0) 생긴다 — 목록 제외·1년 뒤 정리. ⑨ 차단 사유 라벨은 `reason-copy.ts` 에 해당 사전이 없어 view 모듈에 짧은 사전(`portfolio_guard`→「포트폴리오 보호」 등) 신설. ⑩ 확인 필요 0건 행의 ✓ 성공색은 공용 `CheckRow` 가 성공 심각도를 지원하지 않아 같은 클래스 + 인라인 색으로 그림. ⑪ 「확인 필요」 행 클릭은 공용 `CheckRow`(링크)를 바깥 `onClickCapture` 로 가로채 섹션 열기·스크롤·포커스(주소 해시 변경 없음).
- [23:36] 로그인 복귀: 미들웨어가 `next = pathname + search` 로 넘기고 `sanitizeInternalPath` 가 쿼리를 그대로 통과시킴(코드 확인) → `src/lib/safe-next-path.ts` 수정 불필요, 변경 없음. `appLink.ts`·`AndroidManifest.xml`·`middleware.ts`·`capacitor.config.ts`·`telegram-api.ts`·`src/lib/safety/**`·주문 경로 변경 없음.
- [23:36] 시험(서버 `ssh home_ubuntu`, worktree): 새 시험 5개 65건 — `trade-report-view.test.ts`(요약·확인 필요·축약·링크·id·홈 이동) · `trade-report-payload.test.ts`(payload·filled 판정·리서치 실패 표지) · `route-report-archive.test.ts`(보관 성공 버튼·보관 실패/URL 없음 버튼 없는 요약·400 재시도·비400 실패·skipped·force·슬랙·coverage) · `src/app/api/reports/trade/__tests__/route.test.ts`(401·400·제외 규칙·직접 id·not_found·empty·503 2종) · `src/components/report/__tests__/report-screen-render.test.ts`(데모 구조·문구·기본 펼침·0건·조회 불가·부분 실패). 관련 묶음 12+1 suite 전부 PASS. **전체 jest: 482 suite 중 475 PASS·7 FAIL(10건)·8 skip** — 실패 7개(`reason-dictionary-keys`·`corp-intel isolation`·`job-slots`·`profit-engine isolation`·`usd-cash-balance-fence`·`currency-mixing-fence`·`t108-terms-fence`)는 base `8d9e980` 사본(git archive)에서 **같은 10건이 같은 diff 로 실패**(중복 제거 diff 동일) → 이번 변경과 무관한 기존 실패. `tsc --noEmit` exit 0. `next build` 성공(worktree 의 node_modules 링크가 `current` 경유라 `@workspace/*` 상대 링크가 깨져 1차 실패 → 로컬 디스크 사본 + 실제 릴리스 node_modules 경로로 재빌드 성공, `/report`·`/api/reports/trade` 생성 확인, 사본 삭제). lint: 프로젝트에 ESLint 설정이 없어 `next lint` 가 설정 질문만 띄움 — **미실행**.
- [23:36] 화면 측정(단언 스크립트 1회, 헤드리스 크롬): 긴 해외명·큰 금액·15후보 데이터로 `ReportBody` 를 정적 렌더해 360·412px 고정 폭 틀에서 넘침 0건·11px 미만 글자 0건·44px 미만 터치 0건, 1280px 도 0건. 한계: 실제 뷰포트 에뮬레이션이 아니라 폭 고정 틀(미디어 쿼리는 모바일 분기) · 머리·회차 이동·안전 띠는 정적 렌더 밖이라 미측정 · 실기기·실데이터 미확인.
- [23:36] 안전장치 self-check: 주문·체결 송신 경로 변경 없음(읽기 SELECT 컬럼 3개 추가·보관 테이블 쓰기만). DRY_RUN·KILL_SWITCH·한도·심볼 차단 경로 무관 — 해당 코드 미변경. `orders` 기록 영향 없음.
- [23:36] 미검증: 마이그레이션 실제 적용(운영 적용은 사용자 승인 사항, 미실행) · 실제 텔레그램 발송·버튼 URL 거부 여부 · 앱 App Link(`/` + 쿼리)로 앱이 열리고 `/report` 로 이동하는지 실기기 · 앱 Google 로그인 후 복귀 경로에 쿼리 보존 여부 · 데스크톱 2열·sticky 실제 화면 · lint.
- [23:42] Reviewer Medium 반영(조립 실패 폴백, 범위 route.ts·그 시험만, 미커밋): `src/app/api/cron/trade-report/route.ts` 6행(`mrkdwnToTelegramHtml` import 복원)·242~297행(`buildReportPayload`·`formatReportSummary` 를 try 로 감싸 실패 시 오류 로그 `요약·보관 데이터 조립 실패` + **보관·버튼 없이 기존 전문**(`formatReportMessage` 결과)을 예전 제목 `거래 리포트 (Nh)`(force 면 `[테스트] ` 접두)로 Slack=mrkdwn 그대로·텔레그램=`mrkdwnToTelegramHtml` 변환 후 `sendTelegramAlert` 발송)·373행(응답 `summaryFallback`). 이후 전송 결과 처리(last_sent_at·force·재시도)는 기존 코드 그대로 탄다. payload 조립 예외도 요약 조립 예외와 **같은 동작(보관 없이 전문 발송)** 으로 고정했다 — 요약이 payload 에서 만들어져 따로 살릴 수 없기 때문. 시험 `route-report-archive.test.ts`: 텔레그램 mock 에 `mrkdwnToTelegramHtml` 추가(17~), `buildReportPayload`·`formatReportSummary` 를 던지게 하는 스위치(71·91·133행 부근), 274행~ 폴백 5건(요약 예외→전문·last_sent_at 전진 / payload 예외→슬랙·텔레그램 전문·보관 0 / 폴백+force→[테스트]·미갱신 / 폴백 발송 실패→보류 / 정상은 summaryFallback=false). 결과: 관련 묶음(`src/lib/reports src/app/api/cron/trade-report src/app/api/reports src/components/report`) 13 suite **210/210 PASS**, `tsc --noEmit` exit 0. 남은 한계: `formatReportMessage`(전문) 자체가 던지면 예전처럼 500(이번 범위 밖, 기존 동작).
- [23:36] Reviewer 가 볼 곳: ① `route.ts` 의 실패 폴백(보관 실패·400 재시도·last_sent_at 규칙 보존) ② 조회 API 의 노출 범위(전역 리포트를 로그인 사용자 전원에게 — 설계 4항) ③ `reportRedirectTarget`·`parseReportId`(열린 리다이렉트 없음) ④ `EMPTY_RESEARCH_DIGEST` 동일 객체 판정 ⑤ 매도 신호 `filled` 판정 기준(부분체결=미체결) ⑥ 감시 경로 커밋 대상: `src/app/api/cron/trade-report/**`(route·시험 3개)·`scripts/migrations/T-182-trade-report-archive.sql`.

## Reviewer

- [23:42] 실행 도구: claude(reviewer 서브에이전트). 읽기 전용 감사 — 코드 수정·운영 DB 접근·dev 서버 기동 없음. 대상: worktree `StockInvest-t182`(base `8d9e980`, 미커밋) 변경 전체. Codex C1 은 서버 설정 오류로 미실행(incomplete)이라 외부 반증 없이 독립 대조했다.
- [23:42] 재실행(서버): `jest src/lib/reports src/app/api/cron/trade-report src/app/api/reports src/components/report` → 13 suite·205건 전부 통과(종료 0). `tsc --noEmit -p .` 종료 0. 바뀌면 안 되는 경로(`src/lib/safety/**`·`telegram-api.ts`·`telegram.ts`·`appLink.ts`·`AndroidManifest.xml`·`middleware.ts`·`safe-next-path.ts`·`capacitor.config.ts`·주문 경로) diff 0건. 전체 jest 의 기존 실패 7개는 base 동일이라는 개발자 기록은 재실행하지 않았다(미확인).
- [23:42] 의도 검증: 요약 순서(총자산→체결→확인 필요→보유→리서치)·제목의 ⚠️ 확인 n·확인 필요 0건 `✅ 확인 필요 없음`·총자산 조회 불가 시 0원/−100% 미표기·조건부 줄(체결 매도 있을 때만 실현 손익, 원가 미상 표기)·종류별 한 줄·확인 필요는 자르지 않음·해외명 축약 규칙·「매도 손익」 문구 제거(요약·화면)가 v1 가이드·데모 `summaryLines()` 와 일치한다. 보관 전문 `full_text` 에만 옛 문구가 남지만 조회 API 는 `full_text` 를 SELECT 하지 않는다. 확인 필요 순서 ①~⑥·기본 펼침 규칙도 가이드와 같다.
- [23:42] cron 실패 처리: 보관 INSERT 실패(테이블 없음 포함)는 던지지 않고 null → 링크 없음 → 버튼 없는 `sendTelegramAlert` 로 발송, 400 은 버튼 없이 같은 본문으로 1회 재시도(비 400 은 재시도 없이 실패 반환), `last_sent_at` 규칙(`advanced = !force && !retryable && !noTarget`)·`force` 미갱신·채널 판정·소급 한도는 원본 그대로, 시험이 고정한다. 버튼 포함 발송은 400 이어야만 재발송하므로 성공한 메시지의 중복 발송 경로는 없다. 보관 행은 발송 전에 `delivered=0` 으로 들어가 크래시가 나도 id 는 남고 목록에서 빠진다.
- [23:42] 보안: `?open=report&id=` 이동은 `reportRedirectTarget` 이 `open===report` 이고 id 가 `^[1-9]\d{0,14}$` 일 때만 `/report?id=<숫자>` 고정 문자열을 만들어 열린 리다이렉트 없음. 조회 API 는 `requireUserId` 선검증(401)·id 400·테이블 없음 503 `archive_not_ready`·그 밖 503, SQL 은 id `?` 바인딩과 상수 `LIMIT`/`INTERVAL` 뿐. 1년 정리는 `LIMIT 500`·`ORDER BY id` 로 상한. 로그인 복귀는 미들웨어가 `next=pathname+search` 로 넘기고 `sanitizeInternalPath` 가 `/?open=report&id=N` 을 통과시키는 것을 코드로 확인(실동작은 미확인). 텔레그램 HTML 은 이름·사유를 `&<>` 이스케이프하고 제목·태그는 기존 `sendTelegramAlert` 와 같은 방식(숫자·날짜뿐).
- [23:42] 마이그레이션: `CREATE TABLE IF NOT EXISTS` 추가 전용·외래키 없음·기존 테이블 무영향·멱등, 롤백 = DROP. 부팅 DDL 에 넣지 않았다. 인덱스 `(is_test, delivered, sent_at)` 는 목록 조회에 맞고, 정리 쿼리는 `sent_at` 단독 조건이라 인덱스를 못 쓰지만 행 수가 연 수백 건이라 영향 없음(MEDIUM 아님).
- [23:42] 체결 판정: `signals.consumed_order_id` → `orders.status === 'filled'` 만 체결, `partially_filled`·`accepted`·`pending`·`dry_run`·주문 없음은 미체결. 체결 줄의 기존 집계(`o.status='filled'`)와 같은 기준이라 일관된다. 설계 사양(부분체결=미체결)과 일치.
- [23:42] 기존 시험 3개: cron 시험 2개는 mock 에 `buildReportPayload` stub 추가뿐(단언 변경 0), `unmatched-sell` 시험은 소비자 목록에 `trade-report-view.ts` 추가 — 그 파일이 `unmatchedSellCount` 를 실제로 읽어 단언(`handles:true`)이 유지되고 화면은 `realizedPnlText` 만 쓴다. 약화 아님.
- [23:42] 발견 1 (MEDIUM) `src/app/api/cron/trade-report/route.ts` — `buildReportPayload()`·`formatReportSummary()` 호출(약 240~252행)에 try/catch 폴백이 없다. 이 두 함수는 실데이터로 한 번도 돌지 않은 새 코드인데, 예외가 나면 500 이 되고 `last_sent_at` 이 갱신되지 않아 5분마다 같은 실패를 반복하며 그날 리포트가 통째로 나가지 않는다(설계의 「리포트를 잃지 않는다」 취지와 어긋남). 권고: 조립 실패 시 오류 로그 후 기존 `fullText` 로 `sendTelegramAlert` 폴백(보관 없이). 배포 차단 사유는 아님.
- [23:42] 발견 2 (LOW) 발송 실패 tick 마다 `delivered=0` 보관 행이 하나씩 생긴다(장기 장애 시 하루 최대 288행, 1년 정리는 발송 성공 뒤에만). 채널 미설정(skipped)이면 `last_sent_at` 은 전진하는데 보관 행은 `delivered=0` 이라 그 회차가 목록에서 빠진다. 개발자 기록 ⑧ 과 같은 내용 — 수용 가능, 정리 정책만 후속 후보.
- [23:42] 발견 3 (LOW) 조회 API 는 전역(소유자 계좌) 리포트를 로그인한 모든 회원에게 보여 준다(총자산·보유 종목). 기존 `/api/portfolio`·`/api/balances` 도 회원별 구분이 없어 일관되고 설계 4항의 결정이지만, 가입 가능한 다회원 구조라 노출 범위 변화는 아니고 기존 상태의 연장임을 기록한다. `markReportDelivered` 갱신이 실패하면 발송된 회차가 목록에서만 빠진다(로그만 남음).
- [23:42] 발견 4 (LOW/정보) 매도 신호 `filled` 는 발송 시점 스냅샷이다. 발송 직후 체결되는 주문(`accepted`)은 보관본에 계속 「체결 안 됨」으로 남는다 — 화면 문구가 「발송 시점 기준」임을 분명히 하는지는 QA/사용자 확인 항목.
- [23:42] 미확인(검토 범위 밖): 마이그레이션 운영 적용·실제 텔레그램 버튼 URL 수락·App Link 로 앱이 `/` + 쿼리를 받아 `/report` 로 가는지(실기기)·앱 Google 로그인 후 복귀 쿼리 보존·데스크톱 2열 sticky·lint(ESLint 설정 없음)·전체 jest 기존 실패 7개의 base 동일성. QA 집중 지점: 위 발견 1 의 조립 예외 경로, 400 재시도(버튼 거부) 실제 응답, `app_public_url` 형태(끝 슬래시)에 따른 링크, 보관 테이블 미적용 상태에서의 발송·503 화면.
- [23:42] **최종 판정: PASS (scope: src/app/api/cron/trade-report/, scripts/migrations/T-182-trade-report-archive.sql, src/lib/reports/, src/app/api/reports/, src/app/report/, src/components/report/, src/app/page.tsx, docs/screens.md)**
- [23:50] 재검증(delta, LSN-0009): 바뀐 부분 `route.ts` 242~297행 try/폴백. try 안에는 `buildReportPayload`·`formatReportSummary`·문자열 조립뿐이고 발송·보관 호출이 없어, 예외 뒤 전문을 또 보내는 중복 경로가 없다. 폴백은 `linkUrl=null`·`archiveId=null` 로 예전 제목·`mrkdwnToTelegramHtml` 경로(`sendTelegramAlert`/Slack)를 타고, 이후 `attempts`→`retryable`→`advanced = !force && !retryable && !noTarget`→`setLastSent` 는 수정 전과 같은 코드라 `last_sent_at`·force·재시도 의미가 보존된다. `git status` 변경 파일은 수정 전 목록과 동일(route.ts·시험 포함 기존 15개 안, 추가 파일 없음). jest 13 suite·210건 통과, tsc 종료 0. 이전 발견 1(Medium) 해소. 남은 Low 3건·미확인은 그대로.
- [23:50] **최종 판정: PASS (scope: src/app/api/cron/trade-report/, scripts/migrations/T-182-trade-report-archive.sql, src/lib/reports/, src/app/api/reports/, src/app/report/, src/components/report/, src/app/page.tsx, docs/screens.md)**

## QA

- [23:51] 실행 도구: claude(qa 서브에이전트). 배포 전 전체 QA 1회(LSN-0009 사용자 전달·배포 직전 규칙). 서버 worktree `StockInvest-t182`(base `8d9e980`, 미커밋) 기준. 운영 DB 쓰기·dev 서버 기동·텔레그램 실발송 없음(시험은 전부 mock). 코드는 수정하지 않음.
- [23:51] 재현 조건: 서버 Ubuntu, Node·jest 는 worktree `node_modules`, DB 환경변수 없음, 시험 시간대 기본값.
- [23:51] ① 전체 jest — `node node_modules/.bin/jest` (exit 1). 482 suite 중 474 PASS · 8 FAIL · 8 skip, 시험 13229건 중 12928 PASS · 11 FAIL · 290 skip. 로그 `/tmp/t182-qa-all.log`(서버).
  - 실패 7개 suite 10건(`records/job-slots`·`ops/reason-dictionary-keys`·`__tests__/usd-cash-balance-fence`·`__tests__/currency-mixing-fence`·`__tests__/t108-terms-fence`·`corp-intel/isolation`·`profit-engine/isolation`)은 **base `8d9e980` 에서도 같은 10건이 같은 실패 메시지로 실패**함(임시 base worktree 에서 같은 suite 를 돌려 실패 줄 집합을 `sort -u` 비교 → 차이 0줄). 즉 **T-182 가 만든 실패가 아니라 base 에 이미 있는 실패**다. 임시 worktree 는 삭제 완료.
  - 11번째 실패 `m40/forecast-engine` 「joint blocks …」 — 5초 타임아웃(부하 중 30초 소요). 같은 파일을 단독 실행하면 **21/21 PASS**(T-182 worktree, 27초). T-182 가 건드리지 않은 파일이라 **부하 타임아웃 flake** 로 판정. base 단독 실행도 PASS.
  - T-182 신규 시험 suite 전부 PASS: `reports/__tests__/trade-report-view`·`-payload`·`trade-report` 계열, `cron/trade-report/__tests__/route-report-archive`·`route`·`route-total-unknown`, `api/reports/trade/__tests__/route`, `components/report/__tests__/report-screen-render`.
- [23:51] ② `node node_modules/.bin/tsc --noEmit -p .` — exit 0, 출력 없음.
- [23:51] ③ 데모 게이트 `check.mjs check --task StockInvest/…/T-182…md` — `DEMO_GATE_PASSED` · `approved_version: v1` · `demo: mockups/T-182-trade-report-v1.html` · `hash: verified` (exit 0).
- [23:51] ④ 체크리스트(코드·시험 직접 읽어 근거 확인):
  - 확인 필요 0건 「✅ 확인 필요 없음」 / n건이면 「⚠️ 확인 n」 제목 + 종류별 줄 전부 — `trade-report-view.ts` `formatReportSummary`·`computeReportWarnings`(자르지 않음). 시험 `trade-report-view.test` 「0건이면…」·「모든 종류가…」 PASS. **PASS**
  - 총자산 null → 「💰 총자산 조회 불가」, 0원·−100% 없음 — 같은 함수, 시험 「총자산 null → 조회 불가」 PASS. **PASS**
  - 「매도 손익」 문구: 요약·화면 소스에 없음(`ReportScreen.tsx`·`trade-report-view.ts` 는 주석에만 언급, 시험이 `not.toContain` 으로 고정). 단 보관 전문 `full_text` 는 기존 `formatReportMessage`(`trade-report.ts:687` 「📉 매도 손익」)를 그대로 저장하므로 DB 보관 행에는 옛 문구가 남는다. 화면 조회 API 는 `full_text` 를 SELECT 하지 않아 노출되지 않음(시험 `route.test` 「전문은 화면에 보내지 않는다」). **PASS (보관 전문 잔존은 의도된 보존, 기록용)**
  - 버튼 URL: `reportLinkUrl` 은 `new URL()` 로 조립. 끝 슬래시 있음 `https://stock.example.com/` 와 없음 `https://stock.example.com` 모두 `https://stock.example.com/?open=report&id=42` 를 확인(node 직접 실행). http·공백 host·null·id 0 은 null(버튼 생략) 시험 PASS. **PASS**
  - 보관 INSERT 실패 → 버튼 없는 요약 발송(`route-report-archive` 「보관 INSERT 실패(missing·no_id)」 PASS, `insertReportArchive` 는 던지지 않고 null). **PASS**
  - 400 → 버튼 없이 1회 재시도(시험 「400 → 버튼 없이 1회 재시도해 전달」 PASS), 400 재시도 실패 시 sent=false·last_sent_at 보류·delivered=0·정리 안 함(시험 PASS), 400 이 아닌 실패는 재시도 안 함(시험 PASS). **PASS (mock)**
  - 조립 예외 → 전문 폴백(「요약 조립 예외」「payload 조립 예외」 시험 PASS, 보관 0·last_sent_at 전진). **PASS (mock)**
  - force=1 → last_sent_at 미갱신·[테스트] 제목·is_test=1(시험 PASS). **PASS**
  - `?open=report&id=` 검증: `parseReportId` 는 `^[1-9]\d{0,14}$`. `//evil.com`·`15/../x`·`open=https://…`·`open=settings`·id 누락 → null (시험 `reportRedirectTarget` PASS). 이동 목적지는 `/report?id=<숫자>` 고정 문자열뿐. **PASS**
  - 조회 API: 비로그인 401(`requireUserId`, 시험 「로그인 안 됨 → 401」 PASS), 테이블 없음 503 `archive_not_ready`(시험 PASS), 그 밖 503 `report_unavailable`(오류 원문 미노출), 목록 SQL `WHERE is_test = 0 AND delivered = 1 … LIMIT 60`(시험 PASS), id 직접 지정 시 시험·발송 실패 회차 표시. **PASS (DB 는 mock)**
  - 안전장치 경로 무변경: `git diff --stat 8d9e980 -- src/lib/safety src/lib/notify/telegram-api.ts src/lib/native src/middleware.ts src/lib/safe-next-path.ts android capacitor.config.ts` 출력 0줄, `git status` 해당 경로 0줄, 해당 경로 untracked 0개. **PASS**
- [23:51] 판정 근거 외 확인: 「확인 필요」 판정·요약·화면 모듈은 단일 함수(`computeReportWarnings`)를 서버와 화면이 같이 씀 — 두 벌 판정 없음.
- [23:51] 미검증(NOT_VERIFIED, 실행하지 않았거나 실환경 필요): ESLint — 프로젝트에 ESLint 설정이 없어 lint 미실행. 마이그레이션 `scripts/migrations/T-182-trade-report-archive.sql` 실제 적용(운영 적용은 사용자 승인 사항, 미실행). 실제 텔레그램 버튼 URL 수락·400 실응답(mock 만 확인). 앱 App Link 로 `/?open=report&id=` 가 앱에서 `/report` 로 가는지(실기기). 로그인 후 복귀 시 쿼리 보존(코드 경로만 확인). 실 DB 의 보관 INSERT·정리 DELETE(`ORDER BY id LIMIT 500` 문법) 실행. 데스크톱 2열·sticky 실화면. 화면 측정(360·412·1280 px) 재실행 — 이번 QA 에서 브라우저 측정은 하지 않음.
- [23:51] 기존 실패(T-182 무관, base 에도 있음 — 배포 판단 참고): 위 7 suite 10건(fence·isolation 계열). main 을 기준으로 보면 이 실패는 T-182 배포와 별개로 이미 존재한다. 고칠지 여부·배포 차단 여부는 Leader 판단.
- [23:51] 결함 목록: **0건 (Critical·High·Medium·Low 없음)**. Reviewer 의 Low 3건(발송 실패 회차 누적·전역 리포트 노출 범위·발송 시점 스냅샷)은 그대로 Low 로 남고 이번 QA 에서 새 결함으로 올리지 않음.
- [23:51] 산출물 정리: 로컬 Mac 에 스크린샷·임시 파일 없음. 서버 `/tmp/t182-qa-all.log`·`/tmp/t182-qa-tsc.log`·`/tmp/t182-qa-base.log`·`/tmp/t182-qa-forecast.log`·`/tmp/t182-a.txt`·`/tmp/t182-b.txt`·`/tmp/t182-au.txt`·`/tmp/t182-bu.txt` 는 로그(프로젝트 밖). 임시 base worktree `/tmp/t182-base` 삭제 완료. 서버 `StockInvest-t182` worktree 는 변경 없음(`git status` 16줄 그대로).
- [23:51] QA 판정: PASS (T-182 변경 기준 결함 0건. 전체 jest 의 base 기존 실패 10건과 forecast flake 는 T-182 무관으로 별도 기록)

## 배포 기록

- [10:19] 운영 DB: `scripts/migrations/T-182-trade-report-archive.sql` 1건만 수동 적용(Node mysql2, `shared/.env` 접속값은 출력 안 함). 적용 전 테이블 부재 확인 → 생성 후 컬럼 10개·인덱스 `PRIMARY`·`idx_trade_report_list`·0행 확인. 사용자 승인 원문 「둘 다 승인」.
- [10:22:14] PR #11 머지(`head_commit_id` = `c1f9d46` 고정), 머지 커밋 `10e7f33`. 머지 직전 `origin/main..브랜치` = 이 커밋 1개(동승 없음).
- [10:22:57] webhook blue/green: `RELEASE_RESULT {"status":"ok","release":"20261121-102226-10e7f332","sha":"10e7f33…","previous":"…/20261121-101616-e8dbee92","migrated":false}`.
- [10:23] 확인: `/api/health` ok·db·schemaFatal false·safety green(dryRun true·killSwitch true — 배포 전과 동일), pm2 `stockinvest`·`stockinvest-cron` online·재시작 0·새 릴리스 경로, 웹 버전 0.22.0, `/report` 비로그인 → 307 `/login?next=%2Freport`, `/api/reports/trade` 비로그인 → 401. 배포 뒤 첫 크론 `trade-report OK`(10:23:13 — 발송 시각 아님, 판단만), `pm2-err.log` 배포 뒤 의미 있는 오류 0.
- 롤백: 이전 릴리스 `20261121-101616-e8dbee92`(T-184)로 되돌리면 된다. 테이블은 남아도 이전 코드가 읽지 않으므로 무해.
- 같은 배포에 실린 다른 작업: 없음(T-184 는 10:16 에 먼저 별도 배포).

## 실행 도구·절차 이력

- E1 2026-11-20 22:45 KST — claude 시작(origin=current=claude, claude_standard). 범위: 조사·설계·데모~배포. 근거: 위 사용자 지시 3건. 남은 일: judge 접수 → designer 데모 → 사용자 승인.
- E2 2026-11-20 23:53 KST — 데모 v1 승인(22:52) 뒤 구현(developer)·Reviewer PASS(Medium 1 수정·재검증 PASS)·QA PASS(23:51) 완료. 미커밋. 남은 일: 사용자 승인 ① 운영 DB 마이그레이션 `T-182-trade-report-archive.sql` ② 커밋·PR·main 반영(=배포, 권고 창 05:10~07:30 KST) → 배포 후 08:00 첫 요약 확인 · 실기기 링크 확인.
- E3 2026-11-21 10:20 KST — 사용자 「둘 다 승인」 수신. 작업 폴더를 원격 main `774bef6`(T-181, 0.20.0) 위 브랜치 `T-182-trade-report-summary` 로 옮김(겹치는 파일 0). 웹 버전 0.20.0 → **0.21.0**(기본 마이너 증가, `package.json`·`package-lock.json` — 안전 경로 아님). 재시험: 관련 15 suite 251건 통과(T-181 시험 2개 포함)·`tsc --noEmit` 0. 남은 일: 커밋 → PR → 운영 DB 테이블 생성 → 머지(=배포) → 결과 기록.
- E4 2026-11-21 10:2x KST — 커밋 후 PR #11 생성. **운영 DB `trade_report_archive` 생성 10:19:43 KST**(적용 전 부재 확인 → 컬럼 10개·인덱스 PRIMARY·idx_trade_report_list·0행 확인, 이 SQL 1건만 수동 적용). 머지 직전 재확인에서 원격 main 이 `e8dbee9`(다른 세션 T-184, 10:16 배포, 웹 버전 **0.21.0**)로 움직여 있어 그 위로 리베이스 — 겹친 파일은 버전 두 파일뿐. 같은 버전 중복을 피해 T-182 를 **0.22.0** 으로 정정. 재시험: 관련 15 suite 256건(T-184 시험 2개 포함) 통과·`tsc` 0.
- E5 2026-11-21 10:30 KST — PR #11 머지·배포 `status: ok`(위 배포 기록). Leader 최종 요약 작성, status done. 남은 일(waiting): 다음 08:00 발송의 요약·버튼 확인, 사용자 실기기에서 버튼 → 앱 리포트 화면 이동 확인.

## Codex 검토

### [2026-11-20 23:00] C1 adversarial-review focus=security — 실패(codex_exit_1: 모델 `gpt-6.1-sol` 을 ChatGPT 계정이 거부, HTTP 400 model_not_found)
- judge 판정: `## Judge` 의 [2026-11-20 22:57] codex_gate/C1 줄 / 호출 차수: 1/4 (실패도 차수에 포함, `counts/T-182.json` calls=1)
- 대상: repo=/home/brownjeon/.node-local/stockinvest-t182 (서버 worktree, cwd) base=8d9e980(HEAD_fallback — task base_ref 72b9729 가 서버 worktree 에 task 이력서로 없어 연결되지 않음) snapshot=e7e6680 (스냅샷 diff 0건, 설계는 텍스트라 인계 묶음으로만 전달)
- 지적 0건: Codex 가 모델 거부로 시작하지 못해 검토를 수행하지 않았다. 「검토 통과」가 아니다.
- 검토하지 못한 범위: 설계 전부 — 인계 묶음 §7 집중 질문 ①~⑤(오픈 리다이렉트, 계좌 수치 노출 범위, 보관·발송 실패 처리, 로그인 후 쿼리 보존, 그 밖의 결함) 모두 미검토.
- 원인 메모: 서버 `~/.codex/config.toml` 의 `model = "gpt-6.1-sol"` 이 11-15 실패 때와 같은 값으로 남아 있다(파일 수정 시각 11-16 15:44). 설정 수정·Codex CLI(0.157.1) 갱신은 사용자 판단 사항이라 건드리지 않았다. 재실행 여부와 시점도 사용자가 정한다.
- 인계 묶음: 서버 `~/.node-local/codex-handoff/T-182-C1.md` (권한 600, 비밀·계좌 수치 없음)
- 원본: `/home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261120T140046Z-T-182-C1/` (`stderr.txt` 에 HTTP 400 원문, `raw.txt` 비어 있음)
- [23:46] C2(judge `codex_required=true`, adversarial-review/data_integrity): **skipped(codex_config_error) — 호출하지 않음.** C1(23:00)이 서버 `~/.codex/config.toml` 모델 값 거부(HTTP 400 `model_not_found`)로 incomplete 였고, 23:46 재확인에서 같은 설정(수정 시각 11-16 15:44) 그대로라 같은 실패가 확정적이다. 외부 반증 없이 Reviewer PASS·QA 로 진행한다. 설정 수정은 사용자 결정 사항(보고 예정). 이것은 검토 통과가 아니다.

## 최종 요약

**[T-182] 거래 리포트 요약 + 리포트 전문 화면 — 운영 반영 완료(2026-11-21 10:22, 웹 0.22.0)**

- 무엇이 바뀌었나: 아침 텔레그램 거래 리포트가 약 13줄 요약과 「👉 앱에서 자세히 보기」 버튼으로 바뀐다. 확인할 항목이 있으면 제목에 「⚠️ 확인 n」이 붙고 그 항목은 항상 보인다. 「매도 손익」은 「매도 신호 · 미체결」로 바뀌었다. 버튼을 누르면 새 리포트 화면(`/report`)에서 전문을 섹션별로 보고 이전 회차로 넘겨 볼 수 있다(보관 1년).
- 배포: PR #11 → 머지 `10e7f33` → 릴리스 `20261121-102226-10e7f332` ok. 운영 DB 새 테이블 `trade_report_archive` 생성(10:19). 같은 배포에 실린 다른 작업 없음. 앱(네이티브) 변경 없음 — 재설치 불필요.
- AI 가 검증한 것: 관련 시험 256건·타입 검사 통과, 배포 결과·health·새 화면/API 의 로그인 검사, 배포 뒤 첫 크론 정상.
- AI 가 못 한 것: 실제 텔레그램 버튼 표시, 실기기에서 버튼 → 앱 화면 이동, 운영 DB 실제 저장(다음 발송 때 첫 행), Codex 외부 검토(서버 Codex 설정 모델 거부로 실패·생략).
- 👉 사용자 확인: ① 다음 08:00 리포트가 짧은 요약 + 버튼으로 오는지 ② 폰에서 버튼을 누르면 앱이 열리고 리포트 화면이 나오는지(브라우저로 열리면 알려 주기 — 앱 링크 경로 추가안으로 바꿔야 한다).
- 👉 사용자 결정: 서버 Codex 설정 모델 값 수정 여부(11-15부터 Codex 검토 전부 실패).
- 남은 일·위험(Low): 발송 실패 회차의 미발송 보관 행 누적, 로그인 회원 전원이 리포트 계좌 수치를 봄(기존 홈과 같은 모델), 매도 신호 체결 여부는 발송 시점 값. 별건 후보: 매도 신호 손익률과 보유 고점대비의 기준 차이.

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: full (JV-ui_change) | 11-20 22:38 |
| v1 | 검토요청 | mockups/T-182-trade-report-v1.html | - | 사용자 검토 요청 | 11-20 22:50 |
| v1 | 승인 | mockups/T-182-trade-report-v1.html | - | "권고안으로 v1 승인" | 11-20 22:52 |

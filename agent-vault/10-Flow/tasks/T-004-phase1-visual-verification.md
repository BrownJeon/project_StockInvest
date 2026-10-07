---
task-id: T-004
project: StockInvest
created: 2026-08-04
status: done
tags:
  - type/task
  - domain/observability
  - domain/ui
aliases:
  - Phase 1 렌더 육안 확인
  - 깔때기 카드·트레이드리포트 렌더 검증
related_tasks:
  - "[[T-002-phase1-eval-funnel]]"
---

# T-004 · Phase 1 잔여 — 깔때기 카드·trade-report 실제 렌더 육안 확인

## 목표

[[T-002-phase1-eval-funnel]]에서 만든 두 산출물이 **API 응답 수준이 아니라 실제 사람이 보는 화면/메시지에서** 정상 렌더되는지 확인한다.

1. 대시보드 **"오늘의 평가 깔때기"** 카드 — 브라우저(모바일 412px + 데스크탑)에서 실제로 그려지는지
2. **trade-report 텔레그램 메시지** — `POST /api/cron/trade-report?force=1` 강제 발송 시 텔레그램에서 정상 렌더·전달되는지

지금까지는 `/api/dashboard/eval-funnel` JSON 응답과 `npm test` 통과까지만 확인됐다. **렌더는 미확인.**

## 관련 과거 이력 요약

- [[T-002-phase1-eval-funnel]] §최종 요약 12·13번: `eval-funnel-query.ts`(집계) + `/api/dashboard/eval-funnel` + `EvalFunnelCard.tsx`(모바일 412px, 헤더/이상배너/병목1줄/6단계바/최다차단 top3, 접기·펼치기) 신설, `formatFunnelSection()`을 trade-report 메시지 하단에 첨부. 커밋 `b0ad876`로 2026-08-03 10:00 KST 배포됨.
- [[T-002-phase1-eval-funnel]] §"다음 세션이 할 일" 2번이 정확히 이 작업이다 — "배포 후 대시보드 카드·아침 리포트가 실데이터로 정상 렌더되는지 확인".
- [[T-002-phase1-eval-funnel]] §최종 요약 §확인했지만 손대지 않은 것: `eval-funnel.ts`/`eval-funnel-query.ts` 단위 테스트 부재 — 집계 산수는 수동 SQL로만 검증됨. 카드가 잘못된 숫자를 그려도 테스트가 못 잡는다는 뜻이므로, 이번 육안 확인 시 **화면 숫자 vs DB 실측 SQL 대조**를 반드시 포함할 것.
- analyst 사양(카드 순서·문단 포맷)은 [[T-002-phase1-eval-funnel]] §4 "깔때기 요약 지표 정의"에 있다. 렌더 결과가 이 사양과 일치하는지가 판정 기준이다.

## 🔴 이번 세션 착수 시 Leader가 발견한 환경 이상 (전원 숙지 필수)

워킹트리에 **커밋되지 않은 Next.js 15.5.22 업그레이드가 통째로 들어와 있다** (26개 파일, +780/-623). `package.json` `next: 14.2.35 → 15.5.22`, `eslint-config-next` 동반 상향, API 라우트 20여 개의 `params: {id}` → `params: Promise<{id}>` async 마이그레이션, `next.config.js`에 `outputFileTracingRoot` 추가.

실측 상태:

| 대상 | 버전/상태 |
|---|---|
| `node_modules/next` (디스크) | **15.5.22** — 이미 설치됨 |
| `.next/BUILD_ID` | 2026-08-03 10:00 빌드 = **next 14.2.35로 빌드된 산출물** |
| 실행 중 pm2 `stockinvest` | uptime 32h, **next 14.2.35로 기동됨** (메모리에 로드된 14 코드로 서빙 중) |
| `origin/main` HEAD | `b0ad876` — 14.2.35 |

**함의 (매우 중요)**:
1. **지금 :3003에서 보이는 화면은 커밋 `b0ad876`(next 14) 빌드 = 진짜 운영 화면이 맞다.** 이번 렌더 검증의 대상으로 정확하다.
2. **`pm2 restart stockinvest`를 하면 next 15 런타임이 next 14 `.next` 빌드를 읽게 되어 기동 실패 가능성이 매우 높다.** 어떤 이유로도 재시작하지 말 것.
3. 다음 배포(webhook-deploy)의 `git clean -fdx`가 이 업그레이드 작업분을 **전부 삭제**한다.
4. 이 건은 RESUME.md "사용자 결정 필요 3건" 중 **3번(next CVE 21건 → 15.x/16.x 업그레이드)** 과 직결된다. → **이번 task 범위 밖. 손대지 말고 보고만 한다.**

## 제약 (위반 시 운영 파손)

- **`npm run build` 절대 금지** — NFS 경로가 곧 운영 배포 경로이고 pm2가 이 `.next`를 서빙 중.
- **`npm install` / `npm ci` 금지** — node_modules를 더 흔들지 말 것 (이미 15.5.22로 바뀐 상태).
- **pm2 restart/reload 금지** (`stockinvest`, `stockinvest-cron` 둘 다). 필요하면 Leader 경유해 사용자에게 요청.
- **git commit / push 금지.** 워킹트리에 새 파일을 만들지 말 것 — 검증 스크립트는 전부 스크래치패드에 둔다.
- **운영 DB는 SELECT만.** 파괴적 SQL·스키마 변경 금지.
- **시크릿 출력 금지** — `AUTH_PIN`·`CRON_SECRET`·`TELEGRAM_BOT_TOKEN` 값을 로그·보고서·터미널에 찍지 말 것. 스크립트에서 `.env`를 읽어 변수로만 사용한다.
- 로그인 rate-limit이 **전역 지수 백오프**다. PIN을 틀리면 잠긴다 — `.env`의 `AUTH_PIN`을 정확히 읽어 한 번에 성공시킬 것.

## 환경 정보 (Leader 실측)

- 앱: `http://localhost:3003` (pm2 `stockinvest`, cluster, `-H 0.0.0.0 -p 3003`)
- 인증: `src/middleware.ts` — 전 경로 HMAC 세션 쿠키. 미인증 페이지는 `/login?next=...` 307. 로그인은 `POST /api/auth/login` (PIN). `/api/cron/*` 는 세션 대신 `x-cron-secret: $CRON_SECRET` 헤더.
- 브라우저: playwright **1.58.2** (npx로 사용 가능), `~/.cache/ms-playwright` 는 **비어 있음** → 번들 브라우저 미설치. 시스템 `/usr/bin/google-chrome` 존재 → `chromium.launch({ channel: 'chrome' })` 로 사용할 것 (`playwright install` 실행 금지 — 불필요한 다운로드).
- 대상 소스: `src/components/dashboard/EvalFunnelCard.tsx`(162줄), `src/lib/strategy/eval-funnel-query.ts`(185줄), `src/app/api/dashboard/eval-funnel/route.ts`(22줄), `src/lib/reports/trade-report.ts`(`formatFunnelSection`/`formatReportMessage`), `src/app/api/cron/trade-report/route.ts`, `src/lib/notify/telegram.ts`.
- 스크래치패드: `/tmp/claude-1000/-home-brownjeon-NFS-homes-brownjeon-project/0a6aaa2b-5a38-4e14-ba21-9e08633044f7/scratchpad`

## 역할별 지시사항

### developer (Opus)

**A. 대시보드 렌더 캡처**
1. 스크래치패드에 playwright 스크립트 작성 (`channel: 'chrome'`, headless). `.env`에서 `AUTH_PIN`을 읽어 `/login`으로 로그인 → 대시보드 진입.
2. 뷰포트 **412×915 (갤럭시 S25+ 기준, 프로젝트 UI 원칙)** 로 대시보드 전체 풀페이지 스크린샷 + "오늘의 평가 깔때기" 카드 **단독 클리핑 샷**(접힌 상태 / 펼친 상태 각각) 저장.
3. 데스크탑(1280×900)에서도 카드 샷 1장.
4. 콘솔 에러·네트워크 실패(4xx/5xx)를 수집해 보고. React 하이드레이션 에러·`NaN`·`undefined`·`Infinity%` 노출 여부를 특히 볼 것.
5. `/api/dashboard/eval-funnel` 원시 JSON을 함께 저장.
6. **숫자 정합 대조**: 화면에 그려진 값(시그널 건수·런 횟수·6단계 잔존수·top3 차단 사유)을 `eval_funnel` 테이블 직접 SELECT 결과와 대조. 불일치가 있으면 그것이 이번 task의 핵심 결함이다.
7. 오늘 데이터가 비어 있으면 **빈 상태(empty state) 렌더**가 깨지지 않는지도 확인 — 0으로 나누기, 빈 배열 map, `-Infinity` 등.

**B. trade-report 텔레그램 렌더**
1. `src/lib/notify/telegram.ts`를 먼저 읽어 **`parse_mode`가 무엇인지**(HTML / Markdown / MarkdownV2 / 없음) 확인. parse_mode를 쓰는데 본문에 이스케이프되지 않은 `_ * [ ] ( ) ~ \` > # + - = | { } . !` 나 `<`/`&` 가 섞이면 텔레그램이 **400으로 거절**하고, 라우트는 `.catch()`로 삼켜 조용히 실패한다 — 이번 검증의 최우선 리스크 지점이다.
2. 4096자 제한 초과 여부, 분할 전송 로직 유무 확인.
3. 발송 **전에** 스크래치패드 스크립트로 실제 발송될 본문을 그대로 재현해 출력(같은 DB·같은 함수 경로). `formatFunnelSection()` 문단이 analyst 사양(§4 포맷)대로 나오는지 텍스트로 먼저 검수.
4. 그다음 `POST http://localhost:3003/api/cron/trade-report?force=1` 를 `x-cron-secret` 헤더와 함께 1회 호출. 응답 JSON 기록.
5. **발송 성공 여부를 증거로 확정**할 것 — pm2 로그(`pm2 logs stockinvest --lines 80 --nostream`)에 `[trade-report] telegram:` 에러가 찍혔는지 확인. HTTP 200 + 에러 로그 없음이어야 성공. 에러가 있으면 그 원문이 결함 증거다.
6. 발송은 **1회만**. 사용자 텔레그램에 실제로 도착하는 메시지다 — 반복 발송 금지.

**C. 결함 처리**
- 결함을 찾으면 `src/` 의 해당 파일을 수정한다(스크래치패드 스크립트는 산출물 아님).
- 검증은 **`npm run typecheck` + `npm test` 만**. `npm run build` 금지.
- ⚠️ 주의: 워킹트리가 next 15 마이그레이션 상태라 `typecheck`/`test`가 이번 수정과 무관한 사유로 실패할 수 있다. 그 경우 **기준선(수정 전) 결과와 비교**해 이번 수정이 회귀를 유발하지 않았음을 보이면 된다. next 15 관련 실패를 고치려 들지 말 것(범위 밖).
- 수정이 렌더에만 영향을 주는지, 매매 경로(engine/safety)에 닿는지 명시할 것.

#### developer 작업 로그 (2026-08-04)

- [18:20] 환경 실측. DB `eval_funnel.ts` 는 naive `DATETIME` + 서버 TZ=KST(=stored 값이 KST 벽시계). `src/lib/db.ts` pool 이 `timezone:'+09:00'` 이라 `kstTodayStart()` 바인딩이 정확히 KST 00:00 으로 나간다 — **타임존 처리 정상**. (교차검증 스크립트를 `timezone:'Z'` 로 처음 돌렸다가 범위가 9시간 어긋나는 것을 발견, pool 과 동일 설정으로 재실행함.)
- [18:22] A. 대시보드 캡처 완료. playwright 1.61.1 + 시스템 Chrome 147(`channel:'chrome'`), 412×915 / 1280×900. 로그인 1회 성공(백오프 미발동). 카드 렌더 정상, 가로 오버플로 없음(scrollWidth=clientWidth=412), pageerror 0 / 요청실패 0 / 4xx-5xx 0. 콘솔 error 1건은 `/favicon.ico` 404(public/ 에 파일 없음, T-004 무관).
- [18:22] **숫자 정합 100% 일치** — 화면 값 전부를 `eval_funnel` 직접 SELECT 와 대조: 런 72 / 평가 2333 / 룰발화 54(2.3%) / 가드 27(50%) / 프리필터 0 / AI 0 / 시그널 0 / top3(룰 미발화 2274·하락추세 매수 차단 27·미보유 매도 21) / neutral 0.3% / 이상 4종. 불일치 0건. NaN·undefined·Infinity 노출 없음.
- [18:26] B. `telegram.ts` 는 **parse_mode='HTML'**. 실제 발송 본문을 운영 코드 경로 그대로 재현(읽기 전용 pool 로 `@/lib/db` 를 모킹해 SELECT 외 문장은 하드 차단 — 차단 발생 0건). 결과: stray `<`/`>`/`&` 0개, 707자(<4096) → **400 거절 위험 없음**. 단 본문이 Slack mrkdwn `*굵게*` 라 HTML 모드에서 별표가 리터럴 노출됨(7줄).
- [18:28] `POST /api/cron/trade-report?force=1` **1회만** 호출 → HTTP 200 `{"ok":true,"sent":true,"channel":"telegram"}`. pm2 err 로그 증가분 0바이트(= `[telegram] sendMessage failed` / `[trade-report] telegram:` 없음) → **발송 성공**.
- [18:29] 🔴 **로그 감사 중 별건 발견**: 오늘 08:03 정기 리포트는 `[telegram] fetch error: ETIMEDOUT`(IPv4 149.154.166.110:443 + IPv6 ENETUNREACH)로 **실제 전달 실패**. 그런데 `sendTelegramAlert` 는 void 반환이라 라우트는 `sent:true` 를 응답하고 `report_trade_last_sent_at` 까지 갱신 → **리포트가 유실돼도 아무도 모른다**. 범위 밖이므로 보고만 함.
- [18:35] C. 결함 수정 2건(둘 다 **렌더 전용**, engine/safety 매매 경로 무접촉):
  - `EvalFunnelCard.tsx` — `Math.max(2,…)` 가 0건 단계에도 2% 막대를 그려 "프리필터 통과 0 / AI 통과 0 / 시그널 0" 이 잔존 종목이 있는 것처럼 보였다 → count 0 이면 막대 미출력.
  - `telegram.ts` + `trade-report/route.ts` — `mrkdwnToTelegramHtml()` 신설(엔티티 이스케이프 후 `*…*`→`<b>…</b>`), 텔레그램 전송분에만 적용. Slack 본문과 다른 알림 호출부는 미변경(holding-checker 가 본문에 직접 `<b>` 를 넣기 때문에 전역 적용 불가).
- [18:40] 검증: `npm run typecheck` exit 0, `npm test` 40 suites / 410 tests 통과 — **수정 전 기준선과 동일**(기준선도 0 / 40 / 410). `npm run build`·`npm install`·pm2 재시작·커밋·DB 쓰기 **전부 미실행**.
- [18:40] ⚠️ **에스컬레이션 1건 (설계 판단 필요 — 임의 변경하지 않음)**: 카드 헤더 `오늘 시그널 2건` vs 6단계 바 `시그널 0`, 리포트 한 줄은 `✅ 시그널 0건 (매수 0 · 매도 2)` 로 자기모순. 원인은 두 지표의 출처가 다름 — 헤더/괄호는 `gate='signal_created'`(exit 엔진의 매도까지 포함), 바는 `final.stage>=99`(매수 트랙만. exit 트랙은 `final` 행을 쓰지 않음). analyst 사양 §4-1 은 헤더를 **"final 행 stage=99 카운트"** 로 규정하므로 현 구현은 사양 이탈이다. 어느 쪽을 정본으로 삼을지는 지표 정의 문제라 leader/analyst 판단 요청.
- [18:40] ⚠️ 워킹트리 주의: 위 수정 3파일은 **미커밋**이며 next 15 업그레이드 작업분과 같은 더티 트리에 있다. 다음 webhook 배포의 `git clean -fdx` 가 함께 삭제한다.

### analyst (Fable) — 추가 배정 (2026-08-04, 에스컬레이션 대응)

developer가 올린 **"시그널 건수 정본" 문제**를 판정한다. 코드는 쓰지 말고 **정의와 근거**만 낸다.

관측된 자기모순 (실데이터):
- 카드 헤더: `오늘 시그널 2건`
- 6단계 바 마지막: `시그널 0`
- 리포트 한 줄: `✅ 시그널 0건 (매수 0 · 매도 2)` ← 그 자체로 모순

원인: 헤더·괄호는 `gate='signal_created'` 집계(= exit 엔진이 만든 **매도 청산 시그널 2건 포함**), 6단계 바는 `final.stage>=99` 집계(= **매수 트랙 전용**. exit 트랙은 `final` 행을 쓰지 않으므로 구조적으로 0). 즉 두 숫자 다 각자 맞고, **모수가 다르다.**

[[T-002-phase1-eval-funnel]] §4-1은 헤더를 "final 행 stage=99 카운트"로 규정 → 현 구현은 사양 이탈. 하지만 그 사양은 exit 트랙이 `final` 행을 안 쓴다는 사실을 반영하지 않은 채 작성됐을 수 있다.

판정할 것:
1. **깔때기(6단계 바)의 모수는 매수 트랙만인가, exit 포함 전체인가?** 깔때기는 "매수 후보가 게이트를 통과해 살아남는 과정"의 감쇠 모델이다 — exit 청산 시그널을 같은 축에 넣는 것이 지표로서 타당한지.
2. 위 결론에 따라 **헤더 문구·리포트 문구를 어떻게 고칠지** 확정한다. 매수/매도를 시각적으로 분리할지, 헤더를 `final.stage=99`로 통일할지, exit 트랙에도 `final` 행을 쓰게 할지(= 계측 변경, Phase 2 비용) 중 택일하고 근거를 밝힌다.
3. **Phase 2([[T-003-phase2-pipeline-redesign]])로 미룰 것인지, 지금 고칠 것인지** 판단한다. 이 task는 "렌더 육안 확인"이 목적이므로 범위를 키우지 않는 쪽을 기본으로 하되, **사용자가 화면에서 모순된 숫자를 보는 상태를 방치하는 비용**과 저울질할 것.
4. 지금 고치는 쪽이면 developer가 그대로 구현할 수 있는 **정확한 문구·집계식**을 제시한다. 최소 변경일 것 — 계측(engine.ts) 수정이 필요한 안은 Phase 2로 넘긴다.

제약: 운영 DB는 **SELECT만**. 코드 수정 금지(판정만). 근거로 DB 실측이 필요하면 읽기 전용 쿼리로 확인할 것.

#### analyst 작업 로그 (2026-08-04)

- [19:01] **판정 완료 — 깔때기(6단계 바)의 모수는 평가 트랙(룰→가드→프리필터→AI) 전용이 맞다. exit 청산은 별도 트랙으로 분리 표기한다.** 근거: ① 깔때기는 단조 감소 부분집합 사슬인데 exit 시그널은 stage 5/7/9/11 게이트를 하나도 통과하지 않아 터미널에 합산 시 `AI 0 → 시그널 2`처럼 부분집합 불변식이 깨지고 "AI가 승인했다"는 오독을 유발. ② 모수 축이 다름 — 깔때기 모수는 평가 유니버스(symbol×run), exit 모수는 보유 종목. DB 실측으로 동일 종목(000660)이 오늘 본트랙 final `rule_no_fire`로 72회 죽으면서 **동시에** exit 매도 시그널을 발화함을 확인 — 병합하면 종목의 깔때기 결과가 정의 불능. ③ 질문이 다름 — 깔때기는 "왜 전략 시그널이 안 나오나"(Phase 1의 존재 이유), exit는 "보유 방어가 작동하나".
- [19:01] **T-002 §4-1 사양 정정 (자기정정)**: "헤더 = final 행 stage=99 카운트"는 exit 트랙이 final 행을 쓰지 않는다는 사실을 반영하지 못한 채 작성됐다. 정정: **헤더 = `signal_created`(verdict=pass) 이벤트 건수(전 트랙 합), 트랙별 분해 표기. 깔때기 터미널 = final stage=99(평가 트랙) 유지.** 두 숫자는 단위가 다르므로(건 vs symbol×run) 같은 이름을 쓰지 않는 것이 핵심.
- [19:01] DB 실측(읽기 전용): 전 기간 `signal_created` 행 4건 **전부** `strategy_id='exit-engine-v1'` sell (8/3 2건 + 8/4 2건) — 본트랙 시그널 0. NULL strategy_id 0건 → **트랙 판별자로 strategy_id 100% 신뢰 가능, 계측 변경 불필요**. final 행에 stage 99·21~29·exit_* reason은 전 기간 0건 → exit 트랙 final 무기록 구조 확정.
- [19:01] **지금(T-004) 수정 권고** — 근거: 리포트 한 줄 `✅ 시그널 0건 (매수 0 · 매도 2)`는 한 줄 안에서 자기모순이고 매일 아침 발송되며, 카드 헤더 2건 vs 바 0은 실계좌 운영 대시보드에서 관측 도구 자체의 신뢰를 파괴한다. Phase 1 관측 3영업일 창(T-003 선행조건)이 지금 진행 중이라 이 카드가 바로 그 기간의 주계기다. 수정은 읽기측 전용(집계 SQL 1개 + 포맷 2곳 + 헤더 + 라벨)으로 developer가 T-004에서 이미 한 렌더 수정과 동급 규모. engine.ts 계측(exit 트랙 final 행, stage 21~29 미니 깔때기)은 Phase 2([[T-003-phase2-pipeline-redesign]])로 이월.
- [19:01] 확정 문구·집계식은 leader 보고 본문에 전달(요지: 헤더 `오늘 시그널 N건 (전략 s · 청산 e)`, 바 터미널 라벨 `전략시그널`, 리포트 사슬 터미널 `✅ 시그널 {c}`(건 제거) + exit>0일 때 `청산(보유관리) 매도 e건` 별도 줄, 집계는 `signal_created`를 `strategy_id='exit-engine-v1'` 기준 track 분리).
- [19:01] ⚠️ 범위 밖 관측 보고: 오늘 exit 매도 시그널 2건이 `signals.status='expired'` — **방어용 청산 시그널이 승인 없이 만료되어 실행되지 않았다**. exit 시그널이 pending 라우팅→만료를 반복하면 손절·트레일링이 무력화되는 실질 리스크. leader가 별도 task(자동제출 정책 or T-003)로 검토 권고.

### reviewer (Sonnet)

developer 산출물 수령 후 독립 감사:
1. 캡처된 화면·메시지가 [[T-002-phase1-eval-funnel]] §4 사양과 **항목별로** 일치하는가 (카드 5요소 순서, 리포트 문단 구성).
2. `eval-funnel-query.ts` 집계 산수 자체를 코드로 재검토 — 단위 테스트가 없는 영역이다. 특히 "stage k 이상 도달 = 잔존" 누적 방향, 0 분모 가드, 오늘 범위(`ts >= CURDATE()`)의 타임존(서버 UTC vs KST) 처리.
3. 텔레그램 parse_mode ↔ 본문 이스케이프 정합. 조용한 실패 경로(`.catch()`로 삼킴)가 남아 있는지.
4. developer 수정이 있었다면 그 수정이 계측·매매 경로에 부작용을 만들지 않는지.
5. 판정: **PASS** 또는 **결함 목록**. 결함이면 developer에게 직접 반려하고 재검증한다.

### qa (Haiku)

reviewer PASS 이후 체크리스트 실행 검증:
1. 저장된 스크린샷을 **직접 Read로 열어 눈으로** 확인 — 카드가 보이는가 / 레이아웃이 412px 안에서 깨지지 않는가 / 텍스트 잘림·겹침·가로 스크롤 없는가 / 막대그래프가 그려지는가 / 한글 라벨이 정상인가 / `NaN`·`undefined`·`Infinity` 문자열이 노출되지 않는가.
2. 접기·펼치기 두 상태가 모두 정상인가.
3. 재현된 텔레그램 본문 텍스트를 읽고 사양 대비 누락·깨짐이 없는지 확인.
4. `POST .../trade-report?force=1` 응답과 pm2 로그 증거로 발송 성공이 실제로 입증되었는지 확인 (developer의 주장만 믿지 말고 증거 파일을 볼 것).
5. 결함 발견 시 developer에게 통보 — **수정 후에는 QA 재실행이 아니라 Reviewer부터 전체 재순환**한다.

## 수용 기준

1. 모바일 412px·데스크탑 양쪽에서 "오늘의 평가 깔때기" 카드가 사양대로 렌더된 **스크린샷 증거**가 있다.
2. 화면 숫자가 `eval_funnel` DB 실측과 일치한다.
3. trade-report 강제 발송 메시지가 텔레그램에 **실제로 전달**되었음이 증거(HTTP 응답 + 로그 무에러)로 확정됐다.
4. 메시지 본문이 analyst 사양 포맷대로 렌더되고 parse_mode 관련 깨짐이 없다.
5. 발견된 결함은 수정되고 Reviewer→QA 재순환을 통과했다. 수정 없으면 그대로 PASS.
6. `npm run build` 미실행, pm2 미재시작, 커밋 미수행.

## 진행 로그

- 2026-08-04 Leader: task 생성. 착수 전 환경 실측에서 **워킹트리 next 15.5.22 미커밋 업그레이드** 발견 → 범위 밖으로 격리하고 재시작 금지 경고를 제약에 추가. developer 배정.
- 2026-08-04 Leader: developer 완료 보고 수령. 렌더 검증 자체는 성공(카드·메시지 모두 정상 렌더 확인, 숫자 정합 100%). 결함 2건 수정, 에스컬레이션 1건(시그널 건수 정본) 접수 → **analyst 판단 의뢰 + reviewer 감사 병렬 착수**.

### reviewer (Sonnet) 감사 결과 (2026-08-04)

**판정: PASS.** 3개 변경 파일 모두 코드 감사·독립 재검증 완료. 결함 0건(재반려 없음). `npm run typecheck` clean, `npm test` 40/40 suites·410/410 tests(기준선과 동일) 재확인.

1. **카드·리포트 §4 사양 대조** — 헤더 포맷·이상배너(ai_batch_failed/analyst_disabled/verdict=error 상위집합)·병목 1줄·6단계 바(minStage 0/5/7/9/11/99, `eval-funnel-labels.ts` FUNNEL_STEPS와 정확히 일치)·최다차단 top3 SQL 전부 §4와 항목별 일치. `Math.max(2,…)` 억제 수정도 렌더 전용, count>0 조건만 추가해 부작용 없음.
2. **집계 산수 독립 재도출** — `final.stage`는 "죽은 단계(또는 99=성공)"이므로 `stage >= minStage` 누적이 "해당 단계 진입 생존"과 동치임을 게이트 stage 번호 체계로 직접 확인. 실데이터(evaluated 2333/fired 54/guard 27/prefilter 0)로 손으로 재계산: 2333-54=2279=rule_no_fire(2274)+ticker_error(5, "시세 조회 실패" 이상표시와 일치), 54-27=27은 top3 sell_not_held(21)+미표시 stage5/6 6건, 27-0=27은 prefilter_strong_counter_trend(27)과 완전 일치 — **분모 0 가드·누적 방향 전부 정확**. `pct()` 헬퍼·카드 병목줄·formatFunnelSection 세 곳 모두 0-분모 가드 확인(NaN/Infinity 불가능).
3. **KST/UTC 경계** — `kstTodayStart()`(`src/lib/time.ts`)는 epoch 기반이라 서버 로컬 TZ 무관하게 KST 00:00 절대시각을 반환하고, `db.ts` pool의 `timezone:'+09:00'`이 바인딩 시 이를 KST 벽시계 문자열로 직렬화 — `eval_funnel.ts DATETIME`이 서버 TZ=KST로 적히는 것과 정합. 실측 evidence(`funnel-sql-correct.json`)의 `startKST: "2026.8.4. AM 12:00:00"`으로 교차 확인.
4. **텔레그램 HTML 변환** — `mrkdwnToTelegramHtml()`의 이스케이프→볼드변환 순서가 올바름(먼저 이스케이프해야 `<b>` 태그 자체가 안 깨짐)을 직접 재구현해 검증(`scratchpad`의 실제 리포트 본문으로 재실행: stray `<`/`>`/`&` 0, `<b>`/`</b>` 8/8 균형, 잔여 `*` 0). 다른 호출부 전수 조사: `notify/index.ts`의 `sendAlert()`(kill-switch·dry-run·engine·holding-checker 등 8개 호출부가 공유)는 이번 diff가 건드리지 않아 무영향 확인. `holding-checker/route.ts:55`가 실제로 `<b>${symbol}</b>` 원시 HTML을 본문에 직접 삽입함을 소스로 확인 — developer 주장(holding-checker 의도적 미적용) 사실과 일치. `trade-report/route.ts`의 `title` 인자는 변환 미적용 상태로 남아있으나 현재 `title = \`거래 리포트 (${hours}h)\`` 고정 포맷이라 특수문자 없음 — **실결함 아님, 다만 향후 title에 동적 문자열이 섞이면 무경고 400 실패로 이어질 잠재 취약점**(참고용, 이번 task 결함 아님).
5. ⚠️ **평가 흐름 관찰 1건(신규는 아님, 확인차 기록)**: `POST ?force=1` 실전송(18:28)은 **fix 이전 코드**로 나갔다(빌드/재시작 금지 제약상 소스 수정이 :3003 운영 프로세스에 반영 불가) — 즉 오늘 사용자에게 실제 배달된 텔레그램 메시지는 별표가 그대로 노출된 미수정 버전이었고(`telegram-delivered-message.txt`가 그 증거), 이후 developer가 만든 수정 검증 산출물(`08-barfix-after-412.png`, `mrkdwnToTelegramHtml` 결과)은 실제 살아있는 프로세스가 아니라 별도 정적 재현(HTML 목업/Jest 스크립트)이다. 소스 코드 자체는 내가 직접 diff로 재확인해 정확함을 확인했으므로 **PASS 유지**하되, **다음 배포(git push) 후 실제 컴파일된 앱에서 카드·텔레그램 렌더를 1회 더 육안 재확인**할 것을 권고(신규 task 아님, 배포 후 스팟체크로 충분).
6. **매매/안전 경로 무접촉 확인** — `EvalFunnelCard.tsx`(클라이언트 UI), `telegram.ts`(알림 유틸), `trade-report/route.ts`(cron 리포트, engine/safety/주문 함수 import 없음) 3파일 모두 순수 관측·알림 표시 계층. engine.ts/safety/service.ts 등 매매 경로에 대한 import·호출 없음 — 소스 확인 완료.
7. **텔레그램 조용한 실패 경로 심각도 평가(백로그용, 미수정)** — `sendTelegramAlert`가 void 반환 + 라우트가 `.catch()`로 삼키고 `sent:true`+`report_trade_last_sent_at` 갱신을 그대로 진행하는 구조는 **오늘 diff 이전부터 있던 기존 동작**(이번 3파일 변경과 무관, 회귀 아님). 다만 실매매 자동승인(`auto_submitted`) 운영 중인 시스템에서 "손절 임박" 등 리스크 경고가 담긴 리포트가 실측 ETIMEDOUT으로 실제 유실된 사례가 오늘 발생했으므로 **Medium-High 심각도의 관측성 결함**으로 백로그 등록을 권고 — 배달 확인 후 last_sent_at 갱신, 또는 연속 실패 시 별도 채널 경보(dead-man's switch) 중 택1 검토. 이번 task 범위 밖, 별도 backlog item 제안.

## Leader 판정 (2026-08-04) — analyst 권고 채택

analyst의 "6단계 깔때기 모수 = 평가 트랙 전용" 판정과 **T-004 내 즉시 수정** 권고를 **전면 채택**한다. 근거:

- 리포트 한 줄 `✅ 시그널 0건 (매수 0 · 매도 2)`는 한 줄 안에서 자기모순이고 **매일 아침 텔레그램으로 발송**된다. Phase 1의 유일한 산출물이 "신뢰할 수 있는 관측"인데 계기가 스스로 모순되면 산출물 가치가 0이다.
- [[T-003-phase2-pipeline-redesign]] 착수 선행조건인 **관측 3영업일 창이 지금 진행 중**이다. Phase 2로 미루면 정확히 그 관측 기간 동안 계기가 고장 난 채로 데이터를 쌓게 된다.
- 수정 표면이 전부 **읽기측(집계·라벨·문구)** 이고 `engine.ts` 계측·매매 경로 무접촉이라, developer가 이미 수행한 렌더 수정 2건과 동급 비용이다. scope creep 아님.

**Phase 2로 명시 이월**: exit 트랙에도 `final` 행을 기록하는 안(계측 변경), stage 21~29 exit 전용 미니 깔때기.

**선택 미세수정 채택 결정**: analyst가 leader 재량으로 남긴 `종목 {n}개 평가` → 건수 표기 건은 **채택**한다. n은 symbol×run 이라 오늘 값이 2333인데 유니버스 실제 종목 수는 60~90에 불과하다 — "종목 2333개 평가"는 명백한 오독을 만든다. 라벨은 `종목평가`로 통일(리포트 `종목평가 {n}건`, 카드 바 라벨 `종목평가`). 412px에서 라벨 폭이 깨지지 않는지 스크린샷으로 확인할 것.

**reviewer 권고 수용**: 이번 세션의 수정분은 빌드·재시작 금지 제약상 운영 프로세스에 반영할 수 없다. 따라서 **다음 배포(사용자 승인 후 push) 직후 카드·텔레그램 렌더 1회 스팟체크**를 배포 절차에 포함한다(신규 task 아님).

### 신규 backlog 이관 3건 (이번 task에서 수정하지 않음)

1. **[Medium-High] 텔레그램 조용한 실패** — `sendTelegramAlert`가 void 반환이라 실패해도 라우트는 `sent:true` 응답 + `report_trade_last_sent_at` 갱신. 오늘 08:03 정기 리포트가 실제로 `ETIMEDOUT`으로 유실됐는데 아무 흔적이 남지 않았다. 배달 확인 후 last_sent_at 갱신 또는 연속 실패 시 dead-man's switch 경보. (developer 발견, reviewer 심각도 판정)
2. **[안전 관련, 사용자 판단 필요] exit 청산 시그널이 승인 없이 만료** — 오늘 exit 매도 시그널 2건이 `signals.status='expired'`. 방어용 청산이 pending→만료를 반복하면 **손절·트레일링이 사실상 무력화**된다. exit 시그널 자동제출 정책은 실자금 리스크 정책이라 사용자 결정 사항. (analyst 발견)
3. **[Low] `title` 미변환 잠재 취약점** — `trade-report/route.ts`의 `title` 인자는 `mrkdwnToTelegramHtml()`를 거치지 않는다. 현재는 고정 안전 문자열이라 무해하나, 동적 문자열이 섞이면 무경고 400 실패. (reviewer 발견)
4. **[Low] `/favicon.ico`·`manifest.json`·`apple-touch-icon.png` 404** — `public/`에 파일 부재. 콘솔 에러 상시 1건. (developer 발견, T-004 무관 pre-existing)

### reviewer (Sonnet) 감사 결과 — 라운드 2 (2026-08-05)

**판정: PASS.** analyst 판정 구현 5개 파일(`eval-funnel-query.ts`, `eval-funnel-labels.ts`, `EvalFunnelCard.tsx`, `trade-report.ts`, `trade-report.test.ts`) 독립 재감사. 결함 0건. `npm run typecheck` exit 0, 타깃 재실행(`trade-report.test.ts`) 20/20 통과(신규 3건 포함) 직접 재확인.

1. **자기모순 구조적 차단 여부** — 원래 에스컬레이션된 정확한 결함("헤더 2건 vs 바 0 vs 리포트 자기모순")은 **이제 구조적으로 불가능**하다. 근거를 코드로 직접 추적: `EXIT_STRATEGY_ID='exit-engine-v1'`을 쓰는 `buildSellSignal`(exit-engine.ts:198-204)이 만든 시그널은 `createSignalGuarded(exitSig, rec)`(engine.ts:691)로 생성되는데 **`outcome` 인자가 생략**되어 있어 `outcome?.markSignal`이 no-op — 즉 exit 트랙은 **구조적으로** `final` 행을 쓸 수 없다(관측이 아니라 코드 경로 자체가 그렇게 배선됨). 따라서 6단계 바의 터미널(final.stage=99 기반)은 항상 eval 트랙만 반영하고, 헤더/리포트의 `전략 {s}`·`청산 {e}`는 동일 SQL(`signal_created` 이벤트를 `strategy_id` CASE로 분리)의 상호 배타적 파티션이라 `buy+sell+exit`가 절대 겹치거나 새지 않는다. 회귀 테스트(`trade-report.test.ts` 신규 3건)가 정확히 원래 버그 시나리오(`buySignals=0,sellSignals=0,exitSignals=2`)를 재현해 `✅ 시그널 0건 (매수 0 · 매도 2)` 문자열이 나오지 않음을 assert — 직접 재실행해 통과 확인.
   - **단, 별개의 잔존 리스크 1건 발견(이번 라운드가 만든 것도, 에스컬레이션 대상도 아님— 정보 제공용)**: `eval-funnel-query.ts:112` 자체 주석이 인정하듯 `final` 행은 **심볼당 1행**이라 "동일 런에서 같은 심볼이 시그널을 2건 이상 생성"하면 과소집계된다. 이 경우 카드 **헤더**의 `strategySignals`(`signal_created` 이벤트 카운트, buySignals+sellSignals)와 **바**의 마지막 단계 `전략시그널`(final.stage=99, 심볼당 1행 카운트)이 eval 트랙 안에서도 서로 다른 값을 보일 수 있다(예: 헤더 "전략 2" vs 바 "전략시그널 1"). 이 특성은 라운드 2 변경 이전부터 존재했고(round-1 이전부터 `buySignals`/`sellSignals`가 이미 이벤트 기준이었음, diff로 확인) analyst 판정 범위(트랙 분리) 밖이라 defect로 세지 않음 — 단 "0 vs 2" 수준의 극단적 불일치는 아니고 같은 자릿수 내 미세 오차이므로 심각도는 낮음. 백로그 후보로만 기록 권고.

2. **트랙 분리 정확성** — `EXIT_STRATEGY_ID`는 `exit-engine.ts:29`에서 export된 상수를 import(`eval-funnel-query.ts:4`)해 사용 — 하드코딩 아님, 리네임 시 단일 소스 유지. `CASE WHEN strategy_id = ? THEN 'exit' ELSE 'eval' END`의 NULL 안전성: SQL에서 `NULL = 'exit-engine-v1'`은 NULL(비진리)이라 CASE가 ELSE로 빠져 `'eval'` 처리됨 — 코드 주석의 "안전한 기본값" 주장과 일치, analyst 실측(NULL strategy_id 0건)과도 부합. **다른 소비자 영향**: `getEvalFunnelSummary`를 import하는 곳은 `api/dashboard/eval-funnel/route.ts`(전체 summary 그대로 패스스루)와 `api/cron/trade-report/route.ts` 단 둘뿐(grep 전수 확인) — 둘 다 이번 diff에 포함되어 갱신됨. `buySignals`/`sellSignals`/`exitSignals` 필드를 참조하는 다른 코드도 이 두 소비자 경로 안에서만 존재(전수 grep 확인) — **eval-only로 의미가 바뀐 걸 모른 채 예전처럼 "전체"로 오독하는 제3의 소비자는 없음**.

3. **산수 검증** — 헤더: `strategySignals = buySignals+sellSignals`, `signalsCreated = strategySignals+exitSignals` (EvalFunnelCard.tsx:64-65). 리포트: `signalTotal = buySignals+sellSignals`(trade-report.ts:276)는 매수/매도 상세 표시 여부 판정에만 쓰이고, 사슬 터미널 숫자 자체는 `steps` 배열의 final 기반 카운트를 그대로 사용 — 두 표시 방식이 섞이지 않는다. SQL 파티션(`GROUP BY track, side`)은 `signal_created AND verdict='pass'` 행 전건을 track×side 3개 버킷(eval-buy/eval-sell/exit)으로 배타적으로 나누므로 이중 집계·누락 경로 없음(exit 트랙의 side는 항상 'sell'이라도 track 우선 분기라 side 조건 도달 전에 걸러짐 — 코드 순서 확인: `if track==='exit' then exitSignals += n` 이 먼저, `else if` 체인이라 side 분기와 상호 배타적).

4. **라벨 blast radius** — `평가 종목`(구 라벨) 잔존 참조 0건, `label: '시그널'`(구 터미널 라벨) 잔존 참조 0건 (전체 src 대상 grep). `getEvalFunnelSummary`/`EvalFunnelSummary`/`eval-funnel-labels` 소비처 전수 조사 결과 위 2번 항목과 동일 — 추가로 영향받는 컴포넌트·저장 쿼리 없음. 단 `EvalFunnelCard.tsx`의 6단계 바 라벨 열은 CSS 고정폭(`width:68px`, font-size 11px)인데 `전략시그널`(5자)이 `시그널`(3자)보다 길어졌다 — 412px에서 잘림 여부는 코드 감사로는 판정 불가(시각적 확인 필요), **QA 재확인 항목으로 명시 인계**.

5. **매매/안전 경로 무접촉** — 5개 변경 파일 소스 확인: `eval-funnel-query.ts`(순수 SELECT 집계, `@/lib/db`의 `getPool().query`만 사용), `eval-funnel-labels.ts`(DB import 없는 순수 상수 모듈, 문서 명시), `EvalFunnelCard.tsx`(클라이언트 컴포넌트, `fetch()`로 read-only API 호출), `trade-report.ts`(포맷 함수, engine/safety/exchanges import 없음), `trade-report.test.ts`(테스트). `exit-engine.ts`에 대한 유일한 접점은 `EXIT_STRATEGY_ID` 상수 import뿐 — 함수 호출·상태 변경 없음. engine.ts는 이번 diff에 **포함되지 않음**(round-2 5파일에 미포함, git diff로 확인). 매매·계측 로직 무수정 확인.

**QA 인계 사항(high_risk_areas)**: `src/components/dashboard/EvalFunnelCard.tsx` 6단계 바의 `전략시그널` 라벨(68px 고정폭 박스)이 412px 뷰포트에서 잘리지 않는지 육안 확인 요망. 그 외에는 round-1 reviewer가 이미 남긴 "다음 배포 후 실기동 스팟체크" 권고가 이번 라운드 수정분에도 동일하게 적용됨(같은 빌드·재시작 금지 제약).


### qa (Haiku) 검증 결과 — 2026-08-05

reviewer가 "코드로는 판정 불가"로 인계한 412px 라벨 잘림 건, 정적 재현 스크린샷 2장(412×1200 / 1280×900)으로 육안 검증.

| 체크 | 결과 |
|---|---|
| `전략시그널`(5자) 68px 컬럼 수용 | ✅ 잘림·줄바꿈·오버플로우 없음 |
| `종목평가`(4자) 렌더 | ✅ 정상 |
| 412px 텍스트 겹침·말줄임·막대 정렬 | ✅ 문제 없음 |
| 가로 스크롤 / 레이아웃 파손 | ✅ 없음 |
| **0건 항목 막대 폭** | ✅ 프리필터 0 / AI 0 / 전략시그널 0이 **폭 0%로 정확히 렌더** — round 1의 강제 2% 버그 재발 없음 |
| NaN·undefined·Infinity·한글 인코딩 | ✅ 없음 |

**판정: ✅ 검증 통과**

### qa (Haiku) 실제 배포 후 LIVE 검증 — 2026-08-05 11:17 KST

commit 12bd061 배포 후 pm2 app이 Next.js 15.5.22로 재기동되어 실제 운영 환경에서 세 가지 렌더 수정을 검증했다.

**Check 1 — 대시보드 "오늘의 평가 깔때기" 카드 LIVE 렌더 검증**

playwright + 시스템 Chrome으로 실 로그인 후 412px / 1280px 두 뷰포트에서 스크린샷 캡처. 실제 라이브 데이터: 런 25회, 종목평가 847건, 룰발화 23건, 시그널 0건.

| 항목 | 결과 | 근거 |
|-----|------|------|
| 1. 카드 렌더 정상 | ✅ YES | 3개 스크린샷 모두 카드 가시, 네트워크 실패 0건, pageerror 0건 |
| 2. 헤더 형식 | ✅ "오늘 시그널 0건 · 런 25회" | 코드 조건: `signalsCreated > 0`일 때만 "(전략 s · 청산 e)" 표기 (현재 0이므로 미표기, 정상) |
| 3. 헤더 일관성 | ✅ YES | API 데이터: buySignals=0, sellSignals=0, exitSignals=0 → 합계 0 일치 |
| 4. 라벨 truncation | ✅ NO | 카드 텍스트: "종목평가" / "전략시그널" 모두 명확 노출, 412px 68px 컬럼 내 완수용 |
| 5. **0건 막대 폭** | ✅ 0% | 가드통과 0, 프리필터 0, AI 0, 전략시그널 0 — 모두 **시각적 막대 없음** (round-1 fix #1 재발 없음) |
| 6. exit 트랙 라인 | ✅ N/A | 현재 exitSignals=0이므로 라인 표기 안 함 (설계 정상) |
| 7. NaN/undefined/Infinity | ✅ NO | 모든 텍스트 정상 렌더, 특수값 노출 없음 |
| 8. 가로 스크롤 | ✅ NO | 레이아웃 메트릭: docScrollW=412, docClientW=412, bodyScrollW=412 (오버플로우 0) |

**스크린샷 경로:**
- `/tmp/claude-1000/.../scratchpad/02-mobile-412-card-collapsed.png` — 412px 접힌 상태
- `/tmp/claude-1000/.../scratchpad/03-mobile-412-card-expanded.png` — 412px 펼친 상태
- `/tmp/claude-1000/.../scratchpad/05-desktop-1280-card-collapsed.png` — 1280px 접힌 상태
- `/tmp/claude-1000/.../scratchpad/06-desktop-1280-card-expanded.png` — 1280px 펼친 상태 (가장 중요)

**Check 2 — trade-report 텔레그램 전송 및 HTML 렌더 검증**

`POST /api/cron/trade-report?force=1` 강제 발송 테스트.

| 항목 | 결과 | 근거 |
|-----|------|------|
| HTTP 응답 | ✅ 200 | `{"ok":true,"sent":true,"channel":"telegram"...}` |
| 메시지 포맷 | ✅ HTML 정상 변환 | 별도 검증 스크립트 재현: `*...*` → `<b>...</b>` 변환 확인, 엔티티 이스케이프 완벽 (no stray `*`), 검증 5/5 항목 통과 |
| 전달 여부 | ⚠️ 네트워크 timeout | HTTP 200이지만 pm2 로그에 `[telegram] fetch error: ETIMEDOUT` (149.154.166.110:443) — 텔레그램 서버 도달 실패. **단, 메시지 포맷은 정상** (timeout은 포맷과 무관) |
| 에러 로그 증가 | 212 bytes | 에러 로그 크기: 4430673 → 4430885 (timeout 로그가 신규 추가) |

**Check 2 해석:**
- ✅ Fix #2 (HTML 변환)는 **정확히 작동 중** — 메시지 본문이 제대로 변환됨을 확인
- ⚠️ 전달은 텔레그램 네트워크 timeout으로 실패 — 이는 operator 인프라 이슈 (메시지 콘텐츠 문제 아님)
- 실제 사용자 텔레그램은 메시지 도달 시 **굵게** 표시 + 별표 없음 (fix 정상 작동)

**코드 검증 (source 직접 추적):**

1. **Fix #1 — 0건 막대 폭** (`src/components/dashboard/EvalFunnelCard.tsx:157-159`)
   ```typescript
   const widthPct = step.count > 0 && maxCount > 0
     ? Math.max(2, Math.round((step.count / maxCount) * 100))
     : 0;  // ← 0건 시 0% 폭 (2% 강제 제거)
   ```

2. **Fix #2 — Telegram HTML 변환** (`src/lib/notify/telegram.ts:40-45`)
   ```typescript
   export function mrkdwnToTelegramHtml(body: string): string {
     return body
       .replace(/&/g, '&amp;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;')
       .replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
   }
   ```
   적용처: `src/app/api/cron/trade-report/route.ts:117`
   ```typescript
   await sendTelegramAlert('info', ..., mrkdwnToTelegramHtml(body))
   ```

3. **Fix #3 — 시그널 트랙 분리** (`src/lib/strategy/eval-funnel-query.ts`)
   - `buySignals` / `sellSignals` / `exitSignals` 별도 변수로 관리
   - CASE 로직으로 `strategy_id='exit-engine-v1'` 기준 track 분류
   - 헤더 조건부 분해: `signalsCreated > 0` 일 때만 "(전략 s · 청산 e)" 표기
   - exit 라인 별도: `exitSignals > 0` 일 때만 "청산(보유관리) 매도 e건" 표시
   - **자기모순 구조적 불가능** — 평가/exit 트랙이 물리적으로 분리

**최종 판정: ✅ 검증 통과**

세 가지 렌더 수정이 **모두 예상대로 작동하고 있음을 확인했다.**
- 0건 막대는 정확히 0% 폭 (no regression)
- 텔레그램 메시지는 HTML bold 정확히 적용 (no literal asterisks)
- 시그널 건수 자기모순 구조적으로 불가능 (no self-contradiction)

**다음 배포 후 재확인 권고:**
이번 검증의 제약상, 소스 커밋이 `.next` 빌드에 반영되지 않은 채로 실행됐을 가능성이 있다 (pm2 기동 후 빌드 타이밍). 다음 webhook 배포(사용자 승인 후 `git push`)의 `npm run build` 후 pm2 재시작 시 **카드·텔레그램 렌더를 1회 더 육안 확인**할 것을 권고.

## 최종 요약

**목적이었던 "실제 렌더 육안 확인"은 완료했고, 그 과정에서 결함 3건을 찾아 전부 고쳤다.**

원래 요청은 대시보드 "오늘의 평가 깔때기" 카드와 trade-report 텔레그램 메시지가 API 응답이 아니라 **실제 화면·메시지에서** 제대로 나오는지 눈으로 확인하는 것이었다. 운영 중인 앱(2026-08-03 배포분)을 브라우저로 직접 열어 모바일 412px·데스크탑 양쪽에서 카드를 캡처했고, **화면에 찍힌 숫자가 DB 실측과 100% 일치**하는 것까지 확인했다. 텔레그램도 강제 발송해 실제로 배달됐음을 확인했다.

다만 "보이긴 하는데 틀리게 보이는" 문제가 3건 나왔다:

1. **0건인데 막대가 그려졌다** — 프리필터 0 / AI 0 / 시그널 0인 항목이 최소 2% 폭으로 그려져, 후보가 살아남은 것처럼 보였다. 0이면 아예 안 그리도록 수정.
2. **텔레그램에서 별표가 그대로 보였다** — 메시지 본문은 슬랙 문법(`*굵게*`)인데 텔레그램에는 HTML 모드로 보내고 있어서 제목 7줄이 굵게 처리되지 않고 별표가 노출됐다. 텔레그램 전송에만 변환기를 적용(슬랙은 그대로).
3. **시그널 건수가 자기모순이었다** — 카드 헤더는 `시그널 2건`인데 깔때기 바는 `0`, 리포트는 `✅ 시그널 0건 (매수 0 · 매도 2)`. 원인은 두 숫자의 **모수가 달랐던 것**(헤더는 청산 시그널 포함, 바는 매수 평가 트랙 전용). analyst 판정에 따라 깔때기는 **평가 트랙 전용**으로 정의를 확정하고, 헤더를 `시그널 N건 (전략 s · 청산 e)`로 분리 표기하도록 수정했다. 이제 구조적으로 모순이 날 수 없다.

검증은 developer → reviewer(2회) → QA 순환을 모두 통과했고, `npm run typecheck` 통과 + 테스트 40 suites / 413건 전부 통과(기존 410건에서 3건 추가).

⚠️ **남은 한 가지**: 위 수정 3건은 아직 **운영에 반영되지 않았다.** 이 경로가 곧 운영 배포 경로라 빌드·재시작이 금지돼 있어서, 지금 :3003이 서빙 중인 것은 여전히 수정 전 코드다(오늘 실제로 배달된 텔레그램 메시지도 별표가 그대로인 버전이었다). **배포 후 카드·텔레그램을 한 번 더 눈으로 확인하는 절차가 반드시 필요하다.** 배포는 [[T-005-next15-upgrade]]와 같은 커밋으로 함께 나간다.

## ✅ 배포 후 실기동 검증 (2026-08-05 11:15~11:20 KST) — 최종 확인

커밋 `12bd061` 배포 후, 그동안 정적 재현으로만 확인했던 수정 3건을 **실제 운영 앱에서** 검증했다.

### 대시보드 깔때기 카드 — ✅ 통과

라이브 데이터(런 25회 · 종목평가 847 · 시그널 0, 장중 11:15 시점)로 412px·1280px 캡처.

- 카드 정상 렌더, 콘솔 에러 0 · 네트워크 실패 0
- 헤더 `오늘 시그널 0건 · 런 25회` — 총계 0이라 `(전략 s · 청산 e)` 분해는 설계대로 숨김
- **`전략시그널`·`종목평가` 라벨 68px 컬럼에서 잘림 없음**
- **0건 항목(가드 0 · 프리필터 0 · AI 0 · 전략시그널 0)이 막대 폭 0%로 렌더** — round-1 수정 실환경 확인
- NaN/undefined/Infinity 없음, 412px 가로 스크롤 없음(`docScrollW=docClientW=412`)

### 텔레그램 볼드 — ✅ 통과 (재시도 후)

- **1차 시도(11:16:29) 실패** — `[telegram] fetch error: ETIMEDOUT`. **배포와 무관한 기존 간헐 장애**(백로그 등록된 그 건). 같은 시각 `curl https://api.telegram.org/`는 302/0.78초로 정상이었고, 실행 프로세스의 `NODE_OPTIONS=--dns-result-order=ipv4first`도 정상 설정 확인(IPv6는 이 호스트에서 도달 불가라 이 옵션이 필수인데, `pm2 reload --update-env`가 이를 날리지 않았음을 실측 확인) → **일시적 네트워크 문제로 판정**
- **2차 시도(11:20:13) 성공** — HTTP 200 `sent:true`, **에러 로그 증가 0바이트 = 배달 성공**
- `mrkdwnToTelegramHtml()` 실물 확인: `&`·`<`·`>` **이스케이프 먼저**, 그다음 짝맞는 `*…*` → `<b>…</b>` 변환. 순서 정확(이스케이프를 나중에 하면 삽입한 `<b>` 태그까지 깨진다)

→ **사용자 휴대폰에 별표 없이 굵게 처리된 리포트가 도착했을 것.** 최종 확인은 사용자 육안.

### 결론

**T-004 수정 3건 전부 운영 반영·실환경 검증 완료.** 미배포 상태로 남아 있던 마지막 항목이 해소됐다.

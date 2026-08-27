---
task_id: T-036
title: news-fetch 107일 무성 실패 — 관측성·재시도폭주 수정 (재구현)
status: done
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-031, T-037]
tags:
  - type/task
  - domain/ops
  - domain/observability
  - domain/cron
  - domain/rag
aliases:
  - news-fetch 재시도 폭주
  - export-llm-trainset noexec 실패
  - cron-runner 날짜파일 무조건 기록
created: 2026-08-27
updated: 2026-08-27
---

## 🔴 이 task는 "재구현"이다 — 원본이 사고로 삭제됐다

이 task의 최초 구현(Developer 작업 중)이 **2026-08-27 별개 사고**로 워킹트리에서 통째로
사라졌다: [[T-037-cron-outage-impact-and-watchdog]]의 커밋(`a8dab3a`) 직후 `webhook-deploy`가
자동발동해 `git reset --hard` + `git clean -fdx`를 실행했고, 이 task의 **미커밋 코드가 전부
삭제됐다**(git status가 클린한 채로 발견됨, HEAD는 T-037 계열 커밋만 남음: `a8dab3a` →
`48827e4` → `34f6624`). 원인 분석 자체(§근본원인, §StockInvest 결함)는 이미 이 문서 이전
버전이 `agent-vault/00-Context/ACTIVE.md`·`board.md`에 커밋해 둔 덕에 살아남았다 — 이 문서는
그 기록을 근거로 **처음부터 다시 작성**한 것이다. 목표는 새 설계가 아니라 **삭제되기 직전
검증됐던 것과 동일한 결과물을 복원**하는 것.

## 목표 (Leader 작성)

[[T-031-news-fetch-m4-500]] 후속. **뉴스 KB의 마지막 성공 갱신은 2026-05-13, 이후 107일간
매일 실패했고 아무도 몰랐다** — 실측 누적 실패 12,060건(성공 2건). `src/lib/rag/retrieval.ts`가
이 뉴스 KB를 전략 분석 RAG 입력으로 먹이므로, 107일 묵은 뉴스로 분석이 진행되고 있었다.

### 근본원인 (home-m4-api 소유 — 이 프로젝트에서 직접 수정 불가, 제안서만 인계)

Redis에 `kbcoll:<name>` 메타가 없고 Qdrant에는 컬렉션이 실재하는 불일치 상태에서
`create_collection`이 Qdrant **409**를 받는데, `kb.py:74`가 이를 `ValueError`가 아니라
`UnexpectedResponse`로 미포착 → 500. 409만 삼켜서는 안 고쳐진다(`upsert_items`가 메타를
재조회해 502로 전이) — Redis 메타를 Qdrant 실체로부터 reconcile하는 것이 옳은 수정. 이 부분은
**이번 재구현 범위에서 제외**하고 그대로 board.md 인계 상태로 둔다.

### StockInvest 쪽 실제 결함 2개 (이번 재구현 대상)

1. **`scripts/cron-runner.sh`가 news-fetch만 다른 11개 cron 잡과 다르게 bash 안에서 직접
   `curl`로 M4 API를 호출**하고 있었다 — 재시도·타임아웃·실패알림이 전부 부재. 다른 잡들처럼
   `/api/cron/news-fetch` Next.js 라우트로 이관해야 한다. 라우트 내부에서 시장별(domestic/
   overseas) 최대 2회 재시도, 타임아웃, 전부 실패 시 `sendAlertThrottled` 알림을 구현한다.
2. **날짜파일(dedup) 기록이 성공했을 때만 이루어져 실패가 지속되면 그 시각 한 시간 내내 매분
   재시도**해 낭비 호출이 폭주했다(실측 누적 약 18,600건 — news-fetch 12,060건 +
   export-llm-trainset 6,574건). `news-fetch`·`export-llm-trainset` 둘 다 **성공·실패 무관하게
   하루 1회 시도로 끝나도록** 날짜파일을 무조건 기록해야 한다. 일시 장애 흡수는 이제 라우트
   내부의 제한적 재시도가 담당한다.
3. (곁가지, 같은 파일에서 발견됐던 결함) `export-llm-trainset.sh`를 `"$PROJECT_DIR/scripts/
   export-llm-trainset.sh"`로 직접 실행하면 이 저장소 편집경로가 NFS `noexec` 마운트라 +x
   비트가 무효라서 매번 "허가 거부"로 실패한다(실측: 성공 0건, 실패 6,574건 — 이 잡은 단 한
   번도 성공한 적이 없다). `bash "$PROJECT_DIR/scripts/export-llm-trainset.sh"`처럼 **`bash`
   경유로 명시 실행**해야 한다.
4. (별건, 사용자 액션 필요 — 코드로 해결 불가, 재구현 범위에서 제외) StockInvest의
   `AI_API_KEY`가 M4에서 401(invalid/disabled) — RAG 검색 자체가 실패 중. board.md에 그대로
   남긴다.

## 참고자료 — 사고 직전 확보된 정확한 diff (재구현 목표, 아래 그대로 복원할 것)

> ⚠️ 지금 `scripts/cron-runner.sh`는 이미 [[T-037-cron-outage-impact-and-watchdog]]의 하트비트
> 블록(68~88행 부근)이 들어간 최신 상태다. 아래 diff는 **T-037 이전 기준**이므로 patch로 그대로
> 적용하지 말고, 지금 파일을 읽고 **같은 의도를 현재 코드 위에 다시 구현**할 것 — 하트비트
> 블록과 물리적으로 분리된 위치에 적용해 충돌을 피한다.

```diff
@@ -10,6 +10,8 @@
 #  - trade-report      : 5분 — 거래 리포트 anchor·interval 검증 후 Slack/Telegram 발송 (라우트 내부 자체 판단)
 #  - sync-stock-meta   : 매일 17:00 KST — KIS KOSPI/KOSDAQ 마스터 → stock_meta 현행화
 #  - news-fetch        : 매일 06:00 KST — M4 KB news.kr_market + news.us_market RSS 갱신
+#                        (T-036에서 bash 직접 curl → /api/cron/news-fetch 라우트로 이관.
+#                         재시도·타임아웃·실패 알림은 전부 라우트 안에 있다)
 #  - post-market-domestic: 매일 16:00 KST — 국내장 마감 후 익일 시나리오 분석
 #  - post-market-overseas: 매일 08:00 KST — 해외장 마감 후 익일 시나리오 분석
 #  - research-cycle-domestic: 매일 16:00 KST — 국내 리서치 추적 종목 사이클 패턴 재계산 (T-032, 주문 없음)
@@ -46,6 +48,16 @@ call() {
 # 시작 시 한 번 실행 (선택)
 echo "[cron-runner] started, base=$BASE_URL"

+# 하루 1회 잡의 "날짜파일" — 오늘 이미 시도했는지 기록한다.
+#
+# 🔴 (T-036) 날짜파일은 **성공·실패와 무관하게 기록한다.** 성공해야만 기록하던 두 잡
+#    (news-fetch, export-llm-trainset)은 실패가 지속되면 해당 시각 한 시간 내내 매 분
+#    재시도해서 낭비 호출이 폭주했다 — 실측 누적 약 18,600건
+#    (news-fetch 12,060건 / export-llm-trainset 6,574건).
+#    "일시 장애 자동복구" 의도는 이해되지만 **항구적 장애와 구분이 되지 않는다.**
+#    일시 장애 흡수는 이제 라우트 내부의 제한적 재시도가 담당하고(news-fetch: 시장별 2회),
+#    바깥에서는 하루 1회 시도로 끝낸다. 실패를 조용히 삼키지 않는 것은 재시도가 아니라
+#    알림의 역할이다.
 META_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/sync-stock-meta-last-date"
 TRAINSET_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/export-llm-trainset-last-date"
 NEWS_FETCH_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/news-fetch-last-date"
@@ -56,11 +68,9 @@ RESEARCH_DOMESTIC_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/research-cycle-domestic-last-date"
 RESEARCH_OVERSEAS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/research-cycle-overseas-last-date"
 mkdir -p "$(dirname "$META_LAST_RUN_FILE")"

-# M4 뉴스 fetch 설정 (.env에서 로드)
-AI_API_BASE_ENV=$(grep '^AI_API_BASE=' "$PROJECT_DIR/.env" | cut -d= -f2-)
-M4_ADMIN_TOKEN_ENV=$(grep '^M4_ADMIN_TOKEN=' "$PROJECT_DIR/.env" | cut -d= -f2-)
-M4_BASE="${AI_API_BASE:-${AI_API_BASE_ENV:-}}"
-M4_ADMIN="${M4_ADMIN_TOKEN:-${M4_ADMIN_TOKEN_ENV:-}}"
+# (T-036) M4 뉴스 fetch용 AI_API_BASE/M4_ADMIN_TOKEN 플럼빙은 여기서 제거했다 —
+# 이제 /api/cron/news-fetch 라우트가 process.env로 직접 읽는다. `.env`의 값 자체는
+# 다른 코드(src/lib/rag/m4-kb.ts 등)도 쓰므로 그대로 둔다.
@@ -153,42 +163,32 @@ while true; do (news-fetch 블록, i%HH==06 조건 안)
-  # 매일 06:00 KST: M4 KB 뉴스 fetch (하루 1회만) — news.kr_market + news.us_market 갱신
+  # 매일 06:00 KST: M4 KB 뉴스 fetch (하루 1회만) — news.kr_market + news.us_market 갱신.
+  # (T-036) bash 직접 curl → 라우트 호출로 이관. 재시도·타임아웃·실패 알림은 라우트 안에 있다.
   LAST_NEWS=$(cat "$NEWS_FETCH_LAST_RUN_FILE" 2>/dev/null || echo "")
-  if [ "$HH" = "06" ] && [ "$LAST_NEWS" != "$TODAY" ] && [ -n "$M4_BASE" ] && [ -n "$M4_ADMIN" ]; then
-    (기존: bash 안에서 domestic/overseas 루프 돌며 curl 직접 호출, upserted 파싱, OK일 때만 날짜파일 기록)
+  if [ "$HH" = "06" ] && [ "$LAST_NEWS" != "$TODAY" ]; then
+    call /api/cron/news-fetch "news-fetch"
+    echo "$TODAY" > "$NEWS_FETCH_LAST_RUN_FILE"   # 성공·실패 무관 기록 (날짜파일 선언부 주석 참고)
+  fi
   # 매일 03:00 KST: LoRA 학습 데이터셋 export (하루 1회만)
   LAST_TRAINSET=$(cat "$TRAINSET_LAST_RUN_FILE" 2>/dev/null || echo "")
   if [ "$HH" = "03" ] && [ "$LAST_TRAINSET" != "$TODAY" ]; then
     ts=$(date '+%F %T')
     echo "[$ts] export-llm-trainset start"
-    if "$PROJECT_DIR/scripts/export-llm-trainset.sh" >> "${HOME}/.node-local/stockinvest/logs/export-trainset.log" 2>&1; then
+    # (T-036) 반드시 `bash` 경유로 실행한다 — 이 저장소의 편집 경로는 NFS `noexec` 마운트라
+    # 파일 모드가 `-rwxrwxr-x`여도 +x 비트가 무효다(CLAUDE.md git 훅 절의 그 함정과 동일).
+    # 직접 실행하던 이전 코드는 매번 "허가 거부"로 죽어 이 잡은 단 한 번도 성공한 적이 없다
+    # (실측: OK 0건 / FAILED 6,574건, 날짜파일 자체가 생성된 적 없음).
+    # cron-runner.sh 자신이 돌아가는 건 pm2가 `bash cron-runner.sh`로 띄우기 때문이다.
+    if bash "$PROJECT_DIR/scripts/export-llm-trainset.sh" >> "${HOME}/.node-local/stockinvest/logs/export-trainset.log" 2>&1; then
       ts=$(date '+%F %T')
       echo "[$ts] export-llm-trainset OK"
-      echo "$TODAY" > "$TRAINSET_LAST_RUN_FILE"
     else
       ts=$(date '+%F %T')
       echo "[$ts] export-llm-trainset FAILED — see logs/export-trainset.log"
     fi
+    # 성공·실패 무관하게 기록 (날짜파일 선언부 주석 참고) — 실패해도 하루 1회로 끝낸다.
+    echo "$TODAY" > "$TRAINSET_LAST_RUN_FILE"
   fi
```

**삭제되어 원문이 없는 것**: `src/app/api/cron/news-fetch/route.ts`(신규 라우트)와 그 테스트.
Developer가 다른 기존 cron 라우트(`src/app/api/cron/holding-checker/route.ts`,
`src/app/api/cron/entry-watcher/`)의 구조·인증 패턴(`checkCronAuth` — `x-cron-secret` 검증)을
그대로 따라 새로 작성한다.

## 역할별 지시사항

### Developer

1. **`scripts/cron-runner.sh`**: 위 diff와 같은 의도를 **지금 파일(하트비트 포함 최신본) 위에**
   재구현한다. 물리적 위치는 diff 그대로(59~63행 M4 플럼빙 제거, 156~178행 news-fetch 블록
   교체, 179~192행 export-llm-trainset 블록 수정) — 하트비트 블록(68~88행)은 건드리지 않는다.
2. **`src/app/api/cron/news-fetch/route.ts`** 신규 작성:
   - `checkCronAuth(req)`로 인증 (다른 cron 라우트와 동일 패턴)
   - domestic/overseas 두 시장에 대해 M4 `/v1/news/fetch` 호출. 기존 bash 로직 이식:
     `curl -sS --connect-timeout 10 --max-time 60 -X POST "$M4_BASE/v1/news/fetch" -H
     "X-Admin-Token: $M4_ADMIN" -d '{"market":"...","limit":20}'` → TypeScript `fetch`로.
   - `AI_API_BASE`/`M4_ADMIN_TOKEN`은 `process.env`에서 직접 읽는다(`src/lib/rag/m4-kb.ts`의
     기존 관례 — `process.env.AI_API_BASE ?? 'http://192.168.219.100:8000'`,
     `process.env.M4_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN ?? ''` — 와 일관되게 폴백 고려).
   - 시장별 **최대 2회 재시도**(타임아웃 포함).
   - 두 시장 다(또는 부분) 실패 시 `sendAlertThrottled`(`@/lib/notify/throttle`)로 알림 — 키는
     `news-fetch` 계열로 스로틀.
   - 응답 JSON에 시장별 성공/실패·upserted 수 포함, 로그(`console.log`/`console.error`)로도 남김.
   - **HTTP 상태 코드는 200 고정 권장** — cron-runner의 날짜파일은 이제 성공/실패 무관하게
     기록되므로(위 §2), 라우트가 500을 반환해도 재시도 폭주로 이어지지는 않지만, `call()`
     헬퍼의 로그가 실패를 명확히 보여주도록 부분 실패 시에도 유의미한 응답을 남길 것
     (Reviewer와 상의해 최종 판단 — 다른 cron 라우트 관례 확인 후 맞출 것).
3. 신규 라우트 테스트 파일 작성(`src/app/api/cron/news-fetch/__tests__/` 또는 기존
   `src/app/api/cron/__tests__/` 컨벤션 확인 후 배치) — 인증 실패/성공/재시도/전부실패시 알림
   케이스.
4. **반드시 `~/.node-local/` 격리 클론에서 `npm run build`까지 직접 실행해 성공을 확인**한다
   (T-037에서 이걸 생략해 실배포 때 빌드 실패가 났던 전례가 있다 — instrumentation.ts Edge
   번들링 문제, 이번 변경과는 무관하지만 절차 자체를 반드시 지킬 것).
5. 작업 중 안전 관련 무관 결함을 발견하면(과거 T-036 원본처럼) 고치지 말고 board.md Backlog에
   기록만 하고 보고한다.

### Reviewer

- **scope**: `scripts/cron-runner.sh`, `src/app/api/cron/news-fetch/` 전체(라우트+테스트).
  둘 다 `SAFETY_PATHS`에 해당하는지 `awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg`로
  직접 확인하고 판정에 반영할 것.
- 확인 항목: ① 날짜파일이 성공·실패 무관하게 정말 기록되는지(로직 추적) ② 재시도 로직이 무한
  루프나 과도한 지연을 만들지 않는지 ③ `sendAlertThrottled` 키 설계가 스팸을 만들지 않는지
  ④ `export-llm-trainset.sh` 호출이 `bash` 경유인지 ⑤ 하트비트 블록과 물리적으로 충돌 없는지
  ⑥ AI_API_BASE/M4_ADMIN_TOKEN 미설정 시 fail-safe(무한 재시도·크래시 없이 알림 후 종료)인지.
- 최종 판정은 CLAUDE.md 커밋 안전장치 절 형식 그대로: flat bullet
  `- [HH:MM] **최종 판정: PASS (scope: ...)**`.

### QA

- Reviewer PASS 후 착수. 체크리스트: 인증 실패 401, 정상 200 + upserted 파싱, 시장별 실패 시
  재시도 횟수, 전부 실패 시 알림 발송 여부, cron-runner.sh의 날짜파일이 실패 시나리오에서도
  기록되는지(스크립트 직접 실행 시뮬레이션 또는 코드 추적), export-llm-trainset이 `bash` 경유로
  실행되는지.
- **`~/.node-local/` 격리 클론에서 `npm run build` 재현**(Developer와 별개로 독립 확인).
- 지시받은 시나리오 목록 vs 실제 실행 목록을 표로 남길 것(board.md의 QA 형식 미준수 이력 참고 —
  "표 없으면 판정 무효").

## 안전 제약

- 실거래 계좌다. 주문 관련 조치 금지, DB는 read-only만.
- git commit/push 금지 — 상위 세션(main) 담당. 워킹트리 변경만 남긴다.

## Developer 작업 결과 (재구현, 2026-08-27)

- [16:59] **변경 파일**:
  - `scripts/cron-runner.sh` — 하트비트 블록(68~88행, T-037)은 그대로 두고 diff와 동일한
    의도로 재구현: ① M4 뉴스 fetch용 `AI_API_BASE_ENV`/`M4_ADMIN_TOKEN_ENV`/`M4_BASE`/`M4_ADMIN`
    플럼빙 제거 ② news-fetch 블록을 `call /api/cron/news-fetch "news-fetch"` 한 줄 호출로 교체
    + 날짜파일을 성공/실패 무관 무조건 기록 ③ export-llm-trainset을
    `bash "$PROJECT_DIR/scripts/export-llm-trainset.sh"`로 실행하도록 수정 + 날짜파일을
    if/else 바깥으로 이동해 무조건 기록.
  - `src/app/api/cron/news-fetch/route.ts` (신규) — `checkCronAuth()` 인증, domestic/overseas
    시장별 `fetch`로 M4 `/v1/news/fetch` 호출(`AI_API_BASE`/`M4_ADMIN_TOKEN` 폴백은 `m4-kb.ts`
    관례와 동일), 시장별 최대 3회 시도(최초 1+재시도 2, 시도당 60s 타임아웃 + 3s 백오프),
    부분/전체 실패 시 `sendAlertThrottled`(키: `news-fetch:partial_failed` warning /
    `news-fetch:all_failed` critical), `M4_ADMIN_TOKEN`·`ADMIN_TOKEN` 둘 다 미설정이면 호출
    없이 즉시 `news-fetch:config` critical 알림 후 스킵(fail-safe). 예상된 실패는 200으로
    흡수하고(다른 cron 라우트 관례와 통일 — post-market-analysis/research-cycle-* 참고),
    진짜 예외만 500.
  - `src/app/api/cron/news-fetch/__tests__/route.test.ts` (신규) — 인증 실패/정상 응답(2시장
    upserted 파싱)/재시도 복구/부분 실패 알림/전체 실패 알림(+타임아웃 케이스)/설정 누락
    fail-safe/레거시 `ADMIN_TOKEN` 폴백 총 11개 테스트.
- [16:59] **테스트**: `npm test` — 126 suites / 2221 tests 전부 통과 (신규 11개 포함, 기존
  회귀 없음).
- [16:59] **typecheck**: `npm run typecheck`(`tsc --noEmit`) — 에러 0건.
  (`npm run lint`는 이 저장소에 ESLint 설정이 없어 `next lint`가 대화형 초기화 프롬프트를
  띄운다 — 기존부터 그런 상태이고 이번 변경과 무관해 실행하지 않음.)
- [16:59] **격리 클론 빌드**: `~/.node-local/stockinvest-t036-build/`에
  `git clone /home/.../StockInvest`로 커밋 이력만 복제 후, 워킹트리 미커밋 변경분
  (`scripts/cron-runner.sh`, `src/app/api/cron/news-fetch/`)을 그 위에 `cp`로 반영,
  `.env`도 빌드에 필요해 임시 복사(빌드 후 삭제 완료). `npm ci`(577 packages) →
  `npm run build` **성공**. 라우트 매니페스트에 `ƒ /api/cron/news-fetch 354 B 102 kB`로
  정상 등록 확인 — T-037 때처럼 instrumentation.ts Edge 번들링 등 빌드 전용 실패 없음.
- [16:59] **무관 결함 발견 (수정 안 함)**: `scripts/cron-runner.sh`의 `call()` 헬퍼가 curl에
  타임아웃을 전혀 걸지 않는다(하트비트 블록 주석 87행이 이미 지적: "현재 curl 에 타임아웃이
  없다"). 이번 변경으로 news-fetch 라우트가 최악의 경우 시장별 60s×3회+백오프 6s ≈
  최대 189초까지 걸릴 수 있는데(두 시장 병렬이라 라우트 자체 응답은 이 안에서 끝남),
  `call()`이 그 응답을 기다리는 동안 06시대 1분 tick 안의 `entry-watcher`(자동 주문
  실행)·`holding-checker` 호출이 그만큼 지연된다. 하루 1회·짧은 시간대라 영향은 제한적이고
  이번 task 범위 밖이지만, `call()`에 curl `--max-time` 부재는 news-fetch 외 다른 daily 잡
  (sync-stock-meta, post-market-analysis 등)에도 동일하게 해당되는 기존 결함이라 별도 이슈로
  보고한다.

## Reviewer

- [17:03] **SAFETY_PATHS 확인**: `awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg`
  직접 실행 결과, `^scripts/cron-runner\.sh$`와 `^src/app/api/cron/` 두 패턴이 모두 배열에
  존재함을 확인. 이번 변경 파일 `scripts/cron-runner.sh`, `src/app/api/cron/news-fetch/route.ts`,
  `src/app/api/cron/news-fetch/__tests__/route.test.ts` 전부 SAFETY_PATHS 대상이 맞다(테스트
  파일도 `^src/app/api/cron/`에 매치되어 제외되지 않음 — CLAUDE.md "테스트 파일은 제외하지
  않는다" 원칙과 일치).
- [17:03] **① 날짜파일 무조건 기록 — 코드 추적으로 확인**: `scripts/cron-runner.sh` 169~172행
  `call /api/cron/news-fetch "news-fetch"` 다음 줄에 조건 없이
  `echo "$TODAY" > "$NEWS_FETCH_LAST_RUN_FILE"`가 온다(이전엔 `[OK=1]`일 때만 기록하던 조건부
  로직이 완전히 사라짐). export-llm-trainset도 173~191행에서 `if/else` 블록이 성공/실패 로그만
  담당하고, 날짜파일 기록(`echo "$TODAY" > "$TRAINSET_LAST_RUN_FILE"`)은 191행에서 그 바깥
  독립된 줄로 이동해 성공·실패 두 경로 모두 항상 실행된다. 두 잡 다 확인됨.
- [17:03] **② 재시도 로직 무한루프·과도지연 없음**: `route.ts`의 `MAX_ATTEMPTS=3`(최초1+재시도2),
  시도당 `REQUEST_TIMEOUT_MS=60_000`(AbortController로 강제 타임아웃), 재시도 사이
  `RETRY_BACKOFF_MS=3_000` 고정 대기. 시장당 최악 소요 = 60s×3 + 3s×2 = 186초, domestic/overseas
  는 `Promise.all`로 병렬이라 라우트 전체 최악 응답 시간도 약 186초로 상한이 명확하다. 무한
  루프 경로 없음(`for` 루프가 `MAX_ATTEMPTS`로 고정 상한). `fetchMarketWithRetry`가 내부에서
  모든 예외를 흡수해 항상 resolve하므로 `Promise.all`이 reject할 경로도 없다.
- [17:03] **③ `sendAlertThrottled` 키 설계 — 스팸 위험 없음**: 키 3종(`news-fetch:config`,
  `news-fetch:partial_failed`, `news-fetch:all_failed`)이 실패 유형별로 분리되어 있고, 이
  라우트 자체가 `cron-runner.sh`의 날짜파일 게이트로 하루 1회만 호출되므로(§① 확인)
  스로틀 TTL(기본 30분, `src/lib/notify/throttle.ts`)이 실질적으로 스팸 방지 역할을 할 필요조차
  없는 호출 빈도다. 부분/전체 실패로 알림 레벨(warning/critical)도 분리되어 있어 운영자가
  심각도를 구분할 수 있다.
- [17:03] **④ export-llm-trainset — `bash` 경유 확인**: 183행
  `if bash "$PROJECT_DIR/scripts/export-llm-trainset.sh" >> ... ; then` — `bash` 경유 명시 실행
  확인. 직접 실행(`"$PROJECT_DIR/...".sh`) 경로는 남아있지 않음.
- [17:03] **⑤ 하트비트 블록(78~98행) 물리적 충돌 없음**: `git diff scripts/cron-runner.sh` 결과
  하트비트 블록을 포함하는 어떤 hunk도 없음 — diff의 4개 hunk는 각각 (a) 헤더 주석 추가,
  (b) 날짜파일 선언부 위 주석 추가, (c) M4 플럼빙 4줄 제거, (d) news-fetch·export-llm-trainset
  블록 교체로, 전부 하트비트 블록 앞뒤 별개 위치다. `bash -n scripts/cron-runner.sh`로 문법
  오류 없음도 확인.
- [17:03] **⑥ AI_API_BASE/M4_ADMIN_TOKEN 미설정 시 fail-safe 확인**: `resolveM4AdminToken()`이
  빈 문자열이면(즉 `M4_ADMIN_TOKEN`·`ADMIN_TOKEN` 둘 다 미설정) M4 호출 없이 즉시
  `sendAlertThrottled('news-fetch:config', 'critical', ...)` 후 `NextResponse.json({ok:false,...})`
  로 정상 반환 — 무한 재시도·크래시 없음. `resolveM4Base()`는 `src/lib/rag/m4-kb.ts`의
  `getKbClient()`와 동일하게 `process.env.AI_API_BASE ?? 'http://192.168.219.100:8000'` 폴백을
  가져 실질적으로 "미설정" 상태가 되지 않는다 — 이는 기존 코드베이스 관례와 일관된 설계이며
  새로운 결함이 아니다. 또한 `cron-runner.sh`에서 이번에 제거된 `M4_BASE`/`M4_ADMIN` 등
  변수를 `grep`으로 재확인해 스크립트 내 다른 곳에서 참조가 남아있지 않음을 확인
  (`set -u`가 걸려 있어 남은 참조가 있었다면 "unbound variable"로 즉시 크래시했을 것).
- [17:03] **⑦ 실주문·DB 쓰기 경로 영향 없음**: `route.ts`에 `src/lib/safety/`, `src/lib/exchanges/`,
  DB(`@/lib/db`) 관련 import가 전혀 없음 — 순수 M4 KB fetch + 알림만 수행. `cron-runner.sh` diff도
  `entry-watcher`/`holding-checker`/주문 관련 블록을 전혀 건드리지 않음(§⑤에서 hunk 위치로 확인).
  이 task는 뉴스 KB 갱신 전용이며 실제로 주문/DB 경로에 영향 없음을 확인.
- [17:03] **독립 빌드 재현**: Developer의 `~/.node-local/stockinvest-t036-build/`와 별개로
  `~/.node-local/stockinvest-t036-reviewer-build/`에 `git clone`(커밋 이력만) 후, 워킹트리
  미커밋 변경분 3개 파일(`scripts/cron-runner.sh`, `src/app/api/cron/news-fetch/route.ts`,
  `src/app/api/cron/news-fetch/__tests__/route.test.ts`)을 `cp`로 반영하고 `diff`로 원본과
  바이트 단위 일치 확인. `.env` 임시 복사 → `npm ci`(577 packages) → `npm run build` **성공**,
  라우트 매니페스트에 `ƒ /api/cron/news-fetch 354 B 102 kB` 정상 등록 확인. 빌드 후 `.env` 삭제
  완료. Developer 보고와 별개로 내가 직접 재현한 결과다.
- [17:03] **독립 테스트/typecheck 재현**: 같은 격리 클론에서 `npm test` 결과
  **126 suites / 2221 tests 전부 통과**(Developer 보고와 일치, 신규 `news-fetch` 11개 테스트
  포함 — 단독 실행으로도 11/11 통과 재확인). `npx tsc --noEmit` 에러 0건.
- [17:03] **종합 판정 근거**: 6개 확인 항목(①~⑦, 문서 지시 6개 + 실주문/DB 영향 1개) 전부
  통과, SAFETY_PATHS 두 경로 모두 대상 확인, 독립 빌드·테스트·typecheck 전부 재현 성공.
  Critical/High/Medium/Low 이슈 0건 — Developer가 별도 보고한 `call()` curl 타임아웃 부재는
  기존 결함(이 task 이전부터 존재, 하트비트 주석에도 이미 명시됨)이며 이번 변경으로 새로
  생긴 위험이 아니고 이번 task 범위 밖이므로 이 판정에 포함하지 않는다(Leader에게 별도
  Backlog 이관 필요 항목으로만 인지).
- [17:03] **최종 판정: PASS (scope: scripts/cron-runner.sh, src/app/api/cron/news-fetch/)**

## QA

- [17:09] Reviewer PASS 확인 후 착수. 지시받은 시나리오와 실제 실행 시나리오를 1:1 대응 표로
  남긴다(board.md의 과거 "지시보다 적게 실행하고 통과 처리" 이력 때문에 이 프로젝트는 표 없는
  판정을 무효로 취급).

  | # | 지시받은 시나리오 | 실제 실행 방법 | 결과 |
  |---|---|---|---|
  | 1 | 인증 실패 시 401 반환 + M4 미호출 | `route.ts:112-113` 코드 추적(`checkCronAuth` 조기 return) + `route.test.ts` "인증" describe 단독 실행(`npx jest src/app/api/cron/news-fetch`) | ✅ 401 반환, `fetchMock`/`alertMock` 0회 호출 확인 |
  | 2 | 정상 응답 시 200 + upserted 파싱 | `route.test.ts` "정상 응답" 2개 테스트 실행 + `route.ts:130,146` 코드 추적 | ✅ domestic/overseas 각각 `upserted` 값 정확히 매칭(12/7), 헤더(`X-Admin-Token`)·바디(`market`,`limit:20`) 형식도 확인 |
  | 3 | 시장별 실패 시 재시도 횟수 상한(최대 3회) | `route.ts:40 MAX_ATTEMPTS=3` 코드 추적 + `route.test.ts` "재시도" describe 실행(전량 실패 시 총 호출수 검증) | ✅ domestic+overseas 각 3회 = 총 6회 호출로 상한 고정 확인 |
  | 4 | 백오프 동작 | `route.ts:44 RETRY_BACKOFF_MS=3_000` 코드 추적 + `fetchMarketWithRetry`가 `attempt < MAX_ATTEMPTS`일 때만 `sleep(3000)` 호출하는 조건 확인 + fake timer로 실제 대기 없이 재시도 성공 테스트 통과 확인 | ✅ 시도 사이 고정 3s 대기, 마지막 시도 후에는 대기 없음(무한루프·과도지연 경로 없음) |
  | 5 | 전부 실패 시 알림(`sendAlertThrottled`) 발송 여부 | `route.test.ts` "전체 실패" describe 2개 테스트(500 응답 / AbortError 타임아웃) 실행 | ✅ 두 경우 다 `alertMock` 1회 호출 확인 |
  | 6 | 전부 실패 시 알림 레벨(critical) 확인 | 위 테스트의 `alertMock.mock.calls[0]` 인자 검증(`key='news-fetch:all_failed'`, `level='critical'`) | ✅ critical 확인 |
  | 7 | 부분 실패 시 알림 레벨(warning) 확인 | `route.test.ts` "부분 실패" describe 실행, `alertMock.mock.calls[0]` 검증(`key='news-fetch:partial_failed'`, `level='warning'`) | ✅ warning 확인, 성공한 시장(`domestic upserted:9`)은 정상 반영됨도 함께 확인 |
  | 8 | `cron-runner.sh`의 날짜파일이 실패 시나리오에서도 기록되는지(코드 추적) | `scripts/cron-runner.sh:169-172` 직접 Read — `call /api/cron/news-fetch "news-fetch"` 바로 다음 줄에 조건 없는 `echo "$TODAY" > "$NEWS_FETCH_LAST_RUN_FILE"` | ✅ 무조건 기록 확인(이전엔 `[ -n "$M4_BASE" ]` 등 성공 조건부였던 것이 완전히 사라짐) |
  | 9 | `export-llm-trainset`이 `bash` 경유로 실행되는지 | `scripts/cron-runner.sh:183` 직접 Read | ✅ `if bash "$PROJECT_DIR/scripts/export-llm-trainset.sh" ...` — 직접 실행 경로 없음 |
  | 10 | `export-llm-trainset` 날짜파일이 성공/실패 무관하게 기록되는지 | `scripts/cron-runner.sh:184-191` 직접 Read — `echo "$TODAY" > "$TRAINSET_LAST_RUN_FILE"`가 191행에서 `if/else` 블록 바깥 독립 줄로 위치 | ✅ 성공/실패 두 경로 모두 통과 후 무조건 실행됨을 라인 위치로 확인 |
  | 11 | T-037 하트비트 블록과 물리적 충돌 없음(`git diff`에 하트비트 hunk 없는지) | `git diff scripts/cron-runner.sh` 직접 실행 — hunk 헤더 4개(`@@ -10,6 +10,8`, `@@ -46,6 +48,16`, `@@ -56,11 +68,9`, `@@ -153,42 +163,32`) 전부 확인 | ✅ 하트비트 블록(현재 파일 78~98행, 헤더 주석 78~92행)을 포함하는 hunk 없음 — 4개 hunk 모두 헤더 주석/날짜파일 선언부 주석/M4 플럼빙 제거/news-fetch·export-llm-trainset 블록 교체 위치이며 하트비트 앞뒤로 분리 |
  | 12 | `bash -n scripts/cron-runner.sh`로 문법 확인 | 직접 실행 | ✅ "SYNTAX OK", 에러 없음 |
  | 13 | `npm test` 126 suites/2221 tests 전부 통과 직접 실행(Reviewer 보고 재신뢰 안 함) | 워킹트리에서 `npm test` 직접 실행 | ✅ `Test Suites: 126 passed, 126 total` / `Tests: 2221 passed, 2221 total` — 추가로 `news-fetch` 테스트만 단독 실행(`npx jest src/app/api/cron/news-fetch`)해 11/11 재확인 |
  | 14 | `~/.node-local/` 독립 격리 클론에서 `npm ci` + `npm run build` 재현 | `~/.node-local/stockinvest-t036-qa-build/`에 신규 `git clone` → 미커밋 3개 파일(`cron-runner.sh`, `route.ts`, `route.test.ts`)을 `cp`로 반영 후 `diff`로 원본과 바이트 단위 일치 확인 → `.env` 임시 복사 → `npm ci`(577 packages) → `npm run build` | ✅ 빌드 성공, 라우트 매니페스트에 `ƒ /api/cron/news-fetch 354 B 102 kB` 정상 등록. 빌드 후 같은 클론에서 `npm test`도 추가 실행해 126/2221 재확인(Developer·Reviewer와 독립적인 3번째 재현). `.env` 삭제 완료 |

  **지시받지 않았지만 QA 판단으로 추가 실행한 확인(결함 발견 목적)**:

  | # | 추가 확인 항목 | 실행 방법 | 결과 |
  |---|---|---|---|
  | 15 | 실주문·DB 쓰기 코드 접촉 여부(안전 제약 §6 재확인) | `grep -niE "lib/db|lib/safety|lib/exchanges|pool\.query|submitOrder" route.ts` | ✅ NONE FOUND — Reviewer의 ⑦ 판정과 별개로 QA가 직접 재확인 |
  | 16 | 제거된 `M4_BASE`/`M4_ADMIN` 변수의 잔존 참조(`set -u`이므로 남았으면 크래시) | `grep -n 'M4_BASE\|M4_ADMIN\b' scripts/cron-runner.sh` | ✅ NONE FOUND |

- [17:09] **발견된 결함: 0건.** Developer가 별도 보고한 `call()` 헬퍼의 curl 타임아웃 부재는
  이 task 이전부터 있던 기존 결함이며(하트비트 블록 주석 87행에도 이미 명시) 이번 변경으로
  새로 생긴 위험이 아니고 이번 task 범위 밖이라는 Reviewer 판정에 동의 — QA도 별도 결함으로
  집계하지 않는다(Leader의 Backlog 이관 대상으로만 인지).
- [17:09] **최종 판정: ✅ 검증 통과**

  실행 결과:
  - Reviewer 제공/지시 시나리오: 14개 지시, 14개 실행 (표 #1~14)
  - QA 자체 추가 확인: 2개 (표 #15~16, 안전 제약 재확인용)
  - `npm test` 직접 실행: 126 suites / 2221 tests 전부 통과 (신규 11개 포함, 워킹트리 기준)
  - 독립 격리 클론(`~/.node-local/stockinvest-t036-qa-build/`) `npm ci`+`npm run build`: 성공,
    Developer·Reviewer와 별개로 QA가 3번째로 독립 재현
  - 발견된 결함: 0건
  - 실주문/DB 쓰기 코드: 미접촉 확인(QA 자체 재확인)

  요구사항 충족 여부: ✅ 충족

## 최종 요약 (Leader 작성)

**이 작업은 사흘이 아니라 하루 안에 두 번 만들어졌다.** 원래 이 task는 오늘 오전 다른 세션이
구현 중이었는데, [[T-037-cron-outage-impact-and-watchdog]] 커밋(`a8dab3a`) 직후 `webhook-deploy`
배포 스크립트가 자동으로 `git reset --hard`+`git clean -fdx`를 실행하면서 **아직 커밋되지 않았던
이 task의 코드가 전부 삭제됐다.** 다행히 사고 직전 세션이 실제 diff 원문과 원인 분석을
`agent-vault/00-Context/ACTIVE.md`·`board.md`에 이미 커밋해 둔 덕에, 무엇을 왜 고쳐야 하는지는
전혀 잃지 않았다. 이 문서는 그 기록을 근거로 새 leader가 task 이력서를 다시 쓰고, Developer→
Reviewer→QA 전체 순환을 처음부터 다시 돌려 만든 결과물이다 — 설계를 새로 한 게 아니라, 검증됐던
내용을 그대로 복원했다.

**무엇을 고쳤는가**: 뉴스 KB 갱신(news-fetch) cron 잡이 다른 11개 잡과 달리 라우트를 거치지
않고 bash 안에서 직접 M4 API를 curl로 호출하고 있었고, 재시도·타임아웃·실패 알림이 전부
없었다. 게다가 이 잡과 LoRA 학습셋 추출(export-llm-trainset) 잡 둘 다 "성공했을 때만" 그날
시도했다는 날짜파일을 기록해서, 장애가 지속되면 그 시각 한 시간 내내 매분 재시도해 낭비 호출이
폭주했다(실측 누적 약 1만8,600건). 이번에 ①news-fetch를 다른 잡들과 같은 방식(`/api/cron/
news-fetch` 라우트, 시장별 최대 3회 재시도+타임아웃, 전부 실패 시 텔레그램류 알림)으로
이관하고 ②두 잡 모두 성공·실패와 무관하게 날짜파일을 무조건 기록해 하루 1회 시도로 끝나도록
바꿨다 ③export-llm-trainset을 직접 실행하던 것을 `bash` 경유로 고쳐, NFS `noexec` 마운트 때문에
"허가 거부"로 단 한 번도 성공한 적 없던 문제도 함께 해소했다.

**검증**: Developer 구현 → Reviewer 독립감사(PASS, scope: `scripts/cron-runner.sh`,
`src/app/api/cron/news-fetch/`) → QA 실행검증(✅ 검증 통과, 14개 지시 시나리오 전부 개별
실행+표 기록, 결함 0건) 순환이 결함 없이 완결됐다. 세 역할이 각자 별도의 `~/.node-local/`
격리 클론에서 독립적으로 `npm ci`+`npm run build`를 재현해, T-037 때 이 단계를 건너뛰어
실배포 중 빌드 실패가 났던 전례가 재발하지 않도록 했다. T-037이 새로 도입한 cron 하트비트
워치독 블록은 이번 변경과 물리적으로 분리된 위치에 있어 서로 건드리지 않았다.

**아직 남은 것**: 근본원인 자체 — home-m4-api(맥미니 M4)의 Redis에 컬렉션 메타가 없는데
Qdrant에는 실제 컬렉션이 있는 불일치 상태에서 `create_collection`이 Qdrant 409를 받고,
`kb.py:74`가 이를 `ValueError`가 아니라 `UnexpectedResponse`로 미포착해 500이 나던 문제 —
는 **이 저장소 밖(home-m4-api 프로젝트) 소관이라 이번에도 손대지 않았다.** 제안서만 board.md에
인계된 상태로 남아 있다. 또한 StockInvest의 `AI_API_KEY`가 M4에서 401(무효/비활성)로 RAG
검색 자체가 실패 중인 별건도 사용자 액션(M4에서 키 재발급) 대기로 그대로 남긴다. `call()`
헬퍼에 curl 타임아웃이 없는 기존 결함(이번 변경으로 새로 생긴 위험 아님)은 board.md Backlog에
이미 등록돼 있다(중복 등록 없음, 오늘 사고 이전부터 커밋돼 있던 항목).

git commit/push는 하지 않았다 — 워킹트리 변경만 남겼고, 커밋·배포는 사용자(상위 세션) 담당이다.

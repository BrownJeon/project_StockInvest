---
task_id: T-069
title: 보유 기준 정리(Phase 0-0a) + 보유 점검 리포트 v0 — 원가·입출금 원장·집중도·보유 정책 선택지
status: in-progress
priority: high
roles_involved: [leader, developer, analyst, reviewer, qa]
related_tasks: [T-064, T-066, T-067, T-068, T-070]
tags:
  - type/task
  - domain/strategy
  - domain/portfolio
aliases:
  - 보유기준정리
  - Phase0-0a
created: 2026-10-22
updated: 2026-10-22
waiting: [사용자 입력 — 입출금 이력(기준 원장)]
demo_gate:
  required: false
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: ""
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-069 — 보유 기준 정리 + 보유 점검 리포트 v0

> **수익 경로 연결(제1원칙)**: 지금 계좌 손익은 보유 5종목 집중(MU 약 63%·반도체 약 92%)이 좌우하고, 손익 측정은 틀린 숫자를 만든다(원가 없는 매도=전액 이익, 입출금 원장 없음, 스냅샷 오염). 보유 정책(T-064 D3)을 **숫자로 정하게** 하고, 이후 모든 손익 계산의 기준선(기준일 원가·입출금)을 고정한다. 신규 엔진보다 먼저 한다(T-064 §0-8, §13-4).

## 사용자 결정(2026-10-22, 근거 T-064 §14)
- **D3 = "표시·경고 + 선택지 보고서"**: 시스템은 팔지 않는다. 보고서에 보유 정책 2~3안과 안별 최악 손실 분포를 담아 사용자가 정한다.
- **D15 = Phase 0 전체 승인**(0-0a 선행). LLM 토큰 최소(분석가 자문 1회 외 없음).

## 판정(judge intake)
`judge-result@2`: feature · 복잡도 1.97 · risk R2(키워드 규칙 R2-kw-payment — 실제로는 읽기 전용 보고서라 쓰기 경로 없음) · developer opus · 데모 불필요(none) · needs_info=true 는 요약 길이 탓으로, 정보는 **T-064 §0·§2·§7·§9·§11** 로 충족(Leader 판단).

## 범위(읽기 전용 — 주문·DB 쓰기·화면 없음)
1. **스크립트** `scripts/profit-engine/holdings-report.mjs` (node, 운영 DB 는 `SET SESSION TRANSACTION READ ONLY` 세션 SELECT 만) → 마크다운 `agent-vault/10-Flow/reports/T-069-holdings-report-<YYYYMMDD>.md` (실제 보유 수치 포함 → 비공개 vault 에만 저장, 외부 전송 없음).
2. **리포트 내용(v0a, 일봉 불필요)**:
   - 기준일 **원가 스냅샷**: 보유 종목별 수량·평균단가를 USD/KRW 분리(`position_state.entry_price` 가 해외는 USD 평단×현재 환율로 매 틱 재환산되는 한계를 명시, 가능하면 스냅샷/원천 USD 평단 사용), 기준 시각·출처 표기.
   - 집중도(종목·업종·통화), 평가손익(USD 가격 기준과 환차 분리), 예상 손절가까지 거리(`risk_policy` v1), 현금 비중(정보).
   - **스냅샷 신뢰도**: 10-03~10-05 오염 구간(총액이 정상의 약 1/4, 37행)·USD 예수금 0↔$368.57 왕복 구간을 **탐지해 목록으로 출력**하고 손익·낙폭 계산에서 제외하는 규칙을 문서화.
   - **입출금 원장 양식**(날짜·방향·통화·금액·메모)과 스냅샷 총액의 급변 구간(입출금 의심) 목록 → 사용자에게 물을 질문 목록. 원장 값은 **사용자가 알려 준 것만** 기록(추정으로 채우지 않음).
   - 시그널 현황 요약 없음(T-070 담당).
3. **리포트 v0b(T-070 일봉 백필 뒤)**: 종목별 변동성(ATR 등)·최대 낙폭, **보유 정책 선택지 2~3안과 안별 최악 손실 분포**(예: 현상 유지·집중 상한 + 단계적 축소안·손절 규칙 부착안 — 각 안의 장단점과 숫자). 분석가(Fable) 읽기 전용 자문 1회로 선택지를 다듬는다. 자동 매도 없음, 사용자 결정 항목으로 끝낸다.

## 금지·안전
- DB 쓰기·DDL·주문·KIS 호출 없음(필요하면 Leader 와 상의 — 이 task 는 DB 스냅샷만 읽는다). 새 파일은 `scripts/profit-engine/`·`agent-vault/10-Flow/reports/` 아래만. SAFETY_PATHS 에 걸리지 않아야 한다.
- 비밀 값(.env)은 출력·로그에 남기지 않는다. 리포트의 계좌 절대금액은 비공개 vault 안에서만, 채팅 보고에는 비율 위주.
- 다른 세션 변경 파일 금지(AGENTS.md, .codex, api-usage·llm·notify·auth·exchanges 계열 등).

## 수용 기준
- 같은 입력에서 스크립트가 재현 가능한 결과를 내고(읽기 전용 증명: 세션 READ ONLY), 리포트의 수치가 `portfolio_snapshots`·`position_state`·`risk_policy` 와 대조된다(Reviewer 독립 재계산).
- 오염 구간 탐지가 알려진 구간(10-03~05)을 포함한다. 입출금 질문 목록이 사용자가 답할 수 있는 형태다.
- QA: 격리 사본 tsc/lint, 스크립트 dry 실행(운영 DB 읽기 전용), 쓰기 SQL 0건 grep.

## 관련 과거 이력 요약
- T-064(설계 v3 §0-8~10, §2 사실표, §7.3 괴리), T-066(리스크 정책: 손절 합 계산·평단 환율 시점 오차 L-1), T-067 감사 F02(원가 없는 매도=전액 이익). `/이슈기록 관련` 승인 교훈: 없음.

## 진행 기록
- [10-22 20:5x] 사용자 D3·D15·D2 결정으로 생성. judge intake 완료. Developer 착수 예정.

## Developer
- [20:52] 구현 완료(v0a). 새 파일 3개: `scripts/profit-engine/holdings-core.mjs`(순수 계산 — 원가·손익·집중도·손절(compute.ts 와 같은 공식 독립 재구현)·탐지 규칙 R1/R1b/R2/R3·기간 분해), `scripts/profit-engine/holdings-report.mjs`(CLI·읽기 전용 로더·마크다운), `scripts/profit-engine/holdings-report.test.mjs`(node:test 21건, 가짜 연결). `src/`·다른 세션 파일·T-070 파일·git index 변경 없음.
- [20:52] 읽기 전용 보증: 세션 `SET SESSION TRANSACTION READ ONLY` → `@@session.tx_read_only=1` 확인 실패 시 중단, 모든 SQL 은 `assertReadOnlySql`(SELECT 한 문장만·금지 키워드 거부) 통과 필수. `.query(` 호출 3곳 모두 가드 뒤. grep: 쓰기 동사는 가드 정규식과 JS `.replace/.update(해시)` 에만 등장, SQL 리터럴 10개 전부 SELECT/SET RO. KIS·fetch·텔레그램 호출 없음. 파일 쓰기는 리포트 1개(임시 파일→rename).
- [20:52] 운영 DB 읽기 전용 실행 → [[T-069-holdings-report-20261022]] (`agent-vault/10-Flow/reports/`, 스냅샷 id 5426 · 10-22 20:15, 입력 다이제스트 1073276e0daedc6b · 본문 해시 c9e9d9ce883cd0ee — `--no-write` 재실행에서 같은 해시 = 재현). 실행: `node scripts/profit-engine/holdings-report.mjs [--since 2026-08-01] [--as-of ...] [--no-write] [--json-summary]`, 시험: `node --test scripts/profit-engine/holdings-report.test.mjs`.
- [20:52] 결과 요지(비율): MU 64.4%·반도체 묶음 94.6%·5/5 평가손 합계 -22.6%·손절 합 3.86%(한도 2% 사용률 193%, 5/5 손절가 아래, 역산 상한 1.55%)·현금 0.4%(USD $368.54 쪽이면 2.8%). 탐지: R1 10-03 04:16~10-05 22:32 37행(기준선 대비 최저 27.8%, SMH·SNPS 매도 대금이 USD 예수금 미기록 시기라 총액에서 빠진 것으로 추정) · R1b 5건 6행(08-02~08-09, 한쪽 시장 잔고 누락/혼입) · R2 USD $0↔$368.54 4회 전환 27행(06~14시 KST 는 X, 그 밖은 $0) · R3 후보 10건(해외 매매 6·R2 4). 10-07→10-17 -18.3% = 시세 -16.8% + 미기록 USD 이동 -1.5%.
- [20:52] 수치 대조: 리포트 = 순수 SQL(JSON_TABLE+position_state 조인) = 실제 `compute.ts`(TS 트랜스파일 실행) — 손익률·손절가 아래 폭·손절 합 %·사용률·역산 손절폭·최대 비중 전부 일치. 시험에도 compute.ts 대조·defaults.ts 상수 드리프트 감지 포함. 입출금 원장은 비워 둠(추정 금지), 사용자 질문 11개는 리포트 §7.3.
- [20:52] 한계: 해외 USD 평균단가는 entry_price ÷ (position_state 갱신 시각에 가장 가까운 스냅샷 환율, 시차 25분)로 되돌린 값 [가능성 높음]; 매수 시점 환율 없음 → 환차손익 미계산; 섹터는 수기 분류; position_state 는 현재값뿐(--as-of 한계); v0b(보유 정책 선택지·손실 분포)는 T-070 일봉 백필 후. 리포트 파일은 실제 금액 포함 — 커밋·push 여부는 Leader 판단(push=배포 webhook).
- [21:15] Reviewer 보완 반영(M-1~M-3, L-1~L-6). M-1: 질문을 필수 7·8·9·11 / 선택 1~6·10 / 결정 12 로 묶어 표시, 질문 7 은 "오늘(리포트 기준일) KIS 앱의 실제 USD 예수금", 질문 11 은 "질문 7 답을 받은 뒤 기준 총자산 확정"으로 고침, 원장 방식은 결정 질문 12 로 분리, 4·6 선택지 대등 나열, 9 의 내부 ID 제거. M-2: frontmatter·머리말·§10 에 초 단위 기준 시각(20:15:19)·스냅샷 id, §10 에 `--as-of` 재현 명령과 position_state 등 현재값 한계 기재, 다이제스트에서 `asOf` 옵션 제외·fx_rates 는 대체 환율로 실제 쓴 경우만 포함, 생성 시각 의존 문구(오래됨 경고)는 생성 줄로 이동, 파일명 `T-069-holdings-report-<스냅샷일>-id<id>.md`. M-3: `system_config.exit_engine_enabled` 를 SELECT 로 읽어 "생성 시각 기준" 표시(현재 OFF), §1-8·R1b 원인에 [가능성 높음] 태그와 근거(체결 0·rejected 12·blocked 4·마지막 주문 08-12).
- [21:15] L-1 센트 정수성·시차(>60분)·fx_rates 현재값 대체 경고, L-2 가드에 LOAD_FILE·GET_LOCK·SLEEP 등 함수 추가·`guardedQuery` 분리, L-3 오류 출력은 코드만(자체 `ReportError(T069_*)` 만 고정 문구 병기), L-4 현재가=평단(시세 폴백 의심)·종목 집합 불일치 노트(R1b 창의 시간 기준 전환은 하지 않음 — 선택 항목), L-5 §7.2 제목 완화·§1-3 "가상 손실, 현재 노출 아님·1.55% 는 행동 지침 아님" 명시. 시험 32건(조회 수 고정·금지 SQL 미도달·R1 0.7/R2 2회/R3 1% 경계·스위치 해석·L-1/L-4 노트·질문 묶음·as-of 재현·오류 코드) 전부 통과, 고정값은 합성값으로 교체.
- [21:15] 재생성(읽기 전용): [[T-069-holdings-report-20261022-id5426]] — 입력 다이제스트 8b05b997d359afd7 · 본문 해시 3c02e4ead66c463f. 기본 실행·`--as-of "2026-10-22 20:15:19" --no-write`·디스크 파일 셋 다 같은 해시. 수치는 이전과 동일(MU 64.4%·반도체 94.6%·평가손 -22.6%·손절 합 3.86%/사용률 193%·5/5 아래), 기준 노트 0건. 이전 파일 `T-069-holdings-report-20261022.md`(untracked, 이전 질문 문구)는 삭제. SQL 리터럴 12개 전부 SELECT/SET RO, `.query(` 3곳 가드 뒤 재확인.

## Reviewer

- [21:08] 검토 범위: `scripts/profit-engine/holdings-core.mjs`·`holdings-report.mjs`·`holdings-report.test.mjs` 3개 + 생성 리포트 `agent-vault/10-Flow/reports/T-069-holdings-report-20261022.md`. 대조 기준으로 `src/lib/risk/compute.ts`·`defaults.ts`·`src/app/api/cron/portfolio-snapshot/route.ts`·`src/lib/exchanges/kis-overseas.ts`·`src/lib/strategy/position-state.ts`를 읽었다. 소스·리포트·DB는 수정하지 않았고, 운영 DB는 `SET SESSION TRANSACTION READ ONLY` 세션의 SELECT 만 썼다(임시 스크립트는 scratchpad 에서 만들고 삭제). 채팅·이 기록 모두 절대금액 없이 비율·건수만 쓴다.
- [21:08] 숫자 독립 재계산(스냅샷 id 5426, 리포트와 별개 코드·원시 SQL): 전 항목 일치. 비중 MU 64.43%·반도체 묶음 94.59%·미국 주식 비중 84.10%·USD 자산 83.76%(USD 예수금 대안 가정 84.15%)·현금 0.40%(대안 2.85%)·MU 대안 62.90%. 평가손익 합 -22.57%(종목별 -17.29·-8.71·-35.29·-53.28·-27.30). 손절 합/총자산 3.859%·한도 사용률 192.9%·역산 손절폭 1.55%·손절가 아래 5/5·취득원가/총자산 128.6%. 주식+현금=스냅샷 total(차이 0). R1 37행(id 5141~5177, 기준선 대비 최저 27.8%, 회복 id 5178), R1b 5건 6행(구성 변화 지점 16개 중 이 5건이 일시 이상, 나머지 6개는 실제 매매), R2 전환 4회(X 시각 06~14시, 0 시각 00~05·16·18·20·22시). 10-07~10-17 창 160행 -18.30% = 시세 -16.80% + 수량·현금 -1.50% + 잔차 0.00%. 전 스냅샷 단계의 항등식 잔차 최대 1원(2021행). 질문 근거 구간 6쌍(id 4530/4531·4890/4891·5140/5141·5177/5178·5238/5239·5277/5278)의 시각·보유 변화를 직접 대조해 모두 맞다.
- [21:08] 평균단가 USD 복원 검증: 3종목 모두 entry_price ÷ 1325.57 이 소수 2자리(센트)로 정확히 떨어진다 → 복원에 쓴 환율이 entry_price 에 곱해진 환율과 같다는 강한 근거 [확실, 이번 스냅샷 한정]. 엔진이 매 틱 upsert(`engine.ts:828`, `entry_price = VALUES(entry_price)`)하므로 `updated_at`=entry_price 값이 마지막으로 바뀐 시각이라는 해석도 맞다. 다만 "환율 시점 왜곡 0.00%p"는 환율이 10-22 00:08 이후 1325.57 로 고정이라 성립하는 이번 스냅샷의 값이지 일반 보증이 아니다(id 5411 의 환율은 1327.17, 약 0.12% 차이 선례).
- [21:08] 읽기 전용 보증: `.query(` 3곳(`holdings-report.mjs` 51·54·65행) 전부 바로 앞에서 `assertReadOnlySql` 통과, fs 쓰기는 `writeAtomic` 1곳(임시 파일→rename)뿐, 외부 호출·child_process·env 값 출력 없음(grep). 리포트 본문에 비밀·IP·URL·계좌번호 패턴 0건(정규식 스캔 7종). `--no-write` 재실행 → 입력 다이제스트 1073276e0daedc6b·본문 해시 c9e9d9ce883cd0ee 로 개발자 기록과 같고, 디스크의 리포트 파일 본문 해시도 같다(파일을 손으로 고친 흔적 없음). 시험 21/21 통과.
- [21:08] 변이 시험 17건(임시 사본, 저장소 무수정): 11건 적발(손절 공식·정책 상수·읽기 전용 플래그 확인·SET READ ONLY 제거·nearestFx 선택·손익 분모·--no-write 무시·heat 계산·역산 상한·R1b 창·locked 잔차), 생존 6건 중 2건은 동치 변이(`FOR UPDATE` 항목은 `UPDATE` 항목과 중복, `;` 검사는 DELETE 키워드 검사와 중복)라 시험 공백이 아니다. 실질 생존 4건은 L-2 에 적었다.
- [21:08] M-1 (MEDIUM) `holdings-report.mjs` 209행(질문 11): 기준일 권고가 "이 리포트의 기준 스냅샷 시각"인데 그 행(id 5426)은 리포트 자신이 R2 로 USD 예수금 불확실 표시한 행이다. 이 시각을 기준으로 고정하면 기준 총자산이 최대 약 2.4% 불확실한 채로 굳는다. 권고: 질문 7(실제 USD 잔액) 답을 받은 뒤 기준 총자산을 확정한다고 명시하거나, 기준 시각을 USD 값이 확인되는 시점으로 권고. 질문 11개를 사용자 부담 기준으로 필수(7·9·11)/선택(1~6·8·10)으로 나누는 것도 권고(역사 매매 질문 6개는 기준일 이후 원장에는 필요 없다).
- [21:08] M-2 (MEDIUM) 재현 경로: 리포트 §10 은 `--since` 만 인쇄하고 기준 시각은 분 단위(20:15)로만 적혀 있다. 실제로 `--as-of "2026-10-22 20:15"` 를 실행하면 id 5425 가 선택된다(기준 행 5426 은 20:15:19). `--as-of` 를 쓰면 같은 데이터여도 다이제스트가 달라진다(`asOf` 가 다이제스트에 들어감). 그리고 다음 스냅샷이 쌓이면 §10 의 명령은 다른 리포트를 낸다. 권고: frontmatter·§10 에 초 단위 ts 와 `--as-of` 포함 명령을 기재하고, position_state 는 현재값이라는 점을 같이 적는다.
- [21:08] M-3 (MEDIUM) 정적 단정 2건: §5 "자동 청산 엔진은 OFF(사용자 설정)"는 DB 를 읽지 않은 고정 문구다(지금은 `exit_engine_enabled=false` 라 사실 [확실]이지만 켜지면 거짓이 되고 잘못된 안심을 준다). §1 항목 8 "스냅샷의 수량 변화는 전부 앱 밖 거래다"는 orders 에 체결 0건(상태는 rejected 12·blocked 4, 마지막 주문 08-12)이라는 근거의 추론인데 확신 태그가 없고 T-064 는 [추측]으로 적었다. 권고: 스위치를 SELECT 로 읽어 출력하거나 "생성 시각 기준"을 명시, 항목 8 에 [가능성 높음].
- [21:08] M-4 (MEDIUM, 절차) `scripts/profit-engine/` 가 untracked 인데 같은 폴더에 다른 개발자의 `postmortem-core.js`(T-070)가 생겼다. 디렉토리 단위 add 를 하면 남의 미완성 파일이 섞인다 → 이 task 의 3개 파일만 경로를 명시해 add. 이 경로는 SAFETY_PATHS 에 없어 훅 검사 대상은 아니다(독립 감사를 훅이 강제하지 않으므로 이 기록이 유일한 감사 증거다). `.mjs` 는 tsconfig(allowJs false)에 포함되지 않아 빌드에 영향 없음.
- [21:08] L-1 (LOW) 평균단가 USD 복원에 무결성 검사가 없다: 복원값이 센트 단위로 떨어지는지, 시차(분)가 임계(예: 60분)를 넘는지 경고가 없다. 이번 스냅샷은 시차 25분·센트 정수로 통과하지만, 환율이 막 바뀐 직후나 `--as-of` 과거 실행(USD 행이 없던 시기에는 현재 fx_rates 로 대체)에서는 조용히 틀린 USD 손익이 나온다. 권고: 센트 정수성·시차 임계 경고 추가.
- [21:08] L-2 (LOW) 가드·시험의 한계: `assertReadOnlySql` 은 정적 SQL 의 방어선이지 샌드박스가 아니다. 직접 실행해 보니 `SELECT LOAD_FILE(..)`·`GET_LOCK`·`SLEEP`·`NEXTVAL` 은 통과한다(`LOAD_FILE` 은 `\bLOAD\b` 에 안 걸린다). 현재 SQL 은 전부 고정 리터럴+바인딩이라 악용 경로는 없고 실제 방벽은 `tx_read_only=1` 확인이다(MariaDB 10.11.11 에서 내 세션도 1 확인). 쓰기 거부 동작 자체는 금지 사항이라 실행해 보지 않았다. 시험 공백 4건: q() 안의 가드 호출 제거, R1 임계 0.7→0.5, R2 최소 전환 2→3, R3 최소 비율 1→50 이 모두 시험을 통과한다. 권고: `.query(` 호출 수 고정 시험과 금지 SQL 을 loadInputs 에 흘려 거부되는지 보는 시험, 임계 경계값 시험 추가. 보너스: 앱 운영 계정 대신 SELECT 전용 DB 계정을 쓰면 방벽이 하나 늘어난다(계정 권한은 SHOW GRANTS 가 금지라 확인 못 함).
- [21:08] L-3 (LOW) `holdings-report.mjs` 592행 오류 출력은 "접속 정보가 섞이지 않게 첫 줄만"이라 주석하지만 mysql2 첫 줄에 host:port 가 들어간다(ECONNREFUSED 첫 줄에 주소·포트가 찍히는 것을 직접 확인, 접근 거부 문구에는 계정@IP 가 들어가는 것이 일반적 [가능성 높음]). 비밀번호는 아니지만 주석과 다르다. 권고: 코드만 출력.
- [21:08] L-4 (LOW) 탐지 맹점: R1b 는 "6행 이내 같은 구성 복귀"(행 기준, 스냅샷 간격은 1~3시간으로 불규칙)라 20~30% 하락이 7행 이상 지속되면 R1(0.7 미만)도 R1b 도 못 잡는다. 현재 데이터에는 해당 사례가 없다(구성 변화 16지점 전수 대조). 또 스냅샷 크론은 시세 실패 시 평단 폴백(현재가=평단)으로 기록하므로 최신 행이 폴백이면 그 종목이 평가손익 0%로 조용히 표시된다(현재 최신 행은 해당 없음). position_state 와 스냅샷의 종목 집합 불일치도 무표시다. 권고: 현재가=평단이면 시세 폴백 의심 표시, 집합 불일치 노트, R1b 창을 시간 기준(예: 24시간)으로.
- [21:08] L-5 (LOW) 표현: (a) §6.4 "지수(USD현금 제외)" 열은 날짜별 마지막 스냅샷(저녁~밤=항상 $0 국면)만 써서 지수와 늘 같다 → 제외 규칙 2가 효과를 보여 주지 못한다. (b) §7.2 소제목 "입출금이 의심되는 구간"의 내용 대부분은 매매 대금의 현금 다리가 기록에 없는 것이지 입출금 단정이 아니다 → 제목 완화. (c) §1 항목 3 의 "손절폭 상한 1.55%"는 5/5가 이미 손절가 아래인 상태에서는 행동 지침이 될 수 없다(본문에 설명은 있음) — 사용자가 한도 초과 193%를 현재 노출로 읽을 위험.
- [21:08] L-6 (LOW) 시험 고정값(`holdings-report.test.mjs` 194행)에 실제 보유와 비슷한 값(MU 11주 등)이 있다. 워크스페이스가 데모에 실계좌 값을 금지한 선례(T-064 기록)가 있으므로 합성값 권고. 읽기가 한 트랜잭션 스냅샷이 아니라 쿼리별이다(최신 행→시리즈→position_state, 중간 갱신 시 섞일 수 있으나 확률 낮고 qtyMismatch 노트가 일부 탐지). `--out-dir` 에 경로 제한이 없고 같은 날 재실행하면 이전 리포트를 덮어쓴다(이력 소실).
- [21:08] 질문 목록 평가: 11개 모두 날짜 구간·종목·수량이 데이터와 맞고 사용자가 답할 수 있는 형태다(질문 7은 시간대까지 제시해 좋다). 개선점: 질문 7 은 "오늘 기준 실제 잔액"으로 시점을 못박을 것, 질문 4·6 은 "매도 대금으로 샀다"를 먼저 제시해 약하게 유도적이므로 선택지를 대등하게 나열, 질문 9 의 "T-064 §7.5" 같은 내부 ID 는 사용자 문구에서 제거, 원장 방식(수기 vs KIS 조회)은 질문 11 안의 권고 문구에 묻혀 있어 별도 선택 질문으로 분리. 핵심 누락은 없다(기준일은 질문 11, 환전 이력은 질문 10).
- [21:08] 말하지 않아야 할 것 점검: 추정으로 채운 입출금 없음(원장은 "(아직 없음)"), 근거 없는 환차손익 없음(미계산 명시), 확정적 매도 권고 없음(§8 에서 시스템은 팔지 않는다 명시). 확신 태그는 FX 가정 [가능성 높음]·R2 원인 [추측]·R1 원인 "(추정)"에 있다. 위 M-3 의 두 곳과 R1b "고장 유형 B 전형" 단정에는 태그가 없다.
- [21:08] 민감도 판단: 키·계좌번호·접속 정보는 리포트에 없다(스캔 0건). 그러나 정확한 보유 종목·수량·평단·총자산 구성·앱 밖 거래와 입출금 질문이 평문으로 들어 있고 `.gitignore` 에 걸리지 않으며(untracked, `git add agent-vault/` 하면 들어감) push 는 곧 배포 webhook 이다. 서비스 경로(public/·next.config)에 노출되는 설정은 없다 [가능성 높음, 배포 서버의 실제 제공 경로는 확인 못 함]. 막을 기술적 이유는 없지만 재생성이 가능한 산출물이라 커밋할 필요도 없다 → 사용자 결정 사항으로 올리고 기본은 "스크립트·task 문서만 커밋, 리포트는 로컬 유지(또는 gitignore)"를 권고.
- [21:08] 이 기록 외에 `20-Log/2026-10-22.md` 한 줄은 호출자 지시(task 문서 Reviewer 절만 쓰기)와 다른 세션이 동시에 덧붙이는 파일이라 쓰지 않았다. Leader 가 필요하면 추가한다.
- [21:08] **최종 판정: PASS (scope: scripts/profit-engine/holdings-core.mjs, scripts/profit-engine/holdings-report.mjs, scripts/profit-engine/holdings-report.test.mjs, agent-vault/10-Flow/reports/T-069-holdings-report-20261022.md)**

## QA

- [21:17] 1 문법·테스트: `node --check` holdings-core.mjs·holdings-report.mjs·holdings-report.test.mjs 3개 모두 OK. `node --test scripts/profit-engine/holdings-report.test.mjs` → tests 32 · pass 32 · fail 0 · skip 0 · todo 0 [확실, 직접 실행].
- [21:17] 2 읽기 전용 증명 [확실, grep·코드 확인]: `.query(` 호출 3곳(holdings-report.mjs 59·67·70행) 모두 바로 앞에서 `assertReadOnlySql` 통과(59행=guardedQuery, 67행 `SET SESSION TRANSACTION READ ONLY` 는 66행 가드, 70행 `SELECT @@session.tx_read_only` 는 69행 가드). SQL 리터럴 전부 `SELECT ...` 또는 `SET SESSION TRANSACTION READ ONLY`(SQL 리터럴 grep 결과 — SELECT 로 시작하는 문장 + SET_RO 1건만 존재). 쓰기 동사(INSERT/UPDATE/DELETE 등)는 가드 정규식 `FORBIDDEN` 과 JS 해시 `.update(` 에만 등장. `fetch`·`child_process`·KIS·텔레그램 import 0건. 외부 import 는 `node:` 내장과 동적 `mysql2/promise` 1건(DB 드라이버). `.env` 는 DB_* 5개만 읽고 값을 출력하는 경로 없음(코드 확인). PASS.
- [21:17] 3 재현성 [확실, 실행 결과]: `--no-write` 기본 실행 → 스냅샷 id 5426 · 입력 다이제스트 8b05b997d359afd7 · **본문 해시 3c02e4ead66c463f** · 읽기 전용 플래그 1. `--as-of "2026-10-22 20:15:19" --no-write` 도 동일(본문 해시 3c02e4ead66c463f). Developer 기록 해시와 일치. **결함 D-1 (LOW)**: 리포트 frontmatter·§10 에는 입력 다이제스트(8b05b997d359afd7)만 있고 본문 해시(3c02e4ead66c463f)는 없다 — §10 의 "같은 본문 해시가 나오면 재현" 문구를 독자가 대조할 수 없음. 해시 기재 권고.
- [21:17] 4 리포트 내용 검사: ① 비밀·IP·URL·계좌번호 정규식 스캔 0건 [확실]. ② 질문 체계 §7.3 = 필수 7·8·9·11 / 선택 1~6·10 / 결정 12 정상, 질문 본문에 내부 ID 없음. **결함 D-2 (LOW)**: 사용자 본문(분석 절)에 내부 ID 잔존 — §3 섹터 표 "T-064 §0 묶음"(84행), 문서 전반 "T-066"·"T-070" 인용. 질문 문구는 해당 없음. ③ 질문 4(5개)·6(6개) 선택지 나열, 대등 형식 확인 — 첫 선택지가 매도 대금이라는 순서 편향은 주관 판단이라 FAIL 근거로 쓰지 않음. ④ 질문 7 "오늘(2026-10-22) 기준 KIS 앱에 보이는 실제 외화(USD) 예수금" 시점 고정 확인. ⑤ 질문 11 "질문 7 답을 받은 뒤 기준 총자산 확정" 확인. ⑥ §5 "자동 청산 엔진 스위치(생성 시각 기준)" 확인. ⑦ §1-8 "[가능성 높음]", R1b 원인 "[가능성 높음 — …]" 확인. ⑧ 193% 는 §1-3 에서 "지금의 노출이 아니다"로 명시 확인. ⑨ §7 원장 "(아직 없음)", 추정값 입력 없음 확인. 결과: ①③④⑤⑥⑦⑧⑨ PASS, ② 는 질문 본문 PASS·분석 절 LOW(D-2).
- [21:17] 5 산출물 정합 [확실]: 이전 리포트 `reports/T-069-holdings-report-20261022.md` 없음(ls 확인). `agent-vault/10-Flow/reports/` 파일 1개(`T-069-holdings-report-20261022-id5426.md`, 28096B). `git status --porcelain` untracked 중 T-069 범위: `scripts/profit-engine/holdings-core.mjs`·`holdings-report.mjs`·`holdings-report.test.mjs` + 리포트 1개 + task 문서 `tasks/T-069-holdings-baseline-report.md`. T-070 범위(같은 폴더, 대상 아님): `postmortem-core.js`·`signal-postmortem.mjs`. `scripts/profit-engine/` 는 디렉토리 단위로 untracked 이므로 커밋 시 경로를 명시해야 T-070 파일이 섞이지 않는다(Reviewer M-4 와 같은 지적, 이번 QA 에서 재확인).
- [21:17] 6 쓰기 증거 0 [확실]: 실행 전 `git status --porcelain` 을 scratchpad 에 저장 → 실행 후 저장본과 `diff` 동일. 리포트 파일 sha256 `23c97dafb0409343db7215100ae88b16757a90fa2cf7246db21bec97b9f716d0` 실행 전·후 동일. `--no-write` 만 사용, 리포트 mtime 변동 없음(21:14).
- [21:17] 결함 요약: Critical 0 · High 0 · Medium 0 · **LOW 2**(D-1 본문 해시 미기재, D-2 분석 절 내부 ID). 둘 다 수치·안전 동작에는 영향 없음.
- [21:17] 확인하지 못한 것: 리포트 수치의 DB 원시값 독립 재계산은 Reviewer 기록(id 5426 대조 PASS)을 인용만 하고 QA 에서 재계산하지 않음. 시험 32건의 개별 케이스 내용은 읽지 않고 pass 결과만 확인. 운영 DB 외 환경 없음(쓰기 실행 금지 원칙상 실제 쓰기 경로는 검증 안 함 — 코드 grep 으로만 확인).
- [21:17] **QA 판정: PASS** — 읽기 전용·재현·산출물 검사 통과, 결함 LOW 2건(D-1 해시 문서 누락, D-2 분석 절 내부 ID). LOW 는 리포트 수정 후 Leader 판단으로 처리.

## Leader 기록
- [2026-10-23 07:4x] **사용자 답변 수령(질문 7·9·11·D18)**: ① 질문 7 — KIS 앱에서 확인한 달러 예수금 **$118.60**. ⚠ 시스템 최신 스냅샷(#5434, 07:13)의 USD 행은 ≈$1,918.6 이라 **차이 정확히 $1,800.00** → 주문 증거금 또는 항목 차이 가능성, **어느 KIS 항목인지·미체결/예약 주문 여부를 사용자에게 재확인 중**(기준 총자산 확정 보류). ② 질문 9 — 2026-10-22 에 원화 200만원 입금 후 달러로 환전(환전 금액·환율·시각은 미확인; 스냅샷 원화 현금은 22:59 의 2,080,138원 → 02:34 이후 23,226원). ③ 질문 11 — 손익 **기준일 = 오늘 2026-10-23**(권고 10-22 에서 변경; 10-22 입금은 기준일 이전이라 기준 총자산에 포함). ④ D18 — 앱 안 입력 화면 → [[T-074-cash-flow-ledger]]. 질문 8(8월 이후 목록 밖 입출금)은 답변 없음 = 미확인(기준일 이전이라 기준 계산에는 영향 없음). 선택 질문 1~6·10 은 기준일 이후 원장에 필요 없어 생략.

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-22 20:33 |

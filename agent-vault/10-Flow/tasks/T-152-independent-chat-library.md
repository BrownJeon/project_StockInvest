---
task_id: T-152
title: 독자 챗봇 공통 라이브러리 합성 데이터 시범
status: review
project: StockInvest
created: 2026-11-04
updated: 2026-11-06
execution_context:
  schema_version: 1
  origin_tool: unknown
  current_tool: claude
  current_procedure: claude_standard
  current_scope: "재개 — 격리 패키지가 루트 빌드 설정에서 깨지지 않는지 확인하고 남은 후속의 선행 조건 정리. 커밋·push·실제 /ai 연결·배포 제외"
  last_event_id: exec-002
base_ref: b3ee7c7d7e688c6f8f3df72ad80dcfe7e202a97a
risk_level: R2
roles_involved: [leader, judge, designer, developer, reviewer, qa]
related_tasks: [T-108]
tags: [type/task, domain/adoption, domain/ui]
aliases: [ADP-010-C01]
---

# T-152 독자 챗봇 라이브러리 격리 시범

- 목표: 사용자 검토한 ADP-010-C01 v4 기준 공통 React 챗봇 UI 라이브러리와 합성 데이터 시범을 구현·검증한다.
- 현재 지시: 상세 설계 검토 완료 후 구현. v4 발화는 상위 `../../../../adoption/ADP-010-assistant-ui/32-상세설계-v1.md`에 기록. 기존 챗봇 기능을 보존한다.
- 경계: `packages/chat-ui/` 격리 패키지. 기존 `/ai`·API·DB·인증·메뉴·거래 코드·운영 설정을 변경하지 않는다. T-113 대화 소유권 및 실제 데이터 연결 검증 전 실제 이력 연결·비서 탭 공개 금지. 실제 LLM·계정·DB·주문 호출 없음. 기존 병행 변경 보존. push=배포이므로 무단 push 금지.
- 관련 과거 이력: T-108의 비서 탭은 T-113 후 노출. ADP-010 분석·상세 설계·Claude C1: `../../../../adoption/ADP-010-assistant-ui/` 참고. 이슈 교훈 조회 `챗봇 라이브러리`: 관련 승인 교훈 없음.
- 단계 구분: 현 작업은 합성 데이터 시범이다. 실제 기존 화면 교체·소유권 검증·정식 데모 게이트는 후속 범위이며 현재 완료로 간주하지 않는다.

## 실행 도구·절차 이력

| 이벤트 ID | 시각(KST) | 사건 | 이전 → 현재 담당 / 현재 절차 | 범위·인계 대상·남은 일 | 근거 |
|---|---|---|---|---|---|
| exec-001 | 2026-11-06 22:24 기록 | metadata_corrected | unknown → unknown / unknown | 2026-11-04 작성분의 최초 시작 도구 미확인. 본문 「Claude 검토」 절(외부 검토 runner)은 정황일 뿐 시작 근거가 아니어서 문체·절 이름으로 단정하지 않음 | 규약 `docs/task-tool-context.md` §5 |
| exec-002 | 2026-11-06 22:24 | resume | unknown → claude / claude_standard | 남은 일 중 T-113 과 무관한 확인(루트 빌드 설정 호환성)만 수행. 커밋·push·실제 연결·데모 게이트는 사용자 결정 대기 | 사용자 지시 「T-152 작업문서 읽고 작업 이어서 진행해줘」(Claude Code 데스크톱 세션) |

## 판단 기록 (judge)

- intake `judge-result@2`: R2 (auth 키워드), needs_info=true, next=ask_user, demo=delta, complexity=1.99. 승인된 상세 설계·v4와 사용자의 현재 구현 지시에 시범 범위가 구체적으로 적혀 있어 추가 입력이 없다고 Leader가 판단: `override: user_scope_explicit`. R2는 보수적으로 유지한다. 변경 대상은 실제 인증·인가가 아닌 새 합성 패키지이며 이를 검증한다.
- 독립 합성 시범과 실제 사용자 화면의 게이트를 구분한다. 정식 StockInvest task/receipt에 v4는 연결되지 않았고 정식 승인 상태 미확인. 사용자의 v4 승인 발언은 상세 설계에 기록되어 있다. 앱 UI 구현에는 별도 정식 게이트 절차가 적용된다.

## Leader

- 패키지는 동일 Git 스냅샷의 StockInvest 내부 경계를 우선 사용. 외부 `shared/` 경로의 배포 포함·롤백은 미검증이므로 사용하지 않는다. 시범 패키지의 실제 앱 빌드 포함은 별도 검증 전 보장하지 않는다.

## Designer

- v4 구현 가이드: `../../../../adoption/ADP-010-assistant-ui/33-v4-구현가이드.md`. 사용자 승인 v4의 뇌·번개 토글, 제목 모델 선택 및 공통·주식 전용 경계를 반영한다.

## Developer

- `packages/chat-ui/` 독자 React 공통 UI 및 합성 전용 예제 구현. 기존 API 호출이나 실제 데이터 접근 없음. TypeScript 검사 성공은 개발 단계 결과이며 최종 격리 타입검사와 구분한다.

## Reviewer

- 독립 감사 PASS: 대화별 스크롤, 메시지 처리 비용, 발화자 라벨, React peer 범위, 모의 목록·삭제 및 초점 복구 등 개선 후 재검토. QA가 발견한 삭제 확인 Escape·포커스와 모드 아이콘 색상·전송 버튼 선택자 충돌도 수정 후 재순환 정적 PASS. 범위 `packages/chat-ui/**`의 정적 감사이며 실제 API·인가·배포 제외.

## Claude 검토

- C1 공식 runner gate-only `claude-result@1`: `skipped / checkpoint_not_selected` (R2, design_uncertain=false, user_requested=false). 파일 0개, Claude 호출·전송 0. 이는 외부 설계 검토를 수행했다는 뜻이 아니다. ADP-010 공통 설계의 과거 Claude 검토는 이 코드에 대한 검토가 아니다. C2 공식 runner gate-only 점검과 QA 수정 후 재점검은 각각 `incomplete / bad_file_list` (파일 목록 비움, attempt=null)로 끝났다. Runner가 파일 검증 단계에 진입한 근거로 개입 선택 가능성을 추론하지만 gate-result JSON은 별도 확인되지 않았다. 현재 패키지는 미커밋이므로 정식 HEAD 파일 범위를 만들 수 없어 우회 전송하지 않았고 Claude C2 실제 검토·전송은 없다. 미검토: 신규 패키지와 시험 전체.

## QA

- [2026-11-04] **INCOMPLETE — 최종 Jest·타입검사 미실행.** 이전 Developer NFS Jest 2회 exit 130은 지연으로 중단되어 미완료다. 재검토 PASS 이후 패키지 11개 원본·Ubuntu `/tmp/stockinvest-t152-qa.ilTNjMQ9` 복사본 SHA-256 일치; 파일별 SHA 정규화 매니페스트 SHA-256 `9e1f703fdcc596f7046c4c43e2e4635be90fa5c83ed536ae66e213e2f5bd1af3`. QA 후 원본 11개 해시는 동일하게 유지됐다. 저장소의 다른 변경은 건드리지 않았다.
- Ubuntu Node 24.22.2 격리 경로에서 `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp TZ=Asia/Seoul flock -w 90 /tmp/stockinvest-heavy-tests.lock nice -n 10 node ./node_modules/jest/bin/jest.js --config packages/chat-ui/jest.config.cjs --runInBand --no-cache`는 다른 작업이 보유한 공용 락을 90초 기다린 뒤 exit 1로 종료했다. 잠금 미획득이라 Jest 프로세스·시험 0건 실행이며 테스트 실패가 아니다. 이어 `flock -w 10 /tmp/stockinvest-heavy-tests.lock nice -n 10 node ./node_modules/typescript/bin/tsc -p packages/chat-ui/tsconfig.json`도 잠금 미획득으로 미실행. 락 보유자는 중단하지 않았다. 앞선 구버전 대기 SSH 중단 후 남은 본인 소유 고아 flock PID 2551418만 명령 확인 후 종료했다.
- 브라우저 fixture: 같은 Ubuntu 복사본 TSX를 기존 로컬 SWC·React 18.3.1으로 임시 변환하고 CSP `connect-src none`, 로컬 전용 HTTP·SSH 터널을 사용. Chrome CUA에서 412×860 / 390×844 / 360×780 CSS px 관찰, 세 폭 모두 document scrollWidth=viewport width. 412px에서는 수정 후 검토 뇌 버튼 어두운 배경·직진 번개 상태·전송 버튼 주황/검정, 대화 목록 로드, 검토 초안·취소 시 입력 및 포커스 복귀를 관찰했다. 삭제 확인 중 Escape와 취소가 각각 목록을 유지하고 해당 삭제 버튼으로 포커스를 돌렸다. 이전 스냅샷에서는 검토 버튼 주황색 및 Escape가 목록 전체를 닫는 결함을 발견했으나, 수정 후 위 합성 흐름에서 재현되지 않았다.
- 이전 스냅샷에서 정제 편집·종목 제외·확정, 모델 선택·직진 모의 응답 및 대화 변경 후 지연 응답 미표시도 실행했으나 수정본 전체의 동일 회귀 통과 증거로 대체하지 않는다. 최종 브라우저 console 경고·실제 기기·모든 UI 상태·완전한 v4 픽셀 비교, 로그인·실제 API/DB·실매매·운영/배포 및 npm ci/Next 빌드·패키지 재현성은 미검증. 브라우저 버전·기기 배율·locale·시간대·글꼴 및 애니메이션 조건을 고정하지 않았으므로 데모 게이트 시각 검증 PASS로 주장하지 않는다. 스크린샷을 별도 파일로 저장하지 않았다.
- 집중 검증 이후 Reviewer의 두 결함 수정에 대한 실행 관찰은 통과했으나 Jest·타입검사 및 전체 체크리스트가 남아 있어 **QA PASS/Deployer 인계 없음**. 공용 락을 사용하지 않는 우회·외부 서비스·실제 데이터 호출은 하지 않았다.

- [2026-11-04 21:xx] **후속 재개 — 격리 시범 범위 조건부 PASS.** 사용자 질문에 대한 읽기 전용 조사에서 공용 락이 비어 있음을 확인한 뒤 승인된 QA를 재개했다. 최신 원본 11파일 및 Ubuntu 격리 복사본은 이전 `9e1f703fdcc596f7046c4c43e2e4635be90fa5c83ed536ae66e213e2f5bd1af3` 매니페스트와 일치했고, 실행 후에도 원본 11파일 동일했다.
- Ubuntu Node 24.22.2, 격리 `/tmp/stockinvest-t152-qa.ilTNjMQ9`에서 `flock -w 90 /tmp/stockinvest-heavy-tests.lock nice -n 10 node ./node_modules/jest/bin/jest.js --config packages/chat-ui/jest.config.cjs --runInBand --no-cache`: **1 suite, 5/5 PASS**. 같은 공용 락으로 `nice -n 10 node ./node_modules/typescript/bin/tsc -p packages/chat-ui/tsconfig.json`: **exit 0**. 기존 로컬 node_modules 재사용이며 npm ci/릴리스 빌드는 아니다. 이전 NFS exit 130 및 잠금 대기 미실행 기록은 그대로 유효하다.
- 동일 해시 복사본을 오프라인 React 18.3.1·SWC 임시 fixture로 실행, Chrome 412×860에서 수정한 정제 질문·가짜 종목 제외의 모의 결과 유지, 제목 모델 Sonnet 및 직진 모의 응답, 진행 중 새 대화 후 지연 결과 미표시 확인. 긴 합성 대화에서 상단 scrollTop 0 상태로 새 응답 후 위치 0 유지, `새 메시지 보기` 클릭 시 bottom scrollTop 656 확인. 직전 QA의 동일 해시에서 수정된 삭제 확인 Escape/취소 시 목록 유지·삭제 버튼 포커스와 360/390/412px overflow 0도 확인했다. 수정본 fixture 콘솔 error/warn 0. CSP `connect-src none`, 실제 계정·LLM·API·DB·주문은 호출하지 않았다.
- 범위 한계: 인증·인가, T-113, 기존 실제 챗봇 통합 및 회귀, 실제 서버·로그인·DB, 모바일 실기기, npm ci·Next 빌드·배포/롤백, 정식 demo_gate 및 v4 픽셀 동등성은 미검증. 브라우저 버전·DPR·locale·글꼴·애니메이션을 고정하지 않았으므로 정식 화면 승인 검증 PASS는 아니다. 독립 합성 범위의 결과만 PASS로 보고, 운영·배포 인계는 하지 않는다. 임시 스크린샷 파일 생성 0, viewport 복원 및 검증용 서버 종료.

## 재개 확인 (2026-11-06, 메인 세션 — 역할 호출 없음)

- 이 절은 메인 세션이 직접 한 확인이다. Reviewer·QA 를 다시 부르지 않았으므로 독립 감사·QA 결과로 세지 않는다.
- 패키지 파일 11개의 수정 시각은 전부 2026-11-04 19:03 이전 — 21:xx 후속 QA 이후 변경 흔적 없음(해시 매니페스트 형식이 달라 QA 값 `9e1f703f…`와 직접 대조하지는 못했다).
- **발견 — 루트 빌드가 이 패키지를 읽는다**: 루트 `tsconfig.json` 의 `include` 가 `**/*.ts`·`**/*.tsx` 라 `packages/chat-ui/src/**`·`example/**` 가 운영 `next build` 타입검사 범위에 들어간다(`__tests__` 는 루트 `exclude` 로 빠진다). 따라서 이 패키지를 커밋해 push 하면 **연결하지 않아도 운영 빌드에 영향을 줄 수 있다.** 루트 Jest `roots` 는 `src` 뿐이라 패키지 시험 5건은 **프로젝트 회귀망에 들어가지 않는다.**
- **확인 — 루트 컴파일러 설정으로 패키지만 타입검사**: 루트 `tsconfig.json` 을 extends 한 임시 설정(세션 scratchpad, 저장소 밖)으로 대상 4파일(`src/ChatView.tsx`·`src/index.ts`·`example/StockChatExample.tsx`·`example/index.ts`)+`next-env.d.ts` 를 Mac Node 22.22.0·TypeScript 5.5.3 `tsc --noEmit` → **exit 0**(NFS, 약 2분 20초). 
- 미검증: 프로젝트 전체 `tsc`·`next build`·`npm ci`(전체 트리 타입검사는 NFS 지연 이력 때문에 실행하지 않음 — 다른 미커밋 변경 62건이 섞여 있어 이 패키지만의 결과로 읽을 수도 없다), Next `next` 플러그인 적용 상태, 우분투 릴리스 빌드.

## 선행 조건 변화 (2026-11-06 23:19)

- [[T-113-chat-ownership-authorization]] 이 운영에 반영됐다(릴리스 `20261106-231601-c33e4678`, 기존 대화 13건 귀속). 실제 연결의 남은 선행 조건은 사용자 화면 확인, 정식 데모 게이트, 그리고 T-113 「사용자 결정과 T-152 후속 영향 점검」 절의 보완 6항목(401/404/503 처리·`conversationKey`·LLM 대기 중 삭제·직진 모드·배포 순서·루트 tsconfig)이다.

## 최종 요약

- 상태: 독자 공통 UI와 합성 StockInvest 시범 구현. Reviewer 정적 감사 PASS, 합성 시범 QA 범위 한정 조건부 PASS. 실제 기존 `/ai` 연동과 메뉴는 하지 않았다.
- 배포: 커밋·push·배포 없음.
- 검증: 최종 일치 해시 11개 파일로 Ubuntu 격리 Jest 1 suite 5/5 및 타입검사 exit 0, Chrome 합성 fixture의 모드·정제·종목·대화 전환·스크롤 등 확인. 상세 환경과 미검증은 QA 절 참조.
- Claude C2는 정식 파일 범위 미충족으로 `incomplete`, 실제 코드 검토 없음.
- 남은 일: 실제 연결 전 T-113 소유권/서버 인가, 정식 데모 게이트 상태, 앱 연동 회귀 및 배포 패키지·롤백 재현성 확인. 사용자용 라이브 UI/API·실기기·npm ci/Next 빌드·운영 배포는 미검증.
- 관련 위험: `packages/chat-ui`는 소스 기반 패키지이며 실제 프로젝트 소비·빌드·릴리스 경로는 검증되지 않았다. 다른 작업의 변경을 보존했다.

# StockInvest 챗봇 연동 — Claude 인수인계

> **2026-11-06 보관 안내** — T-113 운영 이관은 이 문서의 다중 사용자 전제 절차(접근 차단·drain 등)가 아니라 **단일 사용자 대안 순서**(재측정 → 암호화 백업·격리 복원 → DDL → 배포 → 가드 백필)로 완료됐다(릴리스 `20261106-231601-c33e4678`, 근거 `agent-vault/10-Flow/tasks/T-113-chat-ownership-authorization.md` 「운영 이관 실행」·「운영 이관 완료」). 이 문서와 관련 도구는 그 이관에 쓰이지 않았으며 다중 사용자 상황 대비 보관용이다. 재사용 전 현재 스키마(`user_id` 이미 존재)·사용자 수 기준으로 재검토할 것.

- 작성: Codex, 2026-11-05 (Asia/Seoul). 상태: **인계문 준비 완료 · Claude 전달·수신 미확인 · 최종 검증 전**.
- 프로젝트: `/Volumes/homes/brownjeon/project/StockInvest` · 시작 도구: Codex.
- 주 작업: T-113 챗봇 소유권·서버 인가 및 운영 이관 준비. 후속: T-152 공통 챗봇 라이브러리의 StockInvest 실제 연결과 T-108 메뉴 노출.
- 이 문서는 인수와 실행 준비 자료다. Claude의 실제 수신·검증·배포 증거가 아니다. 읽기 전용 외부검토 브로커를 Claude Code의 구현·운영 실행 세션으로 대체하지 않는다.

## 1. 사용자 목표와 이미 받은 결정

기존 StockInvest 챗봇 업무 기능과 이력을 유지하면서, 사용자가 승인한 v4 화면을 기준으로 assistant-ui 패키지를 직접 사용하지 않는 자체 공통 라이브러리를 만들고 StockInvest에 실제 연동한다. 챗봇 기능은 기존에 있으나 메뉴 화면에 추가되어 있지 않다. T-113의 기존 이력 소유권·서버 인가는 실제 연결의 선행 작업이다. 관련 상세 및 승인된 데모는 T-152 작업 기록과 도입 건 ADP-010을 확인한다. 이미 받은 화면 승인을 다시 요구하지 않는다.

사용자 원문: **“현재 계정이 기존 대화의 소유자이고 삭제된 이전 계정이 없습니다.”** 이 확인은 기존 대화 13건이 확인 시점의 현재 계정에 속한다는 사용자 판단이다. 다시 같은 질문을 하지 않는다. 실제 대상 사용자 ID와 현재 대상 집합은 실행 직전 비공개로 대조한다.

사용자 원문: **“그럼 남은 접근 차단과 진행 중인 요청 정리, 운영 백업의 격리 복원 및 운영 환경 검증을 진행해줘. 운영 DB에 변경을 적용하기 전에는 결과를 보고해줘.”** 접근 차단·요청 정리·실백업의 격리 복원 및 운영 환경 확인은 승인된 작업이다. 기술적 권한·안전한 실행 방법을 확보해 수행하되, 같은 승인을 반복 요구하지 않는다. **운영 DB 변경 전 결과 보고**라는 명시적 중단점을 지킨다. 별도 운영 DDL·백필·배포의 승인을 이미 받았다고 추정하지 않는다. 실제 필요한 새 판단·권한만 근거와 대안을 제시해 묻는다.

## 2. 현재 상태와 알려진 장애

2026-11-04 읽기 전용 조사 당시의 관찰이며 현재 상태가 아닐 수 있다. 아래 수치를 실제 실행 전 재확인한다.

- 운영 MariaDB 10.11.11, 사용자 1명·대화 13건·메시지 32건, 대상 테이블 InnoDB, `chat_threads.user_id` 부재. 현재 앱 DB 연결의 `Ssl_cipher`는 빈 값이고 `have_ssl=DISABLED`였다. 특정 연결의 관찰과 네트워크 전체의 보안 상태를 혼동하지 않는다.
- 운영 웹은 `0.0.0.0:3003`에 수신했고 Mac에서 LAN 주소로 TCP 연결되었다. HTTP 요청은 보내지 않았다. nginx 차단만으로 이 직접 경로를 막았다고 판단할 수 없다. 당시 nginx 설정 쓰기·비대화 sudo·실효 방화벽 조회는 권한 부족으로 실패했다.
- 웹과 cron은 같은 앱 포트를 사용하는 구성이다. 웹 자식 프로세스 0건의 순간 관찰은 메모리 큐·원격 LLM 요청·후속 DB 쓰기 종료 증거가 아니다. 다른 Claude 프로세스를 챗봇 소유로 추정하거나 일괄 종료하지 않는다. 매매·알림과 병행 작업을 보호한다.
- NAS/DB 호스트에 기존 확인된 계정·키로 SSH 비대화 인증은 거부되었다. 이 때문에 안전한 실데이터 전송/호스트 내부 실행 경로를 확보하지 못했다. 사용자에게 nginx·방화벽 관리자 접속과 NAS 로컬 접근 또는 암호화 터널 방법을 요청했으나 **이 문서 작성 시 응답은 확인되지 않았다**. 비밀번호·키 원문을 대화에 요청하거나 출력하지 않는다.
- **실제 접근 차단, 진행 요청 정리, 운영 데이터 백업·복원은 수행하지 않았다.** 운영 DB 변경·배포·서비스 정지/재시작도 하지 않았다. 운영 이관 가능 판정이 아니다.
- 관찰된 운영 릴리스는 `20261104-180613-a6b7605f`, 당시 작업 기준 HEAD는 `41cc3c0e9661d5b5bb00f002cb5bef07111042be`. 현재 checkout·원격·실행 릴리스와 병행 변경은 다시 확인한다. Git push는 webhook 배포를 촉발할 수 있다.

## 3. 인수할 파일과 버전

아래 경로는 모두 StockInvest 저장소 기준이다. 2026-11-05 인계 작성 시 HEAD는 `41cc3c0e9661d5b5bb00f002cb5bef07111042be`이고, 관련 변경은 **미커밋**이다. 아래 표는 선택 파일의 SHA-256이며 commit에 포함됐다는 뜻이 아니다. Claude는 읽기 전 현재 해시·상태를 비교하고 차이가 있으면 변경 주체와 내용을 확인한다. task 기록은 인계 후 새로 갱신될 수 있으므로 불일치가 자동으로 덮어쓰기 권한을 주지 않는다.

| 파일 | SHA-256 |
|---|---|
| `agent-vault/10-Flow/tasks/T-113-chat-ownership-authorization.md` | `d451c7fc13c73c2c8c6c1a9203445f5825e412dcaca2ebd4c4c9adc5fda37d3a` |
| `agent-vault/10-Flow/tasks/T-152-independent-chat-library.md` | `d5917ee83e6572dafa241045f61d73435f4ae896f0119fe8183e85b673de5222` |
| `docs/design/T-113-chat-ownership-migration.md` | `d81c69f803b1a13c5ebed52d9e3cb803eaaa1b43f7c6c2d39c86a8f11856aecc` |
| `docs/design/T-113-cutover-access-drain.md` | `a67ccc8b120c9796574b5a703a546595869b6c7ddc8b0c20afe9bf1e57aaf70f` |
| `docs/design/T-113-backup-restore.md` | `c6d09f0a12404d161ebc39be8ff590e66a1c0fb7fc80461fd0cd63188e722c6f` |
| `docs/design/T-113-backfill-execution.md` | `1973aa24784b4e46eeadd15520b37d7287f291283f4620afcfea91c323d0e5d8` |
| `scripts/migrations/T-113-chat-ownership-operator.mjs` | `2fddbf2a159a401158f6637045e0077eeed0f171b4ed385fb5a2335d74024c8d` |
| `scripts/migrations/T-113-chat-ownership.sql` | `8c55d9208674c0b01242fb04a749ca67577dc98874b3f3879392808f8cdba998` |
| `scripts/migrations/T-113-chat-ownership-backfill.mjs` | `649792e01e9dfc73ea56611b87cce6e7ad57c4efe3e720eafa7acf323e6a4fac` |
| `scripts/migrations/T-113-operator.test.mjs` | `80f722b161baec49ba901fb9898d6d453654674ec1133e553b3a6d85e56016c7` |
| `src/lib/chat/ownership.ts` | `1d7338ba4e13fabb98ca460059e7c6eb459113026151bec1fcfed6b196a78805` |
| `src/lib/db.ts` | `a329d294fd0644b0cf7e22b310199631d83300a420f8d3e885f4ce23d9bd1d33` |
| `src/app/api/chat/models/route.ts` | `a897fbbb3a3393263899357ca53ded27cf4ce261df470c64536bc7a2807ba79e` |
| `src/app/api/chat/threads/route.ts` | `7aa3ca8e7715c0560bfc1f0bd360fb2ba4e6567ff340293231e6e2e84e4fbd38` |
| `src/app/api/chat/threads/[id]/route.ts` | `c2d4c244606a40c2a97eab200a45bbf1bd3bff136202fa834e57fdb534620c42` |
| `src/app/api/chat/threads/[id]/draft/route.ts` | `dbed5a3f60b0ffc73aa20caaf4bc95ebb076b7561d0193a91f5869bdd75c5389` |
| `src/app/api/chat/threads/[id]/messages/route.ts` | `16f5bf8340d6c91661c6071447b3090301ba04613c02685987b331268238171b` |
| `src/lib/chat/__tests__/t113-ownership-routes.test.ts` | `a3e2abcd0106109b4f7db84288617a40b6acc80d8865b3beebd9f271743d8cb1` |
| `src/lib/chat/__tests__/t113-migration-contract.test.ts` | `abb2e2c7d276cddfdafd5bb17e578d75c39f43baa132f68afce9799339d96304` |
| `src/lib/chat/__tests__/t113-backfill-contract.test.ts` | `9a58919cf18bec6a2147b69299017f018d991e3684ab156476ed713f38e4b571` |

추가 참고: `scripts/migrations/T-113-backup-restore-drill.sh`, `T-113-gpg-pipeline-drill.sh`, `T-113-chat-ownership-backfill-plan.sql`, T-108 기록 및 ADP-010의 승인된 설계·데모. 이 파일들은 위 표처럼 해시 고정된 전달 범위가 아니므로 Claude가 필요 범위를 확인하고 현 버전을 식별한다. 공통 라이브러리의 정확한 위치·소유 파일은 T-152 기록에서 확인한다.

채팅 경로 외에도 작업 트리에 다른 병행 변경이 존재한다. 예를 들어 리더 지침·보드·T-145·TradeLogPanel·EvalFunnelCard 변경 등이 관찰됐다. 전체 stage/reset/stash/clean 또는 다른 작업 되돌리기를 하지 않는다. `src/lib/db.ts`처럼 공유 가능성이 있는 파일도 소유와 diff를 먼저 구분한다. 이 인계문은 위 범위 밖 자료의 외부 전송 허가가 아니다.

## 4. Codex 측 작성·확인과 한계

- T-113 서버 인가 코드·스키마 초안, 수동 DDL, 백필 연구용 초안과 이관 문서가 작성되어 있다. `T-113-chat-ownership-operator.mjs`는 기본 비활성이지만 명시 설정 시 실제 서버에 연결·변경 가능한 연구용 초안이다. **운영에서 실행하면 안 된다.** `T-113-chat-ownership-backfill.mjs`는 합성 fixture 전용이고 `T-113-chat-ownership-backfill-plan.sql`은 주석 전용이다.
- Codex 측 독립 정적 감사와 격리 시험 기록: 인가 모의 24/24, 격리 MariaDB·서명 세션 시험 8/8, 타입 검사 통과. 백필 운영자 초안은 정적 감사에서 결함을 수정한 뒤 격리 연구 범위 PASS, 단위 7/7과 합성 MariaDB 검증 기록이 있다. TLS는 시험용 Unix socket 경로에서 확인했을 뿐 운영 TCP·인증서 시험이 아니다. 기존 검사 기록과 SHA 일치 여부는 Claude가 재확인한다.
- 백업은 합성 MariaDB의 GnuPG 암복호·복원과 MySQL 8 덤프 호환 시험만 성공했다. 실제 운영 스키마 전체, 실데이터 백업·격리 복원, 실제 키 및 전송 경로는 미검증이다. 행 수 초과와 커밋 결과 불명 주입, 운영 동시성·구버전 차단·실사용자 연동도 미검증이다.
- 기존 2026-08-04 승인 설계는 `chat_threads`와 `chat_messages` 양쪽에 `user_id NOT NULL`을 두는 반면 현재 제안은 부모 스레드의 nullable owner를 정본으로 사용한다. 차이를 자동 승인된 최종안으로 취급하지 말고 영향·대안과 프로젝트 판단을 정리한다. 과거 승인을 없던 것으로 취급하지 않는다.
- Codex가 시도한 공식 Claude 외부검토 C1/C2는 `incomplete / bad_file_list`, 실제 Claude CLI 실행 및 선택 소스 전송 0이다. 기존 Codex Reviewer/QA나 인계문을 실제 Claude의 최종 검증으로 표시하지 않는다.

## 5. Claude가 이어서 할 일

1. 실제 Claude Code 세션에서 이 문서와 T-113/T-152 기록을 읽고 인수한 task·파일 버전·다음 단계와 수신 사실을 기록한다. 최신 사용자 답변 및 병행 작업부터 확인한다.
2. 승인된 접근 차단·진행 요청 정리·운영 백업 격리 복원·환경 검증을 실현할 권한과 안전한 경로를 찾는다. 이미 승인된 범위를 재승인받지 않는다. 관리자 권한이나 NAS/암호화 접속이 여전히 없으면 가능한 대안을 준비하고 **권한/접속 정보만** 요청한다. 사용자 동의 없이 실매매·cron을 중단하거나 대화를 노출하지 않는다.
3. 실제 차단을 경로별로 검증하고, 기존 요청과 후속 쓰기의 종료 가능성·불명확한 항목을 구분한다. 운영 백업은 적절한 일관성·비밀 보호 상태로 확보하고 격리 DB 복원과 스키마·데이터 비교를 수행한다. 이미 실행한 시험, 운영에 직접 적용한 조치, 실행하지 못한 항목을 따로 보고한다.
4. 백필 도구·스키마 차이·인가와 기존 기능 보존을 독립 검토하고 필요한 구현 및 최종 테스트·검증을 Claude 측 프로젝트 절차에 따라 수행한다. 변경 후 새 버전 기준으로 Reviewer → QA를 재순환한다. 합성 시험만으로 실제 운영 검증이라고 보고하지 않는다.
5. **운영 DB에 DDL·백필 등 변경을 적용하기 전에** 수행한 결과와 구체적인 대상·영향·복구·배포 계획을 사용자에게 보고하고, 해당 변경에 필요한 결정을 확인한다. 승인 전 운영 DB 변경을 실행하지 않는다.
6. T-113 완료 이후 기존 기능을 보존하며 T-152 공통 UI/라이브러리와 StockInvest 실제 연동·메뉴 노출을 진행하고, 사용자가 승인한 v4 및 기존 기능에 대해 실제 동작을 검증한다. 배포 여부와 기존 승인 범위를 구분한다. Claude가 최종 결과와 미확인·사용자가 확인할 내용을 task에 기록한다.

## 6. 실제 전달 상태와 시작 지시

**전달 상태:** 이 인계문 작성만 완료. 실제 Claude Code 실행·전달·수신·최종 검사·배포는 아직 확인되지 않았다.

Claude Code의 StockInvest 작업 세션에 아래 지시를 전달하면 된다.

```text
StockInvest의 docs/handovers/T-113-T-152-claude-handover-2026-11-05.md를 읽고 작업을 이어받아줘.
인계문에 기록된 사용자 승인과 운영 DB 변경 전 보고 조건을 유지하고,
T-113 접근 차단·진행 요청 정리·운영 백업 격리 복원과 환경 검증을 진행해줘.
인수한 버전과 실제 실행·미실행 결과를 기록하고, 이후 T-152 실제 연동까지 이어가줘.
기존에 받은 승인은 다시 묻지 말고, 실제로 필요한 새 판단이나 접근 방법만 물어봐줘.
```

# T-153 공통 데모 승인 도구 Claude 인계

2026-11-05 KST. 현재 Codex 담당(`codex_scoped`), 최초 도구 `codex`. [작업 기록](../../agent-vault/10-Flow/tasks/T-153-contextual-demo-gate-revalidation.md)의 실행 이력이 현재 상태의 정본이다.

사용자는 자연스러운 승인 발화를 기존 승인 검증을 유지하면서 인식하도록 수정하고, 실제 Codex 승인 흐름과 Claude 주 작업 인수까지 완료하라고 지시했다. 최종 검증과 결과 기록을 인계한다. 검증 대상은 공통 승인 도구이며 T-150 제품 화면의 구현·배포는 별도 작업이다. T-150 v2의 기존 승인은 11월 5일 읽기 전용 검사에서 `DEMO_GATE_PASSED`, `approved`, `hash verified`를 확인했다. 기존 승인 재확인이나 재등록은 필요 없다.

## 검증 대상 버전

StockInvest 작업 기록의 `base_ref`는 `dbeca9d8873c599ac54009ddede954e79423db18`이다. 공통 도구는 상위 워크스페이스의 비 Git 경로에 있어, 수정본은 아래의 로컬 파일과 SHA-256으로 식별한다. 이 목록은 전송 대상 파일 목록이 아니다.

| 상위 워크스페이스 기준 파일 | SHA-256 |
|---|---|
| `.claude/tools/demo-gate/gate.mjs` | `895520b5883f45de22cf0cc6c67c843b94d73a76ed0cd5318646a1602ce6c7d8` |
| `.claude/tools/demo-gate/codex-evidence.mjs` | `5e6722dc9433cf4a56414f26d59a55156e4aff10fa9d37ee6668a8e2469703dc` |
| `.claude/tools/demo-gate/historical-plan.mjs` | `d33506ba4a89f3a0d20fadaab446037580814da827d08808b17645b16f9dbf3b` |
| `.claude/tools/demo-gate/test/demo-gate.test.mjs` | `cc53bc444bbe81cce877865ec6dc089c83fc01caeb5582408d45ae0fa7ea2409` |
| `docs/demo-review-gate.md` | `a605b2b8c468a82f1d8801a2dababd982872d62418b6a504d0a439e0f1f22ea7` |
| `.claude/tools/demo-gate/README-CODEX.md` | `381e4a839fc121cf6569c673d0ace9974e2e0d9007da4a3794161c51a463a2d9` |

Codex 독립 Reviewer는 첫 다섯 파일에 조건부 통과, README에 별도 통과를 기록했다. 격리 QA는 합성 승인 도구 95/95 및 선택 훅 생성기 16/16 통과를 기록했다. 다른 도구의 확인 범위와 결과는 작업 기록에서 각각 확인한다. C2 외부 검토는 브로커 범위와 전송 제한에 따라 `skipped`로 남아 있다.

## 인수 후 완료 기준

1. 받은 작업 ID, 대상 버전, 수신 시각, 실제 Claude 작업 세션 식별자, 맡은 다음 단계를 기록한다. 실제 인수 시 `origin_tool: codex`를 유지하고 `current_tool: claude`, `current_procedure: claude_standard`, 인수 범위와 이력 ID를 함께 갱신한다.
2. 파일 해시를 로컬에서 대조하고, 별도 시험 환경에서 최종 검사한다. 사용자 코드·데이터 원문과 대화 기록·원장·비밀은 외부로 전송하지 않는다. 범위 내 로컬 검사 결과와 허용된 요약을 사용한다. 실환경 설치본의 역사 이관 시험은 실제 상태를 바꿀 수 있다. 기존 QA처럼 로컬 사본의 합성 fixture 경로, HOME, TMPDIR를 분리하고 실제 T-150, 실제 승인 원장, 실제 transcript를 회귀 입력으로 사용하지 않는다.
3. Codex 메인 세션에서 비운영 데모 `T-153TEST` v1의 `review_requested` 등록과 데모 제시 후 실제 사용자의 자연어 승인을 확인했다. 메인 세션이 같은 발화 원문으로 `approve-codex-context`를 실행해 2026-11-05 21:44:57 KST `DEMO_GATE_APPROVED`를 받았다. 이후 읽기 전용 `check`는 `DEMO_GATE_PASSED`, `approved` v1, `hash verified`를 반환했다. 데모 SHA-256은 `8b7e63140ec7645a2d9849efce3982a7fc0d60654ba1c9de85b1fd09890784c0`이다. 이 증거는 해당 Codex 대화와 테스트 데모에 한정된다. Claude의 실제 인수와 최종 검증은 미확인이다.
4. 비협조적 외부 편집자의 저장 경쟁, 새 실사용 훅 적용 범위, 개별 플랫폼의 미검증을 각각 보고한다. 이미 구성된 UI 프로젝트 10곳의 설정 확인은 런타임 확인과 구분한다. 원래 범위는 승인 도구의 최종 검증과 기록이다. 운영 push·배포, 거래, DB 변경, 서비스 재시작 및 훅 신뢰 상태 변경은 이번 인계 범위에 없다.

정본: [작업 도구·절차 기록 규약](../../../docs/task-tool-context.md). 인수 근거, 실행 결과, 완료하지 못한 범위를 작업 기록에 남긴다.

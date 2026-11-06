# T-154 자동승인모드 구현 인계

2026-11-06 추가 사용자 승인으로 Codex가 UI와 저장 API까지 직접 구현했다. 아래 인계안은 당시 기록이다. exec-008 사용자 지시로 운영자 ID 제한을 해제했으며, 최신 변경과 검증은 T-154 작업 이력을 따른다.

작업 이력은 [T-154](../../agent-vault/10-Flow/tasks/T-154-auto-approval-mode-setting.md)에 있다. Claude가 작업을 실제로 인수할 때 수신 시각, 작업 범위, 세션 근거를 기록하고 `current_tool`과 `current_procedure`를 갱신한다.

사용자는 v1을 확인한 뒤 “그리고 추가적으로 '손실한도 손절' 항목은 제거해주고 데모화면 확인했으니 이대로 진행해줘”라고 지시했다. 구현 기준은 v1과 이 발화에서 지정한 읽기 전용 행 제거다.

| 구분 | 파일 | SHA-256 |
|---|---|---|
| 사용자가 검토한 v1 | [v1 HTML](../../mockups/T-154-auto-approval-mode-setting-v1.html) | `5c8b07eb6d35f395255b0b4a45ba16052d4f39600d01907b5b93096454f6dd2b` |
| 행 제거를 반영한 참고본 | [v2 HTML](../../mockups/T-154-auto-approval-mode-setting-v2.html) | `3e75205ccd5d7ba0654017c174c53288cb01cfaf9695803985742ade8fa911d1` |

## 현재 인계 상태

2026-11-06 08:15 KST에 기존 사용자 발화로 공식 `approve-codex-context`가 `DEMO_GATE_APPROVED`를 반환했다. 이어 `check`에서 `approved_version: v1`, `hash: verified`를 확인했다. 앱 구현을 재개할 때 `check`로 v1을 확인하고 작업 중 게이트를 활성화한다. v2는 사용자가 지시한 행 제거만 재현한 참고본이다.

Codex는 `src/app/settings/SettingsPage.tsx`에서 독립된 **손실한도 손절** 읽기 전용 행과 그 행의 임계값 표시 상수를 제거했다. `src/app/settings/__tests__/settings-live-trading-t108.test.ts`에서 행 부재와 청산 엔진의 하위 상태 표시를 대조한다. 두 파일의 현재 변경분을 바탕으로 자동승인모드와 저장 API를 구현한다.

| 로컬 변경 파일 | SHA-256 |
|---|---|
| `src/app/settings/SettingsPage.tsx` | `0af4510b4da499f3cd8ecd2d4457fc16a3782fbbb242786a0ab18c26911e195e` |
| `src/app/settings/__tests__/settings-live-trading-t108.test.ts` | `9a9b9555d259cd8f3a28b28ef35d28212d1e82176cbfd264f10d790400219f18` |

Ubuntu 로컬 디스크 격리 사본 `/home/brownjeon/.node-local/stockinvest-t154-settings.GLsWxfyY`에서 같은 lockfile로 의존성을 새로 설치하고 `flock /tmp/stockinvest-heavy-tests.lock`을 사용했다. 현재 두 변경 파일의 해시를 대조해 `settings-live-trading-t108.test.ts`와 `settings-touch-keyboard-t130.test.ts` 2개 스위트 80/80을 확인했다. 이는 행 제거의 작성자 점검이다.

## 승인 장애의 원인과 조치

같은 턴의 `additional_content.browser_tabs`를 검증기가 인식하지 못해 최초 `approve-codex-context`가 `DEMO_GATE_REFUSED`를 반환했다. 동일 세션의 요청·원문 결합을 확인하고, 공용 검증기의 메타데이터 허용 목록에 그 종류와 `harness` provenance 조합만 추가했다. 정형·자연어 양쪽의 회귀는 브라우저 탭 출처, 사용자 발화 부재, 탭 본문에만 들어간 승인 문구를 시험한다.

공용 도구 격리 검사 96/96 통과, 두 후보 파일 독립 Reviewer R2 코드 감사 PASS 후 정본 해시를 대조해 적용했다. 변경된 `codex-evidence.mjs` SHA-256은 `568839090604e550efa398d5f3970754ac5c316f8b7d529e1112747ffc6d86b4`, `test/demo-gate.test.mjs`는 `8d972454114247d9e0ce9821020b00164428bf862090ac26d80b622f4b05145f`다. 원래 사용자 발화를 공식 CLI에 전달해 승인 원장이 기록됐다.

## 구현 범위

- `src/app/settings/SettingsPage.tsx`의 설정 → 안전장치 (공통)에 **자동승인모드**를 자동 청산 엔진 바로 아래 배치한다. 제거한 독립 행 대신 새 모드 행을 추가한다. 자동 청산 엔진의 손절 상태 설명과 주문 정책은 현행 동작을 정확히 반영한다. 관련 화면 문서의 독립 행 설명도 함께 갱신한다.
- ON은 `system_config.autopilot_mode`의 JSON 문자열 `"auto"`, OFF는 `"assist"`로 저장한다. 국내·해외 신규 시그널에 적용한다. 기존 `manual`은 실제 상태로 표시하고 사용자의 명시적 전환으로만 값을 바꾼다. `승인 후 진입 감시`의 도움말은 승인된 주문의 실행 시점을 설명한다.
- 설정을 읽거나 저장 결과를 확인할 수 없으면 토글을 잠그고 재조회 동작을 제공한다. ON 확인창에는 국내·해외 공통 적용과 현재 실거래 여부를 표시한다. 취소·저장 실패 시 마지막 확인 상태를 표시하고, 네트워크 오류로 저장 결과가 불명확하면 서버를 다시 읽어 확정한다.
- 새 쓰기 경로는 서명된 세션에서 사용자 ID를 확인하고 서버가 검증한 운영자 권한을 요구한다. 현재 공용 안전장치 API의 로그인 확인만으로 운영자임을 가정하지 않는다. 운영자 지정 근거가 비어 있으면 쓰기를 막는다. 입력 검증과 교차 사이트 요청 방어를 적용하고, 저장 전에 읽은 모드와 확인한 실거래 상태가 달라졌으면 요청을 거부하고 재조회한다.
- 모드 저장은 전역 설정 한 키에만 적용한다. 저장 요청은 주문 제출과 독립적이다. 실행 시 기존 `routeSignal`의 자동 제출 금액 한도, `submitOrder`, 실거래 여부와 모든거래차단을 그대로 적용한다. 실거래 여부의 별도 스위치, 이전 승인 대기 시그널, 기존 청산 규칙은 그대로 둔다.

## 검증 및 운영 범위

합성 데모는 Chrome 360·412·1280px에서 확인했고 두 HTML 파일은 lint를 통과했다. 구현 뒤에는 격리 환경에서 실제 API와 화면을 연결해 운영자·일반 회원·미인증 계정, 잘못된 값, ON 확인/취소, 수동형, 저장 실패·재조회 및 동시 변경을 검증한다. 국내·해외 주문 라우팅은 양쪽 모드와 기존 강제 청산, 주문 한도, `DRY_RUN`과 차단 스위치를 각각 시험한다. 거래소 호출은 격리한다.

안전 경로 변경은 프로젝트의 독립 Reviewer와 QA를 거친다. 사용자 승인 범위는 화면 설계와 기능 구현이다. 배포 또는 현재 운영 DB 모드 전환은 구체적인 결과와 전환 영향을 확인한 뒤 별도로 처리한다.

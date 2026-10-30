/**
 * T-128 A4 — 저장된 청산 사유 앞머리의 **표시 시점** 별칭 (정본 용어: 지표 계약 §12 용어 정정표).
 *
 * 청산 엔진(`exit-engine.ts` 의 `reasonHead`)은 `signals.reasoning` 에 `[하드 손절] …`·`[EOD 손절] …` 으로 저장한다.
 * 그 생성 경로·저장 텍스트는 바꾸지 않는다(가이드 §3.3 「제외」 — 내부 이름·DB 텍스트 유지, 과거 행도 그대로).
 * 사용자에게 **보여 줄 때만** 이 함수로 승인 용어 앞머리 `[손실한도 손절]`·`[장마감 전 손절]` 로 바꾼다 — 그러지 않으면
 * 텔레그램 승인 메시지 한 통에 새 이름(「유형: 손실한도 손절」)과 옛 앞머리(「사유: [하드 손절] …」)가 섞인다(T-129 Reviewer 4(a)).
 *
 * 규칙
 *  - 문자열 **맨 앞(0번째 글자)부터** 아래 표의 앞머리와 정확히 같을 때만 바꾼다. 옛 앞머리·새 앞머리 모두 같은 새 앞머리로
 *    — 두 번 거쳐도 결과가 같다(이미 바뀐 문자열이 다시 들어와도 안전).
 *  - 앞머리가 없거나, 표에 없는 앞머리(`[목표 익절]`·`[트레일링 스탑]`·`[시나리오 손절]` 등 — §12 에 없는 말, T-130 이 정한다),
 *    중간에 들어 있는 경우(앞에 다른 표지가 붙은 문자열)는 그대로 돌려준다.
 *  - 문자열이 아니면(null·undefined) 그대로 돌려준다.
 *
 * 표시 전용이다 — 판정·분기·저장·비교에 쓰지 않는다. 순수 함수(DB·네트워크·로그 없음)라 서버·화면 어디서든 import 할 수 있다.
 * 이 함수를 쓰는 표시 지점 목록은 T-128 task 이력서 `## Developer` 절에 있다(울타리: `__tests__/exit-reason-display.test.ts`).
 */

/** [저장된 앞머리, 표시 앞머리] — 옛 앞머리(`exit-engine.ts` reasonHead 원문)와 새 앞머리 모두 새 앞머리로. */
export const EXIT_REASON_HEAD_ALIASES: ReadonlyArray<readonly [stored: string, shown: string]> = Object.freeze([
  ['[하드 손절]', '[손실한도 손절]'],
  ['[손실한도 손절]', '[손실한도 손절]'],
  ['[EOD 손절]', '[장마감 전 손절]'],
  ['[장마감 전 손절]', '[장마감 전 손절]'],
] as const);

export function displayExitReason(reason: string): string;
export function displayExitReason(reason: string | null | undefined): string | null | undefined;
export function displayExitReason(reason: string | null | undefined): string | null | undefined {
  if (typeof reason !== 'string') return reason;
  for (const [stored, shown] of EXIT_REASON_HEAD_ALIASES) {
    if (reason.startsWith(stored)) return shown + reason.slice(stored.length);
  }
  return reason;
}

/**
 * API 응답 행의 `reasoning` 만 표시 앞머리로 — 바뀔 것이 없으면 **같은 객체**를 그대로 돌려준다(그 밖의 키·순서·값 불변).
 * 화면은 `GET /api/signals`·`/api/signals/[id]`·`/api/signals/missed` 응답을 그대로 그리므로 응답 변환부에서 한 번만 바꾼다.
 */
export function withDisplayReasoning<T extends object>(row: T): T {
  // 제약을 `{ reasoning?: unknown }` 로 두면 mysql2 RowDataPacket(인덱스 시그니처만 있는 타입)이 약한 타입 검사에 걸린다 — object 로 받고 여기서 읽는다
  const r = (row as { reasoning?: unknown }).reasoning;
  if (typeof r !== 'string') return row;
  const shown = displayExitReason(r);
  return shown === r ? row : { ...row, reasoning: shown };
}

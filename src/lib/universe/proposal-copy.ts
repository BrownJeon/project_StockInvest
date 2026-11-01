/**
 * T-143 WP-B — 변경 제안의 **말과 수를 서버에서 만든다** (구현 가이드 §2.4·§4.1). **순수 함수 · 시험 대상.**
 *
 * 왜 서버가 만드나(가이드 §4.1): 「화면이 숫자를 더하거나 문장을 조립하지 않는다」. 버튼 글자·완료 문구·보유 경고·
 * 효과 숫자가 화면과 텔레그램·홈에서 **같은 말**이어야 하고(§3.3), 수동 목록의 실제 변화는 목록을 직접 적용해 봐야 정확하다.
 *
 * 문구는 **평문**이다(`<b>` 같은 표시 꾸밈을 담지 않는다) — 데모는 HTML 문자열을 만들었지만 구현은 React 라
 * 서버 문구를 그대로 글자로 그린다. 강조는 카드·시트의 테두리·색이 맡는다(승인 데모와 뜻·문장은 같다).
 *
 * 색으로 넣기·빼기를 구분하지 않는다 — 이 앱의 빨강·파랑은 상승·하락이다(데모 §3 주의). 여기서는 **글자**가 뜻을 말한다.
 */
import type { ProposalActionType, ProposalEffect } from './types';

/** 종류 → 화면 칩 글자. 모르는 종류는 「알 수 없는 변경」(영문 코드를 그대로 보이지 않는다 — `jobNameText` 와 같은 규칙). */
export const PROPOSAL_KIND_KO: Readonly<Record<string, string>> = {
  delisting: '상장폐지 예정',
  acquisition: '인수 합의',
  merger: '합병',
  exchange_move: '거래소 이동',
  index_removal: '지수 편출',
  index_addition: '지수 편입',
  ticker_change: '코드 변경',
  add_candidate: '목록에 넣기 후보',
  // W-2(2026-11-01, Analyst WP-A 설계) — 자동 산출이 만드는 두 종류.
  //   otc_move        : 정규 거래소에서 장외로 내려간 종목(상장 목록에서 사라지고 OTC 로 보인다)
  //   kis_unavailable : 상장 목록에는 있는데 KIS 조회가 되지 않는 종목(표기 불일치·미지원 — 조회가 매일 실패한다)
  otc_move: '장외 이전',
  kis_unavailable: 'KIS 조회 불가',
};

export const UNKNOWN_PROPOSAL_KIND = '알 수 없는 변경';

/** 거래소 코드 → 사람이 쓰는 이름(거래소 이동 칩의 `(→ NYSE)`). */
export const EXCHANGE_NAME: Readonly<Record<string, string>> = { NAS: 'NASDAQ', NYS: 'NYSE', AMS: 'AMEX' };

function exchangeOf(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  const i = symbol.indexOf(':');
  if (i <= 0) return null;
  return EXCHANGE_NAME[symbol.slice(0, i)] ?? null;
}

/** 종류 칩 글자. `exchange_move` 는 바꿀 코드의 거래소를 덧붙인다 — 데모 「거래소 이동 (→ NYSE)」. */
export function proposalKindLabel(kind: string | null | undefined, nextSymbol?: string | null): string {
  const k = (kind ?? '').trim();
  const base = Object.prototype.hasOwnProperty.call(PROPOSAL_KIND_KO, k) ? PROPOSAL_KIND_KO[k] : UNKNOWN_PROPOSAL_KIND;
  const ex = k === 'exchange_move' ? exchangeOf(nextSymbol) : null;
  return ex ? `${base} (→ ${ex})` : base;
}

/** 주 버튼 글자 — 데모 `act`. `recode` 는 바뀌는 코드를 둘 다 보인다(접두사가 뜻을 가지므로 줄이지 않는다). */
export function actionLabel(type: ProposalActionType, symbol: string, nextSymbol: string | null): string {
  if (type === 'remove') return '목록에서 빼기';
  if (type === 'add') return '목록에 넣기';
  return nextSymbol ? `코드 바꾸기 ${symbol} → ${nextSymbol}` : '코드 바꾸기';
}

/** 확인 버튼 글자 — 데모 `actVerb`. */
export function actionVerb(type: ProposalActionType): string {
  if (type === 'remove') return '빼기';
  if (type === 'add') return '넣기';
  return '바꾸기';
}

/**
 * 완료 문구 — 데모 `done`. 보유 중인 종목을 뺐으면 **그 사실을 끝까지 말한다**(가이드 §2.4.2 — 보유 경고 4곳 중 성공 줄).
 * 「뺐으니 끝」으로 오해하지 않게, 분석이 계속된다는 사실을 완료 시점에도 남긴다.
 */
export function proposalDoneText(type: ProposalActionType, held: boolean): string {
  if (type === 'remove') return held ? '목록에서 뺐습니다 (보유 중이라 분석은 계속)' : '목록에서 뺐습니다';
  if (type === 'add') return '목록에 넣었습니다';
  return '코드를 바꿨습니다';
}

/**
 * 보유 중 경고 한 줄 — 가이드 §2.4.2 #2. **빼기일 때만** 뜻이 있다(넣기·코드 바꾸기는 분석이 계속되는 것이 당연하다).
 * 이 문구가 화면에서 사라지면 결함이다(§8.3 T-1 회귀 시험 대상).
 */
export function heldWarnText(type: ProposalActionType, held: boolean): string | null {
  if (!held || type !== 'remove') return null;
  return '보유 중입니다 — 목록에서 빼도 분석은 계속됩니다(분석 대상 = 보유 ∪ 즐겨찾기 ∪ 목록). 분석을 멈추려면 먼저 매도해야 합니다.';
}

/**
 * 제안을 적용한 **수동 목록**을 실제로 만든다 — 효과 숫자를 더하기·빼기로 추정하지 않는다.
 *  - `remove` : 그 코드를 뺀다(없으면 그대로).
 *  - `add`    : 없을 때만 끝에 넣는다(있으면 그대로 — 중복을 만들지 않는다).
 *  - `recode` : 그 코드를 새 코드로 바꾼다. 새 코드가 이미 있으면 **옛 코드만 빠진다**(중복을 만들지 않는다).
 *               옛 코드가 목록에 없으면 새 코드를 넣는다(거래소만 바뀐 종목이 자동 목록에서 온 경우).
 * 순서는 보존한다(목록 탭·대조 화면이 입력 순서로 보인다).
 */
export function applyProposalToManual(
  manual: readonly string[],
  action: { type: ProposalActionType; symbol: string; nextSymbol: string | null },
): string[] {
  const { type, symbol, nextSymbol } = action;
  if (type === 'remove') return manual.filter((s) => s !== symbol);
  if (type === 'add') return manual.includes(symbol) ? [...manual] : [...manual, symbol];
  // recode
  if (!nextSymbol) return [...manual];
  const out: string[] = [];
  const seen = new Set<string>();
  let replaced = false;
  for (const s of manual) {
    const v = s === symbol ? nextSymbol : s;
    if (s === symbol) replaced = true;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  if (!replaced && !seen.has(nextSymbol)) out.push(nextSymbol);
  return out;
}

/**
 * 확인 시트의 효과 숫자(가이드 §2.4.3). 네 수는 호출자가 **적용 뒤 목록으로 합집합을 다시 세어** 넘긴다
 * — 더하기·빼기로 추정하지 않는다.
 *
 * `heldKeepsAnalysis` = 「수동 목록은 줄었는데 분석 대상 수는 그대로」인가. 그 조건은 그 종목이 보유·즐겨찾기·자동
 * 목록에도 있다는 뜻이고, 시트 본문의 「보유 중이라 분석 대상 수는 150 그대로입니다」가 그때만 사실이다.
 * 별도 `held` 플래그를 받지 않는다 — 수를 두 번 말하면 두 값이 어긋날 수 있다.
 */
export function proposalEffect(args: {
  manualFrom: number; manualTo: number; totalFrom: number; totalTo: number;
}): ProposalEffect {
  const { manualFrom, manualTo, totalFrom, totalTo } = args;
  return { manualFrom, manualTo, totalFrom, totalTo, heldKeepsAnalysis: manualTo < manualFrom && totalTo === totalFrom };
}

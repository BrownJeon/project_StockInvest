/**
 * T-182 — 거래 리포트 **요약·화면 공용 순수 모듈**.
 *
 * ★ 이 파일은 의존성이 없어야 한다(DB·React·Node·별칭 import 금지). 서버(크론 발송)와 화면(`/report`)이
 *   같은 「확인 필요」 판정·같은 숫자 서식을 쓰도록 한 곳에 둔다. 판정이 두 벌이면 텔레그램 요약과 화면이
 *   조용히 어긋난다.
 *
 * 데이터 흐름:
 *   크론 발송 → `buildReportPayload()`(trade-report.ts, 발송 시점 값으로 조립) → `trade_report_archive.payload` 저장
 *   → 이 모듈의 `formatReportSummary()` 가 그 payload 로 텔레그램 요약을 만들고,
 *   → 화면은 저장된 payload 를 다시 읽어 `computeReportWarnings()` 로 같은 「확인 필요」를 그린다.
 *
 * 🔴 「매도 손익」이라는 말은 요약·화면 어디에도 쓰지 않는다 — 매도 **신호**에서 온 값이라 체결 손익처럼 읽히면 안 된다.
 * 🔴 이 모듈의 결과는 문자열·화면으로만 흘러간다. 주문·신호 생성·안전장치 어디에도 연결되지 않는다.
 */

// ─── payload (발송 시점 스냅샷) ─────────────────────────────────────────────

export const REPORT_PAYLOAD_SCHEMA_VERSION = 1 as const;

export type CoverageState = 'ok' | 'failed';

/** 섹션 조회 결과 — 실패를 0건과 구분하기 위한 필드(가이드 §4, 필수). */
export interface ReportCoverage {
  asset: CoverageState;
  holdings: CoverageState;
  candidates: CoverageState;
  research: CoverageState;
  signals: CoverageState;
}

export interface ReportNamed { symbol: string; name: string }

export interface ReportTrade {
  buys: number;
  buysAmountKRW: number;
  sells: number;
  sellsAmountKRW: number;
  /** 원가를 아는 매도분만의 실현손익(T-086 규칙 그대로) */
  lifoPnlKRW: number;
  matchedSellCount: number;
  unmatchedSellCount: number;
  churnSymbols: ReportNamed[];
}

export interface ReportSellSignal extends ReportNamed {
  signalId: number | null;
  exitKind: string;
  pnlPct: number;
  pnlKRW: number;
  signalAt: string | null;
  /** 연결된 주문이 체결(filled)됐는가 — T-182 신규 */
  filled: boolean;
}

export interface ReportHolding extends ReportNamed {
  market: 'domestic' | 'overseas';
  qty: number;
  /** 🔴 고점대비(보유 중 최고가 기준). 수익률이 아니다(T-033) */
  profitPct: number;
  periodChangePct: number | null;
  investedKRW: number;
  /** 투자금 표시 문구 — 발송 시점 `formatDisplayAmount` 결과(해외 환산·환산 불가 문구 포함). 없으면 null */
  investedText: string | null;
  /** 리서치 매도 판단(차트 기준) — 'sell' 이면 「매도 고려」 */
  sellAction: 'sell' | 'hold' | 'insufficient_data' | null;
  /** 판단 문구(`formatSellSignalLine` 의미, 앞 장식 제거) */
  sellJudgeText: string | null;
  /** 보유 정보 문구(`formatHoldingInfoLine` 의미, 앞 장식 제거) */
  holdingInfoText: string | null;
  holdingDays: number | null;
}

export interface ReportCandidate extends ReportNamed {
  status: 'watchlist' | 'ai_pass' | 'ai_rejected' | 'blocked';
  skipReason: string | null;
  rsi: number | null;
  evPct: number | null;
  aiConf: number | null;
}

export interface ReportResearchItem extends ReportNamed {
  market: 'domestic' | 'overseas';
  asOfDate: string | null;
  action: 'buy' | 'hold' | 'insufficient_data';
  triggerCount: number;
  /** 근거 문구(`formatBuyEvidence` 의미, 앞 장식 제거). 없으면 null */
  evidenceText: string | null;
  /** 가격 문구(`formatTargetFragment` 의미 — 희망가·기준·기한) */
  priceText: string | null;
}

export interface ReportResearch {
  trackedCount: number;
  activeCount: number;
  /** 면책 전문 — 화면 리서치 섹션 맨 위에 항상 표시 */
  note: string;
  items: ReportResearchItem[];
}

export interface TradeReportPayload {
  schemaVersion: typeof REPORT_PAYLOAD_SCHEMA_VERSION;
  rangeStart: string;
  rangeEnd: string;
  coverage: ReportCoverage;
  asset: { totalKRW: number | null; baselineKRW: number | null };
  trade: ReportTrade;
  sellSignals: ReportSellSignal[];
  holdings: ReportHolding[];
  candidates: ReportCandidate[];
  research: ReportResearch;
}

// ─── 라벨 ───────────────────────────────────────────────────────────────────

/** 청산 종류 — 기존 리포트 `exitLabel`(formatReportMessage)과 같은 말. */
export const REPORT_EXIT_LABEL: Readonly<Record<string, string>> = {
  hard_stop: '손절',
  trailing_stop: '트레일링 스탑',
  target_profit: '목표 익절',
  eod_loss_cut: '마감손절',
  ai_sell: 'AI매도',
};
export function reportExitLabel(kind: string | null | undefined): string {
  if (!kind) return '청산';
  return REPORT_EXIT_LABEL[kind] ?? kind;
}

/**
 * 매수 후보 차단 사유(`indicators.ai.skipCategory`) → 사람말.
 * `skip-reason-formatter.ts` 의 라벨은 export 되지 않고 문장 길이도 길어, 요약 한 줄에 맞게 짧게 둔다.
 * 「포트폴리오 보호」는 승인 데모 v1 의 문구 그대로다.
 */
export const REPORT_SKIP_LABEL: Readonly<Record<string, string>> = {
  portfolio_guard: '포트폴리오 보호',
  ai_failed: 'AI 호출 실패',
  ai_low_confidence: 'AI 신뢰도 부족',
  ai_rejected: 'AI 거절',
  rule_prefilter: '룰 사전 차단',
  dedup_reuse: '중복 제거',
  market_state_neutral: '시장 상태 관망',
  strong_counter_trend: '강한 역추세',
};
export function reportSkipLabel(code: string | null | undefined): string {
  if (!code) return '사유 기록 없음';
  return REPORT_SKIP_LABEL[code] ?? '알 수 없는 사유';
}

/** 매수 후보 상태 글자 — 기존 리포트 `statusLabel` 의 뜻(아이콘 없이). */
export const REPORT_CANDIDATE_STATUS: Readonly<Record<ReportCandidate['status'], string>> = {
  watchlist: '대기',
  ai_pass: 'AI승인',
  ai_rejected: 'AI거절',
  blocked: '차단',
};

/** 손절 임박 기준 — 기존 리포트와 같다(고점대비 −1.5% 이하). */
export const STOP_NEAR_PCT = -1.5;

// ─── 숫자·시각 서식 ─────────────────────────────────────────────────────────

const MINUS = '−';

export function fmtWon(n: number): string {
  return `₩${Math.abs(Math.round(n)).toLocaleString('ko-KR')}`;
}
/** 부호 있는 원화 — `+₩1,000` / `−₩1,000` / `₩0` */
export function fmtSignedWon(n: number): string {
  const r = Math.round(n);
  const sign = r < 0 ? MINUS : r > 0 ? '+' : '';
  return `${sign}₩${Math.abs(r).toLocaleString('ko-KR')}`;
}
/** 부호 있는 퍼센트 — `+1.20%` / `−3.63%`. 값이 없으면 null */
export function fmtSignedPct(v: number | null | undefined, digits = 2): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  const sign = v < 0 ? MINUS : v > 0 ? '+' : '';
  return `${sign}${Math.abs(v).toFixed(digits)}%`;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

interface KstParts { y: string; mo: string; d: string; h: string; mi: string; wd: string }

function kstParts(iso: string | Date): KstParts | null {
  const t = iso instanceof Date ? iso.getTime() : Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  // KST 는 서머타임이 없다 — +9시간 고정 이동 후 UTC 필드로 읽으면 실행 환경 시간대와 무관하다.
  const k = new Date(t + 9 * 3600_000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return {
    y: String(k.getUTCFullYear()),
    mo: p2(k.getUTCMonth() + 1),
    d: p2(k.getUTCDate()),
    h: p2(k.getUTCHours()),
    mi: p2(k.getUTCMinutes()),
    wd: WEEKDAY_KO[k.getUTCDay()],
  };
}
/** `11/20 08:04` (KST) */
export function fmtKstShort(iso: string | Date): string {
  const p = kstParts(iso);
  return p ? `${p.mo}/${p.d} ${p.h}:${p.mi}` : '시각 미상';
}
/** `11/20 (목) 08:04` (KST) */
export function fmtKstWithDay(iso: string | Date): string {
  const p = kstParts(iso);
  return p ? `${p.mo}/${p.d} (${p.wd}) ${p.h}:${p.mi}` : '시각 미상';
}
/** 분석 기간 길이(시간, 반올림) — 기존 리포트 제목의 `(24h)` 와 같은 계산 */
export function rangeHours(p: Pick<TradeReportPayload, 'rangeStart' | 'rangeEnd'>): number {
  const ms = Date.parse(p.rangeEnd) - Date.parse(p.rangeStart);
  return Number.isFinite(ms) ? Math.round(ms / 3600_000) : 0;
}

// ─── 해외 종목명 축약 (요약 메시지 전용) ────────────────────────────────────

/** 해외 심볼은 `NAS:AAPL` 처럼 거래소 접두가 붙는다. 국내는 6자리 코드. */
export function isOverseasSymbol(symbol: string): boolean {
  return symbol.includes(':');
}
export function tickerOf(symbol: string): string {
  const i = symbol.lastIndexOf(':');
  return i >= 0 ? symbol.slice(i + 1) : symbol;
}
const HANGUL = /[가-힣]/;
const FUND_WORDS = new Set(['ETF', 'ETN', 'TRUST', 'TR']);

function firstWordOf(name: string): string {
  const w = name.trim().split(/\s+/)[0] ?? '';
  return w.replace(/[.,;:]+$/, '');
}

/**
 * 요약 메시지에서 쓸 짧은 이름을 정한다(가이드 §1 「해외 종목명 축약」).
 *  - 한글명·국내 종목 → 그대로(자르지 않는다)
 *  - 해외 영문명 → 첫 단어. 단 (a) ETF·ETN·TRUST·TR 단어 포함 (b) 첫 단어 3자 이하
 *    (c) 같은 메시지 안에서 첫 단어가 겹침 → 티커(`NAS:SMH` → `SMH`)
 * 앱 화면은 전체 이름을 쓴다 — 이 함수는 요약에서만 쓴다.
 */
export function buildShortNamer(entries: readonly ReportNamed[]): (symbol: string, fallbackName?: string) => string {
  const nameBySymbol = new Map<string, string>();
  for (const e of entries) if (!nameBySymbol.has(e.symbol)) nameBySymbol.set(e.symbol, e.name || e.symbol);

  const candidate = new Map<string, string>();       // symbol → 첫 단어 후보
  const firstWordOwners = new Map<string, Set<string>>();
  const result = new Map<string, string>();

  for (const [symbol, name] of nameBySymbol) {
    if (!isOverseasSymbol(symbol) || HANGUL.test(name) || name === symbol) {
      // 국내·한글명은 그대로. 이름을 모르는(심볼 그대로인) 해외 종목은 티커로.
      result.set(symbol, isOverseasSymbol(symbol) && name === symbol ? tickerOf(symbol) : name);
      continue;
    }
    const words = name.trim().split(/\s+/).map((w) => w.replace(/[.,;:]+$/, '').toUpperCase());
    const first = firstWordOf(name);
    if (words.some((w) => FUND_WORDS.has(w)) || first.length <= 3) {
      result.set(symbol, tickerOf(symbol));
      continue;
    }
    candidate.set(symbol, first);
    const key = first.toUpperCase();
    const owners = firstWordOwners.get(key) ?? new Set<string>();
    owners.add(symbol);
    firstWordOwners.set(key, owners);
  }
  for (const [symbol, first] of candidate) {
    const owners = firstWordOwners.get(first.toUpperCase());
    result.set(symbol, owners && owners.size > 1 ? tickerOf(symbol) : first);
  }
  return (symbol: string, fallbackName?: string) => result.get(symbol) ?? fallbackName ?? symbol;
}

// ─── 확인 필요 판정 (요약·화면 공용) ────────────────────────────────────────

export type ReportSectionId = 'r-asset' | 'r-trade' | 'r-sell' | 'r-hold' | 'r-cand' | 'r-res';

export interface ReportWarning {
  kind: 'asset_failed' | 'stop_near' | 'sell_unfilled' | 'churn' | 'candidates_blocked' | 'section_failed';
  /** e = 조회 실패, w = 그 외 */
  severity: 'e' | 'w';
  /** 텔레그램 요약 한 줄(앞 `• ` 제외) */
  tg: string;
  /** 화면 행 제목·보조 줄 — 전체 이름 */
  title: string;
  sub: string;
  /** 이 항목이 가리키는 화면 섹션 */
  target: ReportSectionId;
}

type NameFn = (symbol: string, fallbackName?: string) => string;

/** 요약·화면에 등장하는 모든 (심볼, 이름) — 짧은 이름 충돌 판정용 */
export function reportNamedEntries(p: TradeReportPayload): ReportNamed[] {
  return [
    ...p.holdings, ...p.sellSignals, ...p.candidates, ...p.research.items, ...p.trade.churnSymbols,
  ].map((x) => ({ symbol: x.symbol, name: x.name }));
}

/** 미체결 매도 신호 — 종목별로 묶는다(발생 순서 유지). */
export function groupUnfilledSells(p: TradeReportPayload): Array<{ symbol: string; name: string; count: number; kinds: string[]; pnlKRW: number }> {
  const out = new Map<string, { symbol: string; name: string; count: number; kinds: string[]; pnlKRW: number }>();
  for (const s of p.sellSignals) {
    if (s.filled) continue;
    const g = out.get(s.symbol) ?? { symbol: s.symbol, name: s.name, count: 0, kinds: [], pnlKRW: 0 };
    g.count += 1;
    g.pnlKRW += Number.isFinite(s.pnlKRW) ? s.pnlKRW : 0;
    const label = reportExitLabel(s.exitKind);
    if (!g.kinds.includes(label)) g.kinds.push(label);
    out.set(s.symbol, g);
  }
  return [...out.values()];
}

export function stopNearHoldings(p: TradeReportPayload): ReportHolding[] {
  return p.holdings.filter((h) => Number.isFinite(h.profitPct) && h.profitPct <= STOP_NEAR_PCT)
    .sort((a, b) => a.profitPct - b.profitPct);
}

/** 매수 후보가 1개 이상이고 전부 차단인가 + 사유 */
export function candidatesAllBlocked(p: TradeReportPayload): { all: boolean; reason: string } {
  const c = p.candidates;
  if (c.length === 0 || !c.every((x) => x.status === 'blocked')) return { all: false, reason: '' };
  const codes = new Set(c.map((x) => x.skipReason ?? ''));
  return { all: true, reason: codes.size === 1 ? reportSkipLabel([...codes][0] || null) : '사유 여러 가지' };
}

/**
 * 「확인 필요」 — 순서는 가이드 §1 그대로(돈과 직결되는 것부터):
 *  ① 총자산 조회 실패 ② 손절 임박 ③ 매도 신호 미체결(종목별) ④ 회전매매 ⑤ 매수 후보 전부 차단 ⑥ 섹션 조회 실패.
 * 🔴 0건이 아니면 줄 수 목표보다 우선해 **전부** 나간다 — 이 함수는 자르지 않는다.
 *
 * @param shortName 텔레그램 요약 줄에 쓸 이름 함수. 없으면 전체 이름.
 */
export function computeReportWarnings(p: TradeReportPayload, shortName?: NameFn): ReportWarning[] {
  const tgName: NameFn = shortName ?? ((s, n) => n ?? s);
  const w: ReportWarning[] = [];
  const cov = p.coverage;

  if (cov.asset === 'failed' || p.asset.totalKRW == null) {
    w.push({
      kind: 'asset_failed', severity: 'e', target: 'r-asset',
      tg: '총자산 조회 실패 — 증권사 잔고·환율을 읽지 못함',
      title: '총자산을 조회하지 못했습니다',
      sub: '잔고·예수금·환율 중 확인 실패 · 0원이 아닙니다',
    });
  }

  if (cov.holdings === 'ok') {
    const near = stopNearHoldings(p);
    if (near.length > 0) {
      const list = (fn: NameFn) => near.map((h) => `${fn(h.symbol, h.name)}(고점대비 ${fmtSignedPct(h.profitPct)})`).join(' · ');
      w.push({
        kind: 'stop_near', severity: 'w', target: 'r-hold',
        tg: `손절 임박 ${near.length}종목: ${list(tgName)}`,
        title: `손절 임박 ${near.length}종목`,
        sub: `${list((s, n) => n ?? s)} · 기준 고점대비 ${fmtSignedPct(STOP_NEAR_PCT, 1)} 이하`,
      });
    }
  }

  if (cov.signals === 'ok') {
    for (const g of groupUnfilledSells(p)) {
      const kinds = g.kinds.join(', ');
      w.push({
        kind: 'sell_unfilled', severity: 'w', target: 'r-sell',
        tg: `${tgName(g.symbol, g.name)} 매도 신호 ${g.count}건 미체결 (${kinds} · 신호 기준 ${fmtSignedWon(g.pnlKRW)})`,
        title: `${g.name} 매도 신호 ${g.count}건 — 체결 안 됨`,
        sub: `${kinds} · 신호 기준 ${fmtSignedWon(g.pnlKRW)} · 실제 손익 아님`,
      });
    }
  }

  if (p.trade.churnSymbols.length > 0) {
    w.push({
      kind: 'churn', severity: 'w', target: 'r-trade',
      tg: `회전매매: ${p.trade.churnSymbols.map((c) => tgName(c.symbol, c.name)).join(', ')}`,
      title: '회전매매',
      sub: `${p.trade.churnSymbols.map((c) => c.name).join(', ')} · 같은 기간 매수·매도가 2회 이상 반복`,
    });
  }

  if (cov.candidates === 'ok') {
    const b = candidatesAllBlocked(p);
    if (b.all) {
      w.push({
        kind: 'candidates_blocked', severity: 'w', target: 'r-cand',
        tg: `매수 후보 ${p.candidates.length}종목 전부 차단 (${b.reason})`,
        title: `매수 후보 ${p.candidates.length}종목이 모두 차단됨`,
        sub: `사유 ${b.reason} · 새 매수가 나가지 않는 상태`,
      });
    }
  }

  const failedSections: Array<[keyof ReportCoverage, string, ReportSectionId]> = [
    ['holdings', '보유', 'r-hold'],
    ['signals', '매도 신호', 'r-sell'],
    ['candidates', '매수 후보', 'r-cand'],
    ['research', '리서치', 'r-res'],
  ];
  for (const [key, label, target] of failedSections) {
    if (cov[key] !== 'failed') continue;
    w.push({
      kind: 'section_failed', severity: 'e', target,
      tg: `${label} 정보를 읽지 못함 — 0건이 아님`,
      title: `${label} 정보를 읽지 못했습니다`,
      sub: '조회 실패 · 0건이 아닙니다',
    });
  }
  return w;
}

/** 처음부터 펼칠 섹션 — 확인 필요 항목이 가리키는 섹션만(가이드 §3 기본 펼침 규칙). */
export function initiallyOpenSections(warnings: readonly ReportWarning[]): Set<ReportSectionId> {
  return new Set(warnings.map((w) => w.target).filter((t) => t !== 'r-asset'));
}

/** 리서치 「매수 고려」로 판정된 항목만 */
export function researchBuyItems(p: TradeReportPayload): ReportResearchItem[] {
  return p.research.items.filter((i) => i.action === 'buy');
}

/** 리서치 매도 판단이 「매도 고려」인 보유 종목 수 */
export function sellConsiderCount(p: TradeReportPayload): number {
  return p.holdings.filter((h) => h.sellAction === 'sell').length;
}

// ─── 텔레그램 요약 조립 ─────────────────────────────────────────────────────

export interface SummaryLine { text: string; bold?: boolean }

export interface ReportSummary {
  /** 공통 래퍼 제목 인자 — 래퍼가 `[태그] ℹ️ ` 를 앞에, `🕐 …` 를 뒤에 붙인다 */
  title: string;
  /** 본문 줄(빈 줄 포함). 서식은 `bold` 표시만 — 채널별 변환은 아래 render 함수 */
  lines: SummaryLine[];
  warnings: ReportWarning[];
}

/**
 * 요약 메시지 조립(가이드 §1). 순서: 총자산 → 체결 → 확인 필요 → 보유 → 리서치.
 * 줄 수는 목표(약 12~13줄)일 뿐 코드로 자르지 않는다 — 확인 필요는 잘리면 안 된다.
 */
export function formatReportSummary(p: TradeReportPayload, opts: { test?: boolean } = {}): ReportSummary {
  const short = buildShortNamer(reportNamedEntries(p));
  const warnings = computeReportWarnings(p, short);
  const n = warnings.length;

  const baseTitle = `거래 리포트 · ${fmtKstShort(p.rangeEnd)} (최근 ${rangeHours(p)}시간)${n > 0 ? ` · ⚠️ 확인 ${n}` : ''}`;
  const title = opts.test ? `[테스트] ${baseTitle}` : baseTitle;

  // 1. 총자산
  const money: SummaryLine[] = [];
  const { totalKRW, baselineKRW } = p.asset;
  if (totalKRW == null || p.coverage.asset === 'failed') {
    // 🔴 0원·−100% 로 쓰지 않는다(T-056)
    money.push({ text: `💰 총자산 조회 불가${baselineKRW != null && baselineKRW > 0 ? ` (기간 시작 ${fmtWon(baselineKRW)})` : ''}` });
  } else if (baselineKRW != null && baselineKRW > 0) {
    const delta = totalKRW - baselineKRW;
    money.push({ text: `💰 총자산 ${fmtWon(totalKRW)}  (${fmtSignedPct((delta / baselineKRW) * 100)}, ${fmtSignedWon(delta)})` });
  } else {
    money.push({ text: `💰 총자산 ${fmtWon(totalKRW)}  (기간 시작 스냅샷 없음)` });
  }

  // 2. 체결
  const t = p.trade;
  if (t.buys === 0 && t.sells === 0) {
    money.push({ text: '🔁 체결 없음 (매수 0 · 매도 0)' });
  } else {
    money.push({ text: `🔁 체결 매수 ${t.buys}건 ${fmtWon(t.buysAmountKRW)} · 매도 ${t.sells}건 ${fmtWon(t.sellsAmountKRW)}` });
    if (t.sells > 0) money.push({ text: `   실현 손익 ${realizedPnlText(t)}` });
  }

  // 3. 확인 필요
  const warn: SummaryLine[] = n > 0
    ? [{ text: `⚠️ 확인 필요 ${n}`, bold: true }, ...warnings.map((x) => ({ text: `• ${x.tg}` }))]
    : [{ text: '✅ 확인 필요 없음' }];

  // 4·5. 보유·리서치
  const tail: SummaryLine[] = [];
  if (p.coverage.holdings === 'ok') {
    tail.push({
      text: p.holdings.length === 0
        ? '📦 보유 없음'
        : `📦 보유 ${p.holdings.length}종목 — 손절 임박 ${stopNearHoldings(p).length} · 매도 고려 ${sellConsiderCount(p)}`,
    });
  }
  const buys = researchBuyItems(p);
  if (p.coverage.research === 'ok' && buys.length > 0) {
    tail.push({ text: `🔬 매수 고려 ${buys.length}종목 (리서치 참고용): ${buys.map((i) => short(i.symbol, i.name)).join(' · ')}` });
  }

  const lines: SummaryLine[] = [];
  for (const block of [money, warn, tail]) {
    if (block.length === 0) continue;
    if (lines.length > 0) lines.push({ text: '' });
    lines.push(...block);
  }
  return { title, lines, warnings };
}

/** 실현 손익 표기 — T-086 규칙(원가 미상은 숫자로 얼버무리지 않는다) */
export function realizedPnlText(t: Pick<ReportTrade, 'lifoPnlKRW' | 'matchedSellCount' | 'unmatchedSellCount'>): string {
  if (t.unmatchedSellCount > 0 && !(t.matchedSellCount > 0)) return '원가 미상';
  return `${fmtSignedWon(t.lifoPnlKRW)}${t.unmatchedSellCount > 0 ? ' (일부 원가 미상)' : ''}`;
}

/** 슬랙 mrkdwn — 굵게는 `*…*`. 이스케이프는 하지 않는다(기존 리포트가 슬랙에 보내던 방식 그대로). */
export function summaryToMrkdwn(lines: readonly SummaryLine[]): string {
  return lines.map((l) => (l.bold && l.text ? `*${l.text}*` : l.text)).join('\n');
}

/** 텔레그램 HTML(parse_mode=HTML) — 이름·사유는 `&`·`<`·`>` 이스케이프 후 굵게만 `<b>`. */
export function summaryToTelegramHtml(lines: readonly SummaryLine[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return lines.map((l) => (l.bold && l.text ? `<b>${esc(l.text)}</b>` : esc(l.text))).join('\n');
}

/** 보관·화면용 평문 */
export function summaryToPlain(lines: readonly SummaryLine[]): string {
  return lines.map((l) => l.text).join('\n');
}

// ─── 링크 ───────────────────────────────────────────────────────────────────

/** 승인 메시지(`approval-message.ts`)와 같은 https 검사 */
export const APP_URL_PATTERN = /^https:\/\/[^\s]+$/i;
export const REPORT_BUTTON_TEXT = '👉 앱에서 자세히 보기';

/** `{app_public_url}?open=report&id={id}` — 앱 루트 App Link + 쿼리. 조건이 안 맞으면 null(버튼 생략). */
export function reportLinkUrl(appUrl: string | null | undefined, reportId: number | null | undefined): string | null {
  if (!appUrl || !APP_URL_PATTERN.test(appUrl)) return null;
  if (reportId == null || !Number.isSafeInteger(reportId) || reportId <= 0) return null;
  try {
    const u = new URL(appUrl);
    u.searchParams.set('open', 'report');
    u.searchParams.set('id', String(reportId));
    return u.toString();
  } catch {
    return null;
  }
}

/** 회차 id 형식 — 불투명 양의 정수(최대 15자리). 통과하면 숫자, 아니면 null. */
export function parseReportId(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,14}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * 홈 `/` 의 `?open=report&id=<숫자>` → `/report?id=<숫자>`. 그 밖의 값은 무시(null) — 임의 경로로 보내지 않는다.
 */
export function reportRedirectTarget(params: { get(name: string): string | null }): string | null {
  if (params.get('open') !== 'report') return null;
  const id = parseReportId(params.get('id'));
  return id == null ? null : `/report?id=${id}`;
}

/** 저장된 payload JSON 을 읽는다 — 모양이 다르면 null(화면은 「상세 데이터를 읽지 못함」). */
export function parseReportPayload(raw: unknown): TradeReportPayload | null {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<TradeReportPayload>;
  if (o.schemaVersion !== REPORT_PAYLOAD_SCHEMA_VERSION) return null;
  if (!o.coverage || !o.asset || !o.trade || !Array.isArray(o.sellSignals) || !Array.isArray(o.holdings)
    || !Array.isArray(o.candidates) || !o.research || !Array.isArray(o.research.items)
    || typeof o.rangeStart !== 'string' || typeof o.rangeEnd !== 'string') return null;
  return o as TradeReportPayload;
}

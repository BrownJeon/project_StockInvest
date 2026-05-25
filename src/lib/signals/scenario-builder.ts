/**
 * AI 분석 결과를 시나리오 카드 구조로 변환.
 * createSignal() 내에서 indicators.ai.scenario 필드로 저장하는 데 사용.
 *
 * DB 컬럼 추가 (수동 마이그레이션):
 * -- ALTER TABLE signals ADD COLUMN scenario_grade VARCHAR(4) NULL;
 * -- ALTER TABLE signals ADD COLUMN scenario_source ENUM('ai','user') DEFAULT 'ai';
 */

export type ScenarioGrade = 'A' | 'B+' | 'B' | 'C';

export interface ScenarioEntry {
  /** 진입 트리거 설명 */
  trigger: string;
  /** 진입 가격 구간 — "66800~67200" 형식, entry-watcher가 파싱 */
  price_zone: string;
  /** 진입 조건 추가 설명 (optional) */
  condition?: string;
}

export interface ScenarioExit {
  /** 목표 수익률 하단 (%) — 도달 시 즉시 익절 */
  target_pct?: number;
  /** 목표 수익률 상단 (%) — 갭 상승 시 하드 캡. 없으면 target_pct와 동일 */
  target_pct_hi?: number;
  /** 손절 수익률 하단 (%) — 음수, 도달 시 즉시 손절 */
  stop_pct?: number;
  /** 손절 수익률 상단 (%) — 음수, 갭 하락 시 절대 하드 스탑. 없으면 stop_pct와 동일 */
  stop_pct_hi?: number;
  /** 트레일링 스탑 활성화 수익률 (%) */
  trailing_activate_pct?: number;
  /** 보유 마감기한 (YYYY-MM-DD). 없으면 holding_days 문자열 기반 추정 */
  holding_deadline?: string;
  /** 보유 예상 기간 레이블 (표시용) */
  holding_days: string;
}

export interface ScenarioCard {
  grade: ScenarioGrade;
  entry: ScenarioEntry;
  exit: ScenarioExit;
  risk_factors: string[];
  why_now: string;
  context: string;
  /** Expected Value (0~1 scale) */
  ev: number;
}

/** EV 수치로 등급 분류 */
export function gradeFromEv(ev: number): ScenarioGrade {
  if (ev >= 0.6) return 'A';
  if (ev >= 0.4) return 'B+';
  if (ev >= 0.2) return 'B';
  return 'C';
}

/**
 * ai-filter 결과(indicators.ai)를 ScenarioCard로 변환.
 * indicators.ai 구조가 없거나 EV 계산값이 없으면 null 반환.
 *
 * 호출처: createSignal() — indicators.ai가 존재할 때만 실행.
 */
export function buildScenarioFromAiResult(
  aiResult: Record<string, unknown>,
  currentPrice: number,
): ScenarioCard | null {
  // EV는 evPct(%) 또는 ev(0~1 scale) 중 하나를 허용
  const rawEvPct = typeof aiResult['evPct'] === 'number' ? aiResult['evPct'] : null;
  const rawEv    = typeof aiResult['ev']    === 'number' ? aiResult['ev']    : null;

  // evPct는 % 단위 (예: 38 → 0.38), ev는 0~1 스케일
  let ev: number | null = null;
  if (rawEv !== null) {
    ev = rawEv;
  } else if (rawEvPct !== null) {
    ev = rawEvPct / 100;
  }
  if (ev === null || !Number.isFinite(ev)) return null;

  const grade = gradeFromEv(ev);

  // 진입 구간: ATR 또는 고정 0.3% 편차로 ±zone 계산
  const atr   = typeof aiResult['atr14'] === 'number' ? aiResult['atr14'] : null;
  const delta = atr != null ? Math.round(atr * 0.5) : Math.round(currentPrice * 0.003);
  const lo    = Math.round(currentPrice - delta);
  const hi    = Math.round(currentPrice + delta);
  const price_zone = `${lo}~${hi}`;

  // 진입 트리거: ai.reasoning 또는 기본 문구
  const reasoning = typeof aiResult['reasoning'] === 'string' ? aiResult['reasoning'] : '';
  const trigger   = reasoning.length > 0
    ? reasoning.slice(0, 120)
    : '기술적 진입 구간 도달 시 매수';

  // 목표·손절: pWin/rWin/rLoss 값 활용
  const pWin  = typeof aiResult['pWin']  === 'number' ? aiResult['pWin']  : 0.5;
  const rWin  = typeof aiResult['rWin']  === 'number' ? aiResult['rWin']  : 1.4;
  const rLoss = typeof aiResult['rLoss'] === 'number' ? aiResult['rLoss'] : 1.0;

  const target_pct           = Math.round(rWin * 100) / 100;
  const stop_pct             = -Math.abs(Math.round(rLoss * 100) / 100);
  const trailing_activate_pct = Math.round(target_pct * 0.8 * 100) / 100;

  // 보유 기간 추정: EV·pWin 기반
  const holding_days = pWin >= 0.65 ? '1~2일' : pWin >= 0.55 ? '1~3일' : '2~5일';

  // 리스크 요인: ai.warnings 또는 기본
  const rawWarnings = Array.isArray(aiResult['warnings']) ? aiResult['warnings'] as unknown[] : [];
  const risk_factors: string[] = rawWarnings
    .filter((w): w is string => typeof w === 'string')
    .slice(0, 3);
  if (risk_factors.length === 0) risk_factors.push('진입 구간 이탈 시 손절 필수');

  const why_now = reasoning.length > 0
    ? reasoning.slice(0, 200)
    : `EV=${(ev * 100).toFixed(1)}% — 기술적 조건 충족`;

  const context = typeof aiResult['context'] === 'string'
    ? aiResult['context']
    : `P(win)=${(pWin * 100).toFixed(0)}% · R/R=${rWin.toFixed(1)}:${rLoss.toFixed(1)}`;

  return {
    grade,
    entry: { trigger, price_zone },
    exit: { target_pct, stop_pct, trailing_activate_pct, holding_days },
    risk_factors,
    why_now,
    context,
    ev: Math.round(ev * 1000) / 1000,
  };
}

/**
 * price_zone 문자열 ("66800~67200") → [low, high] 파싱.
 * entry-watcher cron에서 사용.
 * 파싱 실패 시 null 반환.
 */
export function parsePriceZone(priceZone: string): [number, number] | null {
  const parts = priceZone.split('~');
  if (parts.length !== 2) return null;
  const lo = Number(parts[0].trim());
  const hi = Number(parts[1].trim());
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0) return null;
  return [lo, hi];
}

export interface SplitSlice {
  index: number;        // 1-based
  priceZoneStr: string; // "70810~71540"
  zoneLo: number;
  zoneHi: number;
  priceMid: number;
  amountKRW?: number;
  qty?: number;
}

function domesticTick(price: number): number {
  if (price < 2000)   return 1;
  if (price < 5000)   return 5;
  if (price < 20000)  return 10;
  if (price < 50000)  return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}

function roundToTick(price: number): number {
  const tick = domesticTick(price);
  return Math.round(price / tick) * tick;
}

export function calcSplitSlices(
  direction: 'buy' | 'sell',
  currentPrice: number,
  entryZonePct: [number, number],
  splits: number,
  amountKRW?: number,
  holdingQty?: number,
): SplitSlice[] {
  if (!currentPrice || currentPrice <= 0 || splits < 1) return [];

  const [pctLo, pctHi] = entryZonePct;
  const range = pctHi - pctLo;
  const step = range / splits;
  const slices: SplitSlice[] = [];

  let prevZoneHi: number | undefined;

  for (let i = 0; i < splits; i++) {
    // 매수·매도 모두 index=1이 최저가 구간 (단일 공식)
    const sliceLoPct = pctLo + i * step;
    const sliceHiPct = pctLo + (i + 1) * step;

    let zoneLo = roundToTick(currentPrice * (1 + sliceLoPct / 100));
    const zoneHi = roundToTick(currentPrice * (1 + sliceHiPct / 100));

    // 슬라이스 간 1 tick gap: 직전 슬라이스 zoneHi와 겹치면 +1 tick
    if (prevZoneHi !== undefined && zoneLo <= prevZoneHi) {
      zoneLo = prevZoneHi + domesticTick(prevZoneHi);
    }
    prevZoneHi = zoneHi;

    const priceMid = roundToTick((zoneLo + zoneHi) / 2);
    const priceZoneStr = `${zoneLo}~${zoneHi}`;

    // 금액 배분: 마지막 슬라이스에 나머지 추가
    let sliceAmount: number | undefined;
    if (amountKRW != null && amountKRW > 0) {
      const base = Math.floor(amountKRW / splits);
      const remainder = amountKRW - base * splits;
      sliceAmount = i === splits - 1 ? base + remainder : base;
    }

    // 수량 배분: 마지막 슬라이스에 나머지 추가 (매수 금액 배분과 동일 방향)
    let sliceQty: number | undefined;
    if (holdingQty != null && holdingQty > 0) {
      const base = Math.floor(holdingQty / splits);
      const remainder = holdingQty - base * splits;
      sliceQty = i === splits - 1 ? base + remainder : base;
    }

    slices.push({ index: i + 1, priceZoneStr, zoneLo, zoneHi, priceMid, amountKRW: sliceAmount, qty: sliceQty });
  }

  return slices;
}

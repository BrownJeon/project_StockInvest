/**
 * T-074 — 포트폴리오 스냅샷 해석·연속 단계·USD 예수금 왕복(X) 탐지 (순수 함수, DB 없음).
 *
 * 입력은 `portfolio_snapshots` 의 (id, ts, total_krw, positions) 행 그대로다(읽기 전용 — 이 모듈은 아무것도 쓰지 않는다).
 * positions JSON 구조(`src/app/api/cron/portfolio-snapshot/route.ts` 116~198, 운영 행 키 실측 10-23):
 *   { currency:'KRW', qty: 원화 free, price: 1, value_krw, locked: 결제 대기 }
 *   { currency:'USD', qty: 달러 예수금, price: 그 틱 환율, value_krw, locked: 0, src, ustl_sll_amt_smtl? }
 *   { currency:'<종목>', qty, price: 원화 환산 단가, value_krw }
 * 해석 방식은 T-069 `scripts/profit-engine/holdings-core.mjs` `parseSnapshot`·`decomposeStep` 과 같다(원화 변화 = free+locked 변화,
 * 달러 변화 = 수량 변화, 둘 다 양쪽에 행이 있을 때만).
 *
 * USD 왕복(Analyst Q3·Q5): 달러 예수금이 영업일마다 16~17시 KST 에 X 만큼 빠졌다가 06~07시에 돌아오고, X 는 하루 약 +$0.03 씩 늘어난다.
 * T-069 R2(`detectUsdFlips`)는 0 ↔ X 만 보지만 10-23 부터 Y ↔ Y+X 모양이라 그 규칙으로는 못 잡는다 → **변화량 크기로 묶는다**:
 * 보유·원화 불변 단계의 |ΔUSD| 를 시간순으로 훑어, 직전 묶음 크기와 `usdFlipTolUsd + usdFlipDriftUsdPerDay × 경과일` 안이면 같은 X 로 본다.
 * 묶음이 `usdFlipMinFlips` 단계 이상이고 + 와 − 가 모두 있으면 왕복 패턴 — 그 단계들은 '기록 안 된 입출금 후보'에서 뺀다.
 * 한계: 실제 입출금이 같은 크기로 들어왔다 나가면(예: $500 입금 뒤 $500 출금, 둘 다 보유·원화 불변) 왕복으로 보여 후보에서 빠진다.
 * 매칭(사용자가 기록한 행)에는 이 판정을 쓰지 않는다 — 기록된 돈은 기록대로 맞춰 본다.
 */
import type { UsdGapHint } from './types';
import { RULE, type LedgerRules } from './rules';
import { dbDatetimeToWallMs, DAY_MS, formatKstWall, parseKstWall } from './kst';
import { toCents, usdToKrw } from './compute';

export interface SnapshotRowLike {
  id: unknown;
  ts: unknown;
  total_krw: unknown;
  positions: unknown;
}

export interface LedgerSnapshot {
  id: number;
  /** KST 벽시계 'YYYY-MM-DD HH:mm:ss' */
  ts: string;
  tsMs: number;
  totalKrw: number;
  /** 원화 예수금 — free(총액에 들어가는 몫)·locked(결제 대기) */
  krw: { free: number; locked: number } | null;
  /** 달러 예수금 — 센트, 그 틱 환율 */
  usd: { cents: number; fx: number | null } | null;
  /** 종목 → 수량 */
  holdings: Record<string, number>;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** 스냅샷 1행 해석. id·ts·total_krw 가 없으면 null(쓰지 않는다) */
export function parseSnapshotRow(row: SnapshotRowLike): LedgerSnapshot | null {
  const id = num(row.id);
  const tsMs = dbDatetimeToWallMs(row.ts);
  const total = num(row.total_krw);
  if (id == null || tsMs == null || total == null) return null;
  let raw: unknown = row.positions;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  const list = Array.isArray(raw) ? raw : [];
  let krw: LedgerSnapshot['krw'] = null;
  let usd: LedgerSnapshot['usd'] = null;
  const holdings: Record<string, number> = {};
  for (const p of list as Record<string, unknown>[]) {
    if (!p || typeof p.currency !== 'string' || p.currency === '') continue;
    const cur = p.currency;
    if (cur === 'KRW') {
      krw = { free: Math.round(num(p.qty) ?? num(p.value_krw) ?? 0), locked: Math.round(num(p.locked) ?? 0) };
      continue;
    }
    // 크론이 기록한 스냅샷 positions 의 USD 행(달러 예수금) — kill-switch.ts 와 같은 성격, Balance[] 아님. 울타리 허용 목록에 사유와 함께 있다
    if (p.currency === 'USD') {
      const fx = num(p.price);
      usd = { cents: toCents(num(p.qty) ?? 0), fx: fx != null && fx > 0 ? fx : null };
      continue;
    }
    const qty = num(p.qty);
    if (qty == null || qty <= 0) continue;
    holdings[cur] = qty;
  }
  return { id, ts: formatKstWall(tsMs), tsMs, totalKrw: Math.round(total), krw, usd, holdings };
}

/** 시각순(같으면 id 순) 정렬 + 해석 실패 행 제외 */
export function parseSeries(rows: readonly SnapshotRowLike[]): LedgerSnapshot[] {
  const out: LedgerSnapshot[] = [];
  for (const r of rows) {
    const s = parseSnapshotRow(r);
    if (s) out.push(s);
  }
  out.sort((a, b) => a.tsMs - b.tsMs || a.id - b.id);
  return out;
}

export function sameHoldings(a: LedgerSnapshot, b: LedgerSnapshot): boolean {
  const ka = Object.keys(a.holdings);
  const kb = Object.keys(b.holdings);
  if (ka.length !== kb.length) return false;
  return ka.every((s) => s in b.holdings && Math.abs(a.holdings[s] - b.holdings[s]) < 1e-9);
}

export interface SnapshotStep {
  prev: LedgerSnapshot;
  cur: LedgerSnapshot;
  /** 원화 현금 변화(free+locked, 원) — 양쪽에 KRW 행이 있을 때만 */
  dKrw: number | null;
  /** 달러 현금 변화(센트) — 양쪽에 USD 행이 있을 때만 */
  dUsdCents: number | null;
  /** 보유 종목·수량이 같은가 */
  holdingsSame: boolean;
}

export function buildSteps(series: readonly LedgerSnapshot[]): SnapshotStep[] {
  const steps: SnapshotStep[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const cur = series[i];
    steps.push({
      prev, cur,
      dKrw: prev.krw && cur.krw ? (cur.krw.free + cur.krw.locked) - (prev.krw.free + prev.krw.locked) : null,
      dUsdCents: prev.usd && cur.usd ? cur.usd.cents - prev.usd.cents : null,
      holdingsSame: sameHoldings(prev, cur),
    });
  }
  return steps;
}

/**
 * 원화·달러가 반대 방향으로 움직였고 내재 환율이 그 틱 환율의 ±fxWarnPct 안이면 '환전처럼 보이는' 단계.
 * 후보 탐지(환전은 입출금이 아니다)와 매칭(입금을 환전으로 잘못 맞추지 않기 — Analyst Q3 #2)에 쓴다.
 */
export function isExchangeLike(dKrw: number | null, dUsdCents: number | null, fx: number | null, rules: LedgerRules = RULE): boolean {
  if (dKrw == null || dUsdCents == null || fx == null || !(fx > 0)) return false;
  if (Math.abs(dKrw) < rules.tolKrw || Math.abs(dUsdCents) < rules.tolUsd * 100) return false;
  if ((dKrw > 0) === (dUsdCents > 0)) return false;
  const implied = Math.abs(dKrw) / (Math.abs(dUsdCents) / 100);
  return (Math.abs(implied - fx) / fx) * 100 <= rules.fxWarnPct;
}

export interface UsdFlipResult {
  /** 왕복 패턴에 속한 단계 (cur 스냅샷 id) */
  flipStepIds: Set<number>;
  /** 진행 중인 패턴 — 최신 스냅샷에서 X 가 빠져 있으면 gapHint */
  gapHint: UsdGapHint | null;
  patterns: { xUsd: number; steps: number; lastTs: string; lastSign: 1 | -1 }[];
}

/** Y ↔ Y+X 왕복 탐지 (위 머리말). series 의 마지막 행이 '최신 스냅샷' 이다 */
export function detectUsdFlips(steps: readonly SnapshotStep[], rules: LedgerRules = RULE): UsdFlipResult {
  type Group = { lastCents: number; lastMs: number; ids: number[]; plus: number; minus: number; lastSign: 1 | -1; lastTs: string };
  const groups: Group[] = [];
  for (const st of steps) {
    if (!st.holdingsSame || st.dUsdCents == null || st.dKrw == null) continue;
    if (Math.abs(st.dKrw) > rules.tolKrw) continue;          // 원화가 움직였으면 환전·입출금이지 X 가 아니다
    const m = Math.abs(st.dUsdCents);
    if (m < rules.tolUsd * 100) continue;
    const sign: 1 | -1 = st.dUsdCents > 0 ? 1 : -1;
    let g: Group | undefined;
    for (let i = groups.length - 1; i >= 0; i--) {
      const c = groups[i];
      const days = Math.max(0, (st.cur.tsMs - c.lastMs) / DAY_MS);
      const tolCents = Math.round((rules.usdFlipTolUsd + rules.usdFlipDriftUsdPerDay * Math.ceil(days)) * 100);
      if (Math.abs(m - c.lastCents) <= tolCents) { g = c; break; }
    }
    if (!g) {
      g = { lastCents: m, lastMs: st.cur.tsMs, ids: [], plus: 0, minus: 0, lastSign: sign, lastTs: st.cur.ts };
      groups.push(g);
    }
    g.ids.push(st.cur.id);
    if (sign > 0) g.plus++; else g.minus++;
    g.lastCents = m;
    g.lastMs = st.cur.tsMs;
    g.lastSign = sign;
    g.lastTs = st.cur.ts;
  }
  const flipStepIds = new Set<number>();
  const patterns: UsdFlipResult['patterns'] = [];
  for (const g of groups) {
    if (g.ids.length < rules.usdFlipMinFlips || g.plus === 0 || g.minus === 0) continue;
    for (const id of g.ids) flipStepIds.add(id);
    patterns.push({ xUsd: g.lastCents / 100, steps: g.ids.length, lastTs: g.lastTs, lastSign: g.lastSign });
  }
  let gapHint: UsdGapHint | null = null;
  const latest = steps.length ? steps[steps.length - 1].cur : null;
  if (latest && latest.usd?.fx) {
    const active = patterns
      .filter((p) => latest.tsMs - (parseKstWall(p.lastTs) ?? -Infinity) <= rules.usdFlipActiveDays * DAY_MS)
      .sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1))[0];
    if (active && active.lastSign < 0) {
      gapHint = { usd: active.xUsd, krw: usdToKrw(active.xUsd, latest.usd.fx), sinceTs: active.lastTs };
    }
  }
  return { flipStepIds, gapHint, patterns };
}

/**
 * T-070 과거 시그널 사후검증 — 계산 본체(순수 함수, DB·네트워크 없음). 실행 래퍼는 같은 폴더의 signal-postmortem.mjs.
 *
 * CommonJS 로 둔 이유: .mjs 실행기(node 직접 실행)와 jest 시험(profit-engine __tests__ 의 signal-postmortem-core.test.ts)이
 * 같은 파일을 그대로 불러 쓰게 하려고(빌드 단계·새 의존성 없이). 이 파일은 앱 모듈·DB 드라이버를 불러오지 않는다 — 질의 함수를 주입받는다.
 *
 * 정의(T-064 §3·§5.3·§6.4, T-070 범위 4):
 *  - 대상: 최근 N일 **매수** 시그널(전 상태). 같은 종목 반복 발화는 에피소드(종목별 episodeDays 일 안의 최초 발화)로 센다.
 *  - D0 = 시그널 생성 시각의 거래소 현지 날짜(KST → 미국은 ET). D0 봉 = 그날 이하 가장 최근 확정 봉. D+k = D0 봉 다음 k번째 봉.
 *  - 가격 단위: 시그널 가격 ÷ D0 종가 비율로 판별 — [0.5, 2] 면 봉과 같은 통화, 미국 종목이 [600, 3000] 이면 KRW(환산값).
 *    KRW 면 USD 로 되돌린다: ① 시그널 시각 이전 72h 안의 가장 최근 스냅샷 USD 행 환율(시그널 뒤 스냅샷은 쓰지 않음) ② 같은 날 미국 시그널들의 (가격 ÷ D0 종가) 중앙값(≥3건)
 *    ③ 그 시그널 자신의 비율(= D0 종가로 진입했다고 보는 것과 같다). 환율 이력이 없어서 쓰는 역산이다(T-064 §5.3).
 *  - would_fill: 진입 가능 기간(D0 다음 봉 ~ 만료 현지 날짜) 안에 저가 ≤ 시그널 가격인 봉이 있는가. 체결가 = min(가격, 그날 시가).
 *    만료가 D0 당일이면 일봉으로는 판정할 수 없어 null(D+1 프록시로 따로 센다).
 *  - 수익: 체결 봉을 1일째로 h일째 종가 청산(h=1,3,5,10). MAE = 체결 후 10봉 최저가 ÷ 체결가 − 1.
 *  - 비용(왕복): 미국 0.65%(손절 시장가 가정 0.75%), 국내 0.33%(0.43%). 비용은 수익률에서 뺀다.
 *  - 기업행위 의심(corp_action_suspect) 봉이 D0~D+10 에 있으면 수익 통계에서 제외하고 건수를 보고한다.
 */
'use strict';

const COSTS = {
  US: { roundTrip: 0.0065, stop: 0.0075 },
  KR: { roundTrip: 0.0033, stop: 0.0043 },
};
const HORIZONS = [1, 3, 5, 10];
const MAE_BARS = 10;
const SAME_UNIT = [0.5, 2];
const KRW_PER_USD = [600, 3000];
const MISS_RAN_UP = 0.02;
const PRICE_BANDS_KRW = [50_000, 100_000, 200_000, 500_000];

/** SELECT·SHOW·SET SESSION TRANSACTION READ ONLY 외의 문장을 거부한다(여러 문장 금지). */
function assertReadOnlySql(sql) {
  const s = String(sql).trim();
  if (s.replace(/;\s*$/, '').includes(';')) throw new Error('read-only guard: multiple statements');
  if (/^SET SESSION TRANSACTION READ ONLY$/i.test(s.replace(/;\s*$/, ''))) return;
  if (!/^(SELECT|SHOW)\b/i.test(s)) throw new Error(`read-only guard: only SELECT/SHOW allowed — ${s.slice(0, 40)}`);
  if (/\b(INTO\s+OUTFILE|INTO\s+DUMPFILE|FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE)\b/i.test(s)) throw new Error('read-only guard: locking/file clause');
}

function marketOfSymbol(symbol) {
  if (/^[A-Z]{3}:[A-Z][A-Z0-9.]*$/.test(symbol)) return 'US';
  if (/^\d{6}$/.test(symbol)) return 'KR';
  return null;
}

/** 'YYYY-MM-DD HH:MM:SS'(KST 벽시계) 또는 Date → epoch ms */
function kstToMs(v) {
  if (v instanceof Date) return v.getTime();
  const s = String(v).trim().replace(' ', 'T');
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}+09:00`);
}

const FMT = {};
function localDateOf(v, market) {
  const tz = market === 'US' ? 'America/New_York' : 'Asia/Seoul';
  FMT[tz] = FMT[tz] || new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return FMT[tz].format(new Date(kstToMs(v)));
}

function parsePriceZone(s) {
  if (typeof s !== 'string') return null;
  const parts = s.split('~');
  if (parts.length !== 2) return null;
  const lo = Number(parts[0].trim());
  const hi = Number(parts[1].trim());
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0) return null;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

/** 같은 종목 episodeDays 일 안의 반복 발화를 첫 발화에 묶는다. 입력 순서와 무관. */
function buildEpisodes(signals, episodeDays) {
  const win = episodeDays * 86_400_000;
  const sorted = [...signals].sort((a, b) => kstToMs(a.createdAt) - kstToMs(b.createdAt) || a.id - b.id);
  const lastStart = new Map();
  const out = new Map();
  for (const s of sorted) {
    const t = kstToMs(s.createdAt);
    const prev = lastStart.get(s.symbol);
    if (prev && t - prev.t < win) {
      out.set(s.id, { episodeId: prev.id, isStart: false });
    } else {
      lastStart.set(s.symbol, { t, id: s.id });
      out.set(s.id, { episodeId: s.id, isStart: true });
    }
  }
  return out;
}

/** 스냅샷 positions(JSON 배열) → 현금. KRW 행 qty = 원화 예수금, USD 행 value_krw·price(=환율). */
function cashFromPositions(positions) {
  let arr = positions;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = null; } }
  if (!Array.isArray(arr)) return { krw: null, usdValueKrw: null, fx: null };
  const krw = arr.find((p) => p && p.currency === 'KRW');
  const usd = arr.find((p) => p && p.currency === 'USD');
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    krw: krw ? n(krw.qty) : null,
    usdValueKrw: usd ? n(usd.value_krw) : null,
    fx: usd && n(usd.price) > 0 ? n(usd.price) : null,
  };
}

/** 오름차순 스냅샷 [{t, cash}] 에서 t 이하 가장 가까운 것(maxMs 이내). */
function snapshotBefore(snaps, t, maxMs) {
  let lo = 0, hi = snaps.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snaps[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best >= 0 && t - snaps[best].t <= maxMs ? snaps[best] : null;
}

/**
 * (Codex C2 지적4) 시그널 시각 **이하**의 스냅샷 중 USD 환율이 있는 가장 최근 것의 환율(maxMs 이내). 없으면 null.
 * 시그널 뒤의 스냅샷은 그 시점에 알 수 없던 값이라 쓰지 않는다(look-ahead 차단). 오름차순 snaps 에서 이진 탐색 후 뒤로 훑는다.
 */
function snapshotFxNear(snaps, t, maxMs) {
  let lo = 0, hi = snaps.length - 1, i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snaps[mid].t <= t) { i = mid; lo = mid + 1; } else hi = mid - 1;
  }
  for (; i >= 0 && t - snaps[i].t <= maxMs; i--) {
    if (snaps[i].cash.fx != null) return snaps[i].cash.fx;
  }
  return null;
}

function d0Index(bars, d0) {
  let lo = 0, hi = bars.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].tradeDate <= d0) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

function sma(bars, i, n) {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += bars[k].close;
  return s / n;
}

function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function mean(xs) {
  const a = xs.filter((x) => Number.isFinite(x));
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}
/** 평균 ± 1.96·표준오차 (독립 가정 — 같은 날·같은 섹터 군집은 반영 못 함, 리포트에 명시) */
function ci95(xs) {
  const a = xs.filter((x) => Number.isFinite(x));
  if (a.length < 2) return { n: a.length, mean: a.length ? a[0] : null, lo: null, hi: null };
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
  const se = Math.sqrt(v / a.length);
  return { n: a.length, mean: m, lo: m - 1.96 * se, hi: m + 1.96 * se };
}
function quantile(xs, q) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

/**
 * (R-4a) 날짜 군집 구간 — 평균의 군집 강건 표준오차(같은 군집 안 잔차 합의 제곱합, G/(G−1) 보정).
 * 과매도 시그널은 같은 날·같은 주 하락장에 몰려 독립이 아니다. 군집 키는 D0 가 속한 주(월요일 날짜).
 * 임계값은 t 분포(자유도 G−1) — 군집이 적으면 1.96 보다 넓다.
 */
function clusterCi95(xs, keys) {
  const pairs = xs.map((x, i) => [x, keys[i]]).filter(([x]) => Number.isFinite(x));
  const n = pairs.length;
  if (!n) return { n: 0, clusters: 0, mean: null, lo: null, hi: null };
  const m = pairs.reduce((a, [x]) => a + x, 0) / n;
  const sums = new Map();
  for (const [x, k] of pairs) sums.set(k, (sums.get(k) || 0) + (x - m));
  const G = sums.size;
  if (G < 2) return { n, clusters: G, mean: m, lo: null, hi: null };
  let ss = 0;
  for (const v of sums.values()) ss += v * v;
  const se = Math.sqrt((G / (G - 1)) * ss) / n;
  const t = tCrit95(G - 1);
  return { n, clusters: G, mean: m, lo: m - t * se, hi: m + t * se };
}

/** t 분포 양측 95% 임계값(자유도 = 군집 수 − 1). 군집이 적을 때 1.96 보다 넓게 잡는다(R-4r). */
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131,
  2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
function tCrit95(df) {
  if (df < 1) return Infinity;
  if (df <= 30) return T95[df - 1];
  if (df <= 60) return 2.0;
  if (df <= 120) return 1.98;
  return 1.96;
}

/** 'YYYY-MM-DD' 가 속한 주의 월요일 */
function weekKey(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const FMT_MIN = {};
/** 거래소 현지 시각(분) */
function localMinutesOf(v, market) {
  const tz = market === 'US' ? 'America/New_York' : 'Asia/Seoul';
  FMT_MIN[tz] = FMT_MIN[tz] || new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = Object.fromEntries(FMT_MIN[tz].formatToParts(new Date(kstToMs(v))).map((x) => [x.type, x.value]));
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
}
/** 정규장 마감(현지 분) — 이보다 앞에 만든 시그널은 그날 종가를 몰랐다 */
const SESSION_CLOSE_MIN = { KR: 15 * 60 + 30, US: 16 * 60 };
/** D0~D+10 사이 이 달력 일수보다 긴 빈틈이 있으면 D+k 가 달력과 어긋난다(R-4g) */
const BAR_GAP_DAYS = 9;
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * 같은 날 미국 시그널들의 (KRW 가격 ÷ D0 USD 종가) 중앙값 — 환율 역산(최소 3건).
 * @param items [{ market, d0, ratio }]
 */
function dailyFxMedians(items, minN = 3) {
  const by = new Map();
  for (const it of items) {
    if (it.market !== 'US' || !(it.ratio >= KRW_PER_USD[0] && it.ratio <= KRW_PER_USD[1])) continue;
    by.set(it.d0, [...(by.get(it.d0) || []), it.ratio]);
  }
  const out = new Map();
  for (const [d, rs] of by) if (rs.length >= minN) out.set(d, median(rs));
  return out;
}

function priceBandKrw(p) {
  if (!Number.isFinite(p)) return 'unknown';
  const edges = PRICE_BANDS_KRW;
  if (p < edges[0]) return `<${edges[0] / 1000}k`;
  for (let i = 1; i < edges.length; i++) if (p < edges[i]) return `${edges[i - 1] / 1000}k-${edges[i] / 1000}k`;
  return `>=${edges[edges.length - 1] / 1000}k`;
}

/**
 * 시그널 1건 평가.
 * @param s {id, symbol, market, strategy, status, price, amountKrw, createdAt, expiresAt, priceZone, consumedOrderId}
 * @param bars 오름차순 확정 봉 [{tradeDate, open, high, low, close, flags:[]}] (adj_stale/orphan 은 미리 뺀다)
 * @param ctx {fxForSignal(s, d0, ratio) → {fx, method}|null, cashAt(s) → number|null}
 */
function evaluateSignal(s, bars, ctx) {
  const market = s.market;
  const out = {
    id: s.id, symbol: s.symbol, market, strategy: s.strategy || '(none)', status: s.status,
    amountKrw: s.amountKrw, consumedOrderId: s.consumedOrderId == null ? null : s.consumedOrderId, state: 'ok',
  };
  const d0 = localDateOf(s.createdAt, market);
  out.d0 = d0;
  // H-G 와 H-A 는 일봉이 없어도 계산할 수 있는 부분이 있다
  out.cashAvailable = ctx.cashAt ? ctx.cashAt(s) : null;
  const setStructural = () => {
    out.structural = out.priceKrw != null && Number.isFinite(s.amountKrw) ? s.amountKrw < out.priceKrw : null;
    out.priceBand = priceBandKrw(out.priceKrw);
  };

  const i0 = bars.length ? d0Index(bars, d0) : -1;
  if (i0 < 0) {
    out.state = 'no_bars';
    // 일봉 없이 단위 추정: 국내는 원, 미국은 2026-04-28 이후 시그널 가격이 원화 환산값이다 — 600 이상이면 원으로 본다
    if (Number.isFinite(s.price) && s.price > 0) {
      if (market === 'KR') { out.unit = 'same'; out.priceKrw = s.price; }
      else if (s.price >= KRW_PER_USD[0]) { out.unit = 'krw_guess'; out.priceKrw = s.price; out.priceKrwEstimated = true; }
    }
    if (out.priceKrw === undefined) out.priceKrw = null;
    setStructural();
    return out;
  }
  const ref = bars[i0].close;
  const ratio = Number.isFinite(s.price) && s.price > 0 && ref > 0 ? s.price / ref : null;
  let unit = 'unknown';
  if (ratio != null && ratio >= SAME_UNIT[0] && ratio <= SAME_UNIT[1]) unit = 'same';
  else if (market === 'US' && ratio != null && ratio >= KRW_PER_USD[0] && ratio <= KRW_PER_USD[1]) unit = 'krw';
  out.unit = unit;
  out.ratio = ratio;
  if (unit === 'unknown') {
    out.state = 'unit_unknown';
    out.priceKrw = null;
    setStructural();
    return out;
  }
  let fx = 1;
  out.fxMethod = 'none';
  if (unit === 'krw') {
    const f = ctx.fxForSignal ? ctx.fxForSignal(s, d0, ratio) : null;
    fx = f ? f.fx : ratio;
    out.fxMethod = f ? f.method : 'signal_ratio_self';
  }
  out.fx = fx;
  const p = s.price / fx;                       // 봉과 같은 통화의 진입 가격
  out.entry = p;
  if (market === 'KR' || unit === 'krw') out.priceKrw = s.price;          // 시그널 가격이 이미 원화
  else {
    // 미국 + USD 가격(드묾): 원화 환산에 같은 날 환율 추정치를 쓴다
    const f = ctx.fxForSignal ? ctx.fxForSignal(s, d0, null) : null;
    out.priceKrw = f ? s.price * f.fx : null;
    out.priceKrwEstimated = out.priceKrw != null;            // 환율 추정치로 만든 원화 가격
  }
  setStructural();

  out.week = weekKey(d0);
  // 추세 조건(R-4f): 장 마감 전에 만든 시그널은 D0 종가를 몰랐다 → 전 거래일 종가 기준. 장 마감 뒤면 D0 종가.
  const intraday = bars[i0].tradeDate === d0 && localMinutesOf(s.createdAt, market) < SESSION_CLOSE_MIN[market];
  const ti = intraday ? i0 - 1 : i0;
  out.trendBasis = intraday ? 'prev_close' : 'd0_close';
  const ma60 = ti >= 0 ? sma(bars, ti, 60) : null;
  out.aboveMa60 = ma60 == null ? null : bars[ti].close > ma60;
  out.ret20 = ti >= 20 ? bars[ti].close / bars[ti - 20].close - 1 : null;
  // 결측 봉(R-4g): D0 봉이 시그널 날짜보다 너무 오래됐거나 D0~D+10 사이에 큰 빈틈이 있으면 D+k 가 달력과 어긋난다
  let gap = dayDiff(bars[i0].tradeDate, d0) > BAR_GAP_DAYS;
  for (let i = i0 + 1; !gap && i < Math.min(bars.length, i0 + MAE_BARS + 2); i++) {
    if (dayDiff(bars[i - 1].tradeDate, bars[i].tradeDate) > BAR_GAP_DAYS) gap = true;
  }
  out.barGap = gap;

  if (i0 + 1 >= bars.length) { out.state = 'no_forward_bars'; return out; }

  const d1 = bars[i0 + 1];
  out.gapD1 = d1.open != null ? d1.open / p - 1 : null;
  out.gapD1VsClose = d1.open != null ? d1.open / ref - 1 : null;
  out.fillD1 = (d1.low != null ? d1.low : d1.close) <= p;
  out.refRet = {};
  for (const k of HORIZONS) if (bars[i0 + k]) out.refRet[k] = bars[i0 + k].close / p - 1;

  // 진입 가능 기간
  const expDate = s.expiresAt ? localDateOf(s.expiresAt, market) : null;
  let w = [];
  for (let i = i0 + 1; i < bars.length; i++) {
    if (expDate == null ? i > i0 + 1 : bars[i].tradeDate > expDate) break;
    w.push(i);
  }
  out.windowBars = w.length;
  out.windowBasis = w.length ? 'window' : 'd1_proxy';
  if (!w.length) w = [i0 + 1];                  // 당일 만료: 일봉으로 판정 불가 → D+1 프록시(따로 센다)
  let fillIdx = -1;
  for (const i of w) {
    const lowI = bars[i].low != null ? bars[i].low : bars[i].close;
    if (lowI <= p) { fillIdx = i; break; }
  }
  out.wouldFill = out.windowBasis === 'window' ? fillIdx >= 0 : null;
  out.fillProxy = fillIdx >= 0;
  const lastW = w[w.length - 1];
  const minLow = Math.min(...w.map((i) => (bars[i].low != null ? bars[i].low : bars[i].close)));
  out.missBy = fillIdx >= 0 ? 0 : minLow / p - 1;           // 미체결이면 기간 최저가가 가격보다 몇 % 위였나
  out.endVsEntry = bars[lastW].close / p - 1;
  out.ranUp = fillIdx < 0 && out.missBy >= MISS_RAN_UP && out.endVsEntry >= MISS_RAN_UP;

  // 진입구간(AI 시나리오, KRW → 같은 통화)
  if (s.priceZone) {
    const lo = s.priceZone[0] / fx, hi = s.priceZone[1] / fx;
    out.zoneTouched = w.some((i) => (bars[i].low != null ? bars[i].low : bars[i].close) <= hi && (bars[i].high != null ? bars[i].high : bars[i].close) >= lo);
  } else out.zoneTouched = null;

  // 기업행위 의심 봉이 걸렸는가 — 통계에서 빼지 않고 따로 집계한다(R-4d: 미래 구간으로 거르면 ±30% 꼬리가 사라진다)
  out.corpTouched = bars.slice(i0, Math.min(bars.length, i0 + MAE_BARS + 2)).some((b) => (b.flags || []).includes('corp_action_suspect'));

  if (fillIdx >= 0) {
    const fb = bars[fillIdx];
    const fillPrice = Math.min(p, fb.open != null ? fb.open : p);
    out.fillPrice = fillPrice;
    out.ret = {};
    for (const h of HORIZONS) if (bars[fillIdx + h - 1]) out.ret[h] = bars[fillIdx + h - 1].close / fillPrice - 1;
    const seg = bars.slice(fillIdx, fillIdx + MAE_BARS);
    out.mae10 = seg.length >= MAE_BARS ? Math.min(...seg.map((b) => (b.low != null ? b.low : b.close))) / fillPrice - 1 : null;
  }
  return out;
}

function pct(x, d = 2) {
  return x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`;
}
function share(n, d) {
  return d ? n / d : null;
}

/** 수익 통계 묶음(에피소드 시작만). 결측 봉(barGap) 에피소드는 제외, 기업행위 의심은 포함(따로도 집계). 구간은 주 군집. */
function returnStats(evals) {
  const usable = evals.filter((e) => e.state === 'ok' && !e.barGap);
  const filled = usable.filter((e) => e.fillProxy && e.ret);
  const byH = {};
  for (const h of HORIZONS) {
    const fh = filled.filter((e) => Number.isFinite(e.ret[h]));
    const weeks = fh.map((e) => e.week || e.d0 || e.id);
    const net = fh.map((e) => e.ret[h] - COSTS[e.market].roundTrip);
    const stress = fh.map((e) => e.ret[h] - COSTS[e.market].stop);
    byH[h] = { gross: ci95(fh.map((e) => e.ret[h])), net: clusterCi95(net, weeks), netIid: ci95(net), stressMean: mean(stress) };
  }
  return {
    n: usable.length,
    filled: filled.length,
    clusters: new Set(filled.map((e) => e.week || e.d0 || e.id)).size,
    fillRateWindow: share(usable.filter((e) => e.wouldFill === true).length, usable.filter((e) => e.wouldFill !== null).length),
    fillRateD1: share(usable.filter((e) => e.fillD1).length, usable.length),
    gapD1Median: median(usable.map((e) => e.gapD1)),
    mae10Median: median(filled.map((e) => e.mae10)),
    mae10P10: quantile(filled.map((e) => e.mae10), 0.1),
    byH,
  };
}

function groupBy(xs, key) {
  const m = new Map();
  for (const x of xs) { const k = key(x); m.set(k, [...(m.get(k) || []), x]); }
  return m;
}

/**
 * 전체 요약.
 * @param evals 시그널별 평가(전부 — 에피소드 표시 포함 `isEpisodeStart`)
 * @param meta {days, episodeDays, orders:[{status, blocked_by, source, n}], barsAvailable, excludedStaleRows}
 */
function summarize(evals, meta) {
  const starts = evals.filter((e) => e.isEpisodeStart);
  const statusCounts = {};
  for (const e of evals) {
    const k = `${e.market}|${e.status}`;
    statusCounts[k] = statusCounts[k] || { raw: 0, episodes: 0 };
    statusCounts[k].raw++;
    if (e.isEpisodeStart) statusCounts[k].episodes++;
  }
  const states = {};
  for (const e of starts) states[e.state] = (states[e.state] || 0) + 1;
  const fxMethods = {};
  for (const e of starts) if (e.fxMethod && e.fxMethod !== 'none') fxMethods[e.fxMethod] = (fxMethods[e.fxMethod] || 0) + 1;
  // (R-4c) 미국 원화 가격 에피소드 중 2·3차 역산(같은 날 중앙값·자기 비율) 비중 — 크면 미국 가격 판정의 확신을 낮춘다
  const fxTotal = Object.values(fxMethods).reduce((a, v) => a + v, 0);
  const fxWeak = (fxMethods.signal_ratio_day_median || 0) + (fxMethods.signal_ratio_self || 0);
  const fx = { total: fxTotal, weak: fxWeak, weakShare: share(fxWeak, fxTotal), usEpisodes: starts.filter((e) => e.market === 'US' && e.state === 'ok').length };

  // H-G 구조적 비실행 — 원시 시그널 전체(DB 사실)와 에피소드
  const hg = (xs) => {
    const known = xs.filter((e) => e.structural !== null && e.structural !== undefined);
    return {
      known: known.length, structural: known.filter((e) => e.structural).length, total: xs.length,
      estimated: known.filter((e) => e.priceKrwEstimated).length,       // (R-4r) 미국 가격 단위·환율을 추정한 건
    };
  };
  const hgByMarket = {};
  for (const [m, xs] of groupBy(evals, (e) => e.market)) hgByMarket[m] = hg(xs);
  const hgByBand = {};
  for (const [b, xs] of groupBy(evals.filter((e) => e.priceBand), (e) => `${e.market}|${e.priceBand}`)) hgByBand[b] = hg(xs);

  // H-A 재원
  const withCash = starts.filter((e) => e.cashAvailable != null && Number.isFinite(e.amountKrw));
  const ha = { covered: withCash.length, total: starts.length, short: withCash.filter((e) => e.cashAvailable < e.amountKrw).length };

  // H-C 타이밍·추격 / H-E 만료 분해 (에피소드, 기간 판정 가능한 것)
  const judgeable = starts.filter((e) => e.state === 'ok' && e.wouldFill !== null);
  const unfilled = judgeable.filter((e) => e.wouldFill === false);
  const missBuckets = { '<0.5%': 0, '0.5-2%': 0, '2-5%': 0, '>=5%': 0 };
  for (const e of unfilled) {
    const m = e.missBy;
    missBuckets[m < 0.005 ? '<0.5%' : m < 0.02 ? '0.5-2%' : m < 0.05 ? '2-5%' : '>=5%']++;
  }
  const hc = { judgeable: judgeable.length, unfilled: unfilled.length, ranUp: unfilled.filter((e) => e.ranUp).length, missBuckets };
  const expired = starts.filter((e) => e.status === 'expired');
  const he = {
    expired: expired.length,
    judgeable: expired.filter((e) => e.state === 'ok' && e.wouldFill !== null).length,
    reachedButExpired: expired.filter((e) => e.wouldFill === true).length,
    notReached: expired.filter((e) => e.wouldFill === false).length,
    intradayOnly: expired.filter((e) => e.state === 'ok' && e.wouldFill === null).length,
    withOrder: expired.filter((e) => e.consumedOrderId != null).length,
    zoneTouched: expired.filter((e) => e.zoneTouched === true).length,
    zoneKnown: expired.filter((e) => e.zoneTouched !== null && e.zoneTouched !== undefined).length,
  };

  // H-D 하락 중 매수 — 추세 분할
  const trend = {};
  for (const m of ['US', 'KR']) {
    const xs = starts.filter((e) => e.market === m);
    const r20 = xs.map((e) => e.ret20).filter((x) => Number.isFinite(x));
    const edges = [0.2, 0.4, 0.6, 0.8].map((q) => quantile(r20, q));
    const qOf = (x) => (x == null || edges.some((v) => v == null) ? null : 1 + edges.filter((v) => x > v).length);
    trend[m] = {
      edges,
      belowMa60: returnStats(xs.filter((e) => e.aboveMa60 === false)),
      aboveMa60: returnStats(xs.filter((e) => e.aboveMa60 === true)),
      quintiles: [1, 2, 3, 4, 5].map((q) => ({ q, ...returnStats(xs.filter((e) => qOf(e.ret20) === q)) })),
    };
  }

  const byMarket = {};
  for (const [m, xs] of groupBy(starts, (e) => e.market)) byMarket[m] = returnStats(xs);
  const byStrategy = [];
  for (const [k, xs] of groupBy(starts, (e) => `${e.market}|${e.strategy}`)) byStrategy.push({ key: k, ...returnStats(xs) });
  byStrategy.sort((a, b) => b.n - a.n);
  const byStatus = [];
  for (const [k, xs] of groupBy(starts, (e) => `${e.market}|${e.status}`)) byStatus.push({ key: k, ...returnStats(xs) });
  byStatus.sort((a, b) => b.n - a.n);

  const rsi = returnStats(starts.filter((e) => /^rsi-oversold/.test(e.strategy)));
  // (R-4r) rsi 수익 통계에 포함된 기업행위 의심 걸림 에피소드 수 — 권고 문장에 병기
  rsi.corpTouched = starts.filter((e) => /^rsi-oversold/.test(e.strategy) && e.state === 'ok' && !e.barGap && e.corpTouched).length;
  const rsiByMarket = {};
  for (const [m, xs] of groupBy(starts.filter((e) => /^rsi-oversold/.test(e.strategy)), (e) => e.market)) rsiByMarket[m] = returnStats(xs);

  return {
    meta, totals: { raw: evals.length, episodes: starts.length }, statusCounts, states, fxMethods,
    hg: { all: hg(evals), episodes: hg(starts), byMarket: hgByMarket, byBand: hgByBand },
    ha, hc, he, trend, byMarket, byStrategy, byStatus, rsi, rsiByMarket, fx,
    corp: {
      n: starts.filter((e) => e.state === 'ok' && e.corpTouched).length,
      touched: returnStats(starts.filter((e) => e.corpTouched)),
      withoutTouched: returnStats(starts.filter((e) => !e.corpTouched)),
    },
    barGapExcluded: starts.filter((e) => e.state === 'ok' && e.barGap).length,
    trendBasis: {
      prevClose: starts.filter((e) => e.state === 'ok' && e.trendBasis === 'prev_close').length,
      d0Close: starts.filter((e) => e.state === 'ok' && e.trendBasis === 'd0_close').length,
    },
  };
}

function tagFor(n, direct) {
  if (direct) return '[확실]';
  if (n >= 100) return '[가능성 높음]';
  return '[추측]';
}
/** 수익 기반 판정 태그(R-4a): 표본 ≥100 이고 서로 다른 주 ≥20 일 때만 [가능성 높음], 그 밖은 [추측]. */
function tagForReturns(n, clusters) {
  return n >= 100 && clusters >= 20 ? '[가능성 높음]' : '[추측]';
}
/** (R-4c) 미국 가격이 들어간 판정은 환율 역산 2·3차 비중이 절반을 넘으면 [추측] 으로 낮춘다. */
function capForFx(tag, sum) {
  return sum.fx && sum.fx.usEpisodes > 0 && sum.fx.weakShare != null && sum.fx.weakShare > 0.5 ? '[추측]' : tag;
}
function fxNote(sum) {
  return sum.fx && sum.fx.total ? ` · 미국 환율 역산 2·3차 ${pct(sum.fx.weakShare, 0)}` : '';
}

/** H-A~H-G 판정 행(규칙은 리포트에 그대로 적는다). */
function judge(sum) {
  const rows = [];
  const { ha, hc, he, hg } = sum;
  const haShare = share(ha.short, ha.covered);
  rows.push({
    id: 'H-A', name: '재원 부족',
    verdict: ha.covered < 0.3 * ha.total || ha.covered < 10 ? '판정 불가(현금 자료 부족)' : haShare >= 0.5 ? '지배적 후보' : haShare >= 0.2 ? '부분 원인' : '주원인 아님',
    evidence: `현금 기록이 있는 에피소드 ${ha.covered}/${ha.total} 중 시그널 금액 > 가용 현금 ${ha.short}건(${pct(haShare, 1)})`,
    tag: ha.covered < 10 ? '[추측]' : tagFor(ha.covered, false),
    share: haShare,
  });
  const orders = sum.meta.orders || [];
  const nOrders = orders.reduce((a, o) => a + Number(o.n || 0), 0);
  const nBad = orders.filter((o) => ['rejected', 'failed', 'blocked'].includes(o.status)).reduce((a, o) => a + Number(o.n || 0), 0);
  rows.push({
    id: 'H-B', name: '실행 실패',
    verdict: nOrders === 0 ? '이 기간 해당 없음(매수 주문 0건 — 실행 단계에 닿지 않음)' : share(nBad, nOrders) >= 0.5 ? '지배적 후보' : '부분 원인',
    evidence: `기간 내 매수 주문 ${nOrders}건, 거부·실패·차단 ${nBad}건`,
    tag: '[확실]', share: share(nBad, nOrders),
  });
  const hcShare = share(hc.ranUp, hc.unfilled);
  rows.push({
    id: 'H-C', name: '타이밍 지연·추격(올라서 못 삼)',
    verdict: hc.unfilled < 10 ? '판정 불가(표본 부족)' : hcShare >= 0.4 ? '지배적 후보' : hcShare >= 0.15 ? '부분 원인' : '주원인 아님',
    evidence: `기간 판정 가능 ${hc.judgeable}건 중 미체결 ${hc.unfilled}건, 그중 가격이 2% 이상 위에 머물고 기간 끝 종가도 2% 이상 높았던 건 ${hc.ranUp}건(${pct(hcShare, 1)})${fxNote(sum)}`,
    tag: capForFx(tagFor(hc.unfilled, false), sum), share: hcShare,
  });
  const hdRows = [];
  let hdVerdict = '불분명';
  let hdTag = '[추측]';
  for (const m of ['US', 'KR']) {
    const t = sum.trend[m];
    if (!t) continue;
    const below = t.belowMa60.byH[10].net, above = t.aboveMa60.byH[10].net;
    hdRows.push(`${m}: MA60 아래 ${pct(below.mean)}(n=${below.n}) vs 위 ${pct(above.mean)}(n=${above.n}), MAE10 중앙값 ${pct(t.belowMa60.mae10Median)} vs ${pct(t.aboveMa60.mae10Median)}`);
    if (below.n >= 20 && above.n >= 20 && below.mean != null && above.mean != null) {
      if (above.mean - below.mean >= 0.01) { hdVerdict = '지지(하락 추세 매수가 더 나쁨)'; hdTag = tagForReturns(Math.min(below.n, above.n), Math.min(below.clusters, above.clusters)); }
      else if (below.mean - above.mean >= 0.01 && hdVerdict === '불분명') hdVerdict = '반대(하락 추세 매수가 더 나음)';
    }
  }
  rows.push({
    id: 'H-D', name: '하락 중 매수', verdict: hdVerdict,
    evidence: `${hdRows.join(' / ') || '자료 없음'} · 비용 후 D+10, 장중 시그널은 전일 종가 기준 추세${fxNote(sum)}`,
    tag: capForFx(hdTag, sum), share: null,
  });
  const heShare = share(he.reachedButExpired, he.reachedButExpired + he.notReached);
  rows.push({
    id: 'H-E', name: '승인 만료(가격은 왔는데 만료)',
    verdict: he.judgeable < 10 ? '판정 불가(표본 부족)' : heShare >= 0.4 ? '지배적 후보' : heShare >= 0.15 ? '부분 원인' : '주원인 아님',
    evidence: `만료 에피소드 ${he.expired}건 — 가격 도달 후 만료 ${he.reachedButExpired}, 미도달 ${he.notReached}, 당일 만료(일봉 판정 불가) ${he.intradayOnly}, 주문 연결 ${he.withOrder}`
      + ` · ⚠ "도달"은 일봉 저가 ≤ 가격(만료일 하루 전체 포함) — 체결 가능성의 **상한**이라 도달 쪽으로 과대 집계되는 경향${fxNote(sum)}`,
    tag: '[추측]', share: heShare,
  });
  rows.push({
    id: 'H-F', name: '계좌·앱 성과 분리', verdict: '이 리포트 범위 밖', evidence: '보유 점검 리포트(T-069)·주간 손익 리포트에서 다룬다', tag: '—', share: null,
  });
  // (R-4e) 판정은 에피소드 단위, 원시 시그널 단위를 함께 적는다
  const hgShare = share(hg.episodes.structural, hg.episodes.known);
  const hgRaw = share(hg.all.structural, hg.all.known);
  rows.push({
    id: 'H-G', name: '구조적 비실행(1주 가격 > 시그널 금액)',
    verdict: hg.episodes.known < 10 ? '판정 불가' : hgShare >= 0.25 ? '주요 원인' : hgShare >= 0.1 ? '부분 원인' : '주원인 아님',
    evidence: `에피소드 ${hg.episodes.structural}/${hg.episodes.known}(${pct(hgShare, 1)}) · 원시 시그널 ${hg.all.structural}/${hg.all.known}(${pct(hgRaw, 1)})`
      + ' · 임계 25% 는 사전 관측(T-064 §3, 30일 25%)과 같은 값이라 경계 근처는 판정보다 수치를 볼 것'
      + (hg.episodes.estimated ? ` · 미국 가격 단위·환율 추정 ${hg.episodes.estimated}건 포함` : ''),
    tag: hg.episodes.estimated ? '[가능성 높음]' : '[확실]', share: hgShare,
  });
  const ranked = rows.filter((r) => /지배적 후보|주요 원인/.test(r.verdict) && r.share != null).sort((a, b) => b.share - a.share);
  return { rows, dominant: ranked.map((r) => r.id) };
}

/** (R-4r) 서로 다른 주가 이보다 적으면 수익 기반 권고를 내지 않는다(보류). */
const MIN_CLUSTERS_FOR_VERDICT = 8;
const RSI_CAVEAT = ' — 분석가(Fable) 검토 전에는 이 권고를 rsi-oversold 비활성 결정의 근거로 쓰지 말 것';
function rsiRecommendation(sum) {
  const s = sum.rsi.byH[5].net;
  const s10 = sum.rsi.byH[10].net;
  const corp = ` · 기업행위 의심 걸림 ${sum.rsi.corpTouched ?? 0}건 포함`;
  const ci = `95% 구간(주 군집 ${s.clusters ?? 0}개, t 분포) ${pct(s.lo)}~${pct(s.hi)}${corp}`;
  const tag = capForFx(tagForReturns(s.n, s.clusters || 0), sum);
  if (s.n < 30) return { verdict: '보류(표본 부족)', reason: `rsi-oversold 체결 가정 에피소드 ${s.n}건 < 30${corp}${RSI_CAVEAT}`, tag: '[추측]' };
  if ((s.clusters || 0) < MIN_CLUSTERS_FOR_VERDICT) {
    return { verdict: '보류(서로 다른 주 부족)', reason: `체결 가정 ${s.n}건이 서로 다른 주 ${s.clusters || 0}개(< ${MIN_CLUSTERS_FOR_VERDICT})에 몰려 있다 — 비용 후 D+5 평균 ${pct(s.mean)}${corp}${RSI_CAVEAT}`, tag: '[추측]' };
  }
  if (s.hi != null && s.hi < 0) return { verdict: '비활성 권고', reason: `비용 후 D+5 평균 ${pct(s.mean)} (${ci}) 전 구간 음수${RSI_CAVEAT}`, tag };
  if (s.mean < 0) return { verdict: '비활성 권고(불확실)', reason: `비용 후 D+5 평균 ${pct(s.mean)} 음수이나 ${ci} 이 0 을 포함하거나 계산 불가, D+10 ${pct(s10.mean)}${RSI_CAVEAT}`, tag: '[추측]' };
  if (s.lo != null && s.lo > 0) return { verdict: '유지', reason: `비용 후 D+5 평균 ${pct(s.mean)} (${ci}) 양수${RSI_CAVEAT}`, tag };
  return { verdict: '보류(양수이나 불확실)', reason: `비용 후 D+5 평균 ${pct(s.mean)} (${ci})${RSI_CAVEAT}`, tag: '[추측]' };
}

function statLine(label, st) {
  const h = st.byH;
  return `| ${label} | ${st.n} | ${st.filled} | ${pct(st.fillRateWindow, 1)} | ${pct(st.fillRateD1, 1)} | ${pct(st.gapD1Median)} | `
    + `${pct(h[1].net.mean)} | ${pct(h[3].net.mean)} | ${pct(h[5].net.mean)} | ${pct(h[10].net.mean)} | `
    + `${h[5].net.lo == null ? '—' : `${pct(h[5].net.lo)}~${pct(h[5].net.hi)}`} | ${st.clusters} | ${pct(h[5].stressMean)} | ${pct(st.mae10Median)} | ${pct(st.mae10P10)} |`;
}
const STAT_HEAD = '| 구분 | 에피소드 | 체결 가정 | would_fill(기간) | D+1 체결 | D+1 갭 중앙값 | 순 D+1 | 순 D+3 | 순 D+5 | 순 D+10 | 순 D+5 95% 구간(주 군집) | 주 군집 수 | D+5 손절비용 가정 | MAE10 중앙값 | MAE10 하위10% |\n'
  + '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';

function renderReport(sum, verdicts, rec, info) {
  const L = [];
  const m = sum.meta;
  L.push(`---\ntask_id: T-070\ntype: report\ntags:\n  - type/report\n  - domain/strategy\ncreated: ${info.generatedDate}\n---\n`);
  L.push(`# T-070 과거 시그널 사후검증 — ${info.generatedDate}\n`);
  L.push(`> 생성: \`scripts/profit-engine/signal-postmortem.mjs\` (읽기 전용 세션, LLM 0) · 생성 시각 ${info.generatedAt} KST · 관련 [[T-070-daily-bars-phase0]] · 설계 [[T-064-profit-engine-design]] §3\n`);
  L.push('## 결론 먼저\n');
  L.push(`- 지배적 병목 후보: ${verdicts.dominant.length ? verdicts.dominant.join(', ') : '판정 규칙상 지배적 후보 없음(아래 표 근거 참고)'}`);
  L.push(`- \`rsi-oversold\` 권고: **${rec.verdict}** ${rec.tag} — ${rec.reason}`);
  L.push(`- 표본: 최근 ${m.days}일 매수 시그널 ${sum.totals.raw}건 → 에피소드(종목별 ${m.episodeDays}일 안 최초 발화) ${sum.totals.episodes}건. 일봉 있는 에피소드 ${sum.states.ok || 0}건`
    + `(일봉 없음 ${sum.states.no_bars || 0} · 단위 불명 ${sum.states.unit_unknown || 0} · 이후 봉 없음 ${sum.states.no_forward_bars || 0}).`);
  if (!m.barsAvailable) L.push('- ⚠ `daily_bars` 테이블이 없거나 비어 있어 H-C·H-D·H-E 와 수익 통계는 계산하지 못했다. 백필 뒤 다시 실행한다.');
  L.push('');
  L.push('## H-A ~ H-G 판정\n');
  L.push('| ID | 가설 | 판정 | 근거 수치 | 확신 |');
  L.push('|---|---|---|---|---|');
  for (const r of verdicts.rows) L.push(`| ${r.id} | ${r.name} | ${r.verdict} | ${r.evidence} | ${r.tag} |`);
  L.push('');
  L.push('⚠ 이 표를 읽기 전에(R-4):');
  L.push('- **수익·구간은 독립 표본이 아니다.** 과매도 시그널은 같은 날·같은 주 하락장에 몰린다. 95% 구간은 D0 가 속한 주로 묶은 군집 표준오차(t 분포, 자유도 = 주 수 − 1)이고, 서로 다른 주가 8 미만이면 rsi 권고는 보류한다. 수익 기반 판정 태그는 표본 ≥100 이면서 서로 다른 주 ≥20 일 때만 [가능성 높음], 그 밖은 [추측]이다.');
  L.push('- **H-E "가격 도달 후 만료"는 일봉 저가 ≤ 가격 기준(만료일 하루 전체 포함) — 체결 가능성의 상한**이라 도달 쪽으로 과대 집계된다. 태그를 [추측]으로 고정했다.');
  L.push(`- **미국 가격은 환율 역산에 의존한다.** 미국 원화 가격 에피소드 ${sum.fx.total}건 중 2·3차 방법(같은 날 중앙값·자기 비율=D0 종가로 진입) ${sum.fx.weak}건(${pct(sum.fx.weakShare, 1)}). 절반을 넘으면 미국 가격이 들어간 판정(H-C·H-D·H-E·rsi)을 [추측]으로 낮췄다.`);
  L.push('- 추세 특성(MA60·20일 수익률)은 장 마감 전에 만든 시그널은 전 거래일 종가, 마감 뒤는 D0 종가로 계산했다(미래 정보 차단). 단, 단위 판별·자기 비율 환율은 D0 종가를 쓴다.\n');
  L.push('판정 규칙(사전 고정): H-A 현금 기록 ≥30% 일 때 금액>현금 비율 ≥50% 지배·≥20% 부분 / H-C 미체결 중 "2% 이상 위에 머물고 끝 종가 +2% 이상" 비율 ≥40% 지배·≥15% 부분 / '
    + 'H-D MA60 아래·위 각 ≥20건에서 비용 후 D+10 평균 차 ≥1%p / H-E 만료 중 가격 도달 비율 ≥40% 지배·≥15% 부분 / H-G 구조적 비실행 ≥25% 주요·≥10% 부분. '
    + '확신 태그: DB 건수 그대로는 [확실], 건수 기반 판정은 표본 ≥100 이면 [가능성 높음], 수익 기반은 위 군집 조건, 그 밖 [추측].\n');

  L.push('## 수익 통계(에피소드, 체결 가정, 비용 후)\n');
  L.push(`비용: 미국 왕복 ${pct(COSTS.US.roundTrip)}(손절 가정 ${pct(COSTS.US.stop)}), 국내 ${pct(COSTS.KR.roundTrip)}(${pct(COSTS.KR.stop)}). `
    + `기업행위 의심 봉이 걸린 에피소드 ${sum.corp.n}건은 **포함**하고 아래에 따로 집계한다. D0~D+10 에 결측 봉이 있는 ${sum.barGapExcluded}건은 D+k 가 달력과 어긋나 제외.\n`);
  L.push(STAT_HEAD);
  for (const [k, st] of Object.entries(sum.byMarket)) L.push(statLine(`시장 ${k}`, st));
  L.push(statLine('rsi-oversold 전체', sum.rsi));
  for (const [k, st] of Object.entries(sum.rsiByMarket)) L.push(statLine(`rsi-oversold ${k}`, st));
  L.push('');
  L.push('### 기업행위 의심 봉(D0~D+10) 별도 집계\n');
  L.push(STAT_HEAD);
  L.push(statLine('의심 봉 걸림', sum.corp.touched));
  L.push(statLine('의심 봉 없음', sum.corp.withoutTouched));
  L.push('');
  L.push('### 전략별(시장|전략, 에피소드 많은 순 상위 15)\n');
  L.push(STAT_HEAD);
  for (const st of sum.byStrategy.slice(0, 15)) L.push(statLine(st.key, st));
  L.push('');
  L.push('### 상태별(시장|상태)\n');
  L.push(STAT_HEAD);
  for (const st of sum.byStatus) L.push(statLine(st.key, st));
  L.push('');

  L.push('## H-D 추세 조건 분할\n');
  for (const [mk, t] of Object.entries(sum.trend)) {
    L.push(`### ${mk} — 20일 수익률 5분위 경계 ${t.edges.map((e) => pct(e, 1)).join(' / ')}\n`);
    L.push(STAT_HEAD);
    L.push(statLine('MA60 아래', t.belowMa60));
    L.push(statLine('MA60 위', t.aboveMa60));
    for (const q of t.quintiles) L.push(statLine(`20일 수익률 Q${q.q}`, q));
    L.push('');
  }

  L.push('## H-C 미체결 거리 분포(기간 판정 가능 에피소드)\n');
  L.push('| 기간 최저가가 시그널 가격보다 | 건수 |');
  L.push('|---|---|');
  for (const [k, v] of Object.entries(sum.hc.missBuckets)) L.push(`| ${k} 위 | ${v} |`);
  L.push('');
  L.push('## H-E 만료 시점 상태 분해\n');
  const he = sum.he;
  L.push(`- 만료 에피소드 ${he.expired}건: 가격 도달 후 만료 ${he.reachedButExpired} · 미도달 ${he.notReached} · 당일 만료(일봉 판정 불가) ${he.intradayOnly} · 주문 연결(consumed_order_id) ${he.withOrder}`);
  L.push(`- AI 진입구간이 있는 만료 ${he.zoneKnown}건 중 기간 안에 구간 가격대를 지난 것 ${he.zoneTouched}건`);
  L.push('- 한계: 시그널 상태 이력(승인 대기→승인→진입 대기)이 저장되지 않아 "승인 대기 중 만료"와 "승인 후 진입 대기 중 만료"를 직접 나눌 수 없다. 주문 연결 여부만 대리 지표로 쓴다.\n');

  L.push('## H-G 구조적 비실행(시그널 금액 < 1주 가격)\n');
  L.push('| 구분 | 가격을 아는 시그널 | 1주 미만 | 비율 |');
  L.push('|---|---|---|---|');
  L.push(`| 전체(원시) | ${sum.hg.all.known} | ${sum.hg.all.structural} | ${pct(share(sum.hg.all.structural, sum.hg.all.known), 1)} |`);
  L.push(`| 전체(에피소드) | ${sum.hg.episodes.known} | ${sum.hg.episodes.structural} | ${pct(share(sum.hg.episodes.structural, sum.hg.episodes.known), 1)} |`);
  for (const [k, v] of Object.entries(sum.hg.byMarket)) L.push(`| 시장 ${k} | ${v.known} | ${v.structural} | ${pct(share(v.structural, v.known), 1)} |`);
  for (const [k, v] of Object.entries(sum.hg.byBand).sort()) L.push(`| ${k.replace('|', ' · 1주 ')} | ${v.known} | ${v.structural} | ${pct(share(v.structural, v.known), 1)} |`);
  L.push('');

  L.push('## 자료·방법 메모\n');
  L.push('| 상태 | 시장 | 원시 | 에피소드 |');
  L.push('|---|---|---|---|');
  for (const [k, v] of Object.entries(sum.statusCounts).sort()) { const [mk, st] = k.split('|'); L.push(`| ${st} | ${mk} | ${v.raw} | ${v.episodes} |`); }
  L.push('');
  L.push('| 환율 역산 방법(미국 원화 가격 에피소드) | 건수 | 비율 |');
  L.push('|---|---|---|');
  for (const k of ['snapshot_usd_row', 'signal_ratio_day_median', 'signal_ratio_self']) {
    L.push(`| ${k} | ${sum.fxMethods[k] || 0} | ${pct(share(sum.fxMethods[k] || 0, sum.fx.total), 1)} |`);
  }
  L.push('');
  L.push(`- 일봉: 확정 봉만 사용, \`adj_stale\`·\`adj_orphan\` 행 ${m.excludedStaleRows ?? 0}개 제외. 기업행위 의심 걸림 ${sum.corp.n}건 포함(별도 집계), 결측 봉 걸림 ${sum.barGapExcluded}건 제외.`);
  L.push(`- 추세 기준: 전 거래일 종가 ${sum.trendBasis.prevClose}건 · D0 종가 ${sum.trendBasis.d0Close}건.`);
  L.push('- 95% 구간은 주 군집 표준오차다. 같은 섹터 동시 하락 같은 주 경계를 넘는 상관은 반영하지 못한다(T-064 §16-2 #5).');
  L.push('- would_fill 은 일봉 저가 ≤ 시그널 가격이면 체결로 본다(장중 순서·호가 잔량 무시 — 체결 가능성의 상한). 국내 rsi-oversold 는 1시간봉 전략이라 일봉 D+k 는 근사다.');
  L.push('- 생존 편향: 일봉은 현재 상장 종목만 있다(T-064 §5.5).');
  L.push('');
  return L.join('\n');
}

// ── 읽기 전용 자료 수집 + 계산 (질의 함수 q 를 주입받는다 — DB 드라이버를 이 파일이 갖지 않는다) ─────────────
const SQL = {
  tables: "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)",
  signals: "SELECT id, strategy_id, symbol, price, amount_krw, status, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,"
    + " DATE_FORMAT(expires_at, '%Y-%m-%d %H:%i:%s') AS expires_at, consumed_order_id,"
    + " JSON_UNQUOTE(JSON_EXTRACT(indicators, '$.ai.scenario.entry.price_zone')) AS price_zone"
    + " FROM signals WHERE side = 'buy' AND created_at >= NOW() - INTERVAL ? DAY ORDER BY created_at, id",
  bars: "SELECT market, symbol, DATE_FORMAT(trade_date, '%Y-%m-%d') AS d, open, high, low, close, flags"
    + " FROM daily_bars WHERE symbol IN (?) AND trade_date >= ? AND is_final = 1 ORDER BY market, symbol, trade_date",
  snapshots: "SELECT DATE_FORMAT(ts, '%Y-%m-%d %H:%i:%s') AS ts, positions FROM portfolio_snapshots WHERE ts >= ? ORDER BY ts",
  orders: "SELECT status, blocked_by, source, COUNT(*) AS n FROM orders"
    + " WHERE side = 'buy' AND created_at >= NOW() - INTERVAL ? DAY GROUP BY status, blocked_by, source",
};
/** 환율 스냅샷은 시그널 시각 이전 72시간까지(주말을 넘겨도 금요일 값을 쓸 수 있게). 미래 스냅샷은 쓰지 않는다. */
const FX_SNAPSHOT_WINDOW_MS = 72 * 3_600_000;
const CASH_SNAPSHOT_WINDOW_MS = 6 * 3_600_000;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * @param q async (sql, params) => rows — 반드시 읽기 전용 세션의 SELECT 만 보내는 함수(실행기가 assertReadOnlySql 로 감싼다)
 * @param opts {days, episodeDays, now: Date}
 */
async function runPostmortem(q, opts) {
  const days = opts.days, episodeDays = opts.episodeDays;
  const tables = new Set((await q(SQL.tables, [['signals', 'daily_bars', 'portfolio_snapshots', 'orders']])).map((r) => String(r.t)));
  if (!tables.has('signals')) throw new Error('signals 테이블 없음');
  const rawSignals = await q(SQL.signals, [days]);
  const signals = [];
  for (const r of rawSignals) {
    const market = marketOfSymbol(String(r.symbol));
    if (!market) continue;
    signals.push({
      id: Number(r.id), symbol: String(r.symbol), market, strategy: r.strategy_id ? String(r.strategy_id) : null,
      status: String(r.status), price: num(r.price), amountKrw: num(r.amount_krw),
      createdAt: String(r.created_at), expiresAt: r.expires_at ? String(r.expires_at) : null,
      consumedOrderId: r.consumed_order_id == null ? null : Number(r.consumed_order_id),
      priceZone: parsePriceZone(r.price_zone),
    });
  }
  const firstMs = signals.length ? Math.min(...signals.map((s) => kstToMs(s.createdAt))) : opts.now.getTime();
  const ymd = (ms) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);

  const barsBy = new Map();
  let excludedStaleRows = 0;
  let barsAvailable = false;
  if (tables.has('daily_bars') && signals.length) {
    const symbols = [...new Set(signals.map((s) => s.symbol))];
    const rows = await q(SQL.bars, [symbols, ymd(firstMs - 150 * 86_400_000)]);
    for (const r of rows) {
      const flags = typeof r.flags === 'string' && r.flags ? r.flags.split(',') : [];
      if (flags.includes('adj_stale') || flags.includes('adj_orphan')) { excludedStaleRows++; continue; }
      const sym = String(r.symbol);
      if (!barsBy.has(sym)) barsBy.set(sym, []);
      barsBy.get(sym).push({ tradeDate: String(r.d), open: num(r.open), high: num(r.high), low: num(r.low), close: Number(r.close), flags });
    }
    barsAvailable = barsBy.size > 0;
  }
  const snaps = [];
  if (tables.has('portfolio_snapshots')) {
    for (const r of await q(SQL.snapshots, [`${ymd(firstMs - 86_400_000)} 00:00:00`])) {
      snaps.push({ t: kstToMs(r.ts), cash: cashFromPositions(r.positions) });
    }
  }
  const orders = tables.has('orders') ? await q(SQL.orders, [days]) : [];

  // 환율 역산: 1차 평가(환율 없이)로 미국 시그널의 (가격 ÷ D0 종가) 를 모아 날짜별 중앙값
  const pre = signals.filter((s) => s.market === 'US').map((s) => evaluateSignal(s, barsBy.get(s.symbol) || [], {}));
  const dayFx = dailyFxMedians(pre.map((e) => ({ market: e.market, d0: e.d0, ratio: e.ratio })));
  const ctx = {
    fxForSignal: (s, d0) => {
      const f1 = snapshotFxNear(snaps, kstToMs(s.createdAt), FX_SNAPSHOT_WINDOW_MS);
      if (f1) return { fx: f1, method: 'snapshot_usd_row' };
      const f2 = dayFx.get(d0);
      return f2 ? { fx: f2, method: 'signal_ratio_day_median' } : null;
    },
    cashAt: (s) => {
      const snap = snapshotBefore(snaps, kstToMs(s.createdAt), CASH_SNAPSHOT_WINDOW_MS);
      if (!snap) return null;
      return s.market === 'KR' ? snap.cash.krw : snap.cash.usdValueKrw;
    },
  };
  const episodes = buildEpisodes(signals, episodeDays);
  const evals = signals.map((s) => ({ ...evaluateSignal(s, barsBy.get(s.symbol) || [], ctx), isEpisodeStart: episodes.get(s.id).isStart }));
  const sum = summarize(evals, { days, episodeDays, orders, barsAvailable, excludedStaleRows });
  const verdicts = judge(sum);
  const rec = rsiRecommendation(sum);
  const kstNow = new Date(opts.now.getTime() + 9 * 3_600_000).toISOString();
  const md = renderReport(sum, verdicts, rec, { generatedDate: kstNow.slice(0, 10), generatedAt: kstNow.slice(0, 16).replace('T', ' ') });
  return { sum, verdicts, rec, md, evals };
}

module.exports = {
  SQL, runPostmortem, FX_SNAPSHOT_WINDOW_MS,
  COSTS, HORIZONS, MISS_RAN_UP,
  assertReadOnlySql, marketOfSymbol, kstToMs, localDateOf, parsePriceZone, buildEpisodes, cashFromPositions,
  snapshotBefore, snapshotFxNear, dailyFxMedians, evaluateSignal, returnStats, summarize, judge, rsiRecommendation,
  renderReport, ci95, clusterCi95, tCrit95, weekKey, median, quantile, priceBandKrw, MIN_CLUSTERS_FOR_VERDICT,
};

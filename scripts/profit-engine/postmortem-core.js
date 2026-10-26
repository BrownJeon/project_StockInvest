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
 *
 * T-095(P1) 추가 — 진입 모델(ctx.entryModel / opts.entryModel, 기본 'legacy' = 위 정의 그대로):
 *  - d1open : D0 봉 다음 봉 시가 진입(시장가 가정), d0close : D0 봉 종가 진입. 진입·청산 모두 daily_bars 현지 통화 원값이라
 *             수익률·MAE·H-D·rsi 판정이 환율에서 벗어난다. would_fill·D+1 체결·D+1 갭·H-C·H-E 는 여전히 시그널 가격(환율) 기준.
 *  - 가격 NULL 시그널은 'price_missing'(이전 라벨 'unit_unknown' 은 진짜 단위 불명에만). 일봉 모델은 이것도 평가한다.
 *  - 같은 날(D0 봉 날짜) 유니버스 평균 대비 초과수익(비용 전, 같은 진입 모델) · D+10 군집 구간 · 자동 경고 · v2 리포트.
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
/** (T-095) 진입 모델. legacy = v1(시그널 지정가 + 환율 역산, 기본값), d1open·d0close = 일봉 진입(환율 무관). */
const ENTRY_MODELS = ['legacy', 'd1open', 'd0close'];
/** (T-095) 같은 날 유니버스 기준선은 그 날짜에 종목이 이만큼 있어야 쓴다. */
const UNIVERSE_MIN_N = 10;
/** (T-095) 자동 경고: 표본 이 수 미만 / 임계와의 거리가 이 폭 안이면 '경계'. */
const MIN_N_WARN = 30;
const HD_THRESHOLD = 0.01;
const BOUNDARY_BAND = 0.001;
/**
 * (T-095 C1) 한 주(군집)가 표본에서 이 비중을 넘으면 '표본 집중' 경고. 근거: 주 군집 구간은 주 단위 공통 충격을 잔차 합으로만
 * 흡수하므로 한 주가 표본의 1/4 을 넘으면 평균이 사실상 그 주 하나의 사건이 된다(주 13개 균등이면 한 주 ≈7.7%, 25% 는 그 3배 이상).
 * 이 기준만으로는 놓치는 경우를 위해 "가장 큰 주를 뺐을 때 부호·구간의 0 포함 여부가 바뀌는가"도 따로 경고한다.
 */
const MAX_CLUSTER_SHARE_WARN = 0.25;

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

/** (T-095 C1) 군집 집중도 — 가장 큰 군집의 비중·키(동률이면 키 사전순 앞), 유효 군집 수(1 / Σ 비중²). */
function clusterConcentration(keys) {
  const n = keys.length;
  if (!n) return { n: 0, maxShare: null, maxKey: null, effClusters: null };
  const cnt = new Map();
  for (const k of keys) cnt.set(k, (cnt.get(k) || 0) + 1);
  let maxKey = null, max = 0, hh = 0;
  for (const [k, c] of cnt) {
    if (c > max || (c === max && String(k) < String(maxKey))) { max = c; maxKey = k; }
    hh += (c / n) ** 2;
  }
  return { n, maxShare: max / n, maxKey, effClusters: 1 / hh };
}

/**
 * (T-095 C1) 두 집단 평균 차(a − b)의 군집 강건 95% 구간. 군집 g 의 영향 u_g = Σ_{a∈g}(x−m_a)/n_a − Σ_{b∈g}(x−m_b)/n_b,
 * 분산 = G/(G−1)·Σu_g², 임계값은 t(G−1). a·b 는 [{x, k}] (k = 군집 키). 한쪽이 비면 null.
 */
function clusterDiffCi95(a, b) {
  if (!a.length || !b.length) return null;
  const ma = a.reduce((s, p) => s + p.x, 0) / a.length;
  const mb = b.reduce((s, p) => s + p.x, 0) / b.length;
  const u = new Map();
  for (const p of a) u.set(p.k, (u.get(p.k) || 0) + (p.x - ma) / a.length);
  for (const p of b) u.set(p.k, (u.get(p.k) || 0) - (p.x - mb) / b.length);
  const G = u.size;
  const diff = ma - mb;
  if (G < 2) return { diff, lo: null, hi: null, clusters: G, nA: a.length, nB: b.length };
  let ss = 0;
  for (const v of u.values()) ss += v * v;
  const se = Math.sqrt((G / (G - 1)) * ss);
  const t = tCrit95(G - 1);
  return { diff, lo: diff - t * se, hi: diff + t * se, clusters: G, nA: a.length, nB: b.length };
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
  const model = ctx && ctx.entryModel ? ctx.entryModel : 'legacy';       // (T-095) 'legacy'(기본) | 'd1open' | 'd0close'
  const out = {
    id: s.id, symbol: s.symbol, market, strategy: s.strategy || '(none)', status: s.status,
    amountKrw: s.amountKrw, consumedOrderId: s.consumedOrderId == null ? null : s.consumedOrderId, state: 'ok',
  };
  if (model !== 'legacy') out.entryModel = model;
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
  out.d0BarDate = bars[i0].tradeDate;          // (T-095) 같은 날 유니버스 기준선의 날짜 키
  const priceOk = Number.isFinite(s.price) && s.price > 0;
  const ratio = priceOk && ref > 0 ? s.price / ref : null;
  let unit = 'unknown';
  if (ratio != null && ratio >= SAME_UNIT[0] && ratio <= SAME_UNIT[1]) unit = 'same';
  else if (market === 'US' && ratio != null && ratio >= KRW_PER_USD[0] && ratio <= KRW_PER_USD[1]) unit = 'krw';
  out.unit = unit;
  out.ratio = ratio;
  if (!priceOk) {
    // (T-095 / Analyst §5) 가격 NULL 은 "단위 불명"이 아니라 "가격 없음"(ai_skipped 등). legacy 는 지금처럼 수익 통계에서 빠지고
    // 라벨만 바로잡는다. 일봉 진입 모델(d1open·d0close)은 진입가가 시그널 가격과 무관하므로 평가한다.
    out.priceStatus = 'price_missing';
    out.priceKrw = null;
    setStructural();
    if (model === 'legacy') { out.state = 'price_missing'; return out; }
  } else if (unit === 'unknown') {
    out.state = 'unit_unknown';                 // 진짜 단위 불명(가격은 있으나 비율이 어느 범위에도 안 맞음) — 모든 모델에서 제외
    out.priceKrw = null;
    setStructural();
    return out;
  }
  let fx = 1;
  let p = null;                                 // 시그널 가격을 봉 통화로 되돌린 지정가(가격 없음이면 null)
  if (priceOk) {
    out.fxMethod = 'none';
    if (unit === 'krw') {
      const f = ctx.fxForSignal ? ctx.fxForSignal(s, d0, ratio) : null;
      fx = f ? f.fx : ratio;
      out.fxMethod = f ? f.method : 'signal_ratio_self';
    }
    out.fx = fx;
    p = s.price / fx;                           // 봉과 같은 통화의 진입 가격
    out.entry = p;
    if (market === 'KR' || unit === 'krw') out.priceKrw = s.price;          // 시그널 가격이 이미 원화
    else {
      // 미국 + USD 가격(드묾): 원화 환산에 같은 날 환율 추정치를 쓴다
      const f = ctx.fxForSignal ? ctx.fxForSignal(s, d0, null) : null;
      out.priceKrw = f ? s.price * f.fx : null;
      out.priceKrwEstimated = out.priceKrw != null;            // 환율 추정치로 만든 원화 가격
    }
    setStructural();
  }

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
  out.gapD1VsClose = d1.open != null ? d1.open / ref - 1 : null;
  let fillIdx = -1;
  if (p != null) {
    // ── 지정가 반사실(시그널 가격 기준 — 미국은 환율 역산에 의존). legacy 의 수익과 would_fill·D+1 체결·H-C·H-E 가 이것을 쓴다.
    out.gapD1 = d1.open != null ? d1.open / p - 1 : null;
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
  } else {
    // 가격 없음(일봉 진입 모델에서만 여기 온다): 지정가 반사실은 계산할 수 없다
    out.gapD1 = null; out.fillD1 = null; out.refRet = {}; out.windowBars = 0; out.windowBasis = null;
    out.wouldFill = null; out.fillProxy = false; out.zoneTouched = null;
  }

  // 기업행위 의심 봉이 걸렸는가 — 통계에서 빼지 않고 따로 집계한다(R-4d: 미래 구간으로 거르면 ±30% 꼬리가 사라진다)
  out.corpTouched = bars.slice(i0, Math.min(bars.length, i0 + MAE_BARS + 2)).some((b) => (b.flags || []).includes('corp_action_suspect'));

  if (model === 'legacy') {
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

  // ── (T-095) 일봉 진입 모델: 진입·청산 모두 daily_bars 현지 통화 원값. 시그널 가격·환율(fx·ctx.fxForSignal)을 쓰지 않는다.
  const ent = entryFromBars(bars, i0, model, d0);
  out.entryBasis = ent.basis || null;
  if (ent.price == null) { out.entryUnavailable = ent.reason; return out; }
  out.entryPrice = ent.price;
  out.entryAfterClose = model === 'd0close' && out.trendBasis === 'd0_close';   // 장 마감 뒤 생성 → 이미 지난 종가로 사는 셈(낙관 쪽 근사)
  // (T-095 L-2) 진입 봉이 거래 없음(zero_volume)이면 진입가가 이월 가격일 수 있다 — 막지 않고 표시만 한다
  const entryBar = model === 'd1open' ? bars[i0 + 1] : bars[i0];
  out.entryZeroVolume = (entryBar.flags || []).includes('zero_volume');
  out.ret = {};
  for (const h of HORIZONS) if (bars[i0 + h]) out.ret[h] = bars[i0 + h].close / ent.price - 1;   // D+h = D0 봉 다음 h번째 봉 종가
  const seg = bars.slice(i0 + 1, i0 + 1 + MAE_BARS);
  out.mae10 = seg.length >= MAE_BARS ? Math.min(...seg.map((b) => (b.low != null ? b.low : b.close))) / ent.price - 1 : null;
  return out;
}

/**
 * (T-095) 일봉 진입가. d1open = D0 봉 다음 봉 시가(시장가 가정), d0close = D0 봉 종가(D0 가 그 종목 거래일일 때만 —
 * 아니면 그 종가는 시그널 전 가격이라 살 수 없었다). 시그널 가격·환율과 무관하다.
 */
function entryFromBars(bars, i0, model, d0) {
  if (model === 'd1open') {
    const b = bars[i0 + 1];
    if (!b) return { price: null, reason: 'no_forward_bars' };
    return b.open != null && b.open > 0 ? { price: b.open, basis: 'd1_open' } : { price: null, reason: 'd1_open_missing' };
  }
  if (model === 'd0close') {
    if (bars[i0].tradeDate !== d0) return { price: null, reason: 'd0_not_trading_day' };
    return bars[i0].close > 0 ? { price: bars[i0].close, basis: 'd0_close' } : { price: null, reason: 'd0_close_missing' };
  }
  return { price: null, reason: 'legacy' };
}

/**
 * (T-095) 같은 날(D0) 유니버스 무조건 수익 기준선. 키 `${market}|${D0 봉 날짜}` → { [h]: { mean, n } }.
 * 유니버스 = 넘겨받은 그 시장 전 종목(daily_bars 확정 봉, adj_stale·adj_orphan 제외). 가격은 시그널과 같은 진입 모델:
 *   d1open: (j+1 봉 시가) → (j+h 봉 종가),  d0close: (j 봉 종가) → (j+h 봉 종가).  비용 전.
 * 창(j..j+h)에 기업행위 의심 봉이나 9일 넘는 결측이 있으면 그 종목-날짜는 뺀다(건수 보고). 날짜당 종목 minN 미만이면 기준선 없음.
 * @param series [{ market, bars }] (bars 오름차순)
 */
function universeBaselines(series, model, minN = UNIVERSE_MIN_N) {
  const acc = new Map();
  const excluded = { corp: 0, gap: 0 };
  for (const { market, bars } of series) {
    for (let j = 0; j < bars.length; j++) {
      const entry = model === 'd1open' ? (bars[j + 1] ? bars[j + 1].open : null) : bars[j].close;
      if (!(entry > 0)) continue;
      const key = `${market}|${bars[j].tradeDate}`;
      for (const h of HORIZONS) {
        const k = j + h;
        if (k >= bars.length) break;
        let bad = null;
        for (let i = j; i <= k && !bad; i++) {
          if ((bars[i].flags || []).includes('corp_action_suspect')) bad = 'corp';
          else if (i > j && dayDiff(bars[i - 1].tradeDate, bars[i].tradeDate) > BAR_GAP_DAYS) bad = 'gap';
        }
        if (bad) { excluded[bad]++; continue; }
        if (!acc.has(key)) acc.set(key, {});
        const a = acc.get(key);
        a[h] = a[h] || { s: 0, n: 0 };
        a[h].s += bars[k].close / entry - 1;
        a[h].n++;
      }
    }
  }
  const out = new Map();
  for (const [key, a] of acc) {
    const v = {};
    for (const h of HORIZONS) v[h] = a[h] && a[h].n >= minN ? { mean: a[h].s / a[h].n, n: a[h].n } : null;
    out.set(key, v);
  }
  return { byKey: out, excluded };
}

/** (T-095) 평가 결과에 같은 날 유니버스 기준선(비용 전 평균)을 붙인다 — e.base[h]. 날짜 일치(D0 봉 날짜)만. */
function attachBaselines(evals, baselines) {
  for (const e of evals) {
    if (!e.d0BarDate || !e.ret) continue;
    const v = baselines.byKey.get(`${e.market}|${e.d0BarDate}`);
    if (!v) continue;
    e.base = {};
    for (const h of HORIZONS) if (v[h]) e.base[h] = v[h].mean;
  }
  return evals;
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
  // legacy: 지정가 체결 가정(fillProxy)한 것만 / 일봉 진입 모델(T-095): 진입가가 있으면 전부(시장가 가정)
  const filled = usable.filter((e) => (e.entryModel && e.entryModel !== 'legacy' ? true : e.fillProxy) && e.ret);
  const byH = {};
  for (const h of HORIZONS) {
    const fh = filled.filter((e) => Number.isFinite(e.ret[h]));
    const weeks = fh.map((e) => e.week || e.d0 || e.id);
    const net = fh.map((e) => e.ret[h] - COSTS[e.market].roundTrip);
    const stress = fh.map((e) => e.ret[h] - COSTS[e.market].stop);
    // (T-095) 같은 날 유니버스 대비 초과수익(비용 전, 날짜 일치) — 기준선이 붙은 것만, 구간은 같은 주 군집
    const fb = fh.filter((e) => e.base && Number.isFinite(e.base[h]));
    const fbWeeks = fb.map((e) => e.week || e.d0 || e.id);
    const exc = fb.map((e) => e.ret[h] - e.base[h]);
    // (T-095 C1) 민감도 — 가장 큰 주를 뺀 값, 가격 없음(price_missing)을 뺀 값. 경고(rowWarn)와 리포트 병기에 쓴다.
    const conc = clusterConcentration(weeks);
    const keepNotMax = (k) => k !== conc.maxKey;
    const pmAny = fh.some((e) => e.priceStatus === 'price_missing');
    const priced = (arr) => arr.filter((_, i) => fh[i].priceStatus !== 'price_missing');
    const pricedB = (arr) => arr.filter((_, i) => fb[i].priceStatus !== 'price_missing');
    byH[h] = {
      gross: ci95(fh.map((e) => e.ret[h])), net: clusterCi95(net, weeks), netIid: ci95(net), stressMean: mean(stress),
      excess: clusterCi95(exc, fbWeeks),
      baseMean: mean(fb.map((e) => e.base[h])),
      conc,
      netDropMax: clusterCi95(net.filter((_, i) => keepNotMax(weeks[i])), weeks.filter(keepNotMax)),
      excessDropMax: clusterCi95(exc.filter((_, i) => keepNotMax(fbWeeks[i])), fbWeeks.filter(keepNotMax)),
      netPriced: pmAny ? clusterCi95(priced(net), priced(weeks)) : null,
      excessPriced: pmAny ? clusterCi95(pricedB(exc), pricedB(fbWeeks)) : null,
    };
  }
  // D+1 체결 비율의 분모는 지정가를 계산할 수 있는 것(가격 없음 제외) — legacy 는 가격 없음이 usable 에 없어 그대로다
  const d1Base = usable.filter((e) => e.priceStatus !== 'price_missing');
  return {
    n: usable.length,
    filled: filled.length,
    clusters: new Set(filled.map((e) => e.week || e.d0 || e.id)).size,
    fillRateWindow: share(usable.filter((e) => e.wouldFill === true).length, usable.filter((e) => e.wouldFill !== null).length),
    fillRateD1: share(d1Base.filter((e) => e.fillD1).length, d1Base.length),
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
    intradayOnly: expired.filter((e) => e.state === 'ok' && e.wouldFill === null && e.priceStatus !== 'price_missing').length,
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
    ...summarizeV2(evals, starts),
  };
}

/** (T-095) v2 리포트용 추가 집계 — 가격 없음 분리·진입 불가 사유·장 마감 뒤 d0close·H-A 시장×월 분해·기준선 커버. legacy 수치에는 영향 없음. */
function summarizeV2(evals, starts) {
  const pm = (xs) => xs.filter((e) => e.priceStatus === 'price_missing');
  const priceMissing = {
    raw: pm(evals).length,
    episodes: pm(starts).length,
    byMarket: Object.fromEntries([...groupBy(pm(starts), (e) => e.market)].map(([m, xs]) => [m, xs.length])),
    byStatus: Object.fromEntries([...groupBy(pm(starts), (e) => `${e.market}|${e.status}`)].map(([k, xs]) => [k, xs.length])),
    evaluated: pm(starts).filter((e) => e.state === 'ok' && !e.barGap && e.ret && Number.isFinite(e.ret[1])).length,
  };
  const entryUnavailable = {};
  for (const e of starts) if (e.state === 'ok' && e.entryUnavailable) entryUnavailable[e.entryUnavailable] = (entryUnavailable[e.entryUnavailable] || 0) + 1;
  const haBreak = [];
  for (const [k, xs] of groupBy(starts, (e) => `${e.market}|${String(e.d0 || '').slice(0, 7)}`)) {
    const cov = xs.filter((e) => e.cashAvailable != null && Number.isFinite(e.amountKrw));
    haBreak.push({ key: k, total: xs.length, covered: cov.length, short: cov.filter((e) => e.cashAvailable < e.amountKrw).length });
  }
  haBreak.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const withRet = starts.filter((e) => e.state === 'ok' && !e.barGap && e.ret && Number.isFinite(e.ret[5]));
  // (T-095 C1) 가격 없음 제외 병기용 통계
  const pricedStarts = starts.filter((e) => e.priceStatus !== 'price_missing');
  const isRsi = (e) => /^rsi-oversold/.test(e.strategy);
  const priced = {
    rsi: returnStats(pricedStarts.filter(isRsi)),
    rsiByMarket: Object.fromEntries([...groupBy(pricedStarts.filter(isRsi), (e) => e.market)].map(([m, xs]) => [m, returnStats(xs)])),
    byMarket: Object.fromEntries([...groupBy(pricedStarts, (e) => e.market)].map(([m, xs]) => [m, returnStats(xs)])),
  };
  // (T-095 C1) H-D 진단 — 차의 군집 구간, 집중도, 가장 큰 주를 뺀 차
  const hdDiag = {};
  for (const m of ['US', 'KR']) {
    const xs = starts.filter((e) => e.market === m);
    if (!xs.length) continue;
    const below = netSample(xs.filter((e) => e.aboveMa60 === false), 10);
    const above = netSample(xs.filter((e) => e.aboveMa60 === true), 10);
    const conc = clusterConcentration([...below, ...above].map((s) => s.k));
    const dropKey = conc.maxKey;
    hdDiag[m] = {
      nBelow: below.length, nAbove: above.length, conc, dropKey,
      full: clusterDiffCi95(above, below),
      drop: clusterDiffCi95(above.filter((s) => s.k !== dropKey), below.filter((s) => s.k !== dropKey)),
    };
  }
  return {
    priceMissing, entryUnavailable, haBreak, priced, hdDiag,
    entryAfterClose: starts.filter((e) => e.state === 'ok' && e.entryAfterClose).length,
    entryZeroVolume: starts.filter((e) => e.state === 'ok' && !e.barGap && e.entryZeroVolume && e.ret).map((e) => ({ symbol: e.symbol, d0: e.d0, price: e.priceStatus || 'ok' })),
    baselineCover: { d5: withRet.length, d5WithBase: withRet.filter((e) => e.base && Number.isFinite(e.base[5])).length },
  };
}

/**
 * (T-095) returnStats 와 같은 거르기로 h 일 비용 후 수익 표본을 만든다 — [{ x: 순수익, k: 주 군집 키, e }].
 * (usable = ok·결측 봉 없음, legacy 는 지정가 체결 가정만, 일봉 모델은 진입가가 있으면 전부)
 */
function netSample(evals, h) {
  return evals
    .filter((e) => e.state === 'ok' && !e.barGap && (e.entryModel && e.entryModel !== 'legacy' ? true : e.fillProxy) && e.ret && Number.isFinite(e.ret[h]))
    .map((e) => ({ x: e.ret[h] - COSTS[e.market].roundTrip, k: e.week || e.d0 || e.id, e }));
}

/**
 * (T-095 C2) 같은 에피소드 비교 — legacy 와 일봉 모델이 둘 다 h 일 수익을 가진 에피소드만으로 두 모델의 비용 후 평균을 비교하고,
 * 모델에만 들어온 에피소드(가격 없음 / legacy 지정가 미체결 / 기타)와 legacy 에만 있는 에피소드를 나눠 센다.
 * 전체 평균 차 = 같은 에피소드 차 + 표본 구성 차. 같은 에피소드 차는 환율 역산 오차와 "지정가 vs 시가" 구조 효과의 합이라 둘을 나누지 못한다.
 * @param pick 에피소드 거르기(예: rsi-oversold 만)
 */
function sameEpisodeCompare(legacyEvals, modelEvals, h, pick = () => true) {
  const sel = (xs) => xs.filter((e) => e.isEpisodeStart && pick(e));
  const L = new Map(netSample(sel(legacyEvals), h).map((s) => [s.e.id, s]));
  const M = new Map(netSample(sel(modelEvals), h).map((s) => [s.e.id, s]));
  const legacyById = new Map(sel(legacyEvals).map((e) => [e.id, e]));
  const ci = (arr) => clusterCi95(arr.map((s) => s.x), arr.map((s) => s.k));
  const pair = (ids) => ({ n: ids.length, legacy: ci(ids.map((id) => L.get(id))), model: ci(ids.map((id) => M.get(id))) });
  const both = [...M.keys()].filter((id) => L.has(id));
  const byMarket = {};
  for (const mk of ['US', 'KR']) byMarket[mk] = pair(both.filter((id) => M.get(id).e.market === mk));
  const onlyM = [...M.values()].filter((s) => !L.has(s.e.id));
  const reason = (s) => {
    if (s.e.priceStatus === 'price_missing') return 'priceMissing';
    const le = legacyById.get(s.e.id);
    if (le && le.state === 'ok' && !le.fillProxy) return 'legacyUnfilled';
    return 'other';
  };
  const groups = {};
  for (const r of ['priceMissing', 'legacyUnfilled', 'other']) groups[r] = ci(onlyM.filter((s) => reason(s) === r));
  const top = onlyM.filter((s) => reason(s) === 'priceMissing').sort((a, b) => b.x - a.x).slice(0, 3)
    .map((s) => ({ symbol: s.e.symbol, d0: s.e.d0, x: s.x, zeroVolume: !!s.e.entryZeroVolume }));
  return {
    h, same: pair(both), byMarket,
    full: { legacy: ci([...L.values()]), model: ci([...M.values()]) },
    onlyModel: { n: onlyM.length, groups, top },
    onlyLegacy: ci([...L.values()].filter((s) => !M.has(s.e.id))),
  };
}

const isV2 = (sum) => !!(sum && sum.meta && sum.meta.entryModel && sum.meta.entryModel !== 'legacy');
/** 퍼센트포인트 */
const pp = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%p`);
/** 군집 구간 문자열 'lo~hi' 또는 '—' */
const rng = (c) => (c && c.lo != null ? `${pct(c.lo)}~${pct(c.hi)}` : '—');
/** (T-095) 자동 경고 — 표본 n<30, 서로 다른 주 < 8, 구간 계산 불가 */
function ciWarn(c) {
  if (!c || !c.n) return [];
  const w = [];
  if (c.n < MIN_N_WARN) w.push(`n=${c.n}<${MIN_N_WARN}`);
  if ((c.clusters || 0) < MIN_CLUSTERS_FOR_VERDICT) w.push(`주 ${c.clusters || 0}<${MIN_CLUSTERS_FOR_VERDICT}`);
  if (c.lo == null) w.push('구간 계산 불가');
  return w;
}
/** 평균 + 구간 + 경고 한 덩어리 */
function ciText(c) {
  if (!c || !c.n) return '— (표본 0)';
  const w = ciWarn(c);
  return `${pct(c.mean)} (95% 구간 ${rng(c)}, 주 군집 ${c.clusters || 0}개, t 분포, n=${c.n})${w.length ? ` ⚠ ${w.join(' · ')}` : ''}`;
}
/** (T-095 C1) 구간이 0 을 포함하나(계산 불가면 null) */
const zeroIn = (c) => (c && c.lo != null ? c.lo <= 0 && c.hi >= 0 : null);
/** (T-095 C1) 대안 표본(alt)으로 바꿨을 때 부호가 뒤집히거나 구간의 0 포함 여부가 바뀌면 경고 */
function flipWarn(full, alt, label) {
  if (!full || !alt || !full.n || !alt.n || full.mean == null || alt.mean == null) return [];
  const w = [];
  if (Math.sign(full.mean) !== Math.sign(alt.mean)) w.push(`${label} 시 부호 반전`);
  const zf = zeroIn(full), za = zeroIn(alt);
  if (zf != null && za != null && zf !== za) w.push(`${label} 시 구간 0 포함 여부 바뀜`);
  return w;
}
/**
 * (T-095 C1) 표 행의 자동 경고(h 일): 표본 n<30·주<8·구간 불가 + 최대 주 비중 > 25% + 최대 주 제외 / 가격 없음 제외 시 부호·0 포함 변화
 * (순수익·초과수익 각각).
 */
function rowWarn(st, h) {
  const b = st.byH[h];
  const w = [...ciWarn(b.net)];
  if (b.conc && b.conc.maxShare != null && b.net.n && b.conc.maxShare > MAX_CLUSTER_SHARE_WARN) w.push(`최대 주 ${pct(b.conc.maxShare, 0)}(${b.conc.maxKey})`);
  w.push(...flipWarn(b.net, b.netDropMax, '최대 주 제외'));
  w.push(...flipWarn(b.net, b.netPriced, '가격 없음 제외'));
  w.push(...flipWarn(b.excess, b.excessDropMax, '최대 주 제외(초과)'));
  w.push(...flipWarn(b.excess, b.excessPriced, '가격 없음 제외(초과)'));
  return w;
}
/** 표 한 칸용 D+5·D+10 경고 묶음 */
function rowWarnCell(st) {
  return [...new Set([...rowWarn(st, 5).map((w) => `D+5 ${w}`), ...rowWarn(st, 10).map((w) => `D+10 ${w}`)])].join(', ') || '—';
}
/**
 * (T-095 C1) H-D 라벨(v2) — "지지/반대"는 ① 각 ≥20건 ② |차| ≥1%p ③ 표본 집중 아님(최대 주 ≤25%, 그 주를 빼도 판정 쪽이 같음)
 * ④ 차의 95% 군집 구간이 0 을 제외할 때만 쓴다. 집중이면 "표본 집중 — 판정 보류".
 */
function hdLabel(d) {
  if (!d || !d.full) return { label: '자료 없음', judged: false };
  if (d.nBelow < 20 || d.nAbove < 20) return { label: '표본 부족(각 ≥20 필요)', judged: false };
  const side = (x) => (x == null ? '0' : x >= HD_THRESHOLD ? '+' : x <= -HD_THRESHOLD ? '-' : '0');
  const shareHigh = d.conc.maxShare != null && d.conc.maxShare > MAX_CLUSTER_SHARE_WARN;
  const dropFlips = !!d.drop && side(d.drop.diff) !== side(d.full.diff);
  if (shareHigh || dropFlips) return { label: '표본 집중 — 판정 보류', judged: false, concentrated: true };
  if (side(d.full.diff) === '0') return { label: '차 1%p 미만(사전 규칙상 지지·반대 아님)', judged: false };
  if (d.full.lo == null || zeroIn({ lo: d.full.lo, hi: d.full.hi })) return { label: '불분명(차의 95% 구간이 0 포함)', judged: false };
  return { label: d.full.diff > 0 ? '지지(하락 추세 매수가 더 나쁨)' : '반대(하락 추세 매수가 더 나음)', judged: true };
}
/**
 * (T-095 / Analyst §5) H-D 시장별 차(비용 후 D+10 평균, MA60 위 − 아래)와 자동 경고 — 임계 1%p 와 ±0.1%p 안이면 '경계'(H-G 경계 경고와 같은 형식),
 * 어느 쪽이든 n<30 이면 표본 경고.
 */
function hdDiffs(sum) {
  const out = [];
  for (const m of ['US', 'KR']) {
    const t = sum.trend && sum.trend[m];
    if (!t) continue;
    const below = t.belowMa60.byH[10].net, above = t.aboveMa60.byH[10].net;
    if (below.mean == null || above.mean == null) { out.push({ m, diff: null, warn: [], below, above }); continue; }
    const diff = above.mean - below.mean;
    const warn = [];
    if (isBoundary(diff, HD_THRESHOLD)) warn.push(`차 ${pp(diff)} 는 임계 1%p 와 ±${pp(BOUNDARY_BAND)} 안의 경계 — 판정보다 수치를 볼 것`);
    if (below.n < MIN_N_WARN) warn.push(`MA60 아래 n=${below.n}<${MIN_N_WARN}`);
    if (above.n < MIN_N_WARN) warn.push(`MA60 위 n=${above.n}<${MIN_N_WARN}`);
    // (T-095 C1) 집중도·차 구간 — summarizeV2 의 hdDiag 가 있을 때
    const diag = sum.hdDiag ? sum.hdDiag[m] : null;
    const lab = diag ? hdLabel(diag) : null;
    if (diag && diag.conc.maxShare != null && diag.conc.maxShare > MAX_CLUSTER_SHARE_WARN) {
      warn.push(`최대 주 ${pct(diag.conc.maxShare, 0)}(${diag.conc.maxKey} 주, ${Math.round(diag.conc.maxShare * diag.conc.n)}/${diag.conc.n}건)`);
    }
    if (diag && diag.drop && lab && lab.concentrated) warn.push(`그 주 제외 시 차 ${pp(diag.full.diff)} → ${pp(diag.drop.diff)}`);
    out.push({ m, diff, warn, below, above, diag, lab });
  }
  return out;
}

/** (T-095) 값이 임계와 같은 경계(±band)인가 */
function isBoundary(value, threshold, band = BOUNDARY_BAND) {
  // 1e-12: 0.009·0.011 같은 가장자리 값이 부동소수 오차로 빠지지 않게(M10)
  return value != null && Number.isFinite(value) && Math.abs(Math.abs(value) - threshold) <= band + 1e-12;
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
  const v2 = isV2(sum);
  const haShare = share(ha.short, ha.covered);
  rows.push({
    id: 'H-A', name: '재원 부족',
    verdict: ha.covered < 0.3 * ha.total || ha.covered < 10 ? '판정 불가(현금 자료 부족)' : haShare >= 0.5 ? '지배적 후보' : haShare >= 0.2 ? '부분 원인' : '주원인 아님',
    evidence: `현금 기록이 있는 에피소드 ${ha.covered}/${ha.total} 중 시그널 금액 > 가용 현금 ${ha.short}건(${pct(haShare, 1)})`
      + (v2 ? ' · 현금 기록 커버의 시장·월 분해는 아래 "H-A 커버 분해" 표(현금 스냅샷 6시간 창, 미국 달러 현금은 기록이 늦게 시작)'
        + ' · ⚠ 가용 현금이 시그널 금액(카드·슬롯)보다 늘 작으면 이 비율은 항등식에 가깝다 — 원인 판정이 아니라 자본 규모 사실(Analyst 10-24 §1)' : ''),
    tag: ha.covered < 10 ? '[추측]' : tagFor(ha.covered, false),
    share: haShare,
  });
  const orders = sum.meta.orders || [];
  const nOrders = orders.reduce((a, o) => a + Number(o.n || 0), 0);
  const nBad = orders.filter((o) => ['rejected', 'failed', 'blocked'].includes(o.status)).reduce((a, o) => a + Number(o.n || 0), 0);
  const span = sum.meta.orderSpan;
  rows.push({
    id: 'H-B', name: '실행 실패',
    verdict: nOrders === 0 ? '이 기간 해당 없음(매수 주문 0건 — 실행 단계에 닿지 않음)' : share(nBad, nOrders) >= 0.5 ? '지배적 후보' : '부분 원인',
    evidence: `기간 내 매수 주문 ${nOrders}건, 거부·실패·차단 ${nBad}건`
      + (v2 && span && span.n ? ` · 주문 시각 ${span.first} ~ ${span.last}(서로 다른 날 ${span.days}일)` : '')
      + (v2 ? ' · ⚠ [확실]은 **건수에만** 해당한다 — 주문이 몇 번의 시도에 몰렸는지에 따라 "병목" 해석은 [추측]' : ''),
    tag: v2 ? '[확실](건수만)' : '[확실]', share: share(nBad, nOrders),
  });
  const hcShare = share(hc.ranUp, hc.unfilled);
  rows.push({
    id: 'H-C', name: '타이밍 지연·추격(올라서 못 삼)',
    verdict: hc.unfilled < 10 ? '판정 불가(표본 부족)' : hcShare >= 0.4 ? '지배적 후보' : hcShare >= 0.15 ? '부분 원인' : '주원인 아님',
    evidence: `기간 판정 가능 ${hc.judgeable}건 중 미체결 ${hc.unfilled}건, 그중 가격이 2% 이상 위에 머물고 기간 끝 종가도 2% 이상 높았던 건 ${hc.ranUp}건(${pct(hcShare, 1)})${fxNote(sum)}`,
    tag: capForFx(tagFor(hc.unfilled, false), sum), share: hcShare,
  });
  const hdRows = [];
  const hdWarn = [];
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
  if (v2) for (const d of hdDiffs(sum)) if (d.diff != null) hdWarn.push(`${d.m} 차 ${pp(d.diff)}${d.warn.length ? ` ⚠ ${d.warn.join(' · ')}` : ''}`);
  const nSplits = Object.keys(sum.trend).length * (2 + 5);
  if (v2 && sum.hdDiag) {
    // (T-095 C1) v2: 시장별로 차 구간·집중도 검사를 거친 라벨만 쓴다(v1 규칙의 "지지/반대"를 검사 없이 쓰지 않는다)
    const ds = hdDiffs(sum).filter((d) => d.lab);
    hdVerdict = ds.map((d) => `${d.m} ${d.lab.label}`).join(' / ') || '불분명';
    const judged = ds.filter((d) => d.lab.judged);
    hdTag = judged.length
      ? tagForReturns(Math.min(...judged.map((d) => Math.min(d.below.n, d.above.n))), Math.min(...judged.map((d) => d.diag.full.clusters)))
      : '[추측]';
    hdWarn.length = 0;
    for (const d of ds) {
      const f = d.diag.full;
      hdWarn.push(`${d.m} 차 ${pp(f.diff)}(95% 구간 ${f.lo == null ? '계산 불가' : `${pp(f.lo)}~${pp(f.hi)}`}, 주 ${f.clusters}) · 최대 주 ${pct(d.diag.conc.maxShare, 0)}(${d.diag.conc.maxKey}) · 그 주 제외 차 ${pp(d.diag.drop ? d.diag.drop.diff : null)}`
        + `${d.warn.length ? ` ⚠ ${d.warn.join(' · ')}` : ''}`);
    }
  }
  rows.push({
    id: 'H-D', name: '하락 중 매수', verdict: hdVerdict,
    evidence: `${hdRows.join(' / ') || '자료 없음'} · 비용 후 D+10, 장중 시그널은 전일 종가 기준 추세`
      + (v2
        ? ` · 수익은 일봉 진입(환율 무관) · ${hdWarn.join(' / ') || '차 계산 불가'} · 라벨 규칙(v2): 각 ≥20건·|차| ≥1%p·최대 주 ≤${pct(MAX_CLUSTER_SHARE_WARN, 0)}·그 주를 빼도 같은 쪽·차의 95% 구간이 0 제외일 때만 지지/반대`
          + ` · ⚠ 다중비교: 이 분할은 ${nSplits}개(시장 ${Object.keys(sum.trend).length} × (MA60 위·아래 2 + 20일 수익률 5분위 5)) 중 하나 — 우연히 임계를 넘는 분할이 나올 수 있다`
        : fxNote(sum)),
    tag: v2 ? hdTag : capForFx(hdTag, sum), share: null,
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
/** (T-095) v2 단서 — Analyst 검토(10-24)는 끝났고, 결정은 P2(합격 기준 사전 등록) 이후 사용자 몫이다. */
const RSI_CAVEAT_V2 = ' — 측정 도구 보강(P1) 결과일 뿐, rsi-oversold 활성·비활성 결정은 P2(합격 기준 사전 등록) 이후 사용자 결정';
/**
 * (T-095) v2: 같은 v1 판정 규칙(비용 후 D+5)이되 ① 수익이 환율 무관이라 환율 역산 태그 하향을 하지 않고 ② D+10 을 구간·경고와 함께,
 * ③ 같은 날 유니버스 대비 초과수익(비용 전)을 구간과 함께 붙인다.
 */
function rsiRecommendationV2(sum) {
  const s = sum.rsi.byH[5].net;
  const corp = ` · 기업행위 의심 걸림 ${sum.rsi.corpTouched ?? 0}건 포함`;
  const ex5 = sum.rsi.byH[5].excess, ex10 = sum.rsi.byH[10].excess;
  const tail = ` · D+10 ${ciText(sum.rsi.byH[10].net)}`
    + (ex5 && ex5.n ? ` · 같은 날 유니버스 대비 초과(비용 전) D+5 ${ciText(ex5)}, D+10 ${ciText(ex10)}` : ' · 같은 날 유니버스 기준선 없음')
    + `${corp}${RSI_CAVEAT_V2}`;
  const d5 = `비용 후 D+5 ${ciText(s)}`;
  const tag = tagForReturns(s.n, s.clusters || 0);
  let r;
  if (s.n < 30) r = { verdict: '보류(표본 부족)', reason: `rsi-oversold 진입 에피소드 ${s.n}건 < 30 · ${d5}${tail}`, tag: '[추측]' };
  else if ((s.clusters || 0) < MIN_CLUSTERS_FOR_VERDICT) r = { verdict: '보류(서로 다른 주 부족)', reason: `서로 다른 주 ${s.clusters || 0}개(< ${MIN_CLUSTERS_FOR_VERDICT}) · ${d5}${tail}`, tag: '[추측]' };
  else if (s.hi != null && s.hi < 0) r = { verdict: '비활성 권고', reason: `${d5} 전 구간 음수${tail}`, tag };
  else if (s.mean < 0) r = { verdict: '비활성 권고(불확실)', reason: `${d5} — 평균은 음수이나 구간이 0 을 포함하거나 계산 불가${tail}`, tag: '[추측]' };
  else if (s.lo != null && s.lo > 0) r = { verdict: '유지', reason: `${d5} 전 구간 양수${tail}`, tag };
  else r = { verdict: '보류(양수이나 불확실)', reason: `${d5}${tail}`, tag: '[추측]' };

  // (T-095 C1) 표본 구성 민감도를 헤드라인에 병기 — 가격 없음 제외 값·최대 주 비중·자동 경고. 민감하면 판정에 표시하고 태그를 [추측]으로.
  const b5 = sum.rsi.byH[5], b10 = sum.rsi.byH[10];
  const sens = [];
  if (b5.netPriced) {
    sens.push(`가격 없음 제외 시 비용 후 D+5 ${ciText(b5.netPriced)} · D+10 ${ciText(b10.netPriced)}`
      + (b5.excessPriced && b5.excessPriced.n ? ` · 초과 D+5 ${pct(b5.excessPriced.mean)}(${rng(b5.excessPriced)}) · 초과 D+10 ${pct(b10.excessPriced ? b10.excessPriced.mean : null)}(${rng(b10.excessPriced)})` : ''));
  }
  if (b5.conc && b5.conc.n) sens.push(`최대 주 비중 D+5 ${pct(b5.conc.maxShare, 0)}(${b5.conc.maxKey}) · D+10 ${pct(b10.conc ? b10.conc.maxShare : null, 0)}(${b10.conc ? b10.conc.maxKey : '—'})`);
  const w = [...rowWarn(sum.rsi, 5).map((x) => `D+5 ${x}`), ...rowWarn(sum.rsi, 10).map((x) => `D+10 ${x}`)];
  const sensitive = w.some((x) => /최대 주|가격 없음 제외/.test(x));
  if (sens.length || w.length) {
    r.reason += ` || 표본 구성 민감도: ${sens.join(' · ') || '—'}${w.length ? ` · ⚠ 자동 경고: ${w.join(', ')}` : ''}`;
  }
  if (sensitive) { r.verdict += ' — ⚠ 표본 구성에 민감(가격 없음·최대 주를 빼면 달라짐)'; r.tag = '[추측]'; }
  return r;
}

function rsiRecommendation(sum) {
  if (isV2(sum)) return rsiRecommendationV2(sum);
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
    + `(일봉 없음 ${sum.states.no_bars || 0} · 가격 없음 ${sum.states.price_missing || 0} · 단위 불명 ${sum.states.unit_unknown || 0} · 이후 봉 없음 ${sum.states.no_forward_bars || 0}).`);
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

// ── (T-095) v2 리포트 ─────────────────────────────────────────────────────────────────────────────
const MODEL_DESC = {
  legacy: 'legacy(v1 — 시그널 지정가 + 환율 역산, 당일 만료는 D+1 프록시)',
  d1open: 'd1open(D+1 시가 진입 — 환율 무관)',
  d0close: 'd0close(D0 종가 진입 — 환율 무관, 가격 없음 포함)',
};
function statLineV2(label, st) {
  const h = st.byH;
  return `| ${label} | ${st.n} | ${st.filled} | ${pct(st.fillRateD1, 1)} | ${pct(h[1].net.mean)} | ${pct(h[3].net.mean)} | `
    + `${pct(h[5].net.mean)} | ${rng(h[5].net)} | ${pct(h[10].net.mean)} | ${rng(h[10].net)} | ${st.clusters} | `
    + `${pct(h[5].excess.mean)} | ${rng(h[5].excess)} | ${pct(h[10].excess.mean)} | ${rng(h[10].excess)} | ${pct(st.mae10Median)} | ${rowWarnCell(st)} |`;
}
/**
 * (T-095 C2) "v1(legacy) 대비" 절 — 같은 에피소드 비교와 표본 구성 분해. 숫자는 전부 sameEpisodeCompare 결과에서 나온다(문자열에 박지 않는다).
 * @param vs { h5, h10 } (rsi-oversold 에피소드)
 */
function renderVsLegacy(L, vs, model) {
  L.push(`## v1(legacy) 대비 — 같은 에피소드 비교 (rsi-oversold, 비용 후)\n`);
  L.push(`v1 → v2 로 평균이 바뀐 이유를 둘로 나눈다: **① 같은 에피소드에서 진입 정의가 바뀐 몫**(legacy 와 ${model} 이 둘 다 수익을 가진 에피소드만) · **② 표본 구성이 바뀐 몫**(${model} 에만 들어온 에피소드 − legacy 에만 있던 에피소드). 전체 평균 차 = ① + ②.\n`);
  L.push(`| 구간 | 범위 | 같은 에피소드 n | legacy 평균 | legacy 95% 구간 | ${model} 평균 | ${model} 95% 구간 | 차(${model} − legacy) |`);
  L.push('|---|---|---|---|---|---|---|---|');
  for (const c of [vs.h5, vs.h10]) {
    if (!c) continue;
    const rows = [['전체', c.same], ['US', c.byMarket.US], ['KR', c.byMarket.KR]];
    for (const [label, p] of rows) {
      if (!p || !p.n) continue;
      L.push(`| D+${c.h} | ${label} | ${p.n} | ${pct(p.legacy.mean)} | ${rng(p.legacy)} | ${pct(p.model.mean)} | ${rng(p.model)} | ${pp(p.model.mean - p.legacy.mean)} |`);
    }
  }
  L.push('');
  L.push('| 구간 | 전체 평균 차(전체 표본) | ① 같은 에피소드 차 | ② 표본 구성 몫(= 전체 − ①) |');
  L.push('|---|---|---|---|');
  for (const c of [vs.h5, vs.h10]) {
    if (!c || !c.same.n) continue;
    const full = c.full.model.mean - c.full.legacy.mean;
    const same = c.same.model.mean - c.same.legacy.mean;
    L.push(`| D+${c.h} | ${pp(full)}(legacy ${pct(c.full.legacy.mean)} n=${c.full.legacy.n} → ${model} ${pct(c.full.model.mean)} n=${c.full.model.n}) | ${pp(same)} | ${pp(full - same)} |`);
  }
  L.push('');
  const c5 = vs.h5;
  if (c5) {
    const g = c5.onlyModel.groups;
    L.push(`### ${model} 에만 들어온 에피소드(D+5) — 구성\n`);
    L.push(`| 구성 | n | ${model} 비용 후 D+5 평균 | 95% 구간 |`);
    L.push('|---|---|---|---|');
    L.push(`| 가격 없음(price_missing — legacy 는 평가 불가) | ${g.priceMissing.n} | ${pct(g.priceMissing.mean)} | ${rng(g.priceMissing)} |`);
    L.push(`| legacy 지정가 미체결(가격이 안 내려와 legacy 는 수익 없음) | ${g.legacyUnfilled.n} | ${pct(g.legacyUnfilled.mean)} | ${rng(g.legacyUnfilled)} |`);
    L.push(`| 기타 | ${g.other.n} | ${pct(g.other.mean)} | ${rng(g.other)} |`);
    L.push(`| (참고) legacy 에만 있음 — legacy 평균 | ${c5.onlyLegacy.n} | ${pct(c5.onlyLegacy.mean)} | ${rng(c5.onlyLegacy)} |`);
    L.push('');
    if (c5.onlyModel.top.length) {
      L.push(`- 가격 없음 에피소드 중 D+5 상위: ${c5.onlyModel.top.map((t) => `${t.symbol}(D0 ${t.d0}) ${pct(t.x)}${t.zeroVolume ? ' — 진입 봉 zero_volume(이월 가격 가능)' : ''}`).join(' · ')}`);
    }
    const same = c5.same.n ? c5.same.model.mean - c5.same.legacy.mean : null;
    const full = c5.full.model.mean - c5.full.legacy.mean;
    const word = same == null ? '비교 불가' : same < 0 ? '**더 나쁘다**' : same > 0 ? '더 낫다' : '같다';
    L.push(`- 읽는 법: 같은 에피소드 ${c5.same.n}건에서 ${model} 은 legacy 보다 ${word}(${pp(same)}). 전체 평균 차 ${pp(full)} 중 ${same == null ? '—' : pp(full - same)} 은 표본 구성(가격 없음 ${g.priceMissing.n}건·legacy 미체결 ${g.legacyUnfilled.n}건 편입 등) 몫이다. `
      + '즉 "v2 가 v1 보다 덜 나쁘다"는 차이는 진입 방식이 나아서가 아니라 들어온 에피소드가 달라서일 수 있다 — 위 두 표가 그 크기를 보여 준다.');
    const usSame = c5.byMarket.US && c5.byMarket.US.n ? c5.byMarket.US.model.mean - c5.byMarket.US.legacy.mean : null;
    L.push(`- **분리하지 못한 것** [추측]: 같은 에피소드 차(US ${pp(usSame)})는 ① 환율 역산 오차(legacy 의 미국 지정가가 추정 환율에 1:1 로 걸림)와 ② "지정가가 D+1 시가보다 싸다"는 구조 효과(legacy 는 가격이 내려와야 체결되므로 진입가가 낮다)의 **합**이다. 환율 이력이 없어 이 자료로는 둘을 나누지 못한다.`);
    L.push('');
  }
}

const STAT_HEAD_V2 ='| 구분 | 에피소드 | 진입 | D+1 체결(지정가 프록시) | 순 D+1 | 순 D+3 | 순 D+5 | 순 D+5 95% 구간 | 순 D+10 | 순 D+10 95% 구간 | 주 군집 수 | 초과 D+5(비용 전) | 초과 D+5 95% 구간 | 초과 D+10(비용 전) | 초과 D+10 95% 구간 | MAE10 중앙값 | 자동 경고 |\n'
  + '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';

/**
 * (T-095) v2 리포트. 정의를 맨 위에, D+10 구간·같은 날 유니버스 초과수익·가격 없음 분리·가정 명시(Analyst 10-24 §5)를 넣는다.
 * @param info {generatedDate, generatedAt, compare?: [{model, sum}]}
 */
function renderReportV2(sum, verdicts, rec, info) {
  const L = [];
  const m = sum.meta;
  const model = m.entryModel;
  const uni = m.universe || {};
  L.push(`---\ntask_id: T-095\ntype: report\ntags:\n  - type/report\n  - domain/strategy\n  - domain/validation\ncreated: ${info.generatedDate}\nentry_model: ${model}\n---\n`);
  L.push(`# T-095 과거 시그널 사후검증 v2 — 진입 모델 \`${model}\` — ${info.generatedDate}\n`);
  L.push(`> 생성: \`scripts/profit-engine/signal-postmortem.mjs --entry-model=${model}\` (읽기 전용 세션, LLM 0) · 생성 시각 ${info.generatedAt} KST · v1 [[T-070-signal-postmortem-20261024]] 은 그대로 둔다 · 관련 [[T-095-postmortem-script-p1]] · [[T-070-daily-bars-phase0]] Analyst 검토(10-24) §1·§4 P1·§5\n`);

  L.push('## 정의 — 먼저 읽기\n');
  if (model === 'd1open') {
    L.push('- **진입(d1open)**: 시그널 D0(생성 시각의 거래소 현지 날짜) 다음 거래일 봉(D+1)의 **시가**에 산다고 보는 반사실. 시그널 가격·환율을 **쓰지 않는다** — 진입·청산 모두 `daily_bars` 현지 통화 원값(미국 USD·국내 KRW). 체결은 항상 된다고 본다(시장가 가정, 시가 갭 그대로).');
  } else {
    L.push('- **진입(d0close)**: D0 봉 **종가**에 산다고 보는 반사실. 시그널 가격·환율을 **쓰지 않는다** — `daily_bars` 현지 통화 원값. D0 가 그 종목의 거래일이 아니면 진입 불가로 뺀다(그 전 종가는 시그널 전 가격). '
      + `장 마감 뒤 생성된 시그널 ${sum.entryAfterClose}건은 이미 지난 종가로 사는 셈이라 낙관 쪽 근사다. 가격이 비어 있는 시그널(ai_skipped 등)도 진입가가 시그널 가격과 무관하므로 평가한다.`);
  }
  // (T-095 L-2) 거래 없음 봉 진입 — 막지 않고 사실만 적는다
  const zv = sum.entryZeroVolume || [];
  L.push(`- **진입 봉이 \`zero_volume\`(거래 없음)인 에피소드 ${zv.length}건**${zv.length ? `(${zv.slice(0, 5).map((z) => `${z.symbol} D0 ${z.d0}${z.price === 'price_missing' ? '·가격 없음' : ''}`).join(', ')}${zv.length > 5 ? ' 외' : ''})` : ''}: `
    + `${model === 'd1open' ? 'D+1 시가' : 'D0 종가'}가 실제 체결 없이 이월된 가격일 수 있어 진입가가 비현실적일 수 있다. 걸러내지 않았다 — 극단값은 아래 "v1 대비" 절의 상위 목록과 함께 볼 것.`);
  L.push(`- **청산·라벨**: D+h = D0 봉 다음 h번째 봉의 종가(h=1,3,5,10)${model === 'd1open' ? ' — d1open 의 **D+1 은 진입 당일**(D+1 시가→D+1 종가)' : ''}. 순수익 = 수익 − 왕복 비용(미국 ${pct(COSTS.US.roundTrip)}·국내 ${pct(COSTS.KR.roundTrip)}). MAE10 = D+1~D+10 최저가 ÷ 진입가 − 1. (v1 legacy 의 "D+1" 은 체결 봉 = 체결 당일 종가였다.)`);
  const us = m.universeSignalSyms || {};
  L.push(`- **같은 날 유니버스 초과수익**: 초과 = 시그널 에피소드 수익(비용 전) − **같은 시장·같은 D0 봉 날짜**의 유니버스 평균 수익(비용 전). `
    + `유니버스 = **수집 관심목록의 등가중 평균**(\`daily_bars\` 에 일봉을 모으는 KR ${uni.KR || 0}·US ${uni.US || 0}종목) — **시장 지수·시장 전체가 아니다**. `
    + `이 목록의 대부분이 시그널 종목이라(KR ${us.KR ?? '—'}/${uni.KR || 0}·US ${us.US ?? '—'}/${uni.US || 0}) 시그널 종목을 뺀 기준선은 만들 수 없고, 자기 종목이 기준선에 들어가 초과수익이 약 n/(n−1)배(n=종목 수, 약 2%) 작게 나온다. \`adj_stale\`·\`adj_orphan\` 행은 제외. `
    + `가격 = 시그널과 같은 진입 모델(${model === 'd1open' ? 'D+1 시가 → D+h 종가' : 'D0 종가 → D+h 종가'}). 창에 기업행위 의심 봉(${m.baselineExcluded ? m.baselineExcluded.corp : 0}건)·9일 넘는 결측(${m.baselineExcluded ? m.baselineExcluded.gap : 0}건)이 걸린 종목-날짜는 기준선에서 뺐고, 날짜당 종목 ${UNIVERSE_MIN_N}개 미만이면 기준선이 없다. `
    + '**날짜 일치 비교**다(Analyst 10-24 §2 의 기간 평균 비교와 다르다). 비용 후로 보려면 초과에서 왕복 비용(US 0.65%p·KR 0.33%p)을 더 뺀다(기준선은 거래 비용 없는 보유 기준). 구간은 같은 주 군집·t 분포.');
  L.push('- **측정 대상은 라이브 전략이 아니다.** 라이브 매수 시그널은 승인 TTL 30분 지정가다. 이 리포트의 수익은 위 반사실이고, "D+1 체결(지정가 프록시)" 열은 v1 과 같은 **D+1 프록시 = 하루 걸어둔 지정가 반사실**이다(당일 만료는 일봉으로 장중 판정이 안 되어 D+1 저가 ≤ 지정가면 체결로 센다 — 저가 터치 = 체결이라 낙관적).');
  L.push('- **환율 의존이 남는 것**: would_fill·D+1 체결·D+1 갭·H-C·H-E 는 시그널 가격 기준(미국은 원화 가격 → 환율 역산)이라 환율에 의존한다 [추측]. 수익률·MAE·H-D·rsi 판정·초과수익은 환율을 쓰지 않는다.');
  const asOf = m.asOf ? `as-of ${m.asOf} KST(시그널·주문 창 고정)` : '실행 시각 기준 창';
  L.push(`- **자료 시점**: 최근 ${m.days}일 · ${asOf} · 일봉 최신 날짜 KR ${(m.maxBarDate || {}).KR || '—'}·US ${(m.maxBarDate || {}).US || '—'}${m.barsUntil ? ` · 일봉은 ${m.barsUntil} 까지만 사용` : ''}. 새 봉이 쌓이면 D+10 도달 표본이 늘어 같은 창이라도 수치가 바뀐다.\n`);

  L.push('## 결론 먼저\n');
  L.push(`- \`rsi-oversold\` (v1 판정 규칙 그대로 적용): **${rec.verdict}** ${rec.tag} — ${rec.reason}`);
  const pm = sum.priceMissing;
  L.push(`- 표본: 최근 ${m.days}일 매수 시그널 ${sum.totals.raw}건 → 에피소드(종목별 ${m.episodeDays}일 안 최초 발화) ${sum.totals.episodes}건. 평가 가능(일봉 있음) ${sum.states.ok || 0}건`
    + `(일봉 없음 ${sum.states.no_bars || 0} · 단위 불명 ${sum.states.unit_unknown || 0} · 이후 봉 없음 ${sum.states.no_forward_bars || 0}). `
    + `**가격 없음(price_missing) 에피소드 ${pm.episodes}건**(${Object.entries(pm.byStatus).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}) — 이 모델에서 수익 평가에 들어간 것 ${pm.evaluated}건(v1 은 "단위 불명"으로 잘못 라벨링해 전부 탈락).`
    + (Object.keys(sum.entryUnavailable).length ? ` 진입 불가 ${Object.entries(sum.entryUnavailable).map(([k, v]) => `${k} ${v}`).join(', ')}.` : ''));
  L.push(`- 지배적 병목 후보(v1 규칙): ${verdicts.dominant.length ? verdicts.dominant.join(', ') : '판정 규칙상 지배적 후보 없음'} — H-B 는 아래 단서 참고.`);
  if (!m.barsAvailable) L.push('- ⚠ `daily_bars` 테이블이 없거나 비어 있어 수익 통계는 계산하지 못했다.');
  L.push('');

  if (info.compare && info.compare.length) {
    L.push('## 진입 모델 비교(같은 시그널·같은 일봉)\n');
    L.push('legacy 는 환율 역산 지정가(v1 그대로), d1open·d0close 는 환율 무관. 초과수익은 일봉 모델만(legacy 는 진입가가 환율에 묶여 기준선과 날짜·가격 정의가 맞지 않는다).\n');
    L.push('| 구분 | 모델 | 진입 | 순 D+5 | 순 D+5 95% 구간 | 순 D+10 | 순 D+10 95% 구간 | 주 군집 | 초과 D+5(비용 전) | 초과 D+10(비용 전) | 자동 경고 |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|');
    // (T-095 C1) 가격 없음 제외 행을 같은 표에 나란히(legacy 는 가격 없음이 원래 빠져 있어 생략)
    const groups = [['rsi-oversold 전체', (s) => s.rsi], ['rsi-oversold 전체(가격 없음 제외)', (s) => s.priced && s.priced.rsi, true],
      ['rsi-oversold US', (s) => s.rsiByMarket.US], ['rsi-oversold US(가격 없음 제외)', (s) => s.priced && s.priced.rsiByMarket.US, true],
      ['rsi-oversold KR', (s) => s.rsiByMarket.KR], ['rsi-oversold KR(가격 없음 제외)', (s) => s.priced && s.priced.rsiByMarket.KR, true],
      ['시장 US', (s) => s.byMarket.US], ['시장 KR', (s) => s.byMarket.KR], ['시장 KR(가격 없음 제외)', (s) => s.priced && s.priced.byMarket.KR, true]];
    for (const [label, pick, pricedRow] of groups) {
      for (const c of info.compare) {
        const lg = c.model === 'legacy';
        if (pricedRow && lg) continue;
        const st = pick(c.sum);
        if (!st) continue;
        const h = st.byH;
        L.push(`| ${label} | ${c.model} | ${st.filled} | ${pct(h[5].net.mean)} | ${rng(h[5].net)} | ${pct(h[10].net.mean)} | ${rng(h[10].net)} | ${st.clusters} | `
          + `${lg ? '—' : pct(h[5].excess.mean)} | ${lg ? '—' : pct(h[10].excess.mean)} | ${rowWarnCell(st)} |`);
      }
    }
    L.push('');
    L.push('### H-D 차(비용 후 D+10 평균, MA60 위 − 아래) — 모델별 구간·집중도·경계 경고\n');
    L.push(`v1 사전 규칙: 각 ≥20건에서 차 ≥1%p 면 "지지". v2 라벨은 여기에 더해 최대 주 ≤${pct(MAX_CLUSTER_SHARE_WARN, 0)}·그 주를 빼도 같은 쪽·차의 95% 군집 구간이 0 제외일 때만 지지/반대를 쓰고, 집중이면 "표본 집중 — 판정 보류"다. 임계와 ±0.10%p 안은 경계. 분할 비교가 여러 개(다중비교)라 단독 근거로 쓰지 않는다.\n`);
    L.push('| 모델 | 시장 | MA60 아래 | MA60 위 | 차 | 차 95% 구간(주 군집) | 최대 주 비중 | 그 주 제외 차 | v2 라벨 | 자동 경고 |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const c of info.compare) {
      for (const d of hdDiffs(c.sum)) {
        const f = d.diag && d.diag.full;
        L.push(`| ${c.model} | ${d.m} | ${pct(d.below.mean)}(n=${d.below.n}) | ${pct(d.above.mean)}(n=${d.above.n}) | ${pp(d.diff)} | `
          + `${f && f.lo != null ? `${pp(f.lo)}~${pp(f.hi)}` : '—'} | ${d.diag ? `${pct(d.diag.conc.maxShare, 0)}(${d.diag.conc.maxKey})` : '—'} | `
          + `${d.diag && d.diag.drop ? pp(d.diag.drop.diff) : '—'} | ${d.lab ? d.lab.label : '—'} | ${d.warn.join(' · ') || '—'} |`);
      }
    }
    L.push('');
  }

  if (info.vsLegacy) renderVsLegacy(L, info.vsLegacy, model);

  L.push('## H-A ~ H-G 판정\n');
  L.push('| ID | 가설 | 판정 | 근거 수치 | 확신 |');
  L.push('|---|---|---|---|---|');
  for (const r of verdicts.rows) L.push(`| ${r.id} | ${r.name} | ${r.verdict} | ${r.evidence} | ${r.tag} |`);
  L.push('');
  L.push('⚠ 이 표를 읽기 전에:');
  L.push('- **수익·구간은 독립 표본이 아니다.** 95% 구간은 D0 가 속한 주로 묶은 군집 표준오차(t 분포, 자유도 = 주 수 − 1). 유효 표본은 행 수가 아니라 서로 다른 주 수다. 같은 종목 연속 에피소드의 D+10 창이 겹치는 직렬 상관은 주 군집이 다 흡수하지 못한다 — 유효 N 은 더 작을 수 있다 [추측].');
  L.push(`- **자동 경고**: 표본 n<${MIN_N_WARN}·서로 다른 주 <${MIN_CLUSTERS_FOR_VERDICT}·구간 계산 불가, **한 주가 표본의 ${pct(MAX_CLUSTER_SHARE_WARN, 0)} 초과(표본 집중)**, `
    + '**가장 큰 주를 빼거나 가격 없음 에피소드를 빼면 부호가 뒤집히거나 구간의 0 포함 여부가 바뀌는 경우**(순수익·초과수익 각각)는 표 오른쪽 "자동 경고" 열과 결론 문장에 붙는다. '
    + `사전 규칙 임계와 ±${pp(BOUNDARY_BAND)} 안의 값은 "경계"로 표시한다(H-D·H-G).`);
  L.push(`- **다중비교**: 이 리포트는 시장·전략·상태·추세(H-D 분할 ${Object.keys(sum.trend).length * 7}개) 단위로 여러 번 나눠 본다. 5% 수준에서 분할 20개 중 1개는 우연히 "유의"해 보일 수 있다 — 분할 하나의 결과를 근거로 쓰지 않는다.`);
  const sp = m.orderSpan;
  L.push('- **H-B 의 [확실] 은 건수에만** 해당한다. 주문이 한 번의 짧은 시도에 몰려 있으면 "지배적 병목"은 과대 해석이다'
    + (sp && sp.n ? `(이 창의 매수 주문 ${sp.n}건: ${sp.first} ~ ${sp.last}, 서로 다른 날 ${sp.days}일).` : '.'));
  L.push('- **H-E "가격 도달 후 만료"는 일봉 저가 ≤ 가격 기준 — 체결 가능성의 상한**이라 도달 쪽으로 과대 집계된다.');
  L.push(`- **미국 지정가(H-C·H-E·D+1 체결)는 환율 역산에 의존한다.** 미국 원화 가격 에피소드 ${sum.fx.total}건 중 2·3차 방법 ${sum.fx.weak}건(${pct(sum.fx.weakShare, 1)}).\n`);
  L.push('판정 규칙(v1 과 같이 사전 고정): H-A 현금 기록 ≥30% 일 때 금액>현금 비율 ≥50% 지배·≥20% 부분 / H-C 미체결 중 "2% 이상 위에 머물고 끝 종가 +2% 이상" 비율 ≥40% 지배·≥15% 부분 / '
    + 'H-D MA60 아래·위 각 ≥20건에서 비용 후 D+10 평균 차 ≥1%p / H-E 만료 중 가격 도달 비율 ≥40% 지배·≥15% 부분 / H-G 구조적 비실행 ≥25% 주요·≥10% 부분.\n');

  L.push(`## 수익 통계(에피소드, ${MODEL_DESC[model]}, 비용 후)\n`);
  L.push(`기업행위 의심 봉이 걸린 에피소드 ${sum.corp.n}건은 포함(아래 별도 집계), D0~D+10 에 9일 넘는 결측이 있는 ${sum.barGapExcluded}건은 제외. `
    + `초과수익 기준선이 붙은 D+5 표본 ${sum.baselineCover.d5WithBase}/${sum.baselineCover.d5}.\n`);
  L.push('"(가격 없음 제외)" 행은 같은 모델에서 가격 없음(price_missing) 에피소드만 뺀 값이다 — 소수 표본이 평균을 얼마나 바꾸는지 나란히 본다(C1).\n');
  L.push(STAT_HEAD_V2);
  const pr = sum.priced || { byMarket: {}, rsiByMarket: {} };
  for (const [k, st] of Object.entries(sum.byMarket)) {
    L.push(statLineV2(`시장 ${k}`, st));
    if (pr.byMarket[k] && st.byH[5].netPriced) L.push(statLineV2(`시장 ${k}(가격 없음 제외)`, pr.byMarket[k]));
  }
  L.push(statLineV2('rsi-oversold 전체', sum.rsi));
  if (pr.rsi && sum.rsi.byH[5].netPriced) L.push(statLineV2('rsi-oversold 전체(가격 없음 제외)', pr.rsi));
  for (const [k, st] of Object.entries(sum.rsiByMarket)) {
    L.push(statLineV2(`rsi-oversold ${k}`, st));
    if (pr.rsiByMarket[k] && st.byH[5].netPriced) L.push(statLineV2(`rsi-oversold ${k}(가격 없음 제외)`, pr.rsiByMarket[k]));
  }
  L.push('');
  L.push('### 기업행위 의심 봉(D0~D+10) 별도 집계\n');
  L.push(STAT_HEAD_V2);
  L.push(statLineV2('의심 봉 걸림', sum.corp.touched));
  L.push(statLineV2('의심 봉 없음', sum.corp.withoutTouched));
  L.push('');
  L.push('### 전략별(시장|전략, 에피소드 많은 순 상위 15) — ⚠ 다중비교\n');
  L.push(STAT_HEAD_V2);
  for (const st of sum.byStrategy.slice(0, 15)) L.push(statLineV2(st.key, st));
  L.push('');
  L.push('### 상태별(시장|상태) — 가격 없음(ai_skipped)이 여기서 평가된다\n');
  L.push(STAT_HEAD_V2);
  for (const st of sum.byStatus) L.push(statLineV2(st.key, st));
  L.push('');

  L.push(`## H-D 추세 조건 분할 — ⚠ 다중비교(분할 ${Object.keys(sum.trend).length * 7}개)\n`);
  for (const [mk, t] of Object.entries(sum.trend)) {
    L.push(`### ${mk} — 20일 수익률 5분위 경계 ${t.edges.map((e) => pct(e, 1)).join(' / ')}\n`);
    L.push(STAT_HEAD_V2);
    L.push(statLineV2('MA60 아래', t.belowMa60));
    L.push(statLineV2('MA60 위', t.aboveMa60));
    for (const q of t.quintiles) L.push(statLineV2(`20일 수익률 Q${q.q}`, q));
    L.push('');
  }

  L.push('## H-A 커버 분해(시장 × D0 월, 에피소드)\n');
  L.push('현금 스냅샷은 시그널 시각 이전 6시간 창. 미국 달러 현금 기록은 늦게 시작해 미국 쪽 커버가 낮다 — 커버 안 된 에피소드는 판정에 없다.\n');
  L.push('| 시장 | 월 | 에피소드 | 현금 기록 있음 | 금액 > 현금 | 비율 |');
  L.push('|---|---|---|---|---|---|');
  for (const r of sum.haBreak) { const [mk, mo] = r.key.split('|'); L.push(`| ${mk} | ${mo} | ${r.total} | ${r.covered} | ${r.short} | ${pct(share(r.short, r.covered), 1)} |`); }
  L.push('');

  L.push('## H-C 미체결 거리 분포(지정가, 기간 판정 가능 에피소드 — 환율 의존)\n');
  L.push('| 기간 최저가가 시그널 가격보다 | 건수 |');
  L.push('|---|---|');
  for (const [k, v] of Object.entries(sum.hc.missBuckets)) L.push(`| ${k} 위 | ${v} |`);
  L.push('');
  const he = sum.he;
  L.push('## H-E 만료 시점 상태 분해(지정가 — 환율 의존)\n');
  L.push(`- 만료 에피소드 ${he.expired}건: 가격 도달 후 만료 ${he.reachedButExpired} · 미도달 ${he.notReached} · 당일 만료(일봉 판정 불가 → D+1 프록시) ${he.intradayOnly} · 주문 연결(consumed_order_id) ${he.withOrder}`);
  L.push(`- AI 진입구간이 있는 만료 ${he.zoneKnown}건 중 기간 안에 구간 가격대를 지난 것 ${he.zoneTouched}건\n`);

  L.push('## H-G 구조적 비실행(시그널 금액 < 1주 가격)\n');
  L.push('| 구분 | 가격을 아는 시그널 | 1주 미만 | 비율 |');
  L.push('|---|---|---|---|');
  L.push(`| 전체(원시) | ${sum.hg.all.known} | ${sum.hg.all.structural} | ${pct(share(sum.hg.all.structural, sum.hg.all.known), 1)} |`);
  L.push(`| 전체(에피소드) | ${sum.hg.episodes.known} | ${sum.hg.episodes.structural} | ${pct(share(sum.hg.episodes.structural, sum.hg.episodes.known), 1)} |`);
  for (const [k, v] of Object.entries(sum.hg.byMarket)) L.push(`| 시장 ${k} | ${v.known} | ${v.structural} | ${pct(share(v.structural, v.known), 1)} |`);
  L.push('');

  L.push('## 자료·방법 메모\n');
  L.push('| 상태 | 시장 | 원시 | 에피소드 |');
  L.push('|---|---|---|---|');
  for (const [k, v] of Object.entries(sum.statusCounts).sort()) { const [mk, st] = k.split('|'); L.push(`| ${st} | ${mk} | ${v.raw} | ${v.episodes} |`); }
  L.push('');
  L.push(`- 일봉: 확정 봉만, 시그널 종목의 \`adj_stale\`·\`adj_orphan\` 행 ${m.excludedStaleRows ?? 0}개 제외.`);
  L.push(`- 추세 기준(미래 정보 차단): 전 거래일 종가 ${sum.trendBasis.prevClose}건 · D0 종가 ${sum.trendBasis.d0Close}건.`);
  L.push('- 국내 rsi-oversold 는 1시간봉 전략이라 일봉 D+k 는 근사다. 생존 편향: 일봉은 현재 상장 종목만 있다(T-064 §5.5).');
  L.push('- 이 수치로 전략 활성·비활성을 결정하지 않는다 — 합격 기준 사전 등록(P2) 이후 사용자 결정.');
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
  // ── (T-095) 추가 질의(전부 SELECT). legacy + as-of 없음이면 위 다섯 개만 보낸다(v1 과 같은 질의·같은 인자).
  // as-of: 시그널·주문 창을 [as-of − N일, as-of] 로 고정 — v1 리포트 재현용(params: [asOf, days, asOf]).
  signalsAsOf: "SELECT id, strategy_id, symbol, price, amount_krw, status, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,"
    + " DATE_FORMAT(expires_at, '%Y-%m-%d %H:%i:%s') AS expires_at, consumed_order_id,"
    + " JSON_UNQUOTE(JSON_EXTRACT(indicators, '$.ai.scenario.entry.price_zone')) AS price_zone"
    + " FROM signals WHERE side = 'buy' AND created_at >= CAST(? AS DATETIME) - INTERVAL ? DAY AND created_at <= CAST(? AS DATETIME) ORDER BY created_at, id",
  ordersAsOf: "SELECT status, blocked_by, source, COUNT(*) AS n FROM orders"
    + " WHERE side = 'buy' AND created_at >= CAST(? AS DATETIME) - INTERVAL ? DAY AND created_at <= CAST(? AS DATETIME) GROUP BY status, blocked_by, source",
  // 일봉 진입 모델: 같은 날 유니버스 기준선에 시장 전 종목 일봉이 필요하다(시그널 종목만이 아니라)
  barsAll: "SELECT market, symbol, DATE_FORMAT(trade_date, '%Y-%m-%d') AS d, open, high, low, close, flags"
    + " FROM daily_bars WHERE trade_date >= ? AND is_final = 1 ORDER BY market, symbol, trade_date",
  // H-B 단서: 매수 주문이 언제·며칠에 걸쳐 있었나(건수 외 사실)
  ordersSpan: "SELECT COUNT(*) AS n, DATE_FORMAT(MIN(created_at), '%Y-%m-%d %H:%i') AS first_at, DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i') AS last_at,"
    + " COUNT(DISTINCT DATE(created_at)) AS days FROM orders WHERE side = 'buy' AND created_at >= NOW() - INTERVAL ? DAY",
  ordersSpanAsOf: "SELECT COUNT(*) AS n, DATE_FORMAT(MIN(created_at), '%Y-%m-%d %H:%i') AS first_at, DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i') AS last_at,"
    + " COUNT(DISTINCT DATE(created_at)) AS days FROM orders WHERE side = 'buy' AND created_at >= CAST(? AS DATETIME) - INTERVAL ? DAY AND created_at <= CAST(? AS DATETIME)",
};
const AS_OF_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 환율 스냅샷은 시그널 시각 이전 72시간까지(주말을 넘겨도 금요일 값을 쓸 수 있게). 미래 스냅샷은 쓰지 않는다. */
const FX_SNAPSHOT_WINDOW_MS = 72 * 3_600_000;
const CASH_SNAPSHOT_WINDOW_MS = 6 * 3_600_000;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * @param q async (sql, params) => rows — 반드시 읽기 전용 세션의 SELECT 만 보내는 함수(실행기가 assertReadOnlySql 로 감싼다)
 * @param opts {days, episodeDays, now: Date,
 *   entryModel?: 'legacy'(기본)|'d1open'|'d0close',   — (T-095) legacy 는 v1 과 같은 질의·계산·리포트
 *   asOf?: 'YYYY-MM-DD HH:MM:SS'(KST) — 시그널·주문 창 끝을 고정(재현용),
 *   barsUntil?: 'YYYY-MM-DD' — 이 날짜 뒤 일봉은 쓰지 않는다(새 봉 영향 분리용),
 *   compare?: boolean — 일봉 모델일 때 세 모델 비교 표(기본 true)}
 */
async function runPostmortem(q, opts) {
  const days = opts.days, episodeDays = opts.episodeDays;
  const entryModel = opts.entryModel || 'legacy';
  if (!ENTRY_MODELS.includes(entryModel)) throw new Error(`entryModel 은 ${ENTRY_MODELS.join('|')}`);
  const asOf = opts.asOf || null;
  if (asOf && !AS_OF_RE.test(asOf)) throw new Error('asOf 는 YYYY-MM-DD HH:MM:SS (KST)');
  const barsUntil = opts.barsUntil || null;
  if (barsUntil && !YMD_RE.test(barsUntil)) throw new Error('barsUntil 은 YYYY-MM-DD');
  const v2 = entryModel !== 'legacy';
  const tables = new Set((await q(SQL.tables, [['signals', 'daily_bars', 'portfolio_snapshots', 'orders']])).map((r) => String(r.t)));
  if (!tables.has('signals')) throw new Error('signals 테이블 없음');
  const rawSignals = asOf ? await q(SQL.signalsAsOf, [asOf, days, asOf]) : await q(SQL.signals, [days]);
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
  const marketOf = new Map();                   // 일봉 모델: 유니버스(시장 전 종목)
  const maxBarDate = {};
  let excludedStaleRows = 0;
  let barsAvailable = false;
  if (tables.has('daily_bars') && signals.length) {
    const symbols = [...new Set(signals.map((s) => s.symbol))];
    const sigSyms = new Set(symbols);
    const from = ymd(firstMs - 150 * 86_400_000);
    // legacy: v1 과 같은 질의(시그널 종목만). 일봉 모델: 같은 날 유니버스 기준선 때문에 시장 전 종목(결과는 시그널 종목에 대해 같은 행이다)
    const rows = v2 ? await q(SQL.barsAll, [from]) : await q(SQL.bars, [symbols, from]);
    for (const r of rows) {
      const sym = String(r.symbol);
      const d = String(r.d);
      if (barsUntil && d > barsUntil) continue;
      const flags = typeof r.flags === 'string' && r.flags ? r.flags.split(',') : [];
      if (flags.includes('adj_stale') || flags.includes('adj_orphan')) { if (sigSyms.has(sym)) excludedStaleRows++; continue; }
      if (!barsBy.has(sym)) barsBy.set(sym, []);
      barsBy.get(sym).push({ tradeDate: d, open: num(r.open), high: num(r.high), low: num(r.low), close: Number(r.close), flags });
      const mk = String(r.market);
      marketOf.set(sym, mk);
      if (!maxBarDate[mk] || d > maxBarDate[mk]) maxBarDate[mk] = d;
    }
    barsAvailable = [...barsBy.keys()].some((sym) => sigSyms.has(sym));
  }
  const snaps = [];
  if (tables.has('portfolio_snapshots')) {
    for (const r of await q(SQL.snapshots, [`${ymd(firstMs - 86_400_000)} 00:00:00`])) {
      snaps.push({ t: kstToMs(r.ts), cash: cashFromPositions(r.positions) });
    }
  }
  const orders = !tables.has('orders') ? [] : asOf ? await q(SQL.ordersAsOf, [asOf, days, asOf]) : await q(SQL.orders, [days]);
  let orderSpan = null;
  if (v2 && tables.has('orders')) {
    const [r] = asOf ? await q(SQL.ordersSpanAsOf, [asOf, days, asOf]) : await q(SQL.ordersSpan, [days]);
    if (r) orderSpan = { n: Number(r.n || 0), first: r.first_at ? String(r.first_at) : null, last: r.last_at ? String(r.last_at) : null, days: Number(r.days || 0) };
  }

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
  const kstNow = new Date(opts.now.getTime() + 9 * 3_600_000).toISOString();
  const info = { generatedDate: kstNow.slice(0, 10), generatedAt: kstNow.slice(0, 16).replace('T', ' ') };
  const evalFor = (model) => signals.map((s) => ({
    ...evaluateSignal(s, barsBy.get(s.symbol) || [], model === 'legacy' ? ctx : { ...ctx, entryModel: model }),
    isEpisodeStart: episodes.get(s.id).isStart,
  }));
  if (!v2) {
    // legacy: v1 과 같은 계산·같은 리포트
    const evals = evalFor('legacy');
    const sum = summarize(evals, { days, episodeDays, orders, barsAvailable, excludedStaleRows, ...(asOf ? { asOf } : {}), ...(barsUntil ? { barsUntil } : {}) });
    const verdicts = judge(sum);
    const rec = rsiRecommendation(sum);
    const md = renderReport(sum, verdicts, rec, info);
    return { sum, verdicts, rec, md, evals };
  }

  // (T-095) 일봉 진입 모델 — 같은 날 유니버스 기준선(시장 전 종목)을 같은 진입 모델로 계산해 붙인다
  const series = [...barsBy].map(([sym, bars]) => ({ market: marketOf.get(sym), bars }));
  const universe = {};
  for (const mk of marketOf.values()) universe[mk] = (universe[mk] || 0) + 1;
  // (T-095 M-1) 관심목록 중 시그널 종목 수(시장별) — 시그널 종목을 뺀 기준선을 만들 수 없음을 리포트에 적는다
  const sigSymSet = new Set(signals.map((s) => s.symbol));
  const universeSignalSyms = {};
  for (const [sym, mk] of marketOf) if (sigSymSet.has(sym)) universeSignalSyms[mk] = (universeSignalSyms[mk] || 0) + 1;
  const baselineCache = {};
  const baselinesFor = (model) => (baselineCache[model] = baselineCache[model] || universeBaselines(series, model));
  const metaFor = (model) => ({
    days, episodeDays, orders, barsAvailable, excludedStaleRows, entryModel: model, asOf, barsUntil, maxBarDate, universe, universeSignalSyms, orderSpan,
    baselineExcluded: model === 'legacy' ? null : baselinesFor(model).excluded,
  });
  const runs = {};
  const runModel = (model) => {
    if (runs[model]) return runs[model];
    const evals = evalFor(model);
    if (model !== 'legacy') attachBaselines(evals, baselinesFor(model));
    return (runs[model] = { evals, sum: summarize(evals, metaFor(model)) });
  };
  const main = runModel(entryModel);
  const verdicts = judge(main.sum);
  const rec = rsiRecommendation(main.sum);
  const compare = opts.compare === false ? [] : ENTRY_MODELS.map((mdl) => ({ model: mdl, sum: runModel(mdl).sum }));
  // (T-095 C2) v1(legacy) 대비 같은 에피소드 비교 — rsi-oversold
  const isRsi = (e) => /^rsi-oversold/.test(e.strategy);
  const legacyEvals = runModel('legacy').evals;
  const vsLegacy = { h5: sameEpisodeCompare(legacyEvals, main.evals, 5, isRsi), h10: sameEpisodeCompare(legacyEvals, main.evals, 10, isRsi) };
  const md = renderReportV2(main.sum, verdicts, rec, { ...info, compare, vsLegacy });
  return { sum: main.sum, verdicts, rec, md, evals: main.evals, compare, vsLegacy };
}

module.exports = {
  SQL, runPostmortem, FX_SNAPSHOT_WINDOW_MS,
  COSTS, HORIZONS, MISS_RAN_UP,
  assertReadOnlySql, marketOfSymbol, kstToMs, localDateOf, parsePriceZone, buildEpisodes, cashFromPositions,
  snapshotBefore, snapshotFxNear, dailyFxMedians, evaluateSignal, returnStats, summarize, judge, rsiRecommendation,
  renderReport, ci95, clusterCi95, tCrit95, weekKey, median, quantile, priceBandKrw, MIN_CLUSTERS_FOR_VERDICT,
  // (T-095) 추가만 — 위 기존 export 의 시그니처·기본 동작은 그대로
  ENTRY_MODELS, UNIVERSE_MIN_N, MIN_N_WARN, HD_THRESHOLD, BOUNDARY_BAND,
  entryFromBars, universeBaselines, attachBaselines, renderReportV2, ciWarn, isBoundary, hdDiffs,
  // (T-095 C1·C2 — Reviewer 조건 반영) 추가만
  MAX_CLUSTER_SHARE_WARN, clusterConcentration, clusterDiffCi95, netSample, sameEpisodeCompare, rowWarn, flipWarn, hdLabel,
};

'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useFxRate } from '@/lib/hooks/useFxRate';
import { fmtMarketPrice } from '@/lib/format';

export interface SliceInput {
  zoneLo: string;     // buy: pct 기준 계산된 KRW / sell: 절대 KRW 입력
  zoneHi: string;
  zoneLoPct: string;  // buy: % 입력값 (예: '-2.0') / sell: ''
  zoneHiPct: string;  // buy: % 입력값 (예: '-0.5') / sell: ''
  qty: string;        // 수량 (주) — 매수·매도 공통. 실제 주문 단위
}

export interface BuilderValues {
  market: 'domestic' | 'overseas';
  symbol: string;
  symbolName?: string;
  direction: 'buy' | 'sell';
  currentPrice?: number;
  splits: 1 | 2 | 3 | 4;
  manualSlices: SliceInput[];
  holdingDeadline: string;
  totalQty?: number; // 슬라이스 수량 합산 (참고용)
}

interface Props {
  initialValues?: Partial<BuilderValues>;
  onAnalyze: (values: BuilderValues) => void;
  loading?: boolean;
}

interface SearchResult {
  symbol: string;
  name: string;
  market: string;
}

interface Holding {
  symbol: string;
  name?: string;
  qty: number;
  price: number;
  value_krw: number;
}

function defaultDeadline(offsetDays = 3): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDeadlineLabel(dateStr: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff <= 0) return '오늘 만료';
  if (diff === 1) return '내일 만료';
  return `${diff}일 후 만료`;
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

// fmtPrice는 ScenarioBuilder 내부에서 market/fxRate 바인딩 후 사용

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
      {children}
    </div>
  );
}

function pctToKrw(currentPrice: number, pct: number): number {
  return roundToTick(currentPrice * (1 + pct / 100));
}

function initSlices(direction: 'buy' | 'sell', splits: number, currentPrice: number | null): SliceInput[] {
  return Array.from({ length: splits }, (_, i) => {
    const [pctLo, pctHi] = direction === 'buy' ? [-2.0, -0.5] : [0.5, 2.0];
    const range = pctHi - pctLo;
    const step = range / splits;
    const sliceLoPct = pctLo + i * step;
    const sliceHiPct = pctLo + (i + 1) * step;

    // 매수·매도 공통: pct 기반 구간
    if (!currentPrice || currentPrice <= 0)
      return { zoneLo: '', zoneHi: '', zoneLoPct: sliceLoPct.toFixed(1), zoneHiPct: sliceHiPct.toFixed(1), qty: '' };
    return {
      zoneLo: String(pctToKrw(currentPrice, sliceLoPct)),
      zoneHi: String(pctToKrw(currentPrice, sliceHiPct)),
      zoneLoPct: sliceLoPct.toFixed(1),
      zoneHiPct: sliceHiPct.toFixed(1),
      qty: '',
    };
  });
}

// 종목 검색 드롭다운
function SymbolSearchInput({
  market,
  value,
  onChange,
}: {
  market: 'domestic' | 'overseas';
  value: string;
  onChange: (symbol: string, name?: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedName, setSelectedName] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value) { setQuery(''); setSelectedName(''); }
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const search = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); setOpen(false); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/symbols/search?q=${encodeURIComponent(q)}&market=${market}`);
      const data = await res.json();
      if (data.ok) { setResults(data.results); setOpen(data.results.length > 0); }
    } catch { setResults([]); }
    finally { setSearching(false); }
  }, [market]);

  function handleInput(v: string) {
    const upper = v.toUpperCase();
    setQuery(upper); setSelectedName(''); onChange('', '');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(upper), 300);
  }

  function handleSelect(r: SearchResult) {
    setQuery(r.name); setSelectedName(r.name); setOpen(false); setResults([]);
    onChange(r.symbol, r.name);
  }

  const placeholder = market === 'domestic'
    ? '종목명 또는 코드 검색 (예: 삼성, 005930)'
    : '종목명 또는 티커 검색 (예: AAPL, 애플)';
  const isSelected = !!value && !!selectedName;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text" value={query} placeholder={placeholder}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          style={{
            width: '100%', padding: '10px 40px 10px 12px', borderRadius: 8, fontSize: 14,
            background: 'var(--bg3)',
            border: `1px solid ${isSelected ? 'rgba(99,102,241,.5)' : 'var(--border2)'}`,
            color: 'var(--text)', boxSizing: 'border-box',
          }}
        />
        <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--muted)', pointerEvents: 'none' }}>
          {searching ? '⏳' : isSelected ? '✓' : '🔍'}
        </span>
      </div>

      {isSelected && (
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#818cf8', background: 'rgba(99,102,241,.12)', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
            {value}
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedName}</span>
          <button
            onClick={() => { setQuery(''); setSelectedName(''); onChange('', ''); }}
            style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
          >✕</button>
        </div>
      )}

      {!isSelected && query && !open && !searching && results.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
          {market === 'domestic' ? '6자리 코드를 직접 입력하거나 종목명으로 검색하세요' : 'EXCH:TICKER 형식으로 직접 입력하세요 (예: NAS:AAPL)'}
        </div>
      )}

      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: 'var(--bg2)', border: '1px solid var(--border2)',
          borderRadius: 10, marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,.4)',
          maxHeight: 320, overflowY: 'auto',
        }}>
          {results.map((r, i) => (
            <button
              key={r.symbol}
              onClick={() => handleSelect(r)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                padding: '10px 14px', gap: 10, background: 'none',
                borderBottom: i < results.length - 1 ? '1px solid var(--border2)' : 'none',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', background: 'rgba(99,102,241,.12)', borderRadius: 5, padding: '2px 6px', flexShrink: 0, fontFamily: 'monospace' }}>
                {r.symbol}
              </span>
              <span style={{ fontSize: 14, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.name}
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                {r.market === 'domestic' ? '🇰🇷' : '🌐'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScenarioBuilder({ initialValues, onAnalyze, loading = false }: Props) {
  const fxRate = useFxRate();
  const [market, setMarket] = useState<'domestic' | 'overseas'>(initialValues?.market ?? 'domestic');
  const fmtPrice = useMemo(
    () => (price: number) => fmtMarketPrice(price, market, fxRate),
    [market, fxRate],
  );
  const [symbol, setSymbol] = useState(initialValues?.symbol ?? '');
  const [symbolName, setSymbolName] = useState(initialValues?.symbolName ?? '');
  const [direction, setDirection] = useState<'buy' | 'sell'>(initialValues?.direction ?? 'buy');
  const [currentPrice, setCurrentPrice] = useState<number | null>(initialValues?.currentPrice ?? null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [splits, setSplits] = useState<1|2|3|4>((initialValues?.splits ?? 1) as 1|2|3|4);
  const [sliceInputs, setSliceInputs] = useState<SliceInput[]>(() => {
    const targetSplits = (initialValues?.splits ?? 1) as number;
    const dir = initialValues?.direction ?? 'buy';
    const cp = initialValues?.currentPrice ?? null;
    if (initialValues?.manualSlices && initialValues.manualSlices.length > 0) {
      const restored = initialValues.manualSlices.map(s => ({
        ...s,
        zoneLoPct: s.zoneLoPct ?? '',
        zoneHiPct: s.zoneHiPct ?? '',
      }));
      // splits보다 적으면 나머지를 기본값으로 채움 (이전 validate가 skip했던 케이스 복구)
      if (restored.length < targetSplits) {
        const extra = initSlices(dir, targetSplits, cp).slice(restored.length);
        return [...restored, ...extra];
      }
      return restored;
    }
    return initSlices(dir, targetSplits, cp);
  });
  const [holdingDeadline, setHoldingDeadline] = useState(initialValues?.holdingDeadline ?? defaultDeadline(3));
  const [formError, setFormError] = useState<string | null>(null);

  const fetchHoldings = useCallback(async () => {
    setHoldingsLoading(true);
    try {
      const res = await fetch('/api/portfolio');
      const data = await res.json();
      if (data.ok) {
        const raw: Holding[] = (data.data?.holdings ?? [])
          .filter((h: Record<string, unknown>) => !h.is_cash && h.symbol && (h.qty as number) > 0)
          .map((h: Record<string, unknown>) => ({
            symbol: h.symbol as string,
            qty: h.qty as number,
            price: h.price as number,
            value_krw: h.value_krw as number,
          }));
        const withNames = await Promise.all(
          raw.map(async h => {
            try {
              const r = await fetch(`/api/symbols/lookup?symbol=${encodeURIComponent(h.symbol)}`);
              const d = await r.json();
              return { ...h, name: d.ok ? (d.name as string) : undefined };
            } catch { return h; }
          })
        );
        setHoldings(withNames);
      }
    } catch { /* ignore */ }
    finally { setHoldingsLoading(false); }
  }, []);

  const fetchPrice = useCallback(async (sym: string) => {
    if (!sym) { setCurrentPrice(null); return; }
    setPriceLoading(true);
    try {
      const res = await fetch(`/api/ticker?symbol=${encodeURIComponent(sym)}`);
      const data = await res.json();
      if (data.ok && data.data?.price) setCurrentPrice(data.data.price);
      else setCurrentPrice(null);
    } catch { setCurrentPrice(null); }
    finally { setPriceLoading(false); }
  }, []);

  function handleSymbolChange(sym: string, name?: string) {
    const s = sym.trim().toUpperCase();
    setSymbol(s);
    setSymbolName(name ?? '');
    setCurrentPrice(null);
    if (s) fetchPrice(s);
  }

  function handleDirectionChange(d: 'buy' | 'sell') {
    setDirection(d);
    setSymbol('');
    setSymbolName('');
    setCurrentPrice(null);
    setSliceInputs(initSlices(d, splits, null));
    if (d === 'sell') fetchHoldings();
  }

  function handleSplitsChange(n: 1|2|3|4) {
    setSplits(n);
    setSliceInputs(prev => {
      const next = initSlices(direction, n, currentPrice);
      return next.map((s, i) => {
        if (!prev[i]) return s;
        return {
          ...s,
          qty: prev[i].qty,
          zoneLo: prev[i].zoneLo || s.zoneLo,
          zoneHi: prev[i].zoneHi || s.zoneHi,
          zoneLoPct: prev[i].zoneLoPct || s.zoneLoPct,
          zoneHiPct: prev[i].zoneHiPct || s.zoneHiPct,
        };
      });
    });
  }

  function handleHoldingSelect(h: Holding) {
    const isOverseas = h.symbol.includes(':');
    setMarket(isOverseas ? 'overseas' : 'domestic');
    setSymbol(h.symbol);
    setSymbolName('');
    setCurrentPrice(null);
    // 매도 방향: 각 슬라이스 qty는 빈 값으로 초기화
    setSliceInputs(initSlices('sell', splits, null));
    fetchPrice(h.symbol);
  }

  // 마운트 시 sell 방향이면 보유종목 로드 (분석→수정하기 재마운트 포함)
  useEffect(() => {
    if (direction === 'sell') {
      fetchHoldings();
      // initialValues에서 복원된 currentPrice가 없으면 종목 현재가 재조회
      if (symbol && !currentPrice) fetchPrice(symbol);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // currentPrice 로드 완료 시 슬라이스 갱신
  useEffect(() => {
    if (!currentPrice) return;
    setSliceInputs(prev => {
      const base = initSlices(direction, splits, currentPrice);
      return prev.map((s, i) => {
        // pct가 입력돼 있으면 KRW만 재계산, 아니면 base 사용 (매수·매도 공통)
        const loPct = parseFloat(s.zoneLoPct);
        const hiPct = parseFloat(s.zoneHiPct);
        if (Number.isFinite(loPct) && Number.isFinite(hiPct)) {
          return {
            ...s,
            zoneLo: String(pctToKrw(currentPrice, loPct)),
            zoneHi: String(pctToKrw(currentPrice, hiPct)),
          };
        }
        return { ...base[i], qty: s.qty };
      });
    });
  }, [currentPrice, direction, splits]);

  function handleCopyFirst() {
    setSliceInputs(prev => {
      if (prev.length < 2) return prev;
      const first = prev[0];
      const loPct = parseFloat(first.zoneLoPct);
      const hiPct = parseFloat(first.zoneHiPct);
      if (!Number.isFinite(loPct) || !Number.isFinite(hiPct)) return prev;
      const step = hiPct - loPct; // 1회차 구간 폭 → 이후 회차에 동일 폭으로 이어서 적용
      return prev.map((s, i) => {
        if (i === 0) return s;
        const sliceLoPct = hiPct + (i - 1) * step;
        const sliceHiPct = hiPct + i * step;
        return {
          ...s,
          qty: first.qty,
          zoneLoPct: sliceLoPct.toFixed(1),
          zoneHiPct: sliceHiPct.toFixed(1),
          zoneLo: currentPrice ? String(pctToKrw(currentPrice, sliceLoPct)) : '',
          zoneHi: currentPrice ? String(pctToKrw(currentPrice, sliceHiPct)) : '',
        };
      });
    });
  }

  function updateSlice(index: number, field: keyof SliceInput, value: string) {
    setSliceInputs(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }

  // 매도 수량 입력 전용 — 이후 회차의 초과 수량을 자동으로 0으로 리셋
  function updateSellQty(index: number, value: string) {
    const total = Math.floor(currentHoldingQty() ?? 0);
    setSliceInputs(prev => {
      const next = prev.map((s, i) => i === index ? { ...s, qty: value } : { ...s });
      let used = 0;
      for (let i = 0; i < next.length; i++) {
        const q = parseInt(next[i].qty, 10) || 0;
        if (i <= index) {
          used += q;
        } else {
          const remaining = Math.max(0, total - used);
          next[i] = { ...next[i], qty: remaining <= 0 ? '0' : String(Math.min(parseInt(next[i].qty, 10) || 0, remaining)) };
          used += parseInt(next[i].qty, 10) || 0;
        }
      }
      return next;
    });
  }

  function updateSlicePct(index: number, field: 'zoneLoPct' | 'zoneHiPct', value: string) {
    setSliceInputs(prev => prev.map((s, i) => {
      if (i !== index) return s;
      const pct = parseFloat(value);
      const krwField = field === 'zoneLoPct' ? 'zoneLo' : 'zoneHi';
      const krwValue = currentPrice && Number.isFinite(pct)
        ? String(pctToKrw(currentPrice, pct))
        : '';
      return { ...s, [field]: value, [krwField]: krwValue };
    }));
  }

  function currentHoldingQty(): number | undefined {
    return holdings.find(h => h.symbol === symbol)?.qty;
  }

  const inputStyle: React.CSSProperties = {
    flex: 1, padding: '9px 10px', borderRadius: 8, fontSize: 13,
    background: 'var(--bg)', border: '1px solid var(--border2)',
    color: 'var(--text)', fontWeight: 600, boxSizing: 'border-box',
    minWidth: 0,
  };

  function validate(): BuilderValues | null {
    if (!symbol.trim()) { setFormError('종목을 선택하거나 코드를 입력하세요'); return null; }
    if (sliceInputs.length !== splits) { setFormError('회차 설정 오류'); return null; }

    const totalHolding = direction === 'sell' ? Math.floor(currentHoldingQty() ?? 0) : 0;
    const finalSlices: SliceInput[] = [];
    let usedSellQty = 0;
    let hasValidQty = false;

    for (let i = 0; i < sliceInputs.length; i++) {
      const s = sliceInputs[i];
      const qty = parseInt(s.qty, 10);

      // 구간 검증 (매수·매도 공통 — pct 기반)
      const loPct = parseFloat(s.zoneLoPct);
      const hiPct = parseFloat(s.zoneHiPct);
      if (!Number.isFinite(loPct)) { setFormError(`${i+1}회차: 진입 구간 하단 %를 입력하세요`); return null; }
      if (!Number.isFinite(hiPct)) { setFormError(`${i+1}회차: 진입 구간 상단 %를 입력하세요`); return null; }
      if (loPct >= hiPct) { setFormError(`${i+1}회차: 하단 %가 상단 %보다 작아야 합니다`); return null; }

      const zoneLo = currentPrice ? String(pctToKrw(currentPrice, loPct)) : s.zoneLo;
      const zoneHi = currentPrice ? String(pctToKrw(currentPrice, hiPct)) : s.zoneHi;

      if (direction === 'sell') {
        const remaining = Math.max(0, totalHolding - usedSellQty);
        if (remaining <= 0) {
          // 잔여 없는 회차: qty=0으로 저장 (복원 시 상태 유지, confirm에서 필터링)
          finalSlices.push({ ...s, zoneLo, zoneHi, qty: '0' });
          continue;
        }
        if (!Number.isFinite(qty) || qty <= 0) {
          setFormError(`${i+1}회차: 수량(주)을 입력하세요`); return null;
        }
        if (qty > remaining) {
          setFormError(`${i+1}회차: 매도 수량(${qty})이 잔여 수량(${remaining})보다 많습니다`); return null;
        }
        usedSellQty += qty;
        hasValidQty = true;
        finalSlices.push({ ...s, zoneLo, zoneHi, qty: String(qty) });
      } else {
        if (!Number.isFinite(qty) || qty <= 0) {
          setFormError(`${i+1}회차: 수량(주)을 정수로 입력하세요`); return null;
        }
        hasValidQty = true;
        finalSlices.push({ ...s, zoneLo, zoneHi, qty: String(qty) });
      }
    }

    if (!hasValidQty) {
      setFormError('수량이 설정된 회차가 없습니다'); return null;
    }

    const totalQty = finalSlices.reduce((acc, sl) => acc + (parseInt(sl.qty, 10) || 0), 0);

    setFormError(null);
    return {
      market,
      symbol: symbol.trim().toUpperCase(),
      symbolName,
      direction,
      currentPrice: currentPrice ?? undefined,
      splits,
      manualSlices: finalSlices,
      holdingDeadline,
      totalQty,
    };
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '16px 0' }}>

      {/* 방향 */}
      <div>
        <FieldLabel>방향</FieldLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button onClick={() => handleDirectionChange('buy')} style={{
            height: 44, borderRadius: 8, fontSize: 14, fontWeight: 700,
            background: direction === 'buy' ? 'rgba(239,68,68,.2)' : 'var(--bg3)',
            color: direction === 'buy' ? 'var(--up)' : 'var(--muted)',
            border: `2px solid ${direction === 'buy' ? 'rgba(239,68,68,.5)' : 'var(--border2)'}`,
          }}>매수</button>
          <button onClick={() => handleDirectionChange('sell')} style={{
            height: 44, borderRadius: 8, fontSize: 14, fontWeight: 700,
            background: direction === 'sell' ? 'rgba(59,130,246,.2)' : 'var(--bg3)',
            color: direction === 'sell' ? 'var(--down)' : 'var(--muted)',
            border: `2px solid ${direction === 'sell' ? 'rgba(59,130,246,.5)' : 'var(--border2)'}`,
          }}>매도</button>
        </div>
      </div>

      {/* 종목 — 매수: 시장구분+검색 / 매도: 보유 종목 피커 */}
      {direction === 'buy' ? (
        <>
          <div>
            <FieldLabel>시장 구분</FieldLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {(['domestic', 'overseas'] as const).map(m => {
                const active = market === m;
                return (
                  <button key={m}
                    onClick={() => { setMarket(m); setSymbol(''); setSymbolName(''); setCurrentPrice(null); }}
                    style={{
                      height: 44, borderRadius: 8, fontSize: 14, fontWeight: 700,
                      background: active ? 'rgba(99,102,241,.2)' : 'var(--bg3)',
                      color: active ? '#818cf8' : 'var(--muted)',
                      border: `2px solid ${active ? 'rgba(99,102,241,.5)' : 'var(--border2)'}`,
                    }}
                  >
                    {m === 'domestic' ? '🇰🇷 국내' : '🌐 해외'}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <FieldLabel>종목 검색</FieldLabel>
            <SymbolSearchInput market={market} value={symbol} onChange={handleSymbolChange} />
            {(priceLoading || currentPrice) && (
              <div style={{
                marginTop: 8, padding: '8px 12px', borderRadius: 8,
                background: 'var(--bg2)', border: '1px solid var(--border2)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>현재가</span>
                <span className="num" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                  {priceLoading ? '조회 중...' : currentPrice ? fmtPrice(currentPrice) : '—'}
                </span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div>
          <FieldLabel>보유 종목 선택</FieldLabel>
          {holdingsLoading && (
            <div style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0', textAlign: 'center' }}>불러오는 중...</div>
          )}
          {!holdingsLoading && holdings.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0', textAlign: 'center' }}>보유 종목이 없습니다</div>
          )}
          {!holdingsLoading && holdings.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {holdings.map(h => {
                const isOverseas = h.symbol.includes(':');
                const selected = symbol === h.symbol;
                return (
                  <button
                    key={h.symbol}
                    onClick={() => handleHoldingSelect(h)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', borderRadius: 10, textAlign: 'left',
                      background: selected ? 'rgba(59,130,246,.15)' : 'var(--bg3)',
                      border: `2px solid ${selected ? 'rgba(59,130,246,.5)' : 'var(--border2)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13 }}>{isOverseas ? '🌐' : '🇰🇷'}</span>
                      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{h.symbol}</span>
                      {h.name && <span style={{ fontSize: 12, color: 'var(--muted)' }}>({h.name})</span>}
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{Math.floor(h.qty)}주</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                      <span className="num" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{fmtPrice(h.price)}</span>
                      <span className="num" style={{ fontSize: 11, color: 'var(--muted)' }}>평가 {fmtPrice(Math.round(h.value_krw))}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {symbol && (priceLoading || currentPrice) && (
            <div style={{
              marginTop: 8, padding: '8px 12px', borderRadius: 8,
              background: 'var(--bg2)', border: '1px solid var(--border2)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{symbol} 현재가</span>
              <span className="num" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                {priceLoading ? '조회 중...' : currentPrice ? fmtPrice(currentPrice) : '—'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 분할 매수/매도 설정 */}
      <div>
        <FieldLabel>분할 {direction === 'buy' ? '매수' : '매도'} 설정</FieldLabel>

        {/* 분할 횟수 버튼 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 14 }}>
          {([1, 2, 3, 4] as const).map(n => (
            <button
              key={n}
              onClick={() => handleSplitsChange(n)}
              style={{
                height: 40, borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: splits === n ? 'rgba(99,102,241,.2)' : 'var(--bg3)',
                color: splits === n ? '#818cf8' : 'var(--muted)',
                border: `2px solid ${splits === n ? 'rgba(99,102,241,.5)' : 'var(--border2)'}`,
              }}
            >
              {n === 1 ? '1회' : `${n}분할`}
            </button>
          ))}
        </div>

        {/* 회차별 슬라이스 카드 */}
        {sliceInputs.map((s, i) => {
          const isFirstBuy = direction === 'buy' && i === 0;
          const isLastBuy = direction === 'buy' && i === splits - 1;
          const isLastSell = direction === 'sell' && i === splits - 1;
          let subLabel = '';
          if (splits > 1) {
            if (isFirstBuy) subLabel = '(1차 매수)';
            else if (isLastBuy) subLabel = '(최종 매수)';
            else if (isLastSell) subLabel = '(최종 익절)';
            else if (direction === 'sell') subLabel = '(익절)';
          }

          return (
            <div key={i} style={{
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '12px 14px', marginBottom: 8,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 10 }}>
                {i + 1}회차 {subLabel}
              </div>

              {/* 진입 구간 — 매수·매도 공통 pct 입력 */}
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>
                진입 구간 (현재가 대비 %)
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <input
                  type="number"
                  value={s.zoneLoPct}
                  step="0.1"
                  onChange={e => updateSlicePct(i, 'zoneLoPct', e.target.value)}
                  placeholder={direction === 'buy' ? '-2.0' : '+0.5'}
                  style={inputStyle}
                />
                <span style={{ color: 'var(--muted)', flexShrink: 0 }}>~</span>
                <input
                  type="number"
                  value={s.zoneHiPct}
                  step="0.1"
                  onChange={e => updateSlicePct(i, 'zoneHiPct', e.target.value)}
                  placeholder={direction === 'buy' ? '-0.5' : '+2.0'}
                  style={inputStyle}
                />
                <span style={{ color: 'var(--muted)', flexShrink: 0, fontSize: 13, fontWeight: 700 }}>%</span>
              </div>
              {/* KRW 미리보기 */}
              {s.zoneLo && s.zoneHi && Number.isFinite(parseFloat(s.zoneLo)) && Number.isFinite(parseFloat(s.zoneHi)) && (
                <div style={{ marginBottom: 10, fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>
                  {fmtPrice(parseFloat(s.zoneLo))} ~ {fmtPrice(parseFloat(s.zoneHi))}
                </div>
              )}

              {/* 수량 */}
              {(() => {
                // 매도: 이전 회차 누적 사용량 계산 → 잔여 수량 산출
                const holdingQty = direction === 'sell' ? (currentHoldingQty() ?? 0) : 0;
                const usedQty = direction === 'sell'
                  ? sliceInputs.slice(0, i).reduce((acc, sl) => acc + (parseInt(sl.qty, 10) || 0), 0)
                  : 0;
                const remaining = direction === 'sell' ? Math.max(0, Math.floor(holdingQty) - usedQty) : Infinity;
                const disabled = direction === 'sell' && remaining <= 0;

                return (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>수량 (주)</span>
                      {direction === 'sell' && holdingQty > 0 && (
                        <span style={{ fontSize: 11, color: disabled ? 'var(--danger)' : 'var(--muted)' }}>
                          잔여 <span className="num" style={{ fontWeight: 700, color: disabled ? 'var(--danger)' : 'var(--accent)' }}>
                            {remaining}
                          </span>주
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max={direction === 'sell' ? remaining : undefined}
                        step="1"
                        value={disabled ? '0' : s.qty}
                        disabled={disabled}
                        onChange={e => {
                          if (direction === 'sell') {
                            const v = parseInt(e.target.value, 10);
                            const clamped = Number.isFinite(v) && v > remaining ? remaining : (Number.isFinite(v) ? v : 0);
                            updateSellQty(i, String(clamped));
                          } else {
                            updateSlice(i, 'qty', e.target.value);
                          }
                        }}
                        placeholder={disabled ? '0' : '수량'}
                        style={{
                          ...inputStyle,
                          opacity: disabled ? 0.4 : 1,
                          cursor: disabled ? 'not-allowed' : 'text',
                        }}
                      />
                      {direction === 'sell' && !disabled && (
                        <button
                          onClick={() => updateSellQty(i, String(remaining))}
                          style={{
                            padding: '0 14px', height: 40, borderRadius: 8, fontSize: 13, fontWeight: 700,
                            background: 'rgba(59,130,246,.15)', color: 'var(--down)',
                            border: '1px solid rgba(59,130,246,.3)', flexShrink: 0,
                          }}
                        >
                          잔량
                        </button>
                      )}
                    </div>
                  </>
                );
              })()}

              {/* 예상 금액 미리보기 (qty × priceMid) */}
              {(() => {
                const qty = parseInt(s.qty, 10);
                const lo = parseFloat(s.zoneLo);
                const hi = parseFloat(s.zoneHi);
                if (!Number.isInteger(qty) || qty <= 0) return null;
                if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
                const priceMid = roundToTick((lo + hi) / 2);
                const estimated = qty * priceMid;
                return (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
                    예상 금액: <span className="num" style={{ color: 'var(--text)', fontWeight: 700 }}>
                      {fmtPrice(estimated)}
                    </span>
                    <span style={{ marginLeft: 4 }}>({qty}주 × {fmtPrice(priceMid)})</span>
                  </div>
                );
              })()}
            </div>
          );
        })}

        {/* 1회차 설정 복사 버튼 (2분할 이상일 때만 표시) */}
        {splits > 1 && (
          <button
            onClick={handleCopyFirst}
            style={{
              width: '100%', height: 38, borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'rgba(99,102,241,.12)', color: '#818cf8',
              border: '1px solid rgba(99,102,241,.3)',
              marginTop: 2,
            }}
          >
            설정내용 복사 (1회차 → 전체)
          </button>
        )}
      </div>

      {/* 보유 마감기한 */}
      <div>
        <FieldLabel>보유 마감기한</FieldLabel>
        <input
          type="date" value={holdingDeadline} min={todayStr()}
          onChange={e => setHoldingDeadline(e.target.value)}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14,
            background: 'var(--bg3)', border: '1px solid var(--border2)',
            color: 'var(--text)', boxSizing: 'border-box', colorScheme: 'dark',
          }}
        />
        {holdingDeadline && (
          <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 5, fontWeight: 600 }}>
            {formatDeadlineLabel(holdingDeadline)}
          </div>
        )}
      </div>

      {/* 에러 */}
      {formError && (
        <div style={{ fontSize: 13, color: 'var(--danger)', padding: '8px 12px', background: 'rgba(239,68,68,.1)', borderRadius: 8, border: '1px solid rgba(239,68,68,.3)' }}>
          {formError}
        </div>
      )}

      {/* AI 분석 버튼 */}
      <button
        onClick={() => { const v = validate(); if (v) onAnalyze(v); }}
        disabled={loading}
        style={{
          height: 52, borderRadius: 10, fontSize: 16, fontWeight: 700,
          background: loading ? 'var(--bg3)' : 'rgba(99,102,241,.9)',
          color: loading ? 'var(--muted)' : '#fff',
          opacity: loading ? 0.8 : 1,
        }}
      >
        {loading ? '분석 중...' : 'AI 분석 요청 →'}
      </button>
    </div>
  );
}

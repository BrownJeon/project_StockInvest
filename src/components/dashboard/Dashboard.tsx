'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CandleChart } from '@/components/CandleChart';
import { PnlChip } from '@/components/PnlChip';
import { SafetyBar } from '@/components/SafetyBar';
import { fmtNum, fmtPnl, pnlColor } from '@/lib/format';
import { formatRelativeTime, formatDateTimeKST, kstTodayStart } from '@/lib/time';
import { formatSymbolShort, symbolUnit } from '@/lib/symbols';
import type { Candle, Ticker } from '@/lib/exchanges/types';

interface Props {
  allowedSymbols: string[];
  defaultSymbol: string;
}

type Interval = '30m' | '1h' | '1d';

interface StrategyRow {
  id: string;
  name: string;
  tags: string[];
  enabled: boolean;
  stats: { return7d: number; winRate: number; signalCount: number };
}

type OrderStatus = 'pending' | 'accepted' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected' | 'failed' | 'dry_run' | 'blocked';

interface OrderRow {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price: string | null;
  quantity: string | null;
  amount_krw: string | null;
  status: OrderStatus;
  blocked_by: string | null;
  source: 'manual' | 'signal' | 'auto';
  created_at: string;
}

interface PortfolioHolding {
  currency: string;
  symbol: string | null;
  qty: number;
  price: number;
  value_krw: number;
  open24h_krw: number;
  change_24h_pct: number | null;
  is_cash: boolean;
}

interface PortfolioData {
  total_krw: number;
  cash_krw: number;
  cash_pct: number;
  change_24h_krw: number;
  change_24h_pct: number;
  today_open_krw: number | null;
  today_change_krw: number | null;
  today_change_pct: number | null;
  holdings: PortfolioHolding[];
  updated_at: string;
}

// 자동 새로고침 주기 (ms)
const REFRESH_MS = 30_000;

export function Dashboard({ allowedSymbols, defaultSymbol }: Props) {
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState<string>(defaultSymbol);
  const [interval, setInterval] = useState<Interval>('1d');
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);
  const [orders, setOrders]         = useState<OrderRow[]>([]);
  const [listTab, setListTab] = useState<'hold' | 'watch'>('hold');
  const [holdMarket, setHoldMarket] = useState<'all' | 'domestic' | 'overseas'>('all');
  const [holdPage, setHoldPage]   = useState(0);
  const [holdSort, setHoldSort]   = useState<'desc' | 'asc'>('desc');
  const [watchPage, setWatchPage] = useState(0);
  const PAGE_SIZE = 7;
  // 필터/탭 변경 시 첫 페이지로 리셋
  useEffect(() => { setHoldPage(0); }, [holdMarket, listTab, holdSort]);
  useEffect(() => { setWatchPage(0); }, [listTab]);
  const [todaySignalCount, setTodaySignalCount] = useState<number>(0);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [, forceTick] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [watchSymbols, setWatchSymbols] = useState<string[]>(allowedSymbols);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const [symbolMeta, setSymbolMeta] = useState<Record<string, string>>({});
  const [pickerFilter, setPickerFilter] = useState('');

  // 심볼 표시: '종목명 (코드)' 형태. 메타가 없으면 코드만.
  const displaySymbol = (s: string): string => {
    const name = symbolMeta[s];
    if (name && name !== s && name !== formatSymbolShort(s)) return `${name} (${s})`;
    return formatSymbolShort(s);
  };

  // 보유 종목 시장 분류 — 콜론 포함이면 해외(NAS:AAPL), 그 외 종목코드는 국내. 현금(KRW/USD)·null은 'cash'.
  const holdingMarket = (h: PortfolioHolding): 'domestic' | 'overseas' | 'cash' => {
    if (h.is_cash || !h.symbol) return 'cash';
    return h.symbol.includes(':') ? 'overseas' : 'domestic';
  };

  // 관심 종목 DB 동기화
  useEffect(() => {
    fetch('/api/settings/watch-symbols')
      .then(r => r.json())
      .then(j => { if (j.ok) setWatchSymbols(j.symbols ?? []); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!pickerOpen || allSymbols.length > 0) return;
    fetch('/api/ticker/all')
      .then(r => r.json())
      .then(j => {
        if (j.ok) {
          setAllSymbols(j.symbols ?? []);
          if (j.meta) setSymbolMeta(prev => ({ ...prev, ...(j.meta as Record<string, string>) }));
        }
      })
      .catch(() => {});
  }, [pickerOpen, allSymbols.length]);

  function saveWatchSymbols(symbols: string[]) {
    setWatchSymbols(symbols);
    fetch('/api/settings/watch-symbols', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols }),
    }).catch(() => {});
  }

  // 자동 새로고침 + 상대 시각 표시용 tick
  useEffect(() => {
    const iv = window.setInterval(() => setReloadKey((k) => k + 1), REFRESH_MS);
    const tick = window.setInterval(() => forceTick((n) => n + 1), 10_000);
    return () => { window.clearInterval(iv); window.clearInterval(tick); };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/strategies').then(r => r.json()).then(j => {
      if (alive && j.ok) setStrategies(j.strategies ?? []);
    }).catch(() => {});
    return () => { alive = false; };
  }, [reloadKey]);

  useEffect(() => {
    let alive = true;
    fetch('/api/orders?limit=20').then(r => r.json()).then(j => {
      if (alive && j.ok) setOrders(j.data ?? []);
    }).catch(() => {});
    return () => { alive = false; };
  }, [reloadKey]);

  useEffect(() => {
    let alive = true;
    fetch('/api/signals?limit=200').then(r => r.json()).then(j => {
      if (!alive || !j.ok) return;
      const todayKey = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
      const count = (j.data as { created_at: string }[]).filter(s =>
        new Date(s.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }) === todayKey
      ).length;
      setTodaySignalCount(count);
    }).catch(() => {});
    return () => { alive = false; };
  }, [reloadKey]);

  useEffect(() => {
    let alive = true;
    setPortfolioError(null);
    fetch('/api/portfolio').then((r) => r.json()).then((j) => {
      if (!alive) return;
      if (j.ok) setPortfolio(j.data as PortfolioData);
      else setPortfolioError(j.error ?? 'unknown');
      setLastFetchedAt(Date.now());
    }).catch((e) => { if (alive) { setPortfolioError(String(e)); setLastFetchedAt(Date.now()); } });
    return () => { alive = false; };
  }, [reloadKey]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ticker?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((j) => {
      if (alive && j.ok) setTicker(j.data as Ticker);
    }).catch(() => {});
    return () => { alive = false; };
  }, [symbol, reloadKey]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&count=120`)
      .then((r) => r.json()).then((j) => {
        if (alive && j.ok) setCandles(j.data as Candle[]);
      }).catch(() => {});
    return () => { alive = false; };
  }, [symbol, interval, reloadKey]);

  const isWhitelisted = (s: string) => watchSymbols.includes(s);

  const chipSymbols = useMemo(() => {
    const set = new Set<string>(watchSymbols);
    portfolio?.holdings.forEach((h) => { if (h.symbol) set.add(h.symbol); });
    return [...set];
  }, [watchSymbols, portfolio]);

  // chipSymbols 중 메타가 없는 항목 lazy fetch (관심·보유 표시 즉시 반영)
  useEffect(() => {
    const targets = [symbol, ...chipSymbols].filter((s, i, arr) => s && arr.indexOf(s) === i && !symbolMeta[s]);
    if (targets.length === 0) return;
    let alive = true;
    Promise.all(targets.map(async s => {
      try {
        const r = await fetch(`/api/symbols/lookup?symbol=${encodeURIComponent(s)}`);
        const j = await r.json();
        return j.ok ? { sym: s, name: j.name as string } : null;
      } catch { return null; }
    })).then(results => {
      if (!alive) return;
      const next: Record<string, string> = {};
      for (const r of results) if (r) next[r.sym] = r.name;
      if (Object.keys(next).length > 0) setSymbolMeta(prev => ({ ...prev, ...next }));
    });
    return () => { alive = false; };
  }, [chipSymbols, symbol, symbolMeta]);

  const ticker24hPct = ticker?.open24h && ticker.open24h > 0
    ? ((ticker.price - ticker.open24h) / ticker.open24h) * 100
    : null;

  const [marketStatus, setMarketStatus] = useState<{
    current: 'domestic' | 'overseas' | null;
    domestic: { open: boolean; nextOpenInMs: number; sessionLabel: string };
    overseas: { open: boolean; nextOpenInMs: number; sessionLabel: string };
    fx: { usdKrw: number } | null;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/markets/status').then(r => r.json()).then(j => {
      if (alive && j.ok) setMarketStatus(j);
    }).catch(() => {});
    load();
    const iv = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(iv); };
  }, []);

  return (
    <main style={{ display: 'grid', gridTemplateRows: 'auto auto auto auto auto auto auto auto auto' }}>

      {/* 상단 요약 — 단일 컬럼 흐름 (모바일 412px 최적화) */}
      <div style={sx.top}>
        {/* Row 1: 브랜드 + 새로고침 (양 끝 정렬) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
          <div style={{ ...sx.brand, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Stock<span style={{ color: 'var(--accent)' }}>·</span>Invest — 국내 · 해외 주식
          </div>
          <button style={sx.refresh} aria-label="새로고침" onClick={() => setReloadKey((k) => k + 1)}>↻</button>
        </div>

        {/* Row 2: 시장 배지 (좌측 정렬, 풀폭) */}
        <Link href="/markets" aria-label="시장 상태 상세" style={{ textDecoration: 'none', display: 'inline-block', maxWidth: '100%' }}>
          <MarketBadge status={marketStatus} />
        </Link>

        {/* Row 3: 총 평가액 (큰 숫자) */}
        <div className="num" style={sx.total}>
          {portfolio ? fmtNum(portfolio.total_krw) : '-'}{' '}
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>KRW</span>
        </div>

        {/* Row 4: 등락률·현금%·갱신 시각 */}
        <div style={sx.sub}>
          {portfolioError ? (
            <span style={{ fontSize: 12, color: 'var(--danger)' }}>
              잔고 조회 실패: {portfolioError.slice(0, 40)}
            </span>
          ) : portfolio ? (
            <>
              <span className="num" style={{ fontSize: 13, fontWeight: 600, color: pnlColor(portfolio.change_24h_pct) }}>
                {fmtPnl(portfolio.change_24h_pct)} (당일)
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                · 현금 <span className="num">{portfolio.cash_pct.toFixed(1)}%</span>
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
                {formatRelativeTime(lastFetchedAt)}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>로딩...</span>
          )}
        </div>
      </div>

      {/* 자동매매 상태 카드 */}
      <AutoTradingStatusCard portfolio={portfolio} strategies={strategies} orders={orders} todaySignalCount={todaySignalCount} />

      {/* 운용 전략 */}
      <ActiveStrategiesSection strategies={strategies} />

      {/* 최근 체결 타임라인 */}
      <RecentExecutionsSection orders={orders} symbolMeta={symbolMeta} />

      {/* 보유/관심 탭 */}
      <div style={sx.tabs}>
        <TabBtn label={`보유 ${portfolio?.holdings.filter((h) => !h.is_cash || h.qty > 0).length ?? '-'}`} active={listTab === 'hold'} onClick={() => setListTab('hold')} />
        <TabBtn label={`관심 ${watchSymbols.length}`} active={listTab === 'watch'} onClick={() => setListTab('watch')} />
      </div>

      {/* 리스트 */}
      <div style={{ background: 'var(--bg)', overflowY: 'auto' }}>
        {listTab === 'hold' ? (
          (() => {
            if (!portfolio) return null;
            const all = portfolio.holdings;
            const domCount = all.filter(h => holdingMarket(h) === 'domestic').length;
            const ovsCount = all.filter(h => holdingMarket(h) === 'overseas').length;
            const baseFiltered = holdMarket === 'all'
              ? all
              : all.filter(h => holdingMarket(h) === holdMarket || h.is_cash);
            // 금액(value_krw) 정렬 — 현금 항목은 정렬 무관하게 항상 최상단
            const filtered = [...baseFiltered].sort((a, b) => {
              if (a.is_cash !== b.is_cash) return a.is_cash ? -1 : 1;
              if (a.is_cash && b.is_cash) return 0;
              const va = a.value_krw ?? 0;
              const vb = b.value_krw ?? 0;
              return holdSort === 'desc' ? vb - va : va - vb;
            });
            const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
            const safePage   = Math.min(holdPage, totalPages - 1);
            const pageItems  = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
            return (
              <>
                <div style={{
                  display: 'flex', gap: 6, padding: '8px 12px', alignItems: 'center',
                  background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
                }}>
                  <FilterChip label={`전체 ${domCount + ovsCount}`} active={holdMarket === 'all'}      onClick={() => setHoldMarket('all')} />
                  <FilterChip label={`🇰🇷 ${domCount}`}              active={holdMarket === 'domestic'} onClick={() => setHoldMarket('domestic')} />
                  <FilterChip label={`🇺🇸 ${ovsCount}`}              active={holdMarket === 'overseas'} onClick={() => setHoldMarket('overseas')} />
                  <button
                    onClick={() => setHoldSort(s => s === 'desc' ? 'asc' : 'desc')}
                    title={holdSort === 'desc' ? '금액 내림차순 (높은순)' : '금액 오름차순 (낮은순)'}
                    style={{
                      marginLeft: 'auto',
                      display: 'flex', alignItems: 'center', gap: 4,
                      fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 14,
                      background: 'var(--bg3)', border: '1px solid var(--border2)',
                      color: 'var(--text)', cursor: 'pointer',
                    }}
                  >
                    금액 {holdSort === 'desc' ? '↓' : '↑'}
                  </button>
                </div>
                {filtered.length
                  ? (
                    <>
                      {pageItems.map((h) => (
                        <HoldingRow
                          key={h.currency}
                          h={h}
                          market={holdingMarket(h)}
                          isActive={h.symbol === symbol}
                          isWhitelisted={h.symbol ? isWhitelisted(h.symbol) : false}
                          onSelect={() => h.symbol && setSymbol(h.symbol)}
                          displayName={h.symbol ? displaySymbol(h.symbol) : null}
                        />
                      ))}
                      <Pager page={safePage} totalPages={totalPages} totalItems={filtered.length} onChange={setHoldPage} />
                    </>
                  )
                  : (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                      해당 시장의 보유 자산이 없습니다.
                    </div>
                  )}
              </>
            );
          })()
        ) : (
          <>
            {/* 관심 종목 추가 버튼 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
              <button
                onClick={() => { setPickerOpen(v => !v); setPickerFilter(''); }}
                style={{
                  fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 20,
                  background: pickerOpen ? 'var(--bg3)' : 'rgba(99,102,241,.15)',
                  color: pickerOpen ? 'var(--muted)' : '#818cf8',
                  border: '1px solid ' + (pickerOpen ? 'var(--border2)' : 'rgba(99,102,241,.3)'),
                }}
              >{pickerOpen ? '닫기' : '+ 종목 추가'}</button>
            </div>

            {/* 심볼 피커 */}
            {pickerOpen && (
              <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ padding: '8px 12px' }}>
                  <input
                    autoFocus
                    placeholder="종목명 또는 코드 검색 (예: 삼성전자, 005930, AAPL)"
                    value={pickerFilter}
                    onChange={e => setPickerFilter(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13,
                      background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {allSymbols.length === 0 ? (
                    <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>로딩...</div>
                  ) : (
                    allSymbols
                      .filter(s => {
                        if (watchSymbols.includes(s)) return false;
                        if (pickerFilter === '') return true;
                        const q = pickerFilter.toLowerCase();
                        const name = (symbolMeta[s] ?? '').toLowerCase();
                        return s.toLowerCase().includes(q) || name.includes(q);
                      })
                      .slice(0, 30)
                      .map(s => {
                        const name = symbolMeta[s];
                        const display = name && name !== s ? `${name} (${s})` : formatSymbolShort(s);
                        return (
                          <button
                            key={s}
                            onClick={() => { saveWatchSymbols([...watchSymbols, s]); setPickerOpen(false); }}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              width: '100%', padding: '10px 16px', borderBottom: '1px solid var(--border)',
                              fontSize: 13, color: 'var(--text)', textAlign: 'left',
                            }}
                          >
                            <span style={{ fontWeight: 600 }}>{display}</span>
                            <span style={{ fontSize: 11, color: '#818cf8' }}>+ 추가</span>
                          </button>
                        );
                      })
                  )}
                </div>
              </div>
            )}

            {/* 관심 종목 리스트 (페이징) */}
            {(() => {
              const totalPages = Math.max(1, Math.ceil(watchSymbols.length / PAGE_SIZE));
              const safePage   = Math.min(watchPage, totalPages - 1);
              const pageItems  = watchSymbols.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
              return (
                <>
                  {pageItems.map((s) => (
                    <WatchRow
                      key={s}
                      symbol={s}
                      displayName={displaySymbol(s)}
                      active={s === symbol}
                      onClick={() => setSymbol(s)}
                      reloadKey={reloadKey}
                      onRemove={() => saveWatchSymbols(watchSymbols.filter(w => w !== s))}
                    />
                  ))}
                  {watchSymbols.length > 0 && (
                    <Pager page={safePage} totalPages={totalPages} totalItems={watchSymbols.length} onChange={setWatchPage} />
                  )}
                </>
              );
            })()}
            {watchSymbols.length === 0 && !pickerOpen && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                관심 종목이 없습니다. + 종목 추가를 눌러 추가하세요.
              </div>
            )}
          </>
        )}
      </div>

      {/* 차트 섹션 (우선순위 하위) */}
      <div style={sx.chartSection}>
        <div style={sx.chartHeader}>
          <span style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.6px', textTransform: 'uppercase' }}>
            차트
          </span>
        </div>

        <div style={sx.chips}>
          {chipSymbols.map((s) => {
            const active = s === symbol;
            const wl = isWhitelisted(s);
            return (
              <button
                key={s}
                onClick={() => setSymbol(s)}
                style={{
                  ...sx.chip,
                  background: active ? '#2b3244' : 'var(--bg3)',
                  borderColor: active ? '#3d4458' : 'var(--border2)',
                  color: active ? '#fff' : 'var(--text)',
                }}
              >
                {displaySymbol(s)}
                <span style={{
                  fontSize: 10, marginLeft: 6, padding: '1px 6px', borderRadius: 8,
                  background: 'rgba(0,0,0,.35)', color: wl ? '#22c55e' : 'var(--muted)',
                }}>
                  {wl ? '매매' : '조회'}
                </span>
              </button>
            );
          })}
        </div>

        <div style={sx.ivBar}>
          <div style={{ fontSize: 14, fontWeight: 700, flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displaySymbol(symbol)}</div>
          {ticker24hPct !== null && (
            <span className="num" style={{ fontSize: 12, fontWeight: 600, color: pnlColor(ticker24hPct), flexShrink: 0 }}>
              {fmtPnl(ticker24hPct)}
            </span>
          )}
          <div style={{ ...sx.ivs, flexShrink: 0 }}>
            {(['30m', '1h', '1d'] as Interval[]).map((iv) => (
              <button
                key={iv}
                onClick={() => setInterval(iv)}
                style={{
                  ...sx.iv,
                  background: iv === interval ? '#2b3244' : 'transparent',
                  color: iv === interval ? '#fff' : 'var(--muted)',
                }}
              >{iv}</button>
            ))}
          </div>
          <div className="num" style={{ fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
            {ticker ? fmtNum(ticker.price) : '-'}
          </div>
        </div>

        <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)', height: '32vh', minHeight: 200, maxHeight: 360 }}>
          <CandleChart data={candles} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 2, background: 'var(--border)' }}>
          <KpiBox label="당일 고" value={ticker?.high24h ? fmtNum(ticker.high24h) : '-'} />
          <KpiBox label="당일 저" value={ticker?.low24h ? fmtNum(ticker.low24h) : '-'} />
          <KpiBox
            label="당일 거래량"
            value={ticker?.volume24h ? fmtNum(ticker.volume24h, 2) + ' ' + symbolUnit(symbol) : '-'}
          />
        </div>
      </div>

      <SafetyBar />
    </main>
  );
}

const EXECUTED_STATUSES: OrderStatus[] = ['accepted', 'filled', 'partially_filled', 'dry_run'];

function todayStart() {
  return kstTodayStart().getTime();
}

function AutoTradingStatusCard({ portfolio, strategies, orders, todaySignalCount }: {
  portfolio: PortfolioData | null;
  strategies: StrategyRow[];
  orders: OrderRow[];
  todaySignalCount: number;
}) {
  const todayPct = portfolio?.today_change_pct;
  const todayKrw = portfolio?.today_change_krw;
  const hasTodayData = todayPct != null && todayKrw != null;

  const todayValue = hasTodayData
    ? (<span style={{ color: pnlColor(todayPct), display: 'inline-block' }}>{fmtPnl(todayPct)}</span>)
    : '준비 중';

  const todaySub = hasTodayData
    ? `${todayKrw >= 0 ? '+' : ''}${fmtNum(Math.round(todayKrw))} KRW`
    : '오늘 첫 접속';

  const activeCount   = strategies.filter(s => s.enabled).length;
  const ts            = todayStart();
  const todayExecuted = orders.filter(o =>
    EXECUTED_STATUSES.includes(o.status) && new Date(o.created_at).getTime() >= ts,
  ).length;

  return (
    <section style={sx.card}>
      <div style={sx.cardHeader}>
        <span style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.6px', textTransform: 'uppercase' }}>
          자동매매 상태
        </span>
      </div>
      <div style={sx.cardGrid}>
        <Stat label="활성 전략" value={String(activeCount)} />
        <Stat label="오늘 시그널" value={String(todaySignalCount)} />
        <Stat label="오늘 체결" value={String(todayExecuted)} />
        <Stat label="포트폴리오 오늘" value={todayValue} sub={todaySub} />
      </div>
    </section>
  );
}

function ActiveStrategiesSection({ strategies }: { strategies: StrategyRow[] }) {
  const active = strategies.filter(s => s.enabled);
  return (
    <section style={sx.card}>
      <div style={sx.cardHeader}>
        <span style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.6px', textTransform: 'uppercase' }}>
          운용 전략
        </span>
        <Link href="/strategy" style={{ fontSize: 11, color: 'var(--muted)' }}>전략 관리 →</Link>
      </div>
      {active.length === 0 ? (
        <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
          운용 중인 전략 없음 · 전략 탭에서 활성화
        </div>
      ) : (
        active.map(s => <ActiveStrategyItem key={s.id} strategy={s} />)
      )}
    </section>
  );
}

function ActiveStrategyItem({ strategy }: { strategy: StrategyRow }) {
  const r = strategy.stats.return7d;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 16px', borderTop: '1px solid var(--border)',
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{strategy.name}</div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' as const }}>
          {strategy.tags.slice(0, 2).map(t => (
            <span key={t} style={{
              fontSize: 10, padding: '2px 6px', borderRadius: 8,
              background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border2)',
            }}>{t}</span>
          ))}
        </div>
      </div>
      <div style={{ textAlign: 'right' as const, flexShrink: 0 }}>
        <div className="num" style={{ fontSize: 13, fontWeight: 700, color: pnlColor(r) }}>
          {r >= 0 ? '+' : ''}{r.toFixed(1)}%
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          시그널 {strategy.stats.signalCount}건
        </div>
      </div>
    </div>
  );
}

const ORDER_STATUS_META: Record<OrderStatus, { text: string; color: string; bg: string }> = {
  pending:          { text: '대기',     color: 'var(--muted)',   bg: 'var(--bg3)'              },
  accepted:         { text: '접수됨',   color: '#818cf8',        bg: 'rgba(99,102,241,.18)'    },
  partially_filled: { text: '부분체결', color: 'var(--accent)',  bg: 'rgba(245,158,11,.18)'    },
  filled:           { text: '체결됨',   color: 'var(--ok)',      bg: 'rgba(34,197,94,.18)'     },
  cancelled:        { text: '취소됨',   color: 'var(--muted)',   bg: 'var(--bg3)'              },
  rejected:         { text: '거부됨',   color: 'var(--down)',    bg: 'rgba(239,68,68,.15)'     },
  failed:           { text: '실패',     color: 'var(--down)',    bg: 'rgba(239,68,68,.15)'     },
  dry_run:          { text: '테스트',   color: 'var(--accent)',  bg: 'rgba(245,158,11,.15)'    },
  blocked:          { text: '차단됨',   color: 'var(--down)',    bg: 'rgba(239,68,68,.15)'     },
};

function fmtOrderAmount(o: OrderRow): string {
  if (o.amount_krw) return `₩${fmtNum(parseFloat(o.amount_krw))}`;
  if (o.quantity)   return `${parseFloat(o.quantity).toFixed(4)} ${symbolUnit(o.symbol)}`;
  if (o.price && o.quantity) return `₩${fmtNum(parseFloat(o.price) * parseFloat(o.quantity))}`;
  return '-';
}

function RecentExecutionsSection({ orders, symbolMeta }: { orders: OrderRow[]; symbolMeta: Record<string, string> }) {
  const fmtSymbol = (s: string) => {
    const name = symbolMeta[s];
    const idx = s.indexOf(':');
    const short = idx > 0 ? s.slice(idx + 1) : s;
    if (name && name !== s && name !== short) return `${name} (${s})`;
    return short;
  };
  const display = orders.slice(0, 10);

  return (
    <section style={sx.card}>
      <div style={sx.cardHeader}>
        <span style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.6px', textTransform: 'uppercase' }}>
          최근 주문
        </span>
        <Link href="/order" style={{ fontSize: 11, color: 'var(--muted)' }}>
          전체 보기 →
        </Link>
      </div>

      {display.length === 0 ? (
        <div style={{ padding: '16px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
          주문 이력 없음
        </div>
      ) : (
        display.map((o, i) => {
          const meta = ORDER_STATUS_META[o.status];
          return (
            <div key={o.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', gap: 8,
              borderTop: i === 0 ? '1px solid var(--border)' : undefined,
              borderBottom: '1px solid var(--border)',
            }}>
              {/* Side + Symbol */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, flexShrink: 0,
                  background: o.side === 'buy' ? 'rgba(239,68,68,.18)' : 'rgba(59,130,246,.18)',
                  color: o.side === 'buy' ? 'var(--up)' : 'var(--down)',
                }}>{o.side === 'buy' ? '매수' : '매도'}</span>
                <span style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {fmtSymbol(o.symbol)}
                </span>
              </div>

              {/* Amount + Status + Time */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span className="num" style={{ fontSize: 12, color: 'var(--text)' }}>
                  {fmtOrderAmount(o)}
                </span>
                <span style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 8, fontWeight: 600,
                  color: meta.color, background: meta.bg,
                }}>{meta.text}</span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {formatDateTimeKST(o.created_at)}
                </span>
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div style={{ background: 'var(--bg2)', padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
      <div className="num" style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub && <div className="num" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function KpiBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg2)', padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
      <div className="num" style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '14px 0', fontSize: 14, fontWeight: 600,
        color: active ? 'var(--text)' : 'var(--muted)',
        borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
      }}
    >{label}</button>
  );
}

function Pager({
  page, totalPages, totalItems, onChange,
}: {
  page: number; totalPages: number; totalItems: number; onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    background: disabled ? 'var(--bg3)' : 'var(--bg2)',
    color: disabled ? 'var(--muted)' : 'var(--text)',
    border: '1px solid var(--border2)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    minWidth: 64,
  });
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 12px', background: 'var(--bg2)',
      borderTop: '1px solid var(--border)',
    }}>
      <button onClick={() => onChange(Math.max(0, page - 1))} disabled={page <= 0} style={btnStyle(page <= 0)}>← 이전</button>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        {page + 1} / {totalPages} <span style={{ marginLeft: 6 }}>· {totalItems}건</span>
      </div>
      <button onClick={() => onChange(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={btnStyle(page >= totalPages - 1)}>다음 →</button>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600,
        background: active ? 'var(--accent)' : 'var(--bg3)',
        color: active ? '#000' : 'var(--muted)',
        border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >{label}</button>
  );
}

function HoldingRow({
  h, market, isActive, isWhitelisted, onSelect, displayName,
}: {
  h: PortfolioHolding;
  market: 'domestic' | 'overseas' | 'cash';
  isActive: boolean;
  isWhitelisted: boolean;
  onSelect: () => void;
  displayName?: string | null;
}) {
  const title = h.is_cash
    ? (h.currency === 'USD' ? '달러(USD)' : '원화(KRW)')
    : (displayName ?? h.symbol ?? h.currency);
  const badge = h.is_cash
    ? null
    : isWhitelisted
      ? { label: '매매', color: '#22c55e', bg: '#133b2b' }
      : { label: '조회', color: '#8b93a7', bg: '#2b2f38' };
  const marketFlag = market === 'overseas' ? '🇺🇸' : market === 'domestic' ? '🇰🇷' : null;

  return (
    <div
      onClick={!h.is_cash ? onSelect : undefined}
      style={{
        display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px',
        padding: '14px 16px 12px', borderBottom: '1px solid #20242f',
        minHeight: 72, alignItems: 'center', cursor: h.is_cash ? 'default' : 'pointer',
        background: isActive ? '#22293a' : 'transparent',
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 14 }}>
          {marketFlag && <span style={{ fontSize: 12 }} aria-hidden>{marketFlag}</span>}
          {title}
          {badge && (
            <span style={{
              fontSize: 10, padding: '2px 6px', borderRadius: 10,
              background: badge.bg, color: badge.color,
            }}>{badge.label}</span>
          )}
        </div>
        <div className="num" style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
          {h.is_cash
            ? fmtNum(h.qty) + ' ' + (h.currency === 'USD' ? 'USD' : 'KRW')
            : fmtNum(h.qty, h.currency.includes(':') ? 4 : 0) + symbolUnit(h.currency)}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <div className="num" style={{ fontSize: 14, fontWeight: 600 }}>{fmtNum(h.value_krw)}</div>
        {!h.is_cash && h.change_24h_pct !== null && <PnlChip value={h.change_24h_pct} />}
      </div>
    </div>
  );
}

function WatchRow({ symbol, displayName, active, onClick, reloadKey, onRemove }: {
  symbol: string; displayName?: string; active: boolean; onClick: () => void; reloadKey: number; onRemove: () => void;
}) {
  const [tk, setTk] = useState<Ticker | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/ticker?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((j) => {
      if (alive && j.ok) setTk(j.data as Ticker);
    }).catch(() => {});
    return () => { alive = false; };
  }, [symbol, reloadKey]);
  const change = tk?.open24h && tk.open24h > 0 ? ((tk.price - tk.open24h) / tk.open24h) * 100 : null;
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid #20242f', background: active ? '#22293a' : 'transparent' }}>
      <div
        onClick={onClick}
        style={{
          flex: 1, display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px',
          padding: '14px 16px 12px', minHeight: 72, alignItems: 'center', cursor: 'pointer',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 14 }}>
            {displayName ?? symbol}
            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 10, background: '#133b2b', color: '#22c55e' }}>매매</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <div className="num" style={{ fontSize: 14, fontWeight: 600 }}>{tk ? fmtNum(tk.price) : '-'}</div>
          {change !== null && <PnlChip value={change} />}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        style={{
          padding: '0 14px', fontSize: 16, color: 'var(--muted)',
          borderLeft: '1px solid var(--border)', flexShrink: 0,
        }}
        aria-label={`${symbol} 삭제`}
      >×</button>
    </div>
  );
}

interface MarketStatus {
  current: 'domestic' | 'overseas' | null;
  domestic: { open: boolean; nextOpenInMs: number; sessionLabel: string };
  overseas: { open: boolean; nextOpenInMs: number; sessionLabel: string };
  fx: { usdKrw: number } | null;
}

function fmtUntil(ms: number): string {
  if (ms <= 0) return '개장 중';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}일 ${h % 24}시간 후`;
  if (h >= 1) return `${h}시간 ${m}분 후`;
  return `${m}분 후`;
}

function MarketBadge({ status }: { status: MarketStatus | null }) {
  if (!status) return null;
  const { current, domestic, overseas, fx } = status;
  const label = current === 'domestic' ? '🇰🇷 한국장 개장 중'
              : current === 'overseas' ? '🇺🇸 미국장 개장 중'
              : '⏸ 양시장 마감';
  const next = current ? null
    : domestic.nextOpenInMs <= overseas.nextOpenInMs
      ? { who: '한국장', ms: domestic.nextOpenInMs }
      : { who: '미국장', ms: overseas.nextOpenInMs };
  const bg = current ? 'rgba(34,197,94,.15)' : 'var(--bg3)';
  const border = current ? 'rgba(34,197,94,.35)' : 'var(--border2)';
  const color = current ? '#22c55e' : 'var(--muted)';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11,
      background: bg, border: `1px solid ${border}`, color,
      padding: '4px 10px', borderRadius: 12, flexWrap: 'wrap',
      maxWidth: '100%',
    }}>
      <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</span>
      {next && (
        <span style={{ color: 'var(--muted)', fontSize: 10, whiteSpace: 'nowrap' }}>
          · 다음 {next.who} {fmtUntil(next.ms)}
        </span>
      )}
      {fx && (
        <span style={{ color: 'var(--muted)', fontSize: 10, whiteSpace: 'nowrap' }}>
          · {fx.usdKrw.toFixed(2)}
        </span>
      )}
    </div>
  );
}

const sx: Record<string, React.CSSProperties> = {
  top: {
    background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
    padding: '12px 16px', display: 'flex', flexDirection: 'column',
    gap: 8, alignItems: 'stretch',
  },
  brand: { fontSize: 12, color: 'var(--muted)', letterSpacing: '.5px' },
  total: { fontSize: 26, fontWeight: 700, lineHeight: 1.1, marginTop: 2 },
  sub: { display: 'flex', gap: 10, fontSize: 12, color: 'var(--muted)', alignItems: 'center', flexWrap: 'wrap' },
  refresh: {
    width: 36, height: 36, borderRadius: 10,
    background: 'var(--bg3)', border: '1px solid var(--border2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
    flexShrink: 0,
  },

  card: { background: 'var(--bg2)', borderBottom: '1px solid var(--border)' },
  cardHeader: {
    padding: '10px 14px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  cardGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1,
    background: 'var(--border)', borderTop: '1px solid var(--border)',
  },

  tabs: { display: 'flex', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 5 },

  chartSection: { background: 'var(--bg)', borderTop: '1px solid var(--border)', minWidth: 0, overflow: 'hidden' },
  chartHeader: { padding: '10px 14px 6px' },
  chips: {
    display: 'flex', gap: 6, padding: '6px 12px 10px', overflowX: 'auto',
    background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
    minWidth: 0,
  },
  chip: {
    flex: '0 0 auto', padding: '8px 14px', borderRadius: 999,
    border: '1px solid var(--border2)',
    fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', minHeight: 36,
  },
  ivBar: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--bg2)' },
  ivs: { display: 'flex', gap: 2, background: 'var(--bg3)', padding: 2, borderRadius: 10 },
  iv: { padding: '6px 10px', borderRadius: 8, fontSize: 12, minWidth: 36, textAlign: 'center' },
};

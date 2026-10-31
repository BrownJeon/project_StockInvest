'use client';

/**
 * T-108 거래 › 운영 기록 (가이드 §2.4.5) — 장중 룰 평가 깔때기 · 주문 기록(오늘, 세션일) · 내 결정 · 투자일지 입구.
 *
 *  - 깔때기: 기존 `EvalFunnelCard` 를 세션 모드로(`/api/ops/funnel`, 해외는 ET 세션일). 머리 세그먼트 기본값 = 서버 `defaultMarket`.
 *  - 주문 기록: 목록은 기존 `GET /api/orders?limit=50`(목록이라 limit 허용)을 **시장별 세션일**로 거른다 —
 *    국내 = KST 날짜, 해외 = ET 날짜(KST 자정으로 자르지 않는다). 세션일은 깔때기 응답의 `sessions` 를 쓴다.
 *    「체결」은 체결 증거가 있는 것(filled·partially_filled)만 — 가상 주문·차단·거부는 체결에 넣지 않는다.
 *  - 내 결정: 기존 `MyDecisionSection` 그대로(재조회는 이 화면의 60초 reloadKey).
 * 이 화면은 주문·취소 등 쓰기 요청을 하지 않는다.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Market, TradeDTO } from '@/lib/ops/metrics/types';
import type { OrderStatus } from '@/types/order';
import { EvalFunnelCard, type FunnelMeta } from '@/components/dashboard/EvalFunnelCard';
import { MyDecisionSection } from '@/components/dashboard/MyDecisionSection';
import { CHIP, fmtEtSession, fmtKstTime, fmtSessionDate } from '@/components/ops/format';
import { UNKNOWN_REASON } from '@/components/ops/reason-copy';
import { ActivityList, CheckRow, EmptyNote, Rows, RetryButton, Section, SectionBody, SegmentControl, StatusChip, ops } from '@/components/ops/ui';
import { InPageLink, InPageRow } from './InPageRow';

export interface LogOrder {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: string | null;
  status: OrderStatus;
  blocked_by: string | null;
  market?: string | null;
  created_at: string;
}

export type OrderFilter = 'all' | 'fill' | 'dry' | 'blk' | 'rej';
export const ORDER_FILTERS: { id: OrderFilter; text: string }[] = [
  { id: 'all', text: '전체' }, { id: 'fill', text: '체결' }, { id: 'dry', text: '가상' }, { id: 'blk', text: '차단' }, { id: 'rej', text: '거부' },
];

/** 주문 상태 9종 → 화면 표시(§2.4.5). 「DRY_RUN」 글자는 쓰지 않는다. */
export const ORDER_STATUS_TEXT: Record<OrderStatus, string> = {
  filled: '체결', partially_filled: '체결',
  dry_run: '가상',
  blocked: '차단',
  rejected: '거부', failed: '거부',
  pending: '접수', accepted: '접수',
  cancelled: '취소',
};

// T-130 4-6: 값만 사전(`ORDER_REASON_KO`)의 승인 문구와 같게 맞췄다. 이 표를 사전 한 출처로 합치는 일은 T-130 후속(이번엔 글자만).
const BLOCKED_BY_TEXT: Record<string, string> = {
  kill_switch: '모든거래차단 ON', validation_gate: '검증 관문', order_limit: '1회 주문 한도 초과', daily_limit: '일일 누적 한도 초과',
  symbol_not_allowed: '거래 차단 종목', invalid_side: '주문 방향 오류', vol_block: '변동폭 가드 · 차단 임계', vol_panic: '변동폭 가드 · 패닉 임계',
};

export function orderMatches(f: OrderFilter, s: OrderStatus): boolean {
  if (f === 'all') return true;
  if (f === 'fill') return s === 'filled' || s === 'partially_filled';
  if (f === 'dry') return s === 'dry_run';
  if (f === 'blk') return s === 'blocked';
  return s === 'rejected' || s === 'failed';
}

export function orderStatusLine(o: Pick<LogOrder, 'status' | 'blocked_by'>): string {
  const base = ORDER_STATUS_TEXT[o.status] ?? o.status;
  if (o.status === 'dry_run') return `${base} · 송신 없음`;
  if (o.status === 'blocked' && o.blocked_by) return `${base} · ${BLOCKED_BY_TEXT[o.blocked_by] ?? UNKNOWN_REASON}`;
  if (o.status === 'partially_filled') return `${base} · 부분 체결`;
  return base;
}

function marketOf(o: Pick<LogOrder, 'market' | 'symbol'>): Market {
  if (o.market === 'overseas' || o.market === 'domestic') return o.market;
  return o.symbol.includes(':') ? 'overseas' : 'domestic';
}

const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const KST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 주문의 세션일 — 국내 KST 날짜, 해외 ET 날짜(`YYYY-MM-DD`). 시각을 못 읽으면 null. */
export function orderSessionDate(o: Pick<LogOrder, 'market' | 'symbol' | 'created_at'>): string | null {
  const ms = Date.parse(o.created_at);
  if (!Number.isFinite(ms)) return null;
  return (marketOf(o) === 'overseas' ? ET_DATE : KST_DATE).format(new Date(ms));
}

/** 시장별 마지막 세션일에 속한 주문만(목록 순서 그대로 — 서버 최신순). */
export function ordersInSessions(orders: LogOrder[], sessions: FunnelMeta['sessions']): LogOrder[] {
  return orders.filter(o => orderSessionDate(o) === sessions[marketOf(o)].session.sessionDate);
}

export function TradeLogPanel(p: {
  trade: TradeDTO | null;
  displaySymbol: (s: string) => string;
  reloadKey: number;
  onGoOrders: () => void;
  onGoNotes: () => void;
  nowMs?: number;
}) {
  const nowMs = p.nowMs ?? Date.now();
  const [market, setMarket] = useState<Market | undefined>(undefined);
  const [meta, setMeta] = useState<FunnelMeta | null>(null);
  /** 깔때기 응답을 못 받았다 — 세션일을 몰라 주문 기록을 거를 수 없다(「불러오는 중」에 멈추지 않게, R-UI ④) */
  const [metaError, setMetaError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [orders, setOrders] = useState<LogOrder[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [ordersAt, setOrdersAt] = useState<string | null>(null);
  const [filter, setFilter] = useState<OrderFilter>('all');

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/orders?limit=50', { cache: 'no-store' });
      const j = await res.json().catch(() => null);
      if (res.status === 401) { setOrdersError('unauthorized'); return; }
      if (!j || j.ok !== true) { setOrdersError(j ? 'api_error' : 'bad_json'); return; }
      setOrders(j.data as LogOrder[]);
      setOrdersError(null);
      setOrdersAt(new Date().toISOString());
    } catch {
      setOrdersError('network');
    }
  }, []);
  useEffect(() => { void loadOrders(); }, [loadOrders, p.reloadKey, retry]);
  const onMeta = useCallback((m: FunnelMeta) => { setMeta(m); setMetaError(null); }, []);

  const selected: Market | null = market ?? meta?.market ?? null;
  const segItems = meta
    ? ([
        { id: 'domestic', text: `국내 · ${fmtSessionDate(meta.sessions.domestic.session.sessionDate)}${(meta.sessions.domestic.anomalies ?? 0) > 0 ? ` · 이상 ${meta.sessions.domestic.anomalies}` : ''}` },
        { id: 'overseas', text: `해외 · ${fmtEtSession(meta.sessions.overseas.session.sessionDate)}${(meta.sessions.overseas.anomalies ?? 0) > 0 ? ` · 이상 ${meta.sessions.overseas.anomalies}` : ''}` },
      ] as const)
    : ([{ id: 'domestic', text: '국내' }, { id: 'overseas', text: '해외' }] as const);

  // ── 주문 기록 ──
  const preBlocked = p.trade?.counts.state === 'ok' ? p.trade.counts.data.preOrderBlockedToday : 0;
  let ordersBody: ReactNode;
  if (ordersError && !orders) {
    ordersBody = (
      <SectionBody>
        <StatusChip kind="error">{CHIP.error(ordersError)}</StatusChip>
        <div style={{ marginTop: 8 }}><RetryButton onClick={() => { void loadOrders(); }} /></div>
      </SectionBody>
    );
  } else if (!meta && metaError) {
    ordersBody = (
      <SectionBody>
        <StatusChip kind="error">{CHIP.error(metaError)}</StatusChip>{' '}
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>세션일을 읽지 못해 오늘 주문을 거를 수 없습니다 — 비어 있는 것이 아닙니다</span>
        <div style={{ marginTop: 8 }}><RetryButton onClick={() => setRetry(n => n + 1)} /></div>
      </SectionBody>
    );
  } else if (!orders || !meta) {
    ordersBody = <SectionBody><span style={{ fontSize: 12, color: 'var(--muted)' }} aria-busy="true">불러오는 중…</span></SectionBody>;
  } else {
    const shown = ordersInSessions(orders, meta.sessions).filter(o => orderMatches(filter, o.status));
    ordersBody = (
      <>
        <SectionBody>
          <SegmentControl label="주문 상태 필터" items={ORDER_FILTERS} value={filter} onChange={setFilter} />
        </SectionBody>
        {preBlocked > 0 && (filter === 'all' || filter === 'blk') ? (
          <Rows><CheckRow severity="w" glyph="⊘" title={`검증 관문에서 차단된 매수 시그널 ${preBlocked}건 — 주문 기록 없음`} /></Rows>
        ) : null}
        {shown.length === 0 ? (
          <EmptyNote>오늘 이 상태의 주문 없음 <StatusChip kind="zero">{CHIP.zero}</StatusChip></EmptyNote>
        ) : (
          <ActivityList items={shown.map(o => {
            const q = o.quantity != null && Number(o.quantity) > 0 ? ` ${Number(o.quantity)}주` : '';
            return {
              time: fmtKstTime(o.created_at, nowMs),
              title: `${o.side === 'buy' ? '매수' : '매도'} ${p.displaySymbol(o.symbol)}${q}`,
              sub: `${orderStatusLine(o)}${marketOf(o) === 'overseas' ? ' · 해외' : ''}`,
            };
          })} />
        )}
        {/* 재조회 실패 — 마지막 목록을 오래됨으로 남긴다 */}
        {ordersError ? <SectionBody><StatusChip kind="stale">{CHIP.stale(fmtKstTime(ordersAt, nowMs))}</StatusChip> <span style={{ fontSize: 11, color: 'var(--muted)' }}>새로 고치지 못했습니다</span></SectionBody> : null}
      </>
    );
  }

  return (
    <div className={ops.scr}>
      <div className={ops.col}>
        <Section id="t-funnel" title="장중 룰 평가 깔때기">
          <SectionBody>
            <SegmentControl label="깔때기 시장" items={segItems} value={(selected ?? 'domestic') as Market} onChange={(m) => setMarket(m)} />
          </SectionBody>
          <EvalFunnelCard source="session" market={market} reloadKey={p.reloadKey + retry} onMeta={onMeta} onMetaError={setMetaError} />
          <div className={ops['sec-foot']}>
            장중 룰 엔진(eval_funnel, 30일 보존) · 세션일 기준(해외 ET) · 장마감 AI 분석은 이 표에 없음 · 청산 트랙은 별도(분석 › 검증·성과)
          </div>
        </Section>
      </div>
      <div className={ops.col}>
        <Section
          id="t-orders" title="주문 기록" small="오늘 · 세션일"
          link={<InPageLink href="?tab=log&detail=orders" onGo={p.onGoOrders} ariaLabel="주문 기록 전체 보기">전체</InPageLink>}
          foot="「체결」은 체결 증거가 있는 것만 · 가상 주문·차단·거부는 체결에 넣지 않음"
        >
          {ordersBody}
        </Section>
        <MyDecisionSection reloadKey={p.reloadKey} />
        {/* 「내 결정」 아래 행 — 옛 분석 › 투자일지(상세 보기) */}
        <div className={ops.sec}>
          <Rows>
            <InPageRow href="?tab=log&detail=notes" onGo={p.onGoNotes} glyph="✎" title="투자일지" />
          </Rows>
        </div>
      </div>
    </div>
  );
}

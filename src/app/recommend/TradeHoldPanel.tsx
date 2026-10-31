'use client';

/**
 * T-108 거래 › 보유·주문 (가이드 §2.4.4) — 계좌 전체 보유(D3)와 청산 임계 대비 현재 위치(X5), 미체결 주문.
 *
 * 데이터는 부모(TradePage)가 읽은 `/api/ops/trade`(읽기 전용) 그대로 — 이 화면은 KIS·주문 API 를 부르지 않는다.
 * 수량·평단·평가금은 두지 않는다(데모에도 없음). 손익률은 부호 + 색 + 숫자(색만으로 구분하지 않음).
 * 맨 아래 행 「포지션 추적 (청산 기준·고점) ›」 → `?tab=hold&detail=trailing`(옛 분석 › 포지션 추적).
 */
import type { ReactNode } from 'react';
import type { ExitZone, SafetyStateDTO, TradeDTO, TradeHoldingRow } from '@/lib/ops/metrics/types';
import type { PollStatus } from '@/components/ops/useOpsPoll';
import { CHIP, DASH, MINUS, fmtKstDateTime, fmtKstTime, fmtPct } from '@/components/ops/format';
import { CheckRow, EmptyNote, Rows, RetryButton, Section, SectionBody, SkeletonRows, StatusChip, ops } from '@/components/ops/ui';
import { InPageRow } from './InPageRow';

const pctAbs = (n: number) => `${Math.abs(Math.round(n * 10) / 10)}%`;

/** 청산 구간 표시 문구(X5) — 임계는 서버가 준 값(코드 기본값 ⊕ 운영 설정). 엔진 판정 함수를 부르지 않는다. */
export function zoneText(
  row: Pick<TradeHoldingRow, 'zone' | 'detail'>,
  ctx: { hardStopPct: number | null; targetProfitPct: number | null; drawdownPct: number | null; hardStopEnabled: boolean | null },
): string {
  const z: ExitZone = row.zone;
  if (z === 'hard_stop') {
    const th = row.detail.thresholdPct ?? ctx.hardStopPct;
    const off = ctx.hardStopEnabled === false ? ' — 손실한도 손절 OFF' : '';
    return `손실한도 구간${th != null ? ` (임계 ${MINUS}${pctAbs(th)})` : ''}${off}`;
  }
  if (z === 'eod_cut') return '장마감 전 손절 구간';
  if (z === 'take_profit') {
    const th = row.detail.thresholdPct ?? ctx.targetProfitPct;
    return `목표 익절 조건 충족${th != null ? ` (임계 +${pctAbs(th)})` : ''}`;
  }
  if (z === 'trailing_active') {
    const peak = row.detail.fromPeakPct;
    const dd = ctx.drawdownPct;
    return `트레일링 스탑 활성${peak != null ? ` · 고점 대비 ${MINUS}${pctAbs(peak)}` : ''}${dd != null ? ` (되돌림 ${pctAbs(dd)})` : ''}`;
  }
  if (z === 'not_evaluated') return '미평가 — 장외';
  return '중립';
}

export interface TradeHoldProps {
  trade: TradeDTO | null;
  tradeStatus: PollStatus;
  tradeError: string | null;
  safety: SafetyStateDTO | null;
  displaySymbol: (s: string) => string;
  onRetry?: () => void;
  onGoTrailing: () => void;
  nowMs?: number;
}

function sourceText(s: 'override' | 'default'): string {
  return s === 'override' ? '운영 설정' : '코드 기본값';
}

export function TradeHoldPanel(p: TradeHoldProps) {
  const nowMs = p.nowMs ?? Date.now();
  const loading = p.tradeStatus === 'loading' && !p.trade;
  const failed = !p.trade && (p.tradeStatus === 'error' || p.tradeStatus === 'stale');
  const stale = p.tradeStatus === 'stale';

  // ── 보유 ──
  let holdSmall: ReactNode;
  let holdBody: ReactNode;
  let holdFoot: ReactNode;
  const H = p.trade?.holdings;
  if (loading) {
    holdBody = <SkeletonRows />;
  } else if (failed || !H) {
    holdBody = <SectionBody><StatusChip kind="error">{CHIP.error(p.tradeError ?? 'api_error')}</StatusChip></SectionBody>;
    holdFoot = p.onRetry ? <RetryButton onClick={p.onRetry} /> : undefined;
  } else if (H.state === 'error') {
    holdBody = <SectionBody><StatusChip kind="error">{CHIP.error(H.error)}</StatusChip></SectionBody>;
    holdFoot = p.onRetry ? <RetryButton onClick={p.onRetry} /> : undefined;
  } else {
    const h = H.data;
    holdSmall = `계좌 ${h.accountCount} · 자동 운용 ${h.autoCount} (D3)`;
    const ctx = {
      hardStopPct: h.thresholds.hardStopPct, targetProfitPct: h.thresholds.targetProfitPct,
      drawdownPct: h.trailing.drawdownPct, hardStopEnabled: p.safety?.exitEngine?.hardStopEnabled ?? null,
    };
    if (!h.snapshotAt) {
      holdBody = <EmptyNote>보유 스냅샷 없음 <StatusChip kind="unknown">{CHIP.unknown}</StatusChip></EmptyNote>;
    } else if (h.rows.length === 0) {
      holdBody = <EmptyNote>보유 없음 <StatusChip kind="zero">{CHIP.zero}</StatusChip></EmptyNote>;
    } else {
      holdBody = (
        <Rows>
          {h.rows.map(r => {
            const pct = r.pnlPct != null ? fmtPct(r.pnlPct) : null;
            return (
              <CheckRow
                key={`${r.market}:${r.symbol}`}
                severity={r.zone === 'hard_stop' || r.zone === 'eod_cut' ? 'w' : 'n'}
                glyph={r.auto ? '자' : '수'}
                title={<>{p.displaySymbol(r.symbol)} <span className={ops.pill}>{r.market === 'overseas' ? '해외' : '국내'}</span> <span className={ops.pill}>{r.auto ? '자동' : '수동'} 보유</span></>}
                sub={zoneText(r, ctx)}
                right={pct ? <span className={`num${pct.tone ? ` ${pct.tone}` : ''}`}>{pct.text}</span> : DASH}
              />
            );
          })}
        </Rows>
      );
    }
    const staleNote = h.stale ? `오래됨 — 기준 스냅샷 ${fmtKstDateTime(h.snapshotAt)} (3시간 초과) · ` : `기준 ${fmtKstTime(h.snapshotAt, nowMs)} 스냅샷 · `;
    holdFoot = (
      <>
        {stale ? `${CHIP.stale(fmtKstTime(p.trade?.generatedAt ?? null, nowMs))} — 새로 고치지 못했습니다 · ` : ''}
        {h.snapshotAt ? staleNote : ''}
        청산 임계: 손실한도 손절·장마감 전 손절·목표 익절 = {sourceText(h.thresholds.source)}, 트레일링 스탑 = {sourceText(h.trailing.source)}(활성 {pctAbs(h.trailing.activatePct)} · 되돌림 {pctAbs(h.trailing.drawdownPct)}). 손익률이라 환율 무관
      </>
    );
  }

  // ── 미체결 주문 ──
  let openBody: ReactNode;
  const O = p.trade?.openOrders;
  if (loading) openBody = <SkeletonRows />;
  else if (failed || !O) openBody = <SectionBody><StatusChip kind="error">{CHIP.error(p.tradeError ?? 'api_error')}</StatusChip></SectionBody>;
  else if (O.state === 'error') openBody = <SectionBody><StatusChip kind="error">{CHIP.error(O.error)}</StatusChip></SectionBody>;
  else if (O.data.length === 0) openBody = <EmptyNote>미체결 없음 <StatusChip kind="zero">{CHIP.zero}</StatusChip></EmptyNote>;
  else {
    openBody = (
      <Rows>
        {O.data.map(o => (
          <CheckRow
            key={o.id}
            severity="w"
            glyph="½"
            title={`${p.displaySymbol(o.symbol)} ${o.market === 'overseas' ? '해외' : '국내'} · ${o.side === 'buy' ? '매수' : '매도'} ${o.qty}주 중 ${o.filled}주 체결`}
            sub={`잔량 ${Math.max(0, o.qty - o.filled)}주 · ${o.filled > 0 ? '부분 체결 — 체결 수는 1건으로 셈' : '접수 — 체결 전'}`}
          />
        ))}
      </Rows>
    );
  }

  return (
    <div className={ops.scr}>
      <div className={ops.col}>
        <Section id="t-hold" title="보유" small={holdSmall}>
          {holdBody}
          {holdFoot ? <div className={ops['sec-foot']} style={{ paddingTop: 8 }}>{holdFoot}</div> : null}
          <Rows>
            <InPageRow href="?tab=hold&detail=trailing" onGo={p.onGoTrailing} glyph="↗" title="포지션 추적 (청산 기준·고점)" />
          </Rows>
        </Section>
      </div>
      <div className={ops.col}>
        <Section id="t-open" title="미체결 주문">{openBody}</Section>
      </div>
    </div>
  );
}

'use client';

/**
 * T-182 거래 리포트 전문 화면(`/report?id=<숫자>`) — 승인 데모 mockups/T-182-trade-report-v1.html(v1) 의 `#app` 그대로.
 *
 * 위→아래: 머리(뒤로·제목·발송 시각) → 회차 이동 → 지금 안전 상태 띠(MiniStrip) → 본문
 * (요약 열: 총자산·확인 필요 / 상세 열: 거래 요약 → 매도 신호 → 보유 → 매수 후보 → 리서치 참고 → 보낸 요약 원문).
 *
 * 🔴 읽기 전용 — 주문·승인·설정 CTA 를 두지 않는다. 앱 판별(`window.Capacitor`)은 쓰지 않는다.
 * 🔴 「확인 필요」 판정은 텔레그램 요약과 같은 함수(`computeReportWarnings`)를 쓴다 — 두 곳이 어긋나지 않게.
 * 🔴 「매도 손익」이라는 말을 쓰지 않는다(매도 **신호** 값이다).
 * 데이터: `GET /api/reports/trade[?id=]`. 회차 이동은 `router.replace` — 뒤로 버튼이 이전 회차가 아니라 이전 화면으로 간다.
 */
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSafetyState } from '@/components/ops/useSafetyState';
import { CheckRow, MiniStrip, RetryButton, Section, SkelBar, SkeletonRows, StatusChip } from '@/components/ops/ui';
import { cx, ops } from '@/components/ops/ui/styles';
import {
  REPORT_CANDIDATE_STATUS,
  candidatesAllBlocked,
  computeReportWarnings,
  fmtKstShort,
  fmtKstWithDay,
  fmtSignedPct,
  fmtSignedWon,
  fmtWon,
  initiallyOpenSections,
  parseReportId,
  parseReportPayload,
  rangeHours,
  realizedPnlText,
  reportExitLabel,
  reportSkipLabel,
  sellConsiderCount,
  stopNearHoldings,
  type ReportSectionId,
  type ReportWarning,
  type TradeReportPayload,
} from '@/lib/reports/trade-report-view';
import s from './report.module.css';

// ─── 데이터 ─────────────────────────────────────────────────────────────────

interface HistoryItem { id: number; sentAt: string }
export interface ReportRow {
  id: number; sentAt: string; rangeStart: string; rangeEnd: string;
  isTest: boolean; delivered: boolean; summaryText: string; payload: unknown;
}
interface ApiData { status: 'ok' | 'not_found' | 'empty'; report: ReportRow | null; history: HistoryItem[] }

type Load =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'unauth' }
  | { kind: 'error'; code: string }
  | { kind: 'data'; data: ApiData };

const API = '/api/reports/trade';

function useReport(rawId: string | null, nonce: number): { load: Load; lastHistory: HistoryItem[] } {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [lastHistory, setLastHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    // 숫자 형식이 아니면 최신으로 보내지 않고 「찾을 수 없음」(가이드 §2)
    if (rawId != null && rawId !== '' && parseReportId(rawId) == null) {
      setLoad({ kind: 'invalid' });
      return;
    }
    const ac = new AbortController();
    setLoad({ kind: 'loading' });
    const url = rawId ? `${API}?id=${encodeURIComponent(rawId)}` : API;
    fetch(url, { cache: 'no-store', signal: ac.signal })
      .then(async (res) => {
        if (res.status === 401) { setLoad({ kind: 'unauth' }); return; }
        const body = await res.json().catch(() => null) as { ok?: boolean; data?: ApiData; error?: string } | null;
        if (!res.ok || !body?.ok || !body.data) {
          setLoad({ kind: 'error', code: body?.error ?? `http_${res.status}` });
          return;
        }
        setLastHistory(Array.isArray(body.data.history) ? body.data.history : []);
        setLoad({ kind: 'data', data: body.data });
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setLoad({ kind: 'error', code: e instanceof Error ? e.name : 'network' });
      });
    return () => ac.abort();
  }, [rawId, nonce]);

  return { load, lastHistory };
}

// ─── 아이콘 (lucide chevron-left·chevron-right 경로 인라인 — NavIcons 와 같은 방식, ISC) ──

function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
  );
}
function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
  );
}

// ─── 조각 ───────────────────────────────────────────────────────────────────

function Header({ sub, chips, onBack }: { sub: string; chips?: ReactNode; onBack: () => void }) {
  return (
    <div className={s.ah}>
      <button type="button" className={s.iconbtn} aria-label="뒤로" onClick={onBack}><ChevronLeft /></button>
      <div className={s.tt}>
        <h1>거래 리포트</h1>
        <p className={cx(s.sub, 'num')}>{sub}</p>
      </div>
      {chips}
    </div>
  );
}

interface HistOption { id: number; sentAt: string; suffix: string }

function HistoryBar({ options, currentId, onPick }: { options: HistOption[]; currentId: number | null; onPick: (id: number) => void }) {
  if (options.length === 0) return null;
  const idx = currentId == null ? -1 : options.findIndex((o) => o.id === currentId);
  // 목록은 최신 먼저. 「이전」 = 더 옛 회차(아래쪽), 「다음」 = 더 새 회차(위쪽).
  const older = idx >= 0 && idx < options.length - 1 ? options[idx + 1] : null;
  const newer = idx > 0 ? options[idx - 1] : null;
  return (
    <div className={s.hist}>
      <button type="button" className={s.iconbtn} aria-label="이전 회차" disabled={!older} onClick={() => older && onPick(older.id)}><ChevronLeft /></button>
      <select
        aria-label="리포트 회차 선택"
        value={idx >= 0 ? String(currentId) : ''}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isSafeInteger(v) && v > 0) onPick(v); }}
      >
        {idx < 0 ? <option value="" disabled>회차 선택</option> : null}
        {options.map((o) => (
          <option key={o.id} value={String(o.id)}>{fmtKstWithDay(o.sentAt)}{o.suffix}</option>
        ))}
      </select>
      <button type="button" className={s.iconbtn} aria-label="다음 회차" disabled={!newer} onClick={() => newer && onPick(newer.id)}><ChevronRight /></button>
    </div>
  );
}

function StateBox({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className={s.abody}>
      <div className={cx(s.card, s.stbox)} role="status">
        <h2>{title}</h2>
        <p>{text}</p>
        {children}
      </div>
    </div>
  );
}

function SkeletonBody() {
  return (
    <div className={s.abody} aria-busy="true" aria-label="리포트를 불러오는 중">
      <div className={s.colsum}>
        <div className={cx(s.card, s.skelCard)}><SkelBar w={50} /><span className={cx(ops.skel, ops.big)} /><SkelBar w={80} /></div>
        <div className={s.card}><SkeletonRows /></div>
      </div>
      <div className={s.coldet}>
        <div className={cx(s.card, s.skelCard)}><SkelBar w={50} /><SkelBar w={80} /></div>
        <div className={cx(s.card, s.skelCard)}><SkelBar w={50} /><SkelBar w={80} /></div>
        <div className={cx(s.card, s.skelCard)}><SkelBar w={50} /><SkelBar w={80} /></div>
      </div>
    </div>
  );
}

function updownClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return '';
  return v > 0 ? 'up' : 'down';
}

function SectionError({ label }: { label: string }) {
  return (
    <div className={s.errRow}>
      <StatusChip kind="error">! 조회 실패</StatusChip>
      <span>{label} 정보를 읽지 못했습니다 · 0건이 아닙니다</span>
    </div>
  );
}

function Sec(props: {
  id: ReportSectionId | 'r-raw'; title: string; meta: ReactNode; chip?: ReactNode;
  open: boolean; onToggle: (id: string, open: boolean) => void; children: ReactNode;
}) {
  const { id, title, meta, chip, open, onToggle, children } = props;
  return (
    <details className={s.sec} id={id} open={open} onToggle={(e) => onToggle(id, (e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span className={s.st}>{title}</span>
        {chip}
        <span className={s.meta}>{meta}</span>
      </summary>
      <div className={s.in}>{children}</div>
    </details>
  );
}

// ─── 본문 ───────────────────────────────────────────────────────────────────

const DETAIL_IDS = ['r-trade', 'r-sell', 'r-hold', 'r-cand', 'r-res', 'r-raw'] as const;

export function ReportBody({ report, payload }: { report: ReportRow; payload: TradeReportPayload }) {
  const warnings = useMemo(() => computeReportWarnings(payload), [payload]);
  // 처음 펼침 = 확인 필요가 가리키는 섹션만. 회차가 바뀌면 부모가 `key={report.id}` 로 다시 만들어 초기화한다.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => {
    const init = initiallyOpenSections(warnings);
    return Object.fromEntries(DETAIL_IDS.map((id) => [id, init.has(id as ReportSectionId)]));
  });

  const onToggle = useCallback((id: string, open: boolean) => {
    setOpenMap((m) => (m[id] === open ? m : { ...m, [id]: open }));
  }, []);
  const allOpen = DETAIL_IDS.every((id) => openMap[id]);
  const toggleAll = () => setOpenMap(Object.fromEntries(DETAIL_IDS.map((id) => [id, !allOpen])));

  // 확인 필요 행 → 해당 섹션을 열고 스크롤·포커스(요약 줄). 공용 CheckRow 는 링크(`#r-…`)만 지원해서
  // 바깥에서 클릭을 가로채 처리한다(주소 해시는 바꾸지 않는다).
  const onCheckClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const id = (a.getAttribute('href') ?? '').slice(1);
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'DETAILS') setOpenMap((m) => ({ ...m, [id]: true }));
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      const f = el.querySelector('summary') as HTMLElement | null;
      if (f) f.focus({ preventScroll: true });
      else { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
    });
  };

  const cov = payload.coverage;
  const { totalKRW, baselineKRW } = payload.asset;
  const assetUnknown = totalKRW == null || cov.asset === 'failed';
  const t = payload.trade;
  const near = stopNearHoldings(payload);
  const nearSet = new Set(near.map((h) => h.symbol));
  const unfilled = payload.sellSignals.filter((x) => !x.filled);
  const sellSum = payload.sellSignals.reduce((acc, x) => acc + (Number.isFinite(x.pnlKRW) ? x.pnlKRW : 0), 0);
  const blocked = candidatesAllBlocked(payload);
  const buyItems = payload.research.items.filter((i) => i.action === 'buy');

  // ── 요약 열
  const asset = assetUnknown ? (
    <div className={s.asset} id="r-asset">
      <span className={s.lbl}>총자산</span>
      <span className={s.big}>조회 불가</span>
      <p className={s.base}>
        증권사 잔고·예수금·환율을 확인하지 못했습니다. 0원이 아닙니다.
        {baselineKRW != null && baselineKRW > 0 ? <><br /><span className="num">기간 시작 {fmtWon(baselineKRW)} ({fmtKstShort(payload.rangeStart)})</span></> : null}
      </p>
    </div>
  ) : (
    <div className={s.asset} id="r-asset">
      <span className={s.lbl}>총자산 · {fmtKstShort(payload.rangeEnd)} 기준</span>
      <span className={cx(s.big, 'num')}>{fmtWon(totalKRW as number)}</span>
      {baselineKRW != null && baselineKRW > 0 ? (() => {
        const delta = (totalKRW as number) - baselineKRW;
        const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '';
        return (
          <>
            <span className={cx(s.dl, 'num', updownClass(delta))}>{arrow ? `${arrow} ` : ''}{fmtSignedPct((delta / baselineKRW) * 100)} · {fmtSignedWon(delta)}</span>
            <p className={cx(s.base, 'num')}>기간 시작 {fmtWon(baselineKRW)} ({fmtKstShort(payload.rangeStart)})</p>
          </>
        );
      })() : <p className={s.base}>기간 시작 스냅샷 없음</p>}
    </div>
  );

  const kv = (
    <dl className={s.kv}>
      <div><dt>체결</dt><dd className="num">{t.buys + t.sells}건</dd></div>
      <div><dt>보유</dt><dd className="num">{cov.holdings === 'ok' ? `${payload.holdings.length}종목` : '조회 실패'}</dd></div>
      <div><dt>매수 고려 (참고)</dt><dd className="num">{cov.research === 'ok' ? `${buyItems.length}종목` : '조회 실패'}</dd></div>
    </dl>
  );

  const check = (
    <div className={cx(s.card, s.chkCard)} onClickCapture={onCheckClick}>
      <Section id="chk-h" title="확인 필요" link={<span className={cx(s.chip, warnings.length > 0 && s.wn)}>{warnings.length}건</span>}>
        {warnings.length > 0 ? (
          warnings.map((w: ReportWarning, i) => (
            <CheckRow key={`${w.kind}-${i}`} severity={w.severity} glyph="!" title={w.title} sub={w.sub} href={`#${w.target}`} />
          ))
        ) : (
          <div className={ops.rowl}>
            <span className={ops.ic} style={{ borderColor: 'var(--ok)', color: 'var(--ok)' }} aria-hidden="true">✓</span>
            <span>
              <span className={ops.t}>확인할 것 없음</span>
              <span className={ops.s}>총자산 조회·손절 임박·미체결 신호·회전매매·후보 전면 차단 모두 0건</span>
            </span>
            <span />
          </div>
        )}
      </Section>
    </div>
  );

  // ── 상세: 거래 요약
  const trade = (
    <Sec id="r-trade" title="거래 요약" meta={`체결 매수 ${t.buys} · 매도 ${t.sells}`} open={!!openMap['r-trade']} onToggle={onToggle}>
      <div className={s.row}><span className={s.rt}>매수</span><span className={cx(s.rr, 'num')}>{t.buys}건 · {fmtWon(t.buysAmountKRW)}</span></div>
      <div className={s.row}><span className={s.rt}>매도</span><span className={cx(s.rr, 'num')}>{t.sells}건 · {fmtWon(t.sellsAmountKRW)}</span></div>
      <div className={s.row}>
        <span className={s.rt}>실현 손익 <small>체결 기준</small></span>
        {t.sells > 0
          ? <span className={cx(s.rr, 'num')}>{realizedPnlText(t)}</span>
          : <span className={s.rr}>— <small>체결 매도 없음</small></span>}
        {t.unmatchedSellCount > 0 ? <span className={s.rs}>원가 미상 매도 {t.unmatchedSellCount}건 — 실현손익에서 제외</span> : null}
      </div>
      <div className={s.row}>
        <span className={s.rt}>회전매매</span>
        <span className={s.rr}>{t.churnSymbols.length > 0 ? `${t.churnSymbols.length}종목` : '없음'}</span>
        {t.churnSymbols.length > 0 ? <span className={s.rs}>{t.churnSymbols.map((c) => c.name).join(', ')} · 같은 기간 매수·매도 2회 이상 반복</span> : null}
      </div>
    </Sec>
  );

  // ── 매도 신호
  const sell = (
    <Sec
      id="r-sell" title="매도 신호" open={!!openMap['r-sell']} onToggle={onToggle}
      chip={cov.signals === 'ok' && unfilled.length > 0 ? <span className={cx(s.chip, s.wn)}>미체결</span> : null}
      meta={cov.signals !== 'ok' ? '조회 실패' : payload.sellSignals.length === 0 ? '이 기간 없음' : `${payload.sellSignals.length}건 · 신호 기준 ${fmtSignedWon(sellSum)}`}
    >
      {cov.signals !== 'ok' ? <SectionError label="매도 신호" /> : payload.sellSignals.length === 0 ? (
        <p className={s.expl}>이 기간에 만들어진 매도 신호가 없습니다.</p>
      ) : (
        <>
          <p className={s.expl}><b>체결된 매도가 아닙니다.</b> 매도 신호가 만들어질 때 계산한 값이며, 이 기간 체결된 매도는 {t.sells}건입니다. 실제 손익은 체결된 뒤 「거래 요약」의 실현 손익에 잡힙니다.</p>
          {payload.sellSignals.map((x, i) => (
            <div className={s.row} key={x.signalId ?? `${x.symbol}-${i}`}>
              <span className={s.rt}>{x.name} <small>{reportExitLabel(x.exitKind)} 신호 · {x.filled ? '체결됨' : '체결 안 됨'}</small></span>
              <span className={cx(s.rr, 'num', updownClass(x.pnlKRW))}>{fmtSignedWon(x.pnlKRW)}<small>신호 기준 {fmtSignedPct(x.pnlPct) ?? '데이터 없음'}</small></span>
            </div>
          ))}
        </>
      )}
    </Sec>
  );

  // ── 보유 (손절 임박 종목을 맨 위로)
  const holdings = [...near, ...payload.holdings.filter((h) => !nearSet.has(h.symbol))];
  const hold = (
    <Sec
      id="r-hold" title="보유" open={!!openMap['r-hold']} onToggle={onToggle}
      meta={cov.holdings !== 'ok' ? '조회 실패' : `${payload.holdings.length}종목 · 손절 임박 ${near.length} · 매도 고려 ${sellConsiderCount(payload)}`}
    >
      {cov.holdings !== 'ok' ? <SectionError label="보유" /> : (
        <>
          <p className={s.expl}><b>고점대비</b>는 보유 중 최고가와 비교한 등락입니다. 수익률이 아닙니다. 손절 임박 기준: 고점대비 −1.5% 이하.</p>
          {holdings.length === 0 ? <p className={s.expl}>보유 종목이 없습니다.</p> : holdings.map((h) => {
            const sub = [
              <span key="inv">투자금 <b className="num">{h.investedText ?? '데이터 없음'}</b></span>,
              <span key="per">최근추이 {fmtSignedPct(h.periodChangePct) ?? '데이터 없음'}</span>,
              h.sellJudgeText ? <span key="judge">{h.sellJudgeText}</span> : null,
              h.holdingInfoText ? <span key="info">{h.holdingInfoText}</span> : null,
            ].filter(Boolean);
            return (
              <div className={s.row} key={h.symbol}>
                <span className={s.rt}>
                  {nearSet.has(h.symbol) ? <span className={s.warnMark} role="img" aria-label="손절 임박">!</span> : null}
                  {h.name} <small className="num">{h.qty}주</small>
                </span>
                <span className={cx(s.rr, 'num', updownClass(h.profitPct))}>{fmtSignedPct(h.profitPct) ?? '데이터 없음'}<small>고점대비</small></span>
                <span className={s.rs}>{sub.map((node, i) => <span key={i}>{i > 0 ? ' · ' : ''}{node}</span>)}</span>
              </div>
            );
          })}
        </>
      )}
    </Sec>
  );

  // ── 매수 후보
  const statusCounts = (['watchlist', 'ai_pass', 'ai_rejected', 'blocked'] as const)
    .map((k) => [k, payload.candidates.filter((c) => c.status === k).length] as const)
    .filter(([, n]) => n > 0);
  const blockedReasons = (() => {
    const m = new Map<string, number>();
    for (const c of payload.candidates) if (c.status === 'blocked') m.set(reportSkipLabel(c.skipReason), (m.get(reportSkipLabel(c.skipReason)) ?? 0) + 1);
    return [...m.entries()].map(([k, n]) => `${k} ${n}종목`).join(', ');
  })();
  const noRsi = payload.candidates.filter((c) => c.rsi == null).length;
  const cand = (
    <Sec
      id="r-cand" title="매수 후보" open={!!openMap['r-cand']} onToggle={onToggle}
      chip={cov.candidates === 'ok' && blocked.all ? <span className={cx(s.chip, s.wn)}>전부 차단</span> : null}
      meta={cov.candidates !== 'ok' ? '조회 실패' : payload.candidates.length === 0 ? '없음'
        : blocked.all ? `${payload.candidates.length}종목 · 전부 차단`
        : `${payload.candidates.length}종목 · ${statusCounts.map(([k, n]) => `${REPORT_CANDIDATE_STATUS[k]} ${n}`).join(' · ')}`}
    >
      {cov.candidates !== 'ok' ? <SectionError label="매수 후보" /> : payload.candidates.length === 0 ? (
        <p className={s.expl}>발송 시점 기준 최근 4시간 매수 후보가 없습니다.</p>
      ) : (
        <>
          <p className={s.expl}>
            {blocked.all
              ? <><b>{payload.candidates.length}종목 모두 차단</b> — 사유 {blocked.reason}. 이 상태에서는 새 매수 신호가 나가지 않습니다.</>
              : blockedReasons ? <>차단 사유: {blockedReasons}.</> : <>차단된 후보 없음.</>}
            {noRsi > 0 ? ` RSI 값 없음(${noRsi === payload.candidates.length ? `${noRsi}종목 모두` : `${noRsi}종목`}).` : ''}
          </p>
          <div className={s.names}>
            {payload.candidates.map((c) => {
              const extra = [
                c.rsi != null ? `RSI ${c.rsi.toFixed(1)}` : null,
                c.evPct != null ? `EV ${c.evPct > 0 ? '+' : ''}${c.evPct.toFixed(2)}%` : null,
                c.aiConf != null && c.aiConf > 0 ? `AI ${c.aiConf}%` : null,
              ].filter(Boolean).join(' ');
              return (
                <span className={s.chip} key={c.symbol}>
                  {c.name}<i>{REPORT_CANDIDATE_STATUS[c.status] ?? c.status}{extra ? ` · ${extra}` : ''}</i>
                </span>
              );
            })}
          </div>
        </>
      )}
    </Sec>
  );

  // ── 리서치 참고 (면책 전문 항상 맨 위)
  const r = payload.research;
  const res = (
    <Sec
      id="r-res" title="리서치 참고" open={!!openMap['r-res']} onToggle={onToggle}
      meta={cov.research !== 'ok' ? '조회 실패' : `추적 ${r.trackedCount} · 매수 고려 ${buyItems.length}`}
    >
      <p className={s.expl}><b>참고용</b> — {r.note}</p>
      {cov.research !== 'ok' ? <SectionError label="리서치" /> : r.trackedCount === 0 ? (
        <p className={s.expl}>추적 중인 종목이 없습니다 — 즐겨찾기에서 리서치 추적을 켜주세요.</p>
      ) : r.items.length === 0 ? (
        <p className={s.expl}>기준일 종가에서 조건을 충족한 종목이 없습니다.</p>
      ) : r.items.map((i) => (
        <div className={s.row} key={i.symbol}>
          <span className={s.rt}>{i.name} <small>{i.asOfDate ? `${i.asOfDate} 종가 기준` : '기준일 데이터 없음'}</small></span>
          <span className={s.rr}>{i.action === 'buy' ? '매수 고려' : '판단 보류'}</span>
          <span className={s.rs}>
            {i.action === 'buy' ? (
              <>
                {i.evidenceText ? <>근거: {i.evidenceText}<br /></> : null}
                {i.priceText ? <>가격: {i.priceText}</> : null}
              </>
            ) : <>판단 보류 (건수 적음{i.triggerCount > 0 ? `, 트리거 ${i.triggerCount}건` : ''})</>}
          </span>
        </div>
      ))}
    </Sec>
  );

  // ── 보낸 요약 원문
  const lineCount = report.summaryText ? report.summaryText.split('\n').length : 0;
  const raw = (
    <Sec
      id="r-raw" title="보낸 요약 원문" open={!!openMap['r-raw']} onToggle={onToggle}
      chip={!report.delivered ? <span className={cx(s.chip, s.er)}>발송 실패</span> : report.isTest ? <span className={s.chip}>시험 발송</span> : null}
      meta={report.delivered ? `텔레그램 · ${lineCount}줄 · 보관됨` : '발송 실패 — 화면 기록만'}
    >
      <pre className={s.raw}>{report.summaryText}</pre>
    </Sec>
  );

  return (
    <div className={s.abody}>
      <div className={s.colsum}>
        <section className={s.card} aria-label="포트폴리오 요약">{asset}{kv}</section>
        {check}
      </div>
      <div className={s.coldet}>
        <div className={s.tools}><button type="button" onClick={toggleAll}>{allOpen ? '모두 접기' : '모두 펼치기'}</button></div>
        {trade}{sell}{hold}{cand}{res}{raw}
      </div>
    </div>
  );
}

// ─── 화면 ───────────────────────────────────────────────────────────────────

export function ReportScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const rawId = params.get('id');
  const [nonce, setNonce] = useState(0);
  const { load, lastHistory } = useReport(rawId, nonce);
  const safety = useSafetyState();

  const onBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/');
  }, [router]);
  const pick = useCallback((id: number) => router.replace(`/report?id=${id}`), [router]);

  const report = load.kind === 'data' ? load.data.report : null;
  const history = load.kind === 'data' ? load.data.history : lastHistory;
  // 안전 띠가 30초마다 다시 그려도 payload·펼침 상태가 흔들리지 않게 응답 객체 단위로 한 번만 읽는다.
  const payload = useMemo(() => (report ? parseReportPayload(report.payload) : null), [report]);

  // 회차 목록 — 시험·발송 실패 회차를 id 로 직접 열었으면 그 회차도 목록에 끼워 보인다(표시만).
  const options: HistOption[] = useMemo(() => {
    const base: HistOption[] = history.map((h, i) => ({ id: h.id, sentAt: h.sentAt, suffix: i === 0 ? ' · 최신' : '' }));
    if (report && !base.some((o) => o.id === report.id)) {
      base.push({ id: report.id, sentAt: report.sentAt, suffix: report.isTest ? ' · 시험 발송' : !report.delivered ? ' · 발송 실패' : '' });
      base.sort((a, b) => (Date.parse(b.sentAt) - Date.parse(a.sentAt)) || (b.id - a.id));
    }
    return base;
  }, [history, report]);

  const strip = <MiniStrip title="지금 안전 상태" state={safety.view} />;
  const hist = <HistoryBar options={options} currentId={report?.id ?? null} onPick={pick} />;

  let content: ReactNode;
  if (load.kind === 'unauth') {
    const next = `/report${rawId ? `?id=${encodeURIComponent(rawId)}` : ''}`;
    content = (
      <>
        <Header sub="로그인 후 볼 수 있습니다" onBack={onBack} />
        <StateBox title="로그인이 필요합니다" text="리포트에는 계좌 정보가 있어 로그인해야 볼 수 있습니다. 로그인하면 이 리포트로 돌아옵니다.">
          <Link className={cx(s.btn, s.pri)} href={`/login?next=${encodeURIComponent(next)}`}>로그인</Link>
        </StateBox>
      </>
    );
  } else if (load.kind === 'loading') {
    content = (<><Header sub="불러오는 중…" onBack={onBack} />{hist}{strip}<SkeletonBody /></>);
  } else if (load.kind === 'error') {
    content = (
      <>
        <Header sub="불러오지 못함" onBack={onBack} />{hist}{strip}
        <StateBox title="리포트를 불러오지 못했습니다" text="비어 있는 것이 아닙니다. 잠시 뒤 다시 시도해 주세요. 계속되면 서버 상태를 확인해야 합니다.">
          <RetryButton onClick={() => setNonce((n) => n + 1)} />
        </StateBox>
      </>
    );
  } else if (load.kind === 'invalid' || load.data.status === 'not_found') {
    const invalid = load.kind === 'invalid';
    content = (
      <>
        <Header sub={invalid ? '찾을 수 없는 회차' : '보관 기간이 지난 회차'} onBack={onBack} />{hist}{strip}
        <StateBox
          title={invalid ? '이 리포트를 찾을 수 없습니다' : '보관 기간이 지난 리포트입니다'}
          text={invalid ? '링크의 리포트 번호가 올바르지 않습니다.' : '보관 기간(1년)이 지나 원문이 정리되었습니다.'}
        >
          <button type="button" className={cx(s.btn, s.pri)} onClick={() => router.replace('/report')}>최신 리포트 보기</button>
        </StateBox>
      </>
    );
  } else if (load.data.status === 'empty' || !report) {
    content = (
      <>
        <Header sub="보관된 리포트 없음" onBack={onBack} />{strip}
        <StateBox
          title="아직 보관된 리포트가 없습니다"
          text="리포트 보관은 이 기능을 배포한 뒤 첫 발송(매일 08:00)부터 시작됩니다. 그 전에 보낸 리포트는 원문이 남아 있지 않아 볼 수 없습니다."
        >
          <Link className={s.btn} href="/">홈으로</Link>
        </StateBox>
      </>
    );
  } else {
    const hours = payload ? rangeHours(payload) : Math.round((Date.parse(report.rangeEnd) - Date.parse(report.rangeStart)) / 3600_000);
    const chips = report.isTest ? <span className={s.chip}>시험 발송</span> : !report.delivered ? <span className={cx(s.chip, s.er)}>발송 실패</span> : null;
    content = (
      <>
        <Header sub={`${fmtKstWithDay(report.sentAt)} 발송 · 최근 ${hours}시간`} chips={chips} onBack={onBack} />
        {hist}{strip}
        {payload ? <ReportBody key={report.id} report={report} payload={payload} /> : (
          <div className={s.abody}>
            <div className={s.card}>
              <SectionError label="상세" />
            </div>
            <details className={s.sec} open>
              <summary><span className={s.st}>보낸 요약 원문</span><span className={s.meta}>보관됨</span></summary>
              <div className={s.in}><pre className={s.raw}>{report.summaryText}</pre></div>
            </details>
          </div>
        )}
      </>
    );
  }

  return <div className={s.screen}>{content}</div>;
}

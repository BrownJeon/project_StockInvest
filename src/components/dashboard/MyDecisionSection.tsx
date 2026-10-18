'use client';

/**
 * 대시보드 맨 아래 "내 결정" 섹션 — T-049 (승인 데모 `mockups/T-049-dashboard-executing-label-v2.html`).
 *
 * 구성은 분석 화면에서 빠진 `MyDecisionTab`(고아, 수정하지 않음)과 같고, 다른 점은:
 *  - 기본 접힘 + 요약 줄(승인·거절·만료 개수, 확인 필요 n건 ⚠ 칩)
 *  - executing 은 주문 기록 상태로 표시 — 판정은 순수 모듈 `decision-outcome.ts`(테스트 대상)
 *  - 대시보드 `reloadKey`(30초)에 맞춰 재조회, 접혀 있어도 조회(요약 줄에 필요)
 *  - 오류 상태 신설(원본은 실패를 "결정 내역 없음"으로 보여 확인 필요 주문을 숨겼다)
 *  - 만료 카드는 반투명 대신 점선 테두리, 버튼 터치 영역 44px
 * 이 컴포넌트는 얇게 유지한다 — 판정·집계·기간·URL 은 전부 `decision-outcome.ts`.
 */
import { useEffect, useId, useState } from 'react';
import { formatRelativeTime } from '@/lib/time';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';
import { fmtNum } from '@/lib/format';
import {
  HINT_TEXT,
  PERIOD_LABEL,
  PERIOD_SUB,
  countDecisions,
  decisionBadge,
  decisionOutcome,
  fetchDecisionBundle,
  filterDecisions,
  pageWindow,
  type DecisionSignal,
  type FilterType,
  type Period,
} from '@/components/dashboard/decision-outcome';

const PERIODS: Period[] = ['1d', '7d', '30d'];

const SR_ONLY: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};
const WARN_CHIP: React.CSSProperties = {
  color: 'var(--warn)', fontWeight: 700,
  background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.45)',
  borderRadius: 6, padding: '1px 6px',
};
/** 바깥 버튼 = 터치 영역 44px, 안쪽 pill = 원본 크기. globals.css 버튼 초기화에 padding 이 없어 여기서 0 으로 둔다. */
const HIT: React.CSSProperties = { minHeight: 44, display: 'inline-flex', alignItems: 'center', padding: 0, margin: 0 };
const PILL: React.CSSProperties = {
  padding: '5px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
};
const STATE_MSG: React.CSSProperties = {
  textAlign: 'center', padding: '32px 8px', color: 'var(--muted)', fontSize: 13, lineHeight: 1.6,
};

function WarnChip({ children, fontSize }: { children: React.ReactNode; fontSize: number }) {
  return (
    <span style={{ ...WARN_CHIP, fontSize, display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>
      <span style={SR_ONLY}>경고: </span>
      <span aria-hidden="true">⚠</span> {children}
    </span>
  );
}

function DecisionCard({ sig, nowMs, displaySymbol, marketFlag }: {
  sig: DecisionSignal;
  nowMs: number;
  displaySymbol: (s: string) => string;
  marketFlag: (s: string) => string;
}) {
  const badge = decisionBadge(sig.status);
  const out = decisionOutcome(sig, nowMs);
  const warn = out.kind === 'check';
  const expired = sig.status === 'expired';
  const flag = marketFlag(sig.symbol);
  const strong = out.kind === 'accepted' || out.kind === 'partial' || out.kind === 'filled';

  return (
    <div style={{
      background: 'var(--bg2)',
      borderRadius: 10,
      border: `1px ${expired ? 'dashed' : 'solid'} ${warn ? 'rgba(245,158,11,.55)' : 'var(--border)'}`,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>

        {/* 행1: 매수/매도 + 심볼 (말줄임) | 상대시간 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{
            flexShrink: 0,
            fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
            background: sig.side === 'buy' ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
            color: sig.side === 'buy' ? 'var(--up)' : 'var(--down)',
          }}>
            {sig.side === 'buy' ? '매수' : '매도'}
          </span>
          {flag && (
            <span style={{ flexShrink: 0, fontSize: 12 }} aria-hidden="true">{flag}</span>
          )}
          <span style={{
            fontSize: 13, fontWeight: 700,
            flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {displaySymbol(sig.symbol)}
          </span>
          <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--muted)' }}>
            {formatRelativeTime(sig.created_at)}
          </span>
        </div>

        {/* 행2: 결정 뱃지 + 결과 | 투자금 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            flexShrink: 0,
            fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
            background: badge.bg, color: badge.color,
          }}>
            {badge.text}
          </span>

          <span style={{
            fontSize: 11, color: 'var(--muted)', flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {warn ? (
              <span className="num" style={{
                ...WARN_CHIP, display: 'inline-block', maxWidth: '100%',
                overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle',
              }}>
                <span style={SR_ONLY}>{out.srPrefix}</span>
                <span aria-hidden="true">{out.icon} </span>{out.text}
              </span>
            ) : out.text ? (
              <span className="num" style={{ color: out.color, fontWeight: strong ? 600 : undefined }}>
                {out.icon && <span aria-hidden="true">{out.icon} </span>}{out.text}
              </span>
            ) : null}
          </span>

          <span className="num" style={{ flexShrink: 0, fontSize: 11, color: 'var(--muted)' }}>
            {fmtNum(Number(sig.amount_krw))}원
          </span>
        </div>

        {/* 확인 필요 — 안내 줄 항상 표시 */}
        {out.hint && (
          <div style={{
            fontSize: 12, lineHeight: 1.5, color: 'var(--text)',
            paddingTop: 6, borderTop: '1px dashed var(--border2)',
          }}>
            <b aria-hidden="true" style={{ color: 'var(--warn)' }}>→</b> {HINT_TEXT}
          </div>
        )}
      </div>
    </div>
  );
}

export function MyDecisionSection({ reloadKey }: { reloadKey: number }) {
  const baseId = useId();
  const bodyId = `${baseId}-body`;
  const titleId = `${baseId}-title`;

  const [open, setOpen]       = useState(false); // 저장하지 않음 — 마운트마다 접힘
  const [period, setPeriod]   = useState<Period>('7d');
  const [filter, setFilter]   = useState<FilterType>('all');
  const [page, setPage]       = useState(0);
  /** null = 아직 데이터 없음(첫 로드·기간 변경 직후) */
  const [signals, setSignals] = useState<DecisionSignal[] | null>(null);
  const [error, setError]     = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const { displaySymbol, marketFlag } = useSymbolMeta();

  // reloadKey(30초·↻)·기간·다시 시도에 반응. 접혀 있어도 조회한다(요약 줄·⚠ 칩).
  // R-1: 본 조회(limit 200 — 최신 만료 행이 창을 채움)와 executing 전용 조회를 **한 묶음**으로 받는다.
  // R-8: 묶음은 `fetchDecisionBundle` 이 **전용 → 본 순차**로 보낸다(본 조회가 나중 스냅샷이어야
  // 중복 id 에서 본 조회가 이기는 병합 규칙이 맞다). 둘 중 하나라도 실패하면 null = 묶음 전체 실패.
  // 늦게 온 묶음은 effect cleanup 의 alive=false 로 버린다(다음 묶음이 시작되면 이전 묶음은 무효).
  // 재조회 실패 시 기존 목록은 그대로 둔다 — 오류 상태는 데이터가 없을 때만 보인다.
  useEffect(() => {
    let alive = true;
    fetchDecisionBundle(url => fetch(url), period, Date.now()).then(data => {
      if (!alive) return;
      if (data) { setSignals(data); setError(false); }
      else setError(true);
    });
    return () => { alive = false; };
  }, [period, reloadKey, retryKey]);

  function changePeriod(p: Period) {
    if (p === period) return;
    setPeriod(p);
    setSignals(null);
    setError(false);
    setPage(0);
  }
  function changeFilter(f: FilterType) {
    setFilter(f);
    setPage(0);
  }
  function retry() {
    setError(false);
    setRetryKey(k => k + 1);
  }

  const nowMs = Date.now();
  const loading = signals === null && !error;
  const failed = signals === null && error;
  const list = signals ?? [];
  const counts = countDecisions(list, nowMs);
  const filtered = filterDecisions(list, filter);
  const win = pageWindow(filtered.length, page);
  const paged = filtered.slice(win.start, win.end);

  const FILTERS: { id: FilterType; label: string }[] = [
    { id: 'all',      label: `전체 ${counts.all}` },
    { id: 'approved', label: `승인 ${counts.approved}` },
    { id: 'rejected', label: `거절 ${counts.rejected}` },
    { id: 'expired',  label: `만료 ${counts.expired}` },
  ];

  let liveText = '';
  if (loading) liveText = '불러오는 중';
  else if (!failed && filtered.length === 0) liveText = '결정 내역 없음';
  else if (!failed) liveText = `${filtered.length}건 중 ${win.start + 1}–${win.end}번째`;

  return (
    <section
      aria-labelledby={titleId}
      style={{ background: 'var(--bg2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}
    >
      {/* 머리 줄 — 진짜 버튼 */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', flexDirection: 'column', gap: 4, width: '100%', textAlign: 'left',
          padding: '10px 14px 8px', minHeight: 44,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, width: '100%' }}>
          <span id={titleId} style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.6px', whiteSpace: 'nowrap' }}>
            내 결정
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)', opacity: .75, whiteSpace: 'nowrap' }}>
            · {PERIOD_SUB[period]}
          </span>
          <span aria-hidden="true" style={{
            marginLeft: 'auto', fontSize: 14, color: 'var(--muted)', display: 'inline-block',
            transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'rotate(0)',
          }}>▾</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: 'var(--text)' }}>
          {loading && <span style={{ color: 'var(--muted)' }}>불러오는 중…</span>}
          {failed && (
            <>
              <WarnChip fontSize={12}>불러오지 못함</WarnChip>
              <span style={{ color: 'var(--muted)' }}>펼쳐서 다시 시도</span>
            </>
          )}
          {!loading && !failed && counts.all === 0 && (
            <span style={{ color: 'var(--muted)' }}>해당 기간 결정 내역 없음</span>
          )}
          {!loading && !failed && counts.all > 0 && (
            <>
              <span>승인 <b className="num">{counts.approved}</b></span>
              <span style={{ color: 'var(--muted)' }}>·</span>
              <span>거절 <b className="num">{counts.rejected}</b></span>
              <span style={{ color: 'var(--muted)' }}>·</span>
              <span>만료 <b className="num">{counts.expired}</b></span>
              {counts.check > 0 && <WarnChip fontSize={12}>확인 필요 {counts.check}건</WarnChip>}
            </>
          )}
        </span>
      </button>

      {/* 본문 — hidden 속성만으로는 인라인 display 가 이겨서 display 도 함께 끈다 */}
      <div
        id={bodyId}
        hidden={!open}
        style={{
          display: open ? 'flex' : 'none', flexDirection: 'column', gap: 6,
          background: 'var(--bg)', padding: '4px 12px 12px', borderTop: '1px solid var(--border)',
        }}
      >
        {/* 기간 */}
        <div role="group" aria-label="기간" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PERIODS.map(p => {
            const on = period === p;
            return (
              <button key={p} type="button" aria-pressed={on} onClick={() => changePeriod(p)} style={HIT}>
                <span style={{ ...PILL, background: on ? 'var(--accent)' : 'var(--bg3)', color: on ? '#000' : 'var(--muted)' }}>
                  {PERIOD_LABEL[p]}
                </span>
              </button>
            );
          })}
        </div>

        {/* 필터 (개수 포함) */}
        <div role="group" aria-label="결정 필터" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(f => {
            const on = filter === f.id;
            return (
              <button key={f.id} type="button" aria-pressed={on} onClick={() => changeFilter(f.id)} style={HIT}>
                <span style={{
                  ...PILL,
                  background: on ? 'var(--bg3)' : 'transparent',
                  color: on ? 'var(--text)' : 'var(--muted)',
                  border: `1px solid ${on ? 'var(--border)' : 'transparent'}`,
                }}>
                  {f.label}
                </span>
              </button>
            );
          })}
        </div>

        <p aria-live="polite" style={SR_ONLY}>{liveText}</p>

        {loading && <div role="status" style={STATE_MSG}>불러오는 중...</div>}

        {failed && (
          <div role="alert" style={{ ...STATE_MSG, color: 'var(--text)' }}>
            <b aria-hidden="true" style={{ color: 'var(--warn)' }}>⚠</b> 결정 내역을 불러오지 못했습니다.<br />
            <span style={{ color: 'var(--muted)' }}>30초 뒤 자동으로 다시 시도합니다.</span><br />
            <button
              type="button"
              onClick={retry}
              style={{
                marginTop: 8, minHeight: 44, padding: '0 16px', borderRadius: 8,
                background: 'var(--bg3)', border: '1px solid var(--border2)', fontSize: 13, fontWeight: 600,
              }}
            >
              다시 시도
            </button>
          </div>
        )}

        {!loading && !failed && filtered.length === 0 && (
          <div style={STATE_MSG}>해당 기간 결정 내역 없음</div>
        )}

        {!loading && !failed && paged.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {paged.map(sig => (
              <DecisionCard
                key={sig.id}
                sig={sig}
                nowMs={nowMs}
                displaySymbol={displaySymbol}
                marketFlag={marketFlag}
              />
            ))}
          </div>
        )}

        {!loading && !failed && win.totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <PagerButton
              label="← 이전" aria="이전 페이지" disabled={win.page === 0}
              onClick={() => setPage(Math.max(0, win.page - 1))}
            />
            <span className="num" style={{ fontSize: 12, color: 'var(--muted)' }}>
              {win.page + 1} / {win.totalPages}
            </span>
            <PagerButton
              label="다음 →" aria="다음 페이지" disabled={win.page >= win.totalPages - 1}
              onClick={() => setPage(Math.min(win.totalPages - 1, win.page + 1))}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function PagerButton({ label, aria, disabled, onClick }: {
  label: string; aria: string; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={aria}
      disabled={disabled}
      onClick={onClick}
      style={{ ...HIT, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <span style={{
        padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
        background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border)',
        opacity: disabled ? .45 : 1,
      }}>
        {label}
      </span>
    </button>
  );
}

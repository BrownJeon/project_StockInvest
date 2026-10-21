'use client';

import { useRouter } from 'next/navigation';
import { cardSummary, type StoredScenario } from './scenario-view-model';
import {
  parseIndicators, scenarioOf, confidenceOf, isOverseasSignal, fmtApproxKrw, sessionLine, earningsLine,
  type EarningsLineView,
} from './scenario-card-display';

export interface SignalWithScenario {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  status: string;
  expires_at: string | null;
  /** T-062 — 해외 카드 "미국 정규장" 줄의 시작 시각(09:30 ET 를 KST 로 저장). 목록·상세 API 모두 SELECT 한다. */
  valid_from?: string | null;
  created_at: string;
  quantity?: number | null;
  /** DB DECIMAL — mysql2 는 문자열(`"100000.00"`)로 준다. 표시는 `fmtApproxKrw()` 경유. */
  amount_krw?: number | string | null;
  /**
   * ⚠ 목록 API(`GET /api/signals`)는 이 값을 **JSON 문자열**로 준다(파싱하지 않음 — T-062 가이드 G1).
   * 상세 API 만 객체로 파싱한다. 읽을 때는 반드시 `parseIndicators()`/`scenarioOf()` 를 거친다.
   * (타입을 `string` 까지 넓히면 `TradingBoard.tsx` WatchCard 의 `?.ai` 접근이 컴파일되지 않아 —
   *  그 파일은 이번 범위 밖 — 선언은 그대로 두고 읽는 쪽에서 방어한다.)
   */
  indicators: {
    ai?: {
      /**
       * DB 에 저장된 시나리오 JSON. **전 필드 옵셔널** — post-market 엔진 경로는
       * grade/entry/exit 만 채우고 나머지를 넣지 않는다(T-021). 타입 정의는
       * `./scenario-view-model` 참고.
       */
      scenario?: StoredScenario;
    };
  } | null;
  reasoning?: string | null;
  market?: 'domestic' | 'overseas';
  /** 사용자 생성 시나리오 여부 */
  scenario_source?: 'ai' | 'user';
  displayName?: string;
  marketFlag?: string;
}

interface Props {
  signal: SignalWithScenario;
}

const GRADE_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  'A':  { color: '#22c55e', bg: 'rgba(34,197,94,.15)',   border: 'rgba(34,197,94,.4)'  },
  'B+': { color: '#818cf8', bg: 'rgba(99,102,241,.18)',  border: 'rgba(99,102,241,.4)' },
  'B':  { color: '#f59e0b', bg: 'rgba(245,158,11,.15)',  border: 'rgba(245,158,11,.4)' },
  'C':  { color: '#6b7280', bg: 'var(--bg3)',            border: 'var(--border2)'      },
};

function minutesUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.max(0, Math.floor((new Date(dateStr).getTime() - Date.now()) / 60000));
}

function fmtQty(qtyRaw: number | string | null | undefined, amountKrw: unknown): string | null {
  // DB DECIMAL(36,18) 컬럼은 mysql2 가 문자열로 반환한다 — Number 로 정직하게 변환 후 다룬다.
  const qty = qtyRaw != null ? Number(qtyRaw) : null;
  if (qty != null && qty > 0) {
    return Number.isInteger(qty) ? `${qty}주` : `${(Math.floor(qty * 100) / 100).toFixed(2)}주`;
  }
  // T-063(T-062 WP-U 합침): amount_krw 는 DECIMAL 문자열이라 String#toLocaleString 이 옵션을 무시해
  // "약 100000.00원" 이 보였다 — 숫자로 바꾼 뒤 "약 100,000원" 으로 서식한다.
  return fmtApproxKrw(amountKrw);
}

/** T-062 — 시장 배지 "🇺🇸 미국"(국기는 aria-hidden, 글자 "미국" 은 읽힘). 추천·내일·승인 화면 공통 모양. */
export function UsMarketBadge({ style }: { style?: React.CSSProperties }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
      fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 6,
      border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)',
      whiteSpace: 'nowrap', ...style,
    }}>
      <span aria-hidden>🇺🇸</span>미국
    </span>
  );
}

/** T-062 — 실적 한 줄(노랑 겹침 / 회색 없음). 상태는 글자로 전달, ⚠ 는 aria-hidden. */
export function EarningsNote({ view, style }: { view: EarningsLineView; style?: React.CSSProperties }) {
  const warn = view.tone === 'warn';
  return (
    <div style={{
      fontSize: 11, lineHeight: 1.45,
      color: warn ? 'var(--warn)' : 'var(--muted)',
      ...(warn ? { background: 'rgba(245,158,11,.08)', borderRadius: 6, padding: '3px 6px' } : {}),
      ...style,
    }}>
      {warn && <><span aria-hidden>⚠</span>{' '}</>}{view.text}{' '}
      <span style={{ color: 'var(--muted)' }}>{view.note}</span>
    </div>
  );
}

export function ScenarioCard({ signal }: Props) {
  const router = useRouter();
  // 목록 API 는 indicators 를 문자열로 준다(G1) — 문자열·객체 모두 여기서 객체로.
  const ind = parseIndicators(signal.indicators);
  const scenario = scenarioOf(ind);
  const confidence = confidenceOf(ind);
  const overseas = isOverseasSignal(signal);
  const session = overseas ? sessionLine(signal.valid_from, signal.expires_at) : null;
  const earnings = overseas ? earningsLine(ind) : null;
  // 결측 필드는 전부 null 로 정규화 — `exit`/`entry` 객체 자체가 없어도 여기서 죽지 않는다.
  const { grade, targetPct, targetPctHi, stopPct, stopPctHi, trigger, holdingDays, riskFactors } =
    cardSummary(scenario);
  const gs = GRADE_STYLE[grade ?? 'C'] ?? GRADE_STYLE['C'];
  const minsLeft = minutesUntil(signal.expires_at);
  const isExpiringSoon = minsLeft !== null && minsLeft <= 60;
  const isUserScenario = signal.scenario_source === 'user';
  const qtyLabel = fmtQty(signal.quantity, signal.amount_krw);

  return (
    <div
      onClick={() => router.push(`/recommend/${signal.id}`)}
      style={{
        background: 'var(--bg2)',
        border: `1px solid ${isExpiringSoon ? 'rgba(245,158,11,.5)' : 'var(--border)'}`,
        borderRadius: 12,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        cursor: 'pointer',
      }}
    >
      {/* 만료 임박 배지 */}
      {isExpiringSoon && minsLeft !== null && (
        <div style={{ fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
          ⏱ {minsLeft}분 후 만료
        </div>
      )}

      {/* Row 1: 종목 + 등급 + 소스 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, flexShrink: 0,
            background: signal.side === 'buy' ? 'rgba(239,68,68,.18)' : 'rgba(59,130,246,.18)',
            color: signal.side === 'buy' ? 'var(--up)' : 'var(--down)',
          }}>
            {signal.side === 'buy' ? '매수' : '매도'}
            {qtyLabel && <span style={{ marginLeft: 4, fontWeight: 600 }}>· {qtyLabel}</span>}
          </span>
          {overseas
            ? <UsMarketBadge />
            : signal.marketFlag && <span aria-hidden style={{ flexShrink: 0 }}>{signal.marketFlag}</span>}
          <span style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {signal.displayName ?? signal.symbol}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          {isUserScenario && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
              background: 'rgba(99,102,241,.18)', color: '#818cf8',
              border: '1px solid rgba(99,102,241,.3)',
            }}>내 시나리오</span>
          )}
          {grade && (
            <span style={{
              fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
              background: gs.bg, color: gs.color, border: `1px solid ${gs.border}`,
            }}>
              {grade}
              {confidence != null && <span style={{ fontWeight: 600 }}> {confidence}%</span>}
            </span>
          )}
        </div>
      </div>

      {/* Row 2: 매수 → 목표%, 매도 → 손절% */}
      {signal.side === 'buy' && targetPct != null && (
        <div style={{ fontSize: 13 }}>
          <span className="num" style={{ color: 'var(--up)', fontWeight: 700 }}>
            +{targetPct}{targetPctHi != null && targetPctHi !== targetPct ? `~${targetPctHi}` : ''}% 목표
          </span>
        </div>
      )}
      {signal.side === 'sell' && stopPct != null && (
        <div style={{ fontSize: 13 }}>
          <span className="num" style={{ color: 'var(--down)', fontWeight: 700 }}>
            -{Math.abs(stopPct)}{stopPctHi != null && stopPctHi !== stopPct ? `~${Math.abs(stopPctHi)}` : ''}% 손절
          </span>
        </div>
      )}

      {/* Row 3: 진입 트리거 + 보유기간 */}
      {(trigger || holdingDays) && (
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          {trigger && (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
              {trigger}
            </span>
          )}
          {holdingDays && (
            <span style={{ marginLeft: trigger ? 8 : 0, color: 'var(--muted)', fontWeight: 600 }}>· {holdingDays}</span>
          )}
        </div>
      )}

      {/* T-062 해외 카드: 미국 정규장 시간 줄 · 실적 한 줄 (키가 없으면 그리지 않는다) */}
      {session && (
        <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.45 }}>{session}</div>
      )}
      {earnings && <EarningsNote view={earnings} style={{ marginTop: 4 }} />}

      {/* Row 4: 리스크 요인 */}
      {riskFactors.length > 0 && (
        <div style={{ fontSize: 12, color: '#f59e0b', background: 'rgba(245,158,11,.08)', padding: '6px 10px', borderRadius: 8 }}>
          ⚠ {riskFactors[0]}
        </div>
      )}

    </div>
  );
}

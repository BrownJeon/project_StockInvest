'use client';

/**
 * T-108 분석 › 데이터 상태 (가이드 §2.5) — 가동률(세션일·주 단위) · 원천별 신선도 + `/markets` 입구(L-1).
 * 데이터 `/api/ops/analysis?part=data`(읽기 전용). 「날짜 파일이 있다」는 성공 증거가 아니다 — 마지막 성공 시각 기준.
 * 가동률 분자는 정상(ok) 회차만(D6). 기록(job_run_log) 첫날부터 7일 미만이면 비율 대신 「기록 {n}일째」.
 */
import type { ReactNode } from 'react';
import type { AnalysisDataDTO, DataSourceId, DataSourceRow, UptimeRow } from '@/lib/ops/metrics/types';
import { useOpsPoll } from '@/components/ops/useOpsPoll';
import { fmtEtSession, fmtKstTime, fmtSessionDate, kstDateKey, kstParts } from '@/components/ops/format';
import { CheckRow, Rows, Section, StatusChip, ops } from '@/components/ops/ui';
import { ANALYSIS_POLL_MS, FailBody, LoadingBody, analysisUrl, stateChip } from './panel-parts';

export const SOURCE_LABEL: Record<DataSourceId, string> = {
  portfolio_snapshot: '포트폴리오 스냅샷',
  fx_usdkrw: '환율 USD/KRW',
  daily_bars_kr: '일봉 국내',
  daily_bars_us: '일봉 해외',
  news_domestic: '뉴스 국내',
  news_overseas: '뉴스 해외',
  broker_ledger: '브로커 원장',
};

/** 원천 1줄의 기준 표시 — 뉴스 0건 연속이면 그 일수, 일봉은 마지막 봉 날짜(해외 ET), 그 밖은 마지막 성공 시각. */
export function sourceWhen(r: DataSourceRow, nowMs: number): string {
  if ((r.id === 'news_domestic' || r.id === 'news_overseas') && r.streak != null && r.streak >= 1) return `${r.streak}일 연속 0건`;
  if (r.id === 'daily_bars_kr' && r.dateRef) return fmtSessionDate(r.dateRef);
  if (r.id === 'daily_bars_us' && r.dateRef) return fmtEtSession(r.dateRef);
  // 날짜만 있는 원천(뉴스 = 마지막 정상일)은 시각 대신 날짜
  if (!r.lastOkAt && r.dateRef) return fmtSessionDate(r.dateRef);
  return fmtKstTime(r.lastOkAt, nowMs);
}

function sourceChip(r: DataSourceRow, nowMs: number): ReactNode {
  if (r.state === 'available' || r.state === 'zero') return <StatusChip kind="zero">정상</StatusChip>;
  if (r.state === 'partial') return <StatusChip kind="partial">degraded</StatusChip>;
  return stateChip({ state: r.state, asOf: r.lastOkAt, reason: r.reason }, { nowMs });
}

const UPTIME_LABEL: Record<UptimeRow['group'], { k: string; s: string }> = {
  analysis: { k: '장마감 분석 (국내·해외)', s: '예정 회차 대비 정상(ok) 회차 — 분자는 ok 만(D6), partial·degraded 는 별도 선' },
  collection: { k: '데이터 수집 (뉴스·일봉·스냅샷·공시)', s: '실행 기록(job_run_log, T-112) 이 쌓인 날부터 — 지난 기록은 소급 불가' },
};

/** 기록 첫날(KST)부터 오늘까지 며칠째인가(첫날 = 1일째). */
export function recordDay(firstRecordAt: string | null, nowMs: number): number | null {
  const p = kstParts(firstRecordAt);
  if (!p) return null;
  const a = Date.UTC(p.y, p.mo - 1, p.d);
  const [y, m, d] = kstDateKey(nowMs).split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - a) / 86_400_000) + 1;
}

export function uptimeValue(u: UptimeRow, nowMs: number): ReactNode {
  // 서버가 7일 미만을 state='prep'·reason 'under_7_days'·days=기록 일수로 준다. 없으면 첫 기록 시각에서 센다.
  const day = u.reason === 'under_7_days' && u.days > 0 ? u.days : recordDay(u.firstRecordAt, nowMs);
  if (u.state === 'prep' || u.state === 'unknown') {
    return day != null && day < 7
      ? <StatusChip kind="prep">기록 {day}일째 — 주 단위 비율은 7일 뒤</StatusChip>
      : <StatusChip kind="prep">준비 중</StatusChip>;
  }
  if ((u.state === 'available' || u.state === 'zero' || u.state === 'partial' || u.state === 'stale') && u.expected != null && u.expected > 0) {
    if (day != null && day < 7) return <StatusChip kind="prep">기록 {day}일째 — 주 단위 비율은 7일 뒤</StatusChip>;
    return <span className="num" style={{ fontWeight: 700 }}>{u.ok}/{u.expected} ({Math.round((u.ok / u.expected) * 100)}%)</span>;
  }
  return stateChip({ state: u.state, asOf: null, reason: u.reason }, { nowMs }) ?? '—';
}

export function DataPanel(p: { nowMs?: number }) {
  const nowMs = p.nowMs ?? Date.now();
  const poll = useOpsPoll<AnalysisDataDTO>(analysisUrl('data'), { intervalMs: ANALYSIS_POLL_MS });
  const d = poll.data;
  const fail = !d && poll.status === 'error' ? <FailBody code={poll.error ?? 'api_error'} onRetry={poll.refresh} /> : null;

  let uptime: ReactNode;
  if (!d) uptime = fail ?? <LoadingBody />;
  else if (d.uptime.state === 'error') uptime = <FailBody code={d.uptime.error} onRetry={poll.refresh} />;
  else {
    const byGroup = new Map(d.uptime.data.map(u => [u.group, u]));
    uptime = (
      <Rows>
        {(['analysis', 'collection'] as const).map(g => {
          const u = byGroup.get(g);
          return (
            <div key={g} className={ops.kv}>
              <span>{UPTIME_LABEL[g].k}</span>
              {u ? uptimeValue(u, nowMs) : <StatusChip kind="prep">준비 중</StatusChip>}
              <span className={ops.s}>{UPTIME_LABEL[g].s}</span>
            </div>
          );
        })}
      </Rows>
    );
  }

  let sources: ReactNode;
  if (!d) sources = fail ?? <LoadingBody />;
  else if (d.sources.state === 'error') sources = <FailBody code={d.sources.error} onRetry={poll.refresh} />;
  else {
    sources = (
      <Rows>
        {d.sources.data.map(r => (
          <div key={r.id} className={ops.kv}>
            <span>{SOURCE_LABEL[r.id] ?? r.id} <span className="num" style={{ color: 'var(--muted)', fontSize: 12 }}>· {sourceWhen(r, nowMs)}</span></span>
            {sourceChip(r, nowMs)}
          </div>
        ))}
      </Rows>
    );
  }

  return (
    <div className={ops.scr}>
      <div className={ops.col}>
        <Section id="d-up" title="가동률" small="세션일 · 주 단위">{uptime}</Section>
      </div>
      <div className={ops.col}>
        <Section id="d-src" title="원천별 신선도">
          {sources}
          <div className={ops['sec-foot']} style={{ paddingTop: 8 }}>「날짜 파일이 있다」는 성공 증거가 아닙니다 — 마지막 성공 시각 기준</div>
          {/* L-1 — /markets(시장 상태 상세) 입구. 옛 홈 시장 배지가 유일한 입구였다 */}
          <Rows>
            <CheckRow severity="n" glyph="◷" href="/markets" title="시장 개장 상태" />
          </Rows>
        </Section>
      </div>
    </div>
  );
}

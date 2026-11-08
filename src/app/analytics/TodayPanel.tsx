'use client';

/**
 * T-108 분석 › 오늘 분석 (가이드 §2.5) — ① 장마감 AI 분석 표(홈과 같은 `AnalysisStageTable`) ② 후보 ③ 종목별 입구.
 * 데이터 `/api/ops/analysis?part=today`(읽기 전용). 「AI 매수 안 함」 종목은 판단 기록(T-112)이 켜지기 전엔 남지 않는다 → 「준비 중」.
 */
import type { ReactNode } from 'react';
import type { AnalysisCandidate, AnalysisTodayDTO, OpsStage } from '@/lib/ops/metrics/types';
import { useOpsPoll } from '@/components/ops/useOpsPoll';
import { AnalysisStageTable } from '@/components/home/AnalysisSection';
import { CHIP, fmtEtSession, fmtKstTime } from '@/components/ops/format';
import { exclusionText, signalFate } from '@/components/ops/reason-copy';
import { CheckRow, EmptyNote, Rows, Section, StatusChip, ops } from '@/components/ops/ui';
import { InPageRow } from '@/app/recommend/InPageRow';
import type { AnalyticsDetail } from './route-resolve';
import { ANALYSIS_POLL_MS, FailBody, LoadingBody, analysisUrl, hasValue } from './panel-parts';

/**
 * 시그널 상태 → 후보 줄 부제(시그널로 이어진 종목).
 * `skipped` 는 여기 없다 — 검증 관문에 막힌 것과 그 밖(수량 1주 미만 등)이 다르게 불려야 해서 `signalFate(status, gate)`(사전)가 맡는다(T-130 D7-A).
 */
const SIGNAL_FATE: Record<string, string> = {
  awaiting_approval: '승인 대기', pending: '승인 대기', pending_approval: '승인 대기',
  approved_pending_entry: '진입 감시', executing: '주문 처리 중',
  expired: '만료', rejected: '거절', approved: '승인', auto_submitted: '자동 제출',
};

export function candidateRow(c: AnalysisCandidate, displaySymbol: (s: string) => string): { severity: 'w' | 'n'; glyph: string; title: string; sub: string } {
  const mk = c.market === 'overseas' ? '해외' : '국내';
  if (c.origin === 'judgment_skip') {
    return { severity: 'n', glyph: '·', title: `${displaySymbol(c.symbol)} ${mk} · AI 매수 안 함`, sub: c.exclusionCode ? `제외 사유 ${exclusionText(c.exclusionCode)}` : '제외 사유 기록 없음' };
  }
  const conf = c.confidence != null ? ` · 신뢰도 ${Math.round(c.confidence)}` : '';
  // `skipped` 는 gate 로 갈린다: 검증 관문 → 「⊘ 차단 · 검증 관문」(경고 줄), gate 없음 → 「건너뜀 · 사유 기록 없음」(보통 줄)
  const sf = signalFate(c.signalStatus, c.signalGate);
  const fate = sf ? sf.chip : (SIGNAL_FATE[c.signalStatus ?? ''] ?? '처리됨');
  const blocked = sf?.blocked === true;
  const session = c.market === 'overseas' ? `${fmtEtSession(c.session.sessionDate)} 세션 · ` : '';
  return {
    severity: blocked ? 'w' : 'n',
    glyph: blocked ? '⊘' : '·',
    title: `${displaySymbol(c.symbol)} ${mk} · AI 매수 판단${conf}`,
    sub: `${session}시그널 생성 → ${fate}`,
  };
}

export function TodayPanel(p: { stage: OpsStage | null; displaySymbol: (s: string) => string; onGoDetail: (d: AnalyticsDetail) => void; nowMs?: number }) {
  const nowMs = p.nowMs ?? Date.now();
  const poll = useOpsPoll<AnalysisTodayDTO>(analysisUrl('today'), { intervalMs: ANALYSIS_POLL_MS });
  const d = poll.data;
  const staleBase = poll.status === 'stale' && poll.lastOkAt ? fmtKstTime(new Date(poll.lastOkAt).toISOString(), nowMs) : null;

  // ① 장마감 AI 분석
  let runs: ReactNode;
  if (!d) runs = poll.status === 'error' ? <FailBody code={poll.error ?? 'api_error'} onRetry={poll.refresh} /> : <LoadingBody />;
  else if (d.runs.state === 'error') runs = <FailBody code={d.runs.error} onRetry={poll.refresh} />;
  else runs = <AnalysisStageTable runs={d.runs.data} stage={p.stage ?? 'unknown'} staleBase={staleBase} />;

  // ② 후보
  let cands: ReactNode;
  if (!d) cands = poll.status === 'error' ? <FailBody code={poll.error ?? 'api_error'} onRetry={poll.refresh} /> : <LoadingBody />;
  else if (d.candidates.state === 'error') cands = <FailBody code={d.candidates.error} onRetry={poll.refresh} />;
  else {
    const { rows, skipRows } = d.candidates.data;
    const signalRows = rows.filter(r => r.origin === 'signal');
    const skipList = rows.filter(r => r.origin === 'judgment_skip');
    const runsOk = d.runs.state === 'ok' && d.runs.data.domestic.runStatus === 'ok' && d.runs.data.overseas.runStatus === 'ok';
    cands = (
      <Rows>
        {signalRows.length === 0 ? (
          <CheckRow severity="n" glyph="◌" title="시그널로 이어진 종목 없음"
            sub={runsOk ? <StatusChip kind="zero">{CHIP.zero}</StatusChip> : <StatusChip kind="unknown">{CHIP.unknown}</StatusChip>} />
        ) : signalRows.map((c, i) => {
          const r = candidateRow(c, p.displaySymbol);
          return <CheckRow key={`s${i}`} severity={r.severity} glyph={r.glyph} title={r.title} sub={r.sub} />;
        })}
        {skipRows.state === 'available' || skipRows.state === 'zero' ? (
          skipList.length > 0
            ? skipList.map((c, i) => { const r = candidateRow(c, p.displaySymbol); return <CheckRow key={`k${i}`} severity={r.severity} glyph={r.glyph} title={r.title} sub={r.sub} />; })
            : <CheckRow severity="n" glyph="·" title="AI 매수 안 함 · 제외 사유 목록" sub={<StatusChip kind="zero">{CHIP.zero}</StatusChip>} />
        ) : skipRows.state === 'prep' ? (
          <CheckRow severity="n" glyph="◌" title="AI 매수 안 함 · 제외 사유 목록"
            sub={<><StatusChip kind="prep">준비 중</StatusChip> 기준 판단 기록(T-112) 뒤 — 지금은 시그널로 이어진 것만 남습니다</>} />
        ) : (
          <CheckRow severity="n" glyph="◌" title="AI 매수 안 함 · 제외 사유 목록"
            sub={skipRows.state === 'error'
              ? <StatusChip kind="error">{CHIP.error(skipRows.reason ?? 'error')}</StatusChip>
              : <><StatusChip kind="unknown">{CHIP.unknown}</StatusChip> 이 세션 판단 기록 없음</>} />
        )}
      </Rows>
    );
  }

  // ③ 종목별
  const rc = d?.researchCount;
  const researchTitle = hasValue(rc) ? `리서치 추적 ${rc.value}종목` : '리서치 추적';

  return (
    <div className={ops.scr}>
      <div className={ops.col}>
        <Section id="a-run" title="장마감 AI 분석" small="시장별 세션일">{runs}</Section>
        <Section id="a-cand" title="후보" small="오늘">{cands}</Section>
      </div>
      <div className={ops.col}>
        <Section id="a-sym" title="종목별">
          <Rows>
            <InPageRow href="?tab=research" onGo={() => p.onGoDetail('research')} glyph="▤" title={researchTitle} sub="기존 리서치분석 — 과거 통계 관찰용, 자동매매와 별개" />
            <InPageRow href="?tab=leaderboard" onGo={() => p.onGoDetail('leaderboard')} glyph="▲" title="주도주" sub="기존 화면 그대로" />
            <CheckRow severity="n" glyph="☆" href="/favorites" title="관심 종목 관리 (현재 즐겨찾기)" sub="추가·삭제·메모·리서치 추적 설정 그대로 — 분석 대상 입력이므로 없애지 않음" />
            <InPageRow href="?tab=m40" onGo={() => p.onGoDetail('m40')} glyph="▤" title="M40 모의분석" sub="수집 · 종목 판단 · 모의 매수·매도 · 모의성과 / 실주문 없음" />
          </Rows>
          {d && rc && !hasValue(rc) && rc.state === 'error' ? <EmptyNote><StatusChip kind="error">{CHIP.error(rc.reason ?? 'error')}</StatusChip></EmptyNote> : null}
        </Section>
      </div>
    </div>
  );
}

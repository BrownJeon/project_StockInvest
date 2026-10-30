import type { ReactNode } from 'react';
import type { AnalysisRunRow, ByMarket, Metric, OpsStage, Section as Sec } from '@/lib/ops/metrics/types';
import { metricSetFor } from '@/lib/ops/metrics/stage';
import { DASH, fmtKstDateTime, fmtKstHm, fmtSession } from '@/components/ops/format';
import { SkelBar } from '@/components/ops/ui/LineList';
import { RetryButton } from '@/components/ops/ui/RetryButton';
import { Section, SectionBody } from '@/components/ops/ui/Section';
import { SectionLink } from '@/components/ops/ui/SectionLink';
import { StageTable, type StageHead } from '@/components/ops/ui/StageTable';
import { StatusChip } from '@/components/ops/ui/StatusChip';
import { skipReasonCode, skipText } from '@/components/ops/reason-copy';
import { ErrorChip, MetricReason, baseTime, hasValue, isStale, sectionData, sectionErrorCode, type HomeCtx } from './home-ctx';

/**
 * 홈 ⑤ 오늘의 분석·판단 — 데모 `anaTable()`·`anaSec()` · 가이드 §2.3.6. 장마감 AI 분석만(D1), 국내(KST 세션일)·해외(ET 세션일) 두 열.
 * 분석 › 오늘 분석 ①(WP-C)도 같은 표를 쓴다 → 표 부분은 `AnalysisStageTable` 로 떼어 export 한다(행·caption·◌/준비 중 규칙 한 곳).
 * - 값 없음: ◌(기록 켜짐·행 없음) / 준비 중(스위치 꺼짐·테이블 없음). 시그널 0 은 그 시장 run 이 ok 일 때만(서버가 zero 로 준다).
 * - 다음 분석 시각은 서버 `nextRunAt`(스케줄 표에서 계산) — 화면 상수 없음.
 */
export function AnalysisSection({ ctx, analysis }: { ctx: HomeCtx; analysis: Sec<ByMarket<AnalysisRunRow>> | null }) {
  const head = { id: 'h-ana', title: '오늘의 분석·판단', link: <SectionLink href="/analytics?tab=today" ariaLabel="분석 탭에서 오늘 분석 전체 보기">전체</SectionLink> };
  if (ctx.poll === 'loading') {
    return <Section {...head} busy><SectionBody><SkelBar w={80} /><br /><SkelBar w={50} /></SectionBody></Section>;
  }
  const err = sectionErrorCode(ctx, analysis);
  const runs = sectionData(analysis);
  if (err || !runs) {
    return <Section {...head}><SectionBody><ErrorChip code={err ?? 'missing'} /> <RetryButton onClick={ctx.onRetry} /></SectionBody></Section>;
  }
  return (
    <Section {...head}>
      <AnalysisStageTable runs={runs} stage={ctx.stage} staleBase={isStale(ctx) ? baseTime(ctx) : null} />
    </Section>
  );
}

/** 표 칸 1개 — 값(0 은 확인된 0 일 때만) / ◌ / 준비 중 / ! / 건너뜀(사유는 머리 칸에 — 「휴장」 단정 안 함). */
function cell(m: Metric<number>, skipped: boolean): ReactNode {
  if (hasValue(m)) return String(m.value);
  if (skipped || m.state === 'off_hours') return <StatusChip kind="off">건너뜀</StatusChip>;
  return <MetricReason m={m} short />;
}

function exclusionCell(m: AnalysisRunRow['topExclusion'], skipped: boolean): ReactNode {
  if (m.state === 'zero') return DASH;
  if (hasValue(m)) return `${m.value.label} ${m.value.count}`;
  if (skipped || m.state === 'off_hours') return <StatusChip kind="off">건너뜀</StatusChip>;
  return <MetricReason m={m} short />;
}

const isSkipped = (r: AnalysisRunRow) => r.runStatus === 'skipped' || r.evaluated.state === 'off_hours';

/** 머리 칸: 「10-30 · 16:00 실행」 / 건너뛴 세션은 「10-30 · 건너뜀 · 주말」(사유 코드를 말로). */
function headOf(r: AnalysisRunRow, market: '국내' | '해외'): StageHead {
  const s = fmtSession(r.session);
  if (isSkipped(r)) return { text: market, small: `${s} · ${skipText(skipReasonCode(r))}` };
  return { text: market, small: r.runStartedAt ? `${s} · ${fmtKstHm(r.runStartedAt)} 실행` : s };
}

/**
 * 「오늘의 분석·판단」 표(섹션 틀 없음) — 홈·분석 › 오늘 분석 공용.
 * stage 가 mixed·live 면 5번째 행이 「승인 대기」(signalsPending), 그 밖은 「검증 차단」(signalsBlocked).
 * staleBase 가 있으면(재조회 실패로 마지막 값) 값 회색 + caption 끝 「오래됨: 기준 {시각}」.
 */
export function AnalysisStageTable({ runs, stage, staleBase }: { runs: ByMarket<AnalysisRunRow>; stage: OpsStage; staleBase?: string | null }) {
  const d = runs.domestic, o = runs.overseas;
  const live = metricSetFor(stage) === 'live';
  const anyExclusion = hasValue(d.topExclusion) && d.topExclusion.state !== 'zero' || hasValue(o.topExclusion) && o.topExclusion.state !== 'zero';
  const ds = isSkipped(d), os = isSkipped(o);
  const rows = [
    { label: '평가 종목', cells: [cell(d.evaluated, ds), cell(o.evaluated, os)] },
    { label: '규칙 후보', cells: [cell(d.ruleCandidates, ds), cell(o.ruleCandidates, os)] },
    { label: 'AI 매수 판단', cells: [cell(d.aiBuy, ds), cell(o.aiBuy, os)] },
    { label: '시그널 생성', cells: [cell(d.signalsCreated, ds), cell(o.signalsCreated, os)] },
    live
      ? { label: '승인 대기', cells: [cell(d.signalsPending, ds), cell(o.signalsPending, os)] }
      : { label: '검증 차단', cells: [cell(d.signalsBlocked, ds), cell(o.signalsBlocked, os)] },
    { label: anyExclusion ? '제외 사유 1위' : '제외 사유', cells: [exclusionCell(d.topExclusion, ds), exclusionCell(o.topExclusion, os)] },
  ];
  const dim = !!staleBase || [d, o].some((r) => r.evaluated.state === 'stale' || r.signalsCreated.state === 'stale');
  const caption = (
    <>
      <b>AI 매수 판단</b> = AI 가 「지금 살 만하다」고 본 종목 수(그 외는 「매수 안 함」) · 장마감 AI 분석만(D1) · 국내 = KST 세션일, 해외 = ET 세션일 ·
      다음 분석 국내 {d.nextRunAt ? fmtKstDateTime(d.nextRunAt) : DASH} · 해외 {o.nextRunAt ? fmtKstDateTime(o.nextRunAt) : DASH} KST(스케줄 표에서 읽음)
      {staleBase ? ` · 오래됨: 기준 ${staleBase}` : ''}
    </>
  );
  return <StageTable caption={caption} head={['단계', headOf(d, '국내'), headOf(o, '해외')]} rows={rows} dim={dim} />;
}

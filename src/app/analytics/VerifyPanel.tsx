'use client';

/**
 * T-108 분석 › 검증·성과 (가이드 §2.5) — 사후 성과 · 후보·제외 사유 추이 · 실거래 성과 / 청산 로직 (X1~X6).
 * 데이터 `/api/ops/analysis?part=verify`(읽기 전용).
 *
 *  - 사후 성과: 건수는 채우고 초과수익 중앙값은 v1 「준비 중」(L-3 — 서버 medianExcessPct.state='prep'). 30건 미만이면 경고(T-095).
 *    숫자가 오면(구현 뒤) 부호·색에 「초과」/「미달」 글자를 같이 쓴다(색만으로 구분 금지).
 *  - 청산 로직 kv 6행: available 이면 칩 없음, 30일 한정은 「30일 보존 한정」, X6 은 「준비 중 — 완전판 T-112」.
 *  - 상세 입구: 놓친 기회 · 신호 진단 · 포트폴리오(옛 분석 탭, 수정 없이).
 */
import type { ReactNode } from 'react';
import type { AnalysisVerifyDTO, ByMarket, ExitDetail, Metric, OpsStage } from '@/lib/ops/metrics/types';
import { useOpsPoll } from '@/components/ops/useOpsPoll';
import { CHIP, FEW_SAMPLE_LIMIT, fmtPct } from '@/components/ops/format';
import { EmptyNote, Rows, Section, StageTable, StatusChip, ops } from '@/components/ops/ui';
import { exitKindLabel } from '@/components/home/check-copy';
import { InPageRow } from '@/app/recommend/InPageRow';
import type { AnalyticsDetail } from './route-resolve';
import { ANALYSIS_POLL_MS, FailBody, LoadingBody, analysisUrl, hasValue, stateChip } from './panel-parts';

const MK = { domestic: '국내', overseas: '해외' } as const;

function medianCell(m: Metric<number>, nowMs: number): ReactNode {
  if (hasValue(m)) {
    const f = fmtPct(m.value);
    return <span className={f.tone ?? undefined}>{f.text}{m.value > 0 ? ' 초과' : m.value < 0 ? ' 미달' : ''}</span>;
  }
  if (m.state === 'prep') return <StatusChip kind="prep">준비 중</StatusChip>;
  return stateChip(m, { nowMs }) ?? '—';
}

/** partial 사유 → 칩 글자. 조회 상한에 잘렸으면(truncated) 일부만 센 것이라고 말한다. */
function partialText(reason: string | undefined, fallback?: string): string | undefined {
  return reason === 'truncated' ? '일부만 (조회 상한 초과)' : fallback;
}

/** 청산 로직 X1~X6 kv 한 줄(데모 852~857행 모양): 이름 · 칩 · 설명. */
interface XRow { k: string; d: ReactNode; chip: ReactNode }

/** 엔진 OFF 면 서버가 판정·제안을 state='blocked'(reason 'engine_off')로 준다 — 0 이 아니라 「엔진 꺼짐」. */
const ENGINE_OFF = (m: { state: string; reason?: string }) => m.state === 'blocked' && m.reason === 'engine_off';

function perMarket<T>(bm: ByMarket<Metric<T>>, fmt: (v: T, m: 'domestic' | 'overseas') => string): string {
  return (['domestic', 'overseas'] as const).map(mk => {
    const m = bm[mk];
    if (ENGINE_OFF(m)) return `${MK[mk]} — (엔진 꺼짐)`;
    if (m.state === 'off_hours') return `${MK[mk]} 장외`;
    if (hasValue(m)) return fmt(m.value, mk);
    if (m.state === 'error') return `${MK[mk]} 조회 실패`;
    return `${MK[mk]} ◌`;
  }).join(' / ');
}

/** 시장별 칩 — 둘 다 같은 상태면 하나로, 정상이면 칩 없음. */
function marketChip<T>(bm: ByMarket<Metric<T>>, nowMs: number, partial?: string): ReactNode {
  const worst = [bm.domestic, bm.overseas].find(m => m.state === 'error' || m.state === 'stale' || m.state === 'unknown' || m.state === 'partial' || m.state === 'prep');
  return worst ? stateChip(worst, { nowMs, partial }) : null;
}

export function exitRows(x: ExitDetail, nowMs: number): XRow[] {
  const rows: XRow[] = [];
  // X1 가동
  const eng = x.engine;
  const engText = hasValue(eng)
    ? `${eng.value.enabled ? 'ON' : 'OFF'}${eng.value.enabled ? ` · 손실한도 손절 ${eng.value.hardStopEnabled ? 'ON' : 'OFF'}` : ' — 자동 손절·익절 없음'}`
    : '—';
  rows.push({
    k: 'X1 가동',
    d: `${engText} · ${perMarket(x.lastEval, (v, mk) => `${MK[mk]} 평가 ${v.runsToday}회`)}`,
    chip: hasValue(eng) ? marketChip(x.lastEval, nowMs) : stateChip(eng, { nowMs }),
  });
  // X2 평가 대상
  rows.push({
    k: 'X2 평가 대상',
    d: `${perMarket(x.coverage, (v, mk) => {
      const parts = [`${MK[mk]} ${v.evaluated} 평가`];
      if (v.dataErrors > 0) parts.push(`데이터 이상 ${v.dataErrors}`);
      if (v.notEvaluated > 0) parts.push(`미평가 ${v.notEvaluated}`);
      return parts.join(' · ');
    })} → 종목별은 거래 › 보유·주문`,
    chip: marketChip(x.coverage, nowMs),
  });
  // X3 트리거별 판정 (종목 수 — 평가 횟수는 병기만)
  rows.push({
    k: 'X3 트리거별 판정',
    d: perMarket(x.judgments, (v, mk) => {
      const parts: string[] = [];
      if (v.hardStopOffHit > 0) parts.push(`손실한도 손절 OFF — 한도 도달 ${v.hardStopOffHit}종목(평가 ${v.hardStopOffTicks}회)`);
      if (v.fired > 0) parts.push(`발화 ${v.fired}종목`);
      // 청산 시그널 생성 실패 — 손절 유실 위험이라 0 이 아니면 따로 보인다
      if ((v.createFailed ?? 0) > 0) parts.push(`청산 시그널 생성 실패 ${v.createFailed}종목`);
      // 정책 스킵 — 엔진이 꺼져 있던 틱의 조건 충족·쿨다운 (0 이 아닐 때만)
      if ((v.engineOffHit ?? 0) > 0) parts.push(`엔진 꺼진 동안 조건 충족 ${v.engineOffHit}종목`);
      if ((v.cooldown ?? 0) > 0) parts.push(`쿨다운 ${v.cooldown}종목`);
      parts.push(`해당 없음 ${v.noFire}`);
      if (v.trailingActive > 0) parts.push(`트레일링 스탑 활성 ${v.trailingActive}`);
      parts.push(`데이터 이상 ${v.dataErrors}`);
      return `${MK[mk]} ${parts.join(' · ')}`;
    }),
    chip: marketChip(x.judgments, nowMs, '30일 보존 한정'),
  });
  // X4 가상 청산 제안
  const pr = x.proposals;
  rows.push({
    k: 'X4 가상 청산 제안',
    d: hasValue(pr)
      ? [
          ...((pr.value.total ?? 0) > 0 ? [`청산 시그널 ${pr.value.total}`] : []),
          `가상 청산 ${pr.value.virtual}${pr.value.virtual > 0 && pr.value.firstKind ? ` (${exitKindLabel(pr.value.firstKind)})` : ''}`,
          `승인 대기 ${pr.value.awaitingApproval}`,
          `만료 ${pr.value.expired}`,
          ...((pr.value.rejected ?? 0) > 0 ? [`거절 ${pr.value.rejected}`] : []),
          ...((pr.value.other ?? 0) > 0 ? [`그 밖 ${pr.value.other}`] : []),
          ...(pr.value.submittedLive > 0 ? [`실 송신 ${pr.value.submittedLive} → 체결 ${pr.value.filled}`] : []),
          ...(pr.value.blockedByKill > 0 ? [`주문 차단 ${pr.value.blockedByKill} · 모든거래차단 ON`] : []),
        ].join(' · ')
      : ENGINE_OFF(pr) ? '— (엔진 꺼짐)' : '—',
    chip: ENGINE_OFF(pr) ? null : hasValue(pr) ? (pr.state === 'available' || pr.state === 'zero' ? null : stateChip(pr, { nowMs, partial: partialText(pr.reason) })) : stateChip(pr, { nowMs }),
  });
  // X5 임계 대비 현재 (종목 수만 — 종목별은 거래 › 보유·주문)
  const z = x.zones;
  rows.push({
    k: 'X5 임계 대비 현재',
    d: hasValue(z)
      ? `손실한도 ${z.value.hardStop} · 장마감 전 손절 ${z.value.eodCut} · 목표 익절 ${z.value.takeProfit} · 트레일링 스탑 ${z.value.trailingActive} · 중립 ${z.value.neutral} · 미평가 ${z.value.notEvaluated} → 거래 › 보유·주문 (종목별 손익률·임계 거리)`
      : '→ 거래 › 보유·주문 (종목별 손익률·임계 거리)',
    chip: z.state === 'available' || z.state === 'zero' ? null : stateChip(z, { nowMs }),
  });
  // X6 기록 공백 (근사) — 서버는 state='prep'(approx_until_t112)로 주되 근사값은 채운다 → 값이 있으면 그린다
  const g = x.gap;
  rows.push({
    k: 'X6 기록 공백',
    d: g.value != null && g.state !== 'error' ? `기대 슬롯 약 ${g.value.expectedSlots} · 실행 ${g.value.runs} · 공백 약 ${g.value.gap} (근사)` : '—',
    chip: <StatusChip kind="prep">준비 중 — 완전판 T-112</StatusChip>,
  });
  return rows;
}

export function VerifyPanel(p: { stage: OpsStage | null; onGoDetail: (d: AnalyticsDetail) => void; nowMs?: number }) {
  const nowMs = p.nowMs ?? Date.now();
  const poll = useOpsPoll<AnalysisVerifyDTO>(analysisUrl('verify'), { intervalMs: ANALYSIS_POLL_MS });
  const d = poll.data;
  const fail = !d && poll.status === 'error' ? <FailBody code={poll.error ?? 'api_error'} onRetry={poll.refresh} /> : null;

  // 사후 성과
  let postSmall: ReactNode;
  let postBody: ReactNode;
  let postFoot: ReactNode;
  if (!d) postBody = fail ?? <LoadingBody />;
  else if (d.postmortem.state === 'error') postBody = <FailBody code={d.postmortem.error} onRetry={poll.refresh} />;
  else {
    const pm = d.postmortem.data;
    const n = hasValue(pm.population) ? pm.population.value : null;
    if (n != null && n < FEW_SAMPLE_LIMIT) { postSmall = CHIP.fewer(n); postFoot = '30건 미만 — 성과 판단 근거로 쓰지 마세요(T-095 경고 규칙)'; }
    else if (pm.population.state === 'partial' && pm.population.reason === 'truncated') { postSmall = '일부만 (조회 상한 초과)'; }
    if (n === 0) {
      postBody = <EmptyNote>추적한 시그널 없음 <StatusChip kind="zero">{CHIP.zero}</StatusChip></EmptyNote>;
    } else if (n == null) {
      postBody = <EmptyNote>— {stateChip(pm.population, { nowMs })}</EmptyNote>;
    } else {
      postBody = (
        <StageTable
          caption={`모집단 = AI 가 매수로 판단한 시그널(「매수 안 함」으로 판단한 종목은 복원 불가)${pm.cardsOnly ? '' : ' · 판단 기록 기준'} · 진입 d1open(D7) · 비용 미국 편도 0.25%·슬리피지 포함 · 같은 날 유니버스 평균 대비`}
          head={['기간', { text: '건수' }, { text: '초과수익 중앙값' }]}
          rows={pm.rows.map(r => ({ label: `D+${r.horizon}`, cells: [String(r.n), medianCell(r.medianExcessPct, nowMs)] }))}
        />
      );
    }
  }

  // 청산 로직 X1~X6
  let exitBody: ReactNode;
  if (!d) exitBody = fail ?? <LoadingBody />;
  else if (d.exit.state === 'error') exitBody = <FailBody code={d.exit.error} onRetry={poll.refresh} />;
  else {
    exitBody = (
      <Rows>
        {exitRows(d.exit.data, nowMs).map(r => (
          <div key={r.k} className={ops.kv}>
            <span><b>{r.k}</b></span>
            {r.chip ?? <span />}
            <span className={ops.s}>{r.d}</span>
          </div>
        ))}
      </Rows>
    );
  }

  const live = p.stage === 'live' || p.stage === 'mixed';

  return (
    <div className={ops.scr}>
      <div className={ops.col}>
        <Section id="v-post" title="사후 성과" small={postSmall}>
          {postBody}
          {postFoot ? <div className={ops['sec-foot']} style={{ paddingTop: 8 }}>{postFoot}</div> : null}
          <Rows>
            <InPageRow href="?tab=missed" onGo={() => p.onGoDetail('missed')} glyph="↺" title="놓친 기회 — AI 매매 안 함·거절 시그널의 이후 가격" />
          </Rows>
        </Section>
        <Section id="v-rsn" title="후보·제외 사유 추이">
          <EmptyNote><StatusChip kind="prep">준비 중</StatusChip> 기준 판단 기록(T-112) 뒤부터 — 지금은 시그널 단계(차단·만료)만 셀 수 있습니다</EmptyNote>
          <Rows>
            <InPageRow href="?tab=diagnostics" onGo={() => p.onGoDetail('diagnostics')} glyph="⚙" title="신호 진단" />
          </Rows>
        </Section>
        <Section id="v-perf" title="실거래 성과">
          <EmptyNote>
            {live
              ? <>자동매매 손익 상세 — 기준(실거래 전환일 첫 스냅샷)·자동 귀속(원가·대사) 연결 뒤 <StatusChip kind="unknown">◌ 기준 미설정</StatusChip></>
              : '실거래 전환 뒤 — 지금은 체결 0이라 표시할 것이 없습니다'}
          </EmptyNote>
          <Rows>
            <InPageRow href="?tab=portfolio" onGo={() => p.onGoDetail('portfolio')} glyph="◫" title="포트폴리오 · 자산 추이 (계좌 전체)" />
          </Rows>
        </Section>
      </div>
      <div className={ops.col}>
        <Section id="v-exit" title="청산 로직 (X1~X6)" small="감사 관찰"
          foot="청산 판단은 eval_funnel 30일 보존뿐 — 영구 기록은 별도 task(T-126, 후보). 자동 청산 엔진이 꺼져 있던 기간의 「발화했을 조건」 이력도 30일 뒤 사라짐">
          {exitBody}
        </Section>
      </div>
    </div>
  );
}

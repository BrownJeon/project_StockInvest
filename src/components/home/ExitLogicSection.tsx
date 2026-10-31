import type { ReactNode } from 'react';
import type { ExitJudgmentCounts, ExitLines, Market, Metric, Section as Sec } from '@/lib/ops/metrics/types';
import { CHIP, DASH, fmtKstHm, fmtKstTime, fmtSessionDate, kstParts } from '@/components/ops/format';
import { LineList, LineSub, SkelBar } from '@/components/ops/ui/LineList';
import { Section } from '@/components/ops/ui/Section';
import { SectionLink } from '@/components/ops/ui/SectionLink';
import { StatusChip } from '@/components/ops/ui/StatusChip';
import { errorChipText } from '@/components/ops/reason-copy';
import { exitKindLabel } from './check-copy';
import { MetricReason, baseTime, hasValue, isStale, joinDot, sectionData, sectionErrorCode, type HomeCtx } from './home-ctx';

/**
 * 홈 ④ 청산 로직 3줄 — 데모 `exitSec()` · 가이드 §2.3.5 (X1 가동 · X3 판정 요약 · X4 청산). **0 이어도 항상 그린다**(결정 ⑥).
 * - 장외·휴장(그 시장 오늘 세션 run 0행)은 「장외」 — 「이상 없음」과 다르게. 국내 판정의 0 은 오늘 국내 세션 run 이 있었을 때만.
 * - 엔진 OFF: 가동 줄 「청산 엔진 OFF — 자동 손절·익절 없음」, 판정·청산은 `—`(엔진 꺼짐 — 0 아님).
 * - 조회 실패: 「청산 엔진이 꺼진 것이 아닙니다 — 상태를 모릅니다」.
 * - 판정 줄은 종목 수만(틱 수 `hardStopOffTicks` 는 쓰지 않는다 — D12).
 */
export function ExitLogicSection({ ctx, exit }: { ctx: HomeCtx; exit: Sec<ExitLines> | null }) {
  const head = { id: 'h-exit', title: '청산 로직', small: '감사 관찰 대상', link: <SectionLink href="/analytics?tab=verify" ariaLabel="청산 로직 상세 보기">상세</SectionLink> };
  if (ctx.poll === 'loading') {
    return <Section {...head} busy><LineList busy lines={[{ k: '가동', d: <SkelBar w={80} /> }, { k: '판정', d: <SkelBar w={50} /> }, { k: '청산', d: <SkelBar w={50} /> }]} /></Section>;
  }
  const err = sectionErrorCode(ctx, exit);
  const data = sectionData(exit);
  if (err || !data) {
    return (
      <Section {...head}>
        <LineList lines={[
          { k: '가동', d: <>— <StatusChip kind="error">! 조회 실패</StatusChip><LineSub>청산 엔진이 꺼진 것이 아닙니다 — 상태를 모릅니다</LineSub></> },
          { k: '판정', d: DASH },
          { k: '청산', d: DASH },
        ]} />
      </Section>
    );
  }
  const foot = isStale(ctx) ? `기준 ${baseTime(ctx)} · 오래됨` : undefined;
  return <Section {...head} foot={foot}><LineList lines={exitLines(data, ctx)} /></Section>;
}

const MK: Record<Market, string> = { domestic: '국내', overseas: '해외' };
/** 엔진이 꺼져 판정·청산이 없는 칸 — 0 이 아니다(가이드 §2.3.5) */
const ENGINE_OFF_DASH = '— (엔진 꺼짐)';

/** `HH:MM` 문자열이거나 ISO 시각 → `HH:MM`. */
function hmOf(v: string | null | undefined): string {
  if (!v) return DASH;
  if (/^\d{2}:\d{2}$/.test(v)) return v;
  return kstParts(v) ? fmtKstHm(v) : DASH;
}

/** 가동 줄 아래 보조: 「국내 마지막 평가 15:21(장 마감) · 해외 [장외] 개장 22:30 KST (11-02부터 23:30)」 */
function evalSub(data: ExitLines, ctx: HomeCtx): ReactNode {
  const part = (m: Market): ReactNode => {
    const le = data.lastEval[m];
    if (le.state === 'off_hours') {
      if (m === 'overseas') {
        const open = data.nextOverseasOpenKst ? ` 개장 ${fmtKstTime(data.nextOverseasOpenKst, ctx.nowMs)} KST` : '';
        const ch = data.nextOverseasOpenChange;
        const change = ch ? ` (${fmtSessionDate(ch.sessionDate)}부터 ${hmOf(ch.openKst)})` : '';
        return <>{MK[m]} <StatusChip kind="off">장외</StatusChip>{open}{change}</>;
      }
      return <>{MK[m]} <StatusChip kind="off">장외</StatusChip></>;
    }
    if (le.state === 'stale' && le.value?.at) return <>{MK[m]} 마지막 평가 <StatusChip kind="stale">{CHIP.stale(fmtKstTime(le.value.at, ctx.nowMs))}</StatusChip></>;
    if (hasValue(le) && le.value.at) return `${MK[m]} 마지막 평가 ${fmtKstTime(le.value.at, ctx.nowMs)}${le.value.sessionOpen === false ? '(장 마감)' : ''}`;
    // T-130 4-2: 마지막 평가가 잔고 조회 실패로 끝났다 — 영문 코드(balances_unknown) 대신 한국어 칩 + 풀어쓴 설명. 칩 안은 한 글자열(텍스트 조각 분리 방지)
    if (le.state === 'error' && le.reason === 'balances_unknown') {
      const at = le.value?.at;
      return <>{MK[m]} <StatusChip kind="error">{`${errorChipText(le.reason).text}${at ? ` · ${fmtKstTime(at, ctx.nowMs)}` : ''}`}</StatusChip> 보유 종목을 몰라 이번 평가를 못 했습니다</>;
    }
    return <>{MK[m]} <MetricReason m={le} /></>;
  };
  return joinDot([part('domestic'), part('overseas')]);
}

function sumJudgments(data: ExitLines) {
  const ms: Market[] = ['domestic', 'overseas'];
  const avail = ms.filter((m) => hasValue(data.judgments[m]));
  const off = ms.filter((m) => data.judgments[m].state === 'off_hours');
  // 값을 모르는 시장(개장 중 실행 기록 없음 unknown·오래됨 stale·휴장표 모름 등) — 「장외」 와 구분한다
  const notJudged = ms.filter((m) => !avail.includes(m) && !off.includes(m));
  // 홈에 쓰는 필드만 더한다(틱 수 hardStopOffTicks 는 쓰지 않는다 — D12)
  const z = { noFire: 0, hardStopOffHit: 0, hardStopOffDays: 0, dataErrors: 0, fired: 0, trailingActive: 0, hardStopOffDaysCapped: false, createFailed: 0, engineOffHit: 0, cooldown: 0 };
  for (const m of avail) {
    const v = (data.judgments[m] as Metric<ExitJudgmentCounts>).value!;
    z.noFire += v.noFire; z.hardStopOffHit += v.hardStopOffHit; z.dataErrors += v.dataErrors; z.fired += v.fired; z.trailingActive += v.trailingActive;
    z.createFailed += v.createFailed ?? 0;
    z.engineOffHit += v.engineOffHit ?? 0;
    z.cooldown += v.cooldown ?? 0;
    z.hardStopOffDays = Math.max(z.hardStopOffDays, v.hardStopOffDays);
    z.hardStopOffDaysCapped = z.hardStopOffDaysCapped || v.hardStopOffDaysCapped;
  }
  const partial = ms.some((m) => data.judgments[m].state === 'partial');
  return { avail, off, notJudged, z, partial };
}

/** 시장별 「판정 모름」 표시 — 장외는 「장외」, 엔진 꺼짐은 「엔진 꺼짐」, 그 밖은 상태 칩(◌ 미수집·오래됨·! 조회 실패). */
function marketJudgeReason(data: ExitLines, m: Market): ReactNode {
  const j = data.judgments[m];
  if (j.state === 'off_hours') return <>{MK[m]} <StatusChip kind="off">장외</StatusChip></>;
  if (j.reason === 'engine_off') return `${MK[m]} 엔진 꺼짐`;
  return <>{MK[m]} <MetricReason m={j} /></>;
}

function exitLines(data: ExitLines, ctx: HomeCtx): { k: string; d: ReactNode }[] {
  const stage = ctx.stage;
  const eng = data.engine;
  // ── 가동(X1)
  if (!hasValue(eng)) {
    return [
      { k: '가동', d: <>— <MetricReason m={eng} /><LineSub>청산 엔진이 꺼진 것이 아닙니다 — 상태를 모릅니다</LineSub></> },
      { k: '판정', d: DASH }, { k: '청산', d: DASH },
    ];
  }
  if (!eng.value.enabled) {
    return [
      { k: '가동', d: <><StatusChip kind="error">청산 엔진 OFF — 자동 손절·익절 없음</StatusChip><LineSub>{evalSub(data, ctx)}</LineSub></> },
      { k: '판정', d: ENGINE_OFF_DASH }, { k: '청산', d: ENGINE_OFF_DASH },
    ];
  }
  const hard = eng.value.hardStopEnabled ? '손실한도 손절 ON' : <b>손실한도 손절 OFF</b>;
  const run = (
    <>
      청산 엔진 ON · {hard}
      {stage === 'mixed' ? <> · <StatusChip kind="blocked">실주문</StatusChip></> : null}
      <LineSub>{evalSub(data, ctx)}</LineSub>
    </>
  );

  // ── 판정(X3) — 종목 수
  const J = sumJudgments(data);
  let judge: ReactNode;
  if (J.avail.length === 0) {
    // 판정한 시장이 없다 — 두 시장 모두 장외면 「장외」, 그 밖은 시장별 사유(개장 중인데 「장외」 라고 말하지 않는다)
    judge = J.off.length === 2
      ? <StatusChip kind="off">장외</StatusChip>
      : J.notJudged.every((m) => data.judgments[m].reason === 'engine_off') && J.off.length === 0
        ? ENGINE_OFF_DASH
        : <>— <LineSub>{joinDot((['domestic', 'overseas'] as Market[]).map((m) => marketJudgeReason(data, m)))}</LineSub></>;
  } else {
    const z = J.z;
    // 판정하지 못한 다른 시장: 장외 → 「해외 미평가(장외)」, 그 밖 → 「해외 ◌ 미수집」 처럼 상태 그대로
    const otherNotes: ReactNode[] = [...J.off.map((m) => `${MK[m]} 미평가(장외)`), ...J.notJudged.map((m) => marketJudgeReason(data, m))];
    const retention = J.partial ? '30일 보존(영구 기록은 T-126)' : null;
    // 청산 시그널 생성 실패(exit_create_failed)는 손절 유실 위험 — 회색 보조 줄에 섞지 않고 판정 줄 **맨 앞** 빨간 칩으로(designer 필수 1).
    // 있으면 「확인된 0」 도 쓰지 않는다. 0 이면 표시 안 함.
    const failChip = z.createFailed > 0
      ? <><StatusChip kind="error">{`! 청산 시그널 생성 실패 ${z.createFailed}종목`}</StatusChip>{' '}</>
      : null;
    // 정책 스킵(엔진이 꺼져 있던 틱의 조건 충족·쿨다운) — 「확인된 0」 조건에 포함(WP-A), 있으면 보조 줄에
    const policyNote = [z.engineOffHit > 0 && `엔진 꺼짐 중 조건 충족 ${z.engineOffHit}종목`, z.cooldown > 0 && `쿨다운 ${z.cooldown}종목`];
    if (z.hardStopOffHit > 0) {
      judge = (
        <>
          {failChip}손실한도 손절 OFF — 한도 도달 <b>{z.hardStopOffHit}종목</b> · {z.hardStopOffDaysCapped ? '30일 이상' : `${z.hardStopOffDays}일째`}
          <LineSub>{joinDot([`해당 없음 ${z.noFire}종목`, `데이터 이상 ${z.dataErrors}`, ...policyNote, ...otherNotes, retention])}</LineSub>
        </>
      );
    } else if (z.fired > 0 || (stage === 'live' && z.trailingActive > 0) || z.dataErrors > 0 || z.createFailed > 0 || z.engineOffHit > 0 || z.cooldown > 0) {
      const main = joinDot([z.fired > 0 && `청산 시그널 생성 ${z.fired}종목`, `해당 없음 ${z.noFire}종목`, stage === 'live' && z.trailingActive > 0 && `트레일링 스탑 활성 ${z.trailingActive}`]);
      judge = <>{failChip}{main}<LineSub>{joinDot([`데이터 이상 ${z.dataErrors}`, ...policyNote, ...otherNotes, retention])}</LineSub></>;
    } else {
      const sub = joinDot([...otherNotes, retention]);
      judge = (
        <>
          {stage === 'observe' || stage === 'halt' || stage === 'unknown' ? '청산 조건 해당 없음' : '해당 없음'} {z.noFire}종목{' '}
          <StatusChip kind="zero">{CHIP.zero}</StatusChip>
          {sub ? <LineSub>{sub}</LineSub> : null}
        </>
      );
    }
  }

  // ── 청산(X4)
  const pr = data.proposals;
  let close: ReactNode;
  if (!hasValue(pr)) close = pr.reason === 'engine_off' ? ENGINE_OFF_DASH : <>— <MetricReason m={pr} /></>;
  else {
    const v = pr.value;
    const live = stage === 'mixed' || stage === 'live';
    // 승인 없이 만료·거절·그 밖 상태도 「제안이 있었다」 — 「확인된 0」 은 서버가 total=0 으로 zero 를 줄 때만(R-DATA Major-1)
    const rest = [v.expired > 0 && `만료 ${v.expired}`, v.rejected > 0 && `거절 ${v.rejected}`, v.other > 0 && `그 밖 ${v.other}`];
    if (pr.state === 'zero' && v.total === 0) {
      close = <>{live ? '청산 주문 0' : '청산 제안 0'} <StatusChip kind="zero">{CHIP.zero}</StatusChip></>;
    } else if (stage === 'mixed') {
      close = <>청산 주문 {v.submittedLive}건 송신 → 체결 {v.filled}<LineSub>{joinDot([`승인 대기 청산 ${v.awaitingApproval}`, ...rest])}</LineSub></>;
    } else if (stage === 'live') {
      const sub = joinDot([v.awaitingApproval > 0 && '목표 익절 조건 — 거래 › 운용 현황에서 승인', ...rest]);
      close = <>청산 주문 {v.submittedLive} · 승인 대기 청산 {v.awaitingApproval}{sub ? <LineSub>{sub}</LineSub> : null}</>;
    } else {
      // 관찰·중지: 모든거래차단으로 막힌 주문이 실제로 있을 때만(blocked_by=kill_switch) 「주문 차단」 이라고 말한다
      const when = v.firstAt ? ` — ${exitKindLabel(v.firstKind)} ${fmtKstTime(v.firstAt, ctx.nowMs)}` : '';
      const head = v.blockedByKill > 0
        ? <>청산 시그널 {v.blockedByKill}건 — <b>주문 차단</b> · 모든거래차단 ON</>
        : v.virtual > 0
          ? <><b>가상 청산 {v.virtual}건</b>{when}</>
          : <>청산 제안 {v.total}건</>;
      const also = [v.blockedByKill > 0 && v.virtual > 0 && `가상 청산 ${v.virtual}`];
      close = <>{head}<LineSub>{joinDot([`승인 대기 청산 ${v.awaitingApproval}`, `실 송신 ${v.submittedLive}`, ...also, ...rest])}</LineSub></>;
    }
  }

  return [{ k: '가동', d: run }, { k: '판정', d: judge }, { k: '청산', d: close }];
}

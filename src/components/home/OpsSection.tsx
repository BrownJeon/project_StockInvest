import Link from 'next/link';
import type { ReactNode } from 'react';
import type { AnalysisRunRow, ByMarket, LiveSet, Market, Metric, ObserveSet, Section as Sec } from '@/lib/ops/metrics/types';
import { metricSetFor } from '@/lib/ops/metrics/stage';
import { CHIP, DASH, FEW_SAMPLE_LIMIT, fmtCount, fmtKrw, fmtKstHm, fmtKstTime, fmtSession, fmtSessionDate, fmtUsdWithKrw } from '@/components/ops/format';
import { MarketLine, MetricTile, SkeletonTile, TileGrid, ValueUnit } from '@/components/ops/ui/MetricTile';
import { RetryButton } from '@/components/ops/ui/RetryButton';
import { Section } from '@/components/ops/ui/Section';
import { SectionLink } from '@/components/ops/ui/SectionLink';
import { StatusChip } from '@/components/ops/ui/StatusChip';
import { analysisReasonText, skipReasonCode, skipText } from '@/components/ops/reason-copy';
import { ANOMALY_STATE_WORD, anomalyText } from './check-copy';
import { ErrorChip, MetricReason, StaleChip, hasValue, isStale, sectionData, sectionErrorCode, type HomeCtx } from './home-ctx';

/**
 * 홈 ③ 운용현황 — 데모 `opsSec()` · 가이드 §2.3.3(관찰 세트 A1~A4)·§2.3.4(실거래 세트 B1~B7).
 * 단계 observe·halt·unknown → 관찰 세트, mixed·live → 실거래 세트(`metricSetFor`).
 * **관찰 세트에는 손익 숫자가 없다**(D5). 실거래 세트의 자동매매 손익(B4)·운용액(B6)은 v1 고정 상태(「기준 미설정」·「미설정」),
 * 계좌 전체 손익(B5)은 숫자 대신 자산 기록 링크(L-5 — 그 조회가 쓰기를 할 수 있어 60초 재조회에 붙이지 않는다).
 */
export function OpsSection({ ctx, observe, live }: { ctx: HomeCtx; observe: Sec<ObserveSet> | null; live: Sec<LiveSet> | null }) {
  return metricSetFor(ctx.stage) === 'live' ? <LiveOps ctx={ctx} live={live} /> : <ObserveOps ctx={ctx} observe={observe} />;
}

const MK: Record<Market, string> = { domestic: '국내', overseas: '해외' };
const MARKETS: readonly Market[] = ['domestic', 'overseas'];

type TileProps = Parameters<typeof MetricTile>[0];

function errorTiles(labels: { label: string; wide?: boolean }[], code: string) {
  return labels.map((l, i) => <MetricTile key={i} label={l.label} wide={l.wide} value={DASH} chip={<ErrorChip code={code} />} />);
}

/** 오래됨이면 칸마다 회색 + 「오래됨 · 기준 {시각}」 칩을 붙인다(데모 tile()). */
function withStale(ctx: HomeCtx, p: TileProps): TileProps {
  if (!isStale(ctx)) return p;
  return { ...p, dim: true, chip: <>{p.chip}<StaleChip ctx={ctx} /></> };
}

// ── 관찰 세트 A ────────────────────────────────────────────────────────────

const A_LABELS = [{ label: '분석 완료 종목' }, { label: '분석 후보 종목' }, { label: '사후 결과 추적' }, { label: '데이터 이상·분석 실패' }];

function ObserveOps({ ctx, observe }: { ctx: HomeCtx; observe: Sec<ObserveSet> | null }) {
  const head = { id: 'h-ops', title: '운용현황', small: '관찰 기간', link: <SectionLink href="/analytics?tab=today" ariaLabel="분석 탭 오늘 분석 보기">분석</SectionLink> };
  const d5 = '손익은 표시하지 않습니다 — 실거래 전환일 첫 스냅샷에서 기준을 잡습니다(D5). 가상 진입(paper_fills)은 분석 › 검증·성과에 따로.';
  if (ctx.poll === 'loading') {
    return <Section {...head} busy foot={d5}><TileGrid>{A_LABELS.map((_, i) => <SkeletonTile key={i} />)}</TileGrid></Section>;
  }
  const err = sectionErrorCode(ctx, observe);
  const data = sectionData(observe);
  if (err || !data) {
    return <Section {...head} foot={<RetryButton onClick={ctx.onRetry} />}><TileGrid>{errorTiles(A_LABELS, err ?? 'missing')}</TileGrid></Section>;
  }
  const tiles = [a1Tile(data.analysis), a2Tile(data.analysis), a3Tile(data.postmortem), a4Tile(data.anomalies)].map((p) => withStale(ctx, p));
  return <Section {...head} foot={d5}><TileGrid>{tiles.map((p, i) => <MetricTile key={i} {...p} />)}</TileGrid></Section>;
}

type LineKind = 'value' | 'unknown' | 'skipped' | 'failed';

/** A1 시장 1줄: 값 · 건너뜀(사유) · 분석 실패 · 미수집. 건너뜀을 「휴장」 으로 단정하지 않는다 — 사유 코드를 말로(reason-copy). */
function a1Line(row: AnalysisRunRow, m: Market): { kind: LineKind; node: ReactNode } {
  const ev = row.evaluated;
  if (row.runStatus === 'skipped' || ev.state === 'off_hours') return { kind: 'skipped', node: skipText(skipReasonCode(row)) };
  if (row.runStatus === 'failed' || ev.state === 'error') {
    const why = analysisReasonText(row.failReason);
    return { kind: 'failed', node: <StatusChip kind="error">! 분석 실패{why ? ` · ${why}` : ''}</StatusChip> };
  }
  if (hasValue(ev)) {
    const t = row.runStartedAt ? fmtKstHm(row.runStartedAt) : null;
    const when = m === 'overseas'
      ? [fmtSession(row.session), t].filter(Boolean).join(' · ')
      : [fmtSessionDate(row.session.sessionDate), t].filter(Boolean).join(' ');
    return { kind: 'value', node: `${fmtCount(ev.value, '종목')} · ${when}` };
  }
  return { kind: 'unknown', node: <MetricReason m={ev} /> };
}

function a1Tile(analysis: ByMarket<AnalysisRunRow>): TileProps {
  const lines = MARKETS.map((m) => ({ m, ...a1Line(analysis[m], m) }));
  const dim = MARKETS.some((m) => analysis[m].evaluated.state === 'stale');
  if (lines.every((l) => l.kind === 'unknown')) {
    return { label: '분석 완료 종목', value: DASH, chip: <StatusChip kind="unknown">◌ 미수집 — 실행 기록 전</StatusChip>, meta: '지금은 응답·로그에만 남아 셀 수 없음(T-112)' };
  }
  return { label: '분석 완료 종목', dim, lines: lines.map((l) => <MarketLine key={l.m} m={MK[l.m]}>{l.node}</MarketLine>), meta: '장마감 AI 분석 · D0 확정봉 기준' };
}

/** A2 — 규칙 후보 → 시그널. 후보 수(counts)가 없고 시그널만 있으면 「부분 — 시그널만」(WP-A: ruleCandidates unknown + signalsCreated partial). */
function a2Tile(analysis: ByMarket<AnalysisRunRow>): TileProps {
  let created = 0, blocked = 0, pending = 0, partialMode = false, zeroBoth = true;
  const lines = MARKETS.map((m) => {
    const r = analysis[m];
    const rc = r.ruleCandidates, sc = r.signalsCreated, sb = r.signalsBlocked, sp = r.signalsPending;
    if (hasValue(sc)) created += sc.value;
    if (hasValue(sb)) blocked += sb.value;
    if (hasValue(sp)) pending += sp.value;
    if (!(rc.state === 'zero' && rc.value === 0)) zeroBoth = false;
    let node: ReactNode;
    if (rc.state === 'zero' && rc.value === 0) node = '후보 0';
    else if (hasValue(rc) && hasValue(sc)) node = `후보 ${rc.value} → 시그널 ${sc.value}`;
    else if (hasValue(sc)) {
      partialMode = true;
      node = `시그널 ${sc.value} · 검증 관문 차단 ${hasValue(sb) ? sb.value : DASH}`;
    } else node = <MetricReason m={sc.state === 'unknown' || sc.state === 'prep' ? sc : rc} />;
    return <MarketLine key={m} m={MK[m]}>{node}</MarketLine>;
  });
  const base = { label: '분석 후보 종목', lines, dim: MARKETS.some((m) => analysis[m].ruleCandidates.state === 'stale' || analysis[m].signalsCreated.state === 'stale') };
  if (partialMode) return { ...base, chip: <StatusChip kind="partial">부분 — 시그널만</StatusChip>, meta: '규칙 후보 수는 T-112 기록 뒤' };
  if (zeroBoth) return { ...base, chip: <StatusChip kind="zero">{CHIP.zero}</StatusChip>, meta: '분석이 정상 완료된 날에만 0' };
  // T-130 5번: 시그널의 차단은 막은 관문과 함께 말한다(「검증 관문 차단」) — 관문이 무엇인지도 한 줄로 풀어 준다
  if (created > 0 && blocked === created) return { ...base, chip: <StatusChip kind="blocked">⊘ 시그널 {created}건 모두 검증 관문 차단</StatusChip>, meta: '검증 관문 = 검증 통과 전 전략의 신규 매수를 막는 장치' };
  if (pending > 0) return { ...base, chip: <StatusChip kind="partial">승인 가능 {pending}</StatusChip> };
  return base;
}

function a3Tile(pm: ObserveSet['postmortem']): TileProps {
  const label = '사후 결과 추적';
  if (!hasValue(pm)) return { label, value: DASH, chip: <MetricReason m={pm} /> };
  const v = pm.value;
  if (pm.state === 'zero' || v.total === 0) return { label, value: <ValueUnit n={0} unit="건" />, chip: <StatusChip kind="zero">{CHIP.zero}</StatusChip>, meta: '추적할 시그널 없음' };
  const bars = [v.lastBarDate.domestic, v.lastBarDate.overseas].filter((x): x is string => !!x).sort();
  const chips: ReactNode[] = [];
  if (v.total < FEW_SAMPLE_LIMIT) chips.push(<StatusChip key="few" kind="partial">건수 적음 (30건 미만)</StatusChip>);
  if (pm.state === 'stale') chips.push(<StatusChip key="stale" kind="stale">오래됨 · 일봉 {bars.length ? fmtSessionDate(bars[0]) : DASH}</StatusChip>);
  const meta = (v.total < FEW_SAMPLE_LIMIT ? '30건 이상 쌓여야 성과를 판단할 수 있어 지금은 참고용 · ' : '')
    + '진입 d1open · D+1·3·5·10' + (v.cardsOnly ? ' · AI 매수 판단 시그널 한정' : '');
  return { label, value: <ValueUnit n={v.total} unit="건" />, lines: [`추적 완료 ${v.done} · 추적 중 ${v.tracking}`], chip: chips.length ? <>{chips}</> : undefined, meta, dim: pm.state === 'stale' };
}


function a4Tile(an: ObserveSet['anomalies']): TileProps {
  const label = '데이터 이상·분석 실패';
  if (!hasValue(an)) return { label, value: DASH, chip: <MetricReason m={an} /> };
  const v = an.value;
  const k = v.sourcesChecked;
  if (v.total === 0) {
    return v.analysisFailureKnown
      ? { label, value: <ValueUnit n={0} unit="건" />, chip: <StatusChip kind="zero">{CHIP.noIssue}</StatusChip>, meta: `원천 ${k}개 정상` }
      : { label, value: <ValueUnit n={0} unit="건" />, chip: <StatusChip kind="partial">부분 — 원천 {k}개만 확인</StatusChip>, meta: '분석 실패는 실행 기록 뒤' };
  }
  const first = v.items[0];
  // 이상 항목의 출처를 가른다 — 원천(신선도) 이상 vs 실행 기록 잡(source='job_run') 실패. 합이 위 숫자(v.total)와 같다(D3-B: 6건이 어디서 왔는지)
  const srcN = v.items.filter((i) => i.source !== 'job_run').length;
  const jobN = v.items.length - srcN;
  // 대표 상태 = 첫 이상의 상태 말(원천일 때만 — 잡 실패는 위 「실행 실패」가 말한다). 일부 저하는 「입력 품질 저하」(영문 degraded 를 쓰지 않는다)
  const word = first && first.source !== 'job_run' ? (first.state === 'partial' ? '입력 품질 저하' : ANOMALY_STATE_WORD[first.state]) : undefined;
  const meta = [srcN > 0 ? `원천 ${k}개 중 이상 ${srcN}` : `원천 ${k}개 정상`, jobN > 0 ? `실행 실패 ${jobN}` : null, word ?? null].filter(Boolean).join(' · ');
  return {
    label, value: <ValueUnit n={v.total} unit="건" />, lines: first ? [anomalyText(first).title] : undefined,
    chip: v.analysisFailureKnown ? undefined : <StatusChip kind="partial">부분 — 원천 {k}개만 확인</StatusChip>,
    meta: v.analysisFailureKnown ? meta : '분석 실패는 실행 기록 뒤',
    dim: an.state === 'stale',
  };
}

// ── 실거래 세트 B ──────────────────────────────────────────────────────────

const B_LABELS = [{ label: '진입 감시' }, { label: '운용 포지션' }, { label: '오늘 실체결' }, { label: '운용액 (배정)' }, { label: '자동매매 손익', wide: true }, { label: '신규 매수 가능' }];

function LiveOps({ ctx, live }: { ctx: HomeCtx; live: Sec<LiveSet> | null }) {
  const mixed = ctx.stage === 'mixed';
  const head = { id: 'h-ops', title: '운용현황', small: mixed ? '실거래 준비' : '실거래', link: <SectionLink href="/recommend?tab=now" ariaLabel="거래 탭 운용 현황 보기">거래</SectionLink> };
  const foot = mixed
    ? '계좌 전체 손익(보조): 기준 미설정'
    : <Link href="/settings/cash-ledger">계좌 전체 손익(보조) — 자산 기록에서 보기 ›</Link>;
  if (ctx.poll === 'loading') {
    return <Section {...head} busy><TileGrid>{B_LABELS.map((l, i) => <SkeletonTile key={i} wide={l.wide} />)}</TileGrid></Section>;
  }
  const err = sectionErrorCode(ctx, live);
  const data = sectionData(live);
  if (err || !data) {
    return <Section {...head} foot={<RetryButton onClick={ctx.onRetry} />}><TileGrid>{errorTiles(B_LABELS, err ?? 'missing')}</TileGrid></Section>;
  }
  const tiles = [
    b1Tile(data.watch, mixed), b2Tile(data.positions, ctx), b3Tile(data.fillsToday),
    b6Tile(), b4Tile(data.autoPnl, mixed), b7Tile(data.buyable, mixed, ctx),
  ].map((p) => withStale(ctx, p));
  return <Section {...head} foot={foot}><TileGrid>{tiles.map((p, i) => <MetricTile key={i} {...p} />)}</TileGrid></Section>;
}

function marketLines<T>(by: ByMarket<Metric<T>>, text: (v: T, m: Market) => ReactNode): ReactNode[] {
  return MARKETS.map((m) => <MarketLine key={m} m={MK[m]}>{hasValue(by[m]) ? text(by[m].value as T, m) : <MetricReason m={by[m]} />}</MarketLine>);
}
const bothZero = <T,>(by: ByMarket<Metric<T>>) => by.domestic.state === 'zero' && by.overseas.state === 'zero';

function b1Tile(watch: LiveSet['watch'], mixed: boolean): TileProps {
  const label = '진입 감시';
  if (mixed) return { label, value: DASH, chip: <StatusChip kind="blocked">⊘ 매수 차단 · 검증 관문</StatusChip>, meta: '검증 통과 전략 0' };
  if (bothZero(watch)) return { label, value: '0', chip: <StatusChip kind="zero">{CHIP.zero}</StatusChip> };
  const next = MARKETS.reduce((s, m) => s + (hasValue(watch[m]) ? watch[m].value!.nextSession : 0), 0);
  return {
    label,
    lines: marketLines(watch, (v) => (v.executing > 0 ? `${v.watching} · 주문 선점 ${v.executing}` : `${v.watching} 감시 중`)),
    meta: `다음 세션 예정 ${next} · 서버 COUNT`,
  };
}

function b2Tile(pos: LiveSet['positions'], ctx: HomeCtx): TileProps {
  const label = '운용 포지션';
  if (!hasValue(pos)) return { label, value: DASH, chip: <MetricReason m={pos} /> };
  const v = pos.value;
  if (v.autoCount === 0) {
    return { label, lines: [<MarketLine key="a" m="자동">운용 0</MarketLine>, <MarketLine key="c" m="계좌">보유 {fmtCount(v.accountCount, '종목')}</MarketLine>], chip: <StatusChip kind="zero">✓ 자동 운용 0</StatusChip>, meta: '수동 보유는 자동 관리 아님(D3)' };
  }
  return {
    label,
    lines: [<MarketLine key="a" m="자동">{fmtCount(v.autoCount, '종목')}{v.autoValueKrw != null ? ` · ${fmtKrw(v.autoValueKrw)}` : ''}</MarketLine>, <MarketLine key="c" m="계좌">보유 {fmtCount(v.accountCount, '종목')}</MarketLine>],
    meta: `${v.snapshotAt ? `평가 ${fmtKstTime(v.snapshotAt, ctx.nowMs)} 스냅샷 · ` : ''}수동 보유는 자동 관리 아님(D3)`,
    dim: pos.state === 'stale',
  };
}

function b3Tile(fills: LiveSet['fillsToday']): TileProps {
  const label = '오늘 실체결';
  const sessionText = (m: Market) => {
    const v = fills[m].value;
    return v ? fmtSession(v.session) : DASH;
  };
  if (bothZero(fills)) {
    return { label, lines: MARKETS.map((m) => <MarketLine key={m} m={MK[m]}>0건 · {sessionText(m)}</MarketLine>), chip: <StatusChip kind="zero">{CHIP.zero}</StatusChip> };
  }
  return {
    label,
    lines: marketLines(fills, (v, m) => {
      if (v.exitSells > 0) return `${v.fills}건 · 청산 매도${v.exitSells < v.fills ? ` ${v.exitSells}` : ''}`;
      return m === 'domestic' ? `${v.fills}건 · ${fmtSession(v.session)} 세션` : `${v.fills}건 · ${fmtSession(v.session)}`;
    }),
    meta: '체결 증거만 · 접수·가상 주문·거부 제외',
  };
}

function b6Tile(): TileProps {
  // v1 은 항상 이 상태(운용액 입력 화면은 이번 범위 밖 — D4)
  return { label: '운용액 (배정)', value: '미설정', chip: <StatusChip kind="unknown">◌ 설정에서 배정</StatusChip>, meta: '사용자가 정한 금액만 씀(D4)' };
}

function b4Tile(pnl: LiveSet['autoPnl'], mixed: boolean): TileProps {
  const label = '자동매매 손익';
  if (pnl.state === 'zero') return { label, wide: true, value: DASH, chip: <StatusChip kind="zero">✓ 자동 귀속 체결 0 · 손익 없음</StatusChip> };
  // v1: 손익 숫자를 그리지 않는다 — 기준(실거래 전환일 첫 스냅샷)·자동 귀속 손익 연결 전
  return {
    label, wide: true, value: DASH, chip: <StatusChip kind="unknown">◌ 기준 미설정</StatusChip>,
    meta: mixed
      ? '기준은 실거래 전환일 첫 스냅샷(D5) — 혼합 단계는 전환으로 볼지 결정 전'
      : '기준은 실거래 전환일 첫 스냅샷(D5) — 자동 귀속 손익(원가·대사)은 연결 뒤',
  };
}

function b7Tile(buy: LiveSet['buyable'], mixed: boolean, ctx: HomeCtx): TileProps {
  const label = '신규 매수 가능';
  if (mixed) return { label, value: DASH, chip: <StatusChip kind="blocked">⊘ 차단 · 검증 관문(통과 0)</StatusChip>, meta: '금액 대신 사유를 표시' };
  // 해외 줄의 환율 표시(환산 여부·사유)를 meta 에 쓴다 — 콜백 안에서 채우므로 객체로 들고 다닌다
  const fx: { meta: string | null; converted: boolean } = { meta: null, converted: true };
  const lines = marketLines(buy, (v) => {
    if (v.currency === 'KRW') return fmtKrw(v.native);
    const r = fmtUsdWithKrw({ usd: v.native, krw: v.krw, fxAt: v.fxAt, fxSource: v.fxSource, nowMs: ctx.nowMs });
    fx.meta = r.fxMeta;
    fx.converted = r.converted;
    return r.text;
  });
  // 데모: 환산 숨김이면 사유만(「환율 … 기본값(fallback) — 원화 환산 숨김」), 정상이면 「결제 완료 예수금 · 1회 한도 · 환율 {HH:MM}」
  const meta = fx.converted
    ? `결제 완료 예수금 · 1회 한도${fx.meta ? ` · ${fx.meta}` : ''}`
    : (fx.meta ?? '결제 완료 예수금 · 1회 한도');
  return { label, lines, meta, dim: MARKETS.some((m) => buy[m].state === 'stale') };
}

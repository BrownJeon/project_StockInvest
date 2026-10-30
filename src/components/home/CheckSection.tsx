import Link from 'next/link';
import type { ByMarket, CheckCoverage, CheckItem, Section as Sec } from '@/lib/ops/metrics/types';
import { metricSetFor } from '@/lib/ops/metrics/stage';
import { CheckRow, SkeletonRows } from '@/components/ops/ui/CheckRow';
import { EmptyNote, Rows, Section, SectionBody } from '@/components/ops/ui/Section';
import { RetryButton } from '@/components/ops/ui/RetryButton';
import { SAFETY_UNKNOWN_TITLE, checkLines } from './check-copy';
import { baseTime, isStale, sectionData, sectionErrorCode, type HomeCtx } from './home-ctx';

type Counts = { approval: ByMarket<number>; earliestExpiry: { symbol: string; at: string } | null; rejectedToday: number };

/**
 * 홈 ② 확인 필요 — 데모 `checkSec()` · 가이드 §2.3.2.
 * 조치가 필요한 것만, 줄마다 이동할 곳. 0 건이면 빈 상태 한 줄(small 에 「0건」 을 쓰지 않는다 — §8.2 Minor).
 * 조회 실패는 「비어 있는 것이 아닙니다」 를 꼭 붙인다(빈 목록과 구별).
 *
 * 빈 상태 문장은 **실제로 평가한 항목만 0 으로 말한다**(서버 `checkCoverage` — Reviewer R-DATA Major-2·R-UI M3):
 *  - 평가하지 못한 항목은 「{항목} 확인하지 못함」, 그때 머리말은 「지금 확인할 것 없음」 대신 「확인한 범위에서는 없음」.
 *  - 안전 상태를 못 읽었으면(단계 unknown·coverage.safety=false) 「지금 확인할 것 없음」 을 절대 쓰지 않고
 *    「안전 상태를 불러오지 못해 확인할 수 없습니다」 + [다시 시도].
 */
export function CheckSection({ ctx, checks, counts, coverage }: {
  ctx: HomeCtx; checks: Sec<CheckItem[]> | null; counts: Sec<Counts> | null; coverage: CheckCoverage | null;
}) {
  const err = sectionErrorCode(ctx, checks);
  const login = ctx.code === 'unauthorized'
    ? <> · <Link href="/login">다시 로그인해 주세요</Link></>
    : null;

  if (ctx.poll === 'loading') {
    return <Section id="h-check" title="확인 필요" busy><SkeletonRows /></Section>;
  }
  if (err) {
    return (
      <Section id="h-check" title="확인 필요" foot={ctx.code === 'unauthorized' ? <Link href="/login">다시 로그인해 주세요</Link> : undefined}>
        <Rows>
          <CheckRow severity="e" glyph="!" title="확인 필요 목록을 불러오지 못했습니다" sub={`${err} · 비어 있는 것이 아닙니다`} />
        </Rows>
        <SectionBody><RetryButton onClick={ctx.onRetry} /></SectionBody>
      </Section>
    );
  }

  const lines = checkLines(sectionData(checks) ?? [], ctx.nowMs);
  const safetyUnknown = ctx.stage === 'unknown' || !coverage || coverage.safety === false;
  // 안전 상태를 못 읽었는데 서버가 그 줄을 주지 않았으면 화면이 직접 첫 줄로 둔다(빈 상태로 보이지 않게)
  if (safetyUnknown && !lines.some((l) => l.key === 'safety-unknown')) {
    lines.unshift({ key: 'safety-unknown', severity: 'e', glyph: '!', title: SAFETY_UNKNOWN_TITLE, sub: '비어 있는 것이 아닙니다', href: '/settings' });
  }
  const c = sectionData(counts);
  // foot 의 0 도 평가한 항목일 때만(평가 여부 coverage 와 숫자 counts 가 둘 다 있어야 숫자를 쓴다)
  const approvals = c && coverage?.approval ? c.approval.domestic + c.approval.overseas : null;
  const rejected = c && coverage?.orders ? c.rejectedToday : null;
  const base = baseTime(ctx);
  const foot = isStale(ctx)
    ? <>기준 {base} · 오래됨 — 새로 고치지 못했습니다{login}</>
    : metricSetFor(ctx.stage) === 'live'
      ? <>기준 {base}{login}</>
      : <>승인 대기 {approvals ?? '—'} · 주문 오류 {rejected ?? '—'} · 기준 {base}{login}</>;

  return (
    <Section id="h-check" title="확인 필요" small={lines.length ? `${lines.length}건` : undefined} foot={foot}>
      {lines.length === 0 ? (
        <EmptyNote>{emptySentence(coverage!)}</EmptyNote>
      ) : (
        <>
          <Rows>
            {lines.map((ln) => <CheckRow key={ln.key} severity={ln.severity} glyph={ln.glyph} title={ln.title} sub={ln.sub ?? undefined} href={ln.href} />)}
          </Rows>
          {safetyUnknown ? <SectionBody><RetryButton onClick={ctx.onRetry} /></SectionBody> : null}
        </>
      )}
    </Section>
  );
}

/** 빈 목록 문장 — 평가한 항목만 0. 전부 평가했을 때만 데모 문구 그대로(「지금 확인할 것 없음 — 승인 대기 0 · 주문 오류 0 · 데이터 이상 0 · 청산 조건 해당 없음」). */
export function emptySentence(cov: CheckCoverage): JSX.Element {
  const parts = [
    cov.approval ? '승인 대기 0' : '승인 대기 확인하지 못함',
    cov.orders ? '주문 오류 0' : '주문 오류 확인하지 못함',
    cov.anomalies ? '데이터 이상 0' : '데이터 이상 확인하지 못함',
    cov.exitConditions ? '청산 조건 해당 없음' : '청산 조건 확인하지 못함',
  ];
  const all = cov.approval && cov.orders && cov.anomalies && cov.exitConditions;
  return <><b>{all ? '지금 확인할 것 없음' : '확인한 범위에서는 없음'}</b> — {parts.join(' · ')}</>;
}

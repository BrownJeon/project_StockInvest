import type { ActivityItem, Section as Sec } from '@/lib/ops/metrics/types';
import { CHIP, fmtKstTime } from '@/components/ops/format';
import { ActivityList } from '@/components/ops/ui/ActivityList';
import { SkelBar } from '@/components/ops/ui/LineList';
import { RetryButton } from '@/components/ops/ui/RetryButton';
import { EmptyNote, Section, SectionBody } from '@/components/ops/ui/Section';
import { SectionLink } from '@/components/ops/ui/SectionLink';
import { StatusChip } from '@/components/ops/ui/StatusChip';
import { analysisReasonText, skipText } from '@/components/ops/reason-copy';
import { ErrorChip, baseTime, isStale, sectionData, sectionErrorCode, type HomeCtx } from './home-ctx';

export const ACTIVITY_MAX = 4;

/**
 * 장마감 분석 줄의 건너뜀·실패 부제는 화면 사전(reason-copy)으로 다시 쓴다 — 같은 화면의 A1 칸·분석 표와 같은 말을 쓰게
 * (서버 activity.ts 도 사유 코드로 말하지만 사전이 따로 있어 표기가 갈릴 수 있다). 그 밖 줄은 서버 문구 그대로.
 */
export function activitySub(it: ActivityItem): string {
  if (it.kind !== 'analysis') return it.sub;
  const p = it.params ?? {};
  const status = typeof p.status === 'string' ? p.status : null;
  const code = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  if (status === 'skipped') return skipText(code(p.skipReason));
  if (status === 'failed') {
    const why = analysisReasonText(code(p.failReason));
    return why ? `실행 실패 · ${why}` : it.sub;
  }
  return it.sub;
}

/**
 * 홈 ⑥ 최근 활동 — 데모 `actSec()` · 가이드 §2.3.7. 최대 4건, 최신순.
 * 제목·부제는 서버가 만든다(장마감 분석 완료 · 가상 청산 기록 · 장중 매수 시그널 차단 …). 시각은 오늘이면 HH:MM, 아니면 MM-DD HH:MM(§8.2 P2).
 * 0건(조회 성공)은 「최근 활동 없음 ✓ 확인된 0」(데모에 그림 없음 — 상태 어휘로 채움).
 */
export function ActivitySection({ ctx, activity }: { ctx: HomeCtx; activity: Sec<ActivityItem[]> | null }) {
  const head = { id: 'h-act', title: '최근 활동', link: <SectionLink href="/recommend?tab=log" ariaLabel="거래 탭 운영 기록 보기">기록</SectionLink> };
  if (ctx.poll === 'loading') {
    return <Section {...head} link={undefined} busy><SectionBody><SkelBar w={80} /></SectionBody></Section>;
  }
  const err = sectionErrorCode(ctx, activity);
  const items = sectionData(activity);
  if (err || !items) {
    return <Section {...head} link={undefined}><SectionBody><ErrorChip code={err ?? 'missing'} /> <RetryButton onClick={ctx.onRetry} /></SectionBody></Section>;
  }
  const foot = isStale(ctx) ? `기준 ${baseTime(ctx)} · 오래됨` : undefined;
  const sorted = [...items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, ACTIVITY_MAX);
  return (
    <Section {...head} foot={foot}>
      {sorted.length === 0 ? (
        <EmptyNote>최근 활동 없음 <StatusChip kind="zero">{CHIP.zero}</StatusChip></EmptyNote>
      ) : (
        <ActivityList items={sorted.map((it) => ({ time: fmtKstTime(it.at, ctx.nowMs), title: it.title, sub: activitySub(it) }))} />
      )}
    </Section>
  );
}

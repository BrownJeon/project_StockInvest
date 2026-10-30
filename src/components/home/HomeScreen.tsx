'use client';

/**
 * T-108 홈 — 승인 데모 v3(mockups/T-108-menu-home-v3.html) `homeScreen()` · 가이드 §2.3.
 *
 * 섹션 순서(고정, 결정 ②A): 안전 상태 띠 → 확인 필요 → 운용현황 → 청산 로직 → 오늘의 분석·판단 → 최근 활동.
 * ≥900px 은 두 열(왼쪽 확인 필요·운용현황·청산 / 오른쪽 분석·활동) — `ops.module.css` `.scr`·`.col`.
 *
 * 데이터: `GET /api/ops/home`(60초 + 보일 때 + [다시 시도]) 하나 + `GET /api/ops/safety-state`(30초, 띠).
 * KIS 호출 없음 — 옛 홈(`dashboard/Dashboard.tsx`)의 `/api/portfolio`·`/api/ticker/*`·`/api/candles` 는 부르지 않는다.
 * 홈에는 위험 CTA 가 없다 — 줄을 누르면 해당 화면으로 이동만 한다(승인·거절·취소·스위치 변경 없음).
 * 앱(Capacitor)·웹 분기 없음. 경로 `/` 그대로(텔레그램 「앱에서 자세히」·App Links 호환 — 가이드 §1.3).
 *
 * 화면 시험(B-2)은 훅 없는 `HomeView` 에 합성 DTO 를 넣어 renderToStaticMarkup 으로 본다.
 */
import type { HomeDTO, OpsStage } from '@/lib/ops/metrics/types';
import { useOpsPoll, type PollState } from '@/components/ops/useOpsPoll';
import { useSafetyState } from '@/components/ops/useSafetyState';
import type { SafetyStateView } from '@/components/ops/safety-view';
import { SafetyStrip } from '@/components/ops/ui/SafetyStrip';
import { ops } from '@/components/ops/ui/styles';
import { ActivitySection } from './ActivitySection';
import { AnalysisSection } from './AnalysisSection';
import { CheckSection } from './CheckSection';
import { ExitLogicSection } from './ExitLogicSection';
import { OpsSection } from './OpsSection';
import type { HomeCtx } from './home-ctx';

export const HOME_URL = '/api/ops/home';
export const HOME_POLL_MS = 60_000;

export function HomeScreen() {
  const safety = useSafetyState();
  const home = useOpsPoll<HomeDTO>(HOME_URL, { intervalMs: HOME_POLL_MS });
  return <HomeView safety={safety.view} onSafetyRetry={safety.refresh} home={home} onRetry={home.refresh} nowMs={Date.now()} />;
}

export type HomePoll = Pick<PollState<HomeDTO>, 'status' | 'data' | 'lastOkAt' | 'error'>;

/** 띠: 띠 조회가 아직이면 같은 홈 응답 안의 안전 상태로 첫 렌더(방금 받은 값). 띠 조회가 실패했으면 그대로 실패. */
export function stripView(safety: SafetyStateView, home: HomePoll): SafetyStateView {
  if (safety.kind === 'loading' && home.status === 'ok' && home.data && home.data.safety.stage !== 'unknown') {
    return { kind: 'ok', dto: home.data.safety };
  }
  return safety;
}

/** 지표 세트·문구용 단계 — 홈 응답 단계, 없으면 띠 단계, 그것도 없으면 observe(관찰 세트 모양으로 로딩). */
export function homeStage(safety: SafetyStateView, home: HomePoll): OpsStage {
  if (home.data) return home.data.stage;
  if (safety.kind === 'ok') return safety.dto.stage;
  return 'observe';
}

export function HomeView({ safety, home, onRetry, onSafetyRetry, nowMs }: {
  safety: SafetyStateView; home: HomePoll; onRetry?: () => void; onSafetyRetry?: () => void; nowMs: number;
}) {
  const d = home.data;
  const ctx: HomeCtx = {
    poll: home.status,
    code: home.error,
    nowMs,
    stage: homeStage(safety, home),
    generatedAt: d?.generatedAt ?? null,
    onRetry,
  };
  // 섹션 순서를 바꾸지 않는다(결정 ②A) — 두 열은 CSS 가 나눈다(모바일은 한 열로 위→아래 같은 순서)
  return (
    <>
      <SafetyStrip state={stripView(safety, home)} onRetry={onSafetyRetry} nowMs={nowMs} />
      <div className={ops.scr}>
        <div className={ops.col}>
          <CheckSection ctx={ctx} checks={d?.checks ?? null} counts={d?.counts ?? null} coverage={d?.checkCoverage ?? null} />
          <OpsSection ctx={ctx} observe={d?.observe ?? null} live={d?.live ?? null} />
          <ExitLogicSection ctx={ctx} exit={d?.exit ?? null} />
        </div>
        <div className={ops.col}>
          <AnalysisSection ctx={ctx} analysis={d?.analysis ?? null} />
          <ActivitySection ctx={ctx} activity={d?.activity ?? null} />
        </div>
      </div>
    </>
  );
}

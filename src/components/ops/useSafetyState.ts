'use client';

/**
 * 안전 상태 띠 데이터 — `GET /api/ops/safety-state` 를 30초마다(가이드 §2.2) 읽어 `SafetyStateView` 로 바꾼다.
 * 실패하면 마지막 값을 버린다(`keepLastOnError: false`) — 안전 표시는 오래된 값을 보이지 않는다.
 * `/api/settings/safety` GET 은 부르지 않는다(그 라우트는 비어 있으면 INSERT 한다 — 가이드 §0.1-6).
 * 홈·거래·분석(미니 띠)이 같이 쓴다.
 */
import { useRef } from 'react';
import type { SafetyStateDTO } from '@/lib/ops/metrics/types';
import { safetyViewFromPoll, type SafetyStateView } from './safety-view';
import { useOpsPoll } from './useOpsPoll';

export const SAFETY_STATE_URL = '/api/ops/safety-state';
export const SAFETY_POLL_MS = 30_000;

export function useSafetyState(): { view: SafetyStateView; refresh: () => void; dto: SafetyStateDTO | null } {
  const poll = useOpsPoll<SafetyStateDTO>(SAFETY_STATE_URL, { intervalMs: SAFETY_POLL_MS, keepLastOnError: false });
  const lastGood = useRef<string | null>(null);
  if (poll.status === 'ok' && poll.data && poll.data.stage !== 'unknown') lastGood.current = poll.data.readAt;
  const view = safetyViewFromPoll(poll, lastGood.current);
  return { view, refresh: poll.refresh, dto: view.kind === 'ok' ? view.dto : null };
}

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { DASH, fmtKstTime } from '../format';
import { buildStripModel, UNKNOWN_CHIPS, type SafetyStateView, type StripChip } from '../safety-view';
import { cx, ops } from './styles';
import { useHeightReport } from './useHeightReport';

/**
 * 안전 상태 띠 — 데모 `strip()` 568~602행 · 가이드 §2.2. 홈·거래 맨 위, `position: sticky; top: 0`.
 *
 * - 로딩: 스피너 + 「안전 상태 확인 중…」(`aria-busy`).
 * - 확인 실패(`error` 또는 서버 stage=unknown): 「! 확인 실패」 + 칩 4개 `—` + [다시] (`role="alert"`). 마지막 값을 쓰지 않는다.
 * - 정상: 단계 배지 + 요약 + 칩 5개(가로 스크롤 — 넘치면 오른쪽 끝 페이드, 가이드 §8.2 P2) + 혼합 단계 청산 실주문 경고.
 * - `onHeightChange`: 띠 높이(px)를 알려 준다 — 거래 화면이 세그먼트를 띠 아래에 붙일 때(`--strip-h`) 쓴다.
 */
export function SafetyStrip({ state, onRetry, onHeightChange, nowMs }: {
  state: SafetyStateView; onRetry?: () => void; onHeightChange?: (px: number) => void; nowMs?: number;
}) {
  const rootRef = useHeightReport<HTMLDivElement>(onHeightChange);

  if (state.kind === 'loading') {
    return (
      <div ref={rootRef} className={ops.strip} aria-busy="true">
        <div className={ops['strip-h']}>
          <span className={ops.spin} aria-hidden="true" />
          <span className={ops['strip-sum']}>안전 상태 확인 중…</span>
        </div>
      </div>
    );
  }

  const model = state.kind === 'ok' ? buildStripModel(state.dto) : null;
  if (!model) {
    const last = state.kind === 'error' ? state.lastGoodAt : state.dto.readAt;
    const lastText = last ? fmtKstTime(last, nowMs ?? Date.now()) : DASH;
    return (
      <div ref={rootRef} className={ops.strip} role="alert">
        <div className={ops['strip-h']}>
          <span className={cx(ops.stage, ops.err)}><span className={ops.dot} aria-hidden="true" />! 확인 실패</span>
          <span className={ops['strip-sum']}>
            <b>안전 상태를 불러오지 못했습니다</b> — 주문 송신 여부를 알 수 없습니다 · 마지막 확인 {lastText}
          </span>
          <button type="button" className={ops['strip-go']} onClick={onRetry}>다시</button>
        </div>
        <ChipRow chips={UNKNOWN_CHIPS} list={false} />
      </div>
    );
  }

  return (
    <div ref={rootRef} className={ops.strip}>
      <div className={ops['strip-h']}>
        <span className={cx(ops.stage, ops[model.cls])}><span className={ops.dot} aria-hidden="true" />{model.badge}</span>
        <span className={ops['strip-sum']}>
          {model.summary.pre}<b>{model.summary.bold}</b>{model.summary.post}
        </span>
        <Link href="/settings" className={ops['strip-go']} aria-label="안전장치 설정 보기">설정 ›</Link>
      </div>
      <ChipRow chips={model.chips} list />
      {model.exitLiveAlert ? (
        <div className={ops['strip-alert']} role="note">
          <b>청산 주문은 실제로 송신됩니다.</b> 청산 엔진은 검증 관문과 무관합니다 — 원치 않으면 설정 › 안전장치.
        </div>
      ) : null}
    </div>
  );
}

/** 칩 줄 — 넘치면(스크롤 끝이 아니면) 오른쪽 끝을 흐리게 해 「더 있음」을 보인다. */
function ChipRow({ chips, list }: { chips: StripChip[]; list: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [fade, setFade] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setFade(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', check); ro?.disconnect(); };
  }, [chips]);
  return (
    <div ref={ref} className={cx(ops.sws, fade && ops.fade)} role={list ? 'list' : undefined} aria-label={list ? '안전 스위치' : undefined}>
      {chips.map((c) => (
        <span key={c.name} role={list ? 'listitem' : undefined} className={cx(ops.sw, ...c.tone.map((t) => ops[t]))}>
          <i>{c.name}</i>{c.value}
        </span>
      ))}
    </div>
  );
}

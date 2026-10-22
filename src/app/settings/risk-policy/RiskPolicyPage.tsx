'use client';

/**
 * T-066 — 설정 > 리스크 정책 (/settings/risk-policy). 승인 데모 v3 구조 A 의 '리스크 정책 화면'.
 *
 * 손절폭·손실 손절 합 한도·손절 기준가 3개를 여기서만 바꾸고, 보유 종목의 예상 손절가·손절 합을
 * 입력 즉시(저장 전 값으로) 계산해 보인다. 표시·위험 계산 전용 — 주문·매도를 만들지 않는다.
 * (T-068 데모 v5) 손절가 도달 텔레그램 알림은 별도 cron 이 보낸다 — 이 화면은 그 규칙 안내·예시만 보인다(상태·토글 없음).
 * 저장은 이 화면의 저장 바 하나(안전장치 저장과 별개): 낙관적 반영 → 서버 확정 / 실패 되돌림 / 409 선택.
 * 상태 전이 판정은 `components/risk/policy-state.ts` 의 순수 함수가 맡는다(단위 시험 대상).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { computeRisk } from '@/lib/risk/compute';
import { EXIT_ENGINE_DEFAULT_HARD_STOP_PCT } from '@/lib/risk/defaults';
import type { RiskPolicyData } from '@/app/api/settings/risk-policy/route';
import { RiskStyles } from '@/components/risk/RiskStyles';
import { DisplayOnlyBadge, StatusText } from '@/components/risk/StatusText';
import { RiskSettingsForm } from '@/components/risk/RiskSettingsForm';
import { BelowBox, RiskResult } from '@/components/risk/RiskResult';
import { HoldingsStops } from '@/components/risk/HoldingsStops';
import { ReadOnlyPolicyTable } from '@/components/risk/ReadOnlyPolicyTable';
import { StopAlertNotice } from '@/components/risk/StopAlertNotice';
import { FreshLine } from '@/components/risk/FreshLine';
import { useRiskPolicyFeed, type RiskPolicyFeed } from '@/components/risk/useRiskPolicyFeed';
import { checkDraft, dirtyCount, type Draft } from '@/components/risk/draft';
import {
  applyFeedPolicy, beginSave, cancelEdit, changeDraft, classifySave, finishSave,
  initialEditState, keepMine, takeServer, toSaved, type EditState,
} from '@/components/risk/policy-state';
import { kstHm, kstMdHm } from '@/components/risk/fmt';

/** 저장 요청 응답 대기 상한 — 넘으면 실패로 보고 입력 잠금을 푼다 */
const SAVE_TIMEOUT_MS = 15_000;

export function RiskPolicyPage() {
  const [edit, setEdit] = useState<EditState>(initialEditState);
  const st = useRef(edit);
  st.current = edit;

  /** 조회 결과 반영 — 판정은 applyFeedPolicy (버전 후퇴 금지·편집 중이면 충돌 안내) */
  const onData = useCallback((d: RiskPolicyData, initial: boolean) => {
    setEdit(s => applyFeedPolicy(s, toSaved(d.policy), initial));
  }, []);

  const feed = useRiskPolicyFeed({ onData, paused: edit.saveState === 'saving' });

  const { saved, draft } = edit;
  const check = useMemo(() => checkDraft(draft, saved), [draft, saved]);
  const dirty = dirtyCount(draft, saved);
  const data = feed.data;
  const c = useMemo(
    () => (data ? computeRisk(data.holdings, data.snapshot?.totalKrw ?? 0, check.eff, data.snapshot?.cashKrw ?? null) : null),
    [data, check.eff],
  );

  const onChange = useCallback((patch: Partial<Draft>) => setEdit(s => changeDraft(s, patch)), []);
  const onCancel = useCallback(() => setEdit(cancelEdit), []);
  const onTakeServer = useCallback(() => setEdit(takeServer), []);
  const onKeepMine = useCallback(() => setEdit(keepMine), []);

  const onSave = useCallback(async () => {
    const started = beginSave(st.current);
    if (!started) return;
    const { req } = started;
    setEdit(started.state); // 낙관적 반영 — 서버 확인 전에 화면을 먼저 바꾼다(입력은 잠근다)

    let status = 0;
    let timedOut = false;
    let body: { ok?: boolean; data?: RiskPolicyData; error?: string } | null = null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, SAVE_TIMEOUT_MS);
    try {
      const res = await fetch('/api/settings/risk-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: ctrl.signal,
        body: JSON.stringify({ ...req.values, baseVersion: req.baseVersion }),
      });
      status = res.status;
      try { body = await res.json(); } catch { /* 비JSON */ }
    } catch {
      status = 0;
    } finally {
      clearTimeout(timer);
    }

    const out = classifySave(status, body, timedOut);
    if (out.kind !== 'failed' && out.data) feed.replace(out.data);
    setEdit(s => finishSave(s, req, out, kstHm(Date.now())));
  }, [feed]);

  return (
    <div className="rp">
      <RiskStyles />
      <div className="rp-head">
        <Link className="back" href="/settings" aria-label="설정으로 돌아가기">‹ 설정</Link>
        <h2>리스크 정책</h2>
        <DisplayOnlyBadge />
      </div>
      <div className="strip">
        <span>이 정책은 <b>아직 주문을 막지 않습니다</b>. 예상 손절가는 계산·표시·알림용이고 <b>자동으로 팔지 않습니다</b>.</span>
      </div>
      <main className="app-body">
        <RiskBody
          feed={feed} c={c} draft={draft} check={check} saved={saved} dirty={dirty}
          saveState={edit.saveState} saveError={edit.saveError} savedAtText={edit.savedAtText}
          remote={edit.remote} syncNote={edit.syncNote}
          onChange={onChange} onSave={onSave} onCancel={onCancel} onTakeServer={onTakeServer} onKeepMine={onKeepMine}
        />
      </main>
    </div>
  );
}

type BodyProps = Omit<Parameters<typeof RiskSettingsForm>[0], 'totalKrw'> & {
  feed: RiskPolicyFeed;
  c: ReturnType<typeof computeRisk> | null;
};

/** 리스크 정책 화면 본문 (데모 v3 `riskBody`) — 시험에서 상태별로 직접 렌더한다 */
export function RiskBody(p: BodyProps) {
  const { feed, c } = p;
  if (feed.load === 'loading') {
    return (
      <div className="rk-sum" aria-busy="true">
        <span className="sr" role="status">리스크 정책을 불러오는 중…</span>
        <div className="skel m" aria-hidden="true" /><div className="skel s" aria-hidden="true" />
        <div className="skel" aria-hidden="true" /><div className="skel m" aria-hidden="true" />
      </div>
    );
  }
  if (feed.load === 'error' || !feed.data || !c) {
    return (
      <div className="rk-sum" role="alert">
        <StatusText kind="warn" icon="!">리스크 정책·보유 종목을 불러오지 못했습니다</StatusText>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
          이 화면이 값을 받지 못했을 뿐, 저장된 정책이 없어진 것이 아닙니다. 오류: {feed.loadError ?? '알 수 없음'}
        </span>
        <div><button type="button" className="btn pri" onClick={feed.reload}>다시 시도</button></div>
      </div>
    );
  }
  const data = feed.data;
  const snap = data.snapshot;
  const tag = p.saveState === 'saving' ? 'saving' : (p.dirty > 0 || !p.saved || p.check.usedFallback) ? 'draft' : 'saved';
  const staleHours = snap ? Math.floor((Date.now() - new Date(snap.at).getTime()) / 3_600_000) : 0;
  const d = data.defaults;

  return (
    <div className="rk-body">
      <div className="rk-col">
        {!p.saved && (
          <div className="warnbox" role="note">
            <b>! 아직 저장된 리스크 정책이 없습니다.</b> 아래 값은 제안값(손절폭 {d.stopPct}% · 한도 {d.heatCapPct}% · {d.stopBasis === 'avg' ? '평균단가' : '고점'} 기준)으로 미리 계산한 것입니다. 저장해야 정책이 됩니다.
          </div>
        )}
        <RiskSettingsForm {...p} totalKrw={c.totalKrw} />
        <FreshLine
          snapshotAt={snap?.at ?? null} stale={!!snap?.stale}
          poll={feed.poll} lastCheckAt={feed.lastCheckAt} nextAt={feed.nextAt}
        />
        {!snap && (
          <div className="warnbox" role="note">
            <b>! 포트폴리오 스냅샷이 아직 없습니다.</b> 보유 종목·총자산을 알 수 없어 예상 손절가·손절 합을 계산하지 못합니다.
          </div>
        )}
        {snap?.stale && (
          <div className="warnbox" role="note">
            <b>! 스냅샷이 {staleHours}시간 전({kstMdHm(snap.at)}) 값입니다.</b> 현재가·총자산·금액 환산이 실제와 다를 수 있습니다.
          </div>
        )}
        <BelowBox c={c} />
        <RiskResult c={c} eff={p.check.eff} tag={tag} usedFallback={p.check.usedFallback} />
        <StopAlertNotice c={c} eff={p.check.eff} />
        <div className="infobox" role="note">
          <span className="ic" aria-hidden="true">ⓘ</span>
          <div>
            예상 손절가는 <b>표시·위험 계산·알림용</b>입니다. 자동 청산 엔진(지금 {data.exitEngine.enabled ? 'ON' : 'OFF'}, 기본 하드 손절 {EXIT_ENGINE_DEFAULT_HARD_STOP_PCT}%)의 값과 별개이며,
            {data.exitEngine.enabled ? ' 엔진이 이 손절가보다 먼저 팔 수 있습니다.' : ' 엔진을 켜면 이 손절가보다 먼저 팔릴 수 있습니다.'} 이 화면은 주문을 만들지 않습니다.
            <br /><b>손절가 도달 알림은 엔진과 별개라, 엔진이 꺼져 있어도 옵니다.</b>
          </div>
        </div>
      </div>
      <div className="rk-col">
        <HoldingsStops c={c} eff={p.check.eff} fx={snap?.fx ?? null} />
        <ReadOnlyPolicyTable c={c} ro={data.readOnly} sources={data.sources} exec={data.execution} />
      </div>
    </div>
  );
}

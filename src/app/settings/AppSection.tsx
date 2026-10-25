'use client';

/**
 * T-084 — 설정 › "앱 (안드로이드)" 섹션 (승인 데모 v1 "C. 설정 › 앱" · 가이드 §1 C·§2 #sc·§4).
 *
 * 설정 화면 맨 아래 안내 상자 바로 위에 하나 더한다(D4 A — 새 라우트·공개 안내 페이지 없음). 업데이트 띠가 `/settings#app` 으로 보낸다.
 *  - 웹 브라우저: 설치 안내(최신 버전·크기·확인값 앞 8자·[APK 내려받기]·설치 3단계·받은 파일 확인).
 *  - 앱 안: 설치된 버전·최신 버전 + 상태(✓ 최신 · ◆ 새 버전 · ⚠ 업데이트 필요 · ! 확인 실패)·[업데이트 받기]·마지막 확인 [다시 확인].
 * 자체 조회(`appUpdateStore` — 업데이트 띠와 같은 스토어)라 SettingsPage 의 조회·저장 흐름과 섞이지 않는다(CashLedgerSummaryRow 와 같은 방식).
 * 머리글은 `SectionHeader` 와 같은 모양을 이 컴포넌트가 직접 그린다 — `id="app"`(띠의 이동 목표)을 머리글에 달기 위해서다.
 *
 * ⚠ 앱/웹 판별은 표시 전용. 다운로드 주소는 같은 출처 `/app/download/` 아래일 때만 버튼으로 낸다.
 */
import { useEffect } from 'react';
import { AppIcon, AppSectionStyles } from '@/components/app/AppStyles';
import { openDownload } from '@/components/app/AppUpdateBanner';
import {
  apkFileNameFor,
  formatBytes,
  formatKstDateTime,
  isAndroidUserAgent,
  judgeUpdate,
  noteLines,
  safeDownloadPath,
  shortHash,
  type LatestRelease,
} from '@/components/app/app-update-logic';
import { appUpdateStore, useAppUpdateState, type AppUpdateState } from '@/components/app/useAppUpdate';

export type WebModel =
  | { view: 'web'; state: 'loading' | 'error' | 'empty' }
  | { view: 'web'; state: 'ok'; latest: LatestRelease; downloadPath: string | null; nonAndroid: boolean };

export type AppStatus = 'available' | 'required' | 'latest' | 'error' | 'none' | 'unknown';

export type AppModel =
  | { view: 'app'; state: 'loading'; current: AppUpdateState['current'] }
  | {
      view: 'app';
      state: AppStatus;
      current: AppUpdateState['current'];
      latest: LatestRelease | null;
      downloadPath: string | null;
      checkedAt: number | null;
      refreshing: boolean;
    };

export type SectionModel = WebModel | AppModel;

/** 스토어 상태 → 화면 상태 (순수). 판별 전(SSR·첫 렌더)은 웹 로딩으로 그린다. */
export function deriveSectionModel(s: AppUpdateState, env: { origin: string; userAgent: string }): SectionModel {
  const result = s.result;
  if (!s.detected || !s.native) {
    if (!s.detected || result === null) return { view: 'web', state: 'loading' };
    if (result.kind === 'error') return { view: 'web', state: 'error' };
    if (result.kind === 'not_migrated' || !result.latest) return { view: 'web', state: 'empty' };
    return {
      view: 'web',
      state: 'ok',
      latest: result.latest,
      downloadPath: safeDownloadPath(result.latest.downloadUrl, env.origin),
      nonAndroid: !isAndroidUserAgent(env.userAgent),
    };
  }
  if (!s.currentLoaded || result === null) return { view: 'app', state: 'loading', current: s.current };
  const common = { view: 'app' as const, current: s.current, checkedAt: s.checkedAt, refreshing: s.load === 'loading' };
  if (result.kind === 'error') return { ...common, state: 'error', latest: null, downloadPath: null };
  if (result.kind === 'not_migrated' || !result.latest) return { ...common, state: 'none', latest: null, downloadPath: null };
  const judged = judgeUpdate(s.current?.build ?? null, result.latest);
  const state: AppStatus = judged === 'required' ? 'required' : judged === 'available' ? 'available' : judged;
  return { ...common, state, latest: result.latest, downloadPath: safeDownloadPath(result.latest.downloadUrl, env.origin) };
}

function Spin() {
  return <span className="spin" aria-hidden="true" />;
}

function St({ kind, icon, children, role }: { kind: 'ok' | 'warn' | 'bad' | 'na'; icon: string; children: React.ReactNode; role?: 'alert' }) {
  return (
    <span className={`st ${kind}`} role={role}>
      <span aria-hidden="true">{icon}</span>{children}
    </span>
  );
}

function Top({ title, sub }: { title: React.ReactNode; sub: string }) {
  return (
    <div className="ap-top">
      {/* ICON-SLOT — 앱 아이콘 ② "지층형 + 금덩이"(2026-10-25 사용자 확정, AppStyles.tsx AppIcon) */}
      <AppIcon />
      <div style={{ minWidth: 0 }}>
        <div className="nm">{title}</div>
        <div className="s">{sub}</div>
      </div>
    </div>
  );
}

export interface SectionHandlers {
  onRetry?: () => void;
  onDownload?: (path: string) => void;
}

function WebCard({ m, onRetry }: { m: WebModel } & SectionHandlers) {
  const top = <Top title="주식캐기" sub="안드로이드 앱 · 주식 자동매매를 휴대폰 홈 화면에서" />;
  if (m.state === 'loading') {
    return <div className="card apc">{top}<div className="ldg" role="status"><Spin />앱 정보를 불러오는 중…</div></div>;
  }
  if (m.state === 'error') {
    return (
      <div className="card apc">
        {top}
        <div className="ap-main">
          <St kind="warn" icon="!" role="alert">앱 정보를 불러오지 못했습니다</St>
          <button type="button" className="btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={onRetry}>다시 시도</button>
        </div>
      </div>
    );
  }
  if (m.state === 'empty') {
    return (
      <div className="card apc">
        {top}
        <div className="ap-main">
          <St kind="na" icon="—">아직 올라온 앱이 없습니다</St>
          <span className="s" style={{ margin: 0 }}>첫 배포가 끝나면 이곳에 내려받기 버튼이 생깁니다.</span>
        </div>
      </div>
    );
  }
  if (m.state !== 'ok') return null;
  const { latest } = m;
  const size = formatBytes(latest.sizeBytes);
  const file = apkFileNameFor(latest.versionName);
  return (
    <div className="card apc">
      {top}
      <div className="ap-cols">
        <div className="ap-main">
          {m.nonAndroid && (
            <div className="nt" role="note">
              이 기기는 안드로이드 휴대폰이 아닙니다. 휴대폰 Chrome 에서 <b style={{ color: 'var(--text)' }}>설정 › 앱</b>을 열어 내려받으세요.
            </div>
          )}
          <div className="meta">
            <span>최신 <b className="num">v{latest.versionName}</b></span>
            <span className="num">{size}</span>
          </div>
          <div className="hash">파일 확인값(sha256) 앞 8자 <code>{shortHash(latest.sha256)}</code></div>
          {m.downloadPath && (
            <a className="btn-pri" href={m.downloadPath} aria-describedby="ap-steps">APK 내려받기</a>
          )}
        </div>
        <div className="ap-main">
          <ol className="steps" id="ap-steps" aria-label="설치 순서">
            <li><b>내려받기</b><span>Chrome 이 &quot;유해할 수 있는 파일입니다&quot;라고 물으면 <b style={{ display: 'inline', color: 'var(--text)' }}>다운로드</b>를 누릅니다. 플레이스토어 밖에서 받는 앱이라 매번 뜨는 확인입니다.</span></li>
            <li><b>설치 허용</b><span>받은 파일을 열고, &quot;출처를 알 수 없는 앱 설치&quot;를 물으면 Chrome 을 허용합니다(처음 한 번만).</span></li>
            <li><b>설치 후 로그인</b><span>홈 화면의 주식캐기를 열고 이메일·비밀번호로 로그인합니다. 앱에서는 Google·GitHub 로그인을 지원하지 않습니다.</span></li>
          </ol>
        </div>
      </div>
      <details className="guide">
        <summary>받은 파일이 맞는지 확인하려면</summary>
        <div className="gbody">
          {file && <>파일 이름 <code>{file}</code> · </>}크기 {size}. 휴대폰 &quot;내 파일&quot;에서 같은 이름·크기인지 보면 충분합니다.
          전체 sha256 은 여기에서 복사할 수 있습니다: <code className="full">{latest.sha256}</code>. 다른 곳에서 받은 APK 는 설치하지 마세요.
        </div>
      </details>
    </div>
  );
}

function AppCard({ m, onRetry, onDownload }: { m: AppModel } & SectionHandlers) {
  const cur = m.current;
  const top = (
    <Top
      title={cur ? <>주식캐기 <span className="num">v{cur.version}</span></> : '주식캐기'}
      sub="이 휴대폰에 설치된 앱"
    />
  );
  if (m.state === 'loading') {
    return <div className="card apc">{top}<div className="ldg" role="status"><Spin />최신 버전을 확인하는 중…</div></div>;
  }
  const { latest } = m;
  let latestV: string;
  let badge: React.ReactNode;
  switch (m.state) {
    case 'error': latestV = '—'; badge = <St kind="warn" icon="!">확인 실패</St>; break;
    case 'none': latestV = '—'; badge = <St kind="na" icon="—">등록 없음</St>; break;
    case 'latest': latestV = `v${latest?.versionName ?? ''}`; badge = <St kind="ok" icon="✓">최신</St>; break;
    case 'required': latestV = `v${latest?.versionName ?? ''}`; badge = <St kind="bad" icon="⚠">업데이트 필요</St>; break;
    case 'available': latestV = `v${latest?.versionName ?? ''}`; badge = <St kind="warn" icon="◆">새 버전</St>; break;
    default: latestV = `v${latest?.versionName ?? ''}`; badge = <St kind="na" icon="—">비교할 수 없음</St>;
  }
  const needsUpdate = (m.state === 'available' || m.state === 'required') && latest !== null;
  const notes = noteLines(latest?.notes);
  return (
    <div className="card apc">
      {top}
      <div className="row">
        <span className="l">설치된 버전</span>
        <span className="v num">
          {cur ? <>v{cur.version} <span className="muted" style={{ fontWeight: 400 }}>({cur.build})</span></> : '알 수 없음'}
        </span>
      </div>
      <div className="row">
        <span className="l">최신 버전</span>
        <span className="v num">{latestV} {badge}</span>
      </div>
      {needsUpdate && latest && (
        <div className="ap-main">
          {m.state === 'required' && (
            <div className="nt red" role="note">
              <b>⚠ 이 버전은 더 이상 지원하지 않습니다.</b> 화면은 계속 쓸 수 있지만 로그인 유지 같은 앱 기능이 멈출 수 있습니다.
            </div>
          )}
          {m.downloadPath && (
            <button type="button" className="btn-pri" onClick={() => m.downloadPath && onDownload?.(m.downloadPath)}>
              업데이트 받기 <span className="num" style={{ fontWeight: 600 }}>({formatBytes(latest.sizeBytes)})</span>
            </button>
          )}
          {notes.length > 0 && (
            <div>
              <div className="s" style={{ margin: '0 0 4px' }}>바뀐 점</div>
              <ul className="notes">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {m.state === 'error' && (
        <div className="ap-main" style={{ paddingTop: 0 }}>
          <span className="s" style={{ margin: 0 }}>최신 버전을 확인하지 못했습니다. 설치된 앱은 그대로 쓸 수 있습니다.</span>
        </div>
      )}
      <div className="chk">
        <span>마지막 확인 <span className="num">{m.checkedAt !== null ? formatKstDateTime(m.checkedAt) : '—'}</span></span>
        <button type="button" className="btn-ghost" onClick={onRetry} disabled={m.refreshing}>
          {m.refreshing ? '확인 중…' : '다시 확인'}
        </button>
      </div>
      {needsUpdate && (
        <details className="guide">
          <summary>업데이트 설치 방법</summary>
          <div className="gbody">
            ① [업데이트 받기]를 누르면 Chrome 창에서 파일을 받습니다. ② 다 받으면 알림(또는 Chrome &quot;다운로드&quot;)에서 파일을 엽니다.
            ③ [업데이트]를 누르면 끝 — 지금 앱 위에 덮어 설치되어 로그인이 그대로 남습니다.
            &quot;앱이 설치되지 않았습니다&quot;가 나오면 기존 앱을 지우고 다시 설치한 뒤 다시 로그인해야 합니다.
          </div>
        </details>
      )}
    </div>
  );
}

/** 섹션 마크업(데모 settingsFrame 의 앱 섹션) — 상태별 문구·aria·className 을 시험으로 고정한다. */
export function AppSectionView({ model, onRetry, onDownload }: { model: SectionModel } & SectionHandlers) {
  return (
    <div className="aps">
      <AppSectionStyles />
      <div className="sec-h" id="app">앱 (안드로이드)</div>
      {model.view === 'web'
        ? <WebCard m={model} onRetry={onRetry} />
        : <AppCard m={model} onRetry={onRetry} onDownload={onDownload} />}
    </div>
  );
}

export function AppSection() {
  const s = useAppUpdateState();

  useEffect(() => {
    appUpdateStore.detect();
    appUpdateStore.ensureLoaded();
    // `/settings#app` 으로 들어오면 설정이 다 그려진 뒤(이 섹션이 마운트된 뒤) 여기로 — 첫 로딩 중엔 앵커가 없어 브라우저가 못 찾는다.
    if (typeof window !== 'undefined' && window.location.hash === '#app') {
      document.getElementById('app')?.scrollIntoView({ block: 'start' });
    }
  }, []);

  const env = typeof window === 'undefined'
    ? { origin: '', userAgent: '' }
    : { origin: window.location.origin, userAgent: window.navigator.userAgent };
  const model = deriveSectionModel(s, env);

  return (
    <AppSectionView
      model={model}
      onRetry={() => { void appUpdateStore.refresh(); }}
      onDownload={(path) => { void openDownload(path); }}
    />
  );
}

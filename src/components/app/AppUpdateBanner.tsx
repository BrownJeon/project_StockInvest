'use client';

/**
 * T-084 — 앱 업데이트 띠 (승인 데모 v1 "B. 앱 업데이트 띠" · 가이드 §1 B·§2 #sb·§4·§7).
 *
 * 루트 레이아웃의 `{children}` 바로 앞(문서 흐름 안)에 들어간다 — **화면을 덮지 않는다**. 스크롤하면 지나가고,
 * 아래 화면(비상 청산·승인 버튼·DRY_RUN/KILL_SWITCH 표시)은 그대로 보이고 눌린다(D3 A).
 *
 * 그리지 않는 경우: 웹 브라우저(요청도 안 함) · 인증 전 화면(`BottomTabs` 의 `HIDDEN_PATHS`) · 조회 실패·401(조용히 숨김) ·
 * 등록된 배포본 없음 · 최신 · 설치 버전을 모름 · 오늘 ✕ 로 닫음(더 새 버전이 나오면 다시 보임, D2 A).
 * 필수 업데이트 띠는 닫기가 없다. 띠 글자·[업데이트] → 설정 › 앱 섹션(`/settings#app`, D5 A). [받기] → 시스템 브라우저로 APK.
 *
 * ⚠ 앱/웹 판별은 표시 전용이다.
 */
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { HIDDEN_PATHS } from '@/components/BottomTabs';
import { openExternal } from '@/lib/native/bridge';
import {
  bannerKind,
  createDismissStore,
  focusAfterDismiss,
  isDismissed,
  judgeUpdate,
  kstDayKey,
  safeDownloadPath,
  type BannerKind,
  type DismissRecord,
} from './app-update-logic';
import { BannerStyles } from './AppStyles';
import { appUpdateStore, installResumeRefetch, useAppUpdateState } from './useAppUpdate';

export const APP_SECTION_HREF = '/settings#app';

const dismissStore = createDismissStore(() => (typeof window === 'undefined' ? null : window.localStorage));

const XIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export interface AppUpdateBannerViewProps {
  kind: BannerKind;
  latestName: string;
  currentName: string;
  /** false 면 [받기] 를 그리지 않는다(다운로드 주소가 같은 출처 `/app/download/` 아래가 아님). */
  canDownload: boolean;
  onOpen?: () => void;
  onGet?: () => void;
  onDismiss?: () => void;
}

/** 띠 마크업(데모 band()) — 상태별 문구·aria·className 을 시험으로 고정한다. */
export function AppUpdateBannerView({ kind, latestName, currentName, canDownload, onOpen, onGet, onDismiss }: AppUpdateBannerViewProps) {
  if (kind === 'rec') {
    return (
      <div className="aub" role="status">
        <BannerStyles />
        <span className="bar" aria-hidden="true" />
        <button type="button" className="txt" onClick={onOpen}>
          <span className="t num">주식캐기 v{latestName}</span>
          <span className="ss">새 버전이 나왔습니다 · 눌러서 설치 방법 보기</span>
        </button>
        {canDownload && <button type="button" className="get" onClick={onGet}>받기</button>}
        <button type="button" className="x" onClick={onDismiss} aria-label="오늘은 그만 보기"><XIcon /></button>
      </div>
    );
  }
  if (kind === 'forced') {
    return (
      <div className="aub forced" role="status">
        <BannerStyles />
        <span className="bar" aria-hidden="true" />
        <div className="txt">
          <span className="t"><span aria-hidden="true">⚠ </span>앱 업데이트가 필요합니다</span>
          <span className="ss">이 버전(v{currentName})은 더 이상 지원하지 않습니다. 화면은 계속 쓸 수 있지만 앱 기능 일부가 멈출 수 있습니다.</span>
        </div>
        <button type="button" className="get" onClick={onOpen}>업데이트</button>
      </div>
    );
  }
  return null;
}

/**
 * 띠를 닫은 뒤 포커스를 페이지 첫 제목으로(designer 점검 ④ — 사라진 버튼에 포커스가 남지 않게).
 * 순서 h1 → h2 → main → (없으면 옮기지 않음)는 `focusAfterDismiss`(순수 로직, 시험 고정)가 정한다.
 */
function focusFirstHeading() {
  if (typeof document === 'undefined') return;
  focusAfterDismiss({ querySelector: (sel) => document.querySelector<HTMLElement>(sel) });
}

/** 앱에서 APK 받기 — 시스템 브라우저(Custom Tab). 브라우저 플러그인이 없으면 일반 이동(MainActivity 다운로드 처리)으로. */
export async function openDownload(path: string): Promise<void> {
  const opened = await openExternal(path);
  if (!opened && typeof window !== 'undefined') window.location.href = path;
}

/** 설정 › 앱 섹션으로. 이미 /settings 면 그 자리로 스크롤만. */
export function goToAppSection(pathname: string | null, push: (href: string) => void): void {
  if (pathname === '/settings' && typeof document !== 'undefined') {
    const el = document.getElementById('app');
    if (el) {
      el.scrollIntoView({ block: 'start' });
      return;
    }
  }
  push(APP_SECTION_HREF);
}

export function AppUpdateBanner() {
  const pathname = usePathname();
  const router = useRouter();
  const s = useAppUpdateState();
  const [dismiss, setDismiss] = useState<DismissRecord | null>(null);
  const hiddenPath = pathname !== null && HIDDEN_PATHS.includes(pathname);

  useEffect(() => {
    appUpdateStore.detect();
    setDismiss(dismissStore.read());
  }, []);

  useEffect(() => {
    if (!s.native || hiddenPath) return;
    appUpdateStore.ensureLoaded();
    installResumeRefetch();
  }, [s.native, hiddenPath]);

  if (!s.detected || !s.native || hiddenPath || !s.currentLoaded) return null;
  if (s.result?.kind !== 'ok' || !s.result.latest) return null;

  const latest = s.result.latest;
  const status = judgeUpdate(s.current?.build ?? null, latest);
  const today = kstDayKey(Date.now());
  const kind = bannerKind(status, isDismissed(dismiss, latest.versionCode, today));
  if (!kind) return null;

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const dl = safeDownloadPath(latest.downloadUrl, origin);

  return (
    <AppUpdateBannerView
      kind={kind}
      latestName={latest.versionName}
      currentName={s.current?.version ?? ''}
      canDownload={dl !== null}
      onOpen={() => goToAppSection(pathname, (href) => router.push(href))}
      onGet={() => { if (dl) void openDownload(dl); }}
      onDismiss={() => {
        const rec = { code: latest.versionCode, day: today };
        dismissStore.write(rec);
        setDismiss(rec);
        focusFirstHeading();
      }}
    />
  );
}

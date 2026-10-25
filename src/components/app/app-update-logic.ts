/**
 * T-084 — 앱 업데이트 띠·설정 › 앱 섹션의 판단 로직 (순수 함수, I/O 없음 — jest node 환경에서 시험한다).
 *
 * 승인 데모: mockups/T-084-app-shell-v1.html (v1, 2026-10-25 사용자 승인) · 가이드 §4 상태 관리.
 *  ① 버전 판정 — versionCode 정수만 비교(`@/lib/app-release/version`). 모르는 값으로는 업데이트를 강제하지 않는다.
 *  ② ✕ 숨김 — 오늘(KST) 하루, 더 새 versionCode 가 나오면 다시 보인다(D2 A). 저장소가 막히면 메모리.
 *  ③ 재조회 — 첫 마운트 1회 + 앞으로 돌아올 때 마지막 확인이 6시간 넘었으면.
 *  ④ 표기 — 크기(안드로이드 "내 파일"과 같은 1000 단위)·확인값 앞 8자·KST 시각·안드로이드 UA.
 *  ⑤ 다운로드 주소 — 같은 출처 `/app/download/` 아래일 때만 쓴다(그 밖이면 버튼을 숨긴다).
 *
 * ⚠ 여기서 내리는 판단은 **화면 표시용**이다. 서버 권한 판단에 쓰지 않는다(`window.Capacitor` 는 누구나 만들 수 있다).
 * ⚠ `@/lib/app-release/paths` 는 `node:path` 를 쓰므로 이 파일(클라이언트 번들)에서 import 하지 않는다.
 */
import { isUpdateAvailable, isUpdateRequired, MAX_VERSION_CODE, parseVersionCode, VERSION_NAME_RE } from '@/lib/app-release/version';

// ─── 서버 응답 (GET /api/app/version) ─────────────────────────────────────

/** 서버 `AppVersionLatest`(src/lib/app-release/handlers.ts)와 같은 모양 — 검증을 통과한 값만 담는다. */
export interface LatestRelease {
  versionCode: number;
  versionName: string;
  sizeBytes: number;
  sha256: string;
  notes: string | null;
  minSupported: number;
  downloadUrl: string;
}

export type VersionFetchResult =
  | { kind: 'ok'; latest: LatestRelease | null }
  | { kind: 'not_migrated' }
  | { kind: 'error' };

const SHA256_RE = /^[0-9a-f]{64}$/;
const NOTES_MAX = 500;

function parseLatest(raw: unknown): LatestRelease | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const versionCode = parseVersionCode(r.versionCode);
  const versionName = typeof r.versionName === 'string' && VERSION_NAME_RE.test(r.versionName) ? r.versionName : null;
  const sizeBytes = typeof r.sizeBytes === 'number' && Number.isSafeInteger(r.sizeBytes) && r.sizeBytes > 0 ? r.sizeBytes : null;
  const sha256 = typeof r.sha256 === 'string' && SHA256_RE.test(r.sha256) ? r.sha256 : null;
  const notes = r.notes === null || r.notes === undefined ? null : typeof r.notes === 'string' ? r.notes.slice(0, NOTES_MAX) : undefined;
  const minSupported = typeof r.minSupported === 'number' && Number.isSafeInteger(r.minSupported) && r.minSupported >= 0 && r.minSupported <= MAX_VERSION_CODE
    ? r.minSupported : null;
  const downloadUrl = typeof r.downloadUrl === 'string' ? r.downloadUrl : null;
  if (versionCode === null || versionName === null || sizeBytes === null || sha256 === null || notes === undefined || minSupported === null || downloadUrl === null) {
    return undefined;
  }
  return { versionCode, versionName, sizeBytes, sha256, notes, minSupported, downloadUrl };
}

/** HTTP 상태 + 본문 → 결과. 형식이 어긋난 응답은 오류로 다룬다(모르는 값으로 화면을 그리지 않는다). */
export function parseVersionResponse(status: number, body: unknown): VersionFetchResult {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  if (status === 503 && b?.error === 'not_migrated') return { kind: 'not_migrated' };
  if (status !== 200 || !b || b.ok !== true) return { kind: 'error' };
  const latest = parseLatest(b.latest);
  if (latest === undefined) return { kind: 'error' };
  return { kind: 'ok', latest };
}

// ─── ① 버전 판정 ──────────────────────────────────────────────────────────

/**
 * required = 내 코드 < 최소 지원 · available = 내 코드 < 최신 · latest = 최신과 같거나 높음 ·
 * none = 등록된 배포본 없음 · unknown = 내 코드를 모름(비교 불가).
 */
export type UpdateStatus = 'required' | 'available' | 'latest' | 'none' | 'unknown';

export function judgeUpdate(currentCode: number | null, latest: Pick<LatestRelease, 'versionCode' | 'minSupported'> | null): UpdateStatus {
  if (!latest) return 'none';
  if (currentCode === null) return 'unknown';
  if (isUpdateRequired(currentCode, latest.minSupported)) return 'required';
  if (isUpdateAvailable(currentCode, latest.versionCode)) return 'available';
  return 'latest';
}

// ─── ② ✕ 숨김 (오늘 KST 하루 · 더 새 코드면 다시) ────────────────────────

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' (KST). */
export function kstDayKey(nowMs: number): string {
  const d = new Date(nowMs + KST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface DismissRecord { code: number; day: string }

export const DISMISS_STORAGE_KEY = 'stockinvest.appUpdate.dismiss';

export function parseDismiss(raw: string | null | undefined): DismissRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object') return null;
    const r = v as Record<string, unknown>;
    const code = parseVersionCode(r.code);
    const day = typeof r.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day) ? r.day : null;
    return code !== null && day !== null ? { code, day } : null;
  } catch {
    return null;
  }
}

/** 오늘 닫았고, 닫은 뒤로 더 새 버전이 나오지 않았으면 숨긴다. */
export function isDismissed(rec: DismissRecord | null, latestCode: number, todayKey: string): boolean {
  return rec !== null && rec.day === todayKey && rec.code >= latestCode;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * localStorage 위에 얹은 ✕ 기록 저장소. 저장소가 없거나 막히면(사생활 모드·WebView 설정) 이번 실행 동안 메모리에만 둔다.
 * `getStorage` 를 함수로 받는 이유: `window.localStorage` 접근 자체가 예외를 던질 수 있다.
 */
export function createDismissStore(getStorage: () => KeyValueStorage | null | undefined) {
  let memory: DismissRecord | null = null;
  function storage(): KeyValueStorage | null {
    try { return getStorage() ?? null; } catch { return null; }
  }
  return {
    read(): DismissRecord | null {
      const s = storage();
      if (s) {
        try {
          const rec = parseDismiss(s.getItem(DISMISS_STORAGE_KEY));
          if (rec) return rec;
        } catch { /* 막힘 — 메모리 값으로 */ }
      }
      return memory;
    },
    write(rec: DismissRecord): void {
      memory = rec;
      const s = storage();
      if (!s) return;
      try { s.setItem(DISMISS_STORAGE_KEY, JSON.stringify(rec)); } catch { /* 막힘 — 메모리에만 */ }
    },
  };
}

/** 띠 종류 — 필수는 닫을 수 없으므로 ✕ 기록과 무관하게 보인다. */
export type BannerKind = 'rec' | 'forced' | null;

export function bannerKind(status: UpdateStatus, dismissed: boolean): BannerKind {
  if (status === 'required') return 'forced';
  if (status === 'available') return dismissed ? null : 'rec';
  return null;
}

// ─── ②-1 띠를 닫은 뒤 포커스 대상 ─────────────────────────────────────────

/**
 * ✕ 로 띠가 사라진 뒤 포커스를 옮길 후보 — 이 순서대로 찾아 **처음 있는 것 하나**(각 선택자 안에서는 문서 순서상 첫 요소).
 * 제목이 없는 화면에서 포커스가 `body` 로 떨어지지 않게 `main` 을 마지막 후보로 둔다. 셋 다 없으면 옮기지 않는다.
 * (선택자 목록 `'h1, h2'` 한 번으로 찾으면 선택자 순서가 아니라 문서 순서로 고르므로 h2 가 h1 보다 먼저 잡힐 수 있다 — 그래서 하나씩 찾는다.)
 */
export const DISMISS_FOCUS_ORDER = ['h1', 'h2', 'main'] as const;

/** 후보 고르기(순수) — `query` 는 `document.querySelector` 와 같은 일을 하는 함수. */
export function pickDismissFocusTarget<T>(query: (selector: string) => T | null | undefined): T | null {
  for (const sel of DISMISS_FOCUS_ORDER) {
    const el = query(sel);
    if (el) return el;
  }
  return null;
}

/** 포커스를 옮길 요소의 최소 모양(시험에서 가짜 요소로 바꿔 끼운다). */
export interface FocusTargetLike {
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  focus(options?: { preventScroll?: boolean }): void;
}

/** 고른 요소로 포커스 이동 — 원래 포커스를 받지 않는 요소(제목·main)라 `tabindex` 가 없으면 `-1` 을 붙인다. 옮겼으면 true. */
export function focusAfterDismiss(doc: { querySelector(selector: string): FocusTargetLike | null } | null | undefined): boolean {
  if (!doc) return false;
  const el = pickDismissFocusTarget((sel) => doc.querySelector(sel));
  if (!el) return false;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  return true;
}

// ─── ③ 재조회 규칙 ────────────────────────────────────────────────────────

export const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;

/** 앞으로 돌아왔을 때(visible) 다시 조회할까 — 확인한 적이 없거나 마지막 확인이 6시간을 넘었을 때만. */
export function shouldRefetchOnResume(lastCheckedMs: number | null, nowMs: number, visible: boolean): boolean {
  if (!visible) return false;
  if (lastCheckedMs === null) return true;
  return nowMs - lastCheckedMs > REFRESH_AFTER_MS;
}

// ─── ④ 표기 ───────────────────────────────────────────────────────────────

/** 바이트 → "9.8MB"·"850KB". 안드로이드 "내 파일"처럼 1000 단위(받은 파일과 같은 숫자로 비교하게). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}KB`;
  return `${Math.round(n)}B`;
}

/** sha256 앞 8자(소문자). */
export function shortHash(sha256: string): string {
  return sha256.slice(0, 8).toLowerCase();
}

/** KST "10월 25일 17:20". */
export function formatKstDateTime(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${hh}:${mm}`;
}

/** 안드로이드 기기 브라우저인가(설치 안내의 "안드로이드가 아닌 기기" 한 줄용 — 표시 전용). */
export function isAndroidUserAgent(ua: string | null | undefined): boolean {
  return typeof ua === 'string' && /\bAndroid\b/i.test(ua);
}

/** 배포 메모(최대 500자) → 목록 줄. 줄바꿈 기준, 앞의 `-`·`*`·`•` 표지는 뗀다. */
export function noteLines(notes: string | null | undefined): string[] {
  if (!notes) return [];
  return notes
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*•]\s*/, '').trim())
    .filter((l) => l.length > 0);
}

/** 배포 파일 이름 — `scripts/build-apk.sh --publish` 가 쓰는 `stockinvest-<versionName>.apk` 규칙. */
export function apkFileNameFor(versionName: string): string | null {
  return VERSION_NAME_RE.test(versionName) ? `stockinvest-${versionName}.apk` : null;
}

// ─── ⑤ 다운로드 주소 검증 ─────────────────────────────────────────────────

export const DOWNLOAD_PATH_PREFIX = '/app/download/';

/**
 * 서버가 준 `downloadUrl` → 같은 출처 `/app/download/<이름>` 경로(쿼리·조각 없음). 조건 밖이면 null(→ 버튼을 숨긴다).
 * 받는 형식은 `/` 로 시작하는 상대 경로뿐이다 — 절대 URL·`//host`·역슬래시·`..`·인코딩된 구분자는 거부한다.
 */
export function safeDownloadPath(downloadUrl: unknown, origin: string): string | null {
  if (typeof downloadUrl !== 'string' || !downloadUrl.startsWith(DOWNLOAD_PATH_PREFIX)) return null;
  if (downloadUrl.includes('\\') || downloadUrl.includes('%') || /[\s?#]/.test(downloadUrl)) return null;
  let u: URL;
  try {
    u = new URL(downloadUrl, origin);
  } catch {
    return null;
  }
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return null;
  }
  if (u.origin !== base.origin || u.pathname !== downloadUrl) return null;
  const name = u.pathname.slice(DOWNLOAD_PATH_PREFIX.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.apk$/.test(name) || name.includes('..')) return null;
  return u.pathname;
}

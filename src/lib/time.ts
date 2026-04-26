const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * "현재 시각 기준 KST 오늘 00:00"의 UTC Date를 반환.
 * 서버 timezone에 무관하게 동작 — KST 기준 일자 경계를 애플리케이션 레이어에서 고정.
 */
export function kstTodayStart(now: Date = new Date()): Date {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  // KST 00:00 = UTC 전날 15:00 = Date.UTC(y,m,d,0) - 9h
  return new Date(Date.UTC(y, m, d, 0, 0, 0) - KST_OFFSET_MS);
}

export function formatRelativeTime(ts: number | string | Date | null | undefined): string {
  if (ts == null) return '-';
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (!Number.isFinite(t)) return '-';
  const diff = Date.now() - t;
  if (diff < 5_000) return '방금 전';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}초 전`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}

/** 미래 또는 과거 상대 시각 ("X분 후" / "X시간 전") — 항상 KST 기준으로 계산 */
export function formatRelativeKST(ts: number | string | Date | null | undefined, dir: 'past' | 'future' = 'past'): string {
  if (ts == null) return '-';
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (!Number.isFinite(t)) return '-';
  const diff = dir === 'past' ? Date.now() - t : t - Date.now();
  if (diff < 0) return dir === 'future' ? '지남' : '방금 전';
  if (diff < 60_000) return dir === 'future' ? '곧' : '방금 전';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 ${dir === 'future' ? '후' : '전'}`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 ${dir === 'future' ? '후' : '전'}`;
  return `${Math.floor(diff / 86_400_000)}일 ${dir === 'future' ? '후' : '전'}`;
}

/** 절대 시각을 KST로 포맷 — 서버/클라이언트 환경 무관하게 Asia/Seoul 기준 */
export function formatAbsoluteKST(
  ts: number | string | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' },
): string {
  if (ts == null) return '-';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', ...opts });
}

/** 시각(HH:MM)만 KST로 포맷 */
export function formatTimeKST(ts: number | string | Date | null | undefined): string {
  return formatAbsoluteKST(ts, { hour: '2-digit', minute: '2-digit' });
}

/** 날짜+시각(M/D HH:MM)을 KST로 포맷 */
export function formatDateTimeKST(ts: number | string | Date | null | undefined): string {
  return formatAbsoluteKST(ts, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 날짜+시각+초(M/D HH:MM:SS)를 KST로 포맷 */
export function formatDateTimeSecondsKST(ts: number | string | Date | null | undefined): string {
  return formatAbsoluteKST(ts, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * 정기 리포트 anchor 시각 판정.
 *
 * `anchorKst` 는 콤마 구분된 KST `HH:MM` 리스트 (예: `"08:00, 17:00"`).
 *  - 빈값/null → 롤링 모드 (interval 배수)
 *  - 1개 이상 → 입력된 시각마다 발송 (interval gate 무시)
 *
 * `shouldFireAtAnchorList` 는 마지막 발송(`lastSentAt`) 이후 + 현재(`now`) 이전 사이에
 * anchor 시각이 도래했는지 검사. 24시간 lookback (어제·오늘 anchor 모두 후보).
 */

export interface ParsedAnchor { hh: number; mm: number; }

export function parseAnchorList(raw: string | null | undefined): ParsedAnchor[] {
  if (!raw) return [];
  return raw.split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const m = s.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const hh = Number(m[1]), mm = Number(m[2]);
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
      return { hh, mm };
    })
    .filter((v): v is ParsedAnchor => v != null);
}

export function shouldFireAtAnchorList(
  anchors: ParsedAnchor[],
  lastSentAt: Date | null,
  now: Date,
): boolean {
  if (anchors.length === 0) return false;
  const last = (lastSentAt ?? new Date(0)).getTime();
  const nowMs = now.getTime();

  // KST 기준 어제·오늘·내일의 anchor 시각 후보 모두 검사 (timezone edge 안전).
  // anchor KST hh:mm → UTC ms 변환: KST = UTC+9 이므로 UTC hh-9 시각.
  const kstNow = new Date(nowMs + 9 * 3600_000);
  const baseY = kstNow.getUTCFullYear();
  const baseMo = kstNow.getUTCMonth();
  const baseD = kstNow.getUTCDate();

  for (let dayOffset = -1; dayOffset <= 1; dayOffset++) {
    for (const a of anchors) {
      const t = Date.UTC(baseY, baseMo, baseD + dayOffset, a.hh - 9, a.mm);
      if (t > last && t <= nowMs) return true;
    }
  }
  return false;
}

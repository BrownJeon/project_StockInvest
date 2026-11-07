export const UNLIMITED_BUY_LIMIT = 'unlimited' as const;
export type BuyLimit = number | typeof UNLIMITED_BUY_LIMIT;

function unlimitedPrevious(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 1
    || !Object.hasOwn(value, 'unlimitedPrevious')) return undefined;
  const { unlimitedPrevious: previous } = value as { unlimitedPrevious: unknown };
  return typeof previous === 'string' ? previous : undefined;
}

/** Config values after JSON decoding. Legacy zero and invalid values block buys. */
export function parseBuyLimit(value: unknown): BuyLimit {
  if (value === UNLIMITED_BUY_LIMIT || unlimitedPrevious(value) !== undefined) return UNLIMITED_BUY_LIMIT;
  const pct = typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : value;
  return typeof pct === 'number' && Number.isFinite(pct) && pct > 0 ? pct : 0;
}

/** The legacy RSI sell amount used the previous finite one-order percentage. */
export function decodePreviousOrderPct(raw: string): number {
  try {
    const previous = unlimitedPrevious(JSON.parse(raw));
    const pct = decodeBuyLimit(previous);
    return typeof pct === 'number' ? pct : 0;
  } catch {
    return 0;
  }
}

export function decodeBuyLimit(raw: unknown): BuyLimit {
  try {
    return parseBuyLimit(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch {
    return 0;
  }
}

export function isBuyLimitConfigured(limit: BuyLimit): boolean {
  return limit === UNLIMITED_BUY_LIMIT || (Number.isFinite(limit) && limit > 0);
}

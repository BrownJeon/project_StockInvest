import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export type AssetClass = 'stock';
export type Stage = 'verify' | 'pilot' | 'stage2_plus';

export interface StageLimits {
  orderMaxKRW: number;
  dailyOrderMaxKRW: number;
}

const STAGE_LIMITS: Record<Stage, StageLimits> = {
  verify:      { orderMaxKRW: 10_000,  dailyOrderMaxKRW: 50_000 },
  pilot:       { orderMaxKRW: 50_000,  dailyOrderMaxKRW: 300_000 },
  stage2_plus: { orderMaxKRW: 300_000, dailyOrderMaxKRW: 1_500_000 },
};

export function getStageLimits(stage: Stage): StageLimits {
  return STAGE_LIMITS[stage];
}

type SkipMode = 'auto' | 'true' | 'false';

function readSkipMode(): SkipMode {
  const raw = String(process.env.ASSET_PROFILE_STOCK_SKIP_VERIFY ?? process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY ?? 'auto').toLowerCase();
  if (raw === 'true' || raw === 'false' || raw === 'auto') return raw;
  return 'auto';
}

/**
 * 검증 단계 스킵이 활성인지 판정.
 * 우선순위: system_config(DB) → env var → auto
 * - `true` / `false` → 강제 ON/OFF
 * - `auto` → orders 테이블에 해당 자산 클래스의 정상 처리 주문 1건 이상이면 ON
 *   (filled, partially_filled, dry_run — dry_run은 모든 안전 검사 통과를 의미)
 */
export async function isVerifySkipActive(assetClass: AssetClass): Promise<boolean> {
  // DB override 우선
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1', ['asset_profile_stock_skip_verify'],
    );
    if (rows.length > 0) {
      const val = JSON.parse(rows[0].value);
      if (val === true || val === 'true') return true;
      if (val === false || val === 'false') return false;
      // 'auto' → 아래 로직으로 진행
    }
  } catch { /* fall through */ }

  const mode = readSkipMode();
  if (mode === 'true') return true;
  if (mode === 'false') return false;

  // auto: filled, partially_filled, dry_run 중 1건이상 = 안전 배관 검증됨
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 1 FROM orders
       WHERE asset_class = ?
         AND status IN ('filled','partially_filled','dry_run')
       LIMIT 1`,
      [assetClass],
    );
    return rows.length > 0;
  } catch (e) {
    console.error('[asset-profile] auto check failed:', e);
    return false;
  }
}

/**
 * 현재 Stage 반환.
 * - verify: 검증 단계 (ORDER_MAX 10,000 / DAILY 50,000 기본)
 * - pilot: 파일럿 단계 (50,000 / 300,000)
 * - stage2_plus: 정식 단계 (300,000 / 1,500,000 이상)
 *
 * 파일럿→Stage2+ 승격 판정은 파일럿 기간 조건(raw 주문 건수, 시간) 필요 — 현재는 구현 보류.
 * Phase 3~5에서 실주문 경험 누적 후 정밀화. 지금은 검증 스킵 여부로 verify vs pilot만 구분.
 */
export async function getCurrentStage(assetClass: AssetClass): Promise<Stage> {
  const skip = await isVerifySkipActive(assetClass);
  return skip ? 'pilot' : 'verify';
}


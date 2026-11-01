/**
 * T-143 WP-B — 홈 「확인 필요」의 **해외 분석 대상 변경 제안 건수** 판독 (구현 가이드 §3.4).
 *
 * 🔴 **fail-closed 집합에 넣지 않는다.** `home.ts` 는 「확인 필요」 입력이 하나라도 실패하면 목록 대신 섹션 전체를
 * 오류로 둔다(빈 목록이 「지금 확인할 것 없음」으로 읽히는 것을 막는 규칙). 제안 건수는 그 집합 밖이라
 * **실패하면 `null` 이고 그 줄만 빠진다** — 가장 덜 급한 새 값 하나가 「모든거래차단 ON」 줄까지 가리지 않게.
 *
 * 그러면 「못 읽은 사실」은 누가 말하나 — **아직 아무도 말하지 않는다.** 설계는 「해외 분석 대상 변경 확인」 잡이
 * 실패·누락이면 `job_run_log` 를 통해 **데이터 이상** 줄로 올라오는 것이지만(`anomalies.ts`), **그 잡은 아직 등록되지
 * 않았다**(WP-A 인계 조건 ① — 러너 `call` 줄·cron 라우트·`JOB_SPECS`·`JOB_NAME_KO` 를 한 묶음으로 넣어야 한다).
 * 지금은 제안 건수 조회 실패가 조용한 `null` 이고, **제안을 만드는 주체가 없어 실해는 없다**(제안이 늘 0건이다).
 * WP-A 가 들어오면 이 문장이 설계대로 참이 된다 — 그때까지는 이 한계를 사실로 적어 둔다.
 *
 * 울타리(A-3): 이 계층은 **SELECT 1문장만** 보낸다(`OpsReader` — 쿼리당 2.5초 상한·동시 실행 관문). 쓰기·외부 호출 0.
 */
import { proposalKindLabel } from '@/lib/universe/proposal-copy';
import { type OpsReader } from './read-only';

/** 홈이 쓰는 값 — 처리하지 않은 제안 수와 첫 줄 요약. */
export interface UniverseProposalBrief {
  open: number;
  /** 첫 제안 요약(예 `NAS:AAAA 상장폐지 예정`). **서버가 완성해 준다** — 홈이 조립하지 않는다(가이드 §3.1). */
  first: string | null;
}

/**
 * 보류 해제 시각이 지난 제안도 센다 — 「공시가 갱신되면 그때 다시 올라옵니다」가 화면과 홈에서 같게 보이게.
 * 보류·무시 중인 것은 빠진다(그것이 보류·무시의 뜻이다 — D4).
 */
export const UNIVERSE_OPEN_PROPOSAL_SQL =
  `SELECT symbol, kind, next_symbol FROM overseas_universe_proposal
    WHERE state = 'open' OR (state = 'held' AND held_until IS NOT NULL AND held_until <= ?)
    ORDER BY created_at DESC, proposal_id DESC
    LIMIT 100`;

/**
 * 제안 건수·첫 줄. **던지지 않는다** — 표가 없거나(마이그레이션 전) 조회가 실패하면 `null`.
 * `null` 은 「0건」이 아니다 — 홈은 `null` 이면 그 줄을 **그리지 않고**, 0 이면 줄이 없을 뿐 사실을 안다.
 */
export async function readUniverseProposalBrief(r: OpsReader, nowSql: string): Promise<UniverseProposalBrief | null> {
  try {
    const rows = await r.rows<Record<string, unknown>>(UNIVERSE_OPEN_PROPOSAL_SQL, [nowSql]);
    if (rows.length === 0) return { open: 0, first: null };
    const head = rows[0];
    const symbol = head.symbol == null ? '' : String(head.symbol);
    const label = proposalKindLabel(
      head.kind == null ? null : String(head.kind),
      head.next_symbol == null ? null : String(head.next_symbol),
    );
    return { open: rows.length, first: `${symbol} ${label}`.trim() || null };
  } catch {
    // 분류어도 남기지 않는다 — 이 값은 섹션을 오류로 만들지 않으므로 홈 응답에 흔적이 없다.
    // (확인 잡 자체가 실패했는지는 job_run_log → 데이터 이상 줄이 말한다)
    return null;
  }
}

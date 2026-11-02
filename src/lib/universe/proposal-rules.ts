/**
 * T-143 WP-A — 변경 제안 생성 규칙 A~F 와 멱등 지문. **순수 함수.**
 *
 * 정본: `docs/design/2026-11-01-t143-wpa-nyse50-spec.md` §8.
 *
 * ## 제안은 「수동 목록 종목」에만 만든다
 * 제안의 세 행동(빼기·넣기·코드 바꾸기)이 전부 **수동 목록을 바꾸기** 때문이다(`applyProposalToManual`).
 * 자동 목록(NYSE 상위 N) 종목의 거래소 이동·상장폐지는 **다음 산출이 자동으로 반영**하므로 제안으로 만들지 않는다 —
 * 제안으로 만들면 사용자가 승인할 때까지 자동 목록이 바뀌지 않아 「자동」이 아니게 된다(L-A1 의 전제).
 * 보유·즐겨찾기 전용 종목도 각자 원래 화면이 주인이라 제안이 아니라 알림의 정보 줄로 간다(§8.5).
 *
 * ## 이 잡은 주문·시그널을 만들지 않는다
 * 보유 중인 종목이 상장폐지 의심(B·D·E)이어도 **제안만** 만들고 알림 수준을 `warning` 으로 올린다.
 * 자동 매도는 `createSignal → submitOrder` 안전장치 경로 밖에서 만들지 않는다.
 */
import type { SecListingRow } from './sec-listing';
import { excdForSecExchange } from './sec-listing';

/** WP-A 가 만드는 제안 종류 5개. `otc_move`·`kis_unavailable` 은 W-2 로 `PROPOSAL_KIND_KO` 에 이미 들어가 있다. */
export type UniverseProposalKind = 'exchange_move' | 'otc_move' | 'ticker_change' | 'delisting' | 'kis_unavailable';

export interface ProposalDraft {
  symbol: string;
  kind: UniverseProposalKind;
  actionType: 'remove' | 'recode';
  nextSymbol: string | null;
  basisText: string;
  /**
   * `WatchSourceId` 에 `'kis'` 가 없어 **전부 `'listing'`** 이다(W-6 — 타입을 바꾸지 않는다).
   * KIS 에서 비롯한 사실인지는 지문·근거 문장이 구분한다.
   */
  basisSource: 'listing';
  basisFingerprint: string;
  recommendation: string | null;
}

/** `basis_text` 는 VARCHAR(255)·`basis_fingerprint` 는 VARCHAR(190) UNIQUE 다(WP-B DDL). */
export const BASIS_TEXT_MAX = 255;
export const FINGERPRINT_MAX = 190;

/**
 * 멱등 지문 — `원천|종목|종류|관측값`. **월·일자·run_id 를 넣지 않는다.**
 *
 * 같은 관측 사실이면 다음 달에도 같은 지문이 되어 `INSERT IGNORE` 로 재제안이 막힌다
 * (무시 문구 「같은 근거로는 다시 제안하지 않습니다」의 근거). 사실이 바뀌면(`Nasdaq`→`OTC`) 지문이 달라져
 * 새 제안이 뜬다(보류 문구 「공시가 갱신되면 다시 올라옵니다」와 같은 뜻).
 *
 * ⚠ 한계: 상태가 「실패 → 복구 → 다시 실패」로 되돌아오면 두 번째는 같은 지문이라 뜨지 않는다.
 * 월 1회 산출에서 받아들인 한계다.
 */
export function fingerprint(symbol: string, kind: UniverseProposalKind, observed: string): string {
  // ASCII 로 좁힌다 — UNIQUE 인덱스 190자(utf8mb4 760바이트) 안이고, 사람이 눈으로 대조할 수 있어야 한다
  const safe = observed.replace(/[^\x20-\x7E]/g, '?').replace(/\|/g, '/');
  return `listing|${symbol}|${kind}|${safe}`.slice(0, FINGERPRINT_MAX);
}

function clampBasis(s: string): string {
  return s.length <= BASIS_TEXT_MAX ? s : `${s.slice(0, BASIS_TEXT_MAX - 1)}…`;
}

export interface BuildProposalsArgs {
  /** 지금 수동 목록(개정판이 없으면 폴백 목록 — 호출부가 판독기와 같은 값을 넘긴다). */
  manual: readonly string[];
  /** SEC 파일 전체의 티커 색인(`indexByTicker`). */
  secByTicker: ReadonlyMap<string, SecListingRow[]>;
  /** SEC 파일 전체의 CIK 색인(`indexByCik`). */
  secByCik: ReadonlyMap<number, SecListingRow[]>;
  /** 내부 심볼 → `symbol_cik_map` 의 CIK. 매핑이 없으면 null. */
  cikOf: (symbol: string) => number | null;
  /** 내부 심볼 → SEC 티커(`toSecTicker` 와 같은 규칙: `.`·`/` → `-`). */
  secTickerOf: (symbol: string) => string | null;
  /**
   * 내부 심볼 → KIS 조회가 되고 있나. **`null` = 모름**(스캔 대상도 아니었고 최근 스냅샷도 판단 불가) —
   * 모름을 「실패」로 보면 멀쩡한 종목을 빼라고 제안한다.
   */
  kisOk: (symbol: string) => boolean | null;
  /** SEC 파일 sha256 앞 8자 — 근거 문장에 붙여 어느 파일로 판정했는지 남긴다. */
  secShaPrefix: string;
}

/**
 * 규칙 A~F 를 수동 목록의 각 종목에 적용한다. 순서는 입력 목록 순서를 보존한다.
 *
 * - **A** SEC 에 있고 거래 가능한 거래소인데 접두사가 다르다 → `exchange_move` / `recode`
 * - **B** SEC 에 있는데 KIS 미지원 거래소(OTC·TXSE·CBOE·null) → `otc_move` / `remove`
 * - **C** 그 티커는 없고 같은 CIK 가 **다른 티커 1건**으로 있다 → `ticker_change` / `recode`
 * - **D** SEC 에 없고 CIK 로도 못 찾고 KIS 조회도 실패 → `delisting` / `remove`
 * - **E** SEC 에 있고 거래소도 맞는데 KIS 조회만 실패 → `kis_unavailable` / `remove`
 * - **F** 그 밖(SEC 없음 + KIS 정상 = 파일 지연일 수 있다) → 제안 없음
 */
export function buildProposals(args: BuildProposalsArgs): ProposalDraft[] {
  const { manual, secByTicker, secByCik, cikOf, secTickerOf, kisOk, secShaPrefix } = args;
  const inManual = new Set(manual);
  const sha = secShaPrefix ? ` (SEC ${secShaPrefix})` : '';
  const out: ProposalDraft[] = [];

  for (const symbol of manual) {
    const excd = symbol.slice(0, symbol.indexOf(':'));
    const ticker = secTickerOf(symbol);
    if (!ticker) continue;                         // 해외 형식이 아니다 — 이 잡의 대상이 아니다
    const byTicker = secByTicker.get(ticker) ?? [];
    const ok = kisOk(symbol);

    if (byTicker.length === 1) {
      const row = byTicker[0];
      const target = excdForSecExchange(row.exchange);
      if (target && target !== excd) {
        // A — 거래소 이동. 목표 코드가 이미 목록에 있으면 만들지 않는다(§8.1 「목표 상태가 이미 반영돼 있으면」)
        const next = `${target}:${symbol.slice(symbol.indexOf(':') + 1)}`;
        if (next !== symbol && !inManual.has(next)) {
          out.push({
            symbol, kind: 'exchange_move', actionType: 'recode', nextSymbol: next,
            basisText: clampBasis(`SEC 상장 목록: exchange=${row.exchange ?? '(없음)'}${sha}`),
            basisSource: 'listing',
            basisFingerprint: fingerprint(symbol, 'exchange_move', `sec_exchange=${row.exchange ?? 'null'}`),
            recommendation: null,                  // 화면이 action.label(「코드 바꾸기 X → Y」)을 쓴다
          });
        }
        continue;
      }
      if (!target) {
        // B — KIS 미지원 거래소로 이동(장외·TXSE·CBOE·null). 거래 자체가 불가능하다
        out.push({
          symbol, kind: 'otc_move', actionType: 'remove', nextSymbol: null,
          basisText: clampBasis(`SEC 상장 목록: exchange=${row.exchange ?? '(없음)'} — KIS 미지원 거래소${sha}`),
          basisSource: 'listing',
          basisFingerprint: fingerprint(symbol, 'otc_move', `sec_exchange=${row.exchange ?? 'null'}`),
          recommendation: null,
        });
        continue;
      }
      // 거래소가 맞다 — KIS 조회만 실패하면 E. **모름(null)은 제안하지 않는다**
      if (ok === false) {
        out.push({
          symbol, kind: 'kis_unavailable', actionType: 'remove', nextSymbol: null,
          basisText: clampBasis(`KIS 현재가상세 판정 불가 — 상장 목록에는 있음(exchange=${row.exchange ?? '(없음)'})${sha}`),
          basisSource: 'listing',
          basisFingerprint: fingerprint(symbol, 'kis_unavailable', 'kis_missing'),
          recommendation: '표기 확인(클래스주 . 표기 등) 또는 빼기',
        });
      }
      continue;
    }

    if (byTicker.length === 0) {
      // C — 같은 CIK 가 다른 티커 1건으로 있나(코드 변경)
      const cik = cikOf(symbol);
      const sameCik = cik == null ? [] : (secByCik.get(cik) ?? []).filter((r) => r.ticker !== ticker);
      const movable = sameCik.filter((r) => excdForSecExchange(r.exchange) != null);
      if (movable.length === 1) {
        const r = movable[0];
        const target = excdForSecExchange(r.exchange) as 'NAS' | 'NYS' | 'AMS';
        const next = `${target}:${r.ticker.replace(/-/g, '.')}`;
        if (next !== symbol && !inManual.has(next)) {
          out.push({
            symbol, kind: 'ticker_change', actionType: 'recode', nextSymbol: next,
            basisText: clampBasis(`SEC: CIK ${cik} 티커 ${ticker} → ${r.ticker}${sha}`),
            basisSource: 'listing',
            basisFingerprint: fingerprint(symbol, 'ticker_change', `cik=${cik};new=${r.ticker}`),
            recommendation: null,
          });
        }
        continue;
      }
      // D — SEC 에도 없고 CIK 로도 못 찾고 KIS 조회도 실패. **모름(null)은 제안하지 않는다**(F)
      if (ok === false) {
        out.push({
          symbol, kind: 'delisting', actionType: 'remove', nextSymbol: null,
          basisText: clampBasis(`SEC 상장 목록 없음 + KIS 조회 실패${sha}`),
          basisSource: 'listing',
          basisFingerprint: fingerprint(symbol, 'delisting', 'sec_missing;kis_missing'),
          recommendation: null,
        });
      }
      continue;
    }
    // 같은 티커가 두 거래소에 중복 등재(2026-11-01 측정 0건) — 어느 쪽이 맞는지 알 수 없으므로 제안하지 않는다(F)
  }
  return out;
}

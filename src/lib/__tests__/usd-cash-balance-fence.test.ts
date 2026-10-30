/**
 * 🔴 T-056 회귀 봉인 (Reviewer R-4) — **잔고 배열에서 USD 행을 "골라 읽는" 코드 지점을 목록으로 고정한다.**
 *
 * ## 왜 이 테스트가 존재하는가
 *
 * T-056 은 USD 예수금을 `Balance[]` 에서 빼고 `getBalancesDetailed().cash.USD`(known/unknown/not_queried)로만 보내게 했다.
 * 그런데 `b.currency === 'USD'` 는 타입상 여전히 유효한 비교라, 누가 `kis.getBalances()` 결과에서 USD 행을 다시 찾으면
 * **컴파일도 시험도 조용히 통과하고 그 값은 늘 "없음 = 0"** 이 된다 — 이 task 가 없앤 바로 그 경로다(스냅샷 4,667행에
 * USD 행이 0건이던 원인과 같은 모양). 타입으로 막으려면 `ExchangeClient.getBalances` 반환형을 바꿔야 해서 이 테스트로 대신한다.
 *
 * 규칙: 비-테스트 소스에서 `currency` 와 `'USD'` 의 **같음 비교**(`===`·`==`, 양쪽 순서 모두)가 나오는 곳은 아래 허용 목록과
 * **파일·개수까지 정확히** 같아야 한다. 제외 비교(`!== 'USD'`)는 USD 행을 걸러 내는 쪽이라 위험하지 않아 세지 않는다.
 * 새 지점이 정말 필요하면 목록에 사유와 함께 추가한다 — 그 순간 리뷰 대상이 된다. 같은 방식: `currency-mixing-fence.test.ts`(T-035).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', '..');   // <repo>/src

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = walk(SRC).map((f) => ({
  path: relative(SRC, f).split(sep).join('/'),
  text: readFileSync(f, 'utf8'),
}));

/** `x.currency === 'USD'` · `'USD' == p.currency` 등 (공백·따옴표 종류 무관). `!==`·`!=` 는 잡지 않는다. */
const USD_EQ = /(?:\bcurrency\b[\s)]*(?<![!=])===?(?!=)\s*['"`]USD['"`])|(?:['"`]USD['"`]\s*(?<![!=])===?(?!=)\s*[\w.?()[\]\s]*\bcurrency\b)/g;

function usdEqualityCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of FILES) {
    for (const line of f.text.split('\n')) {
      // 주석 줄·줄 끝 주석은 코드가 아니다
      const code = line.replace(/^\s*(\*|\/\*|\/\/).*$/, '').replace(/\/\/.*$/, '');
      const n = (code.match(USD_EQ) ?? []).length;
      if (n > 0) counts[f.path] = (counts[f.path] ?? 0) + n;
    }
  }
  return counts;
}

/**
 * 허용 목록 — **최소**로 둔다. 항목마다 그 비교가 `kis.getBalances()` 의 USD 행을 "현금 값으로" 읽지 않는 이유.
 */
const ALLOWED: Record<string, number> = {
  // `cash.USD`(known) 로 **이 라우트가 직접 합성한** 표시용 현금 행을 HoldingView 로 바꾸는 분기. 잔고 배열의 USD 를 읽는 것이 아니다.
  'app/api/portfolio/route.ts': 1,
  // 방어적 건너뜀(`continue`) — Facade 가 이미 걸러 내지만, 섞여 들어와도 평가액에 넣지 않는다.
  'lib/safety/portfolio-total.ts': 1,
  // 보유 수량 맵에서 현금 행을 건너뜀(`continue`). 값을 읽지 않는다.
  'lib/strategy/engine.ts': 1,
  // 스냅샷 `positions` 의 USD 행 판별(전환 규칙 E) — `Balance[]` 가 아니라 크론이 기록한 행이다.
  'lib/safety/kill-switch.ts': 1,
  // T-080 — 크론이 기록한 스냅샷 `positions` 의 USD 행 판별(가려진 USD 이월 보정 순수 모듈의 `isUsd`). `kill-switch.ts` 의 `isUsdRow` 와
  // 같은 식이며 `Balance[]` 가 아니다. 둘을 합치지 않는 이유: 순수 모듈은 db·notify 를 import 하는 `kill-switch.ts` 에서 가져올 수 없고,
  // 감사가 끝난 규칙 E 코드를 이 task 에서 옮기지 않기 위해서다(hidden-usd-carry.ts `isUsd` 주석).
  'lib/safety/hidden-usd-carry.ts': 1,
  // `/api/portfolio` 응답(위에서 합성한 행)의 표시 라벨 두 곳.
  'components/dashboard/Dashboard.tsx': 2,
  // 주문 요청(`OrderRequest.currency`)의 통화 — 잔고와 무관.
  'lib/safety/order-limits.ts': 1,
  // 목표가 표시 통화 인자 — 잔고와 무관.
  'lib/research/pattern/price-targets.ts': 1,
  // T-074 원장 통화(닫힌 유니온 'KRW' | 'USD') 판별 단일 함수 `isUsd` — 원장 기록·검증·표기의 USD 분기가 모두 이 한 곳을 거친다. 잔고 배열 아님.
  'lib/ledger/rules.ts': 1,
  // T-074 크론이 기록한 스냅샷 `positions` 의 USD 행(달러 예수금) 판독 — `kill-switch.ts` 와 같은 성격, `Balance[]` 가 아니다.
  'lib/ledger/snapshots.ts': 1,
};

/** `.get('USD')`·`.has('USD')`·`new Set([... 'USD' ...])` — Map·Set 조회로 USD 행을 고르는 모양(따옴표 종류 무관). */
const USD_LOOKUP = /\.(?:get|has)\(\s*['"`]USD['"`]\s*\)|new Set\(\s*\[[^\]]*['"`]USD['"`][^\]]*\]\s*\)/g;

/**
 * 허용 목록 — Map·Set 조회. 항목마다 그것이 `kis.getBalances()` 의 잔고 배열이 아니라 **크론이 기록한 스냅샷 positions** 를 읽는 이유.
 */
const ALLOWED_LOOKUP: Record<string, number> = {
  // T-041 스냅샷 positions 의 현금 행(KRW·USD) 판별 집합 `CASH_CURRENCIES` — 구성 비교·가려진 USD 이월·T-108 보유 목록이 같이 쓴다.
  'lib/safety/snapshot-composition.ts': 1,
  // T-108 B7 신규 매수 가능 — 최신 스냅샷 positions 의 USD 현금 행(T-056 이 기록)을 `cash.get('USD')` 로 읽는다(평가액 합산 1·예수금 1).
  //   행이 없으면 unknown(usd_cash_unknown) 이고 0 으로 바꾸지 않는다. 잔고 배열을 읽지 않는다(KIS 호출 0).
  'lib/ops/metrics/live-set.ts': 2,
};

describe('🔴 USD 예수금 경계 — 잔고 배열에서 USD 를 골라 읽는 새 지점이 생기면 실패한다', () => {
  test('같음 비교 위치·개수가 허용 목록과 정확히 같다', () => {
    expect(usdEqualityCounts()).toEqual(ALLOWED);
  });

  test("`find(...'USD'...)` 로 USD 행을 찾는 코드가 없다 (예전 크론·시장 현황·한도의 모양)", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const [i, line] of f.text.split('\n').entries()) {
        const code = line.replace(/^\s*(\*|\/\*|\/\/).*$/, '').replace(/\/\/.*$/, '');
        if (/\.find\([^)]*['"`]USD['"`]/.test(code)) offenders.push(`${f.path}:${i + 1}  ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * (T-108 Reviewer R-DATA Minor-a) 같음 비교 말고 **Map·Set 조회**로 USD 행을 고르는 지점도 파일·개수로 고정한다 —
   * `.get('USD')`·`.has('USD')`, `'USD'` 를 담은 `new Set([...])`(현금 행 판별 집합). 새 지점이 생기면 실패한다.
   */
  test('Map·Set 로 USD 행을 고르는 위치·개수가 허용 목록과 정확히 같다', () => {
    const counts: Record<string, number> = {};
    for (const f of FILES) {
      for (const line of f.text.split('\n')) {
        const code = line.replace(/^\s*(\*|\/\*|\/\/).*$/, '').replace(/\/\/.*$/, '');
        const n = (code.match(USD_LOOKUP) ?? []).length;
        if (n > 0) counts[f.path] = (counts[f.path] ?? 0) + n;
      }
    }
    expect(counts).toEqual(ALLOWED_LOOKUP);
  });

  test('Map·Set 패턴 자기 점검', () => {
    const hit = (s: string) => (s.match(USD_LOOKUP) ?? []).length;
    expect(hit("snap.cash.get('USD')")).toBe(1);
    expect(hit('byCur.has("USD")')).toBe(1);
    expect(hit("new Set(['KRW', 'USD'])")).toBe(1);
    expect(hit("cash.get('KRW')")).toBe(0);
    expect(hit("m.get('USD_KRW')")).toBe(0);
  });

  test('패턴 자기 점검 — 잡아야 할 모양은 잡고, 제외 비교는 세지 않는다', () => {
    const hit = (s: string) => (s.match(USD_EQ) ?? []).length;
    expect(hit("balances.find(b => b.currency === 'USD')")).toBe(1);
    expect(hit('if (b.currency=="USD") x')).toBe(1);
    expect(hit("'USD' === row.currency")).toBe(1);
    expect(hit("(p as { currency?: unknown }).currency === 'USD'")).toBe(1);
    expect(hit("b.currency !== 'USD'")).toBe(0);
    expect(hit("b.currency != 'USD'")).toBe(0);
    expect(hit("req.market === 'USD_KRW'")).toBe(0);
  });
});

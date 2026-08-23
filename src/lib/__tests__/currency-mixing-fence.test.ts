/**
 * 🔴 T-035 회귀 봉인 — **KRW 와 USD 를 섞을 수 있는 코드 지점을 목록으로 고정한다.**
 *
 * ## 왜 이 테스트가 존재하는가
 *
 * T-034 는 "환산 코드가 아예 없으면 통화를 섞을 경로 자체가 존재하지 않는다"는 **구조적 차단**을
 * 택했다. T-035 가 진입가·현재가·투자금에 한해 환산을 도입하면서 그 안전망이 약해졌다.
 * 대체 안전망이 이 테스트다 — 환산·USD 원가에 손대는 파일이 **하나라도 늘어나면 즉시 실패**한다.
 * 새 지점이 정말 필요하면 아래 목록에 추가하면 되지만, 그 순간 리뷰 대상이 된다.
 *
 * 값의 정확성(환율 비례·폴백)은 `display-amount.test.ts` 가 따로 고정한다. 여기는 **경계**만 본다.
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
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = walk(SRC).map((f) => ({
  path: relative(SRC, f).split(sep).join('/'),
  text: readFileSync(f, 'utf8'),
}));

function filesContaining(needle: string): string[] {
  return FILES.filter((f) => f.text.includes(needle)).map((f) => f.path).sort();
}

describe('🔴 통화 환산 경계 — 새 지점이 생기면 실패한다', () => {
  test('KRW → USD 환산은 `display-amount.ts` 안에서만 일어난다', () => {
    // 환율(= USD/KRW 비)을 만들 수 있는 유일한 함수. 다른 파일이 부르면 여기 목록에 나타난다.
    expect(filesContaining('usdPerKrwFromQuote')).toEqual(['lib/display-amount.ts']);
  });

  test('환산 함수 호출부는 "표시값을 조립하는 곳" 두 군데뿐이다', () => {
    // 화면·리포트가 각각 자기 표시값을 만드는 지점. 판정·집계 모듈은 여기 없어야 한다.
    expect(filesContaining('toDisplayAmount(')).toEqual([
      'lib/display-amount.ts',
      'lib/reports/trade-report.ts',
      'lib/research/recommendation-view.ts',
    ]);
  });

  test('USD 원가(`priceUsd`)를 읽는 파일 목록이 고정돼 있다', () => {
    // 즐겨찾기 3종은 T-035 이전부터 USD 로 표시하던 별개 경로다(이번 작업 범위 밖).
    expect(filesContaining('priceUsd')).toEqual([
      'app/api/favorites/route.ts',
      'app/favorites/FavoritesPage.tsx',
      'app/favorites/[symbol]/FavoriteDetailPage.tsx',
      'lib/display-amount.ts',
      'lib/exchanges/kis-overseas.ts',
      'lib/exchanges/types.ts',
      'lib/reports/trade-report.ts',
    ].sort());
  });

  test('🔴 목표가(원통화)를 KRW 값과 직접 연산하는 줄이 없다', () => {
    /**
     * 캔들 통화 값(`asOfPrice`/`sellTarget`/`buyZone`/`atr14`/`expectedMove`)과
     * `*KRW` 로 끝나는 식별자가 **한 줄에서 산술·비교 연산자로 만나는지** 본다.
     * 이 둘이 만나야 하는 유일한 경우는 `targetVsEntryPct()` 처럼 **같은 통화끼리의 비**를
     * 곱하는 것뿐이고, 그건 무차원 비율끼리라 아래 패턴에 걸리지 않는다.
     */
    // 캔들 통화 값을 담은 식(`targets.sellTarget.price` 등)
    const CANDLE = String.raw`[\w.?[\]]*(?:asOfPrice|sellTarget|buyZone|atr14|expectedMove)[\w.?[\]]*`;
    // KRW 로 끝나는 식별자를 담은 식(`pos.entryPriceKRW` 등). 앞에 소문자를 요구해 문자열 'KRW' 제외
    const KRW = String.raw`[\w.?[\]]*[a-z]KRW\b`;
    // 피연산자 꼬리(`?? 0`·닫는 괄호)와 연산자 뒤 여는 괄호를 건너뛴다 —
    // `(a ?? 0) + (b ?? 0)` / `a < (b ?? 0)` 같은 흔한 형태를 놓치지 않기 위해서다.
    const TAIL = String.raw`(?:\s*\?\?\s*[-\w.]+)?[\s)]*`;
    const OP = String.raw`(?:[-+*/]|[<>]=?|===?|!==?)`;
    const HEAD = String.raw`[\s(!]*`;
    const mix = new RegExp(
      `(?:${CANDLE}${TAIL}\\s*${OP}\\s*${HEAD}${KRW})|(?:${KRW}${TAIL}\\s*${OP}\\s*${HEAD}${CANDLE})`,
    );

    const offenders: string[] = [];
    for (const f of FILES) {
      // 환산 모듈 자신은 두 통화를 아는 것이 존재 이유다 — 하지만 캔들 값은 다루지 않는다.
      for (const [i, line] of f.text.split('\n').entries()) {
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        if (mix.test(code)) offenders.push(`${f.path}:${i + 1}  ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

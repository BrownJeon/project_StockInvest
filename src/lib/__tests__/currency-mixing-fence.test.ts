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
    // T-068 stop-alert: 같은 틱 시세의 `price ÷ priceUsd` 로 표시용 환율만 만든다(알림 문구의 $ 표기). 판정(손절가 비교)은
    //   원화끼리(`priceKrw` vs `position_state.entry_price` 기반 손절가)이고 이 환율은 판정에 쓰이지 않는다.
    // T-169 (사용자 승인 2026-11-14 — 비서 채팅 B 범위 「달러 표기」): 읽기 전용 채팅 요약. KIS 해외 시세의 `price` 가 원화 환산값이라
    //   프롬프트에 달러를 적으려고 같은 틱의 `priceUsd` 를 담고 표시 글로만 쓴다(주문·판정·집계에 쓰지 않음 — 아래 T-169 시험이 고정).
    expect(filesContaining('priceUsd')).toEqual([
      'app/api/cron/stop-alert/route.ts',
      'app/api/favorites/route.ts',
      'app/favorites/FavoritesPage.tsx',
      'app/favorites/[symbol]/FavoriteDetailPage.tsx',
      'lib/chat/context-builder.ts',
      // T-169 Reviewer M1 (사용자 승인 2026-11-14 범위 안 — 읽기 전용 채팅 요청 검증): 클라이언트가 되돌려 보낸 첨부 종목의
      //   `priceUsd` 가 유한수·null 인지 타입만 검사한다(값을 계산·환산하지 않음 — 아래 T-169 시험이 고정).
      'lib/chat/request-guard.ts',
      'lib/display-amount.ts',
      'lib/exchanges/kis-overseas.ts',
      'lib/exchanges/types.ts',
      'lib/reports/trade-report.ts',
    ].sort());
  });

  test('(T-169) 채팅 쪽에서 priceUsd 를 읽는 파일은 context-builder.ts(표시용)·request-guard.ts(타입 검사)뿐이다', () => {
    // 위 목록 시험은 base 의 다른 미등록 파일 때문에 실패할 수 있어 T-169 추가분만 따로 고정한다
    expect(filesContaining('priceUsd').filter((p) => p.startsWith('lib/chat/'))).toEqual(['lib/chat/context-builder.ts', 'lib/chat/request-guard.ts']);
    // request-guard.ts — import 는 SymbolContext 타입 하나뿐, 거래소·환산·SQL·연산 없음(유한수 검사와 복사만)
    const guard = FILES.find((f) => f.path === 'lib/chat/request-guard.ts')!.text;
    expect([...guard.matchAll(/^import\b[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[0])).toEqual(["import type { SymbolContext } from './context-builder'"]);
    expect(guard).not.toMatch(/\bkis\b|fx|toDisplayAmount|usdPerKrwFromQuote|\b(INSERT|UPDATE|DELETE|SELECT)\b|priceUsd\s*[*\/+-]/);
    const src = FILES.find((f) => f.path === 'lib/chat/context-builder.ts')!.text;
    // import 는 시세 조회(kis 진입점)·지표 요약·같은 폴더 표기 도우미뿐 — 주문·안전장치·시그널·환산 모듈 없음
    expect([...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).sort())
      .toEqual(['./money-format', './symbol-resolver', '@/lib/exchanges/kis', '@/lib/strategy/ai-filter']);
    // kis 진입점은 읽기 함수 두 개만 부른다(createOrder 등 없음)
    expect([...new Set([...src.matchAll(/\bkis\.(\w+)/g)].map((m) => m[1]))].sort()).toEqual(['getCandles', 'getTicker']);
    expect(src).not.toMatch(/submitOrder|createOrder|toDisplayAmount|usdPerKrwFromQuote|\b(INSERT|UPDATE|DELETE|SELECT)\b/);
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

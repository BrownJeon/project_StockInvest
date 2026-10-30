/**
 * T-128 A2 — 사유 사전 단일 출처(`src/lib/ops/reason-dictionary.ts`) · **서버가 내는 사유 코드 ↔ 사전 키 일치 시험**.
 *
 * 규칙: 서버 소스가 내는 사유 코드마다 ① 사전에 한국어 말이 있거나 ② 아래 `KNOWN_UNMAPPED` 에 **이유와 함께** 있어야 한다.
 * 비교는 정확 일치(`toEqual`)라 양쪽을 다 막는다 — 사전에도 허용 목록에도 없는 새 코드가 생기면 실패하고, 허용 목록에 남은 코드가
 * 더는 나오지 않거나 사전에 말이 생기면 그 줄을 지우라고 실패한다. 허용 목록 = 지금 화면에 영문 코드(또는 「사유 코드 x」)로 보이는
 * 목록이기도 하다 — 한국어 문구는 T-130(데모 승인)이 정한다. 이 시험은 새 문구를 만들지 않는다.
 *
 * 「서버가 내는 코드」는 소스를 TypeScript AST 로 읽어 모은다(코드가 생기는 자리 — 아래 각 수집기 주석). 정규식 한 줄로 긁지 않는 이유:
 * 삼항(`a ? 'vol_panic' : 'vol_block'`)·`??` 기본값·변수 경유가 섞여 있다. 변수로만 오는 동적 코드는 그 출처 타입(OpsErrorCode)만 따라간다.
 * 수집기가 고장 나 빈 집합이 되어 통과하지 않게, 영역마다 반드시 잡혀야 하는 코드(sentinel)를 함께 단언한다.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

import * as dict from '@/lib/ops/reason-dictionary';
import * as reasonCopy from '@/components/ops/reason-copy';
import { analysisItem } from '@/lib/ops/metrics/activity';
import { activitySub } from '@/components/home/ActivitySection';

const SRC = join(__dirname, '..', '..', '..');   // <repo>/src
const parse = (rel: string) => ts.createSourceFile(rel, readFileSync(join(SRC, rel), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function visit(n: ts.Node, f: (n: ts.Node) => void): void { f(n); ts.forEachChild(n, (c) => visit(c, f)); }

/** 식이 낼 수 있는 문자열 리터럴 — 리터럴 · 삼항 두 갈래 · `??`/`||` 양쪽 · 괄호 · `as` · 같은 파일의 const 변수(초기식) */
function literalsOf(e: ts.Expression | undefined, sf: ts.SourceFile): string[] {
  if (!e) return [];
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) return literalsOf(e.expression, sf);
  if (ts.isConditionalExpression(e)) return [...literalsOf(e.whenTrue, sf), ...literalsOf(e.whenFalse, sf)];
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    return [...literalsOf(e.left, sf), ...literalsOf(e.right, sf)];
  }
  if (ts.isArrayLiteralExpression(e)) return e.elements.flatMap((x) => literalsOf(x as ts.Expression, sf));
  if (ts.isIdentifier(e)) {
    const out: string[] = [];
    visit(sf, (n) => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === e.text) out.push(...literalsOf(n.initializer, sf)); });
    return out;
  }
  return [];
}

const calleeName = (c: ts.CallExpression): string =>
  ts.isIdentifier(c.expression) ? c.expression.text : ts.isPropertyAccessExpression(c.expression) ? c.expression.getText() : '';
const propName = (p: ts.ObjectLiteralElementLike): string | null =>
  ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
const CODE = /^[a-z][a-z0-9_]*$/;
const uniq = (xs: string[]) => [...new Set(xs.filter((x) => CODE.test(x)))].sort();

/** 장마감 분석 사유(`job_run_log.degraded_reason` → 화면 skipReason·failReason): 엔진의 `skipped: '<코드>'` + 실행 분류기의 degraded 사유. */
function analysisCodes(): string[] {
  const out: string[] = [];
  for (const rel of ['lib/strategy/post-market-overseas.ts', 'lib/strategy/post-market-engine.ts']) {
    const sf = parse(rel);
    visit(sf, (n) => { if (ts.isPropertyAssignment(n) && propName(n) === 'skipped') out.push(...literalsOf(n.initializer, sf)); });
  }
  const jrl = parse('lib/strategy/records/job-run-log.ts');
  visit(jrl, (n) => {
    if (ts.isCallExpression(n) && calleeName(n) === 'res' && literalsOf(n.arguments[0], jrl).includes('degraded')) out.push(...literalsOf(n.arguments[2], jrl));
  });
  return uniq(out);
}

/** 주문 차단·거부 사유(`orders.blocked_by`): 송신 관문의 `blockedBy:`·`markBlocked(_, 사유)`·`categorizeRejectReason` 반환 + 한도 검사의 `reason:`. */
function orderCodes(): string[] {
  const out: string[] = [];
  const dry = parse('lib/safety/dry-run.ts');
  visit(dry, (n) => {
    if (ts.isPropertyAssignment(n) && propName(n) === 'blockedBy') out.push(...literalsOf(n.initializer, dry));
    if (ts.isCallExpression(n) && calleeName(n) === 'markBlocked') out.push(...literalsOf(n.arguments[1], dry));
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'categorizeRejectReason') {
      visit(n, (r) => { if (ts.isReturnStatement(r)) out.push(...literalsOf(r.expression, dry)); });
    }
  });
  const lim = parse('lib/safety/order-limits.ts');
  visit(lim, (n) => { if (ts.isPropertyAssignment(n) && propName(n) === 'reason') out.push(...literalsOf(n.initializer, lim)); });
  return uniq(out);
}

/** 안전 상태 읽기 오류(`SafetyStateDTO.errors`): `errors.push(…)` 인자 + `errors: [...]`. */
function safetyErrorCodes(): string[] {
  const out: string[] = [];
  const sf = parse('lib/ops/metrics/safety-state.ts');
  visit(sf, (n) => {
    if (ts.isCallExpression(n) && calleeName(n) === 'errors.push') n.arguments.forEach((a) => out.push(...literalsOf(a, sf)));
    if (ts.isPropertyAssignment(n) && propName(n) === 'errors') out.push(...literalsOf(n.initializer, sf));
  });
  return uniq(out);
}

/**
 * 지표 「조회 실패」 사유(`state:'error'` 의 reason — 화면 `! 조회 실패 · {reason}`): 지표 모듈의 `errorMetric(사유)` ·
 * `metric('error', 값, 시각, 사유)` · `row(원천, 'error', …, { reason })` · `{ state: 'error', reason }` + 동적 코드(OpsErrorCode·errorCodeOf).
 */
const METRIC_FILES = readdirSync(join(SRC, 'lib/ops/metrics')).filter((f) => f.endsWith('.ts')).map((f) => `lib/ops/metrics/${f}`);
function metricErrorCodes(): string[] {
  const out: string[] = [];
  for (const rel of METRIC_FILES) {
    const sf = parse(rel);
    visit(sf, (n) => {
      if (ts.isCallExpression(n)) {
        const name = calleeName(n);
        if (name === 'errorMetric') out.push(...literalsOf(n.arguments[0], sf));
        if (name === 'metric' && literalsOf(n.arguments[0], sf).includes('error')) out.push(...literalsOf(n.arguments[3], sf));
        if (name === 'row' && literalsOf(n.arguments[1], sf).includes('error')) {
          const extra = n.arguments[3];
          if (extra && ts.isObjectLiteralExpression(extra)) extra.properties.forEach((p) => { if (propName(p) === 'reason') out.push(...literalsOf((p as ts.PropertyAssignment).initializer, sf)); });
        }
      }
      if (ts.isObjectLiteralExpression(n)) {
        const st = n.properties.find((p) => propName(p) === 'state') as ts.PropertyAssignment | undefined;
        const rs = n.properties.find((p) => propName(p) === 'reason') as ts.PropertyAssignment | undefined;
        if (st && rs && literalsOf(st.initializer, sf).includes('error')) out.push(...literalsOf(rs.initializer, sf));
      }
    });
    // 동적 코드의 출처 — `type OpsErrorCode = 'a' | 'b'` 와 `errorCodeOf` 의 반환 리터럴
    visit(sf, (n) => {
      if (ts.isTypeAliasDeclaration(n) && n.name.text === 'OpsErrorCode') {
        visit(n.type, (t) => { if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) out.push(t.literal.text); });
      }
      if (ts.isFunctionDeclaration(n) && n.name?.text === 'errorCodeOf') visit(n, (r) => { if (ts.isReturnStatement(r)) out.push(...literalsOf(r.expression, sf)); });
    });
  }
  return uniq(out);
}

/**
 * 허용 목록 — 사전에 말이 없는 채로 서버가 내는 코드. **지금 화면에는 영문 코드(또는 「사유 코드 x」)로 보인다.**
 * 한국어 문구는 T-130(데모 승인)이 정한다 — 그때 사전에 넣고 이 줄을 지운다(지우지 않으면 이 시험이 실패한다).
 */
const KNOWN_UNMAPPED: Record<'analysis' | 'order' | 'safetyError' | 'metricError', Record<string, string>> = {
  analysis: {
    // 국내 장마감 분석이 degraded 로 끝날 때의 사유 — 지금 화면은 degraded 실행의 사유를 표시하지 않는다(A1 은 값, 최근 활동은 건수 부제).
    // 옛 서버 전용 사전에 「참고 자료 조회 실패」·「대상 종목 없음」이 있었으나 화면에 보인 적이 없다 — T-130 후보 문구.
    rag_fail: 'degraded 사유 — 화면 미표시(T-130 문구 후보 「참고 자료 조회 실패」)',
    no_symbols: 'degraded 사유 — 화면 미표시(T-130 문구 후보 「대상 종목 없음」)',
  },
  order: {
    // 변동성 가드가 주문을 막을 때 orders.blocked_by 에 남는 값(dry-run.ts markBlocked) — 확인 필요 「주문 차단」 부제에 「사유 코드 vol_*」 로 보인다.
    vol_panic: '변동성 가드 패닉 차단 — 지금 「사유 코드 vol_panic」 표시(T-130)',
    vol_block: '변동성 가드 차단 — 지금 「사유 코드 vol_block」 표시(T-130)',
  },
  safetyError: {
    // 판독기 값과 같은 요청의 DB 행이 다를 때(safety-state.ts crossCheck) — 확인 필요 「안전 상태」 부제에 「사유 코드 …」 로 보인다.
    dry_run_mismatch: '실거래여부 판독기↔DB 불일치 — 지금 「사유 코드 dry_run_mismatch」 표시(T-130)',
    kill_switch_mismatch: '모든거래차단 판독기↔DB 불일치 — 지금 「사유 코드 kill_switch_mismatch」 표시(T-130)',
  },
  // 지표 조회 실패 사유는 사전 자체가 없다 — 화면 `! 조회 실패 · {code}`(홈 MetricReason·분석 stateChip)에 영문 코드 그대로. 전부 T-130.
  metricError: {
    all_sources_failed: '데이터 원천 7개를 하나도 읽지 못함(홈 A4)',
    exit_switch_db_error: '청산 엔진 스위치 읽기 실패(홈 청산 줄 — 안전 상태 오류 사전의 같은 코드와 별개 자리)',
    balances_unknown: '청산 엔진 마지막 평가가 잔고 조회 실패(홈 청산 가동 줄 「! 조회 실패 · balances_unknown」)',
    db_error: 'DB 조회 실패 분류 코드(읽기 래퍼·원천 행)',
    evaluated_zero: '장마감 분석 평가 종목 0 — 오류로 표시(A1)',
    holdings_error: '보유 조회 실패(청산 구역)',
    internal_error: '분류하지 못한 서버 예외(errorCodeOf)',
    not_migrated: '표 없음(1146) 이 error 로 오는 자리(섹션 예외·연구 수 등 — prep 으로 바꾼 곳은 해당 없음)',
    not_select: '읽기 전용 래퍼가 막은 문장(코드 결함 신호)',
    run_failed: '실행 기록 status=failed(A1)',
    timeout: '쿼리 상한·요청 예산 초과',
  },
};

const DICTS = { analysis: dict.ANALYSIS_REASON_KO, order: dict.ORDER_REASON_KO, safetyError: dict.SAFETY_ERROR_KO, metricError: {} as Readonly<Record<string, string>> };

describe('단일 출처 — 화면 경로는 다시 내보내기만', () => {
  test('`@/components/ops/reason-copy` 의 내보내기 = 사전 모듈의 같은 객체(두 벌이 아니다)', () => {
    for (const k of ['ORDER_REASON_KO', 'orderReasonText', 'ANALYSIS_REASON_KO', 'analysisReasonText', 'skipReasonCode', 'skipText', 'SAFETY_ERROR_KO', 'safetyErrorsText'] as const) {
      expect(reasonCopy[k]).toBe(dict[k]);
    }
    expect(Object.keys(reasonCopy).sort()).toEqual(Object.keys(dict).sort());
  });
  test('서버 활동 모듈에 별도 사전이 없다(옛 REASON_KO 제거) — 사전 모듈을 import 한다', () => {
    const src = readFileSync(join(SRC, 'lib/ops/metrics/activity.ts'), 'utf8');
    expect(src).not.toMatch(/\bconst\s+REASON_KO\b/);   // 주석의 옛 이름 언급은 허용 — 사전 선언이 없어야 한다
    expect(src).toMatch(/from '@\/lib\/ops\/reason-dictionary'/);
  });
});

describe('서버가 내는 사유 코드 ↔ 사전 키 (허용 목록 정확 일치)', () => {
  const SENTINEL = {
    analysis: ['weekend', 'overseas_disabled', 'no_new_session', 'fx_unknown', 'candle_scale_suspect', 'rag_fail'],
    order: ['kill_switch', 'dry_run', 'validation_gate', 'order_limit', 'daily_limit', 'symbol_not_allowed', 'kis_5xx', 'network_error', 'vol_panic', 'invalid_side'],
    safetyError: ['db_unreachable', 'strategies_error', 'kill_switch_mismatch', 'notify_read_error'],
    metricError: ['balances_unknown', 'run_failed', 'all_sources_failed', 'timeout', 'not_migrated', 'db_error', 'internal_error'],
  };
  const EMITTED = { analysis: analysisCodes(), order: orderCodes(), safetyError: safetyErrorCodes(), metricError: metricErrorCodes() };

  test.each(Object.keys(SENTINEL) as Array<keyof typeof SENTINEL>)('%s — 수집기가 실제로 코드를 모은다(빈 검사 방지)', (d) => {
    expect(EMITTED[d]).toEqual(expect.arrayContaining(SENTINEL[d]));
  });

  test.each(['analysis', 'order', 'safetyError', 'metricError'] as const)('%s — 서버 코드마다 사전에 말이 있거나 허용 목록에 있다', (d) => {
    const unmapped = EMITTED[d].filter((c) => !(c in DICTS[d]));
    expect(unmapped).toEqual(Object.keys(KNOWN_UNMAPPED[d]).sort());
    for (const c of Object.keys(KNOWN_UNMAPPED[d])) expect(c in DICTS[d]).toBe(false);   // 사전에 생기면 허용 목록에서 지운다
  });

  test('metricError — 사전이 없으니 허용 목록 = 서버가 내는 코드 전부(새 코드가 생기면 위 시험이 알린다)', () => {
    expect(Object.keys(DICTS.metricError)).toEqual([]);
    expect(Object.keys(KNOWN_UNMAPPED.metricError).sort()).toEqual(EMITTED.metricError);
  });
});

describe('서버 최근 활동 부제 = 화면이 그리는 글자 (사전 하나 — 표기가 갈리지 않는다)', () => {
  const row = (status: string, degraded: string | null) =>
    ({ market: 'overseas', status, started_at: new Date('2026-10-30T23:00:00Z'), counts_json: null, degraded_reason: degraded });
  const codes = [...Object.keys(dict.ANALYSIS_REASON_KO), ...analysisCodes(), 'brand_new_code'];
  test.each([
    ...codes.map((c) => ['skipped', `skip:${c}`] as const), ['skipped', 'skip'] as const, ['skipped', null] as const,
    ...codes.map((c) => ['failed', c] as const), ['failed', null] as const,
  ])('%s · %s', (status, degraded) => {
    const it = analysisItem(row(status, degraded));
    expect(it).not.toBeNull();
    expect(activitySub(it!)).toBe(it!.sub);
  });
  test('보이는 글자는 예전 화면과 같다(사전 문구 불변의 표본)', () => {
    expect(analysisItem(row('skipped', 'skip:overseas_disabled'))!.sub).toBe('건너뜀 · 해외 장마감 후 분석 꺼짐');
    expect(analysisItem(row('skipped', 'skip:us_session_open'))!.sub).toBe('건너뜀 · 미국 장 진행 중');
    expect(analysisItem(row('failed', 'rag_fail'))!.sub).toBe('실행 실패 · 사유 코드 rag_fail');
    expect(analysisItem(row('skipped', null))!.sub).toBe('건너뜀 · 사유 모름');
  });
});

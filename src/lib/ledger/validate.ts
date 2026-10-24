/**
 * T-074 자금 이동 원장 — 입력 검증 (순수, 서버·클라이언트 공용).
 *
 * 승인 데모의 `parseAmt`·`validateEntry` 를 옮겼다. **화면과 서버가 같은 함수로 검사한다**(Designer 3절: 클라이언트 검증은 UX 일 뿐,
 * 서버가 같은 규칙을 다시 검사 — 서버는 이 결과를 422 필드별 code 로 돌려준다).
 * 문구는 데모 그대로다. 데모와 다른 점:
 *  1. 필드 이름이 API 이름이다(데모 when·amt·from·to → occurredAt·amount·amount(낸 금액)·counterAmount(받은 금액)).
 *  2. 환전 방향은 데모 `dir`(ku/uk) 대신 `currency`(낸 통화)·`counterCurrency`(받은 통화)로 받는다.
 *  3. 서버만 받을 수 있는 이상 입력을 더 막는다 — 종류·통화 값, 같은 통화 환전, 금액 상한(`RULE.maxKrw/maxUsd`, DECIMAL(18,2) 안전 범위),
 *     메모 200자(코드포인트, DDL VARCHAR(200) 과 같은 셈), 숫자가 아닌 JSON 값.
 *  4. 시각은 분 단위 'YYYY-MM-DD HH:mm' 한 문자열로 받는다(데모는 날짜·시각 칸 두 개 — 화면이 합쳐 보낸다).
 *  5. 기준 현금 확인값(`parseCash`)은 0 을 허용한다 — 데모 `baseVals` 는 `parseAmt` 를 그대로 써서 0원 현금을 거부했는데,
 *     원화 현금 0원·달러 현금 $0 은 실제로 있을 수 있는 확인값이다.
 */
import type {
  Currency, EntryField, EntryKind, FieldError, LedgerEntryView, LedgerWarning,
} from './types';
import { isUsd, RULE, type LedgerRules } from './rules';
import { floorMinute, formatKstMinute, formatKstShort, HOUR_MS, parseKstMinute, parseKstWall } from './kst';
import { exchangeRate, sameAmount, usdToKrw } from './compute';
import { fmtAmount, fmtRate, fmtWon } from './korean-amount';

export type AmountResult = { empty: true } | { error: FieldError } | { value: number };

const MSG = {
  sign: '부호는 넣지 않습니다. 나간 돈이면 위에서 종류를 ‘출금’으로 고르세요.',
  format: '숫자만 넣어 주세요.',
  amount: '0보다 큰 금액을 넣어 주세요.',
  krwDecimals: '원화는 1원 단위로 넣어 주세요(소수점 없음).',
  usdDecimals: '달러는 센트(소수 둘째 자리)까지만 넣어 주세요.',
  max: '금액이 너무 큽니다. 자릿수와 통화(원·달러)를 확인하세요.',
} as const;

function amountCore(raw: unknown, currency: Currency, allowZero: boolean, rules: LedgerRules): AmountResult {
  if (raw == null) return { empty: true };
  if (typeof raw !== 'string' && typeof raw !== 'number') return { error: { code: 'format', message: MSG.format } };
  const t = String(raw).replace(/\s/g, '');
  if (t === '') return { empty: true };
  if (/^[-−]/.test(t)) return { error: { code: 'sign', message: MSG.sign } };
  // 쉼표는 천 단위 자리일 때만(1,000,000 · 1,250.40) — 118,60·1,5·1,00,0·12,34.56 은 오해석하지 않고 거부한다(Reviewer L1)
  if (t.includes(',') && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return { error: { code: 'format', message: MSG.format } };
  const s = t.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: { code: 'format', message: MSG.format } };
  const v = Number(s);
  if (allowZero ? !(v >= 0) : !(v > 0)) return { error: { code: 'amount', message: MSG.amount } };
  if (currency === 'KRW' && s.indexOf('.') >= 0) return { error: { code: 'decimals', message: MSG.krwDecimals } };
  if (isUsd(currency) && /\.\d{3,}$/.test(s)) return { error: { code: 'decimals', message: MSG.usdDecimals } };
  if (v > (currency === 'KRW' ? rules.maxKrw : rules.maxUsd)) return { error: { code: 'max', message: MSG.max } };
  return { value: v };
}

/** 금액 입력 해석 — 데모 `parseAmt`. 공백·천 단위 쉼표 허용(자리가 틀린 쉼표는 거부), 부호 거부, 0 이하 거부, 원 소수 금지, 달러 2자리까지 */
export function parseAmount(raw: unknown, currency: Currency, rules: LedgerRules = RULE): AmountResult {
  return amountCore(raw, currency, false, rules);
}

/** 기준 현금 확인값 해석 — parseAmount 와 같되 0 허용 */
export function parseCash(raw: unknown, currency: Currency, rules: LedgerRules = RULE): AmountResult {
  return amountCore(raw, currency, true, rules);
}

export function isEntryKind(v: unknown): v is EntryKind {
  return v === 'deposit' || v === 'withdrawal' || v === 'exchange';
}

export function isCurrency(v: unknown): v is Currency {
  return v === 'KRW' || v === 'USD';
}

/** 코드포인트 수(이모지 1자 = 1) — MariaDB utf8mb4 VARCHAR 의 글자 수와 같다 */
export function codePointLength(s: string): number {
  return Array.from(s).length;
}

/** 메모·사유 같은 짧은 글. 비우면 null. required 면 비울 수 없다 */
export function parseShortText(
  raw: unknown,
  opts: { required?: boolean; label: string; max?: number },
): { value: string | null } | { error: FieldError } {
  const max = opts.max ?? RULE.memoMax;
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {
    return opts.required ? { error: { code: 'required', message: `${opts.label}를 넣어 주세요.` } } : { value: null };
  }
  if (typeof raw !== 'string') return { error: { code: 'format', message: `${opts.label}는 글자로 넣어 주세요.` } };
  const v = raw.trim();
  if (codePointLength(v) > max) return { error: { code: 'too_long', message: `${opts.label}는 ${max}자까지 넣을 수 있습니다.` } };
  return { value: v };
}

/** 폼이 만든 이중 제출 방지 키 — UUID(36자) 권장, 영숫자·-·_ 8~36자 */
export function isClientEntryId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,36}$/.test(v);
}

/** 후보 키 `${스냅샷 id}-${통화}` */
export function isCandidateKey(v: unknown): v is string {
  return typeof v === 'string' && /^[1-9]\d{0,17}-(KRW|USD)$/.test(v);
}

const KIND_LABEL: Record<EntryKind, string> = { deposit: '입금', withdrawal: '출금', exchange: '환전' };

/** '입금 1,000,000원' / '환전 1,260,000원 → $1,000.00' (데모 `entryOne`) */
export function entryOneLine(e: Pick<LedgerEntryView, 'kind' | 'currency' | 'amount' | 'counterCurrency' | 'counterAmount'>): string {
  if (e.kind === 'exchange' && e.counterCurrency && e.counterAmount != null) {
    return `${KIND_LABEL.exchange} ${fmtAmount(e.currency, e.amount)} → ${fmtAmount(e.counterCurrency, e.counterAmount)}`;
  }
  return `${KIND_LABEL[e.kind]} ${fmtAmount(e.currency, e.amount)}`;
}

export interface EntryDraftInput {
  kind: unknown;
  /** 'YYYY-MM-DD HH:mm' KST */
  occurredAt: unknown;
  currency: unknown;
  amount: unknown;
  counterCurrency?: unknown;
  counterAmount?: unknown;
  memo?: unknown;
  /** 정정 대상 id — 24시간 같은 금액 경고에서 뺀다 */
  targetId?: number | null;
}

export interface ValidationContext {
  /** 지금(KST 벽시계 ms) */
  nowMs: number;
  /** 기준 시각(KST 벽시계 ms) — 없으면 기준 이전 검사를 하지 않는다 */
  baselineAtMs: number | null;
  /** 최신 스냅샷 — 큰 금액·환율 경고용 */
  snapshot: { totalKrw: number; fx: number | null } | null;
  /** 24시간 같은 금액 경고용 */
  entries: readonly Pick<LedgerEntryView, 'id' | 'kind' | 'currency' | 'amount' | 'counterCurrency' | 'counterAmount' | 'occurredAt' | 'void'>[];
  rules?: LedgerRules;
}

export interface NormalizedEntry {
  kind: EntryKind;
  occurredAt: string;
  occurredAtMs: number;
  currency: Currency;
  amount: number;
  counterCurrency: Currency | null;
  counterAmount: number | null;
  memo: string | null;
}

export interface EntryValidation {
  /** 필드별 오류 (기준 이전은 여기 넣지 않고 blocked 로 따로 — 데모와 같다) */
  errors: Partial<Record<EntryField, FieldError>>;
  /** 기준 시각 이전 — 저장 차단 */
  blocked: boolean;
  blockError: FieldError | null;
  warnings: LedgerWarning[];
  /** 고칠 곳 수 = 오류 수 + (차단 1) — 데모 `o.n` */
  count: number;
  /** count 가 0 일 때만 */
  value: NormalizedEntry | null;
  /** 환전: 적용 환율·앱 환율 대비 %·비용(추정) / 입출금: 원화 환산(참고) */
  derived: { rate: number | null; diffPct: number | null; costKrw: number | null; krw: number | null };
}

/** 서버 422 용 — 기준 이전 차단을 occurredAt 필드 오류로 합친다 */
export function toFieldErrors(v: EntryValidation): Partial<Record<EntryField, FieldError>> {
  return v.blocked && v.blockError && !v.errors.occurredAt ? { ...v.errors, occurredAt: v.blockError } : { ...v.errors };
}

/** 입출금·환전 기록 검증 — 데모 `validateEntry` */
export function validateEntryInput(d: EntryDraftInput, ctx: ValidationContext): EntryValidation {
  const rules = ctx.rules ?? RULE;
  const errors: EntryValidation['errors'] = {};
  const warnings: LedgerWarning[] = [];
  const derived: EntryValidation['derived'] = { rate: null, diffPct: null, costKrw: null, krw: null };
  let blocked = false;
  let blockError: FieldError | null = null;

  const kind = isEntryKind(d.kind) ? d.kind : null;
  if (!kind) errors.kind = { code: 'kind', message: '종류(입금·출금·환전)를 골라 주세요.' };

  const t = parseKstMinute(d.occurredAt);
  if (t == null) {
    const empty = d.occurredAt == null || d.occurredAt === '';
    errors.occurredAt = { code: empty ? 'required' : 'format', message: '날짜와 시각을 넣어 주세요.' };
  } else if (t > floorMinute(ctx.nowMs)) {
    errors.occurredAt = { code: 'future', message: `아직 오지 않은 시각입니다. 지금(${formatKstShort(ctx.nowMs)}) 이전으로 넣어 주세요.` };
  } else if (ctx.baselineAtMs != null && t <= ctx.baselineAtMs) {
    blocked = true;
    blockError = { code: 'before_baseline', message: `기준 시각(${formatKstShort(ctx.baselineAtMs)}) 이전이라 기록할 수 없습니다.` };
  }

  const currency = isCurrency(d.currency) ? d.currency : null;
  if (!currency) errors.currency = { code: 'currency', message: '통화(원화·달러)를 골라 주세요.' };

  let amount: number | null = null;
  let counterCurrency: Currency | null = null;
  let counterAmount: number | null = null;

  if (kind === 'exchange') {
    if (!isCurrency(d.counterCurrency)) {
      errors.counterCurrency = { code: 'currency', message: '받은 통화(원화·달러)를 골라 주세요.' };
    } else if (currency && d.counterCurrency === currency) {
      errors.counterCurrency = { code: 'same_currency', message: '낸 통화와 받은 통화가 달라야 합니다.' };
    } else {
      counterCurrency = d.counterCurrency;
    }
    if (currency) {
      const a = parseAmount(d.amount, currency, rules);
      if ('empty' in a) errors.amount = { code: 'required', message: '낸 금액을 넣어 주세요.' };
      else if ('error' in a) errors.amount = a.error;
      else amount = a.value;
    }
    if (counterCurrency) {
      const b = parseAmount(d.counterAmount, counterCurrency, rules);
      if ('empty' in b) errors.counterAmount = { code: 'required', message: '받은 금액을 넣어 주세요.' };
      else if ('error' in b) errors.counterAmount = b.error;
      else counterAmount = b.value;
    }
    if (currency && counterCurrency && amount != null && counterAmount != null) {
      const rate = exchangeRate({ kind: 'exchange', currency, amount, counterAmount });
      derived.rate = rate;
      const fx = ctx.snapshot?.fx ?? null;
      if (rate != null && fx != null && fx > 0) {
        derived.diffPct = ((rate - fx) / fx) * 100;
        derived.costKrw = currency === 'KRW' ? Math.round(amount) - usdToKrw(counterAmount, fx) : usdToKrw(amount, fx) - Math.round(counterAmount);
        if (Math.abs(derived.diffPct) > rules.fxWarnPct) {
          warnings.push({
            code: 'fx_deviation',
            message: `적용 환율이 앱 환율(${fmtRate(fx)}원/$)과 ${Math.abs(derived.diffPct).toFixed(1)}% 다릅니다. 두 금액의 자릿수를 확인하세요.`,
          });
        }
      }
    }
  } else if (kind && currency) {
    const p = parseAmount(d.amount, currency, rules);
    if ('empty' in p) errors.amount = { code: 'required', message: '금액을 넣어 주세요.' };
    else if ('error' in p) errors.amount = p.error;
    else amount = p.value;
    if (amount != null) {
      const fx = ctx.snapshot?.fx ?? null;
      derived.krw = currency === 'KRW' ? amount : fx != null && fx > 0 ? usdToKrw(amount, fx) : null;
      const V = ctx.snapshot?.totalKrw;
      if (derived.krw != null && V != null && derived.krw >= (V * rules.bigPct) / 100) {
        warnings.push({ code: 'big_amount', message: `현재 총자산(${fmtWon(V)})의 절반이 넘는 금액입니다. 자릿수와 통화(원·달러)를 확인하세요.` });
      }
      if (t != null) {
        const win = rules.dupWarnH * HOUR_MS;
        const dup = ctx.entries.find((e) => {
          if (e.void || e.kind !== kind || e.currency !== currency || e.id === d.targetId) return false;
          if (!sameAmount(currency, e.amount, amount as number)) return false;
          const et = parseKstWall(e.occurredAt);
          return et != null && Math.abs(et - t) <= win;
        });
        if (dup) {
          const dt = parseKstWall(dup.occurredAt) as number;
          warnings.push({
            code: 'near_duplicate', existingId: dup.id,
            message: `${rules.dupWarnH}시간 안에 같은 금액 기록이 있습니다(#${dup.id} · ${formatKstShort(dt)} ${entryOneLine(dup)}). 같은 돈을 두 번 넣지 않았는지 확인하세요.`,
          });
        }
      }
    }
  }

  const memo = parseShortText(d.memo, { label: '메모' });
  if ('error' in memo) errors.memo = memo.error;

  const count = Object.keys(errors).length + (blocked ? 1 : 0);
  const value: NormalizedEntry | null = count === 0 && kind && currency && amount != null && t != null && 'value' in memo
    ? {
      kind, occurredAt: formatKstMinute(t), occurredAtMs: t, currency, amount,
      counterCurrency: kind === 'exchange' ? counterCurrency : null,
      counterAmount: kind === 'exchange' ? counterAmount : null,
      memo: memo.value,
    }
    : null;
  return { errors, blocked, blockError, warnings, count, value, derived };
}

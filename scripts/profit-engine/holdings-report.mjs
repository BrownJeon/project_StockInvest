#!/usr/bin/env node
/**
 * T-069 보유 점검 리포트 v0a (Phase 0-0a) — 읽기 전용.
 *
 *   node scripts/profit-engine/holdings-report.mjs [--since 2026-08-01] [--as-of "2026-10-22 21:00"]
 *        [--out-dir agent-vault/10-Flow/reports] [--date YYYYMMDD] [--no-write] [--json-summary]
 *
 * 안전 계약
 *  - 운영 DB 에 `SET SESSION TRANSACTION READ ONLY` 를 건 세션으로 **SELECT 만** 보낸다. 세션 플래그
 *    (`@@session.tx_read_only`)가 1 이 아니면 아무것도 읽지 않고 중단한다. 모든 SQL 은 `assertReadOnlySql` 를 통과해야 한다.
 *  - KIS·외부 API·텔레그램 호출 없음. DB 쓰기·DDL 없음. 주문·매도 없음.
 *  - `.env` 는 DB_* 5개만 읽고 값을 출력하지 않는다.
 *  - 리포트에는 실제 보유 금액이 들어간다 → 저장소 안 비공개 vault(`agent-vault/10-Flow/reports/`)에만 쓴다.
 *    표준 출력(`--json-summary`)에는 비율·건수만 낸다.
 *
 * 계산은 전부 `holdings-core.mjs`(순수 함수)에 있다.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  RULES, SYMBOL_MAX_PCT, DOC_SYMBOL_MAX_PCT, SECTOR_MAX_PCT, FLOW_TYPE_LABEL,
  parseSnapshot, buildBaseline, computePnl, computeConcentration, parsePolicy, computeStops,
  analyzeSnapshots, summarizeWindow, dailyIndex, tsMs, tsLabel, marketOf,
} from './holdings-core.mjs';

export const REPORT_VERSION = 'v0a';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..', '..');
const DEFAULT_SINCE = '2026-08-01';
const SNAPSHOT_STALE_MIN = 180;

// ─── 읽기 전용 SQL 가드 ───────────────────────────────────────────────────

const SET_RO = 'SET SESSION TRANSACTION READ ONLY';
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|REPLACE|MERGE|UPSERT|CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|CALL|DO|HANDLER|LOAD|LOCK|UNLOCK|OUTFILE|DUMPFILE|FOR\s+UPDATE|SHARE\s+MODE)\b/i;
/** 부작용·대기가 있는 함수 (Reviewer L-2 — `\bLOAD\b` 로는 LOAD_FILE 이 안 걸린다) */
const FORBIDDEN_FN = /\b(LOAD_FILE|GET_LOCK|RELEASE_LOCK|RELEASE_ALL_LOCKS|SLEEP|BENCHMARK|NEXTVAL|SETVAL|LASTVAL)\s*\(/i;

/** 이 스크립트가 던지는 오류 — 코드만 밖으로 낸다(L-3). 메시지는 고정 문구라 접속 정보가 없다 */
export class ReportError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** SELECT(또는 정확히 읽기 전용 설정문) 한 문장만 허용한다. 위반이면 던진다 */
export function assertReadOnlySql(sql) {
  const s = String(sql ?? '').trim();
  if (s === SET_RO) return;
  if (!/^SELECT\s/i.test(s)) throw new ReportError('T069_SQL_GUARD', `읽기 전용 가드: SELECT 가 아닌 SQL 거부 — ${s.slice(0, 40)}`);
  if (s.includes(';')) throw new ReportError('T069_SQL_GUARD', '읽기 전용 가드: 여러 문장(;) 거부');
  if (FORBIDDEN.test(s) || FORBIDDEN_FN.test(s)) throw new ReportError('T069_SQL_GUARD', `읽기 전용 가드: 금지 키워드 포함 — ${s.slice(0, 40)}`);
}

/** 가드를 거친 SELECT 실행기 — loadInputs 의 모든 조회가 이것만 쓴다 */
export function guardedQuery(conn) {
  return async (sql, params = []) => {
    assertReadOnlySql(sql);
    const [rows] = await conn.query(sql, params);
    return rows;
  };
}

/** 세션을 읽기 전용으로 바꾸고 플래그를 확인한다. 실패하면 던진다 */
export async function enterReadOnly(conn) {
  assertReadOnlySql(SET_RO);
  await conn.query(SET_RO);
  const sql = 'SELECT @@session.tx_read_only AS ro';
  assertReadOnlySql(sql);
  const [rows] = await conn.query(sql);
  const ro = Number(rows?.[0]?.ro);
  if (ro !== 1) throw new ReportError('T069_NOT_READ_ONLY', `세션이 읽기 전용이 아님(tx_read_only=${rows?.[0]?.ro}) — 중단`);
  return ro;
}

/** loadInputs 가 보내는 조회 수(읽기 전용 설정 2문 포함, 보유 종목이 있을 때) — 시험이 고정한다 */
export const EXPECTED_QUERY_COUNT = 11;

/** 리포트 입력 전부를 읽는다 (SELECT 만). conn 은 mysql2 연결 또는 같은 query 인터페이스의 가짜 */
export async function loadInputs(conn, { since = DEFAULT_SINCE, asOf = null } = {}) {
  const readOnlyFlag = await enterReadOnly(conn);
  const q = guardedQuery(conn);
  const latestRows = asOf
    ? await q('SELECT id, ts, total_krw, positions, source FROM portfolio_snapshots WHERE ts <= ? ORDER BY ts DESC, id DESC LIMIT 1', [asOf])
    : await q('SELECT id, ts, total_krw, positions, source FROM portfolio_snapshots ORDER BY ts DESC, id DESC LIMIT 1');
  const latestRow = latestRows[0] ?? null;
  if (!latestRow) throw new ReportError('T069_NO_SNAPSHOT', 'portfolio_snapshots 에 기준 행이 없음');
  const seriesRows = await q(
    'SELECT id, ts, total_krw, positions, source FROM portfolio_snapshots WHERE ts >= ? AND ts <= ? ORDER BY ts, id',
    [since, latestRow.ts],
  );
  const states = await q('SELECT symbol, market, entry_price, peak_price, qty, first_seen_at, updated_at, holding_deadline FROM position_state ORDER BY symbol');
  const policyRows = await q('SELECT value, updated_at FROM system_config WHERE `key` = ? LIMIT 1', ['risk_policy']);
  // 자동 청산 스위치 — 엔진과 같은 키(`src/lib/strategy/exit-switch.ts`)를 읽기만 한다(M-3)
  const exitRows = await q('SELECT `key`, value FROM system_config WHERE `key` IN (?, ?) ORDER BY `key`', ['exit_engine_enabled', 'exit_hard_stop_enabled']);
  const fxRows = await q('SELECT pair, rate, fetched_at FROM fx_rates WHERE pair = ? LIMIT 1', ['USD_KRW']);
  const latest = parseSnapshot(latestRow);
  const syms = Object.keys(latest.holdings);
  const nameRows = syms.length
    ? await q(`SELECT symbol, name FROM stock_meta WHERE symbol IN (${syms.map(() => '?').join(', ')})`, syms)
    : [];
  const orderRows = await q(
    'SELECT status, side, COUNT(*) AS n FROM orders WHERE created_at >= ? GROUP BY status, side ORDER BY status, side',
    [since],
  );
  const lastOrderRows = await q('SELECT MAX(created_at) AS last_at FROM orders WHERE created_at <= ?', [latestRow.ts]);
  return {
    readOnlyFlag,
    since,
    asOf,
    latestRow,
    seriesRows,
    states,
    policyRow: policyRows[0] ?? null,
    exitRows,
    fxRow: fxRows[0] ?? null,
    names: Object.fromEntries(nameRows.map((r) => [r.symbol, r.name])),
    orderRows,
    lastOrderAt: lastOrderRows[0]?.last_at ?? null,
  };
}

/**
 * 자동 청산 스위치 해석 — 엔진 규칙과 같은 방향: 값이 정확히 true 일 때만 ON, 없거나 해석 불가면 OFF.
 * (표시용 — 엔진이 실제로 쓰는 판독기는 `readExitEngineSwitch()`)
 */
export function parseExitSwitch(rows) {
  const by = new Map((rows ?? []).map((r) => [String(r.key), String(r.value ?? '')]));
  const norm = (v) => (v === undefined ? undefined : v.trim().replace(/^"(.*)"$/, '$1').trim().toLowerCase());
  const m = norm(by.get('exit_engine_enabled'));
  const state = m === undefined || m === '' ? 'absent' : m === 'true' ? 'on' : m === 'false' ? 'off' : 'unparsable';
  return { state, enabled: state === 'on', raw: by.get('exit_engine_enabled') ?? null };
}

// ─── 형식 ─────────────────────────────────────────────────────────────────

const fmtInt = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US'));
const fmtKrw = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${fmtInt(v)}원`);
const fmtUsd = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
/** 표시 자릿수에서 0 이 되는 값은 0 으로(‘-0.00’ 방지) */
const zfix = (v, d) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v);
const fmtPct = (v, d = 1, sign = false) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${sign && zfix(v, d) > 0 ? '+' : ''}${zfix(v, d).toFixed(d)}%`);
const fmtPp = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${zfix(v, d) > 0 ? '+' : ''}${zfix(v, d).toFixed(d)}%p`);
const fmtQty = (v) => (v === null || v === undefined ? '—' : String(Number(v)));
const fmtFx = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(2));

/** UTC Date → KST 'YYYY-MM-DD HH:MM' */
export function kstLabel(date) {
  const d = new Date(date.getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

const canonical = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? String(x) : x instanceof Date ? x.toISOString() : x));

/**
 * 입력 다이제스트 — 본문을 정하는 데이터만 넣는다(M-2).
 *  - `asOf` 옵션 자체는 넣지 않는다: 기준 행(latestRow)이 같으면 기본 실행과 `--as-of` 실행의 결과가 같아야 한다.
 *  - fx_rates 는 5분마다 바뀌므로 대체 환율로 **실제로 쓴 경우에만** 넣는다.
 */
export function inputDigest(inputs, { includeFx = false } = {}) {
  const h = crypto.createHash('sha256');
  h.update(canonical({
    since: inputs.since,
    latest: inputs.latestRow, series: inputs.seriesRows, states: inputs.states,
    policy: inputs.policyRow, exit: inputs.exitRows ?? null, fx: includeFx ? inputs.fxRow : null,
    names: inputs.names, orders: inputs.orderRows, lastOrderAt: inputs.lastOrderAt ?? null,
  }));
  return h.digest('hex').slice(0, 16);
}

// ─── 분석 묶음 ─────────────────────────────────────────────────────────────

/** 입력 → 분석 결과 (결정적). generatedAt 은 표시·신선도 판정에만 쓴다 */
export function analyze(inputs, { generatedAt } = {}) {
  const series = inputs.seriesRows.map(parseSnapshot);
  const latest = parseSnapshot(inputs.latestRow);
  const baseline = buildBaseline(latest, series, inputs.states, inputs.names, inputs.fxRow);
  const pnl = computePnl(baseline);
  const conc = computeConcentration(latest, baseline);
  const pol = parsePolicy(inputs.policyRow);
  const stops = computeStops(baseline, latest.total, pol.policy);
  const snap = analyzeSnapshots(series);
  // R2 대안: 최신 행의 USD 예수금이 왕복 패턴 안에 있으면 '다른 쪽 값'으로도 집중도를 계산
  const flipNow = snap.usdFlip.patterns.find((p) => p.ids.includes(latest.id)) ?? null;
  let concAlt = null;
  if (flipNow && latest.usd && latest.usd.fx) {
    const altUsdKrw = flipNow.latestIsZero ? flipNow.xUsd * latest.usd.fx : 0;
    concAlt = { assumption: flipNow.latestIsZero ? `USD 예수금 = ${fmtUsd(flipNow.xUsd)}` : 'USD 예수금 = $0', conc: computeConcentration(latest, baseline, altUsdKrw) };
  }
  const lastTs = latest.ts;
  const lastMs = tsMs(lastTs);
  const kst = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  // 끝은 기준 스냅샷 시각 그대로(초 포함) — 분 단위로 자르면 기준 행이 빠진다
  const windows = [
    { label: 'T-064 인용 구간 (10-07 → 10-17)', from: '2026-10-07 00:00', to: '2026-10-17 23:59:59' },
    { label: '최근 7일', from: kst(lastMs - 7 * 86400000), to: String(lastTs) },
    { label: '최근 30일', from: kst(lastMs - 30 * 86400000), to: String(lastTs) },
  ].map((w) => {
    const result = summarizeWindow(series, snap.flows.steps, w.from, w.to);
    const a0 = tsMs(w.from), b0 = tsMs(w.to);
    const evTypes = [...new Set(snap.flows.events.filter((e) => tsMs(e.curTs) >= a0 && tsMs(e.curTs) <= b0 && tsMs(e.prevTs) >= a0).map((e) => e.type))];
    return { ...w, result, evTypes };
  });
  const days = dailyIndex(series, snap.excludedIds, snap.usdFlip);
  const staleMin = generatedAt ? Math.round((generatedAt.getTime() + 9 * 3600000 - lastMs) / 60000) : null;
  const filled = inputs.orderRows.filter((r) => ['filled', 'partially_filled'].includes(r.status)).reduce((a, r) => a + Number(r.n), 0);
  const orderStatus = inputs.orderRows.map((r) => `${r.status}/${r.side} ${Number(r.n)}`).join(' · ') || '없음';
  const exitSwitch = parseExitSwitch(inputs.exitRows);
  return { series, latest, baseline, pnl, conc, concAlt, pol, stops, snap, flipNow, windows, days, staleMin, appFilledOrders: filled, orderStatus, lastOrderAt: inputs.lastOrderAt ?? null, exitSwitch };
}

// ─── 사용자 질문 ───────────────────────────────────────────────────────────

const describeChanges = (ev) => ev.changes
  .map((c) => `${c.symbol} ${c.to > c.from ? '매수' : '매도'} ${fmtQty(Math.abs(c.to - c.from))}주(${fmtQty(c.from)}→${fmtQty(c.to)})`)
  .join(', ');

/**
 * 사용자 질문 — 번호는 생성 순서대로 붙고 묶음(group)으로 나눠 보인다(M-1).
 *  - required: 기준 총자산·원장을 확정하는 데 꼭 필요한 것
 *  - optional: 과거 매매의 현금 흐름 확인(기준일 이후 원장에는 없어도 된다)
 *  - decision: 고르기만 하면 되는 결정
 * 문구에 내부 문서 ID 를 넣지 않는다. 선택지는 대등하게 나열한다(유도 금지).
 */
export function buildQuestions(a, { reportDate = null } = {}) {
  const qs = [];
  const add = (group, text) => qs.push({ n: qs.length + 1, group, text });
  const opts = (list) => list.map((x, i) => `${'①②③④⑤⑥⑦⑧'[i]} ${x}`).join(' ');
  let lastSell = null;
  for (const ev of a.snap.flows.events) {
    if (ev.type === 'usd_flip') continue;
    const when = `${tsLabel(ev.prevTs)} ~ ${tsLabel(ev.curTs)}`;
    if (ev.type === 'overseas_trade_usd_unrecorded') {
      const buy = ev.externalCandidate > 0;
      const sells = ev.changes.filter((c) => c.to < c.from).map((c) => c.symbol);
      const head = `${when} 사이 ${describeChanges(ev)} 가 보입니다(앱 주문 기록 없음). `;
      if (buy) {
        const src = [];
        if (sells.length) src.push(`같은 때 판 ${sells.join('·')} 대금`);
        if (lastSell) src.push(`${tsLabel(lastSell.curTs).slice(0, 10)}에 판 종목의 대금`);
        src.push('그 전부터 있던 USD 예수금', '그때 원화를 환전', '새로 입금한 뒤 환전', '모름');
        add('optional', `${head}매수 대금은 어디서 왔나요(여러 개 가능)? ${opts(src)} — 환전·입금이면 날짜와 원화 금액도 알려 주세요.`);
      } else {
        add('optional', `${head}매도 대금은 어떻게 하셨나요? ${opts(['USD 예수금으로 그대로 둠', '원화로 환전', '출금', '모름'])} — 환전·출금이면 날짜와 금액도 알려 주세요.`);
      }
      if (!buy) lastSell = ev;
    } else if (ev.type === 'krw_cash_change') {
      add('optional', `${when} 사이 원화 예수금이 매매 없이 ${fmtPct(ev.candidatePct, 1, true)}(직전 총액 대비) 바뀌었습니다. ${opts(['원화 입금', '원화 출금', '기타', '모름'])} — 날짜·금액을 알려 주세요.`);
    } else if (ev.type === 'usd_cash_change') {
      add('optional', `${when} 사이 USD 예수금이 매매 없이 ${fmtPct(ev.candidatePct, 1, true)}(직전 총액 대비) 바뀌었습니다. ${opts(['환전', '외화 입금', '외화 출금', '모름'])} — 날짜·금액을 알려 주세요.`);
    } else if (ev.type === 'unexplained_with_trade') {
      add('optional', `${when} 사이 ${describeChanges(ev)} 와 현금 변화가 맞지 않습니다(차이 ${fmtPct(ev.candidatePct, 1, true)}). 같은 때 입출금·환전이 있었나요?`);
    }
  }
  const day = reportDate ?? tsLabel(a.latest.ts).slice(0, 10);
  for (const p of a.snap.usdFlip.patterns) {
    add('required', `**오늘(${day}) 기준 KIS 앱에 보이는 실제 외화(USD) 예수금은 얼마인가요?** 스냅샷에서는 ${tsLabel(p.startTs)} 이후 $0 과 ${fmtUsd(p.xUsd)} 가 시간대에 따라 번갈아 찍혀(전환 ${p.flips}회, 그 사이 매매 없음) 어느 쪽이 맞는지 알 수 없습니다. 그 기간에 환전·외화 입출금이 있었다면 함께 알려 주세요.`);
  }
  const usdQ = qs.find((q) => q.group === 'required');
  add('required', `${a.series.length ? tsLabel(a.series[0].ts).slice(0, 10) : '스캔 시작'} 이후 위 목록 밖의 원화·외화 입금·출금·환전이 있었나요? 있었다면 날짜·방향·통화·금액을 알려 주세요(없으면 "없음").`);
  add('required', '미국주식용으로 말씀하신 추가 자금(약 200만원)은 입금하셨나요? 했다면 날짜·통화(원화 그대로 / 환전 후 USD)·금액을, 아직이면 예정일을 알려 주세요.');
  add('optional', '미국 종목을 살 때 원화를 환전한 기록(날짜와 환율, 또는 원화 금액)이 있나요? 있으면 환율로 생긴 손익을 따로 계산할 수 있습니다(없으면 "모름" — 이 리포트는 달러 가격 기준 손익만 냅니다).');
  add('required', `손익 계산의 기준일을 언제로 할까요? 이 리포트의 기준 스냅샷(${tsLabel(a.latest.ts)}) 은 USD 예수금이 불확실한 행이라${usdQ ? `, **질문 ${usdQ.n}(실제 USD 예수금)의 답을 받은 뒤에 기준 총자산을 확정**합니다` : ''}. 권고: ${usdQ ? `질문 ${usdQ.n} 답을 반영한 ${day}` : day} 을 기준일로 하고, 그 뒤 입출금만 원장에 적습니다.`);
  add('decision', `입출금을 어떻게 기록할까요? ${opts(['말씀해 주시는 대로 수기 원장에 적기', 'KIS 입출금 내역 조회로 자동 확인(가능 여부를 먼저 확인해야 함)'])} — 권고 ①(조회 가능 여부를 확인하기 전까지).`);
  return qs;
}

export const QUESTION_GROUP_LABEL = Object.freeze({
  required: '필수 — 기준 총자산·원장 확정에 필요',
  optional: '선택 — 과거 매매의 현금 흐름 확인(기준일 이후 원장에는 없어도 됨)',
  decision: '결정 — 고르기만 하면 됨',
});

// ─── 마크다운 ──────────────────────────────────────────────────────────────

export function renderMarkdown(inputs, a, { generatedAt, digest, scriptRel = 'scripts/profit-engine/holdings-report.mjs' } = {}) {
  const L = [];
  const p = (s = '') => L.push(s);
  const latest = a.latest;
  const pol = a.pol;
  const conc = a.conc;
  const top = conc.bySymbol[0];
  const semis = conc.bySector.find((s) => s.sector === '반도체·메모리');
  const qs = buildQuestions(a);

  p('---');
  p('report_id: T-069-holdings-report');
  p(`version: ${REPORT_VERSION}`);
  p(`snapshot_id: ${latest.id}`);
  p(`snapshot_ts: "${String(latest.ts).slice(0, 19)}"`);
  p(`input_digest: ${digest}`);
  p('tags:');
  p('  - type/report');
  p('  - domain/portfolio');
  p('related: "[[T-069-holdings-baseline-report]]"');
  p('---');
  p();
  p('# T-069 보유 점검 리포트 v0a — 기준일 원가·집중도·손절선 거리·스냅샷 신뢰도');
  p();
  p('> 🔒 **비공개** — 실제 계좌 금액이 들어 있다. 저장소 밖으로 복사·전송하지 않는다. 채팅 보고에는 비율만 쓴다.');
  p('> 읽기 전용 산출물 — 이 리포트는 주문·매도·알림을 만들지 않는다. 보유 정책 결정(T-064 D3)의 입력이다.');
  p();
  p(`- 생성: ${generatedAt ? kstLabel(generatedAt) : '—'} KST · 스크립트 \`${scriptRel}\` (${REPORT_VERSION})${a.staleMin !== null && a.staleMin > SNAPSHOT_STALE_MIN ? ` · ⚠ 기준 스냅샷이 생성 시각보다 ${a.staleMin}분 오래됨` : ''}`);
  p(`- 기준 스냅샷: \`portfolio_snapshots.id=${latest.id}\` · ${String(latest.ts).slice(0, 19)} KST(초 단위) · source=${latest.source ?? '—'}`);
  p(`- 스캔 범위: ${inputs.since} ~ 기준 스냅샷 (${a.series.length}행)`);
  p(`- 읽기 전용 증명: \`${SET_RO}\` 후 \`@@session.tx_read_only = ${inputs.readOnlyFlag}\` 확인, 보낸 SQL 은 전부 SELECT(코드 가드 \`assertReadOnlySql\`)`);
  p(`- 입력 다이제스트: \`${digest}\` (같은 다이제스트면 같은 본문 — 생성 시각 줄만 다르다)`);
  p();

  // 1. 한눈에
  p('## 1. 한눈에 — 불편한 것부터');
  p();
  if (top) p(`1. **한 종목 집중**: ${top.symbol} ${fmtPct(top.pct)} (정책 제안 상한 ${SYMBOL_MAX_PCT}% · 문서 ${DOC_SYMBOL_MAX_PCT}%). ${semis ? `반도체·메모리 묶음 ${fmtPct(semis.pct)} (제안 상한 ${SECTOR_MAX_PCT}%).` : ''}`);
  p(`2. **평가손익**: 보유 ${a.pnl.rows.length}종목 중 ${a.pnl.losers}종목 평가손, 합계 ${fmtPct(a.pnl.totalKrwPct, 1, true)} (원화 기준, 취득원가 대비).`);
  p(`3. **손절 합(가상)**: 손절폭 ${pol.policy.stopPct}% 기준 손절 합 = 총자산의 ${fmtPct(a.stops.heatPct, 2)} — 한도 ${pol.policy.heatCapPct}% 대비 사용률 ${fmtPct(a.stops.usagePct, 0)}${a.stops.over ? ' (**한도 초과**)' : ''}. 이 값은 *모든 종목이 평균단가 기준 손절가에 닿을 때의 가상 손실*이지 지금의 노출이 아니다 — 실제로는 이미 ${a.stops.belowCount}/${a.stops.rows.length}종목이 손절가 아래이고 평가손이 ${fmtPct(a.pnl.totalKrwPct, 1, true)}다. 역산한 손절폭 상한 ${a.stops.maxStopPct ?? '—'}% 는 한도 산식의 결과일 뿐 **행동 지침이 아니다**(이미 손절가 아래인 종목에는 적용할 수 없다).`);
  p(`4. **현금 비중** ${fmtPct(conc.cash.pct, 1)}${a.concAlt ? ` (USD 예수금이 왕복 중이라 ${a.concAlt.assumption} 이면 ${fmtPct(a.concAlt.conc.cash.pct, 1)})` : ''} — 정보 표시(현금 하한 규칙 없음).`);
  p(`5. **스냅샷 신뢰도**: 레벨 급변(R1) ${a.snap.levelSegs.length}구간 ${a.snap.levelSegs.reduce((x, s) => x + s.rows, 0)}행 · 일시 구성 이상(R1b) ${a.snap.transient.length}건 ${a.snap.transient.reduce((x, r) => x + r.rows, 0)}행 · USD 예수금 왕복(R2) ${a.snap.usdFlip.patterns.length}건 — 손익·낙폭 계산 **제외 후보**로 표시만 했다(데이터 삭제 없음).`);
  const w0 = a.windows[0].result;
  if (w0) {
    const t = a.windows[0].evTypes;
    const why = t.length === 0
      ? '그 구간에 R3 후보 단계는 없다'
      : `그 구간의 R3 후보 분류: ${t.map((x) => FLOW_TYPE_LABEL[x] ?? x).join(' / ')}`;
    p(`6. **10-07→10-17 총액 ${fmtPct(w0.changePct, 1, true)}** 의 분해: 시세(환율 포함) ${fmtPct(w0.priceEffectPct, 1, true)} · 매매·입출금 후보 ${fmtPct(w0.externalCandidatePct, 1, true)} · 기타 ${fmtPct(w0.otherPct, 2, true)}. ${why}(§6.2·§6.3) — 입출금 여부는 사용자 확인 필요.`);
  }
  p(`7. **입출금 원장은 비어 있다** — 추정으로 채우지 않았다. 사용자 확인 질문 ${qs.length}개(필수 ${qs.filter((q) => q.group === 'required').length} · 선택 ${qs.filter((q) => q.group === 'optional').length} · 결정 ${qs.filter((q) => q.group === 'decision').length}, §7.3).`);
  p(`8. [가능성 높음] 스냅샷의 수량 변화는 **앱 밖 거래**로 보인다 — 근거: ${inputs.since} 이후 앱 주문 중 체결 ${a.appFilledOrders}건(상태별: ${a.orderStatus}), 마지막 앱 주문 ${a.lastOrderAt ? tsLabel(a.lastOrderAt) : '없음'}. 앱이 기록하지 못한 체결 가능성은 배제하지 못한다.`);
  p();

  // 2. 기준일 원가
  p('## 2. 기준일 원가 스냅샷');
  p();
  p(`기준 시각 **${tsLabel(latest.ts)} KST** (스냅샷 id ${latest.id}). 수량·현재가 = 스냅샷, 평균단가 = \`position_state.entry_price\`(KIS 잔고 평균단가).`);
  p();
  p('| 종목 | 이름 | 통화 | 수량 | 평균단가(원통화) | 취득원가(원통화) | 현재가(원통화) | 평가액(원통화) | 평균단가 환산 환율 | 처음 본 시각 | 평균단가 갱신 |');
  p('|---|---|---|---:|---:|---:|---:|---:|---|---|---|');
  for (const r of a.baseline.rows) {
    const usd = r.market === 'overseas';
    p(`| ${r.symbol} | ${r.name ?? '—'} | ${r.currency} | ${fmtQty(r.qty)} | ${usd ? fmtUsd(r.avgUsd) : fmtKrw(r.avgKrw)} | ${usd ? fmtUsd(r.costUsd) : fmtKrw(r.avgKrw !== null ? r.avgKrw * r.qty : null)} | ${usd ? fmtUsd(r.priceUsd) : fmtKrw(r.priceKrw)} | ${usd ? fmtUsd(r.valueUsd) : fmtKrw(r.valueKrw)} | ${usd ? `${fmtFx(r.fxAtAvg)} (${r.fxAtAvgSource === 'snapshot_usd_row' ? `스냅샷 ${tsLabel(r.fxAtAvgTs)}, 시차 ${r.fxAtAvgGapMin}분` : r.fxAtAvgSource === 'fx_rates_current' ? `fx_rates 현재값, 시차 ${r.fxAtAvgGapMin}분` : '없음'})` : '해당 없음'} | ${tsLabel(r.firstSeenAt)} | ${tsLabel(r.stateUpdatedAt)} |`);
  }
  p();
  p(`원화 환산(참고): 취득원가 합 ${fmtKrw(a.pnl.totalCostKrw)} · 주식 평가액 ${fmtKrw(conc.stockValue)} · 원화 예수금 ${fmtKrw(conc.cash.krw)}${conc.cash.krwLocked ? ` (결제대기 ${fmtKrw(conc.cash.krwLocked)} 별도)` : ''} · USD 예수금 ${latest.usd ? `${fmtUsd(latest.usd.qty)} × ${fmtFx(latest.usd.fx)} = ${fmtKrw(latest.usd.valueKrw)}` : '행 없음'} · **총자산 ${fmtKrw(latest.total)}** (스냅샷 total_krw).`);
  p();
  p('**원가의 한계 (반드시 함께 읽을 것)**');
  p('- 해외 `position_state.entry_price` 는 *USD 평균단가 × 갱신 시점 환율*을 매 틱 다시 쓴 값이다. 그래서 USD 평균단가는 `entry_price ÷ (갱신 시각에 가장 가까운 스냅샷의 USD 행 환율)` 로 되돌렸다. 두 환율이 같은 캐시(5분)에서 왔다고 가정한다 [가능성 높음]. 시차가 크면 USD 평균단가에 그만큼 오차가 있다.');
  p('- **매수 시점 환율은 어디에도 없다** → 매수 당시 원화 원가·실제 환차손익은 계산할 수 없다(§7.3 질문).');
  p('- 평균단가는 KIS 가 계산한 *현재 보유분의* 평균이다. 이미 판 물량의 원가, 수수료 포함 여부는 알 수 없다. `first_seen_at` 은 시스템이 처음 본 시각이지 매수일이 아니다.');
  p('- `holdings` 테이블(2026-04~05 기록만)·`executions`(0행)·`trade_journals`(0행)에는 현 보유의 원가 근거가 없다.');
  if (a.baseline.notes.length) for (const n of a.baseline.notes) p(`- ⚠ ${n}`);
  p();

  // 3. 평가손익
  p('## 3. 평가손익');
  p();
  p('| 종목 | 시장 | 원화 기준 손익 | 원화 기준 % | USD 가격 기준 손익 | USD 기준 % | 환율 시점 왜곡 |');
  p('|---|---|---:|---:|---:|---:|---:|');
  for (const r of a.pnl.rows) {
    p(`| ${r.symbol} | ${r.market === 'overseas' ? '미국' : '국내'} | ${fmtKrw(r.krwUnreal)} | ${fmtPct(r.krwPct, 2, true)} | ${r.market === 'overseas' ? `${fmtUsd(r.usdUnreal)} (≈${fmtKrw(r.usdUnrealKrwAtNow)})` : '—'} | ${r.market === 'overseas' ? fmtPct(r.usdPct, 2, true) : '—'} | ${r.market === 'overseas' ? fmtPp(r.fxTimingPp) : '—'} |`);
  }
  p(`| **합계** | | **${fmtKrw(a.pnl.totalKrwUnreal)}** | **${fmtPct(a.pnl.totalKrwPct, 2, true)}** | | | |`);
  p();
  p('- 원화 기준 = 리스크 정책 화면(`src/lib/risk/compute.ts`)과 같은 공식: (스냅샷 현재가 − entry_price) × 수량.');
  p('- USD 기준 = (현재 USD 가격 − USD 평균단가) ÷ USD 평균단가 — 환율 영향이 없는 순수 가격 손익. "환율 시점 왜곡" = 원화 기준 % − USD 기준 %. 평균단가와 현재가가 서로 다른 시점의 환율로 환산돼 생기는 차이(T-066 L-1)이며 0 에 가까울수록 원화 기준 %를 그대로 믿어도 된다.');
  p('- **환차손익(매수 시 환율 대비)은 계산하지 않았다** — 매수 시점 환율 미보존. 사용자가 환전 기록을 주면 v0b 에서 분리한다.');
  p();

  // 4. 집중도
  p('## 4. 집중도');
  p();
  p(`분모 = 주식 평가액 + 원화 예수금 + USD 예수금 = ${fmtKrw(conc.total)} (스냅샷 total_krw ${fmtKrw(conc.snapshotTotal)}${Math.abs(conc.total - conc.snapshotTotal) > 1 ? ' — 차이 있음, 확인 필요' : ' 와 일치'}).`);
  p();
  p('**종목별**');
  p();
  p(`| 종목 | 평가액 | 비중 | 제안 상한 ${SYMBOL_MAX_PCT}% | 문서 상한 ${DOC_SYMBOL_MAX_PCT}% |`);
  p('|---|---:|---:|---|---|');
  for (const s of conc.bySymbol) p(`| ${s.symbol} | ${fmtKrw(s.value)} | ${fmtPct(s.pct)} | ${s.overSymbolMax ? '초과' : '이내'} | ${s.overDocMax ? '초과' : '이내'} |`);
  p();
  p('**섹터별** (수기 분류 — DB 에 업종 정보 없음, T-064 §0 묶음)');
  p();
  p(`| 섹터 | 종목 | 비중 | 제안 상한 ${SECTOR_MAX_PCT}% |`);
  p('|---|---|---:|---|');
  for (const s of conc.bySector) p(`| ${s.sector} | ${s.symbols.join(', ')} | ${fmtPct(s.pct)} | ${s.overSectorMax ? '초과' : '이내'} |`);
  p();
  p('**통화·시장·현금**');
  p();
  p('| 구분 | 금액 | 비중 |');
  p('|---|---:|---:|');
  for (const c of conc.byCurrency) p(`| ${c.currency} 자산 (주식 ${fmtKrw(c.stocks)} + 현금 ${fmtKrw(c.cash)}) | ${fmtKrw(c.value)} | ${fmtPct(c.pct)} |`);
  p(`| 주식 중 미국 비중 | — | ${fmtPct(a.conc.overseasStockPct)} |`);
  p(`| 현금 합계 (원화 ${fmtKrw(conc.cash.krw)} + USD ${fmtKrw(conc.cash.usd)}) | ${fmtKrw(conc.cash.krw + conc.cash.usd)} | ${fmtPct(conc.cash.pct)} |`);
  p();
  if (a.concAlt) {
    p(`> ⚠ 기준 스냅샷의 USD 예수금은 R2 왕복 구간 안이다. ${a.concAlt.assumption} 로 보면: 현금 비중 ${fmtPct(a.concAlt.conc.cash.pct)}, ${a.concAlt.conc.bySymbol[0]?.symbol} ${fmtPct(a.concAlt.conc.bySymbol[0]?.pct)}, USD 자산 ${fmtPct(a.concAlt.conc.byCurrency[0].pct)}. 어느 쪽이 맞는지는 사용자 확인 질문(§7.3)으로 정한다.`);
    p();
  }

  // 5. 손절선 거리
  p('## 5. 예상 손절가까지 거리 (리스크 정책)');
  p();
  p(`정책: \`system_config.risk_policy\` ${pol.status === 'ok' ? `v${pol.version} (저장 ${pol.updatedAt ?? '—'})` : pol.status === 'absent' ? '미저장 → 제안 기본값' : '손상 → 제안 기본값'} — 손절폭 **${pol.policy.stopPct}%** · 손절 합 한도 **${pol.policy.heatCapPct}%** · 기준가 **${pol.policy.stopBasis === 'avg' ? '평균단가' : '보유 중 고점'}**. 공식은 \`src/lib/risk/compute.ts\` 와 같다(독립 재구현 — §9 대조).`);
  p();
  p('| 종목 | 기준가(원화) | 예상 손절가(원화) | 상태 | 현재가→손절가 거리 | 손절 시 손익 | 해외 USD 기준 손절가 | USD 기준 거리 |');
  p('|---|---:|---:|---|---:|---:|---:|---:|');
  for (const r of a.stops.rows) {
    const state = r.stopKrw === null ? '계산 불가' : r.below ? `**이미 아래** (${fmtPct(r.underPct, 1)} 아래)` : r.near ? '근접(1% 미만)' : '위';
    const usdState = r.stopUsd === null ? '—' : r.belowUsd ? `${fmtPct(r.underPctUsd, 1)} 아래` : `${fmtPct(r.distPctUsd, 2)} 위`;
    p(`| ${r.symbol} | ${fmtKrw(r.refKrw)} | ${fmtKrw(r.stopKrw)} | ${state} | ${r.distPct !== null ? fmtPct(r.distPct, 2) : '—'} | ${fmtKrw(r.pnlAtStopKrw)} (${fmtPct(r.pnlAtStopPct, 1, true)}) | ${r.stopUsd !== null ? fmtUsd(r.stopUsd) : '—'} | ${usdState} |`);
  }
  p();
  p(`- 손절 합(모든 종목이 예상 손절가에 닿을 때 손실 합) = ${fmtKrw(a.stops.heatKrw)} = 총자산의 **${fmtPct(a.stops.heatPct, 2)}** · 한도 금액 ${fmtKrw(a.stops.capKrw)} · 사용률 **${fmtPct(a.stops.usagePct, 0)}**${a.stops.over ? ' → **한도 초과**' : ''}.`);
  p(`- 한도 ${pol.policy.heatCapPct}% 를 지키는 손절폭 상한(역산) = **${a.stops.maxStopPct ?? '—'}%** (취득원가 합 ${fmtKrw(a.stops.costKrw)} 기준).`);
  const ex = a.exitSwitch;
  const exitLine = `자동 청산 엔진 스위치(생성 시각 기준, \`system_config.exit_engine_enabled\`): ${ex.state === 'on' ? '**ON** — 엔진 자체 손절 규칙(이 정책과 별개)이 동작할 수 있다' : ex.state === 'off' ? 'OFF' : ex.state === 'absent' ? '키 없음 → OFF 로 처리' : '값 해석 불가 → 엔진은 OFF 로 처리'}. 이 리포트·리스크 정책 표시는 주문을 만들지 않는다.`;
  p(`- 이미 예상 손절가 아래: ${a.stops.belowCount}종목 (${a.stops.belowSymbols.join(', ') || '없음'}). 평균단가 기준 손절은 *지금 가격이 아니라 산 가격*에서 재므로, 이미 손실이 손절폭보다 큰 종목은 "손절가 아래"로 나온다. ${exitLine}`);
  p('- "USD 기준 거리" 는 환율을 뺀 가격만의 거리다(원화 열과 같은 정의 — 위: (현재가−손절가)÷현재가, 아래: (손절가−현재가)÷손절가). 원화 기준과 차이가 크면 환율 시점 왜곡이다.');
  p();

  // 6. 스냅샷 신뢰도
  const s = a.snap;
  p('## 6. 스냅샷 신뢰도 — 탐지 규칙과 결과');
  p();
  p('### 6.1 규칙 (코드: `holdings-core.mjs` — 임계값은 `RULES` 상수)');
  p();
  p(`- **R1 레벨 급변**: 연속 두 스냅샷의 총액 비가 ${RULES.levelShiftLow} 미만 또는 ${RULES.levelShiftHigh.toFixed(3)} 초과(하락 30%·상승 약 43%)이면 그 행부터 구간을 연다. 기준선은 급변 직전 행의 총액이고, 총액 ÷ 기준선이 다시 [${RULES.levelShiftLow}, ${RULES.levelShiftHigh.toFixed(3)}] 안으로 들어오는 첫 행 직전까지가 구간이다. 끝까지 안 돌아오면 "열린 구간"(입출금 같은 실제 레벨 변화일 수 있음 → 사용자 확인). 원인 분류: 보유 종목이 사라졌는데 현금이 늘지 않았으면 '보유 소실·현금 미반영'(USD 행이 없던 시기의 해외 종목이면 USD 예수금 미기록 추정).`);
  p(`- **R1b 일시 구성 이상**: 보유 구성(종목·수량)이 바뀐 뒤 ${RULES.transientMaxRows}행 안에 직전과 *똑같은* 구성으로 돌아오면 그 사이 행. 원인은 한쪽 시장 잔고 조회 실패·다른 응답 혼입으로 보인다 [가능성 높음 — \`volatility-guard.ts\` 에 적힌 고장 유형 B 와 모양이 같음, 행별 원인은 확인 안 함]. 같은 수량을 팔았다 되산 경우도 걸릴 수 있다.`);
  p(`- **R2 USD 예수금 왕복**: USD 현금 행(T-056 이후)의 수량이 0 ↔ X(같은 X, 허용 ${RULES.usdFlipTolUsd} USD)로 바뀌는데 그 사이 보유 수량 변화가 없는 전환이 ${RULES.usdFlipMinFlips}회 이상이면, 첫 전환 직전 행부터 마지막 행까지를 "USD 예수금 불확실"로 표시한다.`);
  p(`- **R3 자금 이동 분해**: 연속 두 행의 Δ총액 = 시세효과(공통 종목 직전 수량 × 단가 변화) + 수량효과(수량 변화·신규·소실 평가액) + 현금흐름(원화 예수금+결제대기 변화, USD 수량 변화 × 환율) + 기타. *외부 자금 이동 후보* = 수량효과 + 현금흐름 — 계좌 안에서 끝난 매매면 0 근처다. |후보| ≥ max(직전 총액의 ${RULES.flowMinPct}%, ${fmtInt(RULES.flowMinKrw)}원)이면 목록에 올린다. R1b 행에 들고 나는 단계는 빼고, 매매 금액의 ${RULES.tradeOffsetTolPct}% 안에서 현금과 상쇄된 매매는 '내부 매매'로 센다.`);
  p();
  p('**제외 규칙(제안 — 사용자·Reviewer 확인 전까지 데이터는 그대로 둔다)**');
  p('1. R1·R1b 행은 총액 기반 지표(변화율·낙폭·킬스위치 기준선 재현)에서 **제외 후보**. 지표를 낼 때는 "제외 전/후"를 함께 쓴다.');
  p('2. R2 구간은 행을 빼지 않고 **USD 예수금 제외 총액**(주식 + 원화 현금)으로 변화율을 함께 낸다(§6.4 의 `지수(USD현금 제외)`).');
  p('3. R3 후보는 입출금으로 확정하지 않는다. 사용자가 답한 것만 §7 원장에 적고, 답이 오기 전 기간 수익률은 "입출금 미보정"으로 표기한다.');
  p();
  p('### 6.2 결과');
  p();
  p(`**R1 레벨 급변: ${s.levelSegs.length}구간**`);
  p();
  if (s.levelSegs.length) {
    p('| 시작 | 끝 | 행 수 | 기준선 대비 최저 | 닫힘 | 사라진 종목 | 회복 때 새 종목 | 원인(추정) | 처리 |');
    p('|---|---|---:|---:|---|---|---|---|---|');
    for (const g of s.levelSegs) p(`| ${tsLabel(g.startTs)} (id ${g.startId}) | ${tsLabel(g.endTs)} (id ${g.endId}) | ${g.rows} | ${(g.minRatio * 100).toFixed(1)}% | ${g.open ? '열림' : `회복 ${tsLabel(g.recoverTs)}`} | ${g.vanished.join(', ') || '—'} | ${g.appeared.join(', ') || '—'} | ${g.cause} | 제외 후보 |`);
  } else p('없음');
  p();
  p(`**R1b 일시 구성 이상: ${s.transient.length}건**`);
  p();
  if (s.transient.length) {
    p('| 시작 | 끝 | 행 수 | source | 바뀐 종목 수 | 총액 최대 이탈 | 처리 |');
    p('|---|---|---:|---|---:|---:|---|');
    for (const r of s.transient) p(`| ${tsLabel(r.startTs)} (id ${r.startId}) | ${tsLabel(r.endTs)} (id ${r.endId}) | ${r.rows} | ${r.sources.join(', ')} | ${r.changedSymbols.length} | ${fmtPct(r.maxDevPct)} | 제외 후보 |`);
  } else p('없음');
  p();
  p(`**R2 USD 예수금 왕복: ${s.usdFlip.patterns.length}건** (USD 행이 있는 스냅샷 ${s.usdFlip.usdRowCount}행, 첫 행 ${s.usdFlip.firstUsdRowTs ? tsLabel(s.usdFlip.firstUsdRowTs) : '—'})`);
  p();
  for (const pt of s.usdFlip.patterns) {
    p(`- X = ${fmtUsd(pt.xUsd)} (≈${fmtKrw(pt.xKrw)}, 기준 총액의 ${fmtPct(latest.total > 0 && pt.xKrw ? (pt.xKrw / latest.total) * 100 : null, 2)}) · 전환 ${pt.flips}회(매매 없는 전환 ${pt.flipsWithoutTrade}회) · 구간 ${tsLabel(pt.startTs)} ~ ${tsLabel(pt.endTs)} · ${pt.rows}행 중 $0 ${pt.zeroRows}행.`);
    p(`  - 시간대(KST): X 로 찍힌 시각 ${pt.nonzeroHoursKst.join('·')}시 / $0 으로 찍힌 시각 ${pt.zeroHoursKst.join('·')}시 — 시간대에 따라 갈린다. 원인은 KIS 예수금 조회의 기준(체결/결제·주간/야간) 차이로 [추측]; 기준 스냅샷은 ${pt.latestIsZero ? '$0 쪽' : 'X 쪽'}이다.`);
    p(`  - 전환: ${pt.flipList.map((f) => `${tsLabel(f.toTs)} ${f.direction}`).join(' · ')}`);
  }
  if (!s.usdFlip.patterns.length) p('없음');
  p();
  p(`**R3 자금 이동 후보: ${s.flows.events.length}건** (내부 매매로 상쇄 ${s.flows.internalTrades}건, R1b 관련 단계 ${s.flows.transientSteps}건 제외)`);
  p();
  if (s.flows.events.length) {
    p('| 직전 → 이번 | 분류 | 수량 변화 | 외부 이동 후보(직전 총액 대비) | 연결 |');
    p('|---|---|---|---:|---|');
    for (const ev of s.flows.events) p(`| ${tsLabel(ev.prevTs)} → ${tsLabel(ev.curTs)} | ${FLOW_TYPE_LABEL[ev.type] ?? ev.type} | ${ev.changes.length ? describeChanges(ev) : '—'} | ${fmtKrw(ev.externalCandidate)} (${fmtPct(ev.candidatePct, 2, true)}) | ${ev.levelSegStartId ? `R1 구간(id ${ev.levelSegStartId}~)` : ev.type === 'usd_flip' ? 'R2' : '—'} |`);
  } else p('없음');
  p();
  p('### 6.3 기간 분해 (입출금 미보정)');
  p();
  p('Δ총액 = 시세효과(해외는 환율 변화 포함) + 외부 이동 후보(매매 대금 미기록·입출금) + 기타(결제대기·USD 현금 환율·기록 방식 변화).');
  p();
  p('| 구간 | 실제 시작~끝 | 행 | Δ총액 | 시세효과 | 외부 이동 후보 | 기타 |');
  p('|---|---|---:|---:|---:|---:|---:|');
  for (const w of a.windows) {
    const r = w.result;
    if (!r) { p(`| ${w.label} | 자료 부족 | | | | | |`); continue; }
    p(`| ${w.label} | ${tsLabel(r.fromTs)} ~ ${tsLabel(r.toTs)} | ${r.rows} | ${fmtKrw(r.dTotal)} (${fmtPct(r.changePct, 2, true)}) | ${fmtPct(r.priceEffectPct, 2, true)} | ${fmtPct(r.externalCandidatePct, 2, true)} | ${fmtPct(r.otherPct, 2, true)} |`);
  }
  p();
  p('### 6.4 일별 지수 (날짜별 마지막 스냅샷, 첫 정상일 = 100)');
  p();
  p('| 날짜 | 스냅샷 | 지수 | 지수(USD현금 제외) | 보유 종목 수 | 표시 |');
  p('|---|---|---:|---:|---:|---|');
  for (const d of a.days.slice(-35)) p(`| ${d.day} | ${tsLabel(d.ts).slice(11)} (id ${d.id}) | ${d.index !== null ? d.index.toFixed(1) : '—'} | ${d.indexExUsdCash !== null ? d.indexExUsdCash.toFixed(1) : '—'} | ${d.holdings} | ${[d.excluded ? '제외 후보' : '', d.usdUncertain ? 'USD 불확실' : ''].filter(Boolean).join(', ') || ''} |`);
  p();

  // 7. 입출금 원장
  p('## 7. 입출금 원장 (Phase 0-0a, T-064 D18)');
  p();
  p('### 7.1 원장 양식 — 사용자가 알려 준 것만 적는다');
  p();
  p('| # | 날짜(KST) | 방향(입금/출금/환전) | 통화 | 금액 | 환율(환전 시) | 메모 | 출처(사용자 답변 일시) |');
  p('|---|---|---|---|---:|---:|---|---|');
  p('| — | (아직 없음) | | | | | | |');
  p();
  p('기준일: **미정** (권고 — 이 리포트의 기준 스냅샷 시각). 원장 값은 추정으로 채우지 않는다.');
  p();
  p('### 7.2 자금 이동(입출금·환전) 확인이 필요한 구간');
  p();
  p('대부분은 *매매 대금의 현금 쪽이 스냅샷에 기록되지 않은 것*(USD 예수금 미기록 시기)이며 입출금으로 단정하지 않는다.');
  p();
  const susp = s.flows.events.filter((e) => e.type !== 'usd_flip');
  if (susp.length) for (const ev of susp) p(`- ${tsLabel(ev.prevTs)} → ${tsLabel(ev.curTs)}: ${FLOW_TYPE_LABEL[ev.type]} — ${ev.changes.length ? describeChanges(ev) : '매매 없음'}, 외부 이동 후보 ${fmtPct(ev.candidatePct, 2, true)}`);
  for (const pt of s.usdFlip.patterns) p(`- ${tsLabel(pt.startTs)} ~ ${tsLabel(pt.endTs)}: USD 예수금 $0 ↔ ${fmtUsd(pt.xUsd)} 왕복 (R2)`);
  if (!susp.length && !s.usdFlip.patterns.length) p('- 없음');
  p();
  p('### 7.3 사용자에게 물을 질문');
  p();
  for (const g of ['required', 'optional', 'decision']) {
    const list = qs.filter((q) => q.group === g);
    if (!list.length) continue;
    p(`**${QUESTION_GROUP_LABEL[g]}** (${list.map((q) => q.n).join('·')})`);
    p();
    for (const q of list) p(`${q.n}. ${q.text}`);
    p();
  }
  p();

  // 8. v0b
  p('## 8. 보유 정책 선택지·손실 분포 (v0b) — **T-070 일봉 백필 후 작성**');
  p();
  p('- 종목별 변동성(ATR)·최대 낙폭, 보유 정책 2~3안(예: 현상 유지 / 집중 상한 + 단계적 축소 / 손절 규칙 부착)과 안별 최악 손실 분포는 일봉이 필요하다 → T-070(`daily_bars`) 백필 뒤 v0b 에서 채운다. 분석가(Fable) 읽기 전용 자문 1회로 선택지를 다듬는다.');
  p('- 시스템은 팔지 않는다(T-064 D3). v0b 는 사용자 결정 항목으로 끝난다.');
  p();

  // 9. 대조·한계
  p('## 9. 수치 대조·가정·한계');
  p();
  p('- 대조 기준: 손절 합·사용률·역산 손절폭은 `src/lib/risk/compute.ts`(T-066) 공식을 다시 구현해 계산했다. 같은 스냅샷이면 리스크 정책 화면 값과 같아야 한다(Reviewer 독립 재계산 대상).');
  p('- 총자산 분모는 스냅샷 `total_krw` 그대로다(USD 예수금 왕복 영향 포함 — §4 대안 참고).');
  p('- `position_state` 는 현재 상태만 있다 — `--as-of` 로 과거 스냅샷을 골라도 평균단가는 지금 값이다.');
  p('- 섹터는 수기 분류다. 미분류 종목이 생기면 \'미분류\'로 나온다.');
  p('- 2026-10-21 05:18 이전 스냅샷에는 USD 예수금이 없다(T-056 이전) → 그 시기 해외 매매는 총액 변화로 보인다(R3 `해외 매매 — USD 예수금 미기록`).');
  p('- 환차손익·매수 시점 원화 원가·이미 판 물량의 원가·수수료는 계산하지 않았다(자료 없음).');
  p();
  p('## 10. 재현');
  p();
  p(`기준 시각 **${String(latest.ts).slice(0, 19)} KST**(초 단위) · 스냅샷 id **${latest.id}** · 입력 다이제스트 \`${digest}\`. 아래 명령은 다음 스냅샷이 쌓인 뒤에도 같은 기준 행을 고른다.`);
  p();
  p('```bash');
  p(`node ${scriptRel} --since ${inputs.since} --as-of "${String(latest.ts).slice(0, 19)}" --no-write   # 같은 본문 해시가 나오면 재현`);
  p('node --test scripts/profit-engine/holdings-report.test.mjs');
  p('```');
  p();
  p('- 한계: `position_state`(평균단가·고점)·`risk_policy`·자동 청산 스위치·주문 집계는 *현재값*을 읽는다. 그 값이 바뀐 뒤 과거 기준으로 다시 만들면 평균단가 등에 현재값이 들어가 본문(과 다이제스트)이 달라진다.');
  return L.join('\n') + '\n';
}

/** 채팅 보고용 요약 — 비율·건수만(절대 금액 없음) */
export function buildSummary(a, digest) {
  return {
    version: REPORT_VERSION,
    snapshot: { id: a.latest.id, ts: tsLabel(a.latest.ts) },
    inputDigest: digest,
    holdings: a.baseline.rows.length,
    losers: a.pnl.losers,
    unrealPct: round(a.pnl.totalKrwPct, 2),
    perSymbol: a.pnl.rows.map((r) => ({ symbol: r.symbol, krwPct: round(r.krwPct, 2), usdPct: round(r.usdPct, 2), fxTimingPp: round(r.fxTimingPp, 3) })),
    concentration: {
      top: a.conc.bySymbol[0] ? { symbol: a.conc.bySymbol[0].symbol, pct: round(a.conc.bySymbol[0].pct, 1) } : null,
      sectors: a.conc.bySector.map((s) => ({ sector: s.sector, pct: round(s.pct, 1) })),
      usdAssetPct: round(a.conc.byCurrency[0].pct, 1),
      cashPct: round(a.conc.cash.pct, 2),
      cashPctAlt: a.concAlt ? round(a.concAlt.conc.cash.pct, 2) : null,
    },
    stops: {
      policy: a.pol.policy, policyVersion: a.pol.version,
      heatPct: round(a.stops.heatPct, 2), usagePct: round(a.stops.usagePct, 0), over: a.stops.over,
      below: a.stops.belowSymbols, maxStopPct: a.stops.maxStopPct,
      dist: a.stops.rows.map((r) => ({ symbol: r.symbol, distPct: round(r.distPct, 2), underPct: round(r.underPct, 2), distPctUsd: round(r.distPctUsd, 2), underPctUsd: round(r.underPctUsd, 2) })),
    },
    reliability: {
      r1: a.snap.levelSegs.map((g) => ({ start: tsLabel(g.startTs), end: tsLabel(g.endTs), rows: g.rows, open: g.open, minRatioPct: round(g.minRatio * 100, 1) })),
      r1b: a.snap.transient.map((r) => ({ start: tsLabel(r.startTs), end: tsLabel(r.endTs), rows: r.rows })),
      r2: a.snap.usdFlip.patterns.map((p) => ({ start: tsLabel(p.startTs), end: tsLabel(p.endTs), rows: p.rows, flips: p.flips, xUsd: p.xUsd })),
      r3: a.snap.flows.events.map((e) => ({ at: tsLabel(e.curTs), type: e.type, pct: round(e.candidatePct, 2) })),
    },
    windows: a.windows.map((w) => ({ label: w.label, changePct: round(w.result?.changePct, 2), pricePct: round(w.result?.priceEffectPct, 2), flowPct: round(w.result?.externalCandidatePct, 2), otherPct: round(w.result?.otherPct, 2) })),
    appFilledOrders: a.appFilledOrders,
    questions: (() => { const q = buildQuestions(a); return { total: q.length, required: q.filter((x) => x.group === 'required').map((x) => x.n), optional: q.filter((x) => x.group === 'optional').map((x) => x.n), decision: q.filter((x) => x.group === 'decision').map((x) => x.n) }; })(),
    exitSwitch: a.exitSwitch.state,
    baselineNotes: a.baseline.notes.length,
  };
}
const round = (v, d) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/** 본문 해시 — 생성 시각 줄을 뺀다(재현성 확인용) */
export function bodyHash(md) {
  return crypto.createHash('sha256').update(md.split('\n').filter((l) => !l.startsWith('- 생성: ')).join('\n')).digest('hex').slice(0, 16);
}

// ─── CLI ──────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const o = { since: DEFAULT_SINCE, asOf: null, outDir: path.join(PROJECT_ROOT, 'agent-vault', '10-Flow', 'reports'), date: null, write: true, jsonSummary: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => { const x = argv[++i]; if (x === undefined) throw new ReportError('T069_ARGS', `${k} 값 없음`); return x; };
    if (k === '--since') o.since = v();
    else if (k === '--as-of') o.asOf = v();
    else if (k === '--out-dir') o.outDir = path.resolve(v());
    else if (k === '--date') o.date = v();
    else if (k === '--no-write') o.write = false;
    else if (k === '--json-summary') o.jsonSummary = true;
    else throw new ReportError('T069_ARGS', `알 수 없는 옵션: ${k}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.since)) throw new ReportError('T069_ARGS', '--since 는 YYYY-MM-DD');
  if (o.asOf !== null && !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(o.asOf)) throw new ReportError('T069_ARGS', '--as-of 는 "YYYY-MM-DD[ HH:MM[:SS]]"');
  if (o.date !== null && !/^\d{8}$/.test(o.date)) throw new ReportError('T069_ARGS', '--date 는 YYYYMMDD');
  return o;
}

/** .env 에서 DB_* 만 읽는다(값을 출력하지 않는다) */
export function readDbEnv(file) {
  const want = new Set(['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PWD', 'DB_NAME']);
  const e = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && want.has(m[1])) e[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  for (const k of want) if (!e[k] && k !== 'DB_PORT') throw new ReportError('T069_ENV', `.env 에 ${k} 없음`);
  return e;
}

/** 원자적 쓰기 — 임시 파일에 쓴 뒤 rename (기존 파일을 먼저 비우지 않는다) */
export function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

export async function run(argv, { connect, now = () => new Date(), log = console.log } = {}) {
  const opt = parseArgs(argv);
  const conn = await connect();
  let inputs;
  try {
    inputs = await loadInputs(conn, { since: opt.since, asOf: opt.asOf });
  } finally {
    await conn.end?.();
  }
  const generatedAt = now();
  const a = analyze(inputs, { generatedAt });
  const digest = inputDigest(inputs, { includeFx: a.baseline.usedFallbackFx });
  const md = renderMarkdown(inputs, a, { generatedAt, digest });
  // 파일명 = 기준 스냅샷 날짜 + id (같은 날 재실행이 다른 기준 행의 리포트를 덮어쓰지 않게 — L-6)
  const date = opt.date ?? String(a.latest.ts).slice(0, 10).replace(/-/g, '');
  const file = path.join(opt.outDir, `T-069-holdings-report-${date}-id${a.latest.id}.md`);
  if (opt.write) writeAtomic(file, md);
  const summary = buildSummary(a, digest);
  if (opt.jsonSummary) log(JSON.stringify(summary, null, 2));
  log(`[T-069] ${opt.write ? `리포트 저장: ${path.relative(PROJECT_ROOT, file)}` : '쓰기 생략(--no-write)'} · 스냅샷 id ${a.latest.id} · 입력 ${digest} · 본문 ${bodyHash(md)} · 읽기 전용 플래그 ${inputs.readOnlyFlag}`);
  return { file: opt.write ? file : null, md, summary, digest };
}

async function main() {
  const env = readDbEnv(path.join(PROJECT_ROOT, '.env'));
  const { default: mysql } = await import('mysql2/promise');
  await run(process.argv.slice(2), {
    connect: () => mysql.createConnection({
      host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PWD, database: env.DB_NAME,
      timezone: '+09:00', dateStrings: true, multipleStatements: false,
    }),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    // 오류 코드만 낸다(L-3) — mysql2 메시지 첫 줄에도 host:port·계정@IP 가 들어갈 수 있다.
    // 이 스크립트가 만든 ReportError(T069_*)만 고정 문구 메시지를 함께 낸다(접속 정보 없음).
    const code = e?.code ?? e?.name ?? 'ERROR';
    console.error('[T-069] 실패:', code, e instanceof ReportError ? e.message : '');
    process.exit(1);
  });
}

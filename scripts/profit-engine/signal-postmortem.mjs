#!/usr/bin/env node
// T-070 과거 시그널 사후검증 실행기 — **읽기 전용**. 계산은 같은 폴더 postmortem-core.js(시험 대상), 여기는 연결·파일 쓰기만.
//
// 사용: node scripts/profit-engine/signal-postmortem.mjs [--days 90] [--episode-days 5] [--out <경로.md>] [--json <경로.json>] [--env <.env 경로>] [--stdout]
//        [--entry-model legacy|d1open|d0close] [--as-of 'YYYY-MM-DD HH:MM:SS'] [--bars-until YYYY-MM-DD] [--no-compare]   (T-095, `--키=값` 도 된다)
//   기본 출력: agent-vault/10-Flow/reports/T-070-signal-postmortem-<KST YYYYMMDD>.md (legacy, 폴더가 없으면 만든다, 같은 날 재실행은 원자적으로 덮어쓴다)
//              일봉 진입 모델은 T-095-signal-postmortem-v2-<모델>-<KST YYYYMMDD>.md (v1 파일을 덮어쓰지 않는다)
//   --entry-model : legacy(기본, v1 과 같은 질의·계산·리포트) | d1open(D+1 시가 진입, 환율 무관) | d0close(D0 종가 진입, 환율 무관, 가격 없음 포함)
//   --as-of       : 시그널·주문 창의 끝을 KST 시각으로 고정(v1 재현용 — v1 은 2026-10-24 05:50 KST 생성)
//   --bars-until  : 이 날짜 뒤 일봉을 쓰지 않는다(새 봉 때문에 바뀐 수치를 가려내는 용도)
//
// 안전:
//   - DB 세션을 `SET SESSION TRANSACTION READ ONLY` 로 연 뒤 SELECT 만 보낸다. 모든 질의는 assertReadOnlySql 을 통과해야 나간다(이중 방어).
//   - 다중 문장 금지(multipleStatements: false). KIS·주문·앱 모듈을 부르지 않는다. LLM 0.
//   - DB 접속 정보는 프로젝트 .env 의 DB_HOST·DB_PORT·DB_USER·DB_PWD·DB_NAME (이미 설정된 환경변수가 우선).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import core from './postmortem-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

function parseArgs(argv) {
  const o = { days: 90, episodeDays: 5, out: null, json: null, env: path.join(ROOT, '.env'), stdout: false, entryModel: 'legacy', asOf: null, barsUntil: null, compare: true };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline;
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    if (eq > 0) { inline = a.slice(eq + 1); a = a.slice(0, eq); }
    const val = () => { if (inline !== undefined) return inline; const v = argv[++i]; if (v === undefined) throw new Error(`${a} 값 없음`); return v; };
    if (a === '--days') o.days = Number(val());
    else if (a === '--episode-days') o.episodeDays = Number(val());
    else if (a === '--out') o.out = path.resolve(val());
    else if (a === '--json') o.json = path.resolve(val());
    else if (a === '--env') o.env = path.resolve(val());
    else if (a === '--stdout') o.stdout = true;
    else if (a === '--entry-model') o.entryModel = val();
    else if (a === '--as-of') o.asOf = val();
    else if (a === '--bars-until') o.barsUntil = val();
    else if (a === '--no-compare') o.compare = false;
    else if (a === '-h' || a === '--help') { o.help = true; }
    else throw new Error(`알 수 없는 인자: ${a}`);
  }
  if (!Number.isInteger(o.days) || o.days < 1 || o.days > 365) throw new Error('--days 는 1..365 정수');
  if (!Number.isInteger(o.episodeDays) || o.episodeDays < 1 || o.episodeDays > 30) throw new Error('--episode-days 는 1..30 정수');
  if (!core.ENTRY_MODELS.includes(o.entryModel)) throw new Error(`--entry-model 은 ${core.ENTRY_MODELS.join('|')}`);
  if (o.asOf && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(o.asOf)) throw new Error("--as-of 는 'YYYY-MM-DD HH:MM:SS' (KST)");
  if (o.barsUntil && !/^\d{4}-\d{2}-\d{2}$/.test(o.barsUntil)) throw new Error('--bars-until 은 YYYY-MM-DD');
  return o;
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/** 원자적 쓰기: 임시 파일 → rename (쓰는 도중 실패해도 기존 파일이 비지 않는다). */
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log('node scripts/profit-engine/signal-postmortem.mjs [--days 90] [--episode-days 5] [--out <md>] [--json <json>] [--env <.env>] [--stdout]'
      + " [--entry-model legacy|d1open|d0close] [--as-of 'YYYY-MM-DD HH:MM:SS'] [--bars-until YYYY-MM-DD] [--no-compare]");
    return;
  }
  loadEnv(o.env);
  for (const k of ['DB_HOST', 'DB_USER', 'DB_NAME']) if (!process.env[k]) throw new Error(`${k} 없음(.env 확인)`);
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306), user: process.env.DB_USER,
    password: process.env.DB_PWD, database: process.env.DB_NAME,
    timezone: '+09:00', dateStrings: true, multipleStatements: false,
  });
  try {
    core.assertReadOnlySql('SET SESSION TRANSACTION READ ONLY');
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    const q = async (sql, params) => {
      core.assertReadOnlySql(sql);
      const [rows] = await conn.query(sql, params);
      return rows;
    };
    const now = new Date();
    const runOpts = { days: o.days, episodeDays: o.episodeDays, now };
    if (o.entryModel !== 'legacy') { runOpts.entryModel = o.entryModel; runOpts.compare = o.compare; }
    if (o.asOf) runOpts.asOf = o.asOf;
    if (o.barsUntil) runOpts.barsUntil = o.barsUntil;
    const { md, sum, verdicts, rec } = await core.runPostmortem(q, runOpts);
    const stamp = new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '');
    const base = o.entryModel === 'legacy' ? `T-070-signal-postmortem-${stamp}.md` : `T-095-signal-postmortem-v2-${o.entryModel}-${stamp}.md`;
    const out = o.out ?? path.join(ROOT, 'agent-vault/10-Flow/reports', base);
    if (o.stdout) process.stdout.write(md);
    else writeAtomic(out, md);
    if (o.json) writeAtomic(o.json, JSON.stringify({ sum, verdicts, rec }, null, 2));
    console.error(`[signal-postmortem] 모델 ${o.entryModel}${o.asOf ? ` · as-of ${o.asOf}` : ''} · 시그널 ${sum.totals.raw}건 · 에피소드 ${sum.totals.episodes}건 · 일봉 있는 에피소드 ${sum.states.ok || 0}건`
      + ` · 지배적 후보 ${verdicts.dominant.join(',') || '없음'} · rsi-oversold ${rec.verdict}${o.stdout ? '' : ` → ${path.relative(ROOT, out)}`}`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(`[signal-postmortem] 실패: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

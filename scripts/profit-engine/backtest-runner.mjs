#!/usr/bin/env node
// T-096 P3 일봉 백테스트 실행기 — **읽기 전용**. 흐름·관문은 backtest-runner-core.js(시험 대상), 여기는 DB·파일·git·엔진 로더 연결만.
//
// 사용: node scripts/profit-engine/backtest-runner.mjs --phase counts|is|oos [--market US|KR] [--strategy <id>|all]
//        [--as-of YYYY-MM-DD] [--engine-cache <저장소 밖 디렉터리>] [--unlock-oos <§B sha256>] [--env <.env 경로>] [--out <md>] [--json <json>]
//      node scripts/profit-engine/backtest-runner.mjs --print-registry-hash   (registry 수치 해시 H_r 출력 — DB·문서 불필요)
//   counts : 표본 수만(수익 계산 0) — 해시·마커가 달라도 허용.
//   is·oos : §B 해시·registry 수치 마커(H_r)·G1 기록(registry/g1-record.json, 사용자 승인)·--as-of = 등록 as-of 가 아니면 종료 코드 2.
//
// 안전:
//   - DB 세션을 `SET SESSION TRANSACTION READ ONLY` 로 연 뒤 SELECT 만 보낸다. 모든 질의는 assertReadOnlySql 을 통과해야 나간다(이중 방어).
//   - 다중 문장 금지(multipleStatements: false). KIS·주문·앱 모듈을 부르지 않는다. LLM 0. DB 쓰기 0.
//   - 관문(해시·마커·G1·원장)은 DB 접속 **전에** 판정한다.
//   - DB 접속 정보는 --env 로 준 .env 의 DB_HOST·DB_PORT·DB_USER·DB_PWD·DB_NAME (이미 설정된 환경변수가 우선). 값은 출력하지 않는다.
//   - TS 엔진은 typescript.transpileModule 로 --engine-cache(기본: OS 임시 디렉터리의 t096-backtest-engine-<uid>, 소유자 전용 0700) 아래에
//     CJS 로 옮겨 싣는다 — 허용 목록 밖 import 는 거부, 캐시 디렉터리가 심볼릭 링크·남의 소유·그룹/기타 권한이면 거부.
//   - git: rev-parse·ls-tree·cat-file 로 읽기만 한다(원장이 HEAD 본의 추가 전용 확장인지 대조·IS 원장에 HEAD 커밋 id 기록). 커밋·쓰기 없음.
//     is·oos 에서 git 조회가 실패하면 거부한다('HEAD 에 그 파일이 아직 없음'만 허용). counts 는 git 을 부르지 않는다.
//   - 엔진 지문 = 엔진 TS 소스 + 이 파일·backtest-runner-core.js·postmortem-core.js 의 바이트 — G1·IS·OOS 가 같은 지문이어야 한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);
const core = require('./backtest-runner-core.js');

function loadEnv(file) {
  if (!file || !fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/** 저장소 기준 상대경로만 받는다(코어가 넘기는 경로). 저장소 밖으로 나가면 거부. */
function abs(rel) {
  const p = path.resolve(ROOT, rel);
  if (p !== ROOT && !p.startsWith(`${ROOT}${path.sep}`)) throw new Error(`저장소 밖 경로 거부: ${rel}`);
  return p;
}

/** 원자적 쓰기: 임시 파일 → rename. */
function writeAtomic(rel, text) {
  const file = abs(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** 배타 생성(`wx`) — 이미 있으면 EEXIST 예외. */
function createExclusive(rel, text) {
  const file = abs(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'wx', 0o644);
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/**
 * git 읽기(R2-C1): HEAD 에 그 파일이 없으면 null, git 자체 실패(저장소 없음·다른 저장소·HEAD 없음·비정상 종료)는 예외 → is·oos 거부.
 * 구분은 로케일 문구가 아니라 `ls-tree` 의 종료 코드·출력으로 한다(구현·시험: core.makeGitIo). GIT_* 환경 변수는 무시한다.
 */
const { gitHead, gitHeadCommit } = core.makeGitIo({ execFileSync, fs, env: process.env }, ROOT);

async function main() {
  const opts = core.parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('node scripts/profit-engine/backtest-runner.mjs --phase counts|is|oos [--market US|KR] [--strategy <id>|all] [--as-of YYYY-MM-DD]'
      + ' [--engine-cache <dir>] [--unlock-oos <sha256>] [--env <.env>] [--out <md>] [--json <json>]  |  --print-registry-hash');
    return 0;
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const cacheDir = path.resolve(opts.engineCache || path.join(os.tmpdir(), `t096-backtest-engine-${uid ?? 'u'}`));
  if (cacheDir === ROOT || cacheDir.startsWith(`${ROOT}${path.sep}`)) throw new Error('--engine-cache 는 저장소 밖이어야 한다');
  core.ensureSafeCacheDir(fs, cacheDir, uid);
  const ts = require('typescript');
  const built = core.buildEngine({ ts, fs, path, crypto }, ROOT, cacheDir);
  const engine = require(built.entry);

  if (opts.printRegistryHash) {
    const registry = JSON.parse(fs.readFileSync(abs(core.PATHS.registry), 'utf8'));
    const errs = engine.validateRegistry(registry);
    if (errs.length) { for (const x of errs) console.error(`[backtest-runner] registry 오류: ${x}`); return 2; }
    console.log(`registry-numeric-sha256: ${engine.registryNumericSha256(registry)}`);
    console.error('[backtest-runner] 위 한 줄을 문서 §B 본문에 그대로 넣고 §B 해시를 다시 계산해 registry document.section_b_sha256 에 기록한다(H_r 계산에서 docHash 는 제외).');
    return 0;
  }

  const io = {
    readText: (rel) => fs.readFileSync(abs(rel), 'utf8'),
    exists: (rel) => fs.existsSync(abs(rel)),
    listReports: () => (fs.existsSync(abs(core.PATHS.reports)) ? fs.readdirSync(abs(core.PATHS.reports)) : []),
    writeAtomic,
    createExclusive,
    gitHead,
    gitHeadCommit,
    now: new Date(),
  };

  let conn = null;
  const q = async (sql, params) => {
    core.assertReadOnlySql(sql);
    if (!conn) {
      loadEnv(opts.env ? path.resolve(opts.env) : null);
      for (const k of ['DB_HOST', 'DB_USER', 'DB_NAME']) if (!process.env[k]) throw new Error(`${k} 없음(--env 확인)`);
      conn = await mysql.createConnection({
        host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306), user: process.env.DB_USER,
        password: process.env.DB_PWD, database: process.env.DB_NAME,
        timezone: '+09:00', dateStrings: true, multipleStatements: false,
      });
      core.assertReadOnlySql('SET SESSION TRANSACTION READ ONLY');
      await conn.query('SET SESSION TRANSACTION READ ONLY');
    }
    const [rows] = await conn.query(sql, params);
    return rows;
  };
  try {
    const r = await core.runPhase({ opts, engine, q, io, engineFingerprint: built.fingerprint });
    for (const w of r.warnings || []) console.error(`[backtest-runner] 경고: ${w}`);
    for (const n of r.notes || []) console.error(`[backtest-runner] 참고: ${n}`);
    if (r.code !== 0) {
      for (const x of r.reasons) console.error(`[backtest-runner] 거부: ${x}`);
      return r.code;
    }
    console.error(`[backtest-runner] ${opts.phase} 완료 · ${opts.market} · ${built.fingerprint.slice(0, 23)} · 엔진 파일 ${built.files.length}개(지문 대상 ${built.fingerprintFiles.length}개) → ${r.written.join(', ')}`);
    return 0;
  } finally {
    if (conn) await conn.end();
  }
}

main().then((code) => { process.exitCode = code; }).catch((e) => {
  console.error(`[backtest-runner] 실패: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});

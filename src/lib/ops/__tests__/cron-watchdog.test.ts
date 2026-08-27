/**
 * cron 워치독 판정·알림 로직 테스트 (T-037).
 *
 * 실제 알림은 보내지 않는다 — `reportVerdict` 에 send/reset 를 주입해 호출만 관찰한다.
 * (실계좌 프로젝트라 테스트가 텔레그램·슬랙을 건드리면 안 된다.)
 */
import {
  CRON_WATCHDOG_ALERT_KEY,
  CRON_WATCHDOG_RECOVERY_KEY,
  type HeartbeatVerdict,
  type WatchdogConfig,
  checkHeartbeatOnce,
  evaluateHeartbeat,
  reportVerdict,
  resolveWatchdogConfig,
  startCronWatchdog,
  stopCronWatchdog,
} from '@/lib/ops/cron-watchdog';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CFG: Pick<WatchdogConfig, 'staleAfterMs' | 'bootGraceMs'> = {
  staleAfterMs: 300_000,   // 5분
  bootGraceMs: 600_000,    // 10분
};

const NOW = 1_800_000_000_000;

function evalAt(over: Partial<Parameters<typeof evaluateHeartbeat>[0]> = {}): HeartbeatVerdict {
  return evaluateHeartbeat({
    now: NOW,
    bootAt: NOW - 60_000,
    content: null,
    mtimeMs: null,
    exists: false,
    readError: null,
    cfg: CFG,
    ...over,
  });
}

describe('evaluateHeartbeat', () => {
  it('최근 갱신이면 alive', () => {
    const v = evalAt({ exists: true, content: String((NOW - 30_000) / 1000) });
    expect(v).toEqual({ state: 'alive', ageMs: 30_000 });
  });

  it('임계 정확히 같으면 아직 alive (초과해야 stale)', () => {
    const v = evalAt({ exists: true, content: String((NOW - CFG.staleAfterMs) / 1000) });
    expect(v.state).toBe('alive');
  });

  it('임계 초과면 stale', () => {
    const v = evalAt({ exists: true, content: String((NOW - CFG.staleAfterMs - 1000) / 1000) });
    expect(v).toEqual({ state: 'stale', ageMs: CFG.staleAfterMs + 1000 });
  });

  it('2.5일 정지(이번 사고 재현)는 stale', () => {
    const outage = 2.5 * 24 * 3600 * 1000;
    const v = evalAt({ exists: true, content: String((NOW - outage) / 1000) });
    expect(v.state).toBe('stale');
  });

  it('파일 없음 + 부팅 유예 안이면 boot_grace (알리지 않는다)', () => {
    const v = evalAt({ exists: false, bootAt: NOW - 60_000 });
    expect(v.state).toBe('boot_grace');
  });

  it('🔴 파일 없음 + 부팅 유예 초과면 missing — "없으니 정상"으로 오판하지 않는다', () => {
    const v = evalAt({ exists: false, bootAt: NOW - CFG.bootGraceMs - 1000 });
    expect(v).toEqual({ state: 'missing', sinceBootMs: CFG.bootGraceMs + 1000 });
  });

  it('읽기 오류는 fail-closed 로 unreadable', () => {
    const v = evalAt({ exists: true, readError: 'EACCES: permission denied' });
    expect(v.state).toBe('unreadable');
  });

  it('내용이 깨졌으면 mtime 으로 폴백한다', () => {
    const v = evalAt({ exists: true, content: 'garbage', mtimeMs: NOW - 10_000 });
    expect(v).toEqual({ state: 'alive', ageMs: 10_000 });
  });

  it('내용도 mtime 도 없으면 unreadable', () => {
    const v = evalAt({ exists: true, content: 'garbage', mtimeMs: null });
    expect(v.state).toBe('unreadable');
  });

  it('미래 타임스탬프(시계 역전)는 age 0 으로 클램프 — 오탐 금지', () => {
    const v = evalAt({ exists: true, content: String((NOW + 999_000) / 1000) });
    expect(v).toEqual({ state: 'alive', ageMs: 0 });
  });
});

describe('reportVerdict — edge-trigger + 재알림', () => {
  const cfg = resolveWatchdogConfig({ heartbeatFile: '/tmp/hb', reAlertTtlMs: 1_800_000 });
  let sent: Array<{ key: string; level: string; title: string; body: string; ttl?: number }>;
  let resets: string[];
  const send = jest.fn((key: string, level: string, title: string, body: string, ttl?: number) => {
    sent.push({ key, level, title, body, ttl }); return true;
  }) as unknown as typeof import('@/lib/notify/throttle').sendAlertThrottled;
  const reset = jest.fn((key?: string) => { resets.push(key ?? '*'); }) as typeof import('@/lib/notify/throttle').resetAlertThrottle;

  beforeEach(() => { sent = []; resets = []; (send as jest.Mock).mockClear(); (reset as jest.Mock).mockClear(); });

  it('정상→장애 전이 시 스로틀을 리셋해 즉시 발사한다', () => {
    const phase = reportVerdict({ state: 'stale', ageMs: 900_000 }, 'up', cfg, send, reset);
    expect(phase).toBe('down');
    expect(resets).toContain(CRON_WATCHDOG_ALERT_KEY);
    expect(sent).toHaveLength(1);
    expect(sent[0].level).toBe('critical');
  });

  it('장애 지속 중에는 스로틀 리셋 없이 재알림만 시도한다', () => {
    reportVerdict({ state: 'stale', ageMs: 900_000 }, 'down', cfg, send, reset);
    expect(resets).not.toContain(CRON_WATCHDOG_ALERT_KEY);
    expect(sent).toHaveLength(1);
    expect(sent[0].ttl).toBe(cfg.reAlertTtlMs);
  });

  it('알림 본문이 "개별 잡 실패"가 아니라 "전체 정지"임을 명시한다', () => {
    reportVerdict({ state: 'stale', ageMs: 900_000 }, 'up', cfg, send, reset);
    expect(sent[0].title).toContain('자동매매 전체 정지');
    expect(sent[0].body).toContain('entry-watcher');
  });

  it('장애→복구 시 복구 통지 + 장애 키 리셋', () => {
    const phase = reportVerdict({ state: 'alive', ageMs: 5_000 }, 'down', cfg, send, reset);
    expect(phase).toBe('up');
    expect(resets).toContain(CRON_WATCHDOG_ALERT_KEY);
    expect(sent).toHaveLength(1);
    expect(sent[0].key).toBe(CRON_WATCHDOG_RECOVERY_KEY);
    expect(sent[0].level).toBe('info');
  });

  it('계속 정상이면 아무 알림도 보내지 않는다', () => {
    const phase = reportVerdict({ state: 'alive', ageMs: 5_000 }, 'up', cfg, send, reset);
    expect(phase).toBe('up');
    expect(sent).toHaveLength(0);
  });

  it('boot_grace 는 상태를 바꾸지도, 알리지도 않는다', () => {
    const phase = reportVerdict({ state: 'boot_grace', sinceBootMs: 1000 }, 'unknown', cfg, send, reset);
    expect(phase).toBe('unknown');
    expect(sent).toHaveLength(0);
  });

  it('🔴 알림 본문에 비밀정보가 섞일 경로가 없다 (자체 조립 문자열만)', () => {
    reportVerdict({ state: 'missing', sinceBootMs: 900_000 }, 'up', cfg, send, reset);
    const body = sent[0].body;
    expect(body).not.toMatch(/CRON_SECRET|APP_SECRET|TOKEN|PASSWORD|Bearer/i);
  });
});

describe('checkHeartbeatOnce — 실제 파일 IO', () => {
  let dir: string;
  beforeAll(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-')); });
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('없는 파일 + 유예 초과 → missing', async () => {
    const cfg = resolveWatchdogConfig({ heartbeatFile: path.join(dir, 'nope'), bootGraceMs: 0 });
    const v = await checkHeartbeatOnce(cfg, Date.now() - 10_000);
    expect(v.state).toBe('missing');
  });

  it('갓 쓴 파일 → alive', async () => {
    const f = path.join(dir, 'fresh');
    await fs.writeFile(f, `${Math.floor(Date.now() / 1000)}\n`);
    const cfg = resolveWatchdogConfig({ heartbeatFile: f });
    const v = await checkHeartbeatOnce(cfg, Date.now());
    expect(v.state).toBe('alive');
  });

  it('오래된 타임스탬프 → stale (QA 시나리오: 파일을 과거로 조작)', async () => {
    const f = path.join(dir, 'old');
    await fs.writeFile(f, `${Math.floor(Date.now() / 1000) - 86_400}\n`);
    const cfg = resolveWatchdogConfig({ heartbeatFile: f });
    const v = await checkHeartbeatOnce(cfg, Date.now());
    expect(v.state).toBe('stale');
  });
});

describe('startCronWatchdog — 중복 타이머 방지', () => {
  afterEach(() => stopCronWatchdog());

  it('두 번 호출해도 타이머는 하나만 등록된다', () => {
    expect(startCronWatchdog({ heartbeatFile: '/tmp/hb-x' })).toBe(true);
    expect(startCronWatchdog({ heartbeatFile: '/tmp/hb-x' })).toBe(false);
  });

  it('CRON_WATCHDOG_ENABLED=false 면 시작하지 않는다', () => {
    const prev = process.env.CRON_WATCHDOG_ENABLED;
    process.env.CRON_WATCHDOG_ENABLED = 'false';
    try {
      expect(startCronWatchdog({ heartbeatFile: '/tmp/hb-y' })).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CRON_WATCHDOG_ENABLED;
      else process.env.CRON_WATCHDOG_ENABLED = prev;
    }
  });
});

import { NextRequest, NextResponse, after } from 'next/server';
import { POST } from '@/app/api/cron/m40-forward/route';
import { checkCronAuth } from '@/lib/cron-auth';
import { initializeApprovedForwardPilot, runM40ForwardCycle } from '../forward-runtime';
import { loadPaperAccount, requirePaperDryRun } from '../forward-store';

jest.mock('next/server', () => ({ ...jest.requireActual('next/server'), after: jest.fn() }));
jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn() }));
jest.mock('../forward-runtime', () => ({ initializeApprovedForwardPilot: jest.fn(), runM40ForwardCycle: jest.fn() }));
jest.mock('../forward-store', () => ({ requirePaperDryRun: jest.fn(), loadPaperAccount: jest.fn() }));

const req = (query = '') => new NextRequest(`http://localhost/api/cron/m40-forward${query}`, { method: 'POST' });
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(checkCronAuth).mockReturnValue(undefined);
  jest.mocked(requirePaperDryRun).mockResolvedValue(undefined);
  jest.mocked(loadPaperAccount).mockResolvedValue({ book: { cashUsd: 123456, holdings: [{ symbol: 'NAS:SECRET' }] } } as never);
});

test('unauthorized requests perform no initialization, account access, or scheduling', async () => {
  jest.mocked(checkCronAuth).mockReturnValue(NextResponse.json({ ok: false }, { status: 401 }));
  expect((await POST(req('?initialize=1'))).status).toBe(401);
  expect(requirePaperDryRun).not.toHaveBeenCalled();
  expect(initializeApprovedForwardPilot).not.toHaveBeenCalled();
  expect(loadPaperAccount).not.toHaveBeenCalled();
  expect(after).not.toHaveBeenCalled();
});

test('initialization is explicit, response excludes copied balances and only promises scheduling', async () => {
  jest.mocked(initializeApprovedForwardPilot).mockResolvedValue({ book: { cashUsd: 123456 } } as never);
  const response = await POST(req('?initialize=1'));
  expect(response.status).toBe(202);
  const body = await response.json();
  expect(body).toEqual({ ok: true, scheduled: true, completed: false, executionScope: 'paper_only' });
  expect(JSON.stringify(body)).not.toMatch(/123456|NAS:SECRET|holdings|cashUsd/);
  expect(initializeApprovedForwardPilot).toHaveBeenCalledTimes(1);
  expect(runM40ForwardCycle).not.toHaveBeenCalled();
  expect(after).toHaveBeenCalledTimes(1);
  jest.mocked(runM40ForwardCycle).mockResolvedValue({ status: 'blocked' });
  await (jest.mocked(after).mock.calls[0][0] as () => Promise<void>)();
  expect(runM40ForwardCycle).toHaveBeenCalledTimes(1);
});

test('ordinary requests cannot initialize an uninitialized account', async () => {
  jest.mocked(loadPaperAccount).mockResolvedValue(null);
  const response = await POST(req());
  expect(response.status).toBe(503);
  expect(initializeApprovedForwardPilot).not.toHaveBeenCalled();
  expect(after).not.toHaveBeenCalled();
});

test('paused account is not scheduled and no account details are exposed', async () => {
  jest.mocked(loadPaperAccount).mockResolvedValue({ status: 'paused', book: { cashUsd: 123456 } } as never);
  const response = await POST(req());
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body).toMatchObject({ error: 'paper_account_paused', executionScope: 'paper_only' });
  expect(JSON.stringify(body)).not.toContain('123456');
  expect(after).not.toHaveBeenCalled(); expect(runM40ForwardCycle).not.toHaveBeenCalled();
});

test('dry-run failure cannot initialize or schedule and does not disclose errors', async () => {
  jest.mocked(requirePaperDryRun).mockRejectedValue(new Error('m40_forward_requires_dry_run'));
  const response = await POST(req('?initialize=1'));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: 'm40_forward_requires_dry_run', executionScope: 'paper_only' });
  expect(initializeApprovedForwardPilot).not.toHaveBeenCalled();
  expect(after).not.toHaveBeenCalled();
});

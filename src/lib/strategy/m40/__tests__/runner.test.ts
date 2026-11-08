import { runM40Analysis, type M40RunStore } from '../runner';
import { planM40 } from '../core';
import type { M40Input } from '../types';
import type { AdvisoryRequest, M40Evidence } from '../advisory';
import type { StoredJudgment } from '@/lib/analysis-data/types';

function fixture(): M40Input {
  const sessions: string[] = [];
  for (let date = new Date('2025-01-01T00:00:00Z'); sessions.length < 261; date.setUTCDate(date.getUTCDate() + 1)) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) sessions.push(date.toISOString().slice(0, 10));
  }
  const asOfSession = sessions[260];
  return { asOfSession, decisionTime: `${asOfSession}T23:00:00Z`, sessions,
    rebalanceEpochSession: sessions[0], marketBars: sessions.map((session, i) => ({ session, close: 100 + i,
      final: true, availableAt: `${session}T21:00:00Z`, priceBasis: 'index' })),
    universeComplete: true, members: [{ symbol: 'NAS:AAA', membership: 'eligible', bars: sessions.map((session, i) => ({ session,
      close: 100 + i, final: true, availableAt: `${session}T21:00:00Z`, priceBasis: 'split_adjusted' })),
    quote: { session: asOfSession, price: 360, availableAt: `${asOfSession}T21:00:00Z`, priceBasis: 'raw' } }],
    holdings: [], account: { equityUsd: 100_000, settledCashUsd: 100_000 } };
}

function memoryStore(): M40RunStore & { judgments: StoredJudgment[]; drafts: unknown[] } {
  const judgments: StoredJudgment[] = [];
  const drafts: unknown[] = [];
  return { judgments, drafts, saveAnalysisRun: jest.fn(async run => run.runId),
    putJudgment: jest.fn(async judgment => { judgments.push(judgment); }),
    findJudgment: jest.fn(async (stage, hash) => judgments.find(j => j.stage === stage && j.eventHash === hash) ?? null),
    putSignalDraft: jest.fn(async draft => { drafts.push(draft); }) };
}

function evidence(input: M40Input): M40Evidence[] {
  return [{ id: 'sec-1', kind: 'sec', symbol: 'NAS:AAA',
    publishedAt: `${input.asOfSession}T16:00:00Z`, observedAt: `${input.asOfSession}T17:00:00Z`,
    availableAt: `${input.asOfSession}T17:00:00Z`, sourceUrl: 'https://www.sec.gov/Archives/example', content: 'Filed public report.' }];
}
const respond = (_prompt: string, request: AdvisoryRequest) => Promise.resolve(JSON.stringify({ summary: request.stage,
  assessments: [{ symbol: 'NAS:AAA', proposedAction: 'sell', rationale: 'Shadow proposal.', sourceIds: ['sec-1'], risk: 'high' }],
  sourceIds: ['sec-1'], uncertainty: ['Limited evidence.'] }));

describe('M40 saved base plan and bounded shadow intervention', () => {
  it('never changes the base plan when all four agents propose a different action', async () => {
    const input = fixture(); const store = memoryStore(); const askAgent = jest.fn(respond);
    const result = await runM40Analysis({ input, evidence: evidence(input), triggers: ['material_event'],
      modelEnabled: true, modelPolicyVersion: 'fixture-model-v1' }, { store, askAgent });
    expect(result.plan).toEqual(planM40(input));
    expect(result.plan.decisions.some(d => d.action === 'buy')).toBe(true);
    expect(result.plan.decisions.some(d => d.action === 'sell')).toBe(false);
    expect(result.judgments.map(j => j.status)).toEqual(['shadow', 'shadow', 'shadow', 'shadow']);
    expect(askAgent).toHaveBeenCalledTimes(4);
    expect(store.drafts).toEqual(expect.arrayContaining([expect.objectContaining({ side: 'buy', status: 'shadow' })]));
    expect(result.executionMode).toBe('shadow');
  });

  it('reuses validated judgments for identical snapshots and preserves run idempotency', async () => {
    const input = fixture(); const store = memoryStore(); const askAgent = jest.fn(respond);
    const options = { input, evidence: evidence(input), triggers: ['material_event'] as const,
      modelEnabled: true, modelPolicyVersion: 'fixture-model-v1' };
    const first = await runM40Analysis(options, { store, askAgent });
    const second = await runM40Analysis(options, { store, askAgent });
    expect(second.runId).toBe(first.runId);
    expect(askAgent).toHaveBeenCalledTimes(4);
    expect(store.putJudgment).toHaveBeenCalledTimes(4);
  });

  it('falls back to unchanged base on timeout and never supplies future evidence', async () => {
    const input = fixture(); const store = memoryStore();
    const askAgent = jest.fn(() => new Promise<string>(() => {}));
    const result = await runM40Analysis({ input, evidence: evidence(input), triggers: ['material_event'],
      modelEnabled: true, modelPolicyVersion: 'fixture-v1', timeoutMs: 1 }, { store, askAgent });
    expect(result.plan).toEqual(planM40(input));
    expect(result.judgments.every(j => j.status === 'unknown')).toBe(true);
    const future = evidence(input); future[0].publishedAt = '2099-01-01T00:00:00Z';
    askAgent.mockClear();
    const blocked = await runM40Analysis({ input, evidence: future, triggers: ['material_event'],
      modelEnabled: true, modelPolicyVersion: 'future-fixture' }, { store, askAgent });
    expect(askAgent).not.toHaveBeenCalled();
    expect(blocked.plan).toEqual(result.plan);
    expect(blocked.judgments.every(j => j.status === 'unknown')).toBe(true);
  });

  it('does not call a provider by default or treat unversioned models as enabled', async () => {
    const input = fixture(); const askAgent = jest.fn(respond);
    await runM40Analysis({ input, evidence: evidence(input), triggers: ['material_event'] }, { store: memoryStore(), askAgent });
    await runM40Analysis({ input, modelEnabled: true, evidence: evidence(input), triggers: ['material_event'] }, { store: memoryStore(), askAgent });
    expect(askAgent).not.toHaveBeenCalled();
  });

  it('derives the current 20-session query start and excludes references whose outcomes reach that window', async () => {
    const input = fixture();
    const patterns = [0, 1, 2].map(i => ({ id: `p${i}`, episodeId: `e${i}`, symbol: 'NAS:AAA', similarity: 0.95, windowSessions: 20 as const,
      startSession: `202${i + 2}-01-01`, endSession: `202${i + 2}-02-01`, outcomeEndSession: `202${i + 2}-03-01`,
      availableAt: '2025-01-02T00:00:00Z' }));
    const mature = await runM40Analysis({ input, patterns }, { store: memoryStore() });
    expect(mature.queryStartSessionByWindow).toEqual({ 20: input.sessions[241], 60: input.sessions[201] });
    expect(mature.patterns).toHaveLength(3);
    const immature = { ...patterns[2], endSession: input.sessions[230], outcomeEndSession: input.sessions[241],
      availableAt: `${input.asOfSession}T21:00:00Z` };
    const excluded = await runM40Analysis({ input, patterns: [...patterns.slice(0, 2), immature] }, { store: memoryStore() });
    expect(excluded.patterns).toEqual([]);
    expect(excluded.plan).toEqual(mature.plan);
    const legacy = { ...patterns[2] };
    delete (legacy as Partial<typeof legacy>).outcomeEndSession;
    const legacyExcluded = await runM40Analysis({ input, patterns: [...patterns.slice(0, 2), legacy] }, { store: memoryStore() });
    expect(legacyExcluded.patterns).toEqual([]);
  });

  it('uses D0-59 for 60-session references instead of the looser D0-19 boundary', async () => {
    const input = fixture();
    const references = [0, 1, 2].map(i => ({ id: `p${i}`, episodeId: `e${i}`, symbol: 'NAS:AAA',
      windowSessions: 60 as const, similarity: 0.95, startSession: `202${i + 2}-01-01`,
      endSession: `202${i + 2}-04-01`, outcomeEndSession: `202${i + 2}-05-01`, availableAt: '2025-01-02T00:00:00Z' }));
    const mature = await runM40Analysis({ input, patterns: references }, { store: memoryStore() });
    expect(mature.queryStartSessionByWindow[60]).toBe(input.sessions[201]);
    expect(mature.patterns).toHaveLength(3);
    const overlaps60 = { ...references[2], endSession: input.sessions[195], outcomeEndSession: input.sessions[220],
      availableAt: `${input.asOfSession}T21:00:00Z` };
    const rejected = await runM40Analysis({ input, patterns: [...references.slice(0, 2), overlaps60] }, { store: memoryStore() });
    expect(rejected.patterns).toEqual([]);
    expect(rejected.plan).toEqual(mature.plan);
  });
});

it('retains the exact optional context and source failures without changing the base plan',async()=>{
 const input=fixture(),store=memoryStore(),askAgent=jest.fn(respond);
 const result=await runM40Analysis({input,evidence:[],triggers:['optional_data_gap'],optionalDataIssues:['operating_evidence_unavailable'],modelEnabled:true,modelPolicyVersion:'fixture-model-v1'},{store,askAgent});
 expect(result.plan).toEqual(planM40(input));expect(askAgent).not.toHaveBeenCalled();
 for(const row of result.judgments)expect(row.payload).toEqual(expect.objectContaining({coverageIssues:['operating_evidence_unavailable'],request:expect.objectContaining({decisionTime:input.decisionTime,evidence:[]})}));
});

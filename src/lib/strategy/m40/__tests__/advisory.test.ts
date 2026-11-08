import {
  contentHash, eligiblePatternReferences, parseAdvisoryAnswer, validateEvidence,
  type AdvisoryRequest, type M40Evidence, type M40PatternReference, type M40PatternQueryStarts,
} from '../advisory';

const evidence: M40Evidence = { id: 'filing-1', symbol: 'NAS:AAA', kind: 'sec',
  availableAt: '2026-11-06T18:00:00Z', publishedAt: '2026-11-06T17:00:00Z',
  observedAt: '2026-11-06T18:00:00Z', sourceUrl: 'https://www.sec.gov/Archives/example', content: 'A public filing.' };
const cutoff = '2026-11-06T22:00:00Z';
const queryStarts: M40PatternQueryStarts = { 20: '2026-10-12', 60: '2026-08-17' };
const request = { stage: 'interpretation', evidence: [evidence], base: { candidates: [{ symbol: 'NAS:AAA' }] } } as AdvisoryRequest;
const answer = () => ({ summary: 'Review the filing.', assessments: [{ symbol: 'NAS:AAA',
  proposedAction: 'hold', rationale: 'Uncertainty remains.', sourceIds: ['filing-1'], risk: 'unknown' }],
sourceIds: ['filing-1'], uncertainty: ['No future price is supplied.'] });

describe('M40 optional evidence and structured shadow judgments', () => {
  it('uses stable object order and rejects nonfinite or ambiguous snapshots', () => {
    expect(contentHash({ b: 2, a: 1 })).toBe(contentHash({ a: 1, b: 2 }));
    expect(() => contentHash({ a: NaN })).toThrow('nonfinite');
    expect(() => contentHash({ a: undefined })).toThrow('undefined');
  });

  it('rejects future, unknown timezone, and availability earlier than observation', () => {
    expect(validateEvidence([evidence], cutoff)).toBeNull();
    expect(validateEvidence([{ ...evidence, observedAt: '2026-11-07T00:00:00Z' }], cutoff)).toContain('future');
    expect(validateEvidence([{ ...evidence, availableAt: '2026-11-06 18:00:00' }], cutoff)).toContain('future');
    expect(validateEvidence([{ ...evidence, availableAt: '2026-11-06T17:00:00Z' }], cutoff)).toContain('precedes');
    expect(validateEvidence([{ ...evidence, publishedAt: '2026-10-01T00:00:00Z' }], cutoff)).toContain('14_day');
  });

  it('requires known evidence for each assessment and disallows numeric rule overrides', () => {
    expect(parseAdvisoryAnswer(JSON.stringify(answer()), request).assessments).toHaveLength(1);
    expect(() => parseAdvisoryAnswer(JSON.stringify({ ...answer(), score: 100 }), request)).toThrow('schema');
    const invented = answer(); invented.assessments[0].sourceIds = ['not-supplied'];
    expect(() => parseAdvisoryAnswer(JSON.stringify(invented), request)).toThrow('unknown_source');
    const unknown = answer(); unknown.assessments[0].symbol = 'NAS:OTHER';
    expect(() => parseAdvisoryAnswer(JSON.stringify(unknown), request)).toThrow('assessment');
  });

  it('does not count duplicated pattern episodes and rejects future references', () => {
    const p = (id: string, episodeId = id): M40PatternReference => ({ id, episodeId, symbol: 'NAS:AAA',
      similarity: 0.95, windowSessions: 20, startSession: `202${episodeId === 'a' ? 2 : episodeId === 'b' ? 3 : 4}-01-01`,
      endSession: `202${episodeId === 'a' ? 2 : episodeId === 'b' ? 3 : 4}-06-30`,
      outcomeEndSession: `202${episodeId === 'a' ? 2 : episodeId === 'b' ? 3 : 4}-08-01`, availableAt: '2025-01-02T00:00:00Z' });
    const references = [p('a'), p('b'), p('c')];
    expect(eligiblePatternReferences([p('a'), p('a2', 'a'), p('b')], cutoff, '2026-11-06', queryStarts)).toEqual([]);
    expect(eligiblePatternReferences(references, cutoff, '2026-11-06', queryStarts)).toHaveLength(3);
    expect(eligiblePatternReferences([p('a'), p('b'), { ...p('c'), startSession: '2023-07-15' }], cutoff, '2026-11-06', queryStarts)).toEqual([]);
    expect(eligiblePatternReferences([p('a'), p('b'), { ...p('c'), endSession: '2026-11-06' }], cutoff, '2026-11-06', queryStarts)).toEqual([]);
  });

  it('requires the complete prior outcome window to end before the current query begins', () => {
    const references = [0, 1, 2].map(i => ({ id: `p${i}`, episodeId: `e${i}`, symbol: 'NAS:AAA', similarity: 0.95, windowSessions: 20 as const,
      startSession: `202${i + 2}-01-01`, endSession: `202${i + 2}-02-01`, outcomeEndSession: `202${i + 2}-03-01`,
      availableAt: '2025-01-02T00:00:00Z' }));
    expect(eligiblePatternReferences(references, cutoff, '2026-11-06', null)).toEqual([]);
    expect(eligiblePatternReferences(references, cutoff, '2026-11-06', { ...queryStarts, 20: '2026-02-30' })).toEqual([]);
    const immature = { ...references[2], endSession: '2026-10-01', outcomeEndSession: '2026-10-12', availableAt: cutoff };
    // The outcome is complete by D0, but intersects the query: exclude it and fail the minimum-three condition.
    expect(eligiblePatternReferences([...references.slice(0, 2), immature], cutoff, '2026-11-06', queryStarts)).toEqual([]);
    const missingMaturity = { ...references[2] };
    delete (missingMaturity as Partial<M40PatternReference>).outcomeEndSession;
    expect(eligiblePatternReferences([...references.slice(0, 2), missingMaturity], cutoff, '2026-11-06', queryStarts)).toEqual([]);
    expect(eligiblePatternReferences(references, cutoff, '2026-11-06', queryStarts)).toHaveLength(3);
  });

  it('uses each reference window boundary and never pools 20/60-session minimum samples', () => {
    const references: M40PatternReference[] = [0, 1, 2].map(i => ({ id: `p${i}`, episodeId: `e${i}`,
      symbol: 'NAS:AAA', similarity: 0.95, windowSessions: 60,
      startSession: `202${i + 2}-01-01`, endSession: `202${i + 2}-04-01`, outcomeEndSession: `202${i + 2}-05-01`,
      availableAt: '2025-01-02T00:00:00Z' }));
    expect(eligiblePatternReferences(references, cutoff, '2026-11-06', queryStarts)).toHaveLength(3);
    // After the 60-session query start but before its 20-session counterpart: still leaks the 60-session query.
    const overlaps60 = { ...references[2], endSession: '2026-08-01', outcomeEndSession: '2026-09-01', availableAt: cutoff };
    expect(eligiblePatternReferences([...references.slice(0, 2), overlaps60], cutoff, '2026-11-06', queryStarts)).toEqual([]);
    expect(eligiblePatternReferences([references[0], references[1], { ...references[2], windowSessions: 20 }], cutoff, '2026-11-06', queryStarts)).toEqual([]);
    expect(eligiblePatternReferences(references, cutoff, '2026-11-06', { ...queryStarts, 60: null })).toEqual([]);
    const unknownLength = { ...references[2] };
    delete (unknownLength as Partial<M40PatternReference>).windowSessions;
    expect(eligiblePatternReferences([...references.slice(0, 2), unknownLength], cutoff, '2026-11-06', queryStarts)).toEqual([]);
  });
});

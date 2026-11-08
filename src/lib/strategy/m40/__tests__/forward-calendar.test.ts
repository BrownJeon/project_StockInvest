import {
  assertForwardCalendar, extendForwardCalendar, nextPaperSettlementSession,
  normalizeForwardUtc, PAPER_SETTLEMENT_MODEL,
} from '../forward-calendar';
import type { ForwardCalendarSession } from '../forward-types';

const historical:ForwardCalendarSession[]=[{session:'2025-12-31',openAt:'2025-12-31T14:30:00Z',
  closeAt:'2025-12-31T21:00:00Z',source:'historical_canonical'}];
const calendar=extendForwardCalendar(historical,'2027-12-31');
const byDay=new Map(calendar.map(item=>[item.session,item]));

describe('forward NYSE calendar metadata',()=>{
  test.each(['2026-01-01','2026-04-03','2026-06-19','2026-07-03','2026-11-26','2026-12-25',
    '2027-01-01','2027-03-26','2027-06-18','2027-07-05','2027-11-25','2027-12-24'])(
    'excludes the official full closure %s',day=>expect(byDay.has(day)).toBe(false));

  test.each(['2026-11-27','2026-12-24','2027-11-26'])('keeps the 13:00 ET half-session %s',day=>{
    expect(byDay.get(day)).toMatchObject({openAt:`${day}T14:30:00.000Z`,closeAt:`${day}T18:00:00.000Z`,source:'nyse_official_2026_2027'});
  });

  test.each(['2026-07-02','2027-07-02'])('does not invent an Independence Day early close on %s',day=>{
    expect(byDay.get(day)?.closeAt).toBe(`${day}T20:00:00.000Z`);
  });

  test.each([
    ['2026-03-06','14:30','21:00'],['2026-03-09','13:30','20:00'],
    ['2026-10-30','13:30','20:00'],['2026-11-02','14:30','21:00'],
    ['2027-03-12','14:30','21:00'],['2027-03-15','13:30','20:00'],
    ['2027-11-05','13:30','20:00'],['2027-11-08','14:30','21:00'],
  ])('maps the actual ET session %s through DST', (day,open,close)=>{
    expect(byDay.get(day)?.openAt).toBe(`${day}T${open}:00.000Z`);
    expect(byDay.get(day)?.closeAt).toBe(`${day}T${close}:00.000Z`);
  });

  test('a known future schedule has no price or receipt observations',()=>{
    const future=byDay.get('2027-11-26')!;
    expect(future).not.toHaveProperty('observedAt');
    expect(future).not.toHaveProperty('price');
    expect(future).not.toHaveProperty('final');
  });

  test('rejects malformed, gapped or conflicting schedules instead of silently counting phantom sessions',()=>{
    const gap=calendar.filter(item=>item.session!=='2026-11-10');
    expect(()=>assertForwardCalendar(gap)).toThrow('forward_calendar_gap');
    const conflict=calendar.map(item=>item.session==='2026-11-27'?{...item,closeAt:'2026-11-27T21:00:00Z'}:item);
    expect(()=>assertForwardCalendar(conflict)).toThrow('nyse_calendar_conflict');
    expect(()=>assertForwardCalendar([...historical,...historical])).toThrow('invalid_forward_calendar');
    expect(()=>extendForwardCalendar(historical,'2028-01-01')).toThrow('forward_calendar_year_unsupported');
  });

  test('retains supplied historical sessions and never mutates them',()=>{
    const before=JSON.stringify(historical);
    const result=extendForwardCalendar(historical,'2026-01-05');
    expect(JSON.stringify(historical)).toBe(before);
    expect(result.map(item=>item.session)).toEqual(['2025-12-31','2026-01-02','2026-01-05']);
    expect(result[0]).toEqual(historical[0]);
  });

  test('normalizes valid clock precision without inventing a date-only observation',()=>{
    expect(normalizeForwardUtc('2026-11-09T22:00:00.123456Z')).toBe('2026-11-09T22:00:00.123456Z');
    expect(normalizeForwardUtc('2026-11-09T22:00:00Z')).toBe('2026-11-09T22:00:00.000000Z');
    expect(normalizeForwardUtc('2026-11-09')).toBeNull();
    expect(normalizeForwardUtc('2026-02-30T22:00:00Z')).toBeNull();
  });
});

describe('conservative paper settlement dates',()=>{
  test.each([
    ['2026-10-09','2026-10-13'],['2026-11-10','2026-11-12'],
    ['2027-10-08','2027-10-12'],['2027-11-10','2027-11-12'],
    ['2026-11-25','2026-11-27'],['2026-11-27','2026-11-30'],
  ])('holds receivables from %s until the model date %s',(trade,settlement)=>{
    expect(nextPaperSettlementSession(calendar,trade)).toBe(settlement);
  });

  test('bank-only closures remain NYSE analysis sessions and the model is not a KIS assertion',()=>{
    expect(byDay.has('2026-11-11')).toBe(true);
    expect(byDay.has('2027-10-11')).toBe(true);
    expect(PAPER_SETTLEMENT_MODEL).toContain('not_verified_kis');
  });

  test('unknown year-end observance and dates beyond the calendar fail closed',()=>{
    expect(()=>nextPaperSettlementSession(calendar,'2027-12-30')).toThrow('paper_settlement_bank_calendar_uncertain');
    expect(()=>nextPaperSettlementSession(calendar,'2027-12-31')).toThrow('paper_settlement_calendar_exhausted');
    expect(()=>nextPaperSettlementSession(calendar,'2026-11-26')).toThrow('paper_settlement_session_unknown');
  });
});

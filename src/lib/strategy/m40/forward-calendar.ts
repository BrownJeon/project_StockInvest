import type { ForwardCalendarSession } from './forward-types';

/** NYSE equity sessions, checked against the official 2026/2027 table. */
export const FORWARD_NYSE_CALENDAR_SOURCE = 'https://www.nyse.com/trade/hours-calendars';
const HOLIDAYS = new Set([
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25',
  '2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31',
  '2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24',
]);
const HALF_DAYS = new Set(['2026-11-27','2026-12-24','2027-11-26']);
const NYSE_OPEN_BANK_HOLIDAYS = new Set(['2026-10-12','2026-11-11','2027-10-11','2027-11-11']);
const NY_OFFSET = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'shortOffset'});
export const PAPER_SETTLEMENT_MODEL = 'conservative_nyse_and_bank_open_t_plus_1_not_verified_kis';

export function validForwardSessionDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value;
}
export function normalizeForwardUtc(value: unknown): string | null {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?Z$/.test(value)
    || !validForwardSessionDate(value.slice(0,10))) return null;
  return `${value.slice(0,19)}.${value.slice(19,-1).replace(/^\./,'').padEnd(6,'0')}Z`;
}
const nextDay = (day:string):string => new Date(Date.parse(`${day}T00:00:00Z`)+86_400_000).toISOString().slice(0,10);
function inOfficialRange(day:string):boolean { return day >= '2026-01-01' && day <= '2027-12-31'; }
function officialTradingDay(day:string):boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !HOLIDAYS.has(day);
}
function officialSession(day:string):ForwardCalendarSession {
  const offset = NY_OFFSET.formatToParts(new Date(`${day}T12:00:00Z`)).find(part=>part.type==='timeZoneName')?.value;
  if (offset !== 'GMT-4' && offset !== 'GMT-5') throw new Error('unsupported_nyse_offset');
  const utcOffset = offset === 'GMT-4' ? 4 : 5;
  const at = (hours:number,minutes=0):string => new Date(Date.parse(`${day}T00:00:00Z`)
    +((hours+utcOffset)*60+minutes)*60_000).toISOString();
  return {session:day,openAt:at(9,30),closeAt:at(HALF_DAYS.has(day)?13:16),
    source:'nyse_official_2026_2027',sourceUrl:FORWARD_NYSE_CALENDAR_SOURCE};
}

export function assertForwardCalendar(calendar:readonly ForwardCalendarSession[]):void {
  if (!calendar.length) throw new Error('forward_calendar_empty');
  for (const [index,item] of calendar.entries()) {
    const open=normalizeForwardUtc(item.openAt),close=normalizeForwardUtc(item.closeAt);
    const weekday=validForwardSessionDate(item.session)?new Date(`${item.session}T00:00:00Z`).getUTCDay():-1;
    if (!validForwardSessionDate(item.session) || !open || !close || open>=close
      || open.slice(0,10)!==item.session || close.slice(0,10)!==item.session || weekday===0 || weekday===6
      || !['historical_canonical','nyse_official_2026_2027'].includes(item.source)
      || (index>0 && calendar[index-1].session>=item.session)) throw new Error('invalid_forward_calendar');
    if (inOfficialRange(item.session)) {
      const official=officialSession(item.session);
      if (!officialTradingDay(item.session) || open!==normalizeForwardUtc(official.openAt)
        || close!==normalizeForwardUtc(official.closeAt)) throw new Error('nyse_calendar_conflict');
    } else if (item.source!=='historical_canonical') throw new Error('forward_calendar_year_unsupported');
    if (index>0) for(let missing=nextDay(calendar[index-1].session);missing<item.session;missing=nextDay(missing)) {
      if (inOfficialRange(missing)&&officialTradingDay(missing)) throw new Error('forward_calendar_gap');
    }
  }
}

/** Extend schedule metadata only. Future sessions are never price observations. */
export function extendForwardCalendar(
  historical:readonly ForwardCalendarSession[], throughSession:string,
):ForwardCalendarSession[] {
  if (!validForwardSessionDate(throughSession)) throw new Error('invalid_forward_calendar_through');
  assertForwardCalendar(historical);
  const out=historical.filter(item=>item.session<=throughSession).map(item=>({...item}));
  if (!out.length) throw new Error('forward_calendar_history_required');
  for(let day=nextDay(out[out.length-1].session);day<=throughSession;day=nextDay(day)) {
    if (!inOfficialRange(day)) throw new Error('forward_calendar_year_unsupported');
    if (officialTradingDay(day)) out.push(officialSession(day));
  }
  return out;
}

/** Conservative paper model, not an assertion of KIS settlement availability. */
export function nextPaperSettlementSession(calendar:readonly ForwardCalendarSession[],tradeSession:string):string {
  assertForwardCalendar(calendar);
  if (!calendar.some(item=>item.session===tradeSession) || !inOfficialRange(tradeSession)) throw new Error('paper_settlement_session_unknown');
  for (const item of calendar) if(item.session>tradeSession) {
    if (!inOfficialRange(item.session)) throw new Error('paper_settlement_year_unsupported');
    // Published Fed schedules need reconciliation for this year-end observance.
    if (item.session==='2027-12-31') throw new Error('paper_settlement_bank_calendar_uncertain');
    if (!NYSE_OPEN_BANK_HOLIDAYS.has(item.session)) return item.session;
  }
  throw new Error('paper_settlement_calendar_exhausted');
}

/** Read-only schedule lookup; never an observation or settlement authorization. */
export function readForwardCalendarRange(from:string,to:string):ForwardCalendarSession[]|null {
  if(!validForwardSessionDate(from)||!validForwardSessionDate(to)||from>to
    ||!inOfficialRange(from)||!inOfficialRange(to)
    ||(Date.parse(to)-Date.parse(from))/86_400_000>731)return null;
  const out:ForwardCalendarSession[]=[];
  for(let day=from;day<=to;day=nextDay(day))if(officialTradingDay(day))out.push(officialSession(day));
  return out;
}

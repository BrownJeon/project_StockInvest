/** Actual database publication clock is separate from the fixed known-input issue clock. */
import type { ArchiveQueryable } from '@/lib/analysis-data/types';
import type { ForwardCalendarSession } from './forward-types';
import { assertForwardCalendar,normalizeForwardUtc } from './forward-calendar';
export function paperPublicationDeadline(calendar:readonly ForwardCalendarSession[],session:string):string {
 assertForwardCalendar(calendar);
 if(!calendar.some(day=>day.session===session))throw Error('paper_publication_calendar_missing');
 const next=calendar.find(day=>day.session>session),deadline=normalizeForwardUtc(next?.openAt);
 if(!deadline)throw Error('paper_publication_calendar_missing');return deadline;
}
export async function assertPublicationWindow(calendar:readonly ForwardCalendarSession[],session:string,db:ArchiveQueryable,scope:'paper'|'forecast') {
 const deadline=paperPublicationDeadline(calendar,session);
 const [clock]=await db.query<Record<string,unknown>[]>("SELECT DATE_FORMAT(UTC_TIMESTAMP(6),'%Y-%m-%dT%H:%i:%s.%fZ') publicationNow");
 const actual=normalizeForwardUtc(clock[0]?.publicationNow);
 if(!actual)throw Error(`${scope}_publication_clock_unavailable`);
 if(actual>=deadline)throw Error(`${scope}_publication_deadline_elapsed`);
}

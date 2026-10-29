import ICAL from 'ical.js';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

/** Read-only, private CalDAV access. No provider credentials or response bodies are logged. */
export interface ICloudCalendar { id: string; displayName: string; color?: string; }
export interface ICloudEvent {
  providerId: string; uid: string; calendarId: string; calendarTitle: string;
  /** Combine with an exact or explicitly linked calendar identity; never dedupe on this key alone. */
  occurrenceKey: string;
  providerSequence?: number; providerModifiedAt?: string;
  title: string; startAt: string; endAt: string; allDay: boolean;
  status: 'confirmed' | 'tentative'; location?: string; notes?: string; color?: string;
}
export class ICloudError extends Error {
  code: string; safeMessage: string; status: number;
  constructor(code: string, message: string, status = 502) { super(message); this.name = 'ICloudError'; this.code = code; this.safeMessage = message; this.status = status; }
}
interface Credentials { username: string; password: string; fetch?: typeof fetch; }
interface EventInput extends Credentials { calendars: ICloudCalendar[]; windowStart: string; windowEnd: string; }
type Xml = Record<string, unknown>;
type CalTime = InstanceType<typeof ICAL.Time>;
type CalEvent = InstanceType<typeof ICAL.Event>;
type CalComponent = InstanceType<typeof ICAL.Component>;
const ROOT = 'https://caldav.icloud.com/';
const MAX_BYTES = 2_000_000, MAX_CALENDARS = 50, MAX_SELECTED = 8, MAX_OBJECTS = 500, MAX_EVENTS = 1500;
const XML = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: false, processEntities: true });
const asObject = (v: unknown): Xml => v && typeof v === 'object' && !Array.isArray(v) ? v as Xml : {};
const list = (v: unknown): unknown[] => v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
const value = (v: unknown): string => typeof v === 'string' ? v : typeof asObject(v)['#text'] === 'string' ? asObject(v)['#text'] as string : '';
const text = (v: unknown, max: number): string => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
const propfind = (body: string) => `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop>${body}</d:prop></d:propfind>`;

export function validateAppleCalendarUrl(raw: string, base = ROOT): string {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\r\n\u0000]/.test(raw)) throw new ICloudError('unsafe_calendar_url', 'Apple returned an unsupported calendar address.');
  let u: URL; try { u = new URL(raw, base); } catch { throw new ICloudError('unsafe_calendar_url', 'Apple returned an invalid calendar address.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || (u.port && u.port !== '443') || !/^(?:caldav|p\d{1,3}-caldav)\.icloud\.com$/i.test(u.hostname)) {
    throw new ICloudError('unsafe_calendar_url', 'Calendar requests are restricted to Apple’s private iCloud calendar servers.');
  }
  return u.href;
}

function context(input: Credentials) {
  if (typeof input.username !== 'string' || input.username.length > 254 || !input.username.trim() || /[:\r\n]/.test(input.username) || typeof input.password !== 'string' || input.password.length > 200 || !input.password.trim()) {
    throw new ICloudError('invalid_credentials', 'Enter your Apple Account email and an app-specific password.', 400);
  }
  const bytes = new TextEncoder().encode(input.username.trim() + ':' + input.password.trim());
  let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
  const authorization = 'Basic ' + btoa(binary);
  const fetcher = input.fetch ?? fetch;
  const deadline = Date.now() + 45_000; let calls = 0;
  return async function request(raw: string, method: 'PROPFIND' | 'REPORT', body: string, depth: '0' | '1' = '0'): Promise<{ body: string; url: string }> {
    let url = validateAppleCalendarUrl(raw);
    for (let redirect = 0; redirect <= 2; redirect++) {
      if (++calls > 14 || Date.now() >= deadline) throw new ICloudError('calendar_limit', 'The calendar request exceeded its safe limit. Try fewer selected calendars.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(12_000, deadline - Date.now()));
      try {
        const response = await fetcher(url, { method, redirect: 'manual', signal: controller.signal, headers: { Authorization: authorization, 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml, text/xml', Depth: depth }, body });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('Location'); await response.body?.cancel();
          if (!location || redirect === 2) throw new ICloudError('calendar_redirect', 'Apple’s calendar redirect could not be completed.');
          url = validateAppleCalendarUrl(location, url); continue;
        }
        if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw new ICloudError('authentication_failed', 'Apple did not accept this login. Use an Apple app-specific password, not your normal Apple Account password.', 401); }
        if (response.status === 429) { await response.body?.cancel(); throw new ICloudError('rate_limited', 'Apple is limiting calendar requests. Wait a few minutes before trying again.', 429); }
        if (![200, 207].includes(response.status)) { await response.body?.cancel(); throw new ICloudError('calendar_unavailable', 'Apple’s calendar service could not complete the request. Please try again later.'); }
        const length = Number(response.headers.get('Content-Length')); if (length > MAX_BYTES) { await response.body?.cancel(); throw new ICloudError('calendar_limit', 'This calendar response is too large. Select fewer calendars.'); }
        const reader = response.body?.getReader(); if (!reader) throw new ICloudError('invalid_response', 'Apple returned an empty calendar response.');
        const chunks: Uint8Array[] = []; let size = 0;
        try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BYTES) { await reader.cancel(); throw new ICloudError('calendar_limit', 'This calendar response is too large. Select fewer calendars.'); } chunks.push(part.value); } } finally { reader.releaseLock(); }
        const all = new Uint8Array(size); let at = 0; for (const chunk of chunks) { all.set(chunk, at); at += chunk.byteLength; }
        return { body: new TextDecoder().decode(all), url };
      } catch (error) {
        if (error instanceof ICloudError) throw error;
        throw new ICloudError(controller.signal.aborted ? 'calendar_timeout' : 'calendar_unavailable', controller.signal.aborted ? 'The Apple calendar request timed out. Your previous imported events have been retained.' : 'Apple’s calendar service could not be reached. Your previous imported events have been retained.');
      } finally { clearTimeout(timer); }
    }
    throw new ICloudError('calendar_redirect', 'Apple’s calendar redirect could not be completed.');
  };
}

function responses(xml: string): Xml[] {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new ICloudError('invalid_response', 'Apple returned unsupported calendar XML.');
  if (XMLValidator.validate(xml) !== true) throw new ICloudError('invalid_response', 'Apple returned incomplete calendar XML. Previous events have been retained.');
  let parsed: Xml; try { parsed = asObject(XML.parse(xml)); } catch { throw new ICloudError('invalid_response', 'Apple returned unreadable calendar XML.'); }
  if (!Object.hasOwn(parsed, 'multistatus')) throw new ICloudError('invalid_response', 'Apple returned an unexpected calendar response.');
  const rows = list(asObject(parsed.multistatus).response); if (rows.length > MAX_OBJECTS + MAX_CALENDARS) throw new ICloudError('calendar_limit', 'The calendar has too many records for this import.');
  return rows.map(asObject);
}
function properties(row: Xml, failOnError = false): Xml {
  const out: Xml = {};
  for (const entry of list(row.propstat)) { const p = asObject(entry); if (/\s2\d\d(?:\s|$)/.test(value(p.status))) Object.assign(out, asObject(p.prop)); else if (failOnError) throw new ICloudError('partial_calendar_response', 'Apple returned an incomplete calendar result. Previous events have been retained.'); }
  if (failOnError && value(row.status) && !/\s2\d\d(?:\s|$)/.test(value(row.status))) throw new ICloudError('partial_calendar_response', 'Apple returned an incomplete calendar result. Previous events have been retained.');
  return out;
}
async function discover(request: ReturnType<typeof context>): Promise<ICloudCalendar[]> {
  const first = await request(ROOT, 'PROPFIND', propfind('<d:current-user-principal/>'));
  const principal = responses(first.body).map(r => value(asObject(properties(r)['current-user-principal']).href)).find(Boolean);
  if (!principal) throw new ICloudError('calendar_discovery_failed', 'Apple did not return a calendar account for this login.');
  const principalUrl = validateAppleCalendarUrl(principal, first.url);
  const second = await request(principalUrl, 'PROPFIND', propfind('<c:calendar-home-set/>'));
  const home = responses(second.body).map(r => value(asObject(properties(r)['calendar-home-set']).href)).find(Boolean);
  if (!home) throw new ICloudError('calendar_discovery_failed', 'Apple did not return a private calendar collection for this account.');
  const homeUrl = validateAppleCalendarUrl(home, second.url);
  const third = await request(homeUrl, 'PROPFIND', propfind('<d:displayname/><d:resourcetype/><a:calendar-color/><c:supported-calendar-component-set/>'), '1');
  const calendars: ICloudCalendar[] = [];
  for (const row of responses(third.body)) {
    const p = properties(row); if (!Object.hasOwn(asObject(p.resourcetype), 'calendar')) continue;
    const components = list(asObject(p['supported-calendar-component-set']).comp); if (components.length && !components.some(c => asObject(c)['@_name'] === 'VEVENT')) continue;
    const href = value(row.href); if (!href) throw new ICloudError('invalid_response', 'Apple returned a calendar without an address.');
    const id = validateAppleCalendarUrl(href, third.url); const calendar = { id, displayName: text(value(p.displayname) || 'Untitled calendar', 200), ...(typeof p['calendar-color'] === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(p['calendar-color']) ? { color: p['calendar-color'].slice(0, 7) } : {}) };
    if (!calendars.some(c => c.id === id)) calendars.push(calendar);
    if (calendars.length > MAX_CALENDARS) throw new ICloudError('calendar_limit', 'This Apple account has too many calendars for this connection.');
  }
  return calendars;
}
export async function discoverCalendars(input: Credentials): Promise<ICloudCalendar[]> { return discover(context(input)); }

function parts(t: CalTime): number[] { return [t.year, t.month, t.day, t.hour || 0, t.minute || 0, t.second || 0]; }
function londonOrIanaEpoch(t: CalTime, zone: string): number {
  const p = parts(t), wall = Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]);
  let format: Intl.DateTimeFormat; try { format = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); } catch { throw new ICloudError('unsupported_timezone', 'A calendar uses an unrecognised time zone. The previous import has been retained.'); }
  const shown = (epoch: number) => { const v = format.formatToParts(new Date(epoch)); const get = (name: string) => Number(v.find(x => x.type === name)?.value); return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')); };
  let guess = wall; for (let i = 0; i < 4; i++) guess += wall - shown(guess);
  const choices = [guess - 3_600_000, guess, guess + 3_600_000].filter(x => shown(x) === wall);
  if (!choices.length) throw new ICloudError('invalid_calendar_time', 'A calendar contains a local time that does not exist during a clock change. Previous events have been retained.');
  return Math.min(...choices);
}
function epoch(t: CalTime, event: CalEvent, property = 'dtstart'): number {
  if (t.isDate) return Date.UTC(t.year, t.month - 1, t.day);
  const tzid = String(event.component.getFirstProperty(property)?.getParameter('tzid') || event.component.getFirstProperty('dtstart')?.getParameter('tzid') || '');
  if (t.zone?.tzid === 'UTC') return t.toJSDate().getTime();
  if (t.zone && !['floating', 'local'].includes(t.zone.tzid)) return t.toJSDate().getTime();
  return londonOrIanaEpoch(t, tzid || 'Europe/London');
}
function serialTime(t: CalTime, event: CalEvent, property = 'dtstart'): string { return t.isDate ? `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}` : new Date(epoch(t, event, property)).toISOString(); }
async function providerId(calendar: string, uid: string, identity: string): Promise<string> { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(calendar + '\u001f' + uid + '\u001f' + identity)); return 'icloud_' + [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function occurrenceKey(uid: string, identity: string): Promise<string> { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid + '\u001f' + identity)); return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }
function providerRevision(event: CalEvent): { providerSequence?: number; providerModifiedAt?: string } {
  const metadata: { providerSequence?: number; providerModifiedAt?: string } = {};
  const rawSequence = event.component.getFirstPropertyValue('sequence');
  if (event.component.hasProperty('sequence') && typeof rawSequence === 'number' && Number.isSafeInteger(rawSequence) && rawSequence >= 0 && rawSequence <= 2_147_483_647) metadata.providerSequence = rawSequence;
  const modified = event.component.getFirstPropertyValue('last-modified');
  const modifiedProperty = event.component.getFirstProperty('last-modified');
  // LAST-MODIFIED is UTC in RFC 5545. Accept an explicit, resolvable TZID as well;
  // never infer a floating revision timestamp from the event's DTSTART timezone.
  if (modified instanceof ICAL.Time && !modified.isDate && (modified.zone?.tzid === 'UTC' || modifiedProperty?.getParameter('tzid'))) {
    try { const value = epoch(modified, event, 'last-modified'); if (Number.isFinite(value)) metadata.providerModifiedAt = new Date(value).toISOString(); } catch { /* Unusable optional revision metadata does not invalidate otherwise valid events. */ }
  }
  return metadata;
}


/** A parser error or expansion cap fails the complete sync, so callers must retain previous events. */
interface ExpansionBudget { count: number; deadline: number; }
interface OriginalOccurrence { time: CalTime; event: CalEvent; property: 'dtstart' | 'recurrence-id'; }
function originalOccurrenceIdentity(original: OriginalOccurrence): string { return serialTime(original.time, original.event, original.property); }
export async function parseCalendarData(ics: string, calendar: ICloudCalendar, windowStart: string, windowEnd: string, sharedBudget?: ExpansionBudget): Promise<ICloudEvent[]> {
  if (!/^BEGIN:VCALENDAR(?:\r?\n)[\s\S]*(?:\r?\n)END:VCALENDAR\s*$/i.test(ics.trim())) throw new ICloudError('invalid_calendar_data', 'Apple returned incomplete calendar data. Previous events have been retained.');
  if (ics.length > MAX_BYTES) throw new ICloudError('calendar_limit', 'A calendar event is too large for this import.');
  let component: CalComponent; try { component = new ICAL.Component(ICAL.parse(ics)); } catch { throw new ICloudError('invalid_calendar_data', 'Apple returned an unreadable calendar event. Previous events have been retained.'); }
  if (component.name !== 'vcalendar') throw new ICloudError('invalid_calendar_data', 'Apple returned an unexpected calendar format.');
  const from = Date.parse(windowStart), to = Date.parse(windowEnd); if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 400 * 86_400_000) throw new ICloudError('invalid_selection', 'Choose a valid calendar import window.', 400); const events = component.getAllSubcomponents('vevent');
  if (events.length > MAX_OBJECTS) throw new ICloudError('calendar_limit', 'A calendar object contains too many events.');
  const groups = new Map<string, CalComponent[]>();
  for (const c of events) { const uid = String(c.getFirstPropertyValue('uid') || ''); if (!uid || uid.length > 1000) throw new ICloudError('invalid_calendar_data', 'A calendar event is missing its stable identifier.'); const a = groups.get(uid) || []; a.push(c); groups.set(uid, a); }
  const output = new Map<string, ICloudEvent>(); let expansions = 0; const budget = sharedBudget ?? { count: 0, deadline: Date.now() + 45_000 };
  const emit = async (event: CalEvent, start: CalTime, end: CalTime, identity: string, original?: OriginalOccurrence) => {
    if (String(event.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
    const startEpoch = epoch(start, event), endEpoch = epoch(end, event, 'dtend'); if (!Number.isFinite(startEpoch) || !Number.isFinite(endEpoch) || endEpoch < startEpoch) throw new ICloudError('invalid_calendar_data', 'A calendar event has invalid dates.');
    if (startEpoch >= to || (endEpoch <= from && startEpoch !== endEpoch) || (startEpoch === endEpoch && startEpoch < from)) return;
    const id = await providerId(calendar.id, event.uid, identity);
    output.set(id, { ...providerRevision(event), providerId: id, occurrenceKey: await occurrenceKey(event.uid, original ? originalOccurrenceIdentity(original) : 'single'), uid: text(event.uid, 1000), calendarId: calendar.id, calendarTitle: calendar.displayName, title: text(event.summary || '(Untitled event)', 200), startAt: serialTime(start, event), endAt: serialTime(end, event, 'dtend'), allDay: start.isDate, status: String(event.component.getFirstPropertyValue('status')).toUpperCase() === 'TENTATIVE' ? 'tentative' : 'confirmed', ...(event.location ? { location: text(event.location, 500) } : {}), ...(event.description ? { notes: text(event.description, 4000) } : {}), ...(calendar.color ? { color: calendar.color } : {}) });
    if (output.size > MAX_EVENTS) throw new ICloudError('calendar_limit', 'Too many calendar occurrences were returned. Select fewer calendars.');
  };
  try {
    for (const components of groups.values()) {
      const master = components.find(c => !c.hasProperty('recurrence-id'));
      const exceptions = components.filter(c => c.hasProperty('recurrence-id')).map(c => {
        const exception = new ICAL.Event(c, { strictExceptions: true, exceptions: [] });
        // iTIP cancellation markers may omit DTSTART (RFC 5546 section 3.2.5).
        // Supply the recurrence identity only for library matching; cancelled markers are never imported.
        if (String(c.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED' && !c.hasProperty('dtstart')) {
          exception.startDate = exception.recurrenceId.clone();
          const zone = c.getFirstProperty('recurrence-id')?.getParameter('tzid');
          if (zone) c.getFirstProperty('dtstart')?.setParameter('tzid', zone);
        }
        return exception;
      });
      if (!master) { for (const exception of exceptions) await emit(exception, exception.startDate, exception.endDate, exception.recurrenceId.toString(), { time: exception.recurrenceId, event: exception, property: 'recurrence-id' }); continue; }
      const event = new ICAL.Event(master, { strictExceptions: true, exceptions });
      // ICAL.js matches exceptions by wall-time serialization. Match exact instances by
      // their original instant too, so equivalent UTC/TZID encodings do not leave the old instance visible.
      const exactExceptionInstants = new Set(exceptions.map(exception => originalOccurrenceIdentity({ time: exception.recurrenceId, event: exception, property: 'recurrence-id' })));
      if (String(master.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED') continue;
      if (!event.isRecurring()) await emit(event, event.startDate, event.endDate, 'single');
      else {
        const iterator = event.iterator(); let occurrence: CalTime | undefined;
        const duration = Math.max(0, epoch(event.endDate, event, 'dtend') - epoch(event.startDate, event));
        const maxDuration = Math.max(duration, ...exceptions.map(e => Math.max(0, epoch(e.endDate, e, 'dtend') - epoch(e.startDate, e))));
        // THISANDFUTURE can move later ORIGINAL instances backwards into the requested window.
        const rangeShift = Math.max(0, ...exceptions.filter(e => e.modifiesFuture()).map(e => Math.abs(epoch(e.recurrenceId, e, 'recurrence-id') - epoch(e.startDate, e))));
        while ((occurrence = iterator.next())) {
          if (++expansions > 20_000 || ++budget.count > 100_000 || Date.now() > budget.deadline) throw new ICloudError('calendar_limit', 'A recurring calendar series exceeds the safe expansion limit. Previous events have been retained.');
          // Expand on original wall-time occurrences; apply moved/cancelled exceptions to their stable recurrence IDs.
          const rough = Date.UTC(occurrence.year, occurrence.month - 1, occurrence.day, occurrence.hour || 0, occurrence.minute || 0, occurrence.second || 0);
          if (rough >= to + rangeShift + 172_800_000) break;
          if (rough < from - maxDuration - rangeShift - 172_800_000) continue;
          const original = { time: occurrence, event, property: 'dtstart' as const };
          if (exactExceptionInstants.has(originalOccurrenceIdentity(original))) continue;
          const detail = event.getOccurrenceDetails(occurrence); await emit(detail.item, detail.startDate, detail.endDate, occurrence.toString(), original);
        }
        // A moved instance may enter the window from an original occurrence outside it.
        for (const exception of exceptions) await emit(exception, exception.startDate, exception.endDate, exception.recurrenceId.toString(), { time: exception.recurrenceId, event: exception, property: 'recurrence-id' });
      }
    }
  } catch (error) { if (error instanceof ICloudError) throw error; throw new ICloudError('invalid_calendar_data', 'A recurring calendar event could not be read safely. Previous events have been retained.'); }
  return [...output.values()].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.providerId.localeCompare(b.providerId));
}

export async function fetchCalendarEvents(input: EventInput): Promise<{ events: ICloudEvent[]; authoritative: true }> {
  const from = Date.parse(input.windowStart), to = Date.parse(input.windowEnd);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 400 * 86_400_000 || !Array.isArray(input.calendars) || !input.calendars.length || input.calendars.length > MAX_SELECTED) throw new ICloudError('invalid_selection', 'Choose one to eight calendars and a valid import window, up to 400 days.', 400);
  const budget: ExpansionBudget = { count: 0, deadline: Date.now() + 45_000 };
  const request = context(input); const available = await discover(request); const requested = [...new Set(input.calendars.map(c => validateAppleCalendarUrl(c.id)))];
  const selected = requested.map(id => available.find(c => c.id === id)); if (selected.some(c => !c)) throw new ICloudError('calendar_not_found', 'A selected calendar is no longer available. Test the connection and choose calendars again.', 409);
  const compact = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const query = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${compact(from)}" end="${compact(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const output = new Map<string, ICloudEvent>(); let count = 0;
  for (const calendar of selected as ICloudCalendar[]) {
    const response = await request(calendar.id, 'REPORT', query, '1');
    for (const row of responses(response.body)) {
      if (++count > MAX_OBJECTS) throw new ICloudError('calendar_limit', 'Too many calendar objects were returned. Select fewer calendars.');
      const eventUrl = validateAppleCalendarUrl(value(row.href), response.url); if (!eventUrl.startsWith(calendar.id.endsWith('/') ? calendar.id : calendar.id + '/')) throw new ICloudError('unexpected_calendar_object', 'Apple returned an event outside the selected calendar. Previous events have been retained.');
      const p = properties(row, true); const data = value(p['calendar-data']); if (!data) throw new ICloudError('partial_calendar_response', 'Apple returned an incomplete event. Previous events have been retained.');
      for (const event of await parseCalendarData(data, calendar, input.windowStart, input.windowEnd, budget)) output.set(event.providerId, event);
      if (output.size > MAX_EVENTS) throw new ICloudError('calendar_limit', 'Too many calendar occurrences were returned. Select fewer calendars.');
    }
  }
  return { events: [...output.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)), authoritative: true };
}

/** Calendar placement uses household dates, never 24-hour arithmetic across DST. */
export const CALENDAR_TIME_ZONE = "Europe/London";
export type CalendarItem = { id: string; data: Record<string, any> };
export type EventDays = { startDay: string; endDay: string; multiDay: boolean };
export type CalendarSegment<T extends CalendarItem = CalendarItem> = {
  event: T;
  startColumn: number;
  endColumn: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};
export type CalendarWeek<T extends CalendarItem = CalendarItem> = {
  days: string[];
  segments: CalendarSegment<T>[];
  laneCount: number;
  singleDayEvents: Map<string, T[]>;
};

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CALENDAR_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});
function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function datePart(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const prefix = value.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/)?.[1];
  if (prefix && !validDay(prefix)) return undefined;
  if (validDay(value)) return value;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? dayFormatter.format(new Date(timestamp)) : undefined;
}
export function calendarAddDays(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/** Both all-day DTEND dates and timed end instants are exclusive. */
export function eventDays(event: CalendarItem): EventDays | undefined {
  const startDay = datePart(event.data.startAt);
  if (!startDay) return undefined;
  let endDay = startDay;
  if (event.data.allDay) {
    const exclusiveDay = datePart(event.data.endAt);
    if (exclusiveDay && exclusiveDay > startDay) endDay = calendarAddDays(exclusiveDay, -1);
  } else {
    const start = Date.parse(event.data.startAt);
    const end = Date.parse(event.data.endAt);
    // Looking at the last included instant correctly excludes midnight, even at DST.
    if (Number.isFinite(end) && end > start) endDay = dayFormatter.format(new Date(end - 1));
    if (endDay < startDay) endDay = startDay;
  }
  return { startDay, endDay, multiDay: endDay > startDay };
}

/** Split continuous events only at week edges and pack overlapping bars into lanes. */
export function layoutCalendarWeeks<T extends CalendarItem>(events: T[], startDay: string, weekCount = 1): CalendarWeek<T>[] {
  const items = events.map(event => ({ event, range: eventDays(event) })).filter(item => !!item.range)
    .sort((a, b) => a.range!.startDay.localeCompare(b.range!.startDay)
      || b.range!.endDay.localeCompare(a.range!.endDay)
      || String(a.event.data.startAt).localeCompare(String(b.event.data.startAt))
      || a.event.id.localeCompare(b.event.id));
  return Array.from({ length: weekCount }, (_, weekIndex) => {
    const first = calendarAddDays(startDay, weekIndex * 7);
    const days = Array.from({ length: 7 }, (_, index) => calendarAddDays(first, index));
    const last = days[6];
    const occupied: boolean[][] = [];
    const segments: CalendarSegment<T>[] = [];
    const singleDayEvents = new Map<string, T[]>(days.map(day => [day, []]));
    for (const { event, range } of items) {
      if (!range || range.startDay > last || range.endDay < first) continue;
      if (!range.multiDay) {
        singleDayEvents.get(range.startDay)?.push(event);
        continue;
      }
      const startColumn = range.startDay < first ? 0 : days.indexOf(range.startDay);
      const endColumn = range.endDay > last ? 6 : days.indexOf(range.endDay);
      let lane = occupied.findIndex(row => row.slice(startColumn, endColumn + 1).every(cell => !cell));
      if (lane === -1) { lane = occupied.length; occupied.push(Array<boolean>(7).fill(false)); }
      for (let day = startColumn; day <= endColumn; day++) occupied[lane][day] = true;
      segments.push({ event, startColumn, endColumn, lane, continuesBefore: range.startDay < first, continuesAfter: range.endDay > last });
    }
    for (const eventsForDay of singleDayEvents.values()) eventsForDay.sort((a, b) => String(a.data.startAt).localeCompare(String(b.data.startAt)) || a.id.localeCompare(b.id));
    return { days, segments, laneCount: occupied.length, singleDayEvents };
  });
}

"use client";

import React from "react";
import { CALENDAR_TIME_ZONE, eventDays, layoutCalendarWeeks, type CalendarItem } from "./calendar-layout";
import "./calendar-spans.css";

export type CalendarGridProps<T extends CalendarItem> = {
  events: T[];
  startDay: string;
  weeks: number;
  today: string;
  month?: string;
  onAdd: (day: string) => void;
  onOpenEvent: (event: T) => void;
  eventColour: (event: T) => string;
};
const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: CALENDAR_TIME_ZONE, weekday: "short" });
const dateLabel = new Intl.DateTimeFormat("en-GB", { timeZone: CALENDAR_TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("en-GB", { timeZone: CALENDAR_TIME_ZONE, day: "numeric", month: "short" });
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: CALENDAR_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
function date(day: string) { return new Date(`${day}T12:00:00Z`); }
function eventLabel(event: CalendarItem) {
  const days = eventDays(event)!;
  const source = event.data.origin === "icloud" ? ", Apple Calendar, read-only" : "";
  const state = event.data.status === "tentative" ? ", tentative" : "";
  const dateRange = days.multiDay ? `${shortDate.format(date(days.startDay))} to ${shortDate.format(date(days.endDay))}` : shortDate.format(date(days.startDay));
  return `${event.data.title}, ${dateRange}${event.data.allDay ? ", all day" : `, starts ${clock.format(new Date(event.data.startAt))}`}${source}${state}`;
}

/** The existing calendar cards remain below a shared row of continuous date bars. */
export default function CalendarGrid<T extends CalendarItem>({ events, startDay, weeks, today, month, onAdd, onOpenEvent, eventColour }: CalendarGridProps<T>) {
  const layout = layoutCalendarWeeks(events, startDay, weeks);
  return <div className={`calendar-grid calendar-span-grid ${month ? "month-grid" : ""}`} aria-label={month ? "Month calendar" : "Week calendar"}>
    <div className="calendar-span-weeks">
      {layout.map(week => <div className="calendar-span-week" key={week.days[0]} style={{ gridTemplateRows: `auto ${week.laneCount ? `repeat(${week.laneCount}, 48px) ` : ""}minmax(${month ? 75 : 155}px, auto)` }}>
        {week.days.map((day, index) => <div key={day} aria-hidden="true" className={`calendar-day calendar-span-day ${day === today ? "today" : ""} ${month && day.slice(0, 7) !== month ? "outside" : ""}`} style={{ gridColumn: index + 1, gridRow: `1 / ${week.laneCount + 3}` }}/>)}
        {week.days.map((day, index) => <div key={day} className={`calendar-span-header ${month && day.slice(0, 7) !== month ? "outside" : ""}`} style={{ gridColumn: index + 1, gridRow: 1 }}>
          <button className="calendar-day-label" aria-label={`Add event for ${dateLabel.format(date(day))}`} onClick={() => onAdd(day)}>
            <span>{weekday.format(date(day))}</span><strong>{Number(day.slice(8))}</strong>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>)}
        {week.segments.map(segment => <button key={segment.event.id} className={`calendar-span-event ${segment.continuesBefore ? "continues-before" : ""} ${segment.continuesAfter ? "continues-after" : ""} ${segment.event.data.status === "tentative" ? "tentative" : ""}`} style={{ gridColumn: `${segment.startColumn + 1} / ${segment.endColumn + 2}`, gridRow: segment.lane + 2, "--event-colour": eventColour(segment.event) } as React.CSSProperties} onClick={() => onOpenEvent(segment.event)} aria-label={eventLabel(segment.event)} title={eventLabel(segment.event)}>
          {segment.continuesBefore && <span className="calendar-span-continuation" aria-hidden="true">‹</span>}
          <span className="calendar-span-title">{!segment.event.data.allDay && !segment.continuesBefore && <span className="calendar-span-start">{clock.format(new Date(segment.event.data.startAt))} · </span>}{segment.event.data.title}</span>
          {segment.event.data.origin === "icloud" && <span className="calendar-span-source" aria-hidden="true">Apple</span>}
          {segment.continuesAfter && <span className="calendar-span-continuation" aria-hidden="true">›</span>}
        </button>)}
        {week.days.map((day, index) => <div key={day} className={`calendar-span-events ${month && day.slice(0, 7) !== month ? "outside" : ""}`} style={{ gridColumn: index + 1, gridRow: week.laneCount + 2 }}>
          {week.singleDayEvents.get(day)?.map(event => <button key={event.id} className="calendar-event" style={{ borderLeftColor: eventColour(event) }} onClick={() => onOpenEvent(event)} aria-label={eventLabel(event)}>
            <span>{event.data.allDay ? "All day" : clock.format(new Date(event.data.startAt))}</span>
            <strong>{event.data.title}</strong>
            {event.data.origin === "icloud" && <small className="event-source-badge">Apple · read-only</small>}
            {event.data.status === "tentative" && <small>Tentative</small>}
          </button>)}
        </div>)}
      </div>)}
    </div>
  </div>;
}

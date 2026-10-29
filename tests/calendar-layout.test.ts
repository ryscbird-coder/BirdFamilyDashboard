import test from "node:test";
import assert from "node:assert/strict";
import { calendarAddDays, eventDays, layoutCalendarWeeks } from "../app/calendar-layout.ts";

const event = (id: string, startAt: string, endAt: string, allDay = true) => ({ id, data: { title: id, startAt, endAt, allDay } });
test("all-day ends exclude the following date and a one-day event remains a day card", () => {
  assert.deepEqual(eventDays(event("one", "2026-10-29", "2026-10-30")), { startDay: "2026-10-29", endDay: "2026-10-29", multiDay: false });
  assert.deepEqual(eventDays(event("away", "2026-10-29", "2026-11-05")), { startDay: "2026-10-29", endDay: "2026-11-04", multiDay: true });
});
test("timed midnight ends are exclusive in London summer time", () => {
  assert.deepEqual(eventDays(event("one", "2026-06-01T08:00:00Z", "2026-06-01T23:00:00Z", false)), { startDay: "2026-06-01", endDay: "2026-06-01", multiDay: false });
  assert.deepEqual(eventDays(event("away", "2026-06-01T20:00:00Z", "2026-06-02T23:00:00Z", false)), { startDay: "2026-06-01", endDay: "2026-06-02", multiDay: true });
});
test("London DST fallback and spring forward use dates rather than 24-hour divisions", () => {
  assert.deepEqual(eventDays(event("autumn", "2026-10-24T23:00:00Z", "2026-10-26T00:00:00Z", false)), { startDay: "2026-10-25", endDay: "2026-10-25", multiDay: false });
  assert.deepEqual(eventDays(event("spring", "2026-03-29T00:00:00Z", "2026-03-29T23:00:00Z", false)), { startDay: "2026-03-29", endDay: "2026-03-29", multiDay: false });
  assert.equal(calendarAddDays("2026-03-29", 1), "2026-03-30");
  assert.equal(calendarAddDays("2026-10-25", 1), "2026-10-26");
});
test("timed events ending after midnight retain that extra day", () => {
  assert.deepEqual(eventDays(event("minute", "2026-10-29T09:00:00Z", "2026-10-30T00:01:00Z", false)), { startDay: "2026-10-29", endDay: "2026-10-30", multiDay: true });
});
test("a continuous event splits only at week boundaries, including both continuation markers", () => {
  const weeks = layoutCalendarWeeks([event("away", "2026-10-21", "2026-11-04")], "2026-10-26", 2);
  assert.deepEqual(weeks.map(w => w.segments.map(s => [s.startColumn, s.endColumn, s.continuesBefore, s.continuesAfter])), [[[0, 6, true, true]], [[0, 1, true, false]]]);
  assert.ok(weeks.every(w => [...w.singleDayEvents.values()].every(items => items.length === 0)));
});
test("spans with overlapping dates have separate lanes; non-overlapping spans share a lane", () => {
  const week = layoutCalendarWeeks([
    event("long", "2026-10-26", "2026-10-30"),
    event("overlap", "2026-10-28", "2026-10-31"),
    event("later", "2026-10-30", "2026-11-02"),
  ], "2026-10-26")[0];
  assert.equal(week.laneCount, 2);
  assert.deepEqual(week.segments.map(s => [s.event.id, s.lane]), [["long", 0], ["overlap", 1], ["later", 0]]);
  for (const a of week.segments) for (const b of week.segments) if (a !== b && a.lane === b.lane) assert.ok(a.endColumn < b.startColumn || b.endColumn < a.startColumn);
});
test("lane placement is deterministic when a provider returns events in a different order", () => {
  const items = [event("b", "2026-10-26", "2026-10-30"), event("a", "2026-10-26", "2026-10-30"), event("c", "2026-10-28", "2026-11-01")];
  const placement = (list: typeof items) => layoutCalendarWeeks(list, "2026-10-26")[0].segments.map(s => [s.event.id, s.lane, s.startColumn, s.endColumn]);
  assert.deepEqual(placement(items), placement([...items].reverse()));
});
test("six-week month grid clips at its edges and carries a span across the month boundary", () => {
  const weeks = layoutCalendarWeeks([event("cross-month", "2026-10-30", "2026-11-04"), event("after", "2026-12-20", "2026-12-22")], "2026-10-26", 6);
  assert.equal(weeks.length, 6);
  assert.equal(weeks[5].days[6], "2026-12-06");
  assert.deepEqual(weeks.flatMap(w => w.segments.map(s => [s.event.id, s.startColumn, s.endColumn])), [["cross-month", 4, 6], ["cross-month", 0, 1]]);
});
test("single-day timed events keep their start ordering and are never repeated beside a span", () => {
  const week = layoutCalendarWeeks([event("later", "2026-10-29T14:00:00Z", "2026-10-29T15:00:00Z", false), event("early", "2026-10-29T08:00:00Z", "2026-10-29T09:00:00Z", false), event("away", "2026-10-28", "2026-10-31")], "2026-10-26")[0];
  assert.deepEqual(week.singleDayEvents.get("2026-10-29")?.map(e => e.id), ["early", "later"]);
  assert.deepEqual(week.segments.map(s => s.event.id), ["away"]);
});
test("malformed source timestamps are skipped without hiding valid events", () => {
  const week = layoutCalendarWeeks([event("bad", "not-a-date", "2026-10-30"), event("good", "2026-10-29", "2026-10-30")], "2026-10-26")[0];
  assert.equal(eventDays(event("impossible", "2026-02-31", "2026-03-03")), undefined);
  assert.equal(week.singleDayEvents.get("2026-10-29")?.[0].id, "good");
});

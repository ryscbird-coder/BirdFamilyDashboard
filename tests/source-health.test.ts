import test from "node:test";
import assert from "node:assert/strict";
import { groupSources, sourceHealthLabel } from "../app/source-health.ts";

const now = Date.parse("2026-10-29T15:00:00Z");

test("a partial job observation is shown without inventing a successful check", () => {
  assert.equal(sourceHealthLabel({ runStatus: "stale", observedAt: "2026-10-29T13:44:00Z" }, now), "Partial report · 1h ago");
  assert.equal(sourceHealthLabel({ runStatus: "stale", observedAt: "2026-10-29T13:44:00Z", lastSuccess: "2026-10-28T06:00:00Z" }, now), "Partial report · 1h ago");
});

test("paused workflows retain their state even with a dated successful report", () => {
  assert.equal(sourceHealthLabel({ runStatus: "paused", lastSuccess: "2026-10-29T14:30:00Z" }, now), "Paused");
  assert.equal(sourceHealthLabel({ runStatus: "ready", schedulePaused: true, lastSuccess: "2026-10-29T14:30:00Z" }, now), "Paused");
});

test("an upcoming scheduled first run differs from missing report evidence", () => {
  assert.equal(sourceHealthLabel({ runStatus: "awaiting_access", nextRunAt: "2026-10-30T19:00:00Z" }, now), "Awaiting first report");
  assert.equal(sourceHealthLabel({ runStatus: "awaiting_access" }, now), "No successful report received");
  assert.equal(sourceHealthLabel({ runStatus: "ready", nextRunAt: "2026-10-28T19:00:00Z" }, now), "No successful report received");
});

test("only a reported success supplies the checked age", () => {
  assert.equal(sourceHealthLabel({ runStatus: "ready", observedAt: "2026-10-29T14:59:00Z", lastSuccess: "2026-10-29T14:00:00Z" }, now), "Report checked · 1h ago");
  assert.equal(sourceHealthLabel({ runStatus: "ready", observedAt: "2026-10-29T14:59:00Z" }, now), "Status reported · 1m ago");
  assert.equal(sourceHealthLabel({ runStatus: "error", observedAt: "2026-10-29T14:59:00Z", lastSuccess: "2026-10-29T14:00:00Z" }, now), "Check needs attention · 1m ago");
});

test("invalid or future observations do not make a source look checked", () => {
  assert.equal(sourceHealthLabel({ runStatus: "stale", observedAt: "not-a-date", lastSuccess: "not-a-date" }, now), "No successful report received");
  assert.equal(sourceHealthLabel({ runStatus: "ready", observedAt: "2026-11-01T00:00:00Z", lastSuccess: "2026-11-01T00:00:00Z" }, now), "No successful report received");
});

test("the daily dashboard remains active while the older paused weekly workflow stays inspectable", () => {
  const daily = Object.freeze({ id: "daily-dashboard", data: Object.freeze({ runStatus: "ready", schedulePaused: false, lastSuccess: "2026-10-29T13:44:00Z" }) });
  const weekly = Object.freeze({ id: "old-weekly-dashboard", data: Object.freeze({ runStatus: "paused", schedulePaused: true }) });
  const news = Object.freeze({ id: "morning-news", data: Object.freeze({ runStatus: "ready" }) });
  const sources = Object.freeze([weekly, daily, news]);
  const grouped = groupSources(sources);
  assert.deepEqual(grouped.active.map(source => source.id), ["daily-dashboard", "morning-news"]);
  assert.deepEqual(grouped.paused.map(source => source.id), ["old-weekly-dashboard"]);
  assert.equal(grouped.paused[0], weekly);
  assert.equal(sources.find(source => source.id === weekly.id), grouped.paused[0]);
  assert.equal(sourceHealthLabel(grouped.active[0].data, now), "Report checked · 1h ago");
});

test("either saved paused flag is sufficient and all-paused input never reappears as active", () => {
  const sources = [{ id: "schedule-paused", data: { schedulePaused: true, runStatus: "ready" } }, { id: "run-paused", data: { runStatus: "paused" } }];
  const grouped = groupSources(sources);
  assert.equal(grouped.active.length, 0);
  assert.deepEqual(grouped.paused, sources);
  assert.deepEqual(groupSources([]), { active: [], paused: [] });
});

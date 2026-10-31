import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskCelebrationTracker, startTaskCelebrationLifetime, TASK_CELEBRATION_DURATION_MS, TASK_CELEBRATION_PARTICLES, TASK_CELEBRATION_SHAPES } from '../app/task-celebration.ts';

const day = '2026-10-31';
const stamp = '2026-10-31T11:05:00Z';
const task = (id: string, data: Record<string, unknown> = {}) => ({ id, data: { title: `Synthetic task ${id}`, done: false, repeat: 'none', ...data } });
const done = (id: string, data: Record<string, unknown> = {}) => task(id, { done: true, lastCompletedAt: stamp, ...data });

test('initial loading, an empty day, and already complete saved snapshots never celebrate', () => {
  const tracker = createTaskCelebrationTracker();
  assert.equal(tracker.observe([], day), null);
  assert.equal(tracker.observe([], day), null);
  const loaded = createTaskCelebrationTracker();
  assert.equal(loaded.observe([done('one')], day), null);
  assert.equal(loaded.observe([done('one')], day), null);
  assert.equal(loaded.observe([task('one')], day), null);
  assert.equal(loaded.observe([done('one', { lastCompletedAt: '2026-10-31T11:06:00Z' })], day), null);
});

test('a newly saved final completion celebrates the household once, including across repeated polls', () => {
  const tracker = createTaskCelebrationTracker();
  assert.equal(tracker.observe([task('first'), task('last')], day), null);
  assert.equal(tracker.observe([done('first'), task('last')], day), null);
  const event = tracker.observe([done('first'), done('last')], day);
  assert.ok(event);
  assert.equal(event.person, undefined);
  assert.ok(event.id.includes('household'));
  assert.equal(tracker.observe([done('first'), done('last')], day), null);
});

test('individual day completion is independent of other people and the last person gets one household celebration', () => {
  const tracker = createTaskCelebrationTracker();
  const first = task('first', { assignedTo: 'Synthetic Alex' });
  const last = task('last', { assignedTo: 'Synthetic Sam' });
  assert.equal(tracker.observe([first, last], day), null);
  const completedFirst = done('first', { assignedTo: 'Synthetic Alex' });
  const person = tracker.observe([completedFirst, last], day);
  assert.equal(person?.person, 'Synthetic Alex');
  assert.equal(tracker.observe([completedFirst, last], day), null);
  const household = tracker.observe([completedFirst, done('last', { assignedTo: 'Synthetic Sam' })], day);
  assert.ok(household);
  assert.equal(household.person, undefined);
});

test('recurring tasks that advanced to tomorrow still count as completed today', () => {
  const tracker = createTaskCelebrationTracker();
  const routine = task('routine', { repeat: 'daily', dueAt: '2026-10-31T08:00:00Z' });
  tracker.observe([routine], day);
  const nextOccurrence = task('routine', { repeat: 'daily', dueAt: '2026-11-01T08:00:00Z', lastCompletedAt: stamp, lastCompletedDueAt: '2026-10-31T08:00:00Z' });
  assert.ok(tracker.observe([nextOccurrence], day));
  assert.equal(tracker.observe([nextOccurrence], day), null);
});

test('tomorrow and historical completed tasks do not block today, and reset or midnight do not create a win', () => {
  const tracker = createTaskCelebrationTracker();
  const later = task('tomorrow', { dueAt: '2026-11-01T09:00:00Z' });
  const history = done('history', { lastCompletedAt: '2026-10-30T09:00:00Z' });
  tracker.observe([task('today'), later, history], day);
  assert.ok(tracker.observe([done('today'), later, history], day));
  assert.equal(tracker.observe([done('today'), later, history], '2026-11-01'), null);
  tracker.reset();
  assert.equal(tracker.observe([done('today')], day), null);
});

test('deleting or rescheduling another daily task cannot turn a completion into a false all-done celebration', () => {
  for (const removed of [[], [task('removed', { dueAt: '2026-11-02T09:00:00Z' })]]) {
    const tracker = createTaskCelebrationTracker();
    tracker.observe([task('final'), task('removed')], day);
    assert.equal(tracker.observe([done('final'), ...removed], day), null);
  }
});

test('a completion stamp is required, and undo then retick cannot replay a previously celebrated scope', () => {
  const tracker = createTaskCelebrationTracker();
  tracker.observe([task('one')], day);
  assert.equal(tracker.observe([task('one')], day), null, 'failed writes leave the saved snapshot unchanged');
  assert.equal(tracker.observe([task('one', { done: true })], day), null, 'legacy checkbox alone cannot announce a verified completion');
  const again = createTaskCelebrationTracker();
  again.observe([task('one')], day);
  assert.ok(again.observe([done('one')], day));
  assert.equal(again.observe([task('one')], day), null);
  assert.equal(again.observe([done('one', { lastCompletedAt: '2026-10-31T12:00:00Z' })], day), null);
});

test('snapshots are copied so mutating a returned record does not erase the saved transition', () => {
  const tracker = createTaskCelebrationTracker();
  const mutable = task('one');
  tracker.observe([mutable], day);
  Object.assign(mutable.data, { done: true, lastCompletedAt: stamp });
  assert.ok(tracker.observe([mutable], day));
});

test('the rain has a bounded lifetime and count and includes both requested snowflakes and crocodiles', () => {
  assert.ok(TASK_CELEBRATION_DURATION_MS >= 5_000 && TASK_CELEBRATION_DURATION_MS <= 6_000);
  assert.equal(TASK_CELEBRATION_PARTICLES, 40);
  assert.ok(TASK_CELEBRATION_SHAPES.some(shape => shape.symbol === '❄️'));
  assert.ok(TASK_CELEBRATION_SHAPES.some(shape => shape.symbol === '🐊'));
});

function lifetimeFixture() {
  const keys = new Set<(event: {key: string}) => void>();
  const visibility = new Set<() => void>();
  const motions = new Set<() => void>();
  const timers = new Map<number, () => void>();
  const durations: number[] = [];
  const motion = { matches: false, addEventListener: (_name: string, fn: () => void) => motions.add(fn), removeEventListener: (_name: string, fn: () => void) => motions.delete(fn) };
  const document = { visibilityState: 'visible', addEventListener: (_name: string, fn: () => void) => visibility.add(fn), removeEventListener: (_name: string, fn: () => void) => visibility.delete(fn) };
  const window = { matchMedia: () => motion, setTimeout: (fn: () => void, delay: number) => { durations.push(delay); timers.set(1, fn); return 1; }, clearTimeout: (id: number) => timers.delete(id), addEventListener: (_name: string, fn: (event: {key: string}) => void) => keys.add(fn), removeEventListener: (_name: string, fn: (event: {key: string}) => void) => keys.delete(fn) };
  let dismissed = 0;
  const reduced: boolean[] = [];
  const cleanup = startTaskCelebrationLifetime(() => dismissed++, value => reduced.push(value), { window, document } as unknown as Parameters<typeof startTaskCelebrationLifetime>[2]);
  return { keys, visibility, motions, timers, durations, motion, document, cleanup, reduced, get dismissed() { return dismissed; } };
}

test('animation lifetime follows motion preferences, dismisses on Escape or tab hide, and releases every listener and timer', () => {
  const fixture = lifetimeFixture();
  assert.deepEqual(fixture.reduced, [false]);
  assert.deepEqual(fixture.durations, [TASK_CELEBRATION_DURATION_MS]);
  fixture.motion.matches = true;
  for (const listener of fixture.motions) listener();
  assert.deepEqual(fixture.reduced, [false, true]);
  for (const listener of fixture.keys) listener({ key: 'Enter' });
  assert.equal(fixture.dismissed, 0);
  for (const listener of fixture.keys) listener({ key: 'Escape' });
  assert.equal(fixture.dismissed, 1);
  fixture.document.visibilityState = 'hidden';
  for (const listener of fixture.visibility) listener();
  for (const timer of fixture.timers.values()) timer();
  assert.equal(fixture.dismissed, 1, 'racing dismiss sources notify only once');
  fixture.cleanup();
  assert.equal(fixture.keys.size + fixture.visibility.size + fixture.motions.size + fixture.timers.size, 0);
});

test('a tab hide ends an active celebration and unmount cancellation never produces a late dismiss', () => {
  const hidden = lifetimeFixture();
  hidden.document.visibilityState = 'hidden';
  for (const listener of hidden.visibility) listener();
  assert.equal(hidden.dismissed, 1);
  hidden.cleanup();
  const unmounted = lifetimeFixture();
  const queuedTimer = unmounted.timers.get(1)!;
  unmounted.cleanup();
  queuedTimer();
  assert.equal(unmounted.dismissed, 0);
});

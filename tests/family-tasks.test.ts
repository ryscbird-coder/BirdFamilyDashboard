import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_PERIODS, londonTaskDay, taskPeriod, taskCompletedToday, taskIsForToday } from '../shared/family-tasks.ts';
import { nextReminderDue } from '../server/domain.ts';
import { prepareReminder, reminderCompletion } from '../server/reminder-completion.ts';

test('task periods keep old tasks in All day and use the three shared labels', () => {
  assert.deepEqual(TASK_PERIODS.map(period => [period.id, period.label]), [['morning','Morning'],['all_day','All day'],['night','Night']]);
  assert.equal(taskPeriod({}), 'all_day');
  assert.equal(taskPeriod({ period: 'invalid' }), 'all_day');
  assert.equal(taskPeriod({ period: 'night' }), 'night');
});

test('household task dates follow London midnight and preserve date-only values', () => {
  assert.equal(londonTaskDay('2026-07-01T23:30:00Z'), '2026-07-02');
  assert.equal(londonTaskDay('2026-12-01T23:30:00Z'), '2026-12-01');
  assert.equal(londonTaskDay('2026-07-01'), '2026-07-01');
  assert.equal(londonTaskDay(new Date('2026-10-25T01:30:00Z')), '2026-10-25');
  assert.equal(londonTaskDay(Date.parse('2026-03-29T23:30:00Z')), '2026-03-30');
  assert.throws(() => londonTaskDay('2026-02-30'), RangeError);
  assert.throws(() => londonTaskDay('not a date'), RangeError);
});

test('today includes overdue, undated and completed routines without including tomorrow or old completed one-offs', () => {
  const today = '2026-07-02';
  assert.equal(taskIsForToday({ done: false }, today), true);
  assert.equal(taskIsForToday({ done: false, dueAt: '2026-07-01' }, today), true);
  assert.equal(taskIsForToday({ done: false, dueAt: '2026-07-02T22:00:00Z' }, today), true);
  assert.equal(taskIsForToday({ done: false, dueAt: '2026-07-02T23:00:00Z' }, today), false);
  assert.equal(taskIsForToday({ done: true, lastCompletedAt: '2026-07-01T12:00:00Z' }, today), false);
  assert.equal(taskIsForToday({ done: true }, today), false);
  assert.equal(taskIsForToday({ done: true, repeat: 'daily' }, today), true);
  assert.equal(taskCompletedToday({ done: true, repeat: 'daily' }, today), false);
  const routine = { repeat: 'daily', done: false, dueAt: '2026-07-03', lastCompletedAt: '2026-07-02T08:00:00Z' };
  assert.equal(taskCompletedToday(routine, today), true);
  assert.equal(taskIsForToday(routine, today), true);
  assert.equal(taskCompletedToday(routine, '2026-07-03'), false);
  assert.equal(taskIsForToday(routine, '2026-07-03'), true);
  assert.equal(taskCompletedToday({ done: false, lastCompletedAt: routine.lastCompletedAt }, today), false);
});

test('daily and weekly due dates keep London wall time across both clock changes', () => {
  assert.equal(nextReminderDue('2026-03-28T08:00:00.123Z', 'daily'), '2026-03-29T07:00:00.123Z');
  assert.equal(nextReminderDue('2026-10-24T07:00:00Z', 'daily'), '2026-10-25T08:00:00.000Z');
  assert.equal(nextReminderDue('2026-03-22T08:00:00Z', 'weekly'), '2026-03-29T07:00:00.000Z');
  assert.equal(nextReminderDue('2026-03-28T01:30:00Z', 'daily'), '2026-03-29T01:30:00.000Z');
  assert.equal(nextReminderDue('2026-10-24T00:30:00Z', 'daily'), '2026-10-25T00:30:00.000Z');
});

test('overdue routines jump past today while preserving their daily, weekly or monthly cadence', () => {
  assert.equal(nextReminderDue('2025-01-01', 'daily', '2026-10-31'), '2026-11-01');
  assert.equal(nextReminderDue('2026-10-01', 'weekly', '2026-10-31'), '2026-11-05');
  assert.equal(nextReminderDue('2025-01-31', 'monthly', '2026-10-31'), '2026-11-30');
  assert.equal(nextReminderDue('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextReminderDue('2028-01-31', 'monthly'), '2028-02-29');
});

test('a recurring completion stays checked until the next London day and undo restores its exact anchor', () => {
  const task = { title: 'Synthetic routine', repeat: 'daily', period: 'morning', dueAt: '2026-07-01T07:00:00Z', done: false };
  const saved = reminderCompletion(task, true, new Date('2026-07-01T22:59:00Z'));
  assert.equal(saved.done, false);
  assert.equal(saved.dueAt, '2026-07-02T07:00:00.000Z');
  assert.equal(saved.lastCompletedDueAt, task.dueAt);
  assert.equal(taskCompletedToday(saved, '2026-07-01'), true);
  assert.equal(taskCompletedToday(saved, '2026-07-02'), false);
  assert.equal(taskIsForToday(saved, '2026-07-02'), true);
  assert.equal(reminderCompletion(saved, true, new Date('2026-07-01T22:59:30Z')), saved);
  const undone = reminderCompletion(saved, false, new Date('2026-07-01T22:59:30Z'));
  assert.equal(undone.dueAt, task.dueAt);
  assert.equal(undone.lastCompletedAt, undefined);
  assert.equal(undone.completionUndo, undefined);
  assert.equal(taskCompletedToday(undone, '2026-07-01'), false);
});

test('editor saves preserve actual completion, cannot invent markers and keep an edited schedule when undone', () => {
  const now = new Date('2026-10-31T18:00:00Z');
  const original = { title: 'Synthetic routine', repeat: 'daily', dueAt: '2026-10-31', done: false, period: 'night' };
  const saved = reminderCompletion(original, true, now);
  const edited = prepareReminder({ ...saved, title: 'Renamed routine', done: false, lastCompletedAt: '2099-01-01', completionUndo: { dueAt: '2099-01-01' } }, saved, false, now);
  assert.equal(edited.lastCompletedAt, saved.lastCompletedAt);
  assert.deepEqual(edited.completionUndo, saved.completionUndo);
  assert.equal(taskCompletedToday(edited, '2026-10-31'), true);
  const rescheduled = prepareReminder({ ...edited, dueAt: '2026-11-03' }, edited, false, now);
  const undone = reminderCompletion(rescheduled, false, now);
  assert.equal(undone.dueAt, '2026-11-03');
  assert.equal(undone.lastCompletedAt, undefined);
  const fresh = prepareReminder({ title: 'Fresh', repeat: 'daily', done: false, lastCompletedAt: '2099-01-01' }, undefined, false, now);
  assert.equal(fresh.lastCompletedAt, undefined);
  assert.equal(fresh.dueAt, '2026-10-31');
});

test('repeating without an anchor works, legacy checked routines can be undone and future repeats cannot be skipped', () => {
  const now = new Date('2026-10-31T18:00:00Z');
  const saved = reminderCompletion({ title: 'Undated routine', repeat: 'daily', done: false }, true, now);
  assert.equal(saved.dueAt, '2026-11-01');
  assert.equal(reminderCompletion(saved, false, now).dueAt, undefined);
  const legacy = { title: 'Legacy routine', repeat: 'daily', done: false, dueAt: '2026-11-01', lastCompletedAt: now.toISOString() };
  assert.equal(reminderCompletion(legacy, false, now).dueAt, '2026-10-31');
  const legacyDone = { title: 'Legacy checked routine', repeat: 'daily', done: true, dueAt: '2026-10-15' };
  const restored = reminderCompletion(legacyDone, false, now);
  assert.equal(restored.done, false);
  assert.equal(restored.dueAt, legacyDone.dueAt);
  assert.throws(() => reminderCompletion({ ...legacy, lastCompletedAt: '2026-10-30T18:00:00Z' }, true, now), error => !!error && typeof error === 'object' && 'code' in error && error.code === 'task_not_due');
  assert.equal(reminderCompletion({ title: 'Early one-off', done: false, dueAt: '2026-11-10' }, true, now).done, true);
});

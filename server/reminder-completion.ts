import { ApiError, nextReminderDue } from './domain.ts';
import type { Data } from './domain.ts';
import { londonTaskDay, taskCompletedToday } from '../shared/family-tasks.ts';

const BOOKKEEPING = ['lastCompletedAt', 'lastCompletedDueAt', 'completionUndo'] as const;
function recurring(data: Data): boolean { return ['daily', 'weekly', 'monthly'].includes(String(data.repeat)); }
function withoutCompletion(data: Data): Data {
  const result = { ...data };
  for (const field of BOOKKEEPING) delete result[field];
  return result;
}
function previousCompletion(data: Data): Data {
  return {
    dueAt: typeof data.dueAt === 'string' ? data.dueAt : null,
    lastCompletedAt: typeof data.lastCompletedAt === 'string' ? data.lastCompletedAt : null,
    lastCompletedDueAt: typeof data.lastCompletedDueAt === 'string' ? data.lastCompletedDueAt : null,
  };
}

/** Only this server transition stamps completion. Repeated requests do not advance twice. */
export function reminderCompletion(data: Data, done: boolean, now = new Date()): Data {
  const today = londonTaskDay(now);
  const isRoutine = recurring(data);
  const completed = taskCompletedToday(data, today) || (!isRoutine && data.done === true);
  if (done && completed) return data;
  if (!done && !completed) {
    // Old undated routines could remain done=true without a completion timestamp.
    return data.done === true ? { ...withoutCompletion(data), done: false } : data;
  }
  if (done) {
    if (isRoutine && typeof data.dueAt === 'string' && londonTaskDay(data.dueAt) > today) {
      throw new ApiError(409, 'task_not_due', 'This routine is scheduled for a future day.');
    }
    const result: Data = {
      ...withoutCompletion(data), done: !isRoutine,
      lastCompletedAt: now.toISOString(), completionUndo: previousCompletion(data),
    };
    if (typeof data.dueAt === 'string') result.lastCompletedDueAt = data.dueAt;
    if (isRoutine) result.dueAt = nextReminderDue(String(data.dueAt || today), String(data.repeat), today);
    return result;
  }

  const result: Data = { ...withoutCompletion(data), done: false };
  if (isRoutine) {
    const undo = data.completionUndo && typeof data.completionUndo === 'object' && !Array.isArray(data.completionUndo)
      ? data.completionUndo as Data : undefined;
    // Old routine records predate undo metadata; reopen today's occurrence safely.
    const priorDue = undo ? undo.dueAt : data.lastCompletedDueAt ?? today;
    if (typeof priorDue === 'string') result.dueAt = priorDue;
    else delete result.dueAt;
    if (typeof undo?.lastCompletedAt === 'string') result.lastCompletedAt = undo.lastCompletedAt;
    if (typeof undo?.lastCompletedDueAt === 'string') result.lastCompletedDueAt = undo.lastCompletedDueAt;
  }
  return result;
}

/** Ordinary editor saves cannot inject, clear or replay completion bookkeeping. */
export function prepareReminder(data: Data, previous?: Data, legacyCheckbox = false, now = new Date()): Data {
  let result: Data = withoutCompletion(data);
  if (!previous) {
    if (recurring(result) && !result.dueAt) result.dueAt = londonTaskDay(now);
    return result.done === true ? reminderCompletion({ ...result, done: false }, true, now) : result;
  }
  for (const field of BOOKKEEPING) if (previous[field] !== undefined) result[field] = previous[field];
  if (legacyCheckbox) return reminderCompletion({ ...result, done: previous.done === true }, data.done === true, now);

  // The editor includes a stale done value for routines; only checkbox actions change it.
  result.done = recurring(result) ? false : recurring(previous) && taskCompletedToday(previous, londonTaskDay(now)) ? true : previous.done === true;
  if (recurring(result) && !result.dueAt) result.dueAt = londonTaskDay(now);
  if (result.dueAt !== previous.dueAt && result.completionUndo && typeof result.completionUndo === 'object') {
    result.completionUndo = { ...result.completionUndo as Data, dueAt: result.dueAt ?? null };
  }
  return result;
}

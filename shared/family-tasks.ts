/** A task's period is a household setting, shared by every screen. */
export const TASK_PERIODS = [
  { id: 'morning', label: 'Morning' },
  { id: 'all_day', label: 'All day' },
  { id: 'night', label: 'Night' },
] as const;
export type TaskPeriod = typeof TASK_PERIODS[number]['id'];
type TaskData = Record<string, unknown>;

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Date-only values are already household civil dates, not UTC instants. */
export function londonTaskDay(value: Date | string | number): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value + 'T12:00:00Z');
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) return value;
    throw new RangeError('Invalid household task date.');
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid household task date.');
  const parts = dayFormatter.formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function taskDay(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try { return londonTaskDay(value); } catch { return undefined; }
}

export function taskPeriod(data: TaskData): TaskPeriod {
  return TASK_PERIODS.some(period => period.id === data.period) ? data.period as TaskPeriod : 'all_day';
}

/** Routines advance their due date on completion but stay visibly checked today. */
export function taskCompletedToday(data: TaskData, today: string): boolean {
  if (taskDay(data.lastCompletedAt) !== today) return false;
  return data.repeat === 'daily' || data.repeat === 'weekly' || data.repeat === 'monthly' || data.done === true;
}

/** Future work and old completed one-offs do not hold up today's checklist. */
export function taskIsForToday(data: TaskData, today: string): boolean {
  if (taskCompletedToday(data, today)) return true;
  const routine = data.repeat === 'daily' || data.repeat === 'weekly' || data.repeat === 'monthly';
  // Older undated routines could be stored done=true indefinitely; their next day reopens.
  if (data.done === true && !routine) return false;
  const due = taskDay(data.dueAt);
  return !due || due <= today;
}

import { taskCompletedToday, taskIsForToday } from '../shared/family-tasks.ts';

export interface CelebrationTask {
  id: string;
  data: Record<string, unknown>;
}

export interface TaskCelebrationEvent {
  id: string;
  /** Omitted for the whole household; Family is used for unassigned tasks. */
  person?: string;
}

export const TASK_CELEBRATION_SHAPES = [
  { name: 'snowflakes', symbol: '❄️' },
  { name: 'crocodiles', symbol: '🐊' },
  { name: 'butterflies', symbol: '🦋' },
  { name: 'stars', symbol: '⭐' },
  { name: 'rainbows', symbol: '🌈' },
  { name: 'rockets', symbol: '🚀' },
  { name: 'dinosaurs', symbol: '🦕' },
  { name: 'strawberries', symbol: '🍓' },
  { name: 'unicorns', symbol: '🦄' },
  { name: 'penguins', symbol: '🐧' },
] as const;

export const TASK_CELEBRATION_DURATION_MS = 5_600;
export const TASK_CELEBRATION_PARTICLES = 40;

interface CelebrationHost {
  window: Pick<Window, 'matchMedia' | 'setTimeout' | 'clearTimeout' | 'addEventListener' | 'removeEventListener'>;
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
}

/** Own every temporary listener/timer so hiding or unmounting cannot leave a shower running. */
export function startTaskCelebrationLifetime(onDismiss: () => void, onMotion: (reduced: boolean) => void, host: CelebrationHost = { window, document }) {
  let active = true;
  let dismissed = false;
  const dismiss = () => { if (active && !dismissed) { dismissed = true; onDismiss(); } };
  const motion = host.window.matchMedia('(prefers-reduced-motion: reduce)');
  const updateMotion = () => { if (active) onMotion(motion.matches); };
  updateMotion();
  motion.addEventListener('change', updateMotion);
  const timeout = host.window.setTimeout(dismiss, TASK_CELEBRATION_DURATION_MS);
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
  const visible = () => { if (host.document.visibilityState !== 'visible') dismiss(); };
  host.window.addEventListener('keydown', key);
  host.document.addEventListener('visibilitychange', visible);
  visible();
  return () => {
    active = false;
    host.window.clearTimeout(timeout);
    motion.removeEventListener('change', updateMotion);
    host.window.removeEventListener('keydown', key);
    host.document.removeEventListener('visibilitychange', visible);
  };
}

const assignee = (task: CelebrationTask) => typeof task.data.assignedTo === 'string' ? task.data.assignedTo : '';
const sameIds = (left: CelebrationTask[], right: CelebrationTask[]) => left.length === right.length && left.every(task => right.some(other => other.id === task.id));
const allDone = (tasks: CelebrationTask[], day: string) => tasks.length > 0 && tasks.every(task => taskCompletedToday(task.data, day));
const snapshot = (tasks: readonly CelebrationTask[]) => tasks.map(task => ({ id: task.id, data: { ...task.data } }));

/**
 * Observes authenticated saved snapshots, never optimistic checkbox state.
 * This is screen-only animation bookkeeping; household records stay on the server.
 */
export function createTaskCelebrationTracker() {
  let previous: { day: string; tasks: CelebrationTask[] } | undefined;
  const seen = new Set<string>();

  return {
    observe(tasks: readonly CelebrationTask[], today: string): TaskCelebrationEvent | null {
      const next = snapshot(tasks);
      const before = previous;
      previous = { day: today, tasks: next };
      const currentDay = next.filter(task => taskIsForToday(task.data, today));
      const people = [...new Set(currentDay.map(assignee))].sort();
      const scopes: Array<{ key: string; person?: string; select: (task: CelebrationTask) => boolean }> = [
        { key: 'household', select: () => true },
        ...people.map(person => ({ key: `person:${person}`, person: person || 'Family', select: (task: CelebrationTask) => assignee(task) === person })),
      ];

      if (!before || before.day !== today) {
        seen.clear();
        // Opening an already completed day must not replay its celebration.
        for (const scope of scopes) if (allDone(currentDay.filter(scope.select), today)) seen.add(scope.key);
        return null;
      }

      const previousDay = before.tasks.filter(task => taskIsForToday(task.data, today));
      let winner: TaskCelebrationEvent | null = null;
      for (const scope of scopes) {
        const current = currentDay.filter(scope.select);
        if (!allDone(current, today)) continue;
        const alreadySeen = seen.has(scope.key);
        seen.add(scope.key);
        if (alreadySeen || winner) continue;
        const old = previousDay.filter(scope.select);
        if (!sameIds(old, current) || allDone(old, today)) continue;
        // A deletion, assignment edit or date change is not a completion event.
        const completed = current.find(task => {
          const prior = old.find(other => other.id === task.id);
          if (!prior || taskCompletedToday(prior.data, today)) return false;
          const stamp = task.data.lastCompletedAt;
          const oldStamp = prior.data.lastCompletedAt;
          return typeof stamp === 'string' && Number.isFinite(Date.parse(stamp)) && stamp !== oldStamp &&
            (typeof oldStamp !== 'string' || !Number.isFinite(Date.parse(oldStamp)) || Date.parse(stamp) > Date.parse(oldStamp));
        });
        if (completed) winner = { id: `${today}:${scope.key}:${completed.id}:${completed.data.lastCompletedAt}`, ...(scope.person ? { person: scope.person } : {}) };
      }
      return winner;
    },
    reset() {
      previous = undefined;
      seen.clear();
    },
  };
}

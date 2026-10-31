import type { TaskCelebrationMode } from './task-celebration.ts';

export const CELEBRATION_MODE_KEY = 'bird-family-hub:celebration-mode';
export const DEFAULT_CELEBRATION_MODE: TaskCelebrationMode = 'shower';

/** Display preference only: no household records or identity enter browser storage. */
export function readCelebrationMode(storage: Pick<Storage, 'getItem'>): TaskCelebrationMode {
  try {
    const mode = storage.getItem(CELEBRATION_MODE_KEY);
    return mode === 'shower' || mode === 'calm' || mode === 'system' ? mode : DEFAULT_CELEBRATION_MODE;
  } catch { return DEFAULT_CELEBRATION_MODE; }
}

export function writeCelebrationMode(storage: Pick<Storage, 'setItem'>, mode: TaskCelebrationMode): void {
  try { storage.setItem(CELEBRATION_MODE_KEY, mode); } catch { /* The current screen still keeps its selected mode. */ }
}

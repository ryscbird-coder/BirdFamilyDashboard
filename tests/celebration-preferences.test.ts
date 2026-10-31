import test from 'node:test';
import assert from 'node:assert/strict';
import { CELEBRATION_MODE_KEY, readCelebrationMode, writeCelebrationMode } from '../app/celebration-preferences.ts';

test('screens default to the requested shower and retain an explicit calm or device preference', () => {
  for (const value of [null, '', 'invalid']) assert.equal(readCelebrationMode({ getItem: () => value }), 'shower');
  for (const value of ['shower', 'calm', 'system'] as const) assert.equal(readCelebrationMode({ getItem: () => value }), value);
});

test('blocked browser storage cannot disable celebrations or break the screen', () => {
  const denied = () => { throw new Error('Storage unavailable'); };
  assert.equal(readCelebrationMode({ getItem: denied }), 'shower');
  assert.doesNotThrow(() => writeCelebrationMode({ setItem: denied }, 'calm'));
});

test('remembering the display mode stores only its choice under the dedicated key', () => {
  const values = new Map<string, string>([['unrelated-display-choice', 'kept']]);
  writeCelebrationMode({ setItem: (key, value) => { values.set(key, value); } }, 'shower');
  assert.deepEqual([...values], [['unrelated-display-choice', 'kept'], [CELEBRATION_MODE_KEY, 'shower']]);
  assert.equal(readCelebrationMode({ getItem: key => values.get(key) ?? null }), 'shower');
});

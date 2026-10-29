import test from 'node:test';
import assert from 'node:assert/strict';
import { createHouseholdLoader } from '../app/household-loader.ts';

type State = { records: { id: string }[]; serverTime?: string };
const json = (records: State['records'] = []) => Response.json({ records });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

test('poll, visibility and retry share a single active read, then later reads fetch fresh state', async () => {
  const pending = deferred<Response>();
  const calls: Array<{ path: RequestInfo | URL; options?: RequestInit }> = [];
  const loader = createHouseholdLoader<State>((async (path, options) => {
    calls.push({ path, options });
    return calls.length === 1 ? pending.promise : json([{ id: 'newer' }]);
  }) as typeof fetch);
  const initial = loader.load();
  assert.equal(loader.load(), initial);
  assert.equal(loader.load(), initial);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/state');
  assert.equal(calls[0].options?.credentials, 'same-origin');
  assert.equal(calls[0].options?.cache, 'no-store');
  pending.resolve(json([{ id: 'first' }]));
  assert.deepEqual((await initial).records, [{ id: 'first' }]);
  assert.deepEqual((await loader.load()).records, [{ id: 'newer' }]);
  assert.equal(calls.length, 2);
});

test('a stalled network read times out, aborts transport and allows Retry', async () => {
  let signal: AbortSignal | undefined;
  let count = 0;
  const loader = createHouseholdLoader<State>((async (_path, options) => {
    signal = options?.signal as AbortSignal;
    return ++count === 1 ? new Promise<Response>(() => {}) : json([{ id: 'recovered' }]);
  }) as typeof fetch, 20);
  await assert.rejects(loader.load(), /too long.*Retry/);
  assert.equal(signal?.aborted, true);
  assert.deepEqual((await loader.load()).records, [{ id: 'recovered' }]);
});

test('the deadline also bounds a response whose JSON body never finishes', async () => {
  let signal: AbortSignal | undefined;
  const loader = createHouseholdLoader<State>((async (_path, options) => {
    signal = options?.signal as AbortSignal;
    return { status: 200, ok: true, redirected: false, json: () => new Promise(() => {}) } as Response;
  }) as typeof fetch, 20);
  await assert.rejects(loader.load(), /too long/);
  assert.equal(signal?.aborted, true);
});

test('a late timed-out response cannot replace the last good state or a successful retry', async () => {
  const stale = deferred<Response>();
  let count = 0;
  let state: State = { records: [{ id: 'last-good' }] };
  const loader = createHouseholdLoader<State>((async () => ++count === 1 ? stale.promise : json([{ id: 'retry' }])) as typeof fetch, 20);
  await assert.rejects(loader.load().then(value => { state = value; }), /too long/);
  assert.deepEqual(state.records, [{ id: 'last-good' }]);
  state = await loader.load();
  stale.resolve(json([{ id: 'stale' }]));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state.records, [{ id: 'retry' }]);
});

test('lifecycle cancellation aborts and settles the old read without poisoning a remount', async () => {
  const stale = deferred<Response>();
  const signals: AbortSignal[] = [];
  const loader = createHouseholdLoader<State>((async (_path, options) => {
    signals.push(options?.signal as AbortSignal);
    return signals.length === 1 ? stale.promise : json([{ id: 'remounted' }]);
  }) as typeof fetch);
  const first = loader.load();
  loader.cancel();
  const next = loader.load();
  assert.equal(signals[0].aborted, true);
  await assert.rejects(first, error => error instanceof Error && error.name === 'AbortError');
  assert.deepEqual((await next).records, [{ id: 'remounted' }]);
  stale.resolve(json([{ id: 'unmounted' }]));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signals[1].aborted, false);
});

test('a post-write refresh can invalidate a pre-write poll and cannot be replaced by its stale result', async () => {
  const beforeWrite = deferred<Response>();
  let reads = 0;
  let state: State = { records: [{ id: 'before-write' }] };
  const loader = createHouseholdLoader<State>((async () => ++reads === 1 ? beforeWrite.promise : json([{ id: 'saved-item' }])) as typeof fetch);
  const poll = loader.load().then(value => { state = value; });
  loader.cancel();
  await assert.rejects(poll, error => error instanceof Error && error.name === 'AbortError');
  state = await loader.load();
  assert.equal(reads, 2, 'post-write read must start after the write rather than join the old poll');
  beforeWrite.resolve(json([{ id: 'before-write' }]));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state.records, [{ id: 'saved-item' }]);
});

test('expired sign-in and platform sign-in redirects produce actionable errors rather than JSON parser text', async () => {
  for (const response of [new Response('not JSON', { status: 401 }), { status: 200, ok: true, redirected: true } as Response]) {
    const loader = createHouseholdLoader<State>((async () => response) as typeof fetch);
    await assert.rejects(loader.load(), /sign-in.*expired.*sign in with ChatGPT/);
  }
});

test('invalid responses fail safely and household permission errors retain their useful message', async () => {
  for (const response of [new Response('<html>Sign in</html>'), Response.json({ records: 'invalid' })]) {
    const loader = createHouseholdLoader<State>((async () => response) as typeof fetch);
    await assert.rejects(loader.load(), /household response/);
  }
  const denied = createHouseholdLoader<State>((async () => Response.json({ error: { message: 'This account has not been added to this household.' } }, { status: 403 })) as typeof fetch);
  await assert.rejects(denied.load(), /not been added to this household/);
});

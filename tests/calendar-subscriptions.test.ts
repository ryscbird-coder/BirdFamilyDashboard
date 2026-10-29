import test from 'node:test';
import assert from 'node:assert/strict';
import { CalendarSubscriptionError, fetchSubscriptionEvents, isPublicCalendarAddress, normalizeCalendarFeedUrl, redactPrivateCalendarText } from '../server/calendar-subscriptions.ts';

const calendar = { id: 'feed_synthetic', displayName: 'Synthetic sessions', color: '#123456' };
const windowStart = '2026-10-20T00:00:00Z', windowEnd = '2026-11-05T00:00:00Z';
const url = 'https://calendar.example.net/private.ics?token=synthetic-secret';
const resolveHost = async () => ['8.8.8.8', '2606:4700:4700::1111'];
const ics = (extra = '', uid = 'shared-synthetic-uid') => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Synthetic fixture//EN', 'BEGIN:VEVENT', `UID:${uid}`, 'DTSTART:20261029T100000Z', 'DTEND:20261029T110000Z', 'SUMMARY:Synthetic session', extra, 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
const response = (body = ics(), headers: HeadersInit = { 'Content-Type': 'text/calendar' }) => new Response(body, { headers });
const read = (options: Partial<Parameters<typeof fetchSubscriptionEvents>[0]> = {}) => fetchSubscriptionEvents({ url, calendar, windowStart, windowEnd, resolveHost, fetch: async () => response(), ...options });
const safeError = (error: unknown): error is CalendarSubscriptionError => error instanceof CalendarSubscriptionError && !error.message.includes('synthetic-secret') && !error.message.includes('private.ics');

test('webcal normalizes to HTTPS and URL tokens are retained only for the private request', () => {
  assert.equal(normalizeCalendarFeedUrl(url.replace('https:', 'webcal:')), url);
  assert.equal(normalizeCalendarFeedUrl(url.replace('https:', 'WEBCALS:')), url);
  assert.equal(normalizeCalendarFeedUrl('https://calendar.example.net:443/a.ics'), 'https://calendar.example.net/a.ics');
});
test('the shared label scrubber covers URL host/scheme/HTML aliases without changing other links', () => {
  const secret = 'https://calendar.example.net/private.ics?token=synthetic-secret&part=two';
  const text = 'See WEBCAL://Calendar.Example.Net/private.ics?token=synthetic-secret&amp;part=two and https://normal.example.org/meeting';
  assert.equal(redactPrivateCalendarText(text, [secret, '']), 'See [private calendar subscription] and https://normal.example.org/meeting');
  assert.equal(redactPrivateCalendarText(text, []), text);
});
test('unsafe protocols, embedded credentials, local hosts and every literal IP spelling are rejected', () => {
  for (const value of ['http://calendar.example.net/a.ics', 'file:///a.ics', 'https://user:secret@calendar.example.net/a.ics', 'https://calendar.example.net:8443/a.ics', 'https://localhost/a', 'https://a.local/a', 'https://a.home.arpa/a', 'https://a.internal/a', 'https://a.test/a', 'https://calendar.example.net./a', 'https://127.0.0.1/a', 'https://127.1/a', 'https://2130706433/a', 'https://0x7f000001/a', 'https://%31%32%37.0.0.1/a', 'https://[::1]/a', 'https://[::ffff:127.0.0.1]/a', 'https://8.8.8.8/a', 'https://calendar.example.net/a#secret', 'https://calendar.example.net/\nsecret', 'https://calendar.example.net\\@localhost/a']) assert.throws(() => normalizeCalendarFeedUrl(value), safeError, value);
});
test('the public DNS classifier excludes private, mapped, translation and special-use addresses', () => {
  for (const value of ['0.0.0.0', '10.1.2.3', '100.64.1.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.8', '192.0.2.1', '192.88.99.1', '192.168.1.1', '198.18.0.1', '198.19.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fe80::1', 'ff00::1', '::ffff:8.8.8.8', '64:ff9b::808:808', '2001:db8::1', '2001::1', '2001:20::1', '2002:7f00:1::', '3fff::1', 'invalid', '8.8.8.999']) assert.equal(isPublicCalendarAddress(value), false, value);
  for (const value of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.1.1', '172.32.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4009:81d::200e']) assert.equal(isPublicCalendarAddress(value), true, value);
});
test('public feed import is authoritative only after parsing and sends no private account headers', async () => {
  let requests = 0;
  const result = await read({ fetch: async (_target, init) => { requests++; const headers = new Headers(init?.headers); assert.equal(headers.get('Authorization'), null); assert.equal(headers.get('Cookie'), null); assert.equal(headers.get('Referer'), null); assert.equal(init?.redirect, 'manual'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.cache, 'no-store'); return response(); } });
  assert.equal(requests, 1); assert.equal(result.authoritative, true); assert.equal(result.events.length, 1); assert.equal(result.events[0].calendarId, calendar.id); assert.equal(result.events[0].calendarTitle, calendar.displayName); assert.match(result.events[0].occurrenceKey, /^[a-f0-9]{64}$/); assert.equal(result.events[0].uid, result.events[0].occurrenceKey); assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
});
test('matching subscriptions dedupe by real UID and original recurrence across different private URLs', async () => {
  const a = await read(); const b = await read({ url: 'webcal://other.example.org/second.ics?token=another-secret', calendar: { ...calendar, id: 'feed_second' } });
  assert.equal(a.events[0].occurrenceKey, b.events[0].occurrenceKey); assert.notEqual(a.events[0].providerId, b.events[0].providerId);
});
test('private and mixed DNS answers fail before any feed request', async () => {
  let requests = 0;
  for (const addresses of [[], ['10.0.0.1'], ['8.8.8.8', 'fc00::1'], ['::ffff:127.0.0.1']]) await assert.rejects(read({ resolveHost: async () => addresses, fetch: async () => { requests++; return response(); } }), safeError);
  assert.equal(requests, 0);
});
test('every redirect repeats lexical and public DNS validation before forwarding the private token', async () => {
  const checked: string[] = []; const fetched: string[] = [];
  const result = await read({ resolveHost: async hostname => { checked.push(hostname); return ['8.8.8.8']; }, fetch: async target => { fetched.push(String(target)); return fetched.length === 1 ? new Response(null, { status: 302, headers: { Location: 'https://cdn.example.org/calendar.ics' } }) : response(); } });
  assert.equal(result.events.length, 1); assert.deepEqual(checked, ['calendar.example.net', 'cdn.example.org']); assert.equal(fetched.length, 2);
  let calls = 0;
  await assert.rejects(read({ fetch: async () => { calls++; return new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/private' } }); } }), safeError);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(read({ resolveHost: async hostname => hostname === 'calendar.example.net' ? ['8.8.8.8'] : ['169.254.169.254'], fetch: async () => { calls++; return new Response(null, { status: 302, headers: { Location: 'https://cdn.example.org/calendar.ics' } }); } }), safeError);
  assert.equal(calls, 1);
});
test('redirect loops and unsafe cross-scheme redirects fail closed', async () => {
  let requests = 0;
  await assert.rejects(read({ fetch: async () => { requests++; return new Response(null, { status: 302, headers: { Location: '/loop.ics' } }); } }), error => safeError(error) && error.code === 'feed_redirect_limit');
  assert.equal(requests, 4);
  await assert.rejects(read({ fetch: async () => new Response(null, { status: 302, headers: { Location: 'http://calendar.example.net/unprotected.ics' } }) }), safeError);
});
test('HTTP partial data, oversized/truncated bodies, HTML and incomplete calendars never become authoritative', async () => {
  const failures = [
    new Response(ics(), { status: 206, headers: { 'Content-Type': 'text/calendar' } }),
    response(ics(), { 'Content-Type': 'text/calendar', 'Content-Length': '2000001' }),
    response(ics(), { 'Content-Type': 'text/calendar', 'Content-Length': String(Buffer.byteLength(ics()) + 4) }),
    response('x'.repeat(2_000_001)),
    response('<html>Login required</html>', { 'Content-Type': 'text/html' }),
    response(ics().replace('END:VCALENDAR', '')),
    response(ics().replace('END:VEVENT', '')),
    response('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VEVENT\nEND:VCALENDAR'),
    response('BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nEND:VALARM\nEND:VCALENDAR'),
    response('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\nBEGIN:VEVENT\nEND:VEVENT'),
    response('BEGIN:VCALENDAR\nEND:VCALENDAR'),
  ];
  for (const failure of failures) await assert.rejects(read({ fetch: async () => failure }), safeError);
});
test('an explicit complete empty calendar is authoritative, and text/plain/BOM feeds are supported', async () => {
  const empty = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Empty fixture//EN\r\nEND:VCALENDAR';
  assert.deepEqual((await read({ fetch: async () => response(empty) })).events, []);
  assert.equal((await read({ fetch: async () => response('\ufeff' + ics(), { 'Content-Type': 'text/plain; charset=utf-8' }) })).events.length, 1);
});
test('default resolver checks A and AAAA without sending private feed paths or query strings to DNS', async () => {
  const dnsRequests: string[] = []; let feeds = 0;
  const result = await read({ resolveHost: undefined, fetch: async target => { const u = new URL(String(target)); if (u.hostname === 'cloudflare-dns.com') { dnsRequests.push(u.href); return Response.json({ Status: 0, Answer: [{ type: u.searchParams.get('type') === 'A' ? 1 : 28, data: u.searchParams.get('type') === 'A' ? '8.8.8.8' : '2606:4700:4700::1111' }] }); } feeds++; return response(); } });
  assert.equal(result.events.length, 1); assert.equal(feeds, 1); assert.equal(dnsRequests.length, 2); assert.ok(dnsRequests.every(value => !value.includes('synthetic-secret') && !value.includes('private.ics'))); assert.deepEqual(new Set(dnsRequests.map(value => new URL(value).searchParams.get('type'))), new Set(['A', 'AAAA']));
});
test('default resolver rejects private AAAA answers, malformed/truncated DNS and unresolved hosts', async () => {
  for (const result of [{ Status: 0, Answer: [{ type: 28, data: 'fc00::1' }] }, { Status: 2 }, { Status: 0, TC: true, Answer: [{ type: 1, data: '8.8.8.8' }] }, { Status: 0, Answer: [] }]) {
    let feeds = 0;
    await assert.rejects(read({ resolveHost: undefined, fetch: async target => { if (new URL(String(target)).hostname === 'cloudflare-dns.com') return Response.json(result); feeds++; return response(); } }), safeError);
    assert.equal(feeds, 0);
  }
});
test('network/parser failures never leak a private URL in errors', async () => {
  await assert.rejects(read({ fetch: async () => { throw new Error('failed at ' + url); } }), safeError);
  await assert.rejects(read({ fetch: async () => new Response('private ' + url, { status: 403 }) }), safeError);
  await assert.rejects(read({ calendar: { ...calendar, id: url } }), safeError);
});
test('the bounded deadline aborts a stalled feed request and returns a safe timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let started = false;
  const pending = read({ fetch: async (_target, init) => new Promise<Response>((_resolve, reject) => { started = true; init?.signal?.addEventListener('abort', () => reject(new Error('request ' + url)), { once: true }); }) });
  await new Promise<void>(resolve => queueMicrotask(resolve));
  assert.equal(started, true);
  t.mock.timers.tick(15_001);
  await assert.rejects(pending, error => safeError(error) && error.code === 'feed_timeout');
});
test('raw private URL and scheme/HTML variants are redacted before long shared text is truncated', async () => {
  const raw = 'webcal://calendar.example.net/private.ics?token=synthetic-secret&part=two';
  const https = raw.replace('webcal:', 'https:');
  const text = ['SUMMARY:' + raw, 'LOCATION:' + https.replace(/&/g, '&amp;'), 'DESCRIPTION:' + 'Prefix '.repeat(560) + 'WeBcAlS' + raw.slice('webcal'.length) + ' and https://normal.example.org/meeting'].join('\r\n');
  const result = await read({ url: raw, fetch: async () => response(ics(text, raw).replace('SUMMARY:Synthetic session\r\n', '')) });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('synthetic-secret'), false); assert.equal(serialized.includes('private.ics'), false); assert.match(result.events[0].title, /private calendar subscription/); assert.match(result.events[0].location!, /private calendar subscription/);
  const ordinary = await read({ url: raw, fetch: async () => response(ics('DESCRIPTION:' + https + ' and https://normal.example.org/meeting', raw)) });
  assert.match(ordinary.events[0].notes!, /https:\/\/normal\.example\.org\/meeting/);
});
test('redirect destination capability URLs and host case aliases are redacted without exposing result metadata', async () => {
  const final = 'https://CDN.Example.org:443/private-final.ics?token=final-secret'; let calls = 0;
  const result = await read({ fetch: async () => ++calls === 1 ? new Response(null, { status: 302, headers: { Location: final } }) : response(ics('DESCRIPTION:' + final)) });
  assert.equal(JSON.stringify(result).includes('final-secret'), false); assert.equal(JSON.stringify(result).includes('private-final.ics'), false); assert.match(result.events[0].notes!, /private calendar subscription/);
});
test('optional publisher restrictions use exact hostnames, including redirects', async () => {
  await assert.rejects(read({ trustedHosts: ['example.net'] }), error => safeError(error) && error.code === 'untrusted_feed_host');
  assert.equal((await read({ trustedHosts: ['calendar.example.net'] })).events.length, 1);
  await assert.rejects(read({ trustedHosts: ['calendar.example.net'], fetch: async () => new Response(null, { status: 302, headers: { Location: 'https://cdn.example.org/a.ics' } }) }), error => safeError(error) && error.code === 'untrusted_feed_host');
});

test('Workers runtime imports with default DNS and rejects DNS redirects without following them', async () => {
  const [{ Miniflare }, { build }] = await Promise.all([import('miniflare'), import('esbuild')]);
  const bundled = await build({
    stdin: { contents: `
      import { fetchSubscriptionEvents } from './server/calendar-subscriptions.ts';
      export default { async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/unsupported-redirect') {
          try { new Request('https://calendar.example.net/', { redirect: 'error' }); return Response.json({ rejected: false }); }
          catch (error) { return Response.json({ rejected: true, name: error.name }); }
        }
        try {
          const result = await fetchSubscriptionEvents({
            url: path === '/dns-redirect' ? 'https://dns-redirect.example.net/calendar.ics' : ${JSON.stringify(url)},
            calendar: ${JSON.stringify(calendar)}, windowStart: ${JSON.stringify(windowStart)}, windowEnd: ${JSON.stringify(windowEnd)}
          });
          return Response.json(result);
        } catch (error) { return Response.json({ code: error.code, message: error.safeMessage }, { status: 502 }); }
      } };
    `, resolveDir: process.cwd(), sourcefile: 'calendar-subscriptions-runtime-fixture.ts', loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent'
  });
  const mf = new Miniflare({ cf: false, workers: [
    { name: 'subject', modules: true, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], script: bundled.outputFiles[0].text, outboundService: 'fixture' },
    { name: 'fixture', modules: true, compatibilityDate: '2026-05-15', outboundService: { network: { allow: [] } }, script: `
      export default { async fetch(request) {
        const url = new URL(request.url);
        if (url.hostname === 'cloudflare-dns.com') {
          if (url.searchParams.get('name') === 'dns-redirect.example.net') return new Response(null, { status: 302, headers: { Location: 'https://resolved.example.org/dns-result' } });
          return Response.json({ Status: 0, Answer: [{ type: url.searchParams.get('type') === 'AAAA' ? 28 : 1, data: url.searchParams.get('type') === 'AAAA' ? '2606:4700:4700::1111' : '8.8.8.8' }] });
        }
        // A followed DNS redirect would succeed, so the test detects accidental forwarding.
        if (url.hostname === 'resolved.example.org') return Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
        if (url.hostname === 'calendar.example.net' || url.hostname === 'dns-redirect.example.net') return new Response(${JSON.stringify(ics())}, { headers: { 'Content-Type': 'text/calendar' } });
        return new Response('Unexpected synthetic request', { status: 500 });
      } };
    ` }
  ] });
  try {
    const unsupported = await mf.dispatchFetch('https://runtime.example.org/unsupported-redirect');
    assert.deepEqual(await unsupported.json(), { rejected: true, name: 'TypeError' });
    const success = await mf.dispatchFetch('https://runtime.example.org/import');
    const imported = await success.json() as { events: { title: string }[]; authoritative: boolean };
    assert.equal(success.status, 200); assert.equal(imported.authoritative, true); assert.equal(imported.events[0].title, 'Synthetic session');
    const redirect = await mf.dispatchFetch('https://runtime.example.org/dns-redirect');
    assert.equal(redirect.status, 502); assert.equal((await redirect.json() as { code: string }).code, 'feed_dns_failed');
  } finally { await mf.dispose(); }
});

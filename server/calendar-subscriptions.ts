import { parseCalendarData } from './icloud.ts';
import type { ICloudCalendar, ICloudEvent } from './icloud.ts';
import ICAL from 'ical.js';

const MAX_FEED_BYTES = 2_000_000;
const MAX_DNS_BYTES = 32_768;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;
const DNS_ENDPOINT = 'https://cloudflare-dns.com/dns-query';
const CONTENT_TYPES = new Set(['text/calendar', 'text/plain', 'application/octet-stream', 'application/ics', 'application/x-icalendar', 'text/x-vcalendar']);

export class CalendarSubscriptionError extends Error {
  code: string;
  status: number;
  safeMessage: string;
  constructor(code: string, message: string, status = 502) {
    super(message); this.name = 'CalendarSubscriptionError'; this.code = code; this.safeMessage = message; this.status = status;
  }
}
const unsafeAddress = () => new CalendarSubscriptionError('unsafe_feed_url', 'Use a public HTTPS or webcal calendar subscription link, without a login, custom port or local address.', 400);

/** Subscription URLs may be bearer secrets. Never include an input URL in an error. */
export function normalizeCalendarFeedUrl(raw: string): string {
  if (typeof raw !== 'string' || !raw || raw.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(raw)) throw unsafeAddress();
  let url: URL;
  try { url = new URL(raw.replace(/^webcals?:\/\//i, 'https://')); } catch { throw unsafeAddress(); }
  const hostname = url.hostname.toLowerCase();
  // A DNS hostname is required; URL parsing canonicalizes alternative IPv4 spellings first.
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')
    || hostname.length > 253 || !/^[a-z0-9.-]+$/.test(hostname) || !hostname.includes('.') || hostname.endsWith('.')
    || hostname.split('.').some(label => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))
    || /^\d+(?:\.\d+){3}$/.test(hostname) || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/.test(hostname)
    || hostname.endsWith('.home.arpa') || hostname === 'metadata.google.internal') throw unsafeAddress();
  return url.href;
}

function ipv4(address: string): number[] | undefined {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return undefined;
  const parts = address.split('.').map(Number);
  return parts.every((part, index) => part >= 0 && part <= 255 && String(part) === address.split('.')[index]) ? parts : undefined;
}
function ipv6(address: string): number[] | undefined {
  const raw = address.toLowerCase();
  if (!/^[a-f0-9:]+$/.test(raw) || raw.includes(':::') || (raw.match(/::/g) || []).length > 1) return undefined;
  const halves = raw.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if ([...left, ...right].some(part => !/^[a-f0-9]{1,4}$/.test(part))) return undefined;
  const count = left.length + right.length;
  if ((halves.length === 1 && count !== 8) || (halves.length === 2 && count >= 8)) return undefined;
  return [...left.map(part => Number.parseInt(part, 16)), ...Array<number>(8 - count).fill(0), ...right.map(part => Number.parseInt(part, 16))];
}

/** Conservative public-unicast classifier; transition, mapped and special-use ranges fail closed. */
export function isPublicCalendarAddress(address: string): boolean {
  const a = ipv4(address);
  if (a) {
    const [first, second, third] = a;
    return !(first === 0 || first === 10 || first === 127 || first >= 224
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && ((second === 0 && (third === 0 || third === 2)) || (second === 88 && third === 99) || second === 168))
      || (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100)))
      || (first === 203 && second === 0 && third === 113));
  }
  const v = ipv6(address);
  if (!v || v[0] < 0x2000 || v[0] > 0x3fff) return false;
  return !((v[0] === 0x2001 && (v[1] < 0x0200 || v[1] === 0x0db8)) || v[0] === 0x2002 || (v[0] === 0x3fff && v[1] < 0x1000));
}

async function boundedText(response: Response, limit: number, code: string): Promise<string> {
  const declared = response.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel(); throw new CalendarSubscriptionError(code, 'The calendar provider returned an oversized or incomplete response. Previous events were retained.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new CalendarSubscriptionError(code, 'The calendar provider returned an empty response. Previous events were retained.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new CalendarSubscriptionError(code, 'The calendar provider returned too much data. Previous events were retained.'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  if (declared !== null && (!response.headers.get('Content-Encoding') || response.headers.get('Content-Encoding') === 'identity') && Number(declared) !== size) {
    throw new CalendarSubscriptionError(code, 'The calendar provider returned an incomplete response. Previous events were retained.');
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

type DnsAnswer = { type?: unknown; data?: unknown };
type DnsResult = { Status?: unknown; Answer?: DnsAnswer[]; TC?: unknown };
/** Only the public hostname is sent to DNS; private feed paths/query tokens never leave the feed request. */
async function resolvePublicHost(hostname: string, signal: AbortSignal, fetcher: typeof fetch): Promise<string[]> {
  const answers = await Promise.all(['A', 'AAAA'].map(async type => {
    const url = new URL(DNS_ENDPOINT); url.searchParams.set('name', hostname); url.searchParams.set('type', type);
    const response = await fetcher(url.href, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal, headers: { Accept: 'application/dns-json' } });
    if (response.status !== 200) { await response.body?.cancel(); throw new CalendarSubscriptionError('feed_dns_failed', 'The calendar provider’s public address could not be verified. Try again later.'); }
    const result = JSON.parse(await boundedText(response, MAX_DNS_BYTES, 'feed_dns_failed')) as DnsResult;
    if (result.Status !== 0 || result.TC === true || (result.Answer !== undefined && !Array.isArray(result.Answer))) throw new CalendarSubscriptionError('feed_dns_failed', 'The calendar provider’s public address could not be verified. Try again later.');
    return (result.Answer || []).filter(answer => answer && (answer.type === 1 || answer.type === 28)).map(answer => typeof answer.data === 'string' ? answer.data : '');
  }));
  return [...new Set(answers.flat())];
}

export interface SubscriptionEventInput {
  url: string;
  calendar: ICloudCalendar;
  windowStart: string;
  windowEnd: string;
  fetch?: typeof fetch;
  resolveHost?: (hostname: string, signal: AbortSignal) => Promise<string[]>;
  /** Optional exact trusted-publisher policy. No wildcard or suffix matching. */
  trustedHosts?: readonly string[];
}

function privateUrlRedactor(originals: Set<string>): (value: string) => string {
  const suffixes = [...new Set([...originals].map(url => url.replace(/^[a-z]+:/i, '')).flatMap(suffix => [suffix, suffix.replace(/&/g, '&amp;'), suffix.replace(/&/g, '&#38;'), suffix.replace(/&/g, '&#x26;')]))];
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = suffixes.map(suffix => {
    const parts = suffix.match(/^\/\/([^/?#]+)(.*)$/);
    // Schemes and hostnames are case-insensitive; private paths and tokens are not.
    const pattern = parts ? '//' + escape(parts[1]).replace(/[a-z]/gi, letter => `[${letter.toLowerCase()}${letter.toUpperCase()}]`) + escape(parts[2]) : escape(suffix);
    return new RegExp('(?:[hH][tT][tT][pP][sS]|[wW][eE][bB][cC][aA][lL][sS]?):' + pattern, 'g');
  });
  return value => patterns.reduce((result, pattern) => result.replace(pattern, '[private calendar subscription]'), value);
}

/** Shared public-label/error scrubber; callers supply only the private URLs already owned by that actor. */
export function redactPrivateCalendarText(value: string, urls: readonly string[]): string {
  return privateUrlRedactor(new Set(urls.filter(url => typeof url === 'string' && /^(?:https|webcals?):\/\//i.test(url))))(value);
}

/** ICAL.js repairs some malformed component endings; do not accept that repair as an authoritative empty feed. */
function validateCalendarStructure(body: string): void {
  const invalid = () => new CalendarSubscriptionError('invalid_feed_content', 'The subscription returned incomplete or unreadable calendar data. Previous events were retained.');
  if (/\r(?!\n)/.test(body)) throw invalid();
  const stack: string[] = []; let opened = false, closed = false, versions = 0;
  for (const line of body.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    if (!line) continue;
    const begin = line.match(/^BEGIN:([A-Z0-9-]{1,64})$/i), end = line.match(/^END:([A-Z0-9-]{1,64})$/i);
    if (begin) {
      const name = begin[1].toUpperCase();
      if (closed || (!stack.length && (opened || name !== 'VCALENDAR')) || (stack.length && name === 'VCALENDAR') || stack.length >= 32) throw invalid();
      stack.push(name); opened = true;
    } else if (end) {
      if (!stack.length || stack.pop() !== end[1].toUpperCase()) throw invalid();
      if (!stack.length) closed = true;
    } else {
      if (!stack.length || !/^[A-Z0-9-]+(?:;[^\r\n]*)?:/i.test(line)) throw invalid();
      if (stack.length === 1 && /^VERSION:/i.test(line)) { if (!/^VERSION:2\.0$/i.test(line) || ++versions !== 1) throw invalid(); }
    }
  }
  if (!opened || !closed || stack.length || versions !== 1) throw invalid();
}

/** Redact decoded full text before the shared parser applies field-length bounds; never rewrite UID identity. */
function redactCalendarText(body: string, redact: (value: string) => string): string {
  validateCalendarStructure(body);
  try {
    const component = new ICAL.Component(ICAL.parse(body));
    for (const event of component.getAllSubcomponents('vevent')) {
      for (const name of ['summary', 'description', 'location']) {
        for (const property of event.getAllProperties(name)) {
          const value = property.getFirstValue();
          if (typeof value === 'string') property.setValue(redact(value));
        }
      }
    }
    return component.toString();
  } catch { throw new CalendarSubscriptionError('invalid_feed_content', 'The subscription returned incomplete or unreadable calendar data. Previous events were retained.'); }
}

/**
 * Bounded, read-only calendar import. DNS checks are a preflight, not DNS pinning:
 * Workers fetch resolves the HTTPS host again; see the documented TOCTOU limitation.
 */
export async function fetchSubscriptionEvents(input: SubscriptionEventInput): Promise<{ events: ICloudEvent[]; authoritative: true }> {
  if (!input.calendar || !/^[a-zA-Z0-9_-]{1,150}$/.test(input.calendar.id)) throw new CalendarSubscriptionError('invalid_feed_identity', 'Choose a valid saved calendar subscription.', 400);
  const from = Date.parse(input.windowStart), to = Date.parse(input.windowEnd);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 400 * 86_400_000) throw new CalendarSubscriptionError('invalid_feed_window', 'Choose a valid calendar date range, up to 400 days.', 400);
  let url = normalizeCalendarFeedUrl(input.url);
  const originals = new Set([input.url, url]);
  const fetcher = input.fetch ?? fetch;
  const controller = new AbortController();
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const hostname = new URL(url).hostname;
      if (input.trustedHosts && !input.trustedHosts.map(host => host.toLowerCase()).includes(hostname)) throw new CalendarSubscriptionError('untrusted_feed_host', 'This calendar provider is not enabled for subscriptions on this Site.', 400);
      const addresses = await (input.resolveHost ? input.resolveHost(hostname, controller.signal) : resolvePublicHost(hostname, controller.signal, fetcher));
      if (!Array.isArray(addresses) || !addresses.length || addresses.some(address => typeof address !== 'string' || !isPublicCalendarAddress(address))) throw new CalendarSubscriptionError('unsafe_feed_address', 'The calendar subscription must resolve only to public Internet addresses.', 400);
      const response = await fetcher(url, { method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: { Accept: 'text/calendar, application/ics, text/plain;q=0.9, application/octet-stream;q=0.8' } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location'); await response.body?.cancel();
        if (!location || redirects === MAX_REDIRECTS) throw new CalendarSubscriptionError('feed_redirect_limit', 'The calendar subscription redirects too many times. Use its final subscription link.');
        let redirected: string; try { redirected = new URL(location, url).href; } catch { throw unsafeAddress(); }
        url = normalizeCalendarFeedUrl(redirected); originals.add(url); if (/^(?:https|webcals?):\/\//i.test(location)) originals.add(location); continue;
      }
      if (response.status !== 200) { await response.body?.cancel(); throw new CalendarSubscriptionError('feed_unavailable', response.status === 401 || response.status === 403 ? 'The calendar subscription link was not accepted. Check its private subscription link; previous events were retained.' : 'The subscribed calendar could not be read. Previous events were retained.'); }
      const contentType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
      if (contentType && !CONTENT_TYPES.has(contentType)) { await response.body?.cancel(); throw new CalendarSubscriptionError('invalid_feed_content', 'This link does not provide an iCalendar subscription. Use its calendar feed link rather than a web page.'); }
      const body = (await boundedText(response, MAX_FEED_BYTES, 'feed_limit')).replace(/^\ufeff/, '').trim();
      if (!/^BEGIN:VCALENDAR(?:\r?\n)[\s\S]*(?:\r?\n)END:VCALENDAR$/i.test(body)) throw new CalendarSubscriptionError('invalid_feed_content', 'The subscription returned incomplete or unreadable calendar data. Previous events were retained.');
      const redact = privateUrlRedactor(originals);
      let events: ICloudEvent[];
      try { events = await parseCalendarData(redactCalendarText(body, redact), input.calendar, input.windowStart, input.windowEnd, { count: 0, deadline }); }
      catch { throw new CalendarSubscriptionError('invalid_feed_content', 'The subscription returned incomplete or unreadable calendar data. Previous events were retained.'); }
      if (controller.signal.aborted || Date.now() >= deadline) throw new CalendarSubscriptionError('feed_timeout', 'The calendar subscription timed out. Previous events were retained.');
      // Some feeds echo their private URL in metadata; it must not escape via shared event text.
      return { events: events.map(event => ({ ...event, uid: event.occurrenceKey, title: redact(event.title), calendarTitle: redact(event.calendarTitle), ...(event.location ? { location: redact(event.location) } : {}), ...(event.notes ? { notes: redact(event.notes) } : {}) })), authoritative: true };
    }
    throw new CalendarSubscriptionError('feed_redirect_limit', 'The calendar subscription redirects too many times.');
  } catch (error) {
    if (error instanceof CalendarSubscriptionError) throw error;
    throw new CalendarSubscriptionError(controller.signal.aborted ? 'feed_timeout' : 'feed_unavailable', controller.signal.aborted ? 'The calendar subscription timed out. Previous events were retained.' : 'The subscribed calendar could not be read safely. Previous events were retained.');
  } finally { controller.abort(); clearTimeout(timeout); }
}

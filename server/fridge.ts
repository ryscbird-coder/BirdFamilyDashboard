import type { HubBindings } from './api.ts';
import { ApiError, object, string, validateData } from './domain.ts';
import type { Data } from './domain.ts';
import { MAX_FRIDGE_IMAGE_BYTES, readFridgeImage } from './fridge-image.ts';

const DAILY_CALLS = 20;
const MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const PROVIDER = 'Cloudflare Workers AI';
const MAX_RESPONSE_BYTES = 100_000;
const RETENTION = {
  providerName: PROVIDER,
  disclosure: 'The photo is sent to Cloudflare Workers AI to identify possible ingredients. The Hub does not save the photo. Cloudflare’s standard synchronous service does not retain content after the response or use it for model training, subject to legal and security exceptions. Review every identification before requesting a recipe.',
  policyUrl: 'https://developers.cloudflare.com/workers-ai/platform/data-usage/',
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

function configuration(env: HubBindings): { url: string; token: string } | undefined {
  try {
    const url = new URL(env.HUB_RECIPE_AI_URL ?? '');
    const token = env.HUB_RECIPE_AI_TOKEN;
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev$/i.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/infer' || url.search || url.hash || typeof token !== 'string' || !/^[A-Za-z0-9._~-]{32,256}$/.test(token)) return;
    return { url: url.href, token };
  } catch { return; }
}

function requiredConfiguration(env: HubBindings): { url: string; token: string } {
  const configured = configuration(env);
  if (!configured) throw new ApiError(503, 'fridge_not_configured', 'Fridge-photo identification is awaiting its private AI connection. You can still add a recipe or scan a printed recipe on this device.');
  return configured;
}

async function readBytes(stream: ReadableStream<Uint8Array> | null, maximum: number): Promise<Uint8Array> {
  const reader = stream?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_input', 'Include the reviewed ingredient list.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new ApiError(413, 'too_large', 'The fridge request is too large.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function ingredients(value: unknown, allowEmpty = true): Data[] {
  if (!Array.isArray(value) || value.length > 40 || (!allowEmpty && value.length === 0)) throw new ApiError(400, 'invalid_ingredients', 'Review between one and forty ingredients before requesting a recipe.');
  return value.map(raw => {
    const item = object(raw);
    const result: Data = { name: string(item.name, 'Ingredient', 120), uncertain: true };
    if (item.amount !== undefined && item.amount !== null) {
      if (typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount < 0 || item.amount > 100_000) throw new ApiError(400, 'invalid_ingredients', 'An ingredient quantity is outside the supported range.');
      result.amount = item.amount;
    }
    if (item.unit !== undefined && item.unit !== null && item.unit !== '') result.unit = string(item.unit, 'Unit', 40);
    if (item.note !== undefined && item.note !== null && item.note !== '') result.note = string(item.note, 'Ingredient note', 300);
    return result;
  });
}

function warnings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new ApiError(400, 'invalid_result', 'The AI returned an invalid warning list.');
  return value.map(text => string(text, 'Warning', 500));
}

async function consumeCall(env: HubBindings): Promise<void> {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  const day = `${get('year')}-${get('month')}-${get('day')}`;
  const counted = await env.DB.prepare('INSERT INTO hub_recipe_ai_daily_usage(day,calls,updated_at) VALUES(?,1,?) ON CONFLICT(day) DO UPDATE SET calls=calls+1,updated_at=excluded.updated_at WHERE calls<? RETURNING calls').bind(day, new Date().toISOString(), DAILY_CALLS).first<{ calls: number }>();
  if (!counted) throw new ApiError(429, 'daily_quota', 'The household has used today’s twenty AI requests. Please try again tomorrow; saved recipes and printed-recipe scanning still work.');
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x4000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x4000));
  return btoa(binary);
}

function cancelled(): ApiError {
  return new ApiError(499, 'fridge_cancelled', 'The fridge request was cancelled. Its photo and draft were not saved.');
}

async function infer(env: HubBindings, config: { url: string; token: string }, payload: Data, signal: AbortSignal): Promise<Data> {
  const controller = new AbortController();
  const duration = Math.min(45_000, Math.max(1, env.FRIDGE_AI_TIMEOUT_MS ?? 45_000));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new ApiError(504, 'fridge_timeout', 'The AI took too long to respond. The photo was not saved. Please try again or enter the ingredients yourself.')); controller.abort(); }, duration);
  });
  let rejectCancelled!: (error: ApiError) => void;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const onAbort = () => { rejectCancelled(cancelled()); controller.abort(); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) throw cancelled();
    return await Promise.race([(async () => {
      const response = await (env.FRIDGE_AI_FETCH ?? fetch)(config.url, { method: 'POST', redirect: 'manual', credentials: 'omit', cache: 'no-store', headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(payload), signal: controller.signal });
      if (!response.ok || response.redirected) { await response.body?.cancel(); throw new ApiError(502, 'fridge_provider_unavailable', 'The private AI service could not complete this request. Your photo and draft have not been saved.'); }
      let bytes: Uint8Array;
      try { bytes = await readBytes(response.body, MAX_RESPONSE_BYTES); }
      catch { throw new ApiError(502, 'fridge_invalid_result', 'The AI response exceeded its supported size. No recipe was saved.'); }
      try { return object(JSON.parse(new TextDecoder().decode(bytes))); }
      catch { throw new ApiError(502, 'fridge_invalid_result', 'The AI response could not be read. No recipe was saved; please try again.'); }
    })(), timedOut, interrupted]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'fridge_provider_unavailable', 'The private AI service could not complete this request. Your photo and draft have not been saved.');
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    controller.abort();
    if (payload.operation === 'recognize' && payload.image && typeof payload.image === 'object') (payload.image as Data).base64 = '';
  }
}

function invalidResult(): ApiError {
  return new ApiError(502, 'fridge_invalid_result', 'The AI response needs another attempt. No recipe was saved. You can edit the ingredients and try again.');
}

/** All requests arrive after household authentication and write-origin checks in handleApi. */
export async function handleFridgeRoute(request: Request, env: HubBindings, path: string): Promise<Response | null> {
  if (!path.startsWith('/api/recipes/fridge/')) return null;
  if (path === '/api/recipes/fridge/status' && request.method === 'GET') {
    const configured = !!configuration(env);
    return json({ configured, visionEnabled: configured, textEnabled: configured, provider: PROVIDER, model: MODEL, retention: RETENTION, ...(!configured ? { reason: 'Fridge-photo identification is awaiting its private AI connection. Printed-recipe scanning remains on this device.' } : {}), limits: { imageBytes: MAX_FRIDGE_IMAGE_BYTES, dailyCalls: DAILY_CALLS } });
  }
  if (path === '/api/recipes/fridge/recognize' && request.method === 'POST') {
    const config = requiredConfiguration(env);
    if (request.headers.get('X-Fridge-Processing-Acknowledged') !== 'true') throw new ApiError(400, 'processing_acknowledgement_required', 'Review the AI photo-processing disclosure and choose Read ingredients to send this photo.');
    const image = await readFridgeImage(request);
    try {
      if (request.signal.aborted) throw cancelled();
      await consumeCall(env);
      const result = await infer(env, config, { operation: 'recognize', image: { mimeType: 'image/jpeg', base64: base64(image) } }, request.signal);
      try { return json({ ingredients: ingredients(result.ingredients), warnings: [...warnings(result.warnings), 'Photo identification is uncertain. Correct names and quantities before asking for a recipe.'] }); }
      catch { throw invalidResult(); }
    } finally { image.fill(0); }
  }
  if (path === '/api/recipes/fridge/suggest' && request.method === 'POST') {
    const config = requiredConfiguration(env);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new ApiError(415, 'invalid_content_type', 'Use a reviewed ingredient list for this request.');
    const bytes = await readBytes(request.body, 16_000);
    let input: Data;
    try { input = object(JSON.parse(new TextDecoder().decode(bytes))); }
    catch { throw new ApiError(400, 'invalid_json', 'The reviewed ingredient list could not be read.'); }
    if (Object.keys(input).some(key => !['ingredients', 'servings', 'preferences'].includes(key))) throw new ApiError(400, 'invalid_input', 'Send only reviewed ingredients, servings and preferences.');
    const reviewed = ingredients(input.ingredients, false);
    if (!Number.isInteger(input.servings) || Number(input.servings) < 1 || Number(input.servings) > 12) throw new ApiError(400, 'invalid_input', 'Choose between one and twelve servings.');
    const preferences = input.preferences === undefined ? undefined : string(input.preferences, 'Preferences', 1000, false);
    if (request.signal.aborted) throw cancelled();
    await consumeCall(env);
    const result = await infer(env, config, { operation: 'suggest', ingredients: reviewed, servings: input.servings, ...(preferences ? { preferences } : {}) }, request.signal);
    try {
      const candidate = object(result.draft);
      if (candidate.servings !== input.servings || !Array.isArray(candidate.ingredients) || candidate.ingredients.length === 0 || candidate.ingredients.length > 40 || typeof candidate.instructions !== 'string' || !candidate.instructions.trim()) throw invalidResult();
      const draft = validateData('recipe', { ...candidate, sourceUrl: undefined });
      if ((draft.ingredients as Data[]).some(item => typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount <= 0)) throw invalidResult();
      const normalized = (name: unknown) => String(name).trim().toLowerCase().replace(/\s+/g, ' ');
      const reviewedNames = new Set(reviewed.map(item => normalized(item.name)));
      const missingIngredients: Data[] = [];
      const missingNames = new Set<string>();
      for (const item of draft.ingredients as Data[]) {
        const name = normalized(item.name);
        if (!reviewedNames.has(name) && !missingNames.has(name)) {
          missingIngredients.push({ ...item, uncertain: true, note: 'Not matched to reviewed ingredients' });
          missingNames.add(name);
        }
      }
      return json({ draft, missingIngredients, warnings: [...warnings(result.warnings), 'AI recipe suggestion: review ingredients, quantities and cooking instructions before saving.'] });
    } catch { throw invalidResult(); }
  }
  throw new ApiError(404, 'not_found', 'Unknown fridge-recipe action.');
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../server/domain.ts';
import { MAX_FRIDGE_IMAGE_BYTES, MAX_FRIDGE_IMAGE_EDGE, readFridgeImage } from '../server/fridge-image.ts';

function jpeg(width = 640, height = 480, progressive = false): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    // One-component SOF, followed by one scan. The reader validates framing,
    // dimensions and segment bounds, rather than decoding entropy content.
    0xff, progressive ? 0xc2 : 0xc0, 0x00, 0x0b,
    0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x01, 0xff, 0x00, 0x02, 0xff, 0xd0, 0x03,
    0xff, 0xd9,
  ]);
}

function request(bytes: Uint8Array, headers: Record<string, string> = {}): Request {
  return new Request('https://hub.test/api/fridge/recognise', {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg', ...headers }, body: Uint8Array.from(bytes).buffer,
  });
}

function failure(status: number, code: string) {
  return (error: unknown) => error instanceof ApiError && error.status === status && error.code === code;
}

test('baseline and progressive JPEG frame dimensions are accepted without changing bytes', async () => {
  for (const progressive of [false, true]) {
    const bytes = jpeg(1280, 720, progressive);
    assert.deepEqual(await readFridgeImage(request(bytes)), bytes);
  }
  assert.deepEqual(await readFridgeImage(request(jpeg(1, 1), { 'Content-Type': 'IMAGE/JPEG; ignored=parameter' })), jpeg(1, 1));
});

test('non-JPEG media types are refused before their bytes are read', async () => {
  for (const type of ['image/png', 'image/webp', 'application/json', 'image/jpg', '']) {
    await assert.rejects(readFridgeImage(request(jpeg(), { 'Content-Type': type })), failure(415, 'invalid_image_type'));
  }
});

test('empty, fake, wrong-signature, truncated and trailing-byte images are refused', async () => {
  const valid = jpeg();
  const wrongSignature = valid.slice(); wrongSignature[0] = 0x89;
  const fake = new TextEncoder().encode('This is not an image.');
  const trailing = new Uint8Array(valid.length + 1); trailing.set(valid);
  for (const bytes of [new Uint8Array(), fake, wrongSignature, valid.slice(0, -1), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), trailing]) {
    await assert.rejects(readFridgeImage(request(bytes)), failure(400, 'invalid_image'));
  }
});

test('malformed segment lengths and scan-before-frame images are refused', async () => {
  const tooLong = jpeg(); tooLong[4] = 0x7f; tooLong[5] = 0xff;
  const tooShort = jpeg(); tooShort[5] = 0x01;
  const noComponents = jpeg(); noComponents[11] = 0;
  const scanFirst = jpeg(); scanFirst[3] = 0xda;
  const unsupportedFrame = jpeg(); unsupportedFrame[3] = 0xc1;
  for (const bytes of [tooLong, tooShort, noComponents, scanFirst, unsupportedFrame]) {
    await assert.rejects(readFridgeImage(request(bytes)), failure(400, 'invalid_image'));
  }
});

test('actual SOF dimensions enforce the long-edge limit and refuse zero dimensions', async () => {
  assert.equal(MAX_FRIDGE_IMAGE_EDGE, 1280);
  for (const bytes of [jpeg(1281, 1), jpeg(1, 1281), jpeg(65535, 65535, true)]) {
    await assert.rejects(readFridgeImage(request(bytes)), failure(413, 'image_too_large'));
  }
  for (const bytes of [jpeg(0, 640), jpeg(640, 0, true)]) {
    await assert.rejects(readFridgeImage(request(bytes)), failure(400, 'invalid_image'));
  }
});

test('the byte ceiling is inclusive and one further streamed byte is refused', async () => {
  const frame = jpeg(1280, 1280);
  const boundary = new Uint8Array(MAX_FRIDGE_IMAGE_BYTES);
  boundary.set(frame.subarray(0, -2));
  boundary.set([0xff, 0xd9], boundary.length - 2);
  assert.deepEqual(await readFridgeImage(request(boundary)), boundary);
  const oversized = new Uint8Array(MAX_FRIDGE_IMAGE_BYTES + 1);
  oversized.set(boundary.subarray(0, -2));
  oversized.set([0xff, 0xd9], oversized.length - 2);
  await assert.rejects(readFridgeImage(request(oversized)), failure(413, 'image_too_large'));
});

test('declared oversize is refused and cancels the body without reading it', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const incoming = { headers: new Headers({ 'Content-Type': 'image/jpeg', 'Content-Length': String(MAX_FRIDGE_IMAGE_BYTES + 1) }), body } as Request;
  await assert.rejects(readFridgeImage(incoming), failure(413, 'image_too_large'));
  assert.equal(cancelled, true);
});

test('streamed bytes are bounded even with absent or dishonest content length, cancelling the source', async () => {
  assert.equal(MAX_FRIDGE_IMAGE_BYTES, 1_048_576);
  for (const length of [undefined, '12']) {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(600_000)); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const headers = new Headers({ 'Content-Type': 'image/jpeg' });
    if (length) headers.set('Content-Length', length);
    const incoming = { headers, body } as Request;
    await assert.rejects(readFridgeImage(incoming), failure(413, 'image_too_large'));
    assert.equal(cancelled, true);
    assert.equal(pulls, 2);
    assert.equal(body.locked, false);
  }
});

test('transport errors become safe image errors without leaking their messages', async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('private transport detail')); } });
  const incoming = { headers: new Headers({ 'Content-Type': 'image/jpeg' }), body } as Request;
  await assert.rejects(readFridgeImage(incoming), error => failure(400, 'invalid_image')(error) && !(error as Error).message.includes('private'));
  assert.equal(body.locked, false);
});

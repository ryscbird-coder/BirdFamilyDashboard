import test from "node:test";
import assert from "node:assert/strict";
import { FridgeCaptureSession } from "../app/fridge-capture.ts";

// Synthetic camera/canvas callbacks; these are lifecycle tests, not physical-camera QA.
function streamFixture() {
  const tracks = [0, 0];
  const stream = { getTracks: () => tracks.map((_, index) => ({ stop() { tracks[index]++; } })) } as unknown as MediaStream;
  return { stream, tracks };
}
function captureFixture(options: { width?: number; height?: number; playError?: Error; drawError?: Error; scratchDrawError?: Error; noContext?: boolean; encodeError?: boolean; getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>; play?: () => Promise<void> } = {}) {
  const media = streamFixture();
  const requests: MediaStreamConstraints[] = [];
  const draws: unknown[][] = [];
  const encodes: { callback: BlobCallback; type?: string; quality?: number; canvas: HTMLCanvasElement; width: number; height: number }[] = [];
  const canvases: HTMLCanvasElement[] = [];
  const canvasDraws: { canvas: HTMLCanvasElement; source: unknown; sourceWidth?: number; sourceHeight?: number; targetWidth: number; targetHeight: number }[] = [];
  const video = { videoWidth: options.width ?? 4000, videoHeight: options.height ?? 3000, srcObject: null as MediaStream | null, async play() { if (options.playError) throw options.playError; await options.play?.(); } } as unknown as HTMLVideoElement;
  const ownerDocument = { createElement(name: string): HTMLCanvasElement { assert.equal(name, "canvas"); return createCanvas(); } };
  const createCanvas = (): HTMLCanvasElement => {
    const index = canvases.length;
    const next = {
      width: 0, height: 0, ownerDocument,
      getContext(type: string) { assert.equal(type, "2d"); return options.noContext ? null : { drawImage(...args: unknown[]) {
        if (options.drawError) throw options.drawError;
        if (index > 0 && options.scratchDrawError) throw options.scratchDrawError;
        draws.push(args);
        const source = args[0] as { width?: number; height?: number; videoWidth?: number; videoHeight?: number };
        canvasDraws.push({ canvas: next, source, sourceWidth: source.width ?? source.videoWidth, sourceHeight: source.height ?? source.videoHeight, targetWidth: next.width, targetHeight: next.height });
      } }; },
      toBlob(callback: BlobCallback, type?: string, quality?: number) { if (options.encodeError) throw new Error("Synthetic encoder failure"); encodes.push({ callback, type, quality, canvas: next, width: next.width, height: next.height }); },
    } as unknown as HTMLCanvasElement;
    canvases.push(next); return next;
  };
  const canvas = createCanvas();
  let videoRef: HTMLVideoElement | null = video, canvasRef: HTMLCanvasElement | null = canvas;
  const session = new FridgeCaptureSession({
    video: () => videoRef, canvas: () => canvasRef,
    getUserMedia: async constraints => { requests.push(constraints); return options.getUserMedia ? options.getUserMedia(constraints) : media.stream; },
  });
  return { session, media, video, canvas, requests, draws, canvasDraws, canvases, encodes, detach() { videoRef = null; canvasRef = null; } };
}
const jpeg = () => new Blob(["synthetic JPEG input"], { type: "image/jpeg" });
const oversizedJpeg = () => new Blob([new Uint8Array(1024 * 1024 + 1)], { type: "image/jpeg" });
const isCancelled = (error: unknown) => error instanceof Error && error.name === "AbortError";

test("capture uses the rear-camera preference, bounds pixels and releases tracks before reading", async () => {
  const fixture = captureFixture();
  await fixture.session.start();
  assert.deepEqual(fixture.requests, [{ video: { facingMode: { ideal: "environment" } }, audio: false }]);
  assert.equal(fixture.video.srcObject, fixture.media.stream);
  fixture.session.capture();
  assert.deepEqual([fixture.canvas.width, fixture.canvas.height], [1280, 960]);
  assert.deepEqual(fixture.draws[0], [fixture.video, 0, 0, 1280, 960]);
  assert.ok(fixture.media.tracks.every(stopped => stopped > 0));
  assert.equal(fixture.video.srcObject, null);
  const pending = fixture.session.image();
  assert.equal(fixture.encodes[0].type, "image/jpeg");
  assert.equal(fixture.encodes[0].quality, 0.82);
  const image = jpeg(); fixture.encodes[0].callback(image);
  assert.equal(fixture.canvas.width, 0, "the raw preview must clear immediately when encoding finishes");
  assert.equal(fixture.canvas.height, 0);
  assert.equal(await pending, image);
  await assert.rejects(fixture.session.image(), /Take a picture/);
});

test("portrait captures are bounded and small captures are never enlarged", async () => {
  for (const [width, height, expected] of [[1200, 2400, [640, 1280]], [640, 480, [640, 480]]] as const) {
    const fixture = captureFixture({ width, height });
    await fixture.session.start(); fixture.session.capture();
    assert.deepEqual([fixture.canvas.width, fixture.canvas.height], expected);
    fixture.session.clear(); assert.deepEqual([fixture.canvas.width, fixture.canvas.height], [0, 0]);
  }
});

test("cancel or unmount clears preview buffers even after component refs have detached", async () => {
  const live = captureFixture(); await live.session.start(); live.detach(); live.session.clear();
  assert.equal(live.video.srcObject, null); assert.ok(live.media.tracks.every(stopped => stopped > 0));
  const captured = captureFixture(); await captured.session.start(); captured.session.capture(); captured.detach(); captured.session.clear();
  assert.deepEqual([captured.canvas.width, captured.canvas.height], [0, 0]);
  await assert.rejects(captured.session.image(), /Take a picture/);
});

test("retake clears the old capture and opens a fresh camera stream", async () => {
  const first = streamFixture(), second = streamFixture(); let requests = 0;
  const fixture = captureFixture({ getUserMedia: async () => requests++ === 0 ? first.stream : second.stream });
  await fixture.session.start(); fixture.session.capture();
  assert.ok(fixture.canvas.width > 0);
  await fixture.session.start();
  assert.deepEqual([fixture.canvas.width, fixture.canvas.height], [0, 0]);
  assert.equal(fixture.video.srcObject, second.stream);
  assert.ok(first.tracks.every(stopped => stopped > 0)); assert.deepEqual(second.tracks, [0, 0]);
  fixture.session.clear(); assert.ok(second.tracks.every(stopped => stopped > 0));
});

test("camera permission arriving after cancel is rejected and every late track is stopped", async () => {
  let grant!: (stream: MediaStream) => void;
  const permission = new Promise<MediaStream>(resolve => { grant = resolve; });
  const fixture = captureFixture({ getUserMedia: () => permission });
  const starting = fixture.session.start(); fixture.session.clear();
  const rejected = assert.rejects(starting, isCancelled);
  grant(fixture.media.stream); await rejected;
  assert.ok(fixture.media.tracks.every(stopped => stopped > 0)); assert.equal(fixture.video.srcObject, null);
});

test("an obsolete permission grant cannot replace a newer camera session", async () => {
  const grants: ((stream: MediaStream) => void)[] = [];
  const fixture = captureFixture({ getUserMedia: () => new Promise(resolve => grants.push(resolve)) });
  const old = fixture.session.start(); const current = fixture.session.start();
  const oldMedia = streamFixture(), newMedia = streamFixture();
  const rejected = assert.rejects(old, isCancelled);
  grants[1](newMedia.stream); await current;
  grants[0](oldMedia.stream); await rejected;
  assert.equal(fixture.video.srcObject, newMedia.stream);
  assert.ok(oldMedia.tracks.every(stopped => stopped > 0)); assert.deepEqual(newMedia.tracks, [0, 0]);
  fixture.session.clear(); assert.ok(newMedia.tracks.every(stopped => stopped > 0));
});

test("play errors and cancellation while play is pending release the attached camera", async () => {
  const failed = captureFixture({ playError: new Error("Synthetic play failure") });
  await assert.rejects(failed.session.start(), /Synthetic play failure/);
  assert.equal(failed.video.srcObject, null); assert.ok(failed.media.tracks.every(stopped => stopped > 0));
  let finishPlay!: () => void;
  const playing = captureFixture({ play: () => new Promise(resolve => { finishPlay = resolve; }) });
  const starting = playing.session.start();
  await new Promise(resolve => setImmediate(resolve));
  playing.session.clear(); const rejected = assert.rejects(starting, isCancelled); finishPlay(); await rejected;
  assert.equal(playing.video.srcObject, null); assert.ok(playing.media.tracks.every(stopped => stopped > 0));
});

test("unready video, unavailable canvas and draw errors clean up without a readable capture", async () => {
  for (const options of [{ width: 0 }, { noContext: true }, { drawError: new Error("Synthetic draw failure") }]) {
    const fixture = captureFixture(options); await fixture.session.start();
    assert.throws(() => fixture.session.capture());
    assert.equal(fixture.video.srcObject, null); assert.ok(fixture.media.tracks.every(stopped => stopped > 0));
    assert.deepEqual([fixture.canvas.width, fixture.canvas.height], [0, 0]);
    await assert.rejects(fixture.session.image(), /Take a picture/);
  }
});

test("clear rejects a pending encoder promptly and late bytes cannot erase a new capture", async () => {
  const fixture = captureFixture(); await fixture.session.start(); fixture.session.capture();
  const old = fixture.session.image(), rejected = assert.rejects(old, isCancelled);
  fixture.session.clear(); await rejected;
  assert.deepEqual([fixture.canvas.width, fixture.canvas.height], [0, 0]);
  await fixture.session.start(); fixture.session.capture();
  fixture.encodes[0].callback(jpeg());
  assert.deepEqual([fixture.canvas.width, fixture.canvas.height], [1280, 960], "late cancelled encoding must not clear a newer preview");
  const current = fixture.session.image(), image = jpeg(); fixture.encodes[1].callback(image);
  assert.equal(await current, image); assert.deepEqual([fixture.canvas.width, fixture.canvas.height], [0, 0]);
});

test("repeated image reads share one pending encode and retain no preview after success", async () => {
  const fixture = captureFixture(); await fixture.session.start(); fixture.session.capture();
  const first = fixture.session.image(), second = fixture.session.image();
  assert.equal(fixture.encodes.length, 1);
  const image = jpeg(); fixture.encodes[0].callback(image);
  assert.deepEqual(await Promise.all([first, second]), [image, image]);
  assert.deepEqual([fixture.canvas.width, fixture.canvas.height], [0, 0]);
});

test("null, empty, non-JPEG and throwing encoders all clear transient pixels", async () => {
  for (const [blob, message] of [[null, /could not be read/], [new Blob([], { type: "image/jpeg" }), /could not be read/], [new Blob(["fixture"], { type: "image/png" }), /JPEG/]] as const) {
    const fixture = captureFixture(); await fixture.session.start(); fixture.session.capture();
    const pending = fixture.session.image(); fixture.encodes[0].callback(blob);
    await assert.rejects(pending, message); assert.deepEqual([fixture.canvas.width, fixture.canvas.height], [0, 0]);
  }
  const throwing = captureFixture({ encodeError: true }); await throwing.session.start(); throwing.session.capture();
  await assert.rejects(throwing.session.image(), /could not be prepared/);
  assert.deepEqual([throwing.canvas.width, throwing.canvas.height], [0, 0]);
});

test("a JPEG exactly at the one MiB limit is accepted", async () => {
  const fixture = captureFixture(); await fixture.session.start(); fixture.session.capture();
  const pending = fixture.session.image(), image = new Blob([new Uint8Array(1024 * 1024)], { type: "image/jpeg" });
  fixture.encodes[0].callback(image); assert.equal(await pending, image);
  assert.deepEqual([fixture.canvas.width, fixture.canvas.height], [0, 0]);
});

test("an oversized JPEG is recompressed at lower quality before allocating smaller pixel buffers", async () => {
  const fixture = captureFixture(); await fixture.session.start(); fixture.session.capture();
  const pending = fixture.session.image(); fixture.encodes[0].callback(oversizedJpeg());
  assert.equal(fixture.encodes.length, 2);
  assert.deepEqual(fixture.encodes.map(encode => [encode.quality, encode.width, encode.height]), [[0.82, 1280, 960], [0.68, 1280, 960]]);
  assert.equal(fixture.canvases.length, 1, "quality retry must not allocate an unnecessary scratch canvas");
  const image = jpeg(); fixture.encodes[1].callback(image); assert.equal(await pending, image);
  assert.ok(fixture.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
});

test("continued oversized output shrinks pixels only after copying the captured image", async () => {
  const fixture = captureFixture(); await fixture.session.start(); fixture.session.capture();
  const pending = fixture.session.image();
  for (let index = 0; index < 3; index++) fixture.encodes[index].callback(oversizedJpeg());
  assert.equal(fixture.canvases.length, 2);
  assert.deepEqual(fixture.encodes.map(encode => [encode.quality, encode.width, encode.height]), [[0.82, 1280, 960], [0.68, 1280, 960], [0.54, 1280, 960], [0.82, 1024, 768]]);
  const copy = fixture.canvasDraws[1];
  assert.equal(copy.source, fixture.canvas);
  assert.deepEqual([copy.sourceWidth, copy.sourceHeight], [1280, 960], "source pixels must still exist when the smaller canvas is drawn");
  assert.deepEqual([copy.targetWidth, copy.targetHeight], [1024, 768]);
  assert.deepEqual([fixture.canvas.width, fixture.canvas.height], [0, 0], "the previous pixel buffer must be cleared after copying");
  const image = jpeg(); fixture.encodes[3].callback(image); assert.equal(await pending, image);
  assert.ok(fixture.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
});

test("persistent oversized output stops after nine bounded attempts, discards every buffer and permits retake", async () => {
  const fixture = captureFixture(); await fixture.session.start(); fixture.session.capture();
  const pending = fixture.session.image(), rejected = assert.rejects(pending, /1 MiB.*discarded/);
  for (let index = 0; index < 9; index++) {
    assert.ok(fixture.encodes[index], `bounded attempt ${index + 1} must exist`);
    fixture.encodes[index].callback(oversizedJpeg());
  }
  await rejected;
  assert.equal(fixture.encodes.length, 9); assert.equal(fixture.canvases.length, 3);
  assert.deepEqual(fixture.encodes.map(encode => [encode.width, encode.height]), [[1280, 960], [1280, 960], [1280, 960], [1024, 768], [1024, 768], [1024, 768], [819, 614], [819, 614], [819, 614]]);
  assert.deepEqual(fixture.encodes.map(encode => encode.quality), [0.82, 0.68, 0.54, 0.82, 0.68, 0.54, 0.82, 0.68, 0.54]);
  assert.deepEqual(fixture.canvasDraws.slice(1).map(draw => [draw.sourceWidth, draw.sourceHeight, draw.targetWidth, draw.targetHeight]), [[1280, 960, 1024, 768], [1024, 768, 819, 614]], "each resize must copy the previous stage before its pixels are cleared");
  assert.ok(fixture.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  await assert.rejects(fixture.session.image(), /Take a picture/);
  await fixture.session.start(); fixture.session.capture();
  assert.deepEqual([fixture.canvas.width, fixture.canvas.height], [1280, 960]);
  const retake = fixture.session.image(), image = jpeg(); fixture.encodes[9].callback(image); assert.equal(await retake, image);
  assert.ok(fixture.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
});

test("cancelling a scratch-canvas retry clears owned buffers and prevents stale retry allocation", async () => {
  const fixture = captureFixture(); await fixture.session.start(); fixture.session.capture();
  const old = fixture.session.image(), rejected = assert.rejects(old, isCancelled);
  for (let index = 0; index < 3; index++) fixture.encodes[index].callback(oversizedJpeg());
  assert.equal(fixture.canvases.length, 2); const stale = fixture.encodes[3];
  fixture.session.clear(); await rejected;
  assert.ok(fixture.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  await fixture.session.start(); fixture.session.capture();
  stale.callback(oversizedJpeg());
  assert.equal(fixture.encodes.length, 4, "cancelled callback must not schedule another quality or resize attempt");
  assert.equal(fixture.canvases.length, 2, "cancelled callback must not allocate another scratch canvas");
  assert.deepEqual([fixture.canvas.width, fixture.canvas.height], [1280, 960], "cancelled callback must not erase the new preview");
  const current = fixture.session.image(), image = jpeg(); fixture.encodes[4].callback(image); assert.equal(await current, image);
  assert.ok(fixture.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
});

test("scratch draw failure clears both the original and the just-allocated canvas", async () => {
  const fixture = captureFixture({ scratchDrawError: new Error("Synthetic scratch draw failure") });
  await fixture.session.start(); fixture.session.capture();
  const pending = fixture.session.image(), rejected = assert.rejects(pending, /could not be resized.*discarded/);
  for (let index = 0; index < 3; index++) fixture.encodes[index].callback(oversizedJpeg());
  await rejected;
  assert.equal(fixture.canvases.length, 2); assert.equal(fixture.encodes.length, 3);
  assert.ok(fixture.canvases.every(canvas => canvas.width === 0 && canvas.height === 0), "even an unsuccessful scratch draw must release its allocated pixels");
  await assert.rejects(fixture.session.image(), /Take a picture/);
});

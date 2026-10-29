type CaptureOptions = {
  video: () => HTMLVideoElement | null;
  canvas: () => HTMLCanvasElement | null;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
};
type PendingImage = { generation: number; promise: Promise<Blob>; reject: (reason: Error) => void };
const MAX_IMAGE_EDGE = 1280;
const MAX_IMAGE_BYTES = 1024 * 1024;
const JPEG_QUALITIES = [0.82, 0.68, 0.54];
const MAX_IMAGE_SHRINKS = 2;
function cancelled(): Error {
  const error = new Error("Camera capture was cancelled. Start the camera again to take another picture.");
  error.name = "AbortError";
  return error;
}
function stop(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { /* Release the remaining tracks even if one has already ended. */ }
  }
}

/** Owns only live camera tracks and a transient canvas; callers own upload cancellation. */
export class FridgeCaptureSession {
  private generation = 0;
  private stream: MediaStream | null = null;
  private activeVideo: HTMLVideoElement | null = null;
  private capturedCanvas: HTMLCanvasElement | null = null;
  private readonly imageCanvases = new Set<HTMLCanvasElement>();
  private captured = false;
  private pendingImage: PendingImage | null = null;
  private readonly options: CaptureOptions;

  constructor(options: CaptureOptions) { this.options = options; }

  async start(): Promise<void> {
    this.clear();
    const generation = this.generation;
    const video = this.options.video();
    if (!video) throw new Error("The camera preview is not available. Reopen capture and try again.");
    const getUserMedia = this.options.getUserMedia || ((constraints: MediaStreamConstraints) => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser cannot open the camera. Use a supported browser over a secure connection.");
      }
      return navigator.mediaDevices.getUserMedia(constraints);
    });
    try {
      const stream = await getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (generation !== this.generation) { stop(stream); throw cancelled(); }
      this.stream = stream;
      this.activeVideo = video;
      video.srcObject = stream;
      await video.play();
      if (generation !== this.generation) throw cancelled();
    } catch (error) {
      if (generation === this.generation) this.clear();
      throw error;
    }
  }

  capture(): void {
    try {
      const video = this.activeVideo;
      const canvas = this.options.canvas();
      if (!this.stream || !video || !canvas) throw new Error("Start the camera before taking a picture.");
      const { videoWidth: width, videoHeight: height } = video;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error("The camera is not ready yet. Wait for the preview, then try again.");
      }
      this.generation++;
      this.capturedCanvas = canvas;
      this.imageCanvases.add(canvas);
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser could not prepare the picture. Please try again.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      this.captured = true;
      this.releaseCamera();
    } catch (error) {
      this.clear();
      throw error;
    }
  }

  async image(): Promise<Blob> {
    if (this.pendingImage) return this.pendingImage.promise;
    const canvas = this.capturedCanvas;
    if (!this.captured || !canvas || !canvas.width || !canvas.height) {
      this.clear();
      throw new Error("Take a picture before reading ingredients.");
    }
    let resolveImage!: (blob: Blob) => void;
    let rejectImage!: (error: Error) => void;
    const promise = new Promise<Blob>((resolve, reject) => { resolveImage = resolve; rejectImage = reject; });
    const pending = { generation: this.generation, promise, reject: rejectImage };
    this.pendingImage = pending;
    this.captured = false;
    let encodingCanvas = canvas;
    let shrinkCount = 0;
    const finish = (error?: Error, blob?: Blob) => {
      if (this.pendingImage !== pending || pending.generation !== this.generation) { rejectImage(cancelled()); return; }
      this.pendingImage = null;
      this.clear();
      if (error) rejectImage(error);
      else if (blob) resolveImage(blob);
    };
    const encode = (qualityIndex: number) => {
      if (this.pendingImage !== pending || pending.generation !== this.generation) { rejectImage(cancelled()); return; }
      try { encodingCanvas.toBlob(blob => {
        if (this.pendingImage !== pending || pending.generation !== this.generation) { rejectImage(cancelled()); return; }
        if (!blob || !blob.size) finish(new Error("The picture could not be read. Retake it and try again."));
        else if (blob.type.toLowerCase() !== "image/jpeg") finish(new Error("This browser could not create a JPEG picture. Try another supported browser."));
        else if (blob.size > MAX_IMAGE_BYTES) {
          if (qualityIndex + 1 < JPEG_QUALITIES.length) encode(qualityIndex + 1);
          else if (shrinkCount < MAX_IMAGE_SHRINKS) {
            try {
              // Copy before clearing: changing a canvas's dimensions erases its pixels.
              const smaller = encodingCanvas.ownerDocument.createElement("canvas");
              this.imageCanvases.add(smaller);
              smaller.width = Math.max(1, Math.round(encodingCanvas.width * 0.8));
              smaller.height = Math.max(1, Math.round(encodingCanvas.height * 0.8));
              const context = smaller.getContext("2d");
              if (!context) throw new Error("Canvas compression is unavailable.");
              context.drawImage(encodingCanvas, 0, 0, smaller.width, smaller.height);
              encodingCanvas.width = 0; encodingCanvas.height = 0;
              encodingCanvas = smaller; this.capturedCanvas = smaller; shrinkCount++;
              encode(0);
            } catch { finish(new Error("The picture could not be resized. It was discarded. Retake a simpler, well-lit view of the ingredients.")); }
          } else finish(new Error("The picture could not fit within the 1 MiB processing limit. It was discarded. Retake a simpler, well-lit view of the ingredients."));
        } else finish(undefined, blob);
      }, "image/jpeg", JPEG_QUALITIES[qualityIndex]); }
      catch { finish(new Error("The picture could not be prepared. Retake it and try again.")); }
    };
    encode(0);
    return promise;
  }

  clear(): void {
    this.generation++;
    const pending = this.pendingImage;
    this.pendingImage = null;
    this.captured = false;
    this.releaseCamera();
    const canvases = new Set([...this.imageCanvases, this.capturedCanvas, this.options.canvas()]);
    this.imageCanvases.clear();
    this.capturedCanvas = null;
    for (const canvas of canvases) if (canvas) { canvas.width = 0; canvas.height = 0; }
    pending?.reject(cancelled());
  }

  private releaseCamera(): void {
    const stream = this.stream;
    this.stream = null;
    stop(stream);
    const video = this.activeVideo;
    this.activeVideo = null;
    if (video) video.srcObject = null;
  }
}

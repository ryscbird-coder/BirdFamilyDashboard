import { ApiError } from './domain.ts';

export const MAX_FRIDGE_IMAGE_BYTES = 1_048_576;
export const MAX_FRIDGE_IMAGE_EDGE = 1_280;
const MAX_FRIDGE_IMAGE_PIXELS = MAX_FRIDGE_IMAGE_EDGE * MAX_FRIDGE_IMAGE_EDGE;

function invalidImage(): ApiError {
  return new ApiError(400, 'invalid_image', 'The fridge photo could not be read as a complete JPEG. Please retake it.');
}

function imageTooLarge(): ApiError {
  return new ApiError(413, 'image_too_large', 'Use a JPEG fridge photo no larger than 1 MiB and 1280 pixels on its longest edge.');
}

/** Inspect JPEG framing and its actual frame dimensions; this is not an image decoder. */
function validateJpeg(bytes: Uint8Array): void {
  const size = bytes.byteLength;
  if (size < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[size - 2] !== 0xff || bytes[size - 1] !== 0xd9) throw invalidImage();

  let cursor = 2;
  let frameSeen = false;
  let scanSeen = false;
  let scanning = false;
  let frameComponents = 0;

  while (cursor < size) {
    if (scanning) {
      // Entropy bytes may contain escaped FF bytes and standalone restart markers.
      while (cursor < size && bytes[cursor] !== 0xff) cursor++;
    }
    if (cursor >= size || bytes[cursor++] !== 0xff) throw invalidImage();
    while (cursor < size && bytes[cursor] === 0xff) cursor++;
    if (cursor >= size) throw invalidImage();
    const marker = bytes[cursor++];
    if (scanning && (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) throw invalidImage();
    if (marker === 0xd9) {
      if (!frameSeen || !scanSeen || cursor !== size) throw invalidImage();
      return;
    }
    if (marker === 0x01) continue; // TEM has no segment length.
    scanning = false;
    if (cursor + 2 > size) throw invalidImage();
    const length = (bytes[cursor] << 8) | bytes[cursor + 1];
    const end = cursor + length;
    if (length < 2 || end > size - 2) throw invalidImage();

    if (marker === 0xc0 || marker === 0xc2) {
      if (frameSeen || length < 8) throw invalidImage();
      const height = (bytes[cursor + 3] << 8) | bytes[cursor + 4];
      const width = (bytes[cursor + 5] << 8) | bytes[cursor + 6];
      frameComponents = bytes[cursor + 7];
      if (!width || !height || !frameComponents || length !== 8 + frameComponents * 3) throw invalidImage();
      if (width > MAX_FRIDGE_IMAGE_EDGE || height > MAX_FRIDGE_IMAGE_EDGE || width * height > MAX_FRIDGE_IMAGE_PIXELS) throw imageTooLarge();
      frameSeen = true;
    } else if ((marker >= 0xc1 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      // Other JPEG frame modes are outside the supported browser capture format.
      throw invalidImage();
    } else if (marker === 0xda) {
      if (!frameSeen || length < 6) throw invalidImage();
      const components = bytes[cursor + 2];
      if (!components || components > frameComponents || length !== 6 + components * 2) throw invalidImage();
      scanSeen = true;
      scanning = true;
    }
    cursor = end;
  }
  throw invalidImage();
}

/** Read one transient, bounded JPEG. Never retain its bytes outside the caller's request. */
export async function readFridgeImage(request: Request): Promise<Uint8Array> {
  if (request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'image/jpeg') {
    throw new ApiError(415, 'invalid_image_type', 'Use a JPEG fridge photo.');
  }
  if (Number(request.headers.get('Content-Length')) > MAX_FRIDGE_IMAGE_BYTES) {
    await request.body?.cancel().catch(() => {});
    throw imageTooLarge();
  }
  const reader = request.body?.getReader();
  if (!reader) throw invalidImage();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_FRIDGE_IMAGE_BYTES) {
        await reader.cancel().catch(() => {});
        throw imageTooLarge();
      }
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    await reader.cancel().catch(() => {});
    throw invalidImage();
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  validateJpeg(bytes);
  return bytes;
}

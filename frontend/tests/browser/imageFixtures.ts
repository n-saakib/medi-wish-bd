import { deflateSync } from 'node:zlib';

export const maxImageBytes = 3 * 1024 * 1024;
export const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Standard PNG CRC-32, kept dependency-free for deterministic synthetic fixtures. */
export function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}

/** Valid RGB PNG with reproducible noisy pixels; dimensions and seed change the actual image content. */
export function pngFixture(width = 32, height = 24, seed = 15): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 4097 || height > 4097 || width * height > 2_000_000) {
    throw new Error('Synthetic PNG dimensions must fit the fixture memory bound');
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2; // RGB, no alpha; ImageIO re-encoding also fits the large fixture's size bound.
  const rows = Buffer.alloc((width * 3 + 1) * height);
  let state = (seed >>> 0) || 1;
  for (let y = 0; y < height; y += 1) {
    const start = y * (width * 3 + 1);
    for (let x = 1; x <= width * 3; x += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      rows[start + x] = state & 255;
    }
  }
  return Buffer.concat([pngSignature, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** 3 × 2 RGBA8 PNG exercises transparent, partial-alpha and opaque pixels without color profiles. */
export function rgbaPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(3, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 6; // RGBA; primary channels avoid rounding ambiguity when browsers premultiply alpha.
  const rows = Buffer.from([
    0, 0, 0, 0, 0, 255, 0, 0, 128, 0, 255, 0, 64,
    0, 0, 0, 255, 192, 255, 255, 0, 255, 17, 34, 51, 255,
  ]);
  return Buffer.concat([pngSignature, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

export function validPng(): Buffer { return pngFixture(); }
/** Valid input below 3 MiB; native Windows JDK 25 re-encoding yields 3,145,842 bytes, above the output limit. */
export function outputOversizedPng(): Buffer { return pngFixture(1024, 1023, 15); }
/** Complete PNG framing/CRC, but the DEFLATE block uses the reserved block type and cannot decode. */
export function corruptPixelsPng(): Buffer {
  const source = validPng();
  return Buffer.concat([source.subarray(0, 33), chunk('IDAT', Buffer.from([0x78, 0x9c, 0x07, 0, 0, 0, 0])),
    chunk('IEND', Buffer.alloc(0))]);
}
/** Complete synthetic 2 × 2 images, generated and independently decoded with native Windows sharp. */
export function validGif(): Buffer {
  return Buffer.from('R0lGODlhAgACAIAAAExpcRRktCH5BAUAAAAALAAAAAACAAIAAAICjFMAOw==', 'base64');
}
export function validWebp(): Buffer {
  return Buffer.from('UklGRjwAAABXRUJQVlA4IDAAAADwAQCdASoCAAIAAUAmJaACdLoB+AAETAAA/vDXA/9Js8TZ4mz5JH/zsGxLteAAAAA=', 'base64');
}
/** 2.57 MB of actual RGB data, above Tomcat's 2 MB swallow default and below the accepted 3 MiB limit. */
export function largePng(): Buffer { return pngFixture(1000, 900, 15); }
export function oversizedDimensionsPng(): Buffer { return pngFixture(4097, 1); }
export function textAsPng(): Buffer { return Buffer.from('Synthetic executable-free text, not an image.'); }
export function oversizedPng(): Buffer {
  const bytes = Buffer.alloc(maxImageBytes + 1);
  validPng().copy(bytes);
  return bytes;
}

/** Generated once by JDK 25 ImageIO: 8 by 6 RGB JPEG, no personal metadata. */
export function validJpeg(): Buffer {
  return Buffer.from('/9j/4AAQSkZJRgABAgAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAGAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDg6KKK+gPDP//Z', 'base64');
}

/** Complete JPEG header/dimensions and EOI, but a second SOI in the pixel scan forces decode failure. */
export function corruptPixelsJpeg(): Buffer {
  const bytes = validJpeg();
  const scan = bytes.indexOf(Buffer.from([0xff, 0xda]));
  if (scan < 0) throw new Error('Synthetic JPEG has no pixel scan');
  const pixels = scan + 2 + bytes.readUInt16BE(scan + 2);
  bytes[pixels] = 0xff;
  bytes[pixels + 1] = 0xd8;
  return bytes;
}

export type InvalidUpload = { label: string; bytes: Buffer; name?: string; mimeType?: string };
export function invalidUploads(): InvalidUpload[] {
  return [
    { label: 'empty file', bytes: Buffer.alloc(0) },
    { label: '3 MiB plus one byte', bytes: oversizedPng() },
    { label: 'text with PNG extension', bytes: textAsPng() },
    { label: 'PNG declared JPEG', bytes: validPng(), name: 'front.jpg', mimeType: 'image/jpeg' },
    { label: 'PNG with JPEG extension', bytes: validPng(), name: 'front.jpg' },
    { label: 'PNG with only declared MIME mismatch', bytes: validPng(), name: 'front.png', mimeType: 'image/jpeg' },
    { label: 'truncated PNG', bytes: validPng().subarray(0, 40) },
    { label: 'JPEG declared PNG', bytes: validJpeg(), name: 'front.png', mimeType: 'image/png' },
    { label: 'JPEG with PNG extension', bytes: validJpeg(), name: 'front.png', mimeType: 'image/jpeg' },
    { label: 'JPEG with only declared MIME mismatch', bytes: validJpeg(), name: 'front.jpg', mimeType: 'image/png' },
    { label: 'truncated JPEG', bytes: validJpeg().subarray(0, 100), name: 'front.jpg', mimeType: 'image/jpeg' },
    { label: 'corrupt JPEG pixel scan', bytes: corruptPixelsJpeg(), name: 'front.jpg', mimeType: 'image/jpeg' },
    { label: 'corrupt PNG compressed pixels', bytes: corruptPixelsPng() },
    { label: 'width above 4096', bytes: oversizedDimensionsPng() },
    { label: 'height above 4096', bytes: pngFixture(1, 4097) },
    { label: 'GIF', bytes: validGif(), name: 'front.gif', mimeType: 'image/gif' },
    { label: 'GIF disguised as PNG', bytes: validGif() },
    { label: 'SVG', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), name: 'front.svg', mimeType: 'image/svg+xml' },
    { label: 'WebP', bytes: validWebp(), name: 'front.webp', mimeType: 'image/webp' },
    { label: 'WebP disguised as PNG', bytes: validWebp() },
  ];
}

/** Valid text metadata plus trailing polyglot marker; server re-encoding must discard both. */
export function pngWithMetadata(marker: string): Buffer {
  const source = validPng();
  return Buffer.concat([source.subarray(0, 33), chunk('tEXt', Buffer.from(`Synthetic\0${marker}`)),
    source.subarray(33), Buffer.from(marker)]);
}
/** Minimal little-endian EXIF TIFF (empty IFD), followed by a synthetic marker in the APP1 segment. */
export function jpegWithExif(marker: string): Buffer {
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff, Buffer.from(marker)]);
  const segment = Buffer.alloc(4);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([validJpeg().subarray(0, 2), segment, payload, validJpeg().subarray(2)]);
}

import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  corruptPixelsJpeg, corruptPixelsPng, invalidUploads, jpegWithExif, largePng, maxImageBytes, outputOversizedPng, oversizedDimensionsPng, oversizedPng, pngCrc32, pngFixture,
  pngSignature, pngWithMetadata, rgbaPng, textAsPng, validGif, validJpeg, validPng, validWebp,
} from './browser/imageFixtures';

/** Parse the emitted PNG independently; Node's native CRC checks every chunk's integrity. */
function inspect(bytes: Buffer, colorType: 2 | 6 = 2) {
  expect(bytes.subarray(0, 8)).toEqual(pngSignature);
  const chunks: { type: string; data: Buffer }[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const end = offset + 8 + size;
    expect(end + 4).toBeLessThanOrEqual(bytes.length);
    expect(bytes.readUInt32BE(end)).toBe(crc32(bytes.subarray(offset + 4, end)));
    chunks.push({ type: bytes.toString('ascii', offset + 4, offset + 8), data: bytes.subarray(offset + 8, end) });
    offset = end + 4;
  }
  expect(offset).toBe(bytes.length);
  expect(chunks.map(({ type }) => type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  const header = chunks[0].data;
  expect(header.subarray(8)).toEqual(Buffer.from([8, colorType, 0, 0, 0]));
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const rows = inflateSync(chunks[1].data);
  const stride = width * (colorType === 6 ? 4 : 3) + 1;
  expect(rows).toHaveLength(stride * height);
  for (let y = 0; y < height; y += 1) expect(rows[y * stride]).toBe(0);
  return { width, height, rows };
}

describe('synthetic image fixtures', () => {
  it('matches the standard CRC-32 vector and Node CRC for binary data', () => {
    expect(pngCrc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(pngCrc32(Buffer.from([0, 137, 255, 15]))).toBe(crc32(Buffer.from([0, 137, 255, 15])));
  });

  it.each([[1, 1], [32, 24], [4096, 1], [1, 4096], [4097, 1]])(
    'encodes valid, checksummed, decodable RGB PNG at %i by %i', (width, height) => {
      const actual = inspect(pngFixture(width, height, 19));
      expect({ width: actual.width, height: actual.height }).toEqual({ width, height });
    });

  it('RGBA PNG preserves explicit transparent, partial and opaque scanline pixels', () => {
    const { width, height, rows } = inspect(rgbaPng(), 6);
    expect([width, height]).toEqual([3, 2]);
    expect(rows).toEqual(Buffer.from([
      0, 0, 0, 0, 0, 255, 0, 0, 128, 0, 255, 0, 64,
      0, 0, 0, 255, 192, 255, 255, 0, 255, 17, 34, 51, 255,
    ]));
  });

  it('is reproducible and a different seed changes pixels, not just metadata', () => {
    expect(pngFixture(16, 8, 42)).toEqual(pngFixture(16, 8, 42));
    expect(inspect(pngFixture(16, 8, 42)).rows).not.toEqual(inspect(pngFixture(16, 8, 43)).rows);
    expect(validPng()).toEqual(pngFixture());
  });

  it('large valid fixture exercises unread bodies above 2 MiB and stays under 3 MiB', () => {
    const bytes = largePng();
    expect(bytes.length).toBeGreaterThan(2.5 * 1024 * 1024);
    expect(bytes.length).toBeLessThanOrEqual(maxImageBytes);
    const actual = inspect(bytes);
    expect([actual.width, actual.height]).toEqual([1000, 900]);
  });

  it('output-over-limit fixture is a complete decodable input below the input cap', () => {
    const bytes = outputOversizedPng();
    expect(bytes.length).toBeLessThanOrEqual(maxImageBytes);
    expect(bytes.length).toBeGreaterThan(maxImageBytes * 0.99);
    const { width, height } = inspect(bytes);
    expect([width, height]).toEqual([1024, 1023]);
    // Native Windows JDK 25 independently produced 3,145,842 bytes; the API must enforce its output cap too.
  });

  it('corrupt pixels differ from truncation: complete framing and CRC reach an invalid DEFLATE stream', () => {
    const bytes = corruptPixelsPng();
    let offset = 8;
    const types: string[] = [];
    while (offset < bytes.length) {
      const size = bytes.readUInt32BE(offset);
      const end = offset + 8 + size;
      expect(end + 4).toBeLessThanOrEqual(bytes.length);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      types.push(type);
      expect(bytes.readUInt32BE(end)).toBe(crc32(bytes.subarray(offset + 4, end)));
      if (type === 'IDAT') expect(() => inflateSync(bytes.subarray(offset + 8, end))).toThrow();
      offset = end + 4;
    }
    expect(offset).toBe(bytes.length);
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('unsupported fixtures are complete 2 × 2 GIF/WebP images rather than undecodable headers', () => {
    const gif = validGif();
    expect(gif.subarray(0, 6).toString()).toBe('GIF89a');
    expect([gif.readUInt16LE(6), gif.readUInt16LE(8)]).toEqual([2, 2]);
    expect(gif.subarray(-1)).toEqual(Buffer.from([0x3b]));
    const webp = validWebp();
    expect(webp.subarray(0, 4).toString()).toBe('RIFF');
    expect(webp.readUInt32LE(4) + 8).toBe(webp.length);
    expect(webp.subarray(8, 16).toString()).toBe('WEBPVP8 ');
    expect(webp.readUInt32LE(16) + 20).toBe(webp.length);
    expect(webp.subarray(23, 26)).toEqual(Buffer.from([0x9d, 1, 0x2a]));
    expect([webp.readUInt16LE(26) & 0x3fff, webp.readUInt16LE(28) & 0x3fff]).toEqual([2, 2]);
  });

  it('oversize and dimensions fixtures cross the accepted boundary by exactly one', () => {
    expect(maxImageBytes).toBe(3_145_728);
    expect(oversizedPng()).toHaveLength(3_145_729);
    expect(oversizedPng().subarray(0, validPng().length)).toEqual(validPng());
    expect(inspect(oversizedDimensionsPng()).width).toBe(4097);
  });

  it.each([[0, 1], [1, 0], [-1, 1], [1.5, 1], [4098, 1], [2000, 2000]])(
    'rejects unsafe fixture allocation %i by %i', (width, height) => {
      expect(() => pngFixture(width, height)).toThrow('fixture memory bound');
    });

  it('JPEG contains its 8 by 6 frame and complete JPEG markers', () => {
    const bytes = validJpeg();
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
    expect(bytes.subarray(-2)).toEqual(Buffer.from([255, 217]));
    const frame = bytes.indexOf(Buffer.from([255, 192]));
    expect(frame).toBeGreaterThan(0);
    expect(bytes.readUInt16BE(frame + 5)).toBe(6);
    expect(bytes.readUInt16BE(frame + 7)).toBe(8);
  });

  it('corrupt JPEG retains complete header segments, frame dimensions and EOI with an invalid pixel scan', () => {
    const source = validJpeg();
    const bytes = corruptPixelsJpeg();
    expect(bytes).toHaveLength(source.length);
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([255, 216]));
    expect(bytes.subarray(-2)).toEqual(Buffer.from([255, 217]));
    let offset = 2;
    const markers: number[] = [];
    while (bytes[offset + 1] !== 0xda) {
      expect(bytes[offset]).toBe(0xff);
      const marker = bytes[offset + 1];
      markers.push(marker);
      const size = bytes.readUInt16BE(offset + 2);
      expect(size).toBeGreaterThanOrEqual(2);
      expect(offset + 2 + size).toBeLessThan(bytes.length);
      if (marker === 0xc0) {
        expect(bytes.readUInt16BE(offset + 5)).toBe(6);
        expect(bytes.readUInt16BE(offset + 7)).toBe(8);
      }
      offset += 2 + size;
    }
    expect(markers).toContain(0xc0);
    expect(markers).toContain(0xc4);
    const pixels = offset + 2 + bytes.readUInt16BE(offset + 2);
    expect(bytes.subarray(pixels, pixels + 2)).toEqual(Buffer.from([255, 216]));
    expect(bytes.subarray(0, pixels)).toEqual(source.subarray(0, pixels));
    expect(bytes.subarray(pixels + 2)).toEqual(source.subarray(pixels + 2));
  });

  it('PNG metadata fixture has a valid ancillary chunk and a separate appended marker', () => {
    const marker = 'synthetic-polyglot-marker';
    const bytes = pngWithMetadata(marker);
    const size = bytes.readUInt32BE(33);
    const end = 33 + 8 + size;
    expect(bytes.toString('ascii', 37, 41)).toBe('tEXt');
    expect(bytes.readUInt32BE(end)).toBe(crc32(bytes.subarray(37, end)));
    expect(bytes.subarray(41, end).toString()).toBe(`Synthetic\0${marker}`);
    expect(bytes.subarray(-marker.length).toString()).toBe(marker);
    // Removing just the added chunk and suffix recovers the original complete valid PNG.
    expect(Buffer.concat([bytes.subarray(0, 33), bytes.subarray(end + 4, -marker.length)])).toEqual(validPng());
  });

  it('JPEG EXIF fixture adds a bounded APP1 segment without damaging the underlying JPEG', () => {
    const marker = 'synthetic-exif-marker';
    const bytes = jpegWithExif(marker);
    expect(bytes.subarray(2, 4)).toEqual(Buffer.from([255, 225]));
    const size = bytes.readUInt16BE(4);
    expect(bytes.toString('ascii', 6, 12)).toBe('Exif\0\0');
    expect(bytes.subarray(12, 16)).toEqual(Buffer.from([73, 73, 42, 0]));
    expect(bytes.subarray(6, size + 4).includes(Buffer.from(marker))).toBe(true);
    expect(Buffer.concat([bytes.subarray(0, 2), bytes.subarray(size + 4)])).toEqual(validJpeg());
  });

  it.each([
    ['PNG with only declared MIME mismatch', 'image/png', 'image/jpeg', 'png'],
    ['JPEG with only declared MIME mismatch', 'image/jpeg', 'image/png', 'jpg'],
  ])('isolates declared MIME mismatch for %s with complete correctly named bytes',
    (label, actualMime, declaredMime, extension) => {
      const fixture = invalidUploads().find((candidate) => candidate.label === label);
      expect(fixture).toBeDefined();
      const { bytes, name, mimeType } = fixture!;
      // Infer actual type from bytes independently of the supplied MIME and filename.
      const detectedMime = bytes.subarray(0, 8).equals(pngSignature) ? 'image/png'
        : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'image/jpeg' : undefined;
      expect(detectedMime).toBe(actualMime);
      expect(name?.split('.').at(-1)).toBe(extension);
      expect(mimeType).toBe(declaredMime);
      expect(mimeType).not.toBe(detectedMime);
      if (detectedMime === 'image/png') {
        expect([inspect(bytes).width, inspect(bytes).height]).toEqual([32, 24]);
      } else {
        expect(bytes).toEqual(validJpeg());
        expect(bytes.subarray(-2)).toEqual(Buffer.from([255, 217]));
      }
    });

  it('malformed matrix contains distinct rejection causes and no real personal data', () => {
    const cases = invalidUploads();
    expect(new Set(cases.map(({ label }) => label)).size).toBe(cases.length);
    expect(cases.map(({ label }) => label)).toEqual(expect.arrayContaining([
      'empty file', '3 MiB plus one byte', 'PNG declared JPEG', 'PNG with JPEG extension',
      'PNG with only declared MIME mismatch', 'JPEG with only declared MIME mismatch',
      'truncated PNG', 'JPEG declared PNG', 'JPEG with PNG extension', 'truncated JPEG',
      'corrupt JPEG pixel scan', 'width above 4096', 'height above 4096', 'GIF', 'SVG', 'WebP',
    ]));
    expect(textAsPng().subarray(0, 8)).not.toEqual(pngSignature);
  });
});

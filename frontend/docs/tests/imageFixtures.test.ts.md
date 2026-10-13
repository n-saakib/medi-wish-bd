# `tests/imageFixtures.test.ts`

Independent PNG chunk/CRC/inflate checks, deterministic pixels, large-body and exact size/pixel boundaries, bounded fixture allocation and JPEG markers.

Run `npx vitest run --project unit tests/imageFixtures.test.ts`. These test synthetic fixture integrity and filesystem/input guards without a backend, browser or real storage writes. Execution results are recorded in the Ticket 15 E2E evidence.

Metadata fixtures verify PNG ancillary chunk CRC and appended payload separation, plus a well-framed JPEG EXIF APP1 segment that preserves the complete original JPEG.

Additional integrity checks cover complete GIF/WebP framing and 2 × 2 dimensions, invalid DEFLATE despite complete PNG framing and valid native CRCs, and the valid below-limit input used for the independently characterized output-size refusal.

The malformed JPEG unit case verifies complete segment bounds, unchanged 8 × 6 SOF and EOI, and precisely the two mutated pixel-scan bytes. The matrix requires JPEG MIME/extension mismatches and truncation in addition to PNG failures.

The RGBA fixture passes the same independent native CRC/chunk/inflate parser with color type 6 and four channels. Its 3 × 2 dimensions and every raw filter/scanline byte are compared with explicit expected pixels, including zero, partial and full alpha.

Two parameterized MIME-isolation checks infer actual format from magic bytes independently of the file MIME and suffix, require the correct actual-format extension, assert the other declared MIME, and check complete valid PNG/JPEG fixture content. Removing an isolated case or changing its extension to match the wrong declared MIME fails these guards.

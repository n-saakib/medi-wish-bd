import { createHmac } from 'node:crypto';

/** The RFC 6238 time step in seconds, matching the API's authenticator codes. */
export const totpStepSeconds = 30;

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decodes an unpadded RFC 4648 Base32 string; spaces are ignored, as in the grouped key the setup page shows. */
export function decodeBase32(text: string): Buffer {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of text.replace(/\s+/g, '')) {
    const value = base32Alphabet.indexOf(character);
    if (value < 0) throw new Error('The key is not Base32');
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** The time step that contains `epochSeconds`. */
export function totpStep(epochSeconds = Date.now() / 1000): number {
  return Math.floor(epochSeconds / totpStepSeconds);
}

/** The 6-digit RFC 6238 HMAC-SHA1 code of a Base32 key for one time step. */
export function totpCode(base32Key: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decodeBase32(base32Key)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

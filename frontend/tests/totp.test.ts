import { describe, expect, it } from 'vitest';
import { decodeBase32, totpCode, totpStep } from './browser/totp';

// RFC 6238 appendix B: the SHA1 seed is the ASCII string "12345678901234567890".
const rfcKey = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totpCode', () => {
  it('decodes the Base32 key to the RFC seed, ignoring the page’s grouping spaces', () => {
    expect(decodeBase32(rfcKey).toString('ascii')).toBe('12345678901234567890');
    expect(decodeBase32('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ')).toEqual(decodeBase32(rfcKey));
  });

  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('gives the RFC 6238 SHA1 code at T=%i', (seconds, code) => {
    expect(totpCode(rfcKey, totpStep(seconds))).toBe(code);
  });

  it('refuses a key outside Base32', () => {
    expect(() => totpCode('GEZDGNBV1', 1)).toThrow('not Base32');
  });
});

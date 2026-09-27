# `tests/browser/totp.ts`

Source: [`../../../tests/browser/totp.ts`](../../../tests/browser/totp.ts)

## Purpose

A test-only authenticator app for the browser specs. From the Base32 key the setup page shows, it computes the RFC 6238 codes the API accepts, so a spec can enroll and verify like a person with a phone. It uses only `node:crypto` and runs in the Playwright worker, never in the page.

## Exports

- `totpStepSeconds` — 30, the RFC 6238 step the API uses.
- `decodeBase32(text)` — decodes unpadded RFC 4648 Base32, ignoring spaces, so the page's grouped key can be passed as shown. Any other character throws.
- `totpStep(epochSeconds = now)` — the step that contains a time.
- `totpCode(base32Key, step)` — the 6-digit HMAC-SHA1 code for one step: an 8-byte big-endian counter, dynamic truncation, modulo 10⁶, zero-padded.

## Use

The API accepts a code only from a step later than the last one it accepted, within one step either side of now. So a spec that verifies twice computes the second code for `max(enrolledStep + 1, totpStep())`: the next step's code, never a replay.

## Verification

[`tests/totp.test.ts`](../totp.test.ts.md) checks the RFC 6238 SHA1 vectors. The staff MFA and privacy specs use it against the real API.

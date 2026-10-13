import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

/** Real, fixture-free contract probes: no seeded actor or product is required. */
function apiOrigin(): string {
  const value = process.env.MEDI_WISH_API_URL;
  if (!value) throw new Error('Set MEDI_WISH_API_URL to the running test backend before integration tests.');
  return value;
}

async function expectError(response: Response, status: number, code: string, message: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const requestId = response.headers.get('x-request-id');
  expect(requestId).toBeTruthy();
  expect(await response.json()).toEqual({ code, message, requestId });
}

it('story 15: unknown public image has a bounded anonymous 404 and no-store', async () => {
  const response = await fetch(`${apiOrigin()}/api/public/product-images/${randomUUID()}.png`,
    { signal: AbortSignal.timeout(10_000) });
  await expectError(response, 404, 'NOT_FOUND', 'The requested resource was not found.');
});

it('story 15: anonymous multipart upload is refused before product or image validation', async () => {
  const body = new FormData();
  body.append('id', randomUUID());
  body.append('file', new Blob(['synthetic invalid bytes'], { type: 'image/png' }), 'synthetic.png');
  const response = await fetch(`${apiOrigin()}/api/staff/products/${randomUUID()}/images`,
    { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
  await expectError(response, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
  expect(response.headers.get('www-authenticate')).toBe('Bearer');
});

it('story 15: public image HEAD is anonymous, bounded and body-free for an unknown image', async () => {
  const response = await fetch(`${apiOrigin()}/api/public/product-images/${randomUUID()}.jpg`,
    { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
  expect(response.status).toBe(404);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-request-id')).toBeTruthy();
  expect(await response.text()).toBe('');
});

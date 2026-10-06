import { expect, it } from 'vitest';

it('ticket 11: the real profile resource refuses anonymous reads with the bounded envelope', async () => {
  const baseUrl = process.env.MEDI_WISH_API_URL;
  if (!baseUrl) throw new Error('Set MEDI_WISH_API_URL to the running test backend before integration tests.');
  const response = await fetch(new URL('/api/user/me/profile', baseUrl));
  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(['code', 'message', 'requestId']);
  expect(body.code).toBe('AUTHENTICATION_REQUIRED');
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
});
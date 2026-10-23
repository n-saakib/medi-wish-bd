import { expect, it } from 'vitest';

it.each([
  ['/api/auth/password-reset/request', {}, 400, 'INVALID_REQUEST'],
  ['/api/user/me/email-verification', undefined, 401, 'AUTHENTICATION_REQUIRED'],
] as const)('ticket 05: %s keeps its real API refusal bounded', async (path, body, status, code) => {
  const baseUrl = process.env.MEDI_WISH_API_URL;
  if (!baseUrl) throw new Error('Set MEDI_WISH_API_URL to the running test backend before integration tests.');
  const response = await fetch(new URL(path, baseUrl), {
    method: 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const answer = await response.json();
  expect(Object.keys(answer).sort()).toEqual(['code', 'message', 'requestId']);
  expect(answer.code).toBe(code);
  expect(answer.requestId).toBe(response.headers.get('x-request-id'));
});

import { expect, it } from 'vitest';

it('story 08: anonymous user search has a bounded 401 envelope and no-store', async () => {
  const baseUrl = process.env.MEDI_WISH_API_URL;
  if (!baseUrl) throw new Error('Set MEDI_WISH_API_URL to the running test backend before integration tests.');
  const response = await fetch(`${baseUrl}/api/admin/users/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body: unknown = await response.json();
  expect(body).toEqual({ code: 'AUTHENTICATION_REQUIRED', message: expect.any(String), requestId: expect.any(String) });
});

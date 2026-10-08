import { expect, it } from 'vitest';
import { probeHealth } from '../src/lib/health.ts';

it('story 01: the real backend is live, ready, and exposes only public health status', async () => {
  const baseUrl = process.env.MEDI_WISH_API_URL;
  if (!baseUrl) throw new Error('Set MEDI_WISH_API_URL to the running test backend before integration tests.');
  expect(await probeHealth(baseUrl)).toEqual({ liveness: 'up', readiness: 'up' });
});

it('story 14: the real staff Product list rejects an anonymous request with a bounded error', async () => {
  const baseUrl = process.env.MEDI_WISH_API_URL;
  if (!baseUrl) throw new Error('Set MEDI_WISH_API_URL to the running test backend before integration tests.');
  const response = await fetch(new URL('/api/staff/products', baseUrl));
  expect(response.status).toBe(401);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const body = await response.json();
  expect(body).toEqual({ code: 'AUTHENTICATION_REQUIRED', message: expect.any(String), requestId: expect.any(String) });
  expect(body.message.length).toBeLessThanOrEqual(200);
  expect(body.requestId.length).toBeLessThanOrEqual(64);
});

import { expect, it } from 'vitest';
import { probeHealth } from '../src/lib/health.ts';

it('story 01: the real backend is live, ready, and exposes only public health status', async () => {
  const baseUrl = process.env.MEDI_WISH_API_URL;
  if (!baseUrl) throw new Error('Set MEDI_WISH_API_URL to the running test backend before integration tests.');
  expect(await probeHealth(baseUrl)).toEqual({ liveness: 'up', readiness: 'up' });
});

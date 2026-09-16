import { describe, expect, it } from 'vitest';
import { probeHealth } from '../src/lib/health.ts';

describe('public health probe', () => {
  it('reports a live and ready API using only its public statuses', async () => {
    const result = await probeHealth('http://localhost:8080', {
      fetch: async () => Response.json({ status: 'UP' }),
    });

    expect(result).toEqual({ liveness: 'up', readiness: 'up' });
  });

  it('distinguishes a live process from an unavailable database', async () => {
    const result = await probeHealth('http://localhost:8080', {
      fetch: async (input) => String(input).endsWith('/liveness')
        ? Response.json({ status: 'UP' })
        : Response.json({ status: 'DOWN' }, { status: 503 }),
    });
    expect(result).toEqual({ liveness: 'up', readiness: 'down' });
  });

  it('returns a safe unavailable state when the connection fails', async () => {
    const result = await probeHealth('http://localhost:8080', {
      fetch: async () => { throw new Error('internal connection error with sensitive details'); },
    });
    expect(result).toEqual({ liveness: 'unavailable', readiness: 'unavailable' });
  });

  it('bounds slow health checks instead of leaving the caller waiting', async () => {
    const result = await probeHealth('http://localhost:8080', {
      timeoutMs: 20,
      fetch: async (_input, init) => new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(Response.json({ status: 'UP' })), 100);
        init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('timeout')); });
      }),
    });
    expect(result).toEqual({ liveness: 'unavailable', readiness: 'unavailable' });
  });

  it.each([
    ['invalid JSON', () => new Response('internal server detail', { status: 200 })],
    ['wrong HTTP status', () => Response.json({ status: 'UP' }, { status: 503 })],
    ['unknown status', () => Response.json({ status: 'UNKNOWN' })],
    ['unexpected diagnostic fields', () => Response.json({ status: 'UP', components: { db: 'private data' } })],
  ])('rejects %s without copying response details', async (_name, response) => {
    const result = await probeHealth('http://localhost:8080', { fetch: async () => response() });
    expect(result).toEqual({ liveness: 'invalid-response', readiness: 'invalid-response' });
  });
});

export type HealthState = 'up' | 'down' | 'unavailable' | 'invalid-response';
export type HealthResult = { liveness: HealthState; readiness: HealthState };
type ProbeOptions = { fetch?: typeof globalThis.fetch; timeoutMs?: number };

export async function probeHealth(baseUrl: string, options: ProbeOptions = {}): Promise<HealthResult> {
  const fetcher = options.fetch ?? globalThis.fetch;
  async function check(group: 'liveness' | 'readiness'): Promise<HealthState> {
    try {
      const response = await fetcher(new URL(`/actuator/health/${group}`, baseUrl), {
        signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
        cache: 'no-store',
        redirect: 'error',
      });
      const body: unknown = await response.json();
      if (body !== null && typeof body === 'object' && Object.keys(body).length === 1 && 'status' in body) {
        if (response.status === 200 && body.status === 'UP') return 'up';
        if (response.status === 503 && (body.status === 'DOWN' || body.status === 'OUT_OF_SERVICE')) return 'down';
      }
      return 'invalid-response';
    } catch (error) {
      return error instanceof SyntaxError ? 'invalid-response' : 'unavailable';
    }
  }
  const [liveness, readiness] = await Promise.all([check('liveness'), check('readiness')]);
  return { liveness, readiness };
}

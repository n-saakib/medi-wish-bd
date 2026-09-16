import { probeHealth } from '../src/lib/health.ts';

const result = await probeHealth(process.env.MEDI_WISH_API_URL ?? 'http://127.0.0.1:8080');
console.log(JSON.stringify(result));
process.exitCode = result.liveness === 'up' && result.readiness === 'up' ? 0 : 1;

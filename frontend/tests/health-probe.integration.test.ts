import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

type HealthGroup = 'liveness' | 'readiness';
type HealthResponse = { status: string; httpStatus: number };
type HealthResponses = Record<HealthGroup, HealthResponse>;

const frontendDirectory = fileURLToPath(new URL('..', import.meta.url));
const probeScriptPath = fileURLToPath(new URL('../tools/health-probe.ts', import.meta.url));

async function runProbeWithFixture(responses: HealthResponses) {
  const requestedPaths: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? '';
    let group: HealthGroup | undefined;
    if (path === '/actuator/health/liveness') group = 'liveness';
    else if (path === '/actuator/health/readiness') group = 'readiness';

    if (!group) {
      response.writeHead(404).end();
      return;
    }

    requestedPaths.push(path);
    const health = responses[group];
    response.writeHead(health.httpStatus, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: health.status }));
  });

  try {
    const baseUrl = await listen(server);
    const result = await launchProbe(baseUrl);
    return { ...result, requestedPaths };
  } finally {
    if (server.listening) await close(server);
  }
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('The health fixture did not receive a TCP address.'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function launchProbe(baseUrl: string): Promise<{ exitCode: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [probeScriptPath], {
      cwd: frontendDirectory,
      env: { ...process.env, MEDI_WISH_API_URL: baseUrl },
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let stdout = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 10_000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (exitCode) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error('The health-probe child process exceeded 10 seconds.'));
        return;
      }
      resolve({ exitCode, stdout });
    });
  });
}

it('runs the real health probe and prints normalized UP states with exit code 0', async () => {
  const result = await runProbeWithFixture({
    liveness: { status: 'UP', httpStatus: 200 },
    readiness: { status: 'UP', httpStatus: 200 },
  });

  expect(result.requestedPaths.sort()).toEqual([
    '/actuator/health/liveness',
    '/actuator/health/readiness',
  ]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe('{"liveness":"up","readiness":"up"}');
}, 15_000);

it('runs the real health probe and normalizes OUT_OF_SERVICE readiness with exit code 1', async () => {
  const result = await runProbeWithFixture({
    liveness: { status: 'UP', httpStatus: 200 },
    readiness: { status: 'OUT_OF_SERVICE', httpStatus: 503 },
  });

  expect(result.requestedPaths.sort()).toEqual([
    '/actuator/health/liveness',
    '/actuator/health/readiness',
  ]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout.trim()).toBe('{"liveness":"up","readiness":"down"}');
}, 15_000);

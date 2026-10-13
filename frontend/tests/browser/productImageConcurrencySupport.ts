import { spawn } from 'node:child_process';
import { expect, type APIResponse } from '@playwright/test';
import { checkedTarget, psql } from './testApi';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Hold only this test's synthetic Product rows; release and reap our psql child even if an assertion fails. */
export async function withProductLock<T>(ids: string[], action: (pid: number) => Promise<T>): Promise<T> {
  const schema = checkedTarget('product image race');
  if (!ids.length || ids.some((id) => !uuid.test(id))) throw new Error('Product lock requires synthetic UUIDs');
  const host = process.env.TEST_DB_HOST;
  const port = process.env.TEST_DB_PORT;
  if (!host || !port || !['127.0.0.1', 'localhost', '::1'].includes(host) || !['55432', '55433'].includes(port)) {
    throw new Error('Product race requires an explicit isolated loopback test database on port 55432 or 55433');
  }
  const child = spawn(process.env.PSQL ?? 'psql', ['-h', host, '-p', port,
    '-U', process.env.TEST_DB_ADMIN ?? 'postgres', '-d', 'medi_wish_test', '-X', '-q', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let failure = false;
  child.stdin.on('error', () => { failure = true; });
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  // Do not print server diagnostics or inherited credentials; report only that the test blocker failed.
  child.stderr.on('data', () => { failure = true; });
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new Error('Could not start test Product lock client')));
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error('Test Product lock client failed')));
  });
  // Handle an early exit while the readiness assertion is polling.
  void closed.catch(() => { failure = true; });
  child.stdin.write(`BEGIN; SET LOCAL statement_timeout = '30s'; SELECT pg_backend_pid();\n`
    + `SELECT id FROM ${schema}.products WHERE id IN (${ids.map((id) => `'${id}'`).join(',')})`
    + " ORDER BY id FOR UPDATE; SELECT 't15-lock-ready';\n");
  try {
    await expect.poll(() => failure ? 'failed' : output.includes('t15-lock-ready'),
      { message: 'the test owns the Product row locks', timeout: 5_000 }).toBe(true);
    const lines = output.trim().split(/\r?\n/);
    const pid = Number(lines[0]);
    expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
    expect(lines.slice(1, lines.indexOf('t15-lock-ready'))).toEqual([...new Set(ids)].sort());
    return await action(pid);
  } finally {
    child.stdin.end('ROLLBACK;\n\\q\n');
    const watchdog = setTimeout(() => child.kill(), 5_000);
    try { await closed; } finally { clearTimeout(watchdog); }
  }
}

/** Observe actual queued database requests rather than assuming Promise.all made the requests overlap. */
export async function blockedRequests(pid: number, count: number): Promise<void> {
  const schema = checkedTarget('product image lock observer');
  if (!Number.isSafeInteger(pid) || pid < 1 || !Number.isSafeInteger(count) || count < 1) {
    throw new Error('Product lock observer requires a positive process id and request count');
  }
  // PostgreSQL queues same-row waiters behind each other: only the first necessarily names our pid.
  // UNION deduplicates pids (and bounds cycles); every traversed waiter must belong to this run's role.
  await expect.poll(() => Number(psql(`WITH RECURSIVE blocked(pid) AS (SELECT ${pid} UNION`
    + ` SELECT activity.pid FROM pg_stat_activity activity JOIN blocked`
    + ` ON blocked.pid = ANY(pg_blocking_pids(activity.pid)) WHERE activity.usename = '${schema}')`
    + ` SELECT count(*) FROM blocked WHERE pid <> ${pid};`)),
  { message: `${count} independent requests are waiting on the held Product lock`, timeout: 10_000 }).toBe(count);
}

export async function race(ids: string[], commands: (() => Promise<APIResponse>)[]): Promise<APIResponse[]> {
  let pending: Promise<APIResponse>[] = [];
  try {
    await withProductLock(ids, async (pid) => {
      pending = commands.map(async (command) => command());
      for (const command of pending) void command.catch(() => {});
      await blockedRequests(pid, commands.length);
    });
    return await Promise.all(pending);
  } catch (error) {
    // Commands may still finish after releasing the lock; do not let them escape the fixture's lifetime.
    await Promise.allSettled(pending);
    throw error;
  }
}

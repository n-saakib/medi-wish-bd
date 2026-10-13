import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { APIResponse } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedRequests, race, withProductLock } from './browser/productImageConcurrencySupport';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), psql: vi.fn(), poll: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), spawn: mocks.spawn,
}));
vi.mock('./browser/testApi', async (original) => ({
  ...await original<typeof import('./browser/testApi')>(), psql: mocks.psql,
}));
vi.mock('@playwright/test', () => ({
  expect: Object.assign((value: unknown) => expect(value), {
    poll: (producer: () => unknown | Promise<unknown>) => ({
      toBe: async (value: unknown) => {
        mocks.poll(producer);
        await Promise.resolve();
        expect(await producer()).toBe(value);
      },
    }),
  }),
}));

const schema = 'mw_browser_123456abcdef';
const productId = '12345678-1234-4321-8123-123456789abc';

function fakeClient(options: { ready?: boolean; rows?: string[]; closes?: boolean; diagnostic?: string; afterRelease?: () => void } = {}) {
  const child = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const input: string[] = [];
  const stdin = new Writable({ write(chunk: Buffer, _encoding, complete) {
    const sql = chunk.toString();
    input.push(sql);
    if (sql.startsWith('BEGIN;')) queueMicrotask(() => {
      if (options.diagnostic) stderr.write(options.diagnostic);
      stdout.write(`42\n${(options.rows ?? [productId]).map((id) => `${id}\n`).join('')}`
        + `${options.ready === false ? '' : 't15-lock-ready\n'}`);
    });
    if (sql.includes('ROLLBACK;')) queueMicrotask(() => {
      options.afterRelease?.();
      if (options.closes !== false) child.emit('close', 0);
    });
    complete();
  } });
  const kill = vi.fn(() => { queueMicrotask(() => child.emit('close', 0)); return true; });
  Object.assign(child, { stdin, stdout, stderr, kill });
  return { child, input, kill };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('MEDI_WISH_TEST_SCHEMA', schema);
  vi.stubEnv('TEST_DB_HOST', '127.0.0.1');
  vi.stubEnv('TEST_DB_PORT', '55433');
  vi.stubEnv('TEST_DB_ADMIN', 'postgres');
  vi.stubEnv('PSQL', 'test-psql');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('the bounded Product image lock fixture', () => {
  it('requires the harness schema before starting a child or calling a command', async () => {
    vi.stubEnv('MEDI_WISH_TEST_SCHEMA', undefined);
    const action = vi.fn();
    await expect(withProductLock([productId], action)).rejects.toThrow('schema set by the test API setup');
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it.each([{ ids: [] }, { ids: ['not-a-uuid'] }, { ids: ["'; DELETE FROM products; --"] },
    { ids: [productId.toUpperCase()] }])(
    'refuses empty, malformed, injected or noncanonical Product ids before spawn: %j', async ({ ids }) => {
      await expect(withProductLock(ids, vi.fn())).rejects.toThrow('synthetic UUIDs');
      expect(mocks.spawn).not.toHaveBeenCalled();
    });

  it.each([
    ['TEST_DB_HOST', undefined], ['TEST_DB_HOST', 'remote.example.test'], ['TEST_DB_HOST', '169.254.169.254'],
    ['TEST_DB_PORT', undefined], ['TEST_DB_PORT', '5432'], ['TEST_DB_PORT', '55433;DROP'], ['TEST_DB_PORT', '65535'],
  ])('refuses unsafe or missing connection setting %s=%s before spawn', async (key, value) => {
    vi.stubEnv(key, value);
    await expect(withProductLock([productId], vi.fn())).rejects.toThrow('isolated loopback test database');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('locks only the checked Product rows, waits for readiness, then rolls back and reaps the owned child', async () => {
    const fake = fakeClient();
    mocks.spawn.mockReturnValue(fake.child);
    const action = vi.fn(async (pid) => { expect(pid).toBe(42); return 'result'; });
    expect(await withProductLock([productId], action)).toBe('result');
    expect(mocks.spawn).toHaveBeenCalledWith('test-psql', expect.arrayContaining([
      '-h', '127.0.0.1', '-p', '55433', '-d', 'medi_wish_test', '-v', 'ON_ERROR_STOP=1',
    ]), { stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fake.input[0]).toContain(`FROM ${schema}.products WHERE id IN ('${productId}') ORDER BY id FOR UPDATE`);
    expect(fake.input[0]).toContain("statement_timeout = '30s'");
    expect(fake.input.at(-1)).toBe('ROLLBACK;\n\\q\n');
    expect(action).toHaveBeenCalledOnce();
    expect(fake.kill).not.toHaveBeenCalled();
  });

  it('refuses readiness when PostgreSQL locked fewer rows than requested and releases the lock', async () => {
    const fake = fakeClient({ rows: [] });
    mocks.spawn.mockReturnValue(fake.child);
    const action = vi.fn();
    await expect(withProductLock([productId], action)).rejects.toThrow();
    expect(action).not.toHaveBeenCalled();
    expect(fake.input.at(-1)).toBe('ROLLBACK;\n\\q\n');
  });

  it('accepts SQL set semantics for repeated ids and requires all distinct rows', async () => {
    const otherId = 'aaaaaaaa-1234-4321-8123-123456789abc';
    const fake = fakeClient({ rows: [productId, otherId] });
    mocks.spawn.mockReturnValue(fake.child);
    await expect(withProductLock([otherId, productId, productId], async () => 'ready')).resolves.toBe('ready');
  });

  it('rolls back and suppresses private diagnostics when readiness fails', async () => {
    const privateDiagnostic = 'synthetic password and private database path';
    const fake = fakeClient({ ready: false, diagnostic: privateDiagnostic });
    mocks.spawn.mockReturnValue(fake.child);
    const action = vi.fn();
    const failure = await withProductLock([productId], action).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(privateDiagnostic);
    expect(action).not.toHaveBeenCalled();
    expect(fake.input.at(-1)).toBe('ROLLBACK;\n\\q\n');
  });

  it('preserves an action failure while rolling back the lock', async () => {
    const fake = fakeClient();
    mocks.spawn.mockReturnValue(fake.child);
    await expect(withProductLock([productId], async () => { throw new Error('observable command failed'); }))
      .rejects.toThrow('observable command failed');
    expect(fake.input.at(-1)).toBe('ROLLBACK;\n\\q\n');
    expect(fake.kill).not.toHaveBeenCalled();
  });

  it('terminates only its own unresponsive child after the bounded cleanup wait', async () => {
    vi.useFakeTimers();
    const fake = fakeClient({ closes: false });
    mocks.spawn.mockReturnValue(fake.child);
    const pending = withProductLock([productId], async () => 'done');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toBe('done');
    expect(fake.kill).toHaveBeenCalledOnce();
    expect(fake.input.at(-1)).toBe('ROLLBACK;\n\\q\n');
  });

  it('requests recursive, distinct blockers rooted at the exact owned pid and scoped to the harness role', async () => {
    mocks.psql.mockReturnValue('2');
    await blockedRequests(42, 2);
    expect(mocks.psql).toHaveBeenCalledWith('WITH RECURSIVE blocked(pid) AS (SELECT 42 UNION'
      + ' SELECT activity.pid FROM pg_stat_activity activity JOIN blocked'
      + ' ON blocked.pid = ANY(pg_blocking_pids(activity.pid))'
      + ` WHERE activity.usename = '${schema}') SELECT count(*) FROM blocked WHERE pid <> 42;`);
  });

  it('fails observation when the database has fewer queued requests instead of treating a count as readiness', async () => {
    mocks.psql.mockReturnValue('1');
    await expect(blockedRequests(42, 2)).rejects.toThrow();
  });

  it.each([[0, 2], [42, 0], [NaN, 2], [42, 1.5]])('refuses invalid observer pid/count %s/%s before SQL', async (pid, count) => {
    await expect(blockedRequests(pid, count)).rejects.toThrow('positive process id and request count');
    expect(mocks.psql).not.toHaveBeenCalled();
  });

  it('releases the lock before collecting both HTTP results', async () => {
    let release!: (response: APIResponse) => void;
    const second = new Promise<APIResponse>((resolve) => { release = resolve; });
    const firstResponse = { status: () => 201 } as APIResponse;
    const secondResponse = { status: () => 200 } as APIResponse;
    const fake = fakeClient({ afterRelease: () => release(secondResponse) });
    mocks.spawn.mockReturnValue(fake.child);
    mocks.psql.mockReturnValue('2');
    expect(await race([productId], [async () => firstResponse, () => second])).toEqual([firstResponse, secondResponse]);
    expect(fake.input.at(-1)).toBe('ROLLBACK;\n\\q\n');
  });

  it('settles an outstanding command after another command fails and the lock is released', async () => {
    let release!: (response: APIResponse) => void;
    let finished = false;
    const outstanding = new Promise<APIResponse>((resolve) => { release = resolve; })
      .then((response) => { finished = true; return response; });
    const fake = fakeClient({ afterRelease: () => release({ status: () => 201 } as APIResponse) });
    mocks.spawn.mockReturnValue(fake.child);
    mocks.psql.mockReturnValue('2');
    await expect(race([productId], [() => outstanding, async () => { throw new Error('command refused'); }]))
      .rejects.toThrow('command refused');
    expect(finished).toBe(true);
  });
});

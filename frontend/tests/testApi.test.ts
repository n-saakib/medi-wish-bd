import { EventEmitter } from 'node:events';
import { connect, Socket } from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import startTestApi, {
  apiEnvironment, apiUrl, checkedTarget, psql as executeSql, grantRole, makeSuperAdmin, markMobileVerified, removeRole, rolledBackSql,
  sessionStates, tableFingerprints, testSchemaVariable, testStorageVariable,
} from './browser/testApi';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs', () => ({ openSync: vi.fn(() => 99), closeSync: vi.fn(), mkdirSync: vi.fn(), readFileSync: vi.fn(), rmSync: vi.fn() }));
vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:net')>();
  return { ...actual, connect: vi.fn() };
});

/** Socket outcomes are controlled: setup units never depend on another ticket's occupied port. */
function portProbe(answer: 'connect' | 'error') {
  vi.mocked(connect).mockImplementation(() => {
    const socket = new Socket();
    queueMicrotask(() => answer === 'connect' ? socket.emit('connect')
      : socket.emit('error', new Error('controlled connection refusal')));
    return socket;
  });
}

const psql = vi.mocked(execFileSync);
const sqlSent = () => psql.mock.calls.map(([, , options]) => String((options as { input: string }).input));

/** A child process that exits when killed, or at once when `exitsAtStartup`. */
function fakeApiProcess(exitsAtStartup: boolean) {
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { kill: () => child.emit('exit', 143) });
    if (exitsAtStartup) setTimeout(() => child.emit('exit', 1), 0);
    return child as unknown as ReturnType<typeof spawn>;
  });
}

/** Stays pending until the supplied request signal actually aborts, as a listener withholding HTTP headers does. */
function stalledReadiness(): AbortSignal[] {
  const signals: AbortSignal[] = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = options?.signal;
    if (signal) {
      signals.push(signal);
      signal.addEventListener('abort', () => reject(new Error('controlled readiness abort')), { once: true });
    }
  })));
  return signals;
}

/** Answers the version check with PostgreSQL 18, the migration check with `migrated`, and anything else with ''. */
function databaseAnswers(migrated: 't' | 'f') {
  psql.mockImplementation((_file, _args, options) => {
    const sql = String((options as { input: string }).input);
    if (sql.includes('server_version_num')) return '18';
    return sql.includes('databasechangelog') ? migrated : '';
  });
}

beforeEach(() => {
  vi.stubEnv('TEST_DB_HOST', '127.0.0.1');
  vi.stubEnv('TEST_DB_PORT', '55433');
  vi.mocked(openSync).mockReturnValue(99);
  vi.mocked(readFileSync).mockReturnValue('Started MediWishApplication in 1 second');
  portProbe('error');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('apiEnvironment', () => {
  it('drops every inherited setting that could redirect the API, and keeps the rest', () => {
    const inherited = {
      SPRING_DATASOURCE_URL: 'jdbc:postgresql://elsewhere/medi_wish_dev',
      SPRING_DATASOURCE_USERNAME: 'other',
      spring_liquibase_url: 'jdbc:postgresql://elsewhere/medi_wish_dev',
      'spring.datasource.password': 'other',
      SPRING_APPLICATION_JSON: '{"spring":{"datasource":{"url":"jdbc:postgresql://elsewhere/x"}}}',
      SPRING_CONFIG_ADDITIONAL_LOCATION: 'file:./elsewhere.yaml',
      DB_NAME: 'medi_wish_dev',
      APP_AUTH_JWT_SECRET: 'inherited',
      JAVA_TOOL_OPTIONS: '-Dspring.datasource.url=jdbc:postgresql://elsewhere/x',
      JDK_JAVA_OPTIONS: '-Dspring.profiles.active=dev',
      _JAVA_OPTIONS: '-Dspring.profiles.active=dev',
      PATH: 'C:\\bin',
      SystemRoot: 'C:\\Windows',
      JAVA_HOME: 'C:\\java',
    };

    expect(apiEnvironment(inherited)).toEqual({ PATH: 'C:\\bin', SystemRoot: 'C:\\Windows', JAVA_HOME: 'C:\\java' });
  });
});

describe('database target safety', () => {
  it.each([
    ['missing host', undefined, '55433'], ['missing port', '127.0.0.1', undefined],
    ['default cluster', '127.0.0.1', '5432'], ['remote cluster', 'db.example.test', '55433'],
    ['LAN cluster', '192.168.1.2', '55432'], ['deceptive host', '127.0.0.1.example.test', '55433'],
    ['socket directory', '/tmp', '55433'], ['wrong port', 'localhost', '55434'],
  ])('refuses %s before setup or raw SQL mutates anything', async (_, host, port) => {
    vi.stubEnv('TEST_DB_HOST', host);
    vi.stubEnv('TEST_DB_PORT', port);
    await expect(startTestApi()).rejects.toThrow('explicit loopback TEST_DB_HOST');
    expect(() => executeSql('CREATE ROLE should_never_run;')).toThrow('explicit loopback TEST_DB_HOST');
    expect(psql).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(mkdirSync).not.toHaveBeenCalled();
    expect(openSync).not.toHaveBeenCalled();
  });

  it.each([['127.0.0.1', '55432'], ['localhost', '55433'], ['::1', '55433']])(
    'uses the explicitly allowed target %s:%s for SQL', (host, port) => {
      vi.stubEnv('TEST_DB_HOST', host);
      vi.stubEnv('TEST_DB_PORT', port);
      psql.mockReturnValue('18');
      expect(executeSql('SELECT 18;')).toBe('18');
      expect(psql.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['-h', host, '-p', port, '-d', 'medi_wish_test']));
    });
});

describe('startTestApi', () => {
  it('refuses a healthy foreign API when the owned child never completes startup', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(0);
    databaseAnswers('t');
    vi.mocked(readFileSync).mockReturnValue('Port already in use');
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const pending = startTestApi();
    const failure = expect(pending).rejects.toThrow('The test API exited during startup');
    await vi.advanceTimersByTimeAsync(0);
    const role = process.env[testSchemaVariable];
    const directory = process.env[testStorageVariable];
    expect(fetch).not.toHaveBeenCalled();
    child.emit('exit', 1);
    await vi.advanceTimersByTimeAsync(500);
    await failure;
    expect(child.kill).not.toHaveBeenCalled();
    expect(sqlSent().filter((sql) => sql.includes('DROP OWNED'))).toEqual([
      `DROP OWNED BY ${role} CASCADE; REVOKE ALL ON DATABASE medi_wish_test FROM ${role}; DROP ROLE ${role};`,
    ]);
    expect(rmSync).toHaveBeenCalledExactlyOnceWith(directory, { recursive: true, force: true });
    expect(process.env[testSchemaVariable]).toBeUndefined();
    expect(process.env[testStorageVariable]).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses readiness success after the owned child has exited', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(0);
    databaseAnswers('t');
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    let answer: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }));
    const pending = startTestApi();
    const failure = expect(pending).rejects.toThrow('The test API exited during startup');
    await vi.advanceTimersByTimeAsync(0);
    child.emit('exit', 1);
    await vi.advanceTimersByTimeAsync(0);
    answer?.(new Response(null, { status: 200 }));
    await vi.advanceTimersByTimeAsync(500);
    await failure;
    expect(child.kill).not.toHaveBeenCalled();
    expect(sqlSent().some((sql) => sql.includes('databasechangelog'))).toBe(false);
    expect(sqlSent().filter((sql) => sql.includes('DROP OWNED'))).toHaveLength(1);
    expect(process.env[testSchemaVariable]).toBeUndefined();
    expect(process.env[testStorageVariable]).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('refuses to start while another process holds the API port, before touching the database', async () => {
    portProbe('connect');
    await expect(startTestApi()).rejects.toThrow(`${apiUrl} is already in use`);
    expect(connect).toHaveBeenCalledWith(Number(new URL(apiUrl).port), new URL(apiUrl).hostname);
    expect(psql).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('starts the API with the run-owned role and returns a teardown that drops it', async () => {
    databaseAnswers('t');
    fakeApiProcess(false);

    const stop = await startTestApi();
    const env = vi.mocked(spawn).mock.calls[0]?.[2]?.env;
    const role = env?.DB_USERNAME;
    expect(role).toMatch(/^mw_browser_[0-9a-f]{12}$/);
    expect(env).toMatchObject({ DB_NAME: 'medi_wish_test', SPRING_PROFILES_ACTIVE: 'test' });
    expect(Buffer.from(String(env?.APP_AUTH_MFA_SECRET_KEY), 'base64')).toHaveLength(32);
    expect(env?.APP_AUTH_MFA_SECRET_KEY).not.toBe(env?.APP_AUTH_JWT_SECRET);
    expect(env?.[testSchemaVariable]).toBeUndefined();
    expect(process.env[testSchemaVariable]).toBe(role);
    expect(sqlSent().at(-1)).toBe(`SELECT to_regclass('${role}.databasechangelog') IS NOT NULL`);
    const directory = process.env[testStorageVariable];
    expect(env?.APP_STORAGE_PROVIDER).toBe('local');
    expect(path.isAbsolute(String(env?.APP_STORAGE_LOCAL_ROOT))).toBe(true);
    expect(env?.APP_STORAGE_NAMESPACE).toBe(`test-browser-${String(role).slice('mw_browser_'.length)}`);
    expect(directory).toBe(path.join(String(env?.APP_STORAGE_LOCAL_ROOT), String(env?.APP_STORAGE_NAMESPACE)));
    expect(env?.[testStorageVariable]).toBeUndefined();
    expect(env?.APP_NOTIFICATION_SECURITY_ADAPTER).toBe('capture');
    expect(mkdirSync).toHaveBeenCalledWith(directory, { recursive: true });

    await stop();
    expect(sqlSent().at(-1)).toContain(`DROP ROLE ${role};`);
    expect(process.env[testSchemaVariable]).toBeUndefined();
    expect(process.env[testStorageVariable]).toBeUndefined();
    expect(rmSync).toHaveBeenCalledWith(directory, { recursive: true, force: true });
  });

  it('aborts stalled readiness at the total deadline and cleans owned resources only after the child exits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(0);
    databaseAnswers('t');
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const signals = stalledReadiness();
    const pending = startTestApi();
    const failure = expect(pending).rejects.toThrow('The test API was not ready within 120 seconds');
    await vi.advanceTimersByTimeAsync(0);
    const role = process.env[testSchemaVariable];
    const directory = process.env[testStorageVariable];
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(signals[0]?.aborted).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(115_000);
    expect(Date.now()).toBe(120_000);
    expect(signals.length).toBeGreaterThan(1);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith();
    // Teardown must await the child exit before dropping its database or storage resources.
    expect(sqlSent().some((sql) => sql.includes('DROP OWNED'))).toBe(false);
    expect(closeSync).not.toHaveBeenCalled();
    expect(rmSync).not.toHaveBeenCalled();
    child.emit('exit', 143);
    await failure;
    expect(sqlSent().filter((sql) => sql.includes('DROP OWNED'))).toEqual([
      `DROP OWNED BY ${role} CASCADE; REVOKE ALL ON DATABASE medi_wish_test FROM ${role}; DROP ROLE ${role};`,
    ]);
    expect(closeSync).toHaveBeenCalledExactlyOnceWith(99);
    expect(mkdirSync).toHaveBeenCalledExactlyOnceWith(directory, { recursive: true });
    expect(rmSync).toHaveBeenCalledExactlyOnceWith(directory, { recursive: true, force: true });
    expect(process.env[testSchemaVariable]).toBeUndefined();
    expect(process.env[testStorageVariable]).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('notices a child exit during a stalled request after aborting that request and cleans its resources', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(0);
    databaseAnswers('t');
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const signals = stalledReadiness();
    const pending = startTestApi();
    const failure = expect(pending).rejects.toThrow('The test API exited during startup');
    await vi.advanceTimersByTimeAsync(0);
    const role = process.env[testSchemaVariable];
    const directory = process.env[testStorageVariable];
    child.emit('exit', 1);
    await vi.advanceTimersByTimeAsync(5_500);
    await failure;
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
    expect(sqlSent().filter((sql) => sql.includes('DROP OWNED'))).toEqual([
      `DROP OWNED BY ${role} CASCADE; REVOKE ALL ON DATABASE medi_wish_test FROM ${role}; DROP ROLE ${role};`,
    ]);
    expect(closeSync).toHaveBeenCalledExactlyOnceWith(99);
    expect(rmSync).toHaveBeenCalledExactlyOnceWith(directory, { recursive: true, force: true });
    expect(process.env[testSchemaVariable]).toBeUndefined();
    expect(process.env[testStorageVariable]).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries after one stalled request and clears the abort timer when readiness succeeds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(0);
    databaseAnswers('t');
    fakeApiProcess(false);
    const signals = stalledReadiness();
    const pending = startTestApi();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(sqlSent().some((sql) => sql.includes('DROP OWNED'))).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    await vi.advanceTimersByTimeAsync(500);
    const stop = await pending;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await stop();
  });

  it('keeps role, grant and schema allocation in one transaction when SQL allocation fails', async () => {
    const failure = new Error('controlled SQL allocation failure');
    psql.mockImplementation((_file, _args, options) => {
      const sql = String((options as { input: string }).input);
      if (sql.includes('server_version_num')) return '18';
      throw failure;
    });

    await expect(startTestApi()).rejects.toThrow(failure);
    const allocation = sqlSent()[1];
    // Real PostgreSQL rollback is checked separately; these units enforce the fixture boundary and fail-fast path.
    expect(allocation).toMatch(/^BEGIN; CREATE ROLE mw_browser_[0-9a-f]{12} LOGIN /);
    expect(allocation).toMatch(/; GRANT CONNECT ON DATABASE medi_wish_test TO mw_browser_[0-9a-f]{12}; /);
    expect(allocation).toMatch(/CREATE SCHEMA (mw_browser_[0-9a-f]{12}) AUTHORIZATION \1; COMMIT;$/);
    expect(psql).toHaveBeenCalledTimes(2);
    expect(mkdirSync).not.toHaveBeenCalled();
    expect(openSync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(process.env[testSchemaVariable]).toBeUndefined();
    expect(process.env[testStorageVariable]).toBeUndefined();
  });

  it('replaces an inherited MFA key with its own', async () => {
    databaseAnswers('t');
    fakeApiProcess(false);
    vi.stubEnv('APP_AUTH_MFA_SECRET_KEY', 'inherited');

    const stop = await startTestApi();
    const key = vi.mocked(spawn).mock.calls[0]?.[2]?.env?.APP_AUTH_MFA_SECRET_KEY;
    await stop();
    vi.unstubAllEnvs();

    expect(key).not.toBe('inherited');
    expect(Buffer.from(String(key), 'base64')).toHaveLength(32);
  });

  it.each([
    ['the API exits during startup', true, 't', 'exited during startup'],
    ["the ready API has not migrated this run's schema", false, 'f', "did not migrate this run's schema"],
  ] as const)('drops the run-owned role when %s', async (_, exitsAtStartup, migrated, message) => {
    databaseAnswers(migrated);
    fakeApiProcess(exitsAtStartup);
    if (exitsAtStartup) vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')));

    await expect(startTestApi()).rejects.toThrow(message);
    expect(sqlSent().at(-1)).toMatch(/DROP OWNED BY mw_browser_[0-9a-f]{12} CASCADE; .* DROP ROLE mw_browser_[0-9a-f]{12};/);
    expect(rmSync).toHaveBeenCalledWith(expect.stringMatching(/test-browser-[0-9a-f]{12}$/),
      { recursive: true, force: true });
    expect(process.env[testStorageVariable]).toBeUndefined();
  });

  it.each(['directory', 'log', 'spawn'] as const)('cleans the owned resources when %s creation throws', async (stage) => {
    databaseAnswers('t');
    const failure = new Error('controlled allocation failure');
    if (stage === 'directory') vi.mocked(mkdirSync).mockImplementationOnce(() => { throw failure; });
    if (stage === 'log') vi.mocked(openSync).mockImplementationOnce(() => { throw failure; });
    if (stage === 'spawn') vi.mocked(spawn).mockImplementationOnce(() => { throw failure; });
    await expect(startTestApi()).rejects.toThrow(failure);
    expect(sqlSent().at(-1)).toMatch(/DROP ROLE mw_browser_[0-9a-f]{12};/);
    expect(rmSync).toHaveBeenCalledWith(expect.stringMatching(/test-browser-[0-9a-f]{12}$/),
      { recursive: true, force: true });
    expect(process.env[testStorageVariable]).toBeUndefined();
  });

  it('removes only the owned namespace even when database teardown fails', async () => {
    databaseAnswers('t');
    fakeApiProcess(false);
    const stop = await startTestApi();
    const directory = process.env[testStorageVariable];
    psql.mockImplementationOnce(() => { throw new Error('controlled teardown failure'); });
    await expect(stop()).rejects.toThrow('controlled teardown failure');
    expect(rmSync).toHaveBeenCalledWith(directory, { recursive: true, force: true });
    expect(process.env[testStorageVariable]).toBeUndefined();
  });

});

describe('grantRole', () => {
  const schema = 'mw_browser_0123456789ab';

  afterEach(() => { vi.unstubAllEnvs(); });

  it("replaces the named User's role in the run's schema", () => {
    vi.stubEnv(testSchemaVariable, schema);
    psql.mockReturnValue('ADMIN');

    grantRole('journey.cafe01', 'ADMIN');

    expect(sqlSent()).toEqual([`BEGIN; DELETE FROM ${schema}.user_roles WHERE user_id = (SELECT id FROM ${schema}.users`
      + ` WHERE username = 'journey.cafe01'); INSERT INTO ${schema}.user_roles (user_id, role)`
      + ` SELECT id, 'ADMIN' FROM ${schema}.users WHERE username = 'journey.cafe01' RETURNING role; COMMIT;`]);
  });

  it('fails when no User has that username', () => {
    vi.stubEnv(testSchemaVariable, schema);
    psql.mockReturnValue('');

    expect(() => grantRole('journey.cafe01', 'ADMIN')).toThrow('No User journey.cafe01');
  });

  it.each([
    ['without the run schema', undefined, 'journey.cafe01', 'needs the schema'],
    ['with a schema that is not a run schema', 'public', 'journey.cafe01', 'needs the schema'],
    ['with a username that could change the SQL', schema, "x'; DROP TABLE users; --", 'only synthetic usernames'],
  ])('refuses to run %s', (_, value, username, message) => {
    vi.stubEnv(testSchemaVariable, value);

    expect(() => grantRole(username, 'ADMIN')).toThrow(message);
    expect(psql).not.toHaveBeenCalled();
  });
});

describe('the other SQL helpers', () => {
  const schema = 'mw_browser_0123456789ab';
  const user = 'journey.cafe01';
  const userId = `(SELECT id FROM ${schema}.users WHERE username = '${user}')`;

  beforeEach(() => { vi.stubEnv(testSchemaVariable, schema); });
  afterEach(() => { vi.unstubAllEnvs(); });

  describe('checkedTarget', () => {
    it("returns the run's schema, with or without a username to check", () => {
      expect(checkedTarget('helper')).toBe(schema);
      expect(checkedTarget('helper', user)).toBe(schema);
    });

    it.each([
      ['no run schema', undefined, undefined, 'helper needs the schema'],
      ['a schema that is not a run schema', 'public', undefined, 'helper needs the schema'],
      ['a run schema with a wrong suffix', 'mw_browser_0123456789AB', undefined, 'helper needs the schema'],
      ['a username with a quote', schema, "x' OR '1'='1", 'helper accepts only synthetic usernames'],
      ['an upper-case username', schema, 'Journey.Cafe01', 'helper accepts only synthetic usernames'],
      ['a too-short username', schema, 'ab', 'helper accepts only synthetic usernames'],
    ])('refuses %s, naming the helper', (_, value, username, message) => {
      vi.stubEnv(testSchemaVariable, value);

      expect(() => checkedTarget('helper', username)).toThrow(message);
    });
  });

  describe('removeRole', () => {
    it("sets the named User's staff role back to CUSTOMER", () => {
      psql.mockReturnValue('CUSTOMER');

      removeRole(user, 'MODERATOR');

      expect(sqlSent()).toEqual([`UPDATE ${schema}.user_roles SET role = 'CUSTOMER' WHERE role = 'MODERATOR'`
        + ` AND user_id = ${userId} RETURNING role;`]);
    });

    it('fails when the User does not hold that role', () => {
      psql.mockReturnValue('');

      expect(() => removeRole(user, 'ADMIN')).toThrow(`User ${user} does not hold ADMIN`);
    });
  });

  describe('makeSuperAdmin', () => {
    it("makes ADMIN the User's only role and points the staff_bootstrap row at them, in one transaction", () => {
      psql.mockReturnValue('t');

      makeSuperAdmin(user);

      expect(sqlSent()).toEqual([`BEGIN; DELETE FROM ${schema}.user_roles WHERE user_id = ${userId};`
        + ` INSERT INTO ${schema}.user_roles (user_id, role) SELECT id, 'ADMIN' FROM ${schema}.users`
        + ` WHERE username = '${user}'; INSERT INTO ${schema}.staff_bootstrap (id, super_admin_user_id, provisioned_at)`
        + ` SELECT 1, id, now() FROM ${schema}.users WHERE username = '${user}' ON CONFLICT (id) DO UPDATE`
        + ' SET super_admin_user_id = EXCLUDED.super_admin_user_id RETURNING super_admin_user_id IS NOT NULL; COMMIT;']);
    });

    it('fails when no User has that username', () => {
      psql.mockReturnValue('');

      expect(() => makeSuperAdmin(user)).toThrow(`No User ${user} to make Super Admin`);
    });
  });

  describe('sessionStates', () => {
    it("lists each session's revoked reason, oldest first, with active for a live one", () => {
      psql.mockReturnValue('SIGNED_OUT\r\nactive\n');

      expect(sessionStates(user)).toEqual(['SIGNED_OUT', 'active']);
      expect(sqlSent()).toEqual([`SELECT coalesce(s.revoked_reason, 'active') FROM ${schema}.user_sessions s`
        + ` JOIN ${schema}.users u ON u.id = s.user_id WHERE u.username = '${user}' ORDER BY s.created_at;`]);
    });

    it('returns no states for a User without sessions', () => {
      psql.mockReturnValue('');

      expect(sessionStates(user)).toEqual([]);
    });
  });

  describe('markMobileVerified', () => {
    it("marks the named User's mobile verified", () => {
      psql.mockReturnValue('t');

      markMobileVerified(user);

      expect(sqlSent()).toEqual([`UPDATE ${schema}.users SET mobile_verified = true WHERE username = '${user}'`
        + ' RETURNING mobile_verified;']);
    });

    it('fails when no User has that username', () => {
      psql.mockReturnValue('');

      expect(() => markMobileVerified(user)).toThrow(`No User ${user} to verify`);
    });
  });

  describe('tableFingerprints', () => {
    it("fingerprints every table of the run's schema except the excluded ones", () => {
      psql.mockReturnValueOnce('users\nuser_sessions\nflyway_history\n')
        .mockReturnValueOnce('{"users":"2:abc","user_sessions":"0:"}');

      expect(tableFingerprints(['flyway_history'])).toEqual({ users: '2:abc', user_sessions: '0:' });

      const [tables, fingerprints] = sqlSent();
      expect(tables).toBe(`SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}'`
        + " AND table_type = 'BASE TABLE' ORDER BY table_name;");
      const each = (table: string) => `SELECT '${table}' AS t, (SELECT count(*) || ':'`
        + ` || coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') FROM ${schema}.${table} x) AS v`;
      expect(fingerprints).toBe(`SELECT json_object_agg(t, v) FROM (${each('users')} UNION ALL`
        + ` ${each('user_sessions')}) fingerprints;`);
    });

    it('fails when every table is excluded', () => {
      psql.mockReturnValue('users\n');

      expect(() => tableFingerprints(['users'])).toThrow('No tables to fingerprint');
      expect(psql).toHaveBeenCalledTimes(1);
    });

    it('refuses a table name that could change the SQL, before fingerprinting', () => {
      psql.mockReturnValue('users\nbad; DROP TABLE users\n');

      expect(() => tableFingerprints([])).toThrow('Unexpected table name');
      expect(psql).toHaveBeenCalledTimes(1);
    });
  });

  describe('rolledBackSql', () => {
    it("wraps the SQL in a transaction on the run's schema that is always rolled back", () => {
      psql.mockReturnValue('  1\n');

      expect(rolledBackSql('SELECT 1;')).toEqual({ output: '1', error: '' });
      expect(sqlSent()).toEqual([`BEGIN;\nSET LOCAL search_path TO ${schema};\nSELECT 1;\nROLLBACK;\n`]);
    });

    it("returns PostgreSQL's refusal and the output printed before it instead of throwing", () => {
      psql.mockImplementation(() => {
        throw Object.assign(new Error('psql exited with 3'), {
          stdout: 'before\n', stderr: 'ERROR:  new row violates check constraint "ck_products_active_priced"\n',
        });
      });

      expect(rolledBackSql('UPDATE products SET active = true;')).toEqual({
        output: 'before', error: 'ERROR:  new row violates check constraint "ck_products_active_priced"',
      });
    });

    it('rethrows a failure that has no PostgreSQL error text, such as a missing psql', () => {
      const missing = Object.assign(new Error('spawn psql ENOENT'), { stdout: '', stderr: '' });
      psql.mockImplementation(() => { throw missing; });

      expect(() => rolledBackSql('SELECT 1;')).toThrow(missing);
    });
  });

  it.each([
    ['removeRole', () => removeRole("x'", 'ADMIN')],
    ['makeSuperAdmin', () => makeSuperAdmin("x'")],
    ['sessionStates', () => sessionStates("x'")],
    ['markMobileVerified', () => markMobileVerified("x'")],
  ])('%s refuses an unsafe username without calling psql', (helper, call) => {
    expect(call).toThrow(`${helper} accepts only synthetic usernames`);
    expect(psql).not.toHaveBeenCalled();
  });

  it.each([
    ['removeRole', () => removeRole(user, 'ADMIN')],
    ['makeSuperAdmin', () => makeSuperAdmin(user)],
    ['sessionStates', () => sessionStates(user)],
    ['markMobileVerified', () => markMobileVerified(user)],
    ['tableFingerprints', () => tableFingerprints([])],
    ['rolledBackSql', () => rolledBackSql('SELECT 1;')],
  ])('%s refuses to run without the run schema', (helper, call) => {
    vi.stubEnv(testSchemaVariable, 'public');

    expect(call).toThrow(`${helper} needs the schema`);
    expect(psql).not.toHaveBeenCalled();
  });
});

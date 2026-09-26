import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import startTestApi, { apiEnvironment, apiUrl } from './browser/testApi';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs', () => ({ openSync: vi.fn(() => 99), closeSync: vi.fn() }));

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

/** Answers the version check with PostgreSQL 18, the migration check with `migrated`, and anything else with ''. */
function databaseAnswers(migrated: 't' | 'f') {
  psql.mockImplementation((_file, _args, options) => {
    const sql = String((options as { input: string }).input);
    if (sql.includes('server_version_num')) return '18';
    return sql.includes('databasechangelog') ? migrated : '';
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
});

afterEach(() => {
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

describe('startTestApi', () => {
  it('refuses to start while another process holds the API port, before touching the database', async () => {
    const occupant = createServer();
    await new Promise<void>((resolve) => occupant.listen(Number(new URL(apiUrl).port), '127.0.0.1', resolve));
    try {
      await expect(startTestApi()).rejects.toThrow(`${apiUrl} is already in use`);
    } finally {
      await new Promise((resolve) => occupant.close(resolve));
    }
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
    expect(sqlSent().at(-1)).toBe(`SELECT to_regclass('${role}.databasechangelog') IS NOT NULL`);

    await stop();
    expect(sqlSent().at(-1)).toContain(`DROP ROLE ${role};`);
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
  });
});

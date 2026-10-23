import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ageLimits, capturedMail, codeFrom, codeInLog, expectNoMailFor, expireCode, hasCode, mailDirectory,
  markEmailVerified, readCapturedMail, storedCodes, storedEmailState, type MailKind,
} from './browser/recoverySupport';
import { testMailVariable, testSchemaVariable } from './browser/testApi';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(), spawn: vi.fn() }));

const schema = 'mw_browser_0123456789ab';
const username = 'synthetic.user';
const recipient = 'recipient@example.test';
const sql = vi.mocked(execFileSync);
let directory: string;

function mailFile(index: number, options: Record<string, unknown> = {}): string {
  const file = `${String(1_000 + index)}-00000000-0000-4000-8000-${String(index).padStart(12, '0')}.json`;
  writeFileSync(path.join(directory, file), JSON.stringify({
    to: recipient, subject: 'Synthetic notice', body: 'Code: 123456', kind: 'PASSWORD_RESET_CODE', ...options,
  }));
  return file;
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'recovery-support-'));
  vi.stubEnv(testMailVariable, directory);
  vi.stubEnv(testSchemaVariable, schema);
  vi.stubEnv('TEST_DB_HOST', '127.0.0.1');
  vi.stubEnv('TEST_DB_PORT', '55433');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe('codeInLog', () => {
  const code = '123456';

  it.each(['code:123456', 'code-123456', 'code.123456'])('detects a code beside punctuation: %s', (log) => {
    expect(codeInLog(log, code)).toBe(true);
  });

  it('ignores matching digits inside ISO timestamp and UUID framing', () => {
    const timestamp = '2026-10-17T12:34:56.123456Z';
    const uuid = '123456ab-1234-4abc-8def-123456abcdef';
    expect(codeInLog(`time=${timestamp} requestId=${uuid}`, code)).toBe(false);
    expect(codeInLog(`time=${timestamp} requestId=${uuid} code:${code}`, code)).toBe(true);
  });

  it('does not match a six-digit substring of a longer number and rejects an invalid probe', () => {
    expect(codeInLog('code:91234567', code)).toBe(false);
    expect(() => codeInLog('anything', '12345')).toThrow('six-digit code');
  });
});

describe('captured recovery mail', () => {
  it('requires a real absolute capture directory', () => {
    for (const value of ['', 'relative-mail', path.join(directory, 'missing')]) {
      vi.stubEnv(testMailVariable, value);
      expect(() => mailDirectory()).toThrow(/directory/);
    }
    vi.stubEnv(testMailVariable, directory);
    expect(mailDirectory()).toBe(directory);
  });

  it('ignores unfinished and unrelated files, orders sends and filters case-insensitively', () => {
    mailFile(2, { kind: 'EMAIL_CHANGED' });
    mailFile(1);
    writeFileSync(path.join(directory, 'unfinished.tmp'), '{');
    writeFileSync(path.join(directory, 'foreign.json'), '{');
    expect(capturedMail().map(({ file }) => file)).toEqual([1, 2].map((index) =>
      `${String(1_000 + index)}-00000000-0000-4000-8000-${String(index).padStart(12, '0')}.json`));
    expect(capturedMail({ to: recipient.toUpperCase(), kind: 'PASSWORD_RESET_CODE' })).toHaveLength(1);
    expect(capturedMail({ to: 'other@example.test' })).toHaveLength(0);
  });

  it('reads recovery codes beside replacement notices and filters either kind without exposing content', async () => {
    const replacementFile = mailFile(1, {
      kind: 'STAFF_AUTHENTICATOR_REPLACED',
      body: 'Your staff authenticator was replaced on 23 Oct 2026, 2:00 PM.',
    });
    const resetFile = mailFile(2);
    expect(capturedMail().map(({ kind }) => kind)).toEqual(['STAFF_AUTHENTICATOR_REPLACED', 'PASSWORD_RESET_CODE']);
    expect(capturedMail({ to: recipient.toUpperCase(), kind: 'STAFF_AUTHENTICATOR_REPLACED' })
      .map(({ file }) => file)).toEqual([replacementFile]);
    expect((await readCapturedMail(recipient, 'PASSWORD_RESET_CODE')).file).toBe(resetFile);
    expect((await readCapturedMail(recipient, 'STAFF_AUTHENTICATOR_REPLACED')).file).toBe(replacementFile);
    expect(capturedMail({ kind: 'EMAIL_VERIFICATION_CODE' })).toHaveLength(0);
  });

  it.each([
    ['extra key', { extra: 'private-marker' }],
    ['missing key', { subject: undefined }],
    ['non-string value', { body: 123456 }],
    ['unknown kind', { kind: 'UNKNOWN' }],
    ['extra replacement-notice key', { kind: 'STAFF_AUTHENTICATOR_REPLACED', extra: 'private-marker' }],
  ])('rejects %s without echoing captured content', (_name, values) => {
    const file = mailFile(1, values);
    let error: unknown;
    try { capturedMail(); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message === `Malformed captured mail ${file}`).toBe(true);
  });

  it('rejects invalid JSON without echoing its secret-bearing content', () => {
    const file = mailFile(1);
    writeFileSync(path.join(directory, file), '{private-marker');
    let error: unknown;
    try { capturedMail(); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message === `Malformed captured mail ${file}`).toBe(true);
  });

  it('waits for a later send and returns the requested occurrence', async () => {
    vi.useFakeTimers();
    mailFile(1);
    const pending = readCapturedMail(recipient, 'PASSWORD_RESET_CODE', { nth: 2, timeoutMs: 400 });
    await vi.advanceTimersByTimeAsync(200);
    mailFile(2, { body: 'Code: 654321' });
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).body).toBe('Code: 654321');
  });

  it('ends at the deadline and omits the recipient from its error', async () => {
    vi.useFakeTimers();
    const pending = readCapturedMail(recipient, 'EMAIL_VERIFICATION_CODE', { timeoutMs: 250 });
    const outcome = pending.then(() => '', (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(300);
    const message = await outcome;
    expect(message).toContain('EMAIL_VERIFICATION_CODE');
    expect(message.includes(recipient)).toBe(false);
  });

  it('waits for a later sentinel before deciding that earlier requests sent no mail', async () => {
    vi.useFakeTimers();
    const sentinel = vi.fn(async () => ({ to: recipient, kind: 'PASSWORD_RESET_CODE' as MailKind }));
    const pending = expectNoMailFor(['absent@example.test'], sentinel);
    await vi.advanceTimersByTimeAsync(200);
    mailFile(1);
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(sentinel).toHaveBeenCalledOnce();
    mailFile(2, { to: 'absent@example.test' });
    await expect(expectNoMailFor(['absent@example.test'], sentinel)).rejects.toThrow();
  });
});

describe('mail code parsing', () => {
  it('accepts one six-digit run but ignores a seven-digit run', () => {
    expect(codeFrom('reference 1234567; code 654321')).toBe('654321');
    expect(hasCode('reference 1234567')).toBe(false);
    expect(hasCode('code 654321')).toBe(true);
  });

  it('rejects no code or multiple codes without echoing the body', () => {
    for (const body of ['reference 1234567', 'code 123456 then 654321']) {
      expect(() => codeFrom(body)).toThrow('Expected exactly one 6-digit code in the mail');
    }
  });
});

describe('guarded recovery SQL', () => {
  const operations = [
    () => markEmailVerified(username), () => storedEmailState(username), () => storedCodes(username),
    () => expireCode(username, 'PASSWORD_RESET'), () => ageLimits(username),
  ];

  it('refuses a missing or unsafe schema before invoking psql', () => {
    for (const value of ['', 'public', 'mw_browser_0123456789ab;DROP']) {
      vi.stubEnv(testSchemaVariable, value);
      for (const operation of operations) expect(operation).toThrow(/schema/);
    }
    expect(sql).not.toHaveBeenCalled();
  });

  it('refuses unsafe usernames before invoking psql', () => {
    for (const bad of ["x' OR true--", 'ab', 'user@example.test']) {
      for (const operation of [markEmailVerified, storedEmailState, storedCodes,
        (value: string) => expireCode(value, 'PASSWORD_RESET'), ageLimits]) {
        expect(() => operation(bad)).toThrow(/synthetic usernames/);
      }
    }
    expect(sql).not.toHaveBeenCalled();
  });

  it('refuses unknown purposes and out-of-range aging before invoking psql', () => {
    expect(() => expireCode(username, 'WRONG' as 'PASSWORD_RESET')).toThrow(/purpose/);
    for (const seconds of [0, 1.5, 86_401]) expect(() => ageLimits(username, seconds)).toThrow(/seconds/);
    expect(sql).not.toHaveBeenCalled();
  });

  it('uses only schema-qualified own-user tables and excludes code hashes', () => {
    sql.mockReturnValueOnce('t').mockReturnValueOnce('{"email":null,"emailVerified":false}')
      .mockReturnValueOnce('[]').mockReturnValueOnce('1').mockReturnValueOnce('1');
    markEmailVerified(username);
    expect(storedEmailState(username)).toEqual({ email: null, emailVerified: false });
    expect(storedCodes(username)).toEqual([]);
    expireCode(username, 'PASSWORD_RESET');
    expect(ageLimits(username, 61)).toBe(1);
    const statements = sql.mock.calls.map((call) => (call[2] as { input: string }).input);
    expect(statements).toHaveLength(5);
    for (const statement of statements) {
      expect(statement).toContain(`${schema}.`);
      expect(statement).toContain(`username = '${username}'`);
      expect(statement).not.toMatch(/\b(?:public|code_hash)\b/);
    }
    expect(statements[2]).toContain(`${schema}.account_codes`);
    expect(statements[3]).toContain("purpose = 'PASSWORD_RESET'");
    expect(statements[4]).toContain('make_interval(secs => 61)');
  });

  it('reports missing fixture rows while an absent limit row stays a valid zero count', () => {
    sql.mockReturnValue('');
    expect(() => markEmailVerified(username)).toThrow(/No User/);
    expect(() => storedEmailState(username)).toThrow(/No User/);
    expect(() => expireCode(username, 'PASSWORD_RESET')).toThrow(/no PASSWORD_RESET code/);
    expect(ageLimits(username)).toBe(0);
  });
});

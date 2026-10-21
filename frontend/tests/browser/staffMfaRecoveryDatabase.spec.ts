import { expect, test } from '@playwright/test';
import { activeSessions, apiRecoveryStaff, factorRows, passwordSession, sessionRows } from './staffMfaRecoverySupport';
import { rolledBackSql } from './testApi';

/**
 * Ticket 09 at the database: changeset `018-staff-mfa-recovery` (plan §4.4, frozen database contract) as the test API
 * migrated it on PostgreSQL 18. Every write here runs in a rolled-back transaction. Tag `@t09-T2`: these pass once T2's
 * changeset is in the built jar.
 */

const t2 = { tag: ['@t09', '@t09-T2', '@t09-migration'] };

test('E2E-09-50 changeset 018 runs right after 017 and adds two nullable UUID columns with their constraints', t2, () => {
  const ids = rolledBackSql('SELECT id FROM databasechangelog ORDER BY orderexecuted;').output.split(/\r?\n/);
  const index = ids.indexOf('018-staff-mfa-recovery');
  expect(index, '018 ran').toBeGreaterThan(-1);
  expect(ids[index - 1], '018 directly follows 017').toBe('017-saved-addresses');
  const later = ids.slice(index + 1);
  expect(later.every((id) => !/^0(0\d|1[0-7])-/.test(id)), 'no earlier changeset runs after 018').toBe(true);

  const columns = rolledBackSql("SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable"
    + ' FROM information_schema.columns WHERE table_schema = current_schema() AND (table_name, column_name) IN'
    + " (('user_sessions', 'mfa_replacing_factor_id'), ('staff_mfa_backup_codes', 'consumed_session_id')) ORDER BY 1;")
    .output.split(/\r?\n/);
  expect(columns).toEqual([
    'staff_mfa_backup_codes.consumed_session_id uuid YES',
    'user_sessions.mfa_replacing_factor_id uuid YES',
  ]);

  const constraints = Object.fromEntries(rolledBackSql("SELECT conname || '|' || pg_get_constraintdef(oid) FROM pg_constraint"
    + " WHERE connamespace = current_schema()::regnamespace AND conname IN ('fk_user_sessions_mfa_replacing_factor',"
    + " 'ck_user_sessions_replacing_unverified', 'ck_staff_mfa_backup_codes_consumed') ORDER BY 1;")
    .output.split(/\r?\n/).map((line) => line.split('|')));
  expect(Object.keys(constraints)).toEqual([
    'ck_staff_mfa_backup_codes_consumed', 'ck_user_sessions_replacing_unverified', 'fk_user_sessions_mfa_replacing_factor',
  ]);
  expect(constraints.fk_user_sessions_mfa_replacing_factor)
    .toMatch(/^FOREIGN KEY \(mfa_replacing_factor_id\) REFERENCES (\w+\.)?staff_mfa_factors\(id\) ON DELETE SET NULL$/);
  expect(constraints.ck_user_sessions_replacing_unverified).toMatch(/mfa_replacing_factor_id IS NULL/);
  expect(constraints.ck_user_sessions_replacing_unverified).toMatch(/mfa_verified_at IS NULL/);
  expect(constraints.ck_staff_mfa_backup_codes_consumed).toMatch(/consumed_at IS NULL/);
  expect(constraints.ck_staff_mfa_backup_codes_consumed).toMatch(/consumed_session_id IS NULL/);

  // No foreign key on consumed_session_id, so the row outlives the session (like security_audit_events.session_id).
  expect(rolledBackSql("SELECT count(*) FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid"
    + " AND a.attnum = ANY (c.conkey) WHERE c.conrelid = 'staff_mfa_backup_codes'::regclass AND c.contype = 'f'"
    + " AND a.attname = 'consumed_session_id';").output).toBe('0');
  // The existing lookup index still serves the per-factor reads; 018 changes no index.
  expect(rolledBackSql("SELECT count(*) FROM pg_indexes WHERE schemaname = current_schema()"
    + " AND indexname IN ('idx_staff_mfa_backup_codes_factor', 'uq_staff_mfa_active', 'uq_staff_mfa_pending');").output)
    .toBe('3');
});

test('E2E-09-51 the database refuses a verified replacement session and a half-consumed backup code', t2,
  async ({ request }) => {
    const actor = await apiRecoveryStaff(request);
    const restricted = await passwordSession(actor);
    const [factor] = factorRows(actor.user.username);
    const sessions = activeSessions(actor.user.username);
    expect(sessions).toHaveLength(2);
    const verified = sessions.find((row) => row.verified)!;
    const passwordOnly = sessions.find((row) => !row.verified)!;
    expect(verified?.verified).toBe(true);
    expect(passwordOnly?.verified).toBe(false);
    const someCode = `(SELECT c.id FROM staff_mfa_backup_codes c WHERE c.factor_id = '${factor.id}' LIMIT 1)`;

    await test.step('a session cannot be both replacing a factor and MFA-verified', () => {
      expect(rolledBackSql(`UPDATE user_sessions SET mfa_replacing_factor_id = '${factor.id}'`
        + ` WHERE id = '${verified.id}';`).error).toContain('ck_user_sessions_replacing_unverified');
      expect(rolledBackSql(`UPDATE user_sessions SET mfa_replacing_factor_id = '${factor.id}'`
        + ` WHERE id = '${passwordOnly.id}';`).error, 'an unverified session may replace').toBe('');
      expect(rolledBackSql(`UPDATE user_sessions SET mfa_replacing_factor_id = '${factor.id}', mfa_verified_at = NULL,`
        + ` mfa_factor_id = NULL WHERE id = '${verified.id}';`).error, 'once unverified it may replace').toBe('');
    });

    await test.step('the replacing factor must exist, and deleting it clears the binding', () => {
      expect(rolledBackSql('UPDATE user_sessions SET mfa_replacing_factor_id = gen_random_uuid()'
        + ` WHERE id = '${passwordOnly.id}';`).error).toContain('fk_user_sessions_mfa_replacing_factor');
      expect(rolledBackSql(`UPDATE user_sessions SET mfa_replacing_factor_id = '${factor.id}' WHERE id = '${passwordOnly.id}';`
        + ` DELETE FROM staff_mfa_factors WHERE id = '${factor.id}';`
        + ` SELECT mfa_replacing_factor_id IS NULL FROM user_sessions WHERE id = '${passwordOnly.id}';`).output).toBe('t');
    });

    await test.step('consumed_at and consumed_session_id are set together or not at all', () => {
      expect(rolledBackSql(`UPDATE staff_mfa_backup_codes SET consumed_at = now() WHERE id = ${someCode};`).error)
        .toContain('ck_staff_mfa_backup_codes_consumed');
      expect(rolledBackSql('UPDATE staff_mfa_backup_codes SET consumed_session_id = gen_random_uuid()'
        + ` WHERE id = ${someCode};`).error).toContain('ck_staff_mfa_backup_codes_consumed');
      expect(rolledBackSql(`UPDATE staff_mfa_backup_codes SET consumed_at = now(), consumed_session_id = '${passwordOnly.id}'`
        + ` WHERE id = ${someCode};`).error, 'both together are accepted').toBe('');
      // The session id is not a foreign key: a code consumed by a session that is later deleted keeps its row.
      expect(rolledBackSql('UPDATE staff_mfa_backup_codes SET consumed_at = now(), consumed_session_id = gen_random_uuid()'
        + ` WHERE id = ${someCode};`).error).toBe('');
    });
    await restricted.dispose();
    await actor.session.dispose();
  });

test('E2E-09-52 rows written by Ticket 06 sign-in and enrollment leave both new columns empty', t2, async ({ request }) => {
  const actor = await apiRecoveryStaff(request);
  const restricted = await passwordSession(actor);
  for (const row of sessionRows(actor.user.username)) expect(row.replacingFactorId, `session ${row.state}`).toBeNull();
  const [factor] = factorRows(actor.user.username);
  expect(factor).toMatchObject({ status: 'ACTIVE', unusedCodes: 10, usedCodes: 0 });
  expect(rolledBackSql('SELECT count(*) FROM staff_mfa_backup_codes'
    + ` WHERE factor_id = '${factor.id}' AND consumed_session_id IS NOT NULL;`).output).toBe('0');
  await restricted.dispose();
  await actor.session.dispose();
});

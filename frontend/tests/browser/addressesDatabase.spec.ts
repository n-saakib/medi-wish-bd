import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { registerByApi } from './profileSupport';
import { checkedTarget, rolledBackSql } from './testApi';

/** The real 017 migration's guarantees, in the browser harness's isolated, migrated PostgreSQL schema. */
test('E2E-12-80 saved-address columns, keys and indexes match the accepted persistence contract',
  { tag: ['@t12', '@t12-T2', '@t12-migration'] }, () => {
    const schema = checkedTarget('address schema contract');
    const columns = rolledBackSql(`SELECT json_agg(json_build_object('table', table_name, 'column', column_name,
      'type', data_type, 'length', character_maximum_length, 'nullable', is_nullable) ORDER BY table_name, ordinal_position)
      FROM information_schema.columns WHERE table_schema = '${schema}'
        AND table_name IN ('saved_addresses', 'saved_address_changes');`);
    expect(columns.error).toBe('');
    expect(columns.output, '017 must install both saved-address tables before their columns can be checked').not.toBe('');
    const rows = JSON.parse(columns.output) as {
      table: string; column: string; type: string; length: number | null; nullable: string;
    }[];
    expect(Array.isArray(rows), '017 must install both saved-address tables').toBe(true);
    expect(rows.filter((row) => row.table === 'saved_addresses').map((row) => row.column).sort()).toEqual([
      'address_line', 'city', 'created_at', 'id', 'is_default', 'label', 'mobile', 'recipient_name', 'updated_at',
      'user_id', 'version',
    ]);
    expect(rows.filter((row) => row.table === 'saved_address_changes').map((row) => row.column).sort())
      .toEqual(['changed_at', 'id', 'user_id']);
    for (const [column, length] of [['label', 40], ['recipient_name', 100], ['mobile', 11],
      ['address_line', 200], ['city', 60]] as const) {
      expect(rows.find((row) => row.table === 'saved_addresses' && row.column === column))
        .toMatchObject({ type: 'character varying', length, nullable: column === 'label' ? 'YES' : 'NO' });
    }
    for (const row of rows.filter((row) => row.column !== 'label')) expect(row.nullable).toBe('NO');
    for (const column of ['created_at', 'updated_at', 'changed_at']) {
      expect(rows.find((row) => row.column === column)?.type).toBe('timestamp with time zone');
    }
    expect(rows.find((row) => row.column === 'version')?.type).toBe('bigint');
    expect(rows.find((row) => row.column === 'is_default')?.type).toBe('boolean');
    for (const row of rows.filter((row) => ['id', 'user_id'].includes(row.column))) expect(row.type).toBe('uuid');

    const primaryKeys = rolledBackSql(`SELECT json_agg(json_build_object('name', c.conname, 'table', t.relname,
      'columns', (SELECT json_agg(a.attname ORDER BY key.position)
        FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, position)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum)) ORDER BY t.relname)
      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'p' AND n.nspname = '${schema}'
        AND t.relname IN ('saved_addresses', 'saved_address_changes');`);
    expect(primaryKeys.error).toBe('');
    expect(JSON.parse(primaryKeys.output)).toEqual([
      { name: 'pk_saved_address_changes', table: 'saved_address_changes', columns: ['id'] },
      { name: 'pk_saved_addresses', table: 'saved_addresses', columns: ['user_id', 'id'] },
    ]);

    const indexes = rolledBackSql(`SELECT json_object_agg(indexname, indexdef) FROM pg_indexes
      WHERE schemaname = '${schema}' AND tablename IN ('saved_addresses', 'saved_address_changes');`);
    expect(indexes.error).toBe('');
    const definitions = JSON.parse(indexes.output) as Record<string, string>;
    expect(definitions.pk_saved_addresses).toMatch(/UNIQUE INDEX.*\(user_id, id\)/);
    expect(definitions.pk_saved_address_changes).toMatch(/UNIQUE INDEX.*\(id\)/);
    expect(definitions.uq_saved_addresses_default).toMatch(/UNIQUE INDEX.*\(user_id\) WHERE is_default/);
    expect(definitions.ix_saved_addresses_user).toMatch(/\(user_id, created_at, id\)/);
    expect(definitions.ix_saved_address_changes_user).toMatch(/\(user_id, changed_at\)/);
  });

test('E2E-12-81 database constraints refuse invalid saved addresses and incomplete change records',
  { tag: ['@t12', '@t12-T2', '@t12-migration'] }, async ({ request }) => {
    const user = await registerByApi(request);
    checkedTarget('address constraint fixtures', user.username);
    const owner = `(SELECT id FROM users WHERE username = '${user.username}')`;
    const id = randomUUID();
    const seed = `INSERT INTO saved_addresses (user_id, id, label, recipient_name, mobile, address_line, city,
      is_default, version, created_at, updated_at) VALUES (${owner}, '${id}', NULL, 'Database Tester', '01711000000',
      'Synthetic Road', 'Dhaka', TRUE, 0, now(), now());`;
    expect(rolledBackSql(seed)).toEqual({ output: '', error: '' });
    // Exercise defaults through omitted columns, independent of PostgreSQL's expression formatting.
    expect(rolledBackSql(`INSERT INTO saved_addresses (user_id, id, recipient_name, mobile, address_line,
      city, created_at, updated_at) VALUES (${owner}, '${id}', 'Database Tester', '01711000000',
      'Synthetic Road', 'Dhaka', now(), now());
      SELECT is_default || ':' || version FROM saved_addresses WHERE user_id = ${owner};`))
      .toEqual({ output: 'false:0', error: '' });
    // The client supplies the address id; a database-generated fallback would hide a broken contract.
    expect(rolledBackSql(`INSERT INTO saved_addresses (user_id, recipient_name, mobile, address_line,
      city, created_at, updated_at) VALUES (${owner}, 'Database Tester', '01711000000',
      'Synthetic Road', 'Dhaka', now(), now());`).error).toMatch(/null value in column "id"/);

    const invalid: [string, string, RegExp][] = [
      ['blank recipient', "recipient_name = '   '", /ck_saved_addresses_recipient_name/],
      ['blank address line', "address_line = '   '", /ck_saved_addresses_address_line/],
      ['blank city', "city = '   '", /ck_saved_addresses_city/],
      ['short mobile', "mobile = '0171100000'", /ck_saved_addresses_mobile/],
      ['long mobile', "mobile = '017110000000'", /value too long for type character varying\(11\)/],
      ['non-ASCII mobile', "mobile = '০১৭১১০০০০০০'", /ck_saved_addresses_mobile/],
      ['negative version', 'version = -1', /ck_saved_addresses_version/],
      ['label too long', "label = repeat('x', 41)", /value too long for type character varying\(40\)/],
      ['recipient too long', "recipient_name = repeat('x', 101)", /value too long for type character varying\(100\)/],
      ['address too long', "address_line = repeat('x', 201)", /value too long for type character varying\(200\)/],
      ['city too long', "city = repeat('x', 61)", /value too long for type character varying\(60\)/],
    ];
    for (const [name, assignment, error] of invalid) {
      expect(rolledBackSql(`${seed} UPDATE saved_addresses SET ${assignment} WHERE user_id = ${owner};`).error, name)
        .toMatch(error);
    }
    for (const column of ['user_id', 'id', 'recipient_name', 'mobile', 'address_line', 'city', 'is_default', 'version',
      'created_at', 'updated_at']) {
      expect(rolledBackSql(`${seed} UPDATE saved_addresses SET ${column} = NULL WHERE user_id = ${owner};`).error)
        .toMatch(new RegExp(`null value in column "${column}"`));
    }
    // Positive control: all accepted maximum lengths, optional label and nonnegative BIGINT version.
    expect(rolledBackSql(`${seed} UPDATE saved_addresses SET label = repeat('x', 40),
      recipient_name = repeat('x', 100), address_line = repeat('x', 200), city = repeat('x', 60),
      version = 9223372036854775807 WHERE user_id = ${owner};`).error).toBe('');
    expect(rolledBackSql(`INSERT INTO saved_address_changes (id, user_id, changed_at)
      VALUES (gen_random_uuid(), ${owner}, now());`).error).toBe('');
    const changeId = randomUUID();
    expect(rolledBackSql(`INSERT INTO saved_address_changes (id, user_id, changed_at)
      VALUES ('${changeId}', ${owner}, now()), ('${changeId}', ${owner}, now());`).error)
      .toContain('pk_saved_address_changes');
    for (const [column, values] of [
      ['id', `NULL, ${owner}, now()`],
      ['user_id', 'gen_random_uuid(), NULL, now()'],
      ['changed_at', `gen_random_uuid(), ${owner}, NULL`],
    ]) {
      expect(rolledBackSql(`INSERT INTO saved_address_changes (id, user_id, changed_at) VALUES (${values});`).error)
        .toMatch(new RegExp(`null value in column "${column}"`));
    }
    for (const table of ['saved_addresses', 'saved_address_changes']) {
      const foreign = table === 'saved_addresses'
        ? `${seed} UPDATE saved_addresses SET user_id = '${randomUUID()}' WHERE user_id = ${owner};`
        : `INSERT INTO saved_address_changes (id, user_id, changed_at)
          VALUES (gen_random_uuid(), '${randomUUID()}', now());`;
      expect(rolledBackSql(foreign).error).toContain(table === 'saved_addresses'
        ? 'fk_saved_addresses_user' : 'fk_saved_address_changes_user');
    }
    expect(rolledBackSql(`SELECT count(*) FROM saved_addresses WHERE user_id = ${owner};`))
      .toEqual({ output: '0', error: '' });
    expect(rolledBackSql(`SELECT count(*) FROM saved_address_changes WHERE user_id = ${owner};`))
      .toEqual({ output: '0', error: '' });
  });

test('E2E-12-82 ids and defaults are scoped per User while capacity and change limits stay outside the schema',
  { tag: ['@t12', '@t12-T2', '@t12-migration'] }, async ({ request }) => {
    const first = await registerByApi(request);
    const second = await registerByApi(request);
    checkedTarget('scoped address keys', first.username);
    checkedTarget('scoped address keys', second.username);
    const id = randomUUID();
    const seed = `INSERT INTO saved_addresses (user_id, id, recipient_name, mobile, address_line, city,
      is_default, created_at, updated_at) SELECT id, '${id}', 'Database Tester', '01711000000',
      'Synthetic Road', 'Dhaka', TRUE, now(), now() FROM users
      WHERE username IN ('${first.username}', '${second.username}');`;
    expect(rolledBackSql(`${seed} SELECT count(*) FROM saved_addresses WHERE id = '${id}';`))
      .toEqual({ output: '2', error: '' });
    const owner = `(SELECT id FROM users WHERE username = '${first.username}')`;
    const duplicate = `INSERT INTO saved_addresses (user_id, id, recipient_name, mobile, address_line, city,
      is_default, created_at, updated_at) VALUES (${owner}, '${id}', 'Database Tester', '01711000000',
      'Synthetic Road', 'Dhaka', FALSE, now(), now());`;
    expect(rolledBackSql(seed + duplicate).error).toContain('pk_saved_addresses');
    // Both mixed-city and entirely non-Dhaka defaults must collide: a narrower city predicate is unsafe.
    for (const [firstCity, secondCity] of [['Dhaka', 'Dhaka'], ['Dhaka', 'Chattogram'], ['Sylhet', 'Chattogram']]) {
      expect(rolledBackSql(`${seed.replace("'Dhaka'", `'${firstCity}'`)}
        INSERT INTO saved_addresses (user_id, id, recipient_name, mobile, address_line,
        city, is_default, created_at, updated_at) VALUES (${owner}, gen_random_uuid(), 'Database Tester',
        '01711000000', 'Synthetic Road', '${secondCity}', TRUE, now(), now());`).error,
      `one default per User regardless of ${firstCity}/${secondCity}`).toContain('uq_saved_addresses_default');
    }
    // Label presence and previous edits must never remove a row from default uniqueness enforcement.
    // Cross null/non-null labels and initial/advanced versions to catch accidentally narrowed predicates.
    for (const [firstLabel, secondLabel, firstVersion, secondVersion] of [
      ["'Edited default'", "'Other default'", 3, 7],
      ['NULL', "'Other default'", 0, 7],
      ["'Edited default'", 'NULL', 3, 0],
    ] as const) {
      expect(rolledBackSql(`${seed}
        UPDATE saved_addresses SET label = ${firstLabel}, version = ${firstVersion} WHERE user_id = ${owner};
        INSERT INTO saved_addresses (user_id, id, label, recipient_name, mobile, address_line,
          city, is_default, version, created_at, updated_at) VALUES (${owner}, gen_random_uuid(), ${secondLabel},
          'Database Tester', '01711000000', 'Synthetic Road', 'Dhaka', TRUE, ${secondVersion}, now(), now());`).error,
      'one default per User regardless of labels or versions').toContain('uq_saved_addresses_default');
    }
    // ADR-0009: changing the cap must not require a migration. The service, not a row-count constraint, enforces it.
    expect(rolledBackSql(`${seed} INSERT INTO saved_addresses (user_id, id, recipient_name, mobile, address_line,
      city, is_default, created_at, updated_at) SELECT ${owner}, gen_random_uuid(), 'Database Tester',
      '01711000000', 'Synthetic Road', 'Dhaka', FALSE, now(), now() FROM generate_series(1, 3);
      SELECT count(*) FROM saved_addresses WHERE user_id = ${owner};`))
      .toEqual({ output: '4', error: '' });
    // The installed schema also permits history beyond both default change limits (5/week and 10/month).
    // These raw, rolled-back rows test schema configurability; API enforcement still owns the configured limits.
    expect(rolledBackSql(`INSERT INTO saved_address_changes (id, user_id, changed_at)
      SELECT gen_random_uuid(), ${owner}, now() FROM generate_series(1, 11);
      SELECT count(*) FROM saved_address_changes WHERE user_id = ${owner};`))
      .toEqual({ output: '11', error: '' });
    expect(rolledBackSql(`SELECT count(*) FROM saved_address_changes WHERE user_id = ${owner};`))
      .toEqual({ output: '0', error: '' });
  });

test('E2E-12-83 deleting a User cascades the book and change log, and no table references an address',
  { tag: ['@t12', '@t12-T2', '@t12-regression', '@t12-migration'] }, async ({ request }) => {
    const user = await registerByApi(request);
    const schema = checkedTarget('address cascade and snapshot boundary', user.username);
    const incoming = rolledBackSql(`SELECT count(*) FROM pg_constraint c
      JOIN pg_class target ON target.oid = c.confrelid JOIN pg_namespace n ON n.oid = target.relnamespace
      WHERE c.contype = 'f' AND n.nspname = '${schema}' AND target.relname = 'saved_addresses';`);
    expect(incoming).toEqual({ output: '0', error: '' });
    const cascade = rolledBackSql(`CREATE TEMP TABLE address_cascade_owner ON COMMIT DROP AS
      SELECT id FROM users WHERE username = '${user.username}';
      INSERT INTO saved_addresses (user_id, id, recipient_name, mobile, address_line, city, is_default,
        created_at, updated_at) SELECT id, gen_random_uuid(), 'Database Tester', '01711000000',
        'Synthetic Road', 'Dhaka', TRUE, now(), now() FROM address_cascade_owner;
      INSERT INTO saved_address_changes (id, user_id, changed_at)
        SELECT gen_random_uuid(), id, now() FROM address_cascade_owner;
      SELECT (SELECT count(*) FROM saved_addresses WHERE user_id IN (SELECT id FROM address_cascade_owner))
        || ':' || (SELECT count(*) FROM saved_address_changes WHERE user_id IN (SELECT id FROM address_cascade_owner));
      DELETE FROM users WHERE id IN (SELECT id FROM address_cascade_owner);
      SET CONSTRAINTS ALL IMMEDIATE;
      SELECT (SELECT count(*) FROM saved_addresses WHERE user_id IN (SELECT id FROM address_cascade_owner))
        || ':' || (SELECT count(*) FROM saved_address_changes WHERE user_id IN (SELECT id FROM address_cascade_owner));`);
    expect(cascade.error).toBe('');
    expect(cascade.output.split(/\r?\n/)).toEqual(['1:1', '0:0']);
    expect(rolledBackSql(`SELECT count(*) FROM users WHERE username = '${user.username}';`))
      .toEqual({ output: '1', error: '' });
  });

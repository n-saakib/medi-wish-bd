import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIResponse } from '@playwright/test';
import {
  addressEdit, assertAwayFromDhakaPeriodStart, expectAddressBook, storedAddressChanges, storedAddresses,
  storedAddressState, syntheticAddress, type AddressBook,
} from './browser/addressSupport';
import { testSchemaVariable } from './browser/testApi';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(), spawn: vi.fn() }));

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe('syntheticAddress', () => {
  it('produces unique canonical ids and valid synthetic text and mobiles within the contract', () => {
    const fixtures = Array.from({ length: 30 }, () => syntheticAddress());
    expect(new Set(fixtures.map(({ id }) => id)).size).toBe(fixtures.length);
    expect(new Set(fixtures.map(({ addressLine }) => addressLine)).size).toBe(fixtures.length);
    for (const fixture of fixtures) {
      expect(fixture.id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
      expect(fixture.mobile).toMatch(/^[0-9]{11}$/);
      expect(fixture.isDefault).toBe(false);
      for (const [value, limit] of [[fixture.label, 40], [fixture.recipientName, 100],
        [fixture.addressLine, 200], [fixture.city, 60]] as const) {
        expect(typeof value).toBe('string');
        expect(value!.length).toBeGreaterThan(0);
        expect(value!.length).toBeLessThanOrEqual(limit);
        expect(value).not.toMatch(/[\p{Cc}\p{Zl}\p{Zp}]/u);
      }
    }
  });

  it('retains deliberate overrides for negative fixtures and projects only editable fields', () => {
    const fixture = syntheticAddress({ label: null, mobile: 'invalid', city: 'সিলেট', isDefault: true });
    expect(fixture).toMatchObject({ label: null, mobile: 'invalid', city: 'সিলেট', isDefault: true });
    const saved = { ...fixture, version: 2 };
    const edit = addressEdit(saved, { city: 'Khulna', version: 1 });
    expect(Object.keys(edit).sort()).toEqual(['addressLine', 'city', 'isDefault', 'label', 'mobile', 'recipientName', 'version']);
    expect(edit).toMatchObject({ city: 'Khulna', version: 1, label: null });
    expect(saved.city).toBe('সিলেট');
    expect(saved.version).toBe(2);
  });
});

describe('expectAddressBook Java text semantics', () => {
  function responseWithText(value: unknown, field?: 'label' | 'recipientName' | 'addressLine' | 'city'): APIResponse {
    const book = { accountState: 'ACTIVE', limit: 3,
      changeAllowance: { perWeek: 5, perMonth: 10, remainingThisWeek: 4, remainingThisMonth: 9 },
      items: [{ ...syntheticAddress(),
        ...(field ? { [field]: value } : { label: value, recipientName: value, addressLine: value, city: value }),
        isDefault: true, version: 0 }] } as AddressBook;
    return { status: () => 200, headers: () => ({ 'cache-control': 'no-store', 'x-request-id': 'synthetic-request-id' }),
      json: async () => book } as unknown as APIResponse;
  }

  it.each(['\u00a0', '\ufeff', '\u00a0Text\u00a0', '\ufeffText\ufeff'])
    ('accepts safe required text preserved by Java String.trim(): %j', async (value) => {
      const book = await expectAddressBook(responseWithText(value));
      expect(book.items[0]).toMatchObject({ label: value, recipientName: value, addressLine: value, city: value });
    });

  it.each((['recipientName', 'addressLine', 'city'] as const).flatMap((field) =>
    ['', '   ', null, 1].map((value) => [field, value] as const)))
    ('rejects invalid %s with all other fields valid: %j', async (field, value) => {
      await expect(expectAddressBook(responseWithText(value, field))).rejects.toThrow();
    });

  it.each((['label', 'recipientName', 'addressLine', 'city'] as const).flatMap((field) =>
    [' Text', 'Text ', 'Two  Spaces', 'Forbidden\u0000Text', '\tText', 'Text\r',
      'Forbidden\u0085Text', 'Forbidden\u2028Text', 'Forbidden\u2029Text'].map((value) => [field, value] as const)))
    ('rejects unsafe or unnormalized response %s with all other fields valid: %j', async (field, value) => {
      await expect(expectAddressBook(responseWithText(value, field))).rejects.toThrow();
    });

  it.each(['', ' ', 1, false])('rejects non-null label values that cannot be stored: %j', async (value) => {
    await expect(expectAddressBook(responseWithText(value, 'label'))).rejects.toThrow();
  });

  it('accepts null optional labels and normalized single ASCII spaces', async () => {
    expect((await expectAddressBook(responseWithText(null, 'label'))).items[0].label).toBeNull();
    expect((await expectAddressBook(responseWithText('Two Spaces'))).items[0].label).toBe('Two Spaces');
  });
});

describe('assertAwayFromDhakaPeriodStart', () => {
  it.each([
    '2026-10-11T17:56:00Z', '2026-10-11T18:04:00Z',
    '2026-10-31T17:56:00Z', '2026-10-31T18:04:00Z',
    '2026-10-11T17:55:00Z', '2026-10-11T18:05:00Z',
    '2026-10-11T18:00:00Z', '2026-12-31T18:00:00Z',
    '2028-02-29T18:00:00Z',
  ])('refuses %s near a Monday or month-start midnight in Dhaka', (instant) => {
    expect(() => assertAwayFromDhakaPeriodStart(new Date(instant))).toThrow(/Asia\/Dhaka/);
  });

  it.each([
    '2026-10-11T17:54:00Z', '2026-10-11T18:06:00Z',
    '2026-10-31T17:54:00Z', '2026-10-31T18:06:00Z',
    '2026-10-13T18:00:00Z', '2026-10-12T00:00:00Z',
    '2028-02-28T18:00:00Z', '2026-10-10T18:00:00Z',
  ])('allows %s outside those boundary windows', (instant) => {
    expect(() => assertAwayFromDhakaPeriodStart(new Date(instant))).not.toThrow();
  });

  it('fails clearly for an invalid date', () => {
    expect(() => assertAwayFromDhakaPeriodStart(new Date(NaN))).toThrow('A valid test date is required');
  });
});

describe('guarded address database readers', () => {
  const psql = vi.mocked(execFileSync);
  const schema = 'mw_browser_123456abcdef';

  it.each([storedAddresses, storedAddressChanges, storedAddressState])('rejects an absent or unsafe schema before issuing SQL', (read) => {
    for (const value of ['', 'public', 'mw_browser_123456abcdeg', 'mw_browser_123456abcdef;DROP']) {
      vi.stubEnv(testSchemaVariable, value);
      expect(() => read('synthetic.user')).toThrow(/schema/);
    }
    expect(psql).not.toHaveBeenCalled();
  });

  it.each([storedAddresses, storedAddressChanges, storedAddressState])('rejects unsafe usernames before issuing SQL', (read) => {
    vi.stubEnv(testSchemaVariable, schema);
    for (const value of ["x' OR true--", 'ab', 'a'.repeat(51), 'Name', 'user@example.test', 'দোকান']) {
      expect(() => read(value)).toThrow(/synthetic usernames/);
    }
    expect(psql).not.toHaveBeenCalled();
  });

  it('returns the ordered own-book projection and handles an empty book', () => {
    vi.stubEnv(testSchemaVariable, schema);
    const row = { ...syntheticAddress(), isDefault: true, version: 2 };
    psql.mockReturnValueOnce(JSON.stringify([row])).mockReturnValueOnce('[]');
    expect(storedAddresses('synthetic.user')).toEqual([row]);
    expect(storedAddresses('synthetic.user')).toEqual([]);
    const options = psql.mock.calls[0][2] as { input: string };
    expect(options.input).toContain(`${schema}.saved_addresses`);
    expect(options.input).toContain('ORDER BY a.created_at, a.id');
    expect(options.input).toContain("WHERE u.username = 'synthetic.user'");
    expect(options.input).toContain('u.id = a.user_id');
  });

  it('preserves every own address/change column, including identity and timestamps', () => {
    vi.stubEnv(testSchemaVariable, schema);
    const state = { addresses: [{ id: 'address-id', user_id: 'user-id', version: 1,
      created_at: '2030-01-16T06:00:00+00:00', updated_at: '2030-01-16T06:01:00+00:00' }],
    changes: [{ id: 'change-id', user_id: 'user-id', changed_at: '2030-01-16T06:00:00+00:00' }] };
    psql.mockReturnValueOnce(JSON.stringify(state)).mockReturnValueOnce('{"addresses":[],"changes":[]}');
    expect(storedAddressState('synthetic.user')).toEqual(state);
    expect(storedAddressState('synthetic.user')).toEqual({ addresses: [], changes: [] });
    const options = psql.mock.calls[0][2] as { input: string };
    for (const [table, alias, order] of [['saved_addresses', 'a', 'created_at'], ['saved_address_changes', 'c', 'changed_at']]) {
      expect(options.input).toContain(`${schema}.${table} ${alias}`);
      expect(options.input).toContain(`to_jsonb(${alias}) ORDER BY ${alias}.${order}, ${alias}.id`);
      expect(options.input).toContain(`u.id = ${alias}.user_id`);
    }
    expect(options.input.match(/WHERE u.username = 'synthetic.user'/g)).toHaveLength(2);
  });

  it('reads only that user’s ordered counted instants', () => {
    vi.stubEnv(testSchemaVariable, schema);
    const changes = ['2030-01-16T06:00:00+00:00'];
    psql.mockReturnValue(JSON.stringify(changes));
    expect(storedAddressChanges('synthetic.user')).toEqual(changes);
    const options = psql.mock.calls[0][2] as { input: string };
    expect(options.input).toContain(`${schema}.saved_address_changes`);
    expect(options.input).toContain('ORDER BY c.changed_at, c.id');
    expect(options.input).toContain("WHERE u.username = 'synthetic.user'");
    expect(options.input).toContain('u.id = c.user_id');
  });

  it.each([storedAddresses, storedAddressChanges, storedAddressState])('rejects a missing or corrupt database answer', (read) => {
    vi.stubEnv(testSchemaVariable, schema);
    psql.mockReturnValueOnce('');
    expect(() => read('synthetic.user')).toThrow(/database projection/);
    psql.mockReturnValueOnce('invalid json');
    expect(() => read('synthetic.user')).toThrow();
  });
});

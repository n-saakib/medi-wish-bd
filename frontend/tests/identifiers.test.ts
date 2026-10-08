import { describe, expect, it } from 'vitest';
import { isProfileEmail } from '../src/lib/identifiers';

describe('profile email format', () => {
  it('accepts a bounded ASCII dot-atom address', () => {
    expect(isProfileEmail("a!#$%&'*+/=?^_`{|}~-.b@example.test")).toBe(true);
    expect(isProfileEmail(`${'a'.repeat(64)}@example.test`)).toBe(true);
  });

  it.each(['a..b@example.test', '.a@example.test', 'a.@example.test', 'a@localhost',
    'a@-example.test', 'a@example-.test', 'a@example.test.', 'a@[127.0.0.1]',
    '"a"@example.test', 'a(comment)@example.test', 'é@example.test',
    `${'a'.repeat(65)}@example.test`, `${'a'.repeat(63)}@${'b'.repeat(64)}.test`,
  ])('refuses an address outside the accepted subset: %s', (value) => {
    expect(isProfileEmail(value)).toBe(false);
  });
});

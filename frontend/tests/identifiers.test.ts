import { describe, expect, it } from 'vitest';
import { isMobile, isProfileEmail, isUsername } from '../src/lib/identifiers';

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

describe('registration username and mobile formats', () => {
  it.each(['abc', 'sana.k', 'a-1_b', 'x'.repeat(20), '1a2'])('accepts the username %s', (value) => {
    expect(isUsername(value)).toBe(true);
  });

  it.each(['ab', 'x'.repeat(21), '12345', '._-', 'Sana', 'sa na', 'sána'])('refuses the username %s', (value) => {
    expect(isUsername(value)).toBe(false);
  });

  it('accepts exactly 11 ASCII digits as a mobile number', () => {
    expect(isMobile('01700000000')).toBe(true);
    for (const value of ['0170000000', '017000000000', '+8801700000', '0170000000a', '০১৭০০০০০০০০']) {
      expect(isMobile(value)).toBe(false);
    }
  });
});

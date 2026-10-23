import { describe, expect, it } from 'vitest';
import { backupCodeInput } from '../src/auth/backupCode';

describe('backupCodeInput', () => {
  it.each(['ABCD-2345', 'abcd2345', '  ab cd 23 45  ', 'AB-CD2345', '\tABCD-2345\n'])(
    'formats the accepted ASCII input %j', (input) => expect(backupCodeInput(input)).toBe('ABCD-2345'),
  );
  it.each(['', 'ABCD234', 'ABCD23456', 'ABCI2345', 'ABCL2345', 'ABCO2345', 'ABCU2345', 'ABC02345',
    'ABC12345', 'ABCD--2345', '-ABCD-2345', 'ABCD_2345', 'ABCD\n2345', 'ABCD\t2345',
    'ÄBCD2345', 'ABCD２３４５', 'ßAB2345', 'ﬀAB2345'])(
    'rejects malformed or non-ASCII input %j', (input) => expect(backupCodeInput(input)).toBeNull(),
  );
});

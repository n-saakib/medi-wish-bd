import { randomBytes, randomInt } from 'node:crypto';
import { expect, it } from 'vitest';
import { createSessionClient } from '../src/lib/session.ts';
import { registerUser } from '../src/lib/user.ts';

it('story 06: a Customer password sign-in on the real backend needs no authenticator', async () => {
  const baseUrl = process.env.MEDI_WISH_API_URL;
  if (!baseUrl) throw new Error('Set MEDI_WISH_API_URL to the running test backend before integration tests.');
  const suffix = randomBytes(4).toString('hex');
  const customer = {
    username: `integration.${suffix}`,
    mobile: `018${randomInt(10_000_000, 100_000_000)}`,
    password: `Synthetic-${randomBytes(8).toString('hex')}`,
  };

  await registerUser(customer, { baseUrl });
  const session = await createSessionClient({ baseUrl }).signIn(customer.username, customer.password);

  expect(session.mfa).toBe('NOT_REQUIRED');
  expect(session.user).toMatchObject({ username: customer.username, mobile: customer.mobile, email: null });
});

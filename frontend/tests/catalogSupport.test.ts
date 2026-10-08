import type { Browser } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { staffContext, TokenRenewal } from './browser/catalogSupport';
import { verifiedAdmin } from './browser/support';

vi.mock('./browser/support', () => ({
  syntheticCustomer: vi.fn(),
  verifiedAdmin: vi.fn(),
  verifiedModerator: vi.fn(),
}));

/** A refresh call the test settles by hand, and a clock the test moves by hand. */
function controlled() {
  let clock = 1_000_000;
  const pending: { resolve: (token: string) => void; reject: (error: Error) => void }[] = [];
  const refresh = vi.fn(() => new Promise<string>((resolve, reject) => { pending.push({ resolve, reject }); }));
  const tokens = new TokenRenewal(refresh, () => clock, 10_000);
  return {
    tokens,
    refresh,
    pending,
    advance: (ms: number) => { clock += ms; },
  };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('TokenRenewal', () => {
  it('keeps the token until it is older than 60% of its lifetime, then renews it once', async () => {
    const { tokens, refresh, pending, advance } = controlled();
    tokens.remember('first');
    advance(6_000);
    expect(await tokens.authorization()).toEqual(bearer('first'));
    expect(refresh).not.toHaveBeenCalled();

    advance(1);
    const renewed = tokens.authorization();
    expect(refresh).toHaveBeenCalledTimes(1);
    pending[0].resolve('second');
    expect(await renewed).toEqual(bearer('second'));

    // The renewed token is new again: no second refresh until it, too, ages past 60%.
    advance(6_000);
    expect(await tokens.authorization()).toEqual(bearer('second'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shares one renewal between concurrent calls, so the refresh cookie is sent once', async () => {
    const { tokens, refresh, pending, advance } = controlled();
    tokens.remember('first');
    advance(7_000);
    const calls = [tokens.authorization(), tokens.authorization(), tokens.authorization()];
    expect(refresh).toHaveBeenCalledTimes(1);
    pending[0].resolve('second');
    expect(await Promise.all(calls)).toEqual([bearer('second'), bearer('second'), bearer('second')]);

    // A call after the renewal settled uses the new token without another refresh.
    expect(await tokens.authorization()).toEqual(bearer('second'));
    advance(6_001);
    const later = tokens.authorization();
    expect(refresh).toHaveBeenCalledTimes(2);
    pending[1].resolve('third');
    expect(await later).toEqual(bearer('third'));
  });

  it('fails every waiting call when the renewal fails, and the next call starts a new renewal', async () => {
    const { tokens, refresh, pending, advance } = controlled();
    tokens.remember('first');
    advance(7_000);
    const calls = [tokens.authorization(), tokens.authorization()];
    expect(refresh).toHaveBeenCalledTimes(1);
    pending[0].reject(new Error('the session refresh failed'));
    for (const call of calls) await expect(call).rejects.toThrow('the session refresh failed');

    const retried = tokens.authorization();
    expect(refresh).toHaveBeenCalledTimes(2);
    pending[1].resolve('second');
    expect(await retried).toEqual(bearer('second'));
  });
});

describe('staffContext', () => {
  it('closes its browser context when the staff sign-in fails, and rethrows', async () => {
    const close = vi.fn(async () => {});
    const context = { newPage: vi.fn(async () => ({})), close };
    const browser = { newContext: vi.fn(async () => context) } as unknown as Browser;
    vi.mocked(verifiedAdmin).mockRejectedValueOnce(new Error('enrollment failed'));

    await expect(staffContext(browser, 'admin')).rejects.toThrow('enrollment failed');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('leaves the context open for the caller when the sign-in succeeds', async () => {
    const close = vi.fn(async () => {});
    const page = {};
    const context = { newPage: vi.fn(async () => page), close };
    const browser = { newContext: vi.fn(async () => context) } as unknown as Browser;
    const user = {
      username: 'catalog.admin', mobile: '01700000000', email: 'catalog.admin@example.test', password: 'Synthetic-1',
      authenticator: { key: 'GEZDGNBVGY3TQOJQ', step: 0 },
    };
    vi.mocked(verifiedAdmin).mockResolvedValueOnce(user);

    await expect(staffContext(browser, 'admin')).resolves.toEqual({ context, page, user });
    expect(close).not.toHaveBeenCalled();
  });
});

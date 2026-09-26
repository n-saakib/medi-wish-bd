// @vitest-environment jsdom

import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteHeader } from '../src/shell/SiteHeader';
import { deferred, signedInUser } from './fakeApi';
import { createSessionSource, renderWithSession, unmountAll } from './renderWithSession';

afterEach(unmountAll);

describe('SiteHeader', () => {
  it('links signed-out visitors to sign-in', async () => {
    const header = await renderWithSession(createElement(SiteHeader));
    const link = header.querySelector('nav a');

    expect(link?.getAttribute('href')).toBe('/sign-in');
    expect(link?.textContent).toBe('Sign in');
    expect(header.querySelector('a.logo')?.getAttribute('href')).toBe('/');
  });

  it('shows the signed-in username linking to the account page', async () => {
    const header = await renderWithSession(createElement(SiteHeader), createSessionSource({
      restoreSession: vi.fn().mockResolvedValue(signedInUser),
    }));
    const link = header.querySelector('nav a');

    expect(link?.getAttribute('href')).toBe('/account');
    expect(link?.textContent).toBe('sana');
  });

  it('shows neither link until the restore finishes, so it never flashes the wrong one', async () => {
    const restore = deferred<null>();
    const header = await renderWithSession(createElement(SiteHeader), createSessionSource({
      restoreSession: vi.fn(() => restore.promise),
    }));

    expect(header.querySelector('nav a')).toBeNull();
  });
});

// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../messages/en.json';
import { createSessionClient } from '../src/lib/session';
import {
  initialUserAccessPanelState,
  userAccessPanelReducer,
  UserAccessPanel,
  type UserAccessPanelSession,
} from '../src/app/UserAccessPanel';

const signedInUser = {
  username: 'sana',
  mobile: '01700000000',
  email: null,
  mobileVerified: false,
};

const signedInResponse = {
  accessToken: 'synthetic-access-token',
  tokenType: 'Bearer' as const,
  expiresIn: 900,
  user: signedInUser,
};

const mountedRoots: Root[] = [];

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

function createSession(overrides: Partial<UserAccessPanelSession> = {}): UserAccessPanelSession {
  return {
    signIn: vi.fn().mockResolvedValue(signedInResponse),
    restoreSession: vi.fn().mockResolvedValue(null),
    signOut: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

async function mountPanel(session: UserAccessPanelSession): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => {
    // eslint-disable-next-line react/no-children-prop -- The provider accepts its rendered child through the typed prop.
    root.render(createElement(NextIntlClientProvider, {
      locale: 'en',
      messages,
      children: createElement<NonNullable<Parameters<typeof UserAccessPanel>[0]>>(UserAccessPanel, { session }),
    }));
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

function requiredElement<T extends Element>(container: ParentNode, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Expected element matching ${selector}`);
  return element;
}

function setInputValue(container: ParentNode, selector: string, value: string): void {
  const input = requiredElement<HTMLInputElement>(container, selector);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setValue) throw new Error('The input value setter is unavailable');
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submitLogin(container: ParentNode): Promise<void> {
  const form = requiredElement<HTMLFormElement>(container, 'form[aria-labelledby="login-title"]');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

async function submitRegistration(container: ParentNode): Promise<void> {
  const form = requiredElement<HTMLFormElement>(container, 'form[aria-labelledby="register-title"]');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('UserAccessPanel', () => {
  it('renders the identifier login contract and stable accessible feedback regions', () => {
    const markup = renderToStaticMarkup(
      // eslint-disable-next-line react/no-children-prop -- React 19 provider props require typed children here.
      createElement(
        NextIntlClientProvider,
        { locale: 'en', messages, children: createElement(UserAccessPanel) },
      ),
    );

    expect(markup).toContain('Username, mobile, or email');
    expect(markup).toContain('id="login-identifier"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('role="alert"');
    expect(markup).toMatch(/<form(?=[^>]*method="post")(?=[^>]*aria-labelledby="register-title")[^>]*>/);
    expect(markup).toMatch(/<form(?=[^>]*method="post")(?=[^>]*aria-labelledby="login-title")[^>]*>/);
    expect(markup).toContain('<p tabindex="-1" class="status" role="status" aria-live="polite" aria-atomic="true"></p>');
    expect(markup).toContain('<p tabindex="-1" class="error" role="alert" aria-live="assertive" aria-atomic="true"></p>');
    expect(markup).not.toContain('Basic');
    expect(markup).not.toContain('localStorage');
  });

  it('submits registration through the public endpoint, announces success, and clears the password', async () => {
    const registrationFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({
      username: 'sana',
      mobile: '01700000000',
      email: null,
      mobileVerificationDeferred: true,
    }, { status: 201 }));
    vi.stubGlobal('fetch', registrationFetch);

    const panel = await mountPanel(createSession());
    setInputValue(panel, '#register-username', 'sana');
    setInputValue(panel, '#register-mobile', '01700000000');
    setInputValue(panel, '#register-password', 'synthetic-password');

    await submitRegistration(panel);

    expect(registrationFetch).toHaveBeenCalledOnce();
    expect(String(registrationFetch.mock.calls[0]?.[0])).toMatch(/\/api\/auth\/register$/);
    expect(registrationFetch.mock.calls[0]?.[1]?.method).toBe('POST');
    const registrationForm = requiredElement<HTMLFormElement>(panel, 'form[aria-labelledby="register-title"]');
    expect(requiredElement<HTMLParagraphElement>(registrationForm, '[role="status"]').textContent)
      .toBe('Account created for sana. Mobile verification will be added later.');
    expect(requiredElement<HTMLInputElement>(panel, '#register-password').value).toBe('');
  });

  it('shows bounded registration feedback and clears the password when the request fails', async () => {
    const registrationFetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('private transport detail'));
    vi.stubGlobal('fetch', registrationFetch);

    const panel = await mountPanel(createSession());
    setInputValue(panel, '#register-username', 'sana');
    setInputValue(panel, '#register-mobile', '01700000000');
    setInputValue(panel, '#register-password', 'synthetic-password');

    await submitRegistration(panel);

    const registrationForm = requiredElement<HTMLFormElement>(panel, 'form[aria-labelledby="register-title"]');
    const error = requiredElement<HTMLParagraphElement>(registrationForm, '[role="alert"]');
    expect(error.textContent).toBe('The request could not be completed.');
    expect(error.textContent).not.toContain('private transport detail');
    expect(requiredElement<HTMLInputElement>(panel, '#register-password').value).toBe('');
  });

  it('keeps expired-session and sign-out feedback separate from login feedback', () => {
    const expired = userAccessPanelReducer(initialUserAccessPanelState, {
      type: 'restore-empty',
      expired: true,
    });
    const signedOut = userAccessPanelReducer(expired, {
      type: 'signout-success',
      message: 'You have been signed out.',
    });
    const signOutFailed = userAccessPanelReducer(initialUserAccessPanelState, {
      type: 'signout-error',
      message: 'The request could not be completed.',
    });

    expect(expired.sessionExpired).toBe(true);
    expect(expired.profile).toBeNull();
    expect(signedOut.signOutStatus).toBe('You have been signed out.');
    expect(signedOut.loginError).toBeNull();
    expect(signOutFailed.signOutError).toBe('The request could not be completed.');
    expect(signOutFailed.loginError).toBeNull();
  });

  it('suppresses a restore error that arrives while login is pending', () => {
    const loggingIn = userAccessPanelReducer(initialUserAccessPanelState, { type: 'login-start' });
    const restoreFailed = userAccessPanelReducer(loggingIn, {
      type: 'restore-error',
      message: 'Session restore failed.',
    });
    expect(restoreFailed.restoreError).toBeNull();
    const signedIn = userAccessPanelReducer(restoreFailed, {
      type: 'login-success',
      profile: {
        username: 'sana',
        mobile: '01700000000',
        email: null,
        mobileVerified: false,
      },
      message: 'Signed in as sana.',
    });

    expect(signedIn.restoreError).toBeNull();
    expect(signedIn.restoring).toBe(false);
  });

  it('ignores a restore error that arrives after sign-in has already succeeded', () => {
    const loggingIn = userAccessPanelReducer(initialUserAccessPanelState, { type: 'login-start' });
    const signedIn = userAccessPanelReducer(loggingIn, {
      type: 'login-success',
      profile: {
        username: 'sana',
        mobile: '01700000000',
        email: null,
        mobileVerified: false,
      },
      message: 'Signed in as sana.',
    });
    const lateRestoreFailure = userAccessPanelReducer(signedIn, {
      type: 'restore-error',
      message: 'Session restore failed.',
    });

    expect(lateRestoreFailure.profile?.username).toBe('sana');
    expect(lateRestoreFailure.restoreError).toBeNull();
    expect(lateRestoreFailure.restoring).toBe(false);
    expect(signedIn.restoring).toBe(false);
  });

  it('clears the login success status when signing out', async () => {
    let finishRestore!: (profile: typeof signedInUser | null) => void;
    const pendingRestore = new Promise<typeof signedInUser | null>((resolve) => {
      finishRestore = resolve;
    });
    let finishSignIn!: (response: typeof signedInResponse) => void;
    const pendingSignIn = new Promise<typeof signedInResponse>((resolve) => {
      finishSignIn = resolve;
    });
    let finishSignOut!: () => void;
    const pendingSignOut = new Promise<void>((resolve) => {
      finishSignOut = resolve;
    });
    const signIn = vi.fn<UserAccessPanelSession['signIn']>(() => pendingSignIn);
    const session = createSession({
      restoreSession: vi.fn(() => pendingRestore),
      signIn,
      signOut: vi.fn(() => pendingSignOut),
    });
    const panel = await mountPanel(session);
    await act(async () => {
      finishRestore(null);
      await pendingRestore;
    });
    setInputValue(panel, '#login-identifier', 'sana');
    setInputValue(panel, '#login-password', 'synthetic-password');

    const loginForm = requiredElement<HTMLFormElement>(panel, 'form[aria-labelledby="login-title"]');
    const submit = requiredElement<HTMLButtonElement>(loginForm, 'button[type="submit"]');
    await act(async () => {
      loginForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(signIn).toHaveBeenCalledWith('sana', 'synthetic-password');
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe('Signing in…');
    expect(requiredElement<HTMLInputElement>(panel, '#login-password').value).toBe('synthetic-password');

    await act(async () => {
      finishSignIn(signedInResponse);
      await pendingSignIn;
    });

    expect(panel.textContent).toContain('sana');
    const loginStatus = requiredElement<HTMLParagraphElement>(loginForm, '[role="status"]');
    expect(loginStatus.textContent).toBe('Signed in as sana.');
    expect(requiredElement<HTMLInputElement>(panel, '#login-password').value).toBe('');
    expect(submit.disabled).toBe(false);

    const signOut = requiredElement<HTMLButtonElement>(panel, '.account-profile button');
    await act(async () => {
      signOut.click();
    });
    expect(signOut.disabled).toBe(true);
    expect(loginStatus.textContent).toBe('');

    await act(async () => {
      finishSignOut();
      await pendingSignOut;
    });

    const signOutStatus = requiredElement<HTMLParagraphElement>(panel, '.account-panel > p.status[tabindex="-1"]:not(#session-status)');
    expect(panel.querySelector('#profile-title')).toBeNull();
    expect(loginStatus.textContent).toBe('');
    expect(signOutStatus.textContent).toBe('You have been signed out.');
  });

  it('keeps the access token out of the browser URL and history after rendered sign-in', async () => {
    const accessToken = 'synthetic-private-access-token';
    const previousUrl = window.location.href;
    const previousHistoryState = window.history.state;
    const signedInUrl = new URL('/account?tab=orders#recent', previousUrl).href;
    const signedInHistoryState = { screen: 'account' };
    window.history.replaceState(signedInHistoryState, '', signedInUrl);

    const historyWrites: Array<{ state: unknown; url: string | URL | null | undefined }> = [];
    const pushState = window.history.pushState.bind(window.history);
    const replaceState = window.history.replaceState.bind(window.history);
    const pushStateSpy = vi.spyOn(window.history, 'pushState').mockImplementation((state, title, url) => {
      historyWrites.push({ state, url });
      pushState(state, title, url);
    });
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation((state, title, url) => {
      historyWrites.push({ state, url });
      replaceState(state, title, url);
    });

    try {
      const session = createSessionClient({
        baseUrl: 'http://127.0.0.1:8080',
        fetch: async (input) => {
          const pathname = new URL(input instanceof Request ? input.url : input.toString()).pathname;
          if (pathname === '/api/auth/csrf') return Response.json({ csrfToken: 'synthetic-csrf-token' });
          if (pathname === '/api/auth/refresh') {
            return Response.json({
              code: 'AUTHENTICATION_REQUIRED',
              message: 'Authentication is required.',
              requestId: 'synthetic-request-id',
            }, { status: 401 });
          }
          if (pathname === '/api/auth/login') {
            return Response.json({ ...signedInResponse, accessToken });
          }
          throw new Error(`Unexpected session request: ${pathname}`);
        },
      });
      const panel = await mountPanel(session);
      setInputValue(panel, '#login-identifier', 'sana');
      setInputValue(panel, '#login-password', 'synthetic-password');

      await submitLogin(panel);

      expect(session.isAuthenticated()).toBe(true);
      expect(requiredElement<HTMLParagraphElement>(panel, 'form[aria-labelledby="login-title"] [role="status"]').textContent)
        .toBe('Signed in as sana.');
      expect(window.location.href).toBe(signedInUrl);
      expect(window.location.search).toBe('?tab=orders');
      expect(window.location.hash).toBe('#recent');
      expect(window.history.state).toEqual(signedInHistoryState);

      const serializedHistoryWrites = historyWrites.map(({ state, url }) => {
        const writtenUrl = url == null ? signedInUrl : new URL(url.toString(), signedInUrl).href;
        return `${writtenUrl}\n${JSON.stringify(state) ?? ''}`;
      }).join('\n');
      expect(`${window.location.href}\n${JSON.stringify(window.history.state)}\n${serializedHistoryWrites}`)
        .not.toContain(accessToken);
    } finally {
      pushStateSpy.mockRestore();
      replaceStateSpy.mockRestore();
      window.history.replaceState(previousHistoryState, '', previousUrl);
    }
  });

  it('clears the password after failed sign-in and focuses the bounded alert and identifier', async () => {
    const session = createSession({ signIn: vi.fn().mockRejectedValue(new Error('private failure detail')) });
    const panel = await mountPanel(session);
    setInputValue(panel, '#login-identifier', 'sana');
    setInputValue(panel, '#login-password', 'synthetic-password');

    await submitLogin(panel);

    const loginForm = requiredElement<HTMLFormElement>(panel, 'form[aria-labelledby="login-title"]');
    const error = requiredElement<HTMLParagraphElement>(loginForm, '[role="alert"]');
    expect(error.textContent).toBe('The request could not be completed.');
    expect(error.textContent).not.toContain('private failure detail');
    expect(requiredElement<HTMLInputElement>(panel, '#login-password').value).toBe('');
    expect(document.activeElement).toBe(requiredElement(panel, '#login-identifier'));
  });

  it('renders the validated public profile returned by session restore', async () => {
    const session = createSession({ restoreSession: vi.fn().mockResolvedValue(signedInUser) });
    const panel = await mountPanel(session);

    expect(requiredElement<HTMLHeadingElement>(panel, '#profile-title').textContent).toContain('sana');
    expect(requiredElement<HTMLParagraphElement>(panel, '#session-status').textContent).toBe('');
    expect(requiredElement<HTMLParagraphElement>(panel, 'section[aria-labelledby="account-title"] > .error[role="alert"]').textContent).toBe('');
  });

  it('shows bounded feedback when session restoration fails without marking the session expired', async () => {
    const session = createSession({ restoreSession: vi.fn().mockRejectedValue(new Error('private failure detail')) });
    const panel = await mountPanel(session);

    expect(requiredElement<HTMLParagraphElement>(panel, 'section[aria-labelledby="account-title"] > .error[role="alert"]').textContent)
      .toBe('Your session could not be restored. Please sign in again.');
    expect(requiredElement<HTMLParagraphElement>(panel, '#session-status').textContent).toBe('');
    expect(panel.querySelector('#profile-title')).toBeNull();
  });

  it('keeps an absent refresh session quiet when no in-memory session existed', async () => {
    const session = createSession({ restoreSession: vi.fn().mockResolvedValue(null) });
    const panel = await mountPanel(session);

    expect(requiredElement<HTMLParagraphElement>(panel, '#session-status').textContent).toBe('');
    expect(requiredElement<HTMLParagraphElement>(panel, 'section[aria-labelledby="account-title"] > .error[role="alert"]').textContent).toBe('');
    expect(panel.querySelector('#profile-title')).toBeNull();
  });

  it('announces and focuses session expiry when restoration loses an existing session', async () => {
    const session = createSession({
      isAuthenticated: vi.fn().mockReturnValue(true),
      restoreSession: vi.fn().mockResolvedValue(null),
    });
    const panel = await mountPanel(session);
    const status = requiredElement<HTMLParagraphElement>(panel, '#session-status');

    expect(status.textContent).toBe('Your session has expired. Please sign in again.');
    expect(document.activeElement).toBe(status);
    expect(requiredElement<HTMLParagraphElement>(panel, 'section[aria-labelledby="account-title"] > .error[role="alert"]').textContent).toBe('');
  });

  it('signs out, removes the profile, and focuses the success status', async () => {
    const session = createSession({ restoreSession: vi.fn().mockResolvedValue(signedInUser) });
    const panel = await mountPanel(session);
    const signOut = requiredElement<HTMLButtonElement>(panel, '.account-profile button');

    await act(async () => signOut.click());

    const status = requiredElement<HTMLParagraphElement>(panel, '.account-panel > p.status[tabindex="-1"]:not(#session-status)');
    expect(panel.querySelector('#profile-title')).toBeNull();
    expect(status.textContent).toBe('You have been signed out.');
    expect(document.activeElement).toBe(status);
    expect(session.signOut).toHaveBeenCalledOnce();
  });

  it('keeps logout failure bounded, removes the local profile, and focuses its alert', async () => {
    const session = createSession({
      restoreSession: vi.fn().mockResolvedValue(signedInUser),
      signOut: vi.fn().mockRejectedValue(new Error('private failure detail')),
    });
    const panel = await mountPanel(session);
    const signOut = requiredElement<HTMLButtonElement>(panel, '.account-profile button');

    await act(async () => signOut.click());

    const error = requiredElement<HTMLParagraphElement>(panel, '[role="alert"][tabindex="-1"]');
    expect(panel.querySelector('#profile-title')).toBeNull();
    expect(error.textContent).toBe('The request could not be completed.');
    expect(error.textContent).not.toContain('private failure detail');
    expect(document.activeElement).toBe(error);
  });
});

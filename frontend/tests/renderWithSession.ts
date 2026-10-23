import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { vi } from 'vitest';
import messages from '../messages/en.json';
import { SessionProvider, type SessionSource } from '../src/auth/SessionProvider';
import { ApiError } from '../src/lib/api';
import type { SessionResponse } from '../src/lib/session';
import { flushTasks, signedInUser } from './fakeApi';

export const signedInResponse: SessionResponse = { accessToken: 'synthetic-access-token', user: signedInUser, mfa: 'NOT_REQUIRED' };

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

const mountedRoots: Root[] = [];

/** A signed-out session source whose calls can be inspected or overridden per test. */
export function createSessionSource(overrides: Partial<SessionSource> = {}): SessionSource {
  return {
    signIn: vi.fn().mockResolvedValue(signedInResponse),
    restoreSession: vi.fn().mockResolvedValue(null),
    signOut: vi.fn().mockResolvedValue(undefined),
    authenticatedFetch: vi.fn().mockRejectedValue(new ApiError('AUTHENTICATION_REQUIRED', 401)),
    startMfaEnrollment: vi.fn().mockRejectedValue(new ApiError('AUTHENTICATION_REQUIRED', 401)),
    verifyMfaEnrollment: vi.fn().mockRejectedValue(new ApiError('AUTHENTICATION_REQUIRED', 401)),
    verifyMfa: vi.fn().mockRejectedValue(new ApiError('AUTHENTICATION_REQUIRED', 401)),
    redeemBackupCode: vi.fn().mockRejectedValue(new ApiError('AUTHENTICATION_REQUIRED', 401)),
    regenerateBackupCodes: vi.fn().mockRejectedValue(new ApiError('AUTHENTICATION_REQUIRED', 401)),
    ...overrides,
  };
}

/** Lets pending promises and the effects they trigger finish. */
export async function settle(): Promise<void> {
  await act(flushTasks);
}

/** Mounts an element inside the real translation and session providers, then waits for the restore. */
export async function renderWithSession(element: ReactElement, source = createSessionSource()): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => {
    // React 19's createElement typing requires these providers' children as a prop.
    /* eslint-disable react/no-children-prop */
    root.render(createElement(NextIntlClientProvider, {
      locale: 'en',
      messages,
      children: createElement(SessionProvider, { source, children: element }),
    }));
    /* eslint-enable react/no-children-prop */
  });
  await settle();
  return container;
}

export async function unmountAll(): Promise<void> {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
}

export function requiredElement<T extends Element>(container: ParentNode, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Expected element matching ${selector}`);
  return element;
}

export function setInputValue(container: ParentNode, selector: string, value: string): void {
  const input = requiredElement<HTMLInputElement>(container, selector);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setValue) throw new Error('The input value setter is unavailable');
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Submits the first form without waiting for the requests it starts. */
export async function submitForm(container: ParentNode): Promise<void> {
  const form = requiredElement<HTMLFormElement>(container, 'form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { vi } from 'vitest';
import messages from '../messages/en.json';
import { SessionProvider, type SessionSource } from '../src/auth/SessionProvider';

export const signedInUser = {
  username: 'sana',
  mobile: '01700000000',
  email: null,
  mobileVerified: false,
};

export const signedInResponse = {
  accessToken: 'synthetic-access-token',
  tokenType: 'Bearer' as const,
  expiresIn: 900,
  user: signedInUser,
};

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

const mountedRoots: Root[] = [];

/** A signed-out session source whose calls can be inspected or overridden per test. */
export function createSessionSource(overrides: Partial<SessionSource> = {}): SessionSource {
  return {
    signIn: vi.fn().mockResolvedValue(signedInResponse),
    restoreSession: vi.fn().mockResolvedValue(null),
    signOut: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

/** Lets pending promises and the effects they trigger finish. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
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

/** Returns a promise plus the function that settles it, to hold a request open mid-test. */
export function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

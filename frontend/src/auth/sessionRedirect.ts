'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, type SessionState } from './SessionProvider';

/** `account` needs a session; `guest` pages (sign-in, register) are only for signed-out visitors. */
export type SessionGuard = 'account' | 'guest';

/**
 * Where a page should send the visitor, or null to stay. Nothing moves until the refresh-cookie
 * restore has finished, because the session is only known in the browser.
 */
export function sessionRedirect(guard: SessionGuard, state: SessionState): string | null {
  if (state.restoring) return null;
  if (guard === 'guest') return state.profile ? '/account' : null;
  if (state.profile || state.signingOut) return null;
  return state.notice === 'signedOut' || state.notice === 'signOutError' ? '/' : '/sign-in';
}

export function useSessionRedirect(guard: SessionGuard): void {
  const session = useSession();
  const router = useRouter();
  const target = sessionRedirect(guard, session);
  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);
}

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { MfaStatus } from '../lib/session';
import { useSession, type SessionState } from './SessionProvider';

/**
 * `guest` pages (sign-in, register) are only for signed-out visitors; `account` needs a session; the staff guards
 * each accept one staff-MFA status: `mfa-enrollment` a session that must set up an authenticator, `mfa-challenge`
 * one that must enter a code, and `staff` an MFA-verified session.
 */
export type SessionGuard = 'guest' | 'account' | 'mfa-enrollment' | 'mfa-challenge' | 'staff';

/** The one page each MFA status belongs on. */
const mfaHome: Record<MfaStatus, string> = {
  NOT_REQUIRED: '/account',
  ENROLLMENT_REQUIRED: '/staff/mfa/enroll',
  VERIFICATION_REQUIRED: '/staff/mfa',
  VERIFIED: '/staff',
};

/** The statuses that may stay on each guarded page when signed in. */
const allowedStatuses: Record<SessionGuard, readonly MfaStatus[]> = {
  guest: [],
  account: ['NOT_REQUIRED', 'VERIFIED'],
  'mfa-enrollment': ['ENROLLMENT_REQUIRED'],
  'mfa-challenge': ['VERIFICATION_REQUIRED'],
  staff: ['VERIFIED'],
};

/**
 * Where a page should send the visitor, or null to stay. Nothing moves until the refresh-cookie
 * restore has finished, because the session is only known in the browser.
 */
export function sessionRedirect(guard: SessionGuard, state: SessionState): string | null {
  if (state.restoring) return null;
  if (state.profile) {
    if (!state.mfa || allowedStatuses[guard].includes(state.mfa)) return null;
    return mfaHome[state.mfa];
  }
  if (guard === 'guest' || state.signingOut) return null;
  if (guard !== 'account') return '/sign-in';
  return state.notice === 'signedOut' || state.notice === 'signOutError' ? '/' : '/sign-in';
}

type SessionRedirectOptions = {
  /** False holds the page where it is, such as while backup codes are shown after the session became verified. */
  enabled?: boolean;
};

export function useSessionRedirect(guard: SessionGuard, { enabled = true }: SessionRedirectOptions = {}): void {
  const session = useSession();
  const router = useRouter();
  const target = enabled ? sessionRedirect(guard, session) : null;
  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);
}

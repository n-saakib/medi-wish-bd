import { boundedError, boundedText, invalidResponse, isRecord, readJsonResponse } from './api';
import type { SessionClient } from './session';

export type Profile = {
  username: string;
  fullName: string | null;
  mobile: string;
  mobileVerified: boolean;
  pendingMobile: string | null;
  email: string | null;
  dateOfBirth: string | null;
  accountState: 'ACTIVE' | 'CLOSURE_REQUESTED';
  version: number;
};

export type ProfileEdit = Pick<Profile, 'fullName' | 'email' | 'dateOfBirth' | 'version'>;
type AuthenticatedSession = Pick<SessionClient, 'authenticatedFetch'>;
const datePattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function optionalText(value: unknown, maxLength: number): value is string | null {
  return value === null || boundedText(value, maxLength);
}

/** Only the accepted response fields are copied into client state. */
export function projectProfile(body: unknown): Profile | undefined {
  if (!isRecord(body)
    || !boundedText(body.username, 50)
    || !optionalText(body.fullName, 100)
    || !boundedText(body.mobile, 30)
    || typeof body.mobileVerified !== 'boolean'
    || !optionalText(body.pendingMobile, 30)
    || !optionalText(body.email, 320)
    || !(body.dateOfBirth === null || isCalendarDate(body.dateOfBirth))
    || (body.accountState !== 'ACTIVE' && body.accountState !== 'CLOSURE_REQUESTED')
    || typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 0) return undefined;
  return {
    username: body.username, fullName: body.fullName, mobile: body.mobile,
    mobileVerified: body.mobileVerified, pendingMobile: body.pendingMobile,
    email: body.email, dateOfBirth: body.dateOfBirth, accountState: body.accountState,
    version: body.version,
  };
}

async function readProfile(response: Response, status: number): Promise<Profile> {
  if (response.status !== status) throw await boundedError(response);
  const profile = projectProfile(await readJsonResponse(response));
  if (!profile) throw invalidResponse(response.status);
  return profile;
}

export function loadProfile(session: AuthenticatedSession): Promise<Profile> {
  return session.authenticatedFetch('/api/user/me/profile', { method: 'GET' }, (response) => readProfile(response, 200));
}

export function saveProfile(session: AuthenticatedSession, edit: ProfileEdit): Promise<Profile> {
  return session.authenticatedFetch('/api/user/me/profile', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edit),
  }, (response) => readProfile(response, 200));
}

export function stageMobileChange(session: AuthenticatedSession, mobile: string): Promise<Profile> {
  return session.authenticatedFetch('/api/user/me/mobile-change', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile }),
  }, (response) => readProfile(response, 202));
}

export function cancelMobileChange(session: AuthenticatedSession): Promise<void> {
  return session.authenticatedFetch('/api/user/me/mobile-change', { method: 'DELETE' }, async (response) => {
    if (response.status !== 204) throw await boundedError(response);
  });
}

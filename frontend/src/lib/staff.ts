import { boundedError, boundedText, invalidResponse, isRecord, readJsonResponse } from './api';
import type { SessionClient } from './session';

/** What the signed-in staff member may do, from `GET /api/staff/me`. */
export type StaffAccess = {
  username: string;
  roles: string[];
  superAdmin: boolean;
};

const maxUsernameLength = 50;
const maxRoles = 8;
const rolePattern = /^[A-Z][A-Z_]{0,31}$/;

function isRole(value: unknown): value is string {
  return typeof value === 'string' && rolePattern.test(value);
}

export function projectStaffAccess(body: unknown): StaffAccess | undefined {
  if (!isRecord(body)
      || !boundedText(body.username, maxUsernameLength)
      || typeof body.superAdmin !== 'boolean'
      || !Array.isArray(body.roles)) {
    return undefined;
  }
  const roles: unknown[] = body.roles;
  if (roles.length === 0 || roles.length > maxRoles || !roles.every(isRole)) return undefined;
  return { username: body.username, roles: roles.filter(isRole), superAdmin: body.superAdmin };
}

/** Loads the staff member's access with the session's Bearer token; only an MFA-verified session is answered. */
export function fetchStaffAccess(session: Pick<SessionClient, 'authenticatedFetch'>): Promise<StaffAccess> {
  return session.authenticatedFetch('/api/staff/me', { method: 'GET' }, async (response) => {
    if (!response.ok) throw await boundedError(response);
    const access = projectStaffAccess(await readJsonResponse(response));
    if (!access) throw invalidResponse(response.status);
    return access;
  });
}

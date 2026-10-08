import { ApiError, boundedError, boundedText, invalidResponse, isRecord, readJsonResponse } from './api';
import type { SessionClient } from './session';

export const userRoles = ['CUSTOMER', 'DELIVERY_PERSON', 'MODERATOR', 'ADMIN'] as const;
export type UserRole = typeof userRoles[number];
export type StaffMfaState = 'NOT_REQUIRED' | 'SETUP_REQUIRED' | 'ENROLLED';
export type UserSummary = {
  id: string; username: string; role: UserRole; staffMfa: StaffMfaState; superAdmin: boolean; createdAt: string;
};
export type UserFilter = { username?: string; role?: UserRole; page?: number; size?: number };
export type UserPage = { items: UserSummary[]; page: number; size: number; totalItems: number };
type AdminSession = Pick<SessionClient, 'authenticatedFetch'>;

export function isUserId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && userRoles.some((role) => role === value);
}
function isStaffMfa(value: unknown): value is StaffMfaState {
  return value === 'NOT_REQUIRED' || value === 'SETUP_REQUIRED' || value === 'ENROLLED';
}
function isInstant(value: unknown): value is string {
  return boundedText(value, 64) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
/** Discards every field outside the documented summary. */
export function projectUserSummary(body: unknown): UserSummary | undefined {
  if (!isRecord(body) || !isUserId(body.id) || !boundedText(body.username, 50)
    || !isUserRole(body.role) || !isStaffMfa(body.staffMfa)
    || typeof body.superAdmin !== 'boolean' || (body.superAdmin && body.role !== 'ADMIN') || !isInstant(body.createdAt)) return;
  const staffMfa = body.staffMfa;
  const staff = body.role === 'ADMIN' || body.role === 'MODERATOR';
  if (staff === (staffMfa === 'NOT_REQUIRED')) return;
  return { id: body.id, username: body.username, role: body.role, staffMfa, superAdmin: body.superAdmin, createdAt: body.createdAt };
}
function projectUserPage(body: unknown): UserPage | undefined {
  if (!isRecord(body) || !Array.isArray(body.items) || !isCount(body.page) || !isCount(body.size)
    || body.size < 1 || body.size > 50 || body.items.length > body.size || !isCount(body.totalItems)
    || body.totalItems < body.items.length) return;
  const items = body.items.map(projectUserSummary);
  if (items.some((item) => !item)) return;
  return { items: items.filter((item): item is UserSummary => !!item), page: body.page, size: body.size, totalItems: body.totalItems };
}
/** A read-only search with the filter in its body: no username enters a URL. */
export function listUsers(session: AdminSession, filter: UserFilter = {}): Promise<UserPage> {
  return session.authenticatedFetch('/api/admin/users/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filter),
  }, async (response) => {
    if (!response.ok) throw await boundedError(response);
    const page = projectUserPage(await readJsonResponse(response));
    if (!page) throw invalidResponse(response.status);
    return page;
  });
}
export type RoleChange = { occurredAt: string; actorUsername: string | null; oldRole: UserRole; newRole: UserRole };
export type UserRoles = UserSummary & { rolesVersion: number; self: boolean; assignableRoles: UserRole[]; roleChanges: RoleChange[] };

function projectRoleChange(body: unknown): RoleChange | undefined {
  if (!isRecord(body) || !isInstant(body.occurredAt) || (body.actorUsername !== null && !boundedText(body.actorUsername, 50))
    || !isUserRole(body.oldRole) || !isUserRole(body.newRole) || body.oldRole === body.newRole) return;
  return { occurredAt: body.occurredAt, actorUsername: body.actorUsername, oldRole: body.oldRole, newRole: body.newRole };
}
/** A bounded detail projection, including a deleted actor as null. */
export function projectUserRoles(body: unknown): UserRoles | undefined {
  const summary = projectUserSummary(body);
  if (!summary || !isRecord(body) || !isCount(body.rolesVersion) || typeof body.self !== 'boolean'
    || !Array.isArray(body.assignableRoles) || body.assignableRoles.length > 4 || !body.assignableRoles.every(isUserRole)
    || new Set(body.assignableRoles).size !== body.assignableRoles.length || !Array.isArray(body.roleChanges)
    || body.roleChanges.length > 20) return;
  const changes = body.roleChanges.map(projectRoleChange);
  if (changes.some((change) => !change)) return;
  return { ...summary, rolesVersion: body.rolesVersion, self: body.self, assignableRoles: body.assignableRoles,
    roleChanges: changes.filter((change): change is RoleChange => !!change) };
}

async function readUserRolesResponse(response: Response): Promise<UserRoles> {
  if (!response.ok) throw await boundedError(response);
  const detail = projectUserRoles(await readJsonResponse(response));
  if (!detail) throw invalidResponse(response.status);
  return detail;
}
/** Loads only by UUID; malformed route ids never reach the API. */
export async function loadUserRoles(session: AdminSession, id: string): Promise<UserRoles> {
  if (!isUserId(id)) throw new ApiError('NOT_FOUND', 400);
  return session.authenticatedFetch(`/api/admin/users/${id}`, { method: 'GET' }, readUserRolesResponse);
}
/** Replaces the role with the version the Admin read; successful no-ops use the same response shape. */
export async function saveRole(session: AdminSession, id: string, role: UserRole, rolesVersion: number): Promise<UserRoles> {
  if (!isUserId(id)) throw new ApiError('NOT_FOUND', 400);
  return session.authenticatedFetch(`/api/admin/users/${id}/roles`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, rolesVersion }),
  }, readUserRolesResponse);
}

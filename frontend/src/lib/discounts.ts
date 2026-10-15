import { boundedError, boundedText, invalidResponse, isRecord, readJsonResponse } from './api';
import { isUuid, type CatalogSession, type Page } from './catalog';

export type DiscountTargetType = 'PRODUCT' | 'CATEGORY';
export type DiscountKind = 'PERCENTAGE' | 'FLAT';
export type DiscountStatus = 'ACTIVE' | 'SCHEDULED' | 'ENDED';
export type Discount = {
  id: string; targetType: DiscountTargetType; targetId: string; targetName: string; productCount: number | null;
  kind: DiscountKind; value: string; startsOn: string; endsOn: string | null; status: DiscountStatus;
  version: number; updatedAt: string; updatedByUsername: string | null;
};
export type DiscountDraft = Pick<Discount, 'id' | 'targetType' | 'targetId' | 'kind' | 'value' | 'startsOn' | 'endsOn'>;
export type DiscountUpdate = Pick<Discount, 'kind' | 'value' | 'startsOn' | 'endsOn' | 'version'>;
export type DiscountPage = Page<Discount> & { counts: { active: number; scheduled: number } };

const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
export function dhakaToday(now = new Date()): string {
  const parts = calendar.formatToParts(now);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function projectDiscountValue(body: unknown): { targetType: DiscountTargetType; kind: DiscountKind; value: string } | undefined {
  if (!isRecord(body) || (body.targetType !== 'PRODUCT' && body.targetType !== 'CATEGORY')
    || (body.kind !== 'PERCENTAGE' && body.kind !== 'FLAT') || typeof body.value !== 'string'
    || (body.kind === 'PERCENTAGE' ? !/^[1-9][0-9]?$/.test(body.value)
      : !/^\d{1,7}\.\d{2}$/.test(body.value) || /^0+\.00$/.test(body.value))) return undefined;
  return { targetType: body.targetType, kind: body.kind, value: body.value };
}
export function projectDiscount(body: unknown): Discount | undefined {
  const value = projectDiscountValue(body);
  if (!value || !isRecord(body) || !isUuid(body.id) || !isUuid(body.targetId) || !boundedText(body.targetName, 160)
    || (body.targetType === 'CATEGORY' ? !count(body.productCount) : body.productCount !== null)
    || !isCalendarDate(body.startsOn) || (body.endsOn !== null && !isCalendarDate(body.endsOn))
    || (body.status !== 'ACTIVE' && body.status !== 'SCHEDULED' && body.status !== 'ENDED') || !count(body.version)
    || !boundedText(body.updatedAt, 64) || Number.isNaN(Date.parse(body.updatedAt))
    || (body.updatedByUsername !== null && !boundedText(body.updatedByUsername, 50))) return undefined;
  return { ...value, id: body.id, targetId: body.targetId, targetName: body.targetName,
    productCount: body.productCount as number | null, startsOn: body.startsOn, endsOn: body.endsOn,
    status: body.status, version: body.version, updatedAt: body.updatedAt, updatedByUsername: body.updatedByUsername };
}
export function projectDiscountPage(body: unknown): DiscountPage | undefined {
  if (!isRecord(body) || !Array.isArray(body.items) || !count(body.page) || !count(body.size) || body.size < 1 || body.size > 50
    || body.items.length > body.size || !count(body.totalItems) || !isRecord(body.counts)
    || !count(body.counts.active) || !count(body.counts.scheduled)) return undefined;
  const items = body.items.map(projectDiscount);
  if (items.some((item) => !item)) return undefined;
  return { items: items as Discount[], page: body.page, size: body.size, totalItems: body.totalItems,
    counts: { active: body.counts.active, scheduled: body.counts.scheduled } };
}
export function createDiscountClient(session: CatalogSession) {
  const request = <T>(path: string, init: RequestInit, project: (body: unknown) => T | undefined) =>
    session.authenticatedFetch(path, init, async (response) => {
      if (!response.ok) throw await boundedError(response);
      const result = project(await readJsonResponse(response, 256 * 1024));
      if (!result) throw invalidResponse(response.status);
      return result;
    });
  const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    listDiscounts(status: DiscountStatus, page = 0, size = 20) {
      return request(`/api/staff/discounts?status=${status}&page=${page}&size=${size}`, { method: 'GET' }, projectDiscountPage);
    },
    createDiscount(body: DiscountDraft) { return request('/api/staff/discounts', json('POST', body), projectDiscount); },
    updateDiscount(id: string, body: DiscountUpdate) { return request(`/api/staff/discounts/${id}`, json('PUT', body), projectDiscount); },
    endDiscount(id: string, version: number) { return request(`/api/staff/discounts/${id}/end`, json('POST', { version }), projectDiscount); },
  };
}

import { boundedError, boundedText, invalidResponse, isRecord, readJsonResponse } from './api';
import type { SessionClient } from './session';
import { projectDiscountValue, type DiscountKind, type DiscountTargetType } from './discounts';

export type ProductKind = 'MEDICINE' | 'EQUIPMENT';
export type ProductStatus = 'ACTIVE' | 'INACTIVE' | 'NEEDS_PRICE';
export type ProductChangeType = 'CREATED' | 'CATALOG_UPDATED' | 'PRICE_CHANGED'
  | 'REQUIRE_VALIDATION_CHANGED' | 'ACTIVATED' | 'DEACTIVATED' | 'DISCOUNT_STARTED' | 'DISCOUNT_ENDED';
export type HistoryDiscount = { targetType: DiscountTargetType; kind: DiscountKind; value: string };
export type AppliedDiscount = HistoryDiscount & { id: string; targetName: string; saving: string };

export type Category = { id: string; name: string; active: boolean; productCount: number; version: number };
export type ProductSummary = {
  id: string; kind: ProductKind; name: string; brandName: string | null; genericName: string | null;
  dosageForm: string | null; manufacturer: string | null; categoryId: string; categoryName: string;
  saleUnit: string; sellingPrice: string | null; mrp: string | null; active: boolean;
  requireValidation: boolean; status: ProductStatus;
  effectivePrice: string | null; appliedDiscount: AppliedDiscount | null;
};
export type ProductChange = {
  occurredAt: string; actorUsername: string | null; changeType: ProductChangeType;
  oldSellingPrice: string | null; newSellingPrice: string | null; oldMrp: string | null;
  newMrp: string | null; oldRequireValidation: boolean | null; newRequireValidation: boolean | null;
  discount: HistoryDiscount | null;
};
export type Product = ProductSummary & {
  description: string | null; version: number; updatedAt: string; updatedByUsername: string | null;
  history: ProductChange[];
};
export type Page<T> = { items: T[]; page: number; size: number; totalItems: number };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const moneyPattern = /^\d{1,7}\.\d{2}$/;
const kinds: readonly unknown[] = ['MEDICINE', 'EQUIPMENT'];
const statuses: readonly unknown[] = ['ACTIVE', 'INACTIVE', 'NEEDS_PRICE'];
const changeTypes: readonly unknown[] = [
  'CREATED', 'CATALOG_UPDATED', 'PRICE_CHANGED', 'REQUIRE_VALIDATION_CHANGED', 'ACTIVATED', 'DEACTIVATED', 'DISCOUNT_STARTED', 'DISCOUNT_ENDED',
];

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

function isMoney(value: unknown): value is string {
  return typeof value === 'string' && moneyPattern.test(value);
}

function isNullableMoney(value: unknown): value is string | null {
  return value === null || isMoney(value);
}

function isNullableText(value: unknown, max: number): value is string | null {
  return value === null || boundedText(value, max);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isDate(value: unknown): value is string {
  return boundedText(value, 64) && !Number.isNaN(Date.parse(value));
}

export function projectCategory(body: unknown): Category | undefined {
  if (!isRecord(body) || !isUuid(body.id) || !boundedText(body.name, 80)
      || typeof body.active !== 'boolean' || !isCount(body.productCount) || !isCount(body.version)) return undefined;
  return { id: body.id, name: body.name, active: body.active, productCount: body.productCount, version: body.version };
}

export function projectProductSummary(body: unknown): ProductSummary | undefined {
  const applied = isRecord(body) && body.appliedDiscount !== null ? projectAppliedDiscount(body.appliedDiscount) : null;
  if (!isRecord(body) || !isUuid(body.id) || !kinds.includes(body.kind) || !boundedText(body.name, 160)
      || !isNullableText(body.brandName, 120) || !isNullableText(body.genericName, 200)
      || !isNullableText(body.dosageForm, 120) || !isNullableText(body.manufacturer, 120)
      || !isUuid(body.categoryId) || !boundedText(body.categoryName, 80) || !boundedText(body.saleUnit, 80)
      || !isNullableMoney(body.sellingPrice) || !isNullableMoney(body.mrp)
      || !isNullableMoney(body.effectivePrice) || (body.sellingPrice === null) !== (body.effectivePrice === null)
      || applied === undefined || (body.sellingPrice === null && applied !== null)
      || typeof body.active !== 'boolean' || typeof body.requireValidation !== 'boolean'
      || !statuses.includes(body.status)) return undefined;
  return {
    id: body.id, kind: body.kind as ProductKind, name: body.name, brandName: body.brandName,
    genericName: body.genericName, dosageForm: body.dosageForm, manufacturer: body.manufacturer,
    categoryId: body.categoryId, categoryName: body.categoryName, saleUnit: body.saleUnit,
    sellingPrice: body.sellingPrice, mrp: body.mrp, active: body.active,
    requireValidation: body.requireValidation, status: body.status as ProductStatus,
    effectivePrice: body.effectivePrice, appliedDiscount: applied,
  };
}

function projectAppliedDiscount(body: unknown): AppliedDiscount | undefined {
  const discount = projectDiscountValue(body);
  if (!discount || !isRecord(body) || !isUuid(body.id) || !boundedText(body.targetName, 160) || !isMoney(body.saving)) return undefined;
  return { ...discount, id: body.id, targetName: body.targetName, saving: body.saving };
}

function projectChange(body: unknown): ProductChange | undefined {
  const derived = isRecord(body) && ['DISCOUNT_STARTED', 'DISCOUNT_ENDED'].includes(String(body.changeType));
  const discount = isRecord(body) && derived ? projectDiscountValue(body.discount) : null;
  if (!isRecord(body) || !isDate(body.occurredAt) || !isNullableText(body.actorUsername, 50)
      || !changeTypes.includes(body.changeType) || !isNullableMoney(body.oldSellingPrice)
      || !isNullableMoney(body.newSellingPrice) || !isNullableMoney(body.oldMrp)
      || !isNullableMoney(body.newMrp)
      || (derived ? !discount : body.discount !== null)
      || (body.changeType === 'PRICE_CHANGED' && body.newSellingPrice === null)
      || (body.changeType === 'REQUIRE_VALIDATION_CHANGED'
        && (typeof body.oldRequireValidation !== 'boolean' || typeof body.newRequireValidation !== 'boolean'))
      || (body.oldRequireValidation !== null && typeof body.oldRequireValidation !== 'boolean')
      || (body.newRequireValidation !== null && typeof body.newRequireValidation !== 'boolean')) return undefined;
  return {
    occurredAt: body.occurredAt, actorUsername: body.actorUsername,
    changeType: body.changeType as ProductChangeType, oldSellingPrice: body.oldSellingPrice,
    newSellingPrice: body.newSellingPrice, oldMrp: body.oldMrp, newMrp: body.newMrp,
    oldRequireValidation: body.oldRequireValidation, newRequireValidation: body.newRequireValidation,
    discount: discount!,
  };
}

export function projectProduct(body: unknown): Product | undefined {
  const summary = projectProductSummary(body);
  if (!summary || !isRecord(body) || !isNullableText(body.description, 4000)
      || !isCount(body.version) || !isDate(body.updatedAt)
      || !isNullableText(body.updatedByUsername, 50) || !Array.isArray(body.history)
      || body.history.length > 20) return undefined;
  const history = body.history.map(projectChange);
  if (history.some((entry) => !entry)) return undefined;
  return { ...summary, description: body.description, version: body.version,
    updatedAt: body.updatedAt, updatedByUsername: body.updatedByUsername, history: history as ProductChange[] };
}

/** Formats an already validated BDT decimal string without converting it to a JavaScript number. */
export function formatTaka(amount: string, symbol: string): string {
  const [whole, fraction] = amount.split('.');
  return `${symbol}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

/** Exact positive BDT minor units for form validation; prices never pass through floating point. */
export function moneyCents(value: string): bigint | 'format' | 'range' {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return 'format';
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (cents === 0n || cents > 999_999_999n) return 'range';
  return /^\d{1,7}(?:\.\d{1,2})?$/.test(value) ? cents : 'format';
}

export type CatalogSession = Pick<SessionClient, 'authenticatedFetch'>;
export type ProductDraft = {
  id: string; kind: ProductKind; name: string; brandName: string | null; genericName: string | null;
  dosageForm: string | null; manufacturer: string | null; categoryId: string; saleUnit: string;
  description: string | null; requireValidation: boolean;
};
export type ProductUpdate = Omit<ProductDraft, 'id' | 'kind'> & { active: boolean; version: number };
export type PricingUpdate = { sellingPrice: string; mrp: string | null; version: number };
export type ProductFilter = {
  q?: string; categoryId?: string; status?: ProductStatus; reviewRequired?: boolean; page?: number; size?: number;
};

export function newId(): string { return crypto.randomUUID(); }

function projectPage<T>(body: unknown, project: (value: unknown) => T | undefined, status: number): Page<T> {
  if (!isRecord(body) || !Array.isArray(body.items) || !isCount(body.page) || !isCount(body.size)
      || !isCount(body.totalItems) || body.size < 1 || body.size > 50 || body.items.length > body.size) {
    throw invalidResponse(status);
  }
  const items = body.items.map(project);
  if (items.some((entry) => !entry)) throw invalidResponse(status);
  return { items: items as T[], page: body.page, size: body.size, totalItems: body.totalItems };
}

async function readCatalogResponse<T>(response: Response, project: (body: unknown, status: number) => T): Promise<T> {
  if (!response.ok) throw await boundedError(response);
  return project(await readJsonResponse(response, 256 * 1024), response.status);
}

function record<T>(value: T | undefined, status: number): T {
  if (!value) throw invalidResponse(status);
  return value;
}

export function createCatalogClient(session: CatalogSession) {
  const request = <T>(path: string, init: RequestInit, project: (body: unknown, status: number) => T) =>
    session.authenticatedFetch(path, init, (response) => readCatalogResponse(response, project));
  const json = (method: 'POST' | 'PUT', body: unknown): RequestInit => ({
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const categories = (page: number, includeInactive: boolean, size: number) => request(
    `/api/staff/categories?includeInactive=${includeInactive}&page=${page}&size=${size}`,
    { method: 'GET' }, (body, status) => projectPage(body, projectCategory, status),
  );
  return {
    listCategories(page = 0, includeInactive = true, size = 20) { return categories(page, includeInactive, size); },
    async listCategoryOptions() {
      const all: Category[] = [];
      for (let page = 0; ; page += 1) {
        const result = await categories(page, false, 50);
        all.push(...result.items);
        if (result.items.length < 50) return all;
      }
    },
    createCategory(body: { id: string; name: string }) {
      return request('/api/staff/categories', json('POST', body), (data, status) => record(projectCategory(data), status));
    },
    updateCategory(id: string, body: { name: string; active: boolean; version: number }) {
      return request(`/api/staff/categories/${id}`, json('PUT', body), (data, status) => record(projectCategory(data), status));
    },
    listProducts(filter: ProductFilter = {}) {
      const params = new URLSearchParams();
      if (filter.q) params.set('q', filter.q);
      if (filter.categoryId) params.set('categoryId', filter.categoryId);
      if (filter.status) params.set('status', filter.status);
      if (filter.reviewRequired) params.set('reviewRequired', 'true');
      params.set('page', String(filter.page ?? 0)); params.set('size', String(filter.size ?? 20));
      return request(`/api/staff/products?${params}`, { method: 'GET' },
        (data, status) => projectPage(data, projectProductSummary, status));
    },
    loadProduct(id: string) {
      return request(`/api/staff/products/${id}`, { method: 'GET' },
        (data, status) => record(projectProduct(data), status));
    },
    createProduct(body: ProductDraft) {
      return request('/api/staff/products', json('POST', body),
        (data, status) => record(projectProduct(data), status));
    },
    updateProduct(id: string, body: ProductUpdate) {
      return request(`/api/staff/products/${id}`, json('PUT', body),
        (data, status) => record(projectProduct(data), status));
    },
    updatePricing(id: string, body: PricingUpdate) {
      return request(`/api/staff/products/${id}/pricing`, json('PUT', body),
        (data, status) => record(projectProduct(data), status));
    },
  };
}

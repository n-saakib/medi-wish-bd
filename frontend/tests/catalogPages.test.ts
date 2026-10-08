// @vitest-environment jsdom

import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductEditor } from '../src/catalog/ProductEditor';
import { ProductList } from '../src/catalog/ProductList';
import { CategoryManager } from '../src/catalog/CategoryManager';
import { ApiError } from '../src/lib/api';
import type { Category, Product, ProductDraft } from '../src/lib/catalog';
import type { SessionClient } from '../src/lib/session';
import { deferred, restoredStaff } from './fakeApi';
import { createSessionSource, renderWithSession, requiredElement, settle, setInputValue, submitForm,
  unmountAll } from './renderWithSession';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/staff/products/new' }));

const category = { id: '0b8e3f52-9c1a-4d67-a2e4-7f3b5c9d1e20', name: 'Pain relief',
  active: true, productCount: 1, version: 0 };
const product: Product = {
  id: '6c1d9a0e-2b7f-4e11-8d3a-5f0e9b2c7a14', kind: 'MEDICINE', name: 'Napa 500', brandName: 'Napa',
  genericName: 'Paracetamol', dosageForm: 'Tablet 500 mg', manufacturer: 'Beximco', categoryId: category.id,
  categoryName: category.name, saleUnit: 'Strip of 10 tablets', sellingPrice: '11.50', mrp: '12.00',
  active: true, requireValidation: false, status: 'ACTIVE', description: null, version: 2,
  updatedAt: '2026-09-27T11:00:00Z', updatedByUsername: 'owner.admin', history: [],
};

type Reply = (path: string, init: RequestInit) => Response | Promise<Response>;
function source(reply: Reply) {
  const requests: { path: string; init: RequestInit }[] = [];
  const authenticatedFetch: SessionClient['authenticatedFetch'] = async (path, init, read) => {
    requests.push({ path, init });
    return read(await reply(path, init));
  };
  return { requests, session: createSessionSource({ restoreSession: async () => restoredStaff('VERIFIED'), authenticatedFetch }) };
}

function fixture(role: 'ADMIN' | 'MODERATOR' = 'ADMIN', item = product, options = [category]): Reply {
  return (path) => {
    if (path.startsWith('/api/staff/categories?')) return Response.json({ items: options, page: 0, size: 50,
      totalItems: options.length });
    if (path === '/api/staff/me') return Response.json({ username: 'owner.admin', roles: [role], superAdmin: false });
    if (path === `/api/staff/products/${item.id}`) return Response.json(item);
    if (path.startsWith('/api/staff/products?')) return Response.json({ items: [item], page: 0, size: 20, totalItems: 1 });
    throw Error(`Unexpected request: ${path}`);
  };
}

beforeEach(() => router.replace.mockClear());
afterEach(unmountAll);

describe('Product editor', () => {
  it.each([
    ['ACTIVE', 'Active', 'chip chip-success'],
    ['NEEDS_PRICE', 'Needs price', 'chip chip-warn'],
    ['INACTIVE', 'Inactive', 'chip'],
  ] as const)('uses the design status tone in the %s product editor', async (status, label, tone) => {
    const item: Product = { ...product, status, active: status === 'ACTIVE',
      sellingPrice: status === 'NEEDS_PRICE' ? null : product.sellingPrice };
    const { session } = source(fixture('ADMIN', item));
    const page = await renderWithSession(createElement(ProductEditor, { productId: item.id }), session);
    const chip = requiredElement(page, '.catalog-heading .chip');
    expect(chip.textContent).toBe(label);
    expect(chip.className).toBe(tone);
  });

  it('names details edits and both review-flag directions in history', async () => {
    const event = { occurredAt: '2026-09-27T11:00:00Z', actorUsername: 'owner.admin',
      oldSellingPrice: null, newSellingPrice: null, oldMrp: null, newMrp: null };
    const withHistory: Product = { ...product, history: [
      { ...event, changeType: 'CATALOG_UPDATED', oldRequireValidation: false, newRequireValidation: false },
      { ...event, changeType: 'REQUIRE_VALIDATION_CHANGED', oldRequireValidation: false, newRequireValidation: true },
      { ...event, changeType: 'REQUIRE_VALIDATION_CHANGED', oldRequireValidation: true, newRequireValidation: false },
    ] };
    const { session } = source(fixture('ADMIN', withHistory));
    const page = await renderWithSession(createElement(ProductEditor, { productId: product.id }), session);
    const history = requiredElement(page, 'ol[aria-label="Change history"]').textContent;
    expect(history).toContain('Details edited by owner.admin');
    expect(history).toContain('Review flag turned on by owner.admin');
    expect(history).toContain('Review flag turned off by owner.admin');
  });

  it('shows each audit event time in Dhaka local time with its source instant', async () => {
    const withHistory: Product = { ...product, history: [{
      occurredAt: '2026-09-27T11:00:00Z', actorUsername: 'owner.admin', changeType: 'CREATED',
      oldSellingPrice: null, newSellingPrice: null, oldMrp: null, newMrp: null,
      oldRequireValidation: null, newRequireValidation: null,
    }] };
    const { session } = source(fixture('ADMIN', withHistory));
    const page = await renderWithSession(createElement(ProductEditor, { productId: product.id }), session);
    const time = requiredElement<HTMLTimeElement>(page, 'ol[aria-label="Change history"] time');
    expect(time.dateTime).toBe('2026-09-27T11:00:00Z');
    expect(time.textContent?.replace(/\u202f/g, ' ')).toContain('Sep 27, 2026, 5:00 PM');
  });

  it('shows retry instead of an incomplete new form when categories cannot load', async () => {
    const { session } = source(() => { throw new ApiError('REQUEST_FAILED', 0); });
    const page = await renderWithSession(createElement(ProductEditor), session);
    expect(page.querySelector('form')).toBeNull();
    expect(page.textContent).toContain('The request could not be completed.');
    expect(page.textContent).toContain('Try again');
  });

  it('shows only catalog and review fields before the first save', async () => {
    const { session } = source(fixture());
    const page = await renderWithSession(createElement(ProductEditor), session);
    expect(requiredElement(page, 'h1').textContent).toBe('New product');
    expect(page.querySelector('input#catalog-active')).toBeNull();
    expect(page.querySelector('[aria-label="Pricing"]')).toBeNull();
    expect(page.querySelector('[aria-label="Change history"]')).toBeNull();
    expect(requiredElement<HTMLSelectElement>(page, '#catalog-categoryId').options.length).toBe(2);
  });

  it('keeps the current inactive category and makes Moderator pricing read-only', async () => {
    const inactive = { ...category, active: false };
    const { session } = source(fixture('MODERATOR', product, []));
    const page = await renderWithSession(createElement(ProductEditor, { productId: product.id }), session);
    const select = requiredElement<HTMLSelectElement>(page, '#catalog-categoryId');
    expect(select.value).toBe(inactive.id);
    expect(select.options[1].textContent).toBe('Pain relief (inactive)');
    expect(requiredElement<HTMLInputElement>(page, '#catalog-mrp').disabled).toBe(true);
    expect(requiredElement<HTMLInputElement>(page, '#catalog-sellingPrice').disabled).toBe(true);
    expect(page.textContent).toContain('Moderators can’t change prices.');
    expect(page.textContent).not.toContain('Save pricing');
  });

  it('does not send a no-op catalog update', async () => {
    const { requests, session } = source(fixture());
    const page = await renderWithSession(createElement(ProductEditor, { productId: product.id }), session);
    await submitForm(page);
    expect(requests.filter(({ init }) => init.method === 'PUT')).toEqual([]);
  });

  it('validates required Medicine fields without sending a create request', async () => {
    const { requests, session } = source(fixture());
    const page = await renderWithSession(createElement(ProductEditor), session);
    await submitForm(page);
    for (const id of ['name', 'genericName', 'dosageForm', 'saleUnit', 'categoryId']) {
      expect(requiredElement(page, `#catalog-${id}`).getAttribute('aria-describedby')).toBe(`catalog-${id}-error`);
    }
    expect(document.activeElement).toBe(requiredElement(page, '#catalog-name'));
    expect(requests.filter(({ init }) => init.method === 'POST')).toEqual([]);
  });

  it('creates Equipment without Medicine-only, money or active fields', async () => {
    let body: Record<string, unknown> | null = null;
    const reply: Reply = (path, init) => {
      if (path === '/api/staff/products' && init.method === 'POST') {
        body = JSON.parse(String(init.body));
        return Response.json({ ...product, kind: 'EQUIPMENT', genericName: null, dosageForm: null,
          sellingPrice: null, mrp: null, active: false, status: 'NEEDS_PRICE', version: 0 });
      }
      return fixture()(path, init);
    };
    const { session } = source(reply);
    const page = await renderWithSession(createElement(ProductEditor), session);
    await act(async () => requiredElement<HTMLInputElement>(page, '#catalog-kind-equipment').click());
    setInputValue(page, '#catalog-name', 'Nebulizer');
    setInputValue(page, '#catalog-saleUnit', 'One device');
    await act(async () => {
      const select = requiredElement<HTMLSelectElement>(page, '#catalog-categoryId');
      select.value = category.id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await submitForm(page);
    expect(body).toMatchObject({ kind: 'EQUIPMENT', name: 'Nebulizer', categoryId: category.id,
      saleUnit: 'One device', genericName: null, dosageForm: null });
    expect(body && Object.keys(body)).not.toContain('active');
    expect(body && Object.keys(body)).not.toContain('sellingPrice');
    expect(body && Object.keys(body)).not.toContain('mrp');
    expect(router.replace).toHaveBeenCalledWith(`/staff/products/${product.id}`);
  });

  it('keeps the new-product draft available after a failed create', async () => {
    const reply: Reply = (path, init) => path === '/api/staff/products' && init.method === 'POST'
      ? Response.json({ code: 'REQUEST_FAILED' }, { status: 500 }) : fixture()(path, init);
    const { session } = source(reply);
    const page = await renderWithSession(createElement(ProductEditor), session);
    await act(async () => requiredElement<HTMLInputElement>(page, '#catalog-kind-equipment').click());
    setInputValue(page, '#catalog-name', 'Nebulizer');
    setInputValue(page, '#catalog-saleUnit', 'One device');
    await act(async () => {
      const select = requiredElement<HTMLSelectElement>(page, '#catalog-categoryId');
      select.value = category.id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await submitForm(page);
    expect(page.textContent).toContain('The request could not be completed.');
    expect(requiredElement<HTMLInputElement>(page, '#catalog-name').value).toBe('Nebulizer');
    expect(requiredElement(page, 'form')).toBeTruthy();
  });

  it.each(['identical', 'edited'] as const)('recovers a %s product create retry after its committed response is lost without duplication', async (retry) => {
    const records = new Map<string, { draft: ProductDraft; item: Product }>();
    const reply: Reply = (path, init) => {
      if (path === '/api/staff/products' && init.method === 'POST') {
        const body: ProductDraft = JSON.parse(String(init.body));
        const stored = records.get(body.id);
        if (stored) return JSON.stringify(stored.draft) === JSON.stringify(body)
          ? Response.json(stored.item)
          : Response.json({ code: 'ID_CONFLICT' }, { status: 409 });
        records.set(body.id, { draft: body, item: { ...product, ...body, sellingPrice: null, mrp: null,
          active: false, status: 'NEEDS_PRICE', version: 0 } });
        throw new TypeError('Synthetic lost response after commit');
      }
      return fixture()(path, init);
    };
    const { requests, session } = source(reply);
    const page = await renderWithSession(createElement(ProductEditor), session);
    await act(async () => requiredElement<HTMLInputElement>(page, '#catalog-kind-equipment').click());
    setInputValue(page, '#catalog-name', 'Nebulizer');
    setInputValue(page, '#catalog-saleUnit', 'One device');
    await act(async () => {
      const select = requiredElement<HTMLSelectElement>(page, '#catalog-categoryId');
      select.value = category.id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await submitForm(page);
    await settle();
    expect(page.textContent).toContain('The request could not be completed.');
    const firstId = [...records.keys()][0];
    expect(router.replace).not.toHaveBeenCalled();
    if (retry === 'edited') setInputValue(page, '#catalog-name', 'Edited nebulizer');
    await submitForm(page);
    await settle();
    expect(records.size).toBe(1);
    expect([...records.values()][0].item.name).toBe('Nebulizer');
    expect(requests.filter(({ init }) => init.method === 'POST').map(({ init }) => JSON.parse(String(init.body)).id))
      .toEqual([firstId, firstId]);
    if (retry === 'edited') {
      expect(page.textContent).toContain('The request could not be completed.');
      expect(requiredElement<HTMLInputElement>(page, '#catalog-name').value).toBe('Edited nebulizer');
      expect(router.replace).not.toHaveBeenCalled();
      const reload = [...page.querySelectorAll('button')].find((button) => button.textContent === 'Reload');
      expect(reload).toBeDefined();
      await act(async () => reload!.click());
    } else expect(page.textContent).toContain('Product saved.');
    expect(router.replace).toHaveBeenCalledWith(`/staff/products/${firstId}`);
  });
  it('uses the pricing response version for the following catalog save', async () => {
    let current = product;
    const bodies: { path: string; body: Record<string, unknown> }[] = [];
    const reply: Reply = (path, init) => {
      if (init.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        bodies.push({ path, body });
        current = { ...current, name: typeof body.name === 'string' ? body.name : current.name, version: current.version + 1 };
        return Response.json(current);
      }
      return fixture('ADMIN', current)(path, init);
    };
    const { session } = source(reply);
    const page = await renderWithSession(createElement(ProductEditor, { productId: product.id }), session);
    setInputValue(page, '#catalog-sellingPrice', '10.00');
    await act(async () => requiredElement<HTMLFormElement>(page, '[aria-label="Pricing"] form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    setInputValue(page, '#catalog-name', 'Napa updated');
    await submitForm(page);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ path: `/api/staff/products/${product.id}/pricing`, body: { version: 2 } });
    expect(bodies[1]).toMatchObject({ path: `/api/staff/products/${product.id}`, body: { version: 3, name: 'Napa updated' } });
    expect(bodies[1].body).not.toHaveProperty('sellingPrice');
    expect(bodies[1].body).not.toHaveProperty('kind');
  });

  it('shows stale state with reload after a rejected update', async () => {
    const reply: Reply = (path, init) => init.method === 'PUT'
      ? Response.json({ code: 'STALE_UPDATE' }, { status: 409 }) : fixture()(path, init);
    const { session } = source(reply);
    const page = await renderWithSession(createElement(ProductEditor, { productId: product.id }), session);
    setInputValue(page, '#catalog-name', 'Changed name');
    await submitForm(page);
    await settle();
    expect(page.textContent).toContain('Someone saved this product while you were editing.');
    expect(page.querySelector('button')?.textContent).toBeDefined();
    expect([...page.querySelectorAll('button')].some((button) => button.textContent === 'Reload')).toBe(true);
  });

  it.each([
    ['catalog', true], ['catalog', false], ['pricing', true], ['pricing', false],
  ] as const)('locks both forms during a pending %s save and restores drafts after success=%s', async (operation, succeeds) => {
    const held = deferred<Response>();
    const reply: Reply = (path, init) => init.method === 'PUT' ? held.promise : fixture()(path, init);
    const { session } = source(reply);
    const page = await renderWithSession(createElement(ProductEditor, { productId: product.id }), session);
    setInputValue(page, '#catalog-name', 'Catalog draft');
    setInputValue(page, '#catalog-sellingPrice', '10.00');
    const form = operation === 'pricing' ? requiredElement(page, '[aria-label="Pricing"]') : page;
    await submitForm(form);
    const controls = [...page.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
      'form input, form select, form textarea, form button')];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.disabled, control.id || control.textContent).toBe(true);
    const updated = { ...product, name: operation === 'catalog' ? 'Catalog draft' : product.name,
      sellingPrice: operation === 'pricing' ? '10.00' : product.sellingPrice, version: 3 };
    await act(async () => held.resolve(succeeds ? Response.json(updated)
      : Response.json({ code: 'REQUEST_FAILED' }, { status: 500 })));
    await settle();
    for (const control of controls) expect(control.disabled, control.id || control.textContent).toBe(false);
    expect(requiredElement<HTMLInputElement>(page, '#catalog-name').value).toBe('Catalog draft');
    expect(requiredElement<HTMLInputElement>(page, '#catalog-sellingPrice').value).toBe('10.00');
    expect(page.textContent).toContain(succeeds ? operation === 'pricing' ? 'Pricing saved.' : 'Product saved.'
      : 'The request could not be completed.');
  });

  it('holds new-product kind and draft controls during a failed create then allows correction', async () => {
    const held = deferred<Response>();
    const reply: Reply = (path, init) => path === '/api/staff/products' && init.method === 'POST'
      ? held.promise : fixture()(path, init);
    const { session } = source(reply);
    const page = await renderWithSession(createElement(ProductEditor), session);
    await act(async () => requiredElement<HTMLInputElement>(page, '#catalog-kind-equipment').click());
    setInputValue(page, '#catalog-name', 'Nebulizer');
    setInputValue(page, '#catalog-saleUnit', 'One device');
    await act(async () => {
      const select = requiredElement<HTMLSelectElement>(page, '#catalog-categoryId');
      select.value = category.id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await submitForm(page);
    const controls = [...page.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
      'form input, form select, form textarea, form button')];
    for (const control of controls) expect(control.disabled, control.id || control.textContent).toBe(true);
    await act(async () => held.resolve(Response.json({ code: 'REQUEST_FAILED' }, { status: 500 })));
    await settle();
    for (const control of controls) expect(control.disabled, control.id || control.textContent).toBe(false);
    expect(requiredElement<HTMLInputElement>(page, '#catalog-name').value).toBe('Nebulizer');
    expect(requiredElement<HTMLInputElement>(page, '#catalog-saleUnit').value).toBe('One device');
    expect(requiredElement<HTMLInputElement>(page, '#catalog-kind-equipment').checked).toBe(true);
    expect(page.textContent).toContain('The request could not be completed.');
  });

  it('sends one pricing request even with repeated submit while the first is pending', async () => {
    const held = deferred<Response>();
    const reply: Reply = (path, init) => path.endsWith('/pricing') && init.method === 'PUT'
      ? held.promise : fixture()(path, init);
    const { requests, session } = source(reply);
    const page = await renderWithSession(createElement(ProductEditor, { productId: product.id }), session);
    setInputValue(page, '#catalog-sellingPrice', '10.00');
    const pricingForm = requiredElement<HTMLFormElement>(page, '[aria-label="Pricing"] form');
    await act(async () => { pricingForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await act(async () => { pricingForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(requests.filter(({ path }) => path.endsWith('/pricing'))).toHaveLength(1);
    await act(async () => held.resolve(Response.json({ ...product, sellingPrice: '10.00', version: 3 })));
    await settle();
  });

  it('accepts exact positive whole and one-decimal BDT strings with mixed-scale MRP comparison', async () => {
    const prices: Record<string, unknown>[] = [];
    const reply: Reply = (path, init) => {
      if (path.endsWith('/pricing') && init.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        prices.push(body);
        return Response.json({ ...product, sellingPrice: '1.50', mrp: '2.00', version: 3 });
      }
      return fixture()(path, init);
    };
    const { session } = source(reply);
    const page = await renderWithSession(createElement(ProductEditor, { productId: product.id }), session);
    setInputValue(page, '#catalog-sellingPrice', '1.5');
    setInputValue(page, '#catalog-mrp', '2');
    await act(async () => requiredElement<HTMLFormElement>(page, '[aria-label="Pricing"] form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(prices).toEqual([{ sellingPrice: '1.5', mrp: '2', version: 2 }]);
    expect(page.textContent).toContain('Pricing saved.');
    setInputValue(page, '#catalog-sellingPrice', '1.5');
    setInputValue(page, '#catalog-mrp', '1.00');
    await act(async () => requiredElement<HTMLFormElement>(page, '[aria-label="Pricing"] form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(prices).toHaveLength(1);
    expect(requiredElement(page, '#catalog-sellingPrice-error').textContent).toBe('The selling price can’t be more than the MRP.');
  });

  it('clears the selling-price error after correcting only MRP and saving pricing', async () => {
    const reply: Reply = (path, init) => path.endsWith('/pricing') && init.method === 'PUT'
      ? Response.json({ ...product, sellingPrice: '13.00', mrp: '14.00', version: 3 }) : fixture()(path, init);
    const { requests, session } = source(reply);
    const page = await renderWithSession(createElement(ProductEditor, { productId: product.id }), session);
    const pricing = requiredElement(page, '[aria-label="Pricing"]');
    setInputValue(page, '#catalog-sellingPrice', '13.00');
    await submitForm(pricing);
    expect(requiredElement(page, '#catalog-sellingPrice-error').textContent).toBe('The selling price can’t be more than the MRP.');
    expect(requests.filter(({ init }) => init.method === 'PUT')).toEqual([]);
    setInputValue(page, '#catalog-mrp', '14.00');
    await submitForm(pricing);
    await settle();
    expect(page.textContent).toContain('Pricing saved.');
    expect(page.querySelector('#catalog-sellingPrice-error')).toBeNull();
    expect(requiredElement(page, '#catalog-sellingPrice').getAttribute('aria-invalid')).toBe('false');
    expect(requests.filter(({ init }) => init.method === 'PUT')).toHaveLength(1);
  });
  it('clears the activation price error after saving pricing while retaining the catalog draft', async () => {
    const unpriced: Product = { ...product, active: false, status: 'NEEDS_PRICE', sellingPrice: null, mrp: null };
    const priced: Product = { ...unpriced, sellingPrice: '10.00', status: 'INACTIVE', version: 3 };
    const reply: Reply = (path, init) => {
      if (path.endsWith('/pricing') && init.method === 'PUT') return Response.json(priced);
      if (path === '/api/staff/products/' + product.id && init.method === 'PUT')
        return Response.json({ ...priced, name: 'Catalog draft', active: true, status: 'ACTIVE', version: 4 });
      return fixture('ADMIN', unpriced)(path, init);
    };
    const { requests, session } = source(reply);
    const page = await renderWithSession(createElement(ProductEditor, { productId: product.id }), session);
    setInputValue(page, '#catalog-name', 'Catalog draft');
    await act(async () => requiredElement<HTMLInputElement>(page, '#catalog-active').click());
    await submitForm(page);
    expect(page.querySelector('#catalog-active-error')).not.toBeNull();
    expect(requests.filter(({ init }) => init.method === 'PUT')).toEqual([]);
    setInputValue(page, '#catalog-sellingPrice', '10.00');
    await submitForm(requiredElement(page, '[aria-label="Pricing"]'));
    await settle();
    expect(page.textContent).toContain('Pricing saved.');
    expect(page.querySelector('#catalog-active-error')).toBeNull();
    expect(requiredElement<HTMLInputElement>(page, '#catalog-name').value).toBe('Catalog draft');
    expect(requiredElement<HTMLInputElement>(page, '#catalog-active').checked).toBe(true);
    await submitForm(page);
    await settle();
    expect(page.textContent).toContain('Product saved.');
    expect(requests.filter(({ init }) => init.method === 'PUT')).toHaveLength(2);
  });
  it('rejects a zero selling price and zero MRP before sending pricing', async () => {
    const { requests, session } = source(fixture());
    const page = await renderWithSession(createElement(ProductEditor, { productId: product.id }), session);
    setInputValue(page, '#catalog-sellingPrice', '0.00');
    setInputValue(page, '#catalog-mrp', '0');
    await act(async () => requiredElement<HTMLFormElement>(page, '[aria-label="Pricing"] form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(requiredElement(page, '#catalog-sellingPrice-error').textContent).toBe('Enter an amount like 125.50.');
    expect(requiredElement(page, '#catalog-mrp-error').textContent).toBe('Enter an amount like 125.50.');
    expect(requests.filter(({ path }) => path.endsWith('/pricing'))).toEqual([]);
  });
});

describe('catalog lists', () => {
  it.each([[true, 'Active', 'chip chip-success'], [false, 'Inactive', 'chip']] as const)(
    'uses readable design tones for categories with active=%s', async (active, label, tone) => {
      const { session } = source(fixture('ADMIN', product, [{ ...category, active }]));
      const page = await renderWithSession(createElement(CategoryManager), session);
      const chip = requiredElement(page, 'tbody tr .chip');
      expect(chip.textContent).toBe(label);
      expect(chip.className).toBe(tone);
    });

  it.each([
    ['ACTIVE', 'Active', 'chip chip-success'],
    ['NEEDS_PRICE', 'Needs price', 'chip chip-warn'],
    ['INACTIVE', 'Inactive', 'chip'],
  ] as const)('uses the design tone and readable text for %s products', async (status, label, tone) => {
    const item: Product = { ...product, status, active: status === 'ACTIVE',
      sellingPrice: status === 'NEEDS_PRICE' ? null : product.sellingPrice, requireValidation: true };
    const { session } = source(fixture('ADMIN', item));
    const page = await renderWithSession(createElement(ProductList), session);
    const chips = [...requiredElement(page, 'tbody tr').querySelectorAll('.chip')];
    expect(chips.find((chip) => chip.textContent === label)?.className).toBe(tone);
    expect(chips.find((chip) => chip.textContent === 'Review')?.className).toBe('chip chip-info');
  });

  it('explains both unset amounts as Not set', async () => {
    const unpriced: Product = { ...product, sellingPrice: null, mrp: null, active: false, status: 'NEEDS_PRICE' };
    const { session } = source(fixture('ADMIN', unpriced));
    const page = await renderWithSession(createElement(ProductList), session);
    expect([...requiredElement(page, 'tbody tr').querySelectorAll('td')]
      .filter((cell) => cell.textContent === 'Not set')).toHaveLength(2);
    expect([...requiredElement<HTMLSelectElement>(page, '#product-status').options]
      .map((option) => option.textContent)).toEqual([
      'Any status', 'Active', 'Inactive', 'Needs price (not purchasable)',
    ]);
  });

  it.each([
    ['STALE_UPDATE', 409, 'This record changed after you opened it. Reload and try again.'],
    ['ACCESS_DENIED', 403, 'You don’t have permission to do that.'],
    ['NOT_FOUND', 404, 'This could not be found.'],
  ] as const)('uses the shared plan copy for %s', async (code, status, message) => {
    const { session } = source((path) => path.startsWith('/api/staff/categories?')
      ? Response.json({ items: [category], page: 0, size: 50, totalItems: 1 })
      : Response.json({ code }, { status }));
    const page = await renderWithSession(createElement(ProductList), session);
    expect(requiredElement(page, '[role="alert"]').textContent).toContain(message);
  });

  it.each(['products', 'categories'] as const)('keeps Previous available on an empty %s page after the total shrinks', async (kind) => {
    const { session } = source((path, init) => {
      if (path.startsWith(`/api/staff/${kind}?`)) {
        const page = Number(new URL(path, 'http://test').searchParams.get('page'));
        return Response.json({ items: page === 2 ? [] : [kind === 'products' ? product : category],
          page, size: 20, totalItems: page === 2 ? 40 : 41 });
      }
      return fixture()(path, init);
    });
    const page = await renderWithSession(createElement(kind === 'products' ? ProductList : CategoryManager), session);
    const button = (label: string) => [...page.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!;
    for (let count = 0; count < 2; count++) { await act(async () => button('Next').click()); await settle(); }
    expect(page.textContent).toContain(kind === 'products' ? 'No products on this page.' : 'No categories on this page.');
    expect(page.textContent).not.toContain('Showing');
    expect(button('Previous').disabled).toBe(false);
    expect(button('Next').disabled).toBe(true);
    await act(async () => button('Previous').click()); await settle();
    expect(page.textContent).toContain('Showing 21–21 of 41');
  });

  it('aligns product money headings and values with the design numeric columns', async () => {
    const { session } = source(fixture());
    const page = await renderWithSession(createElement(ProductList), session);
    expect([...page.querySelectorAll('thead th.num')].map((item) => item.textContent)).toEqual(['MRP', 'Price']);
    expect([...page.querySelectorAll('tbody td.num')].map((item) => item.textContent)).toEqual(['৳12.00', '৳11.50']);
  });

  it('renders the paged product table and price strings', async () => {
    const { session } = source(fixture());
    const page = await renderWithSession(createElement(ProductList), session);
    expect(requiredElement(page, 'tbody tr').textContent).toContain('৳11.50');
    expect(page.textContent).toContain('Showing 1–1 of 1');
    expect(requiredElement<HTMLAnchorElement>(page, `a[href="/staff/products/${product.id}"]`).textContent).toBe('Edit');
  });

  it('applies filters then pages without putting search data in the URL', async () => {
    const paths: string[] = [];
    const reply: Reply = (path, init) => {
      if (path.startsWith('/api/staff/products?')) {
        paths.push(path);
        const page = Number(new URL(path, 'http://test').searchParams.get('page'));
        return Response.json({ items: [product], page, size: 20, totalItems: 21 });
      }
      return fixture()(path, init);
    };
    const { session } = source(reply);
    const page = await renderWithSession(createElement(ProductList), session);
    setInputValue(page, '#product-search', 'Napa');
    await act(async () => {
      const select = requiredElement<HTMLSelectElement>(page, '#product-category');
      select.value = category.id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const status = requiredElement<HTMLSelectElement>(page, '#product-status');
      status.value = 'ACTIVE'; status.dispatchEvent(new Event('change', { bubbles: true }));
      requiredElement<HTMLInputElement>(page, 'input[type="checkbox"]').click();
    });
    await submitForm(page);
    expect(paths.at(-1)).toContain('q=Napa&categoryId=' + category.id + '&status=ACTIVE&reviewRequired=true&page=0');
    await act(async () => [...page.querySelectorAll('button')].find((button) => button.textContent === 'Next')!.click());
    await settle();
    expect(paths.at(-1)).toContain('page=1');
    expect(page.textContent).toContain('Showing 21–21 of 21');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('distinguishes an empty catalog from no filter matches and retries a failed read', async () => {
    let fail = false;
    const reply: Reply = (path, init) => {
      if (path.startsWith('/api/staff/products?')) return fail
        ? Response.json({ code: 'REQUEST_FAILED' }, { status: 500 })
        : Response.json({ items: [], page: 0, size: 20, totalItems: 0 });
      return fixture()(path, init);
    };
    const { session } = source(reply);
    const page = await renderWithSession(createElement(ProductList), session);
    expect(page.textContent).toContain('No products yet.');
    setInputValue(page, '#product-search', 'missing');
    await submitForm(page);
    expect(page.textContent).toContain('No products match these filters.');
    fail = true;
    await act(async () => requiredElement<HTMLFormElement>(page, 'form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(page.textContent).toContain('The request could not be completed.');
    fail = false;
    await act(async () => [...page.querySelectorAll('button')].find((button) => button.textContent === 'Try again')!.click());
    await settle();
    expect(page.textContent).toContain('No products match these filters.');
  });

  it('keeps a category name collision inline for correction', async () => {
    const reply: Reply = (path, init) => {
      if (path.startsWith('/api/staff/categories?')) return Response.json({ items: [category], page: 0, size: 20, totalItems: 1 });
      if (path === '/api/staff/categories' && init.method === 'POST')
        throw new ApiError('CATEGORY_NAME_TAKEN', 409);
      throw Error(path);
    };
    const { session } = source(reply);
    const page = await renderWithSession(createElement(CategoryManager), session);
    await act(async () => { [...page.querySelectorAll('button')].find((button) => button.textContent === 'Add category')!.click(); });
    setInputValue(page, '#category-name', 'Pain relief');
    await submitForm(page);
    await settle();
    expect(page.textContent).toContain('A category with this name already exists.');
    expect(requiredElement(page, '#category-name').getAttribute('aria-describedby')).toBe('category-name-error');
  });

  it.each(['identical', 'edited'] as const)('recovers a %s category create retry after its committed response is lost without duplication', async (retry) => {
    const records = new Map<string, Category>();
    let reads = 0;
    const reply: Reply = (path, init) => {
      if (path.startsWith('/api/staff/categories?')) {
        reads += 1;
        return Response.json({ items: [...records.values()], page: 0, size: 20, totalItems: records.size });
      }
      if (path === '/api/staff/categories' && init.method === 'POST') {
        const body: { id: string; name: string } = JSON.parse(String(init.body));
        const stored = records.get(body.id);
        if (stored) return stored.name === body.name ? Response.json(stored)
          : Response.json({ code: 'ID_CONFLICT' }, { status: 409 });
        records.set(body.id, { ...body, active: true, productCount: 0, version: 0 });
        throw new TypeError('Synthetic lost response after commit');
      }
      throw Error(path);
    };
    const { requests, session } = source(reply);
    const page = await renderWithSession(createElement(CategoryManager), session);
    await act(async () => [...page.querySelectorAll('button')].find((button) => button.textContent === 'Add category')!.click());
    setInputValue(page, '#category-name', 'Pain relief');
    await submitForm(page);
    await settle();
    expect(page.textContent).toContain('The request could not be completed.');
    const firstId = [...records.keys()][0];
    if (retry === 'edited') setInputValue(page, '#category-name', 'Pain and fever');
    await submitForm(page);
    await settle();
    expect(records.size).toBe(1);
    expect([...records.values()][0].name).toBe('Pain relief');
    expect(requests.filter(({ init }) => init.method === 'POST').map(({ init }) => JSON.parse(String(init.body)).id))
      .toEqual([firstId, firstId]);
    if (retry === 'edited') {
      expect(page.textContent).toContain('The request could not be completed.');
      expect(requiredElement<HTMLInputElement>(page, '#category-name').value).toBe('Pain and fever');
      expect(reads).toBe(1);
      const reload = [...page.querySelectorAll('button')].find((button) => button.textContent === 'Reload');
      expect(reload).toBeDefined();
      await act(async () => reload!.click());
      await settle();
    } else expect(page.textContent).toContain('Category saved.');
    expect(reads).toBe(2);
    expect(page.querySelector('#category-name')).toBeNull();
    expect(requiredElement(page, 'tbody').textContent).toContain('Pain relief');
  });
  it('sends category rename and status with the loaded version then reloads the current page', async () => {
    const paths: string[] = [];
    let body: Record<string, unknown> | null = null;
    const reply: Reply = (path, init) => {
      paths.push(path);
      if (init.method === 'PUT') {
        body = JSON.parse(String(init.body));
        return Response.json({ ...category, name: 'Pain and fever', active: false, version: 1 });
      }
      if (path.startsWith('/api/staff/categories?')) return Response.json({ items: [category], page: 0, size: 20, totalItems: 1 });
      throw Error(path);
    };
    const { session } = source(reply);
    const page = await renderWithSession(createElement(CategoryManager), session);
    await act(async () => [...page.querySelectorAll('button')].find((button) => button.textContent === 'Edit')!.click());
    setInputValue(page, '#category-name', 'Pain and fever');
    await act(async () => requiredElement<HTMLInputElement>(page, 'input[type="checkbox"]').click());
    await submitForm(page);
    expect(body).toEqual({ name: 'Pain and fever', active: false, version: 0 });
    expect(paths.filter((path) => path.startsWith('/api/staff/categories?'))).toHaveLength(2);
  });

  it('shows loading instead of an outdated category table while a successful save reloads', async () => {
    const refreshed = deferred<Response>();
    let lists = 0;
    const reply: Reply = (path, init) => {
      if (path.startsWith('/api/staff/categories?')) {
        lists += 1;
        return lists === 1 ? Response.json({ items: [category], page: 0, size: 20, totalItems: 1 }) : refreshed.promise;
      }
      if (init.method === 'PUT') return Response.json({ ...category, name: 'Renamed', version: 1 });
      return fixture()(path, init);
    };
    const { session } = source(reply);
    const page = await renderWithSession(createElement(CategoryManager), session);
    await act(async () => { [...page.querySelectorAll('button')].find(button => button.textContent === 'Edit')!.click(); });
    setInputValue(page, '#category-name', 'Renamed');
    await submitForm(page);
    await settle();
    expect(page.textContent).toContain('Category saved.');
    expect(page.querySelector('table')).toBeNull();
    await act(async () => refreshed.resolve(Response.json({ items: [{ ...category, name: 'Renamed', version: 1 }],
      page: 0, size: 20, totalItems: 1 })));
    await settle();
    expect(page.querySelector('table')?.textContent).toContain('Renamed');
  });

  it('keeps a stale category edit until Reload fetches the current page', async () => {
    let reads = 0;
    const reply: Reply = (path, init) => {
      if (path.startsWith('/api/staff/categories?')) { reads += 1;
        return Response.json({ items: [category], page: 0, size: 20, totalItems: 1 }); }
      if (init.method === 'PUT') return Response.json({ code: 'STALE_UPDATE' }, { status: 409 });
      throw Error(path);
    };
    const { session } = source(reply);
    const page = await renderWithSession(createElement(CategoryManager), session);
    await act(async () => [...page.querySelectorAll('button')].find((button) => button.textContent === 'Edit')!.click());
    setInputValue(page, '#category-name', 'Renamed');
    await submitForm(page);
    expect(page.textContent).toContain('Someone saved this category while you were editing.');
    expect(requiredElement<HTMLInputElement>(page, '#category-name').value).toBe('Renamed');
    await act(async () => [...page.querySelectorAll('button')].find((button) => button.textContent === 'Reload')!.click());
    await settle();
    expect(reads).toBe(2);
    expect(page.querySelector('#category-name')).toBeNull();
  });

  it('pages categories and refreshes the current page after a save', async () => {
    const reads: number[] = [];
    const reply: Reply = (path, init) => {
      if (path.startsWith('/api/staff/categories?')) {
        const page = Number(new URL(path, 'http://test').searchParams.get('page'));
        reads.push(page);
        return Response.json({ items: [category], page, size: 20, totalItems: 41 });
      }
      if (init.method === 'PUT') return Response.json({ ...category, name: 'Renamed', version: 1 });
      throw Error(path);
    };
    const { session } = source(reply);
    const page = await renderWithSession(createElement(CategoryManager), session);
    await act(async () => [...page.querySelectorAll('button')].find((button) => button.textContent === 'Next')!.click());
    await settle();
    expect(page.textContent).toContain('Showing 21–21 of 41');
    await act(async () => [...page.querySelectorAll('button')].find((button) => button.textContent === 'Edit')!.click());
    setInputValue(page, '#category-name', 'Renamed');
    await submitForm(page);
    expect(reads).toEqual([0, 1, 1]);
  });

  it('holds the category editor and page during a pending save so completion cannot close a newer draft', async () => {
    const held = deferred<Response>();
    const second = { ...category, id: '6c1d9a0e-2b7f-4e11-8d3a-5f0e9b2c7a14', name: 'Equipment' };
    const reply: Reply = (path, init) => {
      if (path.startsWith('/api/staff/categories?')) return Response.json({ items: [category, second],
        page: 0, size: 20, totalItems: 41 });
      if (init.method === 'PUT') return held.promise;
      throw Error(path);
    };
    const { session } = source(reply);
    const page = await renderWithSession(createElement(CategoryManager), session);
    const button = (label: string) => [...page.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!;
    await act(async () => button('Edit').click());
    setInputValue(page, '#category-name', 'Pain and fever');
    await submitForm(page);
    expect(requiredElement<HTMLInputElement>(page, '#category-name').disabled).toBe(true);
    for (const label of ['Add category', 'Cancel', 'Next']) {
      expect(button(label).disabled).toBe(true);
      await act(async () => button(label).click());
    }
    expect([...page.querySelectorAll('button')].filter((item) => item.textContent === 'Edit').every((item) => item.disabled)).toBe(true);
    expect(requiredElement<HTMLInputElement>(page, '#category-name').value).toBe('Pain and fever');
    await act(async () => held.resolve(Response.json({ ...category, name: 'Pain and fever', version: 1 })));
    await settle();
    expect(page.querySelector('#category-name')).toBeNull();
    expect(page.textContent).toContain('Category saved.');
  });
});

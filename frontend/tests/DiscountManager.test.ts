// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscountManager } from '../src/catalog/DiscountManager';
import { deferred, restoredStaff } from './fakeApi';
import { createSessionSource, renderWithSession, requiredElement, settle, setInputValue, submitForm, unmountAll } from './renderWithSession';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => '/staff/discounts' }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(unmountAll);
function source(role = 'ADMIN', fail = false) {
  const seen: string[] = [];
  const authenticatedFetch = async <T>(path: string, _: RequestInit, read: (response: Response) => Promise<T>) => {
    seen.push(path);
    if (path === '/api/staff/me') return read(Response.json({ username: 'admin.demo', roles: [role], superAdmin: false }));
    if (path.startsWith('/api/staff/discounts?')) {
      if (fail) { fail = false; throw Error('offline'); }
      return read(Response.json({ items: [], page: 0, size: 20, totalItems: 0, counts: { active: 6, scheduled: 2 } }));
    }
    if (path.startsWith('/api/staff/categories?')) return read(Response.json({ items: [], page: 0, size: 50, totalItems: 0 }));
    throw Error('unexpected');
  };
  return { seen, session: createSessionSource({ restoreSession: async () => restoredStaff('VERIFIED'), authenticatedFetch }) };
}
describe('Discount manager', () => {
  it('shows counts and switches to each tab with its own empty state', async () => {
    const api = source();
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    expect(page.textContent).toContain('Active 6');
    expect(page.textContent).toContain('Scheduled 2');
    expect(page.textContent).toContain('No active discounts.');
    await act(async () => requiredElement<HTMLButtonElement>(page, '[data-status="SCHEDULED"]').click());
    await settle();
    expect(page.textContent).toContain('No scheduled discounts.');
    expect(api.seen).toContain('/api/staff/discounts?status=SCHEDULED&page=0&size=20');
    await act(async () => requiredElement<HTMLButtonElement>(page, '[data-status="ENDED"]').click());
    await settle();
    expect(page.textContent).toContain('No ended discounts.');
    expect(requiredElement(page, '[data-status="ENDED"]').textContent).toBe('Ended');
  });
  it.each(['ACTIVE', 'SCHEDULED', 'ENDED'])('keeps the loaded %s page usable when its selected tab is clicked', async (status) => {
    const api = source();
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    const tab = requiredElement<HTMLButtonElement>(page, `[data-status="${status}"]`);
    act(() => tab.click()); await settle();
    const reads = api.seen.filter((path) => path.startsWith('/api/staff/discounts?'));
    act(() => { tab.click(); tab.click(); }); await settle();
    expect(tab.getAttribute('aria-pressed')).toBe('true');
    expect(page.textContent).toContain(`No ${status.toLowerCase()} discounts.`);
    expect(page.textContent).not.toContain('Loading discounts');
    expect(requiredElement<HTMLButtonElement>(page, '.catalog-heading button').disabled).toBe(false);
    expect(api.seen.filter((path) => path.startsWith('/api/staff/discounts?'))).toEqual(reads);
  });
  it.each(['ACTIVE', 'SCHEDULED', 'ENDED'])('settles a pending %s read despite repeated selected-tab clicks', async (status) => {
    const held = deferred<Response>();
    let reads = 0;
    const api = replies((path) => {
      if (path.includes(`status=${status}`)) { reads++; return held.promise; }
      return baseReply(path);
    });
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    const tab = requiredElement<HTMLButtonElement>(page, `[data-status="${status}"]`);
    act(() => tab.click()); await settle();
    expect(page.textContent).toContain('Loading discounts');
    act(() => { tab.click(); tab.click(); }); await settle();
    await act(async () => held.resolve(Response.json({ items: [], page: 0, size: 20, totalItems: 0,
      counts: { active: 0, scheduled: 0 } })));
    await settle();
    expect(reads).toBe(1);
    expect(page.textContent).toContain(`No ${status.toLowerCase()} discounts.`);
    expect(page.textContent).not.toContain('Loading discounts');
    expect(requiredElement<HTMLButtonElement>(page, '.catalog-heading button').disabled).toBe(false);
  });
  it.each([[0, false], [1, false], [21, false], [0, true], [1, true], [21, true]])(
    'keeps page-turn focus through a held response with total %s (user moves: %s)', async (totalItems, moves) => {
      const held = deferred<Response>();
      const api = replies((path) => {
        if (path.startsWith('/api/staff/discounts?')) {
          if (path.includes('page=1')) return held.promise;
          return Response.json({ items: [item], page: 0, size: 20, totalItems: 21,
            counts: { active: 21, scheduled: 0 } });
        }
        return baseReply(path);
      });
      const page = await renderWithSession(createElement(DiscountManager), api.session);
      const next = requiredElement<HTMLButtonElement>(page, '.catalog-pager button:last-child');
      act(() => { next.focus(); next.click(); }); await settle();
      const tab = requiredElement<HTMLButtonElement>(page, '[data-status="ACTIVE"]');
      expect(page.textContent).toContain('Loading discounts');
      expect(page.querySelector('table')).toBeNull();
      expect(document.activeElement).toBe(tab);
      expect(tab.disabled).toBe(false);
      const categories = requiredElement<HTMLAnchorElement>(page, '.catalog-heading a');
      if (moves) act(() => categories.focus());
      await act(async () => held.resolve(Response.json({ items: totalItems === 21 ? [item] : [],
        page: 1, size: 20, totalItems, counts: { active: totalItems, scheduled: 0 } })));
      await settle();
      if (totalItems === 0) {
        expect(page.textContent).toContain('No active discounts.');
        expect(page.querySelector('.catalog-pager')).toBeNull();
      } else {
        expect(requiredElement<HTMLButtonElement>(page, '.catalog-pager button:last-child').disabled).toBe(true);
        expect(requiredElement<HTMLButtonElement>(page, '.catalog-pager button:first-child').disabled).toBe(false);
      }
      expect(document.activeElement).toBe(moves ? categories : totalItems === 0 ? tab
        : requiredElement(page, '.catalog-pager button:first-child'));
    },
  );
  it('refuses a Moderator before discount reads', async () => {
    const api = source('MODERATOR');
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    expect(requiredElement(page, '[role="alert"]').textContent).toContain('You don’t have permission to do that.');
    expect(api.seen.filter((path) => path.startsWith('/api/staff/discounts'))).toEqual([]);
    expect(page.querySelector('table')).toBeNull();
  });
  it('recovers a failed list read through Retry', async () => {
    const api = source('ADMIN', true);
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    expect(page.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => requiredElement<HTMLButtonElement>(page, '[role="alert"] button').click());
    await settle();
    expect(page.querySelector('[role="alert"]')).toBeNull();
    expect(page.textContent).toContain('No active discounts.');
  });
  it('shows and focuses the first invalid field before any write; closing restores focus', async () => {
    const api = source();
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    const opener = requiredElement<HTMLButtonElement>(page, '.catalog-heading button');
    act(() => { opener.focus(); opener.click(); });
    await settle();
    const dialog = requiredElement<HTMLDialogElement>(page, 'dialog');
    await submitForm(dialog);
    await settle();
    expect(dialog.textContent).toContain('Choose a category or product.');
    expect(document.activeElement).toBe(requiredElement(dialog, '#discount-target'));
    act(() => requiredElement<HTMLButtonElement>(dialog, '[data-cancel]').click());
    await settle();
    expect(document.activeElement).toBe(opener);
  });
  it.each(['Cancel', 'Escape'])('restores the Edit opener after %s releases the native modal background', async (closing) => {
    const nativeFocus = HTMLElement.prototype.focus;
    const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      const modal = document.querySelector('dialog[open]');
      if (!modal || modal.contains(this)) nativeFocus.call(this, options);
    });
    try {
      const api = replies(baseReply);
      const page = await renderWithSession(createElement(DiscountManager), api.session);
      const opener = requiredElement<HTMLButtonElement>(page, 'tbody button');
      act(() => { opener.focus(); opener.click(); }); await settle();
      const dialog = requiredElement<HTMLDialogElement>(page, 'dialog');
      const cancel = requiredElement<HTMLButtonElement>(dialog, '[data-cancel]');
      act(() => {
        cancel.focus();
        if (closing === 'Cancel') cancel.click();
        else dialog.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }));
      }); await settle();
      expect(page.querySelector('dialog')).toBeNull();
      expect(document.activeElement).toBe(opener);
    } finally { focus.mockRestore(); }
  });
});

const category = { id: '22222222-2222-4222-8222-222222222222', name: 'Antibiotics', active: true, productCount: 2, version: 0 };
const item = { id: '11111111-1111-4111-8111-111111111111', targetType: 'CATEGORY', targetId: category.id,
  targetName: category.name, productCount: 2, kind: 'PERCENTAGE', value: '10', startsOn: '2026-01-01',
  endsOn: null, status: 'ACTIVE', version: 3, updatedAt: '2026-01-01T00:00:00Z', updatedByUsername: 'admin.demo' };
function replies(reply: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const authenticatedFetch = async <T>(path: string, init: RequestInit, read: (response: Response) => Promise<T>) => {
    if (init.method !== 'GET') writes.push({ path, body: JSON.parse(String(init.body)) });
    return read(await reply(path, init));
  };
  return { writes, session: createSessionSource({ restoreSession: async () => restoredStaff('VERIFIED'), authenticatedFetch }) };
}
function baseReply(path: string) {
  if (path === '/api/staff/me') return Response.json({ username: 'admin.demo', roles: ['ADMIN'], superAdmin: false });
  if (path.startsWith('/api/staff/categories?')) return Response.json({ items: [category], page: 0, size: 50, totalItems: 1 });
  return Response.json({ items: [item], page: 0, size: 20, totalItems: 1, counts: { active: 1, scheduled: 0 } });
}
function select(container: ParentNode, selector: string, value: string) {
  act(() => { const field = requiredElement<HTMLSelectElement>(container, selector); field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function newDialog(page: HTMLElement) {
  act(() => requiredElement<HTMLButtonElement>(page, '.catalog-heading button').click());
  await settle();
  return requiredElement<HTMLDialogElement>(page, 'dialog');
}
describe('Discount commands and recovery', () => {
  it('uses the enabled status tab when an unknown create closes and disables its opener', async () => {
    const api = replies((path, init) => {
      if (init.method === 'POST') throw Error('lost response');
      return baseReply(path);
    });
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    const dialog = await newDialog(page);
    select(dialog, '#discount-target', category.id); setInputValue(dialog, '#discount-value', '10');
    await submitForm(dialog); await settle();
    act(() => requiredElement<HTMLButtonElement>(dialog, '[data-cancel]').click()); await settle();
    expect(dialog.open).toBe(false);
    expect(requiredElement<HTMLButtonElement>(page, '.catalog-heading button').disabled).toBe(true);
    expect(document.activeElement).toBe(requiredElement(page, '[data-status="ACTIVE"]'));
    expect(api.writes).toHaveLength(1);
  });
  it('keeps focus in the dialog when entering or cancelling End confirmation', async () => {
    const api = replies(baseReply);
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    act(() => requiredElement<HTMLButtonElement>(page, 'tbody button').click()); await settle();
    const dialog = requiredElement<HTMLDialogElement>(page, 'dialog');
    const end = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'End now')!;
    act(() => { end.focus(); end.click(); });
    expect(document.activeElement).toBe(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Confirm'));
    const cancel = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!;
    act(() => { cancel.focus(); cancel.click(); });
    expect(document.activeElement).toBe(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'End now'));
    expect(dialog.open).toBe(true);
    expect(api.writes).toEqual([]);
  });
  it.each(['create category', 'create product', 'edit', 'end confirmation'])('wraps keyboard focus inside the %s dialog without closing it', async (mode) => {
    const api = replies((path) => path.startsWith('/api/staff/products?')
      ? Response.json({ items: [], page: 0, size: 20, totalItems: 0 }) : baseReply(path));
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    const opener = requiredElement<HTMLButtonElement>(page, mode.startsWith('create') ? '.catalog-heading button' : 'tbody button');
    act(() => { opener.focus(); opener.click(); }); await settle();
    const dialog = requiredElement<HTMLDialogElement>(page, 'dialog');
    if (mode === 'create product') {
      act(() => requiredElement<HTMLInputElement>(dialog, 'input[name="targetType"]:not(:checked)').click()); await settle();
    }
    if (mode === 'end confirmation') {
      act(() => Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'End now')!.click());
    }
    const first = requiredElement<HTMLElement>(dialog, mode.startsWith('create') ? 'input[name="targetType"]:checked' : '#discount-kind');
    const last = mode === 'edit'
      ? Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'End now')!
      : Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!;
    const backwards = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    act(() => { first.focus(); first.dispatchEvent(backwards); });
    expect(backwards.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    const forwards = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => last.dispatchEvent(forwards));
    expect(forwards.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(dialog.open).toBe(true);
    expect(api.writes).toEqual([]);
  });
  it.each(['create', 'update', 'end'])('keeps keyboard focus on the active tab after %s while the list reloads', async (command) => {
    const refreshed = deferred<Response>();
    let saved = false;
    const api = replies((path, init) => {
      if (init.method !== 'GET') {
        saved = true;
        return Response.json({ ...item, ...JSON.parse(String(init.body)), status: command === 'end' ? 'ENDED' : 'ACTIVE' });
      }
      if (saved && path.startsWith('/api/staff/discounts?')) return refreshed.promise;
      return baseReply(path);
    });
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    const opener = requiredElement<HTMLButtonElement>(page, command === 'create' ? '.catalog-heading button' : 'tbody button');
    act(() => { opener.focus(); opener.click(); }); await settle();
    const dialog = requiredElement<HTMLDialogElement>(page, 'dialog');
    if (command === 'create') {
      select(dialog, '#discount-target', category.id); setInputValue(dialog, '#discount-value', '10');
    }
    if (command === 'end') {
      act(() => Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'End now')!.click());
      act(() => Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Confirm')!.click());
    } else await submitForm(dialog);
    await settle();
    const activeTab = requiredElement<HTMLButtonElement>(page, '[data-status="ACTIVE"]');
    expect(page.querySelector('dialog')).toBeNull();
    expect(page.textContent).toContain('Discount saved.');
    expect(document.activeElement).toBe(activeTab);
    expect(activeTab.disabled).toBe(false);
    await act(async () => refreshed.resolve(Response.json({ items: [], page: 0, size: 20, totalItems: 0,
      counts: { active: 0, scheduled: 0 } })));
    await settle();
    expect(document.activeElement).toBe(activeTab);
  });
  it('freezes an ambiguous create and retries exactly the same id and fields; success refreshes counts', async () => {
    let committed = false;
    const api = replies((path, init) => {
      if (init.method === 'POST') {
        if (!committed) { committed = true; throw Error('lost response'); }
        return Response.json({ ...item, ...JSON.parse(String(init.body)) });
      }
      if (committed && path.startsWith('/api/staff/discounts?')) return Response.json({ items: [item], page: 0, size: 20,
        totalItems: 1, counts: { active: 2, scheduled: 1 } });
      return baseReply(path);
    });
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    const dialog = await newDialog(page);
    select(dialog, '#discount-target', category.id); setInputValue(dialog, '#discount-value', '10');
    await submitForm(dialog); await settle();
    expect(dialog.textContent).toContain('The save outcome is unknown.');
    expect(requiredElement<HTMLInputElement>(dialog, '#discount-value').disabled).toBe(true);
    await submitForm(dialog); await settle();
    expect(api.writes).toHaveLength(2);
    expect(api.writes[1]).toEqual(api.writes[0]);
    expect(page.querySelector('dialog')).toBeNull();
    expect(page.textContent).toContain('Active 2');
    expect(page.textContent).toContain('Scheduled 1');
  });
  it('retains a scheduled unknown create across cancellation and an unrelated active refresh', async () => {
    let unknown = false;
    const api = replies((path, init) => {
      if (init.method === 'POST') {
        if (!unknown) { unknown = true; throw Error('lost response'); }
        return Response.json({ ...item, ...JSON.parse(String(init.body)), status: 'SCHEDULED' });
      }
      if (unknown && path.startsWith('/api/staff/discounts?')) throw Error('offline');
      return baseReply(path);
    });
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    const dialog = await newDialog(page);
    select(dialog, '#discount-target', category.id); setInputValue(dialog, '#discount-value', '10');
    setInputValue(dialog, '#discount-starts', '2099-01-01');
    await submitForm(dialog); await settle();
    act(() => requiredElement<HTMLButtonElement>(dialog, '[data-cancel]').click()); await settle();
    expect(requiredElement<HTMLButtonElement>(page, '.catalog-heading button').disabled).toBe(true);
    // The active page does not contain the scheduled create and cannot prove its outcome.
    const original = api.writes[0];
    expect(dialog.open).toBe(false);
    unknown = false;
    act(() => requiredElement<HTMLButtonElement>(page, '[role="alert"] button').click()); await settle();
    expect(requiredElement<HTMLButtonElement>(page, '.catalog-heading button').disabled).toBe(true);
    expect(requiredElement<HTMLButtonElement>(page, 'tbody button').disabled).toBe(true);
    act(() => Array.from(page.querySelectorAll('button')).find((button) => button.textContent === 'Retry pending discount')!.click());
    await settle();
    expect(requiredElement<HTMLDialogElement>(page, 'dialog')).toBe(dialog);
    expect(dialog.open).toBe(true);
    expect(requiredElement<HTMLInputElement>(dialog, '#discount-starts').value).toBe('2099-01-01');
    expect(requiredElement<HTMLInputElement>(dialog, '#discount-value').disabled).toBe(true);
    unknown = true;
    await submitForm(dialog); await settle();
    expect(api.writes).toEqual([original, original]);
    expect(page.querySelector('dialog')).toBeNull();
  });
  it.each([
    { type: 'CATEGORY', fails: false, moves: false }, { type: 'CATEGORY', fails: false, moves: true },
    { type: 'CATEGORY', fails: true, moves: false }, { type: 'CATEGORY', fails: true, moves: true },
    { type: 'PRODUCT', fails: false, moves: false }, { type: 'PRODUCT', fails: false, moves: true },
    { type: 'PRODUCT', fails: true, moves: false }, { type: 'PRODUCT', fails: true, moves: true },
  ])('keeps picker Retry focus for $type (fails: $fails, user moves: $moves)', async ({ type, fails, moves }) => {
    const held = deferred<Response>();
    let pickerReads = 0;
    const api = replies((path) => {
      if (path.startsWith(type === 'CATEGORY' ? '/api/staff/categories?' : '/api/staff/products?')) {
        pickerReads++;
        if (pickerReads === 1) throw Error('offline');
        return held.promise;
      }
      return baseReply(path);
    });
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    const dialog = await newDialog(page);
    if (type === 'PRODUCT') {
      act(() => requiredElement<HTMLInputElement>(dialog, 'input[name="targetType"]:not(:checked)').click()); await settle();
    }
    const retry = requiredElement<HTMLButtonElement>(dialog, '[role="alert"] button');
    act(() => { retry.focus(); retry.click(); }); await settle();
    const selectedType = requiredElement<HTMLInputElement>(dialog, 'input[name="targetType"]:checked');
    expect(selectedType.parentElement?.textContent).toBe(type === 'CATEGORY' ? 'Category' : 'One product');
    expect(selectedType.matches(':disabled')).toBe(false);
    expect(document.activeElement).toBe(selectedType);
    expect(retry.isConnected).toBe(false);
    expect(dialog.querySelector('[role="alert"]')).toBeNull();
    expect(dialog.textContent).toContain('Loading categories or products…');
    expect(requiredElement<HTMLSelectElement>(dialog, '#discount-target').disabled).toBe(true);
    const value = requiredElement<HTMLInputElement>(dialog, '#discount-value');
    if (moves) act(() => value.focus());
    await act(async () => {
      if (fails) held.reject(Error('retry offline'));
      else held.resolve(type === 'CATEGORY' ? baseReply('/api/staff/categories?') : Response.json({ items: [{
        id: '33333333-3333-4333-8333-333333333333', kind: 'MEDICINE', name: 'Synthetic product',
        brandName: null, genericName: null, dosageForm: null, manufacturer: null,
        categoryId: category.id, categoryName: category.name, saleUnit: 'tablet', sellingPrice: '10.00',
        mrp: null, effectivePrice: '10.00', appliedDiscount: null, active: true, requireValidation: false, status: 'ACTIVE',
      }], page: 0, size: 20, totalItems: 1 }));
    }); await settle();
    expect(document.activeElement).toBe(moves ? value : selectedType);
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).not.toContain('Loading categories or products…');
    expect(pickerReads).toBe(2);
    const target = requiredElement<HTMLSelectElement>(dialog, '#discount-target');
    expect(target.disabled).toBe(fails);
    if (fails) {
      expect(requiredElement(dialog, '[role="alert"]').textContent).toContain('The request could not be completed.');
      expect(requiredElement<HTMLButtonElement>(dialog, '[role="alert"] button').disabled).toBe(false);
      expect(target.options.length).toBe(1);
    } else {
      expect(dialog.querySelector('[role="alert"]')).toBeNull();
      expect(target.options[1].textContent).toBe(type === 'CATEGORY' ? category.name : 'Synthetic product');
    }
    expect(api.writes).toEqual([]);
  });
  it('recovers a failed category picker without submitting an empty target', async () => {
    let failed = false;
    const api = replies((path) => {
      if (path.startsWith('/api/staff/categories?') && !failed) { failed = true; throw Error('offline'); }
      return baseReply(path);
    });
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    const dialog = await newDialog(page);
    expect(requiredElement<HTMLSelectElement>(dialog, '#discount-target').disabled).toBe(true);
    act(() => requiredElement<HTMLButtonElement>(dialog, '[role="alert"] button').click()); await settle();
    expect(requiredElement<HTMLSelectElement>(dialog, '#discount-target').disabled).toBe(false);
    expect(dialog.textContent).toContain('Antibiotics');
    expect(api.writes).toEqual([]);
  });
  it.each([
    ['STALE_UPDATE', 'This record changed after you opened it. Reload and try again.'],
    ['DISCOUNT_ENDED', 'This discount has ended and can no longer be changed.'],
    ['DISCOUNT_EXCEEDS_PRICE', "The discount must be smaller than the product's selling price."],
  ])('shows the bounded %s error when editing', async (code, text) => {
    const api = replies((path, init) => init.method === 'PUT' ? Response.json({ code }, { status: 409 }) : baseReply(path));
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    act(() => requiredElement<HTMLButtonElement>(page, 'tbody button').click()); await settle();
    const dialog = requiredElement<HTMLDialogElement>(page, 'dialog');
    await submitForm(dialog); await settle();
    expect(dialog.textContent).toContain(text);
    if (code === 'STALE_UPDATE') {
      act(() => Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Reload')!.click()); await settle();
      expect(page.querySelector('dialog')).toBeNull();
    }
  });
  it.each(['update', 'end'])('reloads a stale %s without announcing a save and uses the refreshed version', async (command) => {
    const refreshed = deferred<Response>();
    let rejected = false;
    let listReads = 0;
    const api = replies((path, init) => {
      if (init.method !== 'GET') {
        rejected = true;
        return Response.json({ code: 'STALE_UPDATE' }, { status: 409 });
      }
      if (path.startsWith('/api/staff/discounts?')) {
        listReads++;
        if (rejected) return refreshed.promise;
      }
      return baseReply(path);
    });
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    act(() => requiredElement<HTMLButtonElement>(page, 'tbody button').click()); await settle();
    const dialog = requiredElement<HTMLDialogElement>(page, 'dialog');
    if (command === 'end') {
      act(() => Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'End now')!.click());
      act(() => Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Confirm')!.click());
    } else {
      setInputValue(dialog, '#discount-value', '12');
      await submitForm(dialog);
    }
    await settle();
    expect(dialog.textContent).toContain('This record changed after you opened it. Reload and try again.');
    expect(api.writes).toHaveLength(1);
    const reloadButton = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Reload')!;
    act(() => { reloadButton.focus(); reloadButton.click(); }); await settle();
    const activeTab = requiredElement<HTMLButtonElement>(page, '[data-status="ACTIVE"]');
    expect(page.querySelector('dialog')).toBeNull();
    expect(page.textContent).not.toContain('Discount saved.');
    expect(page.textContent).toContain('Loading discounts');
    expect(listReads).toBe(2);
    expect(document.activeElement).toBe(activeTab);
    expect(activeTab.disabled).toBe(false);
    await act(async () => refreshed.resolve(Response.json({ items: [{ ...item, value: '17', version: 4 }],
      page: 0, size: 20, totalItems: 1, counts: { active: 2, scheduled: 1 } })));
    await settle();
    expect(page.textContent).toContain('17%');
    expect(page.textContent).toContain('Active 2');
    expect(page.textContent).toContain('Scheduled 1');
    expect(page.textContent).not.toContain('Discount saved.');
    expect(document.activeElement).toBe(activeTab);
    act(() => requiredElement<HTMLButtonElement>(page, 'tbody button').click()); await settle();
    const reopened = requiredElement<HTMLDialogElement>(page, 'dialog');
    expect(requiredElement<HTMLInputElement>(reopened, '#discount-value').value).toBe('17');
    setInputValue(reopened, '#discount-value', '18'); await submitForm(reopened); await settle();
    expect(api.writes).toHaveLength(2);
    expect(api.writes[1].body.version).toBe(4);
  });
  it('confirms End now once and refreshes the counts after success', async () => {
    let ended = false;
    const api = replies((path, init) => {
      if (init.method === 'POST') { ended = true; return Response.json({ ...item, status: 'ENDED' }); }
      if (ended && path.startsWith('/api/staff/discounts?')) return Response.json({ items: [], page: 0, size: 20,
        totalItems: 0, counts: { active: 0, scheduled: 0 } });
      return baseReply(path);
    });
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    act(() => requiredElement<HTMLButtonElement>(page, 'tbody button').click()); await settle();
    const dialog = requiredElement<HTMLDialogElement>(page, 'dialog');
    act(() => Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'End now')!.click());
    expect(api.writes).toEqual([]);
    expect(dialog.textContent).toContain('End this discount now?');
    act(() => Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Confirm')!.click()); await settle();
    expect(api.writes).toEqual([{ path: `/api/staff/discounts/${item.id}/end`, body: { version: 3 } }]);
    expect(page.textContent).toContain('Active 0');
  });
  it.each([
    ['value', '', 'Enter a discount value.'], ['value', '100', 'Enter a whole percentage from 1 to 99.'],
    ['starts', '', 'Choose a start date.'], ['starts', '2020-01-01', 'Choose today or a later date.'],
    ['ends', '2020-01-01', 'The end date can’t be before the start date or today.'],
  ])('focuses the invalid %s field (%s) without a write', async (field, value, text) => {
    const api = replies(baseReply);
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    const dialog = await newDialog(page);
    select(dialog, '#discount-target', category.id); setInputValue(dialog, '#discount-value', '10');
    setInputValue(dialog, `#discount-${field}`, value);
    await submitForm(dialog); await settle();
    expect(dialog.textContent).toContain(text);
    expect(document.activeElement).toBe(requiredElement(dialog, `#discount-${field}`));
    expect(api.writes).toEqual([]);
  });
  it('refuses an end date before today when editing an already started discount', async () => {
    const api = replies(baseReply);
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    act(() => requiredElement<HTMLButtonElement>(page, 'tbody button').click()); await settle();
    const dialog = requiredElement<HTMLDialogElement>(page, 'dialog');
    expect(requiredElement<HTMLInputElement>(dialog, '#discount-starts').disabled).toBe(true);
    setInputValue(dialog, '#discount-ends', '2026-01-02');
    await submitForm(dialog); await settle();
    expect(document.activeElement).toBe(requiredElement(dialog, '#discount-ends'));
    expect(api.writes).toEqual([]);
  });
  it('ignores an older tab response after the user moves to Scheduled', async () => {
    const held = deferred<Response>();
    const api = replies((path) => path.includes('status=ACTIVE') ? held.promise : baseReply(path));
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    act(() => requiredElement<HTMLButtonElement>(page, '[data-status="SCHEDULED"]').click()); await settle();
    await act(async () => held.resolve(Response.json({ items: [], page: 0, size: 20, totalItems: 0, counts: { active: 99, scheduled: 99 } })));
    await settle();
    expect(page.textContent).toContain('Active 1');
    expect(page.textContent).not.toContain('99');
  });
});
describe('Discount picker and projection boundaries', () => {
  it.each([{ targetType: ['PRODUCT'] }, { kind: ['FLAT'] }, { status: ['ACTIVE'] }])(
    'shows enum arrays as an invalid response and recovers through Retry %j', async (change) => {
      let malformed = true;
      const valid = { ...item, targetType: 'PRODUCT', productCount: null, kind: 'FLAT', value: '1.00' };
      const api = replies((path) => {
        if (!path.startsWith('/api/staff/discounts?')) return baseReply(path);
        const response = Response.json({ items: [malformed ? { ...valid, ...change } : valid],
          page: 0, size: 20, totalItems: 1, counts: { active: 1, scheduled: 0 } });
        malformed = false;
        return response;
      });
      const page = await renderWithSession(createElement(DiscountManager), api.session);
      expect(requiredElement(page, '[role="alert"]').textContent).toContain('The service returned an invalid response.');
      expect(page.querySelector('table')).toBeNull();
      act(() => requiredElement<HTMLButtonElement>(page, '[role="alert"] button').click()); await settle();
      expect(page.querySelector('[role="alert"]')).toBeNull();
      expect(requiredElement(page, 'tbody').textContent).toContain(item.targetName);
      expect(api.writes).toHaveLength(0);
    },
  );
  it('shows a malformed list projection as an invalid response with Retry', async () => {
    const api = replies((path) => path.startsWith('/api/staff/discounts?')
      ? Response.json({ items: [item], page: 0, size: 20, totalItems: 1 }) : baseReply(path));
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    expect(page.textContent).toContain('The service returned an invalid response.');
    expect(page.querySelector('table')).toBeNull();
    expect(requiredElement(page, '[role="alert"] button').textContent).toBe('Try again');
  });
  it.each([['1.234', 'Enter an amount like 125.50.'], ['0', 'Enter an amount from 0.01 to 9,999,999.99.']])(
    'validates the flat amount %s before writing', async (value, shown) => {
      const api = replies(baseReply);
      const page = await renderWithSession(createElement(DiscountManager), api.session);
      const dialog = await newDialog(page);
      select(dialog, '#discount-target', category.id); select(dialog, '#discount-kind', 'FLAT');
      setInputValue(dialog, '#discount-value', value); await submitForm(dialog); await settle();
      expect(dialog.textContent).toContain(shown);
      expect(document.activeElement).toBe(requiredElement(dialog, '#discount-value'));
      expect(api.writes).toEqual([]);
    },
  );
  it('ignores obsolete product search responses', async () => {
    const older = deferred<Response>();
    const api = replies((path) => {
      if (path.startsWith('/api/staff/products?')) {
        if (path.includes('q=old')) return older.promise;
        return Response.json({ items: [], page: 0, size: 20, totalItems: 0 });
      }
      return baseReply(path);
    });
    const page = await renderWithSession(createElement(DiscountManager), api.session);
    const dialog = await newDialog(page);
    act(() => requiredElement<HTMLInputElement>(dialog, 'input[name="targetType"]:not(:checked)').click()); await settle();
    setInputValue(dialog, '#discount-search', 'old'); await settle();
    setInputValue(dialog, '#discount-search', 'new'); await settle();
    await act(async () => older.resolve(Response.json({ items: [{ invalid: true }], page: 0, size: 20, totalItems: 1 })));
    await settle();
    expect(dialog.textContent).not.toContain('invalid response');
    expect(requiredElement<HTMLSelectElement>(dialog, '#discount-target').disabled).toBe(false);
    expect(requiredElement<HTMLSelectElement>(dialog, '#discount-target').options.length).toBe(1);
  });
});

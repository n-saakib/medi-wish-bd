// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AddressBook } from '../src/account/AddressBook';
import { restoredCustomer } from './fakeApi';
import { createSessionSource, renderWithSession, unmountAll } from './renderWithSession';
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => '/account/addresses' }));
beforeEach(() => { Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } }); Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } }); });
afterEach(unmountAll);
it('shows the empty address book and its add action', async () => {
  const source = createSessionSource({ restoreSession: vi.fn().mockResolvedValue(restoredCustomer), authenticatedFetch: async (_path, _init, read) => read(Response.json({ accountState: 'ACTIVE', limit: 3, changeAllowance: { perWeek: 5, perMonth: 10, remainingThisWeek: 5, remainingThisMonth: 10 }, items: [] })) });
  const view = await renderWithSession(createElement(AddressBook), source);
  expect(view.textContent).toContain('No saved addresses yet.');
  expect(view.querySelector('button.empty-slot')?.textContent).toBe('Add address');
});

const saved = { id: '4c1f6f1e-6f3c-4a9e-9d62-0b8f7f3b2a11', label: 'Home', recipientName: 'Rahim Uddin', mobile: '01711000000', addressLine: 'House 12, Road 5', city: 'Dhaka', isDefault: true, version: 0 };
const emptyBook = { accountState: 'ACTIVE', limit: 3, changeAllowance: { perWeek: 7, perMonth: 12, remainingThisWeek: 2, remainingThisMonth: 6 }, items: [] as typeof saved[] };
async function mount(answer: (method: string, body: string) => Response | Promise<Response>) {
  const calls: { method: string; body: string }[] = [];
  const source = createSessionSource({ restoreSession: vi.fn().mockResolvedValue(restoredCustomer), authenticatedFetch: async (_path, init, read) => { const call = { method: String(init.method), body: String(init.body ?? '') }; calls.push(call); return read(await answer(call.method, call.body)); } });
  return { view: await renderWithSession(createElement(AddressBook), source), calls };
}
async function click(view: HTMLElement, text: string) { const { act } = await import('react'); await act(async () => { const button = [...view.querySelectorAll('button')].find((element) => element.textContent === text); if (!button) throw new Error(`Missing ${text}`); button.click(); }); }
async function fill(view: HTMLElement) { const { setInputValue } = await import('./renderWithSession'); for (const [field, value] of Object.entries({ label: 'Home', recipientName: 'Rahim Uddin', mobile: '01711000000', addressLine: 'House 12, Road 5', city: 'Dhaka' })) setInputValue(view, `#address-${field}`, value); }
async function save(view: HTMLElement) { const { act } = await import('react'); await act(async () => view.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
it('announces server allowance every opening; first default is fixed and invalid fields send nothing', async () => {
  const { view, calls } = await mount(() => Response.json(emptyBook));
  await click(view, 'Add address');
  expect(view.querySelector('dialog')?.getAttribute('aria-describedby')).toBe('address-change-notice');
  expect(view.querySelector('#address-change-notice')?.textContent).toContain('7 per week (Mon–Sun) and 12 per calendar month');
  expect(view.querySelector('#address-change-notice')?.textContent).toContain('Left: 2 this week, 6 this month.');
  const checkbox = view.querySelector<HTMLInputElement>('input[type=checkbox]')!; expect(checkbox.checked).toBe(true); expect(checkbox.disabled).toBe(true);
  await save(view); expect(view.querySelector('[aria-invalid=true]')).not.toBeNull(); expect(calls).toHaveLength(1);
  await click(view, 'Cancel'); await click(view, 'Add address'); expect(view.querySelector('#address-change-notice')?.textContent).toContain('Left: 2 this week, 6 this month.');
});
it('uses returned cap, list order and closing read-only state', async () => {
  const { view } = await mount(() => Response.json({ ...emptyBook, accountState: 'CLOSURE_REQUESTED', limit: 2, items: [saved, { ...saved, id: '4c1f6f1e-6f3c-4a9e-9d62-0b8f7f3b2a12', label: 'Office', isDefault: false }] }));
  expect(view.textContent).toContain('2 of 2'); expect([...view.querySelectorAll('article strong')].map((element) => element.textContent)).toEqual(['Home', 'Office']); expect(view.querySelector('button')).toBeNull(); expect(document.activeElement?.getAttribute('role')).not.toBe('status');
});
it('retries the same create id after a lost response and gets a new id on the next Add', async () => {
  let posts = 0;
  const { view, calls } = await mount((method) => { if (method === 'GET') return Response.json(emptyBook); posts++; if (posts === 1) return Promise.reject(new Error('network')); return Response.json({ ...emptyBook, items: [saved] }); });
  await click(view, 'Add address'); await fill(view); await save(view); expect(view.querySelector('dialog')).not.toBeNull(); await save(view); expect(view.querySelector('dialog')).toBeNull();
  const first = JSON.parse(calls[1].body).id; expect(JSON.parse(calls[2].body).id).toBe(first);
  await click(view, 'Add address'); await fill(view); await save(view); expect(JSON.parse(calls[3].body).id).not.toBe(first);
});
for (const code of ['ADDRESS_BOOK_FULL', 'ADDRESS_CHANGE_LIMIT_REACHED', 'ID_CONFLICT', 'NOT_FOUND', 'ACCOUNT_CLOSING']) {
  it(`closes and recovers the book after ${code}`, async () => {
    const { view, calls } = await mount((method) => method === 'GET' ? Response.json({ ...emptyBook, items: [saved] }) : Response.json({ code }, { status: code === 'NOT_FOUND' ? 404 : 409 }));
    await click(view, 'Edit'); await save(view);
    expect(view.querySelector('dialog')).toBeNull(); expect(view.textContent).toContain('Home');
    if (code === 'ADDRESS_CHANGE_LIMIT_REACHED') { expect(view.querySelector('[role=status]')?.textContent).toContain("You've reached the address change limit"); expect(view.querySelector('button.empty-slot')).not.toBeNull(); }
    if (code === 'ID_CONFLICT') expect(view.textContent).toContain('Your earlier save went through.');
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(code === 'ACCOUNT_CLOSING' ? 1 : 2);
  });
}
it('unknown create outcome reloads on Cancel and blocks another Add until the reload settles', async () => {
  const { deferred } = await import('./fakeApi'); const held = deferred<Response>(); let reads = 0;
  const { view } = await mount((method) => method === 'GET' ? (++reads === 1 ? Response.json(emptyBook) : held.promise) : Promise.reject(new Error('network')));
  await click(view, 'Add address'); await fill(view); await save(view); await click(view, 'Cancel'); expect(view.querySelector('button.empty-slot')).toBeNull();
  const { act } = await import('react'); await act(async () => held.resolve(Response.json({ ...emptyBook, items: [saved] }))); expect(view.textContent).toContain('Home');
});
it('stale update retains a draft and Reload refreshes its values and version', async () => {
  let reads = 0;
  const { view, calls } = await mount((method) => method === 'GET' ? Response.json({ ...emptyBook, items: [{ ...saved, city: ++reads === 1 ? 'Dhaka' : 'Current City', version: reads - 1 }] }) : Response.json({ code: 'STALE_UPDATE' }, { status: 409 }));
  await click(view, 'Edit'); await save(view); expect(view.querySelector('dialog')).not.toBeNull(); await click(view, 'Reload'); expect(view.querySelector<HTMLInputElement>('#address-city')?.value).toBe('Current City'); await save(view); expect(JSON.parse(calls.at(-1)!.body).version).toBe(1);
});
it('removing the default announces its successor and deleting missing rows is quiet', async () => {
  const next = { ...saved, id: '4c1f6f1e-6f3c-4a9e-9d62-0b8f7f3b2a12', label: 'Office' }; let removed = false;
  const { view } = await mount((method) => { if (method === 'DELETE') { removed = true; return Response.json({ ...emptyBook, items: [next] }); } return Response.json({ ...emptyBook, items: removed ? [next] : [saved] }); });
  await click(view, 'Edit'); await click(view, 'Remove'); await click(view, 'Remove'); expect(view.textContent).toContain('Office is now your default address.');
});

it('shows load failures with Reload and bounded dialog failures without losing the draft', async () => {
  let read = 0;
  const { view } = await mount((method) => method === 'GET' ? (++read === 1 ? Response.json({ code: 'MFA_REQUIRED' }, { status: 403 }) : Response.json(emptyBook)) : Response.json({ code: 'INTERNAL_ERROR', message: 'private' }, { status: 500 }));
  expect(view.textContent).toContain('Authenticator verification is required.'); expect(view.querySelector('button.empty-slot')).toBeNull();
  await click(view, 'Reload'); await click(view, 'Add address'); await fill(view); await save(view);
  expect(view.querySelector<HTMLInputElement>('#address-city')?.value).toBe('Dhaka'); expect(view.textContent).toContain('The request could not be completed.'); expect(view.textContent).not.toContain('private');
});
it('successful replies replace allowance without a reread and zero allowance still permits Save', async () => {
  const { view, calls } = await mount((method) => Response.json(method === 'GET' ? emptyBook : { ...emptyBook, changeAllowance: { perWeek: 7, perMonth: 12, remainingThisWeek: 0, remainingThisMonth: 0 }, items: [saved] }));
  await click(view, 'Add address'); await fill(view); await save(view); await click(view, 'Add address');
  expect(view.querySelector('#address-change-notice')?.textContent).toContain('Left: 0 this week, 0 this month.'); expect([...view.querySelectorAll('button')].find((button) => button.textContent === 'Save')?.disabled).toBe(false); expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1);
});
it('holds one command and prevents Escape, Cancel and repeated form submits until completion', async () => {
  const { deferred } = await import('./fakeApi'); const held = deferred<Response>();
  const { view, calls } = await mount((method) => method === 'GET' ? Response.json(emptyBook) : held.promise);
  await click(view, 'Add address'); await fill(view); const { act } = await import('react');
  await act(async () => { view.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await save(view); await click(view, 'Cancel'); await act(async () => view.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })));
  expect(calls).toHaveLength(2); expect(view.querySelector('dialog')).not.toBeNull(); expect([...view.querySelectorAll('dialog button')].every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  await act(async () => held.resolve(Response.json({ ...emptyBook, items: [saved] }, { status: 201 }))); expect(view.querySelector('dialog')).toBeNull();
});
it('full notes and count use the returned cap', async () => {
  const { view } = await mount(() => Response.json({ ...emptyBook, limit: 1, items: [saved] })); expect(view.textContent).toContain('1 of 1'); expect(view.textContent).toContain("You've saved 1 of 1 addresses; remove one to add another."); expect(view.querySelector('button.empty-slot')).toBeNull();
});
it('drops held old-session reads when sign-out leaves the component mounted', async () => {
  const { useSession } = await import('../src/auth/SessionProvider'); const { deferred } = await import('./fakeApi'); const { act, Fragment } = await import('react'); const held = deferred<Response>();
  function SignOut() { const session = useSession(); return createElement('button', { onClick: () => void session.signOut() }, 'Test sign out'); }
  const source = createSessionSource({ restoreSession: vi.fn().mockResolvedValue(restoredCustomer), authenticatedFetch: async (_path, _init, read) => read(await held.promise) });
  const view = await renderWithSession(createElement(Fragment, null, createElement(SignOut), createElement(AddressBook)), source);
  await click(view, 'Test sign out'); await act(async () => held.resolve(Response.json({ ...emptyBook, items: [saved] }))); expect(view.textContent).not.toContain('Rahim Uddin'); expect(view.querySelector('.address-card')).toBeNull();
});

it('preserves accepted NBSP and FEFF boundaries while measuring only Java-trimmed length', async () => {
  const { view, calls } = await mount((method) => Response.json(method === 'GET' ? emptyBook : { ...emptyBook, items: [saved] }));
  const { setInputValue } = await import('./renderWithSession');
  await click(view, 'Add address'); await fill(view);
  const label = '\u00a0' + 'H'.repeat(38) + '\ufeff';
  const name = '\ufeff' + 'N'.repeat(98) + '\u00a0';
  setInputValue(view, '#address-label', label);
  setInputValue(view, '#address-recipientName', name);
  await save(view);
  expect(JSON.parse(calls.at(-1)!.body)).toMatchObject({ label, recipientName: name });
  await click(view, 'Add address'); await fill(view);
  // Programmatic input tests length validation independently of the browser's maxLength cap.
  setInputValue(view, '#address-recipientName', '  ' + 'N'.repeat(100) + '  ');
  await save(view);
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
  expect(JSON.parse(calls.at(-1)!.body).recipientName).toBe('  ' + 'N'.repeat(100) + '  ');
  await click(view, 'Add address'); await fill(view);
  setInputValue(view, '#address-recipientName', '\ufeff' + 'N'.repeat(100));
  await save(view);
  expect(view.querySelector('#address-recipientName')?.getAttribute('aria-invalid')).toBe('true');
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
});

it('Keep cancels removal confirmation without submitting the unchanged address', async () => {
  const { view, calls } = await mount(() => Response.json({ ...emptyBook, items: [saved] }));
  await click(view, 'Edit'); await click(view, 'Remove'); await click(view, 'Keep');
  expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
  expect(view.querySelector('dialog')).not.toBeNull();
});
it('stale Reload holds the command guard through a failed read and allows another Reload', async () => {
  const { deferred } = await import('./fakeApi'); const held = deferred<Response>(); let reads = 0;
  const { view, calls } = await mount((method) => method === 'GET' ? (++reads === 2 ? held.promise : Response.json({ ...emptyBook, items: [saved] })) : Response.json({ code: 'STALE_UPDATE' }, { status: 409 }));
  await click(view, 'Edit'); await save(view); await click(view, 'Reload'); await save(view);
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  const { act } = await import('react'); await act(async () => held.resolve(Response.json({ code: 'INTERNAL_ERROR' }, { status: 500 })));
  await click(view, 'Reload'); expect(view.querySelector('dialog')).not.toBeNull(); expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
});

it('wraps keyboard focus at both modal boundaries', async () => {
  const { view } = await mount(() => Response.json(emptyBook)); await click(view, 'Add address');
  const { act } = await import('react'); const first = view.querySelector<HTMLInputElement>('#address-label')!; const last = view.querySelector<HTMLButtonElement>('button[type=submit]')!;
  last.focus(); await act(async () => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))); expect(document.activeElement).toBe(first);
  await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))); expect(document.activeElement).toBe(last);
});

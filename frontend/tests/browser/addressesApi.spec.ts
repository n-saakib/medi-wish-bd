import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, request as apiRequest, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiStaff, ApiSession, type Role } from './apiSession';
import {
  AddressApi, addressCopy, addressEdit, addressesPath, assertAwayFromDhakaPeriodStart,
  expectAddressBook, storedAddressChanges, storedAddresses, storedAddressState, syntheticAddress, type AddressBook,
  type AddressCreate, type SavedAddress,
} from './addressSupport';
import {
  encodedForms, expectError, ProfileApi, registerByApi, setAccountState, signInByApi, urlScanText,
} from './profileSupport';
import { accessTokenLifetimeMs, apiLogPath, apiUrl, checkedTarget, frontendUrl, grantRole, psql } from './testApi';

const t5 = { tag: ['@t12', '@t12-T5'] };
const t6 = { tag: ['@t12', '@t12-T6'] };
const security = { tag: ['@t12', '@t12-T6', '@security'] };
const concurrent = { tag: ['@t12', '@t12-T6', '@concurrency'] };
const regression = { tag: ['@t12', '@t12-T6', '@regression'] };

async function error(response: APIResponse, status: number, code: keyof typeof addressCopy) {
  return expectError(response, status, code, addressCopy[code]);
}

async function add(user: AddressApi, body = syntheticAddress()): Promise<SavedAddress> {
  const before = storedAddresses(user.user.username);
  const book = await expectAddressBook(await user.create(body), 201);
  const stored = book.items.find(({ id }) => id === body.id);
  expect(stored).toBeDefined();
  expect(stored).toEqual({ ...normalizedFields(body), id: body.id, version: 0,
    isDefault: before.length === 0 || body.isDefault });
  expect(book.items.filter(({ id }) => id !== body.id)).toEqual(before.map((item) =>
    body.isDefault && item.isDefault ? { ...item, isDefault: false, version: item.version + 1 } : item));
  expect(storedAddresses(user.user.username)).toEqual(book.items);
  return stored!;
}

/** Expected business values come from the submitted fixture, independently of response/database agreement. */
function normalizedFields(body: AddressCreate) {
  // A3 copies Java String.trim(): NBSP and FEFF are preserved, unlike JavaScript trim().
  const trim = (value: string) => value.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
  const text = (value: string) => trim(value).replace(/ +/g, ' ');
  return { label: body.label === null || !trim(body.label) ? null : text(body.label),
    recipientName: text(body.recipientName), mobile: trim(body.mobile),
    addressLine: text(body.addressLine), city: text(body.city) };
}

/** Every protected route with a valid mutation shape, so auth failures cannot be validation failures. */
function everyRoute(request: APIRequestContext, headers: Record<string, string>, item: SavedAddress): Promise<APIResponse>[] {
  return [
    request.get(`${apiUrl}${addressesPath}`, { headers }),
    request.post(`${apiUrl}${addressesPath}`, { headers, data: syntheticAddress() }),
    request.put(`${apiUrl}${addressesPath}/${item.id}`, { headers, data: addressEdit(item, { city: 'Changed City' }) }),
    request.delete(`${apiUrl}${addressesPath}/${item.id}?version=${item.version}`, { headers }),
  ];
}

/** JSON whitespace keeps the business value valid while testing the exact byte boundary. */
function paddedJson(value: object, bytes: number): string {
  const json = JSON.stringify(value);
  const padding = bytes - Buffer.byteLength(json, 'utf8');
  expect(padding).toBeGreaterThanOrEqual(0);
  const padded = `${json.slice(0, -1)}${' '.repeat(padding)}}`;
  expect(Buffer.byteLength(padded, 'utf8')).toBe(bytes);
  return padded;
}

async function reachFive(user: AddressApi): Promise<AddressBook> {
  await add(user);
  await add(user, syntheticAddress({ label: 'Office' }));
  await add(user, syntheticAddress({ label: 'Family' }));
  let book = await user.book();
  for (const city of ['First Edit', 'Second Edit']) {
    book = await expectAddressBook(await user.update(book.items[0].id, addressEdit(book.items[0], { city })));
  }
  return book;
}

test.describe('Ticket 12 real address API', () => {
  test('E2E-12-90 three distinct creates into an empty book serialize to one automatic default', concurrent,
    async ({ request }) => {
      assertAwayFromDhakaPeriodStart();
      const user = await AddressApi.register(request);
      await user.bearer();
      const drafts = Array.from({ length: 3 }, (_, index) => syntheticAddress({
        label: `Empty Race ${index}`, city: `Empty City ${index}`, isDefault: false,
      }));
      const answers = await Promise.all(drafts.map((draft) => user.create(draft)));
      const books = await Promise.all(answers.map((answer) => expectAddressBook(answer, 201)));
      expect(books.map(({ items }) => items.length).sort()).toEqual([1, 2, 3]);
      const firstBook = books.find(({ items }) => items.length === 1)!;
      const firstId = firstBook.items[0].id;
      for (const [index, book] of books.entries()) {
        expect(book.items.some(({ id }) => id === drafts[index].id)).toBe(true);
        expect(book.items).toEqual(book.items.map(({ id }) => {
          const draft = drafts.find((candidate) => candidate.id === id);
          expect(draft, 'each committed row belongs to a submitted create').toBeDefined();
          return { ...normalizedFields(draft!), id, isDefault: id === firstId, version: 0 };
        }));
        expect(book.changeAllowance).toEqual({ perWeek: 5, perMonth: 10,
          remainingThisWeek: 5 - book.items.length, remainingThisMonth: 10 - book.items.length });
      }
      const final = await user.book();
      expect(final).toEqual(books.find(({ items }) => items.length === 3));
      expect(final.items.map(({ id }) => id).sort()).toEqual(drafts.map(({ id }) => id).sort());
      expect(storedAddresses(user.user.username)).toEqual(final.items);
      expect(storedAddressChanges(user.user.username)).toHaveLength(3);
    });

  test('E2E-12-91 a genuinely expired access token denies every route while its refresh session stays active', security,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      const item = await add(user);
      const state = storedAddressState(user.user.username);
      const context = await apiRequest.newContext();
      try {
        const login = await signInByApi(context, user.user.username, user.user.password);
        expect(login.status()).toBe(200);
        const { accessToken } = await login.json() as { accessToken: string };
        const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')) as {
          exp: unknown; sid: unknown };
        expect(typeof claims.exp === 'number' && Number.isFinite(claims.exp), 'issued token has a numeric expiry').toBe(true);
        expect((await expectAddressBook(await context.get(`${apiUrl}${addressesPath}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }))).items).toEqual([item]);
        await expect.poll(() => typeof claims.exp === 'number' && Date.now() >= claims.exp * 1_000 + 1_000,
          { message: 'the exact issued token has expired by a full second', timeout: accessTokenLifetimeMs + 5_000,
            intervals: [100] }).toBe(true);
        // Raw requests retain this expired token; no AddressApi renewal or login runs during the denial matrix.
        for (const answer of await Promise.all(everyRoute(context, { Authorization: `Bearer ${accessToken}` }, item))) {
          await error(answer, 401, 'AUTHENTICATION_REQUIRED');
          expect(answer.headers()['www-authenticate']).toBe('Bearer');
        }
        expect(storedAddressState(user.user.username)).toEqual(state);
        const { csrfToken } = await (await context.get(`${apiUrl}/api/auth/csrf`)).json() as { csrfToken: string };
        const refresh = await context.post(`${apiUrl}/api/auth/refresh`, { headers: { 'X-XSRF-TOKEN': csrfToken } });
        expect(refresh.status(), 'expiry did not revoke the live refresh session').toBe(200);
        const renewed = await refresh.json() as { accessToken: string };
        const renewedClaims = JSON.parse(Buffer.from(renewed.accessToken.split('.')[1], 'base64url').toString('utf8')) as {
          sid: unknown };
        expect(typeof claims.sid === 'string' && renewedClaims.sid === claims.sid,
          'refresh renewed the same session that issued the expired token').toBe(true);
        expect((await expectAddressBook(await context.get(`${apiUrl}${addressesPath}`,
          { headers: { Authorization: `Bearer ${renewed.accessToken}` } }))).items).toEqual([item]);
        expect(storedAddressState(user.user.username)).toEqual(state);
      } finally { await context.dispose(); }
    });

  test('E2E-12-92 real refresh cookies with or without valid CSRF cannot replace Bearer authorization', security,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      const item = await add(user);
      const state = storedAddressState(user.user.username);
      const context = await apiRequest.newContext();
      try {
        const login = await signInByApi(context, user.user.username, user.user.password);
        expect(login.status()).toBe(200);
        const { csrfToken } = await (await context.get(`${apiUrl}/api/auth/csrf`)).json() as { csrfToken: string };
        const cookies = (await context.storageState()).cookies;
        const refreshCookie = cookies.find(({ name }) => name === 'MW_REFRESH');
        const csrfCookie = cookies.find(({ name }) => name === 'XSRF-TOKEN');
        expect(Boolean(refreshCookie?.value), 'real login issued a refresh cookie').toBe(true);
        expect(Boolean(csrfCookie?.value), 'CSRF endpoint issued its cookie').toBe(true);
        // Explicit Cookie forwards the genuine refresh cookie even though its normal path excludes address routes.
        const cookie = `${refreshCookie!.name}=${refreshCookie!.value}; ${csrfCookie!.name}=${csrfCookie!.value}`;
        const attempts: Record<string, string>[] = [{ Cookie: cookie }, { Cookie: cookie, 'X-XSRF-TOKEN': csrfToken }];
        for (const headers of attempts) {
          for (const answer of await Promise.all(everyRoute(context, headers, item))) {
            await error(answer, 401, 'AUTHENTICATION_REQUIRED');
            expect(answer.headers()['www-authenticate']).toBe('Bearer');
          }
          expect(storedAddressState(user.user.username)).toEqual(state);
        }
        expect((await context.post(`${apiUrl}/api/auth/refresh`,
          { headers: { 'X-XSRF-TOKEN': csrfToken } })).status(), 'the denied cookie remains valid for refresh').toBe(200);
        expect(storedAddressState(user.user.username)).toEqual(state);
      } finally { await context.dispose(); }
    });

  test('E2E-12-09 exact projections, CRUD, bounded errors, defaults and persistent versions', t5, async ({ request }) => {
    const user = await AddressApi.register(request);
    const empty = await user.book();
    expect(empty).toEqual({ accountState: 'ACTIVE', limit: 3, items: [],
      changeAllowance: { perWeek: 5, perMonth: 10, remainingThisWeek: 5, remainingThisMonth: 10 } });
    const first = await add(user, syntheticAddress({ isDefault: false }));
    expect(first).toMatchObject({ isDefault: true, version: 0 });
    const second = await add(user, syntheticAddress({ label: 'Office' }));
    const third = await add(user, syntheticAddress({ label: null }));
    const full = await user.book();
    await error(await user.create(syntheticAddress()), 409, 'ADDRESS_BOOK_FULL');
    await error(await user.create({ ...third, version: undefined, city: 'Conflicting City' }), 409, 'ID_CONFLICT');
    await error(await user.update(first.id, addressEdit(first, { isDefault: false })), 400, 'INVALID_REQUEST');
    await error(await user.update(randomUUID(), addressEdit(first, { city: 'Missing' })), 404, 'NOT_FOUND');
    await error(await user.remove(randomUUID(), 0), 404, 'NOT_FOUND');
    expect((await user.book()).items).toEqual(full.items);

    const moved = await expectAddressBook(await user.update(second.id, addressEdit(second, { city: 'Chattogram', isDefault: true })));
    expect(moved.items.map(({ id }) => id)).toEqual(full.items.map(({ id }) => id));
    expect(moved.items.find(({ id }) => id === first.id)).toEqual({ ...first, isDefault: false, version: 1 });
    expect(moved.items.find(({ id }) => id === second.id)).toEqual({ ...second, city: 'Chattogram', isDefault: true, version: 1 });
    await error(await user.update(second.id, addressEdit(second, { city: 'Stale' })), 409, 'STALE_UPDATE');
    await error(await user.remove(first.id, 0), 409, 'STALE_UPDATE');
    const deleted = await expectAddressBook(await user.remove(second.id, 1));
    expect(deleted.items).toEqual([{ ...first, isDefault: true, version: 2 }, third]);
    await error(await user.remove(second.id, 1), 404, 'NOT_FOUND');
    expect((await user.book()).items).toEqual(deleted.items);
    expect(storedAddresses(user.user.username)).toEqual(deleted.items);
  });

  test('E2E-12-10 six parallel creates from two sessions admit only one remaining slot',
    { tag: [...t5.tag, '@concurrency'] }, async ({ request }) => {
      const user = await AddressApi.register(request);
      await add(user);
      await add(user);
      const seeds = storedAddresses(user.user.username);
      const contexts = await Promise.all([apiRequest.newContext(), apiRequest.newContext()]);
      try {
        const clients = contexts.map((context) => AddressApi.forUser(context, user.user));
        await Promise.all(clients.map((client) => client.bearer()));
        const drafts = Array.from({ length: 6 }, (_, index) => syntheticAddress({
          label: `Race ${index}`, city: `City ${index}`, recipientName: `Capacity Tester ${index}`,
        }));
        const answers = await Promise.all(drafts.map((draft, index) => clients[index % 2].create(draft)));
        expect(answers.map((answer) => answer.status()).sort()).toEqual([201, 409, 409, 409, 409, 409]);
        const winnerIndex = answers.findIndex((answer) => answer.status() === 201);
        const winner = drafts[winnerIndex];
        const expected = [...seeds, { ...normalizedFields(winner), id: winner.id, isDefault: false, version: 0 }];
        for (const answer of answers) {
          if (answer.status() === 201) expect((await expectAddressBook(answer, 201)).items).toEqual(expected);
          else await error(answer, 409, 'ADDRESS_BOOK_FULL');
        }
        const final = await user.book();
        expect(final.items).toEqual(expected);
        expect(storedAddresses(user.user.username)).toEqual(expected);
        expect(storedAddressChanges(user.user.username)).toHaveLength(3);
        expect(drafts.filter(({ id }) => final.items.some((item) => item.id === id))).toHaveLength(1);
      } finally {
        await Promise.all(contexts.map((context) => context.dispose()));
      }
    });

  test('E2E-12-11 missing, malformed and revoked Bearer credentials deny all four routes without writes', security,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      const item = await add(user);
      const before = storedAddresses(user.user.username);
      const changes = storedAddressChanges(user.user.username);
      const state = storedAddressState(user.user.username);
      const context = await apiRequest.newContext();
      try {
        const login = await signInByApi(context, user.user.username, user.user.password);
        expect(login.status()).toBe(200);
        const { accessToken } = await login.json() as { accessToken: string };
        const { exp } = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')) as { exp: unknown };
        expect(typeof exp === 'number' && Number.isFinite(exp), 'access token has a numeric expiry').toBe(true);
        const unexpired = () => expect(typeof exp === 'number' && Date.now() + 1_000 < exp * 1_000,
          'the exact revoked token remains unexpired with a one-second margin').toBe(true);
        expect((await expectAddressBook(await context.get(`${apiUrl}${addressesPath}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }))).items).toEqual(before);
        const { csrfToken } = await (await context.get(`${apiUrl}/api/auth/csrf`)).json() as { csrfToken: string };
        unexpired();
        expect((await context.post(`${apiUrl}/api/auth/logout`, { headers: { 'X-XSRF-TOKEN': csrfToken } })).status()).toBe(204);
        for (const answer of await Promise.all(everyRoute(request, { Authorization: `Bearer ${accessToken}` }, item))) {
          await error(answer, 401, 'AUTHENTICATION_REQUIRED');
          expect(answer.headers()['www-authenticate']).toBe('Bearer');
        }
        unexpired();
        const attempts: Record<string, string>[] = [{}, { Authorization: 'Bearer not-a-token' }];
        for (const headers of attempts) {
          for (const answer of await Promise.all(everyRoute(request, headers, item))) {
            await error(answer, 401, 'AUTHENTICATION_REQUIRED');
            expect(answer.headers()['www-authenticate']).toBe('Bearer');
          }
        }
      } finally { await context.dispose(); }
      expect(storedAddresses(user.user.username)).toEqual(before);
      expect(storedAddressChanges(user.user.username)).toEqual(changes);
      expect(storedAddressState(user.user.username)).toEqual(state);
    });

  test('E2E-12-12 16 KiB JSON is accepted; larger, malformed and non-JSON POST/PUT bodies are bounded', security,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      const body = syntheticAddress({ label: 'বাড়ি', recipientName: 'রহিম উদ্দিন',
        addressLine: 'বাড়ি ১২, সড়ক ৫, ধানমন্ডি', city: 'ঢাকা' });
      const exactCreate = paddedJson(body, 16_384);
      expect(exactCreate.length).toBeLessThan(16_384);
      const saved = await expectAddressBook(await user.create(exactCreate), 201);
      expect(saved.items).toEqual([{ ...normalizedFields(body), id: body.id, isDefault: true, version: 0 }]);
      expect(storedAddresses(user.user.username)).toEqual(saved.items);
      expect(storedAddressChanges(user.user.username)).toHaveLength(1);
      const item = saved.items[0];
      const edit = addressEdit(item, { city: 'চট্টগ্রাম' });
      const exactEdit = paddedJson(edit, 16_384);
      expect(exactEdit.length).toBeLessThan(16_384);
      const edited = await expectAddressBook(await user.update(item.id, exactEdit));
      expect(edited.items).toEqual([{ ...item, city: edit.city, version: 1 }]);
      expect(storedAddresses(user.user.username)).toEqual(edited.items);
      expect(storedAddressChanges(user.user.username)).toHaveLength(2);
      const before = storedAddresses(user.user.username);
      const changes = storedAddressChanges(user.user.username);
      for (const [raw, contentType] of [[paddedJson({ ...body, id: randomUUID() }, 16_385), 'application/json'],
        ['{"label":', 'application/json'], [JSON.stringify(syntheticAddress()), 'text/plain']]) {
        await error(await user.create(raw, contentType), 400, 'INVALID_REQUEST');
        expect(storedAddresses(user.user.username)).toEqual(before);
        expect(storedAddressChanges(user.user.username)).toEqual(changes);
      }
      for (const [raw, contentType] of [[paddedJson(addressEdit(edited.items[0], { city: 'সিলেট' }), 16_385), 'application/json'],
        ['{"city":', 'application/json'], [JSON.stringify(addressEdit(edited.items[0])), 'text/plain']]) {
        await error(await user.update(item.id, raw, contentType), 400, 'INVALID_REQUEST');
        expect(storedAddresses(user.user.username)).toEqual(before);
        expect(storedAddressChanges(user.user.username)).toEqual(changes);
      }
      // The body limit belongs before authorization, preserving the existing profile boundary.
      await error(await request.post(`${apiUrl}${addressesPath}`, { headers: { 'Content-Type': 'application/json' },
        data: paddedJson({ ...body, id: randomUUID() }, 16_385) }), 400, 'INVALID_REQUEST');
      expect(storedAddresses(user.user.username)).toEqual(before);
      expect(storedAddressChanges(user.user.username)).toEqual(changes);
      for (const [bytes, status, code] of [[16_384, 401, 'AUTHENTICATION_REQUIRED'],
        [16_385, 400, 'INVALID_REQUEST']] as const) {
        await error(await request.put(`${apiUrl}${addressesPath}/${item.id}`,
          { headers: { 'Content-Type': 'application/json' },
            data: paddedJson(addressEdit(edited.items[0], { city: 'সিলেট' }), bytes) }), status, code);
        expect(storedAddresses(user.user.username)).toEqual(before);
        expect(storedAddressChanges(user.user.username)).toEqual(changes);
      }
    });

  test('E2E-12-13 private address text and credentials stay out of API logs, URLs and error/replay projections', security,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      const draft = syntheticAddress({ label: `Private Label ${randomUUID().slice(0, 8)}`,
        city: `Private City ${randomUUID().slice(0, 8)}` });
      const item = await add(user, draft);
      const token = await user.bearer();
      const success = await user.get();
      await expectAddressBook(success);
      const replay = await user.create(draft);
      await expectAddressBook(replay);
      const failure = await user.update(item.id, addressEdit(item, { city: `${draft.addressLine}\n` }));
      await error(failure, 400, 'INVALID_REQUEST');
      const privateText = [draft.label!, draft.recipientName, draft.mobile, draft.addressLine, draft.city];
      const credentials = [token, user.user.password, user.user.email, user.user.mobile];
      const privateForms = [...privateText, ...credentials].flatMap(encodedForms);
      for (const answer of [success, replay, failure]) {
        const text = await answer.text();
        for (const secret of credentials.flatMap(encodedForms)) expect(text).not.toContain(secret);
        const headers = JSON.stringify(answer.headers());
        for (const value of privateForms) {
          expect(headers).not.toContain(value);
          expect(urlScanText(answer.url())).not.toContain(value);
        }
      }
      for (const value of privateForms) expect(await failure.text()).not.toContain(value);
      const log = readFileSync(apiLogPath, 'utf8');
      expect(log).toContain('"message":"HTTP response status=');
      expect(privateForms.filter((value) => log.includes(value))).toEqual([]);
    });

  for (const role of ['CUSTOMER', 'DELIVERY_PERSON', 'MODERATOR', 'ADMIN'] as Role[]) {
    test(`E2E-12-19 ${role} can maintain only their own book; foreign ids stay private`,
      { tag: [...t5.tag, '@cross-08-12', '@security'] }, async ({ request }) => {
        const customer = await AddressApi.register(request);
        if (role === 'CUSTOMER') {
          const item = await add(customer);
          const edited = await expectAddressBook(await customer.update(item.id, addressEdit(item, { city: 'Own City' })));
          expect(edited.items[0].city).toBe('Own City');
          expect((await expectAddressBook(await customer.remove(item.id, 1))).items).toEqual([]);
          return;
        }
        const customerItem = await add(customer);
        const customerBefore = storedAddresses(customer.user.username);
        const customerChanges = storedAddressChanges(customer.user.username);
        const actor = await apiStaff(request, role);
        try {
          const draft = syntheticAddress();
          const created = await expectAddressBook(await actor.session.call('POST', addressesPath, { data: draft }), 201);
          const item = { ...normalizedFields(draft), id: draft.id, isDefault: true, version: 0 };
          expect(created.items).toEqual([item]);
          const edited = await expectAddressBook(await actor.session.call('PUT', `${addressesPath}/${item.id}`,
            { data: addressEdit(item, { city: 'Own Staff City' }) }));
          const staffItem = { ...item, city: 'Own Staff City', version: 1 };
          expect(edited.items).toEqual([staffItem]);
          expect((await expectAddressBook(await actor.session.call('GET', addressesPath))).items).toEqual([staffItem]);
          const before = storedAddresses(actor.user.username);
          expect(before).toEqual([staffItem]);
          const changes = storedAddressChanges(actor.user.username);
          expect(changes).toHaveLength(2);
          await error(await customer.update(item.id, addressEdit(staffItem, { city: 'Intruder City' })), 404, 'NOT_FOUND');
          await error(await customer.remove(item.id, staffItem.version), 404, 'NOT_FOUND');
          expect((await customer.book()).items).toEqual(customerBefore);
          expect(storedAddresses(actor.user.username)).toEqual(before);
          expect(storedAddressChanges(actor.user.username)).toEqual(changes);
          expect(storedAddresses(customer.user.username)).toEqual(customerBefore);
          expect(storedAddressChanges(customer.user.username)).toEqual(customerChanges);
          for (const id of [customerItem.id, randomUUID()]) {
            const deniedUpdate = await actor.session.call('PUT', `${addressesPath}/${id}`,
              { data: addressEdit(customerItem, { city: 'Staff Intruder City' }) });
            await error(deniedUpdate, 404, 'NOT_FOUND');
            // Refresh before raw DELETE, because ApiSession.call does not expose DELETE.
            expect((await expectAddressBook(await actor.session.call('GET', addressesPath))).items).toEqual(before);
            const deniedRemove = await request.delete(`${apiUrl}${addressesPath}/${id}?version=${customerItem.version}`,
              { headers: { Authorization: `Bearer ${actor.session.accessToken}` } });
            await error(deniedRemove, 404, 'NOT_FOUND');
            for (const response of [deniedUpdate, deniedRemove]) {
              for (const value of [customerItem.recipientName, customerItem.mobile, customerItem.addressLine]) {
                expect(await response.text()).not.toContain(value);
              }
            }
            expect(storedAddresses(actor.user.username)).toEqual(before);
            expect(storedAddressChanges(actor.user.username)).toEqual(changes);
            expect(storedAddresses(customer.user.username)).toEqual(customerBefore);
            expect(storedAddressChanges(customer.user.username)).toEqual(customerChanges);
          }
          expect((await expectAddressBook(await actor.session.call('GET', addressesPath))).items).toEqual(before);
          const removed = await request.delete(`${apiUrl}${addressesPath}/${item.id}?version=${staffItem.version}`,
            { headers: { Authorization: `Bearer ${actor.session.accessToken}` } });
          expect((await expectAddressBook(removed)).items).toEqual([]);
          expect(storedAddresses(actor.user.username)).toEqual([]);
          expect(storedAddressChanges(actor.user.username)).toEqual(changes);
          expect(storedAddresses(customer.user.username)).toEqual(customerBefore);
          expect(storedAddressChanges(customer.user.username)).toEqual(customerChanges);
        } finally { await actor.session.dispose(); }
      });
  }

  test('E2E-12-21 fifth change counts once; refused edits/adds, retries and removals never restore allowance', t5,
    async ({ request }) => {
      assertAwayFromDhakaPeriodStart();
      const first = await AddressApi.register(request);
      const full = await reachFive(first);
      const changes = storedAddressChanges(first.user.username);
      const item = full.items[0];
      const refusal = await first.update(item.id, addressEdit(item, { city: 'Sixth Private City' }));
      await error(refusal, 409, 'ADDRESS_CHANGE_LIMIT_REACHED');
      expect(await refusal.text()).not.toContain('Sixth Private City');
      const third = full.items[2];
      const { version: ignored, ...replay } = third;
      void ignored;
      expect(await expectAddressBook(await first.create(replay))).toEqual(full);
      expect(await expectAddressBook(await first.update(item.id, addressEdit(item, { version: 0 })))).toEqual(full);
      const removed = await expectAddressBook(await first.remove(third.id, third.version));
      await error(await first.create(syntheticAddress()), 409, 'ADDRESS_CHANGE_LIMIT_REACHED');
      expect(storedAddresses(first.user.username)).toEqual(removed.items);
      expect(storedAddressChanges(first.user.username)).toEqual(changes);
      expect((await first.book()).changeAllowance).toMatchObject({ remainingThisWeek: 0, remainingThisMonth: 5 });

      const second = await AddressApi.register(request);
      for (let index = 0; index < 3; index++) await add(second);
      for (let index = 0; index < 2; index++) {
        const book = await second.book();
        await expectAddressBook(await second.remove(book.items.at(-1)!.id, book.items.at(-1)!.version));
        await add(second);
      }
      const book = await second.book();
      const final = await expectAddressBook(await second.remove(book.items.at(-1)!.id, book.items.at(-1)!.version));
      await error(await second.create(syntheticAddress()), 409, 'ADDRESS_CHANGE_LIMIT_REACHED');
      expect(storedAddresses(second.user.username)).toEqual(final.items);
      expect(storedAddressChanges(second.user.username)).toHaveLength(5);
      expect((await second.book()).changeAllowance.remainingThisWeek).toBe(0);
    });

  test('E2E-12-23 required fields and text controls refuse invalid creates/edits without data or count changes', security,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      const valid = syntheticAddress();
      const item = await add(user);
      const state = storedAddressState(user.user.username);
      for (const field of ['recipientName', 'mobile', 'addressLine', 'city']) {
        for (const value of [null, '', '   ']) {
          await error(await user.create({ ...valid, [field]: value }), 400, 'INVALID_REQUEST');
          await error(await user.update(item.id, { ...addressEdit(item), [field]: value }), 400, 'INVALID_REQUEST');
        }
      }
      for (const field of ['label', 'recipientName', 'mobile', 'addressLine', 'city']) {
        for (const control of ['\n', '\r', '\t', '\u0000', '\u007f', '\u0085', '\u2028', '\u2029']) {
          await error(await user.create({ ...valid, [field]: `Forbidden${control}Text` }), 400, 'INVALID_REQUEST');
          await error(await user.update(item.id, { ...addressEdit(item), [field]: `Forbidden${control}Text` }), 400, 'INVALID_REQUEST');
        }
      }
      // These would become valid if controls were trimmed before validation, including the mobile.
      for (const field of ['label', 'recipientName', 'mobile', 'addressLine', 'city'] as const) {
        for (const control of ['\t', '\r', '\u0000']) {
          for (const value of [`${control}${valid[field]}`, `${valid[field]}${control}`]) {
            await error(await user.create({ ...valid, [field]: value }), 400, 'INVALID_REQUEST');
            await error(await user.update(item.id, { ...addressEdit(item), [field]: value }), 400, 'INVALID_REQUEST');
            expect(storedAddressState(user.user.username)).toEqual(state);
          }
        }
      }
      expect((await user.book()).items).toEqual([item]);
      expect(storedAddresses(user.user.username)).toEqual([item]);
      expect(storedAddressChanges(user.user.username)).toHaveLength(1);
      expect(storedAddressState(user.user.username)).toEqual(state);
    });

  test('E2E-12-24 text limits apply after trim, optional labels clear and spaces normalize', t5, async ({ request }) => {
    const user = await AddressApi.register(request);
    const draft = syntheticAddress({ label: ` ${'l'.repeat(40)} `, recipientName: ` ${'n'.repeat(100)} `,
      addressLine: ` ${'a'.repeat(200)} `, city: ` ${'c'.repeat(60)} `, mobile: ' 01711000000 ' });
    const item = await add(user, draft);
    expect(item).toMatchObject({ label: 'l'.repeat(40), recipientName: 'n'.repeat(100), addressLine: 'a'.repeat(200),
      city: 'c'.repeat(60), mobile: '01711000000' });
    const state = storedAddressState(user.user.username);
    const { label, recipientName, addressLine, city, mobile } = draft;
    const maxEdit = await expectAddressBook(await user.update(item.id,
      addressEdit(item, { label, recipientName, addressLine, city, mobile })));
    expect(maxEdit.items).toEqual([item]);
    expect(storedAddressState(user.user.username)).toEqual(state);
    for (const [field, limit] of [['label', 40], ['recipientName', 100], ['addressLine', 200], ['city', 60]] as const) {
      await error(await user.create(syntheticAddress({ [field]: 'x'.repeat(limit + 1) })), 400, 'INVALID_REQUEST');
      await error(await user.update(item.id, addressEdit(item, { [field]: 'x'.repeat(limit + 1) })), 400, 'INVALID_REQUEST');
      // Length is checked after trim and before collapsing interior spaces, per A3.
      const collapsible = `A${' '.repeat(limit)}B`;
      await error(await user.create(syntheticAddress({ [field]: collapsible })), 400, 'INVALID_REQUEST');
      await error(await user.update(item.id, addressEdit(item, { [field]: collapsible })), 400, 'INVALID_REQUEST');
      expect(storedAddressState(user.user.username)).toEqual(state);
    }
    const cleared = await expectAddressBook(await user.update(item.id, addressEdit(item, { label: '   ',
      recipientName: '  Address   Tester  ', addressLine: '  House   12  ', city: '  Some   City  ' })));
    expect(cleared.items[0]).toMatchObject({ label: null, recipientName: 'Address Tester', addressLine: 'House 12', city: 'Some City', version: 1 });
    const unicodeFields = (space: string) => ({ label: space, recipientName: space, addressLine: space, city: space });
    const unicodeItem = await add(user, syntheticAddress(unicodeFields('\u00a0')));
    expect(unicodeItem).toMatchObject(unicodeFields('\u00a0'));
    const unicodeEdited = await expectAddressBook(await user.update(unicodeItem.id,
      addressEdit(unicodeItem, unicodeFields('\ufeff'))));
    const expected = [{ ...cleared.items[0] }, { ...unicodeItem, ...unicodeFields('\ufeff'), version: 1 }];
    expect(unicodeEdited.items).toEqual(expected);
    expect((await user.book()).items).toEqual(expected);
    expect(storedAddresses(user.user.username)).toEqual(expected);
    await add(user, syntheticAddress({ label: null }));
    expect(storedAddressChanges(user.user.username)).toHaveLength(5);
  });

  test('E2E-12-47 supplementary Unicode letters use the accepted UTF-16 text-length boundaries', t5,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      // A3 copies ProfileRules' String.length(): each safe Deseret letter occupies two UTF-16 units.
      const fields = (letter: string) => ({ label: letter.repeat(20), recipientName: letter.repeat(50),
        addressLine: letter.repeat(100), city: letter.repeat(30) });
      const item = await add(user, syntheticAddress(fields('\u{10400}')));
      const edited = await expectAddressBook(await user.update(item.id, addressEdit(item, fields('\u{10428}'))));
      const expected = [{ ...item, ...fields('\u{10428}'), version: 1 }];
      expect(edited.items).toEqual(expected);
      expect((await user.book()).items).toEqual(expected);
      expect(storedAddresses(user.user.username)).toEqual(expected);
      expect(storedAddressChanges(user.user.username)).toHaveLength(2);
      const state = storedAddressState(user.user.username);
      for (const [field, limit] of [['label', 40], ['recipientName', 100], ['addressLine', 200], ['city', 60]] as const) {
        const overlong = `${'\u{10400}'.repeat(limit / 2)}x`;
        expect(overlong.length).toBe(limit + 1);
        await error(await user.create(syntheticAddress({ [field]: overlong })), 400, 'INVALID_REQUEST');
        expect(storedAddressState(user.user.username)).toEqual(state);
        await error(await user.update(item.id, addressEdit(expected[0], { [field]: overlong })), 400, 'INVALID_REQUEST');
        expect(storedAddressState(user.user.username)).toEqual(state);
      }
    });

  test('E2E-12-25 POST and PUT require exact keys and types, rejecting client-written identity/allowance metadata', security,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      const draft = syntheticAddress();
      const item = await add(user, draft);
      const before = storedAddresses(user.user.username);
      const changes = storedAddressChanges(user.user.username);
      const shapes = [draft, addressEdit(item)];
      for (const [index, shape] of shapes.entries()) {
        const send = (body: unknown) => index === 0 ? user.create(body) : user.update(item.id, body);
        for (const key of Object.keys(shape)) {
          const omitted = { ...shape } as Record<string, unknown>;
          delete omitted[key];
          await error(await send(omitted), 400, 'INVALID_REQUEST');
        }
        for (const forbidden of ['userId', 'username', 'accountState', 'changeAllowance', 'createdAt', 'updatedAt']) {
          await error(await send({ ...shape, [forbidden]: 'Unauthorized Value' }), 400, 'INVALID_REQUEST');
        }
        for (const field of ['label', 'recipientName', 'mobile', 'addressLine', 'city']) {
          for (const wrong of [17, true, [], {}]) await error(await send({ ...shape, [field]: wrong }), 400, 'INVALID_REQUEST');
        }
        for (const wrong of ['true', 1, null]) await error(await send({ ...shape, isDefault: wrong }), 400, 'INVALID_REQUEST');
        for (const wrong of [null, [], 1]) await error(await send(wrong), 400, 'INVALID_REQUEST');
        // AddressApi treats strings as raw bodies: quote JSON strings explicitly to test valid primitives.
        for (const primitive of ['plain', true]) {
          await error(await send(JSON.stringify(primitive)), 400, 'INVALID_REQUEST');
          expect(storedAddresses(user.user.username)).toEqual(before);
          expect(storedAddressChanges(user.user.username)).toEqual(changes);
        }
      }
      for (const id of [null, 17, true, [], {}]) {
        await error(await user.create({ ...draft, id }), 400, 'INVALID_REQUEST');
        expect(storedAddresses(user.user.username)).toEqual(before);
        expect(storedAddressChanges(user.user.username)).toEqual(changes);
      }
      await error(await user.create({ ...draft, version: 0 }), 400, 'INVALID_REQUEST');
      await error(await user.update(item.id, { ...addressEdit(item), id: item.id }), 400, 'INVALID_REQUEST');
      expect(storedAddresses(user.user.username)).toEqual(before);
      expect(storedAddressChanges(user.user.username)).toEqual(changes);
    });

  test('E2E-12-26 mobile accepts exactly eleven ASCII digits without country prefixes or numeric coercion', security,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      const zero = await add(user, syntheticAddress({ mobile: '00000000000' }));
      const nine = await add(user, syntheticAddress({ mobile: '99999999999' }));
      const firstEdit = await expectAddressBook(await user.update(zero.id, addressEdit(zero, { mobile: '99999999999' })));
      expect(firstEdit.items).toEqual([{ ...zero, mobile: '99999999999', version: 1 }, nine]);
      const secondEdit = await expectAddressBook(await user.update(nine.id, addressEdit(nine, { mobile: '00000000000' })));
      const expected = [{ ...zero, mobile: '99999999999', version: 1 }, { ...nine, mobile: '00000000000', version: 1 }];
      expect(secondEdit.items).toEqual(expected);
      expect((await user.book()).items).toEqual(expected);
      expect(storedAddresses(user.user.username)).toEqual(expected);
      const changes = storedAddressChanges(user.user.username);
      expect(changes).toHaveLength(4);
      for (const mobile of ['0171100000', '017110000000', '+8801711000000', '01711 000000', '01711-000000',
        '０１７１１００００００', '০১৭১১০০০০০০', '0171100000a', 1711000000, '\u00a001711000000\u00a0', '\ufeff01711000000\ufeff']) {
        await error(await user.create({ ...syntheticAddress(), mobile }), 400, 'INVALID_REQUEST');
        await error(await user.update(zero.id, { ...addressEdit(secondEdit.items[0]), mobile }), 400, 'INVALID_REQUEST');
        expect(storedAddresses(user.user.username)).toEqual(expected);
        expect(storedAddressChanges(user.user.username)).toEqual(changes);
      }
      expect((await user.book()).items).toEqual(expected);
    });

  test('E2E-12-27 canonical UUIDs and strict integer versions are enforced on POST, PUT and DELETE', security,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      const item = await add(user);
      const state = storedAddressState(user.user.username);
      for (const id of ['1-1-1-1-1', 'ABCDEF12-3456-7890-ABCD-EF1234567890', 'not-a-uuid', '00000000-0000-0000-0000-00000000000']) {
        await error(await user.create(syntheticAddress({ id })), 400, 'INVALID_REQUEST');
        await error(await user.update(id, addressEdit(item, { city: 'Invalid Path' })), 400, 'INVALID_REQUEST');
        await error(await user.remove(id, 0), 400, 'INVALID_REQUEST');
      }
      for (const version of [-1, 0.5, '0', null, true, {}, 1e30]) {
        await error(await user.update(item.id, { ...addressEdit(item), version }), 400, 'INVALID_REQUEST');
      }
      for (const version of ['-1', '+0', '0.0', '', 'abc', '1000000000000000000']) {
        await error(await user.remove(item.id, version), 400, 'INVALID_REQUEST');
      }
      await error(await request.delete(`${apiUrl}${addressesPath}/${item.id}`, { headers: await user.headers() }), 400, 'INVALID_REQUEST');
      await error(await user.remove(item.id, '999999999999999999'), 409, 'STALE_UPDATE');
      const rawEdit = (version: string) => JSON.stringify(addressEdit(item, { city: 'Long Version' }))
        .replace(/"version":0/, `"version":${version}`);
      for (const version of ['9007199254740992', '9223372036854775807']) {
        await error(await user.update(item.id, rawEdit(version)), 409, 'STALE_UPDATE');
      }
      for (const version of ['0.0', '0e0', '0E+0', '-0.0', '9223372036854775808']) {
        await error(await user.update(item.id, rawEdit(version)), 400, 'INVALID_REQUEST');
        expect(storedAddressState(user.user.username)).toEqual(state);
      }
      expect(storedAddressState(user.user.username)).toEqual(state);
      expect(storedAddresses(user.user.username)).toEqual([item]);
      expect(storedAddressChanges(user.user.username)).toHaveLength(1);
      // Leading zeroes are explicitly allowed by the accepted 1–18 ASCII-digit query syntax.
      expect((await expectAddressBook(await user.remove(item.id, '000000000000000000'))).items).toEqual([]);
      expect(storedAddressState(user.user.username)).toEqual({ addresses: [], changes: state.changes });
    });

  test('E2E-12-28 normalized create replay ignores requested default and precedes the cap', regression, async ({ request }) => {
    const user = await AddressApi.register(request);
    const firstDraft = syntheticAddress({ label: '  Home   Address  ' });
    await add(user, firstDraft);
    await add(user, syntheticAddress({ isDefault: true }));
    await add(user);
    const full = await user.book();
    const changes = storedAddressChanges(user.user.username);
    const state = storedAddressState(user.user.username);
    expect((await expectAddressBook(await user.create({ ...firstDraft, label: 'Home Address', isDefault: true }))).items).toEqual(full.items);
    expect(storedAddressState(user.user.username)).toEqual(state);
    const differentMobile = `${firstDraft.mobile.slice(0, -1)}${firstDraft.mobile.endsWith('0') ? '1' : '0'}`;
    for (const changedField of [
      { label: 'Different Label' }, { recipientName: `${firstDraft.recipientName} Changed` },
      { mobile: differentMobile }, { addressLine: `${firstDraft.addressLine}, Changed` }, { city: 'Different City' },
    ]) {
      await error(await user.create({ ...firstDraft, ...changedField }), 409, 'ID_CONFLICT');
      expect(storedAddresses(user.user.username)).toEqual(full.items);
      expect(storedAddressChanges(user.user.username)).toEqual(changes);
      expect(storedAddressState(user.user.username)).toEqual(state);
    }
  });

  test('E2E-12-29 identical stale edit succeeds without bump; divergent stale edit/delete never change data', regression,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      const item = await add(user, syntheticAddress({ label: null }));
      const fresh = await expectAddressBook(await user.update(item.id, addressEdit(item, { city: 'New City' })));
      const changes = storedAddressChanges(user.user.username);
      const state = storedAddressState(user.user.username);
      expect(await expectAddressBook(await user.update(item.id, addressEdit(fresh.items[0], { version: 0 })))).toEqual(fresh);
      expect(storedAddressState(user.user.username)).toEqual(state);
      const padded = (value: string) => `  ${value.replace(/ /g, '   ')}  `;
      for (const label of [null, '   ']) {
        const normalizedEqual = addressEdit(fresh.items[0], { version: item.version, label,
          recipientName: padded(item.recipientName), mobile: `  ${item.mobile}  `,
          addressLine: padded(item.addressLine), city: padded(fresh.items[0].city) });
        expect(await expectAddressBook(await user.update(item.id, normalizedEqual))).toEqual(fresh);
        expect(storedAddressState(user.user.username)).toEqual(state);
      }
      await error(await user.update(item.id, addressEdit(item, { city: 'Old Tab', isDefault: false })), 409, 'STALE_UPDATE');
      await error(await user.remove(item.id, item.version), 409, 'STALE_UPDATE');
      expect(storedAddresses(user.user.username)).toEqual(fresh.items);
      expect(storedAddressChanges(user.user.username)).toEqual(changes);
      expect(storedAddressState(user.user.username)).toEqual(state);
    });

  test('E2E-12-30 deletion breaks creation-time ties by PostgreSQL UUID order and deleting all leaves no default', t5,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      // Java UUID.compareTo puts 8000 before 7fff; PostgreSQL's unsigned order does the reverse.
      const lowerId = '7fffffff-ffff-ffff-ffff-ffffffffffff';
      const higherId = '80000000-0000-0000-0000-000000000000';
      await add(user, syntheticAddress({ id: lowerId }));
      await add(user, syntheticAddress({ id: higherId }));
      await add(user, syntheticAddress({ isDefault: true }));
      const schema = checkedTarget('tied address creation times', user.user.username);
      expect(psql(`UPDATE ${schema}.saved_addresses a SET created_at = '2026-01-01T00:00:00Z'
        FROM ${schema}.users u WHERE a.user_id = u.id AND u.username = '${user.user.username}'
          AND a.id IN ('${lowerId}', '${higherId}');`)).toBe('');
      const before = await user.book();
      expect(before.items.slice(0, 2).map(({ id }) => id)).toEqual([lowerId, higherId]);
      const currentDefault = before.items.find(({ isDefault }) => isDefault)!;
      const oldest = before.items.find(({ id }) => id === lowerId)!;
      const removed = await expectAddressBook(await user.remove(currentDefault.id, currentDefault.version));
      expect(removed.items[0]).toEqual({ ...oldest, isDefault: true, version: oldest.version + 1 });
      await error(await user.update(oldest.id, addressEdit(oldest, { city: 'Stale Successor' })), 409, 'STALE_UPDATE');
      const nondefault = removed.items.find(({ isDefault }) => !isDefault)!;
      const one = await expectAddressBook(await user.remove(nondefault.id, nondefault.version));
      expect(one.items).toEqual([removed.items[0]]);
      expect((await expectAddressBook(await user.remove(one.items[0].id, one.items[0].version))).items).toEqual([]);
      expect(storedAddresses(user.user.username)).toEqual([]);
      expect(storedAddressChanges(user.user.username)).toHaveLength(3);
    });

  test('E2E-12-31 retry after deletion deliberately re-creates and counts again (A10)', regression, async ({ request }) => {
    const user = await AddressApi.register(request);
    const draft = syntheticAddress();
    const item = await add(user, draft);
    await expectAddressBook(await user.remove(item.id, item.version));
    const recreated = await expectAddressBook(await user.create(draft), 201);
    expect(recreated.items).toEqual([item]);
    expect(storedAddresses(user.user.username)).toEqual(recreated.items);
    expect(storedAddressChanges(user.user.username)).toHaveLength(2);
  });

  test('E2E-12-32 closure rechecks the current account state; all mutations and no-op retries refuse',
    { tag: [...t6.tag, '@cross-11-12', '@security'] }, async ({ request }) => {
      const user = await AddressApi.register(request);
      const draft = syntheticAddress();
      const item = await add(user, draft);
      const before = storedAddresses(user.user.username);
      const changes = storedAddressChanges(user.user.username);
      const state = storedAddressState(user.user.username);
      await user.bearer();
      setAccountState(user.user.username, 'CLOSURE_REQUESTED');
      const closing = await user.book();
      expect(closing.accountState).toBe('CLOSURE_REQUESTED');
      expect(closing.items).toEqual(before);
      for (const response of [await user.create(syntheticAddress()), await user.create(draft),
        await user.update(item.id, addressEdit(item)), await user.update(item.id, addressEdit(item, { city: 'Closing Edit' })),
        await user.remove(item.id, item.version)]) await error(response, 409, 'ACCOUNT_CLOSING');
      expect(storedAddressState(user.user.username)).toEqual(state);
      // Parsing remains before the service guard; valid JSON field validation remains after it.
      for (const [fields, status, code] of [
        [{ unexpected: true }, 400, 'INVALID_REQUEST'], [{ city: '' }, 409, 'ACCOUNT_CLOSING'],
      ] as const) {
        await error(await user.create({ ...draft, ...fields }), status, code);
        expect(storedAddresses(user.user.username)).toEqual(before);
        expect(storedAddressChanges(user.user.username)).toEqual(changes);
        expect(storedAddressState(user.user.username)).toEqual(state);
        await error(await user.update(item.id, { ...addressEdit(item), ...fields }), status, code);
        expect(storedAddresses(user.user.username)).toEqual(before);
        expect(storedAddressChanges(user.user.username)).toEqual(changes);
        expect(storedAddressState(user.user.username)).toEqual(state);
      }
    });

  test('E2E-12-33 foreign ids equal missing ids and create identity is independently scoped per User', security,
    async ({ request }) => {
      const owner = await AddressApi.register(request);
      const intruder = await AddressApi.register(request);
      const draft = syntheticAddress();
      const item = await add(owner, draft);
      const state = storedAddressState(owner.user.username);
      for (const id of [item.id, randomUUID()]) {
        const updated = await intruder.update(id, addressEdit(item, { city: 'Intruder' }));
        const removed = await intruder.remove(id, 0);
        for (const response of [updated, removed]) {
          await error(response, 404, 'NOT_FOUND');
          for (const value of [item.recipientName, item.mobile, item.addressLine]) expect(await response.text()).not.toContain(value);
        }
      }
      expect(storedAddressState(owner.user.username)).toEqual(state);
      // A global replay lookup could accept divergent fields yet leak a matching foreign row as a 200 replay.
      const matchingUser = await AddressApi.register(request);
      const matching = await add(matchingUser, draft);
      expect((await matchingUser.book()).items).toEqual([matching]);
      expect(storedAddressChanges(matchingUser.user.username)).toHaveLength(1);
      expect(storedAddressState(owner.user.username)).toEqual(state);
      const own = await add(intruder, syntheticAddress({ id: item.id, city: 'Independent City' }));
      expect(own.id).toBe(item.id);
      expect((await intruder.book()).items).toEqual([own]);
      expect(storedAddressState(owner.user.username)).toEqual(state);
      expect(storedAddressChanges(intruder.user.username)).toHaveLength(1);
    });

  for (const role of ['ADMIN', 'MODERATOR'] as const) {
    test(`E2E-12-34 ${role} enrollment and verification restrictions apply to every address route`, security,
      async ({ request }) => {
        const user = await registerByApi(request);
        grantRole(user.username, role);
        const session = await ApiSession.signIn(user);
        try {
          const item = { ...syntheticAddress(), version: 0 };
          expect(session.mfa).toBe('ENROLLMENT_REQUIRED');
          for (const answer of await Promise.all(everyRoute(request, { Authorization: `Bearer ${session.accessToken}` }, item))) {
            await error(answer, 403, 'MFA_REQUIRED');
          }
          await session.enroll();
          const restricted = await ApiSession.signIn(user);
          try {
            expect(restricted.mfa).toBe('VERIFICATION_REQUIRED');
            for (const answer of await Promise.all(everyRoute(request, { Authorization: `Bearer ${restricted.accessToken}` }, item))) {
              await error(answer, 403, 'MFA_REQUIRED');
            }
          } finally { await restricted.dispose(); }
        } finally { await session.dispose(); }
        expect(storedAddresses(user.username)).toEqual([]);
        expect(storedAddressChanges(user.username)).toEqual([]);
      });
  }

  test('E2E-12-35 CORS preflights admit the storefront origin; correlation is server-generated', security,
    async ({ request }) => {
      const id = randomUUID();
      for (const [path, method] of [[addressesPath, 'GET'], [addressesPath, 'POST'],
        [`${addressesPath}/${id}`, 'PUT'], [`${addressesPath}/${id}?version=0`, 'DELETE']]) {
        const answer = await request.fetch(`${apiUrl}${path}`, { method: 'OPTIONS', headers: { Origin: frontendUrl,
          'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'authorization,content-type' } });
        expect(answer.status()).toBe(200);
        expect(answer.headers()['access-control-allow-origin']).toBe(frontendUrl);
        expect(answer.headers()['access-control-allow-methods'].split(/\s*,\s*/)).toContain(method);
      }
      const denied = await request.fetch(`${apiUrl}${addressesPath}`, { method: 'OPTIONS', headers: {
        Origin: frontendUrl.replace('127.0.0.1', 'localhost'), 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type' } });
      expect(denied.status()).toBe(403);
      expect(denied.headers()['access-control-allow-origin']).toBeUndefined();
      const user = await AddressApi.register(request);
      const response = await request.get(`${apiUrl}${addressesPath}`, { headers: await user.headers({ Origin: frontendUrl,
        'X-Request-ID': user.user.password }) });
      await expectAddressBook(response);
      // RequestCorrelationFilter generates a UUID and never derives it from an incoming header.
      expect(response.headers()['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const headers = JSON.stringify(response.headers());
      const log = readFileSync(apiLogPath, 'utf8');
      for (const secret of [user.user.password, user.user.email, user.user.mobile, await user.bearer()].flatMap(encodedForms)) {
        expect(headers).not.toContain(secret);
        expect(log).not.toContain(secret);
      }
    });

  test('E2E-12-36 parallel identical creates replay once and parallel divergent ids conflict without extra rows', concurrent,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      await user.bearer();
      const draft = syntheticAddress();
      const same = await Promise.all([user.create(draft), user.create(draft)]);
      expect(same.map((response) => response.status()).sort()).toEqual([200, 201]);
      const first = { ...draft, ...normalizedFields(draft), isDefault: true, version: 0 };
      for (const response of same) {
        expect((await expectAddressBook(response, response.status() as 200 | 201)).items).toEqual([first]);
      }
      expect(storedAddresses(user.user.username)).toEqual([first]);
      expect(storedAddressChanges(user.user.username)).toHaveLength(1);
      const next = syntheticAddress();
      const attempts = [next, { ...next, city: 'Different Intent' }];
      const divergent = await Promise.all(attempts.map((attempt) => user.create(attempt)));
      expect(divergent.map((response) => response.status()).sort()).toEqual([201, 409]);
      await error(divergent.find((response) => response.status() === 409)!, 409, 'ID_CONFLICT');
      const winnerIndex = divergent.findIndex((response) => response.status() === 201);
      const expected = [first, { ...attempts[winnerIndex], ...normalizedFields(attempts[winnerIndex]), version: 0 }];
      expect((await expectAddressBook(divergent[winnerIndex], 201)).items).toEqual(expected);
      const final = await user.book();
      expect(final.items).toEqual(expected);
      expect(storedAddresses(user.user.username)).toEqual(final.items);
      expect(storedAddressChanges(user.user.username)).toHaveLength(2);
    });

  test('E2E-12-37 racing divergent edits admit one winner; identical retry then remains a no-op', concurrent,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      const item = await add(user);
      const cities = ['Race A', 'Race B'];
      const answers = await Promise.all(cities.map((city) => user.update(item.id, addressEdit(item, { city }))));
      expect(answers.map((response) => response.status()).sort()).toEqual([200, 409]);
      const winnerIndex = answers.findIndex((response) => response.status() === 200);
      const winner = await expectAddressBook(answers[winnerIndex]);
      expect(winner.items).toEqual([{ ...item, city: cities[winnerIndex], version: item.version + 1 }]);
      await error(answers.find((response) => response.status() === 409)!, 409, 'STALE_UPDATE');
      const state = storedAddressState(user.user.username);
      const identical = addressEdit(winner.items[0], { version: 0 });
      const retries = await Promise.all([user.update(item.id, identical), user.update(item.id, identical)]);
      for (const response of retries) expect((await expectAddressBook(response)).items).toEqual(winner.items);
      expect(storedAddresses(user.user.username)).toEqual(winner.items);
      expect(storedAddressChanges(user.user.username)).toHaveLength(2);
      expect(storedAddressState(user.user.username)).toEqual(state);
    });

  test('E2E-12-38 two independent changes racing the fifth allowance admit exactly one without stale-version overlap', concurrent,
    async ({ request }) => {
      assertAwayFromDhakaPeriodStart();
      const user = await AddressApi.register(request);
      await add(user);
      await add(user);
      let book = await user.book();
      for (const city of ['Third Change', 'Fourth Change']) {
        book = await expectAddressBook(await user.update(book.items[0].id, addressEdit(book.items[0], { city })));
      }
      const contexts = await Promise.all([apiRequest.newContext(), apiRequest.newContext()]);
      try {
        const clients = contexts.map((context) => AddressApi.forUser(context, user.user));
        await Promise.all(clients.map((client) => client.bearer()));
        const answers = await Promise.all(book.items.map((item, index) => clients[index].update(item.id,
          addressEdit(item, { city: `Race Limit ${index}` }))));
        expect(answers.map((response) => response.status()).sort()).toEqual([200, 409]);
        await error(answers.find((response) => response.status() === 409)!, 409, 'ADDRESS_CHANGE_LIMIT_REACHED');
        const winnerIndex = answers.findIndex((response) => response.status() === 200);
        const expected = book.items.map((item, index) => index === winnerIndex
          ? { ...item, city: `Race Limit ${index}`, version: item.version + 1 } : item);
        expect((await expectAddressBook(answers[winnerIndex])).items).toEqual(expected);
        const final = await user.book();
        expect(final.items).toEqual(expected);
        expect(final.changeAllowance).toMatchObject({ remainingThisWeek: 0, remainingThisMonth: 5 });
        expect(storedAddresses(user.user.username)).toEqual(final.items);
        expect(storedAddressChanges(user.user.username)).toHaveLength(5);
      } finally { await Promise.all(contexts.map((context) => context.dispose())); }
    });

  test('E2E-12-39 cap, validation, ownership, identity and stale refusals precede the exhausted allowance', t6,
    async ({ request }) => {
      assertAwayFromDhakaPeriodStart();
      const user = await AddressApi.register(request);
      const full = await reachFive(user);
      const item = full.items[0];
      const schema = checkedTarget('expired change refusal fixture', user.user.username);
      const expiredId = randomUUID();
      expect(psql(`INSERT INTO ${schema}.saved_address_changes (id, user_id, changed_at)`
        + ` SELECT '${expiredId}'::uuid, id, '2000-01-01T00:00:00Z'::timestamptz FROM ${schema}.users`
        + ` WHERE username = '${user.user.username}' RETURNING id;`)).toBe(expiredId);
      const changes = storedAddressChanges(user.user.username);
      const state = storedAddressState(user.user.username);
      expect(state.changes).toHaveLength(6);
      await error(await user.create(syntheticAddress()), 409, 'ADDRESS_BOOK_FULL');
      await error(await user.create(syntheticAddress({ id: item.id })), 409, 'ID_CONFLICT');
      await error(await user.update(item.id, addressEdit(item, { city: '' })), 400, 'INVALID_REQUEST');
      await error(await user.update(randomUUID(), addressEdit(item, { city: 'Unknown' })), 404, 'NOT_FOUND');
      await error(await user.update(item.id, addressEdit(item, { version: 0, city: 'Stale', isDefault: false })), 409, 'STALE_UPDATE');
      await error(await user.update(item.id, addressEdit(item, { isDefault: false })), 400, 'INVALID_REQUEST');
      // The valid edit reaches prune/count; a limit refusal must roll the expired-row delete back.
      await error(await user.update(item.id, addressEdit(item, { city: 'Limit Refused City' })),
        409, 'ADDRESS_CHANGE_LIMIT_REACHED');
      expect(await user.book()).toEqual(full);
      expect(storedAddressChanges(user.user.username)).toEqual(changes);
      expect(storedAddressState(user.user.username)).toEqual(state);
    });

  test('E2E-12-48 reads, retries and removal retain expired history; counted create/edit prune only expired rows', t6,
    async ({ request }) => {
      assertAwayFromDhakaPeriodStart();
      const user = await AddressApi.register(request);
      const first = await add(user);
      const replayDraft = syntheticAddress({ label: 'Replay Fixture' });
      const second = await add(user, replayDraft);
      const edited = await expectAddressBook(await user.update(first.id, addressEdit(first, { city: 'Earlier Edit' })));
      const current = edited.items[0];
      const schema = checkedTarget('expired change retention fixture', user.user.username);
      const expiredId = randomUUID();
      expect(psql(`INSERT INTO ${schema}.saved_address_changes (id, user_id, changed_at)`
        + ` SELECT '${expiredId}'::uuid, id, '2000-01-01T00:00:00Z'::timestamptz FROM ${schema}.users`
        + ` WHERE username = '${user.user.username}' RETURNING id;`)).toBe(expiredId);
      const seeded = storedAddressState(user.user.username);
      expect(seeded.changes).toHaveLength(4);
      expect(seeded.changes.some(({ id }) => id === expiredId)).toBe(true);
      expect(await user.book()).toEqual(edited);
      expect(storedAddressState(user.user.username)).toEqual(seeded);
      expect(await expectAddressBook(await user.create(replayDraft))).toEqual(edited);
      expect(storedAddressState(user.user.username)).toEqual(seeded);
      expect(await expectAddressBook(await user.update(current.id, addressEdit(current, { version: 0 })))).toEqual(edited);
      expect(storedAddressState(user.user.username)).toEqual(seeded);
      const removed = await expectAddressBook(await user.remove(second.id, second.version));
      expect(removed).toEqual({ ...edited, items: [current] });
      const afterRemoval = storedAddressState(user.user.username);
      expect(afterRemoval).toEqual({ addresses: seeded.addresses.filter(({ id }) => id !== second.id), changes: seeded.changes });

      await add(user, syntheticAddress({ label: 'Counted Create' }));
      const afterCreate = storedAddressState(user.user.username);
      const retained = seeded.changes.filter(({ id }) => id !== expiredId);
      expect(afterCreate.changes).toHaveLength(4);
      expect(afterCreate.changes.filter(({ id }) => retained.some((row) => row.id === id))).toEqual(retained);
      expect(afterCreate.changes.some(({ id }) => id === expiredId)).toBe(false);
      expect(afterCreate.addresses.find(({ id }) => id === current.id)).toEqual(afterRemoval.addresses[0]);
      expect((await user.book()).changeAllowance).toEqual({ perWeek: 5, perMonth: 10, remainingThisWeek: 1, remainingThisMonth: 6 });

      const editExpiredId = randomUUID();
      expect(psql(`INSERT INTO ${schema}.saved_address_changes (id, user_id, changed_at)`
        + ` SELECT '${editExpiredId}'::uuid, id, '2000-01-01T00:00:00Z'::timestamptz FROM ${schema}.users`
        + ` WHERE username = '${user.user.username}' RETURNING id;`)).toBe(editExpiredId);
      expect(storedAddressState(user.user.username).changes).toHaveLength(5);
      const final = await expectAddressBook(await user.update(current.id, addressEdit(current, { city: 'Counted Edit' })));
      expect(final.items).toEqual(storedAddresses(user.user.username));
      expect(final.items[0]).toEqual({ ...current, city: 'Counted Edit', version: current.version + 1 });
      expect(final.changeAllowance).toEqual({ perWeek: 5, perMonth: 10, remainingThisWeek: 0, remainingThisMonth: 5 });
      const afterEdit = storedAddressState(user.user.username);
      expect(afterEdit.changes).toHaveLength(5);
      expect(afterEdit.changes.filter(({ id }) => afterCreate.changes.some((row) => row.id === id))).toEqual(afterCreate.changes);
      expect(afterEdit.changes.some(({ id }) => id === editExpiredId)).toBe(false);
      expect(afterEdit.addresses.find(({ id }) => id !== current.id)).toEqual(afterCreate.addresses.find(({ id }) => id !== current.id));
    });

  test('E2E-12-49 counted create/edit retain the earlier Dhaka window boundary and count each window independently', t6,
    async ({ request }) => {
      const now = new Date();
      assertAwayFromDhakaPeriodStart(now);
      // Independent UTC arithmetic for the accepted UTC+6 Dhaka calendar; no response provides this oracle.
      const offset = 6 * 60 * 60 * 1_000;
      const dhaka = new Date(now.getTime() + offset);
      const midnight = Date.UTC(dhaka.getUTCFullYear(), dhaka.getUTCMonth(), dhaka.getUTCDate());
      const weekStart = midnight - ((dhaka.getUTCDay() + 6) % 7) * 86_400_000 - offset;
      const monthStart = Date.UTC(dhaka.getUTCFullYear(), dhaka.getUTCMonth(), 1) - offset;
      const cutoff = Math.min(weekStart, monthStart);
      const allowance = (currentChanges: number) => ({ perWeek: 5, perMonth: 10,
        remainingThisWeek: 5 - currentChanges - Number(cutoff >= weekStart),
        remainingThisMonth: 10 - currentChanges - Number(cutoff >= monthStart) });
      const user = await AddressApi.register(request);
      const first = await add(user);
      const schema = checkedTarget('earlier window boundary fixture', user.user.username);
      const boundaryId = randomUUID();
      expect(psql(`INSERT INTO ${schema}.saved_address_changes (id, user_id, changed_at)`
        + ` SELECT '${boundaryId}'::uuid, id, '${new Date(cutoff).toISOString()}'::timestamptz FROM ${schema}.users`
        + ` WHERE username = '${user.user.username}' RETURNING id;`)).toBe(boundaryId);
      const seeded = storedAddressState(user.user.username);
      expect(seeded.changes).toHaveLength(2);
      expect(seeded.changes.find(({ id }) => id === boundaryId)).toMatchObject({
        changed_at: expect.any(String), user_id: expect.any(String) });
      expect(Date.parse(String(seeded.changes.find(({ id }) => id === boundaryId)!.changed_at))).toBe(cutoff);
      expect(await user.book()).toEqual({ accountState: 'ACTIVE', limit: 3, items: [first],
        changeAllowance: allowance(1) });
      expect(storedAddressState(user.user.username)).toEqual(seeded);

      const secondDraft = syntheticAddress({ label: 'Boundary Retention' });
      const second = { ...normalizedFields(secondDraft), id: secondDraft.id, isDefault: false, version: 0 };
      const created = await expectAddressBook(await user.create(secondDraft), 201);
      expect(created).toEqual({ accountState: 'ACTIVE', limit: 3, items: [first, second],
        changeAllowance: allowance(2) });
      expect(storedAddresses(user.user.username)).toEqual(created.items);
      const afterCreate = storedAddressState(user.user.username);
      expect(afterCreate.changes).toHaveLength(3);
      expect(afterCreate.changes.filter(({ id }) => seeded.changes.some((row) => row.id === id))).toEqual(seeded.changes);
      expect(afterCreate.addresses.find(({ id }) => id === first.id)).toEqual(seeded.addresses[0]);
      expect(await user.book()).toEqual(created);

      const edited = { ...first, city: 'Boundary Retained Edit', version: first.version + 1 };
      const final = await expectAddressBook(await user.update(first.id, addressEdit(first, { city: edited.city })));
      expect(final).toEqual({ accountState: 'ACTIVE', limit: 3, items: [edited, second],
        changeAllowance: allowance(3) });
      expect(storedAddresses(user.user.username)).toEqual(final.items);
      const afterEdit = storedAddressState(user.user.username);
      expect(afterEdit.changes).toHaveLength(4);
      expect(afterEdit.changes.filter(({ id }) => afterCreate.changes.some((row) => row.id === id))).toEqual(afterCreate.changes);
      expect(afterEdit.addresses.find(({ id }) => id === second.id)).toEqual(afterCreate.addresses.find(({ id }) => id === second.id));
      expect(await user.book()).toEqual(final);
    });

  test('E2E-12-40 address recipient/mobile remain independent from profile edits and staged account mobile changes',
    { tag: [...regression.tag, '@cross-11-12'] }, async ({ request }) => {
      const user = await AddressApi.register(request);
      await add(user, syntheticAddress({ mobile: user.user.mobile }));
      const before = storedAddresses(user.user.username);
      const changes = storedAddressChanges(user.user.username);
      const profile = ProfileApi.forUser(request, user.user);
      await profile.save({ fullName: 'Independent Profile Name' });
      expect((await profile.stage({ mobile: syntheticAddress().mobile })).status()).toBe(202);
      expect(storedAddresses(user.user.username)).toEqual(before);
      expect(storedAddressChanges(user.user.username)).toEqual(changes);
      expect((await user.book()).items).toEqual(before);
    });

  test('E2E-12-41 parallel moves of two non-defaults preserve exactly one default and bump each changed row once', concurrent,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      await add(user);
      await add(user);
      await add(user);
      const before = await user.book();
      const candidates = before.items.filter(({ isDefault }) => !isDefault);
      const answers = await Promise.all(candidates.map((item) => user.update(item.id, addressEdit(item, { isDefault: true }))));
      const responses = await Promise.all(answers.map((response) => expectAddressBook(response)));
      for (const [index, response] of responses.entries()) {
        expect(response.items.find(({ id }) => id === candidates[index].id))
          .toEqual({ ...candidates[index], isDefault: true, version: candidates[index].version + 1 });
      }
      const final = await user.book();
      const finalDefault = final.items.find(({ isDefault }) => isDefault)!;
      expect(candidates.map(({ id }) => id)).toContain(finalDefault.id);
      expect(final.items).toEqual(before.items.map((item) => ({ ...item,
        isDefault: item.id === finalDefault.id,
        version: item.version + (item.isDefault || item.id === finalDefault.id ? 1 : 2) })));
      for (const [index, response] of responses.entries()) {
        const candidate = candidates[index];
        const expected = candidate.id === finalDefault.id ? final.items : before.items.map((item) => ({ ...item,
          isDefault: item.id === candidate.id,
          version: item.version + (item.isDefault || item.id === candidate.id ? 1 : 0) }));
        expect(response.items).toEqual(expected);
      }
      expect(storedAddresses(user.user.username)).toEqual(final.items);
      expect(storedAddressChanges(user.user.username)).toHaveLength(5);
    });

  test('E2E-12-42 safe Bengali address text persists unchanged on the required UTF8 database', t5,
    async ({ request }) => {
      const user = await AddressApi.register(request);
      const item = await add(user, syntheticAddress({ label: 'বাড়ি', recipientName: 'রহিম উদ্দিন',
        addressLine: 'বাড়ি ১২, সড়ক ৫, ধানমন্ডি', city: 'ঢাকা' }));
      expect(item).toMatchObject({ label: 'বাড়ি', recipientName: 'রহিম উদ্দিন', addressLine: 'বাড়ি ১২, সড়ক ৫, ধানমন্ডি', city: 'ঢাকা' });
      expect((await user.book()).items).toEqual([item]);
      expect(storedAddresses(user.user.username)).toEqual([item]);
    });

  test('E2E-12-43 a default removal racing a default move leaves a coherent book and honest stale refusal', concurrent,
    async ({ request }) => {
      assertAwayFromDhakaPeriodStart();
      const user = await AddressApi.register(request);
      await add(user);
      await add(user);
      const before = await user.book();
      const first = before.items[0];
      const second = before.items[1];
      const [removed, moved] = await Promise.all([user.remove(first.id, first.version),
        user.update(second.id, addressEdit(second, { isDefault: true }))]);
      const movedBook = await expectAddressBook(moved);
      const promoted = { ...second, isDefault: true, version: second.version + 1 };
      let expected: AddressBook;
      if (removed.status() === 200) {
        // Removal wins: it promotes the second row, so the stale-but-identical move is a no-op.
        expected = { ...before, items: [promoted] };
        expect(await expectAddressBook(removed)).toEqual(expected);
      } else {
        // Move wins: it demotes and bumps the first row, making the submitted removal stale.
        await error(removed, 409, 'STALE_UPDATE');
        expected = { ...before, items: [{ ...first, isDefault: false, version: first.version + 1 }, promoted],
          changeAllowance: { ...before.changeAllowance,
            remainingThisWeek: before.changeAllowance.remainingThisWeek - 1,
            remainingThisMonth: before.changeAllowance.remainingThisMonth - 1 } };
      }
      expect(movedBook).toEqual(expected);
      const final = await user.book();
      expect(final).toEqual(expected);
      expect(storedAddresses(user.user.username)).toEqual(expected.items);
      // If removal promoted the second address first, the matching edit is an identical no-op.
      expect(storedAddressChanges(user.user.username)).toHaveLength(removed.status() === 200 ? 2 : 3);
    });

  test('E2E-12-44 every response reports enforced allowance; a two-row default move counts one change', t5,
    async ({ request }) => {
      assertAwayFromDhakaPeriodStart();
      const user = await AddressApi.register(request);
      const allowance = (book: AddressBook, count: number) => {
        expect(book.changeAllowance).toEqual({ perWeek: 5, perMonth: 10,
          remainingThisWeek: 5 - count, remainingThisMonth: 10 - count });
        expect(storedAddressChanges(user.user.username)).toHaveLength(count);
      };
      allowance(await user.book(), 0);
      const draft = syntheticAddress();
      let book = await expectAddressBook(await user.create(draft), 201);
      allowance(book, 1);
      book = await expectAddressBook(await user.create(syntheticAddress()), 201);
      allowance(book, 2);
      const second = book.items[1];
      book = await expectAddressBook(await user.update(second.id, addressEdit(second, { isDefault: true })));
      allowance(book, 3);
      expect(book.items.map(({ version }) => version)).toEqual([1, 1]);
      book = await expectAddressBook(await user.create(draft));
      allowance(book, 3);
      book = await expectAddressBook(await user.update(second.id, addressEdit(book.items[1], { version: 0 })));
      allowance(book, 3);
      book = await expectAddressBook(await user.remove(book.items[0].id, book.items[0].version));
      allowance(book, 3);
      await error(await user.update(second.id, addressEdit(book.items[0], { city: '' })), 400, 'INVALID_REQUEST');
      allowance(await user.book(), 3);
      book = await expectAddressBook(await user.create(syntheticAddress()), 201);
      allowance(book, 4);
      book = await expectAddressBook(await user.update(second.id, addressEdit(book.items[0], { city: 'Fifth Allowance' })));
      allowance(book, 5);
      await error(await user.update(second.id, addressEdit(book.items[0], { city: 'Sixth Allowance' })), 409, 'ADDRESS_CHANGE_LIMIT_REACHED');
      allowance(await user.book(), 5);
      expect(storedAddresses(user.user.username)).toEqual(book.items);
    });

  test('E2E-12-46 all four routes accept Bearer alone without refresh cookies or CSRF headers', security,
    async ({ request }) => {
      assertAwayFromDhakaPeriodStart();
      const user = await AddressApi.register(request);
      // Each request has a fresh cookie jar; any response cookies cannot authenticate the next route.
      // Authentication and short-token renewal occur only in the donor context.
      const bearerBook = async (call: (context: APIRequestContext, headers: Record<string, string>) => Promise<APIResponse>,
        status: 200 | 201 = 200) => {
        const context = await apiRequest.newContext();
        try {
          expect((await context.storageState()).cookies.length, 'raw address context has no cookies').toBe(0);
          const token = await user.bearer();
          const { exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp: unknown };
          expect(typeof exp === 'number' && Date.now() + 1_000 < exp * 1_000,
            'cookie-free request uses a fresh access token with a one-second margin').toBe(true);
          return await expectAddressBook(await call(context, { Authorization: `Bearer ${token}` }), status);
        } finally { await context.dispose(); }
      };
      const expected = (items: SavedAddress[], count: number): AddressBook => ({
        accountState: 'ACTIVE', limit: 3, items,
        changeAllowance: { perWeek: 5, perMonth: 10, remainingThisWeek: 5 - count, remainingThisMonth: 10 - count },
      });
      expect(await bearerBook((context, headers) => context.get(`${apiUrl}${addressesPath}`, { headers })))
        .toEqual(expected([], 0));
      const draft = syntheticAddress({ city: 'Cookie Free City' });
      const item = { ...normalizedFields(draft), id: draft.id, isDefault: true, version: 0 };
      expect(await bearerBook((context, headers) => context.post(`${apiUrl}${addressesPath}`,
        { headers, data: draft }), 201)).toEqual(expected([item], 1));
      expect(storedAddresses(user.user.username)).toEqual([item]);
      expect(storedAddressChanges(user.user.username)).toHaveLength(1);
      const edited = { ...item, city: 'Cookie Free Edit', version: 1 };
      expect(await bearerBook((context, headers) => context.put(`${apiUrl}${addressesPath}/${item.id}`,
        { headers, data: addressEdit(item, { city: edited.city }) }))).toEqual(expected([edited], 2));
      expect(storedAddresses(user.user.username)).toEqual([edited]);
      const changes = storedAddressChanges(user.user.username);
      expect(changes).toHaveLength(2);
      expect(await bearerBook((context, headers) => context.delete(`${apiUrl}${addressesPath}/${item.id}?version=1`,
        { headers }))).toEqual(expected([], 2));
      expect(storedAddresses(user.user.username)).toEqual([]);
      expect(storedAddressChanges(user.user.username)).toEqual(changes);
    });

  for (const role of ['CUSTOMER', 'DELIVERY_PERSON', 'MODERATOR', 'ADMIN'] as Role[]) {
    test(`E2E-12-45 ${role} owns a separately enforced five-change allowance`,
      { tag: [...t6.tag, '@cross-08-12', '@security'] }, async ({ request }) => {
        assertAwayFromDhakaPeriodStart();
        if (role === 'CUSTOMER') {
          const user = await AddressApi.register(request);
          const book = await reachFive(user);
          await error(await user.update(book.items[0].id, addressEdit(book.items[0], { city: 'Sixth Customer Change' })),
            409, 'ADDRESS_CHANGE_LIMIT_REACHED');
          expect(storedAddresses(user.user.username)).toEqual(book.items);
          expect(storedAddressChanges(user.user.username)).toHaveLength(5);
          return;
        }
        const actor = await apiStaff(request, role);
        try {
          let book = await expectAddressBook(await actor.session.call('GET', addressesPath));
          for (let count = 0; count < 3; count++) {
            book = await expectAddressBook(await actor.session.call('POST', addressesPath, { data: syntheticAddress() }), 201);
          }
          for (const city of ['Fourth Staff Change', 'Fifth Staff Change']) {
            const item = book.items[0];
            book = await expectAddressBook(await actor.session.call('PUT', `${addressesPath}/${item.id}`,
              { data: addressEdit(item, { city }) }));
          }
          const item = book.items[0];
          await error(await actor.session.call('PUT', `${addressesPath}/${item.id}`,
            { data: addressEdit(item, { city: 'Sixth Staff Change' }) }), 409, 'ADDRESS_CHANGE_LIMIT_REACHED');
          expect(storedAddresses(actor.user.username)).toEqual(book.items);
          expect(storedAddressChanges(actor.user.username)).toHaveLength(5);
          expect((await expectAddressBook(await actor.session.call('GET', addressesPath))).changeAllowance.remainingThisWeek).toBe(0);
        } finally { await actor.session.dispose(); }
      });
  }
});

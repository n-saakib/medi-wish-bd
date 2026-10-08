# `tests/browser/catalogSupport.ts`

Source: [`../../../tests/browser/catalogSupport.ts`](../../../tests/browser/catalogSupport.ts)

## Purpose

These are the shared helpers of the Ticket 14 (staff Product catalog) browser specs; this file is not a spec. The specs import `test` and `expect` from here, not from `@playwright/test`.

## Contract strings

- `apiMessages` holds the exact error envelope messages the catalog routes return, by code: the existing `AUTHENTICATION_REQUIRED`, `ACCESS_DENIED`, `MFA_REQUIRED`, `INVALID_REQUEST` and `NOT_FOUND`, and the new `STALE_UPDATE` (`This record changed after you opened it. Reload and try again.`), `PRICE_REQUIRED`, `CATEGORY_NAME_TAKEN` and `ID_CONFLICT`.
- `copy` holds the English page copy the catalog screens must show: the saved, stale, not-found, empty and no-match states, the Moderator pricing note, each required-field and money message, and the Sale Unit hint. The Ticket 14 plan's §10 lists the same strings as its contract.

## Types and builders

- `Category`, `CategoryPage`, `ProductSummary`, `Product`, `ProductChange` and `ProductPage` are the response shapes; `categoryKeys`, `pageKeys`, `productSummaryKeys`, `productKeys` and `historyKeys` are their exact key lists, so any extra field (for example stock) fails a test.
- `token()` returns 8 hex characters that keep a test's names apart from every other test's; both browser projects share one API and schema.
- `medicineDraft(categoryId, overrides)` and `equipmentDraft(categoryId, overrides)` return synthetic create bodies with a new client UUID; an override set to `undefined` removes the field.
- `catalogBody(product, changes)` returns the full catalog `PUT` body for a loaded Product, never money or `kind`.

## API actors

- `ApiActor.open(http, kind)` registers a synthetic User, makes `ADMIN`, `MODERATOR` or `DELIVERY_PERSON` the only role of `admin`, `moderator`, `deliveryPerson` or `restrictedStaff` through [`grantRole`](testApi.ts.md) (a `customer` keeps the registered `CUSTOMER` role), and signs in. Admins and Moderators then enroll an authenticator through the API with a [`totp.ts`](totp.ts.md) code, so their session is verified; `restrictedStaff` is an Admin who has not enrolled.
- `authorization()` returns a current Bearer header from the actor's `TokenRenewal`, which renews the 10-second access token through `GET /api/auth/csrf` and `POST /api/auth/refresh` once it is older than 60% of its lifetime. Concurrent calls share one renewal, because a replayed refresh cookie revokes the session; a failed renewal fails every waiting call, and the next call starts a new one. `TokenRenewal` takes the refresh call, the clock and the lifetime as arguments, so [`tests/catalogSupport.test.ts`](../catalogSupport.test.ts.md) unit-tests it with a controlled clock.
- `send`, `get`, `post` and `put` send JSON with the Bearer header; a string body is sent exactly as written, for malformed-JSON cases. `sendJson` sends the same without credentials.
- `expectJson(response, status)` asserts the status and `Cache-Control: no-store`, and returns the body. `expectApiError(response, status, code)` asserts the bounded envelope: the code, its exact message, a request id, exactly those three keys unless the status is 400, and `Cache-Control: no-store`.
- `listCategories(actor, query)` returns one page of categories; `allCategories(actor, includeInactive)` reads every page at size 50 and `findCategory(actor, id)` finds one in it, because the shared schema may put a test's category on any page.
- `createCategory`, `updateCategory`, `createProduct`, `getProduct`, `updateProduct`, `priceProduct`, `listProducts` and `activeProduct` call the §4.2 routes and assert their success status.

## Fixtures and page helpers

- `test` adds two fixtures: `api`, a request context on the test API, and `actors(kind)`, which opens each actor on its own request context (its own refresh cookie) and disposes of them after the test.
- `staffContext(browser, role)` opens a new browser context with a verified Admin or Moderator, using `verifiedAdmin` and `verifiedModerator` from [`support.ts`](support.ts.md) (not duplicated here). The caller closes the returned context; if registration, sign-in or enrollment fails, the helper closes it before rethrowing, so a failed setup leaks no context.
- `productEditor(page)`, `productList(page)` and `categoryManager(page)` locate the catalog controls by their accessible labels and names; `categoryManager` includes the rows, the `Showing …` pager and **Previous**/**Next**. `showCategory(page, name)` finds a category row on the Categories page: on the current page, or by paging from the first, and returns it with its page number. It first waits for the save editor to close and the refreshed pager to become visible, because a click may return before the save request settles; the row must still become visible. `openProduct(page, product)` opens an editor and waits for its heading.
- `tabTo(page, target)` presses Tab until the target has focus, proving it is keyboard-reachable. `chooseWithArrowKeys(page, select, label)` picks an option in a focused native select with Home and ArrowDown only. `literal(text)` escapes text for a substring match.

`copy.moneyRange` holds the range message added on 2026-10-08.

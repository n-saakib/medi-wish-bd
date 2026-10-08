# `tests/browser/staffRolesPricing.spec.ts`

Source: [`../../../tests/browser/staffRolesPricing.spec.ts`](../../../tests/browser/staffRolesPricing.spec.ts)

## Purpose

Cross-ticket checks of Ticket 08 roles and Ticket 14 pricing (Ticket 08 plan §8.2, scenario A: Ticket 08 merged first, so Ticket 14 T6 owns them). Every User holds one role and pricing is Admin-only, so a demotion is the Super Admin replacing an Admin's role with MODERATOR or CUSTOMER. The tests call the API directly through [`apiSession.ts`](apiSession.ts.md) on the `chrome` and `msedge` projects, creating their own synthetic Users, category and unpriced MEDICINE Product.

## Tests

- **E2E-X-01** — a verified Moderator's `PUT /api/staff/products/{id}/pricing` is `403 ACCESS_DENIED` and changes nothing: an Admin then prices the Product at the version the Moderator saw.
- **E2E-X-02** — the Super Admin demotes Admin B to CUSTOMER through `PUT /api/admin/users/{B}/roles`. B's next pricing call with the still-unexpired token is `401 AUTHENTICATION_REQUIRED` and the session is revoked; after a fresh sign-in (`NOT_REQUIRED`) pricing and the staff Product list are `403 ACCESS_DENIED`.
- **E2E-X-03** — the same demotion to MODERATOR: the old session is revoked (`401`); after a fresh sign-in and authenticator code, pricing is still `403 ACCESS_DENIED` while the staff Product list stays readable.

No placeholder route is added; the tests need both tickets' routes on one revision.

## Running

`npm run test:browser -- --grep @cross-08-14` runs only these checks; the full browser suite includes them.

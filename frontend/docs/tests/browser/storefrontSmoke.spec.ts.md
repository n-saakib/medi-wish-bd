# `tests/browser/storefrontSmoke.spec.ts`

Source: [`../../../tests/browser/storefrontSmoke.spec.ts`](../../../tests/browser/storefrontSmoke.spec.ts)

Ticket 17 T7 smoke (plan T7 step 4), on the real jar, PostgreSQL and the built Next server.

- **E2E-17-18**: an Admin seeds one category with one active, priced Product. A guest opens `/categories/{id}`, which shows exactly that card, then follows the card link to `/products/{id}`, where the heading shows the Product's name and the one price block shows the API's current price. `/products/{random lower-case uuid}` answers 404 with the not-found page. The whole journey, seeding included, must finish in under 30 s, checked by elapsed wall time with no added timeout.

Tags: `@t17`, `@t17-T7`, `@t17-ui`, `@smoke`. It runs in the cumulative `npm run test:browser -- --grep @smoke` set, or alone with `--grep "E2E-17-18"`.

Written test-first before the storefront pages and routes existed. The production implementation is now present; current real-browser results are recorded in the Ticket 17 E2E report.

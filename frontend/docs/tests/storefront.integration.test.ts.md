# `tests/storefront.integration.test.ts`

Source: [`../../tests/storefront.integration.test.ts`](../../tests/storefront.integration.test.ts)

Fixture-free Ticket 17 adapter integration against the real backend. It requires `MEDI_WISH_API_URL` and constructs the production `createStorefrontClient` with that base URL. It checks that categories returns a non-null public category-list projection and validates every `{id, name}` category when present; the isolated test schema may have no category rows. It also checks that unknown Product, malformed Product and unknown category reads map the API's correlated `NOT_FOUND` responses to `null`.

The browser harness starts the isolated API for this project. Run it with `browser.ps1 -Suite integration -Label t5-integration`; no category, Product or account fixtures are created.

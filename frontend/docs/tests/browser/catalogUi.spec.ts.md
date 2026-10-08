# `tests/browser/catalogUi.spec.ts`

Source: [`../../../tests/browser/catalogUi.spec.ts`](../../../tests/browser/catalogUi.spec.ts)

## Purpose

Ticket 14's staff catalog pages in Chrome and Edge against the real test API: `/staff/categories`, `/staff/products`, `/staff/products/new` and `/staff/products/{id}`, with the copy from [`catalogSupport.ts`](catalogSupport.ts.md). Tests tagged `@t14-T3` need only the pages; `@t14-T5` tests need the pages and the API.

## Tests

- **E2E-14-04 (T3)** — the staff home links to Products and then Categories for Admins and Moderators.
- **E2E-14-05 (T3)** — signed-out visitors go to `/sign-in`, Customers to `/account` and unverified staff to `/staff/mfa/enroll` from every catalog page; each page is sent with `Cache-Control: no-store`.
- **E2E-14-06 (T3)** — a malformed product id shows `Product not found.` without calling the API.
- **E2E-14-31, 32** — rows are found with `showCategory`, since the shared schema may put them on any page; a Moderator adds, renames and deactivates a category with blank and duplicate names explained and no delete control; an Admin's stale category save shows the stale message and **Reload**.
- **E2E-14-33** — the main journey: a Moderator creates a Medicine, sees Pricing read-only and the price-required message on **Active**; an Admin saves pricing, activates, reloads and sees three history rows and the list row.
  Its inventory-field assertion excludes the accepted Sale Unit explanation “what one quantity means.” Its destination checks both the UUID path and configured frontend origin, preserving the locked environment without hard-coding a second port constant.
- **E2E-14-34 to 38** — Equipment without MRP through activation and deactivation; required-field errors as accessible descriptions; money and MRP errors, and exactly one pricing request when a second submission (a forced click and Enter) comes while the first is held in flight with `page.route`; the stale banner across two tabs; a Moderator editing a priced Product's details and review flag but never its prices.
- **E2E-14-39, 40** — list search, category, status and review filters, Taka formatting, `Showing 1–20 of 22` paging and the no-match state, with search terms kept out of URLs and the console; an unknown id shows `Product not found.`.
- **E2E-14-41, 42** — keyboard only: create (the category chosen with the arrow keys), price and activate, then edit the name and the price, with the amber focus ring, labelled fields and 44 × 44 px targets (buttons, links, inputs and selects by their box; checkboxes and radios by their label); at 375 px no catalog page scrolls sideways, the product table's own container does (`scrollWidth > clientWidth`) and its last column scrolls fully into view. Each list page is measured only after a row's **Edit** control shows, so a still-loading page cannot pass.
- **E2E-14-43 `@smoke`** — the shortest Admin path (category, Equipment, pricing, activation) and a Moderator seeing the price read-only.
- **E2E-14-48** — the Categories page shows 20 rows and `Showing 1–20 of n`; **Next** reaches the 21st of 21 `0 Paged …` categories on a later page, where it is renamed and deactivated; the page number never enters the address, and a reload starts on page 1.
- **E2E-14-49** — the new-product form shows no **Active** control, no Pricing section or price field and no history for either kind, even to an Admin, and its `POST` body has no `active`; the saved Product's edit form shows **Active** unchecked, `Needs price`, the Admin's editable Pricing with **Save pricing**, and one history row.
- **E2E-14-51** — after its category is deactivated, the category is not offered on the new-product form (checked once an active category created alongside it is listed, so the options have loaded), but the existing Product's editor shows it selected as `{name} (inactive)`; a Moderator saves a brand-name edit, the Product keeps the category, and a reload still shows it.
- **E2E-14-44** — an Admin page whose ADMIN role is replaced with CUSTOMER in SQL mid-session is refused pricing with an alert inside the editor's main landmark, keeps the typed value and changes nothing. Scoping excludes Next.js's separate route-announcement alert without freezing Ticket 08's shared error copy.

## Verification

The mobile fixture creates its own unique 80-character category, exercising the maximum accepted native-select option length in both browser projects. After internal table scrolling, the last cell may have at most 1% fractional border clipping while its entire Edit link must be visible; the page must have no horizontal overflow.

Run the T3 and T5 gates with `npm run test:browser -- --grep @t14-T3` or `--grep @t14-T5`, including earlier Ticket 14 gates. Dated Ticket 14 evidence records the executed checks and the separate cumulative browser gate; this mirror does not treat a focused rerun as full-story completion.

The existing product list/paging scenario also asserts computed text colors from the static design: Active rgb(23,122,59), Needs price rgb(154,91,0), Inactive rgb(90,110,103) and Review rgb(29,95,191), while retaining text visibility checks.

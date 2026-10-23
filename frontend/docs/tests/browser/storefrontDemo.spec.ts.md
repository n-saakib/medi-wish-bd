# `tests/browser/storefrontDemo.spec.ts`

Source: [`../../../tests/browser/storefrontDemo.spec.ts`](../../../tests/browser/storefrontDemo.spec.ts)

Ticket 17 opt-in demonstration, **E2E-17-22** (tags `@t17` and `@t17-demo`), following plan §1 demo steps 1–8 as one walkthrough with a `test.step` per step. It uses the same file-level skip as `discountDemo.spec.ts`: ordinary runs skip the file unless `MEDI_WISH_DEMO_DIR` is set, before the `beforeEach` Asia/Dhaka midnight guard or any fixture runs. Screenshots go to `<MEDI_WISH_DEMO_DIR>/<project>/NN-*.png` and are attached to the result.

Steps:

1. An Admin, through the API, creates "Demo Fever {token}" with 25 active medicines "Demo Med 01…25 {token}" (03 in lower case, 04 in upper case). Demo Med 05 requires review, is priced 150.00 with an MRP of 180.00, and has two uploaded images. A 10% Category Discount starts today.
2. The Admin creates "Demo Empty" (active, no Products) and "Demo Hidden" (one active Product), then deactivates "Demo Hidden".
3. On the guest's `/`, the header bar and the home grid equal the first 8 listable categories and include Demo Fever but not Demo Empty or Demo Hidden.
4. Opening Demo Fever from its tile shows 24 cards in name order, each with a "10% OFF" badge and a struck price. **Next** goes to `?page=2`, which holds the 25th Product.
5. **Previous** returns to page 1. Opening Demo Med 05 shows the breadcrumb, two thumbnails, ৳135.00, the struck ৳150.00, the badge, "MRP ৳180.00", the review note and the About section, and all of it is still there after a reload.
6. The Demo Hidden Product renders with a breadcrumb of "Home" only. The Demo Hidden category returns 404, the Demo Empty category returns 200 with its empty state, and Demo Fever `?page=3` returns 404.
7. Deactivating Demo Med 01 makes its open details page return 404 on reload.
8. `request.get('/products/{id}')`, without JavaScript, holds the `<title>`, the absolute canonical and the price.

Run only through the plan §2.6 harness: `browser.ps1 -Label t8-demo -Grep "@t17-demo" -Demo`. Run it alone, so that Demo Fever is among the first 8 categories.

Written test-first before the storefront existed. The isolated demonstration passed on Chrome and Edge on 2026-10-21 (`t12-demo-alone`, revision `c63359c` plus the working tree), with the previous medicine-specific review note. With the product-neutral note adopted on 2026-10-22, it passed alone on Chrome and Edge on 2026-10-22 (`t18-demo`, working tree on `c9568a6`). Keep the documented demo-only grep: an unfiltered demo-enabled cumulative run can legitimately fail its first-eight-category fixture guard. Current completion evidence is linked from the Ticket 17 E2E report.

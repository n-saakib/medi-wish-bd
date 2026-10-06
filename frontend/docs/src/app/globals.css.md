# `src/app/globals.css`

Source: [source](<../../../src/app/globals.css>).

## Purpose

Design tokens and only the components used by delivered storefront, account, authentication, staff MFA and Users and roles pages. Existing cards, alerts, headers, green/amber colors and 44 px controls remain. The Admin additions port card sections, responsive filters, locally scrollable tables, pager, labelled radio choice rows, history wrapping and text MFA chips from the static designs.

Every control has a 44 px target (radios use the full label); keyboard focus has the amber outline. Narrow filters and private headings wrap instead of overflowing the document. No prototype JavaScript, sample data or unused future styles are imported. Layout/focus evidence belongs to browser suites and manual QA.

The table wrapper is positioned so its absolutely positioned screen-reader-only column heading remains contained by the local horizontal scrollport. The 375 px manual review exposed a document width of 535 px before this fix; the mobile browser check protects document overflow.

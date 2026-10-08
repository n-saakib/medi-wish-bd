# `messages/en.json`

Source: [source](<../../messages/en.json>).

## Purpose

The English catalog supplies all user-visible text through `next-intl`. Server routes use `getTranslations`; client components use `useTranslations`. Message values contain presentation copy rather than credentials or backend diagnostics.

## Namespaces

- `metadata`, `header` and `home`: document titles, shell navigation, store preparation and sign-out notices.
- `signIn` and `register`: authentication fields, notices and submit states. Registration states the 3–20 character username rule and the 6–30 character password hint.
- `account`: current account labels, session loading, sign-out and **Edit profile** navigation.
- `profile`: profile metadata title, loading, editable field labels with the Email/Date of birth optional marker, the 11-digit New mobile hint, mobile verification chips, pending-number interpolation, stage/cancel controls, save/reload notices and client field errors. The mobile dialog explains that the current number stays active and text-message verification is coming later.
- `staffMfa` and `staffHome`: authenticator enrollment/challenge, once-only backup-code presentation, verified staff identity and the Users and roles, Products and Categories link names.
- `adminUsers`: Users and roles list/detail filters, rows, role labels and reasons, save/history and bounded failure copy (Ticket 08).
- `catalog` — Product list filters, row labels, editor fields, pricing, audit history, validation, stale/empty/loading/saved states and the BDT currency symbol used by `formatTaka`. Unset money uses “Not set”; filter text is “Any status”/“Needs price (not purchasable),” while chips stay concise. History distinguishes details edits and each review-flag direction.
- `categories` — category list, inline editor, paging and validation states.
- `errors`: bounded error-code copy, including `staleUpdate` (“This record changed after you opened it. Reload and try again.”), `accountClosing` (“Your account is closing.”) and `checkDetails` (“Check your details and try again.”), `priceRequired`, `categoryNameTaken`, `roleChangeRefused`, `accessDenied` and `notFound`, plus established authentication, duplicate-user, MFA, rate-limit and generic messages.

Only English is configured. Components interpolate the pending mobile directly into the owning profile copy; it remains transient UI state and is not stored or placed in a URL.

## Verification

Mounted tests assert catalog labels and bounded alerts. The production build resolves metadata and component keys. Ticket 11 browser checks assert the accepted copy and profile accessibility.
Externalized English next-intl messages for the delivered home/account/authentication/MFA/staff pages. `adminUsers` supplies list/detail filters, rows, role labels/reasons, save/history and bounded failure copy. `staffHome.usersAndRoles` names the Admin link; shared errors add staleUpdate, roleChangeRefused, accessDenied and notFound. Server diagnostics and private field values are never interpolated into error messages.

Product and Category stale-edit banners keep their feature-specific guidance next to the shared stale-update message. Catalog empty-page messages distinguish a page with no returned rows from an entirely empty catalog.

Accessibility additions (2026-10-08): `staffHome.staffPages` names the staff link landmark; `catalog.editProduct` titles the Product edit page; `catalog.editNamed` and `categories.editNamed` (`Edit {name}`) give each row's Edit control a distinct accessible name.

UX additions (2026-10-08): `catalog.moneyRange` (“Enter an amount from 0.01 to 9,999,999.99.”), `catalog.priceSetMrpRemoved` (“Price set to {price} (MRP removed) by {username}”) and `catalog.breadcrumb` for the Product editor's link back to Products. The user chose this copy on 2026-10-08.

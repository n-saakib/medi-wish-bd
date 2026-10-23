# `messages/en.json`

Source: [source](<../../messages/en.json>).

## Purpose

The English catalog supplies all user-visible text through `next-intl`. Server routes use `getTranslations`; client components use `useTranslations`. Message values contain presentation copy rather than credentials or backend diagnostics.

## Namespaces

- `metadata`, `header` and `home`: document titles, shell navigation, the storefront hero and sign-out notices.
- `signIn` and `register`: authentication fields, notices and submit states. Registration states the 6–30 character password hint and one message per refused field: `usernameInvalid`, `mobileInvalid`, `emailInvalid` and `passwordInvalid`; a server `INVALID_REQUEST` uses `errors.checkDetails`.
- `account`: current account labels, session loading, sign-out and **Edit profile** navigation.
- `profile`: profile metadata title, loading, editable field labels with the Email/Date of birth optional marker, the 11-digit New mobile hint, mobile verification chips, pending-number interpolation, stage/cancel controls, save, reload and mobile-change-cancelled notices and client field errors. The mobile dialog explains that the current number stays active and text-message verification is coming later.
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

Closing-pass additions (2026-10-08): `register.usernameInvalid`, `register.mobileInvalid`, `register.emailInvalid` and `register.passwordInvalid` replace the removed `register.invalid`; `catalog.priceRequiredModerator` (“An Admin must add a price before this product can be active.”) tells a Moderator who must price a Product.

Ticket 15 uses a separate productImages namespace for card/dialog labels, fallback alt descriptions, progress, confirmations, retry and stale-state notices. Shared errors add imageInvalid, imageLimitReached and storageUnavailable; diagnostics and filenames do not enter UI error copy.

## Ticket 16

Ticket 16 externalizes the discounts namespace for tab counts, table/dialog labels, field validation, loading/empty/retry/stale/save/unknown-outcome states and End now confirmation. Catalog gains applied-discount chips and derived history copy; staffHome gains Discounts; errors gains the two discount conflict messages. Accepted design omits preview and loses-to hints and links to existing Categories rather than repeating that page.

Unknown-create guidance requires retrying the original command before another change. Retry pending discount reopens the retained frozen command after Cancel; a list refresh alone does not establish its outcome.

Ticket 12 adds addresses for page/dialog labels, full/empty/recovery/default-promotion copy and a changeNotice interpolating configured calendar limits and remaining allowance. account.addresses names the navigation link. errors.addressBookFull and errors.addressChangeLimit supply bounded refusal copy.

## Ticket 05 email recovery

Ticket 05 adds forgotPassword form copy, sign-in link/reset notice, profile email verification/current-password copy and three bounded errors. All recovery-facing strings are localized here; help is plain support text until a support route is delivered.

## Ticket 09

`staffMfa.replaceTitle` and `replaceIntro` identify authenticator replacement. `staffMfa.contactNotice` supplies the four bounded notification outcome texts. `SENT` and `FAILED` refer to verified contacts because replacement may notify verified mobile and email; they expose no recipient details. `staffMfa.regenerate` supplies page metadata, heading, fresh-code explanation, field label, submit/busy copy and back link. `staffHome.backupCodes` names the navigation destination. English text uses typographic apostrophes and ellipses consistently; no recipient details or secrets are interpolated.

Ticket 09 also supplies recovery trigger/title/field/placeholder/help, local format error, Close/Cancel/Continue and checking-state copy under `staffMfa`. Exhausted-code help names the store owner, following accepted P12.

Ticket 17 adds request-time category navigation and server-rendered public Product details. The new storefront namespace externalizes category links, page counts, empty/not-found/error states, price/MRP labels, the conditional review note (product-neutral, because Equipment can also require validation; owner decision 2026-10-22, passed the Ticket 17 browser suites the same day), About fields, gallery controls and canonical descriptions. The home hero keeps its existing copy; the category bar and home grid hide on a failed shared read, while dedicated catalog routes show their generic error boundary.

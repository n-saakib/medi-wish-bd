# `messages/en.json`

Source: [`messages/en.json`](../../messages/en.json)

## Purpose

This is the English message catalog consumed by `next-intl`. All user-visible copy for the current pages lives here, so components contain no hard-coded translatable strings. Server components read it through `getTranslations` and client components through `useTranslations`.

## Message namespaces

- `metadata` — store name and description for the root layout's `generateMetadata`; the store name also fills the `%s · Medi Wish` title template.
- `header` — brand text, the account navigation's accessible label (`Account`), the `Sign in` link, the auth header's `Back to home` link and the staff header's `Sign out` button label.
- `home` — hero title and preparation copy (`Our online store is being prepared. Please check back soon.`), plus the sign-out result messages `signedOut` and `signOutError` and the `tryAgain` retry button shown by `SignOutNotice`.
- `signIn` — page title, identifier label (`Mobile, email or username`), password label, submit/busy button text, the link to registration, and the notices `sessionExpired`, `restoreError` and `accountCreated`.
- `register` — page title, field labels, the `(optional)` email marker, the `6–30 characters` password hint, submit/busy text, the link to sign-in, and `invalid`, which explains the username rule (3–50 allowed characters with at least one letter) when the API rejects a request as `INVALID_REQUEST`.
- `account` — account page title, the `Checking your session…` status shown while the session restores and the profile loads, profile labels and sign-out button/busy text.
- `staffMfa` — authenticator setup and code pages: page titles, step labels, the QR label, the `Can’t scan?` disclosure and key label, the code label and 6-digit format hint, verify/busy text, the preparing status and retry, the `enrollmentRestarted` notice after an expired setup, the challenge copy and `Sign out`, and the backup-code heading, once-only warning, list label, `Copy all`, `Copied`, copy-failure alert and `I’ve saved them`.
- `staffHome` — verified staff summary and Products/Categories links for Admin and Moderator, plus role names.
- `catalog` — Product list filters, row labels, editor fields, pricing, audit history, validation, stale/empty/loading/saved states and the BDT currency symbol used by `formatTaka`.
  Unset money uses “Not set”; filter text is “Any status”/“Needs price (not purchasable),” while chips stay concise. History distinguishes details edits and each review-flag direction.
- `categories` — category list, inline editor, paging and validation states.
- `errors` — bounded copy selected by `errorMessageKey` for authentication/MFA, stale update, price required, duplicate category, access denied, not found, invalid response and the generic fallback. The API's own message text is never shown.

Each namespace belongs to one feature; new text should be added under the owning namespace. The page-level `signIn.title`, `register.title` and `account.title` also serve as the route metadata titles.

## Current boundary

Only English is configured. The message file contains static presentation copy, including the BDT symbol, but no Product data, prices, medical advice, user input or backend response text. There is no copy for storefront search, cart or orders. Backup codes and setup keys remain component state.

## Verification

The unit tests render components with this catalog and assert the exact English strings for labels, hints, notices and alerts. `npm run build` also confirms every key used by the server pages resolves.

The shared errors use the exact coordinated plan wording for stale updates, access denied and not found; page-specific stale explanations remain available.

The shared stale-update, access-denied and not-found messages match the exact Ticket 14 shared contract. Product and Category stale-edit banners retain their feature-specific guidance. Empty-page messages distinguish a page with no returned rows from an entirely empty catalog.

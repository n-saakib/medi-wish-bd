# `messages/en.json`

Source: [`messages/en.json`](../../messages/en.json)

## Purpose

This is the English message catalog consumed by `next-intl`. All user-visible copy for the current pages lives here, so components contain no hard-coded translatable strings. Server components read it through `getTranslations` and client components through `useTranslations`.

## Message namespaces

- `metadata` — store name and description for the root layout's `generateMetadata`; the store name also fills the `%s · Medi Wish` title template.
- `header` — brand text, the account navigation's accessible label (`Account`), the `Sign in` link and the auth header's `Back to home` link.
- `home` — hero title and preparation copy (`Our online store is being prepared. Please check back soon.`), plus the sign-out result messages `signedOut` and `signOutError` and the `tryAgain` retry button shown by `SignOutNotice`.
- `signIn` — page title, identifier label (`Mobile, email or username`), password label, submit/busy button text, the link to registration, and the notices `sessionExpired`, `restoreError` and `accountCreated`.
- `register` — page title, field labels, the `(optional)` email marker, the `At least 12 characters` password hint, submit/busy text, the link to sign-in, and `invalid`, which explains the username rule (3–50 allowed characters with at least one letter) when the API rejects a request as `INVALID_REQUEST`.
- `account` — account page title, the `Checking your session…` status shown while the session restores and the profile loads, profile labels and sign-out button/busy text.
- `errors` — copy for API failures, chosen by `errorMessageKey` from the error code: `authenticationFailed` (sign-in details do not match), `duplicateUser`, `invalidResponse` and the fallback `genericError`. The API's own message text is never shown.

Each namespace belongs to one feature; new text should be added under the owning namespace. The page-level `signIn.title`, `register.title` and `account.title` also serve as the route metadata titles.

## Current boundary

Only English is configured. The catalog is static presentation copy: it contains no product data, prices, medical advice, user input or backend responses, and error messages describe outcomes without backend diagnostics. There is no copy for forgot-password, terms, privacy, OTP, MFA, search, cart or orders because those features are not part of this slice. The product name is a brand term, so spellcheck warnings for `Medi` do not indicate a typo.

## Verification

The unit tests render components with this catalog and assert the exact English strings for labels, hints, notices and alerts. `npm run build` also confirms every key used by the server pages resolves.

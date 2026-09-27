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
- `staffHome` — staff landing page title, `Staff access verified` heading, checking status, username and roles labels, the `Super Admin` label and display names for the roles `ADMIN`, `MODERATOR`, `CUSTOMER` and `DELIVERY_PERSON`.
- `errors` — copy for API failures, chosen by `errorMessageKey` from the error code: `authenticationFailed` (sign-in details do not match), `duplicateUser` (a taken username, mobile number or email), `mfaRequired`, `mfaCodeInvalid`, `mfaEnrollmentStale`, `tooManyAttempts`, `invalidResponse` and the fallback `genericError`. The API's own message text is never shown.

Each namespace belongs to one feature; new text should be added under the owning namespace. The page-level `signIn.title`, `register.title` and `account.title` also serve as the route metadata titles.

## Current boundary

Only English is configured. The catalog is static presentation copy: it contains no product data, prices, medical advice, user input or backend responses, and error messages describe outcomes without backend diagnostics. There is no copy for forgot-password, terms, privacy, OTP, backup-code sign-in, MFA recovery, search, cart or orders because those features are not part of this slice. Backup codes and setup keys are never message values; they are rendered from component state. The product name is a brand term, so spellcheck warnings for `Medi` do not indicate a typo.

## Verification

The unit tests render components with this catalog and assert the exact English strings for labels, hints, notices and alerts. `npm run build` also confirms every key used by the server pages resolves.

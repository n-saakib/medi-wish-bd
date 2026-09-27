# `src/app/(auth)/staff/mfa/page.tsx`

Source: [`src/app/(auth)/staff/mfa/page.tsx`](../../../../../../src/app/(auth)/staff/mfa/page.tsx)

## Purpose

The `/staff/mfa` route: authenticator code entry for a returning Admin or Moderator, under the reduced auth header.

## Exports

### `generateMetadata(): Promise<Metadata>`

Returns the translated `staffMfa.challengeTitle` (`Verify it’s you`), rendered as `Verify it’s you · Medi Wish`.

### `StaffMfaPage()`

Renders [`MfaChallenge`](../../../../auth/MfaChallenge.tsx.md) inside the `(auth)` layout's card.

## Use cases and boundaries

The page is statically generated; the client component decides what to show once the session restore finishes. It lives in the `(auth)` group, while `/staff` lives in `(staff)`; the groups add no URL segment and their paths do not overlap. The response carries `Cache-Control: no-store` from [`next.config.ts`](../../../../../next.config.ts.md).

## Verification

On 2026-09-27 `npm run build` produced `/staff/mfa` as a static route. Behavior is covered by [`tests/MfaChallenge.test.ts`](../../../../../tests/MfaChallenge.test.ts.md).

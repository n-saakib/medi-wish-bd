# `src/app/(auth)/staff/mfa/enroll/page.tsx`

Source: [`src/app/(auth)/staff/mfa/enroll/page.tsx`](../../../../../../../src/app/(auth)/staff/mfa/enroll/page.tsx)

## Purpose

The `/staff/mfa/enroll` route: first-time authenticator setup and the once-only backup codes, under the reduced auth header.

## Exports

### `generateMetadata(): Promise<Metadata>`

Returns the translated `staffMfa.enrollTitle` (`Set up your authenticator`), rendered as `Set up your authenticator · Medi Wish`.

### `StaffMfaEnrollPage()`

Renders [`MfaEnrollment`](../../../../../auth/MfaEnrollment.tsx.md) inside the `(auth)` layout's card.

## Use cases and boundaries

The page is statically generated and its server output holds no secret: the setup is requested in the browser after the session restore. The response carries `Cache-Control: no-store` from [`next.config.ts`](../../../../../../next.config.ts.md), and the component clears the secret on `pagehide`, so neither the HTTP cache nor the back/forward cache keeps it.

## Verification

On 2026-09-27 `npm run build` produced `/staff/mfa/enroll` as a static route. Behavior is covered by [`tests/MfaEnrollment.test.ts`](../../../../../../tests/MfaEnrollment.test.ts.md).

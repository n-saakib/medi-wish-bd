# `src/lib/profile.ts`

Source: [`src/lib/profile.ts`](../../../src/lib/profile.ts)

## Purpose and contract

The profile API boundary uses the existing session client's `authenticatedFetch` for caller-owned profile, mobile and email-verification routes: `GET` and `PUT /api/user/me/profile`, `POST` and `DELETE /api/user/me/mobile-change`. Save sends full name, email, date of birth, loaded version and currentPassword only when supplied. Stage sends only the requested mobile. Cancel accepts an empty `204` response.

`projectProfile(body)` copies only the ten public profile fields after checking their types and bounds, account state, nonnegative integer version and an actual ISO calendar date. A malformed successful response becomes `INVALID_RESPONSE`. Failed responses use the bounded API error code and status; server message text never enters component state.

## Exports and verification

Exports: `Profile`, `ProfileEdit`, `projectProfile`, `loadProfile`, `saveProfile`, `stageMobileChange`, `cancelMobileChange`. [`tests/profile.test.ts`](../../tests/profile.test.ts.md) covers paths, request bodies, statuses, rejection of invalid responses and bounded errors. The Ticket 11 browser specs exercise the real API.

## Ticket 05 email recovery

The caller-owned profile now has ten projected fields, including required emailVerified; verification with a null email is invalid. ProfileEdit accepts optional currentPassword, serialized only when supplied and never trimmed. requestEmailVerification sends a bodyless POST accepting 204; confirmEmailVerification sends only code and projects the 200 profile. Existing profile and mobile operations preserve their status/error contracts.

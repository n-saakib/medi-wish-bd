# `src/auth/AuthenticatorCodeField.tsx`

Source: [`src/auth/AuthenticatorCodeField.tsx`](../../../src/auth/AuthenticatorCodeField.tsx)

## Purpose

The one authenticator-code input shared by the staff MFA setup and code-entry pages, and the rule for reading what was typed.

## Exports

- `authenticatorCodeDigits(value)` — trims the value, removes at most one space and returns the six digits, or `null` when the result is not exactly six ASCII digits. `123 456` and `123456` both become `123456`; only the digits are sent to the API.
- `AuthenticatorCodeField({ id, label, value, disabled?, inputRef?, onChange })` — a labelled `.input` with `inputMode="numeric"`, `autoComplete="one-time-code"` (so phones can offer the code), `maxLength` 7 (six digits plus one space) and `required`.

## Design deviation

The designs show six one-digit boxes. One field is used instead: it works with paste and one-time-code autofill, needs no focus handling between boxes, and gives screen readers one labelled control.

## Verification

Exercised by [`tests/MfaEnrollment.test.ts`](../../tests/MfaEnrollment.test.ts.md) and [`tests/MfaChallenge.test.ts`](../../tests/MfaChallenge.test.ts.md): the attributes, a code typed with spaces, and a malformed code refused without an API call.

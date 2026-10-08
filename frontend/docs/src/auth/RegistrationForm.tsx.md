# `src/auth/RegistrationForm.tsx`

Source: [`src/auth/RegistrationForm.tsx`](../../../src/auth/RegistrationForm.tsx)

## Purpose and export

`RegistrationForm()` creates an account through `registerUser`, then signs in with the same credentials under accepted decision D1. It follows the registration page design and uses the guest session guard.

## Observable behavior

The form labels username, mobile, optional email and password. Browser bounds are username 3–20 characters, mobile at most 11, email at most 254 and password 6–30. Mobile uses numeric input mode. Before sending, the form applies the API's formats to the values the API will see (username trimmed and lower-cased, mobile trimmed, email trimmed and lower-cased): username 3–20 of `a–z 0–9 . _ -` with at least one letter, exactly 11 digits for mobile, the profile email subset when an email is given, and a nonblank 6–30 character password. Each refused field shows its own message, is marked `aria-invalid` and described by that message (the password keeps its hint too), the first one is focused, and nothing is sent. Editing a field clears its message. The form sets `noValidate`, so the browser's own checks do not stop at the first field before these messages appear; the length attributes still cap typing. While the password error shows, it replaces the `6–30 characters` hint, which states the same rule. The API stays authoritative for formats and uniqueness.

Submission uses `method="post"` so credentials cannot enter a pre-hydration URL. It clears the password from component state, disables submission and omits a blank email. Any `201` triggers automatic sign-in. If sign-in then fails, an account-created notice sends the visitor to the fixed `/sign-in` path.

A server failure shows bounded error-code copy in a focused alert; `INVALID_REQUEST` uses the shared “Check your details and try again.” because the server does not say which field it refused (closing-pass fix I3, 2026-10-08, replacing the username-only guidance). Editing clears the alert; server messages and transport details are never shown.

## Design and verification

The fixed `+880` prefix, consent line and OTP step remain omitted from the accepted slice. The password hint and bounds match the API's 6–30 character contract. [`tests/RegistrationForm.test.ts`](../../tests/RegistrationForm.test.ts.md) checks POST defaults, fields, client field errors and focus, password clearing, request bodies, automatic sign-in and bounded, focused alerts. Ticket 11 API tests cover stricter identifiers and compatibility with existing accounts.

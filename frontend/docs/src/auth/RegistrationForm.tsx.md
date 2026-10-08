# `src/auth/RegistrationForm.tsx`

Source: [`src/auth/RegistrationForm.tsx`](../../../src/auth/RegistrationForm.tsx)

## Purpose and export

`RegistrationForm()` creates an account through `registerUser`, then signs in with the same credentials under accepted decision D1. It follows the registration page design and uses the guest session guard.

## Observable behavior

The form labels username, mobile, optional email and password. Browser bounds are username 3–20 characters, mobile at most 11, email at most 254 and password 6–30. Mobile uses numeric input mode. The API decides the complete identifier formats and uniqueness; the form adds no separate format validator.

Submission uses `method="post"` so credentials cannot enter a pre-hydration URL. It clears the password from component state, disables submission and omits a blank email. Any `201` triggers automatic sign-in. If sign-in then fails, an account-created notice sends the visitor to the fixed `/sign-in` path.

`INVALID_REQUEST` displays the translated 3–20 character username rule, including at least one letter. Other failures use bounded error-code copy. Editing clears the alert; server messages and transport details are never shown.

## Design and verification

The fixed `+880` prefix, consent line and OTP step remain omitted from the accepted slice. The password hint and bounds match the API's 6–30 character contract. [`tests/RegistrationForm.test.ts`](../../tests/RegistrationForm.test.ts.md) checks POST defaults, fields, password clearing, request bodies, automatic sign-in and bounded alerts. Ticket 11 API tests cover stricter identifiers and compatibility with existing accounts.

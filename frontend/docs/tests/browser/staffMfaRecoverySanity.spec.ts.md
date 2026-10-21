# `tests/browser/staffMfaRecoverySanity.spec.ts`

Source: [`../../../tests/browser/staffMfaRecoverySanity.spec.ts`](../../../tests/browser/staffMfaRecoverySanity.spec.ts)

## Purpose

Ticket 09's sanity and accessibility checks (plan T7, E2E-09-07). Tag `@t09-T7` with `@sanity`; the shortest recovery also carries `@smoke`. Written before the feature; the tests fail until it is delivered.

## Tests

- **E2E-09-07:** the dialog opens from the keyboard with the field focused; Tab follows the markup order (field → Cancel → Continue → Close → field) and Shift+Tab wraps back; the dialog is named "Use a backup code"; a format error is announced and is the field's description; the field, Close, Cancel, Continue and "Lost your phone?" are at least 44 × 44 px; Escape returns focus to "Lost your phone?"; at each of 360 and 1280 px the challenge and open dialog do not scroll sideways, and after recovery opens the replacement setup and shows 10 codes with its contact notice, both states are checked at both widths. Screenshots of the focus ring and dialog at both widths are attached as evidence, not asserted.
- **E2E-09-07b:** the regeneration form at 360 px: labelled field, 44 px targets, Tab order field → submit → "Back to staff pages", no sideways scroll; after successful regeneration the 10-code panel fits at 360 and 1280 px.
- **E2E-09-07c (`@smoke`):** sign in, use a backup code, set up a new authenticator and reach `/staff`.

Plan T7 step 3 lists the Tab order as "field → Close → Cancel → Continue", which the T3 markup (Close in the header) cannot produce; the spec asserts the markup order (plan §9).

## Running

`npm run test:browser -- --grep "@t09-T7" --project chrome`, never beside another browser run.

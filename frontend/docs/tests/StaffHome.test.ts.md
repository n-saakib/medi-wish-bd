# `tests/StaffHome.test.ts`

Source: [source](<../../tests/StaffHome.test.ts>).

## Purpose

Units through real session/translation providers for loading verified staff access, one-role summaries, Super Admin labels, Admin-only Users and roles navigation, guards, focused errors, Bearer authentication and sign-out. The staff projection rejects multiple/unknown roles, malformed fields and Super Admin without ADMIN while discarding extra profile fields.

The link group is asserted as a navigation landmark named `Staff pages`.

Closing-pass regression (2026-10-08): when access loads with nothing focused, the heading takes focus; a focused Sign out button keeps it. It failed before the fix.

## Ticket 16

Ticket 16 asserts the Discounts link is present for Admin and absent for Moderator.

Ticket 09 checks the regeneration link for both ADMIN and MODERATOR and confirms replacement assurance redirects to setup without requesting staff access.

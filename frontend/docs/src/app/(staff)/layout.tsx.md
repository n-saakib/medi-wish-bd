# `src/app/(staff)/layout.tsx`

Source: [`src/app/(staff)/layout.tsx`](../../../../src/app/(staff)/layout.tsx)

## Purpose

Layout of the `(staff)` route group, which adds no URL segment. It renders the [`StaffHeader`](../../shell/StaffHeader.tsx.md) (logo and sign-out) above staff pages, so they carry neither the store header nor the auth header.

## Use cases and boundaries

The only staff page today is [`/staff`](staff/page.tsx.md). The staff MFA pages stay in the `(auth)` group because they belong to the sign-in flow and are reached before staff access exists. The layout holds no session logic; each page guards itself with `useSessionRedirect`.

## Verification

On 2026-09-27 `npm run build` compiled this layout with `/staff`, `/staff/mfa` and `/staff/mfa/enroll` as separate static routes, showing that the groups do not collide.

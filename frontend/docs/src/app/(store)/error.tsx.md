# `src/app/(store)/error.tsx`

Source: [`src/app/(store)/error.tsx`](<../../../../src/app/(store)/error.tsx>)

## Purpose

Client error boundary for failures in the store route segment, including catalog API failures that are not public not-found responses.

## Behavior

Next.js 16.3.6 supplies `error` and `retry`; this boundary forwards them to [`StorefrontError`](../../storefront/StorefrontError.tsx.md). The generic localized UI lets a visitor retry the segment without exposing the original message, digest, API response or origin.

## Verification

Mounted component tests cover generic error copy and retry. Ticket 17 browser outage cases exercise the route boundary; both suites were authored but were not run while the baseline browser suite used `.next`.

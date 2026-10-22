# `src/app/(store)/layout.tsx`

Source: [`src/app/(store)/layout.tsx`](<../../../../src/app/(store)/layout.tsx>)

## Purpose

Layout for the public store route group. `(store)` is a Next.js route group, so it adds no URL segment; the group contains the home, account, category directory, category listing and Product details routes.

## Export and behavior

`StoreLayout({ children })` opts the group into request-time rendering and places `SiteHeader` and the public category navigation above each page. The latter uses the shared React-cached category list and hides on an empty result or read failure. Each route supplies its own main landmark. The root layout owns the session provider, so client-owned signed-in state remains shared with the auth and account flows.

## Verification

Ticket 17 browser tests cover public category navigation and request-time catalog pages; existing header tests cover session-aware store navigation. These tests were authored or previously covered, but the Ticket 17 suite was not run while the baseline browser run used `.next`.

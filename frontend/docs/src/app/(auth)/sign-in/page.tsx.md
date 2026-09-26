# `src/app/(auth)/sign-in/page.tsx`

Source: [`src/app/(auth)/sign-in/page.tsx`](../../../../../src/app/(auth)/sign-in/page.tsx)

## Purpose

The `/sign-in` route. It sets the page title and renders the sign-in form inside the auth layout.

## Exports

### `generateMetadata(): Promise<Metadata>`

Returns the translated `signIn.title`, rendered by the root layout's template as `Sign in · Medi Wish`.

### `SignInPage()`

Renders [`SignInForm`](../../../auth/SignInForm.tsx.md), which owns form state, notices and the redirect of signed-in users to `/account`.

## Use cases and boundaries

The route is statically generated and carries no session data; redirects happen in the browser once the session restore finishes. Credentials never appear in the route URL because the form submits with `method="post"` and the client handler prevents the default submission.

## Verification

On 2026-09-26 `npm run build` produced `/sign-in` as a static route. Form behavior is covered by [`tests/SignInForm.test.ts`](../../../../tests/SignInForm.test.ts.md).

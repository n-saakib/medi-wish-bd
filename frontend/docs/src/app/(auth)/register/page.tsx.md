# `src/app/(auth)/register/page.tsx`

Source: [`src/app/(auth)/register/page.tsx`](../../../../../src/app/(auth)/register/page.tsx)

## Purpose

The `/register` route. It sets the page title and renders the registration form inside the auth layout.

## Exports

### `generateMetadata(): Promise<Metadata>`

Returns the translated `register.title`, rendered by the root layout's template as `Create an account · Medi Wish`.

### `RegisterPage()`

Renders [`RegistrationForm`](../../../auth/RegistrationForm.tsx.md), which owns the registration request, the follow-up sign-in and the redirect of signed-in users to `/account`.

## Use cases and boundaries

The route is statically generated and carries no session data. No identifier, password or other registration detail is placed in the URL, including when the form hands the visitor over to `/sign-in`.

## Verification

On 2026-09-26 `npm run build` produced `/register` as a static route. Form behavior is covered by [`tests/RegistrationForm.test.ts`](../../../../tests/RegistrationForm.test.ts.md).

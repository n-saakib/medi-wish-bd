# `src/lib/user.ts`

Source: [`src/lib/user.ts`](../../../src/lib/user.ts)

## Purpose

Small typed boundary for the reduced shared User registration and profile API. It validates the expected public response projection, maps only bounded server error fields, and avoids copying diagnostic fields, passwords or request IDs into client state. It does not invent user-facing fallback text; the client panel translates missing messages.

## Exports

- `registerUser` sends a no-store JSON `POST /api/auth/register` request and accepts only the documented registration response.
- `loadUserProfile` sends a no-store `GET /api/user/me` request with an in-memory Basic header and accepts only the documented profile response.
- `userErrorMessage` converts bounded API failures into either a safe server message or a caller-provided translated fallback without depending on the React panel.
- `UserApiError` carries a bounded code, optional bounded server message and HTTP status for UI decisions. Missing or invalid response text remains empty so the UI can select a locale-specific catalog message.

The base API URL uses `NEXT_PUBLIC_MEDI_WISH_API_URL` when configured and otherwise defaults to the local backend. OTP behavior, token persistence and session refresh are outside this boundary.

## Verification

`tests/user.test.ts` checks request method/body, response validation, bounded error mapping, translated fallback selection and Basic authorization construction without using a live service.

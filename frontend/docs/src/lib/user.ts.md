# `src/lib/user.ts`

Source: [`src/lib/user.ts`](../../../src/lib/user.ts)

## Purpose

Small typed boundary for the shared User registration and profile API. Registration and session/profile responses share one bounded username/mobile/email projection; each endpoint adds only its own documented fields. The module maps bounded server error fields plus an optional bounded request ID on `UserApiError`, and avoids copying diagnostic fields or credentials into client state. Profile requests use the supplied `SessionClient` origin so the URL and Bearer token stay on the same API origin; profile status/error handling and JSON parsing run through the session response-reader overload so they remain inside the operation deadline. It does not invent user-facing fallback text; the calling client component translates missing messages.

## Exports

- `registerUser` sends a no-store JSON `POST /api/auth/register` request and accepts only the documented registration response; JSON bodies use the shared 16 KiB bounded reader.
- `loadUserProfile` sends a no-store `GET /api/user/me` request through the session seam with an in-memory Bearer header and accepts only the documented profile response.
- `userErrorMessage` converts bounded API failures into either a safe server message or a caller-provided translated fallback without depending on React components.
- `UserApiError` carries a bounded code, optional bounded server message and HTTP status for UI decisions. Missing or invalid response text remains empty so the UI can select a locale-specific catalog message.

The base API URL uses `NEXT_PUBLIC_MEDI_WISH_API_URL` when configured and otherwise defaults to the local backend. Registration remains public and unchanged; sign-in, refresh and logout are owned by `session.ts`. OTP, MFA, recovery, OAuth and token persistence are outside this boundary.

## Verification

`tests/user.test.ts` checks registration request method/body, response validation, bounded error/request-ID mapping, oversized UTF-8 error-body cancellation with absent or understated `Content-Length`, translated fallback selection, same-origin custom-client profile requests and Bearer authorization without using a live service.

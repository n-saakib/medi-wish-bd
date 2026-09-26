# `tests/user.test.ts`

Source: [`tests/user.test.ts`](../../tests/user.test.ts)

## Purpose

Unit tests for the public frontend shared User API seam. Injected fetch functions make the cases deterministic and ensure no live credentials or backend are needed.

## Verification

The suite covers registration request shape and deferred-verification response handling, bounded duplicate errors including request correlation, locale-selected fallbacks through the shared `userErrorMessage` helper, profile response validation, same-origin custom-client URL resolution and Bearer authorization through an injected session client. It also proves profile JSON parsing remains under the session deadline, timeout/body cancellation maps to bounded `REQUEST_FAILED` rather than malformed-JSON `INVALID_RESPONSE`, oversized UTF-8 registration error bodies are cancelled even when `Content-Length` is missing or understated, and server error fields remain bounded. The helper is tested through the library seam rather than importing the React panel.

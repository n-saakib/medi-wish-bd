# `tests/user.test.ts`

Source: [`tests/user.test.ts`](../../tests/user.test.ts)

## Purpose

Unit tests for the public frontend shared User API seam. Injected fetch functions make the cases deterministic and ensure no live credentials or backend are needed.

## Verification

The suite covers registration request shape and deferred-OTP response handling, bounded duplicate errors, locale-selected fallbacks through the shared `userErrorMessage` helper, profile request routing and in-memory Basic authorization. The helper is tested through the library seam rather than importing the React panel.

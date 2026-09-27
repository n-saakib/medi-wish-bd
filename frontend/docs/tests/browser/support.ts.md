# `tests/browser/support.ts`

Source: [`../../../tests/browser/support.ts`](../../../tests/browser/support.ts)

## Purpose

These are the shared browser-spec helpers; this file is not a spec.

- `syntheticCustomer()` returns a unique synthetic Customer:
  - username `journey.<hex>`;
  - an 11-digit mobile starting `017`;
  - an `example.test` email;
  - a random 26-character password, within the 6–30 rule.
- `register(page, customer)` fills and submits `/register` and waits for `/account`; registration signs the Customer in.
- `unauthorizedLine(path)` is the console line Chromium writes for a request the API answered with 401.
- `watchPage(page)` records two things:
  - console errors, as `path text`;
  - responses, as `status METHOD path`: every API response except CORS preflights, plus any other response with status 400 or higher.

  `expectSeen(expected)` polls until exactly the expected entries were recorded, then clears them. Each step therefore asserts its own complete console and network outcome.
- `signIn(page, identifier, password)` fills and submits `/sign-in`; the caller checks where the session lands.
- `readManualKey(page)` opens `Can’t scan?` on the setup page and returns the key without its grouping spaces, after checking it is 32 Base32 characters.
- `readBackupCodes(page)` waits for the ten items of the `Backup codes` list and returns them, each checked against `XXXX-XXXX`.

# `tests/browser/support.ts`

Source: [`../../../tests/browser/support.ts`](../../../tests/browser/support.ts)

## Purpose

These are the shared browser-spec helpers; this file is not a spec.

- `syntheticCustomer(username?)` returns a unique synthetic Customer:
  - username `journey.<hex>`, or `username` when a test needs a searchable pattern (it must stay within `[a-z0-9._]{3,50}`);
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

## Staff helpers (shared with Ticket 08)

Moved here from `staffMfa.spec.ts` (Ticket 08 plan §8.2), so the staff MFA and staff role specs share one copy.

- `Authenticator` is `{ key, step }`: the Base32 key and the last time step whose code the API accepted. `StaffMember` is a `Customer` with its `authenticator`.
- `registerThroughApi(request, customer?)` registers through `POST /api/auth/register` (expects `201`) and returns the Customer; registration through the API opens no session.
- `registeredAdmin(page)` registers through the API and grants ADMIN with [`grantRole`](testApi.ts.md); the Admin has no authenticator yet.
- `enroll(page)` runs on `/staff/mfa/enroll`: it reads the manual key, enters the current code and waits for the focused backup codes, then returns the `Authenticator`.
- `signInAndEnroll(page, member)` signs in, enrolls, presses `I’ve saved them` and waits for `Staff access verified` on `/staff`.
- `verifiedModerator(page)`, `verifiedAdmin(page)` and `verifiedSuperAdmin(page)` register a User, grant MODERATOR, grant ADMIN, or make them the run's Super Admin with [`makeSuperAdmin`](testApi.ts.md), then `signInAndEnroll`. Each returns the `StaffMember`, with `page` on `/staff`. `verifiedSuperAdmin` moves the run's single Super Admin to the new User.
- `freshCode(authenticator)` returns the next code the API accepts: a step later than the last accepted one, waiting while that step is still ahead of the API's one-step window. It records the step, so a later call never replays a code.
- `signInWithCode(page, member)` signs in a staff member whose session asks for a code, enters `freshCode` on `/staff/mfa` and waits for `/staff`.

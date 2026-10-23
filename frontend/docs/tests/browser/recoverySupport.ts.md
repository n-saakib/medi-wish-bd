# `tests/browser/recoverySupport.ts`

Source: [`../../../tests/browser/recoverySupport.ts`](../../../tests/browser/recoverySupport.ts)

## Purpose

Shared helpers and contract strings for the Ticket 05 recovery specs, [`recoveryApi.spec.ts`](recoveryApi.spec.ts.md) and [`recovery.spec.ts`](recovery.spec.ts.md). It is not a spec. It reads mail from the run's capture directory (plan O4), sets up and probes the new recovery tables through guarded SQL, and names the page controls exactly as plan §10.3 fixes them. It never logs a mail body, a code or an address: errors name only a kind, a count or a file.

## Contract strings and routes

- **`recoveryCopy`:** every API message and page string from plan §4.2 and §10.3 (for example `codeInvalidApi`, `currentPasswordInvalidApi`, `emailRequiredApi`, the forgot-password page copy and the profile dialog copy). `verifyEmailIntro(email)` builds the dialog's intro. Change these only together with the plan.
- **`resetRequestPath`, `resetConfirmPath`, `verificationPath`, `verificationConfirmPath`:** the four Ticket 05 routes. None carries a User id or an address.

## Values and requests

- **`unknownEmail()`:** a fresh `example.test` address no User holds.
- **`wrongCode(code, offset)`:** a 6-digit code that differs from `code`.
- **`codeInLog(log, code)`:** detects a six-digit code with digit boundaries after excluding only full ISO timestamp and UUID framing tokens. Punctuation beside a code remains detectable; invalid probe codes throw. Covered by [`recoverySupport.test.ts`](../recoverySupport.test.ts.md).
- **`newPassword()`:** a valid synthetic password (A5).
- **`postRaw(api, path, body, contentType, headers)`:** sends a raw body, for shape and size tests.
- **`requestReset(api, email, headers)`:** sends exactly `{"email": email}`. `email` may be any JSON value.
- **`confirmReset(api, body, headers)`:** sends `body` as JSON exactly as given.
- **`expectAccepted(response)`:** the uniform reset-request answer: `202`, an empty body, `no-store` and no cookie. It compares body length so a contract failure cannot print response content in diagnostics.
- **`expectReset(response)`:** a successful confirm: `204`, an empty body, `no-store` and no cookie. It also compares body length without printing content.
- Failed reset status assertions use a fixed diagnostic label, so a response body cannot appear in test failure output.
- **`comparableHeaders(response)`:** the sorted headers without `x-request-id` and `date`, for uniformity checks.

## Captured mail

The test API writes each message as `<epochMillis>-<uuid>.json` with exactly `to`, `subject`, `body` and `kind`. `MailKind` is `EMAIL_VERIFICATION_CODE`, `PASSWORD_RESET_CODE`, `PASSWORD_CHANGED`, `EMAIL_CHANGED` or `STAFF_AUTHENTICATOR_REPLACED`. The last kind joins Ticket 09 verified-email replacement notices to the shared capture directory, so reading Ticket 05 recovery codes continues to validate and filter every captured message correctly.

- **`mailDirectory()`:** the directory from `MEDI_WISH_TEST_MAIL_DIR`, set by [`testApi.ts`](testApi.ts.md). It must be absolute and exist.
- **`capturedMail({ to, kind })`:** every message in filename order (epoch milliseconds then UUID), optionally filtered by address (any case) and kind. Mail captured in the same millisecond has no guaranteed relative send order; the authored nth-mail scenarios for one address and kind use the required 60-second issue gap. It ignores `.tmp` and foreign file names, and throws `Malformed captured mail <file>` for a file with other keys or a non-string value.
- **`readCapturedMail(to, kind, { nth, timeoutMs })`:** polls every 100 ms until the `nth` message exists (10 s by default).
- **`codeFrom(body)`:** the one 6-digit code in a body; none or several is a contract break.
- **`hasCode(body)`:** whether a body holds any 6-digit run. A notice must hold none.
- **`mailedCode(to, kind, nth)`:** the code of the `nth` message of a code kind.
- **`expectNoMailFor(addresses, sentinel)` and `resetSentinel(api)`:** prove a negative. The sentinel, a fresh verified Customer requesting a reset, causes one later message. Once that message exists, nothing may have gone to `addresses`. This relies on the API's mail executor having a single worker, so messages leave in commit order (plan §4.4 and §6).

## SQL fixtures and probes

Each calls `checkedTarget` before building SQL, so only the run's `mw_browser_<12 hex>` schema and synthetic usernames reach it.

- **`markEmailVerified(username)`:** the seeded verified-email fixture (Q4 AC4). It sets `users.email_verified_at` for a User with an email.
- **`storedEmailState(username)`:** `{ email, emailVerified }` as stored.
- **`storedCodes(username)`:** the live `account_codes` rows as `{ purpose, sentTo, failedAttempts }`, ordered by purpose. It never selects `code_hash`.
- **`storedCodeIds(username, purpose)`:** UUID identities of the selected purpose's live code rows, ordered by ID. This probe supports replacement assertions without exposing code material or changing `storedCodes`' exact result shape.
- **`expireCode(username, purpose)`:** moves a code past its 15-minute expiry.
- **`ageLimits(username, seconds)`:** ages the shared issue window `issue:<userId>` (plan O7): 61 seconds clears the 60-second gap and 7200 clears the hour. The address windows are keyed by an HMAC, so tests use fresh addresses instead.
- **`agePasswordLimit(username, seconds)`:** ages the wrong-current-password window `password:<userId>` (plan O2).
- **`storedPasswordHash(username)`:** compares hashes before and after a refused reset.
- **`makePasswordUnusable(username)`:** replaces the password verifier with a non-Argon2 value, which makes the User ineligible for a reset (plan §4.1). Returns the stored value.
- **`setStoredEmail(username, email, verified)`:** sets the saved email (a synthetic `example.test` address or `null`) and its verified mark outside the profile route, to prove that a code is bound to the address it was sent to.
- **`auditEventTypes(username)`:** the User's `security_audit_events.event_type` values, oldest first.

## Page helpers

- **`forgotPasswordPage(page)`:** the forgot-password heading, fields, buttons, the uniform status and the code-invalid alert.
- **`profileRecovery(page)`:**
  - the profile's **Mobile** and **Email** groups, fields and **Current password**;
  - **Save changes**, **Change** and **Verify**;
  - the Verified and Not verified chips, and the saved and verified notices;
  - the **Verify email** dialog with its code field and buttons.
- **`resetPasswordThroughPage(page, email, password)`:** goes from `/sign-in` through **Forgot password?** to the reset, and returns the code it used.
- **`verifyEmailThroughProfile(page, email)`:** goes through **Verify**, the newest code and **Confirm** on `/account/profile`, and returns the code.
- **`expectLayout`, `accentColour` and `expectKeyboardOrder`:** are shared with [`profile.spec.ts`](profile.spec.ts.md). `expectLayout` checks document overflow, and for a dialog also checks its own horizontal overflow and viewport bounds; it checks labels and both dimensions of every visible button, input and link against the 44 px minimum in the supplied scope. Failed size and keyboard assertions report only control tags or DOM positions and focus-ring state, never input markup that could contain an email or password.
- **`verifiedCustomer(api, customer)`:** registers a Customer and marks their email verified.

# `tests/addressSupport.test.ts`

Source: [`../../tests/addressSupport.test.ts`](../../tests/addressSupport.test.ts)

Unit checks for the Ticket 12 acceptance fixtures. They verify canonical unique synthetic address IDs, bounded safe text and ASCII mobiles, deliberate negative-fixture overrides, and edit payloads without read-only fields. Database readers reject unsafe schemas/usernames before SQL, scope their reads to the caller, preserve authoritative ordering and fail on absent/corrupt output; the complete state reader preserves all columns including timestamps/user IDs/change IDs and scopes both table reads; child processes are mocked, so no database is touched.

The Dhaka guard is checked before, at and after its inclusive five-minute windows around Monday and month-start midnights, including year and leap-year transitions, ordinary midnights, UTC/Dhaka date differences and invalid dates. This prevents real-clock quota checks from silently crossing periods. It does not prove production month/week accounting; fixed-calendar backend integration tests own that proof.

Run: `npx vitest run --project unit tests/addressSupport.test.ts`. Actual results and source revision are recorded in [Ticket 12 coverage](../ticket-12-e2e.md).

Response-helper checks accept NBSP/FEFF-only and surrounding Unicode spaces under the accepted Java `String.trim()` semantics, and reject blank or non-string required text for each field with the label and other fields valid, so unrelated validation cannot mask the intended rejection. Child-process mocks remain in place for every helper check.

Each free-text field independently rejects response controls, C1 controls, line/paragraph separators, ASCII padding and repeated interior ASCII spaces. Optional labels reject empty, blank and non-string values while null labels and normalized single spaces remain valid. These checks enforce the backend projection's A3 normalization rather than a broader JavaScript trim policy.

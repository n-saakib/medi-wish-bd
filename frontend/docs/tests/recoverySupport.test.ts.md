# `tests/recoverySupport.test.ts`

Source: [`../../tests/recoverySupport.test.ts`](../../tests/recoverySupport.test.ts)

Focused units for [`browser/recoverySupport.ts`](browser/recoverySupport.ts.md). Log checks prove punctuation beside a code is detected while ISO timestamps, UUID framing and longer numbers do not create false leaks. A real temporary capture directory covers mail naming, ordering, filtering, malformed-file errors, polling, occurrence selection, deadline, sentinel ordering and code parsing. The malformed-file assertions compare only a boolean, so a regression cannot print captured content in test output.

The shared-directory regression places `STAFF_AUTHENTICATOR_REPLACED` beside a reset code, validates both kinds, filters the replacement notice case-insensitively and reads either kind without leaking captured content in assertion diagnostics. A replacement notice with an extra key still fails strict schema validation.

The SQL checks use a mocked administrator `psql` call to prove unsafe schemas, usernames, purposes and aging values are refused before SQL runs. They also check schema-qualified own-user queries, no code-hash selection, and missing-row behavior. Temporary mail is removed after each test; no browser, API or database is required.

# EmailChangeIT

Source: [EmailChangeIT.java](../../../../../../../src/test/java/bd/mediwish/auth/EmailChangeIT.java)

Email changes cancel both code purposes, clear verification and revoke only other sessions, retaining access and refresh for the submitting session. Refused changes preserve codes/sessions. Only a verified old address receives a notice, including a clear. Five durable wrong-password attempts block a later right password until the hour is aged. The accepted duplicate-save case preserves two prior wrong attempts and all code/session/notice state when the correct password is followed by DUPLICATE_USER; a later successful commit clears the counter.

Owns its guarded application/schema where required. Captured mail stays in memory; no test-only HTTP route or production dependency is introduced. Verification results are recorded in the Ticket 05 implementation evidence.

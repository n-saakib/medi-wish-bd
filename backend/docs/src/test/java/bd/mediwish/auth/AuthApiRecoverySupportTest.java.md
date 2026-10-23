# AuthApiRecoverySupportTest

Source: [AuthApiRecoverySupportTest.java](../../../../../../../src/test/java/bd/mediwish/auth/AuthApiRecoverySupportTest.java)

Protects mailbox parsing: the only complete six-digit ASCII code is read beside expiry text; missing, longer, non-ASCII and ambiguous values are refused with a safe message. It requires no database or application startup.

Owns its guarded application/schema where required. Captured mail stays in memory; no test-only HTTP route or production dependency is introduced. Verification results are recorded in the Ticket 05 implementation evidence.

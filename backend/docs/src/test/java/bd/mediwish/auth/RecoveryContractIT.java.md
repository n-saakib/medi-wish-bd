# RecoveryContractIT

Source: [RecoveryContractIT.java](../../../../../../../src/test/java/bd/mediwish/auth/RecoveryContractIT.java)

Checks exact owner-profile field order, bounded error envelopes, JSON-only media/type and mass-assignment boundaries, public cookie isolation and exactly 16 KiB versus one byte over. The body-less verification request intentionally ignores bounded input, including text/plain, following the frozen specific contract.

Owns its guarded application/schema where required. Captured mail stays in memory; no test-only HTTP route or production dependency is introduced. Verification results are recorded in the Ticket 05 implementation evidence.

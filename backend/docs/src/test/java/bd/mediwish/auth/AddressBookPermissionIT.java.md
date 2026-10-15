# AddressBookPermissionIT.java

Source: [src/test/java/bd/mediwish/auth/AddressBookPermissionIT.java](../../../../../../../src/test/java/bd/mediwish/auth/AddressBookPermissionIT.java).

Exercises Ticket 12 observable address-book behavior against the real application and a guarded PostgreSQL 18 schema. Tests use synthetic values, the existing AuthApi client, and run-owned schema cleanup; no production test endpoint is added.

Exercises all four routes with missing/malformed/revoked tokens and Admin/Moderator enrollment and verification restrictions. All four sole roles use their own book; denials leave rows and change counts unchanged. Captured logs omit tracked data.

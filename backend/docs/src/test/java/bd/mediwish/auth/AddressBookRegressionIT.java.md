# AddressBookRegressionIT.java

Source: [src/test/java/bd/mediwish/auth/AddressBookRegressionIT.java](../../../../../../../src/test/java/bd/mediwish/auth/AddressBookRegressionIT.java).

Exercises Ticket 12 observable address-book behavior against the real application and a guarded PostgreSQL 18 schema. Tests use synthetic values, the existing AuthApi client, and run-owned schema cleanup; no production test endpoint is added.

Dynamically fingerprints every base table except session/changelog tables across creates, edits, default movement and removal. Verifies only address tables change, profile/mobile activation never changes saved address columns, no foreign key references saved addresses and another user cannot list/edit/remove an owner row. User-scoped create ids may coincide.

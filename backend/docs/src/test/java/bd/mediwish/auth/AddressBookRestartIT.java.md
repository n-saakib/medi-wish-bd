# AddressBookRestartIT.java

Source: [src/test/java/bd/mediwish/auth/AddressBookRestartIT.java](../../../../../../../src/test/java/bd/mediwish/auth/AddressBookRestartIT.java).

Exercises Ticket 12 observable address-book behavior against the real application and a guarded PostgreSQL 18 schema. Tests use synthetic values, the existing AuthApi client, and run-owned schema cleanup; no production test endpoint is added.

Restarts the actual application against the same schema and checks rows, versions, change history, allowance and create replay persist. Fetches and resets the newly created address calendar after restart.

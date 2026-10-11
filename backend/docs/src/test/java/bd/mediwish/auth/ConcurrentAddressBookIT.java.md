# ConcurrentAddressBookIT.java

Source: [src/test/java/bd/mediwish/auth/ConcurrentAddressBookIT.java](../../../../../../../src/test/java/bd/mediwish/auth/ConcurrentAddressBookIT.java).

Exercises Ticket 12 observable address-book behavior against the real application and a guarded PostgreSQL 18 schema. Tests use synthetic values, the existing AuthApi client, and run-owned schema cleanup; no production test endpoint is added.

Proves user-row locking via direct service calls and PostgreSQL blocking-chain observation. Repeats cap/change-limit bursts five times, default move/delete races twenty times, concurrent empty-book defaults, closure serialization, deferred commit rollback and replay after response loss. Gates release within the datasource socket timeout.

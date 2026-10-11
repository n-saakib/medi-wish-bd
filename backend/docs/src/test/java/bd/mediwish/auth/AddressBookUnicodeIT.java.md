# AddressBookUnicodeIT.java

Source: [src/test/java/bd/mediwish/auth/AddressBookUnicodeIT.java](../../../../../../../src/test/java/bd/mediwish/auth/AddressBookUnicodeIT.java).

Exercises Ticket 12 observable address-book behavior against the real application and a guarded PostgreSQL 18 schema. Tests use synthetic values, the existing AuthApi client, and run-owned schema cleanup; no production test endpoint is added.

Requires UTF8 server encoding and round-trips Bengali recipient, address line and city. On WIN1252 this test is explicitly skipped; run it on the UTF8 cluster to obtain acceptance evidence.

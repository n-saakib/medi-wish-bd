# AddressBookIT.java

Source: [src/test/java/bd/mediwish/auth/AddressBookIT.java](../../../../../../../src/test/java/bd/mediwish/auth/AddressBookIT.java).

Exercises Ticket 12 observable address-book behavior against the real application and a guarded PostgreSQL 18 schema. Tests use synthetic values, the existing AuthApi client, and run-owned schema cleanup; no production test endpoint is added.

Covers bounded response/error contracts, required nulls, replay/full-book priority, default version promotion, closure reads/denials and the exact 16 KiB body boundary. Measures command statement counts on fresh users with only book size varying; records default-changing variants separately. Captured application logs omit all tracked address values.

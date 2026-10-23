# Account code issuer tests

Source: [`AccountCodeIssuerTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/AccountCodeIssuerTest.java)

Uses a real HMAC hasher and controlled randomness with repository seams. Protects shared verification/reset gap and hourly budget, rollover, same-purpose replacement before insert, collision redraw, lifetime and protected storage. Real uniqueness and concurrent locking are integration-test concerns.

The issue counter is stubbed through the locking findByIdForUpdate read used in production.

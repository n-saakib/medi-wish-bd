# Password reset transaction tests

Source: [`PasswordResetTransactionTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/PasswordResetTransactionTest.java)

Uses real User/code entities and HMAC with repository, mail and session seams. Protects the locked refresh order, wrong-code count through fifth-attempt deletion, expired/old-address/locked removal, unknown/unverified/missing code refusal, fresh address recheck, and successful password-only mutation followed by code deletion, revocation, audit and notice. PostgreSQL integration checks prove commits, flush/clear and concurrency.

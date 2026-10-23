# Shared password policy tests

Source: [`PasswordPolicyTest.java`](../../../../../../../src/test/java/bd/mediwish/user/PasswordPolicyTest.java)

Protects the existing registration and recovery rule: nonblank exact strings of six through thirty characters, with surrounding spaces counted and retained. Null, five, thirty-one and all-space inputs fail. This does not introduce a new password policy.

# `AccountEmailSecurity.java`

Source: [AccountEmailSecurity.java](../../../../../../../src/main/java/bd/mediwish/auth/AccountEmailSecurity.java)

ProfileService calls confirmCurrentPassword only for a normalized email change. Missing, blank and wrong passwords count toward five failures per hour from the first failure; the right password is refused while limited and clears the count when allowed. Argon2 runs under the existing User lock only for this bounded authenticated operation. The password counter is read with a row lock, so concurrent reset-request cleanup cannot delete it between the read and the save or delete. The facade adds no default transaction interceptor, preserving the caller’s noRollbackFor failure commit. emailChanged deletes both-purpose codes, audits the change, notifies the previously verified old address and revokes every session except the requesting one. The profile mutation is flushed before the bulk delete clears managed entities.

User clarification (2026-10-19): a rejected profile save, including duplicate-email rejection after a correct password, leaves earlier wrong-password attempts unchanged. The counter reset commits with a successful email change; wrong-password failures still commit their counter through the explicit no-rollback rule.

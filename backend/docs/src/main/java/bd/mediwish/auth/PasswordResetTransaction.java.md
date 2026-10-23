# Password reset transaction

Source: [`PasswordResetTransaction.java`](../../../../../../../src/main/java/bd/mediwish/auth/PasswordResetTransaction.java)

Runs the database portion of reset confirmation in a separate Spring transaction. Unknown or ineligible addresses perform a dummy HMAC comparison. A locked User is refreshed and its current verified address, account state and usable verifier are rechecked. Only PASSWORD_RESET codes are read. Expired, old-address or locked codes are deleted; wrong attempts commit without throwing, and the fifth voids the code. Success changes only the password verifier, flushes before deleting every account code, revokes all session families with PASSWORD_RESET, audits and registers a password-change notice. Outcomes cross the transaction boundary before the public service raises a generic failure.

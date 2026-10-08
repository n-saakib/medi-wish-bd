# `MobileChangeService.java`

Source: [`MobileChangeService.java`](../../../../../../../src/main/java/bd/mediwish/user/MobileChangeService.java)

`stage` locks the caller, checks account state and P12 mobile format, rejects a number held by another User, deletes any pending row and inserts a new one without applying it. `cancel` unconditionally deletes whichever pending row exists (accepted P13). `activate` has no HTTP route; Ticket 61 calls it only after OTP verification. It requires the exact pending UUID, applies the new mobile as verified and deletes the pending row in one transaction. A `23505` collision becomes `DUPLICATE_USER`; rollback preserves the pending request.

Ticket 61 must expire the mobile verification code 90 seconds after issuance, rejecting it at the expiry instant. This lifetime belongs to the verifier; saving a pending number does not start an OTP timer, and the pending row remains until activation, replacement or cancellation.

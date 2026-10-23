# `AccountEmailSecurityTest.java`

Source: [AccountEmailSecurityTest.java](../../../../../../../src/test/java/bd/mediwish/auth/AccountEmailSecurityTest.java)

The public password-confirmation boundary counts five failures across calls, refuses even the right password while limited, allows it at the hour boundary and resets the count on success. Database and clock seams keep this deterministic.

## Ticket 05 integration

The email-change case proves all account codes are consumed, EMAIL_CHANGED is audited, the current session is retained while other families are revoked, and only a previously verified old address receives a notice.

The password counter is stubbed through the locking findByIdForUpdate read used in production.

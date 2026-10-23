# RecoverySecurityTest.java

Source: [RecoverySecurityTest.java](../../../../../../../src/test/java/bd/mediwish/web/RecoverySecurityTest.java)

The production Spring Security chain runs over a probe controller without PostgreSQL. Every recovery route is exercised for anonymous, expired, revoked, customer, delivery and unrestricted/restricted staff sessions. Tests preserve public reset bearer/CSRF independence, protected owner verification, MFA_REQUIRED, configured-origin preflights and the exact 16 KiB filter boundary.

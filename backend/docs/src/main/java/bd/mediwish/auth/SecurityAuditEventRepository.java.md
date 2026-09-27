# `SecurityAuditEventRepository.java`

Source: [`src/main/java/bd/mediwish/auth/SecurityAuditEventRepository.java`](../../../../../../../src/main/java/bd/mediwish/auth/SecurityAuditEventRepository.java)

Public Spring Data repository for `SecurityAuditEvent`, with no custom queries. Only `SecurityAuditLog` writes through it; nothing reads audit rows in the application yet. Covered through the staff MFA and provisioning integration tests.

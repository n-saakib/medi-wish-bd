# `SecurityAuditLog.java`

Source: [`src/main/java/bd/mediwish/auth/SecurityAuditLog.java`](../../../../../../../src/main/java/bd/mediwish/auth/SecurityAuditLog.java)

Package-private component with one operation, `record(type, subjectUserId, sessionId)`. It is `@Transactional(propagation = MANDATORY)`: it saves the row inside the caller's transaction and fails when there is none, so an audit row commits exactly when the change it records does (a failed code's row commits with the throttle failure). The time comes from the injected clock and `request_id` from the `requestId` MDC value that `RequestCorrelationFilter` sets; the provisioning command runs outside a request and records none. Covered by `StaffMfaServiceTest` and `FirstAdminProvisioningTest` (mocked) and by the staff MFA integration tests.

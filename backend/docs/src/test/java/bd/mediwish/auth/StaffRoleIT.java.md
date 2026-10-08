# StaffRoleIT.java

Tests the public role command with real registration, sessions and MFA in isolated PostgreSQL. Two independent devices lose both access and refresh credentials when Customer becomes Moderator. Enrollment grants inherited Customer access; demotion revokes it immediately, keeps the factor, and re-promotion requires a fresh code. DeliveryPerson needs no MFA and cannot use staff/admin routes. Assertions cover bounded detail fields, one stored role, version/audit/request-correlation and credential-free captured logs.

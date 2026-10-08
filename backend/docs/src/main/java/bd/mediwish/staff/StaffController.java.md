# `StaffController.java`

Source: [StaffController.java](../../../../../../../src/main/java/bd/mediwish/staff/StaffController.java)

GET /api/staff/me preserves Ticket 06's shape: authenticated username, a singleton roles array and the Super Admin flag from the bootstrap ID plus current ADMIN role. Only verified MODERATOR or ADMIN reaches it (ADMIN inherits MODERATOR). Restricted staff receive MFA_REQUIRED, lower roles ACCESS_DENIED and missing authentication 401.

The bootstrap lookup is one additional statement. Staff MFA, provisioning and role integration tests verify the response and immediate permission transitions.

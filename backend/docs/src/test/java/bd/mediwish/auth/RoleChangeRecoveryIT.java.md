# RoleChangeRecoveryIT.java

Checks role/version/audit/session atomicity through the actual role API and test-owned ordinary PostgreSQL triggers. Audit or revocation statement failures return the bounded INTERNAL_ERROR envelope and leave both devices active; removing the trigger permits one application. An application restart preserves committed revocations/version/history, makes a lost-response retry a no-op, preserves a newer session, and still rejects a stale different role. Captured logs omit credentials and injected failure text.

The two rollback cases install ordinary AFTER INSERT/UPDATE triggers in their own schema, so failures occur during the targeted audit or revocation SQL statement before commit. Their synthetic diagnostic marker is tracked and must not appear in logs or the bounded error response.

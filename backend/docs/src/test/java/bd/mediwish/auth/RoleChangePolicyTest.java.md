# RoleChangePolicyTest

Exercises the pure role assignment contract, including non-Admin no-op rejection; stale current-role retries; self and owner immutability; ordinary Admin refusal to set/remove Admin before stale checking; missing owner marker; owner transitions; all six lower-role changes; ordered assignable-role choices; and the three displayed MFA states. Database locks, audit and session writes are verified through service/integration seams separately.

The self-change matrix includes the Super Admin changing their own role: self refusal takes precedence over the protected-owner refusal, while an unchanged ADMIN assignment remains a no-op.

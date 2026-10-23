# StaffMfaRecoveryIT.java

Exercises staff authenticator recovery through real HTTP routes and the guarded PostgreSQL schema. Uses AuthApi.Shared for ordinary fixtures and isolated applications for Super Admin provisioning, disabled notifications and controlled clocks.

- Forces two recovery HTTP transactions to wait on a held User row lock; recursively inspects pg_blocking_pids before releasing either, then asserts one recovery, one counted rejection, one consumed code and bounded audit events.
- Checks replacement activation revokes the old factor, deletes its codes, revokes existing live sessions, activates ten fresh codes, sends a secret-free notice and permits later sign-in only with the replacement authenticator.
- Covers the seven actor states across enrollment, enrollment verification, TOTP verification, recovery and regeneration. TestApplication checks no-store and generated correlation headers for every response; AuthApi checks bounded errors and response shapes.
- Verifies unused-only code regeneration, consumed-code retention, TOTP replay, Super Admin self-recovery, abandonment and stale pending cleanup, ownership isolation and disabled-notifier outcome/audit.
- Checks the fifth valid-format wrong backup code locks recovery with 429, commits five failures and the lock audit, and leaves a correct code unconsumed. Restarting replacement enrollment gives 409 for the prior pending ID without changing the old factor or notifying, then accepts the current pending ID.
- Isolated primary RecoveryClock proves old access and refresh credentials are revoked while their natural lifetimes still remain and refresh cannot extend the replacement session past ten minutes.

All credentials are synthetic. AuthApi tracks returned seeds, backup codes, tokens and submitted TOTP values and checks captured request logs after tests. This source is authored coverage; Maven and PostgreSQL execution are recorded separately by the integrating agent.


Verification: 2026-10-20 at13968d1 plus uncommitted implementation, focused guarded PostgreSQL18 UTF8 run passed19/19 cases; the paired migration case also passed. Full T5 cumulative and joined UI gates remain separate. Evidence: main-checkout Ticket09 evidence/2026-10-20.md.

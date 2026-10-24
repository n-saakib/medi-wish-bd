# Tickets 05, 09 and 17 integrated backend evidence

Prepared 2026-10-23 (Asia/Dhaka) on `codex/integrate-tickets-05-09-17`. **Status: validation in progress; this draft does not establish cumulative acceptance or promotion to dev.** Final tested source revision: `a77c4fac5cda12fb10269266dff4ffe9ce4e10ba`. Final local dev revision: **PENDING**. See the [frontend evidence](../../frontend/docs/integration-05-09-17.md) for browser, client and demo gates.

## Frozen inputs and delivered integration

| Input | Frozen revision |
| --- | --- |
| Local dev baseline | `13968d1d9674e6a151045b1d1bd9b5e5d318b1e3` |
| Ticket 05 secondary-email recovery | `145073f18c0c29eb519d1da7c31b0ce7041c301c` |
| Ticket 09 staff authenticator recovery | `93f9c6a91080266acff8d341f09cee3e0c19fba9` |
| Ticket 17 public catalog browsing | `45e524826385d326aefb507f79353a077f0f6f65` |

The source histories were merged in order 05, 09, 17 (`f71dc90`, `b18c982`, `3a9c74a`). The candidate retains password-protected email changes, verified-email reset and session revocation, backup-code replacement restrictions, explicit anonymous catalog GET routes, bounded errors and request correlation. Historical ticket pass counts are not combined-candidate results. Ticket 17's tracker parent closure and the acceptance/disposition of Tickets 15 and 16 remain separate from proving this merge; their implementations are ancestors of the frozen local dev baseline.

Integration commit `627f451` connects staff replacement notices to verified mobile and email after the replacement transaction commits. The existing verified-email transport and capture adapters receive a code-free replacement kind/template. Eligible channels share one deadline; any delivered channel yields `SENT`, otherwise failure precedes absent configuration. No verified contact yields `NO_VERIFIED_CONTACT`. Notice and audit failures cannot roll back the completed replacement or hide the new backup codes. Real SMS, hosted mail delivery and durable retry remain deferred.

The integrated recovery regression checks password-reset revocation of verified/replacement sessions, guarded email-change revocation with the saving session preserved, anonymous catalog behavior with replacement/revoked bearer headers, and protected profile/address denial. See [IntegratedRecoveryIT](src/test/java/bd/mediwish/auth/IntegratedRecoveryIT.java.md), [StaffReplacementNotices](src/main/java/bd/mediwish/auth/StaffReplacementNotices.java.md) and its integration-test mirror.

## Schema preservation

The merged changelog retains `018-staff-mfa-recovery` and then `019-account-email-recovery` after `017-saved-addresses`. Recovery adds nullable replacement evidence, backup-code consumption evidence, email verification state, purpose-bound protected account codes and opaque issue/attempt limits. Existing Users stay unverified. No migration is renumbered. The local [migration body audit](../../.scratch/merge-05-09-17-20261023/migration-body-audit.json) compares original changeset bodies against the source refs and records unchanged bodies; this structural comparison is distinct from executing upgrade tests. The fresh default cumulative gate passes empty install, populated baseline and standalone ticket upgrade/restart checks, including `CombinedRecoveryMigrationIT` for already-applied 019 before 018. The compatibility gate also passes all 434 integration cases, including the dependency probe skipped by the default profile.

## Commands and gate ledger

Native Maven runs use Java 25.0.4.1, PostgreSQL 18.6 UTF8 `medi_wish_test` on guarded loopback 55433, task-owned disposable roles and isolated schemas. Maven/database work is serialized. The wrapper preserves invocation-specific reports rather than summing stale XML files.

```powershell
& .\.scratch\merge-05-09-17-20261023\backend.ps1 -Port 55433 -Label backend-default -MavenArgs '-o verify'
# Separate compatibility invocation, after the default run and any required correction:
& .\.scratch\merge-05-09-17-20261023\backend.ps1 -Port 55433 -Label backend-compatibility -MavenArgs '-o verify -Pcompatibility'
```

These commands are recorded as the intended gate entry points; the ledger below distinguishes actual completed results.

| Gate | Revision/date | Actual result |
| --- | --- | --- |
| Explicit standalone unit command | `a77c4fa`, 2026-10-23 23:04 +06:00 | PASS: `-o test`, 1,170 units; `backend-unit-final.log` |
| Focused backend integration/seam checks | Reset-fixture corrected inputs, 2026-10-23 | PASS: 17 notice units and 11 integration cases (standalone-05 migration 1, cross-ticket recovery 3, notice matrix 7); `backend-focused-fixed.log` |
| Full default `verify` | Started 2026-10-23 22:06:58 +06:00 on `5c2930ebef898c6963d909ef5ec7f556206cd156` | FAILED: 1,170 units passed; 434 integration cases include one failed MFA timing assertion and one expected skip. Retained `backend-default.log` and per-invocation reports. |
| Fresh corrected cumulative default gate | `a77c4fac5cda12fb10269266dff4ffe9ce4e10ba`, 2026-10-23 22:31–22:47 +06:00 | PASS: 1,170 units, 433 passing integration cases and one expected compatibility-only skip; `backend-default-final.log`, invocation-specific reports under `surefire-backend-default-final/` and `failsafe-backend-default-final/` |
| Compatibility `verify` | `a77c4fac5cda12fb10269266dff4ffe9ce4e10ba`, 2026-10-23 22:47–23:03 +06:00 | PASS: 1,170 units and all 434 integration cases, zero failures/skips, including `DependencyCompatibilityIT`; `backend-compatibility.log` and fresh invocation-specific reports |
| Normal-profile jar used for live checks | `a77c4fa`, 2026-10-23 | Live API pass: SHA-256 `7F359687E1775D6647628157933D5B7FFD3F924801517A32ED5C5A27B66A5C96`; each browser/demo invocation records and checks its jar identity separately |

## Failed attempts and corrections

The initial integrated reset fixture exceeded the shared password-length contract. Commit `5c2930e` corrects only that synthetic password; it does not relax the production policy. The focused rerun passed 17 notice units plus all 11 integrated migration/recovery/notice cases; the fresh full default gate subsequently passed on committed final inputs.

The historical failed default invocation records `StaffMfaIT.anEnrolledAdminVerifiesEachSignInAndACodeIsAcceptedOnlyOnce` failing its expected-400 replay assertion. Diagnostic timestamps show enrollment at 16:15:28.677Z returned at 16:15:30.140Z; the alleged replay at 16:15:30.329Z generated an unused new-step code. A pinned-time production-TOTP probe reproduced the old pattern and confirmed exact accepted-step replay is rejected. Test-only commit `8344a92` derives that code from persisted `last_used_step`; its first focused compile exposed the missing Base32 import, corrected by `a77c4fa` (`backend-mfa-fixed.log` retains that compilation failure). The corrected focused run passed 17 notice units and all 16 MFA integration cases (`backend-mfa-fixed-final.log`); see [diagnosis](../../.scratch/merge-05-09-17-20261023/mfa-replay-diagnosis.md). Retain the original failed invocation even if a later focused rerun passes. The named fresh default and compatibility cumulative reruns below supersede that failed attempt; they both passed. Any later executable correction still requires fresh applicable cumulative verification.

Frontend fixture commit `25396f0` adds the new replacement-notice kind to the shared captured-mail parser and its unit regression. It preserves the whitelist and existing recovery behavior; see the frontend record for the fresh full verification result.

## Evidence, cleanup and delivery boundary

Local evidence root: [`.scratch/merge-05-09-17-20261023/`](../../.scratch/merge-05-09-17-20261023/), including `input-tips.txt`, `candidate-source-hashes.json`, `migration-body-audit.json`, per-run metadata/logs and fresh report copies. Ignored scratch artifacts are local evidence, not files delivered through Git. The [merge plan](../../agent-docs/plans/tickets-05-09-17-merge-plan.md) records authorization and acceptance scope.

Final role/schema/session/object-storage/mail cleanup: **PENDING**. Final API/frontend ports and task-owned PostgreSQL state: **PENDING**. Combined staged-diff/documentation checks, structural tracker validation and local dev promotion: **PENDING**. No push or deployment has been performed by this merge task. Do not mark this draft complete until required gates and cleanup have concrete recorded results.

## Confirmed interruption correction and fresh acceptance boundary

On 2026-10-24, a deterministic probe and Maven regression reproduced a lost successful notice outcome: the coordinator consumed `SENT`, then an interrupted second wait returned and audited `FAILED`. The minimal correction preserves the consumed aggregate when interruption is caught, while restoring interruption and cancelling unfinished work. The existing audit clear/restore behavior remains intact. The red regression recorded expected `SENT` / actual `FAILED`; the corrected full notice unit suite passed 18 cases (`notice-interruption-red.log`, `notice-interruption-green.log`). Reproducible diagnostic evidence is in `notice-interruption-diagnosis.md`.

**The backend and live passes above apply to the prior `a77c4fa` candidate. Fresh cumulative backend/live/browser acceptance for this production correction is PENDING and must supersede those results before dev promotion.** New invocation labels use `*-current`; the original passing/failed reports are retained. Frontend source inputs are unchanged, so the 1,208-unit/lint/typecheck/build result remains applicable through executable-input hash comparison.

The second browser invocation passed the formerly failing catalog-navigation cases but was stopped incomplete to supersede the pre-correction runtime. Its identified runner PID 22412, exact role/schema `mw_browser_15979c41a4ee` and mail/storage directories were released; retained artifacts use `browser-cumulative-superseded*`. It establishes no cumulative pass.

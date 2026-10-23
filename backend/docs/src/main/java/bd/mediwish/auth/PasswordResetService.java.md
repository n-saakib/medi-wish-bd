# Public password recovery service

Source: [`PasswordResetService.java`](../../../../../../../src/main/java/bd/mediwish/auth/PasswordResetService.java)

Requests atomically count the opaque address key before lookup, silently refuse unknown/ineligible/limited addresses, then lock and refresh the User and recheck the typed address and eligibility. Only admitted issues audit and register mail. Cleanup runs last after every normal outcome, including each silent refusal, skips locked counter rows and deletes only counters older than Recovery.limitRetention() (two hours, or the longest configured window when larger). Confirmation hashes the exact typed password before lookup and outside the transaction, then calls PasswordResetTransaction; an INVALID result becomes the generic CodeInvalidException after the transaction commits its wrong-attempt changes.

Issuance reads Clock again after the locked User refresh. The shared gap, issue window, creation and expiry use that fresh instant, so a delayed request cannot issue twice in quick succession using old arrival times. Typed-address accounting and final age cleanup retain request-start time.

Cleanup is not in a finally block: when a statement fails, PostgreSQL has aborted the transaction, so a cleanup statement would fail too and hide the original exception. The failure propagates unchanged and the rollback discards the request.

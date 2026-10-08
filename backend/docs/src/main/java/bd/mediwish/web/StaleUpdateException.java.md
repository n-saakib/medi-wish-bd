# `StaleUpdateException.java`

Source: [StaleUpdateException.java](../../../../../../../src/main/java/bd/mediwish/web/StaleUpdateException.java)

Shared optimistic-command failure: the submitted version differs from current state. The advice returns 409 STALE_UPDATE and instructs the caller to reload. Ticket 08 decides a same-role retry before this check.

Ticket 14 Category and Product commands throw it only after recognizing an identical retry, which never bumps the version.

# `tests/AddressBook.test.tsx`

Mounted behavior units use the real SessionProvider and a controlled authenticated HTTP boundary. Cover empty/full/count/order, Add/Edit allowances, first default, validation without writes, lost-save same-id replay and reconciliation, terminal refusals, closure, stale Reload, default promotion, single-flight, failed-load recovery, successful updated allowances and late previous-session replies.

Verification: focused address projector/component units and the existing Ticket 12 browser suites. Full cumulative evidence is recorded by the story coordinator.

Boundary tests preserve NBSP/FEFF in submitted label/name, allow ASCII-padded maximum names after Java trim, and reject maximum names exceeded by retained FEFF.

Regressions verify Keep performs no command, a held stale Reload rejects concurrent submits and permits a failed-read retry, and Tab wraps in both directions.

# `DiscountServiceTest.java`

Checks direct authorization before persistence, one atomic create audit, UUID/body replay after date/target changes, conflict, identical update before stale version, ended no-op and status-independent tab counts using repository fakes.

A mixed-page regression gives Product and Category the same target UUID and distinct names. It verifies both discount identities and target types, their labels, null Product versus one-member Category counts, page totals and exactly one batch lookup per target type/count.

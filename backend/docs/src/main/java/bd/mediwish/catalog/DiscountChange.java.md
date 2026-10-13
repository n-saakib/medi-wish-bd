# `DiscountChange.java`

Transactional audit snapshot for CREATED, UPDATED and ENDED mutations. Copies kind, value and dates at mutation time, with nullable actor UUID and correlation id; later Discount edits do not rewrite prior snapshots.

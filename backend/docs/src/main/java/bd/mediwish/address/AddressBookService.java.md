# AddressBookService.java

Source: [AddressBookService.java](../../../../../../../src/main/java/bd/mediwish/address/AddressBookService.java)

Each mutation locks the owner User before reading the book, checks active state, normalizes fields, handles ownership/replay/version/default constraints, then enforces both change limits before writing. Clears the old default and flushes before replacement. A successful add or changed edit records one change; replay, identical edit, removal and promotion record none. Removing the default promotes the first remaining PostgreSQL-ordered row. Every response includes server allowance; read-only book remains available while closing and neither locks nor prunes. Ticket 25 must call create after its order commits in a separate transaction.

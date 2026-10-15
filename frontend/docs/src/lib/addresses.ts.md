# `src/lib/addresses.ts`

Strict caller-owned address-book API boundary. Exports SavedAddress, AddressDraft, ChangeAllowance and AddressBook plus projectAddressBook and the four authenticated commands. Rejects extra/missing keys, unsafe fields, invalid UUIDs, versions, cap, allowance and default invariants. Creates accept 201 or 200 replay; DELETE sends only id and version. Errors retain bounded code/status, never server diagnostics.

Verification: focused address projector/component units and the existing Ticket 12 browser suites. Full cumulative evidence is recorded by the story coordinator.

# `src/account/AddressBook.tsx`

Addresses page body guarded by the account session and keyed by session generation. Renders server-ordered cards, returned cap/count, empty/full states and closing read-only state. One command at a time; late old-session answers are discarded. Recovery rereads after full, change-limit, earlier-save conflict or removed-row failures. Unknown create outcomes reconcile before Add becomes available. Removing the default announces the returned successor label/city (oldest remaining address, server rule A1). Change-limit refusal shows one focused warning while removal remains available.

Verification: focused address projector/component units and the existing Ticket 12 browser suites. Full cumulative evidence is recorded by the story coordinator.

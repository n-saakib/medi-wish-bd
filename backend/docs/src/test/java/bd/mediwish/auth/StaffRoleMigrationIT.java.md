# StaffRoleMigrationIT

Uses a run-owned PostgreSQL schema and finds all changesets before reserved 011 at runtime. Synthetic fixtures cover seven legacy role combinations, including no role. Upgrade keeps each highest role, fills Customer for roleless accounts, sets version zero, writes no role audit and preserves the owner pointer and existing verified session/refresh rows. An unknown role halts before changing data.

Commit-time integrity cases cover inserting a User without a role, deleting their only role, deleting then changing the User id, retaining the role during an id change (foreign-key refusal, no role-required error), replacing the role within one transaction, rejecting a second/unknown role and cascading User deletion.

The legacy verified owner's preserved refresh cookie is exercised through the real API after upgrade. It rotates successfully with VERIFIED assurance; after application restart, its access token still reaches the staff profile with exactly ADMIN and the retained owner marker. Fixtures use a real usable synthetic Argon2 verifier.

A search-path case writes from a session whose search path is only `pg_catalog`, as an operator's SQL session might be, using schema-qualified names. A roleless User insert and deleting the only role are refused with `every User needs a role` (SQLState 23514), a delete-then-insert role replacement commits, and the function's stored configuration is `search_path=<run schema>, pg_temp` (changeset 014). Without 014 the same SQL fails with `relation "users" does not exist`.

# UserRepository

Spring Data repository for shared User persistence. It exposes registration uniqueness checks plus exact username, verified-mobile and case-insensitive email lookups for the Ticket 03 authentication service. Email is unique ignoring case (changeset `009-unique-user-email`), so `findByEmailIgnoreCase` returns at most one User; the service never calls it with `null`, which Spring Data would turn into `email IS NULL`. The unique `upper(email)` index serves the lookup while preserving stored email values; controllers and web adapters do not call these queries directly.

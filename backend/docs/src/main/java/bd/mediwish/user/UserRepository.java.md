# UserRepository

Spring Data repository for shared User persistence. It exposes registration uniqueness checks plus exact username, verified-mobile and case-insensitive, at-most-two email candidate queries for the Ticket 03 authentication service. Email remains non-unique so the service can reject ambiguous matches without loading an unbounded duplicate set or choosing a winner. The Liquibase `upper(email)` index supports the case-insensitive lookup while preserving stored email values; controllers and web adapters do not call these queries directly.

# UserRepository

Spring Data repository for shared User persistence. It exposes registration uniqueness checks plus exact username, verified-mobile and all-email candidate queries for the Ticket 03 authentication service. Email remains non-unique so the service can reject ambiguous matches without choosing a winner; controllers and web adapters do not call these queries directly.

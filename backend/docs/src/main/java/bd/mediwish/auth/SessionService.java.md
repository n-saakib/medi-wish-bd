# SessionService

Transactional owner of durable session-family state. It creates generation zero, hashes random 32-byte refresh values, locks the presented generation and family during rotation, consumes exactly once, detects replay, revokes one or all families and validates active session/user binding. Controllers receive only typed results and never manipulate repository rows or hashes.

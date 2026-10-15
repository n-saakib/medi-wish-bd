# ProductImageRepository.java

Owns metadata queries, create-only inserts, same-Product deletes, compact ordering and durable identity retirement. The deferred unique ordering constraint is checked explicitly before commit to keep stale ordering failures within the bounded API contract. No image bytes are persisted.

Upload claims the global image identity with a PostgreSQL transaction-scoped advisory lock, using a stable 64-bit hash of the UUID. Hash collisions only serialize unrelated uploads. The lock releases at transaction end and returns a scalar so Hibernate never needs to map PostgreSQL's void result.

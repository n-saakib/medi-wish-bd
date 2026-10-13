# ProductImageRepository.java

Owns metadata queries, create-only inserts, same-Product deletes, compact ordering and durable identity retirement. The deferred unique ordering constraint is checked explicitly before commit to keep stale ordering failures within the bounded API contract. No image bytes are persisted.

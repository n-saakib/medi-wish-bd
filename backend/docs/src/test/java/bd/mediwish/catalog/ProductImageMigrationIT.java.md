# ProductImageMigrationIT.java

Upgrades empty and occupied014 schemas to015 using real PostgreSQL18 and Liquibase. Preserves existing Product metadata and verifies ownership, MIME, dimensions, size, hash, alt text, ordering, version, foreign-key restrictions and metadata-only storage. A repeated update leaves image rows intact. Each case owns a guarded disposable test schema; no development database is used.

Also exercises unchanged014 changelog against a015 schema containing image rows, unchanged catalog pricing edits with image metadata preserved, retired-id uniqueness and an actual repository SET CONSTRAINTS statement failure with Hibernate ConstraintViolationException naming uk_product_images_order.

Verifies image audit foreign keys become null after User deletion and the object-key unique constraint exists.

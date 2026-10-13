# ProductImage.java

Maps product_images metadata, dimensions, sanitized hash, ordering, alt text and audit columns. Alt and position changes update image version only. The Product entity and its version are untouched.


The SHA-256 field explicitly uses JDBC CHAR to match PostgreSQL CHAR(64) during Hibernate schema validation.

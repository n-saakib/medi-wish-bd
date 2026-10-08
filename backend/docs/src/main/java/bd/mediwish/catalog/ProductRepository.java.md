# `ProductRepository.java`

JPA Product access: row-locked edits, stable paged search with literal percent/underscore matching, category/status/review filters, and one PostgreSQL insert-on-ID-conflict statement that only inserts under an active category.

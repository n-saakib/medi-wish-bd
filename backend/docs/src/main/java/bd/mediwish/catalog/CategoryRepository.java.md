# `CategoryRepository.java`

JPA category access: row-locked edit, stable paged list, one grouped Product count for the page, and PostgreSQL insert-on-ID-conflict for replay-safe create. `findListable` returns active categories with at least one active priced Product, ordered by lower-case name and ID. A name collision remains a database conflict.

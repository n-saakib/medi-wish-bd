# `ProductRepository.java`

JPA Product access: row-locked edits, stable paged search with literal percent/underscore matching, category/status/review filters, and one PostgreSQL insert-on-ID-conflict statement that only inserts under an active category.

`findNamesById` retrieves only product IDs and names in one scalar projection for discount target labels. It does not load Product entities or their categories, keeping query count bounded when targets belong to many categories.

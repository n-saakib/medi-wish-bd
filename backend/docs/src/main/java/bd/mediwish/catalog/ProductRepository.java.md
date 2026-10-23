# `ProductRepository.java`

JPA Product access: row-locked edits, stable paged search with literal percent/underscore matching, category/status/review filters, and one PostgreSQL insert-on-ID-conflict statement that only inserts under an active category. The public catalog read queries count, page and load only active priced Products; category pages order by lower-case name and ID and fetch the Category needed by the response in the same query.

`findNamesById` retrieves only product IDs and names in one scalar projection for discount target labels. It does not load Product entities or their categories, keeping query count bounded when targets belong to many categories.

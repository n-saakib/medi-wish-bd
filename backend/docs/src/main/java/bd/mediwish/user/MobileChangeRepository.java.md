# `MobileChangeRepository.java`

Source: [`MobileChangeRepository.java`](../../../../../../../src/main/java/bd/mediwish/user/MobileChangeRepository.java)

Finds the single pending row for a User and bulk-deletes it by User ID. The modifying delete executes before a replacement insert, avoiding Hibernate's queued insert-before-delete conflict on the unique `user_id`. The caller holds the User row lock and transaction; a rollback restores the deleted pending row after an activation uniqueness failure.

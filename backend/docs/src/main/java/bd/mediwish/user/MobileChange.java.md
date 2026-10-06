# `MobileChange.java`

Source: [`MobileChange.java`](../../../../../../../src/main/java/bd/mediwish/user/MobileChange.java)

JPA entity for one staged number in `user_mobile_changes`: generated UUID, User ID, 11-digit new mobile and request time. The unique User ID and cascading foreign key are defined in Liquibase. Replacing a pending change creates a new UUID, invalidating an older verifier attempt. The current `users.mobile` remains authoritative until activation.

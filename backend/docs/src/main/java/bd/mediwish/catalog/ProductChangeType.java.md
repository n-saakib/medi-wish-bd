# `ProductChangeType.java`

Fixed audit event names for create, catalog, price, validation flag, activation, and deactivation changes. Free-text product content is not copied into audit rows.

DISCOUNT_STARTED and DISCOUNT_ENDED are derived Product history events only; they are not stored in product_changes or its unchanged check constraint.

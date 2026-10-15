package bd.mediwish.catalog;

public enum ProductChangeType {
    CREATED, CATALOG_UPDATED, PRICE_CHANGED, REQUIRE_VALIDATION_CHANGED, ACTIVATED, DEACTIVATED,
    // Derived at read time; the persisted audit constraint deliberately excludes these.
    DISCOUNT_STARTED, DISCOUNT_ENDED
}

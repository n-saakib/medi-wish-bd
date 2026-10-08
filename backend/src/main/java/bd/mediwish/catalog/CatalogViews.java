package bd.mediwish.catalog;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

record CatalogPage<T>(List<T> items, int page, int size, long totalItems) {}
record CatalogCreation<T>(T value, boolean created) {}
record CategoryView(UUID id, String name, boolean active, long productCount, long version) {}
record ProductSummary(UUID id, ProductKind kind, String name, String brandName, String genericName,
                      String dosageForm, String manufacturer, UUID categoryId, String categoryName,
                      String saleUnit, String sellingPrice, String mrp, boolean active,
                      boolean requireValidation, ProductStatus status) {}
record ProductHistory(Instant occurredAt, String actorUsername, ProductChangeType changeType,
                      String oldSellingPrice, String newSellingPrice, String oldMrp, String newMrp,
                      Boolean oldRequireValidation, Boolean newRequireValidation) {}
record ProductView(UUID id, ProductKind kind, String name, String brandName, String genericName,
                   String dosageForm, String manufacturer, UUID categoryId, String categoryName,
                   String saleUnit, String sellingPrice, String mrp, boolean active,
                   boolean requireValidation, ProductStatus status, String description, long version,
                   Instant updatedAt, String updatedByUsername, List<ProductHistory> history) {}

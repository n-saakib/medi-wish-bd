package bd.mediwish.catalog;

import tools.jackson.databind.JsonNode;
import java.util.Set;
import java.util.UUID;

/** Strict request shapes local to catalog: unrelated authentication JSON retains its existing contract. */
final class CatalogRequests {
    private CatalogRequests() {}
    record CategoryCreate(UUID id, String name) {}
    record CategoryUpdate(String name, boolean active, long version) {}
    record ProductCreate(UUID id, ProductKind kind, ProductRules.CatalogFields fields) {}
    record ProductUpdate(ProductRules.CatalogFields fields, long version) {}
    record PricingUpdate(Money sellingPrice, Money mrp, long version) {}

    static ProductCreate productCreate(JsonNode body) {
        object(body, Set.of("id", "kind", "name", "brandName", "genericName", "manufacturer", "dosageForm",
                "saleUnit", "description", "categoryId", "requireValidation"));
        ProductKind kind;
        try { kind = ProductKind.valueOf(string(body, "kind", true)); }
        catch (IllegalArgumentException exception) { throw new InvalidCatalogException("kind"); }
        return new ProductCreate(uuid(string(body, "id", true)), kind, fields(body, kind == ProductKind.MEDICINE, false));
    }

    static ProductUpdate productUpdate(JsonNode body) {
        object(body, Set.of("name", "brandName", "genericName", "manufacturer", "dosageForm", "saleUnit",
                "description", "categoryId", "requireValidation", "active", "version"));
        return new ProductUpdate(fields(body, false, bool(body, "active")), version(body));
    }

    static PricingUpdate pricingUpdate(JsonNode body) {
        object(body, Set.of("sellingPrice", "mrp", "version"));
        String mrp = string(body, "mrp", false);
        return new PricingUpdate(Money.parse(string(body, "sellingPrice", true)),
                mrp == null ? null : Money.parse(mrp), version(body));
    }

    private static ProductRules.CatalogFields fields(JsonNode body, boolean medicine, boolean active) {
        return new ProductRules.CatalogFields(string(body, "name", true), string(body, "brandName", false),
                string(body, "genericName", medicine), string(body, "manufacturer", false),
                string(body, "dosageForm", medicine), string(body, "saleUnit", true), string(body, "description", false),
                uuid(string(body, "categoryId", true)), bool(body, "requireValidation"), active);
    }

    private static boolean bool(JsonNode body, String name) {
        JsonNode value = body.get(name);
        if (value == null || !value.isBoolean()) throw new InvalidCatalogException(name);
        return value.booleanValue();
    }

    static CategoryUpdate categoryUpdate(JsonNode body) {
        object(body, Set.of("name", "active", "version"));
        return new CategoryUpdate(string(body, "name", true), bool(body, "active"), version(body));
    }

    private static long version(JsonNode body) {
        JsonNode value = body.get("version");
        if (value == null || !value.isIntegralNumber() || !value.canConvertToLong() || value.longValue() < 0) {
            throw new InvalidCatalogException("version");
        }
        return value.longValue();
    }

    static CategoryCreate categoryCreate(JsonNode body) {
        object(body, Set.of("id", "name"));
        return new CategoryCreate(uuid(string(body, "id", true)), string(body, "name", true));
    }

    private static void object(JsonNode body, Set<String> allowed) {
        if (body == null || !body.isObject()
                || body.properties().stream().anyMatch(property -> !allowed.contains(property.getKey()))) {
            throw new InvalidCatalogException("body");
        }
    }

    private static String string(JsonNode body, String name, boolean required) {
        JsonNode value = body.get(name);
        if (value == null || value.isNull()) {
            if (required) throw new InvalidCatalogException(name);
            return null;
        }
        if (!value.isString()) throw new InvalidCatalogException(name);
        return value.stringValue();
    }

    static int page(String raw) { return integer(raw, 0, 0, Integer.MAX_VALUE); }

    static int size(String raw) { return integer(raw, 20, 1, 50); }

    private static int integer(String raw, int defaultValue, int minimum, int maximum) {
        if (raw == null) return defaultValue;
        try {
            int value = Integer.parseInt(raw);
            if (value < minimum || value > maximum) throw new InvalidCatalogException("page");
            return value;
        } catch (NumberFormatException exception) { throw new InvalidCatalogException("page"); }
    }

    static boolean queryBoolean(String raw, boolean defaultValue) {
        if (raw == null) return defaultValue;
        if (raw.equals("true")) return true;
        if (raw.equals("false")) return false;
        throw new InvalidCatalogException("query");
    }

    static String query(String raw) {
        if (raw != null && raw.length() > 100) throw new InvalidCatalogException("q");
        return raw;
    }

    static ProductStatus status(String raw) {
        if (raw == null) return null;
        try { return ProductStatus.valueOf(raw); }
        catch (IllegalArgumentException exception) { throw new InvalidCatalogException("status"); }
    }

    static UUID uuid(String value) {
        if (value == null || !value.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) {
            throw new InvalidCatalogException("id");
        }
        return UUID.fromString(value);
    }
}
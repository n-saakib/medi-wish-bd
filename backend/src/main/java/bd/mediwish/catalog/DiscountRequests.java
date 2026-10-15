package bd.mediwish.catalog;

import tools.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Set;
import java.util.UUID;

final class DiscountRequests {

    private DiscountRequests() {
    }

    record DiscountCreate(UUID id, DiscountTargetType targetType, UUID targetId, DiscountKind kind, BigDecimal value,
            LocalDate startsOn, LocalDate endsOn) {
    }

    record DiscountUpdate(DiscountKind kind, BigDecimal value, LocalDate startsOn, LocalDate endsOn, long version) {
    }

    record DiscountEnd(long version) {
    }

    static DiscountCreate create(JsonNode body) {
        CatalogRequests.object(body, Set.of("id", "targetType", "targetId", "kind", "value", "startsOn", "endsOn"));
        DiscountKind kind = kind(body);
        return new DiscountCreate(CatalogRequests.uuid(CatalogRequests.string(body, "id", true)), target(body),
                CatalogRequests.uuid(CatalogRequests.string(body, "targetId", true)), kind, value(body, kind),
                date(body, "startsOn", true), date(body, "endsOn", false));
    }

    static DiscountUpdate update(JsonNode body) {
        CatalogRequests.object(body, Set.of("kind", "value", "startsOn", "endsOn", "version"));
        DiscountKind kind = kind(body);
        return new DiscountUpdate(kind, value(body, kind), date(body, "startsOn", true), date(body, "endsOn", false),
                CatalogRequests.version(body));
    }

    static DiscountEnd end(JsonNode body) {
        CatalogRequests.object(body, Set.of("version"));
        return new DiscountEnd(CatalogRequests.version(body));
    }

    static DiscountStatus status(String raw) {
        if (raw == null)
            throw new InvalidCatalogException("status");
        try {
            return DiscountStatus.valueOf(raw);
        }
        catch (IllegalArgumentException ex) {
            throw new InvalidCatalogException("status");
        }
    }

    private static DiscountKind kind(JsonNode body) {
        try {
            return DiscountKind.valueOf(CatalogRequests.string(body, "kind", true));
        }
        catch (IllegalArgumentException ex) {
            throw new InvalidCatalogException("kind");
        }
    }

    private static DiscountTargetType target(JsonNode body) {
        try {
            return DiscountTargetType.valueOf(CatalogRequests.string(body, "targetType", true));
        }
        catch (IllegalArgumentException ex) {
            throw new InvalidCatalogException("targetType");
        }
    }

    private static BigDecimal value(JsonNode body, DiscountKind kind) {
        String raw = CatalogRequests.string(body, "value", true);
        if (kind == DiscountKind.FLAT)
            return Money.parse(raw).value();
        if (!raw.matches("[1-9][0-9]?"))
            throw new InvalidCatalogException("value");
        return new BigDecimal(raw);
    }

    private static LocalDate date(JsonNode body, String key, boolean required) {
        String raw = CatalogRequests.string(body, key, required);
        if (raw == null)
            return null;
        if (!raw.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))
            throw new InvalidCatalogException(key);
        try {
            return LocalDate.parse(raw);
        }
        catch (DateTimeParseException ex) {
            throw new InvalidCatalogException(key);
        }
    }

}

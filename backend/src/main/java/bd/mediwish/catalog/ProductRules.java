package bd.mediwish.catalog;

import bd.mediwish.user.UserRole;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** Pure catalog, permission and pricing rules used before any persistence mutation. */
public final class ProductRules {
    private ProductRules() {}

    public record CatalogFields(String name, String brandName, String genericName, String manufacturer,
                                String dosageForm, String saleUnit, String description, UUID categoryId,
                                Boolean requireValidation, Boolean active) {}

    public static CatalogFields validateCatalog(ProductKind kind, CatalogFields fields) {
        if (kind == null) throw new InvalidCatalogException("kind");
        if (fields == null) throw new InvalidCatalogException("catalog");
        String name = text(fields.name, 160, true, false, "name");
        String brand = text(fields.brandName, 120, false, false, "brandName");
        String generic = text(fields.genericName, 200, kind == ProductKind.MEDICINE, false, "genericName");
        String manufacturer = text(fields.manufacturer, 120, false, false, "manufacturer");
        String dosage = text(fields.dosageForm, 120, kind == ProductKind.MEDICINE, false, "dosageForm");
        String saleUnit = text(fields.saleUnit, 80, true, false, "saleUnit");
        String description = text(fields.description, 4000, false, true, "description");
        if (kind == ProductKind.EQUIPMENT && generic != null) throw new InvalidCatalogException("genericName");
        if (kind == ProductKind.EQUIPMENT && fields.dosageForm != null) throw new InvalidCatalogException("dosageForm");
        if (fields.categoryId == null) throw new InvalidCatalogException("categoryId");
        if (fields.requireValidation == null) throw new InvalidCatalogException("requireValidation");
        if (fields.active == null) throw new InvalidCatalogException("active");
        return new CatalogFields(name, brand, generic, manufacturer, dosage, saleUnit, description,
                fields.categoryId, fields.requireValidation, fields.active);
    }

    /** Trim a submitted edit so a lost-response retry can be recognized before checking its version. */
    public static CatalogFields normalizeCatalog(CatalogFields fields) {
        if (fields == null) throw new InvalidCatalogException("catalog");
        // A submitted blank dosage remains invalid intent, including an otherwise identical Equipment edit.
        String dosage = trim(fields.dosageForm, false);
        if (dosage == null && fields.dosageForm != null) dosage = fields.dosageForm;
        return new CatalogFields(trim(fields.name, false), trim(fields.brandName, false), trim(fields.genericName, false),
                trim(fields.manufacturer, false), dosage, trim(fields.saleUnit, false),
                trim(fields.description, true), fields.categoryId, fields.requireValidation, fields.active);
    }

    public static boolean canEdit(UserRole role, CatalogArea area) {
        if (role == null || area == null) return false;
        return role == UserRole.ADMIN || role == UserRole.MODERATOR && area != CatalogArea.PRICING;
    }

    public static void validatePricing(Money sellingPrice, Money mrp) {
        if (sellingPrice == null) throw new InvalidCatalogException("sellingPrice");
        if (mrp != null && sellingPrice.compareTo(mrp) > 0) {
            throw new InvalidCatalogException("sellingPriceAboveMrp");
        }
    }

    public static void requirePurchasable(boolean active, Money sellingPrice) {
        if (active && sellingPrice == null) throw new PriceRequiredException();
    }

    public static boolean sameCreate(ProductKind storedKind, CatalogFields stored,
                                     ProductKind requestKind, CatalogFields request) {
        if (storedKind != requestKind) return false;
        CatalogFields normalized = validateCatalog(requestKind, request);
        return sameCatalog(stored, normalized)
                && Objects.equals(stored.requireValidation, normalized.requireValidation);
    }

    public static List<ProductChangeType> diff(CatalogFields before, CatalogFields after,
                                               Money oldPrice, Money newPrice, Money oldMrp, Money newMrp) {
        var changes = new ArrayList<ProductChangeType>();
        if (!sameCatalog(before, after)) changes.add(ProductChangeType.CATALOG_UPDATED);
        if (!Objects.equals(before.requireValidation, after.requireValidation)) {
            changes.add(ProductChangeType.REQUIRE_VALIDATION_CHANGED);
        }
        if (!Objects.equals(before.active, after.active)) {
            changes.add(after.active ? ProductChangeType.ACTIVATED : ProductChangeType.DEACTIVATED);
        }
        if (!sameMoney(oldPrice, newPrice) || !sameMoney(oldMrp, newMrp)) {
            changes.add(ProductChangeType.PRICE_CHANGED);
        }
        return List.copyOf(changes);
    }

    private static boolean sameCatalog(CatalogFields a, CatalogFields b) {
        return Objects.equals(a.name, b.name) && Objects.equals(a.brandName, b.brandName)
                && Objects.equals(a.genericName, b.genericName) && Objects.equals(a.manufacturer, b.manufacturer)
                && Objects.equals(a.dosageForm, b.dosageForm) && Objects.equals(a.saleUnit, b.saleUnit)
                && Objects.equals(a.description, b.description) && Objects.equals(a.categoryId, b.categoryId);
    }

    private static boolean sameMoney(Money a, Money b) {
        return a == null ? b == null : b != null && a.compareTo(b) == 0;
    }

    private static String text(String raw, int maximum, boolean required, boolean lineBreaks, String field) {
        if (raw != null && raw.chars().anyMatch(c -> Character.isISOControl(c)
                && (!lineBreaks || c != '\n' && c != '\r'))) {
            throw new InvalidCatalogException(field);
        }
        String value = raw == null ? null : raw.trim();
        if (value == null || value.isEmpty()) {
            if (required) throw new InvalidCatalogException(field);
            return null;
        }
        if (value.length() > maximum) {
            throw new InvalidCatalogException(field);
        }
        return value;
    }

    private static String trim(String raw, boolean lineBreaks) {
        if (raw == null) return null;
        // Invalid controls remain part of the intent until validation, after the stale-version check.
        if (raw.chars().anyMatch(c -> Character.isISOControl(c)
                && (!lineBreaks || c != '\n' && c != '\r'))) return raw;
        String value = raw.trim();
        return value.isEmpty() ? null : value;
    }
}

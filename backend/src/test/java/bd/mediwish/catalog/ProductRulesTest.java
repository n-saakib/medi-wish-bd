package bd.mediwish.catalog;

import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProductRulesTest {
    private static final UUID CATEGORY = UUID.fromString("25bb5685-6466-4dbc-a184-dce579a3e5e8");

    @Test
    void aMedicineKeepsItsRequiredIdentityAndNormalizesOptionalText() {
        var fields = new ProductRules.CatalogFields(" Napa 500 ", " ", " Paracetamol ", null,
                " Tablet 500 mg ", " Strip of 10 tablets ", " ", CATEGORY, false, false);

        var normalized = ProductRules.validateCatalog(ProductKind.MEDICINE, fields);

        assertThat(normalized.name()).isEqualTo("Napa 500");
        assertThat(normalized.genericName()).isEqualTo("Paracetamol");
        assertThat(normalized.dosageForm()).isEqualTo("Tablet 500 mg");
        assertThat(normalized.saleUnit()).isEqualTo("Strip of 10 tablets");
        assertThat(normalized.brandName()).isNull();
        assertThat(normalized.description()).isNull();
    }

    @Test
    void onlyAnAdminMayEditPricing() {
        assertThat(ProductRules.canEdit(UserRole.ADMIN, CatalogArea.PRICING)).isTrue();
        assertThat(ProductRules.canEdit(UserRole.MODERATOR, CatalogArea.PRICING)).isFalse();
        assertThat(ProductRules.canEdit(UserRole.MODERATOR, CatalogArea.CATALOG)).isTrue();
        assertThat(ProductRules.canEdit(UserRole.CUSTOMER, CatalogArea.CATALOG)).isFalse();
    }

    @Test
    void everyRoleAndAreaPairFollowsTheAcceptedPermissionMatrix() {
        for (UserRole role : UserRole.values()) {
            for (CatalogArea area : CatalogArea.values()) {
                boolean permitted = role == UserRole.ADMIN
                        || role == UserRole.MODERATOR && area != CatalogArea.PRICING;
                assertThat(ProductRules.canEdit(role, area)).as("%s in %s", role, area).isEqualTo(permitted);
            }
            assertThat(ProductRules.canEdit(role, null)).as("%s with no area", role).isFalse();
        }
        for (CatalogArea area : CatalogArea.values()) {
            assertThat(ProductRules.canEdit(null, area)).as("no role in %s", area).isFalse();
        }
        assertThat(ProductRules.canEdit(null, null)).isFalse();
    }

    @Test
    void everyTextFieldAcceptsItsExactLimitAfterTrimmingAndRejectsOneMoreCharacter() {
        var limits = java.util.Map.of("name", 160, "brandName", 120, "genericName", 200,
                "manufacturer", 120, "dosageForm", 120, "saleUnit", 80, "description", 4000);
        for (var entry : limits.entrySet()) {
            String field = entry.getKey();
            int maximum = entry.getValue();
            var accepted = ProductRules.validateCatalog(ProductKind.MEDICINE,
                    withText(validMedicine(), field, "  " + "x".repeat(maximum) + "  "));
            assertThat(textField(accepted, field)).as("%s at %s characters", field, maximum)
                    .isEqualTo("x".repeat(maximum));
            assertThatThrownBy(() -> ProductRules.validateCatalog(ProductKind.MEDICINE,
                    withText(validMedicine(), field, "x".repeat(maximum + 1))))
                    .as("%s at %s characters", field, maximum + 1)
                    .isInstanceOfSatisfying(InvalidCatalogException.class,
                            error -> assertThat(error.field()).isEqualTo(field));
        }
    }

    @Test
    void medicineIdentityFieldsAndSharedRequiredFieldsCannotBeNullOrBlank() {
        for (String field : java.util.List.of("name", "genericName", "dosageForm", "saleUnit")) {
            for (String value : new String[] {null, "  "}) {
                assertThatThrownBy(() -> ProductRules.validateCatalog(ProductKind.MEDICINE,
                        withText(validMedicine(), field, value)))
                        .as("%s must be present", field)
                        .isInstanceOfSatisfying(InvalidCatalogException.class,
                                error -> assertThat(error.field()).isEqualTo(field));
            }
        }
        var valid = validMedicine();
        assertInvalidField(new ProductRules.CatalogFields(valid.name(), valid.brandName(), valid.genericName(),
                valid.manufacturer(), valid.dosageForm(), valid.saleUnit(), valid.description(), null,
                valid.requireValidation(), valid.active()), "categoryId");
        assertInvalidField(new ProductRules.CatalogFields(valid.name(), valid.brandName(), valid.genericName(),
                valid.manufacturer(), valid.dosageForm(), valid.saleUnit(), valid.description(), CATEGORY,
                null, valid.active()), "requireValidation");
        assertInvalidField(new ProductRules.CatalogFields(valid.name(), valid.brandName(), valid.genericName(),
                valid.manufacturer(), valid.dosageForm(), valid.saleUnit(), valid.description(), CATEGORY,
                valid.requireValidation(), null), "active");
        assertThatThrownBy(() -> ProductRules.validateCatalog(null, valid))
                .isInstanceOfSatisfying(InvalidCatalogException.class,
                        error -> assertThat(error.field()).isEqualTo("kind"));
        assertThatThrownBy(() -> ProductRules.validateCatalog(ProductKind.MEDICINE, null))
                .isInstanceOfSatisfying(InvalidCatalogException.class,
                        error -> assertThat(error.field()).isEqualTo("catalog"));
    }

    @Test
    void onlyDescriptionMayContainCarriageReturnsAndLineFeeds() {
        for (String field : java.util.List.of("name", "brandName", "genericName", "manufacturer", "dosageForm",
                "saleUnit")) {
            for (String control : new String[] {"\r", "\n", "\t", "\u0000"}) {
                for (String value : new String[] {control + "a", "a" + control + "b", "a" + control}) {
                    assertThatThrownBy(() -> ProductRules.validateCatalog(ProductKind.MEDICINE,
                        withText(validMedicine(), field, value)))
                        .as("%s with control U+%04X", field, (int) control.charAt(0))
                        .isInstanceOfSatisfying(InvalidCatalogException.class,
                                error -> assertThat(error.field()).isEqualTo(field));
                }
            }
        }
        var accepted = ProductRules.validateCatalog(ProductKind.MEDICINE,
                withText(validMedicine(), "description", " first\r\nsecond\nthird\rfourth "));
        assertThat(accepted.description()).isEqualTo("first\r\nsecond\nthird\rfourth");
        for (String control : new String[] {"\t", "\u0000", "\u001f"}) {
            for (String value : new String[] {control + "a", "a" + control + "b", "a" + control}) {
                assertThatThrownBy(() -> ProductRules.validateCatalog(ProductKind.MEDICINE,
                    withText(validMedicine(), "description", value)))
                    .isInstanceOfSatisfying(InvalidCatalogException.class,
                            error -> assertThat(error.field()).isEqualTo("description"));
            }
        }
    }

    @Test
    void normalizingAnEditDoesNotEraseForbiddenControlsBeforeValidation() {
        for (String field : java.util.List.of("name", "brandName", "genericName", "manufacturer", "dosageForm",
                "saleUnit", "description")) {
            var submitted = withText(validMedicine(), field, "a\u0000");
            assertThat(textField(ProductRules.normalizeCatalog(submitted), field)).isEqualTo("a\u0000");
        }
    }

    @Test
    void anUnpricedProductCannotBeActivatedAndSellingPriceCannotExceedMrp() {
        assertThatThrownBy(() -> ProductRules.requirePurchasable(true, null))
                .isInstanceOf(PriceRequiredException.class);
        ProductRules.requirePurchasable(false, null);
        ProductRules.requirePurchasable(true, Money.parse("0.01"));
        ProductRules.validatePricing(Money.parse("11.50"), Money.parse("11.50"));
        ProductRules.validatePricing(Money.parse("11.50"), null);
        assertThatThrownBy(() -> ProductRules.validatePricing(Money.parse("11.51"), Money.parse("11.50")))
                .isInstanceOf(InvalidCatalogException.class);
    }

    @Test
    void equipmentCannotCarryMedicineAttributes() {
        var fields = new ProductRules.CatalogFields("Thermometer", null, "Salt", null, null,
                "1 piece", null, CATEGORY, false, false);
        assertThatThrownBy(() -> ProductRules.validateCatalog(ProductKind.EQUIPMENT, fields))
                .isInstanceOf(InvalidCatalogException.class);
        var withDosage = new ProductRules.CatalogFields("Thermometer", null, null, null, "Tablet",
                "1 piece", null, CATEGORY, false, false);
        assertThatThrownBy(() -> ProductRules.validateCatalog(ProductKind.EQUIPMENT, withDosage))
                .isInstanceOf(InvalidCatalogException.class);
        var blankGeneric = new ProductRules.CatalogFields("Thermometer", null, "   ", null, null,
                "1 piece", null, CATEGORY, false, false);
        assertThat(ProductRules.validateCatalog(ProductKind.EQUIPMENT, blankGeneric).genericName()).isNull();
        var noMedicineAttributes = new ProductRules.CatalogFields("Thermometer", null, null, null, null,
                "1 piece", null, CATEGORY, false, false);
        assertThat(ProductRules.validateCatalog(ProductKind.EQUIPMENT, noMedicineAttributes).dosageForm()).isNull();
        var blankDosage = new ProductRules.CatalogFields("Thermometer", null, null, null, "   ",
                "1 piece", null, CATEGORY, false, false);
        assertThatThrownBy(() -> ProductRules.validateCatalog(ProductKind.EQUIPMENT, blankDosage))
                .isInstanceOfSatisfying(InvalidCatalogException.class,
                        error -> assertThat(error.field()).isEqualTo("dosageForm"));
    }

    @Test
    void retryingCreateComparesNormalizedIdentityButIgnoresLaterPriceAndActivation() {
        var stored = ProductRules.validateCatalog(ProductKind.MEDICINE,
                new ProductRules.CatalogFields("Napa 500", null, "Paracetamol", null,
                        "Tablet", "Strip", null, CATEGORY, false, true));
        var retry = new ProductRules.CatalogFields(" Napa 500 ", " ", " Paracetamol ", null,
                " Tablet ", " Strip ", null, CATEGORY, false, false);

        assertThat(ProductRules.sameCreate(ProductKind.MEDICINE, stored, ProductKind.MEDICINE, retry)).isTrue();
        assertThat(ProductRules.sameCreate(ProductKind.MEDICINE, stored, ProductKind.EQUIPMENT, retry)).isFalse();
        assertThat(ProductRules.sameCreate(ProductKind.MEDICINE, stored, ProductKind.MEDICINE,
                new ProductRules.CatalogFields("Changed", null, "Paracetamol", null,
                        "Tablet", "Strip", null, CATEGORY, false, false))).isFalse();
    }

    @Test
    void oneEditCanWriteSeparateCatalogFlagActivationAndPriceHistory() {
        var before = ProductRules.validateCatalog(ProductKind.MEDICINE,
                new ProductRules.CatalogFields("Napa", null, "Paracetamol", null,
                        "Tablet", "Strip", null, CATEGORY, false, false));
        var after = ProductRules.validateCatalog(ProductKind.MEDICINE,
                new ProductRules.CatalogFields("Napa 500", null, "Paracetamol", null,
                        "Tablet", "Strip", null, CATEGORY, true, true));
        assertThat(ProductRules.diff(before, after, null, Money.parse("11.50"), null, null))
                .containsExactly(ProductChangeType.CATALOG_UPDATED, ProductChangeType.REQUIRE_VALIDATION_CHANGED,
                        ProductChangeType.ACTIVATED, ProductChangeType.PRICE_CHANGED);
        assertThat(ProductRules.diff(before, before, null, null, null, null)).isEmpty();
    }

    private static ProductRules.CatalogFields validMedicine() {
        return new ProductRules.CatalogFields("Medicine", null, "Generic", null, "Tablet", "Strip", null,
                CATEGORY, false, false);
    }

    private static void assertInvalidField(ProductRules.CatalogFields fields, String field) {
        assertThatThrownBy(() -> ProductRules.validateCatalog(ProductKind.MEDICINE, fields))
                .isInstanceOfSatisfying(InvalidCatalogException.class,
                        error -> assertThat(error.field()).isEqualTo(field));
    }

    private static String textField(ProductRules.CatalogFields fields, String field) {
        return switch (field) {
            case "name" -> fields.name();
            case "brandName" -> fields.brandName();
            case "genericName" -> fields.genericName();
            case "manufacturer" -> fields.manufacturer();
            case "dosageForm" -> fields.dosageForm();
            case "saleUnit" -> fields.saleUnit();
            case "description" -> fields.description();
            default -> throw new IllegalArgumentException(field);
        };
    }

    private static ProductRules.CatalogFields withText(ProductRules.CatalogFields fields, String field, String value) {
        return new ProductRules.CatalogFields(
                field.equals("name") ? value : fields.name(),
                field.equals("brandName") ? value : fields.brandName(),
                field.equals("genericName") ? value : fields.genericName(),
                field.equals("manufacturer") ? value : fields.manufacturer(),
                field.equals("dosageForm") ? value : fields.dosageForm(),
                field.equals("saleUnit") ? value : fields.saleUnit(),
                field.equals("description") ? value : fields.description(),
                fields.categoryId(), fields.requireValidation(), fields.active());
    }
}

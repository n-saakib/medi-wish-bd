package bd.mediwish.catalog;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.NoSuchBeanDefinitionException;

import java.time.LocalDate;
import java.time.Instant;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.catalog.DiscountTestApi.TODAY;
import static bd.mediwish.catalog.DiscountTestApi.id;
import static bd.mediwish.catalog.DiscountTestApi.items;
import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** I1: real transactions with a discount-only calendar, current category membership and derived history. */
@Tag("integration")
class StaffDiscountIT {
    @Test
    void inclusiveStartAndEndDatesTransitionWithoutWritingOrMovingTheAuthenticationClock() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            var moderator = api.actor("MODERATOR");
            UUID category = id(api.category(admin));
            var product = api.activeProduct(admin, category, "150.00");
            var unpriced = api.product(admin, category);
            LocalDate start = TODAY.plusDays(1);
            var categoryDiscount = api.discount(admin, "CATEGORY", category, "PERCENTAGE", "15", start,
                    start.plusDays(2));
            api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "10", start, start.plusDays(2));
            assertPrice(api.get(admin, product.get("id")), "150.00", null);
            assertThat(items(api.list(admin, "SCHEDULED", 20), "items")).hasSize(2);
            String rowsBefore = discountRows(api);

            api.today(start);
            assertPrice(api.get(admin, product.get("id")), "127.50", categoryDiscount.get("id"));
            assertPrice(api.get(moderator, product.get("id")), "127.50", categoryDiscount.get("id"));
            var page = json(api.send("GET", "/api/staff/products?size=20", admin, null));
            assertThat(items(page, "items")).anySatisfy(row -> {
                assertThat(row.get("id")).isEqualTo(product.get("id"));
                assertPrice(row, "127.50", categoryDiscount.get("id"));
            }).anySatisfy(row -> assertThat(row).containsEntry("id", unpriced.get("id"))
                    .containsEntry("effectivePrice", null).containsEntry("appliedDiscount", null));
            assertThat(items(api.list(admin, "ACTIVE", 20), "items")).hasSize(2);

            api.today(start.plusDays(2));
            assertPrice(api.get(admin, product.get("id")), "127.50", categoryDiscount.get("id"));
            api.today(start.plusDays(3));
            assertPrice(api.get(admin, product.get("id")), "150.00", null);
            var ended = items(api.list(admin, "ENDED", 20), "items");
            assertThat(ended).hasSize(2);
            assertError(api.send("PUT", "/api/staff/discounts/" + categoryDiscount.get("id"), admin,
                    DiscountTestApi.updateBody(categoryDiscount, Map.of("value", "16"))), 409, "DISCOUNT_ENDED");
            assertThat(discountRows(api)).isEqualTo(rowsBefore);
            // Staff sign-in/MFA still works after changing only the promotion date.
            assertThat(api.actor("ADMIN").token()).isNotBlank();
        }
    }

    @Test
    void oneRequestKeepsPageCountsPricesAndHistoryCoherentAcrossMidnight() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            var product = api.activeProduct(admin, id(api.category(admin)), "100.00");
            var ending = api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, TODAY);
            var starting = api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "20", TODAY.plusDays(1), null);
            var calendar = api.application().bean(MovableDiscountCalendar.Calendar.class);
            for (String status : List.of("ACTIVE", "SCHEDULED")) {
                calendar.advanceAfterFirstRead(TODAY, TODAY.plusDays(1));
                var page = api.list(admin, status, 20);
                assertThat(page).containsEntry("totalItems", 1)
                        .containsEntry("counts", Map.of("active", 1, "scheduled", 1));
                assertThat(items(page, "items")).singleElement().satisfies(row ->
                        assertThat(row).containsEntry("id", ("ACTIVE".equals(status) ? ending : starting).get("id"))
                                .containsEntry("status", status));
            }
            calendar.advanceAfterFirstRead(TODAY, TODAY.plusDays(1));
            var detail = api.get(admin, product.get("id"));
            assertPrice(detail, "90.00", ending.get("id"));
            var events = items(detail, "history").stream()
                    .filter(entry -> ((String) entry.get("changeType")).startsWith("DISCOUNT_")).toList();
            assertThat(events).singleElement().satisfies(entry -> {
                assertThat(entry).containsEntry("changeType", "DISCOUNT_STARTED");
                assertThat(DiscountTestApi.object(entry.get("discount"))).containsEntry("value", "10");
            });
            // A fresh request now samples the later date and sees both the end and new start.
            var fresh = api.get(admin, product.get("id"));
            assertPrice(fresh, "80.00", starting.get("id"));
            assertThat(items(fresh, "history").stream()
                    .filter(entry -> ((String) entry.get("changeType")).startsWith("DISCOUNT_"))).hasSize(3);
        }
    }

    @Test
    void everyProductOnOnePageUsesTheSameDateAcrossMidnight() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            UUID category = id(api.category(admin));
            var first = api.activeProduct(admin, category, "100.00");
            var second = api.activeProduct(admin, category, "200.00");
            var ending = api.discount(admin, "CATEGORY", category, "PERCENTAGE", "10", TODAY, TODAY);
            var starting = api.discount(admin, "CATEGORY", category, "PERCENTAGE", "20", TODAY.plusDays(1), null);
            var calendar = api.application().bean(MovableDiscountCalendar.Calendar.class);
            calendar.advanceAfterFirstRead(TODAY, TODAY.plusDays(1));
            var page = json(api.send("GET", "/api/staff/products?size=20", admin, null));
            Map<Object, String> expected = Map.of(first.get("id"), "90.00", second.get("id"), "180.00");
            assertThat(items(page, "items")).extracting(row -> row.get("id"))
                    .containsExactlyInAnyOrder(first.get("id"), second.get("id"));
            assertThat(items(page, "items")).allSatisfy(row -> {
                assertThat(expected).containsKey(row.get("id"));
                assertPrice(row, expected.get(row.get("id")), ending.get("id"));
            });
            var fresh = json(api.send("GET", "/api/staff/products?size=20", admin, null));
            Map<Object, String> later = Map.of(first.get("id"), "80.00", second.get("id"), "160.00");
            assertThat(items(fresh, "items")).extracting(row -> row.get("id"))
                    .containsExactlyInAnyOrder(first.get("id"), second.get("id"));
            assertThat(items(fresh, "items")).allSatisfy(row -> {
                assertThat(later).containsKey(row.get("id"));
                assertPrice(row, later.get(row.get("id")), starting.get("id"));
            });
        }
    }

    @Test
    void countsAndHistoryIncludeLosingPromotionsAndDistinguishManualAndCalendarEnd() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            UUID category = id(api.category(admin));
            var product = api.activeProduct(admin, category, "100.00");
            var winning = api.discount(admin, "CATEGORY", category, "PERCENTAGE", "15", TODAY, null);
            var losing = api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
            var scheduled = api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "30",
                    LocalDate.of(2099, 1, 1), null);
            // Seed a legitimate stored event at the exact derived start instant to pin the merge tie rule.
            api.database().update("INSERT INTO product_changes (id,product_id,occurred_at,actor_user_id,change_type,"
                            + "old_require_validation,new_require_validation) VALUES (?, ?, ?, ?, 'CATALOG_UPDATED',false,false)",
                    UUID.randomUUID(), id(product), Timestamp.from(TODAY.atStartOfDay(DiscountCalendar.ZONE).toInstant()),
                    admin.userId());
            assertCounts(api, admin, 2, 1);
            var history = items(api.get(admin, product.get("id")), "history");
            assertThat(history.stream().filter(entry -> "DISCOUNT_STARTED".equals(entry.get("changeType"))))
                    .hasSize(2).allSatisfy(entry -> assertThat(entry).containsEntry("actorUsername", null)
                            .containsEntry("occurredAt", "2020-01-14T18:00:00Z"));
            var tied = history.stream().filter(entry -> "2020-01-14T18:00:00Z".equals(entry.get("occurredAt")))
                    .map(entry -> entry.get("changeType")).toList();
            assertThat(tied).containsExactly("CATALOG_UPDATED", "DISCOUNT_STARTED", "DISCOUNT_STARTED");
            assertThat(history.stream().map(entry -> Instant.parse((String) entry.get("occurredAt"))).toList())
                    .isSortedAccordingTo(java.util.Comparator.reverseOrder());

            var manuallyEnded = api.end(admin, losing);
            assertThat(manuallyEnded).containsEntry("status", "ENDED");
            assertCounts(api, admin, 1, 1);
            assertPrice(api.get(admin, product.get("id")), "85.00", winning.get("id"));
            assertThat(items(api.get(admin, product.get("id")), "history")).anySatisfy(entry -> {
                assertThat(entry).containsEntry("changeType", "DISCOUNT_ENDED")
                        .containsEntry("actorUsername", admin.username());
                assertThat(DiscountTestApi.object(entry.get("discount"))).containsEntry("targetType", "PRODUCT")
                        .containsEntry("kind", "PERCENTAGE").containsEntry("value", "10");
            });
            var dateEnding = api.discount(admin, "CATEGORY", category, "FLAT", "1.00", TODAY, TODAY);
            api.today(TODAY.plusDays(1));
            assertCounts(api, admin, 1, 1);
            assertThat(items(api.get(admin, product.get("id")), "history")).anySatisfy(entry -> {
                assertThat(entry).containsEntry("changeType", "DISCOUNT_ENDED").containsEntry("actorUsername", null)
                        .containsEntry("occurredAt", "2020-01-15T18:00:00Z");
                assertThat(DiscountTestApi.object(entry.get("discount"))).containsEntry("kind", "FLAT")
                        .containsEntry("value", "1.00");
            });
            assertThat(api.end(admin, dateEnding)).containsEntry("version", dateEnding.get("version"));
            api.end(admin, scheduled); // actual ended_at precedes its future start instant.
            api.today(LocalDate.of(2100, 1, 1));
            assertThat(items(api.get(admin, product.get("id")), "history"))
                    .noneSatisfy(entry -> assertThat(entry.get("discount"))
                            .isEqualTo(Map.of("targetType", "PRODUCT", "kind", "PERCENTAGE", "value", "30")));
            assertThat(api.database().single("SELECT count(*) FROM product_changes WHERE change_type "
                    + "IN ('DISCOUNT_STARTED','DISCOUNT_ENDED')", Long.class)).isZero();
        }
    }

    @Test
    void canceledScheduledDiscountsCannotCrowdAnAppliedDiscountOutOfHistory() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            var product = api.activeProduct(admin, id(api.category(admin)), "100.00");
            var applied = api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
            LocalDate future = LocalDate.of(2099, 1, 1);
            for (int index = 0; index < 20; index++) {
                var scheduled = api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "30",
                        future.plusDays(index), null);
                assertThat(api.end(admin, scheduled)).containsEntry("status", "ENDED");
            }
            assertThat(api.database().single("SELECT count(*) FROM discounts WHERE ended_at < "
                    + "starts_on::timestamp AT TIME ZONE 'Asia/Dhaka'", Long.class)).isEqualTo(20);

            api.today(future.plusDays(20));
            var detail = api.get(admin, product.get("id"));
            assertPrice(detail, "90.00", applied.get("id"));
            assertThat(items(detail, "history").stream()
                    .filter(entry -> ((String) entry.get("changeType")).startsWith("DISCOUNT_")))
                    .singleElement().satisfies(entry -> {
                        assertThat(entry).containsEntry("changeType", "DISCOUNT_STARTED")
                                .containsEntry("occurredAt", "2020-01-14T18:00:00Z")
                                .containsEntry("actorUsername", null);
                        assertThat(DiscountTestApi.object(entry.get("discount")))
                                .containsExactlyInAnyOrderEntriesOf(Map.of("targetType", "PRODUCT",
                                        "kind", "PERCENTAGE", "value", "10"));
                    });
        }
    }

    @Test
    void moderatorCategoryMovesChangeCurrentPricesAndDeactivatedCategoriesKeepTheirPromotions() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            var moderator = api.actor("MODERATOR");
            var firstCategory = api.category(admin);
            var secondCategory = api.category(admin);
            var first = api.discount(admin, "CATEGORY", id(firstCategory), "PERCENTAGE", "5", TODAY, null);
            var second = api.discount(admin, "CATEGORY", id(secondCategory), "PERCENTAGE", "10", TODAY, null);
            var product = api.activeProduct(admin, id(firstCategory), "100.00");
            var remaining = api.activeProduct(admin, id(secondCategory), "100.00");
            String before = discountRows(api);
            assertPrice(api.get(admin, product.get("id")), "95.00", first.get("id"));
            product = api.edit(moderator, product, Map.of("categoryId", secondCategory.get("id")));
            assertPrice(product, "90.00", second.get("id"));
            assertThat(json(api.send("GET", "/api/products/" + product.get("id") + "/price", null, null)))
                    .containsEntry("price", "90.00");
            assertThat(items(product, "history").stream().filter(entry -> "DISCOUNT_STARTED".equals(entry.get("changeType")))
                    .map(entry -> (String) DiscountTestApi.object(entry.get("discount")).get("value")))
                    .containsExactly("10");
            product = api.edit(moderator, product, Map.of("categoryId", firstCategory.get("id")));
            assertPrice(product, "95.00", first.get("id"));
            assertThat(json(api.send("GET", "/api/products/" + product.get("id") + "/price", null, null)))
                    .containsEntry("price", "95.00");
            assertThat(api.send("PUT", "/api/staff/categories/" + secondCategory.get("id"), moderator,
                    Map.of("name", secondCategory.get("name"), "active", false,
                            "version", secondCategory.get("version"))).statusCode()).isEqualTo(200);
            assertPrice(api.get(admin, remaining.get("id")), "90.00", second.get("id"));
            assertThat(items(api.list(admin, "ACTIVE", 20), "items"))
                    .anySatisfy(row -> assertThat(row).containsEntry("id", second.get("id"))
                            .containsEntry("status", "ACTIVE"));
            assertThat(discountRows(api)).isEqualTo(before);
        }
    }

    @Test
    @Tag("security")
    void staffDiscountRoutesRejectModeratorAndRestrictedMfaWhileProductReadsRemainAllowed() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            var moderator = api.actor("MODERATOR");
            var restricted = api.actor("RESTRICTED_ADMIN");
            var product = api.activeProduct(admin, id(api.category(admin)), "100.00");
            var discount = api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
            for (var actor : List.of(moderator, restricted)) {
                String code = actor == moderator ? "ACCESS_DENIED" : "MFA_REQUIRED";
                assertError(api.send("GET", "/api/staff/discounts?status=ACTIVE", actor, null), 403, code);
                assertError(api.send("POST", "/api/staff/discounts", actor,
                        DiscountTestApi.createBody(UUID.randomUUID(), "PRODUCT", id(product), "FLAT", "2.00",
                                TODAY, null)), 403, code);
                assertError(api.send("PUT", "/api/staff/discounts/" + discount.get("id"), actor,
                        DiscountTestApi.updateBody(discount, Map.of("value", "20"))), 403, code);
                assertError(api.send("POST", "/api/staff/discounts/" + discount.get("id") + "/end", actor,
                        Map.of("version", discount.get("version"))), 403, code);
            }
            assertPrice(api.get(moderator, product.get("id")), "90.00", discount.get("id"));
        }
    }

    @Test
    void explicitTestCalendarIsNeverScannedIntoAnOrdinaryCatalogApplication() throws Exception {
        try (var api = CatalogTestApi.start()) {
            assertThatThrownBy(() -> api.application().bean(MovableDiscountCalendar.Calendar.class))
                    .isInstanceOf(NoSuchBeanDefinitionException.class);
            LocalDate before = LocalDate.now(DiscountCalendar.ZONE);
            LocalDate actual = api.application().bean(DiscountCalendar.class).today();
            LocalDate after = LocalDate.now(DiscountCalendar.ZONE);
            assertThat(actual).isIn(before, after);
        }
    }

    @Test
    void equalSavingsPreferEarlierStartBeforeIdAndCompareUuidTextRatherThanSignedBits() throws Exception {
        try (var api = DiscountTestApi.start()) {
            var admin = api.actor("ADMIN");
            var product = api.activeProduct(admin, id(api.category(admin)), "100.00");
            UUID laterId = UUID.fromString("00000000-0000-4000-8000-000000000001");
            UUID earlierId = UUID.fromString("00000000-0000-4000-8000-000000000002");
            var later = DiscountTestApi.successful(api.send("POST", "/api/staff/discounts", admin,
                    DiscountTestApi.createBody(laterId, "PRODUCT", id(product), "PERCENTAGE", "10",
                            TODAY.plusDays(4), null)), 201);
            var earlier = DiscountTestApi.successful(api.send("POST", "/api/staff/discounts", admin,
                    DiscountTestApi.createBody(earlierId, "PRODUCT", id(product), "PERCENTAGE", "10",
                            TODAY.plusDays(1), null)), 201);
            api.today(TODAY.plusDays(5));
            assertPrice(api.get(admin, product.get("id")), "90.00", earlierId.toString());
            api.end(admin, later);
            api.end(admin, earlier);

            UUID signedFirst = UUID.fromString("80000000-0000-4000-8000-000000000000");
            UUID textFirst = UUID.fromString("00000000-0000-4000-8000-000000000003");
            for (UUID discountId : List.of(signedFirst, textFirst)) {
                assertThat(api.send("POST", "/api/staff/discounts", admin,
                        DiscountTestApi.createBody(discountId, "PRODUCT", id(product), "PERCENTAGE", "10",
                                TODAY.plusDays(5), null)).statusCode()).isEqualTo(201);
            }
            assertPrice(api.get(admin, product.get("id")), "90.00", textFirst.toString());
        }
    }

    private static void assertCounts(DiscountTestApi api, CatalogTestApi.Actor admin, int active, int scheduled)
            throws Exception {
        for (String status : List.of("ACTIVE", "SCHEDULED", "ENDED")) {
            assertThat(api.list(admin, status, 20).get("counts")).isEqualTo(Map.of("active", active, "scheduled", scheduled));
        }
    }

    static void assertPrice(Map<String, Object> product, String price, Object discountId) {
        assertThat(product).containsEntry("effectivePrice", price);
        if (discountId == null) assertThat(product).containsEntry("appliedDiscount", null);
        else assertThat(DiscountTestApi.object(product.get("appliedDiscount"))).containsEntry("id", discountId);
    }

    private static String discountRows(DiscountTestApi api) throws Exception {
        return api.database().single("SELECT coalesce(md5(string_agg(row_value, '|' ORDER BY row_value)), '') FROM "
                + "(SELECT t::text AS row_value FROM discounts t UNION ALL SELECT t::text FROM discount_changes t) entries",
                String.class);
    }
}

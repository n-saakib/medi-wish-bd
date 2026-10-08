package bd.mediwish.catalog;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** PostgreSQL-observed overlap for stale writes, unique ids/names, and lost responses. */
@Tag("integration")
@Tag("regression")
class ConcurrentCatalogIT {
    @Test
    void twoCatalogEditsAtTheSameVersionHaveOneWinner() throws Exception {
        try (var api = CatalogTestApi.start(15)) {
            var admin = api.actor("ADMIN");
            UUID categoryId = UUID.fromString((String) api.category(admin, "Race " + UUID.randomUUID()).get("id"));
            var product = api.medicine(admin, categoryId);
            UUID id = UUID.fromString((String) product.get("id"));
            var first = CatalogTestApi.catalogBody(product, Map.of("name", "First winner"));
            var second = CatalogTestApi.catalogBody(product, Map.of("name", "Second winner"));
            var replies = raceUnderLock(api, "SELECT id FROM products WHERE id = ? FOR UPDATE", List.of(id),
                    () -> api.send("PUT", "/api/staff/products/" + id, admin, first),
                    () -> api.send("PUT", "/api/staff/products/" + id, admin, second));
            assertOneSuccessAndOneStale(replies);
            var stored = api.get(admin, id);
            assertThat(stored.get("name")).isIn("First winner", "Second winner");
            assertThat(stored).containsEntry("version", 1);
            assertThat(api.database().single("SELECT count(*) FROM product_changes WHERE product_id = ?",
                    Long.class, id)).isEqualTo(2);
        }
    }

    @Test
    void pricingAndActivationCompeteOnOneAlreadyPricedProduct() throws Exception {
        try (var api = CatalogTestApi.start(15)) {
            var admin = api.actor("ADMIN");
            var moderator = api.actor("MODERATOR");
            UUID categoryId = UUID.fromString((String) api.category(admin, "Price race " + UUID.randomUUID()).get("id"));
            var priced = api.price(admin, api.medicine(admin, categoryId), "9.00", null);
            UUID id = UUID.fromString((String) priced.get("id"));
            var priceUpdate = Map.of("sellingPrice", "8.00", "mrp", "10.00", "version", priced.get("version"));
            var activation = CatalogTestApi.catalogBody(priced, Map.of("active", true));
            var replies = raceUnderLock(api, "SELECT id FROM products WHERE id = ? FOR UPDATE", List.of(id),
                    () -> api.send("PUT", "/api/staff/products/" + id + "/pricing", admin, priceUpdate),
                    () -> api.send("PUT", "/api/staff/products/" + id, moderator, activation));
            assertOneSuccessAndOneStale(replies);
            var stored = api.get(admin, id);
            assertThat(stored).containsEntry("version", 2);
            assertThat(api.database().single("SELECT NOT active OR selling_price IS NOT NULL "
                    + "FROM products WHERE id = ?", Boolean.class, id)).isTrue();
        }
    }

    @Test
    void simultaneousSameIdCreatesAreIdempotentOnlyForTheSameIntent() throws Exception {
        try (var api = CatalogTestApi.start(15)) {
            var admin = api.actor("ADMIN");
            UUID categoryId = UUID.fromString((String) api.category(admin, "Create race " + UUID.randomUUID()).get("id"));
            var same = CatalogTestApi.draft("MEDICINE", categoryId);
            UUID sameId = (UUID) same.get("id");
            var identical = raceUnderLock(api, blockerInsertProduct(), productParameters(same),
                    () -> api.send("POST", "/api/staff/products", admin, same),
                    () -> api.send("POST", "/api/staff/products", admin, same));
            assertThat(statuses(identical)).containsExactlyInAnyOrder(200, 201);
            assertThat(json(identical.get(0))).isEqualTo(json(identical.get(1)));
            assertOneProductAndCreatedRow(api, sameId);

            var first = CatalogTestApi.draft("MEDICINE", categoryId);
            var second = new LinkedHashMap<>(first);
            second.put("name", "Different race " + UUID.randomUUID());
            UUID differentId = (UUID) first.get("id");
            var different = raceUnderLock(api, blockerInsertProduct(), productParameters(first),
                    () -> api.send("POST", "/api/staff/products", admin, first),
                    () -> api.send("POST", "/api/staff/products", admin, second));
            assertThat(statuses(different)).containsExactlyInAnyOrder(201, 409);
            var conflict = different.stream().filter(reply -> reply.statusCode() == 409).findFirst().orElseThrow();
            assertError(conflict, 409, "ID_CONFLICT");
            var winner = different.stream().filter(reply -> reply.statusCode() == 201).findFirst().orElseThrow();
            assertThat(api.get(admin, differentId)).isEqualTo(json(winner));
            assertOneProductAndCreatedRow(api, differentId);
        }
    }

    @Test
    void caseTwinCategoryNamesRaceOnTheUniqueIndex() throws Exception {
        try (var api = CatalogTestApi.start(15)) {
            var admin = api.actor("ADMIN");
            String name = "Case race " + UUID.randomUUID();
            var first = Map.of("id", UUID.randomUUID(), "name", name);
            var second = Map.of("id", UUID.randomUUID(), "name", name.toUpperCase());
            var replies = raceUnderLock(api,
                    "INSERT INTO product_categories (id, name, created_at, updated_at) VALUES (?, ?, now(), now())",
                    List.of(UUID.randomUUID(), name),
                    () -> api.send("POST", "/api/staff/categories", admin, first),
                    () -> api.send("POST", "/api/staff/categories", admin, second));
            assertThat(statuses(replies)).containsExactlyInAnyOrder(201, 409);
            assertError(replies.stream().filter(reply -> reply.statusCode() == 409).findFirst().orElseThrow(),
                    409, "CATEGORY_NAME_TAKEN");
            assertThat(api.database().single("SELECT count(*) FROM product_categories WHERE lower(name) = lower(?)",
                    Long.class, name)).isOne();
        }
    }

    @Test
    void retryAfterLostPricingResponseDoesNotAddHistory() throws Exception {
        try (var api = CatalogTestApi.start(15)) {
            var admin = api.actor("ADMIN");
            UUID categoryId = UUID.fromString((String) api.category(admin, "Lost reply " + UUID.randomUUID()).get("id"));
            var product = api.medicine(admin, categoryId);
            UUID id = UUID.fromString((String) product.get("id"));
            var request = Map.of("sellingPrice", "11.50", "mrp", "12.00", "version", product.get("version"));
            // Drop the first response locally, as a client would after a transport failure.
            assertThat(api.send("PUT", "/api/staff/products/" + id + "/pricing", admin, request).statusCode())
                    .isEqualTo(200);
            var retry = api.send("PUT", "/api/staff/products/" + id + "/pricing", admin, request);
            assertThat(retry.statusCode()).isEqualTo(200);
            assertThat(json(retry)).isEqualTo(api.get(admin, id));
            assertThat(api.database().single("SELECT count(*) FROM product_changes WHERE product_id = ?",
                    Long.class, id)).isEqualTo(2);
        }
    }

    private static String blockerInsertProduct() {
        return "INSERT INTO products (id, kind, name, brand_name, generic_name, manufacturer, dosage_form, "
                + "sale_unit, description, category_id, require_validation, created_at, updated_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())";
    }

    private static List<Object> productParameters(Map<String, Object> draft) {
        List<Object> values = new ArrayList<>();
        for (String key : List.of("id", "kind", "name", "brandName", "genericName", "manufacturer", "dosageForm",
                "saleUnit", "description", "categoryId", "requireValidation")) values.add(draft.get(key));
        return values;
    }

    private static void assertOneProductAndCreatedRow(CatalogTestApi api, UUID id) throws Exception {
        assertThat(api.database().single("SELECT count(*) FROM products WHERE id = ?", Long.class, id)).isOne();
        assertThat(api.database().single("SELECT count(*) FROM product_changes WHERE product_id = ? "
                + "AND change_type = 'CREATED'", Long.class, id)).isOne();
    }

    private static List<Integer> statuses(List<HttpResponse<String>> replies) {
        return replies.stream().map(HttpResponse::statusCode).toList();
    }

    private static void assertOneSuccessAndOneStale(List<HttpResponse<String>> replies) {
        assertThat(statuses(replies)).containsExactlyInAnyOrder(200, 409);
        assertError(replies.stream().filter(reply -> reply.statusCode() == 409).findFirst().orElseThrow(),
                409, "STALE_UPDATE");
    }

    /** Both requests must be observed in this transaction's lock queue before it is rolled back. */
    private static List<HttpResponse<String>> raceUnderLock(CatalogTestApi api, String blockerSql,
            List<?> blockerParameters, Callable<HttpResponse<String>> first, Callable<HttpResponse<String>> second)
            throws Exception {
        try (Connection blocker = api.database().connect(); var executor = Executors.newFixedThreadPool(2)) {
            blocker.setAutoCommit(false);
            try (PreparedStatement statement = blocker.prepareStatement(blockerSql)) {
                for (int index = 0; index < blockerParameters.size(); index++) {
                    statement.setObject(index + 1, blockerParameters.get(index));
                }
                statement.execute();
            }
            int blockerPid;
            try (var statement = blocker.createStatement(); var result = statement.executeQuery("SELECT pg_backend_pid()")) {
                result.next();
                blockerPid = result.getInt(1);
            }
            CountDownLatch gate = new CountDownLatch(1);
            Future<HttpResponse<String>> one = executor.submit(() -> { gate.await(); return first.call(); });
            Future<HttpResponse<String>> two = executor.submit(() -> { gate.await(); return second.call(); });
            try {
                gate.countDown();
                awaitBothBlocked(api, blockerPid);
            } finally {
                blocker.rollback(); // Also removes the seed row for create races.
            }
            return List.of(one.get(12, TimeUnit.SECONDS), two.get(12, TimeUnit.SECONDS));
        }
    }

    private static void awaitBothBlocked(CatalogTestApi api, int blockerPid) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(7).toNanos();
        do {
            // A queued tuple locker can wait on the first request rather than directly on the seed transaction.
            Long blocked = api.database().single("WITH RECURSIVE blocked_requests(pid) AS ("
                    + "SELECT ?::integer UNION "
                    + "SELECT activity.pid FROM pg_stat_activity activity JOIN blocked_requests blocker "
                    + "ON blocker.pid = ANY(pg_blocking_pids(activity.pid)) "
                    + "WHERE activity.datname = current_database() AND activity.usename = current_user "
                    + "AND activity.wait_event_type = 'Lock') "
                    + "SELECT count(*) FROM blocked_requests WHERE pid <> ?",
                    Long.class, blockerPid, blockerPid);
            if (blocked == 2) return;
            Thread.yield();
        } while (System.nanoTime() < deadline);
        throw new AssertionError("Both catalog requests were not observed waiting on the controlled PostgreSQL lock");
    }
}

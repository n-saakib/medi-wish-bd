package bd.mediwish.catalog;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import java.net.http.HttpResponse;
import java.sql.Connection;
import java.time.Duration;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static bd.mediwish.catalog.DiscountTestApi.TODAY;
import static bd.mediwish.catalog.DiscountTestApi.id;
import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** Independent HTTP requests, observed on PostgreSQL's lock queue; no sleeps or optimistic race claims. */
@Tag("integration")
@Tag("regression")
class ConcurrentDiscountIT {
    @Test
    void differentEditsWithOneVersionHaveOneWinnerAndOneStaleLoser() throws Exception {
        try (var api = DiscountTestApi.start(15)) {
            var firstAdmin = api.actor("ADMIN");
            var secondAdmin = api.actor("ADMIN");
            var product = api.activeProduct(firstAdmin, id(api.category(firstAdmin)), "100.00");
            var discount = api.discount(firstAdmin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
            UUID discountId = id(discount);
            var replies = raceUnderLock(api, "SELECT id FROM discounts WHERE id = ? FOR UPDATE", List.of(discountId),
                    () -> api.send("PUT", "/api/staff/discounts/" + discountId, firstAdmin,
                            DiscountTestApi.updateBody(discount, Map.of("value", "20"))),
                    () -> api.send("PUT", "/api/staff/discounts/" + discountId, secondAdmin,
                            DiscountTestApi.updateBody(discount, Map.of("value", "30"))));
            assertOneWinner(replies);
            // raceUnderLock preserves callable order; derive the intent from the successful request, not its body.
            boolean firstWon = replies.getFirst().statusCode() == 200;
            var successfulReply = firstWon ? replies.getFirst() : replies.getLast();
            var winningActor = firstWon ? firstAdmin : secondAdmin;
            int winningPercent = firstWon ? 20 : 30;
            var winner = json(successfulReply);
            assertThat(winner).containsEntry("id", discountId.toString()).containsEntry("targetType", "PRODUCT")
                    .containsEntry("targetId", product.get("id")).containsEntry("kind", "PERCENTAGE")
                    .containsEntry("value", Integer.toString(winningPercent)).containsEntry("startsOn", TODAY.toString())
                    .containsEntry("endsOn", null).containsEntry("status", "ACTIVE").containsEntry("version", 1)
                    .containsEntry("updatedByUsername", winningActor.username());
            assertThat(api.database().single("SELECT count(*) FROM discounts WHERE id = ? "
                    + "AND target_type = 'PRODUCT' AND product_id = ? AND category_id IS NULL "
                    + "AND kind = 'PERCENTAGE' AND percent = ? AND amount IS NULL AND starts_on = ? "
                    + "AND ends_on IS NULL AND ended_at IS NULL AND version = 1 AND updated_by = ?",
                    Long.class, discountId, id(product), winningPercent, TODAY, winningActor.userId())).isOne();
            assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ? "
                    + "AND change_type = 'UPDATED'", Long.class, discountId)).isOne();
            assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ? "
                    + "AND change_type = 'UPDATED' AND actor_user_id = ? AND kind = 'PERCENTAGE' AND percent = ? "
                    + "AND amount IS NULL AND starts_on = ? AND ends_on IS NULL AND occurred_at = ?::timestamptz "
                    + "AND request_id = ?", Long.class, discountId, winningActor.userId(), winningPercent, TODAY,
                    winner.get("updatedAt"), successfulReply.headers().firstValue("X-Request-ID").orElseThrow())).isOne();
            assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ?",
                    Long.class, discountId)).isEqualTo(2);
            assertThat(api.get(firstAdmin, product.get("id"))).containsEntry("effectivePrice", firstWon ? "80.00" : "70.00");
        }
    }

    @Test
    void simultaneousIdenticalCreateCommitsExactlyOneDiscountAndOneCreatedAudit() throws Exception {
        try (var api = DiscountTestApi.start(15)) {
            var firstAdmin = api.actor("ADMIN");
            var secondAdmin = api.actor("ADMIN");
            var product = api.activeProduct(firstAdmin, id(api.category(firstAdmin)), "100.00");
            UUID discountId = UUID.randomUUID();
            var body = DiscountTestApi.createBody(discountId, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
            // A rolled-back insert holds both API insert attempts on the same unique-id decision.
            var replies = raceUnderLock(api, "INSERT INTO discounts "
                            + "(id,target_type,product_id,kind,percent,starts_on,created_at,updated_at) "
                            + "VALUES (?, 'PRODUCT', ?, 'PERCENTAGE', 10, ?, now(), now())",
                    List.of(discountId, id(product), TODAY),
                    () -> api.send("POST", "/api/staff/discounts", firstAdmin, body),
                    () -> api.send("POST", "/api/staff/discounts", secondAdmin, body));
            assertThat(replies.stream().map(HttpResponse::statusCode)).containsExactlyInAnyOrder(201, 200);
            assertThat(json(replies.getFirst())).isEqualTo(json(replies.getLast()));
            assertThat(api.database().single("SELECT count(*) FROM discounts WHERE id = ?", Long.class, discountId)).isOne();
            assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ? "
                    + "AND change_type = 'CREATED'", Long.class, discountId)).isOne();
        }
    }

    @Test
    void simultaneousDifferentCreatesWithOneIdPersistOnlyTheWinningPayload() throws Exception {
        try (var api = DiscountTestApi.start(15)) {
            var firstAdmin = api.actor("ADMIN");
            var secondAdmin = api.actor("ADMIN");
            var product = api.activeProduct(firstAdmin, id(api.category(firstAdmin)), "100.00");
            UUID discountId = UUID.randomUUID();
            var replies = raceUnderLock(api, "INSERT INTO discounts "
                            + "(id,target_type,product_id,kind,percent,starts_on,created_at,updated_at) "
                            + "VALUES (?, 'PRODUCT', ?, 'PERCENTAGE', 10, ?, now(), now())",
                    List.of(discountId, id(product), TODAY),
                    () -> api.send("POST", "/api/staff/discounts", firstAdmin,
                            DiscountTestApi.createBody(discountId, "PRODUCT", id(product), "PERCENTAGE", "20", TODAY, null)),
                    () -> api.send("POST", "/api/staff/discounts", secondAdmin,
                            DiscountTestApi.createBody(discountId, "PRODUCT", id(product), "PERCENTAGE", "30", TODAY, null)));
            assertThat(replies.stream().map(HttpResponse::statusCode)).containsExactlyInAnyOrder(201, 409);
            assertError(replies.stream().filter(reply -> reply.statusCode() == 409).findFirst().orElseThrow(),
                    409, "ID_CONFLICT");
            boolean firstWon = replies.getFirst().statusCode() == 201;
            var successfulReply = firstWon ? replies.getFirst() : replies.getLast();
            var winningActor = firstWon ? firstAdmin : secondAdmin;
            int winningPercent = firstWon ? 20 : 30;
            var winner = json(successfulReply);
            assertThat(winner).containsOnlyKeys("id", "targetType", "targetId", "targetName", "productCount", "kind",
                            "value", "startsOn", "endsOn", "status", "version", "updatedAt", "updatedByUsername")
                    .containsEntry("id", discountId.toString()).containsEntry("targetType", "PRODUCT")
                    .containsEntry("targetId", product.get("id")).containsEntry("targetName", product.get("name"))
                    .containsEntry("productCount", null).containsEntry("kind", "PERCENTAGE")
                    .containsEntry("value", Integer.toString(winningPercent)).containsEntry("startsOn", TODAY.toString())
                    .containsEntry("endsOn", null).containsEntry("status", "ACTIVE").containsEntry("version", 0)
                    .containsEntry("updatedByUsername", winningActor.username());
            assertThat(api.database().single("SELECT count(*) FROM discounts WHERE id = ?", Long.class, discountId)).isOne();
            assertThat(api.database().single("SELECT count(*) FROM discounts WHERE id = ? "
                    + "AND target_type = 'PRODUCT' AND product_id = ? AND category_id IS NULL "
                    + "AND kind = 'PERCENTAGE' AND percent = ? AND amount IS NULL AND starts_on = ? "
                    + "AND ends_on IS NULL AND ended_at IS NULL AND version = 0 AND created_by = ? AND updated_by = ? "
                    + "AND created_at = ?::timestamptz AND updated_at = ?::timestamptz", Long.class,
                    discountId, id(product), winningPercent, TODAY, winningActor.userId(), winningActor.userId(),
                    winner.get("updatedAt"), winner.get("updatedAt"))).isOne();
            assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ?",
                    Long.class, discountId)).isOne();
            assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ? "
                    + "AND change_type = 'CREATED' AND actor_user_id = ? AND kind = 'PERCENTAGE' AND percent = ? "
                    + "AND amount IS NULL AND starts_on = ? AND ends_on IS NULL AND occurred_at = ?::timestamptz "
                    + "AND request_id = ?", Long.class, discountId, winningActor.userId(), winningPercent, TODAY,
                    winner.get("updatedAt"), successfulReply.headers().firstValue("X-Request-ID").orElseThrow())).isOne();
            StaffDiscountIT.assertPrice(api.get(firstAdmin, product.get("id")), firstWon ? "80.00" : "70.00",
                    discountId.toString());
        }
    }

    @Test
    void simultaneousIdenticalEditsReplayDespiteOriginalVersionAndWriteOneAudit() throws Exception {
        try (var api = DiscountTestApi.start(15)) {
            var firstAdmin = api.actor("ADMIN");
            var secondAdmin = api.actor("ADMIN");
            var product = api.activeProduct(firstAdmin, id(api.category(firstAdmin)), "100.00");
            var discount = api.discount(firstAdmin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
            UUID discountId = id(discount);
            var body = DiscountTestApi.updateBody(discount, Map.of("value", "20"));
            var replies = raceUnderLock(api, "SELECT id FROM discounts WHERE id = ? FOR UPDATE", List.of(discountId),
                    () -> api.send("PUT", "/api/staff/discounts/" + discountId, firstAdmin, body),
                    () -> api.send("PUT", "/api/staff/discounts/" + discountId, secondAdmin, body));
            assertThat(replies.stream().map(HttpResponse::statusCode)).containsExactly(200, 200);
            assertThat(json(replies.getFirst())).isEqualTo(json(replies.getLast()))
                    .containsEntry("version", 1).containsEntry("value", "20");
            assertThat(api.database().single("SELECT percent::integer FROM discounts WHERE id = ?", Integer.class,
                    discountId)).isEqualTo(20);
            assertThat(api.database().single("SELECT version FROM discounts WHERE id = ?", Long.class, discountId)).isOne();
            assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ? "
                    + "AND change_type = 'UPDATED'", Long.class, discountId)).isOne();
            assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ?",
                    Long.class, discountId)).isEqualTo(2);
        }
    }

    @Test
    void simultaneousIdenticalEndsReplayAndWriteOneAuditAndOneVersionIncrement() throws Exception {
        try (var api = DiscountTestApi.start(15)) {
            var firstAdmin = api.actor("ADMIN");
            var secondAdmin = api.actor("ADMIN");
            var product = api.activeProduct(firstAdmin, id(api.category(firstAdmin)), "100.00");
            var discount = api.discount(firstAdmin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
            UUID discountId = id(discount);
            var body = Map.of("version", discount.get("version"));
            var replies = raceUnderLock(api, "SELECT id FROM discounts WHERE id = ? FOR UPDATE", List.of(discountId),
                    () -> api.send("POST", "/api/staff/discounts/" + discountId + "/end", firstAdmin, body),
                    () -> api.send("POST", "/api/staff/discounts/" + discountId + "/end", secondAdmin, body));
            assertThat(replies.stream().map(HttpResponse::statusCode)).containsExactly(200, 200);
            assertThat(json(replies.getFirst())).isEqualTo(json(replies.getLast()))
                    .containsEntry("version", 1).containsEntry("status", "ENDED");
            assertThat(api.database().single("SELECT ended_at IS NOT NULL FROM discounts WHERE id = ?", Boolean.class,
                    discountId)).isTrue();
            assertThat(api.database().single("SELECT version FROM discounts WHERE id = ?", Long.class, discountId)).isOne();
            assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ? "
                    + "AND change_type = 'ENDED'", Long.class, discountId)).isOne();
            assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ?",
                    Long.class, discountId)).isEqualTo(2);
            StaffDiscountIT.assertPrice(api.get(firstAdmin, product.get("id")), "100.00", null);
        }
    }

    @Test
    void endAndChangedEditAtOneVersionHaveOneSuccessAndOnlyAStaleFailure() throws Exception {
        try (var api = DiscountTestApi.start(15)) {
            var firstAdmin = api.actor("ADMIN");
            var secondAdmin = api.actor("ADMIN");
            var product = api.activeProduct(firstAdmin, id(api.category(firstAdmin)), "100.00");
            var discount = api.discount(firstAdmin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
            UUID discountId = id(discount);
            var replies = raceUnderLock(api, "SELECT id FROM discounts WHERE id = ? FOR UPDATE", List.of(discountId),
                    () -> api.send("POST", "/api/staff/discounts/" + discountId + "/end", firstAdmin,
                            Map.of("version", discount.get("version"))),
                    () -> api.send("PUT", "/api/staff/discounts/" + discountId, secondAdmin,
                            DiscountTestApi.updateBody(discount, Map.of("value", "20"))));
            assertOneWinner(replies);
            boolean endWon = replies.getFirst().statusCode() == 200;
            var successfulReply = endWon ? replies.getFirst() : replies.getLast();
            var winningActor = endWon ? firstAdmin : secondAdmin;
            int winningPercent = endWon ? 10 : 20;
            String winningChange = endWon ? "ENDED" : "UPDATED";
            var winner = json(successfulReply);
            assertThat(winner).containsOnlyKeys("id", "targetType", "targetId", "targetName", "productCount", "kind",
                            "value", "startsOn", "endsOn", "status", "version", "updatedAt", "updatedByUsername")
                    .containsEntry("id", discountId.toString()).containsEntry("targetType", "PRODUCT")
                    .containsEntry("targetId", product.get("id")).containsEntry("targetName", product.get("name"))
                    .containsEntry("productCount", null).containsEntry("kind", "PERCENTAGE")
                    .containsEntry("value", Integer.toString(winningPercent)).containsEntry("startsOn", TODAY.toString())
                    .containsEntry("endsOn", null).containsEntry("status", endWon ? "ENDED" : "ACTIVE")
                    .containsEntry("version", 1).containsEntry("updatedByUsername", winningActor.username());
            assertThat(api.database().single("SELECT count(*) FROM discounts WHERE id = ? "
                    + "AND target_type = 'PRODUCT' AND product_id = ? AND category_id IS NULL "
                    + "AND kind = 'PERCENTAGE' AND percent = ? AND amount IS NULL AND starts_on = ? "
                    + "AND ends_on IS NULL AND version = 1 AND updated_by = ? AND updated_at = ?::timestamptz "
                    + "AND (ended_at IS NULL) = ? AND (ended_at IS NULL OR ended_at = updated_at)",
                    Long.class, discountId, id(product), winningPercent, TODAY, winningActor.userId(),
                    winner.get("updatedAt"), !endWon)).isOne();
            assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ?",
                    Long.class, discountId)).isEqualTo(2);
            assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ? "
                    + "AND change_type = ? AND actor_user_id = ? AND kind = 'PERCENTAGE' AND percent = ? "
                    + "AND amount IS NULL AND starts_on = ? AND ends_on IS NULL AND occurred_at = ?::timestamptz "
                    + "AND request_id = ?", Long.class, discountId, winningChange, winningActor.userId(), winningPercent,
                    TODAY, winner.get("updatedAt"), successfulReply.headers().firstValue("X-Request-ID").orElseThrow())).isOne();
            StaffDiscountIT.assertPrice(api.get(firstAdmin, product.get("id")), endWon ? "100.00" : "80.00",
                    endWon ? null : discountId.toString());
        }
    }

    @Test
    void priceReadWhileWriterIsBlockedSeesCommittedOldTupleThenNewTupleAfterCommit() throws Exception {
        try (var api = DiscountTestApi.start(15); var executor = Executors.newSingleThreadExecutor();
             Connection blocker = api.database().connect()) {
            var admin = api.actor("ADMIN");
            var product = api.activeProduct(admin, id(api.category(admin)), "100.00");
            var discount = api.discount(admin, "PRODUCT", id(product), "PERCENTAGE", "10", TODAY, null);
            blocker.setAutoCommit(false);
            try (var statement = blocker.prepareStatement("SELECT id FROM discounts WHERE id = ? FOR UPDATE")) {
                statement.setObject(1, id(discount));
                statement.execute();
            }
            int blockerPid;
            try (var statement = blocker.createStatement(); var result = statement.executeQuery("SELECT pg_backend_pid()")) {
                result.next();
                blockerPid = result.getInt(1);
            }
            var updated = executor.submit(() -> api.send("PUT", "/api/staff/discounts/" + discount.get("id"), admin,
                    DiscountTestApi.updateBody(discount, Map.of("value", "20"))));
            try {
                awaitBlocked(api, blockerPid, 1);
                // The mutation is demonstrably in flight; an MVCC read must see the complete committed old value.
                var old = api.send("GET", "/api/products/" + product.get("id") + "/price", null, null);
                assertThat(old.statusCode()).isEqualTo(200);
                var value = json(old);
                assertThat(value).containsEntry("sellingPrice", "100.00").containsEntry("price", "90.00")
                        .containsEntry("saving", "10.00");
                assertThat(DiscountTestApi.object(value.get("discount"))).containsEntry("value", "10");
            } finally {
                blocker.rollback();
            }
            assertThat(updated.get(12, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            var fresh = json(api.send("GET", "/api/products/" + product.get("id") + "/price", null, null));
            assertThat(fresh).containsEntry("price", "80.00").containsEntry("saving", "20.00");
            assertThat(DiscountTestApi.object(fresh.get("discount"))).containsEntry("value", "20");
            assertThat(api.database().single("SELECT version FROM discounts WHERE id = ?", Long.class, id(discount))).isOne();
            assertThat(api.database().single("SELECT count(*) FROM discount_changes WHERE discount_id = ? "
                    + "AND change_type = 'UPDATED'", Long.class, id(discount))).isOne();
        }
    }

    @Test
    void priceReadSpanningAtomicPriceCategoryAndDiscountCommitKeepsOneCompleteSnapshot() throws Exception {
        try (var api = DiscountTestApi.start(15, PausedPriceConfiguration.class);
             var executor = Executors.newSingleThreadExecutor()) {
            var admin = api.actor("ADMIN");
            var oldCategory = api.category(admin);
            var newCategory = api.category(admin);
            var product = api.activeProduct(admin, id(oldCategory), "100.00");
            var oldDiscount = api.discount(admin, "CATEGORY", id(oldCategory), "PERCENTAGE", "10", TODAY, null);
            var newDiscount = api.discount(admin, "CATEGORY", id(newCategory), "PERCENTAGE", "20", TODAY, null);
            var gate = api.application().bean(PausedPrices.class).pauseNextRead();
            var reading = executor.submit(() -> api.send("GET", "/api/products/" + product.get("id") + "/price",
                    null, null));
            try {
                assertThat(gate.productLoaded.await(7, TimeUnit.SECONDS)).as("Product read reached materialization").isTrue();
                // One committed database state changes every input. READ COMMITTED would combine the old
                // Product/category with the new 40% candidate, incorrectly returning 60.00.
                try (Connection writer = api.database().connect()) {
                    writer.setAutoCommit(false);
                    try (var statement = writer.prepareStatement(
                            "UPDATE products SET selling_price = 200.00, category_id = ?, version = version + 1 WHERE id = ?")) {
                        statement.setObject(1, id(newCategory));
                        statement.setObject(2, id(product));
                        assertThat(statement.executeUpdate()).isOne();
                    }
                    try (var statement = writer.prepareStatement(
                            "UPDATE discounts SET percent = ?, version = version + 1 WHERE id = ?")) {
                        statement.setInt(1, 40);
                        statement.setObject(2, id(oldDiscount));
                        assertThat(statement.executeUpdate()).isOne();
                        statement.setInt(1, 30);
                        statement.setObject(2, id(newDiscount));
                        assertThat(statement.executeUpdate()).isOne();
                    }
                    writer.commit();
                }
            } finally {
                gate.continueRead.countDown();
            }
            var old = DiscountTestApi.successful(reading.get(12, TimeUnit.SECONDS), 200);
            assertThat(old).containsEntry("sellingPrice", "100.00").containsEntry("price", "90.00")
                    .containsEntry("saving", "10.00");
            assertThat(DiscountTestApi.object(old.get("discount"))).containsEntry("targetType", "CATEGORY")
                    .containsEntry("kind", "PERCENTAGE").containsEntry("value", "10");
            var fresh = DiscountTestApi.successful(api.send("GET", "/api/products/" + product.get("id") + "/price",
                    null, null), 200);
            assertThat(fresh).containsEntry("sellingPrice", "200.00").containsEntry("price", "140.00")
                    .containsEntry("saving", "60.00");
            assertThat(DiscountTestApi.object(fresh.get("discount"))).containsEntry("targetType", "CATEGORY")
                    .containsEntry("kind", "PERCENTAGE").containsEntry("value", "30");
        }
    }

    /** Explicit launch source only; no component scanning or production synchronization hook. */
    static final class PausedPriceConfiguration {
        @Bean
        @Primary
        PausedPrices pausedPrices(ProductRepository products, DiscountRepository discounts, DiscountCalendar calendar) {
            return new PausedPrices(products, discounts, calendar);
        }
    }

    static class PausedPrices extends CurrentPrices {
        private final AtomicReference<ReadGate> nextRead = new AtomicReference<>();

        PausedPrices(ProductRepository products, DiscountRepository discounts, DiscountCalendar calendar) {
            super(products, discounts, calendar);
        }

        ReadGate pauseNextRead() {
            var gate = new ReadGate();
            nextRead.set(gate);
            return gate;
        }

        @Override
        Map<UUID, EffectivePrice> forProducts(Collection<Product> products, LocalDate today) {
            var gate = nextRead.getAndSet(null);
            if (gate != null) {
                gate.productLoaded.countDown();
                try {
                    if (!gate.continueRead.await(12, TimeUnit.SECONDS)) {
                        throw new AssertionError("Timed out waiting for the controlled mutation commit");
                    }
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new AssertionError("Price materialization was interrupted", interrupted);
                }
            }
            return super.forProducts(products, today);
        }
    }

    static final class ReadGate {
        final CountDownLatch productLoaded = new CountDownLatch(1);
        final CountDownLatch continueRead = new CountDownLatch(1);
    }

    private static void assertOneWinner(List<HttpResponse<String>> replies) {
        assertThat(replies.stream().map(HttpResponse::statusCode)).containsExactlyInAnyOrder(200, 409);
        assertError(replies.stream().filter(reply -> reply.statusCode() == 409).findFirst().orElseThrow(),
                409, "STALE_UPDATE");
    }

    private static List<HttpResponse<String>> raceUnderLock(DiscountTestApi api, String blockerSql,
            List<?> parameters, Callable<HttpResponse<String>> first, Callable<HttpResponse<String>> second)
            throws Exception {
        try (Connection blocker = api.database().connect(); var executor = Executors.newFixedThreadPool(2)) {
            blocker.setAutoCommit(false);
            try (var statement = blocker.prepareStatement(blockerSql)) {
                for (int i = 0; i < parameters.size(); i++) statement.setObject(i + 1, parameters.get(i));
                statement.execute();
            }
            int blockerPid;
            try (var statement = blocker.createStatement(); var result = statement.executeQuery("SELECT pg_backend_pid()")) {
                result.next();
                blockerPid = result.getInt(1);
            }
            var gate = new CyclicBarrier(2);
            var one = executor.submit(() -> { gate.await(7, TimeUnit.SECONDS); return first.call(); });
            var two = executor.submit(() -> { gate.await(7, TimeUnit.SECONDS); return second.call(); });
            try {
                awaitBlocked(api, blockerPid, 2);
            } finally {
                blocker.rollback();
            }
            return List.of(one.get(12, TimeUnit.SECONDS), two.get(12, TimeUnit.SECONDS));
        }
    }

    private static void awaitBlocked(DiscountTestApi api, int blockerPid, int expected) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(7).toNanos();
        do {
            Long blocked = api.database().single("WITH RECURSIVE blocked_requests(pid) AS (SELECT ?::integer UNION "
                    + "SELECT a.pid FROM pg_stat_activity a JOIN blocked_requests b ON b.pid = ANY(pg_blocking_pids(a.pid)) "
                    + "WHERE a.datname = current_database() AND a.usename = current_user AND a.wait_event_type = 'Lock') "
                    + "SELECT count(*) FROM blocked_requests WHERE pid <> ?", Long.class, blockerPid, blockerPid);
            if (blocked == expected) return;
            Thread.yield();
        } while (System.nanoTime() < deadline);
        throw new AssertionError("Expected discount requests were not observed waiting on the controlled PostgreSQL lock");
    }
}

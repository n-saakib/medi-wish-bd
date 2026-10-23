package bd.mediwish.auth;

import bd.mediwish.mail.EmailKind;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;

/** Eligible, ineligible and limited accounts have the same public reply and no rate-limit signal. */
@Tag("integration")
@Tag("security")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(OutputCaptureExtension.class)
class ResetUniformityIT {
    private final AuthApi api = AuthApi.start(TimingConfiguration.class);
    @AfterAll void close() throws Exception { api.close(); }
    @BeforeEach void protectKey() {
        testClock().set(java.time.Instant.now());
        api.track(api.app().bean(AuthProperties.class).recovery().codeKey());
    }
    @AfterEach void logsOmitSecrets(CapturedOutput output) throws Exception {
        api.drainMail();
        api.assertLogsOmitSecrets(output);
    }

    @Test
    void theSixEligibilityAndLimitCasesShareOneEmpty202Contract() throws Exception {
        var eligible = api.registered();
        api.markEmailVerified(eligible);
        var unverified = api.registered();
        String unknown = api.track("uniform." + UUID.randomUUID() + "@example.test");
        var addressLimited = api.registered();
        // Real requests exhaust the address window before making the account eligible; they send no mail.
        for (int attempt = 0; attempt < 10; attempt++) {
            assertThat(api.requestReset(addressLimited.email()).statusCode()).isEqualTo(202);
        }
        api.markEmailVerified(addressLimited);
        var issueLimited = api.registered();
        api.markEmailVerified(issueLimited);
        api.database().update("INSERT INTO account_code_limits(limit_key,window_started_at,attempts,last_at) "
                + "VALUES (?,now(),5,now() - interval '61 seconds')", "issue:" + api.userId(issueLimited));
        var closing = api.registered();
        api.markEmailVerified(closing);
        api.accountState(closing, "CLOSURE_REQUESTED");
        var cases = List.of(eligible.email(), unverified.email(), unknown, addressLimited.email(),
                issueLimited.email(), closing.email());
        List<HttpResponse<String>> replies = new ArrayList<>();

        for (String email : cases) replies.add(api.requestReset(email));

        assertThat(replies).extracting(HttpResponse::statusCode).containsOnly(202);
        assertThat(replies).extracting(HttpResponse::body).containsOnly("");
        for (var reply : replies) {
            assertThat(reply.headers().allValues("Set-Cookie")).isEmpty();
            assertThat(reply.headers().allValues("Retry-After")).isEmpty();
            assertThat(reply.headers().firstValue("Content-Type"))
                    .isEqualTo(replies.getFirst().headers().firstValue("Content-Type"));
        }
        assertThat(replies).extracting(reply -> reply.headers().firstValue("X-Request-ID").orElseThrow())
                .doesNotHaveDuplicates();
        api.drainMail();
        assertThat(api.capturedMail().messages()).extracting(mail -> mail.kind())
                .containsExactly(EmailKind.PASSWORD_RESET_CODE, EmailKind.PASSWORD_RESET_CODE);
        assertThat(api.capturedMail().messages()).extracting(mail -> mail.to())
                .containsExactlyInAnyOrder(eligible.email(), closing.email());
        api.awaitMail(EmailKind.PASSWORD_RESET_CODE, eligible.email());
        api.awaitMail(EmailKind.PASSWORD_RESET_CODE, closing.email());
        assertThat(api.accountCodes(eligible)).hasSize(1);
        assertThat(api.accountCodes(closing)).hasSize(1);
        for (var user : List.of(unverified, addressLimited, issueLimited)) assertThat(api.accountCodes(user)).isEmpty();
    }


    @Test
    void reportsFiftyRequestTimingsAndHibernateStatementCountsForAllSixUniformityCases() throws Exception {
        var eligible = api.registered();
        api.markEmailVerified(eligible);
        var unverified = api.registered();
        String unknown = api.track("t7-unknown." + UUID.randomUUID() + "@example.test");
        var addressLimited = api.registered();
        api.markEmailVerified(addressLimited);
        var issueLimited = api.registered();
        api.markEmailVerified(issueLimited);
        var closing = api.registered();
        api.markEmailVerified(closing);
        api.accountState(closing, "CLOSURE_REQUESTED");

        var cases = List.of(
                new RequestCase("verified-eligible", eligible.email(),
                        () -> prepareRequestState(eligible.email(), eligible)),
                new RequestCase("unverified", unverified.email(),
                        () -> prepareRequestState(unverified.email(), unverified)),
                new RequestCase("unknown", unknown, () -> prepareRequestState(unknown, null)),
                new RequestCase("address-limited", addressLimited.email(),
                        () -> prepareAddressLimitedState(addressLimited)),
                new RequestCase("issue-limited", issueLimited.email(),
                        () -> prepareIssueLimitedState(issueLimited)),
                new RequestCase("closure-requested-eligible", closing.email(),
                        () -> prepareRequestState(closing.email(), closing)));

        var statistics = api.app().bean(jakarta.persistence.EntityManagerFactory.class)
                .unwrap(org.hibernate.SessionFactory.class).getStatistics();
        boolean wasEnabled = statistics.isStatisticsEnabled();
        var medians = new java.util.LinkedHashMap<String, Double>();
        statistics.setStatisticsEnabled(true);
        try {
            for (var sample : cases) {
                var elapsed = new java.util.ArrayList<Long>();
                var statementCounts = new java.util.TreeMap<Long, Integer>();
                for (int iteration = 0; iteration < 50; iteration++) {
                    sample.prepare().prepare();
                    statistics.clear();
                    long started = System.nanoTime();
                    var response = api.requestReset(sample.email());
                    long duration = System.nanoTime() - started;
                    assertThat(response.statusCode()).isEqualTo(202);
                    assertThat(response.body()).isEmpty();
                    elapsed.add(duration);
                    statementCounts.merge(statistics.getPrepareStatementCount(), 1, Integer::sum);
                }
                double median = medianNanos(elapsed);
                long p95 = percentileNanos(elapsed, 0.95);
                medians.put(sample.name(), median);
                System.out.printf(java.util.Locale.ROOT,
                        "T7 reset case=%s samples=%d median_ms=%.3f p95_ms=%.3f statement_counts=%s%n",
                        sample.name(), elapsed.size(), median / 1_000_000.0, p95 / 1_000_000.0, statementCounts);
            }

            var confirmationUser = api.registered();
            api.markEmailVerified(confirmationUser);
            var request = api.requestReset(confirmationUser.email());
            assertThat(request.statusCode()).isEqualTo(202);
            String code = AuthApi.codeFrom(api.awaitMail(EmailKind.PASSWORD_RESET_CODE, confirmationUser.email()));
            String wrongCode = code.equals("000000") ? "000001" : "000000";
            String replacement = "Ticket5-reset-" + UUID.randomUUID().toString().replace("-", "").substring(0, 6);

            statistics.clear();
            var wrong = api.confirmReset(confirmationUser.email(), wrongCode, replacement);
            long wrongStatements = statistics.getPrepareStatementCount();
            assertThat(wrong.statusCode()).isEqualTo(400);

            statistics.clear();
            var right = api.confirmReset(confirmationUser.email(), code, replacement);
            long rightStatements = statistics.getPrepareStatementCount();
            assertThat(right.statusCode()).isEqualTo(204);
            assertThat(right.body()).isEmpty();
            System.out.printf("T7 confirm statement_counts wrong=%d right=%d%n", wrongStatements, rightStatements);

            double spreadMillis = (java.util.Collections.max(medians.values())
                    - java.util.Collections.min(medians.values())) / 1_000_000.0;
            if (spreadMillis > 25.0) {
                System.out.printf(java.util.Locale.ROOT,
                        "T7 investigation required: request-case median spread is %.3f ms (over 25 ms); compare the six case paths and record an explanation.%n",
                        spreadMillis);
            }
        } finally {
            statistics.setStatisticsEnabled(wasEnabled);
        }
        api.drainMail();
    }

    @Test
    void prunesOneThousandOldUnknownAddressRowsAfterTheClockAdvancesThreeHours() throws Exception {
        var clock = testClock();
        var initial = java.time.Instant.now();
        clock.set(initial);
        api.database().update("DELETE FROM account_code_limits");
        for (int index = 0; index < 1_000; index++) {
            String email = api.track("t7-prune-" + index + "." + UUID.randomUUID() + "@example.test");
            var response = api.requestReset(email);
            assertThat(response.statusCode()).isEqualTo(202);
            assertThat(response.body()).isEmpty();
        }
        assertThat(api.database().single("SELECT count(*) FROM account_code_limits", Long.class)).isEqualTo(1_000L);

        clock.advance(java.time.Duration.ofHours(3));
        String freshEmail = api.track("t7-fresh." + UUID.randomUUID() + "@example.test");
        var finalRequest = api.requestReset(freshEmail);
        assertThat(finalRequest.statusCode()).isEqualTo(202);
        assertThat(finalRequest.body()).isEmpty();

        var rows = api.limitRows();
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().key()).isEqualTo(addressLimitKey(freshEmail));
    }

    private void prepareRequestState(String email, AuthApi.User user) throws Exception {
        api.database().update("DELETE FROM account_code_limits WHERE limit_key = ?", addressLimitKey(email));
        if (user == null) return;
        var userId = api.userId(user);
        api.database().update("DELETE FROM account_code_limits WHERE limit_key = ?", "issue:" + userId);
        api.database().update("DELETE FROM account_codes WHERE user_id = ?", userId);
    }

    private void prepareAddressLimitedState(AuthApi.User user) throws Exception {
        prepareRequestState(user.email(), user);
        seedLimit(addressLimitKey(user.email()), 10, testClock().instant());
    }

    private void prepareIssueLimitedState(AuthApi.User user) throws Exception {
        prepareRequestState(user.email(), user);
        var now = testClock().instant();
        seedLimit("issue:" + api.userId(user), 5, now.minusSeconds(61));
    }

    private void seedLimit(String key, int attempts, java.time.Instant lastAt) throws Exception {
        var now = testClock().instant();
        api.database().update("INSERT INTO account_code_limits(limit_key,window_started_at,attempts,last_at) "
                        + "VALUES (?,?,?,?) ON CONFLICT (limit_key) DO UPDATE SET "
                        + "window_started_at=EXCLUDED.window_started_at, attempts=EXCLUDED.attempts, last_at=EXCLUDED.last_at",
                key, java.sql.Timestamp.from(now), attempts, java.sql.Timestamp.from(lastAt));
    }

    private String addressLimitKey(String email) {
        return api.app().bean(AccountCodeHasher.class).addressKey(email);
    }

    private AdjustableClock testClock() {
        return api.app().bean(AdjustableClock.class);
    }

    private static double medianNanos(List<Long> durations) {
        var sorted = durations.stream().sorted().toList();
        int middle = sorted.size() / 2;
        return sorted.size() % 2 == 0
                ? (sorted.get(middle - 1) + sorted.get(middle)) / 2.0
                : sorted.get(middle);
    }

    private static long percentileNanos(List<Long> durations, double percentile) {
        var sorted = durations.stream().sorted().toList();
        return sorted.get((int) Math.ceil(percentile * sorted.size()) - 1);
    }

    @FunctionalInterface
    private interface RequestState {
        void prepare() throws Exception;
    }

    private record RequestCase(String name, String email, RequestState prepare) {}

    @org.springframework.boot.test.context.TestConfiguration
    static class TimingConfiguration {
        @org.springframework.context.annotation.Bean
        @org.springframework.context.annotation.Primary
        AdjustableClock ticketFiveClock() {
            return new AdjustableClock(java.time.Instant.now());
        }
    }

    static final class AdjustableClock extends java.time.Clock {
        private final java.util.concurrent.atomic.AtomicReference<java.time.Instant> current;
        private final java.time.ZoneId zone;

        AdjustableClock(java.time.Instant initial) {
            this(new java.util.concurrent.atomic.AtomicReference<>(initial), java.time.ZoneOffset.UTC);
        }

        private AdjustableClock(java.util.concurrent.atomic.AtomicReference<java.time.Instant> current,
                               java.time.ZoneId zone) {
            this.current = current;
            this.zone = zone;
        }

        void set(java.time.Instant value) {
            current.set(value);
        }

        void advance(java.time.Duration duration) {
            current.updateAndGet(value -> value.plus(duration));
        }

        @Override
        public java.time.ZoneId getZone() {
            return zone;
        }

        @Override
        public java.time.Clock withZone(java.time.ZoneId requested) {
            return zone.equals(requested) ? this : new AdjustableClock(current, requested);
        }

        @Override
        public java.time.Instant instant() {
            return current.get();
        }
    }
}

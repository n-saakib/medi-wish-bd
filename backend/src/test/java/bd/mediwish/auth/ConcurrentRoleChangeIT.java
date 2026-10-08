package bd.mediwish.auth;

import bd.mediwish.user.UserRepository;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Bean;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Predicate;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.withSettings;
import static org.mockito.AdditionalAnswers.delegatesTo;

/** Forced transaction ordering with actual PostgreSQL waiting-state evidence, without production hooks. */
@Tag("integration")
@Tag("security")
@Tag("recovery")
@Tag("regression")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(OutputCaptureExtension.class)
class ConcurrentRoleChangeIT {
    private final AuthApi api = AuthApi.start(GatedWrites.class);
    private final Gates gates = api.app().bean(Gates.class);

    private AuthApi.VerifiedStaff owner;
    @BeforeAll void provisionOwner() throws Exception { owner = api.verifiedSuperAdmin(); }

    @AfterAll void close() throws Exception { api.close(); }
    @AfterEach void resetAndCheckLogs(CapturedOutput output) {
        gates.clear();
        api.assertLogsOmitSecrets(output);
    }

    @ParameterizedTest
    @CsvSource({"MODERATOR, DELIVERY_PERSON", "DELIVERY_PERSON, MODERATOR"})
    void differentRoleCommandsWaitThenOnlyTheFirstVersionWins(String firstRole, String secondRole) throws Exception {
        var actor = api.verifiedAdmin();
        var otherActor = api.verifiedAdmin();
        var target = api.registered();
        UUID targetId = api.userId(target);
        var before = api.signIn(target);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor();
             var gate = gates.role(targetId)) {
            var first = executor.submit(() -> api.putRole(actor.token(), targetId, firstRole, 0));
            gate.awaitEntered();
            var second = executor.submit(() -> api.putRole(otherActor.token(), targetId, secondRole, 0));
            awaitWaiting("users", "user_sessions");
            gate.release();
            assertThat(first.get(15, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            assertError(second.get(15, TimeUnit.SECONDS), 409, "STALE_UPDATE");
        }
        assertChangedOnce(targetId, firstRole);
        assertThat(api.revoked(target, RevocationReason.ROLE_CHANGED)).isOne();
        assertError(api.profile(before.accessToken()), 401, "AUTHENTICATION_REQUIRED");
    }

    @Test
    void identicalCommandsFromTwoAdminsWaitThenTheRetryWritesNothing() throws Exception {
        var actor = api.verifiedAdmin();
        var otherActor = api.verifiedAdmin();
        var target = api.registered();
        UUID targetId = api.userId(target);
        var before = api.signIn(target);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor();
             var gate = gates.role(targetId)) {
            var first = executor.submit(() -> api.putRole(actor.token(), targetId, "MODERATOR", 0));
            gate.awaitEntered();
            var second = executor.submit(() -> api.putRole(otherActor.token(), targetId, "MODERATOR", 0));
            awaitWaiting("users", "user_sessions");
            gate.release();
            assertThat(first.get(15, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            var repeated = second.get(15, TimeUnit.SECONDS);
            assertThat(repeated.statusCode()).isEqualTo(200);
            assertThat(((Number) json(repeated).get("rolesVersion")).longValue()).isOne();
        }
        assertChangedOnce(targetId, "MODERATOR");
        assertThat(api.database().single("SELECT actor_user_id FROM user_role_changes WHERE target_user_id = ?",
                UUID.class, targetId)).isEqualTo(api.userId(actor.user()));
        assertThat(api.revoked(target, RevocationReason.ROLE_CHANGED)).isOne();
        assertError(api.profile(before.accessToken()), 401, "AUTHENTICATION_REQUIRED");
    }
    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void actorDemotionAndCommandRecheckTheActorInBothOrders(boolean demotionFirst) throws Exception {
        var actor = api.verifiedAdmin();
        UUID actorId = api.userId(actor.user());
        var target = api.registered();
        UUID targetId = api.userId(target);
        var before = api.signIn(target);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor();
             var gate = gates.role(demotionFirst ? actorId : targetId)) {
            var first = executor.submit(() -> demotionFirst
                    ? api.putRole(owner.token(), actorId, "CUSTOMER", 0)
                    : api.putRole(actor.token(), targetId, "MODERATOR", 0));
            gate.awaitEntered();
            var second = executor.submit(() -> demotionFirst
                    ? api.putRole(actor.token(), targetId, "MODERATOR", 0)
                    : api.putRole(owner.token(), actorId, "CUSTOMER", 0));
            awaitWaiting("users", "user_sessions");
            gate.release();
            assertThat(first.get(15, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            var losingOrder = second.get(15, TimeUnit.SECONDS);
            if (demotionFirst) assertError(losingOrder, 401, "AUTHENTICATION_REQUIRED");
            else assertThat(losingOrder.statusCode()).isEqualTo(200);
        }
        assertChangedOnce(actorId, "CUSTOMER");
        assertError(api.staffMe(actor.token()), 401, "AUTHENTICATION_REQUIRED");
        if (demotionFirst) {
            assertThat(api.database().single("SELECT roles_version FROM users WHERE id = ?", Long.class, targetId)).isZero();
            assertThat(api.database().single("SELECT count(*) FROM user_role_changes WHERE target_user_id = ?", Long.class, targetId)).isZero();
            assertThat(api.profile(before.accessToken()).statusCode()).isEqualTo(200);
        } else {
            assertChangedOnce(targetId, "MODERATOR");
            assertThat(api.database().single("SELECT actor_user_id FROM user_role_changes WHERE target_user_id = ?",
                    UUID.class, targetId)).isEqualTo(actorId);
            assertError(api.profile(before.accessToken()), 401, "AUTHENTICATION_REQUIRED");
        }
    }
    @Test
    void aCommandAuthenticatedBeforeActorDemotionRechecksBeforeChangingAnotherUser() throws Exception {
        var actor = api.verifiedAdmin();
        UUID actorId = api.userId(actor.user());
        var target = api.registered();
        UUID targetId = api.userId(target);
        var targetSession = api.signIn(target);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor();
             var gate = gates.command(targetId)) {
            var command = executor.submit(() -> api.putRole(actor.token(), targetId, "MODERATOR", 0));
            gate.awaitEntered(); // The HTTP bearer filter has already authenticated the Admin.
            assertThat(api.putRole(owner.token(), actorId, "CUSTOMER", 0).statusCode()).isEqualTo(200);
            gate.release(); // The command must now recheck the committed role and revoked session.
            assertError(command.get(15, TimeUnit.SECONDS), 403, "ACCESS_DENIED");
        }
        assertChangedOnce(actorId, "CUSTOMER");
        assertError(api.staffMe(actor.token()), 401, "AUTHENTICATION_REQUIRED");
        assertThat(api.database().single("SELECT role FROM user_roles WHERE user_id = ?", String.class, targetId))
                .isEqualTo("CUSTOMER");
        assertThat(api.database().single("SELECT roles_version FROM users WHERE id = ?", Long.class, targetId)).isZero();
        assertThat(api.database().single("SELECT count(*) FROM user_role_changes WHERE target_user_id = ?",
                Long.class, targetId)).isZero();
        assertThat(api.profile(targetSession.accessToken()).statusCode()).isEqualTo(200);
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void refreshAndRevocationLeaveNoUsableTargetSessionInBothOrders(boolean refreshFirst) throws Exception {
        var actor = api.verifiedAdmin();
        var target = api.registered();
        UUID targetId = api.userId(target);
        var before = api.signIn(target);
        api.csrf();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor();
             var gate = gates.role(targetId, refreshFirst)) {
            var change = executor.submit(() -> api.putRole(actor.token(), targetId, "MODERATOR", 0));
            gate.awaitEntered();
            var refresh = executor.submit(() -> api.refresh(before.refreshToken()));
            AuthApi.Session refreshed = null;
            if (refreshFirst) refreshed = api.session(refresh.get(15, TimeUnit.SECONDS));
            else awaitWaiting("user_sessions", null);
            gate.release();
            assertThat(change.get(15, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            if (refreshFirst) {
                assertError(api.profile(refreshed.accessToken()), 401, "AUTHENTICATION_REQUIRED");
                assertError(api.refresh(refreshed.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
            } else assertError(refresh.get(15, TimeUnit.SECONDS), 401, "AUTHENTICATION_REQUIRED");
        }
        assertChangedOnce(targetId, "MODERATOR");
        assertThat(api.revoked(target, RevocationReason.ROLE_CHANGED)).isOne();
        assertNoActiveSession(targetId);
        assertError(api.profile(before.accessToken()), 401, "AUTHENTICATION_REQUIRED");
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void passwordSignInUsesTheCommittedRoleOrIsRevokedInBothOrders(boolean roleFirst) throws Exception {
        var target = api.registered();
        UUID targetId = api.userId(target);
        var before = api.signIn(target);
        api.csrf();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor();
             var gate = roleFirst ? gates.role(targetId, true)
                     : gates.token(token -> token.generation() == 0 && token.session().user().id().equals(targetId))) {
            var first = executor.submit(() -> roleFirst
                    ? api.putRole(owner.token(), targetId, "MODERATOR", 0)
                    : api.login(target.username(), target.password()));
            gate.awaitEntered();
            var second = executor.submit(() -> roleFirst
                    ? api.login(target.username(), target.password())
                    : api.putRole(owner.token(), targetId, "MODERATOR", 0));
            awaitWaiting("users", "user_sessions");
            gate.release();
            var changed = roleFirst ? first.get(15, TimeUnit.SECONDS) : second.get(15, TimeUnit.SECONDS);
            var signedIn = roleFirst ? second.get(15, TimeUnit.SECONDS) : first.get(15, TimeUnit.SECONDS);
            assertThat(changed.statusCode()).isEqualTo(200);
            var session = api.session(signedIn, roleFirst ? "ENROLLMENT_REQUIRED" : "NOT_REQUIRED");
            if (roleFirst) {
                assertError(api.profile(session.accessToken()), 403, "MFA_REQUIRED");
                api.session(api.refresh(session.refreshToken()), "ENROLLMENT_REQUIRED");
                assertThat(api.database().single("SELECT count(*) FROM user_sessions WHERE user_id = ? "
                        + "AND revoked_at IS NULL AND expires_at > now()", Long.class, targetId)).isOne();
            } else {
                assertError(api.profile(session.accessToken()), 401, "AUTHENTICATION_REQUIRED");
                assertError(api.refresh(session.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
                assertNoActiveSession(targetId);
            }
        }
        assertChangedOnce(targetId, "MODERATOR");
        assertThat(api.revoked(target, RevocationReason.ROLE_CHANGED)).isEqualTo(roleFirst ? 1 : 2);
        assertError(api.profile(before.accessToken()), 401, "AUTHENTICATION_REQUIRED");
    }
    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void mfaVerificationIsRefusedOrItsUpgradedSessionIsRevokedInBothOrders(boolean roleFirst) throws Exception {
        var target = api.registered();
        api.grantRole(target, "MODERATOR");
        UUID targetId = api.userId(target);
        var enrolled = api.enroll(target);
        var restricted = api.session(api.login(target.username(), target.password()), "VERIFICATION_REQUIRED");
        String code = AuthApi.totp(enrolled.secret(), 1);
        api.csrf();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor();
             var gate = roleFirst ? gates.role(targetId, true)
                     : gates.token(token -> token.generation() == 0 && token.session().user().id().equals(targetId))) {
            var first = executor.submit(() -> roleFirst
                    ? api.putRole(owner.token(), targetId, "CUSTOMER", 0)
                    : api.verifyMfa(restricted.accessToken(), code));
            gate.awaitEntered();
            var second = executor.submit(() -> roleFirst
                    ? api.verifyMfa(restricted.accessToken(), code)
                    : api.putRole(owner.token(), targetId, "CUSTOMER", 0));
            awaitWaiting("users", "user_sessions");
            gate.release();
            var changed = roleFirst ? first.get(15, TimeUnit.SECONDS) : second.get(15, TimeUnit.SECONDS);
            var verification = roleFirst ? second.get(15, TimeUnit.SECONDS) : first.get(15, TimeUnit.SECONDS);
            assertThat(changed.statusCode()).isEqualTo(200);
            if (roleFirst) assertError(verification, 401, "AUTHENTICATION_REQUIRED");
            else {
                var upgraded = api.session(verification, "VERIFIED");
                assertError(api.staffMe(upgraded.accessToken()), 401, "AUTHENTICATION_REQUIRED");
                assertError(api.refresh(upgraded.refreshToken()), 401, "AUTHENTICATION_REQUIRED");
            }
        }
        assertChangedOnce(targetId, "CUSTOMER");
        assertNoActiveSession(targetId);
        assertThat(api.database().single("SELECT count(*) FROM staff_mfa_factors WHERE user_id = ? "
                + "AND activated_at IS NOT NULL AND revoked_at IS NULL", Long.class, targetId)).isOne();
        assertError(api.staffMe(enrolled.session().accessToken()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.verifyMfa(restricted.accessToken(), code), 401, "AUTHENTICATION_REQUIRED");
    }
    @ParameterizedTest
    @CsvSource({"false, false", "false, true", "true, false", "true, true"})
    void promotionAndAuthenticationNeverGrantAdminReadsToAnOldModeratorToken(boolean promotionFirst,
                                                                            boolean detail) throws Exception {
        var target = api.registered();
        api.grantRole(target, "MODERATOR");
        UUID targetId = api.userId(target);
        var enrolled = api.enroll(target);
        String oldToken = enrolled.session().accessToken();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor();
             var gate = promotionFirst ? gates.role(targetId) : gates.authentication(targetId)) {
            var first = executor.submit(() -> promotionFirst
                    ? api.putRole(owner.token(), targetId, "ADMIN", 0)
                    : detail ? api.adminUser(oldToken, targetId) : api.adminUsers(oldToken, Map.of()));
            gate.awaitEntered();
            var second = executor.submit(() -> promotionFirst
                    ? detail ? api.adminUser(oldToken, targetId) : api.adminUsers(oldToken, Map.of())
                    : api.putRole(owner.token(), targetId, "ADMIN", 0));
            // Without a coherent User lock, promotion commits in this gap and grants the old token ADMIN.
            boolean competitorWaited = waitingForLock("users", "user_sessions");
            if (!competitorWaited && !promotionFirst) {
                assertThat(second.get(15, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            }
            gate.release();
            var read = promotionFirst ? second.get(15, TimeUnit.SECONDS) : first.get(15, TimeUnit.SECONDS);
            assertError(read, promotionFirst ? 401 : 403,
                    promotionFirst ? "AUTHENTICATION_REQUIRED" : "ACCESS_DENIED");
            var promotion = promotionFirst ? first.get(15, TimeUnit.SECONDS) : second.get(15, TimeUnit.SECONDS);
            assertThat(promotion.statusCode()).isEqualTo(200);
            assertThat(competitorWaited).as("the competing operation waited on the User row lock").isTrue();
        }
        assertChangedOnce(targetId, "ADMIN");
        assertNoActiveSession(targetId);
        assertError(api.adminUsers(oldToken, Map.of()), 401, "AUTHENTICATION_REQUIRED");
        assertError(api.adminUser(oldToken, targetId), 401, "AUTHENTICATION_REQUIRED");
    }

    private void assertNoActiveSession(UUID userId) throws Exception {
        assertThat(api.database().single("SELECT count(*) FROM user_sessions WHERE user_id = ? "
                + "AND revoked_at IS NULL AND expires_at > now()", Long.class, userId)).isZero();
    }
    private void assertChangedOnce(UUID targetId, String role) throws Exception {
        assertThat(api.database().single("SELECT role FROM user_roles WHERE user_id = ?", String.class, targetId)).isEqualTo(role);
        assertThat(api.database().single("SELECT roles_version FROM users WHERE id = ?", Long.class, targetId)).isOne();
        assertThat(api.database().single("SELECT count(*) FROM user_role_changes WHERE target_user_id = ?", Long.class, targetId)).isOne();
    }

    /** Polls an observable lock wait in this owned schema; the brief delay only paces polling. */
    private void awaitWaiting(String table, String excludedTable) throws Exception {
        assertThat(waitingForLock(table, excludedTable))
                .as("the competing transaction waited on the expected row lock").isTrue();
    }

    private boolean waitingForLock(String table, String excludedTable) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
        do {
            long waiting = api.database().single("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                    + "AND usename = current_user AND wait_event_type = 'Lock' AND query LIKE ? AND query LIKE ? "
                    + "AND query NOT LIKE ?", Long.class, "%" + api.database().schema() + "%", "%" + table + "%",
                    excludedTable == null ? "%not_a_real_table_name%" : "%" + excludedTable + "%");
            if (waiting >= 1) return true;
            Thread.sleep(10);
        } while (System.nanoTime() < deadline);
        return false;
    }

    static final class Gate implements AutoCloseable {
        private final CountDownLatch entered = new CountDownLatch(1);
        private final CountDownLatch released = new CountDownLatch(1);
        private final AtomicBoolean unused = new AtomicBoolean(true);
        void stopOnce() throws InterruptedException {
            if (!unused.compareAndSet(true, false)) return;
            entered.countDown();
            if (!released.await(8, TimeUnit.SECONDS)) throw new AssertionError("transaction gate was not released");
        }
        void awaitEntered() throws InterruptedException {
            assertThat(entered.await(5, TimeUnit.SECONDS)).as("first operation reached its held transaction boundary").isTrue();
        }
        void release() { released.countDown(); }
        @Override public void close() { release(); }
    }

    static final class Gates {
        volatile UUID commandTarget;
        volatile Gate commandGate;
        volatile UUID authenticationUser;
        volatile Gate authenticationGate;
        volatile UUID roleUser;
        volatile Gate roleGate;
        volatile boolean roleBefore;
        volatile Predicate<UserSessionRefreshToken> tokenMatches;
        volatile Gate tokenGate;
        Gate command(UUID targetId) { commandTarget = targetId; return commandGate = new Gate(); }
        Gate authentication(UUID userId) { authenticationUser = userId; return authenticationGate = new Gate(); }
        Gate role(UUID userId) { return role(userId, false); }
        Gate role(UUID userId, boolean before) { roleBefore = before; roleUser = userId; return roleGate = new Gate(); }
        Gate token(Predicate<UserSessionRefreshToken> matches) { tokenMatches = matches; return tokenGate = new Gate(); }
        void clear() {
            if (commandGate != null) commandGate.release();
            if (authenticationGate != null) authenticationGate.release();
            if (roleGate != null) roleGate.release();
            if (tokenGate != null) tokenGate.release();
            commandGate = null; commandTarget = null;
            authenticationGate = null; authenticationUser = null;
            roleGate = null; tokenGate = null; roleUser = null; tokenMatches = null;
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class GatedWrites {
        @Bean Gates transactionGates() { return new Gates(); }
        @Bean static BeanPostProcessor holdTransactionWriters(Gates gates) {
            return new BeanPostProcessor() {
                @Override public Object postProcessAfterInitialization(Object bean, String name) {
                    if (bean instanceof SessionService service) {
                        var wrapped = mock(SessionService.class, withSettings().defaultAnswer(delegatesTo(service)));
                        doAnswer(invocation -> {
                            Gate gate = gates.roleGate;
                            boolean matches = gate != null && invocation.getArgument(0).equals(gates.roleUser)
                                    && invocation.getArgument(1) == RevocationReason.ROLE_CHANGED;
                            if (matches && gates.roleBefore) gate.stopOnce();
                            service.revokeAllForUser(invocation.getArgument(0), invocation.getArgument(1));
                            if (matches && !gates.roleBefore) gate.stopOnce();
                            return null;
                        }).when(wrapped).revokeAllForUser(any(UUID.class), any(RevocationReason.class));
                        doAnswer(invocation -> {
                            Object evidence = service.requireActive(invocation.getArgument(0), invocation.getArgument(1),
                                    invocation.getArgument(2));
                            Gate gate = gates.authenticationGate;
                            if (gate != null && invocation.getArgument(1).equals(gates.authenticationUser)) gate.stopOnce();
                            return evidence;
                        }).when(wrapped).requireActive(any(UUID.class), any(UUID.class), any(Instant.class));
                        return wrapped;
                    }
                    if (bean instanceof UserRepository repository) {
                        var wrapped = mock(UserRepository.class, withSettings().defaultAnswer(delegatesTo(repository)));
                        doAnswer(invocation -> {
                            java.util.Collection<UUID> ids = invocation.getArgument(0);
                            Gate gate = gates.commandGate;
                            if (gate != null && ids.contains(gates.commandTarget)) gate.stopOnce();
                            return repository.findAllByIdForUpdate(ids);
                        }).when(wrapped).findAllByIdForUpdate(anyCollection());
                        return wrapped;
                    }
                    if (bean instanceof UserSessionRefreshTokenRepository repository) {
                        var wrapped = mock(UserSessionRefreshTokenRepository.class, withSettings().defaultAnswer(delegatesTo(repository)));
                        doAnswer(invocation -> {
                            Object result = repository.save(invocation.getArgument(0));
                            Gate gate = gates.tokenGate;
                            var matches = gates.tokenMatches;
                            if (gate != null && matches != null && matches.test(invocation.getArgument(0))) gate.stopOnce();
                            return result;
                        }).when(wrapped).save(any(UserSessionRefreshToken.class));
                        return wrapped;
                    }
                    return bean;
                }
            };
        }
    }
}

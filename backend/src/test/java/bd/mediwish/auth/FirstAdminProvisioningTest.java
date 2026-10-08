package bd.mediwish.auth;

import bd.mediwish.auth.FirstAdminProvisioningService.Outcome;
import bd.mediwish.user.User;
import bd.mediwish.user.UserIdentifierNormalizer;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.transaction.support.TransactionOperations;
import org.springframework.web.context.support.GenericWebApplicationContext;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class FirstAdminProvisioningTest {
    private static final Instant NOW = Instant.parse("2026-09-27T10:00:00Z");
    private static final String VALID_VERIFIER =
            "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    @Mock UserRepository users;
    @Mock StaffBootstrapRepository bootstrap;
    @Mock SessionService sessions;
    @Mock SecurityAuditLog audit;
    @Mock FirstAdminProvisioningService provisioning;
    @Mock ConfigurableApplicationContext context;

    @ParameterizedTest
    @CsvSource({
            "true, true, true, BOOTSTRAP_USED", "true, false, false, BOOTSTRAP_USED",
            "false, true, true, ADMIN_EXISTS", "false, true, false, ADMIN_EXISTS",
            "false, false, false, USER_NOT_FOUND", "false, false, true, PROVISIONED"})
    void refusalsAreDecidedInAFixedOrder(boolean bootstrapUsed, boolean adminExists, boolean eligible, Outcome expected) {
        assertThat(FirstAdminProvisioningService.decide(bootstrapUsed, adminExists, eligible)).isEqualTo(expected);
    }

    @Test
    void provisioningGrantsAdminRevokesOldSessionsAndAuditsWithoutTheUsername() {
        var user = new User("owner_1", "01700000000", null, VALID_VERIFIER);
        when(users.findByUsername("owner_1")).thenReturn(Optional.of(user));
        when(bootstrap.claim(user.id(), NOW)).thenReturn(1);
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));

        assertThat(service().provision(" Owner_1 ")).isEqualTo(Outcome.PROVISIONED);

        assertThat(user.roles()).containsExactly(UserRole.ADMIN);
        assertThat(user.rolesVersion()).isZero();
        verify(users).save(user);
        verify(sessions).revokeAllForUser(user.id(), RevocationReason.STAFF_PROVISIONED);
        verify(audit).record(SecurityAuditEvent.Type.FIRST_ADMIN_PROVISIONED, user.id(), null);
    }

    @Test
    void anUnknownUserIsRefusedAndNothingIsGranted() {
        when(users.findByUsername("nobody")).thenReturn(Optional.empty());
        when(bootstrap.claim(null, NOW)).thenReturn(1);

        assertThat(service().provision("nobody")).isEqualTo(Outcome.USER_NOT_FOUND);

        verify(users, never()).save(any());
        verifyNoInteractions(sessions, audit);
    }

    @Test
    void aUsedBootstrapIsRefusedEvenWhenNoAdminRemains() {
        var user = new User("owner_1", "01700000000", null, VALID_VERIFIER);
        when(users.findByUsername("owner_1")).thenReturn(Optional.of(user));
        when(bootstrap.claim(user.id(), NOW)).thenReturn(0);

        assertThat(service().provision("owner_1")).isEqualTo(Outcome.BOOTSTRAP_USED);

        verify(users, never()).existsByRole(any());
        verifyNoInteractions(sessions, audit);
    }

    @Test
    void aBlankUsernameMeansTheRunnerDoesNothing() throws Exception {
        var exit = new AtomicInteger(-1);
        new FirstAdminProvisioning(context, provisioning, " ", exit::set).run(new DefaultApplicationArguments());

        verifyNoInteractions(provisioning);
        assertThat(exit).hasValue(-1);
    }

    @ParameterizedTest
    @EnumSource(Outcome.class)
    void theRunnerExitsZeroOnlyWhenProvisioned(Outcome outcome) throws Exception {
        when(provisioning.provision("owner_1")).thenReturn(outcome);
        var exit = new AtomicInteger(-1);

        new FirstAdminProvisioning(context, provisioning, "owner_1", exit::set).run(new DefaultApplicationArguments());

        assertThat(exit).hasValue(outcome == Outcome.PROVISIONED ? 0 : 1);
    }

    @Test
    void theRunnerRefusesToRunInsideAServingApplication() {
        try (var web = new GenericWebApplicationContext()) {
            var runner = new FirstAdminProvisioning(web, provisioning, "owner_1", code -> {});
            assertThatThrownBy(() -> runner.run(new DefaultApplicationArguments()))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageNotContaining("owner_1");
        }
        verifyNoInteractions(provisioning);
    }

    private FirstAdminProvisioningService service() {
        return new FirstAdminProvisioningService(users, bootstrap, sessions, audit, new UserIdentifierNormalizer(),
                TransactionOperations.withoutTransaction(), Clock.fixed(NOW, ZoneOffset.UTC));
    }
}

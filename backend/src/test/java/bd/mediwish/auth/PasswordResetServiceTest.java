package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.user.UserRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class PasswordResetServiceTest {
    @Test void everyConfirmationHashesTheTypedPasswordBeforeEnteringTheResetTransaction() {
        var passwords = mock(org.springframework.security.crypto.password.PasswordEncoder.class);
        var reset = mock(PasswordResetTransaction.class);
        when(passwords.encode(" new secret ")).thenReturn("synthetic-new-verifier");
        when(reset.apply("unknown@example.test", "042917", "synthetic-new-verifier"))
                .thenReturn(PasswordResetTransaction.Outcome.INVALID);
        var service = new PasswordResetService(mock(UserRepository.class), mock(EntityManager.class),
                mock(AccountCodeLimitRepository.class), new AccountCodeHasher(TestAuthSettings.properties()),
                mock(AccountCodeIssuer.class), mock(AccountMail.class), mock(SecurityAuditLog.class),
                TestAuthSettings.properties(), Clock.systemUTC(), passwords, reset);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.confirm("unknown@example.test", "042917", " new secret "))
                .isInstanceOf(CodeInvalidException.class);
        var order = inOrder(passwords, reset);
        order.verify(passwords).encode(" new secret ");
        order.verify(reset).apply("unknown@example.test", "042917", "synthetic-new-verifier");
    }

    @Test void unknownAddressesConsumeTheAddressLimitButIssueNothing() {
        Instant now = Instant.parse("2026-10-19T00:00:00Z");
        var users = mock(UserRepository.class);
        var entities = mock(EntityManager.class);
        var limits = mock(AccountCodeLimitRepository.class);
        var hasher = new AccountCodeHasher(TestAuthSettings.properties());
        var issuer = mock(AccountCodeIssuer.class);
        var mail = mock(AccountMail.class);
        var audit = mock(SecurityAuditLog.class);
        when(limits.recordAddressRequest(anyString(), eq(now), eq(now.minusSeconds(3600))))
                .thenReturn(new AccountCodeLimit("address:synthetic", now, 1, now));
        when(users.findByEmailIgnoreCase(anyString())).thenReturn(Optional.empty());
        var service = new PasswordResetService(users, entities, limits, hasher, issuer, mail, audit,
                TestAuthSettings.properties(), Clock.fixed(now, ZoneOffset.UTC),
                mock(org.springframework.security.crypto.password.PasswordEncoder.class), mock(PasswordResetTransaction.class));
        service.request("unknown@example.test");
        var ordered = inOrder(limits, users);
        ordered.verify(limits).recordAddressRequest(anyString(), eq(now), eq(now.minusSeconds(3600)));
        ordered.verify(users).findByEmailIgnoreCase(anyString());
        ordered.verify(limits).pruneBefore(now.minusSeconds(7200));
        verifyNoInteractions(entities, issuer, mail, audit);
    }
    @Test void cleanupKeepsCountersForTheLongestConfiguredWindow() {
        Instant now = Instant.parse("2026-10-19T00:00:00Z");
        var base = TestAuthSettings.properties();
        var longAddressWindow = new AuthProperties.Recovery(TestAuthSettings.RECOVERY_CODE_KEY,
                java.time.Duration.ofMinutes(15), 5, 5, java.time.Duration.ofHours(1), java.time.Duration.ofSeconds(60),
                10, java.time.Duration.ofHours(3), 5, java.time.Duration.ofHours(1));
        var properties = new AuthProperties(base.accessTokenLifetime(), base.refreshTokenLifetime(), base.issuer(),
                base.audience(), base.jwtSecret(), base.cookie(), base.mfa(), longAddressWindow);
        var limits = mock(AccountCodeLimitRepository.class);
        when(limits.recordAddressRequest(anyString(), any(), any()))
                .thenReturn(new AccountCodeLimit("address:synthetic", now, 1, now));
        var service = new PasswordResetService(mock(UserRepository.class), mock(EntityManager.class), limits,
                new AccountCodeHasher(properties), mock(AccountCodeIssuer.class), mock(AccountMail.class),
                mock(SecurityAuditLog.class), properties, Clock.fixed(now, ZoneOffset.UTC),
                mock(org.springframework.security.crypto.password.PasswordEncoder.class), mock(PasswordResetTransaction.class));
        service.request("unknown@example.test");
        verify(limits).pruneBefore(now.minusSeconds(3 * 3600));
    }

    @Test void addressLimitAndUnverifiedUsersDoNotReachIssuance() {
        var over = new RequestFixture();
        when(over.limits.recordAddressRequest(anyString(), any(), any()))
                .thenReturn(new AccountCodeLimit("address:synthetic", over.now, 11, over.now));
        over.service.request(over.user.email());
        verifyNoInteractions(over.users, over.entities, over.issuer, over.mail, over.audit);
        verify(over.limits).pruneBefore(over.now.minusSeconds(7200));
        var unverified = new RequestFixture();
        unverified.user.updateProfile(null,"unverified@example.test",null);
        unverified.service.request(unverified.user.email());
        verifyNoInteractions(unverified.entities, unverified.issuer, unverified.mail, unverified.audit);
    }

    @Test void aFailedStatementSkipsCleanupSoTheRootCauseSurfaces() {
        var f = new RequestFixture();
        var failure = new org.springframework.dao.DataAccessResourceFailureException("synthetic failure");
        when(f.issuer.issue(any(), any(), any())).thenThrow(failure);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> f.service.request(f.user.email())).isSameAs(failure);
        verify(f.limits, never()).pruneBefore(any());
    }

    @Test void refreshRechecksAddressAndVerificationBeforeIssuing() {
        var f = new RequestFixture();
        String typed = f.user.email();
        doAnswer(invocation -> {
            f.user.updateProfile(null,"changed@example.test",null);
            f.user.markEmailVerified(f.now);
            return null;
        }).when(f.entities).refresh(f.user);
        f.service.request(typed);
        verifyNoInteractions(f.issuer, f.mail, f.audit);
        verify(f.limits).pruneBefore(f.now.minusSeconds(7200));
    }

    @Test void onlyAnAdmittedIssueRegistersTheRequestAuditAndMail() {
        var limited = new RequestFixture();
        limited.service.request(limited.user.email());
        verify(limited.issuer).issue(limited.user,AccountCodePurpose.PASSWORD_RESET,limited.now);
        verifyNoInteractions(limited.mail,limited.audit);
        var f = new RequestFixture();
        when(f.issuer.issue(f.user,AccountCodePurpose.PASSWORD_RESET,f.now)).thenReturn(Optional.of("042917"));
        f.service.request(f.user.email().toUpperCase(java.util.Locale.ROOT));
        var order = inOrder(f.entities,f.issuer,f.audit,f.mail,f.limits);
        order.verify(f.entities).refresh(f.user);
        order.verify(f.issuer).issue(f.user,AccountCodePurpose.PASSWORD_RESET,f.now);
        order.verify(f.audit).record(SecurityAuditEvent.Type.PASSWORD_RESET_REQUESTED,f.user.id(),null);
        order.verify(f.mail).resetCode(eq(f.user),anyString());
        order.verify(f.limits).pruneBefore(f.now.minusSeconds(7200));
    }

    @Test void issuanceUsesTheTimeAfterTheUserLockRatherThanTheRequestStart() {
        var f = new RequestFixture();
        Instant acquired = f.now.plusSeconds(120);
        doAnswer(invocation -> {
            when(f.clock.instant()).thenReturn(acquired);
            return null;
        }).when(f.entities).refresh(f.user);
        f.service.request(f.user.email());
        verify(f.issuer).issue(f.user,AccountCodePurpose.PASSWORD_RESET,acquired);
    }

    @Test
    void requestDefersMailTransportAndNeverInvokesThePasswordEncoder() {
        var now = java.time.Instant.parse("2026-10-20T00:00:00Z");
        var user = new bd.mediwish.user.User("t7_request_path", "01700000000", "request-path@example.test",
                "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        user.markEmailVerified(now);
        var users = org.mockito.Mockito.mock(bd.mediwish.user.UserRepository.class);
        var entities = org.mockito.Mockito.mock(jakarta.persistence.EntityManager.class);
        var limits = org.mockito.Mockito.mock(AccountCodeLimitRepository.class);
        var issuer = org.mockito.Mockito.mock(AccountCodeIssuer.class);
        var audit = org.mockito.Mockito.mock(SecurityAuditLog.class);
        var passwords = org.mockito.Mockito.mock(org.springframework.security.crypto.password.PasswordEncoder.class);
        var transport = org.mockito.Mockito.mock(bd.mediwish.mail.EmailTransport.class);
        var queued = new java.util.ArrayList<Runnable>();
        org.springframework.core.task.TaskExecutor executor = queued::add;
        var messages = new org.springframework.context.support.StaticMessageSource();
        messages.addMessage("mail.passwordResetCode.subject", java.util.Locale.ENGLISH, "Reset code");
        messages.addMessage("mail.passwordResetCode.body", java.util.Locale.ENGLISH, "Your code is {0}");
        var mail = new AccountMail(messages, new bd.mediwish.mail.AfterCommitMailer(transport, executor), audit);
        var properties = bd.mediwish.testsupport.TestAuthSettings.properties();
        var clock = java.time.Clock.fixed(now, java.time.ZoneOffset.UTC);

        org.mockito.Mockito.when(limits.recordAddressRequest(org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.eq(now),
                        org.mockito.ArgumentMatchers.eq(now.minus(properties.recovery().addressWindow()))))
                .thenReturn(new AccountCodeLimit("address:synthetic", now, 1, now));
        org.mockito.Mockito.when(users.findByEmailIgnoreCase(user.email())).thenReturn(java.util.Optional.of(user));
        org.mockito.Mockito.when(users.findByIdForUpdate(user.id())).thenReturn(java.util.Optional.of(user));
        org.mockito.Mockito.when(issuer.issue(user, AccountCodePurpose.PASSWORD_RESET, now))
                .thenReturn(java.util.Optional.of("042917"));
        var service = new PasswordResetService(users, entities, limits, new AccountCodeHasher(properties),
                issuer, mail, audit, properties, clock, passwords,
                org.mockito.Mockito.mock(PasswordResetTransaction.class));

        org.assertj.core.api.Assertions.assertThat(
                org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive())
                .isFalse();
        org.springframework.transaction.support.TransactionSynchronizationManager.initSynchronization();
        try {
            service.request(user.email());

            org.mockito.Mockito.verifyNoInteractions(passwords, transport);
            var synchronizations =
                    org.springframework.transaction.support.TransactionSynchronizationManager.getSynchronizations();
            org.assertj.core.api.Assertions.assertThat(synchronizations).hasSize(1);
            synchronizations.getFirst().afterCommit();
            org.assertj.core.api.Assertions.assertThat(queued).hasSize(1);
            org.mockito.Mockito.verifyNoInteractions(passwords, transport);
        } finally {
            org.springframework.transaction.support.TransactionSynchronizationManager.clearSynchronization();
        }

        queued.getFirst().run();
        org.mockito.Mockito.verify(transport).send(org.mockito.ArgumentMatchers.any(bd.mediwish.mail.EmailMessage.class));
        org.mockito.Mockito.verifyNoInteractions(passwords);
    }

    private static class RequestFixture {
        final Instant now=Instant.parse("2026-10-19T00:00:00Z");
        final bd.mediwish.user.User user=new bd.mediwish.user.User("request_owner","01700000001","owner@example.test",
                "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        final UserRepository users=mock(UserRepository.class);
        final EntityManager entities=mock(EntityManager.class);
        final AccountCodeLimitRepository limits=mock(AccountCodeLimitRepository.class);
        final AccountCodeIssuer issuer=mock(AccountCodeIssuer.class);
        final AccountMail mail=mock(AccountMail.class);
        final SecurityAuditLog audit=mock(SecurityAuditLog.class);
        final Clock clock=mock(Clock.class);
        final PasswordResetService service=new PasswordResetService(users,entities,limits,
                new AccountCodeHasher(TestAuthSettings.properties()),issuer,mail,audit,TestAuthSettings.properties(),
                clock,mock(org.springframework.security.crypto.password.PasswordEncoder.class),
                mock(PasswordResetTransaction.class));
        RequestFixture() {
            when(clock.instant()).thenReturn(now);
            user.markEmailVerified(now);
            when(limits.recordAddressRequest(anyString(),any(),any())).thenReturn(new AccountCodeLimit("address:synthetic",now,1,now));
            when(users.findByEmailIgnoreCase(anyString())).thenReturn(Optional.of(user));
            when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        }
    }

}

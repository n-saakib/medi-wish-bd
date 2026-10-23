package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class PasswordResetTransactionTest {
    private static final Instant NOW = Instant.parse("2026-10-19T00:00:00Z");
    private static final String VERIFIER = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    @Test void aCorrectCodeChangesOnlyThePasswordAndConsumesAllCodesAndSessions() {
        var user = new User("reset_owner", "01700000001", "owner@example.test", VERIFIER);
        user.markEmailVerified(NOW);
        var users = mock(UserRepository.class);
        var entities = mock(EntityManager.class);
        var codes = mock(AccountCodeRepository.class);
        var hasher = new AccountCodeHasher(TestAuthSettings.properties());
        var sessions = mock(SessionService.class);
        var audit = mock(SecurityAuditLog.class);
        var mail = mock(AccountMail.class);
        UUID id = UUID.randomUUID();
        var code = new AccountCode(id, user.id(), AccountCodePurpose.PASSWORD_RESET,
                hasher.codeHash(AccountCodePurpose.PASSWORD_RESET, id, "042917"), user.email(), NOW, NOW.plusSeconds(900));
        when(users.findByEmailIgnoreCase(anyString())).thenReturn(Optional.of(user));
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        when(codes.findByUserIdAndPurpose(user.id(), AccountCodePurpose.PASSWORD_RESET)).thenReturn(Optional.of(code));
        var reset = new PasswordResetTransaction(users, entities, codes, hasher, sessions, audit, mail,
                TestAuthSettings.properties(), Clock.fixed(NOW, ZoneOffset.UTC));
        String replacement = VERIFIER.replace('A', 'B');
        assertThat(reset.apply(user.email(), "042917", replacement)).isEqualTo(PasswordResetTransaction.Outcome.RESET);
        assertThat(user.passwordHash().equals(replacement)).isTrue();
        assertThat(user.emailVerified()).isTrue();
        assertThat(user.profileVersion()).isZero();
        assertThat(user.role()).isEqualTo(bd.mediwish.user.UserRole.CUSTOMER);
        var order = inOrder(users, entities, codes, sessions, audit, mail);
        order.verify(users).findByEmailIgnoreCase(anyString());
        order.verify(users).findByIdForUpdate(user.id());
        order.verify(entities).refresh(user);
        order.verify(codes).findByUserIdAndPurpose(user.id(), AccountCodePurpose.PASSWORD_RESET);
        order.verify(codes).deleteByUserId(user.id());
        order.verify(sessions).revokeAllForUser(user.id(), RevocationReason.PASSWORD_RESET);
        order.verify(audit).record(SecurityAuditEvent.Type.PASSWORD_RESET_COMPLETED, user.id(), null);
        order.verify(mail).passwordChanged(user);
    }
    @Test void fiveWrongCodesAreCountedAndTheFifthVoidsOnlyTheResetCode() {
        var f = new Fixture();
        var code = f.code(f.user.email(), NOW.plusSeconds(900));
        when(f.codes.findByUserIdAndPurpose(f.user.id(), AccountCodePurpose.PASSWORD_RESET)).thenReturn(Optional.of(code));
        for (int attempt=1; attempt<=5; attempt++) {
            assertThat(f.reset.apply(f.user.email(), "111111", "unused-replacement"))
                    .isEqualTo(PasswordResetTransaction.Outcome.INVALID);
            assertThat(code.failedAttempts()).isEqualTo((short)attempt);
        }
        verify(f.audit, times(4)).record(SecurityAuditEvent.Type.ACCOUNT_CODE_FAILED, f.user.id(), null);
        verify(f.audit).record(SecurityAuditEvent.Type.ACCOUNT_CODE_LOCKED, f.user.id(), null);
        verify(f.codes).deleteByUserIdAndPurpose(f.user.id(), AccountCodePurpose.PASSWORD_RESET);
        verify(f.codes, never()).deleteByUserId(any());
        verifyNoInteractions(f.sessions, f.mail);
        assertThat(f.user.passwordHash().equals(VERIFIER)).isTrue();
    }

    @Test void expiredChangedAddressAndLockedCodesAreRemovedWithoutResettingAnything() {
        for (int kind=0; kind<3; kind++) {
            var f = new Fixture();
            var code = f.code(kind==1 ? "previous@example.test" : f.user.email(), kind==0 ? NOW : NOW.plusSeconds(900));
            if (kind==2) for(int n=0;n<5;n++) code.recordFailure();
            when(f.codes.findByUserIdAndPurpose(f.user.id(), AccountCodePurpose.PASSWORD_RESET)).thenReturn(Optional.of(code));
            assertThat(f.reset.apply(f.user.email(), "042917", "unused-replacement"))
                    .isEqualTo(PasswordResetTransaction.Outcome.INVALID);
            verify(f.codes).deleteByUserIdAndPurpose(f.user.id(), AccountCodePurpose.PASSWORD_RESET);
            verifyNoInteractions(f.sessions, f.audit, f.mail);
        }
    }

    @Test void anAddressChangedWhileWaitingForTheUserLockCannotRecoverTheNewAddress() {
        var f = new Fixture();
        String typed = f.user.email();
        doAnswer(invocation -> {
            f.user.updateProfile("Updated", "new@example.test", null);
            f.user.markEmailVerified(NOW);
            return null;
        }).when(f.entities).refresh(f.user);
        assertThat(f.reset.apply(typed, "042917", "unused-replacement"))
                .isEqualTo(PasswordResetTransaction.Outcome.INVALID);
        verifyNoInteractions(f.codes, f.sessions, f.audit, f.mail);
    }

    @Test void unknownIneligibleAndMissingCodeOutcomesHaveNoResetSideEffects() {
        var absent = new Fixture();
        when(absent.users.findByEmailIgnoreCase(anyString())).thenReturn(Optional.empty());
        assertThat(absent.reset.apply("unknown@example.test", "042917", "unused-replacement"))
                .isEqualTo(PasswordResetTransaction.Outcome.INVALID);
        verifyNoInteractions(absent.entities, absent.codes, absent.sessions, absent.audit, absent.mail);
        var unverified = new Fixture();
        unverified.user.updateProfile(null, "unverified@example.test", null);
        assertThat(unverified.reset.apply(unverified.user.email(), "042917", "unused-replacement"))
                .isEqualTo(PasswordResetTransaction.Outcome.INVALID);
        verifyNoInteractions(unverified.entities, unverified.codes, unverified.sessions, unverified.audit, unverified.mail);
        var missing = new Fixture();
        assertThat(missing.reset.apply(missing.user.email(), "042917", "unused-replacement"))
                .isEqualTo(PasswordResetTransaction.Outcome.INVALID);
        verify(missing.codes).findByUserIdAndPurpose(missing.user.id(), AccountCodePurpose.PASSWORD_RESET);
        verifyNoInteractions(missing.sessions, missing.audit, missing.mail);
    }

    private static class Fixture {
        final User user = new User("reset_owner", "01700000001", "owner@example.test", VERIFIER);
        final UserRepository users = mock(UserRepository.class);
        final EntityManager entities = mock(EntityManager.class);
        final AccountCodeRepository codes = mock(AccountCodeRepository.class);
        final AccountCodeHasher hasher = new AccountCodeHasher(TestAuthSettings.properties());
        final SessionService sessions = mock(SessionService.class);
        final SecurityAuditLog audit = mock(SecurityAuditLog.class);
        final AccountMail mail = mock(AccountMail.class);
        final PasswordResetTransaction reset = new PasswordResetTransaction(users, entities, codes, hasher,
                sessions, audit, mail, TestAuthSettings.properties(), Clock.fixed(NOW, ZoneOffset.UTC));
        Fixture() {
            user.markEmailVerified(NOW);
            when(users.findByEmailIgnoreCase(anyString())).thenReturn(Optional.of(user));
            when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        }
        AccountCode code(String address, Instant expires) {
            UUID id = UUID.randomUUID();
            return new AccountCode(id, user.id(), AccountCodePurpose.PASSWORD_RESET,
                    hasher.codeHash(AccountCodePurpose.PASSWORD_RESET,id,"042917"),address,NOW.minusSeconds(1),expires);
        }
    }

}

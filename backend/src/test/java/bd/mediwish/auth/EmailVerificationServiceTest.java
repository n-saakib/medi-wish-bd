package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.user.AccountClosingException;
import bd.mediwish.user.AccountState;
import bd.mediwish.user.EmailRequiredException;
import bd.mediwish.user.MobileChange;
import bd.mediwish.user.MobileChangeRepository;
import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class EmailVerificationServiceTest {
    private static final Instant NOW = Instant.parse("2026-10-19T00:00:00Z");
    @Mock UserRepository users;
    @Mock MobileChangeRepository mobileChanges;
    @Mock AccountCodeRepository codes;
    @Mock AccountCodeIssuer issuer;
    @Mock AccountMail mail;
    @Mock SecurityAuditLog audit;
    private AccountCodeHasher hasher;
    private User user;
    private EmailVerificationService service;

    @BeforeEach void setUp() {
        var properties = TestAuthSettings.properties();
        hasher = new AccountCodeHasher(properties);
        user = new User("verify_owner", "01700000001", "verify@example.test", "synthetic-verifier");
        service = new EmailVerificationService(users, mobileChanges, codes, issuer, hasher, mail, audit, properties,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test void requestsACodeForTheSavedUnverifiedEmailWithoutVerifyingIt() {
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        when(issuer.issue(user, AccountCodePurpose.EMAIL_VERIFICATION, NOW)).thenReturn(Optional.of("042917"));

        service.request(user.id());

        assertThat(user.emailVerified()).isFalse();
        var code = ArgumentCaptor.forClass(String.class);
        verify(mail).verificationCode(eq(user), code.capture());
        assertThat(code.getValue().equals("042917")).isTrue();
        verify(audit).record(SecurityAuditEvent.Type.EMAIL_VERIFICATION_REQUESTED, user.id(), null);
    }

    @Test void confirmsTheCurrentEmailWithoutChangingProfileVersionOrPendingMobile() {
        user.updateProfile("Synthetic Name", user.email(), java.time.LocalDate.of(2000, 1, 2));
        user.bumpProfileVersion();
        var pending = new MobileChange(user.id(), "01700000002", NOW);
        var codeId = UUID.randomUUID();
        var code = new AccountCode(codeId, user.id(), AccountCodePurpose.EMAIL_VERIFICATION,
                hasher.codeHash(AccountCodePurpose.EMAIL_VERIFICATION, codeId, "042917"), user.email(),
                NOW.minusSeconds(1), NOW.plusSeconds(899));
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        when(codes.findByUserIdAndPurpose(user.id(), AccountCodePurpose.EMAIL_VERIFICATION)).thenReturn(Optional.of(code));
        when(mobileChanges.findByUserId(user.id())).thenReturn(Optional.of(pending));
        doAnswer(invocation -> {
            // The repository flushes before clearing managed entities; verification must already be marked.
            assertThat(user.emailVerified()).isTrue();
            return 1;
        }).when(codes).deleteByUserIdAndPurpose(user.id(), AccountCodePurpose.EMAIL_VERIFICATION);

        var confirmed = service.confirm(user.id(), "042917");

        assertThat(confirmed).isNotNull();
        assertThat(confirmed.emailVerified()).isTrue();
        assertThat(confirmed.fullName()).isEqualTo("Synthetic Name");
        assertThat(confirmed.dateOfBirth()).isEqualTo(java.time.LocalDate.of(2000, 1, 2));
        assertThat(confirmed.pendingMobile()).isEqualTo(pending.newMobile());
        assertThat(confirmed.version()).isEqualTo(1);
        verify(audit).record(SecurityAuditEvent.Type.EMAIL_VERIFIED, user.id(), null);
        verify(codes, never()).deleteByUserId(user.id());
        verifyNoInteractions(issuer, mail);
    }

    @Test void missingUsersAreRefusedBeforeReadingCodesOrSendingMail() {
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.request(user.id())).isInstanceOf(AuthenticationRequiredException.class);
        assertThatThrownBy(() -> service.confirm(user.id(), "042917")).isInstanceOf(AuthenticationRequiredException.class);
        verifyNoInteractions(codes, issuer, mobileChanges, mail, audit);
    }

    @Test void aClosingAccountCannotRequestOrConfirmVerification() {
        User closing = mock(User.class);
        when(closing.accountState()).thenReturn(AccountState.CLOSURE_REQUESTED);
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(closing));
        assertThatThrownBy(() -> service.request(user.id())).isInstanceOf(AccountClosingException.class);
        assertThatThrownBy(() -> service.confirm(user.id(), "042917")).isInstanceOf(AccountClosingException.class);
        verifyNoInteractions(codes, issuer, mobileChanges, mail, audit);
    }

    @Test void anEmailIsRequiredBeforeRequestOrConfirmation() {
        user.updateProfile(null, null, null);
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        assertThatThrownBy(() -> service.request(user.id())).isInstanceOf(EmailRequiredException.class);
        assertThatThrownBy(() -> service.confirm(user.id(), "042917")).isInstanceOf(EmailRequiredException.class);
        verifyNoInteractions(codes, issuer, mobileChanges, mail, audit);
    }

    @Test void anAlreadyVerifiedEmailIsANoopAndConfirmationStillIncludesPendingMobile() {
        user.markEmailVerified(NOW);
        var pending = new MobileChange(user.id(), "01700000002", NOW);
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        when(mobileChanges.findByUserId(user.id())).thenReturn(Optional.of(pending));
        service.request(user.id());
        var result = service.confirm(user.id(), "042917");
        assertThat(result.emailVerified()).isTrue();
        assertThat(result.pendingMobile()).isEqualTo(pending.newMobile());
        assertThat(result.version()).isZero();
        verifyNoInteractions(codes, issuer, mail, audit);
    }

    @Test void aSharedIssueLimitRefusesVerificationWithoutMailOrSuccessAudit() {
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        when(issuer.issue(user, AccountCodePurpose.EMAIL_VERIFICATION, NOW)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.request(user.id())).isInstanceOf(TooManyAttemptsException.class);
        assertThat(user.emailVerified()).isFalse();
        verifyNoInteractions(mail, audit);
    }

    @Test void aMissingVerificationCodeIsInvalidAndNeverReadsTheResetPurpose() {
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        when(codes.findByUserIdAndPurpose(user.id(), AccountCodePurpose.EMAIL_VERIFICATION)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.confirm(user.id(), "042917")).isInstanceOf(CodeInvalidException.class);
        verify(codes, never()).findByUserIdAndPurpose(user.id(), AccountCodePurpose.PASSWORD_RESET);
        verify(codes, never()).deleteByUserIdAndPurpose(any(), any());
        assertThat(user.emailVerified()).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"expired", "changed-address", "locked"})
    void aStaleVerificationCodeIsDeletedWithoutVerifying(String condition) {
        givenCode(condition.equals("changed-address") ? "old@example.test" : user.email(),
                condition.equals("expired") ? NOW : NOW.plusSeconds(900), condition.equals("locked") ? 5 : 0);
        assertThatThrownBy(() -> service.confirm(user.id(), "042917")).isInstanceOf(CodeInvalidException.class);
        assertThat(user.emailVerified()).isFalse();
        verify(codes).deleteByUserIdAndPurpose(user.id(), AccountCodePurpose.EMAIL_VERIFICATION);
        verifyNoInteractions(mail, audit);
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 4})
    void aWrongCodeCountsTheAttemptAndTheFifthAttemptVoidsIt(int previousFailures) {
        var code = givenCode(user.email(), NOW.plusSeconds(900), previousFailures);
        assertThatThrownBy(() -> service.confirm(user.id(), "000000")).isInstanceOf(CodeInvalidException.class);
        assertThat(code.failedAttempts()).isEqualTo(previousFailures + 1);
        assertThat(user.emailVerified()).isFalse();
        var expected = previousFailures == 4 ? SecurityAuditEvent.Type.ACCOUNT_CODE_LOCKED : SecurityAuditEvent.Type.ACCOUNT_CODE_FAILED;
        verify(audit).record(expected, user.id(), null);
        if (previousFailures == 4) verify(codes).deleteByUserIdAndPurpose(user.id(), AccountCodePurpose.EMAIL_VERIFICATION);
        else verify(codes, never()).deleteByUserIdAndPurpose(any(), any());
        verifyNoInteractions(mail, issuer);
    }

    private AccountCode givenCode(String sentTo, Instant expiresAt, int failedAttempts) {
        var id = UUID.randomUUID();
        var code = new AccountCode(id, user.id(), AccountCodePurpose.EMAIL_VERIFICATION,
                hasher.codeHash(AccountCodePurpose.EMAIL_VERIFICATION, id, "042917"), sentTo,
                NOW.minusSeconds(1), expiresAt);
        for (int attempt = 0; attempt < failedAttempts; attempt++) code.recordFailure();
        when(users.findByIdForUpdate(user.id())).thenReturn(Optional.of(user));
        when(codes.findByUserIdAndPurpose(user.id(), AccountCodePurpose.EMAIL_VERIFICATION)).thenReturn(Optional.of(code));
        return code;
    }
}

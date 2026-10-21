package bd.mediwish.auth;

import bd.mediwish.notification.NoticeOutcome;
import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionOperations;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class StaffMfaRecoveryServiceTest {
    private static final Instant NOW = Instant.parse("2026-10-19T08:00:00Z");
    private static final byte[] SEED = "synthetic-seed-20-by".getBytes(StandardCharsets.US_ASCII);
    private static final UUID SESSION = UUID.randomUUID();
    private static final UUID NEW_SESSION = UUID.randomUUID();
    private static final String RAW_CODE = "ABCD2345";
    @Mock UserRepository users;
    @Mock StaffMfaFactorRepository factors;
    @Mock StaffMfaBackupCodeRepository codes;
    @Mock StaffMfaThrottleRepository throttles;
    @Mock SessionService sessions;
    @Mock AuthenticationService authentication;
    @Mock SecurityAuditLog audit;
    @Mock StaffReplacementNotices notices;
    @Mock PasswordEncoder passwords;

    private final User user = new User("recovery_1", "01700000000", null, "verifier");
    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    private final MfaSecretCipher cipher = new MfaSecretCipher(TestAuthSettings.properties(), new SecureRandom());
    private UUID activeId;
    private UUID pendingId;
    private StaffMfaFactor active;
    private StaffMfaFactor pending;
    private StaffMfaBackupCode backup;
    private StaffMfaThrottle throttle;
    private StaffMfaRecoveryService service;
    private boolean inTransaction;
    private final AuthenticationService.AuthenticatedSession issued = new AuthenticationService.AuthenticatedSession(
            "access-secret", 600, "refresh-secret", NOW.plusSeconds(600), null, MfaStatus.REPLACEMENT_REQUIRED);
    private TransactionOperations transactions;

    @BeforeEach
    void setUp() {
        user.replaceRole(UserRole.MODERATOR);
        active = spy(factor());
        active.activate(NOW.minusSeconds(60), Totp.step(NOW) - 1);
        clearInvocations(active);
        pending = spy(factor());
        activeId = active.id();
        pendingId = pending.id();
        backup = new StaffMfaBackupCode(UUID.randomUUID(), activeId, "verifier:" + RAW_CODE, NOW);
        throttle = new StaffMfaThrottle(user.id(), NOW);
        doReturn(Optional.of(user)).when(users).findByIdForUpdate(user.id());
        doReturn(new SessionService.MfaEvidence(null, null, null)).when(sessions).requireActive(SESSION, user.id(), NOW);
        doReturn(Optional.of(throttle)).when(throttles).findById(user.id());
        doReturn(Optional.of(activeId)).when(factors).findActiveId(user.id());
        doReturn(Optional.of(active)).when(factors).findActive(user.id());
        doReturn(Optional.of(pending)).when(factors).findPending(user.id());
        doReturn(List.of(backup)).when(codes).findByFactorIdAndConsumedAtIsNull(activeId);
        doReturn(1).when(codes).consume(backup.id(), activeId, NOW, SESSION);
        when(passwords.matches(anyString(), anyString())).thenAnswer(call -> {
            assertThat(inTransaction).as("Argon2 matching is outside the transaction").isFalse();
            return call.getArgument(1).equals("verifier:" + call.getArgument(0));
        });
        when(passwords.encode(anyString())).thenAnswer(call -> {
            assertThat(inTransaction).as("Argon2 hashing is outside the transaction").isFalse();
            return "verifier:" + call.getArgument(0);
        });
        transactions = new TransactionOperations() {
            @Override
            public <T> T execute(TransactionCallback<T> action) {
                inTransaction = true;
                try { return action.doInTransaction(new SimpleTransactionStatus()); }
                finally { inTransaction = false; }
            }
        };
        var attempts = new StaffMfaAttempts(users, sessions, throttles, cipher, audit, TestAuthSettings.properties());
        service = new StaffMfaRecoveryService(factors, codes, throttles, sessions, authentication, audit, attempts,
                notices, passwords, transactions, clock, new SecureRandom());
    }

    @Test
    void lockedThrottleRefusesBeforeAnyMatchingOrHashing() {
        lock();
        assertThatThrownBy(() -> recover()).isInstanceOf(TooManyAttemptsException.class);
        assertThatThrownBy(() -> replace(validCode())).isInstanceOf(TooManyAttemptsException.class);
        assertThatThrownBy(() -> regenerate(validCode())).isInstanceOf(TooManyAttemptsException.class);
        verifyNoInteractions(passwords, codes, sessions, users);
    }

    @Test
    void wrongCodeCountsAndAuditsTheFailureAndTheFifthFailureLocks() {
        for (int failure = 0; failure < 4; failure++) {
            assertThatThrownBy(() -> service.useBackupCode(user.id(), SESSION, "EFGH6789"))
                    .isInstanceOf(MfaCodeInvalidException.class);
            assertThat(inTransaction).isFalse();
        }
        assertThatThrownBy(() -> service.useBackupCode(user.id(), SESSION, "EFGH6789"))
                .isInstanceOf(TooManyAttemptsException.class);
        verify(audit, times(5)).record(SecurityAuditEvent.Type.MFA_RECOVERY_CODE_REJECTED, user.id(), SESSION);
        verify(audit).record(SecurityAuditEvent.Type.MFA_ATTEMPTS_LOCKED, user.id(), SESSION);
        verify(codes, never()).consume(any(), any(), any(), any());
    }

    @Test
    void aLostConsumptionRaceIsACountedWrongCode() {
        doReturn(0).when(codes).consume(backup.id(), activeId, NOW, SESSION);
        assertThatThrownBy(() -> recover()).isInstanceOf(MfaCodeInvalidException.class);
        verify(audit).record(SecurityAuditEvent.Type.MFA_RECOVERY_CODE_REJECTED, user.id(), SESSION);
        assertThat(throttle.failedCount()).isEqualTo(1);
        verify(sessions, never()).startReplacement(any(), any());
        assertThat(throttle.isLocked(NOW)).isFalse();
    }

    @Test
    void aChangedActiveFactorAfterMatchingCannotConsumeTheCode() {
        doReturn(Optional.of(activeId), Optional.of(UUID.randomUUID())).when(factors).findActiveId(user.id());
        assertThatThrownBy(() -> recover()).isInstanceOf(MfaCodeInvalidException.class);
        verify(codes, never()).consume(any(), any(), any(), any());
        verify(audit).record(SecurityAuditEvent.Type.MFA_RECOVERY_CODE_REJECTED, user.id(), SESSION);
        assertThat(throttle.failedCount()).isEqualTo(1);
    }

    @Test
    void aMissingFactorOrNoUnusedRowsIsACountedWrongCode() {
        doReturn(Optional.empty()).when(factors).findActiveId(user.id());
        assertThatThrownBy(() -> recover()).isInstanceOf(MfaCodeInvalidException.class);
        verify(codes, never()).findByFactorIdAndConsumedAtIsNull(any());
        verifyNoInteractions(passwords);
        verify(audit).record(SecurityAuditEvent.Type.MFA_RECOVERY_CODE_REJECTED, user.id(), SESSION);
    }

    @Test
    void currentRoleAndSessionAreRecheckedBeforeConsumption() {
        user.replaceRole(UserRole.CUSTOMER);
        assertThatThrownBy(() -> recover()).isInstanceOf(AccessDeniedException.class);
        user.replaceRole(UserRole.MODERATOR);
        when(sessions.requireActive(SESSION, user.id(), NOW)).thenThrow(new AuthenticationRequiredException());
        assertThatThrownBy(() -> recover()).isInstanceOf(AuthenticationRequiredException.class);
        verify(codes, never()).consume(any(), any(), any(), any());
        verify(sessions, never()).startReplacement(any(), any());
    }

    @Test
    void aThrottleLockedUnderTheUserLockPreventsConsumption() {
        when(sessions.requireActive(SESSION, user.id(), NOW)).thenAnswer(call -> {
            lock();
            return new SessionService.MfaEvidence(null, null, null);
        });
        assertThatThrownBy(() -> recover()).isInstanceOf(TooManyAttemptsException.class);
        verify(codes, never()).consume(any(), any(), any(), any());
    }

    @Test
    void successfulRecoveryChecksEveryUnusedVerifierThenStartsReplacementAndResetsFailures() {
        var other = new StaffMfaBackupCode(UUID.randomUUID(), activeId, "verifier:EFGH6789", NOW);
        doReturn(List.of(backup, other)).when(codes).findByFactorIdAndConsumedAtIsNull(activeId);
        var credential = credential(new SessionService.MfaEvidence(null, null, activeId));
        doReturn(credential).when(sessions).startReplacement(SESSION, activeId);
        doReturn(issued).when(authentication).issue(user, credential);
        failOnce();

        assertThat(recover()).isSameAs(issued);

        verify(passwords).matches(RAW_CODE, backup.codeVerifier());
        verify(passwords).matches(RAW_CODE, other.codeVerifier());
        var order = inOrder(users, sessions, codes, audit);
        order.verify(users).findByIdForUpdate(user.id());
        order.verify(sessions).requireActive(SESSION, user.id(), NOW);
        order.verify(codes).consume(backup.id(), activeId, NOW, SESSION);
        order.verify(sessions).startReplacement(SESSION, activeId);
        order.verify(audit).record(SecurityAuditEvent.Type.MFA_RECOVERY_STARTED, user.id(), NEW_SESSION);
        for (int attempt = 0; attempt < 4; attempt++) assertThat(throttle.recordFailure(NOW, 5,
                TestAuthSettings.mfa().attemptWindow(), TestAuthSettings.mfa().lockout())).isFalse();
    }

    @Test
    void replacementRejectsMissingOrDifferentBindingsAndStaleOrExpiredEnrollments() {
        replacementEvidence(UUID.randomUUID());
        assertThatThrownBy(() -> replace(validCode())).isInstanceOf(MfaEnrollmentStaleException.class);
        replacementEvidence(activeId);
        assertThatThrownBy(() -> service.verifyReplacement(user.id(), SESSION, UUID.randomUUID(), validCode()))
                .isInstanceOf(MfaEnrollmentStaleException.class);
        var expired = new StaffMfaFactor(UUID.randomUUID(), user.id(), cipher.encrypt(UUID.randomUUID(), SEED), NOW, NOW);
        doReturn(Optional.of(expired)).when(factors).findPending(user.id());
        assertThatThrownBy(() -> service.verifyReplacement(user.id(), SESSION, expired.id(), validCode()))
                .isInstanceOf(MfaEnrollmentStaleException.class);
        doReturn(Optional.empty()).when(factors).findActive(user.id());
        assertThatThrownBy(() -> replace(validCode())).isInstanceOf(MfaEnrollmentStaleException.class);
        verifyNoInteractions(notices);
        verify(active, never()).revoke(any());
    }

    @Test
    void wrongReplacementCodeIsCountedWithoutRevokingTheOldFactorOrNotifying() {
        replacementEvidence(activeId);
        assertThatThrownBy(() -> replace(wrongCode())).isInstanceOf(MfaCodeInvalidException.class);
        verify(audit).record(SecurityAuditEvent.Type.MFA_VERIFICATION_FAILED, user.id(), SESSION);
        assertThat(throttle.failedCount()).isEqualTo(1);
        verify(active, never()).revoke(any());
        verifyNoInteractions(notices);
    }

    @Test
    void replacementFlushesRevocationBeforeActivationDeletesOldCodesAndNotifiesAfterCommit() {
        replacementEvidence(activeId);
        var credential = credential(new SessionService.MfaEvidence(pendingId, NOW, null));
        doReturn(credential).when(sessions).replaceAllWithVerified(user.id(), pendingId);
        doReturn(issued).when(authentication).issue(user, credential);
        when(notices.notifyReplacement(user.id())).thenAnswer(call -> {
            assertThat(inTransaction).as("notification is after commit").isFalse();
            return NoticeOutcome.FAILED;
        });

        failOnce();
        var result = replace(validCode());
        assertThat(throttle.failedCount()).isZero();

        assertThat(result.session()).isSameAs(issued);
        assertThat(result.contactNotice()).isEqualTo(NoticeOutcome.FAILED);
        assertThat(result.backupCodes()).hasSize(10).doesNotHaveDuplicates();
        assertThat(result.toString()).isEqualTo("ReplacedSession[redacted]");
        var order = inOrder(active, factors, codes, pending, sessions, audit, notices);
        order.verify(active).revoke(NOW);
        order.verify(factors).flush();
        order.verify(codes).deleteByFactor(activeId);
        order.verify(pending).activate(NOW, Totp.step(NOW));
        order.verify(codes, times(10)).save(any(StaffMfaBackupCode.class));
        order.verify(sessions).replaceAllWithVerified(user.id(), pendingId);
        order.verify(audit).record(SecurityAuditEvent.Type.MFA_FACTOR_REPLACED, user.id(), NEW_SESSION);
        order.verify(notices).notifyReplacement(user.id());
    }

    @Test
    void regenerationRequiresVerifiedEvidenceForTheActiveFactor() {
        assertThatThrownBy(() -> regenerate(validCode())).isInstanceOf(AccessDeniedException.class);
        doReturn(new SessionService.MfaEvidence(UUID.randomUUID(), NOW, null)).when(sessions).requireActive(SESSION, user.id(), NOW);
        assertThatThrownBy(() -> regenerate(validCode())).isInstanceOf(AccessDeniedException.class);
        doReturn(new SessionService.MfaEvidence(activeId, null, null)).when(sessions).requireActive(SESSION, user.id(), NOW);
        assertThatThrownBy(() -> regenerate(validCode())).isInstanceOf(AccessDeniedException.class);
        verify(codes, never()).deleteUnusedByFactor(any());
    }

    @Test
    void regenerationRefusesAReplayedStepAndCountsTheFailure() {
        verifiedEvidence();
        active.recordUse(Totp.step(NOW));
        assertThatThrownBy(() -> regenerate(validCode())).isInstanceOf(MfaCodeInvalidException.class);
        verify(audit).record(SecurityAuditEvent.Type.MFA_VERIFICATION_FAILED, user.id(), SESSION);
        assertThat(throttle.failedCount()).isEqualTo(1);
        verify(codes, never()).deleteUnusedByFactor(any());
    }

    @Test
    void regenerationDeletesOnlyUnusedCodesBeforeSavingTenAndKeepsSessions() {
        verifiedEvidence();
        failOnce();
        var result = regenerate(validCode());
        assertThat(throttle.failedCount()).isZero();
        assertThat(result).hasSize(10).doesNotHaveDuplicates();
        var order = inOrder(active, codes, audit);
        order.verify(active).recordUse(Totp.step(NOW));
        order.verify(codes).deleteUnusedByFactor(activeId);
        order.verify(codes, times(10)).save(any(StaffMfaBackupCode.class));
        order.verify(audit).record(SecurityAuditEvent.Type.MFA_BACKUP_CODES_REGENERATED, user.id(), SESSION);
        verify(codes, never()).deleteByFactor(any());
        verify(sessions).requireActive(SESSION, user.id(), NOW);
        verifyNoMoreInteractions(sessions);
        var saved = ArgumentCaptor.forClass(StaffMfaBackupCode.class);
        verify(codes, times(10)).save(saved.capture());
        assertThat(saved.getAllValues()).extracting(StaffMfaBackupCode::codeVerifier)
                .containsExactlyElementsOf(result.stream().map(code -> "verifier:" + BackupCodes.parse(code)).toList());
    }

    @Test
    void sharedOutcomesCannotStringifySessionCredentialsOrContact() {
        var populated = new AuthenticationService.AuthenticatedSession("access-secret", 600, "refresh-secret",
                NOW.plusSeconds(600), bd.mediwish.user.UserProfile.from(user), MfaStatus.REPLACEMENT_REQUIRED);
        var outcome = new StaffMfaAttempts.Outcome(StaffMfaAttempts.Result.VERIFIED, populated);
        assertThat(outcome.toString()).doesNotContain("access-secret", "refresh-secret", user.mobile(), user.username());
    }

    @Test
    void onlyActiveFactorsCanBeRevoked() {
        assertThatThrownBy(() -> pending.revoke(NOW)).isInstanceOf(IllegalStateException.class);
        active.revoke(NOW);
        assertThatThrownBy(() -> active.revoke(NOW)).isInstanceOf(IllegalStateException.class);
    }

    private StaffMfaFactor factor() {
        UUID id = UUID.randomUUID();
        return new StaffMfaFactor(id, user.id(), cipher.encrypt(id, SEED), NOW.minusSeconds(60), NOW.plusSeconds(600));
    }
    private SessionService.SessionCredential credential(SessionService.MfaEvidence evidence) {
        return new SessionService.SessionCredential(user.id(), NEW_SESSION, "refresh", NOW.plusSeconds(600), evidence);
    }
    private void replacementEvidence(UUID factor) {
        doReturn(new SessionService.MfaEvidence(null, null, factor)).when(sessions).requireActive(SESSION, user.id(), NOW);
    }
    private void verifiedEvidence() {
        doReturn(new SessionService.MfaEvidence(activeId, NOW, null)).when(sessions).requireActive(SESSION, user.id(), NOW);
    }
    private void lock() { for (int i = 0; i < 5; i++) failOnce(); }
    private void failOnce() { throttle.recordFailure(NOW, 5, TestAuthSettings.mfa().attemptWindow(), TestAuthSettings.mfa().lockout()); }
    private String validCode() { return Totp.code(SEED, Totp.step(NOW)); }
    private String wrongCode() { return java.util.stream.IntStream.range(0, 100).mapToObj(i -> "%06d".formatted(i))
            .filter(code -> Totp.matchStep(SEED, code, NOW, -1).isEmpty()).findFirst().orElseThrow(); }
    private AuthenticationService.AuthenticatedSession recover() { return service.useBackupCode(user.id(), SESSION, RAW_CODE); }
    private StaffMfaRecoveryService.ReplacedSession replace(String code) {
        return service.verifyReplacement(user.id(), SESSION, pendingId, code);
    }
    private List<String> regenerate(String code) { return service.regenerateBackupCodes(user.id(), SESSION, code); }
}

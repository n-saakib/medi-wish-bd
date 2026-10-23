package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.user.User;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import org.bouncycastle.util.encoders.Base32;
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
import org.springframework.transaction.support.TransactionOperations;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class StaffMfaServiceTest {
    private static final Instant NOW = Instant.parse("2026-09-27T10:00:00Z");
    private static final long NOW_STEP = Totp.step(NOW);
    private static final byte[] SEED = "synthetic-seed-20-by".getBytes(StandardCharsets.US_ASCII);
    private static final String VALID_VERIFIER =
            "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    private static final UUID SESSION_ID = UUID.randomUUID();
    private static final UUID VERIFIED_SESSION_ID = UUID.randomUUID();

    @Mock UserRepository users;
    @Mock StaffMfaFactorRepository factors;
    @Mock StaffMfaBackupCodeRepository backupCodes;
    @Mock StaffMfaThrottleRepository throttles;
    @Mock SessionService sessions;
    @Mock AuthenticationService authentication;
    @Mock SecurityAuditLog audit;
    @Mock PasswordEncoder passwords;

    private final MfaSecretCipher cipher = new MfaSecretCipher(TestAuthSettings.properties(), new SecureRandom());
    private final User admin = new User("owner_1", "01700000000", null, VALID_VERIFIER);
    private final AuthenticationService.AuthenticatedSession issued = new AuthenticationService.AuthenticatedSession(
            "access", 900, "refresh", NOW.plus(Duration.ofDays(30)), null, MfaStatus.VERIFIED);
    private StaffMfaThrottle throttle;
    private StaffMfaService service;

    @BeforeEach
    void setUp() {
        admin.replaceRole(UserRole.ADMIN);
        throttle = new StaffMfaThrottle(admin.id(), NOW);
        when(users.findByIdForUpdate(admin.id())).thenReturn(Optional.of(admin));
        when(sessions.requireActive(SESSION_ID, admin.id(), NOW)).thenReturn(new SessionService.MfaEvidence(null, null, null));
        when(throttles.findById(admin.id())).thenReturn(Optional.of(throttle));
        when(factors.findActiveId(admin.id())).thenReturn(Optional.empty());
        when(passwords.encode(anyString())).thenAnswer(call -> "verifier:" + call.getArgument(0));
        var verified = new SessionService.SessionCredential(admin.id(), VERIFIED_SESSION_ID, "refresh",
                NOW.plus(Duration.ofDays(30)), new SessionService.MfaEvidence(UUID.randomUUID(), NOW, null));
        when(sessions.upgradeToMfa(any(), any())).thenReturn(verified);
        when(authentication.issue(admin, verified)).thenReturn(issued);
        var attempts = new StaffMfaAttempts(users, sessions, throttles, cipher, audit, TestAuthSettings.properties());
        service = new StaffMfaService(attempts, factors, backupCodes, throttles, sessions, authentication, audit, cipher,
                passwords, TransactionOperations.withoutTransaction(), TestAuthSettings.properties(),
                Clock.fixed(NOW, ZoneOffset.UTC), new SecureRandom());
    }

    @Test
    void startingEnrollmentReplacesThePendingFactorWithAnEncryptedSeed() {
        var enrollment = service.startEnrollment(admin.id(), SESSION_ID);

        var saved = ArgumentCaptor.forClass(StaffMfaFactor.class);
        var order = inOrder(users, factors);
        order.verify(users).findByIdForUpdate(admin.id());
        order.verify(factors).deletePending(admin.id());
        order.verify(factors).save(saved.capture());
        byte[] seed = Base32.decode(enrollment.secret());
        assertThat(saved.getValue().id()).isEqualTo(enrollment.enrollmentId());
        assertThat(cipher.decrypt(enrollment.enrollmentId(), saved.getValue().secretCiphertext(),
                saved.getValue().secretNonce())).isEqualTo(seed).hasSize(20);
        assertThat(enrollment.otpauthUri()).isEqualTo("otpauth://totp/Medi%20Wish:owner_1?secret=" + enrollment.secret()
                + "&issuer=Medi%20Wish&algorithm=SHA1&digits=6&period=30");
        assertThat(enrollment.expiresIn()).isEqualTo(600);
        verify(audit).record(SecurityAuditEvent.Type.MFA_ENROLLMENT_STARTED, admin.id(), SESSION_ID);
    }

    @Test
    void enrollmentCannotStartOverAnActiveAuthenticator() {
        when(factors.findActiveId(admin.id())).thenReturn(Optional.of(UUID.randomUUID()));

        assertThatThrownBy(() -> service.startEnrollment(admin.id(), SESSION_ID))
                .isInstanceOf(MfaEnrollmentStaleException.class);
        verify(factors, never()).save(any());
    }

    @Test
    void replacementEnrollmentRequiresBindingToTheCurrentlyActiveFactor() {
        UUID active = UUID.randomUUID();
        when(factors.findActiveId(admin.id())).thenReturn(Optional.of(active));
        when(sessions.requireActive(SESSION_ID, admin.id(), NOW))
                .thenReturn(new SessionService.MfaEvidence(null, null, UUID.randomUUID()));
        assertThatThrownBy(() -> service.startEnrollment(admin.id(), SESSION_ID)).isInstanceOf(MfaEnrollmentStaleException.class);
        when(sessions.requireActive(SESSION_ID, admin.id(), NOW))
                .thenReturn(new SessionService.MfaEvidence(null, null, active));
        var enrollment = service.startEnrollment(admin.id(), SESSION_ID);
        assertThat(enrollment.enrollmentId()).isNotNull();
        verify(factors).deletePending(admin.id());
    }

    @Test
    void aUserWhoLostTheStaffRoleCannotUseMfaRoutes() {
        var customer = new User("alice_1", "01711111111", null, VALID_VERIFIER);
        when(users.findByIdForUpdate(customer.id())).thenReturn(Optional.of(customer));

        assertThatThrownBy(() -> service.startEnrollment(customer.id(), SESSION_ID))
                .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void theRightCodeActivatesTheFactorUpgradesTheSessionAndReturnsTenBackupCodesOnce() {
        var pending = pending(NOW.plus(Duration.ofMinutes(10)));

        var enrolled = service.verifyEnrollment(admin.id(), SESSION_ID, pending.id(), Totp.code(SEED, NOW_STEP));

        assertThat(enrolled.session()).isSameAs(issued);
        assertThat(enrolled.backupCodes()).hasSize(10);
        var saved = ArgumentCaptor.forClass(StaffMfaBackupCode.class);
        verify(backupCodes, times(10)).save(saved.capture());
        verify(passwords).encode(enrolled.backupCodes().getFirst().replace("-", ""));
        assertThat(pending.lastUsedStep()).isEqualTo(NOW_STEP);
        verify(sessions).upgradeToMfa(SESSION_ID, pending.id());
        verify(audit).record(SecurityAuditEvent.Type.MFA_ENROLLMENT_ACTIVATED, admin.id(), VERIFIED_SESSION_ID);
    }

    @Test
    void aReplacementBindingCannotVerifyAsFirstEnrollmentAfterTheActiveFactorIsRevoked() {
        var pending = pending(NOW.plus(Duration.ofMinutes(10)));
        when(sessions.requireActive(SESSION_ID, admin.id(), NOW))
                .thenReturn(new SessionService.MfaEvidence(null, null, UUID.randomUUID()));

        assertThatThrownBy(() -> service.verifyEnrollment(admin.id(), SESSION_ID, pending.id(), Totp.code(SEED, NOW_STEP)))
                .isInstanceOf(MfaEnrollmentStaleException.class);

        assertThat(pending.lastUsedStep()).isEqualTo(-1);
        assertThat(throttle.failedCount()).isZero();
        verifyNoInteractions(backupCodes);
        verify(sessions, never()).upgradeToMfa(any(), any());
        var order = inOrder(users, sessions);
        order.verify(users).findByIdForUpdate(admin.id());
        order.verify(sessions).requireActive(SESSION_ID, admin.id(), NOW);
    }

    @Test
    void aStaleOrExpiredEnrollmentIsRejected() {
        var pending = pending(NOW);
        String code = Totp.code(SEED, NOW_STEP);

        assertThatThrownBy(() -> service.verifyEnrollment(admin.id(), SESSION_ID, pending.id(), code))
                .isInstanceOf(MfaEnrollmentStaleException.class);
        assertThatThrownBy(() -> service.verifyEnrollment(admin.id(), SESSION_ID, UUID.randomUUID(), code))
                .isInstanceOf(MfaEnrollmentStaleException.class);
        verify(sessions, never()).upgradeToMfa(any(), any());
    }

    @Test
    void aWrongCodeIsCountedAndTheFifthLocksVerification() {
        var pending = pending(NOW.plus(Duration.ofMinutes(10)));
        String wrong = wrongCode();

        for (int attempt = 1; attempt <= 4; attempt++) {
            assertThatThrownBy(() -> service.verifyEnrollment(admin.id(), SESSION_ID, pending.id(), wrong))
                    .isInstanceOf(MfaCodeInvalidException.class);
        }
        assertThatThrownBy(() -> service.verifyEnrollment(admin.id(), SESSION_ID, pending.id(), wrong))
                .isInstanceOf(TooManyAttemptsException.class);
        verify(audit, times(5)).record(SecurityAuditEvent.Type.MFA_VERIFICATION_FAILED, admin.id(), SESSION_ID);
        verify(audit).record(SecurityAuditEvent.Type.MFA_ATTEMPTS_LOCKED, admin.id(), SESSION_ID);

        String right = Totp.code(SEED, NOW_STEP);
        clearInvocations(passwords);
        assertThatThrownBy(() -> service.verifyEnrollment(admin.id(), SESSION_ID, pending.id(), right))
                .as("a locked User is refused even with the right code").isInstanceOf(TooManyAttemptsException.class);
        verify(sessions, never()).upgradeToMfa(any(), any());
        verifyNoInteractions(passwords);
    }

    @Test
    void verificationAcceptsACodeOnceAndReplacesTheSession() {
        var active = pending(NOW.plus(Duration.ofMinutes(10)));
        active.activate(NOW.minus(Duration.ofDays(1)), NOW_STEP - 100);
        when(factors.findActive(admin.id())).thenReturn(Optional.of(active));
        String code = Totp.code(SEED, NOW_STEP);

        assertThat(service.verify(admin.id(), SESSION_ID, code)).isSameAs(issued);
        verify(audit).record(SecurityAuditEvent.Type.MFA_VERIFIED, admin.id(), VERIFIED_SESSION_ID);
        assertThat(throttle.failedCount()).isZero();

        assertThatThrownBy(() -> service.verify(admin.id(), SESSION_ID, code))
                .as("a replayed code is a wrong code").isInstanceOf(MfaCodeInvalidException.class);
        assertThat(throttle.failedCount()).isEqualTo(1);
    }

    @Test
    void verificationWithoutAnActiveAuthenticatorIsDenied() {
        when(factors.findActive(admin.id())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.verify(admin.id(), SESSION_ID, "123456"))
                .isInstanceOf(AccessDeniedException.class);
    }

    private StaffMfaFactor pending(Instant expiresAt) {
        UUID id = UUID.randomUUID();
        var factor = new StaffMfaFactor(id, admin.id(), cipher.encrypt(id, SEED), NOW.minusSeconds(60), expiresAt);
        when(factors.findPending(admin.id())).thenReturn(Optional.of(factor));
        return factor;
    }

    /** A code that matches no step in the window. */
    private static String wrongCode() {
        for (int candidate = 0; ; candidate++) {
            String code = String.format("%06d", candidate);
            if (Totp.matchStep(SEED, code, NOW, -1).isEmpty()) return code;
        }
    }
}

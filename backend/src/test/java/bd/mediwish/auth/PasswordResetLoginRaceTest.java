package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.user.*;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import java.security.SecureRandom;
import java.time.*;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PasswordResetLoginRaceTest {
    @Test void resetBetweenPasswordProofAndSessionLockCannotCreateASession() {
        String original = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        User user = new User("proof_owner", "01700000000", null, original);
        UserRepository users = mock(UserRepository.class);
        PasswordEncoder passwords = mock(PasswordEncoder.class);
        UserSessionRepository sessions = mock(UserSessionRepository.class);
        UserSessionRefreshTokenRepository refresh = mock(UserSessionRefreshTokenRepository.class);
        AccessTokenCodec tokens = mock(AccessTokenCodec.class);
        Clock clock = Clock.fixed(Instant.parse("2026-10-19T00:00:00Z"), ZoneOffset.UTC);
        when(users.findByUsername("proof_owner")).thenReturn(Optional.of(user));
        when(users.findByIdForShare(user.id())).thenReturn(Optional.of(user));
        when(passwords.encode(anyString())).thenReturn("dummy");
        when(passwords.matches("correct-password", original)).thenAnswer(invocation -> {
            user.changePasswordHash(original.replace('A', 'B'));
            return true;
        });
        when(tokens.issue(any(), any())).thenReturn(new AccessTokenCodec.IssuedAccessToken("synthetic-access", 900));
        SessionService sessionService = new SessionService(users, sessions, refresh, TestAuthSettings.properties(), clock, new SecureRandom());
        AuthenticationService service = new AuthenticationService(users, passwords, new UserIdentifierNormalizer(),
                sessionService, tokens, mock(StaffMfaFactorRepository.class), clock);

        assertThatThrownBy(() -> service.signIn("proof_owner", "correct-password"))
                .isInstanceOf(AuthenticationFailedException.class);
        verifyNoInteractions(sessions, refresh, tokens);
    }
}

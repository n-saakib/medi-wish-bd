package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.user.User;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class AccountEmailSecurityTest {
    @Test void fiveFailuresBlockEvenTheRightPasswordUntilTheHourEndsAndSuccessResetsTheCount() {
        var limits = mock(AccountCodeLimitRepository.class);
        var rows = new HashMap<String, AccountCodeLimit>();
        when(limits.findByIdForUpdate(anyString())).thenAnswer(call -> Optional.ofNullable(rows.get(call.getArgument(0))));
        when(limits.save(any())).thenAnswer(call -> {
            AccountCodeLimit row = call.getArgument(0);
            rows.put("password:" + USER.id(), row);
            return row;
        });
        doAnswer(call -> rows.remove(call.getArgument(0))).when(limits).deleteById(anyString());
        var passwords = mock(PasswordEncoder.class);
        when(passwords.matches("correct", "encoded")).thenReturn(true);
        var clock = mock(Clock.class);
        Instant now = Instant.parse("2026-10-19T00:00:00Z");
        when(clock.instant()).thenReturn(now);
        var security = new AccountEmailSecurity(limits, mock(AccountCodeRepository.class), passwords,
                mock(AccountMail.class), mock(SessionService.class), mock(SecurityAuditLog.class),
                TestAuthSettings.properties(), clock);
        for (String wrong : new String[]{null, "", " ", "wrong", "wrong"}) {
            assertThatThrownBy(() -> security.confirmCurrentPassword(USER, wrong))
                    .isInstanceOf(CurrentPasswordInvalidException.class);
        }
        assertThatThrownBy(() -> security.confirmCurrentPassword(USER, "correct"))
                .isInstanceOf(TooManyAttemptsException.class);
        when(clock.instant()).thenReturn(now.plusSeconds(3600));
        security.confirmCurrentPassword(USER, "correct");
        for (int cycle = 0; cycle < 2; cycle++) {
            for (int wrong = 0; wrong < 4; wrong++) {
                assertThatThrownBy(() -> security.confirmCurrentPassword(USER, "wrong"))
                        .isInstanceOf(CurrentPasswordInvalidException.class);
            }
            security.confirmCurrentPassword(USER, "correct");
        }
    }

    @Test void anEmailChangeConsumesAllCodesKeepsTheCurrentSessionAndNotifiesOnlyAVerifiedOldAddress() {
        for (boolean oldVerified : new boolean[]{false,true}) {
            var codes=mock(AccountCodeRepository.class);
            var mail=mock(AccountMail.class);
            var sessions=mock(SessionService.class);
            var audit=mock(SecurityAuditLog.class);
            var currentSession=java.util.UUID.randomUUID();
            var security=new AccountEmailSecurity(mock(AccountCodeLimitRepository.class),codes,
                    mock(PasswordEncoder.class),mail,sessions,audit,TestAuthSettings.properties(),Clock.systemUTC());
            security.emailChanged(USER,"previous@example.test",oldVerified,currentSession);
            var order=inOrder(codes,audit,mail,sessions);
            order.verify(codes).deleteByUserId(USER.id());
            order.verify(audit).record(SecurityAuditEvent.Type.EMAIL_CHANGED,USER.id(),currentSession);
            if(oldVerified) order.verify(mail).emailChanged(USER.id(),"previous@example.test");
            else verifyNoInteractions(mail);
            order.verify(sessions).revokeOthersForUser(USER.id(),currentSession,RevocationReason.EMAIL_CHANGED);
        }
    }

    private static final User USER = new User("email_owner", "01700000001", "owner@example.test", "encoded");
}

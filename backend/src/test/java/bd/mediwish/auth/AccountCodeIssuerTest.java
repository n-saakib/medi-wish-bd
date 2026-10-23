package bd.mediwish.auth;

import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.user.User;
import org.junit.jupiter.api.Test;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class AccountCodeIssuerTest {
    @Test void bothPurposesShareTheGapAndHourlyBudgetAndPersistOnlyPurposeBoundVerifiers() {
        Instant now = Instant.parse("2026-10-19T00:00:00Z");
        var user = new User("issuer_owner", "01700000001", "owner@example.test", "encoded");
        var codes = mock(AccountCodeRepository.class);
        var limits = mock(AccountCodeLimitRepository.class);
        var current = new AccountCodeLimit[1];
        when(limits.findByIdForUpdate("issue:" + user.id())).thenAnswer(call -> Optional.ofNullable(current[0]));
        when(limits.save(any())).thenAnswer(call -> { current[0]=call.getArgument(0); return current[0]; });
        when(codes.saveAndFlush(any())).thenAnswer(call -> call.getArgument(0));
        var hasher = new AccountCodeHasher(TestAuthSettings.properties());
        var random = new SecureRandom() { @Override public int nextInt(int bound) { return 42917; } };
        var issuer = new AccountCodeIssuer(codes, limits, hasher, TestAuthSettings.properties(), random);
        var first = issuer.issue(user, AccountCodePurpose.EMAIL_VERIFICATION, now);
        assertThat(first.isPresent()).isTrue();
        assertThat(issuer.issue(user, AccountCodePurpose.PASSWORD_RESET, now.plusSeconds(59)).isEmpty()).isTrue();
        for (int n=1; n<5; n++) {
            assertThat(issuer.issue(user, AccountCodePurpose.PASSWORD_RESET, now.plusSeconds(n*60L)).isPresent()).isTrue();
        }
        assertThat(current[0].attempts()).isEqualTo(5);
        assertThat(issuer.issue(user, AccountCodePurpose.EMAIL_VERIFICATION, now.plusSeconds(300)).isEmpty()).isTrue();
        assertThat(current[0].attempts()).isEqualTo(5);
        assertThat(issuer.issue(user, AccountCodePurpose.PASSWORD_RESET, now.plusSeconds(3600)).isPresent()).isTrue();
        assertThat(current[0].attempts()).isEqualTo(1);
        var saved = org.mockito.ArgumentCaptor.forClass(AccountCode.class);
        verify(codes, times(6)).saveAndFlush(saved.capture());
        verify(codes, times(5)).deleteByUserIdAndPurpose(user.id(), AccountCodePurpose.PASSWORD_RESET);
        AccountCode initial = saved.getAllValues().getFirst();
        assertThat(initial.expiresAt()).isEqualTo(now.plusSeconds(900));
        assertThat(initial.codeHash().equals(first.orElseThrow())).isFalse();
        assertThat(hasher.matches(initial.purpose(), initial.id(), first.orElseThrow(), initial.codeHash())).isTrue();
        var order = inOrder(codes);
        order.verify(codes).findByUserIdAndPurpose(user.id(), AccountCodePurpose.EMAIL_VERIFICATION);
        order.verify(codes).deleteByUserIdAndPurpose(user.id(), AccountCodePurpose.EMAIL_VERIFICATION);
        order.verify(codes).saveAndFlush(any());
    }

    @Test void replacementDoesNotReuseTheCurrentSixDigitCode() {
        Instant now = Instant.parse("2026-10-19T00:00:00Z");
        var user = new User("issuer_collision", "01700000001", "collision@example.test", "encoded");
        var codes = mock(AccountCodeRepository.class);
        var limits = mock(AccountCodeLimitRepository.class);
        var hasher = new AccountCodeHasher(TestAuthSettings.properties());
        UUID previousId = UUID.fromString("00000000-0000-0000-0000-000000000123");
        String oldCode = "123456";
        var previous = new AccountCode(previousId, user.id(), AccountCodePurpose.PASSWORD_RESET,
                hasher.codeHash(AccountCodePurpose.PASSWORD_RESET, previousId, oldCode), user.email(),
                now.minusSeconds(60), now.plusSeconds(840));
        when(codes.findByUserIdAndPurpose(user.id(), AccountCodePurpose.PASSWORD_RESET))
                .thenReturn(Optional.of(previous));
        when(codes.saveAndFlush(any())).thenAnswer(call -> call.getArgument(0));
        int[] generated = {123456, 123456, 654321};
        var random = new SecureRandom() {
            private int index;
            @Override public int nextInt(int bound) { return generated[index++]; }
        };
        var issuer = new AccountCodeIssuer(codes, limits, hasher, TestAuthSettings.properties(), random);

        String replacement = issuer.issue(user, AccountCodePurpose.PASSWORD_RESET, now).orElseThrow();

        assertThat(replacement).isEqualTo("654321");
        var saved = org.mockito.ArgumentCaptor.forClass(AccountCode.class);
        verify(codes).saveAndFlush(saved.capture());
        assertThat(saved.getValue().id()).isNotEqualTo(previousId);
        assertThat(hasher.matches(AccountCodePurpose.PASSWORD_RESET, saved.getValue().id(),
                replacement, saved.getValue().codeHash())).isTrue();
        verify(codes).deleteByUserIdAndPurpose(user.id(), AccountCodePurpose.PASSWORD_RESET);
    }
}

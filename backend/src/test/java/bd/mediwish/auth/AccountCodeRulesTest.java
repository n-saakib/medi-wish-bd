package bd.mediwish.auth;

import bd.mediwish.user.AccountState;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class AccountCodeRulesTest {
    private static final java.time.Instant NOW = java.time.Instant.parse("2026-10-19T00:00:00Z");

    @Test void issuanceSharesItsWindowAndGapWhileOtherLimitsHaveIndependentThresholds() {
        var empty = (AccountCodeRules.LimitWindow) null;
        assertThat(AccountCodeRules.mayIssue(empty, NOW, 5, java.time.Duration.ofHours(1), java.time.Duration.ofSeconds(60))).isTrue();
        var five = new AccountCodeRules.LimitWindow(NOW, 5, NOW);
        assertThat(AccountCodeRules.mayIssue(five, NOW.plusSeconds(3599), 5, java.time.Duration.ofHours(1), java.time.Duration.ofSeconds(60))).isFalse();
        assertThat(AccountCodeRules.mayIssue(five, NOW.plusSeconds(3600), 5, java.time.Duration.ofHours(1), java.time.Duration.ofSeconds(60))).isTrue();
        var one = new AccountCodeRules.LimitWindow(NOW, 1, NOW);
        assertThat(AccountCodeRules.mayIssue(one, NOW.plusSeconds(59), 5, java.time.Duration.ofHours(1), java.time.Duration.ofSeconds(60))).isFalse();
        assertThat(AccountCodeRules.mayIssue(one, NOW.plusSeconds(60), 5, java.time.Duration.ofHours(1), java.time.Duration.ofSeconds(60))).isTrue();
        assertThat(AccountCodeRules.mayConfirmPassword(five, NOW, 5, java.time.Duration.ofHours(1))).isFalse();
        assertThat(AccountCodeRules.mayConfirmPassword(five, NOW.plusSeconds(3600), 5, java.time.Duration.ofHours(1))).isTrue();
    }

    @Test void codesAreAddressAndExpiryBoundAndVoidOnTheFifthWrongTry() {
        var code = new AccountCode(java.util.UUID.randomUUID(), java.util.UUID.randomUUID(), AccountCodePurpose.PASSWORD_RESET,
                "protected", "owner@example.test", NOW, NOW.plusSeconds(900));
        assertThat(AccountCodeRules.check(null, "owner@example.test", NOW, 5)).isEqualTo(AccountCodeRules.Check.MISSING);
        assertThat(AccountCodeRules.check(code, "changed@example.test", NOW, 5)).isEqualTo(AccountCodeRules.Check.ADDRESS_CHANGED);
        assertThat(AccountCodeRules.check(code, "owner@example.test", NOW.plusSeconds(900).minusNanos(1), 5)).isEqualTo(AccountCodeRules.Check.USABLE);
        assertThat(AccountCodeRules.check(code, "owner@example.test", NOW.plusSeconds(900), 5)).isEqualTo(AccountCodeRules.Check.EXPIRED);
        for (int n = 0; n < 5; n++) code.recordFailure();
        assertThat(AccountCodeRules.check(code, "owner@example.test", NOW, 5)).isEqualTo(AccountCodeRules.Check.LOCKED);
        assertThat(AccountCodeRules.afterWrongTry(4, 5)).isEqualTo(new AccountCodeRules.WrongTry(5, true));
        assertThat(AccountCodeRules.isCodeFormat("123456")).isTrue();
        for (String invalid : new String[]{null, "12345", "1234567", "12345a", "١٢٣٤٥٦", " 123456"}) {
            assertThat(AccountCodeRules.isCodeFormat(invalid)).isFalse();
        }
    }

    @Test void anHourBoundaryDoesNotPermitTwoIssuesLessThanSixtySecondsApart() {
        var window = new AccountCodeRules.LimitWindow(NOW, 5, NOW.plusSeconds(3590));
        assertThat(AccountCodeRules.mayIssue(window, NOW.plusSeconds(3600), 5, java.time.Duration.ofHours(1), java.time.Duration.ofSeconds(60))).isFalse();
        assertThat(AccountCodeRules.mayIssue(window, NOW.plusSeconds(3650), 5, java.time.Duration.ofHours(1), java.time.Duration.ofSeconds(60))).isTrue();
    }

    @Test void onlyVerifiedAccountsWithUsablePasswordsMayResetInEveryCurrentState() {
        for (AccountState state : AccountState.values()) {
            assertThat(AccountCodeRules.resetEligible(true, state, true)).isTrue();
            assertThat(AccountCodeRules.resetEligible(false, state, true)).isFalse();
            assertThat(AccountCodeRules.resetEligible(true, state, false)).isFalse();
        }
    }
}

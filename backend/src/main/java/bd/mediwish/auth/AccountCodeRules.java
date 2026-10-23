package bd.mediwish.auth;

import bd.mediwish.user.AccountState;

/** Pure account recovery eligibility and code rules. */
final class AccountCodeRules {
    private AccountCodeRules() {}

    static boolean resetEligible(boolean emailVerified, AccountState state, boolean passwordUsable) {
        return emailVerified && passwordUsable
                && (state == AccountState.ACTIVE || state == AccountState.CLOSURE_REQUESTED);
    }
    record LimitWindow(java.time.Instant windowStartedAt, int count, java.time.Instant lastAt) {}

    static boolean mayIssue(LimitWindow window, java.time.Instant now, int maximum,
                            java.time.Duration lifetime, java.time.Duration gap) {
        return withinLimit(window, now, maximum, lifetime)
                && (window == null || !now.isBefore(window.lastAt().plus(gap)));
    }

    static boolean mayConfirmPassword(LimitWindow window, java.time.Instant now,
                                      int maximum, java.time.Duration lifetime) {
        return withinLimit(window, now, maximum, lifetime);
    }

    private static boolean withinLimit(LimitWindow window, java.time.Instant now,
                                       int maximum, java.time.Duration lifetime) {
        return window == null || !now.isBefore(window.windowStartedAt().plus(lifetime))
                || window.count() < maximum;
    }
    enum Check { MISSING, EXPIRED, ADDRESS_CHANGED, LOCKED, USABLE }
    record WrongTry(int failedAttempts, boolean voided) {}

    static Check check(AccountCode code, String currentEmail,
                       java.time.Instant now, int maximumWrongTries) {
        if (code == null) return Check.MISSING;
        if (!now.isBefore(code.expiresAt())) return Check.EXPIRED;
        if (!code.sentTo().equals(currentEmail)) return Check.ADDRESS_CHANGED;
        if (code.failedAttempts() >= maximumWrongTries) return Check.LOCKED;
        return Check.USABLE;
    }

    static WrongTry afterWrongTry(int failedAttempts, int maximumWrongTries) {
        return new WrongTry(failedAttempts + 1, failedAttempts + 1 >= maximumWrongTries);
    }

    static boolean isCodeFormat(String code) {
        return code != null && code.matches("[0-9]{6}");
    }
}

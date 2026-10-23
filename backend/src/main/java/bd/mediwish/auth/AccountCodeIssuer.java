package bd.mediwish.auth;

import bd.mediwish.user.User;
import org.springframework.stereotype.Component;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/** Callers hold the User row lock; both purposes consume the same issue counter and gap. */
@Component
class AccountCodeIssuer {
    private final AccountCodeRepository codes;
    private final AccountCodeLimitRepository limits;
    private final AccountCodeHasher hasher;
    private final AuthProperties.Recovery settings;
    private final SecureRandom random;

    AccountCodeIssuer(AccountCodeRepository codes, AccountCodeLimitRepository limits, AccountCodeHasher hasher,
                      AuthProperties properties, SecureRandom random) {
        this.codes=codes; this.limits=limits; this.hasher=hasher; this.settings=properties.recovery(); this.random=random;
    }

    Optional<String> issue(User user, AccountCodePurpose purpose, Instant now) {
        String key = "issue:" + user.id();
        var previous = limits.findByIdForUpdate(key).map(AccountCodeLimit::window).orElse(null);
        if (!AccountCodeRules.mayIssue(previous, now, settings.issuesPerWindow(), settings.issueWindow(), settings.issueGap())) {
            return Optional.empty();
        }
        UUID userId = user.id();
        String email = user.email();
        var previousCode = codes.findByUserIdAndPurpose(userId, purpose).orElse(null);
        String code;
        do {
            code = String.format(Locale.ROOT, "%06d", random.nextInt(1_000_000));
        } while (previousCode != null && hasher.matches(purpose, previousCode.id(), code, previousCode.codeHash()));
        codes.deleteByUserIdAndPurpose(userId, purpose);
        UUID codeId = UUID.randomUUID();
        codes.saveAndFlush(new AccountCode(codeId, userId, purpose, hasher.codeHash(purpose, codeId, code), email,
                now, now.plus(settings.codeLifetime())));
        limits.save(AccountCodeLimit.next(key, previous, now, settings.issueWindow()));
        return Optional.of(code);
    }
}

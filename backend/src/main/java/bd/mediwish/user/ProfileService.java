package bd.mediwish.user;

import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.web.StaleUpdateException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Objects;
import java.util.UUID;

@Service
public class ProfileService {
    private static final ZoneId DHAKA = ZoneId.of("Asia/Dhaka");

    private final UserRepository users;
    private final MobileChangeRepository changes;
    private final ProfileRules rules;
    private final Clock clock;

    ProfileService(UserRepository users, MobileChangeRepository changes,
                   UserIdentifierNormalizer identifiers, Clock clock) {
        this.users = users;
        this.changes = changes;
        this.rules = new ProfileRules(identifiers);
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public ProfileView profile(UUID userId) {
        return users.findProfileById(userId).orElseThrow(AuthenticationRequiredException::new);
    }

    @Transactional
    public ProfileView update(UUID userId, ProfileEdit requested) {
        User user = users.findByIdForUpdate(userId).orElseThrow(AuthenticationRequiredException::new);
        rules.requireEditable(user.accountState());
        ProfileEdit edit = rules.validate(requested, LocalDate.now(clock.withZone(DHAKA)));
        MobileChange pending = changes.findByUserId(userId).orElse(null);
        if (Objects.equals(user.fullName(), edit.fullName()) && Objects.equals(user.email(), edit.email())
                && Objects.equals(user.dateOfBirth(), edit.dateOfBirth())) {
            return ProfileView.from(user, pending);
        }
        if (edit.version() != user.profileVersion()) throw new StaleUpdateException();
        if (edit.email() != null && users.existsByEmailIgnoreCaseAndIdNot(edit.email(), userId)) {
            throw new UserService.DuplicateUserException();
        }
        user.updateProfile(edit.fullName(), edit.email(), edit.dateOfBirth());
        user.bumpProfileVersion();
        try {
            users.flush();
        } catch (DataIntegrityViolationException exception) {
            if (UserService.isUniqueViolation(exception)) throw new UserService.DuplicateUserException();
            throw exception;
        }
        return ProfileView.from(user, pending);
    }
}

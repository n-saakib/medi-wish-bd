package bd.mediwish.user;

import bd.mediwish.auth.AuthenticationRequiredException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.UUID;

@Service
public class MobileChangeService {
    private final UserRepository users;
    private final MobileChangeRepository changes;
    private final ProfileRules rules;
    private final Clock clock;

    MobileChangeService(UserRepository users, MobileChangeRepository changes,
                        UserIdentifierNormalizer identifiers, Clock clock) {
        this.users = users;
        this.changes = changes;
        this.rules = new ProfileRules(identifiers);
        this.clock = clock;
    }

    @Transactional
    public ProfileView stage(UUID userId, String requestedMobile) {
        User user = editableUser(userId);
        String mobile = rules.stageMobile(user.mobile(), requestedMobile);
        if (users.existsByMobileAndIdNot(mobile, userId)) throw new UserService.DuplicateUserException();
        changes.deleteByUserId(userId);
        MobileChange pending = changes.saveAndFlush(new MobileChange(userId, mobile, clock.instant()));
        return ProfileView.from(user, pending);
    }

    @Transactional
    public void cancel(UUID userId) {
        editableUser(userId);
        changes.deleteByUserId(userId);
    }

    /** Only a verified OTP may call this. Ticket 61 adds the verifier and HTTP flow. */
    @Transactional
    public void activate(UUID userId, UUID changeId) {
        User user = editableUser(userId);
        MobileChange pending = changes.findByUserId(userId).orElseThrow(MobileChangeNotPendingException::new);
        if (!pending.id().equals(changeId)) throw new MobileChangeNotPendingException();
        user.activateMobile(pending.newMobile());
        try {
            changes.deleteByUserId(userId);
            users.flush();
        } catch (DataIntegrityViolationException exception) {
            if (UserService.isUniqueViolation(exception)) throw new UserService.DuplicateUserException();
            throw exception;
        }
    }

    private User editableUser(UUID userId) {
        User user = users.findByIdForUpdate(userId).orElseThrow(AuthenticationRequiredException::new);
        rules.requireEditable(user.accountState());
        return user;
    }
}

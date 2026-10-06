package bd.mediwish.user;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.SQLException;

@Service
public class UserService {
    private static final int MIN_PASSWORD_LENGTH = 6;
    private static final int MAX_PASSWORD_LENGTH = 30;

    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final UserIdentifierNormalizer identifiers;

    UserService(UserRepository users, PasswordEncoder passwords, UserIdentifierNormalizer identifiers) {
        this.users = users;
        this.passwords = passwords;
        this.identifiers = identifiers;
    }

    @Transactional
    public User register(String username, String mobile, String email, String password) {
        String normalizedUsername = identifiers.username(username);
        String normalizedMobile = identifiers.mobile(mobile);
        String normalizedEmail = identifiers.email(email);
        if (!IdentifierFormats.isUsername(normalizedUsername) || !IdentifierFormats.isMobile(normalizedMobile)
                || password == null || password.isBlank() || password.length() < MIN_PASSWORD_LENGTH
                || password.length() > MAX_PASSWORD_LENGTH
                || (normalizedEmail != null && !IdentifierFormats.isEmail(normalizedEmail))) {
            throw new InvalidRegistrationException();
        }
        if (users.existsByUsername(normalizedUsername) || users.existsByMobile(normalizedMobile)) {
            throw new DuplicateUserException();
        }
        try {
            return users.saveAndFlush(new User(normalizedUsername, normalizedMobile, normalizedEmail,
                    passwords.encode(password)));
        } catch (DataIntegrityViolationException exception) {
            if (isUniqueViolation(exception)) throw new DuplicateUserException();
            throw exception;
        }
    }

    static boolean isUniqueViolation(DataIntegrityViolationException exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql && "23505".equals(sql.getSQLState())) return true;
        }
        return false;
    }

    public static class InvalidRegistrationException extends RuntimeException {}
    public static class DuplicateUserException extends RuntimeException {}
}

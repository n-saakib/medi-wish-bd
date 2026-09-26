package bd.mediwish.user;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.SQLException;
import java.util.regex.Pattern;

@Service
public class UserService {
    private static final int MIN_PASSWORD_LENGTH = 6;
    private static final int MAX_PASSWORD_LENGTH = 30;
    private static final int MAX_MOBILE_LENGTH = 30;
    private static final int MAX_EMAIL_LENGTH = 320;
    // At least one letter, so a username cannot equal a digits-only mobile number (Ticket 03.02 A3).
    private static final Pattern USERNAME = Pattern.compile("(?=.*[a-z])[a-z0-9._-]{3,50}");
    private static final Pattern EMAIL = Pattern.compile("[^\\s@]+@[^\\s@]+");

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
        // Ticket 02 deliberately trims only; mobile format/country normalization belongs to Ticket 61.
        String normalizedMobile = identifiers.mobile(mobile);
        String normalizedEmail = identifiers.email(email);
        if (!USERNAME.matcher(normalizedUsername).matches() || normalizedMobile.isBlank()
                || normalizedMobile.length() > MAX_MOBILE_LENGTH
                || password == null || password.isBlank() || password.length() < MIN_PASSWORD_LENGTH
                || password.length() > MAX_PASSWORD_LENGTH
                || (normalizedEmail != null && (normalizedEmail.length() > MAX_EMAIL_LENGTH
                || !EMAIL.matcher(normalizedEmail).matches()))) {
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

    private static boolean isUniqueViolation(DataIntegrityViolationException exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql && "23505".equals(sql.getSQLState())) return true;
        }
        return false;
    }

    public static class InvalidRegistrationException extends RuntimeException {}
    public static class DuplicateUserException extends RuntimeException {}
}

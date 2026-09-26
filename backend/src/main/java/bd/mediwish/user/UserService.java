package bd.mediwish.user;

import org.springframework.dao.DataIntegrityViolationException;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.SQLException;

@Service
public class UserService {
    private static final int MAX_MOBILE_LENGTH = 30;
    private static final int MAX_EMAIL_LENGTH = 320;

    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final UserIdentifierNormalizer identifiers;

    public UserService(UserRepository users, PasswordEncoder passwords) {
        this(users, passwords, new UserIdentifierNormalizer());
    }

    @Autowired
    public UserService(UserRepository users, PasswordEncoder passwords, UserIdentifierNormalizer identifiers) {
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
        if (!normalizedUsername.matches("[a-z0-9._-]{3,50}") || normalizedMobile.isBlank()
                || normalizedMobile.length() > MAX_MOBILE_LENGTH
                || password == null || password.isBlank() || password.length() < 12 || password.length() > 128
                || (normalizedEmail != null && (normalizedEmail.length() > MAX_EMAIL_LENGTH
                || !normalizedEmail.matches("[^\\s@]+@[^\\s@]+")))) {
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

    private boolean isUniqueViolation(DataIntegrityViolationException exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException violation
                    && "23505".equals(violation.getSQLException().getSQLState())) return true;
            if (cause instanceof SQLException sql && "23505".equals(sql.getSQLState())) return true;
        }
        return false;
    }

    public static class InvalidRegistrationException extends RuntimeException {}
    public static class DuplicateUserException extends RuntimeException {}
}

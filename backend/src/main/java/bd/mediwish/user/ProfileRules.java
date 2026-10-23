package bd.mediwish.user;

import java.time.LocalDate;
import java.util.regex.Pattern;

/** Pure normalization and validation rules shared by profile services. */
public final class ProfileRules {
    private static final LocalDate EARLIEST_DATE_OF_BIRTH = LocalDate.of(1900, 1, 1);
    private static final Pattern CONTROL = Pattern.compile("[\\p{Cc}\\p{Zl}\\p{Zp}]");
    private static final Pattern SPACES = Pattern.compile(" +");

    private final UserIdentifierNormalizer identifiers;

    public ProfileRules(UserIdentifierNormalizer identifiers) {
        this.identifiers = identifiers;
    }

    public ProfileEdit validate(ProfileEdit edit, LocalDate today) {
        if (edit == null || edit.version() == null || edit.version() < 0) throw new InvalidProfileException("version");
        if (edit.currentPassword() != null && edit.currentPassword().length() > 128) {
            throw new InvalidProfileException("currentPassword");
        }
        String name = edit.fullName();
        if (name != null) {
            if (CONTROL.matcher(name).find()) throw new InvalidProfileException("fullName");
            name = name.trim();
            if (name.length() > 100) throw new InvalidProfileException("fullName");
            name = name.isEmpty() ? null : SPACES.matcher(name).replaceAll(" ");
        }
        String email = identifiers.email(edit.email());
        if (email != null && !IdentifierFormats.isEmail(email)) throw new InvalidProfileException("email");
        LocalDate dob = edit.dateOfBirth();
        if (dob != null && (dob.isBefore(EARLIEST_DATE_OF_BIRTH) || dob.isAfter(today))) {
            throw new InvalidProfileException("dateOfBirth");
        }
        return new ProfileEdit(name, email, dob, edit.version(), edit.currentPassword());
    }

    public String stageMobile(String currentMobile, String requested) {
        String mobile = identifiers.mobile(requested);
        if (!IdentifierFormats.isMobile(mobile) || mobile.equals(currentMobile)) {
            throw new InvalidProfileException("mobile");
        }
        return mobile;
    }

    public void requireEditable(AccountState state) {
        if (state != AccountState.ACTIVE) throw new AccountClosingException();
    }
}

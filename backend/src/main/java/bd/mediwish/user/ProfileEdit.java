package bd.mediwish.user;

import java.time.LocalDate;

/** Profile fields and optional reauthentication, supplied by the authenticated User. */
public record ProfileEdit(String fullName, String email, LocalDate dateOfBirth, Long version,
                          String currentPassword) {
    @Override
    public String toString() { return "ProfileEdit[version=" + version + "]"; }
}

package bd.mediwish.user;

import java.time.LocalDate;

/** The four editable profile fields supplied by an authenticated User. */
public record ProfileEdit(String fullName, String email, LocalDate dateOfBirth, Long version) {}

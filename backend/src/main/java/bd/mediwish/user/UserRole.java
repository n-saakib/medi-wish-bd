package bd.mediwish.user;

public enum UserRole {
    CUSTOMER,
    ADMIN,
    MODERATOR,
    DELIVERY_PERSON;

    /** Admin and Moderator must pass staff MFA before their role applies (ADR-0019). */
    public boolean isStaff() {
        return this == ADMIN || this == MODERATOR;
    }
}

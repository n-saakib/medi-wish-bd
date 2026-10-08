package bd.mediwish.user;

public enum UserRole {
    CUSTOMER(0),
    DELIVERY_PERSON(1),
    MODERATOR(2),
    ADMIN(3);

    private final int rank;
    UserRole(int rank) { this.rank = rank; }
    public int rank() { return rank; }
    /** A role has every permission of the roles below it. */
    public boolean includes(UserRole requiredRole) { return rank >= requiredRole.rank; }
    /** Admin and Moderator require staff MFA; DeliveryPerson does not. */
    public boolean isStaff() { return this == ADMIN || this == MODERATOR; }
}

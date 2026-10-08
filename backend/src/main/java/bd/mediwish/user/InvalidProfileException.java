package bd.mediwish.user;

/** A profile field failed validation; the rejected value is intentionally not retained. */
public final class InvalidProfileException extends RuntimeException {
    private final String field;

    public InvalidProfileException(String field) {
        this.field = field;
    }

    public String field() { return field; }
}

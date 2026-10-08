package bd.mediwish.catalog;

/** A bounded invalid-field outcome; the field name is never returned in the ordinary error envelope. */
public final class InvalidCatalogException extends RuntimeException {
    private final String field;

    public InvalidCatalogException(String field) {
        this.field = field;
    }

    public String field() { return field; }
}

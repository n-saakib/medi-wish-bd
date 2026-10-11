package bd.mediwish.address;

public final class InvalidAddressException extends RuntimeException {
    private final String field;
    public InvalidAddressException(String field) { this.field = field; }
    public String field() { return field; }
}

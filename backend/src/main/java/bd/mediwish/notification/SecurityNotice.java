package bd.mediwish.notification;

/** A private delivery payload; never include its fields in diagnostics. */
public record SecurityNotice(String mobile, String text) {
    @Override public String toString() { return "SecurityNotice[redacted]"; }
}

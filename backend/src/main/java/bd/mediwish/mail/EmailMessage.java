package bd.mediwish.mail;

/** Transient mail payload. Diagnostics deliberately expose only its nonsecret kind. */
public record EmailMessage(String to, String subject, String body, EmailKind kind) {
    @Override
    public String toString() { return "EmailMessage[kind=" + kind + "]"; }
}

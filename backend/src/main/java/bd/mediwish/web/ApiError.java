package bd.mediwish.web;

/** Every API error code with its HTTP status and its messages.properties key, {@code error.<CODE>}. */
enum ApiError {
    INVALID_REQUEST(400),
    AUTHENTICATION_FAILED(401),
    AUTHENTICATION_REQUIRED(401),
    MFA_CODE_INVALID(400),
    ACCESS_DENIED(403),
    MFA_REQUIRED(403),
    NOT_FOUND(404),
    METHOD_NOT_ALLOWED(405),
    DUPLICATE_USER(409),
    ACCOUNT_CLOSING(409),
    MFA_ENROLLMENT_STALE(409),
    STALE_UPDATE(409),
    PRICE_REQUIRED(409),
    CATEGORY_NAME_TAKEN(409),
    ID_CONFLICT(409),
    ROLE_CHANGE_REFUSED(409),
    ADDRESS_BOOK_FULL(409),
    ADDRESS_CHANGE_LIMIT_REACHED(409),
    TOO_MANY_ATTEMPTS(429),
    INTERNAL_ERROR(500);

    final int status;
    final String messageKey;

    ApiError(int status) {
        this.status = status;
        this.messageKey = "error." + name();
    }

    /** Classifies a framework error status; any other 4xx is an invalid request. */
    static ApiError forStatus(int status) {
        return switch (status) {
            case 401 -> AUTHENTICATION_REQUIRED;
            case 403 -> ACCESS_DENIED;
            case 404 -> NOT_FOUND;
            case 405 -> METHOD_NOT_ALLOWED;
            case 429 -> TOO_MANY_ATTEMPTS;
            default -> status < 500 ? INVALID_REQUEST : INTERNAL_ERROR;
        };
    }
}

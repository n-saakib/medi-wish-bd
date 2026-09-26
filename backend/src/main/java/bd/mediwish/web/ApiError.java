package bd.mediwish.web;

/** Every API error code with its HTTP status and its messages.properties key, {@code error.<CODE>}. */
enum ApiError {
    INVALID_REQUEST(400),
    AUTHENTICATION_FAILED(401),
    AUTHENTICATION_REQUIRED(401),
    ACCESS_DENIED(403),
    NOT_FOUND(404),
    METHOD_NOT_ALLOWED(405),
    DUPLICATE_USER(409),
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
            default -> status < 500 ? INVALID_REQUEST : INTERNAL_ERROR;
        };
    }
}

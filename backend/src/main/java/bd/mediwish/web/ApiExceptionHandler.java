package bd.mediwish.web;

import bd.mediwish.auth.AuthenticationFailedException;
import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.auth.InvalidRequestException;
import bd.mediwish.user.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.transaction.TransactionException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Maps the domain exceptions of every controller to the error envelope. Handling unreadable JSON and
 * persistence failures here also keeps their messages, which can echo request or row values, out of the log.
 */
@RestControllerAdvice
class ApiExceptionHandler {
    private final ApiErrors errors;

    ApiExceptionHandler(ApiErrors errors) {
        this.errors = errors;
    }

    @ExceptionHandler({InvalidRequestException.class, UserService.InvalidRegistrationException.class,
            HttpMessageNotReadableException.class})
    ResponseEntity<ApiErrors.Body> invalidRequest(HttpServletRequest request) {
        return error(ApiError.INVALID_REQUEST, request);
    }

    @ExceptionHandler(UserService.DuplicateUserException.class)
    ResponseEntity<ApiErrors.Body> duplicateUser(HttpServletRequest request) {
        return error(ApiError.DUPLICATE_USER, request);
    }

    @ExceptionHandler(AuthenticationFailedException.class)
    ResponseEntity<ApiErrors.Body> authenticationFailed(HttpServletRequest request) {
        return error(ApiError.AUTHENTICATION_FAILED, request);
    }

    @ExceptionHandler(AuthenticationRequiredException.class)
    ResponseEntity<ApiErrors.Body> authenticationRequired(HttpServletRequest request) {
        return error(ApiError.AUTHENTICATION_REQUIRED, request);
    }

    @ExceptionHandler({DataAccessException.class, TransactionException.class})
    ResponseEntity<ApiErrors.Body> persistenceFailure(HttpServletRequest request) {
        return error(ApiError.INTERNAL_ERROR, request);
    }

    private ResponseEntity<ApiErrors.Body> error(ApiError error, HttpServletRequest request) {
        return ResponseEntity.status(error.status).body(errors.body(error, request));
    }
}

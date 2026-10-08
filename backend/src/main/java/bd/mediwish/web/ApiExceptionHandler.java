package bd.mediwish.web;

import bd.mediwish.auth.AuthenticationFailedException;
import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.auth.InvalidRequestException;
import bd.mediwish.auth.MfaCodeInvalidException;
import bd.mediwish.auth.MfaEnrollmentStaleException;
import bd.mediwish.auth.TooManyAttemptsException;
import bd.mediwish.user.UserService;
import bd.mediwish.catalog.InvalidCatalogException;
import bd.mediwish.catalog.InvalidMoneyException;
import bd.mediwish.catalog.CatalogAccessDeniedException;
import bd.mediwish.catalog.CatalogNotFoundException;
import bd.mediwish.catalog.PriceRequiredException;
import bd.mediwish.catalog.CategoryNameTakenException;
import bd.mediwish.catalog.IdConflictException;
import org.hibernate.exception.ConstraintViolationException;
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
            HttpMessageNotReadableException.class, InvalidCatalogException.class, InvalidMoneyException.class})
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

    @ExceptionHandler(MfaCodeInvalidException.class)
    ResponseEntity<ApiErrors.Body> mfaCodeInvalid(HttpServletRequest request) {
        return error(ApiError.MFA_CODE_INVALID, request);
    }

    @ExceptionHandler(MfaEnrollmentStaleException.class)
    ResponseEntity<ApiErrors.Body> mfaEnrollmentStale(HttpServletRequest request) {
        return error(ApiError.MFA_ENROLLMENT_STALE, request);
    }

    @ExceptionHandler(TooManyAttemptsException.class)
    ResponseEntity<ApiErrors.Body> tooManyAttempts(HttpServletRequest request) {
        return error(ApiError.TOO_MANY_ATTEMPTS, request);
    }

    @ExceptionHandler(CatalogAccessDeniedException.class)
    ResponseEntity<ApiErrors.Body> catalogAccessDenied(HttpServletRequest request) {
        return error(ApiError.ACCESS_DENIED, request);
    }

    @ExceptionHandler(CatalogNotFoundException.class)
    ResponseEntity<ApiErrors.Body> catalogNotFound(HttpServletRequest request) {
        return error(ApiError.NOT_FOUND, request);
    }

    @ExceptionHandler(StaleUpdateException.class)
    ResponseEntity<ApiErrors.Body> staleUpdate(HttpServletRequest request) {
        return error(ApiError.STALE_UPDATE, request);
    }

    @ExceptionHandler(PriceRequiredException.class)
    ResponseEntity<ApiErrors.Body> priceRequired(HttpServletRequest request) {
        return error(ApiError.PRICE_REQUIRED, request);
    }

    @ExceptionHandler(CategoryNameTakenException.class)
    ResponseEntity<ApiErrors.Body> categoryNameTaken(HttpServletRequest request) {
        return error(ApiError.CATEGORY_NAME_TAKEN, request);
    }

    @ExceptionHandler(IdConflictException.class)
    ResponseEntity<ApiErrors.Body> idConflict(HttpServletRequest request) {
        return error(ApiError.ID_CONFLICT, request);
    }

    @ExceptionHandler({DataAccessException.class, TransactionException.class})
    ResponseEntity<ApiErrors.Body> persistenceFailure(Exception failure, HttpServletRequest request) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException violation
                    && "23505".equals(violation.getSQLState())
                    && "uk_product_categories_name".equals(violation.getConstraintName())) {
                return error(ApiError.CATEGORY_NAME_TAKEN, request);
            }
        }
        return error(ApiError.INTERNAL_ERROR, request);
    }

    private ResponseEntity<ApiErrors.Body> error(ApiError error, HttpServletRequest request) {
        return ResponseEntity.status(error.status).body(errors.body(error, request));
    }
}

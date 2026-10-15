package bd.mediwish.web;

import bd.mediwish.address.*;
import bd.mediwish.auth.AuthenticationFailedException;
import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.auth.InvalidRequestException;
import bd.mediwish.auth.MfaCodeInvalidException;
import bd.mediwish.auth.MfaEnrollmentStaleException;
import bd.mediwish.auth.TooManyAttemptsException;
import bd.mediwish.auth.RoleChangeRefusedException;
import bd.mediwish.auth.UserNotFoundException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import bd.mediwish.user.UserService;
import bd.mediwish.catalog.InvalidCatalogException;
import bd.mediwish.catalog.InvalidMoneyException;
import bd.mediwish.catalog.CatalogAccessDeniedException;
import bd.mediwish.catalog.CatalogNotFoundException;
import bd.mediwish.catalog.PriceRequiredException;
import bd.mediwish.catalog.CategoryNameTakenException;
import bd.mediwish.catalog.IdConflictException;
import bd.mediwish.catalog.InvalidImageException;
import bd.mediwish.catalog.ImageLimitReachedException;
import bd.mediwish.storage.StorageUnavailableException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import bd.mediwish.catalog.DiscountEndedException;
import bd.mediwish.catalog.DiscountExceedsPriceException;
import org.hibernate.exception.ConstraintViolationException;
import bd.mediwish.user.InvalidProfileException;
import bd.mediwish.user.AccountClosingException;
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
            HttpMessageNotReadableException.class, InvalidProfileException.class, InvalidCatalogException.class,
            InvalidMoneyException.class})
    ResponseEntity<ApiErrors.Body> invalidRequest(HttpServletRequest request) {
        return error(ApiError.INVALID_REQUEST, request);
    }

    @ExceptionHandler(AccountClosingException.class)
    ResponseEntity<ApiErrors.Body> accountClosing(HttpServletRequest request) {
        return error(ApiError.ACCOUNT_CLOSING, request);
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

    @ExceptionHandler(PriceRequiredException.class)
    ResponseEntity<ApiErrors.Body> priceRequired(HttpServletRequest request) {
        return error(ApiError.PRICE_REQUIRED, request);
    }

    @ExceptionHandler(CategoryNameTakenException.class)
    ResponseEntity<ApiErrors.Body> categoryNameTaken(HttpServletRequest request) {
        return error(ApiError.CATEGORY_NAME_TAKEN, request);
    }

    @ExceptionHandler(DiscountEndedException.class)
    ResponseEntity<ApiErrors.Body> discountEnded(HttpServletRequest request) {
        return error(ApiError.DISCOUNT_ENDED, request);
    }

    @ExceptionHandler(DiscountExceedsPriceException.class)
    ResponseEntity<ApiErrors.Body> discountExceedsPrice(HttpServletRequest request) {
        return error(ApiError.DISCOUNT_EXCEEDS_PRICE, request);
    }

    @ExceptionHandler(IdConflictException.class)
    ResponseEntity<ApiErrors.Body> idConflict(HttpServletRequest request) {
        return error(ApiError.ID_CONFLICT, request);
    }

    @ExceptionHandler(InvalidImageException.class)
    ResponseEntity<ApiErrors.Body> invalidImage(HttpServletRequest request) { return error(ApiError.IMAGE_INVALID, request); }
    @ExceptionHandler(ImageLimitReachedException.class)
    ResponseEntity<ApiErrors.Body> imageLimit(HttpServletRequest request) { return error(ApiError.IMAGE_LIMIT_REACHED, request); }
    @ExceptionHandler(StorageUnavailableException.class)
    ResponseEntity<ApiErrors.Body> storageUnavailable(HttpServletRequest request) { return error(ApiError.STORAGE_UNAVAILABLE, request); }
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<ApiErrors.Body> uploadSize(HttpServletRequest request) {
        boolean imageUpload = request.getMethod().equals("POST") && request.getRequestURI().matches(
                "/api/staff/products/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/images");
        return error(imageUpload ? ApiError.IMAGE_INVALID : ApiError.INVALID_REQUEST, request);
    }
    @ExceptionHandler({MultipartException.class, MissingServletRequestPartException.class})
    ResponseEntity<ApiErrors.Body> malformedMultipart(HttpServletRequest request) { return error(ApiError.INVALID_REQUEST, request); }

    @ExceptionHandler({DataAccessException.class, TransactionException.class})
    ResponseEntity<ApiErrors.Body> persistenceFailure(Exception failure, HttpServletRequest request) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException orderViolation
                    && "23505".equals(orderViolation.getSQLState())
                    && "uk_product_images_order".equals(orderViolation.getConstraintName())) {
                return error(ApiError.STALE_UPDATE, request);
            }
            if (cause instanceof ConstraintViolationException violation
                    && "23505".equals(violation.getSQLState())
                    && "uk_product_categories_name".equals(violation.getConstraintName())) {
                return error(ApiError.CATEGORY_NAME_TAKEN, request);
            }
        }
        return error(ApiError.INTERNAL_ERROR, request);
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ApiErrors.Body> unsupportedMedia(HttpServletRequest request) {
        // Ticket 08 freezes non-JSON admin commands as 400; existing credential routes retain their 415 contract.
        int status = request.getRequestURI().startsWith("/api/admin/users/") ? 400 : 415;
        return ResponseEntity.status(status).body(errors.body(ApiError.INVALID_REQUEST, request));
    }

    @ExceptionHandler(StaleUpdateException.class)
    ResponseEntity<ApiErrors.Body> staleUpdate(HttpServletRequest request) { return error(ApiError.STALE_UPDATE, request); }

    @ExceptionHandler(RoleChangeRefusedException.class)
    ResponseEntity<ApiErrors.Body> refusedRole(HttpServletRequest request) { return error(ApiError.ROLE_CHANGE_REFUSED, request); }

    @ExceptionHandler(UserNotFoundException.class)
    ResponseEntity<ApiErrors.Body> userNotFound(HttpServletRequest request) { return error(ApiError.NOT_FOUND, request); }

    @ExceptionHandler(InvalidAddressException.class)
    ResponseEntity<ApiErrors.Body> invalidAddress(HttpServletRequest request) { return error(ApiError.INVALID_REQUEST, request); }

    @ExceptionHandler(AddressNotFoundException.class)
    ResponseEntity<ApiErrors.Body> addressNotFound(HttpServletRequest request) { return error(ApiError.NOT_FOUND, request); }

    @ExceptionHandler(AddressBookFullException.class)
    ResponseEntity<ApiErrors.Body> addressBookFull(HttpServletRequest request) { return error(ApiError.ADDRESS_BOOK_FULL, request); }

    @ExceptionHandler(AddressIdConflictException.class)
    ResponseEntity<ApiErrors.Body> addressIdConflict(HttpServletRequest request) { return error(ApiError.ID_CONFLICT, request); }

    @ExceptionHandler(AddressChangeLimitException.class)
    ResponseEntity<ApiErrors.Body> addressChangeLimit(HttpServletRequest request) { return error(ApiError.ADDRESS_CHANGE_LIMIT_REACHED, request); }

    private ResponseEntity<ApiErrors.Body> error(ApiError error, HttpServletRequest request) {
        return ResponseEntity.status(error.status).body(errors.body(error, request));
    }
}

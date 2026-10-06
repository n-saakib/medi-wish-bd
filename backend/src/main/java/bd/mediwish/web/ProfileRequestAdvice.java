package bd.mediwish.web;

import bd.mediwish.user.ProfileController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Profile non-JSON bodies are 400; older controllers retain their 415 contract. */
@RestControllerAdvice(assignableTypes = ProfileController.class)
class ProfileRequestAdvice {
    private final ApiErrors errors;
    ProfileRequestAdvice(ApiErrors errors) { this.errors = errors; }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ApiErrors.Body> unsupportedMediaType(HttpServletRequest request) {
        return ResponseEntity.badRequest().body(errors.body(ApiError.INVALID_REQUEST, request));
    }
}

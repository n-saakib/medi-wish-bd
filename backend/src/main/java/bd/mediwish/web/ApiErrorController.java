package bd.mediwish.web;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.webmvc.error.ErrorController;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class ApiErrorController implements ErrorController {
    private final ApiErrors errors;

    ApiErrorController(ApiErrors errors) { this.errors = errors; }

    @RequestMapping("/error")
    ResponseEntity<ApiErrors.Body> error(HttpServletRequest request) {
        Object value = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
        int status = value instanceof Integer code && code >= 400 && code <= 599 ? code : 500;
        return ResponseEntity.status(status).body(errors.body(ApiError.forStatus(status), request));
    }
}

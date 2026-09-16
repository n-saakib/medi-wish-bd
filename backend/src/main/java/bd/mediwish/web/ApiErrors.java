package bd.mediwish.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.MessageSource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.Locale;

@Component
public class ApiErrors {
    private final MessageSource messages;
    private final ObjectMapper json;

    public ApiErrors(MessageSource messages, ObjectMapper json) {
        this.messages = messages;
        this.json = json;
    }

    public record Body(String code, String message, String requestId) {}

    public Body body(int status, HttpServletRequest request) {
        String code = switch (status) {
            case 400 -> "INVALID_REQUEST";
            case 401 -> "AUTHENTICATION_REQUIRED";
            case 403 -> "ACCESS_DENIED";
            case 404 -> "NOT_FOUND";
            case 405 -> "METHOD_NOT_ALLOWED";
            default -> "INTERNAL_ERROR";
        };
        return new Body(code, messages.getMessage("error." + code, null, Locale.ENGLISH),
                (String) request.getAttribute("requestId"));
    }

    public void write(int status, HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setHeader("Cache-Control", "no-store");
        json.writeValue(response.getOutputStream(), body(status, request));
    }
}

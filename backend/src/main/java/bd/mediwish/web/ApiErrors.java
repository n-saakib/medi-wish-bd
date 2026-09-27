package bd.mediwish.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.MessageSource;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import tools.jackson.core.StreamWriteFeature;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.Locale;

/** Builds the bounded error envelope for controllers, filters and the error page. */
@Component
class ApiErrors {
    private final MessageSource messages;
    private final ObjectMapper json;

    ApiErrors(MessageSource messages, ObjectMapper json) {
        this.messages = messages;
        this.json = json;
    }

    record Body(ApiError code, String message, String requestId) {}

    Body body(ApiError error, HttpServletRequest request) {
        return new Body(error, messages.getMessage(error.messageKey, null, Locale.ENGLISH),
                (String) request.getAttribute("requestId"));
    }

    void write(ApiError error, HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setStatus(error.status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        // Closing the stream would complete the response before the filters around this one finish, so the
        // container completes it only after the whole chain, including the request's status log, has run.
        json.writer().without(StreamWriteFeature.AUTO_CLOSE_TARGET)
                .writeValue(response.getOutputStream(), body(error, request));
    }
}

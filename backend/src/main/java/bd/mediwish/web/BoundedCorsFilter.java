package bd.mediwish.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.CorsFilter;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.CorsProcessor;
import org.springframework.web.cors.DefaultCorsProcessor;
import org.springframework.web.util.ContentCachingResponseWrapper;

import java.io.IOException;

/** Keeps Spring's CORS policy while replacing framework rejection text with the API envelope. */
final class BoundedCorsFilter extends CorsFilter {
    BoundedCorsFilter(CorsConfigurationSource source, ApiErrors errors) {
        super(source);
        setCorsProcessor(new BoundedCorsProcessor(errors));
    }

    private static final class BoundedCorsProcessor implements CorsProcessor {
        private final ApiErrors errors;
        private final DefaultCorsProcessor delegate = new DefaultCorsProcessor();

        private BoundedCorsProcessor(ApiErrors errors) {
            this.errors = errors;
        }

        @Override
        public boolean processRequest(org.springframework.web.cors.CorsConfiguration configuration,
                                      HttpServletRequest request, HttpServletResponse response)
                throws IOException {
            var buffered = new ContentCachingResponseWrapper(response);
            boolean accepted = delegate.processRequest(configuration, request, buffered);
            if (accepted) {
                buffered.copyBodyToResponse();
                return true;
            }
            if (!response.isCommitted()) {
                buffered.resetBuffer();
                errors.write(ApiError.ACCESS_DENIED, request, response);
            }
            return false;
        }
    }
}

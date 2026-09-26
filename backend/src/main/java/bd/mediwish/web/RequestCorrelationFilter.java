package bd.mediwish.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestCorrelationFilter extends OncePerRequestFilter {
    private static final String REQUEST_ID_ATTRIBUTE = "requestId";
    private static final String STATUS_LOGGED_ATTRIBUTE = RequestCorrelationFilter.class.getName() + ".statusLogged";
    private static final Logger LOGGER = LoggerFactory.getLogger(RequestCorrelationFilter.class);

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var id = requestId(request);
        setResponseHeaders(response, id);
        String previousRequestId = MDC.get("requestId");
        MDC.put("requestId", id);
        boolean completed = false;
        try {
            chain.doFilter(request, response);
            completed = true;
        } finally {
            try {
                if (completed) logResponseStatusOnce(request, response);
            } finally {
                if (previousRequestId == null) MDC.remove("requestId");
                else MDC.put("requestId", previousRequestId);
            }
        }
    }

    @Override
    protected boolean shouldNotFilterErrorDispatch() {
        return false;
    }

    @Override
    protected void doFilterNestedErrorDispatch(HttpServletRequest request, HttpServletResponse response,
                                               FilterChain chain) throws ServletException, IOException {
        setResponseHeaders(response, requestId(request));
        chain.doFilter(request, response);
        logResponseStatusOnce(request, response);
    }

    private static String requestId(HttpServletRequest request) {
        Object existing = request.getAttribute(REQUEST_ID_ATTRIBUTE);
        if (existing instanceof String id) return id;
        String id = UUID.randomUUID().toString();
        request.setAttribute(REQUEST_ID_ATTRIBUTE, id);
        return id;
    }

    private static void setResponseHeaders(HttpServletResponse response, String id) {
        response.setHeader("X-Request-ID", id);
        response.setHeader("Cache-Control", "no-store");
    }

    private static void logResponseStatusOnce(HttpServletRequest request, HttpServletResponse response) {
        if (Boolean.TRUE.equals(request.getAttribute(STATUS_LOGGED_ATTRIBUTE))) return;
        request.setAttribute(STATUS_LOGGED_ATTRIBUTE, true);
        // Deliberately exclude URLs, queries, headers and request/response bodies.
        LOGGER.info("HTTP response status={}", response.getStatus());
    }
}

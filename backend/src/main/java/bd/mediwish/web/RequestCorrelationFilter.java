package bd.mediwish.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;
import java.util.UUID;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestCorrelationFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var supplied = Collections.list(request.getHeaders("X-Request-ID"));
        var id = supplied.size() == 1 && supplied.getFirst().matches("[A-Za-z0-9_-]{1,64}")
                ? supplied.getFirst() : UUID.randomUUID().toString();
        request.setAttribute("requestId", id);
        response.setHeader("X-Request-ID", id);
        response.setHeader("Cache-Control", "no-store");
        MDC.put("requestId", id);
        try {
            chain.doFilter(request, response);
        } finally {
            // Deliberately exclude URLs, queries, headers and request/response bodies.
            LoggerFactory.getLogger(RequestCorrelationFilter.class).info("HTTP response status={}", response.getStatus());
            MDC.remove("requestId");
        }
    }
}

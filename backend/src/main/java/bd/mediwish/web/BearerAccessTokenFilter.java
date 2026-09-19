package bd.mediwish.web;

import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.auth.CurrentUserAuthentication;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;
import java.util.List;

/** Converts one verified bearer access token into the current persisted User principal. */
@Component
public final class BearerAccessTokenFilter extends OncePerRequestFilter {
    private static final int MAX_TOKEN_LENGTH = 4096;

    private final CurrentUserAuthentication currentUsers;
    private final ApiErrors errors;

    public BearerAccessTokenFilter(CurrentUserAuthentication currentUsers, ApiErrors errors) {
        this.currentUsers = currentUsers;
        this.errors = errors;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        List<String> authorization = Collections.list(request.getHeaders("Authorization"));
        if (authorization.isEmpty()) {
            chain.doFilter(request, response);
            return;
        }
        if (authorization.size() != 1) {
            reject(request, response);
            return;
        }

        String header = authorization.getFirst();
        if (!header.regionMatches(true, 0, "Bearer ", 0, 7)) {
            // Basic and every other scheme are deliberately left unauthenticated.
            chain.doFilter(request, response);
            return;
        }
        String token = header.substring(7).trim();
        if (token.isEmpty() || token.length() > MAX_TOKEN_LENGTH) {
            reject(request, response);
            return;
        }

        try {
            var current = currentUsers.authenticate(token);
            var authorities = current.roles().stream()
                    .map(role -> new SimpleGrantedAuthority("ROLE_" + role.name()))
                    .toList();
            var authentication = new UsernamePasswordAuthenticationToken(current, null, authorities);
            SecurityContextHolder.getContext().setAuthentication(authentication);
            chain.doFilter(request, response);
        } catch (AuthenticationRequiredException exception) {
            reject(request, response);
        }
    }

    private void reject(HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setHeader("WWW-Authenticate", "Bearer");
        errors.write(HttpServletResponse.SC_UNAUTHORIZED, request, response);
    }
}

package bd.mediwish.web;

import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.auth.CurrentUserAuthentication;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.dao.DataAccessException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.transaction.TransactionException;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;
import java.util.List;

/** On the protected routes, converts one verified Bearer access token into the current persisted User principal. */
final class BearerAccessTokenFilter extends OncePerRequestFilter {
    private final RequestMatcher protectedRoutes;
    private final CurrentUserAuthentication currentUsers;
    private final ApiErrors errors;

    BearerAccessTokenFilter(RequestMatcher protectedRoutes, CurrentUserAuthentication currentUsers, ApiErrors errors) {
        this.protectedRoutes = protectedRoutes;
        this.currentUsers = currentUsers;
        this.errors = errors;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !protectedRoutes.matches(request);
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
        CurrentUserAuthentication.CurrentUser current;
        try {
            current = currentUsers.authenticate(header.substring(7).trim());
        } catch (AuthenticationRequiredException exception) {
            reject(request, response);
            return;
        } catch (DataAccessException | TransactionException exception) {
            errors.write(ApiError.INTERNAL_ERROR, request, response);
            return;
        }

        // StaffAccessPolicy decided these: role authorities, or only an MFA authority for a restricted staff session.
        var authorities = current.authorities().stream().map(SimpleGrantedAuthority::new).toList();
        var authentication = new UsernamePasswordAuthenticationToken(current, null, authorities);
        SecurityContextHolder.getContext().setAuthentication(authentication);
        chain.doFilter(request, response);
    }

    private void reject(HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setHeader("WWW-Authenticate", "Bearer");
        errors.write(ApiError.AUTHENTICATION_REQUIRED, request, response);
    }
}

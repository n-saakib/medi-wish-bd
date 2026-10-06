# `SecurityConfiguration.java`

Source: [SecurityConfiguration.java](../../../../../../../src/main/java/bd/mediwish/web/SecurityConfiguration.java)

Stateless servlet security boundary. Hosted cookies must be Secure, and hosted credentialed CORS must list explicit origins. Only exclusively local/test profiles allow insecure cookies and loopback fallback origins. Allowed CORS methods are GET, POST, PUT, HEAD and OPTIONS; allowed headers are Authorization, Content-Type and X-XSRF-TOKEN.

The static RoleHierarchy bean declares ADMIN > MODERATOR > DELIVERY_PERSON > CUSTOMER. Spring Security 7.1.1 automatically supplies it to its authorization-manager factory. Staff/profile routes use their minimum role; restricted MFA authorities are outside this hierarchy.

ADMIN_USER_SEARCH (POST /api/admin/users/search), ADMIN_USER_DETAIL (GET /api/admin/users/*) and ADMIN_ROLE_CHANGE (PUT /api/admin/users/*/roles) join PROTECTED_ROUTES and require ADMIN. Search and role changes form BEARER_COMMAND_ROUTES: CSRF-exempt because a cross-site page cannot supply the in-memory Bearer header, and subject to the shared 16 KiB JSON limit. Credentials and MFA commands retain their exemptions/limits; refresh and logout still require the cookie CSRF token.

BoundedCorsFilter runs before the security context, followed by the JSON limiter; BearerAccessTokenFilter resolves protected routes after LogoutFilter. Missing authentication is 401; restricted staff denial is MFA_REQUIRED, otherwise ACCESS_DENIED. RequestCorrelationFilter adds correlation/no-store headers. The whole configuration is servlet-conditional, so offline first-Admin provisioning has no web-security beans.

Focused security/filter tests cover profile settings, CORS, hierarchy, matchers and body limits; real authentication and role tests cover actor authorization and preflight.

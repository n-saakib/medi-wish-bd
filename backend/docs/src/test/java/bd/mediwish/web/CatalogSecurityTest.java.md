# CatalogSecurityTest

Executes the production Spring Security filter chain with mocked current-user resolution and a probe HTTP controller. Covers all eight catalog routes for anonymous, Admin-only, Moderator-only, Customer-only, DeliveryPerson-only and both restricted MFA states. Checks bearer challenge, bounded codes, correlation and no-store. Bearer commands need no CSRF token. Oversized Moderator pricing remains 403; allowed commands reject 17 KiB JSON before MVC. PUT preflight accepts the local frontend origin without authentication.

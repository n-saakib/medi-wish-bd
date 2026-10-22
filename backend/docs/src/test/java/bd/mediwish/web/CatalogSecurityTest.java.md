# CatalogSecurityTest

Executes the production Spring Security filter chain with mocked current-user resolution and a probe HTTP controller. Covers all eight catalog routes for anonymous, Admin-only, Moderator-only, Customer-only, DeliveryPerson-only and both restricted MFA states. Checks bearer challenge, bounded codes, correlation and no-store. Bearer commands need no CSRF token. Oversized Moderator pricing remains 403; allowed commands reject 17 KiB JSON before MVC. PUT preflight accepts the local frontend origin without authentication.


Ticket 15 extends the production filter-chain actor matrix to all five staff image routes. JSON image edits are body-limited only after authorization, multipart avoids the JSON limit, and public image GET/HEAD are allowed while POST/PUT/DELETE are denied both without and with valid CSRF cookies.

Ticket 17 exercises the production filter chain for each public catalog GET with no token and an invalid Bearer header, and checks that POST at those paths remains denied. The probe controller is synthetic; the catalog controller and database tests check payload and read-model behavior.

Verified 2026-10-12 on working changes over 7555e2d: focused Maven unit invocation passed 60 tests with no failures or skips, including ProductImageServiceTest. Evidence: .scratch/ticket15-implementation-20261012/t4-units.log. Full integration/browser acceptance remains separate.

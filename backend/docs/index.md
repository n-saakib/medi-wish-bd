# Backend code documentation

This directory mirrors the checked-in backend build and source tree. Each page documents one source file or build file and is kept beside the same relative path under `docs`:

- `pom.xml` is documented by [`pom.xml.md`](pom.xml.md).
- `src/main` contains runtime code, configuration, migrations and messages.
- `src/test` contains unit, integration, compatibility and safety tests.

The source files remain the executable source of truth. A mirrored page records the current purpose, behavior, reasoning, use cases and test boundary for that file. When a source file changes, update its matching page in the same change. The Maven wrapper and generated `target/` output are build tooling or generated artifacts, so they are outside this source mirror.

## Architecture maps

| Map | Documentation |
| --- | --- |
| Database architecture | [`db-architecture.md`](db-architecture.md) |
| Backend code architecture | [`code-architecture.md`](code-architecture.md) |

## Runtime map

| Area | Documentation |
| --- | --- |
| Application entry point | [`src/main/java/bd/mediwish/MediWishApplication.java.md`](src/main/java/bd/mediwish/MediWishApplication.java.md) |
| Shared HTTP errors | [`src/main/java/bd/mediwish/web/ApiErrors.java.md`](src/main/java/bd/mediwish/web/ApiErrors.java.md), [`ApiErrorController.java.md`](src/main/java/bd/mediwish/web/ApiErrorController.java.md) |
| Request tracing | [`src/main/java/bd/mediwish/web/RequestCorrelationFilter.java.md`](src/main/java/bd/mediwish/web/RequestCorrelationFilter.java.md) |
| HTTP security adapters | [`src/main/java/bd/mediwish/web/SecurityConfiguration.java.md`](src/main/java/bd/mediwish/web/SecurityConfiguration.java.md), [`BearerAccessTokenFilter.java.md`](src/main/java/bd/mediwish/web/BearerAccessTokenFilter.java.md), [`BoundedCorsFilter.java.md`](src/main/java/bd/mediwish/web/BoundedCorsFilter.java.md), [`AuthenticationJsonBodyLimitFilter.java.md`](src/main/java/bd/mediwish/web/AuthenticationJsonBodyLimitFilter.java.md), [`RefreshCookieAdapter.java.md`](src/main/java/bd/mediwish/web/RefreshCookieAdapter.java.md) |
| Shared User roles and profile | [`src/main/java/bd/mediwish/user/User.java.md`](src/main/java/bd/mediwish/user/User.java.md), [`UserRole.java.md`](src/main/java/bd/mediwish/user/UserRole.java.md), [`UserService.java.md`](src/main/java/bd/mediwish/user/UserService.java.md), [`UserRepository.java.md`](src/main/java/bd/mediwish/user/UserRepository.java.md), [`UserIdentifierNormalizer.java.md`](src/main/java/bd/mediwish/user/UserIdentifierNormalizer.java.md), [`UserController.java.md`](src/main/java/bd/mediwish/user/UserController.java.md) |
| Ticket 03 auth core and HTTP contract | [`src/main/java/bd/mediwish/auth/AuthController.java.md`](src/main/java/bd/mediwish/auth/AuthController.java.md), [`AccessTokenCodec.java.md`](src/main/java/bd/mediwish/auth/AccessTokenCodec.java.md), [`AuthCoreConfiguration.java.md`](src/main/java/bd/mediwish/auth/AuthCoreConfiguration.java.md), [`AuthProperties.java.md`](src/main/java/bd/mediwish/auth/AuthProperties.java.md), [`AuthenticationFailedException.java.md`](src/main/java/bd/mediwish/auth/AuthenticationFailedException.java.md), [`AuthenticationRequiredException.java.md`](src/main/java/bd/mediwish/auth/AuthenticationRequiredException.java.md), [`AuthenticationService.java.md`](src/main/java/bd/mediwish/auth/AuthenticationService.java.md), [`CurrentUserAuthentication.java.md`](src/main/java/bd/mediwish/auth/CurrentUserAuthentication.java.md), [`InvalidAccessTokenException.java.md`](src/main/java/bd/mediwish/auth/InvalidAccessTokenException.java.md), [`JwtAccessTokenCodec.java.md`](src/main/java/bd/mediwish/auth/JwtAccessTokenCodec.java.md), [`PasswordVerifierPolicy.java.md`](src/main/java/bd/mediwish/auth/PasswordVerifierPolicy.java.md), [`RefreshTokenHasher.java.md`](src/main/java/bd/mediwish/auth/RefreshTokenHasher.java.md), [`SessionReplayException.java.md`](src/main/java/bd/mediwish/auth/SessionReplayException.java.md), [`SessionService.java.md`](src/main/java/bd/mediwish/auth/SessionService.java.md), [`UserSession.java.md`](src/main/java/bd/mediwish/auth/UserSession.java.md), [`UserSessionRefreshToken.java.md`](src/main/java/bd/mediwish/auth/UserSessionRefreshToken.java.md), [`UserSessionRefreshTokenRepository.java.md`](src/main/java/bd/mediwish/auth/UserSessionRefreshTokenRepository.java.md), [`UserSessionRepository.java.md`](src/main/java/bd/mediwish/auth/UserSessionRepository.java.md) |
| Runtime configuration | [`src/main/resources/application.yaml.md`](src/main/resources/application.yaml.md) |
| Local backend environment template | [`.env.example.md`](.env.example.md) |
| Database migrations, shared User and case-insensitive email lookup index | [`src/main/resources/db/changelog/db.changelog-master.yaml.md`](src/main/resources/db/changelog/db.changelog-master.yaml.md) |
| Public error messages | [`src/main/resources/messages.properties.md`](src/main/resources/messages.properties.md) |

## Test map

| Boundary | Documentation |
| --- | --- |
| Health and restart behavior, including denied-route error bounds, redaction and request correlation | [`HealthIT.java.md`](src/test/java/bd/mediwish/health/HealthIT.java.md) |
| Test database isolation and role safety | [`TestDatabase.java.md`](src/test/java/bd/mediwish/health/TestDatabase.java.md), [`TestDatabaseGuardTest.java.md`](src/test/java/bd/mediwish/health/TestDatabaseGuardTest.java.md) — reports safe database, version, role and privilege guard failures separately |
| Connection-loss simulation | [`DisconnectableTcpProxy.java.md`](src/test/java/bd/mediwish/health/DisconnectableTcpProxy.java.md), [`DisconnectableTcpProxyTest.java.md`](src/test/java/bd/mediwish/health/DisconnectableTcpProxyTest.java.md) |
| Configuration privacy | [`ConfigurationIT.java.md`](src/test/java/bd/mediwish/health/ConfigurationIT.java.md) |
| Optional dependency compatibility | [`DependencyCompatibilityIT.java.md`](src/test/java/bd/mediwish/compatibility/DependencyCompatibilityIT.java.md) |
| Error contract | [`ApiErrorsTest.java.md`](src/test/java/bd/mediwish/web/ApiErrorsTest.java.md) — bounded API errors plus simulated 404/500 `DispatcherType.ERROR` requests through standalone MockMvc; embedded-server routing remains unverified |
| Shared User registration rules | [`UserServiceTest.java.md`](src/test/java/bd/mediwish/user/UserServiceTest.java.md) — isolated username, password (including preservation of meaningful whitespace), mobile and optional-email boundaries |
| Ticket 03 auth-core unit seams | [`auth/AuthenticationServiceTest.java.md`](src/test/java/bd/mediwish/auth/AuthenticationServiceTest.java.md), [`auth/CurrentUserAuthenticationTest.java.md`](src/test/java/bd/mediwish/auth/CurrentUserAuthenticationTest.java.md), [`auth/JwtAccessTokenCodecTest.java.md`](src/test/java/bd/mediwish/auth/JwtAccessTokenCodecTest.java.md), [`auth/PasswordVerifierPolicyTest.java.md`](src/test/java/bd/mediwish/auth/PasswordVerifierPolicyTest.java.md), [`auth/RefreshTokenHasherTest.java.md`](src/test/java/bd/mediwish/auth/RefreshTokenHasherTest.java.md), [`auth/SessionServiceTest.java.md`](src/test/java/bd/mediwish/auth/SessionServiceTest.java.md), [`auth/UserIdentifierNormalizerTest.java.md`](src/test/java/bd/mediwish/auth/UserIdentifierNormalizerTest.java.md) — case-insensitive bounded email candidate resolution, current-role status, credential-state validation and multi-family revocation seams |
| Auth and User HTTP contracts | [`auth/AuthControllerTest.java.md`](src/test/java/bd/mediwish/auth/AuthControllerTest.java.md) — bounded invalid-registration error, login length boundaries and auth/session contracts; [`UserControllerTest.java.md`](src/test/java/bd/mediwish/user/UserControllerTest.java.md) |
| Shared User PostgreSQL and bearer journey | [`UserIT.java.md`](src/test/java/bd/mediwish/user/UserIT.java.md) — duplicate registration and synchronized username/mobile uniqueness races |
| Populated legacy Customer migration | [`LegacyUserMigrationIT.java.md`](src/test/java/bd/mediwish/user/LegacyUserMigrationIT.java.md) — applies the real changelog through `003`, upgrades with `004+`, preserves mixed-case email values and historical Argon2 verifiers, and verifies Customer-role backfill, email login and profile access |
| Ticket 03 auth-session PostgreSQL journey | [`auth/AuthIT.java.md`](src/test/java/bd/mediwish/auth/AuthIT.java.md) — bounded duplicate-email resolution, current identity/family revocation, rollback/response-loss recovery, order/payment/guest/request-ID no-session checks, CSRF/origin rejection and captured ECS privacy |
| Ticket 03 on-wire response-loss helper | [`auth/ResponseDroppingTcpProxy.java.md`](src/test/java/bd/mediwish/auth/ResponseDroppingTcpProxy.java.md), [`auth/ResponseDroppingTcpProxyTest.java.md`](src/test/java/bd/mediwish/auth/ResponseDroppingTcpProxyTest.java.md) — loopback-only HTTP proxy that observes upstream headers and forwards no response bytes, with a DB-free local socket test |
| Ticket 03 persisted-role authorization | [`auth/Ticket03AuthorizationIT.java.md`](src/test/java/bd/mediwish/auth/Ticket03AuthorizationIT.java.md), [`web/Ticket03RoleAuthorizationTestConfiguration.java.md`](src/test/java/bd/mediwish/web/Ticket03RoleAuthorizationTestConfiguration.java.md) — real bearer/current-role 401/403/200 behavior through a test-only protected rule, with no production role route |
| Ticket 03 session restart durability | [`auth/SessionRestartIT.java.md`](src/test/java/bd/mediwish/auth/SessionRestartIT.java.md) |
| Refresh-cookie tampering, valid-shaped guesses, logout race and family revocation | [`auth/ConcurrentRefreshIT.java.md`](src/test/java/bd/mediwish/auth/ConcurrentRefreshIT.java.md) |
| Password, CSRF/CORS, bearer policy and authentication request bounds | [`SecurityConfigurationTest.java.md`](src/test/java/bd/mediwish/web/SecurityConfigurationTest.java.md), [`BearerAccessTokenFilterTest.java.md`](src/test/java/bd/mediwish/web/BearerAccessTokenFilterTest.java.md), [`Ticket03SecurityBoundaryTest.java.md`](src/test/java/bd/mediwish/web/Ticket03SecurityBoundaryTest.java.md) |
| Ticket 03 cookie-expiry and security-boundary regressions | [`auth/AuthControllerTest.java.md`](src/test/java/bd/mediwish/auth/AuthControllerTest.java.md), [`Ticket03SecurityBoundaryTest.java.md`](src/test/java/bd/mediwish/web/Ticket03SecurityBoundaryTest.java.md) |
| Request correlation | [`RequestCorrelationFilterTest.java.md`](src/test/java/bd/mediwish/web/RequestCorrelationFilterTest.java.md) — one server-generated UUID across normal and ERROR dispatches; one final status event, no premature 200, and no caller-supplied ID reflection |

Local commands, environment rules and dependency research are maintained in the repository's agent runbooks when those local-only files are present; the mirrored pages above document the behavior that the source tree itself guarantees.

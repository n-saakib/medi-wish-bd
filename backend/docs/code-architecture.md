# Backend code architecture

This is the living code map for the current Spring Boot backend. Source files
remain authoritative; this page records package ownership, dependency
direction and the observable request boundaries.

**Last reviewed:** 2026-09-25
**Current scope:** health baseline, shared User profile/roles, and Ticket 03
password sessions with Bearer, CSRF, CORS and refresh-cookie adapters.
**Next boundary:** supported-browser session journey evidence. OTP, recovery,
MFA and deployment remain later boundaries.

## Package and dependency diagram

```mermaid
flowchart LR
    BOOT[MediWishApplication<br/>Spring Boot entry point]

    subgraph USER[bd.mediwish.user — shared User feature]
        UC[UserController<br/>GET /api/user/me]
        IDS[UserIdentifierNormalizer<br/>shared identifier policy]
        US[UserService<br/>validation, normalization,<br/>Argon2 registration, uniqueness]
        UR[UserRepository<br/>Spring Data JPA]
        UE[User<br/>users mapping + role collection]
        ROLE[UserRole<br/>CUSTOMER / ADMIN /<br/>MODERATOR / DELIVERY_PERSON]
    end

    subgraph AUTH[bd.mediwish.auth — Ticket 03 core]
        AC[AuthController<br/>register/login/csrf/refresh/logout]
        AS[AuthenticationService<br/>candidate resolution, session issue,<br/>atomic multi-family logout]
        SS[SessionService<br/>family rotation/revocation/locking]
        AT[AccessTokenCodec<br/>JJWT adapter behind interface]
        CU[CurrentUserAuthentication<br/>session + current User/roles]
        PV[PasswordVerifierPolicy<br/>bounded persisted verifier rule]
        SE[UserSession + refresh generations]
    end

    subgraph WEB[bd.mediwish.web — HTTP security adapters]
        SEC[SecurityConfiguration<br/>Bearer, CSRF, credentialed CORS,<br/>stateless authorization]
        BF[BearerAccessTokenFilter<br/>current User and roles]
        CORS[BoundedCorsFilter<br/>shared rejected-CORS envelope]
        BODY[AuthenticationJsonBodyLimitFilter<br/>16 KiB auth JSON ceiling]
        RC[RefreshCookieAdapter<br/>HttpOnly scoped cookie]
        ERR[ApiErrors<br/>bounded externalized envelope]
        ERRCTRL[ApiErrorController<br/>/error fallback]
        CORR[RequestCorrelationFilter<br/>request ID + no-store]
    end

    CONFIG[application.yaml<br/>Datasource, auth, CORS]
    LIQ[Liquibase<br/>versioned schema migrations]
    DB[(PostgreSQL 18)]
    MSG[messages.properties<br/>English backend messages]

    BOOT --> USER
    BOOT --> AUTH
    BOOT --> WEB
    AC -->|register| US
    AC -->|login / refresh / logout| AS
    UC -->|current principal profile| CU
    US -->|persist and query| UR
    UR --> UE
    UE --> ROLE
    US --> IDS
    AS --> IDS
    AS --> SS
    AS --> AT
    CU --> AT
    CU --> SS
    CU --> UR
    CU --> PV
    AS --> PV
    SS --> SE
    SE --> DB
    SEC --> BF
    SEC --> CORS
    SEC --> BODY
    SEC --> RC
    SEC --> PV
    BF --> CU
    AC --> RC
    AC --> ERR
    UC --> ERR
    ERRCTRL --> ERR
    CORR -.->|wraps every request| AC
    CORR -.->|wraps every request| UC
    ERR --> MSG
    CONFIG --> SEC
    CONFIG --> LIQ
    LIQ --> DB
    UR -->|JPA/Hibernate| DB
```

### Dependency rules

- `bd.mediwish.user` owns the shared User aggregate, role collection and safe
  profile projection. `bd.mediwish.auth` owns the authentication routes and
  registration credential boundary; `UserController` owns only `/api/user/me`.
- `bd.mediwish.web` consumes T2 interfaces. It must not parse JWTs, hash
  refresh values, lock session rows or call auth repositories directly.
- `AuthController` depends on the shared `RefreshCookieAdapter` only to read,
  set and clear the HTTP-only refresh cookie; the cookie adapter does not
  depend on the controller or authentication services.
- `CurrentUserAuthentication` is the only current-session/User handoff used by
  the bearer filter. Roles are loaded from the current User, never from JWT
  claims.
- `RefreshCookieAdapter` owns cookie flags and path. The raw refresh value is
  not returned in JSON, logged or placed in a URL.
- `PasswordVerifierPolicy` owns bounded persisted-verifier validation without
  password matching or credential logging. Current-user loading and refresh
  fail closed when the policy rejects stored state.
- `ApiErrors` remains the bounded `{ code, message, requestId }` projection;
  auth responses also use `Cache-Control: no-store`.
- `BoundedCorsFilter` reuses `SecurityConfiguration`'s single CORS source and
  converts rejected-origin responses to that envelope.
- `AuthenticationJsonBodyLimitFilter` applies a 16 KiB ceiling only to login
  and registration JSON before MVC deserialization.
- Liquibase owns schema evolution; JPA validates the PostgreSQL schema.

## Current request flows

### Registration and password session

`AuthController` exposes the fixed `/api/auth` routes. Registration and login
are public and CSRF-exempt because they do not authenticate with a cookie.
Refresh and logout require the CSRF header and read only the scoped refresh
cookie. The security chain applies the narrow auth-body limit before controller
deserialization and applies CORS policy before authorization. The controller
delegates sign-in, rotation and revocation to T2.

Logout revokes all distinct refresh-cookie families within one service
transaction. If any revocation fails, the transaction rolls back as a unit and
the controller does not clear the cookie as if logout had succeeded.

### Authenticated profile

```mermaid
sequenceDiagram
    participant B as Browser / API client
    participant S as SecurityFilterChain
    participant F as BearerAccessTokenFilter
    participant C as CurrentUserAuthentication
    participant U as UserController

    B->>S: GET /api/user/me + Bearer access token
    S->>F: run after LogoutFilter
    F->>C: verify token and active session
    C->>C: load current User and persisted roles
    alt valid current session
        F-->>S: current principal and authorities
        S-->>U: authenticated request
        U-->>B: safe Profile projection
    else invalid, expired or revoked
        S-->>B: bounded 401 Bearer challenge
    end
```

## Cross-cutting boundaries

| Boundary | Current implementation | Maintained by |
| --- | --- | --- |
| Startup | Spring Boot, JPA, Liquibase and fail-closed auth configuration validation. | `MediWishApplication`, `application.yaml`, `SecurityConfiguration` |
| Authentication | Fixed-HS256 access JWTs and opaque refresh families from T2; Bearer and cookie serialization at the web edge. | `bd.mediwish.auth`, `BearerAccessTokenFilter`, `RefreshCookieAdapter` |
| Authorization | `/api/user/me` requires any current authenticated User; persisted roles are reloaded into authorities for role-aware consumers, but no current route requires a specific role. Unknown routes are denied. | `SecurityConfiguration`, `UserController`, `UserRole` |
| CSRF/CORS | Cookie CSRF with `XSRF-TOKEN`/`X-XSRF-TOKEN`, explicit credentialed origins and no wildcard origin; only local/dev/test profiles may use loopback fallback and rejected origins use the bounded error envelope. | `SecurityConfiguration`, `BoundedCorsFilter` |
| Error contract | Externalized English message plus bounded code/request ID and `no-store`. | `ApiErrors`, controllers, security handlers |
| Correlation/privacy | One bounded `X-Request-ID`; logs contain status and correlation only. | `RequestCorrelationFilter` |
| Database | PostgreSQL 18; Liquibase migrations; Hibernate validation only. | `db.changelog-master.yaml`, JPA mappings |

Update this page when a backend package, route, adapter, persistence boundary,
authentication transport or authorization rule changes. Do not diagram planned
OTP, recovery, MFA, catalog or order behavior as implemented.

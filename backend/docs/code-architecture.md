# Backend code architecture

This is the living code map for the current Spring Boot backend. The source
tree remains authoritative; this page explains package ownership, dependency
direction and the observable request paths.

**Last reviewed:** 2026-09-18<br/>
**Current scope:** health baseline plus the Ticket 02 shared User resource,
simple HTTP Basic authentication and role-based authorization.<br/>
**Next boundary:** Ticket 03 replaces the credential transport with the planned
JWT/session design while retaining the shared User identity/profile boundary.

## Package and dependency diagram

```mermaid
flowchart LR
    BOOT[MediWishApplication<br/>Spring Boot entry point]

    subgraph USER[bd.mediwish.user — shared User feature]
        UC[UserController<br/>POST /api/auth/register<br/>GET /api/user/me]
        US[UserService<br/>validation, normalization,<br/>Argon2 registration, uniqueness]
        UR[UserRepository<br/>Spring Data JPA]
        UE[User<br/>users mapping + role collection]
        ROLE[UserRole<br/>CUSTOMER / ADMIN /<br/>MODERATOR / DELIVERY_PERSON]
    end

    subgraph WEB[bd.mediwish.web — shared HTTP concerns]
        SEC[SecurityConfiguration<br/>HTTP Basic, stateless chain,<br/>CORS and RBAC]
        ERR[ApiErrors<br/>bounded externalized envelope]
        ERRCTRL[ApiErrorController<br/>/error fallback]
        CORR[RequestCorrelationFilter<br/>request ID + no-store]
    end

    CONFIG[application.yaml<br/>Datasource, JPA, Liquibase, CORS]
    LIQ[Liquibase<br/>versioned schema migrations]
    DB[(PostgreSQL 18)]
    MSG[messages.properties<br/>English backend messages]

    BOOT --> USER
    BOOT --> WEB
    UC -->|register / profile| US
    UC -->|authenticated profile lookup| UR
    US -->|persist and query| UR
    UR --> UE
    UE --> ROLE
    SEC -->|load normalized username<br/>and current roles| UR
    SEC -->|normalization seam<br/>currently UserService| US
    SEC --> ERR
    UC --> ERR
    ERRCTRL --> ERR
    CORR -.->|wraps every request| UC
    CORR -.->|correlates errors| ERR
    ERR --> MSG
    CONFIG --> SEC
    CONFIG --> LIQ
    LIQ --> DB
    UR -->|JPA/Hibernate| DB
```

### Dependency rules

- `bd.mediwish.user` owns the shared User aggregate, its role collection,
  registration policy, persistence interface and current User-shaped routes.
  Customer, Admin, Moderator and DeliveryPerson are roles, not separate
  identity packages.
- `bd.mediwish.web` owns cross-cutting HTTP behavior. It may use the current
  User authentication boundary, but Ticket 03.T1 must revisit the temporary
  normalization seam and decide whether a larger auth surface warrants an
  `AuthController` split.
- `UserRepository` is the persistence boundary. The service performs
  validation, normalization, password encoding, pre-checks and race-safe
  duplicate mapping; database constraints remain authoritative.
- Liquibase owns schema evolution. JPA validates the database mapping and does
  not create or update tables.
- `ApiErrors` is the single bounded error projection: `{ code, message,
  requestId }`. Ordinary responses and logs do not expose credentials or
  internal exception details.

## Current request flows

### Registration

```mermaid
sequenceDiagram
    participant B as Browser / API client
    participant F as RequestCorrelationFilter
    participant S as SecurityFilterChain
    participant C as UserController
    participant U as UserService
    participant R as UserRepository
    participant P as PostgreSQL

    B->>F: POST /api/auth/register
    F->>S: attach or generate X-Request-ID
    S-->>C: permit public registration
    C->>U: register(username, mobile, email, password)
    U->>U: trim/normalize and validate bounds
    U->>R: check username/mobile uniqueness
    U->>U: Argon2-encode password
    U->>R: saveAndFlush(new User(...))
    R->>P: INSERT users + CUSTOMER role
    P-->>R: committed User
    R-->>C: public User projection
    C-->>B: 201 Registered + request ID
```

### Authenticated profile

```mermaid
sequenceDiagram
    participant B as Browser / API client
    participant S as SecurityFilterChain
    participant R as UserRepository
    participant C as UserController
    participant P as PostgreSQL

    B->>S: GET /api/user/me + HTTP Basic
    S->>S: normalize username and load password verifier
    S->>R: findByUsername + current roles
    R->>P: SELECT users and user_roles
    P-->>R: current User and role assignments
    alt credentials and authorization valid
        S-->>C: authenticated User principal
        C->>R: load current profile
        R-->>C: permitted profile fields
        C-->>B: 200 Profile
    else invalid or anonymous request
        S-->>B: bounded 401/403 error
    end
```

## Cross-cutting boundaries

| Boundary | Current implementation | Maintained by |
| --- | --- | --- |
| Startup | `MediWishApplication` loads Spring Boot, JPA and Liquibase. | `MediWishApplication.java`, `application.yaml` |
| Authentication | Stateless HTTP Basic for Ticket 02; Argon2 verifier; current roles loaded from `user_roles`. | `SecurityConfiguration`, `UserRepository` |
| Authorization | `/api/user/**` requires authentication; role-aware rules are the foundation for future protected routes. | `SecurityConfiguration`, `UserRole` |
| Error contract | Externalized English message plus bounded code/status/request ID; `Cache-Control: no-store`. | `ApiErrors`, `ApiErrorController` |
| Correlation/privacy | Accepts one bounded `X-Request-ID` or generates one; logs status and correlation only. | `RequestCorrelationFilter` |
| Database | PostgreSQL 18; Liquibase migrations; Hibernate validation only. | `db.changelog-master.yaml`, JPA mappings |

## Update checklist

Update this page whenever a backend package, route, adapter, persistence
boundary, authentication transport, authorization rule, error contract or
startup integration changes. Keep the package diagram aligned with actual
imports and keep the sequence diagrams aligned with tested API behavior. Add a
new node only when the corresponding source, test and documentation exist;
do not diagram planned OTP/session/catalog/order behavior as implemented.

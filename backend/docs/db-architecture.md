# Backend database architecture

This is the living database architecture map for the backend. It describes the
schema that is currently created by Liquibase and mapped by JPA; it is not a
design claim for tables that belong to later tickets.

**Last reviewed:** 2026-09-26<br/>
**Current scope:** Ticket 01 health baseline, Ticket 02 shared User
registration/RBAC foundation and Ticket 03 durable password sessions.<br/>
**Schema source of truth:** [`src/main/resources/db/changelog/db.changelog-master.yaml`](../src/main/resources/db/changelog/db.changelog-master.yaml)<br/>
**Runtime rule:** Liquibase owns schema changes; Hibernate runs with
`ddl-auto: validate` and must not create or alter tables. Unique
constraints, indexes and foreign keys are declared only in the changelog;
JPA entities map tables and columns without repeating them.

## Current entity-relationship diagram

```mermaid
erDiagram
    USERS ||--o{ USER_ROLES : "has persisted roles"
    USERS ||--o{ USER_SESSIONS : "owns session families"
    USER_SESSIONS ||--o{ SESSION_REFRESH_TOKENS : "rotates generations"

    USERS {
        UUID id PK "Java-generated User identity"
        VARCHAR_50 username UK "trimmed, lowercase, immutable"
        VARCHAR_30 mobile UK "trimmed; OTP normalization deferred"
        VARCHAR_320 email "nullable optional email"
        VARCHAR_255 password_hash "Argon2 verifier only"
        BOOLEAN mobile_verified "false until final OTP work"
        TIMESTAMPTZ created_at "Java-created Instant"
    }

    USER_ROLES {
        UUID user_id PK, FK "references users.id; cascade delete"
        VARCHAR_32 role PK "EnumType.STRING role value"
    }

    USER_SESSIONS {
        UUID id PK "JWT sid and family identity"
        UUID user_id FK "cascade to User"
        TIMESTAMPTZ created_at
        TIMESTAMPTZ expires_at
        TIMESTAMPTZ last_used_at
        TIMESTAMPTZ revoked_at
        VARCHAR_64 revoked_reason "logout, refresh-replay or user-unavailable"
    }

    SESSION_REFRESH_TOKENS {
        UUID id PK
        UUID session_id FK
        BIGINT generation UK "unique within family"
        VARCHAR_64 token_hash UK "SHA-256 lowercase hex only"
        TIMESTAMPTZ issued_at
        TIMESTAMPTZ expires_at
        TIMESTAMPTZ consumed_at
    }
```

`USER_ROLES` has a composite primary key `(user_id, role)`. A User may have
zero or more persisted roles in the database, although public registration
currently creates exactly one `CUSTOMER` assignment. The current role enum is
`CUSTOMER`, `ADMIN`, `MODERATOR`, and `DELIVERY_PERSON`; the database stores
these as strings and the application owns the allowed vocabulary.

## Persistence and migration boundary

```mermaid
flowchart TB
    APP[Spring Boot application]
    LIQ[Liquibase changelog<br/>append-only migrations]
    JPA[Hibernate/JPA<br/>validate-only mapping]
    DB[(PostgreSQL 18<br/>configured schema)]
    META[(Liquibase metadata<br/>DATABASECHANGELOG<br/>DATABASECHANGELOGLOCK)]
    USERS[users]
    ROLES[user_roles]

    APP -->|startup| LIQ
    APP -->|startup validation| JPA
    LIQ -->|applies changesets| DB
    LIQ -->|records ids/checksums/locks| META
    JPA -->|validates mappings| DB
    DB --> USERS
    DB --> ROLES
    ROLES -->|FK user_id| USERS
```

The integration harness points the same migration pipeline at an isolated
PostgreSQL schema. It does not use a second schema model or an in-memory
substitute.

## Current tables and invariants

| Table | Ownership | Important columns and constraints | Meaning |
| --- | --- | --- | --- |
| `users` | `bd.mediwish.user.User` | `id` primary key; `username` unique and not null; `mobile` unique and not null; optional `email`; non-null `password_hash`; non-null `mobile_verified`; non-null `created_at` | Shared identity/profile and credential verifier for Customers and future staff roles. |
| `user_roles` | `User.roles` via `@ElementCollection` | Composite primary key `(user_id, role)`; `user_id` foreign key to `users.id` with `ON DELETE CASCADE`; non-null role | Role assignments used by Spring Security for current authorization. |
| `user_sessions` | `bd.mediwish.auth.UserSession` | UUID primary key; cascading `user_id` FK; non-null lifecycle timestamps; nullable revocation fields; user/revocation and expiry indexes | Durable refresh-session family whose revocation is checked before bearer authorization. |
| `user_session_refresh_tokens` | `bd.mediwish.auth.UserSessionRefreshToken` | UUID primary key; cascading session FK; unique token digest; unique `(session_id, generation)`; session/expiry index; nullable consumed timestamp | One row per refresh generation; consumed rows remain for replay detection. |
| `DATABASECHANGELOG` | Liquibase | Tool-managed applied-change records | Migration history and checksum protection; not application domain data. |
| `DATABASECHANGELOGLOCK` | Liquibase | Tool-managed migration lock | Prevents concurrent Liquibase updates; not application domain data. |

### Data and security rules

- `password_hash` contains only an Argon2 password verifier. Plaintext
  passwords, OTPs and credentials are not database architecture fields and
  must not be logged or returned by an API.
- `username` is normalized by the shared `UserIdentifierNormalizer` before
  lookup and registration; JPA marks it non-updatable. The same seam trims
  mobile values and lowercases optional email values for Ticket 03 candidate
  resolution without adding E.164 or OTP policy.
- `mobile` is trimmed and length-bounded in Ticket 02. Country/E.164
  normalization, verification and account-linking semantics belong to Ticket
  61 and are not represented as implemented schema here.
- Public registration cannot supply roles. The service constructs a User with
  `CUSTOMER`; later staff enrollment/RBAC work may add controlled role
  mutation paths.
- `mobile_verified` is retained as persisted state but remains false for the
  reduced flow. Ticket 61 owns the final OTP transition.
- Refresh values are generated with at least 32 random bytes and only their
  lowercase SHA-256 hex digest is persisted. Rotation locks the generation and
  family in one transaction; raw values never appear in schema, JWT claims or
  ordinary responses.
- Revocation is monotonic: the first `revoked_at`/`revoked_reason` pair is
  kept. `revoked_reason` stores a `RevocationReason` code (`logout`,
  `refresh-replay` or `user-unavailable`); later account operations will
  add their own codes when they revoke through `SessionService.revokeAllForUser`.
- Logout revokes all valid session families represented by duplicate refresh
  cookies in one transaction. A failure while revoking any family rolls back
  the entire operation rather than leaving a partial logout.
- The table rename from `customers` to `users` preserves the applied
  migration history; `customers` is not a current application table.

## Liquibase history

| Changeset | Current effect | Why it matters |
| --- | --- | --- |
| `001-foundation` | Adds the `application-baseline` database tag. | Establishes the migration baseline without domain tables. |
| `002-customers` | Originally creates `customers` with identity, contact, verifier and mobile-state columns plus uniqueness constraints. | Applied history is retained for checksum stability. |
| `003-customer-java-owned-values` | Removes database defaults for `id` and `created_at`. | Java `User` now owns UUID and `Instant` creation while Liquibase remains append-only. |
| `004-shared-users-and-roles` | Renames `customers` to `users`, creates `user_roles`, adds the cascading foreign key and backfills `CUSTOMER` for existing rows. | Implements the shared User resource and role-based authorization boundary. |
| `005-user-password-sessions` | Creates session families and refresh generations with expiry, revocation, consumption, digest and locking-support indexes/constraints. | Implements the durable state boundary for Ticket 03 refresh rotation and immediate logout invalidation. |
| `006-user-email-lookup` | Historically adds a non-unique B-tree index on `users.email`. | The changeset remains in applied history; its unused exact-match index is removed by changeset 008. |
| `007-user-email-case-insensitive-lookup` | Adds a non-unique B-tree expression index on `upper(users.email)`. | Supports the bounded case-insensitive candidate query without changing stored email values or making email unique. |
| `008-drop-unused-exact-email-index` | Drops `idx_users_email`, introduced by 006. | Keeps only the index used by the current case-insensitive lookup while preserving append-only migration history. |

When a later ticket changes persistence, add a new append-only changeset and
update this page in the same change. Do not rewrite an applied changeset to
make the diagram look current; record the historical transition instead.

## Update checklist

Update this document whenever any of the following changes:

1. A Liquibase changeset creates, renames, alters or removes a table, column,
   index, constraint or trigger.
2. A JPA entity changes its table/column mapping, relationship, fetch mode,
   enum persistence or ownership rule.
3. A repository/service introduces a new persistence boundary or changes a
   uniqueness, cascade, transaction or privacy invariant.
4. A ticket changes which data is deliberately deferred, such as OTP,
   sessions, recovery, catalog or orders.

After editing, compare the ER diagram and invariant tables with the current
changelog and entity mappings, then run the backend migration/integration
checks. This page documents the current architecture; future tables should be
added only when their ticket and migration exist.

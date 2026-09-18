# `backend/pom.xml`

Source: [`pom.xml`](../pom.xml)

## Purpose

This Maven build describes the backend application, its runtime dependencies, the Java release, the executable jar and the optional compatibility check. Versions managed by the Spring Boot parent stay centralized; the two optional compatibility versions are properties so the profile has one update point.

## Project metadata

- Coordinates are `bd.mediwish:medi-wish:0.1.0-SNAPSHOT`.
- The artifact is explicitly packaged as a jar and its final file name is `medi-wish`.
- Java release is 25, matching the repository's required JDK.
- The description identifies the artifact as the Medi Wish online medical-store backend.

## Runtime dependencies

| Dependency | Purpose |
| --- | --- |
| `spring-boot-starter-webmvc` | Spring MVC and the embedded HTTP server. |
| `spring-boot-starter-security` | Deny-by-default HTTP security and future authentication extension. |
| `bcprov-jdk18on` `1.81` | Bouncy Castle provider required by Spring Security's Argon2 password encoder. |
| `spring-boot-starter-actuator` | Restricted liveness/readiness endpoints. |
| `spring-boot-starter-data-jpa` | JPA and Hibernate persistence support. |
| `spring-boot-starter-liquibase` | Runs versioned database migrations at startup. |
| `postgresql` (runtime) | PostgreSQL JDBC driver for the configured database. |
| `spring-boot-starter-webmvc-test` (test) | MVC-focused test support; it brings the common Spring Boot test foundation transitively. |

Keeping the application on Boot-managed versions avoids independent framework drift. The focused WebMVC test starter is sufficient for the current tests; a second generic test starter would duplicate its transitive dependencies.

## Build plugins and lifecycle

- `spring-boot-maven-plugin` creates and runs the executable Spring Boot jar.
- `maven-failsafe-plugin` binds `integration-test` and `verify`, so `*IT` classes run as integration tests during `verify`.
- The compiler plugin and its version are inherited from the Spring Boot parent. The effective build uses a recent compiler plugin with `release 25`; no child override is needed.

## Compatibility profile

The default runtime also includes Bouncy Castle `bcprov-jdk18on` `1.81`, required by Spring Security's Argon2 password encoder. The `compatibility` profile adds JobRunr Spring Boot 4 starter `8.8.2` and springdoc WebMVC API `3.1.1`. They are profile-only because the initial runtime does not need background workers, a dashboard or a public API-description endpoint. [`DependencyCompatibilityIT`](src/test/java/bd/mediwish/compatibility/DependencyCompatibilityIT.java.md) starts these integrations against an isolated PostgreSQL schema and verifies their restricted behavior. Normal builds therefore use the default dependency set, while `-Pcompatibility verify` checks the optional boundary explicitly.

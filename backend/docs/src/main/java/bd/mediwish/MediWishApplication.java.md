# `MediWishApplication.java`

Source: [`src/main/java/bd/mediwish/MediWishApplication.java`](../../../../../../src/main/java/bd/mediwish/MediWishApplication.java)

## Purpose and reasoning

`MediWishApplication` is the smallest Spring Boot entry point. `@SpringBootApplication` enables component scanning, auto-configuration and configuration-property support for the `bd.mediwish` package. The default generated Spring Security user configuration is excluded because the foundation has no user store or authentication flow yet; [`SecurityConfiguration`](web/SecurityConfiguration.java.md) supplies explicit deny-by-default rules instead of an accidental development account.

## Class and method

| Member | Behavior and use case |
| --- | --- |
| `MediWishApplication` | Application configuration root discovered by Spring Boot. Later feature packages are scanned beneath `bd.mediwish`. |
| `main(String[] args)` | Delegates to `SpringApplication.run` to create the application context and start the embedded server. Command-line arguments are passed through unchanged for standard Spring Boot startup behavior. |

There is no business logic in this class. Keeping startup in one conventional entry point makes local execution, packaging and integration-test bootstrapping consistent.

## Verification

`HealthIT` and `DependencyCompatibilityIT` launch this class directly and verify that the context, JPA, Liquibase and optional compatibility integrations start as expected. `ConfigurationIT` also uses it to prove invalid datasource configuration fails without exposing credentials.

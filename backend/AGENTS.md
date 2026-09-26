# Backend agent guide

This guide applies to `backend/`. Read [`../AGENTS.md`](../AGENTS.md) first for repository-wide policy, accepted product decisions and the current story workflow. Direct user instructions take precedence.

## Start and scope

1. Check `git status --short --branch` and `git log -1 --oneline`. Edit and commit only on a descriptive ticket branch created from `dev`, per the root guide; never directly on `dev` or `test`. Preserve unrelated changes and stage explicit paths.
2. Read the story and `sub-tickets/` under [`../.scratch/launch-reconciliation/ticket-drafts/`](../.scratch/launch-reconciliation/ticket-drafts/), plus `spec.md`, `TESTING.md`, `WORKFLOW.md` and the latest applicable handoff. Use sub-agents for bounded, non-overlapping backend implementation, research or review work.
3. Read each affected page under [`docs/`](docs/) before editing. Documentation is part of the same change.

## Implementation

- Keep the smallest implementation for accepted behavior. Use layered architecture by feature; each feature owns only the controller, service, persistence and domain code it needs. Shared HTTP concerns belong in `bd.mediwish.web`. Choose names deliberately: use precise domain or responsibility names and avoid vague buckets such as `foundation`. Be careful with over-engineering: add no empty layers, speculative abstractions, dependencies or helpers.
- Use Java 25, Spring Boot and dependency versions pinned in [`pom.xml`](pom.xml), with the Maven Wrapper. Dependency upgrades require a focused compatibility check.
- Runtime configuration belongs in `src/main/resources/application.yaml`; backend English messages belong in `messages.properties`.
- Liquibase owns PostgreSQL 18 schema changes under `src/main/resources/db/changelog/`. Append changesets, preserve applied history and keep Hibernate from creating or updating tables.
- Preserve the bounded error envelope, request correlation and externalized messages. Authorize every new route explicitly. Health and error responses expose no internals.
- Keep credentials, OTPs, passwords, personal data, medicine searches and order contents out of logs, URLs, telemetry and ordinary errors. Use synthetic test data.

## Environment and verification

- Native Windows with JDK 25, PostgreSQL 18 and the Maven Wrapper is the primary workflow. Docker is optional; WSL and Testcontainers are not prerequisites.
- Use [`backend/.env.example`](.env.example). Development uses `medi_wish_dev`; integration tests use `medi_wish_test` and separate `TEST_DB_*` credentials. The test harness resolves process environment, then JVM properties, then ignored `backend/.env`; Spring still needs process environment variables at runtime. Treat values as literal `NAME=value`; never print or commit them.
- From `backend/`, run `.mvnw.cmd test` and `.mvnw.cmd verify`. Use `-Pcompatibility verify` when changing JobRunr or OpenAPI startup integrations. `*Test` classes are unit tests; `*IT` classes are integration tests. Test observable behavior through the API and real PostgreSQL with controlled external adapters.
- Use the guarded test database harness. Verify the target database before mutation, isolate each run in its own schema and clean up only that schema. Never use development credentials, drop a shared database or stop PostgreSQL. When persistence changes, run real migrations and verify behavior across restart. Record actual commands, results, date and source revision; distinguish environment blocks from test failures.

## Documentation and completion

- Mirror every backend source, test, resource, configuration and build file: append `.md` under [`docs/`](docs/) to its path relative to `backend` (`src/main/.../Thing.java` → `docs/src/main/.../Thing.java.md`; `pom.xml` → `docs/pom.xml.md`). Add, move or remove pages with files and update [`docs/index.md`](docs/index.md). Explain purpose, behavior, reasoning, boundaries, use cases and meaningful methods concisely.
- Completing story N leaves stories 01 through N working together. Before closing, satisfy acceptance criteria, complete every sub-ticket, run focused and cumulative unit/integration/contract/regression/sanity checks, review the combined diff and record a concise resolution with **Delivered**, **Verified** and **Notes**.
- Before an authorized commit, inspect the staged diff, verify documentation parity and run `git diff --cached --check`. Use a plain descriptive subject without prefixes. Do not push, merge or deploy without separate authorization. Stop processes started for the task before handoff. When asked for handoff, save the current state under `../agent-docs/Handoff/`.

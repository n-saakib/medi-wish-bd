# Backend agent guide

These instructions apply to work inside `backend/`. Read the repository-wide guide at [`../AGENTS.md`](../AGENTS.md) first; this file adds backend-specific rules. Follow the repository specification and accepted decisions; direct user instructions take precedence.

## Before editing

1. Run `git status --short --branch` and `git log -1 --oneline`. Create or switch to a descriptive branch before editing; never work on `main`.
2. Use sub-agents for bounded implementation, research or review work. Keep file ownership separate and integrate their results before verification.
3. For story work, read the story and its subtasks under [`../.scratch/launch-reconciliation/ticket-drafts/`](../.scratch/launch-reconciliation/ticket-drafts/), plus [`spec.md`](../.scratch/launch-reconciliation/spec.md), [`TESTING.md`](../.scratch/launch-reconciliation/ticket-drafts/TESTING.md), and [`WORKFLOW.md`](../.scratch/launch-reconciliation/ticket-drafts/WORKFLOW.md). Read the latest applicable handoff under [`../agent-docs/Handoff/`](../agent-docs/Handoff/) when resuming.
4. Read the matching page under [`docs/`](docs/) before changing a source or build file. Preserve unrelated work and stage explicit paths.

## Documentation is part of every change

**Every backend source, test, resource, configuration or build change must update its matching page under `backend/docs/` in the same change, before verification and commit.** The mirror is path based: `src/main/.../Thing.java` maps to `docs/src/main/.../Thing.java.md`, and `pom.xml` maps to `docs/pom.xml.md`.

- Add, remove or rename the matching documentation page when adding, removing or renaming a mirrored file.
- Update [`docs/index.md`](docs/index.md) when the tree or documented map changes.
- Keep each page concise and current. Cover the file's purpose, behavior, reasoning, use cases, boundaries and tests; document every public or meaningful function/method.
- Treat source and build files as executable truth and the mirror as required engineering documentation. Do not leave a code/config/build diff without its corresponding documentation diff.

## Implementation

- Keep the smallest implementation that satisfies the accepted behavior. Add a layer, abstraction, dependency or helper only when the current feature needs it.
- Use layered architecture packaged by feature. A feature such as `catalog`, `orders` or `payments` owns its controller, service, persistence and domain code as needed. Shared HTTP concerns belong in `bd.mediwish.web`; use specific names and avoid empty layers or vague buckets such as `foundation`.
- Use Java 25, the Spring Boot version and dependencies pinned in [`pom.xml`](pom.xml), and the Maven Wrapper. Do not upgrade dependencies as incidental cleanup; verify compatibility when an upgrade is the task.

## Configuration, database and privacy

- Runtime settings belong in [`src/main/resources/application.yaml`](src/main/resources/application.yaml); English API messages belong in `messages.properties`.
- PostgreSQL 18 is the local database. Development uses `medi_wish_dev`; integration tests use `medi_wish_test` with separate `TEST_DB_*` credentials. The integration harness uses process environment first, JVM properties second and the ignored root `.env` last; Spring runtime configuration still needs process environment variables. Never print, commit or put credentials in command arguments.
- Liquibase owns the schema under [`src/main/resources/db/changelog/`](src/main/resources/db/changelog/). Append new changesets and preserve applied history; do not edit an applied changeset or let Hibernate create/update tables.
- Preserve the established error envelope, request correlation and externalized messages when changing APIs. Authorize every new route explicitly. Health responses and errors expose no internals.
- Keep credentials, OTPs, personal data, medicine searches and order contents out of logs and ordinary error responses. Use synthetic test data.

## Run and test

Use native Windows with JDK 25, PostgreSQL 18 and the Maven Wrapper. Docker is optional; WSL and Testcontainers are not prerequisites. With a configured root `.env`, integration tests load their own `TEST_DB_*` settings; the application itself still needs process environment variables when started. Use the repository guide at [`../AGENTS.md`](../AGENTS.md) and the backend mirror index at [`docs/index.md`](docs/index.md) for the current local and documentation contracts. A local `agent-docs/DEVELOPMENT.md` runbook may add setup detail when it exists.

From `backend/`, with either the required process environment variables or the configured root `.env`:

```powershell
.\mvnw.cmd test
.\mvnw.cmd verify
```

Use `-Pcompatibility verify` when changing the optional JobRunr or OpenAPI integrations. `*Test` classes are unit tests and `*IT` classes are integration tests. Test observable behavior through the API and real PostgreSQL, using controlled external adapters where applicable.

- Completing story N means stories 01 through N work together. Retain earlier tests and run the cumulative suite and affected cross-story journeys before closing the story.
- Every story and subtask needs focused tests for its behavior plus the applicable integration, regression, contract or sanity coverage. Add only tests that verify meaningful behavior.
- Use the guarded test database harness, verify the connected database before mutation, create an isolated schema and clean up only that schema. Never use development credentials, drop a shared database or stop the shared PostgreSQL service.
- If persistence changes, run the real migrations and verify behavior across restart. Record actual commands, results, date and source revision; distinguish environment blocks from test failures.

## Complete and commit

Before closing a story, meet all acceptance criteria, complete every subtask, update all mirrored documentation and review the combined change. Each completed story and subtask gets a concise resolution with **Delivered**, **Verified** and **Notes**.

Before a commit:

1. Inspect the staged diff and confirm every backend code, test, resource, configuration and build path has its matching documentation update.
2. Run `git diff --cached --check` and the applicable tests.
3. Use a plain descriptive commit subject without prefixes such as `feat:` or `fix:`. Commit only when authorized; do not push, merge or deploy without separate authorization.

Keep generated output under `target/` and local credentials out of commits. Stop only processes started for the task and release their resources before handoff.

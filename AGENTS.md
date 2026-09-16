# Repository guide for agents

Medi Wish is an online medical store. Work in small, testable stories using the existing specification and accepted decisions. These instructions apply throughout the repository; a more specific `backend/AGENTS.md` or `frontend/AGENTS.md` adds rules for that area, and explicit user instructions take precedence.

## Working rules

- **Check out a descriptive feature branch before changing files. Never implement on `main`.** Continue an existing task branch when appropriate. Describe the change in the branch name; ticket numbers are optional.
- **Always use sub-agents.** Give each a bounded implementation, research, or review task while the lead does useful independent work. Assign non-overlapping file ownership and integrate their results before verification. If delegation is unavailable, report that limitation honestly.
- **Keep code minimal.** Implement only the accepted behavior. Add abstractions, interfaces, layers, dependencies and helper scripts when they solve a current need. Avoid speculative infrastructure and generic frameworks.
- **Keep documentation synchronized.** Whenever code, configuration, tests, resources or build files change under `backend/` or `frontend/`, update the matching page under that area's `docs/` in the same change. Add a page for a new file, remove one for a deleted file, update the area's index, and keep method/function explanations current. Generated output and caches remain excluded as stated by the area index.
- Preserve the user's changes. Inspect the working tree before editing or staging; stage explicit task-related paths. Never discard unrelated work or silently change ignore policies.
- Use plain descriptive commit messages, for example `Add customer registration with mobile verification`. Do not add prefixes such as `feat:` or `fix:`. Commit when authorized; push, merge and deployment require their own authorization.
- Ask only for missing decisions that materially block the task. Follow previously accepted decisions, and continue independent work while waiting for an answer.

## Start here

1. Inspect `git status --short --branch` and the latest commit. Confirm the task's scope and branch before making changes. If access is blocked, report the limitation and use the environment's approval mechanism; do not change global Git trust settings to bypass it.
2. When resuming work, read the latest applicable file in [agent-docs/Handoff](agent-docs/Handoff/). Verify its claims against the current checkout; handoffs are dated snapshots.
3. For a story, locate its actual folder under [.scratch/launch-reconciliation/ticket-drafts](.scratch/launch-reconciliation/ticket-drafts/), then read the story, its `sub-tickets/`, declared dependencies and required references. Folder names currently follow `NN - Story title`.
4. For acceptance and testing, read [the spec](.scratch/launch-reconciliation/spec.md), [testing standard](.scratch/launch-reconciliation/ticket-drafts/TESTING.md) and [completion workflow](.scratch/launch-reconciliation/ticket-drafts/WORKFLOW.md). For domain terminology or design changes, consult [CONTEXT.md](agent-docs/plans/plan2/CONTEXT.md), the relevant [ADR](agent-docs/plans/plan2/docs/adr/) and [accepted decisions](agent-docs/plans/plan3/DECISIONS.md).

Resolve only gaps and conflicts in earlier plans; do not reopen what both plans and the user already confirmed. Current user decisions override historical drafts. Older indexes and links can lag behind folder renames: locate the actual file before deciding it is missing. Keep unrelated document migrations outside the feature scope.

The planning, handoff and component runbook directories are intentionally ignored by Git. They may be absent in a fresh clone. If required acceptance information is missing, request that specific context; do not invent product policy or force-add ignored material.

## Code and configuration

| Area | Location and convention |
| --- | --- |
| Backend | `backend/`; Spring Boot, Java 25, Maven Wrapper, PostgreSQL 18, JPA and Liquibase |
| Frontend | `frontend/`; Next.js, React and TypeScript; use npm and the committed lockfile |
| Backend configuration | `backend/src/main/resources/application.yaml`; credentials supplied externally |
| Migrations | `backend/src/main/resources/db/changelog/`; append changesets, preserve applied history |
| English messages | Backend `messages.properties`; frontend `messages/` through next-intl |
| Optional containers | `docker/`; native Windows remains the development and test workflow |

Use **layered architecture packaged by feature**. A feature such as `catalog` or `orders` owns its controller, service, persistence and domain code as needed. Add subpackages only when the feature warrants them. Shared HTTP concerns belong in `bd.mediwish.web`; use specific names for shared responsibilities. Do not create empty feature layers or vague technical buckets such as `foundation`.

Dependency versions and executable scripts are authoritative in `backend/pom.xml`, `backend/.mvn/wrapper/maven-wrapper.properties`, `frontend/package.json` and `frontend/package-lock.json`. Follow those pins; upgrading dependencies is a scoped change requiring compatibility verification.

Before changing API behavior, retain the established bounded error envelope, request correlation and externalized English messages. Extend authorization explicitly for each new route. Health and errors must not expose internals. Keep credentials, OTPs, personal data, medicine searches and order contents out of logs and ordinary error responses.

## Local execution

Run natively on Windows with JDK 25, PostgreSQL 18 and Node.js 24. Set `JAVA_HOME` and ensure the pinned tools are available. Docker, WSL and Testcontainers are not prerequisites. Avoid introducing a custom environment-management script.

Use [.env.example](.env.example) for required connection keys. Development uses `medi_wish_dev`; integration tests use `medi_wish_test` with separate `TEST_DB_*` settings. Spring and the test harness expect process environment variables; the root `.env` is not loaded automatically. Set them in the IDE or load literal `NAME=value` entries from the repository root without printing values:

```powershell
Get-Content .env | Where-Object { $_ -match '^[A-Z][A-Z0-9_]*=' } | ForEach-Object {
    $name, $value = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}
```

For this format, values are unquoted literal text. Never evaluate `.env` as code or put credentials in command arguments, commits, test reports or chat.

From the repository root, start the backend:

```powershell
.\backend\mvnw.cmd -f backend/pom.xml spring-boot:run
```

In another terminal, from `frontend/`, run `npm ci` when installing dependencies and `npm run dev` to start Next.js. The standard local ports are backend 8080 and frontend 3000. For further setup details, consult the local backend/frontend runbooks when present.

## Verification and database safety

Test observable behavior through the backend API and real PostgreSQL. Use controlled payment/SMS/email adapters at external boundaries. Add focused unit tests for nontrivial rules and browser checks for delivered customer/staff flows. Do not invent production abstractions or tests merely to satisfy a test count.

From the repository root, with environment variables loaded:

```powershell
.\backend\mvnw.cmd -f backend/pom.xml test
.\backend\mvnw.cmd -f backend/pom.xml verify
```

`*Test` classes run as units and `*IT` classes as integration tests. The additional `-Pcompatibility verify` command exercises the optional JobRunr/OpenAPI startup integrations; run it when changing those dependencies or startup wiring. That Maven profile also changes packaged dependencies, so use the default profile for the normal application artifact.

From `frontend/`:

```powershell
npm run verify
# With the actual backend running:
$env:MEDI_WISH_API_URL = 'http://127.0.0.1:8080'
npm run test:integration
npm run probe
```

- Keep all earlier delivered features working. In sequential development, completing story N means stories 01 through N work together. Run the final combined cumulative suites and affected cross-story journeys before closing a story, including after parallel edits are integrated.
- Reuse the guarded PostgreSQL harness in `backend/src/test/java/bd/mediwish/health/`. Verify the connected database before mutation and clean up only the exact schema created by that test run. Never fall back to development credentials, drop a shared database, or stop the shared PostgreSQL service for a test.
- Use synthetic fixtures. Apply real migrations and verify preservation across restart when persistence changes. Hibernate must not replace Liquibase as schema owner.
- Record actual commands, results, date, and commit or source hashes. Maven reports under `backend/target/` are generated evidence, not source files. Distinguish test failures from environment blocks; never claim an unrun check passed.
- Stop only processes you started, and release their resources before handing off. Windows can lock a running JAR; stop the owned process before rebuilding it.

## Completion and handoff

Before closing a story, satisfy its acceptance criteria, complete each sub-ticket, pass the applicable cumulative unit/integration/contract/regression/sanity checks, and review the combined change. Every completed story and sub-ticket needs a concise resolution: **Delivered**, **Verified**, and **Notes**, normally 3–5 bullets with links to detailed evidence. Mark blocked or failed work accurately rather than closing it.

For a documentation-only or ignore-file change, validate the affected content, paths and rules; application test reruns are needed only if behavior or an unresolved concern warrants them. For every code or configuration change, the matching `backend/docs` or `frontend/docs` page and index must be part of the same reviewable change.

When committing, inspect the staged diff and run `git diff --cached --check`. Keep secrets, generated output and ignored local artifacts out of commits. Report the commit identifiers and any remaining work for the user's review. When asked for a handoff, save it under `agent-docs/Handoff/`, reference existing artifacts, and record only the current continuation state.

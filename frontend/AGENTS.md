# Frontend guide for agents

This guide applies to `frontend/`. Read [../AGENTS.md](../AGENTS.md) first for repository-wide policy, story workflow, accepted product decisions, database safety, delegation, and handoff format. This file adds frontend-specific rules.

## Frontend rules

- Confirm `git status --short --branch` and the latest commit before editing. Work on a descriptive ticket branch, never `main`; preserve unrelated changes and stage only task files.
- Use a bounded sub-agent for non-trivial frontend work when available. Assign non-overlapping paths and review its result before integration.
- Keep the implementation minimal. Use the existing Next.js, React, and TypeScript patterns. Organize a growing feature by feature; add a layer, abstraction, or dependency only when the current story needs it.
- Follow the versions and scripts in [`package.json`](package.json) and [`package-lock.json`](package-lock.json). The supported runtime is Node.js 24 with npm 11; install with `npm ci`.
- Keep English user-facing text in [`messages/`](messages/) through `next-intl`. Components should not add hard-coded translatable strings.
- Native Windows is the normal workflow. Docker is optional and must not be required for frontend development.

## Environment and privacy

The frontend has no committed application credentials or local environment file. `MEDI_WISH_API_URL` is a process environment variable for backend integration tests and the health probe; the probe defaults to `http://127.0.0.1:8080` when it is absent. Treat API responses, URL parameters, browser storage, and client state as untrusted. Keep credentials, tokens, passwords, OTPs, personal data, medicine searches, and order contents out of logs, URLs, client errors, and telemetry. Preserve established backend error and authorization contracts.

## Documentation parity

For every changed tracked frontend code, test, tool, message, configuration, dependency, script, or build file, update its matching page under [`docs/`](docs/) in the same change. A project path maps to a page by appending `.md` relative to `frontend`; for example, `src/app/page.tsx` maps to `docs/src/app/page.tsx.md`. Add, move, or remove the page and update [`docs/index.md`](docs/index.md) when the source file changes. Keep each page concise and aligned with the implementation, including purpose, observable behavior, reasoning, use cases, and relevant exported functions or components. Exclude generated output, caches, `node_modules`, coverage, and local environment files.

## Story workflow and verification

1. Read the applicable story, sub-tickets, specification, handoff, and required references before editing.
2. Implement the smallest complete vertical slice. Add focused unit tests for non-trivial logic and integration or browser tests for observable customer or staff behavior. Use synthetic data.
3. Update all affected documentation pages and the index before verification.
4. Run from `frontend/`:

   ```powershell
   npm run verify
   $env:MEDI_WISH_API_URL = 'http://127.0.0.1:8080'
   npm run test:integration
   npm run probe
   ```

   The backend must be running for the last two commands. Completing story N must leave stories 1 through N working together; run the cumulative suites and affected cross-story journeys.
5. Review the combined diff, run `git diff --cached --check` before an authorized commit, and record actual commands, results, commit hashes, and any environment blocks. Use plain descriptive commit subjects without prefixes. Stop processes started for verification. For handoffs, save the current continuation state under `agent-docs/Handoff/` as required by the root guide.

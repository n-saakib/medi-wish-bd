# Frontend guide for agents

This guide applies to `frontend/`. Read the repository guide at [../AGENTS.md](../AGENTS.md) for shared policy when it exists; this file defines the frontend-specific workflow.

## Working rules

- **Start on a descriptive branch.** Check out the branch before editing and never work on `main`. Preserve unrelated user changes and stage only paths belonging to the task.
- **Use bounded sub-agents.** For non-trivial work, delegate an implementation, research, or review task with non-overlapping file ownership when agents are available.
- **Keep the implementation minimal.** Add only the Next.js, React, TypeScript, dependency, and abstraction changes required by the accepted story. Package growing features by feature; do not create empty layers or speculative shared code.
- **Use plain commit subjects without prefixes.** Commit only when authorized. Inspect the staged diff and run `git diff --cached --check` first.

## Documentation parity

Documentation is part of every frontend change. For **each code, test, tool, message, configuration, dependency, script, or build change under `frontend/`**, update the matching page under [`docs/`](docs/) in the same branch and commit. Keep the page concise while covering the file's purpose, behavior, reasoning, use cases, and each exported function or method that matters.

- Map a file to a page by appending `.md` to its path relative to `frontend`; for example, `src/app/page.tsx` maps to `docs/src/app/page.tsx.md`.
- When adding, moving, or deleting a tracked frontend file, add, move, or delete its documentation page and update [`docs/index.md`](docs/index.md).
- Keep documentation aligned with the checked-out implementation. Do not document generated output such as `.next/`, `node_modules/`, coverage, or local environment files.

## Frontend conventions

- Use the versions and scripts declared in [`package.json`](package.json) and the committed [`package-lock.json`](package-lock.json). The supported local runtime is Node.js 24 with npm 11; install reproducibly with `npm ci`.
- Use Next.js, React, and TypeScript conventions already present in the app. Keep English user-facing text in [`messages/`](messages/) through `next-intl`; do not hard-code new translatable strings in components.
- Keep native Windows development as the primary workflow. Docker support is optional and must not become a prerequisite for local frontend work.
- Treat API responses and browser state as untrusted. Keep credentials, tokens, passwords, OTPs, personal data, medicine searches, and order contents out of logs, client errors, URLs, and telemetry. Preserve the established backend error and authorization contracts.

## Story completion and verification

1. Inspect `git status --short --branch`, the latest commit, the applicable story and sub-tickets, and the relevant specification or handoff before editing.
2. Implement the smallest complete vertical slice. Add focused unit tests for non-trivial frontend logic and integration or browser checks for observable customer or staff behavior.
3. Update every affected page under `docs/` and its index entries before verification. This step is complete only when every changed tracked frontend path has an accurate matching page.
4. Run the cumulative frontend checks. Completing story N must leave stories 1 through N working together:

   ```powershell
   npm run verify
   ```

   With the backend running, also run:

   ```powershell
   $env:MEDI_WISH_API_URL = 'http://127.0.0.1:8080'
   npm run test:integration
   npm run probe
   ```

5. Review the combined diff, confirm the focused and cumulative checks passed, and record a concise story resolution with **Delivered**, **Verified**, and **Notes**. Record actual commands and results; distinguish environment blocks from test failures.

Use synthetic test data. Do not place secrets in source, `.env` files, test output, commits, or documentation. Stop processes started for verification before handing off.

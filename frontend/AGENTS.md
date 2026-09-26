# Frontend guide for agents

This guide applies to `frontend/`. Read [../AGENTS.md](../AGENTS.md) first for repository-wide policy, story workflow, accepted product decisions, database safety, delegation, and handoff format. This file adds frontend-specific rules.

## Frontend rules

- Confirm `git status --short --branch` and the latest commit before editing. Edit and commit only on a descriptive ticket branch created from `dev`, per the root guide, never directly on `dev` or `test`; preserve unrelated changes and stage only task files.
- Use a bounded sub-agent for non-trivial frontend work when available. Assign non-overlapping paths and review its result before integration.
- Choose names deliberately: use clear domain, component and responsibility names; avoid generic buckets and ambiguous abbreviations. Keep the implementation minimal and be careful with over-engineering: follow the existing Next.js, React and TypeScript patterns, organize growing features by feature, and add a layer, abstraction or dependency only when the current story needs it.
- Follow the versions and scripts in [`package.json`](package.json) and [`package-lock.json`](package-lock.json). The supported runtime is Node.js `>=24.15.0 <25` with npm 11; install with `npm ci`.
- Keep English user-facing text in [`messages/`](messages/) through `next-intl`. Components should not add hard-coded translatable strings.
- Native Windows is the normal workflow. Docker is optional and must not be required for frontend development.

## Page design

Build every new page, and any restyled page, from the static designs in [`agent-docs/ui-design/`](../agent-docs/ui-design/). Its README lists each page's design file and owning ticket; `assets/styles.css` holds the design tokens and components, and `assets/layout.js` the shared headers, footer and icons. Planning folders may be ignored locally: if the design folder is missing, ask for it rather than inventing a layout.

- Match the design page's layout, components, copy and accessibility rules (44 px targets, amber `:focus-visible` ring, status not shown by color alone). Show error, empty and alternate states from its **Other states** panel only when they occur.
- Port tokens and component styles into [`src/app/globals.css`](src/app/globals.css) when a page first needs them and reuse them afterwards. Do not copy unused design-system parts, the prototype's JavaScript or its sample data.
- Put design copy in `messages/` like any other user-facing text.
- The design is a proposal: the specification, accepted decisions and the running API contract win. Leave out elements whose feature is not delivered or is on hold, and record each deviation from the design in the ticket.
- If a page has no design file, reuse the tokens and patterns of the closest designed page instead of creating a new visual style.

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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

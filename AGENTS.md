# Repository guide for agents

Medi Wish is an online medical store. Work in small, testable stories and follow the specification and accepted decisions. User instructions take precedence over this guide.

## Scope and references

This guide applies to the whole repository. For work under `backend/`, read [`backend/AGENTS.md`](backend/AGENTS.md); for work under `frontend/`, read [`frontend/AGENTS.md`](frontend/AGENTS.md). A scoped guide adds detail; it does not remove these repository rules. Native Windows is the primary workflow; optional container files live under `docker/`.

Read only the references relevant to the task:

- Story and subtasks: `.scratch/launch-reconciliation/ticket-drafts/`
- Product specification: `.scratch/launch-reconciliation/spec.md`
- Testing and completion: `TESTING.md` and `WORKFLOW.md` in that ticket-drafts directory
- Domain decisions: `agent-docs/plans/plan2/CONTEXT.md`, its ADRs, and `agent-docs/plans/plan3/DECISIONS.md`
- Latest continuation state: `agent-docs/Handoff/`

Planning and handoff material may be ignored locally. Locate the actual file before treating an old index or link as authoritative. If required acceptance context is missing, request it; do not invent product policy or force-add ignored planning files.

## Start and design

1. Inspect `git status --short --branch` and `git log -1 --oneline`. Continue the current ticket branch or create one descriptive ticket branch before editing; never edit `main` or create extra branches for subtasks. If Git access is blocked, use the approved environment mechanism; do not change global Git trust settings.
2. Preserve unrelated changes and stage explicit paths. Delegate bounded, non-overlapping work to sub-agents, then integrate and review their results before verification.
3. Implement only accepted behavior. Keep code minimal, package feature code by feature, add layers or abstractions only when the feature needs them, and avoid speculative dependencies or scripts.
4. Source and build files are authoritative. Whenever backend or frontend code, configuration, tests, resources, scripts or build files change, update the matching page under that area's `docs/` and its index.
5. Keep public contracts stable: preserve bounded errors, request correlation, authorization and externalized messages. Keep credentials, OTPs, personal data, searches, orders and diagnostics out of logs and ordinary responses.
6. Ask only for decisions that materially block the task; continue independent work while waiting.

## Verification and completion

Test observable behavior with focused unit tests and the applicable API, integration, regression, contract, sanity or browser checks. Use synthetic fixtures and controlled external adapters. Completing story N means stories 1 through N still work together; retain and run their cumulative checks.

Record actual commands, results, date and revision; distinguish environment blocks from test failures. Before closing a story, satisfy every acceptance criterion and write a concise resolution with **Delivered**, **Verified** and **Notes**.

Before committing, review the combined staged diff and run `git diff --cached --check`. Use a plain descriptive commit subject and commit only when authorized. Push, merge and deploy require separate authorization. Stop only processes started for the task and release their resources.

# `tsconfig.json`

Source: [`../tsconfig.json`](../tsconfig.json)

## Purpose

This configuration defines the TypeScript safety and module-resolution rules shared by the Next.js application, tests, and tools.

## Key choices

- `target: ES2022` and the DOM/iterable/ESNext libraries match browser code and the Node-based tooling without transpiling to an unnecessarily old JavaScript target.
- `strict: true`, `noEmit: true`, and `skipLibCheck: true` combine strict project code checking with no generated TypeScript output and practical third-party declaration checking.
- `module: esnext`, `moduleResolution: bundler`, `jsx: react-jsx`, and `isolatedModules: true` match Next.js’s ESM/bundler pipeline and React’s automatic JSX transform.
- `resolveJsonModule` allows the request configuration to import `messages/en.json`; `esModuleInterop` supports compatible module imports.
- `incremental` speeds repeated checks; `allowImportingTsExtensions` supports the explicit `.ts` imports used by the health tests and CLI.
- The `next` plugin adds framework-aware diagnostics, and `@/*` maps to `src/*` for stable application imports.
- `include` covers source, tests, tools, Next-generated type declarations, and the framework environment declaration. `exclude` prevents dependency files and standalone output from entering project checks.

## Use and verification

`npm run typecheck` is the direct check for this file. The Next production build also type-checks the application in its build context. Keep include/exclude changes aligned with the Vitest and Next build boundaries so tests and tools do not silently lose type coverage.

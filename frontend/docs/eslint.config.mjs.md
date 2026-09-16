# `eslint.config.mjs`

Source: [`../eslint.config.mjs`](../eslint.config.mjs)

## Purpose

This is the flat ESLint configuration for Next.js and TypeScript code. It combines the framework’s core web-vitals rules with TypeScript-aware rules while preserving compatibility with the installed config packages.

## Configuration

- `defineConfig` creates the flat-config array.
- `fixupConfigRules` adapts the Next.js rule sets for the current flat ESLint API.
- `nextVitals` applies Next core web-vitals guidance; `nextTypescript` adds TypeScript-specific Next rules.
- `globalIgnores` excludes `.next/**`, `coverage/**`, and generated `next-env.d.ts` from linting.

Warnings are treated as failures by the `lint` package script (`--max-warnings 0`), keeping the verification result unambiguous. Generated artifacts are ignored because source lint rules cannot improve them and framework regeneration owns their contents.

## Verification

Run `npm run lint` from `frontend/`. `npm run verify` runs the same check before typechecking, unit tests, and the build.

# `src/shell/Icon.tsx`

Source: [`src/shell/Icon.tsx`](../../../src/shell/Icon.tsx)

## Purpose

Inline SVG icons taken from `agent-docs/ui-design/assets/layout.js`. Only the icons the current pages use are kept: `plus` (logo mark), `user` (header account link), `chevronLeft` (auth header back link), and `alert` and `check` (alert tones).

## Exports

- `Icon({ name, className = 'icon' })` renders a 24×24-viewBox stroke icon that inherits `currentColor`. Icons are decorative: the SVG has `aria-hidden="true"` and `focusable="false"`, so the adjacent text always carries the meaning.
- `IconName` is the union of available icon names, so an unknown name fails type checking.

## Use cases and boundaries

Inlining avoids an icon font or extra requests. Add an icon here only when a page first needs it, rather than copying the full design set.

## Verification

Checked by `npm run typecheck` and exercised indirectly by the header and form tests; on 2026-09-26 both passed.

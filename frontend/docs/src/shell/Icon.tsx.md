# `src/shell/Icon.tsx`

Source: [`src/shell/Icon.tsx`](../../../src/shell/Icon.tsx)

## Purpose

Inline SVG icons taken from `agent-docs/ui-design/assets/layout.js`. Only the icons the current pages use are kept: `plus` (logo mark), `user` (header account link), `chevronLeft` (auth header back link), `logout` (staff header sign-out button), and `alert` and `check` (alert tones).

## Exports

- `Icon({ name, className = 'icon' })` renders a 24×24-viewBox stroke icon that inherits `currentColor`. Icons are decorative: the SVG has `aria-hidden="true"` and `focusable="false"`, so the adjacent text always carries the meaning.
- `IconName` is the union of available icon names, so an unknown name fails type checking.

## Use cases and boundaries

Inlining avoids an icon font or extra requests. Add an icon here only when a page first needs it, rather than copying the full design set.

## Verification

Checked by `npm run typecheck` and exercised indirectly by the header and form tests; on 2026-09-26 both passed, and again on 2026-09-27 with `logout`, which the staff header test exercises.

Ticket 15 adds the design's image glyph for upload controls and labelled failure placeholders.

Ticket 09 adds only the design `x` path for the recovery dialog Close button. The surrounding labelled icon button supplies its accessible name; the SVG remains decorative.

Ticket 17 adds only the grid tile and verified-medicine review icons used by category and Product details views; the SVGs remain decorative and inherit the surrounding text color.

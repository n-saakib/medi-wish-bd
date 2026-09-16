# `src/app/globals.css`

Source: [`../../../src/app/globals.css`](../../../src/app/globals.css)

## Purpose

This is the global style baseline loaded by the root layout. It gives the current foundation page a readable medical-store palette and predictable document spacing without introducing a component styling system before there are components to support.

## Rules

- `:root` selects a light color scheme, an Arial/Helvetica fallback stack, dark green text (`#163b33`), and a pale green background (`#f6faf8`). These defaults establish the initial visual identity and remain usable when no feature-specific styles exist.
- `body { margin: 0; }` removes browser default whitespace so page layout controls the outer spacing.
- `main` constrains content to `48rem`, centers it vertically with a `15vh` top margin, and adds `1.5rem` padding. This keeps the placeholder page readable on wide screens while retaining mobile breathing room.
- `h1` uses `clamp(2rem, 6vw, 3rem)` so the foundation heading scales between accessible minimum and maximum sizes.
- `p` sets a `1.6` line height and muted green text for comfortable explanatory copy.

The stylesheet intentionally contains no global resets, layout framework, product-card styles, or responsive breakpoints beyond the heading clamp. Those belong with a concrete feature when one exists.

## Use and verification

`src/app/layout.tsx` imports this file once for the App Router document. The production build and browser smoke checks exercise the resulting CSS; no runtime JavaScript is required.

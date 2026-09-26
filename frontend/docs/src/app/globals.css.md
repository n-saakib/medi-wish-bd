# `src/app/globals.css`

Source: [`../../../src/app/globals.css`](../../../src/app/globals.css)

## Purpose

This is the global style baseline loaded by the root layout. It gives the foundation page and the reduced customer access panel a readable medical-store palette, predictable document spacing, responsive form layout and visible keyboard focus without introducing a component styling system.

## Rules

- `:root` selects a light color scheme, an Arial/Helvetica fallback stack, dark green text (`#163b33`), and a pale green background (`#f6faf8`). These defaults establish the initial visual identity and remain usable when no feature-specific styles exist.
- `body { margin: 0; }` removes browser default whitespace so page layout controls the outer spacing.
- `main` constrains content to `60rem`, centers it with a `10vh` top margin, and adds `1.5rem` padding. This keeps the registration/sign-in panel readable on wide screens while retaining mobile breathing room.
- `h1` uses `clamp(2rem, 6vw, 3rem)` so the foundation heading scales between accessible minimum and maximum sizes.
- `p` sets a `1.6` line height and muted green text for comfortable explanatory copy.
- `.account-panel` and `.account-grid` provide the bordered responsive customer-access surface. The grid uses `minmax(min(100%, 16rem), 1fr)`, so its minimum track is capped by the available inline size: the 16rem preference remains on wider layouts, while a 320px viewport can shrink the track to the panel instead of pushing controls past its edge.
- `form`, `label`, `input`, and `button` establish consistent readable controls, while `:focus-visible` adds a high-contrast keyboard focus ring. `.status` and `.error` provide the success/error colors used with the component's live regions.

The stylesheet intentionally contains no global resets, layout framework, product-card styles, or product-specific visual language. Feature styling remains limited to the concrete Ticket 02 access surface.

## Use and verification

`src/app/layout.tsx` imports this file once for the App Router document. The production build passed after the responsive track correction, and a fresh isolated Chrome profile visually confirmed that the account panel and controls fit within a 320px viewport. This is a single-browser responsive check, not a supported-browser matrix; no runtime JavaScript is required.

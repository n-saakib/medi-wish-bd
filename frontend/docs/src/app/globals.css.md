# `src/app/globals.css`

Source: [`src/app/globals.css`](../../../src/app/globals.css)

## Purpose

This is the global stylesheet loaded once by the root layout. It holds the design tokens and component styles ported from `agent-docs/ui-design/assets/styles.css`, limited to what the current home, account, sign-in and registration pages use. There is no CSS framework or CSS-in-JS layer; components apply these class names directly.

## Rules

- **Tokens.** `:root` defines the brand greens, amber accent, ink/muted text, line, background and surface colors, tinted alert backgrounds, radii, a light shadow, the `--font` stack and the `1240px` content width, and sets `color-scheme: light`. The font stack names Inter and Hind Siliguri first but no webfont is downloaded; browsers fall back to installed or system fonts.
- **Base.** Border-box sizing, text-size-adjust, body font/color/background, link color, heading sizes, paragraph spacing and the helpers `.small`, `.muted`, `.center`, `.mt-16`, `.mt-24`. `:focus-visible` draws a 3 px amber outline on every focusable element.
- **Layout.** `.container` centers content with 16 px gutters, `.page` adds vertical page padding, `.stack` spaces children, `.card`/`.card-pad` form the account surface, and `.dl` lays out label/value pairs with wrapping values.
- **Buttons and icons.** `.btn` with `-primary`, `-secondary`, `-ghost` and `-block` variants; every button is at least 44 × 44 px. Disabled buttons are dimmed with a not-allowed cursor. The design's smaller `btn-sm` is deliberately not ported, so all targets stay at least 44 px. `.icon` (20 px) and `.icon-s` (16 px) size inline SVGs.
- **Forms.** `.field`, `.hint` and `.input` give labelled 44 px inputs; focused inputs get the amber outline.
- **Alerts.** `.alert` plus `-success`, `-warn` and `-danger` tones. The [`Alert`](../shell/Alert.tsx.md) component always pairs a tone with an icon and text, so status is not conveyed by color alone.
- **Store header.** `.site-header` is sticky; `.logo`, `.logo-mark`, `.header-actions` and `.header-link` style the logo and account link, with the username truncated at 24 characters. At 860 px and below the link label is visually hidden with the `sr-only` technique rather than `display: none`, so the icon-only link keeps its accessible name.
- **Home hero.** `.hero-main` is the green gradient panel for the home heading and preparation copy, with reduced padding at 860 px and below.
- **Auth pages.** `.auth-header` is the 72 px sign-in/register header; at 480 px and below its button padding shrinks and the "Back to home" label is visually hidden in the same accessible way. `.auth-wrap` centers the form card below the header and `.auth-card` caps it at 440 px; the account page reuses `.auth-card` for its width.

Search, cart, category navigation, footer, product and order styles from the design system are not included because those features are not implemented.

## Use and verification

[`src/app/layout.tsx`](layout.tsx.md) imports this file once. On 2026-09-26 `npm run lint` and `npm run build` passed with this stylesheet. Responsive and focus appearance is a browser concern; its verification is recorded in the Ticket 03.01 evidence.

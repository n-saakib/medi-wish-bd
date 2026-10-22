# `src/app/globals.css`

Source: [source](<../../../src/app/globals.css>).

## Purpose

This is the global stylesheet loaded once by the root layout. It holds the design tokens and component styles ported from `agent-docs/ui-design/assets/styles.css`, limited to what the delivered home, account, editable profile, sign-in, registration, staff MFA, staff landing, Users and roles and staff catalog pages use. There is no CSS framework or CSS-in-JS layer; components apply these class names directly. The Admin additions port card sections, responsive filters, locally scrollable tables, pager, labelled radio choice rows, history wrapping and text MFA chips from the static designs.

Every control has a 44 px target (radios use the full label); keyboard focus has the amber outline. Narrow filters and private headings wrap instead of overflowing the document. No prototype JavaScript, sample data or unused future styles are imported. Layout/focus evidence belongs to browser suites and manual QA.

- **Tokens.** `:root` defines the brand greens, amber accent, ink/muted text, line, background and surface colors, tinted alert backgrounds, radii, a light shadow, the `--font` stack and the `1240px` content width, and sets `color-scheme: light`. `--brand-100` and `--accent-50` are the light brand border and amber tint used by the chip and backup-code panel. The font stack names Inter and Hind Siliguri first but no webfont is downloaded; browsers fall back to installed or system fonts.
- **Base.** Border-box sizing, text-size-adjust, body font/color/background, link color, heading sizes, paragraph spacing and the helpers `.small`, `.muted`, `.center`, `.mt-8`, `.mt-16`, `.mt-24`, `.mb-0` and `.mono` (monospace stack). `:focus-visible` draws a 3 px amber outline on every focusable element.
- **Layout.** `.container` centers content with 16 px gutters, `.page` adds vertical page padding, `.stack` spaces children, `.card`/`.card-pad` form the account surface, and `.dl` lays out label/value pairs with wrapping values.
- **Buttons and icons.** `.btn` with `-primary`, `-secondary`, `-ghost` and `-block` variants; every button is at least 44 × 44 px. Disabled buttons are dimmed with a not-allowed cursor. `.btn-sm` uses smaller text and horizontal padding while retaining the 44 px minimum target for saved-address Edit controls. `.icon` (20 px) and `.icon-s` (16 px) size inline SVGs. `.icon-btn` is a 44 × 44 px icon-only button (the staff header's sign-out). `.chip`/`.chip-brand` form the `Super Admin` label, which always carries text.
- **Forms.** `.field`, `.hint` and `.input` give labelled 44 px inputs; focused inputs get the amber outline.
- **Alerts.** `.alert` plus `-success`, `-warn` and `-danger` tones. The [`Alert`](../shell/Alert.tsx.md) component always pairs a tone with an icon and text, so status is not conveyed by color alone.
- **Store header.** `.site-header` is sticky; `.logo`, `.logo-mark`, `.header-actions` and `.header-link` style the logo and account link, with the username truncated at 24 characters. At 860 px and below the link label is visually hidden with the `sr-only` technique rather than `display: none`, so the icon-only link keeps its accessible name.
- **Home hero.** `.hero-main` is the green gradient panel for the home heading and preparation copy, with reduced padding at 860 px and below.
- **Auth pages.** `.auth-header` is the 72 px sign-in/register header; at 480 px and below its button padding shrinks and the "Back to home" label is visually hidden in the same accessible way. `.auth-wrap` centers the form card below the header and `.auth-card` caps it at 440 px; the account and staff pages reuse `.auth-card` for its width.
- **Staff MFA.** `.steps-mini` is the two-step progress bar; `.qr` frames the 176 px QR SVG on white for scanning contrast; `.disclosure` styles the `Can’t scan?` summary as a 44 px target and wraps the grouped key; `.code-input` enlarges and spaces the code field; `.secret` is the dashed amber backup-code panel and `.code-grid` its two-column code list.
- **Account profile.** `.profile-card` caps the editor at 700 px; mobile, pending and action rows wrap on narrow screens. Verification chips include text for both states. Field errors use readable text, and the native dialog caps its width at 440 px with viewport gutters, a dimmed backdrop and the existing 44 px inputs/buttons and amber focus rings.
- **Staff header.** `.staff-top` is the 64 px white header with the logo and sign-out button.
- **Staff catalog.** `.catalog-heading`, `.catalog-filters`, `.catalog-form-grid`, `.catalog-inline-form` and `.catalog-pager` lay out the list, editor and category forms. `.catalog-table-scroll` confines horizontal scrolling to its table card on mobile; `.catalog-check` makes checkbox/radio labels at least 44 px high. `.field-error` carries validation text, `.catalog-history` separates audit entries with a muted readable timestamp under each action, and `.sr-only` preserves accessible table column names. Status chips carry text, and all focused controls retain the amber ring.

Storefront search, cart, footer and order styles from the design system are not included because those features are not implemented.

Catalog field grids use a zero minimum track so a native select with an accepted 80-character category option can shrink inside its filter/editor/inline form. Table header cells position their visually hidden column labels locally; otherwise an absolute label in the last column can escape the scrolling container and expand the page. These rules preserve internal table scrolling on 375 px pages; no page-level overflow is hidden.

## Use and verification

[`src/app/layout.tsx`](layout.tsx.md) imports this file once. On 2026-09-26 `npm run lint` and `npm run build` passed with this stylesheet, and again on 2026-09-27 with the staff MFA additions. Responsive and focus appearance is a browser concern; its verification is recorded in the Ticket 03.01 evidence.
The table wrapper is positioned so its absolutely positioned screen-reader-only column heading remains contained by the local horizontal scrollport. The 375 px manual review exposed a document width of 535 px before this fix; the mobile browser check protects document overflow.

Catalog chips now port the exact design information, success and warning text/background/border tokens. The base chip supplies neutral background, muted text and line border; chip-brand remains the existing brand variant. Only variants used by delivered pages are included.

Product MRP and price headers/cells use .num for right alignment and tabular numerals, matching the staff-products design.

Tickets 08 and 14 each added `.sr-only`, `.chip-success` and `.chip-warn`; the merge keeps one shared rule per selector with the design's token values, next to the other chip variants.

Closing-pass fix (2026-10-08): `.catalog-form-grid` aligns its fields to the top, so a field error under one input no longer pushes the neighbouring inputs out of line. A field error after a `.catalog-check` label (the Product's Active error) is a block under the label instead of running into its text. `.profile-pending-note` replaces the old `.profile-pending p` rule because the note is always rendered as the pending mobile's status region.

Ticket 15 ports the image grid, thumbnail and dashed upload slot from the staff-product-edit design. The grid has two columns up to 700px and four on wider screens; the main thumbnail has a brand border. Dialog previews fit the viewport, actions wrap and image controls retain 44px targets. Labelled placeholders occupy the thumbnail. The image-upload-slot override makes the shared empty-slot square without changing its base design.

The remove-confirmation button uses the design danger token and filled button style, retaining its explicit Remove label.

## Ticket 16

Ticket 16 reuses catalog controls and adds pill status tabs with 44 px minimum controls, count spans, selected state, and a modal discount dialog. The dialog bounds width and dynamic-viewport height and scrolls vertically for shorter/mobile viewports.

Ticket 12 ports the three-column responsive address grid, outlined default card and dashed Add tile from the design. Adds danger-ghost Remove, spacing, 44px small buttons, and anywhere wrapping for accepted maximum-length text. The existing native profile dialog, checkbox and alert styles are reused.

The integrated stylesheet keeps one unchanged shared empty-slot rule and its hover rule. Address grid breakpoints at 960px and 640px and the image grid breakpoint at 700px remain independent; image-upload-slot alone supplies the square override.

Ticket 17 adds the category bar (its current link has the `is-active` brand color and a 2 px inset underline), responsive category tiles and five-column Product grid, price hierarchy and badges, 44 px navigation/card/pager/gallery targets, the two-column Product details layout, visible description line breaks, gallery thumbnails and generic empty/not-found/error views. At narrow widths the product grid becomes two columns, details stack, and only the category bar scrolls horizontally. Existing amber focus-visible styling remains shared. The card Sale Unit uses `--muted` (about 5.6:1 on white), as plan §4.0.5 maps the design's `--faint`; no `--faint` token is added because it fails WCAG AA for small text.

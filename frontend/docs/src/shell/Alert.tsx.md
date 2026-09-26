# `src/shell/Alert.tsx`

Source: [`src/shell/Alert.tsx`](../../../src/shell/Alert.tsx)

## Purpose

Client component for the design-system alert, used for form errors and session notices. Every alert pairs a tone with an icon and text, so status is never conveyed by color alone.

## Export

### `Alert({ tone, children, focusOnShow = false })`

- `tone` is `success`, `warn` or `danger` and selects both the `alert-<tone>` style and the icon (`check`, `alert`, `alert`).
- `danger` alerts use `role="alert"`; the other tones use `role="status"`.
- With `focusOnShow`, the alert gets `tabIndex={-1}` and receives focus when it mounts. This is used for notices that replace the page's context, such as sign-out results and the sign-in page's session notices, so they are announced and keyboard users start from them.

## Use cases and boundaries

Alerts are rendered only when a message exists; pages do not keep empty alert regions. The component shows only the text it is given; callers pass translated messages or bounded server text, never raw error details.

## Verification

The sign-in, registration and account tests assert alert roles, text and focus.

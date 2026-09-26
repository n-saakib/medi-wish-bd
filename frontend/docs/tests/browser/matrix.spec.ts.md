# `tests/browser/matrix.spec.ts`

Source: [`../../../tests/browser/matrix.spec.ts`](../../../tests/browser/matrix.spec.ts)

## Purpose

This is the Ticket 03.02 T7 Chrome and Edge sanity and accessibility matrix.

## Viewports (320, 375, 768 and 1280 px wide, 800 px high)

On `/`, `/register`, `/account` and `/sign-in`, `expectAccessibleLayout` asserts that:

- nothing scrolls horizontally;
- every input has a label;
- from a freshly loaded page, Tab visits every visible link, enabled button and input in page order, each with a visible outline.

`holdNext` holds one API request so the spec can observe, then lets it continue or fail as a network error:

- the `Creating account…` and `Signing in…` busy buttons;
- the `Checking your session…` status;
- the `Signing out…` busy button, whose logout then fails;
- the focused `Sign-out could not be completed.` alert, without horizontal scroll, and its `Try again` button busy as `Signing out…` while the retried logout is held.

It then checks that the retry signs out, and the wrong-password alert. Alerts are matched by text, because Next adds its own empty route-announcer alert to every page.

## DevTools protocol

A CDP `Network` session observes the following. It attributes each request to its page's origin, because Chromium adds the `Origin` header after `requestWillBeSent`, and it also reads the status from `responseReceivedExtraInfo`, the only status event for a response that CORS then blocks:

- the API's `200` answer to the CORS preflight for `GET /api/user/me`;
- the `403` answer to `GET /api/auth/csrf` from the same frontend opened as `http://localhost:3100`, an origin the API does not allow. A real loopback server is used because Chrome's local-network rules block requests from a page Playwright fulfils, which never reach the API.

The spec prints the channel, browser version and every API response's status, method, path and encoded size (`size not reported` when Chromium sends no size, as for bodyless and blocked responses), as observations rather than limits.

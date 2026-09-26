# `tests/browser/privacy.spec.ts`

Source: [`../../../tests/browser/privacy.spec.ts`](../../../tests/browser/privacy.spec.ts)

## Purpose

This is the Ticket 03.02 T6 redaction check, run on each channel.

## Flow

A synthetic Customer:

1. registers;
2. reloads `/account`;
3. signs out;
4. signs in again by email.

Meanwhile the spec captures every access token the page presents in an `Authorization` header, and every refresh and CSRF value the API sets through `Set-Cookie` (the `XSRF-TOKEN` cookie carries the same value as the CSRF bootstrap body). It fails unless it captured at least one of each. It reads headers rather than response bodies, because Chromium can discard a body before Playwright reads it, for example after a navigation. After each step it snapshots storage.

## Assertions

The password, mobile, email and every captured token must not appear in:

- the test API's ECS log (`test-api.log`), which must contain the API's `HTTP response status=` request events, so the scan cannot pass on an empty file;
- any console message;
- any request URL or frame navigation, which includes history writes;
- local storage, session storage, `history.state` and the location, read after each step, and that no IndexedDB database exists, so none can hold a value.

Failures report only the surface and the number of values found, never a value. The user's own profile on `/account` is the one allowed display.

## Not inspected

Browser surfaces these tools cannot reach are not claimed:

- the disk cache;
- crash dumps;
- the operating system's or an extension's view of the page;
- the API origin's HttpOnly refresh cookie, which is expected to hold the refresh value.

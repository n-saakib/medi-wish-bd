# `src/lib/dateTime.ts`

Source: [`src/lib/dateTime.ts`](../../../src/lib/dateTime.ts)

## Purpose

Formats audit timestamps the way the page designs show them, in Asia/Dhaka: `27 Sep 2026, 5:00 pm`. The product and role change histories share it, so both read the same and neither depends on the viewer's time zone.

## Export

### `formatDateTime(instant)`

Takes an ISO instant from the API and returns day, short month, year, then a 12-hour time with a lowercase `am`/`pm`. It assembles `Intl.DateTimeFormat('en')` parts rather than using `en-GB`, whose short September is `Sept`.

## Use cases and boundaries

Used by [`ProductEditor`](../catalog/ProductEditor.tsx.md) inside a `<time dateTime>` that keeps the original instant, and by [`UserRoleForm`](../admin/UserRoleForm.tsx.md). It formats only; callers keep the instant.

## Verification

[`tests/dateTime.test.ts`](../../tests/dateTime.test.ts.md) covers afternoon, after-midnight and just-after-noon Dhaka times. `tests/catalogPages.test.ts` and `tests/UserRoleForm.test.ts` assert the rendered history text.

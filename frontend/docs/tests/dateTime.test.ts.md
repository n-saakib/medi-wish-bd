# `tests/dateTime.test.ts`

Source: [`tests/dateTime.test.ts`](../../tests/dateTime.test.ts)

Unit checks for [`formatDateTime`](../src/lib/dateTime.ts.md): three UTC instants render in Asia/Dhaka as `27 Sep 2026, 5:00 pm`, `9 Oct 2026, 12:30 am` (the date rolls over) and `8 Oct 2026, 12:05 pm`.

## Ticket 16

Ticket 16 verifies the calendar-date formatter without viewer-timezone shifting; existing Dhaka instant cases remain.

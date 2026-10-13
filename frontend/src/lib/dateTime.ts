const dhaka = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
});

/** An audit instant in Asia/Dhaka as the page designs show it: "27 Sep 2026, 5:00 pm". */
export function formatDateTime(instant: string): string {
  const parts = dhaka.formatToParts(new Date(instant));
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === name)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase()}`;
}

/** A calendar date without shifting it through the viewer's timezone. */
export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${isoDate}T12:00:00Z`));
}

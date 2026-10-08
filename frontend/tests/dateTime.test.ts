import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../src/lib/dateTime';

describe('formatDateTime', () => {
  it.each([
    ['2026-09-27T11:00:00Z', '27 Sep 2026, 5:00 pm'],
    ['2026-10-08T18:30:00Z', '9 Oct 2026, 12:30 am'],
    ['2026-10-08T06:05:00Z', '8 Oct 2026, 12:05 pm'],
  ])('shows %s in Asia/Dhaka as the designs do', (instant, shown) => {
    expect(formatDateTime(instant)).toBe(shown);
  });
});

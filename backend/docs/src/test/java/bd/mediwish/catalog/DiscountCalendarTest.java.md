# DiscountCalendarTest.java

Four deterministic UTC clock fixtures pin the last instant before and first instant of Asia/Dhaka midnight, including year rollover. The calendar must derive the Dhaka date even when the injected clock itself has the UTC zone.

Requires the planned `DiscountCalendar(Clock)` production class; does not replace the authentication clock in any application context.

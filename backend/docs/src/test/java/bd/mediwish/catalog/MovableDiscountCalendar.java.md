# MovableDiscountCalendar.java

Explicit Spring launch source for Ticket 16 integration tests. Its `@Bean @Primary` calendar changes only the promotion date and falls back to the real Asia/Dhaka date while unset. It deliberately has no configuration/component annotation, preventing ordinary catalog and authentication test contexts from scanning it.

The auth `Clock` remains real. `DiscountTestApi` fixes promotion today at 2020-01-15, before real End-now timestamps; future calendar dates would incorrectly make a manually ended active fixture look ended before it started. Restart creates a new bean, so the fixture fetches and sets it again.

Uses the non-final production `DiscountCalendar(Clock)` class. The calendar bean is explicitly named `controlledDiscountCalendar`, distinct from the `movableDiscountCalendar` launch-source bean; ordinary application bean overriding remains disabled.

`advanceAfterFirstRead` arms a deterministic midnight transition: the first calendar read receives the preceding date, all later reads the following date. Fixture creation precedes arming; `set` clears the transition. This detects inconsistent per-request date sampling without changing the real authentication clock.

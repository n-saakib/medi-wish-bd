# DiscountTestApi.java

Thin wrapper over `CatalogTestApi`, which owns the guarded PostgreSQL 18 schema, random-port application, real synthetic registration/staff MFA and catalog fixture calls. The planned launch-source overload supplies the explicit movable promotion calendar. Authentication and MFA continue to use the real clock; no actor/auth implementation is duplicated.

Provides catalog fixture calls, discount create/update/end/list calls, exact request body builders and JSON projection helpers. Decimal values remain strings; the create identity is supplied by the caller for replay/race tests. Responses pass through `TestApplication`'s no-store and request-correlation assertions. Restart restores the controlled date on the new calendar bean. Close releases the application and only its owned schema.

The `start(int, Class<?>...)` overload combines the movable calendar with explicitly supplied test launch sources, allowing the concurrency suite to pause the existing `CurrentPrices` materialization boundary without component-scanned test beans. Existing calls retain their timeout/calendar behavior.

Requires Ticket 16 `DiscountCalendar` and the accepted discount routes. No stub production endpoints or in-memory persistence substitute are included.

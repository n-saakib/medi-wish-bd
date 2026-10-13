# DiscountTestApiTest.java

Unit coverage for the new fixture's pure request builders. Pins the allowed create/update fields, date-only serialization, preservation of an optional null end date, caller identity/version and editable changes. Server-owned target/audit fields stay out of update bodies, and building an update cannot mutate the original fixture.

This unit has no database or application launch; compiling the helper still requires the planned calendar class.

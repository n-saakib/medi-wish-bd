# MovableAddressChangeCalendar.java

Source: [src/test/java/bd/mediwish/address/MovableAddressChangeCalendar.java](../../../../../../../src/test/java/bd/mediwish/address/MovableAddressChangeCalendar.java).

Exercises Ticket 12 observable address-book behavior against the real application and a guarded PostgreSQL 18 schema. Tests use synthetic values, the existing AuthApi client, and run-owned schema cleanup; no production test endpoint is added.

Plain explicitly imported bean factory, never component scanned. Its Primary Calendar uses an atomic optional instant and public set/reset/now methods; unset delegates to the application Clock. Bean name fixedAddressChangeCalendar avoids both the production component and the explicitly registered source class name movableAddressChangeCalendar. This is a test-only deviation from the plan; Spring registers the source class under its lower-camel name.

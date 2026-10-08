# ProfileControllerTest.java

Source: [ProfileControllerTest.java](../../../../../../../src/test/java/bd/mediwish/web/ProfileControllerTest.java)

## Boundary and cases

Standalone Spring MVC uses the real profile controller, Jackson converters, principal resolver, bounded error advice and correlation filter. Repository-backed services are mocked at this HTTP seam; PostgreSQL tests cover transactions separately.

Tests check exact edit keys and caller identity; missing/unknown fields, null version, numeric/boolean text, fractional/string/boolean/overflow versions and invalid dates; one string mobile; 202 staging; empty bodyless 204 cancellation; no-store and bounded errors; profile-only non-JSON 400 mapping. Every case verifies that activation was never invoked.

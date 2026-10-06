# ProfileBodyLimitTest.java

Source: [ProfileBodyLimitTest.java](../../../../../../../src/test/java/bd/mediwish/web/ProfileBodyLimitTest.java)

## Boundary and cases

The real Bearer command matcher and body-limit filter pass JSON padded to exactly 16 KiB and reject one byte more for profile PUT and mobile POST. The control uses valid JSON, so field validation cannot hide a missing body guard. Bodyless mobile DELETE passes without a Content-Type.

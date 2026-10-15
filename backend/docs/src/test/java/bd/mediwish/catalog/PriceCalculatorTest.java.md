# `PriceCalculatorTest.java`

Checks all 17 accepted worked examples and unrelated targets, current Category moves, empty fallback, null-price refusal, exact rounding and middle-candidate winner through the pure price boundary.

Worked example 13 requires IllegalStateException when the stored selling price exceeds a non-null MRP; this pins the invariant guard's accepted failure contract.

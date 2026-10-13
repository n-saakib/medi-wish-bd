# EffectivePriceTest.java

Pins the downstream snapshot contract as a record with ten immutable value components (`Money`, decimals, UUIDs, dates and discount enums). No mutable Product or Discount entity can be retained by the snapshot.

`DiscountRegressionIT` separately proves captured values survive real edits/end; this structural unit does not replace the database regression or later accepted Order-line tests. Requires the planned `EffectivePrice` record and discount enums.

The structural assertion pins the exact ten component names and declared `Class<?>` types from the accepted downstream contract, without requiring record declaration order. It rejects replacing a Money component with an otherwise immutable BigDecimal, in addition to excluding mutable entities.

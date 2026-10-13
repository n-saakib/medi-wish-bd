# `PriceCalculator.java`

Pure exact-decimal greatest-saving calculation. Filters wrong target, scheduled/ended, rounded-zero and nonpositive-result candidates; percentage saving rounds HALF_UP to two places. Ties prefer Product, earlier start, then lexicographically smaller UUID. Discounts never stack, and fallback is current Selling Price.

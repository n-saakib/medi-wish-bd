# Money

Exact positive BDT value used by catalog pricing rules. `parse` accepts one to seven ASCII whole digits and at most two fractional digits; rejects whitespace, signs, exponent notation, zero and extra scale before PostgreSQL can round. It creates BigDecimal from the string and fixes scale to two with UNNECESSARY rounding. `value` supplies exact persistence data, `compareTo` compares decimal amounts and `toString` emits two decimal places. Values range from 0.01 through 9,999,999.99; no floating-point conversion is used.

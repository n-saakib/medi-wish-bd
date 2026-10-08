# MoneyTest

Tests the public Money parse/display/comparison seam with accepted contract literals. Positive cases include smallest/largest amounts and padded whole digits; invalid cases include absent/blank input, zero, signs, scientific notation, separators, extra precision/scale and non-ASCII digits. Display and comparison assertions use independent expected amounts. The red gate failed on missing Money/InvalidMoneyException before implementation; the green gate is recorded in Ticket 14 evidence.

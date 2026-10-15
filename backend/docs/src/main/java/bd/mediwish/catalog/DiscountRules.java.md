# `DiscountRules.java`

Accepted create/update state rules, value/date validation, flat-price guard and scale-insensitive replay equality. A started Discount keeps its start date; changed ended Discounts are refused. Commands recognize identical replay before checking version or mutable state.

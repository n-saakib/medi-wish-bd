# `ProfileRulesTest.java`

Source: [`ProfileRulesTest.java`](../../../../../../../src/test/java/bd/mediwish/user/ProfileRulesTest.java)

Tests name whitespace normalization, Unicode control and line-separator rejection, optional email normalization and P12 validation, and the date-of-birth boundary using the Dhaka calendar date. Invalid profile values fail before mutation.

The space-heavy boundary regression accepts A plus 98 spaces plus B (100 trimmed units), collapses it to A B, and rejects the corresponding 101- and 102-unit names before collapse. Outer spaces do not count toward the trimmed limit.

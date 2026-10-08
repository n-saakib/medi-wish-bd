# `ProfileRules.java`

Source: [`ProfileRules.java`](../../../../../../../src/main/java/bd/mediwish/user/ProfileRules.java)

Pure profile rules without Spring or database access. `validate` trims and collapses name spaces, rejects controls and Unicode line separators, normalizes email through `UserIdentifierNormalizer`, applies P12 email format and validates DOB from 1900-01-01 through the caller-provided Dhaka date and nonnegative version. `stageMobile` accepts a different 11-digit normalized number. `requireEditable` rejects any account state except `ACTIVE`. Exceptions retain only field names, never private values.

The full-name limit is measured in UTF-16 units after trimming and before collapsing internal ASCII-space runs, matching the browser. A 100-unit trimmed name can normalize to a shorter stored value; 101 or more units are rejected even if space collapse would shorten it.

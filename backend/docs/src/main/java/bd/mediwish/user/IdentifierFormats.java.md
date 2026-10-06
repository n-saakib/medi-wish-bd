# `IdentifierFormats.java`

Source: [`IdentifierFormats.java`](../../../../../../../src/main/java/bd/mediwish/user/IdentifierFormats.java)

Pure P12 format checks after `UserIdentifierNormalizer` trims and lowercases input. `isUsername` accepts 3–20 ASCII username characters with a letter; `isMobile` accepts exactly 11 ASCII digits; `isEmail` accepts the bounded dot-atom subset with local part at most 64 characters, total at most 254, and two or more valid domain labels. Registration and profile editing share these checks, keeping identifier kinds disjoint at sign-in. Existing stored rows are not rewritten.

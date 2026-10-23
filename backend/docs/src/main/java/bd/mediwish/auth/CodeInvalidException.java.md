# `CodeInvalidException.java`

Source: [CodeInvalidException.java](../../../../../../../src/main/java/bd/mediwish/auth/CodeInvalidException.java)

Public bounded signal shared by incorrect, absent, expired, wrong-address, consumed or voided challenges. It stores no code or address. Confirmation services preserve counted failures and the web adapter maps it to CODE_INVALID.

# `AccountClosingException.java`

Source: [`AccountClosingException.java`](../../../../../../../src/main/java/bd/mediwish/user/AccountClosingException.java)

Raised after locking a User whose account state is not `ACTIVE`. Profile and mobile commands map it to `409 ACCOUNT_CLOSING`; the profile read remains available.

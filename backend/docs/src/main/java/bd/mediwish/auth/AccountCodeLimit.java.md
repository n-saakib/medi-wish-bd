# `AccountCodeLimit.java`

Source: [AccountCodeLimit.java](../../../../../../../src/main/java/bd/mediwish/auth/AccountCodeLimit.java)

JPA maps account_code_limits: opaque key, hourly window start, attempt count and latest event time. window() takes an immutable counter snapshot; next() starts a new window when needed and creates state that remains usable after a bulk code delete clears the persistence context. Address keys contain HMACs; account keys contain opaque UUIDs.

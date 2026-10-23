# `AccountCode.java`

Source: [AccountCode.java](../../../../../../../src/main/java/bd/mediwish/auth/AccountCode.java)

JPA maps account_codes, including its UUID, owner, purpose, protected CHAR(64) HMAC, delivery address, timestamps and short failure counter. The raw code is never an entity field. Replaced, consumed or voided challenges are deleted. The explicit CHAR JDBC mapping matches Liquibase validation.

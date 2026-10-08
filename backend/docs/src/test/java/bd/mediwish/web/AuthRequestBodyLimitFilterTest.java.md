# `AuthRequestBodyLimitFilterTest.java`

Source: [AuthRequestBodyLimitFilterTest.java](../../../../../../../src/test/java/bd/mediwish/web/AuthRequestBodyLimitFilterTest.java)

A JSON body exactly at 16 KiB reaches the chain intact; oversized bodies are refused regardless of declared length. Other methods/routes/content types pass normally. Administrative search POST and role PUT are also bounded before JSON parsing and return a safe INVALID_REQUEST envelope.

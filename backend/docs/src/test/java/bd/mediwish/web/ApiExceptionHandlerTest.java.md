# `ApiExceptionHandlerTest.java`

Source: [ApiExceptionHandlerTest.java](../../../../../../../src/test/java/bd/mediwish/web/ApiExceptionHandlerTest.java)

Standalone MockMvc checks each domain failure maps to its bounded correlated status/code, including Ticket 08's STALE_UPDATE, ROLE_CHANGE_REFUSED and NOT_FOUND. Unreadable JSON never echoes private body text. Unsupported media retains 415 for existing routes and returns the frozen 400 INVALID_REQUEST on administrative User commands. Response envelopes expose no diagnostic values.

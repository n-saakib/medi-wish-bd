# `messages.properties`

Source: [messages.properties](../../../../src/main/resources/messages.properties)

Externalized English text for every ApiError, resolved as error.<CODE>. Ticket 08 adds the shared STALE_UPDATE instruction to reload and ROLE_CHANGE_REFUSED message, both matching the frozen contract. Existing messages stay unchanged.

No exception text, SQL details, credentials, searches or private data enters these messages. ApiErrorsTest checks one public message per enum value and the exact bounded English envelope.

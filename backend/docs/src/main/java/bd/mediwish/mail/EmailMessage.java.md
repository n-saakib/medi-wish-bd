# EmailMessage.java

Source: [EmailMessage.java](../../../../../../../src/main/java/bd/mediwish/mail/EmailMessage.java)

## Transient controlled-mail payload

Carries recipient, subject, body and kind only in memory or the explicit local/test mailbox. Its overridden toString exposes only kind, protecting incidental logger/assertion diagnostics. No durable delivery job or replay payload is created.

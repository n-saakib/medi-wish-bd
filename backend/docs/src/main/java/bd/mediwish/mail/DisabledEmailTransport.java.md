# `src/main/java/bd/mediwish/mail/DisabledEmailTransport.java`

Implements EmailTransport without delivering or persisting a message. The only diagnostic is mail.skipped kind=<kind>; recipient, subject and body are never logged. It is the default until the separately planned production provider is delivered.

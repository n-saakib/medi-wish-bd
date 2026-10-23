# `src/main/java/bd/mediwish/mail/MailProperties.java`

Binds app.mail.transport and capture-directory. Binding defaults disable delivery. Sender configuration belongs to the deferred SES adapter because the current capture and disabled transports do not use a sender. Transport selection is validated by MailConfiguration rather than exposing bound values in errors.

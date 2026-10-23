# `AccountMail.java`

Source: [AccountMail.java](../../../../../../../src/main/java/bd/mediwish/auth/AccountMail.java)

Composes verification/reset code mail and password/email-change notices using the eight mail.* messages.properties keys. Only code mail interpolates a code; notices contain no secret or link. AfterCommitMailer receives an independent EMAIL_DELIVERY_FAILED audit callback in a REQUIRES_NEW transaction. Recipients, bodies and codes are not logged or stored as audit data.

# InMemoryEmailTransport.java

Source: [InMemoryEmailTransport.java](../../../../../../../src/main/java/bd/mediwish/mail/InMemoryEmailTransport.java)

## Controlled thread-safe test mailbox

send captures successful messages; messages returns an immutable snapshot and clear empties capture. awaitMessage waits on notification with a monotonic deadline for a matching kind/recipient, without sleeps or polling. failNext deterministically refuses the next requested number of sends before capturing, supporting request/notice-failure integration tests. Never selected outside local/test profiles.

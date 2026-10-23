# InMemoryEmailTransportTest.java

Source: [InMemoryEmailTransportTest.java](../../../../../../../src/test/java/bd/mediwish/mail/InMemoryEmailTransportTest.java)

## Capture and deterministic failure controls

Verifies matching capture, timeout without sleeps, immutable snapshots across clear, and fail-next-N behavior with no capture on failure and recovery after the requested failures. EmailDeliveryException carries no message or cause.

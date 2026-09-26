# `DisconnectableTcpProxyTest.java`

Source: [`src/test/java/bd/mediwish/health/DisconnectableTcpProxyTest.java`](../../../../../../../src/test/java/bd/mediwish/health/DisconnectableTcpProxyTest.java)

## Purpose and test boundary

This unit-level transport test verifies the behavior of `DisconnectableTcpProxy` independently from Spring and PostgreSQL. A local echo server makes byte forwarding observable while the proxy exercises disconnect and reconnect transitions.

## Class and methods

| Member | Behavior and reason |
| --- | --- |
| `cutsEstablishedAndNewConnectionsThenForwardsAgain()` | Starts an echo server and proxy, proves an established connection forwards a byte, disconnects it and observes EOF, proves a new connection is rejected during the outage, reconnects and proves a new byte forwards. It waits for the echo worker and closes all owned resources with try-with-resources. |
| `reportsUnexpectedAcceptFailureOnClose()` | Injects a listener that signals entry and then throws a synthetic `IOException`; closing the proxy deterministically waits for and reports the accept-loop failure. A latch bounds coordination without timing sleeps. |
| `client(int port)` | Opens a loopback client socket to the proxy and applies a two-second read timeout so a broken forwarding path cannot hang the test. |

The test uses virtual threads consistently with the helper and never stops a shared service. The forwarding test also verifies normal listener-close shutdown completes without error.

## Verification

Run with the Maven unit suite (`test`). The test has no external database or network dependency beyond loopback sockets.

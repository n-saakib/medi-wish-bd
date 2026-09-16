# `DisconnectableTcpProxy.java`

Source: [`src/test/java/bd/mediwish/health/DisconnectableTcpProxy.java`](../../../../../../../src/test/java/bd/mediwish/health/DisconnectableTcpProxy.java)

## Purpose and reasoning

`DisconnectableTcpProxy` is a test-only loopback TCP tunnel. It lets an integration test interrupt the application's database sessions and reconnect them without stopping PostgreSQL or touching another test's resources. The helper owns its listener, virtual-thread executor and sockets and is `AutoCloseable` for deterministic cleanup.

## Class fields and methods

| Member | Behavior and reason |
| --- | --- |
| `upstreamHost`, `upstreamPort` | Target PostgreSQL or echo-server endpoint for forwarded connections. |
| `listener`, `executor`, `sockets` | The loopback listener, per-task virtual-thread executor and currently owned sockets. Tracking both sides allows deliberate disconnect to close established tunnels. |
| `connected`, `closed` | Synchronized state flags controlling whether new forwarding is accepted and whether final cleanup has started. |
| `DisconnectableTcpProxy(String host, int port)` | Opens an ephemeral loopback listener with a bounded backlog and starts the accept loop. It does not stop or reconfigure the upstream server. |
| `port()` | Returns the local ephemeral port for the application or test client to use. |
| `disconnect()` | Marks the tunnel disconnected, closes all tracked sockets and clears ownership; established and new sessions then fail locally. |
| `reconnect()` | Allows new sessions to be forwarded again after a deliberate outage. |
| `acceptConnections()` | Accepts local clients while the listener is open and delegates each connection to a virtual thread. A listener-close exception is treated as normal shutdown; other listener failures are surfaced. |
| `forward(Socket incoming)` | Rejects clients while disconnected/closed, otherwise connects to the upstream endpoint with a two-second bound, starts reverse copying and copies the client stream. It closes both sockets and removes them from the owned set in all cases. |
| `copy(Socket source, Socket target)` | Transfers bytes in one direction until close or an injected failure, then closes both sides. Expected disconnect exceptions are swallowed because the test is intentionally cutting the tunnel. |
| `closeSocket(Socket socket)` | Best-effort socket cleanup used during failure and disconnect paths. |
| `close()` | Marks the helper closed, disconnects owned sessions, closes the listener and stops the executor. |

Synchronization protects the connection set and state transitions; the helper is intentionally limited to test transport control rather than production networking.

## Verification

`DisconnectableTcpProxyTest` covers established sessions, new connections during outage, reconnect behavior and cleanup. `HealthIT` uses it to prove readiness recovery without a process restart.

# `ResponseDroppingTcpProxy.java`

Source: [`src/test/java/bd/mediwish/auth/ResponseDroppingTcpProxy.java`](../../../../../../../src/test/java/bd/mediwish/auth/ResponseDroppingTcpProxy.java)

## Purpose and boundary

This test-only, one-request loopback TCP proxy forwards one client request to a loopback HTTP upstream, reads the upstream status and complete response headers, then closes both sockets without forwarding response bytes. Reading a successful upstream status lets `AuthIT` distinguish a committed server operation from a request that failed before producing a response. The helper stores only the status line; it discards header lines without retaining values such as refresh cookies.

The proxy accepts HTTP/1.x loopback upstreams only, owns its listener, sockets and virtual-thread executor, and is closed with try-with-resources. It does not configure, stop or connect to external services. Status-line, line-size and total-header limits bound the test helper's reads.

## Methods

| Method | Behavior |
| --- | --- |
| `ResponseDroppingTcpProxy(URI)` | Validates an HTTP loopback upstream, opens an ephemeral loopback listener and starts the single-connection worker. |
| `port()` | Returns the local port for the client request. |
| `awaitDroppedResponseStatus(Duration)` | Waits for complete upstream response headers and returns the status after the helper has discarded them; timeout or malformed/incomplete headers fail the test. |
| `acceptAndDropResponse()` | Accepts one client, forwards its request on a virtual thread, consumes the upstream status and headers, then closes both sides without forwarding status, cookies or body. |
| `readResponseHeaders(InputStream)` | Parses only the HTTP status line and discards bounded header lines without storing their values. |
| `close()` | Closes owned sockets/listener, waits for its accept task and shuts down its executor. |

## Verification

`ResponseDroppingTcpProxyTest` sends a request through the helper to a loopback fixture that returns HTTP 200 and a synthetic cookie header. It verifies the upstream observes the request, the helper observes status 200, and the client receives zero response bytes. `AuthIT` uses the same helper against the running Spring API; that PostgreSQL-backed case must be run under the guarded test database harness before claiming the session commit/replay assertions passed.

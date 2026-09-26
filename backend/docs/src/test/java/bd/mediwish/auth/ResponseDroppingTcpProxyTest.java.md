# `ResponseDroppingTcpProxyTest.java`

Source: [`src/test/java/bd/mediwish/auth/ResponseDroppingTcpProxyTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/ResponseDroppingTcpProxyTest.java)

## Purpose and seam

This unit test verifies the test-only loopback response-drop proxy with an in-process HTTP fixture, without Spring or PostgreSQL. The fixture accepts a request and emits a successful HTTP response with a synthetic cookie header; the test proves the proxy observes the upstream `200` while forwarding no status, header or body bytes to its client.

## Verification

Run through the backend Maven unit suite (`test`). It uses only owned loopback sockets and closes the fixture server, client, proxy and virtual-thread executor deterministically.

package bd.mediwish.auth;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/** One-request loopback proxy that observes response headers and drops them before they reach the client. */
final class ResponseDroppingTcpProxy implements AutoCloseable {
    private static final int MAX_STATUS_LINE_BYTES = 4_096;
    private static final int MAX_HEADER_LINE_BYTES = 8_192;
    private static final int MAX_HEADER_BYTES = 65_536;

    private final InetAddress upstreamAddress;
    private final int upstreamPort;
    private final ServerSocket listener;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final CountDownLatch responseObserved = new CountDownLatch(1);
    private final Future<?> acceptTask;

    private volatile Socket clientSocket;
    private volatile Socket upstreamSocket;
    private volatile int upstreamStatus;
    private volatile boolean closed;

    ResponseDroppingTcpProxy(URI upstream) throws IOException {
        if (!"http".equalsIgnoreCase(upstream.getScheme()) || upstream.getHost() == null
                || upstream.getPort() < 1 || upstream.getPort() > 65_535) {
            throw new IllegalArgumentException("The response-drop proxy requires a loopback HTTP upstream");
        }
        upstreamAddress = InetAddress.getByName(upstream.getHost());
        if (!upstreamAddress.isLoopbackAddress()) {
            throw new IllegalArgumentException("The response-drop proxy accepts loopback upstreams only");
        }
        upstreamPort = upstream.getPort();
        listener = new ServerSocket(0, 1, InetAddress.getLoopbackAddress());
        acceptTask = executor.submit(this::acceptAndDropResponse);
    }

    int port() {
        return listener.getLocalPort();
    }

    int awaitDroppedResponseStatus(Duration timeout) throws IOException, InterruptedException {
        if (!responseObserved.await(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
            throw new IOException("Timed out waiting for upstream response headers");
        }
        if (upstreamStatus < 100) {
            throw new IOException("The proxy closed before observing complete upstream response headers");
        }
        return upstreamStatus;
    }

    private void acceptAndDropResponse() {
        try {
            clientSocket = listener.accept();
            upstreamSocket = new Socket();
            upstreamSocket.connect(new InetSocketAddress(upstreamAddress, upstreamPort), 2_000);
            Socket incoming = clientSocket;
            Socket upstream = upstreamSocket;
            executor.submit(() -> forwardRequest(incoming, upstream));
            upstreamStatus = readResponseHeaders(upstream.getInputStream());
        } catch (IOException exception) {
            if (!(closed && exception instanceof SocketException)) {
                upstreamStatus = -1;
            }
        } finally {
            responseObserved.countDown();
            closeSocket(clientSocket);
            closeSocket(upstreamSocket);
        }
    }

    private static void forwardRequest(Socket incoming, Socket upstream) {
        try {
            incoming.getInputStream().transferTo(upstream.getOutputStream());
        } catch (IOException ignored) {
            // The upstream response is intentionally cut after its headers are observed.
        }
    }

    private static int readResponseHeaders(InputStream input) throws IOException {
        String statusLine = readStatusLine(input);
        String[] fields = statusLine.split(" ", 3);
        if (fields.length < 2 || !fields[0].matches("HTTP/1\\.[01]") || !fields[1].matches("[1-5][0-9]{2}")) {
            throw new IOException("The upstream did not return a valid HTTP/1 response status");
        }
        int status = Integer.parseInt(fields[1]);
        int headerBytes = statusLine.length() + 2;
        int lineBytes;
        do {
            lineBytes = discardHeaderLine(input);
            headerBytes += lineBytes + 2;
            if (headerBytes > MAX_HEADER_BYTES) {
                throw new IOException("The upstream response headers exceeded the test proxy limit");
            }
        } while (lineBytes != 0);
        return status;
    }

    private static String readStatusLine(InputStream input) throws IOException {
        var line = new ByteArrayOutputStream();
        while (line.size() <= MAX_STATUS_LINE_BYTES) {
            int value = input.read();
            if (value < 0) throw new EOFException("Upstream closed before its HTTP status line");
            if (value == '\r') {
                if (input.read() != '\n') throw new IOException("Malformed upstream HTTP status line");
                return line.toString(StandardCharsets.US_ASCII);
            }
            if (value == '\n' || value > 0x7f) throw new IOException("Malformed upstream HTTP status line");
            line.write(value);
        }
        throw new IOException("The upstream HTTP status line exceeded the test proxy limit");
    }

    /** Reads a CRLF-terminated header line without retaining header values such as Set-Cookie. */
    private static int discardHeaderLine(InputStream input) throws IOException {
        int length = 0;
        while (length <= MAX_HEADER_LINE_BYTES) {
            int value = input.read();
            if (value < 0) throw new EOFException("Upstream closed before its HTTP headers completed");
            if (value == '\r') {
                if (input.read() != '\n') throw new IOException("Malformed upstream HTTP response headers");
                return length;
            }
            if (value == '\n') throw new IOException("Malformed upstream HTTP response headers");
            length++;
        }
        throw new IOException("An upstream HTTP header line exceeded the test proxy limit");
    }

    private static void closeSocket(Socket socket) {
        if (socket == null) return;
        try {
            socket.close();
        } catch (IOException ignored) {
            // Best-effort cleanup of sockets owned by this one-request test proxy.
        }
    }

    @Override
    public void close() throws IOException {
        closed = true;
        IOException closeFailure = null;
        try {
            listener.close();
        } catch (IOException exception) {
            closeFailure = exception;
        }
        closeSocket(clientSocket);
        closeSocket(upstreamSocket);
        try {
            acceptTask.get(5, TimeUnit.SECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            closeFailure = new IOException("Interrupted while closing the test response-drop proxy");
        } catch (ExecutionException exception) {
            closeFailure = new IOException("The test response-drop proxy failed", exception.getCause());
        } catch (java.util.concurrent.TimeoutException exception) {
            closeFailure = new IOException("Timed out while closing the test response-drop proxy");
        } finally {
            executor.shutdownNow();
            try {
                if (!executor.awaitTermination(5, TimeUnit.SECONDS) && closeFailure == null) {
                    closeFailure = new IOException("Timed out while stopping the test response-drop proxy workers");
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                closeFailure = new IOException("Interrupted while stopping the test response-drop proxy workers");
            }
        }
        if (closeFailure != null) throw closeFailure;
    }
}

package bd.mediwish.health;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Disconnects this test's sessions without stopping the shared PostgreSQL server. */
final class DisconnectableTcpProxy implements AutoCloseable {
    private final String upstreamHost;
    private final int upstreamPort;
    private final ServerSocket listener;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final Set<Socket> sockets = new HashSet<>();
    private boolean connected = true;
    private boolean closed;

    DisconnectableTcpProxy(String host, int port) throws IOException {
        upstreamHost = host;
        upstreamPort = port;
        listener = new ServerSocket(0, 32, InetAddress.getLoopbackAddress());
        executor.submit(this::acceptConnections);
    }

    int port() { return listener.getLocalPort(); }

    synchronized void disconnect() {
        connected = false;
        sockets.forEach(DisconnectableTcpProxy::closeSocket);
        sockets.clear();
    }

    synchronized void reconnect() { connected = true; }

    private void acceptConnections() {
        while (!listener.isClosed()) {
            try {
                var incoming = listener.accept();
                executor.submit(() -> forward(incoming));
            } catch (IOException exception) {
                if (!listener.isClosed()) throw new IllegalStateException("Test proxy listener failed");
            }
        }
    }

    private void forward(Socket incoming) {
        Socket upstream = new Socket();
        synchronized (this) {
            if (!connected || closed) {
                closeSocket(incoming);
                closeSocket(upstream);
                return;
            }
            sockets.add(incoming);
            sockets.add(upstream);
        }
        try {
            upstream.connect(new InetSocketAddress(upstreamHost, upstreamPort), 2000);
            executor.submit(() -> copy(upstream, incoming));
            copy(incoming, upstream);
        } catch (IOException ignored) {
            // A deliberate disconnect or stopped echo/database server ends only this tunnel.
        } finally {
            closeSocket(incoming);
            closeSocket(upstream);
            synchronized (this) {
                sockets.remove(incoming);
                sockets.remove(upstream);
            }
        }
    }

    private static void copy(Socket source, Socket target) {
        try {
            source.getInputStream().transferTo(target.getOutputStream());
        } catch (IOException ignored) {
            // Expected when either side closes or the test injects connection loss.
        } finally {
            closeSocket(source);
            closeSocket(target);
        }
    }

    private static void closeSocket(Socket socket) {
        try { socket.close(); } catch (IOException ignored) { /* best-effort tunnel cleanup */ }
    }

    @Override
    public synchronized void close() throws IOException {
        closed = true;
        disconnect();
        listener.close();
        executor.shutdownNow();
    }
}

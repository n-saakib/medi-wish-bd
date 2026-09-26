package bd.mediwish.health;

import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class DisconnectableTcpProxyTest {
    @Test
    void cutsEstablishedAndNewConnectionsThenForwardsAgain() throws Exception {
        try (var server = new ServerSocket(0, 8, InetAddress.getLoopbackAddress());
             var executor = Executors.newVirtualThreadPerTaskExecutor();
             var proxy = new DisconnectableTcpProxy("127.0.0.1", server.getLocalPort())) {
            server.setSoTimeout(3000);
            var echoes = executor.submit(() -> {
                for (int index = 0; index < 2; index++) {
                    try (var connection = server.accept()) {
                        var input = connection.getInputStream();
                        int value;
                        while ((value = input.read()) != -1) {
                            connection.getOutputStream().write(value);
                            connection.getOutputStream().flush();
                        }
                    }
                }
                return true;
            });
            try (var first = client(proxy.port())) {
                first.getOutputStream().write(42);
                assertThat(first.getInputStream().read()).isEqualTo(42);
                proxy.disconnect();
                assertThat(first.getInputStream().read()).isEqualTo(-1);
            }
            try (var rejected = client(proxy.port())) {
                assertThat(rejected.getInputStream().read()).isEqualTo(-1);
            }
            proxy.reconnect();
            try (var recovered = client(proxy.port())) {
                recovered.getOutputStream().write(7);
                assertThat(recovered.getInputStream().read()).isEqualTo(7);
            }
            assertThat(echoes.get(3, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void reportsUnexpectedAcceptFailureOnClose() throws Exception {
        var acceptStarted = new CountDownLatch(1);
        var listener = new ServerSocket() {
            @Override
            public Socket accept() throws IOException {
                acceptStarted.countDown();
                throw new IOException("synthetic accept failure");
            }
        };
        var proxy = new DisconnectableTcpProxy("127.0.0.1", 0, listener);
        boolean acceptWasStarted;
        Throwable closeFailure;
        try {
            acceptWasStarted = acceptStarted.await(5, TimeUnit.SECONDS);
        } finally {
            closeFailure = catchThrowable(proxy::close);
        }

        assertThat(acceptWasStarted).isTrue();
        assertThat(closeFailure)
                .isInstanceOf(IOException.class)
                .hasMessage("Test proxy listener failed")
                .hasCauseInstanceOf(IOException.class);
        assertThat(closeFailure.getCause()).hasMessage("synthetic accept failure");
    }

    private Socket client(int port) throws Exception {
        var socket = new Socket("127.0.0.1", port);
        socket.setSoTimeout(2000);
        return socket;
    }
}

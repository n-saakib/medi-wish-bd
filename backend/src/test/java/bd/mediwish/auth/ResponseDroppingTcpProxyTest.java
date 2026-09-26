package bd.mediwish.auth;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ResponseDroppingTcpProxyTest {
    @Test
    void observesSuccessfulUpstreamHeadersWithoutForwardingAnyResponseBytes() throws Exception {
        try (var upstream = new ServerSocket(0, 1, InetAddress.getLoopbackAddress());
             var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            upstream.setSoTimeout(5_000);
            var response = executor.submit(() -> {
                try (Socket connection = upstream.accept()) {
                    var request = new BufferedReader(new InputStreamReader(
                            connection.getInputStream(), StandardCharsets.US_ASCII));
                    String line;
                    do {
                        line = request.readLine();
                    } while (line != null && !line.isEmpty());
                    assertThat(line).isEmpty();
                    connection.getOutputStream().write(("HTTP/1.1 200 OK\r\n"
                            + "Content-Length: 4\r\n"
                            + "Set-Cookie: MW_REFRESH=synthetic-only\r\n"
                            + "Connection: close\r\n\r\nbody").getBytes(StandardCharsets.US_ASCII));
                    connection.getOutputStream().flush();
                    return true;
                }
            });

            URI upstreamUri = URI.create("http://127.0.0.1:" + upstream.getLocalPort());
            try (var proxy = new ResponseDroppingTcpProxy(upstreamUri);
                 var client = new Socket(InetAddress.getLoopbackAddress(), proxy.port())) {
                client.setSoTimeout(5_000);
                client.getOutputStream().write(("GET / HTTP/1.1\r\n"
                        + "Host: local.test\r\n"
                        + "Connection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                client.getOutputStream().flush();

                assertThat(client.getInputStream().readAllBytes().length)
                        .as("the proxy never forwards response status, Set-Cookie headers or body")
                        .isZero();
                assertThat(proxy.awaitDroppedResponseStatus(Duration.ofSeconds(5))).isEqualTo(200);
            }
            assertThat(response.get(5, TimeUnit.SECONDS)).isTrue();
        }
    }
}

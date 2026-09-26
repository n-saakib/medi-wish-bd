package bd.mediwish.testsupport;

import bd.mediwish.MediWishApplication;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * One running application on a random port and the HTTP client that calls it. Every response is checked for the
 * contract all routes share: {@code Cache-Control: no-store} and a server-generated {@code X-Request-ID}.
 */
public final class TestApplication implements AutoCloseable {
    public static final String UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

    private final Map<String, Object> properties;
    private final Class<?>[] sources;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private ConfigurableApplicationContext context;
    private URI base;

    private TestApplication(Map<String, Object> properties, Class<?>[] sources) {
        this.properties = Map.copyOf(properties);
        this.sources = sources;
    }

    /** Starts the application, plus any test configuration, with the given properties taking precedence. */
    public static TestApplication start(Map<String, Object> properties, Class<?>... testConfigurations) {
        var application = new TestApplication(properties, testConfigurations);
        application.run();
        return application;
    }

    /** Stops the application and starts it again with the same properties; the schema is kept. */
    public void restart() {
        context.close();
        run();
    }

    /**
     * Runs the application, plus any test configuration, under the local {@code test} profile with the given
     * properties taking precedence; for callers that manage the context themselves.
     */
    public static ConfigurableApplicationContext launch(Map<String, Object> properties, Class<?>... testConfigurations) {
        Class<?>[] all = new Class<?>[testConfigurations.length + 1];
        all[0] = MediWishApplication.class;
        System.arraycopy(testConfigurations, 0, all, 1, testConfigurations.length);
        var launcher = new SpringApplication(all);
        launcher.setAdditionalProfiles("test");
        launcher.addInitializers(initialized -> initialized.getEnvironment().getPropertySources()
                .addFirst(new MapPropertySource("integration-test", properties)));
        return launcher.run();
    }

    private void run() {
        context = launch(properties, sources);
        base = URI.create("http://127.0.0.1:" + context.getEnvironment().getRequiredProperty("local.server.port"));
    }

    public <T> T bean(Class<T> type) {
        return context.getBean(type);
    }

    public URI uri(String path) {
        return base.resolve(path);
    }

    /** Sends one request; a caller {@code X-Request-ID} (random when absent) must never be echoed. */
    public HttpResponse<String> send(String method, String path, Map<String, String> headers, String body)
            throws IOException, InterruptedException {
        String callerRequestId = headers.getOrDefault("X-Request-ID", UUID.randomUUID().toString());
        var request = HttpRequest.newBuilder(uri(path)).timeout(Duration.ofSeconds(10))
                .method(method, body == null
                        ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        headers.forEach(request::setHeader);
        request.setHeader("X-Request-ID", callerRequestId);
        var response = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
        assertThat(response.headers().allValues("Cache-Control")).containsExactly("no-store");
        assertThat(response.headers().allValues("X-Request-ID")).singleElement().asString()
                .matches(UUID_PATTERN).isNotEqualTo(callerRequestId);
        return response;
    }

    @Override
    public void close() {
        try {
            if (context != null) context.close();
        } finally {
            client.close();
        }
    }
}

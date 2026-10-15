package bd.mediwish.catalog;

import bd.mediwish.storage.StorageProperties;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import javax.imageio.ImageIO;
import static org.assertj.core.api.Assertions.assertThat;

/** Real multipart/public HTTP companion to the guarded PostgreSQL catalog fixture. */
final class ProductImageTestApi implements AutoCloseable {
    final CatalogTestApi catalog;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private ProductImageTestApi(CatalogTestApi catalog) { this.catalog = catalog; }
    static ProductImageTestApi start() throws Exception { return start(3); }
    static ProductImageTestApi start(int socketTimeoutSeconds) throws Exception { return new ProductImageTestApi(CatalogTestApi.start(socketTimeoutSeconds)); }
    String path(Object productId) { return "/api/staff/products/" + productId + "/images"; }
    HttpResponse<String> upload(CatalogTestApi.Actor actor, Object productId, UUID imageId, byte[] bytes,
            String type, String filename, Map<String, String> fields) throws Exception {
        return upload(uploadRequest(actor, productId, imageId, bytes, type, filename, fields));
    }
    HttpRequest uploadRequest(CatalogTestApi.Actor actor, Object productId, UUID imageId, byte[] bytes,
            String type, String filename, Map<String, String> fields) throws Exception {
        String boundary = "image-" + UUID.randomUUID();
        var body = new ByteArrayOutputStream();
        if (imageId != null) field(body, boundary, "id", imageId.toString());
        for (var entry : fields.entrySet()) field(body, boundary, entry.getKey(), entry.getValue());
        write(body, "--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\""
                + (filename == null ? "" : "; filename=\"" + filename + "\"")
                + "\r\nContent-Type: " + type + "\r\n\r\n");
        body.write(bytes); write(body, "\r\n--" + boundary + "--\r\n");
        var request = HttpRequest.newBuilder(catalog.application().uri(path(productId))).timeout(Duration.ofSeconds(15))
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()));
        if (actor != null) request.header("Authorization", "Bearer " + actor.token());
        return request.build();
    }
    HttpResponse<String> upload(HttpRequest request) throws Exception {
        var response = client.send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.headers().allValues("Cache-Control")).containsExactly("no-store");
        assertThat(response.headers().allValues("X-Request-ID")).singleElement().asString()
                .matches(bd.mediwish.testsupport.TestApplication.UUID_PATTERN);
        return response;
    }
    HttpResponse<byte[]> publicImage(String method, String path) throws Exception {
        return client.send(HttpRequest.newBuilder(catalog.application().uri(path)).timeout(Duration.ofSeconds(10))
                .method(method, HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofByteArray());
    }
    Path object(Object productId, Object imageId, String extension) {
        var storage = catalog.application().bean(StorageProperties.class);
        return Path.of(storage.localRoot(), storage.namespace(), "products", productId.toString(), imageId + "." + extension);
    }
    long files() throws Exception {
        var storage = catalog.application().bean(StorageProperties.class);
        Path root = Path.of(storage.localRoot(), storage.namespace());
        if (!Files.exists(root)) return 0;
        try (var paths = Files.walk(root)) { return paths.filter(Files::isRegularFile).count(); }
    }
    static byte[] png(int width, int height) throws Exception {
        var image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) image.setRGB(x, y, 0xff428ac2);
        var out = new ByteArrayOutputStream(); ImageIO.write(image, "png", out); return out.toByteArray();
    }
    private static void field(ByteArrayOutputStream out, String boundary, String name, String value) {
        write(out, "--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + value + "\r\n");
    }
    private static void write(ByteArrayOutputStream out, String text) { out.writeBytes(text.getBytes(StandardCharsets.UTF_8)); }
    @Override public void close() throws Exception { try { client.close(); } finally { catalog.close(); } }
}
package bd.mediwish.catalog;
import bd.mediwish.storage.ObjectStorage;
import bd.mediwish.web.WebTestFixtures;
import org.junit.jupiter.api.Test;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Optional;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
class PublicProductImageControllerTest {
    private static final String FILE = "8a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b.png";
    private final ProductImageService service = mock(ProductImageService.class);
    private final org.springframework.test.web.servlet.MockMvc mvc = WebTestFixtures.catalogMvc(new PublicProductImageController(service));
    static class ObservedStream extends ByteArrayInputStream {
        boolean closed; int reads;
        ObservedStream() { super(new byte[]{1,2,3}); }
        @Override public synchronized int read(byte[] bytes, int offset, int count) { reads++; return super.read(bytes, offset, count); }
        @Override public long transferTo(java.io.OutputStream output) throws IOException { reads++; return super.transferTo(output); }
        @Override public void close() { closed = true; }
    }
    @Test void getReplacesNoStoreOnceAndClosesTheObject() throws Exception {
        var stream = new ObservedStream(); when(service.findPublic(FILE)).thenReturn(Optional.of(
                new ProductImageViews.PublicImage("image/png", new ObjectStorage.StoredObject(3, stream))));
        var response = mvc.perform(get("/api/public/product-images/" + FILE)).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "public, max-age=60"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("Content-Security-Policy", "default-src 'none'; sandbox"))
                .andExpect(header().string("Content-Disposition", "inline"))
                .andExpect(header().string("Content-Length", "3")).andReturn().getResponse();
        assertThat(response.getHeaders("Cache-Control")).containsExactly("public, max-age=60");
        assertThat(response.getContentAsByteArray()).containsExactly((byte)1,(byte)2,(byte)3); assertThat(stream.closed).isTrue();
    }
    @Test void headClosesWithoutReading() throws Exception {
        var stream = new ObservedStream(); when(service.findPublic(FILE)).thenReturn(Optional.of(
                new ProductImageViews.PublicImage("image/png", new ObjectStorage.StoredObject(3, stream))));
        mvc.perform(head("/api/public/product-images/" + FILE)).andExpect(status().isOk());
        assertThat(stream.closed).isTrue(); assertThat(stream.reads).isZero();
    }
    @Test void malformedNamesNeverReachServiceAndMissingObjectsKeepNoStore() throws Exception {
        for (String file : new String[]{"private.png", FILE.toUpperCase(), FILE.replace(".png", ".svg")})
            mvc.perform(get("/api/public/product-images/" + file)).andExpect(status().isNotFound());
        verifyNoInteractions(service); when(service.findPublic(FILE)).thenReturn(Optional.empty());
        mvc.perform(get("/api/public/product-images/" + FILE)).andExpect(status().isNotFound())
                .andExpect(header().string("Cache-Control", "no-store"));
    }
    @Test void writeFailureClosesTheObject() {
        var stream = new ObservedStream(); when(service.findPublic(FILE)).thenReturn(Optional.of(
                new ProductImageViews.PublicImage("image/png", new ObjectStorage.StoredObject(3, stream))));
        var response = new org.springframework.mock.web.MockHttpServletResponse() {
            @Override public jakarta.servlet.ServletOutputStream getOutputStream() { throw new IllegalStateException("write refused"); }
        };
        assertThatThrownBy(() -> new PublicProductImageController(service).get(FILE,
                new org.springframework.mock.web.MockHttpServletRequest("GET", "/"), response)).isInstanceOf(IllegalStateException.class);
        assertThat(stream.closed).isTrue();
    }
}

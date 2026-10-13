package bd.mediwish.catalog;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.mock.web.MockMultipartHttpServletRequest;
import tools.jackson.databind.json.JsonMapper;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
class ProductImageRequestsTest {
    private static final String ID = "8a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b";
    private final JsonMapper json = JsonMapper.builder().build();
    private MockMultipartHttpServletRequest upload() {
        var request = new MockMultipartHttpServletRequest(); request.addParameter("id", ID);
        request.addFile(new MockMultipartFile("file", "front.png", "image/png", new byte[]{1})); return request;
    }
    @Test void uploadAcceptsOneFileAndPlainId() {
        assertThat(ProductImageRequests.upload(upload()).id()).isEqualTo(UUID.fromString(ID));
    }
    @Test void uploadRejectsUnknownDuplicateAndMisclassifiedParts() {
        var unknown = upload(); unknown.addParameter("url", "http://private.invalid");
        var duplicate = upload(); duplicate.addFile(new MockMultipartFile("file", "other.png", "image/png", new byte[]{2}));
        var repeated = upload(); repeated.addParameter("id", ID);
        var fieldFile = new MockMultipartHttpServletRequest(); fieldFile.addParameter("id", ID); fieldFile.addParameter("file", "bytes");
        var fileField = upload(); fileField.addFile(new MockMultipartFile("altText", "description", "text/plain", new byte[]{1}));
        for (var request : new MockMultipartHttpServletRequest[]{unknown, duplicate, repeated, fieldFile, fileField})
            assertThatThrownBy(() -> ProductImageRequests.upload(request)).isInstanceOf(InvalidCatalogException.class);
    }
    @Test void uploadRejectsMissingMalformedIdsAndInvalidReplacement() {
        for (String id : new String[]{"", "private", "1-1-1-1-1"}) {
            var request = upload(); request.setParameter("id", id);
            assertThatThrownBy(() -> ProductImageRequests.upload(request)).isInstanceOf(InvalidCatalogException.class);
        }
        var missing = upload(); missing.removeParameter("id"); var replaces = upload(); replaces.addParameter("replaces", "bad");
        for (var request : new MockMultipartHttpServletRequest[]{missing, replaces})
            assertThatThrownBy(() -> ProductImageRequests.upload(request)).isInstanceOf(InvalidCatalogException.class);
    }
    @Test void altRequiresExplicitNullableTextAndNonnegativeVersion() {
        assertThat(ProductImageRequests.alt(json.readTree("{\"altText\":null,\"version\":0}")).altText()).isNull();
        for (String body : new String[]{"{}", "{\"version\":0}", "{\"altText\":1,\"version\":0}", "{\"altText\":null}",
                "{\"altText\":null,\"version\":-1}", "{\"altText\":null,\"version\":0,\"url\":null}"})
            assertThatThrownBy(() -> ProductImageRequests.alt(json.readTree(body))).isInstanceOf(InvalidCatalogException.class);
    }
    @Test void orderRequiresUniqueIdsAndIdenticalSets() {
        String good = "{\"imageIds\":[\"" + ID + "\"],\"expectedImageIds\":[\"" + ID + "\"]}";
        assertThat(ProductImageRequests.order(json.readTree(good)).imageIds()).containsExactly(UUID.fromString(ID));
        for (String body : new String[]{"{}", "{\"imageIds\":[],\"expectedImageIds\":null}",
                "{\"imageIds\":[1],\"expectedImageIds\":[1]}", "{\"imageIds\":[\"bad\"],\"expectedImageIds\":[\"bad\"]}",
                good.replace("[\"" + ID + "\"]", "[\"" + ID + "\",\"" + ID + "\"]"),
                "{\"imageIds\":[],\"expectedImageIds\":[\"" + ID + "\"]}"})
            assertThatThrownBy(() -> ProductImageRequests.order(json.readTree(body))).isInstanceOf(InvalidCatalogException.class);
    }
}

package bd.mediwish.catalog;
import bd.mediwish.storage.ObjectStorage;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
final class ProductImageViews {
    private ProductImageViews() {}
    record ImageView(UUID id, String url, String contentType, int width, int height, int byteSize,
        String altText, int position, long version, Instant createdAt) {}
    record ImageList(List<ImageView> images, int maxImages) {}
    record ImageCreation(ImageView value, boolean created) {}
    record PublicImage(String contentType, ObjectStorage.StoredObject object) {}
}

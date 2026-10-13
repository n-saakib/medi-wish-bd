package bd.mediwish.catalog;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartHttpServletRequest;
import tools.jackson.databind.JsonNode;
import java.io.IOException;

@RestController
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/staff/products/{productId}")
class ProductImageController {
    private final ProductImageService images;
    ProductImageController(ProductImageService images) { this.images = images; }
    @GetMapping("/images")
    ProductImageViews.ImageList list(@PathVariable String productId, @AuthenticationPrincipal CurrentUser current) {
        return images.list(CatalogRequests.uuid(productId), current);
    }
    @PostMapping(path = "/images", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    ResponseEntity<ProductImageViews.ImageView> upload(@PathVariable String productId,
            MultipartHttpServletRequest body, @AuthenticationPrincipal CurrentUser current) throws IOException {
        CatalogAuthorization.require(current, CatalogArea.CATALOG);
        var request = ProductImageRequests.upload(body);
        var created = images.upload(CatalogRequests.uuid(productId), request.id(), request.file().getBytes(),
                request.file().getContentType(), request.file().getOriginalFilename(), request.altText(), request.replaces(), current);
        return ResponseEntity.status(created.created() ? 201 : 200).body(created.value());
    }
    @PutMapping("/images/{imageId}")
    ProductImageViews.ImageView update(@PathVariable String productId, @PathVariable String imageId,
            @RequestBody JsonNode body, @AuthenticationPrincipal CurrentUser current) {
        var request = ProductImageRequests.alt(body);
        return images.updateAltText(CatalogRequests.uuid(productId), CatalogRequests.uuid(imageId), request.altText(), request.version(), current);
    }
    @PutMapping("/image-order")
    ProductImageViews.ImageList reorder(@PathVariable String productId, @RequestBody JsonNode body,
            @AuthenticationPrincipal CurrentUser current) {
        var request = ProductImageRequests.order(body);
        return images.reorder(CatalogRequests.uuid(productId), request.imageIds(), request.expectedImageIds(), current);
    }
    @DeleteMapping("/images/{imageId}")
    ResponseEntity<Void> remove(@PathVariable String productId, @PathVariable String imageId,
            @AuthenticationPrincipal CurrentUser current) {
        images.remove(CatalogRequests.uuid(productId), CatalogRequests.uuid(imageId), current);
        return ResponseEntity.noContent().build();
    }
}

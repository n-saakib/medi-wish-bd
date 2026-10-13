package bd.mediwish.catalog;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;

@RestController
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/public/product-images")
class PublicProductImageController {
    private final ProductImageService images;
    PublicProductImageController(ProductImageService images) { this.images = images; }
    @GetMapping("/{fileName}")
    void get(@PathVariable String fileName, HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!fileName.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png)"))
            throw new CatalogNotFoundException();
        var image = images.findPublic(fileName).orElseThrow(CatalogNotFoundException::new);
        try (var content = image.object().content()) {
            response.setContentType(image.contentType());
            response.setContentLengthLong(image.object().length());
            response.setHeader("Cache-Control", "public, max-age=60");
            response.setHeader("X-Content-Type-Options", "nosniff");
            response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
            response.setHeader("Content-Disposition", "inline");
            if (!request.getMethod().equals("HEAD")) content.transferTo(response.getOutputStream());
        }
    }
}

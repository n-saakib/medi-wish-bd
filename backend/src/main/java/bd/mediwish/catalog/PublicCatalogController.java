package bd.mediwish.catalog;

import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/** Anonymous HTTP reads of the public catalog projections. */
@RestController
class PublicCatalogController {
    private final PublicCatalogService catalog;

    PublicCatalogController(PublicCatalogService catalog) {
        this.catalog = catalog;
    }

    @GetMapping("/api/categories")
    PublicCategoryList categories() {
        return catalog.categories();
    }

    @GetMapping("/api/categories/{id}/products")
    PublicCategoryPage products(@PathVariable String id, @RequestParam MultiValueMap<String, String> query) {
        UUID categoryId = id(id);
        List<String> values = query.get("page");
        int page = values == null ? 0 : page(values);
        return catalog.categoryPage(categoryId, page);
    }

    @GetMapping("/api/products/{id}")
    PublicProductDetails product(@PathVariable String id) {
        return catalog.product(id(id));
    }

    private static UUID id(String raw) {
        try { return CatalogRequests.uuid(raw); }
        catch (InvalidCatalogException invalid) { throw new CatalogNotFoundException(); }
    }

    private static int page(List<String> values) {
        if (values.size() != 1) throw new CatalogNotFoundException();
        String raw = values.getFirst();
        if (raw == null || !raw.matches("0|[1-9][0-9]{0,8}")) throw new CatalogNotFoundException();
        return Integer.parseInt(raw);
    }
}

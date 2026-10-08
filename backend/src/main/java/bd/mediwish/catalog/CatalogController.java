package bd.mediwish.catalog;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

/** Staff catalog HTTP boundary; permissions are enforced by the security chain and mutation services. */
@RestController
@RequestMapping("/api/staff")
class CatalogController {
    private final CategoryService categories;
    private final ProductService products;

    CatalogController(CategoryService categories, ProductService products) {
        this.categories = categories;
        this.products = products;
    }

    @GetMapping("/categories")
    CatalogPage<CategoryView> listCategories(@RequestParam(required = false) String includeInactive,
                                              @RequestParam(required = false) String page,
                                              @RequestParam(required = false) String size) {
        int pageNumber = CatalogRequests.page(page);
        int pageSize = CatalogRequests.size(size);
        return categories.list(CatalogRequests.queryBoolean(includeInactive, true), pageNumber, pageSize);
    }

    @GetMapping("/products")
    CatalogPage<ProductSummary> listProducts(@RequestParam(required = false) String q,
                                             @RequestParam(required = false) String categoryId,
                                             @RequestParam(required = false) String status,
                                             @RequestParam(required = false) String reviewRequired,
                                             @RequestParam(required = false) String page,
                                             @RequestParam(required = false) String size) {
        return products.list(CatalogRequests.query(q), categoryId == null ? null : CatalogRequests.uuid(categoryId),
                CatalogRequests.status(status), CatalogRequests.queryBoolean(reviewRequired, false),
                CatalogRequests.page(page), CatalogRequests.size(size));
    }

    @GetMapping("/products/{id}")
    ProductView getProduct(@PathVariable String id) {
        return products.get(CatalogRequests.uuid(id));
    }

    @PutMapping("/products/{id}")
    ProductView updateCatalog(@PathVariable String id, @RequestBody JsonNode body,
                               @AuthenticationPrincipal CurrentUser current) {
        var request = CatalogRequests.productUpdate(body);
        return products.updateCatalog(CatalogRequests.uuid(id), request.fields(), request.version(), current);
    }

    @PutMapping("/products/{id}/pricing")
    ProductView updatePricing(@PathVariable String id, @RequestBody JsonNode body,
                               @AuthenticationPrincipal CurrentUser current) {
        var request = CatalogRequests.pricingUpdate(body);
        return products.updatePricing(CatalogRequests.uuid(id), request.sellingPrice(), request.mrp(), request.version(), current);
    }

    @PostMapping("/products")
    ResponseEntity<ProductView> createProduct(@RequestBody JsonNode body,
                                              @AuthenticationPrincipal CurrentUser current) {
        var request = CatalogRequests.productCreate(body);
        var result = products.create(request.id(), request.kind(), request.fields(), current);
        return ResponseEntity.status(result.created() ? 201 : 200).body(result.value());
    }

    @PutMapping("/categories/{id}")
    CategoryView updateCategory(@PathVariable String id, @RequestBody JsonNode body,
                                @AuthenticationPrincipal CurrentUser current) {
        var request = CatalogRequests.categoryUpdate(body);
        return categories.update(CatalogRequests.uuid(id), request.name(), request.active(), request.version(), current);
    }

    @PostMapping("/categories")
    ResponseEntity<CategoryView> createCategory(@RequestBody JsonNode body,
                                               @AuthenticationPrincipal CurrentUser current) {
        var request = CatalogRequests.categoryCreate(body);
        var result = categories.create(request.id(), request.name(), current);
        return ResponseEntity.status(result.created() ? 201 : 200).body(result.value());
    }
}
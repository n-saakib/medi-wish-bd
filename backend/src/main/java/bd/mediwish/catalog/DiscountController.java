package bd.mediwish.catalog;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

/** Admin discount HTTP adapter. Authentication and body bounds are enforced by the security chain. */
@RestController
@RequestMapping("/api/staff/discounts")
class DiscountController {
    private final DiscountService discounts;

    DiscountController(DiscountService discounts) { this.discounts = discounts; }

    @GetMapping
    DiscountPage list(@RequestParam(required = false) String status,
                      @RequestParam(required = false) String page,
                      @RequestParam(required = false) String size,
                      @AuthenticationPrincipal CurrentUser current) {
        return discounts.list(DiscountRequests.status(status), CatalogRequests.page(page), CatalogRequests.size(size), current);
    }

    @PostMapping
    ResponseEntity<DiscountView> create(@RequestBody JsonNode body, @AuthenticationPrincipal CurrentUser current) {
        var result = discounts.create(DiscountRequests.create(body), current);
        return ResponseEntity.status(result.created() ? 201 : 200).body(result.value());
    }

    @PutMapping("/{id}")
    DiscountView update(@PathVariable String id, @RequestBody JsonNode body,
                        @AuthenticationPrincipal CurrentUser current) {
        return discounts.update(CatalogRequests.uuid(id), DiscountRequests.update(body), current);
    }

    @PostMapping("/{id}/end")
    DiscountView end(@PathVariable String id, @RequestBody JsonNode body,
                     @AuthenticationPrincipal CurrentUser current) {
        return discounts.end(CatalogRequests.uuid(id), DiscountRequests.end(body).version(), current);
    }
}

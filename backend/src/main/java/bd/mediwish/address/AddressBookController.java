package bd.mediwish.address;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;
import java.util.Set;
import java.util.UUID;

/** Owner-only JSON adapter. Parsing precedes account and field checks in the service. */
@RestController
@RequestMapping("/api/user/me/addresses")
public class AddressBookController {
    private final AddressBookService books;
    public AddressBookController(AddressBookService books) { this.books = books; }

    @GetMapping
    AddressBookView book(@AuthenticationPrincipal(expression = "userId") UUID userId) { return books.book(userId); }

    @PostMapping
    ResponseEntity<AddressBookView> create(@AuthenticationPrincipal(expression = "userId") UUID userId,
                                          @RequestBody JsonNode body) {
        requireKeys(body, Set.of("id", "label", "recipientName", "mobile", "addressLine", "city", "isDefault"));
        UUID id = uuid(text(body.get("id")), "id");
        var result = books.create(userId, id, fields(body), defaultValue(body));
        return ResponseEntity.status(result.created() ? 201 : 200).body(result.book());
    }

    @PutMapping("/{id}")
    AddressBookView update(@AuthenticationPrincipal(expression = "userId") UUID userId,
                           @PathVariable String id, @RequestBody JsonNode body) {
        requireKeys(body, Set.of("label", "recipientName", "mobile", "addressLine", "city", "isDefault", "version"));
        var version = body.get("version");
        if (!version.isIntegralNumber() || !version.canConvertToLong() || version.longValue() < 0)
            throw new InvalidAddressException("version");
        return books.update(userId, uuid(id, "id"), fields(body), defaultValue(body), version.longValue());
    }

    @DeleteMapping("/{id}")
    AddressBookView delete(@AuthenticationPrincipal(expression = "userId") UUID userId,
                           @PathVariable String id, @RequestParam(required = false) String version) {
        if (version == null || !version.matches("[0-9]{1,18}")) throw new InvalidAddressException("version");
        return books.delete(userId, uuid(id, "id"), Long.parseLong(version));
    }

    private static AddressFields fields(JsonNode body) {
        return new AddressFields(text(body.get("label")), text(body.get("recipientName")), text(body.get("mobile")),
                text(body.get("addressLine")), text(body.get("city")));
    }
    private static boolean defaultValue(JsonNode body) {
        if (!body.get("isDefault").isBoolean()) throw new InvalidAddressException("isDefault");
        return body.get("isDefault").booleanValue();
    }
    private static void requireKeys(JsonNode body, Set<String> keys) {
        if (body == null || !body.isObject() || !Set.copyOf(body.propertyNames()).equals(keys))
            throw new InvalidAddressException("body");
    }
    private static String text(JsonNode value) {
        if (value.isNull()) return null;
        if (!value.isString()) throw new InvalidAddressException("body");
        return value.stringValue();
    }
    private static UUID uuid(String value, String field) {
        if (value == null || !value.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))
            throw new InvalidAddressException(field);
        return UUID.fromString(value);
    }
}

package bd.mediwish.admin;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.auth.InvalidRequestException;
import bd.mediwish.auth.RoleAssignmentService;
import bd.mediwish.user.UserRole;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** Administrative role routes; strict JSON parsing keeps coercion and unknown properties out of commands. */
@RestController
@RequestMapping("/api/admin/users")
class AdminUserController {
    private static final Pattern UUID_TEXT = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private final RoleAssignmentService roles;

    AdminUserController(RoleAssignmentService roles) { this.roles = roles; }

    record Search(String username, UserRole role, int page, int size) {}
    record RoleCommand(UserRole role, long rolesVersion) {}

    @PostMapping(value = "/search", consumes = MediaType.APPLICATION_JSON_VALUE)
    RoleAssignmentService.UserPage search(@RequestBody JsonNode body) {
        Search request = searchRequest(body);
        return roles.search(request.username(), request.role(), request.page(), request.size());
    }

    @GetMapping("/{userId}")
    RoleAssignmentService.UserRoles detail(@AuthenticationPrincipal CurrentUser current, @PathVariable String userId) {
        return roles.detail(userId(userId), current);
    }

    @PutMapping(value = "/{userId}/roles", consumes = MediaType.APPLICATION_JSON_VALUE)
    RoleAssignmentService.UserRoles changeRole(@AuthenticationPrincipal CurrentUser current, @PathVariable String userId,
                                              @RequestBody JsonNode body) {
        RoleCommand command = roleCommand(body);
        return roles.changeRole(current, userId(userId), command.role(), command.rolesVersion());
    }

    private static Search searchRequest(JsonNode body) {
        object(body, Set.of("username", "role", "page", "size"));
        String username = null;
        if (body.has("username")) {
            JsonNode value = body.get("username");
            if (!value.isTextual() || value.asString().length() > 50) throw new InvalidRequestException();
            username = value.asString().trim().toLowerCase(Locale.ROOT);
            if (username.isEmpty()) throw new InvalidRequestException();
        }
        UserRole role = body.has("role") ? role(body.get("role")) : null;
        long page = body.has("page") ? integer(body.get("page")) : 0;
        long size = body.has("size") ? integer(body.get("size")) : 20;
        if (page > Integer.MAX_VALUE || size < 1 || size > 50) throw new InvalidRequestException();
        return new Search(username, role, (int) page, (int) size);
    }

    private static RoleCommand roleCommand(JsonNode body) {
        object(body, Set.of("role", "rolesVersion"));
        return new RoleCommand(role(body.get("role")), integer(body.get("rolesVersion")));
    }

    private static void object(JsonNode body, Set<String> allowed) {
        if (body == null || !body.isObject() || !allowed.containsAll(body.propertyNames())) throw new InvalidRequestException();
    }

    private static UserRole role(JsonNode value) {
        if (value == null || !value.isTextual()) throw new InvalidRequestException();
        try { return UserRole.valueOf(value.asString()); }
        catch (IllegalArgumentException ignored) { throw new InvalidRequestException(); }
    }

    private static long integer(JsonNode value) {
        if (value == null || !value.isIntegralNumber() || !value.canConvertToLong() || value.longValue() < 0) {
            throw new InvalidRequestException();
        }
        return value.longValue();
    }

    private static UUID userId(String value) {
        if (value == null || !UUID_TEXT.matcher(value).matches()) throw new InvalidRequestException();
        return UUID.fromString(value);
    }
}

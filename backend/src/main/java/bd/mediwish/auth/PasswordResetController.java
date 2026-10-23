package bd.mediwish.auth;

import bd.mediwish.user.IdentifierFormats;
import bd.mediwish.user.UserService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;
import java.util.Locale;
import java.util.Set;

/** Strict public recovery commands; account-dependent outcomes remain inside the service. */
@RestController
@RequestMapping("/api/auth/password-reset")
public class PasswordResetController {
    private final PasswordResetService resets;

    public PasswordResetController(PasswordResetService resets) { this.resets = resets; }

    @PostMapping("/request")
    @ResponseStatus(HttpStatus.ACCEPTED)
    void request(@RequestBody JsonNode body) {
        requireKeys(body, Set.of("email"));
        resets.request(email(body.get("email")));
    }

    @PostMapping("/confirm")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void confirm(@RequestBody JsonNode body) {
        requireKeys(body, Set.of("email", "code", "newPassword"));
        String email = email(body.get("email"));
        String code = text(body.get("code"));
        String password = text(body.get("newPassword"));
        if (!AccountCodeRules.isCodeFormat(code) || !UserService.isAcceptablePassword(password)) {
            throw new InvalidRequestException();
        }
        resets.confirm(email, code, password);
    }

    private static String email(JsonNode value) {
        String raw = text(value);
        if (raw.length() > 320) throw new InvalidRequestException();
        String normalized = raw.trim().toLowerCase(Locale.ROOT);
        if (!IdentifierFormats.isEmail(normalized)) throw new InvalidRequestException();
        return normalized;
    }

    private static String text(JsonNode value) {
        if (!value.isString()) throw new InvalidRequestException();
        return value.stringValue();
    }

    private static void requireKeys(JsonNode body, Set<String> keys) {
        if (body == null || !body.isObject() || !Set.copyOf(body.propertyNames()).equals(keys)) {
            throw new InvalidRequestException();
        }
    }
}

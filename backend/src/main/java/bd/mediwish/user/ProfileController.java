package bd.mediwish.user;

import bd.mediwish.auth.InvalidRequestException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Set;
import java.util.UUID;

/** Owner-only profile adapter. Checks exact JSON keys and types before entering a transaction. */
@RestController
@RequestMapping("/api/user/me")
public class ProfileController {
    private final ProfileService profiles;
    private final MobileChangeService mobileChanges;

    public ProfileController(ProfileService profiles, MobileChangeService mobileChanges) {
        this.profiles = profiles;
        this.mobileChanges = mobileChanges;
    }

    @GetMapping("/profile")
    ProfileView profile(@AuthenticationPrincipal(expression = "userId") UUID userId) {
        return profiles.profile(userId);
    }

    @PutMapping("/profile")
    ProfileView update(@AuthenticationPrincipal(expression = "userId") UUID userId, @RequestBody JsonNode body) {
        requireKeys(body, Set.of("fullName", "email", "dateOfBirth", "version"));
        var version = body.get("version");
        if (!version.isIntegralNumber() || !version.canConvertToLong() || version.longValue() < 0) {
            throw new InvalidRequestException();
        }
        return profiles.update(userId, new ProfileEdit(text(body.get("fullName")), text(body.get("email")),
                date(body.get("dateOfBirth")), version.longValue()));
    }

    @PostMapping("/mobile-change")
    @ResponseStatus(HttpStatus.ACCEPTED)
    ProfileView stage(@AuthenticationPrincipal(expression = "userId") UUID userId, @RequestBody JsonNode body) {
        requireKeys(body, Set.of("mobile"));
        if (!body.get("mobile").isString()) throw new InvalidRequestException();
        return mobileChanges.stage(userId, body.get("mobile").stringValue());
    }

    @DeleteMapping("/mobile-change")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void cancel(@AuthenticationPrincipal(expression = "userId") UUID userId) {
        mobileChanges.cancel(userId);
    }

    private static void requireKeys(JsonNode body, Set<String> keys) {
        if (body == null || !body.isObject() || !Set.copyOf(body.propertyNames()).equals(keys)) {
            throw new InvalidRequestException();
        }
    }

    private static String text(JsonNode value) {
        if (value.isNull()) return null;
        if (!value.isString()) throw new InvalidRequestException();
        return value.stringValue();
    }

    private static LocalDate date(JsonNode value) {
        String date = text(value);
        if (date == null) return null;
        if (!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) throw new InvalidRequestException();
        try {
            return LocalDate.parse(date);
        } catch (DateTimeParseException exception) {
            throw new InvalidRequestException();
        }
    }
}

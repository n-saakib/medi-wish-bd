package bd.mediwish.auth;

import bd.mediwish.user.ProfileView;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;
import java.util.Set;
import java.util.UUID;

/** Owner-bound verification; requesting a code has no request body. */
@RestController
@RequestMapping("/api/user/me/email-verification")
public class EmailVerificationController {
    private final EmailVerificationService verification;

    public EmailVerificationController(EmailVerificationService verification) { this.verification = verification; }

    @PostMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void request(@AuthenticationPrincipal(expression = "userId") UUID userId) {
        verification.request(userId);
    }

    @PostMapping("/confirm")
    ProfileView confirm(@AuthenticationPrincipal(expression = "userId") UUID userId, @RequestBody JsonNode body) {
        if (body == null || !body.isObject() || !Set.copyOf(body.propertyNames()).equals(Set.of("code"))
                || !body.get("code").isString() || !AccountCodeRules.isCodeFormat(body.get("code").stringValue())) {
            throw new InvalidRequestException();
        }
        return verification.confirm(userId, body.get("code").stringValue());
    }
}

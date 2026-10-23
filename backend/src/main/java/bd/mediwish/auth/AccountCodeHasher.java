package bd.mediwish.auth;

import org.springframework.stereotype.Component;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

/** Keyed verifiers protect the small code space and hide typed-address throttle keys. */
@Component
class AccountCodeHasher {
    private final SecretKeySpec key;

    AccountCodeHasher(AuthProperties properties) {
        key = new SecretKeySpec(Base64.getDecoder().decode(properties.recovery().codeKey().trim()), "HmacSHA256");
    }

    String codeHash(AccountCodePurpose purpose, UUID id, String code) {
        return hash(purpose + ":" + id + ":" + code);
    }

    String addressKey(String normalizedEmail) {
        return "address:" + hash("reset-address:" + normalizedEmail);
    }

    boolean matches(AccountCodePurpose purpose, UUID id, String code, String protectedHash) {
        return MessageDigest.isEqual(codeHash(purpose, id, code).getBytes(StandardCharsets.US_ASCII),
                protectedHash.getBytes(StandardCharsets.US_ASCII));
    }

    private String hash(String input) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            return HexFormat.of().formatHex(mac.doFinal(input.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException unavailable) {
            throw new IllegalStateException("recovery code could not be processed");
        }
    }
}

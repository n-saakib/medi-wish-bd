package bd.mediwish.auth;

import bd.mediwish.mail.EmailKind;
import bd.mediwish.mail.EmailMessage;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.*;

/** The mailbox reader must not mistake expiry text, partial digits or two codes for one code. */
class AuthApiRecoverySupportTest {
    @Test void readsTheOnlySixDigitAsciiCodeBesideTheExpiryText() {
        var mail = mail("Your password reset code is 123456. It expires in 15 minutes.");
        assertThat(AuthApi.codeFrom(mail)).isEqualTo("123456");
    }

    @Test void rejectsMissingPartialAndNonAsciiCodesWithoutExposingTheMail() {
        for (String body : new String[]{"It expires in 15 minutes.", "Code 1234567", "Code ١٢٣٤٥٦"}) {
            assertThatThrownBy(() -> AuthApi.codeFrom(mail(body)))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("Mail did not contain exactly one recovery code");
        }
    }

    @Test void rejectsAmbiguousMailRatherThanChoosingACode() {
        assertThatThrownBy(() -> AuthApi.codeFrom(mail("Old 123456 and new 654321")))
                .isInstanceOf(IllegalStateException.class);
    }

    private static EmailMessage mail(String body) {
        return new EmailMessage("reader@example.test", "Reset", body, EmailKind.PASSWORD_RESET_CODE);
    }
}

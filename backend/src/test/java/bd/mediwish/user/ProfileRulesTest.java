package bd.mediwish.user;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProfileRulesTest {
    @Test
    void currentPasswordIsBoundedUnchangedAndExcludedFromDiagnostics() {
        String password = "  current-secret  ";
        ProfileEdit edit = rules.validate(new ProfileEdit(null, null, null, 0L, password), today);
        assertThat(edit.currentPassword()).isEqualTo(password);
        assertThat(edit.toString()).doesNotContain(password);
        assertThat(rules.validate(new ProfileEdit(null, null, null, 0L, "x".repeat(128)), today)
                .currentPassword()).hasSize(128);
        assertThatThrownBy(() -> rules.validate(new ProfileEdit(null, null, null, 0L, "x".repeat(129)), today))
                .isInstanceOf(InvalidProfileException.class)
                .satisfies(error -> assertThat(((InvalidProfileException) error).field()).isEqualTo("currentPassword"));
    }

    private final ProfileRules rules = new ProfileRules(new UserIdentifierNormalizer());
    private final LocalDate today = LocalDate.of(2026, 10, 4);

    @Test
    void normalizesOptionalFieldsAndKeepsTheVersion() {
        assertThat(rules.validate(new ProfileEdit("  Demo   Profile  ", "  A.B@Example.test  ",
                LocalDate.of(1900, 1, 1), 7L, null), today)).isEqualTo(
                new ProfileEdit("Demo Profile", "a.b@example.test", LocalDate.of(1900, 1, 1), 7L, null));
        assertThat(rules.validate(new ProfileEdit("  ", "   ", null, 0L, null), today))
                .isEqualTo(new ProfileEdit(null, null, null, 0L, null));
    }

    @Test
    void rejectsControlCharactersAndUnicodeLineSeparatorsEvenAtTheEdges() {
        for (String value : new String[]{"A\nB", "\tAlice", "Alice\u2028Bob", "Alice\u2029Bob"}) {
            assertThatThrownBy(() -> rules.validate(new ProfileEdit(value, null, null, 0L, null), today))
                    .isInstanceOf(InvalidProfileException.class)
                    .satisfies(error -> assertThat(((InvalidProfileException) error).field()).isEqualTo("fullName"));
        }
        assertThatThrownBy(() -> rules.validate(new ProfileEdit("n".repeat(101), null, null, 0L, null), today))
                .isInstanceOf(InvalidProfileException.class);
    }

    @Test
    void checksTheTrimmedNameLengthBeforeCollapsingInternalSpaces() {
        String atLimit = "A" + " ".repeat(98) + "B";
        assertThat(rules.validate(new ProfileEdit("  " + atLimit + "  ", null, null, 0L, null), today).fullName())
                .isEqualTo("A B");
        for (int spaces : new int[]{99, 100}) {
            String overLimit = "A" + " ".repeat(spaces) + "B";
            assertThatThrownBy(() -> rules.validate(new ProfileEdit(overLimit, null, null, 0L, null), today))
                    .isInstanceOf(InvalidProfileException.class)
                    .satisfies(error -> assertThat(((InvalidProfileException) error).field()).isEqualTo("fullName"));
        }
    }

    @Test
    void rejectsInvalidEmailDobAndVersion() {
        assertThatThrownBy(() -> rules.validate(new ProfileEdit(null, "a..b@example.test", null, 0L, null), today))
                .isInstanceOf(InvalidProfileException.class)
                .satisfies(error -> assertThat(((InvalidProfileException) error).field()).isEqualTo("email"));
        for (LocalDate date : new LocalDate[]{LocalDate.of(1899, 12, 31), today.plusDays(1)}) {
            assertThatThrownBy(() -> rules.validate(new ProfileEdit(null, null, date, 0L, null), today))
                    .isInstanceOf(InvalidProfileException.class)
                    .satisfies(error -> assertThat(((InvalidProfileException) error).field()).isEqualTo("dateOfBirth"));
        }
        for (Long version : new Long[]{null, -1L}) {
            assertThatThrownBy(() -> rules.validate(new ProfileEdit(null, null, null, version, null), today))
                    .isInstanceOf(InvalidProfileException.class)
                    .satisfies(error -> assertThat(((InvalidProfileException) error).field()).isEqualTo("version"));
        }
    }

    @Test
    void stagesOnlyADifferentElevenDigitNumberAndGuardsClosingAccounts() {
        assertThat(rules.stageMobile("01700000000", " 01800000000 ")).isEqualTo("01800000000");
        for (String value : new String[]{"01700000000", "123", "+8801700000000", "0180000000x"}) {
            assertThatThrownBy(() -> rules.stageMobile("01700000000", value))
                    .isInstanceOf(InvalidProfileException.class);
        }
        rules.requireEditable(AccountState.ACTIVE);
        assertThatThrownBy(() -> rules.requireEditable(AccountState.CLOSURE_REQUESTED))
                .isInstanceOf(AccountClosingException.class);
    }
}

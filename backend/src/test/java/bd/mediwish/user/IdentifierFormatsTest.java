package bd.mediwish.user;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class IdentifierFormatsTest {
    @Test
    void identifiersOfDifferentKindsCannotShareAValue() {
        assertThat(IdentifierFormats.isUsername("alice_1")).isTrue();
        assertThat(IdentifierFormats.isMobile("01700000000")).isTrue();
        assertThat(IdentifierFormats.isEmail("alice@example.test")).isTrue();
        for (String value : new String[]{"alice_1", "01700000000", "alice@example.test"}) {
            int matchingKinds = (IdentifierFormats.isUsername(value) ? 1 : 0)
                    + (IdentifierFormats.isMobile(value) ? 1 : 0)
                    + (IdentifierFormats.isEmail(value) ? 1 : 0);
            assertThat(matchingKinds).isEqualTo(1);
        }
    }

    @Test
    void acceptedIdentifierBoundariesAndEmailDotAtomSubset() {
        assertThat(IdentifierFormats.isUsername("a12")).isTrue();
        assertThat(IdentifierFormats.isUsername("a".repeat(20))).isTrue();
        assertThat(IdentifierFormats.isUsername("a".repeat(21))).isFalse();
        assertThat(IdentifierFormats.isUsername("123")).isFalse();
        assertThat(IdentifierFormats.isMobile("0170000000")).isFalse();
        assertThat(IdentifierFormats.isMobile("017000000000")).isFalse();
        assertThat(IdentifierFormats.isMobile("০১৭০০০০০০০০")).isFalse();
        assertThat(IdentifierFormats.isEmail("a!b.c+d@example.test")).isTrue();
        assertThat(IdentifierFormats.isEmail("a".repeat(64) + "@" + "b".repeat(63)
                + "." + "c".repeat(63) + "." + "d".repeat(61))).isTrue();
    }

    @Test
    void refusesEmailShapesOutsideTheAcceptedSubset() {
        for (String value : new String[]{"a@example", "a..b@example.test", ".a@example.test", "a.@example.test",
                "a@-example.test", "a@example-.test", "a@example..test", "a@[127.0.0.1]",
                "\"a b\"@example.test", "a@exämple.test", "a".repeat(65) + "@example.test",
                "a@" + "b".repeat(64) + ".test"}) {
            assertThat(IdentifierFormats.isEmail(value)).as(value).isFalse();
        }
    }
}

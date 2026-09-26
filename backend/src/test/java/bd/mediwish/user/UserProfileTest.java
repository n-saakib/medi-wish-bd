package bd.mediwish.user;

import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;

import static org.assertj.core.api.Assertions.assertThat;

class UserProfileTest {
    @Test
    void carriesOnlyTheUsersProfileFieldsAndNeverTheVerifierOrRoles() {
        var user = new User("alice_1", "01700000000", "alice@example.com", "encoded-verifier");

        assertThat(UserProfile.from(user))
                .isEqualTo(new UserProfile("alice_1", "01700000000", "alice@example.com", false));
        assertThat(UserProfile.class.getRecordComponents()).extracting(RecordComponent::getName)
                .containsExactly("username", "mobile", "email", "mobileVerified");
    }
}

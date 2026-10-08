package bd.mediwish.auth;

import bd.mediwish.auth.AuthApi.User;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static bd.mediwish.testsupport.ApiAssertions.assertError;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** Ticket 11 permission matrix through the real HTTP security chain and guarded PostgreSQL schema. */
@Tag("integration")
@Tag("security")
@ExtendWith({OutputCaptureExtension.class, AuthApi.Shared.class})
class UserProfilePermissionIT {
    private final AuthApi api;

    UserProfilePermissionIT(AuthApi api) {
        this.api = api;
    }

    @AfterEach
    void logsOmitSecretsAndProfileValues(CapturedOutput output) {
        api.assertLogsOmitSecrets(output);
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "malformed", "revoked"})
    void everyProfileRouteRejectsInvalidAuthenticationWithoutChangingProfiles(String authentication) throws Exception {
        User owner = seededProfile();
        User other = seededProfile();
        var session = api.signIn(owner);
        Map<String, String> headers = switch (authentication) {
            case "missing" -> Map.of();
            case "malformed" -> Map.of("Authorization", "Bearer " + api.track("malformed-profile-token"));
            case "revoked" -> {
                assertThat(api.logout(session.refreshToken()).statusCode()).isEqualTo(204);
                yield Map.of("Authorization", "Bearer " + session.accessToken());
            }
            default -> throw new IllegalArgumentException("Unknown authentication fixture");
        };

        assertAllRoutesDenied(headers, 401, "AUTHENTICATION_REQUIRED", owner, other);
    }

    @ParameterizedTest
    @ValueSource(strings = {"ADMIN", "MODERATOR"})
    void soleStaffRolesCannotUseAnyProfileRouteUntilMfaIsVerified(String role) throws Exception {
        User staff = seededProfile();
        User other = seededProfile();
        soleRole(staff, role);
        String enrollmentRequired = api.session(api.login(staff.username(), staff.password()),
                "ENROLLMENT_REQUIRED").accessToken();

        assertAllRoutesDenied(Map.of("Authorization", "Bearer " + enrollmentRequired),
                403, "MFA_REQUIRED", staff, other);

        api.enroll(staff);
        String challengeRequired = api.session(api.login(staff.username(), staff.password()),
                "VERIFICATION_REQUIRED").accessToken();
        assertAllRoutesDenied(Map.of("Authorization", "Bearer " + challengeRequired),
                403, "MFA_REQUIRED", staff, other);
    }

    @ParameterizedTest
    @ValueSource(strings = {"CUSTOMER", "DELIVERY_PERSON", "ADMIN", "MODERATOR"})
    void eachSoleRoleCanReadEditStageAndCancelOnlyItsOwnProfile(String role) throws Exception {
        User owner = api.registered();
        User other = seededProfile();
        soleRole(owner, role);
        api.verifyMobile(owner);
        String token = role.equals("ADMIN") || role.equals("MODERATOR")
                ? api.enroll(owner).session().accessToken() : api.signIn(owner).accessToken();
        String otherBefore = fingerprint(other);

        var read = api.profileOf(token);
        assertThat(read.statusCode()).isEqualTo(200);
        assertThat(json(read)).containsEntry("username", owner.username()).containsEntry("version", 0)
                .containsEntry("mobile", owner.mobile()).containsEntry("mobileVerified", true)
                .containsEntry("pendingMobile", null);
        assertThat(fingerprint(other)).isEqualTo(otherBefore);

        String name = api.track("Sole Role Profile " + role);
        String dateOfBirth = api.track("1991-02-03");
        var saved = api.putProfile(token, AuthApi.profileEdit(0, name, owner.email(), dateOfBirth));
        assertThat(saved.statusCode()).isEqualTo(200);
        var expected = json(saved);
        assertThat(expected).containsEntry("username", owner.username()).containsEntry("fullName", name)
                .containsEntry("email", owner.email()).containsEntry("dateOfBirth", dateOfBirth)
                .containsEntry("mobile", owner.mobile()).containsEntry("mobileVerified", true)
                .containsEntry("pendingMobile", null).containsEntry("accountState", "ACTIVE")
                .containsEntry("version", 1);
        assertThat(json(api.profileOf(token))).isEqualTo(expected);
        assertThat(fingerprint(other)).isEqualTo(otherBefore);

        String pending = api.newUser().mobile();
        assertThat(api.stageMobile(token, pending).statusCode()).isEqualTo(202);
        expected.put("pendingMobile", pending);
        assertThat(json(api.profileOf(token))).isEqualTo(expected);
        assertThat(fingerprint(other)).isEqualTo(otherBefore);

        assertThat(api.cancelMobile(token).statusCode()).isEqualTo(204);
        expected.put("pendingMobile", null);
        assertThat(json(api.profileOf(token))).isEqualTo(expected);
        assertThat(fingerprint(other)).isEqualTo(otherBefore);
        assertSoleRole(owner, role);
    }

    private User seededProfile() throws Exception {
        User user = api.registered();
        String token = api.signIn(user).accessToken();
        api.verifyMobile(user);
        String name = api.track("Private Profile " + user.username());
        String dateOfBirth = api.track("1988-04-05");
        assertThat(api.putProfile(token, AuthApi.profileEdit(0, name, user.email(), dateOfBirth)).statusCode())
                .isEqualTo(200);
        assertThat(api.stageMobile(token, api.newUser().mobile()).statusCode()).isEqualTo(202);
        return user;
    }

    private void soleRole(User user, String role) throws Exception {
        if (!role.equals("CUSTOMER")) {
            api.removeRole(user, "CUSTOMER");
            api.grantRole(user, role);
        }
        assertSoleRole(user, role);
    }

    private void assertSoleRole(User user, String role) throws Exception {
        assertThat(api.database().query("SELECT role FROM user_roles WHERE user_id = ?",
                row -> row.getString(1), api.userId(user))).containsExactly(role);
    }

    private void assertAllRoutesDenied(Map<String, String> authentication, int status, String code,
                                      User owner, User other) throws Exception {
        List<String> before = List.of(fingerprint(owner), fingerprint(other));
        String name = api.track("Denied Profile Edit " + owner.username());
        String replacement = api.newUser().mobile();
        String dateOfBirth = api.track("1991-02-03");
        var jsonHeaders = new HashMap<>(authentication);
        jsonHeaders.put("Content-Type", "application/json");
        for (String method : List.of("GET", "PUT", "POST", "DELETE")) {
            boolean profile = method.equals("GET") || method.equals("PUT");
            String path = profile ? "/api/user/me/profile" : "/api/user/me/mobile-change";
            String body = switch (method) {
                case "PUT" -> AuthApi.profileEdit(1, name, owner.email(), dateOfBirth);
                case "POST" -> "{\"mobile\":\"" + replacement + "\"}";
                default -> null;
            };
            assertError(api.send(method, path, body == null ? authentication : jsonHeaders, body), status, code);
            assertThat(List.of(fingerprint(owner), fingerprint(other)))
                    .as("%s %s leaves both users and their pending mobiles unchanged", method, path).isEqualTo(before);
        }
    }

    /** Compare complete persisted rows using digests so assertion diagnostics contain no personal data. */
    private String fingerprint(User user) throws Exception {
        return api.database().single("""
                SELECT md5(u::text) || ':' ||
                  coalesce((SELECT md5(string_agg(m::text, '|' ORDER BY m::text))
                            FROM user_mobile_changes m WHERE m.user_id = u.id), '') || ':' ||
                  coalesce((SELECT md5(string_agg(r::text, '|' ORDER BY r::text))
                            FROM user_roles r WHERE r.user_id = u.id), '')
                FROM users u WHERE u.id = ?
                """, String.class, api.userId(user));
    }
}

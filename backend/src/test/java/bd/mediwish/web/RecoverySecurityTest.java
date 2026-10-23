package bd.mediwish.web;

import bd.mediwish.auth.*;
import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRole;
import jakarta.servlet.Filter;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Executes the production security chain for every recovery route and actor. */
class RecoverySecurityTest {
    private static final String[] PUBLIC = {"/api/auth/password-reset/request", "/api/auth/password-reset/confirm"};
    private static final String[] PROTECTED = {"/api/user/me/email-verification", "/api/user/me/email-verification/confirm"};

    @Test
    void publicResetIgnoresBearerAndCsrfWhileVerificationRequiresAnUnrestrictedCurrentSession() throws Exception {
        try (var context = context()) {
            var mvc = mvc(context);
            var users = context.getBean(CurrentUserAuthentication.class);
            for (String actor : new String[]{"ANONYMOUS", "CUSTOMER", "ADMIN", "MODERATOR", "DELIVERY_PERSON",
                    "ENROLLMENT_REQUIRED", "VERIFICATION_REQUIRED", "EXPIRED", "REVOKED"}) {
                reset(users);
                if (actor.equals("EXPIRED") || actor.equals("REVOKED"))
                    when(users.authenticate("actor")).thenThrow(new AuthenticationRequiredException());
                else if (!actor.equals("ANONYMOUS")) when(users.authenticate("actor")).thenReturn(actor(actor));
                for (String path : PUBLIC) {
                    var command = post(path).contentType("application/json").content("{}");
                    if (!actor.equals("ANONYMOUS")) command.header("Authorization", "Bearer actor");
                    mvc.perform(command).andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                            .andExpect(header().doesNotExist("Set-Cookie"));
                }
                verifyNoInteractions(users);
                int expected = actor.equals("ANONYMOUS") || actor.equals("EXPIRED") || actor.equals("REVOKED") ? 401
                        : actor.endsWith("REQUIRED") ? 403 : 200;
                for (String path : PROTECTED) {
                    var command = post(path);
                    if (!actor.equals("ANONYMOUS")) command.header("Authorization", "Bearer actor");
                    var result = mvc.perform(command).andExpect(status().is(expected))
                            .andExpect(header().string("Cache-Control", "no-store"))
                            .andExpect(header().exists("X-Request-ID"));
                    if (expected == 401) result.andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
                    if (expected == 403) result.andExpect(jsonPath("$.code").value("MFA_REQUIRED"));
                }
            }
        }
    }

    @Test
    void everyRecoveryBodyIsLimitedTo16KiBAndNoBodyIsRequiredForVerificationRequests() throws Exception {
        try (var context = context()) {
            var mvc = mvc(context);
            when(context.getBean(CurrentUserAuthentication.class).authenticate("actor")).thenReturn(actor("CUSTOMER"));
            for (String path : new String[]{PUBLIC[0], PUBLIC[1], PROTECTED[0], PROTECTED[1]}) {
                mvc.perform(post(path).header("Authorization", "Bearer actor").contentType("application/json")
                                .content("x".repeat(16 * 1024)))
                        .andExpect(status().isOk());
                mvc.perform(post(path).header("Authorization", "Bearer actor").contentType("application/json")
                                .content("x".repeat(16 * 1024 + 1)))
                        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                        .andExpect(header().string("Cache-Control", "no-store"));
            }
            mvc.perform(post(PROTECTED[0]).header("Authorization", "Bearer actor")).andExpect(status().isOk());
        }
    }

    @Test
    void browserPreflightsNeedNeitherBearerNorCsrfAndAllowTheConfiguredOriginOnly() throws Exception {
        try (var context = context()) {
            var mvc = mvc(context);
            for (String path : new String[]{PUBLIC[0], PUBLIC[1], PROTECTED[0], PROTECTED[1]}) {
                mvc.perform(options(path).header("Origin", "http://127.0.0.1:3000")
                                .header("Access-Control-Request-Method", "POST")
                                .header("Access-Control-Request-Headers", "authorization,content-type"))
                        .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", "http://127.0.0.1:3000"));
                mvc.perform(options(path).header("Origin", "https://untrusted.example.test")
                                .header("Access-Control-Request-Method", "POST"))
                        .andExpect(status().isForbidden()).andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
            }
        }
    }

    private static CurrentUser actor(String actor) {
        boolean restricted = actor.endsWith("REQUIRED");
        var role = restricted ? UserRole.ADMIN : UserRole.valueOf(actor);
        var mfa = restricted ? MfaStatus.valueOf(actor) : role == UserRole.ADMIN || role == UserRole.MODERATOR
                ? MfaStatus.VERIFIED : MfaStatus.NOT_REQUIRED;
        String authority = restricted ? actor.equals("ENROLLMENT_REQUIRED") ? StaffAccessPolicy.MFA_ENROLLMENT
                : StaffAccessPolicy.MFA_CHALLENGE : "ROLE_" + role;
        return new CurrentUser(UUID.randomUUID(), UUID.randomUUID(), new UserProfile("recovery.actor", "01700000000", null, false),
                Set.of(role), mfa, Set.of(authority));
    }
    private static AnnotationConfigWebApplicationContext context() {
        var context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.getEnvironment().setActiveProfiles("test");
        context.register(TestConfiguration.class);
        context.refresh();
        return context;
    }
    private static MockMvc mvc(AnnotationConfigWebApplicationContext context) {
        return MockMvcBuilders.webAppContextSetup(context).addFilters(new RequestCorrelationFilter(),
                context.getBean("springSecurityFilterChain", Filter.class)).build();
    }
    @Configuration @EnableWebMvc @EnableWebSecurity @Import(SecurityConfiguration.class)
    static class TestConfiguration {
        @Bean AuthProperties authProperties() { return TestAuthSettings.properties(); }
        @Bean ApiErrors errors() { return WebTestFixtures.apiErrors(); }
        @Bean CurrentUserAuthentication users() { return mock(CurrentUserAuthentication.class); }
        @Bean ProbeController probe() { return new ProbeController(); }
    }
    @RestController
    static class ProbeController {
        @PostMapping({"/api/auth/password-reset/request", "/api/auth/password-reset/confirm",
                "/api/user/me/email-verification", "/api/user/me/email-verification/confirm"})
        Map<String, Boolean> accepted() { return Map.of("accepted", true); }
    }
}

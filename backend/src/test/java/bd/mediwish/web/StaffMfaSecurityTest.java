package bd.mediwish.web;

import bd.mediwish.auth.AuthProperties;
import bd.mediwish.auth.CurrentUserAuthentication;
import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.auth.MfaStatus;
import bd.mediwish.auth.StaffAccessPolicy;
import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRole;
import jakarta.servlet.Filter;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Executes the production security filters independently of controller validation and PostgreSQL. */
class StaffMfaSecurityTest {
    private static final String PREFIX = "/api/auth/mfa/";
    private static final String[] ROUTES = {"enrollment", "enrollment/verify", "verify", "recovery", "backup-codes"};

    @ParameterizedTest
    @ValueSource(strings = {"ANONYMOUS", "CUSTOMER", "DELIVERY_PERSON", "ENROLLMENT_REQUIRED",
            "VERIFICATION_REQUIRED", "REPLACEMENT_REQUIRED", "MODERATOR", "ADMIN"})
    void eachMfaRouteEnforcesItsSessionAuthorityWithoutRequiringCsrf(String actor) throws Exception {
        try (var context = context()) {
            var mvc = mvc(context);
            if (!actor.equals("ANONYMOUS")) {
                when(context.getBean(CurrentUserAuthentication.class).authenticate("actor")).thenReturn(actor(actor));
            }
            for (String route : ROUTES) {
                boolean allowed = switch (actor) {
                    case "ENROLLMENT_REQUIRED", "REPLACEMENT_REQUIRED" -> route.startsWith("enrollment");
                    case "VERIFICATION_REQUIRED" -> route.equals("verify") || route.equals("recovery");
                    case "MODERATOR", "ADMIN" -> route.equals("backup-codes");
                    default -> false;
                };
                int expected = actor.equals("ANONYMOUS") ? 401 : allowed ? 200 : 403;
                var command = post(PREFIX + route).contentType("application/json").content("{}");
                if (!actor.equals("ANONYMOUS")) command.header("Authorization", "Bearer actor");
                var result = mvc.perform(command).andExpect(status().is(expected))
                        .andExpect(header().string("Cache-Control", "no-store"))
                        .andExpect(header().exists("X-Request-ID"));
                if (expected == 401) result.andExpect(header().string("WWW-Authenticate", "Bearer"));
                if (!allowed) result.andExpect(jsonPath("$.code").value(actor.equals("ANONYMOUS")
                        ? "AUTHENTICATION_REQUIRED" : actor.endsWith("REQUIRED") ? "MFA_REQUIRED" : "ACCESS_DENIED"));
            }
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"recovery", "backup-codes"})
    void newRoutesBoundTheActualJsonBytesBeforeTheController(String route) throws Exception {
        try (var context = context()) {
            var mvc = mvc(context);
            when(context.getBean(CurrentUserAuthentication.class).authenticate("actor"))
                    .thenReturn(actor(route.equals("recovery") ? "VERIFICATION_REQUIRED" : "MODERATOR"));
            String json = route.equals("recovery") ? "{\"backupCode\":\"ABCD-2345\"}" : "{\"code\":\"123456\"}";
            String atLimit = json + " ".repeat(AuthRequestBodyLimitFilter.MAX_BODY_BYTES - json.length());
            mvc.perform(post(PREFIX + route).header("Authorization", "Bearer actor")
                            .contentType("application/json").content(atLimit))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.accepted").value(true));
            mvc.perform(post(PREFIX + route).header("Authorization", "Bearer actor")
                            .contentType("application/json").content(atLimit + " "))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(header().exists("X-Request-ID"));
        }
    }

    private static CurrentUser actor(String actor) {
        boolean restricted = actor.endsWith("REQUIRED");
        UserRole role = restricted ? UserRole.ADMIN : UserRole.valueOf(actor);
        MfaStatus mfa = restricted ? MfaStatus.valueOf(actor)
                : role.isStaff() ? MfaStatus.VERIFIED : MfaStatus.NOT_REQUIRED;
        String authority = switch (actor) {
            case "ENROLLMENT_REQUIRED" -> StaffAccessPolicy.MFA_ENROLLMENT;
            case "VERIFICATION_REQUIRED" -> StaffAccessPolicy.MFA_CHALLENGE;
            case "REPLACEMENT_REQUIRED" -> StaffAccessPolicy.MFA_REPLACEMENT;
            default -> "ROLE_" + role;
        };
        return new CurrentUser(UUID.randomUUID(), UUID.randomUUID(), new UserProfile("mfa.actor", "01700000000", null, false),
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

    @Configuration
    @EnableWebMvc
    @EnableWebSecurity
    @Import(SecurityConfiguration.class)
    static class TestConfiguration {
        @Bean AuthProperties authProperties() { return TestAuthSettings.properties(); }
        @Bean ApiErrors errors() { return WebTestFixtures.apiErrors(); }
        @Bean CurrentUserAuthentication users() { return mock(CurrentUserAuthentication.class); }
        @Bean ProbeController probeController() { return new ProbeController(); }
    }

    @RestController
    static class ProbeController {
        @PostMapping({PREFIX + "enrollment", PREFIX + "enrollment/verify", PREFIX + "verify",
                PREFIX + "recovery", PREFIX + "backup-codes"})
        Map<String, Boolean> accepted() { return Map.of("accepted", true); }
    }
}

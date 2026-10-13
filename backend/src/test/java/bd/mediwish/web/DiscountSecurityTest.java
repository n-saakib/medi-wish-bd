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
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Executes the production filter chain over a probe controller, without PostgreSQL. */
class DiscountSecurityTest {
    private record Route(HttpMethod method, String path) {}
    private static final String ID = "6c1d9a0e-2b7f-4e11-8d3a-5f0e9b2c7a14";
    private static final Route[] ROUTES = {
            new Route(HttpMethod.GET, "/api/staff/discounts"),
            new Route(HttpMethod.POST, "/api/staff/discounts"),
            new Route(HttpMethod.PUT, "/api/staff/discounts/" + ID),
            new Route(HttpMethod.POST, "/api/staff/discounts/" + ID + "/end")};
    @Test
    void everyDiscountRouteUsesTheCurrentRoleAndStaffMfaBeforeAnyBodyHandling() throws Exception {
        try (var context = context()) {
            MockMvc mvc = mvc(context);
            var users = context.getBean(CurrentUserAuthentication.class);
            for (String actor : new String[]{"ANONYMOUS", "ADMIN", "MODERATOR", "CUSTOMER", "DELIVERY_PERSON",
                    "ENROLLMENT_REQUIRED", "VERIFICATION_REQUIRED"}) {
                if (!actor.equals("ANONYMOUS")) when(users.authenticate("actor")).thenReturn(actor(actor));
                for (Route route : ROUTES) {
                    boolean allowed = actor.equals("ADMIN");
                    int expected = actor.equals("ANONYMOUS") ? 401 : allowed ? 200 : 403;
                    var command = request(route.method(), route.path()).contentType("application/json").content("PRIVATE_BODY");
                    if (!actor.equals("ANONYMOUS")) command.header("Authorization", "Bearer actor");
                    var response = mvc.perform(command).andExpect(status().is(expected))
                            .andExpect(header().string("Cache-Control", "no-store"))
                            .andExpect(header().exists("X-Request-ID"));
                    if (expected == 401) response.andExpect(header().string("WWW-Authenticate", "Bearer"));
                    if (expected != 200) response.andExpect(jsonPath("$.code").value(actor.equals("ANONYMOUS")
                            ? "AUTHENTICATION_REQUIRED" : actor.endsWith("REQUIRED") ? "MFA_REQUIRED" : "ACCESS_DENIED"));
                }
            }
        }
    }

    @Test
    void deniedDiscountCommandsStayForbiddenEvenForOversizedJson() throws Exception {
        try (var context = context()) {
            MockMvc mvc = mvc(context);
            var users = context.getBean(CurrentUserAuthentication.class);
            var route = ROUTES[2];
            when(users.authenticate("actor")).thenReturn(actor("MODERATOR"));
            mvc.perform(request(route.method(), route.path()).header("Authorization", "Bearer actor")
                            .contentType("application/json").content("x".repeat(17 * 1024)))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
            when(users.authenticate("actor")).thenReturn(actor("ADMIN"));
            for (Route command : ROUTES) {
                if (command.method() == HttpMethod.GET) continue;
                mvc.perform(request(command.method(), command.path()).header("Authorization", "Bearer actor")
                                .contentType("application/json").content("x".repeat(17 * 1024)))
                        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                        .andExpect(header().string("Cache-Control", "no-store"));
            }
        }
    }

    @Test
    void frontendPreflightAllowsPutWithoutABearerOrCsrfToken() throws Exception {
        try (var context = context()) {
            mvc(context).perform(options("/api/staff/discounts/" + ID)
                            .header("Origin", "http://127.0.0.1:3000")
                            .header("Access-Control-Request-Method", "PUT")
                            .header("Access-Control-Request-Headers", "authorization,content-type"))
                    .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", "http://127.0.0.1:3000"));
        }
    }

    @Test
    void frontendPreflightAllowsEndPostWithoutABearerOrCsrfToken() throws Exception {
        try (var context = context()) {
            mvc(context).perform(options("/api/staff/discounts/" + ID + "/end")
                            .header("Origin", "http://127.0.0.1:3000")
                            .header("Access-Control-Request-Method", "POST")
                            .header("Access-Control-Request-Headers", "authorization,content-type"))
                    .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", "http://127.0.0.1:3000"));
        }
    }

    @Test
    void anonymousPriceReadIgnoresBearerHeaders() throws Exception {
        try (var context = context()) {
            MockMvc mvc = mvc(context);
            for (String token : new String[]{"", "Bearer invalid", "Bearer expired", "Basic ignored"}) {
                mvc.perform(request(HttpMethod.GET, "/api/products/" + ID + "/price").header("Authorization", token))
                        .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                        .andExpect(header().exists("X-Request-ID"));
            }
            org.mockito.Mockito.verifyNoInteractions(context.getBean(CurrentUserAuthentication.class));
        }
    }

    private static CurrentUser actor(String actor) {
        boolean restricted = actor.endsWith("REQUIRED");
        UserRole role = restricted ? UserRole.ADMIN : UserRole.valueOf(actor);
        MfaStatus mfa = restricted ? MfaStatus.valueOf(actor)
                : role == UserRole.ADMIN || role == UserRole.MODERATOR ? MfaStatus.VERIFIED : MfaStatus.NOT_REQUIRED;
        String authority = restricted ? actor.equals("ENROLLMENT_REQUIRED") ? StaffAccessPolicy.MFA_ENROLLMENT
                : StaffAccessPolicy.MFA_CHALLENGE : "ROLE_" + role;
        return new CurrentUser(UUID.randomUUID(), UUID.randomUUID(), new UserProfile("catalog.actor", "01700000000", null, false),
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
        @RequestMapping({"/api/staff/discounts", "/api/staff/discounts/{id}", "/api/staff/discounts/{id}/end", "/api/products/{id}/price"})
        Map<String, Boolean> accepted() { return Map.of("accepted", true); }
    }
}

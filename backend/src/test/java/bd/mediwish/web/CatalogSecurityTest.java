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
class CatalogSecurityTest {
    private record Route(HttpMethod method, String path, boolean pricing) {}
    private static final String ID = "6c1d9a0e-2b7f-4e11-8d3a-5f0e9b2c7a14";
    private static final Route[] ROUTES = {
            new Route(HttpMethod.GET, "/api/staff/categories", false),
            new Route(HttpMethod.POST, "/api/staff/categories", false),
            new Route(HttpMethod.PUT, "/api/staff/categories/" + ID, false),
            new Route(HttpMethod.GET, "/api/staff/products", false),
            new Route(HttpMethod.GET, "/api/staff/products/" + ID, false),
            new Route(HttpMethod.POST, "/api/staff/products", false),
            new Route(HttpMethod.PUT, "/api/staff/products/" + ID, false),
            new Route(HttpMethod.PUT, "/api/staff/products/" + ID + "/pricing", true)};

    @Test
    void everyCatalogRouteUsesTheCurrentRoleAndStaffMfaBeforeAnyBodyHandling() throws Exception {
        try (var context = context()) {
            MockMvc mvc = mvc(context);
            var users = context.getBean(CurrentUserAuthentication.class);
            for (String actor : new String[]{"ANONYMOUS", "ADMIN", "MODERATOR", "CUSTOMER", "DELIVERY_PERSON",
                    "ENROLLMENT_REQUIRED", "VERIFICATION_REQUIRED"}) {
                if (!actor.equals("ANONYMOUS")) when(users.authenticate("actor")).thenReturn(actor(actor));
                for (Route route : ROUTES) {
                    boolean allowed = actor.equals("ADMIN") || actor.equals("MODERATOR") && !route.pricing();
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
    void moderatorPricingIsDeniedEvenForOversizedJsonButAnAdminGetsTheBoundedBodyError() throws Exception {
        try (var context = context()) {
            MockMvc mvc = mvc(context);
            var users = context.getBean(CurrentUserAuthentication.class);
            var route = ROUTES[7];
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
            mvc(context).perform(options("/api/staff/products/" + ID + "/pricing")
                            .header("Origin", "http://127.0.0.1:3000")
                            .header("Access-Control-Request-Method", "PUT")
                            .header("Access-Control-Request-Headers", "authorization,content-type"))
                    .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", "http://127.0.0.1:3000"));
        }
    }

    @Test
    void publicCatalogReadsIgnoreBearerHeadersAndOtherMethodsStayDenied() throws Exception {
        try (var context = context()) {
            var mvc = mvc(context);
            for (String path : new String[]{"/api/categories", "/api/categories/" + ID + "/products",
                    "/api/products/" + ID}) {
                for (String bearer : new String[]{"", "Bearer invalid"}) {
                    var command = request(HttpMethod.GET, path);
                    if (!bearer.isEmpty()) command.header("Authorization", bearer);
                    mvc.perform(command).andExpect(status().isOk())
                            .andExpect(header().string("Cache-Control", "no-store"))
                            .andExpect(header().exists("X-Request-ID"));
                }
                mvc.perform(request(HttpMethod.POST, path)).andExpect(status().isForbidden());
            }
        }
    }

    @Test
    void imageRoutesAuthorizeEveryActorBeforeReadingBodiesAndOnlyPublicGetHeadAreAllowed() throws Exception {
        try (var context = context()) {
            var mvc = mvc(context); var users = context.getBean(CurrentUserAuthentication.class);
            Route[] images = {
                    new Route(HttpMethod.GET, "/api/staff/products/" + ID + "/images", false),
                    new Route(HttpMethod.POST, "/api/staff/products/" + ID + "/images", false),
                    new Route(HttpMethod.PUT, "/api/staff/products/" + ID + "/images/" + ID, false),
                    new Route(HttpMethod.PUT, "/api/staff/products/" + ID + "/image-order", false),
                    new Route(HttpMethod.DELETE, "/api/staff/products/" + ID + "/images/" + ID, false)};
            for (String actor : new String[]{"ANONYMOUS", "ADMIN", "MODERATOR", "CUSTOMER", "DELIVERY_PERSON", "ENROLLMENT_REQUIRED", "VERIFICATION_REQUIRED"}) {
                if (!actor.equals("ANONYMOUS")) when(users.authenticate("actor")).thenReturn(actor(actor));
                for (Route route : images) {
                    var command = request(route.method(), route.path()).contentType("application/json").content("PRIVATE_BODY");
                    if (!actor.equals("ANONYMOUS")) command.header("Authorization", "Bearer actor");
                    int expected = actor.equals("ANONYMOUS") ? 401 : actor.equals("ADMIN") || actor.equals("MODERATOR") ? 200 : 403;
                    mvc.perform(command).andExpect(status().is(expected)).andExpect(header().string("Cache-Control", "no-store"));
                }
            }
            for (var method : new HttpMethod[]{HttpMethod.GET, HttpMethod.HEAD})
                mvc.perform(request(method, "/api/public/product-images/" + ID + ".png")).andExpect(status().isOk());
            for (var method : new HttpMethod[]{HttpMethod.POST, HttpMethod.PUT, HttpMethod.DELETE})
                mvc.perform(request(method, "/api/public/product-images/" + ID + ".png"))
                        .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCESS_DENIED"))
                        .andExpect(header().string("Cache-Control", "no-store"));
            for (var method : new HttpMethod[]{HttpMethod.POST, HttpMethod.PUT, HttpMethod.DELETE})
                mvc.perform(request(method, "/api/public/product-images/" + ID + ".png")
                                .cookie(new jakarta.servlet.http.Cookie("XSRF-TOKEN", "synthetic-csrf"))
                                .header("X-XSRF-TOKEN", "synthetic-csrf"))
                        .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
            mvc.perform(request(HttpMethod.DELETE, "/api/staff/products/" + ID).header("Authorization", "Bearer actor"))
                    .andExpect(status().isForbidden());
            when(users.authenticate("actor")).thenReturn(actor("ADMIN"));
            mvc.perform(request(HttpMethod.POST, images[1].path()).header("Authorization", "Bearer actor")
                            .contentType("multipart/form-data; boundary=b").content("x".repeat(17 * 1024)))
                    .andExpect(status().isOk());
            for (Route route : new Route[]{images[2], images[3]})
                mvc.perform(request(route.method(), route.path()).header("Authorization", "Bearer actor")
                                .contentType("application/json").content("x".repeat(17 * 1024)))
                        .andExpect(status().isBadRequest());
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
        @RequestMapping({"/api/staff/categories", "/api/staff/categories/{id}", "/api/staff/products",
                "/api/staff/products/{id}", "/api/staff/products/{id}/pricing", "/api/staff/products/{id}/images",
                "/api/staff/products/{id}/images/{imageId}", "/api/staff/products/{id}/image-order", "/api/public/product-images/{fileName}",
                "/api/categories", "/api/categories/{id}/products", "/api/products/{id}"})
        Map<String, Boolean> accepted() { return Map.of("accepted", true); }
    }
}

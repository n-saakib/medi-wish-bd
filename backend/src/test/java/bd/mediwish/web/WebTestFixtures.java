package bd.mediwish.web;

import bd.mediwish.testsupport.TestAuthSettings;
import bd.mediwish.auth.AuthProperties;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.mock.env.MockEnvironment;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;

/** Production web components over synthetic settings, for web unit tests. */
public final class WebTestFixtures {
    private WebTestFixtures() {}

    static ApiErrors apiErrors() {
        var messages = new ResourceBundleMessageSource();
        messages.setBasename("messages");
        return new ApiErrors(messages, JsonMapper.builder().build());
    }

    public static org.springframework.test.web.servlet.MockMvc catalogMvc(Object... controllers) {
        return org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controllers)
                .setControllerAdvice(new ApiExceptionHandler(apiErrors()))
                .setCustomArgumentResolvers(new org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver())
                .addFilters(new RequestCorrelationFilter()).build();
    }

    /** {@code profiles} is comma-separated; empty means no active profile. */
    static SecurityConfiguration securityConfiguration(boolean secureCookies, String profiles) {
        var environment = new MockEnvironment();
        environment.setActiveProfiles(profiles.isEmpty() ? new String[0] : profiles.split(","));
        return new SecurityConfiguration(environment, new AuthProperties(Duration.ofMinutes(15), Duration.ofDays(30),
                "medi-wish", "medi-wish-api", "unused", new AuthProperties.Cookie(secureCookies), TestAuthSettings.mfa()));
    }
}

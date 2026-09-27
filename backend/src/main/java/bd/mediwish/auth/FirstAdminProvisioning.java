package bd.mediwish.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.stereotype.Component;
import org.springframework.web.context.WebApplicationContext;

import java.util.Locale;
import java.util.function.IntConsumer;

/**
 * The operator command that provisions the first Admin (D1). It runs only when
 * {@code app.provisioning.first-admin-username} is set, refuses to run inside a serving application, logs only the
 * outcome, never the username, and ends the process with exit code 0 when provisioned and 1 when refused.
 */
@Component
class FirstAdminProvisioning implements ApplicationRunner {
    private static final Logger LOGGER = LoggerFactory.getLogger(FirstAdminProvisioning.class);

    private final ConfigurableApplicationContext context;
    private final FirstAdminProvisioningService provisioning;
    private final String username;
    private final IntConsumer exit;

    @Autowired
    FirstAdminProvisioning(ConfigurableApplicationContext context, FirstAdminProvisioningService provisioning,
                           @Value("${app.provisioning.first-admin-username:}") String username) {
        this(context, provisioning, username, System::exit);
    }

    FirstAdminProvisioning(ConfigurableApplicationContext context, FirstAdminProvisioningService provisioning,
                           String username, IntConsumer exit) {
        this.context = context;
        this.provisioning = provisioning;
        this.username = username;
        this.exit = exit;
    }

    @Override
    public void run(ApplicationArguments arguments) {
        if (username == null || username.isBlank()) return;
        if (context instanceof WebApplicationContext) {
            throw new IllegalStateException("first-Admin provisioning requires spring.main.web-application-type=none");
        }
        var outcome = provisioning.provision(username);
        boolean provisioned = outcome == FirstAdminProvisioningService.Outcome.PROVISIONED;
        LOGGER.info("First-Admin provisioning {}", provisioned
                ? "provisioned" : "refused: " + outcome.name().toLowerCase(Locale.ROOT).replace('_', '-'));
        int code = provisioned ? 0 : 1;
        exit.accept(SpringApplication.exit(context, () -> code));
    }
}

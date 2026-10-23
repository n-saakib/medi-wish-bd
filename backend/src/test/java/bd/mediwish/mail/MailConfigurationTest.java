package bd.mediwish.mail;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.time.Clock;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/** Exercises configuration binding and bean startup rather than a private validation helper. */
@ExtendWith(OutputCaptureExtension.class)
class MailConfigurationTest {
    @TempDir Path directory;
    private final ApplicationContextRunner context = new ApplicationContextRunner()
            .withUserConfiguration(MailConfiguration.class)
            .withBean(ObjectMapper.class, () -> JsonMapper.builder().build())
            .withBean(Clock.class, Clock::systemUTC);

    @Test void defaultsToDisabledMailWithoutAnActiveProfile() {
        context.run(started -> {
            assertThat(started).hasNotFailed().hasSingleBean(EmailTransport.class);
            assertThat(started.getBean(EmailTransport.class)).isInstanceOf(DisabledEmailTransport.class);
        });
    }

    @ParameterizedTest(name = "{0} with {1} profiles: allowed={2}")
    @CsvSource({
            "memory, local, true", "memory, test, true", "memory, local|test, true",
            "directory, local, true", "directory, test, true", "directory, local|test, true",
            "memory, none, false", "memory, prod, false", "memory, local|prod, false", "memory, test|prod, false",
            "directory, none, false", "directory, prod, false", "directory, local|prod, false", "directory, test|prod, false"})
    void captureAdaptersRequireOnlyLocalOrTestProfiles(String transport, String profiles, boolean allowed) {
        withProfiles(profiles).withPropertyValues("app.mail.transport=" + transport,
                "app.mail.capture-directory=" + directory).run(started -> {
            if (allowed) {
                assertThat(started).hasNotFailed();
                assertThat(started.getBean(EmailTransport.class)).isInstanceOf(
                        transport.equals("memory") ? InMemoryEmailTransport.class : DirectoryEmailTransport.class);
            } else {
                assertThat(started).hasFailed();
                assertThat(started.getStartupFailure()).hasRootCauseMessage("app.mail.transport requires only local or test active profiles");
            }
        });
    }

    @ParameterizedTest
    @ValueSource(strings = {"none", "local", "test", "prod", "local|prod"})
    void disabledDeliveryIsAllowedInEveryEnvironment(String profiles) {
        withProfiles(profiles).withPropertyValues("app.mail.transport=disabled").run(started -> {
            assertThat(started).hasNotFailed();
            assertThat(started.getBean(EmailTransport.class)).isInstanceOf(DisabledEmailTransport.class);
        });
    }

    @Test void directoryDeliveryRequiresAUsableDirectoryAndKeepsPathsOutOfDiagnostics(CapturedOutput output) throws Exception {
        Path file = Files.createFile(directory.resolve("private-capture-file"));
        for (String path : new String[]{"", directory.resolve("private-missing-directory").toString(), file.toString(), "private-invalid\0path"}) {
            withProfiles("test").withPropertyValues("app.mail.transport=directory", "app.mail.capture-directory=" + path)
                    .run(started -> {
                        assertThat(started).hasFailed();
                        assertThat(started.getStartupFailure()).hasRootCauseMessage("app.mail.capture-directory must be a writable directory");
                    });
        }
        withProfiles("test").withPropertyValues("app.mail.transport=directory").run(started -> {
            assertThat(started).hasFailed();
            assertThat(started.getStartupFailure()).hasRootCauseMessage("app.mail.capture-directory must be a writable directory");
        });
        assertThat(output.getAll()).doesNotContain("private-capture-file", "private-missing-directory", "private-invalid");
    }

    @Test void unknownTransportRefusesStartupWithoutPrintingItsValue(CapturedOutput output) {
        context.withPropertyValues("app.mail.transport=private-provider-value").run(started -> {
            assertThat(started).hasFailed();
            assertThat(started.getStartupFailure()).hasRootCauseMessage(MailConfiguration.TRANSPORT_RULE);
        });
        assertThat(output.getAll()).doesNotContain("private-provider-value");
    }

    @Test void disabledMailLogsOnlyTheSafeKind(CapturedOutput output) {
        context.run(started -> started.getBean(EmailTransport.class).send(new EmailMessage(
                "private-recipient@example.test", "private-subject", "private-body", EmailKind.PASSWORD_CHANGED)));
        assertThat(output.getAll()).contains("mail.skipped kind=PASSWORD_CHANGED")
                .doesNotContain("private-recipient", "private-subject", "private-body");
    }

    @Test void startupProvidesOneBoundedMailWorker() {
        context.run(started -> {
            var executor = started.getBean("mailExecutor", ThreadPoolTaskExecutor.class);
            assertThat(executor.getCorePoolSize()).isEqualTo(1);
            assertThat(executor.getMaxPoolSize()).isEqualTo(1);
            assertThat(executor.getQueueCapacity()).isEqualTo(200);
            assertThat(executor.getThreadNamePrefix()).isEqualTo("mail-");
        });
    }

    private ApplicationContextRunner withProfiles(String names) {
        return context.withInitializer(started -> started.getEnvironment().setActiveProfiles(
                names.equals("none") ? new String[0] : names.split("\\|")));
    }
}

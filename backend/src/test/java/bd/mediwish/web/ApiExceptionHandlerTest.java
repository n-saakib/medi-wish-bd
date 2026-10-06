package bd.mediwish.web;

import bd.mediwish.auth.AuthenticationFailedException;
import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.auth.InvalidRequestException;
import bd.mediwish.auth.MfaCodeInvalidException;
import bd.mediwish.auth.MfaEnrollmentStaleException;
import bd.mediwish.auth.TooManyAttemptsException;
import bd.mediwish.user.UserService;
import bd.mediwish.user.InvalidProfileException;
import bd.mediwish.user.StaleUpdateException;
import bd.mediwish.user.AccountClosingException;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.TransactionSystemException;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.function.Supplier;

import static bd.mediwish.testsupport.TestApplication.UUID_PATTERN;
import static bd.mediwish.web.WebTestFixtures.apiErrors;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ApiExceptionHandlerTest {
    private static final Map<String, Supplier<RuntimeException>> FAILURES = Map.ofEntries(
            Map.entry("mfa-code-invalid", MfaCodeInvalidException::new),
            Map.entry("mfa-enrollment-stale", MfaEnrollmentStaleException::new),
            Map.entry("too-many-attempts", TooManyAttemptsException::new),
            Map.entry("invalid-request", InvalidRequestException::new),
            Map.entry("invalid-registration", UserService.InvalidRegistrationException::new),
            Map.entry("duplicate-user", UserService.DuplicateUserException::new),
            Map.entry("invalid-profile", () -> new InvalidProfileException("PRIVATE_ROW")),
            Map.entry("stale-update", StaleUpdateException::new),
            Map.entry("account-closing", AccountClosingException::new),
            Map.entry("authentication-failed", AuthenticationFailedException::new),
            Map.entry("authentication-required", AuthenticationRequiredException::new),
            Map.entry("data-access", () -> new DataAccessResourceFailureException("PRIVATE_ROW")),
            Map.entry("transaction", () -> new TransactionSystemException("PRIVATE_ROW")));

    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new FailingController())
            .setControllerAdvice(new ApiExceptionHandler(apiErrors()))
            .addFilters(new RequestCorrelationFilter())
            .build();

    @ParameterizedTest
    @CsvSource({"invalid-request,400,INVALID_REQUEST", "invalid-registration,400,INVALID_REQUEST",
            "duplicate-user,409,DUPLICATE_USER", "invalid-profile,400,INVALID_REQUEST",
            "stale-update,409,STALE_UPDATE", "account-closing,409,ACCOUNT_CLOSING", "authentication-failed,401,AUTHENTICATION_FAILED",
            "authentication-required,401,AUTHENTICATION_REQUIRED", "data-access,500,INTERNAL_ERROR",
            "transaction,500,INTERNAL_ERROR", "mfa-code-invalid,400,MFA_CODE_INVALID",
            "mfa-enrollment-stale,409,MFA_ENROLLMENT_STALE", "too-many-attempts,429,TOO_MANY_ATTEMPTS"})
    void mapsEachDomainFailureToItsBoundedError(String failure, int status, String code) throws Exception {
        mvc.perform(post("/fail/" + failure).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.code").value(code))
                .andExpect(jsonPath("$.requestId", matchesPattern(UUID_PATTERN)))
                .andExpect(content().string(not(containsString("PRIVATE_ROW"))));
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {"{\"PRIVATE_BODY\"", "''", "[1,2]"})
    void unreadableJsonIsAnInvalidRequestThatDoesNotEchoTheBody(String body) throws Exception {
        mvc.perform(post("/fail/unreachable").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                .andExpect(content().string(not(containsString("PRIVATE_BODY"))));
    }

    @RestController
    static class FailingController {
        @PostMapping("/fail/{failure}")
        void fail(@PathVariable String failure, @RequestBody Map<String, String> body) {
            throw FAILURES.get(failure).get();
        }
    }
}
